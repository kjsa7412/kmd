# KMD 채널 평가 개선 TODO (2026-11-20)

채널별 실측(real-1 · 커밋 `c20efc1` · 기준점 `6a3dd91`)에서 나온 결함과 개선 거리를 모두 고치고, 같은 조건으로 다시 재서 채널별 시간 · 비용이 얼마나 줄었는지 보고한다.

- 평가 보고: [채널별_지식생성_평가.html](채널별_지식생성_평가.html) · [채널별_지식생성_평가.md](채널별_지식생성_평가.md)(번호 P · H · Q 는 그 보고의 번호)
- 평가 도구: `scripts/channel-eval.mjs` · 결과 `.kmd-data/channel-eval/`
- 기준(before): `.kmd-data/channel-eval/2026-11-19-real-1.json` · $12.32 · 약 75분

## 0. 일하는 법

- CLAUDE.md 를 따른다. main 에 바로 · 묶음마다 커밋(파일 이름을 하나씩 댄다 · 폴더째 `git add` 금지) · 기준 문서와 코드는 같은 커밋 · 바뀐 것에 걸린 `test/*.test.mjs` 만.
- 주인 지시(2026-11-20): 「결함 및 개선 필요한 사항 전체 수정한다」. 사람 결정 셋은 아래 권장안으로 정하고 진행한다(1절).
- 실제 Claude 는 마지막 다시 재기에서만 부른다. 고치는 동안은 가짜 Claude(`--fake`)로 배관만 본다.
- 끝낸 것은 `[x]` 와 커밋 해시로 표시한다. 188 배포 · push 는 하지 않는다.

## 1. 정한 것(권장안)

| 번호 | 물음 | 정한 것 | 까닭 |
|---|---|---|---|
| D1(P8) | 값을 바꾼 화면 고침은 이력(log/)인가 기록(work/)인가 | **기록**이다. 작성기준 152줄을 619줄에 맞춘다: 값 · 사실이 바뀐 화면 고침은 기록으로 남고 참고 블록 출처가 이어진다. 글자 · 서식만 바뀐 것만 이력 | 「기준은 지식이 정확히 만들어지느냐」 · 출처가 끊기면 지금 값 판단(R2-5)이 깨진다 |
| D2(P19) | `intake-commit` 채널 이름 | **걷는다.** 커밋은 운영에서 늘 `intake-src` + `code-change` 태그다. 설계 · 권한 모델 · 저장승인 문서의 채널 표를 코드에 맞춘다. 걷은 정정 채널(`intake-fix` · `fix`)도 문서에서 걷는다. 보내기의 propose 측정 줄 채널은 `send` 로 | 죽은 이름이 측정을 흐린다 |
| D3(P7) | http 저장 채널 | **남기되 기록 서식을 지나게 한다**(recordBody · `changes` 없으면 E_INPUT). 걷기는 화면 · 외부 연동 영향이 커서 따로 정한다 | 말없이 칸을 버리는 것이 결함이다 |

## 2. 제품 결함

### high

