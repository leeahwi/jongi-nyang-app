#!/bin/bash
# #64 (PointerPace.swift): how long the app may stop hearing the mouse while the pointer is far from the cat and the
# widgets, and that a pointer no faster than a hand is never over them unheard. Pure rules; nothing is shown or heard.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/PointerPace.swift \
    Tests/PaperCoreTests/PointerPaceTests.swift \
    -o .build/checks/PointerPaceTests
.build/checks/PointerPaceTests
