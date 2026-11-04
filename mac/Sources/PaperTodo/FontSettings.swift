import AppKit
import PaperCore
import SwiftUI

// 글꼴 설정 (#141, docs/plans/settings-plan.md F1 · F2): the note's and the drawer's fonts in one row layout — the name
// on the left, a popup or a stepped slider on the right — the note under the preview sheet in 꾸미기, the drawer under
// a sample memo on its paper in 메모 서랍. The two keep their own values (the note's default is handwriting, the
// drawer's the plain face); only the rows and the step rules are alike. The Windows app draws the same rows.

/// A slider in steps (#141): a sage fill up to a white knob, a tick under each step, a small 가 and a large 가 at the
/// ends. ← → (and ↑ ↓) move it a step; VoiceOver reads the step's name and adjusts it a step at a time.
struct PaperStepSlider: View {
    let count: Int
    @Binding var index: Int
    let label: String
    /// What VoiceOver says for a step (‘보통’, ‘14포인트’).
    let spoken: (Int) -> String
    var width: CGFloat = 150

    private static let knob: CGFloat = 16
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 8) {
            Text("가").font(.system(size: 11)).foregroundStyle(PaperTheme.ink2).accessibilityHidden(true)
            track.frame(width: width, height: 24)
            Text("가").font(.system(size: 17)).foregroundStyle(PaperTheme.ink2).accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(spoken(index))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: move(1)
            case .decrement: move(-1)
            @unknown default: break
            }
        }
    }

    private var track: some View {
        let r = Self.knob / 2
        let step = (width - Self.knob) / CGFloat(max(1, count - 1))
        let x = r + CGFloat(index) * step
        return ZStack(alignment: .leading) {
            Capsule().fill(PaperTheme.rule).frame(height: 4).overlay { Capsule().strokeBorder(PaperTheme.checkBorder.opacity(0.5), lineWidth: 0.5) }
            Capsule().fill(PaperTheme.sage).frame(width: x, height: 4)
            ForEach(0..<count, id: \.self) { tick in
                Rectangle().fill(tick <= index ? PaperTheme.sage : PaperTheme.checkBorder)
                    .frame(width: 1, height: 4)
                    .offset(x: r + CGFloat(tick) * step - 0.5, y: 8)
            }
            Circle().fill(PaperTheme.switchKnob)
                .overlay { Circle().strokeBorder(focused ? PaperTheme.sage : PaperTheme.checkBorder, lineWidth: focused ? 2 : 1) }
                .shadow(color: .black.opacity(0.14), radius: 1.5, y: 1)
                .frame(width: Self.knob, height: Self.knob)
                .offset(x: x - r)
        }
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0).onChanged { value in
            let picked = Int(((value.location.x - r) / step).rounded())
            let clamped = min(max(picked, 0), count - 1)
            if clamped != index { index = clamped }
            focused = true
        })
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onKeyPress(keys: [.leftArrow, .downArrow]) { _ in move(-1); return .handled }
        .onKeyPress(keys: [.rightArrow, .upArrow]) { _ in move(1); return .handled }
        .animation(.easeOut(duration: 0.12), value: index)
    }

    private func move(_ by: Int) {
        let next = min(max(index + by, 0), count - 1)
        if next != index { index = next }
    }
}

/// 꾸미기 → 노트 글꼴: 글꼴 (a popup, its name in the face) and 글자 크기 (seven steps, the step's name beside it).
/// The notepad keeps its 44 pt ruled line, so it has no line or paragraph spacing.
struct NoteFontGroup: View {
    @ObservedObject var model: AppModel

