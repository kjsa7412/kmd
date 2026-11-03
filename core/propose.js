// 제안 — 기록할 때 쓴 항목 조각(docs/kmd_권한_모델.md 7절 · docs/kmd_문서_작성기준.md 7절)
//
//   글을 바꾼 세션이 문맥을 다 가진 그때 「바꿀 조각(find → replace) + 항목 지문(base)」 을 기록과 함께 보낸다.
//   서버는 Claude 없이 조각을 지금 글에 대어(core/edits.js) 새 글을 만들고, 정리와 같은 검사(core/gate.js check: 값 · 꼴 · 크기 · 지문)로 거른다.
//   조각은 지금 글에 꼭 한 번 나오는 글을 찾아 바꾼다(두 번 나오거나 없으면 그 조각은 못 댄다 · 느슨한 맞춤은 두지 않는다).
//   맞춰 볼 때는 줄 끝 빈칸 · NFC 만 고르고, 바꾸는 자리는 원문 위치 그대로.

import { sha16 } from './text.js'
import { sectionOf } from './knowledge.js'
import { valuesOf, oldValues } from './values.js'
import { check } from './gate.js'
import { applyEdits, validEdits, norm } from './edits.js'

// 조각 대는 법은 core/edits.js 로 옮겼다(S2 · propose ↔ tidy 순환 끊기) — 부르는 곳을 바꾸지 않게 다시 내보낸다
export { EDIT_MAX, EDIT_CHARS, validEdits, applyEdits } from './edits.js'

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
  // 기록이 바꿨다는 옛 값이 글에 아직 남아 있다 — 고친 범위가 모자란 것일 수 있어 알린다(거절하지 않는다: 같은 값이 다른 뜻일 수 있다)
  const remain = oldValues(record.body).filter((v) => nowV.has(v))
  const warnings = remain.length ? [`옛 값 ${remain.slice(0, 3).join(' · ')} 이 글에 아직 남아 있다`] : []
  return { ok: true, text: a.text, changed: r.changed, waits, ...(warnings.length ? { warnings } : {}), ...(r.lint ? { lint: r.lint } : {}) }
}
const sentencesOf = (t) => norm(t).split(/(?<=[.!?。])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 8)

// 기록 본문의 「## 고친 조각」 칸 — 제안을 기록과 한 파일에 둔다(백업 · 받기 · 되살림이 그대로 따라간다) ·
//   값 검사(core/values.js knowledgeParts)는 이 칸을 지식 값으로 치지 않는다 · 사람이 읽는 기록 화면에는 코드 울타리로 보인다
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
