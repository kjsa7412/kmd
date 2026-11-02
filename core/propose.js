// 제안 — 기록할 때 쓴 항목 조각(docs/kmd_권한_모델.md 7절 · docs/kmd_문서_작성기준.md 7절)
//
//   글을 바꾼 세션이 문맥을 다 가진 그때 「바꿀 조각(find → replace) + 항목 지문(base)」 을 기록과 함께 보낸다.
//   서버는 Claude 없이 조각을 지금 글에 대어 새 글을 만들고, 정리와 같은 검사(core/tidy.js check: 값 · 꼴 · 크기 · 지문)로 거른다.
//   조각은 지금 글에 꼭 한 번 나오는 글을 찾아 바꾼다(두 번 나오거나 없으면 그 조각은 못 댄다 · 느슨한 맞춤은 두지 않는다).
//   맞춰 볼 때는 줄 끝 빈칸 · NFC 만 고르고, 바꾸는 자리는 원문 위치 그대로.

import { sha16 } from './text.js'
import { valuesOf } from './save.js'
import { sectionOf } from './knowledge.js'
import { check } from './tidy.js'

export const EDIT_MAX = 50 // 제안 하나의 조각 수 상한
export const EDIT_CHARS = 20_000 // 조각 글 합의 상한

const nfc = (s) => String(s ?? '').normalize('NFC')
// 맞춰 볼 꼴 — 줄 끝 빈칸을 걷고 줄 바꿈을 \n 으로(원문 자리는 바꾸지 않는다: 아래 locate 가 원문에서 다시 찾는다)
const norm = (s) => nfc(s).replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n')

// 조각 모양 검사 — { ok, why }
export function validEdits(edits) {
  if (!Array.isArray(edits) || !edits.length) return { ok: false, why: '조각이 없다' }
  if (edits.length > EDIT_MAX) return { ok: false, why: `조각이 ${EDIT_MAX} 개를 넘는다` }
  let chars = 0
  for (const [i, e] of edits.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return { ok: false, why: `${i + 1}째 조각이 모양이 아니다` }
    if (typeof e.find !== 'string' || !e.find.trim()) return { ok: false, why: `${i + 1}째 조각의 find 가 비었다` }
    if (typeof e.replace !== 'string') return { ok: false, why: `${i + 1}째 조각의 replace 가 글이 아니다` }
    if (Object.keys(e).some((k) => !['find', 'replace'].includes(k))) return { ok: false, why: `${i + 1}째 조각에 모르는 칸이 있다(find · replace 만)` }
    chars += e.find.length + e.replace.length
  }
  if (chars > EDIT_CHARS) return { ok: false, why: `조각 글이 ${EDIT_CHARS} 자를 넘는다` }
  return { ok: true }
}

// 원문에서 find 의 자리 — 꼭 한 번. norm 한 글에서 찾고, 원문의 같은 자리를 돌려준다.
//   norm 은 줄마다 끝 빈칸만 걷으므로(줄 수 · 줄 안 자리는 같다) 줄 · 칸으로 되짚는다
function locate(text, find) {
  const t = norm(text), f = norm(find).replace(/^\n+|\n+$/g, '')
  if (!f) return { why: '빈 조각' }
  const first = t.indexOf(f)
  if (first < 0) return { why: '지금 글에 없다', near: nearest(t, f) }
  if (t.indexOf(f, first + 1) >= 0) return { why: '지금 글에 두 번 넘게 나온다' }
  const src = nfc(text)
  const rows = [] // 줄마다 [원문 시작, norm 시작]
  let o = 0, n = 0
  for (const m of src.split(/(\r\n|\n)/)) {
    if (m === '\n' || m === '\r\n') { o += m.length; n += 1; continue }
    rows.push([o, n])
    o += m.length
    n += m.replace(/[ \t]+$/, '').length
  }
  const at = (p) => { let r = rows[0]; for (const x of rows) { if (x[1] <= p) r = x; else break } return r[0] + (p - r[1]) }
  return { start: at(first), end: at(first + f.length) }
}
// 가장 가까운 줄 — 세션이 조각을 다시 맞출 수 있게(첫 줄의 앞 20자가 겹치는 줄)
function nearest(t, f) {
  const head = f.split('\n')[0].trim()
  const lines = t.split('\n')
  for (let n = Math.min(20, head.length); n >= 4; n--) {
    const l = lines.find((x) => x.includes(head.slice(0, n)))
    if (l) return l.trim().slice(0, 120)
  }
  return null
}

// 조각을 댄다 — { ok, text, why, at(몇째 조각) , near }. 겹치는 조각은 거절. 차례는 원문 위치 순으로 댄다
export function applyEdits(text, edits) {
  const v = validEdits(edits)
  if (!v.ok) return { ok: false, why: v.why }
  const src = nfc(text)
  const spots = []
  for (const [i, e] of edits.entries()) {
    const at = locate(src, e.find)
    if (at.why) return { ok: false, why: `${i + 1}째 조각을 댈 수 없다: ${at.why}`, at: i, ...(at.near ? { near: at.near } : {}) }
    spots.push({ ...at, i, replace: nfc(e.replace) })
  }
  spots.sort((a, b) => a.start - b.start)
  for (let n = 1; n < spots.length; n++) if (spots[n].start < spots[n - 1].end) return { ok: false, why: `${spots[n].i + 1}째 조각이 ${spots[n - 1].i + 1}째 조각과 겹친다`, at: spots[n].i }
  let out = '', pos = 0
  for (const s of spots) { out += src.slice(pos, s.start) + s.replace; pos = s.end }
  out += src.slice(pos)
  return { ok: true, text: out }
}

