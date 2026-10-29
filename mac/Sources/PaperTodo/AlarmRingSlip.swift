import AppKit
import PaperCore
import SwiftUI

/// 울리는 쪽지 (option A of the modal redesign; the ring's whole look is in this one file so it
/// can be swapped for B "띠 알림" or C "종이 시계"): the cat cheering in a clay disc with two rings
/// spreading out, how long it has rung, the time large, the name in handwriting, when it rings
/// next, one big 끄기 and 다시 울림 5 · 10 · 15분.
struct AlarmRingView: View {
    static let width: CGFloat = 340
    @ObservedObject var state: AlarmRingState
    /// Snapshots: a fixed now.
    var now: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        PaperSlip(kind: .alarm, width: Self.width) {
            if let alarm = state.alarm {
                TimelineView(.periodic(from: .now, by: 10)) { timeline in
                    content(alarm, now: now ?? timeline.date)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(state.alarm.map { "\(Alarm.untitled(.current)) \(Alarm.timeText($0, language: .current))" } ?? "")
    }

    private func content(_ alarm: Alarm, now: Date) -> some View {
        let language = AppLanguage.current
        let label = alarm.label.trimmingCharacters(in: .whitespaces)
        return VStack(spacing: 0) {
            RingingStage(animated: SlipMotion.enabled && !reduceMotion)
                .frame(width: 132, height: 132)
                .padding(.top, 26)
                .padding(.bottom, 4)
            RingingPill(text: Self.ringingText(since: state.startedAt, now: now), animated: SlipMotion.enabled && !reduceMotion)
                .padding(.top, 8)
            bigTime(alarm, language: language)
                .padding(.top, 6)
            Text((label.isEmpty ? Alarm.untitled(language) : label).handwritten)
                .font(HandwritingFont.swiftUI(face: .pen, size: 36))
                .foregroundStyle(PaperTheme.ink)
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .minimumScaleFactor(0.7)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 24)
                .padding(.top, 6)
            Text(Self.metaText(alarm, now: now))
                .font(.system(size: 12, weight: .medium).monospacedDigit())
                .foregroundStyle(PaperTheme.ink3)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 20)
                .padding(.top, 6)
            VStack(spacing: 10) {
                Button(L("끄기"), action: state.onStop)
                    .buttonStyle(SlipButtonStyle(role: .primary, key: "↩", fullWidth: true, large: true))
                    .help("Return")
                // 1.39: an alarm set to 없음 has no 다시 울림 at all.
                if alarm.snoozes { HStack(spacing: 6) {
                    Text("다시 울림")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(PaperTheme.ink2)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.trailing, 4)
                    ForEach(Array(Alarm.snoozeChoices.enumerated()), id: \.element) { index, minutes in
                        SlipChipButton(title: L("\(minutes)분"), selected: minutes == alarm.snooze, centered: true) {
                            state.onSnooze(minutes)
                        }
                        .help(L("\(minutes)분 뒤에 다시 울려요") + " (\(index + 1))")
                    }
                } }
            }
            .padding(18)
        }
        .frame(maxWidth: .infinity)
    }

    /// On the 12-hour clock a small `오전` before `7:00` (Korean puts the period first), `7:00` then `AM` · `a.m.`;
    /// on the 24-hour clock `07:00` alone (the app's clock, AppLanguage.cycle).
    private func bigTime(_ alarm: Alarm, language: AppLanguage) -> some View {
        let clock = alarm.clock ?? (hour: 0, minute: 0)
        let twelve = clock.hour % 12 == 0 ? 12 : clock.hour % 12
        let h12 = language.cycle == .h12
        let main = h12 ? "\(twelve):" + String(format: "%02d", clock.minute) : String(format: "%02d:%02d", clock.hour, clock.minute)
        let suffix: String? = h12 ? language.period(hour: clock.hour) : nil
        let period = suffix.map {
            Text($0)
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(PaperTheme.ink2)
        }
        return HStack(alignment: .lastTextBaseline, spacing: 4) {
            if language.periodFirst { period }
            Text(main)
                .font(.system(size: 52, weight: .semibold).monospacedDigit())
                .tracking(-1.5)
            if !language.periodFirst { period }
        }
        .foregroundStyle(PaperTheme.ink)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }

    /// "방금 울렸어요" · "1분째 울리는 중" (en "Just started" · "Ringing for 1 min"; nl "Gaat net af" · "Gaat al 1 min").
    static func ringingText(since start: Date, now: Date) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(start) / 60))
        return minutes == 0 ? L("방금 울렸어요") : L("\(minutes)분째 울리는 중")
    }

    /// "평일 · 다음은 내일 오전 7:00"; once-alarms "한 번 · 끄면 꺼져요".
    static func metaText(_ alarm: Alarm, now: Date) -> String {
        let language = AppLanguage.current
        if alarm.isOnce { return L("한 번 · 끄면 꺼져요") }
        let days = Alarm.daysText(alarm.days, language: language)
        guard let next = Alarm.nextFire(alarm, now: now.addingTimeInterval(60)) else { return days }
        let calendar = Calendar.current
        let ahead = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: next)).day ?? 0
        let weekday = calendar.component(.weekday, from: next) - 1
        let day: String = switch (language, ahead) {
        case (_, 0): language.dayWord(0)!
        case (_, 1): language.dayWord(1)!
        case (.ko, _): language.weekdayName(weekday)
        default: language.weekdayShort(weekday)
        }
        // nl "weer morgen om 13:30" (`morgen` alone could be "morning").
        let when = (language == .ko ? day : day.lowercased()) + (language == .nl ? " om " : " ") + Alarm.timeText(alarm, language: language)
        return L("\(days) · 다음은 \(when)")
    }
}

