import { currentStreak, dayKey, groupByDay, heatLevel, heatLevelTitlesIn, logicalDayStart, longestStreak, type ArchiveEntry } from "../core/archive";
import { clock, longDate as longDateIn, monthName, monthShort, monthTitle as langMonthTitle, shortDate, weekdayLetter, weekdayShort } from "../core/lang";
import type { AppState } from "../core/types";
import { focusByTask, focusDay, focusTime, focusTotal, focusTotals, sessionsText, type FocusRecord } from "../core/focus";
import { edgeFade, h, icon, lang, paper, t } from "./api";

const api = paper();
const app = document.getElementById("app")!;
const tooltip = document.getElementById("tooltip")!;
/** Numbers as the language writes them: 1,234 · 1.234. */
const number = (value: number) => value.toLocaleString({ ko: "ko-KR", en: "en-US", nl: "nl-NL" }[lang()]);
/** One decimal: "2.4" ("2,4" in Dutch). */
const decimal = (value: number) => (lang() === "nl" ? value.toFixed(1).replace(".", ",") : value.toFixed(1));
/** A month on the bars and over the grid: "10월", "Oct", "okt". */
const monthLabel = (month: number) => monthShort(month, lang());

/** Where the record is kept, shown next to 기록 폴더 열기. */
let archivePath = "";
let entries: ArchiveEntry[] = [];
/** 집중 기록 (focus.jsonl): the sessions, and their minutes per day. */
let focus: FocusRecord[] = [];
let focusDays = new Map<string, number>();
let now = new Date();
let days = new Map<string, ArchiveEntry[]>();
/** "recent" = the last 53 weeks, like GitHub; otherwise a calendar year. */
let range: "recent" | number = "recent";
/** The day shown under the grid: today, or the one asked for (search → 완료 기록 on that day). */
let selected = /^\d{4}-\d{2}-\d{2}$/.test(new URLSearchParams(location.search).get("day") ?? "") ? new URLSearchParams(location.search).get("day")! : dayKey(new Date());

/** "2026년 10월", "October 2026", "oktober 2026". */
const monthYear = (year: number, month: number) => langMonthTitle(year, month, lang());
const keyDate = (key: string) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const longDate = (date: Date) => longDateIn(date, lang());
const count = (key: string) => days.get(key)?.length ?? 0;
const focusMinutes = (key: string) => focusDays.get(key) ?? 0;

function rangeBounds(): { start: Date; end: Date } {
  if (range === "recent") {
    const end = logicalDayStart(now);
    end.setHours(12);
    const start = new Date(end);
    start.setDate(start.getDate() - 7 * 52 - end.getDay()); // 53 columns, Sunday first
    return { start, end };
  }
  return { start: new Date(range, 0, 1, 12), end: new Date(range, 11, 31, 12) };
}

function eachDay(start: Date, end: Date, visit: (date: Date) => void): void {
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) visit(new Date(date));
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function tile(symbol: string, label: string, value: string | (Node | string)[], unit: string, detail: string): HTMLElement {
  return h("div", { class: "tile" },
    h("div", { class: "k" }, h("span", { class: "badge", "aria-hidden": "true" }, icon(symbol, 12, 2.1)), h("span", { class: "kt", title: label }, label)),
    h("div", { class: "v" }, ...(typeof value === "string" ? [value] : value), unit ? h("small", {}, unit) : null),
    h("div", { class: "d", title: detail }, detail));
}

/** "3시간 20분" as the tile writes it: the numbers big, the units small ("3 h 20 min", "3 u 20 min"). */
function focusValue(minutes: number): (Node | string)[] {
  return focusTime(minutes, lang()).split(/(\d+)/).filter(Boolean).map((part) => (/^\d+$/.test(part) ? part : h("small", {}, part.trim())));
}

function summary(start: Date, end: Date): HTMLElement {
  let total = 0;
  let best = { key: "", value: 0 };
  eachDay(start, end, (date) => {
    const key = dayKey(date);
    total += count(key);
    if (count(key) > best.value) best = { key, value: count(key) };
  });
  const today = logicalDayStart(now);
  const month = (offset: number) => {
    const first = new Date(today.getFullYear(), today.getMonth() + offset, 1, 12);
    let sum = 0;
    eachDay(first, new Date(first.getFullYear(), first.getMonth() + 1, 0, 12), (date) => { sum += count(dayKey(date)); });
    return sum;
  };
  const thisMonth = month(0);
  // Last month's number only, no 적어요 / 많아요 (#42).
  const lastMonth = month(-1);
  const streak = currentStreak(days, now);
  return h("div", { class: "tiles" },
    tile("check", range === "recent" ? t("최근 1년 완료") : t("{year}년 완료", { year: range }), number(total), t("개", { n: total }),
      t("하루 평균 {n}개", { n: decimal(total / Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1)) })),
    tile("calendar", t("{month} 완료", { month: monthName(today.getMonth() + 1, lang()) }), String(thisMonth), t("개", { n: thisMonth }),
      t("지난달 {n}개", { n: lastMonth })),
    tile("flame", t("연속 기록"), String(streak), t("일", { n: streak }), t("최장 {n}일", { n: longestStreak(days) })),
    tile("star", t("가장 많이 한 날"), String(best.value), t("개", { n: best.value }), best.value ? longDate(keyDate(best.key)) : t("아직 없어요")),
    focusTile(start, end),
  );
}

