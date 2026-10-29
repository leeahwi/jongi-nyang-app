import {
  bodyFontSize, calendarAlertChoicesIn, fontTitles, styleDetails, styleTitles, textSizeTitles, textSizes,
  type AppState, type NotebookFont, type Prefs, type ReminderStyle, type SystemNotify,
} from "../core/types";
import { archiveChoicesIn, logicalDayStart } from "../core/archive";
import type { TimerCommand } from "../core/focusTimer";
import { nativeName, shortDate, spokenTime, weekdayOrder, weekdayShort, type LanguageSetting } from "../core/lang";
import { alarmSounds, daysText, newAlarm, nextFire, normalTime, snoozeSettings, timeParts, timeText, untilText, type Alarm, type AlarmSound } from "../core/alarm";
import { durationText, maxTimerMinutes, parseDuration } from "../core/duration";
import { isoDate } from "../core/notebook";
import { previewSound } from "./alarmSound";
import { describe, nextOccurrence, type Series } from "../core/repeat";
import { pageOf } from "../core/shelf";
import { repeatFields } from "./repeatFields";
import { edgeFade, h, icon, lang, paper, t, wrapText } from "./api";
import { isSettingsTab, readPane, type PaperSetting, type SettingsTab } from "../core/desk";
import { paneTitle } from "./deskPanes";
import { chatterFrequencyTitles } from "../core/chatter";
import { timerSizes, timerSizeTitles } from "../core/timerWidget";
import { sweepTimes } from "../core/sweep";
import { defaultDrawerShortcut, drawerWidth, readShortcut, shortcutLabel, type DrawerBackdrop, type DrawerTheme } from "../core/memoDrawer";
import { liveSpaces, newSpaceID, nextSpaceColor, spaceColor, spaceColors, spaceIndexOf, spaceObjectWords, type SpaceColor, type TodoSpace } from "../core/todoSpaces";
import { toaster } from "./slip";
import { openMenu, type MenuHost } from "./drawerMenu";
import { folderPlace, placeSeparator, placeText } from "../core/storage";

const api = paper();
let state: AppState;
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
  appearance: t("언어와 종이 색, 글꼴과 글자 크기를 정해요."),
  notifications: t("주기 알림과 알림 모양을 정하고, 미리보기로 확인해요."),
  repeat: t("반복하는 날마다 목록에 한 줄씩 놓여요."),
  pet: t("종이냥을 보이거나 숨기고, 돌아다닐지, 말을 걸지 정해요."),
  clock: t("알람을 맞추고, 뽀모도로 시간과 소리를 정하고 바로 시작해요."),
  events: t("일정을 적어 두면 오늘 할 일 위에 보이고, 시작 전에 알려 줘요."),
  storage: t("할 일과 기록이 저장되는 곳, 다른 컴퓨터로 옮기는 백업이에요."),
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

/** A row's line icon on a small sage square. */
function glyph(name: string): HTMLElement {
  return h("span", { class: "glyph", "aria-hidden": "true" }, icon(name, 16, 1.7));
}

