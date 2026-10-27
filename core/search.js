// 찾기 사다리 — 말 → 정리된 항목 후보와 자리 없는 글의 토막(v0.6 §4).
//
//   0 다듬기        normKey(소문자 · 빈칸 · 문장부호 뺌) · 그래도 없으면 끝 조사 떼기(뗀 뒤 2자 이상)
//   1 정확한 이름    다듬지 않은 normKey 가 이름 · 값 · 다른 이름 · 항목 머리와 같다 → 확정. 「없다」 는 여기서만 말한다
//   2 이름 품기      말이 이름을 품음 · 이름이 말을 품음(80% 이상) · 조사를 떼고서야 맞음 · 배운 이름 → 약함(weak)
//   3 낱말 — 정리된 자리   이름 하나 = 카드 하나 · BM25 · 조건 「질문 낱말의 절반」 또는 「말 하나가 통째로 든 항목」
//   4 낱말 — 글 토막       모든 md 를 머리 단위 1,200자 토막으로(표는 행 경계 · 머리 행을 붙인다) · 조건 「질문 낱말의 절반」
//
// 약속 넷 — ① 범위는 참/거짓 조건, 점수는 순서에만(RRF) ② 「조건에 든 n개 중 k개 · 나머지 · 규칙」 을 늘 말한다
// ③ 이름이 있는 토막은 그 이름(정본 항목)으로 바꿔 낸다 ④ 2 ~ 4단이 빈손이면 「없다」 가 아니라 exhaustive:false.
// 정렬은 (점수 반올림 → 경로 → 줄)로 고정한다 — 팀(리눅스)과 PC(윈도)가 같은 순서를 낸다.

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readText, nfc } from './text.js'
import { headsOf, headingMatches } from './sections.js'
import { locate } from './registry.js'
import { labelOf, sectionOf, coordsOfSection } from './knowledge.js'

export const INDEX_VERSION = 3
const CHUNK = 1200
const MAX_FILE = 4 << 20

// ── 말 다듬기 ──
export const normKey = (s) => nfc(String(s ?? '')).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
const JOSA = ['으로부터', '에서는', '으로는', '에게서', '으로', '에서', '에게', '까지', '부터', '처럼', '보다', '이랑', '하고', '은', '는', '이', '가', '을', '를', '에', '의', '로', '와', '과', '도', '만', '랑']
export function stripJosa(w) {
  const n = normKey(w)
  for (const j of JOSA) if (n.endsWith(j) && n.length - j.length >= 2) return n.slice(0, -j.length)
  return n
}
// 일반 말 — 대상을 가리키지 않는 말(동사 꼬리 · 흔한 말). 기록 제목의 5% 이상에 나오는 말은 지식마다 더한다
export const COMMON = new Set(['수정', '추가', '변경', '삭제', '개선', '정리', '확인', '작업', '관련', '처리', '반영', '적용', '등록', '문제', '오류', '내용', '방법', '어떻게', '무엇', '언제', '어디', '왜', '하기', '했다', '한다', '하는', '있다', '없다', '대한', '위한', '그리고', '또는'])

