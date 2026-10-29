# 숫자 모음

포트폴리오, 이력서, 면접에 쓰는 숫자와 그 출처다. 성능 숫자는 내 Mac 한 대에서 같은 도구와 같은 시험 데이터(할 일 150개, 일정 60개, 완료 기록 2,000줄, 메모 80개)로 쟀다. Windows 숫자도 macOS 위 Electron에서 잰 값이고, 실제 Windows PC에서 잰 숫자는 없다.

## 제품

| 항목 | 값 | 출처 |
| --- | --- | --- |
| 출시 버전 | Mac 1.0 → 1.44.0, Windows 1.0 → 1.29.0 | [CHANGELOG.md](../CHANGELOG.md) |
| 지원 언어 | 한국어, 영어, 네덜란드어 | Mac 1.32.0, Windows 1.17.0 |
| 번역 문구 | Mac 문자열표 약 1,100개(1.32 당시 679개), Windows 키 약 1,200개(1.17 당시 약 700개) | `mac/Resources/*.lproj`, `windows/src/i18n/` |
| 플랫폼 | macOS 14 이상 (Apple Silicon 빌드), Windows 10/11 x64 | `mac/Package.swift`, `windows/package.json` |
| 외부 런타임 의존성 | Mac 0개, Windows는 Electron 1개 | `mac/Package.swift`, `windows/package.json` |
| Claude 확장 도구 | 11개 (보기 6, 넣기 3, 고치기 전 미리 보기 1, 확인 뒤 고치기 1) | `windows/mcp/manifest.json` |

## 코드와 시험

| 항목 | 값 | 출처 |
| --- | --- | --- |
| Swift 코어 / 앱 / 시험 | 39개 파일 약 9,700줄 / 77개 파일 약 27,000줄 / 약 7,600줄 | `mac/Sources`, `mac/Tests` (`wc -l`) |
| TypeScript 코어 / main / renderer | 47개 파일 약 9,600줄 / 약 10,000줄 / 약 9,500줄, CSS 2,600줄 | `windows/src` |
| Claude 확장 (TypeScript) | 약 1,000줄, 시험 약 400줄 | `windows/mcp` |
| Windows 시험 | 534개 (37개 파일, 약 5,800줄), Claude 확장 16개 | `cd windows && npm test`, `npm run mcp:test` |
| Mac 시험 | 스크립트 17개, 검사 약 360개 | `mac/scripts/test*.sh` 출력 합계 |
| 공유 입력 줄 사례 | 136줄 (1–66, 101–118, 201–228, 301–324) | `windows/test/intent.test.ts`, `mac/Tests/PaperCoreTests/IntentTests.swift` |
| 공유 하루 띠 사례 | R1–R14, K1–K8, G1–G4, N1–N5, T1–T4 | `DayStripTests.swift`, `dayStrip.test.ts` |
| 공유 일정표 끌기 · 늘리기 사례 | R1–R8, W3 | `DayStripTests.swift`, `dayStrip.test.ts` |
| 공유 앞으로 탭 사례 | 45줄, 옮김 12줄, 빈 화면 3줄 | `AheadTests.swift`, `ahead.test.ts` |
| 공유 집중 사례 | F1–F17, FB1–FB4 | `FocusTests.swift`, `focus.test.ts` |
| 공유 메모 서랍 사례 | D1–D29 (폴더 파일, 합치기, 체크 줄, 검색, 정렬, 메모의 종이, 모르는 항목, 날짜 묶음, 종류 표시) | `MemoDrawerTests.swift`, `memoDrawer.test.ts`, `memoCards.test.ts` |
| 공유 AI 연결 사례 | 18줄 (읽기, 넣기, 미리 보기와 확인, 되돌리기, 기록) | `AIConnectTests.swift`, `ai.test.ts`, `mcp/test/server.test.ts` |
| Mac 화면 스냅숏 | 약 1,900장 (3개 언어, 낮/밤) | `mac/scripts/render-design.sh` |
| 대비 검사 | 노트 낮/밤 61쌍, 메모 서랍 네 종이 218쌍, 모두 WCAG AA | `mac/scripts/check-contrast.py`, `windows/test/contrast.test.ts`, `drawerContrast.test.ts` |

