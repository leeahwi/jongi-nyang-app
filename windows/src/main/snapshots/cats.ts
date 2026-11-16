import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, screen } from "electron";
import { type NotebookFont, defaultPrefs } from "../../core/types";
import { t } from "../../i18n";
import { offscreen } from "../env";
import { earsPreview } from "../noteEars";
import { type LayoutCheckOptions } from "../layoutCheck";
import { type CatSize, catSizes } from "../../core/catSize";
import { floating, note, pet, rendererDirectory, store, typingCat } from "../main";
import { type Save, type Wait } from "./index";
import { captureDesk, inPane, showDeskPane } from "./desk";

/**
 * #408: snapshots of the cats' windows and the note's place — 타닥냥, 고양이 크기, 노트 위치, the ears, the header check
 * (`npm run snapshot -- typing` · `catsize` · `layer` · `ears`) — moved out of main.ts as they were. Test runs only
 * (see snapshots/design.ts).
 */

/**
 * The note's top row at every width, font and page, with two-digit counts: the tabs must not
 * run under the tools, nothing may be cut off, and every tab and tool must be clickable (not
 * inside a drag region). Prints one line per case and saves the narrowest and widest.
 */
export async function checkHeader(save: (name: string, image?: Promise<Electron.NativeImage>) => Promise<void>, wait: (ms: number) => Promise<unknown>): Promise<void> {
  store.mutate((history) => { for (let index = 0; index < 12; index += 1) { history.add(t("할 일 {n}", { n: index + 1 })); history.addTo(t("나중에 {n}", { n: index + 1 }), "later"); } });
  const problems: string[] = [];
  floating.hide();
  note.showInactive(); // the earlier steps folded it into the post-it
  await wait(500);
  for (const font of ["pen", "brush", "clean"] as NotebookFont[]) {
    store.setPref("font", font);
    for (const width of [350, 380, 420, 520, 720]) {
      note.setSize(width, 560);
      for (const command of ["page-today", "page-ahead"]) {
        note.webContents.send("note:row-command", { id: "", command });
        await wait(160);
        // A missing element is a problem on the list, not a thrown script that stops the run (#178).
        const report = await note.webContents.executeJavaScript(`(() => { try {
          const r = (el) => el.getBoundingClientRect();
          const tabs = document.querySelector(".index-tabs"), tools = document.querySelector(".tools");
          const out = [];
          if (r(tabs).right > r(tools).left - 16) out.push("tabs within 16px of the tools (" + Math.round(r(tools).left - r(tabs).right) + "px gap)");
          if (r(tools).right > window.innerWidth + 0.5) out.push("tools cut off by " + Math.round(r(tools).right - window.innerWidth) + "px");
          for (const tab of document.querySelectorAll(".index-tab")) {
            const label = tab.querySelector(".tab-label");
            if (label.scrollWidth > label.clientWidth + 1) out.push("label clipped: " + label.textContent);
            if (getComputedStyle(tab).webkitAppRegion === "drag") out.push("tab in drag region");
          }
          for (const button of tools.querySelectorAll("button")) if (getComputedStyle(button).webkitAppRegion === "drag") out.push("tool in drag region");
          // Every tab's whole outline shows: no neighbour over it, nothing clipping its rounded top corners.
          const all = [...document.querySelectorAll(".index-tab")];
          const row = r(document.querySelector(".tabs-row"));
          all.forEach((tab, index) => {
            const box = r(tab);
            const name = tab.querySelector(".tab-label").textContent;
            if (all[index + 1] && box.right > r(all[index + 1]).left + 0.5) out.push("tabs overlap: " + name);
            if (box.top < row.top - 0.5 || box.left < row.left - 0.5 || box.right > window.innerWidth - 0.5) out.push("tab cut: " + name);
            for (const [x, y] of [[box.left + 3, box.top + 3], [box.right - 3, box.top + 3], [box.left + 2, box.bottom - 3], [box.right - 2, box.bottom - 3]]) {
              const hit = document.elementFromPoint(x, y);
              if (!hit || !tab.contains(hit)) { out.push("tab outline covered: " + name); break; }
            }
          });
          const title = document.querySelector(".title");
          if (title.scrollWidth > title.clientWidth + 1) out.push("title clipped: " + title.textContent);
          // #151: the cat left the header for the ears on the window's top edge (#178: this line still measured it).
          if (document.querySelector(".peek")) out.push("a cat in the header");
          if (r(document.querySelector(".title-text")).right > r(document.querySelector(".title-row")).right + 0.5) out.push("title runs out of its row");
          return out.join("; ");
        } catch (error) { return "check failed: " + error.message; } })()`);
        const line = `header ${font} ${width} ${command.replace("page-", "")}: ${report || "ok"}`;
        console.log(line);
        if (report) problems.push(line);
      }
      if (width === 350 || width === 720) {
        note.webContents.send("note:row-command", { id: "", command: "page-ahead" });
        note.webContents.invalidate();
        await wait(600);
        // An off-screen window sometimes never delivers a frame; don't let that stall the run.
        const image = await Promise.race([note.webContents.capturePage().catch(() => undefined), wait(3000).then(() => undefined)]);
        if (image) await save(`header-${font}-${width}`, Promise.resolve(image.crop({ x: 0, y: 0, width: image.getSize().width, height: Math.round(image.getSize().height * 100 / 560) })));
        else console.log(`header ${font} ${width}: (capture failed)`);
      }
    }
  }
  // The tab row zoomed, in each state (hovered, a task over 앞으로, 앞으로 open, a task from it over 오늘), for a close look.
  store.setPref("font", "pen");
  note.setSize(420, 560);
  note.webContents.send("note:row-command", { id: "", command: "page-today" });
  await wait(300);
  for (const [state, script] of [["plain", ""], ["hover", `document.querySelector(".tab-ahead").classList.add("hover")`], ["drop", `document.querySelector(".tab-ahead").classList.add("drop-target")`], ["ahead", `document.querySelector(".tab-ahead").click()`], ["ahead-drop", `document.querySelector(".tab-today").classList.add("drop-target")`]] as const) {
    if (script) await note.webContents.executeJavaScript(script);
    await wait(250);
    const check = await note.webContents.executeJavaScript(`(() => { const out = []; const all = [...document.querySelectorAll(".index-tab")];
      all.forEach((tab) => { const b = tab.getBoundingClientRect(); for (const [x, y] of [[b.left + 3, b.top + 3], [b.right - 3, b.top + 3]]) { const hit = document.elementFromPoint(x, y); if (!hit || !tab.contains(hit)) out.push("covered: " + tab.textContent); } });
      return out.join("; "); })()`);
    console.log(`tabs ${state}: ${check || "ok"}`);
    if (check) problems.push(`tabs ${state}: ${check}`);
    const image = await Promise.race([note.webContents.capturePage({ x: 0, y: 0, width: 420, height: 48 }).catch(() => undefined), wait(3000).then(() => undefined)]);
    if (image) await save(`tabs-${state}`, Promise.resolve(image));
    await note.webContents.executeJavaScript(`document.querySelectorAll(".index-tab").forEach((tab) => tab.classList.remove("hover", "drop-target"))`);
  }
  console.log(problems.length ? `HEADER PROBLEMS: ${problems.length}` : "HEADER OK");
  store.setPref("font", defaultPrefs.font);
}

