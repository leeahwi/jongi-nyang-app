#!/bin/bash
# 시계 알람 (Alarm.swift): the same cases as the Windows app (test/alarm.test.ts).
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/AppLanguage.swift \
    Sources/PaperCore/TodoItem.swift \
    Sources/PaperCore/Archive.swift \
    Sources/PaperCore/Deadline.swift \
    Sources/PaperCore/Shelf.swift \
    Sources/PaperCore/Alarm.swift \
    Tests/PaperCoreTests/AlarmTests.swift \
    -o .build/checks/AlarmTests
.build/checks/AlarmTests
