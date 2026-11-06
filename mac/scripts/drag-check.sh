#!/bin/bash
# 하루 일정표 끌기 점검 (1.41): builds a separate debug test copy (bundle id com.noa.PaperTodo.LiveTest, never dist/),
# gives it one to-do at 09:00 (90 minutes) on a note whose clock is stopped at 09:00 (`--timetable-now`, #243: the
# timetable opens at 08:00 and the drags have the same room whenever the check runs — at this hour, an afternoon run had
# no room left before 24:00), opens it with --timetable-replay (TimetableReplay.swift), which replays mouse drags through
# the app's real event path — move, stretch the bottom, stretch the top, Esc, past the viewport's bottom, and held there
# to the day's end — and logs, every tick, the pointer and where the block was drawn. Then drag-check.py checks that the
# block followed the pointer and stopped at 24:00 with the scrolling. The installed app and its data are never touched;
# the copy is stopped by its pid and everything it wrote is removed.
#
#   scripts/drag-check.sh [out-folder] [--no-build]      (DRAG_CHECK_ARGS: more launch arguments;
#                                                         DRAG_CHECK_AT=HH:MM: the block and the clock at another hour,
#                                                         04:00–21:59)
#
# #217: the copy starts behind (`open -g`), never comes forward, and its note is far off every screen (`--offscreen`):
# the replay needs no screen, it calls the drag's own closures and sends Esc to the window itself.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$repo/.build/drag-check}"
case "$out" in --*) out="$repo/.build/drag-check";; esac
build=1
for arg in "$@"; do [ "$arg" = "--no-build" ] && build=0; done
bundle_id=com.noa.PaperTodo.LiveTest
mkdir -p "$out"
# The copy writes its log by this path from its own folder: an absolute one.
out="$(cd "$out" && pwd)"
app="$out/DragCheck.app"
log="$out/drag.jsonl"
probe="$out/perf-probe"
storage="$HOME/Library/Application Support/$bundle_id"

if [ "$build" = 1 ]; then
    cd "$repo"
    swift build -Xswiftc -warnings-as-errors --scratch-path "$out/build" 2>&1 | tail -1
    bin="$(swift build --scratch-path "$out/build" --show-bin-path)"
    rm -rf "$app"; mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
    cp "$bin/PaperTodo" "$app/Contents/MacOS/PaperTodo"
    cp Resources/Info.plist "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleName DragCheck" "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName DragCheck" "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Delete :LSHasLocalizedDisplayName" "$app/Contents/Info.plist" || true
    cp -R Sources/PaperTodo/Assets "$app/Contents/Resources/"
    cp -R Resources/*.lproj "$app/Contents/Resources/"
    rm -f "$app"/Contents/Resources/*.lproj/InfoPlist.strings
    [ -d "$bin/PaperTodo_PaperTodo.bundle" ] && cp -R "$bin/PaperTodo_PaperTodo.bundle" "$app/Contents/Resources/" || true
    codesign --force --deep --sign - "$app" 2>/dev/null
    swiftc -O "$repo/scripts/perf-probe.swift" -o "$probe" 2>&1 | grep -v warning || true
fi

pid=""
cleanup() {
    if [ -n "$pid" ]; then
        kill "$pid" 2>/dev/null || true
        for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    fi
    rm -rf "$storage" "$HOME/Library/Saved Application State/$bundle_id.savedState" \
        "$HOME/Library/Caches/$bundle_id" "$HOME/Library/HTTPStorages/$bundle_id"
    defaults delete "$bundle_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT

at="${DRAG_CHECK_AT:-09:00}"
[[ "$at" =~ ^(0[4-9]|1[0-9]|2[01]):[0-5][0-9]$ ]] || { echo "DRAG_CHECK_AT is HH:MM from 04:00 to 21:59: $at" >&2; exit 2; }
rm -rf "$storage"; mkdir -p "$storage"
python3 -I - "$storage" "$at" <<'PY'
import json, os, sys, uuid
from datetime import datetime, timedelta, timezone
folder, at = sys.argv[1], sys.argv[2]
now = datetime.now().astimezone()
day = (now - timedelta(hours=4)).strftime("%Y-%m-%d")
start = datetime.strptime(at, "%H:%M")
end = start + timedelta(minutes=90)
utc = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
items = [{"id": str(uuid.uuid4()).upper(), "title": "끌기 시험", "isCompleted": False, "createdAt": utc, "todaySince": day,
          "timeStart": start.strftime("%H:%M"), "timeEnd": end.strftime("%H:%M")}]
json.dump({"items": items}, open(os.path.join(folder, "todos.json"), "w"), ensure_ascii=False)
json.dump({"events": []}, open(os.path.join(folder, "events.json"), "w"))
PY
defaults delete "$bundle_id" >/dev/null 2>&1 || true
for key in quickEntry.enabled quickMemo.enabled noteHotKey.enabled pet.visible sweep.enabled chatter.enabled reminder.enabled; do
    defaults write "$bundle_id" "$key" -bool false
done
defaults write "$bundle_id" guide.seen -bool true
defaults write "$bundle_id" login.asked -bool true
defaults write "$bundle_id" systemNotices off
defaults write "$bundle_id" AppleLanguages -array ko

: > "$log"
# (TZ set: the copy runs in the script's time zone too.)
open -g -n --env PAPERTODO_OFFSCREEN=1 ${TZ:+--env "TZ=$TZ"} "$app" --args --timetable-replay "$log" --timetable-now "$at" --offscreen ${DRAG_CHECK_ARGS:-}
for _ in $(seq 1 100); do pid=$(pgrep -f "$app/Contents/MacOS/PaperTodo" | head -1 || true); [ -n "$pid" ] && break; sleep 0.05; done
sleep 1
if ! "$probe" offscreen "$pid"; then echo "a window of the test copy is on a screen: stopping"; exit 1; fi
for _ in $(seq 1 300); do grep -q '"done"\|"error"' "$log" 2>/dev/null && break; sleep 0.1; done
python3 -I "$repo/scripts/drag-check.py" "$log"
