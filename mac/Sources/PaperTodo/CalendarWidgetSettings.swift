import AppKit
import PaperCore
import SwiftUI

// 바탕화면 위젯 (#234): 책상 → 일정 → 바탕화면 위젯 — off until one is added — the gallery of the six kinds, and one
// widget's settings slip (shown on the widget at once; 취소 puts it back). This Mac's settings only.

/// A widget drawn small, as it looks at 100 %: the desk's rows and the gallery. #319: one `WidgetState` for as long as it
/// is shown (a new one each time `body` ran made the whole widget work itself out again), told when its kind or style
/// changes.
struct WidgetThumbnail: View {
    let kind: CalendarWidget.Kind
    let style: CalendarWidget.Style
    var opacity = 100
    let size: CGSize
    @StateObject private var state: WidgetState

    init(kind: CalendarWidget.Kind, style: CalendarWidget.Style, opacity: Int = 100, size: CGSize) {
        self.kind = kind
        self.style = style
        self.opacity = opacity
        self.size = size
        _state = StateObject(wrappedValue: WidgetState(settings: Self.settings(kind, style, opacity)))
    }

    private static func settings(_ kind: CalendarWidget.Kind, _ style: CalendarWidget.Style, _ opacity: Int) -> CalendarWidget.Settings {
        CalendarWidget.Settings(id: "preview", kind: kind, style: style, opacity: opacity)
    }

    var body: some View {
        let paper = CalendarWidget.windowSize(kind, style)
        let scale = min(size.width / paper.width, size.height / paper.height)
        CalendarWidgetView(state: state, feed: CalendarWidgets.shared.feed, widgets: CalendarWidgets.shared)
            .allowsHitTesting(false)
            .frame(width: paper.width, height: paper.height)
            .scaleEffect(scale)
            .frame(width: paper.width * scale, height: paper.height * scale)
            .frame(width: size.width, height: size.height)
            .background(
                LinearGradient(colors: [Color(red: 0.81, green: 0.88, blue: 0.92), Color(red: 0.91, green: 0.89, blue: 0.82)], startPoint: .top, endPoint: .bottom),
                in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .accessibilityHidden(true)
            .onChange(of: Self.settings(kind, style, opacity)) { _, settings in state.settings = settings }
    }
}

/// 책상 → 일정's 바탕화면 위젯 group.
struct CalendarWidgetsGroup: View {
    @ObservedObject var widgets: CalendarWidgets

    var body: some View {
        SettingsGroup(title: L("바탕화면 위젯"), more: "widgets", footer: footer) {
            ForEach(Array(widgets.list.enumerated()), id: \.element.id) { index, settings in
                if index > 0 { SettingsSeparator() }
                row(settings)
            }
            if !widgets.list.isEmpty { SettingsSeparator() }
            HStack(spacing: 10) {
                Button { WidgetGallerySlip.open(widgets: widgets) } label: {
                    Text(L("+ 위젯 더하기"))
                }
                .buttonStyle(SlipButtonStyle(role: .quiet))
                .disabled(!widgets.canAdd)
                if !widgets.canAdd {
                    Text(L("위젯은 4개까지 둘 수 있어요."))
                        .font(.system(size: 11.5))
                        .foregroundStyle(PaperTheme.ink3)
                }
            }
            .settingsRow()
        }
    }

    private var footer: String {
        widgets.list.isEmpty ? L("바탕화면에 달력을 두고, 날짜를 눌러 바로 넣어요.") : L("위젯은 4개까지 둘 수 있고, 이 Mac에만 저장해요.")
    }

    private func row(_ settings: CalendarWidget.Settings) -> some View {
        HStack(spacing: 12) {
            WidgetThumbnail(kind: settings.kind, style: settings.style, size: CGSize(width: 74, height: 58))
            VStack(alignment: .leading, spacing: 2) {
                Text(CalendarWidget.name(settings.kind, settings.style, .current))
                    .font(.system(size: 13))
                Text(Self.summary(settings))
                    .font(.system(size: 11.5))
                    .foregroundStyle(PaperTheme.ink3)
            }
            Spacer(minLength: 8)
            Button(L("설정…")) { widgets.openSettings(settings.id) }
                .buttonStyle(SlipButtonStyle(role: .quiet))
            Button { widgets.remove(settings.id) } label: {
                Image(systemName: "xmark").font(.system(size: 11, weight: .medium)).frame(width: 26, height: 26).contentShape(Rectangle())
            }
            .buttonStyle(SlipIconButtonStyle())
            .help(L("위젯 제거"))
            .accessibilityLabel(L("위젯 제거"))
        }
        .padding(.vertical, 6)
        .settingsRow()
    }

