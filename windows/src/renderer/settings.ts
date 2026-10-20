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
  appearance: t("언어 · 종이 색 · 글꼴과 글자 크기를 정해요."),
  notifications: t("주기 알림과 알림 모양을 정하고, 미리보기로 확인해요."),
  repeat: t("반복하는 날마다 목록에 한 줄씩 놓여요."),
  pet: t("종이냥을 보이거나 숨기고, 돌아다닐지, 말을 걸지 정해요."),
  clock: t("알람을 맞추고, 뽀모도로 시간과 소리를 정하고 바로 시작해요."),
  events: t("일정을 적어 두면 오늘 할 일 위에 보이고, 시작 전에 알려 줘요."),
  storage: t("할 일과 기록이 저장되는 곳, 다른 컴퓨터로 옮기는 백업이에요."),
};

const set = <K extends keyof Prefs>(key: K, value: Prefs[K]) => api.act({ type: "setPref", key, value });

function group(label: string, content: Node[], foot?: string, warn = false): HTMLElement {
  return h("div", { class: "group" }, h("div", { class: "label" }, label), h("div", { class: "card" }, ...content), foot ? h("div", { class: `foot${warn ? " warn" : ""}` }, wrapText(foot)) : null);
}

const pathMeasure = document.createElement("canvas").getContext("2d")!;

/**
 * A folder's place on one line: the start and the end of the path with "…" between them when it is
 * longer than the row (as on the Mac); the whole path in the tooltip and when copied.
 */
function folderPath(path: string): HTMLElement {
  const element = h("div", { class: "folder-path", title: path, "aria-label": t("폴더 위치 {path}", { path }) }, path);
  const fit = () => {
    const width = element.clientWidth;
    if (!width) return;
    const style = getComputedStyle(element);
    pathMeasure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const fits = (text: string) => pathMeasure.measureText(text).width <= width - 2;
    if (fits(path)) { element.textContent = path; return; }
    // The most characters that fit, 40 % from the start and 60 % from the end (the folder's own name).
    const shortened = (keep: number) => { const head = Math.ceil(keep * 0.4); return `${path.slice(0, head)}…${path.slice(path.length - (keep - head))}`; };
    let low = 0, high = path.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(shortened(middle))) low = middle; else high = middle - 1;
    }
    element.textContent = shortened(low);
  };
  new ResizeObserver(fit).observe(element);
  void document.fonts.ready.then(fit);
  element.addEventListener("copy", (event) => { event.preventDefault(); event.clipboardData?.setData("text/plain", path); });
  return element;
}

/** A row's line icon on a small sage square. */
function glyph(name: string): HTMLElement {
  return h("span", { class: "glyph", "aria-hidden": "true" }, icon(name, 16, 1.7));
}

