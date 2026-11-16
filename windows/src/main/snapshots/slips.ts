import fs from "node:fs";
import path from "node:path";
import { BrowserWindow } from "electron";
import { lang, t } from "../../i18n";
import { dateKey, localDate, weekDays } from "../../core/calendar";
import { deskTitleBar } from "../../core/desk";
import { type EventColor, type LocalEvent } from "../../core/events";
import { type WidgetKind, type WidgetStyle, widget as makeWidget, scaleFits, widgetScales } from "../../core/calendarWidget";
import { addSpace } from "../../core/todoSpaces";
import { type ConfirmQuestion } from "../confirm";
import { calendar, confirmSlip, desk, drawer, note, openCalendar, quick, quickMemo, store, widgetSheet, widgets } from "../main";
import { type Save, type Wait } from "./index";
import { sampleRestoreQuestion } from "./settings";
import { captureDesk, confirmQuestions, inPane, settledScript, showDeskPane } from "./desk";

/**
 * #408: snapshots of the slips, the desktop calendar widgets and calendar reminders (`npm run snapshot -- slips` ·
 * `widgets` · `reminders`), moved out of main.ts as they were. Test runs only (see snapshots/design.ts).
 */

/**
 * #228 · #229 (shared/cases/slip-move-cases.json), off-screen: the question slip follows a drag on its title row but not one
 * that starts on its button; while it waits, presses on the note reach none of the note's own handlers and nudge it (one
 * each); answered, the note takes them again. The times slip moves about the 스페이스 pane by its paper, holds nothing
 * up (the next row's popup opens beside it), a space has one, and Esc closes the one with the focus. Prints
 * `slips <check>: ok` or what went wrong, and saves the question moved and two times slips.
 */
