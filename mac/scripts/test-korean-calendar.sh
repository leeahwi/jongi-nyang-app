#!/bin/bash
# 음력과 공휴일 (#234, KoreanCalendar.swift): the shared cases from docs/plans/calendar-korean-cases.json — lunar dates (ICU's
# Korean calendar), every day of 2020–2035 as one digest the Windows app must match, the cells' lunar labels, and every
# Korean public holiday of 2024–2030 with the substitute days (the Windows app's test/koreanCalendar.test.ts reads it too).
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
    Tests/PaperCoreTests/KoreanCalendarTests.swift \
    -o .build/checks/KoreanCalendarTests
.build/checks/KoreanCalendarTests ../docs/plans/calendar-korean-cases.json