/** 집중: the range's focus time and how many sessions (focus.jsonl). */
function focusTile(start: Date, end: Date): HTMLElement {
  const { minutes, sessions } = focusTotal(focus, start, end);
  const element = tile("timer", t("집중"), focusValue(minutes), "", sessions ? t("{n}번 집중", { n: sessions }) : t("아직 없어요"));
  element.classList.add("focus");
  return element;
}

/** 가장 오래 집중한 일: the top three tasks by focus time in the range, in one quiet line under the grid. */
function focusTop(start: Date, end: Date): HTMLElement | null {
  const top = focusByTask(focus, start, end, 3);
  if (!top.length) return null;
  return h("div", { class: "focus-top" }, h("span", { class: "ft-head" }, t("가장 오래 집중한 일")),
    ...top.map((task) => h("span", { class: "ft-item", title: `${task.title} · ${focusTime(task.minutes, lang())}` }, h("span", { class: "ft-title" }, task.title), h("span", { class: "ft-min" }, focusTime(task.minutes, lang()), h("span", { class: "ft-n" }, ` · ${sessionsText(task.sessions, lang())}`)))));
}

function heatmap(start: Date, end: Date): HTMLElement {
  const todayKey = dayKey(now);
  const first = new Date(start);
  first.setDate(first.getDate() - first.getDay()); // align to Sunday
  const last = new Date(end);
  last.setDate(last.getDate() + (6 - last.getDay()));
  const grid = h("div", { class: "grid", role: "grid", "aria-label": t("날짜별 완료 수") });
  const months = h("div", { class: "months", "aria-hidden": "true" });
  let column = 0;
  let lastMonth = -1;
  eachDay(first, last, (date) => {
    if (date.getDay() === 0) {
      if (date.getMonth() !== lastMonth && date.getDate() <= 7 && column < 52) {
        months.append(Object.assign(h("span", {}, monthLabel(date.getMonth() + 1)), { style: `--column:${column}` }));
        lastMonth = date.getMonth();
      }
      column += 1;
    }
    const key = dayKey(date);
    const outside = date < start || date > end;
    const future = !outside && date.getTime() > logicalDayStart(now).getTime() + 86_400_000;
    const value = count(key);
    const cell = h("button", {
      class: `cell${outside ? " outside" : ""}${future ? " future" : ""}${key === todayKey ? " today" : ""}${key === selected ? " selected" : ""}`,
      "data-level": String(outside || future ? 0 : heatLevel(value)),
      "data-key": key,
      role: "gridcell",
      "aria-label": t("{date}, {n}개 완료", { date: longDate(date), n: value }),
      tabindex: key === selected ? "0" : "-1",
    });
    const focused = focusMinutes(key);
    if (focused > 0 && !outside && !future) cell.setAttribute("aria-label", `${cell.getAttribute("aria-label")}, ${t("집중 {time}", { time: focusTime(focused, lang()) })}`);
    if (!outside && !future) {
      // The day's focus time too, when there was any.
      const focusText = focused > 0 ? ` · ${t("집중 {time}", { time: `<b>${focusTime(focused, lang())}</b>` })}` : "";
      cell.addEventListener("mouseenter", () => showTooltip(cell, t("<b>{n}개</b> 완료 · {date}", { n: value, date: shortDate(date, lang()) }) + focusText));
      cell.addEventListener("mouseleave", hideTooltip);
      cell.addEventListener("click", () => { selected = key; render(); });
    } else {
      cell.setAttribute("disabled", "");
    }
    grid.append(cell);
  });

  // The grid's rows run Sunday to Saturday in every language (like GitHub); every other one is named.
  const weekdays = h("div", { class: "weekdays", "aria-hidden": "true" }, ...[0, 1, 2, 3, 4, 5, 6].map((day) => h("span", {}, day % 2 === 1 ? (lang() === "ko" ? weekdayLetter(day, lang()) : weekdayShort(day, lang())) : "")));
  const scale = h("span", { class: "scale" }, t("적음"), ...[0, 1, 2, 3, 4].map((level) => {
    const swatch = h("span", { class: "cell", "data-level": String(level), title: heatLevelTitlesIn[lang()][level] });
    swatch.addEventListener("mouseenter", () => showTooltip(swatch, heatLevelTitlesIn[lang()][level]));
    swatch.addEventListener("mouseleave", hideTooltip);
    return swatch;
  }), t("많음"));
  return h("div", { class: "card heat-card" },
    h("h2", {}, t("날마다 완료한 일"), h("span", { class: "note" }, t("칸을 누르면 그날 한 일을 볼 수 있어요"))),
    h("div", { class: "heat" }, h("span"), months, weekdays, grid),
    h("div", { class: "legend" }, h("span", {}, t("하루는 새벽 4시에 바뀌어요")), scale),
    focusTop(start, end),
  );
}

