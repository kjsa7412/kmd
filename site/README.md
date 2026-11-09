# site — kmd 소개 사이트(만드는 중)

제품을 **소개만** 하는 정적 사이트다(로그인 · 서버 API 없음). 참고: `C:\project\termflow\site`(termflow-about.vercel.app) · `C:\project\CDP\site`(cdp-about.vercel.app).

**화면은 진짜이고 내용은 가상이다.** 시험 지식 「신규 입사 온보딩(테스트)」(`onboard`) 하나를 임시 팀 서버에 세우고, 줄거리를 채널마다 실제 저장 문(`hub.save` · `hub.edit`)으로 지나게 한 뒤 화면을 찍는다.

```
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

## 남은 것(다음 세션)

1. `shots/` 를 넘겨 보고 확인(항목 그림의 오른쪽 칸 펼침 · 그래프 선/제목 · 이력 · 넣지 못함 · 파일 넣기는 관리 줄로 여는 방식으로 막 바꿨다).
2. 사이트 본체 `index.html` · `site.css` · `site.js` — 제품 토큰(`app/kmd.css` :root · 다크) 따라, 바닐라 JS(빌드 없음).
   - 첫 화면(한 줄 + 항목 화면 그림) · 기록 · 항목 · 문서 세 가지
   - 한 지식의 이야기: 채널 탭(위 표) · 채널 → 저장 문(검사) → 기록 + 문서 흐름 애니메이션 · 옛 값 → 새 값
   - 뷰어에서 찾아가기: 지식 홈 → 찾기(Ctrl K 「노트북」) → 항목 → 기록 → 문서
   - 그래프로 뻗기: `story.js` 의 graph 로 SVG 애니메이션(노트북 받기 → 세션 기록 → 입사 전날 → 첫 주 안내 → 장비 → 노트북 반납 → 넣지 못함 기록) · 점 누르면 이웃 한 겹 · 모양: 문서 네모 · 항목 동그라미 · 기록 마름모
   - Claude Code 와 함께(brief → match → section → save 터미널 재생) · 자리(권한) · 설치
   - 화면 모음 + 크게 보기 · 1280 · 1024 · 600 · 375 에서 잘림 없음
3. 누출 검사(사용자 이름 · 사내 주소가 그림 · 자료에 없는지) · Vercel 설정은 사람이 정한다.
