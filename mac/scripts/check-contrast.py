#!/usr/bin/env python3
"""Checks the paper's colour tokens against WCAG 2.1 AA on every paper (#244: the fifteen of NotePalette.swift).

Reads the colours from Sources/PaperTodo/NotePalette.swift (`static let kraft = NotePalette(… ink: pair("#hex") …)`), so
the table always shows what the app draws, and checks each value is docs/plans/paper-themes/tokens.json's (the one colour
source both apps are checked against). 낮 종이 and 밤 종이 are the day and night columns below, as before #244. Each pair is a foreground on a background and a kind:

  text   body text, 4.5:1
  large  large text (handwritten titles ≥ 18 pt) and UI marks (icons, a checkbox's border), 3:1
  note   decorative or a deliberately faint hint: shown, never fails

Every text and UI pair must pass AA in day AND night (exit 1 otherwise) — since 1.37 the day palette
was fixed where it failed: ink3 darker (the old one is `faint`, for marks that aren't text), and
clayText / sageText for clay and sage words. The final table is kept in
night-tokens.md ("Day tokens"), identical in the Windows app.
Usage: scripts/check-contrast.py [--markdown]
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# #244: every paper's note colours (one `static let <paper> = NotePalette(` block each, `name: pair("#hex")`).
NOTE = os.path.join(ROOT, 'Sources/PaperTodo/NotePalette.swift')
TOKENS_JSON = os.path.join(os.path.dirname(ROOT), 'docs/plans/paper-themes/tokens.json')
SPACE_COLOURS = ['Lavender', 'Pink', 'Mint', 'Yellow', 'Sky', 'Peach', 'Sand', 'Gray']

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
    ('sageText', 'sage2', 'text', 'picked chip, pick banner, the list row\'s 지금 · 다음 mark (#31)'),
    ('sageText', 'card', 'text', 'sage words on a card'),
    ('onSage', 'sage', 'text', 'primary button'),
    ('onSage', 'spaceLavender', 'large', '저녁 정리: the → in a picked round pick (#32; the pick itself is the lavender band on paper and card)'),
    ('clayText', 'paper', 'text', 'late, soon'),
    ('clayText', 'card', 'text', 'late on a card'),
    # 1.45 (#29): every text colour on all three surfaces, as the Windows app's test/contrast.test.ts checks them.
    ('sageText', 'paper2', 'text', 'sage words on a sunken row or chip (1.45)'),
    ('clayText', 'paper2', 'text', 'late on a sunken row (1.45)'),
    ('clayText', 'clay2', 'text', 'soon pill, urgent card'),
    ('clay', 'clay2', 'large', 'alarm badge icon'),
    ('clay', 'paper', 'large', 'now line, focus ring (time gone by)'),
    ('clay', 'paper2', 'large', 'focus ring on its track'),
    ('sage', 'paper2', 'large', 'focus ring when the time is up'),
    ('ink', 'sage2', 'text', 'text on a sage tint'),
    ('ink', 'clay2', 'text', 'urgent card'),
    ('tabInk', 'tabToday', 'text', '오늘 tab: name and count, picked or not (1.45)'),
    ('tabInk', 'tabAhead', 'text', '앞으로 tab: name and count, picked or not (1.45)'),
    # (1.45: the tabs are solid and lighter at night, so their names are in tabInk — dark ink at night too.
    # The tabs' old colours live on as tint* under ink: the settings panes' icon tiles and the help's groups.)
    ('tabTodayEdge', 'paper', 'note', '오늘 tab edge, 1 pt (decorative, 1.45)'),
    ('tabAheadEdge', 'paper', 'note', '앞으로 tab edge, 1 pt (decorative, 1.45)'),
    # (1.45: the slips' tape is solid with a 1 pt edge, like the tabs — a decorative edge, shown, never fails.)
] + [
    (f'tape{name}Edge', f'tape{name}', 'note', f'{name.lower()} tape edge on its tape, 1 pt (decorative, 1.45)')
    for name in ('Honey', 'Lavender', 'Sky', 'Mint', 'Rose', 'Neutral')
] + [
    ('ink', 'tintToday', 'large', '꾸미기 pane icon tiles, 기본 help group icons'),
    ('ink', 'tintAhead', 'large', '알림 · AI 연결 pane icon tiles, 더 알아보기 help group icons'),
    ('ink', 'tabMemo', 'large', '종이냥 pane icon tiles, help group icons'),
    ('ink', 'tintToday', 'text', 'help: the entry number on its 기본 dot (ink 70 %, checked at full ink)'),
    ('ink', 'tintAhead', 'text', 'help: the entry number on its 더 알아보기 dot'),
    ('ink', 'tabMemo', 'text', 'help: the entry number on its 종이냥 dot'),
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
    ('stamp', 'paper', 'text', 'AI stamp on a row Claude touched today (1.42)'),
    ('stamp', 'paper2', 'text', 'AI stamp on a sunken row (1.42)'),
    ('stamp', 'card', 'text', 'AI stamp in a card (1.42)'),
    ('onSage', 'clayText', 'text', 'delete button (clay fill)'),
    ('sageText', 'sage2', 'text', '백업 목록: the 매일 chip (#140)'),
    ('lavenderText', 'memoTint', 'text', '백업 목록: the 업데이트 전 chip (#140)'),
    ('honeyText', 'honey2', 'text', '백업 목록: the 직접 chip (#140)'),
    ('switchKnob', 'sage', 'note', 'switch knob on (shape, with a shadow)'),
    ('ink', 'raised', 'text', 'selected pane, segmented pick'),
    ('sage', 'raised', 'text', 'segmented pick'),
    ('raised', 'paper2', 'note', 'selected row on the sidebar (decorative)'),
    # faint: never text, and no mark one needs to see to use the app — a switched-off stepper's −/+ and a day one can't
    # pick (inactive controls, outside WCAG 1.4.3 and 1.4.11), the drag grips beside rows (the hand cursor and the
    # tooltip say it too). Shown, never fails; a mark that must be seen uses checkBorder (3:1).
    ('faint', 'paper', 'note', 'disabled glyphs, drag grips (inactive or redundant, not text)'),
    ('faint', 'paper2', 'note', 'disabled glyphs on a sunken row (1.45)'),
    ('faint', 'card', 'note', 'disabled stepper −/+ on a card (1.45)'),
    ('desk', 'paper', 'note', 'the desk under the snapshots of slips (snapshots only)'),
    ('rule', 'paper', 'note', 'ruled lines (decorative)'),
    ('marginRule', 'paper', 'note', 'the margin line (decorative)'),
    ('paper2', 'paper', 'note', 'sunken areas (decorative)'),
    ('card', 'paper', 'note', 'cards on the sheet (bordered by rule)'),
] + [
    # 할 일 스페이스 (1.45): the band at a today row's left end (a UI mark, 3:1) on the sheet, and on a card (the
    # popup's and chip's dot on the input line card).
    (f'space{name}', bg, 'large', f'space band: {name.lower()} (1.45)') for name in SPACE_COLOURS for bg in ('paper', 'card')
]


def note_palettes():
    """{paper: {token: hex}} from NotePalette.swift, in its order (the event marks as mark*)."""
    text = open(NOTE, encoding='utf-8').read()
    out = {}
    for paper, block in re.findall(r'static let (\w+) = NotePalette\((.*?)\)\n', text, re.S):
        out[paper] = {k: v.lower() for k, v in re.findall(r'(\w+): pair\("(#[0-9a-fA-F]{6})"\)', block)}
    return out


def tokens():
    """{token: (낮 종이, 밤 종이)} — the note's tokens on the two papers of 1.47 (docs/plans/paper-themes/tokens.py reads this)."""
    papers = note_palettes()
    return {k: (v, papers['night'][k]) for k, v in papers['day'].items() if not k.startswith('mark')}


