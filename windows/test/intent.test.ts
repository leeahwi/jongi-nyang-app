import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addedText, chipText, emptyIntentMemory, intentProblem, learnSwitch, preferenceKey, readIntent, switchText,
  type Candidate, type IntentKind, type IntentMemory, type IntentPrefer,
} from "../src/core/intent";
import type { Lang } from "../src/core/lang";

/**
 * 입력 줄: the shared cases of intent-cases.md (written by the macOS side; both
 * apps pass every row exactly), in its notation, then the Windows extras.
 */

// Thursday 8 October 2026, 14:50.
const now = new Date(2026, 9, 8, 14, 50);
const pad = (value: number) => String(value).padStart(2, "0");
const day = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const hm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** A candidate in the cases file's notation, with its chip. */
function notation(candidate: Candidate, lang: Lang): string {
  const chip = `⟨${chipText(candidate, now, lang)}⟩`;
  switch (candidate.kind) {
    case "todo": {
      const parts = [`todo ${JSON.stringify(candidate.title)}`];
      if (candidate.range) parts.push(`range ${candidate.range.day} ${hm(candidate.range.start)}–${hm(candidate.range.end)}`);
      if (candidate.reminderAt) parts.push(`reminder ${day(candidate.reminderAt)} ${pad(candidate.reminderAt.getHours())}:${pad(candidate.reminderAt.getMinutes())}`);
      if (candidate.dueDate) parts.push(`due ${candidate.dueDate}`);
      return `${parts.join(" ")} ${chip}`;
    }
    case "event": return `event ${JSON.stringify(candidate.title)} ${candidate.day} ${candidate.allDay ? "all-day" : `${hm(candidate.start)}–${hm(candidate.end)}`}${candidate.repeat ? ` ${candidate.repeat}` : ""} ${chip}`;
    case "timer": return `timer ${candidate.minutes}${candidate.title ? ` ${JSON.stringify(candidate.title)}` : ""} ${chip}`;
    case "alarm": return `alarm ${candidate.time} [${candidate.days.join(",")}] ${JSON.stringify(candidate.label)} ${chip}`;
    case "memo": return `memo ${JSON.stringify(candidate.text)} ${chip}`;
    case "repeat": {
      const rule = candidate.rule.kind === "weekly" ? `weekly [${(candidate.rule.weekdays ?? []).join(",")}]` : candidate.rule.kind === "monthly" ? `monthly ${candidate.rule.monthDay}` : candidate.rule.kind;
      return `repeat ${JSON.stringify(candidate.title)} ${rule}${candidate.time ? ` ${candidate.time}` : ""} ${chip}`;
    }
  }
}

const problemNames: Record<string, Record<Lang, string>> = {
  alarmTime: { ko: "알람 시간을 알아듣지 못했어요", en: "Couldn’t read the alarm time", nl: "Kon de wektijd niet lezen" },
  timerLength: { ko: "타이머 길이를 알아듣지 못했어요", en: "Couldn’t read the timer length", nl: "Kon de timerduur niet lezen" },
  repeat: { ko: "반복을 알아듣지 못했어요", en: "Couldn’t read the repeat", nl: "Kon de herhaling niet lezen" },
};

