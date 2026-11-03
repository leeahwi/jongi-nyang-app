#!/bin/bash
# 메모 서랍 under load, in the real app (docs/perf-memo-stress.md). Like scripts/perf.sh: a separate test copy (bundle id
# com.noa.PaperTodo.MemoStress, its own storage folder), filled per tier by scripts/memo-stress-data.py, driven by its pid
# only, off every screen (--offscreen). The installed app and its data are never touched.
#
#   scripts/perf-memo.sh [tier …] [--no-build | --build-only]     tiers: 50 500 2000 5000 long (default: all)
#
# PROFILE=1 samples typing. PERF_MEMO_OUT=<folder> keeps the build and logs elsewhere (one folder per build, to compare
# two builds run by turns).
#
# #132: opening a memo (↩) has a ceiling, OPEN_CEILING ms (default 200; 1.45 opened in 50–160 ms, the first markdown
# build in 260–370): a slower open is listed at the end and the run exits 1. Only on a quiet Mac — an open measured while
# the 1-minute load is over CEILING_LOAD (default 6) is printed, not held to it.
#
# Per tier: start, the drawer's first open and reopen, idle with it open, stepping through the list with ↓ (each step
# selects and scrolls), opening a memo (↩), typing in it (each key to its frame) and the saves after, memory. `long`
# also opens and types in memos of 10 KB, 100 KB and 1 MB and opens a 2,000-line checklist.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="${PERF_MEMO_OUT:-$repo/.build/perf-memo}"
build=1; only=0; tiers=()
for arg in "$@"; do
    case "$arg" in --no-build) build=0 ;; --build-only) only=1 ;; *) tiers+=("$arg") ;; esac