    /// ‘불투명도 85% · 바탕화면에 두기’, ‘… · 항상 위’, ‘… · 클릭 통과’; another size than 보통 first (‘크게 · 불투명도 85% · …’).
    static func summary(_ settings: CalendarWidget.Settings) -> String {
        var parts = [L("불투명도 \(settings.opacity)%"), settings.level == .top ? L("항상 위") : L("바탕화면에 두기")]
        // 크기 (#271): said once it isn't 보통.
        if settings.scale != CalendarWidget.defaultScale { parts.insert(CalendarWidget.scaleName(settings.scale, .current), at: 0) }
        if settings.clickThrough { parts.append(L("클릭 통과")) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - The gallery

@MainActor
enum WidgetGallerySlip {
    static func open(widgets: CalendarWidgets) {
        SlipAlert.open(id: "calendar-widget-gallery", title: L("위젯 더하기")) { done in
            WidgetGalleryView(widgets: widgets, done: done)
        }
    }
}

struct WidgetGalleryView: View {
    @ObservedObject var widgets: CalendarWidgets
    let done: () -> Void
    @State var picked = 3
    /// #319: the seven pictures, drawn once when the slip opens.
    @State private var pictures = WidgetGalleryPictures()
    @Environment(\.self) private var environment
    static let choices: [(CalendarWidget.Kind, CalendarWidget.Style)] = [
        (.today, .simple), (.week, .simple), (.week, .detail), (.month, .simple), (.month, .detail), (.month, .wall), (.agenda, .simple),
    ]
    static let thumbnail = CGSize(width: 130, height: 88)

    var body: some View {
        let images = pictures.images(environment)
        PaperSlip(kind: .event, width: 470) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .event, symbol: "calendar", title: L("위젯 더하기"), onClose: done)
                VStack(alignment: .leading, spacing: 10) {
                    Text(L("고른 위젯이 화면 오른쪽 위에 나타나요."))
                        .font(.system(size: 12))
                        .foregroundStyle(PaperTheme.ink3)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                        ForEach(Array(Self.choices.enumerated()), id: \.offset) { index, choice in
                            Button { picked = index } label: {
                                VStack(spacing: 5) {
                                    WidgetGalleryPicture(image: images[index], kind: choice.0, style: choice.1, scale: environment.displayScale)
                                        .overlay {
                                            RoundedRectangle(cornerRadius: 9, style: .continuous)
                                                .strokeBorder(index == picked ? PaperTheme.sage : .clear, lineWidth: 2)
                                        }
                                    Text(CalendarWidget.name(choice.0, choice.1, .current))
                                        .font(.system(size: 11.5, weight: index == picked ? .semibold : .regular))
                                        .foregroundStyle(PaperTheme.ink)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.85)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(CalendarWidget.name(choice.0, choice.1, .current))
                            .accessibilityAddTraits(index == picked ? .isSelected : [])
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                SlipFooter {
                    EmptyView()
                } trailing: {
                    HStack(spacing: 8) {
                        Button(L("취소"), action: done).buttonStyle(SlipButtonStyle(role: .ghost))
                            .keyboardShortcut(.cancelAction)
                        Button(L("더하기")) {
                            let choice = Self.choices[picked]
                            widgets.add(choice.0, choice.1)
                            done()
                        }
                        .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
                        .keyboardShortcut(.defaultAction)
                        .disabled(!widgets.canAdd)
                    }
                }
            }
        }
    }
}

/// #319: a gallery tile's picture — the widget drawn once into an image, so a pick (its border, its name's weight) doesn't
/// lay out and draw seven whole widgets again. The live widget only if it couldn't be drawn.
private struct WidgetGalleryPicture: View {
    let image: CGImage?
    let kind: CalendarWidget.Kind
    let style: CalendarWidget.Style
    let scale: CGFloat

    var body: some View {
        if let image {
            Image(decorative: image, scale: scale)
                .frame(width: WidgetGalleryView.thumbnail.width, height: WidgetGalleryView.thumbnail.height)
        } else {
            WidgetThumbnail(kind: kind, style: style, size: WidgetGalleryView.thumbnail)
        }
    }
}

/// #319: the gallery's pictures as the slip draws them (the paper, light or dark, contrast, language, the display's
/// scale): drawn when the slip opens, and again only when one of those changes. They show the day they were drawn on.
@MainActor
final class WidgetGalleryPictures {
    private struct Key: Equatable {
        var paper: Int
        var scheme: ColorScheme
        var contrast: ColorSchemeContrast
        var scale: CGFloat
        var locale: Locale
    }
    private var key: Key?
    private var images: [CGImage?] = []

    /// Read in the gallery's `body`: a paper picked while it is open (PaperLook's revision) draws them again.
    func images(_ environment: EnvironmentValues) -> [CGImage?] {
        let key = Key(paper: PaperLook.shared.revision, scheme: environment.colorScheme, contrast: environment.colorSchemeContrast,
                      scale: environment.displayScale, locale: environment.locale)
        if key != self.key {
            images = WidgetGalleryView.choices.map { kind, style in
                let renderer = ImageRenderer(content: WidgetThumbnail(kind: kind, style: style, size: WidgetGalleryView.thumbnail)
                    .environment(\.self, environment))
                renderer.scale = key.scale
                renderer.isOpaque = false
                return renderer.cgImage
            }
            self.key = key
        }
        return images
    }
}

// MARK: - One widget's settings

@MainActor
enum WidgetSettingsSlip {
    static func open(_ settings: CalendarWidget.Settings, widgets: CalendarWidgets) {
        SlipAlert.open(id: "calendar-widget-\(settings.id)", title: title(settings)) { done in
            WidgetSettingsView(widgets: widgets, original: settings, done: done)
        }
    }

    /// ‘이번 달 위젯’, ‘This month widget’, ‘Widget Deze maand’.
    static func title(_ settings: CalendarWidget.Settings) -> String {
        let kind = CalendarWidget.name(settings.kind, .simple, .current).components(separatedBy: " · ").first ?? ""
        return L("\(kind) 위젯")
    }
}

struct WidgetSettingsView: View {
    @ObservedObject var widgets: CalendarWidgets
    let original: CalendarWidget.Settings
    let done: () -> Void
    /// Snapshots: the sizes that fit, as on a small display (1280×800).
    var previewFitting: [Double]?
    @State private var settings: CalendarWidget.Settings

    init(widgets: CalendarWidgets, original: CalendarWidget.Settings, previewFitting: [Double]? = nil, done: @escaping () -> Void) {
        self.widgets = widgets
        self.original = original
        self.previewFitting = previewFitting
        self.done = done
        _settings = State(initialValue: original)
    }

    /// 크기 (#271): the sizes that fit the widget's display; the others are greyed out.
    private var fitting: [Double] { previewFitting ?? widgets.fitting(settings) }

    var body: some View {
        PaperSlip(kind: .event, width: 400) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .event, symbol: "slider.horizontal.3", title: WidgetSettingsSlip.title(original), onClose: cancel)
                VStack(alignment: .leading, spacing: 0) {
                    Text(L("이 Mac에만 저장해요."))
                        .font(.system(size: 11.5))
                        .foregroundStyle(PaperTheme.ink3)
                        .padding(.bottom, 6)
                    if CalendarWidget.hasStyles(settings.kind) {
                        line(String(localized: "모양", table: "Widget")) {
                            PaperSegmented(selection: binding(\.style), options: CalendarWidget.styles(settings.kind).map { ($0, CalendarWidget.styleName($0, .current), nil) },
                                           label: String(localized: "모양", table: "Widget"))
                                .frame(width: CalendarWidget.styles(settings.kind).count > 2 ? 270 : 170)
                        }
                    }
                    line(L("크기")) {
                        PaperSegmented(selection: binding(\.scale), options: CalendarWidget.scales.map { ($0, CalendarWidget.scaleName($0, .current), nil) },
                                       label: L("크기"), fit: true,
                                       disabled: Set(CalendarWidget.scales.filter { !fitting.contains($0) }))
                            .frame(width: 270)
                    }
                    if fitting.count < CalendarWidget.scales.count {
                        Text(L("이 화면에 들어가는 크기만 고를 수 있어요."))
                            .font(.system(size: 11))
                            .foregroundStyle(PaperTheme.ink3)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.bottom, 4)
                    }
                    line(L("불투명도")) {
                        HStack(spacing: 8) {
                            Slider(value: Binding(get: { Double(settings.opacity) }, set: { value in change { $0.opacity = CalendarWidget.opacity(Int(value.rounded())) } }),
                                   in: 20...100, step: 5)
                                .tint(PaperTheme.sage)
                                .frame(width: 140)
                                .accessibilityLabel(L("불투명도"))
                            Text("\(widgets.reduceTransparency ? 100 : settings.opacity)%")
                                .font(.system(size: 12).monospacedDigit())
                                .foregroundStyle(PaperTheme.ink2)
                                .frame(width: 38, alignment: .trailing)
                        }
                        .disabled(widgets.reduceTransparency)
                    }
                    if widgets.reduceTransparency {
                        Text(L("투명도 줄이기가 켜져 있어서 위젯이 늘 선명하게 보여요."))
                            .font(.system(size: 11))
                            .foregroundStyle(PaperTheme.ink3)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.bottom, 4)
                    }
                    toggle(L("마우스를 올리면 선명하게"), nil, \.solidOnHover).disabled(widgets.reduceTransparency)
                    toggle(L("클릭 통과"), L("켜면 귀만 마우스를 받아요."), \.clickThrough)
                    toggle(L("위치 고정"), nil, \.locked)
                    toggle(L("항상 위에 두기"), L("끄면 다른 창 아래, 바탕화면에 있어요."),
                           Binding(get: { settings.level == .top }, set: { on in change { $0.level = on ? .top : .desktop } }))
                    toggle(L("모든 데스크톱에"), nil, \.allSpaces)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                SlipFooter {
                    Button(L("위젯 제거")) {
                        done()
                        widgets.remove(original.id)
                    }
                    .buttonStyle(SlipButtonStyle(role: .danger))
                    .fixedSize()
                } trailing: {
                    HStack(spacing: 8) {
                        Button(L("취소"), action: cancel).buttonStyle(SlipButtonStyle(role: .ghost)).keyboardShortcut(.cancelAction).fixedSize()
                        Button(String(localized: "완료", table: "Widget")) {
                            widgets.update(original.id) { _ in }
                            done()
                        }
                        .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
                        .keyboardShortcut(.defaultAction)
                        .fixedSize()
                    }
                }
            }
        }
    }

