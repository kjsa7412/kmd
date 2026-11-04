// 들이기 — 넣은 파일(기록)을 지식 문서에 들일 때 쓰는 것: 후보 문서 · 갈래 장부 · 파일 이름의 갈래 · 주제 · 일 줄 자리 열쇠.
//
//   docs/품질개선/KMD_개편_설계.md 3-1 · 3-5. S2 에서 core/tidy.js · core/curate.js 에서 옮겼다(옛 파일은 다시 내보낸다).
//   들이기 엔진(INTAKE_SCHEMA · 프롬프트 · draftToSave)은 S7 에 더했다(아래).

import { sha16 } from './text.js'
import { formFor, DEFAULT_FORMS } from './guard.js'
import { valuesOf, groundedIn } from './values.js'
import { validEdits } from './edits.js'

// 문서 경로 — 「폴더/이름」 · 「docs/폴더/이름.md」 를 「docs/폴더/이름.md」 로
export const docRel = (p) => `docs/${String(p).replace(/^docs\/|\.md$/g, '')}.md`

// 넣은 파일 묶음에 싣는 갈래 장부 — 프롬프트가 「이 지식의 갈래」 로 보인다(없으면 Claude 가 파일 이름으로 새 문서를 세우고 가드에 걸린다)
export const formsOf = (k) => ({ forms: (k.forms?.rows || DEFAULT_FORMS).map((f) => ({ name: f.name, aliases: f.aliases, folder: f.folder || '', kind: f.kind })), formsOwn: !!k.forms?.own })

// 묶음 하나 = 일 줄의 자리 하나 — 일꾼 · 서버가 같은 열쇠로 진행을 맞춘다
export const spotKey = (g) => (g?.kind === 'section' ? 'c:' + g.coord : 'r:' + (g?.record?.id || ''))
export const spotTarget = (g) => (g.kind === 'section' ? `${g.doc.replace(/^docs\/|\.md$/g, '')} › ${g.heading}` : g.kind === 'ingest' ? `${g.record.file || g.record.title} · 문서에 들이기` : `${g.record.title} · 자리 고르기`)

// 넣은 파일과 가까운 문서 — 말(2글자 넘는 것)이 제목 · 머리에 겹치는 수로 다섯까지 · 항목마다 지금 글 · 지문
const wordsIn = (t) => new Set(String(t || '').toLowerCase().split(/[^0-9a-z가-힣]+/).filter((x) => x.length >= 2))
export function ingestCandidates(k, w, max = 5) {
  const want = wordsIn(`${w.title} ${[...String(w.body).matchAll(/^#{1,3} (.+)$/gm)].map((m) => m[1]).join(' ')}`)
  const scored = []
  for (const d of k.docs) {
    if (/<!--\s*watched:/.test(d.intro || '')) continue
    const have = wordsIn(`${d.title} ${d.id} ${d.sections.map((s) => s.h).join(' ')}`)
    const n = [...want].filter((x) => have.has(x)).length
    if (n) scored.push({ d, n })
  }
  return scored
    .sort((a, b) => b.n - a.n || a.d.id.localeCompare(b.d.id))
    .slice(0, max)
    .map(({ d }) => ({ doc: d.path, title: d.title, sections: d.sections.filter((s) => s.h).map((s) => ({ h: s.h, body: s.body.slice(0, 1500), base: sha16(s.body) })) }))
}
export const INGEST_SCHEMA = {
  type: 'object',
  properties: {
    updates: { type: 'array', items: { type: 'object', properties: { doc: { type: 'string' }, heading: { type: 'string' }, content: { type: 'string' } }, required: ['doc', 'heading', 'content'] }, description: '기존 문서(후보)의 항목에 넣을 것: 항목의 새 글 전체 · 없는 머리면 그 문서에 새 항목' },
    newDoc: { type: ['object', 'null'], properties: { path: { type: 'string' }, sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, content: { type: 'string' } }, required: ['heading', 'content'] } } }, description: '새 문서가 맞으면: 경로(폴더/이름 · .md 없이)와 항목들' },
    why: { type: 'string' },
  },
  required: ['updates'],
}

