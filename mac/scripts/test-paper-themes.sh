#!/bin/bash
# 종이 테마 열다섯 가지 (#244, PaperKind.swift · PaperLook.swift): the papers and their names, the paper drawn and the system
# controls' lightness, the drawer with 노트와 같은 종이, 1.47's settings moved, what is saved read back, the widget's paper
# and the tiles' order — the shared cases from docs/plans/paper-themes-cases.json (the Windows app's test/paper.test.ts reads
# the same file). The colours: scripts/test-contrast.sh.
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
    Sources/PaperCore/PaperKind.swift \
    Sources/PaperCore/PaperLook.swift \
    Tests/PaperCoreTests/PaperThemesTests.swift \
    -o .build/checks/PaperThemesTests
.build/checks/PaperThemesTests ../docs/plans/paper-themes-cases.json

# 8-3 · W3: picking a paper redraws every open window once (between two light papers too) and nothing while idle. The
# windows are drawn to bitmaps and never shown.
bin_path="$(swift build --show-bin-path)"
todo_sources=()
while IFS= read -r source; do
    todo_sources+=("$source")
done < <(find Sources/PaperTodo -maxdepth 1 -name '*.swift' ! -name 'PaperTodoApp.swift' -print | sort)
swiftc -warnings-as-errors -parse-as-library -I "$bin_path/Modules" \
    "${todo_sources[@]}" \
    "$bin_path/PaperTodo.build/DerivedSources/resource_bundle_accessor.swift" \
    "$bin_path"/PaperCore.build/*.swift.o \
    Tests/PaperTodoTests/PaperThemeRedrawTests.swift \
    Tests/PaperTodoTests/TestDefaults.swift \
    -o .build/checks/PaperThemeRedrawTests
PAPERTODO_OFFSCREEN=1 .build/checks/PaperThemeRedrawTests
