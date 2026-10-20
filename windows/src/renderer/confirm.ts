import { h, paper } from "./api";
import { appear, fitWindow, slipButton, slipHead, tape } from "./slip";

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
  cat?: boolean;
  size?: "s" | "m";
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
  const body = h("div", { class: "slip-body confirm-body" },
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

api.on("confirm:show", (payload) => show(payload as ConfirmQuestion));
fitWindow(stage);
api.send("confirm:ready");
