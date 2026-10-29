import AppKit
import PaperCore

/// The app's language for this run: Korean (the source), English or Dutch.
///
/// Every text the app shows is written in Korean in the code; that Korean text is the key into
/// `Resources/<language>.lproj/Localizable.strings` (and `.stringsdict` for counts). SwiftUI's
/// `Text("…")`, `Button("…")`, `.help("…")`… look it up by themselves; plain `String`s go through
/// `L("…")`. Texts the core makes (dates, times, cat talk…) get `AppLanguage.current`.
///
/// The language is fixed for a run. Changing it in Settings writes `AppleLanguages` for this app
/// and relaunches, so menus, open panels and the app's own text all switch together.
enum L10n {
    /// UserDefaults key: "auto" (or missing), "ko", "en", "nl".
    static let settingKey = "app.language"

    nonisolated(unsafe) private(set) static var language: AppLanguage = .ko

    /// Resolves the setting and makes the bundle's lookups use the same language. Called first
    /// thing at launch, before any text is looked up (the bundle remembers its first answer).
    static func activate(setting: String? = UserDefaults.standard.string(forKey: settingKey),
                         preferred: [String] = Locale.preferredLanguages) {
        language = AppLanguage.resolve(setting: setting, preferred: preferred)
        // The argument domain wins over everything else and isn't saved: the bundle then picks
        // this language's tables even when the Mac's languages say something else ("auto" on a
        // German Mac is English, while the bundle alone would fall back to Korean).
        let defaults = UserDefaults.standard
        var arguments = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
        arguments["AppleLanguages"] = [language.rawValue]
        defaults.setVolatileDomain(arguments, forName: UserDefaults.argumentDomain)
    }

    /// The saved setting: "auto", "ko", "en" or "nl".
    static var setting: String {
        let saved = UserDefaults.standard.string(forKey: settingKey) ?? "auto"
        return AppLanguage(rawValue: saved) == nil ? "auto" : saved
    }

    /// "English로 바꿀까요?": 한국어 · English · Nederlands all take 로, 자동 takes 으로 — written out,
    /// no "(으)로".
    static func changeQuestion(to setting: String) -> String {
        AppLanguage(rawValue: setting).map { L("\($0.nativeName)로 바꿀까요?") } ?? L("자동으로 바꿀까요?")
    }

    static var changeDetail: String { L("종이냥이 다시 시작돼요.") + " " + L("적어 둔 건 그대로예요.") }

    @MainActor static var changeChoices: [SlipAlert.Choice] {
        [.init(title: L("그대로 두기"), isCancel: true), .init(title: L("바꾸고 다시 시작"), role: .primary, isDefault: true)]
    }

    /// Settings → 꾸미기 → 언어: asks, saves, and restarts the app in the new language.
    @MainActor
    static func change(to setting: String, beforeRestart: () -> Void) {
        guard setting != Self.setting else { return }
        let answer = SlipAlert.run(symbol: "globe", title: L("언어 바꾸기"), message: changeQuestion(to: setting),
                                   detail: changeDetail, choices: changeChoices, width: .medium)
        guard answer == 1 else { return }
        let defaults = UserDefaults.standard
        if let language = AppLanguage(rawValue: setting) {
            defaults.set(language.rawValue, forKey: settingKey)
            // This app's own AppleLanguages: the system's menus and panels follow too.
            defaults.set([language.rawValue], forKey: "AppleLanguages")
        } else {
            defaults.removeObject(forKey: settingKey)
            defaults.removeObject(forKey: "AppleLanguages")
        }
        defaults.synchronize()
        beforeRestart()
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration) { _, _ in
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }
}

extension AppLanguage {
    /// The language of this run (see `L10n`).
    static var current: AppLanguage { L10n.language }

    /// For date and time pickers. SwiftUI also picks a view's text by its locale, so a view
    /// given a locale must get the app's language: never a fixed Korean one.
    var locale: Locale {
        switch self {
        case .ko: Locale(identifier: "ko_KR")
        case .en: Locale(identifier: "en_US")
        case .nl: Locale(identifier: "nl_NL")
        }
    }
}

/// A plain `String` in the app's language; the Korean text is the key.
func L(_ key: String.LocalizationValue) -> String {
    String(localized: key)
}

extension String {
    /// A Latin word and the Korean particle after it stay on one line when the text wraps ("Claude는", not
    /// "Claude" / "는"): a word joiner (U+2060) goes between them (and a no-break space inside "AI 연결"). Only for showing; the text itself, its
    /// translation key and searches keep the plain string.
    var keepingParticles: String {
        guard contains(where: { $0.isASCII && ($0.isLetter || $0.isNumber) }) else { return self }
        // …and "AI 연결" (the setting's name) isn't split at its space either.
        return replacingOccurrences(of: "([A-Za-z0-9’”)\\]])(?=[가-힣])", with: "$1\u{2060}", options: .regularExpression)  // ko-only: a pattern, not text
            .replacingOccurrences(of: "AI 연결", with: "AI\u{00A0}연결")  // ko-only: the setting's name, kept whole
    }
}
