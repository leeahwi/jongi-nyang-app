import type { Lang } from "./lang";
import { dayMonth, monthName, spokenTime, weekdayName } from "./lang";
import type { Memo } from "./memo";
import { checklistLine, checklistProgress, sheetCount, slipSummary, type FolderSort } from "./memoDrawer";

/**
 * 메모 서랍's cards (1.29, the user's ③ 날짜 묶음 + 카드): the list in date groups (Apple Notes' — 고정 · 오늘 · 어제 ·
 * 이번 주 · 지난주 · 10월 · 2025년 9월, weeks from Monday in every language), each card's short time (the header
 * already says the day), the kind a memo is (a checklist, a link, a phone number — found in its words, which
 * never change) and the words around them. The same rules and cases as the Mac (MemoCards.swift; D21–D29 in
 * the shared memo drawer cases).
 */

export type GroupKind = "pinned" | "today" | "yesterday" | "thisWeek" | "lastWeek" | "month" | "year" | "all";
export interface CardGroup {
  key: string;
  kind: GroupKind;
  label: string;
  /** 제목 순's one group has a header only under a 고정 group (D24). */
  header: boolean;
  memos: Memo[];
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/** D22: the date group of a time — today (a future time too), yesterday, this week (from Monday), last week, a month of this year, or a month of an earlier year. */
export function dateGroup(at: Date, now: Date): { kind: Exclude<GroupKind, "pinned" | "all">; key: string } {
  const today = startOfDay(now);
  if (at >= today) return { kind: "today", key: "today" };
  if (at >= addDays(today, -1)) return { kind: "yesterday", key: "yesterday" };
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  if (at >= monday) return { kind: "thisWeek", key: "thisWeek" };
  if (at >= addDays(monday, -7)) return { kind: "lastWeek", key: "lastWeek" };
  if (at.getFullYear() === now.getFullYear()) return { kind: "month", key: `month-${at.getMonth() + 1}` };
  return { kind: "year", key: `year-${at.getFullYear()}-${at.getMonth() + 1}` };
}

const groupWords: Record<"pinned" | "today" | "yesterday" | "thisWeek" | "lastWeek" | "all", Record<Lang, string>> = {
  pinned: { ko: "고정", en: "Pinned", nl: "Vastgezet" },
  today: { ko: "오늘", en: "Today", nl: "Vandaag" },
  yesterday: { ko: "어제", en: "Yesterday", nl: "Gisteren" },
  thisWeek: { ko: "이번 주", en: "This week", nl: "Deze week" },
  lastWeek: { ko: "지난주", en: "Last week", nl: "Vorige week" },
  all: { ko: "메모", en: "Notes", nl: "Notities" },
};

/** A group's header: `오늘` … `10월` · `October` · `oktober`, `2025년 12월` · `December 2025` · `december 2025`. */
export function groupLabel(kind: GroupKind, at: Date | undefined, lang: Lang = "ko"): string {
  if (kind === "month") return monthName(at!.getMonth() + 1, lang);
  if (kind === "year") return lang === "ko" ? `${at!.getFullYear()}년 ${at!.getMonth() + 1}월` : `${monthName(at!.getMonth() + 1, lang)} ${at!.getFullYear()}`;
  return groupWords[kind][lang];
}

/**
 * A card's short time under a date header: 오늘 · 어제 the clock (`오후 6:02` · `6:02 PM` · `18:02`), this and last
 * week the weekday (`화요일`), a month `13일` · `Oct 13` · `13 okt`, an earlier year `9월 13일`. Without a date
 * header (고정, 제목 순, search) the time says the day (`dayTime`).
 */
export function cardTime(at: Date, kind: GroupKind, now: Date, lang: Lang = "ko"): string {
  if (Number.isNaN(at.getTime())) return "";
  switch (kind) {
    case "today": case "yesterday": return spokenTime(at.getHours(), at.getMinutes(), lang);
    case "thisWeek": case "lastWeek": return weekdayName(at.getDay(), lang);
    case "month": return lang === "ko" ? `${at.getDate()}일` : dayMonth(at.getMonth() + 1, at.getDate(), undefined, lang);
    case "year": return dayMonth(at.getMonth() + 1, at.getDate(), undefined, lang);
    default: return dayTime(at, now, lang);
  }
}

/** The time with its day, where no header says it: today the clock, `어제`, `10월 13일`, `2025년 10월 13일`. */
export function dayTime(at: Date, now: Date, lang: Lang = "ko"): string {
  if (Number.isNaN(at.getTime())) return "";
  const today = startOfDay(now);
  if (at >= today && at < addDays(today, 1)) return spokenTime(at.getHours(), at.getMinutes(), lang);
  if (at >= addDays(today, -1) && at < today) return groupWords.yesterday[lang];
  return dayMonth(at.getMonth() + 1, at.getDate(), at.getFullYear() !== now.getFullYear() ? at.getFullYear() : undefined, lang);
}

/** The open memo's bar: `오후 5:38 고침` · `Edited 5:38 PM` · `Bewerkt 17:38`, `어제 고침`, `화요일 고침`, `10월 13일 고침`, `2025년 10월 13일 고침`. */
export function editedLabel(updatedAt: string, now: Date, lang: Lang = "ko"): string {
  const at = new Date(updatedAt);
  if (Number.isNaN(at.getTime())) return "";
  const { kind } = dateGroup(at, now);
  let when: string;
  switch (kind) {
    case "today": when = spokenTime(at.getHours(), at.getMinutes(), lang); break;
    case "yesterday": when = lang === "ko" ? "어제" : lang === "en" ? "yesterday" : "Gisteren"; break;
    case "thisWeek": case "lastWeek": when = weekdayName(at.getDay(), lang); break;
    default: when = dayMonth(at.getMonth() + 1, at.getDate(), kind === "year" ? at.getFullYear() : undefined, lang);
  }
  if (lang === "ko") return `${when} 고침`;
  if (lang === "en") return `Edited ${when}`;
  // Dutch puts a day word first (`Gisteren bewerkt`, `Dinsdag bewerkt`), a time or a date after (`Bewerkt 17:38`).
  if (kind === "yesterday" || kind === "thisWeek" || kind === "lastWeek") return `${when.charAt(0).toUpperCase()}${when.slice(1)} bewerkt`;
  return `Bewerkt ${when}`;
}

// ─── Sorting and grouping ─────────────────────────────────────────────────────

const collator = new Intl.Collator("und", { numeric: true, sensitivity: "accent" });
const timeOf = (memo: Memo, sort: FolderSort) => (sort === "created" ? memo.createdAt : memo.updatedAt);

/**
 * 정렬: 고친 순 newest edit first, 만든 순 newest first, 제목 순 by the card's title (case ignored, numbers by
 * value, Latin before Hangul; a tie: the newer edit first). Equal times keep the memos' order.
 */
export function sortMemos(memos: readonly Memo[], sort: FolderSort, lang: Lang = "ko"): Memo[] {
  const indexed = memos.map((memo, index) => ({ memo, index, title: sort === "title" ? cardTitle(memo, lang) : "" }));
  indexed.sort((a, b) => {
    if (sort === "title") {
      const byTitle = collator.compare(a.title, b.title);
      if (byTitle) return byTitle;
      return b.memo.updatedAt.localeCompare(a.memo.updatedAt) || a.index - b.index;
    }
    return timeOf(b.memo, sort).localeCompare(timeOf(a.memo, sort)) || a.index - b.index;
  });
  return indexed.map((entry) => entry.memo);
}

/**
 * D23, D24: a bookmark's memos as the list shows them — the folder's pinned ones first under 고정 (not in the 고정
 * bookmark's own view), then the rest in date groups by the sorted time (제목 순: one group, its header only under
 * a 고정 group).
 */
export function groupMemos(memos: readonly Memo[], options: { pinned: (id: string) => boolean; pinnedView: boolean; sort: FolderSort; now: Date; lang?: Lang }): CardGroup[] {
  const { pinned, pinnedView, sort, now } = options;
  const lang = options.lang ?? "ko";
  const sorted = sortMemos(memos, sort, lang);
  const top = pinnedView ? [] : sorted.filter((memo) => pinned(memo.id));
  const rest = pinnedView ? sorted : sorted.filter((memo) => !pinned(memo.id));
  const groups: CardGroup[] = [];
  if (top.length) groups.push({ key: "pinned", kind: "pinned", label: groupLabel("pinned", undefined, lang), header: true, memos: top });
  if (rest.length === 0) return groups;
  if (sort === "title") {
    groups.push({ key: "all", kind: "all", label: groupLabel("all", undefined, lang), header: top.length > 0, memos: rest });
    return groups;
  }
  for (const memo of rest) {
    const at = new Date(timeOf(memo, sort));
    const group = Number.isNaN(at.getTime()) ? { kind: "year" as const, key: "year-0" } : dateGroup(at, now);
    const last = groups[groups.length - 1];
    if (last && last.key === group.key) last.memos.push(memo);
    else groups.push({ key: group.key, kind: group.kind, label: Number.isNaN(at.getTime()) ? "" : groupLabel(group.kind, at, lang), header: true, memos: [memo] });
  }
  return groups;
}

/** A card's time: by its group's rule, from the time the list is sorted by (제목 순: the edit time). */
export function memoCardTime(memo: Memo, kind: GroupKind, sort: FolderSort, now: Date, lang: Lang = "ko"): string {
  return cardTime(new Date(sort === "created" ? memo.createdAt : memo.updatedAt), kind, now, lang);
}

// ─── Kinds ────────────────────────────────────────────────────────────────────

export type MemoKind =
  | { kind: "checklist"; done: number; total: number }
  | { kind: "link"; url: string; label: string; host: string }
  | { kind: "phone"; number: string };

const trailing = /[.,;:!?)\]}>'"’”]+$/;