/** [#, language, input, prefer, expected, problem] — copied from intent-cases.md. */
const cases: [number, Lang, string, IntentPrefer, string, string][] = [
  [1, "ko", "내일 3시 회의", {}, "event \"회의\" 2026-10-09 15:00–16:00 ⟨일정 · 내일(금) 15:00–16:00⟩; todo \"회의\" reminder 2026-10-09 15:00 ⟨할 일 · 알림 내일 15:00⟩", "-"],
  [2, "ko", "내일 3시 장보기", {}, "todo \"장보기\" reminder 2026-10-09 15:00 ⟨할 일 · 알림 내일 15:00⟩; event \"장보기\" 2026-10-09 15:00–16:00 ⟨일정 · 내일(금) 15:00–16:00⟩", "-"],
  [3, "ko", "금요일까지 보고서", {}, "todo \"보고서\" due 2026-10-09 ⟨할 일 · 마감 10월 9일⟩; event \"보고서\" 2026-10-09 all-day ⟨일정 · 10월 9일 종일⟩", "-"],
  [4, "ko", "장보기", {}, "todo \"장보기\" ⟨할 일⟩; memo \"장보기\" ⟨메모로 남기기⟩", "-"],
  [5, "ko", "15:30 치과", {}, "event \"치과\" 2026-10-08 15:30–16:30 ⟨일정 · 오늘(목) 15:30–16:30⟩; todo \"치과\" reminder 2026-10-08 15:30 ⟨할 일 · 알림 15:30⟩", "-"],
  [6, "ko", "타이머 40", {}, "timer 40 ⟨40분 타이머 시작⟩; todo \"타이머 40\" ⟨할 일⟩", "-"],
  [7, "ko", "40분 집중", {}, "timer 40 ⟨40분 타이머 시작⟩; todo \"40분 집중\" ⟨할 일⟩", "-"],
  [8, "ko", "집중 1:30", {}, "timer 90 ⟨1시간 30분 타이머 시작⟩; todo \"집중\" reminder 2026-10-09 01:30 ⟨할 일 · 알림 내일 01:30⟩", "-"],
  [9, "ko", "보고서 25분 집중", {}, "timer 25 \"보고서\" ⟨25분 집중 · 보고서⟩; todo \"보고서 25분 집중\" ⟨할 일⟩", "-"],
  [10, "ko", "40분 타이머", {}, "timer 40 ⟨40분 타이머 시작⟩; todo \"40분 타이머\" ⟨할 일⟩", "-"],
  [11, "ko", "알람 7시", {}, "alarm 07:00 [] \"\" ⟨알람 · 내일 오전 7:00⟩; todo \"알람\" reminder 2026-10-09 07:00 ⟨할 일 · 알림 내일 07:00⟩", "-"],
  [12, "ko", "알람 오전 7:30 평일", {}, "alarm 07:30 [1,2,3,4,5] \"\" ⟨알람 · 평일 오전 7:30⟩; todo \"알람 평일\" reminder 2026-10-09 07:30 ⟨할 일 · 알림 내일 07:30⟩", "-"],
  [13, "ko", "알람 6시 월수금 약", {}, "alarm 06:00 [1,3,5] \"약\" ⟨알람 · 월·수·금 오전 6:00⟩; todo \"알람 월수금 약\" reminder 2026-10-08 18:00 ⟨할 일 · 알림 18:00⟩", "-"],
  [14, "ko", "알람 7시 주말", {}, "alarm 07:00 [0,6] \"\" ⟨알람 · 주말 오전 7:00⟩; todo \"알람 주말\" reminder 2026-10-09 07:00 ⟨할 일 · 알림 내일 07:00⟩", "-"],
  [15, "ko", "알람 7시 기상", {}, "alarm 07:00 [] \"기상\" ⟨알람 · 내일 오전 7:00⟩; todo \"알람 기상\" reminder 2026-10-09 07:00 ⟨할 일 · 알림 내일 07:00⟩", "-"],
  [16, "ko", "/메모 내일 3시 회의", {}, "memo \"내일 3시 회의\" ⟨메모로 남기기⟩", "-"],
  [17, "ko", "/알람 abc", {}, "[]", "alarmTime"],
  [18, "ko", "/타이머 0", {}, "[]", "timerLength"],
  [19, "ko", "/할일 내일 3시 회의", {}, "todo \"회의\" reminder 2026-10-09 15:00 ⟨할 일 · 알림 내일 15:00⟩", "-"],
  [20, "ko", "/일정 장보기", {}, "event \"장보기\" 2026-10-08 15:00–16:00 ⟨일정 · 오늘(목) 15:00–16:00⟩", "-"],
  [21, "ko", "장보기\n우유, 달걀", {}, "memo \"장보기\\n우유, 달걀\" ⟨메모로 남기기⟩; todo \"장보기\" ⟨할 일⟩", "-"],
  [22, "ko", "   ", {}, "[]", "-"],
  [23, "ko", "내일 3시 장보기", {"장보기": "event"}, "event \"장보기\" 2026-10-09 15:00–16:00 ⟨일정 · 내일(금) 15:00–16:00⟩; todo \"장보기\" reminder 2026-10-09 15:00 ⟨할 일 · 알림 내일 15:00⟩", "-"],
  [24, "ko", "내일 3시 회의", {"회의": "todo"}, "todo \"회의\" reminder 2026-10-09 15:00 ⟨할 일 · 알림 내일 15:00⟩; event \"회의\" 2026-10-09 15:00–16:00 ⟨일정 · 내일(금) 15:00–16:00⟩", "-"],
  [25, "ko", "/timer 25", {}, "todo \"/timer 25\" ⟨할 일⟩; memo \"/timer 25\" ⟨메모로 남기기⟩", "-"],
  [26, "ko", "/메모", {}, "[]", "-"],
  [27, "en", "meeting tomorrow 3pm", {}, "event \"meeting\" 2026-10-09 15:00–16:00 ⟨Event · tomorrow (Fri) 3:00–4:00 PM⟩; todo \"meeting\" reminder 2026-10-09 15:00 ⟨To-do · reminder tomorrow 3:00 PM⟩", "-"],
  [28, "en", "call mom at 4", {}, "event \"call mom\" 2026-10-08 16:00–17:00 ⟨Event · today (Thu) 4:00–5:00 PM⟩; todo \"call mom\" reminder 2026-10-08 16:00 ⟨To-do · reminder 4:00 PM⟩", "-"],
  [29, "en", "buy milk tomorrow 9am", {}, "todo \"buy milk\" reminder 2026-10-09 09:00 ⟨To-do · reminder tomorrow 9:00 AM⟩; event \"buy milk\" 2026-10-09 09:00–10:00 ⟨Event · tomorrow (Fri) 9:00–10:00 AM⟩", "-"],
  [30, "en", "report by friday", {}, "todo \"report\" due 2026-10-09 ⟨To-do · due Oct 9⟩; event \"report\" 2026-10-09 all-day ⟨Event · Oct 9 all day⟩", "-"],
  [31, "en", "buy milk", {}, "todo \"buy milk\" ⟨To-do⟩; memo \"buy milk\" ⟨Save as a note⟩", "-"],
  [32, "en", "timer 40", {}, "timer 40 ⟨Start a 40 min timer⟩; todo \"timer 40\" ⟨To-do⟩", "-"],
  [33, "en", "25 min focus", {}, "timer 25 ⟨Start a 25 min timer⟩; todo \"25 min focus\" ⟨To-do⟩", "-"],
  [34, "en", "focus 1:30", {}, "timer 90 ⟨Start a 1 h 30 min timer⟩; todo \"focus\" reminder 2026-10-09 01:30 ⟨To-do · reminder tomorrow 1:30 AM⟩", "-"],
  [35, "en", "40 min timer", {}, "timer 40 ⟨Start a 40 min timer⟩; todo \"40 min timer\" ⟨To-do⟩", "-"],
  [36, "en", "alarm 7am", {}, "alarm 07:00 [] \"\" ⟨Alarm · tomorrow 7:00 AM⟩; todo \"alarm\" reminder 2026-10-09 07:00 ⟨To-do · reminder tomorrow 7:00 AM⟩", "-"],
  [37, "en", "alarm 7:30 weekdays", {}, "alarm 07:30 [1,2,3,4,5] \"\" ⟨Alarm · weekdays 7:30 AM⟩; todo \"alarm weekdays\" reminder 2026-10-09 07:30 ⟨To-do · reminder tomorrow 7:30 AM⟩", "-"],
  [38, "en", "alarm 7 every day", {}, "alarm 07:00 [0,1,2,3,4,5,6] \"\" ⟨Alarm · every day 7:00 AM⟩; todo \"alarm 7 every day\" ⟨To-do⟩", "-"],
  [39, "en", "/note call the bank", {}, "memo \"call the bank\" ⟨Save as a note⟩", "-"],
  [40, "en", "/alarm soon", {}, "[]", "alarmTime"],
  [41, "en", "/타이머 25", {}, "timer 25 ⟨Start a 25 min timer⟩", "-"],
  [42, "en", "/event dentist friday", {}, "event \"dentist\" 2026-10-09 all-day ⟨Event · Oct 9 all day⟩", "-"],
  [43, "en", "groceries\nmilk, eggs", {}, "memo \"groceries\\nmilk, eggs\" ⟨Save as a note⟩; todo \"groceries\" ⟨To-do⟩", "-"],
  [44, "en", "buy milk tomorrow 9am", {"buy": "event"}, "event \"buy milk\" 2026-10-09 09:00–10:00 ⟨Event · tomorrow (Fri) 9:00–10:00 AM⟩; todo \"buy milk\" reminder 2026-10-09 09:00 ⟨To-do · reminder tomorrow 9:00 AM⟩", "-"],
  [45, "en", "/taak x", {}, "todo \"/taak x\" ⟨To-do⟩; memo \"/taak x\" ⟨Save as a note⟩", "-"],
  [46, "en", "", {}, "[]", "-"],
  [47, "en", "/timer 0", {}, "[]", "timerLength"],
  [48, "nl", "morgen om 3 uur overleg", {}, "event \"overleg\" 2026-10-09 15:00–16:00 ⟨Afspraak · morgen (vr) 15:00–16:00⟩; todo \"overleg\" reminder 2026-10-09 15:00 ⟨Taak · herinnering morgen 15:00⟩", "-"],
  [49, "nl", "boodschappen morgen om 9 uur", {}, "todo \"boodschappen\" reminder 2026-10-09 09:00 ⟨Taak · herinnering morgen 09:00⟩; event \"boodschappen\" 2026-10-09 09:00–10:00 ⟨Afspraak · morgen (vr) 09:00–10:00⟩", "-"],
  [50, "nl", "verslag tot vrijdag", {}, "todo \"verslag\" due 2026-10-09 ⟨Taak · deadline 9 okt⟩; event \"verslag\" 2026-10-09 all-day ⟨Afspraak · 9 okt hele dag⟩", "-"],
  [51, "nl", "boodschappen", {}, "todo \"boodschappen\" ⟨Taak⟩; memo \"boodschappen\" ⟨Bewaren als notitie⟩", "-"],
  [52, "nl", "timer 40", {}, "timer 40 ⟨Timer van 40 min starten⟩; todo \"timer 40\" ⟨Taak⟩", "-"],
  [53, "nl", "40 min timer", {}, "timer 40 ⟨Timer van 40 min starten⟩; todo \"40 min timer\" ⟨Taak⟩", "-"],
  [54, "nl", "focus 25", {}, "timer 25 ⟨Timer van 25 min starten⟩; todo \"focus 25\" ⟨Taak⟩", "-"],
  [55, "nl", "wekker 7:00", {}, "alarm 07:00 [] \"\" ⟨Wekker · morgen 07:00⟩; todo \"wekker\" reminder 2026-10-09 07:00 ⟨Taak · herinnering morgen 07:00⟩", "-"],
  [56, "nl", "wekker 7 uur doordeweeks", {}, "alarm 07:00 [1,2,3,4,5] \"\" ⟨Wekker · doordeweeks 07:00⟩; todo \"wekker 7 uur doordeweeks\" ⟨Taak⟩", "-"],
  [57, "nl", "/notitie bel de bank", {}, "memo \"bel de bank\" ⟨Bewaren als notitie⟩", "-"],
  [58, "nl", "/wekker abc", {}, "[]", "alarmTime"],
  [59, "nl", "/timer 0", {}, "[]", "timerLength"],
  [60, "nl", "tandarts om 15:00", {}, "event \"tandarts\" 2026-10-08 15:00–16:00 ⟨Afspraak · vandaag (do) 15:00–16:00⟩; todo \"tandarts\" reminder 2026-10-08 15:00 ⟨Taak · herinnering 15:00⟩", "-"],
  [61, "nl", "/afspraak etentje", {}, "event \"etentje\" 2026-10-08 15:00–16:00 ⟨Afspraak · vandaag (do) 15:00–16:00⟩", "-"],
  [62, "nl", "lijstje\nmelk, eieren", {}, "memo \"lijstje\\nmelk, eieren\" ⟨Bewaren als notitie⟩; todo \"lijstje\" ⟨Taak⟩", "-"],
  [63, "nl", "morgen om 3 uur overleg", {"overleg": "todo"}, "todo \"overleg\" reminder 2026-10-09 15:00 ⟨Taak · herinnering morgen 15:00⟩; event \"overleg\" 2026-10-09 15:00–16:00 ⟨Afspraak · morgen (vr) 15:00–16:00⟩", "-"],
  [64, "nl", "알람 7시 매일", {}, "alarm 07:00 [0,1,2,3,4,5,6] \"\" ⟨Wekker · elke dag 07:00⟩; todo \"알람 매일\" reminder 2026-10-09 07:00 ⟨Taak · herinnering morgen 07:00⟩", "-"],
  [65, "nl", "/할일 내일 3시 회의", {}, "todo \"회의\" reminder 2026-10-09 15:00 ⟨Taak · herinnering morgen 15:00⟩", "-"],
  [66, "nl", "  ", {}, "[]", "-"],
  // Added by Windows (stage 4): a focus on something — the focus word first or in the middle, a longer length.
  [101, "ko", "집중 25분 보고서", {}, "timer 25 \"보고서\" ⟨25분 집중 · 보고서⟩; todo \"집중 25분 보고서\" ⟨할 일⟩", "-"],
  [102, "ko", "25분 집중 보고서", {}, "timer 25 \"보고서\" ⟨25분 집중 · 보고서⟩; todo \"25분 집중 보고서\" ⟨할 일⟩", "-"],
  [103, "ko", "집중 1시간 30분 보고서 쓰기", {}, "timer 90 \"보고서 쓰기\" ⟨1시간 30분 집중 · 보고서 쓰기⟩; todo \"집중 1시간 30분 보고서 쓰기\" ⟨할 일⟩", "-"],
  [104, "ko", "집중 보고서", {}, "todo \"집중 보고서\" ⟨할 일⟩; memo \"집중 보고서\" ⟨메모로 남기기⟩", "-"],
  [105, "en", "focus 25 report", {}, "timer 25 \"report\" ⟨Focus 25 min · report⟩; todo \"focus 25 report\" ⟨To-do⟩", "-"],
  [106, "en", "25 min focus report", {}, "timer 25 \"report\" ⟨Focus 25 min · report⟩; todo \"25 min focus report\" ⟨To-do⟩", "-"],
  [107, "en", "report 25 min focus", {}, "timer 25 \"report\" ⟨Focus 25 min · report⟩; todo \"report 25 min focus\" ⟨To-do⟩", "-"],
  [108, "en", "focus 1 h 30 min write report", {}, "timer 90 \"write report\" ⟨Focus 1 h 30 min · write report⟩; todo \"focus 1 h 30 min write report\" ⟨To-do⟩", "-"],
  [109, "nl", "focus 25 rapport", {}, "timer 25 \"rapport\" ⟨25 min focussen · rapport⟩; todo \"focus 25 rapport\" ⟨Taak⟩", "-"],
  [110, "nl", "rapport 25 min focus", {}, "timer 25 \"rapport\" ⟨25 min focussen · rapport⟩; todo \"rapport 25 min focus\" ⟨Taak⟩", "-"],
  [111, "nl", "25 min focus rapport", {}, "timer 25 \"rapport\" ⟨25 min focussen · rapport⟩; todo \"25 min focus rapport\" ⟨Taak⟩", "-"],
  // Added by Mac (stage 4).
  [112, "ko", "집중 25분 보고서 쓰기", {}, "timer 25 \"보고서 쓰기\" ⟨25분 집중 · 보고서 쓰기⟩; todo \"집중 25분 보고서 쓰기\" ⟨할 일⟩", "-"],
  [113, "ko", "보고서 1시간 반 집중", {}, "timer 90 \"보고서\" ⟨1시간 30분 집중 · 보고서⟩; todo \"보고서 1시간 반 집중\" ⟨할 일⟩", "-"],
  [114, "ko", "타이머 25 보고서", {}, "todo \"타이머 25 보고서\" ⟨할 일⟩; memo \"타이머 25 보고서\" ⟨메모로 남기기⟩", "-"],
  [115, "en", "focus 25 min write the report", {}, "timer 25 \"write the report\" ⟨Focus 25 min · write the report⟩; todo \"focus 25 min write the report\" ⟨To-do⟩", "-"],
  [116, "en", "timer 25 report", {}, "todo \"timer 25 report\" ⟨To-do⟩; memo \"timer 25 report\" ⟨Save as a note⟩", "-"],
  [117, "nl", "25 min focus rapport afmaken", {}, "timer 25 \"rapport afmaken\" ⟨25 min focussen · rapport afmaken⟩; todo \"25 min focus rapport afmaken\" ⟨Taak⟩", "-"],
  [118, "nl", "focus 1 uur rapport", {}, "timer 60 \"rapport\" ⟨1 u focussen · rapport⟩; todo \"focus 1 uur rapport\" ⟨Taak⟩", "-"],
  // Added by Windows (1.23 편의 기능): repeats from the line, Korean relative times.
  [201, "ko", "매일 물 마시기", {}, "repeat \"물 마시기\" daily ⟨반복 할 일 · 매일⟩; todo \"매일 물 마시기\" ⟨할 일⟩", "-"],
  [202, "ko", "매주 월 9시 주간 회의", {}, "event \"주간 회의\" 2026-10-12 09:00–10:00 weekly ⟨반복 일정 · 매주 월 09:00–10:00⟩; repeat \"주간 회의\" weekly [1] 09:00 ⟨반복 할 일 · 매주 월 09:00⟩; todo \"매주 월 주간 회의\" reminder 2026-10-09 09:00 ⟨할 일 · 알림 내일 09:00⟩", "-"],
  [203, "ko", "평일 8시 운동", {}, "repeat \"운동\" weekdays 08:00 ⟨반복 할 일 · 평일 08:00⟩; todo \"평일 운동\" reminder 2026-10-09 08:00 ⟨할 일 · 알림 내일 08:00⟩", "-"],
  [204, "ko", "/반복 매일 9시 약 먹기", {}, "repeat \"약 먹기\" daily 09:00 ⟨반복 할 일 · 매일 09:00⟩", "-"],
  [205, "ko", "/반복 약 먹기", {}, "[]", "repeat"],
  [206, "ko", "매일", {}, "todo \"매일\" ⟨할 일⟩; memo \"매일\" ⟨메모로 남기기⟩", "-"],
  [207, "ko", "매월 15일 카드값 내기", {}, "repeat \"카드값 내기\" monthly 15 ⟨반복 할 일 · 매월 15일⟩; todo \"매월 15일 카드값 내기\" ⟨할 일⟩", "-"],
  [208, "ko", "매주 월수금 3시 수영", {}, "repeat \"수영\" weekly [1,3,5] 15:00 ⟨반복 할 일 · 매주 월·수·금 15:00⟩; todo \"매주 월수금 수영\" reminder 2026-10-08 15:00 ⟨할 일 · 알림 15:00⟩", "-"],
  [209, "ko", "주말 10시 청소", {}, "repeat \"청소\" weekly [0,6] 10:00 ⟨반복 할 일 · 매주 토·일 10:00⟩; todo \"주말 청소\" reminder 2026-10-09 10:00 ⟨할 일 · 알림 내일 10:00⟩", "-"],
  [210, "ko", "매일 9시 약 먹기", {}, "repeat \"약 먹기\" daily 09:00 ⟨반복 할 일 · 매일 09:00⟩; todo \"매일 약 먹기\" reminder 2026-10-09 09:00 ⟨할 일 · 알림 내일 09:00⟩; event \"약 먹기\" 2026-10-08 09:00–10:00 daily ⟨반복 일정 · 매일 09:00–10:00⟩", "-"],
  [211, "ko", "매주 회의", {}, "todo \"매주 회의\" ⟨할 일⟩; memo \"매주 회의\" ⟨메모로 남기기⟩", "-"],
  [212, "ko", "매주 금요일 저녁 7시 영화", {}, "event \"영화\" 2026-10-09 19:00–20:00 weekly ⟨반복 일정 · 매주 금 19:00–20:00⟩; repeat \"영화\" weekly [5] 19:00 ⟨반복 할 일 · 매주 금 19:00⟩; todo \"매주 영화\" reminder 2026-10-09 19:00 ⟨할 일 · 알림 내일 19:00⟩", "-"],
  [213, "en", "every day drink water", {}, "repeat \"drink water\" daily ⟨Repeating to-do · every day⟩; todo \"every day drink water\" ⟨To-do⟩", "-"],
  [214, "en", "every Monday 9am team meeting", {}, "event \"team meeting\" 2026-10-12 09:00–10:00 weekly ⟨Repeating event · every Mon 9:00–10:00 AM⟩; repeat \"team meeting\" weekly [1] 09:00 ⟨Repeating to-do · every Mon 9:00 AM⟩; todo \"every team meeting\" reminder 2026-10-12 09:00 ⟨To-do · reminder Mon, Oct 12 9:00 AM⟩", "-"],
  [215, "en", "weekdays 8am workout", {}, "repeat \"workout\" weekdays 08:00 ⟨Repeating to-do · weekdays 8:00 AM⟩; todo \"weekdays workout\" reminder 2026-10-09 08:00 ⟨To-do · reminder tomorrow 8:00 AM⟩", "-"],
  [216, "en", "/repeat every friday 5pm review", {}, "repeat \"review\" weekly [5] 17:00 ⟨Repeating to-do · every Fri 5:00 PM⟩", "-"],
  [217, "en", "every monday and thursday at 6 gym", {}, "repeat \"gym\" weekly [1,4] 18:00 ⟨Repeating to-do · every Mon, Thu 6:00 PM⟩; todo \"every and thursday gym\" reminder 2026-10-12 18:00 ⟨To-do · reminder Mon, Oct 12 6:00 PM⟩", "-"],
  [218, "en", "every month on the 1st pay rent", {}, "repeat \"pay rent\" monthly 1 ⟨Repeating to-do · every month on the 1st⟩; todo \"every month on the 1st pay rent\" ⟨To-do⟩", "-"],
  [219, "en", "매일 물 마시기", {}, "repeat \"물 마시기\" daily ⟨Repeating to-do · every day⟩; todo \"매일 물 마시기\" ⟨To-do⟩", "-"],
  [220, "nl", "elke dag water drinken", {}, "repeat \"water drinken\" daily ⟨Herhalende taak · elke dag⟩; todo \"elke dag water drinken\" ⟨Taak⟩", "-"],
  [221, "nl", "elke maandag 9 uur overleg", {}, "event \"overleg\" 2026-10-12 09:00–10:00 weekly ⟨Herhalende afspraak · elke ma 09:00–10:00⟩; repeat \"overleg\" weekly [1] 09:00 ⟨Herhalende taak · elke ma 09:00⟩; todo \"elke 9 uur overleg\" due 2026-10-12 ⟨Taak · deadline 12 okt⟩", "-"],
  [222, "nl", "doordeweeks 8 uur sporten", {}, "repeat \"sporten\" weekdays 08:00 ⟨Herhalende taak · werkdagen 08:00⟩; todo \"doordeweeks 8 uur sporten\" ⟨Taak⟩", "-"],
  [223, "nl", "elke dinsdag en donderdag om 7 uur hardlopen", {}, "repeat \"hardlopen\" weekly [2,4] 07:00 ⟨Herhalende taak · elke di, do 07:00⟩; todo \"elke en donderdag hardlopen\" reminder 2026-10-13 07:00 ⟨Taak · herinnering di 13 okt 07:00⟩", "-"],
  [224, "nl", "/herhaal elke dag", {}, "[]", "repeat"],
  [225, "ko", "30분 뒤 빨래 꺼내기", {}, "todo \"빨래 꺼내기\" reminder 2026-10-08 15:20 ⟨할 일 · 알림 15:20⟩; event \"빨래 꺼내기\" 2026-10-08 15:20–16:20 ⟨일정 · 오늘(목) 15:20–16:20⟩", "-"],
  [226, "ko", "2시간 뒤 회의 준비", {}, "event \"회의 준비\" 2026-10-08 16:50–17:50 ⟨일정 · 오늘(목) 16:50–17:50⟩; todo \"회의 준비\" reminder 2026-10-08 16:50 ⟨할 일 · 알림 16:50⟩", "-"],
  [227, "en", "laundry in 30 min", {}, "todo \"laundry\" reminder 2026-10-08 15:20 ⟨To-do · reminder 3:20 PM⟩; event \"laundry\" 2026-10-08 15:20–16:20 ⟨Event · today (Thu) 3:20–4:20 PM⟩", "-"],
  [228, "nl", "over een kwartier was ophalen", {}, "todo \"was ophalen\" reminder 2026-10-08 15:05 ⟨Taak · herinnering 15:05⟩; event \"was ophalen\" 2026-10-08 15:05–16:05 ⟨Afspraak · vandaag (do) 15:05–16:05⟩", "-"],
  // 1.24 시간 정하기: time ranges on the line (intent-cases.md 301–, timeblock-cases.md §4).
  [301, "ko", "3시부터 5시까지 보고서", {}, 'todo "보고서" range 2026-10-08 15:00–17:00 reminder 2026-10-08 15:00 ⟨할 일 · 오늘 15:00–17:00⟩; event "보고서" 2026-10-08 15:00–17:00 ⟨일정 · 오늘(목) 15:00–17:00⟩', "-"],
  [302, "ko", "14:00-15:30 보고서", {}, 'todo "보고서" range 2026-10-08 14:00–15:30 ⟨할 일 · 오늘 14:00–15:30⟩; event "보고서" 2026-10-08 14:00–15:30 ⟨일정 · 오늘(목) 14:00–15:30⟩', "-"],
  [303, "ko", "보고서 2시~4시", {}, 'todo "보고서" range 2026-10-08 14:00–16:00 ⟨할 일 · 오늘 14:00–16:00⟩; event "보고서" 2026-10-08 14:00–16:00 ⟨일정 · 오늘(목) 14:00–16:00⟩', "-"],
  [304, "ko", "오후 2시부터 1시간 보고서", {}, 'todo "보고서" range 2026-10-08 14:00–15:00 ⟨할 일 · 오늘 14:00–15:00⟩; event "보고서" 2026-10-08 14:00–15:00 ⟨일정 · 오늘(목) 14:00–15:00⟩', "-"],
  [305, "ko", "내일 3시부터 5시까지 회의", {}, 'event "회의" 2026-10-09 15:00–17:00 ⟨일정 · 내일(금) 15:00–17:00⟩; todo "회의" range 2026-10-09 15:00–17:00 reminder 2026-10-09 15:00 due 2026-10-09 ⟨할 일 · 내일 15:00–17:00⟩', "-"],
  [306, "ko", "9시~10시 운동", {}, 'todo "운동" range 2026-10-09 09:00–10:00 reminder 2026-10-09 09:00 due 2026-10-09 ⟨할 일 · 내일 09:00–10:00⟩; event "운동" 2026-10-09 09:00–10:00 ⟨일정 · 내일(금) 09:00–10:00⟩', "-"],
  [307, "ko", "오후 7시부터 9시까지 청소", {}, 'todo "청소" range 2026-10-08 19:00–21:00 reminder 2026-10-08 19:00 ⟨할 일 · 오늘 19:00–21:00⟩; event "청소" 2026-10-08 19:00–21:00 ⟨일정 · 오늘(목) 19:00–21:00⟩', "-"],
  [308, "ko", "1~2시간 독서", {}, 'todo "1~2시간 독서" ⟨할 일⟩; memo "1~2시간 독서" ⟨메모로 남기기⟩', "-"],
  [309, "ko", "16:00~17:00 보고서", {}, 'todo "보고서" range 2026-10-08 16:00–17:00 reminder 2026-10-08 16:00 ⟨할 일 · 오늘 16:00–17:00⟩; event "보고서" 2026-10-08 16:00–17:00 ⟨일정 · 오늘(목) 16:00–17:00⟩', "-"],
  [310, "ko", "/할일 3시부터 5시까지 보고서", {}, 'todo "보고서" range 2026-10-08 15:00–17:00 reminder 2026-10-08 15:00 ⟨할 일 · 오늘 15:00–17:00⟩', "-"],
  [311, "ko", "/일정 3시부터 5시까지 보고서", {}, 'event "보고서" 2026-10-08 15:00–17:00 ⟨일정 · 오늘(목) 15:00–17:00⟩', "-"],
  [312, "ko", "3~5시 보고서", {}, 'todo "보고서" range 2026-10-08 15:00–17:00 reminder 2026-10-08 15:00 ⟨할 일 · 오늘 15:00–17:00⟩; event "보고서" 2026-10-08 15:00–17:00 ⟨일정 · 오늘(목) 15:00–17:00⟩', "-"],
  [313, "ko", "4시 반부터 6시 보고서", {}, 'todo "보고서" range 2026-10-08 16:30–18:00 reminder 2026-10-08 16:30 ⟨할 일 · 오늘 16:30–18:00⟩; event "보고서" 2026-10-08 16:30–18:00 ⟨일정 · 오늘(목) 16:30–18:00⟩', "-"],
  [314, "en", "report 2-4pm", {}, 'todo "report" range 2026-10-08 14:00–16:00 ⟨To-do · today 2:00–4:00 PM⟩; event "report" 2026-10-08 14:00–16:00 ⟨Event · today (Thu) 2:00–4:00 PM⟩', "-"],
  [315, "en", "report from 2 to 4", {}, 'todo "report" range 2026-10-08 14:00–16:00 ⟨To-do · today 2:00–4:00 PM⟩; event "report" 2026-10-08 14:00–16:00 ⟨Event · today (Thu) 2:00–4:00 PM⟩', "-"],
  [316, "en", "2pm–3:30pm report", {}, 'todo "report" range 2026-10-08 14:00–15:30 ⟨To-do · today 2:00–3:30 PM⟩; event "report" 2026-10-08 14:00–15:30 ⟨Event · today (Thu) 2:00–3:30 PM⟩', "-"],
  [317, "en", "read pages 2-4", {}, 'todo "read pages 2-4" ⟨To-do⟩; memo "read pages 2-4" ⟨Save as a note⟩', "-"],
  [318, "en", "meeting tomorrow 10-11am", {}, 'event "meeting" 2026-10-09 10:00–11:00 ⟨Event · tomorrow (Fri) 10:00–11:00 AM⟩; todo "meeting" range 2026-10-09 10:00–11:00 reminder 2026-10-09 10:00 due 2026-10-09 ⟨To-do · tomorrow 10:00–11:00 AM⟩', "-"],
  [319, "en", "report 11-1pm", {}, 'todo "report" range 2026-10-09 11:00–13:00 reminder 2026-10-09 11:00 due 2026-10-09 ⟨To-do · tomorrow 11:00 AM–1:00 PM⟩; event "report" 2026-10-09 11:00–13:00 ⟨Event · tomorrow (Fri) 11:00 AM–1:00 PM⟩', "-"],
  [320, "en", "보고서 3시부터 5시까지", {}, 'todo "보고서" range 2026-10-08 15:00–17:00 reminder 2026-10-08 15:00 ⟨To-do · today 3:00–5:00 PM⟩; event "보고서" 2026-10-08 15:00–17:00 ⟨Event · today (Thu) 3:00–5:00 PM⟩', "-"],
  [321, "nl", "verslag 14:00-15:30", {}, 'todo "verslag" range 2026-10-08 14:00–15:30 ⟨Taak · vandaag 14:00–15:30⟩; event "verslag" 2026-10-08 14:00–15:30 ⟨Afspraak · vandaag (do) 14:00–15:30⟩', "-"],
  [322, "nl", "verslag van 2 tot 4 uur", {}, 'todo "verslag" range 2026-10-08 14:00–16:00 ⟨Taak · vandaag 14:00–16:00⟩; event "verslag" 2026-10-08 14:00–16:00 ⟨Afspraak · vandaag (do) 14:00–16:00⟩', "-"],
  [323, "nl", "morgen van 9 tot 10 uur overleg", {}, 'event "overleg" 2026-10-09 09:00–10:00 ⟨Afspraak · morgen (vr) 09:00–10:00⟩; todo "overleg" range 2026-10-09 09:00–10:00 reminder 2026-10-09 09:00 due 2026-10-09 ⟨Taak · morgen 09:00–10:00⟩', "-"],
  [324, "nl", "pagina 2-4 lezen", {}, 'todo "pagina 2-4 lezen" ⟨Taak⟩; memo "pagina 2-4 lezen" ⟨Bewaren als notitie⟩', "-"],
  // Added by Windows (1.23 편의 기능): repeats from the line, Korean relative times.

];