/**
 * Snapshots: 앞으로 as if a task were being dragged — every day of the two weeks and an empty 언젠가
 * shown to drop on, the first dated row lifted, the next day lit up with the landing line on its
 * first row (or the day itself).
 */
export const aheadDragScript = `(() => {
  window.dispatchEvent(new Event("snapshot-drag"));
  const rows = [...document.querySelectorAll(".ahead .aday .row")];
  const source = rows[0];
  if (!source) return;
  source.classList.add("dragging");
  const days = [...document.querySelectorAll(".ahead .aday")];
  const target = days.find((day) => !day.contains(source)) ?? days[0];
  target.classList.add("drop-target");
  target.querySelector(".row")?.classList.add("drop-before");
})()`;

/** What the size sweep (and the 1.24 shots) check in the note. */
export const noteLayoutChecks: LayoutCheckOptions = {
  ignore: ".peek, .strike, .guide, .scrim",
  inside: [".tabs-row", ".tools button", ".index-tab", ".title-row", ".footer", ".footer > *", ".editor", ".event-sheet", ".event-sheet .tape", ".editor .actions .action", ".dock", ".inp", ".strip-top", ".strip-barline", ".strip-lead", ".tt-scroll", ".sheet-pop", ".slip-foot .sbtn",
    ".focus-card", ".fc-top", ".fc-close", ".fc-ring", ".fc-btn", ".fc-foot", ".fc-cat", ".pick-bar", ".pick-cancel", ".focus-pick",
    ".search-slip", ".search-line", ".search-foot", ".row.preview-hover .actions", ".fc-play"],
  oneLine: [".fc-kicker", ".fc-next", ".fc-btn", ".fc-rest", ".fc-row-title", ".pick-text", ".pick-cancel", ".focus-pick", ".group-name", ".group-count", ".footer > *", ".tab-label", ".editor .actions .action", ".seg button", ".quick button:not(.two-line)", ".choice-title", ".choice-sub", ".move", ".due", ".time",
    ".carry", ".search-head", ".search-meta", ".search-foot .keys > span", ".slip-title",
    ".date-line", ".prog", ".group-head span", ".group-mark span", ".chip", ".sbtn", ".kbd", ".slip-title", ".sheet-toggle", ".range-length",
    ".strip-link", ".ad-pill", ".ad-more", ".tt-title", ".strip-hours span", ".lead-kicker", ".lead-sub", ".strip-nothing", ".rc-text b", ".rc-text small:not(.two)", ".sr-time", ".sr-away",
    ".tt-hour span", ".tb-time", ".tb-title", ".tt-more", ".ttn-when", ".ttn-chip", ".tml-time"],
  rows: [".tabs-row", ".tools", ".index-tabs", ".title-row", ".footer", ".lines > .row", ".editor .actions", ".quick", ".custom", ".alert-row", ".month-row", ".time-line", ".search-row", ".search-head", ".actions",
    ".inp-row", ".strip-top", ".strip-barline", ".strip-lead", ".lead-row", ".strip-row", ".ttn-foot", ".tt-more-list button", ".slip-head", ".slip-foot", ".sheet-row", ".sheet-line", ".prog", ".fc-top", ".fc-btns", ".fc-foot", ".fc-row", ".pick-bar", ".group-head", ".group-mark"],
  // The focus card's column never needs to scroll (only its list does).
  noScroll: [".fc-body"],
  placeholders: [".inp .typed"],
};

