import type { DrawerTheme } from "./memoDrawer";

/**
 * The few colours of each drawer paper that 설정 draws with (#141 · #142): the sample memo under 메모 글꼴 and the paper
 * tiles. The drawer itself takes them from drawer.css; test/drawerPapers.test.ts keeps the two the same.
 */
export type DrawerLook = Exclude<DrawerTheme, "auto">;

export interface PaperSample {
  paper: string; edge: string; card: string; cardEdge: string; ink: string; sub: string; meta: string;
  box: string; check: string; onCheck: string; dark: boolean;
  /** The bookmarks on a tile: the first six folder colours (lavender, pink, mint, yellow, sky, peach). */
  tabs: string[];
}

export const paperSamples: Record<DrawerLook, PaperSample> = {
  day: {
    paper: "#e6dbc3", edge: "#c9bb9b", card: "#fffdf7", cardEdge: "#d0c2a3", ink: "#2a2925", sub: "#42603c", meta: "#646057",
    box: "#8a8374", check: "#5f7a5a", onCheck: "#fffdf8", dark: false, tabs: ["#dcd8f3", "#f2d3d6", "#cfe6d6", "#f3e3a0", "#d6e5f4", "#f6dccb"],
  },
  night: {
    paper: "#1c1a17", edge: "#4a463f", card: "#3d3a34", cardEdge: "#5a554b", ink: "#f6f1e6", sub: "#b3cbad", meta: "#c4bdad",
    box: "#a39d90", check: "#b3cbad", onCheck: "#1f2a1e", dark: true, tabs: ["#5e5888", "#74545a", "#4b6a55", "#716641", "#4a5d78", "#765b49"],
  },
  kraft: {
    paper: "#cdb187", edge: "#a98d63", card: "#fbf6ea", cardEdge: "#a98d63", ink: "#33281d", sub: "#4a3a22", meta: "#54452f",
    box: "#8f7a5a", check: "#5f7f4e", onCheck: "#fbf6ea", dark: false, tabs: ["#f4ecdc", "#e9a38f", "#9cc2a6", "#f1d37a", "#a9c6e3", "#f0b98c"],
  },
  grid: {
    paper: "#dde6f0", edge: "#b3c2d4", card: "#ffffff", cardEdge: "#bccadb", ink: "#1f2a35", sub: "#2f5793", meta: "#57636f",
    box: "#7c8a99", check: "#3f6aa8", onCheck: "#ffffff", dark: false, tabs: ["#e4ebf8", "#f6d6d2", "#d3eadf", "#f6e7b0", "#d6e6f5", "#f8dfca"],
  },
  hanji: {
    paper: "#e9e1d0", edge: "#cdc2ab", card: "#fffcf5", cardEdge: "#d6ccb6", ink: "#2b2925", sub: "#42603c", meta: "#5f5b52",
    box: "#8a8374", check: "#5f7a5a", onCheck: "#fffdf8", dark: false, tabs: ["#dcd8f3", "#f2d3d6", "#cfe6d6", "#f3e3a0", "#d6e5f4", "#f6dccb"],
  },
  sage: {
    paper: "#d9e2cf", edge: "#b2c1a4", card: "#fbfdf7", cardEdge: "#c0ceb3", ink: "#223020", sub: "#355530", meta: "#4b5847",
    box: "#7d8a74", check: "#4f7a4a", onCheck: "#fbfdf7", dark: false, tabs: ["#dcd8f3", "#f2d3d6", "#cfe6d6", "#f3e3a0", "#d6e5f4", "#f6dccb"],
  },
  blossom: {
    paper: "#efd9d5", edge: "#d4b7b1", card: "#fffaf8", cardEdge: "#e0c6c1", ink: "#33262a", sub: "#7a3a42", meta: "#67525a",
    box: "#8f7c80", check: "#5f7a5a", onCheck: "#fffdf8", dark: false, tabs: ["#dcd8f3", "#f2d3d6", "#cfe6d6", "#f3e3a0", "#d6e5f4", "#f6dccb"],
  },
  ink: {
    paper: "#1a2030", edge: "#3d4760", card: "#283146", cardEdge: "#46516b", ink: "#eef1f7", sub: "#a9c7e8", meta: "#b9c1d1",
    box: "#9aa4b8", check: "#a9c7e8", onCheck: "#1a2030", dark: true, tabs: ["#5e5888", "#74545a", "#4b6a55", "#716641", "#4a5d78", "#765b49"],
  },
};

/** The fixed-width face of the drawer's code (drawer.css --d-mono), and with 코드 글꼴 D2Coding (#143). */
export const monoFamily = `"Cascadia Mono", "Cascadia Code", Consolas, ui-monospace, Menlo, monospace`;
export const d2codingFamily = `"D2Coding", ${monoFamily}`;