    var body: some View {
        SettingsGroup(title: L("노트 글꼴"), footer: L("⌘ = 와 ⌘ − 로 한 칸씩 바꿔요. 줄 간격은 노트 줄(44pt)에 맞춰져 있어요.")) {
            HStack(spacing: 12) {
                SettingsLabel(L("글꼴"), systemImage: "textformat")
                Spacer(minLength: 8)
                PaperMenuPicker(selection: $model.notebookFont, options: NotebookFont.allCases.map { ($0, $0.title) }, label: L("노트 글꼴"),
                                face: { $0.font(points: 17) })
            }
            .settingsRow()
            SettingsSeparator()
            HStack(spacing: 12) {
                SettingsLabel(L("글자 크기"), systemImage: "textformat.size")
                Spacer(minLength: 8)
                PaperStepSlider(count: NotebookTextSize.allCases.count,
                                index: Binding(get: { model.textSize.rawValue }, set: { model.textSize = NotebookTextSize(rawValue: $0) ?? .regular }),
                                label: L("글자 크기"), spoken: { NotebookTextSize(rawValue: $0)?.title ?? "" })
                Text(model.textSize.title)
                    .font(.system(size: 12))
                    .foregroundStyle(PaperTheme.ink2)
                    .lineLimit(1)
                    .frame(width: FontRows.valueWidth, alignment: .trailing)
            }
            .settingsRow()
        }
    }
}

enum FontRows {
    /// Room for the step's name after a slider (the longest: ‘Slightly smaller’, ‘Iets kleiner’).
    static var valueWidth: CGFloat {
        switch AppLanguage.current {
        case .ko: 58
        case .en: 104
        case .nl: 82
        }
    }
}

extension MemoText.LineSpacing {
    var title: String {
        switch self {
        case .tight: L("촘촘하게")
        case .regular: L("보통")
        case .loose: L("넉넉하게")
        }
    }
}

extension MemoText.ParagraphSpacing {
    var title: String {
        switch self {
        case .regular: L("보통")
        case .wide: L("넓게")
        case .wider: L("아주 넓게")
        }
    }
}

/// 메모 서랍 → 메모 글꼴: a sample memo on the drawer's paper that follows every row, then 글꼴 · 글자 크기 (nine
/// steps, 12–20 pt) · 줄 간격 · 문단 간격.
struct DrawerFontGroup: View {
    @ObservedObject var drawer: MemoDrawer

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 7) {
                Text(L("미리보기"))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PaperTheme.ink2)
                    .padding(.leading, 4)
                    .accessibilityAddTraits(.isHeader)
                DrawerFontPreview(drawer: drawer)
            }
            SettingsGroup(title: L("메모 글꼴"), footer: L("글꼴과 글자 크기는 서랍의 모든 메모와 카드 미리보기에 같이 써요.")
                          + " " + L("코드 글꼴은 ‘코드’ 표시와 코드 묶음, 고정폭 글꼴에 써요. D2Coding은 한글이 영문 두 칸 폭이라 코드 줄의 칸이 맞아요.")) {
                HStack(spacing: 12) {
                    SettingsLabel(L("글꼴"), systemImage: "textformat")
                    Spacer(minLength: 8)
                    PaperMenuPicker(selection: $drawer.bodyFace, options: MemoText.Face.allCases.map { ($0, $0.title) }, label: L("메모 글꼴"),
                                    face: { Font(MemoText(face: $0).font(scale: 13 / 14)) })
                }
                .settingsRow()
                SettingsSeparator()
                // 코드 글꼴 (#143): `코드`, code blocks and the 고정폭 face.
                HStack(spacing: 12) {
                    SettingsLabel(L("코드 글꼴"), systemImage: "chevron.left.forwardslash.chevron.right")
                    Spacer(minLength: 8)
                    PaperMenuPicker(selection: $drawer.codeFace, options: MemoText.CodeFace.allCases.map { ($0, $0.title) }, label: L("코드 글꼴"),
                                    face: { Font(MemoText.mono(12.5, $0)) })
                }
                .settingsRow()
                SettingsSeparator()
                HStack(spacing: 12) {
                    SettingsLabel(L("글자 크기"), systemImage: "textformat.size")
                    Spacer(minLength: 8)
                    PaperStepSlider(count: MemoText.Size.allCases.count,
                                    index: Binding(get: { drawer.textSize.rawValue - 12 }, set: { drawer.textSize = MemoText.Size(rawValue: $0 + 12) ?? .regular }),
                                    label: L("메모 글자 크기"), spoken: { MemoText.Size(rawValue: $0 + 12)?.spoken ?? "" })
                    Text(verbatim: "\(drawer.textSize.rawValue)")
                        .font(.system(size: 12).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink2)
                        .frame(width: 24, alignment: .trailing)
                }
                .settingsRow()
                SettingsSeparator()
                HStack(spacing: 12) {
                    SettingsLabel(L("줄 간격"), systemImage: "arrow.up.and.down.text.horizontal")
                    Spacer(minLength: 8)
                    PaperMenuPicker(selection: $drawer.lineSpacing, options: MemoText.LineSpacing.allCases.map { ($0, $0.title) }, label: L("줄 간격"))
                }
                .settingsRow()
                SettingsSeparator()
                HStack(spacing: 12) {
                    SettingsLabel(L("문단 간격"), systemImage: "text.alignleft")
                    Spacer(minLength: 8)
                    PaperMenuPicker(selection: $drawer.paragraphSpacing, options: MemoText.ParagraphSpacing.allCases.map { ($0, $0.title) }, label: L("문단 간격"))
                }
                .settingsRow()
            }
        }
    }
}

