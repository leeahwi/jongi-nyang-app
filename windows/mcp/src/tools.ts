import { aiEntry, aiExtVersion, aiPlacesFile, aiTargetOf, sameSaved, type AiChange, type AiItem, type AiTarget } from "../../src/core/ai";
import { entrySpace, findSpace, moveTodo, spaceOf, type TodoSpaces } from "../../src/core/todoSpaces";
import { dayKey } from "../../src/core/archive";
import { nextFire, timeText as alarmTimeText } from "../../src/core/alarm";
import { allDayText, dateKey, dayBounds, localDate, todayEvents, validate, type CalendarDraft, type CalendarEvent } from "../../src/core/calendar";
import { todaySinceUpdates } from "../../src/core/carry";
import { draftFromEvent, eventFromDraft, expand, occurrences, parseOccurrenceKey, type LocalEvent } from "../../src/core/events";
import { focusByTask, focusTime, focusTotal, focusTotals, sessionsText } from "../../src/core/focus";
import { days as dayCount, timeRange, type Lang } from "../../src/core/lang";
import { cleanedTitle, isoDate, newID, type TodoItem } from "../../src/core/notebook";
import { describe as describeRepeat, nextOccurrence } from "../../src/core/repeat";
import { pageOf } from "../../src/core/shelf";
import { toEntry, type ArchiveEntry } from "../../src/core/archive";
import { clockKey, clockMinutes, logicalMinutes, rangeDay, rangeDayText, rangeOf, rangeText, validRange, withRange, type TimeRange } from "../../src/core/timeRange";
import { Folder } from "./files";
import { Ids } from "./ids";
import { page, pageNote, type PageArgs } from "./pages";
import { Problem } from "./problem";
import type { DeviceRules } from "../../src/core/spaceDevice";
import { addedHiddenLine, generalKey, hiddenHere, hiddenNote, movesFromExt, oldAppProblem, readSpace, spaceName, spacesNow, taskSpace, type SpaceWords } from "./spaces";
import { dayText, localStamp, reminderText, say, taskData, taskLine, words, type TaskWords } from "./words";

export { Problem } from "./problem";

/**
 * The tools themselves, apart from MCP: each takes what the call gave and answers with a short text in the
 * app's language and the same as data (its shape: schemas.ts). Rules from the shared AI connection spec §4–5
 * (cases M3–M12; the newer cases M19–M41 are in mcp/test). The memo drawer's tools are in memos.ts.
 */

export interface Ctx {
  folder: Folder; lang: Lang; now: Date; client: string;
  /** The extension version the app carries (ai-link.json's ext; 1 for apps before it). */
  appExt: number;
  /** N3-9: this device's 이 기기에서 (ai-link.json's spaceDevice; none from apps before ext 4: nothing hidden). */
  device: DeviceRules;
}
/** A link to a resource put after the text (C2-2: each memo shown, as jongi-nyang://memo/<id>). */
export interface ResourceLink { uri: string; name: string; mimeType: string }
export interface Reply { text: string; data: Record<string, unknown>; links?: ResourceLink[] }

export const maxItems = 20;
const maxTitle = 200;
const maxDays = 31;
/** How long a preview's confirmation number can be used. */
export const tokenMs = 10 * 60_000;
/** A to-do's end stops at 03:45 the next morning (an end at 04:00 isn't kept on a to-do; ribbon-cases R6). */
const lastEnd = 1665;
/** Pages (P1): how many by default and at most. */
export const pages = { todos: [50, 100], events: [50, 100], history: [50, 200], repeats: [50, 100], today: [30, 100] } as const;

// ─── Reading what was given ───────────────────────────────────────────────────

