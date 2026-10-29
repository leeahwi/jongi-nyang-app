# Jongi-nyang

A desktop to-do app for macOS and Windows. I built it separately on each platform and kept the two in step with one set of shared test cases.

| | |
| --- | --- |
| Team and role | Solo developer, pair programming with AI (Claude Code) |
| Stack | Swift 6, SwiftUI + AppKit / Electron, TypeScript / GitHub Actions |
| Versions | Mac 1.0 → 1.44.0, Windows 1.0 → 1.29.0 |
| Links | Repository `github.com/leeahwi/jongi-nyang-app`, website `leeahwi.github.io/jongi-nyang-app/en/`, downloads under the repository's Releases |

## Why I built it

To-dos kept piling up at work and at home, and no app made them easy to add and see. Plenty of to-do apps exist, but the features I needed were paid, and none was what I wanted: a sticky note that sits as a small icon and opens when I need it. I also wanted a timer or Pomodoro now and then, a calendar for events, and today's events and to-dos on one screen. That meant switching between two to four apps.

So I started with a small Mac notepad for today's to-dos (Mac 1.0, then called 한 장, "one sheet"). Repeats, events, alarms and a focus timer came later, and most recently a notes drawer that slides out from the screen edge and a connection that lets Claude work with my to-dos in a chat. I started the Windows version around Mac 1.12–1.15 and gave it the Mac's file format from the start, so one shared folder gives both machines the same list. I built it to help with my own work, but beyond keeping it simple I designed it with other real users and AX (AI transformation) in mind.

## Screens

![Mac day paper, Mac night paper, Windows](../docs/screenshots/hero-en.png)
From left: Mac day paper, Mac night paper, Windows. The same note design, implemented separately on each platform.

![Day strip, round 1](../docs/screenshots/process/daystrip-round1.png)
![Day strip, round 3](../docs/screenshots/process/daystrip-round3.png)
The day strip in round 1 (Mac 1.34) and round 3 (Mac 1.40). A bar for the whole day became a view of what's on now and how long is left. (Korean interface.)

![Notes drawer](../docs/screenshots/mac/en/drawer-list-day.png)
The notes drawer (Mac 1.44). Notes are grouped by date, and links, phone numbers and checklists show as small labels on each card.

![Alarm slip, before and after](../docs/screenshots/process/modal-alarm-before-after.png)
The alarm window before and after. It used to look like a system alert; now it's a paper slip like every other floating window. (Korean interface.)

## What I did

- Wrote a case table for each feature, one input and its expected output per row, and made the Swift and TypeScript tests produce the same strings. The input line alone has 136 rows, the notes drawer has cases D1–D29, and the Windows suite has 534 tests.
- Built measurement scripts (`mac/scripts/perf.sh`, `windows/tools/perf.mjs`) and used them to find what was burning CPU at idle. Mac went from 61% to 0.7%, Windows from 5.7% to 1.5%.
- Added snapshot rendering of real screens in 3 languages, day and night (about 1,900 images), and a layout sweep that resizes every Windows window across sizes, scale factors and fonts. A contrast check fails if any of the note's 61 text/background pairs, or 218 pairs across the notes drawer's four papers, falls below WCAG AA.
- Picked and combined AI-generated design proposals into a redesign shipped in four stages (Mac 1.34–1.37, Windows 1.19–1.22). The day strip was redrawn three times.
- Used the app every day and asked for what I found missing: time reminders on to-dos, moving a to-do to Someday and bringing it back to Today (the Later tab in Mac 1.17, with a button that brings an item back to Today; it is called Someday now), and a Memos tab (Mac 1.15), among others. Bugs I found in use were fixed the same way: tab edges cut off, a plain-looking alarm window, the app freezing after a focus session, a 30-minute task showing 29.
- Removed a Google Calendar and Tasks integration that had taken five releases to build, and replaced it with in-app events and a `.jongi` backup file (Mac 1.31.0, Windows 1.16.0).
- Moved the Memos tab into a notes drawer at the screen edge (Mac 1.43, Windows 1.28). Using it, I found night paper hard to read and fixed it in the next release; once notes piled up it was hard to tell where I was, so the drawer was reworked with date groups, kind labels and right-click menus (Mac 1.44, Windows 1.29). Folder data lives in a new file and `memos.json` is untouched, so an older version on another device can share the same folder without losing notes.
- Built Jongi-nyang for Claude, an extension that lets Claude Desktop and Claude Code read and add to-dos, events and notes (Mac 1.42, Windows 1.27). It's off by default; before any change it shows the before and after and waits for a yes, and the app can undo it in one step. No background server.

