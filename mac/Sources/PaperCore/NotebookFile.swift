import Foundation

public enum NotebookFileError: Error, Equatable, LocalizedError, Sendable {
    case missing(URL)
    /// #382: there, but not readable just now (no permission, a cloud file still on its way): never saved over.
    case unreadable(URL)
    case corrupt(URL)
    case writeFailed(URL)

    public var errorDescription: String? {
        switch self {
        case .missing:
            "Notebook file does not exist."
        case .unreadable:
            "Notebook file could not be opened."
        case .corrupt:
            "Notebook file could not be read."
        case .writeFailed:
            "Notebook file could not be saved."
        }
    }
}

public struct NotebookFile: Sendable {
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    public func load() throws -> Notebook {
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw NotebookFileError.missing(url)
        }

        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw NotebookFileError.unreadable(url)
        }
        do {
            return try Self.decoder.decode(Notebook.self, from: data)
        } catch {
            throw NotebookFileError.corrupt(url)
        }
    }

    public func save(_ notebook: Notebook) throws {
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let data = try Self.encoder.encode(notebook)
            try data.write(to: url, options: [.atomic])
        } catch {
            throw NotebookFileError.writeFailed(url)
        }
    }

    /// todos.json's bytes read as a list (#411: SyncedJSONFile), and written.
    public static func decode(_ data: Data) throws -> Notebook { try decoder.decode(Notebook.self, from: data) }
    public static func encode(_ notebook: Notebook) throws -> Data { try encoder.encode(notebook) }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
