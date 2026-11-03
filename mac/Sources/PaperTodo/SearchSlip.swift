import AppKit
import PaperCore
import SwiftUI

/// 검색 (1.38): ⌘F in the note, ⋯ → 검색…, the desk's sidebar. A slip over the note with a field and the
/// results grouped 오늘 · 앞으로 · 완료 기록 · 일정 (Search.find): the matched part on sage2, the date at
/// the right. ↑↓ pick, Return opens (a to-do on its tab, picked; a memo opened; a record day on the desk; an
/// event's sheet), Esc or clicking away closes.
@MainActor
final class SearchController {
    private let model: AppModel
    private let archive: ArchiveStore
    private var panel: SlipPanel?
    /// Where the slip hangs: the note's top, else the screen's.
    var anchor: () -> NSRect? = { nil }

    init(model: AppModel, archive: ArchiveStore) {
        self.model = model
        self.archive = archive
    }

    var isVisible: Bool { panel?.isVisible == true }

    func show() {
        PerfProbe.begin("search")
        let panel = panel ?? makePanel()
        panel.show(SearchView(model: model, history: archive.allEntries(), onClose: { [weak self] in self?.close() }))
        if let note = anchor() {
            panel.placeSlip(topCenter: NSPoint(x: note.midX, y: note.maxY - 54))
        } else {
            let mouse = NSEvent.mouseLocation
            let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
            if let area = screen?.visibleFrame { panel.placeSlip(topCenter: NSPoint(x: area.midX, y: area.maxY - area.height / 6)) }
        }
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    func close() { panel?.orderOut(nil) }

    private func makePanel() -> SlipPanel {
        let panel = SlipPanel(nonactivating: false)
        panel.title = L("검색")
        panel.level = .floating
        panel.collectionBehavior = [.fullScreenAuxiliary]
        panel.onResignKey = { [weak self] in self?.close() }
        self.panel = panel
        return panel
    }
}

struct SearchView: View {
    @ObservedObject var model: AppModel
    let history: [ArchiveEntry]
    var onClose: () -> Void = {}
    /// Snapshots: a query already typed.
    var previewQuery: String?
    @State private var query = ""
    /// What the results are for (#69): `query` once its keys pause (`pause`); at once when it's emptied or shortened,
    /// and on ↩ and ↑↓.
    @State private var searched = ""
    @State private var waiting: Task<Void, Never>?
    @State private var results = SearchResults()
    @State private var picked = 0
    @State private var focus = 0
    /// The results' own height (the list is as tall as them, at most 360 pt).
    @State private var listHeight: CGFloat = 120

    static let width: CGFloat = 460
    /// The wait after the last key before searching (as 메모 서랍's search).
    static var pause: Duration = .milliseconds(80)

    private func groups(for query: String) -> [(group: Search.Group, hits: [Search.Hit])] {
        results.groups(query, model: model, history: history)
    }

    /// The results for what's in the field now (↩ and ↑↓ don't wait for the pause).
    private func hitsNow() -> [Search.Hit] {
        searchNow()
        return groups(for: query).flatMap(\.hits)
    }

    private func searchNow() {
        waiting?.cancel()
        waiting = nil
        if searched != query { searched = query }
    }

    private func typed(from old: String, to new: String) {
        guard Self.pause > .zero, !new.isEmpty, new.count >= old.count else { return searchNow() }
        waiting?.cancel()
        waiting = Task { @MainActor in
            try? await Task.sleep(for: Self.pause)
            guard !Task.isCancelled else { return }
            searchNow()
        }
    }

