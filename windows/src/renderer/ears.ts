import { h, paper, reduceMotion, t } from "./api";
import { earPaths, earsHeight, earsWidth, mayTwitch } from "../core/noteEars";

/**
 * 노트 창 위의 고양이 귀 (#151): the drawer's two ears standing on the note's top edge, in their own clear window that
 * follows the note (main/noteEars.ts). Only the ears take the mouse (the window lets everything else through); a press
 * on one, or a to-do finished on the note, twitches an ear — once a second at most, never with reduced motion. They have
 * the header cat's name and tooltip. `#preview` (snapshots) draws the note's picture with its ears instead.
 */
const api = paper();
const ns = "http://www.w3.org/2000/svg";

function earsSvg(held = false): SVGSVGElement {
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "note-ears");
  svg.setAttribute("width", String(earsWidth));
  svg.setAttribute("height", String(earsHeight));
  svg.setAttribute("viewBox", `0 0 ${earsWidth} ${earsHeight}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", t("종이냥 캐릭터"));
  const title = document.createElementNS(ns, "title");
  title.textContent = t("노트 위의 작은 친구, 종이냥");
  svg.append(title);
  earPaths().forEach((ear, index) => {
    const group = document.createElementNS(ns, "g");
    group.setAttribute("class", `one ${index === 0 ? "left" : "right"}${held && index === 0 ? " held" : ""}`);
    // Each ear turns about the middle of its foot (its skew leaves the foot on the edge).
    group.style.transformOrigin = `${(ear.a + ear.b) / 2}px ${earsHeight - 1}px`;
    group.innerHTML = `<path class="ear" d="${ear.ear}"/><path class="ear-edge" d="${ear.sides}"/><path class="ear-in" d="${ear.inner}"/>`;
    svg.append(group);
  });
  return svg;
}

let lastTwitch: number | undefined;
function twitch(svg: SVGSVGElement, index: number): void {
  if (reduceMotion() || !mayTwitch(lastTwitch, Date.now())) return;
  lastTwitch = Date.now();
  const ear = svg.querySelectorAll<SVGGElement>(".one")[index];
  if (!ear) return;
  ear.classList.remove("twitch");
  void ear.getBoundingClientRect();
  ear.classList.add("twitch");
}

if (location.hash === "#preview") {
  document.body.className = "ears-preview";
  /** The note's picture (a data URL) at its size, standing `margin` in, the ears over its top edge at the right. */
  interface Preview { image?: string; width: number; height: number; held?: boolean; strip?: string[] }
  api.on("ears:preview", (payload) => {
    const value = payload as Preview;
    const margin = 24, top = margin + earsHeight - 1;
    if (value.strip) {
      // The ears alone on a row of desktops (their hairline edge on white, paper, grey-blue, night paper, black).
      const strip = h("div", { class: "strip" });
      for (const color of value.strip) {
        const cell = h("div", { style: `background: ${color}` }, h("div", { class: "band" }));
        cell.append(earsSvg());
        strip.append(cell);
      }
      document.body.replaceChildren(strip);
      return;
    }
    const stage = h("div", { class: "stage", style: `width: ${value.width + margin * 2}px; height: ${value.height + top + margin}px` });
    const shot = h("img", { class: "shot", src: value.image ?? "", alt: "", style: `left: ${margin}px; top: ${top}px; width: ${value.width}px; height: ${value.height}px` });
    const svg = earsSvg(value.held);
    svg.style.left = `${margin + value.width - earsWidth}px`;
    svg.style.top = `${margin}px`;
    stage.append(shot, svg);
    document.body.replaceChildren(stage);
  });
} else {
  const svg = earsSvg();
  document.body.append(svg);
  // The window ignores the mouse but hears it move (forwarded): over an ear it takes clicks, off it lets them through.
  for (const [index, path] of [...svg.querySelectorAll<SVGPathElement>(".ear")].entries()) {
    path.addEventListener("pointerenter", () => api.send("ears:interactive", true));
    path.addEventListener("pointerleave", () => api.send("ears:interactive", false));
    path.addEventListener("click", () => twitch(svg, index));
  }
  // A to-do finished on the note: the left ear.
  api.on("ears:twitch", () => twitch(svg, 0));
}
