import SwiftUI

/// The first-launch guide: five small paper cards the cat walks you through. Shown once over
/// the note; ⋯ → 사용 안내 brings it back. Esc skips, ←/→ or Return move between cards.
struct GuideView: View {
    @ObservedObject var model: AppModel
    @State private var step: Int
    /// The last card's 로그인할 때 같이 열기: on the first time through, afterwards as it is set.
    @State private var openAtLogin: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The note's height: a short note gets a tighter card (1.38: three key rows and the login switch).
    @State private var height: CGFloat = 560
    private var tight: Bool { height < 520 }

    init(model: AppModel, startStep: Int = 0) {
        self.model = model
        _step = State(initialValue: startStep)
        _openAtLogin = State(initialValue: model.guideSeen ? model.loginItemOn : true)
    }

    struct Card {
        let pose: PetArt.Pose
        let title: String
        let body: String
        let keys: [(String, String)]
    }

    /// 1.38: the cards teach what came since — the input line's kinds, 내일로, 검색, F to focus, the evening
    /// tidy-up and ⌃⌥J — and the last one asks about opening at login.
    static var cards: [Card] {
        [
            Card(pose: .happy, title: L("종이냥에 오신 걸 환영해요"),
                 body: L("하루에 한 장, 오늘 할 일만 가볍게 적는\n종이 노트예요. 적고, 체크하고, 끝!"),
                 keys: [(L("입력 줄"), "⌘N"), (L("완료"), L("네모 칸 누르기")), (L("어디서든 빠른 입력"), "⌃⌥N")]),
            Card(pose: .curious, title: L("탭으로 나눠 두어요"),
                 body: L("마감이 있는 일은 ‘앞으로’에서 날짜별로 기다리다\n그날이 되면 오늘로 올라와요.\n날짜 없는 일은 맨 아래 ‘언젠가’, 생각은 ‘메모 서랍’에."),
                 keys: [(L("오늘 · 앞으로"), "⌘1 · ⌘2"), (L("메모 서랍"), "⌘3"), (L("내일로 미루기"), "⌥→")]),
            Card(pose: .stretch, title: L("아래 입력 줄에 무엇이든"),
                 body: L("‘내일 3시 회의’, ‘2시~4시 보고서’, ‘매일 물 마시기’처럼\n적으면 칩으로 알아들은 뜻을 보여 줘요.\nTab으로 다른 뜻, Return으로 넣기."),
                 keys: [(L("다른 뜻"), "Tab"), (L("되돌리기"), "⌘Z"), (L("검색"), "⌘F")]),
            Card(pose: .tea, title: L("종이냥과 집중"),
                 body: L("할 일에서 F를 누르면 바로 집중을 시작해요.\n화면 아래의 종이냥은 저녁이 되면\n남은 일을 내일로 넘길지 물어봐요."),
                 keys: [(L("이거 집중"), "F"), (L("설정"), "⌘,")]),
            Card(pose: .cheer, title: L("준비 끝!"),
                 body: L("필요 없을 땐 작은 포스트잇으로 접어 두세요.\n어디서든 ⌃⌥J로 다시 불러요."),
                 keys: [(L("작게 접기"), "⌘M"), (L("노트 보이기 · 숨기기"), "⌃⌥J")]),
        ]
    }

