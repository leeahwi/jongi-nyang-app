#!/bin/bash
# #278: the checks' throwaway preferences leave nothing behind, and nothing here touches the real app's
# com.noa.PaperTodo.plist: Tests/PaperTodoTests/TestDefaults.swift, scripts/lib/test-defaults.sh and
# scripts/clean-test-defaults.sh (on fictional folders only).
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
source scripts/lib/test-defaults.sh
failures=0
expect() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi; }

# 1. The Swift helper.
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Tests/PaperTodoTests/TestDefaults.swift Tests/PaperTodoTests/TestDefaultsTests.swift \
    -o .build/checks/PaperTodoTestDefaultsTests
report="$(.build/checks/PaperTodoTestDefaultsTests)" || { echo "$report"; exit 1; }
echo "$report" | grep -v '^suite '
read -r _ suite_name suite_path < <(echo "$report" | grep '^suite ')
sleep 5
expect "after the process ended, no file in ~/Library/Preferences for $suite_name" "[ ! -e \"\$HOME/Library/Preferences/$suite_name.plist\" ]"
expect "after the process ended, no file in the temporary folder" "[ ! -e \"$suite_path.plist\" ]"

# 2. The shell rule: the same names as the Swift one.
for name in com.noa.PaperTodo COM.NOA.PAPERTODO com.noa.papertodo com.noa.PaperTodo. com.noa.PaperTodoX com.noa.PaperTodo.plist \
    com.noa.PaperTodo..Perf2 com.noa.PaperTodo.Perf2.plist PaperTodo PaperTodo. '' ' com.noa.PaperTodo' 'com.noa.PaperTodo ' \
    com.noa.PaperTodo/../com.noa.PaperTodo "$HOME/Library/Preferences/com.noa.PaperTodo" NSGlobalDomain com.apple.finder; do
    expect "shell refuses ‘$name’" "! test_defaults_name_ok '$name'"
done
for name in PaperTodo.Design.6F1C2A9E-0000-4000-8000-000000000000 PaperTodo.Preview com.noa.PaperTodo.Perf2 com.noa.PaperTodo.LiveTest; do
    expect "shell allows ‘$name’" "test_defaults_name_ok '$name'"
done
expect "test_defaults_require stops on com.noa.PaperTodo" "! ( test_defaults_require com.noa.PaperTodo ) 2>/dev/null"
expect "test_defaults_remove stops on com.noa.PaperTodo (before defaults delete)" "! ( defaults() { echo called; }; test_defaults_remove com.noa.PaperTodo ) 2>/dev/null | grep -q called"

# 3. The cleanup script, on fictional folders.
sandbox="$(mktemp -d "${TMPDIR:-/tmp}/paper-defaults-cleanup-check.XXXXXX")"
trap 'rm -rf "$sandbox"' EXIT
mkdir -p "$sandbox/Preferences" "$sandbox/tmp" "$sandbox/Trash"
printf 'the app'"'"'s own settings\n' > "$sandbox/Preferences/com.noa.PaperTodo.plist"
for name in PaperTodo.Design.6F1C2A9E-0000-4000-8000-000000000000 PaperTodo.PresentationTests.0A1B2C3D-0000-4000-8000-000000000000 \
    com.noa.PaperTodo.Perf2 com.noa.PaperTodoX com.apple.finder; do
    : > "$sandbox/Preferences/$name.plist"
done
mkdir "$sandbox/tmp/paper-todo-ai-Ab12Cd" "$sandbox/tmp/paper-todo-backup-Zz9Yy8" "$sandbox/tmp/other-folder-Ab12Cd"
touch -t 202610010000 "$sandbox/tmp/paper-todo-ai-Ab12Cd" "$sandbox/tmp/other-folder-Ab12Cd"
before="$(shasum "$sandbox/Preferences/com.noa.PaperTodo.plist")"
clean() { PAPERTODO_PREFS_DIR="$sandbox/Preferences" PAPERTODO_TEMP_DIR="$sandbox/tmp" PAPERTODO_TRASH_DIR="$sandbox/Trash" scripts/clean-test-defaults.sh "$@"; }
dry="$(clean --temp)"
expect "dry run lists the two test suites and the test copy" "[ \"\$(echo \"\$dry\" | grep -c '^$sandbox/Preferences/')\" = 3 ]"
expect "dry run never lists com.noa.PaperTodo.plist" "! echo \"\$dry\" | grep -q '/com.noa.PaperTodo.plist'"
expect "dry run lists only the old test folder" "[ \"\$(echo \"\$dry\" | grep -c '^$sandbox/tmp/')\" = 1 ] && echo \"\$dry\" | grep -q paper-todo-ai-Ab12Cd"
expect "dry run moves nothing" "[ \"\$(ls \"$sandbox/Preferences\" | wc -l | tr -d ' ')\" = 6 ] && [ -z \"\$(ls \"$sandbox/Trash\")\" ]"
clean --now --temp >/dev/null
expect "--now keeps com.noa.PaperTodo.plist as it was" "[ \"\$(shasum \"$sandbox/Preferences/com.noa.PaperTodo.plist\")\" = \"$before\" ]"
expect "--now keeps names that aren't tests" "[ -e \"$sandbox/Preferences/com.noa.PaperTodoX.plist\" ] && [ -e \"$sandbox/Preferences/com.apple.finder.plist\" ]"
expect "--now moves the three to a dated folder in the Trash" "[ \"\$(ls \"$sandbox\"/Trash/*/Preferences | wc -l | tr -d ' ')\" = 3 ]"
expect "--now moves the old test folder only" "[ -d \"$sandbox\"/Trash/*/Temporary/paper-todo-ai-Ab12Cd ] && [ -d \"$sandbox/tmp/paper-todo-backup-Zz9Yy8\" ] && [ -d \"$sandbox/tmp/other-folder-Ab12Cd\" ]"
expect "nothing in the Trash is the app's file" "[ -z \"\$(find \"$sandbox/Trash\" -iname 'com.noa.PaperTodo.plist')\" ]"

if [ "$failures" -gt 0 ]; then echo "$failures failed"; exit 1; fi
echo "All test-defaults checks passed."
