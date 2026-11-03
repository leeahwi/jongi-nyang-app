// Snapshot runs on a Mac (#92): watches the windows of one process and stops at the first one on a screen.
//
//   offscreen-watch <pid>
//
// Every 15 ms it lists the windows <pid> owns (CGWindowList) and checks each against every display's bounds. A window
// that touches a display: one line `on-screen: "<title>" x y w h` on stderr, exit 3. The process gone: exit 0.
// tools/snapshot.mjs builds it (swiftc) and runs it beside Electron; Electron is killed when it exits 3.
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2, let pid = Int32(CommandLine.arguments[1]) else {
    FileHandle.standardError.write("usage: offscreen-watch <pid>\n".data(using: .utf8)!)
    exit(2)
}

func displays() -> [CGRect] {
    var count: UInt32 = 0
    var ids = [CGDirectDisplayID](repeating: 0, count: 32)
    guard CGGetOnlineDisplayList(32, &ids, &count) == .success, count > 0 else {
        // No displays to check against: a watch that can't see stops the run rather than letting it pass.
        FileHandle.standardError.write("on-screen: the displays could not be listed\n".data(using: .utf8)!)
        exit(3)
    }
    return ids.prefix(Int(count)).map { CGDisplayBounds($0) }
}

var screens = displays()
var tick = 0
while kill(pid, 0) == 0 {
    tick += 1
    if tick % 64 == 0 { screens = displays() } // a display plugged in during the run
    let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
    for info in list where (info[kCGWindowOwnerPID as String] as? Int32) == pid {
        guard let raw = info[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: raw as CFDictionary),
              bounds.width > 1, bounds.height > 1 else { continue }
        // A window that is not shown (ordered out) can sit anywhere; only shown ones count.
        guard (info[kCGWindowIsOnscreen as String] as? Bool) == true else { continue }
        if screens.contains(where: { $0.intersects(bounds) }) {
            let title = info[kCGWindowName as String] as? String ?? ""
            FileHandle.standardError.write("on-screen: \"\(title)\" \(Int(bounds.minX)) \(Int(bounds.minY)) \(Int(bounds.width)) \(Int(bounds.height))\n".data(using: .utf8)!)
            exit(3)
        }
    }
    usleep(15_000)
}
exit(0)
