// The performance check's helper (scripts/perf.sh and the other checks of a test copy). It only ever reads the one
// process whose pid it is given: CPU time, wakeups and memory from proc_pid_rusage, and where its windows are.
// #208: it never brings the app forward and never presses anything through accessibility.
// #217: it sends nothing at all any more — no key, no click. The test copy takes its input from inside
// (`--perf-drive`, Sources/PaperTodo/PerfDrive.swift), so no event goes through the system.
import CoreGraphics
import Darwin
import Foundation

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

let a = CommandLine.arguments
guard a.count > 2, let pid = pid_t(a[2]) else { print("usage: perf-probe <sample|mem|windows|offscreen> <pid> …"); exit(2) }

/// The pid's shown windows: number, layer, title and bounds as the window server has them.
func shownWindows() -> [(number: Int, layer: Int, title: String, bounds: CGRect)] {
    let info = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
    return info.compactMap { w in
        guard (w[kCGWindowOwnerPID as String] as? Int32) == pid, let raw = w[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: raw as CFDictionary) else { return nil }
        return (w[kCGWindowNumber as String] as? Int ?? 0, w[kCGWindowLayer as String] as? Int ?? 0, w[kCGWindowName as String] as? String ?? "-", bounds)
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
case "windows": // windows <pid>: its shown windows (anywhere, off the screens too)
    for w in shownWindows() {
        print(w.number, w.layer, w.title, "x \(Int(w.bounds.minX)) y \(Int(w.bounds.minY)) w \(Int(w.bounds.width)) h \(Int(w.bounds.height))")
    }
case "offscreen": // offscreen <pid>: exit 1 (and the windows) when a shown window of it touches a display
    var count: UInt32 = 0
    var ids = [CGDirectDisplayID](repeating: 0, count: 32)
    guard CGGetOnlineDisplayList(32, &ids, &count) == .success, count > 0 else { print("the displays could not be listed"); exit(1) }
    let screens = ids.prefix(Int(count)).map { CGDisplayBounds($0) }
    let on = shownWindows().filter { w in w.bounds.width > 1 && w.bounds.height > 1 && screens.contains { $0.intersects(w.bounds) } }
    for w in on { print("on a screen:", w.title, "x \(Int(w.bounds.minX)) y \(Int(w.bounds.minY)) w \(Int(w.bounds.width)) h \(Int(w.bounds.height))") }
    exit(on.isEmpty ? 0 : 1)
default: print("?"); exit(2)
}
