// 제안 — 기록할 때 쓴 항목 글(docs/kmd_권한_모델.md 7절 · docs/kmd_문서_작성기준.md 7절)
//
//   글을 바꾼 세션이 문맥을 다 가진 그때 「바꿀 곳(find → replace) + 항목 지문(base)」 을 기록과 함께 보낸다.
//   서버는 Claude 없이 바꿀 곳을 지금 글에 대어(core/edits.js) 새 글을 만들고, 저장 문의 항목 검사(core/gate.js checkSection: 값 · 꼴 · 지문)로 거른다.
//   바꿀 곳은 지금 글에 꼭 한 번 나오는 글을 찾아 바꾼다(두 번 나오거나 없으면 그 바꿀 곳은 못 댄다 · 느슨한 맞춤은 두지 않는다).
//   맞춰 볼 때는 줄 끝 빈칸 · NFC 만 고르고, 바꾸는 자리는 원문 위치 그대로.
//   검사를 넘으면 자리와 상관없이 그 순간 넣는다(값 바꿈도 · K-D13 · S4). 확인 대기(waits)는 걷었다.

import { sha16 } from './text.js'
import { sectionOf } from './knowledge.js'
import { oldValues, valuesOf, judgeId, judgeReflect } from './values.js'
import { judgeSection, foldJudge } from './gate.js'
import { judgeEdits, validEdits } from './edits.js'
import { headingMatches } from './sections.js'
import { createHash } from 'node:crypto'
import { guardRecord, guardNames, guardNewDoc, nearOf, nameNear, nearKey, RECORDS_DOC, RECORDS_DOC_PATH } from './guard.js'
import { mustValues } from './values.js'

// 바꿀 곳 대는 법은 core/edits.js 로 옮겼다(S2 · propose ↔ 옛 정리 모듈 순환 끊기) — 부르는 곳을 바꾸지 않게 다시 내보낸다
export { EDIT_MAX, EDIT_CHARS, validEdits, applyEdits } from './edits.js'

// 항목 자리 — 항목(coord · 항목 장부) 또는 문서 · 머리(장부에 없는 항목도 · S-D55) → { doc(docs/x.md), heading, sec } | null
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
//   → { text?(바꿀 곳을 다 댄 새 글), at?(항목 자리), errors: [{ id, code(notfound · conflict · edits · format · machine), why, stale?, near?, at? }],
//       warnings: [{ id, code(missing · invented · lost · remain), doc, heading, values, why }], changed, lint }
//   remain(기록이 바꿨다는 옛 값이 글에 아직 남음)은 held 모드에서도 막지 않는 알림이다. 다른 값 경고는 held 모드에서 「못 넘음」(checkProposal)
export function judgeProposal(k, { coord, doc, heading, base, edits, record, spread = false }) {
  const at = placeOf(k, { coord, doc, heading })
  const where = at ? [at.doc, at.heading] : [doc ?? coord ?? '', heading ?? '']
  const fail = (code, why, extra = {}) => ({ errors: [{ id: judgeId(code, ...where, why), code, why, ...extra }], warnings: [], changed: [] })
  if (!at?.sec) return fail('notfound', '그 항목이 아직 없다. 새 항목이면 doc · heading 과 content(새 글 전체)로 보낸다')
  const cur = at.sec.body
  if (!base) return { ...fail('conflict', '항목 지문(base)이 없다. section 이 준 base 를 같이 보낸다', { stale: true }), at }
  if (String(base) !== sha16(cur)) return { ...fail('conflict', '그사이 항목이 바뀌었다. section 으로 다시 읽고 그 위에서 바꿀 곳을 만든다', { stale: true }), at }
  const e = judgeEdits(cur, edits)
  if (e.errors.length) return { errors: e.errors.map((x) => ({ id: judgeId('edits', ...where, x.why), ...x })), warnings: [], changed: [], at }
  const j = judgeSection(k, { doc: at.doc, heading: at.heading, base, content: e.text, record, spread })
  // 기록이 바꿨다는 옛 값이 글에 아직 남아 있다 — 고친 범위가 모자란 것일 수 있어 알린다(같은 값이 다른 뜻일 수 있다)
  const nowV = valuesOf(e.text)
  const remain = oldValues(String(record?.body || '')).filter((x) => nowV.has(x))
  const warnings = [...j.warnings]
  if (remain.length) warnings.push({ id: judgeId('remain', at.doc, at.heading, ...[...remain].sort()), code: 'remain', doc: at.doc, heading: at.heading, values: remain, why: `옛 값 ${remain.slice(0, 3).join(' · ')} 이 글에 아직 남아 있다` })
  return { text: e.text, at, errors: j.errors, warnings, changed: j.changed, ...(j.lint ? { lint: j.lint } : {}) }
}

