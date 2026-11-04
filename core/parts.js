// kmd 가 쓰는 기록 칸 · 판정 기록(docs/kmd_문서_작성기준.md 2-3 · docs/품질개선/KMD_개편_설계.md 2-2 · 3-1).
//
//   `## 넣은 것`     저장 문이 넣은 항목 한 줄씩(「docs/x.md › 머리: 옛 값 → 새 값」 · 「(새 항목)」) — 태그 put 이 있는 기록만 읽는다
//   `## 넣지 못함`   저장 문이 넣지 못한 조각(```json``` 목록 { doc, heading, coord, code, why, base?, edits?, content? }) — 태그 held
//   `## 되돌린 항목` 되돌림 기록이 되돌린 항목 한 줄씩(「<기록 id>: docs/x.md › 머리」) — 태그 revert
//
//   칸은 본문 끝에 붙는다. 읽을 때는 그 칸의 **마지막** 것만 본다(사람 글에 같은 머리가 있어도 위조가 되지 않게 ·
//   사람 입력의 그 머리는 core/save.js 가 E_INPUT 으로 거절한다 · S-D45). 이 모듈은 다른 kmd 모듈을 부르지 않는다.

export const PUT_PART = '넣은 것'
export const HELD_PART = '넣지 못함'
export const REVERTED_PART = '되돌린 항목'
// 사람 입력 본문에 쓰지 못하는 머리 — kmd 가 쓰는 칸 + 옛 「고친 조각」(개편 전 제안 칸 · 옛 기록 읽기에만 · S4 부터 새 입력은 거절)
//   줄 끝 \r 도 같이 본다(CRLF 로 온 글이 읽을 때 \n 으로 바뀌어 칸이 되지 않게)
export const KMD_PART_RE = /^## (넣은 것|넣지 못함|되돌린 항목|고친 조각)[ \t\r]*$/m
// 넣지 못함 칸이 이보다 길면 content · edits 를 떼고 까닭만 남긴다(S-D1)
export const HELD_JSON_MAX = 40_000
const NEW_MARK = ' (새 항목)'
const EMPTY = '—'

// 항목 열쇠 — 「docs/x.md › 머리」(k.revertedItems 의 값 · 넣은 것 줄과 같은 꼴)
export const itemKey = (doc, heading) => `${doc} › ${heading}`

const headRe = (name) => new RegExp(`^## ${name}[ \\t]*$`, 'gm')
// 그 칸의 마지막 머리 자리(줄 시작) · 없으면 -1
function lastHead(body, name) {
  let at = -1
  for (const m of String(body || '').matchAll(headRe(name))) at = m.index
  return at
}
// 머리 다음 줄부터 다음 「## 」 머리 앞까지(줄 칸 — 넣은 것 · 되돌린 항목)
function lineBlock(body, name) {
  const s = String(body || '')
  const at = lastHead(s, name)
  if (at < 0) return null
  const rest = s.slice(s.indexOf('\n', at) < 0 ? s.length : s.indexOf('\n', at) + 1)
  const end = rest.search(/^## /m)
  return end < 0 ? rest : rest.slice(0, end)
}
// 넣지 못함 칸의 울타리 — 글 안 가장 긴 백틱 줄보다 하나 길게(최소 3)
const fenceFor = (text) => '`'.repeat(Math.max(3, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length + 1)))

export function renderPut(rows) {
  if (!rows?.length) return ''
  const line = (r) => {
    const diff = !r.isNew && (r.from || r.to) ? `: ${r.from || EMPTY} → ${r.to || EMPTY}` : ''
    return `- ${itemKey(r.doc, r.heading)}${diff}${r.isNew ? NEW_MARK : ''}`
  }
  return `## ${PUT_PART}\n${rows.map(line).join('\n')}`
}
export function parsePut(body) {
  const b = lineBlock(body, PUT_PART)
  if (b == null) return []
  const out = []
  for (const l of b.split('\n')) {
    const m = l.match(/^- (docs\/.+?\.md) › (.+)$/)
    if (!m) continue
    let rest = m[2]
    const isNew = rest.endsWith(NEW_MARK)
    if (isNew) rest = rest.slice(0, -NEW_MARK.length)
    let heading = rest
    let from = ''
    let to = ''
    const arrow = isNew ? -1 : rest.lastIndexOf(' → ')
    const colon = arrow < 0 ? -1 : rest.lastIndexOf(': ', arrow)
    if (colon > 0) {
      heading = rest.slice(0, colon)
      from = rest.slice(colon + 2, arrow)
      to = rest.slice(arrow + 3)
      if (from === EMPTY) from = ''
      if (to === EMPTY) to = ''
    }
    out.push({ doc: m[1], heading, from, to, isNew })
  }
  return out
}

