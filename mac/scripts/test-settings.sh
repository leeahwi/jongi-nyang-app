#!/bin/bash
# 글꼴 · 종이 설정 (#141 · #142, TextSteps.swift): the note's seven size steps and the drawer's nine, 1.45's settings read
# into them, line and paragraph spacing, where a paragraph ends — the shared cases from docs/plans/settings-cases.json
# (the Windows app's test/textSteps.test.ts reads the same file).
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
    Sources/PaperCore/MemoFolderSearch.swift \
    Sources/PaperCore/MemoCards.swift \
    Sources/PaperCore/MemoMarkdown.swift \
    Sources/PaperCore/MemoEdits.swift \
    Sources/PaperCore/TextMerge.swift \
    Sources/PaperCore/Intent.swift \
    Sources/PaperCore/DayRibbon.swift \
    Sources/PaperCore/Ahead.swift \
    Sources/PaperCore/Convenience.swift \
    Sources/PaperCore/PetChatter.swift \
    Sources/PaperCore/BubbleText.swift \
    Sources/PaperCore/PetAsk.swift \
    Sources/PaperCore/TextSteps.swift \
    Sources/PaperCore/PaperKind.swift \
    Sources/PaperCore/PaperLook.swift \
    Tests/PaperCoreTests/SettingsTests.swift \
    -o .build/checks/SettingsTests
.build/checks/SettingsTests ../docs/plans/settings-cases.json
