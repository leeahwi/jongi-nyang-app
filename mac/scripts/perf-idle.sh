#!/bin/bash
# 쉴 때 (#64): the test copy of scripts/perf-audit.sh (com.noa.PaperTodo.Perf2, its own data and preferences) at rest,
# with the note, the desk and the cat's strip far off every screen (`--offscreen`): CPU · wakeups per second and
# what woke it (`--perf-log` counts: model changes, the cat's frames and mouse events, 완료 기록 redraws).
#
#   scripts/perf-idle.sh [out-folder] [--no-build] [seconds]      PERF_DATA_ARGS for another data size;
#
# 1. the cat off, 2. the cat on (it wanders and blinks as in the app; 한마디 on), 3. 완료 기록 opened once (⌘Y) and
# the desk closed (⌘W), then 8 checks 1.5 s apart: the CPU over them. No reminder pops up (each counts as shown).
# The installed app and its data are never touched; everything the test copy wrote is removed at the end.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$repo/.build/perf-idle}"
case "$out" in --*) out="$repo/.build/perf-idle";; esac
build=1; seconds=60
for arg in "$@"; do
    [ "$arg" = "--no-build" ] && build=0
    [[ "$arg" =~ ^[0-9]+$ ]] && seconds="$arg"
done
bundle_id=${PERF_BUNDLE_ID:-com.noa.PaperTodo.Perf2}
mkdir -p "$out"
app="$out/PerfTest.app"; probe="$out/perf-probe"; log="$out/perf.log"
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
    : > "$log"
    open -n --env PAPERTODO_OFFSCREEN=1 "$app" --args --perf-log "$log" --offscreen
    for _ in $(seq 1 100); do pid=$(pgrep -f "$app/Contents/MacOS/PaperTodo" | head -1 || true); [ -n "$pid" ] && break; sleep 0.05; done
    for _ in $(seq 1 100); do grep -q '^noteVisible' "$log" 2>/dev/null && break; sleep 0.1; done
    sleep 1
    # Every window of the test copy must be off the screens (x 40,000 points away).
    if "$probe" windows "$pid" 2>/dev/null | tr -d '\n' | grep -Eq 'X = "?-?[0-9]{1,4}"?;'; then
        echo "a window of the test copy is on a screen: stopping"; exit 1
    fi
    sleep 7
}
# measure <label> <seconds>: CPU · wakeups and the counts over that time.
measure() {
    kill -USR2 "$pid"; sleep 0.3
    local result; result=$("$probe" sample "$pid" "$2")
    kill -USR2 "$pid"; sleep 0.5
    echo "$1: $result · $(grep '^counts' "$log" | tail -1)"
}

echo "== 종이냥 쉴 때 · $(date '+%Y-%m-%d %H:%M') · $(sw_vers -productVersion) · load $(sysctl -n vm.loadavg | awk '{print $2}') · data ${PERF_DATA_ARGS:-demo}"
run off; measure "note open, the cat off (${seconds} s)" "$seconds"
run on; measure "note open, the cat on (${seconds} s)" "$seconds"
"$probe" key "$pid" 16 cmd; sleep 4
"$probe" key "$pid" 13 cmd; sleep 3
measure "완료 기록 opened once, the desk closed (${seconds} s)" "$seconds"
"$probe" key "$pid" 45 cmd; sleep 0.5; "$probe" key "$pid" 126; sleep 2
kill -USR2 "$pid"; sleep 0.2
"$probe" sample "$pid" 13 > "$out/changes.txt" & sampler=$!
sleep 0.3
for _ in 1 2 3 4 5 6 7 8; do "$probe" key "$pid" 49; sleep 1.5; done
wait "$sampler"; kill -USR2 "$pid"; sleep 0.5
echo "  then 8 checks in 13 s: $(cat "$out/changes.txt") · $(grep '^counts' "$log" | tail -1)"
