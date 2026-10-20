import { logicalDayStart } from "./archive";
import { eventTooltip, todayEvents, type CalendarEvent } from "./calendar";
import { clock, langIndex, minutesAway, type Lang } from "./lang";
import type { TodoItem } from "./notebook";
import { blockTooltip, rangeToday, type TimeRange } from "./timeRange";

/**
 * 하루 띠: today on one track above the list — timed events as coloured bars, today's task
 * reminders as rings, all-day events as pills above, the now line, and one sentence under it
 * ("지금 팀 회의 → 40분 뒤 15:30 치과"). Hours are counted from the midnight that starts the logical
 * (4 a.m.) day, so after midnight they run past 24. Same rules as the macOS app (DayRibbon).
 * Since 1.25 the 하루 띠 (dayStrip.ts) draws its thin day bar, hours and all-day pills from this; its now and next
 * come from dayStrip.ts (the focus card's "다음" line still reads `next` here).
 */

export interface RibbonBar { key: string; title: string; color: string; from: number; to: number; past: boolean; tooltip: string }
/** One or more reminders close together (within about 12 minutes on the track) share a ring. */
export interface RibbonRing { id: string; title: string; at: number; tooltip: string; count: number }
export interface RibbonPill { key: string; title: string; color: string }
/**
 * 시간 정하기: a task's range today, on the task lanes under the events (`lane` 0 or 1 when two overlap).
 * `done` faded with a strike; `overdue` (over, still open) outlined in clay. `range` is what a drag starts from.
 */
export interface RibbonBlock { id: string; title: string; from: number; to: number; lane: number; done: boolean; overdue: boolean; tooltip: string; range: TimeRange }
/** `away` ("40분 뒤") only within three hours; further off the clock says enough (as on the Mac). */
export interface RibbonNext { title: string; time: string; away?: string }

export interface Ribbon {
  /** The track's first and last hour (8 and 24 unless something is earlier or after midnight). */
  startHour: number;
  endHour: number;
  /** Labels at whole hours, `at` 0…1 along the track. */
  hours: { at: number; text: string }[];
  /** Now, 0…1 along the track. */
  now: number;
  bars: RibbonBar[];
  /** Tasks with a time today (their own lanes; two at most). */
  blocks: RibbonBlock[];
  /** Task lanes in use: 0, 1 or 2. */
  taskLanes: number;
  rings: RibbonRing[];
  /** All-day events, at most two; `more` counts the rest. */
  allDay: RibbonPill[];
  more: number;
  /** The timed event going on now (the latest to have started). */
  current?: string;
  /** The next timed thing ahead today: an event or a task reminder. */
  next?: RibbonNext;
  /** "오늘 남은 일정이 없어요" when nothing is ahead. */
  nothingAhead: string;
  /** The ribbon read as one sentence (its accessible label). */
  sentence: string;
}

const hourMs = 3_600_000;

/** "1시간 10분 뒤", "in 1 h 10 min", "over 1 u 10 min"; under an hour "40분 뒤". */
export function awayText(minutes: number, lang: Lang = "ko"): string {
  if (minutes < 60) return minutesAway(Math.max(1, minutes), lang);
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  const [h, m] = lang === "ko" ? ["시간", "분"] : lang === "en" ? [" h", " min"] : [" u", " min"];
  const span = rest === 0 ? `${hours}${h}` : `${hours}${h} ${rest}${m}`;
  return lang === "ko" ? `${span} 뒤` : lang === "en" ? `in ${span}` : `over ${span}`;
}

/** An hour label: "8", "12", "24" (ko, nl); "8 AM", "12 PM", "12 AM" (en). Hours past 24 are the next morning's. */
export function hourLabel(hour: number, lang: Lang = "ko"): string {
  if (lang !== "en") return String(hour > 24 ? hour - 24 : hour);
  const value = hour % 24;
  return `${value % 12 || 12} ${value < 12 ? "AM" : "PM"}`;
}

/**
 * The 다음 group (at most `limit`), soonest first: open tasks with a time today that isn't over (by its start),
 * and open tasks with a reminder later today (by the reminder).
 */
export function upNext(items: readonly TodoItem[], now: Date, limit = 3): TodoItem[] {
  const end = logicalDayStart(now).getTime() + 24 * hourMs;
  const when = (item: TodoItem): number | undefined => {
    if (item.isCompleted) return undefined;
    const times = rangeToday(item, now);
    if (times) return times.end.getTime() > now.getTime() ? times.start.getTime() : undefined;
    const at = item.reminderAt ? Date.parse(item.reminderAt) : NaN;
    return at > now.getTime() && at < end ? at : undefined;
  };
  return items.map((item, index) => ({ item, at: when(item), index }))
    .filter((entry): entry is { item: TodoItem; at: number; index: number } => entry.at !== undefined)
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .slice(0, limit).map((entry) => entry.item);
}

/**
 * 오늘's two groups: 다음 (오늘 꼭 하나 first when it is open and on the sheet — on top of, not one of, the
 * three by time) and the rest in the list's order. Shared cases P1–P4 (convenience-cases.md §9).
 */
