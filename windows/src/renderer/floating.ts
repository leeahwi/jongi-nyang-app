import { h, icon, paper, t } from "./api";
import { holdWhileAsked } from "./askGuard";

// #229: a question waiting holds this page up (askGuard.ts).
holdWhileAsked();

const api = paper();
const root = document.getElementById("icon")!;
const lines = root.querySelector(".lines")!;
const caption = root.querySelector(".caption")!;

interface Summary { titles: string[]; remaining: number; total: number }

/** Up to three open tasks in tiny handwriting on ruled lines; empty rules when there are none. */
function render({ titles, remaining, total }: Summary): void {
  const shown = titles.length > 3 ? titles.slice(0, 2) : titles.slice(0, 3);
  const rows: HTMLElement[] = shown.map((title) => h("div", { class: "line" }, h("span", { class: "box" }), h("span", { class: "t" }, title)));
  if (titles.length > 3) rows.push(h("div", { class: "line" }, h("span", { class: "more" }, t("외 {n}개", { n: titles.length - 2 }))));
  while (rows.length < 3) rows.push(h("div", { class: "line" }));
  lines.replaceChildren(...rows);
  // #240 (점검 3의 29): a title too long for its line steps down a size or two before it is cut.
  for (const line of lines.querySelectorAll<HTMLElement>(".t")) {
    for (const size of [10.5, 9.5]) { if (line.scrollWidth <= line.clientWidth) break; line.style.fontSize = `${size}px`; }
  }
  const done = total > 0 && remaining === 0;
  const words = total === 0 ? t("비어 있어요") : done ? t("다 했어요") : t("{count}개 남음", { count: remaining });
  caption.replaceChildren(...(done ? [icon("check", 11, 2.4), " "] : []), words);
  caption.classList.toggle("done", done);
  // The titles whole (the note's lines cut long ones, #240).
  root.title = [words, ...titles.slice(0, 5).map((title) => `· ${title}`), t("클릭해서 열기 · 드래그해서 이동")].join("\n");
  root.setAttribute("aria-label", t("노트 열기, {state}", { state: words }));
}

// Click unfolds the note; dragging past a few pixels moves the icon instead.
let start: { x: number; y: number } | undefined;
let dragging = false;
root.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  root.setPointerCapture(event.pointerId);
  start = { x: event.screenX, y: event.screenY };
  dragging = false;
});
root.addEventListener("pointermove", (event) => {
  if (!start) return;
  if (!dragging && Math.hypot(event.screenX - start.x, event.screenY - start.y) >= 3) {
    dragging = true;
    api.send("floating:drag-start");
  }
  if (dragging) api.send("floating:drag");
});
root.addEventListener("pointerup", () => {
  if (!start) return;
  api.send(dragging ? "floating:drag-end" : "floating:click");
  start = undefined;
  dragging = false;
});
root.addEventListener("contextmenu", (event) => { event.preventDefault(); api.send("floating:menu"); });
root.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") api.send("floating:click"); });

api.on("floating:summary", (summary) => render(summary as Summary));
render({ titles: [], remaining: 0, total: 0 });
