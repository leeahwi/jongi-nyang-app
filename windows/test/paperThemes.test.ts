import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tokensIn } from "../src/core/contrast";
import { paperSamples } from "../src/core/drawerPapers";
import { colorHex, eventColors, eventMark } from "../src/core/events";
import { readAction } from "../src/core/ipcCheck";
import {
  darkKinds, drawerShown, drawerStored, drawerWrite, nightChoices, noteSamples, paperBackground, paperGrain, paperInk2, paperKinds, paperLabel, paperNames,
  paperRuling, readDrawerChoice, readNightChoice, readPaperKind, shownPaper, themeSourceOf, type NightChoice, type PaperKind,
} from "../src/core/paper";
import { defaultPrefs } from "../src/core/types";
import type { PaperSetting } from "../src/core/desk";
import { tables } from "../src/i18n";

/**
 * 종이 테마 열다섯 가지 (#244): the shared cases (docs/plans/paper-themes-cases.json — the Mac's
 * scripts/test-paper-themes.sh reads the same file) and the colours (docs/plans/paper-themes/tokens.json, the one source:
 * base.css · papers.css · drawer.css and core/paper.ts must hold its values).
 */

const root = path.join(process.cwd(), "..");
const cases = JSON.parse(fs.readFileSync(path.join(root, "docs/plans/paper-themes-cases.json"), "utf8"));
interface TokenPaper {
  key: PaperKind; names: { ko: string; short: string; en: string; nl: string }; scheme: "light" | "dark"; ruling: string; grain: number;
  note: Record<string, string>; eventMarks: Record<string, string>; drawer: { existing?: boolean; palette?: Record<string, string | number>; folders?: string };
}
const tokens: TokenPaper[] = JSON.parse(fs.readFileSync(path.join(root, "docs/plans/paper-themes/tokens.json"), "utf8")).papers;

/** The Mac's setting names in the cases, as this app writes them (settings.json `prefs`). */
const windowsKey: Record<string, string> = {
  "paper.color": "paper", "paper.theme": "paperTheme", "paper.night": "paperNight", "drawer.sameAsNote": "drawerSameAsNote",
  "drawer.theme": "drawerTheme", "drawer.night": "drawerNight", "drawer.nightPaper": "drawerNightPaper",
};
const windowsPrefs = (stored: Record<string, unknown>) => Object.fromEntries(Object.entries(stored).map(([key, value]) => [windowsKey[key] ?? key, value]));

// ─── The list ────────────────────────────────────────────────────────────────

test("papers: fifteen in the shared order, four dark, 밤에는's five choices", () => {
  assert.deepEqual(paperKinds, cases.papers.order);
  assert.deepEqual(paperKinds, tokens.map((paper) => paper.key));
  assert.deepEqual(darkKinds, cases.papers.dark);
  assert.deepEqual(darkKinds, tokens.filter((paper) => paper.scheme === "dark").map((paper) => paper.key));
  assert.deepEqual(nightChoices, cases.papers.nightChoices);
});

test("papers: the names in ko · en · nl are tokens.json's, and t() says each one so in en and nl", () => {
  for (const paper of tokens) {
    assert.deepEqual(paperNames[paper.key], paper.names, paper.key);
    for (const lang of ["en", "nl"] as const) assert.equal(tables[lang][paper.names.ko], paper.names[lang], `${lang} ${paper.names.ko}`);
  }
  for (const [key, names] of Object.entries(cases.papers.names) as [PaperKind, Record<string, string>][]) {
    assert.equal(paperNames[key].ko, names.ko);
    assert.equal(paperNames[key].short, names.short);
    assert.equal(paperNames[key].en, names.en);
    assert.equal(paperNames[key].nl, names.nl);
  }
});

test("papers: ruling and grain are tokens.json's (줄 · 모눈 · 원고지 · 줄노트; 결 none on 메모지 · 모눈 · 줄노트 and the dark papers)", () => {
  const rulings: Record<string, string> = { lines: "lines", grid: "grid", manuscript: "manuscript", margin: "margin" };
  for (const paper of tokens) {
    assert.equal(paperRuling[paper.key], rulings[paper.ruling], paper.key);
    assert.equal(paperGrain[paper.key], paper.grain, paper.key);
  }
});

// ─── R: the paper shown ──────────────────────────────────────────────────────

