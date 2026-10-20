#!/bin/bash
# 앞으로 (Ahead.swift): the shared cases with the Windows app (test/ahead.test.ts, listed in
# ahead-cases.md) — sections, days, months, counts, the header words and the toast after a drop;
# and the 오늘 창 / menu bar words (TodayGlance).
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
    Sources/PaperCore/Ahead.swift \
    Sources/PaperCore/FocusTimer.swift \
    Sources/PaperCore/TodayGlance.swift \
    Tests/PaperCoreTests/AheadTests.swift \
    -o .build/checks/AheadTests
.build/checks/AheadTests
