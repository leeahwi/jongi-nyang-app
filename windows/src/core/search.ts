import type { ArchiveEntry } from "./archive";
import { label as dueLabel } from "./deadline";
import { expand } from "./events";
import type { LocalEvent } from "./events";
import { clock, dayMonth, type Lang } from "./lang";
import type { Memo } from "./memo";
import { memoTitle } from "./memo";
import type { TodoItem } from "./notebook";
import { pageOf } from "./shelf";
import { compactTime } from "./timeText";
import { rangeOf, rangeText } from "./timeRange";
import { logicalDayStart } from "./archive";
import { entrySpace, inLens, searchSpace, spaceOf, type TodoSpaces } from "./todoSpaces";
import { matchRange, prepareQuery } from "./match";

/**
 * 검색 (편의 기능 8): one query over the tasks (오늘 · 앞으로), the memos, the record of finished tasks
 * and the events. Korean matches whole syllables or their first consonants (`ㅂㄱㅅ` → 보고서, `보고ㅅ`
 * too); English and Dutch ignore case and accents (`cafe` → Café). Shared cases:
 * convenience-cases.md §5. 스페이스 2c (C1–C5, S49–S54 in docs/plans/spaces-cases.json): a `#name` looks in
 * that space only — its to-dos and its record lines; memos and events, which have no space, are left out.
 */

export { fold, matchRange, matchText, prepareQuery, type PreparedQuery } from "./match";

// ─── Groups ───────────────────────────────────────────────────────────────────

export type SearchGroupKind = "today" | "ahead" | "memos" | "history" | "events";
export interface SearchRow {
  kind: SearchGroupKind;
  /** The task, memo or event id; for the record, the entry id. */
  id: string;
  /** The line shown, and where the match is in it. */
  text: string;
  range: [number, number];
  /** Quiet words at the right: a deadline, a time, a day. */
  meta: string;
  done?: boolean;
  /** 완료 기록: the day it was finished ("yyyy-MM-dd"); 일정: the occurrence's key. */
  day?: string;
  key?: string;
}
export interface SearchGroup { kind: SearchGroupKind; title: string; rows: SearchRow[]; count: number }

const groupTitles: Record<Lang, Record<SearchGroupKind, string>> = {
  ko: { today: "오늘", ahead: "앞으로", memos: "메모", history: "완료 기록", events: "일정" },
  en: { today: "Today", ahead: "Ahead", memos: "Notes", history: "History", events: "Events" },
  nl: { today: "Vandaag", ahead: "Vooruit", memos: "Notities", history: "Geschiedenis", events: "Afspraken" },
};
export const searchGroupTitle = (kind: SearchGroupKind, lang: Lang = "ko"): string => groupTitles[lang][kind];

export interface SearchInput {
  items: readonly TodoItem[];
  memos: readonly Memo[];
  archive: readonly ArchiveEntry[];
  events: readonly LocalEvent[];
  dueStyle?: "dday" | "date";
  /** 메모 서랍 (1.28): a memo's folder name (none for 메모), so a memo in a folder whose name matches is found too. */
  memoFolder?: (id: string) => string | undefined;
  /** 할 일 스페이스 (2c): the spaces and each to-do's place, for a `#name` in the words (none: `#` is plain text). */
  spaces?: TodoSpaces;
}

/**
 * C4: the empty slip's second hint while there are spaces — "#회사처럼 적으면 그 스페이스에서만 찾아요" with the first
 * space's name, blanks left out as `#` reads it.
 */
export function searchHint(name: string, lang: Lang = "ko"): string {
  const tag = `#${name.replace(/\s+/gu, "")}`;
  return { ko: `${tag}처럼 적으면 그 스페이스에서만 찾아요`, en: `Type ${tag} to look in that space only`, nl: `Typ ${tag} om alleen in die ruimte te zoeken` }[lang];
}

