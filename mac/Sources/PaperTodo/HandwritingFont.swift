import AppKit
import CoreText
import PaperCore
import SwiftUI

@MainActor
enum HandwritingFont {
    enum Face {
        case pen
        case brush

        var fallbackPostScriptNames: [String] {
            switch self {
            case .pen:
                [
                    "HanJangPen-Regular",
                    "NanumPen-Regular",
                    "Nanum Pen",
                    "Nanum Pen Regular",
                    "NanumPen",
                    "NanumPenOTF",
                    "NanumPenScript-Regular",
                    "PilGi",
                    "PilGi-Regular"
                ]
            case .brush:
                [
                    "HanJangBrush-Regular",
                    "NanumBrush",
                    "Nanum Brush Script",
                    "NanumBrushScript-Regular"
                ]
            }
        }

        /// English and Dutch write Latin text in a handwriting face made for it (bundled, OFL):
        /// Caveat for the pen, Kalam for the marker. Hangul in it (a title typed in Korean) still
        /// comes from the Korean face, through the font's cascade list.
        var latinPostScriptName: String {
            switch self {
            case .pen: "Caveat-Regular"
            case .brush: "Kalam-Regular"
            }
        }

        /// Caveat runs small and Kalam large next to the Korean faces: scaled so a line reads at
        /// the same size (x-height and caps measured against HanJang Pen / Brush).
        var latinScale: CGFloat {
            switch self {
            case .pen: 1.18
            case .brush: 0.88
            }
        }
    }

    private static var didRegister = false
    private static var resolvedNames: [String: String] = [:]
    private static var fonts: [String: NSFont] = [:]

    static var postScriptName: String {
        postScriptName(for: .pen)
    }

    static var brushPostScriptName: String {
        postScriptName(for: .brush)
    }

    static func postScriptName(for face: Face) -> String {
        register()
        let key = face.fallbackPostScriptNames[0]
        if let name = resolvedNames[key] { return name }
        let name = face.fallbackPostScriptNames.first { NSFont(name: $0, size: 12) != nil }
            ?? NSFont.systemFont(ofSize: 12).fontName
        resolvedNames[key] = name
        return name
    }

    static func register() {
        guard !didRegister else { return }
        didRegister = true

        for url in bundledFontURLs() {
            var error: Unmanaged<CFError>?
            if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) {
                error?.release()
            }
        }
    }

    static func native(size: CGFloat) -> NSFont {
        native(face: .pen, size: size)
    }

    /// Rows ask for their font on every render, so resolved fonts are kept per face and size.
    /// Korean uses the Korean faces as they are; English and Dutch the Latin face (see
    /// `Face.latinPostScriptName`) with the Korean one behind it for Hangul.
    static func native(face: Face, size: CGFloat, language: AppLanguage = .current) -> NSFont {
        let name = postScriptName(for: face)
        let key = "\(name)@\(size)@\(language.rawValue)"
        if let font = fonts[key] { return font }
        let korean = NSFont(name: name, size: size) ?? .systemFont(ofSize: size)
        var font = korean
        if language != .ko, NSFont(name: face.latinPostScriptName, size: size) != nil {
            let cascade = NSFontDescriptor(name: name, size: 0)
            let descriptor = NSFontDescriptor(name: face.latinPostScriptName, size: 0)
                .addingAttributes([.cascadeList: [cascade]])
            font = NSFont(descriptor: descriptor, size: (size * face.latinScale).rounded()) ?? korean
        }
        fonts[key] = font
        return font
    }

    /// How much taller a line of the Latin face is than the Korean one's, above and below (zero
    /// in Korean): where a handwritten line sits in a tight, fixed spot (the note's title), it is
    /// pulled in by this much so the layout around it stays where the Korean puts it.
    static func extraLineHeight(face: Face, size: CGFloat, language: AppLanguage = .current) -> (top: CGFloat, bottom: CGFloat) {
        guard language != .ko, let korean = NSFont(name: postScriptName(for: face), size: size) else { return (0, 0) }
        let latin = native(face: face, size: size, language: language)
        return (max(0, latin.ascender - korean.ascender), max(0, korean.descender - latin.descender))
    }

    static func swiftUI(size: CGFloat) -> Font {
        Font(native(size: size))
    }

    static func swiftUI(face: Face, size: CGFloat) -> Font {
        Font(native(face: face, size: size))
    }

    private static func bundledFontURLs() -> [URL] {
        // Built by scripts/tighten-handwriting-jamo.py from Nanum Pen/Brush with narrower jamo;
        // Caveat and Kalam (Google Fonts, OFL) for English and Dutch.
        [
            bundledFontURL(resource: "HanJangPen-Regular", subdirectory: "Assets/Fonts"),
            bundledFontURL(resource: "HanJangBrush-Regular", subdirectory: "Assets/Fonts"),
            bundledFontURL(resource: "Caveat", subdirectory: "Assets/Fonts"),
            bundledFontURL(resource: "Kalam-Regular", subdirectory: "Assets/Fonts")
        ].compactMap(\.self)
    }

    private static func bundledFontURL(resource: String, subdirectory: String) -> URL? {
        Bundle.main.url(forResource: resource, withExtension: "ttf", subdirectory: subdirectory)
            ?? Bundle.module.url(forResource: resource, withExtension: "ttf", subdirectory: subdirectory)
    }
}