/**
 * #151: the note as it stands on a desktop with the cat's ears on its top edge — wide, narrow (350) and short (350 × 400),
 * one ear mid-twitch, and the ears alone on light and dark desktops — day and night, into snapshots/ears/. Each note
 * first checks its header: no cat left in it, the header as tall as before (78 px, 58 when short) and nothing cut.
 * The pictures are put together in a hidden window (ears.html#preview); nothing is shown.
 */
/**
 * 노트 위치 (#273): the pin as each place shows it (보통 · 항상 위에 두기 · 바탕화면에 두기) with its words for a screen
 * reader, and its menu open, at the usual and the smallest size, day and night. A cut label or a menu out of the note
 * counts as a problem.
 */
/**
 * 타닥냥 (#289 · #288): 책상 → 종이냥 scrolled to its section — in this app, off (자리 dimmed) with the pet hidden,
 * in all apps without a keyboard hook (the line saying so) — and
 * the cat in its corner (resting, the left paw down, the right paw down), in typing/ and typing/night/. Each pane is
 * checked for text cut short.
 */
export async function typingShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  const cut = `(() => [...document.querySelectorAll(".group .row, .group .label, .group .foot")].filter((element) => [element, ...element.querySelectorAll("*")]
    .some((part) => part.clientWidth && part.scrollWidth > part.clientWidth + 1)).map((element) => element.textContent.trim().slice(0, 40)))()`;
  fs.mkdirSync(path.join(directory, "typing", "night"), { recursive: true });
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "typing/night/" : "typing/";
    store.setPref("paper", paper);
    // #288: 모든 앱에서 — off-screen there is no keyboard hook, so this draws the line that says the cat hears this app only.
    for (const [name, scope, petShown] of [["settings-pet-typing", "app", true], ["settings-pet-typing-off", "off", false],
      ["settings-pet-typing-everywhere-no-hook", "everywhere", true]] as const) {
      store.setPref("typingCat", scope);
      store.setPref("petVisible", petShown);
      await showDeskPane("pet", wait);
      await inPane("settings", `document.querySelector(".content").scrollTop = 1e6`);
      await wait(400);
      const found = await inPane("settings", cut) as string[] | undefined;
      console.log(`typing ${prefix}${name}: ${found?.length ? `cut: ${found.join(" · ")}` : "ok"}`);
      problems += found?.length ?? 0;
      await save(`${prefix}${name}`, captureDesk(wait));
    }
    store.setPref("typingCat", "app");
    store.setPref("petVisible", true);
    // #331: dragged somewhere — 자리 reads 옮긴 자리 (a made-up place on a made-up display).
    store.setPref("typingPlace", { screen: "1", x: 0.62, y: 0.4, centerX: 893, centerY: 344 });
    store.setPref("typingCorner", "moved");
    await showDeskPane("pet", wait);
    await inPane("settings", `document.querySelector(".content").scrollTop = 1e6`);
    await wait(400);
    const found = await inPane("settings", cut) as string[] | undefined;
    console.log(`typing ${prefix}settings-pet-typing-moved: ${found?.length ? `cut: ${found.join(" · ")}` : "ok"}`);
    problems += found?.length ?? 0;
    await save(`${prefix}settings-pet-typing-moved`, captureDesk(wait));
    store.setPref("typingCorner", "bottomRight");
    store.setPref("typingPlace", undefined);
    for (const pose of ["idle", "left", "right"] as const) await save(`${prefix}typing-cat-${pose}`, typingCat?.preview(pose));
    // #331: a drag as the page makes one, off the screens: let go, it is wholly in a work area and 자리 is 옮긴 자리.
    if (paper === "day" && typingCat) {
      typingCat.dragBy(-300, -200);
      const bounds = typingCat.bounds;
      const inside = bounds !== undefined && screen.getAllDisplays().some(({ workArea: area }) => bounds.x - offscreen.x >= area.x && bounds.y - offscreen.y >= area.y
        && bounds.x - offscreen.x + bounds.width <= area.x + area.width && bounds.y - offscreen.y + bounds.height <= area.y + area.height);
      const moved = store.prefs.typingCorner === "moved" && store.prefs.typingPlace !== undefined && inside;
      console.log(`typing drag: ${moved ? "ok" : `problem: ${store.prefs.typingCorner} ${JSON.stringify(bounds)}`}`);
      if (!moved) problems += 1;
      store.setPref("typingCorner", "bottomRight");
      store.setPref("typingPlace", undefined);
    }
    typingCat?.refresh();
  }
  store.setPref("paper", "day");
  return problems;
}