// 넣지 못함 줄 — 정해진 칸만 · 길면(또는 slim) content · edits 를 뗀다
const HELD_KEYS = ['doc', 'heading', 'coord', 'code', 'why', 'base']
const slimRow = (r) => Object.fromEntries(HELD_KEYS.filter((x) => r[x] != null).map((x) => [x, r[x]]))
const fullRow = (r) => ({ ...slimRow(r), ...(Array.isArray(r.edits) ? { edits: r.edits } : {}), ...(typeof r.content === 'string' ? { content: r.content } : {}) })
export function renderHeld(rows, { slim = false } = {}) {
  if (!rows?.length) return ''
  let json = JSON.stringify(rows.map(slim ? slimRow : fullRow), null, 1)
  if (!slim && json.length > HELD_JSON_MAX) json = JSON.stringify(rows.map(slimRow), null, 1)
  const fence = fenceFor(json)
  return `## ${HELD_PART}\n${fence}json\n${json}\n${fence}`
}
export function parseHeld(body) {
  const s = String(body || '')
  const at = lastHead(s, HELD_PART)
  if (at < 0) return []
  const m = s.slice(at).match(/^## [^\n]*\n(`{3,})json\n([\s\S]*?)\n\1[ \t]*$/m)
  if (!m) return []
  try {
    const v = JSON.parse(m[2])
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []
  } catch {
    return [] // 손으로 깨진 칸 — 넣지 못함 줄이 없는 것으로(까닭은 기록 본문에 그대로 보인다)
  }
}

export function renderReverted(rows) {
  if (!rows?.length) return ''
  return `## ${REVERTED_PART}\n${rows.map((r) => `- ${r.rec}: ${itemKey(r.doc, r.heading)}`).join('\n')}`
}
export function parseReverted(body) {
  const b = lineBlock(body, REVERTED_PART)
  if (b == null) return []
  const out = []
  for (const l of b.split('\n')) {
    const m = l.match(/^- ([^\s:]+): (docs\/.+?\.md) › (.+)$/)
    if (m) out.push({ rec: m[1], doc: m[2], heading: m[3] })
  }
  return out
}

// 칸 하나 떼기 — 그 이름의 마지막 칸(머리부터 다음 「## 」 머리 앞까지 · 넣지 못함은 울타리 끝까지)을 뺀 본문
export function dropPart(body, name) {
  const s = String(body || '')
  const at = lastHead(s, name)
  if (at < 0) return s
  let end
  if (name === HELD_PART) {
    const m = s.slice(at).match(/^## [^\n]*\n(`{3,})json\n[\s\S]*?\n\1[ \t]*$/m)
    end = m ? at + m.index + m[0].length : -1
  }
  if (end == null || end < 0) {
    const nl = s.indexOf('\n', at)
    const next = nl < 0 ? -1 : s.slice(nl + 1).search(/^## /m)
    end = next < 0 ? s.length : nl + 1 + next
  }
  return (s.slice(0, at) + s.slice(end)).replace(/\s+$/, '')
}

// 버림(S10 · S-D25) — 지식관리자가 넣지 않기로 한 넣지 못함 · 개편 전 기록의 결정 기록(태그 drop · log/ · 이력 「버림」 · 원 기록은 kept)
export function dropRecord(w, reason) {
  const short = String(w.title || w.id).split(/ — |: /)[0].slice(0, 160)
  return {
    title: `버림: ${short}`,
    body: `- ${w.id}: ${reason}`,
    tags: ['drop'],
    curates: [{ id: w.id, verdict: 'keep', rule: 'drop', reason }],
  }
}

// 세울 이름 · 세울 갈래(S-D51 · 저장 문이 기록 본문 끝에 싣는 칸 · hub saveIn 의 꼴) → { names:[{ coord, label, doc?, heading?, aliases? }], forms:[…] }
//   [이름 세우기] 가 읽는다 — 부르는 쪽이 넣지 못함 칸(code names)이 있는 기록에만 쓴다(사람 글의 같은 머리로 장부가 늘지 않게)
export function namesOfRecord(body) {
  const names = []
  for (const l of (lineBlock(body, '세울 이름') || '').split('\n')) {
    const m = l.match(/^- (.+?) \(([^()\s:]+:[^()\n]+?)\)(?: → (.+?)(?: › (.+?))?)?(?: · 다른 이름 (.+))?\s*$/)
    if (m) names.push({ coord: m[2], label: m[1], ...(m[3] ? { doc: m[3] } : {}), ...(m[4] ? { heading: m[4] } : {}), ...(m[5] ? { aliases: m[5].split(', ').filter(Boolean) } : {}) })
  }
  const forms = []
  for (const l of (lineBlock(body, '세울 갈래') || '').split('\n')) {
    if (!l.startsWith('- ')) continue
    const [name, ...rest] = l.slice(2).trim().split(' · ')
    if (!name) continue
    const f = { name }
    for (const x of rest) {
      if (x.startsWith('다른 이름 ')) f.aliases = x.slice(6).split(', ').filter(Boolean)
      else if (x.startsWith('폴더 ')) f.folder = x.slice(3)
      else if (x.startsWith('이름 ')) f.pattern = x.slice(3)
      else f.kind = x
    }
    forms.push(f)
  }
  return { names, forms }
}

export function decisionRecord(curates) {
  return {
    title: `정리: 알아서 한 것 ${curates.length}`,
    body: curates.map((c) => `- ${c.id}: ${c.reason}`).join('\n'),
    tags: ['curate-auto'],
    curates,
  }
}