export function readDay(value: string, lang: Lang): string {
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
export const plusDays = (day: string, count: number): string => { const date = noon(day); date.setDate(date.getDate() + count); return dateKey(date); };
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

export const lower = (text: string) => text.trim().toLowerCase();

// ─── Ids ──────────────────────────────────────────────────────────────────────

export type Noun = "todo" | "event" | "memo" | "folder";
const nounKo: Record<Noun, string> = { todo: "할 일이", event: "일정이", memo: "메모가", folder: "메모 폴더가" };
const nounEn: Record<Noun, string> = { todo: "task", event: "event", memo: "memo", folder: "memo folder" };
const nounNl: Record<Noun, string> = { todo: "taak", event: "afspraak", memo: "notitie", folder: "notitiemap" };

/**
 * The whole id a given id names (P1: the whole id, or a start of 8 characters or more that fits one item).
 * One that fits several is refused with the candidates (M40), one that fits none says so.
 */
export function pick(ids: Ids, given: string, lang: Lang, noun: Noun, titleOf: (id: string) => string): string {
  const found = ids.find(given);
  if (found && "id" in found) return found.id;
  if (found) {
    const list = found.candidates.slice(0, 10).map((id) => `${ids.short(id)} ‘${titleOf(id)}’`).join(", ");
    throw new Problem(say(lang,
      `id ‘${given}’로 시작하는 ${nounKo[noun]} 여럿이에요: ${list}. 더 긴 id를 써 주세요.`,
      `More than one ${nounEn[noun]} starts with id ‘${given}’: ${list}. Use a longer id.`,
      `Meer dan één ${nounNl[noun]} begint met id ‘${given}’: ${list}. Gebruik een langere id.`));
  }
  throw new Problem(say(lang, `이 id의 ${nounKo[noun]} 없어요: ${given}.`, `No ${nounEn[noun]} with id ${given}.`, `Geen ${nounNl[noun]} met id ${given}.`));
}

/** Each repeating task's words ("매주 월") by series id; repeats.json that doesn't read: none. */
export function repeatWords(folder: Folder, lang: Lang): Map<string, string> {
  return new Map(folder.loadLoose("repeats.json").map((series) => [series.id, describeRepeat(series.rule, undefined, lang)]));
}

export const taskWordsOf = (ctx: Ctx, items: readonly TodoItem[], spaces: SpaceWords = spacesNow(ctx)): TaskWords => ({ ids: new Ids(items.map((item) => item.id)), repeats: repeatWords(ctx.folder, ctx.lang), spaces });

/** N3-2: the tasks in the space `given` names (none given: all of them); the space's id (null: 일반) for the reply. */
function inSpace<T extends { id: string }>(items: readonly T[], given: string | undefined, spaces: SpaceWords, lang: Lang, of: (item: T) => string | undefined = (item) => spaceOf(spaces.data, item.id)): { items: T[]; space?: string } {
  if (given === undefined || !given.trim()) return { items: [...items] };
  const wanted = readSpace(given, spaces, lang);
  return { items: items.filter((item) => (of(item) ?? null) === wanted), space: wanted ?? generalKey };
}

/**
 * N3-9 (#196): the to-dos as the note shows them on this device — with `leave` (no space picked, no word searched) the
 * ones whose space this device hides now are left out, and `note` is the end line's words and counts of the open ones
 * left out (D9). Picked by space or found by a word they stay, marked hidden (as 찾기 shows them).
 */
export function leaveHidden<T extends TodoItem>(items: readonly T[], leave: boolean, spaces: SpaceWords, lang: Lang): { sheet: T[]; note: ReturnType<typeof hiddenNote> } {
  if (!leave || spaces.hidden.size === 0) return { sheet: [...items], note: { data: [] } };
  const sheet: T[] = [], left: T[] = [];
  for (const item of items) (hiddenHere(spaces, item.id) ? left : sheet).push(item);
  return { sheet, note: hiddenNote(left.filter((item) => !item.isCompleted), spaces, lang) };
}

// ─── Reading tools ────────────────────────────────────────────────────────────

/** Open tasks of today's sheet first by their time, then the others in the list's order. */
const byTime = (items: readonly TodoItem[], now: Date): TodoItem[] => {
  const order = (item: TodoItem) => { const range = rangeOf(item); return range ? logicalMinutes(range.start) : Number.MAX_SAFE_INTEGER; };
  const day = (item: TodoItem) => rangeDay(item, now) ?? "9999";
  return [...items].sort((a, b) => (day(a) < day(b) ? -1 : day(a) > day(b) ? 1 : order(a) - order(b)));
};

const none = (lang: Lang) => say(lang, "- 없음", "- none", "- geen");

export function eventLine(event: CalendarEvent, lang: Lang, ids: Ids): string {
  const days = event.allDay ? Math.round((event.end.getTime() - event.start.getTime()) / 86_400_000) : 1;
  const when = event.allDay ? (days > 1 ? `${allDayText(lang)} · ${dayCount(days, lang)}` : allDayText(lang)) : timeRange({ hour: event.start.getHours(), minute: event.start.getMinutes() }, { hour: event.end.getHours(), minute: event.end.getMinutes() }, lang);
  return [`- ${when} ${event.title}`, ...(event.location ? [event.location] : []), ...(event.recurring ? [say(lang, "반복", "repeats", "herhaalt")] : []), `id ${ids.short(event.eventId)}`].join(" · ");
}

/** An event as the structured result gives it (eventOut in schemas.ts). */
function eventData(event: CalendarEvent, source: LocalEvent | undefined, ids: Ids): Record<string, unknown> {
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return {
    id: ids.short(event.eventId), title: event.title, date: dateKey(event.start), allDay: event.allDay,
    ...(event.allDay ? { days: source?.days ?? 1 } : { start: clock(event.start), end: clock(event.end), ...(dateKey(event.end) !== dateKey(event.start) ? { endDate: dateKey(event.end) } : {}) }),
    ...(event.location ? { location: event.location } : {}), repeat: source?.repeat ?? "none", canChange: !event.recurring,
  };
}

/** The events of a file by id, and their short ids. */
export const eventIndex = (events: readonly LocalEvent[]) => ({ byId: new Map(events.map((event) => [event.id, event])), ids: new Ids(events.map((event) => event.id)) });

export function getToday(ctx: Ctx, args: { limit?: number; detail?: boolean; space?: string } = {}): Reply {
  const { folder, now, lang } = ctx;
  const today = dayKey(now);
  const items = folder.load("todos.json");
  const events = folder.load("events.json");
  const spaces = spacesNow(ctx);
  const words = taskWordsOf(ctx, items, spaces);
  // N3-2: a space filters the tasks and their counts only (events, alarms and focus have no space).
  const filtered = inSpace(items.filter((item) => pageOf(item, now) === "today"), args.space, spaces, lang);
  // N3-9: without a space, what this device hides is left out as on the note (counts too), and the end says so.
  const { sheet, note } = leaveHidden(filtered.items, filtered.space === undefined, spaces, lang);
  const open = byTime(sheet.filter((item) => !item.isCompleted), now);
  const done = byTime(sheet.filter((item) => item.isCompleted && item.completedAt !== undefined && dayKey(new Date(item.completedAt)) === today), now);
  // Today's sheet isn't cut by default; a very long one gives its first tasks and the cursor list_todos goes on with (P1).
  const shown = page(open, { limit: args.limit }, pages.today[0], pages.today[1], lang);
  const { start, end } = dayBounds(now);
  const index = eventIndex(events);
  const happening = todayEvents(expand(events, start, end, lang), now);
  const alarms = folder.alarms().map((alarm) => ({ alarm, at: nextFire(alarm, now) })).filter((entry) => entry.at && entry.at < end)
    .sort((a, b) => a.at!.getTime() - b.at!.getTime());
  const focus = focusTotal(folder.focus(), now, now);
  const more = shown.next ? open.length - Number(shown.next) : 0;
  const lines = [
    `${say(lang, "오늘", "Today", "Vandaag")} · ${dayText(today, lang)}${filtered.space ? ` · ${say(lang, "스페이스", "space", "ruimte")} ${spaceName(spaces, filtered.space === generalKey ? null : filtered.space)}` : ""}`,
    "",
    `${say(lang, "할 일", "Tasks", "Taken")} (${say(lang, `남은 것 ${open.length}개, 끝낸 것 ${done.length}개`, `${open.length} open, ${done.length} done`, `${open.length} open, ${done.length} klaar`)})`,
    ...(open.length || (args.detail && done.length) ? shown.shown.map((item) => taskLine(item, now, lang, words)) : [none(lang)]),
    ...(shown.next ? [say(lang, `… ${more}개 더: list_todos(where today) cursor ‘${shown.next}’`, `… ${more} more: list_todos (where today) with cursor ‘${shown.next}’`, `… nog ${more}: list_todos (where today) met cursor ‘${shown.next}’`)] : []),
    ...(args.detail ? done.slice(0, pages.today[1]).map((item) => taskLine(item, now, lang, words)) : []),
    ...(note.line ? [note.line] : []),
    "",
    `${say(lang, "일정", "Events", "Afspraken")} (${happening.length})`,
    ...(happening.length ? happening.map((event) => eventLine(event, lang, index.ids)) : [none(lang)]),
    ...(alarms.length ? ["", say(lang, "알람", "Alarms", "Wekkers"), ...alarms.map(({ alarm }) => `- ${alarmTimeText(alarm, lang)}${alarm.label ? ` ${alarm.label}` : ""}`)] : []),
    "",
    `${say(lang, "집중", "Focus", "Focus")} ${focusTime(focus.minutes, lang)} · ${sessionsText(focus.sessions, lang)}`,
  ];
  return {
    text: lines.join("\n"),
    data: {
      date: today, ...(filtered.space ? { space: filtered.space } : {}), open: open.length, done: done.length,
      tasks: [...shown.shown, ...(args.detail ? done.slice(0, pages.today[1]) : [])].map((item) => taskData(item, now, words)),
      ...(shown.next ? { nextCursor: shown.next } : {}),
      ...(note.data.length ? { hiddenHere: note.data } : {}),
      events: happening.map((event) => eventData(event, index.byId.get(event.eventId), index.ids)),
      alarms: alarms.map(({ alarm, at }) => ({ time: alarm.time, ...(alarm.label ? { label: alarm.label } : {}), at: localStamp(at!) })),
      focus: { minutes: focus.minutes, sessions: focus.sessions },
    },
  };
}

export type TodoWhere = "today" | "later" | "all";

export function listTodos(ctx: Ctx, args: { where?: TodoWhere; from?: string; to?: string; query?: string; space?: string } & PageArgs = {}): Reply {
  const { folder, now, lang } = ctx;
  const query = lower(args.query ?? "");
  // Today's sheet unless asked otherwise (P1); a word looks through everything (N1).
  const where = args.where ?? (query ? "all" : "today");
  const today = dayKey(now);
  const period = args.from || args.to ? readPeriod(args.from, args.to, today, 366, lang) : undefined;
  const all = folder.load("todos.json");
  const items = all.filter((item) => {
    const page = pageOf(item, now);
    if (item.isCompleted && !(where === "all" && item.completedAt && dayKey(new Date(item.completedAt)) === today)) return false;
    if (where === "today" && page !== "today") return false;
    if (where === "later" && page === "today") return false;
    if (query && !item.title.toLowerCase().includes(query)) return false;
    if (!period) return true;
    const day = rangeDay(item, now);
    return day !== undefined && day >= period.from && day <= period.to;
  });
  const spaces = spacesNow(ctx);
  const filtered = inSpace(items, args.space, spaces, lang);
  // N3-9: as the note, unless a space was picked or a word searched (then as 찾기: shown, marked hidden).
  const { sheet, note: hidden } = leaveHidden(filtered.items, filtered.space === undefined && !query, spaces, lang);
  const sorted = byTime(sheet, now);
  const shown = page(sorted, args, pages.todos[0], pages.todos[1], lang);
  const words = taskWordsOf(ctx, all, spaces);
  const heading = say(lang, `할 일 ${sorted.length}개`, `${sorted.length} ${sorted.length === 1 ? "task" : "tasks"}`, `${sorted.length} ${sorted.length === 1 ? "taak" : "taken"}`);
  const note = pageNote(shown, lang);
  return {
    text: [heading, ...shown.shown.map((item) => taskLine(item, now, lang, words)), ...(note ? [note] : []), ...(hidden.line ? [hidden.line] : [])].join("\n"),
    data: {
      where, ...(period ?? {}), ...(query ? { query: args.query!.trim() } : {}), ...(filtered.space ? { space: filtered.space } : {}), count: sorted.length,
      tasks: shown.shown.map((item) => taskData(item, now, words)), ...(shown.next ? { nextCursor: shown.next } : {}), ...(hidden.data.length ? { hiddenHere: hidden.data } : {}),
    },
  };
}

export function listEvents(ctx: Ctx, args: { from: string; to?: string } & PageArgs): Reply {
  const { folder, now, lang } = ctx;
  const period = readPeriod(args.from, args.to, dayKey(now), maxDays, lang);
  const events = folder.load("events.json");
  const index = eventIndex(events);
  const all = expand(events, localDate(period.from)!, localDate(plusDays(period.to, 1))!, lang);
  const shown = page(all, args, pages.events[0], pages.events[1], lang);
  const lines: string[] = [say(lang, `일정 ${all.length}개`, `${all.length} ${all.length === 1 ? "event" : "events"}`, `${all.length} ${all.length === 1 ? "afspraak" : "afspraken"}`)];
  let day = "";
  for (const event of shown.shown) {
    const key = dateKey(event.start) < period.from ? period.from : dateKey(event.start);
    if (key !== day) { day = key; lines.push("", dayText(day, lang)); }
    lines.push(eventLine(event, lang, index.ids));
  }
  const note = pageNote(shown, lang);
  if (note) lines.push("", note);
  return { text: lines.join("\n"), data: { ...period, count: all.length, events: shown.shown.map((event) => eventData(event, index.byId.get(event.eventId), index.ids)), ...(shown.next ? { nextCursor: shown.next } : {}) } };
}

export function getFocus({ folder, now, lang }: Ctx, args: { from?: string; to?: string } = {}): Reply {
  const period = readPeriod(args.from, args.to, dayKey(now), 366, lang);
  const records = folder.focus();
  const [from, to] = [noon(period.from), noon(period.to)];
  const total = focusTotal(records, from, to);
  const top = focusByTask(records, from, to, 5).map(({ title, minutes, sessions }) => ({ title, minutes, sessions }));
  const when = period.from === period.to ? dayText(period.from, lang) : `${dayText(period.from, lang)} – ${dayText(period.to, lang)}`;
  const lines = [
    `${say(lang, "집중", "Focus", "Focus")} ${focusTime(total.minutes, lang)} · ${sessionsText(total.sessions, lang)} (${when})`,
    ...(top.length ? [say(lang, "가장 오래 집중한 일", "Longest focus", "Langst gefocust op"), ...top.map((task) => `- ${task.title} · ${focusTime(task.minutes, lang)} · ${sessionsText(task.sessions, lang)}`)] : []),
  ];
  return { text: lines.join("\n"), data: { ...period, minutes: total.minutes, sessions: total.sessions, days: Object.fromEntries(focusTotals(records, from, to)), top } };
}

export function searchHistory(ctx: Ctx, args: { query?: string; from?: string; to?: string; space?: string } & PageArgs = {}): Reply {
  const { folder, now, lang } = ctx;
  const period = args.from || args.to ? readPeriod(args.from, args.to, dayKey(now), 3660, lang) : undefined;
  const query = lower(args.query ?? "");
  const found = new Map<string, ArchiveEntry>();
  // Only the months the period can touch are read (P2).
  for (const entry of folder.archive(folder.archiveMonths(period?.from, period?.to))) found.set(entry.id, entry);
  for (const item of folder.load("todos.json")) if (item.isCompleted) found.set(item.id, toEntry(item));
  // N3-2 · C5: a line's space is its own (while live), else the to-do's place, else 일반.
  const spaces = spacesNow(ctx);
  const lineSpace = (entry: ArchiveEntry) => entrySpace(spaces.data, entry.id, entry.space);
  const filtered = inSpace([...found.values()], args.space, spaces, lang, lineSpace);
  const entries = filtered.items.filter((entry) => {
    if (!entry.completedAt || (query && !entry.title.toLowerCase().includes(query))) return false;
    const day = dayKey(new Date(entry.completedAt));
    return !period || (day >= period.from && day <= period.to);
  }).sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));
  const shown = page(entries, args, pages.history[0], pages.history[1], lang);
  const ids = new Ids(found.keys());
  const lines = [say(lang, `끝낸 일 ${entries.length}개`, `${entries.length} done`, `${entries.length} afgerond`)];
  let day = "";
  for (const entry of shown.shown) {
    const key = dayKey(new Date(entry.completedAt!));
    if (key !== day) { day = key; lines.push(dayText(day, lang)); }
    const range = entry.timeStart ? rangeOf(entry) : undefined;
    const space = spaces.any && !filtered.space ? lineSpace(entry) : undefined;
    lines.push(`- ${entry.title}${range ? ` (${rangeText(range, lang)})` : ""}${space ? ` · ${say(lang, "스페이스", "space", "ruimte")} ${spaceName(spaces, space)}` : ""}`);
  }
  const note = pageNote(shown, lang);
  if (note) lines.push(note);
  return {
    text: lines.join("\n"),
    data: {
      ...(period ?? {}), ...(filtered.space ? { space: filtered.space } : {}), count: entries.length,
      items: shown.shown.map((entry) => {
        const space = lineSpace(entry);
        return {
          id: ids.short(entry.id), title: entry.title, day: dayKey(new Date(entry.completedAt!)), completedAt: localStamp(new Date(entry.completedAt!)), ...(entry.timeStart ? { timeStart: entry.timeStart } : {}), ...(entry.timeEnd ? { timeEnd: entry.timeEnd } : {}),
          space: spaceName(spaces, space ?? null), spaceId: space ?? generalKey,
        };
      }),
      ...(shown.next ? { nextCursor: shown.next } : {}),
    },
  };
}

