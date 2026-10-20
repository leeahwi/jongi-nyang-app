# 종이냥 펫 포즈 이미지 — 생성 프롬프트

> 공개 저장소에는 참고 그림(`reference-sitting.png`)과 프롬프트 · 검사 기록만 남겼어요. 다듬은 최종 포즈는 앱 리소스 `Sources/PaperTodo/Assets/Pet/`(Windows는 `windows/assets/pet/`)에 있고, 생성 원본과 이전 걷기 시안은 빼서 저장소를 가볍게 했어요.

데스크톱 펫(화면 아래에서 돌아다니는 종이냥)에 쓸 포즈 이미지입니다. 이미지가 없어도 Mac 앱은 기존 그림을 기울이고 늘리는 방식으로 움직입니다. **이 폴더는 제작 원본 보관용이며, Mac 앱은 `Sources/PaperTodo/Assets/Pet/`에 포함된 파일을 읽습니다.**

완성된 13개 포즈는 앱 리소스(`Sources/PaperTodo/Assets/Pet/`)에 있습니다. 생성 도구는 내장 `image_gen`이며, 실제 프롬프트는 [generation.json](generation.json), 생성 원본은 `generated/`에 보관합니다.

걷기는 이후 **완성 이미지 8장(`walk-cycle-01.png` ~ `walk-cycle-08.png`)**으로 교체했습니다. 사용자가 지정한 기존 큰 머리·작은 몸통 디자인(`walk-previous/walk-4.png`)을 기준으로 다리 위치만 바꿉니다. 다리 부품을 분리해 움직이지 않습니다. 프롬프트와 순서는 [walk-generation.json](walk-generation.json), 생성 원본은 `walk-frames-v2/`에 있습니다. `walk-1.png` ~ `walk-4.png`는 새 시퀀스의 1·3·5·7번 프레임을 사용하는 호환용 이미지입니다.

## 만드는 방법

1. 이미지 생성 도구에 **`reference-sitting.png`(이 폴더)를 함께 첨부**하고, 아래 **공통 스타일** 문단 + 각 포즈 문단을 붙여 한 장씩 요청합니다.
2. 결과는 **배경이 투명한 PNG, 1024 × 1024**로 받아서 표의 **파일 이름 그대로** 이 폴더(`art/pet/`)에 넣습니다.
3. Mac 프로젝트 루트에서 아래 명령으로 규격과 기준선을 맞춘 뒤 앱 리소스에 복사합니다. `prepare-pet-art.swift`는 투명도를 유지하고, 일반 포즈의 바닥선을 y=952, `cheer`를 y=870으로 맞춥니다. 새 포즈를 교체할 때는 `generated/`의 해당 파일을 바꾼 뒤 다시 실행하세요.

```sh
swift scripts/prepare-pet-art.swift art/pet/generated art/pet
swift scripts/prepare-pet-art.swift art/pet/walk-frames-v2 art/pet
mkdir -p Sources/PaperTodo/Assets/Pet ../windows/assets/pet
for pose in blink happy sleep yawn stretch cheer curious groom tea walk-1 walk-2 walk-3 walk-4; do
  cp "art/pet/$pose.png" Sources/PaperTodo/Assets/Pet/
  cp "art/pet/$pose.png" ../windows/assets/pet/
done
for frame in art/pet/walk-cycle-*.png; do
  cp "$frame" Sources/PaperTodo/Assets/Pet/
  cp "$frame" ../windows/assets/pet/
done
```

Mac 리소스 변경은 다음 앱 빌드에 반영됩니다. Windows의 `assets/pet/` 파일도 배포 패키지에 포함되지만, 현재 포즈를 선택해 표시하는 코드는 별도 연결이 필요합니다.

잘 나온 그림을 고르는 기준: 참고 그림과 **같은 고양이로 보이는지**(얼굴 모양, 접힌 오른쪽 귀 끝, 초록 스카프, 연한 크림색 종이 질감, 갈색 크레용 윤곽선), 그리고 **크기와 바닥선이 참고 그림과 같은지**(앞발이 그림 아래쪽 약 93% 높이에 닿음). 어긋나면 "Match the size and the paw baseline of the reference exactly" 를 덧붙여 다시 요청하세요.

