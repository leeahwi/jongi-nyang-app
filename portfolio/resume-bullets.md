# 이력서용 문장

한 줄에 하나씩, 무엇을 했고 어떻게 했고 결과가 어땠는지. 숫자는 [숫자 모음](metrics.md)과 같다.

## 한국어

- 같은 할 일 앱을 macOS(SwiftUI)와 Windows(Electron)로 따로 만들고, 기능마다 사례 표를 먼저 써서 두 앱의 시험이 같은 기대 문자열을 통과하게 함 (입력 줄 사례 136줄, 메모 서랍 사례 D1–D30, Windows 시험 582개). 할 일 스페이스부터는 사례 표를 JSON 파일 하나(S1–S22)로 두고 두 앱의 시험이 같이 읽게 함
- 같은 데이터로 프로세스 하나만 재는 측정 스크립트를 만들어 쉴 때 CPU 원인(하루 띠 깜빡임이 노트 전체를 매 프레임 다시 그림)을 찾고, Mac 61% → 0.7%, 입력 지연 0.46초 → 0.01초, 시작 2.7초 → 1.0초로 줄임
- Electron 앱에서 숨긴 창의 애니메이션, 모든 창에 보내던 상태, 공유 폴더 파일 통째 읽기를 걷어내 쉴 때 CPU 5.7% → 1.5%, 10분 뒤 메모리 692MB → 457MB로 줄임
- 앱을 쓰다가 집중 카드의 ×를 누르면 앱 전체가 클릭을 받지 않는 버그를 발견. 원인을 추적해(프로세스 샘플링, 창 목록) 0×0 모달 창을 찾고, 쪽지를 띄우는 공통 코드를 고쳐 1.40.1로 배포
- 하루 일정표에서 끄는 블록이 떨리는 문제를 쓰다가 발견. 끌기를 움직이는 블록 기준으로 재서 생긴 되먹임(Mac)과 15분 칸 단위 그리기(Windows)를 찾아 일정표 기준 측정으로 바꾸고, 틱마다 위치를 기록하는 도구로 포인터와의 차이를 51.5pt → 0.20pt(Mac), 6px → 0px(Windows)로 확인
- 실제 화면을 3개 언어와 낮/밤으로 약 2,100장 자동으로 그리고, Windows 창을 크기, 배율, 글꼴별로 훑어 잘림과 겹침을 시험 실패로 만듦. 노트 111쌍과 메모 서랍 234쌍의 WCAG AA 대비 검사를 넣음
- 서버 없이 JSON 파일과 사용자의 클라우드 폴더로 Mac과 Windows가 한 목록을 쓰게 하고, 동시 편집은 저장 직전 다시 읽기와 메모 3-way 합치기로 처리
- 다섯 판에 걸쳐 만든 Google 캘린더/Tasks 연동(OAuth loopback + PKCE)을 설정 부담과 "서버 없음" 원칙 때문에 빼고, 앱 안의 일정과 `.jongi` 백업 파일로 대체
- Claude 데스크톱 · Claude Code용 MCP 확장(도구 11개)을 만들어 대화로 할 일 · 일정 · 메모를 보고 넣게 함. 기본 꺼짐, 고치기 전 미리 보기와 확인, 앱에서 한 번에 되돌리기, 앱과 확장이 같은 파일을 동시에 쓰지 않게 잠금. 앱 20개 · Claude 20개를 동시에 넣어 하나도 잃지 않음을 확인
- 메모 탭을 화면 끝 메모 서랍으로 옮기면서 폴더 정보를 새 파일에 두고 모르는 항목은 그대로 남기게 해, 옛 버전과 같은 공유 폴더를 써도 메모를 잃지 않게 함. 써 보며 날짜 묶음, 종류 표시, 우클릭 메뉴로 다듬고 Windows 서랍 다시 열기를 17ms → 3ms로 줄임

- 할 일 2,000개에서 빈 입력 줄의 첫 글자와 Esc가 몇 초씩 멈추던 문제를 많은 데이터로 재다가 찾음. 목록 높이 어림값이 그릴 때마다 바뀌어 다시 그리기를 500–900번 되풀이하던 것을 끊어 첫 글자 5.7–8.8초 → 25–58ms, Esc 10–14초 → 22–41ms로 줄임
- 메모 서랍을 메모 2,000 · 5,000장과 1MB 메모로 재는 도구와 보고서를 먼저 쓰고, 한 글자마다 모델이 네 번 바뀌던 것을 손을 멈출 때 한 번으로 바꿔 Mac 한 글자 694ms → 9ms(2,000장), 한글 조합 중 한 타 286ms → 4ms로 줄임
- 할 일 스페이스를 넣으면서 옛 버전이 모르는 칸을 지우는 것을 시험으로 확인하고, 할 일 파일은 그대로 둔 채 새 파일에 자리를 두어 옛 버전과 같은 공유 폴더를 써도 스페이스를 잃지 않게 함
- 실제 Windows PC 없이, 클릭을 흘리는 알림 쪽지가 체크를 못 받던 버그를 진짜 창을 화면 밖에 띄우는 Electron 도구로 11가지 경우에서 재현하고 고침(실제 PC 확인은 남김)
- UI/UX 점검 두 번과 문구 점검으로 이슈 38개를 모으고, 글쓰기 가이드와 용어표를 만들어 두 앱 · 세 언어의 메뉴, 버튼, 오류, 확인 쪽지의 말을 맞춤

