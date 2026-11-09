import { app } from "electron";
import path from "node:path";
import { mcpStdioMode } from "./mcpMode";

/**
 * The app's first file (package.json main → out/main.js). Usually it only loads the app (out/app.js, built from
 * main.ts). Started by Claude Code as `종이냥.exe --mcp-stdio` (#175, mcpMode.ts) it loads 종이냥 for Claude instead
 * (out/mcp.js, built from mcp/src) and nothing of the app: no single-instance lock, no windows, no tray, no
 * shortcuts, so a running 종이냥 is never woken by it. It ends when Claude closes stdin.
 */

const args = process.argv.slice(app.isPackaged ? 1 : 2);
const mode = mcpStdioMode(args, process.env, path.join(process.resourcesPath, "mcp", "server", "index.js"));

if (mode === "serve") serve();
else if (mode === "refuse") {
  process.stderr.write("종이냥: ELECTRON_RUN_AS_NODE is not supported. For Claude Code use: 종이냥.exe --mcp-stdio\n"); // i18n-ok: a log line
  app.exit(1);
} else require(path.join(__dirname, "app.js"));

function serve(): void {
  // stdout carries only MCP messages: anything else logged goes to stderr (Claude Code's MCP log).
  const toStderr = console.error.bind(console);
  Object.assign(console, { log: toStderr, info: toStderr, debug: toStderr, warn: toStderr, trace: toStderr });
  const quit = (code: number) => app.exit(code);
  // In the main process an uncaught error would show Electron's error box; here it is a log line and the end.
  process.on("uncaughtException", (error) => {
    process.stderr.write(`jongi-nyang: ${error instanceof Error ? error.message : String(error)}\n`);
    quit(1);
  });
  process.stdout.on("error", () => quit(0)); // Claude went away while a reply was on its way.
  process.stdin.once("end", () => quit(0));
  process.stdin.once("close", () => quit(0));
  // Chromium still keeps a small profile (Local State, a GPU cache) even with no window: in a folder of its own, so it
  // never writes into the running app's (%APPDATA%\종이냥). Several Claude Code sessions may share this one.
  app.setPath("userData", path.join(app.getPath("userData"), "mcp-stdio"));
  // No pages here: no hardware GPU, and no Dock icon while developing on a Mac.
  app.disableHardwareAcceleration();
  app.dock?.hide();
  require(path.join(__dirname, "mcp.js"));
}
