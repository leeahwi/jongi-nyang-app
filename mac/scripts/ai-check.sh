#!/bin/bash
# 종이냥 for Claude, end to end (1.42): builds a separate debug test copy (bundle id com.noa.PaperTodo.LiveTest,
# never dist/) with the extension's program inside (../windows/mcp/dist), turns AI 연결 on in its own
# settings folder, runs it, and talks to the bundled server with the MCP SDK the way Claude does (ai-check.mjs,
# PAPERTODO_AI_HOME = the test copy's settings folder). Checks: added tasks show in the running app within ~2 s with
# the toast; ⌘Z undoes them (logged); preview → apply changes a time; the away notice after adding while it's
# closed (M15); turned off, the tools only say "turn it on"; 연결 opens the .mcpb and tells Claude Code (both
# recorded, never really done: nothing is installed into Claude); no Claude Desktop → the slip. The installed app,
# its data and the real Claude are never touched; the copy is stopped by its pid and everything it wrote is removed.
#
#   scripts/ai-check.sh [out-folder] [--no-build]
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$repo/.build/ai-check}"
case "$out" in --*) out="$repo/.build/ai-check";; esac
build=1
for arg in "$@"; do [ "$arg" = "--no-build" ] && build=0; done
bundle_id=com.noa.PaperTodo.LiveTest
mcp_dist="${PAPERTODO_MCP_DIST:-$repo/../windows/mcp/dist}"
sdk="${PAPERTODO_MCP_SDK:-$repo/../windows/node_modules/@modelcontextprotocol/sdk}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
app="$out/AICheck.app"
probe="$out/perf-probe"
check="$out/ai-check.log"
opened="$out/ai-open.log"
coded="$out/ai-code.log"
storage="$HOME/Library/Application Support/$bundle_id"
server="$app/Contents/Resources/mcp/server/index.js"

