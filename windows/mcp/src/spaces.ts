import type { Lang } from "../../src/core/lang";
import type { TodoItem } from "../../src/core/notebook";
import { pageOf } from "../../src/core/shelf";
import { findSpace, generalName, generalNames, liveSpaces, spaceColor, spaceOf, type TodoSpaces } from "../../src/core/todoSpaces";
import { Problem } from "./problem";
import type { Ctx, Reply } from "./tools";
import { say } from "./words";

/**
 * 할 일 스페이스 for Claude (N3, docs/plans/mcp-plan.md ‘2c에서 정한 것’): to-dos split into spaces (회사 · 집 · 공부) and
 * 일반, the ones in none. todo-spaces.json is the apps' own file (core/todoSpaces.ts); the extension reads it, puts a
 * new to-do's place there, and moves a to-do after a yes. Spaces are made, renamed and deleted in the app only.
 * The lens (one space shown in the note) is a device setting and doesn't apply here.
 */

/** 일반 as Claude names it in `space`. */
export const generalKey = "general";
/** The app version (ai-link.json's ext) that can undo a move between spaces (N3-8). */
export const movesFromExt = 3;

/** What the task lines and data need of the spaces: the file, 일반's name now, and whether there are any. */
export interface SpaceWords { data: TodoSpaces; general: string; any: boolean }

export function spaceWords(data: TodoSpaces, lang: Lang): SpaceWords {
  return { data, general: generalName(data, lang), any: liveSpaces(data).length > 0 };
}

/** todo-spaces.json for showing (one that doesn't read shows no spaces, like the apps). */
export const spacesNow = (ctx: Ctx): SpaceWords => spaceWords(ctx.folder.loadLoose("todo-spaces.json"), ctx.lang);

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
  const rows = [
    ...liveSpaces(words.data).map((space) => ({ id: space.id, name: space.name, color: spaceColor(space.color) as string | undefined, general: false, ...counted(space.id) })),
    { id: generalKey, name: words.general, color: undefined, general: true, ...counted(null) },
  ];
  const line = (row: (typeof rows)[number]) => `- ${row.name} · ${say(lang, `남은 할 일 ${row.open}개 (오늘 ${row.today}개)`, `${row.open} open (${row.today} today)`, `nog ${row.open} open (${row.today} vandaag)`)} · id ${row.id}`;
  const spaces = rows.length - 1;
  const head = spaces === 0
    ? say(lang, "아직 스페이스가 없어요. 스페이스는 종이냥에서 만들어요.", "No spaces yet. Spaces are made in 종이냥.", "Nog geen ruimtes. Ruimtes maak je in 종이냥.")
    : say(lang, `스페이스 ${spaces}개 (책상의 순서, 맨 끝은 일반)`, `${spaces} ${spaces === 1 ? "space" : "spaces"} (in the desk’s order, ${words.general} last)`, `${spaces} ${spaces === 1 ? "ruimte" : "ruimtes"} (in de volgorde van het bureau, ${words.general} als laatste)`);
  return {
    text: [head, ...rows.map(line)].join("\n"),
    data: { spaces: rows.map(({ color, ...row }) => ({ ...row, ...(color ? { color } : {}) })) },
  };
}
