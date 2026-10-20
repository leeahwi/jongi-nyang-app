import assert from "node:assert/strict";
import { test } from "node:test";
import { aheadCount, aheadEyebrow, aheadSections, aheadSummary, movedText, type AheadSection, type AheadTarget } from "../src/core/ahead";
import type { LocalEvent } from "../src/core/events";
import type { Lang } from "../src/core/lang";
import type { TodoItem } from "../src/core/notebook";
import { tables } from "../src/i18n";

/**
 * 앞으로: the shared cases of ahead-cases.md (both apps pass every row exactly),
 * in its notation — the inputs are read from the same text the file has.
 */

// Thursday 8 October 2026, 14:50.
const thursday = new Date(2026, 9, 8, 14, 50);
const nowOf = (text: string) => {
  if (!text) return thursday;
  const [day, time] = text.split(" ");
  const [y, m, d] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hour, minute);
};
const split = (text: string) => (text ? text.split(/;\s*/) : []);

/** `"title" due=yyyy-MM-dd shelf=later done` */
function tasks(text: string): TodoItem[] {
  return split(text).map((entry, index) => {
    const title = /^"([^"]*)"/.exec(entry)![1];
    const due = /due=(\S+)/.exec(entry)?.[1];
    const shelf = /shelf=(later|today)/.exec(entry)?.[1] as "later" | "today" | undefined;
    const done = /\bdone\b/.test(entry);
    return { id: `T${index}`, title, isCompleted: done, createdAt: "2026-10-01T00:00:00Z", ...(due ? { dueDate: due } : {}), ...(shelf ? { shelf } : {}), ...(done ? { completedAt: "2026-10-08T01:00:00Z" } : {}) };
  });
}

/** `"title" yyyy-MM-dd HH:mm–HH:mm [weekly]` or `"title" yyyy-MM-dd all-day [×N] [weekly]` */
function events(text: string): LocalEvent[] {
  return split(text).map((entry, index) => {
    const match = /^"([^"]*)" (\d{4}-\d{2}-\d{2}) (?:(\d{2}):(\d{2})–(\d{2}):(\d{2})|all-day(?: ×(\d+))?)/.exec(entry)!;
    const [, title, date, sh, sm, eh, em, days] = match;
    const allDay = sh === undefined;
    return {
      id: `E${index}`, title, date, allDay, days: allDay ? Number(days ?? 1) : 1,
      start: allDay ? 540 : Number(sh) * 60 + Number(sm), end: allDay ? 600 : Number(eh) * 60 + Number(em),
      repeat: /\bweekly\b/.test(entry) ? "weekly" : "none", skip: [], color: "blue", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
    };
  });
}

/** The sections in the cases file's notation. */
function notation(sections: AheadSection[]): string {
  if (sections.length === 0) return "[]";
  return sections.map((section) => {
    let body = "";
    if (section.days) body = section.days.map((day) => `${day.weekday} ${day.date}${day.relative ? ` ${day.relative}` : ""} [${[
      ...day.events.map((event) => `ev ${event.time} ${event.title}`), ...day.tasks.map((item) => `td ${item.title}`),
    ].join("; ")}]`).join(" · ");
    if (section.months) body = section.months.map((month) => `${month.title} [${month.tasks.map(({ item, date }) => `td ${item.title} @ ${date}`).join("; ")}]`).join(" · ");
    if (section.tasks) body = `[${section.tasks.map((item) => `td ${item.title}`).join("; ")}]`;
    return `${section.title}(${section.count}): ${body}`;
  }).join(" | ");
}

