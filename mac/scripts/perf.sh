#!/bin/bash
# 성능 점검 (1.39): builds a separate test copy (bundle id com.noa.PaperTodo.LiveTest, never dist/),
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
out="${1:-$repo/.build/perf}"
case "$out" in --*) out="$repo/.build/perf";; esac
quick=0; build=1; spaces=0
for arg in "$@"; do
    [ "$arg" = "--quick" ] && quick=1
    [ "$arg" = "--no-build" ] && build=0
    [ "$arg" = "--spaces" ] && spaces=1
done
[ "$spaces" = 1 ] && PERF_DATA_ARGS="${PERF_DATA_ARGS:-} --todos 2000 --spaces 9"
bundle_id=${PERF_BUNDLE_ID:-com.noa.PaperTodo.LiveTest}
mkdir -p "$out"
app="$out/PerfTest.app"
probe="$out/perf-probe"
log="$out/perf.log"
storage="$HOME/Library/Application Support/$bundle_id"

if [ "$build" = 1 ]; then
    cd "$repo"
    swift build -c release -Xswiftc -warnings-as-errors --scratch-path "$out/build" 2>&1 | tail -1
    bin="$(swift build -c release --scratch-path "$out/build" --show-bin-path)"
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

echo "== 종이냥 성능 점검 · $(date '+%Y-%m-%d %H:%M') · $(sw_vers -productVersion) · $(sysctl -n machdep.cpu.brand_string)"

# 1. Cold start (three runs), memory right after.
starts=()
for run in 1 2 3 4; do
    fresh; launch
    starts+=("$(last noteVisible)")
done
# The first launch after a build also pays for the system's first look at the new binary.
printf 'cold start → note visible (ms): %s (median of the last three %s)\n' "${starts[*]}" "$(printf '%s\n' "${starts[@]:1}" | median)"
echo "memory after start: $("$probe" mem "$pid")"

if [ "$spaces" = 1 ]; then
    "$probe" front "$pid"; sleep 2
    # Drawing 오늘: the tab switch 앞으로 → 오늘 (⌘2 ⌘1), five rounds; the second key of each is 오늘's.
    mark tabs
    for _ in 1 2 3 4 5; do for code in 19 18; do "$probe" key "$pid" "$code" cmd; sleep 0.8; done; done
    settle tabs "key " 10
    mark tabs-end
    today=$(between tabs tabs-end | awk 'index($0, "key 18") == 1 {print $NF}')
    echo "draw 오늘 (⌘1 from 앞으로, app): median $(echo "$today" | median) ms · max $(echo "$today" | max) ms"
    # A line typed, then cleared: each key's frame. The first key (the line going from empty to written: the chips
    # come, the list's room changes) and Esc (back to empty) are shown apart — with 2,000 rows they took
    # 4–14 s in 1.44 and before 1.45's fix (the list's height fed back into the sheet), so the next step waits.
    typed() {  # typed <name> <text> <keys>
        mark "$1-open"; "$probe" key "$pid" 45 cmd; settle "$1-open" "key 45" 1 60
        mark "$1"
        "$probe" type "$pid" "$2" 150
        settle "$1" "key 0 " "$3" 90
        mark "$1-end"
        local keys; keys=$(vals "$1" "$1-end" key)
        echo "typing ‘$2’ (app): first key $(echo "$keys" | head -1) ms · the rest median $(echo "$keys" | tail -n +2 | median) ms · max $(echo "$keys" | tail -n +2 | max) ms ($(echo "$keys" | wc -l | tr -d ' ') keys)"
        mark "$1-esc"; "$probe" key "$pid" 53; "$probe" key "$pid" 53; settle "$1-esc" "key 53" 2 90
        mark "$1-esc-end"
        echo "  Esc (clear the line, app): $(vals "$1-esc" "$1-esc-end" "key 53" | head -1) ms"
    }
    typed typing "내일 3시 회의 준비하기" 13
    typed hash "보고서 쓰기 #ㅎㅅ" 10
    # One space shown and back (⌘⌥1 ⌘⌥2 ⌘⌥0; nothing happens in a build without spaces).
    "$probe" front "$pid"; sleep 0.5
    mark lens
    for _ in 1 2 3; do for code in 18 19 29; do "$probe" key "$pid" "$code" cmd+opt; sleep 0.8; done; done
    settle lens "key " 9
    mark lens-end
    lens=$(vals lens lens-end key)
    echo "one space shown ⌘⌥1/2/0 (app): median $(echo "$lens" | median) ms · max $(echo "$lens" | max) ms"
    sleep 3
    echo "idle, note open (30 s): $("$probe" sample "$pid" 30)"
    # The note with one space shown, drawn into the out folder (kill -USR1: PerfProbe's pictures) — to see the lens took.
    "$probe" key "$pid" 18 cmd+opt; sleep 3; kill -USR1 "$pid" 2>/dev/null || true; sleep 3
    echo "files written in the whole run: $(grep -c '^io' "$log" || true)"
    cp "$log" "$out/perf-last.log"
    exit 0
