import AppKit
import PaperCore
import SwiftUI

/// A to-do's right-click menu, the same on Windows (main.ts `rowMenuTemplate`), in groups:
/// 고치기 · 알림 · 마감 · 시간 · 완료 | 이거 집중 ▸ | 내일 하기 · 날짜 바꾸기 ▸ · 언젠가로 · 오늘 꼭 하나 |
/// 스페이스로 옮기기 ▸ · 위로 · 아래로 | 달력에 넣기 | 지우기. Each row has its icon (the same meaning as the Windows
/// one, see docs/icons.md), and the row's own keys (NoteWindow `listKey`) are shown beside what they do. Built as
/// `DrawerMenuItem`s so the snapshots draw the same rows the app shows.
@MainActor
enum TaskRowMenu {
    /// What the row does that the model doesn't (the row's own editor and its place in the list).
    struct Actions {
        var edit: () -> Void
        var reminder: () -> Void
        var deadline: () -> Void
        var time: () -> Void
        var calendar: () -> Void
        var moveUp: () -> Void
        var moveDown: () -> Void
    }

    /// The row's keys, as NSMenu takes them (shown in the menu; the note takes them when the row is picked).
    enum Key {
        static let edit = ("\r", NSEvent.ModifierFlags())
        static let toggle = (" ", NSEvent.ModifierFlags())
        static let tomorrow = (String(UnicodeScalar(NSRightArrowFunctionKey)!), NSEvent.ModifierFlags.option)
        static let someday = (String(UnicodeScalar(NSDownArrowFunctionKey)!), NSEvent.ModifierFlags.option)
        static let up = (String(UnicodeScalar(NSUpArrowFunctionKey)!), NSEvent.ModifierFlags.command)
        static let down = (String(UnicodeScalar(NSDownArrowFunctionKey)!), NSEvent.ModifierFlags.command)
        static let delete = (String(UnicodeScalar(NSBackspaceCharacter)!), NSEvent.ModifierFlags())
    }

    static func items(_ model: AppModel, item: TodoItem, onShelf: Bool, actions: Actions,
                      now: Date = Date()) -> [DrawerMenuItem] {
        let open = !item.isCompleted
        var first: [DrawerMenuItem] = [
            .action(L("고치기"), symbol: "pencil", key: Key.edit, keyText: "↩", actions.edit),
            .action(item.reminderAt == nil ? L("알림 설정…") : L("알림 고치기…"), symbol: "bell", actions.reminder),
            .action(item.dueDate == nil ? L("마감 정하기…") : L("마감 바꾸기…"), symbol: "flag", actions.deadline),
        ]
        // 1.39: a time on its day — not for a task on 언젠가, which has no day.
        if open && TimeBlock.day(of: item, now: now) != nil {
            first.append(.action(L("시간 정하기…"), symbol: "clock", actions.time))
        }
        first.append(.action(open ? L("완료 표시") : L("완료 취소"), symbol: "checkmark.square", key: Key.toggle, keyText: L("Space")) { model.toggle(item.id) })

        let focus: [DrawerMenuItem] = open ? [.submenu(L("이거 집중"), symbol: "timer", focusItems(model, item: item, now: now))] : []

        var move: [DrawerMenuItem] = []
        let dates: [DrawerMenuItem] = open ? [.submenu(L("날짜 바꾸기"), symbol: "calendar", dateItems(model, item: item, actions: actions, now: now))] : []
        if onShelf {
            move.append(.action(L("오늘 하기"), symbol: "sun.max") { model.move(item.id, to: .today) })
            move += dates
            if item.dueDate != nil {
                move.append(.action(L("언젠가로 옮기기"), symbol: "tray.and.arrow.down", key: open ? Key.someday : nil, keyText: open ? "⌥↓" : nil) {
                    model.move(item.id, to: .someday)
                })
            }
        } else {
            if open { move.append(.action(L("내일 하기"), symbol: "arrow.right", key: Key.tomorrow, keyText: "⌥→") { model.moveToTomorrow(item.id) }) }
            move += dates
            if item.dueDate == nil {
                move.append(.action(L("언젠가로 옮기기"), symbol: "tray.and.arrow.down", key: open ? Key.someday : nil, keyText: open ? "⌥↓" : nil) {
                    model.moveToLater(item.id)
                })
            }
            if open && model.dailyPickEnabled {
                let picked = model.todayPickID == item.id
                move.append(.action(L("오늘 꼭 하나"), symbol: "star", checked: picked) { model.setDailyPick(picked ? nil : item.id) })
            }
        }

        var order: [DrawerMenuItem] = []
        // 1.45: only once there's a space (W16, S19).
        if !model.todoSpaces.isEmpty { order.append(.submenu(L("스페이스로 옮기기"), symbol: "square.stack", SpaceMenus.move(model, item.id))) }
        if !onShelf {
            order += [.action(L("위로 이동"), symbol: "arrow.up", key: Key.up, keyText: "⌘↑", actions.moveUp),
                      .action(L("아래로 이동"), symbol: "arrow.down", key: Key.down, keyText: "⌘↓", actions.moveDown)]
        }

        let calendar: [DrawerMenuItem] = open ? [.action(L("달력에 넣기…"), symbol: "calendar.badge.clock", actions.calendar)] : []
        let delete: [DrawerMenuItem] = [.action(L("지우기"), symbol: "trash", key: Key.delete, keyText: "⌫", destructive: true) { model.deleteWithToast(item.id) }]

        return grouped([first, focus, move, order, calendar, delete])
    }

