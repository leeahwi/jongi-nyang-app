import { BrowserWindow, Menu, ipcMain, screen, type IpcMainEvent, type MenuItemConstructorOptions, type Rectangle } from "electron";
import path from "node:path";
import {
  frameFor, hasStyles, newPlace, stylesOf, newWidgetId, placeOf, readOpacity, snap, widget as makeWidget, widgetLimit, widgetName, windowSize,
  type Box, type WidgetKind, type WidgetScreen, type WidgetSettings, type WidgetStyle,
} from "../core/calendarWidget";
import { askLevels } from "../core/slipMove";
import type { WidgetChanges } from "../core/types";
import { lang, t } from "../i18n";
import { offscreen, offscreenEnabled } from "./env";
import type { Store } from "./store";

/**
 * 바탕화면 달력 위젯 (#234): up to four frameless, clear windows on the desktop, each one a calendar on paper with two
 * small cat ears at its top right (renderer/widget.ts). They never take the keyboard (not focusable, never in the
 * taskbar): a click on a day opens the day sheet beside the widget (widgetSheet.ts), which does. 바탕화면에 두기 is a
 * plain window that stays where other windows cover it (Electron can't put a window under the others); 항상 위에 두기
 * floats. The page decides where the mouse is taken: over the paper (unless 클릭 통과, or with Ctrl held) and over the
 * ears; everywhere else the clicks go through. Each widget remembers its place per display as shares of the work area
 * (core/calendarWidget.ts) and is put back inside when displays change. Settings are this PC's (settings.json), never
 * the storage folder's. Off-screen runs (snapshots, perf) keep every widget far off every display (offscreenGuard.ts
 * guards these windows like every other); snapshots never show them at all (a hidden window painting, as the ears'
 * preview).
 */

/** Room around the paper for its soft shadow (clicks there go through). */
const shadowRoom = 14;
/** Snapshots: more of the sample wallpaper around the widget. */
const snapshotRoom = 28;
/** A toast after 위젯 제거 stays this long (its 되돌리기), then the window goes. */
const removedMs = 4_500;

interface Shown {
  settings: WidgetSettings;
  window: BrowserWindow;
  interactive: boolean;
  loaded: boolean;
  drag?: { cursor: Electron.Point; origin: Electron.Point };
  /** Removed: the window shows only the toast until it goes. */
  removing?: NodeJS.Timeout;
  /** The last frame it was put at (without the room around it, off-screen offset taken out). */
  frame?: Box;
}

export interface WidgetHooks {
  /** 설정…: the desk's 일정 pane with this widget's settings slip open. */
  openSettings(id: string): void;
  /** The day sheet's window class (made by main.ts so it shares the input line's commit). */
  openSheet(id: string, day: string, beside: Rectangle): void;
  /** The widgets hidden or shown again (the tray's line changes). */
  changed(): void;
}

export class CalendarWidgets {
  private readonly shown = new Map<string, Shown>();
  /** 달력 위젯 숨기기 (the tray): until it is clicked again or the app starts again. */
  private hiddenAll = false;
  private readonly room: number;

