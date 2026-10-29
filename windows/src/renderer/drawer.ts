import type { Memo } from "../core/memo";
import {
  bookmarkTip, cardTitle, dayTime, editedLabel, folderDeletedWords, footerWords, groupMemos, memoCardTime, memoKind, previewRows, tapePlace, type PreviewRow, type CardGroup, type GroupKind,
} from "../core/memoCards";
import {
  checklistLine, checklistProgress, drawerFooter, drawerSearch, folderColors, folderName, hasCheckedLines, inboxID, isCodeLine, memosIn, paperOf, pinnedView,
  placementOf, removeCheckedLines, resolveView, sheetCount, shortcutLabel, shownColor, sortOf, viewForDigit, visibleFolders,
  type DrawerBackdrop, type DrawerHit, type FolderSort, type MemoFolder, type MemoFolders, type MemoPaper,
} from "../core/memoDrawer";
import type { AppState } from "../core/types";
import { h, icon, lang, paper, scrollFade, t } from "./api";
import { toaster } from "./slip";
import { drawerCat } from "./drawerCat";
import { closeMenus, menuContains, menuOpen, openMenu, type MenuEntry } from "./drawerMenu";

/**
 * 메모 서랍 (1.28; 1.29 as the user chose it from the mocks): one folder at a time beside its bookmarks — the
 * paper with cat ears, the header (메모 서랍 · the folder's name ▾ for the folder list · 검색 · 위에 고정 · 닫기), the
 * quick-write slip under its tape, the memos as cards in date groups (고정 · 오늘 · 어제 · 이번 주 · 지난주 · 10월),
 * each with its tape, title, up to three preview lines (1.30, #14) and its kind (a link, a phone number, a checklist) as a chip; one
 * open at a time, edited where it is, with its two pills under it; the footer (⚙ · the folder and its count ·
 * the shortcut). Every action is in a menu too (⚙ = right-click on the paper; a memo's ⋯ = its right-click; a
 * bookmark's; the text menu while writing). Nothing runs while it sits still: it draws when the app's state
 * changes, and not at all while it is hidden.
 */
const api = paper();
const root = document.documentElement;
const stage = document.getElementById("stage")!;

let state: AppState | undefined;
let shown = false;
let dirty = true;
/** The day the list was last drawn for (its groups and short times say "today"). */
let renderedDay = "";
/** The folder (or 고정) shown; remembered by the main process as the last folder. */
let view: string | undefined;
/** The open memo, and whether its words are being edited (plain memos open straight into editing). */
let openID: string | undefined;
let editing = false;
let big = false;
/** The memos as they were when one was opened: typing moves it to the top of the file, not on the screen. */
let frozen: Map<string, Memo> | undefined;
let selectedID: string | undefined;
let searching = false;
let query = "";
/** The results once the keys pause (a search reads every memo); at once when the field is emptied. */
const searchPause = 80;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let side: "right" | "left" = "right";
let backdrop: DrawerBackdrop = "solid";

const folders = (): MemoFolders => state!.memoFolders;
const colorClass = (color: string) => `c-${shownColor(color)}`;
const currentView = () => resolveView(folders(), view);
const folderOf = (id: string) => visibleFolders(folders()).find((folder) => folder.id === id);
const viewName = (id = currentView()) => (id === pinnedView ? t("고정") : folderName(folderOf(id) ?? folders().folders[0], lang()));
const viewColor = (id = currentView()) => (id === pinnedView ? "yellow" : shownColor(folderOf(id)?.color ?? "lavender"));
const viewSort = (id = currentView()): FolderSort => (id === pinnedView ? state!.prefs.drawerPinnedSort : sortOf(folderOf(id)));
const memoOf = (id: string | undefined) => (id ? state?.memos.find((memo) => memo.id === id) : undefined);
const digitKey = (index: number) => (index < 9 ? `Ctrl+${index + 1}` : undefined);

// ─── The frame ────────────────────────────────────────────────────────────────

const tabs = h("div", { class: "tabs", role: "tablist", "aria-label": t("폴더") });
const dr = h("div", { class: "dr" });
const cat = drawerCat();
const grip = h("div", { class: "grip", title: t("끌어서 폭 바꾸기"), "aria-hidden": "true" });
const sub = h("div", { class: "sub" }, t("메모 서랍"));
const title = h("span", { class: "hw" });
const folderButton = h("button", { class: "fname", "aria-haspopup": "menu", "aria-expanded": "false", title: t("폴더 목록 (Ctrl+L)") }, title, h("span", { class: "chev" }, icon("chevron", 11, 2)));
const findInput = h("input", { type: "search", placeholder: t("모든 폴더에서 찾기"), "aria-label": t("메모 찾기"), spellcheck: "false" });
const find = h("div", { class: "find", hidden: "" }, findInput);
const searchButton = h("button", { class: "ib", title: t("검색 (Ctrl+F)"), "aria-label": t("검색") }, icon("search", 15));
const pinButton = h("button", { class: "ib", title: t("다른 창 위에 띄우기"), "aria-label": t("다른 창 위에 띄우기") }, icon("pin", 15));
const closeButton = h("button", { class: "ib", title: t("서랍 닫기"), "aria-label": t("서랍 닫기") }, icon("close", 14));
const header = h("div", { class: "hd" }, sub, h("div", { class: "ttl" }, folderButton, find, h("span", { class: "ic" }, searchButton, pinButton, closeButton)));
const tapeStrip = h("div", { class: "tape", "aria-hidden": "true" });
const quick = h("textarea", { rows: "1", placeholder: t("여기에 바로 적어요"), "aria-label": t("새 메모"), spellcheck: "false" });
const quickHint = h("div", { class: "qk-hint", hidden: "" }, h("span", {}, t("Enter 넣기")), h("span", {}, t("Shift+Enter 줄바꿈")));
const qk = h("div", { class: "qk" }, tapeStrip, quick, quickHint);
const list = h("div", { class: "list", role: "list", "aria-label": t("메모") });
const count = h("span", {});
const gearButton = h("button", { class: "gear", title: t("메모 서랍 메뉴"), "aria-label": t("메모 서랍 메뉴"), "aria-haspopup": "menu", "aria-expanded": "false" }, icon("gear", 15));
const keyHint = h("span", { class: "key" });
const footer = h("div", { class: "ft" }, gearButton, h("span", { class: "count" }, icon("pawPrint", 12), count), keyHint);
const toastHost = h("div", { class: "toast-host" });
const toast = toaster(toastHost);
const tip = h("div", { class: "tip", hidden: "", role: "tooltip" });
dr.append(cat.element, grip, header, qk, list, footer, toastHost, tip);
stage.append(tabs, dr);
scrollFade(list);
const menuHost = { container: dr, closed: () => { folderButton.setAttribute("aria-expanded", "false"); gearButton.setAttribute("aria-expanded", "false"); } };

// ─── Talking to the app ───────────────────────────────────────────────────────

/** Every action goes after the open memo's typed text still waiting to be sent (as when each key was sent). */
const act = (action: Parameters<typeof api.act>[0]) => {
  if (action.type !== "memoUpdate") editor?.flush();
  void api.act(action);
};
function close(): void {
  api.send("drawer:close");
}
function setView(next: string): void {
  closeOpen();
  if (searching) leaveSearch(false);
  view = next;
  selectedID = undefined;
  act({ type: "drawerView", view: next });
  render();
  list.scrollTop = 0;
}

// ─── The open memo's editor: the first line in handwriting, the rest below ────

interface Editor {
  id: string; titleField: HTMLInputElement; body: HTMLTextAreaElement;
  /** The last few texts sent (a state that comes back with one of them is this editor's own echo). */
  sent: Set<string>;
  /** The text last sent. */
  value: string;
  composing: boolean;
  /** Typed and not sent yet. */
  waiting: boolean;
  /** Sends what's typed now, if anything waits. */
  flush: () => void;
  /** Sends what's typed now through the main process at once, which saves it (the page is going away). */
  flushNow: () => void;
}
let editor: Editor | undefined;
/** The typed text is sent once the keys pause this long, and at least this often while they don't. */
const sendPause = 150;
const sendAtMost = 1000;
/** Echoes of texts sent kept to tell apart from another device's change. */
const sentKept = 8;

/** The memo split exactly: its first line, and everything after that line's break (joined back as it was). */
function splitText(text: string): { first: string; rest: string; breakAfter: boolean } {
  const at = text.indexOf("\n");
  return at < 0 ? { first: text, rest: "", breakAfter: false } : { first: text.slice(0, at), rest: text.slice(at + 1), breakAfter: true };
}

function editorText(fields: Editor): string {
  return fields.body.value.length > 0 || bodyHadBreak.get(fields) ? `${fields.titleField.value}\n${fields.body.value}` : fields.titleField.value;
}
const bodyHadBreak = new WeakMap<Editor, boolean>();

/** The open memo's text as tall as its lines (at least two of 26 px): measured from nothing (the whole drawer laid out). */
const editorLeast = 52;
function fit(area: HTMLTextAreaElement): void {
  if (big) return;
  area.style.height = "0px";
  area.style.height = `${Math.max(editorLeast, area.scrollHeight)}px`;
}

/**
 * A key typed: a text that only got longer can only grow, which its own scroll height tells without laying out
 * the rest of the drawer (setting the height to 0 first, on every key, did). A text that got shorter (a key that
 * takes words away, typing over a selection, undo) is measured from nothing as before.
 */
const typedLength = new WeakMap<HTMLTextAreaElement, number>();
function fitTyped(area: HTMLTextAreaElement): void {
  if (big) return;
  const before = typedLength.get(area);
  typedLength.set(area, area.value.length);
  if (before === undefined || area.value.length < before || !area.style.height) { fit(area); return; }
  if (area.scrollHeight > area.clientHeight) area.style.height = `${Math.max(editorLeast, area.scrollHeight)}px`;
}