export function wordsOf(q, common = COMMON) {
  const raw = nfc(String(q ?? '')).split(/[\s,.;:!?()[\]{}"'`·…/\\|<>~=+*&^%$#@—–-]+/u).filter(Boolean)
  const out = []
  for (const w of raw) {
    const n = normKey(w)
    if (n.length < 2 && !/[a-z0-9]/.test(n)) continue
    if (common.has(n) || common.has(stripJosa(w))) continue
    if (!out.includes(n)) out.push(n)
  }
  return out
}

// 낱말표 토큰 — 한글은 2글자 조각, 영문 · 숫자는 낱말. 덩어리(말 전체) 토큰은 두지 않는다(AND · 덮는 비율의 분모에서 뺀다)
export function tokens(text) {
  const out = []
  for (const run of nfc(String(text)).toLowerCase().matchAll(/[\p{Script=Hangul}]+|[a-z0-9]+/gu)) {
    const r = run[0]
    if (/^[a-z0-9]+$/.test(r)) {
      if (r.length >= 2) out.push(r)
    } else if (r.length === 1) out.push(r)
    else for (let i = 0; i < r.length - 1; i++) out.push(r.slice(i, i + 2))
  }
  return out
}
const tf = (toks) => {
  const m = {}
  for (const t of toks) m[t] = (m[t] || 0) + 1
  return m
}

// 말이 글에 들었나(참/거짓) — 빈칸을 무시한 부분 일치(「결의서」 → 지출결의서 · 「승인단계」 → 승인 단계)
const hitIn = (normText, w) => normText.includes(w)

// ── 토막 자르기 ──
// 머리(#)마다 덩어리 → 표는 행 경계에서 자르고 토막마다 머리 줄과 표 머리 행을 붙인다 · 긴 문단은 문장 경계에서
export function chunkText(text) {
  const lines = readText(text).split('\n')
  const heads = headsOf(lines)
  const blocks = []
  let start = 0
  const marks = heads.map((h) => h.line).filter((x) => x > 0)
  for (const m of [...marks, lines.length]) {
    if (m > start) blocks.push([start, m])
    start = m
  }
  const out = []
  for (const [a, b] of blocks) {
    const h = heads.find((x) => x.line === a)
    const headLine = h ? lines[a] : ''
    let cur = { a, lines: [], size: 0, pre: [] }
    const flush = () => {
      if (cur.lines.some((l) => l.trim())) out.push({ a: cur.a, b: cur.a + cur.lines.length - 1, head: h ? h.heading : '', text: [...cur.pre, ...cur.lines].join('\n') })
    }
    let tableHead = null
    for (let i = a; i < b; i++) {
      const line = lines[i]
      const isRow = /^\s*\|/.test(line)
      if (isRow && !tableHead && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) tableHead = [line, lines[i + 1]]
      if (!isRow) tableHead = null
      const pieces = !isRow && line.length > CHUNK ? line.split(/(?<=[.!?。]|다\.)\s+/) : [line]
      for (const piece of pieces) {
        if (cur.size + piece.length + 1 > CHUNK && cur.lines.length) {
          flush()
          const pre = [headLine, ...(isRow && tableHead && !tableHead.includes(line) ? tableHead : [])].filter(Boolean)
          cur = { a: i, lines: [], size: pre.join('\n').length, pre }
        }
        cur.lines.push(piece)
        cur.size += piece.length + 1
      }
    }
    flush()
  }
  return out
}

// ── 색인 — `<data>/index/<지식>/index.json` · 파일 지문(크기 + mtime → 다르면 sha1)으로 바뀐 파일만 다시 ──
const sha1 = (t) => crypto.createHash('sha1').update(t).digest('hex')
const idxFile = (dataDir, id) => path.join(dataDir, 'index', encodeURIComponent(id), 'index.json')

function coordOfLine(k, p, lineNo, heads) {
  if (!p.startsWith('docs/')) return null
  const doc = k.byDocPath.get(p)
  if (!doc) return null
  let h2 = null
  for (const h of heads) if (h.level === 2 && h.line <= lineNo && lineNo < h.end) h2 = h
  if (!h2) return null
  return coordsOfSection(k, doc, h2.heading)[0] || null
}

export async function buildIndex(k, { dataDir = null, prev = null } = {}) {
  const files = [...k.docs.map((d) => d.path), ...k.works.map((w) => w.path)].sort()
  const regSig = sha1(JSON.stringify([k.registry.rows, [...k.vocab.coords.keys()].sort()]))
  const old = prev || (dataDir ? await fs.readFile(idxFile(dataDir, k.id), 'utf8').then(JSON.parse, () => null) : null)
  const reuse = old && old.v === INDEX_VERSION && old.regSig === regSig ? old.files : {}
  const out = { v: INDEX_VERSION, regSig, files: {} }
  let changed = !old || old.v !== INDEX_VERSION || old.regSig !== regSig
  for (const p of files) {
    const full = path.join(k.dir, ...p.split('/'))
    const st = await fs.stat(full).catch(() => null)
    if (!st || st.size > MAX_FILE) continue
    const o = reuse[p]
    if (o && o.size === st.size && o.mtimeMs === st.mtimeMs) {
      out.files[p] = o
      continue
    }
    const text = readText(await fs.readFile(full, 'utf8'))
    const h = sha1(text)
    if (o && o.sha1 === h) {
      out.files[p] = { ...o, mtimeMs: st.mtimeMs }
      continue
    }
    changed = true
    const heads = headsOf(text.split('\n'))
    const kind = p.startsWith('work/') ? 'rec' : 'doc'
    const chunks = chunkText(text).map((c) => {
      const toks = tokens(c.text)
      return { a: c.a, b: c.b, h: c.head, coord: kind === 'doc' ? coordOfLine(k, p, c.a, heads) : null, n: toks.length, tf: tf(toks) }
    })
    out.files[p] = { size: st.size, mtimeMs: st.mtimeMs, sha1: h, kind, chunks }
  }
  if (Object.keys(reuse).some((p) => !out.files[p])) changed = true // 지운 파일의 옛 토막
  if (dataDir && changed) {
    const f = idxFile(dataDir, k.id)
    await fs.mkdir(path.dirname(f), { recursive: true })
    await fs.writeFile(f + '.tmp', JSON.stringify(out), { mode: 0o600 })
    await fs.rename(f + '.tmp', f)
  }
  return out
}

// 토막 글은 색인에 두지 않고 지금 파일에서 읽는다 — 지문(sha1)이 같으면 읽은 것을 다시 쓴다(300 파일까지)
const textCache = new Map()
async function linesOf(k, p, sha) {
  const key = `${k.dir}|${p}`
  const hit = textCache.get(key)
  if (hit && hit.sha === sha) return hit
  const lines = readText(await fs.readFile(path.join(k.dir, ...p.split('/')), 'utf8').catch(() => '')).split('\n')
  const v = { sha, lines, norms: new Map() }
  textCache.delete(key)
  textCache.set(key, v)
  if (textCache.size > 300) textCache.delete(textCache.keys().next().value)
  return v
}

// ── BM25(순서에만) ──
function bm25(qtoks, docs) {
  const N = docs.length || 1
  const df = {}
  let total = 0
  for (const d of docs) {
    total += d.n
    for (const t of new Set(qtoks)) if (d.tf[t]) df[t] = (df[t] || 0) + 1
  }
  const avg = total / N || 1
  return docs.map((d) => {
    let s = 0
    for (const t of qtoks) {
      const f = d.tf[t]
      if (!f) continue
      const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5))
      s += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.n / avg)))
    }
    return s
  })
}
const round = (x) => Math.round(x * 1e6) / 1e6

