// MCP — Claude Code 세션이 kmd 를 읽고 쓰는 길(Streamable HTTP · JSON 응답 하나).
//
// 도구 여섯: brief(지금 무엇이 있나) · match(이름으로 찾기) · search(말로 찾기) · section(항목 글 읽기) · propose(저장 제안 · 쓰지 않음) · save(승인한 제안을 남기기).
// 세션 응답의 말은 사람 화면과 같은 쉬운 말로 쓴다.
//
// SDK 없이 JSON-RPC 몇 갈래만 받는다 — initialize · tools/list · tools/call · ping. 서버가 세션을
// 기억하지 않으므로(무상태) 다시 띄워도 세션이 끊기지 않는다.

import { KmdError } from '../core/errors.js'
import { labelOf, sectionOf, coordsOfSection, sectionHistory } from '../core/knowledge.js'
import { headingMatches } from '../core/sections.js'
import { VERSION } from './version.js'
import { sha16 } from '../core/text.js'
import { formGuide } from '../core/guard.js'
import { splitBlocks } from '../core/baseline.js'
import { readDecl, everyMs } from '../core/sources.js'
import { TEAM_KIT_REV } from '../core/teamkit.js'
import { PC_KIT_REV } from '../core/kit.js'
import { precedentsFor, seedKindCards } from '../core/precedent.js'
import { GEN_RULES_REV, rulesHash, ruleTitles } from '../core/genrules.js'


const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

const INSTRUCTIONS = [
  'kmd 는 팀 지식과 개인 지식이다. 문서(항목 = ## 머리 · 장부에는 종류:값 · 라벨 · 별칭으로 적힌다)와 기록(누가 무엇을 왜 바꿨나).',
  '일을 시작할 때 brief 로 무엇이 있나 본다. 이름을 알면 match 로 그 항목을 찾고 section 으로 지금 글을 읽는다.',
  '일을 마치면 정한 것 · 바뀐 것을 기록과 항목 글로 남긴다. 기록 글은 서식 칸으로: changes(바뀐 것) · why(까닭) · dropped(버린 안) · impact(영향) · refs(근거) · body 는 한두 문장 요약. 건드린 항목(touches)을 단다. 항목 글을 고쳤으면 sections 에 바꿀 곳(edits: 찾을 글 → 바꿀 글)이나 새 글(content)을 같이 싣는다. 이미 있는 항목이면 section 이 준 base 를 꼭 같이(그사이 바뀌었으면 E_CONFLICT 로 아무것도 쓰지 않는다 · 다시 읽고 다시 제안한다).',
  '남기기 전에 propose 로 저장 제안을 받아 그 글(text)을 고치지 않고 사람에게 보이고, 대화로 고친 뒤(빼기 · 값 고치기 · 기록 범위 줄이기 · 다시 propose) 승인받으면 save 에 그 proposal 을 싣는다. 승인이 제안서의 경고를 받아들이는 것이다. 정해지지 않은 것은 저장하지 않는다(이슈를 받는 갈래가 있으면 이슈로 제기한다).',
].join('\n')
// 이 서버가 어느 쪽인가 — 한 폴더에 팀(kmd-team) · 개인(kmd) 두 연결이 같이 붙으므로 세션이 가려 남기게
//   안내 · 도구 설명 · 상태 말은 팀 · 개인 한 벌이다(저장 승인 설계 P-D44) — 다른 것은 where 표시 · 보는 사람 · 어느 지식에 남길지 묻는 것만
const WHERE = {
  pc: '이 연결은 이 PC 의 개인 지식이다(where: me). 여기 남긴 것은 나만 본다. 개인 지식이 여럿이거나 어느 지식에 남길지 애매하면 사람에게 묻는다.',
  team: '이 연결은 팀 서버다(where: team). 팀 지식에 남긴 것은 그 지식을 보는 팀 사람이 본다. 남기기 전에 어느 팀 지식에 남길지 사람에게 묻는다.',
}
export const instructionsFor = (mode) => INSTRUCTIONS + '\n' + (WHERE[mode] || WHERE.team)
// 지식마다 갈래 · 남기면 보는 사람
const whereOf = (store, id) => (store.mode === 'pc' ? { where: 'me', seenBy: '나만(이 PC)' } : { where: 'team', seenBy: '이 팀 지식을 보는 팀 사람' })

