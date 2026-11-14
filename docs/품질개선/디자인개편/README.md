# kmd 디자인 개편 — 검토 재료

## 무엇을 하나

kmd 팀 화면(웹 · 팀 지식 관리 도구)의 **시각 품질**을 크게 올린다. 테마(색 · 글꼴 · 표면)만이 아니라 **레이아웃 · 앱 틀 · 내비게이션을 바꿔도 된다.** 지금 화면과 크게 달라 보여야 한다(사람 지적: 「기존 화면에서 크게 달라진 게 없다」). 기능 · 데이터 · 권한 · 말(용어집)은 그대로다.

## 재료

- `shots/` — 지금 화면(로컬 시험 환경 · 188 과 같은 코드 498dd55 · 시험 데이터). 이름 `<번호화면>-<폭>.png`, 폭 1280 · 1024 · 375.
  - 1login 들어가기 · 2list 모든 지식(지식관리) · 3home 지식 첫 화면 · 4doc 문서 보기 · 5rec 기록 보기 · 6hist 이력 · 7check 점검 · 8set 설정 · 9people 사람 · 10graph 그래프 · 11qo 빨리 열기(Ctrl O) · 12search 찾기(Ctrl K) · 13edit 문서 고치기
- `refs/` — Mobbin(무료 계정 대표 화면)에서 본 레퍼런스. 각 그림의 Mobbin 주소:
  - `linear-home.png` Linear 첫 화면 https://mobbin.com/screens/a0193431-e1b3-44c4-b1a2-1d1f4a017ccc
  - `linear-chat.png` Linear 대화 · 이슈 https://mobbin.com/screens/afa62cbe-083b-4234-ad90-8a689d8e28cd
  - `gitbook-home.png` GitBook 홈(최근) https://mobbin.com/screens/165c8aa0-013a-44df-9479-a5fb4b505235
  - `gitbook-site-overview.png` GitBook 문서 사이트 개요 https://mobbin.com/screens/f3620e65-a371-43af-93c3-c816ccfad9e6
  - `attio-home.png` Attio 홈 https://mobbin.com/screens/4adb35f8-087c-4123-90f1-da4620dbe159
  - `vercel-overview.png` Vercel 프로젝트 개요 https://mobbin.com/screens/a2712ef7-4a59-4778-9f85-12a6abb7a008
  - `craft-doc.png` Craft 문서(종이 · 배경 · 바탕체 제목) https://mobbin.com/screens/6c2c7eab-6069-466c-802f-d4fa2aad65bb
  - `craft-alldocs.png` Craft 모든 문서(카드 미리보기) https://mobbin.com/screens/3129ea1e-b5a7-41ca-88b7-c5830215e312
  - `confluence-foryou.jpg` Confluence For you https://mobbin.com/screens/fedba7da-a877-448e-823f-a9677af48e4c
  - `slite-km.jpg` Slite 지식 채널(문서 표 · 상태) https://mobbin.com/screens/c2a0754e-bee9-4710-be54-dc59b6694b12
  - `slite-updates.jpg` Slite 업데이트(누가 · 언제) https://mobbin.com/screens/1b0caff5-80d4-418e-86e5-24541b9ea0f0
- 지난 테마 시도(사람이 「차이가 작다」 고 한 것): `../디자인개선/테마/index.html` · `img/`(W 작업대 · P 종이 · N 흰 여백)
- 코드: `app/kmd.css`(토큰 `:root` · 앱 틀 `.app > .side + .col(.hdr · .band · .body(.center(.tabbar · .main) · .aside) · .status)`) · `app/main.js`(화면을 그리는 함수) · `app/styleguide.html`(부품 견본)
- 규칙: `docs/kmd_디자인_컨벤션.md` v0.2(9절 말 · 11절 반응형 · 끊는 점 600 · 1024) · CLAUDE.md 「화면」 절
