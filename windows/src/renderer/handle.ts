import { icon, paper } from "./api";

/**
 * 메모 서랍's handle: a paw bookmark at the screen's edge, one pale cream on every paper (1.30). The number of memos
 * changed today is in its tooltip (`메모 서랍 · 오늘 고친 메모 5장`) and its accessible description, not on its face.
 * It peeks 6 more on hover; a click opens the drawer; dragged up or down it moves along the edge (the main process
 * keeps the place). It draws when told and never on its own.
 */
const api = paper();
const handle = document.getElementById("handle")!;
handle.append(icon("pawPrint", 13, 1.8));

interface HandleState { count: number; side: "right" | "left"; look: string; label: string; tip: string; detail: string }

api.on("handle:state", (payload) => {
  const value = payload as HandleState;
  document.documentElement.dataset.look = value.look;
  handle.className = `handle side-${value.side}`;
  handle.setAttribute("aria-label", value.label);
  if (value.detail) handle.setAttribute("aria-description", value.detail);
  else handle.removeAttribute("aria-description");
  handle.title = value.tip;
});

let press: { id: number; y: number; moved: boolean } | undefined;
handle.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  handle.setPointerCapture(event.pointerId);
  press = { id: event.pointerId, y: event.screenY, moved: false };
});
handle.addEventListener("pointermove", (event) => {
  if (!press || press.id !== event.pointerId) return;
  if (!press.moved && Math.abs(event.screenY - press.y) < 4) return;
  press.moved = true;
  handle.classList.add("peek");
  api.send("handle:drag", event.screenY, false);
});
const release = (event: PointerEvent) => {
  if (!press || press.id !== event.pointerId) return;
  const { moved } = press;
  press = undefined;
  handle.classList.remove("peek");
  if (moved) api.send("handle:drag", event.screenY, true);
  else if (event.type === "pointerup") api.send("handle:open");
};
handle.addEventListener("pointerup", release);
handle.addEventListener("pointercancel", release);
handle.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); api.send("handle:open"); } });
