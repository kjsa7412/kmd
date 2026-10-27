# kmd

팀과 내 PC 의 지식(md 문서 · 기록 · 정리)을 한 곳에서 읽고 고치며, Claude Code 세션이 MCP 로 같은 지식을 읽고 쓰게 한다.

- **팀 서비스 — 팀 서버**(`kmd serve`). 아이디 · 비밀번호로 들어온다. 팀 지식은 고치면 기록으로 남고, 정리(정해진 시각 · 실시간 · 손으로만)가 문서에 넣는다. 주인 · 정리하는 사람 · 관리자가 있고 지식마다 git 으로 백업한다.
- **개인 서비스 — 이 PC 의 kmd**(`kmd up`). 내 PC 의 지식 폴더(기본 `D:\kmd`). 고치면 곧바로 문서에 들어가고, 파일 넣기 · 지켜보며 맞추기(문서 폴더 · git · DB)를 한다(팀으로 보내기는 팀 화면에서). 화면은 아이디 · 비밀번호 없이 이 PC 의 kmd 가 여는 한 번용 주소로 들어온다 — **시작 메뉴 › kmd** 또는 `kmd open`.
- **둘을 잇는 길** — 팀 화면에서 내 PC 지식을 읽고 고친다(내 PC 지식은 팀 서버로 가지 않는다) · 팀 화면에서 내 개인 지식(팀 서버 · 나만)을 팀 지식으로 보낸다 · Claude Code 에는 두 연결(`kmd-team` · `kmd`)이 붙는다.

## 세우기

**팀 서버**(Linux · node 20 이상 · git) — `kmd-<판>-team.tgz` 를 풀고:

```bash
sudo sh kmd-install.sh --team --url http://kmd.team.local
```

끝에 찍힌 첫 설정 주소로 관리자를 만든다. 사람마다 서버에서 `kmd user add <아이디> --url http://kmd.team.local` 의 처음 들어오기 링크를 보낸다(설치가 둔 `kmd` 명령은 kmd 사용자 · 지식 폴더 `/srv/kmd` 로 돈다). 새 판은 새 팀 꾸러미로 같은 설치를 다시 돌린다. 자세히는 [관리자 설명서](docs/설명서_관리자.md).

**이 PC**(Windows) — 팀 화면에서 비밀번호를 정한 뒤 **설치 한 줄 복사** → PowerShell 에 붙여 넣는다. kmd 가 없으면 팀 서버에서 PC 꾸러미를 받아 `%USERPROFILE%\.kmd-app` 에 깔고, 팀에 잇고, Claude Code 에 잇고, 로그온 때 켜지게 하고, 화면을 연다. 팀 없이 쓰려면 PC 꾸러미를 풀고 `kmd.cmd up`.

## 개발

```bash
npm install
node server/bin/kmd.mjs help        # 명령 목록
node scripts/local.mjs              # 로컬 시험 환경 — 팀 서버 + 이 PC 의 kmd 를 이은 채로(.kmd-data/local)
npm test                            # 시험 전체(화면 시험은 이 PC 의 Chrome)
node scripts/pack.mjs               # 꾸러미 — dist/kmd-<판>-pc.zip · kmd-<판>-team.tgz
```

- `KMD_LOCAL_FAKE_CLAUDE=1` 이면 로컬 환경이 진짜 Claude 대신 시험용 가짜를 쓴다 · `KMD_LOCAL_PORT` · `KMD_LOCAL_DIR` 로 다른 사본을 따로 띄운다.
- 짜임 · 지키는 것 · 시험은 [개발자 설명서](docs/설명서_개발자.md). 화면을 고칠 때는 [디자인 컨벤션](docs/kmd_디자인_컨벤션.md)을 먼저 본다.

## 문서

| 문서 | 누가 |
|---|---|
| [설명서 — 쓰는 사람](docs/설명서_사용자.md) | 모두 — 처음 · 이 PC 의 kmd 화면 · 보는 법 · 고치기 · 가져오기 · 보내기 · 이력 |
| [설명서 — 정리하는 사람](docs/설명서_정리하는사람.md) | 팀 지식의 주인 · 정리하는 사람 |
| [설명서 — 관리자](docs/설명서_관리자.md) | 팀 서버 관리자 — 세우기 · 관리 화면 · Claude 연결 · 셸 명령 |
| [운영](docs/kmd_운영.md) | 관리자 · 이 PC 의 주인 — 백업 · 밤 묶음 · 되살리기 · 새 판 |
| [설명서 — 개발자](docs/설명서_개발자.md) | 고치는 사람 |
| [바뀐 것](CHANGELOG.md) | 판마다 |
| [제품화 검토 v0.1](docs/kmd_제품화_검토_v0.1.md) | 제품화 전에 고칠 것과 순서(작업 묶음 WP1 ~ WP9) |

설명서 넷은 화면 오른쪽 위 「설명서」(`<서버 주소>/manual`)에서도 본다.
