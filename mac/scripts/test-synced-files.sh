#!/bin/bash
# #411: every shared data file through SyncedJSONFile (PaperCore/SyncedFile.swift), one case table: catching up, this
# Mac's own write read back without reading, the same bytes again, a file written in place, a broken, unreadable, blocked
# or linked file. Temporary folders and made-up data only.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library Sources/PaperCore/*.swift Tests/PaperCoreTests/SyncedFileTests.swift -o .build/checks/SyncedFileTests
.build/checks/SyncedFileTests
