# 보안 정책

종이냥의 보안 문제는 공개 이슈가 아니라 GitHub의 비공개 취약점 보고로 알려 주세요. 고치기 전에 문제가 널리 알려지면 앱을 쓰는 사람이 위험해질 수 있습니다.

## 알리는 법

1. 이 저장소의 [Security 탭](https://github.com/leeahwi/jongi-nyang-app/security)에서 **Report a vulnerability**를 누릅니다.
2. 앱(Mac · Windows · Claude 확장), 앱 버전, OS 버전, 다시 일어나게 하는 방법을 적습니다.
3. 메모 · 할 일의 실제 내용, 이름, 메일 주소, 폴더 경로는 적지 않습니다. 예시는 지어낸 것으로 충분합니다.

혼자 만드는 앱이라 답이 며칠 걸릴 수 있습니다. 확인한 문제는 고친 버전을 내고 릴리스 노트에 적습니다. 알린 분이 원하면 이름을 함께 적습니다.

## 지원하는 버전

가장 최근에 공개한 Mac 버전과 Windows 버전만 고칩니다. 옛 버전에서 찾은 문제도 최신 버전에서 다시 일어나면 알려 주세요.

## 보안 문제로 보는 것

- 종이냥이 사용자가 고르지 않은 곳에 파일을 쓰거나, 저장 폴더 밖의 파일을 읽는 경우
- 앱이나 Claude 확장이 사용자가 켜지 않았는데 기기 밖으로 데이터를 보내는 경우
- 백업 파일(.jongi)이나 공유 폴더의 파일을 열었을 때 앱이 다른 명령을 실행하거나 다른 파일을 덮어쓰는 경우
- 꺼 둔 AI 연결로 Claude가 할 일 · 일정 · 메모를 읽거나 고칠 수 있는 경우

아직 코드 서명과 공증이 없어서 처음 열 때 macOS와 Windows가 경고하는 것은 알려진 한계입니다. 받은 파일이 공개한 파일과 같은지는 릴리스의 `SHA256SUMS`로 확인할 수 있습니다.

---

# Security policy

Please report security problems in Jongi-nyang through GitHub's private vulnerability reporting, not in a public issue.

## How to report

1. On this repository's [Security tab](https://github.com/leeahwi/jongi-nyang-app/security), click **Report a vulnerability**.
2. Include the app (Mac, Windows or the Claude extension), the app version, your system version and the steps that make it happen.
3. Leave out the real text of your notes and to-dos, names, email addresses and folder paths. Made-up examples are enough.

Jongi-nyang is made by one person, so a reply may take a few days. Confirmed problems are fixed in a new release and listed in its release notes, with your name if you'd like.

## Supported versions

Only the latest public Mac and Windows releases get fixes. If you found a problem in an older version, please check that it still happens in the latest one.

## What counts

- The app writes files somewhere you didn't choose, or reads files outside its storage folder.
- The app or the Claude extension sends data off your computer without you turning it on.
- Opening a backup file (.jongi) or a file in a shared folder makes the app run something else or overwrite other files.
- Claude can read or change your to-dos, events or notes while the AI connection is off.

The builds aren't code-signed or notarized yet, so macOS and Windows warn you on first launch. That's a known limit. To check that a download is the file that was published, compare it with `SHA256SUMS` on the release.