for (const entry of cases.shown) {
  test(`paper shown: ${entry.case}`, () => {
    const choice = { dayNight: entry.dayNight as PaperSetting, paper: entry.paper as PaperKind, night: entry.night as NightChoice };
    const look = shownPaper(choice, entry.systemDark);
    assert.deepEqual(look, { shown: entry.shown, scheme: entry.scheme, appearance: entry.appearance });
    // Electron's theme, set without asking the system, makes the same lightness: "system" only where the case says so.
    const source = themeSourceOf(choice);
    const dark = source === "system" ? entry.systemDark : source === "dark";
    assert.equal(dark, entry.scheme === "dark", "the system's controls follow the paper shown");
    if (entry.appearance !== "system") assert.equal(source, entry.appearance);
  });
}

test("paper shown: with the theme set outright, the paper shown doesn't depend on Windows (no loop through nativeTheme)", () => {
  for (const dayNight of ["auto", "day", "night"] as const) {
    for (const paper of paperKinds) {
      for (const night of nightChoices) {
        const choice = { dayNight, paper, night };
        if (themeSourceOf(choice) === "system") continue;
        assert.deepEqual(shownPaper(choice, false).shown, shownPaper(choice, true).shown, `${dayNight} ${paper} ${night}`);
      }
    }
  }
});

test("paper shown: the defaults are today's look — 낮 종이 by day, 밤 종이 at night (Q5)", () => {
  const choice = { dayNight: defaultPrefs.paper, paper: defaultPrefs.paperTheme, night: defaultPrefs.paperNight };
  assert.equal(shownPaper(choice, false).shown, "day");
  assert.equal(shownPaper(choice, true).shown, "night");
  assert.equal(themeSourceOf(choice), "system");
});

// ─── D: the drawer ───────────────────────────────────────────────────────────

for (const entry of cases.drawer) {
  test(`drawer paper: ${entry.case}`, () => {
    const note = { dayNight: "auto" as PaperSetting, paper: (entry.note?.paper ?? "day") as PaperKind, night: (entry.note?.night ?? "night") as NightChoice };
    const drawer = { sameAsNote: entry.sameAsNote, paper: (entry.drawerPaper ?? "day") as PaperKind, night: (entry.drawerNight ?? "night") as NightChoice };
    assert.equal(drawerShown(drawer, note, entry.systemDark), entry.shown);
  });
}

// ─── M: moving 1.32's settings over ──────────────────────────────────────────

for (const entry of cases.migrate) {
  test(`moving over: ${entry.case}`, () => {
    if (entry.write) {
      // M7: what is written beside the new keys for an older version.
      const write = windowsPrefs(entry.write) as { drawerTheme: PaperKind; drawerNight: NightChoice };
      assert.deepEqual(windowsPrefs(entry.stored), drawerStored(write.drawerTheme, write.drawerNight));
      return;
    }
    const old = windowsPrefs(entry.old);
    const read = { paper: old.paper ?? defaultPrefs.paper, paperTheme: readPaperKind(old.paperTheme ?? defaultPrefs.paperTheme), paperNight: readNightChoice(old.paperNight ?? defaultPrefs.paperNight), ...readDrawerChoice(old) };
    const expected = windowsPrefs(entry.new);
    for (const [key, value] of Object.entries(expected)) {
      // The drawer's paper is kept as written (`auto` for 낮 종이 + 밤 종이, M1); the cases name the paper.
      const got = key === "drawerTheme" && read.drawerTheme === "auto" ? "day" : read[key as keyof typeof read];
      assert.equal(got, value, key);
    }
    // And nothing on screen changes the first time: the drawer shows what 1.32 showed, by day and at night.
    for (const systemDark of [false, true]) {
      const note = { dayNight: read.paper as PaperSetting, paper: read.paperTheme, night: read.paperNight };
      const theme = old.drawerTheme ?? "auto";
      const oldNight = theme === "auto" || (theme !== "day" && old.drawerNightPaper === true);
      const oldPaper = (theme === "auto" ? "day" : theme) as PaperKind;
      const nightNow = read.paper === "night" || (read.paper === "auto" && systemDark);
      const before = nightNow && oldNight && !darkKinds.includes(oldPaper) ? "night" : oldPaper;
      const after = drawerShown({ sameAsNote: read.drawerSameAsNote, paper: read.drawerTheme === "auto" ? "day" : read.drawerTheme, night: read.drawerNight }, note, systemDark);
      assert.equal(after, before, `systemDark ${systemDark}`);
    }
  });
}

