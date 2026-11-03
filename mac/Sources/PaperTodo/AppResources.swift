import Foundation

/// Where the app's pictures and fonts (`Sources/PaperTodo/Assets`) are read from.
///
/// The app reads them from its own bundle (`Contents/Resources/Assets`, copied there by `scripts/build.sh`). Debug runs,
/// tests and the snapshot renderer have no app bundle, so they fall back to SwiftPM's resource bundle (`Bundle.module`).
///
/// #182: the release app is built with `PAPERTODO_APP_BUNDLE=1` (see `Package.swift`). SwiftPM then makes no resource
/// bundle, so its generated accessor — which writes the absolute build folder, home folder name and all, into the
/// binary — is not compiled in, and only `Bundle.main` is read.
enum AppResources {
    static func url(_ name: String, extension ext: String, in subdirectory: String) -> URL? {
        if let url = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: subdirectory) { return url }
        #if PAPERTODO_APP_BUNDLE
        return nil
        #else
        return Bundle.module.url(forResource: name, withExtension: ext, subdirectory: subdirectory)
        #endif
    }
}