/** The pane's header: its name and what it is for (꾸미기 keeps one small cat). */
function paneHead(): HTMLElement {
  return h("header", { class: "pane-head" },
    h("div", { class: "ph-text" }, h("h1", {}, paneTitle(tab)), h("p", { class: "ph-sub" }, subtitles[tab])),
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
  if (!prefs.reminderEnabled) return t("꺼져 있어요. 켜면 노트를 쓰는 동안에는 잠시 기다렸다 알려줘요.");
  if (!state.items.some((item) => !item.isCompleted && pageOf(item, new Date()) === "today")) return t("남은 할 일이 생기면 알려드려요.");
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

  const startRow = h("div", { class: "row" }, glyph("power"), h("span", { class: "grow" }, t("Windows 시작 시 종이냥 실행")),
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
    h("div", { class: "grow" }, h("div", {}, t("빠른 메모를 열 때 복사한 글 넣기")), h("div", { class: "sub" }, t("빈 메모를 열면 방금 복사한 글이 골라진 채로 들어가요. 그냥 적으면 바뀌어요."))),
    toggle(prefs.quickMemoClipboard, t("빠른 메모를 열 때 복사한 글 넣기"), (value) => set("quickMemoClipboard", value)));
  // Another app holding a shortcut is said in the foot, in the accent colour.
  const shortcutProblems = [prefs.quickEntry ? state.shortcutProblem : undefined, prefs.quickMemo ? state.memoShortcutProblem : undefined, prefs.noteHotkey ? state.noteShortcutProblem : undefined].filter(Boolean) as string[];
  const quickFoot = shortcutProblems.length > 0
    ? shortcutProblems.join(" ")
    : `${t("어떤 앱을 쓰다가도 Ctrl+Alt+N을 누르면 작은 종이가 떠요. ‘내일 3시 엄마께 전화’, ‘금요일까지 보고서’처럼 적으면 알림·마감을 알아서 정해요. ‘내일 3시 회의’는 일정이 돼요.")} ${t("Ctrl+Alt+M은 몇 줄을 바로 메모 탭에 넣는 빠른 메모예요.")} ${t("Ctrl+Alt+J는 노트를 불러오거나 넣어 둬요.")}`;

  // 언어: 자동 (the system's) or one of the three, each named in its own language; changing it restarts the app.
  const languages: { value: LanguageSetting; title: string }[] = [{ value: "auto", title: t("자동") }, ...(["ko", "en", "nl"] as const).map((value) => ({ value, title: nativeName[value] }))];
  const languageRow = h("div", { class: "row language" }, glyph("globe"), h("span", { class: "grow" }, t("언어")),
    segmented(languages, prefs.language, (value) => set("language", value), t("언어")));
  // 종이 색: 자동 follows Windows' light or dark mode; 낮 and 밤 keep one.
  const papers: { value: PaperSetting; title: string }[] = [{ value: "auto", title: t("자동") }, { value: "day", title: t("낮") }, { value: "night", title: t("밤") }];
  const paperRow = h("div", { class: "row paper" }, glyph(prefs.paper === "day" ? "sun" : "moon"), h("span", { class: "grow" }, t("종이 색")),
    segmented(papers, prefs.paper, (value) => set("paper", value), t("종이 색")));
  // The due-style samples: a row's badge for a deadline three days off, as each style writes it (core label()).
  const [ddaySample, dateSample] = { ko: ["D-3", "~금"], en: ["3 days left", "by Fri"], nl: ["nog 3 dagen", "tot vr"] }[lang()]; // i18n-ok

  return [
    group(t("언어"), [languageRow]),
    group(t("종이 색"), [paperRow], t("자동은 Windows의 밝게 · 어둡게 모드를 따라가요. 밤 종이는 불 끈 방의 종이 색이에요.")),
    preview,
    group(t("글꼴"), fontRows),
    group(t("글자 크기"), [sizeRow], t("Ctrl + = 와 Ctrl + − 로도 바꿀 수 있어요.")),
    group(t("마감 표시"), [h("div", { class: "row" }, glyph("flag"), h("span", { class: "grow" }, t("마감을 이렇게 보여 주기")),
      segmented([{ value: "dday", title: ddaySample }, { value: "date", title: dateSample }], prefs.dueStyle, (style) => set("dueStyle", style), t("마감 표시 방식")))],
      t("할 일의 알림 → 마감에서 오늘까지·이번 주 안·이번 달 안·날짜를 정해요. 지난 마감은 붉게 표시돼요.")),
    group(t("시작"), [startRow, badgeRow], t("작업 표시줄 단추에 오늘 남은 할 일 수를 작게 띄워요. 점프 목록(작업 표시줄 단추 우클릭)에는 빠른 입력 · 빠른 메모 · 책상 · 25분 집중 · 5분 타이머가 있어요.")),
    group(t("빠른 입력"), [quickRow, memoRow, noteRow, clipRow], quickFoot, shortcutProblems.length > 0),
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
  const historyButton = h("button", { class: "row choice" }, glyph("sparkles"), h("span", { class: "grow" }, t("완료 기록 보기")), h("span", { style: "color:var(--faded)" }, "Ctrl+H ›"));
  const openArchive = h("button", { class: "action small", title: t("탐색기에서 완료 기록 폴더 열기 (월별 파일, 예: 2026-10.jsonl)") }, t("열기"));
  openArchive.addEventListener("click", () => api.act({ type: "openArchiveFolder" }));
  const archiveFolderRow = h("div", { class: "row storage" }, glyph("folder"),
    h("div", { class: "grow" }, h("div", {}, t("기록 폴더")), folderPath(state.storage.archivePath)), openArchive);
  historyButton.addEventListener("click", () => api.act({ type: "openHistory" }));
  const archiveFoot = prefs.archiveAfterDays === 0
    ? t("완료한 일이 목록에 계속 남아요. ⋯ → 완료한 일 정리로 직접 지울 수 있어요.")
    : t("완료한 일은 그날(새벽 4시 기준)이 지나면 목록에서 빠져 월별 기록 파일로 옮겨져요. 기록은 책상 → 완료 기록에서 볼 수 있어요.");

  return group(t("완료한 일"), [archiveRow, historyButton, archiveFolderRow], archiveFoot);
}

/** 저장과 백업: where the list lives (this PC or a shared folder), and the .jongi backup to move it. */
function storagePane(): Node[] {
  const { storage } = state;
  const choose = h("button", { class: "action small" }, icon("folder", 13), t("다른 폴더…"));
  choose.addEventListener("click", () => api.act({ type: "chooseStorage" }));
  const reset = h("button", { class: "action small", title: t("이 PC의 기본 위치(%APPDATA%\\PaperTodo)로 돌아가요") }, t("기본으로"));
  reset.disabled = !storage.custom;
  reset.addEventListener("click", () => api.act({ type: "resetStorage" }));
  const whereRow = h("div", { class: "row storage" }, glyph("folder"),
    h("div", { class: "grow" }, h("div", { class: "where" }, h("span", {}, t("저장 폴더")), h("span", { class: "kind" }, storage.custom ? t("공유 폴더") : t("이 PC (기본)"))),
      folderPath(storage.path)));
  const openFolder = h("button", { class: "action small", title: t("탐색기에서 저장 폴더 열기") }, icon("arrow", 13), t("폴더 열기"));
  openFolder.addEventListener("click", () => api.act({ type: "openDataFolder" }));
  const actionsRow = h("div", { class: "row storage-actions" }, openFolder, h("span", { class: "grow" }), reset, choose);

  // 백업 · 옮기기: everything in the storage folder to one .jongi file, and back.
  const exportButton = h("button", { class: "action small", title: t("할 일 · 메모 · 반복 · 일정 · 완료 기록을 .jongi 파일 하나로") }, icon("arrowUp", 13), t("내보내기…"));
  exportButton.addEventListener("click", () => api.act({ type: "exportBackup" }));
  const importButton = h("button", { class: "action small", title: t("내보낸 .jongi 파일을 합치거나 바꿔 넣기") }, icon("arrowDown", 13), t("가져오기…"));
  importButton.addEventListener("click", () => api.act({ type: "importBackup" }));
  const backupRow = h("div", { class: "row storage-actions" }, glyph("share"), h("span", { class: "grow" }, t("모두 한 파일로")), exportButton, importButton);

  return [
    group(t("저장 위치"), [whereRow, actionsRow], t("할 일 · 메모 · 반복 할 일 · 일정 · 알람과 완료 기록(archive 폴더) · 집중 기록(focus.jsonl)이 이 폴더에 저장돼요. iCloud Drive · OneDrive · Dropbox 같은 폴더를 고르면 다른 기기의 종이냥과 같은 목록을 써요. 다른 기기에서도 같은 폴더를 골라요.")),
    completedGroup(),
    group(t("백업 · 옮기기"), [backupRow],
      t("다른 컴퓨터로 옮길 때: 여기서 내보낸 .jongi 파일을 그 컴퓨터의 종이냥에서 가져오면 할 일 · 메모 · 반복 · 일정 · 알람 · 완료 기록 · 집중 기록이 그대로 옮겨져요. Mac과 Windows 사이도 돼요.")),
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
    h("div", { class: "grow" }, h("div", {}, t("남은 할 일 알려주기")), h("div", { class: "sub" }, t("할 일이 남아 있을 때만 종이냥이 한 번에 모아서 알려줘요."))),
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

  const perTask = h("div", { class: "row", style: "padding-top:10px;padding-bottom:10px" }, glyph("clock"),
    h("span", { class: "grow", style: "font-size:12px;color:var(--secondary);line-height:1.5" },
      t("할 일 줄의 알림 버튼에서 시각을 정해요. 같은 때 울릴 알림은 말풍선 하나에 모아 보여줘요.")));

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
    group(t("알림 모양"), [h("div", { class: "tiles", role: "radiogroup", "aria-label": t("알림 모양") }, ...styles.map(styleTile))]),
    group(t("주기 알림"), [enabled, intervalRow, durationRow], statusText()),
    group(t("할 일별 알림"), [perTask, systemRow], t("놓친 것만: 고양이와 노트가 모두 숨어 있거나 화면이 잠겨 있을 때만 Windows 알림으로도 보내요. 알림에서 바로 끝냄 · 10분 뒤를 고를 수 있어요.")),
    group(t("하루 정리"), [sweepRow, sweepTimeRow, pickRow], t("저녁 정리는 하루 한 번 와요. 그날 저녁을 놓치면 다음 날 처음 노트를 열 때 물어봐요.")),
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

function repeats(): Node[] {
  const list = state.series;
  const rows: Node[] = list.length === 0
    ? [h("div", { class: "row", style: "padding-top:12px;padding-bottom:12px" }, h("span", { class: "grow sub", style: "line-height:1.5" },
      t("아직 반복 할 일이 없어요. 할 일의 알림 → 반복에서 만들거나 아래 ‘새 반복 할 일’로 더해 보세요.")))]
    : list.flatMap((entry) => {
      if (openForm === entry.id) return [seriesForm(entry)];
      const editButton = h("button", { class: "quiet", title: t("고치기"), "aria-label": t("{title} 고치기", { title: entry.title }) }, icon("sliders", 14));
      const deleteButton = h("button", { class: "quiet danger", title: t("반복 그만하기 (목록의 할 일은 남아요)"), "aria-label": t("{title} 반복 그만하기", { title: entry.title }) }, icon("trash", 14));
      editButton.addEventListener("click", () => { openForm = entry.id; render(); });
      deleteButton.addEventListener("click", () => api.act({ type: "deleteSeries", id: entry.id }));
      return [h("div", { class: "row series" }, glyph("repeat"),
        h("div", { class: "grow" }, h("div", { class: "series-title" }, entry.title), h("div", { class: "sub" }, `${describe(entry.rule, entry.remindAt, lang())} · ${nextLabel(entry)}`)),
        editButton, deleteButton)];
    });
  const add = openForm === "new"
    ? seriesForm(undefined)
    : (() => {
      const button = h("button", { class: "row choice" }, glyph("plus"), h("span", { class: "grow" }, t("새 반복 할 일")));
      button.addEventListener("click", () => { openForm = "new"; render(); });
      return button;
    })();
  return [
    group(t("반복 할 일"), rows, t("반복하는 날마다 목록에 하나씩 나타나요. 전날 것을 못 끝냈으면 새로 쌓지 않고 오늘로 옮겨요.")),
    group(t("추가"), [add]),
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
  const showRow = h("div", { class: "row" }, glyph("paw"), h("span", { class: "grow" }, t("펫 보이기")),
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
  const previewRow = h("div", { class: "row" }, glyph("sparkles"), h("span", { class: "grow" }, t("지금 한마디 듣기")), preview);
  return [
    group(t("종이냥 펫"), [showRow, wanderRow],
      t("화면 아래(작업 표시줄 위)에 앉아 눈을 깜빡이고, 갸웃하고, 가끔 걸어 다녀요. 한동안 PC를 쓰지 않으면 졸고, 할 일을 끝내거나 타이머가 끝나면 축하해 줘요. 끌어서 자리를 옮기고, 우클릭하면 메뉴가 나와요.")),
    group(t("종이냥 한마디"), [chatterRow, frequencyRow, questionRow, previewRow],
      t("오늘 남은 일, 시간대, 마감에 맞춰 응원하거나 가볍게 말을 걸어요. 물어볼 때는 말풍선의 버튼으로 답해요(‘쉴래요’를 누르면 5분 타이머가 켜져요). 집중 타이머가 도는 동안, 알림이 떠 있을 때, 밤 11시~아침 7시, PC를 쓰지 않는 동안에는 조용히 있어요. 고양이를 누르면 가끔 대답해요.")),
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
  remove.addEventListener("click", () => {
    editingAlarm = undefined;
    state = { ...state, alarms: state.alarms.filter((entry) => entry.id !== draft.id) };
    void api.act({ type: "alarmDelete", id: draft.id });
    render();
  });
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
  const add = h("button", { class: "row choice" }, glyph("plus"), h("span", { class: "grow" }, t("알람 추가")));
  add.addEventListener("click", () => {
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
    ], t("집중과 휴식을 번갈아 해요. 빨간 원(집중)·초록 원(휴식)이 줄어드는 팻말이 화면에 따로 떠요. 끌어서 옮기고, 누르면 일시정지해요. 시간은 눌러서 직접 적을 수도 있어요(Shift를 누른 채 −·+는 5분씩).")),
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
  return [group(t("오늘 일정"), [stripRow, alertRow], t("일정은 할 일과 같은 저장 폴더의 events.json에 있어요. 공유 폴더를 쓰면 다른 기기와 함께 써요."))];
}

// ─── Render ───────────────────────────────────────────────────────────────────

const app = document.getElementById("app")!;

function render(): void {
  const { prefs } = state;
  document.documentElement.dataset.font = prefs.font;
  document.documentElement.dataset.pane = tab;
  document.documentElement.style.setProperty("--body-size", `${bodyFontSize(prefs.font, prefs.textSize)}px`);
  const scrollTop = app.querySelector(".content")?.scrollTop ?? 0;
  const pages: Record<Tab, () => Node[]> = { appearance, notifications, repeat: repeats, pet, clock, events: calendarSettings, storage: storagePane };
  const content = h("div", { class: "content" }, ...pages[tab]());
  const parts: Node[] = [paneHead(), content];
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
  closeAlarmEditor();
  if (state) { render(); app.querySelector(".content")!.scrollTop = 0; }
}

api.on("state", (next) => {
  state = next as AppState;
  // Don't wipe a half-filled form or an alarm being edited; redraw once it closes.
  if (openForm || editingAlarm) return;
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
