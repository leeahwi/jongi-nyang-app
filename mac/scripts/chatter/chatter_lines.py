# One list of 종이냥 한마디 lines for both apps. generate.py writes the Swift and TypeScript tables from it.
# Existing ids keep their place; new lines are appended so earlier picks stay the same where possible.

PROGRESS = {
    "empty": [
        "오늘 할 일이 비어 있어요. 하나만 적어 볼까요?",
        "빈 종이도 좋아요. 쉬어 가는 날이에요.",
        "할 일 하나 적어 두면 제가 지켜볼게요.",
        "오늘은 뭘 해 볼까요? 생각나는 대로 적어요.",
        "할 일이 없으면\n쉬는 것도 일이에요.",
        "빈 종이 위에서 낮잠 자도 돼요?",
        "작은 것 하나라도 적어 두면\n뿌듯해져요.",
    ],
    "all": [
        "오늘 한 장 다 끝냈어요! 최고예요.",
        "할 일 끝! 남은 시간은 마음껏 쉬어요.",
        "다 했어요. 제가 꾹꾹이 해 줄게요.",
        "오늘의 나, 백 점!",
        "다 끝냈으니 간식 타임 어때요?",
        "체크 표시가 꽉 찼어요. 보기만 해도 좋아요.",
        "내일의 나도 오늘처럼만 해 줘요.",
        "할 일 끝! 저랑 같이 뒹굴어요.",
    ],
    "start": [
        "‘{first}’부터 시작해 볼까요?",
        "첫 번째 체크가 제일 어려워요. 할 수 있어요!",
        "작은 것 하나만 끝내 봐요.",
        "딱 5분만 해 볼까요? 시작이 반이에요.",
        "‘{first}’, 생각보다 금방 끝날지도 몰라요.",
        "제일 쉬운 것부터 해도 괜찮아요.",
        "오늘 첫 체크, 제가 지켜볼게요.",
        "할 일 {open}개, 하나씩 하면 돼요.",
    ],
    "some": [
        "벌써 {done}개 했어요! 좋아요.",
        "{open}개 남았어요. 천천히 가요.",
        "잘하고 있어요. 다음은 ‘{first}’?",
        "이 속도면 금방 끝나겠어요!",
        "벌써 {done}개! 박수 짝짝짝.",
        "{open}개만 더 하면\n오늘 한 장 끝이에요.",
        "잠깐 숨 돌리고\n‘{first}’ 해 볼까요?",
        "체크하는 소리가 좋아요. 사각사각.",
    ],
}

OVERDUE = [
    "지난 마감이 {overdue}개 있어요. 하나만 정리해 볼까요?",
    "붉은 글씨 마감이 {overdue}개 있어요.\n날짜를 다시 정해도 괜찮아요.",
    "지난 마감은 ‘언젠가’로\n옮겨도 괜찮아요.",
    "밀린 일이 있어도 괜찮아요. 하나씩 해요.",
]
DUE_SOON = [
    "곧 마감인 일이 {soon}개 있어요. 잊지 말아요!",
    "내일까지인 일이 있어요. 앞으로 탭 한 번 볼까요?",
    "마감이 다가와요. 오늘 조금만 해 둘까요?",
    "곧 마감! 제가 옆에서 응원할게요.",
]

# (id prefix, first hour, last hour exclusive, lines)
TIME = [
    ("morning", 7, 11, [
        "좋은 아침이에요! 오늘도 한 장 시작해요.",
        "아침 햇살 받으며 기지개 쭉—",
        "커피 한 잔 하셨어요?",
        "아침밥은 먹었어요? 저는 벌써 먹었어요.",
        "오늘은 어떤 하루가 될까요?",
        "창문 열고 바람 한 번 쐬어요.",
        "천천히 시작해도 괜찮아요.",
    ]),
    ("lunch", 11, 14, [
        "점심은 맛있게 먹었어요?",
        "밥 먹고 하는 거예요. 꼭이요!",
        "배고프면 일이 안 돼요. 밥부터!",
        "점심 먹고 잠깐 걷는 건 어때요?",
        "오후도 힘내려면 든든하게요.",
    ]),
    ("after", 14, 18, [
        "오후엔 살짝 졸리죠. 기지개 한 번!",
        "물 한 잔 마셔요. 저는 우유요.",
        "어깨 한 번 돌려 볼까요?",
        "3시엔 간식이죠. 저는 츄르요.",
        "졸릴 땐 찬물 세수 한 번!",
        "오후 햇볕은 낮잠 각이에요… 아, 일해야죠.",
        "조금만 더 하면 저녁이에요.",
    ]),
    ("evening", 18, 23, [
        "오늘도 수고 많았어요.",
        "저녁은 챙겨 먹었어요?",
        "남은 건 내일의 나에게 맡겨도 괜찮아요.",
        "오늘 하루 어땠어요?",
        "저녁엔 눈이 피곤해요. 화면 밝기 줄여 봐요.",
        "내일 할 일을 미리 적어 두면\n아침이 편해요.",
        "따뜻한 차 한 잔 어때요?",
    ]),
]

