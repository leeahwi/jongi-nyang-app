# 아이콘표

한 뜻에 한 아이콘, 두 앱에서 같은 모양입니다. 새 버튼이나 메뉴에 아이콘을 붙일 때 이 표를 먼저 봅니다. 바꾸면 이 표도 같이 고칩니다.

- Mac은 SF Symbols, Windows는 `windows/src/renderer/icons.ts`의 이름입니다.
- 같은 모양을 다른 뜻에 쓰지 않습니다. 특히 발바닥은 메모 서랍, 고양이는 종이냥(펫), 핀은 고정, 반짝이는 사용 안내에만 씁니다.

## 책상 왼쪽 목록

아이콘은 받침 없이 그립니다. 고른 칸의 아이콘만 그 칸 안 행 아이콘과 같은 받침 색 위에 놓여, 지금 어디인지 보여 줍니다.

| 칸 | Mac | Windows | 받침 색 |
| --- | --- | --- | --- |
| 달력 | `calendar` | `calendar` | 초록(sage-2) |
| 완료 기록 | `leaf` | `leaf` | 초록 |
| 시계 | `alarm` | `alarm` | 분홍(clay-2) |
| 꾸미기 | `paintbrush` | `brush` | 꿀(tint-1) |
| 알림 | `bell` | `bell` | 라벤더(tint-2) |
| 반복 | `repeat` | `repeat` | 초록 |
| 종이냥 | `cat` | `cat` | 장밋빛(tab-3) |
| 일정 | `calendar.badge.clock` | `calendarClock` | 파랑(event-blue-2) |
| 저장과 백업 | `archivebox` | `archive` | 종이(paper-2) |
| 메모 서랍 | `pawprint` | `pawPrint` | 초록 |
| 스페이스 | `square.stack` | `spaces` | 초록 |
| AI 연결 | `bubble.left` | `chat` | 라벤더 |
| 도움말 | `questionmark.circle` | `help` | 초록 |
| 사용 안내 | `sparkles` | `sparkles` | 없음 |
| 검색 | `magnifyingglass` | `search` | 없음 |

## 뜻별

| 뜻 | Mac | Windows | 쓰는 곳 |
| --- | --- | --- | --- |
| 메모 서랍 | `pawprint` | `pawPrint` | 노트 머리 버튼, 책상 칸과 그 머리의 ‘서랍 열기’, 도움말 주제, 화면 끝 손잡이, 서랍 아래 줄. 사용자 결정: 서랍 모양이 아니라 발바닥을 그대로 둡니다. |
| 종이냥(펫) | `cat` | `cat` | 책상 칸, ‘펫 보이기’, 오늘 창 · 한눈에의 ‘종이냥 보이기’, 도움말 주제 |
| 고정 · 항상 위에 | `pin` | `pin` | 노트 머리 ‘항상 위에 두기’, ‘오늘 할 일에도 두기’, 메모 서랍 ⚙ 메뉴의 ‘다른 창 위에 띄우기’(#111에서 머리에서 뺐습니다)와 메모 ‘고정’(책갈피 · 묶음 머리 · 카드 · 마우스 버튼 · 메뉴, 고정한 것은 채운 핀 `pin.fill`; Mac ‘고정 모두 풀기’는 `pin.slash`) |
| 사용 안내 | `sparkles` | `sparkles` | 책상 맨 아래, 도움말 ‘시작하기’ |
| 완료 기록 | `leaf` | `leaf` | 책상 칸, 노트 아래 ‘완료 기록’, ‘오늘 한 장 끝!’, ‘완료 기록 보기’, 기록으로 옮긴 토스트, 검색 묶음 |
| 종이냥 한마디 | `quote.bubble` | `quote` | 종이냥 칸 ‘지금 한마디 듣기’ |
| AI 연결 | `bubble.left` | `chat` | 책상 칸, AI 연결 칸, AI 토스트 |
| 일정 | `calendar.badge.clock` | `calendarClock` | 책상 칸, 할 일 메뉴 ‘달력에 넣기…’, 검색 묶음 |
| 언젠가 | `tray.and.arrow.down` | `later` | 할 일 메뉴 ‘언젠가로 옮기기’, 언젠가로 옮긴 토스트 |
| 저장과 백업 | `archivebox` | `archive` | 책상 칸 |
| 메모 서랍의 바탕 | `square.on.square.dashed` | `backdrop` | 메모 서랍 칸 ‘바탕’ |
| 메모 서랍의 폭 | `arrow.left.and.right` | `width` | 메모 서랍 칸 ‘폭’ |
| 종이 색 | 자동 `circle.lefthalf.filled` · 낮 `sun.max` · 밤 `moon` | `contrast` · `sun` · `moon` | 꾸미기 ‘종이 색’ 행(고른 값을 따라갑니다) |

## 할 일 메뉴

| 항목 | Mac | Windows |
| --- | --- | --- |
| 고치기 | `pencil` | `edit` |
| 알림 | `bell` | `bell` |
| 마감 | `flag` | `flag` |
| 시간 정하기 | `clock` | `clock` |
| 완료 표시 | `checkmark.square` | `checkBox` |
| 이거 집중 | `timer` | `timer` |
| 내일 하기 | `arrow.right` | `arrowRight` |
| 날짜 바꾸기 | `calendar` | `calendar` |
| 오늘 하기 | `sun.max` | `sun` |
| 오늘 꼭 하나 | `star` | `star` |
| 스페이스로 옮기기 | `square.stack` | `spaces` |
| 위로 · 아래로 이동 | `arrow.up` · `arrow.down` | `arrowUp` · `arrowDown` |
| 지우기 | `trash` | `trash` |
| 일정 ‘할 일로 추가’ | `plus` | `plus` |

줄에 마우스를 올리면 버튼은 셋까지입니다: 오늘 탭 `→ 내일` · 알림(`bell`) · ⋯, 앞으로 탭 `↑ 오늘로` · 마감(`flag`) · ⋯, 끝낸 일은 ⋯만. ⋯(Mac `ellipsis`, Windows `more`)는 위 메뉴를 엽니다.

## 메모 서랍의 펼친 메모

펼친 메모 아래 도구 줄은 셋입니다: `Aa`(서식 막대, 아이콘 대신 글자) · 크게 보기 · ⋯. ⋯는 메모 우클릭과 같은 메뉴입니다(복사 · 복제 · 고정 · 폴더로 옮기기 · 이 메모의 종이 · 체크한 줄 지우기 · 지우기).

| 항목 | Mac | Windows |
| --- | --- | --- |
| 서식 | 글자 `Aa` | 글자 `Aa` |
| 크게 보기 · 작게 보기 | `arrow.up.left.and.arrow.down.right` · `arrow.down.right.and.arrow.up.left` | `expand` · `shrink` |
| 더 보기 | `ellipsis` | `more` |
| 폴더로 옮기기(메뉴) | `folder` | `folder` |

## 아직 남은 것

- 도움말의 다른 주제 아이콘(할 일 · 빠른 입력 · 앞으로 · 창 다루기 · 저장 · 백업)은 두 앱이 아직 다릅니다.
