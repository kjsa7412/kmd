// 짝 짓기(엮기) — 판정 한 줄에서 섹션(## 머리) · 항목 장부 줄(뜻 한 줄 gist) · 문서 장부 줄 · 건드린 항목 · 문서 성격 줄 · 사건 열쇠를 같이 짓는다.
//
//   지식 생성 하네스 H-D11 · H-D17(다) · H-O3(자리 채움) · H-O5 · H-O13 · 설계 5-1 걸음 3 · 6절.
//   LLM 은 무엇이 항목이고 어느 문서의 어느 머리인지 · 종류 · 식별자 · 뜻 한 줄을 적는다. 열쇠(`종류:값`) · 장부 줄 · 건드린 항목은 코드가 짓는다:
//   같은 낱말의 머리와 장부 항목이 따로 서서 서로 모르는 일(조사 Z V4)을 검사가 아니라 꼴로 없앤다.
//   이 모듈은 쓰지 않는다(순수 함수). 지식(k)은 읽기만 한다: vocab · registry · docs · forms · natures.
//
//   lines: [{ doc, heading, act: 'new' | 'edit' | 'same', kind?, kindGist?, id?, gist?, aliases?, nature?, depart? }]
//   docs:  [{ path, nature, summary?, gather?: { aliases?, pattern? }, depart? }]   이번에 세우는 문서
//   → { names, touches, natures, forms, kinds, lines(자리와 열쇠가 정해진 줄), fold[], skipped[], errors[] }

import { nfc } from './text.js'
import { TYPE_RE, NEW_VALUE_RE, formFor, GATHER_KINDS } from './guard.js'
import { locate } from './registry.js'
import { headingMatches } from './sections.js'
import { NATURES, SEED_KINDS, seedKind, isRuleId } from './genrules.js'
import { sectionOf } from './knowledge.js'

// 짜임 머리(R1-4 · H-O13) — 새로 세울 때 장부 짝을 짓지 않는다. 이미 항목으로 선 것(옛 지식의 「개요」)은 있는 항목이다
export const FRAME_HEADS = ['개요', '목적', '범위', '변경 이력', '변경이력', '개정 이력', '개정이력', '참고', '기타', '메모', '목차', '표지']
const sq = (s) => nfc(String(s || '')).replace(/\s+/g, '').toLowerCase()
export const isFrameHead = (h) => FRAME_HEADS.some((x) => sq(x) === sq(String(h || '').replace(/^\d+(\.\d+)*[.)]?\s+/, '')))

const docId = (p) => nfc(String(p || '')).replace(/\\/g, '/').replace(/^\/+/, '').replace(/^docs\//, '').replace(/\.md$/, '')
const docPath = (p) => `docs/${docId(p)}.md`
const stemOf = (p) => docId(p).split('/').pop()

// 뜻 한 줄 — 한 줄 · 80자 · 백틱과 표 칸 글자 없음(판례 카드에 실린다 · H-D25)
export const GIST_MAX = 80
export const cleanGist = (s) => nfc(String(s ?? '')).replace(/[\r\n`|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, GIST_MAX)

// 값(열쇠) — 식별자가 있으면 그대로 · 없으면 머리에서: 「값: 설명」 꼴이면 「값」 · 빈칸은 「_」 · 열쇠에 못 쓰는 글자는 뺀다(R5-2 · 가드 G1 안내와 같다)
export function valueOf({ id = null, heading = '' } = {}) {
  let v = nfc(String(id ?? '').trim())
  if (!v) {
    const h = nfc(String(heading || '').trim())
    const m = /^([^:：]{1,60})[:：]\s+\S/.exec(h)
    v = m ? m[1].trim() : h
  }
  v = v.replace(/[`|\x00-\x1f]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60)
  return NEW_VALUE_RE.test(v) ? v : ''
}

