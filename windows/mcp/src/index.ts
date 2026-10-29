import { webcrypto } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { aiOffText } from "../../src/core/ai";
import { Busy, Folder, Unreadable, clock, readLink, settingsHome, systemLang } from "./files";
import {
  Problem, addEvent, addMemo, addTodos, applyChanges, getFocus, getToday, listEvents, listMemos, listTodos, maxItems, previewChanges, searchHistory,
  type Ctx, type Reply,
} from "./tools";
import { words } from "./words";

/**
 * 종이냥 for Claude: a small MCP server Claude starts when a conversation needs it (stdio), and stops with
 * Claude. It never runs on its own and keeps nothing between calls but previews waiting for a yes. Every
 * call first reads ai-link.json; while 설정 › AI 연결 is off nothing else is opened (M1 · M2).
 */

// Node 18 has no global crypto yet; the core makes ids with crypto.randomUUID().
if (!(globalThis as { crypto?: unknown }).crypto) (globalThis as { crypto?: unknown }).crypto = webcrypto;

/** The app's version, put in by mcp/build.mjs. */
declare const __VERSION__: string;
const version = typeof __VERSION__ === "string" ? __VERSION__ : "dev";
const server = new McpServer({ name: "jongi-nyang", title: "종이냥 for Claude", version }, {
  instructions:
    "Tools for 종이냥 (Jongi-nyang), the user's paper to-do app: today's tasks, events, memos, focus time and finished tasks. " +
    "A day runs from 4 a.m. to 4 a.m. Dates are yyyy-MM-dd and times HH:mm in the user's local time. " +
    "You can read, add, and change after confirmation; nothing can be deleted. To change something, call preview_changes, " +
    "show its text to the user, and call apply_changes only after the user clearly says yes.",
});

/** The client's name for the log: "Claude Code" when it says so, otherwise "Claude". */
const clientName = () => (/code/i.test(server.server.getClientVersion()?.name ?? "") ? "Claude Code" : "Claude");

type Handler<A> = (ctx: Ctx, args: A) => Reply;

function run<A>(handler: Handler<A>) {
  return async (args: A) => {
    const home = settingsHome();
    const link = readLink(home);
    if (!link?.enabled || !link.dataFolder) {
      const text = aiOffText(link?.lang ?? systemLang());
      return { content: [{ type: "text" as const, text }], structuredContent: { enabled: false } };
    }
    const ctx: Ctx = { folder: new Folder(home, link.dataFolder), lang: link.lang, now: clock(), client: clientName() };
    try {
      const reply = handler(ctx, args);
      return { content: [{ type: "text" as const, text: reply.text }], structuredContent: { enabled: true, ...reply.data } };
    } catch (error) {
      const text = error instanceof Problem ? error.message
        : error instanceof Unreadable ? words.unreadable(error.file, ctx.lang)
        : error instanceof Busy ? words.busy(error.file, ctx.lang)
        : `${(error as Error).message ?? error}`;
      return { content: [{ type: "text" as const, text }], isError: true };
    }
  };
}

const read = { readOnlyHint: true, openWorldHint: false };
const add = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const day = z.string().describe("A day, yyyy-MM-dd (the 4 a.m. day: 01:00 belongs to the night before).");

server.registerTool("get_today", {
  title: "Today in 종이냥",
  description: "Today's tasks (with their times), today's events (repeats included), alarms still to ring today and today's focus time. The day ends at 4 a.m.",
  annotations: { title: "Today in 종이냥", ...read },
}, run(getToday));

server.registerTool("list_todos", {
  title: "List tasks",
  description: "Open tasks: on today's sheet (today), ahead or someday (later), or all (also the ones finished today). Optionally only those whose day is from..to.",
  inputSchema: {
    where: z.enum(["today", "later", "all"]).optional().describe("today = today's sheet; later = dated ahead and someday; all = everything (default)."),
    from: day.optional(), to: day.optional(),
  },
  annotations: { title: "List tasks", ...read },
}, run(listTodos));

server.registerTool("list_events", {
  title: "List events",
  description: "Events from one day to another (at most 31 days), repeating events spread over the days they fall on. Each has an id; repeating ones can't be changed.",
  inputSchema: { from: day, to: day.optional() },
  annotations: { title: "List events", ...read },
}, run(listEvents));

