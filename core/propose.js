// 제안 — 기록할 때 쓴 항목 조각(docs/kmd_권한_모델.md 7절 · docs/kmd_문서_작성기준.md 7절)
//
//   글을 바꾼 세션이 문맥을 다 가진 그때 「바꿀 조각(find → replace) + 항목 지문(base)」 을 기록과 함께 보낸다.
//   서버는 Claude 없이 조각을 지금 글에 대어(core/edits.js) 새 글을 만들고, 저장 문의 항목 검사(core/gate.js checkSection: 값 · 꼴 · 지문)로 거른다.
//   조각은 지금 글에 꼭 한 번 나오는 글을 찾아 바꾼다(두 번 나오거나 없으면 그 조각은 못 댄다 · 느슨한 맞춤은 두지 않는다).
//   맞춰 볼 때는 줄 끝 빈칸 · NFC 만 고르고, 바꾸는 자리는 원문 위치 그대로.
//   검사를 넘으면 자리와 상관없이 그 순간 넣는다(값 바꿈도 · K-D13 · S4). 확인 대기(waits)는 걷었다.

import { sha16 } from './text.js'
import { sectionOf } from './knowledge.js'
import { oldValues, valuesOf, judgeId } from './values.js'
import { judgeSection, foldJudge } from './gate.js'
import { judgeEdits, validEdits } from './edits.js'
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

// 제안 하나의 판정(저장 승인 설계 P1) — 쓰지 않고 오류 · 경고를 나눠 낸다
//   → { text?(조각을 다 댄 새 글), at?(항목 자리), errors: [{ id, code(notfound · conflict · edits · legacy-mix · format · machine), why, stale?, near?, at? }],
//       warnings: [{ id, code(missing · invented · lost · remain), doc, heading, values, why }], changed, lint }
//   remain(기록이 바꿨다는 옛 값이 글에 아직 남음)은 held 모드에서도 막지 않는 알림이다. 다른 값 경고는 held 모드에서 「못 넘음」(checkProposal)
export function judgeProposal(k, { coord, doc, heading, base, edits, record, spread = false, legacyPend = [] }) {
  const at = placeOf(k, { coord, doc, heading })
  const where = at ? [at.doc, at.heading] : [doc ?? coord ?? '', heading ?? '']
  const fail = (code, why, extra = {}) => ({ errors: [{ id: judgeId(code, ...where, why), code, why, ...extra }], warnings: [], changed: [] })
  if (!at?.sec) return fail('notfound', '그 항목이 아직 없다. 새 항목이면 doc · heading 과 content(새 글 전체)로 보낸다')
  const cur = at.sec.body
  if (!base) return { ...fail('conflict', '항목 지문(base)이 없다. section 이 준 base 를 같이 보낸다', { stale: true }), at }
  if (String(base) !== sha16(cur)) return { ...fail('conflict', '그사이 항목이 바뀌었다. section 으로 다시 읽고 그 위에서 조각을 만든다', { stale: true }), at }
  const e = judgeEdits(cur, edits)
  if (e.errors.length) return { errors: e.errors.map((x) => ({ id: judgeId('edits', ...where, x.why), ...x })), warnings: [], changed: [], at }
  const j = judgeSection(k, { doc: at.doc, heading: at.heading, base, content: e.text, record, spread, legacyPend })
  // 기록이 바꿨다는 옛 값이 글에 아직 남아 있다 — 고친 범위가 모자란 것일 수 있어 알린다(같은 값이 다른 뜻일 수 있다)
  const nowV = valuesOf(e.text)
  const remain = oldValues(String(record?.body || '')).filter((x) => nowV.has(x))
  const warnings = [...j.warnings]
  if (remain.length) warnings.push({ id: judgeId('remain', at.doc, at.heading, ...[...remain].sort()), code: 'remain', doc: at.doc, heading: at.heading, values: remain, why: `옛 값 ${remain.slice(0, 3).join(' · ')} 이 글에 아직 남아 있다` })
  return { text: e.text, at, errors: j.errors, warnings, changed: j.changed, ...(j.lint ? { lint: j.lint } : {}) }
}

// 제안 하나를 지금 지식에 대어 검사한다 — { ok, text, why, code, changed, stale, near, warnings, lint }
//   k — 지식 · coord 또는 doc + heading — 항목 · base — 세션이 읽은 지문 · edits — 조각 · record — 함께 보낸 기록({ title, body }) ·
//   spread — 조각이 여럿(기록의 값이 항목들에 나뉜다) · legacyPend — 이 항목에 아직 안 들어간 개편 전 기록 id(섞인 자리 · legacy-mix)
//   P1 부터 judgeProposal 위의 얇은 덮개(held 모드 판정 그대로: 첫 오류 · 없으면 remain 아닌 첫 값 경고가 「못 넘음」)
export function checkProposal(k, input) {
  const j = judgeProposal(k, input)
  const e = j.errors[0]
  if (e) return { ok: false, code: e.code, why: e.why, ...(e.stale ? { stale: true } : {}), ...(e.code === 'edits' && e.near ? { near: e.near } : {}) }
  const f = foldJudge(j, { pass: (w) => w.code === 'remain' })
  if (f) return f
  const warnings = j.warnings.filter((w) => w.code === 'remain').map((w) => w.why)
  return { ok: true, text: j.text, changed: j.changed, ...(warnings.length ? { warnings } : {}), ...(j.lint ? { lint: j.lint } : {}) }
}

// 옛 기록 본문의 「## 고친 조각」 칸 — 개편 전(S4 전) 세션 저장이 제안을 기록에 실었다. 새 입력에서는 받지 않는다(core/parts.js KMD_PART_RE) ·
//   옛 기록 읽기만 남는다(쓰기는 S13 에 걷었다) · 값 검사(core/values.js knowledgeParts)는 이 칸을 지식 값으로 치지 않는다
export const PROPOSAL_PART = '고친 조각'
export function parseProposals(body) {
  const m = String(body || '').match(new RegExp(`^## ${PROPOSAL_PART}\\s*\\n\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``, 'm'))
  if (!m) return []
  try {
    const v = JSON.parse(m[1])
    return Array.isArray(v) ? v.filter((p) => p && typeof p === 'object' && !Array.isArray(p) && typeof p.coord === 'string' && typeof p.base === 'string' && validEdits(p.edits).ok) : []
  } catch { return [] }
}
