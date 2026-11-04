import type { Memo } from "../core/memo";
import {
  bookmarkTip, cardTitle, characterCount, characterWords, editedLabel, foundTime, folderDeletedWords, footerWords, groupMemos, memoCardTime, memoKind, previewRows, tapePlace, type PreviewRow, type CardGroup, type GroupKind,
} from "../core/memoCards";
import {
  bookmarkLetters, checklistLine, checklistProgress, drawerFooter, folderColors, folderName, hasCheckedLines, inboxID, isCodeLine, memosIn, paperOf, pinnedView,
  placementOf, removeCheckedLines, resolveView, sheetCount, shortcutLabel, shownColor, slipTime, sortOf, viewForDigit, viewOf, visibleFolders, folderViews,
  drawerPaper, drawerThemeValue, memoPapers, type DrawerBackdrop, type DrawerHit, type FolderSort, type FolderView, type MemoFolder, type MemoFolders, type MemoPaper,
} from "../core/memoDrawer";
import { fontTitles, type MemosState } from "../core/types";
import { cardFaceKey, drawerFaceMetrics, drawerMetrics, drawerPoints, endsParagraph } from "../core/textSteps";
import { h, icon, lang, paper, scrollFade, t, motion, reduceMotion } from "./api";
import { toaster } from "./slip";
import { placeChildren } from "../core/placeChildren";
import { drawerCat } from "./drawerCat";
import { closeMenus, menuContains, menuOpen, openMenu, type MenuEntry } from "./drawerMenu";
import { isFenceLine, markdownLines, readLine } from "../core/memoMarkdown";
import { toggleDone } from "../core/memoEdits";
import { drawerFind, hitSnippet, searchFilters, searchFooterWords, type SearchFilter } from "../core/drawerFind";
import { emptyQuestion, restoredWords, trashAgo, trashMenuLabel, type TrashEntry } from "../core/memoTrash";
import { markdownNodes, memoBodyEditor, memoTitleEditor, nearBox, showTitleCaret, type BodyEditor, type LinkRequest, type MemoFormat, type TitleEditor } from "./memoEditor";

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

let state: MemosState | undefined;
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
/** 메모 찾기's chips (#114): only the folder (or 고정) shown, and the kinds kept to; both start over with each search. */
let searchHere = false;
const searchOn = new Set<SearchFilter>();
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
/** 보기 (#115): the folder's 카드 · 제목만, or 고정's (this device's). */
const viewShape = (id = currentView()): FolderView => (id === pinnedView ? state!.prefs.drawerPinnedView : viewOf(folderOf(id)));
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
/** #114: where to look (모든 폴더 · {지금 폴더}만) and what to keep to (체크 남음 · 링크 · 고정), under the field. */
const chips = h("div", { class: "chips", hidden: "" });
// #83: no × in the header any more; the small bar on the paper's inner edge closes the drawer (and Esc, the shortcut).
const header = h("div", { class: "hd" }, sub, h("div", { class: "ttl" }, folderButton, find, h("span", { class: "ic" }, searchButton)), chips);
/** 서랍 닫기 (#83, like SideNotes): a small upright pill in the middle of the inner edge — a click closes, a drag resizes. */
const closeBar = h("button", { class: "closebar", title: t("서랍 닫기"), "aria-label": t("서랍 닫기") }, h("span", { class: "bar", "aria-hidden": "true" }, icon("chevronRight", 11, 2.4)));
const tapeStrip = h("div", { class: "tape", "aria-hidden": "true" });
const quick = h("textarea", { rows: "1", placeholder: t("여기에 바로 적어요"), "aria-label": t("새 메모"), spellcheck: "false" });
/** #117: once something is written, where it goes (`회사에 넣어요`) and the keys, as the 빠른 메모 slip says its folder. */
const quickTo = h("span", { class: "qk-to" });
const quickHint = h("div", { class: "qk-hint", hidden: "" }, quickTo, h("div", { class: "qk-keys" }, h("span", {}, t("Enter 넣기")), h("span", {}, t("Shift+Enter 줄바꿈"))));
const qk = h("div", { class: "qk" }, tapeStrip, quick, quickHint);
const list = h("div", { class: "list", role: "list", "aria-label": t("메모") });
const count = h("span", {});
const gearButton = h("button", { class: "gear", title: t("메모 서랍 메뉴"), "aria-label": t("메모 서랍 메뉴"), "aria-haspopup": "menu", "aria-expanded": "false" }, icon("gear", 15));
const keyHint = h("span", { class: "key" });
const footer = h("div", { class: "ft" }, gearButton, h("span", { class: "count" }, icon("pawPrint", 12), count), keyHint);
const toastHost = h("div", { class: "toast-host" });
const toast = toaster(toastHost);
const tip = h("div", { class: "tip", hidden: "", role: "tooltip" });
// #164: the close tab is out of the paper, on the stage beside the bookmarks; after the paper, so Tab reaches it last.
dr.append(cat.element, grip, header, qk, list, footer, toastHost, tip);
stage.append(tabs, dr, closeBar);
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
  /**
   * The title line (handwriting) and, since #84, the words under it in CodeMirror (memoEditor.ts); since #134 the title
   * line is a one-line CodeMirror too (`titleField` is its element), its marks hidden or faint as on the Mac.
   */
  id: string; titleField: HTMLElement; title: TitleEditor; body: BodyEditor;
  /** The last few texts sent (a state that comes back with one of them is this editor's own echo). */
  sent: Set<string>;
  /** The text last sent. */
  value: string;
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
  const body = fields.body.text();
  return body.length > 0 || bodyHadBreak.get(fields) ? `${fields.title.value()}\n${body}` : fields.title.value();
}
const bodyHadBreak = new WeakMap<Editor, boolean>();

/** Is this element the open memo's text (its title or its words)? */
const isEditorField = (element: Element | null): boolean => Boolean(editor && element && (editor.titleField.contains(element) || editor.body.dom.contains(element)));

function makeEditor(memo: Memo): Editor {
  const parts = splitText(memo.text);
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
    if (fields.title.composing || fields.body.composing) return;
    // #134: a ``` typed on the title line (or taken away) opens (closes) a code block for the words under it.
    fields.body.setOpenAbove(isFenceLine(fields.title.value()));
    if (!fields.waiting) since = performance.now();
    fields.waiting = true;
    clearTimeout(timer);
    timer = setTimeout(send, Math.max(0, Math.min(sendPause, since + sendAtMost - performance.now())));
  };
  const body = memoBodyEditor({
    text: parts.rest, label: t("메모 내용"), placeholder: t("생각나는 걸 적어 보세요"),
    typed: later, composed: later, blur: () => fields.flush(), openLink,
    toggleMarks: () => act({ type: "setPref", key: "drawerShowMarks", value: !state!.prefs.drawerShowMarks }),
    paste: () => act({ type: "editCommand", command: "paste" }),
    doneToBottom: () => state!.prefs.drawerDoneToBottom,
    openAbove: isFenceLine(parts.first),
    askLink: (request) => askLink(request),
    // Backspace at the words' start joins their first line to the title again.
    backspaceAtStart: () => {
      const at = title.value().length;
      const rest = body.text();
      const cut = rest.indexOf("\n");
      title.setValue(title.value() + (cut < 0 ? rest : rest.slice(0, cut)));
      bodyHadBreak.set(fields, cut >= 0);
      body.replace(cut < 0 ? "" : rest.slice(cut + 1), 0);
      body.setOpenAbove(isFenceLine(title.value()));
      title.focus(at);
      send();
      return true;
    },
    upAtStart: () => { title.focus(); return true; },
  });
  // Enter in the title: the rest of the line starts the words under it. ↓ goes to them.
  const title = memoTitleEditor({
    text: parts.first, label: t("메모 제목"), placeholder: t("제목"),
    typed: later, composed: later, blur: () => fields.flush(),
    enter: (at) => {
      const line = title.value();
      title.setValue(line.slice(0, at), at);
      const rest = body.text();
      body.replace(line.slice(at) + (rest.length || bodyHadBreak.get(fields) ? `\n${rest}` : ""), 0);
      bodyHadBreak.set(fields, true);
      body.setOpenAbove(isFenceLine(title.value()));
      body.focus(0);
      send();
      return true;
    },
    down: () => { body.focus(0); return true; },
  });
  const fields: Editor = {
    id: memo.id, titleField: title.dom, title, body, sent: new Set([memo.text]), value: memo.text, waiting: false,
    flush: () => { if (fields.waiting) send(); },
    flushNow: () => {
      const next = fields.waiting ? take() : undefined;
      if (next) api.flushMemo({ type: "memoUpdate", id: memo.id, text: next.text, from: next.from });
    },
  };
  bodyHadBreak.set(fields, parts.breakAfter);
  return fields;
}

/** Another device's (or the note's) change to the open memo: shown, the caret kept where it was. */
function refreshEditor(fields: Editor, memo: Memo): void {
  if (fields.title.composing || fields.body.composing || memo.text === fields.value || fields.sent.has(memo.text)) return;
  // Another change came while keys wait here: they go first (the main process joins the two), and the joined text
  // comes back to be shown.
  if (fields.waiting) { fields.flush(); return; }
  const focused = document.activeElement;
  const inBody = Boolean(focused && fields.body.dom.contains(focused));
  const inTitle = Boolean(focused && fields.titleField.contains(focused));
  const caret = inBody ? fields.body.view.state.selection.main.head : inTitle ? fields.title.caret() : null;
  const parts = splitText(memo.text);
  fields.title.setValue(parts.first, inTitle && caret !== null ? caret : undefined);
  fields.body.replace(parts.rest, inBody && caret !== null ? caret : undefined);
  fields.body.setOpenAbove(isFenceLine(fields.title.value()));
  bodyHadBreak.set(fields, parts.breakAfter);
  fields.value = memo.text;
  fields.sent = new Set([memo.text]);
}

