import assert from "node:assert/strict";
import { test } from "node:test";
import { chatterCatalogueSize, isQuietHour, nextChatterDelay, pettedChatter, pickChatter, type ChatterContext } from "../src/core/chatter";

const numbers = (values: number[]) => () => values.shift() ?? 0;
const context = (hour: number, open: number, done: number, extra: Partial<ChatterContext> = {}): ChatterContext => ({ hour, open, done, overdue: 0, dueSoon: 0, weekday: 2, ...extra });

test("종이냥 한마디 picks lines for the moment (same cases as macOS)", () => {
  const start = context(10, 3, 0, { firstOpen: "보고서 쓰기" });
  let line = pickChatter(start, false, [], numbers([0, 0]));
  assert.equal(line.id, "p.start.0");
  assert.equal(line.text, "‘보고서 쓰기’부터 시작해 볼까요?");
  assert.equal(pickChatter(start, false, [], numbers([0.6, 0.5])).id, "t.morning.3");
  line = pickChatter(context(12, 2, 2, { firstOpen: "장보기" }), true, [], numbers([0.99, 0.35]));
  assert.equal(line.id, "q.first");
  assert.equal(line.text, "‘장보기’ 지금 해 볼까요?");
  assert.deepEqual(line.answers.map((answer) => answer.label), ["해 볼게요", "나중에"]);
  assert.equal(pickChatter(context(15, 0, 4), false, ["p.all.0"], numbers([0, 0])).id, "p.all.1");
  line = pickChatter(context(9, 1, 1, { overdue: 2 }), false, [], numbers([0.4, 0]));
  assert.equal(line.id, "d.over.0");
  assert.equal(line.text, "지난 마감이 2개 있어요. 하나만 정리해 볼까요?");
  assert.equal(pickChatter(context(10, 1, 0, { firstOpen: "아주아주긴할일제목입니다요" }), false, [], numbers([0, 0])).text, "‘아주아주긴할일제목입니다…’부터 시작해 볼까요?");
  assert.equal(pickChatter(context(10, 1, 0, { firstOpen: "오늘 꼭 해야 할 일 정리하기" }), false, [], numbers([0, 0])).text, "‘오늘 꼭 해야 할 일…’부터 시작해 볼까요?");
  line = pickChatter(context(14, 3, 2), true, [], numbers([0.99, 0.35]));
  assert.equal(line.id, "q.rest");
  assert.equal(line.answers[0].action, "rest5");
  // The day of the week: a Friday line, and on Friday the weekend question.
  assert.equal(pickChatter(context(10, 3, 1, { weekday: 5 }), false, [], numbers([0.74, 0.5])).id, "w.fri.1");
  assert.equal(pickChatter(context(16, 3, 1, { weekday: 5 }), true, [], numbers([0.99, 0.99])).id, "q.weekend");
  assert.ok(isQuietHour(23) && isQuietHour(6) && !isQuietHour(7) && !isQuietHour(22));
  assert.equal(nextChatterDelay("normal", () => 0.5), 2_700_000);
  assert.equal(pettedChatter(() => 0.15).text, "골골골…");
  assert.equal(pettedChatter(() => 0.75).text, "냐앙~");
  assert.equal(chatterCatalogueSize(), 134);
});

test("the bubble slides inward near a screen edge and its pointer still finds the cat (same cases as macOS)", async () => {
  const { bubbleShift, bubblePointer } = await import("../src/core/pet");
  assert.equal(bubbleShift(150, 200, 300), 0); // room on both sides
  assert.equal(bubbleShift(232, 212, 300), -44); // near the right edge: slides left
  assert.equal(bubblePointer(-44, 212), 44); // pointer back toward the cat
  assert.equal(bubbleShift(70, 230, 300), 51); // near the left edge: slides right
  assert.equal(bubblePointer(51, 230), -51);
  assert.equal(bubblePointer(-120, 100), 32); // never into the rounded corner
  assert.equal(bubbleShift(150, 0, 300), 0); // not measured yet
});

test("bubble lines break between sentences, after commas, never inside quotes (same cases as macOS)", async () => {
  const { wrapBubble } = await import("../src/core/bubbleText");
  assert.equal(wrapBubble("첫 번째 체크가 제일 어려워요. 할 수 있어요!"), "첫 번째 체크가 제일 어려워요.\n할 수 있어요!");
  assert.equal(wrapBubble("벌써 3개 했어요! 좋아요."), "벌써 3개 했어요! 좋아요.");
  assert.equal(wrapBubble("모니터에서 눈 떼고 먼 곳 한 번 보기!"), "모니터에서 눈 떼고\n먼 곳 한 번 보기!");
  assert.equal(wrapBubble("‘오늘 꼭 해야 할 일…’부터 시작해 볼까요?"), "‘오늘 꼭 해야 할 일…’부터\n시작해 볼까요?");
  assert.equal(wrapBubble("‘보고서 쓰기’, 생각보다 금방 끝날지도 몰라요."), "‘보고서 쓰기’,\n생각보다 금방 끝날지도 몰라요.");
  assert.equal(wrapBubble("할 일이 없으면\n쉬는 것도 일이에요."), "할 일이 없으면\n쉬는 것도 일이에요.");
  assert.equal(wrapBubble("냥."), "냥.");
});

test("timer sizes match the Mac's and grow around the bottom middle", async () => {
  const { timerScale, timerSizes, timerSizeTitle, timerWindowSizeFor, resizedTimerOrigin } = await import("../src/core/timerWidget");
  assert.deepEqual(timerSizes.map((size) => [timerSizeTitle[size], timerScale[size]]), [["작게", 0.8], ["보통", 1], ["크게", 1.25], ["아주 크게", 1.5]]);
  assert.deepEqual(timerWindowSizeFor("extraLarge"), { width: 375, height: 375 });
  // 250 → 375: the bottom edge stays put and the middle stays over the same spot.
  assert.deepEqual(resizedTimerOrigin({ x: 1000, y: 600 }, { width: 250, height: 250 }, { width: 375, height: 375 }), { x: 938, y: 475 });
});

test("종이냥 한마디 talks about today's events (same cases as macOS)", () => {
  const soon = context(14, 2, 1, { firstOpen: "보고서", weekday: 3, nextEvent: "팀 회의", nextIn: 12, eventsLeft: 2 });
  const line = pickChatter(soon, false, [], () => 0.4);
  assert.ok(line.id.startsWith("e.soon") && line.text.includes("팀 회의"), line.id);
  let asked = pickChatter(soon, true, [], () => 0.99);
  assert.equal(asked.id, "q.ready");
  assert.equal(asked.text, "곧 ‘팀 회의’ 시간이에요. 준비됐어요?");
  const roomy = context(14, 2, 1, { weekday: 3, nextEvent: "팀 회의", nextIn: 50, eventsLeft: 1 });
  asked = pickChatter(roomy, true, ["q.mood", "q.water", "q.stretch", "q.first", "q.rest", "q.eyes", "q.walk", "q.music", "q.pet", "q.snack"], () => 0.99);
  assert.equal(asked.id, "q.focus");
  assert.equal(asked.answers[0].action, "focus25");
  assert.ok(asked.text.startsWith("다음 일정까지 50분"));
});
