/**
 * Moving through a page's rows with the keyboard (same rules as macOS). One row is selected at a
 * time; the new-task input sits after the rows on 오늘 and before them on 마감 · 나중에.
 */
export type InputPlace = "end" | "start";
export type Step = { id: string } | { input: true } | undefined;

/** ↑ (-1) or ↓ (+1) from the selected row; nothing selected starts at the first (↓) or last (↑) row. */
export function step(ids: readonly string[], selected: string | undefined, direction: 1 | -1, input: InputPlace): Step {
  if (ids.length === 0) return { input: true };
  const index = selected === undefined ? -1 : ids.indexOf(selected);
  if (index < 0) return { id: direction > 0 ? ids[0] : ids[ids.length - 1] };
  const next = index + direction;
  if (next >= 0 && next < ids.length) return { id: ids[next] };
  // Past the last row on 오늘 (or above the first on a shelf) is the new-task input; elsewhere stay put.
  if ((direction > 0 && input === "end") || (direction < 0 && input === "start")) return { input: true };
  return { id: ids[index] };
}

/** ↑ in the empty input under 오늘's rows, or ↓ in the one above a shelf's rows, enters the list. */
export function fromInput(ids: readonly string[], direction: 1 | -1, input: InputPlace): string | undefined {
  if (ids.length === 0) return undefined;
  if (direction < 0 && input === "end") return ids[ids.length - 1];
  if (direction > 0 && input === "start") return ids[0];
  return undefined;
}

/** After a row is deleted the selection moves to the row that took its place (or the one above). */
export function afterRemoval(ids: readonly string[], removed: string): string | undefined {
  const index = ids.indexOf(removed);
  if (index < 0) return undefined;
  return ids[index + 1] ?? ids[index - 1];
}

/** Ctrl+↑ / Ctrl+↓: where the task goes — before the row above, or after the row below. */
export function reorder(ids: readonly string[], id: string, direction: 1 | -1): { targetID: string; after: boolean } | undefined {
  const index = ids.indexOf(id);
  const target = ids[index + direction];
  if (index < 0 || target === undefined) return undefined;
  return { targetID: target, after: direction > 0 };
}
