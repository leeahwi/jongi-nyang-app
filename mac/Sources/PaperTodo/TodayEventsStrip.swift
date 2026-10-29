import AppKit
import PaperCore
import SwiftUI

/// An event's tooltip and menu, shared by the 하루 띠, the 앞으로 rows and the 달력 window. (Until 1.39 this was
/// also 오늘 일정, the event list under the ribbon; the whole day (DayTimetable) replaced it in 1.40.)
@MainActor
enum TodayEventsStrip {
    static func tooltip(_ event: CalendarEvent) -> String {
        var parts = [event.title]
        if !event.allDay {
            // The app's own clock in every language (1.40: Korean was "07:20" for 19:20 — a 12-hour format without
            // its 오전/오후).
            let calendar = Calendar.current
            let time = { (date: Date) in (hour: calendar.component(.hour, from: date), minute: calendar.component(.minute, from: date)) }
            parts.append(AppLanguage.current.timeRange(from: time(event.start), to: time(event.end)))
        }
        if let location = event.location { parts.append(location) }
        return parts.joined(separator: " · ") + "\n" + L("눌러서 고치기")
    }

    /// An event's menu, here and in the 달력 window: 고치기… · 할 일로 추가 | 지우기… — with the same icons as a to-do's
    /// menu (TaskRowMenu) and the Windows one.
    @ViewBuilder
    static func menu(_ event: CalendarEvent, calendar: EventBook, onAddTask: @escaping (String) -> Void,
                     open: @escaping (CalendarSheetRequest?) -> Void) -> some View {
        Button { open(.edit(event, in: calendar)) } label: { Label("고치기…", systemImage: "pencil").labelStyle(.titleAndIcon) }
        Button { onAddTask(event.title) } label: { Label("할 일로 추가", systemImage: "plus").labelStyle(.titleAndIcon) }
        Divider()
        Button(role: .destructive) { open(.edit(event, in: calendar, confirmDelete: true)) } label: {
            Label("지우기…", systemImage: "trash").labelStyle(.titleAndIcon)
        }
    }
}

extension Color {
    /// "#RRGGBB", an event colour.
    init?(hex: String) {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard digits.count == 6, let value = Int(digits, radix: 16) else { return nil }
        self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }
}
