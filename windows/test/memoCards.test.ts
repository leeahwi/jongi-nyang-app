import assert from "node:assert/strict";
import { test } from "node:test";
import type { Memo } from "../src/core/memo";
import {
  bookmarkTip, cardTime, cardTitle, dateGroup, dayTime, editedLabel, findLink, findPhone, folderDeletedWords, footerWords, groupLabel, groupMemos, memoKind,
  previewLine, previewRows, tapePlace,
} from "../src/core/memoCards";
import {
  deleteFolder, duplicateFolder, hasCheckedLines, inboxID, memosIn, mergeMemoFolders, moveMemo, paperOf, parseMemoFolders, pinAll, placementOf,
  removeCheckedLines, serializeMemoFolders, setFolderSort, setMemoPaper, sortOf, unpinAll, visibleFolders, type MemoFolders,
} from "../src/core/memoDrawer";

// 메모 서랍 1.29: the shared cases D17–D29, verbatim from the shared memo drawer cases (the Mac's MemoDrawerTests "D17…D29").
// Times are read on the Seoul calendar, as the cases are written.
process.env.TZ = "Asia/Seoul";

const now = new Date("2026-10-27T05:00:00Z");
const NOW = "2026-10-27T05:00:00Z";
const memo = (id: string, text: string, updatedAt = "2026-10-27T04:00:00Z", createdAt = updatedAt): Memo => ({ id, text, createdAt, updatedAt });
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
const line = (text: string, start: string) => text.split("\n").find((entry) => entry.trimStart().startsWith(start));

test("D17: sort and paper on their lines — written only when set, kept by moves and tombstones", () => {
  let data = setFolderSort(sample(), "work", "created", now);
  data = setMemoPaper(data, "m3", "night", now);
  let text = serializeMemoFolders(data);
  assert.equal(line(text, '{ "id": "work"'), `    { "id": "work", "name": "회사", "color": "pink", "order": 1, "updatedAt": "${NOW}", "sort": "created" },`);
  assert.equal(line(text, '"m3"'), `    "m3": { "folder": "work", "pinned": false, "at": "${NOW}", "paper": "night" }`);
  const back = setMemoPaper(setFolderSort(data, "work", "edited", now), "m3", undefined, now);
  text = serializeMemoFolders(back);
  assert.ok(!text.includes('"sort"') && !text.includes('"paper"'));
  const tomb = deleteFolder(setFolderSort(sample(), "work", "title", now), "work", now);
  assert.ok(serializeMemoFolders(tomb).includes(`"updatedAt": "${NOW}", "sort": "title", "deleted": true }`));
  const moved = moveMemo(data, "m3", "home", now);
  assert.equal(moved.placement.m3.paper, "night");
  assert.equal(moved.placement.m3.folder, "home");
  const m2Paper = setMemoPaper(sample(), "m2", "kraft", now);
  assert.equal(line(serializeMemoFolders(m2Paper), '"m2"'), `    "m2": { "folder": "inbox", "pinned": false, "at": "${NOW}", "paper": "kraft" },`);
  assert.equal(paperOf(m2Paper, "m2"), "kraft");
});

test("D18: unknown keys and values survive a read and a write, sorted and on one line", () => {
  const input = `{"v":1,"folders":[{"id":"inbox","name":"메모","color":"lavender","order":0,"updatedAt":"1970-01-01T00:00:00Z","emoji":"🐱","sort":"newest"}],"placement":{"m1":{"folder":"inbox","pinned":false,"at":"2026-10-26T09:00:00Z","tag":7,"paper":"sepia"}},"updatedAt":"2026-10-26T09:00:00Z","extra":{"b":null,"a":[1,2.5,"x",1.0,{}]},"alpha":true}`;
  const data = parseMemoFolders(input);
  assert.equal(sortOf(data.folders[0]), "edited");
  assert.equal(paperOf(data, "m1"), undefined);
  assert.equal(serializeMemoFolders(data), `{\n  "v": 1,\n  "folders": [\n    { "id": "inbox", "name": "메모", "color": "lavender", "order": 0, "updatedAt": "1970-01-01T00:00:00Z", "sort": "newest", "emoji": "🐱" }\n  ],\n  "placement": {\n    "m1": { "folder": "inbox", "pinned": false, "at": "2026-10-26T09:00:00Z", "paper": "sepia", "tag": 7 }\n  },\n  "updatedAt": "2026-10-26T09:00:00Z",\n  "alpha": true,\n  "extra": { "a": [1, 2.5, "x", 1, {}], "b": null }\n}\n`);
  assert.equal(serializeMemoFolders(sample()), SAMPLE);
});

