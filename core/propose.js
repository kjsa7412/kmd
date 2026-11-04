// 제안 — 기록할 때 쓴 항목 조각(docs/kmd_권한_모델.md 7절 · docs/kmd_문서_작성기준.md 7절)
//
//   글을 바꾼 세션이 문맥을 다 가진 그때 「바꿀 조각(find → replace) + 항목 지문(base)」 을 기록과 함께 보낸다.
//   서버는 Claude 없이 조각을 지금 글에 대어(core/edits.js) 새 글을 만들고, 저장 문의 항목 검사(core/gate.js checkSection: 값 · 꼴 · 지문)로 거른다.
//   조각은 지금 글에 꼭 한 번 나오는 글을 찾아 바꾼다(두 번 나오거나 없으면 그 조각은 못 댄다 · 느슨한 맞춤은 두지 않는다).
//   맞춰 볼 때는 줄 끝 빈칸 · NFC 만 고르고, 바꾸는 자리는 원문 위치 그대로.
//   검사를 넘으면 자리와 상관없이 그 순간 넣는다(값 바꿈도 · K-D13 · S4). 확인 대기(waits)는 걷었다.

import { sha16 } from './text.js'
import { sectionOf } from './knowledge.js'
import { oldValues, valuesOf } from './values.js'
import { checkSection } from './gate.js'
import { applyEdits, validEdits } from './edits.js'
import { headingMatches } from './sections.js'

// 조각 대는 법은 core/edits.js 로 옮겼다(S2 · propose ↔ 옛 정리 모듈 순환 끊기) — 부르는 곳을 바꾸지 않게 다시 내보낸다
export { EDIT_MAX, EDIT_CHARS, validEdits, applyEdits } from './edits.js'

// 항목 자리 — 이름(coord · 이름 장부) 또는 문서 · 머리(이름이 없는 항목도 · S-D55) → { doc(docs/x.md), heading, sec } | null
export function placeOf(k, { coord, doc, heading }) {
  if (coord != null) {
    const x = sectionOf(k, String(coord).trim().normalize('NFC'))
    if (!x) return null
    return { doc: x.loc.doc, heading: x.sec?.h || x.loc.heading, sec: x.sec || null, docObj: x.doc }
  }
  const id = String(doc ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^docs\//, '').replace(/\.md$/, '').normalize('NFC')
  const d = k.docs.find((x) => x.id === id)
  if (!d) return null
  const h = String(heading ?? '').trim().normalize('NFC')
  const sec = d.sections.find((s) => s.h === h) || d.sections.find((s) => headingMatches(s.h, h)) || null
  return { doc: d.path, heading: sec ? sec.h : h, sec, docObj: d }
}

// 제안 하나를 지금 지식에 대어 검사한다 — { ok, text, why, code, changed, stale, near, warnings, lint }
//   k — 지식 · coord 또는 doc + heading — 항목 · base — 세션이 읽은 지문 · edits — 조각 · record — 함께 보낸 기록({ title, body }) ·
//   spread — 조각이 여럿(기록의 값이 항목들에 나뉜다) · legacyPend — 이 항목에 아직 안 들어간 개편 전 기록 id(섞인 자리 · legacy-mix)
export function checkProposal(k, { coord, doc, heading, base, edits, record, spread = false, legacyPend = [] }) {
  const at = placeOf(k, { coord, doc, heading })
  if (!at?.sec) return { ok: false, code: 'notfound', why: '그 항목이 아직 없다. 새 항목이면 doc · heading 과 content(새 글 전체)로 보낸다' }
  const cur = at.sec.body
  if (!base) return { ok: false, code: 'conflict', stale: true, why: '항목 지문(base)이 없다. section 이 준 base 를 같이 보낸다' }
  if (String(base) !== sha16(cur)) return { ok: false, code: 'conflict', stale: true, why: '그사이 항목이 바뀌었다. section 으로 다시 읽고 그 위에서 조각을 만든다' }
  const v = validEdits(edits)
  if (!v.ok) return { ok: false, code: 'edits', why: v.why }
  const a = applyEdits(cur, edits)
  if (!a.ok) return { ok: false, code: 'edits', why: a.why, ...(a.near ? { near: a.near } : {}) }
  const r = checkSection(k, { doc: at.doc, heading: at.heading, base, content: a.text, record, spread, legacyPend })
  if (!r.ok) return { ok: false, code: r.code, why: r.why, ...(r.stale ? { stale: true } : {}) }
  // 기록이 바꿨다는 옛 값이 글에 아직 남아 있다 — 고친 범위가 모자란 것일 수 있어 알린다(거절하지 않는다: 같은 값이 다른 뜻일 수 있다)
  const nowV = valuesOf(a.text)
  const remain = oldValues(String(record?.body || '')).filter((x) => nowV.has(x))
  const warnings = remain.length ? [`옛 값 ${remain.slice(0, 3).join(' · ')} 이 글에 아직 남아 있다`] : []
  return { ok: true, text: a.text, changed: r.changed, ...(warnings.length ? { warnings } : {}), ...(r.lint ? { lint: r.lint } : {}) }
}

// 옛 기록 본문의 「## 고친 조각」 칸 — 개편 전(S4 전) 세션 저장이 제안을 기록에 실었다. 새 입력에서는 받지 않는다(core/parts.js KMD_PART_RE) ·
//   옛 기록 읽기(정리 재료 · 기록 화면)에만 S13 까지 남는다 · 값 검사(core/values.js knowledgeParts)는 이 칸을 지식 값으로 치지 않는다
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
