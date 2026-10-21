# JongiNyang

A paper-notebook app for tasks, events, notes, and focus timers on macOS and Windows. A small cat sits at the bottom of your screen, delivers reminders, and celebrates completed tasks.

[한국어](README.md) | **English** | [Website](https://leeahwi.github.io/jongi-nyang-app/en/)

[![CI](https://github.com/leeahwi/jongi-nyang-app/actions/workflows/ci.yml/badge.svg)](https://github.com/leeahwi/jongi-nyang-app/actions/workflows/ci.yml)

[Download for macOS](https://github.com/leeahwi/jongi-nyang-app/releases/tag/mac-v1.40.1) | [Download for Windows](https://github.com/leeahwi/jongi-nyang-app/releases/tag/windows-v1.25.1)

![JongiNyang on macOS in light and dark themes, and on Windows](docs/screenshots/hero-en.png)

[Features](#features) | [Installation](#installation) | [Storage and backups](#storage-and-backups) | [Development](#development) | [Documentation](#documentation)

## Features

JongiNyang brings tasks and events into one small notebook. Start without an account, open the notebook when you need it, and fold it into a sticky note when you are done.

- **Tasks and notes:** Organize items in Today, Ahead, and Notes. Set deadlines and recurring tasks, and search using Korean initial consonants.
- **Natural-language input:** Add tasks, events, timers, and alarms in one input line. Check the interpretation shown while typing and press `Tab` to choose another candidate.
- **Daily schedule:** See the current and upcoming events. Drag blocks in the expanded timetable to adjust their times in 15-minute increments.
- **Focus mode:** Keep the selected task and remaining time together. Use a regular timer or Pomodoro sessions, and review your focus history.
- **Reminders and a cat:** Receive task and event reminders and alarms. The cat celebrates completion and suggests breaks.
- **Appearance and languages:** Choose light or dark themes, handwriting or system fonts, and Korean, English, or Dutch.

Try these in the input line:

| Input | Result |
| --- | --- |
| `meeting tomorrow 3pm` | An event tomorrow at 3 PM |
| `report by Friday` | A task due on Friday |
| `timer 40` | A 40-minute timer |
| `alarm 7am weekdays` | A weekday alarm at 7 AM |

See the [macOS guide](mac/README.en.md) and [Windows guide](windows/README.en.md) for shortcuts and detailed usage.

| Natural-language input | Daily schedule | Focus mode |
| --- | --- | --- |
| ![Natural-language input on macOS](docs/screenshots/mac/en/line-event.png) | ![Daily schedule on Windows](docs/screenshots/windows/en/strip.png) | ![Focus mode on macOS](docs/screenshots/mac/en/focus-running.png) |

The [screenshots](docs/screenshots/) were rendered from the app using sample data.

## Installation

| Platform | Requirements | Download |
| --- | --- | --- |
| macOS | macOS 14 or later, Apple Silicon | [v1.40.1 DMG](https://github.com/leeahwi/jongi-nyang-app/releases/tag/mac-v1.40.1) |
| Windows | Windows 10/11, x64 | [v1.25.1 installer and ZIP](https://github.com/leeahwi/jongi-nyang-app/releases/tag/windows-v1.25.1) |

On macOS, open the DMG and drag the app into Applications. On Windows, run the installer or extract the ZIP. Intel Macs require a source build. Other versions are available on the [releases page](https://github.com/leeahwi/jongi-nyang-app/releases).

The macOS release has no Developer ID signature or notarization; the Windows release is not code-signed. If the first launch is blocked, use **System Settings → Privacy & Security → Open Anyway** on macOS, or **More info → Run anyway** in Windows SmartScreen.

## Storage and backups

Data is stored as JSON and other files in a folder you choose. No account or dedicated server is required.

- **Choose a location:** Change the folder in the app's **Desk → Storage & Backup** settings.
- **Share across devices:** Choose a folder synchronized by iCloud Drive, OneDrive, Dropbox, or another provider to use the same data on macOS and Windows. The provider handles file transfer.
- **Back up or move:** Export tasks, notes, events, alarms, completion history, and focus history to a `.jongi` file, then import it on another device.

The [architecture document](docs/architecture.md) explains concurrent edits in shared folders. Reminders and alarms fire on each device where the app is running.

### Known limitations

- The Windows app was checked with Electron running on macOS. Installation on a Windows PC, notification-area behavior, and AltGr input have not yet been verified.
- English and Dutch translations started as AI drafts and have not been reviewed by native speakers.

## Development

The macOS app uses Swift 6, SwiftUI, and AppKit. The Windows app uses TypeScript and Electron. The implementations are separate; shared test cases define inputs and expected results for natural-language input, scheduling, backups, and other core behavior.

```sh
git clone https://github.com/leeahwi/jongi-nyang-app.git
cd jongi-nyang-app
```

### macOS

Use macOS 14 or later and a Swift 6 toolchain from Xcode or Command Line Tools. From the repository root:

```sh
cd mac
./scripts/run.sh
TZ=Asia/Seoul ./scripts/test.sh
```

`run.sh` builds and opens `dist/종이냥.app`. Run the test command separately.

### Windows

Install Node.js 22 or later. From the repository root:

```sh
cd windows
npm ci
npm start
```

In PowerShell, run the following commands for type checking, tests, and Windows x64 packaging. Some tests assume Korean local time.

```powershell
$env:TZ = "Asia/Seoul"
npm run typecheck
npm test
npm run dist
```

Packages are written to `windows/dist/`. In POSIX shells, use `TZ=Asia/Seoul npm test`. CI currently checks the Windows app's types and tests on a macOS runner.

## Documentation

| Document | Contents |
| --- | --- |
| [Architecture](docs/architecture.md) | UI and core logic, data formats, concurrent editing |
| [Engineering](docs/engineering.md) | Shared tests, rendering, translation checks, performance measurements |
| [Design process](docs/design-process.md) | Screens, themes, and component design |
| [Decisions](docs/decisions.md) | Reasons for file storage and separate platform implementations |
| [Changelog](CHANGELOG.en.md) | Notable changes by version |
| [Project overview](portfolio/one-pager-en.md), [Troubleshooting](portfolio/troubleshooting.en.md) | Project background and implementation examples |

Start with the core logic in [mac/Sources/PaperCore/](mac/Sources/PaperCore/) and [windows/src/core/](windows/src/core/). UI and platform integration live in each app directory; the website is in [site/](site/). Some detailed documents are in Korean.

The creator handled planning, feature priorities, design decisions, and everyday-use review. Claude Code assisted with code, tests, measurement scripts, and translation drafts; image-generation tools were used for the cat and paper textures. See the [AI collaboration record](portfolio/ai-collaboration.md) for the division of work and review process.

## License

Source code is licensed under [Apache License 2.0](LICENSE). © 2026 leeAhwi.

Included fonts use the SIL Open Font License 1.1. See [NOTICE](NOTICE) for the terms covering fonts, images, and components included in release packages.
