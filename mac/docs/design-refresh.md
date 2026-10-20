# 한 장 · 전체 디자인 개선

> 개발하면서 남긴 작업 기록이에요(공개 저장소에서는 날짜와 당시 스냅숏 이미지를 뺐어요). 지금의 설계와 과정은 [`docs/`](../../docs)에 정리돼 있어요.

## 조사와 판단

공식 제품 페이지와 실제 제품 이미지를 확인했다.

- [Things 디자인과 기능](https://culturedcode.com/things/features/): 할 일을 중심에 놓고 보조 정보와 편집 기능을 필요한 위치에 배치한다. [Today 화면](https://static.culturedcode.com/things/videos/2017-05-18-website-videos/2-today-mac.png)의 정렬과 제목/메타데이터 대비를 참고했다.
- [Bear](https://bear.app/): 작업 내용이 중심인 차분한 화면. [공식 Mac 화면](https://bear.app/images/home/hero_mac.jpg)의 절제된 도구와 여백을 참고했다.
- [Bear 글꼴 설정](https://bear.app/faq/typography-options/): 글꼴 선택을 작업 공간의 일부로 다룬다. 한 장에서는 기존 세 글꼴을 실제 미리보기와 함께 설정에 노출한다.

제품 복제가 아니라 위 원칙을 작은 종이 메모장에 적용한다. 여러 목록이나 사이드바는 추가하지 않는다.

## 구현 방향

**시각적 주제:** 따뜻한 백지, 선명한 잉크, 은은한 종이 결 위에 작은 곰과 고양이가 함께 있는 개인 메모장.

**정보 순서:** 날짜와 제목 → 할 일 → 알림 시각 → 완료 현황. 할 일은 선택한 필기체, 조작과 시각 정보는 시스템 글꼴을 쓴다. 캐릭터와 글꼴을 설정에서 쉽게 바꾼다.

**상호작용:** 완료 시 연필선, 줄 위에 마우스를 올리면 하단 도구 표시, 알림 등장 시 캐릭터 인사. 동작 줄이기 설정을 따른다. 도구가 나타나도 본문 위치나 폭은 바뀌지 않는다.

## 변경 범위와 보존

종이의 강한 얼룩 대비를 낮추고 공통 색상/버튼을 정리한다. 메인 헤더, 줄 간격, 보조 정보, 하단 완료 표시, 설정과 알림 편집 및 팝업을 함께 개선한다. 기존 저장/실행 취소/알림 스케줄/세 가지 알림 디자인/포스트잇 최소화는 유지하며 위치는 아래 사용자 피드백에 따라 클릭 지점으로 보정했다. 외부 의존성은 추가하지 않는다.

## 최종 결과와 검증

- 메인: 헤더 132pt, 목록 44pt 한 줄 그리드. 오른쪽 시간표와 ⋯ 메뉴, 왼쪽 드래그 손잡이. 20pt 체크박스와 완료 진행 표시.
- 종이 결 강도를 낮추고 잉크 대비를 높였다. 곰·고양이와 세 가지 글꼴을 유지했다.
- 설정: 꾸미기/알림 탭. 같은 문장으로 글꼴을 비교하고, 알림 탭 하단 동작은 고정했다.
- 알림: 내용 길이에 맞는 높이, 정확한 시각, 직접 완료/미루기/노트 보기. 과도하게 오래된 알림은 수천 분으로 표시하지 않는다.
- 메뉴바: 캐릭터 옆 남은 수, 모두 완료하면 체크. 접근성 설명도 같은 상태를 제공한다.
- 중복 버튼 스타일을 공통 PaperActionButtonStyle로 통합했고 외부 의존성은 추가하지 않았다.

### 변경 파일

| 파일 | 변경 |
|---|---|
| Sources/PaperTodo/PaperTheme.swift | 색상, 종이 질감, 공통 버튼 |
| Sources/PaperTodo/PaperView.swift | 헤더, 행 정렬, hover 도구, 완료 상태 |
| Sources/PaperTodo/NotebookFont.swift | 동일 문장 미리보기, 기본 제목 글꼴 |
| Sources/PaperTodo/ReminderController.swift | 꾸미기/알림 설정 |
| Sources/PaperTodo/TaskReminderEditorView.swift | 개별 알림 편집 계층과 버튼 |
| Sources/PaperTodo/ReminderPopup.swift | 세 가지 팝업 정렬, 높이, 말풍선, 동작 |
| Sources/PaperTodo/PaperTodoApp.swift | 설정 진입, 메뉴바 남은 수 |
| Tests/PaperTodoTests/DesignSnapshots.swift | 격리된 실제 SwiftUI 렌더링 |
| scripts/render-design.sh | 렌더 실행 도구 |
| Resources/Info.plist | 1.5.0 / build 6 |
| README.md | 사용법 및 화면 갱신 |

코어 17, 주기 알림 13, 개별 알림 13, 시각 표시 9, 프레젠테이션 5: 총 57개 회귀 검사 통과. 디버그/릴리스는 warnings-as-errors로 빌드한다. 렌더링은 세 글꼴, 최소 크기, 개별 알림 편집기, 두 설정 탭, 세 알림 모양과 긴 제목을 확인했다.

**한계:** Mac이 잠겨 실제 포인터 hover, 설정 탭 클릭, 메뉴바 동적 표시의 새 UI 수동 검증은 수행하지 못했다. 렌더링 증거와 실제 사용자 입력 검증을 구분한다. 앱을 종료하면 알림이 멈추는 기존 동작은 유지한다.

### 화면

## 한 줄 목록 보정

사용자 피드백을 반영해 모든 행을 44pt 한 줄로 통일했다. 별도 보조 정보 줄과 hover 도구 영역을 삭제하고, 알림은 오른쪽 시간표(오늘/내일/날짜 + 24시간 시각), 편집은 항상 보이는 ⋯ 메뉴로 통합했다. 작은 창의 긴 제목은 말줄임하며, 마우스 도움말과 편집에서 전체 내용을 확인할 수 있다.

변경: PaperView.swift, PaperTheme.swift, ReminderTimeText.swift 및 시각 형식 검사. 시각 검사에 오늘·내일·다른 날짜·다른 연도 네 사례를 추가했다.

## 클릭 위치 최소화 · 드래그 손잡이 · 날짜 표시

- 사용자 의도: 모니터 상단 중앙이 아니라 노트 상단을 더블클릭한 지점에 포스트잇 아이콘이 생겨야 한다.
- 시각적 주제: 기존 백지와 한 줄 목록을 유지하고, 월/일/요일을 작은 달력 인쇄처럼 구성한다.
- 정보 순서: 달력 날짜 → 오늘 할 일 → 캐릭터. 월과 요일은 작게, 일자는 크게 구분한다.
- 상호작용: 왼쪽 점 여섯 개 손잡이로 직접 드래그. 대상 행 위·아래 절반에 따라 삽입선을 표시하고 놓을 때 한 번만 순서를 저장한다. ⋯ 메뉴는 편집용으로 남긴다.
- [Things 공식 디자인/목록 편집](https://culturedcode.com/things/features/)의 명확한 제목 위계와 직접 순서 이동, [Bear 글꼴 설정](https://bear.app/faq/typography-options/)의 읽기 좋은 여백을 참고했다. 작은 달력 구성은 이 앱을 위해 새로 설계했다.

- 구현 파일: PaperView.swift(날짜/삽입선), PaperTaskDragHandle.swift(네이티브 드래그 손잡이), AppModel.swift(앞/뒤 삽입), PaperTodoApp.swift 및 FloatingMascotPanel.swift(클릭 좌표 배치).
- 메뉴와 드래그 동작을 분리했고 창 배경 이동은 상단 전용으로 한정했다. 외부 의존성은 추가하지 않았다.
- 회귀 검사 66개: 코어17 + 주기13 + 개별알림13 + 시각13 + 프레젠테이션6 + 위치계산4.
- 실제 상단 더블클릭: 요청 좌표 (860,874), 아이콘 중심 (860,874), 오차 (0,0).
- 손잡이 접근성 이동으로 순서 변경과 파일 저장을 확인했다. 자동화 도구의 포인터 드래그로는 이동이 재현되지 않아 마우스 드래그 전체 경로를 검증 완료로 간주하지 않는다.

## 하단 리마인더 재설계

시각적 주제: 화면 위에 잠깐 찾아온 작은 친구와 하나의 말풍선. 무거운 종이 패널, 접힌 모서리, 동그란 캐릭터 받침과 세 버튼 줄을 삭제한다.

정보 순서: 예약 시각 또는 남은 개수 → 실제 할 일 → 다시 알림. 완료는 체크, 노트 열기는 제목, 미루기는 하단 하나의 묶음으로 분리한다. 선택 글꼴과 캐릭터는 유지한다.

상호작용: 작은 등장 움직임과 제한된 손 인사, 호버 중 자동 닫기 멈춤. 기존 완료/미루기/미리보기 안전성 및 동작 줄이기를 보존한다.

정리 계획: 중복된 세 레이아웃과 사용하지 않는 종이/말풍선 도형·버튼 스타일을 공통 말풍선 구성으로 교체한다. 세 저장된 스타일 값은 유지하고 미니/쪽지/친구로 재해석한다. 스케줄·저장·미리보기 콜백은 바꾸지 않는다.

### 리마인더 v1.7 결과

변경 파일: ReminderPopup.swift, ReminderPresentationStyle.swift, DesignSnapshots.swift, Info.plist, README.md. 세 중복 레이아웃을 하나의 말풍선 구조로 합치고, 접힌 종이/중첩 말풍선/중복 버튼 스타일을 제거했다. 기존 스타일 저장 값은 유지하되 표시 이름을 미니·쪽지·친구로 바꿨다.

- 빈 원: 완료. 제목/캐릭터: 노트 열기.
- 10분 뒤 다시 알림: 바로 미루기. 옆 화살표: 5/10/30분 선택.
- 예약 알림: 날짜와 24시간 시각. 주기 알림: 남은 개수. 미리보기는 별도 문구.
- 관련 회귀 32개(일정13/개별13/프레젠테이션6), warnings-as-errors 디버그·릴리스 빌드 통과.
- 실제 SwiftUI 렌더로 세 스타일, 긴 제목, 고양이/붓글씨 주기 알림 확인. 새 컨트롤의 포인터 전체 흐름은 별도 수동 검증하지 않았다.

## 1.10 참고 사례

공식 문서와 제품 페이지를 확인했다. 페이지 글로 확인했으며, 화면 이미지 비교는 하지 않았다.

- [Apple HIG · Notifications](https://developer.apple.com/design/human-interface-guidelines/notifications): 같은 주제로 알림을 여러 번 보내지 말 것, 동작은 적고 짧게. → 할 일마다 뜨던 알림을 말풍선 하나로 합침.
- [UNNotificationCategory 요약 형식](https://developer.apple.com/documentation/usernotifications/unnotificationcategory): 묶인 알림은 개수 요약으로 표시. → "외 N개".
- [Apple HIG · Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers): 내용만큼만 크게. → 줄 수에 맞춰 말풍선 높이 계산.
- [Things 3](https://culturedcode.com/things/features/): 보조 정보는 필요할 때만. → 손잡이 hover 표시, ⋯ 흐리게.
- [Todoist Today](https://todoist.com/help/articles/plan-your-day-with-the-todoist-today-view-UVUXaiSs): 동그라미로 바로 완료, 다 끝낸 화면에 따뜻한 한마디. → 말풍선 줄별 완료, "오늘 한 장 끝!".
- [DockCat](https://github.com/Auwuua/DockCat), [Finch](https://screensdesign.com/showcase/finch-self-care-pet): 재촉하지 않는 다정한 말투. → "아직 N개 남았어요", "다 끝냈어요, 수고했어요!".

검증: 프레젠테이션 14개(묶음 말풍선, 동시에 울릴 개별 알림 3개 → 표시 1회) 포함 회귀 74개 통과, warnings-as-errors 디버그/릴리스 빌드.
