#!/bin/bash
# 치면 두드리는 고양이 (#230): the pet controller's typing checked, then this process's CPU with the pet out — typing off,
# on at rest, 8 keys a second, at rest after a burst (Tests/PaperTodoTests/TypingCatBench.swift). Everything is off every
# screen, the process never becomes active, keys are calls (nothing real is heard) and Input Monitoring is a stand-in
# that never asks. Nothing of the app's own data or settings is read or written.
#
#   scripts/bench-typing-cat.sh [seconds per rest, default 30]
set -euo pipefail
export PAPERTODO_OFFSCREEN=1
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
swift build -Xswiftc -warnings-as-errors 2>&1 | tail -1
bin_path="$(swift build --show-bin-path)"
out=.build/checks/typing-bench
mkdir -p "$out"
rm -rf "$out"/*.lproj; cp -R Resources/*.lproj "$out/"
swiftc -O -warnings-as-errors -parse-as-library -I "$bin_path/Modules" \
    $(find Sources/PaperTodo -maxdepth 1 -name '*.swift' ! -name PaperTodoApp.swift | sort) \
    "$bin_path/PaperTodo.build/DerivedSources/resource_bundle_accessor.swift" \
    "$bin_path"/PaperCore.build/*.o Tests/PaperTodoTests/TypingCatBench.swift -o "$out/TypingCatBench"
"$out/TypingCatBench" "${1:-30}"
