import AppKit
import PaperCore
import SwiftUI

/// The back of the sheet: free-form memos. A ruled list of memos, and a full-page editor
/// for the open one. Blank memos disappear when you leave them; deleting can be undone.
struct MemoPageView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            if let id = model.openMemoID, let memo = model.memos.first(where: { $0.id == id }) {
                MemoEditor(model: model, memo: memo)
                    .id(id)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            } else {
                list.transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.18), value: model.openMemoID)
    }

    private var list: some View {
        VStack(spacing: 0) {
            GeometryReader { geometry in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        Button(action: { model.newMemo() }) {
                            HStack(spacing: 0) {
                                Image(systemName: "plus").font(.system(size: 12, weight: .light))
                                    .foregroundStyle(PaperTheme.faded)
                                    .frame(width: PaperTheme.margin)
                                Text((model.memos.isEmpty ? L("첫 메모를 적어 보세요") : L("새 메모")).handwritten)
                                    .font(model.notebookFont.bodyFont(model.textSize))
                                    .foregroundStyle(PaperTheme.faded)
                                    .padding(.leading, 17)
                                Spacer()
                            }
                            .frame(height: PaperTheme.rowHeight)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help("새 메모 (⇧⌘N)")
                        ForEach(model.memos) { memo in
                            MemoRow(model: model, memo: memo)
                        }
                        if model.memos.isEmpty {
                            EmptySheetNote(pose: .tea, text: L("떠오른 생각을 가볍게 적어 두세요"))
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: geometry.size.height, alignment: .top)
                    .background(PaperRules())
                    .overlay(alignment: .leading) { marginLine }
                }
                .scrollIndicators(.never) // never a legacy scroller: its 17 pt gutter shifted the rules and meta
                .scrollEdgeFade()
            }
            .overlay(alignment: .bottom) { ToastHost(model: model) }
            IntentLineView(model: model, page: .memos)
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 8)
            footer
        }
    }

    private var marginLine: some View {
        Rectangle().fill(PaperTheme.marginRule).frame(width: 0.6)
            .padding(.leading, PaperTheme.margin).allowsHitTesting(false)
    }

    private var footer: some View {
        HStack(spacing: 8) {
            Image(systemName: "note.text").font(.system(size: 11))
            Text(model.memos.isEmpty ? L("생각나는 걸 가볍게 적어 두세요") : L("메모 \(model.memos.count)개"))
            Spacer(minLength: 8)
            if model.lastDeletedMemo != nil {
                Button("지운 메모 되돌리기", action: model.restoreDeletedMemo)
                    .buttonStyle(.plain)
                    .foregroundStyle(PaperTheme.sage)
                    .fontWeight(.semibold)
            }
        }
        .font(.system(size: 11))
        .foregroundStyle(PaperTheme.secondary)
        .lineLimit(1)
        .padding(.horizontal, 20)
        .frame(height: 32)
        .overlay(alignment: .top) {
            Rectangle().fill(PaperTheme.rule).frame(height: 0.6).padding(.horizontal, 16)
        }
    }
}

private struct MemoRow: View {
    @ObservedObject var model: AppModel
    let memo: Memo
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 0) {
            Image(systemName: "note.text")
                .font(.system(size: 12))
                .foregroundStyle(PaperTheme.secondary.opacity(0.6))
                .frame(width: PaperTheme.margin)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                // Caveat leans right; a thin space keeps its last letter's tail from being cut.
                Text(memo.title(.current).handwritten)
                    .font(model.notebookFont.bodyFont(model.textSize))
                    .lineLimit(1)
                    // English and Dutch titles run longer: the preview gives way first.
                    .layoutPriority(AppLanguage.current == .ko ? 0 : 1)
                if !memo.preview.isEmpty {
                    Text(memo.preview)
                        .font(.system(size: 11))
                        .foregroundStyle(PaperTheme.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 6)
            }
            .padding(.leading, 17)
            // Like the task rows: the time at rest, and its button in the same spot on hover.
            Group {
                if hovering {
                    Button { model.deleteMemo(memo.id) } label: {
                        Image(systemName: "trash").font(.system(size: 12, weight: .medium))
                            .foregroundStyle(PaperTheme.secondary)
                            .frame(width: 26, height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help("메모 지우기 (아래에서 되돌릴 수 있어요)")
                    .accessibilityLabel("\(memo.title(.current)) 지우기")
                    .transition(.opacity)
                } else {
                    Text(MemoDate.short(memo.updatedAt))
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(PaperTheme.faded)
                        .frame(height: 28)
                        .transition(.opacity)
                }
            }
            .animation(.easeOut(duration: 0.12), value: hovering)
            .padding(.trailing, 16)
        }
        .frame(height: PaperTheme.rowHeight)
        .contentShape(Rectangle())
        .background {
            if hovering {
                RoundedRectangle(cornerRadius: 4).fill(PaperTheme.sage.opacity(0.055)).padding(.leading, 14).padding(.trailing, 7)
            }
        }
        .onHover { hovering = $0 }
        .onTapGesture { model.openMemoID = memo.id }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { model.openMemoID = memo.id }
    }
}

