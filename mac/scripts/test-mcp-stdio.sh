#!/bin/bash
# #389: Claude Code's way into 종이냥 for Claude on a Mac — `PaperTodo --mcp-stdio` runs the bundled server in
# JavaScriptCore (MCPStdio.swift), with no Node.js. Runs the extension's whole test suite (windows/mcp/test) against
# a debug build of the app instead of Node: PAPERTODO_MCP_HOST is the app, handed the server's test build (the one that
# reads PAPERTODO_AI_HOME, #174), so every run uses temporary folders and fictional data only. Nothing of the app
# starts (no window, no Dock icon); the installed app, its data and the real Claude are never touched.
# Node runs only the test runner and the MCP client here, as Claude Code would be the client.
#
#   scripts/test-mcp-stdio.sh [--no-build]
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
windows="$repo/../windows"
scratch="$repo/.build/mcp-stdio"
if [ "${1:-}" != "--no-build" ]; then
    (cd "$repo" && swift build -Xswiftc -warnings-as-errors --scratch-path "$scratch" 2>&1 | tail -1)
    [ -d "$windows/node_modules" ] || { echo "Run npm ci in windows/ first." >&2; exit 1; }
    (cd "$windows" && node mcp/build.mjs --tests >/dev/null)
fi
app="$(cd "$repo" && swift build --scratch-path "$scratch" --show-bin-path)/PaperTodo"

# Without the switch it would load the app's own copy (Contents/Resources/mcp): a debug build outside a bundle has none.
unset PAPERTODO_MCP_SERVER
if out="$("$app" --mcp-stdio </dev/null 2>&1)"; then echo "FAIL: started without a server" >&2; exit 1; fi
grep -q "^jongi-nyang: the extension isn't inside the app" <<<"$out" || { echo "FAIL: $out" >&2; exit 1; }

cd "$windows"
PAPERTODO_MCP_HOST="$app" TZ=Asia/Seoul node --test out-test-mcp/
