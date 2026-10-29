import { aiEntry, aiTargetOf, sameSaved, type AiChange, type AiItem, type AiTarget } from "../../src/core/ai";
import { dayKey } from "../../src/core/archive";
import { nextFire, timeText as alarmTimeText } from "../../src/core/alarm";
import { allDayText, dateKey, dayBounds, localDate, todayEvents, validate, type CalendarDraft, type CalendarEvent } from "../../src/core/calendar";
import { todaySinceUpdates } from "../../src/core/carry";
import { draftFromEvent, eventFromDraft, expand, occurrences, parseOccurrenceKey, type LocalEvent } from "../../src/core/events";
import { focusByTask, focusTime, focusTotal, focusTotals, sessionsText } from "../../src/core/focus";
import { days as dayCount, timeRange, type Lang } from "../../src/core/lang";
import { memoPreview, memoTitle, newMemo, type Memo } from "../../src/core/memo";
import { cleanedTitle, isoDate, newID, type TodoItem } from "../../src/core/notebook";
import { pageOf } from "../../src/core/shelf";
import { toEntry, type ArchiveEntry } from "../../src/core/archive";
import { clockKey, clockMinutes, logicalMinutes, rangeDay, rangeDayText, rangeOf, rangeText, validRange, withRange, type TimeRange } from "../../src/core/timeRange";
import { Folder } from "./files";
import { dayText, localStamp, reminderText, say, taskData, taskLine, words } from "./words";

/**
 * The tools themselves, apart from MCP: each takes what the call gave and answers with a short text in the
 * app's language and the same as data. Rules from the shared AI connection spec §4–5 (cases M3–M12).
 */

export interface Ctx { folder: Folder; lang: Lang; now: Date; client: string }
export interface Reply { text: string; data: Record<string, unknown>; error?: boolean }

/** Something asked that can't be done; its words go back as the answer (isError). */
export class Problem extends Error {}

export const maxItems = 20;
const maxTitle = 200;
const maxDays = 31;
/** How long a preview's confirmation number can be used. */
export const tokenMs = 10 * 60_000;
/** A to-do's end stops at 03:45 the next morning (an end at 04:00 isn't kept on a to-do; ribbon-cases R6). */
const lastEnd = 1665;

// ─── Reading what was given ───────────────────────────────────────────────────

function readDay(value: string, lang: Lang): string {
  const date = localDate(value.trim());
  if (!date) throw new Problem(words.badDate(value, lang));
  return dateKey(date);
}

function readClock(value: string, lang: Lang): number {
  const minutes = clockMinutes(value);
  if (minutes === undefined) throw new Problem(words.badTime(value, lang));
  return minutes;
}

const noon = (day: string): Date => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const plusDays = (day: string, count: number): string => { const date = noon(day); date.setDate(date.getDate() + count); return dateKey(date); };
const spanDays = (from: string, to: string): number => Math.round((noon(to).getTime() - noon(from).getTime()) / 86_400_000) + 1;
/** A clock on a 4 a.m. day: before 04:00 is the night after. */
const atOn = (day: string, minutes: number): Date => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, 0, logicalMinutes(minutes)); };

/** A period from `from` to `to` (both "yyyy-MM-dd", inclusive), at most `limit` days. */
function readPeriod(from: string | undefined, to: string | undefined, fallback: string, limit: number, lang: Lang): { from: string; to: string } {
  const first = from ? readDay(from, lang) : to ? readDay(to, lang) : fallback;
  const last = to ? readDay(to, lang) : first;
  if (last < first) throw new Problem(words.backwards(lang));
  if (spanDays(first, last) > limit) throw new Problem(words.tooLong(limit, lang));
  return { from: first, to: last };
}

/** A to-do's range from its texts: an end needs a start (M5), and ends after it, by 03:45 the next morning (M6). */
function readRange(start: string | null | undefined, end: string | null | undefined, lang: Lang): TimeRange | undefined {
  if (!start) {
    if (end) throw new Problem(say(lang, "끝 시간만 있어요. 시작 시간도 알려 주세요.", "There’s an end time but no start time. Give a start time too.", "Er is een eindtijd maar geen begintijd. Geef ook een begintijd."));
    return undefined;
  }
  const range: TimeRange = { start: readClock(start, lang), ...(end ? { end: readClock(end, lang) } : {}) };
  if (!validRange(range) || (range.end !== undefined && logicalMinutes(range.end) > lastEnd)) {
    throw new Problem(say(lang,
      "할 일의 끝은 시작보다 뒤, 다음 날 새벽 03:45까지예요 (하루는 새벽 4시에 끝나요).",
      "A task’s end must be after its start and no later than 3:45 AM (the day ends at 4 AM).",
      "Het einde van een taak moet na het begin liggen en uiterlijk 03:45 zijn (de dag eindigt om 04:00)."));
  }
  return range;
}

/** A reminder: "HH:mm" on `day` (the 4 a.m. day), or a local "yyyy-MM-ddTHH:mm", or an ISO time with a zone. Must be ahead. */
function readReminder(value: string, day: string, now: Date, lang: Lang): Date {
  const text = value.trim();
  let at: Date | undefined;
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})(?::\d{2})?$/.exec(text);
  if (clockMinutes(text) !== undefined) at = atOn(day, clockMinutes(text)!);
  else if (local && localDate(local[1]) && clockMinutes(local[2]) !== undefined) {
    const [y, m, d] = local[1].split("-").map(Number);
    at = new Date(y, m - 1, d, 0, clockMinutes(local[2])!);
  } else if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) && !Number.isNaN(Date.parse(text))) at = new Date(text);
  if (!at) throw new Problem(say(lang, `알림 시각을 읽지 못했어요: ‘${value}’ (HH:mm 또는 yyyy-MM-ddTHH:mm).`, `Couldn’t read the reminder ‘${value}’ (HH:mm or yyyy-MM-ddTHH:mm).`, `De herinnering ‘${value}’ is onleesbaar (HH:mm of yyyy-MM-ddTHH:mm).`));
  if (at.getTime() <= now.getTime()) throw new Problem(say(lang, "알림 시각이 이미 지났어요.", "That reminder time has already passed.", "Dat herinneringstijdstip is al voorbij."));
  return at;
}

