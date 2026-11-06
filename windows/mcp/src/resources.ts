import { aheadWeek } from "../../src/core/ahead";
import { dayKey, toEntry, type ArchiveEntry } from "../../src/core/archive";
import { dateKey, localDate } from "../../src/core/calendar";
import { expand } from "../../src/core/events";
import { weekTitle } from "../../src/core/lang";
import { memoTitle } from "../../src/core/memo";
import { rangeDay } from "../../src/core/timeRange";
import { Ids } from "./ids";
import { eventIndex, eventLine, getToday, leaveHidden, pick, plusDays, readDay, taskWordsOf, type Ctx } from "./tools";
import { dayText, say, taskLine } from "./words";

/**
 * C2 (docs/plans/mcp-plan.md ‘2c에서 정한 것’): what a person can attach to a conversation themselves (`@` in Claude
 * Code, the attach menu in Claude Desktop) — today's sheet, a week, one memo. resources/list has only today and this
 * week; a memo is reached by its template (or the link get_memo and list_memos give), so memo titles never fill the
 * client's list. Every read goes through the same switch as the tools (index.ts): off, nothing is opened.
 */

export const resourceUris = { today: "jongi-nyang://today", week: "jongi-nyang://week", weekOf: "jongi-nyang://week/{date}", memo: "jongi-nyang://memo/{id}" } as const;

/** A memo's address, by its short id (C2-2). */
export const memoUri = (shortId: string): string => `jongi-nyang://memo/${encodeURIComponent(shortId)}`;

/** Today's sheet: get_today's text. */
export const todayText = (ctx: Ctx): string => getToday(ctx, {}).text;

/** How many of each a day of the week resource shows (the rest: a line naming the tool, M46). */
export const weekCaps = { events: 10, open: 15, done: 10 } as const;

const noon = (day: string): Date => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, 12); };

/**
 * C2-1: the week holding `date` (this week without one) as the 앞으로 tab counts it (Sunday first in ko · en, Monday in
 * nl): day by day its events, the open tasks of that day and what was finished, then how many tasks have no day.
 * The open tasks are as the note shows them on this device (N3-9: what it hides is left out, and the end says so);
 * what was finished is all there, as in 완료 기록.
 */
export function weekText(ctx: Ctx, date?: string): string {
  const { folder, now, lang } = ctx;
  const day = date ? readDay(date, lang) : dayKey(now);
  const { first, last } = aheadWeek(noon(day), lang);
  const from = dateKey(first), to = dateKey(last);
  const all = folder.load("todos.json");
  const events = folder.load("events.json");
  const index = eventIndex(events);
  const shown = expand(events, localDate(from)!, localDate(plusDays(to, 1))!, lang);
  const words = taskWordsOf(ctx, all);
  // The end line counts only what this week would have shown: its days' open tasks and the ones with no day.
  const thisWeek = all.filter((item) => { const on = rangeDay(item, now); return !item.isCompleted && (!on || (on >= from && on <= to)); });
  const hiding = leaveHidden(thisWeek, true, words.spaces!, lang);
  const items = [...hiding.sheet, ...all.filter((item) => item.isCompleted)];
  const done = new Map<string, ArchiveEntry>();
  for (const entry of folder.archive(folder.archiveMonths(from, to))) done.set(entry.id, entry);
  for (const item of items) if (item.isCompleted) done.set(item.id, toEntry(item));
  const finished = [...done.values()].filter((entry) => entry.completedAt).sort((a, b) => a.completedAt!.localeCompare(b.completedAt!));
  const lines = [`${say(lang, "한 주", "Week", "Week")} · ${weekTitle(first, last, lang)}`];
  for (let key = from; key <= to; key = plusDays(key, 1)) {
    const dayEvents = shown.filter((event) => dateKey(event.start) === key || (key === from && dateKey(event.start) < from));
    const open = items.filter((item) => !item.isCompleted && rangeDay(item, now) === key);
    const ended = finished.filter((entry) => dayKey(new Date(entry.completedAt!)) === key);
    lines.push("", `${dayText(key, lang)}${key === dayKey(now) ? ` · ${say(lang, "오늘", "today", "vandaag")}` : ""}`);
    if (!dayEvents.length && !open.length && !ended.length) { lines.push(say(lang, "- 없음", "- nothing", "- niets")); continue; }
    // M46: a resource isn't paged, so each day shows its first few of each and says where the rest are.
    const rest = (count: number, tool: string) => say(lang, `- … ${count}개 더: ${tool}(from · to ${key})`, `- … ${count} more: ${tool} (from · to ${key})`, `- … nog ${count}: ${tool} (from · to ${key})`);
    lines.push(
      ...dayEvents.slice(0, weekCaps.events).map((event) => eventLine(event, lang, index.ids)), ...(dayEvents.length > weekCaps.events ? [rest(dayEvents.length - weekCaps.events, "list_events")] : []),
      ...open.slice(0, weekCaps.open).map((item) => taskLine(item, now, lang, words)), ...(open.length > weekCaps.open ? [rest(open.length - weekCaps.open, "list_todos")] : []),
      ...ended.slice(0, weekCaps.done).map((entry) => `- [x] ${entry.title}`), ...(ended.length > weekCaps.done ? [rest(ended.length - weekCaps.done, "search_history")] : []),
    );
  }
  const someday = items.filter((item) => !item.isCompleted && !rangeDay(item, now)).length;
  if (someday) lines.push("", say(lang, `날짜 없는 할 일(언젠가) ${someday}개`, `${someday} ${someday === 1 ? "task" : "tasks"} with no day (someday)`, `${someday} ${someday === 1 ? "taak" : "taken"} zonder dag (ooit)`));
  if (hiding.note.line) lines.push("", hiding.note.line);
  return lines.join("\n");
}

/** C2-1: one memo's whole text, exactly as written (the app's markdown, not cut at 4,000 characters). */
export function memoText(ctx: Ctx, id: string): { text: string; title: string } {
  const memos = ctx.folder.load("memos.json");
  const ids = new Ids(memos.map((memo) => memo.id));
  const byId = new Map(memos.map((memo) => [memo.id, memo]));
  const memo = byId.get(pick(ids, decodeURIComponent(id), ctx.lang, "memo", (found) => memoTitle(byId.get(found)!, ctx.lang)))!;
  return { text: memo.text, title: memoTitle(memo, ctx.lang) };
}
