import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import zlib from "node:zlib";

// #225: the release path check (tools/check-release-paths.mjs, run by both apps' release builds) on fictional temporary
// folders. A planted path must fail it — as text, as UTF-16LE, deflated in a zip inside a zip, as a link — and a clean
// folder must pass. The planted paths name no real account.

const script = path.resolve(process.cwd(), "..", "tools", "check-release-paths.mjs");
const planted = "/Users/sample-builder/jongi-nyang/node_modules/zod/index.js";

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "paper-todo-release-paths-"));
const put = (folder: string, name: string, data: string | Buffer) => {
  const file = path.join(folder, ...name.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
};
const run = (...targets: string[]) => {
  const result = spawnSync(process.execPath, [script, ...targets], { cwd: os.tmpdir(), encoding: "utf8" });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (data: Buffer) => {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
// A plain zip (deflated entries), as .mcpb and electron-builder's zip are.
const zip = (entries: Record<string, string | Buffer>) => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const packed = zlib.deflateRawSync(data);
    const fileName = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(fileName.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, packed);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};

// A release-like folder: a script, UTF-16LE resources, a .mcpb inside a zip.
const releaseFolder = (server = "module.exports = { name: \"jongi-nyang\" };\n") => {
  const folder = temporary();
  put(folder, "종이냥.app/Contents/Info.plist", "<plist><dict><key>CFBundleName</key><string>종이냥</string></dict></plist>\n");
  put(folder, "종이냥.app/Contents/Resources/ko.lproj/Localizable.strings", Buffer.from("\"Today\" = \"오늘\";\n", "utf16le"));
  const mcpb = zip({ "manifest.json": "{ \"name\": \"jongi-nyang\" }\n", "server/index.js": server });
  put(folder, "release/JongiNyang-0.0.0-x64.zip", zip({ "resources/mcp/jongi-nyang.mcpb": mcpb, "LICENSE.txt": "MIT\n" }));
  return folder;
};

test("a clean release folder passes", () => {
  const folder = releaseFolder();
  try {
    const { code, output } = run(folder);
    assert.equal(code, 0, output);
    // The plist, the strings, the zip, and inside it the license, the .mcpb and the .mcpb's two files.
    assert.match(output, /no build-folder paths in 7 file\(s\)/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("a path as plain text fails, and only its count and file name are shown", () => {
  const folder = releaseFolder();
  try {
    put(folder, "종이냥.app/Contents/Resources/mcp/server/index.js", `// ${planted}\n// ${planted}\nmodule.exports = {};\n`);
    const { code, output } = run(folder);
    assert.equal(code, 1, output);
    assert.match(output, /종이냥\.app\/Contents\/Resources\/mcp\/server\/index\.js: \/Users\/ \(ASCII\) × 2/);
    assert.doesNotMatch(output, /sample-builder/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("a path in UTF-16LE fails", () => {
  const folder = releaseFolder();
  try {
    put(folder, "종이냥.app/Contents/Resources/en.lproj/Localizable.strings", Buffer.from(`"Folder" = "${planted}";\n`, "utf16le"));
    const { code, output } = run(folder);
    assert.equal(code, 1, output);
    assert.match(output, /en\.lproj\/Localizable\.strings: \/Users\/ \(UTF-16LE\) × 1/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("a path deflated in a .mcpb inside a zip fails, named by where it is in the archives", () => {
  const folder = releaseFolder(`// ../../../Users/sample-builder/node_modules/zod/index.js\nmodule.exports = {};\n`);
  try {
    const { code, output } = run(folder);
    assert.equal(code, 1, output);
    assert.match(output, /JongiNyang-0\.0\.0-x64\.zip!\/resources\/mcp\/jongi-nyang\.mcpb!\/server\/index\.js: \/Users\/ \(ASCII\) × 1, \.\.\/\.\.\/\.\.\/ \(ASCII\) × 1/);
    // Deflated, the bytes of the outer zip don't hold it: only opening both archives finds it.
    assert.equal(fs.readFileSync(path.join(folder, "release/JongiNyang-0.0.0-x64.zip")).includes("/Users/"), false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("each kind of build-folder path fails", () => {
  for (const text of ["/private/tmp/jongi-nyang-build", "/private/var/folders/xy/sample/T/build", "/var/folders/xy/sample/T/build", "../../../build/index.js"]) {
    const folder = releaseFolder();
    try {
      put(folder, "out/main.js", `const where = "${text}";\n`);
      const { code, output } = run(folder);
      assert.equal(code, 1, `${text}: ${output}`);
      assert.match(output, /out\/main\.js: /);
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  }
});

test("only Electron's own resolver text is allowed, only in the app's exe and only twice", () => {
  const resolver = "`${isScoped ? '../' : ''}../../../node_modules/${packageName}/package.json`";
  const cases: [string, string, number][] = [
    ["win-unpacked/종이냥.exe", `MZ ${resolver} ../../../node_modules/ `, 0],
    ["win-unpacked/종이냥.exe", `MZ ${resolver} ${resolver} ${resolver}`, 1],
    ["win-unpacked/종이냥.exe", `MZ ${resolver} // ../../../node_modules/zod/index.js // ../../../Users/sample-builder/`, 1],
    ["win-unpacked/resources/app.asar", `${resolver}`, 1],
  ];
  for (const [name, text, expected] of cases) {
    const folder = releaseFolder();
    try {
      put(folder, name, text);
      const { code, output } = run(folder);
      assert.equal(code, expected, `${name} ${text}: ${output}`);
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  }
});

test("the home folder is found and shown as <home>", () => {
  const folder = releaseFolder();
  try {
    put(folder, "out/main.js", `const where = ${JSON.stringify(path.join(os.homedir(), "jongi-nyang"))};\n`);
    const { code, output } = run(folder);
    assert.equal(code, 1, output);
    assert.match(output, /<home> \(ASCII\) × 1/);
    assert.equal(output.includes(os.homedir()), false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("a link to a build folder fails", { skip: process.platform === "win32" }, () => {
  const folder = releaseFolder();
  try {
    fs.symlinkSync(planted, path.join(folder, "종이냥.app/Contents/Resources/node_modules"));
    const { code, output } = run(folder);
    assert.equal(code, 1, output);
    assert.match(output, /Resources\/node_modules \(link\): \/Users\/ \(ASCII\) × 1/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("what can't be read never passes", () => {
  const folder = releaseFolder();
  try {
    put(folder, "broken.mcpb", "PK\u0003\u0004 not really a zip");
    assert.equal(run(folder).code, 2);
    assert.equal(run(path.join(folder, "missing")).code, 2);
    assert.equal(run().code, 2);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