/// The sample (fictional words): a memo sheet on the drawer's paper — its handwritten title, a paragraph, a checklist
/// with one item done and one with `code`, drawn with the drawer's face, size, lines and paragraph room.
struct DrawerFontPreview: View {
    @ObservedObject var drawer: MemoDrawer
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let text = drawer.text
        let palette = drawer.palette(scheme)
        let body = Font(text.font())
        VStack(alignment: .leading, spacing: 0) {
            Text(L("메모 서랍 · 회사"))
                .font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(palette.label)
                .padding(.bottom, 8)
            VStack(alignment: .leading, spacing: 0) {
                CardTitle(words: Text(verbatim: L("주간 회의").handwritten), font: drawer.titleFont, color: palette.ink)
                    .frame(height: MemoSlipStyle.titleRow, alignment: .leading)
                Text(L("시안 두 개는 금요일까지 보내요."))
                    .font(body)
                    .foregroundStyle(palette.ink)
                    .lineSpacing(text.lineSpacing)
                    .frame(minHeight: text.line, alignment: .leading)
                    .padding(.bottom, text.paragraph)
                line(done: true) {
                    Text(L("회의실 잡기")).font(body).foregroundStyle(palette.faint).strikethrough(true, color: palette.faint)
                }
                line(done: false) {
                    HStack(spacing: 6) {
                        Text(L("자료 묶어서 올리기")).font(body).foregroundStyle(palette.ink)
                        Text(verbatim: "v2-final")
                            .font(Font(text.codeFont))
                            .foregroundStyle(palette.ink)
                            .padding(.horizontal, 3)
                            .background(palette.ink.opacity(0.07), in: RoundedRectangle(cornerRadius: 3))
                    }
                }
            }
            .padding(.horizontal, MemoSlipStyle.side)
            .padding(.top, MemoSlipStyle.top)
            .padding(.bottom, MemoSlipStyle.bottom)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.sheet)
            .overlay { Rectangle().strokeBorder(palette.sheetEdge, lineWidth: 1) }
            .shadow(color: palette.shadow, radius: 5, y: 3)
        }
        .padding(14)
        .background(palette.paper, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(palette.edge, lineWidth: 1) }
        .environment(\.colorScheme, palette.scheme)
        .animation(.easeOut(duration: 0.15), value: drawer.text)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(L("메모 글꼴 미리보기"))
    }

    private func line(done: Bool, @ViewBuilder words: () -> some View) -> some View {
        HStack(spacing: 7) {
            CheckBox(checked: done, palette: drawer.palette(scheme))
            words()
        }
        .frame(height: drawer.text.line, alignment: .leading)
    }
}
