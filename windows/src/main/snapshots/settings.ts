import fs from "node:fs";
import path from "node:path";
import { t } from "../../i18n";
import { type BackupCounts, type BackupReason, savedName } from "../../core/backup";
import { deskTitleBar } from "../../core/desk";
import { type LayoutReport, layoutCheckScript } from "../layoutCheck";
import { type ConfirmQuestion } from "../confirm";
import { backups, confirmSlip, desk, note, restoreQuestion, shortcutQuestion, storageMovedText, store } from "../main";
import { type Save, type Wait } from "./index";
import { settingsPaneChecks } from "./ai";
import { captureDesk, inPane, showDeskPane } from "./desk";

/**
 * #408: snapshots of 설정's shortcuts, fonts and backups (`npm run snapshot -- shortcuts` · `fonts` · `backups`), moved
 * out of main.ts as they were. Test runs only (see snapshots/design.ts).
 */

/** The run's exit code says whether the size sweep found layout problems. */
/**
 * #85 · #86, day and night, into snapshots/shortcuts/: the shortcut list (the keys as they start; a note key of one's
 * own with the drawer's off; scrolling on a short screen), and 설정 › 꾸미기 › 빠른 입력 with the note's key row (at rest,
 * a refused key while listening, a key of one's own with ‘기본값’, off). Each with a layout check.
 */
export async function shortcutShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  fs.mkdirSync(path.join(directory, "shortcuts"), { recursive: true });  const listCheck = `(() => {
    const out = [];
    const cut = (el) => el.scrollWidth > el.clientWidth + 1;
    for (const el of document.querySelectorAll(".keys-name, .keys-title, .keys-off, .keycap, .slip-title, .sbtn")) if (cut(el)) out.push("cut: " + el.textContent);
    for (const row of document.querySelectorAll(".keys-row")) { const caps = row.querySelector(".keys-caps, .keys-off"); if (caps && caps.getBoundingClientRect().right > row.getBoundingClientRect().right + 0.5) out.push("caps outside: " + row.textContent); }
    const card = document.querySelector("#card").getBoundingClientRect();
    if (card.width < 600) out.push("slip narrow: " + card.width);
    return out;
  })()`;
  const list = async (name: string, css?: string) => {
    await confirmSlip.showForSnapshot(shortcutQuestion());
    const window = confirmSlip.snapshotWindow!;
    const inserted = css ? await window.webContents.insertCSS(css) : undefined;
    await wait(800);
    const found = await window.webContents.executeJavaScript(listCheck).catch((error: Error) => [`check failed: ${error.message}`]) as string[];
    console.log(`shortcuts ${name}: ${found.length ? found.join("; ") : "ok"}`);
    problems += found.length;
    await save(`shortcuts/${name}`, confirmSlip.capture());
    if (inserted) await window.webContents.removeInsertedCSS(inserted);
  };
  const pane = async (name: string, script?: string) => {
    await showDeskPane("appearance", wait);
    await inPane("settings", `document.querySelector(".note-key")?.scrollIntoView({ block: "center" })`);
    if (script) await inPane("settings", script);
    await wait(400);
    const report = await inPane("settings", layoutCheckScript(settingsPaneChecks)) as LayoutReport | string | undefined;
    const found = typeof report === "object" && report ? report.problems : [`check failed: ${String(report)}`];
    console.log(`shortcuts ${name}: ${found.length ? found.join("; ") : "ok"}`);
    problems += found.length;
    await save(`shortcuts/${name}`, captureDesk(wait));
  };
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    const tag = paper === "night" ? "-night" : "";
    store.setPref("noteHotkey", true);
    store.setPref("noteShortcut", "Control+Alt+J");
    store.setPref("drawerShortcut", "Control+Shift+D");
    await list(`shortcut-list${tag}`);
    // A short screen: the groups scroll.
    await list(`shortcut-list-scroll${tag}`, ".keys-cols { max-height: 300px !important; }");
    store.setPref("noteShortcut", "Control+Alt+K");
    store.setPref("drawerShortcut", "");
    await list(`shortcut-list-custom${tag}`);
    confirmSlip.hide();
    store.setPref("noteShortcut", "Control+Alt+J");
    store.setPref("drawerShortcut", "Control+Shift+D");
    await pane(`shortcut-settings${tag}`);
    // Listening, then Ctrl+Shift+D (the drawer's): refused, said in the group's foot.
    await pane(`shortcut-settings-refused${tag}`, `document.querySelector(".note-key .keyfield").click();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "D", code: "KeyD", ctrlKey: true, shiftKey: true, bubbles: true }))`);
    await inPane("settings", `window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }))`);
    store.setPref("noteShortcut", "Control+Alt+K");
    await pane(`shortcut-settings-custom${tag}`);
    // The narrowest pane: the desk just wide enough to keep its sidebar's names (deskSize.foldBelow).
    desk.browserWindow!.setContentSize(820, 640 + deskTitleBar);
    await pane(`shortcut-settings-custom-narrow${tag}`);
    desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
    store.setPref("noteHotkey", false);
    await pane(`shortcut-settings-off${tag}`);
    store.setPref("noteHotkey", true);
    store.setPref("noteShortcut", "Control+Alt+J");
  }
  store.setPref("paper", "day");
  return problems;
}

