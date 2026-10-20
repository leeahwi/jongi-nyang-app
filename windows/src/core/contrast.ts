/**
 * WCAG 2 contrast between two colours (#rgb or #rrggbb, optionally composited from an rgba over a
 * background), for the token check of 종이 and 밤 종이 (test/contrast.test.ts).
 */

export type RGB = [number, number, number];

export function parseHex(hex: string): RGB {
  const value = hex.trim().replace(/^#/, "");
  const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a colour: ${hex}`);
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as RGB;
}

export const toHex = (rgb: RGB): string => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;

/** `share` of `a` over `b` (CSS color-mix in srgb). */
export const mix = (a: RGB, b: RGB, share: number): RGB => a.map((c, index) => c * share + b[index] * (1 - share)) as RGB;

export function luminance(rgb: RGB): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(foreground: RGB | string, background: RGB | string): number {
  const one = luminance(typeof foreground === "string" ? parseHex(foreground) : foreground);
  const two = luminance(typeof background === "string" ? parseHex(background) : background);
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

/** The custom properties set in a CSS block (`--name: #hex;`), hex values only. */
export function tokensIn(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\b/g)) tokens[match[1]] = match[2];
  return tokens;
}