// 그 머리에 이미 닿는 장부 항목(정확한 줄 · 패턴 줄) — 지식의 문서 장부와 항목 장부로
function coordsAt(k, doc, heading) {
  const out = []
  for (const c of k.vocab.coords.keys()) {
    const loc = locate(k.registry, c)
    if (loc && loc.doc === doc && (nfc(loc.heading) === nfc(heading) || headingMatches(heading, loc.heading))) out.push(c)
  }
  return out
}
// 그 문서에 패턴 줄(`종류:*` → 이 문서의 `## {값}`)이 있나 → 종류
function patternKind(k, doc) {
  const r = (k.registry.rows || []).find((x) => x.doc === doc && /^[^:]+:\*$/.test(x.pattern) && x.heading.includes('{값}'))
  return r ? r.pattern.slice(0, -2) : null
}
// 그 문서에서 같은 것의 하나인 항목이 쓰는 종류(R5-1 가) — 가장 많이 쓰는 것
function kindInDoc(k, doc) {
  const n = new Map()
  for (const c of k.vocab.coords.keys()) {
    const loc = locate(k.registry, c)
    if (!loc || loc.doc !== doc) continue
    const t = c.slice(0, c.indexOf(':'))
    n.set(t, (n.get(t) || 0) + 1)
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null
}

export function weave(k0, { lines = [], docs = [] } = {}) {
  // 지식의 빈 칸은 빈 것으로 읽는다(빈 지식 · 시험의 손으로 지은 지식)
  const k = { ...k0, vocab: k0?.vocab?.coords ? k0.vocab : { coords: new Map() }, registry: k0?.registry?.rows ? k0.registry : { rows: [] }, forms: k0?.forms?.rows ? k0.forms : { rows: [] } }
  const names = []
  const touches = []
  const natures = []
  const forms = []
  const fold = []
  const skipped = []
  const errors = []
  const outLines = []
  const made = new Map() // 이번에 지은 열쇠 → 자리
  const kindsNow = new Set([...k.vocab.coords.keys()].map((c) => c.slice(0, c.indexOf(':'))))
  const newKinds = new Map()
  const err = (code, at, why) => errors.push({ code, at, why })
  const touch = (c) => { if (!touches.includes(c)) touches.push(c) }

  // ── 새 문서: 모으는 문서 접기(H-D17 다) · 문서 성격 줄 · 모으는 갈래 줄 ──
  const moved = new Map() // 접힌 문서 경로 → 있는 문서 경로
  for (const d of Array.isArray(docs) ? docs : []) {
    const path = docPath(d?.path)
    const stem = stemOf(path)
    if (!stem) continue
    const nature = NATURES.includes(d.nature) ? d.nature : null
    const have = k.byDocPath?.get(path)
    if (have) continue // 있는 문서다(새 문서가 아니다 · 성격 줄을 고치지 않는다)
    // 종류 낱말이 같거나 이름이 그 별칭을 품는 모으는 문서가 이미 있으면 그 문서의 새 항목으로 접는다. 벗어남을 적었으면 접지 않는다(잰다)
    const f = formFor(k.forms, stem)
    if (f && GATHER_KINDS.includes(f.kind) && nfc(f.name) !== nfc(stem) && !d.depart) {
      const to = docPath(f.folder ? `${f.folder}/${f.name}` : f.name)
      moved.set(path, to)
      fold.push({ what: 'doc', from: docId(path), to: docId(to), why: `「${f.name}」 갈래(${f.kind})가 이미 모은다` })
      continue
    }
    if (nature) natures.push({ doc: docId(path), nature, summary: cleanGist(d.summary).slice(0, GIST_MAX) })
    if (nature && GATHER_KINDS.includes(nature) && !k.forms.rows.some((x) => nfc(x.name) === nfc(stem))) {
      const folder = docId(path).includes('/') ? docId(path).slice(0, docId(path).lastIndexOf('/')) : ''
      const aliases = (Array.isArray(d.gather?.aliases) ? d.gather.aliases : []).map((a) => cleanGist(a).replace(/,/g, ' ')).filter((a) => a && sq(a) !== sq(stem)).slice(0, 8)
      const pattern = typeof d.gather?.pattern === 'string' && /^[^\s:`|]{1,24}:\*$/.test(d.gather.pattern.trim()) ? d.gather.pattern.trim() : null
      forms.push({ name: stem, aliases, ...(folder ? { folder } : {}), kind: nature, ...(pattern ? { pattern } : {}) })
    }
  }

  // ── 항목 줄 ──
  for (const l0 of Array.isArray(lines) ? lines : []) {
    if (!l0 || typeof l0 !== 'object') continue
    const heading = nfc(String(l0.heading || '').trim())
    let doc = docPath(l0.doc)
    if (moved.has(doc)) doc = moved.get(doc)
    const at = `${docId(doc)} › ${heading}`
    const act = ['new', 'edit', 'same'].includes(l0.act) ? l0.act : 'new'
    const line = { ...l0, doc, heading, act }
    outLines.push(line)
    if (!heading || !docId(doc)) { err('place', at, '문서와 머리가 있어야 한다'); continue }
    const docObj = k.byDocPath?.get(doc) || null
    const sec = docObj?.sections.find((s) => s.h === heading) || docObj?.sections.find((s) => headingMatches(s.h, heading)) || null
    const here = sec ? coordsAt(k, doc, sec.h) : []
    // 있는 항목 — 그 머리에 닿는 장부 항목을 건드린다. 장부 밖 머리는 종류와 뜻 한 줄이 왔을 때 고치면서 세운다(R7-3)
    if (sec && here.length) { for (const c of here) touch(c); line.coords = here; continue }
    if (act === 'same') continue
    if (sec && !(l0.kind || l0.gist)) { line.coords = []; continue } // 장부 밖 머리를 글만 고친다(짝은 다음에)
    // 짜임 머리 — 새 짝을 세우지 않는다(H-O13)
    if (isFrameHead(heading)) { skipped.push({ at, why: '짜임 머리는 항목으로 세우지 않는다(R1-4)' }); line.frame = true; continue }
    // 종류 — LLM 이 적은 것 · 비우면 그 문서의 패턴 줄 · 그 문서에서 같은 것의 하나가 쓰는 종류 · 성격의 씨앗 낱말
    const pk = patternKind(k, doc)
    let kind = nfc(String(l0.kind || '').trim())
    if (!kind) kind = pk || kindInDoc(k, doc) || (NATURES.includes(l0.nature) ? SEED_KINDS[l0.nature][0].kind : '')
    if (!kind) { err('kind', at, '종류가 없다: 「이 항목은 무엇의 하나인가」 의 낱말을 적는다(R5-1)'); continue }
    if (!TYPE_RE.test(kind)) { err('kind', at, `종류 「${kind}」 는 한 낱말이어야 한다(한글 · 영문 소문자 · 24자 안 · R5-1)`); continue }
    // 정규화가 같은 있는 종류로 바꿔 단다(「테이블」 과 「 테이블」 · 대소문자)
    const sameKind = [...kindsNow, ...newKinds.keys()].find((x) => x !== kind && sq(x) === sq(kind))
    if (sameKind) { fold.push({ what: 'kind', from: kind, to: sameKind, why: '같은 종류가 있다' }); kind = sameKind }
    const value = valueOf({ id: l0.id, heading })
    if (!value) { err('key', at, '열쇠를 지을 수 없다: 식별자(id)를 적거나 머리를 60자 안으로 줄인다(R5-2)'); continue }
    let coord = `${kind}:${value}`
    const taken = (c) => {
      if (made.has(c)) return made.get(c) !== at
      if (!k.vocab.coords.has(c)) return false
      const loc = locate(k.registry, c)
      // 자리 없는 옛 줄(H-O3 · R9-3) — 같은 열쇠면 그 줄에 자리를 채운다(겹침이 아니다)
      if (!loc) return false
      return !(loc.doc === doc && (nfc(loc.heading) === heading || headingMatches(heading, loc.heading)))
    }
    // 열쇠가 겹치면 문서 줄기를 앞에 붙인다(가름 · 다른 대상)
    if (taken(coord)) {
      const alt = `${kind}:${valueOf({ id: `${stemOf(doc)}_${value}` })}`
      if (!alt.endsWith(':') && !taken(alt)) { fold.push({ what: 'key', from: coord, to: alt, why: '같은 열쇠의 다른 항목이 있다: 문서 줄기를 붙였다' }); coord = alt }
      else { err('key', at, `열쇠 「${coord}」 가 다른 항목과 겹친다: 식별자(id)를 달리 적는다`); continue }
    }
    made.set(coord, at)
    line.coords = [coord]
    touch(coord)
    const fill = k.vocab.coords.has(coord) // 자리 없는 옛 줄에 자리 채움
    const gist = cleanGist(l0.gist)
    const aliases = (Array.isArray(l0.aliases) ? l0.aliases : []).map((a) => cleanGist(a).replace(/,/g, ' ')).filter((a) => a && sq(a) !== sq(value) && sq(a) !== sq(heading)).slice(0, 8)
    // 패턴 줄로 이미 닿는 머리에는 문서 장부 줄을 더하지 않는다(항목 장부 줄만)
    const byPattern = pk === kind && headingMatches(heading, value)
    names.push({ coord, label: fill ? k.vocab.coords.get(coord).label : heading.replace(/^[^:：]{1,60}[:：]\s+/, (m) => (valueOf({ heading }) === value && !l0.id ? '' : m)).slice(0, 160) || value, ...(fill ? {} : aliases.length ? { aliases } : {}), ...(byPattern ? {} : { doc: docId(doc), heading: sec ? sec.h : heading }), ...(gist && !fill ? { gist } : {}), ...(fill ? { fill: true } : {}) })
    if (!kindsNow.has(kind) && !newKinds.has(kind)) {
      const seed = seedKind(kind)
      const kg = seed ? '' : cleanGist(l0.kindGist)
      newKinds.set(kind, { name: kind, gist: seed?.gist || kg, seed: !!seed })
      // 씨앗이 아닌 새 종류의 뜻은 그 종류의 첫 항목 줄에 실어 보낸다(항목 장부의 「## 종류」 아래 「뜻:」 줄 · R5-1 라)
      if (kg) names[names.length - 1].kindGist = kg
    }
  }
  return { names, touches, natures, forms, kinds: [...newKinds.values()], lines: outLines, fold, skipped, errors }
}

// ── save 입력 2판(지식 생성 하네스 5-2 · H4c) → 저장 입력(record · sections · names · forms · natures · depart · judge) ──
//   LLM 은 알갱이마다 한 줄(items)과 새 문서(docs) · 뺀 것(skip)을 낸다. 값(열쇠) · names · touches · 문서 장부 줄 · 갈래 줄 · 문서 성격 줄은 엮기가 짓는다.
//   items: [{ doc, heading, act: 'edit' | 'new' | 'same', target?, kind?, kindGist?, id?, gist?, aliases?, nature?, base?, edits? | content?, judge?, first? }]
//   docs:  [{ path, nature, summary?, gather?: { aliases?, pattern? }, judge? }] · skip: [{ what, rule?, why }]
//   judge: { rule: ['R2-1'], prec: [{ of(열쇠), stance: follow | distinct | depart | na, differs?: id | kind | owner, owner?, against?, why? }], none?: 'all' | 'part' }
//   → { input, errors, skip, acts, fold, skipped, miss, empty, stances }
//   판단 칸의 꼴 흠(조문 번호 틀림 · 까닭 빔)은 막지 않고 센다(miss · H-D13). 이 함수는 판단이 옳은지 보지 않는다.
export const ITEMS_MAX = 50
const STANCE = { follow: '따름', distinct: '가름', depart: '벗어남', na: '해당 없음' }
const DIFFERS = { id: '식별자', kind: '종류', owner: '주인 대상' }
const one = (s, n) => nfc(String(s ?? '')).replace(/[\r\n`|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
const ruleOf = (x) => { const r = String(x || '').trim().replace(/^r/, 'R'); return isRuleId(r) ? r : null }
export function inputFromItems(k, input = {}) {
  const errors = []
  const err = (code, at, why) => errors.push({ code, at, why })
  const items = Array.isArray(input.items) ? input.items.filter((x) => x && typeof x === 'object') : []
  const docsIn = Array.isArray(input.docs) ? input.docs.filter((x) => x && typeof x === 'object' && typeof x.path === 'string') : []
  if (items.length > ITEMS_MAX) err('items', 'items', `한 저장에 항목은 ${ITEMS_MAX}개까지다: 묶음을 나눠 저장한다`)
  let miss = 0
  const stances = { shown: 0, follow: 0, distinct: 0, depart: 0, na: 0, none: { all: 0, part: 0 } }
  const judgeText = (j) => {
    const rules = (Array.isArray(j?.rule) ? j.rule : j?.rule ? [j.rule] : []).map((x) => { const r = ruleOf(x); if (!r) miss++; return r }).filter(Boolean).slice(0, 6)
    const prec = (Array.isArray(j?.prec) ? j.prec : []).filter((p) => p && typeof p === 'object' && p.of).slice(0, 8).map((p) => {
      const st = STANCE[p.stance] ? p.stance : null
      if (!st) { miss++; return null }
      stances.shown++
      stances[st]++
      const against = st === 'depart' ? ruleOf(p.against) : null
      const why = one(p.why, 120)
      if ((st === 'distinct' || st === 'depart') && !why) miss++
      if (st === 'depart' && !against) miss++
      if (st === 'distinct' && !DIFFERS[p.differs]) miss++
      const paren = [st === 'distinct' ? DIFFERS[p.differs] || '' : '', against || '', why].filter(Boolean).join(' · ')
      return `${one(p.of, 120)} ${STANCE[st]}${paren ? `(${paren})` : ''}`
    }).filter(Boolean)
    const none = j?.none === 'all' || j?.none === 'part' ? j.none : null
    if (none) stances.none[none]++
    if (!rules.length) miss++
    return { rules, prec, none, text: `${rules.join(' · ') || '조문 적지 않음'} · ${prec.join(' · ') || (none === 'all' ? '판례 없음' : none === 'part' ? '판례 없음(덮임이 잘렸다)' : '판례 적지 않음')}` }
  }
  const stanceIn = (j, st) => (Array.isArray(j?.prec) ? j.prec : []).some((p) => p?.stance === st)
  const lines = []
  const bodies = []
  const judges = []
  for (const it of items.slice(0, ITEMS_MAX)) {
    const act = ['edit', 'new', 'same'].includes(it.act) ? it.act : null
    let doc = typeof it.doc === 'string' ? it.doc : ''
    let heading = typeof it.heading === 'string' ? it.heading : ''
    // 자리 — doc · heading 또는 target(열쇠: 「종류:값」 · 「문서 › 머리」)
    if ((!doc || !heading) && typeof it.target === 'string' && it.target.trim()) {
      const t = nfc(it.target.trim())
      if (t.includes(' › ')) { doc = t.slice(0, t.indexOf(' › ')); heading = t.slice(t.indexOf(' › ') + 3) }
      else {
        const s = sectionOf(k, t)
        if (!s?.loc) { err('target', t, `「${t}」 는 문서에 자리가 없는 열쇠다: doc · heading 으로 가리킨다`); continue }
        doc = s.loc.doc
        heading = s.sec?.h || s.loc.heading
      }
    }
    const at = `${docId(doc)} › ${heading}`
    if (!act) { err('act', at, 'act 는 edit(고침) · new(새 항목) · same(그대로) 가운데 하나다') ; continue }
    if (!doc || !heading) { err('place', at, '문서(doc)와 머리(heading)가 있어야 한다') ; continue }
    if (act === 'new' && typeof it.content !== 'string') { err('content', at, '새 항목은 글 전체(content)로 보낸다') ; continue }
    if (act === 'edit' && !(Array.isArray(it.edits) && it.edits.length) && typeof it.content !== 'string') { err('content', at, '고침은 바꿀 곳(edits)이나 새 글 전체(content)로 보낸다') ; continue }
    lines.push({ doc, heading: nfc(heading.trim()).replace(/^#{1,6}\s+/, ''), act, kind: it.kind, kindGist: it.kindGist, id: it.id, gist: it.gist, aliases: it.aliases, nature: it.nature })
    bodies.push(act === 'same' ? null : { ...(it.base ? { base: String(it.base) } : {}), ...(Array.isArray(it.edits) && it.edits.length ? { edits: it.edits } : { content: it.content }) })
    judges.push(it.judge || null)
  }
  const w = weave(k, { lines, docs: docsIn.map((d) => ({ path: d.path, nature: d.nature, summary: d.summary, gather: d.gather, depart: stanceIn(d.judge, 'depart') })) })
  errors.push(...w.errors)
  const sections = []
  const judge = []
  const distinct = [...(Array.isArray(input.distinct) ? input.distinct : [])]
  const acts = { edit: 0, new: 0, same: 0, skip: 0, doc: 0 }
  w.lines.forEach((l, i) => {
    acts[l.act]++
    if (bodies[i]) sections.push({ doc: l.doc, heading: l.heading, ...bodies[i] })
    const jt = judgeText(judges[i])
    judge.push(`${l.act === 'new' ? '새 항목' : l.act === 'edit' ? '고침' : '그대로'} ${docId(l.doc)} › ${l.heading}: ${jt.text}`)
    // 가름 — 이름은 닿지만 다른 대상이다: 비슷한 이름 검사를 넘는다(옛 입력의 distinct 와 같다)
    if (stanceIn(judges[i], 'distinct')) distinct.push(l.heading, ...(l.coords || []))
  })
  const depart = []
  for (const d of docsIn) {
    const id = docId(d.path)
    if (w.fold.some((f) => f.what === 'doc' && f.from === id)) continue
    if (k.byDocPath?.get(docPath(d.path))) continue
    acts.doc++
    const jt = judgeText(d.judge)
    judge.push(`새 문서 ${id}: ${jt.text}`)
    if (stanceIn(d.judge, 'depart') || stanceIn(d.judge, 'distinct')) { depart.push(id); distinct.push(stemOf(d.path)) }
  }
  const skip = (Array.isArray(input.skip) ? input.skip : []).filter((x) => x && typeof x === 'object' && x.what).slice(0, 50).map((x) => ({ what: one(x.what, 120), rule: ruleOf(x.rule), why: one(x.why, 200) }))
  acts.skip = skip.length
  for (const s of skip) judge.push(`뺌 ${s.what}: ${s.rule || '조문 적지 않음'}${s.why ? ` · ${s.why}` : ''}`)
  // 기록 — 건드린 항목은 엮기가 지은 것과 합친다 · 근거 날짜(asOf · 넣을 것이 말하는 때)는 근거 칸의 한 줄로
  const rec = input.record && typeof input.record === 'object' && !Array.isArray(input.record) ? { ...input.record } : input.record
  if (rec && typeof rec === 'object') {
    const touches = [...new Set([...(Array.isArray(rec.touches) ? rec.touches : []), ...w.touches])]
    if (touches.length) { rec.touches = touches; delete rec.touchesEmpty }
    if (rec.body == null && typeof rec.summary === 'string') rec.body = rec.summary
    delete rec.summary
    if (rec.asOf != null) {
      const d = /^\d{4}-\d{2}-\d{2}$/.test(String(rec.asOf).trim()) ? String(rec.asOf).trim() : null
      if (d) rec.refs = [...(Array.isArray(rec.refs) ? rec.refs : []), `근거 날짜: ${d}`]
      delete rec.asOf
    }
  }
  const { items: _i, docs: _d, skip: _s, ...rest } = input
  const out = { ...rest, record: rec, sections, ...(w.names.length ? { names: w.names } : {}), ...(w.forms.length ? { forms: w.forms } : {}), ...(w.natures.length ? { natures: w.natures } : {}), ...(depart.length ? { depart } : {}), ...(distinct.length ? { distinct: [...new Set(distinct.map(String))] } : {}), ...(judge.length ? { judge } : {}) }
  // 쓸 것이 없다 — 모두 뺌이거나 모두 그대로(R6-3 · H-D26): 아무것도 쓰지 않고 잰다
  const empty = !sections.length && !w.names.length && !w.forms.length && !w.natures.length && (skip.length > 0 || acts.same > 0)
  return { input: out, errors, skip, acts, fold: w.fold, skipped: w.skipped, miss, empty, stances }
}
