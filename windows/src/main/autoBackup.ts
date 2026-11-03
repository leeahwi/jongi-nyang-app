import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { backupCounts, isDue, makeBackup, parseBackup, parseSavedName, type BackupCounts, type BackupFiles, type BackupReason } from "../core/backup";
import type { BackupEntry, BackupsView } from "../core/types";
import { readDataFiles, saveCopy, writeFileAtomically } from "./storageFolder";
import { fileLimits } from "../core/fileLimits";
import { checkFile, entryAt, readTextSafely } from "./safeFiles";

/**
 * 자동 백업 (#139): a copy of the storage folder in the backup folder on this device — once a day (the app's day, from
 * 4 a.m.; skipped when nothing changed since the last copy), before every overwrite (가져오기 · 저장 폴더 덮어쓰기 ·
 * 되돌리기 · the first launch after an update) and by hand (지금 백업하기). 14 daily copies stay, 10 of each ‘before’ kind,
 * the ones made by hand until deleted (core/backup.ts pruneSaved). Always on this device, even with a shared storage
 * folder: each device keeps its own. The same rules, names and words as the Mac's (AutoBackup.swift).
 *
 * What this device remembers about it is in backup.json beside settings.json (it doesn't travel with the list):
 * the switch, the chosen folder, the fingerprint of the last copy, the version that last ran, the last failure.
 * Nothing here touches Electron, so the tests run it on fictional temporary folders.
 */

export const backupStateFileName = "backup.json";

export interface BackupState {
  /** The daily copy (the switch). Copies before an overwrite are made either way. */
  auto: boolean;
  /** A chosen backup folder; none: the settings folder's backups/. */
  folder?: string;
  /** SHA-256 of the files in the last copy (any kind): an unchanged folder makes no new daily copy. */
  fingerprint?: string;
  /** The app version that ran last (a different one: 업데이트-전-… before the store reads the files). */
  version?: string;
  /** When the last copy failed (ISO); cleared by the next one that works. */
  failedAt?: string;
}

export function readBackupState(settingsDirectory: string): BackupState {
  try {
    const value = JSON.parse(readTextSafely(path.join(settingsDirectory, backupStateFileName))) as Partial<BackupState>;
    return {
      auto: value.auto !== false,
      ...(typeof value.folder === "string" && value.folder ? { folder: value.folder } : {}),
      ...(typeof value.fingerprint === "string" ? { fingerprint: value.fingerprint } : {}),
      ...(typeof value.version === "string" ? { version: value.version } : {}),
      ...(typeof value.failedAt === "string" ? { failedAt: value.failedAt } : {}),
    };
  } catch {
    return { auto: true };
  }
}

export function writeBackupState(settingsDirectory: string, state: BackupState): void {
  writeFileAtomically(path.join(settingsDirectory, backupStateFileName), JSON.stringify(state, null, 2) + "\n");
}

/** The files' fingerprint: SHA-256 of each name and text, in name order. */
export function fingerprint(files: BackupFiles): string {
  const hash = createHash("sha256");
  for (const name of Object.keys(files).sort()) hash.update(`${name}\0${files[name]}\0`);
  return hash.digest("hex");
}

/** `candidate` is `folder` or somewhere inside it (Windows paths compare without case). */
export function isInside(candidate: string, folder: string, windows = process.platform === "win32"): boolean {
  const fold = (value: string) => (windows ? path.win32.resolve(value).toLowerCase() : path.resolve(value));
  const relative = (windows ? path.win32 : path).relative(fold(folder), fold(candidate));
  return relative === "" || (!relative.startsWith("..") && !(windows ? path.win32 : path).isAbsolute(relative));
}

