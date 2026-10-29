#!/usr/bin/env python3
"""Writes the performance check's demo data set into a storage folder (scripts/perf.sh):
about 150 open to-dos across 오늘 · 앞으로 · 언젠가, 60 events (some repeating), 2,000 lines in
the record, 80 memos, 5 alarms, 300 focus sessions and a few repeating to-dos.
Usage: perf-data.py <folder> [--ranges] [--memos N] [--todos N] [--spaces N] [--history N] [--history-days D] [--events N]
(perf audit 2: --history 6000 --history-days 1095 spreads that many record lines over three years; --events 200 writes
that many events, every fifth repeating; the defaults are unchanged)   (--ranges also gives some to-dos a time
range; --todos 2000 adds undated to-dos on 오늘 up to that many in all; --spaces 9 writes todo-spaces.json with that many
spaces, each to-do in one of them round the list, every tenth in none — 1.45, 할 일 스페이스)"""
import json, os, random, sys, uuid
from datetime import datetime, timedelta, timezone

folder = sys.argv[1]
ranges = "--ranges" in sys.argv
random.seed(7)
os.makedirs(os.path.join(folder, "archive"), exist_ok=True)
now = datetime.now().astimezone()
day = (now - timedelta(hours=4)).replace(hour=0, minute=0, second=0, microsecond=0)
utc = lambda d: d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
key = lambda d: d.strftime("%Y-%m-%d")
words = ["보고서", "회의 준비", "메일 답장", "장보기", "운동", "책 읽기", "세금 정리", "청소", "빨래", "디자인 검토",
         "코드 리뷰", "엄마께 전화", "치과 예약", "발표 자료", "계획 세우기", "사진 정리", "물 마시기", "산책", "영수증 정리", "공부"]
title = lambda i: f"{random.choice(words)} {i}"

items = []
def task(i, **extra):
    created = now - timedelta(days=random.randint(0, 20), minutes=random.randint(0, 600))
    item = {"id": str(uuid.uuid4()).upper(), "title": title(i), "isCompleted": False, "createdAt": utc(created)}
    item.update(extra)
    items.append(item)
    return item

i = 0
for n in range(45):  # 오늘, no date
    i += 1; t = task(i, todaySince=key(day))
    if n % 6 == 0:
        at = day + timedelta(hours=random.randint(9, 22), minutes=random.choice([0, 15, 30, 45]))
        t["reminderAt"] = utc(at)
        # Reminders already past were shown: no pop-up waits at launch.
        if at <= now: t["reminderLastDeliveredAt"] = utc(at)
    if ranges and n % 9 == 1:
        h = random.randint(9, 19); t["timeStart"] = f"{h:02d}:00"; t["timeEnd"] = f"{h + 1:02d}:30"
for n in range(10):  # due today or overdue
    i += 1; task(i, dueDate=key(day - timedelta(days=random.randint(0, 3))))
for n in range(55):  # 앞으로: dated
    i += 1; task(i, dueDate=key(day + timedelta(days=random.randint(1, 60))))
for n in range(40):  # 언젠가
    i += 1; task(i, shelf="later")
for n in range(15):  # done today
    i += 1; t = task(i); t["isCompleted"] = True; t["completedAt"] = utc(now - timedelta(minutes=random.randint(1, 200)))
total = int(sys.argv[sys.argv.index("--todos") + 1]) if "--todos" in sys.argv else 0
while len(items) < total:  # 1.45: a big 오늘 (the worst case for drawing and filtering it)
    i += 1; t = task(i, todaySince=key(day))
    if i % 7 == 0: t["isCompleted"] = True; t["completedAt"] = utc(now - timedelta(minutes=random.randint(1, 200)))
json.dump({"items": items}, open(os.path.join(folder, "todos.json"), "w"), ensure_ascii=False, indent=2, sort_keys=True)

space_count = int(sys.argv[sys.argv.index("--spaces") + 1]) if "--spaces" in sys.argv else 0
if space_count:
    names = ["회사", "집", "공부", "운동", "가족", "취미", "독서", "여행", "정리", "기타"]
    palette = ["lavender", "pink", "mint", "yellow", "sky", "peach", "sand", "gray"]
    spaces = [{"color": palette[n % 8], "id": f"s-{n:06x}", "name": names[n % len(names)], "order": n, "updatedAt": utc(now)} for n in range(space_count)]
    places = {item["id"]: {"at": utc(now), "space": spaces[n % space_count]["id"]} for n, item in enumerate(items) if n % 10}
    json.dump({"items": places, "spaces": spaces, "version": 1}, open(os.path.join(folder, "todo-spaces.json"), "w"),
              ensure_ascii=False, indent=2, sort_keys=True)

