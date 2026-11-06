#!/usr/bin/env python3
"""Reads the replay log of scripts/drag-check.sh (one JSON line a tick) and checks that the dragged block followed the
pointer: per tick, the block's edge minus the pointer stays where it was grabbed (within 1 pt), the block never moves
against the pointer, and no tick jumps more than 2 pt beyond the pointer's own move; held past the bottom to the day's
end, the block and the scrolling stop at 24:00 (#243). Prints a line per scenario and
writes every tick to <log>.ticks.csv. Exit 1 when a check fails.
Usage: drag-check.py <log.jsonl>"""
import json, sys

path = sys.argv[1]
lines = [json.loads(l) for l in open(path) if l.strip()]
for l in lines:
    if "error" in l:
        print("replay failed:", l["error"]); sys.exit(1)
start = next((l for l in lines if "start" in l), {})
info = next((l for l in lines if "block" in l), None)
done = next((l for l in lines if "done" in l), None)
ticks = [l for l in lines if "scenario" in l]
if not info or not ticks:
    print("no ticks logged"); sys.exit(1)
if "now" in start:
    from datetime import datetime
    clock = datetime.fromtimestamp(start["now"]).strftime("%H:%M")
    print(f"the note's clock {clock} ({'stopped, --timetable-now' if start.get('fixedNow') else 'the real one'})")
print(f"block at start {info['block']} · range {info['range']} · viewport {info.get('viewport')} · NSScrollView found {info.get('scrollView')} · scroll {info.get('scroll')}")

with open(path + ".ticks.csv", "w") as f:
    f.write("scenario,phase,tick,pointer,top,bottom,scroll,grid,dragged,others,ghost,range\n")
    for t in ticks:
        f.write(",".join(str(t[k]) for k in ["scenario", "phase", "tick", "pointer", "top", "bottom", "scroll", "grid", "dragged", "others", "ghost", "range"]) + "\n")

failed = False
def check(name, ok, detail):
    global failed
    print(("PASS " if ok else "FAIL ") + name + " — " + detail)
    failed |= not ok

def follow(scenario, edge, clamp=None):
    rows = [t for t in ticks if t["scenario"] == scenario]
    if not rows:
        return
    down = next(t for t in rows if t["phase"] == "down")
    grab = down[edge] - down["pointer"]
    drags = [t for t in rows if t["phase"] == "drag"]
    errors, reversals, jumps = [], 0, []
    prev = down
    for t in drags:
        # Past the viewport the timetable scrolls: the block stays under the pointer in the window either way.
        errors.append(t[edge] - t["pointer"] - grab)
        dp, de = t["pointer"] - prev["pointer"], t[edge] - prev[edge]
        if dp * de < 0 or (dp == 0 and abs(de) > 0.5):
            reversals += 1
        jumps.append(abs(de - dp))
        prev = t
    worst = max(abs(e) for e in errors)
    check(f"{scenario}: {edge} follows the pointer", worst <= 1 and reversals == 0 and max(jumps) <= 2,
          f"{len(drags)} ticks · max |edge − pointer − grab| {worst:.2f} pt · moves against the pointer {reversals} · "
          f"max jump beyond the pointer {max(jumps):.2f} pt · grid redrawn {drags[-1]['grid'] - down['grid']} · "
          f"dragged block redrawn {drags[-1]['dragged'] - down['dragged']} · other blocks redrawn {drags[-1]['others'] - down['others']}")
    settle = [t for t in rows if t["phase"] == "settle"]
    if settle and edge == "top":
        # The drawn top (animation frames included, sampled every 8 ms): from where the pointer left it into the slot.
        last = drags[-1]["drawn"]
        path = [last] + [t["drawn"] for t in settle]
        moves = [round(b - a, 2) for a, b in zip(path, path[1:]) if abs(b - a) > 0.01]
        monotonic = all(m > 0 for m in moves) or all(m < 0 for m in moves)
        check(f"{scenario}: eases into its slot one way", monotonic,
              f"drawn top {last:.2f} → {path[-1]:.2f} in {len(moves)} steps {moves} · range {down['range']} → {settle[-1]['range']}")

follow("move", "top")
follow("bottom", "bottom")
follow("top", "top")

rows = [t for t in ticks if t["scenario"] == "cancel"]
if rows:
    down = next(t for t in rows if t["phase"] == "down")
    last = rows[-1]
    check("cancel: Esc puts it back unchanged", abs(last["top"] - down["top"]) <= 0.5 and last["range"] == down["range"],
          f"top {down['top']} → {last['top']} · range {down['range']} → {last['range']}")

rows = [t for t in ticks if t["scenario"] == "scroll"]
if rows:
    down = next(t for t in rows if t["phase"] == "down")
    held = [t for t in rows if t["phase"] == "drag"][-24:]
    scrolled = held[-1]["scroll"] - held[0]["scroll"]
    grab = down["top"] - down["pointer"]
    worst = max(abs(t["top"] - t["pointer"] - grab) for t in held)
    content = [t["top"] + t["scroll"] for t in held]
    forward = all(b >= a - 0.01 for a, b in zip(content, content[1:]))
    check("scroll: past the bottom it scrolls and the block keeps following", scrolled > 20 and worst <= 1 and forward,
          f"scrolled {scrolled:.1f} pt over {len(held)} ticks held · block under the pointer within {worst:.2f} pt · "
          f"later in the day each tick: {forward} · after Esc range {rows[-1]['range']}")

# #243: held past the bottom long enough to reach the day's end, the block stops at 24:00 and the scrolling stops with it,
# the day's last hour in view; let go there, it lands at 24:00.
rows = [t for t in ticks if t["scenario"] == "dayend"]
if rows:
    down = next(t for t in rows if t["phase"] == "down")
    drags = [t for t in rows if t["phase"] == "drag"]
    held = drags[-40:]
    viewport = info.get("viewport") or [0, 0, 0, 0]
    bottom = viewport[1] + viewport[3]
    scrolls = [t["scroll"] for t in held]
    stopped = max(scrolls) - min(scrolls) <= 0.01 and scrolls[-1] > down["scroll"] + 20
    still = max(t["bottom"] for t in held) - min(t["bottom"] for t in held) <= 0.5
    in_view = bottom - 40 <= held[-1]["bottom"] <= bottom + 0.5
    landed = rows[-1]["range"].split("-")[-1] == "1440"
    check("dayend: at 24:00 the block and the scrolling stop", stopped and still and in_view and landed,
          f"scroll {down['scroll']:.1f} → {scrolls[-1]:.1f}, the last {len(held)} ticks held: scroll moved {max(scrolls) - min(scrolls):.2f} pt, "
          f"block bottom moved {max(t['bottom'] for t in held) - min(t['bottom'] for t in held):.2f} pt · block bottom {held[-1]['bottom']:.1f} "
          f"(viewport bottom {bottom:.1f}) · range {down['range']} → {rows[-1]['range']}")
else:
    check("dayend: at 24:00 the block and the scrolling stop", False, "no ticks for it")

print("range at the end:", done["range"] if done else "?")
sys.exit(1 if failed else 0)
