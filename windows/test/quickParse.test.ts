import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuick } from "../src/core/quickParse";

// Thursday 1 October 2026, 10:00 — the shared cases for macOS and Windows.
const now = new Date(2026, 9, 1, 10, 0);
const at = (month: number, day: number, hour: number, minute = 0) => new Date(2026, month - 1, day, hour, minute).getTime();

test("내일 3시 회의 — an afternoon alert tomorrow", () => {
  const result = parseQuick("내일 3시 회의", now);
  assert.equal(result.title, "회의");
  assert.equal(result.reminderAt?.getTime(), at(10, 2, 15));
  assert.equal(result.dueDate, undefined);
  assert.equal(result.summary, "내일 오후 3:00 알림");
});

test("금요일까지 보고서 — a deadline on the coming Friday", () => {
  const result = parseQuick("금요일까지 보고서", now);
  assert.equal(result.title, "보고서");
  assert.equal(result.dueDate, "2026-10-02");
  assert.equal(result.reminderAt, undefined);
  assert.equal(result.summary, "10월 2일 (금)까지");
});

test("보고서 10/5까지 — M/D at the end", () => {
  const result = parseQuick("보고서 10/5까지", now);
  assert.equal(result.title, "보고서");
  assert.equal(result.dueDate, "2026-10-05");
  assert.equal(result.summary, "10월 5일 (월)까지");
});

test("오후 2시 반 치과 — 반 after a space, today", () => {
  const result = parseQuick("오후 2시 반 치과", now);
  assert.equal(result.title, "치과");
  assert.equal(result.reminderAt?.getTime(), at(10, 1, 14, 30));
  assert.equal(result.summary, "오늘 오후 2:30 알림");
});

test("9시 운동 — 9 a.m. has passed, so tomorrow", () => {
  const result = parseQuick("9시 운동", now);
  assert.equal(result.title, "운동");
  assert.equal(result.reminderAt?.getTime(), at(10, 2, 9));
  assert.equal(result.summary, "내일 오전 9:00 알림");
});

test("다음 주 월요일 회의 준비 — Monday of next week", () => {
  const result = parseQuick("다음 주 월요일 회의 준비", now);
  assert.equal(result.title, "회의 준비");
  assert.equal(result.dueDate, "2026-10-05");
  assert.equal(result.reminderAt, undefined);
});

test("이번 주까지 정리 — this Sunday", () => {
  const result = parseQuick("이번 주까지 정리", now);
  assert.equal(result.title, "정리");
  assert.equal(result.dueDate, "2026-10-04");
});

test("15:30 전화 — a 24-hour clock time today", () => {
  const result = parseQuick("15:30 전화", now);
  assert.equal(result.title, "전화");
  assert.equal(result.reminderAt?.getTime(), at(10, 1, 15, 30));
});

test("오늘 장보기 — today is just a today task", () => {
  const result = parseQuick("오늘 장보기", now);
  assert.equal(result.title, "장보기");
  assert.equal(result.dueDate, undefined);
  assert.equal(result.reminderAt, undefined);
  assert.equal(result.summary, undefined);
});

test("3월 1일 이사 — a date already past this year means next year", () => {
  const result = parseQuick("3월 1일 이사", now);
  assert.equal(result.title, "이사");
  assert.equal(result.dueDate, "2027-03-01");
});

test("내일 — nothing would be left, so the text stays as it is", () => {
  const result = parseQuick("내일", now);
  assert.deepEqual(result, { title: "내일" });
});

test("책 3권 읽기 — 3권 is not a time", () => {
  assert.deepEqual(parseQuick("책 3권 읽기", now), { title: "책 3권 읽기" });
});

test("hours without a period word: 1–6 afternoon, 7–11 morning, 12 noon, 13–24 as written", () => {
  const hour = (text: string) => parseQuick(`${text} 일`, now).reminderAt?.getHours();
  assert.equal(hour("내일 1시"), 13);
  assert.equal(hour("내일 6시"), 18);
  assert.equal(hour("내일 7시"), 7);
  assert.equal(hour("내일 11시"), 11);
  assert.equal(hour("내일 12시"), 12);
  assert.equal(hour("내일 13시"), 13);
  assert.equal(hour("내일 24시"), 0);
  assert.equal(hour("내일 오전 12시"), 0);
  assert.equal(hour("내일 아침 7시"), 7);
  assert.equal(hour("내일 저녁7시"), 19);
  assert.equal(hour("내일 밤 11시"), 23);
  assert.equal(hour("내일 새벽 5시"), 5);
  assert.equal(parseQuick("내일 3시 30분 일", now).reminderAt?.getMinutes(), 30);
  assert.equal(parseQuick("내일 3시반 일", now).reminderAt?.getMinutes(), 30);
});

test("weekdays: the next one counting today; 이번 주 and 다음 주 follow the Monday week", () => {
  assert.equal(parseQuick("목요일 산책", now).dueDate, undefined); // today, not a deadline
  assert.equal(parseQuick("목요일까지 산책", now).dueDate, "2026-10-01");
  assert.equal(parseQuick("수욜 산책", now).dueDate, "2026-10-07");
  assert.equal(parseQuick("일요일 산책", now).dueDate, "2026-10-04");
  assert.equal(parseQuick("이번주 월요일 산책", now).dueDate, "2026-09-28");
  assert.equal(parseQuick("이번 주 토요일 산책", now).dueDate, "2026-10-03");
  assert.equal(parseQuick("다음주 일요일 산책", now).dueDate, "2026-10-11");
  assert.equal(parseQuick("다음 주까지 산책", now).dueDate, "2026-10-11");
  assert.equal(parseQuick("이번 달까지 산책", now).dueDate, "2026-10-31");
  assert.equal(parseQuick("모레 산책", now).dueDate, "2026-10-03");
  assert.equal(parseQuick("글피 산책", now).dueDate, "2026-10-04");
});

test("a date with a time sets an alert on that day; words that only look alike are left alone", () => {
  const result = parseQuick("회의 금요일 오후 4시", now);
  assert.equal(result.title, "회의");
  assert.equal(result.reminderAt?.getTime(), at(10, 2, 16));
  assert.equal(result.summary, "내일 오후 4:00 알림");
  assert.equal(parseQuick("10월 9일 3시 발표", now).summary, "10월 9일 (금) 오후 3:00 알림");
  assert.deepEqual(parseQuick("1시간 운동", now), { title: "1시간 운동" });
  assert.deepEqual(parseQuick("이번 주 정리", now), { title: "이번 주 정리" });
  assert.deepEqual(parseQuick("13/40 확인", now), { title: "13/40 확인" });
  assert.equal(parseQuick("2/30 일", now).dueDate, undefined);
});

test("only the first date and the first time are used", () => {
  const result = parseQuick("내일 모레 3시 4시 일", now);
  assert.equal(result.title, "모레 4시 일");
  assert.equal(result.reminderAt?.getTime(), at(10, 2, 15));
});

test("the 4 a.m. day: just after midnight, 오늘 is still the evening before", () => {
  const late = new Date(2026, 9, 2, 1, 30); // Friday 01:30, logically Thursday
  assert.equal(parseQuick("내일까지 일", late).dueDate, "2026-10-02");
  const alert = parseQuick("3시 일", late);
  assert.equal(alert.reminderAt?.getTime(), at(10, 2, 15)); // Thursday 15:00 has passed: the next day
});
