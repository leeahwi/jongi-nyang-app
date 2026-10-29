import Foundation

/// 종이냥 한마디: now and then the cat says something — about today's sheet, deadlines, the time
/// of day, the day of the week, or just cat things — or asks a small question with answer
/// buttons. Same lines, order and picking steps as the Windows app (chatter.ts): both tables are
/// written from one list (scripts/chatter), and a test with the same random numbers gives the same
/// line on both. Every language has the same lines in the same places, so a pick has the same id
/// in Korean, English and Dutch.
public enum PetChatter {
    public enum Pose: String, Sendable { case happy, cheer, tilt, stretch, yawn, tea, blink, hop }
    /// Something an answer does besides the reply.
    public enum Action: String, Sendable { case rest5, focus25 }

    public struct Answer: Equatable, Sendable {
        public let label: String
        public let reply: String
        public let pose: Pose
        public let action: Action?
    }

    /// A line, or a question when it has answers.
    public struct Line: Equatable, Sendable {
        public let id: String
        public let text: String
        public let answers: [Answer]
        public var isQuestion: Bool { !answers.isEmpty }
    }

    public struct Context: Sendable {
        public var hour: Int
        /// Today's sheet: tasks still open and tasks checked off.
        public var open: Int
        public var done: Int
        /// Deadlines already past, and due today or tomorrow (open tasks only).
        public var overdue: Int
        public var dueSoon: Int
        public var firstOpen: String?
        /// 0 = Sunday … 6 = Saturday.
        public var weekday: Int
        /// Today's events (CalendarDay.chatter): the next event and the minutes to it, the
        /// one going on, one that just ended, and how many are still to come.
        public var nextEvent: String?
        public var nextIn: Int
        public var nowEvent: String?
        public var endedEvent: String?
        public var eventsLeft: Int
        /// A streak that reached 7, 30 or 100 days today and hasn't been cheered yet (Archive.streakMilestone).
        public var milestone: Int?

        public init(hour: Int, open: Int, done: Int, overdue: Int = 0, dueSoon: Int = 0, firstOpen: String? = nil, weekday: Int = 2,
                    nextEvent: String? = nil, nextIn: Int = 0, nowEvent: String? = nil, endedEvent: String? = nil, eventsLeft: Int = 0,
                    milestone: Int? = nil) {
            self.hour = hour; self.open = open; self.done = done; self.overdue = overdue; self.dueSoon = dueSoon
            self.firstOpen = firstOpen; self.weekday = weekday
            self.nextEvent = nextEvent; self.nextIn = nextIn; self.nowEvent = nowEvent; self.endedEvent = endedEvent; self.eventsLeft = eventsLeft
            self.milestone = milestone
        }
    }

    public enum Frequency: String, CaseIterable, Sendable {
        case rare, normal, often
        public var minutes: Double { switch self { case .rare: 90; case .normal: 45; case .often: 20 } }
        public var title: String { title(.ko) }
        public func title(_ language: AppLanguage) -> String {
            switch self {
            case .rare: ["가끔", "Rarely", "Zelden"][language.index]
            case .normal: ["보통", "Sometimes", "Soms"][language.index]
            case .often: ["자주", "Often", "Vaak"][language.index]
            }
        }
    }

    /// Late at night and early morning the cat keeps quiet.
    public static func isQuietHour(_ hour: Int) -> Bool { hour >= 23 || hour < 7 }

    /// How long until the next line: the chosen interval, give or take a quarter.
    public static func nextDelay(_ frequency: Frequency, random: () -> Double) -> TimeInterval {
        frequency.minutes * 60 * (0.75 + 0.5 * random())
    }

    /// One line (or question) for this moment, avoiding the ones said recently.
    public static func pick(_ context: Context, questions: Bool, recent: [String], language: AppLanguage = .ko, random: () -> Double) -> Line {
        let l = language
        if let days = context.milestone, let line = milestone(days, language: l) { return line }
        var groups: [(weight: Double, lines: [Line])] = []
        groups.append((4, progress(context, l)))
        if context.overdue > 0 { groups.append((3, lines(overdueLines, context, l))) } else if context.dueSoon > 0 { groups.append((2, lines(dueSoonLines, context, l))) }
        if context.nextEvent != nil && context.nextIn <= 30 { groups.append((4, lines(eventSoonLines, context, l))) }
        else if context.endedEvent != nil { groups.append((3, lines(eventEndedLines, context, l))) }
        else if context.nowEvent != nil { groups.append((2, lines(eventNowLines, context, l))) }
        else if context.nextEvent != nil { groups.append((1, lines(eventDayLines, context, l))) }
        if let time = timeLines(context.hour) { groups.append((2, lines(time, context, l))) }
        if let day = weekdayLines(context.weekday) { groups.append((1, lines(day, context, l))) }
        groups.append((2, lines(generalLines, context, l)))
        if questions {
            let asks = questionList.filter { $0.applies(context) }.map { $0.line(context, l) }
            if !asks.isEmpty { groups.append((3, asks)) }
        }
        let total = groups.reduce(0) { $0 + $1.weight }
        var point = random() * total
        var chosen = groups[groups.count - 1].lines
        for group in groups {
            if point < group.weight { chosen = group.lines; break }
            point -= group.weight
        }
        let fresh = chosen.filter { !recent.contains($0.id) }
        let pool = fresh.isEmpty ? chosen : fresh
        return pool[min(pool.count - 1, Int(random() * Double(pool.count)))]
    }

    /// The day a streak reaches 7, 30 or 100 days: one short cheer ("m.0" · "m.1" · "m.2"); nil for any other count.
    public static func milestone(_ days: Int, language: AppLanguage = .ko) -> Line? {
        guard let index = milestoneDays.firstIndex(of: days) else { return nil }
        return Line(id: "m.\(index)", text: milestoneLines[language.index][index], answers: [])
    }

    /// The streaks the cat cheers, once each, on the day they're reached.
    public static let milestoneDays = [7, 30, 100]

