import {
  bodyFontSize, calendarAlertChoicesIn, fontTitles, styleDetails, styleTitles, textStepTitles,
  type TodosState, type DrawerFont, type NotebookFont, type Prefs, type ReminderStyle, type SpaceGroupStyle, type SystemNotify,
} from "../core/types";
import { codeFonts, drawerMetrics, drawerPoints, faceSize, lineSpacings, paragraphSpacings, type CodeFont, type LineSpacing, type ParagraphSpacing } from "../core/textSteps";
import { d2codingFamily, monoFamily, paperSamples } from "../core/drawerPapers";
import { archiveChoicesIn, logicalDayStart } from "../core/archive";
import type { TimerCommand } from "../core/focusTimer";
import type { TypingScope } from "../core/typingCat";
import { nativeName, shortDate, spokenTime, weekdayOrder, weekdayShort, type LanguageSetting } from "../core/lang";
import { alarmSounds, daysText, newAlarm, nextFire, normalTime, snoozeSettings, timeParts, timeText, untilText, type Alarm, type AlarmSound } from "../core/alarm";
import { durationText, maxTimerMinutes, parseDuration } from "../core/duration";
import { isoDate } from "../core/notebook";
import { previewSound } from "./alarmSound";
import { describe, nextOccurrence, type Series } from "../core/repeat";
import { pageOf } from "../core/shelf";
import { repeatFields } from "./repeatFields";
import { edgeFade, h, icon, lang, paper, t, wrapText } from "./api";
import { listenForTyping } from "./typingTap";
import { holdWhileAsked } from "./askGuard";
import { isSettingsTab, readPane, type PaperSetting, type SettingsTab } from "../core/desk";
import { paneTitle } from "./deskPanes";
import { chatterFrequencyTitles } from "../core/chatter";
import { timerSizes, timerSizeTitles } from "../core/timerWidget";
import { sweepTimes } from "../core/sweep";
import { defaultDrawerShortcut, drawerWidth, readShortcut, shortcutLabel, type DrawerBackdrop, type MemoPaper } from "../core/memoDrawer";
import { darkKinds, drawerKindOf, isDarkPaper, lightKinds, nightChoices, noteSamples, paperKinds, paperRuling, readPaperKind, shownPaper, type NightChoice, type PaperKind } from "../core/paper";
import { defaultNoteShortcut, takenBy } from "../core/shortcuts";
import { generalDefaults, generalName, liveSpaces, newSpaceID, nextSpaceColor, spaceColor, spaceColors, spaceIndexOf, seriesSpaceOf, spaceObjectWords, type SpaceColor, type TodoSpace } from "../core/todoSpaces";
import { toaster } from "./slip";
import { openMenu, type MenuHost } from "./drawerMenu";
import { deviceDeskFooter, deviceNone, devicePopupLabel, devicePresets, deviceSlipTitle, deviceWords, hiddenSpaces, readDeviceRules, storedDeviceRules, type DeviceRule } from "../core/spaceDevice";
import { deviceMark, deviceStatusLine, openTimesSlip } from "./deviceSlip";
import { folderPlace, placeSeparator, placeText } from "../core/storage";
import { backupStatus, countsText, savedWhen, sizeText, type BackupReason } from "../core/backup";
import type { BackupEntry } from "../core/types";
import { widgetName, type WidgetSettings } from "../core/calendarWidget";
import { openWidgetGallery, openWidgetSettings, widgetSummary, widgetThumb, widgetsFull } from "./widgetSlips";

// #229: a question waiting holds this page up (askGuard.ts).
holdWhileAsked();

const api = paper();
let state: TodosState;
type Tab = SettingsTab;
const requestedTab = readPane(new URLSearchParams(location.search).get("tab"), true);
let tab: Tab = requestedTab && isSettingsTab(requestedTab) ? requestedTab : "appearance";
/** Which recurring task is being edited ("new" for the add form); while a form is open, redraws wait until it closes. */
let openForm: string | undefined;
/** The alarm open for editing (Settings → 시계) and its changes not yet saved; redraws from the main process wait meanwhile. */
let editingAlarm: Alarm | undefined;
/** What is typed in 시계 → 타이머 시작 → 직접, kept across redraws. */
let customTimerText = "";
const intervalPresets = [10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const fonts: NotebookFont[] = ["pen", "brush", "clean"];
const styles: ReminderStyle[] = ["compact", "paper", "character"];

/** What each pane is for, under its name (the desk's pane header). */
const subtitles: Record<Tab, string> = {
  appearance: t("언어와 낮 · 밤, 종이, 노트의 글꼴과 글자 크기를 정해요."),
  notifications: t("주기 알림과 알림 모양을 정해요."),
  repeat: t("반복하는 날마다 목록에 한 줄씩 놓여요."),
  pet: t("종이냥을 보이거나 숨기고, 돌아다닐지, 말을 걸지 정해요."),
  clock: t("알람을 맞추고, 뽀모도로 시간과 소리를 정하고 바로 시작해요."),
  events: t("일정을 적어 두면 오늘 할 일 위에 보이고, 시작 전에 알려 줘요."),
  storage: t("공유 폴더에 두면 다른 기기에서도 같은 목록을 써요."),
  ai: t("Claude와 이야기하면서 할 일과 일정을 보고, 넣고, 고쳐요."),
  drawer: t("화면 끝에서 메모를 꺼내 보고, 바로 적고, 그 자리에서 고쳐요."),
  spaces: t("할 일을 회사 · 집처럼 나눠요. 오늘 한 장은 그대로예요."),
};

const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) => api.act({ type: "setPref", key, value });

/** A titled card of rows, and its footnote; `more` (a 도움말 topic) ends the footnote in ‘자세히’, which opens it (#21). */
function group(label: string, content: Node[], foot?: string, warn = false, more?: string): HTMLElement {
  const footnote = foot ? h("div", { class: `foot${warn ? " warn" : ""}` }, wrapText(foot)) : null;
  if (footnote && more) {
    const link = h("button", { class: "textlink more" }, t("자세히"));
    link.addEventListener("click", () => api.act({ type: "openHelp", topic: more }));
    footnote.append(" ", link);
  }
  return h("div", { class: "group" }, h("div", { class: "label" }, label), h("div", { class: "card" }, ...content), footnote);
}

/**
 * A storage folder's place (1.30, core/storage.ts folderPlace): the places it is in faint and cut from the front when
 * long, then its own name in full and a little bolder — "~ › AppData › Roaming › PaperTodo", "OneDrive › 종이냥" (as
 * on the Mac). The whole path in the tooltip and when copied.
 */
function folderPlaceLine(folder: string): HTMLElement {
  // A drive letter or \\server: a Windows path (the snapshots, drawn on a Mac, have Mac ones).
  const place = folderPlace(folder, state.storage.home, /^[a-z]:[\\/]|^\\\\/i.test(folder));
  const lead = place.lead.length ? h("span", { class: "fp-lead" }, h("bdi", {}, `${place.lead.join(placeSeparator)} ›`)) : null;
  const element = h("div", { class: "folder-place", title: folder, "aria-label": t("폴더 위치 {path}", { path: placeText(place) }) },
    lead, h("span", { class: "fp-name" }, place.name));
  element.addEventListener("copy", (event) => { event.preventDefault(); event.clipboardData?.setData("text/plain", folder); });
  return element;
}

/** A key at the end of a row (#53), a cap per key (Ctrl + Shift + 0), as in the shortcut list. */
function rowKeys(keys: string[]): HTMLElement {
  return h("span", { class: "row-keys", role: "img", "aria-label": keys.join(" + ") },
    ...keys.flatMap((key, index) => [index > 0 ? h("span", { class: "plus", "aria-hidden": "true" }, "+") : null, h("kbd", { class: "keycap", "aria-hidden": "true" }, key)]));
}

/** A row's line icon on a small sage square. */
function glyph(name: string): HTMLElement {
  return h("span", { class: "glyph", "aria-hidden": "true" }, icon(name, 16, 1.7));
}

/** The pane's header: its name and what it is for (꾸미기 keeps one small cat). */
function paneHead(): HTMLElement {
  // 메모 서랍: 서랍 열기 in the header, not in a row about something else (#27).
  const open = tab === "drawer" ? h("button", { class: "action ph-action" }, icon("pawPrint", 13), t("서랍 열기")) : null;
  open?.addEventListener("click", () => api.act({ type: "drawer", command: "open" }));
  // #240 (D2 C): 저장과 백업's title is the question it answers, its name small above it.
  const question = tab === "storage" ? t("할 일을 어디에 둘까요?") : undefined;
  return h("header", { class: "pane-head" },
    h("div", { class: "ph-text" }, question ? h("div", { class: "ph-eyebrow" }, paneTitle(tab)) : null, h("h1", {}, question ?? paneTitle(tab)), h("p", { class: "ph-sub" }, subtitles[tab])),
    open,
    tab === "appearance" ? h("img", { class: "ph-cat", src: "../../assets/pet/256/groom.png", alt: "", draggable: "false" }) : null);
}

function segmented<T extends string | number>(options: { value: T; title: string }[], selected: T, onPick: (value: T) => void, label: string): HTMLElement {
  const control = h("div", { class: "segmented", role: "radiogroup", "aria-label": label });
  for (const option of options) {
    const choice = h("button", { role: "radio", "aria-checked": String(option.value === selected) }, option.title);
    choice.addEventListener("click", () => onPick(option.value));
    control.append(choice);
  }
  return control;
}

/** A popup (as on the Mac's): a native select; `face` draws a font's name in that font, the picked one in the field too. */
function popup<T extends string>(options: { value: T; title: string; face?: string }[], selected: T, onPick: (value: T) => void, label: string): HTMLSelectElement {
  const select = h("select", { class: "popup", "aria-label": label }) as HTMLSelectElement;
  for (const option of options) {
    const element = h("option", { value: option.value }, option.title) as HTMLOptionElement;
    if (option.face) element.style.fontFamily = option.face;
    element.selected = option.value === selected;
    select.append(element);
  }
  const face = options.find((option) => option.value === selected)?.face;
  if (face) select.style.fontFamily = face;
  // The handwriting runs small at the UI's size: its name a size up, as the Mac draws it.
  if (face && /pen-font|brush-font/.test(face)) select.style.fontSize = "17px";
  select.addEventListener("change", () => onPick(select.value as T));
  return select;
}

/**
 * A slider in steps (#141, as on the Mac): a sage fill up to a white knob, a tick under each step, a small 가 and a large
 * 가 at the ends. ← → move it a step (the browser's own range keys); Narrator reads the step's name. `shown` is the
 * value beside it, changed while it is dragged; the setting is saved when it is let go.
 */
function stepSlider(count: number, index: number, onPick: (index: number) => void, label: string, spoken: (index: number) => string, shown: HTMLElement, text: (index: number) => string): HTMLElement {
  const input = h("input", { type: "range", class: "step-slider", min: "0", max: String(count - 1), step: "1", value: String(index), "aria-label": label }) as HTMLInputElement;
  const ticks = Array.from({ length: count }, () => h("i", {}));
  const paint = (at: number) => {
    input.style.setProperty("--fill", `calc(8px + (100% - 16px) * ${at / (count - 1)})`);
    input.setAttribute("aria-valuetext", spoken(at));
    ticks.forEach((tick, tickAt) => tick.classList.toggle("on", tickAt <= at));
    shown.textContent = text(at);
  };
  paint(index);
  input.addEventListener("input", () => paint(Number(input.value)));
  input.addEventListener("change", () => onPick(Number(input.value)));
  return h("span", { class: "step-wrap" },
    h("span", { class: "step-ga small", "aria-hidden": "true" }, t("가")),
    h("span", { class: "step-track" }, input, h("span", { class: "step-ticks", "aria-hidden": "true" }, ...ticks)),
    h("span", { class: "step-ga large", "aria-hidden": "true" }, t("가")));
}

/** The CSS font of a drawer face (drawer.css: --m-font); 고정폭 in the 코드 글꼴 (#143). */
const drawerFace = (font: DrawerFont, code: CodeFont = "system"): string =>
  (font === "pen" ? "var(--pen-font)" : font === "brush" ? "var(--brush-font)" : font === "mono" ? codeFamily(code) : "var(--ui)");
const codeFamily = (code: CodeFont): string => (code === "d2coding" ? d2codingFamily : monoFamily);

/**
 * 메모 서랍 → 메모 글꼴's sample (#141): a memo sheet on the drawer's paper (its colours from core/drawerPapers.ts) —
 * a handwritten title, a paragraph, a checklist with one item done and one with `code` — in the drawer's face, size,
 * line and paragraph room. The words are made up.
 */
function drawerFontPreview(prefs: Prefs): HTMLElement {
  const sample = paperSamples[drawerPaperShown(prefs)];
  const metrics = drawerMetrics(prefs.drawerTextPt, prefs.drawerLineHeight, prefs.drawerParagraph);
  const face = prefs.drawerFont;
  const size = faceSize(face, metrics.body);
  const hand = face === "pen" || face === "brush" ? face : prefs.font;
  const box = (done: boolean) => h("span", { class: `dfp-box${done ? " on" : ""}` }, done ? icon("check", 9, 3) : null);
  const element = h("div", { class: "dfp", role: "img", "aria-label": t("메모 글꼴 미리보기") },
    h("div", { class: "dfp-sub" }, t("메모 서랍 · 회사")),
    h("div", { class: "dfp-sheet" },
      h("div", { class: `dfp-title${hand === "clean" ? " clean" : ""}` }, t("주간 회의")),
      h("div", { class: "dfp-ln dfp-para" }, t("시안 두 개는 금요일까지 보내요.")),
      h("div", { class: "dfp-ln done" }, box(true), h("span", {}, t("회의실 잡기"))),
      h("div", { class: "dfp-ln" }, box(false), h("span", {}, t("자료 묶어서 올리기"), " ", h("code", {}, "v2-final")))));
  const style: Record<string, string> = {
    "--p-paper": sample.paper, "--p-edge": sample.edge, "--p-card": sample.card, "--p-card-edge": sample.cardEdge, "--p-ink": sample.ink,
    "--p-sub": sample.sub, "--p-meta": sample.meta, "--p-box": sample.box, "--p-check": sample.check, "--p-on-check": sample.onCheck,
    "--p-face": drawerFace(face, prefs.drawerCodeFont), "--p-mono": codeFamily(prefs.drawerCodeFont), "--p-size": `${size}px`, "--p-mono-size": `${metrics.body - 1}px`, "--p-line": `${metrics.line}px`, "--p-para": `${metrics.paragraph}px`,
    "--p-hand": hand === "brush" ? "var(--brush-font)" : hand === "pen" ? "var(--pen-font)" : "var(--ui)",
  };
  for (const [name, value] of Object.entries(style)) element.style.setProperty(name, value);
  return element;
}

/** The papers' names (the drawer's ⚙ menu says them the same way; core/paper.ts paperNames, tested against the tables). */
const paperNames = (): Record<MemoPaper, string> => ({
  day: t("낮 종이"), hanji: t("한지"), kraft: t("크라프트지"), grid: t("모눈 노트"), sage: t("쑥색 종이"), blossom: t("벚꽃 종이"), memo: t("노란 메모지"),
  manuscript: t("원고지"), lined: t("하늘색 줄노트"), lavender: t("라벤더 종이"), recycled: t("재생지"),
  night: t("밤 종이"), ink: t("먹색 종이"), nightsky: t("밤하늘 종이"), chalk: t("칠판"),
});
/** What Narrator reads for a tile: the name and whether it is light or dark (the radio adds ‘선택됨’). */
const paperTileLabel = (paper: PaperKind): string =>
  isDarkPaper(paper) ? t("{name}, 어두운 종이", { name: paperNames()[paper] }) : t("{name}, 밝은 종이", { name: paperNames()[paper] });
