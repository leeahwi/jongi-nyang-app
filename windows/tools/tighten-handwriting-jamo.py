#!/usr/bin/env python3
"""Builds the bundled handwriting fonts from the original Nanum files.

Standalone Hangul jamo (ㄱ, ㅇ, ㅏ …) in Nanum Pen/Brush have a 940-unit advance but only
200–400 units of ink, while finished syllables are ~600 units wide. That leaves wide gaps
between jamo and makes text jump while the input method composes each syllable (ㅇ → 오).
This narrows each jamo to its ink plus a small margin and centres it.

The SIL OFL forbids Modified Versions from using the Reserved Font Name "Nanum", so the
output is renamed. Requires fontTools (build-time only): pip install fonttools
"""
import sys
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "Resources/FontSources"
OUTPUT = ROOT / "assets/fonts"
FONTS = [
    ("NanumPenScript-Regular.ttf", "HanJangPen-Regular.ttf", "HanJang Pen", "한 장 펜", "HanJangPen-Regular"),
    ("NanumBrushScript-Regular.ttf", "HanJangBrush-Regular.ttf", "HanJang Brush", "한 장 붓", "HanJangBrush-Regular"),
]
SIDE_BEARING = 45      # units per side, close to the syllables' own spacing
MINIMUM_ADVANCE = 430  # keeps a lone ㅣ or ㅡ from collapsing


def is_jamo(codepoint: int) -> bool:
    return 0x3131 <= codepoint <= 0x318E or 0x1100 <= codepoint <= 0x11FF or 0xFFA0 <= codepoint <= 0xFFDC


def tighten(font: TTFont) -> int:
    glyf, hmtx = font["glyf"], font["hmtx"]
    changed = 0
    for codepoint, name in font.getBestCmap().items():
        glyph = glyf[name]
        if not is_jamo(codepoint) or glyph.isComposite() or glyph.numberOfContours <= 0:
            continue
        glyph.recalcBounds(glyf)
        ink = glyph.xMax - glyph.xMin
        advance = max(MINIMUM_ADVANCE, ink + 2 * SIDE_BEARING)
        shift = (advance - ink) // 2 - glyph.xMin
        glyph.coordinates.translate((shift, 0))
        glyph.recalcBounds(glyf)
        hmtx[name] = (advance, glyph.xMin)
        changed += 1
    return changed


def rename(font: TTFont, family: str, korean: str, postscript: str) -> None:
    names = font["name"]
    for record in list(names.names):
        if record.nameID in (1, 3, 4, 6, 16, 17, 18):
            names.removeNames(nameID=record.nameID)
    for platform in ((3, 1, 0x409), (1, 0, 0)):
        names.setName(family, 1, *platform)
        names.setName(f"{family} Regular", 4, *platform)
        names.setName(postscript, 6, *platform)
        names.setName(f"{postscript};tightened jamo", 3, *platform)
    names.setName(korean, 1, 3, 1, 0x412)
    names.setName(f"{korean} Regular", 4, 3, 1, 0x412)
    names.setName("Modified from Nanum by NHN Corporation under the SIL Open Font License 1.1: "
                  "narrower standalone jamo for the 한 장 app.", 10, 3, 1, 0x409)


def main() -> int:
    for source, output, family, korean, postscript in FONTS:
        font = TTFont(SOURCES / source)
        if "DSIG" in font:
            del font["DSIG"]  # the original signature no longer matches
        count = tighten(font)
        rename(font, family, korean, postscript)
        font["hhea"].advanceWidthMax = max(width for width, _ in font["hmtx"].metrics.values())
        font.save(OUTPUT / output)
        print(f"{output}: tightened {count} jamo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
