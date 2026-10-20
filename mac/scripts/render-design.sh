#!/bin/bash
# Renders the design snapshots.  scripts/render-design.sh [ko|en|nl] [day|night] [output folder]
# Korean (the default) goes to docs/design; English and Dutch to docs/design/en and docs/design/nl.
# `night` draws everything in 밤 종이 into a night/ folder beside them (docs/design/night, docs/design/en/night …).
# PAPERTODO_ONLY=note-,ahead draws only the files whose names contain one of those words.
set -euo pipefail
# Draw sample reminders off-screen so they never pop up over real work.
export PAPERTODO_OFFSCREEN=1
cd "$(dirname "$0")/.."
language="${1:-${PAPERTODO_LANG:-ko}}"
case "$language" in
    ko) default_output="docs/design" ;;
    en|nl) default_output="docs/design/$language" ;;
    *) echo "Unknown language: $language (ko, en or nl)" >&2; exit 1 ;;
esac
paper="day"
if [ "${2:-}" = "day" ] || [ "${2:-}" = "night" ]; then
    paper="$2"
    shift
fi
[ "$paper" = "night" ] && default_output="$default_output/night"
output="${2:-$default_output}"
swift build -Xswiftc -warnings-as-errors
bin_path="$(swift build --show-bin-path)"
# The renderer finds the translations next to itself, like the app in its bundle.
checks=".build/checks/design"
mkdir -p "$checks" "$output"
rm -rf "$checks"/*.lproj
cp -R Resources/*.lproj "$checks/"
swiftc -warnings-as-errors -parse-as-library -I "$bin_path/Modules" \
  $(rg --files Sources/PaperTodo -g '*.swift' -g '!PaperTodoApp.swift' | sort) \
  "$bin_path/PaperTodo.build/DerivedSources/resource_bundle_accessor.swift" \
  "$bin_path"/PaperCore.build/*.swift.o Tests/PaperTodoTests/DesignSnapshots.swift \
  -o "$checks/PaperTodoDesignSnapshots"
case "$output" in /*) ;; *) output="$PWD/$output" ;; esac
PAPERTODO_LANG="$language" PAPERTODO_PAPER="$paper" "$checks/PaperTodoDesignSnapshots" "$output"
