import { h, icon, paper, scrollFade, t, wrapText } from "./api";

/** The same in every language; also in the app's file properties (package.json build.copyright). */
const COPYRIGHT = "© 2026 leeAhwi. All rights reserved.";

/**
 * 도움말: everything the app does, including the gestures nobody would guess (double-click the
 * top to fold, drag the cat, …). Topics on the left, details on the right, and a search box.
 */
interface Entry { title: string; body: string; keys?: string[] }
interface Topic { id: string; title: string; icon: string; headline: string; entries: Entry[] }

/** The four groups in the topic list, each in one of the note's tab colours (tokens, so night paper lowers them too). */
const groups = [
  { title: t("기본"), color: "var(--tab-1)", topics: ["start", "tasks", "quick", "tabs", "alerts"] },        // butter
  { title: t("화면과 기록"), color: "var(--sage-2)", topics: ["window", "desk", "drawer", "history", "calendar"] }, // mint
  { title: t("종이냥"), color: "var(--tab-3)", topics: ["pet", "timer", "alarm"] },                 // blush
  { title: t("더 알아보기"), color: "var(--tab-2)", topics: ["look", "keys", "data", "backup", "ai"] }, // lavender
];
const groupColor = (topic: Topic) => (groups.find((group) => group.topics.includes(topic.id)) ?? groups[3]).color;