# Day of the week: 0 = Sunday … 6 = Saturday. (id prefix, days, lines)
WEEKDAY = [
    ("mon", [1], ["월요일이에요. 천천히 시동 걸어요.", "한 주의 첫 장, 같이 시작해요."]),
    ("wed", [3], ["벌써 수요일! 한 주의 반이 지났어요.", "수요일엔 살짝 지치죠. 조금만 쉬어 가요."]),
    ("fri", [5], ["금요일이에요! 조금만 더 힘내요.", "주말이 코앞이에요. 냥!"]),
    ("end", [0, 6], ["주말엔 할 일도 쉬엄쉬엄.", "주말이니까 저도 늘어져 있을래요.", "주말에도 한 장 쓰다니,\n대단해요."]),
]

GENERAL = [
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
    "모르는 건 모른다고 해도 괜찮아요.",
    "지금 하는 거, 분명 의미 있어요.",
    "저는 늘 여기 바닥에 있어요. 든든하죠?",
]

# 일정 (1.29.0 / 1.14.0): today's events. {event} the next one and {in} minutes to it,
# {now} the one going on, {ended} one that ended in the last 20 minutes, {left} events still to come.
EVENTS = {
    "soon": [  # the next event starts within 30 minutes
        "곧 ‘{event}’ 시간이에요. {in}분 남았어요.",
        "{in}분 뒤에 ‘{event}’!\n챙길 거 다 챙겼어요?",
        "‘{event}’ 가기 전에\n물 한 잔 어때요?",
        "‘{event}’까지 {in}분.\n하나만 더 끝내 볼까요?",
        "‘{event}’ 잊지 않았죠? 제가 기억하고 있어요.",
    ],
    "ended": [  # an event ended within 20 minutes
        "‘{ended}’ 끝났어요? 수고했어요!",
        "‘{ended}’ 끝! 잠깐 쉬었다 가요.",
        "‘{ended}’ 다녀오느라 고생했어요.\n물 한 잔 마셔요.",
    ],
    "now": [  # something on the calendar is going on
        "지금은 ‘{now}’ 시간이죠? 힘내요.",
        "‘{now}’ 하는 동안\n저는 조용히 있을게요.",
        "‘{now}’ 끝나면 기지개 한 번 켜요.",
    ],
    "day": [  # the next event is more than 30 minutes away
        "오늘 일정이 {left}개 더 있어요.",
        "다음 일정은 ‘{event}’,\n아직 여유 있어요.",
        "일정 사이사이에 할 일도 하나씩 해요.",
        "‘{event}’ 전에 할 일 하나 끝내 볼까요?",
    ],
}