// 갈래 — 파일 이름 · 제목에 든 말로 고른다(Claude 없이). 문서 이름은 파일 이름이 아니라 갈래 · 주제(요구 15)
//   갈래는 지식의 갈래 장부(`_forms.md` · core/guard.js) — 없으면 기본 갈래(회의록 · 장애 대응 · 보고서)
export function kindOfName(s, forms = { rows: DEFAULT_FORMS }) {
  return formFor(forms, s)?.name || null
}
// 날짜 — 파일 이름의 YYYY-MM-DD · YYYYMMDD · YYYY.MM.DD
export const DATE_RE = /(20\d\d)[-._ ]?(0[1-9]|1[0-2])[-._ ]?(0[1-9]|[12]\d|3[01])/
// 주제 — 파일 이름에서 날짜 · 번호 · 판 · 「최종」 같은 조각을 걷은 것(남는 것이 없으면 파일 이름)
export function topicOfName(file) {
  const base = String(file).split('/').pop().replace(/\.[^.]+$/, '')
  const t = base
    .replace(/_+/g, ' ')
    .replace(DATE_RE, ' ')
    .replace(/[([](?:최종|final|사본|copy|\d+)[)\]]/gi, ' ')
    .replace(/(^|[\s-])[vV]\d+(\.\d+)*(?=$|[\s-])|\d+\s*판|최종|final|사본|copy/gi, ' ')
    .replace(/^\s*\d+[. -]+/, ' ')
    .replace(/[\s-]\d{2,8}\s*$/, ' ')
    .replace(/\s*[-·]\s*$|^\s*[-·]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t || base
}

// 들인 기록의 옛 판(옛 curate R-A3) — 같은 출처(태그 ingest/…)에 새 판이 있으면 옛 판은 keep.
//   돌려주는 줄마다 by = 새 판의 기록 id(core/curate.js decide 가 새 판을 만나는 차례에 싣는다)
//   옛 판이 넣지 못함(held)이거나 새 판이 fixes 로 옛 판을 가리키면 건너뛴다 — 바로잡힘(fixed)을 「둠」 으로 바꾸지 않는다(설계 3-1 · S-D4 ①)
export function supersededIngest(k) {
  const out = []
  const ingest = new Map()
  for (const w of [...k.works].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const src = w.tags.find((t) => t.startsWith('ingest/'))
    if (!src) continue
    const prev = ingest.get(src)
    const skip = prev && (prev.tags.includes('held') || (w.fixes || []).includes(prev.id))
    if (prev && !skip && !k.kept.has(prev.id) && !k.reverted.has(prev.id)) out.push({ id: prev.id, verdict: 'keep', rule: 'R-A3', reason: `새 판이 있다: ${w.id}`, by: w.id })
    ingest.set(src, w)
  }
  return out
}

// ── 들이기 엔진(S7 · docs/품질개선/KMD_개편_설계.md 3-5 · S-D18 ~ S-D22 · S-D31 · S-D32) ──
//   팀 일꾼이 일감 하나(원천 하나 · 파일 하나 · 커밋 하나)를 claude -p 한 번으로 「기록 + 조각」 초안을 짓고, 서버가 저장 문 한 번으로 넣는다.
//   프롬프트 첫 줄은 시험의 가짜 claude 갈래와 맞춘다(「넣을 것을 지식에 들인다」).

// 초안 꼴 — 기록(무엇: 어떻게 · 바뀐 것) · 있는 항목은 조각(edits) 먼저(절반 넘게 바뀌면 content) · 새 문서는 ## 항목으로만 · 세울 이름
export const INTAKE_SCHEMA = {
  type: 'object',
  properties: {
    record: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '「무엇: 어떻게」 한 줄(200자 안)' },
        body: { type: 'string', description: '한두 문장 요약' },
        changes: { type: 'array', items: { type: 'string' }, description: '바뀐 것: 「무엇: 옛 값 → 새 값」 또는 「무엇: 값」 의 목록' },
      },
      required: ['title', 'body', 'changes'],
    },
    updates: {
      type: 'array',
      description: '있는 문서(후보)의 항목: 있는 항목은 edits(찾아 바꿀 조각 · find 는 지금 글에 꼭 한 번) · 절반 넘게 바뀌면 content(새 글 전체) · 후보 문서에 없는 머리면 content 로 새 항목',
      items: {
        type: 'object',
        properties: {
          doc: { type: 'string' },
          heading: { type: 'string' },
          base: { type: 'string', description: '후보에 적힌 그 항목의 base 그대로' },
          edits: { type: 'array', items: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' } }, required: ['find', 'replace'] } },
          content: { type: 'string' },
        },
        required: ['doc', 'heading'],
      },
    },
    newDoc: { type: ['object', 'null'], properties: { path: { type: 'string' }, sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, content: { type: 'string' } }, required: ['heading', 'content'] } } }, description: '이어지는 문서가 없을 때만: 경로(폴더/이름 · .md 없이)와 ## 항목들' },
    names: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string' } }, required: ['name'] }, description: '새로 세운 항목의 이름(대상 이름 · 종류는 이 지식의 이름 종류 중 하나)' },
    why: { type: 'string' },
  },
  required: ['record', 'updates'],
}

