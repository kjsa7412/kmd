# 지식 관리 · 바탕 세우기 개발 TODO

> 2026-11-09 사람 승인: 「승인한다. todo 형식의 개발 진행 절차 md 파일을 만들고 그 순서대로 작업을 수행해라.」
>
> 근거: [KMD_지식관리_설계.md](KMD_지식관리_설계.md)(화면 · 12절 M 단계) · [KMD_바탕세우기_설계.md](KMD_바탕세우기_설계.md)(엔진 · 10절 Z 단계) · 목업 [지식관리_목업.html](지식관리_목업.html) · [문서짜임_바탕세우기_목업.html](문서짜임_바탕세우기_목업.html).
> 13절 「사람이 정할 것」 은 권장 답으로 간다(바뀌면 이 문서에 적는다).

## 진행 규칙

- 단계마다: 구현 → 검토(반박자 · 바뀐 코드만) → 고침 → 바뀐 것에 걸린 테스트만(`npm test` 전체 · restore 테스트 · stash 금지) → 화면이면 네 폭(1280 · 1024 · 600 · 375) 잘림 0 → 기준 문서를 같은 커밋에서 → main 에 커밋 → 이 표에 커밋 해시.
- 커밋은 이 일의 파일만(다른 세션의 site/ · 그래프 목업 등은 건드리지 않는다).
- push · 188 배포는 사람이 하라고 할 때만(배포 직전 단계에서 묻는다).
- 팀 지식에 남기는 시험 데이터는 「테스트」 · `test-`. 지우기는 사람이 확인한 뒤.
- 한도에 걸리면 기다렸다 잇는다. 막히면 이 문서 「막힌 것」 에 적고 다음 단계로 가지 않는다.

## 단계

| # | 단계 | 하는 일(설계 절) | 테스트 | 상태 | 커밋 |
|---|---|---|---|---|---|
| 0 | 설계 · 목업 문서 | 두 설계 · 두 목업 · 검토 보고서 · 이 TODO 를 커밋 | - | [x] | (아래 「기록」) |
| 1 | M1 틀과 옮기기 | `#/manage` 길 · 옛 주소(`#/structure` → 문서 구조) · `manageMenu` · 모든 지식 · 기본 정보(`GET /api/k/:id/manage`) · 권한 · 지식 설정 · 지우기 · 백업 저장소(지금 길 + 지식마다 주소 · 가지 보이기) · 문서 구조(지금 문서 짜임 그대로 옮김) · 진입점 11-1 · 옛 창 셋(addPop · acc · del)과 설정 › 팀 지식 걷기 · 떠남 문(지식관리 설계 3 · 6 · 7 · 10 · 11) | 화면 테스트(screen-kmd 등 지식 관리 · 옛 주소 · 권한 · 지우기 · 설정 메뉴 · 보이지 않는 항목 주소) · `access-ui.test.mjs` · `GET manage` 자리 | [ ] | |
| 2 | M2 새 지식 짧은 길 · 백업 고르기 | 1 무엇으로 세우나(빈 지식 · 파일 그대로 · 되살리기 · 원본 PC 에서) · 자리(팀) · 백업 고르기 셋(GitLab 새로 만들기: 그룹 · 이름 · 가지 / 있는 저장소 / 나중에) · 만들기 걸음 · 끝 카드 · `knowledge/add` 의 `empty` · `name` · `backup: false` · `GET /api/gitlab/groups` · `POST backup/gitlab { group, name, branch }` · 같은 저장소 막기 · 받은편지함 저절로 세우기 걷기(지식관리 설계 4 · 6 · 9-2) | 화면 테스트 · `knowledge/add` 꼴 · `backup/gitlab` 총괄 관리자만 · 같은 저장소 E_CONFLICT · 이름 겹침 · 되살리기에 자리 단계 없음 | [ ] | |
| 3 | Z1 짜임 엔진: 항목 | restructure `items` · 항목 옮기기 · 이름 · `#머리` 링크 · 참고 블록 · `applied` · `placeExact` · 섞인 자리 · 겹침 거절 · creates 패턴 줄 · revert 의 짜임 커밋 처리(바탕 설계 4-3 · 4-4) | `test/restructure.test.mjs` 넓힘 | [ ] | |
| 4 | Z2 구조안 | `core/shape.js` 꼴 · `shapeFp` · `stepFp` · `diffPlan` · `planCheck` · `GET shape` · `POST shape/check`(바탕 설계 3-3 · 4-2) | `test/shape-plan.test.mjs` | [ ] | |
| 5 | Z3 글 걸음 | `checkShape` · `hub.save` `opt.shape` · 태그 예약 · touches · 되돌리기 끔(바탕 설계 4-3 · 4-5 · 4-8) | `test/shape-write.test.mjs` | [ ] | |
| 6 | Z4 연습 판 · 넣기 | 짜임 일 장부 · try · put · 이어 넣기 · 다시 맞추기 · seal · diagnose · 되돌리기 구조안(바탕 설계 4-6 · 4-7) | `test/shape-put.test.mjs` | [ ] | |
| 7 | M3 · Z5 문서 구조 화면 | 지식 관리 › 문서 구조 항목에 다시 잡기 화면(단계 띠 · 옮기기 · 합치기 · 나누기 창 · Claude 단추는 꺼 둠)(바탕 설계 5-2 · 5-4 · 지식관리 설계 5) | 화면 테스트 · 단순 길 [저장] 이 지금과 같음 · 네 폭 | [ ] | |
| 8 | Z6 Claude | 개인 `claude -p` · 팀 일감 `shape-plan` · `shape-write` · noClaude 막음(바탕 설계 7-3) | `test/worker.test.mjs` 새 type · 가짜 Claude | [ ] | |
| 9 | M4 · Z7 새 지식 긴 길(개인) | `core/survey.js` · `/api/shape/*` · stock · 걸러 두기 → 구조안 → 짓기 → 끝 진단 → 만들기 · 만들던 지식 이어 하기(바탕 설계 5-3 · 지식관리 설계 4) | `test/shape-seed.test.mjs` · 화면 네 폭 | [ ] | |
| 10 | M5 · Z8 이은 팀의 빈 지식 | 걸음 문 기기 열쇠 · 팀 짜임 일 · 「바탕 세우는 중」 · 24시간 멈춤(바탕 설계 7-2) | `test/shape-seed.test.mjs` 팀 판 | [ ] | |
| 11 | Z9 세션 스킬 | `scripts/kmd-seed.mjs` · SKILL.md · 꾸러미 열기 · pack SRC · kmd-team-import 한 줄 · TEAM_KIT_REV(바탕 설계 6) | `test/teamkit.test.mjs` · 꾸러미 테스트 | [ ] | |
| 12 | M6 · Z10 문서 · 시범 | 기준 문서(컨벤션 · 작성기준 · 권한 모델 · CLAUDE.md 표) · docs_ops 서비스 전체 · 설명서 · 개인 시험 지식 시범 → `scripts/local.mjs` 팀 시범 | 넣지 못함 · 빠진 값 · 거울 지수 | [ ] | |
| 13 | 188 배포 · 팀 시범 | 사람에게 묻고 배포(CLAUDE.md 배포 절차) · 「바탕 세우기(테스트)」 | 배포 뒤 코드 확인 · 커밋 해시 | [ ] | |

## 기록

## 막힌 것
