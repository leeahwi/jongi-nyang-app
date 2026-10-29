import { dayKey } from "./archive";
import { isoDate } from "./notebook";
import type { Lang } from "./lang";

/**
 * 종이냥 for Claude (1.27): the extension Claude starts (mcp/) reads and writes the same files as the app,
 * and the two know about each other through two files in the settings folder — never through todos.json,
 * which gets no new keys:
 *
 *   ai-link.json   written by the app: whether 설정 › AI 연결 is on, the data folder, the language.
 *   ai-log.jsonl   one line per thing Claude added or changed (and per undo made here). Toasts, the
 *                  away notice, undo and the stamps on rows all come from it.
 *
 * Same formats and rules as the macOS app (the shared AI connection spec §2–3, cases M1–M18).
 */

export const aiLinkFileName = "ai-link.json";
export const aiLogFileName = "ai-log.jsonl";
/** Held for the few milliseconds of a read–change–write by the extension and (while AI 연결 is on) the app, on this device only. */
export const aiLockFileName = "ai-write.lock";

export interface AiLink {
  v: 1;
  enabled: boolean;
  /** The folder with todos.json (the default one or the shared folder chosen). */
  dataFolder: string;
  /** The language the app speaks (never "auto"). */
  lang: Lang;
  /** "windows 1.27.0", "mac 1.42.0". */
  app: string;
  updatedAt: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isLang = (value: unknown): value is Lang => value === "ko" || value === "en" || value === "nl";

/** ai-link.json, or undefined when it doesn't read (then Claude is told to turn it on). */
export function parseAiLink(text: string): AiLink | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (!isObject(value)) return undefined;
  return {
    v: 1, enabled: value.enabled === true, dataFolder: typeof value.dataFolder === "string" ? value.dataFolder : "",
    lang: isLang(value.lang) ? value.lang : "ko", app: typeof value.app === "string" ? value.app : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

export function serializeAiLink(link: AiLink): string {
  const { v, enabled, dataFolder, lang, app, updatedAt } = link;
  return JSON.stringify({ v, enabled, dataFolder, lang, app, updatedAt }, null, 2) + "\n";
}

/** The words every tool answers with while AI 연결 is off (or was never turned on). */
export function aiOffText(lang: Lang): string {
  return {
    ko: "종이냥 설정 › AI 연결에서 켜 주세요.",
    en: "Turn it on in 종이냥 Settings › AI connection.",
    nl: "Zet het aan in 종이냥 Instellingen › AI-koppeling.",
  }[lang];
}

// ─── ai-log.jsonl ─────────────────────────────────────────────────────────────

export type AiKind = "add" | "change" | "undo";
export type AiTarget = "todos" | "events" | "memos";
export type AiFile = "todos.json" | "events.json" | "memos.json";
export type AiItem = Record<string, unknown> & { id: string };

/** One item as it was and as it became; null before = added, null after = taken out (an undo of an add). */
export interface AiChange { file: AiFile; id: string; before: AiItem | null; after: AiItem | null }

export interface AiLogEntry {
  v: 1;
  id: string;
  /** Whole-second ISO "Z". */
  at: string;
  /** "Claude", "Claude Code", or "app" for an undo made here. */
  client: string;
  tool: string;
  kind: AiKind;
  target: AiTarget;
  count: number;
  /** The first item's title after the change (for an undo: the undone entry's). */
  title: string;
  changes: AiChange[];
  /** An undo: the entry it took back. */
  undoes?: string;
}


function readChange(value: unknown): AiChange | undefined {
  if (!isObject(value) || typeof value.id !== "string") return undefined;
  const file = value.file === "todos.json" || value.file === "events.json" || value.file === "memos.json" ? value.file : undefined;
  const item = (side: unknown): AiItem | null | undefined => (side === null || side === undefined ? null : isObject(side) && typeof side.id === "string" ? side as AiItem : undefined);
  const before = item(value.before), after = item(value.after);
  if (!file || before === undefined || after === undefined) return undefined;
  return { file, id: value.id, before, after };
}

/** The entries of an ai-log.jsonl text in file order; unreadable lines (a torn last line) are left out. */
export function parseAiLog(text: string): AiLogEntry[] {
  const entries: AiLogEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    if (!isObject(value) || typeof value.id !== "string" || typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) continue;
    const kind = value.kind === "add" || value.kind === "change" || value.kind === "undo" ? value.kind : undefined;
    const target = value.target === "todos" || value.target === "events" || value.target === "memos" ? value.target : undefined;
    if (!kind || !target || !Array.isArray(value.changes)) continue;
    const changes = value.changes.map(readChange).filter((change): change is AiChange => Boolean(change));
    entries.push({
      v: 1, id: value.id, at: value.at, client: typeof value.client === "string" ? value.client : "Claude", tool: typeof value.tool === "string" ? value.tool : "",
      kind, target, count: typeof value.count === "number" ? value.count : changes.length, title: typeof value.title === "string" ? value.title : "", changes,
      ...(typeof value.undoes === "string" ? { undoes: value.undoes } : {}),
    });
  }
  return entries;
}

/** One line of the log (no newline), keys in a fixed order. */
export function aiLogLine(entry: AiLogEntry): string {
  const { v, id, at, client, tool, kind, target, count, title, changes, undoes } = entry;
  return JSON.stringify({ v, id, at, client, tool, kind, target, count, title, ...(undoes ? { undoes } : {}), changes });
}

/** A new entry's frame: an id and the time now. */
export function aiEntry(fields: Omit<AiLogEntry, "v" | "id" | "at" | "count"> & { count?: number }, now = new Date(), id = crypto.randomUUID()): AiLogEntry {
  return { v: 1, id, at: isoDate(now), ...fields, count: fields.count ?? fields.changes.length };
}

/** Entries an undo (here or on the Mac) has taken back. */
export const undoneIds = (entries: readonly AiLogEntry[]): Set<string> =>
  new Set(entries.filter((entry) => entry.kind === "undo" && entry.undoes).map((entry) => entry.undoes!));

/** Something Claude did (not an undo made in an app). */
export const isAiWork = (entry: AiLogEntry): boolean => (entry.kind === "add" || entry.kind === "change") && entry.client !== "app";

/** The last entry the app has dealt with ("seen until"), kept in its own settings. */
export interface AiSeen { id: string; at: string }

/**
 * The entries after `seen`: after that line while it is still in the log, otherwise (the log was trimmed)
 * the ones written later than it. Nothing seen yet: all of them.
 */
export function unseenAi(entries: readonly AiLogEntry[], seen: AiSeen | undefined): AiLogEntry[] {
  if (!seen) return [...entries];
  const index = entries.map((entry) => entry.id).lastIndexOf(seen.id);
  if (index >= 0) return entries.slice(index + 1);
  const since = Date.parse(seen.at);
  return entries.filter((entry) => Date.parse(entry.at) > since);
}

/** "Seen until" after `entries` (unchanged when there are none). */
export const advanceSeen = (seen: AiSeen | undefined, entries: readonly AiLogEntry[]): AiSeen | undefined =>
  entries.length ? { id: entries[entries.length - 1].id, at: entries[entries.length - 1].at } : seen;

/** 자리 비운 사이: how many items Claude added or changed while the app was closed, less what was taken back (M15). */
export const awayCount = (unseen: readonly AiLogEntry[], undone: ReadonlySet<string>): number =>
  unseen.filter((entry) => isAiWork(entry) && !undone.has(entry.id)).reduce((sum, entry) => sum + entry.count, 0);

/** 설정 › AI 연결 › 최근 AI 작업: today's and yesterday's work (4 a.m. days), newest first. */
export function recentAi(entries: readonly AiLogEntry[], now: Date): AiLogEntry[] {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  return entries.filter((entry) => isAiWork(entry) && [today, yesterday].includes(dayKey(new Date(entry.at)))).reverse();
}

/**
 * The log rewritten once it grew past `maxBytes`: the lines of the last `days` days (broken lines go too).
 * Undefined while it is small enough, or when nothing would go.
 */
export function trimAiLog(text: string, now: Date, maxBytes = 1_000_000, days = 30): string | undefined {
  if (new TextEncoder().encode(text).length <= maxBytes) return undefined;
  const since = now.getTime() - days * 86_400_000;
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const kept = lines.filter((line) => { const [entry] = parseAiLog(line); return entry !== undefined && Date.parse(entry.at) >= since; });
  if (kept.length === lines.length) return undefined;
  return kept.length ? kept.join("\n") + "\n" : "";
}

// ─── Comparing and undoing ────────────────────────────────────────────────────

const targetOf: Record<AiFile, AiTarget> = { "todos.json": "todos", "events.json": "events", "memos.json": "memos" };
export const aiTargetOf = (file: AiFile): AiTarget => targetOf[file];

/**
 * The fields a person sees and edits. Bookkeeping (createdAt, completedAt, updatedAt, 어제부터's todaySince, a
 * delivered alert, skipped days) never makes an item "changed since". Same keys as the Mac (AIConnect.savedKeys).
 */
const savedKeys: Record<AiTarget, readonly string[]> = {
  todos: ["title", "isCompleted", "dueDate", "shelf", "timeStart", "timeEnd", "reminderAt", "seriesID"],
  events: ["title", "date", "allDay", "days", "start", "end", "repeat", "location", "color"],
  memos: ["text"],
};
const dateKeys = new Set(["reminderAt"]);

/** One field: a missing key equals null, a missing flag equals false, times are compared as instants (whole seconds). */
function sameField(a: unknown, b: unknown, date: boolean): boolean {
  const x = a ?? null, y = b ?? null;
  if (date && typeof x === "string" && typeof y === "string" && !Number.isNaN(Date.parse(x)) && !Number.isNaN(Date.parse(y))) {
    return Math.floor(Date.parse(x) / 1000) === Math.floor(Date.parse(y) / 1000);
  }
  if ((x === null && y === false) || (y === null && x === false)) return true;
  return JSON.stringify(x) === JSON.stringify(y);
}

/** The same item as far as a person can tell (missing on both sides counts as the same). */
export function sameSaved(target: AiTarget, a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return savedKeys[target].every((key) => sameField(a[key], b[key], dateKeys.has(key)));
}

/** What undoing one change does to the item as it is now (undefined: not there). */
export type UndoStep = { kind: "restore"; item: AiItem } | { kind: "remove" } | { kind: "alreadyBack" } | { kind: "changedSince" };

export function undoStep(change: AiChange, target: AiTarget, current: Record<string, unknown> | undefined): UndoStep {
  if (sameSaved(target, current, change.after)) {
    if (change.before) return sameSaved(target, current, change.before) ? { kind: "alreadyBack" } : { kind: "restore", item: change.before };
    return current ? { kind: "remove" } : { kind: "alreadyBack" };
  }
  return sameSaved(target, current, change.before) ? { kind: "alreadyBack" } : { kind: "changedSince" };
}

/**
 * An entry taken back from `items` (the file's list as it is now): an item still as Claude left it goes back to
 * `before` (an added one goes); one already back counts as undone; one changed since is left alone (M13 · M14).
 * `written` is what the undo wrote (before: the item as it was, after: the item put back, or null), for its entry.
 */
export function undoEntry<T extends { id: string }>(items: readonly T[], entry: AiLogEntry): { items: T[]; undone: number; left: number; written: AiChange[] } {
  const next = [...items];
  const written: AiChange[] = [];
  let undone = 0, left = 0;
  for (const change of entry.changes) {
    const index = next.findIndex((item) => item.id.toUpperCase() === change.id.toUpperCase());
    const current = index >= 0 ? next[index] as unknown as AiItem : undefined;
    const step = undoStep(change, entry.target, current);
    if (step.kind === "changedSince") { left += 1; continue; }
    undone += 1;
    if (step.kind === "alreadyBack") continue;
    if (step.kind === "remove") next.splice(index, 1);
    else if (index >= 0) next[index] = { ...step.item } as unknown as T;
    else next.push({ ...step.item } as unknown as T);
    written.push({ file: change.file, id: change.id, before: current ? { ...current } : null, after: step.kind === "restore" ? { ...step.item } : null });
  }
  return { items: written.length ? next : [...items], undone, left, written };
}

/** To-do ids are UUIDs, compared upper-cased; events keep theirs. */
export const markId = (id: string, target: AiTarget): string => (target === "todos" ? id.toUpperCase() : id);

/**
 * The rows that get the small stamp: to-dos and events Claude added or changed today (the 4 a.m. day), not
 * taken back, and still as Claude left them — an edit (here or elsewhere) takes the stamp away. `current`
 * finds an item as it is now.
 */
export function aiMarks(entries: readonly AiLogEntry[], now: Date, current: (target: AiTarget, id: string) => Record<string, unknown> | undefined): Set<string> {
  const today = dayKey(now);
  const undone = undoneIds(entries);
  const last = new Map<string, { target: AiTarget; change: AiChange }>();
  for (const entry of entries) {
    if (dayKey(new Date(entry.at)) !== today) continue;
    if (entry.kind === "undo") { for (const change of entry.changes) if (!change.after) last.delete(markId(change.id, entry.target)); continue; }
    if (!isAiWork(entry) || entry.target === "memos" || undone.has(entry.id)) continue;
    for (const change of entry.changes) if (change.after) last.set(markId(change.id, entry.target), { target: entry.target, change });
  }
  const marks = new Set<string>();
  for (const [id, { target, change }] of last) if (sameSaved(target, current(target, change.id), change.after)) marks.add(id);
  return marks;
}

// ─── Words (the same table as the Mac's AIText) ───────────────────────────────

/** "할 일" · "task(s)" · "taak/taken"; memos are "note(s)" in English, as in the app. */
export function aiUnit(target: AiTarget, count: number, lang: Lang): string {
  const one = count === 1;
  const words: Record<AiTarget, [string, string, string, string, string]> = {
    todos: ["할 일", "task", "tasks", "taak", "taken"],
    events: ["일정", "event", "events", "afspraak", "afspraken"],
    memos: ["메모", "note", "notes", "notitie", "notities"],
  };
  const [ko, en1, en2, nl1, nl2] = words[target];
  return lang === "ko" ? ko : lang === "en" ? (one ? en1 : en2) : one ? nl1 : nl2;
}

/** A long title cut so the toast stays on a line or two: the first line, 23 characters and "…". */
export function aiShortTitle(title: string, limit = 24): string {
  const clean = (title.split(/\r?\n/)[0] ?? "").trim();
  return [...clean].length > limit ? `${[...clean].slice(0, limit - 1).join("")}…` : clean;
}

export type AiChangeKind = "time" | "date" | "done" | "other";

/** For a change of one item: what Claude changed, for the toast's words. */
export function aiChangeKind(change: AiChange): AiChangeKind {
  const { before, after } = change;
  if (!before || !after) return "other";
  const ignored = new Set(["updatedAt", "createdAt", "completedAt", "todaySince", "reminderLastDeliveredAt"]);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)].filter((key) => !ignored.has(key) && !sameField(before[key], after[key], dateKeys.has(key))));
  if (keys.size === 0) return "other";
  if (keys.has("isCompleted")) return after.isCompleted === true ? "done" : "other";
  const rest = [...keys].filter((key) => key !== "reminderAt");
  if (rest.length === 0) return "time";
  if (rest.every((key) => ["timeStart", "timeEnd", "start", "end", "allDay"].includes(key))) return "time";
  if (rest.every((key) => ["dueDate", "shelf", "date", "days"].includes(key))) return "date";
  return "other";
}

