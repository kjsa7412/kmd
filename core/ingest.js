// 들이기 — 넣은 파일(기록)을 지식 문서에 들일 때 쓰는 것: 후보 문서 · 갈래 장부 · 파일 이름의 갈래 · 주제 · 일 줄 자리 열쇠.
//
//   docs/품질개선/KMD_개편_설계.md 3-1 · 3-5. S2 에서 core/tidy.js · core/curate.js 에서 옮겼다(옛 파일은 다시 내보낸다).
//   새 들이기 엔진(INTAKE_SCHEMA · 프롬프트 · draftToSave)은 S7 에 여기 더한다.

import { sha16 } from './text.js'
import { formFor, DEFAULT_FORMS } from './guard.js'

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