test("D19: a paper merges like a pin — the newer placement wins whole", () => {
  const here = setMemoPaper(sample(), "m1", "night", new Date("2026-10-27T05:00:00Z"));
  const theirs = moveMemo(sample(), "m1", "home", new Date("2026-10-27T05:01:00Z"));
  for (const merged of [mergeMemoFolders(here, theirs), mergeMemoFolders(theirs, here)]) {
    assert.deepEqual({ ...merged.placement.m1 }, { folder: "home", pinned: true, at: "2026-10-27T05:01:00Z" });
  }
  const tie = moveMemo(sample(), "m1", "home", new Date("2026-10-27T05:00:00Z"));
  const kept = mergeMemoFolders(here, tie).placement.m1;
  assert.equal(kept.folder, "work");
  assert.equal(kept.paper, "night");
  const tagged = parseMemoFolders(SAMPLE.replace('"m1": { "folder": "work", "pinned": true, "at": "2026-10-26T09:00:00Z" }', '"m1": { "folder": "work", "pinned": true, "at": "2026-10-27T05:02:00Z", "paper": "grid", "tag": 1 }'));
  const withTag = mergeMemoFolders(here, tagged).placement.m1;
  assert.equal(withTag.paper, "grid");
  assert.deepEqual(withTag.extra, { tag: 1 });
  assert.ok(serializeMemoFolders(mergeMemoFolders(here, tagged)).includes('"paper": "grid", "tag": 1 }'));
});

test("D20: a sort merges with its folder — the newer folder wins whole", () => {
  const here = setFolderSort(sample(), "work", "title", new Date("2026-10-27T05:00:00Z"));
  const theirs = parseMemoFolders(SAMPLE.replace('{ "id": "work", "name": "회사", "color": "pink", "order": 1, "updatedAt": "2026-10-26T09:00:00Z" }', '{ "id": "work", "name": "일", "color": "pink", "order": 1, "updatedAt": "2026-10-27T05:01:00Z" }'));
  const work = (data: MemoFolders) => data.folders.find((folder) => folder.id === "work")!;
  assert.equal(work(mergeMemoFolders(here, theirs)).name, "일");
  assert.equal(sortOf(work(mergeMemoFolders(here, theirs))), "edited");
  assert.equal(work(mergeMemoFolders(here, theirs)).sort, undefined);
  const hereLater = setFolderSort(sample(), "work", "title", new Date("2026-10-27T05:01:00Z"));
  const theirsEarlier = parseMemoFolders(SAMPLE.replace('"name": "회사", "color": "pink", "order": 1, "updatedAt": "2026-10-26T09:00:00Z"', '"name": "일", "color": "pink", "order": 1, "updatedAt": "2026-10-27T05:00:00Z"'));
  assert.equal(work(mergeMemoFolders(hereLater, theirsEarlier)).name, "회사");
  assert.equal(sortOf(work(mergeMemoFolders(hereLater, theirsEarlier))), "title");
});