/** [#, language, now, tasks, events, expected, eyebrow, summary] — copied from ahead-cases.md. */
const cases: [number, Lang, string, string, string, string, string, string][] = [
  [1, "ko", "", "\"회의록 정리\" due=2026-10-09; \"발표 자료 보내기\" due=2026-10-16; \"책 10쪽 읽기\" due=2026-10-11; \"자전거 바람 넣기\" shelf=later; \"오늘 할 일\"; \"끝낸 일\" due=2026-10-09 done; \"세금 신고\" due=2026-11-03; \"연말 정산\" due=2027-01-02; \"겨울옷 정리\" shelf=later; \"마감 지난 일\" due=2026-10-07; \"오늘에 꽂은 일\" due=2026-10-12 shelf=today", "\"주간 회의\" 2026-10-09 10:00–11:00; \"제주 여행\" 2026-10-10 all-day ×2; \"치과 정기 검진\" 2026-10-13 14:00–15:00; \"스탠드업\" 2026-10-05 09:30–09:45 weekly; \"오늘 일정\" 2026-10-08 16:00–17:00", "이번 주(1): 금 9 내일 [ev 10:00 주간 회의; td 회의록 정리] · 토 10 [ev 종일 제주 여행] | 다음 주(2): 일 11 [ev 종일 제주 여행; td 책 10쪽 읽기] · 월 12 [ev 09:30 스탠드업] · 화 13 [ev 14:00 치과 정기 검진] · 금 16 [td 발표 자료 보내기] | 그 뒤(2): 11월 [td 세금 신고 @ 11월 3일 (화)] · 2027년 1월 [td 연말 정산 @ 2027년 1월 2일 (토)] | 언젠가(2): [td 자전거 바람 넣기; td 겨울옷 정리]", "이번 주 · 10월 4일 – 10일", "할 일 7 · 일정 4"],
  [2, "en", "", "\"회의록 정리\" due=2026-10-09; \"발표 자료 보내기\" due=2026-10-16; \"책 10쪽 읽기\" due=2026-10-11; \"자전거 바람 넣기\" shelf=later; \"오늘 할 일\"; \"끝낸 일\" due=2026-10-09 done; \"세금 신고\" due=2026-11-03; \"연말 정산\" due=2027-01-02; \"겨울옷 정리\" shelf=later; \"마감 지난 일\" due=2026-10-07; \"오늘에 꽂은 일\" due=2026-10-12 shelf=today", "\"주간 회의\" 2026-10-09 10:00–11:00; \"제주 여행\" 2026-10-10 all-day ×2; \"치과 정기 검진\" 2026-10-13 14:00–15:00; \"스탠드업\" 2026-10-05 09:30–09:45 weekly; \"오늘 일정\" 2026-10-08 16:00–17:00", "This week(1): Fri 9 Tomorrow [ev 10:00 AM 주간 회의; td 회의록 정리] · Sat 10 [ev All day 제주 여행] | Next week(2): Sun 11 [ev All day 제주 여행; td 책 10쪽 읽기] · Mon 12 [ev 9:30 AM 스탠드업] · Tue 13 [ev 2:00 PM 치과 정기 검진] · Fri 16 [td 발표 자료 보내기] | Later on(2): November [td 세금 신고 @ Tue, Nov 3] · January 2027 [td 연말 정산 @ Sat, Jan 2, 2027] | Someday(2): [td 자전거 바람 넣기; td 겨울옷 정리]", "This week · Oct 4 – 10", "7 to-dos · 4 events"],
  [3, "nl", "", "\"회의록 정리\" due=2026-10-09; \"발표 자료 보내기\" due=2026-10-16; \"책 10쪽 읽기\" due=2026-10-11; \"자전거 바람 넣기\" shelf=later; \"오늘 할 일\"; \"끝낸 일\" due=2026-10-09 done; \"세금 신고\" due=2026-11-03; \"연말 정산\" due=2027-01-02; \"겨울옷 정리\" shelf=later; \"마감 지난 일\" due=2026-10-07; \"오늘에 꽂은 일\" due=2026-10-12 shelf=today", "\"주간 회의\" 2026-10-09 10:00–11:00; \"제주 여행\" 2026-10-10 all-day ×2; \"치과 정기 검진\" 2026-10-13 14:00–15:00; \"스탠드업\" 2026-10-05 09:30–09:45 weekly; \"오늘 일정\" 2026-10-08 16:00–17:00", "Deze week(2): vr 9 Morgen [ev 10:00 주간 회의; td 회의록 정리] · za 10 [ev Hele dag 제주 여행] · zo 11 [ev Hele dag 제주 여행; td 책 10쪽 읽기] | Volgende week(1): ma 12 [ev 09:30 스탠드업] · di 13 [ev 14:00 치과 정기 검진] · vr 16 [td 발표 자료 보내기] | Daarna(2): november [td 세금 신고 @ di 3 nov] · januari 2027 [td 연말 정산 @ za 2 jan 2027] | Ooit(2): [td 자전거 바람 넣기; td 겨울옷 정리]", "Deze week · 5 – 11 okt", "7 taken · 4 afspraken"],
  [4, "ko", "", "\"오늘 할 일\"; \"끝낸 일\" due=2026-10-09 done; \"마감 지난 일\" due=2026-10-07", "\"오늘 일정\" 2026-10-08 16:00–17:00", "[]", "이번 주 · 10월 4일 – 10일", ""],
  [5, "en", "", "", "", "[]", "This week · Oct 4 – 10", ""],
  [6, "nl", "", "", "", "[]", "Deze week · 5 – 11 okt", ""],
  [7, "ko", "", "\"A\" due=2026-10-10; \"B\" due=2026-10-11; \"C\" due=2026-10-17; \"D\" due=2026-10-18", "", "이번 주(1): 토 10 [td A] | 다음 주(2): 일 11 [td B] · 토 17 [td C] | 그 뒤(1): 10월 [td D @ 10월 18일 (일)]", "이번 주 · 10월 4일 – 10일", "할 일 4"],
  [8, "en", "", "\"A\" due=2026-10-10; \"B\" due=2026-10-11; \"C\" due=2026-10-17; \"D\" due=2026-10-18", "", "This week(1): Sat 10 [td A] | Next week(2): Sun 11 [td B] · Sat 17 [td C] | Later on(1): October [td D @ Sun, Oct 18]", "This week · Oct 4 – 10", "4 to-dos"],
  [9, "nl", "", "\"A\" due=2026-10-10; \"B\" due=2026-10-11; \"C\" due=2026-10-17; \"D\" due=2026-10-18", "", "Deze week(2): za 10 [td A] · zo 11 [td B] | Volgende week(2): za 17 [td C] · zo 18 [td D]", "Deze week · 5 – 11 okt", "4 taken"],
  [10, "ko", "2026-10-10 10:00", "\"A\" due=2026-10-11; \"B\" due=2026-10-17; \"C\" due=2026-10-18", "", "다음 주(2): 일 11 내일 [td A] · 토 17 [td B] | 그 뒤(1): 10월 [td C @ 10월 18일 (일)]", "이번 주 · 10월 4일 – 10일", "할 일 3"],
  [11, "en", "2026-10-10 10:00", "\"A\" due=2026-10-11; \"B\" due=2026-10-17; \"C\" due=2026-10-18", "", "Next week(2): Sun 11 Tomorrow [td A] · Sat 17 [td B] | Later on(1): October [td C @ Sun, Oct 18]", "This week · Oct 4 – 10", "3 to-dos"],
  [12, "nl", "2026-10-10 10:00", "\"A\" due=2026-10-11; \"B\" due=2026-10-17; \"C\" due=2026-10-18", "", "Deze week(1): zo 11 Morgen [td A] | Volgende week(2): za 17 [td B] · zo 18 [td C]", "Deze week · 5 – 11 okt", "3 taken"],
  [13, "ko", "2026-10-09 02:00", "\"A\" due=2026-10-09", "\"아침 운동\" 2026-10-09 07:00–08:00; \"밤 영화\" 2026-10-10 01:30–03:00; \"새벽 기차\" 2026-10-09 03:00–04:00", "이번 주(1): 금 9 내일 [ev 07:00 아침 운동; ev 01:30 밤 영화; td A]", "이번 주 · 10월 4일 – 10일", "할 일 1 · 일정 2"],
  [14, "en", "2026-10-09 02:00", "\"A\" due=2026-10-09", "\"아침 운동\" 2026-10-09 07:00–08:00; \"밤 영화\" 2026-10-10 01:30–03:00; \"새벽 기차\" 2026-10-09 03:00–04:00", "This week(1): Fri 9 Tomorrow [ev 7:00 AM 아침 운동; ev 1:30 AM 밤 영화; td A]", "This week · Oct 4 – 10", "1 to-do · 2 events"],
  [15, "nl", "2026-10-09 02:00", "\"A\" due=2026-10-09", "\"아침 운동\" 2026-10-09 07:00–08:00; \"밤 영화\" 2026-10-10 01:30–03:00; \"새벽 기차\" 2026-10-09 03:00–04:00", "Deze week(1): vr 9 Morgen [ev 07:00 아침 운동; ev 01:30 밤 영화; td A]", "Deze week · 5 – 11 okt", "1 taak · 2 afspraken"],
  [16, "ko", "", "\"B\" due=2026-10-13; \"A\" due=2026-10-13; \"C\" due=2026-10-13 done", "\"Lunch\" 2026-10-13 12:00–13:00; \"Beach day\" 2026-10-13 all-day; \"Breakfast\" 2026-10-13 08:00–09:00; \"Anniversary\" 2026-10-13 all-day", "다음 주(2): 화 13 [ev 종일 Anniversary; ev 종일 Beach day; ev 08:00 Breakfast; ev 12:00 Lunch; td B; td A]", "이번 주 · 10월 4일 – 10일", "할 일 2 · 일정 4"],
  [17, "en", "", "\"B\" due=2026-10-13; \"A\" due=2026-10-13; \"C\" due=2026-10-13 done", "\"Lunch\" 2026-10-13 12:00–13:00; \"Beach day\" 2026-10-13 all-day; \"Breakfast\" 2026-10-13 08:00–09:00; \"Anniversary\" 2026-10-13 all-day", "Next week(2): Tue 13 [ev All day Anniversary; ev All day Beach day; ev 8:00 AM Breakfast; ev 12:00 PM Lunch; td B; td A]", "This week · Oct 4 – 10", "2 to-dos · 4 events"],
  [18, "nl", "", "\"B\" due=2026-10-13; \"A\" due=2026-10-13; \"C\" due=2026-10-13 done", "\"Lunch\" 2026-10-13 12:00–13:00; \"Beach day\" 2026-10-13 all-day; \"Breakfast\" 2026-10-13 08:00–09:00; \"Anniversary\" 2026-10-13 all-day", "Volgende week(2): di 13 [ev Hele dag Anniversary; ev Hele dag Beach day; ev 08:00 Breakfast; ev 12:00 Lunch; td B; td A]", "Deze week · 5 – 11 okt", "2 taken · 4 afspraken"],
  [19, "ko", "", "\"C\" due=2027-01-05; \"A\" due=2026-11-20; \"B\" due=2026-11-02; \"D\" due=2026-12-31; \"E\" due=2026-11-02", "", "그 뒤(5): 11월 [td B @ 11월 2일 (월); td E @ 11월 2일 (월); td A @ 11월 20일 (금)] · 12월 [td D @ 12월 31일 (목)] · 2027년 1월 [td C @ 2027년 1월 5일 (화)]", "이번 주 · 10월 4일 – 10일", "할 일 5"],
  [20, "en", "", "\"C\" due=2027-01-05; \"A\" due=2026-11-20; \"B\" due=2026-11-02; \"D\" due=2026-12-31; \"E\" due=2026-11-02", "", "Later on(5): November [td B @ Mon, Nov 2; td E @ Mon, Nov 2; td A @ Fri, Nov 20] · December [td D @ Thu, Dec 31] · January 2027 [td C @ Tue, Jan 5, 2027]", "This week · Oct 4 – 10", "5 to-dos"],
  [21, "nl", "", "\"C\" due=2027-01-05; \"A\" due=2026-11-20; \"B\" due=2026-11-02; \"D\" due=2026-12-31; \"E\" due=2026-11-02", "", "Daarna(5): november [td B @ ma 2 nov; td E @ ma 2 nov; td A @ vr 20 nov] · december [td D @ do 31 dec] · januari 2027 [td C @ di 5 jan 2027]", "Deze week · 5 – 11 okt", "5 taken"],
  [22, "ko", "", "\"Someday task\" shelf=later", "\"Yoga\" 2026-09-30 19:00–20:00 weekly; \"Concert\" 2026-10-25 20:00–22:00", "다음 주(0): 수 14 [ev 19:00 Yoga] | 언젠가(1): [td Someday task]", "이번 주 · 10월 4일 – 10일", "할 일 1 · 일정 1"],
  [23, "en", "", "\"Someday task\" shelf=later", "\"Yoga\" 2026-09-30 19:00–20:00 weekly; \"Concert\" 2026-10-25 20:00–22:00", "Next week(0): Wed 14 [ev 7:00 PM Yoga] | Someday(1): [td Someday task]", "This week · Oct 4 – 10", "1 to-do · 1 event"],
  [24, "nl", "", "\"Someday task\" shelf=later", "\"Yoga\" 2026-09-30 19:00–20:00 weekly; \"Concert\" 2026-10-25 20:00–22:00", "Volgende week(0): wo 14 [ev 19:00 Yoga] | Ooit(1): [td Someday task]", "Deze week · 5 – 11 okt", "1 taak · 1 afspraak"],
  [25, "ko", "", "\"Later dated\" due=2026-10-09 shelf=later; \"Pinned\" due=2026-10-09 shelf=today; \"Overdue\" due=2026-10-01", "\"\" 2026-10-09 all-day", "이번 주(1): 금 9 내일 [ev 종일 (제목 없음); td Later dated]", "이번 주 · 10월 4일 – 10일", "할 일 1 · 일정 1"],
  [26, "en", "", "\"Later dated\" due=2026-10-09 shelf=later; \"Pinned\" due=2026-10-09 shelf=today; \"Overdue\" due=2026-10-01", "\"\" 2026-10-09 all-day", "This week(1): Fri 9 Tomorrow [ev All day (No title); td Later dated]", "This week · Oct 4 – 10", "1 to-do · 1 event"],
  [27, "nl", "", "\"Later dated\" due=2026-10-09 shelf=later; \"Pinned\" due=2026-10-09 shelf=today; \"Overdue\" due=2026-10-01", "\"\" 2026-10-09 all-day", "Deze week(1): vr 9 Morgen [ev Hele dag (Geen titel); td Later dated]", "Deze week · 5 – 11 okt", "1 taak · 1 afspraak"],
  [28, "ko", "", "", "\"Trip\" 2026-10-08 all-day ×4", "이번 주(0): 금 9 내일 [ev 종일 Trip] · 토 10 [ev 종일 Trip] | 다음 주(0): 일 11 [ev 종일 Trip]", "이번 주 · 10월 4일 – 10일", "일정 1"],
  [29, "en", "", "", "\"Trip\" 2026-10-08 all-day ×4", "This week(0): Fri 9 Tomorrow [ev All day Trip] · Sat 10 [ev All day Trip] | Next week(0): Sun 11 [ev All day Trip]", "This week · Oct 4 – 10", "1 event"],
  [30, "nl", "", "", "\"Trip\" 2026-10-08 all-day ×4", "Deze week(0): vr 9 Morgen [ev Hele dag Trip] · za 10 [ev Hele dag Trip] · zo 11 [ev Hele dag Trip]", "Deze week · 5 – 11 okt", "1 afspraak"],
  [31, "ko", "2026-10-11 10:00", "\"A\" due=2026-10-12; \"B\" due=2026-10-18", "", "이번 주(1): 월 12 내일 [td A] | 다음 주(1): 일 18 [td B]", "이번 주 · 10월 11일 – 17일", "할 일 2"],
  [32, "en", "2026-10-11 10:00", "\"A\" due=2026-10-12; \"B\" due=2026-10-18", "", "This week(1): Mon 12 Tomorrow [td A] | Next week(1): Sun 18 [td B]", "This week · Oct 11 – 17", "2 to-dos"],
  [33, "nl", "2026-10-11 10:00", "\"A\" due=2026-10-12; \"B\" due=2026-10-18", "", "Volgende week(2): ma 12 Morgen [td A] · zo 18 [td B]", "Deze week · 5 – 11 okt", "2 taken"],
  [34, "ko", "", "\"끝냄\" due=2026-10-12 done; \"오늘로 핀\" due=2026-10-12 shelf=today; \"지난 마감\" due=2026-10-07; \"오늘 마감\" due=2026-10-08; \"그냥 할 일\"; \"나중 1\" shelf=later; \"마감 있는 나중\" due=2026-10-12 shelf=later; \"나중 2\" shelf=later; \"끝낸 나중\" shelf=later done", "", "다음 주(1): 월 12 [td 마감 있는 나중] | 언젠가(2): [td 나중 1; td 나중 2]", "이번 주 · 10월 4일 – 10일", "할 일 3"],
  [35, "en", "", "\"끝냄\" due=2026-10-12 done; \"오늘로 핀\" due=2026-10-12 shelf=today; \"지난 마감\" due=2026-10-07; \"오늘 마감\" due=2026-10-08; \"그냥 할 일\"; \"나중 1\" shelf=later; \"마감 있는 나중\" due=2026-10-12 shelf=later; \"나중 2\" shelf=later; \"끝낸 나중\" shelf=later done", "", "Next week(1): Mon 12 [td 마감 있는 나중] | Someday(2): [td 나중 1; td 나중 2]", "This week · Oct 4 – 10", "3 to-dos"],
  [36, "nl", "", "\"끝냄\" due=2026-10-12 done; \"오늘로 핀\" due=2026-10-12 shelf=today; \"지난 마감\" due=2026-10-07; \"오늘 마감\" due=2026-10-08; \"그냥 할 일\"; \"나중 1\" shelf=later; \"마감 있는 나중\" due=2026-10-12 shelf=later; \"나중 2\" shelf=later; \"끝낸 나중\" shelf=later done", "", "Volgende week(1): ma 12 [td 마감 있는 나중] | Ooit(2): [td 나중 1; td 나중 2]", "Deze week · 5 – 11 okt", "3 taken"],
  [37, "ko", "", "", "\"휴가\" 2026-10-16 all-day ×5; \"학회\" 2026-10-07 all-day ×3; \"늦은 회의\" 2026-10-09 23:00–00:30; \"새벽 일정\" 2026-10-10 00:30–01:00", "이번 주(0): 금 9 내일 [ev 종일 학회; ev 23:00 늦은 회의; ev 00:30 새벽 일정] | 다음 주(0): 금 16 [ev 종일 휴가] · 토 17 [ev 종일 휴가]", "이번 주 · 10월 4일 – 10일", "일정 4"],
  [38, "en", "", "", "\"휴가\" 2026-10-16 all-day ×5; \"학회\" 2026-10-07 all-day ×3; \"늦은 회의\" 2026-10-09 23:00–00:30; \"새벽 일정\" 2026-10-10 00:30–01:00", "This week(0): Fri 9 Tomorrow [ev All day 학회; ev 11:00 PM 늦은 회의; ev 12:30 AM 새벽 일정] | Next week(0): Fri 16 [ev All day 휴가] · Sat 17 [ev All day 휴가]", "This week · Oct 4 – 10", "4 events"],
  [39, "nl", "", "", "\"휴가\" 2026-10-16 all-day ×5; \"학회\" 2026-10-07 all-day ×3; \"늦은 회의\" 2026-10-09 23:00–00:30; \"새벽 일정\" 2026-10-10 00:30–01:00", "Deze week(0): vr 9 Morgen [ev Hele dag 학회; ev 23:00 늦은 회의; ev 00:30 새벽 일정] | Volgende week(0): vr 16 [ev Hele dag 휴가] · za 17 [ev Hele dag 휴가] · zo 18 [ev Hele dag 휴가]", "Deze week · 5 – 11 okt", "4 afspraken"],
  [40, "ko", "2026-12-31 12:00", "\"새해 계획\" due=2027-01-01; \"보험 갱신\" due=2027-01-20", "", "이번 주(1): 금 1 내일 [td 새해 계획] | 그 뒤(1): 2027년 1월 [td 보험 갱신 @ 2027년 1월 20일 (수)]", "이번 주 · 2026년 12월 27일 – 2027년 1월 2일", "할 일 2"],
  [41, "en", "2026-12-31 12:00", "\"새해 계획\" due=2027-01-01; \"보험 갱신\" due=2027-01-20", "", "This week(1): Fri 1 Tomorrow [td 새해 계획] | Later on(1): January 2027 [td 보험 갱신 @ Wed, Jan 20, 2027]", "This week · Dec 27, 2026 – Jan 2, 2027", "2 to-dos"],
  [42, "nl", "2026-12-31 12:00", "\"새해 계획\" due=2027-01-01; \"보험 갱신\" due=2027-01-20", "", "Deze week(1): vr 1 Morgen [td 새해 계획] | Daarna(1): januari 2027 [td 보험 갱신 @ wo 20 jan 2027]", "Deze week · 28 dec 2026 – 3 jan 2027", "2 taken"],
  [43, "ko", "2026-09-30 12:00", "", "", "[]", "이번 주 · 9월 27일 – 10월 3일", ""],
  [44, "en", "2026-09-30 12:00", "", "", "[]", "This week · Sep 27 – Oct 3", ""],
  [45, "nl", "2026-09-30 12:00", "", "", "[]", "Deze week · 28 sep – 4 okt", ""],
];

