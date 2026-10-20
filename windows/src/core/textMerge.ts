/**
 * Joins two edits of one memo made on two devices from the same starting text (`base`).
 * Lines changed on only one side take that side; a line both sides changed is merged
 * character by character when the edits don't touch the same spot; text both sides added at
 * the same place keeps both (this device's first); anything else keeps both versions of the
 * lines, so nothing typed is lost. Same steps as the macOS app (TextMerge.swift).
 */
export function mergeText(base: string, ours: string, theirs: string): string {
  if (ours === theirs || theirs === base) return ours;
  if (ours === base) return theirs;
  const lines = (text: string) => text.split("\n");
  const merged = diff3(lines(base), lines(ours), lines(theirs), (o, a, b) => {
    if (o.length === 0) return [...a, ...b];
    const joined = mergeCharacters(o.join("\n"), a.join("\n"), b.join("\n"));
    return joined === undefined ? keepBoth(a, b) : joined.split("\n");
  });
  return (merged ?? keepBoth(lines(ours), lines(theirs))).join("\n");
}

/**
 * Both versions of lines that couldn't be joined: this device's, then the other's lines it
 * doesn't already have, without blank lines when there is any text.
 */
function keepBoth(ours: string[], theirs: string[]): string[] {
  const both = [...ours, ...theirs.filter((line) => !ours.includes(line))];
  const written = both.filter((line) => line.length > 0);
  return written.length > 0 ? written : both;
}

/**
 * Where a caret (a UTF-16 offset, as in a textarea) belongs once `old` became `next`: when the
 * change lies after it, it stays; when before it, it moves along with the text. Same steps as
 * TextMerge.caret in the macOS app.
 */
export function movedCaret(caret: number, old: string, next: string): number {
  let prefix = 0;
  while (prefix < old.length && prefix < next.length && old.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (suffix < old.length - prefix && suffix < next.length - prefix && old.charCodeAt(old.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) suffix += 1;
  if (caret <= prefix) return caret;
  if (caret >= old.length - suffix) return Math.max(0, next.length - (old.length - caret));
  return Math.max(0, Math.min(next.length, caret + next.length - old.length));
}

/** Within lines both sides changed: undefined when they replace the same characters differently. */
function mergeCharacters(base: string, ours: string, theirs: string): string | undefined {
  // Code points, like Swift's unicode scalars, so both apps split text the same way.
  const merged = diff3(Array.from(base), Array.from(ours), Array.from(theirs), (o, a, b) => (o.length === 0 ? [...a, ...b] : undefined));
  return merged?.join("");
}

const same = <T>(x: readonly T[], y: readonly T[]) => x.length === y.length && x.every((value, index) => value === y[index]);

/**
 * Walks the base: stretches kept by both sides stay; between them, the side that changed wins,
 * equal changes count once, and real overlaps go to `conflict` (undefined gives up).
 */
export function diff3<T>(o: readonly T[], a: readonly T[], b: readonly T[], conflict: (o: T[], a: T[], b: T[]) => T[] | undefined): T[] | undefined {
  const inA = matches(o, a);
  const inB = matches(o, b);
  const out: T[] = [];
  let io = 0;
  let ia = 0;
  let ib = 0;
  for (;;) {
    let k = io;
    while (k < o.length && (inA[k] < 0 || inB[k] < 0)) k += 1;
    const ea = k < o.length ? inA[k] : a.length;
    const eb = k < o.length ? inB[k] : b.length;
    const oPart = o.slice(io, k);
    const aPart = a.slice(ia, ea);
    const bPart = b.slice(ib, eb);
    if (same(aPart, oPart)) out.push(...bPart);
    else if (same(bPart, oPart) || same(aPart, bPart)) out.push(...aPart);
    else {
      const resolved = conflict(oPart, aPart, bPart);
      if (resolved === undefined) return undefined;
      out.push(...resolved);
    }
    if (k >= o.length) return out;
    out.push(o[k]);
    io = k + 1;
    ia = ea + 1;
    ib = eb + 1;
  }
}

/**
 * For each element of `o`, where it sits in `x` along a longest common subsequence, or -1.
 * The shared start and end are matched directly; a very long middle is left unmatched.
 */
export function matches<T>(o: readonly T[], x: readonly T[]): number[] {
  const result = new Array<number>(o.length).fill(-1);
  let start = 0;
  while (start < o.length && start < x.length && o[start] === x[start]) { result[start] = start; start += 1; }
  let endO = o.length;
  let endX = x.length;
  while (endO > start && endX > start && o[endO - 1] === x[endX - 1]) { endO -= 1; endX -= 1; result[endO] = endX; }
  const n = endO - start;
  const m = endX - start;
  if (n <= 0 || m <= 0 || n * m > 2_000_000) return result;
  // lengths[i][j]: longest common subsequence of o[start+i..endO) and x[start+j..endX).
  const width = m + 1;
  const lengths = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lengths[i * width + j] = o[start + i] === x[start + j]
        ? lengths[(i + 1) * width + j + 1] + 1
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (o[start + i] === x[start + j]) { result[start + i] = start + j; i += 1; j += 1; }
    else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) i += 1;
    else j += 1;
  }
  return result;
}
