import type { DeskPane, DeskSection } from "../core/desk";
import { t } from "../i18n";

/** The desk's words, shared by its page (the sidebar) and the main process (the window's title). */

export function paneTitle(pane: DeskPane): string {
  switch (pane) {
    case "calendar": return t("달력");
    case "history": return t("완료 기록");
    case "clock": return t("시계");
    case "appearance": return t("꾸미기");
    case "notifications": return t("알림");
    case "repeat": return t("반복");
    case "pet": return t("종이냥", undefined, "pane");
    case "events": return t("일정");
    case "storage": return t("저장과 백업");
    case "help": return t("도움말");
  }
}

export function sectionTitle(section: DeskSection): string {
  switch (section) {
    case "view": return t("보기", undefined, "desk");
    case "settings": return t("설정");
    case "help": return t("도움");
  }
}

/** Each pane's line icon in the sidebar (icons.ts). */
export const paneIcon: Record<DeskPane, string> = {
  calendar: "calendar", history: "sprout", clock: "alarm", appearance: "gear", notifications: "bell", repeat: "repeat",
  pet: "paw", events: "calendarDot", storage: "box", help: "help",
};

/** "책상 — 달력": the window's title for the pane it shows. */
export const deskTitle = (pane: DeskPane): string => t("책상 — {pane}", { pane: paneTitle(pane) });
