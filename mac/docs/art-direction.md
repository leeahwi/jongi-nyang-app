# 한 장: 디자인과 생성 이미지

> 앱 이름이 ‘한 장’이던 1.3–1.4 무렵의 작업 기록이에요(공개 저장소에서는 날짜와 당시 스냅숏 이미지를 뺐어요). 곰은 1.7.2에서 뺐고([종이냥 단일 캐릭터](cat-only.md)), 지금의 디자인은 [디자인 과정](../../docs/design-process.md)에 있어요.

## 1.4 UX 대안

알림의 중심을 인사말에서 실제 할 일로 옮겼어요. 예약 알림은 정확한 예정 시각을, 주기 알림은 남은 개수와 주기를 보여 줘요. 완료가 첫 번째 동작이고, 미루기는 5/10/30분, 노트 보기는 보조 동작이에요.

- 간결형: 작은 가로 알림이에요. 다른 일을 가리는 면적을 줄여요.
- 종이형: 짧은 글은 작은 카드, 긴 글은 필요한 높이로 보여요. 종이 앱에 기본으로 권하는 모양이에요.
- 캐릭터형: 큰 캐릭터와 말풍선이에요. 정보와 버튼의 우선순위는 같아요.

미리보기에는 미리보기 표시를 넣고, 목록에는 영향을 주지 않게 했어요. 설정은 큰 별도 창 대신 줄에 붙는 작은 팝오버로 바꿨고, 빠른 선택과 직접 정하는 날짜 · 시간을 다른 화면으로 나눴어요. 예정 · 보냄 · 중지 상태는 목록에서도 늘 읽을 수 있어요.

## 1.3 시안과 조작 개선

- 손글씨 펜 · 붓 · 기본 글씨 세 가지 중에서 골라 저장해요. 글꼴은 노트, 개별 알림 설정, 알림 카드의 할 일에 써요.
- 줄에 마우스를 올리면 줄 배경과 작은 알림 · 이동 · 삭제 도구가 더 또렷하게 보여요.
- 접은 포스트잇은 앞발이 종이 앞에 걸치고, 지금 화면의 위쪽 가운데에 놓여요. 끌면 지금 접힌 자리만 바뀌고, 다음에 접을 때는 다시 위쪽 가운데예요.
- 주기 · 개별 알림은 종이 메모 카드와 오른쪽 캐릭터 스티커로 새로 짰어요. 제목이 두 줄이어도 카드와 그림자가 잘리지 않게 높이를 넉넉히 줬어요.
- 개별 시간 설정 창은 작은 날짜 구역과 세이지색 빠른 선택 · 저장 버튼으로 정리했어요.
- 손 흔들기는 세 번 인사하고 쉬고, 숨기면 멈춰요. 동작 줄이기를 켜면 움직이지 않아요.

## 선택형 캐릭터와 떠 있는 아이콘

(그때는) 곰과 고양이를 모두 두고, `… → 캐릭터`에서 바꿀 수 있었어요. 고른 그림은 노트, 메뉴 막대, 실행 중인 Dock, 떠 있는 아이콘에 같이 쓰였어요. Finder 앱 파일의 기본 아이콘은 곰이었어요.

노트의 최소화 버튼이나 `⌘ M`을 누르면 110 × 130 pt의 작은 포스트잇으로 접혀요. 캐릭터가 살짝 기울어진 버터색 정사각 포스트잇 뒤에서 오른쪽 위로 빼꼼 나와요. 얇은 메모 줄, 작게 접힌 모서리와 부드러운 그림자를 더했어요. 누르면 노트가 돌아오고, 끌면 자리를 옮겨요. 원래 캐릭터 그림을 네이티브 종이 화면 뒤에 놓아서, 곰 · 고양이를 바꿔도 그대로 보였어요.

마지막 곰 파일: `Sources/PaperTodo/Assets/PaperBear.png`(1.7.2에서 지웠어요). 내장 `image_gen`으로 만들고, 실제 알파 채널을 검사했어요. 편집하다 나온 불투명 배경 그림은 쓰지 않고, 같은 소재와 색감으로 만든 투명 곰을 썼어요.

### PaperBear — 최종 생성 프롬프트

