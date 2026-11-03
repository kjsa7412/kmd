# kmd 서비스 전체

kmd 를 처음부터 끝까지 한 장에 담는다. 무엇을 하는 서비스인지, 무엇으로 이루어졌는지, 지식이 어떤 모양으로 어디에 놓이는지, 누가 무엇을 할 수 있는지, 일이 어떤 흐름으로 도는지, 어떻게 깔고 올리고 지키는지. 그림으로 보는 판은 [kmd_서비스_전체.html](kmd_서비스_전체.html), 화면별 쓰는 법은 [설명서](manual/)(서버에서는 `<서버 주소>/manual`)다.

기준일 2026-11-02 · 판 0.1.0(꾸러미 이름 `<판>-<날짜>-<시각>`).

## 1. 한 줄로

**팀과 내 PC 의 지식(md 문서 · 기록 · 정리)을 사람은 화면으로, Claude Code 세션은 MCP 로 같이 읽고 쓴다.** 고친 것은 기록으로 남고, kmd 가 정해진 때에 기록을 문서의 항목에 넣는다(정리). 지식 하나는 폴더 하나 · git 저장소 하나이고, 저장마다 git 한 묶음이 되어 백업 자리로 밀린다.

| 무엇을 푸나 | kmd 의 답 |
|---|---|
| 팀 문서가 흩어지고 낡는다 | 지식마다 한 폴더 · 항목(`## 머리`) 단위로 나누고 이름(테이블 · 화면 · 절차 · 용어)을 장부에 세운다 |
| 누가 무엇을 바꿨는지 모른다 | 쓰기는 늘 기록을 남기고, 정리는 단계마다 이력 · 되돌리기를 남긴다 |
| Claude Code 가 팀 사정을 모른다 | 작업 폴더에 팀 지식을 붙이면 세션이 일 전에 사실을 찾아 읽고(brief · match · search · section), 일 뒤에 배운 것을 남긴다(save) |
| 옛 자료(오피스 · pdf · hwp · 코드 · DB)가 지식이 되지 않는다 | 파일 넣기 · 가져올 곳이 글로 바꾸고 기록으로 남겨 정리가 항목에 넣는다 |
| 개인 메모가 팀에 섞인다 | 개인 프로그램은 내 PC 에만 · 팀으로는 고른 기록 · 문서만 「지식 보내기」 |

## 2. 짜임

| 부분 | 어디서 도나 | 하는 것 |
|---|---|---|
| **팀 프로그램**(팀 서버) | Linux · `kmd serve` · systemd `kmd.service` · 기본 포트 8090(테스트 서버) | 팀 지식 · 팀 화면 · 사람 · 권한 · 정리 일감 · 가져올 곳 · 백업 · MCP(`kmd-team`) · 설명서 `/manual` · PC 꾸러미 받기 `/dl` |
| **정리 일꾼** | 팀 서버 · `kmd-worker.service` · 정리 전용 Claude 로그인 | 일 줄에서 정리 · 들이기 일감을 받아 Claude Code 로 항목 초안을 쓴다. 쉬면 서버가 규칙으로 넣는다 |
| **개인 프로그램** | Windows PC · `kmd up` · `127.0.0.1:7373` · 작업 스케줄러로 늘 켜기 | 개인 지식(`D:\kmd`) · 개인 화면 · 파일 넣기 · 편집기 직접 고침 감시 · 지식 보내기 · MCP(`kmd`) |
| **Claude Code** | 사람의 PC · 작업 폴더 | 연결 `kmd-team`(팀) · `kmd`(개인) 과 스킬(`kmd-team-work` · `kmd-team-save` · `kmd-work` · `kmd-save` · `kmd-build`)로 지식을 읽고 남긴다 |
| **백업 자리** | GitLab(봇 · 만들기 권한만) · 폴더 · https · ssh | 지식마다 git 저장소. 저장 뒤 바로 밀고, 안 되면 다시 |

두 화면은 서로를 부르지 않는다. 팀 화면은 팀 서버에만, 개인 화면은 개인 프로그램에만 붙는다. 둘 사이의 길은 Claude Code 연결 둘과 **지식 보내기**(개인 → 팀 · 기기 열쇠) 뿐이다.

