import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { backupMessages, makeBackup, type BackupFiles } from "../src/core/backup";
import { fileLimits } from "../src/core/fileLimits";
import { serializeNotebook } from "../src/core/notebook";
import { AutoBackup } from "../src/main/autoBackup";
import { checkFile, readChosenText, readTextSafely, RefusedFile, temporaryPath, writeFileAtomically } from "../src/main/safeFiles";
import { importInto, mergeArchive, readDataFiles } from "../src/main/storageFolder";
import { Store } from "../src/main/store";

// #173 (security review L-04 · L-05 · I-08): links, sizes and temporary files — the shared cases L1… Z1… T1… of
// docs/plans/file-safety-cases.json (the Mac's Tests/PaperTodoTests/BackupTests.swift reads the same file). Fictional
// temporary folders only.

interface LinkCase { id: string; about: string; file: string; where: "read" | "import"; expect: "skipped" | "untouched" | "read" }
interface SizeCase { id: string; about: string; kind: "dataFile" | "backup"; file?: string; bytes: "limit" | "limit+1"; expect: "allowed" | "refused" }
interface TemporaryCase { id: string; about: string; file: string; planted?: string; expect: "unique" | "beside" | "untouched" | "none-left" }
const cases = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "file-safety-cases.json"), "utf8")) as {
  limits: { backupBytes: number; dataFileBytes: number }; links: LinkCase[]; size: SizeCase[]; temporary: TemporaryCase[];
  messages: { tooLarge: Record<"ko" | "en" | "nl", string> };
};

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "paper-todo-safety-"));
const todos = (title: string) => serializeNotebook({ items: [{ id: "00000000-0000-4000-8000-000000000001", title, isCompleted: false, createdAt: "2026-10-01T09:00:00Z" }] });
const put = (folder: string, name: string, text: string) => {
  const file = path.join(folder, ...name.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
/** A sparse file of exactly `bytes` (no memory, no disk): only its size is looked at before reading. */
const sized = (file: string, bytes: number) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ""); fs.truncateSync(file, bytes); return file; };
const contentsFor = (name: string) => (name.endsWith(".jsonl") ? `{"id":"a","title":"x"}\n` : name === "todos.json" ? todos("x") : name === "memos.json" ? '{"memos":[]}\n' : "[]\n");

test("the limits are the shared ones (64MB .jongi, 32MB data file)", () => {
  assert.deepEqual({ backupBytes: fileLimits.backupBytes, dataFileBytes: fileLimits.dataFileBytes }, cases.limits);
});

for (const entry of cases.links) {
  test(`${entry.id} ${entry.about}`, () => {
    const folder = temporary();
    const outside = temporary();
    const secret = put(outside, "elsewhere.txt", contentsFor(entry.file));
    put(folder, "repeats.json", "[]\n");
    const at = path.join(folder, ...entry.file.split("/"));
    if (entry.expect === "read") put(folder, entry.file, contentsFor(entry.file));
    else { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(secret, at); }
    if (entry.where === "read") {
      const skipped: string[] = [];
      const files = readDataFiles(folder, skipped);
      if (entry.expect === "skipped") {
        assert.equal(files[entry.file], undefined);
        assert.deepEqual(skipped, [entry.file]);
        assert.equal(files["repeats.json"], "[]\n", "the other files are read");
      } else {
        assert.equal(files[entry.file], contentsFor(entry.file));
        assert.deepEqual(skipped, []);
      }
    } else {
      const imported: BackupFiles = { "todos.json": todos("가져온 것"), [entry.file]: '{"memos":[{"id":"x"}]}\n' };
      importInto(folder, path.join(outside, "backups"), imported, "replace", "test", new Date());
      assert.ok(fs.lstatSync(at).isSymbolicLink(), "the link stays a link");
      assert.equal(fs.readFileSync(secret, "utf8"), contentsFor(entry.file), "what it points at is untouched");
      assert.match(fs.readFileSync(path.join(folder, "todos.json"), "utf8"), /가져온 것/, "the other files go in");
    }
  });
}

for (const entry of cases.size) {
  test(`${entry.id} ${entry.about}`, () => {
    const folder = temporary();
    const limit = entry.kind === "backup" ? cases.limits.backupBytes : cases.limits.dataFileBytes;
    const name = entry.file ?? (entry.kind === "backup" ? "copy.jongi" : "todos.json");
    const file = sized(path.join(folder, name), entry.bytes === "limit" ? limit : limit + 1);
    if (entry.expect === "allowed") {
      assert.doesNotThrow(() => checkFile(file, limit));
      return;
    }
    assert.throws(() => checkFile(file, limit), (error: unknown) => error instanceof RefusedFile && error.why === "tooLarge");
    if (entry.kind === "backup") {
      // 가져오기 (a file the person picked) and 되돌리기 (a copy in the backup folder) both refuse it before reading.
      assert.throws(() => readChosenText(file), RefusedFile);
      assert.throws(() => readTextSafely(file, fileLimits.backupBytes), RefusedFile);
    } else {
      const skipped: string[] = [];
      assert.equal(readDataFiles(folder, skipped)[name], undefined);
      assert.deepEqual(skipped, [name]);
    }
  });
}

test("the refusal's words (ko · en · nl), the same as the Mac's", () => {
  for (const lang of ["ko", "en", "nl"] as const) assert.equal(backupMessages[lang].tooLarge, cases.messages.tooLarge[lang]);
});

