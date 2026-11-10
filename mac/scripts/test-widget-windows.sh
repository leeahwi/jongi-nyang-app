#!/bin/bash
# 바탕화면 달력 위젯 (#320 · #322): the real widget windows, far off screen — added, removed (the toast with 되돌리기), put
# back, removed again until the toast goes — checked in the window server's pixels and window list, by day and at night.
#
#   scripts/test-widget-windows.sh [folder]     the folder gets each step's picture over a made-up wallpaper (2×)
set -euo pipefail
export PAPERTODO_OFFSCREEN=1
cd "$(dirname "$0")/.."
output="${1:-}"
swift build -Xswiftc -warnings-as-errors >/dev/null
bin_path="$(swift build --show-bin-path)"
checks=".build/checks/widget-windows"
mkdir -p "$checks"
rm -rf "$checks"/*.lproj
cp -R Resources/*.lproj "$checks/"
program="$checks/PaperTodoWidgetWindows"
swiftc -warnings-as-errors -parse-as-library -I "$bin_path/Modules" \
    $(find Sources/PaperTodo -name '*.swift' ! -name 'PaperTodoApp.swift' | sort) \
    "$bin_path/PaperTodo.build/DerivedSources/resource_bundle_accessor.swift" \
    "$bin_path"/PaperCore.build/*.swift.o Tests/PaperTodoTests/WidgetWindowChecks.swift Tests/PaperTodoTests/TestDefaults.swift \
    -o "$program"
status=0
for paper in day night; do
    PAPERTODO_PAPER="$paper" "$program" ${output:+"$output"} || status=1
done
exit $status
