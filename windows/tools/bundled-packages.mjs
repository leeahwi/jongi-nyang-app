// Lists the npm packages that end up inside what ships, for NOTICE (#128): the app's own bundles
// (src → out/, the same entry points as tools/build.mjs) and the Claude extension's server
// (mcp/src → mcp/dist/server/index.js, which the Mac app also carries). Electron ships as the runtime.
// `node tools/bundled-packages.mjs`
import { build } from "esbuild";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The node_modules packages esbuild pulls into a bundle of `entryPoints` (electron stays outside, as in the build). */
async function packagesIn(entryPoints) {
  const result = await build({ entryPoints, bundle: true, write: false, metafile: true, platform: "node", outdir: path.join(root, "out-unused"), logLevel: "silent", external: ["electron"] });
  const folders = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    const at = input.lastIndexOf("node_modules/");
    if (at < 0) continue;
    const rest = input.slice(at + "node_modules/".length).split("/");
    folders.add(input.slice(0, at) + "node_modules/" + (rest[0].startsWith("@") ? rest.slice(0, 2).join("/") : rest[0]));
  }
  return [...folders].sort();
}

async function describe(folder) {
  const pkg = JSON.parse(await readFile(path.resolve(root, folder, "package.json"), "utf8"));
  const licence = typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? "(see the package)";
  return `${pkg.name}@${pkg.version}  ${licence}`;
}

const renderers = (await readdir(path.join(root, "src/renderer"))).filter((name) => name.endsWith(".ts")).map((name) => path.join(root, "src/renderer", name));
// out/mcp.js (#175) is the extension's server again: its packages are listed under it, not here.
const app = await packagesIn([path.join(root, "src/main/entry.ts"), path.join(root, "src/main/main.ts"), path.join(root, "src/preload.ts"), ...renderers]);
const server = await packagesIn([path.join(root, "mcp/src/index.ts")]);

console.log("App bundles (out/):");
console.log(app.length ? (await Promise.all(app.map(describe))).map((line) => "  " + line).join("\n") : "  none: only the app's own code");
console.log("Claude extension server (mcp/dist/server/index.js, in the .mcpb and both apps; out/mcp.js in the Windows app):");
console.log((await Promise.all(server.map(describe))).map((line) => "  " + line).join("\n"));
console.log("Runtime:");
console.log("  " + await describe("node_modules/electron"));
