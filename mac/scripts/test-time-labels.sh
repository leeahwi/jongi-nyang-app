#!/bin/bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -parse-as-library -warnings-as-errors \
    Sources/PaperCore/AppLanguage.swift Sources/PaperCore/TodoItem.swift Sources/PaperCore/ReminderTimeText.swift \
    Sources/PaperCore/Archive.swift Sources/PaperCore/Deadline.swift Sources/PaperCore/Shelf.swift \
    Tests/PaperCoreTests/ReminderTimeTextTests.swift -o .build/checks/ReminderTimeTextTests
.build/checks/ReminderTimeTextTests