## 성능: macOS 1.38 → 1.39

| 항목 | 1.38 | 1.39 | 출처 |
| --- | --- | --- | --- |
| 노트를 열어 두고 쉴 때 CPU | 61% | 0.7% | `mac/CHANGELOG.md` 1.39.0 |
| 노트가 가려지거나 닫혀 있을 때 CPU | 87% | 0.3% | 같음 |
| 입력 줄 글자 하나 | 0.46초 | 0.01초 | 같음 |
| 탭 바꾸기 | 몇 초 | 0.13초 | 같음 |
| 검색 열기 | 2.0초 | 0.2초 | 같음 |
| 켜서 노트가 보일 때까지 | 2.7초 | 1.0초 | 같음 |
| 10분 쓴 뒤 메모리 | 213MB | 136MB | 같음 |

원인과 고친 방법은 [문제 해결 기록 1번](troubleshooting.md)에 있다.

## 성능: Windows

| 항목 | 전 | 후 | 출처 |
| --- | --- | --- | --- |
| 노트를 띄워 두고 쉴 때 CPU | 5.7% (1.23) | 1.5% (1.24) | `windows/CHANGELOG.md` 1.24.0 |
| 같은 날 다시 잰 쉴 때 CPU | 1.17% (1.24) | 0.22% (1.25) | 1.25.0 |
| 노트를 숨겼을 때 CPU | 0.18% (1.24) | 0.07% (1.25) | 1.25.0 |
| 알람이 울린 뒤 CPU | 9.2% (1.23) | 0.5% (1.24) | 1.24.0 |
| 타이머가 돌 때 CPU | 4.95% (1.24, 같은 날) | 1.91% (1.25) | 1.25.0 |
| 쉬는 동안 파일 통째 읽기 | 분당 10번 | 0번 | 1.24.0 |
| 10분 쓴 뒤 메모리 | 692MB | 457MB | 1.24.0 |
| 앞으로 탭으로 넘어가기 | 86ms | 53ms | 1.24.0 |
| 체크 → 애니메이션 | 27ms | 20ms | 1.24.0 |
| 펫이 나와 있을 때 CPU | 약 4–7% | 그대로 | 1.24.0 |

## 끌기: 하루 일정표 (Mac 1.40 → 1.41.0, Windows 1.25 → 1.26.0)

| 항목 | 전 | 후 | 출처 |
| --- | --- | --- | --- |
| Mac 옮기기, 포인터와 최대 차이 | 51.5pt | 0.20pt (118틱) | [`docs/postmortem-timetable-drag.md`](../docs/postmortem-timetable-drag.md), `mac/scripts/drag-check.sh` |
| Mac 옛 계산 재현: 블록 위치가 바뀐 횟수 / 반대로 간 횟수 | 114 / 61 (118틱) | 반대로 0 | `mac/scripts/drag-sim-1.40.py` |
| Mac 위 · 아래 끝 늘리기 | — | 0.00pt (30틱, 60틱) | `drag-check.sh` |
| Windows 옮기기, 포인터와 최대 차이 | 6px | 0px (225프레임) | `windows/tools/drag-probe.mjs` |
| Windows 포인터와 1px 안에 있던 프레임 | 216개 중 38 | 225개 중 225 | 같음 |
| Windows 위 · 아래 끝 늘리기 | — | 0px (75프레임, 180프레임) | 같음 |
| 끄는 동안 다른 블록 다시 그리기 | Mac은 한 칸마다 일정표 전체 | 0번 | 수정 기록 |
| 자동 스크롤 중 따라가기 | 없음 (Windows) | Mac 236.7pt, Windows 271px 동안 따라감 | 수정 기록 |