function monthBars(start: Date, end: Date): HTMLElement {
  const buckets: { label: string; year: number; month: number; value: number }[] = [];
  const cursor = new Date(end.getFullYear(), end.getMonth() - 11, 1, 12);
  for (let index = 0; index < 12; index += 1) {
    const month = new Date(cursor.getFullYear(), cursor.getMonth() + index, 1, 12);
    let value = 0;
    eachDay(month, new Date(month.getFullYear(), month.getMonth() + 1, 0, 12), (date) => { if (date >= start && date <= end) value += count(dayKey(date)); });
    buckets.push({ label: monthLabel(month.getMonth() + 1), year: month.getFullYear(), month: month.getMonth(), value });
  }
  const max = Math.max(1, ...buckets.map((bucket) => bucket.value));
  const peak = buckets.reduce((best, bucket) => (bucket.value > best.value ? bucket : best), buckets[0]);
  const today = logicalDayStart(now);
  const bars = h("div", { class: "bars", role: "list", "aria-label": t("월별 완료 수") });
  for (const bucket of buckets) {
    const current = bucket.year === today.getFullYear() && bucket.month === today.getMonth();
    const fill = h("div", { class: "fill" });
    // A share of the bar's track (the tallest reaches 84 %, leaving room for its number above).
    const share = bucket.value > 0 ? Math.max(2, (bucket.value / max) * 84) : 0;
    fill.style.height = `${share}%`;
    const track = h("div", { class: "track" }, fill);
    const bar = h("div", { class: `bar${current ? " current" : ""}${bucket.value === 0 ? " zero" : ""}`, role: "listitem", "aria-label": t("{month} {n}개", { month: monthYear(bucket.year, bucket.month + 1), n: bucket.value }) }, track, h("span", { class: "m" }, bucket.label));
    // Direct labels only where they earn it: the peak month and this month.
    if ((bucket === peak && bucket.value > 0) || current) {
      const label = h("span", { class: "n" }, String(bucket.value));
      label.style.bottom = `calc(${share}% + 4px)`;
      track.append(label);
    }
    bar.addEventListener("mouseenter", () => showTooltip(bar, t("<b>{n}개</b> 완료 · {date}", { n: bucket.value, date: monthYear(bucket.year, bucket.month + 1) })));
    bar.addEventListener("mouseleave", hideTooltip);
    bars.append(bar);
  }
  return h("div", { class: "card" }, h("h2", {}, t("월별 완료")), bars, h("div", { class: "baseline" }));
}

function dayPanel(): HTMLElement {
  const date = keyDate(selected);
  const list = days.get(selected) ?? [];
  const body = list.length === 0
    ? h("div", { class: "empty" },
      h("img", { src: "../../assets/pet/256/sleep.png", alt: "", draggable: "false" }),
      h("span", {}, selected === dayKey(now) ? t("오늘은 아직 완료한 일이 없어요.\n하나만 끝내도 칸이 채워져요.") : t("이 날은 쉬어 갔어요.")))
    : h("ul", {}, ...list.map((entry) => {
      const at = new Date(entry.completedAt!);
      return h("li", {}, h("span", { class: "dot", "aria-hidden": "true" }, icon("check", 10, 3.2)), h("span", { class: "t", title: entry.title }, entry.title), h("time", {}, clock(at.getHours(), at.getMinutes(), lang())));
    }));
  // The day's focus: "집중 1시간 5분 · 3번" under its date.
  const sessions = focus.filter((record) => focusDay(record) === selected);
  const focused = sessions.reduce((sum, record) => sum + record.minutes, 0);
  const focusLine = focused > 0 ? h("div", { class: "day-focus" }, icon("timer", 12), `${t("집중 {time}", { time: focusTime(focused, lang()) })} · ${sessionsText(sessions.length, lang())}`) : null;
  return h("div", { class: "card day" }, h("div", { class: "day-head" }, h("span", { class: "date" }, longDate(date)), h("span", { class: "count" }, t("{n}개", { n: list.length }))), focusLine, body);
}

/**
 * The pane's header: its name, a word about the streak (or, before the first, how to start), and the range to look at.
 * (1.30: no "지금까지 564개를 끝냈어요" — the first tile says that number; the Mac's the same.)
 */
