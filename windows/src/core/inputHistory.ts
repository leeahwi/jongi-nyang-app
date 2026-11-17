/**
 * #528: ↑ · ↓ in the input line bring back the lines put in before, newest first (shared/cases/input-history-cases.json,
 * the Mac's PaperCore/InputHistory.swift). The walk starts only on an empty line and goes on while the line still shows
 * the line it brought back; once that is changed, ↑ · ↓ are the field's own again (the caret moves). Kept on this device.
 */
export const inputHistoryLimit = 50;

export class InputHistory {
  /** Oldest first. */
  entries: string[];
  /** The entry the line shows now (undefined: not walking). */
  private index?: number;

  constructor(entries: readonly string[] = []) {
    this.entries = entries.filter((entry) => typeof entry === "string").slice(-inputHistoryLimit);
  }

  /** A line was put in: the newest entry (the same line again moves up, kept once). Ends any walk. */
  add(line: string): void {
    this.index = undefined;
    const trimmed = line.trim();
    if (!trimmed) return;
    this.entries = this.entries.filter((entry) => entry !== trimmed);
    this.entries.push(trimmed);
    if (this.entries.length > inputHistoryLimit) this.entries = this.entries.slice(-inputHistoryLimit);
  }

  /** ↑ (`up`) or ↓ with the line holding `text`: the line's new text, or null when the key is the field's own. */
  step(up: boolean, text: string): string | null {
    const at = this.index;
    if (at !== undefined && at < this.entries.length && this.entries[at] === text) {
      if (up) {
        this.index = Math.max(0, at - 1);
        return this.entries[this.index]!;
      }
      if (at + 1 < this.entries.length) {
        this.index = at + 1;
        return this.entries[at + 1]!;
      }
      this.index = undefined;
      return "";
    }
    this.index = undefined;
    if (!up || text !== "" || this.entries.length === 0) return null;
    this.index = this.entries.length - 1;
    return this.entries[this.index]!;
  }
}
