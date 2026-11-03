import fs from "node:fs";
import path from "node:path";
import { dueForArchive, monthKey, parseArchiveLines, toEntry, type ArchiveEntry } from "../core/archive";
import type { Store } from "./store";
import type { TodoItem } from "../core/notebook";
import { t } from "../i18n";
import { appendSafely, readTextIfSafe, writeFileAtomically } from "./safeFiles";

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
    const saved = this.append(due.map(toEntry));
    // Only tasks that actually reached the file leave the list.
    if (saved.size > 0) this.store.mutate((history) => history.archive(saved));
  }

  /** "완료한 일 정리": today's finished tasks go to the record now instead of waiting. Returns the tasks filed. */
  fileToday(): TodoItem[] {
    const done = this.store.todayItems.filter((item) => item.isCompleted);
    if (done.length === 0) return [];
    const saved = this.append(done.map(toEntry));
    if (saved.size > 0) this.store.mutate((history) => history.archive(saved));
    return done.filter((item) => saved.has(item.id)).map((item) => ({ ...item }));
  }

  /**
   * 되돌리기 right after 완료한 일 정리: those lines leave the record again (each month file written
   * anew without them). The only time a line is taken out.
   */
  unfile(ids: ReadonlySet<string>): void {
    try {
      for (const name of fs.readdirSync(this.directory).filter((file) => file.endsWith(".jsonl"))) {
        const file = path.join(this.directory, name);
        // #173: a link or an oversized month is left as it is (readTextIfSafe), and the new text never goes through one.
        const text = readTextIfSafe(file);
        if (text === undefined) continue;
        const kept = parseArchiveLines(text).filter((entry) => !ids.has(entry.id));
        if (kept.length === parseArchiveLines(text).length) continue;
        writeFileAtomically(file, kept.map((entry) => JSON.stringify(entry)).join("\n") + (kept.length ? "\n" : ""));
      }
    } catch {
      // The record stays as it is; the tasks still come back to the list.
    }
    this.entries = undefined;
  }

  /** Everything finished: the record plus completed tasks still on the list. */
  all(): ArchiveEntry[] {
    const archived = this.load();
    const archivedIDs = new Set(archived.map((entry) => entry.id));
    const listed = this.store.items.filter((item) => item.isCompleted && !archivedIDs.has(item.id)).map(toEntry);
    return [...archived, ...listed];
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
        appendSafely(path.join(this.directory, `${month}.jsonl`), list.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
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
