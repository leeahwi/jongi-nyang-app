#!/bin/bash
# Keys from any app (GlobalShortcut.swift, #85): which keys the note and the drawer may take, the note's saved key, and
# when its key hides it — the cases S1–S14 shared with the Windows app (test/shortcuts.test.ts).
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/GlobalShortcut.swift \
    Sources/PaperCore/NoteLayer.swift \
    Tests/PaperCoreTests/ShortcutTests.swift \
    -o .build/checks/ShortcutTests
.build/checks/ShortcutTests