/** Snapshots: fictional copies in the run's temporary backup folder (never this PC's), newest first as the list shows them. */
export function seedSampleBackups(): void {
  const at = (daysAgo: number, hour: number, minute: number) => { const date = new Date(); date.setDate(date.getDate() - daysAgo); date.setHours(hour, minute, 0, 0); return date; };
  const samples: [BackupReason, Date, BackupCounts, number][] = [
    ["daily", at(0, 9, 12), { todos: 24, memos: 12, events: 6, archive: 310 }, 220],
    ["beforeImport", at(1, 21, 40), { todos: 22, memos: 12, events: 6, archive: 305 }, 216],
    ["daily", at(2, 8, 55), { todos: 19, memos: 11, events: 5, archive: 298 }, 209],
    ["beforeUpdate", at(3, 10, 2), { todos: 18, memos: 11, events: 5, archive: 290 }, 204],
    ["manual", at(5, 18, 30), { todos: 16, memos: 10, events: 4, archive: 281 }, 198],
    ["daily", at(6, 9, 4), { todos: 15, memos: 10, events: 4, archive: 276 }, 196],
    ["beforeFolderSwitch", at(7, 20, 15), { todos: 15, memos: 9, events: 4, archive: 270 }, 193],
    ["daily", at(8, 9, 30), { todos: 14, memos: 9, events: 3, archive: 262 }, 190],
  ];
  fs.mkdirSync(backups.folder, { recursive: true });
  for (const [reason, date, counts, kilobytes] of samples) {
    const text = JSON.stringify({ format: "jongi-nyang-backup", version: 1, exportedAt: date.toISOString(), from: "Windows 1.31.0", reason, counts, files: { "todos.json": JSON.stringify({ items: [] }) } }, null, 2);
    // (Spaces after the JSON stand in for the sample's size.)
    fs.writeFileSync(path.join(backups.folder, savedName(reason, date)), text.padEnd(kilobytes * 1024 - 1, " ") + "\n");
  }
  backups.refresh();
}

/** The restore question for the snapshots: the sample copy from two days ago. */
export function sampleRestoreQuestion(shared: boolean): ConfirmQuestion {
  const date = new Date(); date.setDate(date.getDate() - 2); date.setHours(8, 55, 0, 0);
  return restoreQuestion(date, { todos: 19, memos: 11, events: 5, archive: 298 }, shared);
}

/**
 * `npm run snapshot -- backups` (#139 · #140): 저장과 백업 with the sample copies — the 자동 백업 group, the list opened up,
 * the whole pane, the narrowest desk, the switch off, a shared storage folder — and the restore slip (and its shared
 * line), day and night. Returns how many layout problems it found (cut words included).
 */
/**
 * 글꼴 · 종이 설정 (#141 · #142): 꾸미기 and 메모 서랍 in full on a tall desk — the note's font popup and seven-step
 * slider, the drawer's paper tiles with 밤에는 밤 종이로, its sample memo and font rows — day and night; then 메모 서랍
 * with another paper, face and size picked. Each fails on a word cut in its tiles, rows or slider values.
 */
export async function fontShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  fs.mkdirSync(path.join(directory, "fonts"), { recursive: true });
  const cutScript = `(() => {
    const out = [];
    for (const el of document.querySelectorAll(".pt-name, .step-value, select.popup, .row .grow, .group > .label, .dfp-ln, .dfp-sub"))
      if (el.scrollWidth > el.clientWidth + 1) out.push("cut: " + el.textContent);
    return out;
  })()`;
  const pane = async (name: string, which: "appearance" | "drawer") => {
    await showDeskPane(which, wait);
    desk.browserWindow!.setContentSize(920, 1900 + deskTitleBar);
    await inPane("settings", `document.querySelector(".content").scrollTop = 0`);
    await wait(500);
    const found = await inPane("settings", cutScript) as string[] | string;
    const list = Array.isArray(found) ? found : [String(found)];
    console.log(`fonts ${name}: ${list.length ? list.join("; ") : "ok"}`);
    problems += list.length;
    await save(`fonts/${name}`, captureDesk(wait));
  };
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    await pane(`settings-appearance-${paper}`, "appearance");
    await pane(`settings-drawer-${paper}`, "drawer");
    store.setPref("drawerTheme", "hanji");
    store.setPref("drawerNightPaper", false);
    store.setPref("drawerFont", "pen");
    store.setPref("drawerTextPt", 18);
    store.setPref("drawerParagraph", "wide");
    store.setPref("textStep", 5);
    await pane(`settings-drawer-hanji-${paper}`, "drawer");
    await pane(`settings-appearance-larger-${paper}`, "appearance");
    store.setPref("drawerTheme", "auto");
    store.setPref("drawerNightPaper", true);
    store.setPref("drawerFont", "clean");
    store.setPref("drawerTextPt", 14);
    store.setPref("drawerParagraph", "regular");
    store.setPref("textStep", 2);
  }
  store.setPref("paper", "day");
  desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
  return problems;
}