/**
 * The toast for Claude's entry: "Claude가 할 일 2개를 넣었어요" · "Claude added 2 tasks"; one item's time, date
 * or check: "Claude가 ‘보고서 쓰기’ 시간을 바꿨어요"; several: "Claude가 할 일 3개를 바꿨어요".
 */
export function aiToastText(entry: AiLogEntry, lang: Lang): string {
  const n = entry.count;
  const unit = aiUnit(entry.target, n, lang);
  const pick = (ko: string, en: string, nl: string) => (lang === "ko" ? ko : lang === "en" ? en : nl);
  if (entry.kind === "add") return pick(`Claude가 ${unit} ${n}개를 넣었어요`, `Claude added ${n} ${unit}`, `Claude heeft ${n} ${unit} toegevoegd`);
  const change = entry.changes[0];
  if (n !== 1 || !change) return pick(`Claude가 ${unit} ${n}개를 바꿨어요`, `Claude changed ${n} ${unit}`, `Claude heeft ${n} ${unit} gewijzigd`);
  const title = aiShortTitle(entry.title || String(change.after?.title ?? ""));
  switch (aiChangeKind(change)) {
    case "time": return pick(`Claude가 ‘${title}’ 시간을 바꿨어요`, `Claude changed the time of ‘${title}’`, `Claude heeft de tijd van ‘${title}’ gewijzigd`);
    case "date": return pick(`Claude가 ‘${title}’ 날짜를 바꿨어요`, `Claude changed the date of ‘${title}’`, `Claude heeft de datum van ‘${title}’ gewijzigd`);
    case "done": return pick(`Claude가 ‘${title}’ 완료 표시를 했어요`, `Claude checked off ‘${title}’`, `Claude heeft ‘${title}’ afgevinkt`);
    case "other": return pick(`Claude가 ‘${title}’ ${entry.target === "events" ? "일정" : "할 일"}을 바꿨어요`, `Claude changed the ${unit} ‘${title}’`, `Claude heeft de ${unit} ‘${title}’ gewijzigd`);
  }
}

