/**
 * 메모 서랍's cat, as one swappable piece. Design B2 (the user's choice, 2026-10-27): no picture on the
 * drawer — its paper is the cat: two ears cut from the same paper stand up from its top edge, toward the
 * screen's edge, with a small pink inner ear. The drawer only places `element` in the paper and calls
 * `setLook`; the shape is here and its colours and place are the cat block in drawer.css.
 */
export interface DrawerCat { element: Element; setLook(look: string): void }

const ns = "http://www.w3.org/2000/svg";

export function drawerCat(): DrawerCat {
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "ears");
  svg.setAttribute("width", "76");
  svg.setAttribute("height", "18");
  svg.setAttribute("viewBox", "0 0 76 18");
  svg.setAttribute("aria-hidden", "true");
  // Each ear: paper (reaching a little below the edge, over the paper's top line), its two cut sides, the pink inside.
  svg.innerHTML = [[0, 16, 30], [44, 60, 76]].map(([left, apex, right]) =>
    `<path class="ear" d="M${left} 17.6 L${apex} 0.6 L${right} 17.6 Z"/>` +
    `<path class="ear-edge" d="M${left} 16.6 L${apex} 0.6 L${right} 16.6"/>` +
    `<path class="ear-in" d="M${apex - 5} 13 L${apex} 5 L${apex + 6} 13 Z"/>`).join("");
  return { element: svg, setLook: () => undefined };
}
