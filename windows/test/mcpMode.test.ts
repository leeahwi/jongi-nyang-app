import assert from "node:assert/strict";
import { test } from "node:test";
import { mcpStdioMode } from "../src/main/mcpMode";

/**
 * #175: 종이냥.exe --mcp-stdio, the Claude Code connection with Electron's RunAsNode off. The flag alone runs the
 * server built into the app; the command copied before (ELECTRON_RUN_AS_NODE=1 and this install's server path)
 * does the same; nothing else turns the app into a program that runs a script.
 */

const server = "C:\\Users\\me\\AppData\\Local\\Programs\\종이냥\\resources\\mcp\\server\\index.js";
const mode = (args: string[], env: Record<string, string> = {}) => mcpStdioMode(args, env, server, true);

test("--mcp-stdio alone serves; with anything beside it the app starts as usual", () => {
  assert.equal(mode(["--mcp-stdio"]), "serve");
  assert.equal(mode([]), undefined);
  assert.equal(mode(["--quick"]), undefined);
  assert.equal(mode(["--mcp-stdio", "C:\\evil.js"]), undefined, "no script after the flag");
  assert.equal(mode(["C:\\evil.js", "--mcp-stdio"]), undefined);
  assert.equal(mode(["--MCP-STDIO"]), undefined, "the flag exactly");
});

test("the old command (1.27–1.33): ELECTRON_RUN_AS_NODE=1 and this install's server path serve the same way", () => {
  const old = { ELECTRON_RUN_AS_NODE: "1" };
  assert.equal(mode([server], old), "serve");
  assert.equal(mode([server.toUpperCase()], old), "serve", "Windows paths: case doesn't matter");
  assert.equal(mode(["C:\\Users\\me\\AppData\\Local\\Programs\\종이냥\\resources\\mcp\\server\\..\\server\\index.js"], old), "serve");
  assert.equal(mode([server], {}), undefined, "the path without the variable: the app as usual");
  assert.equal(mode([server], { ELECTRON_RUN_AS_NODE: "" }), undefined, "an empty variable is not set");
});

test("ELECTRON_RUN_AS_NODE with anything else is refused: no other script, no windows", () => {
  const old = { ELECTRON_RUN_AS_NODE: "1" };
  assert.equal(mode([], old), "refuse");
  assert.equal(mode(["C:\\Users\\me\\evil.js"], old), "refuse");
  assert.equal(mode(["D:\\old\\종이냥\\resources\\mcp\\server\\index.js"], old), "refuse", "another install's path");
  assert.equal(mode([server, "--inspect"], old), "refuse");
  assert.equal(mode(["-e", "require('child_process')"], old), "refuse");
  assert.equal(mode(["--mcp-stdio"], old), "serve", "the new flag wins");
});

test("on a Mac (developing): paths compared as they are", () => {
  const mac = "/Applications/Electron.app/Contents/Resources/mcp/server/index.js";
  assert.equal(mcpStdioMode([mac], { ELECTRON_RUN_AS_NODE: "1" }, mac, false), "serve");
  assert.equal(mcpStdioMode([mac.toUpperCase()], { ELECTRON_RUN_AS_NODE: "1" }, mac, false), "refuse");
});
