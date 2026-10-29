import assert from "node:assert/strict";
import { test } from "node:test";
import type { Memo } from "../src/core/memo";
import {
  addFolder, changedToday, checklistProgress, deleteFolder, drawerFooter, drawerSearch, emptyMemoFolders, folderName, inboxID, isCodeLine, lastFolderOf,
  memosIn, mergeMemoFolders, moveMemo, parseMemoFolders, pinnedView, placeNew, placementOf, pruneMemoFolders, quickWriteText, readDrawerShortcut,
  readShortcut, renameFolder, reorderFolders, serializeMemoFolders, setPinned, shortcutLabel, shownColor, slipSummary, slipTime, targetOf, toggleChecklist,
  viewForDigit, visibleFolders, type KeyPress, type MemoFolders,
} from "../src/core/memoDrawer";

// 메모 서랍: the shared cases D1–D16, verbatim from the shared memo drawer cases (the Mac's MemoDrawerTests.swift).

const now = new Date("2026-10-27T05:00:00Z");
const memo = (id: string, text: string, updatedAt = "2026-10-27T04:00:00Z"): Memo => ({ id, text, createdAt: updatedAt, updatedAt });
const m1 = memo("m1", "회의 메모\n- [ ] 우유\n- [x] 빵");
const m2 = memo("m2", "npm run build");
const m3 = memo("m3", "인사\n하이 반가워");
const memos = [m1, m2, m3];
const ids = (list: readonly { id: string }[]) => list.map((entry) => entry.id);

const SAMPLE = `{
  "v": 1,
  "folders": [
    { "id": "inbox", "name": "메모", "color": "lavender", "order": 0, "updatedAt": "1970-01-01T00:00:00Z" },
    { "id": "work", "name": "회사", "color": "pink", "order": 1, "updatedAt": "2026-10-26T09:00:00Z" },
    { "id": "home", "name": "집", "color": "mint", "order": 2, "updatedAt": "2026-10-26T09:00:00Z" }
  ],
  "placement": {
    "gone": { "folder": "work", "pinned": false, "at": "2026-10-26T09:00:00Z" },
    "m1": { "folder": "work", "pinned": true, "at": "2026-10-26T09:00:00Z" },
    "m3": { "folder": "work", "pinned": false, "at": "2026-10-26T09:00:00Z" }
  },
  "updatedAt": "2026-10-26T09:00:00Z"
}
`;
const sample = (): MemoFolders => parseMemoFolders(SAMPLE);
const LIST = "장보기\n- [ ] 우유\n- [ ] 빵\n  * [X] 계란\n-[ ] 아님\n- [ ]아님";

test("memo drawer: the file round-trips byte for byte", () => {
  assert.equal(serializeMemoFolders(sample()), SAMPLE);
});

test("D1: no file — the inbox alone, every memo in it; its name in each language", () => {
  const fresh = emptyMemoFolders("ko");
  assert.deepEqual(ids(visibleFolders(fresh)), [inboxID]);
  for (const entry of memos) assert.equal(placementOf(fresh, entry.id).folder, inboxID);
  assert.equal(serializeMemoFolders(fresh), '{\n  "v": 1,\n  "folders": [\n    { "id": "inbox", "name": "메모", "color": "lavender", "order": 0, "updatedAt": "1970-01-01T00:00:00Z" }\n  ],\n  "placement": {},\n  "updatedAt": "1970-01-01T00:00:00Z"\n}\n');
  assert.equal(emptyMemoFolders("en").folders[0].name, "Notes");
  assert.equal(emptyMemoFolders("nl").folders[0].name, "Notities");
  assert.equal(folderName(fresh.folders[0], "en"), "Notes");
  const renamed = renameFolder(fresh, inboxID, "  받은 메모 ", now);
  assert.equal(renamed.folders[0].name, "받은 메모");
  for (const lang of ["ko", "en", "nl"] as const) assert.equal(folderName(renamed.folders[0], lang), "받은 메모");
});

