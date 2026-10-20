import { bodyFontSize, type AppState } from "../core/types";
import { h, paper, t } from "./api";
import { appear, fitWindow, keyHint, slipButton, slipHead, tape } from "./slip";

/**
 * 빠른 메모: a few lines written anywhere, on a lavender-taped slip with ruled lines. Ctrl+Enter
 * adds them at the top of 메모 and closes; Esc or clicking elsewhere closes and keeps the text
 * (the main process saves it as the draft).
 */
const api = paper();
const stage = document.getElementById("stage")!;
const card = document.getElementById("card")!;
const editor = h("textarea", { class: "ruled", spellcheck: "false", "aria-label": t("빠른 메모"), placeholder: t("떠오른 생각을 적어요") });
let draftTimer: number | undefined;

function close(): void {
  window.clearTimeout(draftTimer);
  api.send("quickMemo:close", editor.value);
}

function save(): void {
  window.clearTimeout(draftTimer);
  const text = editor.value;
  if (text.trim()) editor.value = "";
  api.send("quickMemo:save", text);
}

const head = slipHead({ icon: "note", tint: "memo", title: t("빠른 메모"), context: `· ${t("쓰던 글은 남아요")}`, onClose: close });
card.append(tape("memo"), head.element, h("div", { class: "memo-body" }, editor),
  h("div", { class: "slip-foot" }, h("span", { class: "keys" }, keyHint("Esc", t("닫기"))), h("span", { class: "spacer" }), slipButton(t("메모에 넣기"), "primary", save, "Ctrl+↩")));
fitWindow(stage);

editor.addEventListener("input", () => {
  // Kept as the draft as it is written, so nothing is lost if the app is closed meanwhile.
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => api.send("quickMemo:draft", editor.value), 600);
});
editor.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault();
    save();
  } else if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
});

function applyFont(state: AppState): void {
  document.documentElement.dataset.font = state.prefs.font;
  document.documentElement.style.setProperty("--body-size", `${bodyFontSize(state.prefs.font, "regular")}px`);
}

api.on("state", (state) => applyFont(state as AppState));
api.on("quickMemo:blur", close);
api.on("quickMemo:open", (payload) => {
  const { text, copied } = (payload ?? {}) as { text?: string; copied?: boolean };
  editor.value = text ?? "";
  // Copied text put in: said in the header, and selected so typing replaces it.
  head.context.textContent = copied ? `· ${t("복사한 글을 넣었어요")}` : `· ${t("쓰던 글은 남아요")}`;
  appear(card);
  editor.focus();
  if (copied) editor.select(); else editor.setSelectionRange(editor.value.length, editor.value.length);
});
void api.getState().then(applyFont);
