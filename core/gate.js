// 검사 — 새 글(초안 · 바꿀 곳을 대어 만든 글)이 지식에 들어가도 되나(docs/kmd_권한_모델.md 7절 · docs/kmd_문서_작성기준.md 3 ~ 5절).
//
//   G1 모양 · 기록마다 넣음(used) 또는 둠(left) · G2 base · G4 값 대조(빠진 값 · 지어낸 값 · 옛 값 빠짐) ·
//   G5 크기 · G6 표지(항목 머리 # · ## · applied · 프런트매터 · script — 소제목 ### 아래는 된다). 못 넘으면 { ok:false, why }.
//   초안 글 검사는 저장과 같은 문서 꼴 검사(core/docformat.js formatProblems)를 쓴다.
//
//   저장 문(hub.save · S4)은 checkSection(k, { doc, heading, base, content, record, spread }) 을 쓴다.
//   P1(저장 승인 설계): 판정은 judgeSection · judgeShape 가 오류(errors) · 경고(warnings · id)로 나눠 내고, checkSection · checkShape 는
//   그 위의 얇은 덮개로 판정을 「못 넘음」 하나로 접는다(foldJudge · 저장 문 · 제안 · kmd-migrate). 본문 반영 검사는 core/values.js judgeReflect.

import { sha16 } from './text.js'
import { guardNewDoc } from './guard.js'
import { formatProblems, lintSection } from './docformat.js'
import { valuesOf, mustValues, oldValues, namesIn, groundedIn, judgeId, noLevels, plainHas } from './values.js'

// 초안 짜임 알림 — 머리 단계 건너뜀 · 5단계 머리(거절하지 않는다 · 결과에 lint 로 싣는다)
export function draftLint(outs) {
  const lint = outs.flatMap((o) => lintSection(o))
  return lint.length ? { lint } : {}
}
// 초안 글 검사: 저장의 문서 꼴 검사 + 프런트매터 · script
export function draftBad(t, cur = '', { doc = null, old = null } = {}) {
  // 지금 글에 이미 있던 줄은 초안 탓이 아니다 — 새로 든 줄만
  //   가로줄(---)은 항목 끝 구분으로 지금 글에 있을 수 있다 — 지금 글보다 늘었을 때만 프런트매터로 본다
  const was = String(old ?? cur ?? '')
  const rules = (x) => (x.match(/^---\s*$/gm) || []).length
  if (rules(t) > rules(was)) return '프런트매터 줄(---)'
  if (/<script/i.test(t) && !/<script/i.test(was)) return 'script'
  const p = formatProblems(t, { doc, old })
  if (p.length) return p.slice(0, 2).map((x) => `${x.line}째 줄 ${x.what}`).join(' / ')
  return null
}