    /// A short answer when the cat is patted.
    public static func petted(language: AppLanguage = .ko, random: () -> Double) -> Line {
        let texts = pettedLines[language.index]
        let index = min(texts.count - 1, Int(random() * Double(texts.count)))
        return Line(id: "pet.\(index)", text: texts[index], answers: [])
    }

    /// Everything the cat can say, for checks that both apps carry the same list.
    public static var catalogueSize: Int {
        114 + questionList.count
    }

    // MARK: Lines (written by scripts/chatter/generate.py from one list shared with the Windows app)

    /// A group of lines: ids "<id>.0", "<id>.1"…, the texts in Korean, English and Dutch.
    private struct Table: Sendable {
        let id: String
        let texts: [[String]]
    }

    private static func progress(_ c: Context, _ l: AppLanguage) -> [Line] {
        if c.open == 0 && c.done == 0 { return lines(progressEmpty, c, l) }
        if c.open == 0 { return lines(progressAll, c, l) }
        if c.done == 0 { return lines(progressStart, c, l) }
        return lines(progressSome, c, l)
    }

    private static func timeLines(_ hour: Int) -> Table? {
        switch hour {
        case 7..<11: timeMorning
        case 11..<14: timeLunch
        case 14..<18: timeAfter
        case 18..<23: timeEvening
        default: nil
        }
    }

    private static func weekdayLines(_ weekday: Int) -> Table? {
        switch weekday {
        case 1: weekdayMon
        case 3: weekdayWed
        case 5: weekdayFri
        case 0, 6: weekdayEnd
        default: nil
        }
    }

