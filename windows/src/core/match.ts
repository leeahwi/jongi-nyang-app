/**
 * The matching under 검색 and the memo drawer's search (편의 기능 8): Korean matches whole syllables or their first
 * consonants (`ㅂㄱㅅ` → 보고서, `보고ㅅ` too); English and Dutch ignore case and accents (`cafe` → Café). On its own so
 * the drawer's search can use it without the note's search (which reads the to-do spaces, and those the drawer's
 * colours).
 */

const initials = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const syllableStart = 0xac00;
const syllableEnd = 0xd7a3;

/** One character folded for comparing: lower case, accents dropped (Hangul syllables stay whole). */
function foldOnce(character: string): string {
  const code = character.codePointAt(0)!;
  if (code >= syllableStart && code <= syllableEnd) return character;
  const plain = character.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return plain.length ? plain : character;
}
/** Each character's fold worked out once (a search folds every letter of every memo). */
const folds = new Map<string, string>();
export function fold(character: string): string {
  let folded = folds.get(character);
  if (folded === undefined) {
    folded = foldOnce(character);
    if (folds.size > 50_000) folds.clear();
    folds.set(character, folded);
  }
  return folded;
}

/** A syllable's first consonant ("보" → "ㅂ"), or undefined for anything else. */
function initialOf(character: string): string | undefined {
  const code = character.codePointAt(0)!;
  if (code < syllableStart || code > syllableEnd) return undefined;
  return initials[Math.floor((code - syllableStart) / 588)];
}

/** A query made ready once for many lines: its characters, their folds, which are lone consonants. */
export interface PreparedQuery { wanted: string[]; folded: string[]; initial: boolean[]; /** No lone consonant: a match is the folds' joined text found in the line's. */ plain: boolean; joined: string }
export function prepareQuery(query: string): PreparedQuery {
  const wanted = [...query.trim()];
  const folded = wanted.map(fold);
  const initial = wanted.map((character) => initials.includes(character));
  return { wanted, folded, initial, plain: !initial.includes(true), joined: folded.join("") };
}

/** Where `query` first stands in `text` ([start, end) in UTF-16 units), or undefined; a blank query matches nothing. */
export function matchRange(text: string, query: string | PreparedQuery): [number, number] | undefined {
  const { wanted, folded, initial } = typeof query === "string" ? prepareQuery(query) : query;
  if (wanted.length === 0) return undefined;
  const characters = [...text];
  // Offsets of each character (astral characters take two units).
  const offsets: number[] = [];
  let offset = 0;
  for (const character of characters) { offsets.push(offset); offset += character.length; }
  offsets.push(offset);
  for (let start = 0; start + wanted.length <= characters.length; start += 1) {
    let index = 0;
    while (index < wanted.length && (fold(characters[start + index]) === folded[index] || (initial[index] && initialOf(characters[start + index]) === wanted[index]))) index += 1;
    if (index === wanted.length) return [offsets[start], offsets[start + wanted.length]];
  }
  return undefined;
}

/** The matched words themselves (tests and the shared cases' notation). */
export function matchText(text: string, query: string): string | undefined {
  const range = matchRange(text, query);
  return range ? text.slice(range[0], range[1]) : undefined;
}
