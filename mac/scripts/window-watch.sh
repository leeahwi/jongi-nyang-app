#!/bin/bash
# #217: runs a check under the window watch (scripts/window-watch.swift) and fails when a window of a test process was
# on a screen or a test process became the frontmost app. A test process is any program under this checkout's .build
# (every test copy and bench is built there) or any app with a test copy's bundle id (com.noa.PaperTodo.<…>, from any
# checkout: its program path is in the line). The installed app (com.noa.PaperTodo) is never counted.
#
#   scripts/window-watch.sh <command> [args …]      e.g. scripts/window-watch.sh scripts/perf.sh --quick
#
# The watch's lines go to WATCH_LOG (default .build/checks/window-watch.log). It prints a summary at the end and
# exits with the command's status, or 3 when something showed. The input-source indicator's windows are listed as a
# hint only (typing in another app shows it too).
set -uo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
[ $# -gt 0 ] || { echo "usage: scripts/window-watch.sh <command> [args …]" >&2; exit 2; }
mkdir -p "$repo/.build/checks"
watcher="$repo/.build/checks/window-watch"
log="${WATCH_LOG:-$repo/.build/checks/window-watch.log}"
if [ ! -x "$watcher" ] || [ "$repo/scripts/window-watch.swift" -nt "$watcher" ]; then
    swiftc -O "$repo/scripts/window-watch.swift" -o "$watcher" || { echo "could not build the window watch: no run without it" >&2; exit 2; }
fi
"$watcher" "$log" "$repo/.build" &
watch=$!
sleep 0.3
"$@"
status=$?
sleep 0.5
kill -TERM "$watch" 2>/dev/null
wait "$watch" 2>/dev/null
end=$(grep '^end ' "$log" | tail -1)
echo "== window watch: $(grep -c '^seen ' "$log") test processes seen · ${end#end * } · $log"
grep -E '^(on-screen|front|system) ' "$log" | head -20
if grep -qE '^(on-screen|front) ' "$log"; then exit 3; fi
exit $status
