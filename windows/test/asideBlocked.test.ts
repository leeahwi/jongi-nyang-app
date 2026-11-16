import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, mock, test } from "node:test";
import { addFolder, memoFoldersFileName } from "../src/core/memoDrawer";
import { memoTrashFileName, trashMemo } from "../src/core/memoTrash";
import { addSpace, todoSpacesFileName } from "../src/core/todoSpaces";
import { Store } from "../src/main/store";
import { temporaryFolder } from "./temporaryFolder";

// #416 (the rest of #382 · #415): 스페이스 · 메모 폴더 · 지운 메모 files that don't parse are moved aside; when the move
// fails too (a folder that can't be written), the original is never written over — as the other files when their copy
// fails — until 다시 읽기 moves it.

afterEach(() => mock.restoreAll());

const at = "2026-10-01T09:00:00Z";
const files = [todoSpacesFileName, memoFoldersFileName, memoTrashFileName] as const;
type Name = typeof files[number];

let made = 0;
/** A change that saves each file at once. */
const change: Record<Name, (store: Store) => void> = {
  [todoSpacesFileName]: (store) => store.changeSpaces((data) => addSpace(data, `공부 ${++made}`, `00000000-0000-4000-8000-0000000005${String(made).padStart(2, "0")}`)),
  [memoFoldersFileName]: (store) => store.changeFolders((data) => addFolder(data, `회사 ${++made}`, "blue", `00000000-0000-4000-8000-0000000006${String(made).padStart(2, "0")}`)),
  [memoTrashFileName]: (store) => store.changeTrash((trash) => trashMemo(trash, { id: `00000000-0000-4000-8000-0000000007${String(++made).padStart(2, "0")}`, text: "장보기", createdAt: at, updatedAt: at }, { folder: "inbox", pinned: false })),
} as Record<Name, (store: Store) => void>;

/** Moving `file` aside fails (no right to write in the folder) until the mock is restored. */
function cantMove(file: string) {
  const rename = fs.renameSync;
  mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
    if (String(from) === file) throw Object.assign(new Error("EPERM: rename"), { code: "EPERM" });
    return rename(from, to);
  });
}

const asideOf = (folder: string) => fs.readdirSync(folder).filter((entry) => entry.includes(".unreadable-"));

for (const name of files) {
  test(`${name} doesn't parse and can't be moved aside at launch: not written over; 다시 읽기 moves it, then saving opens`, () => {
    const folder = temporaryFolder("paper-todo-aside-");
    const file = path.join(folder, name);
    fs.writeFileSync(file, "{ not json");
    cantMove(file);
    const store = new Store(folder);
    try {
      assert.match(store.storageError ?? "", new RegExp(`${name.replace(".", "\\.")} 파일을 읽지 못했어요\\. 원래 파일은 덮어쓰지 않고 그대로 둬요\\.`));
      assert.equal(store.unreadFiles, 1);
      change[name](store);
      store.flush();
      assert.equal(fs.readFileSync(file, "utf8"), "{ not json", "the file is as it was");
      // 다시 읽기 while the folder still can't be written: still not written.
      store.reread();
      change[name](store);
      store.flush();
      assert.equal(fs.readFileSync(file, "utf8"), "{ not json");
      assert.deepEqual(asideOf(folder), []);
      mock.restoreAll(); // the folder can be written again
      store.reread();
      assert.equal(store.unreadFiles, 0);
      const aside = asideOf(folder);
      assert.equal(aside.length, 1);
      assert.equal(fs.readFileSync(path.join(folder, aside[0]), "utf8"), "{ not json", "moved aside as it was");
      change[name](store);
      store.flush();
      assert.ok(fs.existsSync(file), "saved again once the original is kept");
      assert.notEqual(fs.readFileSync(file, "utf8"), "{ not json");
    } finally {
      store.unwatch();
    }
  });

  test(`${name}: another device's copy that stays unreadable and can't be moved aside isn't written over`, () => {
    const folder = temporaryFolder("paper-todo-aside-");
    const file = path.join(folder, name);
    const store = new Store(folder);
    try {
      change[name](store);
      store.flush();
      assert.ok(fs.existsSync(file));
      fs.writeFileSync(file, "{ half synced");
      cantMove(file);
      // Read again on the next checks, kept aside on the third (W21).
      for (let check = 0; check < 3; check++) store.catchUp([name], true);
      assert.equal(store.unreadFiles, 1);
      assert.match(store.storageError ?? "", /원래 파일은 덮어쓰지 않고 그대로 둬요\./);
      change[name](store);
      store.flush();
      assert.equal(fs.readFileSync(file, "utf8"), "{ half synced", "the file is as it was");
      mock.restoreAll();
      store.reread();
      assert.equal(store.unreadFiles, 0);
      assert.equal(asideOf(folder).length, 1);
      change[name](store);
      store.flush();
      assert.notEqual(fs.readFileSync(file, "utf8"), "{ half synced", "this device's written in its place");
    } finally {
      store.unwatch();
    }
  });
}

test("the three files moved aside as before when the move works: said once, nothing blocked", () => {
  for (const name of files) {
    const folder = temporaryFolder("paper-todo-aside-");
    fs.writeFileSync(path.join(folder, name), "{ not json");
    const store = new Store(folder);
    try {
      assert.equal(store.unreadFiles, 0, name);
      assert.match(store.storageError ?? "", /원래 파일은 저장 폴더에 ‘.+\.unreadable-.+’ 이름으로 남겨 뒀어요\./, name);
      assert.equal(asideOf(folder).length, 1, name);
    } finally {
      store.unwatch();
    }
  }
});

test("#485 memo-trash.json from another device moved aside later: said as this device's 지운 메모 staying, and written in its place", () => {
  const folder = temporaryFolder("paper-todo-aside-");
  const file = path.join(folder, memoTrashFileName);
  const store = new Store(folder);
  try {
    change[memoTrashFileName](store);
    store.flush();
    fs.writeFileSync(file, "{ half synced");
    for (let check = 0; check < 3; check++) store.catchUp([memoTrashFileName], true);
    assert.equal(store.unreadFiles, 0);
    assert.match(store.storageError ?? "", /^지운 메모 파일을 읽지 못했어요\. 여기 있던 지운 메모는 그대로예요\./);
    assert.equal(asideOf(folder).length, 1);
    assert.notEqual(fs.readFileSync(file, "utf8"), "{ half synced", "this device's 지운 메모 written in its place");
  } finally {
    store.unwatch();
  }
});