export async function slipShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  const report = (name: string, wrong: string[]) => {
    console.log(`slips ${name}: ${wrong.length ? wrong.join("; ") : "ok"}`);
    problems += wrong.length;
  };
  fs.mkdirSync(path.join(directory, "slips"), { recursive: true });
  const press = async (contents: Electron.WebContents, x: number, y: number, to = { x, y }, button: "left" | "right" = "left") => {
    contents.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: 1 });
    await wait(60);
    if (to.x !== x || to.y !== y) {
      contents.sendInputEvent({ type: "mouseMove", x: to.x, y: to.y, button, modifiers: [button === "left" ? "leftbuttondown" : "rightbuttondown"] });
      await wait(250);
    }
    contents.sendInputEvent({ type: "mouseUp", x: to.x, y: to.y, button, clickCount: 1 });
    await wait(250);
  };
  // The question: 저장 폴더's, asked over the note.
  const question = confirmQuestions().find(([name]) => name === "confirm-storage")?.[1] ?? confirmQuestions()[0][1];
  const answered = confirmSlip.ask(note, question);
  await wait(900);
  const slip = confirmSlip.snapshotWindow;
  if (!slip) { report("question", ["no question window"]); return problems; }
  // Pointer events as the page gets them, at the window's own place on the (off-screen) desktop: input sent to a window
  // that isn't key would make the system bring it onto a display first.
  const dragOn = async (selector: string, dx: number, dy: number) => {
    const { x, y } = slip.getBounds();
    const found = await slip.webContents.executeJavaScript(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) return false;
      const r = target.getBoundingClientRect(), cx = r.left + Math.min(12, r.width / 2), cy = r.top + r.height / 2;
      const at = (type, mx, my) => new PointerEvent(type, { bubbles: true, button: 0, buttons: 1, pointerId: 9, clientX: cx + mx, clientY: cy + my, screenX: ${x} + cx + mx, screenY: ${y} + cy + my });
      target.dispatchEvent(at("pointerdown", 0, 0));
      window.dispatchEvent(at("pointermove", ${dx}, ${dy}));
      return true;
    })()`) as boolean;
    await wait(250);
    await slip.webContents.executeJavaScript(`window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 9 })); 0`);
    await wait(150);
    return found;
  };
  const before = slip.getBounds();
  const wrong: string[] = [];
  if (!await dragOn(".sbtn.primary", 40, 30)) wrong.push("no button on the slip");
  const still = slip.getBounds();
  if (still.x !== before.x || still.y !== before.y) wrong.push(`a drag from the button moved it (${still.x - before.x}, ${still.y - before.y})`);
  if (!await dragOn(".slip-heading", 30, 20)) wrong.push("no title on the slip");
  const moved = slip.getBounds();
  if (moved.x - before.x !== 30 || moved.y - before.y !== 20) wrong.push(`the title row's drag moved it by (${moved.x - before.x}, ${moved.y - before.y}), not (30, 20)`);
  report("question drag", wrong);
  await save("slips/question-moved", confirmSlip.capture());
  // Held: the note's handlers count what reaches them.
  await note.webContents.executeJavaScript(`window.__reached = 0; for (const type of ["pointerdown", "mousedown", "click", "contextmenu"]) document.addEventListener(type, () => { window.__reached += 1; }, true); 0`);
  const held: string[] = [];
  await press(note.webContents, 200, 300);
  await press(note.webContents, 200, 300, { x: 200, y: 300 }, "right");
  const reached = await note.webContents.executeJavaScript("window.__reached") as number;
  const shown = await slip.webContents.executeJavaScript(`document.getElementById("stage").dataset.nudges ?? "0"`) as string;
  if (reached !== 0) held.push(`the note's handlers heard ${reached} events`);
  if (confirmSlip.nudges !== 2) held.push(`${confirmSlip.nudges} nudges for 2 presses`);
  if (shown !== "2") held.push(`the question shook ${shown} times`);
  report("held presses", held);
  // Answered (Esc): the note works again.
  await slip.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); 0`);
  const answer = await Promise.race([answered, wait(1500).then(() => -1)]);
  await press(note.webContents, 200, 300);
  const after = await note.webContents.executeJavaScript("window.__reached") as number;
  report("answered", [...(answer === question.cancelId ? [] : [`answer ${String(answer)}`]), ...(after > 0 ? [] : ["the note still held up"])]);

  // The times slip in 설정 → 스페이스.
  const ids = { work: "s-m1a2b3", home: "s-m4c5d6", study: "s-m7e8f9" };
  store.changeSpaces((data) => addSpace(addSpace(addSpace(data, t("회사"), ids.work, "pink"), t("집"), ids.home, "mint"), t("공부"), ids.study, "sky"));
  await showDeskPane("spaces", wait);
  await wait(300);
  const open = async (id: string) => {
    await inPane("settings", `document.querySelector('.space-row[data-id="${id}"] .space-device').click()`);
    await wait(200);
    await inPane("settings", `(() => { const rows = [...document.querySelectorAll(".menu .mi")]; rows[rows.length - 1]?.click(); })()`);
    await wait(350);
  };
  const count = () => inPane("settings", `document.querySelectorAll(".device-slip").length`) as Promise<number>;
  const times: string[] = [];
  await open(ids.work);
  await open(ids.work);
  if (await count() !== 1) times.push(`asked twice for the first space: ${await count()} slips`);
  await open(ids.home);
  if (await count() !== 2) times.push(`two spaces: ${await count()} slips`);
  if (await inPane("settings", `document.querySelectorAll(".device-scrim").length`) !== 0) times.push("a scrim holds the pane up");
  // Dragged by its title row (pointer events as the page gets them), the second slip goes 40 left and 30 down.
  const dragged = await inPane("settings", `(() => {
    const slips = document.querySelectorAll(".device-slip"), slip = slips[slips.length - 1], head = slip.querySelector(".slip-heading");
    const from = slip.getBoundingClientRect(), r = head.getBoundingClientRect(), x = r.left + 10, y = r.top + r.height / 2;
    const at = (type, dx, dy) => new PointerEvent(type, { bubbles: true, button: 0, buttons: 1, pointerId: 7, clientX: x + dx, clientY: y + dy, screenX: x + dx, screenY: y + dy });
    head.dispatchEvent(at("pointerdown", 0, 0));
    window.dispatchEvent(at("pointermove", -40, 30));
    window.dispatchEvent(at("pointerup", -40, 30));
    const to = slip.getBoundingClientRect();
    return [Math.round(to.left - from.left), Math.round(to.top - from.top)];
  })()`) as [number, number];
  if (!Array.isArray(dragged) || dragged[0] !== -40 || dragged[1] !== 30) times.push(`the drag moved it by ${JSON.stringify(dragged)}, not [-40, 30]`);
  // The pane works beside the slips: the third space's popup opens.
  await inPane("settings", `document.querySelector('.space-row[data-id="${ids.study}"] .space-device').click()`);
  await wait(200);
  if (await inPane("settings", `document.querySelectorAll(".menu .mi").length`) === 0) times.push("the third space's popup didn't open beside the slips");
  await inPane("settings", `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await wait(150);
  await save("slips/times-two", captureDesk(wait));
  // Esc closes the slip with the focus only.
  await inPane("settings", `document.querySelector(".device-slip .device-presets .chip")?.focus(); document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await wait(150);
  if (await count() !== 1) times.push(`Esc in one slip left ${await count()}`);
  await inPane("settings", `document.querySelector(".device-slip .slip-x")?.click()`);
  await wait(150);
  if (await count() !== 0) times.push(`× left ${await count()} slips`);
  report("times slips", times);

  // #246: 빠른 입력 and 빠른 메모 move by their title row (not by their field), keeping what is typed and the caret.
  for (const [name, show, owner, typed] of [
    ["quick entry", () => quick.showForSnapshot(t("내일 3시 회의")), () => quick.snapshotWindow, "textarea.typed"],
    ["quick memo", () => quickMemo.showForSnapshot(t("장보기")), () => quickMemo.snapshotWindow, "textarea.ruled"],
  ] as const) {
    await show();
    await wait(900);
    const window = owner();
    const kept: string[] = [];
    if (!window) { report(`${name} drag`, ["no window"]); continue; }
    await window.webContents.executeJavaScript(`(() => { const f = document.querySelector(${JSON.stringify(typed)}); f.focus(); f.setSelectionRange(2, 2); return 0; })()`);
    const drag = async (selector: string, dx: number, dy: number) => {
      const { x, y } = window.getBounds();
      const found = await window.webContents.executeJavaScript(`(() => {
        const target = document.querySelector(${JSON.stringify(selector)});
        if (!target) return false;
        const r = target.getBoundingClientRect(), cx = r.left + Math.min(12, r.width / 2), cy = r.top + r.height / 2;
        const at = (type, mx, my) => new PointerEvent(type, { bubbles: true, button: 0, buttons: 1, pointerId: 11, clientX: cx + mx, clientY: cy + my, screenX: ${x} + cx + mx, screenY: ${y} + cy + my });
        target.dispatchEvent(at("pointerdown", 0, 0));
        window.dispatchEvent(at("pointermove", ${dx}, ${dy}));
        return true;
      })()`) as boolean;
      await wait(250);
      await window.webContents.executeJavaScript(`window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 11 })); 0`);
      await wait(150);
      return found;
    };
    const before = window.getBounds();
    if (!await drag(typed, 40, 30)) kept.push("no field");
    const still = window.getBounds();
    if (still.x !== before.x || still.y !== before.y) kept.push(`a drag from the field moved it (${still.x - before.x}, ${still.y - before.y})`);
    if (!await drag(".slip-heading", 30, 20)) kept.push("no title row");
    const moved = window.getBounds();
    if (moved.x - before.x !== 30 || moved.y - before.y !== 20) kept.push(`the title row's drag moved it by (${moved.x - before.x}, ${moved.y - before.y}), not (30, 20)`);
    const field = await window.webContents.executeJavaScript(`(() => { const f = document.querySelector(${JSON.stringify(typed)}); return [f.value, document.activeElement === f, f.selectionStart]; })()`) as [string, boolean, number];
    if (!field[1] || field[2] !== 2) kept.push(`after the drag the field ${field[1] ? "" : "lost the focus "}has its caret at ${field[2]}, not 2`);
    if (!field[0]) kept.push("what was typed is gone");
    report(`${name} drag`, kept);
    if (name === "quick entry") quick.hide(); else quickMemo.hide();
  }
  return problems;
}