# (id, text, applies (Swift expr on c, TS expr on c), answers [(label, reply, pose, action|None)])
ALWAYS = ("true", "true")
QUESTIONS = [
    ("q.mood", "오늘 기분은 어때요?", ALWAYS, [
        ("좋아요", "저도 덩달아 좋아요!", "happy", None),
        ("그냥요", "그런 날도 있죠. 옆에 있을게요.", "tilt", None),
        ("별로예요", "토닥토닥. 작은 것 하나만 해도 충분해요.", "happy", None)]),
    ("q.water", "물 마셨어요?", ALWAYS, [
        ("마셨어요", "잘했어요! 촉촉—", "cheer", None),
        ("아직요", "지금 한 잔 어때요? 기다릴게요.", "tea", None)]),
    ("q.stretch", "잠깐 기지개 켤래요?", ALWAYS, [
        ("같이 해요", "쭉— 시원하다!", "stretch", None),
        ("나중에요", "알겠어요. 무리하지 마요.", "blink", None)]),
    ("q.first", "‘{first}’ 지금 해 볼까요?", ("c.open > 0 && c.firstOpen != nil", "c.open > 0 && c.firstOpen !== undefined"), [
        ("해 볼게요", "응원할게요! 끝나면 체크!", "cheer", None),
        ("나중에", "좋아요, 마음 내킬 때요.", "blink", None)]),
    ("q.rest", "많이 했으니 5분 쉬어 갈까요?", ("c.done >= 2 && c.open > 0", "c.done >= 2 && c.open > 0"), [
        ("쉴래요", "좋아요! 5분 타이머를 켜 둘게요.", "yawn", "rest5"),
        ("괜찮아요", "멋져요. 그래도 물은 마셔요!", "hop", None)]),
    ("q.lunch", "점심 메뉴 정했어요?", ("11 <= c.hour && c.hour < 14", "c.hour >= 11 && c.hour < 14"), [
        ("정했어요", "맛있게 먹고 와요!", "happy", None),
        ("고민 중", "생선… 아니, 맛있는 걸로요!", "tilt", None)]),
    ("q.proud", "다 끝냈네요! 기분 어때요?", ("c.open == 0 && c.done > 0", "c.open === 0 && c.done > 0"), [
        ("뿌듯해요", "저도 뿌듯해요!", "cheer", None),
        ("피곤해요", "푹 쉬어요. 내일 또 봐요.", "yawn", None)]),
    ("q.night", "오늘은 일찍 잘 거죠?", ("c.hour >= 21", "c.hour >= 21"), [
        ("네", "좋은 꿈 꿔요.", "yawn", None),
        ("조금만 더요", "그럼 딱 하나만 더 해요.", "blink", None)]),
    # Added in 1.23.1 / 1.8.1
    ("q.sleep", "어젯밤엔 잘 잤어요?", ("c.hour < 12", "c.hour < 12"), [
        ("푹 잤어요", "좋아요! 오늘 컨디션 최고겠네요.", "happy", None),
        ("잘 못 잤어요", "오늘은 무리하지 말고 일찍 자요.", "tilt", None)]),
    ("q.snack", "간식 먹을래요?", ("14 <= c.hour && c.hour < 18", "c.hour >= 14 && c.hour < 18"), [
        ("좋아요", "저도 하나만요… 츄르면 더 좋고요.", "happy", None),
        ("참을래요", "의지력 대단해요!", "cheer", None)]),
    ("q.eyes", "눈 좀 쉬어 줄까요? 먼 곳 한 번 봐요.", ALWAYS, [
        ("볼게요", "하나, 둘… 잘했어요!", "blink", None),
        ("나중에", "꼭이요. 눈은 소중하니까요.", "tilt", None)]),
    ("q.walk", "잠깐 일어나서 걸을래요?", ALWAYS, [
        ("걸을래요", "다녀와요! 자리 지키고 있을게요.", "hop", None),
        ("앉아 있을래요", "그럼 다리라도 쭉 펴요.", "stretch", None)]),
    ("q.music", "음악 듣고 있어요?", ALWAYS, [
        ("네", "저도 꼬리로 박자 맞출게요.", "hop", None),
        ("아니요", "조용한 것도 좋죠. 사각사각.", "blink", None)]),
    ("q.pet", "저 쓰다듬어 줄래요?", ALWAYS, [
        ("쓰담쓰담", "골골골… 행복해요.", "happy", None),
        ("이따가요", "기다릴게요. 꼭이요!", "tilt", None)]),
    ("q.weekend", "주말에 뭐 할 거예요?", ("c.weekday == 5", "c.weekday === 5"), [
        ("놀 거예요", "좋아요! 신나게 놀아요.", "cheer", None),
        ("쉴 거예요", "푹 쉬는 것도 멋진 계획이에요.", "yawn", None)]),
    ("q.many", "오늘 할 일이 {open}개예요. 할 만해요?", ("c.open >= 3 && c.done == 0", "c.open >= 3 && c.done === 0"), [
        ("할 만해요", "역시! 하나씩 가요.", "cheer", None),
        ("많아요", "하나는 ‘언젠가’로 미뤄도 괜찮아요.", "tilt", None)]),
    ("q.dinner", "저녁은 뭐 먹어요?", ("18 <= c.hour && c.hour < 21", "c.hour >= 18 && c.hour < 21"), [
        ("맛있는 거", "부럽다… 맛있게 먹어요!", "happy", None),
        ("아직 몰라요", "따뜻한 걸로 골라요.", "tilt", None)]),
    # 일정 (1.29.0 / 1.14.0)
    ("q.ready", "곧 ‘{event}’ 시간이에요. 준비됐어요?", ("c.nextEvent != nil && c.nextIn <= 15", "c.nextEvent !== undefined && (c.nextIn ?? 0) <= 15"), [
        ("준비됐어요", "잘 다녀와요! 자리 지키고 있을게요.", "hop", None),
        ("아직요", "서둘러요! 제가 응원할게요.", "cheer", None)]),
    ("q.focus", "다음 일정까지 {in}분 있어요.\n25분 집중해 볼까요?", ("c.nextEvent != nil && c.nextIn >= 40 && c.open > 0", "c.nextEvent !== undefined && (c.nextIn ?? 0) >= 40 && c.open > 0"), [
        ("해 볼게요", "좋아요! 25분 타이머를 켤게요.", "cheer", "focus25"),
        ("괜찮아요", "그럼 천천히 해요.", "blink", None)]),
    ("q.ended", "‘{ended}’ 어땠어요?", ("c.endedEvent != nil", "c.endedEvent !== undefined"), [
        ("잘 끝났어요", "다행이에요! 수고했어요.", "happy", None),
        ("힘들었어요", "토닥토닥. 잠깐 쉬어 가요.", "tea", None)]),
]