- [x] `597981f` **P1 보내기 기록만 길의 unreflected.** `hub.js` sendInputOf 의 원천 칸을 intakeSrcPart 꼴(지문)로 · why 는 값 검사 밖 칸으로. 회귀 시험: 초안 없음 + 수 있는 원문 → propose 오류 0.
- [x] `597981f` **P2 보내기 후보 못 잡음 → held 만.** held 있고 sections 비면 한 번 고쳐 쓰기 · held 는 제안서 경고로 · 머리 없는 원천은 본문 낱말 · search 로 후보 · askClaude 는 받는 팀 지식을 읽는다 · propose 오류의 까닭을 붙여 한 번 다시 짓는다. (검토 고침 `1dbf9a2`: 세션 열쇠는 팀 서버가 내준 읽기 열쇠 · 서버 판정 · 설정 폴더 읽기 막음)
- [x] `d51c12a` · `a22ed8f` · `c9f4383` **P3 뜻 한 줄(gist) 없음.** 들이기 · 세션 프롬프트와 MCP save 설명에서 새 항목 names[].gist 필수 · 저장 문은 새 coord 의 gist 가 비거나 머리와 같거나 짧으면 고쳐 받기(무인) · 오류(사람). (프롬프트 몫은 `d51c12a`: 무인 system · 스킬 셋 · MCP save names 에 gist 칸과 반례 · 바탕 세우기 구조안 names 의 gist(스키마 · 프롬프트 꼴 · cleanPlan · 넣기가 장부에 넘김)는 `a22ed8f` · 짜임 다시 잡기는 있는 항목을 옮기기만 해 장부의 뜻 한 줄이 그대로 간다 · 저장 문 몫은 `c9f4383`: buildProposal approve 의 gist 오류 · 무인 고쳐 받기 · 사람 제안 막음)
- [x] `c9f4383` · `12f5dd5` · `dc7f222` **P4 장부 짝 없는 새 항목.** `core/shape.js` RULES_BASE 를 생성 룰 R3-2 · R7-1 로 · 사건 갈래 새 항목도 names 필수 · 저장 문이 짝 없는 새 머리를 고쳐 받기로. (저장 문 몫은 `c9f4383`: 짝 없는 새 머리 pair 오류 · 패턴 줄 문서의 새 머리도 names · 짜임 머리 빼고 · MCP save names 설명 · shape.js 판단 기준은 `dc7f222`: 바탕 세우기 3 · 4 를 R3-2 · R7-1 로 · seedCover pair 알림 · 다시 잡기 4 는 있는 짝을 옮기기만(SHAPE_PLAN_SCHEMA 와 맞춤))
- [x] `d51c12a` · `c9f4383` **P5 근거 날짜에 들인 날.** 프롬프트에 「원천에 날짜가 없으면 비운다」 반례 · 저장 문은 근거 날짜가 들인 날과 같고 원천 글에 없으면 측정 표시. (프롬프트 몫은 `d51c12a`: 반례 · 일 설명의 넣은 때 줄에 「근거 날짜가 아니다」 · 저장 문 측정 표시는 `c9f4383`: asof 경고 · 무인 `## 값 대조` · savelog warned)
- [x] `dc7f222` **P6 기초 세우기 값 부딪침 · 성격 없음.** 글 짓기 프롬프트에 R2-5 와 앞선 값 · 구조안에 문서 성격 칸 · 넣기가 `_forms.md` 성격 줄을 쓴다. (앞선 값은 목표 대상이 나오는 날짜 있는 재료의 그 줄 둘레만 · 값 대조 근거도 같은 글 · seedPriorOf)
- [x] `c9f4383` **P7 http 저장이 기록 칸을 버림**(D3). http save · propose 가 같은 규칙으로 recordBody(화면 쿠키는 늘 · 기기 열쇠는 서식 칸을 실었을 때 · changes 없으면 E_INPUT) · 화면 별칭 더하기에 changes.
- [x] `dc7f222` **P8 값 바꾼 화면 고침이 이력으로**(D1). 바뀐 것은 앞뒤 값에서 「대상 › 속성: 옛 → 새」 · fixes 대상이 지금 applied 인지 확인.

### medium

- [x] `d51c12a` · `a22ed8f` **P9** 커밋을 원천에 이름 없는 항목에 붙임: 들이기 프롬프트에 R3-5(이름 · 별칭 · 식별자가 나오거나 R2-1 다로 뜻이 같음을 보일 때만 붙인다 · 뜻이 같은 항목이 있으면 새 항목을 세우지 않는다 · 생성 룰 5판 R3-5).
- [x] `c9f4383` **P10** formcheck 의 「주간」 routine 판정 구멍: 갈래 서식으로만 판정 · pc-intake 길이 lintForm 을 지나는지 · 사건 갈래 서식 칸. (routine 은 갈래 이름의 보고 · 정례로만 · pc-intake 는 저장 문 saveNow 의 lintFormNew 알림을 지난다(확정 검사 고쳐 받기는 짓기 길 몫) · cleanForms 가 사건 · 보고 갈래의 빈 서식 칸 · 지식문서를 작업기록으로)
- [x] `c9f4383` · `12f5dd5` **P11** 끊긴 링크: 저장 검사에서 링크 대상 문서 · 머리가 있거나 이번에 세우는지 · 빈칸 정규화. (core/docformat.js deadLinks · spaceLinks · slugOf 를 core 로 · 새로 든 줄만 · 비슷한 이름의 문서를 알림)
- [ ] **P12** 비용 장부 구멍: pcAgent · askClaude(보내기) · shape 세션 비용을 일감 · 측정 줄에 · savelog cost 채움 · 「고칠 것 없음」 다듬기도 측정 줄. (보내기 askClaude 몫은 `597981f`: 개인 쪽 측정 줄 `ch send · stage draft · cost · calls` · 나머지 남음)
- [x] `597981f` **P13** 색인 임시 파일 경합(`core/search.js`): tmp 이름 고유 · 오류 log.
- [x] `d51c12a` · `a22ed8f` **P14** 기록 칸에 경위 · 커밋 메시지: 프롬프트에 R6-4 반례 · 메타 줄을 근거 재료와 뗌 · kmd-build 7절 `record.title` 「대상: 어떻게」 · `record.body` 지식이 어떻게 바뀌었나(넣은 자리 · 들인 경위는 쓰지 않는다).
- [x] `dc7f222` **P15** kmd-migrate dropsOf 를 문장 단위 포함률로 · SKILL 에 「꼴 차이라고 단정하지 않는다」.
- [x] `c9f4383` · `12f5dd5` **P16** 「## 넣은 것」 새 행 요약의 줄표: 행마다 「새로: 행 이름 값」. (values.js rowsAdded · parts.js renderPut 「새로:」 · 「뺌:」 · 옛 「— →」 읽기 그대로)
- [x] `d51c12a` · `a22ed8f` **P17** 다듬기 프롬프트 범위: 오기 · 백틱 · 수준 표시를 다듬기 몫으로 · 다듬기 저장(polishToSave)의 값 견주기를 `samePolished`(수준 표시 · 날짜 표기 · 감싼 백틱은 값이 아니다)로.