server.registerTool("list_memos", {
  title: "List memos",
  description: "Memos, newest first, optionally only those containing a word.",
  inputSchema: { query: z.string().optional(), limit: z.number().int().min(1).max(100).optional().describe("Default 20.") },
  annotations: { title: "List memos", ...read },
}, run(listMemos));

server.registerTool("get_focus", {
  title: "Focus time",
  description: "Focus time over a period (default today): the total, minutes per day and the tasks focused on longest.",
  inputSchema: { from: day.optional(), to: day.optional() },
  annotations: { title: "Focus time", ...read },
}, run(getFocus));

server.registerTool("search_history", {
  title: "Finished tasks",
  description: "Finished tasks from the record (and the list), newest first, by a word and/or a period. Good for weekly summaries.",
  inputSchema: { query: z.string().optional(), from: day.optional(), to: day.optional(), limit: z.number().int().min(1).max(200).optional().describe("Default 50.") },
  annotations: { title: "Finished tasks", ...read },
}, run(searchHistory));

const todoInput = z.object({
  title: z.string().describe("What to do (up to 200 characters)."),
  date: day.optional().describe("The day it is for, yyyy-MM-dd. Without it: today. Not with later."),
  timeStart: z.string().optional().describe("Start, HH:mm."),
  timeEnd: z.string().optional().describe("End, HH:mm; needs timeStart; at the latest 03:45 the next morning."),
  remindAt: z.string().nullable().optional().describe("A reminder: HH:mm on the task's day, or yyyy-MM-ddTHH:mm. Without it a start still ahead rings; null for none."),
  later: z.boolean().optional().describe("Put it under someday (no date, no time)."),
});

server.registerTool("add_todos", {
  title: "Add tasks",
  description: `Adds 1–${maxItems} tasks. A task with the same title on the same day is not added twice (its id comes back). Use this for what the user asked to put on their list.`,
  inputSchema: { items: z.array(todoInput).describe(`1 to ${maxItems} tasks.`) },
  annotations: { title: "Add tasks", ...add },
}, run(addTodos));

server.registerTool("add_event", {
  title: "Add an event",
  description: "Adds one event (no repeats): timed with start (and end; default an hour), or all day for 1–31 days. One with the same title already on that day is not added twice.",
  inputSchema: {
    title: z.string(), date: day, start: z.string().optional().describe("HH:mm"), end: z.string().optional().describe("HH:mm; at or before the start means the next day."),
    allDay: z.boolean().optional(), days: z.number().int().optional().describe("All day: how many days (1–31)."), location: z.string().optional(),
  },
  annotations: { title: "Add an event", ...add },
}, run(addEvent));

server.registerTool("add_memo", {
  title: "Add a memo",
  description: "Adds a memo (the first line is its title; up to 4,000 characters).",
  inputSchema: { text: z.string() },
  annotations: { title: "Add a memo", ...add },
}, run(addMemo));

server.registerTool("preview_changes", {
  title: "Preview changes",
  description:
    "Shows what changing tasks or one-off events would do, before → after, and returns a confirmation token valid for 10 minutes. Nothing is written. " +
    "Tasks: title, date (null: back to today), timeStart/timeEnd (null clears), remindAt (null clears), later, done. " +
    "Events (not repeating): title, date, start, end, allDay, days, location (null clears). Deleting is not possible. " +
    "Show the returned text to the user as it is.",
  inputSchema: {
    changes: z.array(z.object({
      kind: z.enum(["todo", "event"]),
      id: z.string().describe("The task's or event's id from another tool."),
      set: z.record(z.string(), z.unknown()).describe("The fields to change and their new values."),
    })).describe(`1 to ${maxItems} changes.`),
  },
  annotations: { title: "Preview changes", ...read },
}, run(previewChanges));

server.registerTool("apply_changes", {
  title: "Apply changes",
  description:
    "Applies a preview by its token. Call it ONLY after showing the preview to the user and getting a clear yes. " +
    "If an item changed in the app since the preview, nothing is applied: preview again.",
  inputSchema: { token: z.string() },
  annotations: { title: "Apply changes", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
}, run(applyChanges));

server.connect(new StdioServerTransport()).catch((error: unknown) => {
  process.stderr.write(`jongi-nyang: ${(error as Error).message ?? error}\n`);
  process.exit(1);
});
