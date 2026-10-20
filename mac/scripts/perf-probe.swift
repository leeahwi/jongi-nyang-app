// The performance check's helper (scripts/perf.sh). It only ever reads or drives the one process
// whose pid it is given: CPU time, wakeups and memory from proc_pid_rusage, and keys or clicks
// posted to that pid alone (never to the frontmost app or the whole session).
import AppKit
import ApplicationServices
import Darwin

func usage(_ pid: pid_t) -> rusage_info_v4 {
    var info = rusage_info_v4()
    _ = withUnsafeMutablePointer(to: &info) { pointer in
        pointer.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V4, $0) }
    }
    return info
}

var timebase = mach_timebase_info_data_t()
mach_timebase_info(&timebase)
func seconds(_ ticks: UInt64) -> Double { Double(ticks) * Double(timebase.numer) / Double(timebase.denom) / 1e9 }

func attr(_ e: AXUIElement, _ n: String) -> AnyObject? { var v: AnyObject?; AXUIElementCopyAttributeValue(e, n as CFString, &v); return v }
func str(_ e: AXUIElement, _ n: String) -> String { (attr(e, n) as? String) ?? ((attr(e, n) as? NSNumber)?.stringValue ?? "") }
func kids(_ e: AXUIElement) -> [AXUIElement] { (attr(e, "AXChildren") as? [AXUIElement]) ?? [] }
func label(_ e: AXUIElement) -> String { [str(e, "AXTitle"), str(e, "AXDescription"), str(e, "AXValue"), str(e, "AXHelp")].filter { !$0.isEmpty }.joined(separator: " | ") }
func frame(_ e: AXUIElement) -> CGRect {
    var p = CGPoint.zero, s = CGSize.zero
    if let v = attr(e, "AXPosition") { AXValueGetValue(v as! AXValue, .cgPoint, &p) }
    if let v = attr(e, "AXSize") { AXValueGetValue(v as! AXValue, .cgSize, &s) }
    return CGRect(origin: p, size: s)
}
func all(_ e: AXUIElement, _ o: inout [AXUIElement], _ d: Int = 0) { o.append(e); if d < 120 { kids(e).forEach { all($0, &o, d + 1) } } }

let a = CommandLine.arguments
guard a.count > 2, let pid = pid_t(a[2]) else { print("usage: perf-probe <command> <pid> …"); exit(2) }
let app = AXUIElementCreateApplication(pid)

func post(_ event: CGEvent) { event.postToPid(pid) }
func click(at point: CGPoint, right: Bool = false) {
    let info = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
    let window = info.first { w in
        guard (w[kCGWindowOwnerPID as String] as? Int32) == pid, let b = w[kCGWindowBounds as String] as? [String: Double] else { return false }
        return CGRect(x: b["X"]!, y: b["Y"]!, width: b["Width"]!, height: b["Height"]!).contains(point)
    }?[kCGWindowNumber as String] as? Int64
    for type in right ? [CGEventType.rightMouseDown, .rightMouseUp] : [CGEventType.leftMouseDown, .leftMouseUp] {
        let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: right ? .right : .left)!
        if let window {
            event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: window)
            event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: window)
        }
        event.setIntegerValueField(.mouseEventClickState, value: 1)
        post(event); usleep(40_000)
    }
}