/** The open memo put away: a blank one quietly goes (as in the note). */
function closeOpen(): void {
  closeLink();
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
  slideCards(render);
  // M3 (#166): the words being typed fade in with 바뀜 as the cards under them make room.
  if (!reduceMotion()) {
    const card = list.querySelector<HTMLElement>(`.it.open[data-id="${CSS.escape(id)}"]`);
    if (card && !card.classList.contains("opening")) {
      card.classList.add("opening");
      card.addEventListener("animationend", () => card.classList.remove("opening"), { once: true });
    }
  }
  if (edit && editor) {
    const fields = editor;
    requestAnimationFrame(() => {
      const doc = fields.body.view.state.doc;
      if (line === undefined) {
        if (doc.length) fields.body.focus();
        else fields.title.focus();
      } else if (line === 0) {
        fields.title.focus();
      } else {
        // The end of that line of the memo (its line 1 is the words' first line).
        fields.body.focus(doc.line(Math.min(line, doc.lines)).to);
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
  requestAnimationFrame(() => editor?.body.view.focus());
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
const sheetWords = (): Record<MemoPaper, string> => ({
  day: t("낮 종이"), night: t("밤 종이"), kraft: t("크라프트지"), grid: t("모눈 노트"), hanji: t("한지"), sage: t("쑥색 종이"), blossom: t("벚꽃 종이"), ink: t("먹색 종이"),
});
const shortPaperWords = (): Record<MemoPaper, string> => ({
  day: t("낮"), night: t("밤"), kraft: t("크라프트"), grid: t("모눈"), hanji: t("한지"), sage: t("쑥색"), blossom: t("벚꽃"), ink: t("먹색"),
});

/** 이 메모의 종이: 서랍 따라 · 낮 · 밤 · 크라프트 · 모눈, as swatches. */
function paperChips(memo: Memo): MenuEntry {
  const own = paperOf(folders(), memo.id);
  return {
    kind: "chips", label: t("이 메모의 종이"),
    options: [
      { value: "", label: t("서랍과 같게"), swatch: "s-follow", checked: !own },
      ...memoPapers.map((value) => ({ value, label: shortPaperWords()[value], swatch: `s-${value}`, checked: own === value })),
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
    ...memoPapers.map((value): MenuEntry => ({ kind: "item", label: sheetWords()[value], icon: null, extra: [h("i", { class: `sq-paper s-${value}` })], checked: own === value, run: () => setPaper(memo, value) })),
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
    // #104: the memo's title as a quiet grey line in the menu's own face (it only says what the menu is about).
    { kind: "head", nodes: [icon("sheet", 14), h("span", { class: "t" }, cardTitle(memo, lang()))] },
    { kind: "sep" },
    { kind: "item", label: t("펼쳐서 고치기"), icon: "edit", key: "Enter", run: () => openMemo(memo.id, true) },
    { kind: "item", label: t("크게 보기"), icon: "expand", run: () => showBig(memo) },
    { kind: "sep" },
    { kind: "item", label: t("복사"), icon: "copy", key: "Ctrl+Shift+C", run: () => copyMemo(memo) },
    { kind: "item", label: t("복제"), icon: "duplicate", run: () => duplicateMemo(memo) },
    { kind: "sep" },
    { kind: "item", label: t("고정", undefined, "action"), icon: "pin", checked: pinned, run: () => togglePin(memo) },
    { kind: "sub", label: t("폴더로 옮기기"), icon: "folder", entries: () => moveEntries(memo) },
    { kind: "sep" },
    paperChips(memo),
    ...(hasCheckedLines(memo.text) ? [{ kind: "item", label: t("체크한 줄 지우기"), icon: "clearChecked", run: () => clearChecked(memo) } as MenuEntry] : []),
    { kind: "sep" },
    { kind: "item", label: t("지우기"), icon: "trash", key: "Ctrl+Delete", danger: true, run: () => deleteMemo(memo) },
  ];
  openMenu(menuHost, entries, t("메모 메뉴"), at, keyboard);
}

/** Ctrl+Shift+M (#118): the memo's title, then 폴더로 옮기기's rows, under the folder's name (the keyboard on its first row). */
function moveList(memo: Memo): void {
  if (searching) leaveSearch();
  selectedID = memo.id;
  markSelected();
  const entries: MenuEntry[] = [
    { kind: "head", nodes: [icon("sheet", 14), h("span", { class: "t" }, cardTitle(memo, lang()))] },
    { kind: "sep" },
    ...moveEntries(memo),
  ];
  openMenu(menuHost, entries, t("폴더로 옮기기"), folderButton.getBoundingClientRect(), true);
}

/**
 * The folder list (the folder's name ▾, Ctrl+L): #115 first how the folder shown looks — 보기 · 이 폴더 (카드 · 제목만) and
 * 정렬 — then colour · name · count · Ctrl+n, then 고정, then 새 폴더….
 */
function folderList(keyboard = false): void {
  const shown = visibleFolders(folders());
  const current = searching ? "" : currentView();
  const looks: MenuEntry[] = searching ? [] : [
    { kind: "label", text: current === pinnedView ? t("보기 · 고정") : t("보기 · 이 폴더") }, ...viewItems(current),
    { kind: "label", text: t("정렬") }, ...sortItems(current), { kind: "sep" },
  ];
  const entries: MenuEntry[] = [
    ...looks,
    { kind: "label", text: t("폴더") },
    ...shown.map((folder, index): MenuEntry => ({
      kind: "item", label: folderName(folder, lang()), icon: null, extra: [square(folder.color)], key: digitKey(index), checked: folder.id === current ? true : undefined,
      run: () => setView(folder.id),
    })),
    { kind: "item", label: t("고정"), icon: "pin", key: "Ctrl+0", checked: current === pinnedView ? true : undefined, run: () => setView(pinnedView) },
    { kind: "sep" },
    { kind: "item", label: t("새 폴더…"), icon: "plus", run: () => folderForm(folderButton.getBoundingClientRect()) },
    // #120: 지운 메모 at the bottom, only when there are some.
    ...trashRow(),
  ];
  // Counts beside the names.
  const menu = openMenu(menuHost, entries, t("폴더"), folderButton.getBoundingClientRect(), keyboard);
  const counts = [...shown.map((folder) => memosIn(folders(), state!.memos, folder.id).length), memosIn(folders(), state!.memos, pinnedView).length];
  const before = looks.filter((entry) => entry.kind === "item").length;
  [...menu.querySelectorAll<HTMLElement>(":scope > button.mi")].slice(before, before + counts.length).forEach((row, index) => {
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
    { kind: "sub", label: t("보기"), icon: "sheet", entries: () => viewItems(folder.id) },
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
    { kind: "sub", label: t("보기"), icon: "sheet", entries: () => viewItems(pinnedView) },
    { kind: "sub", label: t("정렬"), icon: "sort", entries: () => sortItems(pinnedView) },
    ...(pinned.length ? [{ kind: "item", label: t("고정 모두 풀기"), icon: "pin", run: unpinAll } as MenuEntry] : []),
  ];
  openMenu(menuHost, entries, t("고정"), at, keyboard);
}

/** 보기 (#115): 카드 · 제목만. */
function viewItems(id: string): MenuEntry[] {
  const now = viewShape(id);
  const words: Record<FolderView, string> = { cards: t("카드"), titles: t("제목만") };
  return folderViews.map((view) => ({ kind: "item", label: words[view], icon: null, checked: view === now, run: () => act({ type: "folderView", id, view }) }));
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
  // #142: the paper picked for the day (밤에는 밤 종이로 is in 설정 → 메모 서랍).
  const picked = drawerPaper(prefs.drawerTheme, prefs.drawerNightPaper);
  const backdropWords: Record<DrawerBackdrop, string> = { solid: t("불투명"), frost: t("반투명"), strong: t("강하게"), none: t("바탕 없음") };
  const entries: MenuEntry[] = [
    { kind: "item", label: t("새 메모"), icon: "plus", key: "Ctrl+N", run: () => { closeOpen(); render(); quick.focus(); } },
    { kind: "item", label: t("복사한 글로 새 메모"), icon: "paste", run: pasteMemo },
    ...trashRow().filter((entry) => entry.kind === "item"),
    { kind: "sep" },
    { kind: "chips", label: t("종이"), options: memoPapers.map((value) => ({ value, label: shortPaperWords()[value], swatch: `s-${value} s-drawer`, checked: picked.paper === value })), pick: (value) => act({ type: "setPref", key: "drawerTheme", value: drawerThemeValue(value as MemoPaper, picked.nightPaper) }) },
    { kind: "chips", label: t("바탕"), options: (["solid", "frost", "strong", "none"] as DrawerBackdrop[]).map((value) => ({ value, label: backdropWords[value], swatch: `s-${value}`, checked: prefs.drawerBackdrop === value })), pick: (value) => act({ type: "setPref", key: "drawerBackdrop", value }) },
    { kind: "sep" },
    { kind: "item", label: prefs.drawerSide === "right" ? t("왼쪽에 두기") : t("오른쪽에 두기"), icon: "panel", run: () => act({ type: "setPref", key: "drawerSide", value: prefs.drawerSide === "right" ? "left" : "right" }) },
    // #111: from the header (its pin read as 고정); also in 설정 → 메모 서랍.
    { kind: "item", label: t("다른 창 위에 띄우기"), icon: "pin", checked: prefs.drawerPinned, run: () => act({ type: "setPref", key: "drawerPinned", value: !prefs.drawerPinned }) },
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
function textMenu(field: HTMLElement, at: DOMRect | { x: number; y: number }, keyboard = false): void {
  const edit = (command: "cut" | "copy" | "paste" | "selectAll") => () => { field.focus(); act({ type: "editCommand", command }); };
  const entries: MenuEntry[] = [
    { kind: "item", label: t("오려 두기"), icon: "cut", key: "Ctrl+X", run: edit("cut") },
    { kind: "item", label: t("복사하기"), icon: "copy", key: "Ctrl+C", run: edit("copy") },
    { kind: "item", label: t("붙여넣기"), icon: "paste", key: "Ctrl+V", run: edit("paste") },
    { kind: "item", label: t("모두 선택"), icon: "selectAll", key: "Ctrl+A", run: edit("selectAll") },
  ];
  const memo = editor && isEditorField(field) ? memoOf(editor.id) : undefined;
  if (memo) {
    entries.push({ kind: "sep" }, { kind: "label", text: t("이 메모") },
      { kind: "sub", label: t("폴더로 옮기기"), icon: "folder", entries: () => moveEntries(memo) },
      { kind: "sub", label: t("이 메모의 종이"), icon: "sheet", entries: () => paperItems(memo) });
    if (hasCheckedLines(memo.text)) entries.push({ kind: "item", label: t("체크한 줄 지우기"), icon: "clearChecked", run: () => clearChecked(memo) });
  }
  openMenu(menuHost, entries, t("글 메뉴"), at, keyboard);
}

// ─── 지운 메모 (#120) ─────────────────────────────────────────────────────────

/** Memos just restored here (the state with them in memos.json may not have come yet). */
const restoring = new Set<string>();
/** 지운 메모 as the drawer shows them: newest deleted first; one whose memo is alive again isn't listed. */
function trashEntries(): TrashEntry[] {
  const entries = state?.memoTrash.entries ?? [];
  if (!entries.length) return [];
  const alive = new Set([...state!.memos.map((memo) => memo.id), ...restoring]);
  return entries.filter((entry) => !alive.has(entry.memo.id));
}

/** `지운 메모 세 장` (a separator, then the row), opening the slip of deleted memos; nothing when there are none. */
function trashRow(): MenuEntry[] {
  const count = trashEntries().length;
  if (!count) return [];
  return [{ kind: "sep" }, { kind: "item", label: trashMenuLabel(count, lang()), icon: "trash", run: () => requestAnimationFrame(() => trashSlip()) }];
}

/**
 * 지운 메모: a slip under the folder name (as 새 폴더's) — `지운 메모 · 30일 동안 둬요`, a row for each (its title; its folder ·
 * 3일 전; 되돌리기), then `되돌리면 원래 폴더로 가요` and 지금 모두 비우기…, which asks first (`지운 메모 세 장을 완전히
 * 지울까요?` / `되돌릴 수 없어요.` · 취소 · 모두 비우기). Esc closes it.
 */
function trashSlip(confirming = false, keyboard = false): void {
  const entries = trashEntries();
  const now = new Date();
  const rows = entries.map((entry) => {
    const folder = folderOf(entry.folder) ?? folderOf(inboxID);
    const back = h("button", { class: "btn back" }, t("되돌리기", undefined, "restore"));
    back.addEventListener("click", () => {
      const name = folder ? folderName(folder, lang()) : viewName(inboxID);
      restoring.add(entry.memo.id);
      act({ type: "memoUntrash", id: entry.memo.id });
      toast.show({ icon: "check", text: restoredWords(name, lang()) });
      if (entries.length <= 1) closeMenus(); else requestAnimationFrame(() => trashSlip());
    });
    return h("div", { class: "trow" },
      h("span", { class: "hw", title: cardTitle(entry.memo, lang()) }, cardTitle(entry.memo, lang())),
      h("span", { class: "m" }, `${folder ? folderName(folder, lang()) : ""} · ${trashAgo(entry.deletedAt, now, lang())}`), back);
  });
  const head = h("div", { class: "thead" }, h("b", {}, t("지운 메모")), h("span", {}, t("30일 동안 둬요")));
  let foot: HTMLElement;
  if (confirming) {
    const cancel = h("button", { class: "btn" }, t("취소"));
    const go = h("button", { class: "btn go danger" }, t("모두 비우기"));
    cancel.addEventListener("click", () => trashSlip(false));
    go.addEventListener("click", () => { closeMenus(); act({ type: "memoTrashEmpty" }); toast.show({ icon: "trash", text: t("지운 메모를 비웠어요") }); });
    foot = h("div", { class: "tfoot ask" }, h("b", {}, emptyQuestion(entries.length, lang())), h("span", {}, t("되돌릴 수 없어요.")), h("div", { class: "row-btns" }, cancel, go));
  } else {
    const empty = h("button", { class: "btn danger", ...(entries.length ? {} : { disabled: "" }) }, t("지금 모두 비우기…"));
    empty.addEventListener("click", () => trashSlip(true));
    foot = h("div", { class: "tfoot" }, h("span", {}, t("되돌리면 원래 폴더로 가요")), empty);
  }
  const panel = h("div", { class: "form trash", "aria-label": t("지운 메모") }, head,
    entries.length ? h("div", { class: "trows" }, ...rows) : h("p", { class: "tnone" }, t("지운 메모가 없어요")), foot);
  panel.style.display = "contents";
  closeMenus();
  openMenu(menuHost, [{ kind: "node", node: panel }], t("지운 메모"), folderButton.getBoundingClientRect(), keyboard);
  (panel.querySelector<HTMLElement>(confirming ? ".btn.go" : ".btn.back") ?? panel.querySelector<HTMLElement>("button"))?.focus();
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
  return h(tag, { class: `bx${on ? " on" : ""}` }, icon("check", 10, 3));
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
  const element = h("div", { class: `it ${color}${open ? " open" : ""}${selectedID === memo.id ? " selected" : ""}`, role: "listitem", "data-id": memo.id, ...(selectedID === memo.id ? { "aria-current": "true" } : {}), ...(own ? { "data-sheet": own } : {}), ...extra });
  const tape = tapePlace(memo.id);
  const strip = h("span", { class: "tp", "aria-hidden": "true" });
  strip.style.left = `${tape.left.toFixed(2)}%`;
  strip.style.transform = `rotate(${tape.turn.toFixed(2)}deg)`;
  element.append(strip);
  return element;
}

/** A kind's chip: a link (opens it), a phone number (copies it), a checklist's count and bar. */
function kindRow(memo: Memo, time: string, kind = memoKind(memo.text)): HTMLElement | null {
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
function closedSlip(memo: Memo, group?: { kind: GroupKind; proxy: Memo }, hit?: DrawerHit, titleOnly = false): HTMLElement {
  const now = new Date();
  const heading = cardTitle(memo, lang());
  const pinned = placementOf(folders(), memo.id).pinned;
  // #114: a result says its day as a date (today the clock): its group is a folder, not a day.
  const time = group ? memoCardTime(group.proxy, group.kind, viewSort(), now, lang()) : foundTime(new Date(memo.updatedAt), now, lang());
  const element = slipShell(memo, false, { tabindex: "-1", draggable: "true" });
  const kind = hit || titleOnly ? undefined : memoKind(memo.text);
  const kinds = hit || titleOnly ? null : kindRow(memo, time, kind);
  const showPaw = pinned && currentView() !== pinnedView && !hit;
  // #115: 제목만 — one line: the title, a checklist's `1/3`, the paw, the short time.
  const progress = titleOnly ? checklistProgress(memo.text) : undefined;
  // #119 (Narrator): the card read as one line — `제목, 9:20, 고정, 2/4 완료` (in search: the line found and the folder) —
  // instead of every piece of it; its preview follows as the description.
  const said = [heading, time, pinned ? t("고정") : "",
    kind?.kind === "checklist" ? t("{done}/{total} 완료", { done: kind.done, total: kind.total }) : kind?.kind === "link" ? kind.label : kind?.kind === "phone" ? kind.number
      : progress ? t("{done}/{total} 완료", progress) : "",
    hit && hit.text !== heading ? hit.text : "", hit ? folderName(folderOf(hit.folder) ?? folders().folders[0], lang()) : ""].filter(Boolean);
  element.setAttribute("aria-label", said.join(", "));
  const right = h("span", { class: "right" }, progress ? h("span", { class: "m", "aria-label": t("{done}/{total} 완료", progress) }, `${progress.done}/${progress.total}`) : null,
    showPaw ? h("span", { class: "paw", title: t("고정"), "aria-label": t("고정") }, icon("pin", 12)) : null, kinds ? null : h("span", { class: "m" }, time));
  const found = hit ? hitSnippet(hit.text, hit.range) : undefined;
  const onTitle = Boolean(hit?.range) && hit!.text === heading;
  element.append(h("div", { class: "row" }, h("span", { class: "hw", title: heading }, ...(found && onTitle ? marked(found.text, found.range) : [document.createTextNode(heading)])), right));
  if (titleOnly) {
    element.classList.add("ti");
  } else if (hit && found) {
    // #114: the found line in the preview's place, brought near its start; a result the chips alone picked (or a folder
    // name, or a match in the title) shows its preview. The folder is the group's header.
    if (hit.range && !onTitle) element.append(h("div", { class: `p hit${isCodeLine(hit.text) ? " code" : ""}` }, ...marked(found.text, found.range)));
    else { const preview = previewBlock(memo); if (preview) element.append(preview); else element.classList.add("short"); }
  } else {
    const preview = previewBlock(memo);
    if (preview) { element.append(preview); element.setAttribute("aria-description", (previews.get(memo.id)?.rows ?? []).map((row) => (row.checked === undefined ? row.text : `${row.checked ? t("완료됨") : t("미완료")} ${row.text}`)).join(", ")); }
    if (kinds) element.append(kinds);
    if (!preview && !kinds) element.classList.add("short");
  }
  element.addEventListener("click", () => (hit ? revealHit(memo) : openMemo(memo.id, !checklistProgress(memo.text))));
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
  const code = (row: PreviewRow) => row.code === true || isCodeLine(row.text);
  if (!rows.some(code)) return h("div", { class: "p", title: words }, words);
  const parts: (Node | string)[] = [];
  rows.forEach((row, index) => {
    if (index > 0) parts.push("\n");
    parts.push(code(row) ? h("span", { class: "code" }, row.text) : row.text);
  });
  return h("div", { class: "p", title: words }, ...parts);
}

/** The hover pill (복사 · 고정 · ⋯), made for the card the mouse is on (not for every card up front). */
function hoverPill(card: HTMLElement): void {
  if (card.classList.contains("open") || card.classList.contains("ti") || card.querySelector(":scope > .hov")) return;
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
/**
 * The open memo's bar (#112, SideNotes): [Aa] [⤢] [⋯] at the left, `10:12 고침` at the right. Aa opens the format bar
 * (typing the memo if it wasn't); ⋯ is the memo's right-click menu — copy, pin, move, its paper, delete … are there.
 */
function actions(memo: Memo): HTMLElement {
  const typed = editing && editor?.id === memo.id;
  const format = h("button", { class: "ib aa", title: t("서식"), "aria-label": t("서식"), "aria-pressed": String(typed && formatOpen) }, "Aa");
  format.addEventListener("click", (event) => {
    event.stopPropagation();
    if (typed) { formatOpen = !formatOpen; placeFormatBar(); return; }
    formatOpen = true;
    openMemo(memo.id, true);
  });
  return h("div", { class: "acts" },
    h("span", { class: "pill" }, format),
    h("span", { class: "pill" },
      big ? toolButton("shrink", t("작게 보기"), () => { big = false; render(); requestAnimationFrame(() => editor?.body.view.focus()); })
        : toolButton("expand", t("크게 보기"), () => showBig(memo))),
    h("span", { class: "pill" },
      // A keyboard press (Enter · Space) opens it with its first row chosen.
      toolButton("more", t("더 보기"), (event, button) => memoMenu(memo, button.getBoundingClientRect(), event.detail === 0))),
    // Narrow drawers: `어제 고침`, else the card's short time (as the Mac's bar), else under the buttons (stackBars).
    // 크게 보기 adds the letters (#113): `어제 21:40 고침 · 412자`.
    h("span", { class: "when", "data-short": slipTime(memo.updatedAt, new Date(), lang()) },
      big ? `${editedLabel(memo.updatedAt, new Date(), lang())} · ${characterWords(characterCount(textNow(memo)), lang())}` : editedLabel(memo.updatedAt, new Date(), lang())));
}

/**
 * 서식 막대 (Aa, #84 — SideNotes' way): what the keys do, as buttons under the memo being typed, on the selection or at
 * the caret (a line's format on the caret's line; a second press takes it off); then the drawer's face and size, and 기호
 * 늘 보이기. A button never takes the caret from the words.
 */
let formatOpen = false;
function formatBar(): HTMLElement {
  const button = (label: Node | string, name: string, run: () => void, extra = "", pressed?: boolean) => {
    const element = h("button", { class: `fb${extra ? ` ${extra}` : ""}`, title: name, "aria-label": name, ...(pressed !== undefined ? { "aria-pressed": String(pressed) } : {}) }, label);
    element.addEventListener("mousedown", (event) => event.preventDefault());
    element.addEventListener("click", (event) => { event.stopPropagation(); run(); });
    return element;
  };
  const format = (name: MemoFormat) => () => editor?.body.format(name);
  const prefs = state!.prefs;
  const faces = h("button", { class: "fb face", title: t("글꼴과 글자 크기"), "aria-label": t("글꼴과 글자 크기"), "aria-haspopup": "menu" },
    `Aa ${prefs.drawerFont === "mono" ? t("고정폭") : fontTitles[lang()][prefs.drawerFont]} · ${prefs.drawerTextPt} px`);
  faces.addEventListener("mousedown", (event) => event.preventDefault());
  faces.addEventListener("click", (event) => {
    event.stopPropagation();
    openMenu(menuHost, [
      { kind: "chips", label: t("글꼴"), options: (["clean", "pen", "brush", "mono"] as const).map((value) => ({ value, label: value === "mono" ? t("고정폭") : fontTitles[lang()][value], swatch: `f-${value}`, checked: prefs.drawerFont === value })), pick: (value) => act({ type: "setPref", key: "drawerFont", value }) },
      { kind: "chips", label: t("글자 크기"), options: drawerPoints.map((value) => ({ value: String(value), label: String(value), swatch: `z-${value}`, checked: prefs.drawerTextPt === value })), pick: (value) => act({ type: "setPref", key: "drawerTextPt", value: Number(value) }) },
    ], t("글꼴과 글자 크기"), faces.getBoundingClientRect());
  });
  return h("div", { class: "fmt", role: "toolbar", "aria-label": t("서식") },
    h("span", { class: "fbs" },
      button(h("b", {}, "B"), t("굵게 (Ctrl+B)"), format("bold")),
      button(h("i", {}, "I"), t("기울임 (Ctrl+I)"), format("italic")),
      button(h("s", {}, "S"), t("취소선 (Ctrl+Shift+X)"), format("strike")),
      button("H", t("제목 (Ctrl+Alt+1–3)"), format("heading")),
      button("•", t("목록"), format("list")),
      button("1.", t("번호 목록"), format("olist")),
      button(icon("checkBox", 14), t("체크 목록 (Ctrl+Shift+L)"), format("check")),
      button(icon("quote", 14), t("인용"), format("quote")),
      button("</>", t("코드 (Ctrl+E)"), format("code"), "mono"),
      button(icon("minus", 14), t("가로줄"), format("rule")),
      button(icon("link", 14), t("링크 (Ctrl+K)"), format("link"))),
    h("span", { class: "fbs end" }, faces,
      button("¶", t("기호 늘 보이기 (Ctrl+Shift+R)"), () => act({ type: "setPref", key: "drawerShowMarks", value: !prefs.drawerShowMarks }), "", prefs.drawerShowMarks)));
}

/** The Aa bar under the open memo (or in 크게 보기), out or put away, the memo's words left as they are. */
function placeFormatBar(): void {
  for (const bar of dr.querySelectorAll(".fmt")) bar.remove();
  for (const button of dr.querySelectorAll<HTMLElement>(".acts .ib[aria-label]")) if (button.getAttribute("aria-label") === t("서식")) button.setAttribute("aria-pressed", String(formatOpen));
  if (!formatOpen || !editing || !editor) return;
  const host = bigBox ?? list.querySelector<HTMLElement>(".it.open");
  host?.querySelector(":scope > .acts")?.before(formatBar());
}

/**
 * 링크 (#135, SideNotes' way): Ctrl+K on chosen words (or in a link) opens this small field under the memo — the
 * address, Enter to finish (the words become `[words](address)`, or the link's address changes), Esc to leave it; in a
 * link, 링크 빼기 (or an empty address) takes the link out. The memo changes once, at Enter (one Ctrl+Z).
 */
let linkEdit: LinkRequest | undefined;
let linkBox: HTMLElement | undefined;

function askLink(request: LinkRequest): void {
  closeLink();
  linkEdit = request;
  linkBox = linkField(request);
  placeLinkBar();
  requestAnimationFrame(() => { const input = linkBox?.querySelector<HTMLInputElement>("input"); input?.focus(); input?.select(); });
}

function linkField(request: LinkRequest): HTMLElement {
  const name = request.existing ? t("링크 고치기") : t("링크 넣기");
  const input = h("input", { type: "text", class: "lk-url", placeholder: "https://", "aria-label": t("링크 주소"), spellcheck: "false" });
  input.value = request.url;
  const finish = (url: string) => {
    const fields = editor, asked = linkEdit;
    closeLink();
    if (fields && asked) fields.body.setLink(asked, url);
  };
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); finish(input.value); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelLink(); }
  });
  const remove = request.existing ? h("button", { class: "lk-out" }, t("링크 빼기")) : null;
  remove?.addEventListener("mousedown", (event) => event.preventDefault());
  remove?.addEventListener("click", (event) => { event.stopPropagation(); finish(""); });
  return h("div", { class: "lnk", role: "group", "aria-label": name },
    h("div", { class: "lk-head" }, name),
    h("label", { class: "lk-row" }, icon("link", 13), input),
    h("div", { class: "lk-foot" }, h("span", { class: "lk-keys" }, request.existing ? t("Enter 고치기 · Esc 그만") : t("Enter 넣기 · Esc 그만")), remove));
}

function closeLink(): void {
  linkEdit = undefined;
  linkBox?.remove();
  linkBox = undefined;
}

/** Esc: nothing changes, the keyboard back in the memo where it was. */
function cancelLink(): void {
  closeLink();
  editor?.body.view.focus();
}

/** The link field under the memo being typed (or in 크게 보기), above the Aa bar; left where it is when it is there. */
function placeLinkBar(): void {
  if (!linkBox) return;
  if (!editing || !editor) { closeLink(); return; }
  const host = bigBox ?? list.querySelector<HTMLElement>(".it.open");
  const before = host?.querySelector<HTMLElement>(":scope > .fmt") ?? host?.querySelector<HTMLElement>(":scope > .acts");
  if (!host || !before) return;
  if (linkBox.parentElement === host && linkBox.nextElementSibling === before) return;
  before.before(linkBox);
}

function progressText(memo: Memo): HTMLElement | null {
  const progress = checklistProgress(memo.text);
  return progress ? h("span", { class: "m" }, `${progress.done}/${progress.total}`) : null;
}

/**
 * An open memo, as it reads: every line, checklist boxes that tick; a click on a line edits there. #84: each line styled
 * as the editor styles it (a heading, a list's hanging words, a quote's bar, a code block, a rule; the marks faint).
 */
function openSlip(memo: Memo): HTMLElement {
  const element = slipShell(memo, true);
  if (editing && editor && !big) {
    element.append(h("div", { class: "row" }, editor.titleField, progressText(memo)), editor.body.dom, actions(memo));
    return element;
  }
  const lines = [...markdownLines(memo.text)];
  const first = lines.findIndex(({ line }) => line.trim());
  const titleIsCheck = first >= 0 && Boolean(checklistLine(lines[first].line));
  const titleText = first >= 0 && !titleIsCheck ? lines[first].line.trim() : "";
  const titleLine = h("span", { class: "hw", title: titleText }, ...(titleText ? markdownNodes(titleText, readLine(titleText, false)) : []));
  titleLine.addEventListener("click", () => openMemo(memo.id, true, 0));
  const body = h("div", { class: "body" });
  // 문단 간격 (#141): the room under each paragraph's last line (a list's lines stay together).
  const para = (index: number) => (endsParagraph(lines[index].read.kind, lines[index + 1]?.read.kind) ? " md-para" : "");
  lines.forEach(({ line, read }, index) => {
    if (index < first || (index === first && !titleIsCheck)) return;
    const entry = read.kind === "check" ? checklistLine(line) : undefined;
    let row: HTMLElement;
    if (entry) {
      const tick = box(entry.checked, "button");
      const motion = cardTicked && cardTicked.id === memo.id && cardTicked.line === index && performance.now() - cardTicked.at < 400 ? (cardTicked.on ? " pop" : " unpop") : "";
      if (motion) tick.classList.add(motion.trim());
      tick.setAttribute("aria-label", entry.checked ? t("{title} 완료 취소", { title: entry.text }) : t("{title} 완료", { title: entry.text }));
      tick.addEventListener("click", (event) => { event.stopPropagation(); tickInCard(memo, index, entry.checked); });
      const words = h("span", { class: "ckt" }, ...markdownNodes(line, read, read.words));
      words.addEventListener("click", () => openMemo(memo.id, true, index));
      body.append(h("div", { class: `ln ck${entry.checked ? " done" : ""}${motion === " pop" ? " pop" : ""}${para(index)}` }, tick, words));
      return;
    }
    const kind = read.kind === "heading" ? `md-h${Math.min(3, read.level)}` : read.kind === "code" || read.kind === "fence" ? `md-codeline${read.kind === "fence" ? " md-fence" : ""}`
      : read.kind === "quote" ? "md-quote" : read.kind === "rule" ? "md-rule" : read.kind === "text" && !line.includes("`") && isCodeLine(line) ? "code" : "";
    if (read.kind === "list" || read.kind === "olist") {
      // The mark, then the words hanging after it.
      // Hidden marks (2026-10-30): a list's `- ` as •, a number as it is (기호 늘 보이기: the marks as written).
      const dot = read.kind === "list" && !state!.prefs.drawerShowMarks;
      const head = dot ? h("span", { class: "md-dot md-bullet" }, `${line.slice(0, read.markFrom)}• `) : h("span", { class: "md-mark md-num md-bullet" }, line.slice(0, read.words));
      row = h("div", { class: `ln md-item${para(index)}` }, head, h("span", {}, ...markdownNodes(line, read, read.words)));
    } else {
      row = h("div", { class: `ln${kind ? ` ${kind}` : ""}${para(index)}` }, ...markdownNodes(line, read));
    }
    row.addEventListener("click", () => openMemo(memo.id, true, index));
    body.append(row);
  });
  // #163: a click near a box (within about 25 × 25 round it, not on its words) ticks it, as the note's boxes do.
  body.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || event.target.closest(".bx, .ckt")) return;
    const near = nearBox(body, event.clientX, event.clientY, ".ck > .bx");
    if (near) { event.stopPropagation(); near.click(); }
  }, true);
  element.append(h("div", { class: "row" }, titleLine, progressText(memo)), body, actions(memo));
  return element;
}

/**
 * #163: a box ticked in an open memo as it reads, as in the editor: the words change at once (in place) and the box is
 * drawn ticking; with 끝낸 항목 아래로 the line goes down once that is drawn (0.36 s; unticked 0.14 s). Reduce motion: one
 * change at once, as before.
 */
let cardTicked: { id: string; line: number; at: number; on: boolean } | undefined;
function tickInCard(memo: Memo, line: number, checked: boolean): void {
  if (reduceMotion()) { act({ type: "memoCheck", id: memo.id, line }); return; }
  const before = memo.text;
  const inPlace = toggleDone(before, line, false);
  if (inPlace === before) return;
  const on = !checked;
  cardTicked = { id: memo.id, line, at: performance.now(), on };
  act({ type: "memoSetText", id: memo.id, text: inPlace });
  if (!state!.prefs.drawerDoneToBottom) return;
  setTimeout(() => {
    if (memoOf(memo.id)?.text !== inPlace) return;
    cardTicked = undefined;
    act({ type: "memoSetText", id: memo.id, text: toggleDone(before, line, true) });
  }, (on ? motion.enter + motion.change : motion.quick) + 20);
}

function groupHeader(group: CardGroup): HTMLElement {
  // #119: a space between the words and the count (Narrator read `고정1`); the flex row ignores it.
  return h("div", { class: "grp", role: "presentation" },
    h("span", { class: "lbl" }, group.kind === "pinned" ? icon("pin", 11) : null, h("span", {}, group.label)), " ",
    h("span", { class: "n" }, String(group.memos.length)));
}

/**
 * #4: the list's cards and headers kept from one redraw to the next. A card whose memo and look are as they were is the
 * same element (a redraw of 3,000 cards used to build all of them again, about 22,000 nodes, after every pause in the
 * typing); only the changed ones are made, and `placeChildren` (core/placeChildren.ts) moves only what moved.
 */
let slips = new Map<string, { key: string; text: string; element: HTMLElement }>();
let headers = new Map<string, HTMLElement>();
let slipLook = "";

/** The closed card for `memo`: the one drawn last time when nothing it shows changed. */
function cachedSlip(memo: Memo, group: { kind: GroupKind; proxy: Memo }, titles: boolean, next: typeof slips): HTMLElement {
  const place = placementOf(folders(), memo.id);
  const date = viewSort() === "created" ? group.proxy.createdAt : group.proxy.updatedAt;
  const key = `${group.kind}|${date}|${selectedID === memo.id}|${place.pinned}|${folderOf(place.folder)?.color ?? ""}|${paperOf(folders(), memo.id) ?? ""}|${titles}`;
  const known = slips.get(memo.id);
  const element = known && known.key === key && known.text === memo.text ? known.element : closedSlip(memo, group, undefined, titles);
  next.set(memo.id, known?.element === element ? known : { key, text: memo.text, element });
  return element;
}

function cachedHeader(group: CardGroup, next: typeof headers): HTMLElement {
  const key = `${group.kind}|${group.label}|${group.memos.length}`;
  const element = headers.get(key) ?? groupHeader(group);
  next.set(key, element);
  return element;
}

/** The list's cards (and headers) on screen now, found by halving: 5,000 cards cost no more than ten. */
function cardsInView(): HTMLElement[] {
  const view = list.getBoundingClientRect();
  const items = list.children;
  let low = 0, high = items.length;
  while (low < high) { const middle = (low + high) >> 1; if (items[middle].getBoundingClientRect().bottom < view.top) low = middle + 1; else high = middle; }
  const shown: HTMLElement[] = [];
  for (let index = low; index < items.length; index += 1) {
    const item = items[index] as HTMLElement;
    if (item.getBoundingClientRect().top > view.bottom) break;
    shown.push(item);
  }
  return shown;
}

/** Where each card on screen is laid out in the list (scrolling and a slide under way don't move it). */
function cardPlaces(): Map<HTMLElement, { key: string | HTMLElement; top: number }> {
  // A card by its memo (one drawn again, picked or not, is still that card), a header by itself.
  return new Map(cardsInView().map((item) => [item, { key: item.dataset.id ?? item, top: item.offsetTop }]));
}

/**
 * M3 (#166): a memo opened or put away — the cards on screen whose place it changed slide there with 바뀜 (0.16 s)
 * instead of jumping. Measured in the next frame before it is drawn, and again if the open memo's height changes before
 * that frame is drawn (CodeMirror sets it as it measures, sometimes only after the frame's own callbacks). Only cards in
 * view move, each once; nothing moves under Reduce Motion or while the drawer is away.
 */
function slideCards(change: () => void): void {
  if (reduceMotion() || !shown || searching) { change(); return; }
  const before = new Map([...cardPlaces().values()].map(({ key, top }) => [key, top]));
  change();
  const sliding = new Map<HTMLElement, Animation>();
  let drawn = false;
  const slide = () => {
    if (drawn) return;
    for (const [item, { key, top }] of cardPlaces()) {
      const was = before.get(key);
      if (was === undefined || item.classList.contains("open")) continue;
      const by = Math.round(was - top);
      sliding.get(item)?.cancel();
      sliding.delete(item);
      if (Math.abs(by) >= 1) sliding.set(item, item.animate([{ transform: `translateY(${by}px)` }, { transform: "none" }], { duration: motion.change, easing: "cubic-bezier(0, 0, 0.58, 1)" }));
    }
  };
  const open = list.querySelector<HTMLElement>(".it.open");
  const watch = open ? new ResizeObserver(slide) : undefined;
  watch?.observe(open!);
  requestAnimationFrame(() => {
    slide();
    // Once that frame is drawn, the slides only run out.
    requestAnimationFrame(() => { drawn = true; watch?.disconnect(); });
  });
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function renderTabs(): void {
  const data = folders();
  // #114: the folder shown stays picked while searching.
  const current = currentView();
  const shown = visibleFolders(data);
  // #116: first letters that collide among the un-picked bookmarks get a second one.
  const letters = bookmarkLetters(shown.map((folder) => folderName(folder, lang())), current ? shown.findIndex((folder) => folder.id === current) : null);
  const bookmarks: HTMLElement[] = shown.map((folder, index) => {
    const on = folder.id === current;
    const name = folderName(folder, lang());
    const element = h("button", { class: `bk ${colorClass(folder.color)}${on ? " on" : ""}`, role: "tab", "aria-selected": String(on), "aria-label": name, draggable: "true", "data-folder": folder.id, ...(!on && [...letters[index]].length > 1 ? { "data-two": /[\uAC00-\uD7A3\u3131-\u318E]/.test(letters[index]) ? "stack" : "" } : {}) }, on ? name : letters[index]);
    element.addEventListener("click", () => setView(folder.id));
    element.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); hideTip(); folderMenu(folder, { x: event.clientX, y: event.clientY }); });
    element.addEventListener("mouseenter", () => showTip(element, name, memosIn(data, state!.memos, folder.id).length, digitKey(index)));
    element.addEventListener("mouseleave", hideTip);
    // #119: its count said after its name, worked out when it takes the keyboard (not on every redraw).
    element.addEventListener("focus", () => element.setAttribute("aria-description", sheetCountWords(memosIn(data, state!.memos, folder.id).length)));
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
  pinned.addEventListener("focus", () => pinned.setAttribute("aria-description", sheetCountWords(memosIn(data, state!.memos, pinnedView).length)));
  dropTarget(pinned, pinnedView);
  const add = h("button", { class: "bk add", title: t("새 폴더"), "aria-label": t("새 폴더") }, icon("plus", 13, 2));
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
  // #119: Narrator read only the folder's name; it says it is the folder list too.
  folderButton.setAttribute("aria-label", folderButton.title);
  searchButton.setAttribute("aria-pressed", String(searching));
  qk.className = `qk c-${viewColor()}`;
  quickTo.textContent = t("{name}에 넣어요", { name: viewName() });
  // #114: the results take the quick-write slip's place while searching (as on the Mac).
  qk.hidden = searching;
  renderChips();
}

function renderList(): void {
  if (!state) return;
  if (searching) {
    // #114: the results by folder — each group under its colour, name and count — kept to the chips.
    const groups = drawerFind(folders(), state.memos, query, searchHere ? currentView() : undefined, searchFilters.filter((filter) => searchOn.has(filter)), lang());
    const total = groups.reduce((sum, group) => sum + group.hits.length, 0);
    list.classList.toggle("dense", total > 20);
    list.replaceChildren(...groups.flatMap((group) => [findHeader(group.folder, group.hits.length), ...group.hits.map((hit) => closedSlip(hit.memo, undefined, hit))]));
    const asked = query.trim() || [...searchOn].map(filterWord).join(" · ");
    // One shape for every search that finds nothing (#39): the words looked for (or the chips), then 없어요; before
    // anything is asked, the 초성 hint.
    if (total === 0) list.append(h("div", { class: "empty" }, h("p", {}, asked ? t("‘{query}’에 맞는 게 없어요", { query: asked }) : t("초성으로도 찾을 수 있어요 (예: ㅂㄱㅅ → 보고서)"))));
    count.textContent = searchFooterWords(total, groups.length, lang());
    return;
  }
  const groups = shownGroups();
  // #115: 제목만 — one line a memo (the open one is its card).
  const titles = viewShape() === "titles";
  const proxies = groups.flatMap((group) => group.memos);
  const real = new Map(state.memos.map((memo) => [memo.id, memo]));
  const keep = editor && editing && !big ? list.querySelector<HTMLElement>(`.it.open[data-id="${CSS.escape(editor.id)}"]`) : null;
  const nodes: HTMLElement[] = [];
  // Everything every card reads besides its memo: when it changes, every card is made again.
  // The words' face, size and lines too (#198: the previews are drawn in them; core/textSteps.ts cardFaceKey).
  const look = `${lang()}|${currentView()}|${viewSort()}|${renderedDay}|${cardFaceKey(state.prefs, lang() !== "ko")}`;
  if (look !== slipLook) { slipLook = look; slips.clear(); headers.clear(); }
  const nextSlips: typeof slips = new Map();
  const nextHeaders: typeof headers = new Map();
  for (const group of groups) {
    if (group.header) nodes.push(cachedHeader(group, nextHeaders));
    for (const proxy of group.memos) {
      const memo = real.get(proxy.id);
      if (!memo) continue;
      // A memo written while another is open has no earlier self: its own time.
      if (memo.id !== openID) { nodes.push(cachedSlip(memo, { kind: group.kind, proxy: frozen?.has(memo.id) ? proxy : memo }, titles, nextSlips)); continue; }
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
  list.classList.toggle("dense", proxies.length > 20 && !titles);
  list.classList.toggle("titles", titles);
  slips = nextSlips;
  headers = nextHeaders;
  const arrived = arrivedID && !reduceMotion() ? nextSlips.get(arrivedID)?.element : undefined;
  arrivedID = undefined;
  if (arrived && !arrived.classList.contains("arrive")) {
    arrived.classList.add("arrive");
    arrived.addEventListener("animationend", () => arrived.classList.remove("arrive"), { once: true });
  }
  if (proxies.length === 0) {
    nodes.push(currentView() === pinnedView
      // One line under the cat (#39); the footer only says 비어 있어요.
      ? h("div", { class: "empty" }, h("img", { src: "../../assets/pet/256/curious.png", alt: "", draggable: "false" }), h("p", {}, t("메모를 펼쳐 핀을 누르면 여기에 모여요.")))
      : h("div", { class: "empty" }, h("img", { src: "../../assets/pet/256/tea.png", alt: "", draggable: "false" }), h("p", {}, t("위 쪽지에 적거나, 다른 폴더의 메모를 이 책갈피로 끌어 와 보세요."))));
  }
  // The memo being typed stays where it is in the page (CodeMirror keeps its focus, caret and measurements), and so does
  // every card that didn't change.
  placeChildren<ChildNode>(list, nodes);
  const n = proxies.length;
  count.textContent = currentView() === pinnedView
    ? (n ? footerWords(t("고정"), n, lang()) : drawerFooter("pinned", 0, "", lang()))
    : (n ? footerWords(viewName(), n, lang()) : drawerFooter("folder", 0, viewName(), lang()));
  stackBars();
}

/** The open memo's bar: when its time doesn't fit beside the buttons, the short time; failing that, under them. */
function stackBars(): void {
  for (const bar of dr.querySelectorAll<HTMLElement>(".acts")) {
    bar.classList.remove("stack");
    const when = bar.querySelector<HTMLElement>(".when");
    if (!when) continue;
    when.dataset.full ??= when.textContent ?? "";
    when.textContent = when.dataset.full;
    when.title = "";
    if (when.scrollWidth <= when.clientWidth + 1) continue;
    when.title = when.dataset.full;
    if (when.dataset.short) when.textContent = when.dataset.short;
    if (when.scrollWidth > when.clientWidth + 1) bar.classList.add("stack");
  }
}

function markSelected(): void {
  for (const slip of list.querySelectorAll<HTMLElement>(".it")) {
    const on = slip.dataset.id === selectedID;
    slip.classList.toggle("selected", on);
    // #119: the keyboard's pick, said as the current one.
    if (on) slip.setAttribute("aria-current", "true"); else slip.removeAttribute("aria-current");
  }
}

/** 크게 보기: the open memo over the list, the drawer's whole height. */
let bigBox: HTMLElement | undefined;
function renderBig(): void {
  const memo = memoOf(openID);
  if (!big || !memo || !editor) { bigBox?.remove(); bigBox = undefined; return; }
  refreshEditor(editor, memo);
  const own = paperOf(folders(), memo.id);
  const fresh = h("div", { class: `big ${colorClass(folderOf(placementOf(folders(), memo.id).folder)?.color ?? "lavender")}`, role: "dialog", "aria-label": t("크게 보기"), ...(own ? { "data-sheet": own } : {}) },
    h("div", { class: "row" }, editor.titleField, progressText(memo)), editor.body.dom, actions(memo));
  fresh.style.setProperty("--big-top", `${Math.round(qk.offsetTop)}px`);
  if (bigBox) bigBox.replaceWith(fresh); else dr.append(fresh);
  bigBox = fresh;
  stackBars();
}

/** 크게 보기 came or went (#113): the main process widens the window toward the screen, or back to the user's width. */
let sentBig = false;
function sendBig(): void {
  const wide = big && Boolean(bigBox);
  if (wide === sentBig) return;
  sentBig = wide;
  api.send("drawer:big", wide);
}

function renderFooter(): void {
  const shortcut = state!.prefs.drawerShortcut;
  keyHint.textContent = shortcut ? shortcutLabel(shortcut) : "";
  keyHint.hidden = !shortcut;
  keyHint.title = shortcut ? t("{key}로 열고 닫아요", { key: shortcutLabel(shortcut) }) : "";
}

/**
 * 메모 글꼴 · 크기 (#84): the drawer's face and size step on the page — the words' face and size, their lines, the
 * preview's size (drawer.css reads them as --m-*). A handwriting face is the titles' face too; the plain and fixed-width
 * faces leave the titles in the notebook's handwriting.
 */
let memoTextKey = "";
function applyMemoText(): void {
  const prefs = state!.prefs;
  const face = prefs.drawerFont;
  root.dataset.font = face === "pen" || face === "brush" ? face : prefs.font;
  const latin = lang() !== "ko";
  const key = `${face}|${prefs.drawerTextPt}|${prefs.drawerLineHeight}|${prefs.drawerParagraph}|${prefs.drawerCodeFont}|${prefs.drawerShowMarks}|${latin}`;
  root.toggleAttribute("data-show-marks", prefs.drawerShowMarks);
  if (key === memoTextKey) return;
  memoTextKey = key;
  const metrics = drawerMetrics(prefs.drawerTextPt, prefs.drawerLineHeight, prefs.drawerParagraph);
  root.dataset.memoFont = face;
  // 코드 글꼴 (#143): D2Coding for code and the 고정폭 face (drawer.css), or the system's.
  root.dataset.codeFont = prefs.drawerCodeFont;
  // The handwriting faces run as much larger as the notebook's (pen 23 : 15, brush 22 : 15); the card's preview, 찾기's
  // found line and their checklist rows are in the words' face too, scaled alike (#198: 보통 pen 20, brush 19), on the
  // preview's lines (the Latin pen's a quarter taller).
  const faced = drawerFaceMetrics(prefs.drawerTextPt, face, latin);
  for (const [name, value] of [["--m-size", metrics.body], ["--m-face-size", faced.size], ["--m-line", metrics.line], ["--m-para", metrics.paragraph], ["--m-preview", metrics.preview], ["--m-preview-face", faced.previewSize], ["--m-preview-line", faced.previewLine]] as const) {
    root.style.setProperty(name, `${value}px`);
  }
  editor?.body.refont(prefs.drawerShowMarks);
  editor?.title.refont(prefs.drawerShowMarks);
}

function render(): void {
  if (!state) return;
  if (!shown) { dirty = true; return; }
  dirty = false;
  renderedDay = new Date().toDateString();
  applyMemoText();
  const focused = document.activeElement;
  renderTabs();
  placeCloseTab();
  renderHeader();
  renderList();
  renderBig();
  renderFooter();
  placeFormatBar();
  placeLinkBar();
  sendBig();
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
  searchHere = false;
  searchOn.clear();
  if (draw) render();
}

/** A result opened (a click, Enter): its folder shown, the memo open in it (#114). */
function revealHit(memo: Memo): void {
  const folder = placementOf(folders(), memo.id).folder;
  leaveSearch(false);
  view = folder;
  act({ type: "drawerView", view: folder });
  openMemo(memo.id, !checklistProgress(memo.text));
}

const filterWord = (filter: SearchFilter): string => ({ open: t("체크 남음"), link: t("링크"), pinned: t("고정") }[filter]);

/** A folder's group in the results: its colour as a small square, its name and count, a hairline (#114). */
function findHeader(id: string, count: number): HTMLElement {
  const folder = folderOf(id);
  return h("div", { class: "grp found", role: "presentation" },
    h("span", { class: "lbl" }, h("span", { class: `sq ${colorClass(folder?.color ?? "lavender")}` }), h("span", {}, folder ? folderName(folder, lang()) : "")),
    h("span", { class: "n" }, String(count)));
}

/** The chips under the field (#114): 모든 폴더 · {이름}만 (one of the two), then 체크 남음 · 링크 · 고정 (any of them). */
function renderChips(): void {
  chips.hidden = !searching;
  if (!searching) return;
  const chip = (label: string, on: boolean, press: () => void, toggles: boolean) => {
    const button = h("button", { class: `chip${on ? " on" : ""}`, "aria-pressed": String(on), ...(toggles ? {} : { role: "radio", "aria-checked": String(on) }) }, label);
    button.addEventListener("click", () => { press(); findInput.focus(); });
    return button;
  };
  const here = viewName();
  const pick = (value: boolean) => () => { if (searchHere !== value) { searchHere = value; selectedID = undefined; renderSearch(); } };
  chips.replaceChildren(
    h("div", { class: "chip-row", role: "radiogroup", "aria-label": t("찾는 곳") },
      chip(t("모든 폴더"), !searchHere, pick(false), false), chip(t("{name}만", { name: here }), searchHere, pick(true), false)),
    h("div", { class: "chip-row", role: "group", "aria-label": t("거르기") },
      ...searchFilters.map((filter) => chip(filterWord(filter), searchOn.has(filter), () => {
        if (searchOn.has(filter)) searchOn.delete(filter); else searchOn.add(filter);
        selectedID = undefined;
        renderSearch();
      }, true))));
  findInput.placeholder = searchHere ? t("{name}에서 찾기", { name: here }) : t("모든 폴더에서 찾기");
}

/** The chips and the results again, at once. */
function renderSearch(): void {
  clearTimeout(searchTimer);
  searchTimer = undefined;
  renderChips();
  renderList();
  list.scrollTop = 0;
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
  selectedID = undefined;
  if (!query.trim()) { showResults(); return; }
  searchTimer = setTimeout(showResults, searchPause);
});
findInput.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); leaveSearch(); quick.focus(); }
  if (event.key === "ArrowDown") { event.preventDefault(); if (searchTimer !== undefined) showResults(); step(1); }
  // #114: Enter opens the picked result, else the first.
  if (event.key === "Enter") {
    event.preventDefault();
    if (searchTimer !== undefined) showResults();
    const card = (selectedID ? list.querySelector<HTMLElement>(`.it[data-id="${CSS.escape(selectedID)}"]`) : null) ?? list.querySelector<HTMLElement>(".it[data-id]");
    const memo = memoOf(card?.dataset.id);
    if (memo) revealHit(memo);
  }
});
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
  if (index === 0 && by < 0) { selectedID = undefined; markSelected(); (searching ? findInput : quick).focus(); return; }
  selectedID = slips[next].dataset.id;
  markSelected();
  slips[next].focus({ preventScroll: true });
  slips[next].scrollIntoView({ block: "nearest" });
}

