import { keydownCounts, tapThrottle } from "../core/typingCat";
import { paper } from "./api";

/**
 * 치면 두드리는 고양이 (#230 · #289): a key typed in this window tells the typing cat that a key went down — an empty
 * `typingTap`, at most one every 50 ms. The event is turned into a yes/no at once (`keydownCounts`: no repeats, no Ctrl
 * or Windows-key shortcuts, no modifier alone) and goes on unchanged; nothing of the key is kept or sent. The main
 * process decides whether the setting wants it.
 */
export function listenForTyping(): void {
  const api = paper();
  const ok = tapThrottle();
  window.addEventListener("keydown", (event) => {
    if (keydownCounts(event) && ok(performance.now())) void api.act({ type: "typingTap" });
  }, { capture: true, passive: true });
}
