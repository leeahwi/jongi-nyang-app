#!/usr/bin/env node
// #225: the release check for build-folder paths, shared by both apps. Opens what a release ships (folders and .app
// bundles as they are, .zip and .mcpb, .dmg through a read-only mount, NSIS .exe and the .7z inside through 7-Zip,
// archives inside those) and searches every file's bytes, ASCII and UTF-16LE, for a path of the machine that built it:
// /Users/, the home folder, /private/tmp, /private/var/folders, /var/folders and ../../../ (a bundler's module path
// that climbed out of the project, #225 · 1.42.1). app.asar is searched as it is (it isn't compressed).
// It prints only counts and file names (the home folder as <home>), never what it found, and exits 1 on any hit,
// 2 when it can't open something (so a file it couldn't read never passes).
//   node tools/check-release-paths.mjs <file or folder>…
// mac/scripts/build.sh · make-dmg.sh, windows/tools/check-release.mjs (npm run dist) and windows/mcp/build.mjs run it;
// windows/test/releasePaths.test.ts plants paths in fictional temporary folders.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const fixedPatterns = ["/Users/", "/private/tmp", "/private/var/folders", "/var/folders", "../../../"];
const homes = [...new Set([os.homedir(), process.env.HOME, process.env.USERPROFILE].filter((home) => home && home.length > 3))];

// Each pattern in both encodings. The home folder is shown as <home>, never spelled out.
const needles = [
  ...fixedPatterns.map((text) => ({ label: text, text })),
  ...homes.map((text) => ({ label: "<home>", text })),
].flatMap(({ label, text }) => [
  { label: `${label} (ASCII)`, bytes: Buffer.from(text, "utf8") },
  { label: `${label} (UTF-16LE)`, bytes: Buffer.from(text, "utf16le") },
]);

// The only bytes allowed to look like a build path, each checked by hand: in this file, at most this many times. Any
// more, or anywhere else, is a hit. Match the whole text so a real path next to it is still found.
const allowed = [
  // Electron's own Windows executable (the app's exe is Electron's, renamed) holds Node's ES module resolver, which looks
  // for a package three folders up: `${isScoped ? '../' : ''}../../../node_modules/${packageName}/package.json`
  // (lib/internal/modules/esm/resolve.js), once as source and once in its code cache. The same in every build.
  { file: /(^|\/)종이냥\.exe$/, text: "../../../node_modules/", most: 2 },
];

const mask = (text) => {
  let masked = text;
  for (const home of homes) masked = masked.split(home).join("<home>");
  return masked.replace(/\/Users\/[^/]+/g, "/Users/<name>");
};

const count = (buffer, needle) => {
  let total = 0;
  for (let at = buffer.indexOf(needle); at !== -1; at = buffer.indexOf(needle, at + 1)) total += 1;
  return total;
};

// --- zip and .mcpb, read here so nested ones need no temporary files -----------------------------------------------

const isZip = (name, buffer) => /\.(zip|mcpb)$/i.test(name) || (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50);

function* zipEntries(buffer) {
  let end = -1;
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 22 - 0xffff); at -= 1) {
    if (buffer.readUInt32LE(at) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new Error("not a zip (no end record)");
  let entries = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  if (entries === 0xffff || offset === 0xffffffff) {
    const locator = end - 20;
    if (locator < 0 || buffer.readUInt32LE(locator) !== 0x07064b50) throw new Error("zip64 without its locator");
    const end64 = Number(buffer.readBigUInt64LE(locator + 8));
    if (buffer.readUInt32LE(end64) !== 0x06064b50) throw new Error("zip64 end record missing");
    entries = Number(buffer.readBigUInt64LE(end64 + 32));
    offset = Number(buffer.readBigUInt64LE(end64 + 48));
  }
  for (let index = 0, at = offset; index < entries; index += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error("broken central directory");
    const flags = buffer.readUInt16LE(at + 8);
    const method = buffer.readUInt16LE(at + 10);
    let size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    let local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    if (size === 0xffffffff || local === 0xffffffff) {
      // zip64 extra field: the 8-byte values come in this order, only for the fields that overflowed.
      const extra = buffer.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
      for (let field = 0; field + 4 <= extra.length; field += 4 + extra.readUInt16LE(field + 2)) {
        if (extra.readUInt16LE(field) !== 0x0001) continue;
        let value = field + 4;
        if (buffer.readUInt32LE(at + 24) === 0xffffffff) value += 8;
        if (size === 0xffffffff) { size = Number(extra.readBigUInt64LE(value)); value += 8; }
        if (local === 0xffffffff) local = Number(extra.readBigUInt64LE(value));
      }
    }
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error(`${name}: encrypted`);
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error(`${name}: broken local header`);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + size);
    if (method === 0) yield { name, data: raw };
    else if (method === 8) yield { name, data: zlib.inflateRawSync(raw) };
    else throw new Error(`${name}: compression method ${method} isn't read here`);
  }
}

// --- the tools that open .dmg and .exe · .7z; what they open is cleaned up, also on Ctrl-C ----------------------------

const temporaries = new Set();
const mounts = new Set();
const detach = (mount) => {
  for (const extra of [[], ["-force"]]) {
    if (spawnSync("hdiutil", ["detach", ...extra, mount], { stdio: "ignore" }).status === 0) break;
  }
  mounts.delete(mount);
};
const cleanUp = () => {
  for (const mount of [...mounts]) detach(mount);
  for (const folder of [...temporaries]) { fs.rmSync(folder, { recursive: true, force: true }); temporaries.delete(folder); }
};
process.on("exit", cleanUp);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => { cleanUp(); process.exit(130); });