test("moving over: once 1.33 has written the drawer's settings, they are read as written (not moved again)", () => {
  assert.deepEqual(readDrawerChoice({ drawerSameAsNote: false, drawerTheme: "chalk", drawerNight: "keep", drawerNightPaper: false }),
    { drawerSameAsNote: false, drawerTheme: "chalk", drawerNight: "keep", drawerNightPaper: false });
  assert.deepEqual(readDrawerChoice({ drawerSameAsNote: true, drawerTheme: "auto" }), { drawerSameAsNote: true, drawerTheme: "auto", drawerNight: "night", drawerNightPaper: true });
  // 1.32's switch on a paper by name is kept (it was lost on Windows when the settings were read again before).
  assert.deepEqual(readDrawerChoice({ drawerTheme: "kraft", drawerNightPaper: true }), { drawerSameAsNote: false, drawerTheme: "kraft", drawerNight: "night", drawerNightPaper: true });
});

test("moving over: a change to the drawer's paper or 밤에는 writes 1.32's keys beside it", () => {
  assert.deepEqual(drawerWrite({ drawerTheme: "auto", drawerNight: "night" }, "drawerTheme", "memo"), { drawerTheme: "memo", drawerNight: "night", drawerNightPaper: true });
  assert.deepEqual(drawerWrite({ drawerTheme: "memo", drawerNight: "night" }, "drawerTheme", "day"), { drawerTheme: "auto", drawerNight: "night", drawerNightPaper: true });
  assert.deepEqual(drawerWrite({ drawerTheme: "auto", drawerNight: "night" }, "drawerNight", "chalk"), { drawerTheme: "day", drawerNight: "chalk", drawerNightPaper: false });
  assert.deepEqual(drawerWrite({ drawerTheme: "kraft", drawerNight: "keep" }, "drawerNightPaper", true), { drawerTheme: "kraft", drawerNight: "night", drawerNightPaper: true });
});

// ─── S: reading ──────────────────────────────────────────────────────────────

for (const entry of cases.read) {
  test(`reading: ${entry.case}`, () => {
    const stored = windowsPrefs(entry.stored);
    if ("paper" in entry) assert.equal(readPaperKind(stored.paperTheme), entry.paper);
    if ("night" in entry) assert.equal(readNightChoice(stored.paperNight), entry.night);
  });
}

test("reading (S3): a page may only send one of the fifteen, and 밤에는 only 그대로 or a dark paper (ipcCheck.ts)", () => {
  assert.equal(readAction({ type: "setPref", key: "paperTheme", value: 3 }), undefined);
  assert.equal(readAction({ type: "setPref", key: "paperTheme", value: "cork" }), undefined);
  assert.deepEqual(readAction({ type: "setPref", key: "paperTheme", value: "chalk" }), { type: "setPref", key: "paperTheme", value: "chalk" });
  assert.equal(readAction({ type: "setPref", key: "paperNight", value: "kraft" }), undefined);
  assert.deepEqual(readAction({ type: "setPref", key: "paperNight", value: "keep" }), { type: "setPref", key: "paperNight", value: "keep" });
  assert.equal(readAction({ type: "setPref", key: "drawerNight", value: "memo" }), undefined);
  assert.deepEqual(readAction({ type: "setPref", key: "drawerTheme", value: "lined" }), { type: "setPref", key: "drawerTheme", value: "lined" });
  assert.deepEqual(readAction({ type: "setPref", key: "drawerSameAsNote", value: false }), { type: "setPref", key: "drawerSameAsNote", value: false });
});

// ─── W: the widget ───────────────────────────────────────────────────────────

test("widget (W1): the widget takes the paper the notepad and calendar show", () => {
  const entry = cases.widget[0];
  assert.equal(shownPaper({ dayNight: "auto", paper: entry.note.paper, night: entry.note.night }, entry.systemDark).shown, entry.widget);
});

// ─── K: keyboard and Narrator ────────────────────────────────────────────────

test("keyboard (K1): the arrows go through the fifteen in order, round from the last to the first", () => {
  const entry = cases.keyboard[0];
  const step = entry.key === "ArrowRight" || entry.key === "ArrowDown" ? 1 : -1;
  assert.equal(paperKinds[(paperKinds.indexOf(entry.from) + step + paperKinds.length) % paperKinds.length], entry.to);
  assert.equal(paperKinds[(paperKinds.indexOf("chalk") + 1) % paperKinds.length], "day");
});

