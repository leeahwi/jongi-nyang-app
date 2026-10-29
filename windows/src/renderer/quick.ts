import { bodyFontSize, type AppState } from "../core/types";
import { InputLine, lineKeys } from "./inputLine";
import { commitReading, type FlowHost } from "./intentFlow";
import { appear, fitWindow, slipButton, slipHead, tape, toaster } from "./slip";
import { h, paper, t } from "./api";

/**
 * 빠른 입력: the 입력 줄 on a slip, anywhere (Ctrl+Alt+N). The same chips and Tab as the note's
 * line; Enter puts the picked reading in, Ctrl+Enter makes it an event. Then the slip shows the
 * toast for 1.5 s and goes — or, when the note is up, goes at once and the note shows the toast.
 */
const api = paper();
const stage = document.getElementById("stage")!;
const card = document.getElementById("card")!;
const toastRoom = h("div", { class: "toast-room" });
stage.append(toastRoom);
const toast = toaster(toastRoom);
let closing: number | undefined;
let prefs: AppState["prefs"] | undefined;
/** 할 일 스페이스: `#회사` works here as on the note (without the note's lens). */
let spaces: AppState["todoSpaces"] | undefined;

function close(): void {
  window.clearTimeout(closing);
  closing = undefined;
  toast.hide();
  api.send("quick:close");
}

const flow: FlowHost = { toast, page: () => "today" };
const line = new InputLine({
  variant: "slip",
  placeholder: () => ({ long: t("무엇이든 적어요: 할 일, 일정, ‘타이머 40’"), short: t("무엇이든 적어요") }),
  prefer: () => prefs?.intentPrefer ?? {},
  spaces: () => (spaces ? { data: spaces } : undefined),
  commit: async (candidate, candidates, text, space) => {
    const result = await commitReading(flow, candidate, candidates, text, "quick", space);
    if (!result.made) return false;
    if (result.inNote) close();
    else closing = window.setTimeout(close, 1500);
    return true;
  },
  onEscape: (event) => { event.preventDefault(); close(); },
});
const head = slipHead({ icon: "check", tint: "sage", title: t("빠른 입력"), context: `· ${t("어디서든 Ctrl+Alt+N")}`, onClose: close });
const put = slipButton(t("넣기"), "primary", () => void line.submit(), "↩");
card.append(tape("todo"), head.element, h("div", { class: "slip-body" }, line.element),
  h("div", { class: "slip-foot" }, h("span", { class: "keys" }, ...lineKeys()), h("span", { class: "spacer" }), put));
line.field.setAttribute("aria-label", t("빠른 입력"));
fitWindow(stage);

function applyFont(state: AppState): void {
  prefs = state.prefs;
  spaces = state.todoSpaces;
  document.documentElement.dataset.font = state.prefs.font;
  document.documentElement.style.setProperty("--body-size", `${bodyFontSize(state.prefs.font, "regular")}px`);
}

api.on("state", (state) => applyFont(state as AppState));
api.on("quick:open", (payload) => {
  const { text } = (payload ?? {}) as { text?: string };
  window.clearTimeout(closing);
  toast.hide();
  line.set(text ?? "");
  appear(card);
  line.focus();
});
void api.getState().then(applyFont);
