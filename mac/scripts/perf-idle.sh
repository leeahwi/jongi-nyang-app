#!/bin/bash
# 쉴 때 (#64): the test copy of scripts/perf-audit.sh (com.noa.PaperTodo.Perf2, its own data and preferences) at rest,
# with the note, the desk and the cat's strip far off every screen (`--offscreen`): CPU · wakeups per second and
# what woke it (`--perf-log` counts: model changes, the cat's frames and mouse events, 완료 기록 redraws).
#
#   scripts/perf-idle.sh [out-folder] [--no-build] [seconds]      PERF_DATA_ARGS for another data size;
#   scripts/perf-idle.sh --self-test      only the on-screen check against sample lines of perf-probe (no build, no app)
#   PERF_PAPER=kraft (#244) draws the test copy on that paper (the idle CPU should be the default paper's).
#
# 1. the cat off, 2. the cat on (it wanders and blinks as in the app; 한마디 on; awake even when nobody is at the Mac,
# frames counted per clip: petFrame.walk …), 3. 완료 기록 opened once (⌘Y) and the desk closed (⌘W), then 8 checks
# 1.5 s apart: the CPU over them. No reminder pops up (each counts as shown).
# The installed app and its data are never touched; everything the test copy wrote is removed at the end.
# #217: the copy starts behind (`open -g`), never comes forward, and takes its keys (⌘Y, ⌘W, ⌘N, ↑, Space) from a file
# it reads (`--perf-drive`, Sources/PaperTodo/PerfDrive.swift): nothing is posted through the system.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"

# positions: reads `perf-probe windows` (one window a line: `<number> <layer> <title> x <x> y <y> w <w> h <h>`, #252) and
# exits 1 with the window's line when one is within 20,000 points of the origin on both axes (the test copy puts every
# window 40,000 away), 2 when no line has a position at all — the probe's lines changed shape (they once read `X = …`),
# and a check that reads nothing must not pass — else 0 with the number of windows read.
positions() {
    awk '{ x = ""; y = ""
           for (i = 1; i < NF; i++) { if ($i == "x") x = $(i + 1); if ($i == "y") y = $(i + 1) }
           if (x !~ /^-?[0-9]+$/ || y !~ /^-?[0-9]+$/) next
           read++
           if (x + 0 > -20000 && x + 0 < 20000 && y + 0 > -20000 && y + 0 < 20000) { print "on a screen: " $0; bad = 1 } }
         END { if (!read) { print "no window position read"; exit 2 }; if (bad) exit 1; print read " window(s), all off-screen" }'
}

if [ "${1:-}" = "--self-test" ]; then
    failed=0
    expect() { # expect <status> <label> <lines>
        local status=0; printf '%s\n' "$3" | positions >/dev/null || status=$?
        if [ "$status" = "$1" ]; then echo "ok   $2"; else echo "FAIL $2: exit $status, not $1"; failed=1; fi
    }
    expect 0 "every window 40,000 away" $'101 0 종이냥 x -40000 y -40000 w 420 h 560\n102 3 - x -39700 y -39900 w 260 h 250'
    expect 1 "the note on the screen" $'101 0 종이냥 x 120 y 80 w 420 h 560\n102 3 - x -39700 y -39900 w 260 h 250'
    expect 1 "within 20,000 points on both axes" $'101 0 종이냥 x -300 y 19999 w 420 h 560'
    expect 0 "far on one axis, a title with x and y in it" $'101 0 x y x 400 y -40000 w 420 h 560'
    expect 2 "the old shape (X = …)" $'{ X = -40000; Y = -40000; }'
    expect 2 "nothing listed" ""
    exit $failed
fi

out="${1:-$repo/.build/perf-idle}"
# A first argument that is an option or the seconds is not the folder.
case "$out" in --*|[0-9]*) out="$repo/.build/perf-idle";; esac
build=1; seconds=60
for arg in "$@"; do
    [ "$arg" = "--no-build" ] && build=0
    [[ "$arg" =~ ^[0-9]+$ ]] && seconds="$arg"
done
bundle_id=${PERF_BUNDLE_ID:-com.noa.PaperTodo.Perf2}
mkdir -p "$out"
# The app opens the log and the commands by these paths from its own folder: absolute ones.
out="$(cd "$out" && pwd)"
app="$out/PerfTest.app"; probe="$out/perf-probe"; log="$out/perf.log"; commands="$out/perf-drive.txt"
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

