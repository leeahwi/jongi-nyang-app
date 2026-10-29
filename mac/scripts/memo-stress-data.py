#!/usr/bin/env python3
"""메모 서랍 stress data (docs/perf-memo-stress.md): writes memos.json and memo-folders.json into a folder.
Same recipe as the Windows app's tools/memo-stress-data.mjs (the same seed gives the same shapes, not the same bytes).

    memo-stress-data.py <folder> [--memos N] [--long KB,KB,…] [--checklist LINES] [--folders N] [--inbox-share 0.6] [--marker]

- N memos with mixed lengths: 60 % short (1–3 lines), 30 % medium (5–20 lines), 9 % long (2–5 KB), 1 % checklists;
  some carry a link or a phone number. Times spread over two years, so every date group shows up.
- --long 10,100,1024: one memo of about that many KB each ("긴 메모 100KB"), the newest, in the inbox.
- --checklist 2000: one memo of that many "- [ ] " lines ("체크 목록 2000줄"), the newest after the long ones.
- --marker: a short memo "맨 위 메모" on top of everything (the UI check starts from it).
- --folders 30: the inbox plus 29 folders; --inbox-share of the memos sit in the inbox (the drawer opens there).
Only writes into <folder>; prints a one-line summary."""
import json, os, random, sys, uuid
from datetime import datetime, timedelta, timezone


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


folder = sys.argv[1]
count = int(arg("--memos", "500"))
longs = [int(x) for x in arg("--long", "").split(",") if x]
checklist = int(arg("--checklist", "0"))
folder_count = int(arg("--folders", "30"))
inbox_share = float(arg("--inbox-share", "0.6"))
random.seed(11)
os.makedirs(folder, exist_ok=True)
now = datetime.now(timezone.utc).replace(microsecond=0)
iso = lambda d: d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

words = ["보고서", "회의", "준비", "메일", "답장", "장보기", "운동", "책", "정리", "디자인", "검토", "코드", "리뷰", "발표", "자료",
         "계획", "사진", "영수증", "공부", "여행", "예약", "견적", "계약서", "일정", "아이디어", "고객", "피드백", "배포", "테스트", "문서"]
latin = ["deploy", "release", "notes", "draft", "budget", "invoice", "meeting", "sprint", "design", "review"]
sentence = lambda n: " ".join(random.choice(words) if random.random() < 0.85 else random.choice(latin) for _ in range(n))
links = ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://github.com/leeahwi/jongi-nyang-app", "https://docs.google.com/document/d/abc"]


def body(kind):
    if kind == "short":
        lines = [sentence(random.randint(2, 6)) for _ in range(random.randint(1, 3))]
    elif kind == "medium":
        lines = [sentence(random.randint(3, 10)) for _ in range(random.randint(5, 20))]
    elif kind == "long":
        target = random.randint(2, 5) * 1024
        lines, size = [], 0
        while size < target:
            line = sentence(random.randint(6, 14))
            lines.append(line)
            size += len(line.encode()) + 1
    else:  # checklist
        lines = [sentence(3)] + [f"- [{'x' if random.random() < 0.3 else ' '}] {sentence(random.randint(2, 5))}" for _ in range(random.randint(4, 12))]
    if random.random() < 0.06:
        lines.append(random.choice(links))
    if random.random() < 0.03:
        lines.append(f"010-{random.randint(1000, 9999)}-{random.randint(1000, 9999)}")
    return "\n".join(lines)


def sized(kb, title):
    lines, size = [title], len(title.encode())
    while size < kb * 1024:
        line = sentence(random.randint(8, 16))
        lines.append(line)
        size += len(line.encode()) + 1
    return "\n".join(lines)


memos = []
for n in range(count):
    roll = random.random()
    kind = "short" if roll < 0.6 else "medium" if roll < 0.9 else "long" if roll < 0.99 else "checklist"
    updated = now - timedelta(minutes=random.randint(30, 2 * 365 * 24 * 60))
    created = updated - timedelta(minutes=random.randint(0, 60 * 24 * 30))
    memos.append({"id": str(uuid.UUID(int=random.getrandbits(128))).upper(), "text": body(kind), "createdAt": iso(created), "updatedAt": iso(updated)})

special = []
for index, kb in enumerate(longs):
    at = now - timedelta(minutes=1 + index)
    special.append({"id": f"STRESS-LONG-{kb}K", "text": sized(kb, f"긴 메모 {kb}KB"), "createdAt": iso(at), "updatedAt": iso(at)})
if checklist:
    at = now - timedelta(minutes=1 + len(longs))
    lines = [f"체크 목록 {checklist}줄"] + [f"- [{'x' if n % 4 == 0 else ' '}] {n + 1}. {sentence(3)}" for n in range(checklist)]
    special.append({"id": f"STRESS-CHECK-{checklist}", "text": "\n".join(lines), "createdAt": iso(at), "updatedAt": iso(at)})
if "--marker" in sys.argv:
    special.insert(0, {"id": "STRESS-TOP", "text": "맨 위 메모\n여기에 적어 봐요", "createdAt": iso(now), "updatedAt": iso(now)})
memos = special + sorted(memos, key=lambda m: m["updatedAt"], reverse=True)
json.dump({"memos": memos}, open(os.path.join(folder, "memos.json"), "w"), ensure_ascii=False, indent=2, sort_keys=True)

colors = ["lavender", "pink", "mint", "yellow", "sky", "peach", "sand", "gray"]
folders = [{"id": "inbox", "name": "메모", "color": "lavender", "order": 0, "updatedAt": iso(now)}]
for n in range(1, folder_count):
    folders.append({"id": f"F{n:02d}", "name": f"{random.choice(words)} {n}", "color": colors[n % 8], "order": n, "updatedAt": iso(now)})
placement = {}
pins = 0
for index, memo in enumerate(memos):
    special_one = memo["id"].startswith("STRESS-")
    home = "inbox" if special_one or random.random() < inbox_share or len(folders) == 1 else random.choice(folders[1:])["id"]
    # A few pinned (at most 6): a long 고정 group would push the top memo the UI check starts from out of view.
    pinned = (not special_one) and index % 97 == 5 and pins < 6
    pins += pinned
    placement[memo["id"]] = {"folder": home, "pinned": pinned, "at": memo["updatedAt"]}
with open(os.path.join(folder, "memo-folders.json"), "w") as f:
    json.dump({"v": 1, "folders": folders, "placement": placement, "updatedAt": iso(now)}, f, ensure_ascii=False, indent=2)

size = os.path.getsize(os.path.join(folder, "memos.json"))
inbox = sum(1 for p in placement.values() if p["folder"] == "inbox")
print(f"memo stress: {len(memos)} memos ({inbox} in the inbox), {len(folders)} folders, memos.json {size / 1024:.0f} KB → {folder}")
