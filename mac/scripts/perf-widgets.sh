#!/bin/bash
# 바탕화면 달력 위젯 (#234) at rest: the test copy of scripts/perf-idle.sh (com.noa.PaperTodo.PerfWidgets, its own data
# and preferences) with no widget, one (이번 달 at 40 %, frosted) and four (이번 달 40 % · 이번 주 자세히 85 % · 오늘 40 %
# with click-through · 오늘 목록 100 %), every window far off every screen (`--offscreen`): CPU, wakeups and memory.
# Each run checks that no window of the test copy is on a screen (CGWindowList) before it measures.
#
#   scripts/perf-widgets.sh [seconds] [--no-build]
#
# The installed app and its data are never touched; everything the test copy wrote is removed at the end.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="$repo/.build/perf-widgets"
build=1; seconds=30
for arg in "$@"; do
    [ "$arg" = "--no-build" ] && build=0
    [[ "$arg" =~ ^[0-9]+$ ]] && seconds="$arg"
done
bundle_id=com.noa.PaperTodo.PerfWidgets
# #278: never the real app's com.noa.PaperTodo (its settings and data folder share this name).
source "$repo/scripts/lib/test-defaults.sh"
test_defaults_require "$bundle_id"
mkdir -p "$out"
app="$out/PerfWidgets.app"; probe="$out/perf-probe"
storage="$HOME/Library/Application Support/$bundle_id"

if [ "$build" = 1 ]; then
    cd "$repo"
    swift build -c release -Xswiftc -warnings-as-errors --scratch-path "$out/build" 2>&1 | tail -1
    bin="$(swift build -c release --scratch-path "$out/build" --show-bin-path)"
    rm -rf "$app"; mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
    cp "$bin/PaperTodo" "$app/Contents/MacOS/PaperTodo"
    cp Resources/Info.plist "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleName PerfWidgets" "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName PerfWidgets" "$app/Contents/Info.plist"
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
    test_defaults_remove "$bundle_id"
}
trap cleanup EXIT

widget() { # id kind style opacity clickThrough
    echo "<dict><key>id</key><string>$1</string><key>kind</key><string>$2</string><key>style</key><string>$3</string><key>opacity</key><integer>$4</integer><key>clickThrough</key><$5/></dict>"
}

# run <0|1|4>: fresh data and preferences, then the test copy with everything off-screen.
run() {
    stop
    rm -rf "$storage"; mkdir -p "$storage"
    python3 -I "$repo/scripts/perf-data.py" "$storage" >/dev/null
    defaults delete "$bundle_id" >/dev/null 2>&1 || true
    for key in quickEntry.enabled quickMemo.enabled noteHotKey.enabled sweep.enabled reminder.enabled pet.visible chatter.enabled; do
        defaults write "$bundle_id" "$key" -bool false
    done
    defaults write "$bundle_id" drawer.shortcut -data ""
    defaults write "$bundle_id" memoDrawer.moveNoticeShown -bool true
    defaults write "$bundle_id" guide.seen -bool true
    defaults write "$bundle_id" login.asked -bool true
    defaults write "$bundle_id" systemNotices off
    defaults write "$bundle_id" AppleLanguages -array ko
    case "$1" in
        1) defaults write "$bundle_id" calendar.widgets -array "$(widget w-1 month simple 40 false)" ;;
        4) defaults write "$bundle_id" calendar.widgets -array "$(widget w-1 month simple 40 false)" "$(widget w-2 week detail 85 false)" \
               "$(widget w-3 today simple 40 true)" "$(widget w-4 agenda simple 100 false)" ;;
        # The same four with no click-through (no mouse watching): what the click-through widget's monitor costs.
        4n) defaults write "$bundle_id" calendar.widgets -array "$(widget w-1 month simple 40 false)" "$(widget w-2 week detail 85 false)" \
               "$(widget w-3 today simple 40 false)" "$(widget w-4 agenda simple 100 false)" ;;
    esac
    open -n -g --env PAPERTODO_OFFSCREEN=1 "$app" --args --offscreen
    for _ in $(seq 1 100); do pid=$(pgrep -f "$app/Contents/MacOS/PaperTodo" | head -1 || true); [ -n "$pid" ] && break; sleep 0.05; done
    sleep 4
    # Every window of the test copy must be off the screens (40,000 points away): no window within 20,000 points of the
    # origin on both axes (perf-probe prints `x … y …` for each).
    local windows; windows=$("$probe" windows "$pid" 2>/dev/null || true)
    if echo "$windows" | awk '{for (i = 1; i < NF; i++) { if ($i == "x") x = $(i + 1); if ($i == "y") y = $(i + 1) }
            if (x != "" && y != "" && x > -20000 && x < 20000 && y > -20000 && y < 20000) bad = 1; x = ""; y = ""} END {exit bad ? 0 : 1}'; then
        echo "a window of the test copy is on a screen: stopping"; echo "$windows"; exit 1
    fi
    echo "  windows: $(echo "$windows" | grep -c . || true), all off-screen (x: $(echo "$windows" | grep -Eo ' x -?[0-9.]+' | awk '{print $2}' | sort -u | tr '\n' ' '))"
    [ -n "${PERF_SHOW_WINDOWS:-}" ] && echo "$windows"
    sleep 6
}

echo "== 바탕화면 위젯 쉴 때 · $(date '+%Y-%m-%d %H:%M') · $(sw_vers -productVersion) · load $(sysctl -n vm.loadavg)"
for count in ${PERF_COUNTS:-0 1 4 4n}; do
    run "$count"
    echo "$count widget(s), ${seconds} s: $("$probe" sample "$pid" "$seconds") · $("$probe" mem "$pid")"
done
