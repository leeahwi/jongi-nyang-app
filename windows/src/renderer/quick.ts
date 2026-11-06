import { bodyFontSize, type AppState, type PrefsState } from "../core/types";
import { InputLine, lineKeys } from "./inputLine";
import { commitReading, type FlowHost } from "./intentFlow";
import { appear, dragByPaper, fitWindow, slipButton, slipHead, startsSlipDrag, tape, toaster } from "./slip";
import { h, lang, paper, t } from "./api";
import { actionText } from "../core/intent";
import { listenForTyping } from "./typingTap";
import { holdWhileAsked } from "./askGuard";

// #229: a question waiting holds this page up (askGuard.ts).
holdWhileAsked();

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
/** The button: 넣기 until a reading, then what it makes (made below the line, which reads itself once as it is made). */
let put: HTMLButtonElement | undefined;
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
  // 넣기 waits for a reading, as on the Mac (nothing typed, or a slash word not understood, puts nothing in).
  onChange: () => sayPut(),
  onPick: () => sayPut(),
});

/** #240 (D3 B): the button says what Enter makes and follows the picked chip — 일정 넣기, 타이머 시작, 알람 맞추기 …. */
function sayPut(): void {
  if (!put) return;
  put.disabled = line.readings.length === 0;
  const words = put.querySelector("span");
  const text = actionText(line.pickedReading, lang());
  if (words && words.textContent !== text) words.textContent = text;
}
const head = slipHead({ icon: "check", tint: "sage", title: t("빠른 입력"), context: `· ${t("어디서든 Ctrl+Alt+N")}`, onClose: close });
put = slipButton(t("넣기"), "primary", () => void line.submit(), "↩");
sayPut();
card.append(tape("todo"), head.element, h("div", { class: "slip-body" }, line.element),
  h("div", { class: "slip-foot" }, h("span", { class: "keys" }, ...lineKeys()), h("span", { class: "spacer" }), put));
line.field.setAttribute("aria-label", t("빠른 입력"));
fitWindow(stage);

function applyFont(state: PrefsState): void {
  prefs = state.prefs;
  spaces = state.todoSpaces;
  document.documentElement.dataset.font = state.prefs.font;
  document.documentElement.style.setProperty("--body-size", `${bodyFontSize(state.prefs.font, "regular")}px`);
}

api.on("state:prefs", (state) => applyFont(state as PrefsState));
api.on("quick:open", (payload) => {
  const { text } = (payload ?? {}) as { text?: string };
  window.clearTimeout(closing);
  toast.hide();
  line.set(text ?? "");
  appear(card);
  line.focus();
});
void api.getState().then(applyFont);

// #230: keys typed here make the desktop cat tap along (only that a key went down).
listenForTyping();

// #246: the paper and the title row drag the slip (not the field, the chips or the buttons — the text and its caret stay as
// they are); the main process keeps its head on the display and remembers the place per display. A double-click on the
// paper puts it back where it usually opens.
dragByPaper(card, {
  start: (x, y) => { void api.act({ type: "slipDrag", phase: "start", x, y }); },
  move: (_dx, _dy, x, y) => { void api.act({ type: "slipDrag", phase: "move", x, y }); },
  end: (x, y) => { void api.act({ type: "slipDrag", phase: "end", x, y }); },
});
// A press on the paper doesn't take the focus from the field: what is typed and the caret stay.
card.addEventListener("mousedown", (event) => { if (startsSlipDrag(event as unknown as PointerEvent)) event.preventDefault(); });
card.addEventListener("dblclick", (event) => {
  if (!startsSlipDrag(event as unknown as PointerEvent)) return;
  void api.act({ type: "slipDrag", phase: "reset", x: event.screenX, y: event.screenY });
});