test("keyboard (K2): Narrator reads the name, light or dark (and the radio's ‘selected’), the same in every language", () => {
  const entry = cases.keyboard[1];
  for (const lang of ["ko", "en", "nl"] as const) assert.equal(paperLabel(entry.paper, lang), entry.label[lang], lang);
  // 설정 says it with t(): the same words.
  for (const lang of ["en", "nl"] as const) {
    assert.equal(tables[lang]["{name}, 밝은 종이"].replace("{name}", paperNames.memo[lang]), entry.label[lang]);
    assert.equal(tables[lang]["{name}, 어두운 종이"].replace("{name}", paperNames.ink[lang]), paperLabel("ink", lang));
  }
});

test("keyboard (K3): under a dark paper 밤에는 is dimmed, with its reason", () => {
  const entry = cases.keyboard[2];
  assert.ok(darkKinds.includes(entry.paper));
  const settings = fs.readFileSync(path.join(process.cwd(), "src/renderer/settings.ts"), "utf8");
  assert.ok(settings.includes(`t("${entry.hint}")`), "설정 says the reason");
  assert.ok(/select\.disabled = true/.test(settings), "the popup is dimmed");
});

// ─── The colours are tokens.json's ───────────────────────────────────────────

/** tokens.json `note` names → base.css · papers.css custom properties. */
const cssName: Record<string, string> = {
  paper: "paper", paper2: "paper-2", card: "card", ink: "ink", ink2: "ink-2", ink3: "ink-3", faint: "faint", rule: "rule",
  sage: "sage", sage2: "sage-2", clay: "clay", clay2: "clay-2", sageText: "sage-text", clayText: "clay-text",
  tabToday: "tab-1", tabAhead: "tab-2", tabTodayEdge: "tab-1-edge", tabAheadEdge: "tab-2-edge", tabMemo: "tab-3", tintToday: "tint-1", tintAhead: "tint-2",
  tapeHoney: "tape-todo", tapeLavender: "tape-memo", tapeSky: "tape-event", tapeMint: "tape-timer", tapeRose: "tape-alarm", tapeNeutral: "tape-confirm",
  tapeHoneyEdge: "tape-todo-edge", tapeLavenderEdge: "tape-memo-edge", tapeSkyEdge: "tape-event-edge", tapeMintEdge: "tape-timer-edge", tapeRoseEdge: "tape-alarm-edge", tapeNeutralEdge: "tape-confirm-edge",
  eventBlue: "event-blue", eventTint: "event-blue-2", memoPurple: "memo-ink", memoTint: "memo-2", toastAction: "toast-action", toastKind: "toast-strong", stamp: "stamp",
  lavenderText: "lavender-text", honeyText: "honey-text", honey2: "honey-2",
  spaceLavender: "band-lavender", spacePink: "band-pink", spaceMint: "band-mint", spaceYellow: "band-yellow", spaceSky: "band-sky", spacePeach: "band-peach", spaceSand: "band-sand", spaceGray: "band-gray",
  onSage: "on-sage", checkBorder: "check-border", tabInk: "tab-ink", raised: "raised", marginRule: "margin-rule",
};
// The rest of tokens.json's note colours are the Mac's own (desk, switchKnob) or written from others here (the toast is ink with paper words).
const notOnWindows = ["desk", "switchKnob", "toastBack", "toastText"];

/** A paper's tokens as the page has them: base.css's :root, then its own block (night in base.css, the rest in papers.css). */
function paperTokens(kind: PaperKind): Record<string, string> {
  const base = fs.readFileSync(path.join(process.cwd(), "src/renderer/base.css"), "utf8");
  const papers = fs.readFileSync(path.join(process.cwd(), "src/renderer/papers.css"), "utf8");
  const day = tokensIn(base.slice(base.indexOf(":root {"), base.indexOf("}", base.indexOf(":root {"))));
  // --raised is var(--card) by day.
  day.raised ??= day.card;
  if (kind === "day") return day;
  const css = kind === "night" ? base : papers;
  const start = css.indexOf(`:root[data-paper="${kind}"] {`);
  assert.ok(start >= 0, `no block for ${kind}`);
  return { ...day, ...tokensIn(css.slice(start, css.indexOf("}", start))) };
}

