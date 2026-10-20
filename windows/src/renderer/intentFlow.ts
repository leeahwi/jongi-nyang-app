import { addedText, preferenceKey, switchText, type Candidate } from "../core/intent";
import type { IntentMade, IntentPage, WireCandidate } from "../core/types";
import { lang, paper, t } from "./api";
import { kindIcon } from "./inputLine";
import type { ToastOptions } from "./slip";

/**
 * Putting a reading of the 입력 줄 in, and the toast after it: "일정으로 넣었어요 · 내일 15:00" with
 * the switch to the next reading ("할 일로 바꾸기": what was made goes without a trace and the next
 * reading is made; two switches the same way are learned), 멈추기 for a timer, 되돌리기 for an
 * alarm. Ctrl+Z while the toast is up takes the last one back.
 */

const api = paper();

export const toWire = (candidate: Candidate): WireCandidate =>
  candidate.kind === "todo" ? { ...candidate, reminderAt: candidate.reminderAt?.toISOString() } : candidate;
export const fromWire = (candidate: WireCandidate): Candidate =>
  candidate.kind === "todo" ? { ...candidate, reminderAt: candidate.reminderAt ? new Date(candidate.reminderAt) : undefined } : candidate;

interface Shown { made: IntentMade; text: string }
let last: Shown | undefined;

export interface FlowHost {
  toast: { show(options: ToastOptions): void; hide(): void; readonly visible: boolean };
  page: () => IntentPage;
  /** The text goes back into the line (taken back with Ctrl+Z or 되돌리기). */
  restore?: (text: string) => void;
}

/** Puts `candidate` in; shows its toast unless 빠른 입력 handed it to the note. Returns what was made. */
export async function commitReading(host: FlowHost, candidate: Candidate, candidates: readonly Candidate[], text: string, from: "note" | "quick" | "glance"): Promise<{ made?: IntentMade; inNote?: boolean }> {
  const result = await api.intent({ op: "commit", candidate: toWire(candidate), page: host.page(), from, candidates: candidates.map(toWire), text });
  if (!result.made) return {};
  if (!result.inNote) showMade(host, result.made, candidate, candidates, text);
  return result;
}

/** The toast for something just made, with what its action does. */
export function showMade(host: FlowHost, made: IntentMade, candidate: Candidate, candidates: readonly Candidate[], text: string): void {
  last = { made, text };
  const others = candidates.filter((entry) => entry !== candidate && entry.kind !== candidate.kind);
  const position = candidates.indexOf(candidate);
  const next = others.length ? [...candidates.slice(position + 1), ...candidates.slice(0, position)].find((entry) => others.includes(entry)) : undefined;
  const undo = async (restore: boolean) => {
    await api.intent({ op: "undo", made });
    if (last?.made === made) last = undefined;
    if (restore) host.restore?.(text);
  };
  let action: ToastOptions["action"];
  if (candidate.kind === "timer") action = { label: t("멈추기"), run: () => void undo(false) };
  else if (candidate.kind === "alarm" || !next) action = { label: t("되돌리기"), run: () => void undo(true) };
  else {
    action = {
      label: switchText(next.kind, lang()),
      run: async () => {
        await api.intent({ op: "undo", made });
        const result = await api.intent({ op: "commit", candidate: toWire(next), page: host.page(), from: "note" });
        void api.intent({ op: "learn", key: preferenceKey(text, new Date(), lang()), from: candidate.kind, to: next.kind });
        if (result.made) showMade(host, result.made, next, candidates, text);
      },
    };
  }
  host.toast.show({ icon: kindIcon[candidate.kind], text: addedText(candidate, new Date(), lang()), action, onHide: () => { if (last?.made === made) last = undefined; } });
}

/** Ctrl+Z right after putting a line in (the toast still up): it goes, and its text comes back. */
export async function undoLast(host: FlowHost): Promise<boolean> {
  if (!last || !host.toast.visible) return false;
  const { made, text } = last;
  last = undefined;
  host.toast.hide();
  await api.intent({ op: "undo", made });
  host.restore?.(text);
  return true;
}
