import { isoDate, newID } from "./notebook";
import { mergeText } from "./textMerge";
import type { Lang } from "./lang";

/** A free-form note on the back of the sheet; memos.json has the same shape as macOS. */
export interface Memo {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export function newMemo(now = new Date()): Memo {
  return { id: newID(), text: "", createdAt: isoDate(now), updatedAt: isoDate(now) };
}

export const isBlank = (memo: Memo) => memo.text.trim().length === 0;

const lines = (memo: Memo) => memo.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
/** The first line; an empty memo is "빈 메모", en "Empty note", nl "Lege notitie". */
export const memoTitle = (memo: Memo, lang: Lang = "ko") => lines(memo)[0] ?? { ko: "빈 메모", en: "Empty note", nl: "Lege notitie" }[lang];
export const memoPreview = (memo: Memo) => lines(memo).slice(1).join(" ");

export function parseMemos(json: string): Memo[] {
  const value = JSON.parse(json) as { memos?: Partial<Memo>[] };
  return (value.memos ?? []).filter((memo): memo is Memo =>
    typeof memo.id === "string" && typeof memo.text === "string" && typeof memo.createdAt === "string" && typeof memo.updatedAt === "string");
}

export function serializeMemos(memos: Memo[]): string {
  const sorted = memos.map((memo) => ({ createdAt: memo.createdAt, id: memo.id, text: memo.text, updatedAt: memo.updatedAt }));
  return JSON.stringify({ memos: sorted }, null, 2) + "\n";
}

/**
 * Another device saved memos while this one had changes of its own (`base`: the file as this
 * device last read or wrote it). Its memos are taken, except memos deleted here stay deleted and
 * memos changed here keep this device's edits; a memo both changed gets both edits joined
 * (mergeText). Newest first. The same rule as the macOS app (MemoFile.merge).
 */
export function mergeMemos(base: readonly Memo[], here: readonly Memo[], theirs: readonly Memo[], changedHere: ReadonlySet<string>, deletedHere: ReadonlySet<string>): Memo[] {
  const start = new Map(base.map((memo) => [memo.id, memo]));
  const other = new Map(theirs.map((memo) => [memo.id, memo]));
  const kept = here.filter((memo) => changedHere.has(memo.id)).map((memo) => {
    const their = other.get(memo.id);
    if (!their || their.text === memo.text) return memo;
    const updatedAt = their.updatedAt > memo.updatedAt ? their.updatedAt : memo.updatedAt;
    return { ...memo, text: mergeText(start.get(memo.id)?.text ?? "", memo.text, their.text), updatedAt };
  });
  const others = theirs.filter((memo) => !changedHere.has(memo.id) && !deletedHere.has(memo.id));
  return [...others, ...kept].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}


/**
 * 빠른 메모를 열 때 복사한 글 넣기: the text to put in the empty draft — what is on the clipboard, when it
 * changed since the memo last opened (`lastSeen`) and isn't blank; at most 4,000 characters. Nothing
 * when the draft already has words.
 */
export function clipboardPrefill(draft: string, clipboard: string, lastSeen: string | undefined): string | undefined {
  if (draft.trim() || lastSeen === undefined || clipboard === lastSeen) return undefined;
  const text = clipboard.replace(/\r\n/g, "\n").trim();
  return text ? text.slice(0, 4000) : undefined;
}