    private static let progressEmpty = Table(id: "p.empty", texts: [
        [
            "오늘 할 일이 비어 있어요. 하나만 적어 볼까요?",
            "빈 종이도 좋아요. 쉬어 가는 날이에요.",
            "할 일 하나 적어 두면 제가 지켜볼게요.",
            "오늘은 뭘 해 볼까요? 생각나는 대로 적어요.",
            "할 일이 없으면\n쉬는 것도 일이에요.",
            "빈 종이 위에서 낮잠 자도 돼요?",
            "작은 것 하나라도 적어 두면\n뿌듯해져요."],
        [
            "Today’s page is empty. Want to write one down?",
            "A blank page is nice too. A day to rest.",
            "Write down a to-do and I’ll keep an eye on it.",
            "What shall we do today? Jot down whatever comes to mind.",
            "Nothing to do?\nResting counts too.",
            "Can I nap on the blank page?",
            "Even one tiny to-do\nfeels good to write down."],
        [
            "Vandaag is nog leeg. Zullen we iets opschrijven?",
            "Een leeg blad is ook fijn. Een dagje rust.",
            "Schrijf een taak op, dan let ik erop.",
            "Wat gaan we vandaag doen? Schrijf maar op wat in je opkomt.",
            "Niks te doen?\nUitrusten telt ook.",
            "Mag ik een dutje doen op het lege blad?",
            "Zelfs één klein taakje opschrijven\nvoelt goed."]])
    private static let progressAll = Table(id: "p.all", texts: [
        [
            "오늘 한 장 다 끝냈어요! 최고예요.",
            "할 일 끝! 남은 시간은 마음껏 쉬어요.",
            "다 했어요. 제가 꾹꾹이 해 줄게요.",
            "오늘의 나, 참 잘했어요!",
            "다 끝냈으니 간식 타임 어때요?",
            "체크 표시가 꽉 찼어요. 보기만 해도 좋아요.",
            "내일의 나도 오늘처럼만 해 줘요.",
            "할 일 끝! 저랑 같이 뒹굴어요."],
        [
            "You finished today’s page! You’re the best.",
            "All done! Rest as much as you like.",
            "All done. Have some celebratory kneading.",
            "Today’s you did great!",
            "All done, so… snack time?",
            "A page full of checkmarks. What a view.",
            "Dear tomorrow-you: do it just like today.",
            "To-dos done! Come roll around with me."],
        [
            "Het blad van vandaag is af! Topper.",
            "Alles klaar! Rust lekker uit.",
            "Alles gedaan. Kom, een feestelijk kneedbeurtje.",
            "Goed gedaan vandaag!",
            "Alles af, dus… snoeptijd?",
            "Een blad vol vinkjes. Wat een gezicht.",
            "Lieve jij-van-morgen: doe het net zo.",
            "Klaar! Kom met me rollebollen."]])
    private static let progressStart = Table(id: "p.start", texts: [
        [
            "‘{first}’부터 시작해 볼까요?",
            "첫 번째 체크가 제일 어려워요. 할 수 있어요!",
            "작은 것 하나만 끝내 봐요.",
            "딱 5분만 해 볼까요? 시작이 반이에요.",
            "‘{first}’, 생각보다 금방 끝날지도 몰라요.",
            "제일 쉬운 것부터 해도 괜찮아요.",
            "오늘 첫 체크, 제가 지켜볼게요.",
            "할 일 {open}개, 하나씩 하면 돼요."],
        [
            "Shall we start with ‘{first}’?",
            "The first check is the hardest. You’ve got this!",
            "Let’s finish just one small thing.",
            "Just five minutes? Starting is half the work.",
            "‘{first}’ might go quicker than you think.",
            "It’s fine to start with the easiest one.",
            "Today’s first check? I’m watching.",
            "{open} on the page. One at a time."],
        [
            "Zullen we beginnen met ‘{first}’?",
            "Het eerste vinkje is het moeilijkst. Jij kunt het!",
            "Maak gewoon één klein dingetje af.",
            "Even vijf minuutjes? Goed begonnen is half gewonnen.",
            "‘{first}’ is misschien sneller klaar dan je denkt.",
            "Je mag gerust met de makkelijkste beginnen.",
            "Het eerste vinkje van vandaag? Ik kijk mee.",
            "Nog {open} te gaan. Eén voor één."]])
    private static let progressSome = Table(id: "p.some", texts: [
        [
            "벌써 {done}개 했어요! 좋아요.",
            "{open}개 남았어요. 천천히 가요.",
            "잘하고 있어요. 다음은 ‘{first}’?",
            "이 속도면 금방 끝나겠어요!",
            "벌써 {done}개! 박수 짝짝짝.",
            "{open}개만 더 하면\n오늘 한 장 끝이에요.",
            "잠깐 숨 돌리고\n‘{first}’ 해 볼까요?",
            "체크하는 소리가 좋아요. 사각사각."],
        [
            "{done} down already! Nice.",
            "Only {open} to go. Take it slow.",
            "You’re doing great. ‘{first}’ next?",
            "At this pace, you’ll be done in no time!",
            "{done} done already! Clap clap clap.",
            "Just {open} more\nand today’s page is done.",
            "Catch your breath,\nthen ‘{first}’?",
            "I love the sound of checking. Scritch scratch."],
        [
            "Al {done} klaar! Goed zo.",
            "Nog {open} te gaan. Rustig aan.",
            "Je doet het goed. Nu ‘{first}’?",
            "In dit tempo ben je zo klaar!",
            "Al {done} af! Klap klap klap.",
            "Nog {open} en\nhet blad van vandaag is af.",
            "Even op adem komen,\ndan ‘{first}’?",
            "Ik hou van het geluid van afvinken. Krts krts."]])
    private static let overdueLines = Table(id: "d.over", texts: [
        [
            "지난 마감이 {overdue}개 있어요. 하나만 정리해 볼까요?",
            "붉은 글씨 마감이 {overdue}개 있어요.\n날짜를 다시 정해도 괜찮아요.",
            "지난 마감은 ‘언젠가’로\n옮겨도 괜찮아요.",
            "밀린 일이 있어도 괜찮아요. 하나씩 해요."],
        [
            "{overdue} past due. Shall we sort out one?",
            "{overdue} in red.\nIt’s okay to pick a new date.",
            "Past deadlines can move\nto ‘Someday’, you know.",
            "Behind on things? That’s okay. One at a time."],
        [
            "{overdue} over de deadline. Zullen we er één oppakken?",
            "{overdue} in het rood.\nEen nieuwe datum mag gerust.",
            "Verlopen deadlines mogen\ngerust naar ‘Ooit’.",
            "Wat achter? Geeft niks. Eén voor één."]])
    private static let dueSoonLines = Table(id: "d.soon", texts: [
        [
            "곧 마감인 일이 {soon}개 있어요. 잊지 말아요!",
            "내일까지인 일이 있어요. 앞으로 탭 한 번 볼까요?",
            "마감이 다가와요. 오늘 조금만 해 둘까요?",
            "곧 마감! 제가 옆에서 응원할게요."],
        [
            "{soon} due soon. Don’t forget!",
            "Something’s due tomorrow. Peek at the Ahead tab?",
            "A deadline’s coming. Do a little today?",
            "Due soon! I’ll cheer you on."],
        [
            "{soon} bijna aan de beurt. Niet vergeten!",
            "Er moet iets af voor morgen. Even bij Vooruit kijken?",
            "Er komt een deadline aan. Vandaag een stukje doen?",
            "Bijna deadline! Ik moedig je aan."]])
    private static let eventSoonLines = Table(id: "e.soon", texts: [
        [
            "곧 ‘{event}’ 시간이에요. {in}분 남았어요.",
            "{in}분 뒤에 ‘{event}’!\n챙길 거 다 챙겼어요?",
            "‘{event}’ 가기 전에\n물 한 잔 어때요?",
            "‘{event}’까지 {in}분.\n하나만 더 끝내 볼까요?",
            "‘{event}’ 잊지 않았죠? 제가 기억하고 있어요."],
        [
            "‘{event}’ is coming up. {in} min to go.",
            "‘{event}’ in {in} min!\nGot everything?",
            "Before ‘{event}’,\nhow about a glass of water?",
            "{in} min until ‘{event}’.\nFinish one more thing?",
            "You didn’t forget ‘{event}’, right? I remember."],
        [
            "Zo meteen ‘{event}’. Nog {in} min.",
            "Over {in} min ‘{event}’!\nAlles bij de hand?",
            "Voor ‘{event}’\nnog even een glas water?",
            "Nog {in} min tot ‘{event}’.\nNog één ding afmaken?",
            "Je bent ‘{event}’ toch niet vergeten? Ik onthoud het."]])
    private static let eventEndedLines = Table(id: "e.ended", texts: [
        [
            "‘{ended}’ 끝났어요? 수고했어요!",
            "‘{ended}’ 끝! 잠깐 쉬었다 가요.",
            "‘{ended}’ 다녀오느라 고생했어요.\n물 한 잔 마셔요."],
        [
            "Is ‘{ended}’ over? Good job!",
            "‘{ended}’ done! Take a little break.",
            "Well done getting through ‘{ended}’.\nHave some water."],
        [
            "Is ‘{ended}’ voorbij? Goed gedaan!",
            "‘{ended}’ klaar! Neem even pauze.",
            "Knap dat je ‘{ended}’ hebt gedaan.\nDrink wat water."]])
    private static let eventNowLines = Table(id: "e.now", texts: [
        [
            "지금은 ‘{now}’ 시간이죠? 힘내요.",
            "‘{now}’ 하는 동안\n저는 조용히 있을게요.",
            "‘{now}’ 끝나면 기지개 한 번 켜요."],
        [
            "It’s ‘{now}’ time, right? You’ve got this.",
            "While ‘{now}’ is on,\nI’ll stay quiet.",
            "When ‘{now}’ is over, have a good stretch."],
        [
            "Nu is het tijd voor ‘{now}’, toch? Succes.",
            "Zolang ‘{now}’ bezig is,\nben ik stil.",
            "Na ‘{now}’ even lekker uitrekken."]])
    private static let eventDayLines = Table(id: "e.day", texts: [
        [
            "오늘 일정이 {left}개 더 있어요.",
            "다음 일정은 ‘{event}’,\n아직 여유 있어요.",
            "일정 사이사이에 할 일도 하나씩 해요.",
            "‘{event}’ 전에 할 일 하나 끝내 볼까요?"],
        [
            "{left} more on the calendar today.",
            "Next up is ‘{event}’.\nThere’s still time.",
            "Fit in a to-do between events.",
            "Finish a to-do before ‘{event}’?"],
        [
            "Vandaag nog {left} op de agenda.",
            "Hierna komt ‘{event}’.\nNog tijd genoeg.",
            "Doe tussen je afspraken door een taak.",
            "Nog een taak afmaken voor ‘{event}’?"]])
    private static let timeMorning = Table(id: "t.morning", texts: [
        [
            "좋은 아침이에요! 오늘도 한 장 시작해요.",
            "아침 햇살 받으며 기지개 쭉—",
            "커피 한 잔 하셨어요?",
            "아침밥은 먹었어요? 저는 벌써 먹었어요.",
            "오늘은 어떤 하루가 될까요?",
            "창문 열고 바람 한 번 쐬어요.",
            "천천히 시작해도 괜찮아요."],
        [
            "Good morning! Let’s start today’s page.",
            "Morning sun, big stretch—",
            "Had your coffee yet?",
            "Had breakfast? I already ate mine.",
            "What kind of day will today be?",
            "Open a window and get some fresh air.",
            "It’s fine to start slow."],
        [
            "Goedemorgen! Laten we het blad van vandaag beginnen.",
            "Ochtendzon, en flink uitrekken—",
            "Al koffie gehad?",
            "Al ontbeten? Ik heb al gegeten.",
            "Wat voor dag wordt het vandaag?",
            "Zet een raam open voor wat frisse lucht.",
            "Rustig beginnen mag best."]])
    private static let timeLunch = Table(id: "t.lunch", texts: [
        [
            "점심은 맛있게 먹었어요?",
            "밥 먹고 해요. 할 일은 기다려 줘요.",
            "배고프면 밥부터 챙겨요.",
            "점심 먹고 잠깐 걷는 건 어때요?",
            "오후도 힘내려면 든든하게요."],
        [
            "Did you have a nice lunch?",
            "Eat first. Your to-dos will wait.",
            "Hungry? Food comes first.",
            "How about a little walk after lunch?",
            "Eat well to keep going this afternoon."],
        [
            "Lekker geluncht?",
            "Eerst eten. Je taken wachten wel.",
            "Honger? Eten gaat voor.",
            "Even een wandelingetje na de lunch?",
            "Eet goed, dan hou je de middag vol."]])
    private static let timeAfter = Table(id: "t.after", texts: [
        [
            "오후엔 살짝 졸리죠. 기지개 한 번!",
            "물 한 잔 마셔요. 저는 우유요.",
            "어깨 한 번 돌려 볼까요?",
            "3시엔 간식이죠. 저는 생선 과자요.",
            "졸리면 잠깐 일어나 볼까요?",
            "오후 햇볕엔 낮잠이 솔솔 와요… 아, 일해야죠.",
            "조금만 더 하면 저녁이에요."],
        [
            "Afternoons get sleepy. Big stretch!",
            "Drink some water. I’ll have milk.",
            "Shall we roll our shoulders?",
            "Three o’clock is snack time. Fish treats for me.",
            "Sleepy? Maybe stand up for a bit?",
            "Afternoon sun makes me so sleepy… oh right, work.",
            "A little more and it’s evening."],
        [
            "’s Middags word je slaperig. Even rekken!",
            "Drink een glas water. Ik neem melk.",
            "Zullen we even de schouders rollen?",
            "Om drie uur is het snoeptijd. Visjes voor mij.",
            "Slaperig? Even opstaan?",
            "Van middagzon word ik zo slaperig… o ja, werken.",
            "Nog even en het is avond."]])
    private static let timeEvening = Table(id: "t.evening", texts: [
        [
            "오늘도 수고 많았어요.",
            "저녁은 챙겨 먹었어요?",
            "남은 건 내일의 나에게 맡겨도 괜찮아요.",
            "오늘 하루 어땠어요?",
            "저녁엔 눈이 피곤해요. 화면 밝기 줄여 봐요.",
            "내일 할 일을 미리 적어 두면\n아침이 편해요.",
            "따뜻한 차 한 잔 어때요?"],
        [
            "You worked hard today.",
            "Did you have dinner?",
            "It’s okay to leave the rest to tomorrow-you.",
            "How was your day?",
            "Tired eyes? Turn the screen down a little.",
            "Write tomorrow’s to-dos now\nand the morning gets easier.",
            "How about a warm cup of tea?"],
        [
            "Je hebt hard gewerkt vandaag.",
            "Heb je al gegeten?",
            "De rest mag jij-van-morgen doen.",
            "Hoe was je dag?",
            "Vermoeide ogen? Zet je scherm wat donkerder.",
            "Zet morgen alvast op papier,\ndan gaat de ochtend vlotter.",
            "Zin in een warme kop thee?"]])
    private static let weekdayMon = Table(id: "w.mon", texts: [
        [
            "월요일이에요. 천천히 시동 걸어요.",
            "한 주의 첫 장, 같이 시작해요."],
        [
            "It’s Monday. Let’s warm up slowly.",
            "First page of the week. Let’s start together."],
        [
            "Het is maandag. Rustig opstarten.",
            "Eerste blad van de week. Samen beginnen."]])
    private static let weekdayWed = Table(id: "w.wed", texts: [
        [
            "벌써 수요일! 한 주의 반이 지났어요.",
            "수요일엔 살짝 지치죠. 조금만 쉬어 가요."],
        [
            "Wednesday already! Half the week is done.",
            "Wednesdays get tiring. Take a little break."],
        [
            "Al woensdag! De week is half om.",
            "Woensdag is vermoeiend. Neem even pauze."]])
    private static let weekdayFri = Table(id: "w.fri", texts: [
        [
            "금요일이에요! 조금만 더 힘내요.",
            "주말이 코앞이에요. 냥!"],
        [
            "It’s Friday! Just a bit more.",
            "The weekend’s almost here. Meow!"],
        [
            "Het is vrijdag! Nog even volhouden.",
            "Het weekend is bijna daar. Miauw!"]])
    private static let weekdayEnd = Table(id: "w.end", texts: [
        [
            "주말엔 할 일도 쉬엄쉬엄.",
            "주말이니까 저도 늘어져 있을래요.",
            "주말에도 한 장 쓰다니,\n대단해요."],
        [
            "Weekend to-dos can take it easy.",
            "It’s the weekend, so I’m lazing around too.",
            "Writing a page on the weekend?\nImpressive."],
        [
            "In het weekend mogen taken rustig aan.",
            "Het is weekend, dus ik hang ook lekker lui.",
            "Een blad schrijven in het weekend?\nKnap hoor."]])
    private static let generalLines = Table(id: "g", texts: [
        [
            "냥.",
            "저 여기 있어요. 필요하면 불러요.",
            "가끔 창밖도 한 번 봐요.",
            "숨 크게 한 번 쉬어요. 후—",
            "잘하고 있어요, 정말로.",
            "등 펴기! 저처럼요.",
            "오늘의 나, 칭찬해요.",
            "모니터에서 눈 떼고 먼 곳 한 번 보기!",
            "꼬리 흔들흔들… 심심해서요.",
            "할 일이 많아도 하나씩이면 돼요.",
            "저는 종이 위에서\n자는 게 제일 좋아요.",
            "가끔은 아무것도 안 해도 돼요.",
            "잘 안 풀리면 잠깐 일어나서 걸어 봐요.",
            "냥냥. 그냥 불러 봤어요.",
            "손목도 한 번 털어 줘요. 탈탈.",
            "완벽하지 않아도 끝내면 이긴 거예요.",
            "어깨에 힘 빼요. 툭.",
            "오늘도 여기까지 온 게 대단해요.",
            "제 꼬리 잡기 놀이 할래요? …농담이에요.",
            "눈 깜빡깜빡. 건조하지 않게요.",
            "하품은 전염돼요. 하아암—",
            "생각이 많을 땐 종이에 적어 보세요.",
            "막히면 잠깐 쉬었다 와도 괜찮아요.",
            "지금 하는 거, 분명 의미 있어요.",
            "저는 늘 여기 바닥에 있어요. 든든하죠?"],
        [
            "Meow.",
            "I’m right here. Call me if you need me.",
            "Look out the window now and then.",
            "Take a big breath. Whew—",
            "You’re doing well. Really.",
            "Sit up straight! Like me.",
            "Today’s you deserves a compliment.",
            "Eyes off the screen. Look at something far away!",
            "Tail swish swish… I’m bored.",
            "Lots to do? One at a time is enough.",
            "Sleeping on paper\nis my favorite thing.",
            "Sometimes it’s okay to do nothing.",
            "Stuck? Get up and walk a bit.",
            "Meow meow. Just saying hi.",
            "Shake out your wrists too. Flap flap.",
            "Finished beats perfect. That’s a win.",
            "Relax your shoulders. Plop.",
            "Making it this far today is amazing.",
            "Want to play catch-my-tail? …Kidding.",
            "Blink blink. Don’t let your eyes dry out.",
            "Yawns are contagious. Yaaawn—",
            "Too much on your mind? Write it down.",
            "Stuck? It’s fine to take a break.",
            "What you’re doing right now matters.",
            "I’m always down here. Reassuring, right?"],
        [
            "Miauw.",
            "Ik ben hier. Roep me als je me nodig hebt.",
            "Kijk af en toe even naar buiten.",
            "Haal eens diep adem. Pfff—",
            "Je doet het goed. Echt.",
            "Rug recht! Net als ik.",
            "Jij van vandaag verdient een compliment.",
            "Ogen van het scherm. Kijk eens ver weg!",
            "Staart zwiep zwiep… ik verveel me.",
            "Veel te doen? Eén voor één is genoeg.",
            "Slapen op papier\nvind ik het allerfijnst.",
            "Soms hoef je even helemaal niks.",
            "Kom je er niet uit? Sta op en loop even.",
            "Miauw miauw. Zomaar even.",
            "Schud je polsen ook even los. Flap flap.",
            "Af is beter dan perfect. Gewonnen!",
            "Schouders los. Plof.",
            "Dat je vandaag al zo ver bent, knap hoor.",
            "Zullen we staartje-vangen spelen? …Grapje.",
            "Knipper knipper. Niet laten uitdrogen.",
            "Gapen is besmettelijk. Haaaa—",
            "Veel aan je hoofd? Schrijf het op.",
            "Vast? Even pauze is prima.",
            "Wat je nu doet, doet ertoe.",
            "Ik zit hier altijd onderaan. Fijn idee, toch?"]])

