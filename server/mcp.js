// MCP — Claude Code 세션이 kmd 를 읽고 쓰는 길(Streamable HTTP · JSON 응답 하나).
//
// 도구 넷(K0): brief(지금 무엇이 있나) · match(이름으로 찾기) · section(항목 글 읽기) · save(기록 남기기).
// 세션 응답의 말은 사람 화면과 같은 쉬운 말로 쓴다.
//
// SDK 없이 JSON-RPC 몇 갈래만 받는다 — initialize · tools/list · tools/call · ping. 서버가 세션을
// 기억하지 않으므로(무상태) 다시 띄워도 세션이 끊기지 않는다.

import { KmdError } from '../core/errors.js'
import { labelOf, sectionOf, coordsOfSection, pendPick } from '../core/knowledge.js'
import { headingMatches } from '../core/sections.js'
import { VERSION } from './version.js'
import { sha16 } from '../core/text.js'
import { formGuide } from '../core/guard.js'
import { splitBlocks } from '../core/baseline.js'
import { readDecl, everyMs } from '../core/sources.js'
import { TEAM_KIT_REV } from '../core/teamkit.js'


const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

const INSTRUCTIONS = [
  'kmd 는 팀 지식과 개인 지식이다. 문서(항목 = ## 머리)와 기록(누가 무엇을 왜 바꿨나).',
  '일을 시작할 때 brief 로 무엇이 있나 본다. 이름을 알면 match 로 그 항목을 찾고 section 으로 지금 글을 읽는다.',
  '일을 마치면 save 로 기록을 남긴다. 기록 글은 서식 칸으로: changes(바뀐 것 · 꼭) · why(까닭) · dropped(버린 안) · impact(영향) · refs(근거) · body 는 한두 문장 요약. 건드린 이름(touches)을 단다. 항목 글을 고쳤으면 sections 에 바꿀 조각(edits)이나 새 글(content)을 같이 보낸다. 이미 있는 항목이면 section 이 준 base 를 꼭 같이(없거나 그사이 바뀌었으면 E_CONFLICT 로 아무것도 쓰지 않는다 · 다시 읽고 다시 보낸다). 값이 아직 확정되지 않았으면(머지 · 배포 · 결정 전) record.memo: true 로 기록만 남긴다(항목 글은 보내지 않는다).',
].join('\n')
// 이 서버가 어느 쪽인가 — 한 폴더에 팀(kmd-team) · 개인(kmd) 두 연결이 같이 붙으므로 세션이 가려 남기게
const WHERE = {
  pc: '이 연결은 이 PC 의 개인 지식이다(where: me). 여기 남긴 것은 나만 본다. 어느 지식에 남길지 애매하면 사람에게 묻는다.',
  team: '이 연결은 팀 서버다(where: team). 팀 지식에 남긴 것은 그 지식을 보는 팀 사람이 본다. 남기기 전에 어느 팀 지식에 남길지 사람에게 묻는다. 쓰기 자리 이상이면 기록과 항목 조각이 한 번에 저장되고, 저장 순간 검사를 넘은 조각은 그때 문서에 들어간다. 못 넘은 조각은 기록에 「넣지 못함」 으로 남는다(답의 proposals 에 까닭 · 고쳐서 record.fixes 로 다시 저장한다).',
}
export const instructionsFor = (mode) => INSTRUCTIONS + '\n' + (WHERE[mode] || WHERE.team)
// 지식마다 갈래 · 남기면 보는 사람
const whereOf = (store, id) => (store.mode === 'pc' ? { where: 'me', seenBy: '나만(이 PC)' } : { where: 'team', seenBy: '이 팀 지식을 보는 팀 사람' })

