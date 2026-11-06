import type { PaperSetting } from "./desk";
import type { Lang } from "./lang";

/**
 * 종이 테마 열다섯 가지 (#244, docs/plans/paper-themes.md): the one list of papers the notepad, the desk's calendar,
 * the widget, the slips and the drawer all share — the same keys, order, names and rules as the Mac's
 * PaperCore/PaperKind.swift · PaperLook.swift (docs/plans/paper-themes-cases.json, test/paperThemes.test.ts).
 * The colours are in renderer/base.css · papers.css · drawer.css, the same as docs/plans/paper-themes/tokens.json.
 */

export type PaperKind =
  | "day" | "hanji" | "kraft" | "grid" | "sage" | "blossom" | "memo" | "manuscript" | "lined" | "lavender" | "recycled"
  | "night" | "ink" | "nightsky" | "chalk";

/** The order of the tiles and of the arrow keys: the eleven light papers, then the four dark ones. */
export const paperKinds: PaperKind[] = [
  "day", "hanji", "kraft", "grid", "sage", "blossom", "memo", "manuscript", "lined", "lavender", "recycled",
  "night", "ink", "nightsky", "chalk",
];
/** The dark papers: they stay as they are at night (밤에는 doesn't touch them). */
export const darkKinds: PaperKind[] = ["night", "ink", "nightsky", "chalk"];
export const lightKinds: PaperKind[] = paperKinds.filter((kind) => !darkKinds.includes(kind));
export const isDarkPaper = (kind: PaperKind): boolean => darkKinds.includes(kind);

/** 밤에는: what a light paper turns into at night — 그대로 (keep) or one of the dark papers; 밤 종이 by default. */
export type NightChoice = "keep" | "night" | "ink" | "nightsky" | "chalk";
export const nightChoices: NightChoice[] = ["keep", "night", "ink", "nightsky", "chalk"];

/** A paper as stored: one of the fifteen, anything else (an older or newer key, a number) 낮 종이. */
export const readPaperKind = (value: unknown): PaperKind => ((paperKinds as unknown[]).includes(value) ? value as PaperKind : "day");
/** 밤에는 as stored: anything that isn't 그대로 or a dark paper (a light paper written there, say) is 밤 종이. */
export const readNightChoice = (value: unknown): NightChoice => ((nightChoices as unknown[]).includes(value) ? value as NightChoice : "night");

/** How the notepad's lines are drawn: lines (44 px), 모눈 (11 px squares, four to a row), 원고지 (two rules a row and
 *  22 px columns), 줄노트 (blue lines and a 2 px red margin). */
export type Ruling = "lines" | "grid" | "manuscript" | "margin";
export const paperRuling: Record<PaperKind, Ruling> = {
  day: "lines", hanji: "lines", kraft: "lines", grid: "grid", sage: "lines", blossom: "lines", memo: "lines", manuscript: "manuscript",
  lined: "margin", lavender: "lines", recycled: "lines", night: "lines", ink: "lines", nightsky: "lines", chalk: "lines",
};
/** The paper grain's strength (0 = none): 한지 · 크라프트지 · 재생지 deeper, 메모지 · 모눈 · 줄노트 and the dark papers none. */
export const paperGrain: Record<PaperKind, number> = {
  day: 0.22, hanji: 0.3, kraft: 0.3, grid: 0, sage: 0.18, blossom: 0.18, memo: 0, manuscript: 0.12, lined: 0, lavender: 0.18, recycled: 0.35,
  night: 0, ink: 0, nightsky: 0, chalk: 0,
};

