/**
 * 보안 (#171, review L-01 · I-02 · I-03): what leaves the app for the system, and where a page may go.
 * The decisions only (no Electron here, so the tests read them); main/security.ts wires them to every
 * window, every frame and the session.
 */

/** The schemes the system may open for us: a browser for http(s), the mail app for mailto. Nothing else. */
export const externalSchemes: readonly string[] = ["http:", "https:", "mailto:"];

/**
 * A link the app may hand to the system (`shell.openExternal`), normalised; undefined for anything else —
 * `file:`, `javascript:`, `ms-msdt:`, `search-ms:`, a link with a user name or password, control characters,
 * or one too long to be a real link.
 */
export function safeExternalUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length === 0 || text.length > 4096 || /[\u0000-\u001f\u007f]/.test(text)) return undefined;
  let url: URL;
  try { url = new URL(text); } catch { return undefined; }
  const scheme = url.protocol.toLowerCase();
  if (!externalSchemes.includes(scheme)) return undefined;
  if (scheme === "mailto:") return url.pathname || url.search ? url.href : undefined;
  if (!url.hostname || url.username || url.password) return undefined;
  return url.href;
}

/** The pages the desk (책상) shows in its frames; nothing else may load in a frame. */
export const deskFramePages: readonly string[] = ["calendarWindow.html", "history.html", "settings.html", "help.html"];

/** Whether `url` is the file of one of the app's own pages in `rendererUrl` (a `file:` folder URL), and which. */
export function ownPage(url: string, rendererUrl: string): string | undefined {
  let parsed: URL;
  let folder: URL;
  try { parsed = new URL(url); folder = new URL(rendererUrl.endsWith("/") ? rendererUrl : `${rendererUrl}/`); } catch { return undefined; }
  if (parsed.protocol !== "file:" || folder.protocol !== "file:" || parsed.host !== folder.host) return undefined;
  let path: string;
  let base: string;
  try { path = decodeURIComponent(parsed.pathname); base = decodeURIComponent(folder.pathname); } catch { return undefined; }
  // A Windows drive ("/C:/…"): the file system ignores case, and the two sides may spell it differently.
  const fold = /^\/[A-Za-z]:\//.test(base) ? (text: string) => text.toLowerCase() : (text: string) => text;
  if (!fold(path).startsWith(fold(base))) return undefined;
  const name = path.slice(base.length);
  return /^[A-Za-z]+\.html$/.test(name) ? name : undefined;
}

/**
 * A navigation a page asked for (`will-frame-navigate`): a window's own page never goes anywhere (the main
 * process loads it), and a frame may only load one of the desk's pages from the app's folder.
 */
export function mayNavigate(request: { url: string; isMainFrame: boolean }, rendererUrl: string): boolean {
  if (request.isMainFrame) return false;
  const page = ownPage(request.url, rendererUrl);
  return page !== undefined && deskFramePages.includes(page);
}

/** Permission requests and checks (camera, microphone, location, notifications from a page …): none are granted. */
export const permissionGranted = (_permission: string): boolean => false;
