import { h, paper, t } from "./api";
import { appear, dragByPaper, fitWindow, keyCap, nudge, slipButton, slipHead, tape } from "./slip";

/**
 * A question the app asks (language, import, storage folder…) on a slip instead of a system dialog:
 * the topic's badge and title, the message and a quieter line, the cat wondering at the right, and
 * one button per answer (the primary is the action, Enter; Esc gives the "keep" answer).
 */
export interface ConfirmQuestion {
  icon: string;
  title: string;
  message: string;
  detail?: string;
  /** "danger" sits alone on the left in clay text; a `clay` primary is filled clay (a destructive answer). */
  buttons: { label: string; kind: "primary" | "ghost" | "danger"; clay?: boolean }[];
  cancelId: number;
  /**
   * #253 (docs/plans/widget-ask-cases.json `questions`): its answer replaces the whole list (a backup, a shared folder's
   * list): while it waits, the day sheet's 넣기 and 되돌리기 wait too. Written on the line with the question's message.
   */
  replacesList?: boolean;
  cat?: boolean;
  /** "keys": the shortcut list's wide slip (#86). */
  size?: "s" | "m" | "keys";
  /**
   * The shortcut list (#86): groups of rows — what each does and its keys, one cap each (null: 끔) — in two columns,
   * the first half on the left; `message` then goes under them, quieter. Taller than the screen, the groups scroll.
   */
  sheet?: ShortcutSheetGroup[];
}

/** A row: what it does and its keys (null: 끔); `also`, a second key for the same row (새 메모 · 찾기: Ctrl+N Ctrl+F). */
export interface ShortcutSheetGroup { title: string; rows: { title: string; keys: string[] | null; also?: string[] }[] }

/** How many groups go on the left: the split with the least difference in rows (a heading counted as two), as the Mac's ShortcutColumns. */
export function sheetSplit(groups: ShortcutSheetGroup[]): number {
  const sizes = groups.map((group) => group.rows.length + 2);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  let best = Math.ceil(groups.length / 2), gap = Infinity, left = 0;
  for (let index = 1; index < Math.max(2, groups.length) && index <= sizes.length; index += 1) {
    left += sizes[index - 1];
    const difference = Math.abs(total - 2 * left);
    if (difference < gap) { gap = difference; best = index; }
  }
  return best;
}

/** The groups in two columns (split by rows, #118): what each row does on the left, its key caps (Ctrl + N) on the right. */
function sheetColumns(groups: ShortcutSheetGroup[]): HTMLElement {
  const half = sheetSplit(groups);
  const column = (part: ShortcutSheetGroup[]) => h("div", { class: "keys-col" }, ...part.map((group) => h("section", { class: "keys-group" },
    h("div", { class: "keys-title", role: "heading", "aria-level": "3" }, group.title),
    ...group.rows.map((row) => {
      const caps = (list: string[]) => list.flatMap((key, index) => [index > 0 ? h("span", { class: "keys-plus", "aria-hidden": "true" }, "+") : null, keyCap(key)]);
      const keys = row.keys
        ? h("span", { class: "keys-caps" }, ...caps(row.keys), ...(row.also ? [h("span", { class: "keys-gap", "aria-hidden": "true" }), ...caps(row.also)] : []))
        : h("span", { class: "keys-off" }, t("끔"));
      const said = row.keys ? [row.keys, ...(row.also ? [row.also] : [])].map((list) => list.join(" + ")).join(", ") : t("끔");
      return h("div", { class: "keys-row", "aria-label": `${row.title}, ${said}` }, h("span", { class: "keys-name" }, row.title), keys);
    }))));
  const columns = h("div", { class: "keys-cols" }, column(groups.slice(0, half)), column(groups.slice(half)));
  // Taller than the screen: the groups scroll (the header, the notes and the button stay).
  columns.style.maxHeight = `${Math.max(240, window.screen.availHeight - 250)}px`;
  return columns;
}

const api = paper();
const stage = document.getElementById("stage")!;
const card = document.getElementById("card")!;
let question: ConfirmQuestion | undefined;
let answered = false;

const answer = (index: number) => {
  if (answered) return;
  answered = true;
  api.send("confirm:answer", index);
};

function show(next: ConfirmQuestion): void {
  question = next;
  answered = false;
  card.className = `slip ${next.size ?? "s"}`;
  card.setAttribute("aria-label", next.title);
  const head = slipHead({ icon: next.icon, title: next.title, onClose: () => answer(next.cancelId) });
  stage.classList.toggle("wide", Boolean(next.sheet));
  const body = next.sheet
    ? h("div", { class: "slip-body keys-body" }, sheetColumns(next.sheet), next.message ? h("div", { class: "keys-notes" }, next.message) : null)
    : h("div", { class: "slip-body confirm-body" },
      next.cat === false ? null : h("img", { class: "cat", src: "../../assets/pet/256/curious.png", alt: "", draggable: "false" }),
      h("div", { class: "confirm-msg" }, next.message), next.detail ? h("div", { class: "confirm-sub" }, next.detail) : null);
  const buttons = next.buttons.map((button, index) => {
    const element = slipButton(button.label, button.kind, () => answer(index), button.kind === "primary" ? "↩" : undefined);
    if (button.clay) element.classList.add("clay");
    return element;
  });
  const danger = buttons.filter((_, index) => next.buttons[index].kind === "danger");
  const rest = buttons.filter((_, index) => next.buttons[index].kind !== "danger");
  card.replaceChildren(tape("confirm"), head.element, body, h("div", { class: "slip-foot" }, ...danger, h("span", { class: "spacer" }), ...rest));
  card.setAttribute("aria-describedby", "");
  appear(card);
  (buttons[next.buttons.findIndex((button) => button.kind === "primary")] ?? buttons[0])?.focus();
}

document.addEventListener("keydown", (event) => {
  if (!question) return;
  if (event.key === "Escape") { event.preventDefault(); answer(question.cancelId); }
  if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
    const primary = question.buttons.findIndex((button) => button.kind === "primary");
    if (primary >= 0) { event.preventDefault(); answer(primary); }
  }
});

// #228: the paper (and the title row) drags the window; the main process keeps the slip's head on the display.
dragByPaper(card, {
  start: (x, y) => { void api.act({ type: "slipDrag", phase: "start", x, y }); },
  move: (_dx, _dy, x, y) => { void api.act({ type: "slipDrag", phase: "move", x, y }); },
  end: (x, y) => { void api.act({ type: "slipDrag", phase: "end", x, y }); },
});

api.on("confirm:show", (payload) => show(payload as ConfirmQuestion));
// #229: a press elsewhere that this question held up (counted on the stage for the snapshot run's check).
api.on("confirm:nudge", () => {
  stage.dataset.nudges = String(Number(stage.dataset.nudges ?? "0") + 1);
  nudge(card);
});
fitWindow(stage);
api.send("confirm:ready");