def luminance(hex_colour):
    value = int(hex_colour[1:], 16)
    channels = [((value >> shift) & 0xFF) / 255 for shift in (16, 8, 0)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def ratio(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


NEED = {'text': 4.5, 'large': 3.0, 'note': 0, 'same': 1.0, 'gain': 0.01}
# #14: a card's preview is the ink at this strength over its sheet (day 0.78, night 0.86 as the mock; kraft and grid a
# little stronger so each paper reads better than the grey before). The Windows app's --d-peek is the same colour.
# #142: 한지 · 쑥색 · 벚꽃 · 먹색, each the first strength (by 0.02) that reads better than its grey.
PREVIEW_INK = {'day': 0.78, 'night': 0.86, 'kraft': 0.84, 'grid': 0.80, 'hanji': 0.80, 'sage': 0.84, 'blossom': 0.82, 'ink': 0.86,
               # #244: the seven new papers, worked out the same way (tokens.json `previewInk`).
               'memo': 0.82, 'manuscript': 0.78, 'lined': 0.82, 'lavender': 0.80, 'recycled': 0.82, 'nightsky': 0.84, 'chalk': 0.84}

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


# 메모 서랍 (1.43): its papers (four, and since #142 eight) are fixed colours in MemoDrawerTheme.swift (`name: pair("#hex")` per palette, and
# the folder colours' table). Each pair must pass in every paper.
DRAWER = os.path.join(ROOT, 'Sources/PaperTodo/MemoDrawerTheme.swift')
DRAWER_PAIRS = [
    ('ink', 'paper', 'text', 'drawer: text on the paper'),
    ('title', 'paper', 'large', 'drawer: the folder\'s handwritten name'),
    ('label', 'paper', 'text', 'drawer: the small 메모 서랍 line'),
    ('faint', 'paper', 'text', 'drawer: footer'),
    ('icon', 'paper', 'large', 'drawer: header icons'),
    ('ink', 'sheet', 'text', 'memo sheet (B2): memo text'),
    ('secondary', 'sheet', 'text', 'memo sheet: search hints, chips'),
    ('preview', 'sheet', 'text', "memo sheet (#14): a card's preview lines, 13 pt"),
    ('preview', 'slip', 'text', "slip (#14): a search result's line"),
    ('faint', 'sheet', 'text', 'memo sheet: time, 2/4'),
    ('icon', 'sheet', 'large', 'memo sheet: action icons'),
    ('box', 'sheet', 'large', 'memo sheet: open checkbox'),
    ('check', 'sheet', 'large', 'memo sheet: ticked box, progress bar'),
    ('ink', 'slip', 'text', 'slip: memo text'),
    ('secondary', 'slip', 'text', 'slip: preview lines'),
    ('faint', 'slip', 'text', 'slip: time, 2/4'),
    ('placeholder', 'slip', 'text', 'quick-write placeholder'),
    ('icon', 'slip', 'large', 'slip: action icons'),
    ('box', 'slip', 'large', 'slip: open checkbox'),
    ('check', 'slip', 'large', 'slip: ticked box, progress bar'),
    ('checkOn', 'check', 'large', 'slip: tick on its box'),
    ('toastText', 'toast', 'text', 'drawer toast'),
    ('pinTabInk', 'pinTab', 'large', '고정 bookmark: its paw (1.45 solid)'),
    ('pinTabEdge', 'paper', 'note', '고정 bookmark edge, 1 pt (decorative, 1.45)'),
    ('slipEdge', 'paper', 'note', 'slip edge (decorative)'),
    ('sheet', 'paper', 'note', 'a memo sheet against the drawer (decorative, 1.43.1)'),
    # 1.44 (메모 서랍을 더 쉽게)
    ('groupHeader', 'paper', 'text', 'date group header (1.44)'),
    ('faint', 'paper', 'text', 'date group count (1.44)'),
    ('slipEdge', 'sheet', 'note', 'sheet edge, 1 pt (decorative, 1.44)'),
    ('openLine', 'sheet', 'large', 'open memo line, 3 pt, when the folder colour is not used (1.44)'),
    ('secondary', 'chip', 'text', 'kind chip: link, phone, 2/4 (ink 6 % over the sheet, 1.44)'),
    # #240: a checklist's progress inside its chip, and the finished chip ‘✓ 4/4’ in the check colour.
    ('check', 'chip', 'large', 'checklist chip: its progress fill (#240)'),
    ('check', 'chip', 'large', 'checklist chip, all done: its ✓ (#240)'),
    ('ink', 'chip', 'text', 'checklist chip, all done: ‘4/4’ (#240)'),
    ('icon', 'chip', 'large', 'bar pills: icons (1.44)'),
    ('danger', 'chip', 'large', 'bar pills: 지우기 (1.44)'),
    ('faint', 'chip', 'text', 'footer key hint on its box (1.44)'),
    # #135: the link field on its pill (ink 6 % over the sheet): its heading, its keys, 링크 빼기.
    ('label', 'chip', 'text', 'link field heading (#135)'),
    ('faint', 'chip', 'text', 'link field keys (#135)'),
    ('secondary', 'chip', 'text', 'link field 링크 빼기 (#135)'),
    # #117: the quick-write slip's hint: where it goes and its keys.
    ('secondary', 'slip', 'text', 'quick-write hint: where it goes (#117)'),
    # #82: 새 폴더 is an empty bookmark — the sheet's paper, a dashed edge in the open checkbox's colour, the + in the
    # secondary ink (ink on the 6 % hover tint, the same colour as `chip`).
    ('secondary', 'sheet', 'large', 'empty bookmark (새 폴더): its + (#82)'),
    ('ink', 'chip', 'large', 'empty bookmark under the pointer: its + (#82)'),
    ('box', 'sheet', 'large', 'empty bookmark: its dashed edge on its paper (#82)'),
    # #83 · #111: the close bar's line at rest (#164: no longer drawn — the close tab is the handle's cream, see
    # handle_rows); under 바탕 없음 on a sheet-paper pill.
    ('closeBar', 'paper', 'large', 'close bar at rest: a short line (#83, #111)'),
    ('closeBar', 'sheet', 'large', 'close bar on its pill, 바탕 없음 (#83)'),
]

# The folder colours' edge as the open line (DrawerPalette.openLine): scaled toward black (toward white on a dark
# sheet) in 5 % steps until 3:1 on the sheet. Same rule as the Windows app.
SHEET_HEX = {'day': '#fffdf7', 'night': '#3d3a34', 'kraft': '#fbf6ea', 'grid': '#ffffff',
             'hanji': '#fffcf5', 'sage': '#fbfdf7', 'blossom': '#fffaf8', 'ink': '#283146',
             'memo': '#fffadc', 'manuscript': '#fffefb', 'lined': '#f8fbff', 'lavender': '#fcfbff', 'recycled': '#f8f8f5',
             'nightsky': '#27233f', 'chalk': '#293832'}


def open_line(edge, sheet):
    start = [int(edge[i:i + 2], 16) for i in (1, 3, 5)]
    dark = luminance(sheet) < 0.2
    colour = start
    step = 0
    hexed = lambda c: '#' + ''.join(f'{int(v):02x}' for v in c)
    while ratio(hexed(colour), sheet) < 3 and step < 20:
        step += 1
        k = 1 - step * 0.05
        colour = [round(255 - (255 - v) * k) for v in start] if dark else [round(v * k) for v in start]
    return hexed(colour)


# 반투명 / 강하게 (1.44): the drawer paper at 82 % / 62 % over the system's popover material (which itself sits over
# the desktop). The material is approximated by #ececec (light papers) / #2a2a2a (night). Sheets stay opaque.
# #142: the papers (MemoDrawerTheme.swift's Kind), the four of 1.43 and 한지 · 쑥색 · 벚꽃 · 먹색; #244 the seven new ones.
PAPERS = ('day', 'night', 'kraft', 'grid', 'hanji', 'sage', 'blossom', 'ink', 'memo', 'manuscript', 'lined', 'lavender', 'recycled', 'nightsky', 'chalk')
DARK = ('night', 'ink', 'nightsky', 'chalk')
MATERIAL = {paper: '#2a2a2a' if paper in DARK else '#ececec' for paper in PAPERS}
# #244: the new papers' folder colours are 한지's (light) or 먹색 종이's (dark), as MemoDrawerTheme.swift's `folders`.
FOLDERS_FROM = {'memo': 'hanji', 'manuscript': 'hanji', 'lined': 'hanji', 'lavender': 'hanji', 'recycled': 'hanji', 'nightsky': 'ink', 'chalk': 'ink'}
SEE_THROUGH = [('ink', 'text'), ('label', 'text'), ('faint', 'text'), ('secondary', 'text'), ('icon', 'large'),
               ('closeBar', 'large')]  # #83: the close bar on the see-through paper


def drawer_rows():
    """(paper, fg, bg, kind, where, ratio) for every pair in the fifteen papers, plus each folder colour's ink on its bookmark."""
    text = open(DRAWER, encoding='utf-8').read()
    rows = []
    for paper in PAPERS:
        block = re.search(r'static let %s = DrawerPalette\((.*?)scheme:' % paper, text, re.S).group(1)
        colours = {k: v.lower() for k, v in re.findall(r'(\w+): pair\("(#[0-9a-fA-F]{6})"\)', block)}
        tab = re.search(r'pinTab: Color\(drawerHex: "(#[0-9a-fA-F]{6})"\), pinTabEdge: Color\(drawerHex: "(#[0-9a-fA-F]{6})"\)', block)
        colours['pinTab'] = tab.group(1).lower()
        colours['pinTabEdge'] = tab.group(2).lower()
        colours['chip'] = blend(colours['ink'], 0.07 if paper in DARK else 0.06, colours['sheet'])
        for fg, bg, kind, where in DRAWER_PAIRS:
            rows.append((paper, fg, bg, kind, where, ratio(colours[fg], colours[bg])))
        # #14 (option B): the preview is the ink one step lighter over the sheet, and reads better than the grey it replaced.
        made = blend(colours['ink'], PREVIEW_INK[paper], colours['sheet'])
        rows.append((paper, 'preview', f'ink {int(PREVIEW_INK[paper] * 100)}%', 'same', f'preview is the ink at {int(PREVIEW_INK[paper] * 100)} % over the sheet ({made})', 1.0 if made == colours['preview'] else 0.0))
        rows.append((paper, 'preview', 'sheet', 'gain', f'preview vs the old grey (secondary {ratio(colours["secondary"], colours["sheet"]):.2f}), #14',
                     ratio(colours['preview'], colours['sheet']) - ratio(colours['secondary'], colours['sheet'])))
        for alpha, mode in ((0.82, '반투명'), (0.62, '강하게')):
            back = blend(colours['paper'], alpha, MATERIAL[paper])
            for fg, kind in SEE_THROUGH:
                rows.append((paper, fg, f'paper {int(alpha * 100)}%', kind, f'{mode}: on the see-through paper (1.44)', ratio(colours[fg], back)))
        table = re.search(r'^        \.%s: \[(.*?)\]' % FOLDERS_FROM.get(paper, paper), text, re.S | re.M).group(1)
        for name, a, b, ink, edge, tape in re.findall(r'\.(\w+): \("(#\w+)", "(#\w+)", "(#\w+)", "(#\w+)", "(#\w+)"\)', table):
            worst = min(ratio(ink, a), ratio(ink, b))
            rows.append((paper, f'{name} ink', f'{name} tab', 'text', 'drawer: bookmark name / first letter', worst))
            rows.append((paper, f'{name} edge', 'paper', 'note', 'bookmark edge, 1 pt (decorative, 1.44)', ratio(edge, colours['paper'])))
            rows.append((paper, f'{name} line', 'sheet', 'large', 'open memo line in the folder colour (1.44)', ratio(open_line(edge, SHEET_HEX[paper]), colours['sheet'])))
            # #118: the picked card's 2 pt edge (the keyboard's place) is the same line colour, inside the card.
            rows.append((paper, f'{name} picked', 'sheet', 'large', 'picked memo edge, 2 pt in the folder colour (#118)', ratio(open_line(edge, SHEET_HEX[paper]), colours['sheet'])))
        # #244: the seven new papers' colours are tokens.json's `drawer.palette`.
        source = TOKENS_BY_KEY.get(paper, {}).get('drawer', {}).get('palette')
        if source:
            different = [f'{k} {colours.get(k)} ≠ {v}' for k, v in source.items() if isinstance(v, str) and colours.get(k) != v.lower()]
            rows.append((paper, 'palette', 'tokens.json', 'same', 'the drawer colours are tokens.json\'s' + (f' ({", ".join(different)})' if different else ''), 0.0 if different else 1.0))
        picked = re.search(r'pickedTab: \(Color\(drawerHex: "(#\w+)"\), Color\(drawerHex: "(#\w+)"\)', block)
        if picked:
            rows.append((paper, 'picked ink', 'picked tab', 'text', 'drawer: picked bookmark (kraft, grid)', ratio(picked.group(2), picked.group(1))))
    return rows


TOKENS_BY_KEY = {p['key']: p for p in json.load(open(TOKENS_JSON, encoding='utf-8'))['papers']} if os.path.exists(TOKENS_JSON) else {}
EVENT_NAMES = ['blue', 'sage', 'coral', 'purple', 'yellow', 'gray']


def paper_rows(paper, p):
    """#244: (fg, bg, kind, where, ratio) for one paper's note — every pair of PAIRS, words on each event's tint (the
    timetable's block 14 % by day / 24 % on a dark paper, the calendar's all-day bar 16 % on a card), each event's mark 3:1 on
    the paper and a card (Q6), words on the spaces' tints, the unpicked tabs, and the widget's ink at 85 % over the worst
    desktop (black behind a light paper, white behind a dark one: C4)."""
    dark = paper in DARK
    rows = [(fg, bg, kind, where, ratio(p[fg], p[bg])) for fg, bg, kind, where in PAIRS]
    for name in EVENT_NAMES:
        mark = p['mark' + name.capitalize()]
        for alpha, surface, where in ((0.24 if dark else 0.14, 'paper', 'timetable event block'), (0.16, 'card', 'calendar all-day event')):
            back = blend(mark, alpha, p[surface])
            for fg in ('ink', 'ink2'):
                rows.append((fg, f'{name} event tint', 'text', where, ratio(p[fg], back)))
        for surface in ('paper', 'card'):
            rows.append((f'{name} mark', surface, 'large', 'event bar and dot (calendar, widget, timetable; Q6)', ratio(mark, p[surface])))
    for name in SPACE_COLOURS:
        for alpha, bg, where in ((0.12, 'paper2', 'lens band'), (0.16, 'paper2', 'space chip'), (0.16, 'card', 'header pill')):
            rows.append(('ink', f'{name} tint', 'text', where, ratio(p['ink'], blend(p[f'space{name}'], alpha, p[bg]))))
    for tab in ('tabToday', 'tabAhead'):
        rows.append(('tabInk', f'unpicked {tab}', 'text', 'unpicked tab (2.5 % darker)', ratio(p['tabInk'], darker(p[tab]))))
    rows.append(('ink', 'paper 85%', 'text', 'widget below 100 % opacity, the worst desktop behind (C4)',
                 ratio(p['ink'], blend(p['paper'], 0.85, '#ffffff' if dark else '#000000'))))
    # #234 4-6 on every paper: ink on the 85 % backing over a black and a white wallpaper, and a day's (or a weekend ·
    # holiday) tile at its own floor (CalendarWidget.floor; none up to 100 % fails).
    for wall in ('#000000', '#ffffff'):
        rows.append(('ink', f'paper 85% / {wall}', 'text', 'widget text on its backing (#234)', ratio(p['ink'], blend(p['paper'], WIDGET_BACKING, wall))))
    for tinted in (False, True):
        paper = blend(p['clay2'], 0.55, p['paper']) if tinted else p['paper']
        worst, other = ('#ffffff', '#000000') if dark else ('#000000', '#ffffff')
        floor = next((a for a in range(20, 101, 5) if ratio(p['ink'], blend(paper, a / 100, worst)) >= 4.5
                      and ratio(p['ink'], blend(paper, a / 100, other)) >= 4.5), None)
        rows.append(('ink', 'tile floor', 'text', f'widget {"weekend tile" if tinted else "day tile"} at its floor ({floor} %, #234 4-6)',
                     0.0 if floor is None else ratio(p['ink'], blend(paper, floor / 100, worst))))
    return rows


def token_differences(papers):
    """#244: every paper's note colours and event marks are tokens.json's, in its order."""
    if not TOKENS_BY_KEY:
        return None
    out = []
    if list(papers) != list(TOKENS_BY_KEY):
        out.append(f'papers {list(papers)} ≠ tokens.json {list(TOKENS_BY_KEY)}')
    for key, entry in TOKENS_BY_KEY.items():
        want = dict(entry['note'])
        want.update({'mark' + n.capitalize(): v for n, v in entry['eventMarks'].items()})
        have = papers.get(key, {})
        out += [f'{key} {k} {have.get(k)} ≠ tokens.json {v}' for k, v in want.items() if have.get(k) != v.lower()]
        out += [f'{key} {k} is not in tokens.json' for k in have if k not in want]
    return out


# 1.45: an unpicked tab is drawn 2.5 % darker (SwiftUI .brightness(-0.025)); its name must still pass on it.
def darker(colour, amount=0.025):
    return '#' + ''.join(f'{max(0, round(int(colour[i:i + 2], 16) - amount * 255)):02x}' for i in (1, 3, 5))


def unpicked_tabs(table):
    out = []
    for tab in ('tabToday', 'tabAhead'):
        out.append((f'tabInk on the unpicked {tab} (2.5 % darker, 1.45)', ratio(table['tabInk'][0], darker(table[tab][0])), ratio(table['tabInk'][1], darker(table[tab][1]))))
    return out


# 바탕화면 위젯 (#234): the paper fades to 20 %, so the wallpaper behind it is unknown — the worst one is black behind
# the day paper and white behind the night paper (a busy wallpaper is checked as both). Below 100 % the widget's text
# is ink; at 85 % there is no backing, below 85 % the text sits on a backing of the paper at 85 %. So every widget text
# is ink on the 85 % paper over black and over white (4.5:1). The marks (event bars, dots, the today circle) keep a
# 1.5 pt ring of solid paper below 100 %, so a deadline's clay, a reminder's sage and the today circle are checked on
# the paper (3:1); the today number is onSage on sage. The same rows are in the Windows app's test/contrast.test.ts.
WIDGET_BACKING = 0.85


def widget_rows(table):
    out = []
    for wall, name in (('#000000', 'black'), ('#ffffff', 'white')):
        day = ratio(table['ink'][0], blend(table['paper'][0], WIDGET_BACKING, wall))
        night = ratio(table['ink'][1], blend(table['paper'][1], WIDGET_BACKING, wall))
        out.append(('ink', f'paper 85% / {name}', 'text', f'widget text on its backing over a {name} wallpaper (#234)', day, night))
    for mark, where in (('sage', 'reminder dot, range bar, today circle'), ('clay', 'deadline dot and flag')):
        out.append((mark, 'paper ring', 'large', f'widget {where} on its paper ring (#234)', ratio(table[mark][0], table['paper'][0]), ratio(table[mark][1], table['paper'][1])))
    out.append(('onSage', 'sage', 'text', 'widget today number in its circle (#234)', ratio(table['onSage'][0], table['sage'][0]), ratio(table['onSage'][1], table['sage'][1])))
    # 4-6 (frosted paper tiles): a day's tile never fades below its paper's floor — ink on the paper at the floor over the
    # worst wallpaper; the weekend · holiday tile (clay2 55 % into the paper) has its own floor. Holiday names: clayText at
    # 100 % (below that they are ink).
    for tinted in (False, True):
        rows = []
        for mode in (0, 1):
            paper = table['paper'][mode]
            if tinted:
                paper = blend(table['clay2'][mode], 0.55, paper)
            ink, dark = table['ink'][mode], mode == 1
            worst, other = ('#ffffff', '#000000') if dark else ('#000000', '#ffffff')
            floor = next(a for a in range(20, 101, 5) if ratio(ink, blend(paper, a / 100, worst)) >= 4.5 and ratio(ink, blend(paper, a / 100, other)) >= 4.5)
            rows.append((floor, ratio(ink, blend(paper, floor / 100, worst))))
        where = f'widget {"weekend · holiday" if tinted else "day"} tile at its floor (day {rows[0][0]} %, night {rows[1][0]} %) over the worst wallpaper (#234 4-6)'
        out.append(('ink', 'tile floor', 'text', where, rows[0][1], rows[1][1]))
    out.append(('clayText', 'paper', 'text', 'holiday name in a day cell, at 100 % (#234)', ratio(table['clayText'][0], table['paper'][0]), ratio(table['clayText'][1], table['paper'][1])))
    out.append(('sage', 'paper ring', 'large', 'today tile outline on its paper ring (#234 4-6)', ratio(table['sage'][0], table['paper'][0]), ratio(table['sage'][1], table['paper'][1])))
    return out


# 1.45: the screen-edge handle is one pale cream on every paper, day and night (MemoDrawerPanel.swift, DrawerHandleView).
PANEL = os.path.join(ROOT, 'Sources/PaperTodo/MemoDrawerPanel.swift')


def handle_rows():
    text = open(PANEL, encoding='utf-8').read()
    colours = dict(re.findall(r'static let (fill|edge|paw) = Color\(drawerHex: "(#[0-9a-fA-F]{6})"\)', text))
    return [('paw', 'fill', 'large', 'the handle\'s paw on its cream (1.45)', ratio(colours['paw'], colours['fill'])),
            ('edge', 'fill', 'note', 'the handle\'s soft 1 pt edge (decorative, 1.45)', ratio(colours['edge'], colours['fill'])),
            # #111 · #164: the close tab is the same cream with the way it closes (› or ‹) in the paw's colour.
            ('paw', 'fill', 'text', 'the close tab\'s › on its cream (#111, #164)', ratio(colours['paw'], colours['fill']))]


# 1.45 (#29): the Windows app draws the same tokens (windows/src/renderer/base.css, its own test/contrast.test.ts). When
# that file is beside this app (the repository), every shared token must have the same day and night colour.
WINDOWS_CSS = os.path.join(os.path.dirname(ROOT), 'windows/src/renderer/base.css')
SHARED = {
    'paper': 'paper', 'paper2': 'paper-2', 'card': 'card', 'ink': 'ink', 'ink2': 'ink-2', 'ink3': 'ink-3', 'faint': 'faint',
    'rule': 'rule', 'sage': 'sage', 'sage2': 'sage-2', 'clay': 'clay', 'clay2': 'clay-2', 'sageText': 'sage-text',
    'clayText': 'clay-text', 'onSage': 'on-sage', 'checkBorder': 'check-border', 'stamp': 'stamp',
    'lavenderText': 'lavender-text', 'honeyText': 'honey-text', 'honey2': 'honey-2',
    'tabToday': 'tab-1', 'tabAhead': 'tab-2', 'tabTodayEdge': 'tab-1-edge', 'tabAheadEdge': 'tab-2-edge', 'tabInk': 'tab-ink',
    'tabMemo': 'tab-3', 'tintToday': 'tint-1', 'tintAhead': 'tint-2', 'eventBlue': 'event-blue', 'eventTint': 'event-blue-2',
    'memoPurple': 'memo-ink', 'memoTint': 'memo-2', 'toastAction': 'toast-action', 'toastKind': 'toast-strong',
    'tapeHoney': 'tape-todo', 'tapeLavender': 'tape-memo', 'tapeSky': 'tape-event', 'tapeMint': 'tape-timer',
    'tapeRose': 'tape-alarm', 'tapeNeutral': 'tape-confirm', 'tapeHoneyEdge': 'tape-todo-edge',
    'tapeLavenderEdge': 'tape-memo-edge', 'tapeSkyEdge': 'tape-event-edge', 'tapeMintEdge': 'tape-timer-edge',
    'tapeRoseEdge': 'tape-alarm-edge', 'tapeNeutralEdge': 'tape-confirm-edge',
}


def windows_differences(table):
    if not os.path.exists(WINDOWS_CSS):
        return None
    css = open(WINDOWS_CSS, encoding='utf-8').read()
    day_block = css[css.index(':root {'):css.index('}', css.index(':root {'))]
    start = css.index(':root[data-paper="night"] {')
    night_block = css[start:css.index('}', start)]
    grab = lambda block: {k: v.lower() for k, v in re.findall(r'--([\w-]+):\s*(#[0-9a-fA-F]{6})', block)}
    day = grab(day_block)
    night = {**day, **grab(night_block)}
    return [f'{mac} {table[mac]} ≠ Windows --{win} ({day.get(win)}, {night.get(win)})'
            for mac, win in SHARED.items() if table[mac] != (day.get(win), night.get(win))]


def main():
    markdown = '--markdown' in sys.argv
    table = tokens()
    missing = sorted({name for pair in PAIRS for name in pair[:2]} - set(table))
    if missing:
        sys.exit(f'Tokens not found in NotePalette.swift: {", ".join(missing)}')
    # 1.45 (#29): every token is in the table, so a new colour can't go unchecked.
    unchecked = sorted(set(table) - {name for pair in PAIRS for name in pair[:2]})
    if unchecked:
        sys.exit(f'Tokens in NotePalette.swift that no pair checks (add them to PAIRS): {", ".join(unchecked)}')
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
    # 할 일 스페이스 (1.45): words on a space's tint — the band over the list (12 % over paper2), the input line's chip
    # (16 % over paper2) and the header's pill (16 % over card), all in ink.
    for name in SPACE_COLOURS:
        colour = table[f'space{name}']
        for alpha, bg, where in ((0.12, 'paper2', 'lens band'), (0.16, 'paper2', 'space chip'), (0.16, 'card', 'header pill')):
            day = ratio(table['ink'][0], blend(colour[0], alpha, table[bg][0]))
            night = ratio(table['ink'][1], blend(colour[1], alpha, table[bg][1]))
            if day < NEED['text']:
                failures.append(f'day ink on the {name} {where}: {day:.2f} < 4.5')
            if night < NEED['text']:
                failures.append(f'night ink on the {name} {where}: {night:.2f} < 4.5')
            rows.append(('ink', f'{name} tint', 'text', f'{where} (1.45)', day, day >= 4.5, night, night >= 4.5))
    for where, day, night in unpicked_tabs(table):
        if day < NEED['text']:
            failures.append(f'day {where}: {day:.2f} < 4.5')
        if night < NEED['text']:
            failures.append(f'night {where}: {night:.2f} < 4.5')
        rows.append(('tabInk', 'unpicked', 'text', where, day, day >= 4.5, night, night >= 4.5))
    for fg, bg, kind, where, day, night in widget_rows(table):
        need = NEED[kind]
        if day < need:
            failures.append(f'day {where}: {day:.2f} < {need}')
        if night < need:
            failures.append(f'night {where}: {night:.2f} < {need}')
        rows.append((fg, bg, kind, where, day, day >= need, night, night >= need))
    handle = handle_rows()
    for fg, bg, kind, where, value in handle:
        if value < NEED[kind]:
            failures.append(f'handle {fg} on {bg}: {value:.2f} < {NEED[kind]}')
    drawer = drawer_rows()
    for paper, fg, bg, kind, where, value in drawer:
        if value < NEED[kind]:
            failures.append(f'drawer {paper} {fg} on {bg}: {value:.2f} < {NEED[kind]}')
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
        print(f'\n메모 서랍 ({len(PAPERS)} papers):')
        for paper, fg, bg, kind, where, value in drawer:
            mark = ' ' if kind == 'note' else ('✓' if value >= NEED[kind] else '✗')
            print(f'  {paper:<6} {fg:<14} {bg:<12} {kind:<6} {value:6.2f}{mark}  {where}')
        print('\n메모 서랍 handle (every paper, day and night):')
        for fg, bg, kind, where, value in handle:
            mark = ' ' if kind == 'note' else ('✓' if value >= NEED[kind] else '✗')
            print(f'  {fg:<6} {bg:<6} {kind:<6} {value:6.2f}{mark}  {where}')
        print('\nAA: text 4.5:1, large/UI 3:1, note = decorative (not checked).')
    # #244: the fifteen papers.
    papers = note_palettes()
    paper_failures = []
    paper_summary = []
    for paper, colours in papers.items():
        prow = paper_rows(paper, colours)
        bad = [f'{paper} {fg} on {bg}: {value:.2f} < {NEED[kind]} ({where})' for fg, bg, kind, where, value in prow if value < NEED[kind]]
        paper_failures += bad
        checked = [r for r in prow if r[2] != 'note']
        paper_summary.append((paper, len(checked), min(r[4] for r in checked if r[2] == 'text'), min(r[4] for r in checked if r[2] == 'large'), len(bad)))
    failures += paper_failures
    token_diff = token_differences(papers)
    if token_diff:
        failures += [f'not tokens.json\'s colour: {line}' for line in token_diff]
    if not markdown:
        print('\n열다섯 종이 (#244): pairs checked, the lowest text and mark contrast, failures')
        for paper, count, text_min, mark_min, bad in paper_summary:
            print(f'  {paper:<11} {count:4d} pairs  text ≥ {text_min:5.2f}  marks ≥ {mark_min:5.2f}  {"✓" if not bad else f"✗ {bad}"}')
    differences = windows_differences(table)
    if differences:
        failures += [f'not the Windows app\'s colour: {line}' for line in differences]
    if failures:
        print('\n'.join(failures))
        print(f'{len(failures)} pair(s) below AA')
        sys.exit(1)
    same = '' if differences is None else f'; the {len(SHARED)} shared tokens are the Windows app\'s'
    paper_pairs = sum(count for _, count, *_ in paper_summary)
    print(f'Day and night: all {sum(1 for r in rows if r[2] != "note")} checked pairs pass AA; the {len(papers)} papers: all {paper_pairs} pairs '
          f'(the widget at 85 % too), every colour tokens.json\'s; 메모 서랍: all {sum(1 for r in drawer if r[3] != "note")} in its {len(PAPERS)} papers{same}.')


if __name__ == '__main__':
    main()
