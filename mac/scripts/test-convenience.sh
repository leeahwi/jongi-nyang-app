#!/bin/bash
# 편의 기능 (Convenience.swift and QuickParse's Korean relative times): the shared cases with the Windows app
# (test/convenience.test.ts, listed in convenience-cases.md) — 어제부터, 날짜 바꾸기, 다시 알림, 저녁 정리, 검색, the ribbon click.
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
    Sources/PaperCore/TextMerge.swift \
    Sources/PaperCore/Intent.swift \
    Sources/PaperCore/DayRibbon.swift \
    Sources/PaperCore/Ahead.swift \
    Sources/PaperCore/Convenience.swift \
    Sources/PaperCore/PetChatter.swift \
    Sources/PaperCore/BubbleText.swift \
    Sources/PaperCore/PetAsk.swift \
    Tests/PaperCoreTests/ConvenienceTests.swift \
    -o .build/checks/ConvenienceTests
.build/checks/ConvenienceTests
