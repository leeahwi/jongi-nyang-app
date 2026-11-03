/**
 * Short ids (P1, docs/plans/mcp-plan.md): items go out to Claude with the first 8 characters of their id,
 * upper-cased — longer only where two ids of the same file share those 8, so a short id always names one
 * item. Coming back, the whole id or any start of it of 8 characters or more is taken when it names one
 * item; a start that fits several is refused with the candidates (M40). Case doesn't matter.
 */

export const shortLength = 8;

const keyOf = (id: string): string => id.trim().toUpperCase();

/** How many characters `a` and `b` start with in common. */
function common(a: string, b: string): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}

export type Found = { id: string } | { candidates: string[] } | undefined;

export class Ids {
  private readonly shorts = new Map<string, string>();
  private readonly keys: [string, string][];

  constructor(ids: Iterable<string>) {
    this.keys = [...new Set(ids)].map((id): [string, string] => [keyOf(id), id]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    this.keys.forEach(([key, id], index) => {
      const before = index > 0 ? common(key, this.keys[index - 1][0]) : 0;
      const after = index + 1 < this.keys.length ? common(key, this.keys[index + 1][0]) : 0;
      this.shorts.set(id, key.slice(0, Math.max(shortLength, before + 1, after + 1)));
    });
  }

  /** The id as Claude sees it. */
  short(id: string): string { return this.shorts.get(id) ?? keyOf(id).slice(0, shortLength); }

  /** The item a given id names: its whole id, or a start of 8 characters or more fitting one item. */
  find(given: string): Found {
    const key = keyOf(given);
    if (!key) return undefined;
    const exact = this.keys.find(([candidate]) => candidate === key);
    if (exact) return { id: exact[1] };
    if (key.length < shortLength) return undefined;
    const fits = this.keys.filter(([candidate]) => candidate.startsWith(key)).map(([, id]) => id);
    if (fits.length === 1) return { id: fits[0] };
    return fits.length ? { candidates: fits } : undefined;
  }
}
