import AppKit
import PaperCore
import SwiftUI

/// 메모 서랍 (1.43): the drawer in its four papers with a folder of mixed memos (a checklist open, a long memo, a code
/// line, a pinned one), an empty folder, 고정, search, the folder sheet, narrow and wide, the left side, typing, 크게
/// 보기, a toast; the handle; the settings group; the memo tab with folder names.
extension DesignSnapshots {
    static func renderMemoDrawer(folder: URL, output: URL) throws {
        let only = ProcessInfo.processInfo.environment["PAPERTODO_ONLY"] ?? ""
        guard only.isEmpty || only.contains("drawer") else { return }
        let storage = folder.appendingPathComponent("drawer/todos.json")
        let data = storage.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        try NotebookFile(url: storage).save(Notebook())
        let calendar = Calendar.current
        let base = calendar.date(bySettingHour: 14, minute: 0, second: 0, of: Date())!
        func at(daysAgo: Int, _ hour: Int, _ minute: Int) -> Date {
            calendar.date(bySettingHour: hour, minute: minute, second: 0, of: calendar.date(byAdding: .day, value: -daysAgo, to: base)!)!
        }
        func memo(_ id: String, _ text: String, _ when: Date, created: Date? = nil) -> Memo { Memo(id: id, text: text, createdAt: created ?? when, updatedAt: when) }
        // 1.44: one folder of every kind and every date group (오늘 … 작년), so the list shows its headers, chips and times.
        var memos = [
            memo("weekly", t("주간 회의\n시안 2개는 금요일까지. 디자인 리뷰는 목요일 3시, QA 일정은 다시 잡기로.\n회의록은 공유 폴더에 올려 두기",
                             "Weekly meeting\nTwo drafts by Friday. Design review Thursday at 3, QA dates to be set again.\nPut the minutes in the shared folder",
                             "Weekoverleg\nTwee ontwerpen voor vrijdag. Ontwerpreview donderdag om 3 uur, QA-planning opnieuw prikken.\nNotulen in de gedeelde map zetten"),
                 at(daysAgo: 0, 10, 12)),
            memo("deploy", t("배포 체크리스트\n- [x] 버전 올리기\n- [x] 변경 기록 쓰기\n- [ ] DMG 만들고 열어 보기\n- [ ] 릴리스 노트 붙이기",
                             "Release checklist\n- [x] Bump the version\n- [x] Write the changelog\n- [ ] Build the DMG and open it\n- [ ] Attach the release notes",
                             "Release-checklist\n- [x] Versie ophogen\n- [x] Wijzigingen opschrijven\n- [ ] DMG maken en openen\n- [ ] Release notes toevoegen"),
                 at(daysAgo: 0, 9, 20)),
            memo("mcpb", t("읽고 싶은 책 정리", "Books to read", "Boeken om te lezen"), at(daysAgo: 1, 18, 2)),
            memo("tube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", at(daysAgo: 1, 15, 11)),
            memo("phone", t("꽃집 전화 010 1234 5678", "Flower shop 010 1234 5678", "Bloemist 010 1234 5678"), at(daysAgo: 6, 16, 40)),
            memo("cmd", t("자주 쓰는 명령\ngit log --oneline -5", "Commands I use\ngit log --oneline -5", "Vaak gebruikte opdrachten\ngit log --oneline -5"), at(daysAgo: 7, 9, 5)),
            memo("contact", t("거래처 연락처\n메일은 금요일 오전에, 견적서 받으면 공유", "Supplier contacts\nEmail on Friday morning, share the quote when it comes",
                              "Contacten leverancier\nVrijdagochtend mailen, offerte delen zodra die er is"), at(daysAgo: 14, 16, 30)),
            memo("long", t("디자인 리뷰에서 나온 것\n버튼 글자가 영어에서 잘리지 않게 폭을 다시 재 보기. 밤 종이에서 회색 글자가 너무 옅다는 의견이 있었어요.\n아이콘은 선 굵기를 하나로 맞추기",
                           "From the design review\nMeasure the buttons again so English labels don’t get cut. Someone said the grey text on night paper is too faint.\nMake every icon the same line weight",
                           "Uit de ontwerpreview\nKnoppen opnieuw meten zodat Engelse labels niet worden afgekapt. Iemand vond de grijze tekst op nachtpapier te licht.\nAlle iconen dezelfde lijndikte geven"),
                 at(daysAgo: 40, 11, 0)),
            memo("lastyear", t("연말 정산 서류\n영수증은 상자 맨 위 칸", "Year-end tax papers\nReceipts are in the top box", "Belastingpapieren\nBonnetjes liggen in de bovenste doos"), at(daysAgo: 400, 11, 0)),
            memo("shop", t("장보기\n- [ ] 우유\n- [ ] 달걀\n- [x] 커피 원두", "Groceries\n- [ ] Milk\n- [ ] Eggs\n- [x] Coffee beans", "Boodschappen\n- [ ] Melk\n- [ ] Eieren\n- [x] Koffiebonen"),
                 at(daysAgo: 0, 8, 30)),
            memo("weekend", t("주말 계획\n토요일 오전 공원 산책, 저녁엔 친구들이랑 저녁 약속", "Weekend plans\nSaturday morning walk in the park, dinner with friends in the evening",
                              "Weekendplannen\nZaterdagochtend wandelen in het park, ’s avonds uit eten met vrienden"), at(daysAgo: 2, 21, 15)),
        ]
        // A busy folder (more than 20): the dense list — two lines at most on a card (#14), a long one and a checklist first.
        for n in 0..<24 {
            let text = switch n {
            case 0: t("할 일 묶음 1\n이번 주 안에 끝낼 것들을 한곳에 모아 두었어요. 급한 것부터 위에 적고, 끝난 건 지워 가며 정리하기. 다음 주 월요일에 한 번 더 보기.",
                      "Batch 1\nEverything to finish this week in one place. The urgent ones go on top, and the done ones get crossed off as I go. One more look next Monday.",
                      "Stapel 1\nAlles wat deze week af moet, op één plek. Het dringende bovenaan, en wat klaar is streep ik door. Maandag nog een keer kijken.")
            case 1: t("할 일 묶음 2\n- [x] 자료 모으기\n- [ ] 표 정리하기\n- [ ] 메일 보내기", "Batch 2\n- [x] Gather the notes\n- [ ] Tidy the table\n- [ ] Send the email",
                      "Stapel 2\n- [x] Notities verzamelen\n- [ ] Tabel opruimen\n- [ ] Mail versturen")
            default: t("할 일 묶음 \(n + 1)\n작은 메모 한 줄", "Batch \(n + 1)\nA short line", "Stapel \(n + 1)\nEen korte regel")
            }
            memos.append(memo("many\(n)", text, at(daysAgo: n, 12, 0)))
        }
        try MemoFile.save(memos, to: data.appendingPathComponent("memos.json"))
        var folders = MemoFolders.fresh(language: .current)
        let stamp = at(daysAgo: 20, 9, 0)
        folders.recolor(MemoFolders.inbox, to: .sky, now: stamp)
        _ = folders.addFolder(name: t("회사", "Work", "Werk"), color: .lavender, now: stamp, id: "work")
        _ = folders.addFolder(name: t("집", "Home", "Thuis"), color: .pink, now: stamp, id: "home")
        _ = folders.addFolder(name: t("장보기", "Shopping", "Boodschappen"), color: .mint, now: stamp, id: "shopping")
        _ = folders.addFolder(name: t("공부", "Study", "Studie"), color: .yellow, now: stamp, id: "study")
        _ = folders.addFolder(name: t("자료", "Archive", "Archief"), color: .peach, now: stamp, id: "many")
        for id in ["weekly", "deploy", "mcpb", "tube", "phone", "cmd", "contact", "long", "lastyear"] { folders.place(id, in: "work", now: stamp) }
        folders.place("weekend", in: "home", now: stamp)
        folders.place("shop", in: "shopping", now: stamp)
        for n in 0..<24 { folders.place("many\(n)", in: "many", now: stamp) }
        folders.setPinned("deploy", true, now: stamp)
        folders.setPinned("weekend", true, now: stamp)
        try folders.save(to: data.appendingPathComponent(MemoFolders.fileName))

        let suite = "PaperTodo.Drawer.\(UUID())"
        let preferences = UserDefaults(suiteName: suite)!
        defer { preferences.removePersistentDomain(forName: suite) }
        let model = AppModel(storageURL: storage, isolated: true, preferences: preferences)
        model.paperColor = night ? .night : .day
        let drawer = model.drawer
        drawer.now = { base }
        drawer.refreshForSnapshot()
        drawer.recentMoves = ["home", "shopping"]
        let screen = night ? Color(white: 0.12) : Color(red: 0.85, green: 0.83, blue: 0.80)
        func size(_ width: CGFloat = 300, height: CGFloat = 820) -> NSSize {
            NSSize(width: MemoDrawerView.shadowRoom + MemoDrawerView.tabsWidth + width, height: height)
        }
        func shot(_ name: String, _ size: NSSize? = nil) throws {
            let size = size ?? Self.drawerSize(drawer)
            try render(MemoDrawerView(drawer: drawer).frame(width: size.width, height: size.height).background(screen),
                       size: size, to: output.appendingPathComponent("drawer-\(name).png"))
        }
        /// The drawer with a menu open over it (the menu drawn from the same items the app's NSMenu is made of), and a
        /// submenu beside it when given.
        /// A menu with a swatch row is as wide as the row (as the real NSMenu is).
        func wide(_ items: [DrawerMenuItem]) -> Bool { items.contains { if case .swatches = $0.kind { return true } else { return false } } }
        func menuShot(_ name: String, _ items: [DrawerMenuItem], at point: CGPoint, sub: [DrawerMenuItem]? = nil, subAt: CGFloat = 0, width: CGFloat = 300) throws {
            let drawerSize = size()
            let total = NSSize(width: max(drawerSize.width, point.x + 300 + (sub == nil ? 0 : 300)) + 20, height: drawerSize.height)
            let view = ZStack(alignment: .topLeading) {
                MemoDrawerView(drawer: drawer).frame(width: drawerSize.width, height: drawerSize.height)
                DrawerMenuPreview(items: items, font: model.notebookFont, width: wide(items) ? 300 : 260).offset(x: point.x, y: point.y)
                if let sub { DrawerMenuPreview(items: sub, font: model.notebookFont, width: wide(sub) ? 300 : 220).offset(x: point.x + (wide(items) ? 292 : 252), y: point.y + subAt) }
            }
            .frame(width: total.width, height: total.height, alignment: .topLeading)
            .background(screen)
            .environment(\.colorScheme, drawer.palette.scheme)
            try render(view, size: total, to: output.appendingPathComponent("drawer-\(name).png"))
        }
        func reset() {
            drawer.side = .right
            drawer.width = MemoDrawer.defaultWidth
            drawer.backdrop = .opaque
            drawer.previewDesktop = false
            drawer.previewHover = nil
            drawer.show(.folder("work"))
            drawer.selectedID = nil
            drawer.toast = nil
            drawer.folderSheet = nil
        }

        // The list (③ 날짜 묶음 + 카드) in the four papers: groups, chips, the pinned group; then the checklist open.
        for theme in [MemoDrawer.Theme.day, .night, .kraft, .grid] {
            drawer.theme = theme
            reset()
            try shot("list-\(theme.rawValue)", size())
            drawer.expand("deploy")
            try shot(theme.rawValue, size())
        }
        // 자동 follows the note: day paper by day, night paper under a night note.
        drawer.theme = .auto
        reset()
        drawer.expand("deploy")
        try shot("auto-\(night ? "night" : "day")", size())
        drawer.theme = night ? .night : .day
        let paper = night ? "night" : "day"
        // Picked by keyboard; under the pointer (the hover pill); typing in a memo (its raw text and the bar).
        reset()
        drawer.selectedID = "phone"
        try shot("selected-\(paper)", size())
        reset()
        drawer.previewHover = "mcpb"
        try shot("hover-\(paper)", size())
        reset()
        drawer.expand("weekly")
        try shot("editing-\(paper)", size())
        reset()
        drawer.bigID = "long"
        try shot("big-\(paper)", size())
        // Per-memo paper: a night memo in a day drawer (a day memo in a night one).
        reset()
        drawer.setPaper("weekly", night ? .day : .night)
        drawer.setPaper("tube", .grid)
        try shot("memo-paper-\(paper)", size())
        drawer.expand("weekly")
        try shot("memo-paper-open-\(paper)", size())
        drawer.collapse()
        drawer.setPaper("weekly", nil)
        drawer.setPaper("tube", nil)
        // An empty folder, 고정, the dense list, search, 제목 순.
        reset()
        drawer.show(.folder("study"))
        try shot("empty-\(paper)", size())
        drawer.show(.pinned)
        try shot("pinned-\(paper)", size())
        drawer.show(.folder("many"))
        try shot("dense-\(paper)", size())
        reset()
        drawer.setSort(.title, for: .folder("work"))
        try shot("sort-title-\(paper)", size())
        drawer.setSort(.edited, for: .folder("work"))
        reset()
        drawer.startSearch()
        drawer.query = t("ㅎㅇ", "meet", "overleg")
        try shot("search-\(paper)", size())
        drawer.query = t("ㅋㅋㅋ", "zebra", "zebra")
        try shot("search-none-\(paper)", size())
        drawer.endSearch()
        // The menus (mock/v2): the folder list, ⚙, a memo's (with 폴더로 옮기기), the open memo's ⚙, a bookmark's, 고정's.
        reset()
        try menuShot("menu-folders-\(paper)", DrawerMenus.folderList(drawer), at: CGPoint(x: 70, y: 72))
        try menuShot("menu-gear-\(paper)", DrawerMenus.drawer(drawer), at: CGPoint(x: 40, y: 330))
        let memoItems = DrawerMenus.memo(drawer, "deploy")
        try menuShot("menu-memo-\(paper)", memoItems, at: CGPoint(x: 90, y: 150), sub: DrawerMenus.move(drawer, "deploy"), subAt: 240)
        drawer.expand("deploy")
        try menuShot("menu-memo-gear-\(paper)", DrawerMenus.memoGear(drawer, "deploy"), at: CGPoint(x: 80, y: 380))
        reset()
        try menuShot("menu-bookmark-\(paper)", DrawerMenus.folder(drawer, "work"), at: CGPoint(x: 30, y: 200), sub: DrawerMenus.sort(drawer, .folder("work")), subAt: 150)
        try menuShot("menu-pinned-\(paper)", DrawerMenus.pinned(drawer), at: CGPoint(x: 30, y: 420))
        // The text menu while typing: the system's own rows (read from a real text view) and `이 메모`.
        drawer.expand("deploy")
        drawer.editing = true
        try menuShot("menu-text-\(paper)", textMenu(drawer, "deploy"), at: CGPoint(x: 60, y: 260))
        reset()
        // The four backdrops over a busy desktop (the app's blur is the system's; drawn here as a blurred desktop).
        for backdrop in MemoDrawer.Backdrop.allCases {
            reset()
            drawer.backdrop = backdrop
            drawer.previewDesktop = true
            let size = size(height: 700)
            try render(MemoDrawerView(drawer: drawer).frame(width: size.width, height: size.height).background(DrawerDesktop()),
                       size: size, to: output.appendingPathComponent("drawer-backdrop-\(backdrop.rawValue)-\(paper).png"))
        }
        // The folder sheet: 회사's name and colour; a new folder.
        reset()
        drawer.editFolder("work")
        try shot("folder-edit-\(paper)", size())
        drawer.newFolder()
        try shot("folder-new-\(paper)", size())
        // Narrow, wide, the left side.
        for width: CGFloat in [260, 480] {
            reset()
            drawer.width = width
            drawer.expand("deploy")
            try shot("width-\(Int(width))-\(paper)", size(width))
        }
        reset()
        drawer.side = .left
        drawer.expand("deploy")
        try shot("left-\(paper)", size())
        // The undo toast after deleting a folder.
        reset()
        drawer.say(MemoFolders.movedToInbox(count: 5, inbox: drawer.folders.folder(MemoFolders.inbox)?.displayName(.current) ?? "", language: .current), action: L("되돌리기"))
        try shot("toast-\(paper)", size(height: 600))
        reset()

        // The handle at the edge (1.45: one pale cream on every paper, day and night; today's number only in its
        // tooltip): at rest and under the pointer (drawn out), on the right and on the left.
        var handles: [AnyView] = []
        for (right, hover) in [(true, false), (true, true), (false, false), (false, true)] {
            let state = DrawerHandleState()
            state.count = 3
            state.right = right
            handles.append(AnyView(DrawerHandleView(state: state, drawer: drawer, previewHover: hover)
                .frame(width: DrawerHandleView.size.width, height: DrawerHandleView.size.height)))
        }
        drawer.theme = night ? .night : .day
        try render(HStack(spacing: 18) { ForEach(handles.indices, id: \.self) { handles[$0] } }
                    .padding(16).background(screen), size: nil, to: output.appendingPathComponent("drawer-handle.png"))

        // Settings: the groups as the desk's 메모 서랍 pane draws them; listening for a key; a key the app already uses.
        func settings(_ view: some View) -> some View {
            view.environment(\.settingsTint, DeskPane.drawer.tint).frame(width: 640).padding(28).background(PaperTheme.paper)
        }
        drawer.theme = .auto
        try render(settings(MemoDrawerSettingsGroup(drawer: drawer)), size: nil, to: output.appendingPathComponent("drawer-settings.png"))
        try render(settings(MemoDrawerSettingsGroup(drawer: drawer, previewRecording: true,
                                                   previewProblem: L("\(DrawerShortcut(keyCode: 46, modifiers: 4096 | 2048, key: "M").text) 키는 종이냥이 이미 써요(빠른 메모 · 노트 · 빠른 입력). 다른 키를 눌러 주세요."))),
                   size: nil, to: output.appendingPathComponent("drawer-settings-recording.png"))
        // A key of one's own: the small ‘기본값’ link comes up beside it (#27).
        drawer.shortcut = DrawerShortcut(keyCode: 2, modifiers: 4096 | 2048, key: "D")
        try render(settings(MemoDrawerSettingsGroup(drawer: drawer)), size: nil, to: output.appendingPathComponent("drawer-settings-custom.png"))
        drawer.shortcut = nil
        try render(settings(MemoDrawerSettingsGroup(drawer: drawer)), size: nil, to: output.appendingPathComponent("drawer-settings-off.png"))
        drawer.shortcut = .standard
        drawer.shortcutRegistered = false
        try render(settings(MemoDrawerSettingsGroup(drawer: drawer)), size: nil, to: output.appendingPathComponent("drawer-settings-taken.png"))
        drawer.shortcutRegistered = true

        // The note with two tabs (the 메모 tab became the drawer) and its paw button; narrow, middle, wide.
        model.page = .todos
        for size in [NSSize(width: 350, height: 460), NSSize(width: 420, height: 560), NSSize(width: 720, height: 560)] {
            try render(PaperView(model: model), size: size, to: output.appendingPathComponent("drawer-note-\(Int(size.width)).png"))
        }
        model.page = .ahead
        try render(PaperView(model: model), size: NSSize(width: 350, height: 460), to: output.appendingPathComponent("drawer-note-ahead-350.png"))
        model.page = .todos
        // The one-time notice after updating: where the memo tab's memos went.
        try slip(SlipAlertView(symbol: "pawprint", title: L("메모 서랍"), message: MemoMove.title(.current),
                               detail: MemoMove.body(count: model.memos.count, shortcut: DrawerShortcut.standard.text, language: .current),
                               choices: [.init(title: L("나중에"), isCancel: true), .init(title: L("서랍 열기"), role: .primary, isDefault: true)],
                               cat: .curious, width: .medium) { _ in },
                 to: output.appendingPathComponent("drawer-move-notice.png"))
    }

