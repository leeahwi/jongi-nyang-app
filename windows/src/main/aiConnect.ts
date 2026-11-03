import fs from "node:fs";
import path from "node:path";
import {
  advanceSeen, aiAwayText, aiCatLine, aiEntry, aiExtOutdated, aiExtVersion, aiLinkFileName, aiLockFileName, aiLogFileName, aiLogLine, aiMarks, aiToastText, aiUndoText,
  awayCount, isAiWork, parseAiLog, recentAi, serializeAiLink, trimAiLog, undoEntry, undoneIds, unseenAi, type AiLogEntry, type AiSeen,
} from "../core/ai";
import { dayKey } from "../core/archive";
import { clock } from "../core/lang";
import type { AiView, NoteNotice } from "../core/types";
import { lang } from "../i18n";
import type { Store } from "./store";
import { appendSafely, readTextSafely, writeFileAtomically } from "./safeFiles";

/**
 * AI 연결 (1.27, 종이냥 for Claude): the app's side. It writes ai-link.json (on or off, the data folder, the
 * language) at launch and whenever one of them changes; while it is on it takes the write lock around its own
 * writes (the Store), watches ai-log.jsonl in the settings folder and turns Claude's new entries into a toast
 * with 되돌리기 (자리 비운 사이 for what came while the app was closed or the note hidden), a stamp on the rows
 * Claude touched today, now and then a line from the cat, and the recent list in 설정 › AI 연결. Undo puts back
 * only what is still as Claude left it (M13–M15) and writes its own line in the log.
 */

export interface AiHooks {
  /** A toast on the note; false when the note isn't up to show it. */
  toast(notice: NoteNotice): boolean;
  noteVisible(): boolean;
  /** The cat says a line (when it is out and not busy). */
  say(line: string): void;
  changed(): void;
}

/** Where the bundled extension is: the server for Claude Code, the .mcpb for Claude Desktop, and the app to run it with. */
export interface AiFiles { server: string; mcpb: string; exe: string }

export class AiConnection {
  private entries: AiLogEntry[] = [];
  /** The last three days of it (what the stamps and the recent list look at, every redraw). */
  private recentEntries: AiLogEntry[] = [];
  private readStamp = "";
  private watcher?: fs.FSWatcher;
  private timer?: NodeJS.Timeout;
  private copiedTimer?: NodeJS.Timeout;
  private copied = false;
  /** How the last 되돌리기 went, under the recent list (a toast needs the note up). */
  private undoNote?: { id: string; text: string };
  private undoNoteTimer?: NodeJS.Timeout;
  /** Claude's entry Ctrl+Z takes back, while nothing was changed here since it came (the history as it was then). */
  private latest?: { id: string; history: unknown; depth: number };
  /** Entries that came while the note was hidden: shown as 자리 비운 사이 when it comes back. */
  private waiting = false;
  /** There is something in ai-log.jsonl (기록 지우기 has something to clear). */
  private hasLog = false;

  constructor(private readonly store: Store, private readonly settings: string, private readonly hooks: AiHooks, readonly files: AiFiles, private readonly appLabel: string) {}

  get enabled(): boolean { return this.store.prefs.aiEnabled; }
  private get logPath(): string { return path.join(this.settings, aiLogFileName); }

  /** At launch: the link written, the log's old lines dropped (on or off), and while on, the log read and what came meanwhile said once (M15). */
  start(): void {
    this.writeLink();
    this.apply();
    this.trimOld();
    if (!this.enabled) return;
    this.read();
    this.tell("away");
  }

