#!/bin/bash
# 하루 일정표 끌기 점검 (1.41): builds a separate debug test copy (bundle id com.noa.PaperTodo.LiveTest, never dist/),
# gives it one to-do at this hour (90 minutes), opens it with --timetable-replay (TimetableReplay.swift), which replays
# mouse drags through the app's real event path — move, stretch the bottom, stretch the top, Esc, past the viewport's
# bottom — and logs, every tick, the pointer and where the block was drawn. Then drag-check.py checks that the block
# followed the pointer. The installed app and its data are never touched; the copy is stopped by its pid and everything
# it wrote is removed.
#
#   scripts/drag-check.sh [out-folder] [--no-build]      (DRAG_CHECK_ARGS: more launch arguments)
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$repo/.build/drag-check}"
case "$out" in --*) out="$repo/.build/drag-check";; esac
build=1
for arg in "$@"; do [ "$arg" = "--no-build" ] && build=0; done
bundle_id=com.noa.PaperTodo.LiveTest
mkdir -p "$out"
app="$out/DragCheck.app"
log="$out/drag.jsonl"
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

rm -rf "$storage"; mkdir -p "$storage"
python3 -I - "$storage" <<'PY'
import json, os, sys, uuid
from datetime import datetime, timedelta, timezone
folder = sys.argv[1]
now = datetime.now().astimezone()
day = (now - timedelta(hours=4)).strftime("%Y-%m-%d")
hour = now.hour
end = (now.replace(minute=0) + timedelta(minutes=90))
utc = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
items = [{"id": str(uuid.uuid4()).upper(), "title": "끌기 시험", "isCompleted": False, "createdAt": utc, "todaySince": day,
          "timeStart": f"{hour:02d}:00", "timeEnd": end.strftime("%H:%M")}]
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
open -n "$app" --args --timetable-replay "$log" ${DRAG_CHECK_ARGS:-}
for _ in $(seq 1 100); do pid=$(pgrep -f "$app/Contents/MacOS/PaperTodo" | head -1 || true); [ -n "$pid" ] && break; sleep 0.05; done
for _ in $(seq 1 300); do grep -q '"done"\|"error"' "$log" 2>/dev/null && break; sleep 0.1; done
python3 -I "$repo/scripts/drag-check.py" "$log"
