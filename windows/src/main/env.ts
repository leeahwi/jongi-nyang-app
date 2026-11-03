/**
 * #174 (security review L-07): the switches tests, snapshots and the perf tools start the app with — PAPERTODO_SNAPSHOT,
 * --demo (and its PAPERTODO_DEMO_DATA · _DEMO_AI), PAPERTODO_LANG · _CLOCK, --weekly-now — exist only when tools/build.mjs
 * builds without --production (`__TEST_HOOKS__`). A release build reads none of them. PAPERTODO_OFFSCREEN and
 * PAPERTODO_NO_SHORTCUTS stay: they write nothing and only keep a run out of sight and off the system's keys.
 */
declare const __TEST_HOOKS__: boolean;
export const testHooks: boolean = __TEST_HOOKS__;

/** Tests and snapshots draw sample reminders far off every display instead of over real work. */
export const offscreenEnabled = process.env.PAPERTODO_OFFSCREEN === "1";
export const offscreen = offscreenEnabled ? { x: -40_000, y: -40_000 } : { x: 0, y: 0 };
/** Test runs on a machine whose own apps use Ctrl+Alt+N / M: the system-wide shortcuts are left alone. */
export const shortcutsDisabled = process.env.PAPERTODO_NO_SHORTCUTS === "1";