/** After a tile is picked with the keyboard, the redrawn gallery gives the focus back to the picked tile. */
let focusPaperTile = false;

/** The drawer's paper shown now: the notepad's (노트와 같은 종이), or its own by 낮 · 밤 now (core/paper.ts drawerShown). */
function drawerPaperShown(prefs: Prefs): PaperKind {
  if (prefs.drawerSameAsNote) return readPaperKind(api.paperShown());
  return shownPaper({ dayNight: api.paperNightNow() ? "night" : "day", paper: drawerKindOf(prefs.drawerTheme), night: prefs.drawerNight }, false).shown;
}

/**
 * A gallery of the fifteen papers (#244): 밝은 종이 and 어두운 종이 under their headings, and still one radio group
 * (‘종이’ or ‘서랍 종이’): ← → ↑ ↓ go to the next or previous of all fifteen, round from the last to the first, and pick it
 * — as Narrator reads it (‘노란 메모지, 밝은 종이, 선택됨’). The picked one has a sage edge and a check.
 */
function paperTiles(label: string, picked: PaperKind | undefined, frameOf: (paper: PaperKind, on: boolean) => HTMLElement, pick: (paper: PaperKind) => void): HTMLElement {
  const names = paperNames();
  const tile = (paper: PaperKind): HTMLElement => {
    const on = paper === picked;
    // With none picked (a drawer that follows the notepad), the first tile takes the Tab key.
    const element = h("button", { class: "paper-tile", role: "radio", "aria-checked": String(on), "aria-label": paperTileLabel(paper), tabindex: on || (!picked && paper === paperKinds[0]) ? "0" : "-1", "data-kind": paper },
      frameOf(paper, on), h("span", { class: "pt-name" }, names[paper]));
    element.addEventListener("click", () => { if (!on) pick(paper); });
    element.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = paperKinds[(paperKinds.indexOf(paper) + step + paperKinds.length) % paperKinds.length];
      focusPaperTile = true;
      pick(next);
    });
    return element;
  };
  return h("div", { class: "paper-tiles", role: "radiogroup", "aria-label": label },
    h("div", { class: "pt-head", "aria-hidden": "true" }, t("밝은 종이")),
    h("div", { class: "paper-gallery" }, ...lightKinds.map(tile)),
    h("div", { class: "pt-head", "aria-hidden": "true" }, t("어두운 종이")),
    h("div", { class: "paper-gallery" }, ...darkKinds.map(tile)));
}

/** A small notepad (꾸미기 → 종이): the paper with its own ruling, the 오늘 tab, a sage check and two lines of ink. */
function noteTileFrame(paper: PaperKind, on: boolean): HTMLElement {
  const sample = noteSamples[paper];
  const frame = h("span", { class: `pt-frame note rule-${paperRuling[paper]}`, "aria-hidden": "true" },
    h("span", { class: "nt-tab" }), h("span", { class: "nt-check" }), h("span", { class: "nt-line" }), h("span", { class: "nt-line short" }),
    on ? h("span", { class: "pt-check" }, icon("check", 10, 3)) : null);
  for (const [name, value] of Object.entries({ "--t-paper": sample.paper, "--t-rule": sample.rule, "--t-margin": sample.margin, "--t-tab": sample.tab, "--t-sage": sample.sage, "--t-ink": sample.ink })) frame.style.setProperty(name, value);
  return frame;
}

/**
 * 서랍 종이 (#142, as on the Mac): a small drawer per paper — its paper, three bookmarks on the left, a sheet with a
 * handwritten title and two lines, the folder colours' dots — drawn from core/drawerPapers.ts.
 */
function drawerTileFrame(paper: PaperKind, on: boolean): HTMLElement {
  const sample = paperSamples[paper];
  const frame = h("span", { class: "pt-frame", "aria-hidden": "true" },
    h("span", { class: "pt-tabs" }, ...sample.tabs.slice(0, 3).map((color) => h("i", { style: `background:${color}` }))),
    h("span", { class: "pt-sheet" }, h("b", {}, t("주간 회의")), h("i", {}), h("i", { class: "short" })),
    h("span", { class: "pt-dots" }, ...sample.tabs.map((color) => h("i", { style: `background:${color}` }))),
    on ? h("span", { class: "pt-check" }, icon("check", 10, 3)) : null);
  for (const [name, value] of Object.entries({ "--t-paper": sample.paper, "--t-edge": sample.edge, "--t-card": sample.card, "--t-card-edge": sample.cardEdge, "--t-ink": sample.ink })) frame.style.setProperty(name, value);
  return frame;
}

/** 밤에는 (#244): 그대로 · 밤 종이 · 먹색 종이 · 밤하늘 종이 · 칠판 — dimmed, with the reason, under a dark paper. */
function nightRow(choice: NightChoice, paper: PaperKind, onPick: (value: NightChoice) => void, label: string): HTMLElement {
  const names = paperNames();
  const options = nightChoices.map((value) => ({ value, title: value === "keep" ? t("그대로") : names[value] }));
  const dark = isDarkPaper(paper);
  const select = popup(options, choice, onPick, label);
  const reason = t("어두운 종이는 밤에도 그대로예요.");
  if (dark) { select.disabled = true; select.setAttribute("aria-description", reason); }
  return h("div", { class: `row paper-night${dark ? " off" : ""}` }, glyph("moon"),
    h("div", { class: "grow" }, h("div", {}, t("밤에는")), dark ? h("div", { class: "sub" }, reason) : null), select);
}

function toggle(checked: boolean, label: string, onChange: (value: boolean) => void): HTMLElement {
  const control = h("button", { class: "switch", role: "switch", "aria-checked": String(checked), "aria-label": label });
  control.addEventListener("click", () => onChange(!checked));
  return control;
}