const temporary = () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "release-paths-"));
  temporaries.add(folder);
  return folder;
};
const removeTemporary = (folder) => { fs.rmSync(folder, { recursive: true, force: true }); temporaries.delete(folder); };

let sevenZip;
const findSevenZip = () => {
  if (sevenZip) return sevenZip;
  for (const command of [process.env.SEVEN_ZIP, "7zz", "7z"].filter(Boolean)) {
    if (spawnSync(command, ["i"], { stdio: "ignore" }).status === 0) return (sevenZip = command);
  }
  throw new Error("7-Zip (7zz or 7z) is needed to open .exe and .7z files");
};

// --- the walk -----------------------------------------------------------------------------------------------------

class Check {
  files = 0;
  bytes = 0;
  hits = [];

  searchBytes(name, buffer) {
    this.files += 1;
    this.bytes += buffer.length;
    const allowedHere = allowed.filter((entry) => entry.file.test(name.normalize("NFC")));
    const found = needles.map(({ label, bytes }) => {
      let total = count(buffer, bytes);
      for (const entry of allowedHere) {
        const text = Buffer.from(entry.text, label.endsWith("(UTF-16LE)") ? "utf16le" : "utf8");
        if (text.includes(bytes)) total -= Math.min(entry.most, count(buffer, text)) * count(text, bytes);
      }
      return { label, count: total };
    }).filter((hit) => hit.count > 0);
    if (found.length > 0) this.hits.push({ name: mask(name), found });
  }

  // A file's bytes, then whatever it holds. `onDisk` is its path when it is a file (7-Zip and hdiutil need one).
  async file(name, buffer, onDisk) {
    this.searchBytes(name, buffer);
    const base = path.basename(name);
    if (isZip(base, buffer)) {
      for (const entry of zipEntries(buffer)) await this.file(`${name}!/${entry.name}`, entry.data);
    } else if (/\.dmg$/i.test(base)) {
      await this.withFile(buffer, onDisk, ".dmg", (file) => this.dmg(name, file));
    } else if (/\.7z$/i.test(base) || (/\.exe$/i.test(base) && buffer.includes("NullsoftInst"))) {
      await this.withFile(buffer, onDisk, path.extname(base), (file) => this.sevenZip(name, file));
    }
  }

  async withFile(buffer, onDisk, extension, open) {
    if (onDisk) return open(onDisk);
    const folder = temporary();
    try {
      const file = path.join(folder, `archive${extension}`);
      fs.writeFileSync(file, buffer);
      await open(file);
    } finally { removeTemporary(folder); }
  }

  async sevenZip(name, file) {
    const folder = temporary();
    try {
      execFileSync(findSevenZip(), ["x", "-y", "-bso0", "-bsp0", `-o${folder}`, file], { stdio: ["ignore", "ignore", "pipe"] });
      await this.walk(`${name}!`, folder);
    } finally { removeTemporary(folder); }
  }

  async dmg(name, file) {
    if (process.platform !== "darwin") throw new Error("a .dmg is opened with hdiutil (macOS only)");
    const folder = temporary();
    const mount = path.join(folder, "mount");
    const copy = path.join(folder, "copy");
    try {
      fs.mkdirSync(mount);
      execFileSync("hdiutil", ["attach", "-nobrowse", "-noautoopen", "-readonly", "-mountpoint", mount, file], { stdio: "ignore" });
      mounts.add(mount);
      try {
        execFileSync("ditto", [mount, copy], { stdio: ["ignore", "ignore", "pipe"] });
      } finally { detach(mount); }
      await this.walk(`${name}!`, copy);
    } finally { removeTemporary(folder); }
  }

  // A folder (an .app bundle, win-unpacked, a mounted or unpacked archive): every file, links by their target text.
  async walk(name, place) {
    const stat = fs.lstatSync(place);
    if (stat.isSymbolicLink()) {
      this.searchBytes(`${name} (link)`, Buffer.from(fs.readlinkSync(place), "utf8"));
    } else if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(place).sort()) await this.walk(`${name}/${entry}`, path.join(place, entry));
    } else if (stat.isFile()) {
      await this.file(name, fs.readFileSync(place), place);
    }
  }
}

const shown = (target) => {
  const relative = path.relative(process.cwd(), target);
  return mask(relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : target);
};

// Checks the targets and prints the report. Returns the exit code: 0 clean, 1 paths found, 2 something couldn't be read.
export async function checkReleasePaths(targets, { log = console.log, error = console.error } = {}) {
  if (targets.length === 0) {
    error("Usage: node tools/check-release-paths.mjs <file or folder>…");
    return 2;
  }
  const check = new Check();
  try {
    for (const target of targets) {
      const full = path.resolve(target);
      if (!fs.existsSync(full)) throw new Error(`${shown(full)}: not found`);
      await check.walk(shown(full), full);
    }
  } catch (problem) {
    error(`Release path check: couldn't read everything — ${mask(problem.message)}`);
    return 2;
  } finally { cleanUp(); }
  const where = targets.map((target) => shown(path.resolve(target))).join(", ");
  const megabytes = (check.bytes / 1024 / 1024).toFixed(1);
  if (check.hits.length === 0) {
    log(`Release path check: no build-folder paths in ${check.files} file(s), ${megabytes} MB (${where}).`);
    return 0;
  }
  const total = check.hits.reduce((sum, hit) => sum + hit.found.reduce((part, found) => part + found.count, 0), 0);
  error(`Release path check: ${total} build-folder path(s) in ${check.hits.length} of ${check.files} file(s) (${where}) — see #225.`);
  for (const hit of check.hits) error(`  ${hit.name}: ${hit.found.map((found) => `${found.label} × ${found.count}`).join(", ")}`);
  return 1;
}

const invoked = process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exitCode = await checkReleasePaths(process.argv.slice(2));
