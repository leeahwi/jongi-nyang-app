#!/bin/bash
# 종이 테마 (#244): renders each paper on the note, the desk's month and the drawer, and the 꾸미기 → 종이 tiles, off-screen
# from made-up data.  scripts/render-paper-themes.sh [ko|en|nl] [day|night]
# Korean goes to docs/design/papers, English and Dutch to docs/design/<lang>/papers; night into a night/ folder beside them.
# PAPERTODO_PAPERS=memo,lined,chalk draws only those papers; PAPERTODO_ONLY=gallery only the tiles and the desk pane.
set -euo pipefail
export PAPERTODO_OFFSCREEN=1
cd "$(dirname "$0")/.."
language="${1:-ko}"
paper="${2:-day}"
case "$language" in
    ko) output="docs/design/papers" ;;
    en|nl) output="docs/design/$language/papers" ;;
    *) echo "Unknown language: $language (ko, en or nl)" >&2; exit 1 ;;
esac
case "$paper" in
    day) ;;
    night) output="$output/night" ;;
    *) echo "Unknown paper: $paper (day or night)" >&2; exit 1 ;;
esac
swift build -Xswiftc -warnings-as-errors
bin_path="$(swift build --show-bin-path)"
checks=".build/checks/paper-themes"
mkdir -p "$checks" "$output"
rm -rf "$checks"/*.lproj
cp -R Resources/*.lproj "$checks/"
renderer="$checks/PaperThemeSnapshots"
if [ -x "$renderer" ] && [ -z "$(find Sources Tests/PaperTodoTests/PaperThemeSnapshots.swift "$bin_path"/PaperCore.build -newer "$renderer" \( -name '*.swift' -o -name '*.o' \) -print -quit)" ]; then
    echo "Renderer is up to date."
else
    swiftc -warnings-as-errors -parse-as-library -I "$bin_path/Modules" \
        $(find Sources/PaperTodo -maxdepth 1 -name '*.swift' ! -name 'PaperTodoApp.swift' | sort) \
        "$bin_path/PaperTodo.build/DerivedSources/resource_bundle_accessor.swift" \
        "$bin_path"/PaperCore.build/*.swift.o Tests/PaperTodoTests/PaperThemeSnapshots.swift \
        -o "$renderer"
fi
PAPERTODO_LANG="$language" PAPERTODO_PAPER="$paper" "$renderer" "$PWD/$output"
