#!/bin/bash
# 오늘 창 (#200, TodayGlance.swift): the cards that become chips, the to-do rows that fit, 외 N개, the header's progress
# and date — the shared cases from docs/plans/today-window-cases.json (the Windows app's test/todayWindow.test.ts reads
# the same file).
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/AppLanguage.swift \
    Sources/PaperCore/TodoItem.swift \
    Sources/PaperCore/TimeBlock.swift \
    Sources/PaperCore/Archive.swift \
    Sources/PaperCore/Deadline.swift \
    Sources/PaperCore/Shelf.swift \
    Sources/PaperCore/Repeat.swift \
    Sources/PaperCore/QuickParse.swift \
    Sources/PaperCore/Duration.swift \
    Sources/PaperCore/Alarm.swift \
    Sources/PaperCore/CalendarDay.swift \
    Sources/PaperCore/CalendarDraft.swift \
    Sources/PaperCore/LocalEvent.swift \
    Sources/PaperCore/Intent.swift \
    Sources/PaperCore/DayRibbon.swift \
    Sources/PaperCore/FocusTimer.swift \
    Sources/PaperCore/TodayGlance.swift \
    Tests/PaperCoreTests/TodayWindowTests.swift \
    -o .build/checks/TodayWindowTests
.build/checks/TodayWindowTests ../docs/plans/today-window-cases.json
