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
# --quick skips the 10-minute use loop (memory after use). The drawer is measured by scripts/perf-drawer.sh (#208).
# Everything the test copy wrote (storage
# folder, preferences, saved state) is removed at the end.
#
# #217: nothing of the test copy comes to the front or onto a screen. It starts behind the person's apps (`open -g`),
# never makes itself active, has no Dock icon or menu bar item, and every window is far off the screens
# (`--offscreen`, PAPERTODO_OFFSCREEN=1). The keys aren't posted to it any more: the script writes them to a file the
# app reads (`--perf-drive`, Sources/PaperTodo/PerfDrive.swift) and the app hands them to its own window — so the
# times are the app's own (no delivery by the system), and characters go into the field without an input method. A
# window of the copy on a screen stops the run (`perf-probe offscreen`, and the app's own `onscreen` line).
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
# #278: never the real app's com.noa.PaperTodo (its settings and data folder share this name).
source "$repo/scripts/lib/test-defaults.sh"
test_defaults_require "$bundle_id"
mkdir -p "$out"
# The app opens the log and the commands by these paths from its own folder: absolute ones.
out="$(cd "$out" && pwd)"
app="$out/PerfTest.app"
probe="$out/perf-probe"
log="$out/perf.log"
commands="$out/perf-drive.txt"
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
    test_defaults_remove "$bundle_id"
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
    # 메모 서랍 (1.43): its shortcut off (scripts/perf-drawer.sh measures the drawer); no move notice.
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
    : > "$log"; : > "$commands"
    # Through Launch Services, but behind (-g): nothing comes forward. --offscreen: every window far off the screens.
    open -g -n --env PAPERTODO_OFFSCREEN=1 "$app" --args --perf-log "$log" --offscreen --perf-drive "$commands"
    for _ in $(seq 1 100); do pid=$(pgrep -f "$app/Contents/MacOS/PaperTodo" | head -1 || true); [ -n "$pid" ] && break; sleep 0.05; done
    for _ in $(seq 1 100); do grep -q '^noteVisible' "$log" 2>/dev/null && break; sleep 0.1; done
    sleep 1.5
    offscreen_check
}
# drive <command>: the test copy's input (PerfDrive: key <code> [mods] · type <ms> <text>), done in order.
drive() { echo "$*" >> "$commands"; }
# Every shown window of the test copy off the screens, as the window server has it; nothing the app moved off.
offscreen_check() {
    if ! "$probe" offscreen "$pid"; then echo "a window of the test copy is on a screen: stopping"; exit 1; fi
    if grep -q '^onscreen' "$log"; then grep '^onscreen' "$log"; echo "the test copy put a window on a screen: stopping"; exit 1; fi
}
# At the end: still off the screens, and the commands the copy couldn't do (a key with no window for it …).
finish_check() {
    offscreen_check
    if grep -q '^drive ' "$log"; then echo "commands the test copy couldn't do:"; grep '^drive ' "$log" | sort | uniq -c; fi
    return 0
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
# between two marks. (Until #217 the line's other number added the system's delivery of a posted key; now the keys come
# from inside and both are the same.)
vals() { between "$1" "$2" | awk -v p="$3" 'index($0, p) == 1 {print $NF}'; }
first() { vals "$@" | head -1; }

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
    # Drawing 오늘: the tab switch 앞으로 → 오늘 (⌘2 ⌘1), five rounds; the second key of each is 오늘's.
    mark tabs
    for _ in 1 2 3 4 5; do for code in 19 18; do drive key "$code" cmd; sleep 0.8; done; done
    settle tabs "key " 10
    mark tabs-end
    today=$(between tabs tabs-end | awk 'index($0, "key 18") == 1 {print $NF}')
    echo "draw 오늘 (⌘1 from 앞으로, app): median $(echo "$today" | median) ms · max $(echo "$today" | max) ms"
    # A line typed, then cleared: each key's frame. The first key (the line going from empty to written: the chips
    # come, the list's room changes) and Esc (back to empty) are shown apart — with 2,000 rows they took
    # 4–14 s in 1.44 and before 1.45's fix (the list's height fed back into the sheet), so the next step waits.
    typed() {  # typed <name> <text> <keys>
        mark "$1-open"; drive key 45 cmd; settle "$1-open" "key 45" 1 60
        mark "$1"
        drive type 150 "$2"
        settle "$1" "key 0 " "$3" 90
        mark "$1-end"
        local keys; keys=$(vals "$1" "$1-end" key)
        echo "typing ‘$2’ (app): first key $(echo "$keys" | head -1) ms · the rest median $(echo "$keys" | tail -n +2 | median) ms · max $(echo "$keys" | tail -n +2 | max) ms ($(echo "$keys" | wc -l | tr -d ' ') keys)"
        mark "$1-esc"; drive key 53; drive key 53; settle "$1-esc" "key 53" 2 90
        mark "$1-esc-end"
        echo "  Esc (clear the line, app): $(vals "$1-esc" "$1-esc-end" "key 53" | head -1) ms"
    }
    typed typing "내일 3시 회의 준비하기" 13
    typed hash "보고서 쓰기 #ㅎㅅ" 10
    # One space shown and back (⌘⌥1 ⌘⌥2 ⌘⌥0; nothing happens in a build without spaces).
    mark lens
    for _ in 1 2 3; do for code in 18 19 29; do drive key "$code" cmd+opt; sleep 0.8; done; done
    settle lens "key " 9
    mark lens-end
    lens=$(vals lens lens-end key)
    echo "one space shown ⌘⌥1/2/0 (app): median $(echo "$lens" | median) ms · max $(echo "$lens" | max) ms"
    sleep 3
    echo "idle, note open (30 s): $("$probe" sample "$pid" 30)"
    # The note with one space shown, drawn into the out folder (kill -USR1: PerfProbe's pictures) — to see the lens took.
    drive key 18 cmd+opt; sleep 3; kill -USR1 "$pid" 2>/dev/null || true; sleep 3
    echo "files written in the whole run: $(grep -c '^io' "$log" || true)"
    cp "$log" "$out/perf-last.log"
    finish_check
    exit 0
fi

# 2. Idle with the note open (day ribbon showing).
mark idle-open
echo "idle, note open (60 s): $("$probe" sample "$pid" 60)"
mark idle-open-end
echo "  files written while idle: $(vals idle-open idle-open-end io | wc -l | tr -d ' ')"

# 3. Typing in the input line: each key until the frame is on screen (chips update in the same frame).
drive key 45 cmd; sleep 0.6   # ⌘N: the input line
mark typing
drive type 150 "내일 3시 회의 준비하기"
settle typing "key 0 " 13
mark typing-end
keys=$(vals typing typing-end key)
echo "typing (app): per key median $(echo "$keys" | median) ms · max $(echo "$keys" | max) ms ($(echo "$keys" | wc -l | tr -d ' ') keys)"
drive key 53; sleep 0.4   # Esc clears the line
drive key 53; sleep 0.4

# 4. Tab switches ⌘2 ⌘1, three rounds (two tabs from 1.43: ⌘3 opens 메모 서랍, see 8b).
mark tabs
for _ in 1 2 3; do for code in 19 18; do drive key "$code" cmd; sleep 0.7; done; done
settle tabs "key " 6
mark tabs-end
tabs=$(vals tabs tabs-end key)
echo "tab switch 오늘↔앞으로 (app): median $(echo "$tabs" | median) ms · max $(echo "$tabs" | max) ms"

# 5. Checking a task with the keyboard (↑ from the empty input line picks the last row, Space checks it), the
# save after it; Space again puts it back.
drive key 45 cmd; sleep 0.5
drive key 126; sleep 0.6
mark check
drive key 49
settle check "io todos" 1 20
mark check-end
echo "check a task (app): Space → frame $(first check check-end "key 49") ms · save todos.json $(first check check-end "io todos") ms"
drive key 49; sleep 0.8
drive key 53; sleep 0.4

# 6. The desk (⌘D) and its month view; ⌘W closes it.
mark desk
drive key 2 cmd
settle desk "key " 1
mark desk-end
echo "open desk (⌘D, first time, app): $(first desk desk-end key) ms"
# 달력's month view: the desk opens on it (calendar.view is month until it's changed), so the click on ‘월’ that was
# timed here did nothing (#217). scripts/bench-app.sh times the month and the week (calendar month / week).
drive key 13 cmd; sleep 0.8
mark desk2
drive key 2 cmd
settle desk2 "key " 1
mark desk2-end
echo "open desk again (app): $(first desk2 desk2-end key) ms"
drive key 13 cmd; sleep 0.8

# 7. Search: ⌘F, three letters; the last letter's frame has the results.
mark search
drive key 3 cmd; sleep 0.8
drive type 300 "보고서"
settle search "key 0 " 3
mark search-end
echo "search ⌘F (app): open $(first search search-end "key 3 ") ms · per letter $(vals search search-end "key 0 " | tr '\n' ' ')ms"
drive key 53; sleep 0.5

# 8. Note hidden (⌘W), then reopened (⌘0).
drive key 13 cmd; sleep 2
mark idle-hidden
echo "idle, note hidden (60 s): $("$probe" sample "$pid" 60)"
# 8b. 메모 서랍: measured by scripts/perf-drawer.sh now (#208), in one process with no window on any screen. Opening
# it here went through the 윈도우 menu by an accessibility press, and the drawer puts the cursor in its quick-write
# field as it opens.
sleep 1
mark reopen
drive key 29 cmd
settle reopen "key " 1
mark reopen-end
echo "warm reopen (⌘0, app): $(first reopen reopen-end key) ms"

# 9. The pet walking (⇧⌘P shows it).
drive key 35 cmd+shift; sleep 3
echo "idle, pet walking (60 s): $("$probe" sample "$pid" 60)"
drive key 35 cmd+shift; sleep 1

# 10. A running timer (the line's ‘타이머 25’), the note open.
drive key 45 cmd; sleep 0.5
drive type 60 "타이머 25"; sleep 0.3
drive key 36; sleep 2
echo "running timer (60 s): $("$probe" sample "$pid" 60)"
# The timer runs on through the use loop (it was stopped through the 보기 menu, an accessibility press: #208).
sleep 1

# 11. Ten minutes of use, then memory.
if [ "$quick" = 0 ]; then
    end=$((SECONDS + 600))
    while [ $SECONDS -lt $end ]; do
        for code in 19 18; do drive key "$code" cmd; sleep 0.6; done
        drive key 45 cmd; sleep 0.3
        drive type 80 "보고서 쓰기"; sleep 0.3
        drive key 53; sleep 0.2; drive key 53; sleep 0.3
        drive key 2 cmd; sleep 1; drive key 13 cmd; sleep 0.5
        drive key 3 cmd; sleep 0.5; drive type 80 "메모"; sleep 0.3; drive key 53; sleep 0.5
    done
    echo "memory after 10 min of use: $("$probe" mem "$pid")"
fi
echo "files written in the whole run: $(grep -c '^io' "$log" || true) (todos $(grep -c '^io todos' "$log" || true), memos $(grep -c '^io memos' "$log" || true))"
cp "$log" "$out/perf-last.log"
finish_check

# 12. 메모 서랍 바탕 반투명 (1.44): the drawer is measured by scripts/perf-drawer.sh now (#208), see 8b.
