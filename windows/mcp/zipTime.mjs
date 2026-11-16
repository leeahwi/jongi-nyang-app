// #493: the same commit always packs the same jongi-nyang.mcpb. `mcpb pack` stamps every zip entry with the time it
// runs (fflate zipSync, `mtime: new Date()`, in local time), so the Mac and Windows builds of one tag, made a minute
// apart in two worktrees, got .mcpb files that differed only in those stamps, and publish's check that all copies are
// the same stopped. build.mjs rewrites the stamps to the commit's time (SOURCE_DATE_EPOCH, else the commit of HEAD) in
// UTC, so neither the hour nor the time zone of the build gets in.
//   node mcp/zipTime.mjs --epoch                 prints the time build.mjs uses (seconds)
//   node mcp/zipTime.mjs <file.zip> <seconds>    rewrites that zip's stamps
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// 2026-01-01T00:00:00Z: used only when there is neither SOURCE_DATE_EPOCH nor git (a source folder without history).
const FALLBACK = 1767225600;

export function releaseEpoch(dir) {
  const fromEnv = process.env.SOURCE_DATE_EPOCH;
  if (fromEnv && /^\d+$/.test(fromEnv)) return Number(fromEnv);
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%ct"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (/^\d+$/.test(out)) return Number(out);
  } catch { /* not a git checkout */ }
  return FALLBACK;
}

// MS-DOS date and time of a moment in UTC (2-second steps; the format starts in 1980).
export function dosStamp(seconds) {
  const d = new Date(Math.max(seconds, 315532800) * 1000);
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

// Rewrites the stamp of every entry in the central directory and in its local header. Walks the central directory
// from the end record, so bytes inside the compressed data are never taken for a header. Returns the number of entries.
export function setZipTime(buf, seconds) {
  const { time, date } = dosStamp(seconds);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("zipTime: no end of central directory record");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error(`zipTime: entry ${n} has no central header`);
    buf.writeUInt16LE(time, at + 12);
    buf.writeUInt16LE(date, at + 14);
    const local = buf.readUInt32LE(at + 42);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`zipTime: entry ${n} has no local header`);
    buf.writeUInt16LE(time, local + 10);
    buf.writeUInt16LE(date, local + 12);
    at += 46 + buf.readUInt16LE(at + 28) + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return count;
}

export function setZipFileTime(file, seconds) {
  const buf = readFileSync(file);
  const count = setZipTime(buf, seconds);
  writeFileSync(file, buf);
  return count;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [arg, seconds] = process.argv.slice(2);
  if (arg === "--epoch") console.log(releaseEpoch(process.cwd()));
  else if (arg && /^\d+$/.test(seconds ?? "")) setZipFileTime(arg, Number(seconds));
  else { console.error("usage: node mcp/zipTime.mjs --epoch | <file.zip> <seconds>"); process.exit(2); }
}
