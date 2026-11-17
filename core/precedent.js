// 과거 결정 카드(판례 묶음) — 넣을 것(원천)에 걸리는 장부의 과거 결정을 LLM 에게 보일 카드로 짓는다(지식 생성 하네스 H-D5 ~ H-D8 · H-D27 · 설계 4절).
//
//   장부는 과거 결정이고 따를지는 LLM 이 맡는다. 이 함수는 「무엇이 걸리는가」 만 결정적으로 찾는다(판정이 아니다 · 저장 줄에서 다시 짓지 않는다 · H-D12).
//   모든 채널이 같은 카드를 받는다: MCP `match` · `brief` 응답(server/mcp.js). 카드는 번호가 아니라 안정된 열쇠로 가리킨다(H-D6).
//   기록 모음과 옛 규칙 길 문서(`들인 자료/`)는 과거 결정에서 뺀다(R9-4: 원문 재료다).
//
//   precedentsFor(k, { q, text }) → { cards, prior, coverage, toc, none }
//     q    — 찾을 이름(글 하나 또는 목록) · text — 원천 본문(거꾸로 대기 · 뜻 맞춤 · 앞선 값에 쓴다 · 없어도 된다)
//     cards — [{ type(정체 · 놓임 · 꼴), via(걸린 길), key, ... }] 이름 맞음 → 비슷함 → 원천에 나옴 → 낱말 차례
//     prior — 앞선 값(판례가 아니다 · R2-5 의 근거 날짜를 읽는 데만)
//     coverage — 덮임 줄: 이름으로는 전수(견준 이름 수) · 뜻으로는 상위 N(잘렸나)

import { sha16, nfc } from './text.js'
import { sectionOf, coordsOfSection } from './knowledge.js'
import { resolveName, RECORDS_DOC_PATH, INTAKE_FORM, GATHER_KINDS, NEAR_RATIO } from './guard.js'
import { kindOf } from './forms.js'
import { normKey, wordsOf, COMMON } from './search.js'
import { SEED_KINDS, NATURES, seedKind } from './genrules.js'

export const CARD_BODY = 1500 // 글과 base 를 싣는 카드의 글 길이
export const BODY_CARDS = 5 // 글을 싣는 카드 수(이름 맞음 · 비슷함 위에서부터)
export const GIST_CARDS = 3 // 뜻(낱말)으로 싣는 카드 수
export const ID_CARDS = 120 // (2026-11-17 60 → 120: DPMS 의 recall 0.72 → 0.81 · 카드 글의 가운데 크기는 그대로 2만 7천 자 · 가장 큰 응답 4만 5천 자) · 정체 카드 상한(넘으면 잘림으로 적는다 · 글을 싣는 것은 BODY_CARDS 뿐이라 카드 하나는 한두 줄이다)
export const DOC_CARDS = 8
export const PRIOR_CARDS = 5
export const TOC_MAX = 300 // 목차를 전부 싣는 지식의 머리 수