const str = (description) => ({ type: 'string', description })
const TOOLS = [
  {
    name: 'brief',
    description: '지금 kmd 에 무엇이 있나: 지식 목록 · 지식 하나의 문서 · 최근 기록 · 종류(kinds) · 갈래(forms) · 생성 룰의 판과 조문 제목(rulesRev · ruleTitles) · 종류의 뜻(kindCards) · 문서의 성격(natures) · 저장 방식(saveMode: approve — 저장 제안을 승인받아 save) · kit(스킬 판: save 의 kit 에 그대로 싣는다 · 측정에만 쓴다). 팀 지식이면 지식마다 mine(accepted: 승인으로 경고를 받아들인 내 기록 수) · 지식 하나의 you.recent(그 기록의 제목 · 까닭) · parser(대량 넣기 파서 꾸러미: ver · url · sha256 · bytes · 없으면 null). 일을 시작할 때 한 번.',
    inputSchema: { type: 'object', properties: { knowledge: str('지식 id(없으면 목록)') } },
  },
  {
    name: 'match',
    description: '이름으로 항목을 찾는다. knowledge 를 주면 과거 결정 카드(cards: 정체 · 놓임 · 꼴 · 열쇠 key 로 가리킨다) · 앞선 값(prior) · 덮임 줄(coverage) · 목차(toc)를 같이 준다: 넣을 글(source)을 같이 주면 그 글에 나오는 있는 항목도 카드로 실린다. 카드는 과거 결정(판례)이지 답이 아니다(생성 룰 R8). 항목 값 · 라벨 · 별칭 · 항목 머리가 정확히 같으면 found(확정). weak 는 약한 대조다. 확정하지 말고 같이 실린 후보(ladder)를 보거나 search 로 넓힌다. found 가 비면 「값 · 라벨 · 별칭 · 머리에는 없다」 는 뜻이고, ladder 는 비슷한 글이다.',
    inputSchema: { type: 'object', properties: { q: str('찾을 이름'), knowledge: str('지식 id(없으면 지식마다 따로)'), source: str('넣을 글(원천 본문 · 6만 자까지): 그 글에 나오는 있는 항목을 과거 결정 카드로 싣는다') }, required: ['q'] },
  },
  {
    name: 'search',
    description: '말 → 정리된 항목 후보(coords)와 자리 없는 글의 토막(passages). 사용자 질문은 q 로 그대로 넣는다. 이름(exact)에 없으면 없는 것이다. 낱말 단이 빈손이면 「이 말로는 못 찾았다. 없다는 뜻은 아니다」: 다른 말이나 문서 목록으로. 토막은 정리된 문서가 아니다. 표지(label)를 답에 옮긴다. 조건에 든 나머지 수는 more 에 있다. 토막이 말하는 항목의 지금 글은 section 으로.',
    inputSchema: { type: 'object', properties: { q: str('사용자 질문 글 그대로'), words: { type: 'array', items: { type: 'string' }, description: '고른 낱말(10개까지)' }, knowledge: str('지식 id(없으면 지식마다 따로)') } },
  },
  {
    name: 'section',
    description: '항목 하나의 지금 글(본문만: 출처 줄은 kmd 가 문서 끝 참고에 따로 둔다) · 지문(base) · 그 항목을 건드린 기록(아직 문서에 안 넣은 것은 최신 8) · 항목 이력(history: 그 항목에 이어진 기록 · 새것부터 20 · 넘친 수 historyMore). 항목(coord) 또는 문서 · 머리로 가리킨다. 그 항목을 고쳐 save 할 때 base 를 같이 보내면 그사이 남이 바꿨을 때 덮지 않는다.',
    inputSchema: { type: 'object', properties: { knowledge: str('지식 id'), coord: str('항목: 예 proc:헬스체크'), doc: str('문서: 예 배포절차'), heading: str('머리: 예 헬스 체크') }, required: ['knowledge'] },
  },
  {
    name: 'propose',
    description: '저장 제안: save 와 같은 입력을 받아 쓰지 않고 kmd 가 정한 꼴의 【저장 제안】 글(text)을 돌려준다. 남기기 전에 늘 부르고 text 를 사람에게 보여 승인받는다(승인한 proposal 을 save 에 싣는다). 사람이 고칠 것(빼기 · 값 · 문장 고치기 · 기록 범위 줄이기 · 넣을 곳 바꾸기)을 말하면 입력을 고쳐 다시 propose 하고 바뀐 줄만 다시 보인다(경고 줄과 끝 줄은 늘). 정해지지 않은 것은 넣지 않는다(memo 는 없다). 고칠 항목의 옛 → 새 줄 · 새 항목(문서) · 새 문서 · 새 갈래 · 종류 · 새 항목(장부 · 비슷한 것 near) · 이을 항목(글 그대로) · 뺀다 · 검사(경고 w · 오류 e). items(고침 · 신설 · 잇기 · before/after · changed · base) · warnings[{ id, code, at, why }] · errors[{ code, at, why, near }] · proposal(64자 지문 · 오류가 있으면 null). text 는 고치지 않고 사람에게 보인다. 오류가 있으면 입력을 고쳐 다시 propose 한다. 고칠 것을 들으면 입력을 바꿔 다시 propose 한다(지문이 바뀐다). 새 항목 · 문서 · 머리 · 갈래 · 종류가 있는 것과 같은 이름(빈칸 · 부호만 다름)이면 오류: 있는 것에 잇거나 다른 것이면 distinct 에 그 이름을 넣는다. 사람이 뺀 것은 excluded 에 { name, why } 로(제안서에만 보인다). 쓰기 자리부터.',
    inputSchema: {
      type: 'object',
      properties: {
        knowledge: str('지식 id'),
        record: { type: 'object', description: 'save 의 record 와 같다(서식 칸 changes · why · dropped · impact · refs · touches …)' },
        sections: { type: 'array', items: { type: 'object' }, description: 'save 의 sections 와 같다({ coord | doc · heading, base, edits | content })' },
        names: { type: 'array', items: { type: 'object' }, description: 'save 의 names 와 같다' },
        forms: { type: 'array', items: { type: 'object' }, description: 'save 의 forms 와 같다' },
        kinds: { type: 'array', items: { type: 'string' }, description: '새 종류(항목의 종류: 영문 소문자 또는 한글)' },
        distinct: { type: 'array', items: { type: 'string' }, description: '있는 것과 이름이 같거나 비슷하지만 다른 것으로 세울 항목 · 문서 · 머리 · 갈래 · 종류' },
        excluded: { type: 'array', items: { type: 'object', properties: { name: str('뺀 항목'), why: str('까닭 한 줄') }, required: ['name'] }, description: '제안서 「뺀다」 줄(기록에는 남지 않는다)' },
      },
      required: ['knowledge', 'record'],
    },
  },
  {
    name: 'save',
    description: [
      '승인한 저장 제안을 남긴다: 기록 + 항목 글 + 지문이 한 묶음으로 들어간다. 먼저 propose 로 같은 입력의 저장 제안을 받아 사람에게 보이고 승인받은 그 proposal 을 싣는다(저장 제안을 받는 지식: 없거나 그사이 입력 · 지식이 바뀌어 어긋나면 E_APPROVE 로 아무것도 쓰지 않고 details.propose 에 새 제안이 온다 · 다시 보이고 다시 승인받는다). 승인이 제안서의 경고를 받아들이는 것이다. 기록 글은 서식으로만 받는다(E_INPUT): changes(바뀐 것: 「무엇: 옛 값 → 새 값」 목록) · why(까닭) · dropped(버린 안) · impact(영향) · refs(근거: 커밋 · 문서 판) · body 는 한두 문장 요약(300자 안 · 문단 하나). kmd 가 칸마다 머리(## 바뀐 것 …)를 달아 글로 엮는다. 바뀐 것의 값은 고칠 항목 글에 들어가야 한다. 바뀐 값 없이 경위만 있는 기록은 항목 글 없이 touches 의 항목에 글 그대로 잇는다. touches 는 match 로 찾은 항목 장부의 항목만 받는다(장부에 없는 항목 · 폐기된 항목은 거절하고 가까운 항목을 알려 준다). 이을 항목이 정말 없으면 touches 를 비우고 touchesEmpty 에 까닭 한 줄을 적는다(기록 모음 문서의 그 달 항목에 잇는다 · 둘 다 비면 거절). 정해지지 않은 것은 저장하지 않는다(메모는 없다 · 이슈를 받는 갈래가 있으면 이슈 항목으로 제기). 새 문서는 갈래 장부의 갈래 이름으로만 선다(파일 이름 · 날짜 · 판이 든 이름은 거절 · 통화 · 미팅 메모는 회의록 문서의 「YYYY-MM-DD 무엇」 항목으로). 항목 글을 고쳤으면 sections 에 바꿀 곳(edits: find → replace) 또는 새 글(content)을 base 와 같이 보낸다. 읽은 뒤 누가 고친 항목(지문이 다름 · base 없음)이 하나라도 있으면 E_CONFLICT 로 아무것도 쓰지 않는다(details.stale 의 항목을 section 으로 다시 읽고 다시 제안한다). E_RATE 면 details.retryAfter 초 뒤에 다시. kit 에 스킬 글이 준 판을 늘 싣는다. 새 항목(테이블 · 화면 · API · 절차 · 용어 …)을 세웠으면 names 로 항목 장부 · 문서 장부에 같이 올린다. 한 번에 한 묶음으로 남는다.',
      '항목 글(sections.content)은 본문만: 대상 하나의 지금을 확정된 것만 「…한다 · …이다」 로. 링크는 지식 문서 [배포 절차](배포절차.md) · 항목 [준비](배포절차.md#준비) · 바깥 https://… 만.',
      '넣지 않는 것(E_FORMAT · 하나라도 걸리면 아무것도 쓰지 않는다): 기록 · 이력 링크(../work/… · ../log/…) · /api/… 같은 시스템 주소 · <!-- --> 주석 · 끝의 **경과** 기록 링크 목록 · 닫히지 않은 코드 울타리 · # · ## 머리 줄. 짜임은 수준 표시(1. · 1) · -)로 들여쓰지 않는다. 지금 글에 이미 있던 줄은 거절하지 않는다(새로 넣은 줄만). 출처 줄은 kmd 가 참고에 단다.',
      '좋은 예: 「배포 창은 화 · 목 14:00 ~ 17:00 이다.」 나쁜 예: 「배포 창을 바꿨다는 기록이 있다([기록](../work/2026-1021-배포-창.md))」.',
      '알림만(거절하지 않는다 · warnings 에 「문서 짜임」): 머리 단계 건너뜀(## 바로 아래 ####) · ##### 머리 · 제목 · 요약 없음(메타 표는 요약이 아니다) · 머리글의 kmd 운영 말(좌표 · 섹션 · 동기화 · touches 같은 말). 이 저장으로 새로 생긴 것만 알린다.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        knowledge: str('지식 id'),
        kit: str('스킬 판(kmd-team-save · kmd-team-import · kmd-save 스킬 글이 준 값 그대로 · 예 "8")'),
        proposal: str('승인한 저장 제안의 지문(propose 가 준 proposal 64자 그대로): 저장 제안을 받는 지식(brief 의 saveMode: approve)은 꼭 싣는다. 없거나 어긋나면 E_APPROVE 로 아무것도 쓰지 않고 새 제안(details.propose)을 돌려준다'),
        distinct: { type: 'array', items: { type: 'string' }, description: 'propose 에 보낸 distinct 그대로' },
        excluded: { type: 'array', items: { type: 'object', properties: { name: str('뺀 항목'), why: str('까닭 한 줄') }, required: ['name'] }, description: 'propose 에 보낸 excluded 그대로' },
        kinds: { type: 'array', items: { type: 'string' }, description: 'propose 에 보낸 kinds 그대로' },
        attach: { type: 'array', description: '원본 첨부(쓰기 자리부터 · 사람이 원본도 첨부하라고 했을 때만): 파일마다 { path: docs/assets/ 아래 자리, b64: 파일 바이트의 base64 }. save 한 번에 합 8MB 까지 · 그림 · pdf · 오피스 · hwp · txt · zip. 같은 자리에 같은 파일이 있으면 그대로(same) · 다른 파일이 있으면 덮지 않고 E_CONFLICT. 기록 · 항목 글과 한 묶음', items: { type: 'object', properties: { path: str('docs/assets/<경로>'), b64: str('파일 바이트의 base64') }, required: ['path', 'b64'] } },
        record: {
          type: 'object',
          properties: {
            title: str('한 줄 제목: 「무엇: 어떻게」'),
            body: str('한두 문장 요약(300자 안 · 문단 하나 · 머리 줄 없이). 나머지는 아래 칸으로'),
            changes: { type: 'array', items: { type: 'string' }, description: '바뀐 것(꼭): 줄마다 「무엇: 옛 값 → 새 값」 · 새로 정한 것은 「무엇: 값」' },
            why: { type: 'array', items: { type: 'string' }, description: '까닭: 왜 바꿨나 · 누가 정했나' },
            dropped: { type: 'array', items: { type: 'string' }, description: '버린 안: 견준 다른 길과 버린 까닭(있으면)' },
            impact: { type: 'array', items: { type: 'string' }, description: '영향: 무엇이 바뀌나 · 누가 알아야 하나(있으면)' },
            refs: { type: 'array', items: { type: 'string' }, description: '근거: 커밋 · 문서 판 · 회의(있으면)' },
            touches: { type: 'array', items: { type: 'string' }, description: '글이 실제로 바뀌는 항목(coord)만: match 로 찾은 항목 장부의 항목 · 예 proc:헬스체크 · 읽기만 한 항목은 달지 않는다' },
            touchesEmpty: str('건드린 항목이 정말 없을 때만: 그 까닭 한 줄(예: 항목이 아직 없는 일정 메모). touches 와 같이 보내지 않는다'),
            tags: { type: 'array', items: { type: 'string' } },
            fixes: { type: 'array', items: { type: 'string' }, description: '바로잡는 기록 id: 앞서 남긴 내 기록의 값이 틀려 고쳐 다시 저장할 때(남의 기록은 지식관리자만)' },
          },
          // changes 는 서버가 본다(core/guard.js recordBody · 바뀐 것이 없는 경위만 기록은 저장 승인 지식에서 글 그대로 잇기)
          required: ['title'],
        },
        sections: {
          type: 'array',
          items: { type: 'object', properties: { coord: str('항목(종류:값)'), doc: str('문서'), heading: str('머리'), content: str('항목의 새 글 전체(머리 줄 빼고 · 본문만: 기록 링크 · 주석 · 경과 목록 없이): from · append 를 쓰면 잇는 말 · 바뀐 값만'), base: str('section 이 준 지문: 이미 있는 항목이면 꼭 · 읽은 뒤 바뀌었으면 거절'), edits: { type: 'array', items: { type: 'object', properties: { find: str('지금 글에 꼭 한 번 나오는 글(section 이 준 글에서 그대로 복사 · 줄 단위)'), replace: str('그 자리에 들어갈 글(덧붙이지 말고 그 문장을 고쳐 쓴다 · 지우면 빈 글)') }, required: ['find', 'replace'] }, description: '항목 글 전체(content) 대신 바꿀 곳만. base 와 같이. 서버가 지금 글에 대어 검사(꼴 · 값 대조)하고, 제안서에 옛 → 새 줄과 경고로 보인다' }, from: str('넣기 에이전트만: 원문 그대로여야 하는 표 · 값 덩이 하나를 그 머리로 가리키면 서버가 그 머리 아래를 옮긴다(content 다음에 붙는다) · 파일 전체("*")는 받지 않는다. 항목 글은 정리해 content 로'), append: { type: 'boolean', description: '넣기 에이전트만: 지금 항목 글 끝에 보탠다(지금 글을 다시 보내지 않는다)' } } },
        },
        forms: {
          type: 'array',
          description: '세울 갈래(지식관리자): 새 문서가 설 수 있는 갈래를 갈래 장부에 더한다. 일반 자리는 저장 제안의 새 갈래로 보이고 승인하면 선다',
          items: { type: 'object', properties: { name: str('갈래 = 문서 이름: 예 회의록'), aliases: { type: 'array', items: { type: 'string' }, description: '이 갈래로 모을 별칭: 예 통화 · 미팅' }, folder: str('문서 폴더: 예 1.2_사업관리'), kind: str('대상 · 서술 · 사건 · 대장'), pattern: str('그 문서의 항목 패턴: 예 이슈:*'), form: str('서식: 지식문서 · 결정기록 · 작업기록 · 대장'), props: { type: 'array', items: { type: 'object', properties: { name: str('속성 이름: 예 진행상태'), src: str('원본 칸'), how: str('쓰는 법 · 닫힌 값'), must: { type: 'boolean' } } }, description: '대장의 속성 정의(작성기준 6-3): 항목 속성 표의 행 · 차례 · 필수. 주면 갈래 장부의 「## 속성: <갈래>」 를 바꾼다(빈 목록이면 걷는다)' } }, required: ['name'] },
        },
        names: {
          type: 'array',
          description: '세울 항목(장부에 올린다): 종류는 그 지식의 종류(brief 의 kinds · 영문 소문자 또는 한글). 값은 빈칸 없는 열쇠(60자 안 · 문장 금지 · 설명은 label 에). 이미 장부에 있는 항목은 싣지 않는다(있는 항목의 자리 · 별칭 고침은 지식관리자만 · 그 항목을 건드리려면 touches 에 단다). doc · heading 을 주면 문서 장부에 그 문서의 그 머리가 이 항목의 자리로 오른다',
          items: { type: 'object', properties: { coord: str('종류:값: 예 table:tb_user · proc:배포승인 · 이슈:DPMS-ISS-20'), label: str('라벨: 예 사용자 테이블'), aliases: { type: 'array', items: { type: 'string' }, description: '별칭' }, doc: str('그 항목의 머리가 든 문서'), heading: str('그 항목 머리') }, required: ['coord', 'label'] },
        },
      },
      required: ['knowledge', 'record'],
    },
  },
]

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase()