/** The names (ko, the short one for the drawer's ⚙ menu, en, nl) — the same as tokens.json and the Mac's. */
export const paperNames: Record<PaperKind, { ko: string; short: string; en: string; nl: string }> = {
  day: { ko: "낮 종이", short: "낮", en: "Day paper", nl: "Dagpapier" },
  hanji: { ko: "한지", short: "한지", en: "Hanji", nl: "Hanji" },
  kraft: { ko: "크라프트지", short: "크라프트", en: "Kraft paper", nl: "Kraftpapier" },
  grid: { ko: "모눈 노트", short: "모눈", en: "Grid notebook", nl: "Ruitjesschrift" },
  sage: { ko: "쑥색 종이", short: "쑥색", en: "Sage", nl: "Salie" },
  blossom: { ko: "벚꽃 종이", short: "벚꽃", en: "Blossom", nl: "Bloesem" },
  memo: { ko: "노란 메모지", short: "메모지", en: "Sticky note", nl: "Plakbriefje" },
  manuscript: { ko: "원고지", short: "원고지", en: "Manuscript paper", nl: "Manuscriptpapier" },
  lined: { ko: "하늘색 줄노트", short: "줄노트", en: "Blue lined notebook", nl: "Blauw lijntjesschrift" },
  lavender: { ko: "라벤더 종이", short: "라벤더", en: "Lavender", nl: "Lavendel" },
  recycled: { ko: "재생지", short: "재생지", en: "Recycled paper", nl: "Kringlooppapier" },
  night: { ko: "밤 종이", short: "밤", en: "Night paper", nl: "Nachtpapier" },
  ink: { ko: "먹색 종이", short: "먹색", en: "Ink", nl: "Inkt" },
  nightsky: { ko: "밤하늘 종이", short: "밤하늘", en: "Night sky", nl: "Nachthemel" },
  chalk: { ko: "칠판", short: "칠판", en: "Chalkboard", nl: "Schoolbord" },
};
export const paperName = (kind: PaperKind, lang: Lang): string => paperNames[kind][lang];

/** What Narrator · VoiceOver read for a tile: its name and whether it is light or dark (‘선택됨’ comes from the radio). */
export function paperLabel(kind: PaperKind, lang: Lang): string {
  const kindWords = { ko: ["밝은 종이", "어두운 종이"], en: ["light paper", "dark paper"], nl: ["licht papier", "donker papier"] }[lang];
  return `${paperName(kind, lang)}, ${kindWords[isDarkPaper(kind) ? 1 : 0]}`;
}

/** The notepad's paper colour (the window's own background before the page draws; tokens.json `note.paper`). */
export const paperBackground: Record<PaperKind, string> = {
  day: "#fbf9f3", hanji: "#f7f2e7", kraft: "#e9dbc2", grid: "#fbfcfe", sage: "#eff4e9", blossom: "#fcf3f1", memo: "#fcf0b0", manuscript: "#fcfaf5",
  lined: "#eaf3fb", lavender: "#f2eefa", recycled: "#ecebe6", night: "#2a2924", ink: "#1f2636", nightsky: "#1f1c33", chalk: "#23312b",
};
/** Its secondary ink (the desk's − □ × on Windows draw in it; tokens.json `note.ink2`). */
export const paperInk2: Record<PaperKind, string> = {
  day: "#6b685e", hanji: "#5a564d", kraft: "#4f4130", grid: "#4b5865", sage: "#465243", blossom: "#61494e", memo: "#5c522c", manuscript: "#605a51",
  lined: "#435367", lavender: "#565070", recycled: "#4f4e49", night: "#bdb7a7", ink: "#cdd4e2", nightsky: "#cdc8e4", chalk: "#cad4c7",
};

