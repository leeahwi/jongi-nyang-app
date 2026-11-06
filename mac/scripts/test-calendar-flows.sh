#!/bin/bash
# 달력을 실제로 쓰는 흐름 (docs/plans/calendar-flows.md): the shared cases from docs/plans/calendar-flows-cases.json — the
# all-day order and the bands of multi-day events along a week row, the cut titles that take a second line, the week's
# first day from the system, and the day sheet's holiday line and faded lines (the Windows app's
# test/calendarFlows.test.ts reads the same file).
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/AppLanguage.swift \
    Sources/PaperCore/TodoItem.swift \
    Sources/PaperCore/TimeBlock.swift \
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
    Sources/PaperCore/Memo.swift \
    Sources/PaperCore/MemoFolders.swift \
    Sources/PaperCore/MemoTrash.swift \
    Sources/PaperCore/TodoSpaces.swift \
    Sources/PaperCore/Backup.swift \
    Sources/PaperCore/Focus.swift \
    Sources/PaperCore/FocusTimer.swift \
    Sources/PaperCore/TextMerge.swift \
    Sources/PaperCore/Intent.swift \
    Sources/PaperCore/DayRibbon.swift \
    Sources/PaperCore/SpaceGroups.swift \
    Sources/PaperCore/ListSelection.swift \
    Sources/PaperCore/DayStrip.swift \
    Sources/PaperCore/Ahead.swift \
    Sources/PaperCore/Convenience.swift \
    Sources/PaperCore/PetChatter.swift \
    Sources/PaperCore/BubbleText.swift \
    Sources/PaperCore/PetAsk.swift \
    Sources/PaperCore/SpaceDevice.swift \
    Sources/PaperCore/CalendarMonth.swift \
    Sources/PaperCore/CalendarWidget.swift \
    Sources/PaperCore/KoreanCalendar.swift \
    Tests/PaperCoreTests/CalendarFlowsTests.swift \
    -o .build/checks/CalendarFlowsTests
.build/checks/CalendarFlowsTests ../docs/plans/calendar-flows-cases.json