// 판정 나누기(저장 승인 설계 P1 · 3-1 · 3-2) — 오류(errors)와 경고(warnings)를 따로 낸다. 쓰지 않고 판정만.
//   오류: { id, code(conflict · format), why, stale? } — 고쳐 다시 보내야 하는 것(지문 · 꼴 · 표지 · 섞인 자리)
//   경고: { id, code(missing · invented · lost), doc, heading, values, why } — 값 대조(빠진 값 · 지어낸 값 · 옛 값 빠짐).
//   id 는 같은 입력이면 같다(judgeId: 갈래 · 문서 · 머리 · 값) — 제안서 해시 · 받아들인 경고가 이 id 를 쓴다(P2 · P3).
//   checkSection 은 이 판정을 「못 넘음」 하나로 접는다(오류가 먼저 · 경고는 빠진 → 지어낸 → 빠진 옛 값 차례).
export function judgeSection(k, { doc, heading, base, content, record, spread = false }) {
  const errors = []
  const warnings = []
  const err = (code, why, extra = {}) => errors.push({ id: judgeId(code, doc, heading), code, why, ...extra })
  const warn = (code, values, why) => warnings.push({ id: judgeId(code, doc, heading, ...[...values].sort()), code, doc, heading, values, why })
  if (typeof content !== 'string') { err('format', '항목 글이 없다'); return { errors, warnings, changed: [] } }
  const d = k.byDocPath.get(doc)
  const sec = d ? d.sections.find((s) => s.h === heading) || null : null
  const cur = sec ? sec.body : ''
  if (sec && (!base || String(base) !== sha16(cur))) err('conflict', base ? '그사이 항목이 바뀌었다. section 으로 다시 읽고 그 위에서 다시 짓는다' : '이미 있는 항목이다. section 이 준 base 를 같이 보낸다(그사이 남이 고친 글을 덮지 않게)', { stale: true })
  const bad = draftBad(content, cur, { doc, old: sec ? cur : null })
  if (bad) err('format', `글에 머리 · 표지가 들었다: ${bad}`)
  if (!content.trim() && cur.trim()) err('format', '글을 비웠다. 항목을 지우는 일은 지식관리자가 화면에서 한다')
  const body = String(record?.body || '')
  const title = String(record?.title || '')
  // 줄 머리 수준 표시(1. · 1.1. · 1))는 짜임이지 값이 아니다(noLevels · 줄 머리 날짜 · 판 번호 · 굵은 수는 값 · 「가.」 → 「1.」 이 지어낸 값 「1 · 2」 로 잡히지 않게 · 채널 평가 T14)
  const now = valuesOf(noLevels(content))
  const oldV = valuesOf(noLevels(cur))
  const recV = valuesOf(body + ' ' + title)
  // 빠진 값 — 기록이 「바뀐 것」 에 적은 새 값이 글에 있어야 한다(항목 머리에 있는 값은 다시 쓰지 않아도 된다)
  if (!spread) {
    const headV = valuesOf(heading)
    const missing = mustValues(body).filter((v) => !now.has(v) && !headV.has(v))
    if (missing.length) warn('missing', missing, `기록의 값이 글에 없다: ${missing.slice(0, 3).join(' · ')}`)
  }
  // 지어낸 값 — 글의 값은 옛 글이나 기록에 있어야 한다(같은 문서의 항목 머리 · 항목 장부의 항목은 된다)
  const named = namesIn(k, d)
  const grounded = groundedIn(cur + ' ' + body + ' ' + title, oldV, recV)
  const invented = [...now].filter((v) => !oldV.has(v) && !recV.has(v) && !named.has(v) && !grounded(v))
  if (invented.length) warn('invented', invented, `근거에 없는 값이 있다: ${invented.slice(0, 3).join(' · ')}`)
  // 옛 글의 값은 기록이 「옛 → 새」 로 말한 것만 빠진다(작성기준 3절 5)
  const gone = [...oldV].filter((v) => !now.has(v))
  const came = [...now].filter((v) => !oldV.has(v))
  const told = new Set(oldValues(body).map((v) => v.replace(/\s+/g, '')))
  // 묶은 글 값(「`지우고 이름을 남긴다`」 · 「…」)을 맨글로 푼 것은 값이 빠진 것이 아니다 — 글자가 새 글에 그대로 있으면(plainHas · 다듬기 samePolished 와 같은 읽기) 빼지 않는다.
  //   글자(한글 · 영문)가 든 값만: 맨 수(「10」)는 날짜 「-10」 같은 다른 자리에 숨지 않게 그대로 본다(채널 평가 real-6 · 6b polish 다시 부름)
  const lost = gone.filter((v) => !told.has(v.replace(/\s+/g, '')) && !(/[A-Za-z가-힣]/.test(v) && v.length >= 2 && plainHas(content, v)))
  if (lost.length) warn('lost', lost, `옛 글의 값이 빠졌다: ${lost.slice(0, 3).join(' · ')}. 바꾼 값이면 기록의 바뀐 것에 「옛 값 → 새 값」 으로 적는다`)
  const changed = gone.length && came.length ? [{ from: gone.join(' · '), to: came.join(' · ') }] : []
  return { errors, warnings, changed, ...draftLint([content]) }
}

// 판정을 「못 넘음」 하나로 접는다(저장 문 · 제안 · kmd-migrate) — 첫 오류, 없으면 막는 첫 경고(code values), 둘 다 없으면 넘음
export function foldJudge(j, { pass = () => false } = {}) {
  const e = j.errors[0]
  if (e) return { ok: false, code: e.code, why: e.why, ...(e.stale ? { stale: true } : {}), ...(e.near ? { near: e.near } : {}) }
  const w = j.warnings.find((x) => !pass(x))
  if (w) return { ok: false, code: 'values', why: w.why }
  return null
}

