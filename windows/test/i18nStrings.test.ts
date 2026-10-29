import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fill, t, tIn, tables } from "../src/i18n";

/**
 * Every word the windows show goes through t() with its Korean text as the key, and English and
 * Dutch have it. This reads the sources: Hangul left in a string (or a regex) outside t() fails
 * the test unless its line says `i18n-ok` (a file name, a regex about Korean); a t() key missing
 * from en.ts or nl.ts fails it, and so does a table entry nobody uses.
 */

const root = process.cwd();
const hangul = /[가-힣]/;

interface Literal { value: string; start: number; quote: string; key: boolean }

/** The string literals of a TypeScript file (comments skipped), and where Hangul sits in plain code or a regex. */
export function lex(source: string): { literals: Literal[]; bare: number[] } {
  const literals: Literal[] = [];
  const bare: number[] = [];
  let i = 0;
  const isKey = (start: number) => /(^|[^\w.$])t\(\s*$/.test(source.slice(Math.max(0, start - 40), start));
  const regexAllowed = () => {
    let j = i - 1;
    while (j >= 0 && /\s/.test(source[j])) j -= 1;
    return j < 0 || /[(,=:[!&|?{};+\-*%<>~^]/.test(source[j]) || /\breturn$/.test(source.slice(Math.max(0, j - 6), j + 1));
  };
  const code = (stopAtBrace: boolean): void => {
    let depth = 0;
    while (i < source.length) {
      const c = source[i], next = source[i + 1];
      if (c === "/" && next === "/") { while (i < source.length && source[i] !== "\n") i += 1; continue; }
      if (c === "/" && next === "*") { const end = source.indexOf("*/", i + 2); i = end < 0 ? source.length : end + 2; continue; }
      if (c === '"' || c === "'") { string(c); continue; }
      if (c === "`") { template(); continue; }
      if (c === "/" && regexAllowed()) { regex(); continue; }
      if (c === "{") depth += 1;
      if (c === "}") {
        if (stopAtBrace && depth === 0) { i += 1; return; }
        depth -= 1;
      }
      if (hangul.test(c)) bare.push(i);
      i += 1;
    }
  };
  const regex = () => {
    const start = i;
    i += 1;
    let inClass = false;
    while (i < source.length) {
      const c = source[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "\n") break;
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) { i += 1; break; }
      i += 1;
    }
    while (/[a-z]/.test(source[i] ?? "")) i += 1;
    for (let index = start; index < i; index += 1) if (hangul.test(source[index])) bare.push(index);
  };
  const escapes: Record<string, string> = { n: "\n", t: "\t", r: "\r", "0": "\0" };
  const string = (quote: string) => {
    const start = i;
    i += 1;
    let value = "";
    while (i < source.length && source[i] !== quote) {
      if (source[i] === "\\") {
        const escaped = source[i + 1];
        if (escaped === "u") { value += String.fromCharCode(parseInt(source.slice(i + 2, i + 6), 16)); i += 6; continue; }
        value += escapes[escaped] ?? escaped;
        i += 2;
        continue;
      }
      value += source[i];
      i += 1;
    }
    i += 1;
    literals.push({ value, start, quote, key: isKey(start) });
  };
  const template = () => {
    const start = i;
    i += 1;
    let value = "";
    while (i < source.length && source[i] !== "`") {
      if (source[i] === "\\") { value += source[i + 1]; i += 2; continue; }
      if (source[i] === "$" && source[i + 1] === "{") { i += 2; code(true); value += "${}"; continue; }
      value += source[i];
      i += 1;
    }
    i += 1;
    literals.push({ value, start, quote: "`", key: isKey(start) });
  };
  code(false);
  return { literals, bare };
}

function sourceFiles(): string[] {
  const list = (directory: string, extension: string) => fs.readdirSync(path.join(root, directory)).filter((name) => name.endsWith(extension)).map((name) => path.join(directory, name));
  return [...list("src/main", ".ts"), ...list("src/renderer", ".ts"), "src/preload.ts"];
}

const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;
const lineText = (source: string, index: number) => source.split("\n")[lineOf(source, index) - 1];

/** Every t() key in the TypeScript sources, and every Hangul string outside one. */
function scanSources(): { keys: Map<string, string>; problems: string[] } {
  const keys = new Map<string, string>();
  const problems: string[] = [];
  for (const file of sourceFiles()) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const { literals, bare } = lex(source);
    for (const literal of literals) {
      const where = `${file}:${lineOf(source, literal.start)}`;
      if (literal.key) {
        if (literal.quote === "`") problems.push(`${where}: t() takes a plain string, not a template: ${literal.value.slice(0, 50)}`);
        else keys.set(literal.value, where);
        continue;
      }
      if (hangul.test(literal.value) && !lineText(source, literal.start).includes("i18n-ok")) problems.push(`${where}: Hangul outside t(): ${JSON.stringify(literal.value.slice(0, 60))}`);
    }
    for (const index of bare) {
      if (!lineText(source, index).includes("i18n-ok")) problems.push(`${file}:${lineOf(source, index)}: Hangul in code: ${lineText(source, index).trim().slice(0, 60)}`);
    }
  }
  return { keys, problems: [...new Set(problems)] };
}

/** The Korean words in the HTML pages (the title, text and labels), which api.ts puts through t() as the page loads. */
function htmlKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const name of fs.readdirSync(path.join(root, "src/renderer")).filter((entry) => entry.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(root, "src/renderer", name), "utf8");
    for (const match of html.matchAll(/>([^<>]+)</g)) {
      const text = match[1].trim();
      if (hangul.test(text)) keys.set(text, `src/renderer/${name}`);
    }
    for (const match of html.matchAll(/\s(?:title|aria-label|placeholder|alt)="([^"]*)"/g)) {
      if (hangul.test(match[1])) keys.set(match[1], `src/renderer/${name}`);
    }
  }
  return keys;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const pluralNames = (text: string) => [...text.matchAll(/\{(\w+)\|[^|{}]*\|[^|{}]*\}/g)].map((match) => match[1]);

