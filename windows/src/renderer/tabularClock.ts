import { clockTemplate } from "../core/focusTimer";
import { h } from "./api";

/**
 * A running time that never changes width while it counts (1.25): tabular digits, laid over an invisible copy of
 * the widest text of its form — every digit an 8 ("88:88", "8:88:88") — so "10:00" and "09:59" take the same room
 * and nothing beside it moves; it only grows when it passes an hour. (The Mac's TabularClock.)
 */
export class TabularClock {
  readonly element: HTMLElement;
  private readonly size = h("span", { class: "tc-size", "aria-hidden": "true" });
  private readonly shown = h("span", { class: "tc-now" });
  private value = "";

  constructor(className: string, tag: "b" | "div" = "b") {
    this.element = h(tag, { class: `${className} tclock` }, this.size, this.shown);
  }

  get text(): string {
    return this.value;
  }

  set text(next: string) {
    if (next === this.value) return;
    this.value = next;
    this.shown.textContent = next;
    this.fit();
  }

  /** The widest digit of the face it's drawn in ("8" where the digits are tabular, as they should be). */
  private widest?: string;

  private fit(): void {
    if (!this.widest && this.element.isConnected) {
      const style = getComputedStyle(this.shown);
      const context = document.createElement("canvas").getContext("2d");
      if (context) {
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        let best = 0;
        for (const digit of "0123456789") {
          const width = context.measureText(digit).width;
          if (width > best + 0.01) { best = width; this.widest = digit; }
        }
      }
    }
    const template = clockTemplate(this.value, this.widest ?? "8");
    if (this.size.textContent !== template) this.size.textContent = template;
  }
}