switch a[1] {
case "sample": // sample <pid> <seconds>: CPU %, wakeups per second, memory over that time
    let wait = Double(a[3]) ?? 60
    let before = usage(pid)
    let started = Date()
    Thread.sleep(forTimeInterval: wait)
    let after = usage(pid)
    let span = Date().timeIntervalSince(started)
    let cpu = seconds((after.ri_user_time + after.ri_system_time) - (before.ri_user_time + before.ri_system_time))
    let wakeups = Double((after.ri_pkg_idle_wkups + after.ri_interrupt_wkups) - (before.ri_pkg_idle_wkups + before.ri_interrupt_wkups))
    print(String(format: "cpu %.2f%% wakeups %.1f/s footprint %.1f MB written %.1f KB",
                 cpu / span * 100, wakeups / span, Double(after.ri_phys_footprint) / 1_048_576,
                 Double(after.ri_diskio_byteswritten - before.ri_diskio_byteswritten) / 1024))
case "mem": // mem <pid>
    let now = usage(pid)
    print(String(format: "footprint %.1f MB resident %.1f MB", Double(now.ri_phys_footprint) / 1_048_576, Double(now.ri_resident_size) / 1_048_576))
case "key": // key <pid> <keycode> [cmd+shift+opt+ctrl]
    var flags: CGEventFlags = []
    if a.count > 4 {
        for part in a[4].split(separator: "+") {
            switch part { case "cmd": flags.insert(.maskCommand); case "opt": flags.insert(.maskAlternate)
            case "ctrl": flags.insert(.maskControl); case "shift": flags.insert(.maskShift); default: break }
        }
    }
    for down in [true, false] {
        let event = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(a[3])!, keyDown: down)!
        event.flags = flags
        post(event); usleep(30_000)
    }
case "type": // type <pid> <text> [ms between keys]
    let gap = UInt32((a.count > 4 ? Double(a[4])! : 120) * 1000)
    for scalar in a[3].unicodeScalars {
        let chars = Array(String(scalar).utf16)
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)!
            event.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: chars)
            post(event)
            usleep(down ? 8_000 : gap)
        }
    }
case "click": // click <pid> <label> [role]: the element's centre, clicked
    let windows = (attr(app, "AXWindows") as? [AXUIElement]) ?? []
    var list: [AXUIElement] = []
    for w in windows { all(w, &list) }
    let exact = a[3].hasPrefix("=") ? String(a[3].dropFirst()) : nil
    guard let hit = list.first(where: { el in
        (exact.map { str(el, "AXTitle") == $0 || str(el, "AXDescription") == $0 } ?? label(el).contains(a[3]))
            && (a.count < 5 || str(el, "AXRole") == a[4]) && frame(el).width > 0
    }) else { print("NOT FOUND", a[3]); exit(1) }
    let f = frame(hit)
    click(at: CGPoint(x: f.midX, y: f.midY))
case "drag": // drag <pid> <x> <y> <dx>: press, move by dx in steps, release (screen points, top-left origin)
    let start = CGPoint(x: Double(a[3])!, y: Double(a[4])!), dx = Double(a[5])!
    let info = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
    let window = info.first { w in
        guard (w[kCGWindowOwnerPID as String] as? Int32) == pid, let b = w[kCGWindowBounds as String] as? [String: Double] else { return false }
        return CGRect(x: b["X"]!, y: b["Y"]!, width: b["Width"]!, height: b["Height"]!).contains(start)
    }?[kCGWindowNumber as String] as? Int64
    func send(_ type: CGEventType, _ point: CGPoint) {
        let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)!
        if let window {
            event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: window)
            event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: window)
        }
        event.setIntegerValueField(.mouseEventClickState, value: 1)
        post(event)
    }
    send(.leftMouseDown, start); usleep(120_000)
    for step in 1...10 { send(.leftMouseDragged, CGPoint(x: start.x + dx * Double(step) / 10, y: start.y)); usleep(40_000) }
    send(.leftMouseUp, CGPoint(x: start.x + dx, y: start.y))
case "rightclick": // rightclick <pid> <label>: the element's centre, right-clicked (its context menu opens)
    let windows = (attr(app, "AXWindows") as? [AXUIElement]) ?? []
    var list: [AXUIElement] = []
    for w in windows { all(w, &list) }
    guard let hit = list.first(where: { label($0).contains(a[3]) && frame($0).width > 0 }) else { print("NOT FOUND", a[3]); exit(1) }
    let f = frame(hit)
    click(at: CGPoint(x: f.midX, y: f.midY), right: true)
