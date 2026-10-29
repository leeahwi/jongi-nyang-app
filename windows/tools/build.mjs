// Bundles the main process, preload and each window with esbuild, then copies HTML/CSS.
import { build } from "esbuild";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tests = process.argv.includes("--tests");
const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";

if (tests) {
  await rm(path.join(root, "out-test"), { recursive: true, force: true });
  const files = (await readdir(path.join(root, "test"))).filter((name) => name.endsWith(".test.ts"));
  await build({
    entryPoints: files.map((name) => path.join(root, "test", name)),
    outdir: path.join(root, "out-test"),
    outExtension: { ".js": ".mjs" },
    bundle: true, platform: "node", format: "esm", target: "node20", logLevel: "warning",
  });
} else {
  const out = path.join(root, "out");
  await rm(out, { recursive: true, force: true });
  const common = { bundle: true, logLevel: "warning", sourcemap: production ? false : "linked", minify: production };
  await build({ ...common, entryPoints: [path.join(root, "src/main/main.ts")], outfile: path.join(out, "main.js"), platform: "node", format: "cjs", target: "node22", external: ["electron"] });
  await build({ ...common, entryPoints: [path.join(root, "src/preload.ts")], outfile: path.join(out, "preload.js"), platform: "node", format: "cjs", target: "node22", external: ["electron"] });
  await build({
    ...common,
    entryPoints: ["note", "popup", "floating", "settings", "history", "calendarWindow", "pet", "timer", "help", "quick", "quickMemo", "timerSheet", "ring", "confirm", "glance", "desk", "drawer", "handle"].map((name) => path.join(root, "src/renderer", `${name}.ts`)),
    outdir: path.join(out, "renderer"), platform: "browser", format: "iife", target: "chrome130",
  });
  await mkdir(path.join(out, "renderer"), { recursive: true });
  for (const name of await readdir(path.join(root, "src/renderer"))) {
    if (name.endsWith(".html") || name.endsWith(".css")) await cp(path.join(root, "src/renderer", name), path.join(out, "renderer", name));
  }
}
