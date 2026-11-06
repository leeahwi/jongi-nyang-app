// 종이냥 for Claude: bundles mcp/src into one file (mcp/dist/server/index.js, no node_modules at run time,
// Node 18 or newer) and packs it with the manifest and the cat icon into mcp/dist/jongi-nyang.mcpb.
// `npm run mcp:build`; `--tests` also bundles mcp/test for `npm run mcp:test`.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkReleasePaths } from "../../tools/check-release-paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(here, "dist");
const version = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;

// Written beside the old files and swapped in at the end, so a copy taken meanwhile (the Mac build) is never half a file.
const pack = path.join(dist, "pack");
await rm(pack, { recursive: true, force: true });
// #174 (review L-07): two builds of the server. server/index.js ships (the .mcpb, both apps) with the tests' switches
// compiled out (`__TEST_HOOKS__` false: no PAPERTODO_AI_* is read); server-test/index.js keeps them for npm run mcp:test
// and mac/scripts/ai-check.sh, which point it at temporary folders. Never ship server-test.
const server = async (hooks, outfile) => {
  const result = await build({
    entryPoints: [path.join(here, "src/index.ts")], outfile,
    // minifySyntax drops the `false ? …` branches, so the shipped file doesn't even name the switches (names and lines stay).
    bundle: true, platform: "node", format: "cjs", target: "node18", logLevel: "warning", legalComments: "none", minifySyntax: true,
    define: { __VERSION__: JSON.stringify(version), __TEST_HOOKS__: String(hooks) },
    banner: { js: `// 종이냥 for Claude ${version}${hooks ? " (test build: never ship)" : ""} — built from mcp/src (paper-todo-windows). © 2026 leeAhwi.` },
    metafile: true,
  });
  // #225: the bundle names each module by its path from the working folder. In 1.42.1 node_modules resolved into a
  // sibling clone, so those names climbed into the home folder (../../../Users/…). Every input must be inside windows/.
  const inside = realpathSync(root);
  const outside = Object.keys(result.metafile.inputs)
    .map((input) => path.resolve(input.replace(/^\([^)]*\):/, "")))
    .filter((input) => { const relative = path.relative(inside, input); return relative.startsWith("..") || path.isAbsolute(relative); });
  if (outside.length > 0) {
    await rm(outfile, { force: true });
    const names = [...new Set(outside.map((input) => input.split(path.sep).includes("node_modules") ? "node_modules" : "source"))];
    console.error(`mcp/build.mjs: ${outside.length} input file(s) (${names.join(", ")}) come from outside windows/ — run npm ci in windows/ and build there (#225).`);
    process.exit(1);
  }
};
await server(false, path.join(dist, "server/index.js.new"));
await server(true, path.join(dist, "server-test/index.js"));

// The bundle's folder: manifest (the app's version), the cat, the server.
await mkdir(path.join(pack, "server"), { recursive: true });
const manifest = JSON.parse(await readFile(path.join(here, "manifest.json"), "utf8"));
manifest.version = version;
await writeFile(path.join(pack, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await cp(path.join(root, "build/icon.png"), path.join(pack, "icon.png"));
// English and Dutch descriptions for Claude Desktop (Korean is the manifest's own, the default locale).
await cp(path.join(here, "resources"), path.join(pack, "mcpb-resources"), { recursive: true });
await cp(path.join(dist, "server/index.js.new"), path.join(pack, "server/index.js"));
const cli = path.join(root, "node_modules/@anthropic-ai/mcpb/dist/cli/cli.js");
execFileSync(process.execPath, [cli, "validate", path.join(pack, "manifest.json")], { stdio: "inherit" });
execFileSync(process.execPath, [cli, "pack", pack, path.join(dist, "jongi-nyang.mcpb.new")], { stdio: ["ignore", "ignore", "inherit"] });
await rm(pack, { recursive: true, force: true });
// #225: the shipped files are searched for build-folder paths before they replace the old ones.
if (await checkReleasePaths([path.join(dist, "server/index.js.new"), path.join(dist, "jongi-nyang.mcpb.new")]) !== 0) {
  await rm(path.join(dist, "server/index.js.new"), { force: true });
  await rm(path.join(dist, "jongi-nyang.mcpb.new"), { force: true });
  process.exit(1);
}
await rename(path.join(dist, "server/index.js.new"), path.join(dist, "server/index.js"));
await rename(path.join(dist, "jongi-nyang.mcpb.new"), path.join(dist, "jongi-nyang.mcpb"));

if (process.argv.includes("--tests")) {
  const out = path.join(root, "out-test-mcp");
  await rm(out, { recursive: true, force: true });
  const files = (await readdir(path.join(here, "test"))).filter((name) => name.endsWith(".test.ts"));
  await build({
    entryPoints: files.map((name) => path.join(here, "test", name)), outdir: out, outExtension: { ".js": ".mjs" },
    bundle: true, platform: "node", format: "esm", target: "node20", logLevel: "warning", define: { __TEST_HOOKS__: "true" },
    // The SDK's client needs require() for its stdio spawn helper.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  });
}
console.log(`종이냥 for Claude ${version}: mcp/dist/server/index.js, mcp/dist/jongi-nyang.mcpb (and the test build, mcp/dist/server-test/index.js)`);
