import type { Lang } from "./lang";

/**
 * 종이냥 펫과 타닥냥의 크기 (#304, docs/plans/cat-size-cases.json — the Mac's CatSize.swift reads the same file): 작게 ·
 * 보통 · 크게 · 아주 크게, chosen apart for each in 책상 → 종이냥. The steps, scales and names are the timer's
 * (timerWidget.ts). 보통 is a scale of 1: the cat as it was before #304, to the pixel.
 */
export type CatSize = "small" | "regular" | "large" | "extraLarge";
export const catSizes: readonly CatSize[] = ["small", "regular", "large", "extraLarge"];
export const catScale: Record<CatSize, number> = { small: 0.8, regular: 1, large: 1.25, extraLarge: 1.5 };
export const catSizeTitles: Record<Lang, Record<CatSize, string>> = {
  ko: { small: "작게", regular: "보통", large: "크게", extraLarge: "아주 크게" },
  en: { small: "Small", regular: "Regular", large: "Large", extraLarge: "Extra large" },
  nl: { small: "Klein", regular: "Normaal", large: "Groot", extraLarge: "Extra groot" },
};

/** As saved (`petSize`, `typingSize`); anything else, or nothing, is 보통. */
export const readCatSize = (saved: unknown): CatSize => catSizes.find((size) => size === saved) ?? "regular";

/** A base size (DIP) at a step, rounded to a whole DIP. */
export const scaledSize = (base: number, size: CatSize): number => Math.round(base * (catScale[size] ?? 1));
