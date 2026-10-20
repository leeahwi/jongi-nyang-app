#!/bin/bash
# 집중 (Focus.swift): the shared cases with the Windows app (test/focus.test.ts, listed in
# focus-cases.md) — focus.jsonl lines, totals by the 4 a.m. day, the summary, the tasks focused on
# longest, backups, the focus card's words and a session's steps.
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
    Sources/PaperCore/Memo.swift \
    Sources/PaperCore/TextMerge.swift \
    Sources/PaperCore/CalendarDay.swift \
    Sources/PaperCore/CalendarDraft.swift \
    Sources/PaperCore/LocalEvent.swift \
    Sources/PaperCore/DayRibbon.swift \
    Sources/PaperCore/FocusTimer.swift \
    Sources/PaperCore/Focus.swift \
    Sources/PaperCore/Backup.swift \
    Tests/PaperCoreTests/FocusTests.swift \
    -o .build/checks/FocusTests
.build/checks/FocusTests
