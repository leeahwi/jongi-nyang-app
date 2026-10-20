#!/bin/bash
# 입력 줄 · 하루 띠 (Intent.swift, DayRibbon.swift): the shared cases with the Windows app
# (test/intent.test.ts, listed in intent-cases.md), the learned preference, the day ribbon and 다음.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/AppLanguage.swift \
    Sources/PaperCore/TodoItem.swift \
    Sources/PaperCore/TimeBlock.swift \
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
    Tests/PaperCoreTests/IntentTests.swift \
    -o .build/checks/IntentTests
.build/checks/IntentTests