const topics: Topic[] = [
  { id: "start", title: t("시작하기"), icon: "sparkles", headline: t("하루에 한 장, 가볍게"), entries: [
    { title: t("종이냥은 어떤 앱인가요?"), body: t("오늘 할 일만 종이 한 장에 적어 두는 작은 노트예요. 적고, 체크하고, 끝내면 종이냥이 축하해 줘요. 인터넷이나 로그인 없이 이 PC에 저장되고, 원하면 OneDrive 같은 공유 폴더로 여러 기기에서 같은 목록을 쓸 수 있어요.") },
    { title: t("창을 닫아도 계속 실행돼요"), body: t("노트의 ×를 눌러도 앱은 작업 표시줄 오른쪽 알림 영역(트레이)의 종이냥 아이콘으로 남아 알림을 계속 보내요. 아이콘을 누르면 오늘 창이 뜨고, 두 번 누르면 노트가 바로 열려요. 완전히 끄려면 아이콘 우클릭 → 종이냥 종료.") },
    { title: t("Windows를 켤 때 함께 실행"), body: t("처음 안내 마지막 카드의 ‘컴퓨터를 켤 때 같이 열기’나 책상 → 꾸미기 → 시작의 ‘Windows 시작 시 종이냥 실행’을 켜 두면 PC를 켤 때 바로 시작해요. 꺼 둔 채로 세 번 직접 켜면 종이냥이 한 번 물어봐요.") },
    { title: t("처음 안내 다시 보기"), body: t("⋯ 메뉴 → 사용 안내에서 처음에 본 카드 안내를 다시 볼 수 있어요.") },
  ] },
  { id: "tasks", title: t("할 일"), icon: "check", headline: t("적고, 체크하고, 끝"), entries: [
    { title: t("할 일 적기"), body: t("노트 맨 아래 입력 줄(‘무엇이든 적어요’)에 쓰고 Enter를 눌러요. Ctrl+N을 누르면 바로 그 줄로 가요. 앞으로 탭에서 적으면 날짜가 있는 일은 그날로, 날짜 없는 일은 언젠가로 들어가고, 노트를 닫거나 접기 직전에 쓰던 내용도 그대로 들어가요."), keys: ["Enter", "Ctrl+N"] },
    { title: t("날짜·시간은 말로 적어요"), body: t("‘보고서 내일 3시’, ‘금요일까지 보고서’, ‘다음 주 월요일 발표’, ‘보고서 10/5까지’처럼 적으면 알림이나 마감이 저절로 정해지고, 그 말은 제목에서 빠져요. 오늘·내일·모레·글피, 요일, 10월 5일·10/5, 오전·오후·저녁 3시, 3시 반, 15:30을 알아들어요. 쓰는 동안 줄 위의 칩이 ‘할 일 · 알림 내일 15:00’처럼 알아들은 뜻을 보여 줘요.") },
    { title: t("할 일만이 아니에요"), body: t("같은 줄에 ‘내일 3시 회의’면 일정, ‘타이머 40’이면 타이머, ‘알람 7시 평일’이면 알람, 여러 줄이면 메모로 넣을 수 있어요. 칩이 둘 이상이면 Tab으로 다른 뜻을 골라요. 자세한 건 ‘빠른 입력’ 주제에 있어요."), keys: ["Tab"] },
    { title: t("다음 · 그 밖에"), body: t("오늘 알림이 아직 남은 할 일은 시간 순서로 맨 위 ‘다음’에 3개까지 모이고, 나머지는 아래 ‘그 밖에’에 있어요. 시간이 지난 알림은 아래 묶음에 남아요. 순서 바꾸기는 아래 묶음 안에서 돼요.") },
    { title: t("완료하기"), body: t("왼쪽 네모를 누르면 글씨에 연필 선이 그어지며 완료돼요. 한 번 더 누르면 완료가 취소돼요.") },
    { title: t("고치기"), body: t("할 일 글자를 누르면 바로 고칠 수 있어요. Enter나 다른 곳을 누르면 저장, Esc는 취소예요."), keys: ["Enter", "Esc"] },
    { title: t("순서 바꾸기"), body: t("줄에 마우스를 올리면 왼쪽에 점 여섯 개 손잡이가 보여요. 잡고 위아래로 끌면 초록 선 자리로 옮겨져요. 우클릭 → 위로/아래로 이동, 줄을 고르고 Ctrl+↑↓도 있어요."), keys: ["Ctrl+↑", "Ctrl+↓"] },
    { title: t("지우기와 되돌리기"), body: t("줄에 마우스를 올리면 오른쪽 끝에 휴지통이 나타나요. 지우면 아래에 ‘지웠어요 · 되돌리기’가 잠깐 떠요. Ctrl+Z로도 되돌리고, Ctrl+Y로 다시 실행해요. 메모를 지울 때, 알림의 ‘모두 끝냄’, 완료한 일 정리도 같은 안내로 되돌릴 수 있어요."), keys: ["Ctrl+Z", "Ctrl+Y"] },
    { title: t("내일로 · 날짜 바꾸기"), body: t("오늘 탭의 줄에 마우스를 올리면 ‘→ 내일’로 내일 할 일로 옮겨요. 우클릭 → 날짜 바꾸기에서 내일 · 이번 주 금요일(월–목요일에만) · 다음 주 월요일 · 언젠가 · 날짜 고르기…를 골라요. 줄을 고른 뒤 Alt+→는 하루 뒤로, Alt+←는 하루 앞으로(오늘보다 앞으로는 안 가요), Alt+↓는 언젠가로. 옮기면 ‘내일로 옮겼어요 · 되돌리기’가 떠요."), keys: ["Alt+→", "Alt+←", "Alt+↓"] },
    { title: t("어제부터 · 3일째"), body: t("날짜 없이 오늘 탭에 있던 할 일이 하루를 넘기면 줄 끝에 ‘어제부터’, 더 오래면 ‘3일째’처럼 작게 적혀요. 마감을 정하거나, 끝내거나, 언젠가로 옮기면 사라져요. 이 날짜는 할 일과 함께 저장돼서 다른 기기(Mac 포함)에서도 같아요.") },
    { title: t("키보드로 다루기"), body: t("↑↓로 줄을 고르면 연한 초록으로 표시돼요. Space로 완료, Enter로 고치기, Delete(⌫)로 지우기, Esc로 선택을 풀어요. 오늘 탭에서는 Ctrl+↑↓로 순서를 바꿔요. 빈 입력 줄에서 ↑를 누르면 마지막 줄로, 마지막 줄에서 ↓를 누르면 입력 줄로 가요. 줄의 빈 곳을 눌러도 골라져요."), keys: ["↑↓", "Space", "Enter", "Delete", "Esc", "Ctrl+↑↓"] },
    { title: t("완료한 일 숨기기·정리"), body: t("아래쪽 ‘완료 숨기기’를 누르면 끝낸 일이 목록에서 잠시 숨겨져요. ⋯ → 완료한 일 정리를 누르면 오늘 끝낸 일을 바로 완료 기록으로 옮겨요.") },
    { title: t("끝낸 개수"), body: t("제목 아래 작은 원과 ‘2 / 5 끝냈어요’가 오늘 할 일 중 끝낸 개수예요. 원이 차오르고, 다 끝내면 초록으로 채워져요. 할 일을 끝내면 위의 종이냥이 고개를 끄덕여요.") },
  ] },
  { id: "quick", title: t("빠른 입력"), icon: "tab", headline: t("한 줄로 무엇이든"), entries: [
    { title: t("입력 줄"), body: t("노트 맨 아래 줄에 무엇이든 적고 Enter. ‘보고서 내일 3시’는 알림이 있는 할 일, ‘내일 3시 회의’는 일정, ‘금요일까지 보고서’는 마감이 있는 할 일, ‘타이머 40’·‘25분 집중’은 타이머, ‘알람 7시 평일’은 알람, 여러 줄(Shift+Enter)은 메모 서랍의 메모가 돼요."), keys: ["Enter", "Shift+Enter", "Ctrl+N"] },
    { title: t("칩과 Tab"), body: t("쓰는 동안 줄 위에 알아들은 뜻이 칩으로 나와요. 고른 칩은 초록 테두리예요. 둘 이상이면 Tab(Shift+Tab)으로 다른 뜻을 고르거나 칩을 눌러요. Ctrl+Enter는 일정으로 넣어요."), keys: ["Tab", "Shift+Tab", "Ctrl+Enter"] },
    { title: t("할 일에 집중하기"), body: t("‘보고서 25분 집중’, ‘집중 25분 보고서’처럼 할 일 이름과 함께 적으면 그 할 일에 집중해요. 같은 이름의 할 일이 있으면 그 할 일, 없으면 오늘 할 일로 새로 만들어요. 넣은 뒤 ‘멈추기’나 Ctrl+Z면 흔적 없이 그만둬요.") },
    { title: t("/로 종류 정하기"), body: t("/할일 /일정 /메모 /타이머 /알람으로 시작하면 그 종류로만 넣어요. 예: ‘/메모 내일 3시 회의’. 알아듣지 못하면 줄 아래에 붉은 글씨로 이유가 나오고 Enter가 아무것도 하지 않아요.") },
    { title: t("넣은 뒤 바꾸기"), body: t("넣으면 줄 위에 ‘일정으로 넣었어요 · 내일 15:00’과 ‘할 일로 바꾸기’가 4초 동안 떠요. 바꾸기를 누르면 방금 넣은 건 흔적 없이 지우고 다음 뜻으로 넣어요. 같은 말을 같은 쪽으로 두 번 바꾸면 다음부터 그쪽을 먼저 골라요(한 번 되돌리면 잊어요). 바로 Ctrl+Z를 누르면 되돌리고 글은 줄로 돌아와요. 타이머는 ‘멈추기’, 알람은 ‘되돌리기’."), keys: ["Ctrl+Z"] },
    { title: t("반복으로 넣기"), body: t("‘매일 물 마시기’, ‘평일 8시 운동’, ‘매주 월 9시 주간 회의’, ‘매월 15일 카드값’처럼 반복하는 말로 시작하면 반복 할 일이 돼요(시각이 있으면 그 시각에 알림). 회의처럼 일정다운 말이면 반복 일정이 먼저 나오고 Tab으로 바꿔요. ‘/반복’으로 시작해도 돼요. 만든 반복은 책상 → 반복에 있어요.") },
    { title: t("몇 분 뒤 알림"), body: t("‘30분 뒤 빨래 꺼내기’, ‘2시간 뒤 회의 준비’, ‘1시간 반 후 약 먹기’처럼 적으면 지금부터 그만큼 뒤에 알림이 울리는 할 일이 돼요.") },
    { title: t("검색"), body: t("Ctrl+F(⋯ → 검색…, 책상 왼쪽 위 ‘검색’)를 누르면 노트 위에 검색 쪽지가 떠요. 오늘 · 앞으로 · 메모 · 완료 기록 · 일정에서 찾고, 맞는 글자는 연한 초록으로 칠해져요. ‘ㅂㄱㅅ’처럼 초성으로도 찾고, 영어와 네덜란드어는 대소문자와 악센트를 가리지 않아요. ↑↓로 고르고 Enter로 열어요 — 할 일은 그 탭에서, 메모는 메모 서랍에서 열리고, 완료 기록은 그날이, 일정은 고치기 쪽지가 떠요."), keys: ["Ctrl+F", "↑↓", "Enter", "Esc"] },
    { title: t("어디서든 빠른 입력"), body: t("다른 앱을 쓰다가도 Ctrl+Alt+N을 누르면 같은 입력 줄이 작은 쪽지로 떠요. 칩 · Tab · Ctrl+Enter도 같아요. Enter로 넣으면 쪽지가 무엇을 했는지 잠깐 보여 주고 닫혀요(노트가 열려 있으면 노트에서 보여 줘요). Esc나 다른 곳을 누르면 그냥 닫혀요. 책상 → 꾸미기 → 빠른 입력에서 끌 수 있어요."), keys: ["Ctrl+Alt+N", "Esc"] },
  ] },
  { id: "tabs", title: t("앞으로"), icon: "tray", headline: t("오늘 · 앞으로 · 메모"), entries: [
    { title: t("두 개의 탭"), body: t("위쪽 색 탭을 누르거나 Ctrl+1–2로 옮겨 다녀요. 메모는 메모 서랍에 있어요(Ctrl+3도 서랍을 열어요). 탭 옆 숫자는 아직 안 끝낸 개수예요(창이 좁으면 숨겨져요)."), keys: [t("Ctrl+1 오늘"), t("Ctrl+2 앞으로"), t("Ctrl+3 메모 서랍")] },
    { title: t("오늘"), body: t("오늘 할 일이에요. 알림·주기 알림·알림 영역 메뉴의 남은 개수·접은 포스트잇은 모두 오늘 탭의 할 일만 세어요.") },
    { title: t("앞으로"), body: t("오늘이 아닌 일이 날짜별로 모여요. ‘이번 주’와 ‘다음 주’는 내일부터 날마다 그날 일정(색 막대 · 시각 · 제목)과 그날까지인 할 일을, ‘그 뒤’는 더 먼 마감을 달별로, 맨 아래 ‘언젠가’는 날짜 없는 일을 보여 줘요. 마감 날이 되면 저절로 오늘 탭으로 올라와요(새벽 4시 기준). 일정을 누르면 고치기, 우클릭은 일정 메뉴예요. 한 주는 일요일부터(네덜란드어는 월요일부터)예요.") },
    { title: t("앞으로에서 적기"), body: t("아래 입력 줄에 ‘금요일까지 보고서’처럼 날짜를 넣어 적으면 그날로, 날짜 없이 적으면 언젠가로 들어가요.") },
    { title: t("다른 날로 옮기기"), body: t("앞으로 탭에서 줄의 손잡이를 잡아 다른 날에 놓으면 마감이 그날로 바뀌고, ‘언젠가’에 놓으면 날짜 없이 언젠가로, 위쪽 ‘오늘’ 탭에 놓으면 오늘로 와요. 놓을 자리는 초록으로 밝아지고, 같은 날 안에서는 순서가 바뀌어요. 옮기면 ‘10월 9일로 옮겼어요 · 되돌리기’가 떠요(Ctrl+Z도 돼요)."), keys: ["Ctrl+Z"] },
    { title: t("탭 사이로 옮기기"), body: t("오늘 탭의 줄에 마우스를 올리면 ‘↓ 언젠가’, 앞으로 탭에서는 ‘↑ 오늘로’ 버튼이 나타나요. 우클릭 메뉴에도 있어요. 마감이 있는 일은 마감 날짜에 따라 자동으로 자리가 정해져요.") },
    { title: t("탭으로 끌어 옮기기"), body: t("오늘 탭에서 줄의 손잡이를 잡고 위쪽 ‘앞으로’ 탭에 놓으면 앞으로로 옮겨져요 — 마감 날짜가 아직 안 왔으면 그날로, 아니면 언젠가로. 놓을 수 있는 탭은 끌어 올리면 초록 테두리로 솟아올라요. Ctrl+Z로 한 번에 되돌려요.") },
  ] },
  { id: "alerts", title: t("알림·반복·마감"), icon: "bell", headline: t("잊지 않게 종이냥이 알려 줘요"), entries: [
    { title: t("알림 카드 열기"), body: t("줄에 마우스를 올려 종 모양 버튼을 누르거나, 줄 끝의 시간·마감 글자를 누르면 그 줄에 붙은 작은 창이 열려요. 위쪽에서 한 번 알림 · 반복 · 마감 · 시간을 골라요(시간은 날이 정해진 할 일에만 있어요).") },
    { title: t("한 번 알림"), body: t("10분 뒤 · 30분 뒤 · 1시간 뒤 · 내일 오전 9시 중에 고르거나, 달력과 시간을 정해요. 지난 시간은 고를 수 없어요. 알림 시각은 줄 끝에 ‘오늘 11:30’처럼 적혀요.") },
    { title: t("반복"), body: t("매일 · 평일 · 매주(요일 여러 개) · 매월(없는 날은 말일)을 고르고, 같은 자리에서 알림 시각을 켜요. 반복하는 날마다 목록에 한 줄씩 나타나고, 전날 것을 못 끝냈으면 새로 쌓지 않고 그 줄을 오늘로 옮겨요. 모든 반복은 책상 → 반복에서 고치거나 지워요.") },
    { title: t("마감"), body: t("오늘까지 · 이번 주 안 · 이번 달 안 · 날짜 지정 중에 골라요. 마감 날이 아직 안 왔으면 ‘앞으로’ 탭의 그날에서 기다리고, ‘오늘 할 일에도 두기’를 켜면 오늘 탭에도 계속 보여요. 표시는 책상 → 꾸미기에서 D-3 또는 ~금 중에 골라요.") },
    { title: t("시간 정하기"), body: t("할 일에 시간을 붙일 수 있어요. 줄 우클릭 → ‘시간 정하기…’나 알림 카드의 ‘시간’에서 시작 → 끝을 고르거나(30분 · 1시간 · 2시간), 입력 줄에 ‘3시부터 5시까지 보고서’, ‘14:00-15:30 보고서’, ‘오후 2시부터 1시간 보고서’처럼 적어요. 끝 없이 시작만 정하면 30분으로 보여요. 알림이 없던 할 일은 시작할 때 알려 드리고, 시간을 옮기면 그 알림도 같이 옮겨져요. 줄 끝에는 시계와 ‘14:00–15:30’이, 하루 띠 막대에는 초록 칸이, 하루 일정표에는 초록 테두리 블록이 보여요. ‘시간 지우기’로 없애요.") },
    { title: t("알림이 오면"), body: t("화면 오른쪽 아래에 종이냥이 쪽지를 들고 와요(펫이 있으면 펫 위에 떠요). 네모를 눌러 하나씩 끝내거나 ‘모두 끝냄’(노트에 ‘3개 끝냈어요 · 되돌리기’), ‘내일로’는 내일 할 일로 옮겨요. 왼쪽 ‘10분 뒤 다시’ 옆 화살표에는 5분 · 10분 · 30분 · 1시간 뒤, 오늘 저녁 7시(오후 6시 전에만), 내일 아침 9시, 내일로 미루기가 있어요. 제목이나 종이냥을 누르면 노트가 열려요.") },
    { title: t("저녁 정리"), body: t("남은 할 일이 있으면 저녁(기본 오후 8시)에 종이냥이 ‘오늘 3개 남았어요. 내일로 넘길까요?’ 하고 물어요. 남길 일은 체크를 풀고 내일로 · 언젠가로 · 그대로 두기를 골라요. 하루 한 번 오고, 집중하는 동안은 기다려요. 그날 저녁을 놓치면 다음 날 처음 노트를 열 때 ‘아침 정리’로 어제 남은 일을 물어봐요. 책상 → 알림 → 하루 정리에서 끄거나 시각(오후 6시–10시)을 바꿔요.") },
    { title: t("오늘 꼭 하나"), body: t("책상 → 알림 → 하루 정리에서 켜면, 새 날 처음 노트를 열 때 빈 입력 줄이 ‘오늘 꼭 하나만 고른다면?’ 하고 물어요. 처음 적은 할 일이 별과 함께 ‘다음’ 맨 위에 오고, 별은 그날이 지나면 사라져요. 할 일 우클릭 → 오늘 꼭 하나로도 골라요.") },
    { title: t("Windows 알림으로도"), body: t("책상 → 알림 → ‘시스템 알림으로도 보내기’: 놓친 것만(기본)이면 고양이와 노트가 모두 숨어 있거나 화면이 잠겨 있을 때 Windows 알림으로도 보내요. 알림의 ‘끝냄’ · ‘10분 뒤’(알람은 ‘끄기’ · ‘다시 알림’)를 바로 누를 수 있고, 알림을 누르면 노트가 열려요. 항상 · 끄기도 골라요. 전체 화면 앱이나 집중 지원(방해 금지)은 알아차리지 못해요.") },
    { title: t("주기 알림"), body: t("남은 할 일이 있으면 정해 둔 간격(기본 30분)마다 한 번에 모아서 알려 줘요. 노트를 쓰는 동안은 기다렸다 알려요. 책상 → 알림에서 간격, 표시 시간, 모양(미니·쪽지·친구)을 고르고 미리보기로 확인해요. 알림 영역 메뉴의 ‘1시간 쉬기’로 잠시 멈출 수 있어요.") },
    { title: t("앱이 켜져 있어야 해요"), body: t("알림은 앱이 실행 중일 때 동작해요. 창을 닫거나 접어도 괜찮지만 알림 영역에서 종료하면 멈춰요.") },
  ] },
  { id: "window", title: t("창 다루기"), icon: "fold", headline: t("작게 접고, 원하는 곳에"), entries: [
    { title: t("창 옮기기"), body: t("위쪽 날짜·제목 줄이나 탭 옆 빈 곳을 잡고 끌어요. 목록 쪽을 끌면 창이 아니라 할 일이 움직여요.") },
    { title: t("작은 포스트잇으로 접기"), body: t("위쪽을 두 번 누르거나, ⋯ → 포스트잇으로 접기, Ctrl+M을 누르면 노트가 종이냥이 붙잡은 작은 포스트잇으로 접혀요. 포스트잇에는 남은 할 일이 3줄까지 보여요. 두 번 누른 자리에 접혀요."), keys: [t("두 번 클릭"), "Ctrl+M"] },
    { title: t("포스트잇 다루기"), body: t("포스트잇을 누르면 노트가 다시 펼쳐지고, 끌면 자리를 옮겨요. 옮긴 자리를 기준으로 노트가 열려요. 우클릭하면 노트 열기 · 아이콘 숨기기 · 종이냥 종료가 있어요.") },
    { title: t("항상 위에 두기"), body: t("위쪽 핀 모양 버튼을 누르면 다른 창 위에 노트가 떠 있어요. 한 번 더 누르면 풀려요.") },
    { title: t("닫기"), body: t("오른쪽 위 ×는 창만 닫아요. 앱은 알림 영역에서 계속 실행돼요.") },
    { title: t("오늘 창"), body: t("알림 영역의 종이냥을 누르면 작업 표시줄 옆에 오늘 창이 떠요. 위의 세 칸은 다음 일정 · 타이머 · 다음 알람(1시간 안이면 붉게, 타이머가 돌면 초록으로), 그 아래 ‘다음’과 오늘 할 일 몇 개(바로 체크), 입력 줄(넣으면 창 안에 알려 줘요), 노트 열기 · 책상 · 종이냥 숨기기. 다른 곳을 누르거나 Esc를 누르면 닫혀요. 우클릭 메뉴는 그대로예요."), keys: [t("클릭"), "Esc"] },
    { title: t("아이콘에 마우스를 올리면"), body: t("1시간 안에 일정이나 알림이 있으면 알림 영역의 종이냥 얼굴에 작은 붉은 점이 생기고, 마우스를 올리면 ‘종이냥 · 치과 40분’처럼 알려 줘요. 타이머가 돌면 ‘종이냥 · 12:30’(할 일에 집중 중이면 ‘● 12:30’), 둘 다면 함께 보여 줘요. 그 밖엔 ‘종이냥’만.") },
    { title: t("어디서든 불러오기"), body: t("다른 앱을 쓰다가도 Ctrl+Alt+J를 누르면 노트가 앞으로 나오고(포스트잇으로 접혀 있으면 펼쳐져요), 노트가 맨 앞에 있을 때 누르면 넣어 둬요. 책상 → 꾸미기 → 빠른 입력에서 끌 수 있어요."), keys: ["Ctrl+Alt+J"] },
    { title: t("화면 가장자리에 붙이기"), body: t("⋯ → 화면 오른쪽에 붙이기 / 왼쪽에 붙이기를 누르면 노트가 그 화면 가장자리에 위아래로 길게 붙어요(너비는 그대로). 같은 메뉴를 한 번 더 누르면 원래 자리로 돌아가요.") },
    { title: t("작업 표시줄"), body: t("타이머나 집중이 도는 동안 작업 표시줄 단추에 진행 막대가 차오르고(일시정지면 노랗게), 단추 위 미리보기에 일시정지 · 그만 · 5분 더 버튼이 생겨요. 단추를 우클릭한 점프 목록에는 빠른 입력 · 빠른 메모 · 책상 · 25분 집중 · 5분 타이머가 있어요. 책상 → 꾸미기 → 시작의 ‘작업 표시줄에 남은 개수’를 켜면 단추에 오늘 남은 할 일 수가 작게 떠요.") },
    { title: t("크기와 위치"), body: t("창 가장자리를 끌어 크기를 바꿔요(350 × 400 – 720 × 1200). 크기·위치·탭·완료 숨김·핀 상태는 다음에 켤 때도 기억해요. 창이 좁으면 탭 숫자가 숨어요. 위쪽 아이콘은 핀 · 책상 · ⋯ · 닫기예요.") },
  ] },
  { id: "desk", title: t("책상"), icon: "desk", headline: t("가끔 쓰는 건 한 창에"), entries: [
    { title: t("책상 열기"), body: t("노트 위 책상 아이콘이나 Ctrl+D를 누르면 책상이 열려요. 왼쪽 목록의 보기(달력 · 완료 기록 · 시계), 설정(꾸미기 · 알림 · 반복 · 종이냥 · 일정 · 저장과 백업 · 메모 서랍 · AI 연결), 도움(도움말 · 사용 안내)을 누르면 오른쪽이 그 칸으로 바뀌어요. 책상은 하나만 열리고, 메뉴 · 알림 영역 · 펫 · 오늘 창에서 고른 것도 이 창의 그 칸으로 열려요."), keys: ["Ctrl+D"] },
    { title: t("키보드로 옮기기"), body: t("책상 안에서 Ctrl+1부터 Ctrl+9까지 목록 위에서부터 차례로(달력 … 저장과 백업) 열려요. 목록을 누른 뒤에는 ↑↓로 옮겨요. Ctrl+, 꾸미기 · Ctrl+H 완료 기록 · F1 도움말."), keys: ["Ctrl+1–9", "↑↓", "Ctrl+,", "Ctrl+H", "F1"] },
    { title: t("크기"), body: t("창 가장자리를 끌어 크기를 바꿔요(가장 작게 760 × 520). 좁으면 왼쪽 목록이 아이콘만 남고, 아이콘에 마우스를 올리면 이름이 보여요. 크기와 자리는 다음에도 기억해요.") },
  ] },
  { id: "drawer", title: t("메모 서랍"), icon: "drawer", headline: t("화면 끝에서 꺼내 보는 메모"), entries: [
    { title: t("메모 탭은 어디 갔나요?"), body: t("1.28부터 노트의 메모 탭은 메모 서랍이 됐어요. 메모 탭에 있던 메모는 모두 서랍의 ‘메모’ 폴더에 그대로 있어요. 노트 위 서랍 버튼, Ctrl+Shift+D, Ctrl+3으로 열어요."), keys: ["Ctrl+Shift+D", "Ctrl+3"] },
    { title: t("열기와 닫기"), body: t("어떤 앱을 쓰다가도 Ctrl+Shift+D를 누르면 마우스가 있는 화면의 끝에서 메모 서랍이 미끄러져 나와요. 화면 끝의 고양이 발 책갈피(손잡이)를 누르거나, ⋯ → 메모 서랍, 고양이 우클릭, 노트 위 서랍 버튼, Ctrl+3, 알림 영역 메뉴로도 열려요. 다른 앱을 눌러도 닫히지 않고, 같은 단축키 · Esc · 오른쪽 위 ×로만 닫혀요."), keys: ["Ctrl+Shift+D", "Esc"] },
    { title: t("바로 적기"), body: t("맨 위 테이프 붙은 쪽지에 적고 Enter를 누르면 지금 폴더 맨 위에 새 메모가 생겨요. Shift+Enter는 줄바꿈, Ctrl+N은 이 쪽지로 가요. 고정에서 적으면 ‘메모’ 폴더에 들어가고 고정돼요."), keys: ["Enter", "Shift+Enter", "Ctrl+N"] },
    { title: t("메모 한 장"), body: t("메모는 날짜로 묶여 보여요 — 고정 · 오늘 · 어제 · 이번 주 · 지난주 · 10월처럼 머리말이 날을 말하고, 카드에는 시간만 짧게 있어요. 카드마다 폴더 색 테이프, 손글씨 제목, 한 줄 미리보기가 있고, 링크가 있으면 주소(누르면 브라우저로 열려요), 전화번호가 있으면 번호(누르면 복사), 체크 목록이면 2/4와 진행 막대가 작게 붙어요. 메모 글은 바뀌지 않아요. 마우스를 올리면 복사 · 고정 · ⋯가 떠요. 누르면 그 자리에서 펼쳐 바로 고치고(한 번에 한 장), 아래 두 묶음에 크게 보기 · 복사 · ⚙(고정 · 이 메모의 종이 · 체크한 줄 지우기)와 폴더로 옮기기 · 지우기, 가운데에 언제 고쳤는지가 있어요. 지우면 ‘메모를 지웠어요 · 되돌리기’가 떠요.") },
    { title: t("체크 목록"), body: t("‘- [ ] 우유’처럼 적은 줄은 체크 상자로 보이고, 누르면 체크돼요(파일에는 ‘- [x] 우유’로 그대로 저장돼요). 접힌 메모에는 2/4와 진행 막대가 보여요. 다 한 줄은 ⚙나 우클릭의 ‘체크한 줄 지우기’로 한 번에 지워요(되돌리기도 돼요).") },
    { title: t("폴더와 책갈피"), body: t("옆 책갈피가 폴더예요. 고른 책갈피에는 이름이, 나머지에는 첫 글자가 있고, 마우스를 올리면 ‘장보기 · 세 장 · Ctrl+3’처럼 알려 줘요. 머리말의 폴더 이름(▾)이나 Ctrl+L을 누르면 폴더 목록이 떠요. 맨 아래 +로 새 폴더(이름과 색). 책갈피 우클릭으로 여기에 새 메모 · 이름 바꾸기 · 색 · 정렬(고친 순 · 만든 순 · 제목 순) · 복제 · 폴더 지우기(안의 메모는 ‘메모’ 폴더로 가고 되돌릴 수 있어요. ‘메모’ 폴더는 지울 수 없어요). 책갈피를 끌어 순서를 바꾸고, 메모를 책갈피에 끌어 놓으면 그 폴더로 옮겨요. 고양이 발 책갈피는 ‘고정’ — 폴더와 상관없이 고정한 메모가 모이고, 우클릭으로 정렬 · 고정 모두 풀기."), keys: ["Ctrl+L"] },
    { title: t("찾기와 키보드"), body: t("Ctrl+F는 모든 폴더에서 찾고(초성도, 폴더 이름도), 결과마다 폴더 이름이 작게 보여요. ↑↓로 메모를 고르고 Enter로 펼쳐요. Esc는 펼친 메모를 접고, 한 번 더 누르면 서랍을 닫아요. Ctrl+1–9는 책갈피 순서대로 폴더, Ctrl+0은 고정, Ctrl+L은 폴더 목록. Ctrl+Shift+C는 고른 메모 복사, Ctrl+Delete는 지우기예요. 우클릭 메뉴는 Shift+F10이나 메뉴 키로도 열려요."), keys: ["Ctrl+F", "↑↓", "Enter", "Esc", "Ctrl+1–9", "Ctrl+0", "Ctrl+L", "Ctrl+Shift+C", "Ctrl+Delete", "Shift+F10"] },
    { title: t("모양과 자리"), body: t("서랍 아래 ⚙(서랍 빈 곳 우클릭과 같아요)에서 새 메모 · 복사한 글로 새 메모, 종이(자동 · 낮 · 밤 · 크라프트 · 모눈), 바탕(불투명 · 반투명 · 강하게 · 바탕 없음), 왼쪽 · 오른쪽을 바로 바꿔요. 반투명 · 강하게는 뒤 화면이 흐리게 비치고(Windows 11), 바탕 없음은 메모만 화면 위에 떠요. 메모 한 장만 다른 종이로 하려면 우클릭 → 이 메모의 종이. 책상 → 메모 서랍에서는 단축키(칸을 누르고 원하는 키, 기본값으로, 끄기)와 손잡이도 정해요. 폭은 서랍 안쪽 끝을 끌어 260–480으로 바꾸고, 다음에도 기억해요. 머리말의 핀을 끄면 다른 앱을 눌렀을 때 그 창 뒤로 가요(닫히지는 않아요).") },
    { title: t("다른 기능과 함께"), body: t("빠른 메모(Ctrl+Alt+M)와 입력 줄의 /메모는 서랍에서 마지막으로 본 폴더에 들어가요. 노트의 검색(Ctrl+F)에서 메모를 고르면 서랍에서 열려요. 폴더 정보는 메모 옆 memo-folders.json에 따로 저장돼서, 옛 버전이 메모를 저장해도 지워지지 않아요. 백업과 공유 폴더에도 함께 가요.") },
    { title: t("어디서든 빠른 메모"), body: t("다른 앱을 쓰다가도 Ctrl+Alt+M을 누르면 화면 위쪽에 작은 종이가 떠요. 몇 줄 적고 Ctrl+Enter를 누르면 메모 서랍(마지막으로 본 폴더) 맨 위에 새 메모로 들어가고 닫혀요. Esc나 다른 곳을 누르면 그냥 닫히고, 쓰던 글은 다음에 열 때 그대로 있어요(앱을 다시 켜도). 펫 우클릭 → 빠른 메모, ⋯ → 빠른 메모…, 알림 영역 메뉴에서도 열려요. 책상 → 꾸미기 → 빠른 입력에서 끌 수 있어요."), keys: ["Ctrl+Alt+M", "Ctrl+Enter", "Esc"] },
    { title: t("복사한 글 넣기"), body: t("책상 → 꾸미기 → 빠른 입력의 ‘빠른 메모를 열 때 복사한 글 넣기’를 켜면, 빈 빠른 메모를 열 때 지난번 이후에 복사한 글이 골라진 채로 들어가요. 그대로 Ctrl+Enter로 넣거나, 그냥 적으면 바뀌어요.") },
  ] },
  { id: "history", title: t("완료 기록"), icon: "calendar", headline: t("한 일은 잔디로 남아요"), entries: [
    { title: t("끝낸 일은 어디로 가나요?"), body: t("완료한 일은 그날까지 목록에 남았다가 다음 날 새벽 4시가 지나면 완료 기록으로 옮겨져요. 새벽 4시 전에 끝낸 일은 전날 한 일로 쳐요. 책상 → 저장과 백업 → 완료한 일에서 다음 날 / 3일 뒤 / 7일 뒤 / 보관 안 함을 골라요.") },
    { title: t("완료 기록 보기"), body: t("아래쪽 ‘완료 기록’이나 Ctrl+H. 깃허브처럼 날마다 끝낸 개수를 초록 잔디로 보여 주고, 연속 기록·월별 막대도 있어요. 칸을 누르면 그날 끝낸 일과 시각이 보여요."), keys: ["Ctrl+H"] },
    { title: t("집중한 시간"), body: t("완료 기록의 ‘집중’ 칸에 고른 기간 동안 집중한 시간과 횟수가 있어요. 칸에 마우스를 올리거나 날짜를 누르면 그날 집중한 시간도 보이고, 잔디 아래에 가장 오래 집중한 일 세 개가 있어요. 집중 기록은 저장 폴더의 focus.jsonl에 따로 남아요.") },
  ] },
  { id: "calendar", title: t("일정 · 달력"), icon: "calendar", headline: t("오늘 일정도 한 장에"), entries: [
    { title: t("하루 띠"), body: t("오늘 일정이나 시간을 정한 할 일, 알림이 있으면 제목 아래에 하루 띠가 보여요. 맨 위에는 종일 일정과 ‘하루 전체 ›’, 그 아래 얇은 막대에 오늘 하루(8시부터 24시까지, 더 이르거나 늦으면 늘어나요)가 있어요: 일정은 제 색으로, 시간을 정한 할 일은 초록으로, 지난 시간은 조금 어둡게, 지금은 붉은 눈금으로. 가운데에는 지금 하는 일이 크게 적히고, 옆 동그라미에 남은 시간(‘40분 남음’)이 보여요. 지금 하는 일이 없으면 다음 일과 그때까지 남은 시간(‘40분 뒤’, 1시간 안이면 붉게)이 보여요. 그 아래에는 다음 일이 두 줄(좁은 노트는 한 줄, 큰 노트는 세 줄)이에요. 지금 하는 일이 할 일이면 동그라미를 눌러 바로 집중하고, 칸에 체크해 끝낼 수 있어요. 줄을 누르면 그 일정이나 할 일로 가고, 우클릭하면 그 메뉴가 떠요. ‘하루 전체 ›’나 막대를 누르면 그 자리에서 하루 일정표가 펼쳐져요: 한 시간에 한 칸, 일정은 색 블록, 할 일은 초록 테두리 블록, 알림은 작은 이름표(겹치면 나란히, 넷째부터는 ‘+N’). 할 일이나 일정 블록을 끌면 마우스를 그대로 따라오고, 놓으면 점선으로 보이던 15분 칸에 자리 잡아요(끄는 동안 블록 위에 바뀔 시간이 보여요). 블록의 위나 아래 끝에 마우스를 올리면 ↕ 모양과 작은 손잡이가 보이고, 그대로 끌면 시작이나 끝 시간이 바뀌어요(가장 짧게 15분). 끄는 동안 일정표 위아래 끝으로 가면 스크롤되고, Esc로 취소, 안내의 ‘되돌리기’나 Ctrl+Z로 되돌려요. 빈 칸을 누르면 그 시간에 넣을 할 일이나 일정을 적고, 두 번 누르면 새 일정 쪽지가 열려요. ↑↓로 고르고 Enter로 열고, Space로 할 일을 끝내고, Alt+↑↓로 15분씩 옮기고, Shift+Alt+↑↓로 끝을 15분씩 늘리거나 줄여요. ‘접기’나 Esc로 접어요(펼쳐 두면 그날은 펼친 채로 있어요). 책상 → 일정 → 하루 띠 보이기로 끌 수 있어요.") },
    { title: t("새 일정 만들기"), body: t("입력 줄에 ‘내일 3시 회의’처럼 적으면 바로 일정으로 들어가요(Ctrl+Enter면 언제나 일정). ⋯ → 새 일정…, 하루 일정표의 빈 칸을 두 번, 달력에서 날짜를 두 번 누르면 일정 쪽지가 열려요. 제목은 손글씨로, 날짜 · 시간 · 반복은 칩을 눌러 작은 달력이나 15분 단위 목록에서 고르거나 ‘17:20’처럼 적어요. 색 · 장소를 정하고 만들기를 누르면 바로 들어가요."), keys: ["Ctrl+Alt+N", "Ctrl+Enter"] },
    { title: t("반복 · 색"), body: t("반복은 안 함 · 매일 · 매주 · 매월 · 매년. 매월 31일처럼 그 날이 없는 달은 건너뛰고, 2월 29일은 윤년에만 와요. 반복 일정을 고치면 모든 날이 함께 바뀌고, 지울 때는 ‘이 날만’이나 ‘모두 지우기’를 골라요. 색은 파랑 · 초록 · 주황 · 보라 · 노랑 · 회색 중 하나로, 띠와 달력에 그 색으로 보여요. 새 일정은 마지막에 쓴 색으로 시작해요.") },
    { title: t("할 일을 일정으로"), body: t("할 일 줄을 우클릭한 메뉴의 ‘달력에 넣기…’. 할 일의 알림 시각이나 마감으로 날짜를 채워요(둘 다 없으면 곧 다가올 30분 단위 한 시간). 넣은 할 일은 줄 끝에 작은 달력 표시가 붙어요. 그 순간의 사본이라 넣은 뒤 할 일을 고쳐도 일정은 그대로예요.") },
    { title: t("일정 알림"), body: t("책상 → 일정에서 일정 몇 분 전에 알려 줄지(끔 · 5 · 10 · 15 · 30분 전)와 하루 띠를 보일지 골라요. 알림은 ‘일정 · 10분 뒤 17:15’ 쪽지로 오고, 제목이나 ‘달력에서 열기’를 누르면 달력이 그 날로 열려요. ‘5분 전에 다시’를 누르면 시작 5분 전에 한 번 더 알려 줘요.") },
    { title: t("달력"), body: t("노트 위 책상 아이콘, ⋯ → 달력 또는 Ctrl+D로 책상의 달력이 열려요. 월 · 주로 일정과 마감을 한눈에 보고, 날짜를 누르면 오른쪽에 그날 일정과 할 일이 보여요. 두 번 누르면 새 일정, 일정을 누르면 고치기."), keys: ["Ctrl+D"] },
    { title: t("어디에 저장되나요?"), body: t("일정은 할 일과 같은 저장 폴더의 events.json에 있어요. 공유 폴더를 쓰면 다른 기기의 종이냥(Mac 포함)과 함께 써요. 다른 컴퓨터로 한 번에 옮기려면 백업 · 옮기기를 보세요.") },
  ] },
  { id: "pet", title: t("종이냥 펫"), icon: "paw", headline: t("화면 아래 작은 친구"), entries: [
    { title: t("펫과 놀기"), body: t("종이냥이 화면 아래(작업 표시줄 위)에서 지내요. 누르면 하트가 나오고, 두 번 누르면 노트가 열려요. 잡고 끌면 자리를 옮기고, 다른 모니터로 옮길 수도 있어요.") },
    { title: t("종이냥이 하는 일"), body: t("가만히 있을 땐 숨을 쉬고, 가끔 깜빡이고 갸웃하고 걷고 그루밍하고 차를 마셔요. PC를 5분 넘게 안 쓰면 하품하고 잠들었다가, 돌아오면 기지개를 켜요. 할 일이나 타이머를 끝내면 축하해 줘요. 일요일 저녁 6시가 지나면 일주일에 한 번, 이번 주에 끝낸 개수를 말해 줘요.") },
    { title: t("종이냥 한마디"), body: t("가끔 오늘 남은 일, 시간대, 마감에 맞춰 응원하거나 말을 걸어요. 일정을 적어 두면 ‘곧 팀 회의 시간이에요’, ‘회의 끝났어요? 수고했어요!’처럼 오늘 일정 이야기도 해요. ‘물 마셨어요?’처럼 물어볼 땐 말풍선의 버튼으로 답하면 대답해 줘요(‘5분 쉬어 갈까요?’에 ‘쉴래요’면 5분, 다음 일정까지 여유가 있을 때 ‘25분 집중해 볼까요?’에 ‘해 볼게요’면 25분 타이머가 켜져요). 집중 타이머가 도는 동안, 알림이 떠 있을 때, 밤 11시부터 아침 7시까지는 조용해요. 책상 → 종이냥 → 종이냥 한마디에서 끄거나 횟수를 바꾸고, ‘들어 보기’로 바로 들어 볼 수 있어요.") },
    { title: t("우클릭 메뉴"), body: t("타이머 · 노트 열기 · 돌아다니기 · 펫 숨기기가 있어요. 펫이 있으면 알림이 펫 위에 말풍선으로 떠요.") },
    { title: t("보이기·숨기기"), body: t("알림 영역 메뉴의 ‘종이냥 펫’, ⋯ 메뉴, 책상 → 종이냥에서 켜고 꺼요. 고양이 위가 아닌 곳은 클릭이 뒤 창으로 그대로 전달돼요.") },
  ] },
  { id: "timer", title: t("집중 타이머"), icon: "timer", headline: t("25분 집중, 5분 휴식"), entries: [
    { title: t("타이머 켜기"), body: t("펫 우클릭 → 타이머, 알림 영역 메뉴 → 타이머, 노트 ⋯ → 타이머, 책상 → 시계에서 5·15·25·50분 타이머나 뽀모도로를 시작해요.") },
    { title: t("팻말 다루기"), body: t("종이냥이 든 팻말에 빨간 원(집중)·초록 원(휴식)이 줄어들어요. 팻말을 누르면 일시정지(종이냥이 눈을 감아요), 일시정지·종료 버튼으로 멈추거나 끝내요. 끌어서 원하는 곳에 두면 다음에도 그 자리에 떠요. 우클릭하면 5분 더 · 중지 메뉴가 있어요.") },
    { title: t("뽀모도로"), body: t("집중 25분 → 휴식 5분, 4번마다 긴 휴식 15분. 책상 → 시계에서 시간과 횟수, 다음 단계 자동 시작, 끝날 때 소리를 정해요. 앱을 다시 켜도 타이머는 이어져요.") },
    { title: t("할 일에 집중"), body: t("할 일 줄에 마우스를 올려 시계 모양 집중 버튼을 누르거나, 줄을 고르고 F, 우클릭 → ‘이거 집중’에서 시간(뽀모도로의 집중 시간, 50분, 최근 시간, 직접 정하기…, 뽀모도로로)을 고르거나, 입력 줄에 ‘보고서 25분 집중’처럼 적으면 노트가 집중 카드 한 장이 돼요. 남은 시간 고리 아래의 ⏸(Space)로 멈추고 이어 가고, ‘다 했어요’(Ctrl+Enter, 체크하고 끝) · ‘5분 더’(Ctrl+=) · ‘다음에’. 타이머 메뉴의 ‘할 일 골라 집중…’은 오늘 탭에서 고르게 해 줘요. 집중하는 동안 종이냥 한마디와 다른 할 일 알림은 쉬었다가 끝나면 한꺼번에 와요. 일정 알림과 알람은 그대로 와요."), keys: ["F", "Space", "Ctrl+Enter", "Ctrl+=", "Esc"] },
    { title: t("시간이 다 되면"), body: t("부드러운 소리와 함께 고리가 초록이 되고 ‘25분 다 됐어요’. 뽀모도로면 ‘5분 쉬기’로 쉬고, 쉬는 시간이 끝나면 ‘다음 라운드’나 ‘그만하기’를 골라요. Esc나 ×를 누르면 그만둘지 물어봐요. 노트를 닫아 두면 팻말이 할 일 이름과 남은 시간을 보여 주고, 팻말을 누르면 노트가 다시 떠요.") },
    { title: t("시간 직접 정하기"), body: t("타이머 메뉴의 ‘직접 정하기…’를 누르면 작은 종이가 떠요. 40, 1:30, 1시간 30분, 1.5h처럼 적고 Enter를 누르면 시작해요(1분에서 3시간까지). 최근에 쓴 시간은 메뉴의 5·15·25·50분 아래에 ‘40분 타이머’처럼 3개까지 남아요. 책상 → 시계 → 타이머 시작의 ‘직접’ 칸도 같아요."), keys: ["Enter", "Esc"] },
  ] },
  { id: "alarm", title: t("알람", undefined, "group"), icon: "alarm", headline: t("정한 시각에 깨워 줄게요"), entries: [
    { title: t("알람 만들기"), body: t("책상 → 시계 → 알람의 ‘알람 추가’를 누르면 평일 오전 7:00 알람이 생기고 바로 고칠 수 있게 열려요. 시각, 이름(예: 약 먹기), 요일, 소리, 다시 알림(없음 · 5 · 10 · 15분)을 정하고 ‘완료’. 줄의 스위치로 켜고 끄고, 줄을 누르면 다시 고쳐요. 펫 우클릭 → 알람…, ⋯ → 알람…으로도 열려요.") },
    { title: t("요일"), body: t("요일을 고르지 않으면 한 번만 울리고, 울린 뒤 끄면 저절로 꺼져요. 월~금은 ‘평일’, 토·일은 ‘주말’, 모두 고르면 ‘매일’로 적혀요. 줄 아래에 ‘7시간 30분 뒤에 울려요’처럼 다음에 울릴 때를 보여 주고, 켜 둔 알람이 있으면 알림 영역 메뉴에 ‘다음 알람 오전 7:00’이 보여요.") },
    { title: t("울리면"), body: t("화면 가운데(펫이 있으면 펫 위)에 울리는 쪽지가 떠요 — 종을 흔드는 종이냥, 얼마나 울렸는지, 큰 시각과 이름, 다음에 울릴 때. ‘끄기’(Enter)로 멈추고, 아래 ‘다시 울림’의 5 · 10 · 15분을 누르거나 S · Space(알람에 정한 시간), 1 · 2 · 3(5 · 10 · 15분)으로 다시 울리게 해요. 10분 동안 아무것도 누르지 않으면 저절로 멈추고 한 번 더 다시 울린 뒤 그만둬요. 다시 알림을 ‘없음’으로 정한 알람은 ‘끄기’만 있고, 10분이 지나면 그냥 멈춰요."), keys: ["Enter", "S", "Space", "1 · 2 · 3"] },
    { title: t("소리"), body: t("종소리 · 부드럽게 · 소리 없음 중에 골라요. ‘들어 보기’로 한 번 들어 볼 수 있어요. 소리 없음이면 창만 떠요.") },
    { title: t("컴퓨터가 잠들어 있으면"), body: t("알람은 종이냥이 켜져 있을 때 울려요. 컴퓨터가 잠들어 있다가 알람 시각에서 15분 안에 깨어나면 그때 울리고, 그보다 늦으면 조용히 건너뛰어요.") },
    { title: t("기기마다 울려요"), body: t("알람은 할 일과 같은 저장 폴더의 alarms.json에 있어요. 공유 폴더를 쓰면 다른 기기와 같은 알람을 쓰고, 켜져 있는 기기마다 따로 울려서 기기마다 따로 꺼요. 한 번만 울리는 알람은 한 곳에서 끄면 모든 기기에서 꺼져요.") },
  ] },
  { id: "look", title: t("꾸미기·설정"), icon: "brush", headline: t("내 손에 맞게"), entries: [
    { title: t("글꼴과 글자 크기"), body: t("손글씨 펜 · 손글씨 붓 · 기본 글씨 중에 고르고, 글자 크기는 작게 · 보통 · 크게 · 아주 크게. 책상 → 꾸미기, ⋯ 메뉴, Ctrl+= / Ctrl+−로 바꿔요."), keys: ["Ctrl+=", "Ctrl+−"] },
    { title: t("밤 종이"), body: t("책상 → 꾸미기 → 종이 색에서 자동 · 낮 · 밤을 골라요. 자동은 Windows의 어둡게 모드를 따라가고, 밤 종이는 불 끈 방의 종이 색이에요. 바꾸면 열려 있는 창이 모두 바로 바뀌어요.") },
    { title: t("설정 열기"), body: t("⋯ → 종이냥 설정…이나 Ctrl+,로 책상의 꾸미기가 열려요. 설정에는 꾸미기 · 알림 · 반복 · 종이냥 · 일정 · 저장과 백업 · 메모 서랍 · AI 연결이 있어요."), keys: ["Ctrl+,"] },
  ] },
  { id: "keys", title: t("단축키"), icon: "keyboard", headline: t("손을 키보드에서 떼지 않고"), entries: [
    { title: t("어디서든"), body: t("빠른 입력 Ctrl+Alt+N — 다른 앱을 쓰는 중에도 입력 줄 쪽지가 떠요. Enter 넣기 · Tab 다른 뜻 · Ctrl+Enter 일정 · Esc 닫기. 빠른 메모 Ctrl+Alt+M · 노트 보이기 · 숨기기 Ctrl+Alt+J · 메모 서랍 Ctrl+Shift+D(설정에서 바꿔요)."), keys: ["Ctrl+Alt+N", "Tab", "Ctrl+Enter", "Ctrl+Alt+M", "Ctrl+Alt+J"] },
    { title: t("할 일"), body: t("입력 줄 Ctrl+N · 줄 바꿈 Shift+Enter · 넣은 것 되돌리기 · 되돌리기 Ctrl+Z · 다시 실행 Ctrl+Y · 목록 복사 Ctrl+Shift+C · 텍스트로 내보내기 Ctrl+E"), keys: ["Ctrl+N", "Shift+Enter", "Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+C", "Ctrl+E"] },
    { title: t("줄 고르기"), body: t("줄 고르기 ↑↓ · 완료 Space · 고치기 Enter · 지우기 Delete · 선택 풀기 Esc · 순서 바꾸기 Ctrl+↑↓(오늘 탭, 앞으로의 같은 날 안) · 하루 뒤로 Alt+→ · 하루 앞으로 Alt+← · 언젠가로 Alt+↓ · 집중 F"), keys: ["↑↓", "Space", "Enter", "Delete", "Esc", "Ctrl+↑↓", "Alt+→", "Alt+←", "Alt+↓", "F"] },
    { title: t("탭과 메모"), body: t("오늘 Ctrl+1 · 앞으로 Ctrl+2 · 메모 서랍 Ctrl+3 · 서랍에 새 메모 Ctrl+Shift+N"), keys: ["Ctrl+1–3", "Ctrl+Shift+N"] },
    { title: t("창과 앱"), body: t("검색 Ctrl+F · 접기 Ctrl+M · 완료 기록 Ctrl+H · 달력 Ctrl+D · 설정 Ctrl+, · 도움말 F1 · 책상 안에서 Ctrl+1–9"), keys: ["Ctrl+F", "Ctrl+M", "Ctrl+H", "Ctrl+D", "Ctrl+,", "F1", "Ctrl+1–9"] },
    { title: t("집중 카드"), body: t("멈춤 · 계속 Space · 다 했어요 Ctrl+Enter · 5분 더 Ctrl+= · 그만두기 Esc(먼저 물어봐요)"), keys: ["Space", "Ctrl+Enter", "Ctrl+=", "Esc"] },
    { title: t("글자 크기"), body: t("크게 Ctrl+= · 작게 Ctrl+−"), keys: ["Ctrl+=", "Ctrl+−"] },
  ] },
  { id: "data", title: t("저장 위치"), icon: "folder", headline: t("내 PC에, 원하면 공유 폴더에"), entries: [
    { title: t("저장 위치"), body: t("처음에는 %APPDATA%\\PaperTodo 폴더 안에 할 일(todos.json), 메모(memos.json), 반복(repeats.json), 일정(events.json), 알람(alarms.json), 메모 서랍의 폴더(memo-folders.json), 완료 기록(archive 폴더), 집중 기록(focus.jsonl)이 있어요. 바뀔 때마다 바로 저장돼요. 책상 → 저장과 백업에서 지금 위치를 볼 수 있어요. AI 연결의 설정(ai-link.json)과 Claude가 한 일의 기록(ai-log.jsonl)도 이 폴더에 있어요. 공유 폴더를 골라도 이 둘은 이 PC의 이 폴더에 남아요.") },
    { title: t("여러 기기에서 같은 목록 쓰기"), body: t("책상 → 저장과 백업 → ‘다른 폴더…’에서 OneDrive · Dropbox · iCloud Drive 같은 동기화 폴더를 골라요. 폴더에 이미 종이냥 목록이 있으면 그 목록을 쓸지, 지금 목록으로 바꿀지 물어보고, 종이냥이 다시 시작돼요. 다른 PC나 Mac에서도 같은 폴더를 고르면 같은 목록을 써요."), keys: [t("다른 폴더…"), t("기본으로")] },
    { title: t("다른 기기에서 바뀌면"), body: t("공유 폴더의 파일이 바뀌면 잠시 뒤 저절로 다시 읽어 와요(그때 되돌리기 기록은 새로 시작해요). 새 파일을 오래된 내용으로 덮어쓰지 않아요. 두 기기에서 거의 같은 때 고쳐도 양쪽 변경이 다 남고, 같은 메모를 함께 고치면 두 글을 합쳐요(같은 자리를 서로 다르게 고친 줄은 둘 다 남겨요). 할 일 알림은 켜져 있는 기기마다 울리고, 꺼져 있던 기기는 다른 기기가 이미 알린 지난 알림을 다시 띄우지 않아요. 글꼴·알림 같은 설정은 기기마다 따로예요. ‘기본으로’를 누르면 공유 목록을 이 PC로 복사해 돌아와요.") },
    { title: t("Mac과 함께 쓰기"), body: t("Mac용 종이냥과 같은 파일 형식이에요. 공유 폴더로 함께 쓰거나, 백업 · 옮기기의 .jongi 파일로 한 번에 옮길 수 있어요.") },
    { title: t("복사·내보내기"), body: t("Ctrl+Shift+C는 목록을 글자로 복사하고, Ctrl+E는 텍스트 파일로 내보내요. 오늘 할 일 다음에 [앞으로](날짜 순)·[언젠가]가 따로 적혀요."), keys: ["Ctrl+Shift+C", "Ctrl+E"] },
  ] },
  { id: "backup", title: t("백업 · 옮기기"), icon: "share", headline: t("다른 컴퓨터로 한 번에"), entries: [
    { title: t("내보내기"), body: t("책상 → 저장과 백업의 ‘내보내기…’, ⋯ 메뉴나 알림 영역 메뉴의 ‘내보내기…’. 할 일 · 메모 · 반복 · 일정 · 알람 · 완료 기록 · 집중 기록이 ‘종이냥-백업-날짜.jongi’ 파일 하나에 담기고, 저장하면 탐색기에서 그 파일을 보여 줘요. 글꼴·알림 같은 설정은 기기마다 따로라 담지 않아요.") },
    { title: t("가져오기"), body: t("다른 컴퓨터(Mac이나 Windows)의 종이냥에서 ‘가져오기…’로 .jongi 파일을 골라요. 어디서 언제 내보냈는지와 들어 있는 개수를 보여 주고, 합치기나 바꾸기를 물어요. 파일이 깨졌거나 더 새 버전에서 만든 것이면 아무것도 바꾸지 않고 알려 줘요.") },
    { title: t("합치기와 바꾸기"), body: t("합치기는 지금 것은 그대로 두고 백업에만 있는 할 일 · 메모 · 반복 · 일정 · 완료 기록을 더해요(같은 것은 지금 것이 남아요). 바꾸기는 지금 것을 모두 백업의 것으로 바꿔요(한 번 더 물어요). 어느 쪽이든 먼저 지금 상태를 설정 폴더(%APPDATA%\\PaperTodo)의 backups 폴더에 ‘가져오기-전-날짜-시각.jongi’로 저장해 두고, 최근 10개를 남겨요. 그 파일을 다시 가져오면 되돌릴 수 있어요.") },
    { title: t("공유 폴더와 다른 점"), body: t("공유 폴더는 여러 기기가 같은 목록을 계속 함께 쓰는 거예요. 백업은 지금 상태를 한 번 옮기는 거예요 — 새 컴퓨터로 이사할 때, 공유 폴더 없이 옮길 때, 미리 한 벌 남겨 둘 때 써요.") },
  ] },
  { id: "ai", title: t("AI 연결"), icon: "chat", headline: t("Claude와 이야기하며 정리해요"), entries: [
    { title: t("무엇을 할 수 있나요"), body: t("Claude 데스크톱이나 Claude Code와 이야기하면서 할 일 · 일정 · 메모를 보고, 새로 넣고, 할 일과 반복하지 않는 일정을 고쳐요. 예: “내일 3시~4시 보고서 쓰기 넣어줘”, “이번 주 뭐 했는지 정리해줘”. 지우기, 반복 일정 · 알람 고치기, 메모 고치기는 하지 않아요.") },
    { title: t("켜고 연결하기"), body: t("책상 → AI 연결에서 ‘Claude가 종이냥을 보고 쓸 수 있게 하기’를 켜요(처음에는 꺼져 있어요). ‘Claude 데스크톱에 연결’을 누르면 Claude 데스크톱이 ‘종이냥 for Claude’를 설치할지 물어봐요. Claude Code는 ‘Claude Code 명령 복사’로 복사한 명령을 터미널에 붙여 넣어요(Node 없이 종이냥이 실행해요). 끄면 Claude는 아무것도 읽거나 쓰지 못해요."), keys: [t("Claude 데스크톱에 연결"), t("Claude Code 명령 복사")] },
    { title: t("고치기 전에 물어봐요"), body: t("Claude는 고치기 전에 바뀌기 전과 후를 대화에 먼저 보여 주고, ‘응’이라는 답을 받은 뒤에 고쳐요. 그사이 종이냥에서 그 항목을 바꿨으면 고치지 않고 다시 보여 줘요.") },
    { title: t("알림과 되돌리기"), body: t("Claude가 넣거나 고치면 노트 아래에 ‘Claude가 할 일 2개를 넣었어요 · 되돌리기’가 떠요. 그 뒤로 여기서 아무것도 바꾸지 않았다면 Ctrl+Z로도 되돌려요. 그사이 바뀐 항목은 그대로 둬요. 책상 → AI 연결 → 최근 AI 작업에서 오늘과 어제 한 일을 하나씩 되돌릴 수도 있어요. Claude가 넣거나 고친 할 일과 일정에는 그날 동안 작은 ‘Claude’ 도장이 찍혀요."), keys: ["Ctrl+Z"] },
    { title: t("종이냥이 꺼져 있을 때"), body: t("종이냥을 꺼 둬도 Claude는 넣고 고칠 수 있어요. 다음에 종이냥을 켜면 ‘자리 비운 사이 Claude가 3가지를 했어요’로 알려 주고, ‘보기’를 누르면 무엇을 했는지 보여요.") },
    { title: t("따로 도는 프로그램은 없어요"), body: t("종이냥 for Claude는 Claude가 대화에 필요할 때만 실행되고, Claude를 끄면 같이 꺼져요. 목록은 이 PC의 파일에서 바로 읽고 써요. Claude가 읽은 내용은 대화의 일부로 Claude에게 가요.") },
  ] },
];