function makeEditor(memo: Memo): Editor {
  const parts = splitText(memo.text);
  const titleField = h("input", { class: "hw-field", spellcheck: "false", "aria-label": t("메모 제목"), placeholder: t("제목") });
  const body = h("textarea", { class: "editor", spellcheck: "false", "aria-label": t("메모 내용"), placeholder: t("생각나는 걸 적어 보세요") });
  titleField.value = parts.first;
  body.value = parts.rest;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let since = 0;
  /** The text to send, or undefined when nothing changed since the last. */
  const take = (): { text: string; from: string } | undefined => {
    clearTimeout(timer);
    timer = undefined;
    fields.waiting = false;
    const text = editorText(fields);
    if (text === fields.value) return undefined;
    fields.sent.add(text);
    if (fields.sent.size > sentKept) fields.sent.delete(fields.sent.values().next().value!);
    const from = fields.value;
    fields.value = text;
    return { text, from };
  };
  const send = () => {
    const next = take();
    if (next) act({ type: "memoUpdate", id: memo.id, text: next.text, from: next.from });
  };
  // A key: the text goes once the keys pause (each key used to send the whole text, 1 MB a key for a long memo).
  const later = () => {
    if (!fields.waiting) since = performance.now();
    fields.waiting = true;
    clearTimeout(timer);
    timer = setTimeout(send, Math.max(0, Math.min(sendPause, since + sendAtMost - performance.now())));
  };
  const fields: Editor = {
    id: memo.id, titleField, body, sent: new Set([memo.text]), value: memo.text, composing: false, waiting: false,
    flush: () => { if (fields.waiting) send(); },
    flushNow: () => {
      const next = fields.waiting ? take() : undefined;
      if (next) api.flushMemo({ type: "memoUpdate", id: memo.id, text: next.text, from: next.from });
    },
  };
  bodyHadBreak.set(fields, parts.breakAfter);
  for (const field of [titleField, body]) {
    field.addEventListener("compositionstart", () => { fields.composing = true; });
    field.addEventListener("compositionend", () => { fields.composing = false; later(); });
    field.addEventListener("input", () => { if (field === body) fitTyped(body); later(); });
    // Leaving the text (another card, the window let go): sent at once.
    field.addEventListener("blur", () => fields.flush());
  }
  // Enter in the title: the rest of the line starts the body. Backspace at the body's start joins them again.
  titleField.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const at = titleField.selectionStart ?? titleField.value.length;
      const tail = titleField.value.slice(at);
      titleField.value = titleField.value.slice(0, at);
      body.value = tail + (body.value.length || bodyHadBreak.get(fields) ? `\n${body.value}` : "");
      bodyHadBreak.set(fields, true);
      body.focus();
      body.setSelectionRange(0, 0);
      fit(body);
      send();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      body.focus();
      body.setSelectionRange(0, 0);
    }
  });
  body.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Backspace" && body.selectionStart === 0 && body.selectionEnd === 0) {
      event.preventDefault();
      const at = titleField.value.length;
      const cut = body.value.indexOf("\n");
      titleField.value += cut < 0 ? body.value : body.value.slice(0, cut);
      body.value = cut < 0 ? "" : body.value.slice(cut + 1);
      bodyHadBreak.set(fields, cut >= 0);
      titleField.focus();
      titleField.setSelectionRange(at, at);
      fit(body);
      send();
    } else if (event.key === "ArrowUp" && body.selectionStart === 0) {
      event.preventDefault();
      titleField.focus();
    }
  });
  return fields;
}

/** Another device's (or the note's) change to the open memo: shown, the caret kept where it was. */
function refreshEditor(fields: Editor, memo: Memo): void {
  if (fields.composing || memo.text === fields.value || fields.sent.has(memo.text)) return;
  // Another change came while keys wait here: they go first (the main process joins the two), and the joined text
  // comes back to be shown.
  if (fields.waiting) { fields.flush(); return; }
  const focused = document.activeElement;
  const caret = focused === fields.body ? fields.body.selectionStart : focused === fields.titleField ? fields.titleField.selectionStart : null;
  const parts = splitText(memo.text);
  fields.titleField.value = parts.first;
  fields.body.value = parts.rest;
  bodyHadBreak.set(fields, parts.breakAfter);
  fields.value = memo.text;
  fields.sent = new Set([memo.text]);
  const target = focused === fields.body ? fields.body : focused === fields.titleField ? fields.titleField : undefined;
  if (caret !== null && target) {
    const at = Math.min(caret, target.value.length);
    target.setSelectionRange(at, at);
  }
  fit(fields.body);
}

/** The open memo put away: a blank one quietly goes (as in the note). */
function closeOpen(): void {
  editor?.flush();
  if (!openID) return;
  const id = openID;
  openID = undefined;
  editing = false;
  big = false;
  editor = undefined;
  frozen = undefined;
  act({ type: "memoClose", id });
}

