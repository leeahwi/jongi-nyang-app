import type { Lang } from "../../src/core/lang";
import type { TodoItem } from "../../src/core/notebook";
import { pageOf } from "../../src/core/shelf";
import { addedHidden, deviceKey, deviceLine, deviceNone, deviceStatus, deviceWords, hiddenSpaces, type DeviceRule, type DeviceRules } from "../../src/core/spaceDevice";
import { findSpace, generalName, generalNames, liveSpaces, spaceColor, spaceOf, type TodoSpaces } from "../../src/core/todoSpaces";
import { Problem } from "./problem";
import type { Ctx, Reply } from "./tools";
import { say } from "./words";

/**
 * 할 일 스페이스 for Claude (N3, docs/plans/mcp-plan.md ‘2c에서 정한 것’): to-dos split into spaces (회사 · 집 · 공부) and
 * 일반, the ones in none. todo-spaces.json is the apps' own file (core/todoSpaces.ts); the extension reads it, puts a
 * new to-do's place there, and moves a to-do after a yes. Spaces are made, renamed and deleted in the app only.
 * The lens (one space shown in the note) and 잠깐 보기 are the note's own and don't apply here. 이 기기에서 (#196) does
 * (N3-9): the app puts it into ai-link.json, and what this device hides now is left out where the note leaves it out.
 */

/** 일반 as Claude names it in `space`. */
export const generalKey = "general";
/** The app version (ai-link.json's ext) that can undo a move between spaces (N3-8). */
export const movesFromExt = 3;

/**
 * What the task lines and data need of the spaces: the file, 일반's name now, whether there are any, this device's
 * 이 기기에서 and what it hides now (live spaces' ids and `none` for 일반, worked out at the call's time — N3-9).
 */
export interface SpaceWords { data: TodoSpaces; general: string; any: boolean; rules: DeviceRules; hidden: ReadonlySet<string> }

export function spaceWords(data: TodoSpaces, lang: Lang, rules: DeviceRules = {}, now = new Date()): SpaceWords {
  return { data, general: generalName(data, lang), any: liveSpaces(data).length > 0, rules, hidden: hiddenSpaces(rules, data, now) };
}

/** todo-spaces.json for showing (one that doesn't read shows no spaces, like the apps). */
export const spacesNow = (ctx: Ctx): SpaceWords => spaceWords(ctx.folder.loadLoose("todo-spaces.json"), ctx.lang, ctx.device, ctx.now);

/** N3-9: this device hides the to-do `id` now (its space, or 일반, is hidden here). */
export const hiddenHere = (words: SpaceWords | undefined, id: string): boolean =>
  Boolean(words && words.hidden.size && words.hidden.has(deviceKey(findSpace(words.data, spaceOf(words.data, id))?.id)));

/** N3-9: "숨김" · "hidden" · "verborgen", the mark 찾기 puts on a to-do this device hides. */
export const hiddenTag = (lang: Lang): string => (lang === "ko" ? deviceWords.hiddenTag.ko : deviceWords.hiddenTag[lang].toLowerCase());

/** A hidden key's name: the space's, or 일반's. */
const keyName = (words: SpaceWords, key: string) => (key === deviceNone ? words.general : findSpace(words.data, key)?.name ?? words.general);

/**
 * N3-9 (D9): what the note's end line says of the to-dos `left` out because this device hides their space — the
 * spaces in the desk's order (일반 last) with how many each has here, and the line "회사는 이 기기에서 숨겨 뒀어요 (할 일
 * 3개)…". Nothing when none was left out.
 */