### low

- [x] `597981f` **P18** E_APPROVE 측정 줄에 어긋남 표지 · 바뀐 쪽 · 해시 앞 8자. (검토 고침 `1dbf9a2`: 화면 고치기 길도 측정 줄 · 바뀐 쪽은 해시가 본 bases 지문으로 · unknown)
- [x] `597981f` **P19** 채널 이름 정리(D2).
- [x] `dc7f222` **P20** 바뀐 것 없는 구조안은 API 길에서도 일을 열지 않음.
- [x] `c9f4383` **P21** 참고 블록 기록 링크 글은 기록 제목 · 「## 새로 세움」 칸 말 「이름」 → 「항목」. (sections.js logLine 제목 80자 · parts.js renderFresh 「- 항목 종류:값」 · 옛 「- 이름」 읽기 그대로)
- [ ] **P22** 원본 메타(문서 번호 · 판)를 요약에 넣지 않고 참고 블록 메모로. (프롬프트 몫은 `d51c12a`: 요약 · 항목 글에 넣지 않고 기록 refs 로 · kmd 가 참고 블록 「(문서)」 메모로 옮기는 코드 몫 남음)
- [x] `dc7f222` **P23** seedWrite({all}) E_INPUT 메시지에 승인 남은 문서 이름.

## 3. 비용 · 시간 줄이기

- [ ] **C1 시스템 글을 프로세스 넘어 캐시.** 세션 system 글의 앞부분(생성 룰 · 스킬 · 작성가이드)을 일감마다 같은 글자로 두고, 일감마다 바뀌는 것(원천 · 일 설명)은 뒤로 뺀다. 첫 차례 usage 로 cacheRead 가 오르는지 확인한다(비용의 47% 가 cacheWrite).
- [ ] **C2 차례 줄이기.** 일 설명에 첫 brief · match 결과를 미리 실어 찾기 차례를 줄일 수 있는지 본다(원천 · 판례 카드는 코드가 이미 짓는다).
- [ ] **C3 헛돈 막기.** P1 · P2(보내기 실패 $0.74) · H5(shape) · H9(seed) · 바꿀 것 없는 구조안(P20).
- [ ] **C4 커밋 들이기 모델.** 커밋은 출력이 작다. haiku 로 골든 셋을 재서 F1 이 같으면 `models.js` 기본을 커밋만 바꾼다(못 넘으면 sonnet 유지 · 결과를 적는다).

## 4. 시험 도구(`scripts/channel-eval.mjs`)

