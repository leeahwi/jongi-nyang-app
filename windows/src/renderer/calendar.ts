import { longDate, monthTitle, weekdayLetter, weekdayOrder } from "../core/lang";
import { h, icon, lang, t } from "./api";

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * A roomy month calendar in the paper style (same design as macOS PaperCalendar): big day
 * numbers, Korean weekdays with Sunday in the accent colour, today ringed, the choice filled
 * in sage, past days dimmed. `span` shades today → chosen day, for deadlines.
 */
export function paperCalendar(options: { selected: Date; minimum: Date; span?: boolean; today?: () => Date; onPick(date: Date): void }): HTMLElement {
  // Deadlines pass the 4 a.m. logical day, so 1 a.m. still rings (and picks) "yesterday".
  const todayDate = options.today ?? (() => new Date());
  let month = new Date(options.selected.getFullYear(), options.selected.getMonth(), 1);
  let selected = options.selected;
  const root = h("div", { class: "paper-calendar" });

  function render(): void {
    const title = h("div", { class: "cal-title" }, monthTitle(month.getFullYear(), month.getMonth() + 1, lang()));
    const today = h("button", { class: "cal-today" }, t("오늘"));
    today.addEventListener("click", () => {
      const now = todayDate();
      month = new Date(now.getFullYear(), now.getMonth(), 1);
      pick(now);
    });
    const previous = h("button", { class: "quiet", title: t("이전 달"), "aria-label": t("이전 달") }, icon("chevron", 13, 2));
    previous.style.transform = "rotate(90deg)";
    previous.disabled = month <= new Date(options.minimum.getFullYear(), options.minimum.getMonth(), 1);
    previous.addEventListener("click", () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); render(); });
    const next = h("button", { class: "quiet", title: t("다음 달"), "aria-label": t("다음 달") }, icon("chevron", 13, 2));
    next.style.transform = "rotate(-90deg)";
    next.addEventListener("click", () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); render(); });

    // The week's days in the language's order (Dutch weeks start on Monday).
    const order = weekdayOrder(lang());
    const head = h("div", { class: "cal-weekdays" }, ...order.map((day) => h("span", { class: day === 0 ? "sun" : day === 6 ? "sat" : "" }, weekdayLetter(day, lang()))));
    const grid = h("div", { class: "cal-grid", role: "grid" });
    for (let blank = 0; blank < order.indexOf(month.getDay()); blank += 1) grid.append(h("span"));
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const now = todayDate();
    for (let day = 1; day <= days; day += 1) {
      const date = new Date(month.getFullYear(), month.getMonth(), day);
      const isSelected = sameDay(date, selected);
      const inSpan = options.span && !isSelected && date > startOfDay(now) && date < startOfDay(selected);
      const cell = h("button", {
        class: ["cal-day", date.getDay() === 0 ? "sun" : date.getDay() === 6 ? "sat" : "", sameDay(date, now) ? "today" : "", isSelected ? "selected" : "", inSpan ? "span" : ""].filter(Boolean).join(" "),
        role: "gridcell",
        "aria-label": longDate(date, lang()),
        "aria-selected": String(isSelected),
      }, h("span", {}, String(day)));
      cell.disabled = date < startOfDay(options.minimum);
      cell.addEventListener("click", () => pick(date));
      grid.append(cell);
    }
    root.replaceChildren(h("div", { class: "cal-head" }, title, h("span", { class: "spacer" }), today, previous, next), head, grid);
  }

  function pick(date: Date): void {
    // Keep the chosen time of day (for reminders).
    selected = new Date(date.getFullYear(), date.getMonth(), date.getDate(), selected.getHours(), selected.getMinutes());
    options.onPick(selected);
    render();
  }

  render();
  return root;
}
