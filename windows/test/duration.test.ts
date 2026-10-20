import assert from "node:assert/strict";
import { test } from "node:test";
import { durationText, parseDuration, rememberTimer } from "../src/core/duration";
import { langs } from "../src/core/lang";

// 타이머 직접 정하기: the same cases as the macOS tests (DurationTests.swift).

test("parseDuration: the shared cases, in every language", () => {
  const cases: [string, number | undefined][] = [
    ["40", 40], ["1:30", 90], ["0", undefined], ["181", undefined], ["3:00", 180], ["1시간 30분", 90], ["1h 30m", 90],
    ["1.5h", 90], ["anderhalf uur", 90], ["abc", undefined], [" 25 ", 25], ["2:5", undefined], ["0:45", 45],
  ];
  for (const lang of langs) {
    for (const [text, minutes] of cases) assert.equal(parseDuration(text, lang), minutes, `${lang} ${JSON.stringify(text)}`);
  }
});

test("parseDuration: every language's words, whatever the app speaks", () => {
  const cases: [string, number][] = [
    ["40분", 40], ["1시간", 60], ["1시간30분", 90], ["2시간 반", 150],
    ["40m", 40], ["40 min", 40], ["1h", 60], ["90 minutes", 90], ["1H 30M", 90], ["2 hours", 120],
    ["1u", 60], ["1 uur", 60], ["1u 30m", 90], ["1 uur 15 min", 75], ["Anderhalf  Uur", 90], ["half uur", 30],
  ];
  for (const lang of langs) {
    for (const [text, minutes] of cases) assert.equal(parseDuration(text, lang), minutes, `${lang} ${JSON.stringify(text)}`);
  }
  assert.equal(parseDuration("", "ko"), undefined);
  assert.equal(parseDuration("3:01", "en"), undefined, "over three hours");
  assert.equal(parseDuration("1:60", "en"), undefined);
  assert.equal(parseDuration("4h", "en"), undefined);
  assert.equal(parseDuration("1,5 uur", "nl"), 90, "a Dutch decimal comma");
  assert.equal(parseDuration("1,5 uur", "en"), undefined);
});

test("durationText: the hint under the field", () => {
  assert.deepEqual(langs.map((lang) => durationText(40, lang)), ["40분", "40 min", "40 min"]);
  assert.deepEqual(langs.map((lang) => durationText(90, lang)), ["1시간 30분", "1 h 30 min", "1 u 30 min"]);
  assert.deepEqual(langs.map((lang) => durationText(120, lang)), ["2시간", "2 h", "2 u"]);
});

test("rememberTimer: newest first, three at most, never a preset", () => {
  assert.deepEqual(rememberTimer([], 40), [40]);
  assert.deepEqual(rememberTimer([40], 90), [90, 40]);
  assert.deepEqual(rememberTimer([90, 40], 40), [40, 90]);
  assert.deepEqual(rememberTimer([90, 40, 10], 45), [45, 90, 40]);
  assert.deepEqual(rememberTimer([90, 40], 25), [90, 40], "a preset leaves the list alone");
  assert.deepEqual(rememberTimer([90, 5, 400, 40], 7), [7, 90, 40], "presets and nonsense in the saved list are dropped");
});
