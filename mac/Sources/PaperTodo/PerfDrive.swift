import AppKit

/// `--perf-drive <file>` (#217; scripts/perf.sh, perf-audit.sh, perf-idle.sh, ai-check.sh — never a release build): the
/// check's input, given from inside the app. The script appends one command a line to the file; the app reads each as
/// it comes (a file watch, no polling) and does it here, in order:
///
///   key <keycode> [cmd+shift+opt+ctrl]   a key as the app's front window would take it
///   type <ms between keys> <text>        each character into the field that has the cursor
///   desk <pane>                          the desk on that pane (a click on its sidebar)
///   ai-connect                           Settings › AI 연결 › ‘Claude 데스크톱에 연결’
///
/// Nothing goes through the system: no event is posted, the app is never made active and no window of it takes the
/// keyboard (TestHooks.staysBehind), so no input method or system window comes up on the person's screen. The keys are
/// built here and handed to the window the way AppKit would (its key equivalents, the note's list keys, the text
/// view's commands); characters are inserted into the text view (`insertText`), not read through an input method.
/// Each is timed like a real key (PerfProbe: `key <code> <chars>` up to the next idle), so the scripts read the same
/// lines as before. After every command, a window of the app that is on a screen is moved off and written to the log
/// (`onscreen …`): the scripts stop on it.
@MainActor
enum PerfDrive {
    private static var source: DispatchSourceFileSystemObject?
    private static var handle: FileHandle?
    private static var pending = ""
    private static var queue: [String] = []
    private static var running = false
    private static weak var model: AppModel?
    /// The window last made key (in a check's run none becomes key): where a key would go, as long as it's shown.
    private static weak var keyWindow: NSWindow?

    static func wouldBeKey(_ window: NSWindow) {
        if TestHooks.staysBehind { keyWindow = window }
    }

