#!/bin/bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
"$task_root/scripts/build.sh"
qa_bundle="$task_root/.build/qa/PaperTodoQA.app"
mkdir -p "$task_root/.build/qa"
ditto "$task_root/dist/종이냥.app" "$qa_bundle"
plutil -replace CFBundleIdentifier -string com.noa.PaperTodo.QA "$qa_bundle/Contents/Info.plist"
plutil -replace CFBundleName -string '종이냥 QA' "$qa_bundle/Contents/Info.plist"
plutil -replace CFBundleDisplayName -string '종이냥 QA' "$qa_bundle/Contents/Info.plist"
rm -f "$qa_bundle/Contents/Resources/Assets/PaperBear.png"
codesign --force --deep --sign - "$qa_bundle"
if [[ "${1:-}" != "--build-only" ]]; then
    open "$qa_bundle"
fi
