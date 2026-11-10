// 문서 짜임 넓히기 — 구조안(plan) · 지금 짜임 · 지문 · 차이 풀기 · 구조안 검사(바탕 세우기 설계 3-3 · 4-2 · 4-3 · 6-1).
//
//   구조안은 「새 짜임 전체」 를 적는다(바뀔 것 목록이 아니다). 엔진이 지금 짜임(readShape)과 견주어 걸음을 만든다(diffPlan).
//   걸음 재료는 언제나 서버가 지금 지식을 새로 읽어 만든다 — 사람 · 화면 · PC 가 보낸 걸음 재료(ops · remove)는 받지 않는다(4-8).
//
//   cleanPlan(raw)            꼴 검사 · 다듬기 → { plan } | { error }
//   shapeFp(files)            구조안 base — docs/ 문서 id · 문서마다 ## 머리 목록 · _order · _managed · _forms(항목 글은 넣지 않는다)
//   stepFp(files, ops)        frame · tidy 걸음 지문(core/restructure.js)
//   readShape(k, files)       지금 짜임 — 문서 · 항목(머리 · 줄 수 · 글 지문 · 이름) · 갈래 · 차례 · shapeFp
//   diffPlan(S, P)            걸음 재료 — forms · frame(ops) · write 단위(나누기 · 합치기 · 새 항목 · 문서 요약) · tidy(drops)
//   planCheck(k, S, P)        걸림(errors) · 경고(warnings) · 걸음(diff) — 덮임 빠짐 · G4 · 별칭 겹침 · 이름 자리 밖 · 50 조각 넘는 엮임 · 출처 대기 기록 …
//
//   순수 함수다(지식을 읽는 것은 부르는 쪽: core/knowledge.js loadKnowledge · core/restructure.js readStructure).

import crypto from 'node:crypto'
import path from 'node:path'
import { nfc, readText, sha16 } from './text.js'
import { parseDoc, headingMatches } from './sections.js'
import { parseForms, formsOf, formFor, headingFits, formHeadRule, FORM_KINDS } from './guard.js'
import { cleanForms } from './namebook.js'
import { nameProblem, stepFp } from './restructure.js'
import { coordsOfSection, reflectedIn } from './knowledge.js'
import { watchedOf } from './watchmark.js'

export { stepFp }
const P = path.posix
export const PLAN_LIMITS = { docs: 500, items: 5000, names: 2000, head: 120, unit: 50, text: 200000 }
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const hash16 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)
const h2 = (text) => parseDoc(readText(text), '').sections.map((s) => s.h)

// ── 지문 ──
export function shapeFp(files) {
  const ids = [...files.docs.keys()].map((r) => nfc(r.slice(5, -3))).sort()
  const heads = ids.map((id) => `${id}:${h2(files.docs.get(`docs/${id}.md`)).join('\u0001')}`)
  return hash16([heads.join('\n'), readText(files.order || ''), readText(files.registry || ''), readText(files.forms || '')].join('\n--\n'))
}

// ── 지금 짜임 ──
//   { fp, docs: [{ id, title, watched, intro, items: [{ h, lines, sha, coords }] }], forms, order, dirs }
export function readShape(k, files) {
  const docs = []
  for (const [rel, text0] of files.docs) {
    const text = readText(text0)
    const id = nfc(rel.slice(5, -3))
    const d = k?.byDocPath.get(rel) || null
    const pd = parseDoc(text, P.basename(id))
    docs.push({
      id,
      title: pd.title,
      watched: !!watchedOf(text),
      intro: !!pd.intro.trim(),
      items: pd.sections.map((s) => ({ h: s.h, lines: s.body ? s.body.split('\n').length : 0, sha: sha16(s.body), coords: d ? coordsOfSection(k, d, s.h) : [] })),
    })
  }
  docs.sort((a, b) => a.id.localeCompare(b.id, 'ko'))
  return { fp: shapeFp(files), docs, forms: parseForms(files.forms || ''), formsText: readText(files.forms || '') }
}