test("D2: a memo without a placement is in the inbox; 고정 shows pinned ones", () => {
  const data = sample();
  assert.equal(placementOf(data, "m2").folder, inboxID);
  assert.equal(placementOf(data, "m1").folder, "work");
  assert.deepEqual(ids(memosIn(data, memos, "work")), ["m1", "m3"]);
  assert.deepEqual(ids(memosIn(data, memos, inboxID)), ["m2"]);
  assert.deepEqual(ids(memosIn(data, memos, pinnedView)), ["m1"]);
  const nowhere = { ...data, placement: { ...data.placement, m2: { folder: "nowhere", pinned: false, at: "2026-10-26T09:00:00Z" } } };
  assert.equal(placementOf(nowhere, "m2").folder, inboxID);
});

test("D3: deleting a folder sends its memos to the inbox (pins kept); the tombstone goes after 30 days", () => {
  const before = sample();
  const data = deleteFolder(before, "work", now);
  assert.notEqual(data, before); // "returns true"
  assert.deepEqual(ids(visibleFolders(data)), [inboxID, "home"]);
  assert.deepEqual(ids(memosIn(data, memos, inboxID)), ["m1", "m2", "m3"]);
  assert.deepEqual(data.placement.m1, { folder: inboxID, pinned: true, at: "2026-10-27T05:00:00Z" });
  assert.ok(serializeMemoFolders(data).includes('    { "id": "work", "name": "회사", "color": "pink", "order": 1, "updatedAt": "2026-10-27T05:00:00Z", "deleted": true }'));
  const keep = new Set(ids(memos));
  assert.equal(pruneMemoFolders(data, keep, new Date("2026-11-27T05:00:00Z")).folders.length, 2);
  assert.equal(pruneMemoFolders(data, keep, new Date("2026-11-20T05:00:00Z")).folders.length, 3);
});

test("D4: the inbox can't be deleted", () => {
  const data = sample();
  assert.equal(deleteFolder(data, inboxID, now), data); // "returns false"
  assert.equal(serializeMemoFolders(deleteFolder(data, inboxID, now)), SAMPLE);
});

test("D5: an older version saved memos.json only — folders as they were, its new memo in the inbox", () => {
  const data = sample();
  const all = [...memos, memo("m4", "옛 버전에서 적음")];
  assert.equal(placementOf(data, "m1").folder, "work");
  assert.equal(placementOf(data, "m4").folder, inboxID);
  assert.deepEqual(ids(memosIn(data, all, inboxID)), ["m2", "m4"]);
});

test("D6: a placement of a memo that is gone is ignored and dropped on the next write", () => {
  const data = sample();
  assert.equal(memosIn(data, memos, "work").length, 2);
  const pruned = pruneMemoFolders(data, new Set(["m1", "m2", "m3"]), now);
  assert.deepEqual(Object.keys(pruned.placement).sort(), ["m1", "m3"]);
  assert.ok(!serializeMemoFolders(pruned).includes('"gone"'));
});

test("D7, D8: a checkbox turned over changes only [ ] / [x] on that line", () => {
  assert.equal(toggleChecklist(LIST, 1), "장보기\n- [x] 우유\n- [ ] 빵\n  * [X] 계란\n-[ ] 아님\n- [ ]아님");
  assert.equal(toggleChecklist("a\r\n- [ ] b\r\nc", 1), "a\r\n- [x] b\r\nc");
  for (const line of [0, 4, 5, 99]) assert.equal(toggleChecklist(LIST, line), LIST);
  assert.equal(toggleChecklist(LIST, 3), "장보기\n- [ ] 우유\n- [ ] 빵\n  * [ ] 계란\n-[ ] 아님\n- [ ]아님");
  assert.equal(toggleChecklist("- [x] 끝", 0), "- [ ] 끝");
});

test("D9: checklist progress; a memo without checklist lines has no bar", () => {
  assert.deepEqual(checklistProgress(LIST), { done: 1, total: 3 });
  assert.equal(checklistProgress("그냥 메모\n- 목록"), undefined);
  assert.equal(checklistProgress("- [ ]"), undefined);
});