function intervalTitle(minutes: number): string {
  if (minutes < 60) return t("{minutes}분마다", { minutes });
  return minutes % 60 === 0 ? t("{hours}시간마다", { hours: minutes / 60 }) : t("{hours}시간 {minutes}분마다", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function statusText(): string {
  const { prefs, nextPeriodicDue } = state;
  if (!prefs.reminderEnabled) return t("꺼져 있어요. 켜면 노트를 쓰는 동안에는 잠시 기다렸다 알려 줘요.");
  if (!state.items.some((item) => !item.isCompleted && pageOf(item, new Date()) === "today")) return t("남은 할 일이 생기면 알려 줘요.");
  if (nextPeriodicDue) return t("노트를 쓰는 동안은 잠시 기다려요.");
  return t("알림 시간을 준비하고 있어요.");
}

/** Under 잠시 쉬기 (#240): when the next one comes, while there is one (the footnote said it before). */
function restDetail(): string {
  const { prefs, nextPeriodicDue } = state;
  const waiting = state.items.some((item) => !item.isCompleted && pageOf(item, new Date()) === "today");
  if (!prefs.reminderEnabled || !waiting || !nextPeriodicDue) return t("1시간 동안 주기 알림을 쉬어요.");
  const at = new Date(nextPeriodicDue);
  return t("다음 알림 {time}", { time: spokenTime(at.getHours(), at.getMinutes(), lang()) });
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function appearance(): Node[] {
  const { prefs } = state;
  const samples = state.items.length >= 2
    ? state.items.slice(0, 2).map((item) => ({ title: item.title, done: item.isCompleted }))
    : [{ title: t("창문 열고, 커피 한 잔"), done: true }, { title: t("미뤄 둔 책 10쪽 읽기"), done: false }];
  const preview = h("div", { class: "preview", "aria-label": t("글씨 미리보기") },
    ...samples.map((sample) => h("div", { class: `line${sample.done ? " done" : ""}` },
      h("span", { class: "box" }, sample.done ? icon("check", 10, 2.8) : null), h("span", { class: "text" }, sample.title))));

  // 노트 글꼴 (#141, as on the Mac): the face as a popup (each name in its face), the size in seven steps.
  const fontRow = h("div", { class: "row note-font" }, glyph("font"), h("span", { class: "grow" }, t("글꼴")),
    popup(fonts.map((font) => ({ value: font, title: fontTitles[lang()][font], face: font === "pen" ? "var(--pen-font)" : font === "brush" ? "var(--brush-font)" : "var(--ui)" })),
      prefs.font, (font) => set("font", font), t("노트 글꼴")));
  const stepName = h("span", { class: "step-value" });
  const sizeRow = h("div", { class: "row note-size" }, glyph("textSize"), h("span", { class: "grow" }, t("글자 크기")),
    stepSlider(textStepTitles[lang()].length, prefs.textStep, (step) => set("textStep", step), t("글자 크기"), (step) => textStepTitles[lang()][step], stepName, (step) => textStepTitles[lang()][step]),
    stepName);

  const startRow = h("div", { class: "row" }, glyph("power"), h("span", { class: "grow" }, t("컴퓨터를 켤 때 같이 열기")),
    toggle(prefs.openAtLogin, t("Windows 시작 시 실행"), (value) => set("openAtLogin", value)));
  // 작업 표시줄에 남은 개수: the taskbar button's small number (Windows).
  const badgeRow = h("div", { class: "row" }, glyph("bellDot"), h("span", { class: "grow" }, t("작업 표시줄에 남은 개수")),
    toggle(prefs.taskbarBadge, t("작업 표시줄에 남은 개수"), (value) => set("taskbarBadge", value)));

  const quickRow = h("div", { class: "row" }, glyph("keyboard"), h("span", { class: "grow" }, t("어디서든 빠른 입력 (Ctrl+Alt+N)")),
    toggle(prefs.quickEntry, t("어디서든 빠른 입력"), (value) => set("quickEntry", value)));
  const memoRow = h("div", { class: "row" }, glyph("note"), h("span", { class: "grow" }, t("어디서든 빠른 메모 (Ctrl+Alt+M)")),
    toggle(prefs.quickMemo, t("어디서든 빠른 메모"), (value) => set("quickMemo", value)));
  // #85: the note's key can be changed, as the drawer's (the same field, ‘기본값’ and switch).
  const noteRow = noteKeyRow();
  // 빠른 메모를 열 때 복사한 글 넣기: the text copied since it last opened, ready (and selected) in the empty memo.
  const clipRow = h("div", { class: "row" }, glyph("share"),
    h("div", { class: "grow" }, h("div", {}, t("빠른 메모를 열 때 복사한 글 넣기")), h("div", { class: "sub" }, t("빈 메모를 열면 방금 복사한 글이 골라진 채로 들어가요."))),
    toggle(prefs.quickMemoClipboard, t("빠른 메모를 열 때 복사한 글 넣기"), (value) => set("quickMemoClipboard", value)));
  // Another app holding a shortcut is said in the foot, in the accent colour.
  const shortcutProblems = [prefs.quickEntry ? state.shortcutProblem : undefined, prefs.quickMemo ? state.memoShortcutProblem : undefined, noteRecordProblem ?? (prefs.noteHotkey ? state.noteShortcutProblem : undefined)].filter(Boolean) as string[];
  const quickFoot = shortcutProblems.length > 0
    ? shortcutProblems.join(" ")
    : `${t("어떤 앱을 쓰다가도 Ctrl+Alt+N을 누르면 작은 종이가 떠요. 적은 말에 맞춰 알림 · 마감 · 일정을 정해요.")} ${t("Ctrl+Alt+M은 몇 줄을 바로 메모 서랍에 넣는 빠른 메모예요.")}`;

  // 언어: 자동 (the system's) or one of the three, each named in its own language; changing it restarts the app.
  const languages: { value: LanguageSetting; title: string }[] = [{ value: "auto", title: t("자동") }, ...(["ko", "en", "nl"] as const).map((value) => ({ value, title: nativeName[value] }))];
  const languageRow = h("div", { class: "row language" }, glyph("globe"), h("span", { class: "grow" }, t("앱 언어")),
    segmented(languages, prefs.language, (value) => set("language", value), t("언어")));
  // 낮 · 밤 (#142; ‘종이 색’ before — the same setting, `paper`): 자동 follows Windows' light or dark mode; 낮 and 밤 keep one.
  const papers: { value: PaperSetting; title: string }[] = [{ value: "auto", title: t("자동") }, { value: "day", title: t("낮") }, { value: "night", title: t("밤") }];
  // The icon follows the choice: half and half for 자동, a sun for 낮, a moon for 밤 (as on the Mac).
  const paperRow = h("div", { class: "row paper" }, glyph(prefs.paper === "day" ? "sun" : prefs.paper === "night" ? "moon" : "contrast"), h("span", { class: "grow" }, t("낮 · 밤")),
    segmented(papers, prefs.paper, (value) => set("paper", value), t("낮 · 밤")));
  // The due-style samples: a row's badge for a deadline three days off, as each style writes it (core label()).
  const [ddaySample, dateSample] = { ko: ["D-3", "~금"], en: ["3 days left", "by Fri"], nl: ["nog 3 dagen", "tot vr"] }[lang()]; // i18n-ok

  return [
    group(t("언어"), [languageRow]),
    group(t("낮 · 밤"), [paperRow], t("책상 · 노트 · 쪽지 · 서랍이 같이 바뀌어요. 자동이면 Windows가 어둡게 모드일 때 밤이 돼요.")),
    // 종이 (#244): fifteen papers for the notepad, the calendar, the widget, the slips and the desk, and 밤에는 under them.
    group(t("종이"), [paperTiles(t("종이"), prefs.paperTheme, noteTileFrame, (paper) => set("paperTheme", paper)), nightRow(prefs.paperNight, prefs.paperTheme, (value) => set("paperNight", value), t("밤에는"))],
      `${t("노트 · 달력 · 위젯 · 쪽지 · 책상이 같은 종이를 써요.")} ${t("밝은 종이는 밤이 되면 ‘밤에는’에서 고른 종이로 바뀌어요.")}`),
    // The sample sheet, named like every other group (#21).
    h("div", { class: "group" }, h("div", { class: "label" }, t("미리보기")), preview),
    group(t("노트 글꼴"), [fontRow, sizeRow], t("Ctrl + = 와 Ctrl + − 로 한 칸씩 바꿔요. 줄 간격은 노트의 줄에 맞춰져 있어요.")),
    group(t("마감 표시"), [h("div", { class: "row" }, glyph("flag"), h("span", { class: "grow" }, t("마감을 이렇게 보여 주기")),
      segmented([{ value: "dday", title: ddaySample }, { value: "date", title: dateSample }], prefs.dueStyle, (style) => set("dueStyle", style), t("마감 표시 방식")))],
      t("할 일의 알림 → 마감에서 오늘까지·이번 주 안·이번 달 안·날짜를 정해요. 지난 마감은 붉게 표시돼요.")),
    group(t("시작"), [startRow, badgeRow], t("작업 표시줄 단추를 우클릭하면 빠른 입력 · 빠른 메모 · 책상 · 타이머를 바로 열 수 있어요.")),
    group(t("빠른 입력"), [quickRow, memoRow, noteRow, clipRow], quickFoot, shortcutProblems.length > 0, "quick"),
  ];
}

/** 저장과 백업 → 완료한 일: when finished tasks move to the record, the record, and its folder (as on the Mac). */
function completedGroup(): HTMLElement {
  const { prefs } = state;
  const archiveSelect = h("select", { "aria-label": t("완료한 일 보관 시점") });
  for (const choice of archiveChoicesIn(lang())) {
    const option = h("option", { value: String(choice.days) }, choice.title);
    option.selected = choice.days === prefs.archiveAfterDays;
    archiveSelect.append(option);
  }
  archiveSelect.addEventListener("change", () => set("archiveAfterDays", Number(archiveSelect.value) as Prefs["archiveAfterDays"]));
  const archiveRow = h("div", { class: "row" }, glyph("calendar"), h("span", { class: "grow" }, t("완료한 일 기록으로 옮기기")), archiveSelect);
  // The desk's own 완료 기록 icon (1.30).
  const historyButton = h("button", { class: "row choice" }, glyph("leaf"), h("span", { class: "grow" }, t("완료 기록 보기")), h("span", { style: "color:var(--faded)" }, "Ctrl+H ›"));
  // #52: ‘↗ 폴더 열기’ at the end of the folder's row, as in 저장 위치.
  const openArchive = h("button", { class: "action small", title: t("탐색기에서 완료 기록 폴더 열기") }, icon("arrow", 13), t("폴더 열기"));
  openArchive.addEventListener("click", () => api.act({ type: "openArchiveFolder" }));
  const archiveFolderRow = h("div", { class: "row storage" }, glyph("folder"),
    h("div", { class: "grow" }, h("div", {}, t("기록 폴더")), folderPlaceLine(state.storage.archivePath)), openArchive);
  historyButton.addEventListener("click", () => api.act({ type: "openHistory" }));
  const archiveFoot = prefs.archiveAfterDays === 0
    ? t("완료한 일이 목록에 계속 남아요. ⋯ → 완료한 일 정리로 직접 지울 수 있어요.")
    : prefs.archiveAfterDays === 1 ? t("끝낸 일은 다음 날 새벽 4시에 완료 기록으로 옮겨요.")
    : prefs.archiveAfterDays === 3 ? t("끝낸 일은 3일 뒤 새벽 4시에 완료 기록으로 옮겨요.")
    : t("끝낸 일은 7일 뒤 새벽 4시에 완료 기록으로 옮겨요.");

  return group(t("완료한 일"), [archiveRow, historyButton, archiveFolderRow], archiveFoot);
}

/** 저장과 백업: where the list lives (this PC or a shared folder), and the .jongi backup to move it. */
/**
 * 저장과 백업 (#240, UI/UX 점검 3의 D2 C): the pane answers its own question — where the list lives — with two choices, then
 * says in one line when the last backup was. The paths, the switch, the long footnotes, the backup list, 완료한 일 and the
 * backup file are one ‘자세히 보기’ away (never gone); moving the list still goes through the folder dialog's line and the
 * question slips (#195), and going back to this PC asks first. No filled button: changing the folder is rare and heavy. The
 * Mac's pane (StoragePanel.swift) is the same.
 */
let storageMore = false;

function storagePane(): Node[] {
  const { storage, backups } = state;
  const shared = storage.custom;
  const here = folderPlace(storage.path, storage.home, /^[a-z]:[\\/]|^\\\\/i.test(storage.path)).name;
  const choice = (title: string, detail: string, selected: boolean, act: () => void) => {
    const card = h("button", { class: "storage-choice", role: "radio", "aria-checked": String(selected) },
      h("span", { class: "sc-radio", "aria-hidden": "true" }), h("span", { class: "sc-text" }, h("span", { class: "sc-title" }, title), h("span", { class: "sc-detail" }, detail)));
    card.addEventListener("click", act);
    return card;
  };
  const choices = h("div", { class: "storage-choices", role: "radiogroup", "aria-label": t("저장 위치") },
    choice(t("이 PC에만"), shared ? t("이 PC의 기본 폴더로 옮겨요") : t("지금 여기 있어요 · {name}", { name: here }), !shared,
      () => { if (shared) void api.act({ type: "resetStorage" }); }),
    choice(t("공유 폴더에"), shared ? t("지금 여기 있어요 · {name}", { name: here }) : t("OneDrive 같은 폴더를 골라요"), shared,
      () => { if (!shared) void api.act({ type: "chooseStorage" }); }));

  // 백업: one line — when the last copy was (or what is wrong), how they are made — and 지금 백업하기.
  const newest = backups.entries[0];
  const status = backupStatus({ auto: backups.auto, failed: backups.failed, missing: backups.missing, newest: newest ? new Date(newest.at) : undefined }, new Date(), lang());
  const mark = h("span", { class: `backup-mark ${status.tone}`, "aria-hidden": "true" }, icon(status.tone === "ok" ? "check" : status.tone === "warn" ? "warning" : "pause", 12, 2.4));
  const backUp = h("button", { class: "action small" }, t("지금 백업하기"));
  backUp.addEventListener("click", () => api.act({ type: "backupNow" }));
  const backupLine = h("div", { class: "group" }, h("div", { class: "label" }, t("백업")),
    h("div", { class: `backup-line ${status.tone}` }, mark,
      h("div", { class: "grow" }, h("div", { class: "backup-title" }, status.title), h("div", { class: `sub${status.tone === "warn" ? " warn" : ""}` }, wrapText(status.detail))),
      backUp));

  const openStorage = h("button", { class: "action small", title: t("탐색기에서 저장 폴더 열기") }, icon("arrow", 13), t("저장 폴더 열기"));
  openStorage.addEventListener("click", () => api.act({ type: "openDataFolder" }));
  const openBackups = h("button", { class: "action small", title: t("탐색기에서 백업 폴더 열기") }, icon("arrow", 13), t("백업 폴더 열기"));
  openBackups.addEventListener("click", () => api.act({ type: "openBackupFolder" }));
  const more = h("button", { class: "textlink storage-more", "aria-expanded": String(storageMore) },
    storageMore ? t("자세히 접기") : t("자세히 보기"), icon("chevron", 11, 2.2));
  more.addEventListener("click", () => { storageMore = !storageMore; render(); });
  const links = h("div", { class: "storage-links" }, openStorage, openBackups, h("span", { class: "spacer" }), more);

  return [choices, backupLine, links, ...(storageMore ? storageDetails() : [])];
}

/** 자세히 보기: the folder with its path, 다른 폴더… and the long footnote; 자동 백업; 백업 목록; 완료한 일; the backup file. */
function storageDetails(): Node[] {
  const { storage } = state;
  const choose = h("button", { class: "action small", title: t("폴더를 고르면 종이냥이 다시 시작돼요") }, icon("folder", 13), t("다른 폴더…"));
  choose.addEventListener("click", () => api.act({ type: "chooseStorage" }));
  const reset = h("button", { class: "action small", title: t("이 PC의 기본 위치로 돌아가요") }, t("기본으로"));
  reset.disabled = !storage.custom;
  reset.addEventListener("click", () => api.act({ type: "resetStorage" }));
  // #52: ‘↗ 폴더 열기’ at the end of the folder's row, as for 기록 폴더 (same name, same place).
  const openFolder = h("button", { class: "action small", title: t("탐색기에서 저장 폴더 열기") }, icon("arrow", 13), t("폴더 열기"));
  openFolder.addEventListener("click", () => api.act({ type: "openDataFolder" }));
  const whereRow = h("div", { class: "row storage" }, glyph("folder"),
    h("div", { class: "grow" }, h("div", { class: "where" }, h("span", {}, t("저장 폴더")), h("span", { class: "kind" }, storage.custom ? t("공유 폴더") : t("이 PC (기본)"))),
      folderPlaceLine(storage.path)), openFolder);
  const actionsRow = h("div", { class: "row storage-actions" }, h("span", { class: "grow" }), reset, choose);

  // 백업 · 옮기기: everything in the storage folder to one .jongi file, and back.
  const exportButton = h("button", { class: "action small", title: t("할 일 · 메모 · 반복 · 일정 · 완료 기록을 .jongi 파일 하나로") }, icon("arrowUp", 13), t("내보내기…"));
  exportButton.addEventListener("click", () => api.act({ type: "exportBackup" }));
  const importButton = h("button", { class: "action small", title: t("내보낸 .jongi 파일을 합치거나 바꿔 넣기") }, icon("arrowDown", 13), t("가져오기…"));
  importButton.addEventListener("click", () => api.act({ type: "importBackup" }));
  const backupRow = h("div", { class: "row storage-actions" }, glyph("share"), h("span", { class: "grow" }, t("백업 파일")), exportButton, importButton);

  return [
    group(t("저장 위치"), [whereRow, actionsRow], t("할 일 · 메모 · 일정 · 기록이 모두 이 폴더에 있어요. OneDrive 같은 공유 폴더를 고르면 다른 기기와 같은 목록을 써요. 다른 폴더를 고르면 지금 목록을 그 폴더로 옮기고 종이냥이 다시 시작돼요. 이미 종이냥 목록이 있는 폴더면 어느 쪽을 쓸지 물어요."), false, "data"),
    autoBackupGroup(),
    backupListGroup(),
    completedGroup(),
    group(t("백업 · 옮기기"), [backupRow],
      t("내보낸 백업 파일(.jongi)을 다른 컴퓨터의 종이냥에서 가져오면 모두 그대로 옮겨져요. Mac ↔ Windows도 돼요."), false, "backup"),
  ];
}

// ─── 자동 백업 · 백업 목록 (#139 · #140, the same as the Mac's) ─────────────────

/**
 * 자동 백업: whether the daily copy is on (and when the last copy was made), 지금 백업하기, and the backup folder — on this PC
 * unless another was chosen; never inside the storage folder.
 */
function autoBackupGroup(): HTMLElement {
  const { backups } = state;
  const newest = backups.entries[0];
  const title = backups.auto ? t("자동 백업이 켜져 있어요") : t("자동 백업이 꺼져 있어요");
  let sub = !backups.auto ? t("덮어쓰기 전에는 그래도 백업해 둬요.")
    : newest ? t("마지막 백업 {when} · 하루 한 번, 덮어쓰기 전에도", { when: savedWhen(new Date(newest.at), new Date(), lang(), true) })
    : t("아직 백업이 없어요 · 하루 한 번, 덮어쓰기 전에도");
  let warn = false;
  if (backups.failed) { sub = t("마지막 백업을 하지 못했어요. 백업 폴더를 확인해 주세요."); warn = true; }
  else if (backups.missing) { sub = t("고른 백업 폴더를 찾지 못해 기본 폴더에 백업해요."); warn = true; }
  const mark = h("span", { class: `backup-mark${backups.auto ? " on" : ""}`, "aria-hidden": "true" }, backups.auto ? icon("check", 13, 2.4) : null);
  const now = h("button", { class: "action small" }, t("지금 백업하기"));
  now.addEventListener("click", () => api.act({ type: "backupNow" }));
  const statusRow = h("div", { class: "row backup-status" }, mark,
    h("div", { class: "grow" }, h("div", { class: "backup-title" }, title), h("div", { class: `sub${warn ? " warn" : ""}` }, sub)),
    now, toggle(backups.auto, t("자동 백업"), (on) => api.act({ type: "setBackupAuto", on })));
  const open = h("button", { class: "action small", title: t("탐색기에서 백업 폴더 열기") }, icon("arrow", 13), t("폴더 열기"));
  open.addEventListener("click", () => api.act({ type: "openBackupFolder" }));
  const folderRow = h("div", { class: "row storage" }, glyph("archive"),
    h("div", { class: "grow" }, h("div", { class: "where" }, h("span", {}, t("백업 폴더")), h("span", { class: "kind" }, backups.custom ? t("고른 폴더") : t("이 PC (기본)"))),
      folderPlaceLine(backups.folder)), open);
  const reset = h("button", { class: "action small", title: t("이 PC의 기본 위치로 돌아가요") }, t("기본으로"));
  reset.disabled = !backups.custom && !backups.missing;
  reset.addEventListener("click", () => api.act({ type: "resetBackupFolder" }));
  const choose = h("button", { class: "action small" }, icon("folder", 13), t("다른 폴더…"));
  choose.addEventListener("click", () => api.act({ type: "chooseBackupFolder" }));
  const actionsRow = h("div", { class: "row storage-actions" }, h("span", { class: "grow" }), reset, choose);
  const where = backups.custom ? t("백업은 고른 폴더에만 있어요. 클라우드 폴더라면 백업도 그곳으로 올라가요.")
    : t("백업은 이 PC에만 있어요. 저장 폴더가 공유 폴더여도 백업은 기기마다 따로 남겨요.");
  const total = backups.entries.length ? ` ${t("모두 {count}개 · {size}.", { count: backups.entries.length, size: sizeText(backups.total, lang()) })}` : "";
  return group(t("자동 백업"), [statusRow, folderRow, actionsRow], where + total, false, "backup");
}

/** The kind of a copy, on its chip: 매일 (sage), the ‘before’ ones (clay), 업데이트 전 (lavender), 직접 (honey). */
function reasonChip(reason: BackupReason): HTMLElement {
  const words: Record<BackupReason, string> = {
    daily: t("매일"), beforeImport: t("가져오기 전"), beforeFolderSwitch: t("폴더 바꾸기 전"), beforeRestore: t("되돌리기 전"),
    beforeUpdate: t("업데이트 전"), manual: t("직접", undefined, "backup"), export: t("내보내기"),
  };
  const tone = reason === "daily" ? "sage" : reason === "beforeUpdate" ? "lavender" : reason === "manual" || reason === "export" ? "honey" : "clay";
  return h("span", { class: `backup-chip ${tone}` }, words[reason]);
}

/** 백업 목록: five newest unless opened up; the rest are still in the folder (and the more row says how many). */
let backupsOpened = false;

function backupRow(entry: BackupEntry): HTMLElement {
  const when = savedWhen(new Date(entry.at), new Date(), lang());
  const restore = h("button", { class: "action small" }, t("되돌리기…"));
  restore.addEventListener("click", () => api.act({ type: "restoreBackup", name: entry.name }));
  const row = h("div", { class: "row backup-row" },
    h("div", { class: "backup-left" }, h("div", { class: "backup-when" }, when), reasonChip(entry.reason)),
    h("div", { class: "backup-counts grow" }, entry.counts ? countsText(entry.counts, lang()).split(" · ").map((part) => part.replace(/ /g, "\u00a0")).join(" · ") : ""),
    h("span", { class: "backup-size" }, sizeText(entry.size, lang())),
    restore);
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openMenu(rowMenuHost, [
      { kind: "item", label: t("탐색기에서 보기"), icon: "folder", run: () => void api.act({ type: "showBackup", name: entry.name }) },
      { kind: "sep" },
      { kind: "item", label: t("지우기"), icon: "trash", danger: true, run: () => void api.act({ type: "deleteBackup", name: entry.name }) },
    ], when, { x: event.clientX, y: event.clientY });
  });
  return row;
}

function backupListGroup(): HTMLElement {
  const { entries } = state.backups;
  const foot = t("되돌리기 전에 지금 것을 한 번 더 백업해 둬요.");
  if (entries.length === 0) {
    return group(t("백업 목록"), [h("div", { class: "row backup-empty" }, h("span", { class: "sub" }, t("아직 백업이 없어요. 하루 한 번 여기에 쌓여요.")))], foot);
  }
  const rows: HTMLElement[] = (backupsOpened ? entries : entries.slice(0, 5)).map(backupRow);
  if (entries.length > 5) {
    const more = h("button", { class: "row choice backup-more" },
      h("span", { class: "grow" }, backupsOpened ? t("처음 5개만 보기") : t("{count}개 더 보기", { count: entries.length - 5 })));
    more.addEventListener("click", () => { backupsOpened = !backupsOpened; render(); });
    rows.push(more);
  }
  return group(t("백업 목록"), rows, foot);
}

/**
 * AI 연결 (1.27): the switch; connecting Claude Desktop (the bundled .mcpb) or Claude Code (a command to
 * paste); and Claude's work of today and yesterday, each with 되돌리기 — the same groups as the Mac's.
 */
function aiPane(): Node[] {
  const { ai } = state;
  const enabledRow = h("div", { class: "row", style: "padding-top:8px;padding-bottom:8px" }, glyph("chat"),
    h("span", { class: "grow" }, t("Claude가 종이냥을 보고 쓸 수 있게 하기")),
    toggle(ai.enabled, t("Claude가 종이냥을 보고 쓸 수 있게 하기"), (on) => api.act({ type: "aiEnable", on })));

  const desktop = h("button", { class: "action small primary" }, t("Claude 데스크톱에 연결"));
  desktop.addEventListener("click", () => api.act({ type: "aiConnectDesktop" }));
  const desktopRow = h("div", { class: "row ai-connect" }, glyph("desk"),
    h("div", { class: "grow" }, h("div", {}, t("Claude 데스크톱")), h("div", { class: "sub", ...(ai.outdated ? { role: "status" } : {}) },
      ai.outdated ? t("Claude 데스크톱의 확장이 이 앱보다 옛 판이에요. 다시 연결하면 새로 설치해요.") : t("누르면 Claude가 ‘종이냥 for Claude’를 설치할지 물어봐요."))), desktop);
  const copy = h("button", { class: "action small" }, ai.copied ? icon("check", 13) : icon("keyboard", 13), ai.copied ? t("복사했어요") : t("Claude Code 명령 복사"));
  copy.addEventListener("click", () => api.act({ type: "aiCopyCommand" }));
  const codeRow = h("div", { class: "row ai-connect" }, glyph("keyboard"),
    h("div", { class: "grow" }, h("div", {}, "Claude Code"), h("div", { class: "sub" }, t("복사한 명령을 터미널에 붙여 넣어요. Node.js는 없어도 돼요."))), copy);

  const rows: Node[] = [];
  if (ai.recent.length === 0) rows.push(h("div", { class: "row ai-empty" }, t("아직 없어요")));
  // #174: the log keeps 30 days; 기록 지우기 empties it now (after a slip).
  const clear = h("button", { class: "action small", style: "white-space:nowrap;flex:none" }, icon("trash", 13), t("기록 지우기"));
  if (!ai.hasLog) clear.setAttribute("disabled", "");
  clear.addEventListener("click", () => api.act({ type: "aiClearLog" }));
  const clearRow = h("div", { class: "row ai-clear", style: "padding-top:8px;padding-bottom:8px" }, glyph("trash"),
    h("div", { class: "grow" }, h("div", { class: "sub", style: "margin-top:0;line-height:1.45" }, t("Claude가 한 일의 기록은 이 기기에 30일 동안 남아요."))), clear);
  for (const day of ["today", "yesterday"] as const) {
    const entries = ai.recent.filter((entry) => entry.day === day);
    if (entries.length === 0) continue;
    rows.push(h("div", { class: "ai-day", role: "heading", "aria-level": "3" }, day === "today" ? t("오늘") : t("어제")));
    for (const entry of entries) {
      const end = entry.undone
        ? h("span", { class: "ai-undone" }, t("되돌림"))
        : (() => {
          const undo = h("button", { class: "action small", "aria-label": t("{text} 되돌리기", { text: entry.text }) }, icon("undo", 13), t("되돌리기"));
          undo.addEventListener("click", () => api.act({ type: "aiUndo", id: entry.id }));
          return undo;
        })();
      const note = ai.undoNote?.id === entry.id ? h("div", { class: "sub ai-result", role: "status" }, ai.undoNote.text) : null;
      rows.push(h("div", { class: `row ai-entry${entry.undone ? " undone" : ""}` },
        h("span", { class: "ai-time" }, entry.time), h("div", { class: "grow" }, h("div", { class: "ai-text" }, entry.text), note), end));
    }
  }
  return [
    group(t("AI 연결"), [enabledRow], t("켜면 Claude가 할 일 · 일정 · 메모를 보고 새로 넣어요. 고칠 땐 먼저 물어보고, 지우지는 못해요. 읽은 내용은 대화와 함께 Claude로 가요."), false, "ai"),
    group(t("연결하기"), [desktopRow, codeRow], t("따로 켜 두는 프로그램은 없어요. 연결하면 위 스위치도 켜져요.")),
    group(t("최근 AI 작업"), [...rows, clearRow], t("되돌리기는 그 뒤로 바뀌지 않은 항목만 되돌려요. Claude가 넣거나 고친 줄에는 그날 동안 작은 도장이 찍혀요.")),
  ];
}

function styleTile(style: ReminderStyle): HTMLElement {
  const selected = state.prefs.reminderStyle === style;
  const frame = h("div", { class: "frame" });
  if (style !== "compact") {
    const cat = h("img", { class: "mini-cat", src: "../../assets/cat.png", alt: "" });
    cat.style.width = `${style === "character" ? 30 : 22}px`;
    frame.append(cat);
  }
  frame.append(h("div", { class: "mini-bubble" },
    h("div", { class: "bar" }, h("span", { class: "dot" }), h("span", { class: "stroke", style: "width:36px" })),
    h("div", { class: "bar" }, h("span", { class: "dot" }), h("span", { class: "stroke", style: "width:26px" })),
    h("span", { class: "pill" })));
  const tile = h("button", { class: "tile", role: "radio", "aria-checked": String(selected), title: styleDetails[lang()][style], "aria-label": `${styleTitles[lang()][style]}, ${styleDetails[lang()][style]}` },
    frame, h("span", { class: "name" }, selected ? icon("check", 10, 2.6) : null, styleTitles[lang()][style]));
  tile.addEventListener("click", () => { void set("reminderStyle", style).then(() => api.act({ type: "previewReminder" })); });
  return tile;
}

function notifications(): Node[] {
  const { prefs } = state;
  const enabled = h("div", { class: "row", style: "padding-top:8px;padding-bottom:8px" }, glyph("bellDot"),
    h("div", { class: "grow" }, h("div", {}, t("남은 할 일 알려 주기")), h("div", { class: "sub" }, t("할 일이 남아 있을 때만 종이냥이 한 번에 모아서 알려 줘요."))),
    toggle(prefs.reminderEnabled, t("남은 할 일 알려 주기"), (value) => set("reminderEnabled", value)));

  const interval = h("select", { "aria-label": t("간격") });
  const choices = intervalPresets.includes(prefs.intervalMinutes) ? intervalPresets : [...intervalPresets, prefs.intervalMinutes].sort((a, b) => a - b);
  for (const minutes of choices) {
    const option = h("option", { value: String(minutes) }, intervalTitle(minutes));
    option.selected = minutes === prefs.intervalMinutes;
    interval.append(option);
  }
  interval.addEventListener("change", () => set("intervalMinutes", Number(interval.value)));
  const intervalRow = h("div", { class: `row${prefs.reminderEnabled ? "" : " disabled"}` }, glyph("timer"), h("span", { class: "grow" }, t("간격")), interval);
  const durationRow = h("div", { class: `row${prefs.reminderEnabled ? "" : " disabled"}` }, glyph("hourglass"), h("span", { class: "grow" }, t("화면에 머무는 시간")),
    segmented([10, 15, 25].map((seconds) => ({ value: seconds, title: t("{seconds}초", { seconds }) })), prefs.displaySeconds, (seconds) => set("displaySeconds", seconds), t("표시 시간")));

  // #240 (D1 B): 1시간 쉬기 is a row of 주기 알림 (it rests these reminders now), not a bar under the pane.
  const rest = h("button", { class: "action small" }, t("1시간 쉬기"));
  rest.disabled = !prefs.reminderEnabled;
  rest.addEventListener("click", () => api.act({ type: "snoozePeriodic", minutes: 60 }));
  const restRow = h("div", { class: `row${prefs.reminderEnabled ? "" : " disabled"}`, style: "padding-top:6px;padding-bottom:6px" }, glyph("moon"),
    h("div", { class: "grow" }, h("div", {}, t("잠시 쉬기")), h("div", { class: "sub" }, restDetail())), rest);
  // The preview sits with the styles it shows, plain — no filled button in a settings pane.
  const preview = h("button", { class: "action small" }, icon("play", 11), t("한 번 띄워 보기"));
  preview.addEventListener("click", () => api.act({ type: "previewReminder" }));
  const previewRow = h("div", { class: "row preview-row" }, h("span", { class: "grow sub" }, t("고른 모양으로 한 번 띄워 봐요. 목록은 그대로예요.")), preview);

  // 시스템 알림으로도 보내기: Windows' own notifications too — only what couldn't be shown here, always, or never.
  const systemRow = h("div", { class: "row" }, glyph("bell"), h("span", { class: "grow" }, t("시스템 알림으로도 보내기")),
    segmented([{ value: "missed", title: t("놓친 것만") }, { value: "always", title: t("항상") }, { value: "off", title: t("끄기", undefined, "setting") }] as { value: SystemNotify; title: string }[],
      prefs.systemNotify, (value) => set("systemNotify", value), t("시스템 알림으로도 보내기")));

  // 하루 정리: 저녁 정리 (and its time), 오늘 꼭 하나.
  const sweepRow = h("div", { class: "row", style: "padding-top:8px;padding-bottom:8px" }, glyph("moon"),
    h("div", { class: "grow" }, h("div", {}, t("저녁 정리")), h("div", { class: "sub" }, t("남은 할 일을 내일이나 언젠가로 넘길지 물어봐요."))),
    toggle(prefs.eveningSweep, t("저녁 정리"), (value) => set("eveningSweep", value)));
  const sweepTime = h("select", { "aria-label": t("저녁 정리 시각") });
  for (const time of sweepTimes) {
    const [hour, minute] = time.split(":").map(Number);
    const option = h("option", { value: time }, spokenTime(hour, minute, lang()));
    option.selected = time === prefs.eveningSweepTime;
    sweepTime.append(option);
  }
  sweepTime.addEventListener("change", () => set("eveningSweepTime", sweepTime.value));
  const sweepTimeRow = h("div", { class: `row${prefs.eveningSweep ? "" : " disabled"}` }, glyph("clock"), h("span", { class: "grow" }, t("시각")), sweepTime);
  const pickRow = h("div", { class: "row", style: "padding-top:8px;padding-bottom:8px" }, glyph("star"),
    h("div", { class: "grow" }, h("div", {}, t("오늘 꼭 하나")), h("div", { class: "sub" }, t("새 날 처음 노트를 열면 오늘 꼭 할 하나를 물어보고, 그 일에 별을 달아 맨 위에 둬요."))),
    toggle(prefs.morningPick, t("오늘 꼭 하나"), (value) => set("morningPick", value)));

  return [
    // 할 일별 알림 was a card of words only, like a row one could press (#21): now this group's footnote.
    group(t("알림 모양"), [h("div", { class: "tiles", role: "radiogroup", "aria-label": t("알림 모양") }, ...styles.map(styleTile)), previewRow],
      t("할 일마다 알림은 할 일 줄의 알림 버튼에서 정해요. 같은 때 울릴 알림은 한 번에 모아 보여 줘요.")),
    group(t("주기 알림"), [enabled, intervalRow, durationRow, restRow], statusText()),
    group(t("하루 정리"), [sweepRow, sweepTimeRow, pickRow], t("저녁 정리는 하루 한 번 와요. 그날 저녁을 놓치면 다음 날 처음 노트를 열 때 물어봐요.")),
    group(t("시스템 알림"), [systemRow], t("놓친 것만: 고양이와 노트가 모두 숨어 있거나 화면이 잠겨 있을 때만 Windows 알림으로도 보내요."), false, "alerts"),
  ];
}

function nextLabel(entry: Series): string {
  const next = nextOccurrence(entry.rule, new Date());
  if (!next) return "";
  if (next.getTime() === logicalDayStart(new Date()).getTime()) return t("오늘");
  return t("다음 {day}", { day: shortDate(next, lang()) });
}

function seriesForm(entry: Series | undefined): HTMLElement {
  const title = h("input", { type: "text", class: "title-input", placeholder: t("예: 물 마시기"), "aria-label": t("반복할 일"), spellcheck: "false" });
  title.value = entry?.title ?? "";
  const save = h("button", { class: "action primary" }, icon("repeat", 13), entry ? t("저장") : t("추가"));
  const cancel = h("button", { class: "action" }, t("취소"));
  const fields = repeatFields(entry ? { rule: entry.rule, remindAt: entry.remindAt } : undefined, () => refreshSave());
  const refreshSave = () => { save.disabled = !title.value.trim() || !fields.value(); };
  title.addEventListener("input", refreshSave);
  refreshSave();
  const close = () => { openForm = undefined; render(); };
  cancel.addEventListener("click", close);
  // 2a (A11): the rule's space — its new to-dos go there; applied with 저장 (its open to-dos move with it).
  const was = seriesSpaceOf(state.todoSpaces, entry?.id);
  let picked: string | undefined = was;
  const space = liveSpaces(state.todoSpaces).length ? seriesSpaceField(() => picked, (id) => { picked = id; }) : undefined;
  save.addEventListener("click", () => {
    const value = fields.value();
    if (!value || !title.value.trim()) return;
    const spaceChange = space && picked !== was ? { space: picked ?? null } : {};
    void api.act({ type: "saveSeries", seriesID: entry?.id, title: title.value.trim(), rule: value.rule, remindAt: value.remindAt, ...spaceChange });
    close();
  });
  title.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  setTimeout(() => title.focus(), 0);
  return h("div", { class: "series-form" }, title, fields.element, ...(space ? [space] : []), h("div", { class: "form-actions" }, h("span", { class: "spacer" }), cancel, save));
}

/** The rule editor's 스페이스 field: `● 회사 ⌄`, a menu of the spaces and 일반 (as the to-do editor's field). */
function seriesSpaceField(current: () => string | undefined, pick: (id: string | undefined) => void): HTMLElement {
  const field = h("button", { class: "space-field", type: "button", "aria-haspopup": "menu" });
  const dot = (band: string) => { const element = h("span", { class: "space-dot" }); element.style.setProperty("--band", band); return element; };
  const draw = () => {
    const space = liveSpaces(state.todoSpaces).find((entry) => entry.id === current());
    const name = space?.name ?? generalName(state.todoSpaces, lang());
    field.replaceChildren(h("span", { class: "space-field-name" }, t("스페이스", undefined, "field")), dot(space ? `var(--band-${spaceColor(space.color)})` : "var(--rule-strong)"),
      h("span", { class: "space-field-value" }, name), icon("chevron", 11, 2));
    field.setAttribute("aria-label", t("스페이스: {name}", { name }));
  };
  draw();
  field.addEventListener("click", () => {
    const menuDot = (band: string) => { const element = h("span", { class: "dot" }); element.style.setProperty("--band", band); return element; };
    openMenu(rowMenuHost, [
      ...liveSpaces(state.todoSpaces).map((space) => ({
        kind: "item" as const, label: space.name, extra: [menuDot(`var(--band-${spaceColor(space.color)})`)], checked: current() === space.id, run: () => { pick(space.id); draw(); },
      })),
      { kind: "sep" as const },
      { kind: "item" as const, label: generalName(state.todoSpaces, lang()), extra: [menuDot("var(--rule-strong)")], checked: current() === undefined, run: () => { pick(undefined); draw(); } },
    ], t("스페이스"), field.getBoundingClientRect());
  });
  return field;
}

// #22: the list panes (반복 · 시계 · 스페이스) add and delete the same way, as on the Mac (DeskListRows.swift): `+ 새 …` is
// the card's last row, a row's trash shows only under the pointer (or with the keyboard on it), a row's right-click
// has 고치기 · 지우기, and a delete leaves 지웠어요 · 되돌리기.

/** The list card's last row: + and the words in sage. */
function addRow(label: string, run: () => void): HTMLElement {
  const button = h("button", { class: "row choice list-add" }, icon("plus", 14), h("span", { class: "grow" }, label));
  button.addEventListener("click", run);
  return button;
}

const rowMenuHost: MenuHost = { container: document.body };

/** A row's right-click: 고치기 · 지우기 (the same icons as a to-do's menu). */
function rowMenu(row: HTMLElement, label: string, edit: (() => void) | undefined, remove: () => void): void {
  row.addEventListener("contextmenu", (event) => {
    if ((event.target as HTMLElement).closest("input, textarea")) return;
    event.preventDefault();
    openMenu(rowMenuHost, [
      ...(edit ? [{ kind: "item" as const, label: t("고치기"), icon: "edit", run: edit }, { kind: "sep" as const }] : []),
      { kind: "item", label: t("지우기"), icon: "trash", danger: true, run: remove },
    ], label, { x: event.clientX, y: event.clientY });
  });
}

/** 반복 그만하기: the rule goes (its open copies stay), with 지웠어요 · 되돌리기. */
function deleteSeriesNow(entry: Series): void {
  const todos = state.items.filter((item) => item.seriesID === entry.id && !item.isCompleted).map((item) => item.id);
  void api.act({ type: "deleteSeries", id: entry.id });
  toast.show({ icon: "trash", text: t("반복 할 일을 지웠어요"), action: { label: t("되돌리기"), run: () => void api.act({ type: "restoreSeries", series: entry, todos }) } });
}

/** An alarm gone (the row's menu or the editor's 지우기), with 지웠어요 · 되돌리기. */
function deleteAlarmNow(alarm: Alarm): void {
  if (editingAlarm?.id === alarm.id) editingAlarm = undefined;
  state = { ...state, alarms: state.alarms.filter((entry) => entry.id !== alarm.id) };
  void api.act({ type: "alarmDelete", id: alarm.id });
  render();
  toast.show({ icon: "trash", text: t("알람을 지웠어요"), action: { label: t("되돌리기"), run: () => void api.act({ type: "alarmSave", alarm }) } });
}

function repeats(): Node[] {
  const list = state.series;
  const rows: Node[] = list.length === 0
    ? [h("div", { class: "row", style: "padding-top:12px;padding-bottom:12px" }, h("span", { class: "grow sub", style: "line-height:1.5" },
      t("아직 반복 할 일이 없어요. 할 일의 알림 → 반복에서 만들거나 아래 ‘새 반복 할 일’로 더해 보세요.")))]
    : list.flatMap((entry) => {
      if (openForm === entry.id) return [seriesForm(entry)];
      const editButton = h("button", { class: "quiet", title: t("고치기"), "aria-label": t("{title} 고치기", { title: entry.title }) }, icon("sliders", 14));
      const deleteButton = h("button", { class: "quiet danger", title: t("반복 그만하기 (목록의 할 일은 남아요)"), "aria-label": t("{title} 반복 그만하기", { title: entry.title }) }, icon("trash", 14));
      const edit = () => { openForm = entry.id; render(); };
      editButton.addEventListener("click", edit);
      deleteButton.addEventListener("click", () => deleteSeriesNow(entry));
      const row = h("div", { class: "row series hover-trash" }, glyph("repeat"),
        h("div", { class: "grow" }, h("div", { class: "series-title" }, entry.title), h("div", { class: "sub" }, `${describe(entry.rule, entry.remindAt, lang())} · ${nextLabel(entry)}`)),
        editButton, deleteButton);
      rowMenu(row, entry.title, edit, () => deleteSeriesNow(entry));
      return [row];
    });
  const add = openForm === "new" ? seriesForm(undefined) : addRow(t("새 반복 할 일"), () => { openForm = "new"; render(); });
  return [
    group(t("반복 할 일"), [...rows, add], t("반복하는 날마다 목록에 하나씩 나타나요. 전날 것을 못 끝냈으면 새로 쌓지 않고 오늘로 옮겨요.")),
  ];
}

/**
 * "− 25분 +": the buttons step by `step` (with Shift held, by `bigStep`), and the value can be typed
 * (a number; the unit comes back on leaving the field).
 */
function stepper(title: string, symbol: string, value: number, range: [number, number], step: number, unit: (value: number) => string, onChange: (value: number) => void, bigStep = step): HTMLElement {
  const [min, max] = range;
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const less = h("button", { class: "step", title: t("{title} 줄이기", { title }), "aria-label": t("{title} 줄이기", { title }) }, icon("minus", 11, 2.4));
  const more = h("button", { class: "step", title: t("{title} 늘리기", { title }), "aria-label": t("{title} 늘리기", { title }) }, icon("plus", 11, 2.4));
  less.disabled = value <= min;
  more.disabled = value >= max;
  less.addEventListener("click", (event) => onChange(clamp(value - (event.shiftKey ? bigStep : step))));
  more.addEventListener("click", (event) => onChange(clamp(value + (event.shiftKey ? bigStep : step))));
  const field = h("input", { class: "step-value", type: "text", inputmode: "numeric", spellcheck: "false", "aria-label": title, "data-keep": `step-${symbol}` });
  field.value = unit(value);
  const commit = () => {
    const typed = Number((field.value.match(/\d+/) ?? [""])[0]);
    if (field.value.match(/\d/) && Number.isFinite(typed) && clamp(typed) !== value) onChange(clamp(typed));
    else field.value = unit(value);
  };
  field.addEventListener("focus", () => { field.value = String(value); field.select(); });
  field.addEventListener("blur", commit);
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); field.blur(); }
    else if (event.key === "Escape") { event.preventDefault(); field.value = String(value); field.blur(); }
    else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(clamp(value + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? bigStep : step)));
    }
  });
  return h("div", { class: "row" }, glyph(symbol), h("span", { class: "grow" }, title),
    h("div", { class: "stepper", role: "group", "aria-label": title }, less, field, more));
}