case "showmenu": // showmenu <pid> <label>: the element's context menu, through accessibility
    let windows = (attr(app, "AXWindows") as? [AXUIElement]) ?? []
    var list: [AXUIElement] = []
    for w in windows { all(w, &list) }
    guard let hit = list.first(where: { label($0).contains(a[3]) && frame($0).width > 0 }) else { print("NOT FOUND", a[3]); exit(1) }
    print("showmenu", AXUIElementPerformAction(hit, "AXShowMenu" as CFString).rawValue)
case "menuitem": // menuitem <pid> <title>: press an item of the menu that is open now (a context menu)
    var list: [AXUIElement] = []
    all(app, &list)
    guard let item = list.first(where: { str($0, "AXRole") == "AXMenuItem" && str($0, "AXTitle") == a[3] }) else { print("NO ITEM", a[3]); exit(1) }
    print("press", AXUIElementPerformAction(item, "AXPress" as CFString).rawValue)
case "press": // press <pid> <label> [role]: an accessibility press on the element
    let windows = (attr(app, "AXWindows") as? [AXUIElement]) ?? []
    var list: [AXUIElement] = []
    for w in windows { all(w, &list) }
    let exact = a[3].hasPrefix("=") ? String(a[3].dropFirst()) : nil
    guard let hit = list.first(where: { el in (exact.map { str(el, "AXTitle") == $0 || str(el, "AXDescription") == $0 } ?? label(el).contains(a[3]))
        && (a.count < 5 || str(el, "AXRole") == a[4]) }) else { print("NOT FOUND", a[3]); exit(1) }
    print("press", AXUIElementPerformAction(hit, "AXPress" as CFString).rawValue)
case "clickxy": // clickxy <pid> <x> <y> (screen points, top-left origin)
    click(at: CGPoint(x: Double(a[3])!, y: Double(a[4])!))
case "find": // find <pid> <label>: the element's frame
    let windows = (attr(app, "AXWindows") as? [AXUIElement]) ?? []
    var list: [AXUIElement] = []
    for w in windows { all(w, &list) }
    for el in list where label(el).contains(a[3]) { print(str(el, "AXRole"), label(el).prefix(60), frame(el)) }
case "windows": // windows <pid>: on-screen windows
    let info = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
    for w in info where (w[kCGWindowOwnerPID as String] as? Int32) == pid {
        print(w[kCGWindowNumber as String] ?? "", w[kCGWindowLayer as String] ?? "", w[kCGWindowName as String] ?? "-", w[kCGWindowBounds as String] ?? "")
    }
case "menu": // menu <pid> <top> <item> …: through the app's own menu bar
    guard let bar = attr(app, "AXMenuBar") else { print("NO MENU BAR"); exit(1) }
    var current = bar as! AXUIElement
    for (index, title) in a.dropFirst(3).enumerated() {
        var list: [AXUIElement] = []; all(current, &list)
        guard let item = list.first(where: { ["AXMenuBarItem", "AXMenuItem"].contains(str($0, "AXRole")) && str($0, "AXTitle") == title }) else {
            print("NO ITEM", title); exit(1) }
        AXUIElementPerformAction(item, "AXPress" as CFString)
        if index < a.count - 4 { usleep(300_000) }
        current = item
    }
case "front": // front <pid>
    _ = AXUIElementSetAttributeValue(app, "AXFrontmost" as CFString, kCFBooleanTrue)
case "shot": // shot <pid> <out.png> [title contains]
    let info = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
    let mine = info.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == pid && ($0[kCGWindowLayer as String] as? Int) == 0
        && (a.count < 5 || (($0[kCGWindowName as String] as? String) ?? "").contains(a[4])) }
    guard let number = mine.first?[kCGWindowNumber as String] as? Int else { print("NO WINDOW"); exit(1) }
    let task = Process(); task.launchPath = "/usr/sbin/screencapture"; task.arguments = ["-x", "-o", "-l", "\(number)", a[3]]
    try! task.run(); task.waitUntilExit()
default: print("?"); exit(2)
}