if [ "$build" = 1 ]; then
    cd "$repo"
    swift build -Xswiftc -warnings-as-errors --scratch-path "$out/build" 2>&1 | tail -1
    bin="$(swift build --scratch-path "$out/build" --show-bin-path)"
    rm -rf "$app"; mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/mcp/server"
    cp "$bin/PaperTodo" "$app/Contents/MacOS/PaperTodo"
    cp Resources/Info.plist "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleName AICheck" "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName AICheck" "$app/Contents/Info.plist"
    /usr/libexec/PlistBuddy -c "Delete :LSHasLocalizedDisplayName" "$app/Contents/Info.plist" || true
    cp -R Sources/PaperTodo/Assets "$app/Contents/Resources/"
    cp -R Resources/*.lproj "$app/Contents/Resources/"
    rm -f "$app"/Contents/Resources/*.lproj/InfoPlist.strings
    cp "$mcp_dist/server/index.js" "$server"
    cp "$mcp_dist/jongi-nyang.mcpb" "$app/Contents/Resources/mcp/jongi-nyang.mcpb"
    [ -d "$bin/PaperTodo_PaperTodo.bundle" ] && cp -R "$bin/PaperTodo_PaperTodo.bundle" "$app/Contents/Resources/" || true
    codesign --force --deep --sign - "$app" 2>/dev/null
    swiftc -O "$repo/scripts/perf-probe.swift" -o "$probe" 2>&1 | grep -v warning || true
fi

pid=""
stop() {
    if [ -n "$pid" ]; then
        kill "$pid" 2>/dev/null || true
        for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    fi
    pid=""
}
cleanup() {
    stop
    rm -rf "$storage" "$HOME/Library/Saved Application State/$bundle_id.savedState" \
        "$HOME/Library/Caches/$bundle_id" "$HOME/Library/HTTPStorages/$bundle_id"
    defaults delete "$bundle_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT

rm -rf "$storage"; mkdir -p "$storage"
python3 -I - "$storage" <<'PY'
import json, os, sys, uuid
from datetime import datetime, timezone
folder = sys.argv[1]
utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
items = [{"id": str(uuid.uuid4()).upper(), "title": "원래 있던 일", "isCompleted": False, "createdAt": utc}]
json.dump({"items": items}, open(os.path.join(folder, "todos.json"), "w"), ensure_ascii=False)
json.dump({"events": []}, open(os.path.join(folder, "events.json"), "w"))
PY
defaults delete "$bundle_id" >/dev/null 2>&1 || true
for key in quickEntry.enabled quickMemo.enabled noteHotKey.enabled pet.visible sweep.enabled chatter.enabled reminder.enabled; do
    defaults write "$bundle_id" "$key" -bool false
done
defaults write "$bundle_id" guide.seen -bool true
defaults write "$bundle_id" login.asked -bool true
defaults write "$bundle_id" systemNotices off
defaults write "$bundle_id" AppleLanguages -array ko
defaults write "$bundle_id" ai.enabled -bool true

launch() {
    open -n "$app" --args --ai-check-log "$check" --ai-open-log "$opened" --ai-code-log "$coded" "$@"
    for _ in $(seq 1 100); do pid=$(pgrep -f "$app/Contents/MacOS/PaperTodo" | head -1 || true); [ -n "$pid" ] && break; sleep 0.05; done
    for _ in $(seq 1 100); do [ -f "$storage/ai-link.json" ] && break; sleep 0.1; done
    sleep 1.5
}
call() { node "$repo/scripts/ai-check.mjs" "$sdk" "$server" "$storage" "$@"; }
field() { python3 -I -c "import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2], {}, {'d': d}))" "$1" "$2"; }
# wait_line <word> <after ms>: the first check-log line with that word written after the time; prints it.
wait_line() {
    for _ in $(seq 1 100); do
        local line
        line=$(awk -v w="$2" -v t="$1" '$1 >= t && $2 == w' "$check" 2>/dev/null | head -1)
        [ -n "$line" ] && { echo "$line"; return 0; }
        sleep 0.1
    done
    echo "TIMEOUT waiting for $2 after $1: $(tr "\n" "|" < "$check")"; return 1
}
fail() { echo "FAIL: $*"; exit 1; }
: > "$check"; : > "$opened"
today=$(python3 -I -c "from datetime import datetime, timedelta; print((datetime.now() - timedelta(hours=4)).strftime('%Y-%m-%d'))")
echo "== 종이냥 for Claude end to end · $(date '+%Y-%m-%d %H:%M') · node $(node --version)"

launch
link=$(cat "$storage/ai-link.json")
echo "ai-link.json: $(echo "$link" | tr -d '\n ' )"
[ "$(field "$link" "d['enabled']")" = "True" ] || fail "ai-link.json not enabled"

# 1. Two tasks: in the app within ~2 s, with the toast.
result=$(call add_todos '{"items":[{"title":"보고서 쓰기","timeStart":"15:00","timeEnd":"16:00","remindAt":null},{"title":"장보기","remindAt":null}]}')
added_at=$(field "$result" "d['at']")
echo "add_todos: $(field "$result" "d['ms']") ms · $(field "$result" "d['text']" | head -1)"
line=$(wait_line "$added_at" toast) || fail "no toast: $line"
echo "  app toast, from the call $(( $(echo "$line" | awk '{print $1}') - added_at )) ms: ${line#* toast }"
grep -q '"보고서 쓰기"' "$storage/todos.json" || fail "not in todos.json"

# 2. ⌘Z in the app undoes Claude's work (the toast is up, nothing changed here since).
"$probe" front "$pid"; sleep 0.5
mark=$(python3 -I -c "import time; print(int(time.time()*1000))")
"$probe" key "$pid" 6 cmd
line=$(wait_line "$mark" undo) || fail "no undo"
echo "  ⌘Z: ${line#* undo }"
sleep 0.3
grep -q '보고서 쓰기' "$storage/todos.json" && fail "still in todos.json after undo"
tail -1 "$storage/ai-log.jsonl" | grep -q '"kind":"undo"' || fail "undo not logged"
echo "  todos.json without them, ai-log.jsonl: $(wc -l < "$storage/ai-log.jsonl" | tr -d ' ') lines, last $(tail -1 "$storage/ai-log.jsonl" | python3 -I -c 'import json,sys; d=json.loads(sys.stdin.read()); print(d["kind"], d["client"], "undoes", d["undoes"][:8], "count", d["count"])')"

# 3. Preview → apply a time change.
result=$(call add_todos '{"items":[{"title":"치과 예약 전화","remindAt":null}]}')
id=$(field "$result" "d['data']['added'][0]['id'] if d['data'].get('added') else d['data']['items'][0]['id']" 2>/dev/null || true)
[ -n "$id" ] || { echo "$result"; fail "no id from add_todos"; }
wait_line "$(field "$result" "d['at']")" toast >/dev/null || fail "no toast for the third task"
result=$(call "preview+apply" "{\"changes\":[{\"kind\":\"todo\",\"id\":\"$id\",\"set\":{\"timeStart\":\"17:00\",\"timeEnd\":\"17:30\"}}]}")
echo "preview_changes: $(field "$result" "d['preview']['ms']") ms · token $(field "$result" "d['preview']['data']['token']")"
line=$(wait_line "$(field "$result" "d['at']")" toast) || { echo "$result"; tail -2 "$storage/ai-log.jsonl"; fail "no toast for the change"; }
echo "apply_changes: $(field "$result" "d['ms']") ms · app toast, from the call $(( $(echo "$line" | awk '{print $1}') - $(field "$result" "d['at']") )) ms: ${line#* toast }"
python3 -I -c "import json,sys; items=json.load(open(sys.argv[1]))['items']; sys.exit(0 if any(i.get('timeStart')=='17:00' and i.get('timeEnd')=='17:30' for i in items) else 1)" "$storage/todos.json" || fail "time not changed"

# 3b. Both writing at once (M9 from the app's side): the app adds 20 tasks from its input line while the extension
# adds 20 in separate calls; all 40 must be in todos.json.
"$probe" front "$pid"; sleep 0.3
"$probe" key "$pid" 53; sleep 0.2
"$probe" key "$pid" 45 cmd; sleep 0.5
( for n in $(seq 1 20); do call add_todos "{\"items\":[{\"title\":\"claude-$n\",\"remindAt\":null}]}" >/dev/null; done ) &
writer=$!
for n in $(seq 1 20); do "$probe" type "$pid" "app-$n" 8; "$probe" key "$pid" 36; sleep 0.15; done
wait "$writer"
sleep 2.5
# What the app saved (its check log) against what the file has: a title the app saved that the file lacks is a lost
# write; one the app never saved is a key the test copy didn't get (not a write).
counts=$(python3 -I - "$storage/todos.json" "$check" <<'PY'
import json, sys
final = {i["title"] for i in json.load(open(sys.argv[1]))["items"]}
saved = set()
for line in open(sys.argv[2], encoding="utf-8"):
    parts = line.rstrip("\n").split(" ", 3)
    if len(parts) == 4 and parts[1] == "save":
        saved |= set(parts[3].split("|"))
app_saved = {t for t in saved if t.startswith("app-")}
print(len(app_saved), len(app_saved - final), sum(t.startswith("claude-") for t in final))
PY
)
read -r typed lost claude <<< "$counts"
echo "both writing: the app added $typed (from typed keys) and Claude 20 at the same time · in todos.json: Claude $claude/20, the app's lost $lost"
[ "$lost" = 0 ] && [ "$claude" = 20 ] && [ "$typed" -ge 15 ] || fail "lost a write"
"$probe" key "$pid" 53; sleep 0.3

# 4. 연결: the .mcpb is opened with its default app (recorded only — nothing is installed into Claude).
"$probe" key "$pid" 43 cmd; sleep 1
"$probe" press "$pid" "AI 연결" >/dev/null 2>&1 || true; sleep 0.8
"$probe" press "$pid" "Claude 데스크톱에 연결" >/dev/null 2>&1 || true; sleep 0.8
echo "연결 (stubbed opener): $(tr '\n' ' ' < "$opened")"
grep -q "open .*jongi-nyang.mcpb" "$opened" || fail "the .mcpb wasn't opened"
sleep 0.5
echo "Claude Code too (stubbed claude): $(cut -c1-90 "$coded" | tr '\n' ' ')"
grep -q "^/stub/claude mcp remove -s user jongi-nyang$" "$coded" || fail "no earlier entry taken out"
grep -q "^/stub/claude mcp add-json -s user jongi-nyang {.*\"command\":\"/stub/node\".*index.js" "$coded" || fail "Claude Code wasn't told"

# 5. Away (M15): closed, Claude adds one; at launch one notice.
stop
call add_todos '{"items":[{"title":"자리 비운 사이 넣은 일","remindAt":null}]}' >/dev/null
mark=$(python3 -I -c "import time; print(int(time.time()*1000))")
launch
line=$(wait_line "$mark" away) || fail "no away notice"
echo "away notice: ${line#* away }"

# 6. No Claude Desktop: the slip (닫기 closes it).
stop; : > "$opened"
launch --ai-no-handler
"$probe" key "$pid" 43 cmd; sleep 1
"$probe" press "$pid" "AI 연결" >/dev/null 2>&1 || true; sleep 0.8
"$probe" press "$pid" "Claude 데스크톱에 연결" >/dev/null 2>&1 &
sleep 1.5
slip=$("$probe" windows "$pid" 2>/dev/null | grep -c "Claude 데스크톱이 필요해요" || true)
echo "no Claude Desktop: $(tr '\n' ' ' < "$opened")· slip windows $slip"
"$probe" press "$pid" "닫기" >/dev/null 2>&1 || true
sleep 0.5

# 7. Off: every tool only says "turn it on".
stop
defaults write "$bundle_id" ai.enabled -bool false
launch
result=$(call get_today '{}')
echo "turned off: ai-link enabled=$(field "$(cat "$storage/ai-link.json")" "d['enabled']") · get_today: $(field "$result" "d['text']")"
[ "$(field "$result" "d['data']['enabled']")" = "False" ] || fail "tools still work when off"
echo "PASS"
