#!/bin/bash
set -euo pipefail

task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"

bin_path="$(swift build --show-bin-path)"
modules_path="$bin_path/Modules"
core_build="$bin_path/PaperCore.build"
todo_build="$bin_path/PaperTodo.build"
resource_accessor="$todo_build/DerivedSources/resource_bundle_accessor.swift"

if [[ ! -d "$modules_path" || ! -f "$modules_path/PaperCore.swiftmodule" ]]; then
    echo "Missing PaperCore debug module under $modules_path. Run the normal debug build first." >&2
    exit 1
fi

if [[ ! -f "$resource_accessor" ]]; then
    echo "Missing generated resource bundle accessor at $resource_accessor. Run the normal debug build first." >&2
    exit 1
fi

shopt -s nullglob
core_objects=("$core_build"/*.swift.o)
shopt -u nullglob
if [[ ${#core_objects[@]} -eq 0 ]]; then
    echo "Missing PaperCore debug objects under $core_build. Run the normal debug build first." >&2
    exit 1
fi

mkdir -p .build/checks
todo_sources=()
while IFS= read -r source; do
    todo_sources+=("$source")
done < <(find Sources/PaperTodo -maxdepth 1 -name '*.swift' ! -name 'PaperTodoApp.swift' -print | sort)

swiftc -warnings-as-errors -parse-as-library \
    -I "$modules_path" \
    "${todo_sources[@]}" \
    "$resource_accessor" \
    "${core_objects[@]}" \
    Tests/PaperTodoTests/FloatingMascotPlacementTests.swift \
    -o .build/checks/FloatingMascotPlacementTests

.build/checks/FloatingMascotPlacementTests