async function baselineInfo(k, body, store) {
  const { blocks } = splitBlocks(body)
  if (!blocks.length) return {}
  const decl = await readDecl(k.dir).catch(() => []) // 깨진 장부 — 경고는 stops 줄이 한다
  const st = await store.sourceState(k.id)
  return {
    baseline: blocks.map((b) => {
      const d = decl.find((x) => x.name === b.src)
      const s = st[b.src] || {}
      const stale = !!s.checkedAt && (s.failures || 0) >= 2 && Date.now() - Date.parse(s.checkedAt) >= 2 * everyMs(d?.every)
      return { src: b.src, asof: b.asof, checkedAt: s.checkedAt || null, every: d?.every || null, stale, ...(b.missing ? { missing: `원천에 없다: ${b.missing} 확인` } : {}) }
    }),
  }
}

// 첨부 — save 한 번의 합(S-D30 · 본문 12MB 안 · 파일 하나는 core 가 32MB 로 본다)
export const MCP_ATTACH_MAX = 8 << 20

export function makeMcp(store) {
  // 대량 넣기 파서 꾸러미(K6-2) — 팀 서버 받기 자리의 가장 새 것 · 없거나 못 읽으면 null(brief 를 막지 않는다)
  const parserOf = async () => {
    try {
      return (await store.parserPackage?.()) || null
    } catch (e) {
      console.error('[kmd] 파서 꾸러미를 읽지 못했다', e?.message || e)
      return null
    }
  }
  const tools = {
    async brief({ knowledge } = {}, ctx) {
      if (!knowledge) {
        const ks = await store.all(ctx)
        return {
          // mine — 내가 승인으로 경고를 받아들인 기록 수(팀)
          knowledge: ks.map((k) => { const mine = store.mineIn(ctx, k); return { id: k.id, name: k.name, ...whereOf(store, k.id), docs: k.docs.length, records: k.works.length, ...(mine ? { mine } : {}) } }),
          ...(store.mode === 'pc' ? { kit: PC_KIT_REV } : { kit: TEAM_KIT_REV, parser: await parserOf() }),
          next: ks.length ? 'brief { knowledge } 로 지식 하나를 본다' : '아직 지식이 없다',
          stops: (await store.stops(ctx)).map((l) => l.text),
          // 노란 줄 — kmd 가 값을 바꾼 것 · 새 기기(한 번 실린다 · 사용자에게 그대로 전한다)
          notices: (await store.notices(ctx)).map((x) => x.b || x.text),
        }
      }
      const k = await store.get(knowledge, ctx)
      const mine = store.mineIn(ctx, k, { recent: 5 })
      // 저장 방식(저장 승인 설계 P-D5 · P-D40 · P11 · P12) — 늘 approve: 저장 제안을 승인받아 save(proposal)
      return {
        id: k.id,
        name: k.name,
        ...whereOf(store, k.id),
        saveMode: 'approve',
        ...(store.mode === 'pc' ? { kit: PC_KIT_REV } : { kit: TEAM_KIT_REV, parser: await parserOf() }),
        docs: k.docs.map((d) => ({ doc: d.id, title: d.title, headings: d.sections.map((s) => s.h) })),
        recent: k.works.slice(0, 10).map((w) => ({ id: w.id, date: w.date, author: w.author, title: w.title })),
        // 이 지식에서의 내 자리 — direct 면 sections 가 검사를 넘으면 그 순간 문서에(쓰기 이상 · hub.canSave) ·
        // ledgers 면 names · forms 가 곧바로 항목 · 갈래 장부에(지식관리자 · hub.canDirect), 아니면 저장 제안의 새 항목(장부) · 새 갈래로 ·
        // accepted · recent — 승인으로 받아들인 경고 수 · 내가 넣은 최근 기록 5(고쳐 다시 저장할 때 record.fixes 에 그 id)
        you: { role: store.mode === 'pc' ? '주인' : store.roleIn(k.id, ctx), direct: store.mode === 'pc' || store.canSave(ctx, k.id), ...(store.mode === 'pc' ? {} : { ledgers: store.canDirect(ctx, k.id) }), ...(mine || {}) },
        // 지식 생성 가드(작성기준 9절) — 항목의 종류 · 새 문서의 갈래 · 지키는 법. save 가 같은 규칙으로 거절한다
        kinds: [...new Set([...k.vocab.coords.keys()].map((c) => c.slice(0, c.indexOf(':'))))],
        // 생성 룰(지식 생성 하네스 H3 · 새 칸 — 옛 칸은 그대로 둔다): 판 · 지문 · 조문 제목 · 씨앗 종류와 이 지식의 종류 뜻 · 문서 성격 줄 · 새 문서가 닫음인가
        rulesRev: GEN_RULES_REV,
        rulesHash: rulesHash(),
        ruleTitles: ruleTitles(),
        kindCards: { seed: seedKindCards(), own: [...(k.vocab.kinds || new Map()).entries()].map(([kind, gist]) => ({ kind, gist })) },
        natures: [...(k.forms.natures || new Map()).entries()].map(([doc, v]) => ({ doc, nature: v.nature, ...(v.summary ? { summary: v.summary } : {}) })),
        formsOwn: !!k.forms.closed,
        forms: k.forms.rows.map((f) => ({ name: f.name, aliases: f.aliases, ...(f.folder ? { folder: f.folder } : {}), kind: f.kind, ...(f.pattern ? { pattern: f.pattern } : {}), ...formGuide(f) })),
        rules: [
          'touches 는 match 로 찾은 항목 장부의 항목만. 새 항목은 names 로 같이 세운다(값은 빈칸 없는 열쇠 · 설명은 label)',
          '건드린 항목이 정말 없으면 touches 를 비우고 touchesEmpty 에 까닭 한 줄',
          k.forms.closed ? '새 문서는 forms 의 갈래 이름 · 폴더로만. 갈래에 없는 문서가 필요하면 forms 로 새 갈래를 같이 제안한다' : '새 문서 이름은 갈래 · 주제(회의록 · 장애 대응 · 보고서 · 주제 이름). 파일 이름 · 날짜 · 판을 쓰지 않는다. 통화 · 미팅은 회의록의 「YYYY-MM-DD 무엇」 항목',
        ],
        // 넣는 길(팀 · 개인 한 벌 · 저장 승인 설계 P-D44 · P11 · PC6) — 승인한 제안이 기록 + 항목 글 한 번에
        put: '저장 제안(propose)을 사람에게 보이고 승인받은 proposal 을 실어 save 하면 기록과 항목 글이 한 번에 들어간다. 정해지지 않은 것은 저장하지 않는다',
        ...(store.owner(k.id)?.noClaude ? { noClaude: '이 지식은 들이기에 Claude 를 쓰지 않는다(주인이 정했다). 이 대화로 옮기는 글은 꼭 필요한 것만' } : {}),
        stops: (await store.stops(ctx, k.id)).map((l) => l.text),
      }
    },

    async match({ q, knowledge, source }, ctx) {
      if (!q || typeof q !== 'string') throw new KmdError('E_INPUT', '찾을 이름(q)이 없다')
      if (source != null && (typeof source !== 'string' || source.length > 60_000)) throw new KmdError('E_INPUT', '넣을 글(source)은 6만 자까지의 글이다')
      // 1단(정확한 이름)만 확정이다. 없거나 · 약하거나 · 항목이 비었으면 같은 응답에 2 ~ 4단을 싣는다
      const rs = await store.search(ctx, knowledge || null, { q })
      const found = []
      const weak = []
      const ladders = []
      for (const r of rs) {
        for (const c of r.exact) found.push({ knowledge: r.knowledge, coord: c.coord || null, name: c.name, doc: c.doc, heading: c.heading, exact: true, inDocs: !!c.heading, pending: c.pending || 0 })
        for (const w of r.weak) weak.push({ knowledge: r.knowledge, ...w })
        const thin = !r.exact.length || r.exact.some((c) => !c.heading)
        if (thin) ladders.push({ knowledge: r.knowledge, coords: r.coords, passages: r.passages, more: r.more, exhaustive: false, label: r.label })
      }
      // 문서 제목 맞음(빈칸 무시) — 항목 장부에 없어도 그 문서를 확정으로 싣는다
      const sq = (x) => String(x || '').normalize('NFC').replace(/\s+/g, '').toLowerCase()
      for (const r of rs) {
        const k = await store.get(r.knowledge, ctx).catch(() => null)
        for (const d of k ? k.docs : []) if (sq(d.title) === sq(q) || sq(d.id) === sq(q)) found.unshift({ knowledge: r.knowledge, coord: null, name: d.title, doc: d.id, heading: null, exact: true, inDocs: true, kind: 'doc', headings: d.sections.map((x) => x.h).slice(0, 40) })
      }
      found.sort((a, b) => (a.inDocs ? 0 : 1) - (b.inDocs ? 0 : 1))
      const out = { found }
      if (weak.length) out.weak = { items: weak, note: '말이 이름을 품거나 이름이 말을 품어 걸렸다. 확정하지 말 것' }
      if (ladders.some((l) => l.coords.length || l.passages.length)) out.ladder = ladders
      if (!found.length) out.note = '항목 값 · 라벨 · 별칭 · 항목 머리에는 없다. 아래는 비슷한 글이다(정리된 문서가 아니다). 사용자 질문은 search 의 q 로'
      // 과거 결정 카드(지식 생성 하네스 H3 · H-D5) — 지식 하나를 가리켰을 때만 · 그 지식을 읽을 자리로 거른 것(store.get 이 404 로 막는다) · 옛 칸은 그대로 둔다
      if (knowledge) {
        const k = await store.get(knowledge, ctx)
        const p = precedentsFor(k, { q, text: source || '' })
        Object.assign(out, { cards: p.cards, prior: p.prior, coverage: p.coverage, toc: p.toc, ...(p.none ? { none: p.none } : {}), ...(p.tocCut ? { tocCut: true } : {}), rulesRev: GEN_RULES_REV })
      }
      return out
    },

    async search({ q, words, knowledge }, ctx) {
      if (!q && !(Array.isArray(words) && words.length)) throw new KmdError('E_INPUT', '찾을 말(q 또는 words)이 없다')
      const rs = await store.search(ctx, knowledge || null, { q: String(q || ''), words: Array.isArray(words) ? words.slice(0, 10).map(String) : null })
      return {
        results: rs.map((r) => ({
          knowledge: r.knowledge,
          exact: r.exact,
          coords: r.coords,
          passages: r.passages,
          more: r.more,
          exhaustive: r.exact.length > 0,
          ...(r.exact.length ? {} : { label: r.label }),
          ...(r.empty ? { note: '이 말로는 못 찾았다. 없다는 뜻은 아니다. 다른 말이나 brief 의 문서 목록으로' } : {}),
        })),
      }
    },

    async section({ knowledge, coord, doc, heading }, ctx) {
      const k = await store.get(knowledge, ctx)
      let d = null
      let sec = null
      let coords = []
      // 무엇을 읽을지 없으면 — 「문서 undefined 가 없다」 대신(UX T3-09)
      if (!coord && !doc) throw new KmdError('E_INPUT', 'coord(항목) 또는 doc(문서 · 필요하면 heading)를 준다')
      if (coord) {
        const x = sectionOf(k, coord)
        if (!x) {
          const known = k.vocab?.coords?.has?.(coord) || k.works.some((w) => w.touches.includes(coord))
          throw new KmdError('E_NOTFOUND', known ? `「${labelOf(k, coord)}」 이 들어갈 문서가 정해져 있지 않다. 기록에만 있다` : `「${coord}」 은 항목 장부에 없다. match 로 가까운 항목을 찾는다`)
        }
        d = x.doc
        sec = x.sec
        coords = [coord]
        if (!sec) {
          const recs = k.works.filter((w) => w.touches.includes(coord))
          return { knowledge: k.id, coord, doc: x.loc.doc.replace(/^docs\/|\.md$/g, ''), heading: x.loc.heading, content: null, note: '아직 문서에 이 항목이 없다', records: recs.map(recOut) }
        }
      } else {
        d = k.docs.find((x) => x.id === doc || x.title === doc)
        if (!d) throw new KmdError('E_NOTFOUND', `문서 「${doc}」 이 없다`)
        if (heading == null) return { knowledge: k.id, doc: d.id, title: d.title, intro: d.intro, headings: d.sections.map((s) => s.h) }
        sec = d.sections.find((s) => headingMatches(s.h, heading))
        if (!sec) throw new KmdError('E_NOTFOUND', `「${d.title}」 에 「${heading}」 항목이 없다`)
        coords = coordsOfSection(k, d, sec.h)
      }
      const recs = k.works.filter((w) => w.touches.some((c) => coords.includes(c)))
      return {
        knowledge: k.id,
        doc: d.id,
        title: d.title,
        heading: sec.h,
        coords,
        content: sec.body,
        base: sha16(sec.body),
        // 저절로 채우는 표 — 원천 · 원천 기준 시각 · 확인 시각 · 낡음(낡았으면 답에 그 사실을 옮긴다)
        ...(await baselineInfo(k, sec.body, store)),
        lastPut: sec.applied || null,
        records: recs.slice(0, 10).map(recOut),
        // 항목 이력(저장 승인 설계 P-D12 · P2) — 그 항목에 이어진 기록 줄(건드린 항목 · 표지 · 넣은 것 칸) · 새것부터 20 + 넘친 수
        ...(() => { const h = sectionHistory(k, d, sec.h); return { history: h.items.map(recOut), historyMore: h.more } })(),
      }
    },

    // 저장 제안(저장 승인 설계 P-D3 · 2-1 · P2) — 쓰지 않는다 · 자리 · 입력 모양은 hub.propose 가 본다(쓰기 자리 · E_INPUT)
    async propose({ knowledge, record, sections, names, forms, kinds, distinct, excluded }, ctx) {
      const listOf = (v) => {
        if (typeof v !== 'string') return v
        try { const x = JSON.parse(v); return Array.isArray(x) ? x : v } catch { return v }
      }
      if (typeof record === 'string') try { record = JSON.parse(record) } catch { /* 모양 검사가 거절한다 */ }
      if (typeof knowledge !== 'string' || !knowledge) throw new KmdError('E_INPUT', '지식 id(knowledge)가 없다')
      const input = { record, sections: listOf(sections), names: listOf(names), forms: listOf(forms), kinds: listOf(kinds), distinct: listOf(distinct), excluded: listOf(excluded) }
      for (const x of Object.keys(input)) if (input[x] === undefined) delete input[x]
      return store.propose(ctx, knowledge, input, { form: true, path: '이 세션의 작업' })
    },

    async save({ knowledge, record, sections, names, forms, kit, attach, proposal, distinct, excluded, kinds }, ctx) {
      // 도구 모양을 배포 전에 받아 둔 세션은 모르는 칸(forms 등)의 목록을 글(JSON)로 보낸다 — 목록 글이면 풀어 받는다
      const listOf = (v) => {
        if (typeof v !== 'string') return v
        try { const x = JSON.parse(v); return Array.isArray(x) ? x : v } catch { return v }
      }
      ;[sections, names, forms, attach, distinct, excluded, kinds] = [listOf(sections), listOf(names), listOf(forms), listOf(attach), listOf(distinct), listOf(excluded), listOf(kinds)]
      // 첨부(S-D30 · K6-4) — 사람이 「원본도 첨부」 라고 했을 때만 스킬이 싣는다 · 한 번 합 8MB · 모양 · 자리 · 쓰기 자리는 저장 문이 본다
      if (attach != null) {
        if (!Array.isArray(attach)) throw new KmdError('E_INPUT', 'attach 는 { path, b64 } 의 목록이다')
        const bytes = attach.reduce((a, x) => a + Math.floor((String(x?.b64 || '').length * 3) / 4), 0)
        if (bytes > MCP_ATTACH_MAX) throw new KmdError('E_TOO_BIG', `첨부는 save 한 번에 ${MCP_ATTACH_MAX >> 20}MB 까지: 큰 원본은 첨부하지 않고 글만 넣는다`)
        if (!attach.length) attach = null
      }
      if (typeof record === 'string') try { record = JSON.parse(record) } catch { /* 모양 검사가 거절한다 */ }
      const k = await store.get(knowledge, ctx)
      // 이미 있는 항목을 갈아 끼우는 글에는 base 가 있어야 한다 — 없으면 그사이 남이 고친 글을 덮는다
      // (kmd 가 띄운 넣기 에이전트는 그 파일의 글을 들이는 일이라 뺀다 — 사람의 세션이 남의 고침을 덮지 않게 하는 것)
      //   팀 · 개인 지식 모두 저장 문이 줄 안에서 같은 것을 보고 details.stale 를 싣는다(hub.save · 지문 한 벌 · 저장 승인 설계 b26 · PC1)
      for (const x of Array.isArray(sections) && !ctx?.agent ? sections : []) {
        if (x && (x.from != null || x.append)) throw new KmdError('E_INPUT', 'from · append 는 kmd 넣기 에이전트만 쓴다. 항목의 새 글 전체를 content 로 보낸다')
      }
      // 채널은 서버가 정한다(S-D3 · 설계 2-1) — 넣은 파일 표지(ingest/)가 있으면 대량 넣기, 아니면 세션
      const channel = (Array.isArray(record?.tags) ? record.tags : []).some((t) => String(t).startsWith('ingest/')) ? 'bulk' : 'session'
      // 스킬 판(kit) — 측정 줄에만 싣는다(옛 판 · 판 없음 안내 reinstall · nokit 은 걷었다 · P11 · 혼자 쓰는 판)
      const have = typeof kit === 'number' || (typeof kit === 'string' && /^\s*\d{1,6}\s*$/.test(kit)) ? Number(kit) : null
      // 승인한 저장 제안(저장 승인 설계 P-D5 · P3 · PC1) — proposal 이 의무(없거나 어긋나면 E_APPROVE + 새 propose 결과)
      const extra = { ...(proposal != null ? { proposal } : {}), ...(distinct != null ? { distinct } : {}), ...(excluded != null ? { excluded } : {}), ...(kinds != null ? { kinds } : {}) }
      const r = await store.save(ctx, k.id, { record, sections, ...(names ? { names } : {}), ...(forms ? { forms } : {}), ...(attach ? { attach } : {}), ...extra }, { guard: 'strict', form: true, channel, ...(Number.isInteger(have) ? { kit: have } : {}) })
      if (r.same) return { saved: r.id, same: true, docs: [], note: r.note }
      const n = r.docs.length
      const note = r.note || (n ? `저장했다. 기록 1 · 문서 ${n}` : '저장했다. 기록 1')
      return { saved: r.id, date: r.date, docs: r.docs.map((p) => p.replace(/^docs\/|\.md$/g, '')), note, ...(r.attach ? { attach: r.attach } : {}), ...(r.put != null ? { put: r.put } : {}), warnings: r.warnings }
    },
  }

  // 상태 말 — 저장 문의 새 상태(넣지 못함 · 메모 · 바로잡힘 · 되돌림)는 「문서에 들어감」 으로 보이지 않게(S4 · 나머지 말은 S10)
  //   팀 · 개인 한 벌(저장 승인 설계 P-D44 · P4 · PC2) — 저장 승인 전 기록은 「기록」 하나(옛 상태를 가르지 않는다 · P12)
  const STATE_WORD = { old: '기록', fixed: '바로잡힘', reverted: '되돌림', none: 'kmd 가 한 일' }
  const recOut = (w) => ({ id: w.id, date: w.date, author: w.author, title: w.title, state: STATE_WORD[w.state] || '문서에 들어감' })

  async function call(msg, ctx) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: '요청 모양이 아니다' } }
    const { id, method, params } = msg
    const ok = (result) => ({ jsonrpc: '2.0', id, result })
    const err = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
    if (msg.jsonrpc !== '2.0' || typeof method !== 'string') return err(-32600, '요청 모양이 아니다')
    if (id === undefined) return null // 알림 — 답하지 않는다
    if (method === 'initialize') {
      const want = params?.protocolVersion
      return ok({ protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'kmd', version: VERSION }, instructions: instructionsFor(store.mode) })
    }
    if (method === 'ping') return ok({})
    if (method === 'tools/list') return ok({ tools: TOOLS })
    if (method === 'tools/call') {
      // 물려받은 이름(constructor · toString · __proto__)은 도구가 아니다
      const f = typeof params?.name === 'string' && Object.hasOwn(tools, params.name) ? tools[params.name] : null
      if (!f) return err(-32602, `그런 도구는 없다: ${params?.name}`)
      try {
        const out = await f(params.arguments || {}, ctx)
        return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out })
      } catch (e) {
        if (!(e instanceof KmdError)) console.error('[kmd] 도구 오류', params?.name, e)
        const out = { error: e.code || 'E_INTERNAL', message: e instanceof KmdError ? e.message : '서버 안에서 넘어졌다. 서버 창의 글을 본다', ...(e instanceof KmdError && e.details ? { details: e.details } : {}) }
        return ok({ content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: true })
      }
    }
    return err(-32601, `모르는 요청: ${method}`)
  }

  return { call, tools }
}