function pet(): Node[] {
  const { prefs } = state;
  const showRow = h("div", { class: "row" }, glyph("cat"), h("span", { class: "grow" }, t("펫 보이기")),
    toggle(prefs.petVisible, t("펫 보이기"), (value) => set("petVisible", value)));
  const wanderRow = h("div", { class: `row${prefs.petVisible ? "" : " disabled"}` }, glyph("footprints"), h("span", { class: "grow" }, t("돌아다니기")),
    toggle(prefs.petWanders, t("돌아다니기"), (value) => set("petWanders", value)));
  // #230: 글자 칠 때 두드리기 — keys typed in the app's windows only (no other app's keys on Windows).
  const typing = segmented([{ value: "off", title: t("끄기", undefined, "setting") }, { value: "app", title: t("종이냥에서만") }] as { value: TypingScope; title: string }[],
    prefs.petTyping, (value) => set("petTyping", value), t("글자 칠 때 두드리기"));
  const typingRow = h("div", { class: `row${prefs.petVisible ? "" : " disabled"}` }, glyph("keyboard"),
    h("div", { class: "grow" }, h("div", {}, t("글자 칠 때 두드리기")), h("div", { class: "sub" }, t("종이냥에서 글자를 치면 앞발로 두드려요. 무엇을 쳤는지는 보지 않아요."))),
    typing);
  // 종이냥 한마디
  const off = prefs.chatter ? "" : " disabled";
  const chatterRow = h("div", { class: "row" }, glyph("chat"), h("span", { class: "grow" }, t("가끔 말 걸기")),
    toggle(prefs.chatter, t("가끔 말 걸기"), (value) => set("chatter", value)));
  const frequency = segmented((["rare", "normal", "often"] as const).map((value) => ({ value, title: chatterFrequencyTitles[lang()][value] })),
    prefs.chatterFrequency, (value) => set("chatterFrequency", value), t("말 거는 횟수"));
  const frequencyRow = h("div", { class: `row${off}`, title: t("가끔 약 1시간 반, 보통 약 45분, 자주 약 20분마다") }, glyph("clock"), h("span", { class: "grow" }, t("얼마나 자주")), frequency);
  const questionRow = h("div", { class: `row${off}` }, glyph("question"), h("span", { class: "grow" }, t("가끔 물어보기")),
    toggle(prefs.chatterQuestions, t("가끔 물어보기"), (value) => set("chatterQuestions", value)));
  const preview = h("button", { class: "action" }, t("들어 보기"));
  preview.disabled = !prefs.petVisible;
  preview.addEventListener("click", () => api.act({ type: "chatterPreview" }));
  const previewRow = h("div", { class: "row" }, glyph("quote"), h("span", { class: "grow" }, t("지금 한마디 듣기")), preview);
  return [
    group(t("종이냥 펫"), [showRow, wanderRow, typingRow],
      t("작업 표시줄 위에 앉아 눈을 깜빡이고, 가끔 걸어 다녀요. 끌어서 옮기고, 우클릭하면 메뉴가 나와요."), false, "pet"),
    group(t("종이냥 한마디"), [chatterRow, frequencyRow, questionRow, previewRow],
      t("가끔 응원하거나 말을 걸어요. 집중할 때와 밤 11시–아침 7시에는 조용해요."), false, "pet"),
  ];
}