for (const [number, lang, input, prefer, expected, problem] of cases) {
  test(`intent case ${number} (${lang}): ${JSON.stringify(input)}`, () => {
    const candidates = readIntent(input, now, lang, prefer);
    const written = candidates.length === 0 ? "[]" : candidates.map((candidate) => notation(candidate, lang)).join("; ");
    assert.equal(written, expected);
    assert.equal(intentProblem(input, lang, now), problem === "-" ? undefined : problemNames[problem][lang]);
  });
}

test("intent keys: the first word of the quick-add title", () => {
  assert.equal(preferenceKey("내일 3시 장보기", now, "ko"), "장보기");
  assert.equal(preferenceKey("내일 3시 회의", now, "ko"), "회의");
  assert.equal(preferenceKey("buy milk tomorrow 9am", now, "en"), "buy");
  assert.equal(preferenceKey("Meeting, tomorrow 3pm", now, "en"), "meeting");
  assert.equal(preferenceKey("morgen om 3 uur overleg", now, "nl"), "overleg");
  assert.equal(preferenceKey("   ", now, "ko"), undefined);
});

test("intent learning: twice makes a preference, once back clears it", () => {
  const once = learnSwitch(emptyIntentMemory, "장보기", "todo", "event");
  assert.deepEqual(once.prefer, {});
  assert.deepEqual(once.streak, { 장보기: { kind: "event", count: 1 } });
  const twice = learnSwitch(once, "장보기", "todo", "event");
  assert.deepEqual(twice.prefer, { 장보기: "event" });
  assert.deepEqual(twice.streak, {});
  const back = learnSwitch(twice, "장보기", "event", "todo");
  assert.deepEqual(back.prefer, {});
  assert.deepEqual(back.streak, {});
  let other = learnSwitch(emptyIntentMemory, "a", "todo", "event");
  other = learnSwitch(other, "a", "todo", "memo");
  assert.deepEqual(other.streak, { a: { kind: "memo", count: 1 } });
  assert.deepEqual(other.prefer, {});
});