export async function backupShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  fs.mkdirSync(path.join(directory, "backups"), { recursive: true });
  const cutScript = `(() => {
    const out = [];
    for (const el of document.querySelectorAll(".backup-when, .backup-chip, .backup-size, .backup-title, .backup-status .sub, .backup-counts, .backup-more, .folder-place .fp-name, .group > .label, .action"))
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) out.push("cut: " + el.textContent);
    return out;
  })()`;
  const pane = async (name: string, scroll: string) => {
    await showDeskPane("storage", wait);
    await inPane("settings", scroll);
    await wait(400);
    const report = await inPane("settings", layoutCheckScript(settingsPaneChecks)) as LayoutReport | string | undefined;
    const cut = await inPane("settings", cutScript) as string[] | string | undefined;
    const found = [...(typeof report === "object" && report ? report.problems : [`check failed: ${String(report)}`]), ...(Array.isArray(cut) ? cut : [`cut check failed: ${String(cut)}`])];
    console.log(`backups ${name}: ${found.length ? found.join("; ") : "ok"}`);
    problems += found.length;
    await save(`backups/${name}`, captureDesk(wait));
  };
  const toGroup = (index: number) => `document.querySelector(".content").scrollTop = 0; document.querySelectorAll(".content > .group")[${index}]?.scrollIntoView({ block: "start" })`;
  const slip = async (name: string, question: ConfirmQuestion) => {
    await confirmSlip.showForSnapshot(question);
    await wait(800);
    const window = confirmSlip.snapshotWindow;
    const found = window ? await window.webContents.executeJavaScript(`(() => { const out = []; for (const el of document.querySelectorAll(".slip-title, .sbtn, .slip-head *")) if (el.scrollWidth > el.clientWidth + 1) out.push("cut: " + el.textContent); return out; })()`).catch((error: Error) => [`check failed: ${error.message}`]) as string[] : ["not shown"];
    console.log(`backups ${name}: ${found.length ? found.join("; ") : "ok"}`);
    problems += found.length;
    await save(`backups/${name}`, confirmSlip.capture());
  };
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    const tag = paper === "night" ? "-night" : "";
    await pane(`storage-backups${tag}`, toGroup(2));
    await inPane("settings", `document.querySelector(".backup-more")?.click()`);
    await pane(`storage-list-open${tag}`, toGroup(3));
    await inPane("settings", `document.querySelector(".backup-more")?.click()`);
    desk.browserWindow!.setContentSize(920, 1500 + deskTitleBar);
    await pane(`storage-full${tag}`, `document.querySelector(".content").scrollTop = 0`);
    desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
    // #195: 저장 위치 at the top — its footnote says a move copies the list there and restarts.
    await pane(`storage-move${tag}`, `document.querySelector(".content").scrollTop = 0`);
    // The narrowest desk that keeps its sidebar's names (#195's footnote on it too, in the same resize).
    desk.browserWindow!.setContentSize(820, 640 + deskTitleBar);
    await pane(`storage-backups-narrow${tag}`, toGroup(2));
    await pane(`storage-move-narrow${tag}`, `document.querySelector(".content").scrollTop = 0`);
    desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
    backups.setAuto(false);
    await pane(`storage-backups-off${tag}`, toGroup(2));
    backups.setAuto(true);
    Object.assign(store.storage, { custom: true, label: t("공유 폴더"), path: "C:\\Users\\sample\\OneDrive\\종이냥", archivePath: "C:\\Users\\sample\\OneDrive\\종이냥\\archive" }); // i18n-ok: a folder name
    backups.refresh();
    await pane(`storage-shared${tag}`, toGroup(2));
    await slip(`confirm-restore-shared${tag}`, sampleRestoreQuestion(true));
    Object.assign(store.storage, { custom: false, label: t("이 PC (기본)"), path: "C:\\Users\\sample\\AppData\\Roaming\\PaperTodo", archivePath: "C:\\Users\\sample\\AppData\\Roaming\\PaperTodo\\archive" });
    backups.refresh();
    await slip(`confirm-restore${tag}`, sampleRestoreQuestion(false));
    confirmSlip.hide();
    // #195: the toast the restarted app shows once (the sample folder's name), in the note as it is (nothing resized).
    note.webContents.send("note:notice", { icon: "folder", text: storageMovedText({ folder: t("종이냥"), kept: "moved" }) });
    await wait(700);
    await save(`backups/storage-moved-toast${tag}`, note.webContents.capturePage());
  }
  store.setPref("paper", "day");
  return problems;
}
