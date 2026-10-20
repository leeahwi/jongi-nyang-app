import AppKit
import SwiftUI

/// Shows the event sheet (새 일정 · 일정 고치기 · 캘린더에 넣기) as a slip taped over its window, in
/// a borderless panel that moves with that window. Set the request to show it; nil closes it.
struct EventSheetAnchor: NSViewRepresentable {
    var request: CalendarSheetRequest?
    let calendar: EventBook
    let onClose: () -> Void
    /// The slip's top, down from the window's top edge.
    var topInset: CGFloat = 96

    func makeCoordinator() -> Presenter { Presenter() }

    func makeNSView(context: Context) -> NSView { NSView() }

    func updateNSView(_ view: NSView, context: Context) {
        context.coordinator.onClose = onClose
        context.coordinator.update(request, calendar: calendar, from: view, topInset: topInset)
    }

    static func dismantleNSView(_ view: NSView, coordinator: Presenter) {
        coordinator.close()
    }

    @MainActor
    final class Presenter {
        private var panel: SlipPanel?
        private var shown: UUID?
        var onClose: () -> Void = {}

        func update(_ request: CalendarSheetRequest?, calendar: EventBook, from view: NSView, topInset: CGFloat) {
            guard request?.id != shown else { return }
            close()
            guard let request else { return }
            // After this update pass, when the anchor has its window.
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let parent = view?.window else { return }
                self.show(request, calendar: calendar, over: parent, topInset: topInset)
            }
        }

        private func show(_ request: CalendarSheetRequest, calendar: EventBook, over parent: NSWindow, topInset: CGFloat) {
            let panel = SlipPanel(nonactivating: false)
            panel.title = L("일정")
            panel.show(CalendarEventSheet(calendar: calendar, request: request) { [weak self] in self?.onClose() })
            let frame = parent.frame
            panel.placeSlip(topCenter: NSPoint(x: frame.midX, y: frame.maxY - topInset))
            parent.addChildWindow(panel, ordered: .above)
            panel.makeKeyAndOrderFront(nil)
            self.panel = panel
            shown = request.id
        }

        func close() {
            guard let panel else { return }
            let parent = panel.parent
            parent?.removeChildWindow(panel)
            panel.orderOut(nil)
            // Back to the window it was over.
            parent?.makeKey()
            self.panel = nil
            shown = nil
        }
    }
}

/// The note's sheets: whatever EventBook.sheet asks for (the ribbon, ⋯ → 새 일정, 캘린더에 넣기,
/// an input-line event that needs finishing).
private struct EventSheetHost: View {
    @ObservedObject var calendar: EventBook

    var body: some View {
        EventSheetAnchor(request: calendar.sheet, calendar: calendar, onClose: { calendar.sheet = nil })
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

extension View {
    func eventSheetPanel(calendar: EventBook) -> some View {
        background(EventSheetHost(calendar: calendar))
    }
}