colors = ["blue", "sage", "coral", "purple", "yellow", "gray"]
events = []
arg = lambda name, fallback: int(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else fallback
event_count = arg("--events", 60)
for n in range(event_count):
    first = day + timedelta(days=random.randint(-20, 30)) if n >= 6 else day
    start = random.choice(range(8 * 60, 21 * 60, 30))
    rule = ["daily", "weekly", "monthly"][n % 3] if n % 5 == 0 else "none"
    events.append({"id": str(uuid.uuid4()), "title": f"일정 {n}", "date": key(first), "allDay": n % 13 == 0, "days": 1,
                   "start": start, "end": start + random.choice([30, 60, 90]), "repeat": rule, "skip": [],
                   "color": colors[n % 6], "createdAt": utc(now), "updatedAt": utc(now)})
json.dump({"events": events}, open(os.path.join(folder, "events.json"), "w"), ensure_ascii=False, indent=2)

by_month = {}
history_lines, history_days = arg("--history", 2000), arg("--history-days", 300)
for n in range(history_lines):
    done = now - timedelta(days=random.randint(1, history_days), minutes=random.randint(0, 900))
    entry = {"id": str(uuid.uuid4()).upper(), "title": title(n), "createdAt": utc(done - timedelta(days=2)), "completedAt": utc(done)}
    by_month.setdefault(done.strftime("%Y-%m"), []).append(entry)
for month, entries in by_month.items():
    with open(os.path.join(folder, "archive", f"{month}.jsonl"), "w") as f:
        for e in sorted(entries, key=lambda e: e["completedAt"]):
            f.write(json.dumps(e, ensure_ascii=False, sort_keys=True) + "\n")

# `--memos 200` (메모 서랍's 200-memo case); 80 by default. Every fifth is a checklist (the drawer draws its bar).
memo_count = int(sys.argv[sys.argv.index("--memos") + 1]) if "--memos" in sys.argv else 80
memos = []
for n in range(memo_count):
    at = now - timedelta(hours=n * 7)
    box = "- [ ] " if n % 5 == 0 else "- "
    memos.append({"id": str(uuid.uuid4()), "text": f"메모 {n}\n" + "\n".join(f"{box}{random.choice(words)}" for _ in range(random.randint(1, 8))),
                  "createdAt": utc(at), "updatedAt": utc(at)})
json.dump({"memos": memos}, open(os.path.join(folder, "memos.json"), "w"), ensure_ascii=False, indent=2, sort_keys=True)

alarms = [{"id": str(uuid.uuid4()), "time": t, "label": l, "days": d, "enabled": e, "sound": "bell", "snooze": 10,
           "createdAt": utc(now), "updatedAt": utc(now)}
          for t, l, d, e in [("07:00", "기상", [1, 2, 3, 4, 5], True), ("12:30", "점심", [], False), ("06:30", "운동", [0, 6], True),
                             ("22:30", "잘 준비", [0, 1, 2, 3, 4, 5, 6], True), ("05:10", "", [3], False)]]
json.dump({"alarms": alarms}, open(os.path.join(folder, "alarms.json"), "w"), ensure_ascii=False, indent=2)

with open(os.path.join(folder, "focus.jsonl"), "w") as f:
    for n in range(300):
        start = now - timedelta(days=random.randint(0, 90), minutes=random.randint(0, 600))
        minutes = random.choice([15, 25, 25, 40, 50])
        line = {"id": str(uuid.uuid4()), "title": title(n), "start": utc(start), "end": utc(start + timedelta(minutes=minutes)),
                "minutes": minutes, "kind": "focus" if n % 4 else "timer", "done": n % 3 == 0}
        if n % 4: line["taskId"] = str(uuid.uuid4()).upper()
        else: line["title"] = ""
        f.write(json.dumps(line, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")

series = [{"id": str(uuid.uuid4()), "title": t, "rule": r, "remindAt": a, "createdAt": utc(now - timedelta(days=10))}
          for t, r, a in [("물 마시기", {"kind": "daily"}, "10:00"), ("주간 회고", {"kind": "weekly", "weekdays": [5]}, None)]]
json.dump({"series": series}, open(os.path.join(folder, "repeats.json"), "w"), ensure_ascii=False, indent=2)
print(f"demo data: {len(items)} to-dos ({sum(not x['isCompleted'] for x in items)} open), {len(events)} events, {history_lines} record lines, "
      f"{len(memos)} memos, {len(alarms)} alarms, 300 focus lines → {folder}")