// ── 1 · 2단 — 이름 ──
const nameCache = new WeakMap()
function names(k) {
  if (nameCache.has(k)) return nameCache.get(k)
  const out = []
  for (const [coord, v] of k.vocab.coords) {
    const all = [coord, coord.split(':').slice(1).join(':'), v.label, ...v.aliases]
    out.push({ coord, name: v.label, keys: [...new Set(all.map(normKey).filter(Boolean))], deprecated: v.deprecated })
  }
  // 이름 장부에 없는 항목 머리도 이름이다(개인 지식은 장부가 없다)
  for (const d of k.docs)
    for (const s of d.sections) {
      const c = coordsOfSection(k, d, s.h)[0]
      if (c) continue
      out.push({ coord: null, doc: d.id, heading: s.h, name: s.h, keys: [normKey(s.h)] })
    }
  nameCache.set(k, out)
  return out
}

// 3단 카드 — 지식마다 한 번
const cardCache = new WeakMap()
function cardsOf(k) {
  if (cardCache.has(k)) return cardCache.get(k)
  const cards = []
  for (const [coord, v] of k.vocab.coords) {
    const s = sectionOf(k, coord)
    const body = s?.sec ? `${s.sec.h}\n${s.sec.body}` : ''
    const all = `${v.label} ${v.aliases.join(' ')} ${body}`
    const toks = tokens(all)
    cards.push({ coord, doc: s?.doc?.id || null, heading: s?.sec?.h || null, norm: normKey(all), n: toks.length, tf: tf(toks) })
  }
  cardCache.set(k, cards)
  return cards
}

export function exact(k, q) {
  const n = normKey(q)
  if (!n) return []
  return names(k).filter((x) => x.keys.includes(n))
}

export function nameContain(k, q, learned = {}) {
  const n = normKey(q)
  const j = stripJosa(q)
  const out = []
  if (!n) return out
  for (const x of names(k)) {
    let via = null
    for (const key of x.keys) {
      if (key === n) break
      if (key.length >= 2 && n.includes(key)) via = '말이 이름을 품음'
      else if (key.includes(n) && n.length / key.length >= 0.8) via = '이름이 말을 품음'
      else if (j !== n && key === j) via = '조사 뗌'
      if (via) break
    }
    if (via) out.push({ ...x, via })
  }
  for (const [coord, c] of Object.entries(learned[n] || {})) if (c.n > 0 && !out.some((x) => x.coord === coord)) out.push({ coord, name: labelOf(k, coord), keys: [], via: '배운 이름' })
  return out
}