function paneHead(ranges: HTMLElement): HTMLElement {
  const total = entries.filter((entry) => entry.completedAt).length;
  const streak = currentStreak(days, now);
  const word = streak > 1 ? t("{n}일째 이어 가고 있어요. 오늘도 한 칸!", { n: streak })
    : streak === 1 ? t("오늘도 한 칸 채웠어요. 내일도 이어 가 봐요.")
      : t("하나만 끝내도 오늘 칸이 초록으로 채워져요.");
  return h("header", { class: "pane-head" },
    h("div", { class: "ph-text" }, h("h1", {}, t("완료 기록")), h("p", { class: "ph-sub" }, total === 0 ? `${t("첫 칸을 채워 볼까요?")} · ${word}` : word)),
    ranges);
}

function showTooltip(target: Element, html: string): void {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const rect = target.getBoundingClientRect();
  const width = tooltip.offsetWidth;
  tooltip.style.left = `${Math.min(window.innerWidth - width - 8, Math.max(8, rect.left + rect.width / 2 - width / 2))}px`;
  tooltip.style.top = `${rect.top - tooltip.offsetHeight - 6}px`;
}

function hideTooltip(): void {
  tooltip.hidden = true;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(): void {
  hideTooltip();
  const years = [...new Set([...days.keys()].map((key) => Number(key.slice(0, 4))))].sort((a, b) => b - a);
  const ranges = h("div", { class: "ranges", role: "group", "aria-label": t("기간", undefined, "range") });
  for (const option of ["recent" as const, ...years]) {
    const choice = h("button", { "aria-pressed": String(range === option) }, option === "recent" ? t("최근 1년") : t("{year}년", { year: option }));
    choice.addEventListener("click", () => { range = option; render(); });
    ranges.append(choice);
  }
  const { start, end } = rangeBounds();
  const undated = entries.filter((entry) => !entry.completedAt).length;
  const folder = h("button", { title: archivePath }, t("기록 폴더 열기"));
  folder.addEventListener("click", () => api.act({ type: "openArchiveFolder" }));
  const scrollTop = app.querySelector(".content")?.scrollTop ?? 0;
  const content = h("div", { class: "content" },
    summary(start, end),
    heatmap(start, end),
    h("div", { class: "split" }, monthBars(start, end), dayPanel()),
    h("div", { class: "foot" }, h("span", {}, undated > 0 ? t("날짜가 기록되기 전에 완료한 {n}개는 달력에 표시하지 않아요.", { n: undated }) : t("완료한 일은 설정한 시점에 목록에서 기록으로 옮겨져요.")),
      h("span", { class: "folder" }, folder)),
  );
  app.replaceChildren(paneHead(ranges), content);
  content.scrollTop = scrollTop;
  edgeFade(content);
}

async function refresh(): Promise<void> {
  const history = await api.getHistory();
  entries = history.entries;
  focus = history.focus ?? [];
  now = new Date(history.now);
  days = groupByDay(entries);
  const far = new Date(2000, 0, 1), later = new Date(now.getTime() + 2 * 86_400_000);
  focusDays = focusTotals(focus, far, later);
  render();
}

// Arrow keys move the selected day around the grid.
window.addEventListener("keydown", (event) => {
  const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key];
  if (!step || !(document.activeElement as HTMLElement | null)?.classList.contains("cell")) return;
  event.preventDefault();
  const next = keyDate(selected);
  next.setDate(next.getDate() + step);
  const target = document.querySelector<HTMLButtonElement>(`.cell[data-key="${dayKey(next)}"]:not([disabled])`);
  if (!target) return;
  selected = target.dataset.key!;
  render();
  document.querySelector<HTMLButtonElement>(`.cell[data-key="${selected}"]`)?.focus();
});

api.on("history:changed", () => void refresh());
// Search → 완료 기록 on a day: that day chosen (a day older than the last year shows its year).
api.on("desk:pane", (payload) => {
  const { pane, day } = (payload ?? {}) as { pane?: unknown; day?: unknown };
  if (pane !== "history" || typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  selected = day;
  const bounds = rangeBounds();
  const date = keyDate(day);
  if (date < bounds.start || date > bounds.end) range = date.getFullYear();
  render();
  document.querySelector<HTMLElement>(`.cell[data-key="${day}"]`)?.scrollIntoView({ block: "nearest" });
});
api.on("state", (state) => { document.documentElement.dataset.font = (state as AppState).prefs.font; });
void api.getState().then((state) => {
  document.documentElement.dataset.font = state.prefs.font;
  archivePath = state.storage.archivePath;
  // The folder's place is in 저장과 백업; here the link carries it as a tooltip.
  for (const element of document.querySelectorAll<HTMLElement>(".foot .folder button")) element.title = state.storage.archivePath;
});
void refresh();
