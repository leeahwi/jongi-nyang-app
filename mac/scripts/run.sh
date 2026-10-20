#!/bin/bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
"$task_root/scripts/build.sh"
open "$task_root/dist/종이냥.app"

