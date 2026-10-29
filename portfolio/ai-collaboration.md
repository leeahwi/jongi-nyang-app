# AI와 일한 방식

[한국어](#한국어) · [English](#english)

## 한국어

종이냥은 AI 코딩 도구 Claude Code와 함께 만들었다. 나는 기획과 기능, 쓰기 편한지와 실제로 쓸모가 있는지에 집중했다. 구현 방법과 디자인 시안은 AI가 여러 개 제안했다. 제안을 그대로 받지는 않았다. 먼저 구현 계획을 만들어 미리보기로 보여 달라고 하고, 그걸 보고 무엇을 넣을지 판단했다.

AI에게 맡긴 것:
- Swift와 TypeScript 코드의 초안. 두 앱을 나란히 진행했고, 한쪽의 사례 표를 다른 쪽이 통과하게 해서 맞췄다.
- 시험과 검사 도구. 공유 사례 시험, 화면 스냅숏과 크기 훑기, WCAG 대비 검사, 번역 누락 검사, 성능 측정 스크립트(`mac/scripts/perf.sh`, `windows/tools/perf.mjs`).
- 영어와 네덜란드어 문구 초안. 빠진 번역, 맞지 않는 자리표시자, 번역되지 않은 한글은 검사로 막았지만, 문장 자체는 아직 원어민이 검토하지 않았다.
- 디자인 시안. 여러 안을 나란히 놓은 HTML 페이지로 받았다.
- 고양이 그림. 이미지 생성 도구로 만들었다. 앉은 고양이 한 장을 기준으로 포즈마다 같은 스타일 문단을 붙여 요청했고, 요청문은 [`mac/art/`](../mac/art)에 있다.

내가 한 것:
- 무엇을 만들고 무엇을 뺄지 정했다. 곰 대신 고양이 하나(1.7.2), 앱 이름 '종이냥'(Mac 1.25), Google 연동 빼기(Mac 1.31.0, 개인 일정과 업무를 섞지 않으려고), 하루 띠를 세 번 다시 그리기.
- 디자인 시안 가운데 고르거나 섞었다. 기준은 한눈에 알아볼 수 있는가였다. 하루 띠의 카드 모양은 AI가 만든 디자인마다 나오는 모양이라 뺐다.
- 매일 쓰면서 필요해서 넣자고 한 기능이 있다. 할 일에 시간 알림, 언젠가로 넘기고 오늘로 다시 가져오기(Mac 1.17의 '나중에' 탭과 '↑ 오늘로'), 메모 탭(Mac 1.15) 등.
- 매일 앱을 쓰면서 이상한 곳을 찾아 고치게 했다. 잘린 손글씨 한 픽셀, 탭 끝 잘림, 밋밋한 알람 창, 어색한 말, 걷는 고양이의 머리와 몸 비율, 더블클릭한 자리에 포스트잇이 접혀야 한다는 것 같은 것들이다. 집중 뒤 ×를 누르면 앱이 멈추는 것과 30분짜리 할 일이 29분으로 시작하는 것도 쓰다가 찾았고, 원인은 AI와 함께 추적해 1.40.1에서 고쳤다.
- 메모 서랍(Mac 1.43–1.44, Windows 1.28–1.29)은 쓰면서 고칠 곳을 짚었다. 밤 종이에서 글자가 눈에 안 들어온다, 서랍 설정을 찾기 어렵다, 모눈 종이에서 메모와 바탕이 잘 안 나뉜다, 메모끼리 구별이 약하다, 기본 메모 높이가 너무 빡빡하다, 메모에 우클릭 메뉴가 있었으면 좋겠다. AI가 다른 메모 앱과 HIG를 조사해 시안을 여러 장 냈고, 나는 사람들에게 익숙한 안(날짜 묶음과 카드)을 골랐다.
- 메뉴 막대 오늘 창의 위쪽이 잘리는 것을 쓰다가 찾았다(Mac 1.42.1). 원인은 AI와 함께 추적했다.
- Claude 연결(Mac 1.42, Windows 1.27)에서는 기본은 꺼 두고, 고치기 전에는 반드시 보여 주고 확인을 받고, 앱에서 한 번에 되돌릴 수 있어야 한다는 선을 정했다.
- 버전마다 무엇을 넣을지, 두 앱을 같은 버전 단위로 맞출지 정하고 결과를 검토했다.
- 고양이 그림은 생성된 것 가운데 골랐고, 같은 크기와 바닥선에 맞췄다.

AI가 코드를 빨리 많이 쓸수록 실패를 기계가 알려 주는 장치가 더 필요했다. 이 저장소의 시험과 검사 대부분이 그래서 생겼다. 그래도 0×0 확인 쪽지 버그(Mac 1.40.1)처럼 실제 앱을 쓰다가 눌러 봐야 드러나는 문제가 남았다.

## English

I built Jongi-nyang with an AI coding tool, Claude Code. I focused on planning, features, and whether things were convenient and actually useful. The AI proposed implementations and several design options. I didn't take them as they came: I first had it write an implementation plan and show it to me as a preview, then decided what to apply.

What I gave to AI:
- First drafts of the Swift and TypeScript code. The two apps moved in parallel, aligned by making one side pass the other side's case table.
- Tests and checks: the shared case tests, snapshots and size sweeps, the WCAG contrast check, missing-translation checks, and the measurement scripts (`mac/scripts/perf.sh`, `windows/tools/perf.mjs`).
- First drafts of the English and Dutch text. Checks catch missing translations, mismatched placeholders and untranslated Korean, but no native speaker has reviewed the wording yet.
- Design options, delivered as HTML pages with several versions side by side.
- The cat, made with an image-generation tool. Every pose was requested with one reference image of the sitting cat and a shared style paragraph. The prompts are in [`mac/art/`](../mac/art).

What I did:
- Decided what to build and what to drop: one cat instead of a bear and a cat (1.7.2), the name Jongi-nyang (Mac 1.25), removing the Google integration (Mac 1.31.0, to keep private plans and work apart), redrawing the day strip three times.
- Chose among the design options, or combined them. My test was whether I could take it in at a glance. I dropped the card layout for the day strip because cards show up in every AI-made design.
- Asked for features I needed from daily use: time reminders on to-dos, moving a to-do to Someday and bringing it back to Today (the Later tab in Mac 1.17), and a Memos tab (Mac 1.15), among others.
- Used the app every day and reported what was wrong: a pixel of clipped handwriting, tab edges cut off, a plain-looking alarm window, an awkward word, the walking cat's head-to-body proportions, the exact spot a sticky note should fold to. I also found in use that × froze the app after a focus session and that a 30-minute to-do started a 29-minute focus; we traced both and fixed them in Mac 1.40.1.
- Pointed out what to fix in the notes drawer while using it (Mac 1.43–1.44, Windows 1.28–1.29): text on night paper was hard to read, the drawer settings were hard to find, notes didn't stand apart from the grid paper or from each other, the default note height felt cramped, and notes needed a right-click menu. The AI researched other note apps and the HIG and produced several mock-ups; I picked the one people already know (date groups and cards).
- Found in use that the top of the menu-bar Today window was cut off (Mac 1.42.1); we traced the cause together.
- For the Claude connection (Mac 1.42, Windows 1.27) I set the lines: off by default, every change shown and confirmed first, and one-step undo in the app.
- Decided what went into each release and whether both apps shipped in step, and reviewed the results.
- Picked the cat images from what was generated and normalized them to one size and baseline.

The faster AI wrote code, the more I needed checks that fail on their own. That's why most of the tests and checks in this repository exist. Some bugs still only showed up by clicking through the real app, like the 0×0 confirmation slip in Mac 1.40.1.
