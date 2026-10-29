#!/bin/bash
# 메모 서랍 under load: the core's timings per tier (docs/perf-memo-stress.md). Each tier is a folder made by
# scripts/memo-stress-data.py in a temporary folder; nothing of the app's own data is read or written.
#
#   scripts/bench-memo-stress.sh [tier …]      tiers: 50 500 2000 5000 (default: all), long, check
#
# `long` is 500 memos plus memos of 10 KB, 100 KB and 1 MB and a 2,000-line checklist.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
bin=.build/checks/MemoStressBench
swiftc -O -parse-as-library \
    Sources/PaperCore/AppLanguage.swift Sources/PaperCore/TodoItem.swift Sources/PaperCore/TimeBlock.swift \
    Sources/PaperCore/Notebook.swift Sources/PaperCore/Carry.swift Sources/PaperCore/Archive.swift \
    Sources/PaperCore/Deadline.swift Sources/PaperCore/Shelf.swift Sources/PaperCore/Repeat.swift \
    Sources/PaperCore/QuickParse.swift Sources/PaperCore/Duration.swift Sources/PaperCore/Alarm.swift \
    Sources/PaperCore/CalendarDay.swift Sources/PaperCore/CalendarDraft.swift Sources/PaperCore/LocalEvent.swift \
    Sources/PaperCore/Memo.swift Sources/PaperCore/MemoFolders.swift Sources/PaperCore/MemoFolderSearch.swift \
    Sources/PaperCore/MemoCards.swift Sources/PaperCore/TextMerge.swift Sources/PaperCore/Intent.swift \
    Sources/PaperCore/DayRibbon.swift Sources/PaperCore/Ahead.swift Sources/PaperCore/Convenience.swift \
    Sources/PaperCore/PetChatter.swift Sources/PaperCore/BubbleText.swift Sources/PaperCore/PetAsk.swift \
    Tests/PaperCoreTests/MemoStressBench.swift \
    -o "$bin"
data="$(mktemp -d)"
trap 'rm -rf "$data"' EXIT
tiers=("$@")
[ ${#tiers[@]} -eq 0 ] && tiers=(50 500 2000 5000 long)
for tier in "${tiers[@]}"; do
    case "$tier" in
        long) python3 -I scripts/memo-stress-data.py "$data/$tier" --memos 500 --long 10,100,1024 --checklist 2000 ;;
        check) python3 -I scripts/memo-stress-data.py "$data/$tier" --memos 2000 --long 100 --checklist 2000 ;;
        *) python3 -I scripts/memo-stress-data.py "$data/$tier" --memos "$tier" ;;
    esac
    if [ "$tier" = check ]; then
        "$bin" "$data/$tier" --runs 3 --check
    else
        "$bin" "$data/$tier" --runs "${RUNS:-5}"
    fi
    echo
done
