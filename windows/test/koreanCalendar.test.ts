import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { holidayLabel, holidayName, holidaysOf, lunarLabel, lunarOf, lunarSpoken, shiftDay, type HolidayName, type Lunar } from "../src/core/koreanCalendar";
import type { Lang } from "../src/core/lang";

// 음력과 공휴일 (#234): the shared cases from docs/plans/calendar-korean-cases.json (the Mac's scripts/test-korean-calendar.sh
// reads the same file) — lunar dates on 설날 · 추석 · 윤달 · year ends, every day of 2020–2035 as one digest (the two apps'
// calendars must agree on each), the cell's lunar label, and every holiday of 2024–2030.
type Json = Record<string, unknown>;
const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "calendar-korean-cases.json"), "utf8")) as Json;
const langs: Lang[] = ["ko", "en", "nl"];
const text = (lunar: Lunar) => `${lunar.month}${lunar.leap ? "L" : ""}.${lunar.day}`;

test("lunar dates on 설날, 추석, the 윤달 and year ends", () => {
  for (const [day, want] of file.lunar as [string, string][]) assert.equal(text(lunarOf(day)!), want, day);
});

test("every day of the range agrees (FNV-1a of the lines)", () => {
  const range = file.range as { from: string; to: string; fnv1a32: number; days: number };
  let hash = 0x811c9dc5, days = 0;
  for (let day = range.from; day <= range.to; day = shiftDay(day, 1)) {
    const lunar = lunarOf(day)!;
    for (const byte of Buffer.from(`${day} ${lunar.month}${lunar.leap ? "L" : ""} ${lunar.day}\n`, "utf8")) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    days += 1;
  }
  assert.equal(days, range.days);
  assert.equal(hash, range.fnv1a32);
});

test("the cell's lunar label and its spoken form", () => {
  for (const entry of file.labels as Json[]) {
    const lunar = lunarOf(entry.day as string)!;
    const spoken = entry.spoken as Record<Lang, string>;
    for (const lang of langs) {
      assert.equal(lunarLabel(lunar, lang), entry[lang], `label ${lang}`);
      assert.equal(lunarSpoken(lunar, lang), spoken[lang], `spoken ${lang}`);
    }
  }
});

for (const [year, list] of Object.entries(file.holidays as Record<string, [string, HolidayName[]][]>).sort()) {
  test(`holidays of ${year}`, () => {
    const found = holidaysOf(Number(year));
    assert.deepEqual([...found.keys()].sort(), list.map(([day]) => day).sort());
    for (const [day, names] of list) assert.deepEqual(found.get(day), names, day);
  });
}

test("names in ko · en · nl, and a day's label", () => {
  for (const [key, words] of Object.entries(file.names as Record<HolidayName, string[]>)) {
    langs.forEach((lang, index) => assert.equal(holidayName(key as HolidayName, lang), words[index], key));
  }
  for (const [day, ko, en] of file.labelsOn as [string, string | null, string | null][]) {
    assert.equal(holidayLabel(day) ?? null, ko, `ko ${day}`);
    assert.equal(holidayLabel(day, "en") ?? null, en, `en ${day}`);
  }
});