// 저장 문의 항목 검사(S4 · docs/품질개선/KMD_개편_설계.md 3-3) — 사람 · 세션이 보낸 새 글(content · 바꿀 곳을 댄 글) 하나를 지금 지식에 대어 본다.
//   { doc, heading } — 항목 자리(문서 경로 docs/x.md · 머리) · base — 보낸 쪽이 읽은 지문(이미 있는 항목이면 꼭) ·
//   record — 함께 보낸 기록({ title, body }) · spread — 고칠 항목이 여럿이라 기록의 값이 항목들에 나뉜다(빠진 값은 부르는 쪽이 합쳐서 본다) ·
//   → { ok, why, code, stale, changed: [{ from, to }], lint } · code: conflict · format · values
//   크기(G5 근거보다 크게)는 보지 않는다 — 사람 · 세션이 항목 전체를 다시 쓴다
//   judgeSection 위의 얇은 덮개다.
export function checkSection(k, input) {
  const j = judgeSection(k, input)
  const f = foldJudge(j)
  if (f) return f
  return { ok: true, changed: j.changed, ...(j.lint ? { lint: j.lint } : {}) }
}

// 문서 짜임의 글 걸음 검사(바탕 세우기 설계 4-5 · 권한 모델 7-2) — 나누기 · 합치기 · 엮임 · 문서 요약 · 바탕 새 항목. 팀 · 개인 모두 돈다.
//   unit — { targets: [{ doc(docs/x.md), h, content }], sources: [{ doc, h, base }], intros: [{ doc, text, ground }], ground?(바탕: 재료 글) }
//   근거는 출처 항목의 지금 글(바탕은 재료 글)뿐이다 — 기록 본문 · 제목은 근거가 아니다(「기록에도 같이 지어 넣으면 넘는」 구멍)
//   judgeShape → { errors: [{ id, code(conflict · format), why, stale? }], warnings: [{ id, code(invented · lost · dropped), doc, heading, values, why }], lint }
//     (저장 승인 설계 P1 · P-D24: 오류는 P7 부터 걸음 입력 오류 · 값 경고는 측정만). 출처가 없거나 바뀌었으면(conflict) 값은 보지 않는다.
export function judgeShape(k, unit) {
  const errors = []
  const warnings = []
  const err = (code, why, at = {}, extra = {}) => errors.push({ id: judgeId(code, at.doc, at.h, why), code, why, ...extra })
  const warn = (code, at, values, why) => warnings.push({ id: judgeId(code, at.doc, at.h, ...[...values].sort()), code, doc: at.doc ?? null, heading: at.h ?? null, values, why })
  const plain = (t) => String(t || '')
  const secOf = (doc, h) => k.byDocPath.get(doc)?.sections.find((s) => s.h === h) || null
  // 지문 — 출처 항목마다 지금 글이 지을 때와 같아야 한다(하나라도 다르면 단위 전체 E_CONFLICT)
  const srcText = []
  for (const s of unit.sources || []) {
    const sec = secOf(s.doc, s.h)
    if (!sec) { err('conflict', `출처 항목이 없다: ${s.doc.replace(/^docs\/|\.md$/g, '')} › ${s.h}`, s, { stale: true }); return { errors, warnings } }
    if (s.base && sha16(sec.body) !== s.base) { err('conflict', `그사이 출처 항목이 바뀌었다: ${s.h}`, s, { stale: true }); return { errors, warnings } }
    srcText.push(sec.body)
  }
  // 꼴 — 머리 · 표지 · 표 · 문서 꼴 · 빈 글 · 목표 문서 갈래의 머리 꼴
  let noText = false
  for (const t of unit.targets || []) {
    if (typeof t.content !== 'string' || !t.content.trim()) { err('format', `「${t.h}」 글이 비었다`, t); if (typeof t.content !== 'string') noText = true; continue }
    const cur = secOf(t.doc, t.h)
    const bad = draftBad(t.content, cur ? cur.body : '', { doc: t.doc, old: cur ? cur.body : null })
    if (bad) { err('format', `「${t.h}」 글에 머리 · 표지가 들었다: ${bad}`, t); continue }
    const f = k.forms ? guardNewDoc(k.forms, t.doc, [t.h]) : null
    const headBad = f?.errors.find((e) => /머리 꼴/.test(e.message))
    if (headBad) err('format', headBad.message, t)
  }
  for (const x of unit.intros || []) {
    if (typeof x.text !== 'string' || !x.text.trim()) { err('format', '요약이 비었다', x); if (typeof x.text !== 'string') noText = true; continue }
    const bad = draftBad(x.text, '', { doc: x.doc, old: null })
    if (bad || /^#{1,6}\s/m.test(x.text)) err('format', `요약에 머리 · 표지가 들었다: ${bad || '머리 줄'}`, x)
  }
  if (noText) return { errors, warnings }
  // 값 대조 — 지어낸 값(목표 ⊂ 출처 ∪ 장부 항목) · 잃은 값(출처 ⊂ 목표 합 · 바탕 · 요약은 묻지 않는다)
  const groundText = [...srcText, unit.ground || ''].map(plain).join('\n')
  const srcV = valuesOf(groundText)
  const heads = valuesOf([...(unit.sources || []).map((s) => s.h), ...(unit.targets || []).map((t) => t.h)].join(' '))
  const named = new Set()
  for (const t of unit.targets || []) for (const n of namesIn(k, k.byDocPath.get(t.doc))) named.add(n)
  const grounded = groundedIn(groundText, srcV, heads)
  const all = new Set()
  for (const t of unit.targets || []) {
    const v = valuesOf(plain(t.content))
    for (const x of v) all.add(x)
    const invented = [...v].filter((x) => !srcV.has(x) && !heads.has(x) && !named.has(x) && !grounded(x))
    if (invented.length) warn('invented', t, invented, `「${t.h}」 에 출처에 없는 값이 있다: ${invented.slice(0, 3).join(' · ')}`)
  }
  for (const x of unit.intros || []) {
    const g = valuesOf(plain(x.ground || ''))
    const gg = groundedIn(plain(x.ground || ''), g)
    const invented = [...valuesOf(x.text)].filter((v) => !g.has(v) && !named.has(v) && !gg(v))
    if (invented.length) warn('invented', { doc: x.doc, h: null }, invented, `요약에 문서에 없는 값이 있다: ${invented.slice(0, 3).join(' · ')}`)
  }
  if ((unit.sources || []).length) {
    const tHeads = valuesOf((unit.targets || []).map((t) => t.h).join(' '))
    const lost = [...valuesOf(srcText.map(plain).join('\n'))].filter((v) => !all.has(v) && !tHeads.has(v))
    if (lost.length) warn('lost', { doc: null, h: null }, lost, `출처의 값이 새 글에 없다: ${lost.slice(0, 3).join(' · ')}`)
  }
  // 사라지는 문장 어림 — 거절하지 않고 알린다(끝 진단)
  const sentences = (t) => plain(t).split(/(?<=[.다])\s+|\n+/).map((x) => x.replace(/[\s*`>|-]+/g, '')).filter((x) => x.length >= 8)
  const now = (unit.targets || []).map((t) => plain(t.content).replace(/[\s*`>|-]+/g, '')).join('\n')
  const dropped = srcText.flatMap(sentences).filter((x) => !now.includes(x))
  if (dropped.length) warn('dropped', { doc: null, h: null }, [String(dropped.length)], `글이 바뀐 문장 ${dropped.length}`)
  return { errors, warnings, ...(errors.length ? {} : draftLint((unit.targets || []).map((t) => t.content))) }
}

//   checkShape → { ok, code(conflict · format · values), why, warnings } — judgeShape 위의 얇은 덮개(
//   첫 오류 · 없으면 첫 값 경고가 「못 넘음」 · 바뀐 문장은 넘은 결과의 warnings 글로)
export function checkShape(k, unit, opt = {}) {
  const j = judgeShape(k, unit, opt)
  const f = foldJudge(j, { pass: (w) => w.code === 'dropped' })
  if (f) return f
  return { ok: true, warnings: j.warnings.filter((w) => w.code === 'dropped').map((w) => w.why), ...(j.lint ? { lint: j.lint } : {}) }
}