/** The pane's header: its name and what it is for (꾸미기 keeps one small cat). */
function paneHead(): HTMLElement {
  // 메모 서랍: 서랍 열기 in the header, not in a row about something else (#27).
  const open = tab === "drawer" ? h("button", { class: "action primary ph-action" }, icon("pawPrint", 13), t("서랍 열기")) : null;
  open?.addEventListener("click", () => api.act({ type: "drawer", command: "open" }));
  return h("header", { class: "pane-head" },
    h("div", { class: "ph-text" }, h("h1", {}, paneTitle(tab)), h("p", { class: "ph-sub" }, subtitles[tab])),
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
  if (nextPeriodicDue) {
    const at = new Date(nextPeriodicDue);
    return t("다음 알림 {time} · 노트를 쓰는 동안은 잠시 기다려요.", { time: spokenTime(at.getHours(), at.getMinutes(), lang()) });
  }
  return t("알림 시간을 준비하고 있어요.");
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

  const fontRows = fonts.map((font) => {
    const row = h("button", { class: "row choice", role: "radio", "aria-checked": String(prefs.font === font) },
      h("span", { class: "radio" }), h("span", { class: "grow" }, fontTitles[lang()][font]), h("span", { class: "sample" }, t("오늘 할 일")));
    row.style.setProperty("--sample-font", font === "pen" ? "var(--pen-font)" : font === "brush" ? "var(--brush-font)" : "var(--ui)");
    row.style.setProperty("--sample-size", `${bodyFontSize(font, "regular")}px`);
    row.addEventListener("click", () => set("font", font));
    return row;
  });

  const sizeRow = h("div", { class: "row" },
    h("span", { style: "font-size:11px;color:var(--secondary)" }, t("가")),
    segmented(textSizes.map((size) => ({ value: size, title: textSizeTitles[lang()][size] })), prefs.textSize, (size) => set("textSize", size), t("글자 크기")),
    h("span", { style: "font-size:17px;color:var(--secondary)" }, t("가")));
  sizeRow.children[1].classList.add("wide");

  const startRow = h("div", { class: "row" }, glyph("power"), h("span", { class: "grow" }, t("컴퓨터를 켤 때 같이 열기")),
    toggle(prefs.openAtLogin, t("Windows 시작 시 실행"), (value) => set("openAtLogin", value)));
  // 작업 표시줄에 남은 개수: the taskbar button's small number (Windows).
  const badgeRow = h("div", { class: "row" }, glyph("bellDot"), h("span", { class: "grow" }, t("작업 표시줄에 남은 개수")),
    toggle(prefs.taskbarBadge, t("작업 표시줄에 남은 개수"), (value) => set("taskbarBadge", value)));

  const quickRow = h("div", { class: "row" }, glyph("keyboard"), h("span", { class: "grow" }, t("어디서든 빠른 입력 (Ctrl+Alt+N)")),
    toggle(prefs.quickEntry, t("어디서든 빠른 입력"), (value) => set("quickEntry", value)));
  const memoRow = h("div", { class: "row" }, glyph("note"), h("span", { class: "grow" }, t("어디서든 빠른 메모 (Ctrl+Alt+M)")),
    toggle(prefs.quickMemo, t("어디서든 빠른 메모"), (value) => set("quickMemo", value)));
  const noteRow = h("div", { class: "row" }, glyph("desk"), h("span", { class: "grow" }, t("어디서든 노트 보이기 · 숨기기 (Ctrl+Alt+J)")),
    toggle(prefs.noteHotkey, t("어디서든 노트 보이기 · 숨기기"), (value) => set("noteHotkey", value)));
  // 빠른 메모를 열 때 복사한 글 넣기: the text copied since it last opened, ready (and selected) in the empty memo.
  const clipRow = h("div", { class: "row" }, glyph("share"),
    h("div", { class: "grow" }, h("div", {}, t("빠른 메모를 열 때 복사한 글 넣기")), h("div", { class: "sub" }, t("빈 메모를 열면 방금 복사한 글이 골라진 채로 들어가요."))),
    toggle(prefs.quickMemoClipboard, t("빠른 메모를 열 때 복사한 글 넣기"), (value) => set("quickMemoClipboard", value)));
  // Another app holding a shortcut is said in the foot, in the accent colour.
  const shortcutProblems = [prefs.quickEntry ? state.shortcutProblem : undefined, prefs.quickMemo ? state.memoShortcutProblem : undefined, prefs.noteHotkey ? state.noteShortcutProblem : undefined].filter(Boolean) as string[];
  const quickFoot = shortcutProblems.length > 0
    ? shortcutProblems.join(" ")
    : `${t("어떤 앱을 쓰다가도 Ctrl+Alt+N을 누르면 작은 종이가 떠요. 적은 말에 맞춰 알림 · 마감 · 일정을 정해요.")} ${t("Ctrl+Alt+M은 몇 줄을 바로 메모 서랍에 넣는 빠른 메모예요.")} ${t("Ctrl+Alt+J는 노트를 불러오거나 넣어 둬요.")}`;

  // 언어: 자동 (the system's) or one of the three, each named in its own language; changing it restarts the app.
  const languages: { value: LanguageSetting; title: string }[] = [{ value: "auto", title: t("자동") }, ...(["ko", "en", "nl"] as const).map((value) => ({ value, title: nativeName[value] }))];
  const languageRow = h("div", { class: "row language" }, glyph("globe"), h("span", { class: "grow" }, t("앱 언어")),
    segmented(languages, prefs.language, (value) => set("language", value), t("언어")));
  // 종이 색: 자동 follows Windows' light or dark mode; 낮 and 밤 keep one.
  const papers: { value: PaperSetting; title: string }[] = [{ value: "auto", title: t("자동") }, { value: "day", title: t("낮") }, { value: "night", title: t("밤") }];
  // The icon follows the choice: half and half for 자동, a sun for 낮, a moon for 밤 (as on the Mac).
  const paperRow = h("div", { class: "row paper" }, glyph(prefs.paper === "day" ? "sun" : prefs.paper === "night" ? "moon" : "contrast"), h("span", { class: "grow" }, t("종이 색")),
    segmented(papers, prefs.paper, (value) => set("paper", value), t("종이 색")));
  // The due-style samples: a row's badge for a deadline three days off, as each style writes it (core label()).
  const [ddaySample, dateSample] = { ko: ["D-3", "~금"], en: ["3 days left", "by Fri"], nl: ["nog 3 dagen", "tot vr"] }[lang()]; // i18n-ok

  return [
    group(t("언어"), [languageRow]),
    group(t("종이"), [paperRow], t("자동은 Windows의 밝게 · 어둡게 모드를 따라가요. 밤 종이는 불 끈 방의 종이 색이에요.")),
    // The sample sheet, named like every other group (#21).
    h("div", { class: "group" }, h("div", { class: "label" }, t("미리보기")), preview),
    group(t("글꼴"), fontRows),
    group(t("글자 크기"), [sizeRow], t("Ctrl + = 와 Ctrl + − 로도 바꿀 수 있어요.")),
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
  const openArchive = h("button", { class: "action small", title: t("탐색기에서 완료 기록 폴더 열기") }, t("열기"));
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
function storagePane(): Node[] {
  const { storage } = state;
  const choose = h("button", { class: "action small", title: t("폴더를 고르면 종이냥이 다시 시작돼요") }, icon("folder", 13), t("다른 폴더…"));
  choose.addEventListener("click", () => api.act({ type: "chooseStorage" }));
  const reset = h("button", { class: "action small", title: t("이 PC의 기본 위치로 돌아가요") }, t("기본으로"));
  reset.disabled = !storage.custom;
  reset.addEventListener("click", () => api.act({ type: "resetStorage" }));
  const whereRow = h("div", { class: "row storage" }, glyph("folder"),
    h("div", { class: "grow" }, h("div", { class: "where" }, h("span", {}, t("저장 폴더")), h("span", { class: "kind" }, storage.custom ? t("공유 폴더") : t("이 PC (기본)"))),
      folderPlaceLine(storage.path)));
  const openFolder = h("button", { class: "action small", title: t("탐색기에서 저장 폴더 열기") }, icon("arrow", 13), t("폴더 열기"));
  openFolder.addEventListener("click", () => api.act({ type: "openDataFolder" }));
  const actionsRow = h("div", { class: "row storage-actions" }, openFolder, h("span", { class: "grow" }), reset, choose);

  // 백업 · 옮기기: everything in the storage folder to one .jongi file, and back.
  const exportButton = h("button", { class: "action small", title: t("할 일 · 메모 · 반복 · 일정 · 완료 기록을 .jongi 파일 하나로") }, icon("arrowUp", 13), t("내보내기…"));
  exportButton.addEventListener("click", () => api.act({ type: "exportBackup" }));
  const importButton = h("button", { class: "action small", title: t("내보낸 .jongi 파일을 합치거나 바꿔 넣기") }, icon("arrowDown", 13), t("가져오기…"));
  importButton.addEventListener("click", () => api.act({ type: "importBackup" }));
  const backupRow = h("div", { class: "row storage-actions" }, glyph("share"), h("span", { class: "grow" }, t("백업 파일")), exportButton, importButton);

  return [
    group(t("저장 위치"), [whereRow, actionsRow], t("할 일 · 메모 · 일정 · 기록이 모두 이 폴더에 있어요. OneDrive 같은 공유 폴더를 고르면 다른 기기와 같은 목록을 써요."), false, "data"),
    completedGroup(),
    group(t("백업 · 옮기기"), [backupRow],
      t("내보낸 백업 파일(.jongi)을 다른 컴퓨터의 종이냥에서 가져오면 모두 그대로 옮겨져요. Mac ↔ Windows도 돼요."), false, "backup"),
  ];
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
    h("div", { class: "grow" }, h("div", {}, t("Claude 데스크톱")), h("div", { class: "sub" }, t("누르면 Claude가 ‘종이냥 for Claude’를 설치할지 물어봐요."))), desktop);
  const copy = h("button", { class: "action small" }, ai.copied ? icon("check", 13) : icon("keyboard", 13), ai.copied ? t("복사했어요") : t("Claude Code 명령 복사"));
  copy.addEventListener("click", () => api.act({ type: "aiCopyCommand" }));
  const codeRow = h("div", { class: "row ai-connect" }, glyph("keyboard"),
    h("div", { class: "grow" }, h("div", {}, "Claude Code"), h("div", { class: "sub" }, t("복사한 명령을 터미널에 붙여 넣어요. Node.js는 없어도 돼요."))), copy);

  const rows: Node[] = [];
  if (ai.recent.length === 0) rows.push(h("div", { class: "row ai-empty" }, t("아직 없어요")));
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
    group(t("최근 AI 작업"), rows, t("되돌리기는 그 뒤로 바뀌지 않은 항목만 되돌려요. Claude가 넣거나 고친 줄에는 그날 동안 작은 도장이 찍혀요.")),
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
    h("div", { class: "grow" }, h("div", {}, t("남은 할 일 알려주기")), h("div", { class: "sub" }, t("할 일이 남아 있을 때만 종이냥이 한 번에 모아서 알려 줘요."))),
    toggle(prefs.reminderEnabled, t("남은 할 일 알려주기"), (value) => set("reminderEnabled", value)));

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
    group(t("알림 모양"), [h("div", { class: "tiles", role: "radiogroup", "aria-label": t("알림 모양") }, ...styles.map(styleTile))],
      t("할 일마다 알림은 할 일 줄의 알림 버튼에서 정해요. 같은 때 울릴 알림은 한 번에 모아 보여 줘요.")),
    group(t("주기 알림"), [enabled, intervalRow, durationRow], statusText()),
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
  save.addEventListener("click", () => {
    const value = fields.value();
    if (!value || !title.value.trim()) return;
    void api.act({ type: "saveSeries", seriesID: entry?.id, title: title.value.trim(), rule: value.rule, remindAt: value.remindAt });
    close();
  });
  title.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  setTimeout(() => title.focus(), 0);
  return h("div", { class: "series-form" }, title, fields.element, h("div", { class: "form-actions" }, h("span", { class: "spacer" }), cancel, save));
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
    group(t("종이냥 펫"), [showRow, wanderRow],
      t("작업 표시줄 위에 앉아 눈을 깜빡이고, 가끔 걸어 다녀요. 끌어서 옮기고, 우클릭하면 메뉴가 나와요.")),
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
    ? [h("div", { class: "row empty-alarms" }, h("span", { class: "grow sub" }, t("알람이 없어요. 아침 기상이나 약 먹을 시간을 맞춰 보세요.")))]
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
    ], t("집중과 휴식을 번갈아 해요. 시간은 −·+로 1분씩(Shift를 누르면 5분씩) 바꾸거나 눌러서 직접 적어요."), false, "timer"),
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
  return [group(t("오늘 일정"), [stripRow, alertRow], t("하루 띠는 제목 아래에 지금 하는 일과 다음 일을 보여 줘요. 누르면 하루 일정표가 펼쳐져요."), false, "calendar")];
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
  const reading = readShortcut(event);
  if ("accelerator" in reading) {
    recording = false;
    recordProblem = undefined;
    void set("drawerShortcut", reading.accelerator);
    render();
    return;
  }
  if (reading.problem === "waiting") return;
  recordProblem = reading.problem === "reserved" ? t("Ctrl+Alt+M · Ctrl+Alt+J · Ctrl+Alt+N은 종이냥이 이미 써요. 다른 키를 눌러 주세요.")
    : reading.problem === "modifier" ? t("Ctrl, Alt 또는 Win 키와 함께 눌러 주세요.") : t("이 키는 쓸 수 없어요. 다른 키를 눌러 주세요.");
  render();
}, true);

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
    if (value) { void set("drawerShortcut", prefs.drawerShortcutLast || defaultDrawerShortcut); return; }
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
  const themes: { value: DrawerTheme; title: string }[] = [
    { value: "auto", title: t("자동") }, { value: "day", title: t("낮 종이") }, { value: "night", title: t("밤 종이") }, { value: "kraft", title: t("크라프트지") }, { value: "grid", title: t("모눈 노트") },
  ];
  const themeRow = h("div", { class: "row drawer-theme" }, glyph("palette"), h("span", { class: "grow" }, t("종이")),
    segmented(themes, prefs.drawerTheme, (value) => set("drawerTheme", value), t("서랍 종이")));
  // 바탕 (1.29): 불투명 · 반투명 · 강하게 · 바탕 없음; where 반투명 · 강하게 can't be drawn, the footnote says why.
  const backdrops: { value: DrawerBackdrop; title: string }[] = [
    { value: "solid", title: t("불투명") }, { value: "frost", title: t("반투명") }, { value: "strong", title: t("강하게") }, { value: "none", title: t("바탕 없음") },
  ];
  const backdropRow = h("div", { class: "row drawer-backdrop" }, glyph("backdrop"), h("span", { class: "grow" }, t("바탕")),
    segmented(backdrops, prefs.drawerBackdrop, (value) => set("drawerBackdrop", value), t("서랍 바탕")));

  return [
    group(t("단축키"), [keyRow], keyFoot, Boolean(problem)),
    group(t("여는 방법"), [handleRow, pinRow], t("노트 위의 발 버튼, Ctrl+3, ⋯ → 메모 서랍, 고양이 우클릭, 알림 영역 메뉴로도 열려요. 다른 앱을 눌러도 닫히지 않고, 같은 단축키 · Esc · ×로 닫혀요."), false, "drawer"),
    group(t("모양"), [sideRow, widthRow, themeRow, backdropRow], [
      t("자동 종이는 노트의 낮 · 밤을 따라요. 바탕은 서랍 종이를 비쳐 보이게 하거나(반투명 · 강하게) 걷어 내요(바탕 없음). 메모지는 늘 불투명해요."),
      state.drawerBackdropNote,
    ].filter(Boolean).join(" ")),
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

/** S12: a space deleted (its to-dos to 스페이스 없음) with 되돌리기 bringing it back with them. */
function deleteSpaceNow(space: TodoSpace): void {
  const todos = [...spaceIndexOf(state.todoSpaces.spaces, state.spaceOf)].filter(([, entry]) => entry.id === space.id).map(([id]) => id);
  void api.act({ type: "spaceDelete", id: space.id });
  toast.show({ icon: "trash", text: t("스페이스 {what} 지웠어요", { what: spaceObjectWords(space.name, lang()) }), action: { label: t("되돌리기"), run: () => void api.act({ type: "spaceRestore", id: space.id, todos }) } });
}

function settleSpaces(): void {
  spaceBusy = false;
  if (spaceRedraw) { spaceRedraw = false; render(); }
}

/** A space's row: the grip, its colour, its name (typed over), how many to-dos are open in it, 지우기. */
function spaceRow(space: TodoSpace, open: number): HTMLElement[] {
  const grip = h("span", { class: "space-grip", title: t("끌어서 순서 바꾸기"), "aria-hidden": "true" }, icon("more", 14));
  const swatch = h("button", { class: "space-swatch", "aria-label": t("{name} 색", { name: space.name }), "aria-expanded": String(colorsOpen === space.id), title: colorNames()[spaceColor(space.color)] });
  swatch.style.setProperty("--band", `var(--band-${spaceColor(space.color)})`);
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
  const row = h("div", { class: "row space-row", "data-id": space.id }, grip, swatch, name, count, remove);
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
    const rows = [...list.querySelectorAll<HTMLElement>(".space-row")].filter((entry) => entry !== row);
    const after = rows.find((entry) => { const box = entry.getBoundingClientRect(); return moveEvent.clientY < box.top + box.height / 2; });
    if (after) list.insertBefore(row, after); else rows.at(-1)?.after(row);
  };
  const up = () => {
    row.removeEventListener("pointermove", move);
    row.classList.remove("dragging");
    const ids = [...list.querySelectorAll<HTMLElement>(".space-row")].map((entry) => entry.dataset.id!);
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
  for (const item of state.items) {
    const space = !item.isCompleted ? index.get(item.id) : undefined;
    if (space) open.set(space.id, (open.get(space.id) ?? 0) + 1);
  }
  const rows = spaces.flatMap((space) => spaceRow(space, open.get(space.id) ?? 0));
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
    group(t("스페이스"), [...rows, lastRow],
      t("할 일을 회사 · 집처럼 나눠요. 오늘 한 장에는 그대로 모두 보이고, 머리말에서 한 스페이스만 볼 수 있어요. 입력 줄에 {tag}을 붙이면 그 스페이스로 들어가요.", { tag: `#${t("이름").toLowerCase()}` }), false, "spaces"),
    group(t("한 스페이스만 보기"), [h("div", { class: "row" }, glyph("keyboard"), h("div", { class: "grow" }, h("div", {}, t("노트에서 Ctrl+Shift+1–9")), h("div", { class: "sub" }, t("스페이스 순서대로 골라요. Ctrl+Shift+0은 모두 보기예요."))))],
      t("다음 날 아침 4시에 모든 스페이스로 돌아와요. 알림과 오늘 탭의 숫자는 숨긴 할 일도 그대로 셈해요.")),
  ];
}

