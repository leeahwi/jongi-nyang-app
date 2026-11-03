import { pageOfPane, readPane, type DeskPage } from "../core/desk";
import { paper } from "./api";

/**
 * Whether a desk page is in sight: the desk shown (not hidden or minimized) and its pane in front. Out of sight, a
 * change only marks the page stale; `catchUp` runs once when it comes back into sight (#79), or when `flush` is
 * asked for something that needs the page as it is now. A page in a window of its own is always in front.
 */
export interface PaneSight {
  /** Runs `draw` now when in sight; otherwise marks the page stale. */
  draw(draw: () => void): void;
  /** Catches up at once when stale (in sight or not). */
  flush(): void;
}

export function paneSight(page: DeskPage, catchUp: () => void): PaneSight {
  // A pane's frame is made when the pane is chosen: in front at first.
  let front = true;
  let stale = false;
  const seen = () => front && !document.hidden;
  const flush = () => { if (stale) { stale = false; catchUp(); } };
  const look = () => { if (seen()) flush(); };
  document.addEventListener("visibilitychange", look);
  paper().on("desk:pane", (payload) => {
    const pane = readPane((payload as { pane?: unknown } | undefined)?.pane);
    if (pane) front = pageOfPane(pane) === page;
    look();
  });
  return {
    draw: (draw) => { if (seen()) { stale = false; draw(); } else stale = true; },
    flush,
  };
}
