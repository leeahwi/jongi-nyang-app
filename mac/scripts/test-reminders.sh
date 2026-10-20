#!/bin/bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/ReminderSchedule.swift \
    Tests/PaperCoreTests/ReminderScheduleTests.swift \
    -o .build/checks/ReminderScheduleTests
.build/checks/ReminderScheduleTests
