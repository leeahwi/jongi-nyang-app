import type { Lang } from "./lang";

/**
 * 시스템 알림으로도 보내기 (편의 기능 7): when a reminder or an alarm also goes to Windows' own notifications,
 * and the toast it posts (with 끝냄 · 10분 뒤, or 끄기 · 다시 알림 for an alarm). The buttons come back to
 * the app as a `jongi-nyang:` link (the app is that link's handler on Windows), read by `readNotifyLink`.
 */

export type SystemNotifySetting = "missed" | "always" | "off";

/** What the app knows when a reminder comes: is it seen here? */
export interface NotifyContext {
  /** 종이냥 on the desktop. */
  petShown: boolean;
  /** The note on screen (not hidden, not minimized). */
  noteShown: boolean;
  /** The screen is locked (the in-app bubble waits until it opens). */
  locked: boolean;
}

/**
 * "놓친 것만": only when the reminder couldn't be seen here — the cat and the note both away, or the
 * screen locked; "항상": every time; "끄기": never.
 */
export function wantsSystemNotice(setting: SystemNotifySetting, context: NotifyContext): boolean {
  if (setting === "off") return false;
  if (setting === "always") return true;
  return context.locked || (!context.petShown && !context.noteShown);
}

export const notifyScheme = "jongi-nyang";

/**
 * An alarm's buttons carry `nonce` (#172, review L-03): a value made fresh for that one notification, so a web page or
 * a document opening `jongi-nyang:alarm-stop` can't silence a ringing alarm. Without the right one the link only opens
 * the note (`acceptNotifyAction`).
 */
export type NotifyAction = { kind: "open" } | { kind: "done"; ids: string[] } | { kind: "snooze"; ids: string[]; minutes: number } | { kind: "alarmStop"; nonce?: string } | { kind: "alarmSnooze"; nonce?: string };

/** A notification's one-time value: 32 hex digits from the system's random source. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const noncePattern = /^[0-9a-f]{32}$/;

/** The link a toast's button opens: "jongi-nyang:done?ids=A,B", "jongi-nyang:snooze?ids=A&minutes=10", "jongi-nyang:open",
 *  "jongi-nyang:alarm-stop?n=<nonce>". */
export function notifyLink(action: NotifyAction): string {
  switch (action.kind) {
    case "open": return `${notifyScheme}:open`;
    case "done": return `${notifyScheme}:done?ids=${action.ids.map(encodeURIComponent).join(",")}`;
    case "snooze": return `${notifyScheme}:snooze?ids=${action.ids.map(encodeURIComponent).join(",")}&minutes=${action.minutes}`;
    case "alarmStop": return `${notifyScheme}:alarm-stop${action.nonce ? `?n=${action.nonce}` : ""}`;
    case "alarmSnooze": return `${notifyScheme}:alarm-snooze${action.nonce ? `?n=${action.nonce}` : ""}`;
  }
}

/** A launch's arguments: the toast's link among them, read back (undefined when there is none or it's not ours). */
export function readNotifyLink(argv: readonly string[]): NotifyAction | undefined {
  const link = argv.find((arg) => arg.toLowerCase().startsWith(`${notifyScheme}:`));
  if (!link) return undefined;
  const [head, query = ""] = link.slice(notifyScheme.length + 1).replace(/^\/+/, "").split("?");
  const params = new Map(query.split("&").filter(Boolean).map((pair) => {
    const [key, value = ""] = pair.split("=");
    return [key, value] as const;
  }));
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean).map((id) => { try { return decodeURIComponent(id); } catch { return ""; } }).filter((id) => /^[\w-]{1,64}$/.test(id));
  switch (head.replace(/\/+$/, "")) {
    case "open": return { kind: "open" };
    case "done": return ids.length ? { kind: "done", ids } : undefined;
    case "snooze": {
      const minutes = Number(params.get("minutes"));
      return ids.length && Number.isInteger(minutes) && minutes > 0 && minutes <= 240 ? { kind: "snooze", ids, minutes } : undefined;
    }
    case "alarm-stop":
    case "alarm-snooze": {
      const nonce = params.get("n");
      const kind = head.replace(/\/+$/, "") === "alarm-stop" ? "alarmStop" : "alarmSnooze";
      return nonce && noncePattern.test(nonce) ? { kind, nonce } : { kind };
    }
    default: return undefined;
  }
}

/**
 * What a link may do: an alarm's 끄기 · 다시 알림 only with the nonce of the notification that is out now (`expected`,
 * undefined when no alarm is ringing); anything else about an alarm just opens the note. Tasks' links need their ids
 * (UUIDs) and change only those, as before.
 */
export function acceptNotifyAction(action: NotifyAction, expected: string | undefined): NotifyAction {
  if (action.kind !== "alarmStop" && action.kind !== "alarmSnooze") return action;
  return expected !== undefined && action.nonce === expected ? action : { kind: "open" };
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const words: Record<Lang, { done: string; later: string; stop: string; again: string }> = {
  // A button says what it does (#38): 끝내기, not the state word 끝냄.
  ko: { done: "끝내기", later: "10분 뒤", stop: "끄기", again: "다시 알림" },
  en: { done: "Mark done", later: "In 10 min", stop: "Stop", again: "Snooze" },
  nl: { done: "Afvinken", later: "Over 10 min", stop: "Stoppen", again: "Sluimeren" },
};

/**
 * The Windows toast (its XML): the title and the lines, a click opens the note, and the buttons —
 * a task's 끝냄 · 10분 뒤, an alarm's 끄기 · 다시 알림 — each opening our link.
 */
export function toastXml(notice: { title: string; lines: string[]; kind: "tasks"; ids: string[] } | { title: string; lines: string[]; kind: "alarm"; nonce: string }, lang: Lang = "ko"): string {
  const word = words[lang];
  const actions = notice.kind === "tasks"
    ? [[word.done, notifyLink({ kind: "done", ids: notice.ids })], [word.later, notifyLink({ kind: "snooze", ids: notice.ids, minutes: 10 })]]
    : [[word.stop, notifyLink({ kind: "alarmStop", nonce: notice.nonce })], [word.again, notifyLink({ kind: "alarmSnooze", nonce: notice.nonce })]];
  const text = [notice.title, ...notice.lines.slice(0, 2)].map((line) => `<text>${escape(line)}</text>`).join("");
  return `<toast activationType="protocol" launch="${escape(notifyLink({ kind: "open" }))}"${notice.kind === "alarm" ? ' scenario="alarm"' : ""}>`
    + `<visual><binding template="ToastGeneric">${text}</binding></visual>`
    + `<actions>${actions.map(([label, link]) => `<action content="${escape(label)}" activationType="protocol" arguments="${escape(link)}"/>`).join("")}</actions>`
    + `</toast>`;
}

/** The button words of a toast (macOS demo runs show the same two as notification actions). */
export const notifyButtons = (kind: "tasks" | "alarm", lang: Lang = "ko"): [string, string] =>
  kind === "tasks" ? [words[lang].done, words[lang].later] : [words[lang].stop, words[lang].again];
