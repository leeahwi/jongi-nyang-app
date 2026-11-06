import { paper } from "./api";

/**
 * #229: while a question waits (main/confirm.ts tells every page, "slip:asking"), this page takes no clicks or keys — as a
 * question holds up the Mac app — and a press here brings the question forward, shakes it once and beeps once
 * (`slipBlocked`). Called first by every page a question holds up (core/slipMove.ts `heldPages`): it listens on the window
 * in the capture phase, before anything of the page's own.
 */
export function holdWhileAsked(): void {
  let asking = false;
  paper().on("slip:asking", (on) => { asking = on === true; });
  const hold = (event: Event) => {
    if (!asking) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const type of ["mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "pointerup", "dragstart", "keydown", "keyup", "keypress"]) {
    window.addEventListener(type, hold, true);
  }
  window.addEventListener("pointerdown", (event) => {
    if (!asking) return;
    hold(event);
    void paper().act({ type: "slipBlocked" });
  }, true);
}
