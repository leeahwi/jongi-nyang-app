import PaperCore
import SwiftUI

/// 도움말: everything the app does, including the gestures nobody would guess (double-click the
/// top to fold, drag the cat, …). Topics on the left, details on the right, and a search box.
struct HelpView: View {
    @State private var selected: String
    @State private var query: String

    init(topic: String = HelpTopic.all[0].id, query: String = "") {
        _selected = State(initialValue: topic)
        _query = State(initialValue: query)
    }

    var body: some View {
        VStack(spacing: 0) {
            DeskPaneHeader(title: L("도움말"), subtitle: L("궁금한 걸 찾아보세요"), cat: .happy) { searchField.frame(width: 230) }
                .padding(.horizontal, DeskMetrics.gutter - 4)
                .padding(.top, DeskMetrics.top)
                .padding(.bottom, 12)
            Rectangle().fill(PaperTheme.rule).frame(height: 1)
            HStack(spacing: 0) {
                sidebar
                Rectangle().fill(PaperTheme.rule).frame(width: 1)
                content
            }
        }
        .foregroundStyle(PaperTheme.ink)
    }

    private var searching: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    // MARK: Search and topics

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 11, weight: .semibold)).foregroundStyle(PaperTheme.ink3)
            TextField("찾기 (예: 접기, 반복)", text: $query)
                .textFieldStyle(.plain)
                .font(.system(size: 12))
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 11)) }
                    .buttonStyle(.plain).foregroundStyle(PaperTheme.ink3)
                    .accessibilityLabel("찾기 지우기")
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 30)
        .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PaperTheme.rule, lineWidth: 1) }
    }

    private var sidebar: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(HelpGroup.allCases, id: \.self) { group in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(group.title)
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundStyle(PaperTheme.ink3)
                            .padding(.horizontal, 8)
                            .padding(.bottom, 3)
                        ForEach(HelpTopic.all.filter { $0.group == group }) { topic in
                            topicRow(topic)
                        }
                    }
                }
            }
            .padding(.top, 14)
            .padding(.bottom, 12)
            .padding(.horizontal, 10)
        }
        .scrollIndicators(.hidden)
        .scrollEdgeFade()
        .frame(width: AppLanguage.current == .ko ? 196 : 214)
    }

    private func topicRow(_ topic: HelpTopic) -> some View {
        let current = selected == topic.id && !searching
        return Button { query = ""; selected = topic.id } label: {
            HStack(spacing: 9) {
                Image(systemName: topic.symbol)
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(PaperTheme.ink)
                    .frame(width: 22, height: 22)
                    .background(topic.group.color, in: RoundedRectangle(cornerRadius: 6))
                Text(topic.title)
                    .font(.system(size: 12.5, weight: current ? .semibold : .regular))
                    .foregroundStyle(current ? PaperTheme.ink : PaperTheme.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 6)
            .frame(height: 32)
            .background {
                if current { RoundedRectangle(cornerRadius: 8, style: .continuous).fill(PaperTheme.raised).shadow(color: PaperTheme.shadow.opacity(0.10), radius: 1.5, y: 1) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(current ? .isSelected : [])
    }

    // MARK: Content

    private var content: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if searching { searchResults } else { topicPage(HelpTopic.all.first { $0.id == selected } ?? HelpTopic.all[0], proxy: proxy) }
                }
                // A readable column on a big screen, centred in the space.
                .frame(maxWidth: 760, alignment: .leading)
                .padding(.horizontal, 26)
                .padding(.vertical, 22)
                .frame(maxWidth: .infinity)
            }
            .id(selected + query)
        }
    }

    @ViewBuilder
    private func topicPage(_ topic: HelpTopic, proxy: ScrollViewProxy) -> some View {
        // What the topic is about in handwriting, and a jump list.
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Label(topic.title, systemImage: topic.symbol)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PaperTheme.ink2)
                Text(topic.headline.handwritten)
                    .font(Font(HandwritingFont.native(face: .pen, size: 28)))
                    .fixedSize(horizontal: false, vertical: true)
            }
            FlowChips(items: topic.entries.map(\.title)) { title in
                withAnimation(.easeInOut(duration: 0.25)) { proxy.scrollTo(title, anchor: .top) }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(PaperTheme.rule, lineWidth: 1) }
        .padding(.bottom, 4)

        ForEach(Array(topic.entries.enumerated()), id: \.element.id) { index, entry in
            HelpEntryCard(entry: entry, number: index + 1, tint: topic.group.color).id(entry.title)
        }
        neighbours(of: topic)
        Text(verbatim: PaperTheme.copyright)
            .font(.system(size: 10.5))
            .foregroundStyle(PaperTheme.faded)
            .frame(maxWidth: .infinity)
            .padding(.top, 14)
    }

    /// 이전 · 다음 주제, so the whole guide can be read front to back.
    private func neighbours(of topic: HelpTopic) -> some View {
        let all = HelpTopic.all
        let index = all.firstIndex { $0.id == topic.id } ?? 0
        return HStack(spacing: 10) {
            if index > 0 { neighbourButton(all[index - 1], forward: false) } else { Spacer() }
            if index < all.count - 1 { neighbourButton(all[index + 1], forward: true) } else { Spacer() }
        }
        .padding(.top, 8)
    }

    private func neighbourButton(_ topic: HelpTopic, forward: Bool) -> some View {
        Button { selected = topic.id } label: {
            HStack(spacing: 8) {
                if !forward { Image(systemName: "chevron.left").font(.system(size: 10, weight: .bold)) }
                VStack(alignment: forward ? .trailing : .leading, spacing: 1) {
                    Text(forward ? L("다음") : L("이전")).font(.system(size: 10)).foregroundStyle(PaperTheme.faded)
                    Text(topic.title).font(.system(size: 12.5, weight: .semibold)).lineLimit(1)
                }
                if forward { Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)) }
            }
            .foregroundStyle(PaperTheme.ink)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 46, alignment: forward ? .trailing : .leading)
            .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).stroke(PaperTheme.rule, lineWidth: 0.7) }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var searchResults: some View {
        let hits = HelpTopic.search(query)
        HStack(spacing: 10) {
            Image(nsImage: PetArt.image(hits.isEmpty ? .sleep : .curious) ?? PaperTheme.mascot)
                .resizable().scaledToFit().frame(width: 52, height: 52)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("‘\(query)’").font(Font(HandwritingFont.native(face: .pen, size: 24)))
                Text(hits.isEmpty ? L("맞는 내용이 없어요. 다른 말로 찾아볼까요?") : L("찾은 내용 \(hits.count)개"))
                    .font(.system(size: 12)).foregroundStyle(PaperTheme.secondary)
            }
        }
        .padding(.bottom, 4)
        ForEach(hits, id: \.entry.id) { hit in
            VStack(alignment: .leading, spacing: 5) {
                Button { query = ""; selected = hit.topic.id } label: {
                    Label(hit.topic.title, systemImage: hit.topic.symbol)
                        .font(.system(size: 10.5, weight: .semibold))
                        .foregroundStyle(PaperTheme.ink.opacity(0.65))
                        .padding(.horizontal, 8)
                        .frame(height: 20)
                        .background(hit.topic.group.color, in: Capsule())
                }
                .buttonStyle(.plain)
                .help("이 주제로 가기")
                HelpEntryCard(entry: hit.entry, number: nil, tint: hit.topic.group.color)
            }
        }
    }
}

/// The four groups in the topic list, each with one of the paper's tints.
enum HelpGroup: CaseIterable {
    case basics, screens, cat, more