// ── 사다리 한 번 ──
// learned — 배운 이름 { normq: { coord: { n } } } · fileText — 경로 → 지금 글(캐시)
export async function ladder(k, index, { q = '', words = null, learned = {}, max = 6, passagesMax = 5, exclude = null } = {}) {
  const text = [q, ...(words || [])].filter(Boolean).join(' ')
  const ws = wordsOf(text, commonOf(k))
  const qtoks = tokens(ws.join(' '))
  const need = Math.ceil(ws.length / 2)
  const label = '정리된 문서에서 못 찾아 비슷한 글에서 찾았다'
  const ex = []
  for (const t of [q, ...(words || [])].filter(Boolean)) for (const x of exact(k, t)) if (!ex.some((y) => (y.coord || y.doc + '#' + y.heading) === (x.coord || x.doc + '#' + x.heading))) ex.push(x)
  const weak = []
  for (const t of [q, ...(words || [])].filter(Boolean)) for (const x of nameContain(k, t, learned)) if (!ex.some((y) => y.coord && y.coord === x.coord) && !weak.some((y) => (y.coord || y.heading) === (x.coord || x.heading))) weak.push(x)

  // 3단 — 이름 하나 = 카드 하나
  const cards = cardsOf(k)
  const cardHits = cards.map((c) => ({ c, hits: ws.filter((w) => hitIn(c.norm, w)) })).filter((x) => x.hits.length && (x.hits.length >= need || x.hits.some((w) => w.length >= 2)))
  const cs = bm25(qtoks, cardHits.map((x) => x.c))
  const step3 = cardHits.map((x, i) => ({ ...x, s: round(cs[i]) })).sort((a, b) => b.s - a.s || a.c.coord.localeCompare(b.c.coord))

  // 4단 — 글 토막(지금 파일에서 다시 읽어 조건을 본다)
  const cand = []
  for (const [p, f] of Object.entries(index.files)) {
    if (exclude && exclude(p)) continue
    for (const ch of f.chunks) if (qtoks.some((t) => ch.tf[t])) cand.push({ p, f, ch })
  }
  const pass = []
  for (const x of cand) {
    const { lines, norms } = await linesOf(k, x.p, x.f.sha1)
    const t = [x.ch.h, ...lines.slice(x.ch.a, x.ch.b + 1)].join('\n')
    const key = `${x.ch.a}:${x.ch.b}`
    const nt = norms.get(key) ?? norms.set(key, normKey(t)).get(key)
    const hits = ws.filter((w) => hitIn(nt, w))
    if (hits.length && hits.length >= need) pass.push({ ...x, hits, text: t })
  }
  const ps = bm25(qtoks, pass.map((x) => x.ch))
  const step4 = pass.map((x, i) => ({ ...x, s: round(ps[i]) })).sort((a, b) => b.s - a.s || a.p.localeCompare(b.p) || a.ch.a - b.ch.a)

  // 합치기 — 2 ~ 4단 합집합 · RRF 는 순서에만
  const rrf = new Map()
  const add = (key, rank, info) => {
    const e = rrf.get(key) || { ...info, key, score: 0, via: [], hits: new Set() }
    e.score += 1 / (60 + rank)
    for (const h of info.hits || []) e.hits.add(h)
    if (!e.via.includes(info.v)) e.via.push(info.v)
    rrf.set(key, e)
  }
  weak.forEach((x, i) => x.coord && add('c:' + x.coord, i, { coord: x.coord, v: `이름: ${x.via}`, hits: [] }))
  weak.forEach((x, i) => !x.coord && add(`s:${x.doc}#${x.heading}`, i, { doc: x.doc, heading: x.heading, v: `이름: ${x.via}`, hits: [] }))
  step3.forEach((x, i) => add('c:' + x.c.coord, i, { coord: x.c.coord, v: '항목 글', hits: x.hits }))
  const passages = []
  step4.forEach((x, i) => {
    const kindRec = x.f.kind === 'rec'
    if (x.ch.coord) return add('c:' + x.ch.coord, i, { coord: x.ch.coord, v: '글 토막', hits: x.hits, at: { line: x.ch.a + 1, head: x.ch.h } })
    passages.push({ rank: i, path: x.p, line: x.ch.a + 1, end: x.ch.b + 1, head: x.ch.h, kind: kindRec ? 'rec' : 'doc', hits: x.hits, text: x.text.slice(0, CHUNK), s: x.s })
  })
  const merged = [...rrf.values()].sort((a, b) => round(b.score) - round(a.score) || a.key.localeCompare(b.key))
  const coords = merged.filter((e) => !ex.some((x) => x.coord && 'c:' + x.coord === e.key))
  const cardsOut = coords.slice(0, max).map((e) => card(k, e))
  const passOut = passages.slice(0, passagesMax).map((p) => passage(k, p))
  const exhaustive = false
  return {
    q,
    words: ws,
    exact: ex.map((x) => (x.coord ? card(k, { coord: x.coord, via: ['이름'], hits: new Set() }) : { name: x.heading, doc: x.doc, heading: x.heading, via: ['항목 머리'] })),
    weak: weak.map((x) => ({ coord: x.coord, name: x.name, doc: x.doc || null, heading: x.heading || null, via: x.via })),
    coords: cardsOut,
    passages: passOut,
    more: { coords: { n: Math.max(0, coords.length - max), ids: coords.slice(max, max + 30).map((e) => e.coord || `${e.doc}#${e.heading}`) }, passages: { n: Math.max(0, passages.length - passagesMax), ids: passages.slice(passagesMax, passagesMax + 30).map((p) => `${p.path}#${p.line}`) }, rule: `질문 낱말(${ws.join(' · ') || '없음'})의 절반 이상 · 또는 말 하나가 통째로 든 항목` },
    exhaustive: ex.length > 0 ? true : exhaustive,
    empty: !ex.length && !cardsOut.length && !passOut.length,
    label: ex.length ? null : label,
  }
}