// 원천 글을 프롬프트 · 기록에 싣는 상한 — 파일 하나 + 후보 다섯 × 1500자가 한 번 예산(KMD_INGEST_BUDGET)에 든다
export const INTAKE_SRC_MAX = 60_000
// 넣지 못함으로 끝난 들이기의 기록에 싣는 원천 앞부분(S-D50 · 기록만 저장이 200k 상한에 걸리지 않게)
export const HELD_SRC_HEAD = 2000

const formLine = (g) => `- 이 지식의 갈래(갈래 장부): ${(g.forms || []).map((f) => `${f.folder ? f.folder + '/' : ''}${f.name}(${f.kind}${f.aliases?.length ? ' · ' + f.aliases.join(', ') : ''})`).join(' · ') || '없음'}. 다른 이름에 걸리는 글은 그 갈래 문서로 간다(newDoc.path 는 폴더/갈래 이름).${g.formsOwn ? ' 갈래 장부에 없는 새 문서는 세우지 않는다: 이어지는 후보 문서에 넣는다.' : ''}`
const srcHead = (g) => (g.type === 'commit' ? `넣을 것(커밋 · ${g.src?.title || ''}):` : `넣을 것(파일 · ${g.src?.file || g.src?.title || ''}):`)

// 들이기 프롬프트 — g: 서버 재료(/api/k/:kn/worker/intake) { type, src: { title, author, date, file?, md, commit? }, docs, forms, formsOwn, names, kinds } ·
//   writeRules — 작성기준 3 ~ 5절 줄임(core/writerules.js · 일꾼이 싣는다)
export function intakePromptOf(g, { writeRules = '' } = {}) {
  const commit = g.type === 'commit'
  return [
    '넣을 것을 지식에 들인다. 기록 하나(record)와 항목 글(updates · newDoc)을 한 번에 짓는다. kmd 가 검사해 넘은 조각은 그 순간 문서에 들어가고, 못 넘은 조각은 「넣지 못함」 으로 남는다.',
    [
      '기록(record):',
      '- title 은 「무엇: 어떻게」 한 줄(예: 「헬스 체크 시간 초과: 3초 → 5초」). 파일 이름 · 커밋 해시를 제목으로 쓰지 않는다.',
      '- body 는 한두 문장 요약 · changes 는 바뀐 것을 「무엇: 옛 값 → 새 값」(새로 생긴 것은 「무엇: 값」) 으로. 값(수 · 이름 · 코드)은 넣을 것 그대로.',
    ].join('\n'),
    [
      '자리 고르기:',
      '- 이어지는 후보 문서의 항목이 있으면 그 항목을 고친다(updates). 있는 항목은 조각(edits: find 는 지금 글에 꼭 한 번 나오는 글 · replace 는 바꿀 글)으로 보내고 base 는 후보에 적힌 그 항목의 base 를 그대로 싣는다. 항목 글이 절반 넘게 바뀌면 content(새 글 전체).',
      '- 후보 문서에 없는 머리면 그 문서에 새 항목(content). 이어지는 문서가 없으면 새 문서(newDoc: 경로와 ## 항목들)를 세운다. 새 문서는 ## 항목 하나 이상으로만 세운다.',
      '- 문서 이름은 파일 이름이 아니라 그 글의 갈래 · 주제로 짓는다. 날짜 · 번호 · 판 · 회사 약어 같은 파일 이름 조각은 문서 이름에 쓰지 않는다.',
      '- 같은 갈래의 문서가 후보에 있으면 새 문서를 세우지 않고 그 문서에 새 항목으로 넣는다. 항목 머리는 「언제 · 무엇」(예: 2026-10-21 HNC 통화).',
      formLine(g),
      '- 새로 세운 항목은 names 에 대상 이름과 종류를 싣는다(종류는 아래 이름 종류 중 하나). 이미 이름 장부에 있는 이름은 싣지 않는다.',
      ...(commit ? ['- 커밋은 「바뀐 값」 줄과 차이를 본다. 글에 옛 값이 있으면 새 값으로 고치고, 코드에 없는 설명은 지어내지 않는다. 문서와 상관없는 커밋이면 updates 를 비우고 why 에 까닭을 쓴다.'] : []),
      '- 파일을 통째로 옮기지 않는다. 대상의 지금으로 요약 · 정리해 쓴다. 인사말 · 말할 거리 · 빈 칸 양식 · 준비 체크 상태는 옮기지 않는다(기록에 남는다). 값을 담은 표 · 목록은 그 사실을 그대로 살린다.',
    ].join('\n'),
    writeRules,
    '옮기는 값(수 · 이름 · 코드)은 넣을 것 그대로 정확히 쓰고, 넣을 것에 없는 값을 지어내지 않는다. 옛 글의 값은 넣을 것이 바꾼 것만 바꾼다. JSON 으로만 답한다.',
    `이름 종류: ${(g.kinds || []).join(' · ') || '없음'}${g.names?.length ? `\n이름 장부(앞 ${g.names.length}): ${g.names.join(' · ')}` : ''}`,
    `문서 후보:\n${(g.docs || []).map((d) => `[doc ${d.doc}] ${d.title}\n${d.sections.map((s) => `## ${s.h}\n(base ${s.base})\n${s.body}`).join('\n')}`).join('\n\n') || '(없음)'}`,
    `${srcHead(g)}\n${String(g.src?.md || '').slice(0, INTAKE_SRC_MAX)}`,
  ].filter(Boolean).join('\n\n')
}
// 고쳐 쓰기 — 지난 초안과 kmd 검사의 까닭을 붙인다(S-D20 · 같은 호출 묶음 안에서 두 번까지)
export function intakeFixPromptOf(g, draft, why, opt = {}) {
  return [intakePromptOf(g, opt), `지난 초안이 kmd 검사에 걸렸다: ${String(why || '').slice(0, 300)}\n걸린 까닭만 고쳐 다시 짓는다. 넣을 것에 없는 값은 빼고, 넣을 것의 값은 그대로 옮긴다.\n지난 초안:\n${JSON.stringify(draft ?? null).slice(0, 20_000)}`].join('\n\n')
}