  constructor(private readonly store: Store, private readonly rendererDirectory: string, private readonly hooks: WidgetHooks, private readonly snapshots: boolean) {
    this.room = snapshots ? snapshotRoom : shadowRoom;
    store.on("prefs", (key: string) => { if (key === "calendarWidgets") this.sync(); });
    const replace = () => this.sync(true);
    screen.on("display-added", replace);
    screen.on("display-removed", replace);
    screen.on("display-metrics-changed", replace);
    const owner = (event: IpcMainEvent) => [...this.shown.values()].find((entry) => !entry.window.isDestroyed() && entry.window.webContents === event.sender);
    ipcMain.on("widget:ready", (event) => { const entry = owner(event); if (entry) { entry.loaded = true; this.send(entry); } });
    ipcMain.on("widget:interactive", (event, value: unknown) => {
      const entry = owner(event);
      if (!entry || entry.interactive === Boolean(value)) return;
      entry.interactive = Boolean(value);
      entry.window.setIgnoreMouseEvents(!entry.interactive, { forward: true });
    });
    ipcMain.on("widget:menu", (event) => { const entry = owner(event); if (entry) this.menu(entry); });
    ipcMain.on("widget:day", (event, day: unknown) => {
      const entry = owner(event);
      if (!entry || typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      this.hooks.openSheet(entry.settings.id, day, entry.window.getBounds());
    });
    ipcMain.on("widget:drag-start", (event) => {
      const entry = owner(event);
      if (!entry || entry.settings.locked) return;
      const bounds = entry.window.getBounds();
      entry.drag = { cursor: screen.getCursorScreenPoint(), origin: { x: bounds.x, y: bounds.y } };
    });
    ipcMain.on("widget:drag", (event) => {
      const entry = owner(event);
      if (!entry?.drag) return;
      const cursor = screen.getCursorScreenPoint();
      const bounds = entry.window.getBounds();
      entry.window.setBounds({ ...bounds, x: Math.round(entry.drag.origin.x + cursor.x - entry.drag.cursor.x), y: Math.round(entry.drag.origin.y + cursor.y - entry.drag.cursor.y) });
    });
    ipcMain.on("widget:drag-end", (event) => {
      const entry = owner(event);
      if (!entry?.drag) return;
      entry.drag = undefined;
      this.drop(entry);
    });
  }

  get count(): number { return this.store.prefs.calendarWidgets.length; }
  /** #253: a widget is kept on top and shows now (a waiting question floats over it). */
  get floats(): boolean {
    return [...this.shown.values()].some((entry) => !entry.window.isDestroyed() && entry.window.isAlwaysOnTop() && (entry.window.isVisible() || this.snapshots));
  }
  get hidden(): boolean { return this.hiddenAll; }

  /** 달력 위젯 숨기기 · 보이기 (the tray). */
  setHidden(hidden: boolean): void {
    if (this.hiddenAll === hidden) return;
    this.hiddenAll = hidden;
    this.sync();
    this.hooks.changed();
  }

  // ─── The list ───────────────────────────────────────────────────────────────

  private write(list: WidgetSettings[]): void {
    this.store.setPref("calendarWidgets", list.slice(0, widgetLimit).map((entry) => makeWidget(entry)));
  }

  /** + 위젯 더하기: at the main display's top right, clear of the widgets already there (P6). */
  add(kind: WidgetKind, style: WidgetStyle): string | undefined {
    const list = this.store.prefs.calendarWidgets;
    if (list.length >= widgetLimit) return undefined;
    const id = newWidgetId(list.map((entry) => entry.id));
    const size = windowSize(kind, makeWidget({ id, kind, style }).style);
    const main = this.screens()[0];
    const others = list.map((entry) => this.frameOf(entry));
    const place = main ? newPlace(size.width, size.height, main, others) : undefined;
    this.hiddenAll = false;
    this.write([...list, makeWidget({ id, kind, style, ...(place ? { place } : {}) })]);
    return id;
  }

  change(id: string, changes: WidgetChanges): void {
    const list = this.store.prefs.calendarWidgets;
    const index = list.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const next = [...list];
    next[index] = makeWidget({ ...list[index], ...changes, ...(changes.opacity !== undefined ? { opacity: readOpacity(changes.opacity) } : {}) });
    this.write(next);
  }

  /**
   * 위젯 제거: gone from the list at once; from its own menu its window stays a moment for the toast's 되돌리기
   * (`fromWidget`), from the desk the desk's toast has it.
   */
  remove(id: string, fromWidget = false): void {
    const list = this.store.prefs.calendarWidgets;
    if (!list.some((entry) => entry.id === id)) return;
    const entry = this.shown.get(id);
    if (fromWidget && entry && !entry.window.isDestroyed()) {
      const index = list.findIndex((other) => other.id === id);
      entry.removing = setTimeout(() => this.close(id), removedMs);
      // The page takes the mouse over the toast only (as it does over the paper).
      entry.window.webContents.send("widget:removed", { widget: entry.settings, index });
    }
    this.write(list.filter((other) => other.id !== id));
  }

  /** 되돌리기: back where it was. */
  restore(widget: WidgetSettings, index: number): void {
    const list = this.store.prefs.calendarWidgets;
    if (list.some((entry) => entry.id === widget.id) || list.length >= widgetLimit) return;
    const entry = this.shown.get(widget.id);
    if (entry?.removing) { clearTimeout(entry.removing); entry.removing = undefined; }
    const next = [...list];
    next.splice(Math.min(index, next.length), 0, widget);
    this.write(next);
  }

  // ─── Windows ────────────────────────────────────────────────────────────────

  /** Every widget as the list says: made, moved, levelled, told its settings; the rest closed. `again`: displays changed. */
  sync(again = false): void {
    const list = this.hiddenAll ? [] : this.store.prefs.calendarWidgets;
    for (const [id, entry] of this.shown) {
      if (!list.some((settings) => settings.id === id) && !entry.removing) this.close(id);
    }
    for (const settings of list) {
      const entry = this.ensure(settings);
      const resized = entry.settings.kind !== settings.kind || entry.settings.style !== settings.style;
      entry.settings = settings;
      if (!entry.drag) this.place(entry, again || resized || !entry.frame);
      const top = settings.level === "top";
      if (entry.window.isAlwaysOnTop() !== top) entry.window.setAlwaysOnTop(top, askLevels.widgetOnTop.level, askLevels.widgetOnTop.relative);
      this.send(entry);
      if (!this.snapshots && !entry.window.isVisible()) entry.window.showInactive();
    }
  }

  /** The widget's window (made, hidden, the first time). */
  private ensure(settings: WidgetSettings): Shown {
    const existing = this.shown.get(settings.id);
    if (existing && !existing.window.isDestroyed()) return existing;
    const size = this.windowBounds(this.frameOf(settings));
    const window = new BrowserWindow({
      ...size, show: false, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, backgroundColor: "#00000000",
      title: t("달력 위젯"),
      // Off-screen runs (#92): a window placed off every display may stay there (only macOS reads this).
      enableLargerThanScreen: offscreenEnabled || this.snapshots,
      paintWhenInitiallyHidden: this.snapshots,
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, backgroundThrottling: !offscreenEnabled },
    });
    window.setIgnoreMouseEvents(true, { forward: true });
    window.loadFile(path.join(this.rendererDirectory, "widget.html"));
    window.on("closed", () => { if (this.shown.get(settings.id)?.window === window) this.shown.delete(settings.id); });
    const entry: Shown = { settings, window, interactive: false, loaded: false };
    this.shown.set(settings.id, entry);
    return entry;
  }

