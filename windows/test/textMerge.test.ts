import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeText, movedCaret } from "../src/core/textMerge";

test("one memo edited on two devices at once merges both edits (same cases as macOS)", () => {
  const cases: [base: string, ours: string, theirs: string, merged: string][] = [
    ["장보기\n우유", "장보기 목록\n우유", "장보기\n우유 2개", "장보기 목록\n우유 2개"],
    ["회의 3시 준비물 노트", "회의 4시 준비물 노트", "회의 3시 준비물 노트북", "회의 4시 준비물 노트북"],
    ["할 일", "할 일\n맥에서", "할 일\n윈도우에서", "할 일\n맥에서\n윈도우에서"],
    ["메모", "메모 맥", "메모 윈도우", "메모 맥 윈도우"],
    ["3시", "4시", "5시", "4시\n5시"],
    ["a\nb\nc", "a\nc", "a\nb\nc!", "a\nc!"],
    ["a", "a", "b", "b"],
    ["a", "a b", "a b", "a b"],
    ["첫 줄\n둘째 줄\n셋째 줄", "첫 줄 고침\n둘째 줄\n셋째 줄", "첫 줄\n둘째 줄\n셋째 줄\n넷째 줄", "첫 줄 고침\n둘째 줄\n셋째 줄\n넷째 줄"],
    ["x", "", "xy", "xy"],
  ];
  for (const [base, ours, theirs, merged] of cases) assert.equal(mergeText(base, ours, theirs), merged, JSON.stringify([base, ours, theirs]));
  const long = Array.from({ length: 3000 }, (_, index) => `줄 ${index + 1}`).join("\n");
  const both = mergeText(long, `맨 위\n${long}`, `${long}\n맨 아래`);
  assert.ok(both.startsWith("맨 위\n줄 1\n") && both.endsWith("줄 3000\n맨 아래"));
});

test("the caret keeps its place when joined text comes in (same cases as macOS)", () => {
  const cases: [caret: number, old: string, next: string, moved: number][] = [
    [3, "장보기\n우유", "장보기\n우유 2개", 3],
    [5, "ab\ncd", "XXab\ncd", 7],
    [2, "abcd", "abXYcd", 2],
    [4, "abcd", "ab", 2],
    [1, "a😀b", "a😀b!", 1],
  ];
  for (const [caret, old, next, moved] of cases) assert.equal(movedCaret(caret, old, next), moved, JSON.stringify([caret, old, next]));
});
