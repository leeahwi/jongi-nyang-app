import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { usableFolder } from "../src/main/storageFolder";
import { temporaryFolder } from "./temporaryFolder";

// #380: a chosen shared folder that isn't there at launch (Dropbox or OneDrive not running yet, a disk unplugged) is not
// usable and is not made — main.ts then waits on 저장 폴더를 찾지 못했어요 and writes nothing until it is there.
test("#380 a missing storage folder isn't usable and isn't made; one that comes back is", () => {
  const parent = temporaryFolder("paper-missing-");
  const folder = path.join(parent, "Dropbox", "종이냥");
  assert.equal(usableFolder(folder), false);
  assert.equal(fs.existsSync(folder), false, "no empty folder is left where the shared one belongs");
  assert.equal(fs.existsSync(path.dirname(folder)), false);
  fs.mkdirSync(folder, { recursive: true });
  assert.equal(usableFolder(folder), true);
  // A file where the folder should be isn't one either.
  const file = path.join(parent, "file");
  fs.writeFileSync(file, "");
  assert.equal(usableFolder(file), false);
});
