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
    Sources/PaperCore/Archive.swift \
    Sources/PaperCore/Repeat.swift \
    Sources/PaperCore/Deadline.swift \
    Sources/PaperCore/Shelf.swift \
    Sources/PaperCore/QuickParse.swift \
    Sources/PaperCore/TextMerge.swift \
    Sources/PaperCore/TaskReminderDue.swift \
    Tests/PaperCoreTests/TaskReminderTests.swift \
    -o .build/checks/TaskReminderTests
.build/checks/TaskReminderTests