/**
 * 크기 (#304): 책상 → 종이냥 with each section's 크기 row (the pet's at the top, 타닥냥's scrolled to), then the pet sitting
 * and asking a question, and 타닥냥 resting and with a paw down, at each size — in catsize/ and catsize/night/. A cut
 * label, a cat or bubble out of its window, or a window off the floor counts as a problem. 보통 is drawn first and again
 * after the other sizes: the two must be the same picture.
 */
export async function catSizeShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  const cut = `(() => [...document.querySelectorAll(".group .row, .group .label, .group .foot")].filter((element) => [element, ...element.querySelectorAll("*")]
    .some((part) => part.clientWidth && part.scrollWidth > part.clientWidth + 1)).map((element) => element.textContent.trim().slice(0, 40)))()`;
  fs.mkdirSync(path.join(directory, "catsize", "night"), { recursive: true });
  const report = (what: string, found: string[] | undefined) => {
    console.log(`catsize ${what}: ${found?.length ? found.join(" · ") : "ok"}`);
    problems += found?.length ?? 0;
  };
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "catsize/night/" : "catsize/";
    store.setPref("paper", paper);
    store.setPref("petVisible", true);
    store.setPref("typingCat", "app");
    store.setPref("petSize", "large");
    store.setPref("typingSize", "large");
    for (const [name, scroll] of [["settings-pet-size", "0"], ["settings-typing-size", "1e6"]] as const) {
      await showDeskPane("pet", wait);
      await inPane("settings", `document.querySelector(".content").scrollTop = ${scroll}`);
      await wait(400);
      report(`${prefix}${name}`, await inPane("settings", cut) as string[] | undefined);
      await save(`${prefix}${name}`, captureDesk(wait));
    }
    const sizes: CatSize[] = ["regular", ...catSizes.filter((step) => step !== "regular"), "regular"];
    for (const size of sizes) {
      const again = size === "regular" && store.prefs.petSize !== "large" ? "-again" : "";
      store.setPref("petSize", size);
      store.setPref("typingSize", size);
      pet?.quiet();
      await wait(3200); // the one breath after it settles
      report(`${prefix}pet-${size}${again}`, await pet?.layoutProblems());
      await save(`${prefix}pet-${size}${again}`, pet?.capture());
      pet?.speakUp(() => 0.99);
      await wait(800);
      report(`${prefix}pet-question-${size}${again}`, await pet?.layoutProblems());
      await save(`${prefix}pet-question-${size}${again}`, pet?.capture());
      for (const pose of ["idle", "left"] as const) await save(`${prefix}typing-cat-${size}-${pose}${again}`, typingCat?.preview(pose));
      typingCat?.refresh();
    }
  }
  // #313: the cat stays on the floor after a wander there and back, hidden and shown again, and a display change — at
  // each size (the window's place is logged against the work area).
  for (const size of catSizes) {
    store.setPref("petSize", size);
    pet?.quiet();
    await pet?.walkForSnapshot(-170);
    await pet?.walkForSnapshot(170);
    report(`catsize/floor-${size}-walked (${pet?.floorLog()})`, await pet?.layoutProblems());
    store.setPref("petVisible", false);
    store.setPref("petVisible", true);
    await wait(600);
    pet?.displayChangedForSnapshot();
    await wait(300);
    report(`catsize/floor-${size}-shown-again (${pet?.floorLog()})`, await pet?.layoutProblems());
  }
  store.setPref("petSize", "regular");
  store.setPref("paper", "day");
  return problems;
}

