# kmd 바뀐 것

## (다음 판)

### E2 들어가기 · 기기 열쇠(+ S8 들어가기 화면)

- **명부**(`core/auth.js` · `<data>/auth.json`) — 사람은 아이디 · 비밀번호. 화면 · 설치기가 비밀번호를 PBKDF2 로 전처리해 보내고(`app/prehash.js` · 순수 JS — node 와 같은 값) 서버는 사람마다 salt 로 다시 scrypt(`core/passwd.js` · maxmem · 동시 2 · N 은 첫 시작에 잰다).
- **잠금** — (아이디 × 자리) 5번 / 15분 · 잠긴 동안은 맞든 틀리든 같은 답 · 전에 들어온 브라우저는 잠금 밖 · 실패 문구는 하나.
- **세션** — 서명 쿠키 · 쓰는 동안 12시간 · 길어야 7일 · 세션 판(sv) — 모든 기기에서 나가기 · 다시 정하기가 옛 쿠키를 끊는다 · 관리 일은 재인증(비밀번호 한 번 · 15분).
- **처음 들어오기 링크**(`/first#code=` · 24시간 · 한 번) · **첫 관리자**(`/setup#code=` — `kmd serve` 가 찍는다 · 열쇠 원문을 돌려주지 않는다) · **예전 열쇠**(비밀번호 안 정한 사람만 → 곧바로 비밀번호 정하기).
- **기기 열쇠** `kmdk_` — 팀 화면의 설치 표(10분 · 한 번) 또는 아이디 · 비밀번호 한 번 → `kmd connect <팀 주소>` → OS 자격 저장소(`core/keystore.js` — DPAPI · 키체인 · secret-tool · 0600) → Claude Code 의 헤더 도우미 `kmd-key`. 90일 안 쓰면 끊김 · 열쇠로는 들어가기 · 재인증 · 열쇠 만들기 불가 · 내 기기 · 끊기.
- **기계 열쇠** `kmdm_` — 지식 하나 · 원천 이름 하나 · 1년 · 그 지식의 기준선 길 하나만(`kmd machine add`).
- **비밀은 셸** — `kmd secret set <이름>`(숨김 입력 · `<data>/secrets.json` 0600).
- **PC**(`kmd up`) — 들어가기 없음 · 한 번용 번호(`#once=` · 60초) → 루프백 쿠키 30일 · 이 PC 의 Claude Code 열쇠를 저장소에 저절로.
- **화면(S8)** — 들어가기 두 칸(username · current-password) · 처음 들어오기 링크로 비밀번호 정하기(new-password · 정한 바로 그 화면에 「한 줄 복사」) · 「예전 열쇠로 들어가기」 · 팀 첫 설정. 들어오기 전에는 리본 · 옆 메뉴가 흐리다.
- 셸 `kmd user add | reset` · `kmd machine add | revoke` · `kmd secret set` · `kmd connect`. 시험 `test/login.test.mjs`.

### E1 고침판 · 권한

- **F1** 기록 머리는 한 줄 모양만 받고, 쓴 뒤 다시 읽어 보낸 값과 대조한다(어긋나면 되돌림). **F4** `section` 이 항목 지문(base)을 주고, save 가 base 를 받으면 읽은 뒤 바뀐 항목은 덮지 않는다(`E_CONFLICT` · 묶음 0). **F12** 파일 캐시는 요청 밖 · 저장 뒤엔 바뀐 파일만 다시 읽는다. **I7** 아직 안 넣은 기록은 최신 8 · 날짜 순 · 넘친 수 — 화면과 MCP 가 같은 계산.
- **예약** — 이름(kmd · kmd-auto · kmd-worker) · 태그(edit · curate-auto · curate-llm · alias-auto · sources · touches-fix) · 파일(`_members.md` · `_format.json` · `_sources.json`)은 사람 · 세션이 못 쓴다.
- **주인 · 개인**(`core/owners.js` · `<data>/owners.json`) — 개인 지식은 주인만 본다(관리자도 가림 · 목록 · 찾기 · 읽기 · 저장 · MCP 같은 판정). 주인을 바꾸면 `_members.md` 가 따라간다. `kmd owner <지식> [사람] [--private]`.
- **백업 자리 권한** — 붙이기 · 받기는 관리자만 · 팀 서버에서 이 PC 폴더 주소는 `serve.json` 의 `backupRoots` 안만.
- 시험 `test/fixpack.test.mjs`.

### E0 백업이 조용히 멈추지 않는다

