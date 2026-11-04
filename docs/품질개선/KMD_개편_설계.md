# KMD 개편 설계 — 「저장이 곧 반영」 구현 (2026-11-03)

출처: [KMD_개편_TODO.md](KMD_개편_TODO.md)(K1 ~ K15 · 정한 것 K-D1 ~ K-D16) · 코드 지도 일곱(저장 문 · 정리 · 들이기 · 화면 · 스킬 · 문서 · 시험)과 그 완전성 검토(어긋남 F-1 ~ F-7 · 빈칸 C-1 ~ C-7 · 결합 D-1 ~ D-10). 기준 HEAD `d07dcde`.
기준: CLAUDE.md(작업은 main · 기준 문서 먼저 · 바뀐 것에 걸린 시험만 · 화면은 네 폭 잘림 0 · 188 배포는 사람이 하라고 할 때만) · [kmd_디자인_컨벤션.md](../kmd_디자인_컨벤션.md) 9절 · [kmd_권한_모델.md](../kmd_권한_모델.md) · [kmd_문서_작성기준.md](../kmd_문서_작성기준.md).
고침: 2026-11-03 검토 셋(정합성 · 권한 · 실현성)의 지적을 코드와 대조해 반영했다(S-D43 ~ S-D55 새로 · 3-3 의사 코드 다시 · 단계 S4 · S5 · S10 · S13 옮김). 걷은 지적은 12절.
읽는 법: 1절이 지도가 남긴 「고를 것」 을 모두 정한다. 2 ~ 9절은 그 결정의 꼴(데이터 · 함수 · 길 · 화면 · 말)이다. 10절이 구현 단계(S1 ~ S13)다. 단계 하나는 한 사람이 한 세션에 끝낼 크기(바뀌는 줄 수백)로 잘랐다.
이 문서에 없는 것: 188 배포(사람이 정한다) · 「2주 측정」 과 「한 팀이 2 ~ 4주 쓴다」 의 기다림(사람이 한다. 9절의 측정 도구만 만든다).

---

## 0. 한눈에

```
 원천을 지은 쪽                         서버 저장 문 한 곳(hub.save → core/save.js)              결과
 ─────────────────                     ───────────────────────────────────────────            ─────────────
 세션 스킬 kmd-team-save    ─┐          ① 자리(need write) · 속도 한도(E_RATE)                   문서 + 기록 + git 한 묶음
 문서 고치기(사람 글)       ─┤          ② serial 줄 안 · 새로 읽은 지식 · 같은 것(md/ · sent/ · job/) → same   이력 한 줄(옛 값 → 새 값 · 되돌리기)
 기록 고치기(규칙 · 일꾼)   ─┼─ 기록 + ─▶ ③ 같은 줄 prepare: 조각마다 검사(팀만)          ─▶  걸린 조각: 기록에 held 표지
 들이기(팀 일꾼 claude -p)  ─┤  조각 +    (지문 · 꼴 E_FORMAT · 값 대조 · 원본이 주인)            (넣지 못함 n · 까닭)
 대량 넣기 kmd-team-import  ─┤  지문 +   ④ 지문 어긋남: 사람 · 세션 = E_CONFLICT(아무것도 안 씀)   확정이 아니면 memo(기록만)
 보내기(개인 프로그램)      ─┘  스킬 판   claude -p 채널 = 새 글에 같은 조각을 한 번 다시 대기    savelog 한 줄(측정)
                                         ⑤ saveNow: 저널 하나 · 커밋 하나 · 실패하면 둘 다 되돌림
```

- 「정리(모아서 나중에)」 는 사람 기록에서 걷는다. 남는 Claude 일은 **들이기**(쓴 사람이 없는 원천을 들어온 그때 하나씩) · **기록 고치기의 규칙 밖 갈래** · **문서 다듬기**(지식관리자가 손으로) 셋이고, 모두 팀 일꾼(팀 구독)의 「들이기 일감」 하나로 돈다.
- 개인 프로그램(PC)의 「저장 즉시 넣기」(`curatePending` · `placeGroup`)는 이번에 바꾸지 않는다(K-D8 · 결합 D-3). 정리 모듈을 걷을 때 그 갈래만 `core/pcplace.js` 로 옮겨 PC 에서만 부른다.

---

## 1. 정한 것 (설계)

지도가 「고를 것」 으로 남긴 것을 모두 정했다. 근거 칸의 F · C · D 는 완전성 검토의 번호다.

