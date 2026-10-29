#!/bin/bash
# 성능 점검 2 (perf audit 2, docs/perf-audit-2.md): the same test copy and helpers as scripts/perf.sh, with the steps
# the audit added — cold and warm start, idle with the note open and hidden, a check with 0 and 200 steps of undo
# behind it, the tab switch, typing and the drawer — all with the note and drawer off every screen (nothing else is
# opened; scripts/perf-idle.sh measures the cat and 완료 기록, off-screen too). The bundle id defaults to
# com.noa.PaperTodo.Perf2. Before 1.45 the note, a titled window, was pulled back to the screen's left edge.
#
#   scripts/perf-audit.sh [out-folder] [--no-build]      PERF_DATA_ARGS="--todos 2000 --spaces 9" for another size;
#   PERF_SCRATCH="$PWD/.build/bench-release" reuses the release build of scripts/bench-app.sh.
#
# (What follows is scripts/perf.sh's header.) 성능 점검 (1.39): builds a separate test copy (bundle id com.noa.PaperTodo.LiveTest, never dist/),
# fills its own storage folder with the demo data set (scripts/perf-data.py), runs it, drives it by its
# pid only, and prints the key numbers. The installed app and its data are never touched.
#
#   scripts/perf.sh [out-folder] [--quick] [--no-build] [--spaces]      (PERF_AI=1: with AI 연결 on)
#
# --spaces (1.45, 할 일 스페이스): 2,000 to-dos and 9 spaces; cold start, typing (also a `#` line), the tab switch and
# one space shown (⌘⌥1–9 · ⌘⌥0), then it stops. A 1.44 build ignores todo-spaces.json, so the same run times it
# against 1.44 (copy this script and perf-data.py into a 1.44 tree). PERF_BUNDLE_ID: another test copy's id (two
# checks at once must not share one; the default is com.noa.PaperTodo.LiveTest). Another size with --spaces:
# PERF_DATA_ARGS="--todos 500" (perf-data.py takes the first --todos).
#
# --quick skips the 10-minute use loop (memory after use). The last step (1.44) measures the drawer with its
# backdrop 반투명. Everything the test copy wrote (storage
# folder, preferences, saved state) is removed at the end.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$repo/.build/perf-audit}"
case "$out" in --*) out="$repo/.build/perf-audit";; esac
quick=0; build=1; spaces=0
for arg in "$@"; do
    [ "$arg" = "--quick" ] && quick=1
    [ "$arg" = "--no-build" ] && build=0
    [ "$arg" = "--spaces" ] && spaces=1
done
[ "$spaces" = 1 ] && PERF_DATA_ARGS="${PERF_DATA_ARGS:-} --todos 2000 --spaces 9"
bundle_id=${PERF_BUNDLE_ID:-com.noa.PaperTodo.Perf2}
mkdir -p "$out"
app="$out/PerfTest.app"
probe="$out/perf-probe"
log="$out/perf.log"
storage="$HOME/Library/Application Support/$bundle_id"