function readTitle(value: string | undefined, lang: Lang): string {
  const title = cleanedTitle(value ?? "");
  if (!title) throw new Problem(say(lang, "제목이 비어 있어요.", "The title is empty.", "De titel is leeg."));
  if (title.length > maxTitle) throw new Problem(say(lang, `제목은 ${maxTitle}자까지예요.`, `A title can be at most ${maxTitle} characters.`, `Een titel mag hoogstens ${maxTitle} tekens zijn.`));
  return title;
}

const lower = (text: string) => text.trim().toLowerCase();

// ─── Reading tools ────────────────────────────────────────────────────────────

/** Open tasks of today's sheet first by their time, then the others in the list's order. */
const byTime = (items: readonly TodoItem[], now: Date): TodoItem[] => {
  const order = (item: TodoItem) => { const range = rangeOf(item); return range ? logicalMinutes(range.start) : Number.MAX_SAFE_INTEGER; };
  const day = (item: TodoItem) => rangeDay(item, now) ?? "9999";
  return [...items].sort((a, b) => (day(a) < day(b) ? -1 : day(a) > day(b) ? 1 : order(a) - order(b)));
};

function eventLine(event: CalendarEvent, lang: Lang): string {
  const days = event.allDay ? Math.round((event.end.getTime() - event.start.getTime()) / 86_400_000) : 1;
  const when = event.allDay ? (days > 1 ? `${allDayText(lang)} · ${dayCount(days, lang)}` : allDayText(lang)) : timeRange({ hour: event.start.getHours(), minute: event.start.getMinutes() }, { hour: event.end.getHours(), minute: event.end.getMinutes() }, lang);
  return [`- ${when} ${event.title}`, ...(event.location ? [event.location] : []), ...(event.recurring ? [say(lang, "반복", "repeats", "herhaalt")] : []), `id ${event.eventId}`].join(" · ");
}

function eventData(event: CalendarEvent, source: LocalEvent | undefined): Record<string, unknown> {
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return {
    id: event.eventId, key: event.key, title: event.title, date: dateKey(event.start), allDay: event.allDay,
    ...(event.allDay ? { days: source?.days ?? 1 } : { start: clock(event.start), end: clock(event.end), ...(dateKey(event.end) !== dateKey(event.start) ? { endDate: dateKey(event.end) } : {}) }),
    ...(event.location ? { location: event.location } : {}), repeat: source?.repeat ?? "none", canChange: !event.recurring,
  };
}

export function getToday({ folder, now, lang }: Ctx): Reply {
  const today = dayKey(now);
  const items = folder.load("todos.json");
  const events = folder.load("events.json");
  const tasks = byTime(items.filter((item) => pageOf(item, now) === "today" && (!item.isCompleted || (item.completedAt !== undefined && dayKey(new Date(item.completedAt)) === today))), now);
  const { start, end } = dayBounds(now);
  const shown = todayEvents(expand(events, start, end, lang), now);
  const alarms = folder.alarms().map((alarm) => ({ alarm, at: nextFire(alarm, now) })).filter((entry) => entry.at && entry.at < end)
    .sort((a, b) => a.at!.getTime() - b.at!.getTime());
  const focus = focusTotal(folder.focus(), now, now);
  const open = tasks.filter((item) => !item.isCompleted).length;
  const lines = [
    `${say(lang, "오늘", "Today", "Vandaag")} · ${dayText(today, lang)}`,
    "",
    `${say(lang, "할 일", "Tasks", "Taken")} (${say(lang, `남은 것 ${open}개, 끝낸 것 ${tasks.length - open}개`, `${open} open, ${tasks.length - open} done`, `${open} open, ${tasks.length - open} klaar`)})`,
    ...(tasks.length ? tasks.map((item) => taskLine(item, now, lang)) : [say(lang, "- 없음", "- none", "- geen")]),
    "",
    `${say(lang, "일정", "Events", "Afspraken")} (${shown.length})`,
    ...(shown.length ? shown.map((event) => eventLine(event, lang)) : [say(lang, "- 없음", "- none", "- geen")]),
    ...(alarms.length ? ["", say(lang, "알람", "Alarms", "Wekkers"), ...alarms.map(({ alarm }) => `- ${alarmTimeText(alarm, lang)}${alarm.label ? ` ${alarm.label}` : ""}`)] : []),
    "",
    `${say(lang, "집중", "Focus", "Focus")} ${focusTime(focus.minutes, lang)} · ${sessionsText(focus.sessions, lang)}`,
  ];
  return {
    text: lines.join("\n"),
    data: {
      date: today, tasks: tasks.map((item) => taskData(item, now)),
      events: shown.map((event) => eventData(event, events.find((entry) => entry.id === event.eventId))),
      alarms: alarms.map(({ alarm, at }) => ({ id: alarm.id, time: alarm.time, label: alarm.label, at: localStamp(at!) })),
      focus: { minutes: focus.minutes, sessions: focus.sessions },
    },
  };
}