for (const [number, lang, now, taskText, eventText, expected, eyebrow, summary] of cases) {
  test(`ahead case ${number} (${lang})`, () => {
    const at = nowOf(now);
    const items = tasks(taskText);
    const sections = aheadSections(items, events(eventText), at, lang);
    assert.equal(notation(sections), expected);
    assert.equal(aheadEyebrow(at, lang), eyebrow);
    assert.equal(aheadSummary(sections, lang), summary);
    // The tab's count: every open task not on today's sheet.
    assert.equal(aheadCount(sections), sections.reduce((sum, section) => sum + section.count, 0));
  });
}

/** [#, language, destination, text] — the toast after a drop. */
const moves: [string, Lang, string, string][] = [
  ["M1", "ko", "day 2026-10-09", "10월 9일로 옮겼어요"],
  ["M2", "en", "day 2026-10-09", "Moved to Oct 9"],
  ["M3", "nl", "day 2026-10-09", "Verplaatst naar 9 okt"],
  ["M4", "ko", "day 2027-01-02", "2027년 1월 2일로 옮겼어요"],
  ["M5", "en", "day 2027-01-02", "Moved to Jan 2, 2027"],
  ["M6", "nl", "day 2027-01-02", "Verplaatst naar 2 jan 2027"],
  ["M7", "ko", "someday", "언젠가로 옮겼어요"],
  ["M8", "en", "someday", "Moved to Someday"],
  ["M9", "nl", "someday", "Verplaatst naar Ooit"],
  ["M10", "ko", "today", "오늘로 옮겼어요"],
  ["M11", "en", "today", "Moved to Today"],
  ["M12", "nl", "today", "Verplaatst naar Vandaag"],
];

for (const [number, lang, destination, text] of moves) {
  test(`ahead moved ${number} (${lang})`, () => {
    const target: AheadTarget = destination.startsWith("day ") ? { kind: "day", day: destination.slice(4) } : { kind: destination as "someday" | "today" };
    assert.equal(movedText(target, thursday, lang), text);
  });
}

/** [#, language, text] — the empty sheet's line (the windows' t() tables). */
const empties: [string, Lang, string][] = [
];

for (const [number, lang, text] of empties) {
  test(`ahead empty ${number} (${lang})`, () => {
    const source = empties.find((entry) => entry[1] === "ko")![2];
    assert.equal(lang === "ko" ? source : tables[lang][source], text);
  });
}

test("ahead: every language has at least ten cases", () => {
  for (const lang of ["ko", "en", "nl"] as const) assert.ok(cases.filter((entry) => entry[1] === lang).length >= 10, lang);
});

test("ahead: the tab's count is every open task off today's sheet", () => {
  const items = tasks('"a" due=2026-10-09; "b" shelf=later; "c"; "d" due=2026-12-01; "e" due=2026-10-09 done');
  assert.equal(aheadCount(aheadSections(items, [], thursday, "ko")), 3);
});

