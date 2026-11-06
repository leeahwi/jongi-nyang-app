import Foundation

/// N3-9 (#196, docs/plans/mcp-plan.md): this Mac's 이 기기에서 as ai-link.json carries it — the setting's own shape (D5),
/// the same as the Windows app writes — so Claude on this Mac hides what the note hides. A file of its own, so
/// AIConnect.swift and SpaceDevice.swift each still build alone in their checks (scripts/test-space-device.sh builds
/// both with this one for the shared case S73).
extension SpaceDevice {
    public static func linkRules(_ rules: Rules) -> [String: AIConnect.DeviceRule] {
        rules.mapValues { rule in
            switch rule {
            case .hide: AIConnect.DeviceRule(show: "hide")
            case .times(let ranges):
                AIConnect.DeviceRule(show: "time", times: ranges.map {
                    AIConnect.DeviceRule.Times(days: $0.days, from: clockText($0.from), to: clockText($0.to))
                })
            }
        }
    }
}