원인과 고친 방법은 [문제 해결 기록 4번](troubleshooting.md#4-하루-일정표-블록이-떨림-mac-140--1410-windows-125--1260)에 있다.

## 메모 서랍과 Claude 연결 (Mac 1.42–1.44, Windows 1.27–1.29)

| 항목 | 값 | 출처 |
| --- | --- | --- |
| Mac 서랍 처음 열기 / 다시 열기 | 0.11–0.13초 / 0.03초 (메모 200장도 같음) | `mac/CHANGELOG.md` 1.43.0 |
| Mac 서랍을 열어 두고 쉴 때 CPU | 0.52–0.65% (1.43), 불투명 0.41–0.50% · 반투명 0.41–0.46% (1.44) | 1.43.0, 1.44.0 |
| Windows 서랍 처음 열기 | 186ms → 137ms | `windows/CHANGELOG.md` 1.29.0 |
| Windows 서랍 다시 열기 | 17ms → 3ms | 1.29.0 |
| Windows 서랍을 열어 두고 쉴 때 CPU | 0.91% → 0.22% (반투명 0.04–0.09%) | 1.29.0 |
| Windows 서랍을 닫고 손잡이만 | 0.34% → 0.06% | 1.29.0 |
| Mac AI 연결을 켜도 쉴 때 CPU | 노트를 띄워 둔 채 0.59–0.93% → 0.47–0.63% (끔 → 켬, 같은 수준) | `mac/CHANGELOG.md` 1.42.0 |
| 동시에 넣기 | 앱 20개 · Claude 20개를 동시에 넣어 잃은 것 0 | 1.42.0 |

숫자는 모두 내 Mac 한 대에서 시험용 사본과 예시 데이터로 잰 값이다. Windows의 반투명 바탕은 macOS 위 Electron에서만 확인했다.

## 그 전의 성능 작업: macOS

| 항목 | 값 | 출처 |
| --- | --- | --- |
| 알림 말풍선이 떠 있는 동안 CPU | 19–22% → 0% | `mac/CHANGELOG.md` 1.11.1 |
| 글꼴 조회 2만 회 | 283ms → 약 10ms | 1.11.1 |
| 펫이 쉬는 동안 CPU (60초 평균) | 0.78% | 1.14 |
| 숨 쉬는 펫 CPU (60초 평균) | 0.75% | 1.15 |

## 접근성: 대비 (WCAG AA)

| 색 | 전 → 후 | 대비 | 출처 |
| --- | --- | --- | --- |
| 낮 옅은 먹 | #a5a195 → #726e64 | 2.45 → 4.83 | Windows 1.22.0, Mac 1.37.0 |
| 낮 점토 글씨 | → #955842 | 3.97 → 5.32 | 같음 |
| 낮 세이지 글씨 | → #546f52 | 3.93 → 4.57 | 같음 |
| 밤 옅은 먹 | #8a8577 → #9f9989 | 3.96 → 5.13 | Windows 1.21.0, Mac 1.36.0 |
| 밤 체크 칸 테두리 | #77725f → #837e69 | 3.02 → 3.58 | 같음 |
| 밤 서랍: 쪽지와 서랍 종이의 차이 (장식) | #36332e / #2e2c28 → #3b3832 / #262420 | 1.11 → 1.33 | Mac 1.43.1, Windows 1.28.1 |
| 밤 서랍: 시간과 빈칸 안내 글자 | #a39d90 → #bfb8a8 | 4.53 → 5.92 | 같음 |
| 메모지 위 시간 · 안내 글자 (네 종이) | 낮 4.98 → 6.16, 모눈 4.91 → 6.14, 크라프트 5.17 → 8.58 | 6:1 이상 | Mac 1.44.0, Windows 1.29.0 |
