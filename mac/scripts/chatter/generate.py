#!/usr/bin/env python3
"""Writes PetChatter.swift (macOS) and chatter.ts (Windows) from chatter_lines.py, so both apps say the same things,
in Korean, English and Dutch.

Add or change lines in chatter_lines.py (in every language: the tables must keep the same shape), then run:
    python3 scripts/chatter/generate.py [path to the Windows app, default ../windows]
and update the expected picks in CoreTests.swift / chatter.test.ts if they moved."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from chatter_lines import ALWAYS, DUE_SOON, EN, EVENTS, FALLBACK, FREQUENCY, GENERAL, MILESTONE, NL, OVERDUE, PETTED, PROGRESS, QUESTIONS, TIME, WEEKDAY  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MAC = os.path.join(ROOT, "Sources", "PaperCore", "PetChatter.swift")
WIN = os.path.join(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "..", "windows"), "src", "core", "chatter.ts")
q = lambda text: json.dumps(text, ensure_ascii=False)

# ─── One shape for every language ────────────────────────────────────────────

KO = {
    "PROGRESS": PROGRESS, "OVERDUE": OVERDUE, "DUE_SOON": DUE_SOON,
    "TIME": {name: lines for name, _, _, lines in TIME}, "WEEKDAY": {name: lines for name, _, lines in WEEKDAY},
    "GENERAL": GENERAL, "EVENTS": EVENTS,
    "QUESTIONS": {qid: (text, [(label, reply) for label, reply, _, _ in answers]) for qid, text, _, answers in QUESTIONS},
    "PETTED": PETTED, "MILESTONE": MILESTONE, "FALLBACK": FALLBACK, "FREQUENCY": FREQUENCY,
}
LANGS = {"ko": KO, "en": EN, "nl": NL}

# (table id, Swift/TS name, path into a language's tables)
TABLES = (
    [(f"p.{k}", f"progress{k.capitalize()}", ("PROGRESS", k)) for k in PROGRESS]
    + [("d.over", "overdueLines", ("OVERDUE",)), ("d.soon", "dueSoonLines", ("DUE_SOON",))]
    + [(f"e.{k}", f"event{k.capitalize()}Lines", ("EVENTS", k)) for k in EVENTS]
    + [(f"t.{name}", f"time{name.capitalize()}", ("TIME", name)) for name, _, _, _ in TIME]
    + [(f"w.{name}", f"weekday{name.capitalize()}", ("WEEKDAY", name)) for name, _, _ in WEEKDAY]
    + [("g", "generalLines", ("GENERAL",))]
)
NAME = {tid: name for tid, name, _ in TABLES}


def table(lang, path):
    value = LANGS[lang]
    for key in path:
        value = value[key]
    return value


def placeholders(text):
    return sorted(set(re.findall(r"\{(\w+)\}", text)))


def check():
    """Every language has every line, question and answer the Korean list has, with the same placeholders."""
    for lang in ("en", "nl"):
        for tid, _, path in TABLES:
            ko, other = table("ko", path), table(lang, path)
            assert len(ko) == len(other), f"{lang} {tid}: {len(other)} lines, Korean has {len(ko)}"
            for index, (a, b) in enumerate(zip(ko, other)):
                assert placeholders(a) == placeholders(b), f"{lang} {tid}.{index}: {placeholders(b)} vs {placeholders(a)}"
        assert list(LANGS[lang]["QUESTIONS"]) == list(KO["QUESTIONS"]), f"{lang}: questions differ"
        for qid, (text, answers) in KO["QUESTIONS"].items():
            other_text, other_answers = LANGS[lang]["QUESTIONS"][qid]
            assert placeholders(text) == placeholders(other_text), f"{lang} {qid}: placeholders"
            assert len(answers) == len(other_answers), f"{lang} {qid}: {len(other_answers)} answers, Korean has {len(answers)}"
        assert len(LANGS[lang]["PETTED"]) == len(PETTED), f"{lang}: petted lines"
        assert len(LANGS[lang]["MILESTONE"]) == len(MILESTONE) == 3, f"{lang}: milestone lines (7, 30, 100)"
        assert LANGS[lang]["FALLBACK"].keys() == FALLBACK.keys() and LANGS[lang]["FREQUENCY"].keys() == FREQUENCY.keys()


check()
SIZE = sum(len(table("ko", path)) for _, _, path in TABLES)


def swift_strings(lines, indent):
    pad = " " * indent
    return ",\n".join(f"{pad}{q(t)}" for t in lines)


def swift_table(tid, path):
    texts = ",\n".join(f"        [\n{swift_strings(table(lang, path), 12)}]" for lang in LANGS)
    return f"    private static let {NAME[tid]} = Table(id: {q(tid)}, texts: [\n{texts}])"


def ts_table(tid, path):
    texts = ",\n".join(f"    [\n{swift_strings(table(lang, path), 6)}]" for lang in LANGS)
    return f"const {NAME[tid]}: Table = {{ id: {q(tid)}, texts: [\n{texts}] }};"


# ─── Swift ───────────────────────────────────────────────────────────────────

def swift():
    tables = "\n".join(swift_table(tid, path) for tid, _, path in TABLES)
    time_cases = "\n".join(f"        case {a}..<{b}: {NAME[f't.{name}']}" for name, a, b, _ in TIME)
    weekday_cases = "\n".join(f"        case {', '.join(map(str, days))}: {NAME[f'w.{name}']}" for name, days, _ in WEEKDAY)
    questions = []
    for qid, _, (applies, _), answers in QUESTIONS:
        per_lang = []
        for lang in LANGS:
            text, labels = LANGS[lang]["QUESTIONS"][qid]
            rows = ",\n".join(
                f"                answer({q(label)}, {q(reply)}, .{pose}" + (f", .{action})" if action else ")")
                for (label, reply), (_, _, pose, action) in zip(labels, answers))
            per_lang.append(f"            [\n{rows}]")
        texts = ", ".join(q(LANGS[lang]["QUESTIONS"][qid][0]) for lang in LANGS)
        questions.append(f"        Question(id: {q(qid)}, text: [{texts}], answers: [\n" + ",\n".join(per_lang) + "],\n"
                         f"                 applies: {{ c in {applies} }}),")
    petted = ",\n".join(f"        [{', '.join(q(t) for t in LANGS[lang]['PETTED'])}]" for lang in LANGS)
    milestone = ",\n".join(f"        [{', '.join(q(t) for t in LANGS[lang]['MILESTONE'])}]" for lang in LANGS)
    frequency = lambda key: ", ".join(q(LANGS[lang]["FREQUENCY"][key]) for lang in LANGS)
    fallback = lambda key: ", ".join(q(LANGS[lang]["FALLBACK"][key]) for lang in LANGS)
    return f'''import Foundation

/// 종이냥 한마디: now and then the cat says something — about today's sheet, deadlines, the time
/// of day, the day of the week, or just cat things — or asks a small question with answer
/// buttons. Same lines, order and picking steps as the Windows app (chatter.ts): both tables are
/// written from one list (scripts/chatter), and a test with the same random numbers gives the same
/// line on both. Every language has the same lines in the same places, so a pick has the same id
/// in Korean, English and Dutch.
public enum PetChatter {{
    public enum Pose: String, Sendable {{ case happy, cheer, tilt, stretch, yawn, tea, blink, hop }}
    /// Something an answer does besides the reply.
    public enum Action: String, Sendable {{ case rest5, focus25 }}

    public struct Answer: Equatable, Sendable {{
        public let label: String
        public let reply: String
        public let pose: Pose
        public let action: Action?
    }}

    /// A line, or a question when it has answers.
    public struct Line: Equatable, Sendable {{
        public let id: String
        public let text: String
        public let answers: [Answer]
        public var isQuestion: Bool {{ !answers.isEmpty }}
    }}

    public struct Context: Sendable {{
        public var hour: Int
        /// Today's sheet: tasks still open and tasks checked off.
        public var open: Int
        public var done: Int
        /// Deadlines already past, and due today or tomorrow (open tasks only).
        public var overdue: Int
        public var dueSoon: Int
        public var firstOpen: String?
        /// 0 = Sunday … 6 = Saturday.
        public var weekday: Int
        /// Today's events (CalendarDay.chatter): the next event and the minutes to it, the
        /// one going on, one that just ended, and how many are still to come.
        public var nextEvent: String?
        public var nextIn: Int
        public var nowEvent: String?
        public var endedEvent: String?
        public var eventsLeft: Int
        /// A streak that reached 7, 30 or 100 days today and hasn't been cheered yet (Archive.streakMilestone).
        public var milestone: Int?

        public init(hour: Int, open: Int, done: Int, overdue: Int = 0, dueSoon: Int = 0, firstOpen: String? = nil, weekday: Int = 2,
                    nextEvent: String? = nil, nextIn: Int = 0, nowEvent: String? = nil, endedEvent: String? = nil, eventsLeft: Int = 0,
                    milestone: Int? = nil) {{
            self.hour = hour; self.open = open; self.done = done; self.overdue = overdue; self.dueSoon = dueSoon
            self.firstOpen = firstOpen; self.weekday = weekday
            self.nextEvent = nextEvent; self.nextIn = nextIn; self.nowEvent = nowEvent; self.endedEvent = endedEvent; self.eventsLeft = eventsLeft
            self.milestone = milestone
        }}
    }}

    public enum Frequency: String, CaseIterable, Sendable {{
        case rare, normal, often
        public var minutes: Double {{ switch self {{ case .rare: 90; case .normal: 45; case .often: 20 }} }}
        public var title: String {{ title(.ko) }}
        public func title(_ language: AppLanguage) -> String {{
            switch self {{
            case .rare: [{frequency("rare")}][language.index]
            case .normal: [{frequency("normal")}][language.index]
            case .often: [{frequency("often")}][language.index]
            }}
        }}
    }}

    /// Late at night and early morning the cat keeps quiet.
    public static func isQuietHour(_ hour: Int) -> Bool {{ hour >= 23 || hour < 7 }}

    /// How long until the next line: the chosen interval, give or take a quarter.
    public static func nextDelay(_ frequency: Frequency, random: () -> Double) -> TimeInterval {{
        frequency.minutes * 60 * (0.75 + 0.5 * random())
    }}

    /// One line (or question) for this moment, avoiding the ones said recently.
    public static func pick(_ context: Context, questions: Bool, recent: [String], language: AppLanguage = .ko, random: () -> Double) -> Line {{
        let l = language
        if let days = context.milestone, let line = milestone(days, language: l) {{ return line }}
        var groups: [(weight: Double, lines: [Line])] = []
        groups.append((4, progress(context, l)))
        if context.overdue > 0 {{ groups.append((3, lines(overdueLines, context, l))) }} else if context.dueSoon > 0 {{ groups.append((2, lines(dueSoonLines, context, l))) }}
        if context.nextEvent != nil && context.nextIn <= 30 {{ groups.append((4, lines(eventSoonLines, context, l))) }}
        else if context.endedEvent != nil {{ groups.append((3, lines(eventEndedLines, context, l))) }}
        else if context.nowEvent != nil {{ groups.append((2, lines(eventNowLines, context, l))) }}
        else if context.nextEvent != nil {{ groups.append((1, lines(eventDayLines, context, l))) }}
        if let time = timeLines(context.hour) {{ groups.append((2, lines(time, context, l))) }}
        if let day = weekdayLines(context.weekday) {{ groups.append((1, lines(day, context, l))) }}
        groups.append((2, lines(generalLines, context, l)))
        if questions {{
            let asks = questionList.filter {{ $0.applies(context) }}.map {{ $0.line(context, l) }}
            if !asks.isEmpty {{ groups.append((3, asks)) }}
        }}
        let total = groups.reduce(0) {{ $0 + $1.weight }}
        var point = random() * total
        var chosen = groups[groups.count - 1].lines
        for group in groups {{
            if point < group.weight {{ chosen = group.lines; break }}
            point -= group.weight
        }}
        let fresh = chosen.filter {{ !recent.contains($0.id) }}
        let pool = fresh.isEmpty ? chosen : fresh
        return pool[min(pool.count - 1, Int(random() * Double(pool.count)))]
    }}

    /// The day a streak reaches 7, 30 or 100 days: one short cheer ("m.0" · "m.1" · "m.2"); nil for any other count.
    public static func milestone(_ days: Int, language: AppLanguage = .ko) -> Line? {{
        guard let index = milestoneDays.firstIndex(of: days) else {{ return nil }}
        return Line(id: "m.\\(index)", text: milestoneLines[language.index][index], answers: [])
    }}

    /// The streaks the cat cheers, once each, on the day they're reached.
    public static let milestoneDays = [7, 30, 100]

    /// A short answer when the cat is patted.
    public static func petted(language: AppLanguage = .ko, random: () -> Double) -> Line {{
        let texts = pettedLines[language.index]
        let index = min(texts.count - 1, Int(random() * Double(texts.count)))
        return Line(id: "pet.\\(index)", text: texts[index], answers: [])
    }}

    /// Everything the cat can say, for checks that both apps carry the same list.
    public static var catalogueSize: Int {{
        {SIZE} + questionList.count
    }}

    // MARK: Lines (written by scripts/chatter/generate.py from one list shared with the Windows app)

    /// A group of lines: ids "<id>.0", "<id>.1"…, the texts in Korean, English and Dutch.
    private struct Table: Sendable {{
        let id: String
        let texts: [[String]]
    }}

    private static func progress(_ c: Context, _ l: AppLanguage) -> [Line] {{
        if c.open == 0 && c.done == 0 {{ return lines(progressEmpty, c, l) }}
        if c.open == 0 {{ return lines(progressAll, c, l) }}
        if c.done == 0 {{ return lines(progressStart, c, l) }}
        return lines(progressSome, c, l)
    }}

    private static func timeLines(_ hour: Int) -> Table? {{
        switch hour {{
{time_cases}
        default: nil
        }}
    }}

    private static func weekdayLines(_ weekday: Int) -> Table? {{
        switch weekday {{
{weekday_cases}
        default: nil
        }}
    }}

{tables}

    private static let pettedLines: [[String]] = [
{petted}]

    private static let milestoneLines: [[String]] = [
{milestone}]

    private struct Question: Sendable {{
        let id: String
        /// Korean, English, Dutch.
        let text: [String]
        let answers: [[Answer]]
        let applies: @Sendable (Context) -> Bool
        func line(_ context: Context, _ l: AppLanguage) -> Line {{
            Line(id: id, text: fill(text[l.index], context, l), answers: answers[l.index])
        }}
    }}

    private static func answer(_ label: String, _ reply: String, _ pose: Pose, _ action: Action? = nil) -> Answer {{
        Answer(label: label, reply: reply, pose: pose, action: action)
    }}

    private static let questionList: [Question] = [
{chr(10).join(questions)}
    ]

    private static func lines(_ table: Table, _ context: Context, _ l: AppLanguage) -> [Line] {{
        table.texts[l.index].enumerated().map {{ Line(id: "\\(table.id).\\($0.offset)", text: fill($0.element, context, l), answers: []) }}
    }}

    /// Names are shortened to 12 characters in Korean, 20 in English and Dutch.
    private static func fill(_ text: String, _ c: Context, _ l: AppLanguage) -> String {{
        let limit = l == .ko ? 12 : 20
        func short(_ title: String) -> String {{ title.count > limit ? String(title.prefix(limit)).trimmingCharacters(in: .whitespaces) + "…" : title }}
        let first = [{fallback("first")}][l.index], next = [{fallback("event")}][l.index], any = [{fallback("any")}][l.index]
        return text.replacingOccurrences(of: "{{first}}", with: c.firstOpen.map(short) ?? first)
            .replacingOccurrences(of: "{{event}}", with: c.nextEvent.map(short) ?? next)
            .replacingOccurrences(of: "{{now}}", with: c.nowEvent.map(short) ?? any)
            .replacingOccurrences(of: "{{ended}}", with: c.endedEvent.map(short) ?? any)
            .replacingOccurrences(of: "{{in}}", with: String(c.nextIn))
            .replacingOccurrences(of: "{{left}}", with: String(c.eventsLeft))
            .replacingOccurrences(of: "{{done}}", with: String(c.done))
            .replacingOccurrences(of: "{{open}}", with: String(c.open))
            .replacingOccurrences(of: "{{overdue}}", with: String(c.overdue))
            .replacingOccurrences(of: "{{soon}}", with: String(c.dueSoon))
    }}
}}
'''


# ─── TypeScript ──────────────────────────────────────────────────────────────

def ts():
    tables = "\n".join(ts_table(tid, path) for tid, _, path in TABLES)
    time_cases = "\n".join(f"  if (hour >= {a} && hour < {b}) return {NAME[f't.{name}']};" for name, a, b, _ in TIME)
    weekday_cases = "\n".join(
        f"  if ({' || '.join(f'weekday === {d}' for d in days)}) return {NAME[f'w.{name}']};" for name, days, _ in WEEKDAY)
    questions = []
    for qid, _, (_, applies), answers in QUESTIONS:
        per_lang = []
        for lang in LANGS:
            _, labels = LANGS[lang]["QUESTIONS"][qid]
            rows = ",\n".join(
                f"      answer({q(label)}, {q(reply)}, {q(pose)}" + (f", {q(action)})" if action else ")")
                for (label, reply), (_, _, pose, action) in zip(labels, answers))
            per_lang.append(f"    [\n{rows}]")
        texts = ", ".join(q(LANGS[lang]["QUESTIONS"][qid][0]) for lang in LANGS)
        fn = "() => true" if applies == "true" else f"(c) => {applies}"
        questions.append(f"  {{ id: {q(qid)}, text: [{texts}], answers: [\n" + ",\n".join(per_lang) + f"], applies: {fn} }},")
    petted = ",\n".join(f"  [{', '.join(q(t) for t in LANGS[lang]['PETTED'])}]" for lang in LANGS)
    milestone = ",\n".join(f"  [{', '.join(q(t) for t in LANGS[lang]['MILESTONE'])}]" for lang in LANGS)
    frequency = ",\n".join(
        f"  {lang}: {{ {', '.join(f'{key}: {q(LANGS[lang]["FREQUENCY"][key])}' for key in FREQUENCY)} }}" for lang in LANGS)
    fallback = lambda key: ", ".join(q(LANGS[lang]["FALLBACK"][key]) for lang in LANGS)
    return f'''import {{ langIndex, type Lang }} from "./lang";

/**
 * 종이냥 한마디: now and then the cat says something — about today's sheet, deadlines, the time
 * of day, the day of the week, or just cat things — or asks a small question with answer
 * buttons. Same lines, order and picking steps as the macOS app (PetChatter.swift): both tables
 * are written from one list (scripts/chatter on the Mac), and a test with the same random numbers
 * gives the same line on both. Every language has the same lines in the same places, so a pick has
 * the same id in Korean, English and Dutch.
 */
export type ChatterPose = "happy" | "cheer" | "tilt" | "stretch" | "yawn" | "tea" | "blink" | "hop";
/** Something an answer does besides the reply. */
export type ChatterAction = "rest5" | "focus25";

export interface ChatterAnswer {{ label: string; reply: string; pose: ChatterPose; action?: ChatterAction }}
/** A line, or a question when it has answers. */
export interface ChatterLine {{ id: string; text: string; answers: ChatterAnswer[] }}

export interface ChatterContext {{
  hour: number;
  /** Today's sheet: tasks still open and tasks checked off. */
  open: number;
  done: number;
  /** Deadlines already past, and due today or tomorrow (open tasks only). */
  overdue: number;
  dueSoon: number;
  firstOpen?: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /**
   * Today's events (chatterEvents in calendar.ts): the next event and the minutes to it,
   * the one going on, one that just ended, and how many are still to come.
   */
  nextEvent?: string;
  nextIn?: number;
  nowEvent?: string;
  endedEvent?: string;
  eventsLeft?: number;
  /** A streak that reached 7, 30 or 100 days today and hasn't been cheered yet (streakMilestone in archive.ts). */
  milestone?: number;
}}

export type ChatterFrequency = "rare" | "normal" | "often";
export const chatterMinutes: Record<ChatterFrequency, number> = {{ rare: 90, normal: 45, often: 20 }};
export const chatterFrequencyTitles: Record<Lang, Record<ChatterFrequency, string>> = {{
{frequency},
}};
export const chatterFrequencyTitle: Record<ChatterFrequency, string> = chatterFrequencyTitles.ko;

/** Late at night and early morning the cat keeps quiet. */
export const isQuietHour = (hour: number) => hour >= 23 || hour < 7;

/** How long until the next line (ms): the chosen interval, give or take a quarter. */
export function nextChatterDelay(frequency: ChatterFrequency, random: () => number): number {{
  return chatterMinutes[frequency] * 60_000 * (0.75 + 0.5 * random());
}}

/** One line (or question) for this moment, avoiding the ones said recently. */
export function pickChatter(context: ChatterContext, questions: boolean, recent: readonly string[], random: () => number, lang: Lang = "ko"): ChatterLine {{
  const cheer = context.milestone === undefined ? undefined : milestoneChatter(context.milestone, lang);
  if (cheer) return cheer;
  const groups: {{ weight: number; lines: ChatterLine[] }}[] = [];
  groups.push({{ weight: 4, lines: progress(context, lang) }});
  if (context.overdue > 0) groups.push({{ weight: 3, lines: lines(overdueLines, context, lang) }});
  else if (context.dueSoon > 0) groups.push({{ weight: 2, lines: lines(dueSoonLines, context, lang) }});
  if (context.nextEvent !== undefined && (context.nextIn ?? 0) <= 30) groups.push({{ weight: 4, lines: lines(eventSoonLines, context, lang) }});
  else if (context.endedEvent !== undefined) groups.push({{ weight: 3, lines: lines(eventEndedLines, context, lang) }});
  else if (context.nowEvent !== undefined) groups.push({{ weight: 2, lines: lines(eventNowLines, context, lang) }});
  else if (context.nextEvent !== undefined) groups.push({{ weight: 1, lines: lines(eventDayLines, context, lang) }});
  const time = timeLines(context.hour);
  if (time) groups.push({{ weight: 2, lines: lines(time, context, lang) }});
  const day = weekdayLines(context.weekday);
  if (day) groups.push({{ weight: 1, lines: lines(day, context, lang) }});
  groups.push({{ weight: 2, lines: lines(generalLines, context, lang) }});
  if (questions) {{
    const index = langIndex(lang);
    const asks = questionList.filter((question) => question.applies(context))
      .map((question) => ({{ id: question.id, text: fill(question.text[index], context, lang), answers: question.answers[index] }}));
    if (asks.length > 0) groups.push({{ weight: 3, lines: asks }});
  }}
  const total = groups.reduce((sum, group) => sum + group.weight, 0);
  let point = random() * total;
  let chosen = groups[groups.length - 1].lines;
  for (const group of groups) {{
    if (point < group.weight) {{ chosen = group.lines; break; }}
    point -= group.weight;
  }}
  const fresh = chosen.filter((line) => !recent.includes(line.id));
  const pool = fresh.length > 0 ? fresh : chosen;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}}

/** The streaks the cat cheers, once each, on the day they're reached. */
export const milestoneDays: readonly number[] = [7, 30, 100];

/** The day a streak reaches 7, 30 or 100 days: one short cheer ("m.0" · "m.1" · "m.2"); undefined for any other count. */
export function milestoneChatter(days: number, lang: Lang = "ko"): ChatterLine | undefined {{
  const index = milestoneDays.indexOf(days);
  if (index < 0) return undefined;
  return {{ id: `m.${{index}}`, text: milestoneLines[langIndex(lang)][index], answers: [] }};
}}

/** A short answer when the cat is patted. */
export function pettedChatter(random: () => number, lang: Lang = "ko"): ChatterLine {{
  const texts = pettedLines[langIndex(lang)];
  const index = Math.min(texts.length - 1, Math.floor(random() * texts.length));
  return {{ id: `pet.${{index}}`, text: texts[index], answers: [] }};
}}

/** Everything the cat can say, for checks that both apps carry the same list. */
export const chatterCatalogueSize = (): number => {SIZE} + questionList.length;

// ─── Lines (written by scripts/chatter/generate.py from one list shared with the macOS app) ──

/** A group of lines: ids "<id>.0", "<id>.1"…, the texts in Korean, English and Dutch. */
type Table = {{ readonly id: string; readonly texts: readonly (readonly string[])[] }};

function progress(c: ChatterContext, lang: Lang): ChatterLine[] {{
  if (c.open === 0 && c.done === 0) return lines(progressEmpty, c, lang);
  if (c.open === 0) return lines(progressAll, c, lang);
  if (c.done === 0) return lines(progressStart, c, lang);
  return lines(progressSome, c, lang);
}}

function timeLines(hour: number): Table | undefined {{
{time_cases}
  return undefined;
}}

function weekdayLines(weekday: number): Table | undefined {{
{weekday_cases}
  return undefined;
}}

{tables}

const pettedLines: readonly (readonly string[])[] = [
{petted}];

const milestoneLines: readonly (readonly string[])[] = [
{milestone}];

const answer = (label: string, reply: string, pose: ChatterPose, action?: ChatterAction): ChatterAnswer => (action ? {{ label, reply, pose, action }} : {{ label, reply, pose }});

/** Each question's text and answers in Korean, English and Dutch. */
const questionList: {{ id: string; text: string[]; answers: ChatterAnswer[][]; applies: (c: ChatterContext) => boolean }}[] = [
{chr(10).join(questions)}
];

function lines(table: Table, context: ChatterContext, lang: Lang): ChatterLine[] {{
  return table.texts[langIndex(lang)].map((text, index) => ({{ id: `${{table.id}}.${{index}}`, text: fill(text, context, lang), answers: [] }}));
}}

/** Names are shortened to 12 characters in Korean, 20 in English and Dutch. */
function fill(text: string, c: ChatterContext, lang: Lang): string {{
  const limit = lang === "ko" ? 12 : 20;
  const index = langIndex(lang);
  const short = (title: string | undefined, fallback: string): string => {{
    if (title === undefined) return fallback;
    const characters = Array.from(title);
    return characters.length > limit ? `${{characters.slice(0, limit).join("").trimEnd()}}…` : title;
  }};
  const first = [{fallback("first")}][index];
  const next = [{fallback("event")}][index];
  const any = [{fallback("any")}][index];
  return text.replaceAll("{{first}}", short(c.firstOpen, first)).replaceAll("{{done}}", String(c.done)).replaceAll("{{open}}", String(c.open))
    .replaceAll("{{overdue}}", String(c.overdue)).replaceAll("{{soon}}", String(c.dueSoon))
    .replaceAll("{{event}}", short(c.nextEvent, next)).replaceAll("{{now}}", short(c.nowEvent, any)).replaceAll("{{ended}}", short(c.endedEvent, any))
    .replaceAll("{{in}}", String(c.nextIn ?? 0)).replaceAll("{{left}}", String(c.eventsLeft ?? 0));
}}
'''


open(MAC, "w").write(swift())
if os.path.isdir(os.path.dirname(WIN)):
    open(WIN, "w").write(ts())
else:
    print(f"Windows app not found ({WIN}); wrote the macOS table only")
print(f"lines {SIZE}, questions {len(QUESTIONS)}, petted {len(PETTED)} — in {', '.join(LANGS)}")
