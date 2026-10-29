import type { Lang } from "./lang";

/**
 * Where the list lives. By default next to the settings (%APPDATA%\PaperTodo); a chosen folder
 * (OneDrive, Dropbox, iCloud Drive…) lets several computers share one list. Only the data moves
 * there — todos.json, memos.json, repeats.json, events.json, alarms.json, memo-folders.json (메모 서랍, 1.28) and archive/ —
 * settings stay on each device.
 * The chosen folder is kept in storage.json beside settings.json.
 */
export const sharedFiles = ["todos.json", "memos.json", "repeats.json", "events.json", "alarms.json", "memo-folders.json"] as const;
export type SharedFile = typeof sharedFiles[number];
export const storageFileName = "storage.json";

export function parseStorageFile(text: string): string | undefined {
  try {
    const value = JSON.parse(text) as { folder?: unknown };
    return typeof value.folder === "string" && value.folder.trim() ? value.folder : undefined;
  } catch {
    return undefined;
  }
}

export function serializeStorageFile(folder: string | undefined): string {
  return JSON.stringify(folder ? { folder } : {}, null, 2) + "\n";
}

/** Windows paths compare without case and without a trailing separator. */
export function sameFolder(a: string, b: string, windows = true): boolean {
  const normal = (value: string) => {
    const trimmed = value.replace(/[\\/]+$/, "");
    return windows ? trimmed.replace(/\//g, "\\").toLowerCase() : trimmed;
  };
  return normal(a) === normal(b);
}

/**
 * "이 PC (기본)", or the chosen folder with the home folder shortened to ~. en "This PC (default)",
 * nl "Deze pc (standaard)" ("This Mac", "Deze Mac").
 */
export function storageLabel(folder: string | undefined, home: string, windows = true, device: "PC" | "Mac" = windows ? "PC" : "Mac", lang: Lang = "ko"): string {
  if (!folder) {
    if (lang === "en") return `This ${device} (default)`;
    if (lang === "nl") return `Deze ${device === "PC" ? "pc" : "Mac"} (standaard)`;
    return `이 ${device} (기본)`;
  }
  const separator = windows ? "\\" : "/";
  if (home && (sameFolder(folder, home, windows) || folder.toLowerCase().startsWith((home.replace(/[\\/]+$/, "") + separator).toLowerCase()))) {
    const rest = folder.slice(home.replace(/[\\/]+$/, "").length).replace(/^[\\/]+/, "");
    return rest ? `~${separator}${rest}` : "~";
  }
  return folder;
}
