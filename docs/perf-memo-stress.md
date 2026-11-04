# 메모 서랍 under load — stress tests and measurements (2026-10-28)

How the memo drawer holds up with many memos and long memos, on Mac 1.44.0 and Windows 1.29.0 (dev main `afc3cd0`).
These are measurements only; no app code changed. A prototype of the cheapest Mac fixes was measured and then
reverted; it is kept as [`perf-memo-stress-prototype.patch`](perf-memo-stress-prototype.patch).

**Update — the fixes (Mac 1.45.0, Windows 1.30.0):** see [After the fixes](#after-the-fixes-mac-1450-windows-1300) just
below. The sections after it are the first measurements, on 1.44.0 / 1.29.0, kept as they were.

**Update 2 — Mac 1.47.0, Windows 1.32.0:** see [The long memos and the 5,000 cards](#the-long-memos-and-the-5000-cards-mac-1470-windows-1320).

**Machine:** Apple M4, macOS 26.5.1, release build. The Windows app was run in Electron 44 on the same Mac, not on a
Windows PC. The Mac was busy with other work (load average 3–7), so treat single numbers as ±30 %. UI runs that
overlapped someone else's snapshot renders were thrown away and run again.

## The long memos and the 5,000 cards (Mac 1.47.0, Windows 1.32.0)

Dev main `e9e68dbc` (Windows with CodeMirror in the drawer since 1.31) against branch `perf/drawer`, built by turns and
run on the same data. Other agents were building at the same time (load 5–16), so every number is a median of the runs
listed, and ranges are the runs themselves.

### Windows (`tools/perf-memo.mjs`, Electron on this Mac)

**Cause:** every redraw of the list built every card again (3,025 cards and 22,617 nodes at 5,000 memos), and a redraw
comes after each pause in the typing, on each reopen after a change and on each click that opens a memo.

**Fix:** the cards and the date headers are kept from one redraw to the next, keyed by memo; a card is made again only
when its memo's words, its time, its group, its pin, its folder's colour, its own paper, the pick or the view changed
(`renderer/drawer.ts`, `cachedSlip`). `core/placeChildren.ts` puts the list's children in the new order moving as few
as it can, so the card being typed stays where it is (as the old range cut did) and so do all the others.

5,000 memos, three runs each (before: dev main; after: this branch); times in ms:

| | before | after |
| --- | --- | --- |
| reopen after a change (to the frame) | 149 · 205 (the third run's measure failed) | **38 · 44 · 47** |
| its longest task | 105 · 118 · 173 | **0 · 0 · 0** |
| click to open the top memo (its own work) | 148 · 155 · 171 | **43 · 44 · 71** |
| typing, per key (median / p95) | 7.4–9.7 / 34–49 | 8.4–14.5 / 26–45 |
| long tasks while typing (count · longest) | 4–5 · 153–172 | 0–4 · 0–72 |
| memory, all processes (MB) | 539–563 | 581–808 (no clear direction; it swings by hundreds of MB between runs) |

The `long` tier (500 memos and 10 KB · 100 KB · 1 MB memos) is unchanged within the noise: a key 1.7–2.8 ms (p95 5–60)
in every memo, the 1 MB memo opening in 15–17 ms (22–27 ms to its frame). CodeMirror (1.31) is what made the 1 MB memo fast; the 0.2–0.4 s a
key of 1.30's textarea is gone.

`tools/perf-memo.mjs` measured the reopen by `visibilitychange`, which an off-screen run never fires (the page stays
"visible" while the window is hidden): it now takes the page's first change after the open, then the frame after it.
`--app=<folder>` runs another build on the same data.

### Mac (`scripts/perf-drawer.sh`, new, in one process)

**Why a new tool:** the old `scripts/perf-memo.sh` brought its test copy to the front (`perf-probe front`), opened the marker memo
with an accessibility press (which gives a text field the keyboard: the input-source indicator came on screen once) and
posted keys to it. Since 1.47 `perf-memo.sh` runs `perf-drawer.sh` for the same tiers, and no script under
`mac/scripts` brings anything forward or presses anything through accessibility. `perf-drawer.sh` builds the app's views with `Tests/PaperTodoTests/DrawerBench.swift` (optimised, like
`bench-app.sh`) and draws the drawer and the note in borderless windows 40,000 points off every screen, never key, in
an accessory process; keys go to the open memo's text view directly (`insertText`). Each step is the main thread's CPU
for it and for what it set off within 60 ms (a key) or 300 ms (an open, Esc), less an idle window's own, so another
process's load moves it little. Slip motion is off in it (a window off every screen gets no frames for an animation).

**Causes (sample(1) of the bench, `PROFILE=1`):**
1. `textDidChange` handed the binding `view.string`, the text storage's NSString bridged. Every later comparison of
   that memo (SwiftUI comparing the views' inputs, `updateNSView`'s `view.string != text`, the list, `memos !=`, the save)
   was Swift's slow path for a foreign string: Unicode normalization (`_NFDNormalizer`, `_slowCompare`) character by
   character. 1 MB: 0.22 s a key, 5 s for the list to catch up after the keys.
2. Esc on a long memo: `collapse()` sets `editing = false` with the card still sliding shut, so the closing card drew the
   memo again in its reading face (`CheckedText`, every line as a view) — 5 s for 1 MB.

**Fixes:** the text view's words are copied out once per key as a native string, in bulk (`KeyTextView.native`:
Foundation writes the UTF-8, Swift takes the bytes; `makeContiguousUTF8` and `String(decoding:as: UTF16)` both went a
character at a time, 35–40 ms for 1 MB); the coordinator keeps that copy (`shown`) and compares a text from elsewhere
with it, never with `view.string`; the formatting keys and the link field work on the copy. `OpenMemo` takes the face
(`editing`) from its card, so a closing card keeps the face it had. The drawer's own 0.16 s for opening and closing a
card and its 0.12 s scroll now go through `Motion.animation` (off under Reduce Motion and with `SlipMotion.enabled`
false), so the bench and the snapshots don't wait on them.

Two runs each, by turns (before: dev main's views; after: this branch's), load 8–16; main-thread CPU in ms:

| | before | after |
| --- | --- | --- |
| **typing, 1 MB memo, per key (median / p95)** | 224 / 236 (the second run's 1 MB memo didn't open in 30 s) | **12–13 / 13–15** |
| typing, 100 KB memo | 23–27 / 28–30 | **5 / 8–11** |
| typing, 10 KB memo | 6–7 / 8–9 | 3–4 / 5–10 |
| the list catching up after the keys, 1 MB · 100 KB | 5,047 · 251–335 | **217–220 · 65–70** |
| Esc, 1 MB · 100 KB | 5,104 · 762–1,365 | **121–126 · 343–349** |
| ↩ open, 1 MB | 2,395–2,713 | 2,060–2,109 (the whole text laid out for its height) |
| ↩ open, the 2,000-line checklist | 1,841–2,845 | 2,785–2,967 (its reading face, every line a view) |
| drawer first open, 500 memos | 138–189 | 185–223 |
| typing, the top memo at 5,000 memos | 5.6–8.1 / 7–11 | 6.8–8.0 / 7–10 |

↩ and Esc on short memos read lower after (106 vs 244 ms at 500 memos) only because the bench now runs them without
the card's 0.16 s animation; they aren't compared here. Typing stays under 16 ms a key at every size and length now.
Still over its target: the first open (150 ms at 500 memos), ↩ on a 1 MB memo (TextKit 1 lays the whole text out to
learn its height, `DrawerTextView.sizeThatFits`) and on the 2,000-line checklist (its reading face draws every line).

## After the fixes (Mac 1.45.0, Windows 1.30.0)

Branch `perf/memo-stress` against dev main `8eee3dc` (its drawer code is still 1.44.0 / 1.29.0), the two builds run
by turns with the same tools (`perf-memo.sh` with `PERF_MEMO_OUT`, `perf-memo.mjs` from each tree). The Mac was busy
with other agents' builds and perf runs (load 5–11), so single numbers move by 30 % or more; ranges are two runs.

**What changed:**

| # | Change | Where |
| --- | --- | --- |
| Mac 1 | The list (sections, memo lookup, `shown`, `dense`) is one cached value, rebuilt when the memos, folders, bookmark, sort or frozen order change, or the day turns. Bookmark counts once per change. Card and title caches drop gone memos instead of emptying at 2,000. The drag preview takes the cached title. | `MemoDrawerModel.swift` (`List`, `folderCount`, `forgetGoneCards`), `MemoDrawerCards.swift`, `MemoDrawerView.swift`, `MemoDrawerMenus.swift` |
| Mac 2 | `memo-folders.json`: formatters kept (`static`), the file's own date shape read without one, writes on a serial queue off the main thread. Every catch-up with the file, a backup, stopSaving and quitting wait for the writes; the bytes written become `knownFoldersData`, so the merge logic sees what it did before. | `PaperCore/MemoFolders.swift`, `MemoDrawerModel.swift` (`MemoFoldersWriter`), `AppModel.swift`, `PaperTodoApp.swift` |
| Mac 3 | One pass per redraw (list and footer read the same `List`; search results cached per query). The handle's count (tooltip) 0.5 s after the memos stop changing. A key after the title line restyles only its lines. | `MemoDrawerModel.swift`, `MemoDrawerPanel.swift`, `MemoDrawerText.swift` |
| Mac 4 | Typing: the drawer keeps the open memo's keys and hands them to the model 250 ms after the last one (at once on close, collapse, another memo, blur, delete, duplicate, 체크한 줄 지우기, a backup, quitting, and when another change to the memo comes in, which is then joined as before). The model changes once per pause, not four times a key. While a syllable is composed (marked text) nothing leaves the text view. | `MemoDrawerModel.swift` (`edit`, `sendTyped`), `MemoDrawerText.swift`, `MemoDrawerCards.swift` (`SlipEditor`), `AppModel.swift` (`updateMemo`) |
| Win 5 | `fit()`: a text that only got longer grows when its scroll height outgrows it (no height 0 first); a shorter one is measured from nothing as before. (`field-sizing: content` was tried first: it made a key at 500 memos 25 ms instead of 2 ms.) | `renderer/drawer.ts` (`fit`, `fitTyped`) |
| Win 6 | The open memo's text goes 150 ms after the last key (at least once a second), at once on blur, window blur, hidden, close, delete and before any other action. Quitting: a sync IPC (`memo:flush`) writes it before the page goes; `will-quit` flushes the store again. Only the last 8 sent texts are kept (was up to 200). | `renderer/drawer.ts`, `preload.ts`, `main/drawer.ts`, `main/main.ts` |
| Both 7 | Search: the query prepared once; Mac folds a letter to a number from a table (a string per letter before) and keeps each memo's folded lines per text (read ahead off the main thread when the field opens); Windows caches folds per character and each memo's title, lines and folded text per text, and reads a memo line by line only when the folded query can be in it. 80 ms after the last key (at once when emptied, ↩, ↑↓). Results and order unchanged: tests compare with the old matching on random lines and memos. | `PaperCore/Convenience.swift` (`Search.Query`, `foldKey`), `PaperCore/MemoFolderSearch.swift` (`SearchIndex`), `core/search.ts`, `core/memoDrawer.ts` (`drawerSearch`) |

### Mac UI (`scripts/perf-memo.sh` before 1.47: a test copy of the app)

Times in ms; before → after.

| | 50 | 500 | 2,000 | 5,000 |
| --- | --- | --- | --- | --- |
| **typing, short memo, per key (median / p95)** | 41–60 / 46–81 → **8 / 17** | 98–126 / 109–500 → **9 / 12** | 694 / 1,838 → **9 / 15** | 926–1,726 / 1,253–2,796 → **8 / 17** |
| drawer first open | 144–376 → 182–291 | 200–510 → 197–198 | 505–636 → 170–198 | 932–1,021 → 238–481 |
| drawer reopen | 36–51 → 34–48 | 61–127 → 45–69 | 171–255 → 51–60 | 328–458 → 65–122 |
| ↓ one step | 40 → 37 | 90 → 38–43 | 194–209 → 37–40 | 1,511–2,649 → 39–42 |
| ↩ open a memo | 81–216 → 68–236 | 221–367 → 69–303 | 257 → 141–245 | 567–614 → 76–287 |
| collapse (Esc) | 64–254 → 110–229 | 106–355 → 98–272 | 295–388 → 84–176 | 505–1,220 → 154–369 |
| idle, drawer open (CPU) | 0.09 % → 0.05–0.22 % | 0.18 % → 0.06–0.11 % | 0.08 % → 0.10–0.70 % | 0.23 % → 0.09–0.25 % |

Long memos (500 memos in the list):

| | 10 KB | 100 KB | 1 MB |
| --- | --- | --- | --- |
| **typing, per key (median / p95)** | 616–685 / 1,268–1,730 → **14 / 32** | 689–741 / 1,301–1,577 → **9 / 14** | 686–790 / 1,227–1,951 → **16 / 39** |
| ↩ open | 223–371 → 94–185 | 270–374 → 101–183 | 294–312 → 97–206 |
| Esc close and save | 467–558 → 325–393 | 385–417 → 178–392 | 384–465 → 232–398 |

The list catches up once the keys pause: 46 ms (50 memos), 55 ms (2,000), 125 ms (5,000), 52–75 ms (long memos),
logged as `list` by the app's `--perf-log`. Idle with the 1 MB memo open: 0.05–0.09 %. Memory is as before
(footprint 166–203 MB at the end of a tier).

**Korean as the input method types it** (`scripts/perf-compose.sh`, new): the drawer and the note in windows off every
screen, a memo open in a short folder on 모눈 노트, `한글입력` sent as marked jamo (ㅎ → 하 → 한) and commits, eight
finished letters after it, three rounds. Main-thread CPU per key and what it set off within 60 ms:

| | 50 before | 50 after | 2,000 before | 2,000 after |
| --- | --- | --- | --- | --- |
| **composing (marked jamo), median / p95** | 40 / 55 | **3 / 5** | 286 / 304 | **4 / 5** |
| committing a syllable | 5 / 6 | 4 / 4 | 4 / 6 | 4 / 5 |
| finished letters | 42 / 56 | 4 / 4 | 277 / 297 | 4 / 17 |
| memo list changes while composing | 74 | **0** | 74 | **0** |

Before, each jamo went to the model as an edit (the list changed twice, every window redrew, the save timer
restarted, a merge could run on half a syllable). Now nothing leaves the text view until the syllable is committed,
and the model hears the keys 250 ms after the last one; the save follows 0.4 s later, as before. No lone jamo is ever
saved (the check reads `memos.json` after the keys).

### Mac core (`scripts/bench-memo-stress.sh`)

Before: dev main `afc3cd0` core, busy machine. After: this branch, a quieter hour. Times in ms.

| Step | 2,000 before → after | 5,000 before → after |
| --- | --- | --- |
| read `memo-folders.json` | 807 → 5 | 2,239 → 13 |
| write `memo-folders.json` | 258 → 9 (off the main thread) | 666 → 27 |
| search "보고서" (first, no lines kept) | 117 → 28 | 237 → 68 |
| search "ㅂㄱㅅ" | 109 → 27 | 244 → 65 |
| search with no hit | 394 → 44 | 820 → 98 |
| search again (the drawer keeps the lines) | — → 2–3 | — → 6–8 |

### Windows UI (`tools/perf-memo.mjs`, Electron on this Mac)

Typing in the top memo, per key (input → next frame), median / p95, ms:

| | 500 | 2,000 | 5,000 | long: top memo | 100 KB | 1 MB |
| --- | --- | --- | --- | --- | --- | --- |
| before (two runs) | 2.1–2.2 / 21–32 | 4.1–94 / 14–130 | 245 / 818 | 27 / 48 | 8–16 / 68–152 | 234–274 / 389–545 |
| after | **1.6 / 23** | **11 / 82** | **40 / 533** | **4–14 / 31–41** | 10–29 / 36–106 | 209–398 / 262–1,099 |

Long tasks while typing at 5,000: 40 → 19. The rest is unchanged within the noise: first paint 160–390 ms, reopen
after a change 100 ms (500) to 770–930 ms (5,000), scrolling p95 17–23 ms, memory 540–1,330 MB with no clear
direction (it swings by hundreds of MB between runs of the same build).

### Windows core (`MEMO_BENCH=1 node --test out-test/memoStress.test.mjs`)

| Step | 2,000 before → after | 5,000 before → after |
| --- | --- | --- |
| search "보고서" (first) | 31–42 → 18 | 72–101 → 43 |
| search "ㅂㄱㅅ" | 62–63 → 22 | 134–155 → 52 |
| search with no hit | 116–125 → 11 | 296–360 → 25 |
| search again (lines kept) | — → 3–11 | — → 7–44 |

### Targets now

| Target | Mac | Windows |
| --- | --- | --- |
| key < 16 ms (p95 < 33 ms) up to 2,000 | **Met**: 8–9 ms (p95 12–17) at 50–2,000, also at 5,000. Korean composing 3–4 ms of main-thread work. Long memos: 9–16 ms, p95 14–39 (1 MB misses the p95). | **Met at 500** (1.6 ms); **at 2,000 the median is met (11 ms), the p95 isn't** (82 ms: the list redraw after the pause lands in the timing). **Missed at 5,000** (40 ms) and for the **1 MB memo** (0.2–0.4 s: Chromium's own work in a 1 MB textarea). |
| open < 150 ms at 500, ideally 2,000 | **Missed for the first open** (170–200 ms at 500–2,000, 240–480 at 5,000). Reopen met (34–69 ms up to 2,000, 65–122 at 5,000). ↩ open 69–300 ms, noisy. Esc close of long memos 180–400 ms. | First paint 160–390 ms (busy machine; was 125–225 in the first report). Reopen after a change: 100 ms at 500, 340–440 at 2,000. |
| search < 50 ms at 2,000 | **Met**: a first search 27–44 ms, the next keys 2–3 ms. | **Met**: 11–22 ms first, 3–11 ms after. |
| idle CPU unchanged | Unchanged (0.05–0.7 %, noise). | Unchanged within the noise (no new timers; the send timer runs only after a key). |