## 3. 말(용어집)

| 말 | 뜻 |
|---|---|
| 지식 | 폴더 하나 · git 저장소 하나. 팀 지식(팀 서버) · 개인 지식(내 PC) |
| 문서 | 지식의 `docs/**.md` 한 파일 |
| 항목 | 문서 안의 `## 머리` 한 덩이. 정리 · 링크 · 출처의 단위 |
| 이름 | 항목을 가리키는 `종류:값`(예 `table:tb_user` · `proc:배포승인`). 이름 장부 `_vocab.md` · 자리 장부 `_managed.md` |
| 갈래 | 새 문서가 설 수 있는 문서 묶음(예 회의록). 갈래 장부 `_forms.md` |
| 기록 | `work/<id>.md`. 사람 · 세션 · 파일 · 코드 묶음이 남긴 글 하나. 그 자체로 지식이 될 글만 |
| 정리 | 기록을 문서의 항목에 넣는 일. 모으기 › 자리 찾기 › 글 쓰기 › 검사 › 넣기 |
| 반영 대기 n | 아직 문서에 넣지 않은 기록 수 |
| 참고 · 출처 | 문서 끝 `<!-- kmd:참고 -->` 블록. 항목마다 어느 기록에서 들어왔나 |
| 일 줄 | 가져오기 · 정리 일감이 차례로 서는 줄. 수집 › 검토 › 기록 생성 › 문서 생성 |
| 가져올 곳 | 정한 때마다 다시 보는 문서 폴더 · 소스 코드(git) · DB |
| 자리 | 사람이 지식 하나에 갖는 권한: 없음 · 읽기 · 쓰기 · 지식관리자 |
| 총괄 관리자 | 사람에 붙는 자격. 모든 지식의 지식관리자 + 서버 일 |
| 기기 열쇠 | PC 마다 사람 이름으로 만든 열쇠(`kmdk_`). Claude Code 연결과 지식 보내기가 쓴다 |
| 살림 자리 | 지식 폴더의 `.kmd`: 명부 · 상태 · 비밀 · 색인 · 일 줄 |
| 취소 · 잠깐 멈춤 · 그만두기 | 창 닫기 · 이어 할 수 있게 세우기 · 도는 일을 끝내기 |

## 4. 지식의 모양

```
<지식>/
  README.md            지식 이름(# 제목)
  docs/**.md           문서(항목 = ## 머리) · 문서 끝 <!-- kmd:참고 --> 블록
  docs/assets/         첨부(넣은 원본 · 그림)
  work/<id>.md         기록(frontmatter: id · title · date · author · touches · tags …)
  _vocab.md            이름 장부(종류:값 · 보이는 이름 · 다른 이름)
  _managed.md          자리 장부(이름 → 문서 · 머리)
  _forms.md            갈래 장부(새 문서가 설 수 있는 곳)
  _members.md          주인 · 지식마다 자리 · 정리 설정(백업과 같이 간다)
  _sources.json        가져올 곳
  .git/                저장마다 한 묶음 · 백업 자리로 밀기
<지식 폴더>/.kmd/      살림 자리: auth.json · auth.log · owners.json · secrets.json · jobs.json · 색인
```

- 본문에는 **확정된 지식만**. 경위 · 초안 · 아직 넣지 않은 기록은 본문에 두지 않는다. 시스템 참고 정보는 문서 끝 참고 블록과 표지 셋(`applied` · `watched` · `baseline`)에만.
- 링크는 문서(`x.md`) · 항목(`x.md#머리`) · 바깥(`https://…`) 셋만.
- 쓰는 길은 `core/save.js` 하나(기록은 늘 남는다 · 같은 지식의 저장은 한 줄로 선다 · 실패하면 되돌린다). 문서를 쓰는 길은 모두 저장 검사(`E_FORMAT`)를 거친다.
- 기준: [docs/kmd_문서_작성기준.md](../docs/kmd_문서_작성기준.md) · 서식 [docs/템플릿/](../docs/템플릿/).

## 5. 사람과 자리

