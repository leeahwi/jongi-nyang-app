import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileLimits } from "../core/fileLimits";

/**
 * Reading and writing the storage folder, the backups and 종이냥 for Claude's files safely (#173, security review L-04 ·
 * L-05). Someone who can write to a shared folder could plant a link where a file (or its temporary file) goes, or a
 * huge file; so:
 *
 * - a temporary file has a random name and is made new (`wx`: fails if anything, a link too, is there already), then
 *   renamed over the target — never half a file, never written through a link;
 * - a file is looked at with `lstat` first: a link is neither read nor written over, and one past its size limit is
 *   not read (core/fileLimits.ts). Both throw `RefusedFile`, which callers turn into "skipped" or a message.
 *
 * The same rules as the Mac's (PaperCore SafeFile.swift); the shared cases are docs/plans/file-safety-cases.json.
 */

/** Why a file was left alone: a symbolic link, or past its size limit. */
export type Refusal = "link" | "tooLarge";

export class RefusedFile extends Error {
  constructor(readonly file: string, readonly why: Refusal, readonly limit = 0) {
    super(`${path.basename(file)} ${why}`);
  }
}

/** A temporary name beside `file`, random each time (`todos.json.3f9a1c0b7d2e.tmp`), so it can't be planted beforehand. */
export function temporaryPath(file: string, kind = "tmp"): string {
  return `${file}.${randomBytes(6).toString("hex")}.${kind}`;
}

/** A new file only: EEXIST when anything — a file, a link, a folder — is already at that name. */
export function writeNew(file: string, contents: string | Buffer): void {
  fs.writeFileSync(file, contents, typeof contents === "string" ? { encoding: "utf8", flag: "wx" } : { flag: "wx" });
}

/** The entry at `file` itself (links not followed); undefined when there is none. */
export function entryAt(file: string): fs.Stats | undefined {
  try { return fs.lstatSync(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") return undefined;
    throw error;
  }
}

/** Throws RefusedFile when `file` is a link, or a file bigger than `limit`. Nothing there (or a folder) passes. */
export function checkFile(file: string, limit: number = fileLimits.dataFileBytes): fs.Stats | undefined {
  const entry = entryAt(file);
  if (entry?.isSymbolicLink()) throw new RefusedFile(file, "link", limit);
  if (entry?.isFile() && entry.size > limit) throw new RefusedFile(file, "tooLarge", limit);
  return entry;
}

/** True when `file` is a link or past `limit` (what a reader would refuse). */
export function isRefused(file: string, limit: number = fileLimits.dataFileBytes): boolean {
  try { checkFile(file, limit); return false; } catch (error) { return error instanceof RefusedFile; }
}

/**
 * A file's bytes: lstat'ed first (RefusedFile for a link or past `limit`), then opened without following a link where
 * the system can (O_NOFOLLOW) and checked again on the open file. ENOENT and the rest come out as the system's errors.
 */
export function readBytesSafely(file: string, limit: number = fileLimits.dataFileBytes): Buffer {
  checkFile(file, limit);
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let handle: number;
  try { handle = fs.openSync(file, fs.constants.O_RDONLY | noFollow); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new RefusedFile(file, "link", limit);
    throw error;
  }
  try {
    const stat = fs.fstatSync(handle);
    if (stat.isFile() && stat.size > limit) throw new RefusedFile(file, "tooLarge", limit);
    return fs.readFileSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

/** readBytesSafely as text. */
export function readTextSafely(file: string, limit: number = fileLimits.dataFileBytes): string {
  return readBytesSafely(file, limit).toString("utf8");
}

/** readTextSafely, or undefined when the file isn't there, is refused or doesn't read (for what is only shown or merged). */
export function readTextIfSafe(file: string, limit: number = fileLimits.dataFileBytes): string | undefined {
  try { return readTextSafely(file, limit); } catch { return undefined; }
}

/**
 * Adds `text` to the end of `file` (made when missing): never through a link (RefusedFile; O_NOFOLLOW on the open where
 * the system has it), and not onto a file past `limit` — one that big isn't read back either.
 */
export function appendSafely(file: string, text: string, limit: number = fileLimits.dataFileBytes): void {
  checkFile(file, limit);
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0);
  let handle: number;
  try { handle = fs.openSync(file, flags, 0o666); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new RefusedFile(file, "link", limit);
    throw error;
  }
  try { fs.writeSync(handle, text, null, "utf8"); } finally { fs.closeSync(handle); }
}

/**
 * A file the person picked themselves (가져오기…): its link, if it is one, is theirs to follow, but past `limit` it is
 * not read (RefusedFile "tooLarge").
 */
export function readChosenText(file: string, limit: number = fileLimits.backupBytes): string {
  const stat = fs.statSync(file);
  if (stat.isFile() && stat.size > limit) throw new RefusedFile(file, "tooLarge", limit);
  return fs.readFileSync(file, "utf8");
}

/**
 * Written to a random temporary file beside it (made new) and then renamed over it, so nobody ever sees half a file.
 * A link at `file` is not written over (RefusedFile): the rename would put the list where the link was.
 */
export function writeFileAtomically(file: string, contents: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (entryAt(file)?.isSymbolicLink()) throw new RefusedFile(file, "link");
  const temporary = temporaryPath(file);
  try { writeNew(temporary, contents); } catch (error) {
    // Half written (a full disk): ours, so it goes. EEXIST: not ours, so it stays.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") try { fs.unlinkSync(temporary); } catch { /* never made */ }
    throw error;
  }
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* gone already */ }
    throw error;
  }
}