export async function layerShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
  let problems = 0;
  const check = `(() => {
    const out = [];
    const pin = document.querySelector(".tools .pin");
    out.push("label " + pin.getAttribute("aria-label"));
    const menu = document.querySelector(".menu");
    if (menu) {
      const box = menu.getBoundingClientRect();
      if (box.left < 0 || box.top < 0 || box.right > window.innerWidth || box.bottom > window.innerHeight) out.push("PROBLEM menu outside the note");
      for (const row of menu.querySelectorAll(".label, [role^=menuitem]")) {
        for (const element of [row, ...row.querySelectorAll("*")]) {
          if (element.clientWidth && element.scrollWidth > element.clientWidth + 1) out.push("PROBLEM cut: " + row.textContent.trim());
        }
      }
    }
    return out;
  })()`;
  fs.mkdirSync(path.join(directory, "layer", "night"), { recursive: true });
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "layer/night/" : "layer/";
    store.setPref("paper", paper);
    for (const [width, height] of [[420, 560], [350, 400]] as const) {
      note.setSize(width, height);
      for (const layer of ["normal", "top", "desktop"] as const) {
        store.setPref("noteLayer", layer);
        await wait(300);
        await settled(note);
        const name = `${prefix}note-layer-${layer}${width === 350 ? "-small" : ""}`;
        const found = await note.webContents.executeJavaScript(check).catch((error: Error) => [`PROBLEM script failed: ${error.message}`]) as string[];
        await save(name, note.webContents.capturePage());
        await note.webContents.executeJavaScript(`document.querySelector(".tools .pin").click()`);
        await wait(300);
        await settled(note);
        const open = await note.webContents.executeJavaScript(check).catch((error: Error) => [`PROBLEM script failed: ${error.message}`]) as string[];
        await save(`${name}-menu`, note.webContents.capturePage());
        await note.webContents.executeJavaScript(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
        const lines = [...found, ...open.filter((line) => !line.startsWith("label"))];
        console.log(`layer ${name}: ${lines.join("; ")}`);
        problems += lines.filter((line) => line.startsWith("PROBLEM")).length;
      }
    }
  }
  store.setPref("noteLayer", "normal");
  store.setPref("paper", "day");
  note.setSize(420, 560);
  return problems;
}

