#!/bin/bash
# 메모 서랍 under load, as a check: 2,000 memos, a 100 KB memo and a 2,000-line checklist; fails when a core step is
# far over its ceiling (see MemoStressBench.swift). The numbers themselves: scripts/bench-memo-stress.sh.
set -euo pipefail
exec "$(cd "$(dirname "$0")" && pwd)/bench-memo-stress.sh" check
