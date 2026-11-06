#!/bin/bash
# For a person: builds dist/종이냥.app and opens it in front, on the screen, on purpose. Not a check (#217).
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
"$task_root/scripts/build.sh"
open "$task_root/dist/종이냥.app"