fi

# 2. Idle with the note open (day ribbon showing).
"$probe" front "$pid"; sleep 2
mark idle-open
echo "idle, note open (60 s): $("$probe" sample "$pid" 60)"
mark idle-open-end
echo "  files written while idle: $(vals idle-open idle-open-end io | wc -l | tr -d ' ')"

# 3. Typing in the input line: each key until the frame is on screen (chips update in the same frame).
"$probe" key "$pid" 45 cmd; sleep 0.6   # ⌘N: the input line
mark typing
"$probe" type "$pid" "내일 3시 회의 준비하기" 150
settle typing "key 0 " 13
mark typing-end
keys=$(vals typing typing-end key)
echo "typing (app): per key median $(echo "$keys" | median) ms · max $(echo "$keys" | max) ms ($(echo "$keys" | wc -l | tr -d ' ') keys) · with delivery median $(totals typing typing-end key | median) ms"
"$probe" key "$pid" 53; sleep 0.4   # Esc clears the line
"$probe" key "$pid" 53; sleep 0.4

# 4. Tab switches ⌘2 ⌘1, three rounds (two tabs from 1.43: ⌘3 opens 메모 서랍, measured in 8b).
mark tabs
for _ in 1 2 3; do for code in 19 18; do "$probe" key "$pid" "$code" cmd; sleep 0.7; done; done
settle tabs "key " 6
mark tabs-end
tabs=$(vals tabs tabs-end key)
echo "tab switch 오늘↔앞으로 (app): median $(echo "$tabs" | median) ms · max $(echo "$tabs" | max) ms · with delivery median $(totals tabs tabs-end key | median) ms"

# 5. Checking a task with the keyboard (↑ from the empty input line picks the last row, Space checks it), the
# save after it; Space again puts it back.
"$probe" key "$pid" 45 cmd; sleep 0.5
"$probe" key "$pid" 126; sleep 0.6
mark check
"$probe" key "$pid" 49
settle check "io todos" 1 20
mark check-end
echo "check a task (app): Space → frame $(first check check-end "key 49") ms (with delivery $(firsttotal check check-end "key 49") ms) · save todos.json $(first check check-end "io todos") ms"
"$probe" key "$pid" 49; sleep 0.8
"$probe" key "$pid" 53; sleep 0.4

# 6. The desk (⌘D) and its month view; ⌘W closes it.
mark desk
"$probe" key "$pid" 2 cmd
settle desk "key " 1
mark desk-end
echo "open desk (⌘D, first time, app): $(first desk desk-end key) ms (with delivery $(firsttotal desk desk-end key) ms)"
mark month
"$probe" click "$pid" "=월" >/dev/null 2>&1 || "$probe" click "$pid" "=Month" >/dev/null 2>&1 || true
settle month "click" 1 15
mark month-end
echo "달력 month view (app): $(first month month-end click) ms"
"$probe" key "$pid" 13 cmd; sleep 0.8
mark desk2
"$probe" key "$pid" 2 cmd
settle desk2 "key " 1
mark desk2-end
echo "open desk again (app): $(first desk2 desk2-end key) ms"
"$probe" key "$pid" 13 cmd; sleep 0.8

# 7. Search: ⌘F, three letters; the last letter's frame has the results.
"$probe" front "$pid"; sleep 0.5
mark search
"$probe" key "$pid" 3 cmd; sleep 0.8
"$probe" type "$pid" "보고서" 300
settle search "key 0 " 3
mark search-end
echo "search ⌘F (app): open $(first search search-end "key 3 ") ms · per letter $(vals search search-end "key 0 " | tr '\n' ' ')ms · with delivery: open $(firsttotal search search-end "key 3 ") ms"
"$probe" key "$pid" 53; sleep 0.5