for (const entry of cases.temporary) {
  test(`${entry.id} ${entry.about}`, () => {
    const folder = temporary();
    const file = path.join(folder, entry.file);
    if (entry.expect === "unique") {
      const names = new Set(Array.from({ length: 50 }, () => temporaryPath(file)));
      assert.equal(names.size, 50);
    } else if (entry.expect === "beside") {
      const name = temporaryPath(file);
      assert.equal(path.dirname(name), folder);
      assert.ok(path.basename(name).startsWith(`${entry.file}.`) && path.basename(name) !== `${entry.file}.tmp`);
    } else if (entry.expect === "untouched") {
      const outside = temporary();
      const secret = put(outside, "elsewhere.txt", "keep me");
      fs.symlinkSync(secret, path.join(folder, entry.planted!));
      writeFileAtomically(file, todos("저장"));
      assert.equal(fs.readFileSync(secret, "utf8"), "keep me");
      assert.match(fs.readFileSync(file, "utf8"), /저장/);
    } else {
      writeFileAtomically(file, todos("한 번"));
      writeFileAtomically(file, todos("두 번"));
      assert.deepEqual(fs.readdirSync(folder), [entry.file]);
    }
  });
}

test("a link where the file goes is not written through, even by writeFileAtomically", () => {
  const folder = temporary();
  const secret = put(temporary(), "elsewhere.txt", "keep me");
  fs.symlinkSync(secret, path.join(folder, "todos.json"));
  assert.throws(() => writeFileAtomically(path.join(folder, "todos.json"), "x"), RefusedFile);
  assert.equal(fs.readFileSync(secret, "utf8"), "keep me");
});

test("the shared folder: a linked or oversized todos.json / memo-trash.json is not read, never saved over, and the note says why", () => {
  const folder = temporary();
  const secret = put(temporary(), "elsewhere.json", todos("남의 파일"));
  fs.symlinkSync(secret, path.join(folder, "todos.json"));
  sized(path.join(folder, "memo-trash.json"), fileLimits.dataFileBytes + 1);
  const store = new Store(folder);
  try {
    assert.equal(store.items.length, 0, "the link is not read");
    assert.match(store.storageError ?? "", /todos\.json|memo-trash\.json/);
    store.mutate((history) => { history.add("여기서 적은 것"); });
    store.flush();
    assert.ok(fs.lstatSync(path.join(folder, "todos.json")).isSymbolicLink(), "still the link");
    assert.match(fs.readFileSync(secret, "utf8"), /남의 파일/, "what it points at is untouched");
    assert.equal(fs.statSync(path.join(folder, "memo-trash.json")).size, fileLimits.dataFileBytes + 1, "the big file is untouched");
    // Once it is a normal file again, it is read and the message goes.
    fs.unlinkSync(path.join(folder, "todos.json"));
    fs.writeFileSync(path.join(folder, "todos.json"), todos("다시 보통 파일"));
    fs.rmSync(path.join(folder, "memo-trash.json"));
    store.catchUp(undefined, true);
    assert.deepEqual(store.items.map((item) => item.title), ["다시 보통 파일"]);
    assert.equal(store.storageError, undefined);
  } finally {
    store.unwatch();
  }
});

test("the record: a linked month is neither merged from nor appended through", () => {
  const source = temporary();
  const target = temporary();
  const secret = put(temporary(), "elsewhere.jsonl", `{"id":"secret","title":"남의 것"}\n`);
  fs.mkdirSync(path.join(source, "archive"), { recursive: true });
  fs.symlinkSync(secret, path.join(source, "archive", "2026-09.jsonl"));
  put(source, "archive/2026-10.jsonl", `{"id":"a","title":"내 것"}\n`);
  fs.mkdirSync(path.join(target, "archive"), { recursive: true });
  fs.symlinkSync(secret, path.join(target, "archive", "2026-10.jsonl"));
  mergeArchive(source, target);
  assert.equal(fs.existsSync(path.join(target, "archive", "2026-09.jsonl")), false, "the linked month isn't copied");
  assert.equal(fs.readFileSync(secret, "utf8"), `{"id":"secret","title":"남의 것"}\n`, "nothing appended through the link");
});

test("the backup list: a link is not listed, and an oversized copy is listed without its counts", async () => {
  const settings = temporary();
  const data = temporary();
  const backups = path.join(settings, "backups");
  put(data, "todos.json", todos("x"));
  const list = new AutoBackup(settings, () => data, () => "test");
  list.copy("manual", new Date(2026, 9, 8, 9, 0, 0));
  const secret = put(temporary(), "elsewhere.jongi", makeBackup({ "todos.json": todos("남의 것") }, "x", new Date()));
  fs.symlinkSync(secret, path.join(backups, "직접-20261009-090000.jongi")); // i18n-ok: a file name
  sized(path.join(backups, "직접-20261010-090000.jongi"), fileLimits.backupBytes + 1); // i18n-ok: a file name
  const names = list.view(false).entries.map((entry) => entry.name);
  assert.deepEqual(names, ["직접-20261010-090000.jongi", "직접-20261008-090000.jongi"]); // i18n-ok: file names
  assert.equal(list.fileOf("직접-20261009-090000.jongi"), undefined); // i18n-ok: a file name
  await assert.rejects(AutoBackup.countsOf(path.join(backups, "직접-20261010-090000.jongi")), RefusedFile); // i18n-ok: a file name
});