function openMemo(id: string, edit: boolean, line?: number): void {
  if (openID !== id) closeOpen();
  const memo = memoOf(id);
  if (!memo) return;
  openID = id;
  selectedID = id;
  editing = edit;
  frozen = frozen ?? new Map(memosIn(folders(), state!.memos, currentView()).map((entry) => [entry.id, entry]));
  if (edit && (!editor || editor.id !== id)) editor = makeEditor(memo);
  render();
  if (edit && editor) {
    const fields = editor;
    requestAnimationFrame(() => {
      fit(fields.body);
      if (line === undefined) {
        if (fields.body.value) { fields.body.focus(); fields.body.setSelectionRange(fields.body.value.length, fields.body.value.length); }
        else { fields.titleField.focus(); fields.titleField.setSelectionRange(fields.titleField.value.length, fields.titleField.value.length); }
      } else if (line === 0) {
        fields.titleField.focus();
      } else {
        const lines = fields.body.value.split("\n");
        const offset = lines.slice(0, line - 1).reduce((sum, entry) => sum + entry.length + 1, 0) + (lines[line - 1]?.length ?? 0);
        fields.body.focus();
        fields.body.setSelectionRange(offset, offset);
      }
    });
  }
  requestAnimationFrame(() => list.querySelector<HTMLElement>(`.it[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }));
}

function showBig(memo: Memo): void {
  if (openID !== memo.id) openMemo(memo.id, true);
  if (!editing || !editor) { editor = makeEditor(memo); editing = true; }
  big = true;
  render();
  requestAnimationFrame(() => editor?.body.focus());
}

// ─── What a memo can do (the buttons, the menus and the keys all come here) ───

function deleteMemo(memo: Memo): void {
  // Its last keys first, so 되돌리기 brings them back too.
  editor?.flush();
  if (openID === memo.id) { openID = undefined; editing = false; big = false; editor = undefined; frozen = undefined; }
  act({ type: "memoDelete", id: memo.id });
  if (memo.text.trim()) toast.show({ icon: "trash", text: t("메모를 지웠어요"), action: { label: t("되돌리기"), run: () => act({ type: "memoRestore" }) } });
}

/** The memo's words now: the open editor's when it's being typed (the state may not have them yet). */
const textNow = (memo: Memo): string => (editor?.id === memo.id ? editorText(editor) : memo.text);

function copyMemo(memo: Memo): void {
  act({ type: "copyText", text: textNow(memo) });
  toast.show({ icon: "check", text: t("복사했어요"), ms: 1600 });
}

function togglePin(memo: Memo): void {
  act({ type: "memoPin", id: memo.id, pinned: !placementOf(folders(), memo.id).pinned });
}

function duplicateMemo(memo: Memo): void {
  act({ type: "memoDuplicate", id: memo.id });
  toast.show({ icon: "check", text: t("복제했어요"), ms: 1600 });
}

function moveTo(memo: Memo, folder: MemoFolder): void {
  if (placementOf(folders(), memo.id).folder === folder.id) return;
  act({ type: "memoMove", id: memo.id, folder: folder.id });
  toast.show({ icon: "folder", text: t("‘{name}’ 폴더로 옮겼어요", { name: folderName(folder, lang()) }) });
}

/** 체크한 줄 지우기 (D27), with 되돌리기. */
function clearChecked(memo: Memo): void {
  const before = textNow(memo);
  const after = removeCheckedLines(before);
  if (after === before) return;
  if (editor?.id === memo.id) { editor.sent.add(after); }
  act({ type: "memoSetText", id: memo.id, text: after });
  if (editor?.id === memo.id) refreshAfterOwnChange(memo.id, after);
  toast.show({ icon: "check", text: t("체크한 줄을 지웠어요"), action: { label: t("되돌리기"), run: () => { act({ type: "memoSetText", id: memo.id, text: before }); if (editor?.id === memo.id) refreshAfterOwnChange(memo.id, before); } } });
}

/** The open editor shows a change made by a menu (not typed): its words replaced as they are now. */
function refreshAfterOwnChange(id: string, text: string): void {
  const fields = editor;
  if (!fields || fields.id !== id) return;
  fields.sent = new Set();
  fields.value = "";
  refreshEditor(fields, { id, text, createdAt: "", updatedAt: "" });
}

function setPaper(memo: Memo, paper: MemoPaper | undefined): void {
  act({ type: "memoPaper", id: memo.id, paper });
}

function openLink(url: string): void {
  act({ type: "openLink", url });
}

// ─── Menus ────────────────────────────────────────────────────────────────────

const square = (color: string) => h("span", { class: `sq ${colorClass(color)}` });
const cnt = (text: string) => h("span", { class: "cnt" }, text);
const sheetWords = (): Record<MemoPaper, string> => ({ day: t("낮 종이"), night: t("밤 종이"), kraft: t("크라프트지"), grid: t("모눈 노트") });
const shortPaperWords = (): Record<MemoPaper, string> => ({ day: t("낮"), night: t("밤"), kraft: t("크라프트"), grid: t("모눈") });

/** 이 메모의 종이: 서랍 따라 · 낮 · 밤 · 크라프트 · 모눈, as swatches. */
function paperChips(memo: Memo): MenuEntry {
  const own = paperOf(folders(), memo.id);
  return {
    kind: "chips", label: t("이 메모의 종이"),
    options: [
      { value: "", label: t("서랍과 같게"), swatch: "s-follow", checked: !own },
      ...(["day", "night", "kraft", "grid"] as MemoPaper[]).map((value) => ({ value, label: shortPaperWords()[value], swatch: `s-${value}`, checked: own === value })),
    ],
    pick: (value) => setPaper(memo, (value || undefined) as MemoPaper | undefined),
  };
}

/** The same choice as a list (the text menu's 이 메모의 종이 ▸). */
function paperItems(memo: Memo): MenuEntry[] {
  const own = paperOf(folders(), memo.id);
  return [
    { kind: "item", label: t("서랍과 같게"), icon: null, checked: !own, run: () => setPaper(memo, undefined) },
    { kind: "sep" },
    ...(["day", "night", "kraft", "grid"] as MemoPaper[]).map((value): MenuEntry => ({ kind: "item", label: sheetWords()[value], icon: null, extra: [h("i", { class: `sq-paper s-${value}` })], checked: own === value, run: () => setPaper(memo, value) })),
  ];
}

/** 폴더로 옮기기 ▸: 최근 (the last two folders memos went to), the other folders, 새 폴더… (made, then the memo moves). */
function moveEntries(memo: Memo): MenuEntry[] {
  const here = placementOf(folders(), memo.id).folder;
  const shown = visibleFolders(folders());
  const recent = state!.prefs.drawerRecentMoves.map((id) => shown.find((folder) => folder.id === id)).filter((folder): folder is MemoFolder => Boolean(folder) && folder!.id !== here);
  const row = (folder: MemoFolder): MenuEntry => ({ kind: "item", label: folderName(folder, lang()), icon: null, extra: [square(folder.color)], key: digitKey(shown.indexOf(folder)), run: () => moveTo(memo, folder) });
  const entries: MenuEntry[] = [];
  if (recent.length) entries.push({ kind: "label", text: t("최근") }, ...recent.map(row), { kind: "sep" });
  const others = shown.filter((folder) => folder.id !== here && !recent.includes(folder));
  entries.push(...others.map(row));
  if (others.length) entries.push({ kind: "sep" });
  entries.push({ kind: "item", label: t("새 폴더…"), icon: "plus", run: () => folderForm(gearButton.getBoundingClientRect(), undefined, memo) });
  return entries;
}

/** A memo's ⋯ and right-click: what it is, then everything it can do (D27's line only when something is ticked). */
function memoMenu(memo: Memo, at: DOMRect | { x: number; y: number }, keyboard = false): void {
  selectedID = memo.id;
  markSelected();
  const pinned = placementOf(folders(), memo.id).pinned;
  const entries: MenuEntry[] = [
    { kind: "head", nodes: [icon("sheet", 14), h("b", {}, cardTitle(memo, lang()))] },
    { kind: "sep" },
    { kind: "item", label: t("펼쳐서 고치기"), icon: "edit", key: "Enter", run: () => openMemo(memo.id, true) },
    { kind: "item", label: t("크게 보기"), icon: "expand", run: () => showBig(memo) },
    { kind: "sep" },
    { kind: "item", label: t("복사"), icon: "copy", key: "Ctrl+Shift+C", run: () => copyMemo(memo) },
    { kind: "item", label: t("복제"), icon: "duplicate", run: () => duplicateMemo(memo) },
    { kind: "sep" },
    { kind: "item", label: t("고정", undefined, "action"), icon: "pin", checked: pinned, run: () => togglePin(memo) },
    { kind: "sub", label: t("폴더로 옮기기"), icon: "folderMove", entries: () => moveEntries(memo) },
    { kind: "sep" },
    paperChips(memo),
    ...(hasCheckedLines(memo.text) ? [{ kind: "item", label: t("체크한 줄 지우기"), icon: "clearChecked", run: () => clearChecked(memo) } as MenuEntry] : []),
    { kind: "sep" },
    { kind: "item", label: t("지우기"), icon: "trash", key: "Ctrl+Delete", danger: true, run: () => deleteMemo(memo) },
  ];
  openMenu(menuHost, entries, t("메모 메뉴"), at, keyboard);
}

/** The open memo's ⚙: 고정 · 이 메모의 종이 · 체크한 줄 지우기 (checklists). */
function memoGear(memo: Memo, anchor: DOMRect): void {
  const entries: MenuEntry[] = [
    { kind: "item", label: t("고정", undefined, "action"), icon: "pin", checked: placementOf(folders(), memo.id).pinned, run: () => togglePin(memo) },
    { kind: "sep" },
    paperChips(memo),
    ...(hasCheckedLines(memo.text) ? [{ kind: "sep" } as MenuEntry, { kind: "item", label: t("체크한 줄 지우기"), icon: "clearChecked", run: () => clearChecked(memo) } as MenuEntry] : []),
  ];
  openMenu(menuHost, entries, t("메모 설정"), anchor);
}

/** The folder list (the folder's name ▾, Ctrl+L): colour · name · count · Ctrl+n, then 고정, then 새 폴더…. */
function folderList(keyboard = false): void {
  const shown = visibleFolders(folders());
  const current = searching ? "" : currentView();
  const entries: MenuEntry[] = [
    { kind: "label", text: t("폴더") },
    ...shown.map((folder, index): MenuEntry => ({
      kind: "item", label: folderName(folder, lang()), icon: null, extra: [square(folder.color)], key: digitKey(index), checked: folder.id === current ? true : undefined,
      run: () => setView(folder.id),
    })),
    { kind: "item", label: t("고정"), icon: "pin", key: "Ctrl+0", checked: current === pinnedView ? true : undefined, run: () => setView(pinnedView) },
    { kind: "sep" },
    { kind: "item", label: t("새 폴더…"), icon: "plus", run: () => folderForm(folderButton.getBoundingClientRect()) },
  ];
  // Counts beside the names.
  const menu = openMenu(menuHost, entries, t("폴더"), folderButton.getBoundingClientRect(), keyboard);
  const counts = [...shown.map((folder) => memosIn(folders(), state!.memos, folder.id).length), memosIn(folders(), state!.memos, pinnedView).length];
  [...menu.querySelectorAll<HTMLElement>(":scope > button.mi")].slice(0, counts.length).forEach((row, index) => {
    row.querySelector(".tick")?.remove();
    if (row.getAttribute("aria-checked") === "true") row.classList.add("open");
    row.querySelector(".k")?.before(cnt(String(counts[index])));
  });
  folderButton.setAttribute("aria-expanded", "true");
}

/** A bookmark's right-click: what it is — 여기에 새 메모 — 이름 바꾸기 · 색 ▸ · 정렬 ▸ · 복제 — 폴더 지우기… (not 메모). */
function folderMenu(folder: MemoFolder, at: DOMRect | { x: number; y: number }, keyboard = false): void {
  const memos = memosIn(folders(), state!.memos, folder.id);
  const anchor = "width" in at ? at : new DOMRect(at.x, at.y, 0, 0);
  const entries: MenuEntry[] = [
    { kind: "head", nodes: [square(folder.color), h("b", {}, folderName(folder, lang())), h("span", { class: "c" }, memos.length ? sheetCountWords(memos.length) : t("비어 있어요"))] },
    { kind: "sep" },
    { kind: "item", label: t("여기에 새 메모"), icon: "plus", run: () => { setView(folder.id); quick.focus(); } },
    { kind: "sep" },
    { kind: "item", label: t("이름 바꾸기"), icon: "rename", run: () => folderForm(anchor, folder) },
    { kind: "sub", label: t("색"), icon: "colorWheel", entries: () => [{ kind: "node", node: swatches(shownColor(folder.color), (color) => { closeMenus(); act({ type: "folderColor", id: folder.id, color }); }) }] },
    { kind: "sub", label: t("정렬"), icon: "sort", entries: () => sortItems(folder.id) },
    { kind: "item", label: t("복제"), icon: "duplicate", run: () => duplicateFolder(folder) },
  ];
  if (folder.id !== inboxID) entries.push({ kind: "sep" }, { kind: "item", label: t("폴더 지우기…"), icon: "trash", danger: true, run: () => deleteFolder(folder) });
  openMenu(menuHost, entries, folderName(folder, lang()), at, keyboard);
}

/** The 고정 bookmark's right-click: 정렬 ▸ · 고정 모두 풀기 (D28, with 되돌리기). */
function pinnedMenu(at: DOMRect | { x: number; y: number }, keyboard = false): void {
  const pinned = memosIn(folders(), state!.memos, pinnedView);
  const entries: MenuEntry[] = [
    { kind: "head", nodes: [icon("pin", 13), h("b", {}, t("고정")), h("span", { class: "c" }, pinned.length ? sheetCountWords(pinned.length) : t("비어 있어요"))] },
    { kind: "sep" },
    { kind: "sub", label: t("정렬"), icon: "sort", entries: () => sortItems(pinnedView) },
    ...(pinned.length ? [{ kind: "item", label: t("고정 모두 풀기"), icon: "pin", run: unpinAll } as MenuEntry] : []),
  ];
  openMenu(menuHost, entries, t("고정"), at, keyboard);
}

function sortItems(id: string): MenuEntry[] {
  const now = viewSort(id);
  const words: Record<FolderSort, string> = { edited: t("고친 순"), created: t("만든 순"), title: t("제목 순") };
  return (["edited", "created", "title"] as FolderSort[]).map((sort) => ({ kind: "item", label: words[sort], icon: null, checked: sort === now, run: () => act({ type: "folderSort", id, sort }) }));
}

function unpinAll(): void {
  const ids = memosIn(folders(), state!.memos, pinnedView).map((memo) => memo.id);
  if (!ids.length) return;
  act({ type: "memoPinMany", ids, pinned: false });
  toast.show({ icon: "pin", text: t("고정을 모두 풀었어요"), action: { label: t("되돌리기"), run: () => act({ type: "memoPinMany", ids, pinned: true }) } });
}

function duplicateFolder(folder: MemoFolder): void {
  act({ type: "folderDuplicate", id: folder.id, newID: newFolderID() });
  toast.show({ icon: "check", text: t("복제했어요"), ms: 1600 });
}

/** 폴더 지우기…: at once (메모 can't go) — its memos to 메모, 되돌리기 brings the folder back with them (D29). */
function deleteFolder(folder: MemoFolder): void {
  const moved = memosIn(folders(), state!.memos, folder.id).map((memo) => memo.id);
  act({ type: "folderDelete", id: folder.id });
  toast.show({
    icon: "trash", twoLines: true,
    text: folderDeletedWords(folderName(folder, lang()), moved.length, viewName(inboxID), lang()),
    action: { label: t("되돌리기"), run: () => act({ type: "folderRestore", id: folder.id, memos: moved }) },
  });
}

/** The ⚙ menu (the footer's ⚙, a right-click on the paper): 새 메모 · 종이 · 바탕 · 쪽 · 설정 · 도움말 · 끝내기. */
function gearMenu(at: DOMRect | { x: number; y: number }, keyboard = false): void {
  const prefs = state!.prefs;
  const paperWords = { auto: t("자동", undefined, "chip"), ...shortPaperWords() };
  const backdropWords: Record<DrawerBackdrop, string> = { solid: t("불투명"), frost: t("반투명"), strong: t("강하게"), none: t("바탕 없음") };
  const entries: MenuEntry[] = [
    { kind: "item", label: t("새 메모"), icon: "plus", key: "Ctrl+N", run: () => { closeOpen(); render(); quick.focus(); } },
    { kind: "item", label: t("복사한 글로 새 메모"), icon: "paste", run: pasteMemo },
    { kind: "sep" },
    { kind: "chips", label: t("종이"), options: (["auto", "day", "night", "kraft", "grid"] as const).map((value) => ({ value, label: paperWords[value], swatch: value === "auto" ? "s-auto" : `s-${value} s-drawer`, checked: prefs.drawerTheme === value })), pick: (value) => act({ type: "setPref", key: "drawerTheme", value }) },
    { kind: "chips", label: t("바탕"), options: (["solid", "frost", "strong", "none"] as DrawerBackdrop[]).map((value) => ({ value, label: backdropWords[value], swatch: `s-${value}`, checked: prefs.drawerBackdrop === value })), pick: (value) => act({ type: "setPref", key: "drawerBackdrop", value }) },
    { kind: "sep" },
    { kind: "item", label: prefs.drawerSide === "right" ? t("왼쪽에 두기") : t("오른쪽에 두기"), icon: "panel", run: () => act({ type: "setPref", key: "drawerSide", value: prefs.drawerSide === "right" ? "left" : "right" }) },
    { kind: "item", label: t("메모 서랍 설정…"), icon: "gear", key: "Ctrl+,", run: () => act({ type: "openSettings", tab: "drawer" }) },
    { kind: "item", label: t("도움말"), icon: "help", run: () => act({ type: "openHelp", topic: "drawer" }) },
    { kind: "sep" },
    { kind: "item", label: t("종이냥 종료"), icon: "power", run: () => act({ type: "window", command: "quit" }) },
  ];
  openMenu(menuHost, entries, t("메모 서랍 메뉴"), at, keyboard);
  gearButton.setAttribute("aria-expanded", "true");
}

/** 복사한 글로 새 메모: the clipboard's words as a memo here; nothing copied → says so. */
function pasteMemo(): void {
  void (api.act({ type: "drawerPaste", view: currentView() }) as unknown as Promise<boolean>).then((added) => {
    if (added) { if (searching) leaveSearch(); list.scrollTop = 0; } else toast.show({ icon: "paste", text: t("복사한 글이 없어요"), ms: 1800 });
  });
}

/** Writing in a field: 오려 두기 · 복사하기 · 붙여넣기 · 모두 선택, and in a memo `이 메모`'s 폴더로 옮기기 · 종이 · 체크한 줄 지우기. */
function textMenu(field: HTMLInputElement | HTMLTextAreaElement, at: DOMRect | { x: number; y: number }, keyboard = false): void {
  const edit = (command: "cut" | "copy" | "paste" | "selectAll") => () => { field.focus(); act({ type: "editCommand", command }); };
  const entries: MenuEntry[] = [
    { kind: "item", label: t("오려 두기"), icon: "cut", key: "Ctrl+X", run: edit("cut") },
    { kind: "item", label: t("복사하기"), icon: "copy", key: "Ctrl+C", run: edit("copy") },
    { kind: "item", label: t("붙여넣기"), icon: "paste", key: "Ctrl+V", run: edit("paste") },
    { kind: "item", label: t("모두 선택"), icon: "selectAll", key: "Ctrl+A", run: edit("selectAll") },
  ];
  const memo = editor && (field === editor.titleField || field === editor.body) ? memoOf(editor.id) : undefined;
  if (memo) {
    entries.push({ kind: "sep" }, { kind: "label", text: t("이 메모") },
      { kind: "sub", label: t("폴더로 옮기기"), icon: "folderMove", entries: () => moveEntries(memo) },
      { kind: "sub", label: t("이 메모의 종이"), icon: "sheet", entries: () => paperItems(memo) });
    if (hasCheckedLines(memo.text)) entries.push({ kind: "item", label: t("체크한 줄 지우기"), icon: "clearChecked", run: () => clearChecked(memo) });
  }
  openMenu(menuHost, entries, t("글 메뉴"), at, keyboard);
}

function swatches(selected: string, pick: (color: string) => void): HTMLElement {
  const row = h("div", { class: "swatches", role: "radiogroup", "aria-label": t("색") });
  for (const color of folderColors) {
    const swatch = h("button", { class: `swatch c-${color}`, role: "radio", "aria-checked": String(color === selected), "aria-label": colorName(color), title: colorName(color) });
    swatch.addEventListener("click", () => { for (const other of row.children) other.setAttribute("aria-checked", String(other === swatch)); pick(color); });
    row.append(swatch);
  }
  return row;
}

function colorName(color: string): string {
  switch (color) {
    case "lavender": return t("라벤더");
    case "pink": return t("분홍");
    case "mint": return t("민트");
    case "yellow": return t("노랑");
    case "sky": return t("하늘");
    case "peach": return t("살구");
    case "sand": return t("모래");
    default: return t("회색");
  }
}

const newFolderID = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).toUpperCase();
const sheetCountWords = (n: number) => sheetCount(n, lang());

/** 새 폴더 (the + bookmark, 새 폴더… in a menu) or 이름 바꾸기: a name and, for a new one, a colour. `moving`: the memo goes in once it's made. */
function folderForm(anchor: DOMRect, existing?: MemoFolder, moving?: Memo): void {
  const used = new Set(visibleFolders(folders()).map((folder) => shownColor(folder.color)));
  let color = existing ? shownColor(existing.color) : folderColors.find((entry) => !used.has(entry)) ?? "sky";
  const name = h("input", { class: "name", maxlength: "40", placeholder: t("폴더 이름"), "aria-label": t("폴더 이름"), spellcheck: "false" });
  name.value = existing ? folderName(existing, lang()) : "";
  const go = h("button", { class: "btn go" }, existing ? t("저장") : t("만들기"));
  const cancel = h("button", { class: "btn" }, t("취소"));
  const ready = () => { go.toggleAttribute("disabled", !name.value.trim()); };
  const submit = () => {
    const value = name.value.trim();
    if (!value) return;
    closeMenus();
    if (existing) act({ type: "folderRename", id: existing.id, name: value });
    else {
      const id = newFolderID();
      act({ type: "folderAdd", id, name: value, color });
      if (moving) {
        act({ type: "memoMove", id: moving.id, folder: id });
        toast.show({ icon: "folder", text: t("‘{name}’ 폴더로 옮겼어요", { name: value }) });
      } else setView(id);
    }
  };
  name.addEventListener("input", ready);
  name.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); submit(); }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenus(); }
  });
  go.addEventListener("click", submit);
  cancel.addEventListener("click", () => closeMenus());
  ready();
  const form = h("div", { class: "form", "aria-label": existing ? t("이름 바꾸기") : t("새 폴더") },
    h("div", { class: "label" }, existing ? t("이름 바꾸기") : t("새 폴더")), name,
    existing ? null : swatches(color, (next) => { color = next as typeof color; }),
    h("div", { class: "row-btns" }, cancel, go));
  form.style.display = "contents";
  openMenu(menuHost, [{ kind: "node", node: form }], existing ? t("이름 바꾸기") : t("새 폴더"), anchor);
  name.select();
}

// ─── The cards ────────────────────────────────────────────────────────────────

/** The bookmark's memos as the list shows them, in groups; while one is open, as they were when it opened. */
function shownGroups(): CardGroup[] {
  if (!state) return [];
  const here = memosIn(folders(), state.memos, currentView());
  // While one is open: each memo where it was (its times and words then), new ones on top.
  const proxies = frozen ? here.map((memo) => frozen!.get(memo.id) ?? { ...memo, updatedAt: "9999-12-31T00:00:00Z", createdAt: "9999-12-31T00:00:00Z" }) : here;
  const groups = groupMemos(proxies, { pinned: (id) => placementOf(folders(), id).pinned, pinnedView: currentView() === pinnedView, sort: viewSort(), now: new Date(), lang: lang() });
  return groups;
}

function marked(text: string, range?: [number, number]): Node[] {
  if (!range || range[0] === range[1]) return [document.createTextNode(text)];
  return [document.createTextNode(text.slice(0, range[0])), h("mark", {}, text.slice(range[0], range[1])), document.createTextNode(text.slice(range[1]))];
}

function box(on: boolean, tag: "span" | "button" = "span"): HTMLElement {
  return h(tag, { class: `bx${on ? " on" : ""}` }, icon("check", 9, 3));
}

function toolButton(symbol: string, label: string, run: (event: MouseEvent, button: HTMLElement) => void, pressed?: boolean, extraClass = ""): HTMLButtonElement {
  const button = h("button", { class: `ib${pressed ? " on" : ""}${extraClass ? ` ${extraClass}` : ""}`, title: label, "aria-label": label, ...(pressed !== undefined ? { "aria-pressed": String(pressed) } : {}) }, icon(symbol, 15));
  button.addEventListener("click", (event) => { event.stopPropagation(); run(event, button); });
  return button;
}

/**
 * A memo card's paper, as one swappable piece: the element every card is built on (its look is the card block
 * in drawer.css) — open or closed, picked, its own paper, its tape.
 */
function slipShell(memo: Memo, open: boolean, extra: Record<string, string> = {}): HTMLElement {
  const place = placementOf(folders(), memo.id);
  const own = paperOf(folders(), memo.id);
  const color = colorClass(folderOf(place.folder)?.color ?? "lavender");
  const element = h("div", { class: `it ${color}${open ? " open" : ""}${selectedID === memo.id ? " selected" : ""}`, role: "listitem", "data-id": memo.id, ...(own ? { "data-sheet": own } : {}), ...extra });
  const tape = tapePlace(memo.id);
  const strip = h("span", { class: "tp", "aria-hidden": "true" });
  strip.style.left = `${tape.left.toFixed(2)}%`;
  strip.style.transform = `rotate(${tape.turn.toFixed(2)}deg)`;
  element.append(strip);
  return element;
}

/** A kind's chip: a link (opens it), a phone number (copies it), a checklist's count and bar. */
function kindRow(memo: Memo, time: string): HTMLElement | null {
  const kind = memoKind(memo.text);
  if (!kind) return null;
  const row = h("div", { class: "kind" });
  if (kind.kind === "link") {
    const chip = h("button", { class: "kchip", title: kind.url, "aria-label": t("{link} 열기", { link: kind.label }) }, icon("link", 11, 1.8), h("span", {}, kind.label));
    chip.addEventListener("click", (event) => { event.stopPropagation(); openLink(kind.url); });
    row.append(chip);
  } else if (kind.kind === "phone") {
    const chip = h("button", { class: "kchip", title: t("눌러서 복사"), "aria-label": t("{number} 복사", { number: kind.number }) }, icon("phone", 11, 1.8), h("span", {}, kind.number));
    chip.addEventListener("click", (event) => { event.stopPropagation(); act({ type: "copyText", text: kind.number }); toast.show({ icon: "check", text: t("복사했어요"), ms: 1600 }); });
    row.append(chip);
  } else {
    const bar = h("span", { class: "bar" }, h("i", {}));
    (bar.firstElementChild as HTMLElement).style.width = `${Math.round((kind.done / kind.total) * 100)}%`;
    row.append(h("span", { class: "kchip", "aria-label": t("{done}/{total} 완료", { done: kind.done, total: kind.total }) }, icon("checkBox", 11, 1.8), h("span", {}, `${kind.done}/${kind.total}`)), bar);
  }
  row.append(h("span", { class: "m" }, time));
  return row;
}

/**
 * A collapsed card: title (a URL title as `youtube.com 링크`) with the short time or the paw on its right; up to
 * three preview lines (a checklist's first items); the kind row when it has a kind; the hover pill (복사 · 고정 · ⋯). In search: the matched line
 * and the folder's name instead.
 */
function closedSlip(memo: Memo, group?: { kind: GroupKind; proxy: Memo }, hit?: DrawerHit): HTMLElement {
  const now = new Date();
  const heading = cardTitle(memo, lang());
  const pinned = placementOf(folders(), memo.id).pinned;
  const time = group ? memoCardTime(group.proxy, group.kind, viewSort(), now, lang()) : dayTime(new Date(memo.updatedAt), now, lang());
  const element = slipShell(memo, false, { tabindex: "-1", draggable: "true" });
  const kinds = hit ? null : kindRow(memo, time);
  const showPaw = pinned && currentView() !== pinnedView && !hit;
  const right = h("span", { class: "right" }, showPaw ? h("span", { class: "paw", title: t("고정"), "aria-label": t("고정") }, icon("pin", 12)) : null, kinds ? null : h("span", { class: "m" }, time));
  element.append(h("div", { class: "row" }, h("span", { class: "hw", title: heading }, ...(hit && hit.text === heading ? marked(heading, hit.range) : [document.createTextNode(heading)])), right));
  if (hit) {
    if (hit.text !== heading) element.append(h("div", { class: `p hit${isCodeLine(hit.text) ? " code" : ""}` }, ...marked(hit.text, hit.range)));
    const folder = folderOf(hit.folder);
    element.append(h("div", { class: `where ${colorClass(folder?.color ?? "lavender")}` }, h("span", { class: "dot" }), folder ? folderName(folder, lang()) : ""));
  } else {
    const preview = previewBlock(memo);
    if (preview) element.append(preview);
    if (kinds) element.append(kinds);
    if (!preview && !kinds) element.classList.add("short");
  }
  element.addEventListener("click", () => {
    if (hit) { leaveSearch(false); view = hit.folder; act({ type: "drawerView", view: hit.folder }); }
    openMemo(memo.id, !checklistProgress(memo.text));
  });
  element.addEventListener("dragstart", (event) => {
    event.dataTransfer?.setData("application/x-jongi-memo", memo.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    element.classList.add("dragging");
    document.body.classList.add("dragging-memo");
  });
  element.addEventListener("dragend", () => { element.classList.remove("dragging"); document.body.classList.remove("dragging-memo"); });
  return element;
}

/**
 * A card's lines under its title (#14): a memo's first three lines with words, wrapped into three lines at most (two
 * when dense, drawer.css) with … at the end; a checklist's first three items, one a line, with small boxes.
 */
const previews = new Map<string, { text: string; rows: PreviewRow[] }>();
function previewBlock(memo: Memo): HTMLElement | null {
  // Worked out once per text (the list is drawn again whenever the state changes); gone memos are dropped now and then.
  let known = previews.get(memo.id);
  if (!known || known.text !== memo.text) {
    if (previews.size > (state?.memos.length ?? 0) + 64) previews.clear();
    known = { text: memo.text, rows: previewRows(memo.text) };
    previews.set(memo.id, known);
  }
  const rows = known.rows;
  if (rows.length === 0) return null;
  if (rows[0].checked !== undefined) {
    // The small boxes are drawn by CSS (no icon each): a list of 2,000 cards stays as light as before.
    return h("div", { class: "pk" }, ...rows.map((row) => h("div", { class: `pr${row.checked ? " done" : ""}` }, h("span", { class: `bx${row.checked ? " on" : ""}` }), h("span", {}, row.text))));
  }
  const words = rows.map((row) => row.text).join("\n");
  // One text node unless a line is code (a list of 2,000 cards is drawn again on every change).
  if (!rows.some((row) => isCodeLine(row.text))) return h("div", { class: "p", title: words }, words);
  const parts: (Node | string)[] = [];
  rows.forEach((row, index) => {
    if (index > 0) parts.push("\n");
    parts.push(isCodeLine(row.text) ? h("span", { class: "code" }, row.text) : row.text);
  });
  return h("div", { class: "p", title: words }, ...parts);
}

/** The hover pill (복사 · 고정 · ⋯), made for the card the mouse is on (not for every card up front). */
function hoverPill(card: HTMLElement): void {
  if (card.classList.contains("open") || card.querySelector(":scope > .hov")) return;
  const memo = memoOf(card.dataset.id);
  if (!memo || searching) return;
  list.querySelector(".it > .hov")?.remove();
  const pinned = placementOf(folders(), memo.id).pinned;
  card.append(h("span", { class: "hov" },
    toolButton("copy", t("복사"), () => copyMemo(memo)),
    toolButton("pin", pinned ? t("고정 풀기") : t("고정", undefined, "action"), () => togglePin(memo), pinned),
    toolButton("more", t("더 보기"), (_event, button) => memoMenu(memo, button.getBoundingClientRect()))));
}
list.addEventListener("mouseover", (event) => {
  const card = (event.target as Element).closest?.<HTMLElement>(".it[data-id]");
  if (card) hoverPill(card);
});

/** The open memo's bar: [크게 보기 · 복사 · ⚙] · when it was edited · [폴더로 옮기기 · 지우기]. */
function actions(memo: Memo): HTMLElement {
  return h("div", { class: "acts" },
    h("span", { class: "pill" },
      big ? toolButton("shrink", t("작게 보기"), () => { big = false; render(); requestAnimationFrame(() => editor && fit(editor.body)); })
        : toolButton("expand", t("크게 보기"), () => showBig(memo)),
      toolButton("copy", t("복사"), () => copyMemo(memo)),
      toolButton("gear", t("메모 설정"), (_event, button) => memoGear(memo, button.getBoundingClientRect()))),
    h("span", { class: "when" }, editedLabel(memo.updatedAt, new Date(), lang())),
    h("span", { class: "pill" },
      toolButton("folderMove", t("폴더로 옮기기"), (_event, button) => openMenu(menuHost, moveEntries(memo), t("폴더로 옮기기"), button.getBoundingClientRect())),
      toolButton("trash", t("지우기"), () => deleteMemo(memo), undefined, "danger")));
}

function progressText(memo: Memo): HTMLElement | null {
  const progress = checklistProgress(memo.text);
  return progress ? h("span", { class: "m" }, `${progress.done}/${progress.total}`) : null;
}

/** An open memo, as it reads: every line, checklist boxes that tick; a click on a line edits there. */
function openSlip(memo: Memo): HTMLElement {
  const element = slipShell(memo, true);
  if (editing && editor && !big) {
    element.append(h("div", { class: "row" }, editor.titleField, progressText(memo)), editor.body, actions(memo));
    return element;
  }
  const lines = memo.text.split("\n");
  const first = lines.findIndex((line) => line.trim());
  const titleIsCheck = first >= 0 && Boolean(checklistLine(lines[first]));
  const titleText = first >= 0 && !titleIsCheck ? lines[first].trim() : "";
  const titleLine = h("span", { class: "hw", title: titleText }, titleText);
  titleLine.addEventListener("click", () => openMemo(memo.id, true, 0));
  const body = h("div", { class: "body" });
  lines.forEach((line, index) => {
    if (index < first || (index === first && !titleIsCheck)) return;
    const entry = checklistLine(line);
    if (entry) {
      const tick = box(entry.checked, "button");
      tick.setAttribute("aria-label", entry.checked ? t("{title} 완료 취소", { title: entry.text }) : t("{title} 완료", { title: entry.text }));
      tick.addEventListener("click", (event) => { event.stopPropagation(); act({ type: "memoCheck", id: memo.id, line: index }); });
      const words = h("span", { class: "ckt" }, entry.text);
      words.addEventListener("click", () => openMemo(memo.id, true, index));
      body.append(h("div", { class: `ln ck${entry.checked ? " done" : ""}` }, tick, words));
    } else {
      const row = h("div", { class: `ln${isCodeLine(line) ? " code" : ""}` }, line);
      row.addEventListener("click", () => openMemo(memo.id, true, index));
      body.append(row);
    }
  });
  element.append(h("div", { class: "row" }, titleLine, progressText(memo)), body, actions(memo));
  return element;
}

function groupHeader(group: CardGroup): HTMLElement {
  return h("div", { class: "grp", role: "presentation" },
    h("span", { class: "lbl" }, group.kind === "pinned" ? icon("pin", 11) : null, h("span", {}, group.label)),
    h("span", { class: "n" }, String(group.memos.length)));
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function renderTabs(): void {
  const data = folders();
  const current = searching ? "" : currentView();
  const bookmarks: HTMLElement[] = visibleFolders(data).map((folder, index) => {
    const on = folder.id === current;
    const name = folderName(folder, lang());
    const element = h("button", { class: `bk ${colorClass(folder.color)}${on ? " on" : ""}`, role: "tab", "aria-selected": String(on), "aria-label": name, draggable: "true", "data-folder": folder.id }, on ? name : [...name][0] ?? "");
    element.addEventListener("click", () => setView(folder.id));
    element.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); hideTip(); folderMenu(folder, { x: event.clientX, y: event.clientY }); });
    element.addEventListener("mouseenter", () => showTip(element, name, memosIn(data, state!.memos, folder.id).length, digitKey(index)));
    element.addEventListener("mouseleave", hideTip);
    element.addEventListener("dragstart", (event) => { hideTip(); event.dataTransfer?.setData("application/x-jongi-folder", folder.id); element.classList.add("lifted"); });
    element.addEventListener("dragend", () => element.classList.remove("lifted"));
    dropTarget(element, folder.id);
    return element;
  });
  const pinned = h("button", { class: `bk paw c-yellow${current === pinnedView ? " on" : ""}`, role: "tab", "aria-selected": String(current === pinnedView), "aria-label": t("고정"), "data-folder": pinnedView }, icon("pin", current === pinnedView ? 14 : 12, 1.8));
  pinned.addEventListener("click", () => setView(pinnedView));
  pinned.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); hideTip(); pinnedMenu({ x: event.clientX, y: event.clientY }); });
  pinned.addEventListener("mouseenter", () => showTip(pinned, t("고정"), memosIn(data, state!.memos, pinnedView).length, "Ctrl+0"));
  pinned.addEventListener("mouseleave", hideTip);
  dropTarget(pinned, pinnedView);
  const add = h("button", { class: "bk add", title: t("새 폴더"), "aria-label": t("새 폴더") }, icon("plus", 12, 2));
  add.addEventListener("click", () => folderForm(add.getBoundingClientRect()));
  tabs.replaceChildren(...bookmarks, pinned, add);
}

/** A bookmark's label, beside it over the paper (the window has no room outside): `장보기 · 세 장 · Ctrl+3`. */
function showTip(bookmark: HTMLElement, name: string, memos: number, key: string | undefined): void {
  if (menuOpen() || document.body.classList.contains("dragging-memo")) return;
  const words = bookmarkTip(name, memos, key, lang());
  const rest = words.slice(name.length);
  tip.replaceChildren(h("b", {}, name), h("span", {}, rest));
  tip.hidden = false;
  const box = dr.getBoundingClientRect();
  const mark = bookmark.getBoundingClientRect();
  const size = tip.getBoundingClientRect();
  const top = Math.max(6, Math.min(mark.top - box.top + mark.height / 2 - size.height / 2, box.height - size.height - 6));
  tip.style.top = `${Math.round(top)}px`;
  if (side === "right") { tip.style.left = "8px"; tip.style.right = ""; } else { tip.style.right = "8px"; tip.style.left = ""; }
}
function hideTip(): void { tip.hidden = true; }

/** A memo dropped on a bookmark goes to that folder (on 고정: pinned); a bookmark dropped on another takes its place. */
function dropTarget(element: HTMLElement, target: string): void {
  element.addEventListener("dragover", (event) => {
    const types = event.dataTransfer?.types ?? [];
    if (!types.includes("application/x-jongi-memo") && !(types.includes("application/x-jongi-folder") && target !== pinnedView)) return;
    event.preventDefault();
    element.classList.add("drop");
  });
  element.addEventListener("dragleave", () => element.classList.remove("drop"));
  element.addEventListener("drop", (event) => {
    element.classList.remove("drop");
    const memo = event.dataTransfer?.getData("application/x-jongi-memo");
    const folder = event.dataTransfer?.getData("application/x-jongi-folder");
    event.preventDefault();
    if (memo) {
      if (target === pinnedView) act({ type: "memoPin", id: memo, pinned: true });
      else {
        const into = folderOf(target);
        const moving = memoOf(memo);
        if (into && moving) moveTo(moving, into);
      }
    } else if (folder && folder !== target) {
      const ids = visibleFolders(folders()).map((entry) => entry.id).filter((id) => id !== folder);
      ids.splice(ids.indexOf(target), 0, folder);
      act({ type: "folderOrder", ids });
    }
  });
}

function renderHeader(): void {
  folderButton.hidden = searching;
  find.hidden = !searching;
  title.textContent = viewName();
  folderButton.title = `${viewName()} — ${t("폴더 목록 (Ctrl+L)")}`;
  searchButton.setAttribute("aria-pressed", String(searching));
  const pinned = state!.prefs.drawerPinned;
  pinButton.setAttribute("aria-pressed", String(pinned));
  pinButton.title = pinned ? t("다른 창 위에 늘 떠 있어요 (누르면 풀기)") : t("다른 창 위에 띄우기");
  qk.className = `qk c-${viewColor()}`;
}

function renderList(): void {
  if (!state) return;
  if (searching && query.trim()) {
    const hits = drawerSearch(folders(), state.memos, query, lang());
    list.classList.toggle("dense", hits.length > 20);
    list.replaceChildren(...hits.map((hit) => closedSlip(hit.memo, undefined, hit)));
    // One shape for every search that finds nothing (#39): the words looked for, then 없어요.
    if (hits.length === 0) list.append(h("div", { class: "empty" }, h("p", {}, t("‘{query}’에 맞는 게 없어요", { query: query.trim() }))));
    count.textContent = drawerFooter("search", hits.length, "", lang());
    return;
  }
  const groups = shownGroups();
  const proxies = groups.flatMap((group) => group.memos);
  const real = new Map(state.memos.map((memo) => [memo.id, memo]));
  const keep = editor && editing && !big ? list.querySelector<HTMLElement>(`.it.open[data-id="${CSS.escape(editor.id)}"]`) : null;
  const nodes: HTMLElement[] = [];
  for (const group of groups) {
    if (group.header) nodes.push(groupHeader(group));
    for (const proxy of group.memos) {
      const memo = real.get(proxy.id);
      if (!memo) continue;
      // A memo written while another is open has no earlier self: its own time.
      if (memo.id !== openID) { nodes.push(closedSlip(memo, { kind: group.kind, proxy: frozen?.has(memo.id) ? proxy : memo })); continue; }
      if (keep && editor && keep.dataset.sheet === (paperOf(folders(), memo.id) ?? undefined)) {
        refreshEditor(editor, memo);
        keep.querySelector(".acts")?.replaceWith(actions(memo));
        const progress = keep.querySelector(":scope > .row > .m");
        const fresh = progressText(memo);
        if (progress && fresh) progress.replaceWith(fresh); else if (progress) progress.remove(); else if (fresh) keep.querySelector(":scope > .row")?.append(fresh);
        keep.classList.toggle("selected", selectedID === memo.id);
        nodes.push(keep);
        continue;
      }
      nodes.push(openSlip(memo));
    }
  }
  // The open memo went (deleted, moved away elsewhere): nothing stays open.
  if (openID && !proxies.some((memo) => memo.id === openID)) { openID = undefined; editing = false; big = false; editor = undefined; frozen = undefined; }
  list.classList.toggle("dense", proxies.length > 20);
  list.replaceChildren(...nodes);
  if (proxies.length === 0) {
    list.append(currentView() === pinnedView
      // One line under the cat (#39); the footer only says 비어 있어요.
      ? h("div", { class: "empty" }, h("img", { src: "../../assets/pet/256/curious.png", alt: "", draggable: "false" }), h("p", {}, t("메모를 펼쳐 핀을 누르면 여기에 모여요.")))
      : h("div", { class: "empty" }, h("img", { src: "../../assets/pet/256/tea.png", alt: "", draggable: "false" }), h("p", {}, t("위 쪽지에 적거나, 다른 폴더의 메모를 이 책갈피로 끌어 와 보세요."))));
  }
  const n = proxies.length;
  count.textContent = currentView() === pinnedView
    ? (n ? footerWords(t("고정"), n, lang()) : drawerFooter("pinned", 0, "", lang()))
    : (n ? footerWords(viewName(), n, lang()) : drawerFooter("folder", 0, viewName(), lang()));
  for (const area of list.querySelectorAll<HTMLTextAreaElement>("textarea.editor")) fit(area);
  stackBars();
}

/** The open memo's bar: when its time doesn't fit between the pills, it goes under them. */
function stackBars(): void {
  for (const bar of dr.querySelectorAll<HTMLElement>(".acts")) {
    bar.classList.remove("stack");
    const when = bar.querySelector<HTMLElement>(".when");
    if (when && when.scrollWidth > when.clientWidth + 1) bar.classList.add("stack");
  }
}

function markSelected(): void {
  for (const slip of list.querySelectorAll<HTMLElement>(".it")) slip.classList.toggle("selected", slip.dataset.id === selectedID);
}

/** 크게 보기: the open memo over the list, the drawer's whole height. */
let bigBox: HTMLElement | undefined;
function renderBig(): void {
  const memo = memoOf(openID);
  if (!big || !memo || !editor) { bigBox?.remove(); bigBox = undefined; return; }
  refreshEditor(editor, memo);
  const own = paperOf(folders(), memo.id);
  const fresh = h("div", { class: `big ${colorClass(folderOf(placementOf(folders(), memo.id).folder)?.color ?? "lavender")}`, role: "dialog", "aria-label": t("크게 보기"), ...(own ? { "data-sheet": own } : {}) },
    h("div", { class: "row" }, editor.titleField, progressText(memo)), editor.body, actions(memo));
  fresh.style.setProperty("--big-top", `${Math.round(qk.offsetTop)}px`);
  editor.body.style.height = "";
  if (bigBox) bigBox.replaceWith(fresh); else dr.append(fresh);
  bigBox = fresh;
  stackBars();
}

function renderFooter(): void {
  const shortcut = state!.prefs.drawerShortcut;
  keyHint.textContent = shortcut ? shortcutLabel(shortcut) : "";
  keyHint.hidden = !shortcut;
  keyHint.title = shortcut ? t("{key}로 열고 닫아요", { key: shortcutLabel(shortcut) }) : "";
}

function render(): void {
  if (!state) return;
  if (!shown) { dirty = true; return; }
  dirty = false;
  renderedDay = new Date().toDateString();
  root.dataset.font = state.prefs.font;
  const focused = document.activeElement;
  renderTabs();
  renderHeader();
  renderList();
  renderBig();
  renderFooter();
  // Redrawing never takes the caret away from where it was.
  if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) focused.focus();
  queueShape();
}

// ─── Search ───────────────────────────────────────────────────────────────────

function enterSearch(): void {
  closeOpen();
  closeMenus();
  searching = true;
  render();
  findInput.focus();
  findInput.select();
}

function leaveSearch(draw = true): void {
  clearTimeout(searchTimer);
  searchTimer = undefined;
  searching = false;
  query = "";
  findInput.value = "";
  if (draw) render();
}

searchButton.addEventListener("click", () => (searching ? leaveSearch() : enterSearch()));
function showResults(): void {
  clearTimeout(searchTimer);
  searchTimer = undefined;
  renderList();
  list.scrollTop = 0;
}
findInput.addEventListener("input", () => {
  query = findInput.value;
  clearTimeout(searchTimer);
  if (!query.trim()) { showResults(); return; }
  searchTimer = setTimeout(showResults, searchPause);
});
findInput.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); leaveSearch(); quick.focus(); }
  if (event.key === "ArrowDown") { event.preventDefault(); if (searchTimer !== undefined) showResults(); step(1); }
});
pinButton.addEventListener("click", () => act({ type: "setPref", key: "drawerPinned", value: !state?.prefs.drawerPinned }));
closeButton.addEventListener("click", close);
folderButton.addEventListener("click", () => (menuOpen() && folderButton.getAttribute("aria-expanded") === "true" ? closeMenus() : folderList()));
gearButton.addEventListener("click", () => (menuOpen() && gearButton.getAttribute("aria-expanded") === "true" ? closeMenus() : gearMenu(gearButton.getBoundingClientRect())));

// ─── The quick-write slip ─────────────────────────────────────────────────────

function fitQuick(): void {
  quick.style.height = "0px";
  quick.style.height = `${quick.scrollHeight}px`;
  quickHint.hidden = !quick.value.trim();
}
quick.addEventListener("input", fitQuick);
quick.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    const text = quick.value;
    if (!text.trim()) return; // D10: blank makes nothing
    act({ type: "drawerWrite", text, view: currentView() });
    quick.value = "";
    fitQuick();
    if (searching) leaveSearch();
    list.scrollTop = 0;
  } else if (event.key === "ArrowDown" && !quick.value) {
    event.preventDefault();
    step(1);
  }
});

// ─── The keyboard ─────────────────────────────────────────────────────────────

function step(by: 1 | -1): void {
  const slips = [...list.querySelectorAll<HTMLElement>(".it")];
  if (slips.length === 0) return;
  const index = slips.findIndex((slip) => slip.dataset.id === selectedID);
  const next = index < 0 ? (by > 0 ? 0 : slips.length - 1) : Math.max(0, Math.min(slips.length - 1, index + by));
  if (index === 0 && by < 0) { selectedID = undefined; markSelected(); quick.focus(); return; }
  selectedID = slips[next].dataset.id;
  markSelected();
  slips[next].focus({ preventScroll: true });
  slips[next].scrollIntoView({ block: "nearest" });
}

const selectedMemo = (): Memo | undefined => memoOf(selectedID ?? openID);
const inField = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/** Shift+F10 or the Menu key: the menu of what has the focus (a field's text menu, a memo's, a bookmark's, else ⚙). */
function keyedMenu(): void {
  const focused = document.activeElement as HTMLElement | null;
  if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) { const r = focused.getBoundingClientRect(); textMenu(focused, { x: r.left + 12, y: r.top + Math.min(r.height, 26) }, true); return; }
  const bookmark = focused?.closest<HTMLElement>(".bk[data-folder]");
  if (bookmark) {
    const id = bookmark.dataset.folder!;
    const rect = bookmark.getBoundingClientRect();
    const at = { x: side === "right" ? rect.right + 4 : rect.left - 4, y: rect.top };
    if (id === pinnedView) pinnedMenu(at, true); else { const folder = folderOf(id); if (folder) folderMenu(folder, at, true); }
    return;
  }
  const memo = selectedMemo();
  const card = memo ? list.querySelector<HTMLElement>(`.it[data-id="${CSS.escape(memo.id)}"]`) : null;
  if (memo && card) { const r = card.getBoundingClientRect(); memoMenu(memo, { x: r.left + 24, y: r.top + 24 }, true); return; }
  gearMenu(gearButton.getBoundingClientRect(), true);
}

window.addEventListener("keydown", (event) => {
  if (!state || event.isComposing) return;
  if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") { event.preventDefault(); keyedMenu(); return; }
  if (menuOpen() && menuContains(event.target as Node)) return; // the menu's own keys
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.key === "Escape") {
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (closeMenus()) return;
    if (big) { big = false; render(); requestAnimationFrame(() => editor?.body.focus()); return; }
    if (openID) { const id = openID; closeOpen(); selectedID = id; render(); list.querySelector<HTMLElement>(`.it[data-id="${CSS.escape(id)}"]`)?.focus(); return; }
    if (searching) { leaveSearch(); return; }
    close();
    return;
  }
  if (ctrl && !event.shiftKey && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === "n") { event.preventDefault(); closeOpen(); render(); quick.focus(); return; }
    if (key === "f") { event.preventDefault(); enterSearch(); return; }
    if (key === "l") { event.preventDefault(); if (searching) leaveSearch(); folderList(true); return; }
    if (event.key === ",") { event.preventDefault(); act({ type: "openSettings", tab: "drawer" }); return; }
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      const target = viewForDigit(folders(), Number(event.key));
      if (target) setView(target); // D16: a number with no bookmark does nothing
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (inField(event.target) && !(selectedID && document.activeElement?.closest(".it:not(.open)"))) return;
      const memo = selectedMemo();
      if (memo) { event.preventDefault(); deleteMemo(memo); }
      return;
    }
  }
  if (ctrl && event.shiftKey && event.key.toLowerCase() === "c") {
    const memo = selectedMemo();
    if (memo) { event.preventDefault(); copyMemo(memo); }
    return;
  }
  if (inField(event.target)) return;
  if (event.key === "ArrowDown") { event.preventDefault(); step(1); }
  else if (event.key === "ArrowUp") { event.preventDefault(); step(-1); }
  else if (event.key === "Enter" && selectedID) {
    event.preventDefault();
    const memo = selectedMemo();
    if (memo) openMemo(memo.id, !checklistProgress(memo.text));
  }
});

// A click on the paper beside the cards puts the open one away.
list.addEventListener("click", (event) => {
  if (event.target === list && openID) { closeOpen(); render(); }
});

// Right-click: a field's text menu, a memo's menu, else (the paper, the header) the ⚙ menu.
document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const target = event.target as HTMLElement;
  if (target.closest(".menu")) return;
  hideTip();
  const at = { x: event.clientX, y: event.clientY };
  const field = target.closest<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  if (field) { textMenu(field, at); return; }
  const card = target.closest<HTMLElement>(".it[data-id]");
  const memo = card ? memoOf(card.dataset.id) : undefined;
  if (memo) { memoMenu(memo, at); return; }
  if (target.closest(".dr")) gearMenu(at);
});

// ─── The mouse: only the paper (바탕 없음: what floats), the bookmarks and the cat catch it ──

let interactive = true;
function setInteractive(value: boolean): void {
  if (interactive === value) return;
  interactive = value;
  api.send("drawer:interactive", value);
}
let dragging = false;
const catches = () => (backdrop === "none"
  ? ".hd, .qk, .it, .grp, .ft .gear, .ft .count, .ft .key, .empty, .bk, .menu, .big, .toast, .grip, .list"
  : ".dr, .bk, .ears, .menu");
window.addEventListener("mousemove", (event) => {
  if (dragging) return;
  const target = event.target as Element | null;
  setInteractive(Boolean(target?.closest?.(catches())) && !(backdrop === "none" && target === list));
});
document.documentElement.addEventListener("mouseleave", () => { if (!dragging) setInteractive(false); });

// The inner edge, dragged: the width follows (the main process keeps it within 260–480).
let queued: number | undefined;
grip.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  grip.setPointerCapture(event.pointerId);
  dragging = true;
});
grip.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const x = event.screenX;
  if (queued !== undefined) cancelAnimationFrame(queued);
  queued = requestAnimationFrame(() => { queued = undefined; api.send("drawer:resize", x, false); });
});
const endDrag = (event: PointerEvent) => {
  if (!dragging) return;
  dragging = false;
  if (queued !== undefined) cancelAnimationFrame(queued);
  api.send("drawer:resize", event.screenX, true);
};
grip.addEventListener("pointerup", endDrag);
grip.addEventListener("pointercancel", endDrag);

// ─── 반투명 · 강하게 on Windows 11: the window cut to the paper, the bookmarks and the ears ──

let shapeQueued = false;
function queueShape(): void {
  if (shapeQueued || !shown || (backdrop !== "frost" && backdrop !== "strong")) return;
  shapeQueued = true;
  requestAnimationFrame(() => { shapeQueued = false; sendShape(); });
}
function sendShape(): void {
  if (stage.classList.contains("away")) return;
  const rects: { x: number; y: number; width: number; height: number }[] = [];
  const add = (r: DOMRect, grow = 0) => { if (r.width > 0 && r.height > 0) rects.push({ x: r.left - (side === "right" ? grow : 0), y: r.top, width: r.width + grow, height: r.height }); };
  add(dr.getBoundingClientRect());
  for (const bookmark of tabs.querySelectorAll<HTMLElement>(".bk")) add(bookmark.getBoundingClientRect(), 6);
  // Each ear as a few steps (wide at its foot, narrow at its tip).
  const ears = cat.element.getBoundingClientRect();
  for (const [from, to] of [[0, 30], [44, 76]]) {
    for (let row = 0; row < 6; row += 1) {
      const top = ears.top + row * 3;
      const inset = ((6 - row) / 6) * ((to - from) / 2 - 2);
      const left = side === "right" ? ears.left + from + inset : ears.right - to + inset;
      rects.push({ x: left, y: top, width: Math.max(2, to - from - inset * 2), height: 3 });
    }
  }
  api.send("drawer:shape", rects);
}
window.addEventListener("resize", () => { queueShape(); stackBars(); });

// ─── Opening and closing ──────────────────────────────────────────────────────

function applyLook(look: string): void {
  root.dataset.look = look;
  cat.setLook(look);
}

function applyBackdrop(next: DrawerBackdrop): void {
  backdrop = next;
  root.dataset.backdrop = next;
  queueShape();
}

function applySide(next: "right" | "left"): void {
  side = next;
  stage.classList.toggle("side-right", side === "right");
  stage.classList.toggle("side-left", side === "left");
}

api.on("drawer:open", (payload) => {
  const { slide, side: where, look, memo, write, backdrop: mode } = payload as { slide: boolean; side: "right" | "left"; look: string; memo?: string; write?: boolean; backdrop?: DrawerBackdrop };
  applyLook(look);
  applySide(where);
  if (mode) applyBackdrop(mode);
  const wasShown = shown;
  shown = true;
  if (view === undefined && state) view = state.prefs.drawerLastFolder || inboxID;
  // Drawn again only when something changed while it was away (or the day turned: the groups and times move).
  if (dirty || renderedDay !== new Date().toDateString()) render();
  if (slide) {
    stage.classList.add("still", "away");
    void stage.offsetWidth;
    stage.classList.remove("still");
    requestAnimationFrame(() => stage.classList.remove("away"));
    stage.addEventListener("transitionend", queueShape, { once: true });
  } else { stage.classList.remove("away"); queueShape(); }
  if (memo && !state) pendingMemo = memo;
  if (memo && state?.memos.some((entry) => entry.id === memo)) {
    // On a memo: its folder, the memo open and in view (M5).
    closeMenus();
    if (searching) leaveSearch(false);
    const folder = placementOf(folders(), memo).folder;
    if (currentView() !== folder && currentView() !== pinnedView) { view = folder; act({ type: "drawerView", view: folder }); }
    else if (currentView() === pinnedView && !placementOf(folders(), memo).pinned) { view = folder; act({ type: "drawerView", view: folder }); }
    const entry = state.memos.find((candidate) => candidate.id === memo)!;
    openMemo(memo, !checklistProgress(entry.text));
  } else if (write || !wasShown) { fitQuick(); quick.focus(); }
});

api.on("drawer:shut", (payload) => {
  const { slide } = payload as { slide: boolean };
  closeMenus();
  hideTip();
  const changed = Boolean(openID) || searching || big;
  closeOpen();
  if (searching) leaveSearch(false);
  toast.hide();
  shown = false;
  dirty = dirty || changed;
  if (!slide) { api.send("drawer:hidden"); return; }
  stage.classList.add("away");
  const done = () => { stage.removeEventListener("transitionend", done); api.send("drawer:hidden"); };
  stage.addEventListener("transitionend", done);
});

api.on("drawer:look", (look) => applyLook(look as string));
api.on("drawer:backdrop", (mode) => applyBackdrop(mode as DrawerBackdrop));
/** Opened on a memo before the first state came: it opens once the state is here. */
let pendingMemo: string | undefined;

api.on("state", (next) => {
  state = next as AppState;
  if (view === undefined) view = state.prefs.drawerLastFolder || inboxID;
  render();
});
void api.getState().then((initial) => {
  state = initial;
  if (view === undefined) view = initial.prefs.drawerLastFolder || inboxID;
  render();
  const memo = pendingMemo;
  pendingMemo = undefined;
  if (memo && shown && initial.memos.some((entry) => entry.id === memo)) { view = placementOf(folders(), memo).folder; openMemo(memo, !checklistProgress(initial.memos.find((entry) => entry.id === memo)!.text)); }
});

// The page going away (quitting, the window closed): the typed text that waits is saved first.
window.addEventListener("beforeunload", () => editor?.flushNow());
window.addEventListener("pagehide", () => editor?.flushNow());
// The window let go or hidden: sent at once.
window.addEventListener("blur", () => editor?.flush());
document.addEventListener("visibilitychange", () => { if (document.hidden) editor?.flush(); });

// Snapshots reach in here (the main process runs these in the page).
const cardRect = (id: string) => list.querySelector<HTMLElement>(`.it[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
(window as unknown as Record<string, unknown>).drawerTest = {
  open: (id: string, edit: boolean) => openMemo(id, edit),
  select: (id: string) => { selectedID = id; render(); },
  search: (text: string) => { enterSearch(); findInput.value = text; query = text; renderList(); },
  view: (id: string) => setView(id),
  big: () => { const memo = selectedMemo(); if (memo) showBig(memo); },
  folderMenu: (id: string) => { const element = tabs.querySelector<HTMLElement>(`[data-folder="${CSS.escape(id)}"]`); const folder = folderOf(id); if (element && folder) { const r = element.getBoundingClientRect(); folderMenu(folder, { x: r.right + 4, y: r.top + 6 }); } },
  pinnedMenu: () => { const element = tabs.querySelector<HTMLElement>(`[data-folder="${pinnedView}"]`); if (element) { const r = element.getBoundingClientRect(); pinnedMenu({ x: r.right + 4, y: r.top + 6 }); } },
  sortMenu: (id: string) => { (window as unknown as { drawerTest: { folderMenu(id: string): void } }).drawerTest.folderMenu(id); [...document.querySelectorAll<HTMLElement>(".menu .mi")].find((row) => row.textContent?.includes(t("정렬")))?.click(); },
  newFolder: () => { const add = tabs.querySelector<HTMLElement>(".bk.add"); if (add) folderForm(add.getBoundingClientRect()); },
  moveMenu: () => { const button = list.querySelector<HTMLElement>(".it.open .acts .pill:last-child .ib"); button?.click(); },
  memoMenu: (id: string, sub = false) => { const memo = memoOf(id); const r = cardRect(id); if (memo && r) { memoMenu(memo, { x: r.left + 30, y: r.top + 20 }); if (sub) [...document.querySelectorAll<HTMLElement>(".menu .mi")].find((row) => row.textContent?.includes(t("폴더로 옮기기")))?.click(); } },
  memoGear: () => { list.querySelector<HTMLElement>(".it.open .acts .pill .ib:nth-child(3)")?.click(); },
  gearMenu: () => gearMenu(gearButton.getBoundingClientRect()),
  folderList: () => folderList(),
  textMenu: (id: string) => { openMemo(id, true); requestAnimationFrame(() => { if (editor) { editor.body.focus(); const r = editor.body.getBoundingClientRect(); textMenu(editor.body, { x: r.left + 40, y: r.top + 10 }); } }); },
  tip: (id: string) => { const element = tabs.querySelector<HTMLElement>(`[data-folder="${CSS.escape(id)}"]`); element?.dispatchEvent(new MouseEvent("mouseenter")); },
  hover: (id: string) => { for (const slip of list.querySelectorAll<HTMLElement>(".it")) { slip.classList.toggle("preview-hover", slip.dataset.id === id); if (slip.dataset.id === id) hoverPill(slip); } },
  type: (text: string) => { quick.value = text; fitQuick(); },
  reset: () => { closeMenus(); hideTip(); closeOpen(); if (searching) leaveSearch(false); big = false; selectedID = undefined; quick.value = ""; fitQuick(); toast.hide(); render(); list.scrollTop = 0; },
};