- [ ] H1 put 판정(회복된 오류는 recoveredCodes) · H2 put 0 · rec null 은 empty · H3 대용 세션 · 스킬 모델 sonnet 고정 + 실제 모델 기록 · H4 serverCost 규칙(스킬 · 대용은 self) · H5 shape 처음 3 문서 승인 순서 · H6 send 제안서 남기기 · H7 사람 세션 toolTrace · H8 check 셈은 Bash tool_use 만 · H9 seed 허락 하위 명령마다 + permission_denials 기록 · H10 restructure 어지럽힌 바탕 + note · H11 goldScope · H12 gold.json 정규식 · H13 채점 성격 · 참고 블록 빼기 · H14 polish 결함 심은 원천 · H15 http 입력 · H16 edit 값 · H17 결과 여럿 토큰 합 · H18 intake-src 커밋 운영 길 · H19 edit-source 점수 칸.
- [ ] 비교 명령: `report --compare <before.json> <after.json>`(채널별 $ · 초 · 차례 · 토큰 · 들어감 · 품질 차이).

## 5. 다시 재기와 보고

- [ ] 고친 HEAD 로 `run --channel all --tag real-2 --model sonnet` (상한 $25).
- [ ] before(real-1)와 견준 채널별 시간 · 비용 · 품질 표를 `채널별_지식생성_평가.md` 에 「개선 뒤」 절로 더하고 HTML 을 갱신한다. 주의: real-1 의 session · bulk · migrate · seed 는 opus 였다 → 모델 탓 절감과 개선 탓 절감을 가른다.

## 6. 진행 기록

