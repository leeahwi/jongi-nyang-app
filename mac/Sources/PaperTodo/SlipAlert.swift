import AppKit
import PaperCore
import SwiftUI

/// The app's questions (language, import, storage folder, quitting with unsaved changes …) on a
/// slip with neutral tape instead of the system alert. File pickers stay the system's.
@MainActor
enum SlipAlert {
    struct Choice {
        let title: String
        var role: SlipButtonStyle.Role = .ghost
        /// Return picks it.
        var isDefault = false
        /// Esc picks it.
        var isCancel = false
        /// Drawn on the footer's left, apart from the others (a destructive choice, like 바꾸기).
        var leading = false
    }

    /// Shows the question and waits; returns the index of the choice picked. `replacesList` (#253,
    /// docs/plans/widget-ask-cases.json `questions`): its answer replaces the whole list (a backup, a shared folder's list),
    /// or the app starts again after the list was replaced — while it waits, the day sheet's 넣기 and 되돌리기 wait too.
    /// Written on the line with the question's message.
    @discardableResult
    static func run(symbol: String, title: String, message: String, replacesList: Bool = false, detail: String? = nil, choices: [Choice],
                    cat: PetArt.Pose? = .curious, width: SlipWidth = .small) -> Int {
        let over = SlipModal.front
        let panel = ModalSlipPanel(title: title)
        var picked = choices.firstIndex { $0.isCancel } ?? max(0, choices.count - 1)
        var answered = false
        panel.show(SlipAlertView(symbol: symbol, title: title, message: message, detail: detail, choices: choices, cat: cat, width: width) { index in
            picked = index
            answered = true
            SlipModal.wake()
        })
        place(panel)
        bringForward(panel)
        SlipModal.run(panel, asked: replacesList ? .replacesList : .question, over: over) { answered }
        panel.orderOut(nil)
        return picked
    }

    /// A name asked on a slip (새 스페이스…, 1.45): the trimmed text, or nil for 취소 / Esc / nothing typed.
    static func askName(title: String, message: String, placeholder: String, initial: String = "") -> String? {
        let over = SlipModal.front
        let panel = ModalSlipPanel(title: title)
        var result: String?
        var answered = false
        panel.show(NameSlipView(title: title, message: message, placeholder: placeholder, text: initial) { name in
            result = name
            answered = true
            SlipModal.wake()
        })
        place(panel)
        bringForward(panel)
        SlipModal.run(panel, over: over) { answered }
        panel.orderOut(nil)
        let clean = result.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        return clean?.isEmpty == false ? clean : nil
    }

    /// A slip of its own (the shortcut list, #86), shown like the questions: over the window in front, till `done`.
    static func present<V: View>(title: String, _ content: (@escaping () -> Void) -> V) {
        let over = SlipModal.front
        let panel = ModalSlipPanel(title: title)
        var done = false
        panel.show(content { done = true; SlipModal.wake() })
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        if offscreen {
            panel.setFrameOrigin(NSPoint(x: -40_000, y: -40_000))
        } else {
            placeTall(panel)
        }
        bringForward(panel)
        SlipModal.run(panel, over: over) { done }
        panel.orderOut(nil)
    }

    /// The slips open now that don't wait for an answer (`open`), by their id.
    private static var opened: [String: SlipPanel] = [:]

    /// #229: a slip for choosing a setting (the times slip): it doesn't hold the app up — the desk, the note and the
    /// drawer go on working while it is up — and there is one per `id`: opening it again brings that one forward.
    /// Floating over the app's windows, it goes with the app when another app comes to the front.
    static func open<V: View>(id: String, title: String, _ content: (@escaping () -> Void) -> V) {
        if let panel = opened[id] {
            panel.orderFrontRegardless()
            panel.makeKey()
            return
        }
        let panel = SlipPanel(nonactivating: false)
        panel.title = title
        panel.level = .floating
        panel.hidesOnDeactivate = true
        panel.movesByPaper = true
        panel.show(content { [weak panel] in if let panel { close(panel) } })
        opened[id] = panel
        place(panel)
        bringForward(panel)
    }