/// The cat in a clay disc, two clay rings spreading out every 2 s (1 s apart), the cat rocking ±4°.
private struct RingingStage: View {
    let animated: Bool
    @State private var going = false

    var body: some View {
        ZStack {
            if animated {
                Wave(delay: 0, going: going)
                Wave(delay: 1, going: going)
            }
            Circle()
                .fill(RadialGradient(colors: [PaperTheme.token("#fff6ef", night: "#5a4038"), PaperTheme.clay2], center: UnitPoint(x: 0.5, y: 0.4), startRadius: 0, endRadius: 56))
                .frame(width: 100, height: 100)
            Image(nsImage: PetArt.image(.cheer) ?? PaperTheme.mascot)
                .resizable()
                .scaledToFit()
                .frame(width: 104, height: 104)
                .rotationEffect(.degrees(animated ? (going ? 4 : -4) : 0), anchor: UnitPoint(x: 0.5, y: 0.9))
                .offset(y: animated && going ? -1 : 0)
                .animation(animated ? .easeInOut(duration: 0.5).repeatForever(autoreverses: true) : nil, value: going)
        }
        .accessibilityHidden(true)
        .onAppear { if animated { going = true } }
    }

    private struct Wave: View {
        let delay: Double
        let going: Bool

        var body: some View {
            Circle()
                .strokeBorder(PaperTheme.clay, lineWidth: 2)
                .scaleEffect(going ? 1.12 : 0.72)
                .opacity(going ? 0 : 0.55)
                .animation(.easeOut(duration: 2).repeatForever(autoreverses: false).delay(delay), value: going)
        }
    }
}

/// "1분째 울리는 중" with a blinking dot, on clay2.
private struct RingingPill: View {
    let text: String
    let animated: Bool
    @State private var dim = false

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(PaperTheme.clay).frame(width: 6, height: 6).opacity(dim ? 0.2 : 1)
            Text(text).lineLimit(1)
        }
        .font(.system(size: 11, weight: .semibold).monospacedDigit())
        .foregroundStyle(PaperTheme.clayText)
        .padding(.horizontal, 10)
        .frame(height: 20)
        .background(PaperTheme.clay2, in: Capsule())
        .onAppear {
            guard animated else { return }
            withAnimation(.linear(duration: 0.5).repeatForever(autoreverses: true)) { dim = true }
        }
    }
}