export function listTodos({ folder, now, lang }: Ctx, args: { where?: "today" | "later" | "all"; from?: string; to?: string }): Reply {
  const where = args.where ?? "all";
  const today = dayKey(now);
  const period = args.from || args.to ? readPeriod(args.from, args.to, today, 366, lang) : undefined;
  const items = folder.load("todos.json").filter((item) => {
    const page = pageOf(item, now);
    if (item.isCompleted && !(where === "all" && item.completedAt && dayKey(new Date(item.completedAt)) === today)) return false;
    if (where === "today" && page !== "today") return false;
    if (where === "later" && page === "today") return false;
    if (!period) return true;
    const day = rangeDay(item, now);
    return day !== undefined && day >= period.from && day <= period.to;
  });
  const sorted = byTime(items, now);
  const heading = say(lang, `할 일 ${sorted.length}개`, `${sorted.length} ${sorted.length === 1 ? "task" : "tasks"}`, `${sorted.length} ${sorted.length === 1 ? "taak" : "taken"}`);
  return {
    text: [heading, ...sorted.map((item) => taskLine(item, now, lang))].join("\n"),
    data: { where, ...(period ?? {}), tasks: sorted.map((item) => taskData(item, now)) },
  };
}

export function listEvents({ folder, now, lang }: Ctx, args: { from: string; to?: string }): Reply {
  const period = readPeriod(args.from, args.to, dayKey(now), maxDays, lang);
  const events = folder.load("events.json");
  const shown = expand(events, localDate(period.from)!, localDate(plusDays(period.to, 1))!, lang);
  const lines: string[] = [say(lang, `일정 ${shown.length}개`, `${shown.length} ${shown.length === 1 ? "event" : "events"}`, `${shown.length} ${shown.length === 1 ? "afspraak" : "afspraken"}`)];
  let day = "";
  for (const event of shown) {
    const key = dateKey(event.start) < period.from ? period.from : dateKey(event.start);
    if (key !== day) { day = key; lines.push("", dayText(day, lang)); }
    lines.push(eventLine(event, lang));
  }
  return { text: lines.join("\n"), data: { ...period, events: shown.map((event) => eventData(event, events.find((entry) => entry.id === event.eventId))) } };
}

export function listMemos({ folder, lang }: Ctx, args: { query?: string; limit?: number }): Reply {
  const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 20)));
  const query = lower(args.query ?? "");
  const memos = folder.load("memos.json").filter((memo) => memo.text.trim() && (!query || memo.text.toLowerCase().includes(query)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const shown = memos.slice(0, limit);
  const line = (memo: Memo) => {
    const preview = memoPreview(memo);
    return `- ${memoTitle(memo, lang)}${preview ? ` — ${preview.length > 120 ? `${preview.slice(0, 120)}…` : preview}` : ""} · ${dayText(dateKey(new Date(memo.updatedAt)), lang)} · id ${memo.id}`;
  };
  return {
    text: [say(lang, `메모 ${memos.length}개${memos.length > shown.length ? ` 중 최근 ${shown.length}개` : ""}`, `${memos.length} memos${memos.length > shown.length ? `, newest ${shown.length}` : ""}`, `${memos.length} notities${memos.length > shown.length ? `, nieuwste ${shown.length}` : ""}`), ...shown.map(line)].join("\n"),
    data: { count: memos.length, memos: shown.map((memo) => ({ id: memo.id, text: memo.text.length > 4000 ? `${memo.text.slice(0, 4000)}…` : memo.text, createdAt: localStamp(new Date(memo.createdAt)), updatedAt: localStamp(new Date(memo.updatedAt)) })) },
  };
}

export function getFocus({ folder, now, lang }: Ctx, args: { from?: string; to?: string }): Reply {
  const period = readPeriod(args.from, args.to, dayKey(now), 366, lang);
  const records = folder.focus();
  const [from, to] = [noon(period.from), noon(period.to)];
  const total = focusTotal(records, from, to);
  const top = focusByTask(records, from, to, 5);
  const when = period.from === period.to ? dayText(period.from, lang) : `${dayText(period.from, lang)} – ${dayText(period.to, lang)}`;
  const lines = [
    `${say(lang, "집중", "Focus", "Focus")} ${focusTime(total.minutes, lang)} · ${sessionsText(total.sessions, lang)} (${when})`,
    ...(top.length ? [say(lang, "가장 오래 집중한 일", "Longest focus", "Langst gefocust op"), ...top.map((task) => `- ${task.title} · ${focusTime(task.minutes, lang)} · ${sessionsText(task.sessions, lang)}`)] : []),
  ];
  return { text: lines.join("\n"), data: { ...period, minutes: total.minutes, sessions: total.sessions, days: Object.fromEntries(focusTotals(records, from, to)), top } };
}

export function searchHistory({ folder, now, lang }: Ctx, args: { query?: string; from?: string; to?: string; limit?: number }): Reply {
  const period = args.from || args.to ? readPeriod(args.from, args.to, dayKey(now), 3660, lang) : undefined;
  const query = lower(args.query ?? "");
  const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 50)));
  const found = new Map<string, ArchiveEntry>();
  for (const entry of folder.archive()) found.set(entry.id, entry);
  for (const item of folder.load("todos.json")) if (item.isCompleted) found.set(item.id, toEntry(item));
  const entries = [...found.values()].filter((entry) => {
    if (!entry.completedAt || (query && !entry.title.toLowerCase().includes(query))) return false;
    const day = dayKey(new Date(entry.completedAt));
    return !period || (day >= period.from && day <= period.to);
  }).sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));
  const shown = entries.slice(0, limit);
  const lines = [say(lang, `끝낸 일 ${entries.length}개${entries.length > shown.length ? ` 중 최근 ${shown.length}개` : ""}`, `${entries.length} done${entries.length > shown.length ? `, newest ${shown.length}` : ""}`, `${entries.length} afgerond${entries.length > shown.length ? `, nieuwste ${shown.length}` : ""}`)];
  let day = "";
  for (const entry of shown) {
    const key = dayKey(new Date(entry.completedAt!));
    if (key !== day) { day = key; lines.push(dayText(day, lang)); }
    const range = entry.timeStart ? rangeOf(entry) : undefined;
    lines.push(`- ${entry.title}${range ? ` (${rangeText(range, lang)})` : ""}`);
  }
  return {
    text: lines.join("\n"),
    data: { ...(period ?? {}), count: entries.length, items: shown.map((entry) => ({ id: entry.id, title: entry.title, day: dayKey(new Date(entry.completedAt!)), completedAt: localStamp(new Date(entry.completedAt!)), ...(entry.timeStart ? { timeStart: entry.timeStart } : {}), ...(entry.timeEnd ? { timeEnd: entry.timeEnd } : {}) })) },
  };
}