## Problems I solved

61% CPU at idle. While I was still adding features, I measured a test copy of Mac 1.38.1 with fixed sample data: idle CPU was 61% with the note open and 87% with it hidden, even though all tests passed. The blinking "now" line in the day strip was making the whole note redraw every frame. Instead of removing the blink or slowing it down, I kept the look and handed only the blink to Core Animation. Idle CPU was 0.7% in 1.39. The 1.40 day strip dropped the blink altogether.

× froze the app. I found it while using 1.40.0: after a focus session, pressing × on the focus card left the whole app ignoring clicks. Tracing it, sampling the process and listing its windows showed the "Stop focusing?" slip open as a 0×0 modal window: shown from inside a button action, it couldn't measure itself. 1.40.1 opens slips after the click finishes and gives them a provisional size if measuring fails. The same release fixed another thing I hit in use: a 30-minute to-do starting a 29-minute focus.

Full write-ups: [Troubleshooting log](troubleshooting.en.md).

## Design decisions

- Shared test cases over shared code. I could have written a C or Rust core behind FFI, or run a TypeScript core in JavaScriptCore on the Mac. I wrote each app in its own language and shared the case tables instead. Builds stay simple (the Mac app has zero dependencies) and the tables act as the spec. The price is implementing every rule twice.
- In-app events over Google Calendar sync. The sync took five releases to build and worked, but I wanted a clear line between private plans and work, and the people who tried the app with me said the same. Data stays in JSON files, shared through the user's own cloud folder. No accounts or servers; in exchange, events from other calendars have to be copied in by hand, and the app merges concurrent edits itself (three-way merge for memos).
- Electron over a native Windows UI. The paper design moved over in CSS almost unchanged, and I could render, check and package the Windows app from one Mac. The costs: more memory (692 MB after ten minutes, 457 MB after fixes), and the app has never run on a real Windows PC.

## Results

| | |
| --- | --- |
| Shipped | Mac 1.44.0, Windows 1.29.0 (GitHub Releases) |
| Performance (Mac 1.38 → 1.39) | idle CPU 61% → 0.7%, input latency 0.46 s → 0.01 s, launch 2.7 s → 1.0 s, memory 213 MB → 136 MB |
| Performance (Windows 1.23 → 1.24) | idle CPU 5.7% → 1.5%, after an alarm 9.2% → 0.5%, memory 692 MB → 457 MB |
| Tests | Mac: 17 test scripts, about 360 checks; Windows: 534 `node:test` tests; Claude extension: 16 |
| Languages | Korean, English, Dutch (Dutch for my friends in Belgium and the Netherlands; English and Dutch drafted by AI, not yet reviewed by a native speaker) |
| Code | about 37k lines of Swift (zero dependencies), about 30k lines of TypeScript plus 2.6k lines of CSS |

What changed day to day: I add things with a shortcut, see everything in one place and get a daily reminder. I forget fewer tasks and checking my schedule is much easier. I mostly add to-dos, then events. I rarely use the timer or Pomodoro, so I'm collecting feedback on them from a few people I've shared the app with.

Still open: neither app is code-signed, Windows CPU while the pet is on screen (about 4–7%) didn't come down, and the translations haven't had a native speaker's review.

## If I did it again

- Run the Windows version on a real Windows PC from the start. So far it has only run in Electron on macOS; the notification area, click-through and AltGr keyboards are unchecked.
- Keep each case table in one machine-readable file (JSON, say) that both test suites read. Right now the same rows are copied into two test files.
- Write tests that don't depend on the time zone. Some cases assume Asia/Seoul, so CI runs with `TZ=Asia/Seoul`.
