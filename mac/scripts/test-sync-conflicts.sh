#!/bin/bash
# #385: cloud conflict copies in the storage folder and joining two devices' lists by item — the shared cases in
# shared/cases/sync-conflict-cases.json (the Windows app is to read the same file), and todos · events · alarms.json as the
# app writes them. Made-up data only.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library Sources/PaperCore/*.swift Tests/PaperCoreTests/SyncConflictTests.swift -o .build/checks/SyncConflictTests
.build/checks/SyncConflictTests ../shared/cases/sync-conflict-cases.json