// ─── 시계: alarms, then the focus timer ───────────────────────────────────────

const soundTitles = (): Record<AlarmSound, string> => ({ bell: t("종소리"), soft: t("부드럽게"), silent: t("소리 없음") });

function saveAlarm(alarm: Alarm): void {
  const saved = { ...alarm, updatedAt: isoDate(new Date()) };
  state = { ...state, alarms: state.alarms.some((entry) => entry.id === saved.id) ? state.alarms.map((entry) => (entry.id === saved.id ? saved : entry)) : [...state.alarms, saved] };
  void api.act({ type: "alarmSave", alarm: saved });
}

/** Leaves the editor: its changes saved (when there are any). */
function closeAlarmEditor(save = true): void {
  const draft = editingAlarm;
  editingAlarm = undefined;
  if (draft && save) {
    const before = state.alarms.find((entry) => entry.id === draft.id);
    const fields = (alarm: Alarm) => JSON.stringify([alarm.time, alarm.label, alarm.days, alarm.enabled, alarm.sound, alarm.snooze]);
    if (!before || fields(before) !== fields(draft)) saveAlarm(draft);
  }
}

function alarmRow(alarm: Alarm): HTMLElement {
  const now = new Date();
  const next = nextFire(alarm, now);
  const sub = [daysText(alarm.days, lang()), alarm.enabled && next ? untilText(next, now, lang()) : ""].filter(Boolean).join(" · ");
  const open = h("button", { class: "alarm-open grow", "aria-label": t("{time} 알람 고치기", { time: timeText(alarm, lang()) }) },
    h("div", { class: "alarm-time" }, timeText(alarm, lang())),
    alarm.label.trim() ? h("div", { class: "alarm-label" }, alarm.label) : null,
    h("div", { class: "sub" }, sub));
  open.addEventListener("click", () => { closeAlarmEditor(); editingAlarm = { ...alarm, days: [...alarm.days] }; render(); });
  const row = h("div", { class: `row alarm${alarm.enabled ? "" : " off"}` }, open,
    toggle(alarm.enabled, t("{time} 알람 켜기", { time: timeText(alarm, lang()) }), (value) => { saveAlarm({ ...alarm, enabled: value }); render(); }));
  rowMenu(row, timeText(alarm, lang()), () => { closeAlarmEditor(); editingAlarm = { ...alarm, days: [...alarm.days] }; render(); }, () => deleteAlarmNow(alarm));
  return row;
}

function alarmEditor(draft: Alarm): HTMLElement {
  const { hour, minute } = timeParts(draft);
  const two = (value: number) => String(value).padStart(2, "0");
  const preview = h("span", { class: "time-preview" }, timeText(draft, lang()));
  const timeField = (value: number, label: string, key: string) => {
    const field = h("input", { class: "time-field", type: "text", inputmode: "numeric", maxlength: "2", spellcheck: "false", "aria-label": label, "data-keep": key });
    field.value = two(value);
    field.addEventListener("focus", () => field.select());
    return field;
  };
  const hourField = timeField(hour, t("시"), "alarm-hour");
  const minuteField = timeField(minute, t("분"), "alarm-minute");
  const readTime = () => {
    const h24 = Math.min(23, Math.max(0, Number(hourField.value.replace(/\D/g, "")) || 0));
    const m = Math.min(59, Math.max(0, Number(minuteField.value.replace(/\D/g, "")) || 0));
    draft.time = normalTime(`${two(h24)}:${two(m)}`) ?? draft.time;
    preview.textContent = timeText(draft, lang());
  };
  for (const [field, max] of [[hourField, 23], [minuteField, 59]] as const) {
    field.addEventListener("input", readTime);
    field.addEventListener("blur", () => { readTime(); const parts = timeParts(draft); hourField.value = two(parts.hour); minuteField.value = two(parts.minute); });
    field.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const value = (Number(field.value) || 0) + (event.key === "ArrowUp" ? 1 : -1);
      field.value = two((value + max + 1) % (max + 1));
      readTime();
    });
  }
  const timeRow = h("div", { class: "editor-row" }, h("span", { class: "editor-label" }, t("시각")),
    h("div", { class: "time-fields" }, hourField, h("span", { class: "colon" }, ":"), minuteField), preview);

  const label = h("input", { class: "title-input", type: "text", placeholder: t("이름 (선택)"), "aria-label": t("이름 (선택)"), spellcheck: "false", "data-keep": "alarm-label" });
  label.value = draft.label;
  label.addEventListener("input", () => { draft.label = label.value; });

  const days = h("div", { class: "days", role: "group", "aria-label": t("요일") });
  for (const day of weekdayOrder(lang())) {
    const chip = h("button", { class: "day", "aria-pressed": String(draft.days.includes(day)) }, weekdayShort(day, lang()));
    chip.addEventListener("click", () => {
      draft.days = draft.days.includes(day) ? draft.days.filter((entry) => entry !== day) : [...draft.days, day].sort((a, b) => a - b);
      chip.setAttribute("aria-pressed", String(draft.days.includes(day)));
      daysNote.textContent = daysText(draft.days, lang());
    });
    days.append(chip);
  }
  const daysNote = h("span", { class: "days-note" }, daysText(draft.days, lang()));
  const daysRow = h("div", { class: "editor-row" }, h("span", { class: "editor-label" }, t("요일")), daysNote);

  const listen = h("button", { class: "action small listen" }, icon("play", 10), t("들어 보기"));
  listen.disabled = draft.sound === "silent";
  listen.addEventListener("click", () => previewSound(draft.sound));
  const sound = segmented(alarmSounds.map((value) => ({ value, title: soundTitles()[value] })), draft.sound, (value) => {
    draft.sound = value;
    for (const [index, choice] of [...sound.children].entries()) choice.setAttribute("aria-checked", String(alarmSounds[index] === value));
    listen.disabled = value === "silent";
  }, t("소리"));
  const soundRow = h("div", { class: "editor-row" }, h("span", { class: "editor-label" }, t("소리")), sound, listen);

  const snooze = segmented(snoozeSettings.map((value) => ({ value, title: value === 0 ? t("없음") : t("{minutes}분", { minutes: value }) })), draft.snooze, (value) => {
    draft.snooze = value;
    for (const [index, choice] of [...snooze.children].entries()) choice.setAttribute("aria-checked", String(snoozeSettings[index] === value));
  }, t("다시 알림"));
  const snoozeRow = h("div", { class: "editor-row" }, h("span", { class: "editor-label" }, t("다시 알림")), snooze);

  const remove = h("button", { class: "action danger" }, icon("trash", 13), t("지우기"));
  remove.addEventListener("click", () => deleteAlarmNow(state.alarms.find((entry) => entry.id === draft.id) ?? draft));
  const done = h("button", { class: "action primary" }, icon("check", 13, 2.2), t("완료", undefined, "alarm"));
  done.addEventListener("click", () => { readTime(); closeAlarmEditor(); render(); });
  const editor = h("div", { class: "alarm-editor" }, timeRow, label, daysRow, days, soundRow, snoozeRow,
    h("div", { class: "form-actions" }, remove, h("span", { class: "spacer" }), done));
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); closeAlarmEditor(false); render(); }
    else if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") { event.preventDefault(); readTime(); closeAlarmEditor(); render(); }
  });
  return editor;
}

