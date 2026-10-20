import type { Lang } from "../core/lang";
import { en } from "./en";
import { nl } from "./nl";

/**
 * The app's words outside the core: `t("한국어 원문", vars)`. The Korean text is the key and is
 * shown as it is in Korean; English and Dutch come from en.ts and nl.ts (a test checks that every
 * key used in src/main, src/renderer and the HTML is in both, and that no Hangul is left outside
 * t()). Placeholders: `{name}` is the value; `{name|one|many}` is the word for that count
 * ("{n} {n|to-do|to-dos}"); a third argument picks a reading by context (see tIn). The main process sets the language once at launch (changing it
 * restarts the app); a window takes it from the preload (`paper.lang`) as it loads.
 */
export const tables: Record<Exclude<Lang, "ko">, Record<string, string>> = { en, nl };

let current: Lang = fromPreload() ?? "ko";

function fromPreload(): Lang | undefined {
  const value = (globalThis as { paper?: { lang?: unknown } }).paper?.lang;
  return value === "ko" || value === "en" || value === "nl" ? value : undefined;
}

export function setLang(lang: Lang): void {
  current = lang;
}

/** The language the app speaks now. */
export const lang = (): Lang => current;

export type Vars = Record<string, string | number>;

/** Fills `{name}` and `{name|one|many}` in a text. */
export function fill(text: string, vars: Vars = {}): string {
  return text.replace(/\{(\w+)(?:\|([^|{}]*)\|([^|{}]*))?\}/g, (whole, name: string, one?: string, many?: string) => {
    if (!(name in vars)) return whole;
    if (one === undefined) return String(vars[name]);
    return Number(vars[name]) === 1 ? one : many!;
  });
}

/**
 * The text in a given language. A Korean word that reads differently in English or Dutch depending on
 * where it stands takes a `context`: the tables then have "알림#row" next to "알림".
 */
export function tIn(language: Lang, source: string, vars?: Vars, context?: string): string {
  const table = language === "ko" ? undefined : tables[language];
  const text = !table ? source : (context ? table[`${source}#${context}`] : undefined) ?? table[source] ?? source;
  return fill(text, vars);
}

/** The text in the app's language. */
export function t(source: string, vars?: Vars, context?: string): string {
  return tIn(current, source, vars, context);
}
