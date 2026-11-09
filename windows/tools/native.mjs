// #272 · #273: makes sure the one native file the Windows app ships is in node_modules before electron-builder packs it —
// Koffi's prebuilt Windows binary (@koromix/koffi-win32-x64, MIT), which main/stayBehind.ts uses to call SetWindowPos.
// npm installs it only on Windows (it is an optional dependency for win32 x64), so a build on a Mac fetches the exact
// tarball package-lock.json names and checks it against the lockfile's integrity before unpacking koffi.node.
// `node tools/native.mjs` (part of `npm run dist`).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = "@koromix/koffi-win32-x64";
const inside = "package/win32_x64/koffi.node";
const folder = path.join(root, "node_modules", name);
const target = path.join(folder, "win32_x64", "koffi.node");

/** One file out of a tar archive (ustar: 512-byte headers, the size in octal, the data padded to 512). */
function untarOne(tar, wanted) {
  for (let at = 0; at + 512 <= tar.length;) {
    const header = tar.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const prefix = field(345, 155);
    const file = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const size = parseInt(field(124, 12).trim() || "0", 8);
    if (file === wanted) return tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return undefined;
}

const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
const entry = lock.packages?.[`node_modules/${name}`];
if (!entry?.resolved || !entry?.integrity?.startsWith("sha512-")) {
  console.error(`native: ${name} isn't in package-lock.json with a sha512 integrity`);
  process.exit(2);
}
const installed = existsSync(path.join(folder, "package.json")) ? JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")).version : undefined;
if (existsSync(target) && installed === entry.version) {
  console.log(`native: ${name} ${entry.version} is in node_modules`);
  process.exit(0);
}

const response = await fetch(entry.resolved);
if (!response.ok) {
  console.error(`native: ${entry.resolved} answered ${response.status}`);
  process.exit(1);
}
const archive = Buffer.from(await response.arrayBuffer());
const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
if (integrity !== entry.integrity) {
  console.error(`native: ${entry.resolved} doesn't match package-lock.json's integrity; nothing was written`);
  process.exit(1);
}
const tar = gunzipSync(archive);
const binary = untarOne(tar, inside);
const manifest = untarOne(tar, "package/package.json");
if (!binary || !manifest) {
  console.error(`native: ${inside} isn't in ${entry.resolved}`);
  process.exit(1);
}
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, binary);
writeFileSync(path.join(folder, "package.json"), manifest);
console.log(`native: ${name} ${entry.version} fetched and checked (${binary.length} bytes)`);