function card(k, e) {
  const coord = e.coord
  if (!coord) return { name: e.heading, doc: e.doc, heading: e.heading, via: e.via, hits: [...(e.hits || [])] }
  const s = sectionOf(k, coord)
  const works = k.works.filter((w) => w.touches.includes(coord))
  const v = k.vocab.coords.get(coord)
  return {
    coord,
    name: labelOf(k, coord),
    doc: s?.doc?.id || null,
    heading: s?.sec?.h || null,
    via: e.via,
    hits: [...(e.hits || [])],
    ...(e.at ? { at: e.at } : {}),
    works: works.slice(0, 5).map((w) => ({ id: w.id, state: w.state === 'pend' ? '아직 문서에 안 넣음' : '문서에 들어감' })),
    pending: works.filter((w) => w.state === 'pend').length,
    registered: !!v,
    ...(v?.deprecated ? { deprecated: v.deprecated } : {}),
  }
}

function passage(k, p) {
  const out = { path: p.path, line: p.line, head: p.head, hits: p.hits, text: p.text }
  if (p.kind === 'doc') {
    const d = k.byDocPath.get(p.path)
    out.label = `문서 그대로 · 마지막 고친 날 ${d ? d.mtime.slice(0, 10) : ''}`
    out.doc = d ? d.id : null
  } else {
    const id = p.path.replace(/^work\/|\.md$/g, '')
    const w = k.byWork.get(id)
    out.record = id
    out.label = `그때의 기록 · 정리 전 · ${w ? w.date : ''}`
    // 정정 동봉 — 이 기록을 바로잡은 기록을 위에
    const by = [...k.works, ...k.logs].filter((o) => o.fixes.includes(id))
    if (by.length) {
      out.correctedBy = by.map((o) => ({ id: o.id, title: o.title, date: o.date, head: o.body.split('\n').filter(Boolean).slice(0, 2).join(' ') }))
      out.label += ' · 정정 앞'
    }
  }
  // 이 토막이 말하는 이름 → 그 항목(지금 글은 section 으로)
  const nt = normKey(p.text)
  out.mentions = [...k.vocab.coords.entries()].filter(([, v]) => [v.label, ...v.aliases].some((a) => normKey(a).length >= 2 && nt.includes(normKey(a)))).slice(0, 8).map(([c]) => ({ coord: c, name: labelOf(k, c), pending: k.works.filter((w) => w.touches.includes(c) && w.state === 'pend').length }))
  return out
}