// ── 꼴 검사(8-1 · 입력 길이 · 모양 · prototype 이름 막기) ──
const str = (v, max) => typeof v === 'string' && v.length <= max && !/[\r\n]/.test(v)
const cleanId = (v) => nfc(String(v ?? '')).replace(/^\/+|\/+$/g, '')
export function cleanPlan(raw) {
  const bad = (why) => ({ error: `구조안 꼴이 아니다: ${why}` })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('{ v, kind, docs … } 가 아니다')
  for (const key of Object.keys(raw)) if (BAD_KEYS.has(key)) return bad(key)
  if (raw.v !== 1) return bad('v 는 1')
  if (!['reshape', 'seed'].includes(raw.kind)) return bad('kind 는 reshape · seed')
  if (raw.base != null && !(typeof raw.base === 'string' && /^[0-9a-f]{16}$/.test(raw.base))) return bad('base 는 16자 지문')
  const forms = raw.forms == null ? null : cleanForms(raw.forms)
  if (raw.forms != null && !forms) return bad('forms')
  const dirs = raw.dirs == null ? [] : raw.dirs
  if (!Array.isArray(dirs) || dirs.length > PLAN_LIMITS.docs || dirs.some((d) => !str(d, 200))) return bad('dirs')
  if (!Array.isArray(raw.docs) || raw.docs.length > PLAN_LIMITS.docs) return bad(`docs 는 ${PLAN_LIMITS.docs} 안의 목록`)
  let nItems = 0
  const docs = []
  for (const d of raw.docs) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return bad('docs[]')
    if (!str(d.id, 200) || !d.id.trim()) return bad('docs[].id')
    if (d.was != null && !str(d.was, 200)) return bad('docs[].was')
    let intro = null
    if (d.intro != null) {
      if (typeof d.intro !== 'object' || Array.isArray(d.intro)) return bad('docs[].intro')
      if (typeof d.intro.ask === 'string' && d.intro.ask.length <= 2000) intro = { ask: d.intro.ask }
      else if (typeof d.intro.text === 'string' && d.intro.text.length <= 4000) intro = { text: d.intro.text }
      else return bad('docs[].intro 는 { ask } · { text }')
    }
    if (!Array.isArray(d.items)) return bad('docs[].items')
    nItems += d.items.length
    if (nItems > PLAN_LIMITS.items) return bad(`항목은 ${PLAN_LIMITS.items} 안`)
    const items = []
    for (const it of d.items) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) return bad('items[]')
      if (!str(it.h, PLAN_LIMITS.head) || !it.h.trim()) return bad(`items[].h(${PLAN_LIMITS.head}자 안 한 줄)`)
      const from = it.from == null ? [] : it.from
      if (!Array.isArray(from) || from.length > PLAN_LIMITS.unit || from.some((f) => !f || typeof f !== 'object' || !str(f.doc, 200) || !str(f.h, PLAN_LIMITS.head))) return bad('items[].from 은 [{ doc, h }]')
      const src = it.src == null ? [] : it.src
      if (!Array.isArray(src) || src.length > 200 || src.some((s) => typeof s !== 'string' || !/^m:[0-9a-f]{16}$/.test(s))) return bad('items[].src 는 [m:<16자>]')
      if (it.part != null && !(typeof it.part === 'string' && it.part.length <= 500)) return bad('items[].part')
      if (it.text != null && !(typeof it.text === 'string' && it.text.length <= PLAN_LIMITS.text)) return bad('items[].text')
      items.push({ h: nfc(it.h.trim()), from: from.map((f) => ({ doc: cleanId(f.doc), h: nfc(f.h) })), ...(src.length ? { src } : {}), ...(it.part ? { part: it.part } : {}), ...(typeof it.text === 'string' ? { text: it.text } : {}) })
    }
    docs.push({ id: cleanId(d.id), was: d.was == null ? null : cleanId(d.was), intro, items })
  }
  const names = raw.names == null ? [] : raw.names
  if (!Array.isArray(names) || names.length > PLAN_LIMITS.names) return bad('names')
  const outNames = []
  for (const n of names) {
    if (!n || typeof n !== 'object' || !str(n.coord, 200) || !/^[^:\s]+:.+$/.test(n.coord) || !str(n.doc, 200) || !str(n.h, PLAN_LIMITS.head)) return bad('names[] 는 { coord, label, doc, h }')
    if (n.label != null && !str(n.label, 160)) return bad('names[].label')
    outNames.push({ coord: nfc(n.coord), label: n.label ? nfc(n.label) : '', doc: cleanId(n.doc), h: nfc(n.h) })
  }
  let order = null
  if (raw.order != null) {
    if (typeof raw.order !== 'object' || Array.isArray(raw.order)) return bad('order')
    order = {}
    for (const [f, xs] of Object.entries(raw.order)) {
      if (BAD_KEYS.has(f) || !Array.isArray(xs) || xs.length > PLAN_LIMITS.docs || xs.some((x) => !str(x, 200))) return bad('order')
      order[cleanId(f)] = xs.map((x) => nfc(x))
    }
  }
  const empty = raw.empty == null ? [] : raw.empty
  if (!Array.isArray(empty) || empty.length > PLAN_LIMITS.docs || empty.some((x) => !str(x, 200))) return bad('empty')
  const skip = raw.skip == null ? [] : raw.skip
  if (!Array.isArray(skip) || skip.length > 5000 || skip.some((x) => !x || typeof x !== 'object' || !/^m:[0-9a-f]{16}$/.test(String(x.src)) || (x.why != null && !str(x.why, 300)))) return bad('skip')
  return { plan: { v: 1, kind: raw.kind, kn: typeof raw.kn === 'string' ? raw.kn.slice(0, 120) : null, base: raw.base || null, forms, dirs: dirs.map(cleanId).filter(Boolean), docs, names: outNames, order, empty: empty.map(cleanId), skip: skip.map((x) => ({ src: x.src, why: x.why || '' })) } }
}

