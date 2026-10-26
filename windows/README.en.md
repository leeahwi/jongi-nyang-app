# Jongi-nyang · Windows

[한국어](README.md) · **English** · [Nederlands](README.nl.md)

> The **Windows version** of a to-do app you pull out like a single sheet of paper. Write down just today’s to-dos, check them off, done.
> Above the taskbar sits **Jongi-nyang (종이냥, ‘paper cat’)**, a paper cat that cheers you on, reminds you, and now and then has a word for you.

| Today |
| --- |
| ![Today](../docs/screenshots/windows/en/strip.png) |

- **Windows 10/11 (x64)** — this folder (`windows/`). Electron 44 + TypeScript, no outside UI libraries.
- The **macOS version** lives in the [`mac/` folder](../mac). Same design, features and file format, so one shared folder gives you the same list on a Mac.
- No internet, account or server: everything stays on this PC (or in a synced folder you choose). [Events](#events--calendar) live inside Jongi-nyang too, and a single [backup file](#backup--move) moves everything to another computer.
- **Korean, English and Dutch.** Desk → Appearance → **Language**: Automatic (the system’s language) · 한국어 · English · Nederlands. Changing it restarts the app.
- **Night paper**: when Windows is in dark mode, the paper turns the color of paper in a room with the light off (Desk → Appearance → Paper: Automatic · Day · Night).

---

## Contents

- [Features](#features)
- [Input line · Day ribbon · Slips](#input-line--day-ribbon--slips)
- [Ahead tab · Today window](#ahead-tab--today-window)
- [Desk · Night paper](#desk--night-paper)
- [Focus mode](#focus-mode)
- [Conveniences](#conveniences)
- [A time for to-dos · Lighter](#a-time-for-to-dos--lighter)
- [The new day ribbon · Your day](#the-new-day-ribbon--your-day)
- [Events & calendar](#events--calendar)
- [Alarms · Quick note · Custom timer](#alarms--quick-note--custom-timer)
- [Backup & move](#backup--move)
- [Screens](#screens)
- [Install and run](#install-and-run)
- [Shortcuts](#shortcuts)
- [Where your data lives](#where-your-data-lives)
- [Development](#development)
- [Differences from the macOS version](#differences-from-the-macos-version)
- [Fonts and images](#fonts-and-images)
- [Changelog](CHANGELOG.md)

## Features

### 📝 One sheet for today
- One to-do per line; click the box and a pencil line crosses it out. The day turns at **4 a.m.**
- Pen · Marker · Clean fonts and four text sizes. Drag lines by their handle to reorder, and bring back a deleted one with `Ctrl+Z`.
- Tabs at the top: **Today · Ahead · Notes**. Drag a to-do from Today onto ‘Ahead’ and it goes to its day if its due date is still ahead, otherwise to Someday.
- Double-click the top or press `Ctrl+M` and the notepad folds into a **little sticky note** with the cat peeking out. The × leaves the app in the **notification area (tray)**, still sending reminders.

### 🗓 Dates in plain words
- `meeting tomorrow at 3` → a reminder tomorrow at 3 PM, `report by friday` → due Friday, `before 10/5`, `next monday`, `tonight`, `in 30 min`…
- In Dutch: `overleg morgen om 3 uur`, `verslag tot vrijdag`, `over 2 uur`… — and Korean is always understood too.
- While you type, chips above the [input line](#input-line--day-ribbon--slips) show what was understood; `Tab` picks another reading (an event, a note…).
- **Quick add from anywhere, `Ctrl+Alt+N`**: the same input line comes up on a small slip, even while you’re in another app.

### 🔔 Reminders · Repeat · Due dates
- Per to-do: a one-time reminder (in 10 min · tomorrow 9 AM · any day and time), **Repeat** (every day · weekdays · chosen weekdays · monthly), a **due date** (today · this week · this month · a date).
- Reminders arrive as a bubble above the cat or a card at the bottom right. Reminders due together share one bubble; check them off right there or snooze (5/10/30 min).
- A regular reminder about what’s left (every 1–240 minutes) too.
- **Calendar** (`Ctrl+D`, the first pane of the [desk](#desk--night-paper)): events and to-dos with due dates or reminders by month or week ([Events & calendar](#events--calendar)).

### 🐱 The desktop cat
- Sits above the taskbar, breathes, blinks, tilts its head, walks around, sips tea, and dozes off when you’re away. It cheers when you finish a to-do.
- **Cat talk**: now and then it talks about what’s left today, due dates, the time of day, the weekday and **today’s events** (114 lines). Sometimes it **asks** something like “Have you had some water?” and answers your button (20 questions). “Take five?” → ‘Break time’ starts 5 minutes; “50 min until your next event. Focus for 25 minutes?” → ‘Let’s go’ starts 25. About events: “‘Team meeting’ soon”, “‘Team meeting’ over? Nice work!”. Quiet while you focus, while a reminder is up, and at night.
- On Sunday evening it tells you how many to-dos you finished that week.

### ⏱ Focus timer
- 5 · 15 · 25 · 50-minute timers, [your own lengths](#-custom-timer) and **Pomodoro** (focus · break · long break). The cat holds the sign anywhere on your screen.
- Click to pause, drag to move, right-click for 5 more min · Stop · **Size** (Small · Regular · Large · Extra large).
- **[Focus](#focus-mode)** on one to-do and the notepad becomes a single card: the time left and that to-do.

### 🌱 History
- Finished to-dos move to a monthly history file the next day (adjustable), shown as a **grid of green squares, monthly bars and your streak**.
- Your **focus time** and sessions show there too: per day, and the to-dos you focused on most.

### ☁️ One list on several devices
- Pick a OneDrive · Dropbox · iCloud Drive folder in Desk → Storage & backup → Storage folder, and every PC or Mac that picks the same folder shares the list.
- Changes from another device come in a moment later, and **edits made at almost the same time both survive**. When two devices edit the same note, the texts are merged line by line and character by character.
- To-do reminders ring on every device that’s on.

### ⌨️ Keyboard · Help
- `↑↓` to select a line, `Space` to check it off, `Enter` to edit, `Delete` to delete, `Ctrl+↑↓` to reorder.
- The first launch shows a five-card welcome tour, and `F1` opens Help (on the desk) with every topic and a search box.

### 🌐 Languages
- Desk → Appearance → **Language**: **Automatic** follows the system’s preferred languages (the first of Korean, English, Dutch; otherwise English), or pick 한국어 · English · Nederlands. The app restarts after a confirm.
- Everything follows: menus, the tray, dialogs, Help, the welcome tour, dates and times (English 12-hour clock, Dutch weeks start on Monday), quick add and the cat’s lines.
- In English and Dutch the handwriting faces are **Caveat** (Pen) and **Kalam** (Marker), with the Korean faces behind them for Hangul.

## Input line · Day ribbon · Slips

Stage one of the new design (1.19). One **input line** at the bottom of the notepad adds to-dos, events, timers, alarms and notes; the **day ribbon** on the Today tab shows now and next. Every window that pops up is one family of taped **slips**.

- **Input line**: while you type, chips show how it was read — `report tomorrow 3pm` a to-do with a reminder, `meeting tomorrow at 3` an event, `report by friday` a due date, `timer 40` · `25 min focus` a timer, `alarm 7am weekdays` an alarm, several lines a note. `Tab` for another reading, `Enter` to add, `Ctrl+Enter` for an event. Start with `/todo /event /note /timer /alarm` to pick the kind.
- **Switch after adding**: ‘Added as an event · tomorrow 3:00 PM — Make it a to-do’ shows for 4 seconds. Switching removes what was just added without a trace and adds the next reading; switch the same words twice and that reading comes first from then on. `Ctrl+Z` takes it back right away.
- **Day ribbon**: what’s on now in large with a ring of the time left, the next two things as rows and the day as a thin bar (1.25, [below](#the-new-day-ribbon--your-day)). Click it to open the day’s timetable in place. To-dos with a reminder still ahead gather in a **Next** group (up to three).
- **Slips**: quick add, quick note, custom timer, alarms (a ringing slip with 5 · 10 · 15 min snooze), to-do and event reminders, the event sheet (chips with a small month and a 15-minute list) and questions share one look — the tape’s color tells the kind.

## Ahead tab · Today window

Stage two of the new design (1.20). The **Due** and **Later** tabs become one **Ahead** tab, by date, and clicking the cat in the notification area opens the **Today window**.

- **Ahead**: from tomorrow, each day of this week and next week with its **events** (color bar · time · title) and the **to-dos** due that day; later due dates **by month** (with the year when it isn’t this year); undated things in **Someday** at the bottom. The header says ‘This week · Oct 4 – 10’ and ‘6 to-dos · 3 events’. Weeks start on Sunday (in Dutch, Monday); days turn at 4 a.m.
- **Drag to move**: drop a to-do on another day to make that its due date, on Someday to take the date away, on the Today tab to do it today. The day lights up green, and a toast says ‘Moved to Oct 9 · Undo’ (`Ctrl+Z` too). Inside a day it changes the order.
- On the Ahead tab, the input line puts a to-do with a date on that day and one without in Someday. A window that was showing the old Due or Later tab opens on Ahead. Tab shortcuts: `Ctrl+1` Today · `Ctrl+2` Ahead · `Ctrl+3` Notes.
- **Today window**: click the tray icon and it opens beside the taskbar (wherever the taskbar is) — three cards for the next event · the timer · the next alarm (red within the hour or while the timer runs), ‘Next’ and a few of today’s to-dos (check them right there), the input line, and Open the notepad · Desk · Hide the cat. Click elsewhere or press `Esc` to close it. Double-click the icon to open the notepad straight away; the right-click menu is unchanged.
- Hover the icon to see what’s within the hour (‘Jongi-nyang · Dentist 40 min’) or, while a timer runs, the time left (‘Jongi-nyang · 12:30’).

## Desk · Night paper

Stage 3 of the new design (1.21). The separate Calendar · History · Settings · Help windows come together in one **desk**, and **night paper** follows Windows’ dark mode.

- **The desk**: opens from the desk icon on the notepad or `Ctrl+D` (920 × 640 at first, 760 × 520 at the smallest; size and place remembered). The list on the left: **View** (Calendar · History · Clock) · **Settings** (Appearance · Reminders · Repeat · Cat · Events · Storage & backup) · **Help** (Help · Welcome tour). Inside the desk `Ctrl+1`–`Ctrl+9` go down the list, and `↑` `↓` move in it. Narrower than 820, the list keeps only its icons. There’s only ever one desk; the menus, the tray, the cat, Today window and a reminder’s ‘Open in Calendar’ all open the right pane of it.
- Every pane keeps what its old window did. On top a big title and one line about it; the groups sit in cards. **Storage folder** and **Backup & move** live in the new **Storage & backup** pane, and the menus’ Export… · Import… open it before they ask.
- **Night paper**: Desk → Appearance → **Paper** (Automatic · Day · Night). Automatic follows Windows’ light or dark mode at once, and every open window (note · Today window · slips · reminders · cat · timer · sticky note · desk) changes with it. Windows start in the paper’s color, so nothing flashes white. All text passes WCAG AA contrast.

## Focus mode

Stage 4 of the new design (1.22): just one to-do and the time left.

- **Start**: right-click a to-do → **Focus on this** (the Pomodoro focus length · 50 min · recent lengths · Custom… · As a Pomodoro), type ‘focus 25 report’ in the input line, or **Pick a to-do to focus on…** in the timer menus (each row on Today offers a small **Focus** button).
- **The focus card**: a ring that fills as time goes by with the time left, the to-do in handwriting, what’s next today, **Done** (checks it off) · **5 more min** · **Not now**, today’s other to-dos folded away (open them to check one off), and a cheering cat. When time’s up: a soft chime, a green ring, ‘25 min done’; with a Pomodoro, **Take a 5 min break** → **Next round** · **Stop**. `Esc` asks before stopping.
- While you focus, cat talk and other to-dos’ reminders wait and come together afterwards (event alerts and alarms still come). The tray tooltip says ‘● 12:30’; close the notepad and the timer sign holds the to-do’s name.
- Focus sessions are kept in `focus.jsonl` in the storage folder (the history format is unchanged) and show in History: a **Focus** tile, focus time per day, **Focused on most**. Backups and shared folders carry them.
- Every text color on day paper now passes WCAG AA as well (faint text, clay, sage text, the checkbox edge).

## Conveniences

1.23 adds a batch of small things that save steps every day — the same rules and test cases as the Mac’s 1.38.

- **Tomorrow · Change date**: hover a line on Today for **→ Tomorrow** and **Focus**. Right-click → **Change date ▸** Tomorrow · This Friday (Mon–Thu) · Next Monday · Someday · Pick a date…; with a line selected `Alt+→` / `Alt+←` (a day later · earlier, never before today) · `Alt+↓` (Someday) · `F` (focus). A move says ‘Moved to tomorrow · Undo’.
- **Since yesterday · 3 days**: an undated to-do that stayed on Today past a day gets a small tag at the end. The day it first came to Today is saved in the to-do as `"todaySince": "yyyy-MM-dd"`, the same as on the Mac.
- **Evening tidy-up** (on by default, 8 PM, 6–10 PM): the cat asks ‘3 to-dos left today. Move them to tomorrow?’ — untick what stays, then To tomorrow · To Someday · Leave as is. Missed it? The first time you open the notepad the next day it asks as the **Morning tidy-up**. It waits while you focus.
- **Today’s one thing** (off by default): the first time you open the notepad each day the empty line asks ‘If you do just one thing today?’ — the first to-do you write goes to the top of Next with a star.
- **Snooze choices**: the reminder slip’s ⌄ has In 5 · 10 · 30 min · 1 hour · Tonight at 7 PM · Tomorrow at 9 AM · Move to tomorrow, and the slip has a **To tomorrow** button. Event alerts get **5 min before**.
- **Windows notifications too** (Desk → Reminders, default ‘Only missed’): when the cat and the notepad are both hidden or the screen is locked, reminders also go to Windows notifications, with **Done · In 10 min** right there (alarms: **Stop · Snooze**).
- **Search** `Ctrl+F` (⋯ → Search…, or the top of the desk): Today · Ahead · Notes · History · Events at once. Case and accents don’t matter (cafe finds Café); Korean matches first consonants too.
- **Input line**: ‘every day drink water’ · ‘weekdays 8am workout’ · ‘every Monday 9am team meeting’ → a repeating to-do (a repeating event for event words); ‘take out laundry in 30 min’ → a reminder in 30 minutes.
- **Your day**: click an empty spot to write a to-do or event for that time, or double-click for a new event slip at that time (to the quarter hour).
- **Focus card**: ⏸/▶ under the time, `Space` pause · `Ctrl+Enter` done · `Ctrl+=` 5 more min · `Esc` stop, with keycaps on the buttons.
- **Undo toasts** after deleting a to-do or a note, ‘All done’ on a reminder, and Clear finished to-dos.
- **From anywhere** `Ctrl+Alt+J` shows or hides the notepad; ⋯ → **Dock to the right / left edge** (again to put it back); **Put copied text into a quick note** (setting, off by default).
- **The taskbar**: the button’s progress while a timer or focus runs (yellow when paused), ⏸ · ⏹ · +5 min in its preview, a Jump List (Quick add · Quick note · Desk · Focus 25 min · 5 min timer), and a badge with the to-dos left (setting). A small red dot on the tray face when something comes within the hour.
- **Open when the computer starts**: a switch on the welcome tour’s last card; start it by hand three times with it off and the cat asks once.
- Short windows (480 px high or less) get a compact header, and the sleeping header cat sits a little higher so its eyes clear the edge. The Today window’s empty cards now do something too (no event → a new event, no alarm → ‘alarm 7am’ in the line).

## A time for to-dos · Lighter

1.24 lets a to-do have a **time**, and makes Jongi-nyang much lighter. Same rules and shared cases as Mac 1.39.

- **Set a time**: right-click a line → **Set a time…**, or **Time** on its reminder card: start → end (the 15-minute list, or type ‘5:20pm’), lengths **30 min · 1 hour · 2 hours**, **Remove**. A start alone shows as 30 minutes. The day is the due date, or today while it sits on Today.
- **From the line**: `report 2-4pm` · `report from 2 to 4` · `2pm–3:30pm report` (Korean `3시부터 5시까지 보고서`, Dutch `verslag van 2 tot 4 uur`) → chip ‘To-do · today 2:00–4:00 PM’; `Tab` gives the event with the same hours. A range already over goes to tomorrow.
- **Reminder**: a to-do without one gets a reminder at the start (shown on the card, change or remove it). Moving the time moves a reminder that was at the start.
- **Day ribbon · Your day**: green stretches on the bar, green-outlined blocks in the opened day — done ones faded and struck through, ones past their time and still open in red, side by side when they overlap. Drag a block and it follows the mouse, then settles on a quarter hour; drag its top or bottom edge to change its start or end (`Esc` cancels).
- **Lists**: a clock and `2:00–3:30 PM` at the end of the line; **Next** in start order; Ahead, the Today window, search and the desk’s calendar (week and day list) show the time too. Focusing on a timed to-do offers what is left of it first. Backups, shared folders, history and text export keep it (`"timeStart"` · `"timeEnd"`, the same JSON as the Mac).
- **Alarm snooze Off**: the alarm editor’s snooze has **Off** (before 5 · 10 · 15 min). An alarm with snooze Off rings with only ‘Stop’ and simply stops after 10 minutes.
- **Lighter**: far less CPU while the notepad just sits open (the ribbon’s ‘now’ dot no longer pulses forever, a hidden desktop cat’s window closes, the alarm slip stops moving once it is put away, the state goes only to pages that listen, unchanged rows and ribbon aren’t redrawn, files are checked by size and time first). Measure with `npm run perf`.

## The new day ribbon · Your day

In 1.25 the **day ribbon** on the Today tab is drawn anew: no card, just a region of the paper with a fine rule above and below, and a click opens **the day’s timetable** in place. Same spec and shared cases as Mac 1.40.

- **Top line · bar**: all-day events (‘All day · Mom’s birthday’, two and ‘+N’) and **Whole day ›**. A thin bar holds the day — events in their colors, to-dos with a time in green, the past a little darker, now a red mark (still, no blinking) — with 8 AM · 12 PM · 4 PM · 8 PM · 12 AM.
- **Now, large**: a ring with the time left (‘40 min left’, ‘1:20 left’) beside the handwritten title, ‘Now · 1:00–2:00 PM’ and the place or ‘To-do’. When what’s on is a to-do, click the ring to **focus** on it, or tick its box to finish it. With nothing on: the time until the next thing (red within the hour); nothing left: ‘Nothing else today’.
- **Next rows**: two rows like ‘2:00 PM □ Finish the report · in 40 min’ (one in a narrow notepad, three in a tall one). Click to go to it; right-click for its usual menu.
- **Your day**: one row an hour, starting at the whole hour before now − 1 h. Events as colored blocks, to-dos as green-outlined blocks (done ones faded and struck, late ones in red), reminders as small tags, overlaps side by side in three columns plus ‘+N’. Drag a block and it follows the mouse, settling into the quarter hour shown by a dashed outline; drag its top or bottom edge to change its start or end (1.26, ‘Time changed · Undo’, `Esc` while dragging cancels). Click an empty spot for ‘What will you do?’ at that time, double-click for a new event slip. `↑` `↓` · `Enter` · `Space` · `Alt+↑` `Alt+↓` · `Shift+Alt+↑` `Shift+Alt+↓` (the end, 15 min) · `Esc`.
- **A steady timer**: the floating timer board and the focus card no longer change width as the seconds tick (digits fixed to the width of `88:88`).

| Now, large · next |
| --- |
| ![Day ribbon](../docs/screenshots/windows/en/strip.png) |

## Events & calendar

Jongi-nyang keeps its own events (no Google Calendar or Google Tasks since 1.16.0). They live in `events.json` in the same storage folder as your to-dos, so with a shared folder Jongi-nyang on your other PCs and Macs shares them (read again when they change, like to-dos and notes). To-dos and events never mix.

- **Day ribbon** — when today has events, reminders or to-dos with a time, it sits under the Today title (the day turns at 4 a.m.): all-day events, a thin bar of the day, what’s on now (with a ring of the time left) and the next two things. Click ‘Whole day ›’ or the bar to open **Your day**, where event and to-do blocks move by dragging and an empty spot takes a new to-do or event. Click an event block to edit it, right-click for **Edit… · Add as to-do · Delete…**.
- **New event** — type “meeting tomorrow at 3” in the input line (it becomes an event right away; `Ctrl+Enter` always makes one), a double-click on an empty spot in Your day, ⋯ → **New event…**, a double-click on a day in the calendar, or `Enter` · ‘+ New event’ there.
- **The event card** — a small card in the notepad (or the desk’s calendar): title · date + all day · time (or a length of 1–7 days when all day) · **Repeat** (never · every day · every week · every month · every year) · **Color** (blue · green · orange · purple · yellow · gray, starting with the last one used) · **Place** (optional). It saves and closes at once. A repeating event changes on every day; deleting one asks ‘Only this day’ (that day is skipped) or ‘Delete all’.
- **To-do → event** — right-click a to-do → **Add to calendar…**: an hour at its reminder time, all day on its due date, or else the next half hour, for an hour. It’s a **copy** of that moment, so editing the to-do later leaves the event as it is. The to-do gets a small calendar mark at the end of its line.
- **Event reminders** — the set time before (off · 5 · 10 · 15 · 30 min before, 10 by default), in the same bubble as to-do reminders. Click the title to open **the calendar on that day**.
- **Calendar** — the desk’s first pane. Open it with the desk icon on the notepad, ⋯ → Calendar…, `Ctrl+D`, or the tray menu. Its top row: the title · ‹ Today › · Week/Month · **+ New event**. **Month** (six weeks; each day shows its events’ color bars and titles and its due dates as far as the cell has room, and ‘+N’ for the rest; the times are in the tooltip and the day panel) · **Week** (seven rows, with events, reminders and due dates), and on the right **the day’s panel** with that day’s events (time · title · place) and to-dos. Click an event to edit it, a to-do to see it in the notepad. Keyboard: `←` `→` a day, `↑` `↓` a week (a day in the week view), `T` today, `Enter` new event, `Ctrl+[` `Ctrl+]` previous · next month (week). The calendar’s day turns at **midnight**. In Dutch, weeks start on Monday.
- **Desk → Events** — ‘Show day ribbon’ and ‘Event reminders’.
- **Cat talk** talks about today’s events too (starting soon · now · just over, and when there’s time before the next one, a suggestion to focus for 25 minutes).

`events.json` is `{ "events": [...] }`; an event has `id` · `title` · `date` (first day) · `allDay` · `days` · `start` · `end` (minutes) · `repeat` · `skip` (skipped days) · `color` · `location`? · `taskId`? · `createdAt` · `updatedAt` (the same keys as the Mac).

## Alarms · Quick note · Custom timer

### ⏰ Alarms
- The desk’s **Clock** pane has **Alarms** at the top. Each row shows the time in big letters, the name, the days (‘Once’ · ‘Every day’ · ‘Weekdays’ · ‘Weekends’ · ‘Mon, Wed, Fri’), ‘Rings in 7 h 30 min’ and a switch. Click a row to edit it in place: time · name (optional) · days · sound (**Bell · Soft · Silent**, ▶ Listen) · snooze (5 · 10 · 15 min) · Delete · Done. **Add alarm** starts at 7:00 AM on weekdays.
- When it rings, the cat pops up in the middle of the screen (or above the desktop cat) over every window, holding the time and the name, and the sound repeats until you answer (synthesised with WebAudio, no sound files). **Stop** (`Enter`) · **Snooze N min** (`S` · `Space`). Unanswered for 10 minutes, it stops by itself, snoozes once more and then gives up. An alarm with no days turns off once you stop it.
- **Alarms…** in the cat’s right-click menu and the ⋯ menu; **Next alarm 7:00 AM** in the tray menu.
- Alarms live in `alarms.json` in the storage folder (the Mac’s format; a shared folder shares them), and **every device that’s on rings on its own** (which rings it handled is kept per device in `settings.json` → `alarmHandled`, for 3 days). If the computer was asleep and wakes within 15 minutes it still rings; later than that it’s skipped. Backup & move and moving the storage folder include them.

### ✍️ Quick note
- **`Ctrl+Alt+M`** from anywhere: write a few lines on a small sheet and press `Ctrl+Enter` to add them **at the top of Notes** as a new note. `Esc` or clicking elsewhere closes it and keeps your text (even across a restart). It also opens from the cat’s right-click menu, the ⋯ menu and the tray menu; turn it off in Desk → Appearance → Quick add (you’re told if another app holds the shortcut).

### ⏱ Custom timer
- Every timer menu lists your **recent custom times** (up to 3, like ‘40-min timer’) and **Custom…** after 5 · 15 · 25 · 50 min. Type `40`, `1:30`, `1h 30m`, `1.5h`, `1시간 30분` or `anderhalf uur` on the small sheet by the pointer (any language, 1 minute to 3 hours); it shows what it understood, and `Enter` starts. The **Custom** field in Desk → Clock → Start a timer works the same.
- Pomodoro focus is 1–180 min, breaks 1–60 min. − and + step by 1 (by 5 with `Shift`), or click the number and type it.

## Backup & move

A **one-time move** to another computer (Mac ↔ Windows works too). To keep sharing, pick a shared folder instead.

- **Export…** — Desk → **Storage & backup**, the ⋯ menu, the tray menu (they open the desk’s Storage & backup pane first). The to-dos · notes · repeats · events · alarms · history in the storage folder (the files that exist, as they are) go into one `종이냥-백업-YYYY-MM-DD.jongi` (in English `Jongi-nyang-backup-YYYY-MM-DD.jongi`), and File Explorer shows it once it’s saved. Settings (font, reminders…) are per device, so they’re not included.
- **Import…** — pick a `.jongi` (or `.json`) file and **every file inside is checked with the app’s own parsers first** (if it’s damaged or from a newer version, nothing changes and you’re told why). You see where and when it was exported and what’s in it (“12 to-dos · 3 notes · 2 repeats · 8 events · 140 done”), then choose **Merge · Replace**.
  - **Merge**: keeps what’s here and adds the to-dos · notes · repeats · events only the backup has (the same `id` keeps yours) plus its history lines.
  - **Replace**: after asking once more, swaps everything for the backup’s (kinds the backup doesn’t have are emptied; the history keeps only the backup’s months).
  - Either way, **how things are now is saved first** to `backups\가져오기-전-YYYYMMDD-HHmmss.jongi` in the settings folder (the last 10), and every new file is written to a temporary file and swapped in. Afterwards the list · notes · repeats · events · history are read again (the undo history starts over).

A `.jongi` file is JSON: `{ "format": "jongi-nyang-backup", "version": 1, "exportedAt", "from": "Windows 1.18.0", "files": { "todos.json": "…", "archive/2026-10.jsonl": "…" } }`.

## Screens

The screenshots are from the Korean app; English and Dutch look the same with their own words (`npm run snapshot -- lang=en`).

`npm run snapshot` draws every screen off-screen into `snapshots/` (not committed); the images above are a few of them, copied to [`docs/screenshots/windows/`](../docs/screenshots/windows).

## Install and run

### Download

The repository’s [Releases](https://github.com/leeahwi/jongi-nyang-app/releases) have a built `JongiNyang-<version>-x64.exe` (installer) and a `.zip` (no install).

### Build the installer

Needs Node.js 22 or later (Electron 44 · electron-builder 26).

```sh
npm install
npm run dist         # typecheck + tests + dist/JongiNyang-<version>-x64.exe (installer) · .zip (no install)
```

You can build the Windows installer on macOS too. It isn’t code-signed, so the first launch may need **More info → Run anyway** in SmartScreen. You can choose where to install it (per user), and it adds a ‘종이냥’ shortcut to the Start menu and the desktop. Turn on **Open Jongi-nyang when Windows starts** in Desk → Appearance → Startup.

### Run while developing

```sh
npm start            # build, then run
```

## Shortcuts

| Keys | Does |
| --- | --- |
| `Ctrl+N` | New to-do |
| `Ctrl+Alt+N` | Quick add from anywhere |
| `Ctrl+Alt+M` | Quick note from anywhere |
| `Ctrl+Alt+J` | Show · hide the notepad from anywhere |
| `Ctrl+F` | Search |
| `Alt+→` · `Alt+←` · `Alt+↓` · `F` | Selected line a day later · earlier · to Someday · focus |
| `Space` · `Ctrl+Enter` · `Ctrl+=` · `Esc` | Focus card: pause · done · 5 more min · stop |
| `Enter` · `S` / `Space` | Stop · snooze a ringing alarm |
| `Ctrl+1`–`Ctrl+3` | Today · Ahead · Notes |
| `↑` `↓` · `Space` · `Enter` · `Delete` | Select a line · check off · edit · delete |
| `Ctrl+↑` `Ctrl+↓` | Reorder |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+Shift+C` · `Ctrl+E` | Copy list · Export as text |
| `Ctrl+M` | Fold into a sticky note |
| `Ctrl+H` | Desk · History |
| `Ctrl+D` | Desk · Calendar |
| `Ctrl+1`–`Ctrl+9` · `↑` `↓` | Inside the desk: the panes in the list (Calendar … Storage & backup) |
| `←` `→` · `↑` `↓` · `T` · `Enter` · `Ctrl+[` `Ctrl+]` | In the desk’s calendar: a day · a week · today · new event · previous/next month (week) |
| `Ctrl+Shift+N` | New note |
| `Ctrl+,` | Desk · Appearance |
| `F1` | Desk · Help |

## Where your data lives

```text
%APPDATA%\PaperTodo\todos.json              to-dos (since 1.23 with `todaySince`, the day one came to Today; since 1.24 with a time, `timeStart` · `timeEnd` — as on the Mac)
%APPDATA%\PaperTodo\memos.json              notes
%APPDATA%\PaperTodo\repeats.json            repeating to-dos
%APPDATA%\PaperTodo\events.json             events
%APPDATA%\PaperTodo\alarms.json             alarms
%APPDATA%\PaperTodo\archive\2026-10.jsonl   history (one file per month, one to-do per line)
%APPDATA%\PaperTodo\focus.jsonl            focus sessions (one per line)
%APPDATA%\PaperTodo\settings.json           settings · window positions · language (per device)
%APPDATA%\PaperTodo\storage.json            the chosen shared folder
%APPDATA%\PaperTodo\backups\               automatic backups before an import (*.jongi, the last 10, per device)
```

- Desk → **Storage & backup** → Storage folder shows the folder in use, and **Open folder** opens it in File Explorer. **Done to-dos → History folder** in the same pane does the same for the history.
- Picking a shared folder moves the to-dos · notes · repeats · events · alarms · history there (settings stay per device) and restarts the app. If the folder already has a list, you’re asked which one to keep; either way this PC’s history is added to the folder’s.
- Files are written to a temporary file and swapped in, so a crash mid-save never breaks them. An unreadable file is never overwritten; it’s kept as `*.unreadable-<time>.json`.
- **The same JSON format as the macOS version**, so the files carry on there. To move everything at once, see [Backup & move](#backup--move).
- Since 1.16.0, the leftovers of the old Google integration (`google.json` · `calendar-cache.json` · `tasks-sync.json`) are removed at startup.

## Development

```sh
npm test             # core logic, including events · backup (export → import) · shared folders · translations
npm run typecheck
npm run snapshot     # draws every screen off-screen into snapshots/ + the header overlap check
                     # + the size sweep (snapshots/sweep/: each window at several sizes · 125/150 % · another font, with layout checks; fails on problems)
npm run snapshot -- sweep      # the size sweep only (day and night paper)
npm run snapshot -- stage3     # only the desk’s panes and night paper (snapshots/night/)
npm run snapshot -- convenience # only 1.23’s new screens (day and night, conv-*.png)
npm run snapshot -- timeblock # only 1.24’s to-do times and snooze Off (day and night, tb-*.png)
npm run snapshot -- strip # only 1.25’s day ribbon, Your day and the timer width check (day and night, strip-*.png)
npm run perf         # a --demo run on a heavy sample data set: start time, idle CPU, input latency… (--quick · --long)
npm run snapshot -- lang=en    # the same in English (snapshots/en/), or lang=nl (snapshots/nl/)
```

Tests and snapshots use `PAPERTODO_OFFSCREEN=1` to draw windows off every screen, so no reminder pops up over your work. Run with `--weekly-now <ISO time>` to see the Sunday evening look-back any day.

**Translations**: every word the windows show goes through `t("한국어 원문", vars)` (`src/i18n/`), with the Korean text as the key and `src/i18n/en.ts` · `src/i18n/nl.ts` as the tables (`{name}` placeholders, `{n|one|many}` for plurals). `test/i18nStrings.test.ts` fails when Hangul is left outside `t()` in `src/main`, `src/renderer` or the preload, or when a key is missing from English or Dutch. Dates, times, quick add and the cat’s lines are in the core (`src/core/lang.ts`), shared with the Mac.

```text
src/core/       logic without any UI — the same rules and test cases as the macOS PaperCore
                (lang, notebook, quickParse, textMerge, due, chatter, bubbleText, repeat, archive, shelf, storage, calendar, events, backup, alarm, duration …)
src/i18n/       t() and the English and Dutch tables for the windows, menus and dialogs
src/main/       the Electron main process — store (the one state · saving · syncing), pet, timer, popup, reminders,
                floating (sticky note), quick (quick add), quickMemo (quick note), timerSheet (custom timer), alarms (ringing), storageFolder (shared folder · writing backups), archiveStore,
                calendar (today’s events · event reminders · the event card), desk (the desk window), main (windows · tray · menus · shortcuts · night paper · export · import · language)
src/preload.ts  the bridge that lets only allowed channels through (and the language) — the pages run sandboxed with contextIsolation
src/renderer/   each window’s HTML/CSS/TypeScript (note · desk · pet · timer · reminder · sticky note · quick add · quick note · custom timer · alarm) and the desk’s panes (calendar · settings · history · help);
                the color tokens for day and night paper in base.css
assets/         the cat · paper texture · handwriting fonts
tools/          build · snapshot · font scripts
```

The **Cat talk** tables (`src/core/chatter.ts`) are generated by `generate.py` from `mac/scripts/chatter/chatter_lines.py`, in all three languages. To change a line, edit that file so both apps change together.

## Differences from the macOS version

- A custom top bar (📌 · desk · ⋯ · close) instead of a window frame; closing hides it to the notification area.
- No menu bar: the tray icon instead — hovering it says what the Mac’s menu bar text says (‘Jongi-nyang · Dentist 40 min’, a running timer), a click opens Today window (the Mac’s popover), a right-click the menu. There’s no ‘Menu bar text’ setting (a tooltip takes no room).
- The timer size scales only the timer window (other windows’ text size is unaffected).
- The event card (Add to calendar · New event · Edit) is a small card inside the notepad (like the reminder card) instead of a popover on the Mac. Quick add’s event key is `Ctrl+Enter` (Mac `⌘Return`).
- Export · Import are in the ⋯ menu · tray menu · Desk → Storage & backup instead of the Mac’s File menu (⇧⌘E · ⇧⌘I).
- The desk opens from the note’s desk icon · the ⋯ menu · tray menu · `Ctrl+D` (Mac `⌘D`) instead of the View menu, and the event cards appear inside its calendar. Each pane holds its old window’s page as it was. Night paper follows Windows’ app mode (light · dark).
- The language restarts the app itself; the Mac sets the app’s own language for macOS and relaunches.

> **Still to check on a real Windows PC**: this app was run with Electron on macOS to check every screen and behaviour (keyboard · drag and drop · quick add · shared-folder sync · note merging · reminders · cat talk) and to build the installer. Installing on real Windows, the notification area, click-through, `Ctrl+Alt+N` focus and AltGr keyboards haven’t been checked yet.

## Fonts and images

- The handwriting fonts **HanJang Pen / HanJang Brush** are Nanum Pen and Nanum Brush (SIL OFL 1.1) with narrower letters. License: `assets/fonts/OFL.txt`.
- English and Dutch use **Caveat** (pen) and **Kalam** (marker), both SIL OFL 1.1 — `assets/fonts/Caveat-OFL.txt` and `assets/fonts/Kalam-OFL.txt`.
- The cat and the paper texture were made with an image generation tool (not a scan of real paper).

## License

The source code in this repository is released under the [Apache License 2.0](../LICENSE) (© 2026 leeAhwi; see [NOTICE](../NOTICE)). The bundled fonts stay under their own SIL Open Font License 1.1. The copyright line in the shipped app’s About screen is left as released.
