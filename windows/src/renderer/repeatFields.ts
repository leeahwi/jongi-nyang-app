import { logicalDayStart } from "../core/archive";
import { shortDate, weekdayName, weekdayShort } from "../core/lang";
import { describe, isValidRule, nextOccurrence, ordinal, repeatKindTitles, type RepeatKind, type RepeatRule } from "../core/repeat";
import { h, icon, lang, t } from "./api";

export interface RepeatValue { rule: RepeatRule; remindAt?: string }

/**
 * The shared "반복" form: how often (매일·평일·매주·매월), which days, and the alert time,
 * with a live summary. Used by the row editor and by Settings → 반복.
 */
export function repeatFields(initial: RepeatValue | undefined, onChange: () => void): { element: HTMLElement; value(): RepeatValue | undefined } {
  const today = logicalDayStart(new Date());
  let kind: RepeatKind = initial?.rule.kind ?? "daily";
  let weekdays = new Set(initial?.rule.weekdays ?? [today.getDay()]);
  let monthDay = initial?.rule.monthDay ?? today.getDate();
  let alertOn = initial ? Boolean(initial.remindAt) : true;
  let time = initial?.remindAt ?? "09:00";

  const kinds = h("div", { class: "seg", role: "radiogroup", "aria-label": t("반복 주기") });
  const days = h("div", { class: "days", role: "group", "aria-label": t("반복 요일") });
  const monthSelect = h("select", { "aria-label": t("매월 날짜") });
  for (let day = 1; day <= 31; day += 1) {
    const option = h("option", { value: String(day) }, lang() === "en" ? ordinal(day) : lang() === "nl" ? `${day}e` : t("{n}일", { n: day }));
    option.selected = day === monthDay;
    monthSelect.append(option);
  }
  const monthRow = h("div", { class: "month-row" }, t("매월"), monthSelect, h("span", { class: "hint" }, t("그 날이 없는 달은 마지막 날")));
  const alertToggle = h("button", { class: "switch small", role: "switch", "aria-label": t("반복 알림") });
  const timeInput = h("input", { type: "time", "aria-label": t("알림 시각") });
  timeInput.value = time;
  const alertRow = h("div", { class: "alert-row" }, icon("bell", 14), h("span", { class: "grow" }, t("알림", undefined, "row")), timeInput, alertToggle);
  const summaryText = h("div", { class: "when" });
  const summaryNext = h("div", { class: "hint" });
  const summary = h("div", { class: "summary" }, icon("repeat", 16), h("div", {}, h("div", { class: "hint" }, t("반복")), summaryText, summaryNext));
  const element = h("div", { class: "repeat-fields" }, kinds, days, monthRow, alertRow, summary);

  const rule = (): RepeatRule => kind === "weekly" ? { kind, weekdays: [...weekdays].sort() } : kind === "monthly" ? { kind, monthDay } : { kind };

  function render(): void {
    kinds.replaceChildren(...(Object.keys(repeatKindTitles.ko) as RepeatKind[]).map((option) => {
      const choice = h("button", { role: "radio", "aria-checked": String(option === kind) }, repeatKindTitles[lang()][option]);
      choice.addEventListener("click", () => { kind = option; render(); onChange(); });
      return choice;
    }));
    days.hidden = kind !== "weekly";
    days.replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map((day) => {
      const chip = h("button", { class: "day", "aria-pressed": String(weekdays.has(day)), "aria-label": weekdayName(day, lang()) }, weekdayShort(day, lang()));
      chip.addEventListener("click", () => {
        if (weekdays.has(day)) weekdays.delete(day); else weekdays.add(day);
        weekdays = new Set(weekdays);
        render();
        onChange();
      });
      return chip;
    }));
    monthRow.hidden = kind !== "monthly";
    alertToggle.setAttribute("aria-checked", String(alertOn));
    timeInput.disabled = !alertOn;
    const current = rule();
    const valid = isValidRule(current);
    summary.classList.toggle("invalid", !valid);
    summaryText.textContent = valid ? describe(current, alertOn ? time : undefined, lang()) : t("요일을 하나 이상 골라 주세요");
    const next = valid ? nextOccurrence(current, new Date()) : undefined;
    summaryNext.textContent = next
      ? (next.getTime() === today.getTime() ? t("오늘부터 목록에 나타나요") : t("다음: {day}부터 나타나요", { day: shortDate(next, lang()) }))
      : "";
  }

  monthSelect.addEventListener("change", () => { monthDay = Number(monthSelect.value); render(); onChange(); });
  alertToggle.addEventListener("click", () => { alertOn = !alertOn; render(); onChange(); });
  timeInput.addEventListener("input", () => { if (timeInput.value) time = timeInput.value; render(); onChange(); });
  render();

  return {
    element,
    value: () => (isValidRule(rule()) ? { rule: rule(), remindAt: alertOn ? time : undefined } : undefined),
  };
}
