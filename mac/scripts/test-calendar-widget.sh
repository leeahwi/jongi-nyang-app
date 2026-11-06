#!/bin/bash
# 바탕화면 달력 위젯 (#234, CalendarWidget.swift): the shared cases from docs/plans/calendar-widget-cases.json — what each
# kind shows, the day sheet, the opacity rules, places on displays, the quick entry's reading, the stored settings and
# when a widget draws again (the Windows app's test/calendarWidget.test.ts reads the same file).
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
    Tests/PaperCoreTests/CalendarWidgetTests.swift \
    -o .build/checks/CalendarWidgetTests
.build/checks/CalendarWidgetTests ../docs/plans/calendar-widget-cases.json
