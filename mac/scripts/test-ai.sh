#!/bin/bash
# 종이냥 for Claude (AIConnect.swift, Notebook.adopt): the log, texts, undo, the away notice, marks — the app's
# side of the shared cases M13–M15 (the shared AI connection spec, docs/ai-connect-plan.md).
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
    Sources/PaperCore/AIConnect.swift \
    Tests/PaperCoreTests/AIConnectTests.swift \
    -o .build/checks/AIConnectTests
.build/checks/AIConnectTests
