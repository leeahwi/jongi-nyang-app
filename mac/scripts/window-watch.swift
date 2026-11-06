// #217: watches every window on the Mac while a check runs, and notes each one of a test process that is on a screen.
//
//   window-watch <log> <path prefix> [<path prefix> …]
//
// A test process is one whose program lies under a prefix (scripts/window-watch.sh gives this checkout's .build, where
// every test copy and bench is built), or any app whose bundle id is a test copy's (com.noa.PaperTodo.<…>). Every 100 ms it lists the windows (CGWindowList) and checks each shown one
// against every display's bounds — the bounds the window server has, not where the app meant to put it (macOS pulls a
// titled window at x -40,000 back onto a screen). It also notes when a test process becomes the frontmost app, and, as
// a hint, when the input-source indicator's process shows a window. Lines in <log>:
//
//   seen <pid> <program> · in <folder>       a test process, the first time one of its windows is listed, with its
//                                            working folder (#250: the checkout it was run from)
//   on-screen <s> <pid> <name> layer <n> "<title>" x y w h
//   off-screen <s> …                         the same for a shown window that touches no display (where it really is)
//   front <s> <pid> <name>                   a test process became the frontmost app
//   system <s> <name> "<title>" x y w h       the input-source indicator (or its menu agent) showed a window
//   end <s> on-screen <n> off-screen <n> front <n> system <n>
//
// SIGTERM or SIGINT ends the watch (the `end` line); scripts/window-watch.sh reads the log.
import AppKit
import CoreGraphics
import Darwin

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: window-watch <log> <path prefix> [<path prefix> …]\n".data(using: .utf8)!)
    exit(2)
}
let prefixes = args.dropFirst(2).map { $0.hasSuffix("/") ? $0 : $0 + "/" }
FileManager.default.createFile(atPath: args[1], contents: nil)
guard let log = FileHandle(forWritingAtPath: args[1]) else { exit(2) }
let started = Date()
func say(_ line: String) {
    log.write((line + "\n").data(using: .utf8)!)
}
func elapsed() -> String { String(format: "%.1f", Date().timeIntervalSince(started)) }

var programs: [pid_t: String?] = [:]
/// The program of a pid, if it is a test process (cached; a pid is not reused within a run's minutes).
func testProgram(_ pid: pid_t) -> String? {
    if let known = programs[pid] { return known }
    var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    let path = length > 0 ? String(cString: buffer) : ""
    // Also any test copy by its bundle id (com.noa.PaperTodo.<something>; never the installed app's own id), wherever
    // it was built.
    let bundle = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? ""
    let copy = bundle.hasPrefix("com.noa.PaperTodo.")
    let match = prefixes.contains { path.hasPrefix($0) } || copy ? "\(path)\(copy ? " (\(bundle))" : "")" : nil
    programs[pid] = match
    if let match { say("seen \(pid) \(match) · in \(folder(pid))") }
    return match
}

/// The folder a pid works in, or "?".
func folder(_ pid: pid_t) -> String {
    var info = proc_vnodepathinfo()
    let size = Int32(MemoryLayout<proc_vnodepathinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &info, size) == size else { return "?" }
    return withUnsafeBytes(of: info.pvi_cdir.vip_path) { raw in String(cString: raw.bindMemory(to: CChar.self).baseAddress!) }
}

func displays() -> [CGRect] {
    var count: UInt32 = 0
    var ids = [CGDirectDisplayID](repeating: 0, count: 32)
    guard CGGetOnlineDisplayList(32, &ids, &count) == .success, count > 0 else { return [] }
    return ids.prefix(Int(count)).map { CGDisplayBounds($0) }
}

let indicator: Set<String> = ["TextInputSwitcher", "TextInputMenuAgent"]
var screens = displays()
if screens.isEmpty { say("system 0.0 - \"the displays could not be listed\" 0 0 0 0") }
var noted = Set<String>()
var systemSeen = Set<Int>()
var counts = (onScreen: 0, offScreen: 0, front: 0, system: 0)
var lastFront: pid_t = 0
var tick = 0

func look() {
    tick += 1
    if tick % 50 == 0 { screens = displays() }
    let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
    var systemNow = Set<Int>()
    for info in list {
        guard (info[kCGWindowIsOnscreen as String] as? Bool) == true,
              let pid = info[kCGWindowOwnerPID as String] as? Int32,
              let raw = info[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: raw as CFDictionary),
              bounds.width > 1, bounds.height > 1 else { continue }
        let onScreen = screens.contains(where: { $0.intersects(bounds) })
        let name = info[kCGWindowOwnerName as String] as? String ?? "?"
        let title = info[kCGWindowName as String] as? String ?? ""
        let number = info[kCGWindowNumber as String] as? Int ?? 0
        let place = "\(Int(bounds.minX)) \(Int(bounds.minY)) \(Int(bounds.width)) \(Int(bounds.height))"
        if indicator.contains(name) && onScreen {
            systemNow.insert(number)
            if !systemSeen.contains(number) {
                counts.system += 1
                say("system \(elapsed()) \(name) \"\(title)\" \(place)")
            }
            continue
        }
        guard testProgram(pid) != nil else { continue }
        let key = "\(number) \(place)"
        guard noted.insert(key).inserted else { continue }
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        if !onScreen {
            counts.offScreen += 1
            say("off-screen \(elapsed()) \(pid) \(name) layer \(layer) \"\(title)\" \(place)")
        } else {
            counts.onScreen += 1
            say("on-screen \(elapsed()) \(pid) \(name) layer \(layer) \"\(title)\" \(place)")
        }
    }
    systemSeen = systemNow
    if let front = NSWorkspace.shared.frontmostApplication?.processIdentifier, front != lastFront {
        lastFront = front
        if testProgram(front) != nil {
            counts.front += 1
            say("front \(elapsed()) \(front) \(NSWorkspace.shared.frontmostApplication?.localizedName ?? "?")")
        }
    }
}

nonisolated(unsafe) var stopRequested = false
signal(SIGTERM) { _ in stopRequested = true }
signal(SIGINT) { _ in stopRequested = true }
// The run loop turns between looks, so the frontmost app (NSWorkspace) is kept up to date.
while !stopRequested {
    look()
    RunLoop.main.run(until: Date().addingTimeInterval(0.1))
}
look()
say("end \(elapsed()) on-screen \(counts.onScreen) off-screen \(counts.offScreen) front \(counts.front) system \(counts.system)")
try? log.close()
