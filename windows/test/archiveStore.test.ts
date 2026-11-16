import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseArchiveLines, type ArchiveEntry } from "../src/core/archive";
import { ArchiveStore } from "../src/main/archiveStore";
import { Store } from "../src/main/store";
import { temporaryFolder } from "./temporaryFolder";

const entry = (id: string, title: string): ArchiveEntry =>
  ({ id, title, createdAt: "2026-11-01T00:00:00Z", completedAt: "2026-11-02T09:00:00Z" });

// #378 (the Mac's PresentationTests has the same case): a power cut tore the month file's last line; what is filed
// next starts on a line of its own, so it reads — only the torn line stays unreadable.
test("#378 a line filed after a torn last line reads; only the torn line is left out", () => {
  const directory = temporaryFolder("paper-archive-");
  const month = path.join(directory, "archive", "2026-11.jsonl");
  fs.mkdirSync(path.dirname(month), { recursive: true });
  const whole = JSON.stringify(entry("whole", "장보기"));
  fs.writeFileSync(month, `${whole}\n${JSON.stringify(entry("torn", "빨래")).slice(0, -6)}`);
  const archive = new ArchiveStore(new Store(directory), directory);
  archive.seed([entry("new", "분리수거")]);
  const text = fs.readFileSync(month, "utf8");
  assert.deepEqual(parseArchiveLines(text).map((line) => line.id), ["whole", "new"]);
  assert.ok(text.endsWith("\n") && text.split("\n").length === 4, "the torn line keeps a line of its own");
  // A file that ends well gets no empty line.
  archive.seed([entry("next", "설거지")]);
  assert.ok(!fs.readFileSync(month, "utf8").includes("\n\n"));
});