/** At launch, for what Claude did while the app was closed: "자리 비운 사이 Claude가 3가지를 했어요". */
export function aiAwayText(count: number, lang: Lang): string {
  return {
    ko: `자리 비운 사이 Claude가 ${count}가지를 했어요`,
    en: `While you were away, Claude made ${count} ${count === 1 ? "change" : "changes"}`,
    nl: `Terwijl je weg was, heeft Claude ${count} ${count === 1 ? "ding" : "dingen"} gedaan`,
  }[lang];
}

/** After 되돌리기: all back, some (partial), or nothing (M14). */
export function aiUndoText(undone: number, left: number, lang: Lang): string {
  if (undone === 0) return { ko: "그새 바뀌어서 되돌리지 못했어요", en: "It changed since, so it can’t be undone", nl: "Het is intussen gewijzigd, dus ongedaan maken lukt niet" }[lang];
  if (left === 0) return { ko: "되돌렸어요", en: "Undone", nl: "Ongedaan gemaakt" }[lang];
  return {
    ko: `${undone}개는 되돌리고, 그새 바뀐 ${left}개는 그대로 뒀어요`,
    en: `Undid ${undone}; ${left} changed since, so ${left === 1 ? "it stays" : "they stay"}`,
    nl: `${undone} ongedaan gemaakt; ${left} intussen gewijzigd, ${left === 1 ? "die blijft" : "die blijven"} staan`,
  }[lang];
}

