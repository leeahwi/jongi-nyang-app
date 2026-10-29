#!/bin/bash
set -euo pipefail

task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
# 종이냥 for Claude (1.42): the extension (.mcpb) and its program, built in windows/ with `npm run mcp:build`
# (PAPERTODO_MCP_DIST points elsewhere). Checked first, so a missing one fails before the long build.
mcp_dist="${PAPERTODO_MCP_DIST:-$task_root/../windows/mcp/dist}"
for file in server/index.js jongi-nyang.mcpb; do
    if [ ! -f "$mcp_dist/$file" ]; then
        echo "Missing $mcp_dist/$file — build the extension first: (cd ../windows && npm run mcp:build)" >&2
        exit 1
    fi
done
# Source paths end up in the binary (#file in assertions and logs); write them relative to the
# package so the app doesn't carry this machine's home folder.
prefix_map=(-Xswiftc -file-prefix-map -Xswiftc "$task_root=.")
swift build -c release -Xswiftc -warnings-as-errors "${prefix_map[@]}"
binary_directory="$(swift build -c release "${prefix_map[@]}" --show-bin-path)"
bundle="$task_root/dist/종이냥.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp "$binary_directory/PaperTodo" "$bundle/Contents/MacOS/PaperTodo"
cp Resources/Info.plist "$bundle/Contents/Info.plist"
rm -rf "$bundle/Contents/Resources/Assets"
cp -R Sources/PaperTodo/Assets "$bundle/Contents/Resources/"
rm -f "$bundle/Contents/Resources/Assets/PaperBear.png"
# Translations: Korean is the source, English and Dutch tables (see scripts/i18n/check.sh).
rm -rf "$bundle"/Contents/Resources/*.lproj
cp -R Resources/*.lproj "$bundle/Contents/Resources/"
rm -rf "$bundle/Contents/Resources/mcp"
mkdir -p "$bundle/Contents/Resources/mcp/server"
cp "$mcp_dist/server/index.js" "$bundle/Contents/Resources/mcp/server/index.js"
cp "$mcp_dist/jongi-nyang.mcpb" "$bundle/Contents/Resources/mcp/jongi-nyang.mcpb"
swift scripts/make-icon.swift "$bundle/Contents/Resources" "$task_root/Sources/PaperTodo/Assets/PaperCat.png"
codesign --force --deep --sign - "$bundle"
printf 'Built: %s\n' "$bundle"