const selectedMemo = (): Memo | undefined => memoOf(selectedID ?? openID);
/** A text the keys type into: a field, or the open memo's words (CodeMirror's editable element, #84). */
const inField = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);

/** Shift+F10 or the Menu key: the menu of what has the focus (a field's text menu, a memo's, a bookmark's, else ⚙). */
function keyedMenu(): void {
  const focused = document.activeElement as HTMLElement | null;
  if (focused && inField(focused)) { const r = focused.getBoundingClientRect(); textMenu(focused, { x: r.left + 12, y: r.top + Math.min(r.height, 26) }, true); return; }
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
    if (linkEdit) { cancelLink(); return; }
    if (big) { big = false; render(); requestAnimationFrame(() => editor?.body.view.focus()); return; }
    if (openID) { const id = openID; slideCards(() => { closeOpen(); selectedID = id; render(); }); list.querySelector<HTMLElement>(`.it[data-id="${CSS.escape(id)}"]`)?.focus(); return; }
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
    // #118: Ctrl+/ the drawer's keys on a slip; Ctrl+Enter 크게 보기 of the open or picked memo (and back) — not in
    // the quick-write slip, whose Ctrl+Enter is its own.
    if (event.key === "/" || event.code === "Slash") { event.preventDefault(); act({ type: "drawerShortcuts" }); return; }
    if (event.key === "Enter" && event.target !== quick) {
      const memo = big ? memoOf(openID) : selectedMemo();
      if (!memo) return;
      event.preventDefault();
      if (big && openID === memo.id) { big = false; render(); requestAnimationFrame(() => editor?.body.view.focus()); } else showBig(memo);
      return;
    }
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
  // #118: Ctrl+Shift+M the picked (or open) memo's 폴더로 옮기기, under the folder's name.
  if (ctrl && event.shiftKey && !event.altKey && event.key.toLowerCase() === "m") {
    const memo = selectedMemo();
    if (memo) { event.preventDefault(); moveList(memo); }
    return;
  }
  // A field's own keys; on the close bar, Enter and Space press it (the button's own click).
  if (inField(event.target) || event.target === closeBar) return;
  if (event.key === "ArrowDown") { event.preventDefault(); step(1); }
  else if (event.key === "ArrowUp") { event.preventDefault(); step(-1); }
  else if (event.key === "Enter" && selectedID) {
    event.preventDefault();
    const memo = selectedMemo();
    // #114: a result opens in its folder.
    if (memo && searching) revealHit(memo);
    else if (memo) openMemo(memo.id, !checklistProgress(memo.text));
  }
});