/** A tile's colours (꾸미기 → 종이): the paper, its rule and margin, the 오늘 tab, the sage check and the ink — tokens.json `note`. */
export interface NoteSample { paper: string; rule: string; margin: string; tab: string; sage: string; ink: string }
export const noteSamples: Record<PaperKind, NoteSample> = {
  day: { paper: "#fbf9f3", rule: "#e6e0d2", margin: "#e7d8ce", tab: "#f6dc7c", sage: "#5c7a5a", ink: "#2f2e2a" },
  hanji: { paper: "#f7f2e7", rule: "#e4dccb", margin: "#ead6c9", tab: "#f6dc7c", sage: "#577456", ink: "#2b2925" },
  kraft: { paper: "#e9dbc2", rule: "#d3bf9c", margin: "#d6a98f", tab: "#f6dc7c", sage: "#47653a", ink: "#2e241a" },
  grid: { paper: "#fbfcfe", rule: "#d5dfeb", margin: "#f0d0cc", tab: "#f6dc7c", sage: "#5c7a5a", ink: "#1f2a35" },
  sage: { paper: "#eff4e9", rule: "#d6e0cb", margin: "#e6d3c8", tab: "#f6dc7c", sage: "#4b7446", ink: "#223020" },
  blossom: { paper: "#fcf3f1", rule: "#eedad6", margin: "#e9c3c3", tab: "#f6dc7c", sage: "#577456", ink: "#33262a" },
  memo: { paper: "#fcf0b0", rule: "#ead889", margin: "#efc39a", tab: "#f2c35a", sage: "#577456", ink: "#2f2914" },
  manuscript: { paper: "#fcfaf5", rule: "#eab4a6", margin: "#e39b8a", tab: "#f6dc7c", sage: "#5c7a5a", ink: "#2d2a26" },
  lined: { paper: "#eaf3fb", rule: "#b8cfe6", margin: "#e8a9a9", tab: "#f6dc7c", sage: "#577456", ink: "#1d2a3a" },
  lavender: { paper: "#f2eefa", rule: "#ddd5ef", margin: "#e9cfd8", tab: "#f6dc7c", sage: "#577456", ink: "#2a2638" },
  recycled: { paper: "#ecebe6", rule: "#d5d3cb", margin: "#dbc8c1", tab: "#f6dc7c", sage: "#536e51", ink: "#262624" },
  night: { paper: "#2a2924", rule: "#3e3c34", margin: "#4a3630", tab: "#c4a245", sage: "#a3c49c", ink: "#ece6d6" },
  ink: { paper: "#1f2636", rule: "#343e56", margin: "#4a3a44", tab: "#c4a245", sage: "#a3c49c", ink: "#eef1f7" },
  nightsky: { paper: "#1f1c33", rule: "#332e50", margin: "#4c3650", tab: "#c4a245", sage: "#a3c49c", ink: "#efedf9" },
  chalk: { paper: "#23312b", rule: "#34463e", margin: "#4e3e37", tab: "#c4a245", sage: "#a3c49c", ink: "#eef3ea" },
};

// ─── The paper shown (3-1) ──────────────────────────────────────────────────

/** The three settings: 낮 · 밤 (`paper`, unchanged), 종이 (`paperTheme`) and 밤에는 (`paperNight`). */
export interface PaperChoice { dayNight: PaperSetting; paper: PaperKind; night: NightChoice }

export interface PaperLook {
  /** The paper drawn (`<html data-paper>`). */
  shown: PaperKind;
  /** Its lightness (`<html data-scheme>`): the rules every dark paper shares follow it. */
  scheme: "light" | "dark";
  /** The system's controls (menus, scrollbars, the caret): the system's when it agrees, else the paper's. */
  appearance: "system" | "light" | "dark";
}

/**
 * The paper shown: a dark paper always; a light one by day, and at night (낮 · 밤 on 밤, or 자동 with Windows dark) the
 * paper picked under 밤에는, unless that is 그대로. The system's controls follow the shown paper's lightness.
 */
export function shownPaper(choice: PaperChoice, systemDark: boolean): PaperLook {
  const nightNow = choice.dayNight === "night" || (choice.dayNight === "auto" && systemDark);
  const shown = isDarkPaper(choice.paper) ? choice.paper : nightNow && choice.night !== "keep" ? choice.night : choice.paper;
  const scheme = isDarkPaper(shown) ? "dark" : "light";
  const appearance = choice.dayNight === "auto" && scheme === (systemDark ? "dark" : "light") ? "system" : scheme;
  return { shown, scheme, appearance };
}

/**
 * Electron's `nativeTheme.themeSource` for the settings, without asking the system: "system" only where the paper shown
 * follows Windows (자동, a light paper, 밤에는 not 그대로) — everywhere else the shown paper doesn't depend on the system, so
 * its lightness is set outright. (Asking `shouldUseDarkColors` after forcing a theme would answer the forced one.)
 * The same as `shownPaper(…).appearance` wherever it matters (test/paperThemes.test.ts).
 */
export function themeSourceOf(choice: PaperChoice): "system" | "light" | "dark" {
  if (choice.dayNight === "auto" && !isDarkPaper(choice.paper) && choice.night !== "keep") return "system";
  return shownPaper(choice, false).scheme;
}

// ─── The drawer (6-2, 7) ────────────────────────────────────────────────────