- **백업 자리**(`core/backup.js`) — 지식마다 붙인 백업 자리(원격 `kmd-backup`)에만 보낸다 · 상태 파일 `<data>/backup/<지식>.json` · 원격의 실제 sha 로 판정 여섯(ok · lag · gone · rewound · behind · moved) · `<sha>:refs/heads/<가지>` 로 적어 민다(지워진 백업도 다시 올린다) · 다시 보내기 1 · 5 · 15 · 60분 그 뒤 시간마다 · 시작할 때 한 번 · 매일 한 번.
- **읽기만으로 닫기** — behind · moved 면 그 지식의 저장이 `E_BEHIND`(409). 「백업에서 받기」 는 앞으로만 · 받은 뒤 검사(`core/check.js`)가 새 오류를 내면 되돌린다.
- **멈춤 한 줄**(`core/stopline.js`) — 「무엇이 · 얼마나 — 풀리는 길 / 누구에게」. 안 보낸 것이 6시간이면 노랑 · 24시간이면 빨강 · 지워짐 · 되감김은 다시 올린 뒤 하루 빨강. 화면 띠 · 지식 목록 · `/healthz` · `/api/stops` · MCP save 의 warnings · brief 가 같은 줄을 받는다.
- **명령** — `kmd backup`(상태) · `kmd backup add <지식> <주소>` · `kmd backup pull <지식>` · 공통 `--data`(살림 자리 · 기본 `<폴더>/.kmd`). 화면 자료 `POST /api/k/<지식>/backup {url}` · `/backup/pull`.
- 서버 가운데(`server/hub.js`)를 세워 화면과 MCP 의 저장이 한 길로 간다.
- 시험 `test/backup.test.mjs`.

### K0 뼈대 — 지식 하나를 띄워 화면에서 읽고, 세션의 save 가 기록으로 남는다

- **`kmd` 명령** — `kmd serve [폴더]`(팀 서버) · `kmd up [폴더]`(이 PC · 화면을 띄운다 · 폴더 기본 `D:\kmd` 또는 집 폴더의 `kmd`). 폴더 안의 폴더 하나하나가 지식이고, 폴더 자체가 지식 모양(`docs/` · `work/`)이면 그 하나만. 기본은 `127.0.0.1:7373` 에만 연다.
- **지식 읽기**(`core/`) — 문서(`docs/**.md` · 항목 = `## 머리` · 코드 울타리 안의 `#` 은 머리 아님) · 기록(`work/<id>.md` 머리 — id · title · date · author · touches · supersedes) · 이름 장부(`_vocab.md` — 정한 이름 · 다른 이름) · 자리 장부(`_managed.md` — `종류:*` 와 하나짜리 줄) · 첨부(`docs/assets`). 항목의 `<!-- applied: … -->` 표지로 「아직 문서에 안 넣은 기록」 을 가른다.
- **save 하나** — 기록 하나 + (보내면) 항목 글 갈아 끼우기 + 표지를 git 한 묶음으로(작성자 = 쓴 사람 · 고친 파일만). git 이 없는 지식 폴더면 세우고 있던 글을 첫 묶음으로 남긴다. 제목 · 날짜 · 이름은 한 줄 모양만 받는다(머리 주입 막기). 항목 자리를 못 찾거나 git 이 넘어지면 쓴 것을 모두 되돌린다. 같은 지식의 저장은 한 줄로 선다.
- **MCP**(`POST /mcp` · 무상태 JSON) — 도구 넷 `brief` · `match`(정한 이름 · 다른 이름 · 머리 · 문서 이름) · `section`(지금 글 + 그 항목을 건드린 기록) · `save`. 다른 곳의 화면(Origin)에서 온 쓰기는 403.
- **화면**(`app/`) — 목업(`docs/kmd_목업_인터랙션.html`)의 CSS 를 그대로 옮기고 같은 마크업으로 그린다: 리본(문서 · 항목 · 그래프 · 설정) · 옆 메뉴 · 머리(이전/다음 · 빨리 열기 · 찾기) · 띠 · 아래 줄 · 지식 목록 · 문서로 보기(나무 · 탭 · 나누어 보기 · 문서 · 기록 · 첨부 · 개요 · 이 문서를 가리키는 것 · 속성) · 빨리 열기(Ctrl O) · 찾기(Ctrl K · 낱말) · 명령 창(Ctrl P). 항목 · 그래프 · 오늘 바뀐 것 · 자료 가져오기 · 설정은 「다음 판에 열린다」 한 줄.
- **시험** — `test/k0.test.mjs`(화면 자료 · MCP 넷 · save → git 한 묶음 · 나쁜 입력은 묶음 0 · 파일 0) · `test/screen-kmd.test.mjs`(셸 · 목록 · 문서로 보기의 목업 글 · 주 단추 ≤ 1 · 금지어 0 · 콘솔 에러 0 · 목업과 같은 크기로 나란히 찍기). 시험 지식 `test/fixture/kmd`(목업의 DPMS · GDI) · 시연 `npm run demo`(사본으로 띄운다).
