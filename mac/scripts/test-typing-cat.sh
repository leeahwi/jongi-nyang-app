#!/bin/bash
# 치면 두드리는 고양이 (#230, TypingCat.swift): the shared cases from docs/plans/typing-cat-cases.json (the Windows app's
# test/typingCat.test.ts reads the same file) — paws, the 120 ms rest, no backlog, reduced motion, cleanup, the pet's
# other moments, in all apps' permission and the full-screen cat — and that nothing of a key is kept (TypingKeys.swift).
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/TypingCat.swift \
    Tests/PaperCoreTests/TypingCatTests.swift \
    -o .build/checks/TypingCatTests
.build/checks/TypingCatTests ../docs/plans/typing-cat-cases.json Sources/PaperTodo/TypingKeys.swift
