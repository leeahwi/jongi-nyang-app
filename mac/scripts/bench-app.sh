#!/bin/bash
# Perf audit 2 (docs/perf-audit-2.md): the app's views and model timed on demo data, with no window on screen.
# Builds the app's sources with Tests/PaperTodoTests/AppBench.swift (optimised, like a release), fills a temporary
# folder per size with scripts/perf-data.py and runs the bench on it. Nothing of the app's own data is read or written.
#
#   scripts/bench-app.sh [size …]      sizes: base 500 2000 5000 3y (default: base 2000 3y); RUNS=5; ONLY=core,model,…
#   CHECK=1: the steps with a ceiling (#61–#63) fail the run when over it.
#
# base = the demo set (165 to-dos, 80 memos, 2,000 record lines over 300 days, 60 events);
# 500/2000/5000 = that many to-dos with 9 spaces, 200 memos, a year of record (2,000 lines) and 60 events;
# 3y = 2,000 to-dos, 9 spaces, 200 memos, three years of record (6,000 lines) and 200 events (every fifth repeating).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
out=.build/checks/bench-app
mkdir -p "$out"
swift build -c release --scratch-path .build/bench-release -Xswiftc -warnings-as-errors 2>&1 | tail -1
bin_path="$(swift build -c release --scratch-path .build/bench-release --show-bin-path)"
rm -rf "$out"/*.lproj; cp -R Resources/*.lproj "$out/"
bench="$out/AppBench"
if [ ! -x "$bench" ] || [ -n "$(find Sources Tests/PaperTodoTests/AppBench.swift -newer "$bench" -name '*.swift' -print -quit)" ]; then
    swiftc -O -parse-as-library -I "$bin_path/Modules" \
        $(find Sources/PaperTodo -name '*.swift' ! -name PaperTodoApp.swift | sort) \
        "$bin_path/PaperTodo.build/DerivedSources/resource_bundle_accessor.swift" \
        "$bin_path"/PaperCore.build/*.o Tests/PaperTodoTests/AppBench.swift -o "$bench"
fi
data="$(mktemp -d)"
trap 'rm -rf "$data"' EXIT
sizes=("$@"); [ ${#sizes[@]} -eq 0 ] && sizes=(base 2000 3y)
for size in "${sizes[@]}"; do
    case "$size" in
        base) python3 -I scripts/perf-data.py "$data/$size" >/dev/null ;;
        3y) python3 -I scripts/perf-data.py "$data/$size" --todos 2000 --spaces 9 --memos 200 --history 6000 --history-days 1095 --events 200 >/dev/null ;;
        *) python3 -I scripts/perf-data.py "$data/$size" --todos "$size" --spaces 9 --memos 200 --history 2000 --history-days 365 >/dev/null ;;
    esac
    echo "== $size"
    "$bench" "$data/$size" --runs "${RUNS:-5}" ${ONLY:+--only "$ONLY"} ${CHECK:+--check}
done
