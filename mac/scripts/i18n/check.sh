#!/bin/bash
# Fails when any Korean text in the app has no English or Dutch translation (and a few more
# checks, see check.py). The compiler lists the texts the code looks up.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$task_root"
swift build -Xswiftc -warnings-as-errors >/dev/null
bin_path="$(swift build --show-bin-path)"
work="$task_root/.build/checks/i18n"
rm -rf "$work"
mkdir -p "$work/objects" "$work/strings"
sources=()
while IFS= read -r source; do
    sources+=("$task_root/$source")
done < <(find Sources/PaperTodo -maxdepth 1 -name '*.swift' -print | sort)
(cd "$work/objects" && swiftc -c -parse-as-library -module-name PaperTodo -I "$bin_path/Modules" \
    "${sources[@]}" "$bin_path/PaperTodo.build/DerivedSources/resource_bundle_accessor.swift" \
    -emit-localized-strings -emit-localized-strings-path "$work/strings")
python3 scripts/i18n/check.py "$work/strings" Sources/PaperTodo Resources "$@"