짧은 판 (이력서 프로젝트 칸):

> 종이냥: macOS(SwiftUI)와 Windows(Electron)용 할 일 앱, 1인 개발(AI 페어 프로그래밍). Mac 1.45.0, Windows 1.30.0 배포.
> 두 앱이 같은 사례 표(입력 줄 136줄)를 통과하게 해 동작을 맞추고, 측정 스크립트로 쉴 때 CPU를 61% → 0.7%(Mac), 5.7% → 1.5%(Windows)로 줄임.
> github.com/leeahwi/jongi-nyang-app

## English

- Built the same to-do app twice, for macOS (SwiftUI) and Windows (Electron), and kept them consistent by writing a case table per feature that both test suites must pass with identical strings (136 input-line cases, notes-drawer cases D1–D30, 582 Windows tests); from to-do spaces on, the case table is one JSON file (S1–S22) that both suites read
- Wrote a measurement script that drives one process with fixed sample data, traced idle CPU to a blinking line that redrew the whole note every frame, and cut Mac idle CPU from 61% to 0.7%, keystroke latency from 0.46 s to 0.01 s and launch time from 2.7 s to 1.0 s
- Stopped hidden-window animations, per-window state broadcasts and whole-file reads in the Electron app, taking idle CPU from 5.7% to 1.5% and memory after ten minutes from 692 MB to 457 MB
- Found, while using the app, that pressing the focus card's × froze all clicks; tracing it (process sampling, window list) turned up a 0×0 modal window, fixed in the shared slip code and shipped in 1.40.1
- Found, while using the app, that dragged blocks in the day timetable jittered; traced it to measuring the drag against the moving block (Mac) and drawing in 15-minute steps (Windows), switched both to timetable-relative measurement, and verified with per-tick logging tools that the gap to the pointer fell from 51.5 pt to 0.20 pt (Mac) and from 6 px to 0 px (Windows)
- Rendered about 2,100 real screens across 3 languages and day/night, swept every Windows window across sizes, scale factors and fonts to fail on clipping and overlap, and added WCAG AA contrast checks over 111 note pairs and 234 notes-drawer pairs
- Let a Mac and a PC share one list with no server, using JSON files in the user's cloud folder, re-read before every save, and three-way merge for memos
- Removed a Google Calendar/Tasks integration (OAuth loopback + PKCE) that had taken five releases, because of its setup burden and the no-server rule, and replaced it with in-app events and a `.jongi` backup file
- Built an MCP extension (11 tools) so Claude Desktop and Claude Code can read and add to-dos, events and notes in a chat; off by default, changes previewed and confirmed first, one-step undo in the app, and a lock so the app and the extension never write the same file at once (20 app + 20 Claude adds in parallel, none lost)
- Moved the Memos tab into a notes drawer with folder data in a separate file that keeps unknown keys, so an older version sharing the same folder can't lose notes; reworked it from daily use with date groups, kind labels and right-click menus, and cut the Windows drawer's reopen time from 17 ms to 3 ms

- Found, by measuring with 2,000 to-dos, that the first key in an empty input line and Esc froze the notepad for seconds: an estimated list height that moved on every layout made the view redraw itself 500–900 times. Broke the loop, taking the first key from 5.7–8.8 s to 25–58 ms and Esc from 10–14 s to 22–41 ms
- Wrote stress tools and a report for the notes drawer at 2,000 and 5,000 notes and with a 1 MB note, then made the drawer hand typed keys to the model once per pause instead of four model changes a key: a Mac keystroke went from 694 ms to 9 ms at 2,000 notes, and a Korean composing keystroke from 286 ms to 4 ms
- Added to-do spaces after confirming in tests that older versions drop unknown keys, so the spaces live in a new file beside an untouched to-do file and survive an older version sharing the same folder
- Without a Windows PC, reproduced a reminder slip that wouldn't take a click (a click-through window that dropped early pointer moves) in 11 cases with an Electron probe that runs the real window off-screen, and fixed it (a real-PC check is still pending)
- Ran two UI/UX audits and a copy audit (38 issues), then wrote a writing guide and a shared glossary so menus, buttons, errors and confirmations read the same in both apps and three languages

Short version (résumé project entry):

> Jongi-nyang: to-do app for macOS (SwiftUI) and Windows (Electron), solo, with AI pair programming. Shipped Mac 1.45.0 and Windows 1.30.0.
> Kept both apps consistent with shared case tables (136 input-line cases); cut idle CPU from 61% to 0.7% on Mac and from 5.7% to 1.5% on Windows using my own measurement scripts.
> github.com/leeahwi/jongi-nyang-app
