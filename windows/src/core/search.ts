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

/**
 * 검색 (편의 기능 8): one query over the tasks (오늘 · 앞으로), the memos, the record of finished tasks
 * and the events. Korean matches whole syllables or their first consonants (`ㅂㄱㅅ` → 보고서, `보고ㅅ`
 * too); English and Dutch ignore case and accents (`cafe` → Café). Shared cases:
 * convenience-cases.md §5.
 */

const initials = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const syllableStart = 0xac00;
const syllableEnd = 0xd7a3;

/** One character folded for comparing: lower case, accents dropped (Hangul syllables stay whole). */
function foldOnce(character: string): string {
  const code = character.codePointAt(0)!;
  if (code >= syllableStart && code <= syllableEnd) return character;
  const plain = character.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return plain.length ? plain : character;
}
/** Each character's fold worked out once (a search folds every letter of every memo). */
const folds = new Map<string, string>();
export function fold(character: string): string {
  let folded = folds.get(character);
  if (folded === undefined) {
    folded = foldOnce(character);
    if (folds.size > 50_000) folds.clear();
    folds.set(character, folded);
  }
  return folded;
}

/** A syllable's first consonant ("보" → "ㅂ"), or undefined for anything else. */
function initialOf(character: string): string | undefined {
  const code = character.codePointAt(0)!;
  if (code < syllableStart || code > syllableEnd) return undefined;
  return initials[Math.floor((code - syllableStart) / 588)];
}

/** A query made ready once for many lines: its characters, their folds, which are lone consonants. */
export interface PreparedQuery { wanted: string[]; folded: string[]; initial: boolean[]; /** No lone consonant: a match is the folds' joined text found in the line's. */ plain: boolean; joined: string }
export function prepareQuery(query: string): PreparedQuery {
  const wanted = [...query.trim()];
  const folded = wanted.map(fold);
  const initial = wanted.map((character) => initials.includes(character));
  return { wanted, folded, initial, plain: !initial.includes(true), joined: folded.join("") };
}

/** Where `query` first stands in `text` ([start, end) in UTF-16 units), or undefined; a blank query matches nothing. */
export function matchRange(text: string, query: string | PreparedQuery): [number, number] | undefined {
  const { wanted, folded, initial } = typeof query === "string" ? prepareQuery(query) : query;
  if (wanted.length === 0) return undefined;
  const characters = [...text];
  // Offsets of each character (astral characters take two units).
  const offsets: number[] = [];
  let offset = 0;
  for (const character of characters) { offsets.push(offset); offset += character.length; }
  offsets.push(offset);
  for (let start = 0; start + wanted.length <= characters.length; start += 1) {
    let index = 0;
    while (index < wanted.length && (fold(characters[start + index]) === folded[index] || (initial[index] && initialOf(characters[start + index]) === wanted[index]))) index += 1;
    if (index === wanted.length) return [offsets[start], offsets[start + wanted.length]];
  }
  return undefined;
}

/** The matched words themselves (tests and the shared cases' notation). */
export function matchText(text: string, query: string): string | undefined {
  const range = matchRange(text, query);
  return range ? text.slice(range[0], range[1]) : undefined;
}

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
}

const pad = (value: number) => String(value).padStart(2, "0");
const keyOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Everything that matches, in the order 오늘 · 앞으로 · 메모 · 완료 기록 · 일정 (empty groups left out). */
export function search(input: SearchInput, query: string, now: Date, lang: Lang = "ko", limit = 20): SearchGroup[] {
  if (!query.trim()) return [];
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
    const range = matchRange(item.title, query);
    return range ? [taskRow(item, page, range)] : [];
  });
  add("today", tasks("today"));
  add("ahead", tasks("ahead"));
  add("memos", input.memos.flatMap((memo) => {
    const title = memoTitle(memo, lang);
    const titleRange = matchRange(title, query);
    const updated = new Date(memo.updatedAt);
    const meta = dayMonth(updated.getMonth() + 1, updated.getDate(), undefined, lang);
    if (titleRange) return [{ kind: "memos" as const, id: memo.id, text: title, range: titleRange, meta }];
    for (const line of memo.text.split("\n")) {
      const range = matchRange(line, query);
      if (range) return [{ kind: "memos" as const, id: memo.id, text: line.trim() ? line : title, range: line.trim() ? range : [0, 0] as [number, number], meta }];
    }
    // In a drawer folder whose name matches: the memo's title, nothing marked, the folder in the meta.
    const folder = input.memoFolder?.(memo.id);
    if (folder && matchRange(folder, query)) return [{ kind: "memos" as const, id: memo.id, text: title, range: [0, 0] as [number, number], meta: `${folder} · ${meta}` }];
    return [];
  }));
  const seen = new Set<string>();
  add("history", input.archive
    .filter((entry) => { if (seen.has(entry.id)) return false; seen.add(entry.id); return true; })
    .flatMap((entry) => {
      const range = matchRange(entry.title, query);
      if (!range) return [];
      const at = entry.completedAt ? new Date(entry.completedAt) : undefined;
      const day = at ? logicalDayStart(at) : undefined;
      return [{ kind: "history" as const, id: entry.id, text: entry.title, range, meta: day ? dayMonth(day.getMonth() + 1, day.getDate(), day.getFullYear() !== now.getFullYear() ? day.getFullYear() : undefined, lang) : "", done: true, ...(day ? { day: keyOf(day) } : {}), sort: at?.getTime() ?? 0 }];
    })
    .sort((a, b) => b.sort - a.sort)
    .map(({ sort: _sort, ...row }) => row), 30);
  add("events", eventRows(input.events, query, now, lang));
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