test("D9b: a collapsed slip's title and two rows", () => {
  assert.deepEqual(slipSummary(memo("x", "\n\n- [ ] 우유 사기\n\n- [x] 빵\n- [ ] 계란\n- [ ] 버터")), { title: "우유 사기", preview: ["☑ 빵", "☐ 계란"] });
  assert.deepEqual(slipSummary(memo("x", "  \n")), { title: "빈 메모", preview: [] });
  assert.equal(slipSummary(memo("x", "  \n"), "en").title, "Empty note");
  assert.equal(slipSummary(memo("x", "  \n"), "nl").title, "Lege notitie");
  assert.deepEqual(slipSummary(memo("x", "회의\n첫째\n둘째\n셋째")).preview, ["첫째", "둘째"]);
});

test("D10: the quick-write slip — blank makes nothing, the text is trimmed at both ends", () => {
  assert.equal(quickWriteText("  \n\t "), undefined);
  assert.equal(quickWriteText("  우유 사기\n  내일 \n"), "우유 사기\n  내일");
});

test("D11: writing in 고정 goes to the inbox, pinned", () => {
  const data = sample();
  assert.deepEqual(targetOf(data, pinnedView), { folder: inboxID, pinned: true });
  assert.deepEqual(targetOf(data, "home"), { folder: "home", pinned: false });
  assert.deepEqual(targetOf(data, "nowhere"), { folder: inboxID, pinned: false });
  const written = placeNew(data, "new", targetOf(data, pinnedView), now);
  assert.deepEqual(written.placement.new, { folder: inboxID, pinned: true, at: "2026-10-27T05:00:00Z" });
  assert.equal(written.updatedAt, "2026-10-27T05:00:00Z");
});

test("D12: search over every folder (초성 too), lines as written, folder names", () => {
  const data = sample();
  const hits = (query: string) => drawerSearch(data, memos, query).map((hit) => [hit.memo.id, hit.text, hit.range, hit.folder]);
  assert.deepEqual(hits("ㅎㅇ"), [["m1", "회의 메모", [0, 2], "work"], ["m3", "하이 반가워", [0, 2], "work"]]);
  assert.deepEqual(hits("build").map((hit) => [hit[0], hit[3]]), [["m2", inboxID]]);
  assert.deepEqual(hits("우유").map((hit) => [hit[0], hit[1]]), [["m1", "- [ ] 우유"]]);
  assert.deepEqual(hits("회사"), [["m1", "회의 메모", undefined, "work"], ["m3", "인사", undefined, "work"]]);
  assert.deepEqual(hits("   "), []);
});

test("D13: two devices put the same memo in different folders — the later one wins; a tie keeps this device's", () => {
  const here = moveMemo(sample(), "m2", "work", new Date("2026-10-27T05:00:00Z"));
  const theirs = moveMemo(sample(), "m2", "home", new Date("2026-10-27T05:01:00Z"));
  assert.equal(placementOf(mergeMemoFolders(here, theirs), "m2").folder, "home");
  assert.equal(placementOf(mergeMemoFolders(theirs, here), "m2").folder, "home");
  const tie = moveMemo(sample(), "m2", "home", new Date("2026-10-27T05:00:00Z"));
  assert.equal(placementOf(mergeMemoFolders(here, tie), "m2").folder, "work");
  const renamed = renameFolder(sample(), "home", "우리 집", new Date("2026-10-27T05:00:00Z"));
  const deleted = deleteFolder(sample(), "home", new Date("2026-10-27T05:02:00Z"));
  assert.deepEqual(ids(visibleFolders(mergeMemoFolders(renamed, deleted))), [inboxID, "work"]);
  assert.deepEqual(ids(visibleFolders(mergeMemoFolders(deleted, renamed))), [inboxID, "work"]);
});

test("D14: the same name made on two devices — both stay", () => {
  const here = addFolder(sample(), "공부", "sky", "a", now);
  const theirs = addFolder(sample(), "공부", "yellow", "b", now);
  const merged = mergeMemoFolders(here, theirs);
  assert.deepEqual(ids(visibleFolders(merged)), [inboxID, "work", "home", "a", "b"]);
  assert.deepEqual(merged.folders.filter((folder) => folder.id === "a" || folder.id === "b").map((folder) => folder.order), [3, 3]);
});