function alarmsGroup(): HTMLElement {
  const alarms = state.alarms;
  const rows: Node[] = alarms.length === 0
    // A sleeping cat beside the words, as on the Mac (#240, 점검 3의 26).
    ? [h("div", { class: "row empty-alarms" }, h("img", { class: "empty-cat", src: "../../assets/pet/256/sleep.png", alt: "", draggable: "false" }),
      h("span", { class: "grow sub" }, t("알람이 없어요. 아침 기상이나 약 먹을 시간을 맞춰 보세요.")))]
    : alarms.map((alarm) => (editingAlarm?.id === alarm.id ? alarmEditor(editingAlarm) : alarmRow(alarm)));
  const add = addRow(t("알람 추가"), () => {
    closeAlarmEditor();
    const alarm = newAlarm();
    saveAlarm(alarm);
    editingAlarm = { ...alarm, days: [...alarm.days] };
    render();
  });
  return group(t("알람", undefined, "group"), [...rows, add],
    t("종이냥이 켜져 있는 기기마다 울려요. 컴퓨터가 잠들어 있었다면 15분 안에 깨어날 때만 울리고, 그보다 늦으면 건너뛰어요."));
}

function clock(): Node[] {
  const { prefs } = state;
  const autoRow = h("div", { class: "row" }, glyph("cycle"), h("span", { class: "grow" }, t("다음 단계 자동으로 시작")),
    toggle(prefs.pomodoroAutoContinue, t("다음 단계 자동으로 시작"), (value) => set("pomodoroAutoContinue", value)));
  const soundRow = h("div", { class: "row" }, glyph("volume"), h("span", { class: "grow" }, t("끝날 때 소리")),
    toggle(prefs.timerSound, t("끝날 때 소리"), (value) => set("timerSound", value)));
  const command = (label: string, primary: boolean, run: TimerCommand) => {
    const button = h("button", { class: `action${primary ? " primary" : ""}` }, ...(primary ? [icon("timer", 13)] : []), label);
    button.addEventListener("click", () => api.act({ type: "timerCommand", command: run }));
    return button;
  };
  const startRow = h("div", { class: "row timer-start" },
    ...[5, 15, 25, 50].map((minutes) => command(t("{minutes}분", { minutes }), false, { kind: "countdown", minutes })),
    h("span", { class: "grow" }), command(t("뽀모도로"), true, { kind: "pomodoro" }));
  // 직접: a length of its own, as in 직접 정하기… (Return starts it).
  const field = h("input", { class: "custom-field", type: "text", placeholder: t("예: 40 또는 1:30"), "aria-label": t("타이머 시간"), spellcheck: "false", "data-keep": "custom-timer" });
  field.value = customTimerText;
  const understood = h("span", { class: "custom-hint" });
  const go = h("button", { class: "action" }, t("시작", undefined, "timer"));
  const refresh = () => {
    customTimerText = field.value;
    const text = field.value.trim();
    const minutes = parseDuration(text, lang());
    understood.textContent = !text ? "" : minutes !== undefined ? durationText(minutes, lang()) : t("1분에서 3시간까지 적어 주세요");
    understood.classList.toggle("invalid", Boolean(text) && minutes === undefined);
    go.disabled = minutes === undefined;
  };
  const start = () => {
    const minutes = parseDuration(field.value, lang());
    if (minutes === undefined) return;
    customTimerText = "";
    void api.act({ type: "timerCommand", command: { kind: "countdown", minutes } });
  };
  field.addEventListener("input", refresh);
  field.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); start(); } });
  go.addEventListener("click", start);
  refresh();
  const customRow = h("div", { class: "row custom-timer" }, h("span", { class: "custom-label" }, t("직접")),
    h("div", { class: "grow custom-box" }, field, understood), go);
  const minutes = (value: number) => t("{minutes}분", { minutes: value });
  return [
    alarmsGroup(),
    group(t("뽀모도로"), [
      stepper(t("집중"), "target", prefs.pomodoroFocusMinutes, [1, maxTimerMinutes], 1, minutes, (value) => set("pomodoroFocusMinutes", value), 5),
      stepper(t("휴식"), "cup", prefs.pomodoroRestMinutes, [1, 60], 1, minutes, (value) => set("pomodoroRestMinutes", value), 5),
      stepper(t("긴 휴식"), "bed", prefs.pomodoroLongRestMinutes, [1, 60], 1, minutes, (value) => set("pomodoroLongRestMinutes", value), 5),
      stepper(t("긴 휴식까지"), "repeat", prefs.pomodoroRounds, [2, 8], 1, (value) => t("{n}번", { n: value }), (value) => set("pomodoroRounds", value)),
      autoRow, soundRow,
    ], t("집중과 휴식을 번갈아 해요. −와 +로 1분씩, Shift와 함께 누르면 5분씩 바뀌어요. 숫자를 눌러 직접 적어도 돼요."), false, "timer"),
    group(t("타이머 크기"), [h("div", { class: "row" }, glyph("timer"), h("span", { class: "grow" }, t("크기")),
      segmented(timerSizes.map((value) => ({ value, title: timerSizeTitles[lang()][value] })), prefs.timerSize, (value) => set("timerSize", value), t("타이머 크기")))],
    t("화면에 뜨는 타이머(팻말을 든 고양이)의 크기예요. 타이머를 우클릭해 ‘크기’에서도 바꿀 수 있어요.")),
    group(t("타이머 시작"), [startRow, customRow]),
  ];
}

/** 일정: the strip above today's tasks and the alerts before an event. */
function calendarSettings(): Node[] {
  const { prefs } = state;
  const stripRow = h("div", { class: "row" }, glyph("calendar"), h("span", { class: "grow" }, t("하루 띠 보이기")),
    toggle(prefs.calendarStrip, t("하루 띠 보이기"), (value) => set("calendarStrip", value)));
  // "5 min before" · "5 min van tevoren" don't fit five across like "5분 전": a list there instead.
  const alertChoice = lang() === "ko"
    ? segmented(calendarAlertChoicesIn(lang()), prefs.calendarAlertMinutes, (value) => set("calendarAlertMinutes", value), t("일정 알림"))
    : (() => {
      const select = h("select", { "aria-label": t("일정 알림") });
      for (const choice of calendarAlertChoicesIn(lang())) {
        const option = h("option", { value: String(choice.value) }, choice.title);
        option.selected = choice.value === prefs.calendarAlertMinutes;
        select.append(option);
      }
      select.addEventListener("change", () => set("calendarAlertMinutes", Number(select.value) as Prefs["calendarAlertMinutes"]));
      return select;
    })();
  const alertRow = h("div", { class: "row calendar-alert" }, glyph("bell"), h("span", { class: "grow" }, t("일정 알림")), alertChoice);
  // #234: 음력과 공휴일 in the desk's 달력 and the widgets (this PC only).
  const lunarRow = h("div", { class: "row" }, glyph("moon"), h("span", { class: "grow" }, t("음력 날짜 보이기")),
    toggle(prefs.calendarLunar, t("음력 날짜 보이기"), (value) => set("calendarLunar", value)));
  const holidayRow = h("div", { class: "row" }, glyph("flag"), h("span", { class: "grow" }, t("공휴일 보이기")),
    toggle(prefs.calendarHolidays, t("공휴일 보이기"), (value) => set("calendarHolidays", value)));
  return [
    group(t("오늘 일정"), [stripRow, alertRow], t("하루 띠는 제목 아래에 지금 하는 일과 다음 일을 보여 줘요. 누르면 하루 일정표가 펼쳐져요."), false, "calendar"),
    group(t("달력"), [lunarRow, holidayRow], t("한국의 공휴일이에요. 선거일처럼 그때 정해지는 쉬는 날은 앱을 업데이트하면 더해져요.")),
    widgetGroup(),
  ];
}

// ─── 바탕화면 위젯 (#234) ──────────────────────────────────────────────────────

/** The widget whose settings slip is open (asked again while a new desk loads: once). */
let widgetSlipFor: string | undefined;

/** 바탕화면 위젯: this PC's widgets, each with 설정… and ×, then + 위젯 더하기 (none until one is added). */
function widgetGroup(): HTMLElement {
  const list = state.prefs.calendarWidgets;
  const rows: HTMLElement[] = list.map((widget, index) => {
    const name = widgetName(widget.kind, widget.style, lang());
    const open = h("button", { class: "action small" }, t("설정…"));
    open.addEventListener("click", () => openWidget(widget.id));
    const remove = h("button", { class: "quiet widget-x", title: t("위젯 제거"), "aria-label": `${t("위젯 제거")}: ${name}` }, icon("close", 12));
    remove.addEventListener("click", () => removeWidget(widget, index));
    return h("div", { class: "row widget-row" }, widgetThumb(widget.kind, widget.style), h("span", { class: "grow two" }, name, h("small", {}, widgetSummary(widget))), open, remove);
  });
  const full = widgetsFull(list.length);
  const add = h("button", { class: "action small" }, icon("plus", 13), t("위젯 더하기"));
  add.toggleAttribute("disabled", full);
  add.addEventListener("click", () => openWidgetGallery({ add: (kind, style) => void api.act({ type: "widgetAdd", kind, style }) }));
  const lead = list.length === 0 ? t("바탕화면에 달력을 두고, 날짜를 눌러 바로 넣어요.") : full ? t("위젯은 4개까지 둘 수 있어요.") : "";
  rows.push(h("div", { class: "row" }, lead ? glyph("calendar") : null, h("span", { class: "grow" }, lead), add));
  return group(t("바탕화면 위젯"), rows, t("위젯은 4개까지 둘 수 있고, 이 PC에만 저장해요. 귀를 누르면 위젯 메뉴가 열리고, 끌면 옮겨요."), false, "widgets");
}

function openWidget(id: string): void {
  const widget = state.prefs.calendarWidgets.find((entry) => entry.id === id);
  if (!widget || widgetSlipFor === id) return;
  widgetSlipFor = id;
  const index = state.prefs.calendarWidgets.indexOf(widget);
  openWidgetSettings({
    widget,
    change: (changes) => void api.act({ type: "widgetChange", id, changes }),
    remove: () => removeWidget(widget, index),
    closed: () => { widgetSlipFor = undefined; },
  });
}

function removeWidget(widget: WidgetSettings, index: number): void {
  void api.act({ type: "widgetRemove", id: widget.id });
  toast.show({ icon: "trash", text: t("위젯을 제거했어요"), action: { label: t("되돌리기"), run: () => void api.act({ type: "widgetRestore", widget, index }) } });
}

// ─── 메모 서랍 (1.28) ──────────────────────────────────────────────────────────

/** 단축키: waiting for a key (the field says so), and what was wrong with the last one pressed. */
let recording = false;
let recordProblem: string | undefined;

window.addEventListener("keydown", (event) => {
  if (!recording) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) { recording = false; recordProblem = undefined; render(); return; }
  const reading = readShortcut(event, []);
  // Ctrl+Alt+M · Ctrl+Alt+N and the note's key (#85: it may have moved) can't be taken.
  if ("accelerator" in reading && takenBy(reading.accelerator, "drawer", { note: state.prefs.noteShortcut, drawer: state.prefs.drawerShortcut })) {
    recordProblem = t("{key} 키는 종이냥이 이미 써요(빠른 메모 · 노트 · 빠른 입력). 다른 키를 눌러 주세요.", { key: shortcutLabel(reading.accelerator) });
    render();
    return;
  }
  if ("accelerator" in reading) {
    recording = false;
    recordProblem = undefined;
    void set("drawerShortcut", reading.accelerator);
    render();
    return;
  }
  if (reading.problem === "waiting") return;
  recordProblem = reading.problem === "modifier" ? t("Ctrl, Alt 또는 Win 키와 함께 눌러 주세요.") : t("이 키는 쓸 수 없어요. 다른 키를 눌러 주세요.");
  render();
}, true);

/** The note's key (#85): waiting for a key, and what was wrong with the last one pressed (said in 빠른 입력's foot). */
let recordingNote = false;
let noteRecordProblem: string | undefined;

window.addEventListener("keydown", (event) => {
  if (!recordingNote) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) { recordingNote = false; noteRecordProblem = undefined; render(); return; }
  const reading = readShortcut(event, []);
  if ("accelerator" in reading) {
    // Ctrl+Alt+N · Ctrl+Alt+M and the drawer's key, chosen or default, can't be taken.
    if (takenBy(reading.accelerator, "note", { note: state.prefs.noteShortcut, drawer: state.prefs.drawerShortcut })) {
      noteRecordProblem = t("{key} 키는 종이냥이 이미 써요(빠른 입력 · 빠른 메모 · 메모 서랍). 다른 키를 눌러 주세요.", { key: shortcutLabel(reading.accelerator) });
      render();
      return;
    }
    recordingNote = false;
    noteRecordProblem = undefined;
    void set("noteShortcut", reading.accelerator);
    if (!state.prefs.noteHotkey) void set("noteHotkey", true);
    render();
    return;
  }
  if (reading.problem === "waiting") return;
  noteRecordProblem = reading.problem === "modifier" ? t("Ctrl, Alt 또는 Win 키와 함께 눌러 주세요.") : t("이 키는 쓸 수 없어요. 다른 키를 눌러 주세요.");
  render();
}, true);

/**
 * 어디서든 노트 보이기 · 숨기기 (#85), as the drawer's key row: the key (click, then press the new one), a small
 * ‘기본값’ link once it isn't Ctrl+Alt+J, and the switch, which keeps the key (on brings it back).
 */
function noteKeyRow(): HTMLElement {
  const { prefs } = state;
  const current = prefs.noteHotkey ? prefs.noteShortcut : "";
  const field = h("button", { class: `keyfield${recordingNote ? " recording" : ""}`, "aria-label": t("노트 보이기 · 숨기기 단축키"), title: t("누르고 원하는 키를 누르면 바뀌어요") },
    recordingNote ? t("키를 눌러 주세요…") : current ? shortcutLabel(current) : t("꺼짐"));
  field.addEventListener("click", () => { recordingNote = !recordingNote; noteRecordProblem = undefined; render(); });
  const reset = current && current !== defaultNoteShortcut && !recordingNote
    ? h("button", { class: "textlink", title: t("{key}로 되돌려요", { key: shortcutLabel(defaultNoteShortcut) }) }, t("기본값"))
    : null;
  reset?.addEventListener("click", () => { recordingNote = false; noteRecordProblem = undefined; void set("noteShortcut", defaultNoteShortcut); });
  const onOff = toggle(prefs.noteHotkey, t("어디서든 노트 보이기 · 숨기기"), (value) => {
    recordingNote = false;
    noteRecordProblem = undefined;
    // On: the key it had, unless the drawer took it meanwhile (then Ctrl+Alt+J).
    if (value && takenBy(prefs.noteShortcut, "note", { note: prefs.noteShortcut, drawer: prefs.drawerShortcut })) void set("noteShortcut", defaultNoteShortcut);
    void set("noteHotkey", value);
  });
  return h("div", { class: "row drawer-key note-key" }, glyph("desk"), h("span", { class: "grow" }, t("어디서든 노트 보이기 · 숨기기")), reset, field, onOff);
}