test("intent learning: at most 200 keys, the oldest go", () => {
  let memory: IntentMemory = emptyIntentMemory;
  for (let index = 0; index <= 200; index += 1) {
    memory = learnSwitch(memory, `k${index}`, "todo", "event");
    memory = learnSwitch(memory, `k${index}`, "todo", "event");
  }
  assert.equal(Object.keys(memory.prefer).length, 200);
  assert.equal(memory.order.length, 200);
  assert.equal(memory.prefer.k0, undefined);
  assert.equal(memory.prefer.k200, "event");
});

// ─── The toast's words (the table "Added by Mac" in intent-cases.md, and Windows' own) ───

test("intent toast: the shared table", () => {
  const rows: [Lang, string, number, string][] = [
    ["ko", "내일 3시 회의", 0, "일정으로 넣었어요 · 내일 15:00"],
    ["en", "meeting tomorrow 3pm", 0, "Added as an event · tomorrow 3:00 PM"],
    ["nl", "morgen om 3 uur overleg", 0, "Toegevoegd als afspraak · morgen 15:00"],
    ["ko", "타이머 40", 0, "40분 타이머를 시작했어요"], ["en", "timer 40", 0, "Started a 40 min timer"], ["nl", "timer 40", 0, "Timer van 40 min gestart"],
    ["ko", "알람 오전 7:30 평일", 0, "알람을 맞췄어요 · 평일 오전 7:30"],
    ["en", "alarm 7:30 weekdays", 0, "Alarm set · weekdays 7:30 AM"],
    ["ko", "장보기\n우유", 0, "메모로 남겼어요"], ["en", "buy milk", 1, "Saved as a note"], ["nl", "boodschappen", 1, "Bewaard als notitie"],
    ["ko", "금요일까지 보고서", 1, "일정으로 넣었어요 · 10월 9일 종일"],
    ["en", "report by friday", 1, "Added as an event · Oct 9 all day"],
    ["ko", "내일 3시 장보기", 0, "할 일로 넣었어요 · 내일 15:00"],
    ["ko", "15:30 치과", 1, "할 일로 넣었어요 · 오늘 15:30"],
    ["ko", "장보기", 0, "할 일로 넣었어요"],
    ["ko", "금요일까지 보고서", 0, "할 일로 넣었어요 · 마감 10월 9일"],
    ["en", "call mom at 4", 1, "Added as a to-do · today 4:00 PM"],
    // Added by Windows (1.23): repeats.
    ["ko", "매주 월 9시 주간 회의", 0, "반복 일정으로 넣었어요 · 매주 월 09:00"],
    ["ko", "평일 8시 운동", 0, "반복 할 일로 넣었어요 · 평일 08:00"],
    ["en", "every day drink water", 0, "Added as a repeating to-do · every day"],
    ["nl", "elke maandag 9 uur overleg", 0, "Toegevoegd als herhalende afspraak · elke ma 09:00"],
    // Added by Windows (1.24): time ranges.
    ["ko", "3시부터 5시까지 보고서", 0, "할 일로 넣었어요 · 오늘 15:00–17:00"],
    ["ko", "9시~10시 운동", 0, "할 일로 넣었어요 · 내일 09:00–10:00"],
    ["en", "report 2-4pm", 0, "Added as a to-do · today 2:00–4:00 PM"],
    ["nl", "verslag van 2 tot 4 uur", 0, "Toegevoegd als taak · vandaag 14:00–16:00"],
    // Added by Windows (stage 4): a focus started from the line.
    ["ko", "보고서 25분 집중", 0, "25분 집중을 시작했어요 · 보고서"],
    ["en", "focus 25 report", 0, "Focusing for 25 min · report"],
    ["nl", "focus 25 rapport", 0, "25 min focus gestart · rapport"],
  ];
  for (const [lang, input, index, text] of rows) assert.equal(addedText(readIntent(input, now, lang)[index], now, lang), text, `${lang} ${input}`);
  assert.deepEqual((["repeat"] as IntentKind[]).map((kind) => [switchText(kind, "ko"), switchText(kind, "en"), switchText(kind, "nl")]), [["반복 할 일로 바꾸기", "Make it a repeating to-do", "Maak er een herhalende taak van"]]);
  const kinds: IntentKind[] = ["todo", "event", "memo", "timer", "alarm"];
  assert.deepEqual(kinds.map((kind) => switchText(kind, "ko")), ["할 일로 바꾸기", "일정으로 바꾸기", "메모로 바꾸기", "타이머로 바꾸기", "알람으로 바꾸기"]);
  assert.deepEqual(kinds.map((kind) => switchText(kind, "en")), ["Make it a to-do", "Make it an event", "Make it a note", "Make it a timer", "Make it an alarm"]);
});

