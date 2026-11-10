#!/bin/bash
# 치면 두드리는 고양이 (#230 · #289, TypingCat.swift): the shared cases from docs/plans/typing-cat-cases.json (the Windows
# app's test/typingCat.test.ts reads the same file) — paws, the 120 ms rest, no backlog, reduced motion, cleanup, where
# keys are heard from (apart from the pet), when the cat is in its corner, the settings moved from the pet's, the menu's
# switch, in all apps' permission and the corner's frame — and that nothing of a key is kept (TypingKeys.swift).
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/ScreenFit.swift \
    Sources/PaperCore/TypingCat.swift \
    Tests/PaperCoreTests/TypingCatTests.swift \
    -o .build/checks/TypingCatTests
.build/checks/TypingCatTests ../docs/plans/typing-cat-cases.json Sources/PaperTodo/TypingKeys.swift
