import AppKit
import PaperCore
import SwiftUI

// 바탕화면 위젯 (#234): 책상 → 일정 → 바탕화면 위젯 — off until one is added — the gallery of the six kinds, and one
// widget's settings slip (shown on the widget at once; 취소 puts it back). This Mac's settings only.

/// A widget drawn small, as it looks at 100 %: the desk's rows and the gallery.
struct WidgetThumbnail: View {
    let kind: CalendarWidget.Kind
    let style: CalendarWidget.Style
    var opacity = 100
    let size: CGSize

    var body: some View {
        let paper = CalendarWidget.windowSize(kind, style)
        let scale = min(size.width / paper.width, size.height / paper.height)
        let state = WidgetState(settings: CalendarWidget.Settings(id: "preview", kind: kind, style: style, opacity: opacity))
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

    /// ‘불투명도 85% · 바탕화면에 두기’, ‘… · 항상 위’, ‘… · 클릭 통과’.
    static func summary(_ settings: CalendarWidget.Settings) -> String {
        var parts = [L("불투명도 \(settings.opacity)%"), settings.level == .top ? L("항상 위") : L("바탕화면에 두기")]
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
    static let choices: [(CalendarWidget.Kind, CalendarWidget.Style)] = [
        (.today, .simple), (.week, .simple), (.week, .detail), (.month, .simple), (.month, .detail), (.month, .wall), (.agenda, .simple),
    ]

    var body: some View {
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
                                    WidgetThumbnail(kind: choice.0, style: choice.1, size: CGSize(width: 130, height: 88))
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
    @State private var settings: CalendarWidget.Settings

    init(widgets: CalendarWidgets, original: CalendarWidget.Settings, done: @escaping () -> Void) {
        self.widgets = widgets
        self.original = original
        self.done = done
        _settings = State(initialValue: original)
    }

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
                                .frame(width: CalendarWidget.styles(settings.kind).count > 2 ? 250 : 170)
                        }
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