// A click on the paper beside the cards puts the open one away.
list.addEventListener("click", (event) => {
  if (event.target === list && openID) slideCards(() => { closeOpen(); render(); });
});

// Right-click: a field's text menu, a memo's menu, else (the paper, the header) the ⚙ menu.
document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const target = event.target as HTMLElement;
  if (target.closest(".menu")) return;
  hideTip();
  const at = { x: event.clientX, y: event.clientY };
  const field = target.closest<HTMLElement>("input, textarea, .cm-content");
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
  ? ".hd, .qk, .it, .grp, .ft .gear, .ft .count, .ft .key, .empty, .bk, .menu, .big, .toast, .grip, .closebar, .list"
  : ".dr, .bk, .ears, .menu, .closebar");
window.addEventListener("mousemove", (event) => {
  if (dragging) return;
  const target = event.target as Element | null;
  setInteractive(Boolean(target?.closest?.(catches())) && !(backdrop === "none" && target === list));
});
document.documentElement.addEventListener("mouseleave", () => { if (!dragging) setInteractive(false); });

// The inner edge, dragged: the width follows (the main process keeps it within 260–480).
let queued: number | undefined;
const resizeTo = (x: number) => {
  if (queued !== undefined) cancelAnimationFrame(queued);
  queued = requestAnimationFrame(() => { queued = undefined; api.send("drawer:resize", x, false); });
};
const resizeDone = (x: number) => {
  dragging = false;
  if (queued !== undefined) cancelAnimationFrame(queued);
  api.send("drawer:resize", x, true);
};
grip.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  grip.setPointerCapture(event.pointerId);
  dragging = true;
});
grip.addEventListener("pointermove", (event) => {
  if (dragging) resizeTo(event.screenX);
});
const endDrag = (event: PointerEvent) => {
  if (dragging) resizeDone(event.screenX);
};
grip.addEventListener("pointerup", endDrag);
grip.addEventListener("pointercancel", endDrag);