const params = new URLSearchParams(location.search);
let selected = params.get("topic") ?? topics[0].id;
let query = params.get("q") ?? "";

const input = h("input", { type: "search", placeholder: t("찾기 (예: 접기, 반복)"), "aria-label": t("도움말 찾기"), spellcheck: "false" });
input.value = query;
const clear = h("button", { class: "clear", title: t("찾기 지우기"), "aria-label": t("찾기 지우기") }, icon("close", 9, 2.6));
const list = h("nav", { class: "topics", "aria-label": t("주제") });
const content = h("main", { class: "content" });
scrollFade(content);
// The pane's header with the search field at the top, then the topics beside the page.
document.getElementById("app")!.append(
  h("header", { class: "pane-head" },
    h("div", { class: "ph-text" }, h("h1", {}, t("도움말")), h("p", { class: "ph-sub" }, t("궁금한 걸 찾아보세요"))),
    h("label", { class: "search" }, icon("search", 14, 2), input, clear),
    h("img", { class: "ph-cat", src: "../../assets/cat.png", alt: "", draggable: "false" })),
  h("div", { class: "help-body" }, list, content));

function openTopic(id: string): void {
  selected = id;
  query = "";
  input.value = "";
  render();
  content.scrollTop = 0;
}

/** One entry: numbered in the topic's colour on a topic page, keys drawn as keycaps. */
function card(entry: Entry, number?: number, tint?: string): HTMLElement {
  return h("section", { class: "card" },
    number !== undefined ? h("span", { class: "number", style: `background:${tint}`, "aria-hidden": "true" }, String(number)) : null,
    h("div", { class: "body" }, h("h3", {}, entry.title), h("p", {}, wrapText(entry.body)),
      ...(entry.keys?.length ? [h("div", { class: "keys" }, ...entry.keys.map((key) => h("kbd", {}, key)))] : [])));
}