    /// The slip open for `id` (`open`), if it is up.
    static func openSlip(_ id: String) -> SlipPanel? { opened[id] }

    /// Puts an open slip away (its 취소 · 저장 · Esc); its id can open a new one.
    static func close(_ panel: SlipPanel) {
        panel.orderOut(nil)
        opened = opened.filter { $0.value !== panel }
        // Kept until the click that closed it is done with the window.
        DispatchQueue.main.async { withExtendedLifetime(panel) {} }
    }

    /// Off every screen in a check (`PAPERTODO_OFFSCREEN`, the test copies): there the app is never brought to the front.
    /// Far off every screen in a check: `PAPERTODO_OFFSCREEN`, or any run that stays behind (`--offscreen`, #217).
    private static var offscreen: Bool { TestHooks.staysBehind || ProcessInfo.processInfo.environment["PAPERTODO_OFFSCREEN"] == "1" }

    private static func bringForward(_ panel: SlipPanel) {
        if !offscreen { TestHooks.activate() }
        panel.makeKeyAndOrderFront(nil)
    }

    private static func placeTall(_ panel: SlipPanel) {
        // A tall slip: its top near the top of the screen (above the window in front), so all of it is on screen.
        let anchor = (NSApp.keyWindow ?? NSApp.mainWindow).flatMap { $0.isVisible ? $0 : nil }
        let point = anchor.map { NSPoint(x: $0.frame.midX, y: $0.frame.maxY) } ?? NSEvent.mouseLocation
        if let area = NSScreen.at(point)?.visibleFrame {
            panel.placeSlip(topCenter: NSPoint(x: anchor?.frame.midX ?? area.midX, y: area.maxY - 24))
        }
    }

    /// Under the desk (or the note), or on the screen with the pointer; far off every screen in a check
    /// (`PAPERTODO_OFFSCREEN`, `--offscreen`: the test copies of scripts/perf*.sh and ai-check.sh).
    private static func place(_ panel: SlipPanel) {
        // On the Space the user is looking at, a full-screen desk's too: a modal slip on another Space leaves the app
        // waiting for an answer nobody can see.
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        if offscreen {
            panel.setFrameOrigin(NSPoint(x: -40_000, y: -40_000))
            return
        }
        let anchor = NSApp.keyWindow ?? NSApp.mainWindow
        if let anchor, anchor.isVisible {
            panel.placeSlip(topCenter: NSPoint(x: anchor.frame.midX, y: anchor.frame.maxY - 90))
        } else if let area = NSScreen.withPointer?.visibleFrame {
            panel.placeSlip(topCenter: NSPoint(x: area.midX, y: area.maxY - area.height / 4))
        }
    }

    /// Something went wrong: the reason and 확인.
    static func inform(symbol: String = "exclamationmark.circle", title: String, message: String, detail: String? = nil) {
        run(symbol: symbol, title: title, message: message, detail: detail,
            choices: [Choice(title: L("확인"), role: .primary, isDefault: true, isCancel: true)], cat: nil)
    }
}

/// A question's window: over every other window of the app, moved by its paper (#228).
final class ModalSlipPanel: SlipPanel {
    override var canBecomeMain: Bool { true }

    convenience init(title: String) {
        self.init(nonactivating: false)
        self.title = title
        level = .modalPanel
        movesByPaper = true
    }
}

/// #229: a question waits for its answer the way `NSApp.runModal` does — the app's other windows don't take clicks or
/// keys — but a click on one of them isn't lost without a word: the question comes to the front, shakes once (its tape
/// blinks under Reduce Motion) and the system beeps once. AppKit's own modal loop drops those clicks before anything sees
/// them, so the loop is here: inside the modal session (menus behave as they do for a question), each event in turn goes
/// to the question and the windows that work while it is up, and a press anywhere else nudges it.
///
/// #253 (docs/plans/widget-ask-cases.json): the desktop calendar widgets and their day sheet work while it is up (they
/// work when modal): looking always, putting in and taking back unless the question replaces the whole list (`waits`); a
/// line that opens the note or the desk brings it forward under the question (`cameForward`).
@MainActor
enum SlipModal {
    /// The beep of a nudge (a check counts them instead).
    static var beep: () -> Void = { NSSound.beep() }
    private static let wakeKind: Int16 = 0x5D1
    /// #253: the question waiting now, and the window it was asked over.
    private(set) static weak var current: SlipPanel?
    private(set) static weak var over: NSWindow?

