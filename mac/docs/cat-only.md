# 종이냥 단일 캐릭터 (1.7.2)

> 개발하면서 남긴 작업 기록이에요(공개 저장소에서는 날짜와 당시 스냅숏 이미지를 뺐어요). 지금의 설계와 과정은 [`docs/`](../../docs)에 정리돼 있어요.

곰 선택과 이미지, 캐릭터 설정 저장/관찰 로직을 제거했다. 기존 mascot 설정은 더 이상 사용하지 않고 초기화한다. 할 일·알림 저장 데이터는 변경하지 않는다.

노트, 리마인더, 포스트잇 최소화, Dock, 메뉴바는 동일한 PaperCat 이미지를 사용한다. Finder 앱 아이콘도 PaperCat으로 생성한다. 기존 빌드 폴더에 남은 PaperBear 리소스는 패키징 시 제거한다.

변경 파일: PaperTheme.swift, AppModel.swift, PaperView.swift, PaperTodoApp.swift, ReminderController.swift, TaskReminderEditorView.swift, DesignSnapshots.swift, scripts/build.sh, scripts/qa.sh, Resources/Info.plist, README.md. 삭제: Assets/PaperBear.png.

검증: 기존 프레젠테이션 회귀 8개, warnings-as-errors 디버그·릴리스 빌드, 실제 SwiftUI 설정/알림 렌더링, 앱 서명과 번들 리소스 검사. 설치된 앱의 실행 중 아이콘은 새 앱으로 다시 실행해야 적용된다.
