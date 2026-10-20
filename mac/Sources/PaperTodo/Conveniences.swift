import AppKit
import PaperCore
import ServiceManagement

/// 시스템 알림으로도 보내기 (1.38): 놓친 것만 · 항상 · 끄기.
enum SystemNoticeMode: String, CaseIterable, Identifiable {
    case missed, always, off
    var id: String { rawValue }
}

/// 화면 오른쪽 · 왼쪽에 붙이기.
enum DockSide: String { case left, right }

/// 오늘 꼭 하나: the task and the logical day it was picked for.
struct DailyPick: Codable, Equatable {
    var id: UUID
    var day: String
}

// MARK: - 편의 기능 (1.38): the model's side

extension AppModel {
    // MARK: 내일 하기 · 날짜 바꾸기

    /// → 내일: due tomorrow (off 언젠가 and today's pin), with the toast and 되돌리기.
    func moveToTomorrow(_ id: UUID, now: Date = Date()) {
        move(id, to: .day(DateMove.tomorrow(now: now)), now: now)
    }

    /// ⌥→ / ⌥←: a day later or earlier (see DateMove.shift).
    func shiftDue(_ id: UUID, by delta: Int, now: Date = Date()) {
        guard let item = items.first(where: { $0.id == id }),
              let key = DateMove.shift(item.dueDate, by: delta, now: now) else { return }
        move(id, to: .day(key), now: now)
    }

    /// 날짜 바꾸기 ▸ (not 날짜 고르기…, which opens the deadline editor on the row).
    func changeDate(_ id: UUID, to choice: DateMove.Choice, now: Date = Date()) {
        switch choice {
        case .tomorrow(let key), .friday(let key), .nextMonday(let key): move(id, to: .day(key), now: now)
        case .someday: move(id, to: .someday, now: now)
        case .pick: break
        }
    }

    // MARK: 되돌리기 toasts

    /// A row's 지우기 (trash, ⌫, the menu): gone, with `지웠어요 · 되돌리기` (⌘Z works too).
    func deleteWithToast(_ id: UUID) {
        guard let item = items.first(where: { $0.id == id }) else { return }
        let order = items.map(\.id)
        delete(id)
        let after = history.notebook
        offerUndo(symbol: "trash", text: L("지웠어요"), after: after) { [weak self] in
            self?.restoreTasks([item], order: order)
        }
    }

    /// 모두 끝냄 (two or more at once): one undo step, `3개 끝냈어요 · 되돌리기`.
    func completeTasks(_ ids: [UUID]) {
        let open = ids.filter { id in items.contains { $0.id == id && !$0.isCompleted } }
        guard !open.isEmpty else { return }
        guard open.count > 1 else { return completeTask(open[0]) }
        let now = Date()
        mutate { history in history.batch { notebook in for id in open { notebook.toggle(id: id, now: now) } } }
        let after = history.notebook
        offerUndo(symbol: "checkmark", text: L("\(open.count)개 끝냈어요"), after: after) { [weak self] in
            guard let self else { return }
            self.mutate { history in
                history.batch { notebook in
                    for id in open where notebook.items.contains(where: { $0.id == id && $0.isCompleted }) { notebook.toggle(id: id) }
                }
            }
        }
    }

    /// 메모 지우기: `메모를 지웠어요 · 되돌리기`.
    func deleteMemoWithToast(_ id: String) {
        deleteMemo(id)
        guard lastDeletedMemo?.id == id else { return }
        var toast = PaperToast(symbol: "trash", text: L("메모를 지웠어요"))
        toast.action = L("되돌리기")
        toast.perform = { [weak self] in
            self?.restoreDeletedMemo()
            self?.toast = nil
        }
        self.toast = toast
    }

    /// The toast with 되돌리기: right after the change it's the last undo step; later only these tasks go back.
    func offerUndo(symbol: String, text: String, after: Notebook, restore: @escaping () -> Void) {
        var toast = PaperToast(symbol: symbol, text: text)
        toast.action = L("되돌리기")
        toast.undoable = true
        toast.perform = { [weak self] in
            guard let self else { return }
            if self.notebookNow == after { self.undo() } else { restore() }
            self.toast = nil
        }
        self.toast = toast
    }

