import type { Lang } from "../core/lang";
import {
  cleanDays, dayName, deviceMoment, deviceNowLine, devicePresets, deviceSentence, deviceStatus, deviceWords, maxTimes, ruleShows,
  type DevicePreset, type DeviceRule, type DeviceTimes,
} from "../core/spaceDevice";
import { SlipShelf, draggedSlip } from "../core/slipMove";
import { h, icon, lang, t } from "./api";
import { appear, chip, dragByPaper, keyCap, slipButton, slipHead, tape } from "./slip";
import { timeList, timeOf } from "./timePick";

/**
 * 기기마다 보일 스페이스 on screen (#196, docs/plans/spaces-device.md §4, the chosen mock spaces-device-mock-2.png): the
 * mark on a space's colour dot, the desk row's line under the name, and the 시간 정하기 slip.
 */

/** The small mark on a colour dot: an eye struck through (hidden on this PC), a clock (time rule, shown or not). */
export function deviceMark(rule: DeviceRule | undefined): HTMLElement | null {
  if (!rule) return null;
  return h("span", { class: `device-mark ${rule.show === "hide" ? "hidden" : "timed"}`, "aria-hidden": "true" }, icon(rule.show === "hide" ? "eyeOff" : "clock", 9));
}

/** The desk row's line under the name: none for 보이기, ‘이 기기에서 숨겨 뒀어요’, or ‘평일 09:00–18:00에만 · 지금 보여요’. */
export function deviceStatusLine(rule: DeviceRule | undefined, hiddenNow: boolean, language: Lang = lang()): HTMLElement | null {
  const text = deviceStatus(rule, hiddenNow, language);
  return text ? h("span", { class: `device-status ${rule?.show === "hide" ? "hidden" : "timed"}` }, text) : null;
}

type TimesSlip = { slip: HTMLElement; close(): void };
/** #229: the times slips up now, one per space. */
const openSlips = new SlipShelf<TimesSlip>();
/** The slip in front (each one brought forward goes over the others). */
let front = 26;

/**
 * 시간 정하기 (§4): 바로 고르기 chips, the time ranges (days, start – end, ×), + 시간 더하기, the summary with what it
 * means now, 취소 · 저장 (Enter; Esc cancels). `save` gets the rows on 저장. #229: drawn over the page without holding it
 * up — the rest of the desk works while it is up — and a space (`key`) has one: asked again, that one comes forward.
 * #228: its paper drags it about the page, its head kept inside.
 */
export function openTimesSlip(options: { key: string; title: string; times: DeviceTimes[]; now?: () => Date; save: (times: DeviceTimes[]) => void; closed?: () => void }): { close(): void } {
  const { slip: made, isNew } = openSlips.take(options.key, () => timesSlip(options));
  made.slip.style.zIndex = String(++front);
  if (!isNew) made.slip.querySelector<HTMLElement>(".device-presets .chip")?.focus();
  return made;
}