function topicRow(topic: Topic): HTMLElement {
  const current = !query.trim() && topic.id === selected;
  const button = h("button", { class: "topic", "aria-current": String(current) },
    h("span", { class: "badge", style: `background:${groupColor(topic)}` }, icon(topic.icon, 12, 1.9)),
    h("span", { class: "label" }, topic.title));
  button.addEventListener("click", () => openTopic(topic.id));
  return button;
}

/** 이전 · 다음 주제, so the whole guide can be read front to back. */
function neighbours(topic: Topic): HTMLElement {
  const index = topics.indexOf(topic);
  const neighbour = (other: Topic | undefined, forward: boolean): HTMLElement => {
    if (!other) return h("span", { class: "spacer" });
    const button = h("button", { class: `neighbour${forward ? " forward" : ""}`, "aria-label": forward ? t("다음 주제: {title}", { title: other.title }) : t("이전 주제: {title}", { title: other.title }) },
      forward ? null : icon("chevronLeft", 12, 2.4),
      h("span", { class: "text" }, h("span", { class: "dir" }, forward ? t("다음") : t("이전")), h("span", { class: "title" }, other.title)),
      forward ? icon("chevronRight", 12, 2.4) : null);
    button.addEventListener("click", () => openTopic(other.id));
    return button;
  };
  return h("nav", { class: "neighbours", "aria-label": t("다른 주제") }, neighbour(topics[index - 1], false), neighbour(topics[index + 1], true));
}

