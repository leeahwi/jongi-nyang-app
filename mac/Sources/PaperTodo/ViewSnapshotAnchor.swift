import AppKit
import SwiftUI

/// Captures this app's rendered popover only when a diagnostic output path is supplied.
struct ViewSnapshotAnchor: NSViewRepresentable {
    let url: URL

    final class Coordinator {
        var generation = 0
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> NSView { NSView() }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.generation += 1
        let generation = context.coordinator.generation
        let coordinator = context.coordinator
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak nsView] in
            guard coordinator.generation == generation,
                  let view = nsView?.window?.contentView,
                  let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
            view.cacheDisplay(in: view.bounds, to: bitmap)
            if let data = bitmap.representation(using: .png, properties: [:]) {
                try? data.write(to: url)
            }
        }
    }
}