    var body: some View {
        let groups = groups(for: searched)
        let hits = groups.flatMap(\.hits)
        PaperSlip(kind: .confirm, width: Self.width) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .confirm, symbol: "magnifyingglass", title: L("검색"), context: "⌘F", onClose: onClose)
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .medium)).foregroundStyle(PaperTheme.ink3)
                    IntentField(text: $query, placeholder: L("할 일 · 메모 · 기록 · 일정에서 찾기"), font: .systemFont(ofSize: 15, weight: .regular),
                                focusRequest: focus,
                                onSubmit: { _, _ in open(hitsNow()) },
                                onEscape: { onClose(); return true },
                                onArrow: { step in
                                    let hits = hitsNow()
                                    guard !hits.isEmpty else { return false }
                                    picked = min(max(0, picked + step), hits.count - 1)
                                    return true
                                },
                                accessibilityLabel: L("검색"))
                        .frame(height: 22)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                results(groups, picked: min(picked, max(0, hits.count - 1)))
                SlipFooter {
                    HStack(spacing: 10) {
                        KeyHint(key: "↑↓", label: L("고르기"))
                        KeyHint(key: "↩", label: L("열기"))
                        KeyHint(key: "Esc", label: L("닫기"))
                    }
                } trailing: { EmptyView() }
            }
        }
        .onChange(of: query) { old, new in
            picked = 0
            typed(from: old, to: new)
        }
        .onAppear {
            if let previewQuery {
                query = previewQuery
                searched = previewQuery
            }
            results.prepare(model: model, history: history)
            focus += 1
        }
        .onDisappear { waiting?.cancel() }
    }

    @ViewBuilder
    private func results(_ groups: [(group: Search.Group, hits: [Search.Hit])], picked: Int) -> some View {
        let trimmed = searched.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            Text(L("초성으로도 찾을 수 있어요 (예: ㅂㄱㅅ → 보고서)"))
                .font(.system(size: 12))
                .foregroundStyle(PaperTheme.ink3)
                .padding(.horizontal, 18)
                .padding(.top, 12)
        } else if groups.isEmpty {
            HStack(spacing: 10) {
                PetArt.image(.curious).map { Image(nsImage: $0).resizable().scaledToFit().frame(width: 40, height: 40) }
                Text(Search.emptyText(trimmed, language: .current))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(PaperTheme.ink2)
                    .lineLimit(2)
            }
            .padding(.horizontal, 18)
            .padding(.top, 14)
        } else {
            let offsets = groups.indices.map { index in groups[..<index].reduce(0) { $0 + $1.hits.count } }
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    // #69: only the rows in view are laid out (up to 110 rows each key).
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
                            GroupHeader(title: group.group.title(.current), count: group.hits.count, leading: 18)
                                .padding(.top, index == 0 ? 4 : 10)
                            ForEach(Array(group.hits.enumerated()), id: \.offset) { row, hit in
                                SearchRow(hit: hit, font: model.notebookFont, picked: offsets[index] + row == picked)
                                    .id(offsets[index] + row)
                                    .onTapGesture { openHit(hit) }
                            }
                        }
                    }
                    .padding(.bottom, 4)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { listHeight = $0 }
                }
                .scrollIndicators(.never)
                .scrollEdgeFade(8)
                .frame(height: min(360, listHeight))
                .onChange(of: picked) { _, row in proxy.scrollTo(row, anchor: .center) }
            }
            .padding(.top, 8)
        }
    }

    private func open(_ hits: [Search.Hit]) {
        guard hits.indices.contains(picked) else { return }
        openHit(hits[picked])
    }

    private func openHit(_ hit: Search.Hit) {
        onClose()
        switch hit.group {
        case .today, .ahead:
            if let id = UUID(uuidString: hit.id) { model.reveal(id) }
        case .memos:
            // 1.43: in 메모 서랍, opened at it.
            model.revealMemo(hit.id)
        case .history:
            model.historyDay = hit.day
            model.showHistory()
        case .events:
            guard let event = model.calendar.event(hit.id) else { return }
            model.page = .todos
            model.onShowNote?()
            model.calendar.sheet = CalendarSheetRequest(mode: .edit(event, day: hit.day), draft: .forEvent(event))
        }
    }
}

/// The slip's results (#69), kept per query while the to-dos, memos, folders, events, record and day stay the same —
/// a key, ↑↓ or a change elsewhere in the model no longer searches everything again. What one search read (each
/// title's keys, each memo's lines, the record's order, each event's next day) is kept for the next.
@MainActor
final class SearchResults {
    typealias Groups = [(group: Search.Group, hits: [Search.Hit])]
    private struct Key: Equatable {
        var items: [TodoItem]
        var memos: [Memo]
        var folders: MemoFolders
        var events: [LocalEvent]
        var history: [ArchiveEntry]
        /// Today by the 4 a.m. rule, and by the clock (a date's year).
        var day: String
        var date: String
        var language: AppLanguage
        var calendar: Calendar
    }
    private var key: Key?
    private var found: [String: Groups] = [:]
    private let index = Search.Index()
    /// Each event's next day from today (else its first), while it and the day are the same.
    private var nextDays: [String: (event: LocalEvent, today: Date, day: String)] = [:]