// ── 차이 풀기(4-3) ──
//   → { forms(바뀐 갈래 장부 · 없으면 null), frame: { moves, creates, dirs, order, items }, writes: [unit], tidy: { drops }, errors }
//   unit — { n, kind: merge | split | mixed | seed | intro, targets: [{ doc, h, from, src, part, text, base?(고쳐 쓰기) }], sources: [{ doc, h, sha, coords }], intros: [{ doc, ask | text }], size }
const key = (doc, h) => `${doc}\n${h}`
export function diffPlan(S, Pl) {
  const errors = []
  const err = (where, why, code) => errors.push({ where, why, ...(code ? { code } : {}) })
  const cur = new Map(S.docs.map((d) => [d.id, d]))
  const curItem = new Map()
  for (const d of S.docs) for (const it of d.items) curItem.set(key(d.id, it.h), { doc: d.id, ...it })
  // 문서 옮기기 · 새 문서
  const moves = []
  const creates = []
  const wasOf = new Map() // 끝 id → 지금 id
  const finalOf = new Map() // 지금 id → 끝 id
  for (const d of Pl.docs) {
    if (d.was) {
      if (!cur.has(d.was)) { err(d.id, `지금 없는 문서다(was: ${d.was})`); continue }
      if (finalOf.has(d.was)) { err(d.id, `같은 문서를 두 곳에 둔다(was: ${d.was})`); continue }
      finalOf.set(d.was, d.id)
      wasOf.set(d.id, d.was)
      if (d.was !== d.id) moves.push({ from: d.was, to: d.id })
    } else {
      if (cur.has(d.id) && !Pl.docs.some((x) => x.was === d.id)) { err(d.id, '이미 있는 문서다(그대로 두려면 was 를 적는다)'); continue }
      creates.push(d.id)
    }
  }
  // 출처 쓰임 — 같은 출처를 둘 이상의 항목이 쓰면 나누기
  const uses = new Map()
  for (const d of Pl.docs) for (const it of d.items) for (const f of it.from) uses.set(key(f.doc, f.h), (uses.get(key(f.doc, f.h)) || 0) + 1)
  // 글이 그대로 가는 항목(frame) 과 글을 다시 쓰는 항목(write)
  const frameT = [] // { doc, h, from }
  const writeT = [] // { doc, h, it }
  for (const d of Pl.docs) {
    for (const it of d.items) {
      if (it.src?.length) { writeT.push({ doc: d.id, h: it.h, it, seed: true }); continue }
      if (!it.from.length) { err(`${d.id} › ${it.h}`, '어디서 오는지(from) · 재료(src)가 없다'); continue }
      for (const f of it.from) if (!curItem.has(key(f.doc, f.h))) err(`${d.id} › ${it.h}`, `지금 없는 항목이다: ${f.doc} › ${f.h}`)
      if (it.from.length === 1 && uses.get(key(it.from[0].doc, it.from[0].h)) === 1 && typeof it.text !== 'string') frameT.push({ doc: d.id, h: it.h, from: it.from[0] })
      else writeT.push({ doc: d.id, h: it.h, it })
    }
  }
  // write 단위 — 출처 · 목표가 서로 걸리는 덩이(합집합 찾기)
  const parent = new Map()
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  const add = (x) => { if (!parent.has(x)) parent.set(x, x) }
  const unite = (a, b) => { add(a); add(b); parent.set(find(a), find(b)) }
  for (const t of writeT) {
    const tk = 'T' + key(t.doc, t.h)
    add(tk)
    if (t.seed) unite(tk, 'D' + t.doc) // 바탕: 문서마다 한 단위
    for (const f of t.it.from) unite(tk, 'S' + key(f.doc, f.h))
  }
  const groups = new Map()
  for (const t of writeT) {
    const g = find('T' + key(t.doc, t.h))
    if (!groups.has(g)) groups.set(g, { targets: [], sources: new Map() })
    const G = groups.get(g)
    const target = { doc: t.doc, h: t.h, from: t.it.from, ...(t.it.src ? { src: t.it.src } : {}), ...(t.it.part ? { part: t.it.part } : {}), ...(typeof t.it.text === 'string' ? { text: t.it.text } : {}) }
    G.targets.push(target)
    for (const f of t.it.from) {
      const c = curItem.get(key(f.doc, f.h))
      if (c) G.sources.set(key(f.doc, f.h), { doc: f.doc, h: f.h, sha: c.sha, coords: c.coords })
    }
  }
  // 고쳐 쓰기 — 목표 하나가 출처와 같은 문서(옮긴 뒤) · 같은 머리면 그 항목은 지우지 않고 다시 쓴다
  const writes = []
  let n = 0
  for (const G of groups.values()) {
    const sources = [...G.sources.values()]
    for (const t of G.targets) {
      const s = sources.find((x) => (finalOf.get(x.doc) || x.doc) === t.doc && x.h === t.h)
      if (s) { t.base = s.sha; s.keep = true }
    }
    const merge = G.targets.some((t) => t.from.length > 1)
    const split = sources.some((s) => (uses.get(key(s.doc, s.h)) || 0) > 1)
    const kind = G.targets.some((t) => t.src) ? 'seed' : merge && split ? 'mixed' : merge ? 'merge' : split ? 'split' : 'rewrite'
    const size = G.targets.length + sources.filter((s) => !s.keep).length
    writes.push({ n: ++n, kind, targets: G.targets, sources, intros: [], size })
  }
  // 문서 요약 — 그 문서의 write 단위에(없으면 요약만의 단위)
  for (const d of Pl.docs) {
    if (!d.intro) continue
    const u = writes.find((w) => w.targets.some((t) => t.doc === d.id)) || (writes.push({ n: ++n, kind: 'intro', targets: [], sources: [], intros: [], size: 0 }), writes[writes.length - 1])
    u.intros.push({ doc: d.id, ...d.intro })
    u.size++
  }
  // frame 항목 — 옮기기 · 이름 · 차례. 목표 문서마다 계획한 차례대로 놓는다(뒤에서부터 · before = 다음 frame 항목)
  const items = []
  const writeTargets = new Set(writeT.map((t) => key(t.doc, t.h)))
  for (const d of Pl.docs) {
    const fr = d.items.filter((it) => frameT.some((t) => t.doc === d.id && t.h === it.h)).map((it) => frameT.find((t) => t.doc === d.id && t.h === it.h))
    if (!fr.length) continue
    const came = fr.filter((t) => (finalOf.get(t.from.doc) || t.from.doc) !== d.id || t.from.h !== t.h)
    // 그대로 있는 항목의 지금 차례가 계획과 같은가
    const was = wasOf.get(d.id)
    const curOrder = was && cur.has(was) ? cur.get(was).items.map((x) => x.h) : []
    const kept = fr.filter((t) => !came.includes(t)).map((t) => t.h)
    const keptNow = curOrder.filter((h) => kept.includes(h))
    const inOrder = keptNow.join('\n') === kept.join('\n')
    const todo = inOrder ? came : fr
    if (!todo.length) continue
    for (let i = fr.length - 1; i >= 0; i--) {
      const t = fr[i]
      if (!todo.includes(t)) continue
      const next = fr.slice(i + 1).find((x) => !writeTargets.has(key(d.id, x.h)))
      // 차례만 맞추는 것(그대로인 항목)이고 이미 맨 끝이면 건너뛴다
      items.push({ from: { doc: t.from.doc, h: t.from.h }, to: { doc: d.id, h: t.h, ...(next ? { before: next.h } : {}) } })
    }
  }
  // 빈 문서 걷기 — 지금 id(옮기지 않는 문서만)
  const drops = []
  for (const e of Pl.empty) {
    if (!cur.has(e)) { err(e, '걷을 문서가 지금 없다'); continue }
    if (finalOf.has(e)) { err(e, '걷을 문서를 구조안의 문서로도 쓴다'); continue }
    drops.push(e)
  }
  // 갈래 장부 — 구조안 forms 가 지금과 다르면
  let forms = null
  if (Pl.forms) {
    const now = JSON.stringify(S.forms.map((f) => [f.name, f.kind, f.folder || '', f.pattern || '']).sort())
    const next = JSON.stringify(Pl.forms.map((f) => [f.name, f.kind, f.folder || '', f.pattern || '']).sort())
    if (now !== next) forms = Pl.forms
  }
  const order = Pl.order || null
  const frame = { moves, creates, dirs: Pl.dirs, ...(order ? { order } : {}), items }
  return { forms, frame, writes, tidy: { drops }, errors, finalOf: Object.fromEntries(finalOf) }
}