test("i18n: no Hangul outside t() in the main process, the windows and the preload", () => {
  const { problems } = scanSources();
  assert.deepEqual(problems, []);
});

test("i18n: every key used has English and Dutch, with the same placeholders, and every entry is used", () => {
  const { keys } = scanSources();
  for (const [key, where] of htmlKeys()) keys.set(key, where);
  assert.ok(keys.size > 300, `only ${keys.size} keys found: the scan is broken`);
  for (const lang of ["en", "nl"] as const) {
    const table = tables[lang];
    const missing = [...keys].filter(([key]) => table[key] === undefined).map(([key, where]) => `${where}: ${JSON.stringify(key)}`);
    assert.deepEqual(missing, [], `${lang}: ${missing.length} missing`);
    // "알림#row": a reading of "알림" picked by t()'s context argument.
    const unused = Object.keys(table).filter((key) => !keys.has(key.split("#")[0]));
    assert.deepEqual(unused, [], `${lang}: entries no code uses`);
    for (const [key] of keys) {
      const text = table[key];
      for (const variant of Object.keys(table).filter((entry) => entry.startsWith(`${key}#`))) assert.deepEqual(placeholders(table[variant]), placeholders(key), `${lang} ${variant}`);
      // Every value the Korean shows is shown; a translation may add a plural word for a count it was given.
      assert.deepEqual(placeholders(text), placeholders(key), `${lang} ${JSON.stringify(key)} → ${JSON.stringify(text)}`);
      assert.deepEqual(pluralNames(key), [], `the Korean key has no plural forms: ${key}`);
    }
  }
});

test("i18n: t() fills values and plural words, and Korean is the key itself", () => {
  assert.equal(fill("{n} {n|day|days} left", { n: 1 }), "1 day left");
  assert.equal(fill("{n} {n|day|days} left", { n: 3 }), "3 days left");
  assert.equal(fill("{missing} stays", {}), "{missing} stays");
  assert.equal(t("{count}개 남음", { count: 3 }), "3개 남음"); // tests run in Korean
  assert.equal(tIn("en", "{count}개 남음", { count: 1 }), "1 left");
  assert.equal(tIn("nl", "할 일 {n}", { n: 2 }), "Taak 2");
  // (1.30: the history's "지금까지 {n}개를 끝냈어요" is gone — its first tile says the number.)
  assert.equal(tIn("en", "{n}번 집중", { n: 3 }), "3 sessions");
  assert.equal(tIn("nl", "{n}번 집중", { n: 1 }), "1 sessie");
});

test("i18n: the scanner itself sees through comments, regexes and templates", () => {
  const sample = [
    'const a = t("하나"); // 주석은 괜찮아요',
    "/* 이것도 */ const b = \"둘\";",
    "const c = `셋 ${t(\"넷\")}`;",
    "const d = /[가-힣]/.test(x);",
    'const e = "http://example.com" + "다섯"; // i18n-ok',
    "const f = x / 2; const g = 'six';",
  ].join("\n");
  const { literals, bare } = lex(sample);
  const korean = literals.filter((literal) => hangul.test(literal.value));
  assert.deepEqual(korean.map((literal) => [literal.value, literal.key]), [["하나", true], ["둘", false], ["넷", true], ["셋 ${}", false], ["다섯", false]]);
  assert.equal(bare.length, 2); // 가 and 힣 in the regex
  assert.ok(literals.some((literal) => literal.value === "six"));
});
