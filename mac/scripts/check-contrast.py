#!/usr/bin/env python3
"""Checks the paper's colour tokens against WCAG 2.1 AA, in day (종이) and night (밤 종이).

Reads the tokens from Sources/PaperTodo/PaperTheme.swift (`token("#day", night: "#night")`), so the
table always shows what the app draws. Each pair is a foreground on a background and a kind:

  text   body text, 4.5:1
  large  large text (handwritten titles ≥ 18 pt) and UI marks (icons, a checkbox's border), 3:1
  note   decorative or a deliberately faint hint: shown, never fails

Every text and UI pair must pass AA in day AND night (exit 1 otherwise) — since 1.37 the day palette
was fixed where it failed: ink3 darker (the old one is `faint`, for marks that aren't text), and
clayText / sageText for clay and sage words. The final table is kept in
night-tokens.md ("Day tokens"), identical in the Windows app.
Usage: scripts/check-contrast.py [--markdown]
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME = os.path.join(ROOT, 'Sources/PaperTodo/PaperTheme.swift')

PAIRS = [
    # (foreground, background, kind, where)
    ('ink', 'paper', 'text', 'titles, rows'),
    ('ink', 'paper2', 'text', 'chips, sidebar'),
    ('ink', 'card', 'text', 'cards, input line'),
    ('ink2', 'paper', 'text', 'secondary text'),
    ('ink2', 'paper2', 'text', 'sidebar labels, chips'),
    ('ink2', 'card', 'text', 'settings rows'),
    ('ink3', 'paper', 'text', 'meta, times, hints'),
    ('ink3', 'paper2', 'text', 'sidebar headers'),
    ('ink3', 'card', 'text', 'card hints'),
    ('sage', 'paper', 'text', 'links on paper'),
    ('sage', 'card', 'text', 'segmented pick'),
    ('sageText', 'paper', 'text', 'eyebrow, sage words'),
    ('sageText', 'sage2', 'text', 'picked chip, pick banner'),
    ('sageText', 'card', 'text', 'sage words on a card'),
    ('onSage', 'sage', 'text', 'primary button'),
    ('clayText', 'paper', 'text', 'late, soon'),
    ('clayText', 'card', 'text', 'late on a card'),
    ('clayText', 'clay2', 'text', 'soon pill, urgent card'),
    ('clay', 'clay2', 'large', 'alarm badge icon'),
    ('clay', 'paper', 'large', 'now line, focus ring (time gone by)'),
    ('clay', 'paper2', 'large', 'focus ring on its track'),
    ('sage', 'paper2', 'large', 'focus ring when the time is up'),
    ('ink', 'sage2', 'text', 'text on a sage tint'),
    ('ink', 'clay2', 'text', 'urgent card'),
    ('ink', 'tabToday', 'text', 'active tab'),
    ('ink', 'tabAhead', 'text', 'active tab'),
    ('ink', 'tabMemo', 'text', 'active tab'),
    # (Tab names and counts are drawn in ink on the tab colours, day and night.)
    ('eventBlue', 'eventTint', 'large', 'event badge icon'),
    ('memoPurple', 'memoTint', 'large', 'memo badge icon'),
    ('toastText', 'toastBack', 'text', 'toast'),
    ('toastAction', 'toastBack', 'text', 'toast action'),
    ('toastKind', 'toastBack', 'text', 'toast kind word'),
    ('checkBorder', 'paper', 'large', 'open checkbox'),
    ('checkBorder', 'paper2', 'large', 'open checkbox on a sunken row'),
    ('checkBorder', 'card', 'large', 'open checkbox in a card'),
    ('sage', 'paper', 'large', 'ticked box, focus ring'),
    ('sage', 'card', 'large', 'task block outline on the day ribbon (1.39)'),
    ('clay', 'card', 'large', 'task block whose time is over (1.39)'),
    ('sage', 'sage2', 'large', 'day ribbon ring: the time gone on its track (1.40)'),
    ('clay', 'clay2', 'large', 'day ribbon ring: the hour before the next thing (1.40)'),
    ('ink2', 'paper', 'large', 'day ribbon ring: the next thing more than an hour away (1.40)'),
    ('sage', 'card', 'large', 'timetable: the grab bar on a to-do block\'s edge (1.41)'),
    ('toastText', 'toastBack', 'text', 'timetable: the time label on a dragged block (1.41)'),
    ('onSage', 'clayText', 'text', 'delete button (clay fill)'),
    ('switchKnob', 'sage', 'note', 'switch knob on (shape, with a shadow)'),
    ('ink', 'raised', 'text', 'selected pane, segmented pick'),
    ('sage', 'raised', 'text', 'segmented pick'),
    ('raised', 'paper2', 'note', 'selected row on the sidebar (decorative)'),
    ('faint', 'paper', 'note', 'decorative marks, disabled glyphs (not text)'),
    ('rule', 'paper', 'note', 'ruled lines (decorative)'),
    ('marginRule', 'paper', 'note', 'the margin line (decorative)'),
    ('paper2', 'paper', 'note', 'sunken areas (decorative)'),
    ('card', 'paper', 'note', 'cards on the sheet (bordered by rule)'),
]


def tokens():
    found = {}
    pattern = re.compile(r'static let (\w+) = token\("(#[0-9a-fA-F]{6})", night: "(#[0-9a-fA-F]{6})"\)')
    for name, day, night in pattern.findall(open(THEME, encoding='utf-8').read()):
        found[name] = (day.lower(), night.lower())
    return found


def luminance(hex_colour):
    value = int(hex_colour[1:], 16)
    channels = [((value >> shift) & 0xFF) / 255 for shift in (16, 8, 0)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def ratio(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


NEED = {'text': 4.5, 'large': 3.0, 'note': 0}

# 하루 일정표 (1.40): an event block is its colour at 14 % over the paper by day (24 % at night, the colour at 85 %
# brightness as PaperTheme.event draws it); its title is ink and its time line ink2 (text).
EVENT_COLOURS = ['#5b8bd0', '#6b8f71', '#d9765f', '#8e7cc3', '#d4a72c', '#8a8a8a']
EVENT_TINT = (0.14, 0.24)


def blend(colour, alpha, paper):
    import colorsys
    c = [int(colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    p = [int(paper[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return '#' + ''.join(f'{round((c[i] * alpha + p[i] * (1 - alpha)) * 255):02x}' for i in range(3))


def night_event(colour):
    import colorsys
    r, g, b = [int(colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    return '#' + ''.join(f'{round(x * 255):02x}' for x in colorsys.hsv_to_rgb(h, s, v * 0.85))


def event_tints(table):
    """(where, day ratio, night ratio) for ink and ink2 on each event tint."""
    out = []
    for colour in EVENT_COLOURS:
        day_bg = blend(colour, EVENT_TINT[0], table['paper'][0])
        night_bg = blend(night_event(colour), EVENT_TINT[1], table['paper'][1])
        for fg in ('ink', 'ink2'):
            out.append((f'{fg} on the {colour} event block (1.40)', ratio(table[fg][0], day_bg), ratio(table[fg][1], night_bg)))
    return out


def main():
    markdown = '--markdown' in sys.argv
    table = tokens()
    missing = sorted({name for pair in PAIRS for name in pair[:2]} - set(table))
    if missing:
        sys.exit(f'Tokens not found in PaperTheme.swift: {", ".join(missing)}')
    failures = []
    rows = []
    for fg, bg, kind, where in PAIRS:
        day = ratio(table[fg][0], table[bg][0])
        night = ratio(table[fg][1], table[bg][1])
        need = NEED[kind]
        day_ok = day >= need
        night_ok = night >= need
        if not night_ok:
            failures.append(f'night {fg} on {bg}: {night:.2f} < {need}')
        if not day_ok:
            failures.append(f'day {fg} on {bg}: {day:.2f} < {need}')
        rows.append((fg, bg, kind, where, day, day_ok, night, night_ok))
    for where, day, night in event_tints(table):
        if day < NEED['text']:
            failures.append(f'day {where}: {day:.2f} < 4.5')
        if night < NEED['text']:
            failures.append(f'night {where}: {night:.2f} < 4.5')
        rows.append(('ink/ink2', 'event tint', 'text', where, day, day >= 4.5, night, night >= 4.5))
    if markdown:
        print('| foreground | background | kind | used for | day | night |')
        print('| --- | --- | --- | --- | --- | --- |')
        for fg, bg, kind, where, day, day_ok, night, night_ok in rows:
            mark = lambda ok, k: '' if k == 'note' else (' ✓' if ok else ' ✗')
            print(f'| {fg} | {bg} | {kind} | {where} | {day:.2f}{mark(day_ok, kind)} | {night:.2f}{mark(night_ok, kind)} |')
    else:
        print(f'{"foreground":<12} {"background":<10} {"kind":<6} {"day":>7} {"night":>7}  used for')
        for fg, bg, kind, where, day, day_ok, night, night_ok in rows:
            mark = lambda ok, k: ' ' if k == 'note' else ('✓' if ok else '✗')
            print(f'{fg:<12} {bg:<10} {kind:<6} {day:6.2f}{mark(day_ok, kind)} {night:6.2f}{mark(night_ok, kind)}  {where}')
        print('\nAA: text 4.5:1, large/UI 3:1, note = decorative (not checked).')
    if failures:
        print('\n'.join(failures))
        print(f'{len(failures)} pair(s) below AA')
        sys.exit(1)
    print(f'Day and night: all {sum(1 for r in rows if r[2] != "note")} checked pairs pass AA.')


if __name__ == '__main__':
    main()
