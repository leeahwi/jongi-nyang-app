# 구조

[← 저장소로](../README.md) · [엔지니어링](engineering.md) · [디자인 과정](design-process.md) · [결정 기록](decisions.md)

종이냥은 macOS용(Swift, SwiftUI + AppKit)과 Windows용(Electron + TypeScript)이 따로 있다. 두 앱은 코드를 나누지 않고 규칙, 파일 형식, 시험 사례를 나눈다. 왜 그렇게 했는지는 [결정 기록 ADR 4](decisions.md#adr-4-코드-대신-시험-사례를-나눈다)에 있다.

## 전체 그림

```mermaid
flowchart TB
    subgraph SPEC["두 앱이 나누는 것"]
        direction LR
        CASES["공유 시험 사례<br/>입력 줄 1–324, 하루 띠 R/K/G/N/T<br/>집중 F/FB, 앞으로, 편의 기능"]
        FORMAT["파일 형식<br/>todos.json, events.json, focus.jsonl …"]
        TOKENS["디자인 토큰<br/>종이, 먹, 세이지, 점토 (낮/밤)"]
        CHATTER["종이냥 한마디<br/>chatter_lines.py → 두 앱의 표"]
    end

    subgraph MAC["mac/ (Swift Package)"]
        direction TB
        MCORE["PaperCore<br/>화면과 무관한 로직<br/>(35개 파일, 약 8천 줄)"]
        MAPP["PaperTodo<br/>SwiftUI + AppKit<br/>노트, 펫, 쪽지, 책상, 메뉴 막대"]
        MAPP --> MCORE
    end

    subgraph WIN["windows/ (Electron)"]
        direction TB
        WCORE["src/core<br/>화면과 무관한 로직<br/>(44개 파일, 약 8천 줄)"]
        WMAIN["src/main<br/>창, 저장, 알림, 타이머, 알림 영역"]
        WREND["src/renderer<br/>창마다 HTML, CSS, TS"]
        WMAIN --> WCORE
        WREND --> WCORE
        WREND <-->|preload IPC| WMAIN
    end

    CASES -.같은 사례로 검사.-> MCORE
    CASES -.같은 사례로 검사.-> WCORE
    FORMAT -.-> MAPP
    FORMAT -.-> WMAIN
    TOKENS -.-> MAPP
    TOKENS -.-> WREND
    CHATTER -.생성.-> MCORE
    CHATTER -.생성.-> WCORE
```

## 코어와 화면

두 앱 모두 화면과 무관한 규칙을 코어에 모았다. 입력 줄의 글을 어떻게 읽을지, 하루 띠에 무엇을 놓을지, 앞으로 탭을 어떻게 나눌지, 백업을 어떻게 합칠지는 코어가 정하고 화면은 결과를 그리기만 한다. 코어는 UI 없이 시험할 수 있어서, 같은 사례를 Swift와 TypeScript에 그대로 넣을 수 있다.

| 영역 | macOS `PaperCore` | Windows `src/core` |
| --- | --- | --- |
| 목록, 실행 취소 | `Notebook.swift` | `notebook.ts` |
| 입력 줄의 뜻 읽기 | `Intent.swift`, `QuickParse.swift` | `intent.ts`, `quickParse.ts` |
| 하루 띠, 하루 일정표 | `DayStrip.swift`, `DayRibbon.swift` | `dayStrip.ts`, `ribbon.ts` |
| 할 일 시간 | `TimeBlock.swift` | `timeRange.ts` |
| 앞으로 탭, 오늘 창 | `Ahead.swift`, `TodayGlance.swift` | `ahead.ts`, `glance.ts` |
| 집중 기록과 세션 | `Focus.swift`, `FocusTimer.swift` | `focus.ts`, `focusTimer.ts` |
| 알람, 타이머 길이 | `Alarm.swift`, `Duration.swift` | `alarm.ts`, `duration.ts` |
| 반복, 마감, 보관 | `Repeat.swift`, `Deadline.swift`, `Archive.swift` | `repeat.ts`, `deadline.ts`, `archive.ts` |
| 메모 합치기 | `TextMerge.swift` | `textMerge.ts` |
| 백업 | `Backup.swift` | `backup.ts` |
| 종이냥 한마디 | `PetChatter.swift` (생성됨) | `chatter.ts` (생성됨) |
| 3개 언어의 말, 날짜, 시간 | `AppLanguage.swift` | `lang.ts` |

종이냥 한마디는 파이썬 파일 `chatter_lines.py` 하나에서 두 앱의 코드를 생성한다.

화면 쪽은 플랫폼마다 따로 만들었다.

```mermaid
flowchart LR
    subgraph M["macOS (PaperTodo)"]
        direction TB
        AM["AppModel<br/>(상태, 저장, 공유 폴더 확인)"]
        NW["NoteWindow / PaperView<br/>노트, 탭, 입력 줄, 하루 띠"]
        PET["DesktopPet<br/>투명 패널, 고양이 위에서만 클릭"]
        SLIP["PaperSlip 가족<br/>울리는 쪽지, 일정 쪽지, 확인"]
        DESK["DeskWindow<br/>달력, 기록, 설정, 도움말"]
        MB["메뉴 막대 얼굴, 오늘 창"]
        AM --> NW & PET & SLIP & DESK & MB
    end
    subgraph W["Windows (Electron)"]
        direction TB
        MAIN["main.ts, store.ts<br/>(상태, 저장, 공유 폴더 감시)"]
        NOTE["note.html<br/>노트, 탭, 입력 줄, 하루 띠"]
        WPET["pet.html<br/>투명 창, 고양이 위에서만 클릭"]
        WSLIP["slip.css / slipWindow.ts<br/>울리는 쪽지, 일정 쪽지, 확인"]
        WDESK["desk.html<br/>칸마다 원래 페이지를 프레임으로"]
        TRAY["알림 영역 얼굴, 오늘 창, 작업 표시줄"]
        MAIN --> NOTE & WPET & WSLIP & WDESK & TRAY
    end
```

| 같은 역할 | macOS | Windows |
| --- | --- | --- |
| 상태를 가진 곳 | `AppModel`(ObservableObject) | Electron main 프로세스(`store.ts`), 창에는 IPC로 보냄 |
| 머리말 고양이와 탭 | SwiftUI 뷰 | HTML/CSS, `icons.ts`의 선 아이콘 |
| 펫 | 투명 `NSPanel`, 숨쉬기는 Core Animation | 투명 `BrowserWindow`, CSS 애니메이션 |
| 메뉴 막대 글자 | 메뉴 막대 아이템 | 알림 영역 툴팁 |
| 밤 종이 | `PaperTheme` 토큰 두 벌 | `base.css`의 `:root[data-paper="night"]` |
| 번역 | `.lproj` 문자열표, 한국어 원문이 키 | `t("한국어 원문")` + `en.ts`, `nl.ts` |

펫 창은 화면 아래쪽 넓은 영역을 덮는 투명한 창이라, 고양이 위에서만 마우스를 받고 나머지는 뒤의 앱으로 넘긴다. 그러지 않으면 투명한 창이 그 아래 앱의 클릭을 가로챈다.

## 데이터 파일

계정과 서버가 없다. 모든 데이터는 저장 폴더의 JSON 파일이고, 두 앱이 같은 형식을 읽고 쓴다. Windows 1.0부터 Mac과 같은 형식을 썼다.

```mermaid
flowchart LR
    subgraph FOLDER["저장 폴더 (기본 위치 또는 공유 폴더)"]
        direction TB
        T["todos.json<br/>할 일 (선택 항목: timeStart, timeEnd, todaySince)"]
        ME["memos.json<br/>메모"]
        R["repeats.json<br/>반복 할 일"]
        E["events.json<br/>자체 일정"]
        A["alarms.json<br/>알람"]
        F["focus.jsonl<br/>집중 기록, 한 줄에 하나"]
        AR["archive/YYYY-MM.jsonl<br/>완료 기록, 달마다"]
    end
    subgraph DEVICE["기기마다 따로"]
        S["설정<br/>Mac: UserDefaults, Windows: settings.json"]
        H["울린 알람, 띄운 알림 기록"]
        B["backups/<br/>가져오기 전 자동 보관 (최근 10개)"]
    end
    X[".jongi 백업 파일<br/>저장 폴더의 파일을 하나로"]
    FOLDER -->|내보내기| X
    X -->|합치기 / 바꾸기| FOLDER
    FOLDER -.가져오기 전.-> B
```

| | macOS | Windows |
| --- | --- | --- |
| 기본 폴더 | `~/Library/Application Support/com.noa.PaperTodo/` | `%APPDATA%\PaperTodo\` |
| 저장 방식 | 임시 파일에 다 쓴 뒤 바꿔 끼우기(`.atomic`) | 같은 방식(`writeFileAtomically`) |
| 읽을 수 없는 파일 | 덮어쓰지 않고 따로 보관 | 같음 |
| 새 필드 | 선택 항목으로만 더한다. 옛 버전은 모르는 항목을 무시하고 연다. | 같음 |

새 필드는 선택 항목으로만 더한다. 그래서 공유 폴더에서 한 기기만 새 버전이어도 다른 기기의 옛 버전이 같은 파일을 연다. 1.39/1.24의 `timeStart`, `timeEnd`가 그렇게 들어갔고, 알람의 '다시 울림 없음'은 `snooze: 0`으로 저장해 옛 버전에서는 10분으로 읽힌다.

## 공유 폴더로 함께 쓰기

iCloud Drive, OneDrive, Dropbox 폴더를 저장 위치로 고르면 그 폴더를 고른 Mac과 Windows PC가 같은 목록을 쓴다. 동기화는 클라우드 앱이 하고, 종이냥은 다른 기기가 쓴 파일을 받아들이는 일만 한다.

```mermaid
sequenceDiagram
    participant Mac as 종이냥 (Mac)
    participant Folder as 공유 폴더 (클라우드)
    participant PC as 종이냥 (Windows)

    PC->>Folder: todos.json 저장 (임시 파일 → 바꿔 끼우기)
    Note over Mac: 2초마다 확인
    Mac->>Folder: 바뀌었나? 읽기
    Mac->>Mac: 고치기 직전에 먼저 읽고, 그 위에 바꾸기
    Mac->>Folder: 저장
    Note over PC: 폴더 감시(fs.watch) + 30초마다 확인<br/>(크기와 시각을 먼저 보고 바뀐 것만 읽기)
    PC->>Folder: 읽기
    Note over Mac,PC: 같은 메모를 양쪽에서 고치면<br/>마지막으로 함께 본 글을 기준으로 줄, 글자 단위 3-way 합치기<br/>(한글 조합 중에는 다음 글자까지 기다림)
```

- 할 일, 반복, 일정, 알람: 저장하기 직전에 다른 기기의 파일을 먼저 읽고 그 위에 바꾼다. 두 기기에서 거의 동시에 고쳐도 양쪽 변경이 남는다.
- 메모: 마지막으로 함께 본 글을 기준으로 줄 단위로 합친다. 한 줄을 양쪽에서 고쳤으면 글자 단위로 합치고, 같은 자리에 서로 다른 글을 썼으면 둘 다 남긴다(`TextMerge.swift`, `textMerge.ts`). 한글을 조합하는 중이면 조합이 끝날 때까지 기다렸다가 합친다.
- 알림과 알람: 목록은 함께 쓰고, 울리는 건 기기마다 따로 기억한다. 다른 기기가 10분 넘게 전에 띄운 할 일 알림은 늦게 켠 기기에서 다시 띄우지 않는다.
- 완료 기록: 달마다 파일 하나에 한 줄씩 덧붙이는 형식이라, 폴더를 옮기거나 합쳐도 같은 항목은 한 번만 남는다.

Windows가 공유 폴더를 확인할 때마다 파일을 통째로 읽던 것은 1.24에서 고쳤다. 쉬는 동안 분당 10번 읽던 것이 0번이 됐다.

## 저장소 구성

```text
jongi-nyang-app/
├─ mac/                  macOS 앱 (Swift Package, 외부 의존성 없음)
│  ├─ Sources/PaperCore/   코어 로직
│  ├─ Sources/PaperTodo/   앱, 리소스(글꼴, 고양이 그림, 종이 질감)
│  ├─ Tests/               코어 시험, 화면 상태, 디자인 스냅숏
│  ├─ Resources/           Info.plist, ko/en/nl 문자열표, 원본 글꼴
│  ├─ scripts/             빌드, 시험, 대비, 번역 검사, 성능 측정, DMG
│  └─ art/                 고양이 그림 프롬프트와 검사 기록
├─ windows/              Windows 앱 (Electron + TypeScript)
│  ├─ src/core, main, renderer, i18n
│  ├─ test/                node:test 시험 (464개)
│  ├─ tools/               빌드, 스냅숏과 크기 훑기, 성능 측정, 아이콘
│  └─ assets/              글꼴, 고양이 그림, 알림 영역과 작업 표시줄 아이콘
├─ docs/                 이 문서들과 골라 둔 화면(screenshots/)
├─ portfolio/            포트폴리오용 요약, 숫자, 질문과 답
└─ site/                 GitHub Pages 소개 페이지
```
