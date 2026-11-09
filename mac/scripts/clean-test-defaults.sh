#!/bin/bash
# Clears what earlier checks left behind (#278), once. Before #278 every check and renderer left its throwaway
# preferences in ~/Library/Preferences (PaperTodo.<group>.<UUID>.plist, com.noa.PaperTodo.<test copy>.plist), and the
# Windows tests left their folders in the temporary folder.
#
#   scripts/clean-test-defaults.sh            lists them, changes nothing (the default, same as --dry-run)
#   scripts/clean-test-defaults.sh --now      moves them to a dated folder in ~/.Trash (nothing is deleted)
#   … --temp                                  also the tests' temporary folders (paper-todo-*-XXXXXX …) an hour or more old
#
# The real app's ~/Library/Preferences/com.noa.PaperTodo.plist is never listed or moved: every name passes
# scripts/lib/test-defaults.sh first, which refuses it in any letter case. Checked by scripts/test-defaults-cleanup.sh.
# PAPERTODO_PREFS_DIR, PAPERTODO_TEMP_DIR and PAPERTODO_TRASH_DIR point it at other folders (for that check).
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib/test-defaults.sh"

now=0 temp=0
for argument in "$@"; do
    case "$argument" in
        --dry-run) now=0 ;;
        --now) now=1 ;;
        --temp) temp=1 ;;
        *) echo "Unknown option: $argument (--dry-run, --now, --temp)" >&2; exit 1 ;;
    esac
done
prefs="${PAPERTODO_PREFS_DIR:-$HOME/Library/Preferences}"
temporary="${PAPERTODO_TEMP_DIR:-${TMPDIR:-/tmp}}"
trash="${PAPERTODO_TRASH_DIR:-$HOME/.Trash}"

found=()
kept_app=0
shopt -s nullglob nocaseglob
for file in "$prefs"/PaperTodo.*.plist "$prefs"/com.noa.PaperTodo*.plist; do
    [ -f "$file" ] && [ ! -L "$file" ] || continue
    base=${file##*/}
    name=${base%.[pP][lL][iI][sS][tT]}
    # The real app's file, spelled any way, and any other name the rule doesn't know: never.
    if ! test_defaults_name_ok "$name"; then
        [ "$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" = "com.noa.papertodo" ] && kept_app=1
        continue
    fi
    found+=("$file")
done
prefs_count=${#found[@]}
if [ "$temp" = 1 ]; then
    while IFS= read -r -d '' folder; do
        found+=("$folder")
    done < <(find "$temporary" -mindepth 1 -maxdepth 1 -type d -mmin +60 \( \
        -name 'paper-todo-*-??????' -o -name 'paper-repeat-??????' -o -name 'paper-memo-??????' -o -name 'paper-audit-??????' \
        -o -name 'paper-perf-??????' -o -name 'paper-memo-perf-??????' \
        -o -name 'PaperTodo-presentation-*-*-*-*-*' -o -name 'PaperDesign-*-*-*-*-*' -o -name 'PaperThemes-*-*-*-*-*' \
        -o -name 'typing-bench-*-*-*-*-*' \) -print0)
fi
shopt -u nullglob nocaseglob
temp_count=$(( ${#found[@]} - prefs_count ))

# A summary by group: PaperTodo.Design.<UUID>.plist → PaperTodo.Design, paper-todo-ai-Ab12Cd → paper-todo-ai.
summary() {
    printf '%s\n' "$@" | sed -E 's#.*/##; s/\.plist$//; s/[.-][0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$//; s/-[A-Za-z0-9]{6}$//' \
        | sort | uniq -c | sort -rn
}

if [ "$now" = 0 ]; then
    [ "${#found[@]}" -gt 0 ] && printf '%s\n' "${found[@]}"
    echo
fi
[ "${#found[@]}" -gt 0 ] && summary "${found[@]}"
echo "Test preferences in $prefs: $prefs_count"
[ "$temp" = 1 ] && echo "Test folders in $temporary (an hour or more old): $temp_count"
[ "$kept_app" = 1 ] && echo "Kept: the app's own com.noa.PaperTodo.plist (never moved)."

if [ "$now" = 0 ]; then
    echo "Nothing moved (dry run). Run with --now to move them to the Trash."
    exit 0
fi
if [ "${#found[@]}" -eq 0 ]; then
    echo "Nothing to move."
    exit 0
fi
destination="$trash/PaperTodo test leftovers $(date +%Y-%m-%d\ %H%M%S)"
mkdir -p "$destination"
[ "$prefs_count" -gt 0 ] && mkdir -p "$destination/Preferences"
[ "$temp_count" -gt 0 ] && mkdir -p "$destination/Temporary"
if [ "$prefs_count" -gt 0 ]; then
    printf '%s\0' "${found[@]:0:$prefs_count}" | xargs -0 -J % mv -n % "$destination/Preferences/"
fi
if [ "$temp_count" -gt 0 ]; then
    printf '%s\0' "${found[@]:$prefs_count}" | xargs -0 -J % mv -n % "$destination/Temporary/"
fi
echo "Moved ${#found[@]} to $destination"
