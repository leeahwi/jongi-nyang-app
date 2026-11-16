#!/bin/bash
# The core checks in one run: every script here that compiles PaperCore (or reads the sources) with swiftc and needs no
# window, screen, app build, network or timing. Self-review before a PR and the public CI's macOS job both run this, so
# they check the same things. Each script's output goes to .build/checks/core-logs/<name>.log; a failing one is printed.
#
#   scripts/test-core.sh           run them all (keeps going after a failure), exit 1 if any failed
#   scripts/test-core.sh --build   run `swift build -Xswiftc -warnings-as-errors` first
#   scripts/test-core.sh --list    print the scripts it runs and the ones it leaves out, with the reason
#
# test-paper-themes.sh also draws the open windows to bitmaps (never shown) with the app's debug build, so the debug build
# must be there: run `swift build` first (CI's build step does) or pass --build.
#
# A new scripts/test-*.sh must go in CORE or in OTHER below; an unlisted one fails the run, so none is forgotten.
set -uo pipefail
cd "$(dirname "$0")/.."

CORE=(
    test.sh
    test-ahead.sh test-ai.sh test-alarms.sh test-calendar-flows.sh test-calendar-reminders.sh test-calendar-widget.sh
    test-cat-size.sh test-contrast.sh test-convenience.sh test-daystrip.sh test-defaults-cleanup.sh test-duration.sh
    test-focus.sh test-intent.sh test-korean-calendar.sh test-markdown.sh test-memo-drawer.sh test-no-network.sh
    test-paper-themes.sh test-pointer-pace.sh test-reminders.sh test-screen-fit.sh test-settings.sh test-shortcuts.sh
    test-slip-move.sh test-space-device.sh test-spaces.sh test-sync-conflicts.sh test-synced-files.sh test-task-reminders.sh
    test-time-labels.sh test-timeblock.sh test-today-window.sh test-typing-cat.sh
)
# Left out, with the reason (run them by hand when you touch what they cover).
OTHER=(
    "test-backups.sh: needs the app's debug build (swift build) and its module"
    "test-floating-mascot-placement.sh: needs the app's debug build and its module"
    "test-note-ears.sh: needs the app's debug build and its module"
    "test-presentation.sh: draws reminder windows off-screen with the app layer"
    "test-localization.sh: builds the app layer once per language"
    "test-widget-windows.sh: opens real widget windows off-screen"
    "test-mcp-stdio.sh: needs Node and the extension's build (windows/mcp)"
    "test-memo-stress.sh: a timing check with ceilings, unreliable on shared runners"
)

if [ "${1:-}" = "--list" ]; then
    printf 'runs  %s\n' "${CORE[@]}"
    printf 'skips %s\n' "${OTHER[@]}"
    exit 0
fi

listed=" ${CORE[*]} "
for entry in "${OTHER[@]}"; do listed+="${entry%%:*} "; done
unlisted=()
for path in scripts/test*.sh; do
    name=${path#scripts/}
    [ "$name" = test-core.sh ] && continue
    [[ "$listed" == *" $name "* ]] || unlisted+=("$name")
done
if [ ${#unlisted[@]} -gt 0 ]; then
    echo "Not in CORE or OTHER of scripts/test-core.sh: ${unlisted[*]}" >&2
    exit 1
fi

if [ "${1:-}" = "--build" ]; then
    swift build -Xswiftc -warnings-as-errors || exit 1
fi
accessor="$(swift build --show-bin-path)/PaperTodo.build/DerivedSources/resource_bundle_accessor.swift"
if [ ! -f "$accessor" ]; then
    echo "No debug build (test-paper-themes.sh needs it): run swift build first, or scripts/test-core.sh --build" >&2
    exit 1
fi

logs=.build/checks/core-logs
mkdir -p "$logs"
failed=()
start=$SECONDS
for name in "${CORE[@]}"; do
    log="$logs/${name%.sh}.log"
    t=$SECONDS
    if "scripts/$name" > "$log" 2>&1; then
        printf 'ok    %-32s %3ss  %s\n' "$name" $((SECONDS - t)) "$(grep -v '^\s*$' "$log" | tail -1 | cut -c1-80)"
    else
        printf 'FAIL  %-32s %3ss\n' "$name" $((SECONDS - t))
        sed 's/^/      /' "$log" | tail -40
        failed+=("$name")
    fi
done
echo "core: $((${#CORE[@]} - ${#failed[@]})) of ${#CORE[@]} scripts passed in $((SECONDS - start))s (logs in mac/$logs)"
if [ ${#failed[@]} -gt 0 ]; then
    echo "failed: ${failed[*]}"
    exit 1
fi