| 일 | 총괄 관리자 | 지식관리자 | 쓰기 | 읽기 | 없음 |
|---|---|---|---|---|---|
| 그 지식이 보인다 · 찾기 · Claude 로 읽기 | ✓ | ✓ | ✓ | ✓ | |
| 기록 남기기 · 파일 넣기 · 가져오기 부탁 · 자기 기록 되돌리기 | ✓ | ✓ | ✓ | | |
| 바로 고치기 · 정리(남의 기록) · 되돌리기 · 지식 설정 · 권한 주기 · 가져올 곳(허락된 호스트) | ✓ | ✓ | | | |
| 사람 · 묶음 · 지식 세우기/지우기/되살리기 · 주인 넘기기 · 백업 · Claude 연결 · 일 줄 멈춤 · 동시에 도는 수 · 서버 폴더 · ssh | ✓ | | | | |

- 받지 않은 지식은 **없음**이 기본이다. 실제 자리는 사람 줄과 묶음 가운데 높은 것.
- 서버는 지식 단위 판정을 `hub.levelOf(ctx, kn)` 하나로 한다. 읽기 길은 `hub.meta(id, ctx)`(읽기 미만은 404), 쓰기 · 관리 길은 `hub.need(ctx, kn, 'write'|'admin')`(403). 지식 id 를 싣는 응답(목록 · 찾기 · 지금 하는 일 · 일 줄 · 이력 · 알림 · MCP)은 모두 자리로 거른다.
- 개인 프로그램은 그 PC 사람 하나만 쓰므로 이 모델 밖이다(늘 관리).
- 기준: [docs/kmd_권한_모델.md](../docs/kmd_권한_모델.md).

## 6. 흐름

### 6-1. 고치기 → 기록 → 정리 → 문서

1. 쓰기 자리 사람(또는 세션)이 항목을 고치면 **기록**이 남는다(`work/<id>.md` · `touches` 에 그 항목의 이름).
2. 정리 방식대로 일감이 선다: 정해진 시각(기본 매일 02:30) · 실시간(기록 뒤 5분 조용하면) · 손으로만([지금 정리]).
3. 정리 일꾼이 자리(문서 › 항목)마다 묶어 Claude Code 로 초안을 쓴다(같은 문서의 항목은 한 번에 · 세 자리까지 같이 · 큰 자리부터). 묶음 답에 빠진 자리는 까닭을 줄에 남기고 빈 칸이 따로 다시 쓴다. 자리마다 걸린 시간 · 보낸 글 · 받은 토큰이 줄과 일꾼 기록에 남는다.
4. **검사**: 숫자 · 이름이 기록과 맞나(「옛 값 → 새 값」 줄은 새 값만 · 날짜는 값 하나 · 띄어 쓴 단위는 뒤에 한글이 없을 때만 붙는다) · 지어낸 값이 없나 · 작성기준. 넘지 못하면 「그대로 둔 것」.
5. **넣기**: 문서 · 참고 블록 · git 한 묶음 · 이력 한 줄. 값이 바뀌면 쓴 사람에게 노란 「확인할 것」.
6. 줄마다 비교 · 되돌리기. 같은 문서를 7일 안에 두 번 되돌리면 그 문서의 값 바뀜은 7일 넣지 않는다.

지식관리자가 고치면 기록을 남기고 바로 문서에 들어간다. 개인 프로그램에는 정리가 따로 없다(기록이 남는 즉시 넣는다).

### 6-2. 파일 넣기(일 줄 네 단계)

수집(받기 · 글로 바꾸기: md · txt · csv · html · json · docx · pptx · xlsx · hwpx · hwp · pdf) › 검토(같은 파일 · 크기) › 기록 생성(파일마다 기록 하나 · 원본은 첨부) › 문서 생성(Claude Code 가 세션처럼: 읽기 › 둘러보기 › 이름 맞추기 › 갈래 · 주제 문서의 항목에 넣기 › 이력). 한 번에 300 파일 · 200MB. 개인 프로그램은 20 파일까지 Claude, 나머지는 규칙. 손잡이: 멈춤 · 이어서 · 그만두기 · 다시 · 맨 앞으로 · 빼기.

