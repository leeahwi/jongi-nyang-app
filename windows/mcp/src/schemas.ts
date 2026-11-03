import { z } from "zod";
import { eventKeys, maxItems, todoKeys } from "./tools";

/**
 * What each tool takes and gives, for Claude (C3, docs/plans/mcp-plan.md): every tool says the shape of its
 * structured result (outputSchema), and preview_changes says per kind which fields a change may set — so
 * Claude needn't guess key names from a description, and a wrong key is refused by the schema (M38). Every
 * result has `enabled` (false and nothing else while 설정 › AI 연결 is off, M1), so the rest is optional.
 */

const text = z.string();
const day = z.string().describe("A day, yyyy-MM-dd (the 4 a.m. day: 01:00 belongs to the night before).");
const clock = z.string().regex(/^\d{1,2}:\d{2}$/).describe("HH:mm");
const shortId = z.string().describe("A short id (8 characters or more), as the tools give it; a whole id works too.");

// ─── Inputs ───────────────────────────────────────────────────────────────────

export const pageInput = {
  cursor: z.string().optional().describe("Where to go on: the cursor the last reply gave (nextCursor)."),
};
const limit = (fallback: number, max: number) => z.number().int().min(1).max(max).optional().describe(`How many (default ${fallback}, at most ${max}).`);

export const inputs = {
  get_today: {
    limit: limit(30, 100).describe("How many open tasks to list (default 30, at most 100); the rest via list_todos with nextCursor."),
    detail: z.boolean().optional().describe("Also list the tasks finished today (otherwise only their number)."),
  },
  list_todos: {
    where: z.enum(["today", "later", "all"]).optional().describe("today = today's sheet (default); later = dated ahead and someday; all = everything, also the ones finished today (the default with query)."),
    from: day.optional(), to: day.optional(),
    query: z.string().optional().describe("Only tasks whose title contains this (any case)."),
    limit: limit(50, 100), ...pageInput,
  },
  list_events: { from: day, to: day.optional(), limit: limit(50, 100), ...pageInput },
  list_memos: {
    query: z.string().optional().describe("Only memos containing this (any case)."),
    folder: z.string().optional().describe("Only this folder: its name or id (list_memo_folders)."),
    pinned: z.boolean().optional().describe("true: only pinned (고정) memos; false: only the others."),
    limit: limit(20, 100), ...pageInput,
  },
  get_memo: {
    id: shortId,
    offset: z.number().int().min(0).optional().describe("Read on from this character (nextOffset of the last part)."),
  },
  list_memo_folders: {},
  list_repeats: { limit: limit(50, 100), ...pageInput },
  get_focus: { from: day.optional(), to: day.optional() },
  search_history: { query: z.string().optional(), from: day.optional(), to: day.optional(), limit: limit(50, 200), ...pageInput },
  add_todos: {
    items: z.array(z.object({
      title: z.string().describe("What to do (up to 200 characters)."),
      date: day.optional().describe("The day it is for, yyyy-MM-dd. Without it: today. Not with later."),
      timeStart: clock.optional().describe("Start, HH:mm."),
      timeEnd: clock.optional().describe("End, HH:mm; needs timeStart; at the latest 03:45 the next morning."),
      remindAt: z.string().nullable().optional().describe("A reminder: HH:mm on the task's day, or yyyy-MM-ddTHH:mm. Without it a start still ahead rings; null for none."),
      later: z.boolean().optional().describe("Put it under someday (no date, no time)."),
    })).describe(`1 to ${maxItems} tasks.`),
  },
  add_event: {
    title: z.string(), date: day, start: clock.optional(), end: clock.optional().describe("HH:mm; at or before the start means the next day."),
    allDay: z.boolean().optional(), days: z.number().int().min(1).max(31).optional().describe("All day: how many days (1–31)."), location: z.string().optional(),
  },
  add_memo: {
    text: z.string().describe("The memo (the first line is its title; up to 4,000 characters; markdown as the app writes it)."),
    folder: z.string().optional().describe("Put it in this existing folder: its name or id (list_memo_folders). Without it: 메모, the first folder."),
  },
  preview_changes: {
    changes: z.array(z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("todo"), id: shortId.describe("The task's id."),
        set: z.strictObject({
          title: z.string().optional(),
          date: day.nullable().optional().describe("A new day; null: back to today."),
          timeStart: clock.nullable().optional().describe("null clears the time."),
          timeEnd: clock.nullable().optional().describe("null clears the end."),
          remindAt: z.string().nullable().optional().describe("HH:mm on the task's day or yyyy-MM-ddTHH:mm; null clears."),
          later: z.boolean().optional().describe("true: to someday."),
          done: z.boolean().optional().describe("true: finished; false: open again."),
        } satisfies Record<typeof todoKeys[number], unknown>).describe("Only the fields to change."),
      }),
      z.object({
        kind: z.literal("event"), id: shortId.describe("The event's id (one-off events only)."),
        set: z.strictObject({
          title: z.string().optional(), date: day.optional(), start: clock.optional(), end: clock.optional(),
          allDay: z.boolean().optional(), days: z.number().int().min(1).max(31).optional(),
          location: z.string().nullable().optional().describe("null clears."),
        } satisfies Record<typeof eventKeys[number], unknown>).describe("Only the fields to change."),
      }),
    ])).describe(`1 to ${maxItems} changes.`),
  },
  apply_changes: { token: z.string().describe("The confirmation from preview_changes.") },
};

