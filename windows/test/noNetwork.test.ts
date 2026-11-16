import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// #398: README and the privacy page promise that the app has no code that connects to the internet. This test keeps
// that true: it reads every source file that ships (src/ and the Claude extension's mcp/src/) and fails on any way
// to open a connection. The one way out is a link handed to the system's browser (shell.openExternal), and only in
// src/main/security.ts, which lets http · https · mailto through (core/webGuard.ts).

const root = process.cwd();
const shipped = ["src", "mcp/src"];

/** Each way a file could reach the network. A line that matches one fails the test unless `allowed` lists it. */
const forbidden: { name: string; pattern: RegExp }[] = [
  { name: "Node network module", pattern: /(?:from\s*|require\s*\(\s*|import\s*\(\s*)["'](?:node:)?(?:net|http|https|http2|tls|dgram|dns|dns\/promises|undici|ws)["']/ },
  { name: "Electron net", pattern: /import\s*\{[^}]*\bnet\b[^}]*\}\s*from\s*["']electron["']|\bnet\.(?:request|fetch)\s*\(/ },
  { name: "fetch", pattern: /(?<![\w$])fetch\s*\(/ },
  { name: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { name: "WebSocket", pattern: /\bWebSocket\b/ },
  { name: "EventSource", pattern: /\bEventSource\b/ },
  { name: "sendBeacon", pattern: /\bsendBeacon\b/ },
  { name: "WebRTC", pattern: /\bRTCPeerConnection\b/ },
  { name: "MCP network transport", pattern: /@modelcontextprotocol\/sdk\/[^"']*(?:sse|streamableHttp|websocket)/i },
  { name: "a window loading a web address", pattern: /\bloadURL\s*\(\s*["'`]https?:/ },
  { name: "a page loading from the web", pattern: /<(?:script|link|img|iframe|source|video|audio)\b[^>]*\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i },
  { name: "a style loading from the web", pattern: /(?<![\w.])url\(\s*["']?(?:https?:)?\/\/|@import\s+["'](?:https?:)?\/\//i },
  { name: "a link to the system", pattern: /\bopenExternal\s*\(/ },
];

/** The lines that may match: file → the forbidden names allowed there. */
const allowed: Record<string, string[]> = {
  "src/main/security.ts": ["a link to the system"],
};

function filesIn(folder: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
    const relative = path.posix.join(folder, entry.name);
    if (entry.isDirectory()) out.push(...filesIn(relative));
    else if (/\.(?:[cm]?[jt]s|html|css)$/.test(entry.name)) out.push(relative);
  }
  return out;
}

/** The forbidden uses in `text`: comment lines (`//`, `*`) are skipped, so a comment may name what it guards against. */
function findUses(text: string): { line: number; name: string }[] {
  const hits: { line: number; name: string }[] = [];
  text.split("\n").forEach((line, index) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
    for (const { name, pattern } of forbidden) if (pattern.test(line)) hits.push({ line: index + 1, name });
  });
  return hits;
}

test("no shipped source file opens a network connection (#398)", () => {
  const files = shipped.flatMap(filesIn);
  assert.ok(files.length > 100, `read ${files.length} files`);
  const found: string[] = [];
  for (const file of files) {
    for (const hit of findUses(fs.readFileSync(path.join(root, file), "utf8"))) {
      if (!(allowed[file] ?? []).includes(hit.name)) found.push(`${file}:${hit.line} ${hit.name}`);
    }
  }
  assert.deepEqual(found, []);
});

test("the one way out is still there: security.ts hands links to the system", () => {
  const uses = findUses(fs.readFileSync(path.join(root, "src/main/security.ts"), "utf8"));
  assert.deepEqual(uses.map((hit) => hit.name), ["a link to the system"]);
});

test("every page refuses connections: default-src 'self' and no connect-src", () => {
  const pages = fs.readdirSync(path.join(root, "src/renderer")).filter((name) => name.endsWith(".html"));
  assert.ok(pages.length > 0);
  for (const page of pages) {
    const policy = fs.readFileSync(path.join(root, "src/renderer", page), "utf8").match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1];
    assert.ok(policy, `${page}: a Content-Security-Policy`);
    assert.match(policy, /(?:^|;\s*)default-src 'self'(?:;|$)/, page);
    assert.doesNotMatch(policy, /connect-src|https?:|\*/, page);
  }
});

test("the patterns catch what they are for", () => {
  const caught = (line: string) => findUses(line).map((hit) => hit.name);
  assert.deepEqual(caught(`import https from "node:https";`), ["Node network module"]);
  assert.deepEqual(caught(`const http = require("http");`), ["Node network module"]);
  assert.deepEqual(caught(`import { app, net } from "electron";`), ["Electron net"]);
  assert.deepEqual(caught(`const answer = await fetch(url);`), ["fetch"]);
  assert.deepEqual(caught(`await session.defaultSession.fetch(url);`), ["fetch"]);
  assert.deepEqual(caught(`new WebSocket("wss://example.com")`), ["WebSocket"]);
  assert.deepEqual(caught(`navigator.sendBeacon("/x", body)`), ["sendBeacon"]);
  assert.deepEqual(caught(`import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";`), ["MCP network transport"]);
  assert.deepEqual(caught(`window.loadURL("https://example.com")`), ["a window loading a web address"]);
  assert.deepEqual(caught(`<script src="https://cdn.example.com/x.js"></script>`), ["a page loading from the web"]);
  assert.deepEqual(caught(`@import "https://fonts.example.com/a.css";`), ["a style loading from the web"]);
  assert.deepEqual(caught(`void shell.openExternal(url);`), ["a link to the system"]);
  // What the app does use stays quiet: stdio for Claude, the SVG namespace, data: images, prefetch-free words.
  assert.deepEqual(caught(`import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";`), []);
  assert.deepEqual(caught(`document.createElementNS("http://www.w3.org/2000/svg", "svg");`), []);
  assert.deepEqual(caught(`background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E");`), []);
  assert.deepEqual(caught(`// fetch(url) is never called`), []);
  assert.deepEqual(caught(`const fetched = prefetchRows(list);`), []);
});
