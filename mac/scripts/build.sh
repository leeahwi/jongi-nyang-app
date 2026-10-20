#!/bin/bash
set -euo pipefail

task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
swift build -c release -Xswiftc -warnings-as-errors
binary_directory="$(swift build -c release --show-bin-path)"
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
swift scripts/make-icon.swift "$bundle/Contents/Resources" "$task_root/Sources/PaperTodo/Assets/PaperCat.png"
codesign --force --deep --sign - "$bundle"
printf 'Built: %s\n' "$bundle"
