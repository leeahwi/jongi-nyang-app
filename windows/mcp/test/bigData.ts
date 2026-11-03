import fs from "node:fs";
import path from "node:path";
import { serializeEvents, type LocalEvent } from "../../src/core/events";
import { serializeMemos, type Memo } from "../../src/core/memo";
import { serializeMemoFolders, type MemoFolders } from "../../src/core/memoDrawer";
import { serializeNotebook, type TodoItem } from "../../src/core/notebook";
import { serializeSeries, type Series } from "../../src/core/repeat";

/**
 * The large example of docs/plans/mcp-plan.md §1.4, made up from scratch (P2, M39): 3,000 tasks (most of the
 * open ones on today's sheet), 2,000 memos of about 500 characters in five folders, 1,500 events, six years of
 * finished tasks (21,600 lines), 5,000 focus sessions and 30 repeating tasks. Every name and word is invented
 * here — nothing is copied from a real list or screen.
 */

const words = ["보고서", "회의", "장보기", "운동", "정리", "메일", "독서", "청소", "계획", "발표", "공부", "산책", "전화", "예약", "빨래", "Report", "Review", "Draft", "Plan", "Notes"];
const places = ["3층 회의실", "카페", "도서관", "", "", ""];

/** A small fixed random, so every run makes the same shapes. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}

const pad = (value: number) => String(value).padStart(2, "0");
const day = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
const id = () => crypto.randomUUID().toUpperCase();

export interface BigData { todos: TodoItem[]; memos: Memo[]; events: LocalEvent[]; folders: MemoFolders; series: Series[]; archiveLines: number }

/** Writes the example into `folder` for the day of `now` ("2026-10-27T10:00:00+09:00"). */
export function writeBigData(folder: string, now = new Date("2026-10-27T10:00:00+09:00")): BigData {
  const random = randomFrom(20261027);
  const pickWord = () => words[Math.floor(random() * words.length)];
  const title = (index: number) => `${pickWord()} ${pickWord()} ${index}`;
  const at = (days: number, hour = 9) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, Math.floor(random() * 60));

  const series: Series[] = Array.from({ length: 30 }, (_, index) => ({
    id: id(), title: `반복 ${title(index)}`, createdAt: iso(at(-400)),
    rule: index % 3 === 0 ? { kind: "daily" } : index % 3 === 1 ? { kind: "weekly", weekdays: [1 + (index % 5)] } : { kind: "monthly", monthDay: 1 + (index % 28) },
    ...(index % 2 ? { remindAt: `${pad(7 + (index % 12))}:00` } : {}),
  }));

  const todos: TodoItem[] = [];
  for (let index = 0; index < 3000; index += 1) {
    const base: TodoItem = { id: id(), title: title(index), isCompleted: false, createdAt: iso(at(-Math.floor(random() * 30))) };
    if (index < 2200) {
      // Open on today's sheet, some with a time and a reminder, some copies of a repeat.
      if (index % 4 === 0) { const hour = 9 + (index % 12); Object.assign(base, { timeStart: `${pad(hour)}:00`, timeEnd: `${pad(hour)}:30`, reminderAt: iso(at(0, hour)) }); }
      if (index % 50 === 0) base.seriesID = series[index % series.length].id;
    } else if (index < 2600) base.dueDate = day(at(1 + (index % 60)));
    else if (index < 2800) base.shelf = "later";
    else Object.assign(base, { isCompleted: true, completedAt: iso(at(index % 2 ? 0 : -1, 9)) });
    todos.push(base);
  }

  const events: LocalEvent[] = Array.from({ length: 1500 }, (_, index) => {
    const start = (8 + (index % 11)) * 60;
    return {
      id: id(), title: title(index), date: day(at(-400 + Math.floor(index * 0.55))), allDay: index % 17 === 0, days: 1 + (index % 17 === 0 ? index % 3 : 0),
      start, end: start + 60, repeat: index < 12 ? (["daily", "weekly", "monthly"] as const)[index % 3] : "none", skip: [], color: "blue",
      ...(places[index % places.length] ? { location: places[index % places.length] } : {}),
      createdAt: iso(at(-500)), updatedAt: iso(at(-500)),
    };
  });

  const folderIds = [id(), id(), id(), id()];
  const folders: MemoFolders = {
    v: 1, updatedAt: iso(at(-1)), placement: {},
    folders: [
      { id: "inbox", name: "메모", color: "lavender", order: 0, updatedAt: "1970-01-01T00:00:00Z" },
      ...["회사", "집", "공부", "여행"].map((name, index) => ({ id: folderIds[index], name, color: "mint", order: index + 1, updatedAt: iso(at(-100)) })),
    ],
  };
  const memos: Memo[] = Array.from({ length: 2000 }, (_, index) => {
    const lines = [`${title(index)} 메모`, ...Array.from({ length: 6 }, (_, line) => (line % 2 ? `- [ ] ${pickWord()} ${pickWord()} ${line}` : `${pickWord()} ${pickWord()} ${pickWord()} ${pickWord()} ${pickWord()} ${pickWord()} ${pickWord()} ${pickWord()} 줄 ${line}입니다.`))];
    let text = lines.join("\n");
    while (text.length < 480) text += `\n${pickWord()} ${pickWord()} ${pickWord()} ${pickWord()} ${pickWord()} ${pickWord()}`;
    const made = at(-Math.floor(index / 2));
    const memo: Memo = { id: id(), text, createdAt: iso(made), updatedAt: iso(made) };
    if (index % 5 !== 0) folders.placement[memo.id] = { folder: folderIds[index % 4], pinned: index % 37 === 0, at: iso(made) };
    return memo;
  });

  fs.writeFileSync(path.join(folder, "todos.json"), serializeNotebook({ items: todos }));
  fs.writeFileSync(path.join(folder, "events.json"), serializeEvents(events));
  fs.writeFileSync(path.join(folder, "memos.json"), serializeMemos(memos));
  fs.writeFileSync(path.join(folder, "memo-folders.json"), serializeMemoFolders(folders));
  fs.writeFileSync(path.join(folder, "repeats.json"), serializeSeries(series));

  // Six years of finished tasks: 72 months of 300 lines.
  fs.mkdirSync(path.join(folder, "archive"), { recursive: true });
  let archiveLines = 0;
  for (let month = 0; month < 72; month += 1) {
    const first = new Date(now.getFullYear(), now.getMonth() - 71 + month, 1, 12);
    const lines = Array.from({ length: 300 }, (_, index) => {
      const done = new Date(first.getFullYear(), first.getMonth(), 1 + (index % 28), 10 + (index % 8));
      return JSON.stringify({ id: id(), title: title(index), createdAt: iso(done), completedAt: iso(done), ...(index % 5 === 0 ? { timeStart: "10:00", timeEnd: "11:00" } : {}) });
    });
    archiveLines += lines.length;
    fs.writeFileSync(path.join(folder, "archive", `${first.getFullYear()}-${pad(first.getMonth() + 1)}.jsonl`), `${lines.join("\n")}\n`);
  }

  // 5,000 focus sessions over the last 500 days.
  const focus = Array.from({ length: 5000 }, (_, index) => {
    const start = at(-Math.floor(index / 10), 9 + (index % 10));
    return JSON.stringify({ id: `f${index}`, title: title(index % 300), start: iso(start), end: iso(new Date(start.getTime() + 25 * 60_000)), minutes: 25, kind: "focus", done: false });
  });
  fs.writeFileSync(path.join(folder, "focus.jsonl"), `${focus.join("\n")}\n`);

  return { todos, memos, events, folders, series, archiveLines };
}