    /// The window in front before a question shows (the one it is asked over).
    static var front: NSWindow? { (NSApp.keyWindow ?? NSApp.mainWindow).flatMap { $0.isVisible ? $0 : nil } }

    /// Runs `panel`'s modal session until `answered` (set by its answer, which calls `wake`); `asked`: what it is for the
    /// widgets (SlipAsking), `over`: the window it was asked over. A question asked while another waits (가져오기 →
    /// 바꾸기) gives the first one back when it is answered.
    static func run(_ panel: SlipPanel, asked: SlipMove.Asked = .question, over window: NSWindow? = nil, until answered: () -> Bool) {
        let before = (SlipAsking.shared.up, current, over)
        SlipAsking.shared.up = asked
        current = panel
        over = window
        defer {
            SlipAsking.shared.up = before.0
            current = before.1
            over = before.2
        }
        let session = NSApp.beginModalSession(for: panel)
        defer { NSApp.endModalSession(session) }
        while !answered() {
            autoreleasepool {
                guard let event = NSApp.nextEvent(matching: .any, until: .distantFuture, inMode: .modalPanel, dequeue: true) else { return }
                if event.type == .applicationDefined, event.subtype.rawValue == wakeKind { return }
                if nudges(event, panel) { return panel.nudge() }
                if holds(event, panel) { return }
                NSApp.sendEvent(event)
                NSApp.updateWindows()
            }
        }
    }

    /// Lets `run` look at `answered` again (an answer may come from outside an event, a moment later).
    static func wake() {
        guard let event = NSEvent.otherEvent(with: .applicationDefined, location: .zero, modifierFlags: [], timestamp: 0,
                                             windowNumber: 0, context: nil, subtype: wakeKind, data1: 0, data2: 0) else { return }
        NSApp.postEvent(event, atStart: false)
    }

    /// #253: `press` on a widget or its day sheet has to wait for the answer now (SlipMove.widgetPress): the question comes
    /// forward and shakes once without taking the keys (the sheet goes away when it loses them, its text kept) — true.
    static func waits(_ press: SlipMove.WidgetPress) -> Bool {
        guard SlipMove.widgetPress(press, up: SlipAsking.shared.up) == .waits else { return false }
        current?.nudge(takingKey: false)
        return true
    }

    /// #253: a widget's line brought `window` forward (the note, the desk) while a question waits: the question stays over
    /// it — or nudges, when it is the window the question was asked over.
    static func cameForward(_ window: NSWindow?) {
        switch SlipMove.widgetPress(.open, up: SlipAsking.shared.up, over: window != nil && window === over) {
        case .nudge: current?.nudge()
        case .front: current?.orderFrontRegardless()
        case .works, .waits: break
        }
    }

    /// An event for another window of the app while the question is up: not the question or a window of its own, nor one
    /// that works while a question waits (a ringing alarm, the desktop calendar widgets and their day sheet, #253). Events
    /// for no window (the system's) go on.
    static func holds(_ event: NSEvent, _ panel: NSWindow) -> Bool {
        guard let window = event.window else { return false }
        var owner: NSWindow? = window
        while let current = owner {
            if current === panel { return false }
            owner = current.parent ?? current.sheetParent
        }
        return !window.worksWhenModal
    }

    /// A press that the question holds (slip-move-cases.json `clicks`), on a window that shows — not the menu bar's or the
    /// status item's, which go quiet as they always did.
    static func nudges(_ event: NSEvent, _ panel: NSWindow) -> Bool {
        guard [.leftMouseDown, .rightMouseDown, .otherMouseDown].contains(event.type), holds(event, panel), let window = event.window else { return false }
        return window.isVisible && window.level != .mainMenu && window.level != .statusBar
    }
}

/// #253: what is up for the desktop calendar widgets and their day sheet (the sheet's 넣기 dims while it is
/// `.replacesList`). Set by SlipModal.run.
@MainActor
final class SlipAsking: ObservableObject {
    static let shared = SlipAsking()
    @Published fileprivate(set) var up: SlipMove.Asked = .none
}