// 제안 하나를 지금 지식에 대어 검사한다 — { ok, text, why, code, changed, stale, near, warnings, lint }
//   k — 지식 · coord 또는 doc + heading — 항목 · base — 세션이 읽은 지문 · edits — 바꿀 곳 · record — 함께 보낸 기록({ title, body }) ·
//   spread — 고칠 항목이 여럿(기록의 값이 항목들에 나뉜다)
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

// ── 저장 제안(저장 승인 설계 P-D3 · P-D4 · P-D10 · 2-1 · P2) — 쓰지 않고, 서버가 정한 꼴의 【저장 제안】 글 · 항목 · 새로 서는 것 · 경고 · 오류 · 해시 ──
//   k — 저장 줄 안에서 새로 읽은 지식 · input — save 와 같은 꼴(record 는 서식을 엮은 뒤) + distinct · excluded · kinds
//   opt.newDoc — 새 문서를 세울 수 있나(지금은 지식관리자 · P3 부터 쓰기 자리)
//   opt.head — { name(지식 이름), viewers(보는 사람 수 · 개인 프로그램은 'me' = 「나만 · 이 PC」 · 없으면 null), path(길: 이 세션의 작업 · 화면 …) }
//   → { text, items, newDocs, newNames, newForms, newKinds, warnings[{ id, code, at, why }], errors[{ code, at, why, near? }], proposal }
//   proposal — 비밀 없는 sha256(64자 hex): 정규화한 record · sections · names · forms · kinds · excluded · distinct · 항목마다의 base ·
//   경고 id · 제안서 글(머리 줄 빼고 · 보는 사람 수 · 길이 달라도 같은 지문). 서버는 쌓지 않는다(P-D4). 오류가 있으면 null(승인할 제안이 아니다). 글에 시각을 싣지 않는다(같은 입력이면 같은 해시)
const DIFF_MAX = 30
const docName = (p) => String(p ?? '').replace(/^docs\//, '').replace(/\.md$/, '')
const atOf = (doc, heading) => `${docName(doc)} › ${heading ?? ''}`
const nf = (v) => (typeof v === 'string' ? v.normalize('NFC') : Array.isArray(v) ? v.map(nf) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((x) => v[x] !== undefined).map((x) => [x, nf(v[x])])) : v)

// 줄 차이 — 바뀐 줄만(- 옛 줄 · + 새 줄) · 차례는 LCS · 크면 집합으로
export function lineDiff(a, b) {
  const A = String(a ?? '').split('\n')
  const B = String(b ?? '').split('\n')
  const out = []
  if (A.length * B.length > 250_000) {
    const sa = new Set(A)
    const sb = new Set(B)
    for (const x of A) if (!sb.has(x)) out.push(['-', x])
    for (const x of B) if (!sa.has(x)) out.push(['+', x])
    return out
  }
  const T = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1))
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) T[i][j] = A[i] === B[j] ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1])
  let i = 0
  let j = 0
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { i++; j++ } else if (T[i + 1][j] >= T[i][j + 1]) out.push(['-', A[i++]])
    else out.push(['+', B[j++]])
  }
  while (i < A.length) out.push(['-', A[i++]])
  while (j < B.length) out.push(['+', B[j++]])
  return out
}