    private static let pettedLines: [[String]] = [
        ["냥!", "골골골…", "헤헤, 간지러워요.", "쓰다듬어 줘서 고마워요.", "더 해 주세요!", "꾹꾹—", "거기 좋아요, 거기!", "냐앙~", "기분 좋아서 꼬리가 올라갔어요.", "한 번 더요!"],
        ["Meow!", "Purrrr…", "Hehe, that tickles.", "Thanks for the pets.", "More, please!", "Knead knead—", "Right there, right there!", "Mrrow~", "My tail went up, I’m so happy.", "Once more!"],
        ["Miauw!", "Spinnnn…", "Hihi, dat kriebelt.", "Dank je voor het aaien.", "Meer, graag!", "Kneed kneed—", "Daar, ja daar!", "Mrauw~", "Mijn staart gaat omhoog van blijdschap.", "Nog een keer!"]]

    private static let milestoneLines: [[String]] = [
        ["7일째예요. 한 주를 꼬박 채웠어요!", "30일째예요. 한 달을 꼬박 채웠어요!", "100일째예요. 정말 대단해요!"],
        ["Day 7. A whole week!", "Day 30. A whole month!", "Day 100. That’s amazing!"],
        ["Dag 7. Een hele week!", "Dag 30. Een hele maand!", "Dag 100. Echt geweldig!"]]

