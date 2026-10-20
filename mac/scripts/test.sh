#!/bin/bash
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
    Sources/PaperCore/NotebookFile.swift \
    Sources/PaperCore/Archive.swift \
    Sources/PaperCore/Repeat.swift \
    Sources/PaperCore/Deadline.swift \
    Sources/PaperCore/Shelf.swift \
    Sources/PaperCore/QuickParse.swift \
    Sources/PaperCore/TextMerge.swift \
    Sources/PaperCore/PetChatter.swift \
    Sources/PaperCore/BubbleText.swift \
    Sources/PaperCore/TimerSize.swift \
    Sources/PaperCore/CalendarDay.swift \
    Sources/PaperCore/CalendarDraft.swift \
    Sources/PaperCore/CalendarMonth.swift \
    Sources/PaperCore/LocalEvent.swift \
    Sources/PaperCore/Memo.swift \
    Sources/PaperCore/Alarm.swift \
    Sources/PaperCore/Duration.swift \
    Sources/PaperCore/Backup.swift \
    Sources/PaperCore/FocusTimer.swift \
    Sources/PaperCore/Focus.swift \
    Sources/PaperCore/DayRibbon.swift \
    Tests/PaperCoreTests/CoreTests.swift \
    -o .build/checks/PaperCoreTests
.build/checks/PaperCoreTests

