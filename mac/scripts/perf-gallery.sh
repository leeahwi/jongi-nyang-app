#!/bin/bash
# 위젯 더하기 (#319, Tests/PaperTodoTests/GalleryBench.swift): the gallery slip in its real window far off every screen,
# its tiles clicked as a mouse clicks them. Per click the main thread's CPU time for it and what it set off; whether the
# tile clicked is picked; where on a tile a press doesn't pick it.
#
#   scripts/perf-gallery.sh [ko|en|nl] [--rounds N]
#
# Run it from any copy of the app's sources (it builds that copy); nothing of the app's own data is touched.
set -euo pipefail
export PAPERTODO_OFFSCREEN=1
cd "$(dirname "$0")/.."
language="${1:-ko}"
[ $# -gt 0 ] && shift
swift build 2>&1 | tail -1
bin_path="$(swift build --show-bin-path)"
checks=".build/checks/gallery"
mkdir -p "$checks"
rm -rf "$checks"/*.lproj
cp -R Resources/*.lproj "$checks/"
sources=()
while IFS= read -r source; do sources+=("$source"); done < <(find Sources/PaperTodo -name '*.swift' ! -name 'PaperTodoApp.swift' -print | sort)
swiftc -O -parse-as-library -I "$bin_path/Modules" "${sources[@]}" "$bin_path/PaperTodo.build/DerivedSources/resource_bundle_accessor.swift" \
    "$bin_path"/PaperCore.build/*.swift.o Tests/PaperTodoTests/GalleryBench.swift Tests/PaperTodoTests/TestDefaults.swift \
    -o "$checks/GalleryBench" 2>&1 | grep -v "warning:" || true
PAPERTODO_LANG="$language" "$checks/GalleryBench" "$@"