// 원천 태그 — 같은 저장 막기(sameKey)가 본다 · 파일은 ingest/<경로> + md/<지문> · 커밋은 예약 태그 code-change(저장 문이 붙인다)
export const intakeTags = (src) => (src?.type === 'file' && src.rel ? [`ingest/${src.rel}`.slice(0, 60), ...(/^[0-9a-f]{16}$/.test(src.sha || '') ? [`md/${src.sha}`] : [])] : [])
// 원천 글을 기록에 싣는 칸 — 줄마다 「> 」(원천 속 「## 넣은 것」 같은 머리가 kmd 칸으로 읽히지 않게)
export const quoteSrc = (md, max) => String(md || '').slice(0, max).replace(/\r/g, '').split('\n').map((l) => `> ${l}`).join('\n')
const srcLine = (src, md) => `- ${src?.type === 'commit' ? `커밋 ${src.commit || ''}${src.src ? ` · ${src.src}` : ''}` : `파일 ${src?.rel || src?.file || src?.title || ''}`} · 지문 ${sha16(String(md || ''))}`
// 넣지 못함으로 끝난 들이기의 기록 — 원천 앞 2000자와 지문만(S-D50)
export function heldRecord(src, md, { why = '' } = {}) {
  // 정정(S9) — 들고 있던 정정 기록 초안 그대로(원천 글이 아니다) · 까닭은 넣지 못함 칸에
  if (src?.type === 'fix') {
    return {
      title: String(src.title || '정정').replace(/\s+/g, ' ').trim().slice(0, 200),
      body: String(md || '').slice(0, 20_000) || '정정',
      ...(Array.isArray(src.touches) && src.touches.length ? { touches: src.touches } : { touchesEmpty: '정정: 원래 기록에 걸린 이름이 없다' }),
      ...(src.rec ? { fixes: [src.rec] } : {}),
    }
  }
  const title = String(src?.title || '넣을 것').replace(/\s+/g, ' ').trim().slice(0, 180)
  return {
    title: `${title}: 들이지 못함`.slice(0, 200),
    body: [`${src?.type === 'commit' ? '커밋' : '파일'} 하나를 문서에 들이지 못했다${why ? `: ${String(why).replace(/\s+/g, ' ').slice(0, 200)}` : ''}.`, `## 원천\n${srcLine(src, md)}\n\n${quoteSrc(md, HELD_SRC_HEAD)}`].join('\n\n'),
    tags: intakeTags(src),
    ...(Array.isArray(src?.touches) && src.touches.length ? { touches: src.touches } : {}),
    ...(src?.rec ? { fixes: [src.rec] } : {}),
  }
}