    static func start(arguments: [String], model: AppModel) {
        guard let index = arguments.firstIndex(of: "--perf-drive"), arguments.indices.contains(index + 1) else { return }
        let path = arguments[index + 1]
        if !FileManager.default.fileExists(atPath: path) { FileManager.default.createFile(atPath: path, contents: nil) }
        guard let handle = FileHandle(forReadingAtPath: path) else { return }
        self.handle = handle
        self.model = model
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: handle.fileDescriptor, eventMask: [.extend, .write], queue: .main)
        source.setEventHandler { MainActor.assumeIsolated { read() } }
        source.resume()
        self.source = source
        read()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { keepOffScreens() }
    }

    private static func read() {
        guard let data = try? handle?.readToEnd(), !data.isEmpty else { return }
        pending += String(decoding: data, as: UTF8.self)
        while let end = pending.firstIndex(of: "\n") {
            let line = String(pending[..<end]).trimmingCharacters(in: .whitespaces)
            pending = String(pending[pending.index(after: end)...])
            if !line.isEmpty { queue.append(line) }
        }
        guard !running else { return }
        running = true
        Task { @MainActor in
            while !queue.isEmpty { await run(queue.removeFirst()) }
            running = false
        }
    }

    private static func run(_ line: String) async {
        let words = line.split(separator: " ", maxSplits: 1).map(String.init)
        let rest = words.count > 1 ? words[1] : ""
        switch words[0] {
        case "key":
            let parts = rest.split(separator: " ").map(String.init)
            guard let code = parts.first.flatMap(UInt16.init) else { PerfProbe.line("drive ? \(line)"); return }
            key(code, flags: parts.count > 1 ? flags(parts[1]) : [])
        case "type":
            // The pause between keys in ms, then the text (spaces and all).
            let parts = rest.split(separator: " ", maxSplits: 1).map(String.init)
            guard parts.count == 2, let gap = Double(parts[0]) else { PerfProbe.line("drive ? \(line)"); return }
            let text = parts[1]
            for character in text {
                guard let field = frontWindow()?.firstResponder as? NSTextView else {
                    PerfProbe.line("drive no-field \(character)")
                    continue
                }
                PerfProbe.begin("key 0 \(character)")
                field.insertText(String(character), replacementRange: NSRange(location: NSNotFound, length: 0))
                try? await Task.sleep(for: .milliseconds(Int(gap)))
            }
        case "desk":
            guard let pane = DeskPane(rawValue: rest) else { PerfProbe.line("drive ? \(line)"); return }
            PerfProbe.begin("click")
            model?.showDesk(pane)
        case "ai-connect":
            PerfProbe.begin("click")
            // Later, from the run loop (not the main queue, which a modal slip would hold up): with no Claude Desktop it
            // asks on a modal slip, and the next commands answer it.
            RunLoop.main.perform { MainActor.assumeIsolated { model?.ai?.connectDesktop() } }
        default:
            PerfProbe.line("drive ? \(line)")
        }
        // Let what the command set off run before the next one and the look at the windows.
        try? await Task.sleep(for: .milliseconds(30))
        keepOffScreens()
    }

    private static func flags(_ text: String) -> NSEvent.ModifierFlags {
        var flags: NSEvent.ModifierFlags = []
        for part in text.split(separator: "+") {
            switch part {
            case "cmd": flags.insert(.command)
            case "shift": flags.insert(.shift)
            case "opt": flags.insert(.option)
            case "ctrl": flags.insert(.control)
            default: break
            }
        }
        return flags
    }

    /// The characters of the keys the checks use (US layout), and the arrows' function keys.
    private static func characters(_ code: UInt16) -> String {
        let map: [UInt16: String] = [
            0: "a", 2: "d", 3: "f", 6: "z", 13: "w", 16: "y", 18: "1", 19: "2", 20: "3", 29: "0", 35: "p", 43: ",", 45: "n",
            36: "\r", 76: "\r", 48: "\t", 49: " ", 51: "\u{7f}", 53: "\u{1b}",
            123: String(UnicodeScalar(NSLeftArrowFunctionKey)!), 124: String(UnicodeScalar(NSRightArrowFunctionKey)!),
            125: String(UnicodeScalar(NSDownArrowFunctionKey)!), 126: String(UnicodeScalar(NSUpArrowFunctionKey)!),
        ]
        return map[code] ?? ""
    }

    /// The window that would have the keys: the modal slip, else the one last made key while it's shown, else the
    /// frontmost of the app's windows that take typing (on any Space: the person may be on another one), else the note.
    static func frontWindow() -> NSWindow? {
        if let modal = NSApp.modalWindow { return modal }
        if let keyWindow, keyWindow.isVisible { return keyWindow }
        let takesKeys = { (window: NSWindow) in window is NoteWindow || window is DeskWindow || window is SlipPanel || window is DrawerPanel }
        for number in NSWindow.windowNumbers(options: [.allSpaces]) ?? [] {
            guard let window = NSApp.window(withWindowNumber: number.intValue), window.isVisible else { continue }
            if takesKeys(window) { return window }
        }
        return NSApp.windows.first { $0 is NoteWindow && $0.isVisible }
    }

    /// One key, as AppKit hands it on: the window's key equivalents (⌘ keys, a slip's default button) and the menus;
    /// the note's own list keys; a text view's command (Esc, ↩, the arrows) or the character; else the window's views.
    private static func key(_ code: UInt16, flags: NSEvent.ModifierFlags) {
        let plain = characters(code)
        let typed = flags.contains(.shift) ? plain.uppercased() : plain
        let printable = plain.unicodeScalars.allSatisfy { $0.value >= 32 && $0.value < 0xF700 }
        let window = frontWindow()
        // Timed only when something takes it (a key with nowhere to go writes `drive no-window` instead).
        if window != nil || flags.contains(.command) { PerfProbe.begin("key \(code) \(printable ? plain : "")") }
        guard let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                                           windowNumber: window?.windowNumber ?? 0, context: nil, characters: typed,
                                           charactersIgnoringModifiers: plain, isARepeat: false, keyCode: code) else { return }
        if flags.contains(.command) {
            // ⌘W closes the front window (its menu item goes to the key window, which an app behind doesn't have). As the
            // close button would: the delegate is asked first. (`performClose` does nothing for a window that can't be key.)
            if code == 13, let window {
                if window.delegate?.windowShouldClose?(window) ?? true { window.close() }
                return
            }
            if window?.performKeyEquivalent(with: event) == true { return }
            if NSApp.mainMenu?.performKeyEquivalent(with: event) != true { PerfProbe.line("drive unused key \(code) cmd") }
            return
        }
        guard let window else { PerfProbe.line("drive no-window \(code)"); return }
        if let note = window as? NoteWindow, note.handleOwnKey(event) { return }
        if window.performKeyEquivalent(with: event) { return }
        if let text = window.firstResponder as? NSTextView {
            let command: Selector? = switch code {
            case 53: #selector(NSResponder.cancelOperation(_:))
            case 36, 76: #selector(NSResponder.insertNewline(_:))
            case 48: #selector(NSResponder.insertTab(_:))
            case 51: #selector(NSResponder.deleteBackward(_:))
            case 123: #selector(NSResponder.moveLeft(_:))
            case 124: #selector(NSResponder.moveRight(_:))
            case 125: #selector(NSResponder.moveDown(_:))
            case 126: #selector(NSResponder.moveUp(_:))
            default: nil
            }
            if let command { text.doCommand(by: command) } else { text.insertText(typed, replacementRange: NSRange(location: NSNotFound, length: 0)) }
            return
        }
        window.sendEvent(event)
    }

    /// A shown window of the app on a screen: moved off at once and written down (`onscreen …`), so the check stops.
    static func keepOffScreens() {
        guard TestHooks.staysBehind else { return }
        for window in NSApp.windows where window.isVisible && window.frame.width > 1 && window.frame.height > 1 {
            // The menu bar item's window: hidden in a check (TodayWindow), though AppKit still calls it visible.
            if String(describing: type(of: window)).contains("StatusBar") { continue }
            guard NSScreen.screens.contains(where: { $0.frame.intersects(window.frame) }) else { continue }
            let frame = window.frame
            window.setFrameOrigin(NSPoint(x: frame.minX - 40_000, y: frame.minY))
            PerfProbe.line("onscreen \(type(of: window)) \"\(window.title)\" \(Int(frame.minX)) \(Int(frame.minY)) \(Int(frame.width)) \(Int(frame.height))")
        }
    }
}