    /// The text menu of a memo being typed, as the app makes it: a real text view's menu for a right-click (the
    /// system's cut, copy, paste, spelling …) with `이 메모` added — read back into rows to draw.
    @MainActor static func textMenu(_ drawer: MemoDrawer, _ id: String) -> [DrawerMenuItem] {
        let view = DrawerTextView.KeyTextView(frame: NSRect(x: 0, y: 0, width: 200, height: 40))
        view.string = "text"
        view.extraMenu = { DrawerMenus.textSection(drawer, id) }
        view.menuFont = drawer.model.notebookFont
        let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = view
        let event = NSEvent.mouseEvent(with: .rightMouseDown, location: NSPoint(x: 10, y: 10), modifierFlags: [], timestamp: 0,
                                       windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
        defer { window.close() }
        guard let menu = view.menu(for: event) else { return [] }
        let extra = DrawerMenus.textSection(drawer, id)
        var rows: [DrawerMenuItem] = []
        var seenSection = false
        for item in menu.items {
            if item.isSeparatorItem { rows.append(.separator); continue }
            if item.isSectionHeader { seenSection = true; break }
            guard !item.isHidden, !item.title.isEmpty else { continue }
            var row = DrawerMenuItem.action(item.title, symbol: nil) {}
            if !item.keyEquivalent.isEmpty { row.key = (item.keyEquivalent, item.keyEquivalentModifierMask) }
            if let sub = item.submenu { row = .submenu(item.title, symbol: nil, sub.items.filter { !$0.isHidden && !$0.isSeparatorItem }.map { .action($0.title, symbol: nil) {} }) }
            rows.append(row)
        }
        if seenSection { while case .separator = rows.last?.kind { rows.removeLast() } }
        return rows + [.separator] + extra
    }

    @MainActor static func drawerSize(_ drawer: MemoDrawer) -> NSSize {
        NSSize(width: MemoDrawerView.shadowRoom + MemoDrawerView.tabsWidth + drawer.width, height: 820)
    }
}
