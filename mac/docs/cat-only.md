# 종이냥 단일 캐릭터 (1.7.2)

> 개발하면서 남긴 작업 기록이에요(공개 저장소에서는 날짜와 당시 스냅숏 이미지를 뺐어요). 지금의 설계와 과정은 [`docs/`](../../docs)에 정리돼 있어요.

1.7.2부터 캐릭터는 고양이 하나예요. 곰을 고르는 설정과 곰 그림, 캐릭터 설정을 저장하고 지켜보는 코드를 뺐어요. 예전 캐릭터(mascot) 설정은 더 쓰지 않고 처음 값으로 되돌려요. 할 일 · 알림 데이터는 바꾸지 않아요.

노트, 리마인더, 포스트잇으로 접은 모습, Dock, 메뉴 막대가 모두 같은 PaperCat 그림을 써요. Finder의 앱 아이콘도 PaperCat으로 만들어요. 예전 빌드 폴더에 남은 PaperBear 리소스는 묶을 때 지워요.

바꾼 파일: PaperTheme.swift, AppModel.swift, PaperView.swift, PaperTodoApp.swift, ReminderController.swift, TaskReminderEditorView.swift, DesignSnapshots.swift, scripts/build.sh, scripts/qa.sh, Resources/Info.plist, README.md. 지운 파일: Assets/PaperBear.png.

확인한 것: 기존 화면 회귀 검사 8개, 경고를 오류로 보는(warnings-as-errors) 디버그 · 릴리스 빌드, 실제 SwiftUI 설정 · 알림 렌더링, 앱 서명과 번들 리소스 검사가 모두 통과했어요. 이미 설치해서 실행 중인 앱의 아이콘은 새 앱으로 다시 실행해야 바뀌어요.