# run <pet on|off>: fresh data and preferences, then the test copy with everything off-screen.
run() {
    stop
    rm -rf "$storage"; mkdir -p "$storage"
    python3 -I "$repo/scripts/perf-data.py" "$storage" ${PERF_DATA_ARGS:-} >/dev/null
    python3 -I -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); [t.__setitem__("reminderLastDeliveredAt", t["reminderAt"]) for t in d["items"] if "reminderAt" in t]; json.dump(d, open(p, "w"), ensure_ascii=False)' "$storage/todos.json"
    defaults delete "$bundle_id" >/dev/null 2>&1 || true
    for key in quickEntry.enabled quickMemo.enabled noteHotKey.enabled sweep.enabled reminder.enabled; do
        defaults write "$bundle_id" "$key" -bool false
    done
    local on=false; [ "$1" = on ] && on=true
    defaults write "$bundle_id" pet.visible -bool $on
    defaults write "$bundle_id" chatter.enabled -bool $on
    defaults write "$bundle_id" drawer.shortcut -data ""
    defaults write "$bundle_id" memoDrawer.moveNoticeShown -bool true
    defaults write "$bundle_id" guide.seen -bool true
    defaults write "$bundle_id" login.asked -bool true
    defaults write "$bundle_id" systemNotices off
    defaults write "$bundle_id" AppleLanguages -array ko
    if [ -n "${PERF_PAPER:-}" ]; then defaults write "$bundle_id" paper.theme -string "$PERF_PAPER"; fi
    : > "$log"; : > "$commands"
    open -g -n --env PAPERTODO_OFFSCREEN=1 "$app" --args --perf-log "$log" --offscreen --perf-drive "$commands"
    for _ in $(seq 1 100); do pid=$(pgrep -f "$app/Contents/MacOS/PaperTodo" | head -1 || true); [ -n "$pid" ] && break; sleep 0.05; done
    for _ in $(seq 1 100); do grep -q '^noteVisible' "$log" 2>/dev/null && break; sleep 0.1; done
    sleep 1
    offscreen_check
    sleep 7
}
# drive <command>: the test copy's input (PerfDrive: key <code> [mods]), done in order.
drive() { echo "$*" >> "$commands"; }
# Every shown window of the test copy off the screens, as the window server has it (against every display, then by
# its place: 40,000 points away, `positions`); nothing the app moved off. No position read stops the run as well.
offscreen_check() {
    if ! "$probe" offscreen "$pid"; then echo "a window of the test copy is on a screen: stopping"; exit 1; fi
    local windows found status=0
    windows=$("$probe" windows "$pid" 2>&1 || true)
    found=$(printf '%s\n' "$windows" | positions) || status=$?
    case "$status" in
        0) echo "  ($found)" ;;
        1) echo "$found"; echo "a window of the test copy is on a screen: stopping"; exit 1 ;;
        *) echo "$windows"; echo "perf-probe gave no window position (x … y …) for the test copy: stopping, the check can't see"; exit 1 ;;
    esac
    if grep -q '^onscreen' "$log"; then grep '^onscreen' "$log"; echo "the test copy put a window on a screen: stopping"; exit 1; fi
}
# measure <label> <seconds>: CPU · wakeups and the counts over that time.
measure() {
    kill -USR2 "$pid"; sleep 0.3
    local result; result=$("$probe" sample "$pid" "$2")
    kill -USR2 "$pid"; sleep 0.5
    echo "$1: $result · $(grep '^counts' "$log" | tail -1)"
}

echo "== 종이냥 쉴 때 · $(date '+%Y-%m-%d %H:%M') · $(sw_vers -productVersion) · load $(sysctl -n vm.loadavg | awk '{print $2}') · data ${PERF_DATA_ARGS:-demo} · paper ${PERF_PAPER:-day}"
run off; measure "note open, the cat off (${seconds} s)" "$seconds"
run on; measure "note open, the cat on (${seconds} s)" "$seconds"
drive key 16 cmd; sleep 4
drive key 13 cmd; sleep 3
# ⌘W goes to the front window (PerfDrive; 2026-10-31, when it went to the key window, the desk stayed open and each check
# below redrew 완료 기록 — historyBody=8). Said here, so the line below isn't read as a closed desk.
if "$probe" windows "$pid" | grep -q "완료 기록"; then echo "(the desk stayed open: ⌘W went to another window)"; fi
measure "완료 기록 opened once, the desk closed (${seconds} s)" "$seconds"
drive key 45 cmd; sleep 0.5; drive key 126; sleep 2
kill -USR2 "$pid"; sleep 0.2
"$probe" sample "$pid" 13 > "$out/changes.txt" & sampler=$!
sleep 0.3
for _ in 1 2 3 4 5 6 7 8; do drive key 49; sleep 1.5; done
wait "$sampler"; kill -USR2 "$pid"; sleep 0.5
echo "  then 8 checks in 13 s: $(cat "$out/changes.txt") · $(grep '^counts' "$log" | tail -1)"
offscreen_check
if grep -q '^drive ' "$log"; then echo "commands the test copy couldn't do:"; grep '^drive ' "$log" | sort | uniq -c; fi
