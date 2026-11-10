#!/bin/bash
# 종이냥 펫과 타닥냥의 크기 (#304, CatSize.swift): the shared cases from docs/plans/cat-size-cases.json (the Windows app's
# test/catSize.test.ts reads the same file) — the steps and their names (the timer's), what is saved, the pet's size,
# stride, strip, floor ends, anchor and hop at each step, and 타닥냥's window flush in every corner at every size.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/CatSize.swift \
    Sources/PaperCore/ScreenFit.swift \
    Sources/PaperCore/TypingCat.swift \
    Tests/PaperCoreTests/CatSizeTests.swift \
    -o .build/checks/CatSizeTests
.build/checks/CatSizeTests ../docs/plans/cat-size-cases.json