## 공통 스타일 (모든 요청 앞에 붙이기)

```text
Use the attached image as the exact character reference: a small cream-colored "paper cat"
mascot drawn like a hand-cut paper sticker — soft warm cream paper texture, thick uneven
dark-brown crayon outline, big round dark eyes with two tiny white sparkles, pink blush
cheeks with little hatch lines, a ":3" mouth, pink inner ears, the tip of its right ear
folded over like a dog-eared paper corner, and a sage-green knotted neckerchief.
Keep the same proportions, line weight, colors and paper texture. Do not add new clothing
or props unless asked. Flat illustration, no background, no ground shadow, no text.
Output: a single character, centered, 1024x1024 PNG with a fully transparent background.
Match the scale of the reference: the character occupies the same area, and its lowest
point (paws or body) touches the same baseline at about 93% of the image height.
```

## 포즈 목록

| 우선 | 파일 이름 | 쓰는 곳 | 포즈 설명(프롬프트에 이어 붙이기) |
|---|---|---|---|
| ★ | `blink.png` | 눈 깜빡임 | `Same sitting pose and framing as the reference, but with both eyes gently closed as soft downward curved lines. Everything else identical.` |
| ★ | `happy.png` | 쓰다듬기·완료 축하 | `Same sitting pose, eyes closed in a happy "^ ^" smile, slightly bigger blush, mouth a little open in a smile, ears perked up.` |
| ★ | `sleep.png` | 졸기 | `Curled up asleep in a loaf / croissant pose facing the viewer, head resting on its front paws, eyes closed, tail wrapped around the body, neckerchief visible. Lower and wider than the sitting pose, resting on the same baseline.` |
| ★ | `yawn.png` | 졸기 직전 | `Same sitting pose, a big sleepy yawn: mouth wide open (small pink tongue), eyes squeezed shut, ears slightly back.` |
| ★ | `stretch.png` | 기지개 | `A big front stretch facing the viewer: front legs stretched forward and down on the ground, chest low, rear end up, tail up, eyes closed contentedly. Front paws on the baseline.` |
| ★ | `cheer.png` | 뽀모도로 끝·할 일 완료 | `Mid-jump celebration: both front paws raised high above its head, back paws off the ground, eyes happy "^ ^", mouth open in a cheer. The body is lifted about 8% above the baseline.` |
| ☆ | `curious.png` | 갸웃 | `Same sitting pose, head tilted about 15 degrees to its left, one ear lowered, eyes wide and curious, a tiny question-mark feeling (but do NOT draw a question mark).` |
| ☆ | `groom.png` | 그루밍 | `Sitting and licking its raised right front paw, eyes closed, small pink tongue visible.` |
| ☆ | `tea.png` | 뽀모도로 휴식 | `Sitting relaxed, holding a tiny cream-colored paper teacup with both front paws in front of its chest, a small curl of steam, eyes half closed and calm.` |
| ☆ | `walk-1.png` ~ `walk-4.png` | 걷기(4장) | `Side view facing LEFT, walking on all fours. Draw frame N of a 4-frame walk cycle (1: left front paw forward, 2: paws passing, 3: right front paw forward, 4: paws passing). Keep the head, size, neckerchief and baseline identical across frames so they can be played in a loop.` (N만 바꿔 4번 요청) |

★ = 먼저 있으면 좋은 것, ☆ = 있으면 더 좋은 것. 걷기는 왼쪽을 보는 그림만 있으면 오른쪽은 앱에서 뒤집어 씁니다.

## 앱에서 직접 그리는 것 (이미지 필요 없음)

하트·반짝이·Zzz·말풍선, 타이머 팻말(종이 팻말 + 빨간 원이 줄어드는 타이머 + 남은 시간)과 그 위에 얹는 앞발, 걸음마다 통통 튀는 움직임, 그림자.