/** 서랍 종이: 노트와 같은 종이 (on by default), or its own paper and 밤에는. */
export interface DrawerChoice { sameAsNote: boolean; paper: PaperKind; night: NightChoice }

/** The drawer's paper drawn: the notepad's shown paper, or its own by the same rule. */
export function drawerShown(drawer: DrawerChoice, note: PaperChoice, systemDark: boolean): PaperKind {
  return drawer.sameAsNote ? shownPaper(note, systemDark).shown : shownPaper({ dayNight: note.dayNight, paper: drawer.paper, night: drawer.night }, systemDark).shown;
}

/** `drawerTheme` as 1.32 wrote it: a paper, or `auto` (낮 종이 with 밤에는 밤 종이로 on). */
export type DrawerTheme = "auto" | PaperKind;
export const drawerThemes: DrawerTheme[] = ["auto", ...paperKinds];
/** A `drawerTheme` as stored (unknown: `auto`). */
export const readDrawerTheme = (value: unknown): DrawerTheme => ((drawerThemes as unknown[]).includes(value) ? value as DrawerTheme : "auto");
/** The drawer's own paper in a `drawerTheme`. */
export const drawerKindOf = (theme: DrawerTheme): PaperKind => (theme === "auto" ? "day" : theme);

/**
 * The old keys, still written for an older version on the same PC (7-2): `drawerTheme` is `auto` for 낮 종이 + 밤 종이
 * (1.30 reads it as following the note), and `drawerNightPaper` is on only when 밤에는 is 밤 종이.
 */
export function drawerStored(paper: PaperKind, night: NightChoice): { drawerTheme: DrawerTheme; drawerNightPaper: boolean } {
  return { drawerTheme: paper === "day" && night === "night" ? "auto" : paper, drawerNightPaper: night === "night" };
}

/** The drawer's settings as stored, read: 1.33's when it wrote them, else moved over once from 1.32's (7-2). */
export interface StoredDrawer { drawerTheme?: unknown; drawerNightPaper?: unknown; drawerSameAsNote?: unknown; drawerNight?: unknown }
export function readDrawerChoice(stored: StoredDrawer): { drawerSameAsNote: boolean; drawerTheme: DrawerTheme; drawerNight: NightChoice; drawerNightPaper: boolean } {
  const theme = readDrawerTheme(stored.drawerTheme);
  // 1.32's switch: `auto` was on; 낮 종이 by name off (1.45's ‘낮 종이’); another paper as written, off when absent.
  const oldNight: NightChoice = theme === "auto" ? "night" : theme === "day" ? "keep" : stored.drawerNightPaper === true ? "night" : "keep";
  if (typeof stored.drawerSameAsNote === "boolean") {
    const night = stored.drawerNight === undefined ? oldNight : readNightChoice(stored.drawerNight);
    return { drawerSameAsNote: stored.drawerSameAsNote, drawerTheme: theme, drawerNight: night, drawerNightPaper: night === "night" };
  }
  // The first time 1.33 reads them: 1.32's default (`auto`) is the notepad's own look — the same paper; anything else
  // was picked for the drawer, so it stays the drawer's own.
  return { drawerSameAsNote: theme === "auto", drawerTheme: theme, drawerNight: oldNight, drawerNightPaper: oldNight === "night" };
}

/**
 * A change to the drawer's own paper or 밤에는 (from 설정, the drawer's ⚙ menu, or 1.32's switch), with the old keys
 * written beside it: what the store keeps for that one setting.
 */
export function drawerWrite(current: { drawerTheme: DrawerTheme; drawerNight: NightChoice }, key: "drawerTheme" | "drawerNight" | "drawerNightPaper", value: unknown): { drawerTheme: DrawerTheme; drawerNight: NightChoice; drawerNightPaper: boolean } {
  let paper = drawerKindOf(current.drawerTheme);
  let night = current.drawerNight;
  if (key === "drawerTheme") {
    const theme = readDrawerTheme(value);
    paper = drawerKindOf(theme);
    if (theme === "auto") night = "night";
  } else if (key === "drawerNight") night = readNightChoice(value);
  else night = value === true ? "night" : "keep";
  return { ...drawerStored(paper, night), drawerNight: night };
}
