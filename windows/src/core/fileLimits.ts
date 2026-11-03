/**
 * How big a file the apps and 종이냥 for Claude read (#173, security review L-05). A file is read whole and then parsed,
 * so memory grows to a few times its size; past these it is refused untouched, with a message, and what is on the list
 * stays as it is. The same numbers as the Mac's (PaperCore FileLimits.swift) — both tests read them from
 * docs/plans/file-safety-cases.json.
 */
export const fileLimits = {
  /** A .jongi (가져오기, 되돌리기, the backup list's counts). */
  backupBytes: 64 * 1024 * 1024,
  /** One data file in the storage folder (todos.json, memos.json, archive/2026-10.jsonl …). */
  dataFileBytes: 32 * 1024 * 1024,
} as const;

/** "64MB", for the messages. */
export const megabytes = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))}MB`;