test("D21: 복제 — a new folder right after it, copies pinned and papered as their originals, `사본 2` the second time", () => {
  const start = setMemoPaper(setFolderSort(sample(), "work", "created", new Date("2026-10-26T10:00:00Z")), "m3", "night", new Date("2026-10-26T10:00:00Z"));
  const once = duplicateFolder(sample(), "work", "w2", [["m1", "c1"], ["m3", "c3"]], "ko", now);
  assert.deepEqual(ids(visibleFolders(once)), [inboxID, "work", "w2", "home"]);
  const text = serializeMemoFolders(once);
  assert.equal(line(text, '{ "id": "w2"'), `    { "id": "w2", "name": "회사 사본", "color": "pink", "order": 2, "updatedAt": "${NOW}" },`);
  const home = once.folders.find((folder) => folder.id === "home")!;
  assert.deepEqual([home.order, home.updatedAt], [3, NOW]);
  assert.equal(once.folders.find((folder) => folder.id === "work")!.updatedAt, "2026-10-26T09:00:00Z");
  assert.equal(once.folders.find((folder) => folder.id === inboxID)!.updatedAt, "1970-01-01T00:00:00Z");
  assert.deepEqual({ ...once.placement.c1 }, { folder: "w2", pinned: true, at: NOW });
  assert.deepEqual({ ...once.placement.c3 }, { folder: "w2", pinned: false, at: NOW });
  const carried = duplicateFolder(start, "work", "w2", [["m3", "c3"]], "ko", now);
  assert.equal(carried.placement.c3.paper, "night");
  assert.equal(sortOf(carried.folders.find((folder) => folder.id === "w2")), "created");
  const twice = duplicateFolder(once, "work", "w3", [], "ko", now);
  const order = (data: MemoFolders, id: string) => data.folders.find((folder) => folder.id === id)!.order;
  assert.equal(twice.folders.find((folder) => folder.id === "w3")!.name, "회사 사본 2");
  assert.deepEqual([order(twice, "w3"), order(twice, "w2"), order(twice, "home")], [2, 3, 4]);
  const en = parseMemoFolders(SAMPLE.replace('"회사"', '"Work"'));
  const enOnce = duplicateFolder(en, "work", "w2", [], "en", now);
  assert.equal(enOnce.folders.find((folder) => folder.id === "w2")!.name, "Work copy");
  assert.equal(duplicateFolder(enOnce, "work", "w3", [], "en", now).folders.find((folder) => folder.id === "w3")!.name, "Work copy 2");
  const nl = parseMemoFolders(SAMPLE.replace('"회사"', '"Werk"'));
  assert.equal(duplicateFolder(nl, "work", "w2", [], "nl", now).folders.find((folder) => folder.id === "w2")!.name, "Werk kopie");
  assert.equal(duplicateFolder(sample(), inboxID, "i2", [], "ko", now).folders.find((folder) => folder.id === "i2")!.name, "메모 사본");
  assert.equal(duplicateFolder(sample(), inboxID, "i2", [], "en", now).folders.find((folder) => folder.id === "i2")!.name, "Notes copy");
  const long = parseMemoFolders(SAMPLE.replace('"회사"', `"${"가".repeat(39)}"`));
  assert.equal([...duplicateFolder(long, "work", "w2", [], "ko", now).folders.find((folder) => folder.id === "w2")!.name].length, 40);
});

// ─── Groups and short times ───────────────────────────────────────────────────

const nowG = new Date("2026-10-29T05:00:00Z");
const D22: [string, string, [string, string, string], [string, string, string]][] = [
  ["D22a", "2026-10-30T00:00:00Z", ["오늘", "Today", "Vandaag"], ["오전 9:00", "9:00 AM", "09:00"]],
  ["D22b", "2026-10-28T15:00:00Z", ["오늘", "Today", "Vandaag"], ["오전 12:00", "12:00 AM", "00:00"]],
  ["D22c", "2026-10-28T14:59:59Z", ["어제", "Yesterday", "Gisteren"], ["오후 11:59", "11:59 PM", "23:59"]],
  ["D22d", "2026-10-27T00:00:00Z", ["이번 주", "This week", "Deze week"], ["화요일", "Tuesday", "dinsdag"]],
  ["D22e", "2026-10-25T15:00:00Z", ["이번 주", "This week", "Deze week"], ["월요일", "Monday", "maandag"]],
  ["D22f", "2026-10-25T14:59:59Z", ["지난주", "Last week", "Vorige week"], ["일요일", "Sunday", "zondag"]],
  ["D22g", "2026-10-18T15:00:00Z", ["지난주", "Last week", "Vorige week"], ["월요일", "Monday", "maandag"]],
  ["D22h", "2026-10-18T14:59:59Z", ["10월", "October", "oktober"], ["18일", "Oct 18", "18 okt"]],
  ["D22i", "2026-09-30T15:00:00Z", ["10월", "October", "oktober"], ["1일", "Oct 1", "1 okt"]],
  ["D22j", "2026-09-30T14:59:59Z", ["9월", "September", "september"], ["30일", "Sep 30", "30 sep"]],
  ["D22k", "2025-12-31T15:00:00Z", ["1월", "January", "januari"], ["1일", "Jan 1", "1 jan"]],
  ["D22l", "2025-12-31T14:59:59Z", ["2025년 12월", "December 2025", "december 2025"], ["12월 31일", "Dec 31", "31 dec"]],
];