const docId = (p) => String(p).replace(/^docs\/|\.md$/g, '')
const isRaw = (d) => d.path === RECORDS_DOC_PATH || docId(d.path).startsWith(`${INTAKE_FORM}/`)
const firstSentence = (body) => {
  const l = String(body || '').split('\n').map((x) => x.trim()).find((x) => x && !/^(?:[|#>]|```|~~~|[-*]s|d+[.)]s|<!--)/.test(x)) || ''
  const m = /^(.{8,}?[.。!?다])(\s|$)/.exec(l)
  return (m ? m[1] : l).replace(/[`|]/g, '').slice(0, 80)
}
const gistOf = (v, sec) => v?.gist || firstSentence(sec?.body)

// 지식마다 한 번 — 이름 표(장부 줄 · 장부 밖 머리 · 문서 제목)와 항목 안의 이름(표 첫 열 · 굵은 라벨 · 정의 목록)
const cache = new WeakMap()
function tableOf(k) {
  if (cache.has(k)) return cache.get(k)
  const ids = [] // { key, coord?, doc, heading, label, keys[], vkeys[](값 · 라벨 · 별칭 따로), noPlace }
  for (const [coord, v] of k.vocab.coords) {
    if (v.deprecated) continue
    const s = sectionOf(k, coord)
    if (s?.doc && isRaw(s.doc)) continue
    const value = coord.slice(coord.indexOf(':') + 1)
    const names = [value, v.label, ...v.aliases].filter(Boolean)
    ids.push({ key: coord, coord, doc: s?.doc?.id || null, heading: s?.sec?.h || s?.loc?.heading || null, sec: s?.sec || null, docObj: s?.doc || null, label: v.label, v, names, keys: [...new Set(names.map(normKey).filter(Boolean))], noPlace: !s?.loc })
  }
  const outside = []
  const inner = new Map() // 정규화 이름 → [{ doc, heading }]
  const docs = []
  let heads = 0
  for (const d of k.docs) {
    if (isRaw(d)) continue
    docs.push(d)
    for (const s of d.sections) {
      if (!s.h) continue
      heads++
      if (!coordsOfSection(k, d, s.h).length) outside.push({ key: `${d.id} › ${s.h}`, coord: null, doc: d.id, heading: s.h, sec: s, docObj: d, label: s.h, names: [s.h], keys: [normKey(s.h), normKey(s.h.replace(/^[^:：]{1,60}[:：]\s+/, ''))].filter(Boolean), outside: true })
      // 항목 안의 이름 — 표 첫 열 · 굵은 라벨 · 「- 이름: 설명」
      for (const line of s.body.split('\n')) {
        const cell = /^\|\s*`?([^|`]{2,40}?)`?\s*\|/.exec(line)?.[1]
        const bold = /^\s*[-*]?\s*\*\*([^*]{2,40})\*\*/.exec(line)?.[1]
        const def = /^\s*[-*]\s+`?([^:：`]{2,40}?)`?\s*[:：]\s+\S/.exec(line)?.[1]
        for (const x of [cell, bold, def]) {
          const n = normKey(x || '')
          if (n.length < 3 || /^[-:]+$/.test(String(x).trim()) || COMMON.has(String(x).trim())) continue
          if (!inner.has(n)) inner.set(n, [])
          const a = inner.get(n)
          if (a.length < 4 && !a.some((y) => y.doc === d.id && y.heading === s.h)) a.push({ doc: d.id, heading: s.h, name: String(x).trim() })
        }
      }
    }
  }
  const out = { ids, outside, inner, docs, heads }
  cache.set(k, out)
  return out
}

const recParts = (body, head) => {
  const L = String(body || '').split('\n')
  const a = L.findIndex((l) => l.trim() === `## ${head}`)
  if (a < 0) return []
  const out = []
  for (let i = a + 1; i < L.length && !/^## /.test(L[i]); i++) if (L[i].trim()) out.push(L[i].replace(/^\s*[-*]\s+/, '').trim())
  return out
}
// 기록의 근거 날짜(H-D27 · `## 근거` 칸의 「근거 날짜: YYYY-MM-DD」 줄 · H4c 부터 선다) — 없으면 모름
export const asOfOf = (w) => /근거 날짜\s*[:：]\s*(\d{4}-\d{2}-\d{2})/.exec(recParts(w?.body, '근거').join('\n'))?.[1] || null

export function precedentsFor(k, { q = null, text = '', cap = null } = {}) {
  const T = tableOf(k)
  const terms = [...new Set([].concat(q || []).map((x) => String(x || '').trim()).filter(Boolean))]
  const src = nfc(String(text || ''))
  // 원천의 머리 줄도 찾을 이름이다
  for (const m of src.matchAll(/^#{1,3}\s+(.+)$/gm)) { const h = m[1].replace(/^\d+(\.\d+)*[.)]?\s+/, '').trim(); if (h && !terms.includes(h)) terms.push(h) }
  const tn = terms.map(normKey).filter(Boolean)
  const srcN = normKey(src)
  const hits = new Map() // key → { x, via, rank }
  const put = (x, via, rank) => { const h = hits.get(x.key); if (!h || rank < h.rank) hits.set(x.key, { x, via, rank }) }
  const via = { name: 0, near: 0, reverse: 0, gist: 0 }
  for (const x of [...T.ids, ...T.outside]) {
    // 이름 — 정규화 같음
    if (x.keys.some((key) => tn.includes(key))) { put(x, x.outside ? '장부 밖 머리' : x.noPlace ? '자리 없는 줄' : '이름 맞음', 0); continue }
    // 품기 — 한쪽이 다른 쪽을 품고 길이 비가 0.75 이상
    if (x.keys.some((key) => key.length >= 2 && tn.some((n) => n.length >= 2 && (n.includes(key) || key.includes(n)) && Math.min(n.length, key.length) / Math.max(n.length, key.length) >= NEAR_RATIO))) { put(x, '비슷함', 1); continue }
    // 거꾸로 — 장부의 값 · 라벨 · 별칭(2자 이상 · 흔한 말 뺌)이 원천 본문에 통째로 나온다.
    //   뚜렷한 이름이 앞에 선다: 걸린 이름이 길수록 · 식별자(값)일수록 · 여러 번 나올수록(흔한 짧은 말이 카드 자리를 차지하지 않게)
    if (srcN) {
      let best = 0
      x.names.forEach((nm, i) => {
        const n = normKey(nm)
        if (n.length < 2 || COMMON.has(String(nm).trim()) || !(n.length >= 3 || /[가-힣]{2}/.test(nm)) || !srcN.includes(n)) return
        const times = Math.min(3, srcN.split(n).length - 1)
        best = Math.max(best, n.length + (i === 0 && x.coord ? 4 : 0) + times)
      })
      if (best) put(x, '원천에 나옴', 2 + 1 / (1 + best))
    }
  }
  // 거꾸로(항목 안의 이름) — 있는 항목 글의 표 첫 열 · 굵은 라벨 · 정의 이름이 원천에 나오면 그것을 가진 항목
  if (srcN) {
    for (const [n, at] of T.inner) {
      if (!srcN.includes(n) && !tn.includes(n)) continue
      for (const a of at) {
        const x = T.ids.find((y) => y.doc === a.doc && y.heading === a.heading) || T.outside.find((y) => y.doc === a.doc && y.heading === a.heading)
        if (x && !hits.has(x.key)) put({ ...x, innerName: a.name }, '원천에 나옴', 2.6 + 1 / (1 + n.length))
      }
    }
  }
  // 뜻 — 뜻 한 줄(없으면 항목 글 첫 문장) + 이름 낱말이 원천의 낱말과 겹치는 위 셋
  const words = new Set(wordsOf(`${terms.join(' ')} ${src.slice(0, 20_000)}`))
  let gistTotal = 0
  if (words.size) {
    const scored = []
    for (const x of T.ids) {
      if (hits.has(x.key)) continue
      const ws = wordsOf(`${gistOf(x.v, x.sec)} ${x.label}`)
      const n = ws.filter((w) => words.has(w)).length
      if (n >= 2 || (n === 1 && ws.length <= 3)) scored.push({ x, n })
    }
    gistTotal = scored.length
    scored.sort((a, b) => b.n - a.n || a.x.key.localeCompare(b.x.key))
    for (const s of scored.slice(0, GIST_CARDS)) put(s.x, '낱말', 3)
  }
  const ranked = [...hits.values()].sort((a, b) => a.rank - b.rank || a.x.key.localeCompare(b.x.key))
  const CAP = Number.isFinite(cap) || cap === Infinity ? cap : ID_CARDS // cap — 재기에서만 쓴다(상한 없이 「이름이 글에 있는 것」 을 센다)
  const cut = ranked.length > CAP
  const shown = ranked.slice(0, CAP)
  let bodies = 0
  const cards = shown.map(({ x, via: how, rank }) => {
    via[rank === 0 ? 'name' : rank === 1 ? 'near' : rank < 3 ? 'reverse' : 'gist']++ // 2.x 는 거꾸로 대기(뚜렷함으로 매긴 차례)
    const nature = x.docObj ? kindOf(k.forms, x.docObj.id) : null
    const withBody = rank <= 1 && x.sec && bodies < BODY_CARDS && ++bodies
    return {
      type: '정체', via: how, key: x.key,
      ...(x.coord ? { coord: x.coord, label: x.label, kind: x.coord.slice(0, x.coord.indexOf(':')) } : {}),
      ...(x.doc ? { doc: x.doc, heading: x.heading } : {}),
      ...(x.v?.aliases?.length ? { aliases: x.v.aliases.slice(0, 8) } : {}),
      ...(gistOf(x.v, x.sec) ? { gist: gistOf(x.v, x.sec), ...(x.v?.gist ? {} : { gistFrom: '첫 문장' }) } : {}),
      ...(nature ? { nature: nature.kind, ...(nature.guess ? { natureGuess: true } : {}) } : {}),
      ...(x.innerName ? { inner: x.innerName } : {}),
      ...(x.sec ? { base: sha16(x.sec.body) } : {}),
      ...(withBody ? { body: x.sec.body.slice(0, CARD_BODY), ...(x.sec.body.length > CARD_BODY ? { bodyCut: true } : {}) } : {}),
    }
  })
  // 놓임 — 주제 낱말이 겹치는 문서 · 모으는 갈래 전부
  const docScore = T.docs.map((d) => {
    const ws = wordsOf(`${d.title} ${docId(d.path).split('/').pop()}`)
    const hit = cards.some((c) => c.doc === d.id)
    return { d, n: ws.filter((w) => words.has(w)).length + (hit ? 2 : 0) }
  }).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.d.id.localeCompare(b.d.id))
  const small = T.heads <= TOC_MAX
  for (const { d } of (small && T.docs.length <= DOC_CARDS ? T.docs.map((x) => ({ d: x })) : docScore).slice(0, DOC_CARDS)) {
    const n = kindOf(k.forms, d.id)
    const sum = k.forms.natures?.get(d.id)?.summary || firstSentence(d.intro || '')
    cards.push({ type: '놓임', via: '문서', key: d.id, doc: d.id, title: d.title, nature: n.kind, ...(n.guess ? { natureGuess: true } : {}), ...(sum ? { summary: sum } : {}), items: d.sections.filter((s) => s.h).length, heads: d.sections.filter((s) => s.h).map((s) => s.h).slice(0, 6) })
  }
  for (const f of k.forms.rows) if (GATHER_KINDS.includes(f.kind)) cards.push({ type: '놓임', via: '모으는 갈래', key: f.name, name: f.name, nature: f.kind, ...(f.aliases?.length ? { aliases: f.aliases } : {}), ...(f.folder ? { folder: f.folder } : {}), ...(f.pattern ? { pattern: f.pattern } : {}), head: f.kind === '사건' ? '「YYYY-MM-DD 주제」' : f.pattern ? '「값: 설명」' : '주제 이름' })
  // 꼴 — 종류마다 한 줄(뜻 · 항목 수 · 사는 문서)
  const byKind = new Map()
  for (const x of T.ids) {
    const t = x.coord.slice(0, x.coord.indexOf(':'))
    if (!byKind.has(t)) byKind.set(t, { n: 0, docs: new Map() })
    const e = byKind.get(t)
    e.n++
    if (x.doc) e.docs.set(x.doc, (e.docs.get(x.doc) || 0) + 1)
  }
  for (const [t, e] of [...byKind.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, 60)) {
    const g = k.vocab.kinds?.get(t) || seedKind(t)?.gist || ''
    cards.push({ type: '꼴', via: '종류', key: t, kind: t, ...(g ? { gist: g } : {}), items: e.n, docs: [...e.docs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d) })
  }
  // 앞선 값(판례가 아니다) — 걸린 항목의 이름이 기록의 「바뀐 것」 줄 · 사건 항목 글에 나온다 → 그 값과 근거 날짜
  const prior = []
  const named = shown.filter((h) => h.rank < 2.6).map((h) => h.x)
  if (named.length) {
    const want = named.flatMap((x) => x.names.map((nm) => ({ n: normKey(nm), key: x.key })).filter((y) => y.n.length >= 2))
    for (const w of k.works) {
      if (prior.length >= PRIOR_CARDS) break
      for (const line of recParts(w.body, '바뀐 것')) {
        const ln = normKey(line)
        const hit = want.find((y) => ln.includes(y.n))
        if (!hit || !/\d/.test(line)) continue
        prior.push({ of: hit.key, line: line.slice(0, 200), asOf: asOfOf(w), entered: String(w.date || '').slice(0, 10), record: w.id })
        if (prior.length >= PRIOR_CARDS) break
      }
    }
    for (const d of T.docs) {
      if (prior.length >= PRIOR_CARDS) break
      if (kindOf(k.forms, d.id).kind !== '사건') continue
      for (const s of d.sections) {
        if (!s.h || prior.length >= PRIOR_CARDS) continue
        for (const line of s.body.split('\n')) {
          const ln = normKey(line)
          const hit = want.find((y) => ln.includes(y.n) && y.key !== `${d.id} › ${s.h}`)
          if (!hit || !/\d/.test(line) || prior.some((p) => p.line === line.trim().slice(0, 200))) continue
          prior.push({ of: hit.key, line: line.trim().replace(/^[-*]\s+/, '').slice(0, 200), asOf: /^(\d{4}-\d{2}-\d{2})/.exec(s.h)?.[1] || null, at: `${d.id} › ${s.h}` })
          if (prior.length >= PRIOR_CARDS) break
        }
      }
    }
  }
  const namesN = T.ids.reduce((a, x) => a + x.keys.length, 0) + T.outside.length + T.docs.length
  const idn = cards.filter((c) => c.type === '정체').length
  const coverage = {
    names: namesN, // 이름으로는 전수: 장부 값 · 라벨 · 별칭 · 장부 밖 머리 · 문서 제목을 다 댔다
    items: T.ids.length, outside: T.outside.length, docs: T.docs.length,
    shown: idn, ...(cut ? { cut: ranked.length - CAP } : {}),
    gist: { shown: Math.min(GIST_CARDS, gistTotal), of: gistTotal, cut: gistTotal > GIST_CARDS },
    via,
    line: `이름으로는 전수 ${namesN} · 뜻으로는 상위 ${Math.min(GIST_CARDS, gistTotal)} / ${gistTotal}${gistTotal > GIST_CARDS || cut ? ' 잘림' : ''} · 맞춘 길: 이름 ${via.name} · 비슷함 ${via.near} · 원천에 나옴 ${via.reverse} · 낱말 ${via.gist}`,
  }
  const none = idn ? null : T.ids.length + T.outside.length + T.docs.length === 0 ? '판례 없음(이 지식에 항목 0 · 문서 0): 조문만으로 정한다(R9-1)' : `판례 없음(항목 ${T.ids.length + T.outside.length} 을 이름으로 다 댔다 · 맞은 것 0)${gistTotal > GIST_CARDS ? ' · 뜻으로는 잘렸다' : ''}`
  // 목차 — 작은 지식은 문서 › 머리 전부 · 큰 지식은 카드가 걸린 문서만
  const tocDocs = small ? T.docs : T.docs.filter((d) => cards.some((c) => c.doc === d.id))
  const toc = tocDocs.slice(0, 60).map((d) => ({ doc: d.id, headings: d.sections.filter((s) => s.h).map((s) => s.h).slice(0, 120) }))
  return { cards, prior, coverage, toc, ...(none ? { none } : {}), ...(small ? {} : { tocCut: true }) }
}

// 씨앗 종류 카드(빈 지식에서도 보인다 · 장부가 아니라 룰 데이터에서) — brief 의 새 칸
export const seedKindCards = () => NATURES.flatMap((n) => SEED_KINDS[n].map((s) => ({ nature: n, kind: s.kind, gist: s.gist })))