function topicPage(topic: Topic): Node[] {
  const tint = groupColor(topic);
  const cards = topic.entries.map((entry, index) => card(entry, index + 1, tint));
  // The topic's own colour band: what it is about, the cat, and a jump list.
  const chips = h("div", { class: "chips", role: "list", "aria-label": t("이 주제의 내용") }, ...topic.entries.map((entry, index) => {
    const chip = h("button", { class: "chip", role: "listitem" }, entry.title);
    chip.addEventListener("click", () => cards[index].scrollIntoView({ behavior: "smooth", block: "start" }));
    return chip;
  }));
  return [
    h("header", { class: "topic-head", style: `--tint:${tint}` },
      h("div", { class: "kicker" }, h("span", { class: "badge" }, icon(topic.icon, 13, 1.9)), topic.title),
      h("h2", { class: "headline" }, topic.headline),
      chips),
    ...cards,
    neighbours(topic),
    h("p", { class: "copyright" }, COPYRIGHT),
  ];
}

function searchResults(words: string[]): Node[] {
  const hits = topics.flatMap((topic) => topic.entries
    .filter((entry) => words.every((word) => `${topic.title} ${entry.title} ${entry.body} ${(entry.keys ?? []).join(" ")}`.toLowerCase().includes(word)))
    .map((entry) => ({ topic, entry })));
  return [
    h("header", { class: "found", role: "status" },
      h("div", {}, h("div", { class: "query" }, `‘${query.trim()}’`),
        h("div", { class: "count" }, hits.length ? t("찾은 내용 {n}개", { n: hits.length }) : t("맞는 내용이 없어요. 다른 말로 찾아볼까요?")))),
    ...hits.map(({ topic, entry }) => {
      const pill = h("button", { class: "hit-topic", style: `background:${groupColor(topic)}`, title: t("이 주제로 가기") }, icon(topic.icon, 11, 2), topic.title);
      pill.addEventListener("click", () => openTopic(topic.id));
      return h("div", { class: "hit" }, pill, card(entry));
    }),
  ];
}