if [ "$build" = 1 ]; then
    cd "$repo"
    swift build -c release -Xswiftc -warnings-as-errors --scratch-path "${PERF_SCRATCH:-$out/build}" 2>&1 | tail -1
    bin="$(swift build -c release --scratch-path "${PERF_SCRATCH:-$out/build}" --show-bin-path)"
    rm -rf "$app"; mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
    cp "$bin/PaperTodo" "$app/Contents/MacOS/PaperTodo"
    cp Resources/Info.plist "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleName PerfTest" "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName PerfTest" "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Delete :LSHasLocalizedDisplayName" "$app/Contents/Info.plist" || true
    cp -R Sources/PaperTodo/Assets "$app/Contents/Resources/"
    cp -R Resources/*.lproj "$app/Contents/Resources/"
    rm -f "$app"/Contents/Resources/*.lproj/InfoPlist.strings
    [ -d "$bin/PaperTodo_PaperTodo.bundle" ] && cp -R "$bin/PaperTodo_PaperTodo.bundle" "$app/Contents/Resources/" || true
    codesign --force --deep --sign - "$app" 2>/dev/null
    swiftc -O "$repo/scripts/perf-probe.swift" -o "$probe" 2>&1 | grep -v warning || true
fi

pid=""
stop() {
    if [ -n "$pid" ]; then
        kill "$pid" 2>/dev/null || true
        for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    fi
    pid=""
}
cleanup() {
    stop
    rm -rf "$storage" "$HOME/Library/Saved Application State/$bundle_id.savedState" \
        "$HOME/Library/Caches/$bundle_id" "$HOME/Library/HTTPStorages/$bundle_id"
    defaults delete "$bundle_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fresh() {
    stop
    rm -rf "$storage"; mkdir -p "$storage"
    python3 -I "$repo/scripts/perf-data.py" "$storage" ${PERF_DATA_ARGS:-} >/dev/null
    defaults delete "$bundle_id" >/dev/null 2>&1 || true
    # No global shortcuts, notices or asking: the test copy must not get in the way of the real app.
    for key in quickEntry.enabled quickMemo.enabled noteHotKey.enabled pet.visible sweep.enabled chatter.enabled; do
        defaults write "$bundle_id" "$key" -bool false
    done
    # 메모 서랍 (1.43): its shortcut off (the drawer opens from the 윈도우 menu here); no move notice.
    defaults write "$bundle_id" drawer.shortcut -data ""
    defaults write "$bundle_id" memoDrawer.moveNoticeShown -bool true
    defaults write "$bundle_id" guide.seen -bool true
    defaults write "$bundle_id" login.asked -bool true
    defaults write "$bundle_id" systemNotices off
    defaults write "$bundle_id" AppleLanguages -array ko
    # PERF_AI=1: AI 연결 on (1.42) — the folder and ai-log.jsonl watched.
    [ "${PERF_AI:-0}" = 1 ] && defaults write "$bundle_id" ai.enabled -bool true
    return 0
}

launch() {
    : > "$log"
    # Through Launch Services, like a click in Finder: the note comes up in front.
    # --offscreen: the note, the drawer and its handle far off every screen, out of the user's way.
    open -n "$app" --args --perf-log "$log" --offscreen
    for _ in $(seq 1 100); do pid=$(pgrep -f "$app/Contents/MacOS/PaperTodo" | head -1 || true); [ -n "$pid" ] && break; sleep 0.05; done
    for _ in $(seq 1 100); do grep -q '^noteVisible' "$log" 2>/dev/null && break; sleep 0.1; done
    sleep 1.5
}

last() { { grep "^$1" "$log" || true; } | tail -${2:-1} | awk '{print $NF}'; }
median() { sort -n | awk '{a[NR]=$1} END {if (NR==0) print "-"; else if (NR%2) print a[(NR+1)/2]; else printf "%.2f\n", (a[NR/2]+a[NR/2+1])/2}'; }
max() { sort -n | tail -1; }
mark() { echo "# $1" >> "$log"; }
# settle <mark> <prefix> <count> [seconds]: waits until that many lines starting with prefix came in after the
# mark (a busy app answers late: its lines must land before the closing mark), at most `seconds` (default 30).
settle() {
    local deadline=$((SECONDS + ${4:-30}))
    while [ $SECONDS -lt $deadline ]; do
        local got
        got=$(awk -v m="# $1" -v p="$2" '$0==m{n=0;on=1;next} on && index($0,p)==1 {n++} END {print n+0}' "$log")
        [ "$got" -ge "$3" ] && break
        sleep 0.3
    done
    sleep 0.5
}
between() { awk -v from="# $1" -v to="# $2" '$0==from{on=1;next} $0==to{on=0} on' "$log"; }
# vals <from> <to> <prefix>: the app's own time (the line's last number) of the lines starting with prefix
# between two marks; total: from the event's timestamp (with the system's delivery).
vals() { between "$1" "$2" | awk -v p="$3" 'index($0, p) == 1 {print $NF}'; }
totals() { between "$1" "$2" | awk -v p="$3" 'index($0, p) == 1 {print $(NF-1)}'; }
first() { vals "$@" | head -1; }
firsttotal() { totals "$@" | head -1; }

echo "== 종이냥 성능 점검 2 · $(date '+%Y-%m-%d %H:%M') · $(sw_vers -productVersion) · load $(sysctl -n vm.loadavg | awk '{print $2}') · data ${PERF_DATA_ARGS:-demo}"

# 1. Start: the first launch after a build (the system's first look at the binary: cold), then three more (warm).
starts=()
for run in 1 2 3 4; do fresh; launch; starts+=("$(last noteVisible)"); done
echo "start → note visible (ms): cold ${starts[0]} · warm ${starts[*]:1} (median $(printf '%s\n' "${starts[@]:1}" | median))"
echo "memory after start: $("$probe" mem "$pid")"

# 2. Idle, note open and hidden (30 s each).
sleep 3
echo "idle, note open (30 s): $("$probe" sample "$pid" 30)"
# PERF_SAMPLE=1: what wakes the idle note (macOS `sample`, 10 s, this test copy only).
[ "${PERF_SAMPLE:-0}" = 1 ] && sample "$pid" 10 -file "$out/sample-idle.txt" >/dev/null 2>&1 || true

# 3. A check with nothing behind it in undo (↑ from the empty input line picks the last row; Space checks it, again unchecks).
check_times() {  # check_times <name> <rounds>: each Space timed to its frame (a mark of its own per round)
    local all="" n
    for n in $(seq 1 "$2"); do
        mark "$1-$n"; "$probe" key "$pid" 49; settle "$1-$n" "key 49" 1 60; mark "$1-$n-end"
        all="$all $(first "$1-$n" "$1-$n-end" "key 49")"; sleep 0.8
    done
    echo "$all" | tr ' ' '\n' | grep -v '^$'
}
"$probe" key "$pid" 45 cmd; sleep 0.5
mark up; "$probe" key "$pid" 126; settle up "key 126" 1 90; mark up-end
echo "↑ from the input line, the last row picked (app): $(first up up-end "key 126") ms"
# PERF_SAMPLE=1: the main thread sampled (macOS `sample`, this test copy only) through one check.
if [ "${PERF_SAMPLE:-0}" = 1 ]; then
    sample "$pid" 6 -file "$out/sample-check.txt" >/dev/null 2>&1 &
    sampler=$!; sleep 0.5
    mark sampled; "$probe" key "$pid" 49; settle sampled "key 49" 1 60; mark sampled-end
    echo "  (sampled) check: $(first sampled sampled-end "key 49") ms → $out/sample-check.txt"
    wait "$sampler" || true
    "$probe" key "$pid" 49; sleep 3
fi
c0=$(check_times check0 6)
echo "check / uncheck, undo depth ~0 (app, ms): $(echo $c0) · median $(echo "$c0" | median)"
# PERF_FILL (default 200) steps of undo behind: the same row checked and unchecked, each key after the last one's
# frame (keys sent faster than the app draws would queue, and each would then count the ones before it).
fill_count=${PERF_FILL:-200}
if [ "$fill_count" -gt 0 ]; then
    mark fill
    for n in $(seq 1 "$fill_count"); do mark "fill-$n"; "$probe" key "$pid" 49; settle "fill-$n" "key 49" 1 60; done
    mark fill-end
    fill=$(vals fill fill-end "key 49")
    echo "  filling $fill_count steps (app, per check): median $(echo "$fill" | median) ms · max $(echo "$fill" | max) ms · last 20 median $(echo "$fill" | tail -20 | median) ms"
    c200=$(check_times check200 6)
    echo "check / uncheck, undo depth $fill_count (app, ms): $(echo $c200) · median $(echo "$c200" | median)"
fi
"$probe" key "$pid" 53; sleep 0.4

# 4. Tab switch ⌘2 ⌘1 (three rounds) and typing, now with the undo stack full.
mark tabs
for _ in 1 2 3; do for code in 19 18; do "$probe" key "$pid" "$code" cmd; sleep 0.8; done; done
settle tabs "key " 6 60
mark tabs-end
tabs=$(vals tabs tabs-end key)
echo "tab switch 오늘↔앞으로 (app): median $(echo "$tabs" | median) ms · max $(echo "$tabs" | max) ms"
"$probe" key "$pid" 45 cmd; sleep 0.6
mark typing
"$probe" type "$pid" "내일 3시 회의 준비하기 #회사" 150
settle typing "key 0 " 15 90
mark typing-end
keys=$(vals typing typing-end key)
echo "typing (app): first $(echo "$keys" | head -1) ms · rest median $(echo "$keys" | tail -n +2 | median) ms · p95-ish max $(echo "$keys" | tail -n +2 | max) ms ($(echo "$keys" | wc -l | tr -d ' ') keys)"
"$probe" key "$pid" 53; sleep 0.4; "$probe" key "$pid" 53; sleep 0.4

# 5. 메모 서랍 (off-screen) open, idle with it open, closed; then the note hidden (⌘W), idle.
drawer_menu() { "$probe" menu "$pid" "윈도우" "메모 서랍" >/dev/null 2>&1 || true; }
mark drawer1; drawer_menu; settle drawer1 "drawer " 1 15; mark drawer1-end
echo "open drawer (first, app): $(first drawer1 drawer1-end "drawer ") ms"
sleep 2
echo "idle, drawer open (30 s): $("$probe" sample "$pid" 30)"
drawer_menu; sleep 1
"$probe" key "$pid" 13 cmd; sleep 3
echo "idle, note hidden (30 s): $("$probe" sample "$pid" 30)"
mark reopen; "$probe" key "$pid" 29 cmd; settle reopen "key " 1; mark reopen-end
echo "warm reopen (⌘0, app): $(first reopen reopen-end key) ms"
echo "memory at the end: $("$probe" mem "$pid")"
echo "files written in the whole run: $(grep -c '^io' "$log" || true) (todos $(grep -c '^io todos' "$log" || true))"
cp "$log" "$out/perf-audit-last.log"
