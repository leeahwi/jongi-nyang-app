import { folderName, lastFolderOf, shownColor, visibleFolders } from "../core/memoDrawer";
import { bodyFontSize, type AppState, type PrefsState } from "../core/types";
import { h, icon, lang, paper, t } from "./api";
import { appear, fitWindow, keyHint, slipButton, slipHead, tape } from "./slip";

/**
 * 빠른 메모: a few lines written anywhere, on a lavender-taped slip with ruled lines. Ctrl+Enter
 * adds them at the top of the folder on the chip (#117: the drawer's last folder unless another is picked) and closes;
 * Ctrl+Alt+Enter adds them and keeps the slip open, empty, for the next. Esc or clicking elsewhere closes and keeps the
 * text (the main process saves it as the draft).
 */
const api = paper();
const stage = document.getElementById("stage")!;
const card = document.getElementById("card")!;
const editor = h("textarea", { class: "ruled", spellcheck: "false", "aria-label": t("빠른 메모"), placeholder: t("떠오른 생각을 적어요") });
let draftTimer: number | undefined;
let state: AppState | undefined;
/** The folder the memo goes into; undefined: the drawer's last one. */
let folder: string | undefined;

function close(): void {
  window.clearTimeout(draftTimer);
  closeList();
  api.send("quickMemo:close", editor.value);
}

/** Ctrl+Enter (or 넣기); `keep` (Ctrl+Alt+Enter, Craft's 넣고 계속): the slip stays open, empty, on the same folder. */
function save(keep = false): void {
  window.clearTimeout(draftTimer);
  closeList();
  const text = editor.value;
  if (keep && !text.trim()) return;
  if (text.trim()) editor.value = "";
  api.send("quickMemo:save", text, currentFolder(), keep);
  if (keep) editor.focus();
}

// ─── The folder chip (#117) ─────────────────────────────────────────────────────

const folders = () => (state ? visibleFolders(state.memoFolders) : []);
const currentFolder = (): string | undefined => {
  if (!state) return undefined;
  const shown = folders();
  return shown.some((entry) => entry.id === folder) ? folder : lastFolderOf(state.memoFolders, state.prefs.drawerLastFolder);
};

const chipSquare = h("span", { class: "qm-sq", "aria-hidden": "true" });
const chipName = h("span", { class: "qm-name" });
const chipButton = h("button", { class: "qm-folder", "aria-haspopup": "listbox", "aria-expanded": "false", title: t("넣을 폴더") },
  chipSquare, chipName, h("span", { class: "qm-chev", "aria-hidden": "true" }, icon("chevron", 9, 2)));
const list = h("div", { class: "qm-list", role: "listbox", "aria-label": t("넣을 폴더"), hidden: "" });

function renderChip(): void {
  const id = currentFolder();
  const entry = folders().find((candidate) => candidate.id === id);
  const name = entry ? folderName(entry, lang()) : "";
  chipSquare.className = `qm-sq fc-${shownColor(entry?.color ?? "lavender")}`;
  chipName.textContent = name;
  chipButton.setAttribute("aria-label", `${t("넣을 폴더")}, ${name}`);
}

function openList(): void {
  const id = currentFolder();
  list.replaceChildren(...folders().map((entry) => {
    const on = entry.id === id;
    const row = h("div", { class: `qm-row${on ? " on" : ""}`, role: "option", "aria-selected": String(on), tabindex: "-1", "data-id": entry.id },
      h("span", { class: `qm-sq fc-${shownColor(entry.color)}`, "aria-hidden": "true" }), h("span", { class: "qm-row-name" }, folderName(entry, lang())),
      on ? h("span", { class: "qm-tick", "aria-hidden": "true" }, icon("check", 11, 2.2)) : null);
    row.addEventListener("mousedown", (event) => event.preventDefault());
    row.addEventListener("click", () => pick(entry.id));
    return row;
  }));
  list.hidden = false;
  chipButton.setAttribute("aria-expanded", "true");
  (list.querySelector<HTMLElement>(".qm-row.on") ?? list.querySelector<HTMLElement>(".qm-row"))?.focus();
}

function closeList(): void {
  if (list.hidden) return;
  list.hidden = true;
  chipButton.setAttribute("aria-expanded", "false");
}

function pick(id: string): void {
  folder = id;
  renderChip();
  closeList();
  editor.focus();
}

chipButton.addEventListener("click", () => (list.hidden ? openList() : (closeList(), editor.focus())));
list.addEventListener("keydown", (event) => {
  const rows = [...list.querySelectorAll<HTMLElement>(".qm-row")];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    rows[event.key === "Home" ? 0 : rows.length - 1]?.focus();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    const id = (document.activeElement as HTMLElement | null)?.dataset.id;
    if (id) pick(id);
  } else if (event.key === "Escape" || event.key === "Tab") {
    event.preventDefault();
    event.stopPropagation();
    closeList();
    editor.focus();
  }
});

const head = slipHead({ icon: "note", tint: "memo", title: t("빠른 메모"), context: `· ${t("쓰던 글은 남아요")}`, onClose: close });
const addButton = slipButton(t("넣기"), "primary", () => save(), "Ctrl+↩");
addButton.title = t("Ctrl+Enter 넣기 · Ctrl+Alt+Enter 넣고 계속 적기");
// #119: its name without the key cap's text run into it (`넣기Ctrl+↩`); the keys are its description.
addButton.setAttribute("aria-label", t("넣기"));
addButton.setAttribute("aria-description", addButton.title);
card.append(tape("memo"), head.element, h("div", { class: "memo-body" }, editor, list),
  h("div", { class: "slip-foot" }, chipButton, h("span", { class: "keys" }, keyHint("Esc", t("닫기"))), h("span", { class: "spacer" }), addButton));
fitWindow(stage);

editor.addEventListener("input", () => {
  // Kept as the draft as it is written, so nothing is lost if the app is closed meanwhile.
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => api.send("quickMemo:draft", editor.value), 600);
});
editor.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault();
    save(event.altKey);
  } else if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
});

function applyFont(next: PrefsState): void {
  document.documentElement.dataset.font = next.prefs.font;
  document.documentElement.style.setProperty("--body-size", `${bodyFontSize(next.prefs.font, "regular")}px`);
}

/** The folders for the chip: read whole when the slip opens (this page hears only the settings as they change, #71). */
function takeState(next: AppState): void {
  state = next;
  applyFont(next);
  renderChip();
}

api.on("state:prefs", (next) => { if (state) state = { ...state, ...(next as PrefsState) }; applyFont(next as PrefsState); });
api.on("quickMemo:blur", close);
api.on("quickMemo:open", (payload) => {
  const { text, copied } = (payload ?? {}) as { text?: string; copied?: boolean };
  editor.value = text ?? "";
  // Each time it opens: the drawer's last folder again (and the folders as they are now).
  void api.getState().then(takeState);
  folder = undefined;
  closeList();
  renderChip();
  // Copied text put in: said in the header, and selected so typing replaces it.
  head.context.textContent = copied ? `· ${t("복사한 글을 넣었어요")}` : `· ${t("쓰던 글은 남아요")}`;
  appear(card);
  editor.focus();
  if (copied) editor.select(); else editor.setSelectionRange(editor.value.length, editor.value.length);
});
void api.getState().then(takeState);

// Snapshots reach in here (the main process runs these in the page).
(window as unknown as Record<string, unknown>).quickMemoTest = {
  folders: () => openList(),
  pick: (id: string) => { folder = id; renderChip(); },
};
