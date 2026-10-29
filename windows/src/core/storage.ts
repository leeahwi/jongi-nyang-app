import type { Lang } from "./lang";

/**
 * Where the list lives. By default next to the settings (%APPDATA%\PaperTodo); a chosen folder
 * (OneDrive, Dropbox, iCloud Drive…) lets several computers share one list. Only the data moves
 * there — todos.json, memos.json, repeats.json, events.json, alarms.json, memo-folders.json (메모 서랍, 1.28), todo-spaces.json (할 일 스페이스, 1.30) and archive/ —
 * settings stay on each device.
 * The chosen folder is kept in storage.json beside settings.json.
 */
export const sharedFiles = ["todos.json", "memos.json", "repeats.json", "events.json", "alarms.json", "memo-folders.json", "todo-spaces.json"] as const;
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

/**
 * 저장과 백업 (1.30): a folder's place said the way Explorer's and Finder's path bars say it — the folder's own name,
 * and the places it is in before it, the home folder as `~` and a cloud drive by its name ("OneDrive › 종이냥"), never
 * the raw path in a code font. The full path stays in the tooltip. The same rules as the Mac's FolderPlace.
 */
export interface FolderPlace {
  /** The places before the folder, outermost first: ["~", "AppData", "Roaming"], ["OneDrive"]. */
  lead: string[];
  /** The folder's own name. */
  name: string;
  /** The cloud drive it is in ("iCloud Drive", "OneDrive", "Dropbox", "Google Drive"), if any. */
  cloud?: string;
}

/** The breadcrumb's separator. */
export const placeSeparator = " › ";

/** "OneDrive", "OneDrive - Company", "OneDrive-Personal" → OneDrive; "Dropbox (Personal)" → Dropbox; "iCloudDrive" → iCloud Drive. */
function cloudName(folder: string): string | undefined {
  const lower = folder.toLowerCase();
  if (lower === "onedrive" || lower.startsWith("onedrive-") || lower.startsWith("onedrive ")) return "OneDrive";
  if (lower === "dropbox" || lower.startsWith("dropbox-") || lower.startsWith("dropbox ")) return "Dropbox";
  if (lower === "icloud drive" || lower === "iclouddrive") return "iCloud Drive";
  if (lower.startsWith("googledrive")) return "Google Drive";
  return undefined;
}

function placed(parts: string[], root: string[], cloud?: string): FolderPlace {
  const name = parts[parts.length - 1];
  // The drive's own top folder: its name alone.
  if (name === undefined) return { lead: root.slice(0, -1), name: root[root.length - 1] ?? "\\", ...(cloud ? { cloud } : {}) };
  return { lead: [...root, ...parts.slice(0, -1)], name, ...(cloud ? { cloud } : {}) };
}

/** Where `folder` is, with `home` (os.homedir()) as `~` and the cloud drives by name. */
export function folderPlace(folder: string, home: string, windows = true): FolderPlace {
  const split = (value: string) => value.split(windows ? /[\\/]+/ : /\/+/).filter(Boolean);
  const parts = split(folder);
  const homeParts = split(home);
  if (!parts.length) return { lead: [], name: windows ? "\\" : "/" };
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  const inHome = homeParts.length > 0 && parts.length >= homeParts.length && homeParts.every((part, index) => same(part, parts[index]));
  if (!inHome) {
    // Google Drive for desktop: G:\My Drive\… (its own drive letter).
    if (windows && parts.length >= 2 && /^[a-z]:$/i.test(parts[0]) && same(parts[1], "My Drive")) return placed(parts.slice(2), ["Google Drive", "My Drive"], "Google Drive");
    return placed(parts, []);
  }
  const rest = parts.slice(homeParts.length);
  if (!rest.length) return { lead: [], name: "~" };
  if (!windows && rest.length >= 3 && rest[0] === "Library" && rest[1] === "Mobile Documents" && rest[2] === "com~apple~CloudDocs") {
    return placed(rest.slice(3), ["iCloud Drive"], "iCloud Drive");
  }
  if (!windows && rest.length >= 3 && rest[0] === "Library" && rest[1] === "CloudStorage") {
    const cloud = cloudName(rest[2]);
    if (cloud) return placed(rest.slice(3), [cloud], cloud);
  }
  const cloud = cloudName(rest[0]);
  if (cloud) return placed(rest.slice(1), [cloud], cloud);
  return placed(rest, ["~"]);
}

/** "~ › AppData › Roaming › PaperTodo". */
export const placeText = (place: FolderPlace): string => [...place.lead, place.name].join(placeSeparator);
