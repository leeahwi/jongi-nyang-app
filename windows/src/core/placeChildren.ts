/** What `placeChildren` needs of a DOM node (so the check can run it on a few plain objects). */
export interface PlacedNode<N> {
  readonly nextSibling: N | null;
  remove(): void;
}
export interface PlacedParent<N> {
  readonly firstChild: N | null;
  insertBefore(node: N, before: N | null): unknown;
}

/**
 * #4: `parent`'s children made `nodes` (in that order), moving as few as it can — the memo drawer's list keeps every
 * card that didn't change from one redraw to the next. A child already in its place stays put (the card being typed
 * keeps its focus, caret and measurements); one that moved further down (an edited memo going to the top) is put back
 * when its turn comes; children not in `nodes` go. Returns how many were inserted or moved.
 */
export function placeChildren<N extends PlacedNode<N>>(parent: PlacedParent<N>, nodes: readonly N[]): number {
  const wanted = new Set<N>(nodes);
  let cursor: N | null = parent.firstChild;
  let moved = 0;
  for (const node of nodes) {
    while (cursor && !wanted.has(cursor)) { const gone: N = cursor; cursor = cursor.nextSibling; gone.remove(); }
    if (node === cursor) { cursor = cursor.nextSibling; continue; }
    // The child here moved further down: it is put in its place when its turn comes, and `node`, just after it, stays.
    if (cursor && cursor.nextSibling === node) { cursor = node.nextSibling; continue; }
    parent.insertBefore(node, cursor);
    moved += 1;
  }
  while (cursor) { const gone: N = cursor; cursor = cursor.nextSibling; gone.remove(); }
  return moved;
}