const pad = (value: number) => String(value).padStart(2, "0");
const keyOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Everything that matches, in the order 오늘 · 앞으로 · 메모 · 완료 기록 · 일정 (empty groups left out). */
export function search(input: SearchInput, query: string, now: Date, lang: Lang = "ko", limit = 20): SearchGroup[] {
  if (!query.trim()) return [];
  // C1 · C2: a `#name` that names a space (or 일반) looks there only, with the rest of the words; `#회사` alone, everything in it.
  const spaces = input.spaces;
  const { space, words } = spaces ? searchSpace(query, spaces) : { space: undefined, words: query.trim() };
  const prepared = prepareQuery(words);
  const find = (text: string): [number, number] | undefined => (words ? matchRange(text, prepared) : [0, 0]);
  const groups: SearchGroup[] = [];
  const add = (kind: SearchGroupKind, rows: SearchRow[], max = limit) => {
    if (rows.length) groups.push({ kind, title: searchGroupTitle(kind, lang), rows: rows.slice(0, max), count: rows.length });
  };
  const taskRow = (item: TodoItem, kind: SearchGroupKind, range: [number, number]): SearchRow => {
    let meta = "";
    if (item.dueDate && !item.isCompleted) meta = dueLabel(item.dueDate, input.dueStyle ?? "dday", now, lang);
    else if (item.reminderAt && !item.isCompleted && !item.timeStart) meta = compactTime(new Date(item.reminderAt), now, lang);
    // 시간 정하기: "D-3 · 14:00–15:30", or just the hours.
    const hours = rangeOf(item);
    if (hours && !item.isCompleted) meta = meta ? `${meta} · ${rangeText(hours, lang)}` : rangeText(hours, lang);
    return { kind, id: item.id, text: item.title, range, meta, ...(item.isCompleted ? { done: true } : {}) };
  };
  const tasks = (page: "today" | "ahead") => input.items.flatMap((item) => {
    if ((pageOf(item, now) === "today") !== (page === "today")) return [];
    const range = find(item.title);
    if (!range || (space !== undefined && !inLens(space, spaces ? spaceOf(spaces, item.id) : undefined))) return [];
    return [taskRow(item, page, range)];
  });
  add("today", tasks("today"));
  add("ahead", tasks("ahead"));
  // C3: memos and events have no space — not there while looking in one.
  if (space === undefined) add("memos", input.memos.flatMap((memo) => {
    const title = memoTitle(memo, lang);
    const titleRange = matchRange(title, prepared);
    const updated = new Date(memo.updatedAt);
    const meta = dayMonth(updated.getMonth() + 1, updated.getDate(), undefined, lang);
    if (titleRange) return [{ kind: "memos" as const, id: memo.id, text: title, range: titleRange, meta }];
    for (const line of memo.text.split("\n")) {
      const range = matchRange(line, prepared);
      if (range) return [{ kind: "memos" as const, id: memo.id, text: line.trim() ? line : title, range: line.trim() ? range : [0, 0] as [number, number], meta }];
    }
    // In a drawer folder whose name matches: the memo's title, nothing marked, the folder in the meta.
    const folder = input.memoFolder?.(memo.id);
    if (folder && matchRange(folder, prepared)) return [{ kind: "memos" as const, id: memo.id, text: title, range: [0, 0] as [number, number], meta: `${folder} · ${meta}` }];
    return [];
  }));
  const seen = new Set<string>();
  add("history", input.archive
    .filter((entry) => { if (seen.has(entry.id)) return false; seen.add(entry.id); return true; })
    .flatMap((entry) => {
      const range = find(entry.title);
      if (!range || (space !== undefined && !inLens(space, spaces ? entrySpace(spaces, entry.id, entry.space) : undefined))) return [];
      const at = entry.completedAt ? new Date(entry.completedAt) : undefined;
      const day = at ? logicalDayStart(at) : undefined;
      return [{ kind: "history" as const, id: entry.id, text: entry.title, range, meta: day ? dayMonth(day.getMonth() + 1, day.getDate(), day.getFullYear() !== now.getFullYear() ? day.getFullYear() : undefined, lang) : "", done: true, ...(day ? { day: keyOf(day) } : {}), sort: at?.getTime() ?? 0 }];
    })
    .sort((a, b) => b.sort - a.sort)
    .map(({ sort: _sort, ...row }) => row), 30);
  if (space === undefined) add("events", eventRows(input.events, words, now, lang));
  return groups;
}

/** Events whose title or place matches: the next time each comes from today (else its first day), the coming ones first. */
function eventRows(events: readonly LocalEvent[], query: string, now: Date, lang: Lang): SearchRow[] {
  const today = logicalDayStart(now);
  const rows: (SearchRow & { sort: number })[] = [];
  for (const event of events) {
    const titleRange = matchRange(event.title, query);
    const placeRange = titleRange ? undefined : event.location ? matchRange(event.location, query) : undefined;
    if (!titleRange && !placeRange) continue;
    // The next occurrence within two years (a repeating event), else the event's own first day.
    const coming = expand([event], today, new Date(today.getTime() + 730 * 86_400_000), lang)[0];
    // Only a single event can be wholly past: its own day (a repeating one always has a coming day).
    const occurrence = coming ?? expand([event], new Date(`${event.date}T00:00:00`), new Date(new Date(`${event.date}T00:00:00`).getTime() + (event.days + 1) * 86_400_000), lang)[0];
    const start = occurrence?.start ?? new Date(`${event.date}T12:00:00`);
    const day = dayMonth(start.getMonth() + 1, start.getDate(), start.getFullYear() !== now.getFullYear() ? start.getFullYear() : undefined, lang);
    const meta = event.allDay ? day : `${day} ${clock(start.getHours(), start.getMinutes(), lang)}`;
    const text = titleRange ? event.title : `${event.title} · ${event.location}`;
    const range: [number, number] = titleRange ?? [event.title.length + 3 + placeRange![0], event.title.length + 3 + placeRange![1]];
    // Coming ones by date; past ones after them, the latest first.
    const sort = coming ? start.getTime() : 1e15 + (1e13 - start.getTime());
    rows.push({ kind: "events", id: event.id, text, range, meta, ...(occurrence ? { key: occurrence.key } : {}), sort });
  }
  return rows.sort((a, b) => a.sort - b.sort).map(({ sort: _sort, ...row }) => row);
}