for (const paper of tokens) {
  test(`colours (C): ${paper.key} — the notepad's tokens, event marks, tile and window colours are tokens.json's`, () => {
    const css = paperTokens(paper.key);
    for (const [name, value] of Object.entries(paper.note)) {
      if (notOnWindows.includes(name)) continue;
      assert.ok(cssName[name], `${name} has a Windows name`);
      assert.equal(css[cssName[name]], value, `--${cssName[name]} (${name})`);
    }
    for (const [color, value] of Object.entries(paper.eventMarks)) assert.equal(css[`ev-${color}`], value, `--ev-${color}`);
    assert.equal(paperBackground[paper.key], paper.note.paper);
    assert.equal(paperInk2[paper.key], paper.note.ink2);
    assert.deepEqual(noteSamples[paper.key], { paper: paper.note.paper, rule: paper.note.rule, margin: paper.note.marginRule, tab: paper.note.tabToday, sage: paper.note.sage, ink: paper.note.ink });
  });
}

test("colours: an event's mark is the paper's own colour for the six, any other colour as it is", () => {
  for (const color of eventColors) assert.equal(eventMark(colorHex(color.value)), `var(--ev-${color.value}, ${color.hex})`);
  assert.equal(eventMark("#D4A72C"), "var(--ev-yellow, #d4a72c)");
  assert.equal(eventMark("#123456"), "#123456");
});

/** tokens.json `drawer.palette` → drawer.css (the seven new papers; the eight before keep their 1.32 colours). */
const drawerName: [string, string][] = [
  ["paper", "d-paper"], ["edge", "d-edge"], ["ink", "d-ink"], ["title", "d-title"], ["label", "d-sub"], ["secondary", "d-preview"], ["preview", "d-peek"],
  ["faint", "d-meta"], ["icon", "d-icon"], ["slip", "d-card"], ["slipEdge", "d-card-edge"], ["check", "d-check"], ["checkOn", "d-on-check"], ["box", "d-box"],
  ["track", "d-bar-track"], ["paw", "d-foot-paw"], ["openLine", "d-open"], ["danger", "d-danger"], ["groupHeader", "d-grp"], ["closeBar", "d-closebar"],
  ["pinTab", "d-pintab"], ["pinTabEdge", "d-pintab-edge"], ["pinTabInk", "d-pintab-ink"],
];
for (const paper of tokens.filter((entry) => entry.drawer.palette)) {
  test(`colours (C3): the drawer's ${paper.key} paper is tokens.json's, its bookmarks ${paper.drawer.folders}'s`, () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/drawer.css"), "utf8");
    const block = (look: string) => {
      const start = css.indexOf(`:root[data-look="${look}"]`);
      assert.ok(start >= 0, `no drawer block for ${look}`);
      const open = css.indexOf("{", start);
      return tokensIn(css.slice(open, css.indexOf("}", open)));
    };
    const drawn = block(paper.key);
    for (const [name, token] of drawerName) assert.equal(drawn[token], paper.drawer.palette![name], `--${token} (${name})`);
    const borrowed = block(paper.drawer.folders!);
    for (const [name, value] of Object.entries(drawn)) if (name.startsWith("c-")) assert.equal(value, borrowed[name], `--${name}`);
    assert.ok(paperSamples[paper.key], "설정 has its tile");
  });
}

test("widget (W1 · #234): the widget draws with the paper shown (its --w-* set reads the page's tokens), dark rules by data-scheme", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/widget.css"), "utf8");
  for (const [own, token] of [["w-paper", "paper"], ["w-ink", "ink"], ["w-sage", "sage"], ["w-clay-2", "clay-2"], ["w-clay-text", "clay-text"]]) {
    assert.ok(new RegExp(`--${own}:\\s*var\\(--${token}\\)`).test(css), `--${own} is the paper's --${token}`);
  }
  assert.ok(!/\[data-paper=/.test(css), "no rule for one paper only");
  assert.ok(/\[data-scheme="dark"\]/.test(css), "the edge and shadow of every dark paper");
  // Its event marks are the paper's too.
  const page = fs.readFileSync(path.join(process.cwd(), "src/renderer/widget.ts"), "utf8");
  assert.ok(!/setProperty\("--color", line\.color\)/.test(page) && /eventMark\(/.test(page), "the widget draws events in the paper's marks");
});
