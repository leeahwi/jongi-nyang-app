import { deskSections, pageOfPane, readPane, shortcutForPane, stepPane, type DeskPage, type DeskPane } from "../core/desk";
import { h, icon, paper, t } from "./api";
import { deskTitle, paneIcon, paneTitle, sectionTitle } from "./deskPanes";

/**
 * 책상's own page: the sidebar (보기 · 설정 · 도움) and a frame per page — 달력, 완료 기록, the
 * settings panes (one page, a tab each) and 도움말 — made the first time it is chosen and kept.
 * The main process says which pane shows ("desk:pane"); a click or ↑ ↓ here asks it to.
 */

const api = paper();
const sidebar = document.querySelector<HTMLElement>(".dside")!;
const main = document.querySelector<HTMLElement>(".dmain")!;
const params = new URLSearchParams(location.search);
let current: DeskPane = readPane(params.get("pane")) ?? "calendar";

const files: Record<DeskPage, string> = { calendar: "calendarWindow.html", history: "history.html", settings: "settings.html", help: "help.html" };
const frames = new Map<DeskPage, HTMLIFrameElement>();
const rows = new Map<DeskPane, HTMLButtonElement>();

interface Extra { day?: string; topic?: string; query?: string }

function frameFor(page: DeskPage, pane: DeskPane, extra: Extra): HTMLIFrameElement {
  const existing = frames.get(page);
  if (existing) return existing;
  const query = new URLSearchParams();
  if (page === "settings") query.set("tab", pane);
  if ((page === "calendar" || page === "history") && extra.day) query.set("day", extra.day);
  if (page === "help" && extra.topic) query.set("topic", extra.topic);
  if (page === "help" && extra.query) query.set("q", extra.query);
  const frame = h("iframe", { class: "pane-frame loading", src: `${files[page]}${query.size ? `?${query}` : ""}`, "data-page": page, title: paneTitle(pane) });
  frame.addEventListener("load", () => frame.classList.remove("loading"), { once: true });
  frames.set(page, frame);
  main.append(frame);
  return frame;
}

function show(pane: DeskPane, extra: Extra = {}): void {
  current = pane;
  const page = pageOfPane(pane);
  frameFor(page, pane, extra);
  for (const [other, frame] of frames) {
    const away = other !== page;
    frame.classList.toggle("away", away);
    frame.toggleAttribute("inert", away);
    if (!away) frame.title = paneTitle(pane);
  }
  for (const [id, row] of rows) {
    row.setAttribute("aria-selected", String(id === pane));
    row.tabIndex = id === pane ? 0 : -1;
  }
  // A key from anywhere (Ctrl+4) while the sidebar has the focus: the focus follows the chosen row.
  if ((document.activeElement as HTMLElement | null)?.classList.contains("drow") && !document.activeElement!.classList.contains("guide")) rows.get(pane)?.focus();
  document.title = deskTitle(pane);
}

function choose(pane: DeskPane, focusRow = false): void {
  show(pane);
  if (focusRow) rows.get(pane)?.focus();
  void api.act({ type: "deskPane", pane });
}

function buildSidebar(): void {
  sidebar.setAttribute("role", "tablist");
  sidebar.setAttribute("aria-orientation", "vertical");
  sidebar.setAttribute("aria-label", t("책상"));
  // 검색 at the top: the note's search slip (Ctrl+F), over everything kept.
  const search = h("button", { class: "drow find", title: t("검색 (Ctrl+F)"), "aria-label": t("검색") }, icon("search", 14), h("span", { class: "dlabel" }, t("검색")), h("kbd", {}, "Ctrl+F"));
  search.addEventListener("click", () => api.act({ type: "openSearch" }));
  sidebar.append(search);
  for (const { section, panes } of deskSections) {
    sidebar.append(h("div", { class: "dhead", role: "presentation" }, h("span", {}, sectionTitle(section))));
    for (const pane of panes) {
      const digit = shortcutForPane(pane);
      const name = paneTitle(pane);
      const row = h("button", { class: "drow", role: "tab", "data-pane": pane, title: digit ? `${name} (Ctrl+${digit})` : pane === "help" ? `${name} (F1)` : name, "aria-label": name },
        icon(paneIcon[pane], 16), h("span", { class: "dlabel" }, name));
      row.addEventListener("click", () => choose(pane));
      rows.set(pane, row);
      sidebar.append(row);
    }
  }
  // 사용 안내: the first-launch cards, shown again on the note.
  const guide = h("button", { class: "drow guide", title: t("사용 안내"), "aria-label": t("사용 안내") }, icon("sparkles", 16), h("span", { class: "dlabel" }, t("사용 안내")));
  guide.addEventListener("click", () => api.act({ type: "openGuide" }));
  sidebar.append(guide);
}

// ↑ ↓ (Home · End) move through the panes while the sidebar has the focus.
sidebar.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (target.classList.contains("guide")) {
    if (event.key === "ArrowUp") { event.preventDefault(); choose("help", true); }
    return;
  }
  if (event.key === "ArrowDown" && current === "help") { event.preventDefault(); sidebar.querySelector<HTMLElement>(".guide")?.focus(); return; }
  const next = event.key === "ArrowDown" ? stepPane(current, 1) : event.key === "ArrowUp" ? stepPane(current, -1)
    : event.key === "Home" ? "calendar" : event.key === "End" ? "help" : undefined;
  if (!next) return;
  event.preventDefault();
  if (next !== current) choose(next, true);
});

api.on("desk:pane", (payload) => {
  const value = payload as { pane?: unknown } & Extra;
  const pane = readPane(value?.pane);
  if (pane) show(pane, value);
});

// Windows: the desk's own title strip (the sidebar runs up to the top; Windows draws − □ × over the
// right end). Snapshots draw those three too, to see the layout.
const chrome = params.get("chrome");
if (chrome === "overlay" || chrome === "preview") {
  document.documentElement.dataset.chrome = chrome;
  const bar = h("div", { class: "dbar", "aria-hidden": "true" });
  if (chrome === "preview") bar.append(h("span", { class: "dcaption" }, h("i", { class: "min" }), h("i", { class: "max" }), h("i", { class: "close" })));
  document.body.append(bar);
}

buildSidebar();
show(current, { day: params.get("day") ?? undefined, topic: params.get("topic") ?? undefined, query: params.get("q") ?? undefined });