/** D25: the first `http(s)://…` with a host (trailing punctuation off): the URL as written, and `host/path` for its chip. */
export function findLink(text: string): { url: string; label: string; host: string } | undefined {
  for (const match of text.matchAll(/https?:\/\/\S+/gi)) {
    const url = match[0].replace(trailing, "");
    let parsed: URL;
    try { parsed = new URL(url); } catch { continue; }
    if (!parsed.hostname) continue;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    return { url, label: `${host}${path}`, host };
  }
  return undefined;
}

/** D26: the first Korean phone number (9–11 digits from 0; `02` a two-digit area, else three): `010-1234-5678`. */
export function findPhone(text: string): string | undefined {
  for (const match of text.matchAll(/(?<!\d)0\d{1,2}[ .-]?\d{3,4}[ .-]?\d{4}(?!\d)/g)) {
    const digits = match[0].replace(/\D/g, "");
    const seoul = digits.startsWith("02");
    const area = seoul ? 2 : 3;
    if (digits.length < (seoul ? 9 : 10) || digits.length > (seoul ? 10 : 11)) continue;
    const rest = digits.slice(area);
    const middle = rest.length - 4;
    return `${digits.slice(0, area)}-${rest.slice(0, middle)}-${rest.slice(middle)}`;
  }
  return undefined;
}