| 묶음 | 커밋 | 비고 |
|---|---|---|
| 기준점(평가 도구 · 보고) | `6a3dd91` | |
| send(P1 · P2 · P12 보내기 몫 · P13 · P18 · P19) | `597981f` | 시험 send · send-ops · search · approve · propose · pc-propose · propose-tool · intake · savelog · cost · harness-session · edit · fix · judge · claudelogin 통과. channel-eval 의 intake-commit 행(expectCh)은 H18 몫으로 남김 |
| send 검토 지적 셋(P18 · P2) | `1dbf9a2` | ① 화면 고치기(hub.edit)의 E_APPROVE · 승인 없음도 측정 줄(ch edit · 앞 보고의 「두 곳」 은 저장 문 한 곳뿐이었다) ② 바뀐 쪽 판정을 제안이 낸 해시 → bases 지문(잇기 · 기록 모음 달 항목 포함)으로 · 이 프로세스가 내지 않은 해시는 unknown ③ 보내기 초안 세션은 기기 열쇠 대신 팀 서버가 내준 읽기 열쇠(`/api/k/:id/readkey` · 그 지식 하나 · 읽기 자리 · 20분 · 서버가 propose · save 403) · MCP 설정 폴더 읽기 막음. 시험 approve · edit · send · owners · levels · agent · harness-session · worker · judge · cost · send-ops · propose-tool 통과 |
| prompts(P3 · P5 프롬프트 몫 · P9 · P14 · P17 · P22 프롬프트 몫) | `d51c12a` | 무인 들이기 system 의 「틀리기 쉬운 칸」 반례(gist · 근거 날짜 · 까닭 · 제목 · 원본 메타 · R3-5) · 코드 바뀜 일 설명 R3-5 · 커밋 메시지는 refs · MCP save names gist · kindGist 칸 · 스킬 셋(kmd-build · kmd-save · kmd-team-save) · polishPromptOf 정돈 거리 · 생성 룰 4판(R3 · R5 · R6 반례) · PC_KIT_REV 11 · TEAM_KIT_REV 17. 시험 genrules · harness-session(다듬기 시험 더함) · harness-words · propose-tool · intake · kit-area · analyze · k0 · approve · pc-propose · agent · worker · pc-ingest 통과. teamkit 은 실제 PowerShell 을 띄우는 한 벌이 spawn EPERM(이 실행 환경 · 바뀐 것과 무관) · 판 표 시험은 통과. 저장 문 몫(P3 고쳐 받기 · P5 측정 표시 · P22 메모 줄)은 남김 |
| prompts 검토 지적 넷(P17 · P9 · P14 · P3) | `a22ed8f` | ① 다듬기 저장의 값 견주기를 `core/values.js` `samePolished`(sameValues 의 수준 표시 · 날짜 표기 위에 감싼 백틱 · 푼 백틱은 맨글로 같은 글자가 있으면 같은 값)로: 프롬프트가 시키는 백틱 · 「가.」 → 1. 2. 정돈이 통째로 빠지던 것 ② R3-5 일 설명 둘(무인 system 「이을 항목」 · 코드 바뀜 「붙일 항목」)을 R2-1 다 · R8-2 와 맞춤 · 생성 룰 5판(R3-5 끝 줄 · 반례) ③ kmd-build 7절 제목 · 요약 꼴 ④ 바탕 세우기 구조안 names 의 gist(SEED_PLAN_SCHEMA · 프롬프트 꼴 둘 · cleanPlan · seedPlanOfDraft · hub 넣기 names). PC_KIT_REV 12 · TEAM_KIT_REV 18. 시험 harness-session(다듬기 저장 한 벌 더함) · shape-plan(gist 한 벌 더함) · genrules · harness-words · kit-area · shape-seed · shape-put · agent · worker · pc-ingest 통과. teamkit 은 실제 PowerShell 한 벌 spawn EPERM(앞과 같음) · 판 표 시험 통과 |
| gate(P3 · P4 저장 문 몫 · P5 · P7 · P10 · P11 · P16 · P21) | `c9f4383` | buildProposal(approve)에 gist · pair 오류 · asof 경고 · link 오류(빈칸 %20) · formcheck routine · cleanForms 작업기록 · http recordBody · renderPut 「새로:」 · renderFresh 「항목」 · logLine 제목. 시험 harness-gate(P3 · P4 · P5 · P11 한 벌 더함) · harness-items · harness-session · harness-ask · harness-retry · harness-step0 · approve · access(D3 한 벌) · backup · save(P16 한 벌) · propose · propose-tool · pc-propose · formcheck(P10 한 벌) · guide · weave · agent · worker · pc-ingest · send · edit · qfix-server · fix · judge · savelog · genrules · kit-area · shape-* · kmd-seed · restructure · oldform · docformat · links2 · screen-kmd 통과. intake 3번(다듬기 running) · watch · wp5 · wp7 · wp9 는 HEAD 그대로 깨져 있다(`git archive HEAD` 사본에서 같음). 남은 것: P4 의 shape.js RULES_BASE |
| gate 검토 지적 셋(P4 · P16 · P11) | `12f5dd5` | ① 보내기 회귀: `sendInputOf` 가 draftToSave 의 names 를 버려 새 머리를 담은 보내기 초안이 팀 propose 에서 늘 pair 오류였다 → names 를 싣고(창에서 뺀 머리의 짝은 `namesLeft` 로 뺌 · 승인 · save 입력에도) INTAKE_SCHEMA · 들이기 프롬프트 names 에 gist(예시) · draftToSave 가 gist 를 weave 줄에 넘김(gist 없으면 저장 문의 gist 오류로 P2 다시 짓기) ② `rowsAdded` 가 표 행이 덮지 못한 새 값(표 밖 문장)을 「새로: 값」 한 줄로 더한다(값이 빠지던 것) ③ `deadLinks` 가 「/」 로 시작하는 주소를 지식 뿌리 기준으로(화면 linkTarget 과 같은 셈) · 뿌리 밖은 보지 않음. 시험 send(새 머리 보내기 한 벌 · 고침 전 코드에서 깨짐 확인) · send-ops · save(섞인 표 한 벌) · harness-gate(「/docs/」 링크 세 줄) · docformat · links2 · weave · propose · approve · genrules 통과 |
| shape-edit(P4 shape.js 몫 · P6 · P8 · P15 · P20 · P23) + 검토 지적 셋 | `dc7f222` | 바탕 세우기 판단 기준 3 · 4 를 R3-2 · R7-1 로 · seedCover pair 알림 · 구조안 nature · 「## 문서 성격」 · 앞선 값(R2-5) · 값 바뀐 화면 고침은 기록(changesOf) · fixes 는 그 기록이 든 항목만 · dropsOf 문장 포함률 · 빈 구조안 일 안 엶 · 승인 남은 문서 이름. 검토 고침: ① 다시 잡기 프롬프트에 gist 를 요구하던 4 를 나눔(RESHAPE_NAMES_RULE · 스키마 { coord, doc, h } 와 맞춤) ② seedPriorOf 가 목표 대상(머리 · 장부 값 · 라벨)이 나오는 재료만 늦은 순 12 · 그 줄 앞뒤 3줄만 2만 자 안(세션 폴더 · 프롬프트 · seedJudge · shapeJob 값 대조 근거가 같은 글 · 글 걸음은 heads 로 좁힘) ③ 설명서 사용자.html 두 곳(값 바뀐 고침은 기록 · 글자 · 서식만은 이력 「고침」). 시험 shape-plan(앞선 값 거르기 · 다시 잡기 스키마 두 벌 더함) · shape-seed · edit · fix · kmd-migrate · worker · kmd-seed · genrules --check 통과 |