    private struct Question: Sendable {
        let id: String
        /// Korean, English, Dutch.
        let text: [String]
        let answers: [[Answer]]
        let applies: @Sendable (Context) -> Bool
        func line(_ context: Context, _ l: AppLanguage) -> Line {
            Line(id: id, text: fill(text[l.index], context, l), answers: answers[l.index])
        }
    }

    private static func answer(_ label: String, _ reply: String, _ pose: Pose, _ action: Action? = nil) -> Answer {
        Answer(label: label, reply: reply, pose: pose, action: action)
    }

    private static let questionList: [Question] = [
        Question(id: "q.mood", text: ["오늘 기분은 어때요?", "How are you feeling today?", "Hoe voel je je vandaag?"], answers: [
            [
                answer("좋아요", "저도 덩달아 좋아요!", .happy),
                answer("그냥요", "그런 날도 있죠. 옆에 있을게요.", .tilt),
                answer("별로예요", "토닥토닥. 작은 것 하나만 해도 충분해요.", .happy)],
            [
                answer("Good", "Then I’m happy too!", .happy),
                answer("So-so", "Days like that happen. I’m right here.", .tilt),
                answer("Not great", "Pat pat. One small thing is plenty.", .happy)],
            [
                answer("Goed", "Dan ben ik ook blij!", .happy),
                answer("Gaat wel", "Zulke dagen zijn er ook. Ik blijf bij je.", .tilt),
                answer("Niet zo", "Aai aai. Eén klein dingetje is al genoeg.", .happy)]],
                 applies: { c in true }),
        Question(id: "q.water", text: ["물 마셨어요?", "Have you had some water?", "Heb je al water gedronken?"], answers: [
            [
                answer("마셨어요", "잘했어요! 촉촉—", .cheer),
                answer("아직요", "지금 한 잔 어때요? 기다릴게요.", .tea)],
            [
                answer("Yes", "Good job! Nice and hydrated—", .cheer),
                answer("Not yet", "How about a glass now? I’ll wait.", .tea)],
            [
                answer("Ja", "Goed zo! Lekker fris—", .cheer),
                answer("Nog niet", "Nu een glaasje? Ik wacht wel.", .tea)]],
                 applies: { c in true }),
        Question(id: "q.stretch", text: ["잠깐 기지개 켤래요?", "Want to stretch for a sec?", "Even uitrekken?"], answers: [
            [
                answer("같이 해요", "쭉— 시원하다!", .stretch),
                answer("나중에요", "알겠어요. 무리하지 마요.", .blink)],
            [
                answer("Let’s do it", "Streeetch— that feels good!", .stretch),
                answer("Later", "Okay. Don’t overdo it.", .blink)],
            [
                answer("Doe ik mee", "Rekkk— heerlijk!", .stretch),
                answer("Straks", "Oké. Doe rustig aan.", .blink)]],
                 applies: { c in true }),
        Question(id: "q.first", text: ["‘{first}’ 지금 해 볼까요?", "Do ‘{first}’ now?", "Nu ‘{first}’ doen?"], answers: [
            [
                answer("해 볼게요", "응원할게요! 끝나면 체크!", .cheer),
                answer("나중에", "좋아요, 마음 내킬 때요.", .blink)],
            [
                answer("I’ll try", "Go for it! Check it off when you’re done!", .cheer),
                answer("Later", "Sure, whenever you feel like it.", .blink)],
            [
                answer("Ik probeer het", "Zet hem op! Vink het af als het klaar is.", .cheer),
                answer("Straks", "Prima, wanneer je er zin in hebt.", .blink)]],
                 applies: { c in c.open > 0 && c.firstOpen != nil }),
        Question(id: "q.rest", text: ["많이 했으니 5분 쉬어 갈까요?", "You’ve done a lot. Take five?", "Je hebt veel gedaan. Vijf minuten pauze?"], answers: [
            [
                answer("쉴래요", "좋아요! 5분 타이머를 켜 둘게요.", .yawn, .rest5),
                answer("괜찮아요", "멋져요. 그래도 물은 마셔요!", .hop)],
            [
                answer("Break time", "Great! I’ll set a 5-minute timer.", .yawn, .rest5),
                answer("I’m fine", "Impressive. Still, drink some water!", .hop)],
            [
                answer("Pauze", "Fijn! Ik zet een timer van 5 minuten.", .yawn, .rest5),
                answer("Hoeft niet", "Knap. Maar drink wel water!", .hop)]],
                 applies: { c in c.done >= 2 && c.open > 0 }),
        Question(id: "q.lunch", text: ["점심 메뉴 정했어요?", "Decided what’s for lunch?", "Weet je al wat je gaat lunchen?"], answers: [
            [
                answer("정했어요", "맛있게 먹고 와요!", .happy),
                answer("고민 중", "생선… 아니, 맛있는 걸로요!", .tilt)],
            [
                answer("Yes", "Enjoy your meal!", .happy),
                answer("Still thinking", "Fish… I mean, something tasty!", .tilt)],
            [
                answer("Ja", "Eet smakelijk!", .happy),
                answer("Nog niet", "Vis… ik bedoel, iets lekkers!", .tilt)]],
                 applies: { c in 11 <= c.hour && c.hour < 14 }),
        Question(id: "q.proud", text: ["다 끝냈네요! 기분 어때요?", "All done! How do you feel?", "Alles af! Hoe voelt dat?"], answers: [
            [
                answer("뿌듯해요", "저도 뿌듯해요!", .cheer),
                answer("피곤해요", "푹 쉬어요. 내일 또 봐요.", .yawn)],
            [
                answer("Proud", "I’m proud too!", .cheer),
                answer("Tired", "Rest well. See you tomorrow.", .yawn)],
            [
                answer("Trots", "Ik ben ook trots!", .cheer),
                answer("Moe", "Rust lekker uit. Tot morgen.", .yawn)]],
                 applies: { c in c.open == 0 && c.done > 0 }),
        Question(id: "q.night", text: ["오늘은 일찍 쉴 수 있을까요?", "Think you can rest early tonight?", "Lukt het om vanavond vroeg te rusten?"], answers: [
            [
                answer("네", "좋은 꿈 꿔요.", .yawn),
                answer("조금만 더요", "그럼 딱 하나만 더 해요.", .blink)],
            [
                answer("Yes", "Sweet dreams.", .yawn),
                answer("A bit longer", "Then just one more thing.", .blink)],
            [
                answer("Ja", "Slaap lekker.", .yawn),
                answer("Nog even", "Dan nog één dingetje.", .blink)]],
                 applies: { c in c.hour >= 21 }),
        Question(id: "q.sleep", text: ["어젯밤엔 잘 잤어요?", "Did you sleep well last night?", "Heb je goed geslapen vannacht?"], answers: [
            [
                answer("푹 잤어요", "좋아요! 오늘 컨디션 최고겠네요.", .happy),
                answer("잘 못 잤어요", "오늘은 무리하지 말고 일찍 자요.", .tilt)],
            [
                answer("Like a log", "Great! You’ll be in top shape today.", .happy),
                answer("Not really", "Take it easy today and go to bed early.", .tilt)],
            [
                answer("Heerlijk", "Fijn! Dan ben je vandaag in topvorm.", .happy),
                answer("Niet zo", "Doe vandaag rustig aan en ga vroeg slapen.", .tilt)]],
                 applies: { c in c.hour < 12 }),
        Question(id: "q.snack", text: ["간식 먹을래요?", "Snack time?", "Zin in een snack?"], answers: [
            [
                answer("좋아요", "저도 하나만요… 생선 과자면 더 좋고요.", .happy),
                answer("참을래요", "의지력 대단해요!", .cheer)],
            [
                answer("Yes please", "One for me too… fish treats would be even better.", .happy),
                answer("I’ll pass", "What willpower!", .cheer)],
            [
                answer("Graag", "Ik ook eentje… visjes zijn nog beter.", .happy),
                answer("Ik sla over", "Wat een wilskracht!", .cheer)]],
                 applies: { c in 14 <= c.hour && c.hour < 18 }),
        Question(id: "q.eyes", text: ["눈 좀 쉬어 줄까요? 먼 곳 한 번 봐요.", "Rest your eyes? Look at something far away.", "Je ogen even rust geven? Kijk eens ver weg."], answers: [
            [
                answer("볼게요", "하나, 둘… 잘했어요!", .blink),
                answer("나중에", "그래요. 생각나면 먼 곳 한 번 봐요.", .tilt)],
            [
                answer("Okay", "One, two… well done!", .blink),
                answer("Later", "Okay. Look into the distance when you think of it.", .tilt)],
            [
                answer("Doe ik", "Eén, twee… goed zo!", .blink),
                answer("Straks", "Oké. Kijk even in de verte als je eraan denkt.", .tilt)]],
                 applies: { c in true }),
        Question(id: "q.walk", text: ["잠깐 일어나서 걸을래요?", "Want to get up and walk a bit?", "Even opstaan en een stukje lopen?"], answers: [
            [
                answer("걸을래요", "다녀와요! 자리 지키고 있을게요.", .hop),
                answer("앉아 있을래요", "그럼 다리라도 쭉 펴요.", .stretch)],
            [
                answer("Let’s walk", "Off you go! I’ll guard your seat.", .hop),
                answer("I’ll stay", "Then at least stretch your legs.", .stretch)],
            [
                answer("Ga ik doen", "Ga maar! Ik hou je plekje warm.", .hop),
                answer("Ik blijf zitten", "Strek dan in elk geval je benen.", .stretch)]],
                 applies: { c in true }),
        Question(id: "q.music", text: ["음악 듣고 있어요?", "Listening to music?", "Luister je muziek?"], answers: [
            [
                answer("네", "저도 꼬리로 박자 맞출게요.", .hop),
                answer("아니요", "조용한 것도 좋죠. 사각사각.", .blink)],
            [
                answer("Yes", "I’ll keep the beat with my tail.", .hop),
                answer("No", "Quiet is nice too. Scritch scratch.", .blink)],
            [
                answer("Ja", "Ik tik de maat mee met mijn staart.", .hop),
                answer("Nee", "Stilte is ook fijn. Krts krts.", .blink)]],
                 applies: { c in true }),
        Question(id: "q.pet", text: ["저 쓰다듬어 줄래요?", "Want to pet me?", "Wil je me aaien?"], answers: [
            [
                answer("쓰담쓰담", "골골골… 행복해요.", .happy),
                answer("이따가요", "기다릴게요. 골골.", .tilt)],
            [
                answer("Pat pat", "Purrrr… so happy.", .happy),
                answer("Later", "I’ll wait. Purr.", .tilt)],
            [
                answer("Aai aai", "Spinnnn… zo blij.", .happy),
                answer("Straks", "Ik wacht. Spin spin.", .tilt)]],
                 applies: { c in true }),
        Question(id: "q.weekend", text: ["주말에 뭐 할 거예요?", "Plans for the weekend?", "Plannen voor het weekend?"], answers: [
            [
                answer("놀 거예요", "좋아요! 신나게 놀아요.", .cheer),
                answer("쉴 거예요", "푹 쉬는 것도 멋진 계획이에요.", .yawn)],
            [
                answer("Fun stuff", "Yay! Have a blast.", .cheer),
                answer("Resting", "A good rest is a great plan.", .yawn)],
            [
                answer("Leuke dingen", "Joepie! Veel plezier.", .cheer),
                answer("Uitrusten", "Goed uitrusten is ook een topplan.", .yawn)]],
                 applies: { c in c.weekday == 5 }),
        Question(id: "q.many", text: ["오늘 할 일이 {open}개예요. 할 만해요?", "{open} to-dos today. Doable?", "{open} taken vandaag. Te doen?"], answers: [
            [
                answer("할 만해요", "역시! 하나씩 가요.", .cheer),
                answer("많아요", "하나는 ‘언젠가’로 미뤄도 괜찮아요.", .tilt)],
            [
                answer("Doable", "Knew it! One at a time.", .cheer),
                answer("Too many", "It’s fine to move one to ‘Someday’.", .tilt)],
            [
                answer("Te doen", "Wist ik het! Eén voor één.", .cheer),
                answer("Te veel", "Eentje naar ‘Ooit’ mag gerust.", .tilt)]],
                 applies: { c in c.open >= 3 && c.done == 0 }),
        Question(id: "q.dinner", text: ["저녁은 뭐 먹어요?", "What’s for dinner?", "Wat eet je vanavond?"], answers: [
            [
                answer("맛있는 거", "부럽다… 맛있게 먹어요!", .happy),
                answer("아직 몰라요", "따뜻한 걸로 골라요.", .tilt)],
            [
                answer("Something tasty", "Jealous… enjoy!", .happy),
                answer("Not sure yet", "Pick something warm.", .tilt)],
            [
                answer("Iets lekkers", "Jaloers… eet smakelijk!", .happy),
                answer("Weet ik nog niet", "Kies iets warms.", .tilt)]],
                 applies: { c in 18 <= c.hour && c.hour < 21 }),
        Question(id: "q.ready", text: ["곧 ‘{event}’ 시간이에요. 준비됐어요?", "‘{event}’ is soon. Ready?", "Zo meteen ‘{event}’. Klaar?"], answers: [
            [
                answer("준비됐어요", "잘 다녀와요! 자리 지키고 있을게요.", .hop),
                answer("아직요", "하나씩 챙겨요. 응원할게요.", .cheer)],
            [
                answer("Ready", "Have a good one! I’ll guard your seat.", .hop),
                answer("Not yet", "One thing at a time. I’m cheering for you.", .cheer)],
            [
                answer("Klaar", "Succes! Ik hou je plekje warm.", .hop),
                answer("Nog niet", "Eén ding tegelijk. Ik duim voor je.", .cheer)]],
                 applies: { c in c.nextEvent != nil && c.nextIn <= 15 }),
        Question(id: "q.focus", text: ["다음 일정까지 {in}분 있어요.\n25분 집중해 볼까요?", "{in} min until your next event.\nFocus for 25 minutes?", "Nog {in} min tot je volgende afspraak.\n25 minuten focussen?"], answers: [
            [
                answer("해 볼게요", "좋아요! 25분 타이머를 켤게요.", .cheer, .focus25),
                answer("괜찮아요", "그럼 천천히 해요.", .blink)],
            [
                answer("Let’s go", "Great! I’ll start a 25-minute timer.", .cheer, .focus25),
                answer("No thanks", "Then take it easy.", .blink)],
            [
                answer("Doen we", "Top! Ik start een timer van 25 minuten.", .cheer, .focus25),
                answer("Hoeft niet", "Doe dan rustig aan.", .blink)]],
                 applies: { c in c.nextEvent != nil && c.nextIn >= 40 && c.open > 0 }),
        Question(id: "q.ended", text: ["‘{ended}’ 어땠어요?", "How did ‘{ended}’ go?", "Hoe ging ‘{ended}’?"], answers: [
            [
                answer("잘 끝났어요", "다행이에요! 수고했어요.", .happy),
                answer("힘들었어요", "토닥토닥. 잠깐 쉬어 가요.", .tea)],
            [
                answer("It went well", "Phew! Good job.", .happy),
                answer("It was rough", "Pat pat. Take a short break.", .tea)],
            [
                answer("Ging goed", "Gelukkig! Goed gedaan.", .happy),
                answer("Was zwaar", "Aai aai. Neem even pauze.", .tea)]],
                 applies: { c in c.endedEvent != nil }),
    ]