  private close(id: string): void {
    const entry = this.shown.get(id);
    if (!entry) return;
    if (entry.removing) clearTimeout(entry.removing);
    this.shown.delete(id);
    if (!entry.window.isDestroyed()) entry.window.destroy();
  }

  private send(entry: Shown): void {
    if (!entry.loaded || entry.window.isDestroyed()) return;
    entry.window.webContents.send("widget:settings", { widget: entry.settings, room: this.room, preview: this.snapshots });
  }

  /** The displays, the main one first (its id and work area, off-screen offset taken out). */
  private screens(): WidgetScreen[] {
    const primary = screen.getPrimaryDisplay();
    return [primary, ...screen.getAllDisplays().filter((display) => display.id !== primary.id)]
      .map((display) => ({ id: String(display.id), area: display.workArea }));
  }

  /** Where a widget's paper and ears go now: its place on its display (or the main one), else a new place. */
  private frameOf(settings: WidgetSettings): Box {
    const size = windowSize(settings.kind, settings.style);
    const screens = this.screens();
    const place = settings.place ?? (screens[0] ? newPlace(size.width, size.height, screens[0], []) : undefined);
    return place ? frameFor(place, size.width, size.height, screens) : { x: 0, y: 0, ...size };
  }

  private windowBounds(frame: Box): Rectangle {
    return {
      x: Math.round(frame.x - this.room + offscreen.x), y: Math.round(frame.y - this.room + offscreen.y),
      width: Math.round(frame.width + this.room * 2), height: Math.round(frame.height + this.room * 2),
    };
  }

  private place(entry: Shown, force: boolean): void {
    const frame = this.frameOf(entry.settings);
    if (!force && entry.frame && JSON.stringify(frame) === JSON.stringify(entry.frame)) return;
    entry.frame = frame;
    entry.window.setBounds(this.windowBounds(frame));
  }

