import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Every folder the tests make in the system's temporary folder (#278). Each test file runs in its own process
 * (`node --test`), and when that process ends, pass or fail, the folders it made here go too. Made with
 * `fs.mkdtempSync` alone they stayed behind: more than 32,000 of them after a few weeks of checks.
 */
const made = new Set<string>();

/** A new empty folder, `<temporary folder>/<prefix>XXXXXX`, removed when this test file's process ends. */
export function temporaryFolder(prefix: string): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.add(folder);
  return folder;
}

process.on("exit", () => {
  for (const folder of made) {
    // A file still open (Windows) keeps its folder: the system clears its temporary folder in time.
    try { fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 }); } catch { /* left for the system */ }
  }
});
