#!/bin/bash
# 대비 (1.45, #29): the paper's colour tokens against WCAG AA in 종이 and 밤 종이 — text 4.5:1, large text and marks
# 3:1 — every token in PaperTheme.swift, the spaces' bands, the event tints, the tabs and the slips' tape, and the
# 메모 서랍's papers (#142, #244), and since #244 every pair on each of the fifteen papers with the event marks (3:1) and the
# widget at 85 %, every colour checked against docs/plans/paper-themes/tokens.json (scripts/check-contrast.py, which reads the
# colours from the source). The same table as the
# Windows app's test/contrast.test.ts. Fails when a pair falls below AA or a token isn't checked.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/check-contrast.py > .build/contrast.txt || { cat .build/contrast.txt; exit 1; }
tail -1 .build/contrast.txt