/**
 * 메모 서랍: the shortcut (the key, a small ‘기본값’ link once it differs, a switch), the handle, 다른 창 위에 띄우기, the
 * side, the width, the paper and the backdrop. Each row's control changes only what its name says (#27); ‘서랍 열기’ is
 * in the pane's header (as on the Mac).
 */
function drawerPane(): Node[] {
  const { prefs } = state;
  const current = prefs.drawerShortcut;
  const field = h("button", { class: `keyfield${recording ? " recording" : ""}`, "aria-label": t("메모 서랍 단축키"), title: t("누르고 원하는 키를 누르면 바뀌어요") },
    recording ? t("키를 눌러 주세요…") : current ? shortcutLabel(current) : t("꺼짐"));
  field.addEventListener("click", () => { recording = !recording; recordProblem = undefined; render(); });
  const reset = current && current !== defaultDrawerShortcut && !recording
    ? h("button", { class: "textlink", title: t("{key}로 되돌려요", { key: shortcutLabel(defaultDrawerShortcut) }) }, t("기본값"))
    : null;
  reset?.addEventListener("click", () => { recording = false; recordProblem = undefined; void set("drawerShortcut", defaultDrawerShortcut); });
  // The switch: off keeps the key it had, so on brings that same key back.
  const onOff = toggle(Boolean(current), t("어디서든 열고 닫기"), (value) => {
    recording = false;
    recordProblem = undefined;
    const last = prefs.drawerShortcutLast && !takenBy(prefs.drawerShortcutLast, "drawer", { note: prefs.noteShortcut, drawer: "" }) ? prefs.drawerShortcutLast : defaultDrawerShortcut;
    if (value) { void set("drawerShortcut", last); return; }
    void set("drawerShortcutLast", current);
    void set("drawerShortcut", "");
  });
  const keyRow = h("div", { class: "row drawer-key" }, glyph("keyboard"), h("span", { class: "grow" }, t("어디서든 열고 닫기")), reset, field, onOff);
  const problem = recordProblem ?? (current ? state.drawerShortcutProblem : undefined);
  const keyFoot = problem ?? (current
    ? t("어디서든 {key} 키를 누르면 서랍이 열리고, 한 번 더 누르면 닫혀요. 다른 앱이 같은 키를 써도 서랍이 먼저 열려요.", { key: shortcutLabel(current) })
    : t("단축키가 꺼져 있어요. 화면 끝 손잡이나 ⋯ 메뉴, 고양이 메뉴로 열 수 있어요."));

  const handleRow = h("div", { class: "row" }, glyph("pawPrint"), h("span", { class: "grow" }, t("화면 끝에 손잡이 두기")),
    toggle(prefs.drawerHandle, t("화면 끝에 손잡이 두기"), (value) => set("drawerHandle", value)));
  const pinRow = h("div", { class: "row" }, glyph("pin"), h("span", { class: "grow" }, t("다른 창 위에 띄우기")),
    toggle(prefs.drawerPinned, t("다른 창 위에 띄우기"), (value) => set("drawerPinned", value)));
  const sideRow = h("div", { class: "row" }, glyph(prefs.drawerSide === "left" ? "dockLeft" : "dockRight"), h("span", { class: "grow" }, t("화면 쪽")),
    segmented([{ value: "left", title: t("왼쪽") }, { value: "right", title: t("오른쪽") }], prefs.drawerSide, (value) => set("drawerSide", value), t("화면 쪽")));
  // 폭: a slider and its number (the drawer's inner edge drags it too, as the tooltip says).
  const width = h("input", { type: "range", class: "width-slider", min: String(drawerWidth.min), max: String(drawerWidth.max), step: "10", value: String(prefs.drawerWidth), "aria-label": t("폭"), title: t("서랍 안쪽 끝을 끌어도 폭이 바뀌어요") });
  const widthValue = h("span", { class: "width-value" }, String(prefs.drawerWidth));
  width.addEventListener("input", () => { widthValue.textContent = width.value; });
  width.addEventListener("change", () => set("drawerWidth", Number(width.value)));
  const widthRow = h("div", { class: "row drawer-width" }, glyph("width"), h("span", { class: "grow" }, t("폭")), width, widthValue);
  // 서랍 종이 (#244): 노트와 같은 종이 (on: the notepad's paper, one line says how to pick another), else the fifteen
  // papers as small drawer pictures (#142) and the drawer's own 밤에는 under them.
  const same = prefs.drawerSameAsNote;
  const own = drawerKindOf(prefs.drawerTheme);
  const sameRow = h("div", { class: "row drawer-same" }, glyph("note"),
    h("div", { class: "grow" }, h("div", {}, t("노트와 같은 종이")), same ? h("div", { class: "sub" }, t("끄면 서랍만 따로 골라요.")) : null),
    toggle(same, t("노트와 같은 종이"), (value) => set("drawerSameAsNote", value)));
  const drawerPaperRows: Node[] = same ? [sameRow]
    : [sameRow, paperTiles(t("서랍 종이"), own, drawerTileFrame, (paper) => set("drawerTheme", paper)), nightRow(prefs.drawerNight, own, (value) => set("drawerNight", value), t("서랍의 밤에는"))];
  // 바탕 (1.29): 불투명 · 반투명 · 투명 · 바탕 없음; where 반투명 · 투명 can't be drawn, the footnote says why.
  const backdrops: { value: DrawerBackdrop; title: string }[] = [
    { value: "solid", title: t("불투명") }, { value: "frost", title: t("반투명") }, { value: "strong", title: t("투명") }, { value: "none", title: t("바탕 없음") },
  ];
  const backdropRow = h("div", { class: "row drawer-backdrop" }, glyph("backdrop"), h("span", { class: "grow" }, t("바탕")),
    popup(backdrops, prefs.drawerBackdrop, (value) => set("drawerBackdrop", value), t("서랍 바탕")));
  // 메모 글꼴 (#141, as on the Mac): a sample memo, then the face (a popup), the size in nine steps (12–20), 줄 간격, 문단 간격.
  const fonts: { value: DrawerFont; title: string; face: string }[] = [
    ...(["clean", "pen", "brush"] as const).map((value) => ({ value, title: fontTitles[lang()][value], face: drawerFace(value) })),
    { value: "mono", title: t("고정폭"), face: drawerFace("mono") },
  ];
  const fontRow = h("div", { class: "row drawer-font" }, glyph("font"), h("span", { class: "grow" }, t("글꼴")),
    popup(fonts, prefs.drawerFont, (value) => set("drawerFont", value), t("메모 글꼴")));
  // 코드 글꼴 (#143): `코드`, code blocks and the 고정폭 face.
  const codeTitles: Record<CodeFont, string> = { system: t("고정폭(시스템)"), d2coding: "D2Coding" };
  const codeRow = h("div", { class: "row drawer-code" }, glyph("code"), h("span", { class: "grow" }, t("코드 글꼴")),
    popup(codeFonts.map((value) => ({ value, title: codeTitles[value], face: codeFamily(value) })), prefs.drawerCodeFont, (value) => set("drawerCodeFont", value), t("코드 글꼴")));
  const points = h("span", { class: "step-value points" });
  const sizeRow = h("div", { class: "row drawer-size" }, glyph("textSize"), h("span", { class: "grow" }, t("글자 크기")),
    stepSlider(drawerPoints.length, drawerPoints.indexOf(prefs.drawerTextPt), (index) => set("drawerTextPt", drawerPoints[index]), t("메모 글자 크기"),
      (index) => t("{size}포인트", { size: drawerPoints[index] }), points, (index) => String(drawerPoints[index])),
    points);
  const lineTitles: Record<LineSpacing, string> = { tight: t("촘촘하게"), regular: t("보통"), loose: t("넉넉하게") };
  const lineRow = h("div", { class: "row drawer-line" }, glyph("lineHeight"), h("span", { class: "grow" }, t("줄 간격")),
    popup(lineSpacings.map((value) => ({ value, title: lineTitles[value] })), prefs.drawerLineHeight, (value) => set("drawerLineHeight", value), t("줄 간격")));
  const paragraphTitles: Record<ParagraphSpacing, string> = { regular: t("보통"), wide: t("넓게"), wider: t("아주 넓게") };
  const paragraphRow = h("div", { class: "row drawer-paragraph" }, glyph("paragraph"), h("span", { class: "grow" }, t("문단 간격")),
    popup(paragraphSpacings.map((value) => ({ value, title: paragraphTitles[value] })), prefs.drawerParagraph, (value) => set("drawerParagraph", value), t("문단 간격")));
  const marksRow = h("div", { class: "row" }, glyph("font"), h("span", { class: "grow" }, t("기호 늘 보이기")),
    toggle(prefs.drawerShowMarks, t("기호 늘 보이기"), (value) => set("drawerShowMarks", value)));
  const doneRow = h("div", { class: "row" }, glyph("checkBox"), h("span", { class: "grow" }, t("끝낸 항목 아래로 보내기")),
    toggle(prefs.drawerDoneToBottom, t("끝낸 항목 아래로 보내기"), (value) => set("drawerDoneToBottom", value)));

  return [
    group(t("단축키"), [keyRow], keyFoot, Boolean(problem)),
    group(t("여는 방법"), [handleRow, pinRow], t("노트 위의 발 버튼, Ctrl+3, ⋯ → 메모 서랍, 고양이 우클릭, 알림 영역 메뉴로도 열려요. 다른 앱을 눌러도 닫히지 않고, 같은 단축키 · Esc를 누르거나 안쪽 가장자리 가운데의 작은 바를 누르면 닫혀요."), false, "drawer"),
    group(t("서랍 종이"), drawerPaperRows,
      t("종이는 이 PC에만 저장돼요. 공유 폴더의 다른 기기는 저마다 고른 종이로 보여요.")),
    group(t("모양"), [sideRow, widthRow, backdropRow, marksRow, doneRow], [
      t("바탕은 서랍 종이를 비쳐 보이게 하거나(반투명 · 투명) 걷어 내요(바탕 없음). 메모지는 늘 불투명해요."),
      t("굵게 · 목록 같은 서식 기호는 커서가 있는 줄에서만 보여요. Ctrl+Shift+R로 늘 보이게 할 수 있어요."),
      state.drawerBackdropNote,
    ].filter(Boolean).join(" ")),
    h("div", { class: "group" }, h("div", { class: "label" }, t("미리보기")), drawerFontPreview(prefs)),
    group(t("메모 글꼴"), [fontRow, codeRow, sizeRow, lineRow, paragraphRow],
      `${t("글꼴과 글자 크기는 서랍의 모든 메모와 카드 미리보기에 같이 써요.")} ${t("코드 글꼴은 ‘코드’ 표시와 코드 묶음, 고정폭 글꼴에 써요. D2Coding은 한글이 영문 두 칸 폭이라 코드 줄의 칸이 맞아요.")}`),
  ];
}

// ─── 스페이스 (1.30) ───────────────────────────────────────────────────────────

/** The colours' names (the swatches' tooltips), as the memo folders say them. */
const colorNames = (): Record<SpaceColor, string> => ({
  lavender: t("라벤더"), pink: t("분홍"), mint: t("민트"), yellow: t("노랑"), sky: t("하늘"), peach: t("살구"), sand: t("모래"), gray: t("회색"),
});
/** + 새 스페이스: the name row open (and what is typed in it). */
let spaceDraft: string | undefined;
/** The space whose eight colours are open under it. */
let colorsOpen: string | undefined;
/** A space's name being typed, or a row being dragged: redraws wait until it is done. */
let spaceBusy = false;
let spaceRedraw = false;
const toastHost = h("div", { class: "toast-host settings-toast" });
const toast = toaster(toastHost);

/** S12: a space deleted (its to-dos to 일반) with 되돌리기 bringing it back with them. */
function deleteSpaceNow(space: TodoSpace): void {
  const todos = [...spaceIndexOf(state.todoSpaces.spaces, state.spaceOf)].filter(([, entry]) => entry.id === space.id).map(([id]) => id);
  void api.act({ type: "spaceDelete", id: space.id });
  toast.show({ icon: "trash", text: t("스페이스 {what} 지웠어요", { what: spaceObjectWords(space.name, lang()) }), action: { label: t("되돌리기"), run: () => void api.act({ type: "spaceRestore", id: space.id, todos }) } });
}

function settleSpaces(): void {
  spaceBusy = false;
  if (spaceRedraw) { spaceRedraw = false; render(); }
}

// ─── 기기마다 보일 스페이스 (#196) ─────────────────────────────────────────────────

/** This PC's 이 기기에서 for a space (`none`: 일반): undefined is 보이기. */
const deviceRuleOf = (key: string): DeviceRule | undefined => readDeviceRules(state.prefs.spaceDevice)[key];
/** What this PC hides now. */
const deviceHiddenNow = (): Set<string> => hiddenSpaces(readDeviceRules(state.prefs.spaceDevice), state.todoSpaces, new Date());

/** Sets 이 기기에서 (the main process keeps it cleaned and notes a space made visible). */
function setDevice(key: string, rule: DeviceRule | undefined): void {
  const rules = readDeviceRules(state.prefs.spaceDevice);
  if (rule) rules[key] = rule;
  else delete rules[key];
  void set("spaceDevice", storedDeviceRules(rules));
}

/**
 * 시간 정하기…: the slip over the desk, starting from the space's times (or 평일 09:00–18:00). #229: the pane goes on
 * working (and drawing) while it is up; closed, it gives the focus back to the space's popup.
 */
function openDeviceTimes(key: string, name: string, back?: HTMLElement): void {
  const rule = deviceRuleOf(key);
  const times = rule?.show === "time" && rule.times.length ? rule.times : devicePresets.workday.times;
  const popup = () => (back?.isConnected ? back : document.querySelector<HTMLElement>(`.space-row[data-id="${CSS.escape(key)}"] .space-device`) ?? undefined);
  openTimesSlip({ key, title: deviceSlipTitle(name, lang()), times, save: (picked) => setDevice(key, { show: "time", times: picked }), closed: () => popup()?.focus() });
}

/**
 * The row's 이 기기에서 popup at the right: its button the state's mark and ▾ (a screen reader hears "회사, 이 기기에서:
 * 숨기기"); Enter · Space · ↓ open 보이기 · 숨기기 · 시간 정하기….
 */
function devicePopup(key: string, name: string): HTMLElement {
  const rule = deviceRuleOf(key);
  const symbol = !rule ? "eye" : rule.show === "hide" ? "eyeOff" : "clock";
  const button = h("button", { class: `space-device ${!rule ? "" : rule.show === "hide" ? "hidden" : "timed"}`.trim(), "aria-haspopup": "menu", "aria-label": devicePopupLabel(name, rule, lang()), title: deviceWords.onThisDevice[lang()] },
    icon(symbol, 15), icon("chevron", 10));
  const open = (keyboard: boolean) => {
    const language = lang();
    openMenu(rowMenuHost, [
      { kind: "item", label: deviceWords.show[language], icon: "eye", checked: !rule, run: () => setDevice(key, undefined) },
      { kind: "item", label: deviceWords.hide[language], icon: "eyeOff", checked: rule?.show === "hide", run: () => setDevice(key, { show: "hide" }) },
      { kind: "sep" },
      { kind: "item", label: deviceWords.setTimes[language], icon: "clock", checked: rule?.show === "time", run: () => openDeviceTimes(key, name, button) },
    ], devicePopupLabel(name, rule, language), button.getBoundingClientRect(), keyboard);
  };
  button.addEventListener("click", (event) => open(event.detail === 0));
  button.addEventListener("keydown", (event) => { if (event.key === "ArrowDown") { event.preventDefault(); open(true); } });
  return button;
}