### Next steps

- **Windows: draw only the cards near the view** (with spacers), and cache the cards' words per text as Mac does.
  That is what's left at 5,000 memos (22k nodes, the redraw after a pause, reopen) and the memory. Not done here.
- **Windows 1 MB memo**: the textarea itself costs 0.2–0.4 s a key; a lighter editor or splitting the text would be
  needed.
- **Mac first open** at 2,000 or more (170–480 ms) and Esc on a long memo (180–400 ms): the first build of the list
  and the cards' words, then the save.

## What was measured

**Data:** `mac/scripts/memo-stress-data.py` and `windows/tools/memo-stress-data.mjs` use the same recipe and write
`memos.json` and `memo-folders.json`:
- Memo mix: 60 % short (1–3 lines), 30 % medium (5–20 lines), 9 % long (2–5 KB), 1 % checklists.
- About 6 % carry a link and 3 % a phone number (random numbers).
- Times are spread over two years, so every date group appears.
- 30 folders, with 60 % of the memos in the inbox (the drawer opens there) and at most 6 pinned.
- Tiers: 50, 500, 2,000 and 5,000 memos.
- `long`: 500 memos plus memos of 10 KB, 100 KB and 1 MB and a 2,000-line checklist.

**Core, without UI:**

| | Mac | Windows |
| --- | --- | --- |
| Command | `mac/scripts/bench-memo-stress.sh` (swiftc `-O`, PaperCore) | `MEMO_BENCH=1 node --test out-test/memoStress.test.mjs` |
| Each number | median of 3–5 runs | median of 3–5 runs |

