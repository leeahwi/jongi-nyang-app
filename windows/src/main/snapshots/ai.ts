import fs from "node:fs";
import path from "node:path";
import { BrowserWindow } from "electron";
import { dayKey, logicalDayStart } from "../../core/archive";
import { type TodoItem, isoDate } from "../../core/notebook";
import { lang, t } from "../../i18n";
import { type LocalEvent } from "../../core/events";
import { type LayoutCheckOptions, type LayoutReport, layoutCheckScript } from "../layoutCheck";
import { type AiItem, type AiLogEntry, aiAwayText, aiEntry, aiToastText, aiUndoText } from "../../core/ai";
import { ai, floating, focusTimer, note, notice, store } from "../main";
import { type Save, type Wait } from "./index";
import { noteLayoutChecks } from "./cats";
import { pinSampleReminders } from "./design";
import { captureDesk, inPane, openDay, showDeskPane } from "./desk";

/**
 * #408: AI 연결's snapshots (`npm run snapshot -- ai`), moved out of main.ts as they were. Test runs only (see
 * snapshots/design.ts).
 */

// ─── AI 연결's snapshots ─────────────────────────────────────────────────────

/**
 * Snapshots: Claude's work on the list as it stands — two to-dos it added today (one with hours), the time of
 * one of today's events it changed, and yesterday's work (an event; a to-do taken back) for the recent list.
 * The to-dos and the event are made here; the log says Claude made them, so they carry the stamp.
 */