export function todayGroups(visible: readonly TodoItem[], now: Date, first?: string): { next: TodoItem[]; rest: TodoItem[] } {
  const picked = first ? visible.find((item) => item.id === first && !item.isCompleted) : undefined;
  const next = [...(picked ? [picked] : []), ...upNext(picked ? visible.filter((item) => item !== picked) : visible, now)];
  const ids = new Set(next.map((item) => item.id));
  return { next, rest: visible.filter((item) => !ids.has(item.id)) };
}

/**
 * The ribbon for `now`, or undefined when today has no events and no open reminders. `events` are
 * occurrences around today (they are filtered to the logical day); `tasks` every task (those with a
 * reminder in today's logical day are used, done ones hidden).
 */
export function dayRibbon(events: readonly CalendarEvent[], tasks: readonly TodoItem[], now: Date, lang: Lang = "ko"): Ribbon | undefined {
  const dayStart = logicalDayStart(now);
  const dayEnd = new Date(dayStart.getTime() + 24 * hourMs);
  const midnight = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate()).getTime();
  const hours = (time: number) => (time - midnight) / hourMs;
  const today = todayEvents(events, now);
  const timed = today.filter((event) => !event.allDay);
  const allDay = today.filter((event) => event.allDay);
  // Tasks with a time today (done ones too, faded); in the list's order for equal starts.
  const timedTasks = tasks.map((item) => ({ item, times: rangeToday(item, now) })).filter((entry) => entry.times !== undefined)
    .map((entry) => ({ item: entry.item, start: entry.times!.start.getTime(), end: entry.times!.end.getTime(), range: entry.times!.range }));
  // A reminder at its block's start is the block's: no ring of its own.
  const blockStart = new Map(timedTasks.map((entry) => [entry.item.id, entry.start]));
  const reminders = tasks
    .filter((item) => !item.isCompleted && item.reminderAt)
    .map((item) => ({ item, at: Date.parse(item.reminderAt!) }))
    .filter(({ item, at }) => at >= dayStart.getTime() && at < dayEnd.getTime() && blockStart.get(item.id) !== at)
    .sort((a, b) => a.at - b.at);
  if (today.length === 0 && reminders.length === 0 && timedTasks.length === 0) return undefined;

  // The track: 8 to 24, earlier to the first thing's hour, to the 4 a.m. end when something is after midnight.
  const nowHour = hours(now.getTime());
  const spans = timed.map((event) => ({ from: Math.max(hours(event.start.getTime()), 4), to: Math.min(hours(event.end.getTime()), 28) }));
  const taskSpans = timedTasks.map((entry) => ({ from: Math.max(hours(entry.start), 4), to: Math.min(hours(entry.end), 28) }));
  const points = [...spans.map((span) => span.from), ...taskSpans.map((span) => span.from), ...reminders.map(({ at }) => hours(at)), nowHour];
  let startHour = 8;
  for (const point of points) if (point < startHour) startHour = Math.max(4, Math.floor(point));
  const late = [...spans.map((span) => span.to), ...taskSpans.map((span) => span.to), ...points].some((point) => point > 24);
  const endHour = late ? 28 : 24;
  const length = endHour - startHour;
  const at = (hour: number) => Math.min(1, Math.max(0, (hour - startHour) / length));

  // Hour labels (as on the Mac): the usual 8–24 day at 8 12 16 20 24; any other span keeps its two ends and
  // puts the hours between on multiples of 6, at least 3 hours from either end (6–24: 6 12 18 24).
  const labels = startHour === 8 && endHour === 24 ? [8, 12, 16, 20, 24]
    : [startHour, ...[6, 12, 18, 24].filter((hour) => hour >= startHour + 3 && hour <= endHour - 3), endHour];
  const bars = timed.map((event, index) => ({
    key: event.key, title: event.title, color: event.color, from: at(spans[index].from), to: at(spans[index].to),
    past: event.end.getTime() <= now.getTime(), tooltip: eventTooltip(event, lang),
  }));
  // Task lanes: by start (then the list's order), the first lane unless it overlaps a block already there.
  const laneEnds: number[] = [];
  const blocks: RibbonBlock[] = timedTasks
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.start - b.start || a.index - b.index)
    .map((entry) => {
      let lane = laneEnds.findIndex((end) => end <= entry.start);
      if (lane < 0) lane = Math.min(laneEnds.length, 1);
      laneEnds[lane] = Math.max(laneEnds[lane] ?? 0, entry.end);
      const span = taskSpans[entry.index];
      return {
        id: entry.item.id, title: entry.item.title, from: at(span.from), to: at(span.to), lane, done: entry.item.isCompleted,
        overdue: !entry.item.isCompleted && entry.end <= now.getTime(), tooltip: blockTooltip(entry.item, lang), range: entry.range,
      };
    });
  const rings: RibbonRing[] = [];
  for (const { item, at: time } of [...reminders].sort((a, b) => a.at - b.at)) {
    const date = new Date(time);
    const tip = `${item.title} · ${clock(date.getHours(), date.getMinutes(), lang)}`;
    const place = at(hours(time));
    const last = rings[rings.length - 1];
    if (last && place - last.at < 12 / 60 / length) {
      last.count += 1;
      last.tooltip += `\n${tip}`;
    } else rings.push({ id: item.id, title: item.title, at: place, tooltip: tip, count: 1 });
  }

  // 지금: the latest-started event or open task block going on now (an event first when they start together).
  const openBlocks = timedTasks.filter((entry) => !entry.item.isCompleted);
  const current = [
    ...timed.filter((event) => event.start <= now && now < event.end).map((event, index) => ({ title: event.title, start: event.start.getTime(), order: index })),
    ...openBlocks.filter((entry) => entry.start <= now.getTime() && now.getTime() < entry.end).map((entry, index) => ({ title: entry.item.title, start: entry.start, order: 1000 + index })),
  ].sort((a, b) => b.start - a.start || a.order - b.order)[0];
  const ahead = [
    ...timed.filter((event) => event.start > now).map((event) => ({ title: event.title, time: event.start.getTime() })),
    ...openBlocks.filter((entry) => entry.start > now.getTime()).map((entry) => ({ title: entry.item.title, time: entry.start })),
    ...reminders.filter(({ at: time }) => time > now.getTime()).map(({ item, at: time }) => ({ title: item.title, time })),
  ].sort((a, b) => a.time - b.time)[0];
  const minutesAhead = ahead ? Math.ceil((ahead.time - now.getTime()) / 60_000) : 0;
  const next: RibbonNext | undefined = ahead ? {
    title: ahead.title,
    time: clock(new Date(ahead.time).getHours(), new Date(ahead.time).getMinutes(), lang),
    ...(minutesAhead <= 180 ? { away: awayText(minutesAhead, lang) } : {}),
  } : undefined;
  const nothingAhead = ["오늘 남은 일정이 없어요", "Nothing else today", "Verder niets vandaag"][langIndex(lang)];
  const nowWord = ["지금", "Now", "Nu"][langIndex(lang)];
  const nextWord = ["다음", "next", "volgende"][langIndex(lang)];
  const parts: string[] = [];
  if (current) parts.push(lang === "ko" ? `${nowWord} ${current.title}` : `${nowWord}: ${current.title}`);
  parts.push(next ? `${current ? nextWord : nextWord[0].toUpperCase() + nextWord.slice(1)} ${next.time} ${next.title}${next.away ? `, ${next.away}` : ""}` : nothingAhead);
  return {
    startHour, endHour, now: at(nowHour),
    hours: labels.map((hour) => ({ at: at(hour), text: hourLabel(hour, lang) })),
    bars, blocks, taskLanes: laneEnds.length, rings,
    allDay: allDay.slice(0, 2).map((event) => ({ key: event.key, title: event.title, color: event.color })),
    more: Math.max(0, allDay.length - 2),
    ...(current ? { current: current.title } : {}), ...(next ? { next } : {}),
    nothingAhead, sentence: parts.join(" · "),
  };
}