**UI, in the real app:**

| | Mac | Windows |
| --- | --- | --- |
| Command | `mac/scripts/perf-memo.sh` | `node tools/perf-memo.mjs` |
| App copy | separate test copy (`com.noa.PaperTodo.MemoStress`), off-screen, driven by pid | `--demo` runs, DevTools protocol |
| Keystroke measured | key → main thread idle after the frame (the app's `--perf-log`) | input event → next frame |

**Mac keystroke caveat:** when one key's work is longer than the 120 ms between keys, the keys queue and each
logged time includes the ones before it. Medians over about 150 ms are inflated by queueing. The work per key is
still over 120 ms.

**Targets:**
- opening under 150 ms;
- a keystroke under 16 ms (p95 under 33 ms);
- search under 50 ms at 2,000 memos;
- idle CPU under 1 %.

## Results — core

Times in ms.

| Step | Mac 50 | Mac 500 | Mac 2,000 | Mac 5,000 | Win 50 | Win 500 | Win 2,000 | Win 5,000 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| read memos.json | 0.3 | 3.8 | 21 | 50 | 0.06 | 0.9 | 3.6 | 7.6 |
| **read memo-folders.json** | 20 | 140 | **703** | **1,639** | 0.1 | 1.4 | 3.7 | 7.2 |
| write memos.json (Win: text only) | 0.8 | 3.3 | 12 | 36 | 0.1 | 1.0 | 4.1 | 8.2 |
| **write memo-folders.json** | 7.5 | 47 | **179** | **546** | 0.07 | 2.0 | 2.7 | 5.6 |
| card words, all memos (Win: inbox, every redraw) | 2.5 | 33 | 149 | 363 | 0.3 | 4.3 | 10 | 19 |
| date groups, inbox | 0.2 | 2.1 | 8.6 | 21 | 0.1 | 0.8 | 3.1 | 5.2 |
| per-keystroke list work (Mac model) | 0.2 | 2.4 | 11 | 31 | — | — | — | — |
| search "보고서" | 1.4 | 18 | **82** | **202** | 1.4 | 8.8 | 32 | 64 |
| search "ㅂㄱㅅ" | 1.4 | 20 | **84** | **190** | 1.7 | 15 | 49 | **103** |
| search with no hit (every line read) | 4.0 | 64 | **269** | **671** | 2.8 | 27 | **104** | **239** |
| merge another device's memos.json | 0.03 | 0.5 | 1.4 | 2.9 | 0.1 | 0.2 | 1.0 | 1.6 |

Long memos (the `long` tier), times in ms:

| Step | Mac 10 KB | Mac 100 KB | Mac 1 MB | Win 10 KB | Win 100 KB | Win 1 MB |
| --- | --- | --- | --- | --- | --- | --- |
| merge, both sides edited, lines apart | 0.2 | 2.4 | 24 | 0.2 | 0.6 | 4.6 |
| merge, both sides edited the same line | 0.3 | 2.4 | 24 | 0.3 | 0.7 | 5.3 |
| card words (title, preview, kind) | 0.9 | 10 | **92** | 0.1 | 0.6 | 5.9 |
| per key: compare and copy the text (Win: + IPC clone) | 0.4 | 3.8 | 40 | 0.01 | 0.02 | 0.5 |

The 2,000-line checklist, Mac / Windows:
- toggle a line: 2.1 / 0.1 ms;
- count done lines: 2.9 / 0.3 ms;
- card summary: 3.0 / 0.1 ms.

**Takeaways:**
- **Mac: `memo-folders.json` is the outlier.** Reading it takes 0.7 s at 2,000 memos and 1.6 s at 5,000. Writing it
  takes 0.18 s and 0.55 s, and that write happens on the main thread after every move, pin, paper change or quick
  write. The cause is a new `ISO8601DateFormatter` for every date read (two of them) and written. Windows does the
  same work in under 8 ms.
- **Search misses the 50 ms target at 2,000 memos on both apps:**
  - Mac: 82 ms when the word is found, 269 ms when it isn't.
  - Windows: 32 ms found, 49 ms for 초성, 104 ms not found.
- **Merging is safe even for 1 MB.** `TextMerge` caps its table at 2 M cells: 24 ms on Mac, 5 ms on Windows.
- **Checklists of 2,000 lines are fine** on both apps.

## Results — UI, Mac (baseline 1.44.0)

| | 50 | 500 | 2,000 | 5,000 |
| --- | --- | --- | --- | --- |
| start → note visible (ms) | 1,577¹ | 678 | 1,372 | 2,348 |
| drawer first open (ms) | 168 | **243** | **533** | **1,033** |
| drawer reopen (ms) | 38 | 57 | **271** | **582** |
| quick write ↩, new memo (ms) | 33 | 74 | **238** | **498** |
| ↓ one step in the list (median, ms) | 39 | 109 | 184 | 6,213² |
| ↩ open a memo (ms) | 85 | **314** | **229** | **604** |
| **typing in a short memo, per key (median / p95, ms)** | **40 / 46** | **86 / 91** | **755 / 1,604** | **2,442 / 3,298** |
| memos.json save while typing (ms) | 1.2 | 5.4 | 25 | 41 |
| idle, drawer open (CPU) | 0.10 % | 0.21 % | 0.07 % | 0.22 % |
| memory after (footprint, MB) | 160 | 181 | 182 | 191 |

¹ The first launch after a build.
² Keys queued behind each other.

Long memos (500 memos in the list):

| | 10 KB | 100 KB | 1 MB |
| --- | --- | --- | --- |
| ↩ open (ms) | 361 | 282 | 355 |
| **typing, per key (median / p95, ms)** | **1,507 / 2,670** | **1,186 / 2,359** | **809 / 1,260** |
| Esc close and save (ms) | 558 | 724 | 553 |

Other `long`-tier numbers:
- 2,000-line checklist ↩: 240 ms.
- Idle with the 1 MB memo open: 0.06 %.
- Memory: 203 MB.

**Where the time goes (sample(1) of the main thread while typing at 2,000 memos):** the main thread is about 100 %
busy. In the 10 KB case:
- About 25 % is in `MemoCard.body`, which reads `MemoDrawer.dense`, which filters every memo through `MemoFolders.memos(_:in:)`.
- About 12 % is in the bookmarks' counts (`FolderTab.body` → `MemoFolders.count`, once per bookmark).
- 40 % is in a drag preview built on every render with an uncached `MemoCards.title` (in turn `Checklist.summary`, `Checklist.split`).
- The rest: `sections` (twice), `changedToday` for the handle's badge, and `restyle` of the whole text.

## Results — UI, Mac, with the prototype fixes (measured, then reverted)

These are the four fixes in `perf-memo-stress-prototype.patch`:
1. `dense` cached;
2. the drag preview uses the cached title;
3. card and title caches allowed past 2,000;
4. bookmark counts worked out once.

The patch also contains the formatter fix for `memo-folders.json`, measured on its own in the core bench.

| | 2,000 before → after | 5,000 before → after | `long` before → after |
| --- | --- | --- | --- |
| typing, short memo (median, ms) | 755 → **69** | 2,442 → **106–714**³ | — |
| typing, 10 KB / 100 KB / 1 MB (median, ms) | — | — | 1,507 / 1,186 / 809 → **96 / 47 / 101** |
| ↓ one step (ms) | 184 → 76 | 6,213 → 118 | — |
| reopen (ms) | 271 → 71 | 582 → 88–103 | 136 → 41 |
| ↩ open (ms) | 229 → 181 | 604 → 176 | 361 / 282 / 355 → 125 / 200 / 211 |
| quick write ↩ (ms) | 238 → 95 | 498 → 165 | — |

³ Two runs. What remains at 5,000:
- `sections` is worked out twice per redraw (list and footer);
- `changedToday` runs on every key;
- `updateMemo` moves the memo to the front of a 5,000-element array.

Core formatter fix for `memo-folders.json`:

| | before | after |
| --- | --- | --- |
| read, 2,000 / 5,000 memos | 703 / 1,639 ms | 88 / 274 ms |
| write, 2,000 / 5,000 memos | 179 / 546 ms | 11 / 32 ms |

## Results — UI, Windows (Electron on macOS)

| | 50 | 500 | 2,000 | 5,000 | long |
| --- | --- | --- | --- | --- | --- |
| drawer first open, first paint (ms) | 186 | 125 | 139 | 134 | 174 |
| cards in the DOM · all DOM nodes | 31 · 432 | 307 · 2,562 | 1,215 · 9,143 | **3,025 · 22,413** | 321 · 2,671 |
| reopen after a change (ms) · its longest task | 17 · – | 43 · – | 139 · 50 | **364 · 144** | 54 · – |
| scroll, frame interval p95 (ms) | 17.6 | 17.6 | 17.6 | 17.3 | 17.6 |
| click to open the top memo (ms) | 18 | 45 | 120 | **314** | 96 |
| **typing in a short memo, per key (median / p95, ms)** | 2.7 / 3.0 | 3.6 / 5.7 | 7.7 / 16.1 | **259 / 420** | 2.0 / 20 |
| long tasks while typing (count · longest, ms) | 0 | 0 | 2 · 76 | **27 · 245** | 1 · 65 |
| idle CPU, drawer and note open (all processes)⁴ | 1.5 % | 1.3 % | 1.6 % | 2.8 % | 4.9 % |
| memory, all processes (MB) | 737 | 702 | 911 | **1,457** | **1,163** |

`long` tier memos:
- **100 KB:** opens in 49 ms (86 ms to the frame); typing is 5.7 / 9.6 ms per key.
- **1 MB:** opens in 171 ms (340 ms to the frame); **typing is 163 / 290 ms per key**, with 29 long tasks up to 237 ms.
- **2,000-line checklist:** opens in 95 ms.

⁴ The note window was showing too, and the window started right after the reopen steps. `tools/perf.mjs` measures
0.22 % with the drawer open and the note hidden. These numbers need a quiet re-measure before anyone acts on them.

**Takeaways:**
- **Scrolling is smooth at every size:** Chromium scrolls a static DOM well.
- **The costs that grow with the list are the redraws.**
  - The list is rebuilt whole: every card, without a cache of its words.
  - Each keystroke's `fit()` forces a layout of the whole drawer.
  - At 5,000 memos, typing a short memo costs about 260 ms a key.
- **For the 1 MB memo, each key costs:**
  - the whole text sent over IPC;
  - a re-measure of the 1 MB textarea;
  - up to 200 full copies of the text kept in `sent`, which is why memory reached 1.16 GB.

## Targets — where they break

| Target | Mac 1.44.0 | Windows 1.29.0 |
| --- | --- | --- |
| open < 150 ms | Fails from 500 memos: first open 243 ms, ↩ 314 ms. Reopen fails from 2,000. | First paint passes. Reopen after a change fails at 5,000 (364 ms). Click-open fails at 5,000 (314 ms) and for the 1 MB memo. |
| key < 16 ms, p95 < 33 ms | **Fails at every size:** 40 ms at 50 memos, 755 ms at 2,000, 2.4 s at 5,000, 0.8–1.5 s in long memos. | Passes up to 2,000 (p95 16 ms). **Fails at 5,000** (259 ms) and **for the 1 MB memo** (163 ms). |
| search < 50 ms at 2,000 | **Fails:** 82 ms found, 269 ms not found. | **Fails when nothing is found:** 104 ms (초성 49 ms). |
| idle CPU < 1 % | Passes: 0.06–0.22 %. | Not settled: 1.3–4.9 % with the note also open (see ⁴). |

## Bottlenecks (file:line on dev main `afc3cd0`)

**Mac:**
1. `mac/Sources/PaperTodo/MemoDrawerModel.swift:523`: `dense` is `tabMemos.count > 20`. It filters every memo, and `MemoDrawerCards.swift:40-41` reads it twice per card on every redraw. That makes the work O(cards × memos) per keystroke.
2. `mac/Sources/PaperTodo/MemoDrawerCards.swift:58`: the drag preview is built in every `body` with `MemoCards.title(memo.text)`. That goes through `MemoCards.swift:86` → `Checklist.summary`, which splits the whole text. On every render this is O(text) for each visible card.
3. `mac/Sources/PaperTodo/MemoDrawerModel.swift:501,511`: the card and title caches are emptied at 2,000 entries. A folder with more than 2,000 memos recomputes them on every redraw.
4. `mac/Sources/PaperTodo/MemoDrawerView.swift:525`: every bookmark counts its memos (`MemoFolders.count`) on every redraw: 30 × N.
5. `mac/Sources/PaperCore/MemoFolders.swift:368-372, 409`: two `ISO8601DateFormatter`s are made for every date read, and one for every date written. Saves run on the main thread after every folder change (`MemoDrawerModel.swift:49-68`).
6. `mac/Sources/PaperTodo/MemoDrawerView.swift:157-158, 248-249`: the sections and a dictionary of every memo are made twice per redraw (list, then footer through `shown`).
7. `mac/Sources/PaperTodo/MemoDrawerPanel.swift:57-59`: `changedToday` runs over every memo on every keystroke, for the handle's badge.
8. Every keystroke is published as the whole array, and the whole list redraws (`AppModel.swift:297-307`, `MemoDrawerModel.swift:380`). `MemoDrawerText.swift:132` restyles the whole text.
9. Search, `MemoFolderSearch.swift:19` → `Convenience.swift:275` (`Search.match`): every line is normalized and turned into arrays again for each query.

**Windows:**
1. `windows/src/renderer/drawer.ts:863-901` (`renderList`): every card is rebuilt on every redraw, with no virtualization. At 5,000 memos that is 22k nodes and 1.46 GB.
2. `windows/src/renderer/drawer.ts:123-126` (`fit`): `height = 0` then `scrollHeight` on every input event. That is a forced layout of the whole drawer per key.
3. `windows/src/renderer/drawer.ts:137-141`: `sent` keeps up to 200 full texts of the open memo (about 200 MB for 1 MB). The whole text also crosses IPC on every key (`act memoUpdate`).
4. `windows/src/renderer/drawer.ts:668-690` (`closedSlip`): `cardTitle`, `previewLine` and the kind row are worked out again for each card on each redraw.
5. `windows/src/core/memoDrawer.ts:580` (`drawerSearch`): `slipSummary` and a split of every line for every memo, for each query.

## Proposed fixes, by impact and risk

1. **Mac list fixes.** Low risk, biggest gain. Keep `dense` and the bookmark counts as values worked out once per change of memos, tab or folders. The drag preview takes the cached title. The caches don't empty at 2,000 (drop entries for memos that are gone instead).
   - Measured: typing at 2,000 memos 755 → 69 ms; long memos 0.8–1.5 s → 50–100 ms; reopen 271 → 71 ms.
2. **Mac `memo-folders.json` date formatters kept** (`static let`). Low risk.
   - Measured: read 703 → 88 ms and 1,639 → 274 ms; write 179 → 11 ms and 546 → 32 ms.
3. **Mac, one pass per redraw.** Low to medium risk. Work out the sections once (the footer takes their count). Work out `changedToday` only when the memos change outside typing, or debounce it.
4. **Windows `fit()` without a forced layout.** Low risk. Use CSS `field-sizing: content` (Electron 44 has it), or measure once per frame with `requestAnimationFrame`.
5. **Windows open-memo traffic.** Low to medium risk. Keep only a short list of sent texts, or hashes. Send the text debounced, which also halves IPC for long memos.
6. **Search, both apps.** Medium risk. Fold and normalize each memo's text once per search, and reuse it while the query grows. Wait about 80 ms after the last key before searching.
7. **Mac, typing doesn't redraw the list.** Medium risk. While a memo is open, publish its text to the list on a pause, as Windows does with its 150 ms. Restyle only the edited paragraph.
8. **Windows list.** Medium to high risk, large gain at 2,000 or more memos. Render only the cards near the view (with spacers) or keep nodes and update them. Cache card words per text, as Mac does.

## Regression checks (added)

- **Mac:** `mac/scripts/test-memo-stress.sh` uses 2,000 memos, a 100 KB memo and a 2,000-line checklist.
  - It fails when a core step is far over its ceiling (`MemoStressBench.swift`).
  - 1.45: `memo-folders.json` read and write 150 ms each (5–16 ms measured), search 250 / 300 ms without the kept
    lines (27–44 ms), the next key's search 60 ms (2–5 ms).
  - It takes about a minute, mostly the `-O` compile.
- **Windows:** `test/memoStress.test.ts` runs in `npm test` with the same data and similar ceilings. It takes about a second.
  - 1.30: search 150 ms (11–45 ms measured), the next key's search 60 ms (3–11 ms).
- **Equivalence:** the search tests compare the new matching with the old one on random lines and memos (Mac
  `ConvenienceTests.swift`, `MemoDrawerTests.swift`; Windows `memoDrawer.test.ts`); `PresentationTests.swift` types
  600 random edits and checks the line-only restyle against a whole one; `MemoDrawerTests.swift` reads 5,000
  `memo-folders.json` times both ways.
- **Korean:** `mac/scripts/perf-compose.sh` (not part of the tests; it prints numbers).

## Not measured

- **A real Windows PC.** The Windows numbers come from Electron on this Mac.
- **Mac scrolling frame times.** Only ↓ steps (select and scroll) were timed; there is no frame-rate probe for a SwiftUI scroll.
- **What reaches the screen.** Keystroke times end at the main thread going idle (Mac) or the next frame (Windows).
- **Korean input composition (IME)** in the first report: keys were sent as finished characters. Since 1.45 Mac's
  `perf-compose.sh` sends marked text to the text view directly (not through a real input source, which would change
  the system's); Windows composition is still not measured.
- **Real cloud folders:** merges were timed in memory only.
- **Long sessions:** memory over hours, and memory growth from the Windows `sent` set over many edits.
- **Windows idle CPU with the note hidden** at these sizes (see ⁴).
