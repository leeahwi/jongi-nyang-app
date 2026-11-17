#!/bin/bash
# 입력 줄의 ↑ · ↓ (#528, InputHistory.swift): the shared cases from shared/cases/input-history-cases.json (the Windows
# app's test/inputHistory.test.ts reads the same file).
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/InputHistory.swift \
    Tests/PaperCoreTests/InputHistoryTests.swift \
    -o .build/checks/InputHistoryTests
.build/checks/InputHistoryTests ../shared/cases/input-history-cases.json
