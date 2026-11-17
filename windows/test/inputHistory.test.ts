import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { InputHistory, inputHistoryLimit } from "../src/core/inputHistory";

// #528: the shared cases from shared/cases/input-history-cases.json (the Mac's test-input-history.sh reads the same file)
// — ↑ · ↓ bring back the lines put in before.
const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "shared", "cases", "input-history-cases.json"), "utf8")) as {
  limit: number;
  steps: { case: string; entries: string[]; keys: { key: "up" | "down"; text: string; result: string | null }[] }[];
  add: { case: string; entries: string[]; line: string; added: string[] }[];
};

test("the limit", () => assert.equal(inputHistoryLimit, file.limit));
for (const entry of file.steps) {
  test(entry.case, () => {
    const history = new InputHistory(entry.entries);
    entry.keys.forEach((key, number) => assert.equal(history.step(key.key === "up", key.text), key.result, `key ${number + 1}`));
  });
}
for (const entry of file.add) {
  test(entry.case, () => {
    const history = new InputHistory(entry.entries);
    history.add(entry.line);
    assert.deepEqual(history.entries, entry.added);
  });
}
test(`a long history keeps the newest ${inputHistoryLimit}`, () => {
  const history = new InputHistory(Array.from({ length: 60 }, (_, index) => `할 일 ${index + 1}`));
  assert.equal(history.entries.length, inputHistoryLimit);
  history.add("새 줄");
  assert.equal(history.entries.length, inputHistoryLimit);
  assert.equal(history.entries.at(-1), "새 줄");
  assert.equal(history.entries[0], "할 일 12");
});