/**
 * #164: the close tab in the middle of the paper's inner edge (drawer.css), or, when the bookmarks reach that far, 12px
 * under the last of them (never into the footer's height). Worked out when the bookmarks are drawn and on a resize.
 */
function placeCloseTab(): void {
  closeBar.style.top = "";
  tabs.style.bottom = "";
  const last = tabs.lastElementChild as HTMLElement | null;
  if (!last) return;
  const box = stage.getBoundingClientRect();
  // Where the bookmarks end as laid out, not as scrolled (the tab never moves with a scroll).
  const bookmarks = last.offsetTop + last.offsetHeight + tabs.offsetTop;
  // `top` is the tab's centre (its margin pulls it up by half); offsetTop is its top edge.
  const half = closeBar.offsetHeight / 2;
  const edge = closeBar.offsetTop;
  if (edge >= bookmarks + 12) return;
  const lowest = Math.max(edge + half, box.height - 52 - half);
  const centre = Math.min(bookmarks + 12 + half, lowest);
  closeBar.style.top = `${Math.round(centre)}px`;
  // No room under them (a short screen, many folders): the bookmarks end 12px above the tab and scroll.
  if (bookmarks + 12 + half > lowest) tabs.style.bottom = `${Math.round(box.height - (centre - half - 12))}px`;
}