    /// Deleted tasks back where they were.
    func restoreTasks(_ restored: [TodoItem], order: [UUID]) {
        mutate { $0.restore(restored, order: order) }
    }

    // MARK: 저녁 정리

    /// Moves the chosen tasks to tomorrow or 언젠가 as one undo step, with the toast.
    func sweep(_ ids: [UUID], someday: Bool, now: Date = Date()) {
        let chosen = ids.filter { id in items.contains { $0.id == id && !$0.isCompleted } }
        guard !chosen.isEmpty else { return }
        let tomorrow = DateMove.tomorrow(now: now)
        let before = items.filter { chosen.contains($0.id) }
        mutate { history in
            history.batch { notebook in
                for id in chosen {
                    if someday { notebook.saveForLater(id: id) } else { notebook.schedule(id: id, dueDate: tomorrow) }
                }
            }
        }
        let after = history.notebook
        offerUndo(symbol: someday ? "tray" : "arrow.right", text: Sweep.movedText(count: chosen.count, someday: someday, language: .current),
                  after: after) { [weak self] in
            self?.mutate { history in
                history.batch { notebook in for item in before { notebook.restorePlace(id: item.id, dueDate: item.dueDate, shelf: item.shelf) } }
            }
        }
    }

    // MARK: 오늘 꼭 하나

    /// Today's one thing, while it's today's.
    var todayPickID: UUID? {
        guard dailyPickEnabled, let pick = dailyPick, pick.day == Archive.dayKey(Date()) else { return nil }
        return pick.id
    }

    /// The input line asks for it: the setting is on and nothing is picked today.
    var asksForDailyPick: Bool { dailyPickEnabled && todayPickID == nil }

    func setDailyPick(_ id: UUID?) {
        dailyPick = id.map { DailyPick(id: $0, day: Archive.dayKey(Date())) }
    }

    // MARK: 어제부터

    /// The day turned (4 a.m.) or the app woke: stamps catch up without an undo step.
    func stampCarried(now: Date = Date()) {
        stampToday(now: now)
    }
}

extension AppModel {
    /// 내일로 미루기 / 내일로 on a reminder: due tomorrow, the reminder cleared, one undo step with the toast.
    func moveTasksToTomorrow(_ ids: [UUID], now: Date = Date()) {
        let open = ids.filter { id in items.contains { $0.id == id && !$0.isCompleted } }
        guard !open.isEmpty else { return }
        let tomorrow = DateMove.tomorrow(now: now)
        mutate { history in
            history.batch { notebook in
                for id in open {
                    notebook.schedule(id: id, dueDate: tomorrow)
                    notebook.setReminder(id: id, at: nil)
                }
            }
        }
        var toast = PaperToast(symbol: "arrow.right",
                               text: open.count == 1 ? DateMove.movedText(tomorrow, now: now, language: .current)
                                   : Sweep.movedText(count: open.count, someday: false, language: .current))
        toast.action = L("되돌리기")
        toast.undoable = true
        let after = notebookNow
        toast.perform = { [weak self] in
            guard let self else { return }
            if self.notebookNow == after { self.undo() }
            self.toast = nil
        }
        self.toast = toast
    }
}

extension AppModel {
    /// 로그인할 때 같이 열기 (Settings → 알림 → 시작, the guide's last card, the cat's question).
    var loginItemOn: Bool { SMAppService.mainApp.status == .enabled }
    var guideSeen: Bool { preferences.bool(forKey: "guide.seen") }

    /// Adds or removes 종이냥 as a login item (never for previews, snapshots or a test copy started with --storage).
    func setLoginItem(_ on: Bool) {
        guard !isolatedRun else { return }
        let service = SMAppService.mainApp
        if on, service.status != .enabled { try? service.register() }
        if !on, service.status == .enabled { try? service.unregister() }
    }
}