### 6-3. 가져올 곳

| 유형 | 들어오는 것 | 브레이크 |
|---|---|---|
| 문서 폴더 | 바뀐 파일만 · 파일마다 기록 | 한꺼번에 크게 바뀌면(새 10 넘게 · 사라짐 10% 넘게) 멈추고 「크게 바뀜」(일 줄 탭 「살펴볼 일 n」) |
| 소스 코드(git) | 새 묶음마다 기록(제목 · 바뀐 값 · 차이) | 같음 |
| DB | 테이블마다 정의 표 · `table:` 이름 · 읽기 전용 세션 · 카탈로그만 | 같음 |

### 6-4. 지식 보내기(개인 → 팀)

개인 지식마다 받는 팀 지식 하나를 묶어 둔다(쓰기 자리 이상인 것만). 기록 · 문서를 골라 보내면 개인 프로그램이 이 PC 의 기기 열쇠로 팀 서버에 보내고(닿지 않으면 다시), 팀 지식에는 고른 것마다 기록 하나로 들어가 그 지식의 정리 때 문서가 된다.

### 6-5. Claude Code 세션

| MCP 도구 | 하는 것 |
|---|---|
| `brief` | 지식 목록 · 지식 하나의 문서 · 최근 기록 · 반영 대기 · 알릴 것 · 갈래 서식 |
| `match` | 이름으로 항목 찾기(정한 이름 · 다른 이름 · 머리가 같으면 확정) |
| `search` | 말 → 항목 후보와 자리 없는 글 토막 |
| `section` | 항목 하나의 지금 글 · 지문(base) · 그 항목을 건드린 기록 |
| `save` | 기록(바뀐 것 · 까닭 · 버린 안 · 영향 · 근거 · touches) · 항목 글 · 새 이름 · 새 갈래 |

스킬 순서: 일 전 `kmd(-team)-work`(brief → match → search → section, 지식에 없는 것은 지어내지 않는다) · 일 뒤 `kmd(-team)-save`(어느 지식에 남길지 묻고 save). 팀 세션의 항목 글은 지식관리자라도 기록으로 남겨 정리가 넣는다.

### 6-6. 백업 · 되살리기

저장 뒤 바로 백업 자리로 밀고, 안 되면 1 · 5 · 15 · 60분 · 매일 다시(6시간 노랑 · 24시간 빨강). 갈라지면 사람이 정한다([이 백업 이어 쓰기] · [서버 것으로 백업 덮기]). 살림 자리는 밤 묶음 + auth.log 따로. 되살리기는 `kmd restore`(`--practice` 는 읽기만 사본) · `kmd auth reapply`.

## 7. 화면 지도

| 자리 | 팀 화면 | 개인 화면 |
|---|---|---|
| 들어가기 | 아이디 · 비밀번호(처음 들어오기 링크로 정함) | 한 번용 주소(시작 메뉴 › kmd · `kmd open`) |
| 지식 목록 | 자리 받은 팀 지식 카드 · 「+ 새 팀 지식」(총괄 관리자) | 개인 지식 카드 · 지식 폴더 띠 · 「+ 새 지식」 |
| 보기 | 문서 · 항목 · 그래프 · 찾기 Ctrl K · 빨리 열기 Ctrl O · 명령 Ctrl P | 같음 |
| 지식 관리 › 이력 | 볼 수 있는 팀 지식의 바뀐 것 · 확인할 것 | 개인 지식의 바뀐 것 · 확인할 것 |
| 설정 | 가져오기 · 정리 · 일반 · 사람 · Claude 연결(정리 전용) · 에이전트 설치 · 관리 | 가져오기 · 지식 보내기 · 일반 · Claude 연결(내 로그인) · 에이전트 설치 |
| 옆 메뉴 맨 아래 | 개인 프로그램 설치(한 줄 · 내 기기) | — |
| 머리 오른쪽 | Claude 상태 · 설명서 · 「⚠ 경고 n」(멈춘 일) | 같음 |