test("D22: date groups and short times (Seoul; weeks from Monday)", () => {
  for (const [name, time, labels, times] of D22) {
    const at = new Date(time);
    const { kind } = dateGroup(at, nowG);
    assert.deepEqual((["ko", "en", "nl"] as const).map((lang) => groupLabel(kind, at, lang)), labels, `${name} group`);
    assert.deepEqual((["ko", "en", "nl"] as const).map((lang) => cardTime(at, kind, nowG, lang)), times, `${name} time`);
  }
  const monday = new Date("2026-10-26T05:00:00Z");
  assert.equal(dateGroup(new Date("2026-10-25T01:00:00Z"), monday).kind, "yesterday");
  const saturday = new Date("2026-10-24T01:00:00Z");
  assert.equal(dateGroup(saturday, monday).kind, "lastWeek");
  assert.equal(cardTime(saturday, "lastWeek", monday), "토요일");
  // Without a date header the time says the day.
  assert.deepEqual((["ko", "en", "nl"] as const).map((lang) => dayTime(new Date("2026-10-29T09:02:00Z"), nowG, lang)), ["오후 6:02", "6:02 PM", "18:02"]);
  assert.deepEqual((["ko", "en", "nl"] as const).map((lang) => dayTime(new Date("2026-10-28T01:00:00Z"), nowG, lang)), ["어제", "Yesterday", "Gisteren"]);
  assert.deepEqual((["ko", "en", "nl"] as const).map((lang) => dayTime(new Date("2026-10-13T01:00:00Z"), nowG, lang)), ["10월 13일", "Oct 13", "13 okt"]);
  assert.deepEqual((["ko", "en", "nl"] as const).map((lang) => dayTime(new Date("2025-10-13T01:00:00Z"), nowG, lang)), ["2025년 10월 13일", "Oct 13, 2025", "13 okt 2025"]);
  // The open memo's bar, always by updatedAt.
  const bar = (time: string) => (["ko", "en", "nl"] as const).map((lang) => editedLabel(time, nowG, lang));
  assert.deepEqual(bar("2026-10-29T08:38:00Z"), ["오후 5:38 고침", "Edited 5:38 PM", "Bewerkt 17:38"]);
  assert.deepEqual(bar("2026-10-28T01:00:00Z"), ["어제 고침", "Edited yesterday", "Gisteren bewerkt"]);
  assert.deepEqual(bar("2026-10-27T01:00:00Z"), ["화요일 고침", "Edited Tuesday", "Dinsdag bewerkt"]);
  assert.deepEqual(bar("2026-10-13T01:00:00Z"), ["10월 13일 고침", "Edited Oct 13", "Bewerkt 13 okt"]);
  assert.deepEqual(bar("2025-10-13T01:00:00Z"), ["2025년 10월 13일 고침", "Edited Oct 13, 2025", "Bewerkt 13 okt 2025"]);
});

test("D23: groups in order, newest first; the 고정 bookmark has no 고정 group; 만든 순 by createdAt", () => {
  const time = (name: string) => D22.find((row) => row[0] === name)![1];
  const list = [
    memo("e", "e", time("D22h")), memo("b", "b", time("D22b")), memo("f", "f", time("D22l")), memo("a", "a", time("D22d")),
    memo("d", "d", time("D22f")), memo("c", "c", time("D22c")), memo("b2", "b2", "2026-10-29T01:00:00Z"),
  ];
  const groups = groupMemos(list, { pinned: (id) => id === "a", pinnedView: false, sort: "edited", now: nowG });
  assert.deepEqual(groups.map((group) => [group.label, ids(group.memos)]), [
    ["고정", ["a"]], ["오늘", ["b2", "b"]], ["어제", ["c"]], ["지난주", ["d"]], ["10월", ["e"]], ["2025년 12월", ["f"]],
  ]);
  const pinnedView = groupMemos(list, { pinned: (id) => id === "a", pinnedView: true, sort: "edited", now: nowG });
  assert.deepEqual(pinnedView.map((group) => group.label), ["오늘", "어제", "이번 주", "지난주", "10월", "2025년 12월"]);
  const created = list.map((entry) => ({ ...entry, createdAt: entry.updatedAt, updatedAt: "2026-10-29T04:00:00Z" }));
  assert.deepEqual(groupMemos(created, { pinned: () => false, pinnedView: false, sort: "created", now: nowG }).map((group) => group.label), ["오늘", "어제", "이번 주", "지난주", "10월", "2025년 12월"]);
});