// 초안 → 저장 덩이(hub.save 의 input) — { ok: true, input, held, warn } | { ok: false, why }(고쳐 쓸 수 있는 까닭 · 모양)
//   g — 서버 재료(후보 문서의 base 는 일꾼에게 보인 것) · k — 지금 지식(값 근거는 그 항목의 지금 글 전체) · draft — INTAKE_SCHEMA 꼴
//   후보 밖 문서 · 없는 머리에 조각 → 그 조각만 넣지 못함(notfound) · 새 문서에 ## 항목이 없다 → 넣지 못함(nosec · S-D31)
//   넣을 곳이 하나도 없다 → 넣지 못함(notfound) — 기록만 남은 들이기가 「개편 전 기록」 으로 정리에 집히지 않게
export function draftToSave(k, g, draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return { ok: false, why: '초안 모양이 아니다' }
  const rec = draft.record
  if (!rec || typeof rec !== 'object' || typeof rec.title !== 'string' || !rec.title.trim()) return { ok: false, why: '초안 모양이 아니다: 기록 제목이 없다' }
  const ups = Array.isArray(draft.updates) ? draft.updates : null
  if (!ups) return { ok: false, why: '초안 모양이 아니다: updates 가 없다' }
  const nd = draft.newDoc && typeof draft.newDoc === 'object' ? draft.newDoc : null
  const src = g.src || {}
  const held = []
  const warn = []
  const sections = []
  const texts = [] // 값 근거를 볼 새 글(조각은 replace · 새 글은 content)
  const olds = [] // 그 항목의 지금 글
  const one = (h) => typeof h === 'string' && h.trim() && !/[\r\n]/.test(h) && h.length <= 120
  const cand = (doc) => (g.docs || []).find((d) => d.doc === docRel(doc))
  const nowSec = (doc, h) => k.byDocPath?.get(doc)?.sections.find((x) => x.h === h) || null
  for (const u of ups) {
    if (!u || typeof u !== 'object' || typeof u.doc !== 'string' || !one(u.heading)) return { ok: false, why: '초안 모양이 아니다: updates 의 doc · heading' }
    const heading = u.heading.trim()
    const c = cand(u.doc)
    const edits = Array.isArray(u.edits) && u.edits.length ? u.edits : null
    if (!c) {
      held.push({ doc: docRel(u.doc), heading, code: 'notfound', why: '후보 밖의 문서를 고쳤다: 넣을 곳을 지식관리자가 고른다', ...(edits ? { edits } : {}), ...(typeof u.content === 'string' ? { content: u.content } : {}) })
      continue
    }
    const s = c.sections.find((x) => x.h === heading)
    const cur = nowSec(c.doc, heading)
    if (edits) {
      const v = validEdits(edits)
      if (!v.ok) return { ok: false, why: `조각이 지금 글에 맞지 않는다: ${v.why}` }
      if (!s) {
        held.push({ doc: c.doc, heading, code: 'notfound', why: '없는 항목에 조각을 댔다: 새 항목이면 content 로', edits })
        continue
      }
      sections.push({ doc: c.doc, heading, base: s.base, edits: edits.map((e) => ({ find: String(e.find), replace: String(e.replace) })) })
      texts.push(...edits.map((e) => String(e.replace)))
      olds.push(cur ? cur.body : '')
      continue
    }
    if (typeof u.content !== 'string') return { ok: false, why: '초안 모양이 아니다: updates 에 edits 나 content 가 없다' }
    sections.push({ doc: c.doc, heading, ...(s ? { base: s.base } : {}), content: u.content })
    texts.push(u.content)
    olds.push(cur ? cur.body : '')
  }
  if (nd) {
    const p = String(nd.path || '').replace(/\\/g, '/').replace(/^docs\/|\.md$/g, '').trim()
    if (!p || p.split('/').some((x) => !x.trim() || x === '.' || x === '..' || x.length > 80) || /[<>:"|?*\u0000-\u001f]/.test(p)) return { ok: false, why: '새 문서 경로가 아니다' }
    const rel = docRel(p)
    const secs = Array.isArray(nd.sections) ? nd.sections : []
    const c = cand(p)
    if (!secs.length) held.push({ doc: rel, code: 'nosec', why: '새 문서는 ## 항목으로 세운다' })
    else if (k.byDocPath?.get(rel) && !c) held.push({ doc: rel, code: 'notfound', why: '이미 있는 문서다(후보 밖): 넣을 곳을 지식관리자가 고른다' })
    else {
      for (const s of secs) {
        if (!s || !one(s.heading) || typeof s.content !== 'string') return { ok: false, why: '초안 모양이 아니다: newDoc 의 항목' }
        const h = s.heading.trim()
        const have = nowSec(rel, h)
        const seen = c?.sections.find((x) => x.h === h)
        if (have && !seen) { held.push({ doc: rel, heading: h, code: 'notfound', why: '이미 있는 항목이다(후보 밖): 넣을 곳을 지식관리자가 고른다', content: s.content }); continue }
        sections.push({ doc: rel, heading: h, ...(seen ? { base: seen.base } : {}), content: s.content })
        texts.push(s.content)
        olds.push(have ? have.body : '')
      }
    }
  }
  // 지어낸 값(넣을 것 · 지금 글에 없는 값) — 기록과 글 모두(기록에만 지어 넣으면 항목 검사가 그것을 근거로 본다)
  const changes = (Array.isArray(rec.changes) ? rec.changes : []).map((x) => String(x ?? '').replace(/^\s*[-*]\s+/, '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 40)
  const summary = String(rec.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
  const srcText = `${src.md || ''} ${src.title || ''} ${src.file || src.rel || ''}`
  const srcV = valuesOf(srcText)
  const oldText = olds.join('\n') + '\n' + (g.docs || []).flatMap((d) => d.sections.map((s) => s.body)).join('\n')
  const oldV = valuesOf(oldText)
  const grounded = groundedIn(srcText + ' ' + oldText, srcV, oldV)
  const said = valuesOf([rec.title, summary, ...changes, ...texts].join('\n'))
  const invented = [...said].filter((v) => !srcV.has(v) && !oldV.has(v) && !grounded(v))
  if (invented.length) return { ok: false, why: `근거에 없는 값이 있다: ${invented.slice(0, 3).join(' · ')}` }
  // 넣을 곳 — 하나도 없으면 넣지 못함(기록만)
  if (!sections.length && !held.length) held.push({ code: 'notfound', why: `넣을 곳을 고르지 않았다${draft.why ? `: ${String(draft.why).replace(/\s+/g, ' ').slice(0, 160)}` : ''}` })
  // 세울 이름(K14-2) — 이름 종류 안의 것만 · 장부에 있는 이름은 뺀다 · 새 항목을 세우는데 이름이 없으면 경고(S-D32)
  const kinds = new Set(g.kinds || [])
  const kindOf = (x) => (kinds.has(String(x || '')) ? String(x) : kinds.has('term') ? 'term' : [...kinds][0] || 'term')
  const names = (Array.isArray(draft.names) ? draft.names : [])
    .filter((n) => n && typeof n.name === 'string' && n.name.trim() && !/[\r\n`:]/.test(n.name) && n.name.length <= 80)
    .map((n) => ({ coord: `${kindOf(n.kind)}:${n.name.trim()}`, label: n.name.trim() }))
    .filter((n) => !k.vocab?.coords?.has(n.coord))
    .slice(0, 20)
  if (sections.some((s) => s.base == null) && !names.length) warn.push('names-missing')
  const title = rec.title.replace(/\s+/g, ' ').trim().slice(0, 200)
  const body = [summary, changes.length ? `## 바뀐 것\n${changes.map((x) => `- ${x}`).join('\n')}` : '', `## 원천\n${srcLine(src, src.md)}\n\n${quoteSrc(src.md, INTAKE_SRC_MAX)}`].filter(Boolean).join('\n\n')
  const record = { title, body, tags: intakeTags(src), ...(Array.isArray(src.touches) && src.touches.length ? { touches: src.touches } : {}), ...(src.rec ? { fixes: [src.rec] } : {}) }
  return { ok: true, input: { record, sections, ...(names.length ? { names } : {}) }, held, warn }
}