// ─── Adding ───────────────────────────────────────────────────────────────────

export interface TodoInput { title: string; date?: string; timeStart?: string; timeEnd?: string; remindAt?: string | null; later?: boolean }

/** Where a task counts for "already there" (M7): its deadline, else 언젠가 or today. */
const dupDay = (item: Pick<TodoItem, "dueDate" | "shelf">, today: string) => item.dueDate ?? (item.shelf === "later" ? "someday" : today);

/** A new task from what Claude gave, as the app's quick entry would make it (the day: a deadline unless it is today). */
function newTask(input: TodoInput, now: Date, lang: Lang): TodoItem {
  const title = readTitle(input.title, lang);
  const today = dayKey(now);
  if (input.later && (input.date || input.timeStart || input.timeEnd)) {
    throw new Problem(say(lang, "언젠가 할 일에는 날짜나 시간을 붙일 수 없어요.", "A someday task can’t have a date or a time.", "Een taak voor ooit kan geen datum of tijd hebben."));
  }
  const day = input.date ? readDay(input.date, lang) : today;
  if (day < today) throw new Problem(say(lang, `이미 지난 날이에요: ${dayText(day, lang)}.`, `${dayText(day, lang)} has already passed.`, `${dayText(day, lang)} is al voorbij.`));
  const range = readRange(input.timeStart, input.timeEnd, lang);
  let reminder: Date | undefined;
  if (input.remindAt) reminder = readReminder(input.remindAt, day, now, lang);
  else if (input.remindAt === undefined && range) {
    const start = atOn(day, range.start);
    if (start > now) reminder = start; // a start still ahead rings, as with a line typed in the app
  }
  const item: TodoItem = {
    id: newID(), title, isCompleted: false, createdAt: isoDate(now),
    ...(reminder ? { reminderAt: isoDate(reminder) } : {}), ...(input.later ? { shelf: "later" as const } : {}),
    ...(day !== today && !input.later ? { dueDate: day } : {}),
    ...(range ? { timeStart: clockKey(range.start), ...(range.end !== undefined ? { timeEnd: clockKey(range.end) } : {}) } : {}),
  };
  for (const change of todaySinceUpdates([item], now)) if (change.todaySince) item.todaySince = change.todaySince;
  return item;
}

function logged(ctx: Ctx, tool: string, kind: "add" | "change", target: AiTarget, changes: AiChange[]): void {
  if (changes.length === 0) return;
  const title = String((changes[0].after ?? changes[0].before)?.[target === "memos" ? "text" : "title"] ?? "");
  ctx.folder.log(aiEntry({ client: ctx.client, tool, kind, target, title: target === "memos" ? title.split("\n")[0].trim() : title, changes }, ctx.now));
}

export function addTodos(ctx: Ctx, args: { items: TodoInput[] }): Reply {
  const { folder, now, lang } = ctx;
  const inputs = args.items ?? [];
  if (inputs.length === 0) throw new Problem(say(lang, "넣을 할 일이 없어요.", "There are no tasks to add.", "Er zijn geen taken om toe te voegen."));
  if (inputs.length > maxItems) throw new Problem(say(lang, `한 번에 ${maxItems}개까지 넣을 수 있어요. 나눠서 넣어 주세요.`, `At most ${maxItems} tasks at a time. Add them in parts.`, `Hoogstens ${maxItems} taken tegelijk. Voeg ze in delen toe.`));
  const made: TodoItem[] = [];
  const problems: string[] = [];
  inputs.forEach((input, index) => {
    try { made.push(newTask(input, now, lang)); } catch (error) {
      if (!(error instanceof Problem)) throw error;
      problems.push(`${index + 1}. ‘${(input.title ?? "").trim()}’: ${error.message}`);
    }
  });
  if (problems.length) throw new Problem([say(lang, "아무것도 넣지 않았어요.", "Nothing was added.", "Er is niets toegevoegd."), ...problems].join("\n"));
  const today = dayKey(now);
  const { added, skipped } = folder.update("todos.json", (list) => {
    const added: TodoItem[] = [], skipped: { item: TodoItem; existing: TodoItem }[] = [];
    for (const item of made) {
      const key = `${lower(item.title)}@${dupDay(item, today)}`;
      const existing = [...list, ...added].find((entry) => !entry.isCompleted && `${lower(entry.title)}@${dupDay(entry, today)}` === key);
      if (existing) { skipped.push({ item, existing }); continue; }
      added.push({ ...item });
    }
    list.push(...added);
    return { changed: added.length > 0, result: { added, skipped } };
  });
  logged(ctx, "add_todos", "add", "todos", added.map((item) => ({ file: "todos.json", id: item.id, before: null, after: item as unknown as AiItem })));
  const lines: string[] = [];
  if (added.length) lines.push(say(lang, `할 일 ${added.length}개를 넣었어요.`, `Added ${added.length} ${added.length === 1 ? "task" : "tasks"}.`, `${added.length} ${added.length === 1 ? "taak" : "taken"} toegevoegd.`), ...added.map((item) => taskLine(item, now, lang)));
  if (skipped.length) lines.push(say(lang, "이미 있어서 넣지 않았어요:", "Already there, so not added:", "Staat er al, dus niet toegevoegd:"), ...skipped.map(({ existing }) => taskLine(existing, now, lang)));
  return {
    text: lines.join("\n"),
    data: { added: added.map((item) => taskData(item, now)), skipped: skipped.map(({ item, existing }) => ({ title: item.title, reason: "duplicate", id: existing.id })) },
  };
}