    var title: String {
        switch self {
        case .basics: L("기본")
        case .screens: L("화면과 기록")
        case .cat: L("종이냥")
        case .more: L("더 알아보기")
        }
    }

    var color: Color {
        switch self {
        case .basics: PaperTheme.tabToday
        case .screens: PaperTheme.sage2
        case .cat: PaperTheme.tabMemo
        case .more: PaperTheme.tabAhead
        }
    }
}

/// Small capsules that wrap onto new lines; tapping one jumps to that entry.
private struct FlowChips: View {
    let items: [String]
    let action: (String) -> Void

    var body: some View {
        WrapLayout(spacing: 6) {
            ForEach(items, id: \.self) { item in
                Button { action(item) } label: {
                    Text(item)
                        .font(.system(size: 11))
                        .foregroundStyle(PaperTheme.ink2)
                        .padding(.horizontal, 9)
                        .frame(height: 22)
                        .background(PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// A minimal flow layout: rows of subviews that wrap at the available width.
private struct WrapLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

private struct HelpEntryCard: View {
    let entry: HelpEntry
    let number: Int?
    let tint: Color

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let number {
                Text("\(number)")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(PaperTheme.ink.opacity(0.7))
                    .frame(width: 22, height: 22)
                    .background(tint, in: Circle())
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(entry.title).font(.system(size: 13.5, weight: .semibold))
                Text(entry.body)
                    .font(.system(size: 12.5))
                    .foregroundStyle(PaperTheme.secondary)
                    .lineSpacing(3.5)
                    .fixedSize(horizontal: false, vertical: true)
                if !entry.keys.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(entry.keys, id: \.self) { key in HelpKeyCap(text: key) }
                    }
                    .padding(.top, 2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(PaperTheme.rule.opacity(0.9), lineWidth: 0.7) }
        .accessibilityElement(children: .combine)
    }
}

/// A key or gesture written like a keyboard key.
private struct HelpKeyCap: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold).monospacedDigit())
            .foregroundStyle(PaperTheme.ink.opacity(0.8))
            .padding(.horizontal, 7)
            .frame(height: 21)
            .background {
                RoundedRectangle(cornerRadius: 5).fill(PaperTheme.card)
                    .shadow(color: .black.opacity(0.12), radius: 0, y: 1.2)
            }
            .overlay { RoundedRectangle(cornerRadius: 5).stroke(PaperTheme.rule, lineWidth: 0.7) }
    }
}

struct HelpEntry: Identifiable {
    let title: String
    let body: String
    var keys: [String] = []
    var id: String { title }
}

struct HelpTopic: Identifiable {
    let id: String
    var group: HelpGroup {
        switch id {
        case "start", "tasks", "tabs", "alerts": .basics
        case "window", "memo", "history", "calendar": .screens
        case "pet", "timer", "alarm": .cat
        default: .more
        }
    }
    let title: String
    let symbol: String
    let pose: PetArt.Pose
    let headline: String
    let entries: [HelpEntry]

    static func search(_ query: String) -> [(topic: HelpTopic, entry: HelpEntry)] {
        let words = query.lowercased().split(separator: " ").map(String.init)
        return all.flatMap { topic in
            topic.entries.compactMap { entry in
                let haystack = (topic.title + " " + entry.title + " " + entry.body + " " + entry.keys.joined(separator: " ")).lowercased()
                return words.allSatisfy { haystack.contains($0) } ? (topic, entry) : nil
            }
        }
    }

