/**
 * #409: 문제 보고용 정보 복사 (책상 → 도움) — what a problem that only shows on a real PC (#312 · #313: the cat sinking
 * under the taskbar, a resize frame on the ears) needs to be understood: the app's version, each display (bounds, work
 * area, scale), the cats' windows (bounds and Windows' style bits) and the GPU's state. Never a to-do, memo, event,
 * name or path: only numbers, flags and the app's own words for its settings. Kept out of Electron so a test can read
 * every line (test/reportInfo.test.ts).
 */

export interface Box { x: number; y: number; width: number; height: number }

export interface ReportDisplay { id: number; bounds: Box; workArea: Box; scaleFactor: number; rotation: number; internal: boolean; primary: boolean }

export interface ReportWindow {
  name: string;
  /** Not made (its feature is off), or made and hidden. */
  state: "none" | "hidden" | "shown";
  bounds?: Box;
  contentBounds?: Box;
  alwaysOnTop?: boolean;
  /** GetWindowLongPtrW(GWL_STYLE) · (GWL_EXSTYLE), Windows only. */
  style?: number;
  exStyle?: number;
}

export interface ReportInput {
  app: string;
  electron: string;
  chrome: string;
  os: string;
  lang: string;
  displays: ReportDisplay[];
  windows: ReportWindow[];
  gpu: Record<string, string>;
  /** A few settings the windows depend on (keys and values the app chose, never the person's text). */
  settings: Record<string, string | number | boolean>;
}

/** The style bits worth naming for these windows (WinUser.h). */
const styleBits: [number, string][] = [
  [0x80000000, "WS_POPUP"], [0x40000000, "WS_CHILD"], [0x10000000, "WS_VISIBLE"], [0x08000000, "WS_DISABLED"],
  [0x00c00000, "WS_CAPTION"], [0x00800000, "WS_BORDER"], [0x00400000, "WS_DLGFRAME"], [0x00080000, "WS_SYSMENU"],
  [0x00040000, "WS_THICKFRAME"], [0x00020000, "WS_MINIMIZEBOX"], [0x00010000, "WS_MAXIMIZEBOX"],
];
const exStyleBits: [number, string][] = [
  [0x00000008, "WS_EX_TOPMOST"], [0x00000020, "WS_EX_TRANSPARENT"], [0x00000080, "WS_EX_TOOLWINDOW"],
  [0x00000100, "WS_EX_WINDOWEDGE"], [0x00000200, "WS_EX_CLIENTEDGE"], [0x00040000, "WS_EX_APPWINDOW"],
  [0x00080000, "WS_EX_LAYERED"], [0x00200000, "WS_EX_NOREDIRECTIONBITMAP"], [0x08000000, "WS_EX_NOACTIVATE"],
];

/** `0x…` and the named bits that are set, e.g. "0x94000000 WS_POPUP|WS_VISIBLE|WS_DISABLED". */
export function styleText(value: number, extended = false): string {
  const bits = (extended ? exStyleBits : styleBits).filter(([bit]) => ((value & bit) >>> 0) === bit).map(([, name]) => name);
  return `0x${(value >>> 0).toString(16).padStart(8, "0")}${bits.length ? ` ${bits.join("|")}` : ""}`;
}

const box = (value: Box) => `${value.x},${value.y} ${value.width}×${value.height}`;

/** What the work area leaves of the display on each side (the taskbar's place and size; 0 everywhere: it hides). */
export function taskbarText(display: Pick<ReportDisplay, "bounds" | "workArea">): string {
  const { bounds: b, workArea: w } = display;
  const sides = { top: w.y - b.y, bottom: b.y + b.height - (w.y + w.height), left: w.x - b.x, right: b.x + b.width - (w.x + w.width) };
  const taken = Object.entries(sides).filter(([, size]) => size !== 0);
  return taken.length ? taken.map(([side, size]) => `${side} ${size}`).join(", ") : "none (auto-hide, or none on this display)";
}

/** The text that goes on the clipboard: plain lines, English, the same on every language (it is read by whoever fixes it). */
export function reportText(input: ReportInput, now = new Date()): string {
  const lines = [
    "Jongi-nyang report info (no to-dos, memos or paths)",
    `time: ${now.toISOString()}`,
    `app: ${input.app} · Electron ${input.electron} · Chrome ${input.chrome}`,
    `os: ${input.os} · language ${input.lang}`,
    "",
    `displays (${input.displays.length}):`,
  ];
  for (const display of input.displays) {
    lines.push(`- #${display.id}${display.primary ? " primary" : ""}${display.internal ? " internal" : ""}: bounds ${box(display.bounds)} · work area ${box(display.workArea)} · scale ${display.scaleFactor}${display.rotation ? ` · rotation ${display.rotation}` : ""}`);
    lines.push(`  taskbar: ${taskbarText(display)}`);
  }
  lines.push("", "windows:");
  for (const window of input.windows) {
    if (window.state === "none" || !window.bounds) { lines.push(`- ${window.name}: ${window.state === "none" ? "not open" : "no bounds"}`); continue; }
    const parts = [`${window.state}`, `bounds ${box(window.bounds)}`];
    if (window.contentBounds) parts.push(`content ${box(window.contentBounds)}`);
    if (window.alwaysOnTop !== undefined) parts.push(`on top ${window.alwaysOnTop ? "yes" : "no"}`);
    lines.push(`- ${window.name}: ${parts.join(" · ")}`);
    if (window.style !== undefined) lines.push(`  style ${styleText(window.style)}`);
    if (window.exStyle !== undefined) lines.push(`  ex style ${styleText(window.exStyle, true)}`);
  }
  lines.push("", "gpu:", ...Object.entries(input.gpu).map(([key, value]) => `- ${key}: ${value}`));
  lines.push("", "settings:", ...Object.entries(input.settings).map(([key, value]) => `- ${key}: ${String(value)}`));
  return lines.join("\n") + "\n";
}
