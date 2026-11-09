# site — kmd 소개 사이트

제품을 **소개만** 하는 정적 사이트다(로그인 · 서버 API 없음). 참고: `C:\project\termflow\site`(termflow-about.vercel.app) · `C:\project\CDP\site`(cdp-about.vercel.app).

**화면은 진짜이고 내용은 가상이다.** 시험 지식 「신규 입사 온보딩(테스트)」(`onboard`) 하나를 임시 팀 서버에 세우고, 줄거리를 채널마다 실제 저장 문(`hub.save` · `hub.edit`)으로 지나게 한 뒤 화면을 찍는다.

```
index.html · site.css · site.js   사이트 본체 — 빌드 없음 · 바닐라 JS · 색은 제품 토큰(app/kmd.css :root · 다크) 값
favicon.svg        제품 것 사본
demo/content.mjs   시험 지식(문서 4 · 이름 12)과 줄거리 6걸음 — 사람 김(지식관리자) · test-lee(인사팀) · test-park(IT 지원)
demo/run.mjs       세우기 → 저장 → 화면 찍기(라이트 · 다크 · 1280×800) → data/story.js(그래프 · 문서 · 기록 자료)
shots/             찍은 화면 <이름>-<light|dark>.png(home · kn · doc · item · rec · recs · search · edit · graph · history · held · import)
data/story.js      run.mjs 가 만든다 — 손으로 고치지 않는다
```

```bash
node site/demo/run.mjs              # 다 하기(Chrome 또는 Edge 필요)
node site/demo/run.mjs --no-shots   # 자료만
```

## 줄거리(한 지식이 자란다)

| 날 | 채널 | 누가 | 기록 → 항목 |
|---|---|---|---|
| 월 | 세션(Claude Code · kmd-team-save) | test-lee | 「노트북은 입사 전날 집으로」 → 노트북 받기 · 입사 전날 |
| 화 | 파일 넣기(팀 일꾼) | test-park | 「VPN 신청 안내.docx」 → VPN 신청 · IT 지원 포털(두 문서를 잇는다) |
| 수 | 가져올 곳(git 커밋) | test-park | 「메일 계정 자동 만들기」 → 메일 계정 |
| 목 | 화면 고치기 | 김 | 첫날 일정 10:00 → 09:30 |
| 금 | 보내기(개인 → 팀) | test-lee | 「짝꿍 첫 주 체크리스트」 → 짝꿍 |
| 금 | 세션 · **넣지 못함** | test-park | 「노트북 반납: 3일」 — 근거에 없는 값이라 기록만 남음 |

## 마디

| 마디 | 무엇을 | 움직임 |
|---|---|---|
| 첫 화면 | 한 줄 · 문서 화면 그림 | — |
| 개념 | 기록 · 항목 · 문서 세 층, 기록 하나 → 항목 둘을 선으로 | 흐르는 점선 |
| 한 주의 이야기 | 채널 여섯 → 저장 문 → 기록 · 문서 · 넣지 못함 그림 + 요일 탭(기록 · 옛 값 → 새 값 · 결과 · 화면) | 점이 길을 따라 흐름 · 탭 저절로 넘김(누르면 멈춤) |
| 찾아가기 | 지식 목록 → 찾기 → 항목 → 기록 → 문서 다섯 걸음 | 그림 바꿈 |
| 그래프 | story.js 의 그래프를 고정 씨앗 힘 배치로 · 둘러보기 일곱 걸음(노트북 받기 → … → 넣지 못함 → 전체) · 점을 누르면 이웃 한 겹 | 점이 피어나고 선이 그려짐 |
| Claude Code | brief → match → section → save 재생 | 글자 치기 |
| 화면 · 시작하기 | 화면 12장(크게 보기) · 두 프로그램 · 자리 표 | — |

밝기는 시스템 따라 · 머리 단추로 바꾼다(이 브라우저에 `kmd-site-theme`). 그림도 라이트 · 다크로 바뀐다. 움직임 줄이기 설정이면 애니메이션 없이 끝 상태로.

미리보기: `.claude/launch.json` 의 `site`(http-server · 7392). 확인한 것: 1280 · 1024 · 600 · 375 가로 넘침 0 · 콘솔 오류 0 · 라이트 · 다크.

## 남은 것

- 공개(Vercel 등)와 도메인은 사람이 정한다. 올릴 때는 `site/` 폴더를 그대로 정적으로 낸다(빌드 없음).
- 제품 화면이 바뀌면 `node site/demo/run.mjs` 로 다시 찍고 PNG 를 넘겨 본 뒤 커밋한다.
