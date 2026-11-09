import path from "node:path";

/**
 * #175 (security review S-01): how Claude Code starts 종이냥 for Claude without Electron's RunAsNode, which is off.
 * `종이냥.exe --mcp-stdio` (exactly that, nothing more) runs only the server built into the app (out/mcp.js, inside
 * the checked app.asar) over stdin/stdout. There is no argument naming a script: the mode can't load anything else.
 *
 * Commands copied before (1.27 – 1.33) were `-e ELECTRON_RUN_AS_NODE=1 -- "…\종이냥.exe" "…\resources\mcp\server\index.js"`.
 * With the fuse off Electron no longer reads that variable and starts the app with the path as its argument; that
 * exact pair (the variable and this install's own server path) is taken as the same mode, so those keep working.
 * The path is only compared, never loaded. Anything else with the variable set (another path, other arguments) is
 * refused rather than opening windows for a program that expected Node.
 */
export const mcpStdioFlag = "--mcp-stdio";

/** serve: run the server; refuse: say why on stderr and stop; undefined: the app as usual. */
export type McpStdioMode = "serve" | "refuse" | undefined;

/**
 * `args`: the command line after the program (and, while developing, after the app folder). `legacyServer`: where
 * this install kept the server the old command named (resources\mcp\server\index.js).
 */
export function mcpStdioMode(args: readonly string[], env: Record<string, string | undefined>, legacyServer: string, windows = process.platform === "win32"): McpStdioMode {
  if (args.length === 1 && args[0] === mcpStdioFlag) return "serve";
  // Electron counts the variable as set when it isn't empty.
  if (!env.ELECTRON_RUN_AS_NODE) return undefined;
  return args.length === 1 && samePath(args[0], legacyServer, windows) ? "serve" : "refuse";
}

function samePath(a: string, b: string, windows: boolean): boolean {
  const way = windows ? path.win32 : path.posix;
  const [left, right] = [way.resolve(a), way.resolve(b)];
  return windows ? left.toLowerCase() === right.toLowerCase() : left === right;
}
