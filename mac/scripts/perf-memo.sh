#!/bin/bash
# 메모 서랍 under load (docs/perf-memo-stress.md), per tier: the drawer's first open and reopen, ↓ through the list
# (each step picks and scrolls), ↩ on a memo, each key typed in it, the list catching up after the keys, Esc, whether
# the keys were saved, and memory. `long` also opens and types in memos of 10 KB, 100 KB and 1 MB and opens a
# 2,000-line checklist.
#
# #208: these used to be taken in a separate test copy of the app, brought to the front (`perf-probe front`), with its
# marker memo opened by an accessibility press that put the cursor in a text field and keys posted to it. That could
# bring up system windows such as the input-source indicator, even with every window of the copy off the screens. They
# are now taken in one process with no window on any screen (scripts/perf-drawer.sh, Tests/PaperTodoTests/
# DrawerBench.swift): borderless windows that never become key, the keys given to the text view directly. Nothing is
# brought forward or pressed, and no key goes through the system.
#
#   scripts/perf-memo.sh [tier …]      tiers: 50 500 2000 5000 long (default: all)
#
# #132: OPEN_CEILING ms (default 200) and CEILING_LOAD (default 6) as before: a first open or an ↩ over the ceiling
# fails the run when the 1-minute load is at most CEILING_LOAD. PROFILE=1 samples the keys (sample(1)); KEYS, RUNS,
# SAMPLE_MEMO and APP_SOURCES: see scripts/perf-drawer.sh. PERF_MEMO_OUT=<folder> keeps the build and the samples
# elsewhere (PERF_DRAWER_OUT).
set -euo pipefail
tiers=()
for arg in "$@"; do
    case "$arg" in
        --no-build) echo "(--no-build: there is no test copy to build now; scripts/perf-drawer.sh builds only what changed)" ;;
        --build-only) echo "(--build-only: there is no test copy any more; scripts/perf-drawer.sh builds its bench as it runs)"; exit 0 ;;
        *) tiers+=("$arg") ;;
    esac
done
[ ${#tiers[@]} -eq 0 ] && tiers=(50 500 2000 5000 long)
[ -n "${PERF_MEMO_OUT:-}" ] && export PERF_DRAWER_OUT="$PERF_MEMO_OUT"
exec "$(cd "$(dirname "$0")" && pwd)/perf-drawer.sh" "${tiers[@]}"