Generate a transparent-background PNG asset. Use case: stylized-concept. A single extremely cute chibi TEDDY BEAR mascot for a cozy paper to-do app. Full seated bear body front view, oversized round head, small ROUND ears, rounded teddy muzzle and tiny cocoa nose, sparkling dark eyes, gentle smile and peach blush cheeks. Ivory / warm biscuit colored body with handmade paper grain and colored-pencil texture, medium-bold dark-brown hand-drawn outlines, short plump paws, a small sage green scarf. A small folded paper corner on the forehead hints that this bear is made of stationery paper. Adorable anime-inspired Japanese stationery sticker aesthetic. Clean silhouette that works at small size. The complete bear alone occupies about 85% of a square image. Transparent alpha channel outside the character. No lettering, no wordmark, no background, no app icon tile, no drop shadow. This is an isolated cutout asset, not a photograph of a sticker. No cats or whiskers or pointed ears.

## 두 번째 디자인
사용자 의견: 첫 배경은 종이 질감이 약했어요. 화면 · Dock이나 메뉴 막대에 귀여운 애니풍 아이콘이 있으면 좋겠다고 했어요.

- 종이냥: 접힌 종이 모서리가 있는 작은 고양이예요. 앱 · Dock 아이콘, 메뉴 막대 아이콘, 노트 위의 작은 스티커에 같은 그림을 써요.
- 소재: 단색 디지털 노이즈를 없애고, 섬유와 종이 결이 실제로 보이는 밝은 아이보리 종이 그림을 써요.
- 완료 표시: 연필로 그린 듯 살짝 기울어진 네모와 차분한 세이지색 체크예요.
- 여백: 날짜 → 제목 · 캐릭터 → 줄 노트 순서예요. 버튼과 숫자는 늘리지 않아요.
- 완료했을 때: 캐릭터가 작게 고개를 기울여요. macOS ‘동작 줄이기’를 켜면 건너뛰어요.

## Assets
Built-in `image_gen` tool was used; no API key or CLI fallback.

- `Sources/PaperTodo/Assets/PaperCat.png`: transparent anime stationery mascot.
- `Sources/PaperTodo/Assets/PaperTexture.png`: generated scanned-paper material, not an actual scan or photograph.

## Generation prompts

### PaperCat
Use case: stylized-concept. Asset type: a single production-ready transparent PNG mascot icon for a cozy native macOS paper to-do app named 한 장 (do NOT draw any lettering). Primary request: a very cute original anime chibi PAPER KITTEN mascot, a tiny ivory paper note brought to life as a cat, with a softly folded top-right paper corner, two small triangular ears, dark charcoal dot eyes with tiny sparkles, a tiny smiling mouth, soft muted peach blush cheeks, little rounded paws. Front-facing simple squat silhouette, boldly readable at 18 px in a macOS menu bar, appealing at 256 px as a Dock icon. Hand-drawn Japanese stationery sticker aesthetic, warm graphite outlines of medium-bold consistent thickness, subtle colored-pencil texture, ivory/cream body, tiny muted sage collar or scarf as the only small accent. Entire character centered, fills 85 percent of square canvas. Genuinely transparent alpha background. No scene, no backdrop, no cast shadow outside the character, no typography, no wordmark, no enclosing app-icon tile, no gradients, no realistic fur, no extra objects. One character only. Clean silhouette suitable for small app icons, polished illustration.

### PaperTexture
Use case: photorealistic-natural. Asset type: full-bleed background material texture for a 420 by 560 pixel native Mac stationery to-do app. Primary request: an authentic scanned sheet of premium warm ivory Japanese writing paper, medium-fine subtly visible random cellulose fibers and irregular soft pulp grain throughout, delicate tooth, a few tiny natural flecks, softly tactile, not aged. Edge-to-edge material macro scan seen straight from overhead, flat even diffuse illumination, extremely slight organic tonal mottling. Base shade very light warm white #F5F1E7, fine grain visible at normal view but calm and low contrast for dark text overlay. Portrait 3:4 composition. NO paper edge, NO objects, NO writing, NO notebook rules, NO creases or wrinkles, NO vignette, NO border, NO dramatic shadow, NO colored stains, NO fabric weave, NO repeating geometric pattern, NO canvas texture. This should look like actual subtly textured good stationery paper rather than digital noise, old parchment, cloth, or a plain solid color. Entire image is only the usable paper material, uniform and seamless-feeling.

## 비교 이미지

- 간결형: `v1.4-reminder.compact.png`
- 종이형: `v1.4-reminder.paper.png`
- 캐릭터형: `v1.4-reminder.character.png`
- 빠른 설정: `v1.4-editor.quick.png`
- 달력/시간: `v1.4-editor.custom.png`
- 목록 시각: `v1.4-time-labels.png`
