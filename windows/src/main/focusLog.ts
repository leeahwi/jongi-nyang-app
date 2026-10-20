import fs from "node:fs";
import path from "node:path";
import { focusFileName, focusLine, parseFocus, type FocusRecord } from "../core/focus";

/**
 * 집중 기록: focus.jsonl in the storage folder, one line per session (see core/focus.ts). Lines are
 * only ever appended, so another computer sharing the folder can add its own; the file is read
 * again whenever it changed on disk (by its size and time), so their sessions show too.
 */
export class FocusLog {
  readonly file: string;
  private cache?: { stamp: string; records: FocusRecord[] };

  constructor(dataDirectory: string, private readonly failed: (message: string) => void) {
    this.file = path.join(dataDirectory, focusFileName);
  }

  /** Adds a session; false when it couldn't be written (the storage problem is shown). */
  append(record: FocusRecord): boolean {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      let lead = "";
      try {
        const size = fs.statSync(this.file).size;
        if (size > 0) {
          const handle = fs.openSync(this.file, "r");
          const last = Buffer.alloc(1);
          fs.readSync(handle, last, 0, 1, size - 1);
          fs.closeSync(handle);
          if (last.toString() !== "\n") lead = "\n";
        }
      } catch { /* a new file */ }
      fs.appendFileSync(this.file, `${lead}${focusLine(record)}\n`, "utf8");
      this.cache = undefined;
      return true;
    } catch {
      this.failed(this.file);
      return false;
    }
  }

  /** Every session in the file (none when there is no file yet). */
  all(): FocusRecord[] {
    let stamp: string;
    try { const stat = fs.statSync(this.file); stamp = `${stat.size}:${stat.mtimeMs}`; } catch { return []; }
    if (this.cache?.stamp === stamp) return this.cache.records;
    let records: FocusRecord[] = [];
    try { records = parseFocus(fs.readFileSync(this.file, "utf8")); } catch { /* unreadable now: none */ }
    this.cache = { stamp, records };
    return records;
  }
}