function timesSlip(options: { key: string; title: string; times: DeviceTimes[]; now?: () => Date; save: (times: DeviceTimes[]) => void; closed?: () => void }): TimesSlip {
  const language = lang();
  const now = options.now ?? (() => new Date());
  let rows: DeviceTimes[] = options.times.map((times) => ({ ...times, days: [...times.days] }));
  const slip = h("div", { class: "slip l device-slip", role: "dialog", "aria-label": options.title });
  const presets = h("div", { class: "device-presets" });
  const list = h("div", { class: "device-rows" });
  const add = h("button", { class: "device-add" }, icon("plus", 13), h("span", {}, deviceWords.addTime[language]));
  const summary = h("div", { class: "device-summary", "aria-live": "polite" });
  const save = slipButton(t("저장"), "primary", () => { if (valid()) { options.save(rows); close(); } }, "Enter");
  const cancel = slipButton(t("취소"), "ghost", () => close());
  const valid = () => rows.length > 0 && rows.every((row) => row.days.length > 0);
  const same = (a: DeviceTimes[], b: DeviceTimes[]) => JSON.stringify(a) === JSON.stringify(b);

  const draw = () => {
    presets.replaceChildren(...(Object.keys(devicePresets) as DevicePreset[]).map((id) => {
      const preset = devicePresets[id];
      return chip(preset.title[language], { on: same(rows, preset.times), action: () => { rows = preset.times.map((times) => ({ ...times, days: [...times.days] })); draw(); } });
    }));
    list.replaceChildren(...rows.map((row, index) => rowElement(row, index)));
    add.toggleAttribute("disabled", rows.length >= maxTimes);
    const usable = rows.filter((row) => row.days.length > 0);
    const parts: HTMLElement[] = [];
    if (usable.length) {
      const moment = deviceMoment(now());
      parts.push(h("b", {}, `${deviceSentence(usable, language)}${language === "ko" ? "." : ""}`),
        h("span", {}, deviceNowLine(ruleShows({ show: "time", times: usable }, moment.day, moment.minute), now(), language)));
    }
    if (rows.some((row) => row.days.length === 0)) parts.push(h("span", { class: "bad" }, deviceWords.noDays[language]));
    summary.replaceChildren(...parts);
    summary.hidden = parts.length === 0;
    save.disabled = !valid();
  };

  const rowElement = (row: DeviceTimes, index: number): HTMLElement => {
    const days = h("div", { class: `device-days${row.days.length ? "" : " empty"}`, role: "group", "aria-label": t("요일") },
      ...[1, 2, 3, 4, 5, 6, 7].map((day) => {
        const on = row.days.includes(day);
        const button = h("button", { class: `chip device-day${on ? " on" : ""}`, "aria-pressed": String(on), "aria-label": dayName(day, language) }, dayName(day, language));
        button.addEventListener("click", () => {
          rows[index] = { ...row, days: cleanDays(on ? row.days.filter((entry) => entry !== day) : [...row.days, day]) };
          draw();
          (list.children[index]?.querySelectorAll<HTMLElement>(".device-day")[day - 1])?.focus();
        });
        return button;
      }));
    const remove = h("button", { class: "device-remove", title: deviceWords.removeTime[language], "aria-label": deviceWords.removeTime[language] }, icon("close", 12));
    remove.addEventListener("click", () => { rows.splice(index, 1); draw(); });
    const time = (which: "from" | "to") => {
      const label = which === "from" ? deviceWords.start[language] : deviceWords.end[language];
      const button = h("button", { class: "chip device-time", "aria-label": `${label}, ${timeOf(row[which])}`, "aria-haspopup": "listbox" }, timeOf(row[which]));
      button.addEventListener("click", () => {
        timeList(button, row[which], (minutes) => {
          if (minutes === undefined) return;
          rows[index] = { ...rows[index], [which]: minutes };
          draw();
        }, () => {});
      });
      return button;
    };
    const note = row.from === row.to ? deviceWords.wholeDay[language] : row.to < row.from ? deviceWords.nextDay[language] : "";
    return h("div", { class: "device-row" },
      h("div", { class: "device-line" }, days, h("span", { class: "spacer" }), remove),
      h("div", { class: "device-line" }, time("from"), h("span", { class: "device-dash", "aria-hidden": "true" }, "–"), time("to"), note ? h("span", { class: "device-note" }, note) : null));
  };

  add.addEventListener("click", () => {
    rows.push({ ...(rows.at(-1) ?? devicePresets.workday.times[0]), days: [...(rows.at(-1)?.days ?? devicePresets.workday.times[0].days)] });
    draw();
  });
  const head = slipHead({ icon: "clock", tint: "sage", title: options.title, onClose: () => close(), closeLabel: t("취소") });
  slip.append(tape("confirm"), head.element,
    h("div", { class: "slip-body device-body" }, h("p", { class: "device-lead" }, deviceWords.slipNote[language]), presets, list, add, summary),
    h("div", { class: "slip-foot" }, h("span", { class: "keys" }, h("span", {}, keyCap("Esc"), t("취소"))), h("span", { class: "spacer" }), cancel, save));
  // The keys are the slip's while the focus is in it (the page goes on working around it).
  const keys = (event: KeyboardEvent) => {
    if (event.isComposing || !slip.contains(document.activeElement)) return;
    if (event.key === "Escape" && !document.querySelector(".sheet-pop")) { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Enter" && !document.querySelector(".sheet-pop") && (event.target as HTMLElement).tagName !== "BUTTON") { event.preventDefault(); save.click(); }
  };
  // #228: dragged by its paper about the page, its head kept inside (core/slipMove.ts).
  let from: DOMRect | undefined;
  dragByPaper(slip, {
    start: () => {
      from = slip.getBoundingClientRect();
      slip.style.zIndex = String(++front);
    },
    move: (dx, dy) => {
      if (!from) return;
      const to = draggedSlip({ x: from.left, y: from.top, width: from.width, height: from.height }, dx, dy, { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
      slip.classList.add("moved");
      slip.style.left = `${Math.round(to.x)}px`;
      slip.style.top = `${Math.round(to.y)}px`;
    },
    end: () => { from = undefined; },
  });
  slip.addEventListener("pointerdown", () => { slip.style.zIndex = String(++front); }, true);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", keys, true);
    slip.remove();
    openSlips.drop(options.key);
    options.closed?.();
  };
  document.addEventListener("keydown", keys, true);
  draw();
  document.body.append(slip);
  appear(slip);
  requestAnimationFrame(() => slip.querySelector<HTMLElement>(".device-presets .chip")?.focus());
  return { slip, close };
}
