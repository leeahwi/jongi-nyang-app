#!/bin/bash
# The Windows release build (#400): `npm ci` and the whole `npm run dist` (typecheck, npm test, mcp:test, the
# production build, Koffi, electron-builder, the path check, the checksums) under the Node major in .node-version,
# whatever node is installed. Electron's zips are kept in ~/Library/Caches/jongi-nyang/electron, not a temp folder.
#
#   windows/tools/dist.sh            # npm ci, then npm run dist
#   windows/tools/dist.sh --check    # print what would run, with the Node it runs on; builds nothing
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

major="$(tr -d '[:space:]' < .node-version)"
export ELECTRON_CACHE="${ELECTRON_CACHE:-$HOME/Library/Caches/jongi-nyang/electron}"
mkdir -p "$ELECTRON_CACHE"

# A zip Electron's default cache already has is cloned in (APFS: no extra space), so it isn't downloaded again.
electron="$(node -p 'require("./package-lock.json").packages["node_modules/electron"].version')"
default_cache="$HOME/Library/Caches/electron"
if [ -d "$default_cache" ] && [ "$default_cache" != "$ELECTRON_CACHE" ]; then
    for zip in "$default_cache"/*/electron-v"$electron"-*.zip; do
        [ -f "$zip" ] || continue
        target="$ELECTRON_CACHE/$(basename "$(dirname "$zip")")/$(basename "$zip")"
        [ -f "$target" ] && continue
        mkdir -p "$(dirname "$target")"
        cp -c "$zip" "$target" 2>/dev/null || cp "$zip" "$target"
    done
fi

# Node 22 from npm when the installed node is another major (npx puts its node first on PATH, so npm and every
# script inside `npm run dist` run on it).
if [ "$(node -p 'process.versions.node.split(".")[0]')" = "$major" ]; then
    on_node() { "$@"; }
else
    on_node() { npx --yes -p "node@$major" -- "$@"; }
fi

echo "dist.sh: Node $(on_node node --version), Electron $electron, ELECTRON_CACHE=$ELECTRON_CACHE"
if [ "${1:-}" = "--check" ]; then
    echo "dist.sh: would run npm ci, then: $(node -p 'require("./package.json").scripts.dist')"
    ls "$ELECTRON_CACHE"/*/electron-v"$electron"-win32-x64.zip 2>/dev/null || echo "dist.sh: electron-v$electron-win32-x64.zip is not cached yet (electron-builder downloads it)"
    exit 0
fi
on_node npm ci
on_node npm run dist
