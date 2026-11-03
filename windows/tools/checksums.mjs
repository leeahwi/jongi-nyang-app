// #175 (security review S-01): the SHA-256 of each file a release attaches — the installer and zip in dist/ for this
// version, and the Claude extension (mcp/dist/jongi-nyang.mcpb) — printed as the release notes' table (docs/release-notes.md)
// and written to dist/SHA256SUMS.txt (`sha256sum -c` / `shasum -a 256 -c` read it). `npm run dist` runs it last.
// `node tools/checksums.mjs [more files…]`
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const dist = path.join(root, "dist");

const files = [
  ...(existsSync(dist) ? readdirSync(dist).filter((name) => name.startsWith(`JongiNyang-${version}-`) && /\.(exe|zip|msi|7z)$/.test(name)).map((name) => path.join(dist, name)) : []),
  path.join(root, "mcp", "dist", "jongi-nyang.mcpb"),
  ...process.argv.slice(2).map((file) => path.resolve(file)),
].filter((file) => existsSync(file));

if (files.length === 0) {
  console.error(`checksums: nothing to hash for ${version} (build first)`);
  process.exit(1);
}

const sha256 = (file) => new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  createReadStream(file).on("error", reject).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex")));
});

const rows = [];
for (const file of files) rows.push({ name: path.basename(file), hash: await sha256(file) });
console.log("SHA-256 (docs/release-notes.md · 파일 확인):");
console.log("| 파일 | SHA-256 |\n| --- | --- |");
for (const { name, hash } of rows) console.log(`| \`${name}\` | \`${hash}\` |`);
if (existsSync(dist)) {
  writeFileSync(path.join(dist, "SHA256SUMS.txt"), rows.map(({ name, hash }) => `${hash}  ${name}\n`).join(""));
  console.log(`(dist/SHA256SUMS.txt)`);
}
