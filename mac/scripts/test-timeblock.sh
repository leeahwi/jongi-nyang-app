#!/bin/bash
# 할 일 시간 정하기 (TimeBlock.swift with QuickParse, Intent and DayRibbon): the shared cases with the
# Windows app (test/timeblock.test.ts), listed in timeblock-cases.md.
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
    Tests/PaperCoreTests/TimeBlockTests.swift \
    -o .build/checks/TimeBlockTests
.build/checks/TimeBlockTests
