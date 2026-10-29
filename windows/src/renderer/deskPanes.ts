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
    case "drawer": return t("메모 서랍");
    case "spaces": return t("스페이스");
    case "ai": return t("AI 연결");
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

/** Each pane's line icon in the sidebar (icons.ts), the same shapes as the Mac's (docs/icons.md). */
export const paneIcon: Record<DeskPane, string> = {
  calendar: "calendar", history: "leaf", clock: "alarm", appearance: "brush", notifications: "bell", repeat: "repeat",
  pet: "cat", events: "calendarClock", storage: "archive", drawer: "pawPrint", spaces: "spaces", ai: "chat", help: "help",
};

/** "책상 — 달력": the window's title for the pane it shows. */
/** The window title: the pane's own name, nothing joined to it ("알림", not "책상 — 알림") (#73). */
export const deskTitle = (pane: DeskPane): string => paneTitle(pane);