// 지식마다의 일반 말 — 기본 목록 + 기록 제목의 5% 이상에 나오는 말(기록이 20 이상일 때)
const commonCache = new WeakMap()
export function commonOf(k) {
  if (commonCache.has(k)) return commonCache.get(k)
  const set = new Set(COMMON)
  if (k.works.length >= 20) {
    const cnt = new Map()
    for (const w of k.works) for (const x of new Set(wordsOf(w.title, new Set()))) cnt.set(x, (cnt.get(x) || 0) + 1)
    for (const [x, n] of cnt) if (n / k.works.length >= 0.05) set.add(x)
  }
  commonCache.set(k, set)
  return set
}

// ── 찾기 후보 배우기 — 사람이 화면에서 고른 것만 센다(2단 약함 후보에만 · 어휘는 바꾸지 않는다) ──
const learnFile = (dataDir, id) => path.join(dataDir, 'learn', `${encodeURIComponent(id)}.json`)
export async function loadLearned(dataDir, id) {
  const j = await fs.readFile(learnFile(dataDir, id), 'utf8').then(JSON.parse, () => ({}))
  const cut = Date.now() - 180 * 864e5
  for (const [q, m] of Object.entries(j)) for (const [c, v] of Object.entries(m)) if (Date.parse(v.at) < cut) delete m[c]
  return j
}
export async function learn(dataDir, id, { q, coord, who }) {
  const j = await loadLearned(dataDir, id)
  const n = normKey(q)
  if (!n || !coord) return j
  const e = ((j[n] ||= {})[coord] ||= { n: 0, by: [], at: null })
  const h = crypto.createHash('sha256').update(String(who)).digest('hex').slice(0, 12)
  if (!e.by.includes(h)) {
    e.by.push(h)
    e.n++
  }
  e.at = new Date().toISOString()
  await fs.mkdir(path.dirname(learnFile(dataDir, id)), { recursive: true })
  await fs.writeFile(learnFile(dataDir, id), JSON.stringify(j), { mode: 0o600 })
  return j
}

// ── 찾기 점검 — 기록 제목(코드 뺌)으로 그 기록이 건드린 이름을 찾는다 · 그 기록 자신의 토막은 뺀다 ──
// 얼린 시험지(`<data>/searchcheck/<지식>.json`)가 있으면 같은 시험지 위에서 짝으로 견준다(나빠진 문항 수)
export async function searchCheck(k, index, { dataDir = null, freeze = false, max = 6 } = {}) {
  const f = dataDir ? path.join(dataDir, 'searchcheck', `${encodeURIComponent(k.id)}.json`) : null
  const frozen = f ? await fs.readFile(f, 'utf8').then(JSON.parse, () => null) : null
  const qs = frozen?.questions || k.works.filter((w) => w.touches.some((c) => !c.startsWith('domain:'))).map((w) => ({ id: w.id, q: w.title.replace(/[A-Za-z]{2,}[-_]?\d[\w-]*/g, ' ').replace(/\s+/g, ' ').trim(), want: w.touches.filter((c) => !c.startsWith('domain:')) }))
  const rows = []
  for (const x of qs) {
    const r = await ladder(k, index, { q: x.q, max, exclude: (p) => p === `work/${x.id}.md` })
    const got = [...r.exact.map((c) => c.coord), ...r.coords.map((c) => c.coord)].filter(Boolean).slice(0, max)
    rows.push({ id: x.id, in: got.some((c) => x.want.includes(c)), first: x.want.includes(got[0]) })
  }
  const n = rows.length || 1
  const score = { n: rows.length, in: Math.round((rows.filter((r) => r.in).length / n) * 1000) / 10, first: Math.round((rows.filter((r) => r.first).length / n) * 1000) / 10 }
  const worse = frozen?.rows ? rows.filter((r) => !r.in && frozen.rows.find((o) => o.id === r.id)?.in).map((r) => r.id) : []
  if (f && (freeze || !frozen)) {
    await fs.mkdir(path.dirname(f), { recursive: true })
    await fs.writeFile(f, JSON.stringify({ at: new Date().toISOString(), questions: qs, rows, score }, null, 1))
  }
  return { score, worse, frozen: !!frozen && !freeze }
}