/** D25, D26: what a memo is, the first found — checklist, then link, then phone; none for plain words. */
export function memoKind(text: string): MemoKind | undefined {
  const progress = checklistProgress(text);
  if (progress) return { kind: "checklist", ...progress };
  const link = findLink(text);
  if (link) return { kind: "link", ...link };
  const phone = findPhone(text);
  return phone ? { kind: "phone", number: phone } : undefined;
}

const linkWords: Record<Lang, (host: string) => string> = { ko: (host) => `${host} 링크`, en: (host) => `${host} link`, nl: (host) => `${host}-link` };

/** The card's title: the memo's title, or `youtube.com 링크` when the title line is just a URL (D25b, D25g). */
export function cardTitle(memo: Memo, lang: Lang = "ko"): string {
  const line = memo.text.split("\n").find((entry) => entry.trim())?.trim();
  if (line && /^https?:\/\/\S+$/i.test(line)) {
    const link = findLink(line);
    if (link) return linkWords[lang](link.host);
  }
  return slipSummary(memo, lang).title;
}

/** The card's one preview line: the first line with words after the title that isn't a checklist line (a checklist shows its chip). */
export function previewLine(memo: Memo): string | undefined {
  const lines = memo.text.split("\n").filter((line) => line.trim());
  return lines.slice(1).find((line) => !checklistLine(line))?.trim();
}