// ─── Render ───────────────────────────────────────────────────────────────────

const app = document.getElementById("app")!;

function render(): void {
  const { prefs } = state;
  document.documentElement.dataset.font = prefs.font;
  document.documentElement.dataset.pane = tab;
  document.documentElement.style.setProperty("--body-size", `${bodyFontSize(prefs.font, prefs.textSize)}px`);
  const scrollTop = app.querySelector(".content")?.scrollTop ?? 0;
  const pages: Record<Tab, () => Node[]> = { appearance, notifications, repeat: repeats, pet, clock, events: calendarSettings, storage: storagePane, drawer: drawerPane, spaces: spacesPane, ai: aiPane };
  const content = h("div", { class: "content" }, ...pages[tab]());
  const parts: Node[] = [paneHead(), content, toastHost];
  if (tab === "notifications") {
    const preview = h("button", { class: "action primary", title: t("지금 알림을 한 번 띄워 봐요. 목록은 바뀌지 않아요.") }, icon("play", 12), t("미리보기"));
    preview.addEventListener("click", () => api.act({ type: "previewReminder" }));
    const rest = h("button", { class: "action" }, icon("moon", 14), t("1시간 쉬기"));
    rest.disabled = !prefs.reminderEnabled;
    rest.addEventListener("click", () => api.act({ type: "snoozePeriodic", minutes: 60 }));
    parts.push(h("div", { class: "bottom" }, preview, h("span", { class: "spacer" }), rest));
  }
  // A field being typed in (a stepper, 직접, the alarm's fields) keeps the focus across the redraw.
  const active = document.activeElement as HTMLInputElement | null;
  const keep = active?.dataset?.keep;
  const selection = keep && active ? [active.selectionStart, active.selectionEnd] as const : undefined;
  app.replaceChildren(...parts);
  content.scrollTop = scrollTop;
  // A soft edge under the pane's header (and above the bottom) while there is more to scroll.
  edgeFade(content);
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
  spaceDraft = undefined;
  colorsOpen = undefined;
  spaceBusy = false;
  closeAlarmEditor();
  if (state) { render(); app.querySelector(".content")!.scrollTop = 0; }
}

api.on("state", (next) => {
  state = next as AppState;
  // Don't wipe a half-filled form or an alarm being edited; redraw once it closes. (A space's name being typed, too.)
  if (openForm || editingAlarm) return;
  if (spaceBusy && tab === "spaces") { spaceRedraw = true; return; }
  render();
});
api.on("desk:pane", (payload) => {
  const pane = readPane((payload as { pane?: unknown })?.pane);
  if (pane && isSettingsTab(pane)) showTab(pane);
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
