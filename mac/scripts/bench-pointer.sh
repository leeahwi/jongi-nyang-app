#!/bin/bash
# #64: what moving the mouse over other apps costs the app (Tests/PaperTodoTests/PointerBench.swift) — the real pet and a
# click-through month widget, off every screen, in a process that never becomes active. No real mouse move is heard and
# the cursor is never moved: the bench hands the app 120 made-up moves a second through its own event queue. Checks the
# watch, then the main thread's CPU and wake-ups before (every move) and after (#64's pauses), taking turns. Nothing of
# the app's own data or settings is read or written.
#
#   scripts/bench-pointer.sh [seconds per turn, default 20] [turns, default 2]
set -euo pipefail
export PAPERTODO_OFFSCREEN=1
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
swift build -Xswiftc -warnings-as-errors 2>&1 | tail -1
bin_path="$(swift build --show-bin-path)"
out=.build/checks/pointer-bench
mkdir -p "$out"
rm -rf "$out"/*.lproj; cp -R Resources/*.lproj "$out/"
swiftc -O -warnings-as-errors -parse-as-library -I "$bin_path/Modules" \
    $(find Sources/PaperTodo -maxdepth 1 -name '*.swift' ! -name PaperTodoApp.swift | sort) \
    "$bin_path/PaperTodo.build/DerivedSources/resource_bundle_accessor.swift" \
    "$bin_path"/PaperCore.build/*.o Tests/PaperTodoTests/PointerBench.swift Tests/PaperTodoTests/TestDefaults.swift -o "$out/PointerBench"
"$out/PointerBench" "${1:-20}" "${2:-2}"