/**
 * N1: the repeating tasks (repeats.json) — each rule in the app's words, its reminder, the next day it
 * falls on, and today's open copy when there is one. Rules aren't changed here; a copy on the list is a
 * task like any other (its day only, through preview_changes).
 */
export function listRepeats(ctx: Ctx, args: PageArgs = {}): Reply {
  const { folder, now, lang } = ctx;
  const today = dayKey(now);
  const series = folder.load("repeats.json");
  const items = folder.loadLoose("todos.json");
  const taskIds = new Ids(items.map((item) => item.id));
  const ids = new Ids(series.map((entry) => entry.id));
  const rows = series.map((entry) => {
    // Today's copy already placed: the next is from tomorrow on.
    const from = entry.lastPlaced === today ? atOn(plusDays(today, 1), 12 * 60) : now;
    const next = nextOccurrence(entry.rule, from);
    const open = items.find((item) => item.seriesID === entry.id && !item.isCompleted);
    return { entry, next: next ? dateKey(next) : undefined, open };
  }).sort((a, b) => (a.next ?? "9999").localeCompare(b.next ?? "9999") || a.entry.title.localeCompare(b.entry.title));
  const shown = page(rows, args, pages.repeats[0], pages.repeats[1], lang);
  const lines = [say(lang, `반복 할 일 ${rows.length}개`, `${rows.length} repeating ${rows.length === 1 ? "task" : "tasks"}`, `${rows.length} herhalende ${rows.length === 1 ? "taak" : "taken"}`),
    ...shown.shown.map(({ entry, next, open }) => [
      `- ${entry.title}`, describeRepeat(entry.rule, entry.remindAt, lang),
      ...(next ? [`${say(lang, "다음", "next", "volgende")} ${next === today ? say(lang, "오늘", "today", "vandaag") : dayText(next, lang)}`] : []),
      ...(open ? [`${say(lang, "목록에 있음", "on the list", "op de lijst")} id ${taskIds.short(open.id)}`] : []),
      `id ${ids.short(entry.id)}`,
    ].join(" · "))];
  const note = pageNote(shown, lang);
  if (note) lines.push(note);
  return {
    text: lines.join("\n"),
    data: {
      count: rows.length,
      repeats: shown.shown.map(({ entry, next, open }) => ({
        id: ids.short(entry.id), title: entry.title, rule: describeRepeat(entry.rule, undefined, lang), kind: entry.rule.kind,
        ...(entry.rule.kind === "weekly" ? { weekdays: [...(entry.rule.weekdays ?? [])] } : {}), ...(entry.rule.kind === "monthly" ? { monthDay: entry.rule.monthDay ?? 1 } : {}),
        ...(entry.remindAt ? { remindAt: entry.remindAt } : {}), ...(next ? { next } : {}), ...(open ? { task: taskIds.short(open.id) } : {}),
      })),
      ...(shown.next ? { nextCursor: shown.next } : {}),
    },
  };
}