# 8. Note hidden (⌘W), then reopened (⌘0).
"$probe" key "$pid" 13 cmd; sleep 2
mark idle-hidden
echo "idle, note hidden (60 s): $("$probe" sample "$pid" 60)"
# 8b. 메모 서랍 (1.43): idle with the note hidden is with its handle out (drawer closed); then the drawer from the 윈도우
# menu (first time; closed; again: made once, hidden after), idle with it open, closed. Each toggle is logged
# (`drawer` opening, `drawerclose` closing), so a missed one shows.
drawer_menu() { "$probe" menu "$pid" "윈도우" "메모 서랍" >/dev/null 2>&1 || "$probe" menu "$pid" "Window" "Notes drawer" >/dev/null 2>&1 || true; }
"$probe" front "$pid"; sleep 0.5
mark drawer1
drawer_menu
settle drawer1 "drawer " 1 15
mark drawer1-end
echo "open drawer (first time, app): $(first drawer1 drawer1-end "drawer ") ms"
drawer_menu; sleep 1.2
mark drawer2
drawer_menu
settle drawer2 "drawer " 1 15
mark drawer2-end
echo "reopen drawer (app): $(first drawer2 drawer2-end "drawer ") ms"
sleep 2
echo "idle, drawer open (60 s): $("$probe" sample "$pid" 60)"
mark drawer3
drawer_menu
settle drawer3 "drawerclose" 1 10
mark drawer3-end
echo "  (closed after: $(vals drawer3 drawer3-end drawerclose | wc -l | tr -d ' ') close logged — 1 means it was open while sampled)"
sleep 1
mark reopen
"$probe" key "$pid" 29 cmd
settle reopen "key " 1
mark reopen-end
echo "warm reopen (⌘0, app): $(first reopen reopen-end key) ms (with delivery $(firsttotal reopen reopen-end key) ms)"

# 9. The pet walking (⇧⌘P shows it).
"$probe" key "$pid" 35 cmd+shift; sleep 3
echo "idle, pet walking (60 s): $("$probe" sample "$pid" 60)"
"$probe" key "$pid" 35 cmd+shift; sleep 1

# 10. A running timer (the line's ‘타이머 25’), the note open.
"$probe" key "$pid" 45 cmd; sleep 0.5
"$probe" type "$pid" "타이머 25" 60; sleep 0.3
"$probe" key "$pid" 36; sleep 2
echo "running timer (60 s): $("$probe" sample "$pid" 60)"
"$probe" menu "$pid" "보기" "타이머" "중지" >/dev/null 2>&1 || true
sleep 1

# 11. Ten minutes of use, then memory.
if [ "$quick" = 0 ]; then
    end=$((SECONDS + 600))
    while [ $SECONDS -lt $end ]; do
        for code in 19 18; do "$probe" key "$pid" "$code" cmd; sleep 0.6; done
        "$probe" key "$pid" 45 cmd; sleep 0.3
        "$probe" type "$pid" "보고서 쓰기" 80; sleep 0.3
        "$probe" key "$pid" 53; sleep 0.2; "$probe" key "$pid" 53; sleep 0.3
        "$probe" key "$pid" 2 cmd; sleep 1; "$probe" key "$pid" 13 cmd; sleep 0.5
        "$probe" key "$pid" 3 cmd; sleep 0.5; "$probe" type "$pid" "메모" 80; sleep 0.3; "$probe" key "$pid" 53; sleep 0.5
    done
    echo "memory after 10 min of use: $("$probe" mem "$pid")"
fi
echo "files written in the whole run: $(grep -c '^io' "$log" || true) (todos $(grep -c '^io todos' "$log" || true), memos $(grep -c '^io memos' "$log" || true))"
cp "$log" "$out/perf-last.log"

# 12. 메모 서랍 바탕 반투명 (1.44): a fresh start with the drawer's backdrop see-through (a behind-window blur under the
# paper), the drawer opened from the 윈도우 menu, then idle. The blur itself is drawn by the window server, so this is
# the app's own share; it must stay with "idle, drawer open" above. Skipped when Reduce transparency is on (it draws
# 불투명 then).
if [ "$(defaults read com.apple.universalaccess reduceTransparency 2>/dev/null || echo 0)" = 1 ]; then
    echo "idle, drawer open, 반투명: skipped (Reduce transparency is on)"
else
    fresh
    defaults write "$bundle_id" drawer.backdrop translucent
    launch
    "$probe" front "$pid"; sleep 0.5
    mark drawer4
    drawer_menu
    settle drawer4 "drawer " 1 15
    mark drawer4-end
    echo "open drawer, 반투명 (first time, app): $(first drawer4 drawer4-end "drawer ") ms"
    sleep 2
    echo "idle, drawer open, 반투명 (60 s): $("$probe" sample "$pid" 60)"
fi
