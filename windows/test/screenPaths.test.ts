import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tables } from "../src/i18n";

/**
 * #388: the app's own folder names (PaperTodo, ‘backups’) and full paths stay off the screen. Settings and slips say
 * ‘이 PC의 기본 폴더’ · ‘백업 폴더’ with a 폴더 열기 button; paths belong only in 도움말's 알아 두기 (docs/writing.md).
 */
const source = (file: string) => fs.readFileSync(path.join(process.cwd(), "src", file), "utf8");

test("slips never show a full path: the export failures have no detail with the file's path (#388)", () => {
  const main = source("main/main.ts");
  assert.doesNotMatch(main, /detail:\s*result\.filePath/);
  assert.doesNotMatch(main, /detail:\s*file\b/);
});

test("the storage pane draws a folder's place only for a folder the user chose (#388)", () => {
  const settings = source("renderer/settings.ts");
  const placed = [...settings.matchAll(/(\S+)\s*\?\s*folderPlaceLine\(/g)].map((match) => match[1]);
  const calls = settings.match(/folderPlaceLine\(/g)?.length ?? 0;
  // The definition, then each call behind ‘custom ?’.
  assert.equal(calls - 1, placed.length, "every folderPlaceLine(...) call is behind a custom check");
  for (const check of placed) assert.match(check, /custom$/);
  assert.match(settings, /storage\.custom \? folderPlace\(.*\)\.name : t\("이 PC의 기본 폴더"\)/);
});

test("no slip or setting names the ‘backups’ folder; 도움말 may (#388)", () => {
  const help = source("renderer/help.ts");
  for (const [language, table] of Object.entries(tables)) {
    for (const [key, value] of Object.entries(table)) {
      if (!value.includes("‘backups’")) continue;
      assert.ok(help.includes(JSON.stringify(key).slice(1, -1).slice(0, 30)), `${language}: ${key} names ‘backups’ outside the help`);
    }
  }
});
