// Renders every window with sample data into snapshots/, off-screen, then quits; the size sweep
// goes to snapshots/sweep/ and fails the run on layout problems. `npm run snapshot -- sweep` runs only the sweep.
// `-- lang=en` or `-- lang=nl` runs in English or Dutch, into snapshots/en/ or snapshots/nl/ (Korean: snapshots/).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const lang = args.find((arg) => arg.startsWith("lang="))?.slice(5) ?? "ko";
if (!["ko", "en", "nl"].includes(lang)) {
  console.error(`snapshot: unknown language ${lang} (ko, en, nl)`);
  process.exit(2);
}
const only = args.find((arg) => !arg.startsWith("lang=")) ?? "";
const directory = lang === "ko" ? path.join(root, "snapshots") : path.join(root, "snapshots", lang);
const result = spawnSync(electron, [root], {
  stdio: "inherit",
  env: { ...process.env, PAPERTODO_SNAPSHOT: directory, PAPERTODO_OFFSCREEN: "1", PAPERTODO_SNAPSHOT_ONLY: only, PAPERTODO_LANG: lang },
  timeout: 5_400_000, // a full run (every shot, then the day and night sweeps) on a busy machine
});
process.exit(result.status ?? 1);
