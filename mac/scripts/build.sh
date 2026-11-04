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
# #174: the release build reads no test switches (--demo, --snapshot, --storage, the logs …; TestHooks.swift). Only this
# script sets the flag; test and check scripts build without it.
release_flag=(-Xswiftc -DPAPERTODO_RELEASE)
# #182: SwiftPM's resource bundle accessor (`Bundle.module`) writes its absolute build folder into the binary, and the
# prefix map doesn't reach it. The app reads Assets from Contents/Resources instead (AppResources.swift), so the app
# build turns the resource bundle off (Package.swift) in its own build folder — debug builds, tests and snapshots keep
# theirs in .build as before.
export PAPERTODO_APP_BUNDLE=1
app_build=(--scratch-path "$task_root/.build/app")
swift build -c release -Xswiftc -warnings-as-errors "${app_build[@]}" "${release_flag[@]}" "${prefix_map[@]}"
binary_directory="$(swift build -c release "${app_build[@]}" "${release_flag[@]}" "${prefix_map[@]}" --show-bin-path)"
bundle="$task_root/dist/종이냥.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp "$binary_directory/PaperTodo" "$bundle/Contents/MacOS/PaperTodo"
# #220: the linker lists each object file's absolute path (N_OSO debug-map entries) for later symbol lookup, and the
# prefix map doesn't reach it. Drop the debug symbols before signing; the app keeps its global symbols.
strip -S "$bundle/Contents/MacOS/PaperTodo"
# Stop before packing if a build path (with this Mac's home folder name) is in the binary again. Counts only. Searched
# in the bytes: `strings` missed the debug-map paths (#220).
home_paths="$({ LC_ALL=C grep -a -o -F -e '/Users/' -e "$HOME" "$bundle/Contents/MacOS/PaperTodo" || true; } | wc -l | tr -d ' ')"
if [ "$home_paths" != "0" ]; then
    echo "The binary holds $home_paths absolute home path(s) — see #182." >&2
    exit 1
fi
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
# #145: the third-party notices (the fonts, and the MIT · ISC · BSD packages inside 종이냥 for Claude) go along, as
# the Windows installer's resources/NOTICE.txt does (#128).
cp "$task_root/../NOTICE" "$bundle/Contents/Resources/NOTICE"
swift scripts/make-icon.swift "$bundle/Contents/Resources" "$task_root/Sources/PaperTodo/Assets/PaperCat.png"
# #175 (security review S-01): ad-hoc signed with the hardened runtime (no Developer ID yet: the user's call). Checked on
# an off-screen test copy: the app starts, the bundled extension's files are sealed, Carbon hot keys register and
# `claude mcp add` (zsh) still runs. No entitlements are needed.
codesign --force --deep --options runtime --sign - "$bundle"
codesign --verify --deep --strict "$bundle"
printf 'Built: %s\n' "$bundle"
