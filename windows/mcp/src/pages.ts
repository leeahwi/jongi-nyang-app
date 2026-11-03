import type { Lang } from "../../src/core/lang";
import { Problem } from "./problem";
import { say } from "./words";

/**
 * Pages (P1, docs/plans/mcp-plan.md): a list tool gives `limit` items (its own default) from `cursor` on, and
 * says when there are more and which cursor goes on. A cursor is where the next page starts, as a number in
 * a string ("50"); the same call with it goes on where the last stopped, so paging to the end sees every
 * item once (M39) while the list stays as it was.
 */

export interface PageArgs { limit?: number; cursor?: string }
export interface Page<T> { shown: T[]; total: number; offset: number; next?: string }

export function page<T>(items: readonly T[], args: PageArgs, fallback: number, max: number, lang: Lang): Page<T> {
  const limit = Math.max(1, Math.min(max, Math.floor(args.limit ?? fallback)));
  const cursor = (args.cursor ?? "").trim();
  if (cursor && !/^\d{1,7}$/.test(cursor)) {
    throw new Problem(say(lang, `cursor ‘${cursor}’를 읽지 못했어요. 앞 답이 알려 준 cursor를 그대로 써 주세요.`, `Couldn’t read the cursor ‘${cursor}’. Use the cursor the last reply gave, as it is.`, `De cursor ‘${cursor}’ is onleesbaar. Gebruik de cursor uit het vorige antwoord zoals hij is.`));
  }
  const offset = cursor ? Number(cursor) : 0;
  const shown = items.slice(offset, offset + limit);
  const end = offset + shown.length;
  return { shown, total: items.length, offset, ...(end < items.length ? { next: String(end) } : {}) };
}

/** "120개 중 1–50번째 · 더 보려면 cursor ‘50’" — undefined when the page is the whole list. */
export function pageNote(page: Page<unknown>, lang: Lang, more?: string): string | undefined {
  if (page.offset === 0 && !page.next) return undefined;
  const range = page.shown.length ? `${page.offset + 1}–${page.offset + page.shown.length}` : "–";
  const head = say(lang, `${page.total}개 중 ${range}번째`, `${range} of ${page.total}`, `${range} van ${page.total}`);
  if (!page.next) return `${head} · ${say(lang, "끝", "the end", "einde")}`;
  return `${head} · ${more ?? say(lang, `더 보려면 cursor ‘${page.next}’`, `more with cursor ‘${page.next}’`, `meer met cursor ‘${page.next}’`)}`;
}