// 제안 하나를 지금 지식에 대어 검사한다 — { ok, text, why, changed, stale, waits }
//   k — 지식 · coord — 항목 이름 · base — 세션이 읽은 지문 · edits — 조각 · record — 함께 보낸 기록({ id, date, author, title, body })
//   검사는 정리와 같은 check(값 · 꼴 · 크기 · 그사이 바뀜)를 그대로 쓴다: 조각으로 만든 새 글이 초안이다.
//   waits — 'apply'(바로 넣는다) · 'review'(옛 값을 바꾸거나 값 없는 문장을 지웠다: 쓰기 자리는 지식관리자 확인 · 권한 모델 7절)
export function checkProposal(k, { coord, base, edits, record }) {
  const x = sectionOf(k, coord)
  if (!x?.sec) return { ok: false, why: '그 이름의 항목이 아직 없다. 기록만 남기고 정리가 자리를 고른다' }
  const cur = x.sec.body
  if (!base) return { ok: false, why: '항목 지문(base)이 없다. section 이 준 base 를 같이 보낸다' }
  if (String(base) !== sha16(cur)) return { ok: false, why: '그사이 항목이 바뀌었다. section 으로 다시 읽고 그 위에서 조각을 만든다', stale: true }
  const a = applyEdits(cur, edits)
  if (!a.ok) return { ok: false, why: a.why, ...(a.near ? { near: a.near } : {}) }
  // 섞인 자리 — 이 항목에 먼저 온 기록(제안 없음)이 아직 안 들어갔으면 결정적으로 넣지 못한다(들어가면 그 기록까지 「넣음」 으로 보이므로) ·
  //   제안은 두고 정리가 같이 넣는다(hub 가 보관 · 권한 모델 7절)
  const others = k.works.filter((w) => w.id !== record.id && (w.state === 'pend' || w.state === 'nowhere') && w.touches.includes(coord)).map((w) => w.id)
  if (others.length) return { ok: false, why: `이 항목에 먼저 온 기록 ${others.length} 이 아직 안 들어갔다. 제안은 두고 정리가 같이 넣는다`, mixed: true, others }
  const g = { kind: 'section', coord, doc: x.loc.doc, heading: x.sec.h, name: coord, content: cur, base: sha16(cur), records: [{ id: record.id, date: record.date, author: record.author, title: record.title, body: record.body }] }
  const r = check(k, g, { content: a.text, used: [record.id], left: [], drop: [] })
  if (!r.ok) return { ok: false, why: r.why, ...(r.stale ? { stale: true } : {}) }
  // 확인 대기(권한 모델 7절) — 옛 값이 빠지거나 바뀌었나 · 값 없는 문장을 지웠나(조각의 find 에 있던 문장이 replace 에서 사라짐). 값 더하기만이면 바로
  const nowV = valuesOf(a.text)
  const gone = [...valuesOf(cur)].filter((v) => !nowV.has(v))
  const dropped = edits.some((e) => sentencesOf(e.find).some((s) => !/\d|`|「|"/.test(s) && !norm(e.replace).includes(s)))
  const waits = r.changed.length || gone.length || dropped ? 'review' : 'apply'
  return { ok: true, text: a.text, changed: r.changed, waits, ...(r.lint ? { lint: r.lint } : {}) }
}
const sentencesOf = (t) => norm(t).split(/(?<=[.!?。])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 8)

// 기록 본문의 「## 고친 조각」 칸 — 제안을 기록과 한 파일에 둔다(백업 · 받기 · 되살림이 그대로 따라간다) ·
//   값 검사(core/tidy.js knowledgeParts)는 이 칸을 지식 값으로 치지 않는다 · 사람이 읽는 기록 화면에는 코드 울타리로 보인다
export const PROPOSAL_PART = '고친 조각'
export function renderProposals(list) {
  const items = (Array.isArray(list) ? list : []).map((p) => ({ coord: String(p.coord), base: String(p.base), edits: p.edits.map((e) => ({ find: e.find, replace: e.replace })), ...(p.waits ? { waits: p.waits } : {}) }))
  if (!items.length) return ''
  return `## ${PROPOSAL_PART}\n\`\`\`json\n${JSON.stringify(items, null, 1)}\n\`\`\``
}
export function parseProposals(body) {
  const m = String(body || '').match(new RegExp(`^## ${PROPOSAL_PART}\\s*\\n\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``, 'm'))
  if (!m) return []
  try {
    const v = JSON.parse(m[1])
    return Array.isArray(v) ? v.filter((p) => p && typeof p === 'object' && !Array.isArray(p) && typeof p.coord === 'string' && typeof p.base === 'string' && validEdits(p.edits).ok) : []
  } catch { return [] }
}