struct SlipAlertView: View {
    let symbol: String
    let title: String
    let message: String
    var detail: String?
    let choices: [SlipAlert.Choice]
    var cat: PetArt.Pose?
    var width: SlipWidth = .small
    var onPick: (Int) -> Void = { _ in }

    var body: some View {
        PaperSlip(kind: .confirm, width: width.rawValue) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .confirm, symbol: symbol, title: title)
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(message.keepingParticles)
                            .font(.system(size: 15))
                            .lineSpacing(3)
                            .foregroundStyle(PaperTheme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            // #228: the question's words are paper to drag by (the detail stays selectable).
                            .allowsHitTesting(false)
                        if let detail, !detail.isEmpty {
                            Text(detail.keepingParticles)
                                .font(.system(size: 12.5, weight: .medium))
                                .lineSpacing(2)
                                .foregroundStyle(PaperTheme.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if let cat, let image = PetArt.image(cat) {
                        Image(nsImage: image).resizable().scaledToFit().frame(width: 54, height: 54)
                            .padding(.top, -6)
                            .accessibilityHidden(true)
                            .allowsHitTesting(false)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 4)
                SlipFooter {
                    // Esc: the choice that keeps things as they are.
                    if let cancel = choices.firstIndex(where: { $0.isCancel }) {
                        Button("") { onPick(cancel) }
                            .keyboardShortcut(.cancelAction)
                            .opacity(0)
                            .frame(width: 0, height: 0)
                            .accessibilityHidden(true)
                    }
                    ForEach(Array(choices.enumerated()).filter { $0.element.leading }, id: \.offset) { index, choice in
                        button(index, choice)
                    }
                } trailing: {
                    // The buttons may not all fit on one line in English and Dutch: they wrap.
                    FlowLayout(spacing: 6, lineSpacing: 6, trailing: true) {
                        ForEach(Array(choices.enumerated()).filter { !$0.element.leading }, id: \.offset) { index, choice in
                            button(index, choice)
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    @ViewBuilder
    private func button(_ index: Int, _ choice: SlipAlert.Choice) -> some View {
        let base = Button(choice.title) { onPick(index) }
            .buttonStyle(SlipButtonStyle(role: choice.role, key: choice.isDefault ? "↩" : nil))
        if choice.isDefault { base.keyboardShortcut(.defaultAction) } else { base }
    }
}

/// The name slip: a line to type in, 취소 and 만들기 (Return).
struct NameSlipView: View {
    let title: String
    let message: String
    let placeholder: String
    @State var text: String
    var onDone: (String?) -> Void = { _ in }
    @FocusState private var focused: Bool

    var body: some View {
        PaperSlip(kind: .confirm, width: SlipWidth.small.rawValue) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .confirm, symbol: "square.stack", title: title)
                VStack(alignment: .leading, spacing: 8) {
                    Text(message)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(PaperTheme.ink2)
                        .allowsHitTesting(false)
                    TextField(placeholder, text: $text)
                        .textFieldStyle(.plain)
                        .font(.system(size: 15))
                        .foregroundStyle(PaperTheme.ink)
                        .focused($focused)
                        .onSubmit { if !trimmed.isEmpty { onDone(text) } }
                        .padding(.horizontal, 10)
                        .frame(height: 32)
                        .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(focused ? PaperTheme.sage : PaperTheme.rule, lineWidth: 1.5) }
                        .accessibilityLabel(message)
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 4)
                SlipFooter {
                    Button("") { onDone(nil) }
                        .keyboardShortcut(.cancelAction)
                        .opacity(0)
                        .frame(width: 0, height: 0)
                        .accessibilityHidden(true)
                } trailing: {
                    HStack(spacing: 6) {
                        Button(L("취소")) { onDone(nil) }.buttonStyle(SlipButtonStyle(role: .ghost))
                        Button(L("만들기")) { onDone(text) }
                            .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
                            .disabled(trimmed.isEmpty)
                    }
                }
            }
        }
        .onAppear { focused = true }
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
}
