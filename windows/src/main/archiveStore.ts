import fs from "node:fs";
import path from "node:path";
import { dueForArchive, monthKey, parseArchiveLines, toEntry, type ArchiveEntry } from "../core/archive";
import { spaceOf } from "../core/todoSpaces";
import type { Store } from "./store";
import type { TodoItem } from "../core/notebook";
import { t } from "../i18n";
import { appendSafely, readTextIfSafe, tornLineLead, writeFileAtomically } from "./safeFiles";

/**
 * The record of finished tasks: `archive/2026-09.jsonl`, one line per task. Lines are only
 * ever appended, so the files stay small and a crash can at most tear the last line.
 */
export class ArchiveStore {
  readonly directory: string;
  private entries?: ArchiveEntry[];

  constructor(private readonly store: Store, dataDirectory: string) {
    this.directory = path.join(dataDirectory, "archive");
    store.on("prefs", (key: string) => { if (key === "archiveAfterDays") this.run(); });
    // In a shared folder another computer files tasks too: read the record again next time.
    store.on("reloaded", () => { this.entries = undefined; });
  }

  run(now = new Date()): void {
    const due = dueForArchive(this.store.items, now, this.store.prefs.archiveAfterDays);
    if (due.length === 0) return;
    const saved = this.append(due.map((item) => this.entry(item)));
    // Only tasks that actually reached the file leave the list.
    if (saved.size > 0) this.store.mutate((history) => history.archive(saved));
  }

  /** "완료한 일 정리": today's finished tasks go to the record now instead of waiting. Returns the tasks filed. */
  fileToday(): TodoItem[] {
    const done = this.store.todayItems.filter((item) => item.isCompleted);
    if (done.length === 0) return [];
    const saved = this.append(done.map((item) => this.entry(item)));
    if (saved.size > 0) this.store.mutate((history) => history.archive(saved));
    return done.filter((item) => saved.has(item.id)).map((item) => ({ ...item }));
  }

  /**
   * 되돌리기 right after 완료한 일 정리: those lines leave the record again. The only time a line is taken out. #379: the
   * other lines stay byte for byte — a field this version doesn't know, a line it can't read — and a month that can't be
   * written says so (the tasks still come back to the list).
   */
  unfile(ids: ReadonlySet<string>): void {
    let names: string[] = [];
    try { names = fs.readdirSync(this.directory).filter((file) => file.endsWith(".jsonl")); } catch { /* no record yet */ }
    let failed = false;
    for (const name of names) {
      const file = path.join(this.directory, name);
      // #173: a link or an oversized month is left as it is (readTextIfSafe), and the new text never goes through one.
      const text = readTextIfSafe(file);
      if (text === undefined) continue;
      const lines = text.split("\n");
      const kept = lines.filter((line) => !ids.has(lineID(line) ?? ""));
      if (kept.length === lines.length) continue;
      try { writeFileAtomically(file, kept.join("\n")); } catch { failed = true; }
    }
    if (failed) {
      this.store.storageError = `${t("완료 기록에서 되돌리지 못한 일이 있어요. 끝낸 일은 목록으로 돌아왔고, 완료 기록에도 그대로 남아 있어요.")} ${t("저장 폴더가 열리는지 확인해 주세요.")}`;
      this.store.changed();
    }
    this.entries = undefined;
  }

  /** Everything finished: the record plus completed tasks still on the list. */
  all(): ArchiveEntry[] {
    const archived = this.load();
    const archivedIDs = new Set(archived.map((entry) => entry.id));
    const listed = this.store.items.filter((item) => item.isCompleted && !archivedIDs.has(item.id)).map((item) => this.entry(item));
    return [...archived, ...listed];
  }

  /** A finished to-do as its line, with its space then (C5, spaces-phase2.md 2c; none for 일반). */
  private entry(item: TodoItem): ArchiveEntry {
    return toEntry(item, spaceOf(this.store.todoSpaces, item.id));
  }

  seed(entries: ArchiveEntry[]): void {
    this.append(entries);
  }

  private append(entries: ArchiveEntry[]): Set<string> {
    const known = new Set(this.load().map((entry) => entry.id));
    const saved = new Set<string>();
    const byMonth = new Map<string, ArchiveEntry[]>();
    for (const entry of entries) {
      if (known.has(entry.id)) { saved.add(entry.id); continue; }
      const list = byMonth.get(monthKey(entry)) ?? [];
      list.push(entry);
      byMonth.set(monthKey(entry), list);
    }
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      for (const [month, list] of byMonth) {
        const file = path.join(this.directory, `${month}.jsonl`);
        // #378: after a torn last line the new lines start on their own (joined to it, both would be unreadable).
        appendSafely(file, tornLineLead(file) + list.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
        for (const entry of list) { saved.add(entry.id); this.entries?.push(entry); }
      }
    } catch {
      this.store.storageError = `${t("완료 기록을 저장하지 못했어요. 끝낸 일은 목록에 그대로 둘게요.")} ${t("저장 폴더가 열리는지 확인해 주세요.")}`;
      this.store.changed();
    }
    return saved;
  }

  private load(): ArchiveEntry[] {
    if (this.entries) return this.entries;
    const entries: ArchiveEntry[] = [];
    try {
      for (const name of fs.readdirSync(this.directory).filter((file) => file.endsWith(".jsonl")).sort()) {
        // #173: a link, or a month past the size limit, is not read (it reads as no lines).
        entries.push(...parseArchiveLines(readTextIfSafe(path.join(this.directory, name)) ?? ""));
      }
    } catch {
      // No record yet.
    }
    this.entries = entries;
    return entries;
  }
}

/** A record line's id, read only for that (undefined for a line that isn't one, such as a torn last line). */
function lineID(line: string): string | undefined {
  try {
    const value = JSON.parse(line) as { id?: unknown } | null;
    return typeof value?.id === "string" ? value.id : undefined;
  } catch {
    return undefined;
  }
}