test("D24: 제목 순 — one group after 고정 (its header only then), numbers by value, Latin before Hangul, ties newest first", () => {
  const list = ["b", "가방", "10번", "2번", "A"].map((title, index) => memo(`t${index}`, title, `2026-10-2${index}T01:00:00Z`));
  const tie = memo("t9", "A", "2026-10-28T01:00:00Z");
  const zz = memo("zz", "zz");
  const groups = groupMemos([...list, tie, zz], { pinned: (id) => id === "zz", pinnedView: false, sort: "title", now: nowG });
  assert.deepEqual(groups.map((group) => [group.label, group.header, group.memos.map((entry) => entry.text)]), [
    ["고정", true, ["zz"]], ["메모", true, ["2번", "10번", "A", "A", "b", "가방"]],
  ]);
  assert.equal(groups[1].memos[2].id, "t9");
  const alone = groupMemos(list, { pinned: () => false, pinnedView: false, sort: "title", now: nowG, lang: "en" });
  assert.deepEqual(alone.map((group) => [group.label, group.header]), [["Notes", false]]);
});

// ─── Kinds ────────────────────────────────────────────────────────────────────

test("D25: checklist beats link beats phone; a link's chip and a URL title", () => {
  assert.deepEqual(memoKind("배포\n- [ ] a\n- [x] b\nhttps://x.com"), { kind: "checklist", done: 1, total: 2 });
  assert.equal(cardTitle(memo("x", "배포\n- [ ] a\n- [x] b\nhttps://x.com")), "배포");
  const youtube = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  assert.deepEqual(memoKind(youtube), { kind: "link", url: youtube, label: "youtube.com/watch", host: "youtube.com" });
  assert.deepEqual((["ko", "en", "nl"] as const).map((lang) => cardTitle(memo("y", youtube), lang)), ["youtube.com 링크", "youtube.com link", "youtube.com-link"]);
  assert.equal(previewLine(memo("y", youtube)), undefined);
  const watch = memo("w", "영상 볼 것\nhttps://youtu.be/abc.");
  assert.deepEqual(findLink(watch.text), { url: "https://youtu.be/abc", label: "youtu.be/abc", host: "youtu.be" });
  assert.equal(cardTitle(watch), "영상 볼 것");
  assert.equal(previewLine(watch), "https://youtu.be/abc.");
  assert.deepEqual(findLink("(see http://Example.com/a/b/?q=1)"), { url: "http://Example.com/a/b/?q=1", label: "example.com/a/b", host: "example.com" });
  assert.equal(memoKind("https://"), undefined);
  assert.equal(memoKind("see https://?x"), undefined);
  assert.equal(memoKind("https://www.youtube.com/watch?v=1 영상")?.kind, "link");
  assert.equal(cardTitle(memo("s", "https://www.youtube.com/watch?v=1 영상")), "https://www.youtube.com/watch?v=1 영상");
  const both = "https://x.com\n010-1234-5678";
  assert.deepEqual(memoKind(both), { kind: "link", url: "https://x.com", label: "x.com", host: "x.com" });
  assert.equal(cardTitle(memo("g", both)), "x.com 링크");
});

test("D26: Korean phone numbers, written with or without separators", () => {
  assert.deepEqual(memoKind("꽃집 전화 010 1234 5678"), { kind: "phone", number: "010-1234-5678" });
  assert.deepEqual(["02-123-4567", "전화 02 1234 5678", "010.1234.5678", "연락: 01012345678", "031-123-4567"].map(findPhone),
    ["02-123-4567", "02-1234-5678", "010-1234-5678", "010-1234-5678", "031-123-4567"]);
  for (const text of ["123-4567", "010-123-456", "2026.10.27", "0101234567890", "1010-1234-5678"]) assert.equal(findPhone(text), undefined, text);
});

