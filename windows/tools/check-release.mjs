// #225: what `npm run dist` ships — dist/win-unpacked, this version's installer and zip, the Claude extension — searched
// for build-folder paths with the shared check (../tools/check-release-paths.mjs). Runs after electron-builder and
// before the checksums. On a hit the installer, the zip and the checksums are removed, so nothing that failed is left to
// attach (win-unpacked stays, to look into).
// `node tools/check-release.mjs`
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkReleasePaths } from "../../tools/check-release-paths.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const dist = path.join(root, "dist");
const unpacked = path.join(dist, "win-unpacked");
const artifacts = existsSync(dist) ? readdirSync(dist).filter((name) => name.startsWith(`JongiNyang-${version}-`)).map((name) => path.join(dist, name)) : [];
const shipped = artifacts.filter((file) => /\.(exe|zip)$/.test(file));

if (!existsSync(unpacked) || !shipped.some((file) => file.endsWith(".exe")) || !shipped.some((file) => file.endsWith(".zip"))) {
  console.error(`check-release: dist/win-unpacked and the ${version} installer and zip are needed (electron-builder --win --x64 first)`);
  process.exit(2);
}

// #272 · #273: 바탕화면에 두기 needs Koffi's binary beside the app (main/stayBehind.ts); without it the windows stay ordinary.
if (!existsSync(path.join(unpacked, "resources", "native", "koffi.node"))) {
  for (const file of [...artifacts, path.join(dist, "SHA256SUMS.txt")]) rmSync(file, { force: true });
  console.error(`check-release: resources/native/koffi.node is missing from dist/win-unpacked (node tools/native.mjs); removed the ${version} installer, zip and checksums from dist/.`);
  process.exit(1);
}

const extension = ["server/index.js", "jongi-nyang.mcpb"].map((file) => path.join(root, "mcp", "dist", file));
const code = await checkReleasePaths([unpacked, ...shipped, ...extension]);
if (code !== 0) {
  for (const file of [...artifacts, path.join(dist, "SHA256SUMS.txt")]) rmSync(file, { force: true });
  console.error(`check-release: removed the ${version} installer, zip and checksums from dist/.`);
}
process.exit(code);
