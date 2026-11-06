#!/bin/bash
# 바탕화면 달력 위젯 (#234): renders the widget snapshots.  scripts/render-widgets.sh [ko|en|nl] [day|night]
# Korean goes to docs/design/widget, English and Dutch to docs/design/en/widget and docs/design/nl/widget; night into
# a night/ folder beside them (as scripts/render-design.sh). Every window is drawn far off screen.
set -euo pipefail
export PAPERTODO_OFFSCREEN=1
cd "$(dirname "$0")/.."
language="${1:-ko}"
paper="${2:-day}"
case "$language" in
    ko) output="docs/design" ;;
    en|nl) output="docs/design/$language" ;;
    *) echo "Unknown language: $language (ko, en or nl)" >&2; exit 1 ;;
esac
[ "$paper" = "night" ] && output="$output/night"
output="$PWD/$output/widget"
swift build -Xswiftc -warnings-as-errors >/dev/null
bin_path="$(swift build --show-bin-path)"
checks=".build/checks/widgets"
mkdir -p "$checks" "$output"
rm -rf "$checks"/*.lproj
cp -R Resources/*.lproj "$checks/"
renderer="$checks/PaperTodoWidgetSnapshots"
if [ -x "$renderer" ] && [ -z "$(find Sources Tests/PaperTodoTests/WidgetSnapshots.swift "$bin_path"/PaperCore.build -newer "$renderer" \( -name '*.swift' -o -name '*.o' \) -print -quit)" ]; then
    echo "Renderer is up to date."
else
    swiftc -warnings-as-errors -parse-as-library -I "$bin_path/Modules" \
        $(find Sources/PaperTodo -name '*.swift' ! -name 'PaperTodoApp.swift' | sort) \
        "$bin_path/PaperTodo.build/DerivedSources/resource_bundle_accessor.swift" \
        "$bin_path"/PaperCore.build/*.swift.o Tests/PaperTodoTests/WidgetSnapshots.swift \
        -o "$renderer"
fi
PAPERTODO_LANG="$language" PAPERTODO_PAPER="$paper" "$renderer" "$output"
echo "$output"