function render(): void {
  list.replaceChildren(...groups.map((group) => h("div", { class: "group" },
    h("div", { class: "group-title" }, group.title),
    ...topics.filter((topic) => group.topics.includes(topic.id)).map(topicRow))));
  clear.hidden = !query;
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  content.replaceChildren(...(words.length === 0 ? topicPage(topics.find((entry) => entry.id === selected) ?? topics[0]) : searchResults(words)));
  fadeTopics();
}

/** The topic list fades at the bottom while more of it is below (a short window). */
function fadeTopics(): void {
  list.classList.toggle("scrolls", list.scrollHeight - list.scrollTop - list.clientHeight > 2);
}
list.addEventListener("scroll", fadeTopics);
window.addEventListener("resize", fadeTopics);

input.addEventListener("input", () => { query = input.value; render(); content.scrollTop = 0; });
clear.addEventListener("click", (event) => { event.preventDefault(); input.value = ""; query = ""; render(); input.focus(); });
// The desk opened on a topic or a search (snapshots, links from other panes).
paper().on("desk:pane", (payload) => {
  const { pane, topic, query: asked } = (payload ?? {}) as { pane?: unknown; topic?: unknown; query?: unknown };
  if (pane !== "help") return;
  if (typeof asked === "string" && asked) { input.value = asked; query = asked; render(); content.scrollTop = 0; }
  else if (typeof topic === "string" && topics.some((entry) => entry.id === topic)) openTopic(topic);
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && input.value) { input.value = ""; query = ""; render(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); input.focus(); }
});
render();
