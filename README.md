<div align="center">

# 종이냥

**종이 한 장에 정리하는 오늘의 할 일과 일정**

할 일, 일정, 메모, 집중 타이머를 한곳에서 관리하는 macOS · Windows 데스크톱 앱입니다.
종이 질감의 노트와 화면 아래의 고양이가 일상에 작은 여유를 더합니다.

**한국어** · [English](README.en.md)

[![CI](https://github.com/leeahwi/jongi-nyang-app/actions/workflows/ci.yml/badge.svg)](https://github.com/leeahwi/jongi-nyang-app/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-5c7a5a)](LICENSE)
![macOS 14+](https://img.shields.io/badge/macOS-14%2B-2f2e2a)
![Windows 10/11](https://img.shields.io/badge/Windows-10%20%2F%2011-2f2e2a)

[macOS 다운로드](https://github.com/leeahwi/jongi-nyang-app/releases/tag/mac-v1.40.1) · [Windows 다운로드](https://github.com/leeahwi/jongi-nyang-app/releases/tag/windows-v1.25.1) · [소개 페이지](https://leeahwi.github.io/jongi-nyang-app/)

</div>

![종이냥의 macOS 밝은 테마, 어두운 테마와 Windows 화면](docs/screenshots/hero-ko.png)

[주요 기능](#주요-기능) · [설치](#설치) · [개발](#개발) · [문서](#문서)

## 소개

종이냥은 여러 앱에 흩어진 할 일과 일정을 작은 노트 하나에서 확인하기 위해 만든 개인 프로젝트입니다. 필요할 때 펼쳐 쓰는 포스트잇을 바탕으로, 빠른 입력부터 하루 일정 확인과 집중까지 하나의 흐름으로 연결했습니다.

계정 없이 사용할 수 있으며, 데이터는 사용자가 선택한 폴더에 파일로 저장합니다. macOS와 Windows 앱은 각 플랫폼에 맞게 별도로 구현하고, 같은 데이터 형식과 공유 테스트 사례로 동작의 일관성을 확인합니다.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 할 일과 메모 | 오늘 · 앞으로 · 메모 탭에서 할 일을 분류하고, 마감과 반복을 설정합니다. 통합 검색은 한글 초성 검색도 지원합니다. |
| 자연어 입력 | 한 줄에서 할 일, 일정, 타이머, 알람을 등록합니다. 입력 중 표시되는 칩으로 해석 결과를 확인하고 `Tab`으로 다른 후보를 선택합니다. |
| 하루 일정 | 상단의 ‘하루 띠’에서 현재 일정과 다음 일정을 확인합니다. 펼친 일정표에서는 블록을 드래그해 시간을 15분 단위로 조정합니다. |
| 집중 모드 | 선택한 할 일과 남은 시간을 집중 카드로 표시합니다. 일반 타이머와 뽀모도로, 집중 기록을 지원합니다. |
| 알림과 고양이 | 할 일·일정 알림과 알람을 제공하며, 화면 아래의 고양이가 완료를 축하하거나 휴식을 제안합니다. |
| 테마와 언어 | 밝은 테마와 어두운 테마, 손글씨와 기본 글꼴을 제공합니다. 한국어·영어·네덜란드어를 지원합니다. |

### 입력 예시

노트 하단의 입력 줄이나 전역 단축키로 여는 빠른 입력 창에서 사용할 수 있습니다.

| 입력 | 동작 |
| --- | --- |
| `내일 3시 회의` | 내일 오후 3시 일정 등록 |
| `금요일까지 보고서` | 금요일 마감의 할 일 등록 |
| `타이머 40` | 40분 타이머 시작 |
| `알람 7시 평일` | 평일 오전 7시 알람 등록 |

단축키와 세부 사용법은 [macOS 사용 안내](mac/README.md)와 [Windows 사용 안내](windows/README.md)를 참고하세요.

### 화면 미리보기

| 자연어 입력 · macOS | 하루 일정표 · macOS |
| --- | --- |
| ![자연어 입력의 일정 해석 결과](docs/screenshots/mac/line-event.png) | ![시간별 일정과 할 일을 표시한 하루 일정표](docs/screenshots/mac/day-open.png) |

| 집중 모드 · macOS | 하루 일정표 · Windows |
| --- | --- |
| ![할 일과 남은 시간을 표시한 집중 카드](docs/screenshots/mac/focus-running.png) | ![Windows의 하루 일정표](docs/screenshots/windows/strip-day.png) |

더 많은 화면은 [스크린샷 모음](docs/screenshots)에서 확인할 수 있습니다. 이미지는 실제 앱에 예시 데이터를 넣어 렌더링했습니다.

## 설치

| 플랫폼 | 요구 사항 | 다운로드 |
| --- | --- | --- |
| macOS | macOS 14 이상 · Apple Silicon | [v1.40.1 · DMG](https://github.com/leeahwi/jongi-nyang-app/releases/tag/mac-v1.40.1) |
| Windows | Windows 10/11 · x64 | [v1.25.1 · 설치 파일 및 ZIP](https://github.com/leeahwi/jongi-nyang-app/releases/tag/windows-v1.25.1) |

Intel Mac은 소스에서 빌드해야 합니다. 버전별 변경 사항은 [릴리스 목록](https://github.com/leeahwi/jongi-nyang-app/releases)에서 확인할 수 있습니다.

**처음 실행할 때:** macOS 배포본은 Developer ID 서명과 공증을 받지 않았으며, Windows 배포본에는 코드 서명이 없습니다. macOS에서 실행이 차단되면 **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**, Windows에서 SmartScreen이 표시되면 **추가 정보 → 실행**을 선택합니다.

### 데이터 저장과 백업

- **로컬 저장:** 별도 계정이나 자체 서버 없이 JSON 등의 파일로 데이터를 보관합니다.
- **기기 간 공유:** iCloud Drive, OneDrive, Dropbox 등의 동기화 폴더를 저장 위치로 선택하면 macOS와 Windows에서 같은 데이터를 사용할 수 있습니다. 파일 전달은 해당 클라우드 서비스가 담당합니다.
- **백업과 이전:** 할 일, 메모, 일정, 알람, 완료·집중 기록을 `.jongi` 파일로 내보내고 다른 기기에서 가져올 수 있습니다.

저장 위치는 앱의 **책상 → 저장과 백업**에서 변경합니다. 공유 폴더의 동시 편집 처리 방식은 [아키텍처 문서](docs/architecture.md)에 정리되어 있습니다.

### 알려진 제약

- Windows 앱은 macOS 환경의 Electron에서 검증했습니다. 실제 Windows PC의 설치 과정, 알림 영역 동작, AltGr 키보드 입력은 아직 검증하지 못했습니다.
- 영어와 네덜란드어 번역은 AI 초안을 바탕으로 작성했으며, 원어민 검토 전입니다.
- 공유 폴더를 사용하는 경우 알림과 알람은 실행 중인 각 기기에서 울립니다.

## 개발

### 기술 구성

| 구분 | macOS | Windows |
| --- | --- | --- |
| 언어·프레임워크 | Swift 6 · SwiftUI · AppKit | TypeScript · Electron |
| 핵심 로직 | `mac/Sources/PaperCore` | `windows/src/core` |
| UI 구현 | Apple 시스템 프레임워크 | HTML · CSS · TypeScript, 별도 UI 라이브러리 없음 |
| 테스트 | Swift 테스트 스크립트 | Node.js 내장 테스트 러너 (`node:test`) |

두 앱은 소스 코드를 공유하지 않습니다. 대신 자연어 입력, 일정 표시, 백업 등의 입력과 기대 결과를 공유 테스트 사례로 관리합니다. 렌더링 검증과 성능 측정 방식은 [엔지니어링 문서](docs/engineering.md)를 참고하세요.

### 로컬 실행

저장소를 복제한 뒤 사용할 플랫폼의 디렉터리에서 실행합니다.

```sh
git clone https://github.com/leeahwi/jongi-nyang-app.git
cd jongi-nyang-app
```

**macOS** — macOS 14 이상과 Swift 6 도구 체인(Xcode 또는 Command Line Tools)이 필요합니다.

```sh
cd mac
./scripts/run.sh  # 앱 번들을 빌드하고 실행: dist/종이냥.app
```

코어 테스트는 `TZ=Asia/Seoul ./scripts/test.sh`로 실행합니다. 기능별 추가 검증 스크립트는 [엔지니어링 문서](docs/engineering.md)를 참고하세요.

**Windows** — Node.js 22 이상이 필요합니다.

```sh
cd windows
npm ci
npm start         # 개발 실행
```

타입 검사와 테스트는 아래 명령으로 실행합니다. 일부 테스트가 `Asia/Seoul` 시간대를 전제로 하므로 먼저 시간대를 설정합니다.

```powershell
# Windows PowerShell
$env:TZ = "Asia/Seoul"
npm run typecheck
npm test
npm run dist      # Windows x64 설치 파일과 ZIP 생성: dist/
```

macOS 등 POSIX 셸에서는 `TZ=Asia/Seoul npm test`를 사용합니다. CI 역시 이 시간대를 사용하며, 현재 자동화 범위는 macOS 러너에서 실행하는 Windows 앱의 타입 검사와 테스트입니다.

### 저장소 구조

```text
mac/         macOS 앱, 핵심 로직, 테스트와 빌드 스크립트
windows/     Windows 앱, 핵심 로직, 테스트와 빌드 도구
docs/        아키텍처, 엔지니어링, 디자인, 의사결정 기록과 스크린샷
portfolio/   프로젝트 요약, 문제 해결 사례와 개발 회고
site/        GitHub Pages 소개 페이지
```

## 문서

| 문서 | 내용 |
| --- | --- |
| [아키텍처](docs/architecture.md) | UI와 핵심 로직의 경계, 데이터 형식, 동시 편집 처리 |
| [엔지니어링](docs/engineering.md) | 공유 테스트 사례, 렌더링·번역·대비 검사, 성능 개선 기록 |
| [디자인 과정](docs/design-process.md) | 화면 구성, 테마와 컴포넌트 설계, 디자인 반복 과정 |
| [의사결정 기록](docs/decisions.md) | 파일 기반 저장, 플랫폼별 구현, Google 연동 제거 등의 배경 |
| [변경 기록](CHANGELOG.md) | 주요 버전별 변경 사항 |
| [프로젝트 요약](portfolio/one-pager-ko.md) · [문제 해결 사례](portfolio/troubleshooting.md) | 프로젝트 개요와 구현 중 해결한 문제 |

### AI 활용

기획, 기능 우선순위, 디자인 선택과 실사용 검토는 제작자가 담당했습니다. 코드·테스트·측정 스크립트·번역 초안에는 Claude Code를, 고양이와 종이 질감 제작에는 이미지 생성 도구를 활용했습니다. 구체적인 역할 분담과 검토 과정은 [AI 협업 기록](portfolio/ai-collaboration.md)에 정리했습니다.

## 라이선스

소스 코드는 [Apache License 2.0](LICENSE)으로 배포합니다. © 2026 leeAhwi.

포함된 글꼴은 SIL Open Font License 1.1을 따릅니다. 글꼴, 이미지 및 배포 파일에 포함된 구성 요소의 라이선스는 [NOTICE](NOTICE)를 참고하세요.
