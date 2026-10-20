import { durationText, parseDuration, timerPresets } from "../core/duration";
import { bodyFontSize, type AppState } from "../core/types";
import { h, lang, paper, t } from "./api";
import { appear, chip, fitWindow, slipButton, slipHead, tape } from "./slip";

/**
 * 직접 정하기…: an S slip with one handwriting field for the timer's length (what it understood
 * beside it, "1시간 30분", or how to write it in clay under it), length chips that start at once
 * (the recent custom lengths and the presets, four), 취소 · 시작. Return starts, Esc closes.
 */
const api = paper();
const stage = document.getElementById("stage")!;
const card = document.getElementById("card")!;
const input = h("input", { type: "text", spellcheck: "false", autocomplete: "off", "aria-label": t("타이머 시간"), placeholder: t("예: 40 또는 1:30") });
const parsed = h("span", { class: "field-hint", "aria-live": "polite" });
const presets = h("div", { class: "presets" });
let recent: number[] = [];

const close = () => api.send("timerSheet:close");
const startWith = (minutes: number) => api.send("timerSheet:start", minutes);
function submit(): void {
  const minutes = parseDuration(input.value, lang());
  if (minutes !== undefined) startWith(minutes);
}

const start = slipButton(t("시작", undefined, "timer"), "primary", submit, "↩");
const head = slipHead({ icon: "timer", tint: "sage", title: t("타이머"), context: `· ${t("1분–3시간")}`, onClose: close });
card.append(tape("timer"), head.element,
  h("div", { class: "slip-body" }, h("div", { class: "hand-field" }, input, parsed), presets),
  h("div", { class: "slip-foot" }, h("span", { class: "spacer" }), slipButton(t("취소"), "ghost", close), start));
fitWindow(stage);

/** Four lengths: the last custom ones (two at most), then 15 · 25 · 50 · 5, in order. */
function lengths(): number[] {
  const chosen = [...recent.slice(0, 2)];
  for (const minutes of [15, 25, 50, 5]) if (chosen.length < 4 && !chosen.includes(minutes) && timerPresets.includes(minutes)) chosen.push(minutes);
  return chosen.sort((a, b) => a - b);
}

function refresh(): void {
  const text = input.value.trim();
  const minutes = parseDuration(text, lang());
  // What it understood, right-aligned in sage — or, when it can't be read, the clay hint in the same place (as on the Mac).
  const bad = Boolean(text) && minutes === undefined;
  parsed.textContent = bad ? t("1분에서 3시간까지 적어 주세요") : text && minutes !== undefined ? durationText(minutes, lang()) : "";
  parsed.classList.toggle("bad", bad);
  start.disabled = minutes === undefined;
  presets.replaceChildren(...lengths().map((value) => chip(durationText(value, lang()), { on: value === minutes, action: () => startWith(value) })));
}

input.addEventListener("input", refresh);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); submit(); }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); close(); }
});

function applyState(state: AppState): void {
  document.documentElement.dataset.font = state.prefs.font;
  document.documentElement.style.setProperty("--body-size", `${bodyFontSize(state.prefs.font, "regular")}px`);
  recent = state.prefs.timerRecent ?? [];
  refresh();
}

api.on("state", (state) => applyState(state as AppState));
api.on("timerSheet:open", (payload) => {
  const { text } = (payload ?? {}) as { text?: string };
  input.value = text ?? "";
  refresh();
  appear(card);
  input.focus();
});
void api.getState().then(applyState);
refresh();