export interface EventInput { title: string; date: string; start?: string; end?: string; allDay?: boolean; days?: number; location?: string }

/** An event's draft from what was given: all day (1–31 days) or timed (a start; an end, else an hour later). */
function eventDraft(input: EventInput, lang: Lang): CalendarDraft {
  const title = readTitle(input.title, lang);
  const date = readDay(input.date, lang);
  const location = input.location?.trim().slice(0, maxTitle);
  if (input.allDay) {
    const days = Math.floor(input.days ?? 1);
    if (!(days >= 1 && days <= maxDays)) throw new Problem(say(lang, `종일 일정은 1–${maxDays}일이에요.`, `An all-day event lasts 1–${maxDays} days.`, `Een afspraak van een hele dag duurt 1–${maxDays} dagen.`));
    return { title, color: "blue", date, allDay: true, days, startMinutes: 540, endMinutes: 600, repeat: "none", ...(location ? { location } : {}) };
  }
  if (!input.start) throw new Problem(say(lang, "시작 시간을 알려 주세요. 하루 종일이면 allDay를 켜 주세요.", "Give a start time, or set allDay for an all-day event.", "Geef een begintijd, of zet allDay aan voor een hele dag."));
  const start = readClock(input.start, lang);
  const end = input.end ? readClock(input.end, lang) : (start + 60) % 1440;
  const draft: CalendarDraft = { title, color: "blue", date, allDay: false, days: 1, startMinutes: start, endMinutes: end, repeat: "none", ...(location ? { location } : {}) };
  const problem = validate(draft, lang);
  if (problem) throw new Problem(problem);
  return draft;
}

function localEventLine(event: LocalEvent, lang: Lang): string {
  const shown = occurrences(event, localDate(event.date)!, localDate(plusDays(event.date, Math.max(1, event.days)))!, lang)[0];
  return shown ? `${dayText(event.date, lang)} ${eventLine(shown, lang).slice(2)}` : `${event.title} · id ${event.id}`;
}

export function addEvent(ctx: Ctx, args: EventInput): Reply {
  const { folder, now, lang } = ctx;
  const draft = eventDraft(args, lang);
  const event = eventFromDraft(draft, newID(), now);
  const { added, existing } = folder.update("events.json", (list): { changed: boolean; result: { added?: LocalEvent; existing?: LocalEvent } } => {
    const from = localDate(draft.date)!, to = localDate(plusDays(draft.date, 1))!;
    const existing = list.find((entry) => lower(entry.title) === lower(draft.title) && occurrences(entry, from, to, lang).some((shown) => dateKey(shown.start) === draft.date));
    if (existing) return { changed: false, result: { added: undefined, existing } };
    list.push({ ...event });
    return { changed: true, result: { added: event, existing: undefined } };
  });
  if (existing) {
    return { text: `${say(lang, "이미 있어서 넣지 않았어요:", "Already there, so not added:", "Staat er al, dus niet toegevoegd:")}\n- ${localEventLine(existing, lang)}`, data: { added: null, skipped: { title: draft.title, reason: "duplicate", id: existing.id } } };
  }
  logged(ctx, "add_event", "add", "events", [{ file: "events.json", id: added!.id, before: null, after: added as unknown as AiItem }]);
  return { text: `${say(lang, "일정을 넣었어요.", "Added the event.", "Afspraak toegevoegd.")}\n- ${localEventLine(added!, lang)}`, data: { added: { ...added } } };
}

export function addMemo(ctx: Ctx, args: { text: string }): Reply {
  const { folder, now, lang } = ctx;
  const text = (args.text ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) throw new Problem(say(lang, "메모가 비어 있어요.", "The memo is empty.", "De notitie is leeg."));
  if (text.length > 4000) throw new Problem(say(lang, "메모는 4,000자까지예요.", "A memo can be at most 4,000 characters.", "Een notitie mag hoogstens 4.000 tekens zijn."));
  const memo: Memo = { ...newMemo(now), text };
  const { added, existing } = folder.update("memos.json", (list): { changed: boolean; result: { added?: Memo; existing?: Memo } } => {
    const existing = list.find((entry) => entry.text.trim() === text);
    if (existing) return { changed: false, result: { added: undefined, existing } };
    list.unshift({ ...memo });
    return { changed: true, result: { added: memo, existing: undefined } };
  });
  if (existing) return { text: `${say(lang, "같은 메모가 이미 있어요.", "The same memo is already there.", "Dezelfde notitie staat er al.")} id ${existing.id}`, data: { added: null, skipped: { reason: "duplicate", id: existing.id } } };
  logged(ctx, "add_memo", "add", "memos", [{ file: "memos.json", id: added!.id, before: null, after: added as unknown as AiItem }]);
  return { text: `${say(lang, "메모를 남겼어요:", "Left a memo:", "Notitie achtergelaten:")} ${memoTitle(added!, lang)} · id ${added!.id}`, data: { added: { ...added } } };
}

// ─── Changing, after a yes ────────────────────────────────────────────────────

export type ChangeSet = Record<string, unknown>;
export interface ChangeInput { kind: "todo" | "event"; id: string; set: ChangeSet }

const todoKeys = ["title", "date", "timeStart", "timeEnd", "remindAt", "later", "done"];
const eventKeys = ["title", "date", "start", "end", "allDay", "days", "location"];