done
[ ${#tiers[@]} -eq 0 ] && tiers=(50 500 2000 5000 long)
ceiling="${OPEN_CEILING:-200}"
ceiling_load="${CEILING_LOAD:-6}"
over=()
bundle_id=com.noa.PaperTodo.MemoStress
mkdir -p "$out"
app="$out/MemoStress.app"
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
    /usr/libexec/PlistBuddy -c "Set :CFBundleName MemoStress" "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName MemoStress" "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Delete :LSHasLocalizedDisplayName" "$app/Contents/Info.plist" || true
    cp -R Sources/PaperTodo/Assets "$app/Contents/Resources/"
    cp -R Resources/*.lproj "$app/Contents/Resources/"
    rm -f "$app"/Contents/Resources/*.lproj/InfoPlist.strings
    [ -d "$bin/PaperTodo_PaperTodo.bundle" ] && cp -R "$bin/PaperTodo_PaperTodo.bundle" "$app/Contents/Resources/" || true
    codesign --force --deep --sign - "$app" 2>/dev/null
    swiftc -O "$repo/scripts/perf-probe.swift" -o "$probe" 2>&1 | grep -v warning || true
fi
[ "$only" = 1 ] && exit 0

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

fresh() {  # fresh <memo-stress-data.py args…>
    stop
    rm -rf "$storage"; mkdir -p "$storage"
    python3 -I "$repo/scripts/memo-stress-data.py" "$storage" "$@" --marker
    defaults delete "$bundle_id" >/dev/null 2>&1 || true
    for key in quickEntry.enabled quickMemo.enabled noteHotKey.enabled pet.visible sweep.enabled chatter.enabled; do
        defaults write "$bundle_id" "$key" -bool false
    done
    defaults write "$bundle_id" drawer.shortcut -data ""
    defaults write "$bundle_id" memoDrawer.moveNoticeShown -bool true
    defaults write "$bundle_id" guide.seen -bool true
    defaults write "$bundle_id" login.asked -bool true
    defaults write "$bundle_id" systemNotices off
    defaults write "$bundle_id" AppleLanguages -array ko
}

launch() {
    : > "$log"
    open -n "$app" --args --perf-log "$log" --offscreen
    for _ in $(seq 1 100); do pid=$(pgrep -f "$app/Contents/MacOS/PaperTodo" | head -1 || true); [ -n "$pid" ] && break; sleep 0.05; done
    for _ in $(seq 1 300); do grep -q '^noteVisible' "$log" 2>/dev/null && break; sleep 0.1; done
    sleep 1.5
    offscreen_check
}
# Every window of the test copy must be off the screens (x 40,000 points away), as scripts/perf-idle.sh checks.
offscreen_check() {
    if "$probe" windows "$pid" 2>/dev/null | tr -d '\n' | grep -Eq 'X = "?-?[0-9]{1,4}"?;'; then
        echo "a window of the test copy is on a screen: stopping"; exit 1
    fi
}

median() { sort -n | awk '{a[NR]=$1} END {if (NR==0) print "-"; else if (NR%2) print a[(NR+1)/2]; else printf "%.2f\n", (a[NR/2]+a[NR/2+1])/2}'; }
p95() { sort -n | awk '{a[NR]=$1} END {if (NR==0) print "-"; else {i=int(NR*0.95+0.5); if (i<1) i=1; if (i>NR) i=NR; print a[i]}}'; }
max() { sort -n | tail -1; }
mark() { echo "# $1" >> "$log"; }
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
# ceiling <what> <ms>: an open over OPEN_CEILING on a quiet Mac is kept for the end (#132).
ceiling() {
    local load; load=$(sysctl -n vm.loadavg | awk '{print $2}')
    [ -n "$2" ] || return 0
    if awk -v v="$2" -v c="$ceiling" 'BEGIN {exit !(v > c)}'; then
        if awk -v l="$load" -v m="$ceiling_load" 'BEGIN {exit !(l <= m)}'; then
            over+=("$tier · $1: $2 ms (load $load)")
        else
            echo "  ($1 over the ${ceiling} ms ceiling at load $load: not counted)"
        fi
    fi
}
vals() { between "$1" "$2" | awk -v p="$3" 'index($0, p) == 1 {print $NF}'; }
first() { vals "$@" | head -1; }
drawer_menu() { "$probe" menu "$pid" "윈도우" "메모 서랍" >/dev/null 2>&1 || true; }
key() { "$probe" key "$pid" "$@"; }
summary() { printf 'median %s · p95 %s · max %s ms (%s)' "$(echo "$1" | median)" "$(echo "$1" | p95)" "$(echo "$1" | max)" "$(echo "$1" | grep -c . || true)"; }

# type_into <label> <text>: each key to its frame, and the memos.json saves that follow.
type_into() {
    local name=$1
    mark "type-$name"
    # PROFILE=1: the main thread's stacks while typing (sample(1)), into .build/perf-memo/sample-<tier>-<name>.txt.
    [ "${PROFILE:-0}" = 1 ] && { sample "$pid" 3 -file "$out/sample-$tier-${name// /-}.txt" >/dev/null 2>&1 & }
    "$probe" type "$pid" "$2" 120
    settle "type-$name" "key 0 " ${#2} 60
    sleep 1   # the save 0.4 s after the last key
    mark "type-$name-end"
    echo "  typing in $name: $(summary "$(vals "type-$name" "type-$name-end" "key 0 ")") · saves memos.json: $(vals "type-$name" "type-$name-end" "io memos" | tr '\n' ' ')ms · the list after the keys: $(vals "type-$name" "type-$name-end" "list " | tr '\n' ' ')ms"
}

echo "== 메모 서랍 under load · $(date '+%Y-%m-%d %H:%M') · $(sw_vers -productVersion) · $(sysctl -n machdep.cpu.brand_string) · load $(sysctl -n vm.loadavg)"
for tier in "${tiers[@]}"; do
    case "$tier" in
        long) fresh --memos 500 --long 10,100,1024 --checklist 2000 ;;
        *) fresh --memos "$tier" ;;
    esac
    launch
    echo "-- tier $tier"
    echo "  start → note visible: $(grep '^noteVisible' "$log" | awk '{print $NF}') ms · $("$probe" mem "$pid")"
    "$probe" front "$pid"; sleep 0.5
    mark open1; drawer_menu; settle open1 "drawer " 1 30; mark open1-end; offscreen_check
    echo "  drawer first open: $(first open1 open1-end "drawer ") ms"
    # The quick-write slip has the keys: a new memo there writes memos.json and memo-folders.json (its place).
    sleep 1
    "$probe" type "$pid" "빠른 메모 하나" 60; sleep 0.3
    mark quick; key 36; settle quick "io memo-folders" 1 30; mark quick-end
    echo "  quick write ↩ (new memo): $(first quick quick-end "key 36") ms · memo-folders.json save $(first quick quick-end "io memo-folders") ms · memos.json $(first quick quick-end "io memos") ms"
    reopen=""
    for _ in 1 2 3; do
        drawer_menu; sleep 1.2
        mark reopen; drawer_menu; settle reopen "drawer " 1 30; mark reopen-end
        reopen+="$(first reopen reopen-end "drawer ")"$'\n'
    done
    echo "  drawer reopen: median $(echo "$reopen" | grep . | median) ms"
    sleep 2
    echo "  idle, drawer open (20 s): $("$probe" sample "$pid" 20)"
    # The marker memo on top: opened through accessibility, closed with Esc — then ↓ steps from it.
    # The accessibility walk can stall on a busy Mac: each try is given 30 s, then the keys do it instead (⌘F, the
    # marker's words, ↓, ↩ — the search opens it in its folder and ends).
    pressed=0
    for _ in 1 2; do
        "$probe" press "$pid" "맨 위 메모" >/dev/null 2>&1 & presser=$!
        for _ in $(seq 1 30); do kill -0 "$presser" 2>/dev/null || break; sleep 1; done
        kill "$presser" 2>/dev/null || true
        wait "$presser" 2>/dev/null && { pressed=1; break; }
        sleep 2
    done
    if [ "$pressed" = 0 ]; then
        key 3 cmd; sleep 0.8; "$probe" type "$pid" "맨 위 메모" 60; sleep 1.5; key 125; sleep 0.8; key 36; sleep 1.5
        echo "  (marker opened with the keys: the accessibility press did not answer)"
    fi
    sleep 1
    mark esc; key 53; settle esc "key 53" 1 10; mark esc-end
    echo "  collapse (Esc): $(first esc esc-end "key 53") ms"
    if [ "$tier" = long ]; then
        for name in 10KB 100KB 1MB; do
            mark "down-$name"; key 125; settle "down-$name" "key 125" 1 20; mark "down-$name-end"
            mark "open-$name"; key 36; settle "open-$name" "key 36" 1 60; mark "open-$name-end"
            echo "  open $name memo (↩): $(first "open-$name" "open-$name-end" "key 36") ms (↓ to it $(first "down-$name" "down-$name-end" "key 125") ms)"
            ceiling "open $name memo" "$(first "open-$name" "open-$name-end" "key 36")"
            sleep 1
            type_into "$name" "가나다라마바사아자차abcdefghij"
            [ "$name" = 1MB ] && echo "  idle, 1 MB memo open (20 s): $("$probe" sample "$pid" 20)"
            mark "close-$name"; key 53; settle "close-$name" "key 53" 1 60; mark "close-$name-end"
            echo "  close $name memo (Esc): $(first "close-$name" "close-$name-end" "key 53") ms · saves: $(vals "close-$name" "close-$name-end" "io memos" | tr '\n' ' ')ms"
            sleep 1
        done
        mark down-check; key 125; settle down-check "key 125" 1 20
        mark open-check; key 36; settle open-check "key 36" 1 60; mark open-check-end
        echo "  open 2,000-line checklist (↩): $(first open-check open-check-end "key 36") ms"
        sleep 1; key 53; sleep 1
        echo "  $("$probe" mem "$pid")"
    else
        mark steps
        for _ in $(seq 1 30); do key 125; sleep 0.15; done
        settle steps "key 125" 30 30
        mark steps-end
        echo "  ↓ through the list (select + scroll): $(summary "$(vals steps steps-end "key 125")")"
        # Back to the top memo and type in it: every key redraws the list around it.
        for _ in $(seq 1 30); do key 126; sleep 0.05; done
        sleep 1
        mark open-top; key 36; settle open-top "key 36" 1 30; mark open-top-end
        echo "  open the top memo (↩): $(first open-top open-top-end "key 36") ms"
        ceiling "open the top memo" "$(first open-top open-top-end "key 36")"
        sleep 1
        type_into "a short memo" "가나다라마바사아자차abcdefghij"
        key 53; sleep 1
        echo "  $("$probe" mem "$pid")"
    fi
    cp "$log" "$out/perf-$tier.log"
    stop
done
if [ ${#over[@]} -gt 0 ]; then
    echo "== over the ${ceiling} ms open ceiling (#132):"
    printf '  %s\n' "${over[@]}"
    exit 1
fi
echo "== every open under the ${ceiling} ms ceiling (or measured under load)"
