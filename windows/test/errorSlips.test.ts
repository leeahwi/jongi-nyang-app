import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * #390 (docs/writing.md 오류): an error slip says what didn't happen and what is safe, then what to do; its default
 * button is 닫기, and the next step is a button beside it. The same list as the Mac's SlipAlert.inform calls.
 */
const main = fs.readFileSync(path.join(process.cwd(), "src", "main", "main.ts"), "utf8");

/** Each ask({ icon: "warning" | "folder", title: …, message: …-지 못했어요/없어요 … }) as one statement. */
function errorSlips(): string[] {
  const slips: string[] = [];
  for (const match of main.matchAll(/ask\((?:note|parent|dialogParent\(\)), \{ icon: "(?:warning|folder)", (?:cat: false, )?title: t\("[^"]+"(?:, undefined, "restore")?\), message[^;]*;/g)) {
    if (/못했어요|둘 수 없어요|message, /.test(match[0])) slips.push(match[0]);
  }
  return slips;
}

test("error slips close with 닫기, never 확인 (#390)", () => {
  const slips = errorSlips();
  assert.ok(slips.length >= 7, `found ${slips.length}`);
  for (const slip of slips) {
    assert.doesNotMatch(slip, /t\("확인"\)/, slip);
    assert.match(slip, /\{ label: t\("닫기"\), kind: "primary" \}/, slip);
    // No cat beside an error, as the Mac's SlipAlert.inform (cat: nil).
    assert.match(slip, /cat: false/, slip);
  }
});

test("error slips offer the next step the Mac's do (#390)", () => {
  const next = (title: string) => errorSlips().filter((slip) => slip.includes(`title: t("${title}")`))
    .map((slip) => /buttons: \[\{ label: t\("([^"]+)"\), kind: "ghost" \}/.exec(slip)?.[1] ?? "");
  assert.deepEqual(next("텍스트로 내보내기"), ["다시 시도"]);
  assert.deepEqual(next("내보내기"), ["다시 시도"]);
  assert.deepEqual(next("자동 백업"), ["백업 폴더 열기"]);
  assert.deepEqual(next("백업 폴더"), ["다른 폴더…"]);
  assert.deepEqual(next("저장 위치").filter(Boolean), ["다시 시도"]);
  assert.deepEqual(next("가져오기"), [""]);
});

test("error messages lead with what didn't happen and that the list is safe (#390)", () => {
  assert.doesNotMatch(main, /await warn\(refused \?/);
  assert.doesNotMatch(main, /await warn\(parsed\.error, path\.basename/);
  assert.doesNotMatch(main, /detail: t\("마지막 백업을 하지 못했어요\. 백업 폴더를 확인해 주세요\."\)/);
});