/**
 * 달력의 알림 할 일 (#227): to-dos with a reminder over the month (three today, one due the same day as its reminder, one
 * finished) — a bell and the title in the cells after the events and deadlines, "+N" when they don't fit, their time in
 * the week. Checks that no cell spills and no title is cut without its ellipsis.
 */
/**
 * 바탕화면 달력 위젯 (#234): each kind over a sample wallpaper (day: light and busy; night: dark and busy) at 100 % and
 * 40 %, one hovered, the day sheet with a line typed in, and 책상 → 일정 with the gallery and a widget's settings slip.
 * The widgets' windows are never shown (they paint hidden). Each shot is checked for cut text and for a Korean word
 * broken across lines.
 */
export async function widgetShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  fs.mkdirSync(path.join(directory, "widgets", "night"), { recursive: true });
  calendar.showSample();
  // calendar-flows: in October 2026, a three-day trip (Sun–Tue), a weekend one across two week rows (Fri–Sun) and a long
  // title in a cell with room — the bands joining and a title on two lines (sample data only).
  const flowStamp = new Date().toISOString();
  const flowEvent = (id: string, title: string, date: string, allDay: boolean, days: number, color: EventColor): LocalEvent => ({
    id, title, date, allDay, days, start: allDay ? 540 : 600, end: allDay ? 600 : 660, repeat: "none", skip: [], color, createdAt: flowStamp, updatedAt: flowStamp,
  });
  store.replaceEvents([...store.events, flowEvent("FLOWS-0001", t("제주 여행"), "2026-10-18", true, 3, "sage"),
    flowEvent("FLOWS-0002", t("가을 캠핑"), "2026-10-30", true, 3, "yellow"), flowEvent("FLOWS-0003", t("치과 정기 검진 예약"), "2026-10-14", false, 1, "blue"),
    // #260: February 2027 (설날 and its 대체공휴일) with a band through two of its holidays — their names keep one line there.
    flowEvent("FLOWS-0004", t("할머니 댁"), "2027-02-08", true, 2, "purple")]);
  const at = (days: number, hour: number, minute = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(hour, minute, 0, 0);
    return date;
  };
  const made: string[] = [];
  store.mutate((history) => {
    const add = (title: string, when: Date | undefined, due?: Date) => {
      const item = history.addTo(title, undefined, new Date(), due ? dateKey(due) : undefined, when?.toISOString());
      if (item) made.push(item.id);
    };
    add(t("치과 예약"), at(0, 23, 30));
    add(t("장보기"), undefined, at(0, 12));
    add(t("도서관 책 반납"), at(1, 11));
    add(t("보고서 초안"), undefined, at(3, 12));
    add(t("팀 회의 자료 보내기"), undefined, at(5, 12));
  });
  const check = `(() => {
    const out = [];
    const inner = document.querySelector(".wg .in");
    if (inner && inner.scrollHeight > inner.clientHeight + 1) out.push("overflow " + (inner.scrollHeight - inner.clientHeight) + "px");
    // (+N's button is wider to click than it looks: its hit area isn't text.)
    for (const el of document.querySelectorAll(".tt, .t, .tm, .w, .n, .sh, .empty, .m")) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow !== "ellipsis" && el.clientWidth > 0) out.push("cut: " + el.textContent);
    }
    // #295: nothing in a month tile's head is cut (the lunar date, +N, #296 the repeat mark).
    for (const head of document.querySelectorAll(".cl .head")) if (head.scrollWidth > head.clientWidth + 1) out.push("head cut " + head.parentElement.dataset.day);
    // A Korean word split across two lines.
    const range = document.createRange();
    // (The today widget's month and weekday are two lines on purpose.)
    for (const el of document.querySelectorAll(".empty, .sh, .wtoast .tx, .hd .t")) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node; let lastTop; let prev = "";
      while ((node = walker.nextNode())) for (let i = 0; i < node.length; i++) {
        range.setStart(node, i); range.setEnd(node, i + 1); const rect = range.getClientRects()[0]; const ch = node.data[i];
        if (!rect || !rect.width || /\s/.test(ch)) { prev = ch; continue; }
        const top = Math.round(rect.top);
        if (lastTop !== undefined && Math.abs(top - lastTop) > 4 && /[\\uac00-\\ud7a3]/.test(prev) && /[\\uac00-\\ud7a3]/.test(ch)) out.push("split: " + el.textContent);
        lastTop = top; prev = ch;
      }
    }
    return out.length ? out.join("; ") : "ok · " + document.querySelectorAll(".ln, .cl, .c, .r").length + " cells";
  })()`;
  const kinds: { kind: WidgetKind; style: WidgetStyle }[] = [
    { kind: "today", style: "simple" }, { kind: "week", style: "simple" }, { kind: "week", style: "detail" },
    { kind: "month", style: "simple" }, { kind: "month", style: "detail" }, { kind: "month", style: "wall" }, { kind: "agenda", style: "simple" },
  ];
  // #234: the week and the month on October 2026 (개천절, its 대체공휴일 and 한글날, and the lunar dates), whatever today is.
  const holidayDay = "2026-10-05";
  const pageTo = (kind: WidgetKind) => {
    const now = new Date();
    if (kind === "month") return (2026 * 12 + 9) - (now.getFullYear() * 12 + now.getMonth());
    if (kind !== "week") return 0;
    const weekStart = (key: string) => localDate(weekDays(key, lang())[0])?.getTime() ?? 0;
    return Math.round((weekStart(holidayDay) - weekStart(dateKey(now))) / (7 * 86_400_000));
  };
  let offsetNow = 0;
  const shot = async (name: string, wall: string, hover = false) => {
    for (let tries = 0; tries < 50 && !widgets.isReady("snap"); tries += 1) await wait(100);
    const window = widgets.preview("snap", { wall, hover, offset: offsetNow });
    if (!window) { console.log(`widgets ${name}: NO WINDOW`); problems += 1; return; }
    await wait(450);
    const found = String(await window.webContents.executeJavaScript(check).catch((error: Error) => `script failed: ${error.message}`));
    console.log(`widgets ${name}: ${found}`);
    if (!found.startsWith("ok")) problems += 1;
    await save(`widgets/${name}`, window.webContents.capturePage());
  };
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "night/" : "";
    store.setPref("paper", paper);
    for (const { kind, style } of kinds) {
      for (const opacity of [100, 40]) {
        store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind, style, opacity, place: { display: "0", x: 1, y: 0 } })]);
        widgets.sync();
        offsetNow = pageTo(kind);
        for (const wall of paper === "day" ? ["light", "busy"] : ["dark", "busy"]) {
          if (opacity === 100 && wall === "busy") continue;
          await shot(`${prefix}${kind}-${style}-${opacity}-${wall}`, wall);
        }
      }
    }
    // 크기 (#271): every kind at 작게 · 크게 · 아주 크게 (보통 is above) — the same lines in each cell, nothing cut — and the
    // month at 아주 크게 and 40 % over the busy wallpaper (the floors hold at any size).
    for (const [scale, word] of [[0.85, "small"], [1.25, "large"], [1.5, "xlarge"]] as const) {
      for (const { kind, style } of kinds) {
        store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind, style, scale, place: { display: "0", x: 1, y: 0 } })]);
        widgets.sync();
        offsetNow = pageTo(kind);
        await shot(`${prefix}${kind}-${style}-size-${word}`, paper === "day" ? "light" : "dark");
      }
    }
    // #296: this month with two daily repeats and a weekday one — folded into each tile's head, no dot in 간단히; #295: today
    // busy (+N beside its lunar date).
    const itemsBefore = new Set(store.items.map((item) => item.id));
    const crowd = [
      store.saveSeries({ title: t("물 마시기"), rule: { kind: "daily" } }),
      store.saveSeries({ title: t("스트레칭"), rule: { kind: "daily" } }),
      store.saveSeries({ title: t("아침 운동"), rule: { kind: "weekdays" }, remindAt: "07:30" }),
    ].filter((id): id is string => Boolean(id));
    store.mutate((history) => {
      for (const [title, hour] of [[t("빨래 개기"), 20], [t("화분 물 주기"), 21], [t("엄마한테 전화하기"), 22]] as const) history.addTo(title, undefined, new Date(), undefined, at(0, hour).toISOString());
    });
    for (const style of ["simple", "detail", "wall"] as const) {
      for (const scale of style === "detail" ? [1, 0.85] : [1]) {
        store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind: "month", style, scale, place: { display: "0", x: 1, y: 0 } })]);
        widgets.sync();
        offsetNow = 0;
        await shot(`${prefix}month-${style}-repeats${scale === 1 ? "" : "-small"}`, paper === "day" ? "light" : "dark");
      }
    }
    for (const id of crowd) store.deleteSeries(id);
    // The busy day's to-dos and today's copies.
    const added = store.items.filter((item) => !itemsBefore.has(item.id)).map((item) => item.id);
    store.mutate((history) => { for (const id of added) history.delete(id); });
    store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind: "month", style: "detail", opacity: 40, scale: 1.5, place: { display: "0", x: 1, y: 0 } })]);
    widgets.sync();
    offsetNow = pageTo("month");
    await shot(`${prefix}month-detail-size-xlarge-40-busy`, "busy");
    // Hovered: solid, with ‹ 오늘 ›.
    store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind: "month", style: "detail", opacity: 40, place: { display: "0", x: 1, y: 0 } })]);
    widgets.sync();
    offsetNow = pageTo("month");
    await shot(`${prefix}month-detail-40-hover`, "busy", true);
    offsetNow = 0;
    // The day sheet beside it, a line typed in (read on that day).
    const sheet = await widgetSheet.showForSnapshot("snap", dateKey(at(2, 12)), t("3시 팀 회의"));
    await wait(700);
    await save(`widgets/${prefix}sheet`, sheet.webContents.capturePage());
    const busy = await widgetSheet.showForSnapshot("snap", dateKey(new Date()), "");
    await wait(500);
    await save(`widgets/${prefix}sheet-today`, busy.webContents.capturePage());
    // 책상 → 일정: the widgets' rows, then the gallery and a widget's settings slip.
    store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind: "month", style: "simple", place: { display: "0", x: 1, y: 0 } }), makeWidget({ id: "snap2", kind: "today", style: "simple", opacity: 70, clickThrough: true, place: { display: "0", x: 1, y: 1 } })]);
    widgets.sync();
    await showDeskPane("events", wait);
    await wait(500);
    await save(`widgets/${prefix}desk`, captureDesk(wait));
    await inPane("settings", `[...document.querySelectorAll(".action.small")].find((button) => button.querySelector(".icon") && button.closest(".group"))?.click()`);
    await wait(500);
    await save(`widgets/${prefix}gallery`, captureDesk(wait));
    await inPane("settings", `document.querySelector(".device-scrim")?.click()`);
    await wait(300);
    await inPane("settings", `document.querySelector(".widget-row .action.small")?.click()`);
    await wait(500);
    await save(`widgets/${prefix}settings`, captureDesk(wait));
    await inPane("settings", `document.querySelector(".device-scrim")?.click()`);
    await wait(300);
    // #271: 벽 달력 on a 1280×800 display — 크게 · 아주 크게 don't fit there and are greyed out.
    store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind: "month", style: "wall", place: { display: "0", x: 1, y: 0 } })]);
    widgets.sync();
    store.widgetFits = { snap: widgetScales.filter((scale) => scaleFits("month", "wall", scale, { x: 0, y: 0, width: 1280, height: 752 })) };
    store.changed();
    await wait(500);
    await inPane("settings", `document.querySelector(".widget-row .action.small")?.click()`);
    await wait(500);
    await save(`widgets/${prefix}settings-small-screen`, captureDesk(wait));
    await inPane("settings", `document.querySelector(".device-scrim")?.click()`);
    await wait(300);
    // The desk's 달력 on October 2026: holidays and lunar dates in the month and in the week.
    await showDeskPane("calendar", wait);
    desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
    openCalendar(holidayDay);
    await inPane("calendar", `document.querySelectorAll(".view-seg button")[1]?.click()`);
    await wait(500);
    await save(`widgets/${prefix}desk-calendar-month`, captureDesk(wait));
    // #260: February 2027 — 설날's three days and its 대체공휴일 (the long names on two lines where a cell has room).
    openCalendar("2027-02-08");
    await wait(500);
    await save(`widgets/${prefix}desk-calendar-seollal`, captureDesk(wait));
    openCalendar(holidayDay);
    await wait(300);
    await inPane("calendar", `document.querySelector(".view-seg button")?.click()`);
    await wait(500);
    await save(`widgets/${prefix}desk-calendar-week`, captureDesk(wait));
    await inPane("calendar", `document.querySelectorAll(".view-seg button")[1]?.click()`);
    // calendar-flows: a holiday's day sheet (its name first), and an event pressed on a widget — the desk's calendar on
    // its day with its sheet open (D3).
    const holidaySheet = await widgetSheet.showForSnapshot("snap", "2026-10-09", "");
    await wait(500);
    await save(`widgets/${prefix}sheet-holiday`, holidaySheet.webContents.capturePage());
    widgetSheet.hide();
    openCalendar("2026-10-18", "local/FLOWS-0001@2026-10-18");
    await wait(700);
    const opened = String(await inPane("calendar", `(() => { const sheet = document.querySelector(".event-sheet"); const field = sheet?.querySelector("input, textarea, [contenteditable]"); return sheet ? "sheet " + (field?.value ?? field?.textContent ?? "") + " · " + (document.querySelector(".cell.selected")?.dataset.day ?? "none") : "NO SHEET"; })()`));
    console.log(`widgets ${prefix}event-pressed: ${opened}`);
    if (!opened.startsWith("sheet")) problems += 1;
    await save(`widgets/${prefix}desk-calendar-event`, captureDesk(wait));
    await inPane("calendar", `document.querySelector(".event-sheet")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await wait(300);
  }
  problems += await widgetAskShots(save, wait);
  store.setPref("calendarWidgets", []);
  widgets.sync();
  store.mutate((history) => { for (const id of made) history.delete(id); });
  store.setPref("paper", "day");
  return problems;
}

/**
 * #253 (shared/cases/widget-ask-cases.json), off-screen, the widget kept on top: what is being typed in the memo drawer, the
 * quick entry and the quick memo keeps its text and caret while the widget is pressed (T1–T3). While a question waits,
 * the widget turns its months and the day sheet its days (W1 · W4), the sheet puts in and the toast takes back (W5 · W6),
 * a window coming forward under the question doesn't nudge it (O1), and the question floats over the widget (Z1). The
 * questions are asked over no window (see below). While a question that replaces the whole list waits, 넣기 dims and says why, and
 * Enter in the sheet and the toast's 되돌리기 nudge the question instead (L5 · L6), the text kept. Prints
 * `widgets asked <check>: ok` or what went wrong, and saves the waiting sheet.
 */
async function widgetAskShots(save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  const report = (name: string, wrong: string[]) => {
    console.log(`widgets asked ${name}: ${wrong.length ? wrong.join("; ") : "ok"}`);
    problems += wrong.length;
  };
  const run = (window: BrowserWindow | undefined, script: string) => (window ? window.webContents.executeJavaScript(script).catch((error: Error) => `script failed: ${error.message}`) : Promise.resolve("no window"));
  store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind: "month", style: "simple", level: "top", place: { display: "0", x: 1, y: 0 } })]);
  widgets.sync();
  for (let tries = 0; tries < 50 && !widgets.isReady("snap"); tries += 1) await wait(100);
  const widget = widgets.windowOf("snap");
  if (!widget) { report("widget", ["no widget window"]); return problems; }
  await wait(400);
  const title = () => run(widget, `document.querySelector(".hd .t")?.textContent ?? ""`) as Promise<string>;
  const nextMonth = () => run(widget, `[...document.querySelectorAll(".nav button")].at(-1)?.click(); 0`);
  const backToday = () => run(widget, `document.querySelector(".nav .td")?.click(); 0`);

  // T1–T3: a line typed with the caret inside it; the widget pressed; the text and the caret where they were.
  const typing: string[] = [];
  await quick.showForSnapshot("");
  await quickMemo.showForSnapshot("");
  const drawerWindow = await drawer.showForSnapshot();
  await wait(500);
  const fields: [string, BrowserWindow | undefined, string][] = [
    ["drawer", drawerWindow, `document.querySelector("textarea[aria-label]")`],
    ["quick", quick.snapshotWindow, `document.querySelector("textarea.typed")`],
    ["quickMemo", quickMemo.snapshotWindow, `document.querySelector("textarea.ruled")`],
  ];
  for (const [name, window, field] of fields) {
    const typed = await run(window, `(() => { const f = ${field}; if (!f) return "no field"; f.focus(); f.value = ${JSON.stringify(t("겨울옷 정리하기"))}; f.setSelectionRange(3, 3); return "ok"; })()`);
    if (typed !== "ok") typing.push(`${name}: ${String(typed)}`);
  }
  const before = await title();
  await nextMonth();
  await wait(200);
  if (await title() === before) typing.push("the widget didn't turn its month");
  await backToday();
  for (const [name, window, field] of fields) {
    const kept = await run(window, `(() => { const f = ${field}; return f && f.value === ${JSON.stringify(t("겨울옷 정리하기"))} && f.selectionStart === 3 && f.selectionEnd === 3 && document.activeElement === f ? "ok" : "moved"; })()`);
    if (kept !== "ok") typing.push(`${name}: the text or the caret ${String(kept)}`);
  }
  await run(drawerWindow, `(() => { const f = document.querySelector("textarea[aria-label]"); if (f) { f.value = ""; f.blur(); } return 0; })()`);
  quick.hide();
  quickMemo.hide();
  drawer.hideForSnapshot();
  report("typing", typing);

  // A question (집중을 그만둘까요?) over the note: the widget and the sheet work.
  const plain: ConfirmQuestion = { icon: "timer", title: t("집중"), message: t("집중을 그만둘까요?"), buttons: [{ label: t("계속하기"), kind: "ghost" }, { label: t("그만두기"), kind: "primary" }], cancelId: 0 };
  const answer = async (asked: Promise<number>) => {
    await run(confirmSlip.snapshotWindow, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); 0`);
    await Promise.race([asked, wait(1500)]);
    await wait(200);
  };
  const day = dateKey(new Date(Date.now() + 2 * 86_400_000));
  const titled = (text: string) => store.items.find((item) => item.title === text);
  const flower = t("택배 받기"), post = t("운동 가기");
  const put = async (sheet: BrowserWindow, text: string) => {
    await run(sheet, `(() => { const f = document.querySelector("textarea.typed"); f.value = ${JSON.stringify(text)}; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return 0; })()`);
    await wait(500);
  };
  const toastUndo = () => run(widget, `(() => { const b = document.querySelector(".wtoast button"); if (!b) return "no toast"; b.click(); return "ok"; })()`);
  const works: string[] = [];
  // Asked over no window: an off-screen run's windows have no owner on a Mac (offscreenGuard.ts, #250), so there is no
  // window it was asked over to check, and the widget's rules don't need one (O2 is the shared cases').
  let asked = confirmSlip.ask(undefined, plain);
  await wait(900);
  if (confirmSlip.up !== "question") works.push(`up: ${confirmSlip.up}`);
  if (!confirmSlip.floating) works.push("the question isn't over the widget kept on top");
  const shown = await title();
  await nextMonth();
  await wait(200);
  if (await title() === shown) works.push("‹ › held up");
  await backToday();
  let sheet = await widgetSheet.showForSnapshot("snap", day, "");
  await wait(400);
  const sheetTitle = () => run(sheet, `document.querySelector(".slip-title")?.textContent ?? ""`) as Promise<string>;
  const dayShown = await sheetTitle();
  await run(sheet, `document.querySelectorAll(".day-nav button")[1]?.click(); 0`);
  await wait(200);
  if (await sheetTitle() === dayShown) works.push("the sheet's next day held up");
  await run(sheet, `document.querySelectorAll(".day-nav button")[0]?.click(); 0`);
  await wait(200);
  await put(sheet, flower);
  if (!titled(flower)) works.push("put in held up");
  if (String(await toastUndo()) !== "ok") works.push("no toast after putting in");
  await wait(400);
  if (titled(flower)) works.push("taking back held up");
  // O1: a window coming forward under the question doesn't nudge it (O2, the window it was asked over, is the shared
  // cases' — told directly: opening the note focuses it, and a focused window in an off-screen run is pulled onto a screen).
  const nudged = confirmSlip.nudges;
  await put(sheet, flower);
  confirmSlip.cameForward(note);
  await wait(300);
  if (confirmSlip.nudges !== nudged) works.push("a window coming forward nudged the question");
  if (confirmSlip.up !== "question" || !confirmSlip.floating) works.push("the question isn't over everything after another window came");
  await answer(asked);
  if (confirmSlip.floating) works.push("still floating after the answer");
  report("question", works);

  // A question that replaces the whole list (되돌리기): the sheet and the toast wait, the text stays.
  const waits: string[] = [];
  asked = confirmSlip.ask(undefined, sampleRestoreQuestion(false));
  await wait(700);
  if (confirmSlip.up !== "replacesList") waits.push(`up: ${confirmSlip.up}`);
  const before2 = confirmSlip.nudges;
  if (String(await toastUndo()) !== "ok") waits.push("the toast went before the check");
  await wait(300);
  if (!titled(flower)) waits.push("taking back went through");
  if (confirmSlip.nudges !== before2 + 1) waits.push(`taking back: ${confirmSlip.nudges - before2} nudges, not 1`);
  const turned = await title();
  await nextMonth();
  await wait(200);
  if (await title() === turned) waits.push("‹ › held up");
  await backToday();
  sheet = await widgetSheet.showForSnapshot("snap", day, "");
  await wait(400);
  const why = t("질문에 답하면 넣을 수 있어요");
  const dim = await run(sheet, `(() => { const k = document.querySelector(".keys .waiting"); const f = document.querySelector("textarea.typed"); return k && k.title === ${JSON.stringify(why)} && f.getAttribute("aria-description") === ${JSON.stringify(why)} ? "ok" : "not dimmed"; })()`);
  if (dim !== "ok") waits.push(`the put-in key ${String(dim)}`);
  await put(sheet, post);
  if (titled(post)) waits.push("put in went through");
  if (confirmSlip.nudges !== before2 + 2) waits.push(`Enter: ${confirmSlip.nudges - before2 - 1} nudges, not 1`);
  const kept = await run(sheet, `document.querySelector("textarea.typed")?.value ?? ""`);
  if (kept !== post) waits.push(`the text became “${String(kept)}”`);
  const shook = await run(confirmSlip.snapshotWindow, `document.getElementById("stage").dataset.nudges ?? "0"`);
  if (Number(shook) < 2) waits.push(`the question shook ${String(shook)} times`);
  await save("widgets/sheet-waiting", sheet.webContents.capturePage());
  await answer(asked);
  const free = await run(sheet, `document.querySelector(".keys .waiting") ? "dimmed" : "ok"`);
  if (free !== "ok") waits.push("the put-in key still dimmed after the answer");
  report("replaces the list", waits);
  await run(sheet, `(() => { const f = document.querySelector("textarea.typed"); f.value = ""; f.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()`);
  store.mutate((history) => { for (const one of store.items.filter((entry) => entry.title === flower || entry.title === post)) history.delete(one.id); });
  return problems;
}