  /** A drag let go: snapped to the work area's and the other widgets' edges (P5), remembered as shares (P1). */
  private drop(entry: Shown): void {
    const bounds = entry.window.getBounds();
    const size = windowSize(entry.settings.kind, entry.settings.style);
    const frame: Box = { x: bounds.x + this.room - offscreen.x, y: bounds.y + this.room - offscreen.y, ...size };
    const screens = this.screens();
    const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
    const area = (screens.find((one) => centre.x >= one.area.x && centre.x < one.area.x + one.area.width && centre.y >= one.area.y && centre.y < one.area.y + one.area.height) ?? screens[0])?.area;
    if (!area) return;
    const others = [...this.shown.values()].filter((other) => other !== entry && other.frame && !other.removing).map((other) => other.frame!);
    const snapped = snap(frame, area, others);
    entry.frame = snapped;
    entry.window.setBounds(this.windowBounds(snapped));
    const place = placeOf(snapped, screens);
    if (place) this.setPlace(entry.settings.id, place);
  }

  private setPlace(id: string, place: NonNullable<WidgetSettings["place"]>): void {
    const list = this.store.prefs.calendarWidgets;
    const index = list.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const next = [...list];
    next[index] = { ...list[index], place };
    this.write(next);
  }

  // ─── The menu (the ears, or a right-click) ──────────────────────────────────

  private menu(entry: Shown): void {
    const { settings } = entry;
    const id = settings.id;
    const items: MenuItemConstructorOptions[] = [];
    if (hasStyles(settings.kind)) {
      items.push({ label: t("모양", undefined, "widget"), enabled: false },
        ...stylesOf(settings.kind).map((style): MenuItemConstructorOptions => ({
          label: style === "wall" ? t("벽 달력") : style === "simple" ? t("간단히", undefined, "widget") : t("자세히", undefined, "widget"), type: "radio", checked: settings.style === style, click: () => this.change(id, { style }),
        })),
        { type: "separator" });
    }
    items.push({ label: t("불투명도"), enabled: false },
      ...[100, 85, 70, 50, 30].map((opacity): MenuItemConstructorOptions => ({ label: `${opacity}%`, type: "radio", checked: settings.opacity === opacity, click: () => this.change(id, { opacity }) })),
      { type: "separator" },
      { label: t("클릭 통과"), type: "checkbox", checked: settings.clickThrough, click: () => this.change(id, { clickThrough: !settings.clickThrough }) },
      { label: t("위치 고정"), type: "checkbox", checked: settings.locked, click: () => this.change(id, { locked: !settings.locked }) },
      { type: "separator" },
      { label: t("설정…"), click: () => this.hooks.openSettings(id) },
      { label: t("위젯 제거"), click: () => this.remove(id, true) });
    Menu.buildFromTemplate(items).popup({ window: entry.window });
  }

  // ─── Snapshots and perf ─────────────────────────────────────────────────────

  /** A widget's window, to capture it (snapshots) or measure it (perf). */
  windowOf(id: string): BrowserWindow | undefined {
    const entry = this.shown.get(id);
    return entry && !entry.window.isDestroyed() ? entry.window : undefined;
  }

  /** A widget's page has loaded and been told its settings. */
  isReady(id: string): boolean { return Boolean(this.shown.get(id)?.loaded); }

  /** Snapshots: the widget over a sample wallpaper (light · dark · busy), hovered or not, on a page ‹ › away (`offset`). */
  preview(id: string, look: { wall: string; hover?: boolean; offset?: number }): BrowserWindow | undefined {
    const entry = this.shown.get(id);
    if (!entry || !entry.loaded || entry.window.isDestroyed()) return undefined;
    entry.window.webContents.send("widget:settings", { widget: entry.settings, room: this.room, preview: true, ...look });
    return entry.window;
  }

  /** Every widget's window (perf: their processes). */
  get windows(): BrowserWindow[] {
    return [...this.shown.values()].map((entry) => entry.window).filter((window) => !window.isDestroyed());
  }

  /** The tray's line: ‘달력 위젯 숨기기’ while there are widgets, ‘달력 위젯 보이기’ while hidden. */
  trayItem(): MenuItemConstructorOptions[] {
    if (this.count === 0) return [];
    return [{ label: this.hiddenAll ? t("달력 위젯 보이기") : t("달력 위젯 숨기기"), click: () => this.setHidden(!this.hiddenAll) }];
  }

  /** The widget's name, for the desk's rows and the settings slip ("이번 달 · 간단히"). */
  static nameOf(settings: WidgetSettings): string { return widgetName(settings.kind, settings.style, lang()); }
}