    var body: some View {
        let card = Self.cards[step]
        let last = step == Self.cards.count - 1
        ZStack {
            // Dims the note by day and night (an ink wash would lighten the dark paper).
            PaperTheme.scrim
                .ignoresSafeArea()
                .onTapGesture {}
            VStack(spacing: 0) {
                Image(nsImage: PetArt.image(card.pose) ?? PaperTheme.mascot)
                    .resizable().scaledToFit()
                    .frame(width: tight ? 58 : 96, height: tight ? 58 : 96)
                    .padding(.top, tight ? 10 : 18)
                    .id(step)
                    .transition(.scale(scale: 0.85).combined(with: .opacity))
                    .accessibilityHidden(true)
                Text(card.title.handwritten)
                    .font(model.notebookFont.bodyFont(.large))
                    .foregroundStyle(PaperTheme.ink)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 18)
                    .padding(.top, tight ? 2 : 6)
                    .accessibilityAddTraits(.isHeader)
                Text(card.body)
                    .font(.system(size: 12.5))
                    .foregroundStyle(PaperTheme.secondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 22)
                    .padding(.top, tight ? 4 : 8)
                    // Every card the same height, so the buttons stay put while you page through.
                    .frame(minHeight: tight ? 52 : 66, alignment: .top)
                VStack(spacing: tight ? 3 : 5) {
                    ForEach(card.keys, id: \.0) { label, key in
                        HStack(spacing: 8) {
                            Text(label).foregroundStyle(PaperTheme.secondary)
                            Spacer(minLength: 8)
                            Text(key)
                                .font(.system(size: 11, weight: .semibold).monospacedDigit())
                                .foregroundStyle(PaperTheme.sageText)
                                .padding(.horizontal, 7)
                                .frame(height: 20)
                                .background(PaperTheme.sage.opacity(0.1), in: RoundedRectangle(cornerRadius: 5))
                        }
                        .font(.system(size: 11.5))
                    }
                }
                .padding(.horizontal, 26)
                .padding(.top, tight ? 6 : 10)
                .frame(minHeight: tight ? 0 : 76, alignment: .top)
                if last {
                    HStack(spacing: 8) {
                        Image(systemName: "power").font(.system(size: 11, weight: .medium)).foregroundStyle(PaperTheme.ink2)
                        Text(L("로그인할 때 같이 열기")).font(.system(size: 12, weight: .medium)).lineLimit(1).minimumScaleFactor(0.85)
                        Spacer(minLength: 8)
                        Toggle(L("로그인할 때 같이 열기"), isOn: $openAtLogin).toggleStyle(PaperToggleStyle()).labelsHidden()
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 34)
                    .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 10))
                    .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(PaperTheme.rule, lineWidth: 0.8) }
                    .padding(.horizontal, 20)
                    .padding(.top, tight ? 6 : 8)
                }
                HStack(spacing: 6) {
                    ForEach(0..<Self.cards.count, id: \.self) { index in
                        Capsule()
                            .fill(index == step ? PaperTheme.sage : PaperTheme.rule)
                            .frame(width: index == step ? 16 : 6, height: 6)
                    }
                }
                .padding(.top, tight ? 10 : 16)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(Self.cards.count)장 중 \(step + 1)장")
                HStack {
                    if last {
                        Spacer()
                    } else {
                        Button("건너뛰기", action: finish)
                            .buttonStyle(SlipButtonStyle(role: .ghost))
                            .keyboardShortcut(.cancelAction)
                        Spacer()
                    }
                    if step > 0 {
                        Button { go(-1) } label: { Text("이전") }
                            .buttonStyle(SlipButtonStyle(role: .ghost))
                            .keyboardShortcut(.leftArrow, modifiers: [])
                    }
                    Button { last ? finish() : go(1) } label: {
                        Text(last ? "시작하기" : "다음")
                    }
                    // A short note: no keycap, so 다음 · Volgende keeps its word.
                    .buttonStyle(SlipButtonStyle(role: .primary, key: tight ? nil : "↩"))
                    .keyboardShortcut(.defaultAction)
                }
                .padding(.horizontal, 12)
                .padding(.top, tight ? 10 : 16)
                .padding(.bottom, tight ? 10 : 14)
            }
            .frame(width: 320)
            .background(PaperBackground())
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay { RoundedRectangle(cornerRadius: 16).stroke(PaperTheme.rule, lineWidth: 0.8) }
            .slipShadow()
            // Taped on like every other slip.
            .overlay(alignment: .top) {
                WashiTape(color: PaperTheme.tapeHoney).frame(width: 74, height: 20).offset(y: -9).accessibilityHidden(true)
            }
            .padding(tight ? 10 : 16)
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isModal)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
        .background {
            // → also moves on (←/Return/Esc are on the buttons).
            Button("") { last ? finish() : go(1) }
                .keyboardShortcut(.rightArrow, modifiers: [])
                .opacity(0)
                .accessibilityHidden(true)
        }
    }

    private func go(_ delta: Int) {
        withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.8)) {
            step = min(max(step + delta, 0), Self.cards.count - 1)
        }
    }

    private func finish() {
        // Only from the last card (건너뛰기 leaves the login item as it is).
        if step == Self.cards.count - 1 { model.setLoginItem(openAtLogin) }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { model.finishGuide() }
    }
}
