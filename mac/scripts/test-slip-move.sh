#!/bin/bash
# 질문 쪽지 옮기기 (#228, SlipMove.swift): where a dragged slip goes and how its head stays on the screen — the shared
# cases from shared/cases/slip-move-cases.json (the Windows app's test/slipMove.test.ts reads the same file). The clicks a
# question blocks, the times slips that open once per space and the nudge are checked by test-presentation.sh. #253: what
# works on the desktop calendar widgets while a question waits, from shared/cases/widget-ask-cases.json (test/slipMove.test.ts).
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/SlipMove.swift \
    Tests/PaperCoreTests/SlipMoveTests.swift \
    -o .build/checks/SlipMoveTests
.build/checks/SlipMoveTests ../shared/cases/slip-move-cases.json ../shared/cases/widget-ask-cases.json