/** The name and, under it, this PC's 이 기기에서 in words (none for 보이기). */
function deviceNameBox(name: HTMLElement, key: string, hidden: Set<string>): HTMLElement {
  const status = deviceStatusLine(deviceRuleOf(key), hidden.has(key));
  return h("div", { class: `space-name-box${status ? " with-status" : ""}` }, name, status);
}

/** A space's row: the grip, its colour, its name (typed over), how many to-dos are open in it, 지우기. */
function spaceRow(space: TodoSpace, open: number, hidden: Set<string>): HTMLElement[] {
  const grip = h("span", { class: "space-grip", title: t("끌어서 순서 바꾸기"), "aria-hidden": "true" }, icon("more", 14));
  const swatch = h("button", { class: "space-swatch", "aria-label": t("{name} 색", { name: space.name }), "aria-expanded": String(colorsOpen === space.id), title: colorNames()[spaceColor(space.color)] });
  swatch.style.setProperty("--band", `var(--band-${spaceColor(space.color)})`);
  // #196: the mark on the dot (hidden · time rule).
  const mark = deviceMark(deviceRuleOf(space.id));
  if (mark) swatch.append(mark);
  swatch.addEventListener("click", () => { colorsOpen = colorsOpen === space.id ? undefined : space.id; render(); });
  const name = h("input", { class: "space-name", type: "text", value: space.name, maxlength: "40", spellcheck: "false", "aria-label": t("스페이스 이름"), "data-keep": `space-${space.id}` });
  name.addEventListener("focus", () => { spaceBusy = true; });
  name.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); name.blur(); }
    if (event.key === "Escape") { event.preventDefault(); name.value = space.name; name.blur(); }
    // Ctrl+↑ / Ctrl+↓: the space a place up or down (as dragging does).
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && event.ctrlKey) {
      event.preventDefault();
      const ids = liveSpaces(state.todoSpaces).map((entry) => entry.id);
      const at = ids.indexOf(space.id);
      const to = at + (event.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= ids.length) return;
      ids.splice(at, 1);
      ids.splice(to, 0, space.id);
      void api.act({ type: "spaceOrder", ids });
    }
  });
  name.addEventListener("blur", () => {
    if (name.value.trim() && name.value.trim() !== space.name) void api.act({ type: "spaceRename", id: space.id, name: name.value });
    else name.value = space.name;
    settleSpaces();
  });
  const count = h("span", { class: "space-count" }, open ? t("남은 할 일 {n}개", { n: open }) : "");
  const remove = h("button", { class: "quiet space-delete", title: t("지우기"), "aria-label": t("{name} 지우기", { name: space.name }) }, icon("trash", 15));
  remove.addEventListener("click", () => deleteSpaceNow(space));
  const row = h("div", { class: "row space-row", "data-id": space.id }, grip, swatch, deviceNameBox(name, space.id, hidden), count, devicePopup(space.id, space.name), remove);
  grip.addEventListener("pointerdown", (event) => dragSpace(event, row));
  rowMenu(row, space.name, () => { name.focus(); name.select(); }, () => deleteSpaceNow(space));
  if (colorsOpen !== space.id) return [row];
  const colors = h("div", { class: "row space-colors", role: "radiogroup", "aria-label": t("{name} 색", { name: space.name }) },
    ...spaceColors.map((color) => {
      const chip = h("button", { role: "radio", "aria-checked": String(spaceColor(space.color) === color), title: colorNames()[color], "aria-label": colorNames()[color] });
      chip.style.setProperty("--band", `var(--band-${color})`);
      chip.addEventListener("click", () => { colorsOpen = undefined; void api.act({ type: "spaceColor", id: space.id, color }); });
      return chip;
    }));
  return [row, colors];
}

/**
 * 일반 (#89): the first row, fixed — no grip, no colour (its to-dos have no band on 오늘), its name typed over
 * (blank or a default name: back to 일반 · General · Algemeen), its open to-dos; no 지우기, not dragged. Shown once
 * there is a space: before that every to-do is in it, and the name is shown nowhere.
 */
function generalRow(open: number, hidden: Set<string>): HTMLElement {
  const shown = generalName(state.todoSpaces, lang());
  const name = h("input", {
    class: "space-name", type: "text", value: shown, maxlength: "40", spellcheck: "false", placeholder: generalDefaults[lang()],
    "aria-label": t("스페이스 없는 할 일의 이름"), title: t("어느 스페이스에도 넣지 않은 할 일이에요. 이름을 바꿀 수 있어요."), "data-keep": "space-general",
  });
  name.addEventListener("focus", () => { spaceBusy = true; });
  name.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); name.blur(); }
    if (event.key === "Escape") { event.preventDefault(); name.value = shown; name.blur(); }
  });
  name.addEventListener("blur", () => {
    const typed = name.value.trim();
    if (typed !== shown) void api.act({ type: "generalRename", name: typed });
    if (!typed) name.value = generalDefaults[lang()];
    settleSpaces();
  });
  const count = h("span", { class: "space-count" }, open ? t("남은 할 일 {n}개", { n: open }) : "");
  return h("div", { class: "row space-row general" },
    h("span", { class: "space-grip", "aria-hidden": "true" }), h("span", { class: "space-swatch still", "aria-hidden": "true" }, deviceMark(deviceRuleOf(deviceNone))),
    deviceNameBox(name, deviceNone, hidden), count, devicePopup(deviceNone, shown), h("span", { class: "space-delete", "aria-hidden": "true" }));
}

/** Dragging a row by its grip: the rows reorder under the pointer, and the order is kept on letting go. */
function dragSpace(event: PointerEvent, row: HTMLElement): void {
  event.preventDefault();
  const list = row.parentElement!;
  spaceBusy = true;
  colorsOpen = undefined;
  list.querySelectorAll(".space-colors").forEach((element) => element.remove());
  row.classList.add("dragging");
  row.setPointerCapture(event.pointerId);
  const move = (moveEvent: PointerEvent) => {
    const rows = [...list.querySelectorAll<HTMLElement>(".space-row[data-id]")].filter((entry) => entry !== row);
    const after = rows.find((entry) => { const box = entry.getBoundingClientRect(); return moveEvent.clientY < box.top + box.height / 2; });
    if (after) list.insertBefore(row, after); else rows.at(-1)?.after(row);
  };
  const up = () => {
    row.removeEventListener("pointermove", move);
    row.classList.remove("dragging");
    const ids = [...list.querySelectorAll<HTMLElement>(".space-row[data-id]")].map((entry) => entry.dataset.id!);
    if (ids.join() !== liveSpaces(state.todoSpaces).map((entry) => entry.id).join()) void api.act({ type: "spaceOrder", ids });
    settleSpaces();
  };
  row.addEventListener("pointermove", move);
  row.addEventListener("pointerup", up, { once: true });
  row.addEventListener("pointercancel", up, { once: true });
}

/** 책상 → 스페이스: the spaces in order (drag, name, colour, 지우기) and + 새 스페이스. */
function spacesPane(): Node[] {
  const spaces = liveSpaces(state.todoSpaces);
  const index = spaceIndexOf(state.todoSpaces.spaces, state.spaceOf);
  const open = new Map<string, number>();
  let openGeneral = 0;
  for (const item of state.items) {
    if (item.isCompleted) continue;
    const space = index.get(item.id);
    if (space) open.set(space.id, (open.get(space.id) ?? 0) + 1);
    else openGeneral += 1;
  }
  // 일반 first and fixed (#89); the spaces' rows are the only ones dragged.
  const hidden = deviceHiddenNow();
  const rows = [...(spaces.length ? [generalRow(openGeneral, hidden)] : []), ...spaces.flatMap((space) => spaceRow(space, open.get(space.id) ?? 0, hidden))];
  let lastRow: HTMLElement;
  if (spaceDraft !== undefined) {
    const color = nextSpaceColor(state.todoSpaces);
    const field = h("input", { class: "space-name", type: "text", value: spaceDraft, maxlength: "40", spellcheck: "false", placeholder: t("이름"), "aria-label": t("새 스페이스 이름"), "data-keep": "space-new" });
    const dot = h("span", { class: "space-swatch still", "aria-hidden": "true" });
    dot.style.setProperty("--band", `var(--band-${color})`);
    const make = () => {
      const name = field.value.trim();
      spaceDraft = undefined;
      if (name) void api.act({ type: "spaceAdd", id: newSpaceID(state.todoSpaces), name, color });
      settleSpaces();
      render();
    };
    field.addEventListener("focus", () => { spaceBusy = true; });
    field.addEventListener("input", () => { spaceDraft = field.value; });
    field.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") { event.preventDefault(); make(); }
      if (event.key === "Escape") { event.preventDefault(); spaceDraft = undefined; settleSpaces(); render(); }
    });
    field.addEventListener("blur", () => { if (spaceDraft !== undefined) make(); });
    lastRow = h("div", { class: "row space-row new" }, h("span", { class: "space-grip" }), dot, field);
    requestAnimationFrame(() => field.focus());
  } else {
    lastRow = addRow(t("새 스페이스"), () => { spaceDraft = ""; render(); });
  }
  return [
    // #53: the pane's header says what spaces are for; the footnote only what comes after (as on the Mac).
    group(t("스페이스"), [...rows, lastRow],
      [t("머리말에서 한 스페이스만 볼 수 있어요. 입력 줄에 {tag}을 붙이면 그 스페이스로 들어가요.", { tag: `#${t("이름").toLowerCase()}` }),
        ...(spaces.length ? [deviceDeskFooter(lang(), lang() === "nl" ? "pc" : "PC")] : [])].join(" "), false, "spaces"),
    // 2b: 스페이스별로 묶기 and its look (메모지 · 책갈피), only once there is a space to group by.
    ...(spaces.length ? [group(t("스페이스별로 묶기"), [
      h("div", { class: "row" }, glyph("spaces"), h("span", { class: "grow" }, t("스페이스별로 묶기")), rowKeys(["Ctrl", "Shift", "G"]),
        toggle(state.prefs.spaceGroups, t("스페이스별로 묶기"), (value) => set("spaceGroups", value))),
      h("div", { class: "row" }, glyph("sliders"), h("span", { class: "grow" }, t("모양")),
        segmented<SpaceGroupStyle>([{ value: "card", title: t("메모지") }, { value: "bookmark", title: t("책갈피") }], state.prefs.spaceGroupStyle, (value) => set("spaceGroupStyle", value), t("묶음 모양"))),
    ], t("오늘 탭의 할 일을 스페이스마다 모아 보여요. 이 PC에만 적용돼요."))] : []),
    // The keys as every other row: its name, the key caps on the right.
    group(t("단축키"), [
      h("div", { class: "row" }, glyph("keyboard"), h("div", { class: "grow" }, h("div", {}, t("한 스페이스만 보기")), h("div", { class: "sub" }, t("노트에서 스페이스 순서대로 골라요."))), rowKeys(["Ctrl", "Shift", "1–9"])),
      h("div", { class: "row" }, glyph("spaces"), h("span", { class: "grow" }, t("모두 보기")), rowKeys(["Ctrl", "Shift", "0"])),
    ], t("다음 날 아침 4시에 모든 스페이스로 돌아와요. 알림과 오늘 탭의 숫자는 숨긴 할 일도 그대로 셈해요.")),
  ];
}

// ─── Render ───────────────────────────────────────────────────────────────────

const app = document.getElementById("app")!;

function render(): void {
  const { prefs } = state;
  document.documentElement.dataset.font = prefs.font;
  document.documentElement.dataset.pane = tab;
  document.documentElement.style.setProperty("--body-size", `${bodyFontSize(prefs.font, prefs.textStep)}px`);
  const scrollTop = app.querySelector(".content")?.scrollTop ?? 0;
  const pages: Record<Tab, () => Node[]> = { appearance, notifications, repeat: repeats, pet, clock, events: calendarSettings, storage: storagePane, drawer: drawerPane, spaces: spacesPane, ai: aiPane };
  const content = h("div", { class: "content" }, ...pages[tab]());
  const parts: Node[] = [paneHead(), content, toastHost];
  // A field being typed in (a stepper, 직접, the alarm's fields) keeps the focus across the redraw.
  const active = document.activeElement as HTMLInputElement | null;
  const keep = active?.dataset?.keep;
  const selection = keep && active ? [active.selectionStart, active.selectionEnd] as const : undefined;
  app.replaceChildren(...parts);
  content.scrollTop = scrollTop;
  // A soft edge under the pane's header (and above the bottom) while there is more to scroll.
  edgeFade(content);
  if (focusPaperTile && (tab === "drawer" || tab === "appearance")) {
    focusPaperTile = false;
    app.querySelector<HTMLElement>(`.paper-tile[aria-checked="true"]`)?.focus();
  }
  if (keep) {
    const again = app.querySelector<HTMLInputElement>(`[data-keep="${keep}"]`);
    again?.focus();
    if (again && selection && selection[0] !== null) again.setSelectionRange(selection[0], selection[1]);
  }
}

/** Another pane of the desk chosen: a settings pane draws itself (the others belong to other pages). */
function showTab(next: Tab): void {
  if (next === tab && state) return;
  tab = next;
  openForm = undefined;
  recording = false;
  recordProblem = undefined;
  recordingNote = false;
  noteRecordProblem = undefined;
  spaceDraft = undefined;
  colorsOpen = undefined;
  spaceBusy = false;
  closeAlarmEditor();
  if (state) { render(); app.querySelector(".content")!.scrollTop = 0; }
}

api.on("state", (next) => {
  state = next as TodosState;
  // Don't wipe a half-filled form or an alarm being edited; redraw once it closes. (A space's name being typed, too.)
  if (openForm || editingAlarm) return;
  if (spaceBusy && tab === "spaces") { spaceRedraw = true; return; }
  render();
});
// #244: the paper shown changed (a setting, or Windows turning dark): the drawer's sample follows it.
api.onPaper(() => { if (state && tab === "drawer" && !openForm && !editingAlarm) render(); });
api.on("desk:pane", (payload) => {
  const pane = readPane((payload as { pane?: unknown })?.pane);
  if (pane && isSettingsTab(pane)) showTab(pane);
  // 위젯의 메뉴 → 설정…: that widget's settings slip.
  const widget = (payload as { widget?: unknown })?.widget;
  if (typeof widget === "string" && state) openWidget(widget);
});
// 시계: the next-ring times move on with the clock.
window.setInterval(() => { if (state && tab === "clock" && !openForm && !editingAlarm) render(); }, 30_000);
/** Snapshots: an alarm opened for editing, as a click would. */
(window as unknown as { editAlarm?: (index: number) => void }).editAlarm = (index: number) => {
  const alarm = state.alarms[index];
  if (!alarm) return;
  editingAlarm = { ...alarm, days: [...alarm.days] };
  render();
};
void api.getState().then((initial) => { state = initial; render(); });

// #230: keys typed here make the desktop cat tap along (only that a key went down).
listenForTyping();
