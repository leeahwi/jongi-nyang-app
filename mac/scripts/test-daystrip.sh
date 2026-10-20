#!/bin/bash
# 하루 띠 · 하루 일정표 (DayStrip.swift, 1.40): now and next, the ring's and rows' words, the timetable's
# columns, slots and drags — the shared cases with the Windows app (test/dayStrip.test.ts), listed in ribbon-cases.md.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/AppLanguage.swift \
    Sources/PaperCore/TodoItem.swift \
    Sources/PaperCore/Notebook.swift \
    Sources/PaperCore/Carry.swift \
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
    Sources/PaperCore/TimeBlock.swift \
    Sources/PaperCore/DayStrip.swift \
    Tests/PaperCoreTests/DayStripTests.swift \
    -o .build/checks/DayStripTests
.build/checks/DayStripTests
