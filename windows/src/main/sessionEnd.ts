/**
 * #383: Windows shutting down, restarting or logging off sends no `before-quit` · `will-quit`, so the saves still
 * waiting (memos 400 ms, settings 300 ms, 메모 서랍's typing up to 1 s) would be lost. The note window hears
 * `query-session-end` (Windows asks whether it may end the session) and `session-end` (it is ending now).
 *
 * - `query-session-end`: the pages are asked to send what is typed (best effort: the answer may come after
 *   Windows has moved on), and everything waiting is written.
 * - `session-end`: everything waiting is written again, at once — what the pages sent since comes along.
 *
 * Neither stops Windows: nothing here calls preventDefault.
 */
export interface SessionWindow {
  on(event: "query-session-end" | "session-end", listener: () => void): unknown;
}

export interface SessionEndHooks {
  /** Asks the windows to hand over what is being typed (the note's line and memo, 메모 서랍's open memo). */
  commitTyping(): void;
  /** Writes every save still waiting (Store.flush). */
  flush(): void;
}

export function saveOnSessionEnd(window: SessionWindow, hooks: SessionEndHooks): void {
  window.on("query-session-end", () => {
    try { hooks.commitTyping(); } catch { /* a page already gone: its text was sent when it went */ }
    hooks.flush();
  });
  window.on("session-end", () => hooks.flush());
}