export async function calendarReminderShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  fs.mkdirSync(path.join(directory, "reminders", "night"), { recursive: true });
  const at = (days: number, hour: number, minute = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(hour, minute, 0, 0);
    return date;
  };
  const made: string[] = [];
  store.mutate((history) => {
    const add = (title: string, when: Date, due = false, done = false) => {
      const item = history.addTo(title, undefined, new Date(), due ? dateKey(when) : undefined, when.toISOString());
      if (!item) return;
      made.push(item.id);
      if (done) history.toggle(item.id);
    };
    add(t("치과 예약"), at(0, 15));
    add(t("엄마한테 전화하기"), at(0, 19, 30));
    add(t("약 먹기"), at(0, 21));
    add(t("택배 받기"), at(1, 10));
    add(t("보고서 보내기"), at(3, 9, 30), true);
    add(t("운동 가기"), at(3, 18));
    add(t("도서관 책 반납"), at(-2, 11));
    add(t("빨래 개기"), at(4, 8), false, true);
  });
  const check = `(() => {
    const out = [];
    for (const cell of document.querySelectorAll(".cell, .day-row")) if (cell.scrollHeight > cell.clientHeight + 1) out.push("overflow " + cell.dataset.day);
    for (const t of document.querySelectorAll(".item .t, .line .t")) if (t.scrollWidth > t.clientWidth + 1 && getComputedStyle(t).textOverflow !== "ellipsis") out.push("cut: " + t.textContent);
    // #295: nothing in a cell's head is cut (the lunar date, +N, #296 the repeat mark).
    for (const head of document.querySelectorAll(".cell-head")) if (head.scrollWidth > head.clientWidth + 1) out.push("head cut " + head.parentElement.dataset.day);
    const bells = document.querySelectorAll(".item.reminder, .dot.reminder, .line.task.reminder").length;
    // #295 · #296: today's head (the lunar date, +N), the cells' repeat marks and the repeat lines still written.
    const today = document.querySelector(".cell.today .cell-head");
    const head = today ? [...today.children].filter((el) => !el.hidden).map((el) => el.textContent).join(" ") : "";
    return (out.length ? out.join("; ") : "ok · " + bells + " reminders") + " · today [" + head + "] · " + document.querySelectorAll(".rmark:not([hidden])").length + " marks · " + document.querySelectorAll(".item.repeat").length + " repeat lines";
  })()`;
  const shot = async (name: string) => {
    await wait(400);
    await inPane("calendar", settledScript);
    const found = String(await inPane("calendar", check));
    console.log(`reminders ${name}: ${found}`);
    if (!found.startsWith("ok")) problems += 1;
    await save(`reminders/${name}`, captureDesk(wait));
  };
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "night/" : "";
    store.setPref("paper", paper);
    await showDeskPane("calendar", wait);
    desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
    openCalendar(dateKey(new Date()));
    await inPane("calendar", `document.querySelectorAll(".view-seg button")[1]?.click()`);
    await shot(`${prefix}month`);
    await inPane("calendar", `document.querySelector(".view-seg button")?.click()`);
    await shot(`${prefix}week`);
    await inPane("calendar", `document.querySelectorAll(".view-seg button")[1]?.click()`);
    // The smallest desk: shorter cells, so "+N" sooner.
    desk.browserWindow!.setContentSize(760, 520 + deskTitleBar);
    await shot(`${prefix}month-small`);
    desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
    // #296: two more daily repeats and a weekday one (with 물 마시기) — folded into each day's head; the events keep the lines.
    const itemsBefore = new Set(store.items.map((item) => item.id));
    const crowd = [
      store.saveSeries({ title: t("스트레칭"), rule: { kind: "daily" } }),
      store.saveSeries({ title: t("아침 운동"), rule: { kind: "weekdays" }, remindAt: "07:30" }),
    ].filter((id): id is string => Boolean(id));
    await shot(`${prefix}month-repeats`);
    desk.browserWindow!.setContentSize(760, 520 + deskTitleBar);
    await shot(`${prefix}month-repeats-small`);
    desk.browserWindow!.setContentSize(1280, 820 + deskTitleBar);
    await shot(`${prefix}month-repeats-wide`);
    desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
    for (const id of crowd) store.deleteSeries(id);
    // (Today's copies too.)
    const copies = store.items.filter((item) => !itemsBefore.has(item.id)).map((item) => item.id);
    store.mutate((history) => { for (const id of copies) history.delete(id); });
  }
  store.mutate((history) => { for (const id of made) history.delete(id); });
  store.setPref("paper", "day");
  return problems;
}
