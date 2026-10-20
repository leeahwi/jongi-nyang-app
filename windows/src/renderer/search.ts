import type { SearchGroup, SearchRow } from "../core/search";
import { h, icon, paper, scrollFade, t } from "./api";
import { keyCap, slipHead, tape } from "./slip";

/**
 * 검색 (Ctrl+F): an M slip over the top of the note — a field in the hand, then what matched, grouped
 * 오늘 · 앞으로 · 메모 · 완료 기록 · 일정, each row with the match on a sage2 mark and a quiet date at the
 * right. ↑ ↓ walk the rows, Return opens one (a task: its tab, selected; a memo: opened; the record:
 * 완료 기록 on that day; an event: its sheet), Esc closes. Korean matches first consonants too (ㅂㄱㅅ).
 */

const api = paper();

export interface SearchHost {
  /** Where a result goes when chosen. */
  open(row: SearchRow): void;
  closed(): void;
}

const groupIcon: Record<SearchGroup["kind"], string> = { today: "sun", ahead: "calendar", memos: "note", history: "sprout", events: "calendarDot" };

export interface SearchSlip { close(): void; element: HTMLElement; set(query: string): Promise<void> }

export function openSearch(host: SearchHost, initial = ""): SearchSlip {
  const field = h("input", { type: "text", class: "search-field", placeholder: t("할 일 · 메모 · 기록 · 일정에서 찾기"), "aria-label": t("검색"), spellcheck: "false" });
  field.value = initial;
  const results = h("div", { class: "search-results", role: "listbox", "aria-label": t("검색 결과") });
  const empty = h("div", { class: "search-empty" });
  const head = slipHead({ icon: "search", tint: "sage", title: t("검색"), onClose: () => close(), closeLabel: t("닫기 (Esc)") });
  const foot = h("div", { class: "slip-foot search-foot" },
    h("div", { class: "keys" }, h("span", {}, keyCap("↑↓"), t("고르기")), h("span", {}, keyCap("Enter"), t("열기")), h("span", {}, keyCap("Esc"), t("닫기"))));
  const card = h("div", { class: "slip m search-slip", role: "dialog", "aria-label": t("검색") },
    tape("confirm"), head.element, h("div", { class: "search-line hand-field" }, icon("search", 16), field), results, empty, foot);
  const scrim = h("div", { class: "scrim search-scrim" });
  document.body.append(scrim, card);
  scrollFade(results);

  let rows: { row: SearchRow; element: HTMLElement }[] = [];
  let active = -1;
  let asked = 0;
  let closed = false;

  const highlight = (index: number, scroll = true) => {
    active = rows.length ? Math.max(0, Math.min(index, rows.length - 1)) : -1;
    rows.forEach(({ element }, position) => element.setAttribute("aria-selected", String(position === active)));
    if (scroll && active >= 0) rows[active].element.scrollIntoView({ block: "nearest" });
  };

  const draw = (groups: SearchGroup[], query: string) => {
    rows = [];
    const blocks = groups.map((group) => {
      const list = group.rows.map((row) => {
        const before = row.text.slice(0, row.range[0]), match = row.text.slice(row.range[0], row.range[1]), after = row.text.slice(row.range[1]);
        const element = h("button", { class: `search-row${row.done ? " done" : ""}`, role: "option", "aria-selected": "false", title: row.text },
          h("span", { class: "search-text" }, before, match ? h("mark", {}, match) : null, after),
          row.meta ? h("span", { class: "search-meta" }, row.meta) : null);
        const index = rows.length;
        element.addEventListener("mouseenter", () => highlight(index, false));
        element.addEventListener("click", () => choose(index));
        rows.push({ row, element });
        return element;
      });
      const more = group.count > group.rows.length ? h("div", { class: "search-more" }, t("+{n}개 더", { n: group.count - group.rows.length })) : null;
      return h("div", { class: "search-group", role: "group", "aria-label": group.title },
        h("div", { class: "search-head" }, icon(groupIcon[group.kind], 13), h("span", {}, group.title), h("span", { class: "search-count" }, String(group.count))), ...list, more);
    });
    results.replaceChildren(...blocks);
    results.hidden = blocks.length === 0;
    empty.hidden = blocks.length > 0;
    empty.textContent = query.trim() ? t("‘{query}’에 맞는 게 없어요", { query: query.trim() }) : t("초성으로도 찾을 수 있어요 (예: ㅂㄱㅅ → 보고서)");
    highlight(0, false);
    results.scrollTop = 0;
  };

  const run = async (query: string) => {
    const ticket = ++asked;
    const groups = query.trim() ? await api.search(query) : [];
    if (ticket !== asked || closed) return;
    draw(groups, query);
  };

  const choose = (index: number) => {
    const picked = rows[index]?.row;
    if (!picked) return;
    close();
    host.open(picked);
  };

  field.addEventListener("input", () => void run(field.value));
  field.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); highlight(active + (event.key === "ArrowDown" ? 1 : -1)); }
    else if (event.key === "Enter") { event.preventDefault(); choose(active); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  });
  card.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); close(); } });
  scrim.addEventListener("click", () => close());

  function close(): void {
    if (closed) return;
    closed = true;
    card.remove();
    scrim.remove();
    host.closed();
  }

  void run(initial);
  requestAnimationFrame(() => { field.focus(); if (field.value === initial) field.select(); });
  return { close, element: card, set: async (query: string) => { field.value = query; field.setSelectionRange(query.length, query.length); await run(query); } };
}
