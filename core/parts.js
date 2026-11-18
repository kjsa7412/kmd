// kmd 가 쓰는 기록 칸 · 판정 기록(docs/kmd_문서_작성기준.md 2-3 · docs/품질개선/KMD_개편_설계.md 2-2 · 3-1).
//
//   `## 넣은 것`     저장 문이 넣은 항목 한 줄씩(「docs/x.md › 머리: 옛 값 → 새 값」 · 「(새 항목)」) — 태그 put 이 있는 기록만 읽는다
//   `## 되돌린 항목` 되돌림 기록이 되돌린 항목 한 줄씩(「<기록 id>: docs/x.md › 머리」) — 태그 revert
//   (저장 승인 P3 · approve 모드 저장 문이 단다 · 사람 입력에는 쓰지 못한다)
//   `## 받아들인 경고` 사람이 승인한 제안서의 경고(```json``` 목록 { id, code, at, why }) — 승인 = 경고 받아들임(P-D5 · P-D27)
//   `## 값 대조`     무인 채널의 값 경고(같은 꼴 · 측정만 · P-D2 · P-D37 · P6 부터 쓴다)
//   `## 이은 항목`   글을 바꾸지 않고 이 기록을 이은 항목 한 줄씩(「docs/x.md › 머리」 · 글 그대로 · P-D12 · 기록 모음 달 항목 P-D29)
//   `## 지은 근거`   이 저장의 판단 칸(조문 번호 · 과거 결정에 대한 태도 · 까닭) 한 줄씩 — 지식 생성 하네스 H-D18 · 값 대조에 걸리지 않는다
//   `## 새로 세움`   이 저장이 새로 세운 것 한 줄씩(「문서 docs/x.md」 · 「항목 docs/x.md › 머리」 · 「이름 종류:값」 · 「갈래 이름」 · 「종류 이름」 · 「성격 문서: 성격」)
//                    (「이름」 줄은 장부에 오른 새 항목이다 · 저장 꼴이라 줄 머리는 옛 말 그대로 쓰고 읽는다 · 화면은 「새 항목(장부)」 로 보인다)
//                    점검 지표 「새로 생긴 것」(P-D27) · fresh 표지는 기록 날짜에서 FRESH_DAYS 가 지나면 저절로 떨어진다(P-D10 · Q15)
//
//   칸은 본문 끝에 붙는다. 읽을 때는 그 칸의 **마지막** 것만 본다(사람 글에 같은 머리가 있어도 위조가 되지 않게 ·
//   사람 입력의 그 머리는 core/save.js 가 E_INPUT 으로 거절한다 · S-D45). 이 모듈은 다른 kmd 모듈을 부르지 않는다.

export const PUT_PART = '넣은 것'
export const REVERTED_PART = '되돌린 항목'
// 사람 입력 본문에 쓰지 못하는 머리: kmd 가 쓰는 칸 + 「넣지 못함」 · 「고친 조각」(걷은 칸 · 기록에 kmd 칸처럼 보이지 않게 새 입력은 거절)
//   줄 끝 \r 도 같이 본다(CRLF 로 온 글이 읽을 때 \n 으로 바뀌어 칸이 되지 않게)
export const ACCEPTED_PART = '받아들인 경고'
export const VALUES_PART = '값 대조'
export const LINKED_PART = '이은 항목'
export const FRESH_PART = '새로 세움'
export const JUDGE_PART = '지은 근거'
export const KMD_PART_RE = /^## (넣은 것|넣지 못함|되돌린 항목|고친 조각|받아들인 경고|값 대조|이은 항목|새로 세움|지은 근거)[ \t\r]*$/m
// 울타리(json) 칸 — 떼기(dropPart)가 울타리 끝까지 본다
const JSON_PARTS = new Set([ACCEPTED_PART, VALUES_PART])
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
// json 칸의 울타리: 글 안 가장 긴 백틱 줄보다 하나 길게(최소 3)
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

