#!/bin/bash
# 기기마다 보일 스페이스 (SpaceDevice.swift, #196): the shared cases S60–S72 from docs/plans/spaces-cases.json → device
# (the Windows app reads the same file), S73 from → aiDevice (what ai-link.json carries for Claude, N3-9), then the Mac's own.
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
    Sources/PaperCore/AIConnect.swift \
    Sources/PaperCore/AIDeviceLink.swift \
    Tests/PaperCoreTests/SpaceDeviceTests.swift \
    -o .build/checks/SpaceDeviceTests
.build/checks/SpaceDeviceTests ../docs/plans/spaces-cases.json
