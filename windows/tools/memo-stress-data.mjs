// 메모 서랍 stress data (docs/perf-memo-stress.md): memos.json and memo-folders.json for a folder. The same recipe as
// the macOS app's scripts/memo-stress-data.py (mixed lengths, links and phone numbers, two years of times, 30 folders).
//   node tools/memo-stress-data.mjs <folder> [--memos=N] [--long=10,100,1024] [--checklist=2000] [--folders=30]
// Used by tools/perf-memo.mjs (the drawer's own timings) and test/memoStress.test.ts (the core's).
import fs from "node:fs";
import path from "node:path";

/** The memos and the folders' file, in memory. */
export function memoStressData({ memos: count = 500, long = [], checklist = 0, folders: folderCount = 30, inboxShare = 0.6, marker = false, now = new Date() } = {}) {
  let seed = 11;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const int = (low, high) => low + Math.floor(random() * (high - low + 1));
  const pick = (list) => list[Math.floor(random() * list.length)];
  const iso = (date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
  const minutesAgo = (minutes) => new Date(now.getTime() - minutes * 60_000);
  const hex = () => Math.floor(random() * 0x10000).toString(16).toUpperCase().padStart(4, "0");
  const id = () => `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
  const words = ["보고서", "회의", "준비", "메일", "답장", "장보기", "운동", "책", "정리", "디자인", "검토", "코드", "리뷰", "발표", "자료",
    "계획", "사진", "영수증", "공부", "여행", "예약", "견적", "계약서", "일정", "아이디어", "고객", "피드백", "배포", "테스트", "문서"];
  const latin = ["deploy", "release", "notes", "draft", "budget", "invoice", "meeting", "sprint", "design", "review"];
  const sentence = (n) => Array.from({ length: n }, () => (random() < 0.85 ? pick(words) : pick(latin))).join(" ");
  const links = ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://github.com/leeahwi/jongi-nyang-app", "https://docs.google.com/document/d/abc"];
  const bytes = (text) => Buffer.byteLength(text);
  const body = (kind) => {
    let lines;
    if (kind === "short") lines = Array.from({ length: int(1, 3) }, () => sentence(int(2, 6)));
    else if (kind === "medium") lines = Array.from({ length: int(5, 20) }, () => sentence(int(3, 10)));
    else if (kind === "long") {
      const target = int(2, 5) * 1024;
      lines = [];
      for (let size = 0; size < target;) { const line = sentence(int(6, 14)); lines.push(line); size += bytes(line) + 1; }
    } else lines = [sentence(3), ...Array.from({ length: int(4, 12) }, () => `- [${random() < 0.3 ? "x" : " "}] ${sentence(int(2, 5))}`)];
    if (random() < 0.06) lines.push(pick(links));
    if (random() < 0.03) lines.push(`010-${int(1000, 9999)}-${int(1000, 9999)}`);
    return lines.join("\n");
  };
  const sized = (kb, title) => {
    const lines = [title];
    for (let size = bytes(title); size < kb * 1024;) { const line = sentence(int(8, 16)); lines.push(line); size += bytes(line) + 1; }
    return lines.join("\n");
  };

  const memos = [];
  for (let n = 0; n < count; n += 1) {
    const roll = random();
    const kind = roll < 0.6 ? "short" : roll < 0.9 ? "medium" : roll < 0.99 ? "long" : "checklist";
    const updated = minutesAgo(int(30, 2 * 365 * 24 * 60));
    const created = new Date(updated.getTime() - int(0, 60 * 24 * 30) * 60_000);
    memos.push({ createdAt: iso(created), id: id(), text: body(kind), updatedAt: iso(updated) });
  }
  memos.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  const special = long.map((kb, index) => { const at = iso(minutesAgo(1 + index)); return { createdAt: at, id: `STRESS-LONG-${kb}K`, text: sized(kb, `긴 메모 ${kb}KB`), updatedAt: at }; });
  if (checklist) {
    const at = iso(minutesAgo(1 + long.length));
    const lines = [`체크 목록 ${checklist}줄`, ...Array.from({ length: checklist }, (_, n) => `- [${n % 4 === 0 ? "x" : " "}] ${n + 1}. ${sentence(3)}`)];
    special.push({ createdAt: at, id: `STRESS-CHECK-${checklist}`, text: lines.join("\n"), updatedAt: at });
  }
  // The UI check starts from a short memo on top of everything.
  if (marker) special.unshift({ createdAt: iso(now), id: "STRESS-TOP", text: "맨 위 메모\n여기에 적어 봐요", updatedAt: iso(now) });
  const all = [...special, ...memos];

  const colors = ["lavender", "pink", "mint", "yellow", "sky", "peach", "sand", "gray"];
  const stamp = iso(now);
  const folders = [{ id: "inbox", name: "메모", color: "lavender", order: 0, updatedAt: stamp }];
  for (let n = 1; n < folderCount; n += 1) folders.push({ id: `F${String(n).padStart(2, "0")}`, name: `${pick(words)} ${n}`, color: colors[n % 8], order: n, updatedAt: stamp });
  const placement = {};
  let pins = 0;
  all.forEach((memo, index) => {
    const stress = memo.id.startsWith("STRESS-");
    const home = stress || random() < inboxShare || folders.length === 1 ? "inbox" : pick(folders.slice(1)).id;
    // A few pinned (at most 6): a long 고정 group would push the top memo the UI check starts from out of view.
    const pinned = !stress && index % 97 === 5 && pins < 6;
    if (pinned) pins += 1;
    placement[memo.id] = { folder: home, pinned, at: memo.updatedAt };
  });
  return { memos: all, folders: { v: 1, folders, placement, updatedAt: stamp } };
}

/** Writes memos.json and memo-folders.json (the app's own formatting is not needed: both apps read any JSON). */
export function writeMemoStressData(folder, options = {}) {
  const data = memoStressData(options);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "memos.json"), JSON.stringify({ memos: data.memos }, null, 2) + "\n");
  fs.writeFileSync(path.join(folder, "memo-folders.json"), JSON.stringify(data.folders, null, 2) + "\n");
  return { memos: data.memos.length, inbox: Object.values(data.folders.placement).filter((place) => place.folder === "inbox").length, bytes: fs.statSync(path.join(folder, "memos.json")).size };
}

// Run directly (not when bundled into a test, where import.meta.url is the test's own file).
if (process.argv[1]?.endsWith("memo-stress-data.mjs") && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const folder = process.argv[2];
  const summary = writeMemoStressData(folder, {
    memos: Number(option("memos") ?? 500), long: (option("long") ?? "").split(",").filter(Boolean).map(Number),
    checklist: Number(option("checklist") ?? 0), folders: Number(option("folders") ?? 30),
  });
  console.log(`memo stress: ${summary.memos} memos (${summary.inbox} in the inbox), memos.json ${Math.round(summary.bytes / 1024)} KB → ${folder}`);
}