/**
 * A time typed into the event sheet's time list: "17:20", "1720", "17", "5:20pm", "5 pm", "5.20 p.m.",
 * "오후 5:20", "오후 5시 20분" → minutes after midnight (0…1439), or undefined.
 */
export function parseClockText(text: string): number | undefined {
  const value = text.trim().toLowerCase().replace(/\s+/g, " ");
  const match = /^(?:(오전|오후)\s?)?(\d{1,2})(?:[:.]?(\d{2}))?\s?(?:([ap])\.?\s?m\.?)?$/u.exec(value) // i18n-ok
    ?? /^(?:(오전|오후)\s?)?(\d{1,2})시(?:\s?(\d{1,2})분)?()$/u.exec(value); // i18n-ok
  if (!match) return undefined;
  const [, period, hourText, minuteText, ampm] = match;
  let hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  const pm = ampm ? ampm === "p" : period ? period === "오후" : undefined; // i18n-ok
  if (pm !== undefined) {
    if (hour < 1 || hour > 12) return undefined;
    hour = pm ? (hour % 12) + 12 : hour % 12;
  }
  if (hour === 24 && minute === 0) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

/**
 * A click on the ribbon's empty track (편의 기능 9): the moment under it, to the nearest quarter hour, kept
 * between the track's start and an hour before its end (the hour-long event fits), on the logical day of
 * `now` — hours past 24 are the next calendar day ("yyyy-MM-dd" and minutes 0–1439). Shared cases R1–R5.
 */
export function ribbonMoment(fraction: number, startHour: number, endHour: number, now: Date): { day: string; minutes: number } {
  const hour = startHour + Math.min(1, Math.max(0, fraction)) * (endHour - startHour);
  const quarter = Math.min(Math.max(Math.round(hour * 4) / 4, startHour), endHour - 1);
  const start = logicalDayStart(now);
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.floor(quarter / 24), 12);
  const pad = (value: number) => String(value).padStart(2, "0");
  return { day: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`, minutes: Math.round((quarter % 24) * 60) };
}