// 칸 하나 떼기: 그 이름의 마지막 칸(머리부터 다음 「## 」 머리 앞까지 · json 칸은 울타리 끝까지)을 뺀 본문
export function dropPart(body, name) {
  const s = String(body || '')
  const at = lastHead(s, name)
  if (at < 0) return s
  let end
  if (JSON_PARTS.has(name)) {
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

// ── 저장 승인 P3 칸 ──
// 경고 칸(받아들인 경고 · 값 대조) — { id, code, at, why } 만 · 글은 한 줄 300자 · 많으면 200개까지
const WARN_KEYS = ['id', 'code', 'at', 'why']
const warnRow = (w) => Object.fromEntries(WARN_KEYS.filter((x) => w?.[x] != null).map((x) => [x, String(w[x]).replace(/\s+/g, ' ').slice(0, 300)]))
function renderWarnPart(name, rows) {
  if (!rows?.length) return ''
  const json = JSON.stringify(rows.slice(0, 200).map(warnRow), null, 1)
  const fence = fenceFor(json)
  return `## ${name}\n${fence}json\n${json}\n${fence}`
}
function parseWarnPart(body, name) {
  const s = String(body || '')
  const at = lastHead(s, name)
  if (at < 0) return []
  const m = s.slice(at).match(/^## [^\n]*\n(`{3,})json\n([\s\S]*?)\n\1[ \t]*$/m)
  if (!m) return []
  try {
    const v = JSON.parse(m[2])
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)).map(warnRow) : []
  } catch {
    return [] // 손으로 깨진 칸 — 경고가 없는 것으로
  }
}
export const renderAccepted = (rows) => renderWarnPart(ACCEPTED_PART, rows)
export const parseAccepted = (body) => parseWarnPart(body, ACCEPTED_PART)
export const renderValues = (rows) => renderWarnPart(VALUES_PART, rows)
export const parseValues = (body) => parseWarnPart(body, VALUES_PART)

// 이은 항목 — 「- docs/x.md › 머리」
export function renderLinked(rows) {
  const seen = new Set()
  const xs = (rows || []).filter((r) => r?.doc && r?.heading && !/[\r\n]/.test(r.heading) && !seen.has(itemKey(r.doc, r.heading)) && seen.add(itemKey(r.doc, r.heading)))
  return xs.length ? `## ${LINKED_PART}\n${xs.map((r) => `- ${itemKey(r.doc, r.heading)}`).join('\n')}` : ''
}
export function parseLinked(body) {
  const b = lineBlock(body, LINKED_PART)
  if (b == null) return []
  return b.split('\n').map((l) => l.match(/^- (docs\/.+?\.md) › (.+)$/)).filter(Boolean).map((m) => ({ doc: m[1], heading: m[2].trim() }))
}

// 새로 세움 — 「- 문서 docs/x.md」 · 「- 항목 docs/x.md › 머리」 · 「- 이름 종류:값」 · 「- 갈래 이름」 · 「- 종류 이름」
//   kind 「항목」 = 문서에 새로 선 `##` 머리 · kind 「이름」 = 장부에 새로 오른 `종류:값`(둘 다 새 항목이다 · 저장 꼴은 바꾸지 않는다)
export const FRESH_DAYS = 14
const FRESH_KINDS = ['문서', '항목', '이름', '갈래', '종류', '성격']
// 보이는 말 — 줄 머리(저장 꼴)는 그대로 두고 화면 · 지표에는 새 말로
//   「성격」 = 문서 성격 줄(「문서: 성격」): 지식 생성 하네스 H2(엮기가 짓는다)
export const FRESH_LABEL = Object.freeze({ 문서: '문서', 항목: '항목(문서)', 이름: '항목(장부)', 갈래: '갈래', 종류: '종류', 성격: '문서 성격' })
// 지은 근거(지식 생성 하네스 H-D18) — 판단 칸을 한 줄씩: 「<한 일> <자리>: <조문 번호> · <판례 열쇠> <태도>(<다른 것이나 어긋난 조문> · <까닭>)」 · 판례가 없으면 「판례 없음」.
//   엮기(core/weave.js inputFromItems)가 지은 줄만 싣는다 · 사람 입력의 같은 머리는 거절한다(KMD_PART_RE)
export function renderJudge(lines) {
  const xs = (Array.isArray(lines) ? lines : []).map((x) => String(x || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 600)).filter(Boolean).slice(0, 120)
  return xs.length ? `## ${JUDGE_PART}\n${xs.map((x) => `- ${x}`).join('\n')}` : ''
}
export function renderFresh(rows) {
  const xs = (rows || []).filter((r) => FRESH_KINDS.includes(r?.kind) && r.name && !/[\r\n]/.test(String(r.name)))
  return xs.length ? `## ${FRESH_PART}\n${xs.map((r) => `- ${r.kind} ${r.name}`).join('\n')}` : ''
}
export function parseFresh(body) {
  const b = lineBlock(body, FRESH_PART)
  if (b == null) return []
  return b.split('\n').map((l) => l.match(/^- (문서|항목|이름|갈래|종류) (.+)$/)).filter(Boolean).map((m) => ({ kind: m[1], name: m[2].trim() }))
}
// fresh 표지 — 최근 days 안에 선 기록이 새로 세운 것(그 뒤 저절로 떨어진다 · 지식관리자의 조치를 기다리지 않는다)
//   works — [{ id, date('YYYY-MM-DD HH:MM'), author, body }] → [{ kind, name, rec, date, author }]
export function freshItems(works, { now = new Date(), days = FRESH_DAYS } = {}) {
  const pad = (n) => String(n).padStart(2, '0')
  const d = new Date(now.getTime() - days * 86_400_000)
  const cut = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  const out = []
  for (const w of works || []) {
    if (!w?.date || String(w.date).padEnd(16, ' ') < cut || !String(w.body || '').includes(`## ${FRESH_PART}`)) continue
    for (const x of parseFresh(w.body)) out.push({ ...x, rec: w.id, date: w.date, author: w.author })
  }
  return out
}
