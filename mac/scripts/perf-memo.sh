#!/bin/bash
# 메모 서랍 under load (docs/perf-memo-stress.md), per tier, in two parts — neither brings anything forward, presses
# anything or posts a key through the system, and no window touches a screen:
#
# 1. The app (#217, lost in #208 and back): a separate test copy (bundle id com.noa.PaperTodo.MemoStress, its own storage
#    folder filled by scripts/memo-stress-data.py), started behind the person's apps (`open -g`), never active, every
#    window far off the screens (`--offscreen`), the drawer opened by the app itself a second after start
#    (`--open-drawer`; its panel never takes the keyboard in a check, TestHooks.staysBehind). Start → note visible and
#    memory per memo count, the drawer's first open in the app, idle with the drawer open (20 s).
# 2. In one process (scripts/perf-drawer.sh, Tests/PaperTodoTests/DrawerBench.swift): the drawer's first open and reopen,
#    ↓ through the list (each step picks and scrolls), ↩ on a memo, each key typed in it, the list catching up after the
#    keys, Esc, whether the keys were saved, memory, and ↩ in the quick-write slip with the saves it sets off
#    (memos.json, memo-folders.json). `long` also opens and types in memos of 10 KB, 100 KB and 1 MB and opens a
#    2,000-line checklist.
#
#   scripts/perf-memo.sh [tier …] [--no-build | --build-only]      tiers: 50 500 2000 5000 long (default: all)
#
# --no-build: the test copy as last built; --build-only: build it and stop. ONLY_APP=1 / ONLY_BENCH=1: one part.
# #132, #3: OPEN_CEILING ms (default 150), FIRST_CEILING · FIRST_CEILING_BIG (150 · 200, see perf-drawer.sh) and
# CEILING_LOAD (default 6) as before: a first open or an ↩ over the ceiling
# fails the run when the 1-minute load is at most CEILING_LOAD. PROFILE=1 samples the keys (sample(1)); KEYS, RUNS,
# SAMPLE_MEMO and APP_SOURCES: see scripts/perf-drawer.sh. PERF_MEMO_OUT=<folder> keeps the builds and the samples
# elsewhere (PERF_DRAWER_OUT). The installed app and its data are never touched; everything the copy wrote is removed.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="${PERF_MEMO_OUT:-$repo/.build/perf-memo}"
build=1; only=0; tiers=()
for arg in "$@"; do
    case "$arg" in --no-build) build=0 ;; --build-only) only=1 ;; *) tiers+=("$arg") ;; esac
done
[ ${#tiers[@]} -eq 0 ] && tiers=(50 500 2000 5000 long)
bundle_id=com.noa.PaperTodo.MemoStress
# #278: never the real app's com.noa.PaperTodo (its settings and data folder share this name).
source "$repo/scripts/lib/test-defaults.sh"
test_defaults_require "$bundle_id"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
app="$out/MemoStress.app"
probe="$out/perf-probe"
log="$out/perf.log"
storage="$HOME/Library/Application Support/$bundle_id"

if [ "$build" = 1 ] && [ "${ONLY_BENCH:-0}" != 1 ]; then
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
    test_defaults_remove "$bundle_id"
}
trap cleanup EXIT

fresh() {  # fresh <memo-stress-data.py args…>
    stop
    rm -rf "$storage"; mkdir -p "$storage"
    python3 -I "$repo/scripts/memo-stress-data.py" "$storage" "$@" --marker >/dev/null
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
# Every shown window of the test copy off the screens, as the window server has it.
offscreen_check() {
    if ! "$probe" offscreen "$pid"; then echo "a window of the test copy is on a screen: stopping"; exit 1; fi
}
launch() {
    : > "$log"
    open -g -n --env PAPERTODO_OFFSCREEN=1 "$app" --args --perf-log "$log" --offscreen --open-drawer
    for _ in $(seq 1 100); do pid=$(pgrep -f "$app/Contents/MacOS/PaperTodo" | head -1 || true); [ -n "$pid" ] && break; sleep 0.05; done
    for _ in $(seq 1 300); do grep -q '^drawer ' "$log" 2>/dev/null && break; sleep 0.1; done
    sleep 1.5
    offscreen_check
}

if [ "${ONLY_BENCH:-0}" != 1 ]; then
    echo "== 메모 서랍 in the app · $(date '+%Y-%m-%d %H:%M') · $(sw_vers -productVersion) · $(sysctl -n machdep.cpu.brand_string)"
    for tier in "${tiers[@]}"; do
        case "$tier" in
            long) fresh --memos 500 --long 10,100,1024 --checklist 2000 ;;
            *) fresh --memos "$tier" ;;
        esac
        launch
        echo "-- tier $tier · load $(sysctl -n vm.loadavg)"
        echo "  start → note visible: $(grep '^noteVisible' "$log" | awk '{print $NF}') ms · $("$probe" mem "$pid")"
        echo "  drawer first open (the app opens it, --open-drawer): $(grep '^drawer ' "$log" | head -1 | awk '{print $NF}') ms"
        sleep 2
        echo "  idle, drawer open (20 s): $("$probe" sample "$pid" 20)"
        offscreen_check
        cp "$log" "$out/perf-$tier.log"
        stop
    done
fi
[ "${ONLY_APP:-0}" = 1 ] && exit 0
[ -n "${PERF_MEMO_OUT:-}" ] && export PERF_DRAWER_OUT="$PERF_MEMO_OUT"
"$(cd "$(dirname "$0")" && pwd)/perf-drawer.sh" "${tiers[@]}"