/** A folder that is there and can be written to now (never made: a missing disk's folder stays missing). */
function present(folder: string): boolean {
  try {
    if (!fs.statSync(folder).isDirectory()) return false;
    fs.accessSync(folder, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export class AutoBackup {
  state: BackupState;
  /** An import or a restore is writing the folder: the daily check waits for the next time. */
  busy = false;
  private readonly countsCache = new Map<string, { stamp: number; counts?: BackupCounts }>();
  /** The last view (every state the windows get carries it): drawn again after a change here, or a minute later. */
  private shown?: { shared: boolean; at: number; view: BackupsView };
  private reading = new Set<string>();

  constructor(
    readonly settingsDirectory: string,
    private dataDirectory: () => string,
    private readonly from: () => string,
    /** Something the desk shows changed (a copy made or removed, the counts of one read). */
    private readonly changed: () => void = () => undefined,
  ) {
    this.state = readBackupState(settingsDirectory);
  }

  get defaultFolder(): string { return path.join(this.settingsDirectory, "backups"); }

  /** Where copies go now: the chosen folder while it is there, else the default (and `missing` says so). */
  get place(): { folder: string; custom: boolean; missing: boolean } {
    const chosen = this.state.folder;
    if (chosen && present(chosen) && !isInside(chosen, this.dataDirectory())) return { folder: chosen, custom: true, missing: false };
    return { folder: this.defaultFolder, custom: false, missing: Boolean(chosen) };
  }

  get folder(): string { return this.place.folder; }

  private save(): void {
    try { writeBackupState(this.settingsDirectory, this.state); } catch { /* tried again with the next change */ }
  }

  setAuto(on: boolean): void {
    this.state.auto = on;
    this.save();
    this.refresh();
  }

  /** A chosen folder; refused (false) when it is the storage folder or inside it. Undefined: back to the default. */
  setFolder(folder: string | undefined): boolean {
    if (folder && isInside(folder, this.dataDirectory())) return false;
    // The default folder chosen again is the default.
    if (folder && isInside(folder, this.defaultFolder) && isInside(this.defaultFolder, folder)) folder = undefined;
    if (folder) this.state.folder = folder; else delete this.state.folder;
    this.save();
    this.refresh();
    return true;
  }

  /**
   * A copy of `files` (the storage folder now, unless given) of this kind in the backup folder, the oldest of the kind
   * past what it keeps removed. Remembers its fingerprint; a failure is remembered (the status line says it) and thrown.
   */
  copy(reason: Exclude<BackupReason, "export">, now = new Date(), files: BackupFiles = readDataFiles(this.dataDirectory())): string {
    try {
      fs.mkdirSync(this.folder, { recursive: true });
      const file = saveCopy(this.folder, reason, makeBackup(files, this.from(), now, reason), now);
      this.state.fingerprint = fingerprint(files);
      delete this.state.failedAt;
      return file;
    } catch (error) {
      this.state.failedAt = now.toISOString();
      throw error;
    } finally {
      this.save();
      this.refresh();
    }
  }

  /** The newest daily copy's time in the backup folder. */
  lastDaily(): Date | undefined {
    let last: Date | undefined;
    for (const name of this.names()) {
      const copy = parseSavedName(name);
      if (copy?.reason === "daily" && (!last || copy.date > last)) last = copy.date;
    }
    return last;
  }

  /**
   * The daily check (at launch, on waking, every hour): with the switch on and nothing writing, a 매일-… copy when the
   * app's day moved on since the last one and the files changed since the last copy of any kind. Returns the file made.
   */
  daily(now = new Date()): string | undefined {
    if (!this.state.auto || this.busy) return undefined;
    let files: BackupFiles;
    try { files = readDataFiles(this.dataDirectory()); } catch { return undefined; }
    if (Object.keys(files).length === 0) return undefined;
    if (!isDue(now, this.lastDaily(), fingerprint(files) !== this.state.fingerprint)) return undefined;
    try { return this.copy("daily", now, files); } catch { return undefined; }
  }

  /**
   * The first launch of a new version (before the store reads — and may rewrite — the files): 업데이트-전-… when the
   * storage folder has anything; then this version is remembered. Never stops the launch.
   */
  beforeUpdate(version: string, now = new Date()): string | undefined {
    if (this.state.version === version) return undefined;
    let made: string | undefined;
    try {
      const files = readDataFiles(this.dataDirectory());
      if (Object.keys(files).length > 0) made = this.copy("beforeUpdate", now, files);
    } catch { /* remembered as the last failure */ }
    this.state.version = version;
    this.save();
    return made;
  }

  /** The .jongi names in the backup folder. */
  private names(): string[] {
    try { return fs.readdirSync(this.folder).filter((name) => name.endsWith(".jongi")); } catch { return []; }
  }

  /**
   * The desk's 자동 백업 and 백업 목록: newest first. A copy's counts come from its `counts`, else from reading it once
   * (in the background, then remembered by name and modification time).
   */
  view(shared: boolean, now = Date.now()): BackupsView {
    if (this.shown && this.shown.shared === shared && now - this.shown.at < 60_000) return this.shown.view;
    const view = this.freshView(shared);
    this.shown = { shared, at: now, view };
    return view;
  }

  /** Something here changed: the next view is read again, and the windows hear of it. */
  refresh(): void {
    this.shown = undefined;
    this.changed();
  }

  private freshView(shared: boolean): BackupsView {
    const place = this.place;
    const entries: BackupEntry[] = [];
    for (const name of this.names()) {
      const copy = parseSavedName(name);
      if (!copy) continue;
      // #173: a link in the backup folder is not a copy (not listed, never read).
      const stat = (() => { try { return entryAt(path.join(place.folder, name)); } catch { return undefined; } })();
      if (!stat?.isFile()) continue;
      const key = path.join(place.folder, name);
      const known = this.countsCache.get(key);
      if (!known || known.stamp !== stat.mtimeMs) this.readCounts(key, stat.mtimeMs);
      entries.push({ name, reason: copy.reason, at: copy.date.toISOString(), size: stat.size, ...(known?.stamp === stat.mtimeMs && known.counts ? { counts: known.counts } : {}) });
    }
    entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.name < b.name ? 1 : -1));
    return {
      auto: this.state.auto, folder: place.folder, custom: place.custom, missing: place.missing, failed: Boolean(this.state.failedAt), shared,
      entries, total: entries.reduce((sum, entry) => sum + entry.size, 0),
    };
  }

  private readCounts(file: string, stamp: number): void {
    if (this.reading.has(file)) return;
    this.reading.add(file);
    // #173: past the size limit (64MB) or a link, its counts are not read (the list shows it without them).
    void Promise.resolve().then(() => { checkFile(file, fileLimits.backupBytes); return fs.promises.readFile(file, "utf8"); }).then((text) => {
      const parsed = parseBackup(text);
      this.countsCache.set(file, { stamp, counts: "backup" in parsed ? parsed.backup.counts ?? countsOf(parsed.backup.files) : undefined });
    }).catch(() => {
      this.countsCache.set(file, { stamp });
    }).finally(() => {
      this.reading.delete(file);
      this.refresh();
    });
  }

  /** The counts of one copy now (a test, and a restore's question). */
  static async countsOf(file: string): Promise<BackupCounts | undefined> {
    checkFile(file, fileLimits.backupBytes);
    const parsed = parseBackup(await fs.promises.readFile(file, "utf8"));
    return "backup" in parsed ? parsed.backup.counts ?? countsOf(parsed.backup.files) : undefined;
  }

  /** The copy file of a list entry, only when it is one of this folder's copies (a name sent by a window is checked). */
  fileOf(name: string): string | undefined {
    if (!parseSavedName(name) || path.basename(name) !== name) return undefined;
    const file = path.join(this.folder, name);
    return entryAt(file)?.isFile() ? file : undefined;
  }
}

const countsOf = (files: BackupFiles): BackupCounts => backupCounts(files);
