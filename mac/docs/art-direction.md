# 한 장: 디자인과 생성 이미지

> 개발하면서 남긴 작업 기록이에요(공개 저장소에서는 날짜와 당시 스냅숏 이미지를 뺐어요). 지금의 설계와 과정은 [`docs/`](../../docs)에 정리돼 있어요.

## 1.4 UX 대안

알림의 중심을 인사말에서 실제 할 일로 옮겼습니다. 예약 알림은 정확한 예정 시각, 주기 알림은 남은 개수와 주기 문맥을 보여줍니다. 완료는 첫 번째 동작, 미루기는 5/10/30분, 노트 보기는 보조 동작입니다.

- 간결형: 작은 가로 알림. 다른 작업을 가리는 면적을 줄입니다.
- 종이형: 짧은 글은 작은 카드, 긴 글은 필요한 높이로. 종이 앱의 기본 권장입니다.
- 캐릭터형: 큰 캐릭터와 말풍선. 정보와 버튼의 우선순위는 같습니다.

미리보기에는 미리보기 표시를 넣고 목록에 영향을 주지 않도록 했습니다. 설정은 큰 별도 창에서 줄에 붙는 작은 팝오버로 교체했으며, 빠른 선택과 사용자 지정 날짜/시간을 서로 다른 화면으로 분리했습니다. 예정/보냄/중지 상태는 목록에서도 항상 읽을 수 있습니다.

## 1.3 시안과 조작 개선

- 손글씨 펜/붓/기본 글씨 세 가지를 선택하고 저장합니다. 글꼴은 노트·개별 알림 설정·알림 카드의 할 일에 적용합니다.
- 줄에 마우스를 올리면 행 배경과 작은 알림/이동/삭제 도구가 더 선명하게 드러납니다.
- 최소화 포스트잇은 앞발이 종이 앞에 걸치며, 현재 화면 상단 중앙에 놓입니다. 드래그는 현재 접힌 상태의 위치를 조절하고, 다음 최소화는 다시 상단 중앙입니다.
- 주기/개별 알림은 종이 메모 카드와 오른쪽 캐릭터 스티커로 새로 구성했습니다. 두 줄 제목에도 카드와 그림자가 잘리지 않도록 충분한 높이를 줬습니다.
- 개별 시간 설정창은 작은 날짜 구역과 세이지 빠른 선택/저장 버튼으로 정리했습니다.
- 손 흔들기는 세 번 인사하고 쉬며, 숨기면 중단됩니다. 동작 줄이기 설정에서는 움직이지 않습니다.

## 선택형 캐릭터와 떠 있는 아이콘

곰과 고양이를 모두 유지하며 `… → 캐릭터`에서 바꿀 수 있습니다. 선택한 그림은 노트·메뉴바·실행 중 Dock·떠 있는 아이콘에 같이 적용됩니다. Finder 앱 파일의 기본 아이콘은 곰입니다.

노트의 최소화 버튼/`⌘ M`은 110 × 130 pt의 작은 포스트잇으로 접습니다. 캐릭터가 살짝 기울어진 버터색 정사각 포스트잇 뒤에서 오른쪽 위로 빼꼼 나옵니다. 얇은 메모 줄, 작은 접힌 모서리와 부드러운 그림자를 더했습니다. 클릭은 노트 복원, 드래그는 위치 이동입니다. 기존 캐릭터 이미지를 네이티브 종이 UI 뒤에 배치하므로 곰/고양이 교체도 유지됩니다.

최종 곰 파일: `Sources/PaperTodo/Assets/PaperBear.png`. 내장 `image_gen` 사용. 실제 알파 채널을 검사했습니다. 편집 시도에서 나온 불투명 배경 결과는 사용하지 않고, 같은 소재와 색감으로 생성한 투명 곰을 사용했습니다.

### PaperBear — 최종 생성 프롬프트

Generate a transparent-background PNG asset. Use case: stylized-concept. A single extremely cute chibi TEDDY BEAR mascot for a cozy paper to-do app. Full seated bear body front view, oversized round head, small ROUND ears, rounded teddy muzzle and tiny cocoa nose, sparkling dark eyes, gentle smile and peach blush cheeks. Ivory / warm biscuit colored body with handmade paper grain and colored-pencil texture, medium-bold dark-brown hand-drawn outlines, short plump paws, a small sage green scarf. A small folded paper corner on the forehead hints that this bear is made of stationery paper. Adorable anime-inspired Japanese stationery sticker aesthetic. Clean silhouette that works at small size. The complete bear alone occupies about 85% of a square image. Transparent alpha channel outside the character. No lettering, no wordmark, no background, no app icon tile, no drop shadow. This is an isolated cutout asset, not a photograph of a sticker. No cats or whiskers or pointed ears.

## 두 번째 디자인
사용자 피드백: 첫 배경은 종이 질감이 약함. 화면/Dock 또는 메뉴바에 귀여운 애니풍 아이콘 희망.

- 종이냥: 접힌 종이 모서리가 있는 작은 고양이. 앱/Dock 아이콘, 메뉴바 아이콘, 노트 위의 작은 스티커에 같은 그림 사용.
- 소재: 단색 디지털 노이즈를 없애고 섬유와 종이 결이 실제로 보이는 밝은 아이보리 종이 이미지 사용.
- 완료 표시: 연필로 그린 듯 살짝 기울어진 네모와 차분한 세이지 체크.
- 여백: 날짜 → 제목/캐릭터 → 줄 노트의 순서. 버튼과 숫자를 늘리지 않음.
- 완료 피드백: 캐릭터가 작게 고개를 기울임. macOS ‘동작 줄이기’ 설정에서는 생략.

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