    private static func lines(_ table: Table, _ context: Context, _ l: AppLanguage) -> [Line] {
        table.texts[l.index].enumerated().map { Line(id: "\(table.id).\($0.offset)", text: fill($0.element, context, l), answers: []) }
    }

    /// Names are shortened to 12 characters in Korean, 20 in English and Dutch.
    private static func fill(_ text: String, _ c: Context, _ l: AppLanguage) -> String {
        let limit = l == .ko ? 12 : 20
        func short(_ title: String) -> String { title.count > limit ? String(title.prefix(limit)).trimmingCharacters(in: .whitespaces) + "…" : title }
        let first = ["첫 할 일", "first to-do", "eerste taak"][l.index], next = ["다음 일정", "next event", "volgende afspraak"][l.index], any = ["일정", "event", "afspraak"][l.index]
        return text.replacingOccurrences(of: "{first}", with: c.firstOpen.map(short) ?? first)
            .replacingOccurrences(of: "{event}", with: c.nextEvent.map(short) ?? next)
            .replacingOccurrences(of: "{now}", with: c.nowEvent.map(short) ?? any)
            .replacingOccurrences(of: "{ended}", with: c.endedEvent.map(short) ?? any)
            .replacingOccurrences(of: "{in}", with: String(c.nextIn))
            .replacingOccurrences(of: "{left}", with: String(c.eventsLeft))
            .replacingOccurrences(of: "{done}", with: String(c.done))
            .replacingOccurrences(of: "{open}", with: String(c.open))
            .replacingOccurrences(of: "{overdue}", with: String(c.overdue))
            .replacingOccurrences(of: "{soon}", with: String(c.dueSoon))
    }
}
