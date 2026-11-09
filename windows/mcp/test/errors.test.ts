import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { failure } from "../src/errors";
import { Busy, FileFailed, Unreadable } from "../src/files";
import { Problem } from "../src/tools";
import { temporaryFolder } from "../../test/temporaryFolder";

/**
 * #109 at the source: whatever a tool throws becomes a fixed code and sentence. The errors here are real
 * ones made on a temporary folder whose path holds the user's name (fictional data), and plain errors
 * whose text names the home folder — none of it may come out.
 */

const user = os.userInfo().username;
const folder = path.join(temporaryFolder("paper-todo-ai-errors-"), user, "종이냥 저장");
fs.mkdirSync(path.join(folder, "todos.json"), { recursive: true });

function clean(text: string, label: string): void {
  for (const secret of [os.homedir(), os.tmpdir(), fs.realpathSync(os.tmpdir()), folder, user].filter((value) => value.length >= 3)) {
    assert.ok(!text.includes(secret), `${label}: no ‘${secret}’ in ${JSON.stringify(text)}`);
  }
  assert.doesNotMatch(text, /[A-Za-z]:\\|\/[^\s/]+\/|\\[^\s\\]+\\/, `${label}: nothing shaped like a path`);
}

const thrown = (work: () => unknown): unknown => { try { work(); } catch (error) { return error; } assert.fail("did not throw"); };

test("M34: system errors, unknown errors and conflicts become fixed codes and sentences in ko · en · nl", () => {
  const eisdir = thrown(() => fs.readFileSync(path.join(folder, "todos.json")));
  const enoent = thrown(() => fs.writeFileSync(path.join(folder, "없음", "todos.json"), "x"));
  const parse = thrown(() => JSON.parse(`{ "items": [ ${folder}`));
  assert.ok(String((eisdir as Error).message ?? "").length > 0);
  const cases: [unknown, string, Record<"ko" | "en" | "nl", RegExp>][] = [
    [new FileFailed("todos.json", "EISDIR"), "FILE_IS_FOLDER", { ko: /^todos\.json 자리에 파일이 아닌 것이 있어서/, en: /^todos\.json isn’t a file/, nl: /^todos\.json is geen bestand/ }],
    [new FileFailed("events.json", "EACCES"), "FILE_NO_ACCESS", { ko: /^events\.json을 열 권한이 없어서/, en: /^No permission to open events\.json/, nl: /^Geen toestemming om events\.json te openen/ }],
    [new FileFailed("memos.json", "ENOSPC"), "DISK_FULL", { ko: /^디스크에 자리가 없어서 memos\.json을/, en: /^The disk is full/, nl: /^De schijf is vol/ }],
    [new FileFailed("todos.json", "EIO"), "FILE_ERROR", { ko: /^todos\.json을 읽거나 쓰지 못했어요/, en: /^todos\.json couldn’t be read or written/, nl: /^todos\.json kon niet worden gelezen/ }],
    [new FileFailed("events.json", "ENOENT", false), "WRITE_HALF_DONE", { ko: /되돌리지 못했어요/, en: /couldn’t be undone/, nl: /niet ongedaan/ }],
    [new FileFailed(folder, "EISDIR"), "FILE_IS_FOLDER", { ko: /^종이냥 자리에/, en: /^종이냥 isn’t a file/, nl: /^종이냥 is geen bestand/ }],
    [new Unreadable("events.json"), "FILE_UNREADABLE", { ko: /^events\.json을 읽지 못해서 손대지 않았어요/, en: /^events\.json couldn’t be read/, nl: /^events\.json kon niet worden gelezen/ }],
    [new Busy("todos.json"), "FILE_BUSY", { ko: /^todos\.json이 계속 바뀌고 있어서/, en: /^todos\.json kept changing/, nl: /^todos\.json bleef veranderen/ }],
    // Raw ones the tools didn't wrap: by their system code, or else UNKNOWN.
    [eisdir, "FILE_IS_FOLDER", { ko: /^종이냥 자리에/, en: /isn’t a file/, nl: /geen bestand/ }],
    [enoent, "FILE_NOT_FOUND", { ko: /쓸 자리를 찾지 못했어요/, en: /^Couldn’t find where to write/, nl: /^Kon de plek/ }],
    [parse, "UNKNOWN", { ko: /^알 수 없는 문제로 하지 못했어요/, en: /^Something unexpected went wrong/, nl: /^Er ging iets onverwachts mis/ }],
    [new Error(`EISDIR: illegal operation on a directory, rename '${folder}/todos.json.ai-1.tmp' -> '${folder}/todos.json'`), "UNKNOWN", { ko: /^알 수 없는/, en: /^Something unexpected/, nl: /^Er ging iets/ }],
    [`${os.homedir()} ${user}`, "UNKNOWN", { ko: /^알 수 없는/, en: /^Something unexpected/, nl: /^Er ging iets/ }],
  ];
  for (const [error, code, sentences] of cases) {
    for (const lang of ["ko", "en", "nl"] as const) {
      const { code: got, text, detail } = failure(error, lang);
      const label = `${code} ${lang}`;
      assert.equal(got, code, label);
      assert.match(text, sentences[lang], `${label}: ${text}`);
      assert.ok(text.endsWith(`(${lang === "ko" ? "코드" : "code"} ${code})`), `${label}: ${text}`);
      clean(text, label);
      clean(detail, `${label} (stderr)`);
    }
  }
  // The tools' own refusals keep their words; a conflict says so in its code.
  assert.deepEqual(failure(new Problem("제목이 비어 있어요."), "ko").code, "REFUSED");
  assert.deepEqual(failure(new Problem("바뀌었어요.", "ITEM_CHANGED"), "ko").code, "ITEM_CHANGED");
});
