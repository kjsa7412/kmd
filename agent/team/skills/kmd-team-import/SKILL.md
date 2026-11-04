---
name: kmd-team-import
description: 이 PC 의 폴더 · 파일(문서 · 회의록 · 오피스 · hwp · pdf)을 팀 지식(연결 kmd-team)에 대량으로 넣는다. 파일마다 글로 바꿔 기록과 항목 조각을 한 번에 저장한다. 사람이 「이 폴더 팀 지식에 넣어 줘」 「이 파일들 팀 지식에 올려」 라고 할 때 쓴다. 팀 화면 파일 넣기(한 번에 20개)보다 많을 때.
---

# kmd 팀 지식에 대량 넣기

**어디에**: CLAUDE.md 「이 폴더의 팀 지식」 표의 팀 지식 가운데 하나. 연결은 `kmd-team`, knowledge 에 그 id 를 준다. 이 일은 내 PC · 내 Claude 구독으로 한다(팀 일꾼을 쓰지 않는다).

**스킬 판**: `save` 마다 `kit: "{{KIT_REV}}"` 를 같이 보낸다. 답에 `reinstall` 이 있으면 저장은 된 것이다. `reinstall.how` 를 사람에게 한 줄로 전한다.

0. **어느 팀 지식에 넣을지 묻는다**(`kmd-team-save` 와 같은 규칙): 넣을 폴더 · 파일 수와 표의 팀 지식(이름 · 보는 사람)을 보여 주고 「어느 팀 지식에 넣을까요?」. 표의 지식이 하나면 「여기에 넣을까요?」. `brief { knowledge }` 의 `you.direct` 가 거짓(읽기 자리)이면 넣지 못한다고 말하고 멈춘다. `brief` 에 `noClaude` 가 있으면(「Claude 에 보내지 않음」 지식) 이 지식은 글을 Claude 에 보내지 않는다고 말하고 멈춘다: 대량 넣기는 파일마다 팀 항목 글을 이 대화로 읽는다. 사람이 그래도 하라고 하면 `match` · `section` 은 꼭 필요한 항목만 읽는다. 원본 파일도 첨부로 둘지 묻지 않는다: 사람이 「원본도 첨부」 라고 했을 때만 5단계.
1. **파서**: 파일을 글로 바꾸는 kmd 파서(`kmd-parse`)를 쓴다. 팀 화면 · 개인 프로그램과 같은 바꾸기다.
   - `brief` 의 `parser`(`{ ver, url, sha256, bytes }`)를 본다. `null` 이면 「팀 서버에 대량 넣기 파서가 없다: 총괄 관리자에게 부탁한다」 고 말하고 멈춘다.
   - `%USERPROFILE%\.kmd\parse\<ver>\kmd-parse.cmd` 가 있으면 그것을 쓴다(판이 같으면 다시 받지 않는다).
   - 없으면 「파서(<bytes 를 MB 로> MB)를 팀 서버에서 받습니다」 를 사람에게 묻고, 좋다고 하면 PowerShell 로 받는다. 팀 서버 주소는 `.mcp.json` 의 `kmd-team` url 에서 `/mcp` 를 뗀 것이다.
     ```powershell
     $v = '<ver>'; $d = Join-Path $env:USERPROFILE ".kmd\parse\$v"; $z = "$d.zip"
     New-Item -ItemType Directory -Force (Split-Path $d) | Out-Null
     Invoke-WebRequest '<팀 서버 주소><url>' -OutFile $z -UseBasicParsing
     if ((Get-FileHash $z -Algorithm SHA256).Hash.ToLower() -ne '<sha256>') { Remove-Item $z; throw 'sha256 이 다르다' }
     $t = "$d.tmp"; Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $t | Out-Null
     tar -xf $z -C $t; Move-Item (Join-Path $t "kmd-parse-$v") $d; Remove-Item $t, $z -Recurse -Force
     ```
     sha256 이 다르면 받은 파일을 지우고 멈춘다(사람에게 말한다).