test("D27–D29: 체크한 줄 지우기, 고정 모두 풀기, a deleted folder's words", () => {
  assert.equal(removeCheckedLines(LIST), "장보기\n- [ ] 우유\n- [ ] 빵\n-[ ] 아님\n- [ ]아님");
  assert.equal(removeCheckedLines("a\r\n- [x] b\r\nc"), "a\r\nc");
  assert.equal(removeCheckedLines("- [ ] a\nb"), "- [ ] a\nb");
  assert.equal(hasCheckedLines("- [ ] a\nb"), false);
  assert.equal(hasCheckedLines(LIST), true);
  const { data, ids: unpinned } = unpinAll(sample(), now);
  assert.deepEqual(unpinned, ["m1"]);
  assert.deepEqual({ ...data.placement.m1 }, { folder: "work", pinned: false, at: NOW });
  assert.deepEqual(data.placement.m3, sample().placement.m3);
  assert.equal(placementOf(pinAll(data, unpinned, now), "m1").pinned, true);
  assert.deepEqual((["ko", "en", "nl"] as const).map((lang) => folderDeletedWords({ ko: "회사", en: "Work", nl: "Werk" }[lang], 2, { ko: "메모", en: "Notes", nl: "Notities" }[lang], lang)),
    ["메모 두 장은 ‘메모’ 폴더로 옮겼어요", "2 notes moved to ‘Notes’", "2 notities verplaatst naar ‘Notities’"]);
  assert.equal(folderDeletedWords("Work", 1, "Notes", "en"), "1 note moved to ‘Notes’");
  assert.equal(folderDeletedWords("Werk", 1, "Notities", "nl"), "1 notitie verplaatst naar ‘Notities’");
  assert.deepEqual((["ko", "en", "nl"] as const).map((lang) => folderDeletedWords({ ko: "회사", en: "Work", nl: "Werk" }[lang], 0, "", lang)),
    ["‘회사’ 폴더를 지웠어요", "Deleted the folder ‘Work’", "Map ‘Werk’ verwijderd"]);
  assert.deepEqual(ids(memosIn(sample(), memos, "work")), ["m1", "m3"]);
});

test("cards: the footer, a bookmark's label, the tape's place", () => {
  assert.equal(footerWords("회사", 5), "회사 · 다섯 장");
  assert.equal(footerWords("Work", 1, "en"), "Work · 1 note");
  assert.equal(footerWords("Werk", 5, "nl"), "Werk · 5 notities");
  assert.equal(bookmarkTip("장보기", 3, "Ctrl+3"), "장보기 · 세 장 · Ctrl+3");
  assert.equal(bookmarkTip("Study", 0, undefined, "en"), "Study · empty");
  for (const id of ["m1", "DRAWER-MEETING", "8F0C2C4A-0000-4000-8000-000000000000", ""]) {
    const place = tapePlace(id);
    assert.ok(place.left >= 20 && place.left <= 65 && place.turn >= -2 && place.turn <= 2, id);
    assert.deepEqual(tapePlace(id), place);
  }
  assert.notDeepEqual(tapePlace("m1"), tapePlace("m2"));
});

test("D30 a card's preview (#14): three lines at most, a checklist's first items, no empty lines", () => {
  assert.deepEqual(previewRows("주간 회의\n\n첫째 줄\n   \n둘째 줄\n셋째 줄\n넷째 줄"), [{ text: "첫째 줄" }, { text: "둘째 줄" }, { text: "셋째 줄" }]);
  assert.deepEqual(previewRows("짧은 메모\n한 줄뿐"), [{ text: "한 줄뿐" }]);
  assert.deepEqual(previewRows("제목만"), []);
  assert.deepEqual(previewRows("  \n\n"), []);
  assert.deepEqual(previewRows("장보기\n메모 먼저\n- [ ] 우유\n- [x] 빵\n  * [X] 계란\n- [ ] 사과"),
    [{ checked: false, text: "우유" }, { checked: true, text: "빵" }, { checked: true, text: "계란" }]);
  assert.deepEqual(previewRows("- [ ] 첫 항목이 제목\n- [ ] 둘째\n- [ ]   \n- [x] 셋째"), [{ checked: false, text: "둘째" }, { checked: true, text: "셋째" }]);
  assert.deepEqual(previewRows("목록\n- [ ] 하나\n- [ ] 둘\n- [ ] 셋", 2), [{ checked: false, text: "하나" }, { checked: false, text: "둘" }]);
  assert.deepEqual(previewRows("a\r\n  b  \r\nc"), [{ text: "b" }, { text: "c" }]);
  assert.deepEqual(previewRows("https://x.com\n010-1234-5678"), [{ text: "010-1234-5678" }]);
  assert.equal(previewRows(`제목\n${"가".repeat(500)}`)[0].text.length, 300);
});