test("D15: an unreadable file is refused (the store keeps it aside); odd entries are read as far as possible", () => {
  for (const text of ["{ not json", "[]", '{"v":1}', '{"v":1,"folders":{}}', ""]) assert.throws(() => parseMemoFolders(text), text);
  const odd = parseMemoFolders('{"folders":[{"name":"no id"},{"id":"x","name":"X","color":"teal"}],"placement":{"m1":3}}');
  assert.deepEqual(ids(visibleFolders(odd)), [inboxID, "x"]);
  const x = odd.folders.find((folder) => folder.id === "x")!;
  assert.equal(shownColor(x.color), "lavender");
  assert.ok(serializeMemoFolders(odd).includes('"color": "teal"'));
  assert.deepEqual(odd.placement, {});
});

test("D16: Ctrl+1–9 follow the bookmarks, Ctrl+0 is 고정, a missing number does nothing", () => {
  const data = sample();
  assert.equal(viewForDigit(data, 1), inboxID);
  assert.equal(viewForDigit(data, 3), "home");
  assert.equal(viewForDigit(data, 4), undefined);
  assert.equal(viewForDigit(data, 0), pinnedView);
  assert.equal(viewForDigit(data, 10), undefined);
});

test("memo drawer: the last folder, new folders' names, the order, the handle's number", () => {
  const data = sample();
  assert.equal(lastFolderOf(data, undefined), inboxID);
  assert.equal(lastFolderOf(data, "home"), "home");
  assert.equal(lastFolderOf(deleteFolder(data, "home", now), "home"), inboxID);
  assert.equal(lastFolderOf(data, pinnedView), inboxID);
  const made = addFolder(data, "  공부\n노트  ", "sky", "s", now);
  const study = made.folders.find((folder) => folder.id === "s")!;
  assert.equal(study.name, "공부 노트");
  assert.equal(study.order, 3);
  assert.equal(addFolder(data, "   ", "sky", "t", now), data);
  assert.equal(renameFolder(data, "work", "  ", now), data);
  assert.equal([...addFolder(data, "가".repeat(60), "sky", "u", now).folders.at(-1)!.name].length, 40);
  const earlier = addFolder(data, "공부", "sky", "s", new Date("2026-10-26T10:00:00Z"));
  const reordered = reorderFolders(earlier, ["home", inboxID], now);
  assert.deepEqual(ids(visibleFolders(reordered)), ["home", inboxID, "work", "s"]);
  assert.deepEqual(reordered.folders.filter((folder) => folder.updatedAt === "2026-10-27T05:00:00Z").map((folder) => folder.id).sort(), ["home", inboxID, "work"].sort());
  assert.equal(setPinned(data, "m1", true, now), data);
  assert.equal(placementOf(setPinned(data, "m2", true, now), "m2").pinned, true);
  const local = new Date(2026, 9, 27, 15, 0);
  assert.equal(changedToday([memo("a", "x", new Date(2026, 9, 27, 0, 30).toISOString()), memo("b", "y", new Date(2026, 9, 26, 23, 30).toISOString())], local), 1);
});

test("memo drawer: slip times, footers, code lines", () => {
  const today = new Date(2026, 9, 27, 15, 0);
  assert.equal(slipTime(new Date(2026, 9, 27, 10, 12).toISOString(), today), "10:12");
  assert.equal(slipTime(new Date(2026, 9, 27, 10, 12).toISOString(), today, "en"), "10:12 AM");
  assert.deepEqual(["ko", "en", "nl"].map((lang) => slipTime(new Date(2026, 9, 26, 22, 0).toISOString(), today, lang as "ko")), ["어제", "Yesterday", "Gisteren"]);
  assert.equal(slipTime(new Date(2026, 9, 21, 9, 0).toISOString(), today), "10월 21일");
  assert.equal(slipTime(new Date(2025, 11, 30, 9, 0).toISOString(), today, "en"), "Dec 30, 2025");
  assert.equal(drawerFooter("folder", 5, "회사"), "회사에 다섯 장");
  assert.equal(drawerFooter("folder", 12, "회사"), "회사에 12장");
  assert.equal(drawerFooter("folder", 0, "회사"), "회사는 비어 있어요");
  assert.equal(drawerFooter("folder", 1, "Work", "en"), "1 note in Work");
  assert.equal(drawerFooter("folder", 5, "Werk", "nl"), "5 notities in Werk");
  assert.equal(drawerFooter("pinned", 3), "고정한 메모 세 장");
  assert.equal(drawerFooter("search", 2, "", "en"), "2 notes in all folders");
  assert.equal(drawerFooter("search", 0, "", "nl"), "Geen notities gevonden");
  for (const line of ["git log --oneline -5", "$ ls -la", "    indented()", "`brew install gh`", "npm run build"]) assert.ok(isCodeLine(line), line);
  for (const line of ["git", "주간 회의", "open the door", "cd 집으로"]) assert.ok(!isCodeLine(line), line);
});

