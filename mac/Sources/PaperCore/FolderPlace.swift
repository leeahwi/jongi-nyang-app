import Foundation

/// 저장과 백업 (1.45): a folder's place said the way Finder's path bar says it — the folder's own name, and the
/// places it is in before it, the home folder as `~` and a cloud drive by its name ("iCloud Drive › 종이냥"), never
/// the raw path in a code font. The full path stays in the tooltip. The same rules as the Windows app
/// (core/storage.ts `folderPlace`).
public struct FolderPlace: Equatable, Sendable {
    /// The places before the folder, outermost first: `["~", "Library", "Application Support"]`, `["iCloud Drive"]`.
    public var lead: [String]
    /// The folder's own name.
    public var name: String
    /// The cloud drive it is in ("iCloud Drive", "OneDrive", "Dropbox", "Google Drive"), if any.
    public var cloud: String?

    public init(lead: [String], name: String, cloud: String? = nil) {
        self.lead = lead; self.name = name; self.cloud = cloud
    }

    /// The breadcrumb's separator, as in Finder's path bar.
    public static let separator = " › "

    /// "~ › Library › Application Support › " (empty when the folder is the home folder or a drive itself).
    public var leadText: String { lead.isEmpty ? "" : lead.joined(separator: Self.separator) + Self.separator }

    public var text: String { leadText + name }

    /// Where `path` is, with `home` (NSHomeDirectory()) as `~` and the cloud drives macOS keeps under it by name.
    public static func of(_ path: String, home: String) -> FolderPlace {
        let parts = path.split(separator: "/").map(String.init)
        let homeParts = home.split(separator: "/").map(String.init)
        guard !parts.isEmpty else { return FolderPlace(lead: [], name: "/") }
        guard !homeParts.isEmpty, parts.count >= homeParts.count, Array(parts.prefix(homeParts.count)) == homeParts else {
            return place(parts, root: [])
        }
        let rest = Array(parts.dropFirst(homeParts.count))
        guard !rest.isEmpty else { return FolderPlace(lead: [], name: "~") }
        // iCloud Drive: ~/Library/Mobile Documents/com~apple~CloudDocs/…
        if rest.count >= 3, rest[0] == "Library", rest[1] == "Mobile Documents", rest[2] == "com~apple~CloudDocs" {
            return place(Array(rest.dropFirst(3)), root: ["iCloud Drive"], cloud: "iCloud Drive")
        }
        // The File Provider drives: ~/Library/CloudStorage/OneDrive-Personal/…, Dropbox/…, GoogleDrive-name/…
        if rest.count >= 3, rest[0] == "Library", rest[1] == "CloudStorage", let cloud = cloudName(rest[2]) {
            return place(Array(rest.dropFirst(3)), root: [cloud], cloud: cloud)
        }
        // The older apps' folders right in the home folder: ~/Dropbox/…, ~/OneDrive/…
        if let cloud = cloudName(rest[0]) {
            return place(Array(rest.dropFirst()), root: [cloud], cloud: cloud)
        }
        return place(rest, root: ["~"])
    }

    /// "OneDrive-Personal", "OneDrive - Company" → OneDrive; "Dropbox", "Dropbox (Personal)" → Dropbox;
    /// "GoogleDrive-name" → Google Drive.
    static func cloudName(_ folder: String) -> String? {
        let lower = folder.lowercased()
        if lower == "onedrive" || lower.hasPrefix("onedrive-") || lower.hasPrefix("onedrive ") { return "OneDrive" }
        if lower == "dropbox" || lower.hasPrefix("dropbox-") || lower.hasPrefix("dropbox ") { return "Dropbox" }
        if lower.hasPrefix("googledrive") { return "Google Drive" }
        return nil
    }

    private static func place(_ parts: [String], root: [String], cloud: String? = nil) -> FolderPlace {
        guard let name = parts.last else {
            // The drive's own top folder: its name alone.
            return FolderPlace(lead: Array(root.dropLast()), name: root.last ?? "/", cloud: cloud)
        }
        return FolderPlace(lead: root + parts.dropLast(), name: name, cloud: cloud)
    }
}
