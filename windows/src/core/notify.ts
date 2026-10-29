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

export type NotifyAction = { kind: "open" } | { kind: "done"; ids: string[] } | { kind: "snooze"; ids: string[]; minutes: number } | { kind: "alarmStop" } | { kind: "alarmSnooze" };

/** The link a toast's button opens: "jongi-nyang:done?ids=A,B", "jongi-nyang:snooze?ids=A&minutes=10", "jongi-nyang:open". */
export function notifyLink(action: NotifyAction): string {
  switch (action.kind) {
    case "open": return `${notifyScheme}:open`;
    case "done": return `${notifyScheme}:done?ids=${action.ids.map(encodeURIComponent).join(",")}`;
    case "snooze": return `${notifyScheme}:snooze?ids=${action.ids.map(encodeURIComponent).join(",")}&minutes=${action.minutes}`;
    case "alarmStop": return `${notifyScheme}:alarm-stop`;
    case "alarmSnooze": return `${notifyScheme}:alarm-snooze`;
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
    case "alarm-stop": return { kind: "alarmStop" };
    case "alarm-snooze": return { kind: "alarmSnooze" };
    default: return undefined;
  }
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
export function toastXml(notice: { title: string; lines: string[]; kind: "tasks"; ids: string[] } | { title: string; lines: string[]; kind: "alarm" }, lang: Lang = "ko"): string {
  const word = words[lang];
  const actions = notice.kind === "tasks"
    ? [[word.done, notifyLink({ kind: "done", ids: notice.ids })], [word.later, notifyLink({ kind: "snooze", ids: notice.ids, minutes: 10 })]]
    : [[word.stop, notifyLink({ kind: "alarmStop" })], [word.again, notifyLink({ kind: "alarmSnooze" })]];
  const text = [notice.title, ...notice.lines.slice(0, 2)].map((line) => `<text>${escape(line)}</text>`).join("");
  return `<toast activationType="protocol" launch="${escape(notifyLink({ kind: "open" }))}"${notice.kind === "alarm" ? ' scenario="alarm"' : ""}>`
    + `<visual><binding template="ToastGeneric">${text}</binding></visual>`
    + `<actions>${actions.map(([label, link]) => `<action content="${escape(label)}" activationType="protocol" arguments="${escape(link)}"/>`).join("")}</actions>`
    + `</toast>`;
}

/** The button words of a toast (macOS demo runs show the same two as notification actions). */
export const notifyButtons = (kind: "tasks" | "alarm", lang: Lang = "ko"): [string, string] =>
  kind === "tasks" ? [words[lang].done, words[lang].later] : [words[lang].stop, words[lang].again];