화면 기준: [docs/kmd_디자인_컨벤션.md](../docs/kmd_디자인_컨벤션.md) v0.2 · 견본 `app/styleguide.html` · 토큰은 `app/kmd.css` `:root` 만 · 끊는 점 600 · 1024.

## 8. 명령

| 어디서 | 명령 |
|---|---|
| 팀 서버 | `kmd serve` · `kmd user [add/reset/off]` · `kmd owner` · `kmd access` · `kmd group` · `kmd worker [add/key set]` · `kmd secret set` · `kmd machine add` · `kmd backup [add/pull]` · `kmd restore` · `kmd auth reapply` · `kmd guard` · `kmd docfmt` · `kmd search-check` |
| 내 PC | `kmd up` · `kmd open` · `kmd connect` · `kmd agent add` · `kmd pc task/update/restart/switch/link` · `kmd backup` · `kmd restore` |
| 둘 다 | `kmd help` · `kmd --version` |

## 9. 깔기 · 올리기

### 9-1. 꾸러미

`node scripts/pack.mjs` → `dist/`

- `kmd-<판>-pc.zip`: node.exe · app · core · server · agent · 설명서(`docs_ops/manual`) · 쓰는 node_modules · `kmd.cmd` · `kmd-key.cmd`.
- `kmd-<판>-team.tgz`: 같은 것(node 빼고) + `kmd-install.sh` + PC zip.

### 9-2. 팀 서버

`sudo sh kmd-install.sh --team --url <팀 주소> --root /srv/kmd --port 8090` → `/opt/kmd` · kmd 사용자 · `kmd.service` · `kmd-worker.service` · `/usr/local/bin/kmd` · PC zip 을 `/srv/kmd/.kmd/dl` 에. 첫 설정 주소로 총괄 관리자를 만든다. 다시 돌리면 새 판(코드만 바꾸고 지식 · 살림 자리는 그대로).

### 9-3. 내 PC

팀 화면 › 개인 프로그램 설치의 한 줄(`irm <팀>/i/<표> | iex`): 없으면 받아 `~/.kmd-app/versions/<판>` 에 깔고 · 옛 판이면 올리고 · 팀에 잇고(기기 열쇠) · Claude Code 에 잇고 · 늘 켜기. 작업 폴더에 팀 지식만 붙이는 한 줄은 `irm '<팀>/a/<표>?kn=<지식>' | iex`.

### 9-4. 테스트 서버 10.10.20.188 배포

1. 커밋된 HEAD 를 깨끗한 폴더로: `git archive HEAD | tar -x -C <폴더>`(Git Bash · Windows tar.exe 금지) · node_modules 는 junction.
2. 그 폴더에서 `node scripts/pack.mjs` → `scp dist/kmd-<판>-team.tgz root@10.10.20.188:/tmp/`.
3. 배포 전 `/srv/kmd/.kmd/jobs.json` 의 도는 일을 본다(배포는 kmd · kmd-worker 를 다시 켜 도는 정리가 기다림으로 돌아간다).
4. 서버에서 풀고 `kmd-<판>-team/` 에서 `sh kmd-install.sh --team --url http://10.10.20.188:8090 --root /srv/kmd --port 8090`.
5. 확인: `curl :8090/healthz` 의 build · 바뀐 코드가 `/opt/kmd` 에 있는지 grep · 보고에 커밋 해시.
6. 서버 밖에서 지식 파일을 고쳤으면 `systemctl restart kmd`(팀 서버는 지식을 캐시한다). root 로 git 을 칠 때는 `sudo -u kmd git …`.

## 10. 운영

| 늘 | 무엇 |
|---|---|
| 저절로 | 백업 · GitLab 봇 · 가져올 곳 · 정리 · 이 PC 늘 켜기 |
| 매일 밤 | `tar -czf /backup/kmd-data-$(date +%F).tgz -C /srv/kmd .kmd` + auth.log 따로 |
| 석 달마다 | 되살리기 연습(`kmd restore … --practice` · `HEAD^{tree}` 견주기) |
| 볼 곳 | 관리 화면 문제 줄 · 「⚠ 경고 n」 · `systemctl status kmd kmd-worker` · `journalctl -u kmd` · `kmd backup` · `kmd guard --all` |

