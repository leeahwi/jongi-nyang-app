import { contextBridge, ipcRenderer } from "electron";
import type { ArchiveEntry } from "./core/archive";
import type { FocusRecord } from "./core/focus";
import type { Action, AppState, IntentRequest, IntentResult } from "./core/types";
import type { CalendarWriteRequest, CalendarWriteResult } from "./core/calendar";
import type { Lang } from "./core/lang";
import type { SearchGroup } from "./core/search";

// Only these channels cross the bridge; renderers get no direct access to Node or Electron.
const listen = new Set([
  "state", "note:focus-new", "note:commit-editing", "note:row-command", "note:event-sheet", "calendar:event-sheet",
  "popup:show", "popup:retain", "popup:reset", "floating:summary", "history:changed", "pet:state", "timer:state", "timer:chime", "quick:open",
  "quickMemo:open", "quickMemo:blur", "timerSheet:open", "ring:show", "ring:hush", "note:toast", "confirm:show", "glance:open",
  "desk:pane", "paper", "focus:chime", "note:notice", "note:row-menu", "drawer:open", "drawer:shut", "drawer:look", "drawer:backdrop", "handle:state",
]);
const send = new Set([
  "popup:interactive", "popup:complete", "popup:complete-all", "popup:snooze", "popup:snooze-until", "popup:tomorrow", "popup:event-again", "popup:sweep", "popup:open", "popup:open-event", "popup:closed",
  "floating:drag-start", "floating:drag", "floating:drag-end", "floating:click", "floating:menu",
  "pet:ready", "pet:interactive", "pet:click", "pet:answer", "pet:open-note", "pet:menu", "pet:drag-start", "pet:drag-end",
  "timer:ready", "timer:interactive", "timer:toggle", "timer:pause", "timer:stop", "timer:dismiss", "timer:menu",
  "timer:drag-start", "timer:drag", "timer:drag-end", "quick:close",
  "quickMemo:draft", "quickMemo:close", "quickMemo:save", "timerSheet:start", "timerSheet:close", "ring:ready", "ring:stop", "ring:snooze",
  "slip:size", "confirm:answer", "confirm:ready", "glance:close", "glance:size",
  "drawer:close", "drawer:hidden", "drawer:interactive", "drawer:resize", "drawer:shape", "handle:open", "handle:drag",
]);

/** The app's language, asked once as the page loads (the main process chose it at launch). */
const lang = ipcRenderer.sendSync("lang:get") as Lang;
/** The app's clock (24-hour or 12-hour, the system's), asked once as the page loads; lang.ts reads it. */
const hourCycle = ipcRenderer.sendSync("clock:get") as string;

/**
 * 밤 종이: `<html data-paper="night">` switches every token (base.css). Set before the page draws and
 * again whenever the setting or the system's appearance changes, in every window and every frame.
 */
let night = ipcRenderer.sendSync("paper:get") === true;
const markPaper = () => { if (document.documentElement) document.documentElement.dataset.paper = night ? "night" : "day"; };
markPaper();
document.addEventListener("readystatechange", markPaper);
const paperListeners: ((night: boolean) => void)[] = [];
ipcRenderer.on("paper", (_event, value: unknown) => {
  night = value === true;
  markPaper();
  for (const listener of paperListeners) listener(night);
});

let wantsState = false;

const api = {
  platform: process.platform,
  lang,
  hourCycle,
  /** Night paper now, and a call whenever it changes (pages that draw colours themselves). */
  isNight: (): boolean => night,
  onPaper: (callback: (night: boolean) => void): void => { paperListeners.push(callback); },
  getState: (): Promise<AppState> => ipcRenderer.invoke("state:get"),
  act: (action: Action): Promise<void> => ipcRenderer.invoke("act", action),
  /** 메모 서랍, the page going away: the open memo's last typed text, handed over and saved before it returns. */
  flushMemo: (action: Extract<Action, { type: "memoUpdate" }>): void => { ipcRenderer.sendSync("memo:flush", action); },
  /** 완료 기록: the record of finished tasks and the focus sessions (focus.jsonl). */
  getHistory: (): Promise<{ entries: ArchiveEntry[]; focus: FocusRecord[]; now: number }> => ipcRenderer.invoke("history:get"),
  placePopup: (size: { width: number; height: number }): Promise<{ travel: number }> => ipcRenderer.invoke("popup:place", size),
  /** The pointer's place over the reminder's window, when it is over it (a resting pointer sends no moves). */
  popupPointer: (): Promise<{ x: number; y: number } | undefined> => ipcRenderer.invoke("popup:pointer"),
  /** 입력 줄: put a reading in, take it back, or learn from a switch (see intent.ts). */
  intent: (request: IntentRequest): Promise<IntentResult> => ipcRenderer.invoke("intent", request),
  /** 검색: what matches, grouped (오늘 · 앞으로 · 메모 · 완료 기록 · 일정). */
  search: (query: string): Promise<SearchGroup[]> => ipcRenderer.invoke("search", query),
  /** 일정: the event sheet's 넣기 · 만들기 · 저장 · 지우기 · 이 날만, written to events.json. */
  calendarWrite: (request: CalendarWriteRequest): Promise<CalendarWriteResult> => ipcRenderer.invoke("calendar:write", request),
  on(channel: string, callback: (...args: unknown[]) => void): void {
    if (!listen.has(channel)) return;
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    // The app's state goes only to pages that listen for it (the cat, the bubbles and the timer don't).
    if (channel === "state" && !wantsState) { wantsState = true; ipcRenderer.send("state:want"); }
  },
  send(channel: string, ...args: unknown[]): void {
    if (send.has(channel)) ipcRenderer.send(channel, ...args);
  },
};

contextBridge.exposeInMainWorld("paper", api);
export type PaperAPI = typeof api;
