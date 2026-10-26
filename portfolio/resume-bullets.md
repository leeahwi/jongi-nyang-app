# 이력서용 문장

한 줄에 하나씩, 무엇을 했고 어떻게 했고 결과가 어땠는지. 숫자는 [숫자 모음](metrics.md)과 같다.

## 한국어

- 같은 할 일 앱을 macOS(SwiftUI)와 Windows(Electron)로 따로 만들고, 기능마다 사례 표를 먼저 써서 두 앱의 시험이 같은 기대 문자열을 통과하게 함 (입력 줄 사례 136줄, Windows 시험 471개)
- 같은 데이터로 프로세스 하나만 재는 측정 스크립트를 만들어 쉴 때 CPU 원인(하루 띠 깜빡임이 노트 전체를 매 프레임 다시 그림)을 찾고, Mac 61% → 0.7%, 입력 지연 0.46초 → 0.01초, 시작 2.7초 → 1.0초로 줄임
- Electron 앱에서 숨긴 창의 애니메이션, 모든 창에 보내던 상태, 공유 폴더 파일 통째 읽기를 걷어내 쉴 때 CPU 5.7% → 1.5%, 10분 뒤 메모리 692MB → 457MB로 줄임
- 앱을 쓰다가 집중 카드의 ×를 누르면 앱 전체가 클릭을 받지 않는 버그를 발견. 원인을 추적해(프로세스 샘플링, 창 목록) 0×0 모달 창을 찾고, 쪽지를 띄우는 공통 코드를 고쳐 1.40.1로 배포
- 하루 일정표에서 끄는 블록이 떨리는 문제를 쓰다가 발견. 끌기를 움직이는 블록 기준으로 재서 생긴 되먹임(Mac)과 15분 칸 단위 그리기(Windows)를 찾아 일정표 기준 측정으로 바꾸고, 틱마다 위치를 기록하는 도구로 포인터와의 차이를 51.5pt → 0.20pt(Mac), 6px → 0px(Windows)로 확인
- 실제 화면을 3개 언어와 낮/밤으로 약 1,500장 자동으로 그리고, Windows 창을 크기, 배율, 글꼴별로 훑어 잘림과 겹침을 시험 실패로 만듦. 글자/바탕 38쌍의 WCAG AA 대비 검사를 CI에 넣음
- 서버 없이 JSON 파일과 사용자의 클라우드 폴더로 Mac과 Windows가 한 목록을 쓰게 하고, 동시 편집은 저장 직전 다시 읽기와 메모 3-way 합치기로 처리
- 다섯 판에 걸쳐 만든 Google 캘린더/Tasks 연동(OAuth loopback + PKCE)을 설정 부담과 "서버 없음" 원칙 때문에 빼고, 앱 안의 일정과 `.jongi` 백업 파일로 대체

짧은 판 (이력서 프로젝트 칸):

> 종이냥: macOS(SwiftUI)와 Windows(Electron)용 할 일 앱, 1인 개발(AI 페어 프로그래밍). Mac 1.41.0, Windows 1.26.0 배포.
> 두 앱이 같은 사례 표(입력 줄 136줄)를 통과하게 해 동작을 맞추고, 측정 스크립트로 쉴 때 CPU를 61% → 0.7%(Mac), 5.7% → 1.5%(Windows)로 줄임.
> github.com/leeahwi/jongi-nyang-app

## English

- Built the same to-do app twice, for macOS (SwiftUI) and Windows (Electron), and kept them consistent by writing a case table per feature that both test suites must pass with identical strings (136 input-line cases, 471 Windows tests)
- Wrote a measurement script that drives one process with fixed sample data, traced idle CPU to a blinking line that redrew the whole note every frame, and cut Mac idle CPU from 61% to 0.7%, keystroke latency from 0.46 s to 0.01 s and launch time from 2.7 s to 1.0 s
- Stopped hidden-window animations, per-window state broadcasts and whole-file reads in the Electron app, taking idle CPU from 5.7% to 1.5% and memory after ten minutes from 692 MB to 457 MB
- Found, while using the app, that pressing the focus card's × froze all clicks; tracing it (process sampling, window list) turned up a 0×0 modal window, fixed in the shared slip code and shipped in 1.40.1
- Found, while using the app, that dragged blocks in the day timetable jittered; traced it to measuring the drag against the moving block (Mac) and drawing in 15-minute steps (Windows), switched both to timetable-relative measurement, and verified with per-tick logging tools that the gap to the pointer fell from 51.5 pt to 0.20 pt (Mac) and from 6 px to 0 px (Windows)
- Rendered about 1,500 real screens across 3 languages and day/night, swept every Windows window across sizes, scale factors and fonts to fail on clipping and overlap, and added a WCAG AA contrast check over 38 color pairs to CI
- Let a Mac and a PC share one list with no server, using JSON files in the user's cloud folder, re-read before every save, and three-way merge for memos
- Removed a Google Calendar/Tasks integration (OAuth loopback + PKCE) that had taken five releases, because of its setup burden and the no-server rule, and replaced it with in-app events and a `.jongi` backup file

Short version (résumé project entry):

> Jongi-nyang: to-do app for macOS (SwiftUI) and Windows (Electron), solo, with AI pair programming. Shipped Mac 1.41.0 and Windows 1.26.0.
> Kept both apps consistent with shared case tables (136 input-line cases); cut idle CPU from 61% to 0.7% on Mac and from 5.7% to 1.5% on Windows using my own measurement scripts.
> github.com/leeahwi/jongi-nyang-app