## 11. 지키는 것(보안)

- 비밀(GitLab 열쇠 · 원천 자격 · claude-token)은 셸 숨김 입력 · `secrets.json` 에만. 화면 · 로그 · 응답에 0.
- 비밀번호는 브라우저가 미리 해시해 보낸다(`app/prehash.js`) · 서버는 scrypt. 여러 번 틀린 자리는 잠시 막힌다. 위험한 일은 비밀번호 한 번 더(15분).
- 기기 열쇠는 Windows 자격 저장소(`%USERPROFILE%\.kmd\keys` · DPAPI). Claude Code 는 헤더 도우미(`kmd-key-*.exe`)로 꺼내 쓴다(설정 파일에 열쇠 없음).
- 다른 곳의 화면에서 온 쓰기 요청은 받지 않는다(Origin · Sec-Fetch-Site). 서버가 그리는 페이지(설명서 · 받기)는 CSP `default-src 'none'`.
- 장부 · 설정 파일은 임시 파일 뒤 이름 바꾸기(원자 쓰기). 깨진 파일을 빈 것으로 읽어 덮지 않는다.
- DB 가져오기는 늘 읽기 전용 세션 · 카탈로그만. GitLab 봇 열쇠는 만들기 권한만.

## 12. 코드

| 폴더 | 무엇 |
|---|---|
| `core/` | 지식 읽기(knowledge · sections · vocab · registry) · 저장(save · guard · docformat) · 찾기(search) · 정리(curate · tidy · worker) · 백업(backup · git · gitlab) · 원천(sources · baseline · docwatch · db) · 넣기(importer · ooxml · pdf · hwp) · 보내기(send) · 되살리기(restore) · 들어가기(auth · passwd · keystore · keyexe) · 에이전트(kit · teamkit) |
| `server/` | `hub.js`(모든 길의 가운데: 화면 · MCP 가 같은 길) · `http.js`(길 · 들어가기 · 설명서) · `mcp.js` · `views.js` · `bin/kmd.mjs`(명령) |
| `app/` | 화면 `main.js` · `ui.js` · `kmd.css`(토큰) · `styleguide.html` |
| `agent/` | 스킬과 CLAUDE.md 덩이(개인 · `team/` 팀) |
| `scripts/` | `pack.mjs` · `kmd-install.sh` · `local.mjs`(로컬 시험 환경: 팀 7381 · PC 7382) |
| `test/` | `node --test test/<이름>.test.mjs`(바뀐 것에 걸린 것만) · `fixture/kmd`(dpms · gdi) · 가짜 claude |
| `docs/` | 기준 문서(디자인 컨벤션 · 문서 작성기준 · 권한 모델 · 템플릿) · 개발자 설명서 · 품질개선 |
| `docs_ops/` | 이 문서 · 그림 판 · 설명서(`manual/` → `/manual`) |

## 13. 관련 문서

| 문서 | 무엇 |
|---|---|
| [manual/사용자.html](manual/사용자.html) | 쓰는 사람(팀 화면) |
| [manual/개인.html](manual/개인.html) | 개인 프로그램 |
| [manual/지식관리자.html](manual/지식관리자.html) | 지식관리자 |
| [manual/관리자.html](manual/관리자.html) | 총괄 관리자 |
| [manual/운영.html](manual/운영.html) | 운영 · 되살리기 |
| [../docs/설명서_개발자.md](../docs/설명서_개발자.md) | 개발자 |
| [../docs/품질개선/종합검토.md](../docs/품질개선/종합검토.md) | 남은 개선 거리(「따로 할 것」) |
| [../CHANGELOG.md](../CHANGELOG.md) | 바뀐 것 |

설명서 그림을 다시 찍을 때: 로컬 시험 환경을 따로 띄우고(`KMD_LOCAL_DIR=.kmd-data/manual-env KMD_LOCAL_PORT=7391 KMD_LOCAL_FAKE_CLAUDE=1 node scripts/local.mjs`) 같은 화면을 1280×800 으로 찍어 `docs_ops/manual/img/` 의 같은 이름으로 바꾼다.
