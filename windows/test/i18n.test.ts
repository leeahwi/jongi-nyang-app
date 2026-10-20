import assert from "node:assert/strict";
import { test } from "node:test";
import { heatLevelTitlesIn, archiveChoicesIn } from "../src/core/archive";
import { backupFileName, backupMessages, exportedText, parseBackup, summaryText } from "../src/core/backup";
import { wrapBubble } from "../src/core/bubbleText";
import {
  agendaTime, dayLabel, dayTasks, dayTitle, eventStatus, eventTimeLabel, eventTooltip, lengthText, monthGrid, monthTitle, validate, weekDays,
  weekdayLabels, weekTitle, type CalendarDraft, type CalendarEvent,
} from "../src/core/calendar";
import { chatterFrequencyTitles, pettedChatter, pickChatter, type ChatterContext, type ChatterLine } from "../src/core/chatter";
import { deadlineChoiceTitles, dueStyleTitles, label, sentence } from "../src/core/deadline";
import { eventColorTitle, eventRepeatTitle, occurrences, type EventColor, type EventRepeat, type LocalEvent } from "../src/core/events";
import { defaultPomodoro, nextPhase, phaseName, startCountdown, startPomodoro, timerCaption } from "../src/core/focusTimer";
import {
  clock, days, langs, longDate, minutesAway, monthName, monthShort, monthTitle as langMonthTitle, nativeName, resolveLang, shortDate, spokenTime, timeRange,
  todos, weekdayName, weekdayShort, weekStartsMonday, type Lang,
} from "../src/core/lang";
import { lookbackMessage } from "../src/core/lookback";
import { memoTitle } from "../src/core/memo";
import { parseQuick } from "../src/core/quickParse";
import { describe, repeatKindTitles, type RepeatRule } from "../src/core/repeat";
import { aheadSectionTitle } from "../src/core/ahead";
import { storageLabel } from "../src/core/storage";
import { compactTime, rowLabel, scheduledTime } from "../src/core/timeText";
import { timerSizeTitles, timerSizes } from "../src/core/timerWidget";
import { calendarAlertChoicesIn, defaultPrefs, fontTitles, styleTitles, textSizeTitles } from "../src/core/types";

// English and Dutch: the same cases as the macOS tests (CoreTests.swift, ReminderTimeTextTests.swift).

test("languages: the setting, the week start and dates written by hand", () => {
  assert.equal(resolveLang("auto", ["nl-NL", "en"]), "nl");
  assert.equal(resolveLang("auto", ["fr-FR", "en-GB"]), "en");
  assert.equal(resolveLang("auto", ["de", "fr"]), "en");
  assert.equal(resolveLang(undefined, ["ko_KR"]), "ko");
  assert.equal(resolveLang("ko", ["nl"]), "ko");
  assert.equal(resolveLang("nl", []), "nl");
  assert.deepEqual(langs.map(weekStartsMonday), [false, false, true]);
  assert.deepEqual(langs.map((lang) => nativeName[lang]), ["한국어", "English", "Nederlands"]);
  assert.equal(defaultPrefs.language, "auto");
  const thursday = new Date(2026, 9, 8, 12);
  assert.deepEqual(langs.map((lang) => longDate(thursday, lang)), ["10월 8일 목요일", "Thursday, October 8", "donderdag 8 oktober"]);
  assert.deepEqual(langs.map((lang) => shortDate(thursday, lang)), ["10월 8일 (목)", "Thu, Oct 8", "do 8 okt"]);
  assert.equal(shortDate(new Date(2027, 0, 2), "en", true), "Sat, Jan 2, 2027");
  assert.deepEqual(langs.map((lang) => langMonthTitle(2026, 10, lang)), ["2026년 10월", "October 2026", "oktober 2026"]);
  assert.deepEqual(langs.map((lang) => clock(15, 0, lang)), ["15:00", "3:00 PM", "15:00"]);
  assert.equal(clock(0, 5, "en"), "12:05 AM");
  assert.equal(clock(12, 0, "en"), "12:00 PM");
  assert.equal(clock(9, 5, "nl"), "09:05");
  assert.deepEqual(langs.map((lang) => spokenTime(9, 30, lang)), ["오전 9:30", "9:30 AM", "09:30"]);
  assert.equal(timeRange({ hour: 15, minute: 0 }, { hour: 16, minute: 0 }, "en"), "3:00–4:00 PM");
  assert.equal(timeRange({ hour: 11, minute: 30 }, { hour: 12, minute: 30 }, "en"), "11:30 AM–12:30 PM");
  assert.equal(timeRange({ hour: 11, minute: 30 }, { hour: 12, minute: 30 }, "nl"), "11:30–12:30");
  assert.deepEqual(langs.map((lang) => minutesAway(5, lang)), ["5분 뒤", "in 5 min", "over 5 min"]);
  assert.deepEqual(langs.map((lang) => `${days(1, lang)} ${days(3, lang)} ${todos(1, lang)} ${todos(2, lang)}`),
    ["1일 3일 할 일 1개 할 일 2개", "1 day 3 days 1 to-do 2 to-dos", "1 dag 3 dagen 1 taak 2 taken"]);
  assert.deepEqual(langs.map((lang) => weekdayShort(0, lang) + weekdayName(1, lang) + monthShort(3, lang) + monthName(5, lang)), ["일월요일3월5월", "SunMondayMarMay", "zomaandagmrtmei"]);
});

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
const event = (title: string, start: Date, end: Date, allDay = false): CalendarEvent =>
  ({ key: `c/${title}`, calendarId: "c", title, allDay, start, end, color: "#000000", eventId: title, canEdit: true, recurring: false });

