import fs from "node:fs";

/**
 * AI 연결's write lock (ai-write.lock in the settings folder, this device only): the extension and the app
 * hold it for the few milliseconds of a read–change–write, so the two never write todos.json from the same
 * stale copy. Taken by creating the file exclusively; one older than `staleMs` was left by a process that
 * stopped and is taken over. Waiting never blocks for long: after `waitMs` the writer goes on without it
 * (the re-read before every write still protects the file). Plain node, used by src/main/store.ts and mcp/.
 */

const sleeper = new Int32Array(new SharedArrayBuffer(4));
const pause = (ms: number) => Atomics.wait(sleeper, 0, 0, ms);

export interface LockOptions { waitMs?: number; staleMs?: number }

/** Takes the lock, or undefined after `waitMs` without it. The returned function lets it go. */
export function takeLock(file: string, { waitMs = 2000, staleMs = 3000 }: LockOptions = {}): (() => void) | undefined {
  const token = `${process.pid} ${Date.now()} ${Math.random().toString(36).slice(2)}`;
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(file, token, { flag: "wx" });
      return () => {
        try { if (fs.readFileSync(file, "utf8") === token) fs.unlinkSync(file); } catch { /* already gone */ }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return undefined; // no such folder, read-only: go on without
    }
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > staleMs) { fs.unlinkSync(file); continue; }
    } catch { continue; } // let go meanwhile
    if (Date.now() >= until) return undefined;
    pause(2 + Math.floor(Math.random() * 3));
  }
}

/** Runs `work` holding the lock (or without it, see takeLock). */
export function withLock<T>(file: string | undefined, work: () => T, options?: LockOptions): T {
  const release = file ? takeLock(file, options) : undefined;
  try { return work(); } finally { release?.(); }
}