// ── 구조안 검사(4-2 · 6-1) ──
//   k — 지금 지식(loadKnowledge) · S — readShape(k, files) · Pl — cleanPlan 의 plan
//   → { ok, stale(base 가 지금과 다름), errors: [{ where, why, code? }], warnings: [{ where, why }], diff, summary }
const norm = (s) => nfc(String(s || '')).toLowerCase().replace(/\s+/g, '')
export function planCheck(k, S, Pl) {
  const errors = []
  const warnings = []
  const err = (where, why, code) => errors.push({ where, why, ...(code ? { code } : {}) })
  const warn = (where, why) => warnings.push({ where, why })
  const diff = diffPlan(S, Pl)
  errors.push(...diff.errors)
  const cur = new Map(S.docs.map((d) => [d.id, d]))
  const planned = new Map(Pl.docs.map((d) => [d.id, d]))
  // 문서 id · 이름(G4 · 6-1 1) · 겹침(대소문자 무시)
  const seen = new Map()
  // 갈래 — 구조안 forms 가 있으면 그것 · 없으면 지금 지식의 갈래(기본 갈래 포함 · loadKnowledge)
  const fset = Pl.forms ? { rows: Pl.forms, own: Pl.forms.length > 0 } : k?.forms || formsOf(S.formsText)
  for (const d of Pl.docs) {
    const low = d.id.toLowerCase()
    if (seen.has(low)) err(d.id, `같은 이름의 문서가 둘이다(${seen.get(low)})`)
    seen.set(low, d.id)
    const segs = d.id.split('/')
    for (const [i, s] of segs.entries()) {
      const w = nameProblem(s, { doc: i === segs.length - 1 && (!d.was || P.basename(d.was) !== s) })
      if (w) { err(d.id, w); break }
    }
    if (segs.length > 3) warn(d.id, '폴더 깊이가 2단을 넘는다')
    // 갈래 — 이 문서 이름이 다른 갈래의 이름 · 다른 이름에 걸리면(formFor 는 부분 문자열로 집는다) G4
    const f = formFor(fset, P.basename(d.id))
    const named = !d.was || P.basename(d.was) !== P.basename(d.id) // 새 이름(새 문서 · 이름 바꿈)만 — 있던 이름은 그대로 둔다
    if (named && f && norm(f.name) !== norm(P.basename(d.id))) err(d.id, `「${f.name}」 갈래의 다른 이름에 걸린다: 문서 이름을 바꾸거나 갈래의 다른 이름을 고친다`, 'g4')
    if (!f && fset.own && !d.was) warn(d.id, '갈래 장부에 없는 새 문서다(문서 짜임이 「대상」 갈래 줄을 더한다)')
    // 머리 — 겹침(같음 · 앞부분) · 갈래 꼴
    const hs = d.items.map((it) => it.h)
    for (const [i, h] of hs.entries()) {
      const o = hs.find((x, j) => j !== i && (x === h || headingMatches(x, h)))
      if (o) err(`${d.id} › ${h}`, `머리가 겹친다: ${o}`)
      const it = d.items[i]
      const kept = d.was && it.from.length === 1 && it.from[0].doc === d.was && it.from[0].h === h // 그대로인 항목은 지금 머리를 그대로 둔다
      if (!kept && f && !headingFits(f, h)) err(`${d.id} › ${h}`, `「${f.name}」 의 항목 머리 꼴이 아니다: ${formHeadRule(f)}`)
    }
    if (d.items.length && (d.items.length < 5 || d.items.length > 40)) warn(d.id, `항목 ${d.items.length}(문서당 5~40)`)
    // 원본이 주인인 문서 — 이름 · 자리 · 항목을 그대로
    const w = d.was && cur.get(d.was)
    if (w?.watched) {
      if (d.was !== d.id) err(d.id, '원본이 주인인 문서는 옮기지 않는다')
      const same = d.items.length === w.items.length && d.items.every((it, i) => it.from.length === 1 && it.from[0].doc === d.was && it.from[0].h === it.h && w.items[i]?.h === it.h)
      if (!same) err(d.id, '원본이 주인인 문서의 항목은 그대로 둔다')
    }
  }
  // 폴더당 문서 수
  const perDir = new Map()
  for (const d of Pl.docs) { const f = P.dirname(d.id); perDir.set(f, (perDir.get(f) || 0) + 1) }
  for (const [f, c] of perDir) if (f !== '.' && (c < 3 || c > 12)) warn(f + '/', `문서 ${c}(폴더당 3~12)`)
  // 갈래 다른 이름끼리 겹침(6-1 3)
  if (Pl.forms) {
    for (const a of Pl.forms) for (const al of a.aliases) for (const b of Pl.forms) if (a !== b && norm(al).length >= 2 && norm(b.name).includes(norm(al))) err(`갈래 ${a.name}`, `다른 이름 「${al}」 이 갈래 「${b.name}」 와 겹친다`, 'g4')
  }
  // 지금 문서는 모두 구조안의 문서(was)이거나 걷을 문서
  const used = new Set(Pl.docs.map((d) => d.was).filter(Boolean))
  for (const d of S.docs) if (!used.has(d.id) && !Pl.empty.includes(d.id)) err(d.id, '지금 문서가 구조안에 없다(was 로 잇거나 걷을 문서 empty 에)')
  // 덮임(4-3) — 지금 항목은 모두 어느 항목의 출처여야 한다(지우기는 이 기능이 하지 않는다)
  const fromSet = new Set(Pl.docs.flatMap((d) => d.items.flatMap((it) => it.from.map((f) => key(f.doc, f.h)))))
  for (const d of S.docs) for (const it of d.items) if (!fromSet.has(key(d.id, it.h))) err(`${d.id} › ${it.h}`, '이 항목이 구조안 어디에도 없다(지우기는 문서 고치기에서)', 'coverage')
  // 걷을 문서 — 옮김 · 걷기 뒤 항목 0 · 요약 0 이어야(들어오는 링크는 걸음이 다시 본다)
  for (const e of Pl.empty) {
    const d = cur.get(e)
    if (d?.intro) err(e, '요약이 있는 문서는 걷지 않는다')
    if (d?.watched) err(e, '원본이 주인인 문서는 걷지 않는다')
  }
  // write 단위 — 50 조각 · 출처 대기 기록(4-3 「planCheck 가 그런 출처의 나누기 · 합치기를 걸림으로」) · 이름 다시 놓기
  const nameAt = new Map(Pl.names.map((x) => [x.coord, x]))
  for (const u of diff.writes) {
    if (u.size > PLAN_LIMITS.unit) err(`단위 ${u.n}`, `나누기 · 합치기가 엮여 한 저장이 ${u.size} 조각이다(${PLAN_LIMITS.unit} 안으로 나눈다)`, 'unit')
    for (const s of u.sources) {
      const dObj = k?.byDocPath.get(`docs/${s.doc}.md`)
      const sec = dObj?.sections.find((x) => x.h === s.h)
      const pend = k && sec ? k.works.filter((w) => w.state === 'pend' && w.touches.some((c) => s.coords.includes(c)) && !reflectedIn(k, w, sec)) : []
      if (pend.length) err(`${s.doc} › ${s.h}`, `아직 안 넣은 기록 ${pend.length} 이 걸린 항목은 나누거나 합치지 않는다(먼저 넣거나 두기로 정한다)`, 'pend')
      for (const c of s.coords) {
        const at = nameAt.get(c)
        if (!at || !u.targets.some((t) => t.doc === at.doc && t.h === at.h)) err(c, `「${s.doc} › ${s.h}」 에 닿던 이름을 새 항목(${u.targets.map((t) => t.h).join(' · ')}) 가운데 하나에 놓는다(names)`, 'names')
      }
    }
  }
  // 이름 자리 밖 — names 가 가리키는 문서 · 항목이 구조안에 있나
  for (const x of Pl.names) {
    const d = planned.get(x.doc)
    if (!d || !d.items.some((it) => it.h === x.h)) err(x.coord, `이름 자리가 구조안에 없다: ${x.doc} › ${x.h}`, 'names')
  }
  // 바탕 세우기 — 빈 지식에서만 · 재료 덮임
  if (Pl.kind === 'seed') {
    if (S.docs.some((d) => d.id !== '처음')) err('kind', '바탕 세우기는 빈 지식에서만 한다')
    for (const d of Pl.docs) for (const it of d.items) if (!it.src?.length && typeof it.text !== 'string') err(`${d.id} › ${it.h}`, '바탕 세우기 항목은 재료(src)나 글(text)이 있어야 한다')
  }
  const stale = !!Pl.base && Pl.base !== S.fp
  if (!Pl.base) warn('base', '구조안을 지을 때 본 지문(base)이 없다')
  const summary = {
    moves: diff.frame.moves.length,
    creates: diff.frame.creates.length,
    items: diff.frame.items.length,
    writes: diff.writes.length,
    merges: diff.writes.filter((u) => u.kind === 'merge' || u.kind === 'mixed').length,
    splits: diff.writes.filter((u) => u.kind === 'split' || u.kind === 'mixed').length,
    drops: diff.tidy.drops.length,
    forms: !!diff.forms,
  }
  return { ok: !errors.length, stale, errors, warnings, diff, summary }
}

// 단계 이름(4-2) — 걸음 목록(차례 고정 · forms → frame → stock → write → tidy → seal)
export function stepsOf(diff) {
  const steps = []
  if (diff.forms) steps.push({ kind: 'forms' })
  const f = diff.frame
  if (f.moves.length || f.creates.length || f.items.length || (f.dirs || []).length || f.order) steps.push({ kind: 'frame' })
  for (const u of diff.writes) steps.push({ kind: 'write', unit: u.n })
  if (diff.tidy.drops.length) steps.push({ kind: 'tidy' })
  steps.push({ kind: 'seal' })
  return steps.map((s, i) => ({ n: i + 1, ...s }))
}
export { FORM_KINDS }

// 글 걸음 지문(4-2) — 단위의 출처 항목마다 글 지문(sha16). 글을 지을 때 본 출처와 넣을 때의 출처가 같아야 한다(어긋나면 E_CONFLICT)
export const unitFp = (u) => hash16((u.sources || []).map((s) => `${s.doc}\n${s.h}\n${s.sha}`).join('\n') + '\n--\n' + (u.targets || []).map((t) => `${t.doc}\n${t.h}`).join('\n'))
