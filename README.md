# kmd

팀 지식과 개인 지식(md 문서 · 기록 · 정리)을 읽고 고치며, Claude Code 세션이 MCP 로 같은 지식을 읽고 쓰게 한다. 프로그램은 둘이고 각자 자기 지식만 다룬다.

- **팀 프로그램: 팀 서버**(`kmd serve`). 아이디 · 비밀번호로 들어온다. 팀 지식만 다룬다. 권한은 넷(총괄 관리자 › 지식관리자 › 쓰기 › 읽기 · 받지 않은 지식은 보이지 않는다). 쓰기 자리가 고친 것은 기록으로 남고, 정리(정해진 시각 · 실시간 · 손으로만)가 문서에 넣는다. 지식마다 git 으로 백업한다.
- **개인 프로그램: 그 PC 에 깐 kmd**(`kmd up`). 내 PC 의 지식 폴더(기본 `D:\kmd`) · 개인 지식만. 고치면 곧바로 문서에 들어가고, 파일 넣기 · 지켜보며 맞추기(문서 폴더 · git · DB) · 지식 보내기(개인 → 팀)를 한다. 개인 화면은 아이디 · 비밀번호 없이 개인 프로그램이 여는 한 번용 주소로 들어온다. **시작 메뉴 › kmd** 또는 `kmd open`. 설치는 팀 화면 › 개인 프로그램 설치의 한 줄.
- **둘을 잇는 길**은 셋뿐이다: Claude Code 의 연결 둘(`kmd-team` · `kmd`) · 개인 화면에서 고른 기록 · 문서를 팀 지식으로 보내는 지식 보내기. 팀 화면은 개인 프로그램을 부르지 않고 개인 지식을 보여 주지 않는다.

## 세우기

**팀 서버**(Linux · node 20 이상 · git): `kmd-<판>-team.tgz` 를 풀고:

```bash
sudo sh kmd-install.sh --team --url http://kmd.team.local
```

끝에 찍힌 첫 설정 주소로 총괄 관리자를 만든다. 사람마다 서버에서 `kmd user add <아이디> --url http://kmd.team.local` 의 처음 들어오기 링크를 보낸다(설치가 둔 `kmd` 명령은 kmd 사용자 · 지식 폴더 `/srv/kmd` 로 돈다). 새 판은 새 팀 꾸러미로 같은 설치를 다시 돌린다. 자세히는 [총괄 관리자 설명서](docs_ops/manual/관리자.html).

**개인 프로그램**(Windows): 팀 화면에서 비밀번호를 정한 뒤 팀 화면 › 개인 프로그램 설치의 **설치 한 줄 복사** → PowerShell 에 붙여 넣는다. kmd 가 없으면 팀 서버에서 PC 꾸러미를 받아 `%USERPROFILE%\.kmd-app` 에 깔고, 팀에 잇고, Claude Code 에 잇고, 로그온 때 켜지게 하고, 화면을 연다. 팀 없이 쓰려면 PC 꾸러미를 풀고 `kmd.cmd up`.

## 개발

```bash
npm install
node server/bin/kmd.mjs help        # 명령 목록
node scripts/local.mjs              # 로컬 시험 환경: 팀 서버 + 개인 프로그램을 함께 띄운다(.kmd-data/local)
npm test                            # 시험 전체(화면 시험은 이 PC 의 Chrome)
node scripts/pack.mjs               # 꾸러미: dist/kmd-<판>-pc.zip · kmd-<판>-team.tgz
```

- `KMD_LOCAL_FAKE_CLAUDE=1` 이면 로컬 환경이 진짜 Claude 대신 시험용 가짜를 쓴다 · `KMD_LOCAL_PORT` · `KMD_LOCAL_DIR` 로 다른 사본을 따로 띄운다.
- 짜임 · 지키는 것 · 시험은 [개발자 설명서](docs/설명서_개발자.md). 화면을 고칠 때는 [디자인 컨벤션](docs/kmd_디자인_컨벤션.md)을 먼저 본다.

## 문서

| 문서 | 누가 |
|---|---|
| [kmd 서비스 전체](docs_ops/kmd_서비스_전체.md) · [그림으로 보기](docs_ops/kmd_서비스_전체.html) | 모두: kmd 의 처음부터 끝까지(짜임 · 자리 · 흐름 · 화면 · 명령 · 배포 · 운영) |
| [설명서: 쓰는 사람](docs_ops/manual/사용자.html) | 팀 화면: 처음 · 보는 법 · 찾기 · 고치기 · 가져오기 · 이력 · 에이전트 설치 |
| [설명서: 개인 프로그램](docs_ops/manual/개인.html) | 내 PC: 설치 · 개인 화면 · 파일 넣기 · 지식 보내기 · Claude 로그인 |
| [설명서: 지식관리자](docs_ops/manual/지식관리자.html) | 팀 지식의 지식관리자(주인 포함): 정리 · 권한 · 가져올 곳 |
| [설명서: 총괄 관리자](docs_ops/manual/관리자.html) | 팀 서버 총괄 관리자: 세우기 · 사람 · 관리 화면 · Claude 연결 · 셸 명령 |
| [설명서: 운영 · 되살리기](docs_ops/manual/운영.html) | 총괄 관리자 · 개인 프로그램을 쓰는 사람: 백업 · 밤 묶음 · 되살리기 · 새 판 |
| [설명서: 개발자](docs/설명서_개발자.md) | 고치는 사람 |
| [바뀐 것](CHANGELOG.md) | 판마다 |

설명서 다섯은 화면 오른쪽 위 「설명서」(`<서버 주소>/manual`)에서 화면 그림과 함께 본다. 설명서 그림은 로컬 시험 환경(`scripts/local.mjs`)의 진짜 화면이다.
