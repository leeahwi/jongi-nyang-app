#!/bin/bash
# Builds dist/JongiNyang-<version>.dmg: 종이냥.app next to an Applications shortcut, to drag across.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
app="$task_root/dist/종이냥.app"
if [[ "${1:-}" != "--no-build" ]]; then "$task_root/scripts/build.sh"; fi
version="$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$app/Contents/Info.plist")"
out="$task_root/dist/JongiNyang-$version.dmg"
sums="$task_root/dist/SHA256SUMS-$version.txt"
# #225: no DMG (or checksums) is left in dist/ unless this run made it and it passed the release path check — also an
# older one of the same version.
rm -f "$out" "$sums"
staging="$(mktemp -d)"
finished=0
trap 'rm -rf "$staging"; if [ "$finished" != 1 ]; then rm -f "$out" "$sums"; fi' EXIT
# #225: the app first, also with --no-build (it may be from before this check), then the image itself.
check_paths=(node "$task_root/../tools/check-release-paths.mjs")
"${check_paths[@]}" "$app"
ditto "$app" "$staging/종이냥.app"
ln -s /Applications "$staging/Applications"
hdiutil create -volname "종이냥 $version" -srcfolder "$staging" -fs HFS+ -format UDZO -ov "$out" >/dev/null
hdiutil verify "$out" >/dev/null
"${check_paths[@]}" "$out"
echo "Built: $out"
# #175 (security review S-01): the SHA-256 of each file the release attaches, for the notes' 파일 확인 table
# (docs/release-notes.md), and dist/SHA256SUMS-<version>.txt beside them (`shasum -a 256 -c` reads it).
mcpb="$app/Contents/Resources/mcp/jongi-nyang.mcpb"
(cd "$task_root/dist" && shasum -a 256 "$(basename "$out")") > "$sums"
(cd "$(dirname "$mcpb")" && shasum -a 256 "$(basename "$mcpb")") >> "$sums"
echo "SHA-256 (docs/release-notes.md · 파일 확인):"
echo "| 파일 | SHA-256 |"
echo "| --- | --- |"
while read -r hash name; do echo "| \`$name\` | \`$hash\` |"; done < "$sums"
echo "($sums)"
finished=1
