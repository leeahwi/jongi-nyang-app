# 1.40's drag, replayed on paper: DragGesture(.local) on a block that moves under it by .offset.
# translation seen = pointer move − the block's own offset when the event arrives; offset = that, in 12.5 pt steps
# (DayStrip.dragged: Δ rounded to the nearest 15 min = 12.5 pt).
path = [1.3]*40 + [0.4]*30 + [-1.2]*40 + [0]*8
snap = lambda t: 12.5 * round(t / 12.5)
p = o = 0.0
rows = []
for step in path:
    p += step
    seen = p - o
    o = snap(seen)
    rows.append((p, seen, o))
flips = sum(1 for a, b in zip(rows, rows[1:]) if (b[2] - a[2]) * ((b[0] - a[0]) or 1) < 0 or (b[0] == a[0] and b[2] != a[2]))
changes = sum(1 for a, b in zip(rows, rows[1:]) if b[2] != a[2])
print(f"ticks {len(rows)} · the block's offset changed {changes} times · against the pointer {flips} times · max |offset − pointer| {max(abs(r[2]-r[0]) for r in rows):.1f} pt")
print("tick  pointer  seen    offset")
for i, r in enumerate(rows[:24]): print(f"{i:4d}  {r[0]:6.1f}  {r[1]:6.1f}  {r[2]:6.1f}")
