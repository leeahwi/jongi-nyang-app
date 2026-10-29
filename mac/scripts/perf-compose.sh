#!/bin/bash
# 메모 서랍, Korean as the input method types it (Tests/PaperTodoTests/ComposeBench.swift): marked jamo, then the
# syllable committed, in a memo open in a short folder on 모눈 노트, the drawer in a window off every screen. Per key
# the main thread's CPU time for it and what it set off; whether the memo list moved while composing.
#
#   scripts/perf-compose.sh [tier …]      tiers: memo counts (default: 50 2000)
#
# Run it from any copy of the app's sources (it builds that copy); nothing of the app's own data is touched.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
swift build 2>&1 | tail -1
bin_path="$(swift build --show-bin-path)"
mkdir -p .build/checks
sources=()
while IFS= read -r source; do sources+=("$source"); done < <(find Sources/PaperTodo -maxdepth 1 -name '*.swift' ! -name 'PaperTodoApp.swift' -print | sort)
swiftc -O -parse-as-library -I "$bin_path/Modules" "${sources[@]}" "$bin_path/PaperTodo.build/DerivedSources/resource_bundle_accessor.swift" \
    "$bin_path"/PaperCore.build/*.swift.o "$(dirname "$0")/../Tests/PaperTodoTests/ComposeBench.swift" -o .build/checks/ComposeBench 2>&1 | grep -v "warning:" || true
data="$(mktemp -d)"
trap 'rm -rf "$data"' EXIT
tiers=("$@")
[ ${#tiers[@]} -eq 0 ] && tiers=(50 2000)
for tier in "${tiers[@]}"; do
    python3 -I scripts/memo-stress-data.py "$data/$tier" --memos "$tier" >/dev/null
    .build/checks/ComposeBench "$data/$tier" --rounds 3
done