// #83: the close bar in the middle of that edge. A press that moves more than `closeSlop` px is the edge being dragged
// (the width follows, as on the rest of the edge, and the click that follows doesn't close); one that doesn't closes
// the drawer. Enter and Space press it as a button (the same click).
const closeSlop = 3;
let barPress: { x: number; y: number; moved: boolean } | undefined;
let barDragged = false;
closeBar.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  closeBar.setPointerCapture(event.pointerId);
  barPress = { x: event.screenX, y: event.screenY, moved: false };
  barDragged = false;
});
closeBar.addEventListener("pointermove", (event) => {
  if (!barPress) return;
  if (!barPress.moved && Math.hypot(event.screenX - barPress.x, event.screenY - barPress.y) > closeSlop) {
    barPress.moved = true;
    dragging = true;
  }
  if (barPress.moved) resizeTo(event.screenX);
});
const endBar = (event: PointerEvent) => {
  const press = barPress;
  barPress = undefined;
  if (!press?.moved) return;
  resizeDone(event.screenX);
  // The click this press makes (if any) comes in the same turn; after it, a click closes again.
  barDragged = true;
  setTimeout(() => { barDragged = false; }, 0);
};
closeBar.addEventListener("pointerup", endBar);
closeBar.addEventListener("pointercancel", endBar);
closeBar.addEventListener("click", () => {
  if (barDragged) { barDragged = false; return; }
  close();
});

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
  add(closeBar.getBoundingClientRect());
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
window.addEventListener("resize", () => { placeCloseTab(); queueShape(); stackBars(); });

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
  sentBig = false; // the main process puts the width back as it closes (#113)
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