test("calendar pages in English and Dutch: Monday weeks in Dutch, titles, times", () => {
  let grid = monthGrid(2026, 10, "nl");
  assert.deepEqual([grid.length, grid[0], grid[41]], [42, "2026-09-28", "2026-11-08"]);
  grid = monthGrid(2026, 2, "nl");
  assert.deepEqual([grid[0], grid[41]], ["2026-01-26", "2026-03-08"]);
  assert.equal(monthGrid(2026, 10, "en")[0], "2026-09-27");
  const nlWeek = weekDays("2026-10-07", "nl");
  assert.deepEqual([nlWeek[0], nlWeek[6]], ["2026-10-05", "2026-10-11"]);
  assert.equal(weekDays("2026-10-04", "nl")[0], "2026-09-28");
  assert.equal(weekDays("2026-10-05", "nl")[0], "2026-10-05");
  assert.equal(weekDays("2026-10-07", "en")[0], "2026-10-04");
  assert.deepEqual(weekdayLabels("ko"), ["일", "월", "화", "수", "목", "금", "토"]);
  assert.deepEqual(weekdayLabels("en"), ["S", "M", "T", "W", "T", "F", "S"]);
  assert.deepEqual(weekdayLabels("nl"), ["ma", "di", "wo", "do", "vr", "za", "zo"]);
  const week = weekDays("2026-10-07"), across = weekDays("2026-10-01"), newYear = weekDays("2027-01-01");
  assert.equal(monthTitle(2026, 10, "en"), "October 2026");
  assert.equal(monthTitle(2026, 10, "nl"), "oktober 2026");
  assert.deepEqual([week, across, newYear].map((days) => weekTitle(days, "en")), ["Oct 4 – 10", "Sep 27 – Oct 3", "Dec 27, 2026 – Jan 2, 2027"]);
  assert.deepEqual([nlWeek, across, newYear].map((days) => weekTitle(days, "nl")), ["5 – 11 okt", "27 sep – 3 okt", "27 dec 2026 – 2 jan 2027"]);
  assert.equal(dayTitle("2026-10-07", "en"), "Wednesday, October 7");
  assert.equal(dayTitle("2026-10-07", "nl"), "woensdag 7 oktober");
  assert.equal(dayLabel(new Date(2026, 9, 8), "en"), "Thu, Oct 8");

  const birthday = event("생일", at(7, 0), at(8, 0), true), meeting = event("회의", at(7, 10), at(7, 11));
  const night = event("야간", at(6, 23), at(7, 1)), late = event("늦은", at(7, 23, 30), at(8, 0, 30));
  const moment = event("순간", at(7, 12), at(7, 12)), noon = event("점심", at(7, 11, 30), at(7, 12, 30));
  const all = [birthday, meeting, night, late, moment, noon];
  assert.deepEqual(all.map((e) => agendaTime(e, "2026-10-07", "en")), ["All day", "10:00–11:00 AM", "~1:00 AM", "11:30 PM~", "12:00 PM", "11:30 AM–12:30 PM"]);
  assert.deepEqual(all.map((e) => agendaTime(e, "2026-10-07", "nl")), ["Hele dag", "10:00–11:00", "~01:00", "23:30~", "12:00", "11:30–12:30"]);
  const tasks = [
    { id: "B", title: "B", isCompleted: false, reminderAt: at(7, 15).toISOString() },
    { id: "C", title: "C", isCompleted: false, reminderAt: at(7, 9, 30).toISOString() },
  ];
  assert.deepEqual(dayTasks("2026-10-07", tasks, "en").map((task) => task.time), ["9:30 AM", "3:00 PM"]);
  assert.deepEqual(dayTasks("2026-10-07", tasks, "nl").map((task) => task.time), ["09:30", "15:00"]);

  // Today's strip.
  const one = (id: string, title: string, day: number, start: number, end: number, lang: Lang, allDay = false): CalendarEvent => {
    const local: LocalEvent = { id, title, date: `2026-10-${String(day).padStart(2, "0")}`, allDay, days: 1, start, end, repeat: "none", skip: [], color: "blue", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
    return occurrences(local, at(1, 0), at(20, 0), lang)[0];
  };
  const a = one("a", "Standup", 7, 600, 660, "en"), g = one("g", "Late shift", 7, 180, 300, "en");
  const j = one("j", "Night", 7, 1380, 360, "en"), c = one("c", "Birthday", 7, 0, 0, "en", true);
  const now = at(7, 9);
  assert.deepEqual([a, g, j, c].map((e) => eventTimeLabel(e, now, "en")), ["10:00 AM", "~5:00 AM", "11:00 PM~", "All day"]);
  assert.deepEqual([a, g, j, c].map((e) => eventTimeLabel(e, now, "nl")), ["10:00", "~05:00", "23:00~", "Hele dag"]);
  assert.deepEqual(eventStatus(a, now, "en"), { text: "in 60 min", state: "soon" });
  assert.deepEqual(eventStatus(a, now, "nl"), { text: "over 60 min", state: "soon" });
  assert.deepEqual([eventStatus(a, at(7, 10, 30), "en").text, eventStatus(a, at(7, 11), "en").text], ["Now", "Over"]);
  assert.deepEqual([eventStatus(a, at(7, 10, 30), "nl").text, eventStatus(a, at(7, 11), "nl").text], ["Nu", "Voorbij"]);
  assert.equal(one("i", " ", 7, 720, 750, "en").title, "(No title)");
  assert.equal(one("i", "", 7, 720, 750, "nl").title, "(Geen titel)");
  assert.equal(eventTooltip({ ...a, location: "Room 3" }, "en"), "Standup · 10:00–11:00 AM · Room 3");
});

test("events, drafts, deadlines, repeats and the rest in English and Dutch", () => {
  const draft = (startMinutes: number, endMinutes: number, extra: Partial<CalendarDraft> = {}): CalendarDraft =>
    ({ title: "x", color: "blue", date: "2026-10-07", allDay: false, days: 1, startMinutes, endMinutes, repeat: "none", ...extra });
  assert.equal(validate(draft(600, 630, { title: "" }), "en"), "Give it a title");
  assert.equal(validate(draft(600, 630, { title: "" }), "nl"), "Geef het een titel");
  assert.equal(validate(draft(600, 600), "en"), "It ends when it starts");
  assert.equal(validate(draft(600, 600), "nl"), "Het eindigt wanneer het begint");
  const spans: [number, number][] = [[600, 630], [600, 660], [600, 690], [600, 720], [1410, 30]];
  assert.deepEqual(spans.map(([from, to]) => lengthText(draft(from, to), "en")), ["30 min", "1 hour", "1 hour 30 min", "2 hours", "1 hour · next day"]);
  assert.deepEqual(spans.map(([from, to]) => lengthText(draft(from, to), "nl")), ["30 min", "1 uur", "1 uur 30 min", "2 uur", "1 uur · volgende dag"]);
  const allDay = draft(0, 60, { allDay: true }), three = draft(0, 60, { allDay: true, days: 3 });
  assert.deepEqual([allDay, three].map((d) => lengthText(d, "en")), ["1 day", "3 days"]);
  assert.deepEqual([allDay, three].map((d) => lengthText(d, "nl")), ["1 dag", "3 dagen"]);
  const repeats: EventRepeat[] = ["none", "daily", "weekly", "monthly", "yearly"];
  const colors: EventColor[] = ["blue", "sage", "coral", "purple", "yellow", "gray"];
  assert.deepEqual(repeats.map((r) => eventRepeatTitle(r, "en")), ["Never", "Every day", "Every week", "Every month", "Every year"]);
  assert.deepEqual(repeats.map((r) => eventRepeatTitle(r, "nl")), ["Nooit", "Elke dag", "Elke week", "Elke maand", "Elk jaar"]);
  assert.deepEqual(colors.map((c) => eventColorTitle(c, "en")), ["Blue", "Green", "Orange", "Purple", "Yellow", "Gray"]);
  assert.deepEqual(colors.map((c) => eventColorTitle(c, "nl")), ["Blauw", "Groen", "Oranje", "Paars", "Geel", "Grijs"]);

  // Deadlines, from Thursday 1 October.
  const now = new Date(2026, 9, 1, 10);
  const keys = ["2026-10-04", "2026-10-02", "2026-10-01", "2026-09-30", "2026-09-28"];
  assert.deepEqual(keys.map((key) => label(key, "dday", now)), ["D-3", "D-1", "D-day", "D+1", "D+3"]);
  assert.deepEqual(keys.map((key) => label(key, "dday", now, "en")), ["3 days left", "1 day left", "due today", "1 day late", "3 days late"]);
  assert.deepEqual(keys.map((key) => label(key, "dday", now, "nl")), ["nog 3 dagen", "nog 1 dag", "vandaag", "1 dag te laat", "3 dagen te laat"]);
  const dates = ["2026-10-01", "2026-10-02", "2026-10-04", "2026-10-31", "2027-01-02"];
  assert.deepEqual(dates.map((key) => label(key, "date", now, "en")), ["by today", "by tomorrow", "by Sun", "by Oct 31", "by Jan 2, 2027"]);
  assert.deepEqual(dates.map((key) => label(key, "date", now, "nl")), ["tot vandaag", "tot morgen", "tot zo", "tot 31 okt", "tot 2 jan 2027"]);
  assert.deepEqual(["2026-10-04", "2026-10-01", "2026-09-30"].map((key) => sentence(key, now, "en")),
    ["Due Sun, Oct 4 · 3 days left", "Due Thu, Oct 1 · today", "Due Wed, Sep 30 · 1 day late"]);
  assert.deepEqual(["2026-10-04", "2026-10-01", "2026-09-30"].map((key) => sentence(key, now, "nl")),
    ["Deadline zo 4 okt · nog 3 dagen", "Deadline do 1 okt · vandaag", "Deadline wo 30 sep · 1 dag te laat"]);
  assert.equal(sentence("2026-10-04", now), "10월 4일 (일)까지 · 3일 남음");
  assert.deepEqual([dueStyleTitles.en.dday, dueStyleTitles.en.date, dueStyleTitles.nl.dday, dueStyleTitles.nl.date], ["Countdown", "Date", "Aftellen", "Datum"]);
  assert.deepEqual(Object.values(deadlineChoiceTitles.en), ["Today", "This week", "This month", "Pick a date"]);
  assert.deepEqual(Object.values(deadlineChoiceTitles.nl), ["Vandaag", "Deze week", "Deze maand", "Datum kiezen"]);

  // Repeats.
  const rule = (extra: Partial<RepeatRule> & Pick<RepeatRule, "kind">): RepeatRule => extra;
  assert.deepEqual(Object.values(repeatKindTitles.en), ["Every day", "Weekdays", "Every week", "Every month"]);
  assert.deepEqual(Object.values(repeatKindTitles.nl), ["Elke dag", "Werkdagen", "Elke week", "Elke maand"]);
  assert.equal(describe(rule({ kind: "weekly", weekdays: [3, 1] }), undefined, "en"), "Every Mon, Wed");
  assert.equal(describe(rule({ kind: "weekly", weekdays: [3, 1] }), undefined, "nl"), "Elke ma, wo");
  assert.equal(describe(rule({ kind: "weekly", weekdays: [0, 1, 2, 3, 4, 5, 6] }), undefined, "en"), "Every day");
  assert.equal(describe(rule({ kind: "weekly", weekdays: [0, 6] }), undefined, "en"), "Every Sat, Sun");
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map((day) => describe(rule({ kind: "monthly", monthDay: day }), undefined, "en")),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"].map((day) => `Every month on the ${day}`));
  assert.equal(describe(rule({ kind: "monthly", monthDay: 15 }), undefined, "nl"), "Elke maand op de 15e");
  assert.equal(describe(rule({ kind: "daily" }), "09:00", "en"), "Every day · reminder at 9:00 AM");
  assert.equal(describe(rule({ kind: "weekdays" }), "21:30", "en"), "Weekdays · reminder at 9:30 PM");
  assert.equal(describe(rule({ kind: "daily" }), "09:00", "nl"), "Elke dag · herinnering om 09:00");
  assert.equal(describe(rule({ kind: "daily" }), "09:00"), "매일 · 오전 9:00 알림");

  // Shelves, sizes, the record, the timer.
  assert.deepEqual((["thisWeek", "nextWeek", "laterOn", "someday"] as const).map((kind) => aheadSectionTitle(kind, "en")), ["This week", "Next week", "Later on", "Someday"]);
  assert.deepEqual((["thisWeek", "nextWeek", "laterOn", "someday"] as const).map((kind) => aheadSectionTitle(kind, "nl")), ["Deze week", "Volgende week", "Daarna", "Ooit"]);
  assert.deepEqual(timerSizes.map((size) => timerSizeTitles.en[size]), ["Small", "Regular", "Large", "Extra large"]);
  assert.deepEqual(timerSizes.map((size) => timerSizeTitles.nl[size]), ["Klein", "Normaal", "Groot", "Extra groot"]);
  assert.deepEqual(archiveChoicesIn("en").map((choice) => choice.title), ["Next day", "After 3 days", "After 7 days", "Never"]);
  assert.deepEqual(archiveChoicesIn("nl").map((choice) => `${choice.days} ${choice.title}`), ["1 Volgende dag", "3 Na 3 dagen", "7 Na 7 dagen", "0 Nooit"]);
  assert.deepEqual(heatLevelTitlesIn.en, ["None", "1", "2–3", "4–5", "6 or more"]);
  assert.deepEqual(heatLevelTitlesIn.nl, ["Geen", "1", "2–3", "4–5", "6 of meer"]);
  assert.equal(lookbackMessage(5), "이번 주 5개 끝냈어요. 수고했어요!");
  assert.equal(lookbackMessage(1, "en"), "You finished 1 to-do this week. Nice work!");
  assert.equal(lookbackMessage(5, "en"), "You finished 5 to-dos this week. Nice work!");
  assert.equal(lookbackMessage(1, "nl"), "Je hebt deze week 1 taak afgerond. Goed gedaan!");
  assert.equal(lookbackMessage(5, "nl"), "Je hebt deze week 5 taken afgerond. Goed gedaan!");
  const t0 = 1_700_000_000_000;
  const focus = startPomodoro(defaultPomodoro, t0), rest = nextPhase(focus, t0)!;
  let long = focus;
  for (let index = 0; index < 7; index += 1) long = nextPhase(long, t0)!;
  assert.deepEqual([focus, rest, long, startCountdown(5, t0)].map((timer) => timerCaption(timer, "en")), ["Focus 1/4", "Break", "Long break", "Timer"]);
  assert.deepEqual([focus, rest, long, startCountdown(5, t0)].map((timer) => timerCaption(timer, "nl")), ["Focus 1/4", "Pauze", "Lange pauze", "Timer"]);
  assert.deepEqual([phaseName(focus), phaseName(focus, "en"), phaseName(rest, "nl"), timerCaption(focus)], ["집중", "Focus", "Pauze", "집중 1/4"]);
  const memo = (text: string) => ({ id: "m", text, createdAt: "", updatedAt: "" });
  assert.deepEqual([memoTitle(memo(" \n"), "en"), memoTitle(memo(""), "nl"), memoTitle(memo("Boodschappen\nmelk"), "nl")], ["Empty note", "Lege notitie", "Boodschappen"]);
  assert.deepEqual(Object.values(chatterFrequencyTitles.en), ["Rarely", "Sometimes", "Often"]);
  assert.deepEqual(Object.values(chatterFrequencyTitles.nl), ["Zelden", "Soms", "Vaak"]);
  // Windows only: the settings' names and the storage folder.
  assert.deepEqual(Object.values(fontTitles.en), ["Pen", "Marker", "Clean"]);
  assert.deepEqual(Object.values(fontTitles.nl), ["Pen", "Stift", "Strak"]);
  assert.deepEqual(Object.values(textSizeTitles.en), ["Small", "Regular", "Large", "Extra large"]);
  assert.deepEqual(Object.values(styleTitles.nl), ["Mini", "Briefje", "Vriendje"]);
  assert.deepEqual(calendarAlertChoicesIn("en").map((choice) => choice.title), ["Off", "5 min before", "10 min before", "15 min before", "30 min before"]);
  assert.deepEqual(calendarAlertChoicesIn("nl").map((choice) => choice.title), ["Uit", "5 min van tevoren", "10 min van tevoren", "15 min van tevoren", "30 min van tevoren"]);
  assert.equal(storageLabel(undefined, "C:\\Users\\me", true, "PC", "en"), "This PC (default)");
  assert.equal(storageLabel(undefined, "C:\\Users\\me", true, "PC", "nl"), "Deze pc (standaard)");
  assert.equal(storageLabel(undefined, "C:\\Users\\me"), "이 PC (기본)");
});

test("백업 in English and Dutch (same cases as CoreTests.swift)", () => {
  assert.deepEqual([backupMessages.en.notBackup, backupMessages.en.tooNew, backupMessages.en.unreadable("todos.json")],
    ["This isn’t a Jongi-nyang backup file.", "This file comes from a newer version of Jongi-nyang. Please update Jongi-nyang.", "Couldn’t read ‘todos.json’ in the backup file."]);
  assert.deepEqual([backupMessages.nl.notBackup, backupMessages.nl.tooNew, backupMessages.nl.unreadable("todos.json")],
    ["Dit is geen back-upbestand van Jongi-nyang.", "Dit bestand komt uit een nieuwere versie van Jongi-nyang. Werk Jongi-nyang bij.", "Kon ‘todos.json’ in het back-upbestand niet lezen."]);
  assert.deepEqual(parseBackup("hello", "en"), { error: "This isn’t a Jongi-nyang backup file." });
  assert.deepEqual(parseBackup(`{"format":"jongi-nyang-backup","version":2,"files":{}}`, "nl"), { error: "Dit bestand komt uit een nieuwere versie van Jongi-nyang. Werk Jongi-nyang bij." });
  const counts = { todos: 2, memos: 1, repeats: 0, events: 3, alarms: 0, archive: 3 };
  assert.equal(summaryText(counts, "en"), "2 to-dos · 1 note · 3 events · 3 in history");
  assert.equal(summaryText(counts, "nl"), "2 taken · 1 notitie · 3 afspraken · 3 in geschiedenis");
  const single = { todos: 1, memos: 2, repeats: 1, events: 1, alarms: 1, archive: 1 };
  assert.equal(summaryText(single, "en"), "1 to-do · 2 notes · 1 repeating to-do · 1 event · 1 alarm · 1 in history");
  assert.equal(summaryText(single, "nl"), "1 taak · 2 notities · 1 herhalende taak · 1 afspraak · 1 wekker · 1 in geschiedenis");
  const two = { ...single, repeats: 2, alarms: 2 };
  assert.ok(summaryText(two, "en").includes("2 repeating to-dos · 1 event · 2 alarms") && summaryText(two, "nl").includes("2 herhalende taken · 1 afspraak · 2 wekkers"));
  assert.equal(summaryText(two), "할 일 1 · 메모 2 · 반복 2 · 일정 1 · 알람 2 · 완료 기록 1");
  const none = { todos: 0, memos: 0, repeats: 0, events: 0, alarms: 0, archive: 0 };
  assert.deepEqual([summaryText(none, "en"), summaryText(none, "nl")], ["This backup is empty.", "Deze back-up is leeg."]);
  assert.deepEqual(langs.map((lang) => backupFileName(new Date(2026, 9, 8, 12), lang)),
    ["종이냥-백업-2026-10-08.jongi", "Jongi-nyang-backup-2026-10-08.jongi", "Jongi-nyang-back-up-2026-10-08.jongi"]);
  const stamp = new Date(2026, 9, 8, 14, 30).toISOString();
  assert.deepEqual(langs.map((lang) => exportedText(stamp, lang)), ["10월 8일 14:30", "Oct 8, 2:30 PM", "8 okt 14:30"]);
  assert.equal(exportedText("soon"), undefined);
});

test("reminder times in English and Dutch (same cases as ReminderTimeTextTests.swift)", () => {
  const now = new Date(2026, 8, 28, 9, 0);
  const scheduled = new Date(2026, 8, 28, 10, 21);
  const times = [scheduled, new Date(2026, 8, 29, 15, 30), new Date(2026, 9, 2, 9, 0), new Date(2027, 0, 2, 10, 21)];
  assert.deepEqual(times.map((time) => scheduledTime(time, now, "en")), ["Today 10:21 AM", "Tomorrow 3:30 PM", "Oct 2, 9:00 AM", "Jan 2, 2027, 10:21 AM"]);
  assert.deepEqual(times.map((time) => scheduledTime(time, now, "nl")), ["Vandaag 10:21", "Morgen 15:30", "2 okt 09:00", "2 jan 2027 10:21"]);
  assert.deepEqual(times.map((time) => compactTime(time, now, "en")), ["Today 10:21 AM", "Tomorrow 3:30 PM", "10/2 9:00 AM", "1/2/2027 10:21 AM"]);
  assert.deepEqual(times.map((time) => compactTime(time, now, "nl")), ["Vandaag 10:21", "Morgen 15:30", "2-10 09:00", "2-1-2027 10:21"]);
  const late = new Date(2026, 8, 28, 11, 0);
  const item = { id: "t", title: "task", isCompleted: false, createdAt: now.toISOString(), reminderAt: scheduled.toISOString() } as Parameters<typeof rowLabel>[0];
  assert.equal(rowLabel(item, now, "en"), "Today 10:21 AM");
  assert.equal(rowLabel(item, late, "en"), "Today 10:21 AM · reminder pending");
  assert.equal(rowLabel(item, late, "nl"), "Vandaag 10:21 · herinnering wacht");
  const sent = { ...item, reminderLastDeliveredAt: late.toISOString() };
  assert.equal(rowLabel(sent, late, "en"), "Reminder sent · Today 10:21 AM");
  assert.equal(rowLabel(sent, late, "nl"), "Herinnering verstuurd · Vandaag 10:21");
  const done = { ...sent, isCompleted: true };
  assert.equal(rowLabel(done, late, "en"), "Reminder off · Today 10:21 AM");
  assert.equal(rowLabel(done, late, "nl"), "Herinnering uit · Vandaag 10:21");
});

test("quick entry in English and Dutch (same cases as CoreTests.swift)", () => {
  const now = new Date(2026, 9, 1, 10, 0); // Thursday 10:00
  const pad = (value: number) => String(value).padStart(2, "0");
  const show = (date?: Date) => (date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}` : "-");
  const cases: [Lang, string, string, string, string, string][] = [
    ["en", "call mom tomorrow 3pm", "call mom", "2026-10-02 15:00", "-", "Reminder tomorrow at 3:00 PM"],
    ["en", "report by friday", "report", "-", "2026-10-02", "Due Fri, Oct 2"],
    ["en", "dentist at 3", "dentist", "2026-10-01 15:00", "-", "Reminder today at 3:00 PM"],
    ["en", "gym 9am", "gym", "2026-10-02 09:00", "-", "Reminder tomorrow at 9:00 AM"],
    ["en", "pay rent oct 12", "pay rent", "-", "2026-10-12", "Due Mon, Oct 12"],
    ["en", "trip 12 oct", "trip", "-", "2026-10-12", "Due Mon, Oct 12"],
    ["en", "taxes 10/15", "taxes", "-", "2026-10-15", "Due Thu, Oct 15"],
    ["en", "standup in 30 min", "standup", "2026-10-01 10:30", "-", "Reminder today at 10:30 AM"],
    ["en", "laundry in 2 hours", "laundry", "2026-10-01 12:00", "-", "Reminder today at 12:00 PM"],
    ["en", "review in an hour", "review", "2026-10-01 11:00", "-", "Reminder today at 11:00 AM"],
    ["en", "lunch with Sam at noon", "lunch with Sam", "2026-10-01 12:00", "-", "Reminder today at 12:00 PM"],
    ["en", "movie tonight", "movie", "2026-10-01 20:00", "-", "Reminder today at 8:00 PM"],
    ["en", "movie tonight at 9", "movie", "2026-10-01 21:00", "-", "Reminder today at 9:00 PM"],
    ["en", "cleanup this week", "cleanup", "-", "2026-10-04", "Due Sun, Oct 4"],
    ["en", "Party next week", "Party", "-", "2026-10-11", "Due Sun, Oct 11"],
    ["en", "invoice end of month", "invoice", "-", "2026-10-31", "Due Sat, Oct 31"],
    ["en", "plan next friday", "plan", "-", "2026-10-09", "Due Fri, Oct 9"],
    ["en", "plan on monday", "plan", "-", "2026-10-05", "Due Mon, Oct 5"],
    ["en", "buy milk today", "buy milk", "-", "-", "-"],
    ["en", "finish by today", "finish", "-", "2026-10-01", "Due Thu, Oct 1"],
    ["en", "read 3 books", "read 3 books", "-", "-", "-"],
    ["en", "tomorrow", "tomorrow", "-", "-", "-"],
    ["en", "meeting 15:30", "meeting", "2026-10-01 15:30", "-", "Reminder today at 3:30 PM"],
    ["en", "call 3:30pm", "call", "2026-10-01 15:30", "-", "Reminder today at 3:30 PM"],
    ["en", "dinner day after tomorrow", "dinner", "-", "2026-10-03", "Due Sat, Oct 3"],
    ["en", "Doctor appointment Tuesday at 4:30", "Doctor appointment", "2026-10-06 16:30", "-", "Reminder Tue, Oct 6 at 4:30 PM"],
    ["en", "Pay bills due Oct 20th", "Pay bills", "-", "2026-10-20", "Due Tue, Oct 20"],
    ["en", "send card before 12/25", "send card", "-", "2026-12-25", "Due Fri, Dec 25"],
    ["en", "Wed standup at 11:30am", "standup", "2026-10-07 11:30", "-", "Reminder Wed, Oct 7 at 11:30 AM"],
    ["en", "call at 7 o'clock", "call", "2026-10-02 07:00", "-", "Reminder tomorrow at 7:00 AM"],
    ["en", "sun cream", "sun cream", "-", "-", "-"],
    ["en", "회의 내일 3시", "회의", "2026-10-02 15:00", "-", "Reminder tomorrow at 3:00 PM"],
    ["nl", "mama bellen morgen om 3 uur", "mama bellen", "2026-10-02 15:00", "-", "Herinnering morgen om 15:00"],
    ["nl", "verslag tot vrijdag", "verslag", "-", "2026-10-02", "Deadline vr 2 okt"],
    ["nl", "vr presentatie", "presentatie", "-", "2026-10-02", "Deadline vr 2 okt"],
    ["nl", "tandarts om 15:00", "tandarts", "2026-10-01 15:00", "-", "Herinnering vandaag om 15:00"],
    ["nl", "sporten 9u", "sporten", "2026-10-02 09:00", "-", "Herinnering morgen om 09:00"],
    ["nl", "bellen 14u30", "bellen", "2026-10-01 14:30", "-", "Herinnering vandaag om 14:30"],
    ["nl", "huur 12 okt", "huur", "-", "2026-10-12", "Deadline ma 12 okt"],
    ["nl", "belasting 15/10", "belasting", "-", "2026-10-15", "Deadline do 15 okt"],
    ["nl", "cadeau voor 5 december", "cadeau", "-", "2026-12-05", "Deadline za 5 dec"],
    ["nl", "vergadering over 30 min", "vergadering", "2026-10-01 10:30", "-", "Herinnering vandaag om 10:30"],
    ["nl", "wassen over 2 uur", "wassen", "2026-10-01 12:00", "-", "Herinnering vandaag om 12:00"],
    ["nl", "kapper over een kwartier", "kapper", "2026-10-01 10:15", "-", "Herinnering vandaag om 10:15"],
    ["nl", "film vanavond", "film", "2026-10-01 20:00", "-", "Herinnering vandaag om 20:00"],
    ["nl", "film vanavond om 9 uur", "film", "2026-10-01 21:00", "-", "Herinnering vandaag om 21:00"],
    ["nl", "opruimen deze week", "opruimen", "-", "2026-10-04", "Deadline zo 4 okt"],
    ["nl", "factuur eind van de maand", "factuur", "-", "2026-10-31", "Deadline za 31 okt"],
    ["nl", "plannen volgende vrijdag", "plannen", "-", "2026-10-09", "Deadline vr 9 okt"],
    ["nl", "etentje overmorgen", "etentje", "-", "2026-10-03", "Deadline za 3 okt"],
    ["nl", "boodschappen vandaag", "boodschappen", "-", "-", "-"],
    ["nl", "afronden uiterlijk vandaag", "afronden", "-", "2026-10-01", "Deadline do 1 okt"],
    ["nl", "lunch om 12 uur ’s middags", "lunch", "2026-10-01 12:00", "-", "Herinnering vandaag om 12:00"],
    ["nl", "bellen 's middags om 2 uur", "bellen", "2026-10-01 14:00", "-", "Herinnering vandaag om 14:00"],
    ["nl", "afspraak op dinsdag om 4:30", "afspraak", "2026-10-06 16:30", "-", "Herinnering di 6 okt om 16:30"],
    ["nl", "3 boeken lezen", "3 boeken lezen", "-", "-", "-"],
    ["nl", "2 uur werk", "2 uur werk", "-", "-", "-"],
    ["nl", "zo doen", "zo doen", "-", "-", "-"],
    ["nl", "feest 3/25", "feest 3/25", "-", "-", "-"],
    ["nl", "회의 내일 3시", "회의", "2026-10-02 15:00", "-", "Herinnering morgen om 15:00"],
    ["ko", "taxes 10/15", "taxes", "-", "2026-10-15", "10월 15일 (목)까지"],
    ["ko", "call mom tomorrow 3pm", "call mom tomorrow 3pm", "-", "-", "-"],
  ];
  for (const [lang, text, title, alert, due, summary] of cases) {
    const result = parseQuick(text, now, lang);
    assert.equal(`${result.title} | ${show(result.reminderAt)} | ${result.dueDate ?? "-"} | ${result.summary ?? "-"}`, `${title} | ${alert} | ${due} | ${summary}`, `${lang} ${text}`);
  }
});

test("종이냥 한마디 in English and Dutch: the same line ids, the language's words (same cases as CoreTests.swift)", () => {
  const numbers = (values: number[]) => () => values.shift() ?? 0;
  const context = (hour: number, open: number, done: number, extra: Partial<ChatterContext> = {}): ChatterContext => ({ hour, open, done, overdue: 0, dueSoon: 0, weekday: 2, ...extra });
  const pick = (c: ChatterContext, questions: boolean, recent: string[], values: number[], lang: Lang): ChatterLine => pickChatter(c, questions, recent, numbers([...values]), lang);
  const start = context(10, 3, 0, { firstOpen: "Write report" });
  assert.equal(pick(start, false, [], [0, 0], "en").id, "p.start.0");
  assert.equal(pick(start, false, [], [0, 0], "en").text, "Shall we start with ‘Write report’?");
  assert.equal(pick(start, false, [], [0, 0], "nl").text, "Zullen we beginnen met ‘Write report’?");
  let line = pick(context(12, 2, 2, { firstOpen: "Groceries" }), true, [], [0.99, 0.35], "en");
  assert.equal(line.id, "q.first");
  assert.equal(line.text, "Do ‘Groceries’ now?");
  assert.deepEqual(line.answers.map((answer) => answer.label), ["I’ll try", "Later"]);
  line = pick(context(12, 2, 2, { firstOpen: "Boodschappen" }), true, [], [0.99, 0.35], "nl");
  assert.equal(line.text, "Nu ‘Boodschappen’ doen?");
  assert.deepEqual(line.answers.map((answer) => answer.label), ["Ik probeer het", "Straks"]);
  assert.deepEqual(line.answers.map((answer) => answer.pose), ["cheer", "blink"]);
  assert.equal(pick(context(9, 1, 1, { overdue: 2 }), false, [], [0.4, 0], "en").text, "2 past due. Shall we sort out one?");
  assert.equal(pick(context(9, 1, 1, { overdue: 2 }), false, [], [0.4, 0], "nl").text, "2 over de deadline. Zullen we er één oppakken?");
  assert.equal(pick(context(10, 1, 0, { firstOpen: "Clean out the garage this weekend" }), false, [], [0, 0], "en").text, "Shall we start with ‘Clean out the garage…’?");
  assert.equal(pick(context(10, 1, 0), false, [], [0, 0], "en").text, "Shall we start with ‘first to-do’?");
  assert.equal(pick(context(10, 1, 0), false, [], [0, 0], "nl").text, "Zullen we beginnen met ‘eerste taak’?");
  line = pick(context(14, 3, 2), true, [], [0.99, 0.35], "nl");
  assert.equal(line.id, "q.rest");
  assert.equal(line.answers[0].action, "rest5");
  assert.equal(line.answers[0].reply, "Fijn! Ik zet een timer van 5 minuten.");
  const roomy = context(14, 2, 1, { weekday: 3, nextEvent: "Team meeting", nextIn: 50, eventsLeft: 1 });
  line = pick(roomy, true, ["q.mood", "q.water", "q.stretch", "q.first", "q.rest", "q.eyes", "q.walk", "q.music", "q.pet", "q.snack"], [0.99, 0.99], "en");
  assert.equal(line.id, "q.focus");
  assert.equal(line.text, "50 min until your next event.\nFocus for 25 minutes?");
  assert.equal(line.answers[0].action, "focus25");
  assert.equal(pettedChatter(() => 0.15, "en").text, "Purrrr…");
  assert.equal(pettedChatter(() => 0.75, "nl").text, "Mrauw~");
  assert.equal(pettedChatter(() => 0.75, "en").id, pettedChatter(() => 0.75).id);
  // Every pick has the same id in every language, with every placeholder filled.
  const contexts = [
    context(8, 0, 0), context(12, 0, 3), context(15, 4, 0, { firstOpen: "Write report" }),
    context(19, 1, 2, { overdue: 1, firstOpen: "Call Mia", weekday: 1 }), context(21, 2, 1, { dueSoon: 2, weekday: 5 }),
    context(10, 2, 1, { weekday: 0, nextEvent: "Standup", nextIn: 12, eventsLeft: 3 }),
    context(16, 3, 0, { weekday: 3, nextEvent: "Review", nextIn: 90, nowEvent: "Lunch", eventsLeft: 2 }),
    context(13, 1, 1, { weekday: 6, endedEvent: "Dentist" }),
  ];
  let checked = 0;
  for (const c of contexts) {
    for (let i = 0; i < 15; i += 1) {
      for (let k = 0; k < 8; k += 1) {
        const lines = langs.map((lang) => pick(c, true, [], [i * 0.07, k * 0.13], lang));
        assert.equal(new Set(lines.map((entry) => entry.id)).size, 1, lines.map((entry) => entry.id).join(" "));
        for (const other of lines.slice(1)) {
          assert.ok(!other.text.includes("{") && !/[가-힣]/.test(other.text), `${other.id}: ${other.text}`);
          assert.deepEqual(other.answers.map((answer) => [answer.pose, answer.action]), lines[0].answers.map((answer) => [answer.pose, answer.action]));
        }
        checked += 1;
      }
    }
  }
  assert.equal(checked, 960);
});

test("bubble lines in English and Dutch break at spaces, never inside words or quotes (same cases as CoreTests.swift)", () => {
  const cases: [Lang, string, string][] = [
    ["en", "The first check is the hardest. You’ve got this!", "The first check\nis the hardest.\nYou’ve got this!"],
    ["en", "Shall we start with ‘Clean out the garage…’?", "Shall we start with\n‘Clean out the garage…’?"],
    ["en", "‘Write report’ might go quicker than you think.", "‘Write report’ might go\nquicker than you think."],
    ["en", "Catch your breath, then ‘Write report’?", "Catch your breath,\nthen ‘Write report’?"],
    ["en", "I’m right here. Call me if you need me.", "I’m right here.\nCall me if you need me."],
    ["en", "Meow.", "Meow."],
    ["en", "Afternoon sun is perfect for a nap… oh right, work.", "Afternoon sun is\nperfect for a nap…\noh right, work."],
    ["en", "Nothing to do?\nResting counts too.", "Nothing to do?\nResting counts too."],
    ["en", "Is ‘Weekly design review…’ over? Good job!", "Is ‘Weekly design review…’\nover? Good job!"],
    ["en", "Write tomorrow’s to-dos now and the morning gets easier.", "Write tomorrow’s to-dos now\nand the morning gets easier."],
    ["nl", "Het eerste vinkje is het moeilijkst. Jij kunt het!", "Het eerste vinkje\nis het moeilijkst.\nJij kunt het!"],
    ["nl", "’s Middags word je slaperig. Even rekken!", "’s Middags word je slaperig.\nEven rekken!"],
    ["nl", "Even op adem komen, dan ‘Verslag schrijven’?", "Even op adem komen,\ndan ‘Verslag schrijven’?"],
    ["nl", "Zullen we beginnen met ‘Garage opruimen dit wee…’?", "Zullen we beginnen met\n‘Garage opruimen dit wee…’?"],
    ["nl", "Je bent ‘Teamoverleg’ toch niet vergeten? Ik onthoud het.", "Je bent ‘Teamoverleg’\ntoch niet vergeten?\nIk onthoud het."],
    ["nl", "Dat je vandaag al zo ver bent, knap hoor.", "Dat je vandaag al zo\nver bent, knap hoor."],
    ["ko", "첫 번째 체크가 제일 어려워요. 할 수 있어요!", "첫 번째 체크가 제일 어려워요.\n할 수 있어요!"],
  ];
  for (const [lang, text, wrapped] of cases) assert.equal(wrapBubble(text, lang), wrapped, `${lang} ${text}`);
});