private struct MemoEditor: View {
    @ObservedObject var model: AppModel
    let memo: Memo
    @State private var text: String
    @FocusState private var focused: Bool

    init(model: AppModel, memo: Memo) {
        self.model = model
        self.memo = memo
        _text = State(initialValue: memo.text)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Button(action: model.closeMemo) {
                    Label("메모 목록", systemImage: "chevron.left").labelStyle(.titleAndIcon)
                }
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PaperTheme.sage)
                .keyboardShortcut(.cancelAction)
                .help("목록으로 (Esc)")
                Spacer()
                Text(MemoDate.long(memo.updatedAt))
                    .font(.system(size: 10.5).monospacedDigit())
                    .foregroundStyle(PaperTheme.faded)
                Button { model.deleteMemo(memo.id) } label: {
                    Image(systemName: "trash").font(.system(size: 12))
                }
                .buttonStyle(QuietButtonStyle(size: 24))
                .help("메모 지우기")
                .accessibilityLabel("메모 지우기")
            }
            .padding(.horizontal, 22)
            .frame(height: 34)

            TextEditor(text: $text)
                .font(model.notebookFont.bodyFont(model.textSize))
                .scrollContentBackground(.hidden)
                .foregroundStyle(PaperTheme.ink)
                .tint(PaperTheme.accent)
                .lineSpacing(4)
                .focused($focused)
                .padding(.leading, PaperTheme.margin + 12)
                .padding(.trailing, 18)
                .padding(.vertical, 6)
                .overlay(alignment: .leading) {
                    Rectangle().fill(PaperTheme.marginRule).frame(width: 0.6)
                        .padding(.leading, PaperTheme.margin).allowsHitTesting(false)
                }
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text(L("생각나는 걸 적어 보세요").handwritten)
                            .font(model.notebookFont.bodyFont(model.textSize))
                            .foregroundStyle(PaperTheme.faded)
                            .padding(.leading, PaperTheme.margin + 17)
                            .padding(.top, 6)
                            .allowsHitTesting(false)
                    }
                }
                .accessibilityLabel("메모 내용")
                .onChange(of: text) { old, typed in model.updateMemo(memo.id, text: typed, from: old) }
                .onChange(of: memo.text) { _, newer in show(newer) }
        }
        .onAppear { focused = true }
    }

    /// Another device's edit, taken or joined with what was typed here. The caret keeps its
    /// place; mid-syllable (Korean input) it waits, and the next keystroke joins the two anyway.
    private func show(_ newer: String) {
        guard newer != text else { return }
        let editor = model.window?.firstResponder as? NSTextView
        if editor?.hasMarkedText() == true { return }
        let caret = editor.map { TextMerge.caret($0.selectedRange().location, from: text, to: newer) }
        text = newer
        if let editor, let caret {
            DispatchQueue.main.async { editor.setSelectedRange(NSRange(location: min(caret, (editor.string as NSString).length), length: 0)) }
        }
    }
}

/// Dates in the app's language regardless of the Mac's region: "오후 2:39" / "2:39 PM" / "14:39"
/// today, "9월 28일" / "Sep 28" / "28 sep" before.
enum MemoDate {
    private static let korean = Locale(identifier: "ko_KR")

    static func short(_ date: Date, language: AppLanguage = .current) -> String {
        let today = Calendar.current.isDateInToday(date)
        guard language != .ko else {
            return today
                ? date.formatted(.dateTime.hour().minute().locale(korean))
                : date.formatted(.dateTime.month().day().locale(korean))
        }
        let parts = Calendar.current.dateComponents([.month, .day, .hour, .minute], from: date)
        return today ? language.clock(hour: parts.hour!, minute: parts.minute!) : language.dayMonth(month: parts.month!, day: parts.day!)
    }

    static func long(_ date: Date, language: AppLanguage = .current) -> String {
        guard language != .ko else { return date.formatted(.dateTime.month().day().hour().minute().locale(korean)) }
        let parts = Calendar.current.dateComponents([.month, .day, .hour, .minute], from: date)
        return language.dayMonth(month: parts.month!, day: parts.day!) + ", " + language.clock(hour: parts.hour!, minute: parts.minute!)
    }
}
