// The time zone first, before any Date: the server runs under the same one.
process.env.TZ = "Asia/Seoul";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { aiExtVersion, parseAiLog, serializeAiLink, type AiLink } from "../../src/core/ai";
import type { LocalEvent } from "../../src/core/events";
import { parseNotebook, serializeNotebook, type TodoItem } from "../../src/core/notebook";
import { temporaryFolder } from "../../test/temporaryFolder";

/**
 * What the extension's tests share: the real bundled server, its test build (mcp/dist/server-test/index.js — the one
 * that reads PAPERTODO_AI_*, #174; the shipped mcp/dist/server/index.js ignores them; PAPERTODO_MCP_SERVER
 * names another build, to measure an older one) over stdio with the SDK's client — which checks every result
 * against the tool's outputSchema (M38) — on temporary folders only (PAPERTODO_AI_HOME), fictional data only.
 */

export const server = process.env.PAPERTODO_MCP_SERVER
  ?? path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../mcp/dist/server-test/index.js");
export const temporary = () => temporaryFolder("paper-todo-ai-");
const clients: Client[] = [];
after(async () => { for (const client of clients) await client.close(); });

export interface Setup { home: string; data: string; clockFile: string; env: Record<string, string> }

/** A settings folder (and a data folder: the same one, or a separate "shared" one) with ai-link.json. */
export function setup(options: { link?: Partial<AiLink> | null; shared?: boolean; now?: string; lang?: string } = {}): Setup {
  const home = temporary();
  const data = options.shared ? temporary() : home;
  const clockFile = path.join(home, "clock.txt");
  fs.writeFileSync(clockFile, options.now ?? "2026-10-27T10:00:00+09:00");
  if (options.link !== null) {
    const link: AiLink = { v: 1, enabled: true, dataFolder: data, lang: "ko", app: "windows 1.27.0", updatedAt: "2026-10-27T00:00:00Z", ext: aiExtVersion, ...options.link };
    fs.writeFileSync(path.join(home, "ai-link.json"), serializeAiLink(link));
  }
  return { home, data, clockFile, env: { PAPERTODO_AI_HOME: home, PAPERTODO_AI_CLOCK: clockFile, TZ: "Asia/Seoul", LANG: options.lang ?? "ko_KR.UTF-8" } };
}

/** What each client's server wrote to stderr (Claude's MCP log). */
export const stderrOf = new WeakMap<Client, () => string>();

/** `args`: what follows `command` (the server's file for Node; the app's folder and --mcp-stdio for Electron, #175). */
export async function connect(env: Record<string, string>, command = process.execPath, name = "paper-todo-test", args = [server]): Promise<Client> {
  const client = new Client({ name, version: "1.0.0" });
  const base = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.startsWith("PAPERTODO_") && key !== "ELECTRON_RUN_AS_NODE")) as Record<string, string>;
  const transport = new StdioClientTransport({ command, args, env: { ...base, ...env }, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  stderrOf.set(client, () => stderr);
  await client.connect(transport);
  clients.push(client);
  // Listing the tools first makes the client check every result against its tool's outputSchema (M38).
  await client.listTools();
  return client;
}

/**
 * The places that must never reach Claude or the log (#109): the home folder, the temporary folder (both as
 * given and as the system resolves it), the user's name, and any other folder named; nor anything shaped
 * like a path.
 */
export function assertNoPath(text: string, label: string, ...folders: string[]): void {
  const tmp = os.tmpdir();
  const secrets = [os.homedir(), tmp, fs.realpathSync(tmp), os.userInfo().username, ...folders, ...folders.map((folder) => fs.existsSync(folder) ? fs.realpathSync(folder) : folder)];
  for (const secret of secrets.filter((value) => value && value.length >= 3)) assert.ok(!text.includes(secret), `${label}: no ‘${secret}’ in ${JSON.stringify(text)}`);
  assert.doesNotMatch(text, /[A-Za-z]:\\|\/[^\s/]+\/|\\[^\s\\]+\\/, `${label}: nothing shaped like a path`);
  assert.doesNotMatch(text, /EISDIR:|EACCES:|ENOENT:|errno|syscall|Unexpected token|JSON at position/, `${label}: not the system's own text`);
}

export type Result = { text: string; data: Record<string, unknown>; error: boolean };
export async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Result> {
  const result = await client.callTool({ name, arguments: args }) as { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
  return { text: result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"), data: result.structuredContent ?? {}, error: Boolean(result.isError) };
}

export const todos = (folder: string): TodoItem[] => parseNotebook(fs.readFileSync(path.join(folder, "todos.json"), "utf8")).items;
export const logOf = (home: string) => parseAiLog(fs.existsSync(path.join(home, "ai-log.jsonl")) ? fs.readFileSync(path.join(home, "ai-log.jsonl"), "utf8") : "");
export const task = (fields: Partial<TodoItem> & { title: string }): TodoItem => ({ id: crypto.randomUUID().toUpperCase(), isCompleted: false, createdAt: "2026-10-20T00:00:00Z", ...fields });
export const writeTodos = (folder: string, items: TodoItem[]) => fs.writeFileSync(path.join(folder, "todos.json"), serializeNotebook({ items }));
export const event = (fields: Partial<LocalEvent> & { title: string; date: string }): LocalEvent => ({
  id: crypto.randomUUID().toUpperCase(), allDay: false, days: 1, start: 600, end: 660, repeat: "none", skip: [], color: "blue",
  createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z", ...fields,
});