| # | 정한 것 | 까닭 · 걷은 안 | 근거 |
|---|---|---|---|
| S-D1 | **넣지 못함 표지는 예약 태그 `held` 하나 + 기록 본문 끝 칸 `## 넣지 못함`(```json``` 목록)**. 까닭 코드는 태그가 아니라 json 의 `code` 칸에 둔다. `held` 는 `RESERVED_TAGS` 에 넣고 `LOG_TAGS` 에는 넣지 않는다(work/ 에 남는다). 입력으로는 받지 않고 저장 문이 붙인다. 칸을 읽는 것은 `held` 태그가 있는 기록의 **마지막** 칸만(위조 막기 S-D45) · 울타리는 본문 안 가장 긴 백틱 줄보다 하나 길게 · 칸 json 합이 4만 자를 넘으면 `content` · `edits` 를 떼고 `why` 만(기록 본문 상한 200k 를 넘지 않게) | 손댈 곳이 가장 적고 백업 · 받기 · 되살림이 그대로 따라간다. 걷은 안: `left/<코드>` 태그(태그가 까닭마다 갈라져 거르기 · 세기가 흩어진다) · 프런트매터 새 칸(frontmatter 왕복 · 저장 뒤 대조를 모두 고쳐야 한다) | F 없음 · save §4-1-6 · sources §3-5 |
| S-D2 | **메모는 `record.memo: true` → 예약 태그 `memo`**. 메모 저장에 `sections` 가 있으면 `E_INPUT 「메모는 항목 글을 받지 않는다」`. MCP 서식 칸의 `changes` 필수는 메모일 때 푼다(`body` 만으로 된다) | 메모는 값이 확정되지 않은 것이라 「바뀐 것」 을 강요하지 않는다 | save §3 guard |
| S-D3 | **팀에서 조각 없이 온 사람 기록은 저절로 메모**가 된다(태그 `memo` · 응답 note 「문서는 바꾸지 않았다: 메모로 남겼다」). 예외는 **서버가 정한 `opt.channel`** 로 가른다(태그로 가르지 않는다 — 입력 태그 하나로 메모 판정을 피하지 못하게): `system` · `intake-*` · `polish` · `bulk`(대량 넣기는 조각이 없으면 held `notfound`). PC 는 지금처럼 `pend` 로 두고 `curatePending` 이 넣는다. **켜는 단계는 S13**(정리 걷기와 같은 커밋 · 그때 `cutoverAt` 을 적는다 S-D46). S4 ~ S12 동안 조각 없는 사람 기록은 지금처럼 `pend` 이고 정리가 넣는다 | 새 저장이 `pend` 를 만들지 않아야 정리를 걷을 수 있다. 정리가 살아 있는 동안 켜면 tidy · final ⑧ · wp5 · wp9 · edit · queue 293 · access 197 시험이 S4 부터 S13 까지 빨갛다(검토 D1) | K-D1 |
| S-D4 | **기록 상태(`recordState`)의 새 갈래 순서**: ① `held` 이고 `k.superseded` 에 있으면 `'fixed'`(R-A3 의 `kept` 보다 먼저) ② `kept` ③ `curate-*` → `none` ④ `memo` → `k.superseded` 에 있으면 `'fixed'`, 아니면 `'memo'` ⑤ `held` → `'held'` ⑥ `k.reverted` → `'reverted'` ⑦ 예약 태그 `put` 이 있으면(저장 문이 넣은 항목을 `## 넣은 것` 에 적은 기록) `## 넣은 것` 의 항목이 모두 `k.revertedItems` 에 있으면 `'reverted'`, 아니면 `'in'` — 그 뒤 누가 같은 항목을 고쳐 표지가 바뀌어도, 항목 하나만 되돌려도 `in` 이 흔들리지 않는다 ⑧ 지금 갈래(ingest · touches 루프 …) — 여기서 `pend` · `nowhere` 가 나오고 그 기록이 `k.superseded` 에 있으면 `'fixed'` | 새 갈래가 touches 루프보다 뒤면 늘 `pend` 가 먼저 나온다. `k.appliedIds`(지금 표지)로 `in` 을 보면 다음 저장 · 항목 되돌림 뒤 `pend`(「개편 전 기록」)로 떨어져 [옛 기록 다시 들이기] 가 되돌린 값을 다시 넣는다(검토 R-6 · R-7 · D3) | F-1 · F-3 · D-10 |
| S-D5 | **F-1 고치기는 (a′)**: 저장 문이 넣은 항목이 하나라도 있으면 예약 태그 `put` 을 기록에 붙이고 `## 넣은 것` 칸을 쓴다 — 이것이 기록 자신의 영구 증거다. `knowledge.js` 에 `k.superseded`(아래 S-D46) · `k.revertedItems: Map<rec, Set<'doc›heading'>>`(되돌림 기록의 `## 되돌린 항목` 칸 · `revert` 태그 기록만 읽는다)를 둔다. `at/` 태그는 남기지 않는다 | 걷은 안 (a) `k.appliedIds`(지금 표지 모음 — 오래 가지 않는다) · (b) 저장 문이 새 항목 coord 를 자리 장부에 세움(자리 장부를 사람 확인 없이 늘린다) | F-1 · 검토 R-6 |
| S-D6 | **판정 이름 둘**: 지금 `hub.canDirect`(관리 자리)의 뜻은 바꾸지 않는다. 새 `hub.canSave(ctx,id)` = PC 이거나 · 에이전트 그 지식이거나 · `levelFor ≥ write`. 바꾸는 곳은 `hub.save` 의 **sections** 판정(754 의 조건을 나눈다: sections 는 `canSave`, names · forms 는 `canDirect` 그대로 — 쓰기 자리의 이름 · 갈래는 계속 칸으로) · `hub.edit`(952) · `http.js:1012` 의 화면 `direct` · MCP brief `you.direct` · `hub.importFiles` 의 첨부 판정 `direct`(2776 · S-D30) 다섯뿐이다 | `canDirect` 를 넓히면 되돌리기 · 장부 · 보내기 · 받은편지함이 쓰기 자리에게 열린다. 754 를 통째로 바꾸면 쓰기 자리 이름이 장부에 바로 들어간다(검토 P-7) | D-1 |
| S-D7 | **검사는 `serial` 줄 안**에서, **줄 안에서 새로 읽은 지식**으로 한다: `core/save.js save()` 에 `prepare: async () => ({ sections, held, proposals, warnings } | { abort })` 콜백을 둔다. 줄 첫머리에서 `recover(dir)`(남은 저널 되돌리기)를 먼저 돌고 → hub 의 prepare 가 `loadKnowledge(meta, { cache: files.get(id) })` 를 직접 부른다(`hub.get` 캐시를 쓰지 않는다 · mtime 캐시라 싸다) → 커밋 뒤 줄을 놓기 전에 `onCommit()` 콜백이 `cache.delete(id)` 를 부른다. `prepare` 안에서 `coreSave` · `saveRecords` · `hub.save` · [버리기] · 규칙 반영 · `docfmtDir` · `editDecl` · `collect` 를 부르지 않는다(같은 serial 키 · 교착) | 줄 밖 검사 · 낡은 캐시로 고르면 그사이 다른 저장이 끼어 저장 전체가 E_CONFLICT 로 터진다(K-D2 「검사 한 곳」 · 검토 R-1 · D6 · R-18) | D-6 · save §4-1-3 |
| S-D8 | **항목 단위 실패는 held, 저장 단위 실패는 throw**: `saveNow(…, { partial:true })` 에서 E_NOTFOUND(302) · E_FORMAT(349) · 원본이 주인(327 ~ 331) 을 그 항목의 held 로 바꾼다. 저절로 채우는 표 표지(`hasBlockMarker`, 지금 `save()` 120)는 `save()` 밖이므로 `guardSections`(S-D44)에서 prepare 결과에 다시 보고 partial 이면 held(`machine`). 기록 자체의 검사(G2 · G3 strict · 머리 대조)는 지금처럼 throw. 모든 항목이 held 여도 기록은 쓴다 | K2-2 「걸려도 기록은 남긴다」 | save §2 |
| S-D9 | **지문(E_CONFLICT) 정책**: 사람 · 세션 · HTTP · 보내기 채널은 stale 조각이 하나라도 있으면 **저장 전체를 E_CONFLICT 로 거절하고 아무것도 쓰지 않는다**(details `{ stale:[coord], proposals }`). 이미 있는 항목에 `base` 가 없으면 edits 든 content 든 E_CONFLICT(지금 767 의 E_INPUT 도 같이). `claude -p` 채널(들이기 일감)은 **`edits` 조각만** 서버가 새 글에 Claude 없이 한 번 다시 대고, 그래도 안 되면 그 조각만 held(code `conflict`). stale `content` 조각은 다시 대지 않고 늘 held(`conflict`) — 그사이 남이 고친 글을 덮지 않는다 | 기록을 남기고 조각만 거절하면 다시 보낼 때 기록이 둘이 된다. 7절 표의 「stale 이어도 기록은 저장」 은 K1-2 에서 고쳐 적는다 | K2-3 · save §5 · 검토 R-13 |
| S-D10 | **쓰기 자리 값 바꿈도 바로 넣는다(K-D13)**: `checkProposal` 의 `waits`(apply · review · tidy)와 `sentencesOf` 를 걷고 `changed:[{from,to}]` 만 남긴다(S4). `/api/k/:id/proposal/:rec/put` · 화면 [넣기] · 확인 대기 칩도 **같은 커밋(S4)** 에서 걷는다. 값 바뀜 알림(`yl`)은 제안 넣기(914 · `applyProposals` 와 함께 S4)와 정리 넣기(1868 · `putDrafts` 와 함께 S13)를 걷는다. 2691 은 PC `placeGroup` 안이라 남긴다(`pcplace.js` 로 옮김). 새 기기 · 되살림 · 편집기 되돌림의 `yl` 도 남긴다 | 이력이 남고 되돌릴 수 있으면 충분하다. 길과 단추를 다른 단계에서 걷으면 그 사이 화면이 없는 길을 부른다(검토 D1 · D19) | D-9 |
| S-D11 | **되돌림 잦은 문서 브레이크는 남긴다**: 7일 안 같은 문서를 두 번 되돌렸으면(`recentReverts ≥ 2`) **값을 바꾸는 조각만** held(code `reverts`, 까닭 「7일 안에 두 번 되돌린 문서: 값 바꿈은 넣지 않았다」) | K-D13 의 「바로」 와 부딪치지만, 되돌림이 잦은 곳은 사람이 보는 편이 낫다. 값 더하기 · 글 고침은 그대로 들어간다 | save §4-2 |
| S-D12 | **이력은 둘 다**: (가) 저장 문이 넣은 항목을 기록 본문 끝 `## 넣은 것` 칸에 줄로 남기고 예약 태그 `put` 을 단다(work · log 기록 모두). (나) `hub.history` 가 `k.logs` 에 더해 **`put` 태그가 있는 work 기록**의 `## 넣은 것` 칸(마지막 칸만)을 `l:` 줄로 싣는다(본문에 같은 머리를 쓴 사람 기록은 태그가 없어 이력에 오르지 않는다 · S-D45). 본인 feed 줄과 겹치지 않게 `logIds` 를 「이력에 올린 work id」 까지 넓힌다 | 세션 · 들이기 · 보내기 저장은 work/ 기록이 applied 를 든다. log/ 만 보이면 지식관리자 이력에 안 나온다 | F-2 |
| S-D13 | **되돌리기 권한**: 쓰기 이상이고 (지식관리자 이거나 · 그 기록의 `author` 가 나 이거나 · `reflects` 저자가 나 하나뿐). 화면은 서버가 실어 주는 `canRevert` 만 본다. **항목마다 되돌리기**: `POST /api/k/:id/revert { record, doc?, heading? }`. 되돌림 기록은 늘 본문 끝 `## 되돌린 항목` 칸(`doc › heading` 줄 · `revert` 태그 기록만 읽음)을 남긴다 → `k.revertedItems`. 항목 하나만 되돌리면 `reopens` 를 달지 않고, 원 기록은 남은 항목이 있으면 `'in'`, 넣은 항목이 모두 되돌려졌으면 `'reverted'`(S-D4 ⑦). 같은 항목을 두 번 되돌리면 `revertPlan` 이 찾을 항목이 없어 E_CONFLICT 「이미 되돌렸다」. 안전은 S-D53 | 쓰기 자리 B 가 A 의 저장을 되돌리는 것은 지식관리자 일이다. 항목 되돌림이 원 기록을 `pend` 로 떨어뜨리면 [옛 기록 다시 들이기] 가 되돌린 값을 다시 넣는다(검토 R-7) | F-4 · save §4-4 |
| S-D14 | **되돌림 기록 태그는 새 `revert`**(예약 · `LOG_TAGS`), 제목 `되돌림: <문서> › <머리>`(전부면 `되돌림: <원 기록 제목>`). `curate-auto` 는 옛 기록 읽기에만 남는다. `hub.revert` 993 의 「함께 든 기록 저자에게 알림」 은 걷고 `.catch(() => {})` 는 log 로 | 「정리」 말을 걷는다 · CLAUDE.md 「오류를 삼키지 않는다」 | F-4 |
| S-D15 | **스킬 판은 정수 `TEAM_KIT_REV`**(`core/teamkit.js`, 처음 값 2). 스킬 글의 자리표 `{{KIT_REV}}` 를 `teamKitParts()` 가 바꿔 넣는다. MCP `save` 에 `kit` 칸. 팀 모드에서 `kit` 이 없거나 `Number(kit) < TEAM_KIT_REV` 면 **저장은 그대로 하고** 응답에 `reinstall:{ have, want, how }`. HTTP `/save` 와 보내기는 `kit` 을 보지 않는다(스킬 kit 이 아니다). 판 올리기를 잊지 않게 시험에 `{ rev: 스킬 글 해시 }` 표를 둔다 | 지금 `ver` 는 해시라 「옛것」 을 모른다. 저장을 막으면 판이 바뀔 때마다 세션 저장이 모두 실패한다(검사는 서버에 있으니 옛 스킬이어도 안전) | K2-4 · skills §7 |
| S-D16 | **같은 저장 막기(이어 하기 · 보내기)**: `sameKey` 는 **prepare 안(줄 안 · 새로 읽은 지식)** 에서 본다 → 같으면 prepare 가 `{ abort:{ same:true, id } }` 를 돌려주고 `saveNow` 는 아무것도 쓰지 않고 돌아온다. 같은 것으로 보는 기록은 **같은 author 의 기록이거나 서버가 붙인 `intake` 태그 기록**뿐이다(쓰기 자리 A 가 남의 파일 지문을 단 가짜 기록으로 그 파일의 넣기를 막지 못하게). `md/<16hex>` 가 있으면 같은 `ingest/<경로>` + 같은 `md/` 를, `sent/<16hex>` 가 있으면 같은 `sent/` 를 단 기록 — 둘 다 held · fixed 인 기록은 뺀다(넣지 못함이 된 것은 다시 보낼 수 있다). 들이기 일감은 `job/<jid>` 로도 본다(S-D48). `sent/` 태그는 `channel:'send'` 에서만 받는다(다른 채널 입력이면 E_INPUT) | 대량 넣기의 「어디까지 했나」 를 팀 저장 결과로 안다 · 보내기의 `/receive` 의 `sent/` 판정을 저장 문으로 옮긴다. 줄 밖에서 보면 같은 것이 동시에 두 번 와 둘 다 쓴다(지금 `/receive` 는 그래서 판정과 저장을 한 줄에 둔다 · 검토 R-2 · D10 · P-1) | K6-3 · K9 · sources §5-3 |
| S-D17 | **세션이 고쳐 다시 저장할 때 겹침 막기**: 넣지 못함(held)이나 메모가 나온 저장을 고쳐 다시 보낼 때 스킬은 `record.fixes:[앞 기록 id]` 를 단다 → 앞 기록 상태는 `'fixed'`(S-D46). `fixes` 가 가리키는 기록은 **내가 쓴 것이거나 내가 그 지식의 지식관리자일 때만**(아니면 E_FORBIDDEN 「남의 기록은 지식관리자가 바로잡는다」 · S-D45). `correction`(= `isTouchesFix` 건너뛰기)은 입력 `fixes` 로 추리지 않고 서버가 정한다: `fixes` 가 모두 held · memo 기록을 가리키는 세션 다시 저장 · `fixRecord` · `again` 일감 | 서버에 같은 저장을 막는 장치가 없다 · 1분 `editDup` 만 있다. 아무 기록에 `fixes` 를 실어 남의 넣지 못함을 지우는 길을 막는다(검토 P-2) | K3-1 · C-1 |
| S-D18 | **들이기 엔진 = 「일감이 원천을 들고 있다가 한 번에 저장」**(지도 7절의 (b)). 원본 바이트 · md 는 `<data>/queue/<jid>.bin` · `<jid>.md` · 일감 `spec` 에 두고 기록을 먼저 쓰지 않는다. 일꾼 초안이 오면 `hub.save` 한 번으로 **기록 + 조각** 을 쓴다. 끝내 못 넘으면 **기록만 + `held`** 이고 원천은 지우지 않고 남긴다(S-D50). 원 기록을 먼저 쓰고 일감을 거는 (a) 는 걷는다 | (a) 는 기록 둘 · 묶음 둘이라 K-D1 · K-D15 를 어긴다 | K5-2 · F-1 · tidy §7 |
| S-D19 | **들이기 저장의 사람 · 태그**: 일감을 만든 사람이 기록 `author` · 저장 `user`(파일 넣기 · 기록 고치기 · 다시 들이기 · 다듬기). 가져올 곳은 `kmd`. 모든 들이기 기록에 예약 태그 `intake`(채널 표지) + `job/<jid>` + 원천 태그(`ingest/<경로>` · `md/<지문>` · `code-change` …). `intake` 는 **`RESERVED_TAGS` 에만** 넣고 `SYSTEM_TAGS`(= `LOG_TAGS` 별명)에는 넣지 않는다(넣으면 기록이 log/ 로 가고 상태가 `none` 으로 굳는다) — 시험 「무인 커밋 0」 은 `test/final.test.mjs:94` 의 허용 목록에 `'intake'` 를 더한다. 저장은 **비system 길**(E_FORMAT · 값 대조 · watched · 표 블록을 거친다)이고 예약 이름 · 태그는 S-D43 의 `intake` 옵션으로만 연다. 자리는 S-D43 의 `intakeCtx` | CLAUDE.md 「문서를 쓰는 새 경로는 저장 검사를 거친다」 · 권한 7절 「들이기 일감은 만든 사람의 자리로」 · 검토 R-3 · R-4 · D2 | sources §7 · D-8 |
| S-D20 | **고쳐 쓰기 횟수**: 들이기 일감은 같은 호출 묶음 안에서 검사 까닭이 `FIXABLE` 이면 **두 번까지**(`KMD_INGEST_FIX`, 1 ~ 2, 기본 2) 다시 쓴다. 서버는 마지막 시도 전까지는 쓰지 않고(`hub.checkSave` = prepare 만 도는 마른 검사) `{ fix: why }` 를 돌려준다. 정리 장부의 「세 번 둔 기록」(`HOLD` · `leftTries`)은 걷는다 | K8-1 | tidy §5-5 |
| S-D21 | **팀 일꾼의 에이전트 길(`agentIngest` · `workerAgent*` · 팀 쪽 `agentTask`)은 걷는다.** 들이기는 `claude -p` 초안 하나. PC 의 에이전트 들이기(`ingestAgent`)는 그대로 | 들이기 = 「`claude -p` 들이기 스킬」(2절 표) · 길이 하나면 `putDrafts` 1898 의 「초안 없이 넣음」 오판이 없어진다 | tidy §12-1 |
| S-D22 | **`noClaude` · 일꾼 쉼 때**: 들이기 일감은 세우지 않고 원천을 **기록만 + held(code `noclaude` 「Claude 에 보내지 않는 지식: 기록만 남겼다」)** 로 저장한다. 규칙 들이기(`ingestRule` · 팀 `ruleJob`)는 팀에서 걷는다. 일꾼이 쉬는 동안 선 일감은 `queued` 로 기다리고, 24시간 넘으면 기록만 + held(code `worker`) — 이것을 보는 것은 팀의 `jobTimer`(S-D40 · `sweepJobs` 는 무엇을 읽을 때만 돈다). `noClaude` 검사는 일감을 세우는 한 곳(S-D47)과 재료 길(`/worker/intake` · 지금 `material` 1747 처럼)에서 모든 type(file · commit · fix · again · polish)에 같이 건다 | 규칙 들이기는 문서 끝에 글을 붙이는 「다듬지 못함」 을 만든다. 넣지 못함 목록이 그 일을 사람에게 보인다 | tidy §12-2 |
| S-D23 | **기록 고치기 = 정정 기록 + 규칙, 안 되면 일감(K4)**. 새 길 `POST /api/k/:id/rec/:rec/fix`. 규칙은 서버에서 Claude 없이(아래 4-3), 규칙이 다 맞으면 **정정 기록 + 조각 한 번**. 규칙이 못 한 항목이 하나라도 있으면 저장하지 않고 들이기 일감 `type:'fix'` 로 넘긴다(일감이 정정 기록 초안을 들고 있다 · S-D18 과 같은 꼴) | K-D1 을 고치기에서도 지킨다 | C-1 · C-2 |
| S-D24 | **넣지 못함 장부를 따로 두지 않는다.** 목록의 원천은 `held` 태그 기록(+ 전환 기간의 옛 `pend` · `nowhere` 사람 기록). 일감 실패는 마지막에 기록만 + held 로 저장하므로 기록 없는 실패가 없다(원천 글을 못 만든 실패 — 파일을 못 읽음 — 는 일 줄 실패 줄로 보인다) | 장부가 둘이면 어긋난다 | C-5 |
| S-D25 | **[버리기] = system 저장의 `curates:[{ id, verdict:'keep', reason }]` 결정 기록**(`decisionRecord`, 제목 「버림: <기록 제목>」 · 새 예약 태그 `drop`(`LOG_TAGS`) — `curate-auto` 를 쓰면 이력 갈래가 걷는 말 「정리」 가 된다). 지식관리자만. 상태 `'kept'` · 이력 갈래 「버림」. [다시 들이기] = 들이기 일감 `type:'again'`(원천은 S-D50 이 남긴 `<data>/held/<rec>.md` 가 있으면 그것, 없으면 그 기록 · 결과는 `fixes:[rec]` 를 단 새 기록 → 원 기록 `'fixed'`). 한 기록에 열린 `again` 일감은 하나(S-D47) | 기록을 지우지 않는다(이력) · 실패해도 새 기록이 held 로 서므로 다시 시도가 목록에 남는다 | C-5 · K1-2 |
| S-D26 | **옛 반영 대기(K10-3)는 화면 단추 하나**: 넣지 못함 화면 머리에 지식관리자에게 「개편 전 반영 대기 n · [옛 기록 다시 들이기]」 → `POST /api/k/:id/held/again-all` 이 「개편 전 기록」(S-D46: `pend` · `nowhere` 이고 `k.superseded` · `k.handedOff` 에 없고 `cutoverAt` 이 없거나 그보다 앞선 사람 기록)마다 `again` 일감을 세운다(이미 열린 `again` 이 있는 기록은 건너뜀 · 한 번에 500). CLI 명령은 만들지 않는다(일감은 도는 서버가 들고 있다). 전환 동안 옛 `pend` 는 넣지 못함 목록에 「개편 전 기록」 까닭으로 보인다 | 사람이 고른 때에 한 번 · 못 넘은 것은 자연히 넣지 못함으로 | K10-3 · tidy §10 |
| S-D27 | **정리 모듈을 걷기 전에 옮긴다**: `core/tidy.js` · `core/curate.js` 에서 살릴 것을 S2 에서 새 모듈로 옮기고 옛 파일은 다시 내보내기만 한다(아래 3-1). 순환(propose ↔ tidy)은 조각 함수를 `core/edits.js` 로 빼서 끊는다. 이름 `core/check.js` 는 이미 있다(지식 폴더 검사) — 쓰지 않는다 | 지우면 저장 문 · 되돌리기 · 시험 import 가 함께 깨진다 | D-2 · C-2 |
| S-D28 | **속도 한도는 새 코드 `E_RATE`(429)**. `hub.save` 맨 앞(`need` 뒤)에 지식 + 기기(없으면 사람) 단위 토큰 통(메모리 Map). 설정 `config.saveRate ?? { perMin: 30 }`, `0` 이면 끔. 시스템 · 들이기 일감 · 에이전트 저장은 뺀다(들이기의 비용 한도는 S-D47). 통은 `Map`(prototype 이름 막기) · 토큰은 `await` 앞에서 동기로 뺀다(MCP 묶음 20 이 `Promise.all` 로 동시에 돈다) · 지식 id 는 `hub.meta` 를 넘은 뒤에만 키로 쓴다. `/receive`(팀)는 같은 통에서 **건수만큼** 뺀다. details `{ retryAfter }` + http `Retry-After` 헤더 | `E_LOCKED` 는 로그인 잠금 뜻이라 섞지 않는다 | C-4 |
| S-D29 | **측정은 `savelog`**: `hub.save` 끝(성공 · E_CONFLICT · E_FORMAT 모두)에 `<data>/savelog/<지식>.jsonl` 한 줄 덧붙이기. 덧붙이기 전용 줄 장부라 원자 쓰기 대신 `serial('savelog:'+id)` 안 `appendFile`, 5MB 넘으면 `.1` 로 이름 바꿈. 읽는 명령 `node scripts/savelog.mjs`(9절). 정리 장부 `tidy/<id>.json` 은 비교 기준이라 **읽기는 걷되 파일은 지우지 않는다**(`deleteKnowledge` 만 계속 지운다) | 통과율을 셀 곳이 없다 | C-6 |
| S-D30 | **첨부(K5-3 · K6-4)는 저장 덩이의 `attach:[{ path, b64 }]`**: 새 `assetPath(dir, p)`(`docPath` 는 `.md` 를 붙여 못 쓴다) — `docs/assets/` 아래만 · `..` · `.` · 빈 조각 · 제어 문자 · 백슬래시 · `:` · 장치 이름(`CON` · `NUL` · `COM1` …) 거절 · 확장자 허용 목록(그림 · pdf · 오피스 · hwp · txt · zip). 이미 있는 경로는 sha 가 같으면 건너뛰고(same) 다르면 E_CONFLICT 「같은 이름의 다른 첨부가 있다」(덮지 않는다). 쓰기 이상(S-D6 의 2776 포함 · 권한 모델 7절에 넓힘을 적는다). 크기: 한 저장 합 8MB(MCP) / 파일 하나 32MB(HTTP 파일넣기) · 지식마다 하루 첨부 합 `config.attachDaily ?? 200MB`(넘으면 E_RATE). MCP 는 `readBody` 기본 2MB 를 **로그인한 ctx 에만** 12MB 로(본문을 읽기 전에 `need(ctx)` · 묶음 20 상한 그대로). 같은 저널 · 같은 커밋. 화면 · 스킬 모두 **기본 해제** | 파일 하나 = 저장 하나 = 묶음 하나(K-D15)가 첨부까지 맞는다. 걷은 안: 새 MCP 도구 `attach`(묶음이 둘이 된다) | C-3 · K-D10 |
| S-D31 | **K14-1 들이기 쪽**: 들이기 초안이 새 문서를 세우는데 `##` 항목이 0 이면 held(code `nosec` 「새 문서는 ## 항목으로 세운다」). 옛 문서 옮기기(`###` → `##` 올림)는 `docfmt` 의 새 단계 `liftH3`(사람이 `--dry` 로 본 뒤). `liftH3` 는 `docfmtDir` 의 serial 안에서 문서와 `_managed.md` 의 `` `## 머리` `` 줄을 **한 커밋**으로 고치고, `verifyConvert` 에 「장부의 모든 이름이 여전히 항목에 닿는다」 를 더한다(안 그러면 그 이름의 저장이 모두 `notfound` held · 검토 R-16) | 좌표가 서지 않는 문서를 더 만들지 않는다 | C-7 |
| S-D32 | **K14-2 는 경고까지**: 들이기 · 보내기 저장이 새 문서나 새 항목을 세우면서 `names` 를 하나도 싣지 않으면 `guardWarn` 에 `names-missing` · savelog 에 남긴다. held 로 올릴지는 측정 뒤 사람이 정한다 | 측정 전에 막으면 통과율이 떨어진 까닭이 섞인다 | C-7 |
| S-D33 | **파일넣기 일 줄 단계 이름**: `STAGES = ['수집','검토','짓기','넣기']`(넷 그대로 · 뜻만). 박아 둔 `3` · `4`(queue.js 189 · 209 · 268 · 272 · 346 · 화면 `STG_SUB`)는 `STAGE_WRITE = 2` · `STAGE_PUT = 3` · `STAGES.length` 로 바꾼다. `STAGES` 는 PC 파일넣기와 같이 쓰므로 **개인 프로그램 화면 글도 「짓기」 로 바뀐다**(S8 에 PC 쪽 시험 · 「짓기」 는 컨벤션 9절 용어집에) | 단계 수를 바꾸면 PC 파일넣기까지 흔들린다 | tidy §4 · 검토 D23 |
| S-D34 | **팀 쓰기 자리에게 「가져오기」 메뉴를 연다**(파일 넣기 탭만). 「가져올 곳」 탭 · [가져올 곳 더하기] 는 지금처럼 지식관리자 | 서버 `/import` 는 이미 write 를 받는다 · 채널 표의 「파일넣기(적은 수) · 팀 화면」 | screens §5-A |
| S-D35 | **한도 상수 이름은 `TEAM_IMPORT_MAX = 20`**(`core/importer.js` export). 서버 `/import` 와 `hub.importFiles` 가 팀이면 `files.length` · 묶음 누계(`group` 쪼가리 합)로 막는다. 문서 폴더(system) · 지식 추가(`asDocs`) · PC 는 빼고 `MAX_FILES = 300` 은 그대로 | 이름이 갈려 있었다(`MAX_TEAM_FILES`) | K5-1 |
| S-D36 | **보내기(K9)는 개인 프로그램이 `claude -p` 를 부르고 팀 저장 문으로**: 개인 프로그램이 팀 MCP(`match` · `section`)를 기기 열쇠로 HTTP 로 불러 후보를 모으고 → `askClaude(intakePromptOf(g,{ from:'send' }), INTAKE_SCHEMA)` → 팀 `POST /api/k/<kn>/save { …, channel:'send' }`. 프롬프트 · 꼴 · 검사는 들이기와 같은 `core/ingest.js` 를 쓴다. `/receive` 는 옛 판을 위해 남기되 들어온 기록은 **held(code `legacy-send` 「옛 보내기: 조각 없이 기록만 왔다」)** — `saveRecords(…, { serverTags:['held'], heldPart })` 옵션(입력 검사 뒤 저장 문이 붙인다 · 입력 예약 태그는 계속 거절) · 속도 통에서 건수만큼(S-D28). 보내기는 E_RATE(429)를 실패로 치지 않고 `Retry-After` 를 지켜 다시 보낸다. 넣지 못함 줄의 [다시] 는 앞 결과 id 를 `record.fixes` 로 싣는다(옛 held 가 겹쳐 남지 않게). `noClaude` 팀 지식에 보내면 PC 는 Claude 를 부르지 않고 기록만 보낸다 → 팀이 held(`noclaude`) | K9-2 「같은 엔진 · 화면은 따로」 · 검토 R-19 · R-21 · P-8 · P-11 · P-12 | sources §5 |
| S-D37 | **문서 다듬기(K10-4)도 들이기 일감**(`type:'polish'`, 지식관리자, 문서 하나). 결과 기록은 log/(새 예약 태그 `polish` · `LOG_TAGS`), 제목 `다듬기: <문서>`. 검사는 항목마다 **값 장부가 같아야**(`valuesOf(옛) == valuesOf(새)`) 넣는다. 아니면 그 항목 held 대신 그 항목만 빼고 일 줄에 까닭 | 값은 바꾸지 않는 정돈이다 | K10-4 |
| S-D38 | **환경 변수 이름(K7-3)**: `KMD_WORKER_PAR`(1 ~ 8, 기본 3) · `KMD_WORKER_JOBS`(1 ~ 4, 기본 2) · `KMD_WORKER_TICK_MS`(15000) · `KMD_INGEST_BUDGET`(기본 1.0달러 · 파일 하나 + 후보 다섯 × 1500자) · `KMD_INGEST_EFFORT` · `KMD_INGEST_FIX`(기본 2). 옛 `KMD_TIDY_*` 를 뒤 순서로 읽어 준다(`env.NEW ?? env.KMD_TIDY_*`). `KMD_TIDY_BATCH` · `KMD_TIDY_PATCH` 는 걷는다. 명령 `kmd worker` · 단위 `kmd-worker` 이름은 그대로, 설명만 「팀 일꾼」. `kmd-install.sh` 는 `/etc/kmd/worker.env` 가 있으면 덮지 않는다 | 188 의 `worker.env` 에 옛 이름이 있다 | D-7 |
| S-D39 | **모델 역할 이름**: `core/models.js` 의 `tidy` → `ingest`(옛 설정 `pc.models.tidy` 를 읽어 옮긴다). `touch` 는 **남긴다** — 개인 프로그램 `placeGroup` 이 `role:'touch'` 로 부른다(hub 2663 · 걷으면 `modelOf` 가 `''` 를 돌려 haiku 대신 기본 모델로 돈다). 팀은 쓰지 않을 뿐 | 화면 「Claude 모델」 글과 같이 · K-D8 「PC 는 바꾸지 않는다」(검토 D5) | tidy §9 |
| S-D40 | **시계 둘**: 정리 시계(hub 3800 ~ 3826)를 걷을 때 `inboxTidy` 만 도는 `inboxTimer`(`config.inboxTickMs ?? 60초`, PC 만)와, 팀의 `jobTimer`(같은 주기 · `sweepJobs` + 24시간 넘은 queued 들이기를 기록만 + held `worker` · S-D22)를 둔다. 정리 시계 안의 PC 갈래(정해진 시각 `tidyNow`)도 같이 걷힌다 — PC 는 `curateSoon` 과 켤 때 넣기가 맡는다(11절에 적음) | 시계를 걷으면 PC 받은편지함 옮기기가 멈추고 24시간 규칙을 볼 곳이 없다(검토 D20 · D21) | D-4 |
| S-D41 | **`curateIdle` 은 이름을 `idle` 로 바꾸고 옛 이름을 같은 함수로 둔다**(시험 20여 곳이 쓴다). S13 에서 시험을 고친 뒤 옛 이름을 걷는다 | 한꺼번에 깨지지 않게 | D-5 |
| S-D42 | **`setTouches`(`/rec/:rec/touches`)는 남긴다**: 넣지 못함 까닭이 「넣을 곳을 찾지 못했다」(code `notfound` · `nosec`)인 줄의 [고치기] 가 넣을 곳 고르기 창(`tdPickModal` 을 옮긴 `heldPickModal`)을 열고, 고른 뒤 [다시 들이기] 를 건다. `setTouches` 가 쓰는 `touches-fix` 기록은 「바로잡힘」 증거가 아니다(S-D46 — 넣을 곳만 골라도 목록에서 빠지지 않게) | 자리 고르기 화면을 새로 만들지 않는다 | tidy §12-6 |
| S-D43 | **들이기 저장 옵션 · 자리**: `core/save.js save()` 에 `intake: { tags }` 옵션. 이 옵션이 있으면 (1) 예약 사람 `kmd` 를 받는다(`kmd-auto` · `kmd-worker` 는 아님) (2) 예약 태그는 저장 문이 붙이는 `intake` · `job/<jid>` · `code-change` · `polish` 만 받는다(입력 태그로 오면 그대로 거절) (3) 사람이 `kmd` 여도 참고 줄(`logged`, 지금 380)을 단다(항목 「출처」 에 남게) (4) 그 밖의 검사(E_FORMAT · 값 대조 · watched · 표 블록 · remove/rename 금지)는 비system 그대로. hub 는 일감마다 `intakeCtx(job)` 을 세운다: `{ user: job.by, intake:true }` 이고 자리는 **일감을 끝낼 때 명부에서 다시 읽은** `min(그 사람의 지금 자리, write)`(떠난 사람 · 자리 없음이면 held `seat` · `shell`/`admin` 류 ctx 를 쓰지 않는다). `polish` 만 지식관리자를 요구한다. 들이기의 `names` · `forms` 는 자리와 상관없이 늘 「세울 이름 · 세울 갈래」 칸(S-D51) | 지금 core 는 비system 의 예약 사람(115) · 예약 태그(117)를 거절한다 · 일꾼 `/done` ctx 는 초안 열쇠(`levelOf` → read)라 `need(write)` 를 넘지 못한다(검토 R-3 · D2 · P-6) | sources §7 |
| S-D44 | **prepare 결과도 같은 입력 검사를 거친다**: 내부 함수 `guardSections(secs, { system, asEdit, structure, intake })` 를 `save()` 의 입력 `sections` 와 `saveNow` 안의 prepare 결과에 **둘 다** 돌린다 — `check()` 의 조각 부분(모양 · 50개 · 길이 · base 16hex · 머리 한 줄) · remove/rename 은 `structure` 일 때만(지금 119) · 표 표지 `hasBlockMarker`(지금 120 · partial 이면 held `machine`) · 예약 파일. `structure` 는 `hub.edit` 이 `levelFor === 'admin'` 일 때만 넘기는 명시 옵션(`asEdit` 하나로 remove · rename 이 열리지 않게) | `sections: []` 를 넘기고 prepare 가 조각을 지으면 지금 검사가 하나도 돌지 않는다(검토 R-5 · D7 · P-13) | save §3 |
| S-D45 | **저장 문만 쓰는 칸 위조 막기**: 비system 입력 `record.body` 에 `^## (넣은 것|넣지 못함|되돌린 항목|고친 조각)\s*$` 줄이 있으면 E_INPUT 「이 머리는 kmd 가 쓴다」(`check()`). 칸은 그 칸을 쓴 표지(`put` · `held` · `revert` 태그)가 있는 기록에서 **마지막** 칸만 읽는다. `## 고친 조각`(지금 `propose.js:126` · `views.js:286`)은 S13 까지 옛 기록 읽기에만 · 새 입력에서는 거절. 기록 본문에 칸을 붙인 뒤 길이가 200k 를 넘으면 `## 넣지 못함` 의 edits · content 를 떼고 `why` 만 남긴다. `fixes` 대상 검사는 S-D17 | 위조된 `## 넣은 것` 은 거짓 이력 · 「들어감」 을, 위조된 `## 넣지 못함` 은 [다시 들이기] 에 엉뚱한 조각을 싣는다(검토 R-11 · P-3 · D22) | — |
| S-D46 | **바로잡힘 · 개편 전 판정**: `k.superseded` = 나중 기록 x 가 `fixes` 로 가리키는 기록 w 의 모음, 단 x 는 held 가 아니고 `touches-fix` 기록이 아니다(누가 `fixes` 를 실을 수 있는지는 쓸 때 S-D17 이 막는다). held · memo · 옛 `pend` · `nowhere` 모두에 쓴다(메모도 줄어든다 · K12-3). `k.handedOff` = held 든 아니든 나중 `intake` 기록이 `fixes` 로 가리키는 기록(일을 넘겨받은 기록이 있다). **「개편 전 기록」** = 상태 `pend` · `nowhere` 인 팀 사람 기록 가운데 `k.handedOff` 에 없고 설정 `cutoverAt`(S13 이 처음 켤 때 `config.json` 에 원자 쓰기 · 없으면 모든 pend)보다 앞선 날짜(`arrivedOf`)인 것 — 상태가 아니라 시각으로 가른다 | 다시 들이기가 다른 항목에 넣거나 touches 가 없으면 원 기록이 계속 `pend` 라 단추마다 일감이 다시 서고, 넣을 곳 고르기만 해도 「바로잡힘」 이 되던 구멍을 막는다(검토 R-9 · D15) | K10-3 |
| S-D47 | **들이기 일감은 한 곳(`hub.openJob`)에서 세운다**: 모든 type(file · commit · fix · again · polish)이 이 함수를 거친다 — `row.noClaude` 면 세우지 않고 기록만 + held(`noclaude`) · 같은 원천(`rec` · `rel+sha` · `commit` · `doc`)에 열린(queued · running) 일감이 있으면 그 일감을 돌려준다 · 사람 × 지식마다 queued 상한 `config.intakeQueue ?? 20`(넘으면 E_RATE) · 지식마다 하루 들이기 수 `config.intakeDaily ?? 300`(넘으면 E_RATE · 가져올 곳 · 문서 폴더는 넘으면 기록만 + held `worker`). 팀 화면의 20 제한(S-D35)은 쓰는 법 안내일 뿐 이 한도가 보안 경계다 | 팀 구독 Claude 비용을 쓰는 길(`again` · `fix` · `/import` 새 묶음 id · `again-all`)에 한도가 없었다(검토 P-5 · P-8 · R-9) | — |
| S-D48 | **들이기 저장은 멱등**: 들이기 기록에 예약 태그 `job/<jid>`. 일감을 다시 집을 때(켤 때 `running` → `queued`)와 prepare 의 `sameKey` 가 같은 `job/` 기록을 보면 `same` 으로 끝내고 일감을 done 으로 닫는다 | 커밋 → `jobs.json` done → `.bin` 지우기 사이에 꺼지면 같은 원천이 두 번 저장된다(검토 R-10) | — |
| S-D49 | **커밋 뒤는 던지지 않는다**: `hub.save` 의 커밋 뒤 단계(`savelog` · `feed.add` · 백업 · 알림)는 모두 `try/catch` + `hub.log`, 응답은 성공 그대로(지금 812 의 `.catch(() => {})` 도 log 로). core 의 `j.undo().catch(() => {})`(save.js 168 · 446)도 log 로 남기고, `commitPaths` 가 커밋한 뒤 던졌으면(HEAD 가 움직였으면) 되돌리지 않는다 | 성공한 저장이 오류로 보이면 다시 보내 기록이 겹친다 · CLAUDE.md 「오류를 삼키지 않는다」(검토 R-12 · R-20) | — |
| S-D50 | **넣지 못함으로 끝난 들이기의 원천을 남긴다**: 일감이 held 로 끝나면 `<jid>.md`(그리고 32MB 이하면 `<jid>.bin`)를 `<data>/held/<rec>.md` · `.bin` 으로 옮기고, 그 기록이 `fixed` · `kept` 가 될 때 지운다(`jobTimer` 가 본다). 기록 본문에는 원천 앞 2000자와 지문만 싣는다(기록만 저장이 200k 상한에 걸려 기록조차 없는 일이 없게). `deleteKnowledge` 는 지식의 `held/` 도 지운다 | [다시 들이기] 가 원본 대신 요약 기록을 원천으로 쓰게 되고, 큰 md 는 기록조차 못 남겨 「기록 없는 실패 없음」 이 거짓이 된다(검토 R-8) | C-5 |
| S-D51 | **세울 이름이 갈 곳**: 쓰기 자리 저장 · 들이기 저장의 `names` · `forms` 가운데 장부 밖 것은 기록의 「세울 이름 · 세울 갈래」 칸으로 싣고 held part 하나(code `names` · 「세울 이름이 있다: 지식관리자가 세운다」 · coord 없음)를 단다 → 넣지 못함 목록에 보인다. 지식관리자의 [이름 세우기] 는 그 칸을 읽어 system 저장 하나(`names` · `forms`)로 세우고 원 기록을 `fixes` 로 가리킨다. 빠진 값(spread)처럼 조각 하나에 매기지 못하는 held 도 같은 기록 단위 part(coord 없음 · code `values`) | 정리가 사라지면 그 이름을 세우는 사람이 없다 · 쓰기 자리가 장부를 바로 늘리지 않는다(권한 모델 1절 · 검토 D11 · R-22) | — |
| S-D52 | **새 저장 검사는 팀에서만**: `gatePrepare`(값 대조 · held · 지문 정책 · S-D11 브레이크)는 `mode === 'team'` 에서만 돈다. PC 의 세션 · 화면 저장은 지금 그대로(곧바로 넣기 · `curatePending`) — PC 쪽 시험(`send` 「이 PC」 · `agent` PC 부분)을 S4 에 더한다 | K-D8 「PC 는 바꾸지 않는다」(검토 D5) | D-3 |
| S-D53 | **되돌리기 안전**: `revertPlan` 이 항목마다 `base: sha16(지금 글)` 을 싣는다(되돌리기 사이 누가 고쳤으면 E_CONFLICT 「되돌리려는 뒤에 누가 고쳤다」 · system 저장도 base 검사는 돈다 · save.js 333). 기록 전에 없던 항목(앞 판이 없음 · 첫 커밋 문서)은 `content:''` 대신 `remove:true` 로 되돌린다(빈 머리가 남지 않게 · 문서가 비면 문서는 남기고 점검이 「빈 문서」 로 알린다). 지식관리자가 아닌 사람의 되돌리기는 watched 문서의 항목이나 표 블록이 바뀌는 항목이 하나라도 있으면 E_FORBIDDEN 「원본이 주인인 문서 · 저절로 채우는 표는 지식관리자가 되돌린다」(되돌리기는 system 저장이라 watched · keepBlocks 를 건너뛴다) | 검토 R-14 · R-15 · P-4 | F-4 |
| S-D54 | **새 길 입력 · 메서드**: 새로 쓰는 길(`held/*/again` · `again-all` · `drop` · `rec/*/fix` · `polish` · `revert` · `worker/intake*`)과 지금 `rec/*/touches`(http 703 · 메서드를 안 본다)는 `req.method !== 'POST'` 면 405(CSRF 막기가 POST 에만 돈다 · 쿠키는 `SameSite=Lax`). `:rec` 은 `dec()` 감싸 400 · `^\d{4}-\d{4}-` · ≤80. `fix` 의 `from` · `to` 는 한 줄 · ≤200 · 서로 다름 · `body` ≤200k. `polish { doc }` 은 `k.docs` 에 있는 것만. `/worker/intake*` 는 `:kn` 을 `dec()` 로 풀고 `ctx.draft.kn === kn` · 일감 type 이 맞는지. `/done` 의 `tries` · `last` 는 본문이 아니라 서버 `job.tries` 로. `/fail` 의 `why` 는 한 줄 ≤200 · `code` 는 허용 목록(login · limit · budget · timeout). HTTP `/save` 는 본문에서 `body.channel === 'send'` 하나만 받고 `intake` · `dry` · `asEdit` · `structure` 는 본문에서 읽지 않는다. 팀에서 에이전트 길을 걷으면(S-D21) `kmda_` 열쇠 받기(http 321)도 팀 모드에서 끈다 | 검토 P-14 · P-15 · P-16 · P-18 | — |
| S-D55 | **`checkProposal` 은 doc · heading 도 받는다**: `checkProposal(k, { coord? | doc+heading, base, edits, record, spread })` — 이름 장부에 이름이 없는 항목(픽스처 문서 대부분)에도 조각을 댄다. 「섞인 자리」(`legacyPend`) 는 문서 · 머리 기준으로도 센다 · 걸리면 held code `legacy-mix` 「이 항목에 개편 전 기록이 아직 안 들어갔다: 지식관리자가 [옛 기록 다시 들이기] 를 하면 풀린다」 | 지금 `sectionOf(k, coord)`(propose.js 88)는 이름으로만 찾는다(검토 D8 · D9) | — |

---

## 2. 데이터 꼴

### 2-1. 저장 덩이 (모든 채널 → `hub.save(ctx, id, input, opt)`)

```js
input = {
  record: {
    title,                 // ≤200
    body,                  // ≤200k · MCP 는 서식 칸(changes · why · dropped · impact · refs · body)을 recordBody 로 엮는다
    date?, touches?, touchesEmpty?, tags?,
    fixes?: [recId],       // 정정 · 다시 들임 · 세션 다시 저장(S-D17)
    memo?: true,           // S-D2
  },
  sections?: [{
    coord? | (doc, heading),
    base?,                 // 16hex · 이미 있는 항목이면 꼭(S-D9)
    edits?: [{ find, replace }] | content? | remove? | rename?   // remove · rename 은 지식관리자 화면 고치기만
  }],
  names?, forms?,
  attach?: [{ path, b64 }],  // S-D30 · docs/assets/ 아래
  kit?: '2',                 // MCP 만(S-D15)
}
opt = {
  channel: 'session' | 'http' | 'edit' | 'fix' | 'send' | 'bulk' | 'intake-file' | 'intake-src' | 'intake-fix' | 'intake-again' | 'polish' | 'system',
  form?, guard?, system?, intake?: { job, tries, last },  // 들이기 일감에서만(intakeCtx · S-D43)
  dry?: true,                                              // hub.checkSave 가 쓴다(쓰지 않고 proposals 만)
}
```

- `channel` 은 부르는 쪽(서버 코드)이 정한다: MCP `save` 는 기록 태그에 `ingest/` 가 있으면 `bulk`, 아니면 `session` · HTTP `/save` 는 `body.channel === 'send'` 이면 `send`, 아니면 `http`(본문의 다른 opt 칸은 읽지 않는다 · S-D54) · `hub.edit` 는 `edit` · 들이기 일감은 `intake-*`. `opt` 는 사람이 보낸 값에서 만들지 않는다.

### 2-2. 기록 표지

| 표지 | 꼴 | 누가 붙이나 | 디렉터리 | 상태 |
|---|---|---|---|---|
| `held` | 태그 + 본문 끝 `## 넣지 못함` json | 저장 문(조각 하나라도 못 넣음 · 들이기 실패) | work/ | `held` / `fixed` |
| `memo` | 태그 | 저장 문(`record.memo` · S-D3 저절로) | work/ | `memo` |
| `intake` | 태그(`RESERVED_TAGS` 만 · `SYSTEM_TAGS` 아님) | 들이기 일감 저장 | work/ | 보통 상태 판정 |
| `job/<jid>` | 태그(예약 접두사) | 들이기 일감 저장(S-D48) | work/ | — |
| `put` + `## 넣은 것` | 태그 + 본문 끝 칸 | 저장 문(넣은 항목이 하나라도 있으면 · S-D5) | work · log | `in` / `reverted`(S-D4 ⑦) |
| `revert` + `## 되돌린 항목` | 태그 + 본문 끝 칸 | 되돌리기 | log/ | `none` |
| `polish` | 태그 | 문서 다듬기 | log/ | `none` |
| `drop` | 태그 | [버리기](S-D25) | log/ | `none` · 이력 「버림」 |

예약 접두사(`job/`)는 `isReservedTag` 가 접두사로도 본다. 저장 문만 쓰는 칸(`## 넣은 것` · `## 넣지 못함` · `## 되돌린 항목`)을 사람 입력 본문에 쓰면 E_INPUT(S-D45).

`## 넣지 못함` 칸(`core/parts.js` `renderHeld` · `parseHeld`):

```json
[{ "doc": "docs/배포절차.md", "heading": "롤백", "coord": "배포절차#롤백",
   "code": "values", "why": "기록의 값이 글에 없다: 5분",
   "base": "3f2a…", "edits": [{ "find": "…", "replace": "…" }] }]
```

- `code` 값: `values`(값 대조 · coord 없는 기록 단위 part 도 있다 S-D51) · `names`(세울 이름 · 기록 단위) · `legacy-mix`(섞인 자리 S-D55) · `format`(E_FORMAT) · `conflict`(지문) · `notfound`(넣을 곳 없음) · `nosec`(`##` 없는 새 문서 · 원 기록이 들어간 항목 없음) · `watched`(원본이 주인) · `machine`(저절로 채우는 표) · `reverts`(S-D11) · `edits`(조각이 지금 글에 맞지 않음 · 꼭 한 번 나오지 않는다 · S4) · `seat`(자리 잃음) · `noclaude` · `worker`(일꾼 쉼 24시간) · `claude`(일꾼 실패 · 예산 · 시간) · `legacy-send` · `legacy`(개편 전 반영 대기 · 화면 표시용, 저장하지 않음).
- `edits` 또는 `content` 는 [고치기] · [다시 들이기] 의 재료로 남긴다(조각 50 · 2만 자 상한 그대로).

`## 넣은 것` 칸(`renderPut` · `parsePut`), 한 줄에 항목 하나:

```
## 넣은 것
- docs/배포절차.md › 롤백: 5분 → 10분
- docs/배포절차.md › 준비
- docs/회의록.md › 2026-10-21 HNC 통화 (새 항목)
```

- 값 바뀜은 `valueDiff(old, new)` = 옛 값 장부에만 있는 값 → 새 값 장부에만 있는 값(각 5개까지, `, ` 로 잇는다). `core/values.js` 의 `NOT_KNOWLEDGE` 에 「넣은 것」 · 「넣지 못함」 을 더해 값 검사가 이 두 칸을 기록 값으로 읽지 않게 한다.

### 2-3. 상태와 쓰는 곳

| 상태 | 뜻 | 화면 말 |
|---|---|---|
| `in` | 문서에 들어감 | 문서에 들어감 |
| `held` | 넣지 못함(못 넣은 조각이 하나라도) | 넣지 못함 · 까닭 |
| `fixed` | 넣지 못함 · 메모 · 개편 전 기록이었고 나중 기록이 `fixes` 로 바로잡음(S-D46) | 바로잡힘 |
| `memo` | 메모(문서 안 바꿈) | 메모 |
| `reverted` | 되돌림 | 되돌림 |
| `kept` | 버림(지식관리자) | 버림 |
| `pend` · `nowhere` | 개편 전 기록(팀 · `cutoverAt` 앞 · S-D46) · S4 ~ S12 동안 정리를 기다리는 사람 기록 · PC 의 저장 즉시 넣기 대기 | 개편 전 기록 |
| `none` | 시스템 · log | — |

- `pendPick` · `views.knowledgeRow` · `docPend` · `recRow` · `docView` · MCP `notYetInDocs` · `recOut` 은 S10 에서 모두 새 상태를 본다(D-10). 정리 재료 `material()` 은 `state === 'pend'` 만 그대로 집어 전환 동안 held 를 다시 집지 않는다.

### 2-4. 응답 꼴

```js
{ id, record, docs, commit, date,
  put: 2, held: [{ coord, doc, heading, code, why }],
  proposals: [{ coord, ok, why?, code?, stale?, near?, changed?: [{ from, to }], warnings?, applied: boolean }],   // 7절 꼴 · waits 칸은 걷는다
  memo?: true, same?: true, reinstall?: { have, want, how },
  note: '저장했다. 기록 1 · 넣음 2 · 넣지 못함 0',
  warnings: [...] }
```

E_CONFLICT details: `{ stale: ['배포절차#롤백'], proposals }` · E_RATE details: `{ retryAfter: 12 }`.

### 2-5. savelog 한 줄

```json
{"at":"2026-11-10 14:02","kn":"dpms","user":"lee","device":"dev-3f…","ch":"session","kit":2,
 "rec":"2026-1110-롤백-시간","n":3,"put":2,"ok":["proc:카나리","배포절차 › 준비"],"held":[{"code":"values","coord":"배포절차#롤백","why":"기록의 값이 글에 없다: 30분"}],
 "stale":[],"conflictWith":[],"memo":false,"same":false,"ms":840,"err":null,"cost":null}
```

- `kit`: 세션 스킬 판(MCP 가 넘긴 수 · 없으면 null). `ok`: 넣은 자리(응답 `proposals[].applied` 의 coord · 「다시 넣은 비율」 이 같은 자리를 짝짓는다 · S6 에 더함). `held[].why`: 까닭 앞 40자(까닭 상위 · S6 에 더함).
- `err`: `E_CONFLICT` · `E_FORMAT` · `E_RATE` 처럼 저장 전체가 실패했을 때(이때 `rec` 없음). `conflictWith`: stale 조각마다 `{ coord, by }`(그 항목 지금 applied 기록의 author · K12-4). `cost`: 들이기 일감이면 일꾼이 보고한 claude 비용 합 · 횟수 `{ usd, calls }`.

### 2-6. 들이기 일감 (`jobs.json` 의 한 줄)

```js
{ id, kn, kind: 'intake', by: 'lee' | 'kmd', auto: false, at, state: 'queued'|'running'|'done'|'failed'|'cancelled',
  run?: '<일 줄 run id>',
  src: { type: 'file', rel, sha, title } | { type: 'commit', src: '<가져올 곳 이름>', commit, title }
     | { type: 'fix', rec, draft: { title, body, from?, to? }, targets: [{ doc, heading, base }] }
     | { type: 'again', rec } | { type: 'polish', doc },
  tries: 0, why?, result?: { rec, put, held } }
```

- 원본은 `<data>/queue/<jid>.bin`(파일 바이트) · `<jid>.md`(바꾼 글 · 커밋 차이). 일감이 done 으로 끝나면 지우고, held 로 끝나면 `<data>/held/<rec>.*` 로 옮긴다(S-D50). 7일 · 50개 지나면 `sweepJobs` 가 일감을 걷는다(지금 규칙).
- 옛 정리 일감 줄(`spots` 의 section 자리)은 읽어도 넘어지지 않고 `cancelled`(까닭 「개편으로 걷은 정리 일감」)로 둔다.

---

## 3. 모듈 · 함수

### 3-1. `core/tidy.js` · `core/curate.js` 나누기 (S2 에서 옮기고, S13 에서 옛 파일을 걷는다)

| 새 모듈 | 옮겨 오는 것 | 쓰는 곳 |
|---|---|---|
| `core/edits.js` | propose 의 `EDIT_MAX` · `EDIT_CHARS` · `validEdits` · `locate` · `nearest` · `applyEdits` | propose · gate · fix · save |
| `core/values.js` | `HASH_RE` · `REC_ID_RE` · `NOT_KNOWLEDGE`(+넣은 것 · 넣지 못함) · `knowledgeParts` · `ARROW_RE` · `MUST_PARTS` · `mustValues` · `oldValues` · `namesIn` · `groundedIn` + 새 `valueDiff(old, new)` · `arrowsOf(body)`(「A → B」 짝) | gate · fix · save · propose |
| `core/writerules.js` | `WRITE_RULES`(작성기준 3 ~ 5절 줄임 · K1-3 과 맞춤) | ingest · fix · send |
| `core/gate.js` | `draftLint` · `draftBad` · `applyDraft`(옛 tidy `applyEdits(cur,d)`) · `checkSection(k, { coord, base, content, record, spread, legacyPend })`(옛 check 의 section 갈래 · `pendNow` 는 `legacyPend` 일 때만) · `checkIngest` · `check`(옛 갈래 나누기, 전환 동안만) | propose · hub.save prepare · 들이기 · tidy(전환) |
| `core/ingest.js` | `INGEST_SCHEMA` · `ingestCandidates` · `formsOf` · `kindOfName` · `topicOfName` · `spotKey` · `spotTarget` + (S7) `INTAKE_SCHEMA` · `intakePromptOf` · `intakeFixPromptOf` · `draftToSave` · `FIX_SCHEMA` · `fixPromptOf` · `POLISH_SCHEMA` · `polishPromptOf` · `supersededIngest(k)`(옛 curate R-A3) | 일꾼 · hub 들이기 · 보내기 |
| `core/revert.js` | `revertPlan(k, recordId, { doc, heading })`(거르기 더함) | hub.revert |
| `core/parts.js` | 새: `PUT_PART` · `HELD_PART` · `renderPut` · `parsePut` · `renderHeld` · `parseHeld` · `dropPart` | save · views · hub |
| `core/fix.js` | 새: `ruleFix(k, rec, { from, to })` · `targetsOf(k, rec)` | hub.fixRecord |
| `core/pcplace.js` (S13) | tidy 의 section · touches 갈래(`material` ①②③ · `DRAFT_SCHEMA` · `TOUCH_SCHEMA` · section `promptOf` · `PATCH_*` · `planSave` section · touches) + PC 파일 들이기의 `ingestRule`(hub 2640 · 그것이 쓰는 `kindOfName` · `topicOfName` 은 `core/ingest.js` 에서 import) | PC `placeGroup` · `curatePending` · `ingestNow` 만 |

- `core/curate.js` 의 `decisionRecord` 는 **`core/parts.js` 로** 옮긴다(제목 「버림: …」 · 태그 `drop` · S-D25). `decide` 의 R-A1 · R-A2 · `tasks` 는 S13 에서 걷고, R-A3 은 `supersededIngest` 로 옮긴다. R-A3 은 **옛 기록이 held 이거나, 새 기록의 `fixes` 가 옛 기록을 가리키면 건너뛴다**(바로잡힘을 「버림」 으로 바꾸지 않게 · S-D4 ① 이 `fixed` 를 `kept` 보다 먼저 보는 것과 겹으로 · 검토 D4).
- 순환: `values.js` 가 `valuesOf` 를 `save.js` 에서, `save.js` 가 `valueDiff` · `NOT_KNOWLEDGE` 를 `values.js` 에서 가져오는 순환은 둘 다 **함수 안에서만** 쓰면 무해하다(ES 모듈 순환은 모듈 최상위에서 상대 `const` 를 읽을 때만 TDZ). 그래도 S2 에서 `valuesOf` 를 `values.js` 로 옮기고 `save.js` 는 다시 내보내기만 한다(규칙이 하나 덜 필요하다). `HUMAN_ANSWER` 는 `test/edit.test.mjs:16` 과 같이 S13 에서 걷는다.
- S2 에서는 `tidy.js` · `curate.js` · `propose.js` 가 옮긴 이름을 **다시 내보내기만**(`export { mustValues, oldValues } from './values.js'`) 해서 부르는 곳을 바꾸지 않는다.
- **S2 에서 실제로 한 것(코드와 맞춤)**: 옮김은 표대로이고, 몇 가지는 뒤 단계로 넘기거나 표와 다르게 했다. ① `core/gate.js` 의 새 꼴 `checkSection(k, { coord, base, content, record, spread, legacyPend })` 는 아직 없다. S3 · S4 가 저장 문과 함께 더한다. 옛 check 의 section 갈래는 이름을 `checkSectionDraft(k, g, d)` 로 옮겼다. 정리 묶음 g 를 그대로 받으며, S13 에 `check` 와 함께 걷는다. ② `valueDiff` 는 S3(그 단계 파일 목록)에, `arrowsOf` 는 처음 쓰는 단계(S9 `ruleFix`)에 더한다. ③ `revertPlan` 의 `{ doc, heading }` 거르기 · `base` · `remove` 는 S5 몫이다. S2 는 그대로 옮기기만 했고, `git log` 실패를 삼키던 `.catch(() => '')` 와 앞 판 `git show` 실패를 삼키던 `() => null` 에 로그 한 줄씩을 더했다(되돌리는 값은 그대로 · S2 검토). ④ R-A3 은 S2 에 `core/ingest.js` `supersededIngest(k)` 로 옮겼다. 줄마다 `by`(새 판 id)를 달아 `decide` 가 옮기기 전과 같은 차례로 싣는다. held · `fixes` 건너뛰기는 S3 이다. ⑤ `gate.js` 는 edits · values 말고 `ingest.js` 의 `docRel` 도 부른다. ingest.js 는 text · guard 만 부르는 잎 모듈이라 순환이 없다. ⑥ `core/codechange.js` 도 `valuesOf` 를 `values.js` 에서 직접 부른다(save.js 를 거치지 않게). ⑦ `server/hub.js` 는 `decisionRecord` · `revertPlan` · `check` · 들이기 이름을 새 모듈에서 직접 부른다. `core/worker.js` 와 시험은 옛 이름 그대로 둔다.

### 3-2. `core/save.js`

- `save(dir, input, { user, now, system, agent, guard, holdWhy, proposed, prepare, onCommit, partial, asEdit, structure, correction, intake, attach })`
  - `asEdit`: 비system 에서 `edit` 태그 하나만 허용(keepBlocks · 표 표지 · watched 검사는 비system 그대로).
  - `structure`: remove · rename 허가. `hub.edit` 이 `levelFor === 'admin'` 일 때만 넘긴다(S-D44 · `asEdit` 만으로는 열리지 않는다).
  - `correction`: `isTouchesFix` 를 건너뛴다. 서버가 정한다(S-D17).
  - `intake`: 예약 사람 `kmd` · 저장 문이 붙이는 예약 태그 · `kmd` 저장의 참고 줄(S-D43).
  - `prepare()`: `serial` 안 · `recover(dir)` 다음 · `saveNow` 직전에 부른다. hub 쪽이 줄 안에서 지식을 새로 읽는다(S-D7). 돌려준 `sections` 는 `guardSections` 를 다시 거친 뒤(S-D44) 저장하고 `held` 는 기록에 싣는다. `{ abort:{ same, id } }` 면 아무것도 쓰지 않고 `{ same:true, id }` 를 돌려준다(S-D16).
  - `onCommit()`: 커밋 · `j.done()` 뒤, 줄을 놓기 전에 부른다(hub 의 `cache.delete`). 던져도 log 만.
- `saveNow` 바뀌는 곳
  0. 줄 첫머리에서 `recover(dir)`(지금은 검사 뒤 `begin()` 안에서 돈다 — 남은 저널을 되돌리기 전에 판정하는 창을 닫는다 · 검토 R-18).
  1. `partial` 이면 302(E_NOTFOUND) · 327 ~ 331(watched) · 349(E_FORMAT)를 그 항목 held 로(S-D8). 333 ~ 338(지문)은 prepare 가 새 글로 먼저 걸렀고 같은 줄 안이니 여기 오면 throw(경쟁 없음).
  2. 기록에 태그: held 가 있으면 `held`, 넣은 항목이 있으면 `put`, `memo` 면 `memo`(입력 태그로는 받지 않는다 · 예약).
  3. 본문 끝에 `renderPut(putRows)` · `renderHeld(held)` 를 붙인 뒤 기록을 쓴다(저널 안 · 다시 읽어 대조 그대로 · 붙인 뒤 길이 상한 S-D45).
  4. `attach` 를 같은 저널에 `assetPath` 로 쓰고(같은 sha 면 건너뜀 · 다르면 E_CONFLICT · S-D30) `commitPaths` 경로에 더한다.
  5. 응답에 `put` · `held` · `putRows`.
  6. `catch` 의 `j.undo()` 실패는 log · HEAD 가 움직였으면 되돌리지 않는다(S-D49).
- `check()`: `record.memo`(불리언) · `attach`(배열 · 경로 · 크기) 모양 · 본문의 예약 칸 머리(S-D45)를 본다. `sections[].edits` 는 core 까지 오지 않는다(hub prepare 가 content 로 바꾼다).
- `saveRecords(dir, records, { …, serverTags, heldPart })`: 입력 검사(예약 태그 거절) 뒤 저장 문이 `held` 태그와 `## 넣지 못함` 칸을 붙인다(`/receive` · S-D36).
- `names.js`: `isReservedTag` 가 `job/` 접두사도 예약으로 본다.
- `errors.js`: `E_RATE: 429`.
- **S3 에서 실제로 한 것(코드와 맞춤)**: 위 옵션 · 칸 · 상태는 모두 core 에 들어갔다. 다음은 표와 다르게 했거나 뒤로 넘겼다. ① `put` · `## 넣은 것` · 넣지 못함 칸은 **`partial` 이나 `intake` 를 준 저장만** 쓴다(그 밖의 저장은 옛 결과 그대로 · S3 끝 기준). S4 의 `hub.save` 는 팀에서 `partial:true` 를 넘긴다. 항목 50 개 상한도 새 저장 문(`prepare` · `partial` · `intake`)에서만 센다. ② 사람 입력 본문의 `## 고친 조각` 거절은 **S4** 로 넘겼다. 지금 `hub.save` 가 제안을 그 칸에 실어 core 에 보내기 때문이다(S4 가 그 길을 걷을 때 같이 켠다). 지금 거절하는 머리는 넣은 것 · 넣지 못함 · 되돌린 항목 셋(`core/parts.js` `KMD_PART_RE`)이다. ③ `recordState` ⑥(`k.reverted` → `'reverted'`)은 **S5** 로 넘겼다. 지금 되돌리기는 원 기록을 「다시 대기」 로 두고(화면 알림 · `edit` · `tidy` 시험이 그렇게 단언한다), ⑥ 은 되돌리기 화면 · 길을 바꾸는 S5 와 한 커밋이어야 한다. ⑦(`put` 기록의 되돌림)은 지금 켰다. ④ `## 되돌린 항목` 줄은 `- <원 기록 id>: docs/x.md › 머리` 꼴이다(항목 하나 되돌림은 `reopens` 를 달지 않으므로 원 기록을 줄에 싣는다). `k.revertedItems` 의 열쇠는 그 원 기록 id 다. `## 넣은 것` 에서 한쪽 값이 없으면 `—` 로 적는다. ⑤ 첨부는 옵션이 아니라 저장 덩이 `input.attach` 로 받는다(2-1 과 같이). core 는 한 저장 20 개 · 파일 하나 32MB 만 보고, 채널 한도(MCP 합 8MB · 하루 합)는 hub 가 본다(S4 · S8). ⑥ `intake` 옵션은 `{ tags }` 이고 `intake` 태그는 늘 붙인다. ⑦ 「개편 전 기록」 판정은 `isLegacy(k, w)`(knowledge.js)로 내보냈다. 작성자가 예약 사람이면 빼고, 팀인지는 부르는 쪽(S10)이 가린다. ⑧ `commitPaths` 가 던졌는데 HEAD 가 움직였으면 되돌리지 않고 그 HEAD 를 커밋으로 돌려준다(로그 한 줄). ⑨ core 의 응답에 더한 칸: `put`(수) · `putRows` · `held`(edits · content 를 뗀 줄) · `memo` · `attach { put, same }` · prepare 가 실은 `proposals` · `warnings`. ⑩ (S3 검토) 가드 G3 의 「자리가 있는 기록」 은 넣지 못함 줄(저절로 채우는 표 · prepare 의 held 처럼 `doc` 이나 `coord` 가 있는 것)도 센다 — 모든 항목이 넣지 못함이어도 strict 에서 「이름 없는 기록」 으로 넘어지지 않는다. 칸 머리 거절은 줄 끝 `\r` 도 본다. `hub.js` 의 에이전트 저장 태그 거르기는 `isReservedTag`(접두사 `job/` 까지)로 바꿨다.

### 3-3. `hub.save` 다시 쓰기 (S4)

```
hub.save(ctx, id, input, opt = {}):
  ctx.agent 갈래(PC 넣기 에이전트) ............ 그대로
  meta = hub.meta(id, ctx) · machine 열쇠 지식 확인 · need(ctx, id, 'write')   // intake 는 intakeCtx(S-D43)
  rateTake(ctx, id, opt) ...................... E_RATE (system · intake · agent 빼고 · 동기로 토큰을 뺀다)
  opt.form → recordBody(memo 면 changes 선택)
  backup.closed → E_BEHIND
  memo 인데 sections → E_INPUT
  fixes 대상마다: 내 기록 || levelFor === 'admin' 아니면 E_FORBIDDEN(S-D17) · correction 을 서버가 정한다
  sent/ 태그인데 channel !== 'send' → E_INPUT
  (S13 부터) 팀 · channel 이 session/http/edit/fix/send · sections 없음 → memo 저절로(S-D3)
  sections 판정은 canSave · names/forms 는 canDirect 아니면 「## 세울 이름/갈래」 칸 + held part `names`(S-D6 · S-D51)
  prepare = async () => {                                   // serial 줄 안 · recover 다음
    k = await loadKnowledge(meta, { cache: files.get(id) }) // hub.get 캐시를 쓰지 않는다(S-D7)
    s = sameKey(k, input.record, ctx.user)                  // S-D16 · job/ 도(S-D48)
    if (s) return { abort: { same: true, id: s } }
    return mode === 'team' ? gatePrepare(k, input, opt) : { sections: input.sections }   // S-D52
  }
  r = coreSave(dir, { record, sections: input.sections ?? [], names, forms, attach },
               { user, guard, prepare, partial: mode === 'team', correction, intake, structure,
                 onCommit: () => cache.delete(id) })
  ── 여기부터 던지지 않는다(S-D49): 하나씩 try/catch + hub.log ──
  savelog(id, line)                                         // meta 를 넘은 뒤만
  feed.add(ctx.user, { kind:'save', rec, dot: held ? 'warn' : 'ok', small: `넣음 n · 넣지 못함 m` })   // 본인 줄만 · 남에게 알리지 않음
  scheduleDecide(id) 는 ingest/ 저장 뒤에만 · 백업 3초 · 응답(2-4)

gatePrepare(k, input, opt):                                 // 팀만 · 쓰지 않는다 · 같은 serial 키를 잡는 것을 부르지 않는다
  for s of input.sections:
    sec = 지금 항목(coord → locate · doc+heading)
    이미 있는 항목인데 base 없음 → stale
    edits: p = checkProposal(k, { coord | doc+heading, base, edits, record, spread: n>1 })   // S-D55
           p.stale → stale(채널이 intake 면 새 글에 같은 edits 를 한 번 다시 대 본다 → 되면 base 갈아 넣고 계속)
           !p.ok → held(code · 섞인 자리면 legacy-mix)
           p.ok → { …, content: p.text, base }
    content: base 대조 → 어긋나면 intake 채널은 held('conflict')(다시 대지 않는다 · S-D9), 아니면 stale
             · checkFormat · (edit · system 이 아니면) checkSection 값 대조
    값을 바꾸는 조각 && recentReverts(doc) ≥ 2 → held('reverts')
    baseline 블록: splitBlocks(옛) 과 새 글의 블록이 다르면 held('machine'), 같으면 블록을 뗀 글로(keepBlocks 가 되붙임)
  stale.length && !opt.intake → throw E_CONFLICT { stale, proposals }   // 아무것도 쓰지 않았다
  빠진 값(spread): 모든 새 글을 합친 데서 mustValues(record) 를 한 번 본다 → 없으면 기록 단위 held part(coord 없음 · code 'values' · S-D51)
  return { sections, held, proposals }

hub.checkSave(ctx, id, input, opt) = need + serial 줄 안에서 prepare 만(쓰지 않음 · 들이기 고쳐 쓰기 판정)
```

- `saveNow` 는 prepare 가 돌려준 `sections` 에 `guardSections`(S-D44)를 다시 돌린 뒤 쓴다 — `sections: input.sections` 를 넘겨도 core 의 입력 검사는 edits 를 모르므로, hub 는 `save()` 앞에서 입력 `sections` 의 모양(edits 칸 포함)을 따로 본다.
- `checkProposal`(propose.js): `waits` · `sentencesOf` 를 걷고 `{ ok, why, code, stale, near, changed, warnings, lint, text }` 를 돌려준다. 89 의 「정리가 자리를 고른다」 는 「새 항목이면 doc · heading 과 content 로 보낸다」 로. 96 ~ 98 의 「섞인 자리」 는 `legacyPend`(같은 coord · 같은 doc+heading 의 「개편 전」 `pend` 이면서 `## 고친 조각` 이 없는 기록)만 세고, held · memo · fixed · reverted 는 뺀다. 같은 조건을 `checkSection` 의 `pendNow` 에도.
- 걷는 것(S4): 754 ~ 801 의 queued 갈래(sections 부분) · 771 review → apply · 805 ~ 811 `applyProposals` 부르기 · 818 ~ 822 의 `scheduleDecide` 는 `ingest/` 저장 뒤에만. 816 `hub.pendText` · `liveSoon` · `curateSoon` 은 S13 까지 둔다(그때까지 조각 없는 사람 기록은 `pend` · S-D3).
- `hub.applyProposals` · `/proposal/:rec/put` · 제안 알림(914)은 S4 에서 화면 [넣기] 와 한 커밋으로 걷는다(waits 를 걷는 순간 [넣기] 가 부를 것이 없어진다 · screen-kmd A8 도 S4 에서 고친다).
- **S4 에서 실제로 한 것(코드와 맞춤)**: 위 의사 코드대로 `hub.save` 를 다시 썼다(`saveIn` · `gatePrepare` · `rateTake` · `sameKey` · `savelog` · `hub.canSave` · `hub.checkSave` · `applyProposals` 와 그 길 · [넣기] · 「제안 있음 · 확인 대기」 칩을 걷음). 다음은 의사 코드와 다르게 했거나 뒤로 넘겼다. ① 쓰기 자리의 `names` · `forms` 는 지금처럼 기록의 「세울 이름 · 세울 갈래」 칸에만 싣고 넣지 못함 part(`names`)는 **달지 않았다** — 권한 모델 7절이 그 표지를 S7(화면 S10)로 적었고, 지금 달면 기록이 `held` 가 되어 정리 재료에서 빠지는데 볼 화면이 없다. 응답 `namesHeld` · note 는 남겼다. ② 이름 장부로 자리가 안 서는 `coord` · 없는 문서는 지금처럼 **저장 전체 `E_NOTFOUND`**(입력 오류 · 아무것도 쓰지 않음)다. 없는 문서는 지식관리자(`canDirect`)의 `content` 조각만 새 문서로 세운다(core G4). 항목 단위 `notfound` held 는 아직 없는 머리에 `edits` 를 댄 조각에만 쓴다(들이기 채널의 notfound held 는 S7). ③ 속도 한도는 **바깥에서 온 저장**(`opt.channel` 이 session · bulk · http · send)만 센다. 채널 없이 부르는 서버 안의 저장(파일 넣기 `importFiles` · 받은편지함 옮기기 · 되돌리기)은 세지 않는다(파일 넣기 한 번이 300 저장을 할 수 있다). ④ `checkSection` 은 크기 검사(G5 「근거보다 크게」)를 하지 않는다 — 사람 · 세션이 항목 전체를 다시 쓰는 일은 정리 초안과 다르다. 저절로 채우는 표의 값은 값 대조에서 뺀다(표는 `keepBlocks` 가 되붙인다). 표를 바꾼 글은 `machine`. ⑤ 조각이 지금 글에 꼭 한 번 맞지 않으면 까닭 `edits`(2-2 에 더함). ⑥ 저장 문이 넣은 기록(`put`)을 옛 되돌리기(통째 · `reopens`)로 거두면 `recordState` 가 `'reverted'` 를 돌려준다(⑦ 갈래 안 · `k.reverted`) — 「들어감」 으로 남지 않게. `put` 이 없는 옛 기록의 ⑥ 과 화면 알림은 S5 그대로(`edit.test` 되돌리기 시험은 put 기록이라 `'reverted'` 를 단언한다). ⑦ `hub.edit` 과 화면 문서 `direct`(http.js)는 바꾸지 않았다(S9) · MCP `you.direct` 는 `canSave`. ⑧ MCP `recOut.state` 말에 넣지 못함 · 메모 · 바로잡힘 · 되돌림 · 버림을 더했다(「문서에 들어감」 으로 보이지 않게 · 나머지 상태 말은 S10). ⑨ MCP `save` 의 「base 없는 이미 있는 항목」 앞 검사는 개인 프로그램만 한다 — 팀은 저장 문이 줄 안에서 같은 것을 보고 `details.stale` 를 싣는다. MCP 오류 응답 · HTTP 오류 응답에 `details` 를 싣고 `E_RATE` 는 `Retry-After` 머리. ⑩ 첨부는 `input.attach` 를 core 로 넘기기만 한다. MCP 도구 모양 · 8MB 합 · 하루 합 · `readBody` 12MB 는 S8 · S11. ⑪ `intake` 채널의 「edits 를 새 글에 한 번 다시 대기」 는 S7(지금 `gatePrepare` 는 `intake` 면 stale 을 held `conflict` 로만). ⑫ savelog 의 `conflictWith` 는 늘 빈 목록 · `cost` 는 `null`(S6 의 `scripts/savelog.mjs` 와 같이 채운다). ⑬ `correction` 은 `fixes` 가 모두 내가 볼 수 있는 held · memo 기록일 때 참(S-D17). ⑭ `/tree` 응답에 `held` 수. ⑮ `scheduleDecide` 는 `ingest/` 저장 뒤에만(사람 기록의 R-A1 · R-A2 는 S13 에 걷힌다). ⑯ 사람 입력 본문의 `## 고친 조각` 은 이제 `E_INPUT`(`core/parts.js` `KMD_PART_RE`). `renderProposals` · `parseProposals` 는 옛 기록 읽기를 위해 S13 까지 남긴다. ⑰ (S4 검토) MCP `save` 설명에 남아 있던 「팀 지식은 항목 글을 바로 넣지 않는다 · 정리 때 문서에 들어간다」 를 걷었다(같은 설명의 「검사를 넘으면 그 순간 넣는다」 와 어긋났다). 도구 모양의 `record.required` 에서 `changes` 를 뺐다 — 메모(`memo: true`)는 changes 없이 받는다고 적어 놓고 모양이 막고 있었다(메모가 아니면 서버 `recordBody` 가 그대로 E_INPUT). `fixes` 검사의 `hub.get` 에 ctx 를 넘긴다(CLAUDE.md 「권한」).

### 3-4. 이력 · 되돌리기 (S5)

- `hub.history(ctx)`:
  - `l:` 줄 = `k.logs.slice(0,300)` + `k.works.filter(w => w.tags.includes('put'))`(칸은 마지막 `## 넣은 것` 만 · S-D45) 를 날짜순으로 합쳐 300.
  - 줄 꼴 `{ id:'l:'+kn+':'+rec, kn, rec, date, author, title, kind, items:[{ doc, heading, from, to, isNew }], canRevert }`.
  - `canRevert` = `levelFor ≥ write && (levelFor === 'admin' || w.author === ctx.user)` 이고 아직 그 항목의 applied 가 그 기록인 것만(`items[i].live`).
  - 본인 feed 줄(`kind:'save'`, `rec`)과 겹치면 feed 줄을 뺀다(`logIds` 에 work id 를 더함).
- `views.logKind(w)`: `edit` → 「고침」 · `revert` → 「되돌림」 · `polish` → 「다듬기」 · `drop` → 「버림」 · `intake` → 「들이기」 · `sources` → 「가져오기」(지금) · `put` 태그 work → 「저장」 · `curate-*` → 「정리」(옛 기록).
- `hub.revert(ctx, id, { record, doc?, heading? })`: 권한 S-D13 · `revertPlan(k, record, { doc, heading })`(항목마다 `base` · 앞 판이 없으면 `remove:true` · S-D53) · 쓰기 자리면 watched · 표 블록 항목 E_FORBIDDEN · 본문 끝 `## 되돌린 항목` · 항목 하나면 `reopens` 없이 · 태그 `revert` · 알림 없음 · 실패는 `hub.log`.
- http `POST /api/k/:id/revert`: 몸 `{ record(≤80 · id 꼴), doc?(≤300 · docs/ 아래 md), heading?(≤200 · 한 줄) }` 모양 검사 → 400.
- **S5 에서 실제로 한 것(코드와 맞춤)**: 위대로 `hub.history` · `hub.revert` · `revertPlan(k, rec, { doc, heading })` · `logKind` · http 몸 검사 · 화면 `histItem` · `revertItem` 을 넣었다. 다음은 위와 다르게 했거나 더 정했다. ① `revertPlan` 은 git 을 읽지 못하면 빈 글로 되돌리지 않고 `E_GIT` 으로 던진다. 표지를 단 묶음을 찾지 못하면(손으로 달고 커밋하지 않은 표지) `E_CONFLICT` 다. 앞 판을 모르는 채 항목을 비우거나 지우지 않게 하려는 것이다. 앞 판에 문서가 없거나(`ls-tree` 빈 답) 첫 커밋이면 `remove:true` 다. ② `base` 는 `revertPlan` 이 읽은 지식의 지금 글로 잰다. 그 뒤 누가 **저장으로** 고쳤으면 표지가 바뀌어 계획에서 빠진다. 그래서 「그 뒤 누가 고쳤다」 는 대개 `E_CONFLICT` 「그 항목은 이미 되돌렸거나 그 뒤 누가 고쳤다」 로 끝나고, `base` 는 계획과 저장 사이에 바뀐 경우를 막는다. ③ `{ record }` 만 주면 통째 되돌림이다. 지금처럼 `reopens`(정리 기록이면 「넣음」 줄의 기록까지)를 달고, 정리 넣기의 노란 줄에 「되돌렸다」 를 표시한다. 화면 `revertToday` 는 정리 넣기 알림이 남는 S13 까지 둔다. `{ record, doc[, heading] }` 은 그 항목(들)만 되돌리고 `reopens` 를 달지 않는다. `heading` 없이 `doc` 만 주면 그 문서의 항목 모두다. 두 경우 모두 태그 `revert` 와 본문 끝 `## 되돌린 항목` 을 단다. 제목은 통째면 `되돌림: <원 제목>`, 항목이면 `되돌림: <문서> › <머리[ · 머리]>` 다. 함께 든 기록 주인에게 보내던 알림은 걷었다. 커밋 뒤 표시 실패는 log 로 남긴다. ④ `recordState` ⑥ 을 켰다. 옛 기록도 통째로 되돌리면 `'reverted'` 다(다시 대기 `pend` 로 떨어지지 않는다). 그래서 `tidy` 되돌리기 시험의 단언을 `'reverted'` 로 바꿨다. 정리 재료(`state==='pend'`)에서도 빠진다. 전에도 `k.reverted` 로 다시 초안하지 않았으므로 뜻은 같다. ⑤ 이력 줄은 `put` 기록 말고 **넣지 못한 기록**(`held` · `put` 없음)도 갈래 「넣지 못함」 으로 싣는다. 단, 쓴 사람과 지식관리자에게만 싣는다(넣지 못함 목록과 같은 거르기). 줄 칸은 `items:[{ doc, name, heading, from, to, isNew, live, reverted }]` · `canRevert`(자리가 되고 `live` 항목이 하나라도 있을 때) · `yl` 이다. `yl` 은 날짜 순으로 그 항목에 마지막으로 넣은 `put` 기록을 따라가서, 앞 것이 내 것이고 이번 것이 남의 것일 때 켠다(「내 값이 바뀌었다(누가 바꿨든)」). 받음 같은 feed 줄이 같은 기록을 잡으면 그 줄에 `items` 를 붙인다. `hub.get` 에 ctx 를 넘긴다. ⑥ 화면 「확인할 것」 은 컨벤션 9절대로 「값 바뀜」 이 되었다. `HIST_KINDS` 에 「버림」 도 넣었다(S10 이 `drop` 을 쓰면 바로 보인다). ⑦ 되돌림 세기를 `revertsOfDoc(k, doc)` 하나로 합쳤다(정리 `recentReverts` · 저장 문 `revertsIn`). 이제 문서 경로로 정확히 센다. 새 기록은 `## 되돌린 항목` 의 경로로, 옛 기록은 본문 줄 「- <이름> › 」 의 시작으로 본다. 그래서 「배포 / 배포절차」 처럼 이름이 다른 이름 안에 든 문서가 같이 세어지던 것(S4 검토)이 풀렸다. ⑧ 지식관리자가 아닌 사람의 표 블록 막기는 이렇게 본다: 지금 글과 되돌릴 글의 baseline 블록(`splitBlocks`)이 다르면 막는다. 블록이 그대로인 항목은 되돌린다. ⑨ http 몸 검사는 이렇다. `record` 는 경로 글자 · 빈칸이 없어야 한다. `doc` 은 `docs/…/x.md` 꼴이고 `..` 가 없어야 한다. `doc` 없이 `heading` 만 오면 400 이다. ⑩ `wp6` 의 MCP base 시험은 S4 ⑨(팀은 저장 문이 `E_CONFLICT`)부터 HEAD 에서도 깨져 있었다. 이번에 그 글을 새 오류 글에 맞췄다. ⑪ `docs_ops/kmd_서비스_전체.html`(그림 판)은 「개편 전」 띠를 단 채 그대로 두었다. ⑫ (S5 검토) 머리가 다른 머리 안에 든 항목(「배포」 · 「배포 절차」): `revertPlan` 은 같은 머리가 있으면 그것만 거르고(없을 때만 머리 맞춤), 앞 판의 항목도 같은 머리로만 찾는다(앞 판에 「배포 절차」 만 있으면 「배포」 는 그 기록이 세운 항목이라 `remove`). 이력 `live` 와 저장(`core/save.js` 지문 · 옛 값, `core/sections.js` 갈아 끼우기 · 지우기 · 이름 바꾸기)도 새 `findHeading`(같은 머리 먼저 · 없으면 머리 맞춤)으로 찾는다. 되돌림 기록 줄의 항목에는 「그 뒤 다시 바뀜」 을 달지 않는다(표지를 앞 기록에 돌려 두어 `live` 가 늘 아니다). 남은 것: 문서에 「배포 절차」 만 있을 때 새 머리 「배포」 를 넣으면 `headingMatches` 의 「머리 + 빈칸」 맞춤이 「배포 절차」 를 집는다. 저장 길 전체의 머리 맞춤 규칙이라 뒤 단계(S9 · 고치기 길을 저장 문으로 옮길 때)에 본다. ⑫ (S5 검토) 머리가 다른 머리 안에 든 항목(「배포」 · 「배포 절차」): `revertPlan` 은 같은 머리가 있으면 그것만 거르고(없을 때만 머리 맞춤), 앞 판의 항목도 같은 머리로만 찾는다(앞 판에 「배포 절차」 만 있으면 「배포」 는 그 기록이 세운 항목 · `remove`). 이력 `live` 와 저장(`core/save.js` · `core/sections.js` 의 갈아 끼우기 · 지우기 · 이름 바꾸기 · 지문)도 새 `findHeading`(같은 머리 먼저)으로 찾는다. 되돌림 기록 줄의 항목에는 「그 뒤 다시 바뀜」 을 달지 않는다(표지를 앞 기록에 돌려 두어 `live` 가 늘 아니다). 남은 것: 문서에 「배포 절차」 만 있을 때 새 머리 「배포」 를 넣으면 `headingMatches`(「머리 + 빈칸」 맞춤)가 「배포 절차」 를 집는다 — 저장 길 전체의 머리 맞춤 규칙이라 뒤 단계(S9 고치기 길을 저장 문으로 옮길 때)에 본다.

### 3-5. 들이기 엔진 (S7)

일꾼 ↔ 서버 계약(`kmdw_` 일꾼 열쇠 → `kmdd_` 일감 열쇠, 지금 원리 그대로):

| 길 | 몸 · 답 |
|---|---|
| `POST /api/worker/next` | 답 `{ job:{ id, kn, kind:'intake', type }, key: 'kmdd_…' }` · 사람이 연 일감(`auto:false`) 먼저 |
| `GET /api/k/:kn/worker/intake` | 답 `g = { type, src:{ title, author, date, file?, md, commit?, rec?, draft?, doc? }, docs: ingestCandidates(…)(항목마다 h · body 1500자 · base), forms, names: 이름 장부 앞 200, kinds }` |
| `POST /api/k/:kn/worker/intake/progress` | 지금 `workerProgress` 와 같은 꼴(소식 · 비용 · 토큰) |
| `POST /api/k/:kn/worker/intake/done` | 몸 `{ draft, cost }` → 서버가 `job.tries` 를 올리고 `last = job.tries ≥ ingestFix + 1`(본문의 tries · last 는 믿지 않는다) → `draftToSave(k, g, draft)`(g 의 후보 · 지문은 재료를 줄 때 적은 `job.seen`) → `last` 가 아니면 `hub.checkSave` 로 마른 검사 → 넣지 못함 `code` 가 values · format · edits 면 `{ fix: why }` · 아니면(또는 last) `hub.save(intakeCtx(job), …, { channel:'intake-*', intake:{ job, tags, held, cost, warn } })` → `{ ok, put, held, rec, same? }` |
| `POST /api/k/:kn/worker/intake/fail` | 몸 `{ why(한 줄 ≤200), code }`(허용: login · limit · missing · budget · timeout · fail · shape — S7 ②) → login · limit · missing 은 다시 기다림 · 그 밖은 한 번으로 세어 마지막이면 기록만 + held(code `claude`) · 아니면 `{ retry }` |

모든 `/worker/intake*` 는 POST(재료 GET 은 빼고) · `:kn` 은 `dec()` · `ctx.draft.kn === kn` · 일감 type 확인(S-D54). 재료 길은 `noClaude` 지식이면 거절(S-D47).

- `INTAKE_SCHEMA`(`claude -p --json-schema`):

```js
{ record: { title, body },                                   // 기록: 「무엇: 어떻게」 · 서식 칸(바뀐 것 · 근거 …) 꼴
  updates: [{ doc, heading, base, edits?: [{ find, replace }], content? }],   // 있는 항목: 조각(edits) 먼저 · 절반 넘게 바뀌면 content
  newDoc: { path, sections: [{ heading, content }] } | null, // 새 문서: ## 항목으로만(S-D31)
  names: [{ name, kind }],                                   // K14-2
  why }
```

- `draftToSave`: `record` 에 원천 태그(`ingest/<경로>` · `md/<지문>` · `fixes:[rec]`)를 붙이고(예약 태그 `intake` · `job/<jid>` · `code-change` · `polish` 는 `intake` 옵션으로 저장 문이 붙인다 · S-D43), `updates` → `sections[{ doc, heading, base, edits|content }]`, `newDoc` → `sections[{ doc: path, heading, content }]` 로 바꾼다. 후보 밖 문서를 고치면 그 조각은 held(code `notfound`). 정리 시절의 「정리: <파일> 들임」 둘째 기록과 `reflects` 는 만들지 않는다.
- 프롬프트 첫 줄(가짜 claude 갈래와 맞춘다): 들이기 `넣을 것을 지식에 들인다`, 정정 `정정 기록 하나를 항목에 반영한다`, 다듬기 `문서 하나를 다듬는다`. 모두 `WRITE_RULES` 를 싣는다.
- `core/worker.js`: `workOnce` 의 `many` · batch · patch · touches 를 걷고 `intakeOnce(job)` 하나로: material → `runClaude` → done → `{fix}` 이면 `intakeFixPromptOf(g, draft, why)` 로 다시(최대 `KMD_INGEST_FIX`) → 마지막. 일꾼 열쇠 · 임대(`JOB_LEASE`) · `slots` · `sweepProjects` · 멈춤(login · limit · missing)은 그대로.
- 다시 켤 때: `running` 일감은 `queued` 로(지금 규칙) — 단 같은 `job/<jid>` 기록이 이미 있으면 done 으로 닫는다(S-D48) · `tries ≥ 3` 은 기록만 + held(code `claude`).
- 일감은 모두 `hub.openJob`(S-D47)으로 세운다 — 원천마다 하나 · 사람마다 queued 상한 · 하루 상한 · `noClaude`.

### 3-6. 기록 고치기 규칙 (S9 · K4-3)

```
targetsOf(k, rec): k.docs 의 sections 가운데
   logHas(sec.log, rec) || sec.applied === rec || reflectedIn(k, k.byWork.get(rec), sec)
ruleFix(k, rec, { from, to }):
   from · to 가 없으면 → 모든 target 이 left
   target 마다: body 안에 from 이 글자 그대로 꼭 한 번 && valuesOf(body) 에 from 이 있음
                → edits [{ find: from, replace: to }] (locate 로 위치 확인 · applyEdits)
                아니면 left(여러 곳 · 없음 · 문장 바뀜)
   → { sections:[{ doc, heading, base, edits }], left:[{ doc, heading, base, why }] }
```

- `hub.fixRecord(ctx, id, rec, { title?, body, from?, to? })`
  - 판정: `need(ctx,id,'write')` · 원 기록 `author !== ctx.user` 면 `need(ctx,id,'admin')` · 원 기록이 `k.byWork` 에 없거나 log 기록이면 404.
  - 정정 기록 초안: `{ title: '정정: ' + 원 제목(200에서 자름), body: body + '\n\n## 바뀐 것\n- ' + from + ' → ' + to, fixes:[rec], touches: 원 touches }`.
  - target 이 없으면 → 정정 기록만 + held(code `nosec` 「원래 기록이 들어간 항목을 찾지 못했다」).
  - `left` 가 없으면 → `hub.save(…, { channel:'fix' })` 한 번(사람 이름 저장 · 참고 줄이 정정 기록을 가리킨다 · C-2 함정).
  - `left` 가 있으면 → 저장하지 않고 들이기 일감 `{ type:'fix', rec, draft, targets }`. 일꾼은 target 마다 `FIX_SCHEMA = { updates:[{ doc, heading, base, edits }] }` 를 짓고, 서버는 규칙으로 된 조각 + 일꾼 조각을 **한 저장**으로.
  - 답: `{ id?, put, held, job? }`.

---

## 4. 채널별 설계

### 4-1. 세션 (K3)

- `agent/team/skills/kmd-team-save/SKILL.md` 4단계를 다시 쓴다.
  - 항목 글이 바뀌었으면 **늘** `sections:[{ coord, base, edits }]` 를 같이 보낸다. `base` 는 `section` 으로 읽은 지문.
  - 저장 전에 「이 값은 확정인가(머지 · 배포 · 결정)」 를 사람에게 묻는다. 아니면 `record.memo: true` 로(항목 글은 보내지 않는다).
  - 답의 `proposals[].ok === false` 면 `why` 를 읽고 그 자리에서 조각을 고쳐 **다시 저장**한다. 이때 `record.fixes: [앞 기록 id]`.
  - `E_CONFLICT` 면 `stale` 의 항목을 `section` 으로 다시 읽고 조각을 다시 짓는다(앞 저장은 아무것도 쓰지 않았다).
  - `E_RATE` 면 `retryAfter` 초 쉬고 다시.
  - `save` 에 `kit: "{{KIT_REV}}"` 를 늘 싣는다. 답에 `reinstall` 이 있으면 사람에게 그대로 한 줄로 전한다.
  - 「같은 기록을 다시 보내지 말고」 · 「확인 대기」 · 「정리 때」 말을 걷는다.
- `kmd-team-work/SKILL.md` 1단계: `brief` 의 `mine`(안 넣은 메모 n · 넣지 못함 n)을 한 줄로 전한다(0 이면 말하지 않는다).
- `agent/CLAUDE-kmd-team.md`: 「정한 것 · 배운 것은 `kmd-team-save`(확정이면 조각까지 · 아니면 메모)」 · 「폴더째 팀 지식에 넣기는 `kmd-team-import`」(S11).
- `server/mcp.js`: `INSTRUCTIONS` · `WHERE.team`(「저장 순간 검사를 넘으면 들어간다 · 못 넘으면 넣지 못함」) · `save` 설명 · `sections.edits` 설명 · `record.memo` · `kit` · 핸들러의 `queue` 걷기 · note · `reinstall`. `brief` 목록에 지식마다 `mine:{ memos, held }`, 지식 하나에 `you:{ role, direct: canSave, ledgers: canDirect, memos, held, recent:[{ id, title, why }] }` · 팀이면 `kit: TEAM_KIT_REV` · (S11) `parser`. `brief` 의 `tidy:` 줄은 S13 에서 걷는다. `recOut.state` 말: 「문서에 들어감 · 넣지 못함 · 메모 · 바로잡힘 · 개편 전 기록」.

### 4-2. 문서 고치기 (K4-1)

- `hub.edit`: `canSave` 면 모두 `hub.save(…, { channel:'edit' })` 로(`asEdit` · 태그 `edit` · log/). 962 ~ 972 의 쓰기 자리 기록 갈래를 걷는다. remove · rename 은 지식관리자만(쓰기 자리가 보내면 E_FORBIDDEN 「항목을 지우거나 이름을 바꾸는 일은 지식관리자가 한다」). 이미 있는 항목은 `base` 필수. 값 검사는 하지 않는다(K-D4). 「옛 값 → 새 값」 은 `## 넣은 것` 이 남긴다.
- 화면: 편집기 오른쪽 말 하나 「저장하면 바로 문서에 들어간다 · 이력에 남는다」. 토스트 「저장했다. 문서에도 넣었다」. **E_CONFLICT**: `docEdOf` 를 다시 받아 `S.edit.orig` 만 새 글로 바꾸고 편집 글은 지킨 채 `formErr` 「읽은 뒤 누가 고쳤다: 새 글을 다시 읽었다. 고친 곳을 확인하고 다시 저장한다」.

### 4-3. 기록 고치기 (K4-2 ~ K4-4)

- 새 길 `POST /api/k/:id/rec/:rec/fix`(3-6). 
- 화면: `recPane` 머리 오른쪽 `<button class="btn" data-a="recFix" data-t="recFixBtn">고치기</button>`(팀 · 쓰기 이상 · work 기록 · 원 기록 author 가 나이거나 지식관리자). 창 `.scrim.fix>.modal role=dialog data-t="recFixWin"`: 칸 「옛 값」 `#rfFrom` · 「새 값」 `#rfTo` · 「고친 내용」 `#rfBody`(md) · [저장] `.btn.pri` · [취소]. 첫 칸 초점 · Tab 가둠 · Esc · 바깥 누름.
- 토스트: 「정정 기록을 남겼다 · 문서 n곳에 넣었다」 / 「팀 일꾼에게 넘겼다: 넣으면 이력에 남는다」 / 「넣지 못함: <까닭>」.

### 4-4. 파일넣기 — 팀 화면 (K5)

- `http.js /api/k/:id/import`: 팀이면 `files.length > TEAM_IMPORT_MAX` · `group.total > 20` · 묶음 누계 > 20 → `E_INPUT 「팀 화면에서는 한 번에 20 파일까지: 많으면 Claude Code 에서 대량 넣기(kmd-team-import)」`. 몸 `attach: b.attach === true`. `readBody` 한도는 그대로 두지 않고 **팀은 요청 하나 64MB**(파일 하나 32MB 그대로 · 화면 `takeFiles` 는 64MB 를 넘으면 `group` 으로 쪼개 보낸다 · 지금 PC 280MB 그대로). `group.total` 은 클라이언트 값이라 믿지 않는다 — 비용 경계는 S-D47 의 queued · 하루 상한이다.
- `hub.importFiles` 팀 갈래(2829 ~ 2873): 파일마다 `fileToMd`(S8) → 같은 파일(`md/<지문>` · `sameKey`)이면 `same` 행 → 아니면 `hub.newRun(id, { title, file, by, parent: gj?.id })` + 들이기 일감 `{ type:'file', rel, sha, run }` + `<jid>.bin` · `<jid>.md`. 단계: 수집 · 검토는 서버가 바로 닫고, 짓기 = 일꾼이 집을 때, 넣기 = 저장 문. 글을 못 꺼낸 스캔 pdf 는 `fail` 행 「글이 없는 pdf: 대량 넣기(Claude Code)가 원본을 읽는다」. `noClaude` 지식이면 S-D22. `tidyNow` 걸기 · `holdWhy` 를 걷는다.
- 원본 첨부: `attach` 가 참이고 쓰기 이상이면 들이기 저장 덩이의 `attach` 로(같은 묶음). 그림 · 변환 끔 파일은 첨부가 유일한 결과라 `attach` 가 꺼져 있으면 `skip` 행 「원본 첨부를 고르지 않았다」.
- 화면(`viewImport`): 팀 작은 글 「파일마다 들이기: 팀 일꾼이 기록과 문서를 한 번에 짓는다 · 한 번에 20 파일 · 많으면 Claude Code 에서 대량 넣기」. 21개 이상이면 보내지 않고 드롭 띠 아래 `<div class="callout warn" data-t="impMany">` 「한 번에 20개까지 · 많으면 Claude Code 에서 대량 넣기(스킬 kmd-team-import) · <button class="lk" data-a="mgGo" data-s="settings" data-v="agent">설정 › 에이전트 설치</button>」. 체크 `<input type="checkbox" id="impAtt" data-t="impAtt">` 「원본 파일도 첨부로 둔다」(기본 꺼짐). 머리 글 「수집 › 검토 › 짓기 › 넣기」. 행 글 「기록 + 문서를 짓는 중(팀 일꾼)」 / 「넣음: <문서 › 항목>」 / 「넣지 못함: <까닭>」.

### 4-5. 가져올 곳 (K7)

- `core/sources.js`: `ingest(files)` · `save({record})`(기록만 길) 콜백을 **`intake(item)` 하나로**. `item = { kind:'file', rel, data } | { kind:'commit', info, diffs, raw }` → `{ state:'queued'|'put'|'held'|'same'|'fail', recId?, job?, why? }`. `coreSave` import 는 걷는다(F-7). 표 블록 저장(`runTables` 637 · `runDb` 506)은 그대로(이미 한 번에).
  - `runDocs`: 파일마다 `await intake(…)` · 파일마다 `writeLedger` · 요약 `넣음 n · 넣지 못함 n · 들이기에 넘김 n`.
  - `runCode`: 커밋마다 `intake({kind:'commit'…})`(`analyze` 의 Claude 호출은 들이기 프롬프트 안으로).
  - `runTables` 뜻 갱신 `codeRecord` → `intake({kind:'commit'…})`.
- `hub.sourceRun` 팀 콜백 = 들이기 일감 `{ type:'commit'|'file', src }`(lane claude · 일 줄 자식) · 가져오기 일은 「들이기에 넘김 n」 으로 끝. PC 콜백 = 지금 동작(PC 파일넣기 · `analyzeCommit` · 기록)을 그대로 감싼다.
- 1199 ~ 1206 의 `codeJobs` · `curateSoon`(팀) · `tidyNow` · 알림 글 「정리가 …」 · `sourceJobEnd` 「정리에 넘겼다」 를 걷고 「넣음 n · 넣지 못함 n」.
- 브레이크(K7-2)는 그대로. 문서 폴더의 「새 파일 수」 브레이크는 더하지 않고 savelog 의 들이기 일감 수로 본다(측정 항목).

### 4-6. 대량 넣기 — 내 PC (K6)

- `core/importer.js`: `fileToMd(rel, buf, { convert = true, mdOf = null }) → { md, ext, kind, blank?, scan?, attach, why? }` 를 꺼내고 `planImport` 163 ~ 184 가 이것을 부른다. `localMd` 가 삼키던 오류를 `why` 로 싣는다.
- `server/bin/kmd-parse.mjs`: `kmd-parse <파일|폴더> [--out <폴더>] [--attach]`. 숨김 · `node_modules` 빼고 `docwatch.wantDoc` 범위. 출력은 파일마다 ndjson 한 줄 `{ rel, md, sha: sha256(md.trim()).slice(0,16), scan, why, atts:[{ path, bytes }] }`(`--out` 이면 `<rel>.md` + `index.json`). 끝 줄 `{ done:true, n, fail }`. 종료 코드 0(모두) · 2(일부 실패) · 1(못 함).
- `scripts/pack.mjs`: `packParser({ out })` → `kmd-parse-<pver>/`(`node.exe` · `core/{importer,ooxml,pdf,hwp,text,errors}.js` · `bin/kmd-parse.mjs` · `kmd-parse.cmd` · `package.json { "type":"module" }` · `build.json { parse: pver }` · pdfjs ONLY 부분) → `kmd-parse-<pver>.zip`. `pver = sha256(묶는 파일 글 + node 판 + pdfjs 판).slice(0,12)`. **import 그래프 검사**: 여섯 파일이 묶음 밖 상대 경로를 import 하면 pack 실패. 팀 tgz 에 같이 넣는다. `kmd-install.sh` 가 `kmd-parse-*.zip` 을 `$ROOT/.kmd/dl` 로 복사(옛 판은 둘 · 가장 새 것만 brief 에 나간다).
- `server/http.js`: `parserPackage()`(정규식 `^kmd-parse-([0-9a-f]{12})\.zip$` · sha256 · 크기를 처음 한 번 셈) · `GET /api/agent/parser`(`need(ctx)`) → `{ ver, name, url, sha256, bytes }`. MCP `brief`(팀)에도 `parser`. `/a/` 스크립트에는 넣지 않는다(K-D9 · teamkit 시험 금지어).
- `agent/team/skills/kmd-team-import/SKILL.md`(+ `작성가이드.md` 사본을 `teamKitParts` 가 복사):
  0. 어느 팀 지식에 넣을지 묻는다(`kmd-team-save` 와 같은 규칙).
  1. 파서: `%USERPROFILE%\.kmd\parse\<ver>\kmd-parse.cmd` 가 없거나 판이 다르면 「파서(N MB)를 팀 서버에서 받습니다」 를 묻고 → `Invoke-WebRequest` → sha256 확인 → `tar -xf` 로 그 판 폴더에.
  2. `kmd-parse <폴더>` 출력을 읽는다. 스캔(`scan:true`)은 원본을 직접 읽어 md 를 짓는다.
  3. 파일마다: `brief`(한 번) · `match` · `section` → 기록(제목 「<파일>: 무엇」 · 태그 `ingest/<상대 경로>` · `md/<sha>`) + 조각(`edits` + `base`, 새 항목은 `doc · heading · content`, 새 문서는 `##` 항목으로만) + `names` → `save` 한 번(`kit` 실음). 파일 하나 = 저장 하나.
  4. 답이 `same` 이면 「이미 넣음」 으로 넘어간다(이어 하기). `held` 면 까닭을 읽고 **한 번** 고쳐 `fixes` 로 다시, 그래도 안 되면 다음 파일로(지식관리자 화면 「넣지 못함」 에 남는다). `E_RATE` 면 쉬고 다시.
  5. 원본 첨부는 사람이 「원본도 첨부」 라고 했을 때만 `attach`(파일 하나 8MB 까지).
  6. 끝에 「넣음 n · 넣지 못함 n · 이미 넣음 n」.
- `core/teamkit.js`: `TEAM_SKILLS = ['kmd-team-work','kmd-team-save','kmd-team-import']` · 작성가이드 사본 둘 · `/a/` 끝 말을 서버 값 `$r.skillNames -join ' · '` 로.

### 4-7. 보내기 (K9)

- 개인 프로그램 `hub.sendPicked`: 고른 문서 · 기록마다
  1. 팀 MCP `match`(제목 · 머리) · `section`(후보 항목 · base) — `sendLib.mcpCall(url, key, tool, args)`(기기 열쇠 · `tools/call`).
  2. `askClaude(intakePromptOf(g, { from:'send' }), INTAKE_SCHEMA, { budget: KMD_INGEST_BUDGET, role:'ingest' })` — 내 PC · 내 구독.
  3. `draftToSave` → 기록 태그 `sent/<지문>`(개인 쪽 `marks(d)` 지문) → 팀 `POST /api/k/<kn>/save { …, channel:'send' }`.
  4. 결과를 `st.sent` · `log` 에 `put/held` 수로. 넣지 못함은 `wait` 의 `fail` 줄(사람이 [다시] · [버리기] · [다시] 는 앞 결과 id 를 `record.fixes` 로). 닿지 않음(5xx · 연결)은 `sendRetry` 가 저절로 다시, E_RATE(429)는 `Retry-After` 만큼 쉬고 다시(실패 줄이 아니다).
  5. 받는 팀 지식이 `noClaude` 면(brief 의 `you`) Claude 를 부르지 않고 기록만 보낸다 → 팀이 held(`noclaude`).
- 팀 쪽은 고칠 것이 없다(저장 문 · `sameKey` 가 다 한다). `/receive` 는 S-D36.
- 화면 글 「정리 때 문서에 들어간다」(hub 3059 · 3097 · `traceHtml` · `sentState`) → 「넣음 n · 넣지 못함 n」.

### 4-8. 넣지 못함 (K8)

- 서버
  - `GET /api/k/:id/held` → `hub.heldList(ctx, id)`: `hub.meta(id, ctx)`(read 미만 404). 지식관리자는 모두, 그 밖은 `w.author === ctx.user` 만. 줄 `{ rec, date, author, title, route, state, parts:[{ doc, heading, code, why }], legacy?: true }`. 옛 `pend` · `nowhere` 사람 기록은 `legacy:true` · 까닭 「개편 전 기록」.
  - `POST /api/k/:id/held/:rec/again` → 자기 것 write · 남의 것 admin → `hub.openJob`(S-D47 · 이미 열린 일감이면 그것) `type:'again'` → `{ job }`.
  - `POST /api/k/:id/held/:rec/drop { why? }` → admin → `decisionRecord` system 저장(prepare 밖 · 태그 `drop`) → `{ ok }`.
  - `POST /api/k/:id/held/:rec/names` → admin → 그 기록의 「세울 이름 · 세울 갈래」 칸으로 system 저장 하나(`fixes:[rec]` · S-D51) → `{ ok, names }`.
  - `POST /api/k/:id/held/again-all` → admin → 「개편 전 기록」(S-D46)마다 `again` 일감(열린 일감이 있는 기록은 건너뜀 · 한 번에 500까지) → `{ jobs: n }`.
  - 모두 POST 만(405 · S-D54). 경로 조각 `:rec` 은 `dec()` 감싸 400 · 길이 80 · `^[0-9]{4}-[0-9]{4}-` 꼴.
  - 「쓰기 자리는 자기 것만」 은 화면 거르기다(읽기 자리도 `/rec` · `/tree` 로 기록을 본다) — 보안 경계는 again · drop · names 의 자리 판정이다. 권한 모델에 그렇게 적는다.
  - `views.knowledgeRow(k, user)`: `held`(지식관리자용 모두) · `heldMine`. `recRow.state` 새 값 · `prop` 걷기 · `docView` 항목마다 `heldN`(볼 수 있는 것만).
  - 쓴 사람 알림: 세션 · HTTP 채널은 답에 바로 있으니 알리지 않는다 — K8-2 의 「쓴 사람(세션)에게도 알림」 은 응답 + brief 의 `mine`(K3-3 · `kmd-team-work` 1단계)으로 대신한다. 이 결정을 S1 에서 TODO K8-2 줄과 권한 모델 7절에 적는다. 들이기 · 정정 · 다시 들이기가 held 로 끝나면 `feed.add(author, { kind:'held', rec, kn, dot:'warn', title:'넣지 못함: <제목>', small: why })`. `hub.history` 의 `kindOf` · 화면 `HIST_KINDS` 에 「넣지 못함」.
- 화면(9절 말 · 6절 표)
  - 설정 › 팀 메뉴에 `['held','','넣지 못함']` 을 **더한다**(S10). 옛 `tidy` 메뉴는 정리 화면과 함께 S13 에서 걷고, 그때 `#tidy` 를 `#held` 로 돌린다(S10 에서 바꾸면 screen-kmd 242 `mg(page,'team','tidy')` 가 깨진다 · 검토 D13).
  - `viewHeld`: 머리 「넣지 못함: <지식 이름>」 · lead 「저장 검사를 넘지 못해 기록만 남은 것이다. 고쳐서 다시 넣거나 팀 일꾼에게 다시 들이게 하거나 버린다.」 · 지식 고르기 `select#hdKnSel` · 요약 줄 「넣지 못함 n · 오늘 넣음 n · 메모 n」 · (지식관리자 · 옛 기록이 있으면) 띠 「개편 전 반영 대기 n: 팀 일꾼에게 한 번 다시 들이게 한다 [옛 기록 다시 들이기]」.
  - 표(`.tblwrap` · `td-grid` 를 옮긴 `hd-grid`): 열 「사람 · 들어온 길 · 기록 · 까닭 · ⋯」. 줄 `data-t="heldRow"` · 까닭 `data-t="heldWhy"` · 단추 `[고치기] data-t="heldFix"`(까닭이 넣을 곳이면 넣을 곳 고르기 창, 아니면 기록 고치기 창) · `[다시 들이기] data-t="heldAgain"` · ⋯ 메뉴 `[버리기] data-t="heldDrop"`(`ask()` 「이 기록은 문서에 넣지 않는다. 기록은 남는다」 · 단추 「버리기」 · 지식관리자만).
  - 상태: 읽는 중(`loadingHtml`) · 빈 상태 `data-t="heldEmpty"` 「넣지 못한 기록이 없다」 · 오류(`errHtml` + 「다시 읽기」).
  - 지식 카드 칩 `<span class="chip c-warn">넣지 못함 n</span>` + 옆 `.lk` 「보기」. 홈 띠 「내 넣지 못함 n」(`data-t="myHeld"`). 기록 칩 `recState` 「넣지 못함」(c-warn) · 「메모」(c-mute) · 「바로잡힘」(c-ok). 항목 머리 참고 칩 「넣지 못함 n」(지식관리자 · 쓴 사람). 항목 거름 `IFL` 「넣지 못함」. 항목 구획 제목 「넣지 못함」. 그래프 거름 · 범례 「넣지 못함만」.
  - `pendWhen` · `pendPanel` · `myPend` · `waitHtml` 을 걷고 위 꼴로.

### 4-9. 문서 다듬기 (K10-4)

- `POST /api/k/:id/polish { doc }` → admin · `doc` 은 `k.docs` 에 있는 것만 · watched 문서 거절 · `##` 없으면 거절 · `noClaude` 지식 거절 → `hub.openJob` `type:'polish'`(문서마다 하나). 일꾼 `POLISH_SCHEMA = { updates:[{ heading, base, content }], why }`. 서버는 항목마다 `valuesOf` 가 같을 때만 넣고(S-D37), 한 저장(기록 `다듬기: <문서>` · 태그 `polish` · log/).
- 화면: `docPane` 머리 [고치기] 옆 `<button class="btn" data-a="polishDoc" data-t="polishBtn">다듬기</button>`(지식관리자 · watched 아님 · `##` 있음 · 편집 중 아님). `ask()` 「문체 · 짜임만 정돈한다 · 값은 바꾸지 않는다 · 팀 일꾼이 한다 · 결과는 이력에서 되돌릴 수 있다」 → 토스트 「일 줄에 올렸다」. 일 줄 kind 이름 「다듬기」 · `BUSY_K` 에 더한다.

---

## 5. 길(HTTP · MCP) 표

| 길 | 단계 | 처리 |
|---|---|---|
| `POST /api/k/:id/save` | S4 | `channel`(http · send) · `E_RATE` · 답 2-4 |
| `POST /api/k/:id/proposal/:rec/put` | S4 | **걷음**(화면 [넣기] 와 한 커밋) |
| `POST /api/k/:id/edit` | S9 | 쓰기 이상 바로 · base 필수 · remove/rename 은 지식관리자 |
| `POST /api/k/:id/revert` | S5 | `{ record, doc?, heading? }` |
| `GET /api/history` | S5 | work 줄 · `items` · `canRevert` |
| `POST /api/k/:id/rec/:rec/fix` | S9 | 새 |
| `GET /api/k/:id/held` · `POST …/held/:rec/(again|drop|names)` · `POST …/held/again-all` | S10 | 새 |
| `POST /api/k/:id/rec/:rec/touches` | S10 | 남김 · POST 만(지금 메서드를 안 본다) |
| `POST /api/k/:id/polish` | S13 | 새 |
| `POST /api/k/:id/import` | S8 | 팀 20 · `attach` |
| `/api/worker/next` · `/api/k/:kn/worker/intake(/progress|/done|/fail)` | S7 | 새(일꾼 열쇠) |
| `/api/k/:kn/worker/(material|drafts|agent…)` | S13 | 걷음(팀) |
| `GET /api/agent/parser` | S11 | 새 |
| `GET /api/k/:id/tidy` · `POST …/tidy` · `GET …/tidy/plan` | S13 | 걷음(읽기 길 정규식 383 에서도) |
| `GET /api/k/:id/tree` | S10 | `pend` 대신 `held` 수 |
| `GET /api/k/:id/owner` | S13 | `tidyAt` · `tidyMode` 빼기 |
| `/api/settings` 의 이달 정리 수 | S13 | 「이달 들이기 수」(`intake` 태그) |
| MCP `save` | S4 · S6 | `kit` · `memo` · `attach` · `queue` 걷기 · note |
| MCP `brief` | S6 · S11 | `mine` · `you` · `kit` · `parser` · (S13) `tidy` 걷기 |
| `/receive` | S12 | 남김 · 기록은 held(`legacy-send`) · 속도 통 건수만큼 |
| `/mcp` 본문 한도 | S11 | 로그인한 ctx 만 12MB(첨부 · S-D30) |

새로 쓰는 길은 모두 POST 만 받고 그 밖은 405(S-D54). 권한은 모두 서버에서: 읽기 길 `hub.meta(id, ctx)`, 쓰기 · 관리 길 `hub.need(ctx, kn, 'write'|'admin')`. 지식 id 를 싣는 응답(넣지 못함 목록 · 들이기 일감 · 이력 · 알림)은 자리로 거른다. 총괄 관리자 일은 늘지 않는다.

---

## 6. 화면 표 (바꿈 · 새로 · 걷음)

| 화면 · 부품 | 단계 | 무엇 |
|---|---|---|
| 이력 `histRow` | S5 | 「옛 값 → 새 값」(`.vchg` 를 이력에서도) · 항목마다 [되돌리기] `data-t="revertItem"` · `canRevert` 만 · 갈래 칩 「저장 · 고침 · 들이기 · 다듬기 · 되돌림 · 넣지 못함」 |
| `checkCard` | S5 | 「내 값이 바뀌었다(누가 바꿨든) · 그 줄만 되돌릴 수 있다」 |
| 정리 화면 [넣기] · 「제안 있음 · 확인 대기」 | S4 | 걷음(길 `/proposal/put` 과 한 커밋 · `tdPropLine` · `tdPropPut` · `S.propBusy`) |
| 가져오기 › 파일 넣기 | S8 | 20개 안내 · 첨부 체크 · 단계 이름 · 쓰기 자리에게 메뉴 |
| 편집기 | S9 | 말 하나 · E_CONFLICT 다시 읽기 |
| 기록 고치기 창 | S9 | 새 `recFixWin` |
| 넣지 못함 화면 · 칩 · 띠 · 거름 | S10 | 4-8 |
| 「반영 대기」 모든 곳 | S10 | 걷거나 「넣지 못함」(screens 지도 1-B 표 그대로) |
| 에이전트 설치 카드 | S11 | 스킬 셋 · 「대량 넣기는 Claude Code 에서」 · Claude Code 확인 안내 |
| 옆 메뉴 「개인 프로그램 설치」 | S11 | 보이는 이름 「개인 지식 쓰기」 · lead 「팀 지식만 쓰면 개인 프로그램은 필요 없다(설정 › 에이전트 설치 한 줄이면 된다). 개인 지식을 쓰려면:」 · `data-t` 는 그대로(`nav-install`) |
| 보내기 화면 | S12 | 「넣음 n · 넣지 못함 n」 · 넣지 못함 줄 [다시] · [버리기] |
| 정리 화면 전체 · 설정 › 정리 표 · 정리 방식 메뉴 | S13 | 걷음(screens 지도 2절 함수 · 동작 · 밖에서 부르는 곳) |
| 문서 [다듬기] | S13 | 새 |
| 「정리 일꾼 · 정리 전용 로그인」 | S13 | 「팀 일꾼 · 팀 일꾼 로그인」 |

화면마다: 색 · 간격은 `var(--…)` 토큰만 · 누르는 것은 `<button>` · 칩은 상태만 · 모달은 `role=dialog` · 첫 칸 초점 · Tab 가둠 · Esc · 바깥 누름 · `confirm()` 대신 `ask()` · 1280 · 1024 · 600 · 375 잘림 0 · `BANNED`(「원천」 「판정」 「대기열」 「LLM」 …)에 걸리지 않게 「들어온 길」 · 「출처」.

---

## 7. 말 (컨벤션 9절 · CLAUDE.md 「말」 에 반영)

| 쓰는 말 | 뜻 | 쓰지 않는 말 |
|---|---|---|
| 넣지 못함 n | 저장 검사를 넘지 못해 기록만 남은 수(서버가 센 한 값) | 반영 대기 · 실패 · 거절됨 · 정리 기다림 |
| 안 넣은 메모 n · 메모 | 확정이 아니라 문서를 바꾸지 않은 기록 | 초안 · 임시 |
| 들이기 | 쓴 사람이 없는 원천(파일 · 가져올 곳 · 보내기 · 규칙 밖 정정)을 Claude 가 기록 + 문서로 한 번에 | 정리(늘 도는 단계로) · 큐레이션 · 반영 |
| 문서 다듬기 · 다듬기 | 지식관리자가 문서 하나를 골라 거는 문체 · 짜임 정돈 | 정리 |
| 고침 | 문서 고치기(이력 갈래) | 바로 고침 |
| 정정 기록 · 바로잡힘 | 기록을 고칠 때 새로 남기는 기록 · 그것이 가리키는 옛 기록 | 수정 기록 · 덮어쓰기 |
| 팀 일꾼 · 팀 일꾼 로그인 | 팀 서버의 Claude(팀 구독) | 정리 일꾼 · 정리 전용 로그인 · 워커 |
| 값 바뀜 · 옛 값 → 새 값 | 이력 줄 | 확인 대기 |
| 들어온 길 | 세션 · 고침 · 정정 · 파일 · 가져올 곳 · 보내기 | 원천(화면 금지어) |
| 대량 넣기 | Claude Code 스킬 `kmd-team-import` | 일괄 업로드 |
| 짓기 | 파일넣기 일 줄 셋째 단계(팀 일꾼 · PC 의 Claude 가 기록 + 조각을 짓는다 · PC 화면에도) | 정리 |
| 버림 · 버리기 | 지식관리자가 넣지 않기로 한 기록(이력 갈래) | 삭제 · 거절 |
| 세울 이름 | 지식관리자가 세울 때까지 기록에 실어 둔 이름(넣지 못함 까닭) | — |

걷는 말: 「반영 대기 · 정리 중 · 지난 정리(탭)」 · 「제안 있음 n · 확인 대기 n · [넣기]」 · 「정리 방식 · 정해진 시각 · 실시간 · 손으로만」 · 「다음 정리」 · 「지금 정리」.
`c-pend` 뜻에서 「반영 대기」 를 빼고 `c-warn` 에 「넣지 못함」 을 더한다. 화면에서 이 말들이 실제로 바뀌는 단계(S4 · S10 · S13)에서 컨벤션 · CLAUDE.md 「말」 줄 · `app/styleguide.html` 을 **같은 커밋**으로 고친다(S1 은 새 말을 더하고 옛 말 줄마다 화면에서 걷히는 단계를 단다: 「제안 있음 · 확인 대기」 는 「S4 까지 화면에 남음」(S-D10 · 칩을 S4 에 걷는다), 「반영 대기 n」 은 「S10 까지」(정리 화면 안은 S13), 정리 화면 탭 「반영 대기 · 정리 중 · 지난 정리」 와 「정리 방식 · 다음 정리 · 지금 정리」 는 「S13 까지」, 이력의 「확인할 것」 은 「S5 까지」).

---

## 8. 걷는 것 (K10) · 옛 반영 대기 옮기기 (K10-3)

### 8-1. 걷는 목록 (S13)

| 곳 | 걷는 것 |
|---|---|
| `core/tidy.js` | 파일째(살릴 것은 S2 · S7 에서 옮김 · PC 갈래는 `core/pcplace.js`) |
| `core/curate.js` | 파일째(`revertPlan` → revert.js · `decisionRecord` → parts.js · R-A3 → ingest.js) |
| `core/propose.js` | `PROPOSAL_PART` 쓰기(읽기 `parseProposals` 는 옛 기록 화면용으로 남김) · `waits` 흔적 |
| `core/worker.js` | `many` · `batchesOf` · `patchOn` · touches · `agentIngest` · 옛 env(fallback 은 남김) |
| `core/queue.js` | `kind:'curate'` 갈래(PC 의 일 줄은 남김) |
| `core/models.js` | `tidy` → `ingest`(`touch` 는 PC 가 쓰므로 남긴다 · S-D39) |
| `core/owners.js` | `tidyAt` · `tidyMode` 쓰기 · 검사(옛 `_members.md` 의 「- 정리 방식:」 · 「- 정리:」 줄은 읽어도 무시) · 되살림 기본값 `tidyMode:'manual'` |
| `server/hub.js` | `tidyTimer` · `lastTidy` · `tidy-last.json` · `liveTimers` · `liveSoon` · 정리 장부 읽기(`readRuns` · `saveRun` · `HOLD` · `leftTries` · `runs`) · `askName` · `tidyAtOf` · `tidyModeOf` · `pendText` · `ruleOnly`(팀) · `ruleJob` · `tidyNow`(사람 길) · `tidyPlan` · `material` · `groupFor` · `putDrafts`(+ 1868 의 `yl` 알림) · `workerAgent*`(팀) · `decide`(R-A1 · R-A2) · `tasks` · `queueList` 의 `t:` 정리 줄(→ 들이기 줄) · `busy` 의 「정리」 · `stops` 의 「자동 정리」 · `setOwner` 의 tidy 키 · 시계 3801 ~ 3828(받은편지함만 `inboxTimer` 로 남김) |
| `server/http.js` | `/tidy` · `/tidy/plan` · 읽기 길 정규식의 `tidy` · `/worker/(material|drafts|agent…)` · 설명서 목록 `sub` 「넣지 못함 · 권한 · 가져올 곳」 · 그림 `t-held.png` |
| `server/mcp.js` | `brief.tidy` · 「정리」 말 |
| `server/bin/kmd.mjs` · `scripts/kmd-install.sh` · `scripts/local.mjs` | 도움말 · Description 「팀 일꾼」(명령 · 단위 이름 그대로) · `worker.env` 덮지 않음 |
| `app/main.js` | 정리 화면 덩어리(1910 ~ 2386 · `tdPickModal` 은 `heldPickModal` 로 옮김) · 동작 표 정리 항목 · `S` 의 정리 키 · `QAUTO_T.tidy/curate` · `BUSY_K.tidy` · `STOP_T.tidy` · `claudeHowCard` · `admClaudeCard` 말 · `tidyTable` · `TIMES` · `setOwnerRow` 의 tidy · `revertToday` 의 `tidy:` 캐시 · `viewToday` lead |
| `app/kmd.css` | 안 쓰는 `td-*` 규칙(넣지 못함 화면이 쓰는 것은 `hd-*` 로 이름 바꿔 남김) |
| 설정 키 | `tidyAt` · `tidyTickMs` · `liveQuietMs`(시험 serve.json 에서도) |
| 살림 자리 | `tidy-last.json` 읽기 · `tidy/<id>.json` 읽기(**파일은 지우지 않는다** · `deleteKnowledge` 만 지운다) |

### 8-2. 옛 반영 대기 (K10-3)

1. S10 이 들어간 뒤 옛 `pend` · `nowhere`(팀 · 사람 기록)는 넣지 못함 화면에 「개편 전 기록」 으로 보인다(아무것도 지우지 않는다). S13 전에는 `cutoverAt` 이 없어 모든 pend 가 여기 든다(정리도 아직 넣는다).
2. 지식관리자가 고른 때 [옛 기록 다시 들이기] → 기록마다 `again` 일감(열린 일감이 있으면 건너뜀) → 넘으면 `fixes:[옛 id]` 새 기록 + 문서(옛 것은 `k.superseded` 로 `fixed` · 새 기록이 어느 항목에 넣었든), 못 넘으면 새 기록이 `held` 이고 옛 것은 「개편 전」 목록에서 빠진다(새 held 기록이 [다시 들이기] 를 맡는다 · S-D46 의 `k.handedOff`).
3. S13 의 정리 걷기는 이 화면이 선 뒤에만 한다. S13 이 처음 켤 때 `cutoverAt` 을 적고, 그 뒤 옛 `pend` 는 「개편 전 기록」 으로 남아 같은 단추로 처리된다. 개편 뒤 기록은 `put` 태그로 상태가 정해지므로 다시 「개편 전」 으로 떨어지지 않는다(S-D4 ⑦).

---

## 9. 측정 도구 (K12-2 · K12-4) — 기다림은 사람이 한다

- `scripts/savelog.mjs`(S6):

```
node scripts/savelog.mjs <data 폴더> [--kn dpms] [--since 2026-11-10] [--until …] [--ch session,bulk] [--json]
```

  - 채널마다: 저장 수 · 조각 수 · **조각 통과율**(put / n) · 걸린 까닭 상위 10(`code` · `why` 앞 40자) · `E_CONFLICT` 수 · **다시 넣은 비율**(같은 user + 같은 coord 가 held 또는 E_CONFLICT 뒤 30분 안에 put 이 된 비율) · **자리당 시간**(`ms` 중앙값 · 들이기는 일감 `at` → 끝) · **비용**(들이기 `cost.usd` 합 · 자리당).
  - 동시 쓰기(K12-4): `conflictWith` 가 있는 줄을 「세션 ↔ 가져올 곳」 짝으로 센다.
  - 비교 기준: 같은 폴더 `tidy/*.json`(정리 장부)이 있으면 넣음 비율 · 자리당 시간 · 비용을 옆 칸에 낸다. 목표 「통과 70% 이상 · 자리당 1분대」 를 넘었는지 표시.
  - `--trend`: 날마다 열린 넣지 못함 수 · 메모 수(K12-3 「쌓이나 줄어드나」). 지식 폴더를 읽어 `held` · `memo` 태그 기록을 날짜로 센다.
  - 188 에서는 읽기만(사람이 `node /opt/kmd/scripts/savelog.mjs /srv/kmd/.kmd` 를 돌린다).
- `test/savelog.test.mjs`: 픽스처 jsonl 로 통과율 · 다시 넣은 비율 · 짝 세기.
- 사람이 할 것: S6 뒤 188 배포 여부 결정 → 2주 측정(savelog) → 결과를 `docs/품질개선/측정_<날짜>.md` 로 → S7 로 갈지 정한다. S13 뒤 한 팀이 2 ~ 4주 쓰고 `--trend` 와 화면을 다시 여는지(접속 기록)를 본다.

---

## 10. 구현 단계

공통: 단계마다 main 에 커밋 하나(또는 둘) · 기준 문서와 코드를 같은 커밋에서 · KMD_개편_TODO 의 끝낸 줄에 `[x]` + 해시 · 시험은 `node --test test/<파일>.test.mjs` 로 그 단계에 걸린 파일만(`npm test` · `restore.test` 금지) · 화면을 바꾼 단계는 `screen-kmd`(Chrome 필요 · `KMD_CHROME`) 와 네 폭 잘림 0 · 고치기 전 HEAD 에서 그 시험 파일을 한 번 돌려 원래 깨진 것을 가린다. **단계마다 끝에 main 이 녹색**이어야 한다 — 어떤 단계가 바꾼 동작을 단언하는 시험은 그 단계의 시험 목록에 든다(뒤 단계로 미루지 않는다). 길(서버)과 그 길을 부르는 단추(화면)는 같은 단계에서 걷는다. S1 이 기준 문서(권한 모델 1 · 5 · 7절 · 작성기준 1 · 2-3 · 3 · 6 · 7 · 7-1 · 9절 · 컨벤션 9절 · 서비스 전체 1 · 3 · 6절)에 단 「(Sx 부터)」 · 「(Sx 에 걷음)」 · 「Sx 까지 화면에 남음」 표시는 그 단계 커밋에서 지금 말로 바꾸거나 지운다(`grep -rnE "S<n> (부터|에 걷음|까지)" docs docs_ops CLAUDE.md`).

### S1 · 기준 문서 (K1-1 · K1-2 · K1-3 · K12-5)

- 범위: 코드 없음. 뒤 단계가 따를 기준을 먼저 세우되, **새 규칙 줄마다 들어가는 단계를 단다**(「(S4 부터)」 · 「(S13 부터)」). 코드가 아직 따르지 않는 규칙을 단계 표시 없이 쓰지 않는다(CLAUDE.md 「기준과 코드를 같은 커밋에서」).
- 파일 · 할 일
  1. `docs/kmd_권한_모델.md`: 1절 write · admin 줄 · 5절 90 · 92줄 · **7절 다시 쓰기**(제목 「7. 저장(기록 + 조각 한 번에) · 모든 채널의 기본 · 2026-11-03 넓힘」, docs 지도 5절 표 + 이 설계 S-D9 · S-D10 · S-D11 · S-D13 · S-D17 · S-D19 · S-D23 ~ S-D25 · S-D30(첨부를 쓰기 자리로 넓힘 · 하루 합) · S-D43 · S-D47(일감 한도가 경계 · 팀 화면 20 은 안내) · S-D53 · 「넣지 못함 목록의 자기 것만은 화면 거르기」 · 「K8-2 세션 알림은 응답 + brief 로」 · 「collect 는 값 이력 없음」(D-8)) — 줄마다 단계 표시.
  2. `docs/kmd_문서_작성기준.md`: 3 · 7 · 9절 줄(docs 지도 3절) + 새 7-1 「claude 프롬프트에 싣는 법」(서버는 `core/writerules.js` 하나 · 스킬은 작성가이드 사본 · 판은 `TEAM_KIT_REV`) · 「`## 넣은 것` · `## 넣지 못함` · `## 되돌린 항목` 은 kmd 가 쓰는 칸」.
  3. `docs/kmd_디자인_컨벤션.md` 9절: 7절 표의 새 말(짓기 · 버림 · 세울 이름 포함)을 더하고 옛 말 줄마다 화면에서 걷히는 단계(「S4 · S5 · S10 · S13 까지 화면에 남음」 · 7절 끝 문단).
  4. `docs_ops/kmd_서비스_전체.md` 1 · 3 · 6절(docs 지도 1절) — 들어가는 단계 표시를 단다. `kmd_서비스_전체.html` 머리에 「개편 전(HEAD 2275f24) 그림 · 새 흐름은 md 6절」 띠.
  5. `CLAUDE.md`: 13줄 기준 표에 이 설계 문서를 더한다 · 56줄 「지우기는 사람이 확인한 뒤」. 「서버 · 저장」 절의 새 규칙(「모든 채널은 기록 + 조각 + 지문 + 스킬 판을 `core/save.js` 한 덩이로 …」)은 **S4 커밋**에서 더한다.
  6. `docs/품질개선/TODO_남은것.md` A4 ~ A8 · `KMD_개편_TODO.md` K12-5 `[x]` · K2-2 의 `{ ok, why, waits, stale }` → `{ ok, why, code, stale, changed }`(S-D10) · K8-2 줄에 「세션은 응답 + brief」.
  7. 이 설계 문서 자체를 S1 커밋에 넣는다(CLAUDE.md 기준 표가 가리킨다 · 그 전까지 추적되지 않던 파일).
- 시험: 없음(코드 안 바뀜).
- 끝 기준: 7절 표가 이 설계 1절과 어긋나지 않는다 · 새 규칙 줄마다 단계 표시 · `grep -n "확인 대기" docs/kmd_권한_모델.md` 가 「걷음(S4 부터)」 줄만.

### S2 · 모듈 나누기 (K10 준비 · K2 바탕 · S-D27)

- 범위: 동작 바꿈 없음. 옮기고 다시 내보내기만.
- 파일: 새 `core/edits.js` · `core/values.js` · `core/writerules.js` · `core/gate.js` · `core/ingest.js` · `core/revert.js` · `core/parts.js`(이번엔 `decisionRecord` 만) / 고침 `core/propose.js` · `core/tidy.js` · `core/curate.js` · `core/save.js`(`valuesOf` 다시 내보내기) · `server/hub.js` import 줄.
- 순서
  1. propose 의 조각 함수를 `edits.js` 로 → propose 가 다시 내보냄.
  2. `valuesOf` 를 `values.js` 로(`save.js` 는 다시 내보냄) · tidy 의 값 장부 · `WRITE_RULES` · 꼴 검사 · `check`(section · ingest 갈래) · ingest 후보(`kindOfName` · `topicOfName` 포함) · `revertPlan` 을 옮긴다. gate 는 edits · values 만 import. 새 모듈은 최상위에서 다른 모듈의 `const` 를 읽지 않는다.
  3. `NOT_KNOWLEDGE` 에 「넣은 것」 · 「넣지 못함」 · 「되돌린 항목」 을 지금 더한다(쓰는 칸이 아직 없어 무해).
  4. `node -e "import('./core/propose.js').then(()=>import('./core/tidy.js')).then(()=>import('./core/save.js'))"` 로 순환 · 로드 확인.
- 시험: `propose` · `docformat` · `guide` · `tidy` · `tidy-plan` · `edit` · `wp3`(모두 그대로 넘어야 한다).
- 끝 기준: 위 시험이 HEAD 와 같은 결과 · `core/tidy.js` 가 propose 를 import 하지 않는다.

### S3 · 저장 문 core (K2-1 · K2-2 · K2-6 · S-D1 · S-D2 · S-D4 · S-D5 · S-D8 · S-D30 core · S-D43 core · S-D44 · S-D45 · S-D46 · S-D49 core)

- 파일: `core/save.js` · `core/journal.js`(`recover` 를 줄 첫머리에서 부름 · 지금도 export) · `core/knowledge.js` · `core/names.js` · `core/parts.js` · `core/values.js`(`valueDiff`) · `core/curate.js`(R-A3 건너뛰기) · `core/errors.js` · 새 `test/save.test.mjs`.
- 순서
  1. `names.js`: `RESERVED_TAGS` += `held` · `memo` · `intake` · `polish` · `revert` · `put` · `drop` · 접두사 `job/` / `LOG_TAGS` += `polish` · `revert` · `drop`. `SYSTEM_TAGS` 는 그대로(`intake` 를 넣지 않는다).
  2. `knowledge.js`: `k.superseded` · `k.handedOff` · `k.revertedItems` · `recordState` 순서(S-D4) · 「개편 전」 판정(`cutoverAt` 은 `loadKnowledge(meta, { cutoverAt })` 로 받는다 · 없으면 모두).
  3. `parts.js`: `renderPut` · `parsePut` · `renderHeld` · `parseHeld` · `renderReverted` · `parseReverted` · `dropPart`(마지막 칸만 · 울타리 · 길이 상한).
  4. `save.js`: 옵션 `prepare` · `onCommit` · `partial` · `asEdit` · `structure` · `correction` · `intake` · `attach`(`assetPath`) · `record.memo` · `guardSections`(입력 · prepare 결과 둘 다) · 줄 첫머리 `recover` · held/memo/put 태그 · 세 칸 · `check()` 의 예약 칸 머리 거절 · `isTouchesFix` 건너뛰기 · `undo` 실패 log · HEAD 가 움직였으면 되돌리지 않음 · `saveRecords` 의 `serverTags` · `heldPart`.
  5. `curate.js` `decide` R-A3: 옛 기록이 held 거나 새 기록 `fixes` 가 가리키면 건너뜀(S2 에서 `supersededIngest` 로 옮겨 둔 것도 같이).
  6. `errors.js`: `E_RATE: 429`.
- 시험: 새 `save.test.mjs`(core 만: 기록 + 문서 + 장부가 커밋 하나 · 문서 쓰기 실패 → 기록도 되돌림 · `partial` 에서 없는 항목 → held 태그 + json · 메모는 문서 안 바꿈 · 문서 · 머리로 넣은 기록이 `put` 태그로 `in` · **그 항목에 다음 저장이 들어가도 `in`** · held 기록을 `fixes` 로 가리키면 `fixed`(R-A3 이 있어도) · `touches-fix` 기록의 `fixes` 는 바로잡힘이 아님 · `## 넣은 것` 에 「5분 → 10분」 · 본문에 `## 넣은 것` 을 쓴 입력 → E_INPUT · prepare 가 `rename` 조각 → E_FORBIDDEN(structure 없이) · prepare `abort` → 아무것도 안 씀 · `intake` 옵션: 사람 `kmd` · 태그 `intake` 를 받고 참고 줄을 달며 E_FORMAT 은 그대로 · `intake` 옵션 없이 `kmd` → E_FORBIDDEN · `attach` 같은 커밋 · 같은 sha 건너뜀 · 다른 sha E_CONFLICT · `assetPath` 가 `..` · `CON` · `:` 거절 · 남은 저널이 prepare 앞에서 되돌려짐 · `saveRecords` `serverTags` 가 held 를 붙이고 입력 held 는 거절) + `journal` · `guard` · `docformat` · `guide` · `final`(무인 커밋 0 그대로) · `edit`(curate R-A3).
- 끝 기준: 새 시험 녹색 · 지금 저장 길(옵션을 안 주는 부름)은 결과가 같다.

### S4 · 저장 문 서버 · MCP (K2-1 ~ K2-3 · K2-5 서버 정책 · K2-6 · K6-5 · savelog 쓰기 · S-D6 · S-D7 · S-D9 ~ S-D11 · S-D16 · S-D17 서버 · S-D28 · S-D29 · S-D49 · S-D52 · S-D54 의 `/save` · S-D55)

- 파일: `server/hub.js`(`canSave` · `save` 다시 쓰기 · prepare 의 새로 읽기 · `onCommit` · `checkSave` · `rateTake`(Map · 동기) · `sameKey`(prepare 안 · author 규칙) · `fixes` 대상 검사 · `savelog` · 커밋 뒤 try/catch · 제안 넣기 `applyProposals` · 그 길 · 914 알림 걷기) · `core/propose.js`(`checkProposal` 꼴 · doc+heading · `legacy-mix`) · `core/gate.js`(`spread` · `legacyPend`) · `server/mcp.js`(save: `memo` · `queue` 걷기 · note · 설명 글 · `you.direct = canSave`) · `server/http.js`(`/save` channel 화이트리스트 · `Retry-After` · `/proposal/:rec/put` 걷기 · `/tree` 수에 `held`) · `server/views.js`(`recRow.prop.review` 걷기) · `app/main.js`(`tdPropLine` · `tdPropPut` · `S.propBusy` · 「제안 있음 · 확인 대기」 칩 걷기 — 길과 한 커밋) · `CLAUDE.md` 「서버 · 저장」 새 규칙 · `docs/kmd_디자인_컨벤션.md` 9절 「제안 있음 · 확인 대기」 줄 걷기(S1 이 「S4 까지 화면에 남음」 을 달아 둠) · `docs/kmd_권한_모델.md` · `docs/kmd_문서_작성기준.md` · `docs_ops/kmd_서비스_전체.md` 의 「(S4 부터)」 표시를 지금 말로.
- 순서: 3-3 의 의사 코드대로. S-D3(저절로 메모)은 켜지 않는다(S13). `scheduleDecide` 는 `ingest/` 저장 뒤에만. `liveSoon` · `curateSoon` · `pendText` 는 S13 까지 둔다.
- 시험: `propose`(58 · 103 · 147 · 157 · 168 을 새 기본으로: 쓰기 자리 값 바꿈이 곧바로 `applied:true` · `state:'in'` · 커밋 하나 · 같은 저장 기록이 applied · stale 이면 E_CONFLICT 이고 git 깨끗 · 이름 없는 항목에 doc+heading 조각) · `save`(서버 부분 더함: 31번째 저장 429 · `md/` 같은 저장 `same` · **같은 md/ 저장 둘을 동시에 → 기록 하나** · 남(B)이 단 `md/` 는 A 의 저장을 막지 않음 · 메모 · 값 대조 실패 → held · baseline 블록 고침 → held `machine` · 되돌림 두 번 문서 → held `reverts` · 남의 기록에 `fixes` → 403 · `sent/` 를 session 으로 → E_INPUT · 앞 저장 직후 같은 항목 두 번째 저장이 헛 E_CONFLICT 없이 · savelog 줄 · savelog 쓰기가 던져도 응답 성공) · `k0`(70: 지식관리자 세션 저장이 문서까지 · note) · `access`(112 의 MCP save 부분 · note · docs) · `fixpack` · `wp3` · `tidy`(조각 없는 사람 기록은 그대로 `pend` · 정리가 넣음 — 녹색 그대로) · `final` · PC 쪽 `send`(「이 PC」) · `agent`(PC 부분 그대로 · S-D52) · `screen-kmd`(A8 929 ~ 959 를 「쓰기 자리 조각 → 바로 들어감 · [넣기] 없음」 으로 · 네 폭).
- 끝 기준: 팀 세션 저장이 커밋 하나로 기록 + 문서 · `grep -n "proposal/" server/http.js app/main.js` 0 · `applyProposals` 0 · tidy · final 녹색.

### S5 · 이력 · 되돌리기 (K2-5 · K-D13 · S-D12 ~ S-D14 · S-D53)

- 파일: `server/hub.js`(`history` · `revert` · 쓰기 자리 watched · 블록 막기) · `core/revert.js`(거르기 · 항목 `base` · 앞 판 없음 → `remove`) · `server/views.js`(`logKind` · `logRows`) · `server/http.js`(revert 몸 검사 · POST 만) · `app/main.js`(`HIST_KINDS` · `histRow` · `checkCard` · `revertToday` → `revertItem`) · `app/kmd.css`(`.vchg` 를 이력에서) · `docs/kmd_디자인_컨벤션.md` 9절 「확인할 것(이력 …)」 줄(S1 전 112줄 · S1 이 「S5 까지 화면에 남음」 을 달아 둠 · 「제안 있음 · 확인 대기」 줄(S1 전 114줄)은 S4 가 걷는다) · `app/styleguide.html`.
- 시험: `edit`(90 · 되돌리기 항목마다 · 권한 · 항목 하나 되돌린 뒤 원 기록 `in` · 모두 되돌리면 `reverted` · 새 항목 되돌림 → 항목 없어짐 · 되돌리기 전에 남이 고침 → E_CONFLICT · 쓰기 자리가 watched 항목 되돌리기 → 403) · `wp6`(109) · `wp3`(110 되돌리기 권한) · `screen-kmd`(A8 에 「이력에 옛 값 → 새 값 · [되돌리기] · 읽기 자리는 단추 없음」 을 더하고 이력 화면 네 폭).
- 끝 기준: 지식관리자 이력에 쓰기 자리의 세션 저장 줄이 보인다 · 쓰기 자리 B 에게 A 줄의 [되돌리기] 가 없다 · 항목 하나만 되돌린 뒤 다른 항목 되돌리기가 된다 · 되돌린 기록이 「개편 전 기록」 으로 보이지 않는다.

### S6 · 세션 스킬 · 스킬 판 · 측정 도구 (K3 · K2-4 · K12-2 도구 · S-D15 · S-D17 스킬)

- 파일: `agent/team/skills/kmd-team-save/SKILL.md`(`fixes` 는 내 앞 기록만) · `kmd-team-work/SKILL.md` · `agent/CLAUDE-kmd-team.md` · `core/teamkit.js`(`TEAM_KIT_REV = 2` · `{{KIT_REV}}`) · `server/mcp.js`(`kit` · `reinstall` · brief `mine` · `you` · `kit`) · `server/hub.js`(brief 셈) · 새 `scripts/savelog.mjs` · 새 `test/savelog.test.mjs` · `docs_ops/kmd_서비스_전체.md` 6-1 세션 줄.
- 시험: `teamkit`(60 rel 그대로 · 새 test 「스킬 글이 바뀌면 TEAM_KIT_REV 도 오른다」) · `k0`(brief 말) · `fixpack`(`notYetInDocs` → 새 말) · `savelog` · `save`(kit 없음 → `reinstall` · 저장은 됨).
- 끝 기준: 가짜 세션(MCP 부름)이 kit 2 로 저장하면 `reinstall` 없음 · 1 이면 있음 · `node scripts/savelog.mjs <시험 data>` 가 표를 낸다.
- **S6 에서 실제로 한 것(코드와 맞춤)**: ① `TEAM_KIT_REV = 2` 와 자리표 `{{KIT_REV}}`(스킬 글 · 팀 덩이)를 `teamKitParts()` 가 바꿔 싣는다(`rev` 도 돌려준다). 판 표는 `test/teamkit.test.mjs` 의 `KIT_HASH`(판 → `ver`). `ver` 는 바꿔 넣은 뒤의 글로 센다. 덩이 표지(`v=`)에 `r=` 는 더하지 않았다(아무도 읽지 않는다). ② `reinstall` 은 팀 서버 · 사람의 세션만(`ctx.agent` · 이 PC 빼고). `kit` 은 글 `"2"` · 수 `2` 둘 다 받고, 수 모양(1 ~ 6자리)이 아니면 없음(`have: null`)으로 본다. `same` 답에도 싣는다. 저장 전체가 실패한 답(E_CONFLICT 등)에는 싣지 않는다. ③ brief: 목록의 지식마다 `mine:{ memos, held }` · 지식 하나의 `you` 에 `memos · held · recent`(최근 5 · `{ id, date, title, state, why }` · why 는 넣지 못함 칸의 까닭) · 둘 다 `kit: TEAM_KIT_REV`. 셈은 `hub.mineIn(ctx, k, { recent })` 하나(쓴 사람 = 나 · 상태 memo · held · 바로잡힘은 빠진다 · 이 PC 는 null 이라 싣지 않는다). `notYetInDocs`(pend)는 조각 없는 사람 기록이 S13 까지 pend 라 그대로 두었다(말은 S10 의 `recOut` 과 같이) — 그래서 `fixpack` 은 고칠 것이 없었다. ④ savelog 줄에 `kit` · `ok` · `held[].why` 를 더했다(2-5). `conflictWith` 는 `gatePrepare` 가 어긋난 항목마다 그 항목의 `applied` 기록 쓴 사람을 `{ coord, by }` 로 모아 오류에 붙인다(응답 `details` 에는 싣지 않는다 · 측정 줄에만). `cost` 는 S7. ⑤ `scripts/savelog.mjs`: 9절 그대로 + `--root`(`--trend` 의 지식 폴더 · 없으면 data 폴더가 `.kmd` 일 때 그 위). 정리 장부 비교는 넣음 비율 · 자리 시간(`took[].ms` 중앙값)만(장부에 비용이 없다). 들이기 「일감 at → 끝」 시간은 일감이 S7 이라 아직 `ms / 조각` 만. 동시 쓰기 짝은 `채널 ↔ kmd(가져올 곳 · 정리) | 같은 사람 | 다른 사람 | 모름`. ⑥ `scripts/pack.mjs` 의 SRC 에 `scripts/savelog.mjs` 를 더했다(188 의 `/opt/kmd/scripts/savelog.mjs` 가 있게 · 파일 하나 복사 때 위 폴더를 만든다). ⑦ 스킬: `kmd-team-save` 를 다시 썼다(확정 묻기 → 메모 · 조각 늘 · 답 읽고 `fixes` 로 다시 · E_CONFLICT · E_RATE · 두 번 넘지 못하면 멈춤 · `kit`). `kmd-team-work` 1단계에 `mine` 한 줄 · 판 비교. 덩이에 확정 / 메모 · `mine` 줄. 「폴더째 넣기는 `kmd-team-import`」 줄은 S11(스킬이 아직 없다). 설명서(사용자 8절)에 확정 묻기 · 메모 · 「다시 설치」.
- **S6 검토**: ⑧ 스킬의 메모 단계가 「제목 · body 만」 이라 strict 가드(touches · touchesEmpty)에 걸리던 것을 「3단계의 touches(없으면 touchesEmpty)」 까지로 고쳤다(MCP `memo` 칸 풀이도) · 판 2 는 아직 배포 전이라 판을 올리지 않고 `KIT_HASH[2]` 만 새 해시로(배포한 판의 해시는 바꾸지 않는다). ⑨ `savelog.mjs --trend` 가 정리 판정 「두기」(kept)로 닫힌 넣지 못함을 계속 열린 것으로 세던 것을 그 판정 날에 닫히게(화면 · brief 의 셈 `recordState` 와 같게) · 정리 장부를 읽지 못하면 말없이 빼지 않고 stderr 에 한 줄.
- **사람**: 여기서 188 배포 · 2주 측정을 할지 정한다(K12-1). 이 문서의 뒤 단계는 측정과 상관없이 짤 수 있지만, 측정 결과로 S-D11 · S-D32 를 다시 볼 수 있다.

### S7 · 들이기 엔진 · 가져올 곳 (K7 · K8-1 · K7-3 · K10-2 일부 · K14-1 들이기 쪽 · K14-2 · S-D18 ~ S-D22 · S-D31 들이기 쪽 · S-D32 · S-D38 · S-D39 · S-D40 의 `jobTimer` · S-D43 · S-D47 · S-D48 · S-D50 · S-D51)

- 파일: `core/ingest.js`(`INTAKE_SCHEMA` · `intakePromptOf` · `intakeFixPromptOf` · `draftToSave`) · `core/worker.js`(`intakeOnce` · env 이름) · `core/models.js`(`ingest` 역할 · `touch` 남김) · `core/sources.js`(`intake` 콜백) · `server/hub.js`(`openJob` · `intakeCtx` · `intakeJob` · `intakeMaterial` · `intakeDone` · `intakeFail` · `sourceRun` 콜백 · `<jid>.bin` · `held/<rec>.*` 보관 · `job/` 멱등 · `jobTimer` · held part `names`) · `server/http.js`(`/worker/intake*` · POST · 입력 검사) · `core/gate.js`(`checkIngest` 에 `##` 0 거절) · `test/fixture/fake-claude.mjs`(첫 줄 `넣을 것을 지식에 들인다` 갈래 · `FAKE_CLAUDE_MODE=stale|bad` — `bad` 는 첫 답에 지어낸 값) · `core/claude.js` `ENV_ALLOW`(새 FAKE 변수를 쓰면) · `scripts/kmd-install.sh`(worker.env 덮지 않음) · `test/final.test.mjs:94`(허용 목록에 `'intake'`).
- 순서: 일감 꼴(2-6) → `openJob` · `intakeCtx` → 길 → 일꾼 → `sources.js` 콜백(runDocs · runCode · runTables 뜻 갱신) → `sourceRun` 의 정리 걸기 걷기 → `jobTimer`.
- 시험: 새 `test/intake.test.mjs`(일꾼 `workOnce` 한 번으로 커밋 하나 · 기록 author · `intake` · `job/` 태그 · 기록이 work/ 에 있고 상태 `in` · 가져올 곳 들이기의 author `kmd` 가 E_FORBIDDEN 없이 들어가고 항목 참고 줄에 남음 · 지어낸 값 → 고쳐 쓰기 두 번까지(본문 tries 를 속여도 서버 셈) · 그래도 → 기록만 + held 이고 `held/<rec>.md` 가 남음 · 재료 뒤 사람이 항목을 고침 → edits 는 다시 대 넣음 / content 는 held `conflict` · 커밋 뒤 일감을 `running` 으로 되돌려 다시 집음 → `same` · 같은 기록에 again 두 번 → 일감 하나 · queued 상한 → E_RATE · 그사이 자리를 잃음 → held `seat` · `noClaude` 지식 → held `noclaude`(file · again · fix 모두) · 새 문서 `##` 없음 → held `nosec` · 장부 밖 이름 → held part `names` · 24시간 넘은 queued → `jobTimer` 가 held `worker`) · `meaning`(50 · 102) · `watch2`(44: 일감 13 · 「새 10」 브레이크가 문서 폴더에는 없음을 확인) · `sources` · `analyze` · `wp5`(104 문구 · 임대) · `queue`(293 의 팀 줄은 들이기 일감 꼴로) · `final`(「무인 커밋 0」 · `intake` 태그) · `edit`(R-A3 이 바로잡힘을 버림으로 바꾸지 않음).
- 끝 기준: 문서 폴더 · git 가져오기가 정리 일감을 하나도 세우지 않는다 · `grep -n "holdWhy" core/sources.js server/hub.js` 의 가져오기 갈래 0 · 옛 `KMD_TIDY_BUDGET` 만 있어도 예산이 읽힌다 · 들이기 일감을 세우는 곳이 `openJob` 하나.
- **S7 에서 실제로 한 것(코드와 맞춤)**: 위 순서대로 일감 꼴(`jobs.json` 의 `kind:'intake'` 줄) · `hub.openJob` · `intakeCtx` · 일꾼 길 넷(`/worker/intake` GET · `/progress` · `/done` · `/fail` POST) · `core/worker.js` `intakeOnce` · `core/sources.js` 의 `intake(item)` 콜백(runDocs · runCode · runTables 뜻 갱신) · `sourceRun` 의 정리 걸기 걷기 · 팀 시계 `jobTimer`(`jobTick`)를 넣었다. 다음은 위와 다르게 했거나 더 정했다. ① **정리 일감 길은 S13 까지 남겼다**: `workOnce` 의 묶음 · 조각 · touches · 팀 에이전트 들이기(`agentIngest` · `workerAgent*` · S-D21)는 조각 없는 사람 기록이 S13 까지 `pend` 이고 정리가 넣으므로(S-D3) 지금 걷으면 정리가 멈춘다. `workOnce` 는 `/api/worker/next` 답의 `job.kind === 'intake'` 면 `intakeOnce` 로 보낸다. `KMD_TIDY_BATCH` · `KMD_TIDY_PATCH` 는 정리 일감에만 남고(`tidy.test` 가 쓴다) S13 에 걷는다. 그 밖의 새 이름(`KMD_WORKER_PAR` · `_JOBS` · `_TICK_MS` · `KMD_INGEST_BUDGET`(기본 1.0) · `_EFFORT` · `_FIX`)은 옛 `KMD_TIDY_*` 를 뒤 순서로 읽는다. ② `/fail` 의 `code` 허용 목록에 `missing` · `fail` · `shape` 를 더했다(`runClaude` 의 오류 꼴 그대로 · `timeout` 은 「시간이 넘었다」 글로 가른다). `login` · `limit` · `missing` 은 일감을 태우지 않고 다시 기다림(일꾼이 쉰다 · `workerStatus` 도 들이기 일감은 failed 가 아니라 queued 로)이고, 그 밖은 한 번으로 세어 마지막이면 기록만 + 넣지 못함(`claude`). ③ 일감 장부는 같은 `jobs.json` 이다. `hub.jobsOf` 는 정리 일감만, 새 `hub.intakesOf` 가 들이기 일감이다. 일 줄 · 지금 하는 일(`queueList` · `busy` · `t:` 손잡이)에는 들이기 일감을 따로 싣지 않고, 가져오기가 넘긴 일감은 그 가져오기 일의 줄에 결과 한 줄(「넣음 n · 넣지 못함 · 기록 id」)을 남긴다(들이기 일감의 화면 줄은 S8 의 파일 run · S10 의 넣지 못함). `/api/job/:id` 의 들이기 일감 비용 · 횟수는 지식관리자 이상만(`jobView`). ④ 시도 수는 둘로 나눴다: `tries`(초안 시도 · `/done` · `/fail` 이 올린다 · 마지막 = `tries ≥ ingestFix + 1`, 서버 값은 `serve.json` 의 `ingestFix` 또는 `KMD_INGEST_FIX`) · `leases`(임대가 지나 다시 기다림이 된 수 · 세 번이면 `closing` → 기록만 + 넣지 못함 `claude`). ⑤ 하루 들이기 수는 `<data>/intake-day.json`(원자 쓰기 · 다시 켜도 잇는다). ⑥ 넣지 못함 원천은 `<data>/held/<지식>/<기록>.md` · `.bin`(지식마다 폴더 · 기록 id 는 지식 사이에 겹칠 수 있다). 팀 시계가 그 기록이 넣지 못함이 아니게 되면(바로잡힘 · 버림) 걷는다. `deleteKnowledge` 는 `held/<지식>` 과 그 지식의 일감 원천을 지운다. ⑦ `INTAKE_SCHEMA` 의 `record` 에 `changes`(바뀐 것 목록)를 더했다. 기록 본문 = 요약 + `## 바뀐 것` + `## 원천`(원천 지문 · 원천 글을 줄마다 「> 」 로 6만 자까지). 원천을 기록에 인용으로 싣는 까닭: 항목 검사(`checkSection`)의 값 근거가 기록 본문이라, 원천이 없으면 파일의 값이 모두 「근거에 없는 값」 이 된다. 「> 」 는 원천 속 `## 넣은 것` 같은 머리가 kmd 칸 · 서식 칸으로 읽히지 않게 한다. `draftToSave` 는 기록(제목 · 요약 · 바뀐 것)과 글(새 글 · 조각의 replace) 모두에서 원천 · 지금 글에 없는 값을 찾아 「근거에 없는 값이 있다」(고쳐 쓰기)로 돌린다 — 기록에만 지어 넣으면 항목 검사가 그것을 근거로 보기 때문이다. ⑧ 넣을 곳이 하나도 없는 초안(문서와 상관없는 커밋 등)은 기록만 + 넣지 못함(`notfound` 「넣을 곳을 고르지 않았다」). 기록만 남은 들이기가 「개편 전 기록」 `pend` 로 정리에 집히지 않게 한다. ⑨ 마른 검사가 고쳐 쓰기로 돌리는 것은 넣지 못함 `code` 가 `values` · `format` · `edits` 인 것이다(옛 정리의 `FIXABLE` 글 맞춤 대신). 후보 밖 문서(`notfound`) · `nosec` · 지문(`conflict`) · 원본이 주인 · 표 · `legacy-mix` 는 고쳐 쓰지 않고 그대로 넣지 못함. ⑩ 들이기의 지문은 일꾼에게 보인 후보 · 지문(`job.seen` · 재료를 줄 때 적는다)으로 본다(일꾼 · Claude 가 보낸 `base` 를 믿지 않는다). 지문이 어긋난 `edits` 조각은 `gatePrepare` 가 새 글의 지문으로 한 번 다시 대고(되면 경고 「같은 조각을 새 글에 다시 대어 넣었다」), 안 되면 `conflict`. `content` 조각은 다시 대지 않는다. ⑪ 이 PC 의 가져올 곳은 지금 길 그대로다: 파일은 `importFiles`(파일 하나씩 · `offset` 으로 Claude 다듬기 20 개 상한을 한 번 가져오기 안에서 이어 센다) · 커밋은 `analyzeCommit`(켰으면) + 기록 저장(이름이 없으면 기록에 `touchesEmpty` 를 직접 · `holdWhy` 를 걷었다). 그래서 `intake` 결과 꼴에 `record`(기록만 남겼다 · 저장 즉시 넣기가 넣는다)와 `skip` 을 더했다. ⑫ 쓰기 자리 저장 · 들이기 저장의 장부 밖 `names` · `forms` 에 넣지 못함 part(`names` · 기록 단위)를 켰다(S4 ① 이 미룬 것). 들이기는 지식관리자가 연 일감이어도 늘 칸으로(S-D43). ⑬ `intakeCtx` 의 명부는 http 가 끼우는 `hub.userOf`(auth 의 사람 줄 · 꺼진 사람은 없음)다. hub 만 쓰는 곳은 있는 사람으로 본다. ⑭ `again` · `fix` · `polish` 일감은 `openJob` 이 꼴 · `noClaude` · 열쇠 · 한도만 본다. 일꾼 쪽 재료 · 프롬프트(정정 · 다듬기)는 S9 · S10 · S13. ⑮ 문서 폴더에는 「새 10」 브레이크가 없다(사라짐 10% 만 · K7-2 그대로) — 서비스 전체 6-3 의 「새 10 넘게」 를 바로잡았다. runCode 는 브레이크가 없고 한 번에 20 묶음이다. ⑯ 일꾼 시간 넘김 글을 「다음 정리 때 다시」 → 「나눠 넣거나 다시 시도한다」 로. 모델 역할 `tidy` → `ingest`(옛 `pc.models.tidy` 를 읽고 고르면 옮긴다 · 설정 화면 「들이기 초안」). ⑰ savelog 의 `cost` 는 들이기 저장에서 `{ usd, calls }`(일꾼이 알린 비용 합 · 횟수)이고, 새 항목을 세우며 이름을 싣지 않으면 `warn: ['names-missing']`(S-D32). 채널은 가져올 곳 `intake-src` · 그 밖은 `intake-<꼴>`. ⑱ 가져오기 결과 꼴이 `intake` 결과(`queued` · `put` · `held` · `same` · `fail` · `skip` · `record`)로 바뀌어 옛 칸 `runs` 는 없다. 이 PC 의 문서 폴더가 Claude Code 일로 넘긴 파일은 `queued` 줄이고 그 줄에 일 id `run` 을 싣는다(`agent.test` 를 이 꼴로 고쳤다). 사람에게 가는 오류 글은 금지어(「커밋」 · 「원천」)를 쓰지 않는다(「코드 바뀜」 · 「들일 글」).

### S8 · 팀 화면 파일넣기 (K5 · K6-1 의 `fileToMd` · S-D30 화면 · S-D33 ~ S-D35)

- 파일: `core/importer.js`(`TEAM_IMPORT_MAX` · `fileToMd` · `planImport` 의 `attach`) · `server/http.js`(`/import` 한도 · 팀 요청 64MB · `attach`) · `server/hub.js`(`importFiles` 팀 갈래 · 첨부 판정 2776 을 `canSave` · `groupJob` 누계 · `openJob`) · `core/queue.js`(`STAGES` 이름 · 상수) · `app/main.js`(`viewImport` · `takeFiles`(64MB 넘으면 group 으로 쪼갬) · `impAtt` · `mgItems` 쓰기 자리 · `STG` · `STG_SUB` · 행 글 · `AUTO_T.team.file`) · `docs/kmd_디자인_컨벤션.md` 9절 「짓기」 · `docs_ops/manual/사용자.html` 6절 · `개인.html` 파일넣기 단계 글 · `kmd_서비스_전체.md` 6-2.
- 시험: `send`(103: 21개 → `E_INPUT` · 첨부 기본 해제 · 정리 일감 단언 → 들이기 결과 · 같은 파일 `same`) · `queue`(152 단계 이름 · 173 그만두기 → 기록 없음 또는 held) · `agent`(178 팀 갈래: 에이전트가 아니라 `claude -p` 들이기 · 281 PC 그대로 · **PC 화면 단계 이름 「짓기」**) · `cost`(importer 순수) · `settings`(164) · `screen-kmd`(382 ~ 497: 21개 → `impMany` callout · `impAtt` 기본 꺼짐 · 행 글 · 쓰기 자리 메뉴 · 네 폭 · PC 파일넣기 머리 글).
- 끝 기준: 팀 화면에서 파일 하나 = 일 줄 run 하나 = 저장 하나 = 커밋 하나 · PC 파일넣기 시험(`agent` PC 부분)이 단계 이름 말고 그대로 · 64MB 넘는 팀 요청은 413.

### S9 · 고치기 (K4 · S-D6 · S-D23 · S-D44 의 `structure`)

- 파일: `server/hub.js`(`edit`(`structure` = admin) · `fixRecord`(`openJob`)) · 새 `core/fix.js` · `server/http.js`(`/rec/:rec/fix` · POST · 입력 검사 · `edit` direct) · `app/main.js`(편집기 말 · `saveDoc` E_CONFLICT · `recFix` 창) · `test/fixture/fake-claude.mjs`(정정 갈래) · `docs_ops/manual/사용자.html`(고치기 절).
- 시험: `edit`(50: 쓰기 자리 `direct:true` · 문서 바뀜 · 쓰기 자리 rename → E_FORBIDDEN) · `wp6`(62 ~ 92 를 새 정책으로 · 136 ~ 165 편집기 그대로) · `access`(112 의 edit 부분) · `access-ui`(읽기 자리 `editBtn` 흐림 그대로) · 새 `test/fix.test.mjs`(옛 값이 한 곳 → 규칙으로 커밋 하나 · `FAKE_CLAUDE_LOG` 로 claude 0번 · 두 곳 → 일감 `fix` → 일꾼 → 한 저장 · 남의 기록 정정은 쓰기 자리 403 · 원 기록은 그대로 · `recView.fixedBy` · GET 이면 405 · `from === to` 400) · `screen-kmd`(편집기 E_CONFLICT · `recFixWin` 네 폭).
- 끝 기준: 쓰기 자리 화면 고치기가 바로 문서에 들어가고 이력 「고침」 줄에 옛 값 → 새 값 · 정정 기록이 규칙으로 끝나면 Claude 를 부르지 않는다.

### S10 · 넣지 못함 (K8 · K10-3 · S-D24 ~ S-D26 · S-D42 · S-D51 화면 · S-D54 의 `touches`)

- 파일: `server/hub.js`(`heldList` · `heldAgain` · `heldDrop` · `heldNames` · `heldAgainAll` · feed `held` · history `kindOf`) · `server/http.js`(`/held*` · `rec/:rec/touches` POST 만) · `server/views.js`(`knowledgeRow(k,user)` · `recRow` · `docView` · `docPend` → `docHeld`) · `server/mcp.js`(`notYetInDocs` · `recOut`) · `app/main.js`(4-8 의 화면 전부 · 팀 메뉴에 `held` **더하기** · screens 지도 1-B 표의 「반영 대기」 모든 곳 · 정리 화면 안의 것은 S13) · `app/kmd.css`(`hd-*`) · `docs/kmd_디자인_컨벤션.md` 9절 「반영 대기 n」 · 「넣을 곳」 줄(S1 전 105 · 106줄 · 정리 화면 탭 줄은 S13) · 5절 64 · 70 · 74줄 · `CLAUDE.md` 「말」 줄(S1 뒤 28줄) · `app/styleguide.html` 182 · 269 · `docs_ops/manual/지식관리자.html` 1 · 2절(새 `id="held"` 절 · 옛 `id="tidy"` 는 S13 까지).
- 시험: 새 `test/held.test.mjs`(목록 자리 거르기: 쓰기 자리는 자기 것만 · 읽기 404 · again → 일감 → 넘으면 원 기록 `fixed` · 같은 기록 again 두 번 → 일감 하나 · drop → `kept` · 이력 「버림」 · names → 장부에 이름 · 원 기록 `fixed` · again-all 이 「개편 전」 만 · 두 번 눌러도 일감이 늘지 않음 · 넣을 곳 고르기(`touches-fix`)만으로는 목록에서 빠지지 않음 · GET 이면 405) · `access`(197 은 S13 까지 그대로 · 넣지 못함 목록의 자리 거르기를 더함) · `wp9`(48 → 이력 sub 「들어갔다 / 넣지 못함 · 까닭 / 메모」) · `k0` · `fixpack` · `screen-kmd`(91 ~ 240 의 「반영 대기」 단언 → 「넣지 못함」 · 855 팀 네 폭 목록에 `held` 를 **더함**(`tidy` 는 S13 까지) · 새 넣지 못함 화면 시험 네 폭 · `BANNED`) · `open`(설명서 링크).
- 끝 기준: 정리 화면 밖의 화면 · 기준 문서 · CLAUDE.md 에 「반영 대기」 가 옛 기록 읽기 말고 없다(`grep -rn "반영 대기" app/ docs/kmd_디자인_컨벤션.md CLAUDE.md` 가 정리 화면 덩어리만) · 네 폭 잘림 0.

### S11 · 대량 넣기 · 설치 안내 (K6 · K11 · K-D9 · K-D16 · S-D30 의 MCP 한도)

- 파일: 새 `server/bin/kmd-parse.mjs` · `scripts/pack.mjs`(`packParser` · import 그래프 검사) · `scripts/kmd-install.sh`(zip 복사) · `server/http.js`(`parserPackage` · `/api/agent/parser` · `/mcp` 본문 한도 로그인 ctx 12MB) · `server/mcp.js`(brief `parser` · save `attach`) · 새 `agent/team/skills/kmd-team-import/SKILL.md` · `core/teamkit.js`(`TEAM_SKILLS` · 작성가이드 사본 · `TEAM_KIT_REV` 3 · `teamAgentPs` 의 Claude Code 확인 · 끝 말 `$r.skillNames`) · `agent/CLAUDE-kmd-team.md` · `app/main.js`(`agentInstallCard` · `viewInstall` lead · 옆 메뉴 이름 · `viewFirst` 2444) · `docs_ops/manual/사용자.html` 9절 · `개인.html` 1절 · `kmd_서비스_전체.md` 9-3 · `docs/설명서_개발자.md` 18 · 20줄.
- `/a/` 의 Claude Code 확인(K11-1): `KMD_SKIP_CLAUDE_CHECK` 가 없을 때만 · `Get-Command claude` → 없으면 「· Claude Code 가 이 PC 에 없다. 깔고 이 폴더에서 claude 를 연다」 · 있으면 `auth status` 출력에 `loggedIn: true` 와 종료 0 → 「✓ Claude Code 로그인을 보았다」, 아니면 「· Claude Code 에 로그인되어 있지 않다. 터미널에서 claude auth login」 · 모르면 「· 확인하지 못했다: claude 를 열어 로그인 상태를 본다」. `return` 없이 지나간다. 글에 영어 `connect` · `/dl/` 를 넣지 않는다.
- 시험: 새 `test/parse.test.mjs`(docx · hwp · txt 하나씩 `kmd-parse` 출력 · `sha` 가 importer `md/` 와 같음 · 없는 파일 `why`) · 새 `test/pack-parse.test.mjs`(zip 목록 · 같은 내용 같은 `pver` · 묶음 밖 import 면 실패) · `teamkit`(60 배열에 import · 136 ~ 140 파일 존재 · 83 금지어 그대로 · env `KMD_SKIP_CLAUDE_CHECK=1` · 확인 갈래는 가짜 `claude.cmd` 로 따로) · `screen-kmd`(117 옆 메뉴 · 527 ~ 561 설치 화면 · `agGuide > li` 수 · 네 폭) · `kit-area` · `save`(`same` 이어 하기 · MCP `attach` 3MB 가 들어감 · 로그인 없는 3MB 본문은 413).
- 끝 기준: `node scripts/pack.mjs` 가 `kmd-parse-<pver>.zip` 을 낸다 · 가짜 세션이 스킬대로 두 파일을 넣고 다시 돌리면 `same` 둘.

### S12 · 보내기 (K9 · S-D36)

- 파일: `core/send.js`(`mcpCall` · 429 `Retry-After`) · `server/hub.js`(`sendPicked` · `deliver` · `receive` 의 `serverTags` held · 속도 통 건수) · `core/ingest.js`(`from:'send'` 갈래) · `app/main.js`(보내기 화면 글 · 넣지 못함 줄 · [다시] 의 `fixes` · `traceHtml` · `sentState`) · `docs_ops/manual/개인.html` 보내기 절 · `kmd_서비스_전체.md` 6-4.
- 시험: `send`(158 · 188 · 222 를 조각 저장으로: 받는 쪽 문서가 바뀜 · 같은 것 다시 → `same` · 못 넘으면 `fail` 줄 · [다시] 뒤 옛 held 가 `fixed` · 429 를 받으면 쉬고 다시(fail 줄 아님) · `noClaude` 팀 지식 → Claude 0번 · held `noclaude`) · `send-ops`(115 · 129 · 옛 `/receive` 는 held 로 · 속도 한도 건수) · `screen-kmd`(750 ~ 853 개인 화면 보내기 · 네 폭).
- 끝 기준: 보낸 것이 팀 문서에 그 순간 들어가거나 넣지 못함으로 · 「정리 때」 말 0.

### S13 · 정리 걷기 · 저절로 메모 · 다듬기 · 마무리 (K10-1 · K10-2 · K10-4 · K10-5 · K14-1 옮기기 · K1-4 나머지 · S-D3 · S-D21 · S-D31 의 `liftH3` · S-D37 · S-D39 ~ S-D41 · S-D46 의 `cutoverAt`)

- 파일: 8-1 표 전부 · 새 `core/pcplace.js`(`ingestRule` 포함) · `core/docformat.js`(`liftH3` + `_managed.md` 한 커밋 · `verifyConvert`) · `server/hub.js`(S-D3 저절로 메모 · `cutoverAt` 처음 쓰기 · `polish`(`openJob`) · `inboxTimer` · `idle` · 1868 알림 · `pendText` · `liveSoon` · `curateSoon`(팀) 걷기) · `server/http.js`(팀 모드 `kmda_` 끔 · `/polish` POST) · `app/main.js`(다듬기 단추 · 정리 화면 걷기 · 팀 메뉴 `tidy` 걷기 · `#tidy` → `#held`) · 설명서 다섯 편 나머지(지식관리자 `id="tidy"` 걷음) · `docs/설명서_개발자.md` · `docs_ops/kmd_서비스_전체.md` 남은 「정리」 · 설명서 그림(`t-held.png` 새로 찍기, 서비스 전체 227줄 방법) · `docs/kmd_디자인_컨벤션.md` 9절 옛 말 줄 걷기 · `CLAUDE.md` 「말」.
- 순서: (1) `pcplace.js` 로 PC 갈래 옮기고 `tidy.js` · `curate.js` 지우기 (2) hub · http · mcp 정리 장치 걷기 + S-D3 켜기 + `cutoverAt` (3) 화면 걷기 (4) 다듬기 길 · 단추 (5) `liftH3` (6) 시험 고치기 · 걷기 (7) 문서.
- 시험: `tidy.test` · `tidy-plan.test` 는 **걷는다**(값 장부 266 · 385 · 고쳐 쓰기 281 · 296 · 조각 336 은 S4 · S7 에서 `save` · `intake` 로 이미 옮겼는지 확인한 뒤) · `tidy-plan` 의 `slots` · `sweepProjects` 단언은 새 `test/worker.test.mjs` 로 · S-D3 에 걸린 것: `final`(71 ⑧ 팀 = 조각 없는 기록은 메모 · 조각은 저장 곧바로 · `deepEqual(pc, team)` 은 PC 갈래만) · `wp5`(104 · 107 정리 일감 임대 → 들이기 일감 · 157) · `wp9`(58) · `edit`(69 `HUMAN_ANSWER` 걷기 · 70 ~ 74 decide 의 `nowhere` · `kept` → 메모 · 버림) · `queue`(293) · `access`(197) · `screen-kmd`(242 ~ 380 정리 화면 → 걷고 이력 부분 370 ~ 379 는 남김 · 855 팀 목록에서 `tidy` 빼기 · 499 `mgItems` · 635 「로그인됨 · 팀 일꾼」 · 다듬기 단추 · 네 폭) · `owners`(47 · 58 · 90 · 161 옛 줄 읽기) · `fixpack`(92 · 94) · `docformat`(179 import · `liftH3` 가 장부를 같이 고침 · 장부 이름이 항목에 닿음) · `guide`(75 import) · `agent`(PC `touch` 역할 · PC `ingestNow` 규칙 들이기 그대로) · `send` 의 `curateIdle` → `idle` · `settings`(67 · 86 · 118 문구) · `open`(설명서) · `send`(342 · 390 「이 PC」 그대로 넘는지) · 새 다듬기 시험(`intake.test` 안: 값 장부가 같은 항목만 들어감 · `noClaude` 거절 · 같은 문서 두 번 → 일감 하나).
- 끝 기준: `grep -rn "tidy" core server app --include=*.js` 가 옛 기록 읽기 · `tidy/<id>.json` 지우기(`deleteKnowledge`) · env fallback 말고 0 · PC 「저장 즉시 넣기」 시험(`send` 「이 PC」)이 그대로 · 팀 사람 기록이 새로 `pend` 가 되지 않는다 · KMD_개편_TODO 의 K1 ~ K14 줄이 모두 `[x]`(K12-2 · K12-3 · K13 은 사람 몫 · 나중이라 열림).

---

## 11. 남는 위험 · 이번에 하지 않는 것

- **S4 와 S13 사이**: 조각을 실은 저장은 곧바로 들어가거나 held 가 되지만, 조각 없는 사람 기록은 S13 까지 지금처럼 `pend` 이고 정리 시계 · 실시간 정리가 넣는다(S-D3 을 S13 에 켠다 · 시험이 녹색으로 남게). 정리 재료가 `held` · `memo` 를 집지 않게 `material()` 은 `state === 'pend'` 만 본다(D-10) — S3 에서 확인한다. 같은 항목에 「정리가 넣을 `pend`」 와 세션 조각이 섞이면 세션 조각은 held `legacy-mix`(S-D55) — S13 전에는 이것이 넣지 못함에 자주 보일 수 있다.
- **개인 프로그램 정해진 시각 다시 넣기**: 정리 시계 안의 PC 갈래(정해진 시각 `tidyNow`)가 S13 에서 함께 걷힌다. PC 는 `curateSoon` 과 켤 때 넣기가 맡으므로 영향은 작다(S-D40).
- **빈 문서**: 새로 세운 항목을 되돌리면 항목은 지우지만(S-D53) 그 기록이 세운 문서는 비어도 남는다. 지식 점검이 「빈 문서」 로 알리고 지우기는 지식관리자가 한다.
- **파서 꾸러미 무결성**: `kmd-parse` zip 의 sha256 은 같은 서버에서 받으므로 깨짐만 막고 위변조는 못 막는다(지금 PC 꾸러미와 같은 위험이 넓어진다). 서명은 이번에 하지 않는다.
- **K8-2 세션 알림**: 세션 · HTTP 저장의 넣지 못함은 응답과 brief 의 `mine` 으로만 알린다(feed 줄을 더하지 않는다).
- **들이기 일감 몰림**: 문서 폴더에 새 파일 수백 개가 들어오면 일감이 그만큼 선다(문서 폴더에는 「새 10」 브레이크가 없다). K7-2 「그대로」 를 지키고 savelog 로 본다. 필요하면 사람이 정해 브레이크를 더한다.
- **동시 쓰기(K12-4)**: 세션 E_CONFLICT 는 아무것도 쓰지 않고, 들이기는 한 번 다시 댄다. 같은 항목에 세션과 가져올 곳이 겹치는 빈도는 savelog `conflictWith` 로만 안다.
- **collect · docfmt · baseline · 표 블록**은 저장 문(K-D2) 밖에 남는다(D-8). 값 이력이 없다는 것을 권한 모델 7절에 적는다(S1).
- **PC 의 저장 즉시 넣기**(section · touches 엔진)는 `core/pcplace.js` 로 옮겨 그대로 둔다. 개인 지식도 같은 저장 문으로 바꾸는 일은 이 개편 밖(K-D8) — 종합검토 「따로 할 것」 에 한 줄 더한다.
- **K13 찾기 · K15 범위 줄이기**: 코드 할 일 없음. `runDb` · `hub.baseline` 에는 손대지 않는다.
- **188**: 배포 · `worker.env` 이름 바꾸기 · `jobs.json` 의 도는 일 확인은 사람이 정할 때 CLAUDE.md 절차로 한다. 이 설계의 어느 단계도 188 에 닿지 않는다.

---

## 12. 검토에서 걷은 지적

검토 셋(정합성 R-1 ~ R-22 · 권한 P-1 ~ P-18 · 실현성 D1 ~ D25)은 HEAD `d07dcde` 코드와 대조했다. 아래 말고는 모두 받아 1 ~ 11절에 반영했다(받은 것: R-1 ~ R-14 · R-16 ~ R-22 · P-1 ~ P-17 · D1 ~ D17 · D19 ~ D25).

| 지적 | 걷은 것 | 까닭 |
|---|---|---|
| D18 「values.js ↔ save.js 순환에서 TDZ 오류가 난다」 | 「오류가 난다」 는 걷음(옮기기는 함) | `valuesOf` 는 `save.js` 의 함수 선언(217)이라 끌어올려지고, `mustValues` 등도 함수 안에서만 부른다. ES 모듈 순환은 최상위에서 상대 `const` 를 읽을 때만 TDZ 다. 그래도 규칙을 줄이려고 S2 에서 `valuesOf` 를 옮긴다(3-1). |
| R-15 「그 기록이 세운 문서에 남은 항목이 없으면 문서도 같은 저널로 지운다」 | 문서 지우기만 걷음(항목 `remove` 는 받음) | core 저장 문에 문서 지우기 길이 없어 새로 만들어야 하고, 남이 그 문서에 둔 머리말 · 요약까지 지울 수 있다. 빈 문서는 점검이 알리고 지식관리자가 지운다(11절). |
| P-4 첫 안 「되돌리기를 비system `asRevert` 저장으로」 | 둘째 안을 고름 | 되돌리기는 옛 `applied` 표지를 되살리고 `reopens` 를 써야 해 system 이 필요하다. 대신 지식관리자가 아닌 되돌리기에서 watched · 표 블록 항목을 막고(S-D53) 항목 `base` 로 덮어쓰기를 막는다. |
| D11 첫 안 「장부 밖 이름을 G1 검사를 넘으면 쓰기 자리도 바로 세운다」 | 둘째 안을 고름 | 권한 모델 1절(장부는 지식관리자)을 넓히는 일이라 이 개편 밖이다. 넣지 못함 목록의 `names` part 와 [이름 세우기] 로 지식관리자에게 보인다(S-D51). |
| D1 둘째 안 「깨지는 시험을 S4 목록으로 옮겨 S4 에서 고친다」 | 첫 안을 고름 | S4 에서 고치면 정리(tidy)가 살아 있는 동안 「조각 없는 기록 = 메모」 와 「정리가 pend 를 넣는다」 가 함께 돌아 시험이 그 사이 상태를 단언하게 된다. S-D3 을 정리 걷기(S13)와 함께 켠다. 길 `/proposal/put` 과 화면 [넣기] 는 S4 한 커밋으로 묶는다(D1 의 같은 지적 · 걷은 것 아님). |
| R-9 고칠 것 「`k.superseded` 는 `intake` 태그 나중 기록만 센다」 | 「intake 만」 을 걷음 | 세션 다시 저장(S-D17)과 보내기 [다시](S-D36)도 `fixes` 로 바로잡는다. 누가 `fixes` 를 실을 수 있는지는 쓸 때 막고(S-D17 · P-2), 읽을 때는 held 아님 · `touches-fix` 아님만 본다(S-D46). 넘겨받기(`k.handedOff`)는 `intake` 만. |

