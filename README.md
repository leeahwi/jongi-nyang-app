<div align="center">

# 종이냥

**종이 한 장처럼 꺼내 쓰는 할 일 앱. 화면 아래에는 종이 고양이가 앉아 있어요.**

macOS(Swift, SwiftUI)와 Windows(Electron, TypeScript)용으로 따로 만든 데스크톱 앱

**한국어** · [English](README.en.md)

[![CI](https://github.com/leeahwi/jongi-nyang-app/actions/workflows/ci.yml/badge.svg)](https://github.com/leeahwi/jongi-nyang-app/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-5c7a5a)](LICENSE)
![macOS 14+](https://img.shields.io/badge/macOS-14%2B-2f2e2a)
![Windows 10/11](https://img.shields.io/badge/Windows-10%20%2F%2011-2f2e2a)

[**Mac용 내려받기**](https://github.com/leeahwi/jongi-nyang-app/releases/tag/mac-v1.40.1) · [**Windows용 내려받기**](https://github.com/leeahwi/jongi-nyang-app/releases/tag/windows-v1.25.1) · [소개 페이지](https://leeahwi.github.io/jongi-nyang-app/)

</div>

![종이냥: Mac 낮 종이, Mac 밤 종이, Windows](docs/screenshots/hero-ko.png)

이 저장소에서 볼 만한 건 만드는 방식이에요. 같은 앱을 Swift와 TypeScript로 따로 짜고 사례 표(입력 줄만 136줄)로 두 앱의 동작을 맞춘 방법, 쉴 때 CPU 61%의 원인을 재서 찾아 0.7%로 줄인 기록, 디자인 안을 고르고 하루 띠를 세 번 다시 그린 과정이 들어 있어요. 짧게 보려면 [한 장 요약](portfolio/one-pager-ko.md)과 [문제 해결 기록](portfolio/troubleshooting.md)을 보세요.

## 종이냥은

오늘 할 일을 적고 체크하는 노트예요. 맨 아래 입력 줄에 `내일 3시 회의`라고 치면 일정으로, `금요일까지 보고서`는 마감이 있는 할 일로, `타이머 40`과 `알람 7시 평일`은 타이머와 알람으로 알아들어요. 잘못 알아들었으면 `Tab`을 한 번 누르면 돼요.

목록 위의 하루 띠에는 지금 하는 일과 남은 시간, 그다음 일 두 개가 보여요. 띠를 누르면 그 자리에서 하루 일정표가 펼쳐지고, 할 일을 끌어서 15분 단위로 옮길 수 있어요.

종이 고양이는 Dock(Windows에서는 작업 표시줄) 위에 앉아 있어요. 알림이 오면 걸어 들어오고, 할 일을 끝내면 축하하고, 가끔 "5분 쉬어 갈까요?" 같은 질문을 해요.

계정과 서버는 없어요. 데이터는 내 컴퓨터의 JSON 파일에 저장되고, iCloud Drive나 OneDrive, Dropbox 폴더를 저장 위치로 고르면 Mac과 Windows PC가 같은 목록을 써요. 한국어, 영어, 네덜란드어를 지원하고, 시스템이 어두운 모드면 밤 종이로 바뀌어요. 네덜란드어는 벨기에와 네덜란드에 사는 친구들 때문에 넣었어요. 영어와 네덜란드어 문구는 AI가 쓴 초안이고, 아직 원어민 검토를 받지 못했어요.

## 왜 만들었나

일할 때도 집에서도 할 일이 계속 쌓이는데, 편하게 적고 한눈에 볼 수 있는 앱이 없었어요. 할 일 앱은 많지만 써 보면 필요한 기능은 유료였고, 제가 원한 모양도 아니었어요. 저는 평소엔 작은 아이콘으로 붙어 있다가 필요할 때 펼쳐지는 포스트잇을 원했어요. 할 일 말고도 가끔은 타이머나 뽀모도로, 일정을 보는 달력이 필요했고 오늘 일정과 할 일을 한곳에서 보고 싶었어요. 그러려면 앱 두세 개, 많을 땐 네 개를 오가야 했어요.

모양을 종이로 한 건, 다들 화면에 익숙해도 플래너에 할 일을 적고 그렇게 공부하던 경험이 아직 강하다고 봐서예요. 할 일을 종이에 적는 느낌이 나면 관리하는 게 더 손에 잡힐 거라고 생각했어요. 고양이는 딱딱한 디자인은 쉽게 무시하게 되고 금방 지루해져서 넣었어요.

지금은 단축키로 바로 적고, 한곳에서 다 보고, 매일 알림을 받아요. 할 일을 놓치는 일이 줄었고 일정 확인이 훨씬 편해졌어요. 제가 가장 많이 쓰는 건 할 일 넣기이고, 일정도 자주 넣어요. 타이머와 뽀모도로는 저는 잘 안 써서, 앱을 나눠 쓰는 지인 몇 명에게 의견을 받고 있어요.

## 둘러보기

| 입력 줄: 알아들은 뜻을 칩으로 | 하루 띠: 지금과 다음 | 하루 일정표: 끌어서 옮기기 |
| --- | --- | --- |
| ![입력 줄](docs/screenshots/mac/line-event.png) | ![하루 띠](docs/screenshots/mac/strip-now-event.png) | ![하루 일정표](docs/screenshots/mac/day-open.png) |

| 집중 카드 | 앞으로 탭: 다른 날로 끌어 놓기 | 울리는 알람 쪽지 |
| --- | --- | --- |
| ![집중](docs/screenshots/mac/focus-running.png) | ![앞으로](docs/screenshots/mac/ahead-drag.png) | ![알람](docs/screenshots/mac/alarm-ring.png) |

| 책상 창의 달력 | 저녁 정리 | 검색 (초성도 돼요) |
| --- | --- | --- |
| ![책상](docs/screenshots/mac/desk-calendar.png) | ![저녁 정리](docs/screenshots/mac/conv-sweep-evening.png) | ![검색](docs/screenshots/mac/conv-search.png) |

| 종이냥의 질문 | 메뉴 막대의 오늘 창 | Windows의 하루 일정표 |
| --- | --- | --- |
| ![종이냥](docs/screenshots/mac/pet-question-many.png) | ![오늘 창](docs/screenshots/mac/today-window-many.png) | ![Windows](docs/screenshots/windows/strip-day.png) |

다른 화면은 [`docs/screenshots/`](docs/screenshots)에 있어요. 전부 실제 앱에 예시 데이터를 넣고 그린 것이에요.

## 어떻게 만들었나

Mac 앱을 먼저 Swift로 만들었고, Mac 1.12–1.15 무렵에 Windows 이식을 시작했어요. 두 앱은 코드를 나누지 않아요. Mac에서는 메뉴 막대, 투명한 펫 창, Core Animation을 그대로 쓰고 싶었고, Windows에서는 종이 화면을 CSS로 거의 그대로 옮길 수 있는 Electron이 편했어요. 대신 같은 규칙을 Swift와 TypeScript로 두 번 써야 하고, Electron 앱은 메모리를 많이 써요.

두 앱이 같게 동작하는지는 사례 표로 확인해요. 예를 들어 `내일 3시 회의`가 어떤 뜻 후보로 읽히고 칩에 `일정 · 내일(금) 15:00–16:00`이 뜬다는 것까지 한 줄로 적어 두고, Swift 시험과 TypeScript 시험이 그 줄을 같은 문자열로 통과해야 해요. 입력 줄 사례만 136줄이에요. 자세한 방식은 [엔지니어링 문서](docs/engineering.md#1-공유-시험-사례)에 있어요.

| | macOS | Windows |
| --- | --- | --- |
| 기술 | Swift 6, SwiftUI + AppKit, 외부 의존성 없음 | Electron, TypeScript, UI 라이브러리 없음 |
| 화면과 무관한 로직 | `PaperCore` 35개 파일 | `src/core` 44개 파일 |
| 자동 시험 | 시험 스크립트 15개, 검사 약 300개 | `node:test` 464개 |
| 두 앱이 함께 쓰는 사례 | 입력 줄 136줄, 하루 띠 R/K/G/N/T, 집중 F/FB, 앞으로 탭 60줄, 편의 기능, 백업 | 같은 표, 같은 기대 문자열 |

서버 대신 파일을 골랐어요. 데이터는 JSON 파일이고 여러 기기는 사용자의 클라우드 폴더로 나눠요. 계정과 서버 비용이 없는 대신, 두 기기에서 거의 동시에 고친 내용은 앱이 직접 합쳐야 해요(저장 직전에 다시 읽기, 메모는 3-way 합치기). Google 캘린더와 Tasks 연동은 다섯 판에 걸쳐 만들었다가 Mac 1.31.0, Windows 1.16.0에서 뺐어요. 잘 동작했지만, 회사 일정이 개인 노트에 섞여 들어오는 게 싫었어요. 저는 회사 일을 개인 공간에 가져오고 싶지 않고 그 반대도 마찬가지인데, 써 본 사람들도 같은 이야기를 했어요. 쓰려면 사용자가 Google Cloud에서 클라이언트 파일을 직접 만들어야 한다는 문제도 있었어요. 이유는 [결정 기록](docs/decisions.md#adr-2-google-연동을-뺐다)에 적었어요.

화면은 실제로 그려서 확인했어요. Mac은 SwiftUI 뷰를 3개 언어와 낮/밤으로 약 1,500장 그리고, Windows는 창마다 크기와 배율(125%, 150%), 글꼴을 바꿔 가며 잘린 글이나 겹친 요소가 있으면 시험을 실패시켜요. 영어 손글씨에서 'Ahead'의 마지막 글자가 잘려 'Aheaa'로 보인 적이 있어서, 그 뒤로 잉크가 칸 밖에서 잘리는지도 검사해요. 낮과 밤 색에서 글자와 바탕 38쌍이 WCAG AA에 못 미쳐도 실패해요.

성능 문제는 재 보기 전까지 몰랐어요. Mac 1.38에서 노트를 열어 둔 채 가만히 있어도 CPU가 61%, 노트가 가려져 있으면 87%였어요. 하루 띠의 '지금' 선이 깜빡이는 동안 노트 전체를 매 프레임 다시 그리고 있었어요. 깜빡임을 Core Animation에 넘기고 1.39에서 0.7%가 됐어요. 같은 판에서 입력 줄 글자 하나의 지연이 0.46초에서 0.01초로, 켜서 노트가 보일 때까지가 2.7초에서 1.0초로 줄었어요. Windows는 1.24에서 쉴 때 CPU 5.7%를 1.5%로, 10분 뒤 메모리 692MB를 457MB로 줄였어요. 측정 방법과 원인은 [성능 기록](docs/engineering.md#5-성능)에 적었어요.

아직 못 한 것도 있어요. Windows 앱은 macOS 위의 Electron에서만 돌려 봤고, 실제 Windows PC에서 설치하거나 알림 영역, AltGr 키보드를 확인하지 못했어요. 두 앱 모두 코드 서명이 없어요. 시험 일부는 제 시간대(Asia/Seoul)를 전제로 써서, CI도 `TZ=Asia/Seoul`로 돌려요.

| 문서 | 내용 |
| --- | --- |
| [구조](docs/architecture.md) | 코어와 화면의 경계, 데이터 파일, 공유 폴더에서 동시 편집을 합치는 방법 |
| [엔지니어링](docs/engineering.md) | 공유 사례, 스냅숏과 크기 훑기, 번역 검사, 대비 검사, 성능 측정 전후 |
| [디자인 과정](docs/design-process.md) | 제안을 고르는 방식, 새 디자인 네 단계, 쪽지 모달, 하루 띠 세 판 |
| [결정 기록](docs/decisions.md) | 서버 대신 파일, Google 연동을 뺀 이유, Electron, 코드 대신 사례, 새벽 4시 기준 하루 |
| [변경 기록](CHANGELOG.md) | Mac 1.0–1.40, Windows 1.0–1.25를 이정표별로 |

## AI 사용

저는 기획과 기능, 쓰기 편한지와 실제로 쓸모가 있는지에 집중했어요. 구현 방법과 디자인 시안 여러 개는 Claude Code가 제안했고, 그대로 받지 않고 먼저 구현 계획을 미리보기로 만들게 한 뒤 무엇을 넣을지 제가 정했어요. 코드, 시험, 측정 스크립트, 영어와 네덜란드어 번역의 많은 부분은 AI가 초안을 썼어요. 고양이 그림은 이미지 생성 도구로 만들고 제가 골라 다듬었어요. 매일 앱을 쓰면서 필요한 기능을 넣자고 했어요. 할 일에 시간 알림, 언젠가로 넘겼다가 오늘로 다시 가져오기(Mac 1.17), 메모 탭(Mac 1.15) 같은 것들이에요. 쓰다가 찾은 버그도 고치게 했어요. 탭 끝 잘림, 밋밋한 알람 창, 집중 뒤 앱 멈춤, 30분이 29분으로 보이던 것(뒤의 둘은 Mac 1.40.1에서 고침). 나눈 방식은 [AI와 일한 방식](portfolio/ai-collaboration.md)에 적어 두었어요.

## 설치

| | 내려받기 | 처음 열 때 |
| --- | --- | --- |
| macOS 14 이상 (Apple Silicon. Intel Mac은 소스에서 빌드) | [`JongiNyang-1.40.1.dmg`](https://github.com/leeahwi/jongi-nyang-app/releases/tag/mac-v1.40.1) | 서명과 공증이 없는 빌드라 macOS가 막을 수 있어요. 응용 프로그램 폴더에서 **종이냥을 우클릭 → 열기**를 누르거나, **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**를 누르세요. |
| Windows 10/11 (x64) | [`JongiNyang-1.25.1-x64.exe`](https://github.com/leeahwi/jongi-nyang-app/releases/tag/windows-v1.25.1) (설치), `.zip` (설치 없이) | SmartScreen이 뜨면 **추가 정보 → 실행**을 누르세요. |

## 소스에서 빌드하기

```sh
# macOS — Swift 6 (Xcode 또는 Command Line Tools)
cd mac
swift build && ./scripts/test.sh
./scripts/run.sh               # 빌드하고 실행 (dist/종이냥.app)

# Windows — Node.js 22 이상
cd windows
npm ci && npx tsc --noEmit -p . && npm test
npm start                      # 개발 실행
npm run dist                   # 설치 파일 (dist/)
```

앱별 사용법, 단축키, 데이터 위치는 [`mac/README.md`](mac/README.md)와 [`windows/README.md`](windows/README.md)에 있어요.

## 저장소 구성

```text
mac/         macOS 앱. Swift Package (PaperCore 로직 + PaperTodo 앱), 시험, 스크립트
windows/     Windows 앱. Electron (src/core, main, renderer), 시험, 도구
docs/        구조, 엔지니어링, 디자인 과정, 결정 기록, 골라 둔 화면
portfolio/   한 장 요약, 문제 해결 기록, 이력서 문장, 숫자, 면접 질문과 답, 타임라인, AI 사용, 에셋 목록
site/        GitHub Pages 소개 페이지 (한국어, 영어)
```

## 라이선스

소스 코드는 [Apache License 2.0](LICENSE)이에요. © 2026 leeAhwi.
함께 들어 있는 글꼴(Nanum Pen Script, Nanum Brush Script와 이를 고친 HanJang, Caveat, Kalam)은 각자의 SIL Open Font License 1.1을 따라요. 자세한 내용은 [NOTICE](NOTICE)에 있어요.
