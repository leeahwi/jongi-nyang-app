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
# #175 (security review S-01): the SHA-256 of each file the release attaches, for the notes' 파일 확인 table
# (docs/release-notes.md), and dist/SHA256SUMS-<version>.txt beside them (`shasum -a 256 -c` reads it).
mcpb="$app/Contents/Resources/mcp/jongi-nyang.mcpb"
sums="$task_root/dist/SHA256SUMS-$version.txt"
(cd "$task_root/dist" && shasum -a 256 "$(basename "$out")") > "$sums"
(cd "$(dirname "$mcpb")" && shasum -a 256 "$(basename "$mcpb")") >> "$sums"
echo "SHA-256 (docs/release-notes.md · 파일 확인):"
echo "| 파일 | SHA-256 |"
echo "| --- | --- |"
while read -r hash name; do echo "| \`$name\` | \`$hash\` |"; done < "$sums"
echo "($sums)"
