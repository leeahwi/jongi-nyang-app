import { BrowserWindow, app, session, shell, type Session, type WebContents, type WebFrameMain } from "electron";
import { pathToFileURL } from "node:url";
import { senderPageOf, type PageName } from "../core/ipcCheck";
import { mayNavigate, permissionGranted, safeExternalUrl } from "../core/webGuard";

/**
 * 보안 (#171, review L-01): one place for what leaves the app and where its pages may go.
 * - Links go to the system only through `openExternalSafely` (http · https · mailto).
 * - No page opens a window, navigates itself, attaches a `<webview>`, or loads a frame other than the desk's panes.
 * - Every permission a page could ask for (camera, microphone, location, notifications …) is refused.
 */

/** Hands a link to the system's browser or mail app when it is one we open; false (and nothing opened) otherwise. */
export function openExternalSafely(url: unknown): boolean {
  const safe = safeExternalUrl(url);
  if (!safe) {
    console.warn("blocked a link the app does not open");
    return false;
  }
  void shell.openExternal(safe).catch(() => undefined);
  return true;
}

const guardedSessions = new WeakSet<Session>();

/** Refuses every permission request and check on `target` (once per session). */
export function refusePermissions(target: Session): void {
  if (guardedSessions.has(target)) return;
  guardedSessions.add(target);
  target.setPermissionRequestHandler((_contents, permission, callback) => callback(permissionGranted(permission)));
  target.setPermissionCheckHandler((_contents, permission) => permissionGranted(permission));
}

/** The two are the same frame (WebFrameMain objects for one frame may differ; its process and routing ids don't). */
const sameFrame = (a: WebFrameMain | null | undefined, b: WebFrameMain | null | undefined): boolean =>
  Boolean(a && b && (a === b || (a.processId === b.processId && a.routingId === b.routingId)));

/**
 * #172 (review L-02): the page an IPC message came from — one of the app's own pages, from the app's folder, in a
 * window of ours: a window's own page in its main frame, or one of the desk's panes in a frame of the desk. Undefined
 * for anything else (a frame inside a page, another page, a page that is going away).
 */
export function senderPage(event: { sender: WebContents; senderFrame: WebFrameMain | null }, rendererDirectory: string): PageName | undefined {
  try {
    const frame = event.senderFrame;
    if (!frame || frame.isDestroyed()) return undefined;
    const top = event.sender.mainFrame;
    return senderPageOf({
      frameUrl: frame.url, isMainFrame: sameFrame(frame, top), parentIsMain: sameFrame(frame.parent, top), topUrl: top.url,
      ourWindow: Boolean(BrowserWindow.fromWebContents(event.sender)),
    }, pathToFileURL(rendererDirectory).href);
  } catch {
    return undefined;
  }
}

/** A message refused: said once in the log (its channel, the page and the action's type — never its contents). */
export function refused(channel: string, page: string | undefined, what?: unknown): void {
  const type = typeof what === "object" && what !== null && typeof (what as { type?: unknown }).type === "string" ? String((what as { type: string }).type).slice(0, 40) : "";
  console.warn(`ipc: refused ${channel}${type ? ` ${type}` : ""} from ${page ?? "an unknown sender"}`);
}

/** Every web contents the app makes, from now on: windows, the desk's frames, anything a page might try to open. */
export function guardWebContents(rendererDirectory: string): void {
  const rendererUrl = pathToFileURL(rendererDirectory).href;
  app.whenReady().then(() => refusePermissions(session.defaultSession)).catch(() => undefined);
  app.on("web-contents-created", (_event, contents: WebContents) => {
    refusePermissions(contents.session);
    // window.open, target=_blank and the like: never a window of ours; a safe link goes to the browser.
    contents.setWindowOpenHandler(({ url }) => { openExternalSafely(url); return { action: "deny" }; });
    // The main process loads every page; a page never navigates its window anywhere.
    contents.on("will-navigate", (event) => event.preventDefault());
    // Frames too (the desk's panes): only the desk's own pages from the app's folder.
    contents.on("will-frame-navigate", (event) => {
      if (!mayNavigate({ url: event.url, isMainFrame: event.isMainFrame }, rendererUrl)) event.preventDefault();
    });
    contents.on("will-redirect", (event) => event.preventDefault());
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
}