export function aiSample(onList = true): { entries: AiLogEntry[]; made: { tasks: string[]; event: string } } {
  const now = Date.now();
  const at = (minutes: number) => new Date(now - minutes * 60_000);
  const loose = (title: string, id: string): TodoItem => ({ id, title, isCompleted: false, createdAt: isoDate(new Date(now)) });
  let tasks: TodoItem[] = [loose(t("발표 자료 검토하기"), "AI-SAMPLE-1"), loose(t("치과 예약 전화"), "AI-SAMPLE-2")];
  if (onList) store.mutate((history) => {
    tasks = [history.addTo(t("발표 자료 검토하기"), undefined, new Date(), undefined, undefined, { start: 840, end: 900 })!, history.addTo(t("치과 예약 전화"), undefined, new Date())!];
  });
  const stamp = new Date(now - 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const before: LocalEvent = { id: "AI-SAMPLE-EVENT", title: t("팀 회의"), date: dayKey(new Date()), allDay: false, days: 1, start: 720, end: 780, repeat: "none", skip: [], color: "sage", location: t("회의실 A"), createdAt: stamp, updatedAt: stamp };
  const after: LocalEvent = { ...before, start: 780, end: 840, updatedAt: at(10).toISOString().replace(/\.\d{3}Z$/, "Z") };
  if (onList) store.replaceEvents([...store.events.filter((event) => event.id !== before.id), after]);
  const item = (value: object) => ({ ...value }) as AiItem;
  const gone = { id: "AI-SAMPLE-GONE", title: t("책 반납하기"), isCompleted: false, createdAt: stamp };
  const added = aiEntry({ client: "Claude", tool: "add_todos", kind: "add", target: "todos", title: tasks[0].title, changes: tasks.map((task) => ({ file: "todos.json", id: task.id, before: null, after: item(task) })) }, at(25));
  const moved = aiEntry({ client: "Claude", tool: "apply_changes", kind: "change", target: "events", title: after.title, changes: [{ file: "events.json", id: after.id, before: item(before), after: item(after) }] }, at(10));
  const yoga = aiEntry({ client: "Claude", tool: "add_event", kind: "add", target: "events", title: t("요가"), changes: [{ file: "events.json", id: "AI-SAMPLE-YOGA", before: null, after: item({ id: "AI-SAMPLE-YOGA", title: t("요가") }) }] }, at(60 * 26));
  const book = aiEntry({ client: "Claude", tool: "add_todos", kind: "add", target: "todos", title: gone.title, changes: [{ file: "todos.json", id: gone.id, before: null, after: item(gone) }] }, at(60 * 25));
  const undo = aiEntry({ client: "app", tool: "undo", kind: "undo", target: "todos", title: gone.title, undoes: book.id, changes: [{ file: "todos.json", id: gone.id, before: item(gone), after: null }], count: 1 }, at(60 * 25 - 2));
  return { entries: [yoga, book, undo, added, moved], made: { tasks: tasks.map((task) => task.id), event: after.id } };
}

/** Snapshots: Claude's sample taken away again (its to-dos, its event and the log). */
export function aiSampleGone(made: { tasks: string[]; event: string }): void {
  store.mutate((history) => { for (const id of made.tasks) history.delete(id); });
  store.replaceEvents(store.events.filter((event) => event.id !== made.event));
  ai.seedForSnapshots([]);
}

/** What the AI 연결 shots check in the note: every stamp shown whole inside its row, the toast's words not cut. */
export const aiNoteScript = `(() => {
  const out = [];
  const r = (element) => element.getBoundingClientRect();
  const stamps = [...document.querySelectorAll(".ai-stamp")].filter((stamp) => !stamp.hidden && stamp.offsetParent);
  for (const stamp of stamps) {
    const row = stamp.closest(".row, .strip-row, .lead-row");
    const box = r(stamp), outer = row ? r(row) : { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
    if (box.left < outer.left - 0.5 || box.right > outer.right + 0.5 || box.right > window.innerWidth) out.push("stamp outside its row: " + (row?.textContent ?? ""));
    const neighbour = stamp.nextElementSibling;
    if (neighbour && getComputedStyle(neighbour).display !== "none" && r(neighbour).width > 0 && box.right > r(neighbour).left + 1) out.push("stamp under " + neighbour.className);
  }
  const text = document.querySelector(".toast .toast-text");
  if (text && text.scrollHeight > text.clientHeight + 1) out.push("toast cut: " + text.textContent);
  if (text && text.scrollWidth > text.clientWidth + 1) out.push("toast cut: " + text.textContent);
  const toast = document.querySelector(".toast");
  if (toast && (r(toast).left < 0 || r(toast).right > window.innerWidth)) out.push("toast outside the note");
  return (out.join("; ") || "ok") + " · " + stamps.length + " stamps";
})()`;

/** The settings pane's checks (the sweep's, and AI 연결's shots). */
export const settingsPaneChecks: LayoutCheckOptions = {
  ignore: ".ph-cat",
  inside: [".pane-head", ".bottom", ".bottom > *"],
  oneLine: [".pane-head h1", ".segmented button", ".seg button", ".action", ".group > .label", ".tile .name", ".ai-time", ".ai-undone", ".ai-day"],
  rows: [".pane-head", ".row", ".bottom", ".form-actions"],
};

/**
 * `npm run snapshot -- ai` (and the full run): AI 연결 (1.27), day and night — the stamps on the list and the
 * strip, the toast with 되돌리기, 자리 비운 사이, a partial undo, and 설정 › AI 연결 (on with work, after an
 * undo, and off with nothing yet). Returns how many layout problems it found.
 */
export async function aiShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
  let problems = 0;
  const run = (script: string) => note.webContents.executeJavaScript(script).catch((error: Error) => `script failed: ${error.message}`);
  floating.hide();
  focusTimer.command({ kind: "stop" });
  note.webContents.reload();
  note.showInactive();
  await wait(1200);
  store.setPref("calendarStrip", true);
  openDay(false);
  ai.setEnabled(true);
  const dayStart = logicalDayStart(new Date());
  const tenAM = new Date(dayStart.getTime() + 6 * 3_600_000).toISOString();
  const unpin = pinSampleReminders(dayStart);
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    const prefix = paper === "night" ? "night/" : "";
    if (paper === "night") fs.mkdirSync(path.join(directory, "night"), { recursive: true });
    const sample = aiSample();
    ai.seedForSnapshots(sample.entries);
    note.webContents.send("note:row-command", { id: "", command: "page-today" });
    await wait(400);
    // The strip at 10:00 of today, so the changed meeting and the to-do with hours are still ahead in it.
    await run(`window.ribbonNow = ${JSON.stringify(tenAM)}; window.dispatchEvent(new Event("ribbon-now")); document.querySelector(".sheet").scrollTop = 0`);
    const shot = async (name: string, checks = noteLayoutChecks) => {
      await wait(450);
      await settled(note);
      const report = await note.webContents.executeJavaScript(layoutCheckScript(checks)).catch((error: Error) => ({ problems: [`check failed: ${error.message}`], truncated: [] })) as LayoutReport;
      const own = await run(aiNoteScript) as string;
      const found = [...report.problems, ...(own.startsWith("ok") ? [] : [own])];
      console.log(`ai ${prefix}${name}: ${found.length ? found.join("; ") : "ok"} · ${own.replace(/^ok · /, "")}`);
      problems += found.length;
      await save(`${prefix}${name}`, note.webContents.capturePage());
    };
    await shot("ai-marked");
    await run(`document.querySelector(".lines .ai-stamp:not([hidden])")?.closest(".row")?.scrollIntoView({ block: "center" })`);
    // (The strip scrolled away above is meant.)
    await shot("ai-marked-list", { ...noteLayoutChecks, inside: noteLayoutChecks.inside?.filter((selector) => !selector.startsWith(".strip")) });
    await run(`document.querySelector(".sheet").scrollTop = 0`);
    const [, , , added, moved] = sample.entries;
    notice({ icon: "sparkles", text: aiToastText(added, lang()), undo: "ai", entry: added.id, long: true });
    await shot("ai-toast");
    notice({ icon: "sparkles", text: aiToastText(moved, lang()), undo: "ai", entry: moved.id, long: true });
    await shot("ai-toast-time");
    notice({ icon: "sparkles", text: aiAwayText(3, lang()), show: "ai", long: true });
    await shot("ai-away");
    notice({ icon: "warning", text: aiUndoText(1, 1, lang()), long: true });
    await shot("ai-undo-partial");
    await run(`document.querySelector(".toast")?.remove()`);

    // 설정 › AI 연결: on, with today's and yesterday's work.
    const pane = async (name: string) => {
      await showDeskPane("ai", wait);
      await wait(300);
      const report = await inPane("settings", layoutCheckScript(settingsPaneChecks)) as LayoutReport | string | undefined;
      const found = typeof report === "object" && report ? report.problems : [`check failed: ${String(report)}`];
      const groups = await inPane("settings", `[...document.querySelectorAll(".group")].map((g) => g.querySelector(".label").textContent + " (" + g.querySelectorAll(".row").length + ")").join(" · ")`);
      console.log(`ai ${prefix}${name}: ${found.length ? found.join("; ") : "ok"} · ${groups}`);
      if (typeof report === "object" && report?.truncated.length) console.log(`  … truncated: ${report.truncated.join(" · ")}`);
      problems += found.length;
      await save(`${prefix}${name}`, captureDesk(wait));
    };
    await pane("ai-settings");
    // 되돌리기 on Claude's two to-dos after one was changed here: the other goes, the entry says 되돌림 and how it went.
    store.mutate((history) => history.edit(sample.made.tasks[1], t("치과 예약 전화 (오후)")));
    ai.undo(added.id);
    await pane("ai-settings-undone");
    aiSampleGone(sample.made);
    ai.setEnabled(false);
    await pane("ai-settings-off");
    ai.setEnabled(true);
  }
  store.setPref("paper", "day");
  ai.setEnabled(false);
  await run(`window.ribbonNow = undefined; window.dispatchEvent(new Event("ribbon-now"))`);
  unpin();
  console.log(problems ? `AI PROBLEMS: ${problems}` : "AI OK");
  return problems;
}
