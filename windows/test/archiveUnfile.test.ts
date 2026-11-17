import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ArchiveStore } from "../src/main/archiveStore";
import { Store } from "../src/main/store";
import { temporaryFolder } from "./temporaryFolder";

// #379 (the Mac's PresentationTests has the same case): 완료한 일 정리's 되돌리기 takes only those lines out of the month
// file; the others stay byte for byte, a field this version doesn't know and a line it can't read too.
test("#379 되돌리기 leaves the other lines as they were; a month that can't be written says so", () => {
  const directory = temporaryFolder("paper-unfile-");
  const month = path.join(directory, "archive", "2026-11.jsonl");
  fs.mkdirSync(path.dirname(month), { recursive: true });
  const newer = `{"title":"장보기","id":"newer","createdAt":"2026-11-01T00:00:00Z","completedAt":"2026-11-02T09:00:00Z","mood":"좋음"}`;
  const filed = `{"id":"filed","title":"빨래","createdAt":"2026-11-01T00:00:00Z","completedAt":"2026-11-02T10:00:00Z"}`;
  const odd = `{"id":"odd","title":`;
  fs.writeFileSync(month, `${newer}\n${filed}\n${odd}\n`);
  const store = new Store(directory);
  const archive = new ArchiveStore(store, directory);
  archive.unfile(new Set(["filed"]));
  assert.equal(fs.readFileSync(month, "utf8"), `${newer}\n${odd}\n`);
  assert.equal(store.storageError, undefined);

  // The folder can't be written: the month stays, and the note says so. chmod doesn't stop writes into a folder on
  // Windows, so this half runs on the macOS runner only.
  if (process.platform === "win32") return;
  fs.writeFileSync(month, `${newer}\n${filed}\n`);
  fs.chmodSync(path.dirname(month), 0o555);
  try {
    archive.unfile(new Set(["filed"]));
  } finally {
    fs.chmodSync(path.dirname(month), 0o755);
  }
  assert.equal(fs.readFileSync(month, "utf8"), `${newer}\n${filed}\n`);
  assert.match(store.storageError ?? "", /완료 기록에서 되돌리지 못한/);
});
