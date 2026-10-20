#!/bin/bash
# Builds dist/JongiNyang-<version>.dmg: 종이냥.app next to an Applications shortcut, to drag across.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
app="$task_root/dist/종이냥.app"
if [[ "${1:-}" != "--no-build" ]]; then "$task_root/scripts/build.sh"; fi
version="$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$app/Contents/Info.plist")"
out="$task_root/dist/JongiNyang-$version.dmg"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
ditto "$app" "$staging/종이냥.app"
ln -s /Applications "$staging/Applications"
hdiutil create -volname "종이냥 $version" -srcfolder "$staging" -fs HFS+ -format UDZO -ov "$out" >/dev/null
hdiutil verify "$out" >/dev/null
echo "Built: $out"