    static let all: [HelpTopic] = [
        HelpTopic(id: "start", title: L("시작하기"), symbol: "sparkles", pose: .happy, headline: L("하루에 한 장, 가볍게"), entries: [
            HelpEntry(title: L("종이냥은 어떤 앱인가요?"), body: L("오늘 할 일만 종이 한 장에 적어 두는 작은 노트예요. 적고, 체크하고, 끝내면 종이냥이 축하해 줘요. 인터넷이나 로그인 없이 이 Mac에 저장되고, 원하면 iCloud Drive 같은 공유 폴더로 여러 기기에서 같은 목록을 쓸 수 있어요.")),
            HelpEntry(title: L("창을 닫아도 계속 실행돼요"), body: L("노트를 닫아도 앱은 메뉴 막대의 종이냥 얼굴로 남아 알림을 계속 보내요. 얼굴을 누르면 오늘 창이, ⌘0을 누르면 노트가 다시 열려요. 완전히 끄려면 ⌘Q."), keys: ["⌘0", "⌘Q"]),
            HelpEntry(title: L("로그인할 때 켜기"), body: L("처음 안내 마지막 카드의 ‘로그인할 때 같이 열기’나 책상 → 알림 → 시작의 ‘로그인 시 종이냥 실행’을 켜면 Mac에 로그인할 때 종이냥이 바로 켜져요. 꺼 둔 채로 세 번 직접 켜면 종이냥이 한 번 물어봐요.")),
            HelpEntry(title: L("처음 안내 다시 보기"), body: L("⋯ 메뉴 → 사용 안내, 또는 메뉴 막대의 도움말 → 사용 안내에서 처음에 본 카드 안내를 다시 볼 수 있어요.")),
        ]),
        HelpTopic(id: "tasks", title: L("할 일"), symbol: "checklist", pose: .blink, headline: L("적고, 체크하고, 끝"), entries: [
            HelpEntry(title: L("할 일 적기"), body: L("맨 아래 입력 줄(‘무엇이든 적어요’)에 쓰고 Return을 눌러요. 노트에서 ⌘N을 누르면 바로 그 줄로 가요."), keys: ["Return", "⌘N"]),
            HelpEntry(title: L("입력 줄은 할 일만이 아니에요"), body: L("같은 줄에 일정 · 타이머 · 알람 · 메모도 적어요. 적는 동안 줄 위의 칩이 무엇으로 알아들었는지 보여 주고, Tab으로 다른 뜻을 골라요. 자세한 건 ‘빠른 입력’ 주제에 있어요."), keys: ["Tab"]),
            HelpEntry(title: L("날짜와 시간은 적기만 하세요"), body: L("‘내일 3시 엄마께 전화’처럼 쓰면 내일 오후 3시 알림이, ‘금요일까지 보고서’처럼 쓰면 금요일 마감이 저절로 붙어요. 오늘·내일·모레, 월요일·다음 주 화요일, 10월 5일·10/5, 오후 2시 반·15:30 같은 말을 알아들어요. 그대로 적고 싶으면 Shift+Return."), keys: [L("Shift+Return 그대로")]),
            HelpEntry(title: L("키보드로 다루기"), body: L("↑↓로 줄을 고르고, Space로 완료, Return으로 고치기, ⌫로 지우기, ⌘↑↓로 순서를 바꿔요. 빈 입력 칸에서 ↑를 누르면 마지막 줄로 가요. Esc로 고르기를 풀어요."), keys: ["↑↓", "Space", "Return", "⌫", "⌘↑↓"]),
            HelpEntry(title: L("완료하기"), body: L("왼쪽 네모를 누르면 글씨에 연필 선이 그어지며 완료돼요. 한 번 더 누르면 완료가 취소돼요.")),
            HelpEntry(title: L("바로 고치기"), body: L("할 일 글자를 누르면 바로 고칠 수 있어요. Return이나 다른 곳을 누르면 저장, Esc는 취소예요."), keys: ["Return", "Esc"]),
            HelpEntry(title: L("순서 바꾸기"), body: L("줄에 마우스를 올리면 왼쪽에 점 여섯 개 손잡이가 보여요. 잡고 위아래로 끌면 초록 선 자리로 옮겨져요. 우클릭 → 위로/아래로 이동도 있어요.")),
            HelpEntry(title: L("지우기와 되돌리기"), body: L("줄에 마우스를 올리면 오른쪽 끝에 휴지통이 나타나요. 지우면 아래에 ‘지웠어요 · 되돌리기’가 잠깐 떠요. ⌘Z로도 되돌리고, ⇧⌘Z로 다시 실행해요. 메모를 지울 때, 알림의 ‘모두 끝냄’, 완료한 일 정리도 같은 안내로 되돌릴 수 있어요."), keys: ["⌘Z", "⇧⌘Z"]),
            HelpEntry(title: L("내일로 · 날짜 바꾸기"), body: L("오늘 탭의 줄에 마우스를 올리면 ‘→ 내일’로 내일 할 일로 옮겨요. 우클릭 → 날짜 바꾸기에서 내일 · 이번 주 금요일(월–목요일에만) · 다음 주 월요일 · 언젠가 · 날짜 고르기…를 골라요. 줄을 고른 뒤 ⌥→는 하루 뒤로, ⌥←는 하루 앞으로(오늘보다 앞으로는 안 가요), ⌥↓는 언젠가로. 옮기면 ‘내일로 옮겼어요 · 되돌리기’가 떠요."), keys: ["⌥→", "⌥←", "⌥↓"]),
            HelpEntry(title: L("어제부터 · 3일째"), body: L("날짜 없이 오늘 탭에 있던 할 일이 하루를 넘기면 줄 끝에 ‘어제부터’, 더 오래면 ‘3일째’처럼 작게 적혀요. 마감을 정하거나, 끝내거나, 언젠가로 옮기면 사라져요. 이 날짜는 할 일과 함께 저장돼서 다른 기기(Windows 포함)에서도 같아요.")),
            HelpEntry(title: L("검색"), body: L("⌘F(⋯ → 검색…, 책상 왼쪽 위 ‘검색’)를 누르면 노트 위에 검색 쪽지가 떠요. 오늘 · 앞으로 · 메모 · 완료 기록 · 일정에서 찾고, 맞는 글자는 연한 초록으로 칠해져요. ‘ㅂㄱㅅ’처럼 초성으로도 찾고, 영어와 네덜란드어는 대소문자와 악센트를 가리지 않아요. ↑↓로 고르고 Return으로 열어요 — 할 일은 그 탭에서, 메모는 열리고, 완료 기록은 그날이, 일정은 고치기 쪽지가 떠요."), keys: ["⌘F", "↑↓", "Return", "Esc"]),
            HelpEntry(title: L("완료한 일 숨기기·정리"), body: L("아래쪽 ‘완료 숨기기’를 누르면 끝낸 일이 목록에서 잠시 숨겨져요. ⋯ → 완료한 일 정리를 누르면 오늘 끝낸 일을 바로 완료 기록으로 옮겨요.")),
            HelpEntry(title: L("다음 · 그 밖에"), body: L("오늘 안에 알림이나 정한 시간이 남은 할 일과 시간이 정해진 반복은 위쪽 ‘다음’에 시간순으로 세 개까지 모여요. 나머지는 아래 ‘그 밖에’에 있어요. 순서는 각 묶음 안에서 바꿔요.")),
            HelpEntry(title: L("진행 표시"), body: L("제목 옆 작은 원과 ‘2 / 5 끝냈어요’가 오늘 할 일 중 끝낸 개수예요. 끝낼수록 원이 초록으로 차요.")),
        ]),
        HelpTopic(id: "quick", title: L("빠른 입력"), symbol: "text.cursor", pose: .happy, headline: L("한 줄에 무엇이든"), entries: [
            HelpEntry(title: L("입력 줄이 알아듣는 것"), body: L("‘내일 3시 회의’는 일정, ‘내일 3시 장보기’는 알림 달린 할 일, ‘금요일까지 보고서’는 마감 있는 할 일, ‘타이머 40’ · ‘40분 집중’은 타이머, ‘알람 7시 평일’은 알람, 여러 줄은 메모로 알아들어요. 회의 · 약속 · 치과처럼 일정다운 말이 있으면 일정을 먼저 골라요.")),
            HelpEntry(title: L("칩과 Tab"), body: L("적는 동안 줄 위에 알아들은 뜻이 칩으로 보이고, 초록 테두리가 지금 고른 것이에요. Tab(⇧Tab)이나 칩을 눌러 다른 뜻을 고르고 Return으로 넣어요. Shift+Return은 적은 그대로 할 일로."), keys: ["Tab", "⇧Tab", "Return"]),
            HelpEntry(title: L("/ 로 종류 고르기"), body: L("맨 앞에 /할일 · /일정 · /메모 · /타이머 · /알람을 쓰면 그 종류로만 넣어요. 알람 시간이나 타이머 길이를 알아듣지 못하면 줄 아래에 붉은 글씨로 알려 줘요.")),
            HelpEntry(title: L("반복으로 넣기"), body: L("‘매일 물 마시기’, ‘평일 8시 운동’, ‘매주 월 9시 주간 회의’, ‘매월 15일 카드값’처럼 반복하는 말로 시작하면 반복 할 일이 돼요(시각이 있으면 그 시각에 알림). 회의처럼 일정다운 말이면 반복 일정이 먼저 나오고 Tab으로 바꿔요. ‘/반복’으로 시작해도 돼요. 만든 반복은 책상 → 반복에 있어요.")),
            HelpEntry(title: L("시간을 정해 넣기"), body: L("‘3시부터 5시까지 보고서’, ‘14:00-15:30 보고서’, ‘보고서 2시~4시’, ‘오후 2시부터 1시간 보고서’처럼 적으면 그 시간에 할 일이 돼요(칩: 할 일 · 오늘 14:00–15:30). Tab을 누르면 같은 시간의 일정으로 넣어요.")),
            HelpEntry(title: L("몇 분 뒤 알림"), body: L("‘30분 뒤 빨래 꺼내기’, ‘2시간 뒤 회의 준비’, ‘1시간 반 후 약 먹기’처럼 적으면 지금부터 그만큼 뒤에 알림이 울리는 할 일이 돼요.")),
            HelpEntry(title: L("넣은 뒤 바꾸기"), body: L("넣고 나면 아래에 ‘일정으로 넣었어요 · 할 일로 바꾸기’ 같은 안내가 4초 떠요. ‘바꾸기’를 누르면 방금 것은 흔적 없이 지우고 다른 뜻으로 다시 넣어요. 같은 말을 두 번 바꾸면 다음부터 그쪽으로 먼저 알아들어요. 바로 ⌘Z를 누르면 넣은 것을 되돌려요."), keys: ["⌘Z"]),
            HelpEntry(title: L("어디서든 ⌃⌥N"), body: L("다른 앱을 쓰다가 ⌃⌥N을 누르면 같은 입력 줄이 쪽지로 떠요. ⌘Return은 일정으로 넣어요. 책상 → 꾸미기 → 빠른 입력에서 끌 수 있어요."), keys: ["⌃⌥N", "⌘↩", "Esc"]),
            HelpEntry(title: L("메모 탭에서는"), body: L("메모 탭의 입력 줄은 적은 글을 바로 새 메모로 넣어요.")),
        ]),
        HelpTopic(id: "tabs", title: L("앞으로"), symbol: "arrow.forward.circle", pose: .curious, headline: L("이번 주 · 다음 주 · 언젠가"), entries: [
            HelpEntry(title: L("세 개의 탭"), body: L("위쪽 색 탭 오늘 · 앞으로 · 메모를 누르거나 ⌘1–⌘3으로 옮겨 다녀요. 탭 옆 숫자는 아직 안 끝낸 개수예요(창이 좁으면 숨겨져요)."), keys: [L("⌘1 오늘"), L("⌘2 앞으로"), L("⌘3 메모")]),
            HelpEntry(title: L("오늘"), body: L("오늘 할 일이에요. 알림·주기 알림·접은 포스트잇은 모두 오늘 탭의 할 일만 세어요.")),
            HelpEntry(title: L("앞으로"), body: L("내일부터 이번 주와 다음 주의 날마다 그날 일정(색 막대 · 시간 · 제목)과 그날 마감인 할 일이 함께 있어요. 다음 주 뒤의 마감은 ‘그 뒤’에 달별로, 날짜 없는 일은 맨 아래 ‘언젠가’에 모여요. 마감 날이 되면 저절로 오늘 탭으로 올라와요(새벽 4시 기준). 일정을 누르면 고치고, 우클릭하면 메뉴가 나와요.")),
            HelpEntry(title: L("다른 날로 끌어 옮기기"), body: L("앞으로 탭에서 줄 왼쪽 손잡이를 잡고 다른 날에 놓으면 마감이 그날로 바뀌어요. 끄는 동안은 빈 날도 보이고, 놓을 날이 초록으로 표시돼요. ‘언젠가’에 놓으면 날짜가 빠지고, 위쪽 ‘오늘’ 탭에 놓으면 오늘 할 일이 돼요. 같은 날 안에서는 순서를 바꿔요. 아래 안내의 ‘되돌리기’나 ⌘Z로 되돌려요."), keys: ["⌘Z"]),
            HelpEntry(title: L("앞으로 탭에서 적기"), body: L("앞으로 탭의 입력 줄에 날짜 없이 적으면 언젠가에, ‘금요일까지 보고서’처럼 날짜가 있으면 그날에 들어가요.")),
            HelpEntry(title: L("탭 사이로 옮기기"), body: L("오늘 탭의 줄에 마우스를 올리면 ‘↓ 언젠가’, 앞으로 탭에서는 ‘↑ 오늘로’ 버튼이 나타나요. 우클릭 메뉴에도 있어요. 오늘 탭에서 줄을 위쪽 ‘앞으로’ 탭에 끌어 놓으면 마감 날짜가 아직 안 온 일은 그날로, 마감이 없는 일은 언젠가로 가요.")),
        ]),
        HelpTopic(id: "alerts", title: L("알림·반복·마감"), symbol: "bell", pose: .stretch, headline: L("잊지 않게 종이냥이 알려 줘요"), entries: [
            HelpEntry(title: L("알림 창 열기"), body: L("줄에 마우스를 올려 종 모양 버튼을 누르거나, 줄 끝의 시간·마감 글자를 누르면 그 줄에 붙은 작은 창이 열려요. 위쪽에서 한 번 알림 · 반복 · 마감을 골라요.")),
            HelpEntry(title: L("한 번 알림"), body: L("10분 뒤 · 30분 뒤 · 1시간 뒤 · 내일 오전 9시 중에 고르거나, ‘다른 날짜·시간’에서 달력과 시간을 정해요. 지난 시간은 고를 수 없어요. 알림 시각은 줄 끝에 ‘◷ 오늘 11:30’처럼 적혀요.")),
            HelpEntry(title: L("반복"), body: L("매일 · 평일 · 매주(요일 여러 개) · 매월(없는 날은 말일)을 고르고, 같은 자리에서 알림 시각을 켜요. 반복하는 날마다 목록에 한 줄씩 나타나고, 전날 것을 못 끝냈으면 새로 쌓지 않고 그 줄을 오늘로 옮겨요. 모든 반복은 책상 → 반복에서 고치거나 지워요.")),
            HelpEntry(title: L("마감"), body: L("오늘까지 · 이번 주 안 · 이번 달 안 · 날짜 지정 중에 골라요. 마감 날이 남았으면 ‘앞으로’ 탭의 그날에서 기다리고, ‘오늘 할 일에도 두기’를 켜면 오늘 탭에도 계속 보여요. 표시는 설정에서 D-3 또는 ~금 중에 골라요.")),
            HelpEntry(title: L("시간 정하기"), body: L("할 일에 그날 할 시간을 정해 둘 수 있어요. 줄을 우클릭 → 시간 정하기…, 또는 알림 창의 ‘시간’에서 시작과 끝(15분 단위 목록, 직접 적어도 돼요)을 고르고 30분 · 1시간 · 2시간으로 길이를 정해요. 알림이 없던 할 일은 시작할 때 알림이 맞춰지고, 시간을 옮기면 시작에 맞춘 알림도 함께 옮겨져요. 시간은 마감 날, 마감이 없으면 오늘의 시간이에요. ‘시간 지우기’로 없애요.")),
            HelpEntry(title: L("알림이 오면"), body: L("화면 오른쪽 아래에 종이냥이 말풍선을 들고 와요(펫이 있으면 펫 위에 떠요). 네모를 눌러 하나씩 끝내거나 ‘모두 끝냄’(노트에 ‘3개 끝냈어요 · 되돌리기’), ‘내일로’는 내일 할 일로 옮겨요. 왼쪽 ‘10분 뒤 다시’ 옆 화살표에는 5분 · 10분 · 30분 · 1시간 뒤, 오늘 저녁 7시(오후 6시 전에만), 내일 아침 9시, 내일로 미루기가 있어요. 제목이나 종이냥을 누르면 노트가 열려요.")),
            HelpEntry(title: L("저녁 정리"), body: L("남은 할 일이 있으면 저녁(기본 오후 8시)에 종이냥이 ‘오늘 3개 남았어요. 내일로 넘길까요?’ 하고 물어요. 남길 일은 체크를 풀고 내일로 · 언젠가로 · 그대로 두기를 골라요. 하루 한 번 오고, 집중하는 동안은 기다려요. 그날 저녁을 놓치면 다음 날 처음 노트를 열 때 ‘아침 정리’로 어제 남은 일을 물어봐요. 책상 → 알림 → 하루 정리에서 끄거나 시각(오후 6시–10시)을 바꿔요.")),
            HelpEntry(title: L("오늘 꼭 하나"), body: L("책상 → 알림 → 하루 정리에서 켜면, 새 날 처음 노트를 열 때 빈 입력 줄이 ‘오늘 꼭 하나만 고른다면?’ 하고 물어요. 처음 적은 할 일이 별과 함께 ‘다음’ 맨 위에 오고, 별은 그날이 지나면 사라져요. 할 일 우클릭 → 오늘 꼭 하나로도 골라요.")),
            HelpEntry(title: L("macOS 알림으로도"), body: L("책상 → 알림 → ‘시스템 알림으로도 보내기’: 놓친 것만(기본)이면 화면이 잠겨 있거나, 고양이와 노트가 모두 숨어 있거나, 다른 앱이 화면 전체를 쓰고 있을 때 macOS 알림으로도 보내요. 알림의 ‘끝냄’ · ‘10분 뒤’(알람은 ‘끄기’ · ‘다시 알림’)를 바로 누를 수 있고, 알림을 누르면 노트가 열려요. 항상 · 끄기도 골라요. 처음 보낼 때 macOS가 허락을 물어봐요. 집중 모드(방해 금지)는 알아차리지 못해요.")),
            HelpEntry(title: L("주기 알림"), body: L("남은 할 일이 있으면 정해 둔 간격(기본 30분)마다 한 번에 모아서 알려 줘요. 노트를 쓰는 동안은 기다렸다 알려요. 책상 → 알림에서 간격, 표시 시간, 모양(미니·쪽지·친구)을 고르고 미리보기로 확인해요.")),
            HelpEntry(title: L("앱이 켜져 있어야 해요"), body: L("알림은 앱이 실행 중일 때 동작해요. 창을 닫거나 접어도 괜찮지만 ⌘Q로 끄면 멈춰요. 꺼져 있는 동안 지난 알림은 다음에 켤 때 한 번 알려 줘요.")),
        ]),
        HelpTopic(id: "window", title: L("창 다루기"), symbol: "macwindow", pose: .stretch, headline: L("작게 접고, 원하는 곳에"), entries: [
            HelpEntry(title: L("창 옮기기"), body: L("위쪽 날짜·제목 줄이나 탭 옆 빈 곳을 잡고 끌어요. 목록 쪽을 끌면 창이 아니라 할 일이 움직여요.")),
            HelpEntry(title: L("작은 포스트잇으로 접기"), body: L("위쪽을 두 번 누르거나, 노란 최소화 버튼, ⋯ → 포스트잇으로 접기, ⌘M을 누르면 노트가 종이냥이 붙잡은 작은 포스트잇으로 접혀요. 포스트잇에는 남은 할 일이 3줄까지 보여요. 두 번 누른 자리에 접혀요."), keys: [L("두 번 클릭"), "⌘M"]),
            HelpEntry(title: L("포스트잇 다루기"), body: L("포스트잇을 누르면 노트가 다시 펼쳐지고, 끌면 자리를 옮겨요. 옮긴 자리를 기준으로 노트가 열려요. 우클릭하면 숨기기·종료 메뉴가 있어요.")),
            HelpEntry(title: L("항상 위에 두기"), body: L("위쪽 핀 모양 버튼을 누르면 다른 창 위에 노트가 떠 있어요. 한 번 더 누르면 풀려요.")),
            HelpEntry(title: L("메뉴 막대와 오늘 창"), body: L("메뉴 막대의 종이냥 얼굴 옆에는 타이머가 도는 동안 남은 시간이, 1시간 안에 일정이나 알림이 있으면 ‘치과 40분’처럼 글자가 나와요. 얼굴을 누르면 오늘 창이 내려와 다음 일정 · 타이머 · 다음 알람 세 칸(1시간 안의 것은 붉게)과 ‘다음’ · 오늘 할 일 몇 개(바로 체크), 입력 줄, 노트 열기 · 책상 · 종이냥 숨기기가 보여요. Esc나 다른 곳을 누르면 닫혀요. 우클릭하면 짧은 메뉴가 나와요. 글자는 책상 → 꾸미기 → 메뉴 막대에서 숨길 수 있어요. 타이머가 도는 동안에는 얼굴 둘레에 얇은 고리가 차올라요. 빈 칸도 눌러 보세요: 일정이 없으면 새 일정, 타이머 칸은 ‘타이머 25’, 알람 칸은 ‘알람 7시’를 입력 줄에 적어 줘요."), keys: ["Esc"]),
            HelpEntry(title: L("어디서든 불러오기"), body: L("다른 앱을 쓰다가도 ⌃⌥J를 누르면 노트가 앞으로 나오고(포스트잇으로 접혀 있으면 펼쳐져요), 노트가 맨 앞에 있을 때 누르면 넣어 둬요. 책상 → 꾸미기 → 빠른 입력에서 끌 수 있어요."), keys: ["⌃⌥J"]),
            HelpEntry(title: L("화면 가장자리에 붙이기"), body: L("⋯ → 화면 오른쪽에 붙이기 / 왼쪽에 붙이기(윈도우 메뉴에도 있어요)를 누르면 노트가 그 화면 가장자리에 위아래로 길게 붙어요(너비는 그대로). 같은 메뉴를 한 번 더 누르면 원래 자리로 돌아가요.")),
            HelpEntry(title: L("Dock"), body: L("Dock의 종이냥 아이콘을 우클릭하면 빠른 입력 · 빠른 메모 · 책상 · 25분 집중 · 5분 타이머가 있어요. 책상 → 꾸미기 → 메뉴 막대의 ‘Dock에 남은 개수’를 켜면 아이콘에 오늘 남은 할 일 수가 작게 떠요.")),
            HelpEntry(title: L("창이 낮을 때"), body: L("노트 높이가 480 이하이면 제목 줄이 한 줄로 줄어 목록이 더 많이 보여요.")),
            HelpEntry(title: L("크기와 위치"), body: L("창 가장자리를 끌어 크기를 바꿔요(최소 350 × 400). 크기·위치·탭·완료 숨김·핀 상태는 다음에 켤 때도 기억해요. 창이 좁으면 탭 숫자가 숨어요. 위쪽 오른쪽에는 핀 · 책상 · ⋯ 세 버튼이 있어요.")),
        ]),
        HelpTopic(id: "memo", title: L("메모"), symbol: "note.text", pose: .tea, headline: L("떠오른 생각은 메모에"), entries: [
            HelpEntry(title: L("메모 쓰기"), body: L("메모 탭에서 ‘새 메모’를 누르거나 ⇧⌘N. 첫 줄이 제목이 되고, 쓰는 대로 자동 저장돼요. Esc나 ‘메모 목록’으로 돌아가요."), keys: ["⇧⌘N", "Esc"]),
            HelpEntry(title: L("빠른 메모"), body: L("다른 앱을 쓰다가도 ⌃⌥M을 누르면 메모 칸이 떠요. 여러 줄을 적고 ⌘Return이면 메모 탭 맨 위에 새 메모로 들어가요. Esc나 다른 곳을 누르면 닫히고, 쓰던 글은 다음에 열 때 그대로 있어요. 펫 우클릭 → 빠른 메모, ⋯ → 빠른 메모…, 파일 메뉴에서도 열려요. 책상 → 꾸미기 → 빠른 입력에서 끌 수 있어요."), keys: ["⌃⌥M", "⌘↩", "Esc"]),
            HelpEntry(title: L("복사한 글 넣기"), body: L("책상 → 꾸미기 → 빠른 입력의 ‘빠른 메모를 열 때 복사한 글 넣기’를 켜면, 빈 빠른 메모를 열 때 지난번 이후 2분 안에 복사한 글이 골라진 채로 들어가요. 그대로 ⌘Return으로 넣거나, 그냥 적으면 바뀌어요.")),
            HelpEntry(title: L("지우기와 되돌리기"), body: L("메모 줄에 마우스를 올리면 시간 자리에 휴지통이 나타나요. 지우면 ‘메모를 지웠어요 · 되돌리기’가 잠깐 뜨고, 아래쪽 ‘지운 메모 되돌리기’로도 살려요. 아무것도 안 쓴 메모는 닫으면 저절로 사라져요.")),
        ]),
        HelpTopic(id: "history", title: L("완료 기록"), symbol: "leaf", pose: .cheer, headline: L("한 일은 잔디로 남아요"), entries: [
            HelpEntry(title: L("끝낸 일은 어디로 가나요?"), body: L("완료한 일은 그날까지 목록에 남았다가 다음 날 새벽 4시가 지나면 완료 기록으로 옮겨져요. 새벽 4시 전에 끝낸 일은 전날 한 일로 쳐요. 책상 → 저장과 백업 → 완료한 일에서 다음 날 / 3일 뒤 / 7일 뒤 / 보관 안 함을 골라요.")),
            HelpEntry(title: L("완료 기록 보기"), body: L("아래쪽 ‘완료 기록’이나 ⌘Y로 책상의 완료 기록이 열려요. 깃허브처럼 날마다 끝낸 개수를 초록 잔디로 보여 주고, 연속 기록·월별 막대도 있어요. 칸을 누르면 그날 끝낸 일과 시각이 보여요. 집중 칸에는 기간의 집중 시간이, 칸 위에 올리면 그날 집중한 시간이 보여요."), keys: ["⌘Y"]),
        ]),
        HelpTopic(id: "calendar", title: L("일정 · 달력"), symbol: "calendar", pose: .curious, headline: L("오늘 일정도 한 장에"), entries: [
            HelpEntry(title: L("하루 띠"), body: L("오늘 일정이나 시간을 정한 할 일, 알림이 있으면 제목 아래에 하루 띠가 보여요. 맨 위에는 종일 일정과 ‘하루 전체 ›’, 그 아래 얇은 막대에 오늘 하루(8시부터 24시까지, 더 이르거나 늦으면 늘어나요)가 있어요: 일정은 제 색으로, 시간을 정한 할 일은 초록으로, 지난 시간은 조금 어둡게, 지금은 붉은 눈금으로. 가운데에는 지금 하는 일이 크게 적히고, 옆 동그라미에 남은 시간(‘40분 남음’)이 보여요. 지금 하는 일이 없으면 다음 일과 그때까지 남은 시간(‘40분 뒤’, 1시간 안이면 붉게)이 보여요. 그 아래에는 다음 일이 두 줄(좁은 노트는 한 줄, 큰 노트는 세 줄)이에요. 지금 하는 일이 할 일이면 동그라미를 눌러 바로 집중하고, 칸에 체크해 끝낼 수 있어요. ‘하루 전체 ›’나 막대를 누르면 그 자리에서 하루 일정표가 펼쳐져요: 한 시간에 한 칸, 일정은 색 블록, 할 일은 초록 테두리 블록, 알림은 작은 이름표(겹치면 나란히, 넷째부터는 ‘+N’). 할 일이나 일정 블록을 끌면 15분씩 옮겨지고, 할 일 아래 손잡이를 끌면 끝 시간이 바뀌어요(안내의 ‘되돌리기’로 되돌려요). 빈 칸을 누르면 그 시간에 넣을 할 일이나 일정을 적고, 두 번 누르면 새 일정 쪽지가 열려요. ↑↓로 고르고 Return으로 열고, Space로 할 일을 끝내고, ⌥↑↓로 15분씩 옮겨요. ‘접기’나 Esc로 접어요(펼쳐 두면 그날은 펼친 채로 있어요). 책상 → 일정 → 하루 띠 보이기로 끌 수 있어요."), keys: ["↑↓", "Return", "Space", "⌥↑↓", "Esc"]),
            HelpEntry(title: L("새 일정 만들기"), body: L("입력 줄에 ‘내일 3시 회의’처럼 적고 Return(칩이 ‘일정’인지 확인), ⋯ → 새 일정, 달력에서 날짜를 두 번 누르기, 빠른 입력(⌃⌥N)에서 ⌘Return. 제목 · 날짜 · 시간(또는 종일) · 반복 · 색 · 장소를 정해요. 날짜와 시간은 칩을 누르면 작은 달력과 15분 단위 목록이 열리고, ‘17:20’처럼 직접 적을 수도 있어요."), keys: ["⌘↩"]),
            HelpEntry(title: L("반복 · 색"), body: L("반복은 매일 · 매주 · 매월 · 매년. 31일처럼 없는 날은 그 달을 건너뛰어요. 반복하는 일정을 고치면 모든 날이 함께 바뀌고, 지울 땐 ‘이 날만’ 또는 ‘모두 지우기’를 골라요. 색은 여섯 가지예요.")),
            HelpEntry(title: L("할 일을 일정으로"), body: L("할 일 줄을 우클릭 → ‘달력에 넣기…’. 할 일의 알림 시각이나 마감으로 날짜를 채워 주고, 넣은 할 일 끝에는 작은 달력이 붙어요. 넣은 뒤 할 일을 고쳐도 일정은 그대로예요.")),
            HelpEntry(title: L("일정 알림"), body: L("책상 → 일정 → 일정 알림에서 5 · 10 · 15 · 30분 전을 고르면, 시작 전에 할 일 알림과 같은 말풍선으로 한 번 알려 줘요. 제목을 누르면 달력이 그 날로 열려요. ‘5분 전에 다시’를 누르면 시작 5분 전에 한 번 더 알려 줘요.")),
            HelpEntry(title: L("달력"), body: L("노트 위쪽의 책상 버튼, ⋯ → 달력, ⌘D로 책상의 달력이 열려요. 월 · 주로 일정과 마감을 한눈에 보고, 날짜를 누르면 오른쪽에 그날 일정과 할 일이 보여요. 두 번 누르면 새 일정."), keys: ["⌘D"]),
            HelpEntry(title: L("어디에 저장되나요?"), body: L("일정은 할 일과 같은 저장 폴더의 events.json에 있어요. 공유 폴더를 쓰면 다른 기기의 종이냥과 함께 써요. 인터넷 계정에 연결하지 않아요.")),
        ]),
        HelpTopic(id: "backup", title: L("백업 · 옮기기"), symbol: "square.and.arrow.up", pose: .happy, headline: L("다른 컴퓨터로 그대로"), entries: [
            HelpEntry(title: L("내보내기"), body: L("책상 → 저장과 백업 → 백업 · 옮기기 → 내보내기…, 또는 파일 → 모두 내보내기(⇧⌘E). 할 일 · 메모 · 반복 · 일정 · 알람 · 집중 기록 · 완료 기록이 .jongi 파일 하나에 담겨요."), keys: ["⇧⌘E"]),
            HelpEntry(title: L("가져오기"), body: L("다른 컴퓨터의 종이냥에서 가져오기…(⇧⌘I)로 그 파일을 골라요. Mac과 Windows 사이도 돼요. ‘합치기’는 지금 것은 그대로 두고 없는 것만 더하고, ‘바꾸기’는 지금 것을 모두 백업 내용으로 바꿔요. 가져온 뒤 종이냥이 다시 시작돼요."), keys: ["⇧⌘I"]),
            HelpEntry(title: L("가져오기 전 자동 백업"), body: L("가져오기 전에 지금 상태를 이 Mac의 앱 폴더 안 backups 폴더에 저장해 둬요(최근 10개). 잘못 가져왔으면 그 파일을 다시 ‘바꾸기’로 가져오면 돼요.")),
            HelpEntry(title: L("공유 폴더와 다른 점"), body: L("공유 폴더(책상 → 저장과 백업)는 여러 기기가 계속 같은 목록을 같이 쓰는 방법이고, 백업은 한 번 옮기거나 보관해 두는 방법이에요.")),
        ]),
        HelpTopic(id: "pet", title: L("종이냥 펫"), symbol: "pawprint", pose: .idle, headline: L("화면 아래 작은 친구"), entries: [
            HelpEntry(title: L("펫과 놀기"), body: L("종이냥이 화면 아래(Dock 위)에서 지내요. 누르면 하트가 나오고, 두 번 누르면 노트가 열려요. 잡고 끌면 자리를 옮기고, 다른 모니터로 옮길 수도 있어요.")),
            HelpEntry(title: L("종이냥이 하는 일"), body: L("가만히 있을 땐 숨을 쉬고, 가끔 깜빡이고 갸웃하고 걷고 그루밍하고 차를 마셔요. Mac을 5분 넘게 안 쓰면 하품하고 잠들었다가, 돌아오면 기지개를 켜요. 할 일이나 타이머를 끝내면 축하해 줘요.")),
            HelpEntry(title: L("우클릭 메뉴"), body: L("타이머 · 빠른 메모 · 알람 · 설정(책상의 종이냥 칸) · 노트 열기 · 돌아다니기 · 펫 숨기기가 있어요. 펫이 있으면 알림이 걸어오지 않고 펫 위에 말풍선으로 떠요.")),
            HelpEntry(title: L("일요일 저녁 돌아보기"), body: L("일요일 저녁 6시가 지나면 종이냥이 이번 주에 끝낸 개수를 알려 주며 축하해 줘요. 한 주에 한 번이에요.")),
            HelpEntry(title: L("종이냥 한마디"), body: L("가끔 오늘 남은 일, 시간대, 마감에 맞춰 응원하거나 말을 걸어요. 일정을 적어 두면 ‘곧 팀 회의 시간이에요’, ‘회의 끝났어요? 수고했어요!’처럼 오늘 일정 이야기도 해요. ‘물 마셨어요?’처럼 물어볼 땐 말풍선의 버튼으로 답하면 대답해 줘요(‘5분 쉬어 갈까요?’에 ‘쉴래요’면 5분, 다음 일정까지 여유가 있을 때 ‘25분 집중해 볼까요?’에 ‘해 볼게요’면 25분 타이머가 켜져요). 집중 타이머가 도는 동안, 알림이 떠 있을 때, 밤 11시~아침 7시에는 조용해요. 책상 → 종이냥 → 종이냥 한마디에서 끄거나 횟수를 바꾸고, ‘들어 보기’로 바로 들어 볼 수 있어요.")),
            HelpEntry(title: L("보이기·숨기기"), body: L("⇧⌘P, 메뉴 막대 메뉴, ⋯ → 종이냥 펫, 책상 → 종이냥에서 켜고 꺼요. 고양이 위가 아닌 곳은 클릭이 뒤 앱으로 그대로 전달돼요."), keys: ["⇧⌘P"]),
        ]),
        HelpTopic(id: "timer", title: L("집중 타이머"), symbol: "timer", pose: .cheer, headline: L("25분 집중, 5분 휴식"), entries: [
            HelpEntry(title: L("타이머 켜기"), body: L("펫 우클릭 → 타이머, 노트 ⋯ → 타이머, 보기 메뉴 → 타이머, 팻말 우클릭, 책상 → 시계에서 5·15·25·50분 타이머나 뽀모도로를 시작해요.")),
            HelpEntry(title: L("시간 직접 정하기"), body: L("타이머 메뉴의 ‘직접 정하기…’나 책상 → 시계 → 타이머 시작 → 직접에 40, 1:30, 1시간 30분처럼 적어요(1분에서 3시간까지). 적는 동안 알아들은 시간이 아래에 보여요. 직접 정한 시간은 최근 것부터 세 개까지 타이머 메뉴에 남아요."), keys: ["Return", "Esc"]),
            HelpEntry(title: L("팻말 다루기"), body: L("종이냥이 든 팻말에 빨간 원(집중)·초록 원(휴식)이 줄어들어요. 팻말을 누르면 일시정지(종이냥이 눈을 감아요), ⏸ · ■ 버튼으로 멈추거나 끝내요. 끌어서 원하는 곳에 두면 다음에도 그 자리에 떠요. 우클릭하면 5분 더 · 중지 메뉴가 있어요.")),
            HelpEntry(title: L("뽀모도로"), body: L("집중 25분 → 휴식 5분, 4번마다 긴 휴식 15분. 책상 → 시계에서 시간과 횟수(−·+ 또는 숫자로, ⌥를 누르면 5분씩), 다음 단계 자동 시작, 끝날 때 소리를 정해요. 앱을 다시 켜도 타이머는 이어져요.")),
            HelpEntry(title: L("할 일 하나에 집중"), body: L("할 일 줄에 마우스를 올려 시계 모양 집중 버튼을 누르거나, 줄을 고르고 F, 우클릭 → ‘이거 집중’에서 25분 · 50분 · 직접 정하기 · 뽀모도로를 고르거나, 입력 줄에 ‘보고서 25분 집중’처럼 적거나, 타이머 메뉴의 ‘할 일 골라 집중…’으로 할 일을 골라요. 노트가 집중 카드로 바뀌어 남은 시간과 할 일, 다음 일정이 보여요. 남은 시간 아래의 ⏸(Space)로 멈추고 이어 가고, ‘다 했어요’(⌘↩)는 체크하고 끝내고, ‘5분 더’(⌘=)는 시간을 늘리고, ‘다음에’는 체크 없이 끝내요. 집중하는 동안 종이냥 한마디와 다른 할 일 알림은 쉬었다가 끝나면 한 번에 와요(일정 알림 · 알람은 그대로). Esc나 ×를 누르면 그만둘지 물어봐요."), keys: ["F", "Space", "⌘↩", "⌘=", "Esc"]),
            HelpEntry(title: L("집중 기록"), body: L("1분 넘게 한 집중과 타이머는 저장 폴더의 focus.jsonl에 남아요(뽀모도로는 라운드마다, 휴식은 빼고). 책상 → 완료 기록에서 기간의 집중 시간, 날마다 집중한 시간, 가장 오래 집중한 일을 볼 수 있어요. 백업과 공유 폴더에도 함께 가요.")),
        ]),
        HelpTopic(id: "alarm", title: L("알람"), symbol: "alarm", pose: .cheer, headline: L("제때 깨워 줄게요"), entries: [
            HelpEntry(title: L("알람 만들기"), body: L("책상 → 시계 → 알람에서 ‘알람 추가’를 누르고 시간 · 이름 · 요일 · 소리 · 다시 울림을 정한 뒤 ‘완료’. 펫 우클릭이나 ⋯ → 알람…으로도 열려요. 줄을 누르면 고치고, 스위치로 켜고 꺼요. 켜 둔 알람이 있으면 보기 메뉴에 ‘다음 알람’이 보여요.")),
            HelpEntry(title: L("요일"), body: L("요일을 고르면 그 요일마다 울려요(평일 · 주말 · 매일로 줄여 보여요). 하나도 고르지 않으면 한 번만 울리고, 울린 뒤에는 스위치가 저절로 꺼져요.")),
            HelpEntry(title: L("울릴 때"), body: L("화면 가운데(펫이 있으면 펫 위)에 울리는 쪽지가 뜨고, 끌 때까지 소리가 계속 나요. ‘끄기’(Return)를 누르거나, ‘다시 울림’의 5 · 10 · 15분(1 · 2 · 3, S · Space는 알람의 기본 시간)을 골라요. 10분 동안 대답이 없으면 한 번 미뤘다 다시 울리고, 그래도 없으면 그만 울려요. 다시 울림을 ‘없음’으로 둔 알람은 ‘끄기’만 있고, 10분이 지나면 그대로 그쳐요. 타이머나 다른 알림이 떠 있어도 알람은 울려요."), keys: [L("Return 끄기"), L("S 다시"), "1 · 2 · 3"]),
            HelpEntry(title: L("소리"), body: L("종소리 · 부드럽게 · 소리 없음 중에 골라요. ▶ 들어 보기로 한 번 들어 봐요. 소리 크기는 Mac의 음량을 따라요.")),
            HelpEntry(title: L("Mac이 잠자고 있으면"), body: L("알람은 종이냥이 켜져 있을 때 울려요. Mac이 잠들어 있다가 알람 시각에서 15분 안에 깨어나면 그때 울리고, 그보다 늦으면 건너뛰어요.")),
            HelpEntry(title: L("여러 기기에서"), body: L("알람은 할 일과 같은 저장 폴더의 alarms.json에 있어요. 공유 폴더를 쓰면 다른 기기와 같은 알람을 쓰고, 켜져 있는 기기마다 따로 울려서 기기마다 따로 꺼요. 한 번만 울리는 알람은 한 곳에서 끄면 모든 기기에서 꺼져요.")),
        ]),
        HelpTopic(id: "look", title: L("꾸미기·설정"), symbol: "paintbrush.pointed", pose: .groom, headline: L("내 손에 맞게"), entries: [
            HelpEntry(title: L("글꼴과 글자 크기"), body: L("손글씨 펜 · 손글씨 붓 · 기본 글씨 중에 고르고, 글자 크기는 작게 · 보통 · 크게 · 아주 크게. 책상 → 꾸미기, ⋯ 메뉴, ⌘= / ⌘−로 바꿔요."), keys: ["⌘=", "⌘−"]),
            HelpEntry(title: L("설정 열기"), body: L("⋯ → 설정…이나 ⌘,로 책상의 꾸미기가 열려요. 설정은 꾸미기 · 알림 · 반복 · 종이냥 · 일정 · 저장과 백업 여섯 칸이에요."), keys: ["⌘,"]),
            HelpEntry(title: L("책상"), body: L("달력 · 완료 기록 · 시계 · 설정 · 도움말이 한 창에 있어요. 노트 위쪽의 책상 버튼이나 ⌘D로 열고, 왼쪽 목록이나 ⌘1–⌘9로 칸을 골라요(목록에서 ↑↓도 돼요). 창이 좁으면 목록이 아이콘만 남아요."), keys: ["⌘D", "⌘1–⌘9"]),
            HelpEntry(title: L("밤 종이"), body: L("책상 → 꾸미기 → 종이 색에서 자동 · 낮 · 밤을 골라요. 자동이면 Mac이 어두운 모드일 때 노트 · 쪽지 · 책상 · 오늘 창이 모두 어두운 밤 종이로 바뀌어요. 바꾸면 열린 창이 바로 따라 바뀌어요.")),
        ]),
        HelpTopic(id: "keys", title: L("단축키"), symbol: "keyboard", pose: .blink, headline: L("손을 키보드에서 떼지 않고"), entries: [
            HelpEntry(title: L("할 일"), body: L("새 할 일 ⌘N · 어디서든 빠른 입력 ⌃⌥N · 빠른 메모 ⌃⌥M · 노트 보이기 · 숨기기 ⌃⌥J · 검색 ⌘F · 되돌리기 ⌘Z · 다시 실행 ⇧⌘Z · 전체 복사 ⇧⌘C · 텍스트로 내보내기 ⌘E"), keys: ["⌘N", "⌃⌥N", "⌃⌥M", "⌃⌥J", "⌘F", "⌘Z", "⇧⌘Z", "⇧⌘C", "⌘E"]),
            HelpEntry(title: L("줄 다루기"), body: L("줄 고르기 ↑↓ · 완료 Space · 고치기 Return · 지우기 ⌫ · 순서 바꾸기 ⌘↑↓ · 고르기 풀기 Esc · 하루 뒤로 ⌥→ · 하루 앞으로 ⌥← · 언젠가로 ⌥↓ · 집중 F"), keys: ["↑↓", "Space", "Return", "⌫", "⌘↑↓", "Esc", "⌥→", "⌥←", "⌥↓", "F"]),
            HelpEntry(title: L("집중 카드"), body: L("멈춤 · 계속 Space · 다 했어요 ⌘↩ · 5분 더 ⌘= · 그만두기 Esc(먼저 물어봐요)"), keys: ["Space", "⌘↩", "⌘=", "Esc"]),
            HelpEntry(title: L("탭과 메모"), body: L("오늘 ⌘1 · 앞으로 ⌘2 · 메모 ⌘3 · 새 메모 ⇧⌘N"), keys: ["⌘1–⌘3", "⇧⌘N"]),
            HelpEntry(title: L("창과 앱"), body: L("노트 열기 ⌘0 · 접기 ⌘M · 완료 기록 ⌘Y · 달력 ⌘D · 설정 ⌘, · 펫 보이기 ⇧⌘P · 도움말 ⌘? · 책상의 칸 ⌘1–⌘9 · 창 닫기 ⌘W · 종료 ⌘Q"), keys: ["⌘0", "⌘M", "⌘Y", "⌘D", "⌘,", "⇧⌘P", "⌘?"]),
            HelpEntry(title: L("글자 크기"), body: L("크게 ⌘= · 작게 ⌘−"), keys: ["⌘=", "⌘−"]),
        ]),
        HelpTopic(id: "data", title: L("저장과 옮기기"), symbol: "externaldrive", pose: .sleep, headline: L("내 Mac에만 저장돼요"), entries: [
            HelpEntry(title: L("저장 위치"), body: L("~/Library/Application Support/com.noa.PaperTodo/ 안에 할 일(todos.json), 메모(memos.json), 반복(repeats.json), 일정(events.json), 알람(alarms.json), 집중 기록(focus.jsonl), 완료 기록(archive 폴더)이 있어요. 바뀔 때마다 바로 저장돼요.")),
            HelpEntry(title: L("다른 기기와 함께 쓰기"), body: L("책상 → 저장과 백업 → 저장 위치에서 iCloud Drive · Dropbox · OneDrive 같은 폴더를 고르면, 같은 폴더를 고른 다른 Mac이나 Windows의 종이냥과 같은 목록을 써요. 다른 기기에서 바꾸면 몇 초 안에 이쪽에도 반영돼요. 폴더를 바꾸면 종이냥이 다시 시작돼요.")),
            HelpEntry(title: L("두 기기에서 동시에 고치면"), body: L("거의 같은 때 고쳐도 양쪽 변경이 다 남아요. 같은 메모를 함께 고치면 두 글을 합치고, 같은 자리를 서로 다르게 고친 줄은 둘 다 남겨요. 할 일 알림은 켜져 있는 기기마다 울리고, 꺼져 있던 기기는 다른 기기가 이미 알린 지난 알림을 다시 띄우지 않아요. 글꼴·알림 같은 설정은 기기마다 따로예요.")),
            HelpEntry(title: L("Windows와 같은 형식"), body: L("Windows용 종이냥과 같은 파일 형식이에요. 파일을 옮겨도 그대로 이어서 쓸 수 있어요.")),
            HelpEntry(title: L("복사·내보내기"), body: L("⇧⌘C는 목록을 글자로 복사하고, ⌘E는 텍스트 파일로 내보내요. 오늘 할 일 다음에 [앞으로]·[언젠가]가 따로 적혀요."), keys: ["⇧⌘C", "⌘E"]),
        ]),
    ]
}