// ─── Adding ───────────────────────────────────────────────────────────────────

export interface TodoInput { title: string; date?: string; timeStart?: string; timeEnd?: string; remindAt?: string | null; later?: boolean; space?: string }

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

/**
 * One line in ai-log.jsonl for what was added or changed, with this extension's version (I1). A to-do with two changes
 * (its fields and its place, N3-6) is one item: `count` is the items, `title` the first one's.
 */
export function logged(ctx: Ctx, tool: string, kind: "add" | "change", target: AiTarget, changes: AiChange[], named?: { title: string; count: number }): void {
  if (changes.length === 0) return;
  const title = named?.title ?? String((changes[0].after ?? changes[0].before)?.[target === "memos" ? "text" : "title"] ?? "");
  ctx.folder.log({ ...aiEntry({ client: ctx.client, tool, kind, target, title: target === "memos" ? title.split("\n")[0].trim() : title, changes, ...(named ? { count: named.count } : {}) }, ctx.now), ext: aiExtVersion });
}

/** A place as the log keeps it (N3-6): `{id, space, at}` from the file, `{id, space: null}` for a to-do that had none. */
function placeOf(data: TodoSpaces, id: string): AiItem {
  const place = data.items[id];
  return place ? { id, space: place.space, at: place.at } : { id, space: null };
}

