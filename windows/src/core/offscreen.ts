/**
 * Off-screen runs (#92: snapshots, tests, perf): where a window may be. Every display grown by `margin` is out of
 * bounds; a window that would touch that is put back at `home` (its size kept). Electron's own types aren't used so
 * the rule is tested on its own (test/offscreen.test.ts); main/offscreenGuard.ts applies it to every window.
 */
export interface Box { x: number; y: number; width: number; height: number }

/** Room kept between an off-screen window and any display, so a move by a window's width still lands nowhere. */
export const offscreenMargin = 4000;

export function nearDisplay(bounds: Box, displays: readonly Box[], margin = offscreenMargin): boolean {
  return displays.some((area) => bounds.x < area.x + area.width + margin && area.x - margin < bounds.x + bounds.width
    && bounds.y < area.y + area.height + margin && area.y - margin < bounds.y + bounds.height);
}

/** `wanted` where it is when that is far off every display, else at `home` with the same size. */
export function awayBounds(wanted: Box, displays: readonly Box[], home: { x: number; y: number }): Box {
  return nearDisplay(wanted, displays) ? { x: home.x, y: home.y, width: wanted.width, height: wanted.height } : wanted;
}

/** What the guard needs of a window (Electron's BrowserWindow has all of it). */
export interface GuardedWindow {
  getBounds(): Box;
  setBounds(bounds: Partial<Box>): void;
  getContentSize(): number[];
  setPosition(x: number, y: number): void;
  setSize(width: number, height: number): void;
  setContentSize(width: number, height: number): void;
  center(): void;
  show(): void;
  showInactive(): void;
  focus(): void;
  setParentWindow(parent: null): void;
  setHiddenInMissionControl(hidden: boolean): void;
  isDestroyed(): boolean;
  getTitle(): string;
  on(event: "move" | "resize" | "show", listener: () => void): unknown;
}

export interface GuardOptions {
  displays: () => readonly Box[];
  home: { x: number; y: number };
  /**
   * macOS (#250): no window has an owner. Electron puts a child window of an off-screen window onto a screen when it
   * shows it (the note's ears did, 2026-10-30, main/noteEars.ts); the question slip still asked over the note.
   */
  noOwners: boolean;
  /**
   * macOS (#250): out of Mission Control and App Exposé. They draw every window of the Space shrunk onto the screen,
   * off-screen ones too: a run's cat (1710×250, seen at 791×116), drawer (334×780 at 156×365) and desk (920×676 at
   * 437×321) came up there on the person's screen, and the watch stopped the run each time.
   */
  hideFromOverviews: boolean;
  /** A window found near a display, before it is put back (`why`: what moved it). */
  putBack?: (bounds: Box, why: string) => void;
}

/**
 * Off-screen runs (#92, #250): every way the app places, sizes or shows `window` goes through one door that keeps it far
 * off every display (main/offscreenGuard.ts applies it to every window). A place near a display becomes `home` before
 * the system sees it; after each step, and after every move or resize the system makes on its own, the window is
 * checked and put back if it is near a display after all.
 */
export function guardWindow(window: GuardedWindow, options: GuardOptions): void {
  const { displays, home } = options;
  const native = {
    setBounds: window.setBounds.bind(window), show: window.show.bind(window), showInactive: window.showInactive.bind(window),
    focus: window.focus.bind(window), setParentWindow: window.setParentWindow.bind(window),
  };
  const check = (why: string) => {
    if (window.isDestroyed()) return;
    const now = window.getBounds();
    if (!nearDisplay(now, displays())) return;
    options.putBack?.(now, why);
    native.setBounds({ ...home, width: now.width, height: now.height });
  };
  const put = (bounds: Partial<Box>, why: string) => {
    if (window.isDestroyed()) return;
    native.setBounds(awayBounds({ ...window.getBounds(), ...bounds }, displays(), home));
    check(why);
  };
  window.setBounds = (bounds: Partial<Box>) => put(bounds, "setBounds");
  window.setPosition = (x: number, y: number) => put({ x, y }, "setPosition");
  window.setSize = (width: number, height: number) => put({ width, height }, "setSize");
  window.setContentSize = (width: number, height: number) => {
    // The frame around the content (none for the frameless windows) stays as it is.
    const [contentWidth, contentHeight] = window.getContentSize();
    const now = window.getBounds();
    put({ width: now.width + width - contentWidth, height: now.height + height - contentHeight }, "setContentSize");
  };
  window.center = () => put({}, "center");
  window.show = () => { put({}, "show"); native.show(); check("show"); };
  window.showInactive = () => { put({}, "showInactive"); native.showInactive(); check("showInactive"); };
  // focus() shows a hidden window too.
  window.focus = () => { put({}, "focus"); native.focus(); check("focus"); };
  if (options.noOwners) {
    native.setParentWindow(null);
    window.setParentWindow = () => undefined;
  }
  if (options.hideFromOverviews) {
    window.setHiddenInMissionControl(true);
    // (Kept so: the app never shows a window there in an off-screen run.)
    window.setHiddenInMissionControl = () => undefined;
  }
  // Moved, resized or shown by the system (a display change, macOS pulling a window back): back at once.
  window.on("move", () => check("moved"));
  window.on("resize", () => check("resized"));
  window.on("show", () => check("shown"));
  // Made where the system put it (a window made without a place is centred on a display): away before anything else.
  put({}, "made");
}