2. **글로 바꾼다**: `& "$env:USERPROFILE\.kmd\parse\<ver>\kmd-parse.cmd" "<폴더>" --out "$env:TEMP\kmd-parse\<폴더 이름>"`(원본 첨부를 하면 `--attach` 도). 줄마다 파일 하나: `{ rel, mdFile, sha, tags, scan?, img?, why?, failed?, atts }` · 끝 줄 `{ done, n, fail }`. 같은 내용이 `index.json` 에도 있다.
   - `failed` 면 그 파일은 넣지 못한다(까닭 `why` 를 끝에 같이 알린다).
   - `scan` 이면 글이 없는 pdf · 그림만 든 문서다. 원본 파일을 직접 읽어 글(md)을 짓는다. 지은 글이 그 파일의 글이다.
   - `img` 는 그림이다. 원본 첨부를 하지 않으면 건너뛴다.
   - 파일이 많으면 사람에게 수와 걸릴 일을 한 줄로 말하고 시작한다.
3. **파일마다 저장 하나**(파일 하나 = 저장 하나): `mdFile` 을 읽고
   - 이름을 `match` 로 맞추고, 들어갈 항목을 `section` 으로 읽는다(`base` 를 받는다). 넣을 곳을 고르는 규칙 · 항목 글 모양은 `kmd-team-save` 와 옆의 `작성가이드.md` 그대로다.
   - 기록: 제목 「<파일 이름>: 무엇」 · `tags` 는 파서가 준 `tags` 그대로(`ingest/<경로>` · `md/<sha>`: 같은 파일을 다시 넣으면 팀 서버가 `same` 으로 답한다) · `changes` 에 이 파일로 정해진 것 · `touches` 는 글이 바뀌는 항목의 이름만.
   - 조각: 이미 있는 항목은 `{ coord, base, edits }`, 아직 없는 항목은 `{ doc, heading, content }`. 새 문서는 `brief` 의 `forms`(갈래 장부) 갈래로만, 글은 `##` 항목으로 나눠 세운다. 파일 이름 · 날짜 · 판을 문서 이름에 쓰지 않는다. 회의록은 회의록 문서의 「YYYY-MM-DD 무엇」 항목이다.
   - 새 이름이 필요하면 `names` 로 같이 세운다.
   - 조각이 하나도 없는 기록은 보내지 않는다(문서에 들어갈 것이 없는 파일은 끝에 「넣을 곳이 없다」 로 알린다).
   - `save` 하나로 보낸다(`kit` 실음).
4. **답을 읽고 다음 파일로**:
   - `same: true` 면 「이미 넣음」 이다(앞에서 넣은 파일: 이어 하기). 다음 파일로.
   - `proposals[].ok === false` 면 그 조각만 넣지 못함이다. `why` · `near` 를 읽고 **한 번** 고쳐 다시 저장한다(`record.fixes: [앞 기록 id]` · `tags` 는 그대로). 그래도 안 되면 다음 파일로(지식관리자 화면 「넣지 못함」 에 남는다).
   - `E_CONFLICT` 면 아무것도 쓰지 않은 것이다. `details.stale` 항목을 `section` 으로 다시 읽고 다시 짓는다(`fixes` 없이).
   - `E_RATE` 면 `details.retryAfter` 초 쉬고 같은 파일을 다시 보낸다.
   - 다른 오류는 그 파일만 건너뛰고 까닭을 적어 둔다.
5. **원본 첨부**(사람이 「원본도 첨부」 라고 했을 때만 · 쓰기 자리부터): 그 파일 줄의 `atts`(`path` · `file` · `bytes`)를 `save` 의 `attach: [{ path, b64 }]` 로 같은 저장에 싣는다. `b64` 는 `[Convert]::ToBase64String([IO.File]::ReadAllBytes('<file>'))`. 한 저장에 8MB 까지: 더 큰 원본은 첨부하지 않고 글만 넣는다(끝에 알린다).
6. **끝에 한 줄**: 「넣음 n · 넣지 못함 n · 이미 넣음 n」(+ 못 바꾼 파일 · 넣을 곳이 없는 파일 · 첨부하지 않은 큰 원본의 이름). 응답 note · warnings 는 그대로 전한다. 넣지 못함은 지식관리자 화면 「넣지 못함」 에서 다시 들일 수 있다고 덧붙인다.

중간에 멈췄으면 같은 폴더로 처음부터 다시 돌린다: 넣은 파일은 `same` 으로 건너뛴다. 비밀(비밀번호 · 열쇠 · 개인정보)이 든 파일은 넣지 않고 사람에게 묻는다. 줄표(—)는 쓰지 않는다(제목 · 글 모두): 풀이는 쌍점, 문장 끊기는 마침표.