export function hiddenNote(left: readonly { id: string }[], words: SpaceWords, lang: Lang): { line?: string; data: { space: string; spaceId: string; open: number }[] } {
  if (!left.length) return { data: [] };
  const counts = new Map<string, number>();
  for (const item of left) {
    const key = deviceKey(findSpace(words.data, spaceOf(words.data, item.id))?.id);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const keys = [...liveSpaces(words.data).map((space) => space.id), deviceNone].filter((key) => counts.has(key));
  const total = left.length;
  const said = deviceLine(keys.map((key) => keyName(words, key)), lang);
  const line = say(lang,
    `${said} (할 일 ${total}개). 보려면 그 스페이스를 space로 고르거나 query로 찾아요.`,
    `${said} (${total} ${total === 1 ? "task" : "tasks"}). To see them, pick that space with space, or search with query.`,
    `${said} (${total} ${total === 1 ? "taak" : "taken"}). Kies die ruimte met space of zoek met query om ze te zien.`);
  return { line, data: keys.map((key) => ({ space: keyName(words, key), spaceId: key === deviceNone ? generalKey : key, open: counts.get(key)! })) };
}

/** N3-9 (D12): "회사에 넣었어요 · 이 기기에서는 숨겨져 있어요" when a to-do went where this device hides it; else nothing. */
export function addedHiddenLine(space: string | null, words: SpaceWords, lang: Lang): string | undefined {
  const key = deviceKey(space && findSpace(words.data, space) ? space : undefined);
  return words.hidden.has(key) ? addedHidden(keyName(words, key), lang) : undefined;
}

/** N3-9: a space's 이 기기에서 for list_spaces — none for 보이기, else the desk row's words and the rule's kind. */
function deviceOf(words: SpaceWords, key: string, lang: Lang): { device?: "hide" | "time"; hiddenNow: boolean; status?: string } {
  const rule: DeviceRule | undefined = words.rules[key];
  const hiddenNow = words.hidden.has(key);
  return { ...(rule ? { device: rule.show } : {}), hiddenNow, ...(rule ? { status: deviceStatus(rule, hiddenNow, lang) } : {}) };
}

/** A to-do's space for the line and the data: its live space, or 일반. */
export function taskSpace(words: SpaceWords, id: string): { name: string; id: string; general: boolean } {
  const space = findSpace(words.data, spaceOf(words.data, id));
  return space ? { name: space.name, id: space.id, general: false } : { name: words.general, id: generalKey, general: true };
}

const normal = (text: string) => text.normalize("NFC").trim().toLowerCase();

/** "회사, 집, 공부, 일반": every space in the desk's order, 일반 last. */
const allNames = (words: SpaceWords) => [...liveSpaces(words.data).map((space) => space.name), words.general].join(", ");

/**
 * N3-1 (M24, M25): the space `given` names — a space's exact name (any case) or id, else 일반 by `general` or its name
 * (the renamed one, or 일반 · General · Algemeen); a space comes before 일반 with the same name (S28). No start of a
 * name and no first consonants: Claude names it exactly, so nothing lands in the wrong place. null is 일반. One that
 * names nothing is refused with every space there is.
 */
export function readSpace(given: string | null | undefined, words: SpaceWords, lang: Lang): string | null {
  if (given === null || given === undefined) return null;
  const key = normal(given);
  const spaces = liveSpaces(words.data);
  const found = spaces.find((space) => normal(space.name) === key) ?? spaces.find((space) => space.id.toLowerCase() === key);
  if (found) return found.id;
  if (key === generalKey || generalNames(words.data).some((name) => normal(name) === key) || normal(words.general) === key) return null;
  const names = allNames(words);
  throw new Problem(say(lang,
    `스페이스 ‘${given.trim()}’가 없어요. 있는 스페이스: ${names}. 스페이스는 종이냥에서 만들어요.`,
    `There’s no space ‘${given.trim()}’. The spaces are: ${names}. Spaces are made in 종이냥.`,
    `Er is geen ruimte ‘${given.trim()}’. De ruimtes zijn: ${names}. Ruimtes maak je in 종이냥.`));
}

/** A space's name as the preview says it (일반 by its name now). */
export const spaceName = (words: SpaceWords, id: string | null): string => (id ? findSpace(words.data, id)?.name ?? words.general : words.general);

/** The move refused for an app that can't undo it (N3-8). */
export function oldAppProblem(lang: Lang): Problem {
  return new Problem(say(lang,
    "종이냥 앱이 이 확장보다 옛 판이라 할 일을 다른 스페이스로 옮길 수 없어요. 종이냥을 새 판으로 올려 주세요. 다른 고치기는 할 수 있어요.",
    "종이냥 is older than this extension, so it can’t move tasks between spaces yet. Update 종이냥 first; other changes still work.",
    "종이냥 is ouder dan deze extensie en kan taken nog niet naar een andere ruimte verplaatsen. Werk 종이냥 eerst bij; andere wijzigingen werken wel."));
}

/**
 * N3-3: the spaces in the desk's order and 일반 last — each one's open tasks (today's sheet, ahead and someday) and how
 * many of them are on today's sheet. Made, renamed and deleted in the app only.
 */
export function listSpaces(ctx: Ctx): Reply {
  const { folder, now, lang } = ctx;
  const words = spacesNow(ctx);
  const open = folder.load("todos.json").filter((item: TodoItem) => !item.isCompleted);
  const counted = (id: string | null) => {
    const mine = open.filter((item) => (spaceOf(words.data, item.id) ?? null) === id);
    return { open: mine.length, today: mine.filter((item) => pageOf(item, now) === "today").length };
  };
  // D13: the counts are every to-do, hidden here or not; the row says what this device does with it (N3-9).
  const rows = [
    ...liveSpaces(words.data).map((space) => ({ id: space.id, name: space.name, color: spaceColor(space.color) as string | undefined, general: false, ...counted(space.id), ...deviceOf(words, space.id, lang) })),
    { id: generalKey, name: words.general, color: undefined, general: true, ...counted(null), ...(words.any ? deviceOf(words, deviceNone, lang) : { hiddenNow: false }) },
  ];
  const line = (row: (typeof rows)[number]) => [
    `- ${row.name}`, say(lang, `남은 할 일 ${row.open}개 (오늘 ${row.today}개)`, `${row.open} open (${row.today} today)`, `nog ${row.open} open (${row.today} vandaag)`),
    ...(row.status ? [row.status] : []), `id ${row.id}`,
  ].join(" · ");
  const spaces = rows.length - 1;
  const head = spaces === 0
    ? say(lang, "아직 스페이스가 없어요. 스페이스는 종이냥에서 만들어요.", "No spaces yet. Spaces are made in 종이냥.", "Nog geen ruimtes. Ruimtes maak je in 종이냥.")
    : say(lang, `스페이스 ${spaces}개 (책상의 순서, 맨 끝은 일반)`, `${spaces} ${spaces === 1 ? "space" : "spaces"} (in the desk’s order, ${words.general} last)`, `${spaces} ${spaces === 1 ? "ruimte" : "ruimtes"} (in de volgorde van het bureau, ${words.general} als laatste)`);
  const hidden = rows.filter((row) => row.hiddenNow).length;
  const foot = hidden ? [say(lang,
    "이 기기에서 숨긴 스페이스의 할 일은 get_today · list_todos에 나오지 않아요(앱의 노트처럼). space로 고르거나 query로 찾으면 ‘숨김’을 붙여 보여 줘요. 보이기 · 숨기기는 종이냥에서만 바꿔요.",
    "Tasks in spaces hidden on this device are left out of get_today and list_todos (as the app’s note leaves them out). Picked with space or found with query they show, marked hidden. Showing and hiding are set in 종이냥 only.",
    "Taken in ruimtes die op dit apparaat verborgen zijn, staan niet in get_today en list_todos (zoals in de notitie van de app). Met space gekozen of met query gevonden staan ze er wel, gemarkeerd als verborgen. Tonen en verbergen stel je alleen in 종이냥 in.")] : [];
  return {
    text: [head, ...rows.map(line), ...(foot.length ? ["", ...foot] : [])].join("\n"),
    data: { spaces: rows.map(({ color, ...row }) => ({ ...row, ...(color ? { color } : {}) })) },
  };
}
