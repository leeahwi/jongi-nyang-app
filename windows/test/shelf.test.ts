import assert from "node:assert/strict";
import { test } from "node:test";
import { dayFor, label, sentence, urgency } from "../src/core/deadline";
import { isBlank, memoPreview, memoTitle, newMemo, parseMemos, serializeMemos } from "../src/core/memo";
import { UndoableNotebook, parseNotebook, serializeNotebook, type TodoItem } from "../src/core/notebook";
import { pageOf, tabDrop } from "../src/core/shelf";
import { aheadWeek } from "../src/core/ahead";

const local = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h);

test("deadlines: today, this week (to the end of 앞으로's week), this month, 4 a.m. boundary", () => {
  const tuesday = local(9, 29, 10);
  assert.equal(dayFor({ kind: "today" }, tuesday), "2026-09-29");
  // Korean and English weeks run Sunday–Saturday, Dutch ones Monday–Sunday.
  assert.equal(dayFor({ kind: "thisWeek" }, tuesday), "2026-10-03");
  assert.equal(dayFor({ kind: "thisWeek" }, tuesday, "en"), "2026-10-03");
  assert.equal(dayFor({ kind: "thisWeek" }, tuesday, "nl"), "2026-10-04");
  assert.equal(dayFor({ kind: "thisWeek" }, local(10, 3, 10)), "2026-10-03");
  assert.equal(dayFor({ kind: "thisWeek" }, local(10, 4, 10)), "2026-10-10");
  assert.equal(dayFor({ kind: "thisWeek" }, local(10, 4, 10), "nl"), "2026-10-04");
  assert.equal(dayFor({ kind: "thisMonth" }, tuesday), "2026-09-30");
  assert.equal(dayFor({ kind: "today" }, local(9, 30, 1)), "2026-09-29");
});

test("이번 주 안 lands in 앞으로's 이번 주 in every language (Mac audit B1)", () => {
  for (const lang of ["ko", "en", "nl"] as const) {
    for (let day = 4; day <= 10; day += 1) {
      const now = local(10, day, 10);
      const { last } = aheadWeek(now, lang);
      const end = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
      assert.equal(dayFor({ kind: "thisWeek" }, now, lang), end, `${lang} 10/${day}`);
    }
  }
});

test("deadline labels match macOS", () => {
  const now = local(9, 29, 10);
  const cases: [string, string, string][] = [["2026-09-29", "D-day", "~오늘"], ["2026-09-30", "D-1", "~내일"], ["2026-10-02", "D-3", "~금"],
    ["2026-10-31", "D-32", "~10/31"], ["2027-01-02", "D-95", "~2027/1/2"], ["2026-09-27", "D+2", "~9/27"]];
  for (const [key, dday, date] of cases) {
    assert.equal(label(key, "dday", now), dday, key);
    assert.equal(label(key, "date", now), date, key);
  }
  assert.deepEqual(["2026-09-27", "2026-09-29", "2026-10-01", "2026-10-31"].map((key) => urgency(key, now)), ["overdue", "today", "soon", "later"]);
  assert.equal(sentence("2026-10-04", now), "10월 4일 (일)까지 · 5일 남음");
});

test("shelves: undated today, deadlines wait until due, later waits, pins win", () => {
  const now = local(9, 29, 10);
  const item = (dueDate?: string, shelf?: "later" | "today"): TodoItem => ({ id: "x", title: "일", isCompleted: false, createdAt: "2026-09-01T00:00:00Z", ...(dueDate ? { dueDate } : {}), ...(shelf ? { shelf } : {}) });
  assert.equal(pageOf(item(), now), "today");
  assert.equal(pageOf(item("2026-10-04"), now), "deadline");
  assert.equal(pageOf(item("2026-09-29"), now), "today");
  assert.equal(pageOf(item("2026-09-27"), now), "today");
  assert.equal(pageOf(item(undefined, "later"), now), "later");
  assert.equal(pageOf(item("2026-10-04", "later"), now), "deadline");
  assert.equal(pageOf(item("2026-10-20", "today"), now), "today");
});

