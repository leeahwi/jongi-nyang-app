import AppKit
import Carbon.HIToolbox

/// A shortcut that works from any app (⌃⌥N 빠른 입력, ⌃⌥M 빠른 메모), through Carbon's hot keys.
/// One event handler serves every shortcut and calls the one that was pressed.
@MainActor
final class GlobalHotKey {
    private static var handler: EventHandlerRef?
    private static var actions: [UInt32: () -> Void] = [:]
    private static var nextID: UInt32 = 1
    /// "HANJ"
    private static let signature = OSType(0x48414E4A)

    private var reference: EventHotKeyRef?
    private let id: UInt32

    /// Claims the shortcut; nil when another app already owns it.
    init?(keyCode: Int, modifiers: Int, action: @escaping () -> Void) {
        Self.installHandler()
        id = Self.nextID
        Self.nextID += 1
        var reference: EventHotKeyRef?
        let status = RegisterEventHotKey(UInt32(keyCode), UInt32(modifiers), EventHotKeyID(signature: Self.signature, id: id),
                                         GetApplicationEventTarget(), 0, &reference)
        guard status == noErr, let reference else { return nil }
        self.reference = reference
        Self.actions[id] = action
    }

    func unregister() {
        if let reference { UnregisterEventHotKey(reference) }
        reference = nil
        Self.actions[id] = nil
    }

    private static func installHandler() {
        guard handler == nil else { return }
        var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
            var pressed = EventHotKeyID()
            let status = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                                           MemoryLayout<EventHotKeyID>.size, nil, &pressed)
            guard status == noErr, pressed.signature == GlobalHotKey.signature else { return OSStatus(eventNotHandledErr) }
            let id = pressed.id
            MainActor.assumeIsolated { GlobalHotKey.actions[id]?() }
            return noErr
        }, 1, &type, nil, &handler)
    }
}
