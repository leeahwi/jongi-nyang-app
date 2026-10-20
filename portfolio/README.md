# 포트폴리오 자료

종이냥을 이력서, 포트폴리오, 면접에 쓸 때 어느 파일을 꺼내면 되는지 정리했다. 숫자는 모두 [숫자 모음](metrics.md)과 각 앱의 CHANGELOG에서 왔다.

## 자리별로 쓸 파일

| 자리 | 길이 | 쓸 파일 |
| --- | --- | --- |
| 이력서 | 프로젝트당 2–4줄 | [resume-bullets.md](resume-bullets.md)의 짧은 판, 링크 카드는 `site/assets/og-ko.png` |
| 포트폴리오 PDF, 노션 한 장 | 1–2쪽 | [one-pager-ko.md](one-pager-ko.md), [one-pager-en.md](one-pager-en.md) |
| 사례 글 | 3–5분 | [troubleshooting.md](troubleshooting.md), [../docs/design-process.md](../docs/design-process.md), [../docs/decisions.md](../docs/decisions.md) |
| GitHub README | 첫 화면 | [../README.md](../README.md), [../README.en.md](../README.en.md) |
| 소개 웹 페이지 | 한 번 훑기 | `site/` (https://leeahwi.github.io/jongi-nyang-app/) |
| 면접 답변 | 1–2분 | [talking-points.md](talking-points.md), 세부 숫자는 [metrics.md](metrics.md) |

그 밖에: [에셋 목록](assets.md)(그림마다 한 줄 설명과 쓸 자리), [타임라인](timeline.md), [AI와 일한 방식](ai-collaboration.md).

## 이야기별로

| 이야기 | 보여 주는 것 | 쓸 자리 | 근거 |
| --- | --- | --- | --- |
| 코드 대신 사례 표를 나눠 두 플랫폼의 동작을 맞춘 방법 (입력 줄 136줄) | 설계, 시험 전략 | 사례 글의 중심, 면접 | [engineering.md 1장](../docs/engineering.md#1-공유-시험-사례), ADR 4 |
| 시험용 사본에서 쉴 때 CPU 61%(가려지면 87%)를 찾아 0.7%로 줄인 과정 | 측정, 원인 분석 | 문제 해결 1번, 이력서 | [troubleshooting.md 1번](troubleshooting.md) |
| 쓰다가 찾은 멈춤: 0×0 확인 쪽지 때문에 앱이 클릭을 받지 않던 버그 | 사용 중 발견 → 원인 추적, 디버깅 (프로세스 샘플링, 창 목록) | 문제 해결 2번, 면접 | [troubleshooting.md 2번](troubleshooting.md) |
| 디자인 안을 고르고 하루 띠를 세 번 다시 그린 과정 | 기획, 디자인 판단 | 디자인 과정 페이지 | [design-process.md](../docs/design-process.md) |
| 3개 언어, 대비, 화면 자동 검사 | 품질 기준 | 이력서 한 줄, README | [engineering.md 2–4장](../docs/engineering.md) |
| Google 연동을 빼고 파일 기반으로 바꾼 결정 | 범위 판단 | 설계 결정 | [decisions.md ADR 2](../docs/decisions.md#adr-2-google-연동을-뺐다) |
| AI와 나눠 일한 방식, 쓰면서 넣자고 한 기능(시간 알림, 언젠가 ↔ 오늘, 메모 탭) | 도구 사용, 판단과 검토, 사용에서 나온 기획 | 짧은 단락 하나 | [ai-collaboration.md](ai-collaboration.md) |
| 아직 못 한 것: 실제 Windows PC 미확인, 코드 서명 없음, 시간대에 기대는 시험 | 한계를 아는지 | 한 장의 "다시 한다면", 면접 | [engineering.md](../docs/engineering.md#아직-못-한-것) |