/**
 * Now and then after a toast, a line in the cat's voice: for Claude's own work only, at most once in two hours
 * and half the time. Tasks or events added: "Claude가 할 일 두 개 놓고 갔어요."; otherwise "Claude랑 계획 세웠어요? 저도 볼게요."
 */
export function aiCatLine(entry: AiLogEntry, lastSaid: number | undefined, now: Date, random: () => number, lang: Lang): string | undefined {
  if (!isAiWork(entry)) return undefined;
  if (lastSaid !== undefined && now.getTime() - lastSaid < 2 * 3_600_000) return undefined;
  if (random() >= 0.5) return undefined;
  if (entry.kind === "add" && entry.target !== "memos") {
    const n = entry.count;
    const unit = aiUnit(entry.target, n, lang);
    if (lang === "ko") return `Claude가 ${unit} ${n === 1 ? "하나" : n <= 5 ? `${["두", "세", "네", "다섯"][n - 2]} 개` : `${n}개`} 놓고 갔어요.`;
    const word = n <= 5 ? (lang === "en" ? ["one", "two", "three", "four", "five"] : ["één", "twee", "drie", "vier", "vijf"])[n - 1] : String(n);
    return lang === "en" ? `Claude left ${word} ${unit} for you.` : `Claude heeft ${word} ${unit} voor je klaargezet.`;
  }
  return { ko: "Claude랑 계획 세웠어요? 저도 볼게요.", en: "Did you make plans with Claude? Let me have a look too.", nl: "Samen met Claude plannen gemaakt? Ik kijk even mee." }[lang];
}

/** The buttons: 되돌리기 · 보기, and the recent list's mark on an entry taken back. */
export const aiUndoAction = (lang: Lang): string => ({ ko: "되돌리기", en: "Undo", nl: "Ongedaan maken" })[lang];
export const aiShowAction = (lang: Lang): string => ({ ko: "보기", en: "Show", nl: "Bekijken" })[lang];
export const aiUndoneLabel = (lang: Lang): string => ({ ko: "되돌림", en: "Undone", nl: "Ongedaan" })[lang];
