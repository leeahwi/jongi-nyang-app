/**
 * 책상 (the desk): one window whose sidebar holds what used to be five windows — 달력, 완료 기록,
 * 설정 (its tabs as panes of their own) and 도움말. The same order and shortcuts as the Mac's desk:
 * Ctrl+1 … Ctrl+9 go down the sidebar from 달력 to 저장과 백업 (메모 서랍, 스페이스 and AI 연결 after it have none); 도움말
 * is F1; 사용 안내 (the first-launch guide, shown on the note) sits under 도움말 and is an action, not a pane.
 */

export type DeskPane = "calendar" | "history" | "clock" | "appearance" | "notifications" | "repeat" | "pet" | "events" | "storage" | "drawer" | "spaces" | "ai" | "help";

/** The panes drawn by the settings page (settings.html): Settings' old tabs, 시계, 저장과 백업, 메모 서랍 (1.28), 스페이스 (1.30) and AI 연결 (1.27). */
export type SettingsTab = "clock" | "appearance" | "notifications" | "repeat" | "pet" | "events" | "storage" | "drawer" | "spaces" | "ai";

export type DeskSection = "view" | "settings" | "help";

/** The sidebar, top to bottom: 보기 · 설정 · 도움. */
export const deskSections: { section: DeskSection; panes: DeskPane[] }[] = [
  { section: "view", panes: ["calendar", "history", "clock"] },
  { section: "settings", panes: ["appearance", "notifications", "repeat", "pet", "events", "storage", "drawer", "spaces", "ai"] },
  { section: "help", panes: ["help"] },
];

export const deskPanes: DeskPane[] = deskSections.flatMap((entry) => entry.panes);

export const settingsTabs: SettingsTab[] = ["clock", "appearance", "notifications", "repeat", "pet", "events", "storage", "drawer", "spaces", "ai"];

export const isSettingsTab = (pane: DeskPane): pane is SettingsTab => (settingsTabs as DeskPane[]).includes(pane);

/** The page that draws a pane: one page for every settings pane. */
export type DeskPage = "calendar" | "history" | "settings" | "help";
export const pageOfPane = (pane: DeskPane): DeskPage => (isSettingsTab(pane) ? "settings" : pane as DeskPage);

/** Ctrl+N inside the desk: the Nth pane of the sidebar (1–9), or nothing. */
export function paneForShortcut(digit: number): DeskPane | undefined {
  return Number.isInteger(digit) && digit >= 1 && digit <= 9 ? deskPanes[digit - 1] : undefined;
}

/** The digit that opens a pane with Ctrl, when it has one. */
export function shortcutForPane(pane: DeskPane): number | undefined {
  const index = deskPanes.indexOf(pane);
  return index >= 0 && index < 9 ? index + 1 : undefined;
}

/** ↑ / ↓ in the sidebar: the pane before or after, stopping at the ends. */
export function stepPane(pane: DeskPane, step: 1 | -1): DeskPane {
  const index = deskPanes.indexOf(pane);
  return deskPanes[Math.min(deskPanes.length - 1, Math.max(0, (index < 0 ? 0 : index) + step))];
}

/**
 * A pane named by a caller (an IPC action, a saved choice, a query string). The old settings tab
 * names still work: "calendar" as a settings tab was 캘린더, now the pane 일정 ("events").
 */
export function readPane(value: unknown, settingsTab = false): DeskPane | undefined {
  if (typeof value !== "string") return undefined;
  if (settingsTab && value === "calendar") return "events";
  return (deskPanes as string[]).includes(value) ? value as DeskPane : undefined;
}

/** The desk's size: 920 × 640 at first, never under 760 × 520; the sidebar folds to icons under 820. */
export const deskSize = { width: 920, height: 640, minWidth: 760, minHeight: 520, foldBelow: 820 };
/**
 * On Windows the desk draws its own title strip (paper-coloured, the native − □ × over it via
 * titleBarOverlay), this tall; its window is that much taller, so the panes keep their size.
 */
export const deskTitleBar = 36;
/** The symbols' colour on the desk's title strip (ink-2 of the paper). */
export const paperInk2 = (night: boolean): string => (night ? "#bdb7a7" : "#6b685e");

/** A remembered frame, kept only when it is at least the minimum (else the default size). */
export function deskFrame(saved: { x?: number; y?: number; width?: number; height?: number } | undefined): { width: number; height: number; x?: number; y?: number } {
  const width = Math.max(deskSize.minWidth, Math.round(saved?.width ?? deskSize.width));
  const height = Math.max(deskSize.minHeight, Math.round(saved?.height ?? deskSize.height));
  return typeof saved?.x === "number" && typeof saved?.y === "number" ? { width, height, x: Math.round(saved.x), y: Math.round(saved.y) } : { width, height };
}

// ─── 밤 종이 ──────────────────────────────────────────────────────────────────

export type PaperSetting = "auto" | "day" | "night";
export const paperSettings: PaperSetting[] = ["auto", "day", "night"];
export const readPaper = (value: unknown): PaperSetting => (value === "day" || value === "night" ? value : "auto");

/** Night paper or not: the setting, or (자동) what the system's appearance says. */
export const isNight = (setting: PaperSetting, systemDark: boolean): boolean => (setting === "auto" ? systemDark : setting === "night");

/** The sheet's colour, for a window's background before its page has drawn (no white flash). */
export const paperColor = (night: boolean): string => (night ? "#2a2924" : "#fbf9f3");

/** Electron's nativeTheme.themeSource for a setting: the title bars, menus and scrollbars follow it. */
export const themeSource = (setting: PaperSetting): "system" | "light" | "dark" => (setting === "auto" ? "system" : setting === "day" ? "light" : "dark");