    func groups(_ query: String, model: AppModel, history: [ArchiveEntry], now: Date = Date()) -> Groups {
        guard !query.isEmpty else { return [] }
        let calendar = Calendar.paper
        let key = Key(items: model.items, memos: model.memos, folders: model.memoFolders, events: model.calendar.events, history: history,
                      day: Archive.dayKey(now, calendar: calendar), date: CalendarDraft.day(now, calendar: calendar), language: .current,
                      calendar: calendar)
        if key != self.key {
            self.key = key
            found = [:]
        }
        if let known = found[query] { return known }
        let words = Search.Query(query)
        let today = calendar.startOfDay(for: Archive.logicalDayStart(now, calendar: calendar))
        let events = key.events.filter { event in
            Search.match(words, in: event.title) != nil || (event.location.map { Search.match(words, in: $0) != nil } ?? false)
        }.map { event in
            Search.EventEntry(id: event.id, title: event.title, date: nextDay(event, today: today, calendar: calendar), location: event.location)
        }
        var folders: [String: String] = [:]
        for memo in key.memos { if let name = model.memoFolderName(memo.id) { folders[memo.id] = name } }
        let groups = Search.find(query, items: key.items, memos: key.memos, history: history, events: events, now: now, calendar: calendar,
                                 language: key.language, memoFolders: folders, index: index)
        if found.count > 64 { found = [:] }
        found[query] = groups
        return groups
    }

    /// The to-dos' and the record's titles read off the main thread while the slip opens, so the first key's search
    /// finds them ready.
    func prepare(model: AppModel, history: [ArchiveEntry]) {
        let items = model.items
        Task.detached(priority: .userInitiated) { [weak self] in
            let read = Search.Index.read(items: items, history: history)
            await self?.take(read)
        }
    }

    private func take(_ read: Search.Index.Read) { index.take(read) }

    /// The next day it happens from today, else its first day.
    private func nextDay(_ event: LocalEvent, today: Date, calendar: Calendar) -> String {
        if let known = nextDays[event.id], known.event == event, known.today == today { return known.day }
        let next = event.occurrences(from: today, to: calendar.date(byAdding: .day, value: 400, to: today)!, calendar: calendar, language: .current).first
        let day = next.map { Archive.dayKey($0.start, calendar: calendar) } ?? event.date
        nextDays[event.id] = (event, today, day)
        return day
    }
}

/// A result: the text (the user's words in handwriting) with the match on sage2, the date at the right.
private struct SearchRow: View {
    let hit: Search.Hit
    let font: NotebookFont
    let picked: Bool
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(hit.done ? PaperTheme.ink3 : PaperTheme.ink2)
                .frame(width: 16)
            Text(highlighted)
                .font(font.bodyFont(.small))
                .foregroundStyle(hit.done ? PaperTheme.ink3 : PaperTheme.ink)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            if !hit.detail.isEmpty {
                Text(hit.detail)
                    .font(.system(size: 11, weight: .medium).monospacedDigit())
                    .foregroundStyle(PaperTheme.ink3)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 34)
        .background(RoundedRectangle(cornerRadius: 8).fill(PaperTheme.sage.opacity(picked ? 0.12 : hovering ? 0.055 : 0)))
        .overlay(alignment: .leading) {
            if picked { Rectangle().fill(PaperTheme.sage).frame(width: 2).padding(.vertical, 7) }
        }
        .padding(.horizontal, 8)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(picked ? [.isButton, .isSelected] : .isButton)
    }

    private var symbol: String {
        switch hit.group {
        case .today, .ahead: hit.done ? "checkmark.square" : "square"
        case .memos: "note.text"
        case .history: "leaf"
        case .events: "calendar.badge.clock"
        }
    }

    /// The match drawn on sage2 (the query's own letters, or a whole syllable for a 초성).
    private var highlighted: AttributedString {
        let scalars = Array(hit.text.precomposedStringWithCanonicalMapping.unicodeScalars)
        func part(_ range: Range<Int>) -> String { String(String.UnicodeScalarView(scalars[range.clamped(to: 0..<scalars.count)])) }
        var text = AttributedString(part(0..<hit.range.lowerBound))
        var match = AttributedString(part(hit.range))
        match.backgroundColor = PaperTheme.sage2
        text += match
        text += AttributedString(part(hit.range.upperBound..<scalars.count).handwritten)
        return text
    }
}