    /// The rows that can't be picked now: 위로 이동 on the first row, 아래로 이동 on the last.
    static func disabled(isFirst: Bool, isLast: Bool) -> Set<String> {
        Set((isFirst ? [L("위로 이동")] : []) + (isLast ? [L("아래로 이동")] : []))
    }

    /// Groups with one separator between those that aren't empty.
    static func grouped(_ groups: [[DrawerMenuItem]]) -> [DrawerMenuItem] {
        groups.filter { !$0.isEmpty }.enumerated().flatMap { index, group in index == 0 ? group : [.separator] + group }
    }

    /// 이거 집중 ▸: the Pomodoro's focus length (25분), 50분, the recent typed lengths, 직접 정하기…, 뽀모도로로.
    static func focusItems(_ model: AppModel, item: TodoItem, now: Date) -> [DrawerMenuItem] {
        var seen = Set<Int>()
        // 1.39: a task with a time today offers what's left of it first.
        let left = TimeBlock.focusMinutes(item, now: now).map { [$0] } ?? []
        let lengths = (left + [model.pomodoroSettings.focusMinutes, 50] + model.timerRecent).filter { seen.insert($0).inserted }
        return lengths.map { minutes in DrawerMenuItem.action(L("\(minutes)분"), symbol: nil) { model.focus(on: item.id, minutes: minutes) } } + [
            .separator,
            .action(L("직접 정하기…"), symbol: nil) { model.petCommand(.focusChooseLength(task: item.id)) },
            .action(L("뽀모도로로"), symbol: nil) { model.petCommand(.focusPomodoro(task: item.id)) },
        ]
    }

    /// 날짜 바꾸기 ▸: 내일 · 이번 주 금요일 · 다음 주 월요일 · 언젠가 · 날짜 고르기….
    static func dateItems(_ model: AppModel, item: TodoItem, actions: Actions, now: Date) -> [DrawerMenuItem] {
        DateMove.choices(now: now).map { choice in
            DrawerMenuItem.action(choice.title(.current), symbol: nil) {
                if choice == .pick { actions.deadline() } else { model.changeDate(item.id, to: choice) }
            }
        }
    }
}

/// The row menu (and a space's menus) as SwiftUI menu content: icons, ✓ rows, submenus and the shortcut beside a row.
/// Shown in a `.contextMenu`, the shortcuts are only drawn and taken while the menu is open.
struct RowMenuContent: View {
    let items: [DrawerMenuItem]
    /// Rows drawn greyed out (by title).
    var disabled: Set<String> = []

    var body: some View {
        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
            switch item.kind {
            case .separator: Divider()
            case .action:
                Group {
                    if item.checked {
                        Toggle(isOn: Binding(get: { true }, set: { _ in item.action() })) { label(item) }
                    } else {
                        Button(role: item.destructive ? .destructive : nil, action: item.action) { label(item) }
                    }
                }
                .disabled(disabled.contains(item.title))
                .modifier(RowMenuShortcut(key: item.key))
            case .submenu(let sub):
                Menu { RowMenuContent(items: sub) } label: { label(item) }
            default: EmptyView()
            }
        }
    }

    @ViewBuilder private func label(_ item: DrawerMenuItem) -> some View {
        if let dot = item.dot {
            Label { Text(item.title) } icon: { Image(nsImage: PaperTheme.spaceDot(dot)) }.labelStyle(.titleAndIcon)
        } else if let symbol = item.symbol {
            Label(item.title, systemImage: symbol).labelStyle(.titleAndIcon)
        } else {
            Text(item.title)
        }
    }
}

private struct RowMenuShortcut: ViewModifier {
    let key: (String, NSEvent.ModifierFlags)?

    func body(content: Content) -> some View {
        if let (text, mask) = key, let character = text.first {
            content.keyboardShortcut(KeyEquivalent(character), modifiers: Self.modifiers(mask))
        } else {
            content
        }
    }

    static func modifiers(_ mask: NSEvent.ModifierFlags) -> EventModifiers {
        var out: EventModifiers = []
        if mask.contains(.command) { out.insert(.command) }
        if mask.contains(.option) { out.insert(.option) }
        if mask.contains(.shift) { out.insert(.shift) }
        if mask.contains(.control) { out.insert(.control) }
        return out
    }
}
