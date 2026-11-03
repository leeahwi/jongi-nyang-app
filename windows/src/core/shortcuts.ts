import { defaultDrawerShortcut } from "./memoDrawer";

/**
 * Keys from any app (#85): the note's 보이기 · 숨기기 and the drawer's 열고 닫기 can be changed, 빠른 입력 Ctrl+Alt+N
 * and 빠른 메모 Ctrl+Alt+M can't. Which keys each may take, the note's saved key, when its key hides it, and the
 * keys as caps for the shortcut list (#86). Same rules and cases as the Mac (PaperCore/GlobalShortcut.swift,
 * ShortcutTests.swift: S1–S14). Keys are Electron accelerators, modifiers in the order readShortcut writes them.
 */

export const quickEntryShortcut = "Control+Alt+N";
export const quickMemoShortcut = "Control+Alt+M";
/** Where the note's key starts, and what ‘기본값’ brings back. */
export const defaultNoteShortcut = "Control+Alt+J";

export type ShortcutUser = "quickEntry" | "quickMemo" | "note" | "drawer";

/** The two changeable keys as they are now: the note's chosen key (kept while its switch is off), the drawer's ("" = off). */
export interface ChosenKeys { note: string; drawer: string }

/**
 * Who already has `accelerator` when `user` asks for it, or undefined when it's free. 빠른 입력 and 빠른 메모 always
 * hold theirs; the note and the drawer never take each other's chosen key, nor each other's default (so ‘기본값’
 * always works).
 */
export function takenBy(accelerator: string, user: ShortcutUser, keys: ChosenKeys): ShortcutUser | undefined {
  if (accelerator === quickEntryShortcut) return "quickEntry";
  if (accelerator === quickMemoShortcut) return "quickMemo";
  if (user === "note" && (accelerator === defaultDrawerShortcut || (keys.drawer !== "" && accelerator === keys.drawer))) return "drawer";
  if (user === "drawer" && (accelerator === defaultNoteShortcut || accelerator === keys.note)) return "note";
  return undefined;
}

/** The keys `user` may not take now (readShortcut refuses them). */
export function refusedFor(user: ShortcutUser, keys: ChosenKeys): string[] {
  const others = user === "note" ? [defaultDrawerShortcut, keys.drawer] : user === "drawer" ? [defaultNoteShortcut, keys.note] : [];
  return [...new Set([quickMemoShortcut, quickEntryShortcut, ...others].filter(Boolean))];
}

/** A key from any app needs Ctrl, Alt or Win (Shift alone isn't enough), F-keys aside. */
export function hasModifier(accelerator: string): boolean {
  const parts = accelerator.split("+");
  return parts.some((part) => part === "Control" || part === "Alt" || part === "Super") || /^F\d+$/.test(parts[parts.length - 1] ?? "");
}

/**
 * The note's key as saved: what was chosen, or Ctrl+Alt+J when nothing was (before 1.30.1), it can't be read, or
 * another holds it now.
 */
export function readNoteShortcut(value: unknown, drawer: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9+`\-=[\]\\;',./]+$/.test(value) || !hasModifier(value)) return defaultNoteShortcut;
  return takenBy(value, "note", { note: defaultNoteShortcut, drawer }) ? defaultNoteShortcut : value;
}

/**
 * What the note's key does (#85): the note on screen goes away at once, even with another app in front; otherwise
 * it comes forward (unfolded from the sticky note). On screen: shown, not minimised, not folded into the sticky
 * note. Windows can't tell whether other windows cover it (Electron has no occlusion state), so a covered note
 * counts as on screen here and the first press puts it away; the Mac passes `uncovered` from macOS.
 */
export function noteToggle(state: { visible: boolean; minimized: boolean; folded: boolean; uncovered?: boolean }): "hide" | "show" {
  return state.visible && !state.minimized && !state.folded && state.uncovered !== false ? "hide" : "show";
}

/** An accelerator as key caps, one per key: "Control+Shift+D" → ["Ctrl", "Shift", "D"] (arrows as arrows, Super as Win). */
export function keyCaps(accelerator: string): string[] {
  const names: Record<string, string> = { Control: "Ctrl", Super: "Win", Up: "↑", Down: "↓", Left: "←", Right: "→" };
  return accelerator ? accelerator.split("+").map((part) => names[part] ?? part) : [];
}