export function addTodos(ctx: Ctx, args: { items: TodoInput[] }): Reply {
  const { folder, now, lang } = ctx;
  const inputs = args.items ?? [];
  if (inputs.length === 0) throw new Problem(say(lang, "넣을 할 일이 없어요.", "There are no tasks to add.", "Er zijn geen taken om toe te voegen."));
  if (inputs.length > maxItems) throw new Problem(say(lang, `한 번에 ${maxItems}개까지 넣을 수 있어요. 나눠서 넣어 주세요.`, `At most ${maxItems} tasks at a time. Add them in parts.`, `Hoogstens ${maxItems} taken tegelijk. Voeg ze in delen toe.`));
  const made: TodoItem[] = [];
  const problems: string[] = [];
  // N3-4 (M25): each one's space, read before anything is written; one that isn't there stops them all.
  const spaces = spacesNow(ctx);
  const placed = new Map<string, string>();
  inputs.forEach((input, index) => {
    try {
      const space = input.space !== undefined && input.space.trim() ? readSpace(input.space, spaces, lang) : null;
      const item = newTask(input, now, lang);
      made.push(item);
      if (space) placed.set(item.id, space);
    } catch (error) {
      if (!(error instanceof Problem)) throw error;
      problems.push(`${index + 1}. ‘${(input.title ?? "").trim()}’: ${error.message}`);
    }
  });
  if (problems.length) throw new Problem([say(lang, "아무것도 넣지 않았어요.", "Nothing was added.", "Er is niets toegevoegd."), ...problems].join("\n"));
  const today = dayKey(now);
  // With a space: todos.json and todo-spaces.json in one hold of the lock, all or nothing (#110).
  const files = placed.size ? (["todos.json", "todo-spaces.json"] as const) : (["todos.json"] as const);
  const { added, skipped, all, places } = folder.updateAll([...files], (lists) => {
    const list = lists["todos.json"]!;
    let data = lists["todo-spaces.json"];
    const added: TodoItem[] = [], skipped: { item: TodoItem; existing: TodoItem }[] = [];
    const places = new Map<string, { before: AiItem; after: AiItem }>();
    for (const item of made) {
      const key = `${lower(item.title)}@${dupDay(item, today)}`;
      const existing = [...list, ...added].find((entry) => !entry.isCompleted && `${lower(entry.title)}@${dupDay(entry, today)}` === key);
      if (existing) { skipped.push({ item, existing }); continue; }
      added.push({ ...item });
      const space = placed.get(item.id);
      if (space && data) {
        // Deleted in the app since the call was read: nothing goes in.
        if (!findSpace(data, space)) throw new Problem(say(lang, "그새 종이냥에서 스페이스가 바뀌었어요. 아무것도 넣지 않았어요. list_spaces로 다시 봐 주세요.", "The spaces changed in 종이냥 meanwhile. Nothing was added; look again with list_spaces.", "De ruimtes zijn intussen in 종이냥 gewijzigd. Er is niets toegevoegd; kijk opnieuw met list_spaces."));
        const before = placeOf(data, item.id);
        data = moveTodo(data, item.id, space, now);
        places.set(item.id, { before, after: placeOf(data, item.id) });
      }
    }
    list.push(...added);
    if (data) lists["todo-spaces.json"] = data;
    return { changed: added.length > 0, result: { added, skipped, all: [...list], places } };
  });
  logged(ctx, "add_todos", "add", "todos", added.flatMap((item): AiChange[] => {
    const place = places.get(item.id);
    return [{ file: "todos.json", id: item.id, before: null, after: item as unknown as AiItem }, ...(place ? [{ file: aiPlacesFile, id: item.id, before: place.before, after: place.after }] : [])];
  }), added.length ? { title: added[0].title, count: added.length } : undefined);
  const words = taskWordsOf(ctx, all);
  const lines: string[] = [];
  if (added.length) lines.push(say(lang, `할 일 ${added.length}개를 넣었어요.`, `Added ${added.length} ${added.length === 1 ? "task" : "tasks"}.`, `${added.length} ${added.length === 1 ? "taak" : "taken"} toegevoegd.`), ...added.map((item) => taskLine(item, now, lang, words)));
  // N3-9 (D12): put where this device hides it — it goes in, and the reply says it won't show here.
  const hiddenWords = [...new Set(added.flatMap((item) => (hiddenHere(words.spaces, item.id) ? [addedHiddenLine(spaceOf(words.spaces!.data, item.id) ?? null, words.spaces!, lang)!] : [])))];
  lines.push(...hiddenWords.map((line) => `(${line})`));
  if (skipped.length) lines.push(say(lang, "이미 있어서 넣지 않았어요:", "Already there, so not added:", "Staat er al, dus niet toegevoegd:"), ...skipped.map(({ existing }) => taskLine(existing, now, lang, words)));
  return {
    text: lines.join("\n"),
    data: { added: added.map((item) => taskData(item, now, words)), skipped: skipped.map(({ item, existing }) => ({ title: item.title, reason: "duplicate", id: words.ids.short(existing.id) })) },
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

/** An event's first occurrence (what a line and the data show of an event just added or changed). */
const firstOf = (event: LocalEvent, lang: Lang): CalendarEvent | undefined =>
  occurrences(event, localDate(event.date)!, localDate(plusDays(event.date, Math.max(1, event.days)))!, lang)[0];

function localEventLine(event: LocalEvent, lang: Lang, ids: Ids): string {
  const shown = firstOf(event, lang);
  return shown ? `${dayText(event.date, lang)} ${eventLine(shown, lang, ids).slice(2)}` : `${event.title} · id ${ids.short(event.id)}`;
}

function localEventData(event: LocalEvent, lang: Lang, ids: Ids): Record<string, unknown> {
  const shown = firstOf(event, lang);
  return shown ? eventData(shown, event, ids) : { id: ids.short(event.id), title: event.title, date: event.date, allDay: event.allDay, repeat: event.repeat, canChange: event.repeat === "none" };
}

export function addEvent(ctx: Ctx, args: EventInput): Reply {
  const { folder, now, lang } = ctx;
  const draft = eventDraft(args, lang);
  const event = eventFromDraft(draft, newID(), now);
  const { added, existing, all } = folder.update("events.json", (list): { changed: boolean; result: { added?: LocalEvent; existing?: LocalEvent; all: LocalEvent[] } } => {
    const from = localDate(draft.date)!, to = localDate(plusDays(draft.date, 1))!;
    const existing = list.find((entry) => lower(entry.title) === lower(draft.title) && occurrences(entry, from, to, lang).some((shown) => dateKey(shown.start) === draft.date));
    if (existing) return { changed: false, result: { added: undefined, existing, all: list } };
    list.push({ ...event });
    return { changed: true, result: { added: event, existing: undefined, all: [...list] } };
  });
  const ids = new Ids(all.map((entry) => entry.id));
  if (existing) {
    return { text: `${say(lang, "이미 있어서 넣지 않았어요:", "Already there, so not added:", "Staat er al, dus niet toegevoegd:")}\n- ${localEventLine(existing, lang, ids)}`, data: { added: null, skipped: { title: draft.title, reason: "duplicate", id: ids.short(existing.id) } } };
  }
  logged(ctx, "add_event", "add", "events", [{ file: "events.json", id: added!.id, before: null, after: added as unknown as AiItem }]);
  return { text: `${say(lang, "일정을 넣었어요.", "Added the event.", "Afspraak toegevoegd.")}\n- ${localEventLine(added!, lang, ids)}`, data: { added: localEventData(added!, lang, ids) } };
}

// ─── Changing, after a yes ────────────────────────────────────────────────────

export type ChangeSet = Record<string, unknown>;
export interface ChangeInput { kind: "todo" | "event"; id: string; set: ChangeSet }

/** The fields a change may set (the input schema says the same per kind, C3; this stays as the tools' own check). */
export const todoKeys = ["title", "date", "timeStart", "timeEnd", "remindAt", "later", "done", "space"] as const;
export const eventKeys = ["title", "date", "start", "end", "allDay", "days", "location"] as const;

function checkKeys(set: ChangeSet, allowed: readonly string[], lang: Lang): void {
  const keys = Object.keys(set).filter((key) => set[key] !== undefined);
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
  // The space is todo-spaces.json's (N3-5), not the task's.
  if (Object.keys(set).every((key) => key === "space" || set[key] === undefined)) return item;
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
  const nothing = say(lang, "없음", "none", "geen");
  return [
    [say(lang, "제목", "Title", "Titel"), item.title],
    [say(lang, "날짜", "Day", "Dag"), day ? rangeDayText(day, now, lang) : say(lang, "언젠가", "someday", "ooit")],
    [say(lang, "시간", "Time", "Tijd"), range ? rangeText(range, lang) : nothing],
    [say(lang, "알림", "Reminder", "Herinnering"), item.reminderAt ? reminderText(new Date(item.reminderAt), day, lang).replace(/^\S+ /, "") : nothing],
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

/** A to-do's move (N3-5): to `space` (null: 일반), from where it was at the preview. */
interface Move { space: string | null; from: string | null }
interface Pending { at: number; changes: { kind: "todo" | "event"; id: string; set: ChangeSet; before: AiItem; move?: Move }[] }

/** `set` without `space` (the task's own fields). */
const fieldsOf = (set: ChangeSet): ChangeSet => Object.fromEntries(Object.entries(set).filter(([key]) => key !== "space"));
/** Previews waiting for a yes, by confirmation number (this process only; gone when Claude stops it). */
const pending = new Map<string, Pending>();

function newToken(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let token = "";
  do { token = Array.from({ length: 6 }, () => letters[Math.floor(Math.random() * letters.length)]).join(""); } while (pending.has(token));
  return token;
}

/** An event's id as given: its id (whole or short), or an occurrence key ("local/<id>@<day>", "<id>@<day>"). */
const eventId = (id: string): string => parseOccurrenceKey(id.trim())?.id ?? id.trim().replace(/@\d{4}-\d{2}-\d{2}$/, "");

/** The fields actually given (a schema's absent optional keys can come through as undefined). */
const given = (set: ChangeSet | undefined): ChangeSet => Object.fromEntries(Object.entries(set ?? {}).filter(([, value]) => value !== undefined));

export function previewChanges(ctx: Ctx, args: { changes: ChangeInput[] }): Reply {
  const { folder, now, lang } = ctx;
  const inputs = args.changes ?? [];
  if (inputs.length === 0) throw new Problem(say(lang, "바꿀 것이 없어요.", "There is nothing to change.", "Er is niets te wijzigen."));
  if (inputs.length > maxItems) throw new Problem(say(lang, `한 번에 ${maxItems}개까지 고칠 수 있어요.`, `At most ${maxItems} changes at a time.`, `Hoogstens ${maxItems} wijzigingen tegelijk.`));
  const todos = inputs.some((input) => input.kind === "todo") ? folder.load("todos.json") : [];
  const spaces = spacesNow(ctx);
  const events = inputs.some((input) => input.kind === "event") ? folder.load("events.json") : [];
  const todoIds = new Ids(todos.map((item) => item.id)), eventIds = new Ids(events.map((event) => event.id));
  const todoById = new Map(todos.map((item) => [item.id, item])), eventById = new Map(events.map((event) => [event.id, event]));
  const problems: string[] = [];
  const lines: string[] = [];
  const accepted: Pending["changes"] = [];
  inputs.forEach((input, index) => {
    try {
      const set = given(input.set);
      if (input.kind === "todo") {
        const item = todoById.get(pick(todoIds, input.id, lang, "todo", (id) => todoById.get(id)?.title ?? ""))!;
        const after = changedTask(item, set, now, lang);
        const changes = diffLines(taskFields(item, now, lang), taskFields(after, now, lang));
        // N3-5: a move to another space (null or "general": 일반), only for an app that can undo it (N3-8).
        let move: Move | undefined;
        if (set.space !== undefined) {
          const space = readSpace(set.space === null ? null : String(set.space), spaces, lang);
          const from = spaceOf(spaces.data, item.id) ?? null;
          if (space !== from) {
            if (ctx.appExt < movesFromExt) throw oldAppProblem(lang);
            move = { space, from };
            // N3-9: a move to where this device hides it is fine (as in the app); the preview says it won't show here.
            const hidden = addedHiddenLine(space, spaces, lang) ? ` (${say(lang, "이 기기에서는 숨겨져 있어요", "hidden on this device", "verborgen op dit apparaat")})` : "";
            changes.push(`   ${say(lang, "스페이스", "Space", "Ruimte")}: ${spaceName(spaces, from)} → ${spaceName(spaces, space)}${hidden}`);
          }
        }
        if (!changes.length) throw new Problem(say(lang, `바뀌는 게 없어요: ‘${item.title}’.`, `Nothing changes for ‘${item.title}’.`, `Er verandert niets aan ‘${item.title}’.`));
        lines.push(`${accepted.length + 1}. ${item.title} · id ${todoIds.short(item.id)}`, ...changes);
        accepted.push({ kind: "todo", id: item.id, set: fieldsOf(set), before: item as unknown as AiItem, ...(move ? { move } : {}) });
      } else {
        const event = eventById.get(pick(eventIds, eventId(input.id), lang, "event", (id) => eventById.get(id)?.title ?? ""))!;
        const after = changedEvent(event, set, now, lang);
        const changes = diffLines(eventFields(event, lang), eventFields(after, lang));
        if (!changes.length) throw new Problem(say(lang, `바뀌는 게 없어요: ‘${event.title}’.`, `Nothing changes for ‘${event.title}’.`, `Er verandert niets aan ‘${event.title}’.`));
        lines.push(`${accepted.length + 1}. ${event.title} · id ${eventIds.short(event.id)}`, ...changes);
        accepted.push({ kind: "event", id: event.id, set, before: event as unknown as AiItem });
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
  return {
    text: [head, ...lines, "", tail].join("\n"),
    data: { token, expiresAt: localStamp(new Date(now.getTime() + tokenMs)), changes: accepted.map(({ kind, id, before }) => ({ kind, id: (kind === "todo" ? todoIds : eventIds).short(id), title: String(before.title ?? "") })) },
  };
}

/** Thrown inside a write when an item is no longer what the preview showed (M10). */
class Changed extends Error {
  constructor(readonly titles: string[]) { super("changed"); }
}

export function applyChanges(ctx: Ctx, args: { token: string }): Reply {
  const { folder, now, lang } = ctx;
  const token = (args.token ?? "").trim().toUpperCase();
  const preview = pending.get(token);
  if (!preview) throw new Problem(say(lang, `기다리는 확인 번호가 아니에요: ${token || "(없음)"}. preview_changes로 다시 미리보기해 주세요.`, `No confirmation ${token || "(none)"} is waiting. Preview again with preview_changes.`, `Bevestiging ${token || "(geen)"} is onbekend. Maak opnieuw een voorbeeld met preview_changes.`));
  pending.delete(token);
  if (now.getTime() - preview.at > tokenMs) throw new Problem(say(lang, "확인 번호의 10분이 지나서 적용하지 않았어요. preview_changes로 다시 미리보기해 주세요.", "The confirmation is older than 10 minutes, so nothing was applied. Preview again with preview_changes.", "De bevestiging is ouder dan 10 minuten, dus er is niets toegepast. Maak opnieuw een voorbeeld met preview_changes."));
  const stale = (titles: string[]) => {
    const named = titles.map((title) => `‘${title}’`).join(", ");
    return new Problem(say(lang,
      `미리보기 뒤에 바뀐 항목이 있어서 적용하지 않았어요: ${named}. preview_changes로 다시 미리보기해 주세요. (코드 ITEM_CHANGED)`,
      `${named} changed after the preview, so nothing was applied. Preview again with preview_changes. (code ITEM_CHANGED)`,
      `${named} is na het voorbeeld gewijzigd, dus er is niets toegepast. Maak opnieuw een voorbeeld met preview_changes. (code ITEM_CHANGED)`), "ITEM_CHANGED");
  };
  // N3-5: the task's own fields go to todos.json, a move to todo-spaces.json; only the files that change are written.
  const moves = preview.changes.filter((change) => change.kind === "todo" && change.move);
  if (moves.length && ctx.appExt < movesFromExt) throw oldAppProblem(lang);
  const todoChanges = preview.changes.filter((change) => change.kind === "todo" && Object.keys(change.set).length > 0);
  const eventChanges = preview.changes.filter((change) => change.kind === "event");
  const files = [
    ...(todoChanges.length || moves.length ? ["todos.json" as const] : []), ...(moves.length ? ["todo-spaces.json" as const] : []), ...(eventChanges.length ? ["events.json" as const] : []),
  ];
  /** One file's changes made on its list (every item was checked first). */
  const applyTo = (file: "todos.json" | "events.json", list: { id: string }[], changes: Pending["changes"], apply: (item: never, set: ChangeSet) => object): AiChange[] => {
    const done: AiChange[] = [];
    for (const change of changes) {
      const index = list.findIndex((item) => item.id === change.id);
      const current = list[index] as unknown as AiItem;
      const after = apply(current as never, change.set) as unknown as AiItem;
      list[index] = after as unknown as { id: string };
      done.push({ file, id: change.id, before: { ...current }, after: { ...after } });
    }
    return done;
  };
  // Both files checked and written under one hold of the lock: all of it goes in, or none (#110). Whatever
  // stops it (an item changed, a file that changed in between, a failed write) leaves both files as they
  // were, and nothing is logged.
  let todoDone: AiChange[] = [], eventDone: AiChange[] = [], placeDone: AiChange[] = [];
  let todoIds = new Ids([]), eventIds = new Ids([]);
  let spacesAfter: TodoSpaces | undefined;
  try {
    ({ todoDone, eventDone, placeDone, todoIds, eventIds, spacesAfter } = folder.updateAll(files, (lists) => {
      const todos = lists["todos.json"] ?? [], events = lists["events.json"] ?? [];
      let places = lists["todo-spaces.json"];
      const moved = [
        ...todoChanges.filter((change) => !sameSaved(aiTargetOf("todos.json"), todos.find((item) => item.id === change.id) as Record<string, unknown> | undefined, change.before)),
        // M27: moved in the app since the preview (or the task is gone): not applied.
        ...moves.filter((change) => !todos.some((item) => item.id === change.id) || (places && (spaceOf(places, change.id) ?? null) !== change.move!.from)),
        ...eventChanges.filter((change) => !sameSaved(aiTargetOf("events.json"), events.find((item) => item.id === change.id) as Record<string, unknown> | undefined, change.before)),
      ].map((change) => String(change.before.title ?? ""));
      if (moved.length) throw new Changed([...new Set(moved)]);
      const todoDone = applyTo("todos.json", todos, todoChanges, (item: TodoItem, set) => changedTask(item, set, now, lang));
      const placeDone: AiChange[] = [];
      if (places) {
        for (const change of moves) {
          // A space deleted in the app since the preview: nothing goes in.
          if (change.move!.space && !findSpace(places, change.move!.space)) throw new Changed([String(change.before.title ?? "")]);
          const before = placeOf(places, change.id);
          places = moveTodo(places, change.id, change.move!.space, now);
          placeDone.push({ file: aiPlacesFile, id: change.id, before, after: placeOf(places, change.id) });
        }
        lists["todo-spaces.json"] = places;
      }
      return {
        changed: true,
        result: {
          todoDone, placeDone,
          eventDone: applyTo("events.json", events, eventChanges, (event: LocalEvent, set) => changedEvent(event, set, now, lang)),
          todoIds: new Ids(todos.map((item) => item.id)), eventIds: new Ids(events.map((event) => event.id)), spacesAfter: places,
        },
      };
    }));
  } catch (error) {
    if (error instanceof Changed) throw stale(error.titles);
    throw error;
  }
  // N3-6: one line for the tasks, each one's fields (todos.json) and then its place (todo-spaces.json), counted by task.
  const order = preview.changes.filter((change) => change.kind === "todo").map((change) => change.id);
  const taskChanges = order.flatMap((id) => [...todoDone.filter((change) => change.id === id), ...placeDone.filter((change) => change.id === id)]);
  const changedIds = [...new Set(taskChanges.map((change) => change.id))];
  const todoAfter = (id: string): TodoItem => (todoDone.find((change) => change.id === id)?.after ?? preview.changes.find((change) => change.id === id)!.before) as unknown as TodoItem;
  logged(ctx, "apply_changes", "change", "todos", taskChanges, changedIds.length ? { title: todoAfter(changedIds[0]).title, count: changedIds.length } : undefined);
  logged(ctx, "apply_changes", "change", "events", eventDone);
  const words: TaskWords = { ids: todoIds, repeats: repeatWords(folder, lang), spaces: spacesAfter ? { ...spacesNow(ctx), data: spacesAfter } : spacesNow(ctx) };
  const lines: string[] = [say(lang, "바꿨어요.", "Changed.", "Gewijzigd.")];
  for (const id of changedIds) lines.push(taskLine(todoAfter(id), now, lang, words));
  for (const change of eventDone) lines.push(`- ${localEventLine(change.after as unknown as LocalEvent, lang, eventIds)}`);
  return {
    text: lines.join("\n"),
    data: {
      changed: [
        ...changedIds.map((id) => ({ kind: "todo" as const, id: todoIds.short(id), title: todoAfter(id).title, ...(placeDone.some((change) => change.id === id) ? { space: taskSpace(words.spaces!, id).name } : {}) })),
        ...eventDone.map((change) => ({ kind: "event" as const, id: eventIds.short(change.id), title: String(change.after?.title ?? "") })),
      ],
    },
  };
}
