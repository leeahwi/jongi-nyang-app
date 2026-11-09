# shellcheck shell=bash
# Throwaway preferences of the checks and test copies (#278), sourced by the scripts that make them.
#
# The real app is bundle id com.noa.PaperTodo with ~/Library/Preferences/com.noa.PaperTodo.plist: never read, written
# or deleted here. A name passes only as PaperTodo.<something> (the checks' suites) or com.noa.PaperTodo.<something>
# (a test copy, like com.noa.PaperTodo.Perf2), in any letter case. Tests/PaperTodoTests/TestDefaults.swift
# (isTestName) follows the same rule, and scripts/test-defaults-cleanup.sh checks both.

# Whether $1 may be a throwaway preferences domain.
# Letter case is ignored (the disk ignores it too). No subshell, so it is quick over thousands of names.
test_defaults_name_ok() {
    local name=${1:-} ok=1
    shopt -s nocasematch
    if [[ "$name" != "com.noa.papertodo" && "$name" != *.plist && "$name" =~ ^(com\.noa\.)?papertodo\.[a-z0-9][a-z0-9._-]*$ ]]; then
        ok=0
    fi
    shopt -u nocasematch
    return $ok
}

# Stops the script when $1 is not a throwaway domain (call it right after choosing a test copy's bundle id, before
# anything is written or removed under that name).
test_defaults_require() {
    if ! test_defaults_name_ok "${1:-}"; then
        echo "Refusing ‘${1:-}’: not a test copy's name (com.noa.PaperTodo.<something>). The real app's settings stay as they are." >&2
        exit 2
    fi
}

# Removes the domain $1 and its file. `defaults delete` alone leaves an empty .plist behind; once cfprefsd has
# written that, deleting the file keeps it gone.
test_defaults_remove() {
    test_defaults_require "${1:-}"
    defaults delete "$1" >/dev/null 2>&1 || true
    rm -f "$HOME/Library/Preferences/$1.plist"
}