function checkKeys(set: ChangeSet, allowed: readonly string[], lang: Lang): void {
  const keys = Object.keys(set);
  if (keys.length === 0) throw new Problem(say(lang, "바꿀 것이 없어요.", "There is nothing to change.", "Er is niets te wijzigen."));
  const wrong = keys.filter((key) => !allowed.includes(key));
  if (wrong.some((key) => /delete|remove|deleted|trash/i.test(key))) throw new Problem(say(lang, "지우기는 할 수 없어요. 종이냥에서 직접 지워 주세요.", "Deleting isn’t possible. Delete it in 종이냥 itself.", "Verwijderen kan niet. Verwijder het in 종이냥 zelf."));
  if (wrong.length) throw new Problem(say(lang, `바꿀 수 없는 항목이에요: ${wrong.join(", ")} (바꿀 수 있는 것: ${allowed.join(", ")})`, `Can’t change: ${wrong.join(", ")} (can change: ${allowed.join(", ")})`, `Kan niet wijzigen: ${wrong.join(", ")} (wel: ${allowed.join(", ")})`));
}

const str = (value: unknown): string | null | undefined => (value === null ? null : typeof value === "string" ? value : value === undefined ? undefined : String(value));
const bool = (value: unknown, key: string, lang: Lang): boolean => {
  if (typeof value !== "boolean") throw new Problem(say(lang, `${key}: true나 false로 적어 주세요.`, `${key} must be true or false.`, `${key} moet true of false zijn.`));
  return value;
};

/** A task with `set` applied, by the app's own rules (a new range brings its reminder along; see timeRange.ts). */
export function changedTask(item: TodoItem, set: ChangeSet, now: Date, lang: Lang): TodoItem {
  checkKeys(set, todoKeys, lang);
  const today = dayKey(now);
  let next: TodoItem = { ...item };
  const later = set.later === undefined ? undefined : bool(set.later, "later", lang);
  if (later && (set.date || set.timeStart || set.timeEnd)) throw new Problem(say(lang, "언젠가 할 일에는 날짜나 시간을 붙일 수 없어요.", "A someday task can’t have a date or a time.", "Een taak voor ooit kan geen datum of tijd hebben."));
  if (later === true) { next.shelf = "later"; delete next.dueDate; }
  else if (later === false && next.shelf === "later") delete next.shelf;
  if (set.date !== undefined) {
    const date = str(set.date);
    if (!date) { delete next.dueDate; if (next.shelf === "today") delete next.shelf; }
    else {
      const day = readDay(date, lang);
      if (day < today) throw new Problem(say(lang, `이미 지난 날이에요: ${dayText(day, lang)}.`, `${dayText(day, lang)} has already passed.`, `${dayText(day, lang)} is al voorbij.`));
      next.dueDate = day;
      delete next.shelf;
    }
  }
  if (set.timeStart !== undefined || set.timeEnd !== undefined) {
    const start = set.timeStart !== undefined ? str(set.timeStart) : next.timeStart ?? null;
    const end = set.timeEnd !== undefined ? str(set.timeEnd) : start === null ? null : next.timeEnd ?? null;
    const range = readRange(start, end, lang);
    if (range && !rangeDay(next, now)) throw new Problem(say(lang, "언젠가 할 일에는 시간을 정할 수 없어요. 날짜도 같이 정해 주세요.", "A someday task can’t have a time. Give it a date too.", "Een taak voor ooit kan geen tijd hebben. Geef ook een datum."));
    next = withRange(next, range, now);
  }
  if (set.remindAt !== undefined) {
    const value = str(set.remindAt);
    if (!value) { delete next.reminderAt; delete next.reminderLastDeliveredAt; }
    else {
      next.reminderAt = isoDate(readReminder(value, rangeDay(next, now) ?? today, now, lang));
      delete next.reminderLastDeliveredAt;
    }
  }
  if (set.title !== undefined) next.title = readTitle(str(set.title) ?? "", lang);
  if (set.done !== undefined) {
    const done = bool(set.done, "done", lang);
    if (done && !next.isCompleted) { next.isCompleted = true; next.completedAt = isoDate(now); }
    if (!done && next.isCompleted) { next.isCompleted = false; delete next.completedAt; }
  }
  for (const change of todaySinceUpdates([next], now)) { if (change.todaySince) next.todaySince = change.todaySince; else delete next.todaySince; }
  return next;
}

/** A one-off event with `set` applied; repeating ones are never changed here (M12). */
export function changedEvent(event: LocalEvent, set: ChangeSet, now: Date, lang: Lang): LocalEvent {
  if (event.repeat !== "none") throw new Problem(say(lang, "반복 일정은 고칠 수 없어요. 종이냥에서 직접 고쳐 주세요.", "Repeating events can’t be changed here. Change it in 종이냥 itself.", "Herhalende afspraken kunnen hier niet worden gewijzigd. Wijzig het in 종이냥 zelf."));
  checkKeys(set, eventKeys, lang);
  const draft = draftFromEvent(event);
  if (set.title !== undefined) draft.title = readTitle(str(set.title) ?? "", lang);
  if (set.date !== undefined) draft.date = readDay(str(set.date) ?? "", lang);
  if (set.allDay !== undefined) draft.allDay = bool(set.allDay, "allDay", lang);
  if (set.days !== undefined) {
    const days = Number(set.days);
    if (!(Number.isInteger(days) && days >= 1 && days <= maxDays)) throw new Problem(say(lang, `종일 일정은 1–${maxDays}일이에요.`, `An all-day event lasts 1–${maxDays} days.`, `Een afspraak van een hele dag duurt 1–${maxDays} dagen.`));
    draft.days = days;
  }
  if (set.start !== undefined) {
    // The start alone moves the whole event (its length stays).
    const length = (draft.endMinutes - draft.startMinutes + 1440) % 1440 || 60;
    draft.startMinutes = readClock(str(set.start) ?? "", lang);
    if (set.end === undefined) draft.endMinutes = (draft.startMinutes + length) % 1440;
  }
  if (set.end !== undefined) draft.endMinutes = readClock(str(set.end) ?? "", lang);
  if (set.location !== undefined) {
    const location = str(set.location)?.trim().slice(0, maxTitle);
    if (location) draft.location = location; else delete draft.location;
  }
  if (!draft.allDay) draft.days = 1;
  const problem = validate(draft, lang);
  if (problem) throw new Problem(problem);
  return eventFromDraft(draft, event.id, now, event);
}