// ─── Windows extras ──────────────────────────────────────────────────────────────

test("intent toast: what was made and the switch, in three languages", () => {
  const read = (text: string, lang: Lang) => readIntent(text, now, lang);
  const [event, todo] = read("내일 3시 회의", "ko");
  assert.equal(addedText(event, now, "ko"), "일정으로 넣었어요 · 내일 15:00");
  assert.equal(addedText(todo, now, "ko"), "할 일로 넣었어요 · 내일 15:00");
  assert.equal(switchText(todo.kind, "ko"), "할 일로 바꾸기");
  assert.equal(addedText(read("meeting tomorrow 3pm", "en")[0], now, "en"), "Added as an event · tomorrow 3:00 PM");
  assert.equal(switchText("todo", "en"), "Make it a to-do");
  assert.equal(addedText(read("morgen om 3 uur overleg", "nl")[0], now, "nl"), "Toegevoegd als afspraak · morgen 15:00");
  assert.equal(switchText("todo", "nl"), "Maak er een taak van");
  assert.equal(addedText(read("타이머 40", "ko")[0], now, "ko"), "40분 타이머를 시작했어요");
  assert.equal(addedText(read("timer 40", "en")[0], now, "en"), "Started a 40 min timer");
  assert.equal(addedText(read("알람 오전 7:30 평일", "ko")[0], now, "ko"), "알람을 맞췄어요 · 평일 오전 7:30");
  assert.equal(addedText(read("alarm 7:30 weekdays", "en")[0], now, "en"), "Alarm set · weekdays 7:30 AM");
  assert.equal(addedText(read("wekker 7 uur doordeweeks", "nl")[0], now, "nl"), "Wekker gezet · doordeweeks 07:00");
  assert.equal(addedText(read("장보기\n우유", "ko")[0], now, "ko"), "메모로 남겼어요");
  assert.equal(addedText(read("15:30 치과", "ko")[0], now, "ko"), "일정으로 넣었어요 · 오늘 15:30");
  assert.equal(addedText(read("금요일까지 보고서", "ko")[1], now, "ko"), "일정으로 넣었어요 · 10월 9일 종일");
  const kinds: IntentKind[] = ["event", "memo", "timer", "alarm"];
  assert.deepEqual(kinds.map((kind) => switchText(kind, "nl")), ["Maak er een afspraak van", "Maak er een notitie van", "Maak er een timer van", "Maak er een wekker van"]);
});

test("intent ranges: the Mac's rows M1–M4 (timeblock-cases.md, the 4 a.m. day)", () => {
  const read = (text: string, lang: Lang = "ko") => readIntent(text, now, lang).find((candidate) => candidate.kind === "todo") as Extract<Candidate, { kind: "todo" }>;
  assert.deepEqual(read("23:00-01:00 정리").range, { day: "2026-10-08", start: 1380, end: 60 });
  assert.equal(chipText(read("23:00-01:00 정리"), now, "ko"), "할 일 · 오늘 23:00–01:00");
  assert.equal(read("03:00-05:00 정리").range, undefined);
  assert.equal(read("1~2시간 운동").range, undefined);
  assert.equal(read("verslag 14-16 uur", "nl").range, undefined);
  assert.equal(read("read chapters 2-4", "en").range, undefined);
  assert.deepEqual(read("22:00-23:30 정리").range, { day: "2026-10-08", start: 1320, end: 1410 });
  assert.equal(read("22:00-23:30 정리").reminderAt?.getHours(), 22);
});