// ─── Results ──────────────────────────────────────────────────────────────────

const taskOut = z.object({
  id: text, title: text, done: z.boolean(), where: z.enum(["today", "ahead", "someday"]),
  date: text.optional(), dueDate: text.optional(), timeStart: text.optional(), timeEnd: text.optional(),
  remindAt: text.optional(), completedAt: text.optional(), repeat: text.optional().describe("A repeating task: its rule in the app's words."),
});
const eventOut = z.object({
  id: text, title: text, date: text, allDay: z.boolean(), days: z.number().optional(), start: text.optional(), end: text.optional(), endDate: text.optional(),
  location: text.optional(), repeat: z.enum(["none", "daily", "weekly", "monthly", "yearly"]), canChange: z.boolean(),
});
const memoOut = {
  id: text, title: text, chars: z.number().describe("The whole text's length."), folder: text, pinned: z.boolean(), createdAt: text, updatedAt: text,
};
const skipped = z.object({ title: text.optional(), reason: z.literal("duplicate"), id: text });

/** Every result: on or off, an error's code, and the outdated-extension notice (I1). */
const base = {
  enabled: z.boolean(),
  error: text.optional(),
  extOutdated: z.boolean().optional().describe("The app carries a newer version of this extension: reinstall it from 종이냥 › AI 연결."),
};
const more = { count: z.number().optional(), nextCursor: text.optional() };

export const outputs = {
  get_today: {
    ...base, date: text.optional(), open: z.number().optional(), done: z.number().optional(), tasks: z.array(taskOut).optional(), nextCursor: text.optional(),
    events: z.array(eventOut).optional(),
    alarms: z.array(z.object({ time: text, label: text.optional(), at: text })).optional(),
    focus: z.object({ minutes: z.number(), sessions: z.number() }).optional(),
  },
  list_todos: { ...base, ...more, where: z.enum(["today", "later", "all"]).optional(), from: text.optional(), to: text.optional(), query: text.optional(), tasks: z.array(taskOut).optional() },
  list_events: { ...base, ...more, from: text.optional(), to: text.optional(), events: z.array(eventOut).optional() },
  list_memos: { ...base, ...more, folder: text.optional(), memos: z.array(z.object({ ...memoOut, preview: text })).optional() },
  get_memo: {
    ...base, id: text.optional(), title: text.optional(), chars: z.number().optional().describe("The whole text's length."), folder: text.optional(), pinned: z.boolean().optional(),
    createdAt: text.optional(), updatedAt: text.optional(), offset: z.number().optional(),
    text: text.optional().describe("This part of the memo, exactly as written (markdown)."), nextOffset: z.number().optional().describe("More to read: call again with this offset."),
  },
  list_memo_folders: { ...base, pinned: z.number().optional(), folders: z.array(z.object({ id: text, name: text, color: text, memos: z.number(), pinned: z.number() })).optional() },
  list_repeats: {
    ...base, ...more,
    repeats: z.array(z.object({
      id: text, title: text, rule: text, kind: z.enum(["daily", "weekdays", "weekly", "monthly"]), weekdays: z.array(z.number()).optional(), monthDay: z.number().optional(),
      remindAt: text.optional(), next: text.optional(), task: text.optional().describe("Today's open copy on the list (a task id)."),
    })).optional(),
  },
  get_focus: {
    ...base, from: text.optional(), to: text.optional(), minutes: z.number().optional(), sessions: z.number().optional(),
    days: z.record(z.string(), z.number()).optional(), top: z.array(z.object({ title: text, minutes: z.number(), sessions: z.number() })).optional(),
  },
  search_history: {
    ...base, ...more, from: text.optional(), to: text.optional(),
    items: z.array(z.object({ id: text, title: text, day: text, completedAt: text, timeStart: text.optional(), timeEnd: text.optional() })).optional(),
  },
  add_todos: { ...base, added: z.array(taskOut).optional(), skipped: z.array(skipped).optional() },
  add_event: { ...base, added: eventOut.nullable().optional(), skipped: skipped.optional() },
  add_memo: { ...base, added: z.object(memoOut).nullable().optional(), skipped: skipped.optional() },
  preview_changes: { ...base, token: text.optional(), expiresAt: text.optional(), changes: z.array(z.object({ kind: z.enum(["todo", "event"]), id: text, title: text })).optional() },
  apply_changes: { ...base, changed: z.array(z.object({ kind: z.enum(["todo", "event"]), id: text, title: text })).optional() },
};
