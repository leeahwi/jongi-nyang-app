#!/bin/bash
# 종이냥 for Claude (AIConnect.swift, Notebook.adopt): the log, texts, undo, the away notice, marks — the app's
# side of the shared cases M13–M15 (the shared AI connection spec, docs/ai-connect-plan.md).
set -euo pipefail
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
mkdir -p .build/checks
swiftc -warnings-as-errors -parse-as-library \
    Sources/PaperCore/AppLanguage.swift \
    Sources/PaperCore/TodoItem.swift \
    Sources/PaperCore/TimeBlock.swift \
    Sources/PaperCore/Notebook.swift \
    Sources/PaperCore/Carry.swift \
    Sources/PaperCore/Archive.swift \
    Sources/PaperCore/Deadline.swift \
    Sources/PaperCore/Shelf.swift \
    Sources/PaperCore/Repeat.swift \
    Sources/PaperCore/AIConnect.swift \
    Tests/PaperCoreTests/AIConnectTests.swift \
    -o .build/checks/AIConnectTests
.build/checks/AIConnectTests ../shared/cases/spaces-cases.json

# #389: the Claude Code row says the same in both apps — the button, its line, Claude Desktop's line — in ko · en · nl,
# and nothing on the Mac asks for Node any more.
python3 -I - Sources/PaperTodo/AISettingsView.swift ../windows/src/renderer/settings.ts Resources ../windows/src/i18n <<'PY'
import re, sys
mac_view, win_view, mac_res, win_i18n = sys.argv[1:]
shared = ["Claude 데스크톱에 연결", "누르면 Claude가 ‘종이냥 for Claude’를 설치할지 물어봐요.", "Claude Code 명령 복사", "복사했어요",
          "복사한 명령을 터미널에 붙여 넣어요. Node.js는 없어도 돼요."]
views = [open(mac_view).read(), open(win_view).read()]
for text in shared:
    assert all(f'"{text}"' in view for view in views), f"not in both settings panes: {text}"
for lang in ("en", "nl"):
    mac = dict(re.findall(r'^"((?:[^"\\]|\\.)*)" = "((?:[^"\\]|\\.)*)";$', open(f"{mac_res}/{lang}.lproj/Localizable.strings").read(), re.M))
    win = dict(re.findall(r'^  "((?:[^"\\]|\\.)*)": "((?:[^"\\]|\\.)*)",$', open(f"{win_i18n}/{lang}.ts").read(), re.M))
    for text in shared:
        assert mac.get(text) == win.get(text), f"{lang} differs for {text}: {mac.get(text)!r} / {win.get(text)!r}"
    assert not any("Node가 필요해요" in key or "Node.js가 필요해요" in key for key in mac), "a Node line is left"
assert "Node" not in views[0].replace("Node.js는 없어도 돼요", ""), "the Mac pane still mentions Node"
print(f"PASS Claude Code row: {len(shared)} texts the same in both apps (ko · en · nl)")
PY

# #441: the help's 켜고 연결하기 — the user-scope command and its remove line — is the same text in both apps, ko · en · nl.
python3 -I - Sources/PaperTodo/HelpView.swift ../windows/src/renderer/help.ts Resources ../windows/src/i18n <<'PY'
import re, sys
mac_help, win_help, mac_res, win_i18n = sys.argv[1:]
start = "책상 → AI 연결에서 켜고"
find = lambda text: re.search(r'"(' + re.escape(start) + r'(?:[^"\\]|\\.)*)"', text).group(1)
key = find(open(mac_help).read())
assert find(open(win_help).read()) == key, "the Windows help's 켜고 연결하기 differs from the Mac's"
assert "claude mcp remove -s user jongi-nyang" in key, "the remove line isn't the user scope's"
for lang in ("en", "nl"):
    mac = dict(re.findall(r'^"((?:[^"\\]|\\.)*)" = "((?:[^"\\]|\\.)*)";$', open(f"{mac_res}/{lang}.lproj/Localizable.strings").read(), re.M))
    win = dict(re.findall(r'^  "((?:[^"\\]|\\.)*)": "((?:[^"\\]|\\.)*)",$', open(f"{win_i18n}/{lang}.ts").read(), re.M))
    assert mac.get(key) and mac.get(key) == win.get(key), f"{lang}: the help's 켜고 연결하기 differs"
    assert "remove -s user jongi-nyang" in mac[key], f"{lang}: the remove line isn't the user scope's"
print("PASS help 켜고 연결하기: the same in both apps (ko · en · nl), with claude mcp remove -s user")
PY