/**
 * M4 (#166): the one memo that just came in while the drawer is out (the quick-write slip's Enter, a paste, 빠른 메모, a
 * memo brought back) rises into its place once with 등장; memos that came while it was away don't.
 */
let knownIDs: Set<string> | undefined;
let arrivedID: string | undefined;
function noteArrivals(memos: Memo[]): void {
  const fresh = knownIDs && shown ? memos.filter((memo) => !knownIDs!.has(memo.id)) : [];
  arrivedID = fresh.length === 1 ? fresh[0].id : undefined;
  knownIDs = new Set(memos.map((memo) => memo.id));
}

api.on("state:memos", (next) => {
  state = next as MemosState;
  noteArrivals(state.memos);
  // Restored memos the trash still lists only until the state says where they are.
  for (const id of restoring) if (!state.memoTrash.entries.some((entry) => entry.memo.id === id)) restoring.delete(id);
  if (view === undefined) view = state.prefs.drawerLastFolder || inboxID;
  render();
});
void api.getState().then((initial) => {
  state = initial;
  noteArrivals(initial.memos);
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
  /** #114: a filter chip on, or only the folder shown. */
  searchFilter: (filter: SearchFilter) => { if (!searching) enterSearch(); searchOn.add(filter); renderSearch(); },
  searchHere: () => { if (!searching) enterSearch(); searchHere = true; renderSearch(); },
  view: (id: string) => setView(id),
  big: () => { const memo = selectedMemo(); if (memo) showBig(memo); },
  folderMenu: (id: string) => { const element = tabs.querySelector<HTMLElement>(`[data-folder="${CSS.escape(id)}"]`); const folder = folderOf(id); if (element && folder) { const r = element.getBoundingClientRect(); folderMenu(folder, { x: r.right + 4, y: r.top + 6 }); } },
  pinnedMenu: () => { const element = tabs.querySelector<HTMLElement>(`[data-folder="${pinnedView}"]`); if (element) { const r = element.getBoundingClientRect(); pinnedMenu({ x: r.right + 4, y: r.top + 6 }); } },
  sortMenu: (id: string) => { (window as unknown as { drawerTest: { folderMenu(id: string): void } }).drawerTest.folderMenu(id); [...document.querySelectorAll<HTMLElement>(".menu .mi")].find((row) => row.textContent?.includes(t("정렬")))?.click(); },
  newFolder: () => { const add = tabs.querySelector<HTMLElement>(".bk.add"); if (add) folderForm(add.getBoundingClientRect()); },
  moveMenu: () => { const button = list.querySelector<HTMLElement>(".it.open .acts .pill:last-child .ib"); button?.click(); },
  memoMenu: (id: string, sub = false) => { const memo = memoOf(id); const r = cardRect(id); if (memo && r) { memoMenu(memo, { x: r.left + 30, y: r.top + 20 }); if (sub) [...document.querySelectorAll<HTMLElement>(".menu .mi")].find((row) => row.textContent?.includes(t("폴더로 옮기기")))?.click(); } },
  memoMore: () => { list.querySelector<HTMLElement>(".it.open .acts .pill:nth-child(3) .ib")?.click(); },
  gearMenu: () => gearMenu(gearButton.getBoundingClientRect()),
  folderList: () => folderList(),
  /** #120: 지운 메모's slip, and its question before 모두 비우기. */
  trash: (confirming = false) => trashSlip(confirming),
  textMenu: (id: string) => { openMemo(id, true); requestAnimationFrame(() => { if (editor) { editor.body.view.focus(); const r = editor.body.dom.getBoundingClientRect(); textMenu(editor.body.view.contentDOM, { x: r.left + 40, y: r.top + 10 }); } }); },
  tip: (id: string) => { const element = tabs.querySelector<HTMLElement>(`[data-folder="${CSS.escape(id)}"]`); element?.dispatchEvent(new MouseEvent("mouseenter")); },
  hover: (id: string) => { for (const slip of list.querySelectorAll<HTMLElement>(".it")) { slip.classList.toggle("preview-hover", slip.dataset.id === id); if (slip.dataset.id === id) hoverPill(slip); } },
  type: (text: string) => { quick.value = text; fitQuick(); },
  /** #84: words typed at the end of the open memo, as keys would (the editor styles them as they come). */
  /** #84: the Aa bar out under the open memo. */
  formatBar: () => { formatOpen = true; requestAnimationFrame(() => { placeFormatBar(); list.querySelector(".it.open > .acts")?.scrollIntoView({ block: "end" }); }); },
  /** #118: Ctrl+Shift+M's list for a memo. */
  moveList: (id: string) => { const memo = memoOf(id); if (memo) moveList(memo); },
  /** #134: the open memo's title as if it had the caret (its marks faint) or not (hidden). */
  titleCaret: (on: boolean) => { showTitleCaret(on); editor?.title.refont(state!.prefs.drawerShowMarks); },
  /** #135: the link field under the open memo, its address typed (or the link's). */
  linkField: (url: string, existing: boolean) => { requestAnimationFrame(() => { askLink({ from: 0, to: 0, url, existing }); list.querySelector(".it.open > .acts")?.scrollIntoView({ block: "end" }); }); },
  typeInMemo: (text: string) => {
    requestAnimationFrame(() => {
      const view = editor?.body.view;
      if (!view) return;
      const end = view.state.doc.length;
      view.focus();
      view.dispatch({ changes: { from: end, insert: text }, selection: { anchor: end + text.length }, userEvent: "input.type", scrollIntoView: true });
    });
  },
  /** #82 · #83: the empty bookmark (+) and the close bar drawn as if under the pointer. */
  edgeHover: () => stage.classList.add("edge-hover"),
  reset: () => { stage.classList.remove("edge-hover"); formatOpen = false; closeLink(); showTitleCaret(false); closeMenus(); hideTip(); closeOpen(); if (searching) leaveSearch(false); big = false; selectedID = undefined; quick.value = ""; fitQuick(); toast.hide(); slips.clear(); headers.clear(); render(); list.scrollTop = 0; },
};
