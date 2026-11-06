#!/bin/bash
# 달력의 알림 할 일 (#227, CalendarMonth.swift): the shared cases from docs/plans/calendar-reminders-cases.json — a month
# cell's lines and +N, a week row's to-dos, the day panel's, the tooltips and hidden spaces (the Windows app's
# test/calendarReminders.test.ts reads the same file).
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
    Tests/PaperCoreTests/CalendarRemindersTests.swift \
    -o .build/checks/CalendarRemindersTests
.build/checks/CalendarRemindersTests ../docs/plans/calendar-reminders-cases.json
