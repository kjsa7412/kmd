// 짝 짓기(엮기) — 판정 한 줄에서 섹션(## 머리) · 항목 장부 줄(뜻 한 줄 gist) · 문서 장부 줄 · 건드린 항목 · 문서 성격 줄 · 사건 열쇠를 같이 짓는다.
//
//   지식 생성 하네스 H-D11 · H-D17(다) · H-O5 · H-O13 · 설계 5-1 걸음 3 · 6절. 부르는 곳: core/ingest.js · kmd-migrate put.
//   save 입력 2판(items · docs · skip)을 저장 입력으로 바꾸던 inputFromItems 는 걷었다(옛잔재 O-11 · 저장 입력은 sections · names · forms 하나).
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
import { NATURES, SEED_KINDS, seedKind } from './genrules.js'

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

// 문서 요약 — 「이 문서는 무엇을 어떤 단위로 적나」 1 ~ 3문장(R3-4) · 한 줄 · 300자 · 문서 성격 표의 요약 칸과 새 문서 글의 `# 제목` 아래에 선다
export const SUMMARY_MAX = 300
export const cleanSummary = (s) => nfc(String(s ?? '')).replace(/[\r\n`|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX)

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
    if (nature) natures.push({ doc: docId(path), nature, summary: cleanSummary(d.summary) })
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
      // 자리 없는 장부 줄은 다른 항목이다(자리 채움은 걷었다 · O-2)
      if (!loc) return true
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
    // 같은 자리에 이미 선 장부 항목 — 새로 세우지 않는다(건드린 항목으로만)
    if (k.vocab.coords.has(coord)) continue
    const gist = cleanGist(l0.gist)
    const aliases = (Array.isArray(l0.aliases) ? l0.aliases : []).map((a) => cleanGist(a).replace(/,/g, ' ')).filter((a) => a && sq(a) !== sq(value) && sq(a) !== sq(heading)).slice(0, 8)
    // 패턴 줄로 이미 닿는 머리에는 문서 장부 줄을 더하지 않는다(항목 장부 줄만)
    const byPattern = pk === kind && headingMatches(heading, value)
    names.push({ coord, label: heading.replace(/^[^:：]{1,60}[:：]\s+/, (m) => (valueOf({ heading }) === value && !l0.id ? '' : m)).slice(0, 160) || value, ...(aliases.length ? { aliases } : {}), ...(byPattern ? {} : { doc: docId(doc), heading: sec ? sec.h : heading }), ...(gist ? { gist } : {}) })
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
