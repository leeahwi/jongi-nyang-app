// Snapshot runs on a Mac (#92): watches the windows of one process and stops at the first one on a screen.
//
//   offscreen-watch <pid>
//   offscreen-watch --who <pid>      only the `pid … · in …` part, for that pid (test/offscreenWatch.test.ts)
//
// Every 15 ms it lists the windows <pid> owns (CGWindowList) and checks each against every display's bounds. A window
// that touches a display: lines on stderr, exit 3. The process gone: exit 0. The first line is
//
//   on-screen: "<title>" x y w h · window <number> layer <n> alpha <a> · pid <owner pid> <program> · in <working folder>
//
// (#250) so a hit says which run the window belongs to: the owner's pid from the window list, its program and its
// working folder (both name the checkout, e.g. …/worktrees/<name>/windows/node_modules/electron/…). Then `window:` lines
// list every window the pid has at that moment, shown or not, so the one that came on can be told from the app's own
// (their numbers are in the app's window log, PAPERTODO_WINDOW_LOG).
// tools/snapshot.mjs builds it (swiftc) and runs it beside Electron; Electron is killed when it exits 3.
import CoreGraphics
import Darwin
import Foundation

let arguments = CommandLine.arguments
let who = arguments.count == 3 && arguments[1] == "--who"
guard arguments.count == 2 || who, let pid = Int32(arguments[arguments.count - 1]) else {
    FileHandle.standardError.write("usage: offscreen-watch [--who] <pid>\n".data(using: .utf8)!)
    exit(2)
}

func say(_ line: String) { FileHandle.standardError.write((line + "\n").data(using: .utf8)!) }

/// Which run a pid is: its program and working folder.
func owner(_ pid: pid_t) -> String { "pid \(pid) \(program(pid)) · in \(folder(pid))" }

func displays() -> [CGRect] {
    var count: UInt32 = 0
    var ids = [CGDirectDisplayID](repeating: 0, count: 32)
    guard CGGetOnlineDisplayList(32, &ids, &count) == .success, count > 0 else {
        // No displays to check against: a watch that can't see stops the run rather than letting it pass.
        say("on-screen: the displays could not be listed")
        exit(3)
    }
    return ids.prefix(Int(count)).map { CGDisplayBounds($0) }
}

/// The program a pid runs, or "?".
func program(_ pid: pid_t) -> String {
    var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    return proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 ? String(cString: buffer) : "?"
}

/// The folder a pid works in, or "?".
func folder(_ pid: pid_t) -> String {
    var info = proc_vnodepathinfo()
    let size = Int32(MemoryLayout<proc_vnodepathinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &info, size) == size else { return "?" }
    return withUnsafeBytes(of: info.pvi_cdir.vip_path) { raw in String(cString: raw.bindMemory(to: CChar.self).baseAddress!) }
}

func describe(_ info: [String: Any], _ bounds: CGRect) -> String {
    let title = info[kCGWindowName as String] as? String ?? ""
    let number = info[kCGWindowNumber as String] as? Int ?? 0
    let layer = info[kCGWindowLayer as String] as? Int ?? 0
    let alpha = info[kCGWindowAlpha as String] as? Double ?? 1
    return "\"\(title)\" \(Int(bounds.minX)) \(Int(bounds.minY)) \(Int(bounds.width)) \(Int(bounds.height)) · window \(number) layer \(layer) alpha \(String(format: "%.2f", alpha))"
}

func frameOf(_ info: [String: Any]) -> CGRect? {
    guard let raw = info[kCGWindowBounds as String] as? NSDictionary else { return nil }
    return CGRect(dictionaryRepresentation: raw as CFDictionary)
}

if who {
    print(owner(pid))
    exit(kill(pid, 0) == 0 ? 0 : 1)
}

var screens = displays()
var tick = 0
while kill(pid, 0) == 0 {
    tick += 1
    if tick % 64 == 0 { screens = displays() } // a display plugged in during the run
    let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
    let own = list.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == pid }
    for info in own {
        guard let bounds = frameOf(info), bounds.width > 1, bounds.height > 1 else { continue }
        // A window that is not shown (ordered out) can sit anywhere; only shown ones count.
        guard (info[kCGWindowIsOnscreen as String] as? Bool) == true else { continue }
        if screens.contains(where: { $0.intersects(bounds) }) {
            say("on-screen: \(describe(info, bounds)) · \(owner(info[kCGWindowOwnerPID as String] as? Int32 ?? pid))")
            for other in own {
                guard let place = frameOf(other) else { continue }
                let shown = (other[kCGWindowIsOnscreen as String] as? Bool) == true
                say("  window: \(describe(other, place))\(shown ? " shown" : "")")
            }
            exit(3)
        }
    }
    usleep(15_000)
}
exit(0)