    private func cancel() {
        let original = self.original
        widgets.update(original.id) { $0 = original }
        done()
    }

    /// Shown on the widget at once; saved with 완료.
    private func change(_ edit: (inout CalendarWidget.Settings) -> Void) {
        edit(&settings)
        let next = settings
        widgets.update(original.id, save: false) { $0 = next }
    }

    private func binding<T>(_ path: WritableKeyPath<CalendarWidget.Settings, T>) -> Binding<T> {
        Binding(get: { settings[keyPath: path] }, set: { value in change { $0[keyPath: path] = value } })
    }

    private func line<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: 10) {
            Text(title.keepingParticles).font(.system(size: 13))
            Spacer(minLength: 8)
            content()
        }
        .frame(minHeight: 38)
    }

    private func toggle(_ title: String, _ caption: String?, _ path: WritableKeyPath<CalendarWidget.Settings, Bool>) -> some View {
        toggle(title, caption, binding(path))
    }

    private func toggle(_ title: String, _ caption: String?, _ value: Binding<Bool>) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title.keepingParticles).font(.system(size: 13))
                if let caption {
                    Text(caption.keepingParticles)
                        .font(.system(size: 11))
                        .foregroundStyle(PaperTheme.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            Toggle(title, isOn: value).toggleStyle(PaperToggleStyle()).labelsHidden()
        }
        .frame(minHeight: 38)
    }
}
