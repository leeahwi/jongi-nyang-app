import type { Lang } from "./lang";
import type { TodoItem } from "./notebook";
import { dueToday } from "./ribbon";
import { groupedCount, inLens, lensNone, liveSpaces, roParticle, type TodoSpaces } from "./todoSpaces";

/**
 * 2b 스페이스별로 묶기 (docs/plans/spaces-phase2.md): 오늘's list in one group per space — the desk's order, 일반 last, no
 * empty group, only the lens's group while one space shows. In a group: the rows with a time today (by time), the rest
 * (in the list's order), then the finished ones. The same rules and cases (S39–S44, spaces-cases.json `groups`) as the
 * macOS app (SpaceGroups.swift).
 */

/** 일반's key wherever a group is named by a string (the device's folded groups, the cases): the lens's `none`. */
export const generalGroup = lensNone;

export interface SpaceGroup {
  /** The space's id, or `none` for 일반. */
  key: string;
  /** The space's id; undefined: 일반. */
  space?: string;
  /** Open rows with a time today, by time (then the list's order). */
  timed: TodoItem[];
  /** The other open rows, in the list's order. */
  rest: TodoItem[];
  /** Finished rows, in the list's order. */
  done: TodoItem[];
  /** The soonest time still ahead (ms; a row going on now isn't 다음) — E's `다음 13:43`. */
  next?: number;
  /** When the timed rows are due (ms). */
  times: Map<string, number>;
}

export const groupItems = (group: SpaceGroup): TodoItem[] => [...group.timed, ...group.rest, ...group.done];
export const groupOpen = (group: SpaceGroup): number => group.timed.length + group.rest.length;

/**
 * The groups as shown. `items`: the rows shown (finished ones too, unless hidden), in the list's order; `spaceOf`: a
 * row's live space (undefined: 일반); `lens`: the space shown alone (`none`: 일반), undefined for all.
 */
export function spaceGroups(items: readonly TodoItem[], data: TodoSpaces, spaceOf: (id: string) => string | undefined, lens: string | undefined, now: Date): SpaceGroup[] {
  const live = liveSpaces(data);
  const alive = new Set(live.map((space) => space.id));
  const byKey = new Map<string, SpaceGroup>();
  const order = new Map(items.map((item, index) => [item.id, index]));
  for (const item of items) {
    const found = spaceOf(item.id);
    const space = found && alive.has(found) ? found : undefined;
    if (!inLens(lens, space)) continue;
    const key = space ?? generalGroup;
    let group = byKey.get(key);
    if (!group) byKey.set(key, (group = { key, ...(space ? { space } : {}), timed: [], rest: [], done: [], times: new Map() }));
    if (item.isCompleted) { group.done.push(item); continue; }
    const at = dueToday(item, now);
    if (at === undefined) { group.rest.push(item); continue; }
    group.timed.push(item);
    group.times.set(item.id, at);
    if (at > now.getTime() && (group.next === undefined || at < group.next)) group.next = at;
  }
  for (const group of byKey.values()) {
    group.timed.sort((a, b) => group.times.get(a.id)! - group.times.get(b.id)! || order.get(a.id)! - order.get(b.id)!);
  }
  return [...live.map((space) => space.id), generalGroup].flatMap((key) => byKey.get(key) ?? []);
}

/** S44: Ctrl+Alt+↑ (-1) · ↓ (+1) on a row — the group above or below among those shown (`none`: 일반); undefined: none there. */
export function neighborGroup(id: string, step: number, groups: readonly SpaceGroup[]): string | undefined {
  const index = groups.findIndex((group) => groupItems(group).some((item) => item.id === id));
  return index >= 0 ? groups[index + step]?.key : undefined;
}

// ─── I · 넓은 노트는 칸으로 (S45) ───

/** The narrowest a column may be; the gap between columns and the margin at each side. */
export const columnWidth = 220;
export const columnGap = 10;
export const boardMargin = 14;
/** While grouped, the note may be this wide (it stays 720 otherwise). */
export const wideNote = 1200;
export const narrowNote = 720;

/**
 * S45: the groups stand side by side on a wide note (720 and more) only when every column gets 220 (count × 220 + the
 * gaps + the margins fit the note's width); else the chosen look (메모지 · 책갈피). Columns never scroll sideways.
 */
export const boardFits = (width: number, count: number): boolean =>
  count > 0 && width >= narrowNote && count * columnWidth + (count - 1) * columnGap + boardMargin * 2 <= width;

/** A group's key as the space it moves a to-do to: null for 일반. */
export const groupSpace = (key: string): string | null => (key === generalGroup ? null : key);

/** S43: where a dragged row was in the whole list, for 되돌리기 — the row before it (after), or the one after it when first. */
export function returnPoint(id: string, order: readonly string[]): { targetID: string; after: boolean } | undefined {
  const index = order.indexOf(id);
  if (index < 0) return undefined;
  if (index > 0) return { targetID: order[index - 1], after: true };
  return order.length > 1 ? { targetID: order[1], after: false } : undefined;
}

/** The list's order with `id` put before (or after) `target` — as the list's own move does. */
export function movedOrder(order: readonly string[], id: string, target: string, after: boolean): string[] {
  if (id === target || !order.includes(id)) return [...order];
  const out = order.filter((entry) => entry !== id);
  const to = out.indexOf(target);
  if (to < 0) return [...order];
  out.splice(to + (after ? 1 : 0), 0, id);
  return out;
}

/** F's head: "2개 남음" · "2 left" · "nog 2". */
export const leftWords = (count: number, lang: Lang = "ko"): string =>
  ({ ko: `${groupedCount(count, lang)}개 남음`, en: `${groupedCount(count, lang)} left`, nl: `nog ${groupedCount(count, lang)}` })[lang];
/** E's head: "다음 13:43" · "Next 13:43" · "Volgende 13:43". */
export const nextWords = (time: string, lang: Lang = "ko"): string => ({ ko: `다음 ${time}`, en: `Next ${time}`, nl: `Volgende ${time}` })[lang];
/** F's folded finished rows: "끝낸 1" · "1 done" · "1 klaar". */
export const doneWords = (count: number, lang: Lang = "ko"): string =>
  ({ ko: `끝낸 ${groupedCount(count, lang)}`, en: `${groupedCount(count, lang)} done`, nl: `${groupedCount(count, lang)} klaar` })[lang];
/** The drop's hint on the group under a dragged row: "여기 놓으면 집으로 옮겨요". */
export const dropHereWords = (name: string, lang: Lang = "ko"): string =>
  ({ ko: `여기 놓으면 ${name}${roParticle(name)} 옮겨요`, en: `Drop to move to ${name}`, nl: `Naar ${name} verplaatsen` })[lang];
/** A board column's foot: "+ 회사에 넣기" · "+ Add to Work" · "+ Toevoegen aan Werk". */
export const addToWords = (name: string, lang: Lang = "ko"): string =>
  ({ ko: `+ ${name}에 넣기`, en: `+ Add to ${name}`, nl: `+ Toevoegen aan ${name}` })[lang];