// 기록 글 → 칸(요약 · ## 칸) — 제안서 【기록】 줄
const SHOWN_PARTS = ['바뀐 것', '까닭', '버린 안', '영향', '근거']
function recordParts(body) {
  const b = String(body ?? '')
  const i = b.search(/^## /m)
  const summary = (i < 0 ? b : b.slice(0, i)).trim()
  const parts = []
  for (const blk of (i < 0 ? '' : b.slice(i)).split(/^(?=## )/m)) {
    const m = blk.match(/^## (.+)\n?([\s\S]*)$/)
    if (!m || !SHOWN_PARTS.includes(m[1].trim())) continue
    parts.push([m[1].trim(), m[2].split('\n').map((x) => x.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean)])
  }
  return { summary, parts }
}

export function proposalHash(x) {
  return createHash('sha256').update(JSON.stringify(nf(x)), 'utf8').digest('hex')
}

//   approve 모드(P3 · opt.approve) — 저장 문이 줄 안에서 같은 판정을 다시 돌려 해시를 대 본다(hub saveIn):
//     memo 는 입력 오류(core/save.js check · P-D34) · 「바뀐 것」 값이 이은 항목 글에 없으면 오류(본문 반영 judgeReflect · P-D12 · watched 는 넘음) ·
//     항목 글도 건드린 항목도 없고 touchesEmpty 까닭이 있으면 기록 모음 달 항목(opt.month 'YYYY-MM')에 잇는다(P-D29) ·
//     되돌림 잦은 문서(opt.reverts(doc) ≥ 2)의 값 바꿈은 경고(reverts) · 새 문서 갈래는 같은 제안의 forms 까지 본다(P-D9)
//   → 더해 linked([{ doc, heading }] 글 그대로 이은 항목) · fresh([{ kind, name }] 새로 세운 것)
//   opt.curator — 지식관리자(approve 모드에서 있는 항목 · 갈래의 장부 고침을 받는다 · 「장부 고침」 줄)
//   opt.intakeDoc — 무인 채널(P6)만: 서버 고정 갈래 「들인 자료」 아래 새 문서를 연다(core/guard.js guardNewDoc)
export function buildProposal(k, input, { newDoc = false, head = {}, extraErrors = [], approve = false, reverts = null, month = null, curator = false, intakeDoc = false } = {}) {
  const rec = input.record && typeof input.record === 'object' ? input.record : {}
  const record = { title: String(rec.title || ''), body: String(rec.body || '') }
  const secs = Array.isArray(input.sections) ? input.sections : []
  // 새 문서 갈래 — 같은 제안이 세우는 갈래까지(장부가 없던 지식도 이 제안으로 장부가 선다)
  const formsIn = (Array.isArray(input.forms) ? input.forms : []).filter((f) => f && typeof f.name === 'string' && f.name.trim())
  const formsNow = approve && formsIn.length ? { own: true, rows: [...k.forms.rows, ...formsIn.filter((f) => !k.forms.rows.some((x) => x.name === f.name.trim().normalize('NFC'))).map((f) => ({ name: f.name.trim().normalize('NFC'), aliases: Array.isArray(f.aliases) ? f.aliases : [], ...(f.folder ? { folder: String(f.folder) } : {}), ...(f.kind ? { kind: String(f.kind) } : {}), ...(f.pattern ? { pattern: String(f.pattern) } : {}), ...(f.form ? { form: String(f.form) } : {}) }))] } : k.forms
  const distinct = new Set((input.distinct || []).map((x) => nearKey(x)))
  const passes = (name) => distinct.has(nearKey(name))
  const errors = []
  const warnings = []
  const items = []
  const newDocs = []
  const newNames = []
  const newForms = []
  const newKinds = []
  const err = (code, at, why, extra = {}) => errors.push({ code, at, why, ...extra })
  const warnOf = (w) => ({ id: w.id, code: w.code, at: w.doc != null || w.heading != null ? atOf(w.doc, w.heading) : w.at || '기록', why: w.why, ...(w.values ? { values: w.values } : {}) })
  // 새것이 있는 것과 너무 비슷한가(P-D10) — 같음 = 오류(distinct 로 넘음) · 비슷함 = 경고
  const near = (what, at, name, r) => {
    if (passes(name)) return
    if (r.same.length) err('near', at, `${what} 「${name}」 는 있는 「${r.same.slice(0, 3).join(' · ')}」 와 같은 이름이다(빈칸 · 부호만 다름). 있는 것에 잇거나, 다른 것이면 distinct 에 「${name}」 를 넣는다`, { near: r.same.slice(0, 5) })
    else if (r.similar.length) warnings.push({ id: judgeId('near', what, name, ...[...r.similar].sort()), code: 'near', at, why: `${what} 「${name}」 와 비슷한 것이 있다: ${r.similar.slice(0, 3).join(' · ')}. 같은 것이면 있는 것에 잇는다` })
  }
  for (const e of extraErrors) err(e.code, e.at, e.why)
  if (!record.title.trim()) err('record', '기록', '제목(title)이 없다')
  const spread = secs.length > 1
  const done = new Set()
  const texts = []
  for (const s of secs) {
    const coord = s.coord != null ? String(s.coord).trim().normalize('NFC') : null
    const at = placeOf(k, { coord, doc: s.doc, heading: s.heading })
    // 기록 모음(P-D29) — 달 항목은 저장 문만 세우고 본문은 서버가 쓴 한 줄뿐이다(사람이 보낸 글을 받지 않는다)
    if (approve && (at ? at.doc : `docs/${String(s.doc ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^docs\//, '').replace(/\.md$/, '').normalize('NFC')}.md`) === RECORDS_DOC_PATH) { err('records', atOf(RECORDS_DOC_PATH, s.heading ?? ''), `「${RECORDS_DOC}」 은 저장 문이 달 항목을 세우는 문서다. 글을 보내지 않는다(이을 항목이 없는 기록은 touchesEmpty 까닭으로 그 달 항목에 이어진다)`); continue }
    if (!at) {
      const where = coord || atOf(s.doc, s.heading)
      if (coord) { err('notfound', where, `「${coord}」 이 들어갈 문서가 정해져 있지 않다. 기록만 보내거나 문서 · 머리로 가리킨다`); continue }
      const rel = String(s.doc ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^docs\//, '').replace(/\.md$/, '').normalize('NFC')
      const heading = String(s.heading ?? '').trim().normalize('NFC')
      if (!newDoc) { err('newdoc', where, `「${rel}」 문서가 없다. 새 문서는 지식관리자가 세운다(you.ledgers) · 있는 문서 · 머리로 가리킨다`); continue }
      if (typeof s.content !== 'string') { err('newdoc', where, '새 문서의 항목은 글 전체(content)로 보낸다'); continue }
      const g = guardNewDoc(formsNow, rel, [heading], { intake: intakeDoc })
      for (const e of g.errors) err('format', where, e.message)
      const name = rel.split('/').pop()
      const r = nearOf(k.docs.flatMap((d) => [d.id.split('/').pop(), d.title]), name)
      near('새 문서', where, name, r)
      if (!newDocs.some((d) => d.doc === `docs/${rel}.md`)) newDocs.push({ doc: `docs/${rel}.md`, form: g.form?.name || null, near: [...r.same, ...r.similar].slice(0, 5) })
      const j = judgeSection(k, { doc: `docs/${rel}.md`, heading, base: s.base, content: s.content, record, spread })
      for (const e of j.errors) err(e.code, where, e.why)
      for (const w of j.warnings) warnings.push(warnOf(w))
      items.push({ kind: '신설', ...(coord ? { coord } : {}), doc: `docs/${rel}.md`, heading, at: where, base: null, before: '', after: s.content, changed: [], newDoc: true })
      texts.push({ heading, content: s.content, coord })
      continue
    }
    const where = atOf(at.doc, at.heading)
    done.add(`${at.doc}\n${at.heading}`)
    if (!at.sec) {
      // 있는 문서에 새 머리 — 글 전체(content)로 · 같은 문서의 머리와 너무 비슷한가
      if (typeof s.content !== 'string') { err('notfound', where, '그 항목이 아직 없다. 새 항목이면 doc · heading 과 content(새 글 전체)로 보낸다'); continue }
      near('새 머리', where, at.heading, nearOf(at.docObj.sections.map((x) => x.h), at.heading))
      const j = judgeSection(k, { doc: at.doc, heading: at.heading, base: s.base, content: s.content, record, spread })
      for (const e of j.errors) err(e.code, where, e.why, e.stale ? { stale: true } : {})
      for (const w of j.warnings) warnings.push(warnOf(w))
      items.push({ kind: '신설', ...(coord ? { coord } : {}), doc: at.doc, heading: at.heading, at: where, base: null, before: '', after: s.content, changed: [] })
      texts.push({ heading: at.heading, content: s.content, coord })
      continue
    }
    const before = at.sec.body
    const j = Array.isArray(s.edits)
      ? judgeProposal(k, { coord, doc: at.doc, heading: at.heading, base: s.base, edits: s.edits, record, spread })
      : { ...judgeSection(k, { doc: at.doc, heading: at.heading, base: s.base, content: s.content, record, spread }), text: s.content }
    for (const e of j.errors) err(e.code, where, e.why, { ...(e.near ? { near: [e.near] } : {}), ...(e.stale ? { stale: true } : {}) })
    for (const w of j.warnings) warnings.push(warnOf(w))
    // 되돌림 잦은 문서(S-D11) — held 모드는 그 항목을 넣지 못함으로 · approve 모드는 경고(승인하면 받아들임)
    if (approve && reverts && j.changed?.length && !j.errors.length && reverts(at.doc) >= 2) warnings.push({ id: judgeId('reverts', at.doc, at.heading, ...j.changed.map((c) => `${c.from}>${c.to}`).sort()), code: 'reverts', at: where, why: '7일 안에 두 번 되돌린 문서의 값을 바꾼다' })
    const after = typeof j.text === 'string' ? j.text : before
    items.push({ kind: '고침', ...(coord ? { coord } : {}), doc: at.doc, heading: at.heading, at: where, base: sha16(before), before, after, changed: j.changed || [] })
    texts.push({ heading: at.heading, content: after, coord })
  }
  // 빠진 값(고칠 항목이 여럿) — 기록이 적은 새 값을 넣는 모든 글을 합친 데서 한 번(gatePrepare 와 같은 셈)
  if (spread && texts.length) {
    const all = valuesOf(texts.map((x) => `${x.heading || ''}\n${x.content}`).join('\n') + ' ' + texts.map((x) => x.coord || '').join(' '))
    const missing = mustValues(record.body).filter((v) => !all.has(v))
    if (missing.length) warnings.push({ id: judgeId('missing', '', '', ...[...missing].sort()), code: 'missing', at: '기록', why: `기록의 값이 글에 없다: ${missing.slice(0, 3).join(' · ')}`, values: missing })
  }
  // 새 항목(장부) · 새 종류(P-D10) — 장부에 없던 것만 · 모양(G1)은 guardNames
  const kinds = new Set([...k.vocab.coords.keys()].map((c) => c.slice(0, c.indexOf(':'))))
  const names = (Array.isArray(input.names) ? input.names : []).filter((n) => n && typeof n.coord === 'string')
  for (const e of guardNames(k.vocab, names).errors) err('name', e.name || '항목', e.message)
  const kindsWanted = new Map()
  // 장부에 이미 있는 항목 · 갈래를 다시 보내면 자리 · 별칭 · 갈래 줄이 바뀐다(core/namebook.js upsert) — approve 모드에서는
  //   지식관리자만 · 제안서 「장부 고침」 줄로 보인다(쓰기 자리는 새로 세우기만 · 보이지 않는 장부 고침을 막는다)
  const ledgerFix = []
  for (const n of names) {
    const c = n.coord.trim().normalize('NFC')
    if (k.vocab.coords.has(c)) {
      if (approve && !curator) err('name', c, `「${c}」 는 이미 장부에 있는 항목이다. 항목의 자리 · 별칭을 바꾸는 것은 지식관리자가 한다(새 항목만 세운다 · 그 항목을 건드리려면 touches 에 단다)`)
      else if (approve) ledgerFix.push(`  ${c}   장부 고침${n.doc ? `   자리: ${docName(n.doc)}${n.heading ? ` › ${n.heading}` : ''}` : ''}${Array.isArray(n.aliases) && n.aliases.length ? ` · 별칭 ${n.aliases.join(', ')}` : ''}`)
      continue
    }
    const r = nameNear(k.vocab, c, n.label)
    near('새 항목', c, c, r)
    newNames.push({ coord: c, label: String(n.label || ''), ...(n.doc ? { doc: String(n.doc) } : {}), ...(n.heading ? { heading: String(n.heading) } : {}), near: [...r.same, ...r.similar].slice(0, 5) })
    const t = c.slice(0, Math.max(0, c.indexOf(':')))
    if (t && !kinds.has(t)) kindsWanted.set(t, null)
  }
  for (const x of Array.isArray(input.kinds) ? input.kinds : []) {
    const t = String(typeof x === 'string' ? x : x?.name || '').trim().normalize('NFC')
    if (t && !kinds.has(t)) kindsWanted.set(t, typeof x === 'object' && x?.label ? String(x.label) : kindsWanted.get(t) ?? null)
  }
  // 종류는 그 종류의 새 항목이 같이 설 때만 선다(종류만 따로 세우는 장부가 없다)
  const usedKinds = new Set(newNames.map((n) => n.coord.slice(0, Math.max(0, n.coord.indexOf(':')))))
  for (const [t, label] of kindsWanted) {
    if (approve && !usedKinds.has(t)) { err('kind', t, `새 종류 「${t}」 를 쓰는 새 항목이 없다. 종류는 그 종류의 항목(names)과 같이 세운다`); continue }
    const r = nearOf([...kinds], t)
    near('새 종류', t, t, r)
    newKinds.push({ name: t, ...(label ? { label } : {}), near: [...r.same, ...r.similar].slice(0, 5) })
  }
  // 새 갈래(P-D9) — 갈래 장부에 같은 이름이 있으면 새것이 아니다
  const formNames = k.forms.rows.flatMap((f) => [f.name, ...(f.aliases || [])])
  for (const f of Array.isArray(input.forms) ? input.forms : []) {
    const name = String(f?.name || '').trim().normalize('NFC')
    if (!name) continue
    if (k.forms.rows.some((x) => x.name === name)) {
      if (approve && !curator) err('form', name, `「${name}」 는 이미 있는 갈래다. 갈래 줄을 바꾸는 것은 지식관리자가 한다(새 갈래만 세운다)`)
      else if (approve) ledgerFix.push(`  갈래 ${name}   장부 고침${f.folder ? ` · 폴더 ${f.folder}` : ''}${f.kind ? ` · ${f.kind}` : ''}${f.pattern ? ` · 항목 패턴 ${f.pattern}` : ''}`)
      continue
    }
    const r = nearOf(formNames, name)
    near('새 갈래', name, name, r)
    newForms.push({ name, ...(f.kind ? { kind: String(f.kind) } : {}), ...(f.folder ? { folder: String(f.folder) } : {}), near: [...r.same, ...r.similar].slice(0, 5) })
  }
  // 건드린 항목(G2 · G3 · 거절형) — 같은 제안에서 세우는 항목은 장부 밖이어도 받는다
  const g = guardRecord(k.vocab, rec, { mode: 'strict', proposed: new Set(names.map((n) => n.coord.trim().normalize('NFC'))) })
  for (const e of g.errors) err('touches', e.name || '기록', e.message, e.near?.length ? { near: e.near } : {})
  // 이을 항목(글 그대로) — 항목 글이 없는 건드린 항목
  for (const c of g.touches) {
    const x = sectionOf(k, c)
    if (!x?.loc) continue
    const h = x.sec?.h ?? x.loc.heading
    if (done.has(`${x.loc.doc}\n${h}`)) continue
    done.add(`${x.loc.doc}\n${h}`)
    const body = x.sec ? x.sec.body : null
    items.push({ kind: '잇기', coord: c, doc: x.loc.doc, heading: h, at: atOf(x.loc.doc, h), base: body == null ? null : sha16(body), before: body, after: body, changed: [], ...(x.doc?.watched ? { watched: true } : {}) })
  }
  // 이을 항목이 없는 기록(P-D29 · P-D34) — 항목 글도 건드린 항목도 없고 touchesEmpty 까닭이 있으면 기록 모음의 달 항목에 잇는다
  if (approve && !secs.length && !g.touches.length && !g.errors.length && rec.touchesEmpty && month) {
    const d = k.docs.find((x) => x.id === RECORDS_DOC)
    const sec = d?.sections.find((x) => x.h === month) || null
    items.push({ kind: '잇기', doc: RECORDS_DOC_PATH, heading: month, at: atOf(RECORDS_DOC_PATH, month), base: sec ? sha16(sec.body) : null, before: sec ? sec.body : null, after: sec ? sec.body : null, changed: [], records: true })
  }
  // 본문 반영(P-D12) — 「바뀐 것」 값이 이은 항목(고침 · 신설의 새 글 · 잇기의 지금 글) 어디에도 없으면 오류(사람 채널)
  if (approve && !errors.length) {
    const r = judgeReflect(record, items.map((x) => ({ doc: x.doc, heading: x.heading, text: x.after ?? '', watched: !!x.watched })))
    for (const e of r.errors) err('unreflected', items.length ? items.map((x) => x.at).slice(0, 2).join(' · ') : '기록', e.why)
  }
  const excluded = (Array.isArray(input.excluded) ? input.excluded : []).map((x) => ({ name: String(x.name), why: String(x.why || '') }))
  // ── 제안서 글(2-1) ──
  const L = []
  const viewers = head.viewers === 'me' ? '(보는 사람: 나만 · 이 PC)' : Number.isInteger(head.viewers) ? `(보는 사람 ${head.viewers})` : ''
  L.push(`【저장 제안】 지식: ${head.name || k.name || k.id}${viewers} · 길: ${head.path || '이 세션의 작업'}`)
  L.push(`【기록】 「${record.title}」`)
  const rp = recordParts(record.body)
  // 사람이 보낸 글은 늘 들여 싣는다(머리 줄 · 검사 줄을 흉내 내지 못하게)
  rp.summary.split('\n').map((x) => x.trim()).filter(Boolean).forEach((x, i) => L.push(`  ${(i ? '' : '요약').padEnd(8, ' ')}  ${x}`))
  for (const [h, xs] of rp.parts) xs.forEach((x, i) => L.push(`  ${(i ? '' : h).padEnd(8, ' ')}  ${x}`))
  const sect = (title, rows) => { L.push(`―― ${title} ――`); if (rows.length) L.push(...rows); else L.push('  (없음)') }
  const rowsFix = []
  for (const x of items.filter((y) => y.kind === '고침')) {
    rowsFix.push(`  ${x.at}   변경${x.changed.length ? `   ${x.changed.map((c) => `${c.from} → ${c.to}`).join(' · ')}` : ''}`)
    const d = lineDiff(x.before, x.after)
    for (const [m, t] of d.slice(0, DIFF_MAX)) rowsFix.push(`     ${m} ${t}`)
    if (d.length > DIFF_MAX) rowsFix.push(`     … 바뀐 줄 ${d.length - DIFF_MAX} 더`)
    if (!d.length) rowsFix.push('     (글 그대로)')
  }
  sect('고칠 항목', rowsFix)
  const first = (t) => { const l = String(t || '').split('\n').map((y) => y.trim()).find(Boolean) || ''; return l.length > 60 ? l.slice(0, 59) + '…' : l }
  sect('새 항목(문서)', items.filter((x) => x.kind === '신설').map((x) => `  ${x.at}   신설   ${first(x.after)}`))
  sect('새 문서', newDocs.map((d) => `  ${docName(d.doc)}   신설${d.form ? `   갈래: ${d.form}` : ''}${d.near.length ? ` · 비슷한 문서 ${d.near.join(' · ')}` : ''}`))
  sect('새 갈래 · 새 종류', [...newForms.map((f) => `  갈래 ${f.name}   신설${f.near.length ? ` · 비슷한 갈래 ${f.near.join(' · ')}` : ''}`), ...newKinds.map((t) => `  종류 ${t.name}   신설${t.near.length ? ` · 비슷한 종류 ${t.near.join(' · ')}` : ''}`)])
  sect('새 항목(장부)', [...ledgerFix, ...newNames.map((n) => `  ${n.coord}   신설   자리: ${n.doc ? `${docName(n.doc)}${n.heading ? ` › ${n.heading}` : ''}` : '없음'} · ${n.near.length ? `비슷한 항목 ${n.near.join(' · ')}` : '비슷한 항목 없음'}`)])
  sect('이을 항목(글 그대로)', items.filter((x) => x.kind === '잇기').map((x) => `  ${x.at}   잇기${x.before == null ? '   (항목이 아직 없음)' : ''}`))
  sect('뺀다', excluded.map((x) => `  ${x.name}   ${x.why || '뺌'}`))
  L.push('―― 검사 ――')
  const wl = warnings.map((w, i) => `w${i + 1}`)
  warnings.forEach((w, i) => L.push(`  경고 ${wl[i]}  ${w.at}: ${w.why}`))
  if (!warnings.length) L.push('  경고 없음')
  errors.forEach((e, i) => L.push(`  오류 e${i + 1}  ${e.at}: ${e.why}`))
  if (!errors.length) L.push('  오류 없음')
  if (errors.length) L.push('오류가 있어 이대로는 남지 않습니다. 입력을 고쳐 다시 제안합니다.')
  else if (warnings.length) L.push(`승인하시면 경고 ${wl.join(' · ')} 을 받아들이고 그대로 남깁니다. 고칠 줄이 있으면 말씀해 주세요(빼기 · 값 고치기 · 기록 범위).`)
  else L.push('승인하시면 그대로 남깁니다. 고칠 줄이 있으면 말씀해 주세요(빼기 · 값 고치기 · 기록 범위).')
  const text = L.join('\n')
  // 해시 — 머리 줄(지식 이름 · 보는 사람 수 · 길)은 빼고 싣는다: 명부가 바뀌거나 길이 달라도 같은 입력이면 같은 지문 · 집합 칸은 차례를 고른다
  const setOf = (xs, key) => [...(Array.isArray(xs) ? xs : [])].sort((a, b) => key(a).localeCompare(key(b)))
  const proposal = errors.length ? null : proposalHash({
    record: rec, sections: secs, names: input.names || [], forms: input.forms || [],
    kinds: setOf(input.kinds, (x) => String(typeof x === 'string' ? x : x?.name || '')), excluded: setOf(excluded, (x) => x.name), distinct: [...new Set((input.distinct || []).map((x) => nearKey(x)))].sort(),
    bases: items.map((x) => [x.at, x.base]), warnings: warnings.map((w) => w.id), text: L.slice(1).join('\n'),
  })
  const linked = items.filter((x) => x.kind === '잇기').map((x) => ({ doc: x.doc, heading: x.heading, ...(x.records ? { records: true, missing: x.before == null } : {}) }))
  const fresh = [
    ...newDocs.map((d) => ({ kind: '문서', name: d.doc })),
    ...items.filter((x) => x.kind === '신설').map((x) => ({ kind: '항목', name: `${x.doc} › ${x.heading}` })),
    ...newNames.map((n) => ({ kind: '이름', name: n.coord })), // 장부에 오른 새 항목 — 저장 꼴(기록 칸 줄 머리)은 「이름」 그대로(core/parts.js)
    ...newForms.map((x) => ({ kind: '갈래', name: x.name })),
    ...newKinds.map((x) => ({ kind: '종류', name: x.name })),
  ]
  return { text, items, newDocs, newNames, newForms, newKinds, warnings, errors, proposal, linked, fresh }
}