PETTED = ["냥!", "골골골…", "헤헤, 간지러워요.", "쓰다듬어 줘서 고마워요.", "더 해 주세요!",
          "꾹꾹—", "거기 좋아요, 거기!", "냐앙~", "기분 좋아서 꼬리가 올라갔어요.", "한 번 더요!"]

# What {first}, {event}, {now} and {ended} say when there's nothing to name, and the 한마디 frequency names.
FALLBACK = {"first": "첫 할 일", "event": "다음 일정", "any": "일정"}
FREQUENCY = {"rare": "가끔", "normal": "보통", "often": "자주"}

# ─── English and Dutch ───────────────────────────────────────────────────────
# The same tables as above, line for line: the same number of lines in every group and the same
# questions with the same answers (poses and actions come from the Korean list), so the same random
# numbers pick the same line id in every language. Not word for word — the cat's own voice: warm,
# short, a little cat-silly. Placeholders as in Korean; never "{open} to-dos" where it could be 1.

EN = {
    "PROGRESS": {
        "empty": [
            "Today’s page is empty. Want to write one down?",
            "A blank page is nice too. A day to rest.",
            "Write down a to-do and I’ll keep an eye on it.",
            "What shall we do today? Jot down whatever comes to mind.",
            "Nothing to do?\nResting counts too.",
            "Can I nap on the blank page?",
            "Even one tiny to-do\nfeels good to write down.",
        ],
        "all": [
            "You finished today’s page! You’re the best.",
            "All done! Rest as much as you like.",
            "All done. Have some celebratory kneading.",
            "Today’s you: a perfect score!",
            "All done, so… snack time?",
            "A page full of checkmarks. What a view.",
            "Dear tomorrow-you: do it just like today.",
            "To-dos done! Come roll around with me.",
        ],
        "start": [
            "Shall we start with ‘{first}’?",
            "The first check is the hardest. You’ve got this!",
            "Let’s finish just one small thing.",
            "Just five minutes? Starting is half the work.",
            "‘{first}’ might go quicker than you think.",
            "It’s fine to start with the easiest one.",
            "Today’s first check? I’m watching.",
            "{open} on the page. One at a time.",
        ],
        "some": [
            "{done} down already! Nice.",
            "Only {open} to go. Take it slow.",
            "You’re doing great. ‘{first}’ next?",
            "At this pace, you’ll be done in no time!",
            "{done} done already! Clap clap clap.",
            "Just {open} more\nand today’s page is done.",
            "Catch your breath,\nthen ‘{first}’?",
            "I love the sound of checking. Scritch scratch.",
        ],
    },
    "OVERDUE": [
        "{overdue} past due. Shall we sort out one?",
        "{overdue} in red.\nIt’s okay to pick a new date.",
        "Past deadlines can move\nto ‘Someday’, you know.",
        "Behind on things? That’s okay. One at a time.",
    ],
    "DUE_SOON": [
        "{soon} due soon. Don’t forget!",
        "Something’s due tomorrow. Peek at the Ahead tab?",
        "A deadline’s coming. Do a little today?",
        "Due soon! I’ll cheer you on.",
    ],
    "TIME": {
        "morning": [
            "Good morning! Let’s start today’s page.",
            "Morning sun, big stretch—",
            "Had your coffee yet?",
            "Had breakfast? I already ate mine.",
            "What kind of day will today be?",
            "Open a window and get some fresh air.",
            "It’s fine to start slow.",
        ],
        "lunch": [
            "Did you have a nice lunch?",
            "Eat first, then work. Promise!",
            "Can’t work on an empty tummy. Food first!",
            "How about a little walk after lunch?",
            "Eat well to keep going this afternoon.",
        ],
        "after": [
            "Afternoons get sleepy. Big stretch!",
            "Drink some water. I’ll have milk.",
            "Shall we roll our shoulders?",
            "Three o’clock is snack time. Churu for me.",
            "Sleepy? Splash some cold water on your face!",
            "Afternoon sun is perfect for a nap… oh right, work.",
            "A little more and it’s evening.",
        ],
        "evening": [
            "You worked hard today.",
            "Did you have dinner?",
            "It’s okay to leave the rest to tomorrow-you.",
            "How was your day?",
            "Tired eyes? Turn the screen down a little.",
            "Write tomorrow’s to-dos now\nand the morning gets easier.",
            "How about a warm cup of tea?",
        ],
    },
    "WEEKDAY": {
        "mon": ["It’s Monday. Let’s warm up slowly.", "First page of the week. Let’s start together."],
        "wed": ["Wednesday already! Half the week is done.", "Wednesdays get tiring. Take a little break."],
        "fri": ["It’s Friday! Just a bit more.", "The weekend’s almost here. Meow!"],
        "end": ["Weekend to-dos can take it easy.", "It’s the weekend, so I’m lazing around too.", "Writing a page on the weekend?\nImpressive."],
    },
    "GENERAL": [
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
        "It’s okay to say you don’t know.",
        "What you’re doing right now matters.",
        "I’m always down here. Reassuring, right?",
    ],
    "EVENTS": {
        "soon": [
            "‘{event}’ is coming up. {in} min to go.",
            "‘{event}’ in {in} min!\nGot everything?",
            "Before ‘{event}’,\nhow about a glass of water?",
            "{in} min until ‘{event}’.\nFinish one more thing?",
            "You didn’t forget ‘{event}’, right? I remember.",
        ],
        "ended": [
            "Is ‘{ended}’ over? Good job!",
            "‘{ended}’ done! Take a little break.",
            "Well done getting through ‘{ended}’.\nHave some water.",
        ],
        "now": [
            "It’s ‘{now}’ time, right? You’ve got this.",
            "While ‘{now}’ is on,\nI’ll stay quiet.",
            "When ‘{now}’ is over, have a good stretch.",
        ],
        "day": [
            "{left} more on the calendar today.",
            "Next up is ‘{event}’.\nThere’s still time.",
            "Fit in a to-do between events.",
            "Finish a to-do before ‘{event}’?",
        ],
    },
    "QUESTIONS": {
        "q.mood": ("How are you feeling today?", [
            ("Good", "Then I’m happy too!"),
            ("So-so", "Days like that happen. I’m right here."),
            ("Not great", "Pat pat. One small thing is plenty.")]),
        "q.water": ("Have you had some water?", [
            ("Yes", "Good job! Nice and hydrated—"),
            ("Not yet", "How about a glass now? I’ll wait.")]),
        "q.stretch": ("Want to stretch for a sec?", [
            ("Let’s do it", "Streeetch— that feels good!"),
            ("Later", "Okay. Don’t overdo it.")]),
        "q.first": ("Do ‘{first}’ now?", [
            ("I’ll try", "Go for it! Check it off when you’re done!"),
            ("Later", "Sure, whenever you feel like it.")]),
        "q.rest": ("You’ve done a lot. Take five?", [
            ("Break time", "Great! I’ll set a 5-minute timer."),
            ("I’m fine", "Impressive. Still, drink some water!")]),
        "q.lunch": ("Decided what’s for lunch?", [
            ("Yes", "Enjoy your meal!"),
            ("Still thinking", "Fish… I mean, something tasty!")]),
        "q.proud": ("All done! How do you feel?", [
            ("Proud", "I’m proud too!"),
            ("Tired", "Rest well. See you tomorrow.")]),
        "q.night": ("Early night tonight, right?", [
            ("Yes", "Sweet dreams."),
            ("A bit longer", "Then just one more thing.")]),
        "q.sleep": ("Did you sleep well last night?", [
            ("Like a log", "Great! You’ll be in top shape today."),
            ("Not really", "Take it easy today and go to bed early.")]),
        "q.snack": ("Snack time?", [
            ("Yes please", "One for me too… Churu would be even better."),
            ("I’ll pass", "What willpower!")]),
        "q.eyes": ("Rest your eyes? Look at something far away.", [
            ("Okay", "One, two… well done!"),
            ("Later", "Promise? Eyes are precious.")]),
        "q.walk": ("Want to get up and walk a bit?", [
            ("Let’s walk", "Off you go! I’ll guard your seat."),
            ("I’ll stay", "Then at least stretch your legs.")]),
        "q.music": ("Listening to music?", [
            ("Yes", "I’ll keep the beat with my tail."),
            ("No", "Quiet is nice too. Scritch scratch.")]),
        "q.pet": ("Want to pet me?", [
            ("Pat pat", "Purrrr… so happy."),
            ("Later", "I’ll wait. Promise!")]),
        "q.weekend": ("Plans for the weekend?", [
            ("Fun stuff", "Yay! Have a blast."),
            ("Resting", "A good rest is a great plan.")]),
        "q.many": ("{open} to-dos today. Doable?", [
            ("Doable", "Knew it! One at a time."),
            ("Too many", "It’s fine to move one to ‘Someday’.")]),
        "q.dinner": ("What’s for dinner?", [
            ("Something tasty", "Jealous… enjoy!"),
            ("Not sure yet", "Pick something warm.")]),
        "q.ready": ("‘{event}’ is soon. Ready?", [
            ("Ready", "Have a good one! I’ll guard your seat."),
            ("Not yet", "Hurry! I’m cheering for you.")]),
        "q.focus": ("{in} min until your next event.\nFocus for 25 minutes?", [
            ("Let’s go", "Great! I’ll start a 25-minute timer."),
            ("No thanks", "Then take it easy.")]),
        "q.ended": ("How did ‘{ended}’ go?", [
            ("It went well", "Phew! Good job."),
            ("It was rough", "Pat pat. Take a short break.")]),
    },
    "PETTED": ["Meow!", "Purrrr…", "Hehe, that tickles.", "Thanks for the pets.", "More, please!",
               "Knead knead—", "Right there, right there!", "Mrrow~", "My tail went up, I’m so happy.", "Once more!"],
    "FALLBACK": {"first": "first to-do", "event": "next event", "any": "event"},
    "FREQUENCY": {"rare": "Rarely", "normal": "Sometimes", "often": "Often"},
}

