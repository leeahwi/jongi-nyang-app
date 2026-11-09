#!/bin/bash
# 메모 서랍 under load, in one process with no window on any screen (#3, Tests/PaperTodoTests/DrawerBench.swift): the
# drawer's first open and reopen, ↓ through the list, ↩ on a memo, each key typed in it, the list catching up after the
# keys, Esc and memory — the main thread's CPU per step, so a busy Mac moves the numbers less. It never brings anything
# forward, never presses anything through accessibility and never posts a key to the system: the keys go to the text
# view directly, and the windows are borderless (never key). scripts/perf-memo.sh runs it (#208).
#
#   scripts/perf-drawer.sh [tier …]      tiers: 50 500 2000 5000 long (default: 500 2000 5000 long)
#
# PERF_DRAWER_OUT=<folder> and APP_SOURCES=<a copy's Sources/PaperTodo> (its PaperCore must be this one's): another
# build of the app's views, to run by turns with this one. KEYS=20 keys per memo. RUNS=1 runs per tier (each a fresh
# process; with more, every number is listed per run).
# PROFILE=1: sample(1) from just before ↩ through Esc, into <out>/sample-<tier>-<run>.txt; SAMPLE_MEMO=STRESS-LONG-100K
# (or STRESS-CHECK-2000) picks the long tier's memo, the 1 MB one otherwise. PROFILE_OPEN=1: sample(1) of the drawer's
# first open and reopens, into <out>/sample-open-<tier>-<run>.txt.
# The windows have no slip motion (SlipMotion.enabled = false, as AppBench): a window off every screen gets no frames
# to run an animation on.
# OPEN_CEILING ms (default 150 since #3, 200 before, #132): an ↩ over it fails the run; FIRST_CEILING (150) the drawer's
# first open at 50–2,000 memos, FIRST_CEILING_BIG (200) at 5,000 and with the long memos — only when the 1-minute load
# is at most CEILING_LOAD (default 6); over that the run prints it without failing.
#
# Nothing of the app's own data is read or written: each tier is a temporary folder made by scripts/memo-stress-data.py.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
out="${PERF_DRAWER_OUT:-$root/.build/checks/perf-drawer}"
sources="${APP_SOURCES:-$root/Sources/PaperTodo}"
mkdir -p "$out"
swift build -c release --scratch-path .build/bench-release -Xswiftc -warnings-as-errors 2>&1 | tail -1
bin_path="$(swift build -c release --scratch-path .build/bench-release --show-bin-path)"
rm -rf "$out"/*.lproj; cp -R Resources/*.lproj "$out/"
bench="$out/DrawerBench"
if [ ! -x "$bench" ] || [ -n "$(find "$sources" Sources/PaperCore Tests/PaperTodoTests/DrawerBench.swift Tests/PaperTodoTests/TestDefaults.swift -newer "$bench" -name '*.swift' -print -quit)" ]; then
    swiftc -O -parse-as-library -I "$bin_path/Modules" \
        $(find "$sources" -name '*.swift' ! -name PaperTodoApp.swift | sort) \
        "$bin_path/PaperTodo.build/DerivedSources/resource_bundle_accessor.swift" \
        "$bin_path"/PaperCore.build/*.o Tests/PaperTodoTests/DrawerBench.swift Tests/PaperTodoTests/TestDefaults.swift -o "$bench"
fi
data="$(mktemp -d)"
trap 'rm -rf "$data"' EXIT
tiers=("$@"); [ ${#tiers[@]} -eq 0 ] && tiers=(500 2000 5000 long)
ceiling="${OPEN_CEILING:-150}"
status=0
echo "== 메모 서랍 in one process · $(date '+%Y-%m-%d %H:%M') · $(sw_vers -productVersion) · $(sysctl -n machdep.cpu.brand_string)"
for tier in "${tiers[@]}"; do
    case "$tier" in
        long) python3 -I scripts/memo-stress-data.py "$data/$tier" --memos 500 --long 10,100,1024 --checklist 2000 --marker >/dev/null ;;
        *) python3 -I scripts/memo-stress-data.py "$data/$tier" --memos "$tier" --marker >/dev/null ;;
    esac
    for run in $(seq 1 "${RUNS:-1}"); do
        cp -R "$data/$tier" "$data/$tier-run"
        load=$(sysctl -n vm.loadavg | awk '{print $2}')
        echo "-- tier $tier · run $run · load $(sysctl -n vm.loadavg)"
        # #3: the first open within 150 ms at 50 to 2,000 memos; 5,000 memos and the long memos (a 1 MB memo's card
        # words alone are 56 ms) within 200.
        case "$tier" in 5000|long) first="${FIRST_CEILING_BIG:-200}" ;; *) first="${FIRST_CEILING:-150}" ;; esac
        args=("$data/$tier-run" --keys "${KEYS:-20}" --ceiling "$ceiling" --open-ceiling "$first")
        [ "$tier" = long ] && args+=(--long)
        [ "${PROFILE:-0}" = 1 ] && args+=(--sample "$out/sample-$tier-$run.txt")
        [ -n "${SAMPLE_MEMO:-}" ] && args+=(--sample-memo "$SAMPLE_MEMO")
        [ "${PROFILE_OPEN:-0}" = 1 ] && args+=(--sample-open "$out/sample-open-$tier-$run.txt")
        if ! "$bench" "${args[@]}"; then
            if awk -v l="$load" -v m="${CEILING_LOAD:-6}" 'BEGIN {exit !(l <= m)}'; then status=1; else echo "  (over the ceiling at load $load: not counted)"; fi
        fi
        rm -rf "$data/$tier-run"
    done
done
exit $status