/** A row of a card's preview: a line's words, or a checklist item (`checked` set). */
export interface PreviewRow { checked?: boolean; text: string }

/**
 * What a card shows under its title (D30, #14): a checklist memo its first `limit` items, ticked or not; any other memo
 * its first `limit` lines with words after the title, trimmed (the card wraps them into at most `limit` lines, … at the
 * end). Blank lines are skipped, so a short memo shows only what it has. Each row is cut at 300 characters (more never
 * fits in three lines); a checklist stops reading at its `limit`-th item. Same rule as the Mac app.
 */
export function previewRows(text: string, limit = 3): PreviewRow[] {
  const items: PreviewRow[] = [];
  const lines: PreviewRow[] = [];
  if (limit <= 0) return items;
  const cut = (words: string) => (words.length > 300 ? words.slice(0, 300) : words);
  let titled = false;
  for (let start = 0; start <= text.length;) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    if (!line.trim()) continue;
    // The title: the first line with words (a checklist's first item is its title, not one of the rows).
    if (!titled) { titled = true; continue; }
    const item = checklistLine(line);
    if (item) {
      const words = item.text.trim();
      if (!words) continue;
      items.push({ checked: item.checked, text: cut(words) });
      if (items.length === limit) return items;
    } else if (lines.length < limit) {
      lines.push({ text: cut(line.trim()) });
    }
  }
  return items.length ? items : lines;
}

// ─── Tape and words ───────────────────────────────────────────────────────────

/** A memo's tape: x from 20 % to 65 % of the card's width and a turn of ±2°, both from its id (the same on every redraw). */
export function tapePlace(id: string): { left: number; turn: number } {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return { left: 20 + (hash % 4501) / 100, turn: ((hash >>> 16) % 401) / 100 - 2 };
}

/** The footer: `회사 · 다섯 장` · `Work · 5 notes` · `Werk · 5 notities` (고정 likewise); none: the folder's empty words. */
export function footerWords(name: string, count: number, lang: Lang = "ko"): string {
  return `${name} · ${sheetCount(count, lang)}`;
}

/** A bookmark's small label: `장보기 · 세 장 · Ctrl+3` (no key past the ninth; an empty one says so). */
export function bookmarkTip(name: string, count: number, key: string | undefined, lang: Lang = "ko"): string {
  const how = count > 0 ? sheetCount(count, lang) : { ko: "비어 있어요", en: "empty", nl: "leeg" }[lang];
  return [name, how, key].filter(Boolean).join(" · ");
}

/**
 * D29: a deleted folder's toast — `메모 두 장은 ‘메모’ 폴더로 옮겼어요` · `2 notes moved to ‘Notes’` · `2 notities
 * verplaatst naar ‘Notities’`; an empty folder `‘회사’ 폴더를 지웠어요` · `Deleted the folder ‘Work’` · `Map ‘Werk’ verwijderd`.
 */
export function folderDeletedWords(name: string, moved: number, inbox: string, lang: Lang = "ko"): string {
  if (moved === 0) return { ko: `‘${name}’ 폴더를 지웠어요`, en: `Deleted the folder ‘${name}’`, nl: `Map ‘${name}’ verwijderd` }[lang];
  if (lang === "en") return `${sheetCount(moved, lang)} moved to ‘${inbox}’`;
  if (lang === "nl") return `${sheetCount(moved, lang)} verplaatst naar ‘${inbox}’`;
  return `메모 ${sheetCount(moved, lang)}은 ‘${inbox}’ 폴더로 옮겼어요`;
}