  /** The switch in 설정 › AI 연결 (and Claude 데스크톱에 연결, which turns it on). */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.store.setPref("aiEnabled", on);
    // Whatever is in the log already is old news: only what comes from now on gets a toast.
    if (on) { this.read(); this.seen(advanceSeen(this.seenNow(), this.entries)); }
    this.writeLink();
    this.apply();
    this.hooks.changed();
  }

  /** ai-link.json, written whole (temporary file, then renamed). Also after the storage folder moved. */
  writeLink(): void {
    const text = serializeAiLink({ v: 1, enabled: this.enabled, dataFolder: this.store.dataDirectory, lang: lang(), app: this.appLabel, updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), ext: aiExtVersion });
    const file = path.join(this.settings, aiLinkFileName);
    try {
      if (fs.existsSync(file) && fs.readFileSync(file, "utf8").replace(/"updatedAt": "[^"]*"/, "") === text.replace(/"updatedAt": "[^"]*"/, "")) return;
      writeFileAtomically(file, text); // #173: a random temporary name, made new
    } catch {
      // The settings folder can't be written: Claude will say it's off, which is the safe side.
    }
  }

  /** On: the Store takes the lock and the log is watched. Off: neither (no CPU while idle either way). */
  private apply(): void {
    this.store.aiLock = this.enabled ? path.join(this.settings, aiLockFileName) : undefined;
    if (this.enabled && !this.watcher) {
      try {
        this.watcher = fs.watch(this.settings, (_event, name) => {
          if (name && name.toString() !== aiLogFileName) return;
          clearTimeout(this.timer);
          this.timer = setTimeout(() => this.logChanged(), 120);
        });
        this.watcher.on("error", () => { this.watcher?.close(); this.watcher = undefined; });
      } catch {
        // No change notifications here: the log is still read when the note comes up.
      }
    } else if (!this.enabled && this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
      clearTimeout(this.timer);
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = undefined;
    clearTimeout(this.timer);
  }

  /** #174 (review I-01): lines older than 30 days go, whatever the log's size. The text as it is now ("" without a log). */
  private trimOld(): string {
    let text = "";
    try { text = readTextSafely(this.logPath); } catch { this.hasLog = false; return ""; }
    const trimmed = trimAiLog(text, new Date(), 0);
    if (trimmed !== undefined) {
      try { writeFileAtomically(this.logPath, trimmed); text = trimmed; } catch { /* next time */ }
    }
    this.hasLog = text.trim().length > 0;
    return text;
  }

  /** Reads the log when it changed since the last read (and drops its lines older than 30 days). */
  private read(): void {
    let stat: fs.Stats;
    try { stat = fs.statSync(this.logPath); } catch { this.entries = []; this.recentEntries = []; this.readStamp = ""; this.hasLog = false; return; }
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    if (stamp === this.readStamp) return;
    const text = this.trimOld();
    this.readStamp = stamp;
    this.entries = parseAiLog(text);
    const since = Date.now() - 3 * 86_400_000;
    this.recentEntries = this.entries.filter((entry) => Date.parse(entry.at) >= since);
  }

  private logChanged(): void {
    if (!this.enabled) return;
    this.read();
    // The data first, so the toast's item is already on the list (Claude writes the file before the log).
    this.store.catchUp(["todos.json", "events.json", "memos.json", "memo-folders.json"]);
    this.tell(this.hooks.noteVisible() && !this.waiting ? "live" : "away");
    this.hooks.changed();
  }

  /** The note came up (shown, unfolded): what came while it was hidden. */
  noteShown(): void {
    if (!this.enabled || !this.waiting) return;
    this.read();
    this.tell("away");
  }

  private seenNow(): AiSeen | undefined {
    const { aiSeenId: id, aiSeenAt: at } = this.store.prefs;
    return id ? { id, at } : undefined;
  }

  private seen(value: AiSeen | undefined): void {
    if (!value) return;
    this.store.setPref("aiSeenId", value.id);
    this.store.setPref("aiSeenAt", value.at);
  }

  /**
   * Says what is new since "seen until": live, the newest entry's own toast (with 되돌리기, and Ctrl+Z); away
   * (launch, the note hidden meanwhile), one "자리 비운 사이 Claude가 N가지를 했어요 · 보기" with the count of items.
   */
  private tell(mode: "live" | "away"): void {
    const unseen = unseenAi(this.entries, this.seenNow());
    const undone = undoneIds(this.entries);
    const work = unseen.filter((entry) => isAiWork(entry) && !undone.has(entry.id));
    if (work.length === 0) { this.seen(advanceSeen(this.seenNow(), unseen)); return; }
    if (!this.hooks.noteVisible()) { this.waiting = true; return; }
    const language = lang();
    const newest = work[work.length - 1];
    const shown = mode === "live" && work.length === 1
      ? this.hooks.toast({ icon: "sparkles", text: aiToastText(newest, language), undo: "ai", entry: newest.id, long: true })
      : this.hooks.toast({ icon: "sparkles", text: aiAwayText(awayCount(work, undone), language), show: "ai", long: true });
    if (!shown) { this.waiting = true; return; }
    this.waiting = false;
    this.seen(advanceSeen(this.seenNow(), unseen));
    if (mode === "live" && work.length === 1) {
      this.latest = { id: newest.id, history: this.store.history, depth: this.store.history.undoDepth };
      const line = aiCatLine(newest, this.store.prefs.aiCatSaid || undefined, new Date(), Math.random, language);
      if (line) { this.store.setPref("aiCatSaid", Date.now()); this.hooks.say(line); }
    }
  }

  /** Ctrl+Z: Claude's latest entry, when nothing was changed here since its toast. Whether it took it. */
  undoLatest(): boolean {
    const latest = this.latest;
    this.latest = undefined;
    if (!latest || latest.history !== this.store.history || latest.depth !== this.store.history.undoDepth) return false;
    this.undo(latest.id);
    return true;
  }

  /**
   * 되돌리기 on Claude's entry: back to `before` for what is still as Claude left it; the rest stays (M13 · M14).
   * Writes an undo line in the log and says how it went in a toast.
   */
  undo(id: string): void {
    this.read();
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry || !isAiWork(entry) || undoneIds(this.entries).has(id)) return;
    let outcome = { undone: 0, left: entry.changes.length, written: [] as ReturnType<typeof undoEntry>["written"] };
    if (entry.target === "todos") {
      this.store.mutate((history) => {
        const result = undoEntry(history.items, entry);
        outcome = result;
        if (result.written.length) history.replaceItems(result.items);
      });
    } else if (entry.target === "events") {
      this.store.locked(() => {
        this.store.catchUp(["events.json"]);
        const result = undoEntry(this.store.events, entry);
        outcome = result;
        if (result.written.length) this.store.replaceEvents(result.items);
      });
    } else {
      this.store.locked(() => {
        this.store.catchUp(["memos.json"]);
        const result = undoEntry(this.store.memos, entry);
        outcome = result;
        for (const change of result.written) if (!change.after) this.store.discardMemo(change.id);
      });
    }
    if (outcome.undone > 0) {
      const line = aiLogLine(aiEntry({ client: "app", tool: "undo", kind: "undo", target: entry.target, title: entry.title, undoes: entry.id, changes: outcome.written, count: outcome.undone }));
      try { appendSafely(this.logPath, `${line}\n`); } catch { /* the list changed all the same */ }
      this.read();
    }
    const text = aiUndoText(outcome.undone, outcome.left, lang());
    this.hooks.toast({ icon: outcome.left === 0 ? "undo" : "warning", text, long: true });
    // Under its entry only when something stayed (all back: the entry's 되돌림 says it).
    if (outcome.left > 0) {
      this.undoNote = { id, text };
      clearTimeout(this.undoNoteTimer);
      this.undoNoteTimer = setTimeout(() => { this.undoNote = undefined; this.hooks.changed(); }, 8000);
    }
    this.hooks.changed();
  }

  /**
   * 기록 지우기 (#174, review I-01): ai-log.jsonl emptied — the recent list, its 되돌리기 and the stamps go with it;
   * the to-dos, events and memos stay as they are. The extension starts a new log with its next change.
   */
  clearLog(): void {
    try {
      writeFileAtomically(this.logPath, "");
    } catch {
      return;
    }
    this.entries = [];
    this.recentEntries = [];
    this.readStamp = "";
    this.latest = undefined;
    this.undoNote = undefined;
    this.waiting = false;
    this.hasLog = false;
    this.hooks.changed();
  }

  /** The Claude Code line: the app's own Electron runs the bundled server as Node (no Node needed). */
  get command(): string {
    return `claude mcp add jongi-nyang -e ELECTRON_RUN_AS_NODE=1 -- "${this.files.exe}" "${this.files.server}"`;
  }

  /** 복사했어요 on the button for a moment. */
  markCopied(): void {
    this.copied = true;
    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => { this.copied = false; this.hooks.changed(); }, 2500);
    this.hooks.changed();
  }

  view(now = new Date()): AiView {
    const enabled = this.enabled;
    if (!enabled && this.recentEntries.length === 0) return { enabled, marks: [], recent: [], command: this.command, copied: this.copied, hasLog: this.hasLog };
    const undoNote = this.undoNote ? { undoNote: this.undoNote } : {};
    const today = dayKey(now);
    const entries = this.recentEntries;
    const undone = undoneIds(entries);
    const items = new Map(this.store.items.map((item) => [item.id.toUpperCase(), item]));
    const marks = enabled ? aiMarks(entries, now, (target, id) => (target === "todos" ? items.get(id.toUpperCase()) : this.store.events.find((event) => event.id === id)) as Record<string, unknown> | undefined) : new Set<string>();
    const recent = recentAi(entries, now).slice(0, 30).map((entry) => {
      const at = new Date(entry.at);
      return { id: entry.id, day: dayKey(at) === today ? "today" as const : "yesterday" as const, time: clock(at.getHours(), at.getMinutes(), lang()), text: aiToastText(entry, lang()), undone: undone.has(entry.id) };
    });
    return { enabled, marks: [...marks], recent, command: this.command, copied: this.copied, hasLog: this.hasLog, ...(enabled && aiExtOutdated(this.entries) ? { outdated: true } : {}), ...undoNote };
  }

  /** Snapshots: a log written by hand, read as if Claude (the current extension) had written it (and already seen: no toast of its own). */
  seedForSnapshots(entries: AiLogEntry[]): void {
    const current = entries.map((entry) => (entry.client === "app" || entry.ext !== undefined ? entry : { ...entry, ext: aiExtVersion }));
    fs.writeFileSync(this.logPath, current.length ? current.map(aiLogLine).join("\n") + "\n" : "", "utf8");
    this.readStamp = "";
    this.read();
    this.seen(advanceSeen(this.seenNow(), this.entries));
    this.hooks.changed();
  }
}