test("memo drawer: recording the shortcut — modifiers, the app's own keys, labels", () => {
  const press = (code: string, mods: Partial<KeyPress> = {}): KeyPress => ({ key: code.replace(/^Key/, "").toLowerCase(), code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
  assert.deepEqual(readShortcut(press("KeyD", { ctrlKey: true, shiftKey: true })), { accelerator: "Control+Shift+D" });
  assert.deepEqual(readShortcut({ ...press("ControlLeft", { ctrlKey: true }), key: "Control" }), { problem: "waiting" });
  assert.deepEqual(readShortcut(press("KeyD", { shiftKey: true })), { problem: "modifier" });
  assert.deepEqual(readShortcut(press("KeyD")), { problem: "modifier" });
  for (const key of ["KeyM", "KeyJ", "KeyN"]) assert.deepEqual(readShortcut(press(key, { ctrlKey: true, altKey: true })), { problem: "reserved" });
  assert.deepEqual(readShortcut(press("KeyM", { ctrlKey: true, altKey: true, shiftKey: true })), { accelerator: "Control+Alt+Shift+M" });
  assert.deepEqual(readShortcut(press("F8")), { accelerator: "F8" });
  assert.deepEqual(readShortcut(press("Digit5", { altKey: true, metaKey: true })), { accelerator: "Alt+Super+5" });
  assert.equal(shortcutLabel("Control+Shift+D"), "Ctrl+Shift+D");
  assert.equal(shortcutLabel("Alt+Super+5"), "Alt+Win+5");
  assert.equal(readDrawerShortcut(undefined), "Control+Shift+D");
  assert.equal(readDrawerShortcut(""), "");
  assert.equal(readDrawerShortcut("Control+Alt+J"), "Control+Shift+D");
  assert.equal(readDrawerShortcut("Control+Alt+K"), "Control+Alt+K");
});

test("the note's search finds a memo by its drawer folder's name", async () => {
  const { search } = await import("../src/core/search");
  const groups = search({ items: [], memos, archive: [], events: [], memoFolder: (id) => (id === "m3" ? "회사" : undefined) }, "회사", now);
  assert.deepEqual(groups.map((group) => group.rows.map((row) => [row.id, row.text, row.range])), [[["m3", "인사", [0, 0]]]]);
  assert.match(groups[0].rows[0].meta, /^회사 · /);
});

// ─── M-rows: the memo tab gone (the shared memo drawer cases) ─────────────

test("M1–M3: the move notice — once, only with memos, the count in words, the shortcut named", async () => {
  const { moveNotice } = await import("../src/core/memoDrawer");
  const notice = moveNotice(5, false, "Control+Shift+D")!;
  assert.equal(notice.title, "메모가 서랍으로 옮겨 갔어요");
  assert.equal(notice.message, "메모 탭에 있던 메모 다섯 장은 서랍의 ‘메모’ 폴더에 그대로 있어요. Ctrl+Shift+D 키나 노트 위의 서랍 버튼으로 열어요.");
  assert.deepEqual([notice.open, notice.later], ["서랍 열기", "나중에"]);
  assert.equal(moveNotice(5, false, "")!.message, "메모 탭에 있던 메모 다섯 장은 서랍의 ‘메모’ 폴더에 그대로 있어요. 노트 위의 서랍 버튼으로 열어요.");
  const en = moveNotice(5, false, "Control+Shift+D", "en")!;
  assert.equal(en.title, "Your notes moved to the drawer");
  assert.equal(en.message, "All 5 notes from the Notes tab are in the drawer’s ‘Notes’ folder. Open it with Ctrl+Shift+D or the drawer button above the notepad.");
  assert.equal(moveNotice(1, false, "", "en")!.message, "The note from the Notes tab is in the drawer’s ‘Notes’ folder. Open it with the drawer button above the notepad.");
  const nl = moveNotice(5, false, "Control+Shift+D", "nl")!;
  assert.equal(nl.title, "Je notities staan nu in de lade");
  assert.equal(nl.message, "Alle 5 notities van het tabblad Notities staan in de map ‘Notities’ van de lade. Open haar met Ctrl+Shift+D of de ladeknop boven het notitieblok.");
  assert.equal(moveNotice(5, false, "", "nl")!.message, "Alle 5 notities van het tabblad Notities staan in de map ‘Notities’ van de lade. Open haar met de ladeknop boven het notitieblok.");
  assert.equal(moveNotice(0, false, "Control+Shift+D"), undefined); // M2
  assert.equal(moveNotice(5, true, "Control+Shift+D"), undefined); // M3
});

test("M4: /메모 우유 — the memo in the last folder, the toast says the drawer", async () => {
  const { addedText } = await import("../src/core/intent");
  assert.equal(addedText({ kind: "memo", text: "우유" }, now, "ko"), "메모 서랍에 넣었어요");
  assert.equal(addedText({ kind: "memo", text: "milk" }, now, "en"), "Added to the notes drawer");
});

// ─── The shared words (memo-drawer-cases.md "Words", verbatim) ──────────────

test("words: slip times (Asia/Seoul), sheets, footers, code lines, a deleted folder brought back", async () => {
  const { restoreFolder, sheetCount } = await import("../src/core/memoDrawer");
  if (new Date("2026-10-27T05:00:00Z").getTimezoneOffset() === -540) {
    assert.equal(slipTime("2026-10-27T01:12:00Z", now), "10:12");
    assert.equal(slipTime("2026-10-27T01:12:00Z", now, "en"), "10:12 AM");
    assert.deepEqual(["ko", "nl", "en"].map((lang) => slipTime("2026-10-26T01:12:00Z", now, lang as "ko")), ["어제", "Gisteren", "Yesterday"]);
    assert.equal(slipTime("2026-10-21T01:12:00Z", now), "10월 21일");
    assert.equal(slipTime("2026-10-21T01:12:00Z", now, "en"), "Oct 21");
    assert.equal(slipTime("2025-10-21T01:12:00Z", now, "nl"), "21 okt 2025");
  }
  assert.deepEqual([1, 5, 10, 11].map((count) => sheetCount(count)), ["한 장", "다섯 장", "열 장", "11장"]);
  assert.equal(drawerFooter("folder", 5, "회사"), "회사에 다섯 장");
  assert.equal(drawerFooter("folder", 0, "회사"), "회사는 비어 있어요");
  assert.equal(drawerFooter("folder", 0, "집"), "집은 비어 있어요");
  assert.equal(drawerFooter("folder", 1, "Work", "en"), "1 note in Work");
  assert.equal(drawerFooter("folder", 0, "Werk", "nl"), "Werk is leeg");
  assert.equal(drawerFooter("pinned", 3), "고정한 메모 세 장");
  assert.equal(drawerFooter("pinned", 1, "", "nl"), "1 vastgezette notitie");
  assert.deepEqual(["ko", "en", "nl"].map((lang) => drawerFooter("pinned", 0, "", lang as "ko")), ["고정한 메모가 없어요", "No pinned notes", "Geen vastgezette notities"]);
  assert.equal(drawerFooter("search", 2, "", "en"), "2 notes in all folders");
  assert.deepEqual(["ko", "en", "nl"].map((lang) => drawerFooter("search", 0, "", lang as "ko")), ["찾은 메모가 없어요", "No notes found", "Geen notities gevonden"]);
  for (const line of ["git log --oneline -5", "$ swift build", "    let x = 1", "./scripts/qa.sh all"]) assert.ok(isCodeLine(line), line);
  for (const line of ["git", "Buy milk tomorrow"]) assert.ok(!isCodeLine(line), line);
  const back = restoreFolder(deleteFolder(sample(), "work", now), "work", ["m1", "m3"], now);
  assert.deepEqual(ids(visibleFolders(back)), [inboxID, "work", "home"]);
  assert.deepEqual(ids(memosIn(back, memos, "work")), ["m1", "m3"]);
  assert.equal(placementOf(back, "m1").pinned, true);
});
