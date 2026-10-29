import { daysText, snoozeChoices, timeParts, type Alarm } from "../core/alarm";
import { clock, dayWord, hourCycle, period, periodFirst, spokenTime, weekdayName, weekdayShort } from "../core/lang";
import { bodyFontSize, type AppState } from "../core/types";
import { startRinging } from "./alarmSound";
import { h, lang, paper, t } from "./api";
import { appear, chip, fitWindow, slipButton, tape } from "./slip";

/**
 * The alarm ringing — 울리는 쪽지: the cat in a clay disc, "1분째 울리는 중", the time, the label,
 * "평일 · 다음은 내일 오전 7:00", one big 끄기 (Return) and 다시 울림 5 · 10 · 15분 (S or Space for
 * the alarm's own length, 1/2/3 for 5/10/15) — no key answers in its first 1.5 seconds: the card
 * takes the focus, and a key already on its way into another app mustn't answer it. The sound loops
 * here (WebAudio) until it is answered or put away; the main process decides the rest.
 */
interface RingPayload { alarm: Alarm; muted?: boolean; still?: boolean; startedAt?: number; next?: string }

const api = paper();
const stage = document.getElementById("stage")!;
const card = document.getElementById("card")!;
const ringing = h("span", { class: "ringing", role: "status" });
const time = h("div", { class: "time" });
const label = h("div", { class: "label" });
const meta = h("div", { class: "meta" });
const snoozeChips = h("div", { class: "snz" });
const stop = slipButton(t("끄기"), "primary", () => answer("ring:stop"), "↩");
stop.classList.add("wide");
card.append(tape("alarm"),
  h("div", { class: "stage", "aria-hidden": "true" }, h("span", { class: "disc" }), h("img", { src: "../../assets/pet/256/cheer.png", alt: "", draggable: "false" })),
  ringing, time, label, meta, h("div", { class: "acts" }, stop, snoozeChips));
fitWindow(stage);

let silence: (() => void) | undefined;
let shownAt = 0;
let startedAt = Date.now();
let current: Alarm | undefined;
const keyGuardMs = 1500;

function quiet(): void {
  silence?.();
  silence = undefined;
}

/**
 * The ring is put away: the sound stops, and so do the waves and the rocking cat — the window is only hidden
 * (kept for the next ring), and a hidden page here isn't throttled, so endless animations would keep drawing.
 */
function rest(): void {
  quiet();
  document.documentElement.classList.add("still");
}

function answer(channel: "ring:stop" | "ring:snooze", minutes?: number): void {
  rest();
  api.send(channel, minutes);
}

/** "방금 울렸어요" · "1분째 울리는 중" (en "Just started" · "Ringing for 1 min", nl "Gaat net af" · "Gaat al 1 min"). */
function drawRinging(): void {
  const minutes = Math.floor((Date.now() - startedAt) / 60_000);
  ringing.replaceChildren(h("i", { "aria-hidden": "true" }), minutes < 1 ? t("방금 울렸어요") : t("{n}분째 울리는 중", { n: minutes }));
}
setInterval(() => { if (!document.documentElement.classList.contains("still")) drawRinging(); }, 10_000);

/** When it rings next, after this ring: "내일 오전 7:00", "금요일 오전 7:00" (en "tomorrow 7:00 AM", "Fri 7:00 AM"). */
function nextText(next: Date): string {
  const now = new Date();
  const days = Math.round((new Date(next.getFullYear(), next.getMonth(), next.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  const when = spokenTime(next.getHours(), next.getMinutes(), lang());
  const word = days === 0 || days === 1 ? dayWord(days, lang())! : lang() === "ko" ? weekdayName(next.getDay(), lang()) : weekdayShort(next.getDay(), lang());
  // Dutch "morgen om 13:30" (a bare "morgen 13:30" also reads as "tomorrow morning").
  return `${lang() === "ko" ? word : word.toLowerCase()} ${lang() === "nl" ? "om " : ""}${when}`;
}

/** Two lines at full size; if it needs more, three a size smaller; past that the last line ends in "…". */
function fitLabel(): void {
  label.classList.remove("smaller");
  if (label.scrollHeight > label.clientHeight + 1) label.classList.add("smaller");
}

function show({ alarm, muted, still, startedAt: started, next }: RingPayload): void {
  current = alarm;
  startedAt = started ?? Date.now();
  const { hour, minute } = timeParts(alarm);
  // On the 12-hour clock a small 오전 before 7:00 (Korean puts it first), 7:00 with a small AM · a.m. after it; on the
  // 24-hour clock 07:00 alone (the app's clock, lang.ts hourCycle).
  const digits = `${hour % 12 || 12}:${String(minute).padStart(2, "0")}`;
  if (hourCycle(lang()) === "h24") time.replaceChildren(clock(hour, minute, lang()));
  else if (periodFirst(lang())) time.replaceChildren(h("small", { class: "before" }, period(hour, lang())), digits);
  else time.replaceChildren(digits, h("small", {}, period(hour, lang())));
  label.textContent = alarm.label.trim() || t("알람");
  label.title = label.textContent;
  fitLabel();
  void document.fonts.ready.then(fitLabel);
  meta.textContent = alarm.days.length === 0 ? t("한 번 · 끄면 꺼져요") : next ? t("{days} · 다음은 {when}", { days: daysText(alarm.days, lang()), when: nextText(new Date(next)) }) : daysText(alarm.days, lang());
  meta.title = meta.textContent;
  // 다시 울림 없음: no snooze row at all, only 끄기.
  snoozeChips.hidden = alarm.snooze === 0;
  snoozeChips.replaceChildren(...(alarm.snooze === 0 ? [] : [h("span", {}, t("다시 울림")), ...snoozeChoices.map((minutes) => {
    const element = chip(t("{n}분", { n: minutes }), { on: minutes === alarm.snooze, action: () => answer("ring:snooze", minutes), title: t("{minutes}분 뒤 다시", { minutes }) });
    return element;
  })]));
  card.setAttribute("aria-label", `${t("알람")} · ${spokenTime(hour, minute, lang())} · ${label.textContent}`);
  document.documentElement.classList.toggle("still", Boolean(still));
  drawRinging();
  shownAt = performance.now();
  appear(card);
  quiet();
  if (!muted) silence = startRinging(alarm.sound);
  stop.focus();
}

document.addEventListener("keydown", (event) => {
  if (event.repeat || performance.now() - shownAt < keyGuardMs || !current) return;
  const key = event.key.toLowerCase();
  if (event.key === "Enter") { event.preventDefault(); answer("ring:stop"); }
  else if (current.snooze === 0) return; // no snooze: S, Space and 1–3 do nothing
  else if (event.key === " " || key === "s") { event.preventDefault(); answer("ring:snooze", current.snooze); }
  else if (key === "1" || key === "2" || key === "3") { event.preventDefault(); answer("ring:snooze", snoozeChoices[Number(key) - 1]); }
});

api.on("ring:show", (payload) => show(payload as RingPayload));
// Put away by the main process (the 10-minute limit, or answered elsewhere): the sound stops with it.
api.on("ring:hush", rest);
window.addEventListener("pagehide", rest);

function applyFont(state: AppState): void {
  document.documentElement.dataset.font = state.prefs.font;
  document.documentElement.style.setProperty("--body-size", `${bodyFontSize(state.prefs.font, "regular")}px`);
}
api.on("state", (state) => applyFont(state as AppState));
void api.getState().then(applyFont);
api.send("ring:ready");
