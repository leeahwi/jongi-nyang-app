#!/bin/bash
# 떠 있는 창을 그 화면 안에 두기 (#327, ScreenFit.swift): which display the timer, the folded note's icon, the slips and the
# reminder bubble are on, and how they are kept there — up to the top of a display above, beside or below the main one.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/ScreenFit.swift \
    Tests/PaperCoreTests/ScreenFitTests.swift \
    -o .build/checks/ScreenFitTests
.build/checks/ScreenFitTests