const str = (description) => ({ type: 'string', description })
const TOOLS = [
  {
    name: 'brief',
    description: '지금 kmd 에 무엇이 있나: 지식 목록 · 지식 하나의 문서 · 최근 기록 · 아직 문서에 안 넣은 기록. 팀 지식이면 지식마다 mine(내가 남긴 것 가운데 안 넣은 메모 memos · 넣지 못함 held 의 수: 0 이 아니면 사람에게 한 줄로) · 지식 하나의 you.recent(그 기록의 제목 · 까닭) · kit(팀 서버의 스킬 판) · parser(대량 넣기 파서 꾸러미: ver · url · sha256 · bytes · 없으면 null). 일을 시작할 때 한 번.',
    inputSchema: { type: 'object', properties: { knowledge: str('지식 id(없으면 목록)') } },
  },
  {
    name: 'match',
    description: '이름으로 항목을 찾는다. 정한 이름 · 다른 이름 · 항목 머리가 정확히 같으면 found(확정). weak 는 약한 대조다. 확정하지 말고 같이 실린 후보(ladder)를 보거나 search 로 넓힌다. found 가 비면 「정한 이름에는 없다」 는 뜻이고, ladder 는 비슷한 글이다.',
    inputSchema: { type: 'object', properties: { q: str('찾을 이름'), knowledge: str('지식 id(없으면 지식마다 따로)') }, required: ['q'] },
  },
  {
    name: 'search',
    description: '말 → 정리된 항목 후보(coords)와 자리 없는 글의 토막(passages). 사용자 질문은 q 로 그대로 넣는다. 이름(exact)에 없으면 없는 것이다. 낱말 단이 빈손이면 「이 말로는 못 찾았다. 없다는 뜻은 아니다」: 다른 이름이나 문서 목록으로. 토막은 정리된 문서가 아니다. 표지(label)를 답에 옮긴다. 조건에 든 나머지 수는 more 에 있다. 토막이 말하는 항목의 지금 글은 section 으로.',
    inputSchema: { type: 'object', properties: { q: str('사용자 질문 글 그대로'), words: { type: 'array', items: { type: 'string' }, description: '고른 낱말(10개까지)' }, knowledge: str('지식 id(없으면 지식마다 따로)') } },
  },
  {
    name: 'section',
    description: '항목 하나의 지금 글(본문만: 출처 줄은 kmd 가 문서 끝 참고에 따로 둔다) · 지문(base) · 그 항목을 건드린 기록(아직 문서에 안 넣은 것은 최신 8). 이름(coord) 또는 문서 · 머리로 가리킨다. 그 항목을 고쳐 save 할 때 base 를 같이 보내면 그사이 남이 바꿨을 때 덮지 않는다.',
    inputSchema: { type: 'object', properties: { knowledge: str('지식 id'), coord: str('이름: 예 proc:헬스체크'), doc: str('문서: 예 배포절차'), heading: str('머리: 예 헬스 체크') }, required: ['knowledge'] },
  },
  {
    name: 'save',
    description: [
      '기록을 남긴다. 제목 · 서식 칸 · 건드린 이름(touches). 기록 글은 서식으로만 받는다(E_INPUT): changes(바뀐 것: 「무엇: 옛 값 → 새 값」 목록 · 꼭 · 메모는 없어도 된다) · why(까닭) · dropped(버린 안) · impact(영향) · refs(근거: 커밋 · 문서 판) · body 는 한두 문장 요약(300자 안 · 문단 하나). kmd 가 칸마다 머리(## 바뀐 것 …)를 달아 글로 엮는다. touches 는 match 로 찾은 이름 장부의 이름만 받는다(장부에 없는 이름 · 폐기된 이름은 거절하고 가까운 이름을 알려 준다). 건드린 이름이 정말 없으면 touches 를 비우고 touchesEmpty 에 까닭 한 줄을 적는다(둘 다 비면 거절). 새 문서는 갈래 장부의 갈래 이름으로만 선다(파일 이름 · 날짜 · 판이 든 이름은 거절 · 통화 · 미팅 메모는 회의록 문서의 「YYYY-MM-DD 무엇」 항목으로). 팀 지식: 항목 글을 고쳤으면 sections 에 바꿀 조각(edits: find → replace) 또는 새 글(content)을 base 와 같이 보낸다. 쓰기 자리 이상이면 서버가 Claude 없이 조각을 대어 검사(꼴 · 값 대조 · 지문)하고, 넘으면 값 바꿈까지 그 순간 문서에 넣는다(기록과 한 묶음 · 기록의 「넣은 것」 에 옛 값 → 새 값). 못 넘은 조각은 기록에 「넣지 못함」 으로 남는다: 응답 proposals 로 자리마다 결과(ok · applied · why · code · changed · near)가 오니 그 자리에서 조각을 고쳐 다시 save 하고 record.fixes 에 앞 기록 id 를 단다. 읽은 뒤 누가 고친 항목(지문이 다름 · base 없음)이 하나라도 있으면 E_CONFLICT 로 아무것도 쓰지 않는다(details.stale 의 항목을 section 으로 다시 읽는다). E_RATE 면 details.retryAfter 초 뒤에 다시. 팀 지식: kit 에 스킬 글이 준 판을 늘 싣는다 · 없거나 옛 판이면 저장은 그대로 하고 답에 reinstall(다시 설치 안내)이 온다: 사람에게 그대로 한 줄로 전한다. 값이 확정되지 않았으면 record.memo: true(기록만 · 항목 글 없이). 새 이름(테이블 · 화면 · API · 절차 · 용어 …)을 세웠으면 names 로 이름 장부 · 자리 장부에 같이 올린다. 그 항목이 항목으로 보기 · 찾기에 그 종류로 선다. 한 번에 한 묶음으로 남는다.',
      '항목 글(sections.content)은 본문만: 대상 하나의 지금을 확정된 것만 「…한다 · …이다」 로. 링크는 지식 문서 [배포 절차](배포절차.md) · 항목 [준비](배포절차.md#준비) · 바깥 https://… 만.',
      '받지 않는 것(E_FORMAT): 기록 · 이력 링크(../work/… · ../log/…) · /api/… 같은 시스템 주소 · <!-- --> 주석 · 끝의 **경과** 기록 링크 목록 · 닫히지 않은 코드 울타리 · # · ## 머리 줄(소제목은 ###). 지금 글에 이미 있던 줄은 거절하지 않는다(새로 넣은 줄만). 출처 줄은 kmd 가 참고에 단다.',
      '좋은 예: 「배포 창은 화 · 목 14:00 ~ 17:00 이다.」 나쁜 예: 「배포 창을 바꿨다는 기록이 있다([기록](../work/2026-1021-배포-창.md))」.',
      '알림만(거절하지 않는다 · warnings 에 「문서 짜임」): 머리 단계 건너뜀(## 바로 아래 ####) · ##### 머리 · 제목 · 요약 없음(메타 표는 요약이 아니다) · 머리글의 kmd 운영 말(좌표 · 섹션 · 동기화 · touches 같은 말). 이 저장으로 새로 생긴 것만 알린다.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        knowledge: str('지식 id'),
        kit: str('팀 지식: 스킬 판(kmd-team-save · kmd-team-import 스킬 글이 준 값 그대로 · 예 "3")'),
        attach: { type: 'array', description: '원본 첨부(쓰기 자리부터 · 사람이 원본도 첨부하라고 했을 때만): 파일마다 { path: docs/assets/ 아래 자리, b64: 파일 바이트의 base64 }. save 한 번에 합 8MB 까지 · 그림 · pdf · 오피스 · hwp · txt · zip. 같은 자리에 같은 파일이 있으면 그대로(same) · 다른 파일이 있으면 덮지 않고 E_CONFLICT. 기록 · 조각과 한 묶음', items: { type: 'object', properties: { path: str('docs/assets/<경로>'), b64: str('파일 바이트의 base64') }, required: ['path', 'b64'] } },
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
            touches: { type: 'array', items: { type: 'string' }, description: '글이 실제로 바뀌는 항목의 이름(coord)만: match 로 찾은 이름 장부의 이름 · 예 proc:헬스체크 · 읽기만 한 항목은 달지 않는다(이름 하나가 정리의 자리 하나)' },
            touchesEmpty: str('건드린 이름이 정말 없을 때만: 그 까닭 한 줄(예: 항목이 아직 없는 일정 메모). touches 와 같이 보내지 않는다'),
            tags: { type: 'array', items: { type: 'string' } },
            fixes: { type: 'array', items: { type: 'string' }, description: '바로잡는 기록 id: 넣지 못함 · 메모로 끝난 내 앞 기록을 고쳐 다시 저장할 때(남의 기록은 지식관리자만)' },
            memo: { type: 'boolean', description: '메모: 값이 아직 확정되지 않았다(머지 · 배포 · 결정 전). 기록만 남고 문서는 바꾸지 않는다 · sections 를 같이 보내지 않는다 · changes 없이 body 만으로 된다(touches 또는 touchesEmpty 는 그대로 단다)' },
          },
          // changes 는 메모(memo: true)가 아니면 서버가 꼭 받는다(core/guard.js recordBody · E_INPUT)
          required: ['title'],
        },
        sections: {
          type: 'array',
          items: { type: 'object', properties: { coord: str('이름'), doc: str('문서'), heading: str('머리'), content: str('항목의 새 글 전체(머리 줄 빼고 · 본문만: 기록 링크 · 주석 · 경과 목록 없이): from · append 를 쓰면 잇는 말 · 바뀐 값만'), base: str('section 이 준 지문: 이미 있는 항목이면 꼭 · 읽은 뒤 바뀌었으면 거절'), edits: { type: 'array', items: { type: 'object', properties: { find: str('지금 글에 꼭 한 번 나오는 글(section 이 준 글에서 그대로 복사 · 줄 단위)'), replace: str('그 자리에 들어갈 글(덧붙이지 말고 그 문장을 고쳐 쓴다 · 지우면 빈 글)') }, required: ['find', 'replace'] }, description: '팀 지식: 항목 글 전체(content) 대신 바꿀 조각만. base 와 같이. 서버가 지금 글에 대어 검사(꼴 · 값 대조)하고 넘으면 그 순간 넣는다(값 바꿈도 · 권한 모델 7절). 걸리면 응답 proposals 에 까닭 · 가까운 줄이 온다: 기록은 남고 그 조각만 넣지 못함이니 조각을 고쳐 다시 save 한다(record.fixes 에 앞 기록 id)' }, from: str('넣기 에이전트만: 원문 그대로여야 하는 표 · 값 덩이 하나를 그 머리로 가리키면 서버가 그 머리 아래를 옮긴다(content 다음에 붙는다) · 파일 전체("*")는 받지 않는다. 항목 글은 정리해 content 로'), append: { type: 'boolean', description: '넣기 에이전트만: 지금 항목 글 끝에 보탠다(지금 글을 다시 보내지 않는다)' } } },
        },
        forms: {
          type: 'array',
          description: '세울 갈래(지식관리자): 새 문서가 설 수 있는 갈래를 갈래 장부에 더한다. 일반 자리는 기록에 실어 정리 때 관리자가 세운다',
          items: { type: 'object', properties: { name: str('갈래 = 문서 이름: 예 회의록'), aliases: { type: 'array', items: { type: 'string' }, description: '이 갈래로 모을 다른 이름: 예 통화 · 미팅' }, folder: str('문서 폴더: 예 1.2_사업관리'), kind: str('대상 · 서술 · 사건 · 대장'), pattern: str('그 문서의 항목 이름 패턴: 예 이슈:*'), form: str('서식: 지식문서 · 결정기록 · 작업기록') }, required: ['name'] },
        },
        names: {
          type: 'array',
          description: '세울 이름: 종류는 그 지식의 종류(brief 의 kinds · 영문 소문자 또는 한글). 값은 빈칸 없는 열쇠(60자 안 · 문장 금지 · 설명은 label 에). 이미 있는 이름이면 다른 이름만 보탠다. doc · heading 을 주면 그 항목이 이 이름의 자리가 된다',
          items: { type: 'object', properties: { coord: str('종류:값: 예 table:tb_user · proc:배포승인 · 이슈:DPMS-ISS-20'), label: str('보이는 이름: 예 사용자 테이블'), aliases: { type: 'array', items: { type: 'string' }, description: '다른 이름' }, doc: str('그 이름의 항목이 든 문서'), heading: str('그 항목 머리') }, required: ['coord', 'label'] },
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
          // mine — 내가 남긴 것 가운데 안 넣은 메모 · 넣지 못함 수(팀 · K3-3) · 스킬이 0 이 아니면 한 줄로 전한다
          knowledge: ks.map((k) => { const mine = store.mineIn(ctx, k); return { id: k.id, name: k.name, ...whereOf(store, k.id), docs: k.docs.length, records: k.works.length, notYetInDocs: k.works.filter((w) => w.state === 'pend').length, ...(mine ? { mine } : {}) } }),
          ...(store.mode === 'pc' ? {} : { kit: TEAM_KIT_REV, parser: await parserOf() }),
          next: ks.length ? 'brief { knowledge } 로 지식 하나를 본다' : '아직 지식이 없다',
          stops: (await store.stops(ctx)).map((l) => l.text),
          // 노란 줄 — kmd 가 값을 바꾼 것 · 새 기기(한 번 실린다 · 사용자에게 그대로 전한다)
          notices: (await store.notices(ctx)).map((x) => x.b || x.text),
        }
      }
      const k = await store.get(knowledge, ctx)
      const mine = store.mineIn(ctx, k, { recent: 5 })
      return {
        id: k.id,
        name: k.name,
        ...whereOf(store, k.id),
        ...(store.mode === 'pc' ? {} : { kit: TEAM_KIT_REV, parser: await parserOf() }),
        docs: k.docs.map((d) => ({ doc: d.id, title: d.title, headings: d.sections.map((s) => s.h) })),
        recent: k.works.slice(0, 10).map((w) => ({ id: w.id, date: w.date, author: w.author, title: w.title })),
        notYetInDocs: k.works.filter((w) => w.state === 'pend').map((w) => ({ id: w.id, date: w.date, title: w.title })),
        // 이 지식에서의 내 자리 — direct 면 sections 가 검사를 넘으면 그 순간 문서에(쓰기 이상 · hub.canSave) ·
        // ledgers 면 names · forms 가 곧바로 이름 · 갈래 장부에(지식관리자 · hub.canDirect), 아니면 기록의 「세울 이름」 칸으로 ·
        // memos · held · recent — 내 안 넣은 메모 · 넣지 못함(최근 5: 제목 · 까닭 · 고쳐 다시 저장할 때 record.fixes 에 그 id)
        you: { role: store.mode === 'pc' ? '주인' : store.roleIn(k.id, ctx), direct: store.mode === 'pc' || store.canSave(ctx, k.id), ...(store.mode === 'pc' ? {} : { ledgers: store.canDirect(ctx, k.id) }), ...(mine || {}) },
        // 지식 생성 가드(작성기준 9절) — 이름의 종류 · 새 문서의 갈래 · 지키는 법. save 가 같은 규칙으로 거절한다
        kinds: [...new Set([...k.vocab.coords.keys()].map((c) => c.slice(0, c.indexOf(':'))))],
        forms: k.forms.rows.map((f) => ({ name: f.name, aliases: f.aliases, ...(f.folder ? { folder: f.folder } : {}), kind: f.kind, ...(f.pattern ? { pattern: f.pattern } : {}), ...formGuide(f) })),
        rules: [
          'touches 는 match 로 찾은 이름 장부의 이름만. 새 이름은 names 로 같이 세운다(값은 빈칸 없는 열쇠 · 설명은 label)',
          '건드린 이름이 정말 없으면 touches 를 비우고 touchesEmpty 에 까닭 한 줄',
          k.forms.own ? '새 문서는 forms 의 갈래 이름 · 폴더로만. 갈래에 없는 문서가 필요하면 지식관리자에게(forms 로 갈래를 세운다)' : '새 문서 이름은 갈래 · 주제(회의록 · 장애 대응 · 보고서 · 주제 이름). 파일 이름 · 날짜 · 판을 쓰지 않는다. 통화 · 미팅은 회의록의 「YYYY-MM-DD 무엇」 항목',
        ],
        tidy: store.mode === 'pc' ? 'kmd 가 곧바로 문서에 넣는다' : ({ live: '실시간: 기록이 남고 5분 조용하면', manual: '손으로만: 누가 [지금 정리]' }[store.tidyModeOf(k.id)] || `정해진 시각 ${store.tidyAtOf(k.id)}`),
        ...(store.owner(k.id)?.noClaude ? { noClaude: '이 지식은 자동 정리에 Claude 를 쓰지 않는다(주인이 정했다). 이 대화로 옮기는 글은 꼭 필요한 것만' } : {}),
        stops: (await store.stops(ctx, k.id)).map((l) => l.text),
      }
    },

    async match({ q, knowledge }, ctx) {
      if (!q || typeof q !== 'string') throw new KmdError('E_INPUT', '찾을 이름(q)이 없다')
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
      const out = { found }
      if (weak.length) out.weak = { items: weak, note: '말이 이름을 품거나 이름이 말을 품어 걸렸다. 확정하지 말 것' }
      if (ladders.some((l) => l.coords.length || l.passages.length)) out.ladder = ladders
      if (!found.length) out.note = '정한 이름 · 다른 이름 · 항목 머리에는 없다. 아래는 비슷한 글이다(정리된 문서가 아니다). 사용자 질문은 search 의 q 로'
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
          ...(r.empty ? { note: '이 말로는 못 찾았다. 없다는 뜻은 아니다. 다른 이름이나 brief 의 문서 목록으로' } : {}),
        })),
      }
    },

    async section({ knowledge, coord, doc, heading }, ctx) {
      const k = await store.get(knowledge, ctx)
      let d = null
      let sec = null
      let coords = []
      if (coord) {
        const x = sectionOf(k, coord)
        if (!x) throw new KmdError('E_NOTFOUND', `「${labelOf(k, coord)}」 이 들어갈 문서가 정해져 있지 않다. 기록에만 있다`)
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
        notYetInDocs: pendPick(recs).pick.map((w) => ({ ...recOut(w), body: w.body })),
        notYetMore: pendPick(recs).more,
        records: recs.slice(0, 10).map(recOut),
      }
    },

    async save({ knowledge, record, sections, names, forms, kit, attach }, ctx) {
      // 도구 모양을 배포 전에 받아 둔 세션은 모르는 칸(forms 등)의 목록을 글(JSON)로 보낸다 — 목록 글이면 풀어 받는다
      const listOf = (v) => {
        if (typeof v !== 'string') return v
        try { const x = JSON.parse(v); return Array.isArray(x) ? x : v } catch { return v }
      }
      ;[sections, names, forms, attach] = [listOf(sections), listOf(names), listOf(forms), listOf(attach)]
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
      //   팀 지식은 저장 문이 줄 안에서 같은 것을 보고 details.stale 를 싣는다(hub.save) — 여기서는 이 PC 만
      for (const x of Array.isArray(sections) && !ctx?.agent ? sections : []) {
        if (x && (x.from != null || x.append)) throw new KmdError('E_INPUT', 'from · append 는 kmd 넣기 에이전트만 쓴다. 항목의 새 글 전체를 content 로 보낸다')
        if (!x || x.base || store.mode !== 'pc') continue
        const has = x.coord ? !!sectionOf(k, String(x.coord).trim().normalize('NFC'))?.sec : !!k.docs.find((d) => d.id === String(x.doc || '').replace(/^docs\/|\.md$/g, ''))?.sections.some((y) => headingMatches(y.h, String(x.heading || '')))
        if (has) throw new KmdError('E_CONFLICT', `「${x.coord || x.heading}」 은 이미 있는 항목이다. section 으로 다시 읽고 그 base 를 같이 보낸다(그사이 남이 고친 글을 덮지 않게)`)
      }
      // 채널은 서버가 정한다(S-D3 · 설계 2-1) — 넣은 파일 표지(ingest/)가 있으면 대량 넣기, 아니면 세션
      const channel = (Array.isArray(record?.tags) ? record.tags : []).some((t) => String(t).startsWith('ingest/')) ? 'bulk' : 'session'
      // 스킬 판(S-D15) — 팀 세션만 본다(kmd 가 띄운 넣기 에이전트 · 이 PC 는 팀 스킬이 아니다). 옛것 · 없음이면 저장은 그대로 하고 답에 reinstall
      const have = typeof kit === 'number' || (typeof kit === 'string' && /^\s*\d{1,6}\s*$/.test(kit)) ? Number(kit) : null
      const reinstall = store.mode !== 'pc' && !ctx?.agent && !(Number.isInteger(have) && have >= TEAM_KIT_REV)
        ? { reinstall: { have, want: TEAM_KIT_REV, how: '이 폴더의 kmd 팀 스킬이 옛 판이다(저장은 했다). 팀 화면 › 설정 › 에이전트 설치의 한 줄을 이 폴더에서 다시 붙여 넣고 Claude Code 를 새로 연다' } }
        : {}
      const r = await store.save(ctx, k.id, { record, sections, ...(names ? { names } : {}), ...(forms ? { forms } : {}), ...(attach ? { attach } : {}) }, { guard: 'strict', form: true, channel, ...(Number.isInteger(have) ? { kit: have } : {}) })
      if (r.same) return { saved: r.id, same: true, docs: [], note: r.note, ...reinstall }
      const n = r.docs.length
      const note = r.note || (n ? `저장했다. 기록 1 · 문서 ${n}` : store.mode === 'pc' ? '기록했다. 이 PC 는 kmd 가 곧바로 문서에 넣는다(정리를 기다리지 않는다)' : '저장했다. 기록 1')
      return { saved: r.id, date: r.date, docs: r.docs.map((p) => p.replace(/^docs\/|\.md$/g, '')), note, ...(r.attach ? { attach: r.attach } : {}), ...(r.put != null ? { put: r.put } : {}), ...(r.held ? { held: r.held } : {}), ...(r.memo ? { memo: true } : {}), warnings: r.warnings, ...(r.proposals ? { proposals: r.proposals } : {}), ...reinstall }
    },
  }

  // 상태 말 — 저장 문의 새 상태(넣지 못함 · 메모 · 바로잡힘 · 되돌림)는 「문서에 들어감」 으로 보이지 않게(S4 · 나머지 말은 S10)
  const STATE_WORD = { pend: '아직 문서에 안 넣음', held: '넣지 못함', memo: '메모', fixed: '바로잡힘', reverted: '되돌림', kept: '버림' }
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
