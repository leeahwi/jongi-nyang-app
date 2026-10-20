/** Tests and snapshots draw sample reminders far off every display instead of over real work. */
export const offscreenEnabled = process.env.PAPERTODO_OFFSCREEN === "1";
export const offscreen = offscreenEnabled ? { x: -40_000, y: -40_000 } : { x: 0, y: 0 };
/** Test runs on a machine whose own apps use Ctrl+Alt+N / M: the system-wide shortcuts are left alone. */
export const shortcutsDisabled = process.env.PAPERTODO_NO_SHORTCUTS === "1";