test("deadline and shelf edits are undoable and round-trip in the macOS format", () => {
  const notebook = new UndoableNotebook();
  const report = notebook.add("보고서")!;
  notebook.setDeadline(report.id, "2026-10-04", true);
  assert.equal(notebook.items[0].dueDate, "2026-10-04");
  assert.equal(notebook.items[0].shelf, "today");
  notebook.setDeadline(report.id, "2026-10-04", false);
  assert.equal(notebook.items[0].shelf, undefined);
  const trip = notebook.addTo("여행", "later")!;
  assert.equal(trip.shelf, "later");
  assert.deepEqual(parseNotebook(serializeNotebook(notebook.notebook)), notebook.notebook);
  notebook.undo();
  assert.equal(notebook.items.length, 1, "adding to a shelf is one undo step");
  const mac = '{"items":[{"createdAt":"2026-09-22T01:51:20Z","dueDate":"2026-10-04","id":"A","isCompleted":false,"shelf":"later","title":"맥에서"}]}';
  assert.equal(parseNotebook(mac).items[0].shelf, "later");
});

test("memos: titles, previews, blanks and the macOS file format", () => {
  const memo = { ...newMemo(), text: "장보기\n우유, 달걀\n\n사과" };
  assert.equal(memoTitle(memo), "장보기");
  assert.equal(memoPreview(memo), "우유, 달걀 사과");
  assert.ok(isBlank(newMemo()));
  assert.deepEqual(parseMemos(serializeMemos([memo])), [memo]);
  const mac = '{"memos":[{"createdAt":"2026-09-29T05:39:00Z","id":"M1","text":"회의 메모","updatedAt":"2026-09-29T05:40:00Z"}]}';
  assert.equal(memoTitle(parseMemos(mac)[0]), "회의 메모");
});

test("dropping a task from 오늘 on the 앞으로 tab: a deadline ahead stays, anything else goes to 언젠가", () => {
  const now = local(10, 8, 15);
  const item = (dueDate?: string, shelf?: "later" | "today"): TodoItem => ({ id: "a", title: "발표", isCompleted: false, createdAt: "2026-10-04T06:00:00Z", ...(dueDate ? { dueDate } : {}), ...(shelf ? { shelf } : {}) });
  assert.deepEqual(tabDrop(item("2026-10-12", "today"), "ahead", now), { kind: "deadline", dueDate: "2026-10-12" });
  assert.deepEqual(tabDrop(item(), "ahead", now), { kind: "later" });
  assert.deepEqual(tabDrop(item("2026-10-08"), "ahead", now), { kind: "later" }, "due today");
  assert.deepEqual(tabDrop(item("2026-10-01"), "ahead", now), { kind: "later" }, "overdue");
  assert.equal(tabDrop(item(), "memos", now), undefined);
  assert.equal(tabDrop(item(), "today", now), undefined);
});

test("dropping on 앞으로: a day, 언젠가, 오늘, next to another task, one undo step each", () => {
  const notebook = new UndoableNotebook();
  const trip = notebook.addTo("여행", "later")!;
  const report = notebook.addTo("보고서", undefined, new Date(), "2026-10-13")!;
  const call = notebook.addTo("전화", undefined, new Date(), "2026-10-13")!;
  notebook.dropAhead(trip.id, { kind: "day", day: "2026-10-13" }, { id: call.id, after: false });
  assert.deepEqual(notebook.items.map((item) => item.title), ["보고서", "여행", "전화"]);
  assert.equal(notebook.items[1].dueDate, "2026-10-13");
  assert.equal(notebook.items[1].shelf, undefined);
  notebook.undo();
  assert.deepEqual(notebook.items.map((item) => [item.title, item.shelf, item.dueDate]), [["여행", "later", undefined], ["보고서", undefined, "2026-10-13"], ["전화", undefined, "2026-10-13"]]);
  notebook.dropAhead(report.id, { kind: "someday" });
  assert.equal(notebook.items[1].shelf, "later");
  assert.equal(notebook.items[1].dueDate, undefined);
  notebook.dropAhead(call.id, { kind: "today" });
  assert.equal(notebook.items[2].shelf, "today");
  assert.equal(notebook.items[2].dueDate, "2026-10-13", "a deadline stays; the task is pinned to today");
  notebook.dropAhead(trip.id, { kind: "today" });
  assert.equal(notebook.items[0].shelf, undefined, "undated: off the shelf, onto today");
  notebook.dropAhead(call.id, { kind: "day", day: "2026-10-20" }, { id: "missing", after: true });
  assert.equal(notebook.items[2].dueDate, "2026-10-20");
});
