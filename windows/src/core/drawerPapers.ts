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
  memo: {
    paper: "#eedc84", edge: "#ccbc70", card: "#fffadc", cardEdge: "#d5d0b4", ink: "#2f2914", sub: "#4c644a", meta: "#605630",
    box: "#857844", check: "#577456", onCheck: "#fffadc", dark: false, tabs: ["#dcd8f3", "#f2d3d6", "#cfe6d6", "#f3e3a0", "#d6e5f4", "#f6dccb"],
  },
  manuscript: {
    paper: "#e8e0cf", edge: "#c6bfb1", card: "#fffefb", cardEdge: "#d5d4d0", ink: "#2d2a26", sub: "#50694e", meta: "#686258",
    box: "#8f877a", check: "#5c7a5a", onCheck: "#fffefb", dark: false, tabs: ["#dcd8f3", "#f2d3d6", "#cfe6d6", "#f3e3a0", "#d6e5f4", "#f6dccb"],
  },
  lined: {
    paper: "#d0e1f1", edge: "#b0c0d0", card: "#f8fbff", cardEdge: "#ccd1d8", ink: "#1d2a3a", sub: "#50694e", meta: "#48586c",
    box: "#6e8094", check: "#577456", onCheck: "#f8fbff", dark: false, tabs: ["#dcd8f3", "#f2d3d6", "#cfe6d6", "#f3e3a0", "#d6e5f4", "#f6dccb"],
  },
  lavender: {
    paper: "#ddd4f0", edge: "#bdb5cf", card: "#fcfbff", cardEdge: "#d2d0d7", ink: "#2a2638", sub: "#4c644a", meta: "#5b5574",
    box: "#857e9c", check: "#577456", onCheck: "#fcfbff", dark: false, tabs: ["#dcd8f3", "#f2d3d6", "#cfe6d6", "#f3e3a0", "#d6e5f4", "#f6dccb"],
  },
  recycled: {
    paper: "#d6d5ce", edge: "#b6b6af", card: "#f8f8f5", cardEdge: "#cececb", ink: "#262624", sub: "#485f46", meta: "#55544e",
    box: "#7a7972", check: "#536e51", onCheck: "#f8f8f5", dark: false, tabs: ["#dcd8f3", "#f2d3d6", "#cfe6d6", "#f3e3a0", "#d6e5f4", "#f6dccb"],
  },
  nightsky: {
    paper: "#17142a", edge: "#3e3b4f", card: "#27233f", cardEdge: "#4f4b64", ink: "#efedf9", sub: "#a3c49c", meta: "#b0aacb",
    box: "#8f89b0", check: "#a3c49c", onCheck: "#1f2a1e", dark: true, tabs: ["#5e5888", "#74545a", "#4b6a55", "#716641", "#4a5d78", "#765b49"],
  },
  chalk: {
    paper: "#1b2722", edge: "#414c46", card: "#293832", cardEdge: "#505d57", ink: "#eef3ea", sub: "#a3c49c", meta: "#abb8a9",
    box: "#8b9b8c", check: "#a3c49c", onCheck: "#1f2a1e", dark: true, tabs: ["#5e5888", "#74545a", "#4b6a55", "#716641", "#4a5d78", "#765b49"],
  },

};

/** The fixed-width face of the drawer's code (drawer.css --d-mono), and with 코드 글꼴 D2Coding (#143). */
export const monoFamily = `"Cascadia Mono", "Cascadia Code", Consolas, ui-monospace, Menlo, monospace`;
export const d2codingFamily = `"D2Coding", ${monoFamily}`;