NL = {
    "PROGRESS": {
        "empty": [
            "Vandaag is nog leeg. Zullen we iets opschrijven?",
            "Een leeg blad is ook fijn. Een dagje rust.",
            "Schrijf een taak op, dan let ik erop.",
            "Wat gaan we vandaag doen? Schrijf maar op wat in je opkomt.",
            "Niks te doen?\nUitrusten telt ook.",
            "Mag ik een dutje doen op het lege blad?",
            "Zelfs één klein taakje opschrijven\nvoelt goed.",
        ],
        "all": [
            "Het blad van vandaag is af! Topper.",
            "Alles klaar! Rust lekker uit.",
            "Alles gedaan. Kom, een feestelijk kneedbeurtje.",
            "Jij van vandaag: een tien!",
            "Alles af, dus… snoeptijd?",
            "Een blad vol vinkjes. Wat een gezicht.",
            "Lieve jij-van-morgen: doe het net zo.",
            "Klaar! Kom met me rollebollen.",
        ],
        "start": [
            "Zullen we beginnen met ‘{first}’?",
            "Het eerste vinkje is het moeilijkst. Jij kunt het!",
            "Maak gewoon één klein dingetje af.",
            "Even vijf minuutjes? Goed begonnen is half gewonnen.",
            "‘{first}’ is misschien sneller klaar dan je denkt.",
            "Je mag gerust met de makkelijkste beginnen.",
            "Het eerste vinkje van vandaag? Ik kijk mee.",
            "Nog {open} te gaan. Eén voor één.",
        ],
        "some": [
            "Al {done} klaar! Goed zo.",
            "Nog {open} te gaan. Rustig aan.",
            "Je doet het goed. Nu ‘{first}’?",
            "In dit tempo ben je zo klaar!",
            "Al {done} af! Klap klap klap.",
            "Nog {open} en\nhet blad van vandaag is af.",
            "Even op adem komen,\ndan ‘{first}’?",
            "Ik hou van het geluid van afvinken. Krts krts.",
        ],
    },
    "OVERDUE": [
        "{overdue} over de deadline. Zullen we er één oppakken?",
        "{overdue} in het rood.\nEen nieuwe datum mag gerust.",
        "Verlopen deadlines mogen\ngerust naar ‘Ooit’.",
        "Wat achter? Geeft niks. Eén voor één.",
    ],
    "DUE_SOON": [
        "{soon} bijna aan de beurt. Niet vergeten!",
        "Er moet iets af voor morgen. Even bij Vooruit kijken?",
        "Er komt een deadline aan. Vandaag een stukje doen?",
        "Bijna deadline! Ik moedig je aan.",
    ],
    "TIME": {
        "morning": [
            "Goedemorgen! Laten we het blad van vandaag beginnen.",
            "Ochtendzon, en flink uitrekken—",
            "Al koffie gehad?",
            "Al ontbeten? Ik heb al gegeten.",
            "Wat voor dag wordt het vandaag?",
            "Zet een raam open voor wat frisse lucht.",
            "Rustig beginnen mag best.",
        ],
        "lunch": [
            "Lekker geluncht?",
            "Eerst eten, dan werken. Echt!",
            "Met een lege maag gaat het niet. Eerst eten!",
            "Even een wandelingetje na de lunch?",
            "Eet goed, dan hou je de middag vol.",
        ],
        "after": [
            "’s Middags word je slaperig. Even rekken!",
            "Drink een glas water. Ik neem melk.",
            "Zullen we even de schouders rollen?",
            "Om drie uur is het snoeptijd. Churu voor mij.",
            "Slaperig? Even koud water in je gezicht!",
            "Middagzon is perfect voor een dutje… o ja, werken.",
            "Nog even en het is avond.",
        ],
        "evening": [
            "Je hebt hard gewerkt vandaag.",
            "Heb je al gegeten?",
            "De rest mag jij-van-morgen doen.",
            "Hoe was je dag?",
            "Vermoeide ogen? Zet je scherm wat donkerder.",
            "Zet morgen alvast op papier,\ndan gaat de ochtend vlotter.",
            "Zin in een warme kop thee?",
        ],
    },
    "WEEKDAY": {
        "mon": ["Het is maandag. Rustig opstarten.", "Eerste blad van de week. Samen beginnen."],
        "wed": ["Al woensdag! De week is half om.", "Woensdag is vermoeiend. Neem even pauze."],
        "fri": ["Het is vrijdag! Nog even volhouden.", "Het weekend is bijna daar. Miauw!"],
        "end": ["In het weekend mogen taken rustig aan.", "Het is weekend, dus ik hang ook lekker lui.", "Een blad schrijven in het weekend?\nKnap hoor."],
    },
    "GENERAL": [
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
        "Je mag best zeggen dat je iets niet weet.",
        "Wat je nu doet, doet ertoe.",
        "Ik zit hier altijd onderaan. Fijn idee, toch?",
    ],
    "EVENTS": {
        "soon": [
            "Zo meteen ‘{event}’. Nog {in} min.",
            "Over {in} min ‘{event}’!\nAlles bij de hand?",
            "Voor ‘{event}’\nnog even een glas water?",
            "Nog {in} min tot ‘{event}’.\nNog één ding afmaken?",
            "Je bent ‘{event}’ toch niet vergeten? Ik onthoud het.",
        ],
        "ended": [
            "Is ‘{ended}’ voorbij? Goed gedaan!",
            "‘{ended}’ klaar! Neem even pauze.",
            "Knap dat je ‘{ended}’ hebt gedaan.\nDrink wat water.",
        ],
        "now": [
            "Nu is het tijd voor ‘{now}’, toch? Succes.",
            "Zolang ‘{now}’ bezig is,\nben ik stil.",
            "Na ‘{now}’ even lekker uitrekken.",
        ],
        "day": [
            "Vandaag nog {left} op de agenda.",
            "Hierna komt ‘{event}’.\nNog tijd genoeg.",
            "Doe tussen je afspraken door een taak.",
            "Nog een taak afmaken voor ‘{event}’?",
        ],
    },
    "QUESTIONS": {
        "q.mood": ("Hoe voel je je vandaag?", [
            ("Goed", "Dan ben ik ook blij!"),
            ("Gaat wel", "Zulke dagen zijn er ook. Ik blijf bij je."),
            ("Niet zo", "Aai aai. Eén klein dingetje is al genoeg.")]),
        "q.water": ("Heb je al water gedronken?", [
            ("Ja", "Goed zo! Lekker fris—"),
            ("Nog niet", "Nu een glaasje? Ik wacht wel.")]),
        "q.stretch": ("Even uitrekken?", [
            ("Doe ik mee", "Rekkk— heerlijk!"),
            ("Straks", "Oké. Doe rustig aan.")]),
        "q.first": ("Nu ‘{first}’ doen?", [
            ("Ik probeer het", "Zet hem op! Vink het af als het klaar is."),
            ("Straks", "Prima, wanneer je er zin in hebt.")]),
        "q.rest": ("Je hebt veel gedaan. Vijf minuten pauze?", [
            ("Pauze", "Fijn! Ik zet een timer van 5 minuten."),
            ("Hoeft niet", "Knap. Maar drink wel water!")]),
        "q.lunch": ("Weet je al wat je gaat lunchen?", [
            ("Ja", "Eet smakelijk!"),
            ("Nog niet", "Vis… ik bedoel, iets lekkers!")]),
        "q.proud": ("Alles af! Hoe voelt dat?", [
            ("Trots", "Ik ben ook trots!"),
            ("Moe", "Rust lekker uit. Tot morgen.")]),
        "q.night": ("Vanavond op tijd naar bed, toch?", [
            ("Ja", "Slaap lekker."),
            ("Nog even", "Dan nog één dingetje.")]),
        "q.sleep": ("Heb je goed geslapen vannacht?", [
            ("Heerlijk", "Fijn! Dan ben je vandaag in topvorm."),
            ("Niet zo", "Doe vandaag rustig aan en ga vroeg slapen.")]),
        "q.snack": ("Zin in een snack?", [
            ("Graag", "Ik ook eentje… Churu is nog beter."),
            ("Ik sla over", "Wat een wilskracht!")]),
        "q.eyes": ("Je ogen even rust geven? Kijk eens ver weg.", [
            ("Doe ik", "Eén, twee… goed zo!"),
            ("Straks", "Beloofd? Ogen zijn kostbaar.")]),
        "q.walk": ("Even opstaan en een stukje lopen?", [
            ("Ga ik doen", "Ga maar! Ik hou je plekje warm."),
            ("Ik blijf zitten", "Strek dan in elk geval je benen.")]),
        "q.music": ("Luister je muziek?", [
            ("Ja", "Ik tik de maat mee met mijn staart."),
            ("Nee", "Stilte is ook fijn. Krts krts.")]),
        "q.pet": ("Wil je me aaien?", [
            ("Aai aai", "Spinnnn… zo blij."),
            ("Straks", "Ik wacht. Beloofd!")]),
        "q.weekend": ("Plannen voor het weekend?", [
            ("Leuke dingen", "Joepie! Veel plezier."),
            ("Uitrusten", "Goed uitrusten is ook een topplan.")]),
        "q.many": ("{open} taken vandaag. Te doen?", [
            ("Te doen", "Wist ik het! Eén voor één."),
            ("Te veel", "Eentje naar ‘Ooit’ mag gerust.")]),
        "q.dinner": ("Wat eet je vanavond?", [
            ("Iets lekkers", "Jaloers… eet smakelijk!"),
            ("Weet ik nog niet", "Kies iets warms.")]),
        "q.ready": ("Zo meteen ‘{event}’. Klaar?", [
            ("Klaar", "Succes! Ik hou je plekje warm."),
            ("Nog niet", "Opschieten! Ik moedig je aan.")]),
        "q.focus": ("Nog {in} min tot je volgende afspraak.\n25 minuten focussen?", [
            ("Doen we", "Top! Ik start een timer van 25 minuten."),
            ("Hoeft niet", "Doe dan rustig aan.")]),
        "q.ended": ("Hoe ging ‘{ended}’?", [
            ("Ging goed", "Gelukkig! Goed gedaan."),
            ("Was zwaar", "Aai aai. Neem even pauze.")]),
    },
    "PETTED": ["Miauw!", "Spinnnn…", "Hihi, dat kriebelt.", "Dank je voor het aaien.", "Meer, graag!",
               "Kneed kneed—", "Daar, ja daar!", "Mrauw~", "Mijn staart gaat omhoog van blijdschap.", "Nog een keer!"],
    "FALLBACK": {"first": "eerste taak", "event": "volgende afspraak", "any": "afspraak"},
    "FREQUENCY": {"rare": "Zelden", "normal": "Soms", "often": "Vaak"},
}
