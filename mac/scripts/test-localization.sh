#!/bin/bash
# The app layer in Korean, English and Dutch: one run per language (the bundle picks its
# language once), with the translation tables next to the test binary like in the app bundle.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
swift build -Xswiftc -warnings-as-errors >/dev/null
bin_path="$(swift build --show-bin-path)"
checks=".build/checks/localization"
mkdir -p "$checks"
rm -rf "$checks"/*.lproj
cp -R Resources/*.lproj "$checks/"
todo_sources=()
while IFS= read -r source; do
    todo_sources+=("$source")
done < <(find Sources/PaperTodo -maxdepth 1 -name '*.swift' ! -name 'PaperTodoApp.swift' -print | sort)
swiftc -warnings-as-errors -parse-as-library -I "$bin_path/Modules" \
    "${todo_sources[@]}" \
    "$bin_path/PaperTodo.build/DerivedSources/resource_bundle_accessor.swift" \
    "$bin_path"/PaperCore.build/*.swift.o \
    Tests/PaperTodoTests/LocalizationTests.swift \
    -o "$checks/LocalizationTests"
for language in ko en nl; do
    PAPERTODO_LANG="$language" "$checks/LocalizationTests"
done
