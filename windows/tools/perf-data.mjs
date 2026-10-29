// A realistic, heavy data set for `npm run perf` (and by hand: `node tools/perf-data.mjs <folder>`):
// ≈150 open to-dos across 오늘 · 앞으로 · 언젠가, 60 events (repeating ones too), 2,000 archive lines,
// 80 memos, 5 alarms and 300 focus.jsonl lines, dated around the moment it runs. Same files as the app
// keeps; the folder is copied into a --demo run's throwaway folder (PAPERTODO_DEMO_DATA).
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function writePerfData(folder, now = new Date(), options = {}) {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const id = () => randomUUID().toUpperCase();
  const iso = (date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
  const pad = (value) => String(value).padStart(2, "0");
  const key = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const day = (offset) => { const date = new Date(now); if (date.getHours() < 4) date.setDate(date.getDate() - 1); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + offset); return date; };
  const at = (offset, hour, minute = 0) => { const date = day(offset); date.setHours(hour, minute, 0, 0); return date; };
  const words = ["보고서 정리", "메일 답장", "장보기", "운동 30분", "책 20쪽 읽기", "세금 서류", "치과 예약", "엄마께 전화", "회의 자료", "빨래", "청소기 돌리기", "택배 반납", "디자인 검토", "코드 리뷰", "블로그 초안", "영수증 정리", "물 마시기", "산책", "계약서 확인", "발표 연습"];
  fs.mkdirSync(path.join(folder, "archive"), { recursive: true });

  // ─── todos.json ───
  const items = [];
  const created = iso(at(-3, 9));
  const task = (title, extra = {}) => { const item = { id: id(), title, isCompleted: false, createdAt: created, ...extra }; items.push(item); return item; };
  for (let index = 0; index < 50; index += 1) {
    const extra = {};
    if (index % 6 === 0) {
      let when = at(0, 8 + (index % 14), (index * 7) % 60);
      // Nothing comes due while a run measures (a bubble on the screen would be measured too).
      if (when > now && when - now < 45 * 60_000) when = new Date(when.getTime() + 60 * 60_000);
      extra.reminderAt = iso(when);
      if (when < now) extra.reminderLastDeliveredAt = iso(when); // rung already: no bubble waiting at launch
    }
    if (index % 9 === 0) extra.dueDate = key(day(-(index % 3)));
    if (index % 5 === 0) extra.todaySince = key(day(-(index % 4)));
    task(`${pick(words)} ${index + 1}`, extra);
  }
  for (let index = 0; index < 20; index += 1) task(`${pick(words)} 끝 ${index + 1}`, { isCompleted: true, completedAt: iso(at(0, 9, index)) });
  for (let index = 0; index < 70; index += 1) task(`${pick(words)} 앞 ${index + 1}`, { dueDate: key(day(1 + (index % 40))), ...(index % 7 === 0 ? { reminderAt: iso(at(1 + (index % 40), 10)) } : {}) });
  for (let index = 0; index < 30; index += 1) task(`${pick(words)} 언젠가 ${index + 1}`, { shelf: "later" });
  if (options.extraItems) items.push(...options.extraItems);
  // `--todos=2000`: today's sheet filled up to that many to-dos in all (1.30's spaces measure; a tenth of them done).
  for (let index = items.length; index < (options.todos ?? 0); index += 1) {
    task(`${pick(words)} 오늘 ${index + 1}`, index % 10 === 0 ? { isCompleted: true, completedAt: iso(at(0, 9, index % 60)) } : {});
  }
  fs.writeFileSync(path.join(folder, "todos.json"), JSON.stringify({ items }, null, 2) + "\n");

  // ─── todo-spaces.json (1.30, `--spaces=9`): that many spaces, every to-do but each fifth in one ───
  if (options.spaces) {
    const colors = ["lavender", "pink", "mint", "yellow", "sky", "peach", "sand", "gray"];
    const spaces = Array.from({ length: options.spaces }, (_, index) => ({ color: colors[index % 8], id: `s-${(0x100000 + index).toString(16)}`, name: ["회사", "집", "공부", "운동", "가족", "모임", "취미", "여행", "돈"][index % 9] + (index >= 9 ? index : ""), order: index, updatedAt: created }));
    const placed = {};
    items.forEach((item, index) => { if (index % 5 !== 4) placed[item.id] = { at: created, space: spaces[index % spaces.length].id }; });
    fs.writeFileSync(path.join(folder, "todo-spaces.json"), JSON.stringify({ items: placed, spaces, version: 1 }, null, 2) + "\n");
  }

  // ─── repeats.json ───
  const series = [
    { id: id(), title: "물 마시기", rule: { kind: "daily" }, remindAt: "15:00", createdAt: created },
    { id: id(), title: "주간 회고", rule: { kind: "weekly", weekdays: [5] }, createdAt: created },
    { id: id(), title: "운동", rule: { kind: "weekdays" }, remindAt: "07:30", createdAt: created },
    { id: id(), title: "카드값", rule: { kind: "monthly", monthDay: 15 }, createdAt: created },
    { id: id(), title: "화분 물 주기", rule: { kind: "weekly", weekdays: [0, 3] }, createdAt: created },
  ];
  // Today's copies count as placed already (a copy placed at launch with a past time would ring at once).
  for (const entry of series) entry.lastPlaced = key(day(0));
  fs.writeFileSync(path.join(folder, "repeats.json"), JSON.stringify({ series }, null, 2) + "\n");

  // ─── events.json ───
  const events = [];
  const colors = ["blue", "sage", "coral", "purple", "yellow", "gray"];
  const event = (title, date, start, end, extra = {}) => events.push({ id: id(), title, date: key(date), allDay: false, days: 1, start, end, repeat: "none", skip: [], color: pick(colors), createdAt: created, updatedAt: created, ...extra });
  const eventTitles = ["팀 회의", "치과", "점심 약속", "1:1", "스터디", "운동 수업", "고객 미팅", "디자인 리뷰", "병원", "저녁 약속"];
  event("스탠드업", day(-10), 9 * 60 + 30, 9 * 60 + 45, { repeat: "daily" });
  event("주간 회의", day(-14), 14 * 60, 15 * 60, { repeat: "weekly" });
  event("요가", day(-20), 19 * 60, 20 * 60, { repeat: "weekly" });
  event("월간 정산", day(-40), 11 * 60, 12 * 60, { repeat: "monthly" });
  event("점심", day(-30), 12 * 60, 13 * 60, { repeat: "daily", skip: [key(day(-1))] });
  event("생일", day(-200), 0, 0, { allDay: true, repeat: "yearly" });
  event("1:1", day(-21), 16 * 60, 16 * 60 + 30, { repeat: "weekly" });
  event("독서 모임", day(-60), 20 * 60, 21 * 60 + 30, { repeat: "monthly" });
  // Today: a full day.
  event("디자인 리뷰", day(0), 10 * 60 + 30, 11 * 60 + 30);
  event("치과", day(0), 15 * 60 + 30, 16 * 60 + 30);
  event("고객 미팅", day(0), 17 * 60, 18 * 60);
  event("휴가 계획", day(0), 0, 0, { allDay: true });
  while (events.length < (options.events ?? 60)) {
    const offset = Math.floor(random() * 60) - 25;
    if (random() < 0.15) event(pick(eventTitles), day(offset), 0, 0, { allDay: true, days: 1 + Math.floor(random() * 3) });
    else { const start = (8 + Math.floor(random() * 11)) * 60 + pick([0, 15, 30, 45]); event(pick(eventTitles), day(offset), start, start + pick([30, 60, 90])); }
  }
  fs.writeFileSync(path.join(folder, "events.json"), JSON.stringify({ events }, null, 2) + "\n");

  // ─── memos.json ───
  const memos = [];
  for (let index = 0; index < 80; index += 1) {
    const stamp = iso(at(-index, 10));
    memos.push({ createdAt: stamp, id: id(), text: `메모 ${index + 1} — ${pick(words)}\n${pick(words)}, ${pick(words)}\n${"긴 줄 ".repeat(1 + (index % 12))}`, updatedAt: stamp });
  }
  fs.writeFileSync(path.join(folder, "memos.json"), JSON.stringify({ memos }, null, 2) + "\n");

  // ─── alarms.json ───
  const alarms = [["07:00", "기상", [1, 2, 3, 4, 5]], ["08:30", "약", [0, 1, 2, 3, 4, 5, 6]], ["13:00", "", []], ["22:00", "잘 준비", [0, 6]], ["06:30", "", [3]]]
    .map(([time, label, days]) => ({ id: id(), time, label, days, enabled: days.length > 0, sound: "bell", snooze: 10, createdAt: created, updatedAt: created }));
  fs.writeFileSync(path.join(folder, "alarms.json"), JSON.stringify({ alarms }, null, 2) + "\n");

  // ─── archive/YYYY-MM.jsonl: 2,000 finished tasks over the last ~8 months ───
  // (perf audit 2: options.history lines over options.historyDays days, e.g. 6,000 over 1,095 for three years.)
  const months = new Map();
  const historyLines = options.history ?? 2000;
  const perDay = historyLines / (options.historyDays ?? 2000 / 8.5);
  for (let index = 0; index < historyLines; index += 1) {
    const finished = at(-3 - Math.floor(index / perDay), 9 + (index % 10), (index * 13) % 60);
    const month = `${finished.getFullYear()}-${pad(finished.getMonth() + 1)}`;
    const line = JSON.stringify({ id: id(), title: `${pick(words)} ${index}`, createdAt: iso(new Date(finished.getTime() - 86_400_000)), completedAt: iso(finished) });
    months.set(month, [...(months.get(month) ?? []), line]);
  }
  for (const [month, lines] of months) fs.writeFileSync(path.join(folder, "archive", `${month}.jsonl`), lines.join("\n") + "\n");

  // ─── focus.jsonl: 300 sessions ───
  const focus = [];
  for (let index = 0; index < 300; index += 1) {
    const start = at(-1 - Math.floor(index / 2), 9 + (index % 9));
    const minutes = pick([25, 25, 50, 15, 40]);
    focus.push(JSON.stringify({ id: id(), ...(index % 3 ? { taskId: id() } : {}), title: index % 3 ? pick(words) : "", start: iso(start), end: iso(new Date(start.getTime() + minutes * 60_000)), minutes, kind: index % 3 ? "focus" : "timer", done: index % 4 === 0 }));
  }
  fs.writeFileSync(path.join(folder, "focus.jsonl"), focus.join("\n") + "\n");

  // ─── settings.json: past the first-launch questions ───
  // Past the first-launch questions; the periodic nudge, the evening sweep and cat talk stay quiet so no bubble
  // appears mid-measurement (they are measured on their own when wanted).
  const prefs = { guideSeen: true, loginAsked: true, manualLaunches: 9, petVisible: options.pet ?? false, reminderEnabled: false, eveningSweep: false, chatter: false, calendarAlertMinutes: 0, ...(options.prefs ?? {}) };
  fs.writeFileSync(path.join(folder, "settings.json"), JSON.stringify({ prefs, memory: { bounds: { x: 120, y: 80, width: 420, height: 640 } } }, null, 2));
  return { open: items.filter((item) => !item.isCompleted).length, events: events.length, memos: memos.length };
}

// (Bundled into a test, import.meta.url is the test's own file: the name check keeps it from running then.)
if (process.argv[1] && path.basename(new URL(import.meta.url).pathname) === "perf-data.mjs" && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const folder = process.argv[2];
  if (!folder) { console.error("usage: node tools/perf-data.mjs <folder>"); process.exit(2); }
  console.log(writePerfData(folder));
}
