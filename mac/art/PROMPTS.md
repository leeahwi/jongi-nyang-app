# 이미지 생성 도구에 부탁할 그림 모음

> 종이냥 그림은 이미지 생성 모델로 만들고, 사람이 고르고 다듬었어요. 이 파일은 그때 쓴 요청 모음이에요(일부 항목은 만들지 않았어요).

한 파일에 모았습니다. 모든 요청에 **`art/pet/reference-sitting.png`를 첨부**하고, 아래 **공통 스타일**을 먼저 붙인 뒤 각 항목의 프롬프트를 이어 붙이세요. 결과는 **배경이 투명한 PNG**로 받아 표의 **폴더·파일 이름 그대로** 넣으면 됩니다. 다 넣으면 알려 주세요 — 크기·기준선을 맞춰 Mac·Windows 앱에 넣겠습니다.

## 공통 스타일

```text
Use the attached image as the exact character reference: a small cream-colored "paper cat"
mascot drawn like a hand-cut paper sticker — soft warm cream paper texture, thick uneven
dark-brown crayon outline, big round dark eyes with two tiny white sparkles, pink blush
cheeks with little hatch lines, a ":3" mouth, pink inner ears, the tip of its right ear
folded over like a dog-eared paper corner, and a sage-green knotted neckerchief.
Keep the same proportions, line weight, colors and paper texture. Flat illustration,
no background, no ground shadow, no text. 1024x1024 PNG with a fully transparent background.
```

## 1. 펫 포즈 — `art/pet/` (앞선 목록 그대로)

`art/pet/PROMPTS.md`의 표를 그대로 쓰면 됩니다: `blink` `happy` `sleep` `yawn` `stretch` `cheer` `curious` `groom` `tea` `walk-1`~`walk-4`. 포즈는 **참고 그림과 크기·바닥선(앞발이 높이 약 93%)이 같아야** 자연스럽게 바뀝니다.

## 2. 새 기능용 그림 — `art/pet/`, `art/scenes/`

| 우선 | 파일 | 쓰는 곳 | 프롬프트(공통 스타일 뒤에 붙이기) |
|---|---|---|---|
| ★ | `art/pet/write.png` | 메모 화면 머리의 종이냥 | `Same sitting pose and scale as the reference, holding a short yellow paper pencil in its right front paw and "writing" on a tiny cream paper card held in the left paw. Eyes looking down at the card, focused and happy.` |
| ★ | `art/pet/hurry.png` | 마감이 오늘·지난 할 일이 있을 때 펫 | `Same sitting pose and scale, holding a small sage-green paper flag on a stick in one raised paw, eyebrows slightly worried, a single small sweat drop, mouth a small "o". Friendly, not scary.` |
| ☆ | `art/scenes/empty-memo.png` | 메모가 하나도 없을 때 | `The cat curled up napping on top of a blank cream paper sheet (the sheet is slightly tilted, with a folded corner), a tiny "z" feeling but no letters. Wide composition, 1536x1024, transparent background.` |
| ☆ | `art/scenes/all-done.png` | 오늘 할 일을 다 끝냈을 때 | `The cat stretching happily on top of a cream paper checklist whose three boxes are all ticked in sage green, eyes "^ ^". Wide composition, 1536x1024, transparent background.` |
| ☆ | `art/scenes/history.png` | 완료 기록(잔디) 창 머리 | `The cat sitting next to a small cream paper calendar page with a few squares filled in sage green, pointing at it proudly with one paw.` |

## 3. 고치면 좋은 그림 — 아이콘 `art/icons/`

지금은 종이냥 그림을 그대로 줄여서 아이콘으로 쓰고 있어, 작은 크기에서 뭉개지고 메뉴바에서는 색이 튑니다.

| 우선 | 파일 | 쓰는 곳 | 프롬프트 |
|---|---|---|---|
| ★ | `art/icons/menubar.png` | Mac 메뉴바 | `A minimal single-color silhouette icon of the reference cat's head (two ears, the right ear tip folded), solid black on transparent, no details inside except two small round eye holes. Designed to read at 18x18 pixels. 512x512 PNG, transparent background.` (공통 스타일은 붙이지 않음) |
| ★ | `art/icons/app-icon-mac.png` | Mac 앱 아이콘 | `A macOS app icon: a rounded-square (squircle) tile of warm off-white paper with faint ruled lines and a thin terracotta margin line, the reference paper cat peeking over the bottom edge of the tile holding it with both front paws. Soft realistic drop shadow under the tile, subtle paper grain, no text. 1024x1024 PNG, transparent outside the squircle.` |
| ☆ | `art/icons/app-icon-win.png` | Windows 앱 아이콘 | `Same concept as a Windows app icon: a slightly rotated square sheet of off-white ruled paper (small rounded corners, no squircle), the paper cat peeking over the bottom edge. Bold simple shapes that stay readable at 32x32. 1024x1024 PNG, transparent background.` |
| ☆ | `art/icons/tray.png` | Windows 알림 영역 | `Just the reference cat's face, front view, simplified: thick outline, two eyes, ":3" mouth, blush, folded right ear tip. Readable at 16x16 and 32x32. 256x256 PNG, transparent background.` |

★ = 먼저 있으면 좋은 것, ☆ = 있으면 더 좋은 것.