export async function earsShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
  let problems = 0;
  const check = `(() => {
    const out = [];
    if (document.querySelector(".peek")) out.push("the cat is still in the header");
    const row = document.querySelector(".title-row").getBoundingClientRect();
    const want = window.innerHeight <= 480 ? 58 : 78;
    if (Math.abs(row.height - want) > 0.5) out.push("header " + row.height + " px, was " + want);
    for (const selector of [".date-line", ".title", ".prog-text", ".space-pick-label"]) {
      const element = document.querySelector(selector);
      if (element && element.offsetParent && element.scrollWidth > element.clientWidth + 1) out.push(selector + " cut");
    }
    return out;
  })()`;
  fs.mkdirSync(path.join(directory, "ears", "night"), { recursive: true });
  const preview = async (name: string, payload: Parameters<typeof earsPreview>[1], size: { width: number; height: number }) => {
    const window = await earsPreview(rendererDirectory, payload, { ...size, x: offscreen.x + 200, y: offscreen.y + 200 });
    await wait(400);
    await settled(window);
    await save(name, window.webContents.capturePage());
    window.destroy();
  };
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "ears/night/" : "ears/";
    store.setPref("paper", paper);
    for (const [name, width, height, held] of [["note-ears", 420, 560, false], ["note-ears-narrow", 350, 560, false],
      ["note-ears-small", 350, 400, false], ["note-ears-twitch", 420, 560, true]] as const) {
      note.setSize(width, height);
      await wait(400);
      await settled(note);
      const found = await note.webContents.executeJavaScript(check).catch((error: Error) => [`script failed: ${error.message}`]) as string[];
      console.log(`ears ${prefix}${name}: ${found.length ? found.join("; ") : "ok"}`);
      problems += found.length;
      const image = await note.webContents.capturePage();
      const [w, h] = note.getContentSize();
      await preview(`${prefix}${name}`, { image: image.toDataURL(), width: w, height: h, held }, { width: w + 48, height: h + 20 - 1 + 48 });
    }
    await preview(`${prefix}note-ears-edge`, { width: 0, height: 0, strip: ["#ffffff", "#fbf9f3", "#cdd6de", "#2a2924", "#000000"] }, { width: 600, height: 60 });
  }
  store.setPref("paper", "day");
  return problems;
}
