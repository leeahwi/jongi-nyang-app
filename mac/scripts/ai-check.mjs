// 종이냥 for Claude, end to end (scripts/ai-check.sh): one MCP call to the bundled server, as Claude would make it.
//   node scripts/ai-check.mjs <sdk folder> <server index.js> <settings folder> <tool> '<json arguments>'
// Prints {"ms": time of the call, "text": …, "data": structuredContent, "isError": …} on one line.
import { pathToFileURL } from "node:url";

const [sdk, server, home, tool, json] = process.argv.slice(2);
const { Client } = await import(pathToFileURL(`${sdk}/dist/esm/client/index.js`).href);
const { StdioClientTransport } = await import(pathToFileURL(`${sdk}/dist/esm/client/stdio.js`).href);
const client = new Client({ name: "Claude", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server],
  env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PAPERTODO_AI_HOME: home }, stderr: "pipe" }));
async function call(name, args) {
  const started = Date.now();
  const result = await client.callTool({ name, arguments: args });
  const ended = Date.now();
  return { at: started, ms: ended - started, isError: result.isError ?? false,
    text: result.content?.map((part) => part.text ?? "").join("\n"), data: result.structuredContent ?? null };
}
// "preview+apply": both in one session (the token lives in the server's memory, as in one conversation).
if (tool === "preview+apply") {
  const preview = await call("preview_changes", JSON.parse(json));
  const applied = preview.data?.token ? await call("apply_changes", { token: preview.data.token }) : preview;
  console.log(JSON.stringify({ ...applied, preview }));
} else {
  console.log(JSON.stringify(await call(tool, json ? JSON.parse(json) : {})));
}
await client.close();