/** What a person sees of a task, field by field (the preview compares these). */
function taskFields(item: TodoItem, now: Date, lang: Lang): [string, string][] {
  const day = rangeDay(item, now);
  const range = rangeOf(item);
  const none = say(lang, "없음", "none", "geen");
  return [
    [say(lang, "제목", "Title", "Titel"), item.title],
    [say(lang, "날짜", "Day", "Dag"), day ? rangeDayText(day, now, lang) : say(lang, "언젠가", "someday", "ooit")],
    [say(lang, "시간", "Time", "Tijd"), range ? rangeText(range, lang) : none],
    [say(lang, "알림", "Reminder", "Herinnering"), item.reminderAt ? reminderText(new Date(item.reminderAt), day, lang).replace(/^\S+ /, "") : none],
    [say(lang, "상태", "Status", "Status"), item.isCompleted ? say(lang, "끝냄", "done", "klaar") : say(lang, "남음", "open", "open")],
  ];
}

function eventFields(event: LocalEvent, lang: Lang): [string, string][] {
  const time = event.allDay
    ? (event.days > 1 ? `${allDayText(lang)} · ${dayCount(event.days, lang)}` : allDayText(lang))
    : timeRange({ hour: Math.floor(event.start / 60), minute: event.start % 60 }, { hour: Math.floor(event.end / 60), minute: event.end % 60 }, lang);
  return [
    [say(lang, "제목", "Title", "Titel"), event.title],
    [say(lang, "날짜", "Day", "Dag"), dayText(event.date, lang)],
    [say(lang, "시간", "Time", "Tijd"), time],
    [say(lang, "장소", "Place", "Plaats"), event.location ?? say(lang, "없음", "none", "geen")],
  ];
}

function diffLines(before: [string, string][], after: [string, string][]): string[] {
  return before.flatMap(([name, was], index) => (was === after[index][1] ? [] : [`   ${name}: ${was} → ${after[index][1]}`]));
}

interface Pending { at: number; changes: { kind: "todo" | "event"; id: string; set: ChangeSet; before: AiItem }[] }
/** Previews waiting for a yes, by confirmation number (this process only; gone when Claude stops it). */
const pending = new Map<string, Pending>();

function newToken(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let token = "";
  do { token = Array.from({ length: 6 }, () => letters[Math.floor(Math.random() * letters.length)]).join(""); } while (pending.has(token));
  return token;
}

/** An event's id, or an occurrence key ("local/<id>@<day>") from list_events. */
const eventId = (id: string): string => parseOccurrenceKey(id)?.id ?? id;

export function previewChanges(ctx: Ctx, args: { changes: ChangeInput[] }): Reply {
  const { folder, now, lang } = ctx;
  const inputs = args.changes ?? [];
  if (inputs.length === 0) throw new Problem(say(lang, "바꿀 것이 없어요.", "There is nothing to change.", "Er is niets te wijzigen."));
  if (inputs.length > maxItems) throw new Problem(say(lang, `한 번에 ${maxItems}개까지 고칠 수 있어요.`, `At most ${maxItems} changes at a time.`, `Hoogstens ${maxItems} wijzigingen tegelijk.`));
  const todos = inputs.some((input) => input.kind === "todo") ? folder.load("todos.json") : [];
  const events = inputs.some((input) => input.kind === "event") ? folder.load("events.json") : [];
  const problems: string[] = [];
  const lines: string[] = [];
  const accepted: Pending["changes"] = [];
  inputs.forEach((input, index) => {
    try {
      if (input.kind === "todo") {
        const item = todos.find((entry) => entry.id === input.id);
        if (!item) throw new Problem(say(lang, `이 id의 할 일이 없어요: ${input.id}.`, `No task with id ${input.id}.`, `Geen taak met id ${input.id}.`));
        const after = changedTask(item, input.set ?? {}, now, lang);
        const changes = diffLines(taskFields(item, now, lang), taskFields(after, now, lang));
        if (!changes.length) throw new Problem(say(lang, `바뀌는 게 없어요: ‘${item.title}’.`, `Nothing changes for ‘${item.title}’.`, `Er verandert niets aan ‘${item.title}’.`));
        lines.push(`${accepted.length + 1}. ${item.title} · id ${item.id}`, ...changes);
        accepted.push({ kind: "todo", id: item.id, set: input.set, before: item as unknown as AiItem });
      } else {
        const event = events.find((entry) => entry.id === eventId(input.id));
        if (!event) throw new Problem(say(lang, `이 id의 일정이 없어요: ${input.id}.`, `No event with id ${input.id}.`, `Geen afspraak met id ${input.id}.`));
        const after = changedEvent(event, input.set ?? {}, now, lang);
        const changes = diffLines(eventFields(event, lang), eventFields(after, lang));
        if (!changes.length) throw new Problem(say(lang, `바뀌는 게 없어요: ‘${event.title}’.`, `Nothing changes for ‘${event.title}’.`, `Er verandert niets aan ‘${event.title}’.`));
        lines.push(`${accepted.length + 1}. ${event.title} · id ${event.id}`, ...changes);
        accepted.push({ kind: "event", id: event.id, set: input.set, before: event as unknown as AiItem });
      }
    } catch (error) {
      if (!(error instanceof Problem)) throw error;
      problems.push(`${index + 1}. ${error.message}`);
    }
  });
  if (problems.length) throw new Problem([say(lang, "미리보기를 만들지 못했어요. 아무것도 바뀌지 않았어요.", "Couldn’t make the preview. Nothing was changed.", "Kon geen voorbeeld maken. Er is niets gewijzigd."), ...problems].join("\n"));
  const token = newToken();
  pending.set(token, { at: now.getTime(), changes: accepted });
  const head = say(lang, `이렇게 바꿀게요 (확인 번호 ${token}, 10분 동안 쓸 수 있어요):`, `This is what would change (confirmation ${token}, valid for 10 minutes):`, `Dit zou er veranderen (bevestiging ${token}, 10 minuten geldig):`);
  const tail = say(lang,
    "아직 아무것도 바뀌지 않았어요. 사용자에게 이대로 보여 주고 분명히 ‘응’이라고 하면 apply_changes로 적용하세요.",
    "Nothing has changed yet. Show this to the user as it is, and only after a clear yes, apply it with apply_changes.",
    "Er is nog niets gewijzigd. Laat dit zo aan de gebruiker zien en pas het pas na een duidelijk ja toe met apply_changes.");
  return { text: [head, ...lines, "", tail].join("\n"), data: { token, expiresAt: localStamp(new Date(now.getTime() + tokenMs)), changes: accepted.map(({ kind, id }) => ({ kind, id })) } };
}

