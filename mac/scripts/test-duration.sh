#!/bin/bash
# 타이머 직접 정하기 (Duration.swift): the same cases as the Windows app (test/duration.test.ts).
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/AppLanguage.swift \
    Sources/PaperCore/TodoItem.swift \
    Sources/PaperCore/Archive.swift \
    Sources/PaperCore/Deadline.swift \
    Sources/PaperCore/Shelf.swift \
    Sources/PaperCore/Duration.swift \
    Tests/PaperCoreTests/DurationTests.swift \
    -o .build/checks/DurationTests
.build/checks/DurationTests