/** Thrown inside a write when an item is no longer what the preview showed (M10). */
class Changed extends Error {}

export function applyChanges(ctx: Ctx, args: { token: string }): Reply {
  const { folder, now, lang } = ctx;
  const token = (args.token ?? "").trim().toUpperCase();
  const preview = pending.get(token);
  if (!preview) throw new Problem(say(lang, `기다리는 확인 번호가 아니에요: ${token || "(없음)"}. preview_changes로 다시 미리보기해 주세요.`, `No confirmation ${token || "(none)"} is waiting. Preview again with preview_changes.`, `Bevestiging ${token || "(geen)"} is onbekend. Maak opnieuw een voorbeeld met preview_changes.`));
  pending.delete(token);
  if (now.getTime() - preview.at > tokenMs) throw new Problem(say(lang, "확인 번호의 10분이 지나서 적용하지 않았어요. preview_changes로 다시 미리보기해 주세요.", "The confirmation is older than 10 minutes, so nothing was applied. Preview again with preview_changes.", "De bevestiging is ouder dan 10 minuten, dus er is niets toegepast. Maak opnieuw een voorbeeld met preview_changes."));
  const stale = (titles: string[]) => new Problem(say(lang,
    `미리보기 뒤에 바뀐 항목이 있어서 적용하지 않았어요: ${titles.map((title) => `‘${title}’`).join(", ")}. preview_changes로 다시 미리보기해 주세요.`,
    `${titles.map((title) => `‘${title}’`).join(", ")} changed after the preview, so nothing was applied. Preview again with preview_changes.`,
    `${titles.map((title) => `‘${title}’`).join(", ")} is na het voorbeeld gewijzigd, dus er is niets toegepast. Maak opnieuw een voorbeeld met preview_changes.`));
  const todoChanges = preview.changes.filter((change) => change.kind === "todo");
  const eventChanges = preview.changes.filter((change) => change.kind === "event");
  // Every item checked first, so either all of it goes in or none.
  const moved = (file: "todos.json" | "events.json", list: readonly { id: string }[], changes: Pending["changes"]) =>
    changes.filter((change) => !sameSaved(aiTargetOf(file), list.find((item) => item.id === change.id) as Record<string, unknown> | undefined, change.before)).map((change) => String(change.before.title ?? ""));
  const movedNow = [...moved("todos.json", todoChanges.length ? folder.load("todos.json") : [], todoChanges), ...moved("events.json", eventChanges.length ? folder.load("events.json") : [], eventChanges)];
  if (movedNow.length) throw stale(movedNow);
  const lines: string[] = [say(lang, "바꿨어요.", "Changed.", "Gewijzigd.")];
  const write = <K extends "todos.json" | "events.json">(file: K, changes: Pending["changes"], apply: (item: never, set: ChangeSet) => object): AiChange[] => {
    if (!changes.length) return [];
    try {
      return folder.update(file, (list) => {
        const done: AiChange[] = [];
        for (const change of changes) {
          const index = (list as { id: string }[]).findIndex((item) => item.id === change.id);
          const current = list[index] as unknown as AiItem | undefined;
          if (!current || !sameSaved(aiTargetOf(file), current, change.before)) throw new Changed(String(change.before.title ?? ""));
          const after = apply(current as never, change.set) as unknown as AiItem;
          (list as unknown[])[index] = after;
          done.push({ file, id: change.id, before: { ...current }, after: { ...after } });
        }
        return { changed: true, result: done };
      });
    } catch (error) {
      if (error instanceof Changed) throw stale([error.message]);
      throw error;
    }
  };
  const todoDone = write("todos.json", todoChanges, (item: TodoItem, set) => changedTask(item, set, now, lang));
  logged(ctx, "apply_changes", "change", "todos", todoDone);
  const eventDone = write("events.json", eventChanges, (event: LocalEvent, set) => changedEvent(event, set, now, lang));
  logged(ctx, "apply_changes", "change", "events", eventDone);
  for (const change of todoDone) lines.push(taskLine(change.after as unknown as TodoItem, now, lang));
  for (const change of eventDone) lines.push(`- ${localEventLine(change.after as unknown as LocalEvent, lang)}`);
  return { text: lines.join("\n"), data: { changed: [...todoDone, ...eventDone].map((change) => ({ kind: change.file === "todos.json" ? "todo" : "event", id: change.id, after: change.after })) } };
}

