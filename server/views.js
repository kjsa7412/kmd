// 화면이 읽는 자료 — 지식 목록 · 나무 · 문서 한 장 · 기록 한 장 · 찾기.
//
// 글은 서버가 markdown 을 HTML 로 바꿔 보낸다(날 HTML 은 받지 않는다 — html:false).
// 문서 · 기록을 가리키는 링크는 화면 안에서 탭으로 열리게 표지를 단다.

import MarkdownIt from 'markdown-it'
import path from 'node:path'
import { coordsOfSection, labelOf, sectionOf, pendPick } from '../core/knowledge.js'
import { sha16 } from '../core/text.js'
import { splitBlocks, parseTable } from '../core/baseline.js'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

md.renderer.rules.table_open = () => '<table class="t">\n'

// 글 속 링크 → 지식 안의 문서면 openDoc · 기록이면 openRec · 밖이면 새 창
function linkTarget(k, fromPath, href) {
  if (!href || /^[a-z]+:/i.test(href) || href.startsWith('#')) return null
  let rel = decodeURIComponent(href.split('#')[0])
  if (!rel) return null
  const p = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), rel))
  if (/^docs\/.+\.md$/i.test(p)) return { a: 'openDoc', d: p.slice(5, -3) }
  const w = p.match(/^work\/([^/]+)\.md$/i)
  if (w) return { a: 'openRec', r: w[1] }
  return null
}

// 문단 안의 줄바꿈은 줄마다 문단으로 — 목업(paras)이 줄 하나를 <p> 하나로 그린다
// 저절로 채우는 표(기준선 블록)는 목업의 auto 상자로(편집기에서는 회색 잠금)
const SYNC = '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5l2 2 M20 12a8 8 0 0 1-14 5l-2-2 M20 4v5h-5 M4 20v-5h5"/></svg>'
const LOCK = '<svg viewBox="0 0 24 24"><path d="M6 11h12v10H6z M9 11V8a3 3 0 0 1 6 0v3"/></svg>'
const hm = (iso) => {
  if (!iso) return '아직'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return isNaN(d) ? String(iso).slice(5, 16) : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
export function autoHtml(b, { checked = null, lock = false } = {}) {
  const t = parseTable(b.table)
  return `<div class="auto${lock ? ' lock' : ''}" data-t="${lock ? 'autoLock' : 'auto'}"><div class="ah">${SYNC} <b>저절로 채우는 표</b> · ${esc(b.src)} · ${esc(String(b.asof).slice(5, 16))} 부터 · ${esc(hm(checked))} 확인</div><table class="t"><tr>${t.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${t.rows.map((r) => `<tr>${t.cols.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</table>${lock ? `<div class="lkl">${LOCK} ${esc(b.src)}에서 저절로 — 여기서는 고치지 않는다</div>` : ''}${b.missing ? `<div class="lkl">원천에 없다 — ${esc(b.missing.slice(5))} 확인</div>` : ''}</div>`
}
export function render(k, fromPath, text, { src = {} } = {}) {
  const env = { k, fromPath }
  const { text: t, blocks } = splitBlocks(String(text || ''))
  const html = md.render(t.replace(/\u0000block(\d+)\u0000/g, '\n\nKMDBLOCK$1\n\n'), env).replace(/<p>([\s\S]*?)<\/p>/g, (all, inner) => inner.split('<br>\n').map((x) => `<p>${x}</p>`).join('\n'))
  return html.replace(/<p>KMDBLOCK(\d+)<\/p>/g, (_, n) => autoHtml(blocks[Number(n)], { checked: src[blocks[Number(n)].src]?.checkedAt }))
}
// 편집기용 — 블록 뺀 글 · 잠긴 표
export function editParts(body, { src = {} } = {}) {
  const { text, blocks } = splitBlocks(String(body || ''))
  return { md: text.replace(/\u0000block\d+\u0000/g, '').replace(/\n{3,}/g, '\n\n').trim(), locks: blocks.map((b) => autoHtml(b, { checked: src[b.src]?.checkedAt, lock: true })).join('') }
}

md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
  const t = tokens[i]
  const href = t.attrGet('href')
  const to = env?.k ? linkTarget(env.k, env.fromPath, href) : null
  if (to) {
    t.attrs = [['class', 'dlink'], ['data-a', to.a], ['data-k', env.k.id], to.d ? ['data-d', to.d] : ['data-r', to.r]]
  } else if (href && /^https?:/i.test(href)) {
    t.attrSet('target', '_blank')
    t.attrSet('rel', 'noopener noreferrer')
  } else {
    t.attrs = [['class', 'dlink']]
  }
  return self.renderToken(tokens, i, opts)
}

export function linksOf(doc) {
  const out = []
  const all = [doc.intro, ...doc.sections.map((s) => s.body)].join('\n')
  for (const m of all.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const to = linkTarget({ id: '' }, doc.path, m[1])
    if (to?.d && to.d !== doc.id && !out.includes(to.d)) out.push(to.d)
  }
  return out
}

export function knowledgeRow(k) {
  const pend = k.works.filter((w) => w.state === 'pend').length
  const when = [k.docs[0]?.mtime, k.works[0] ? isoOfStamp(k.works[0].date) : null].filter(Boolean).sort().pop() || null
  return { id: k.id, name: k.name, docs: k.docs.length, records: k.works.length, pend, when }
}

// 기록의 날짜(YYYY-MM-DD HH:MM · 지역 시각) → ISO
export function isoOfStamp(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).toISOString()
}

function docPend(k) {
  const s = new Set()
  for (const w of k.works) {
    if (w.state !== 'pend') continue
    for (const c of w.touches) {
      const x = sectionOf(k, c)
      if (x?.loc) s.add(x.loc.doc)
    }
  }
  return s
}

const recRow = (w) => ({ id: w.id, date: w.date, title: w.title, author: w.author, state: w.state })

export function tree(k) {
  const pend = docPend(k)
  return {
    id: k.id,
    name: k.name,
    docs: k.docs.map((d) => ({ id: d.id, title: d.title, when: d.mtime, pend: pend.has(d.path) })),
    records: k.works.map(recRow),
    atts: k.atts.map((a) => a.replace(/^(docs|work)\/assets\//i, '')),
  }
}

// 이 문서를 가리키는 것 — 기록(이 문서의 항목을 건드린 것) · 문서(이 문서를 링크한 것) · 이름만 나온 곳
function backlinks(k, d) {
  const recs = k.works.filter((w) => w.touches.some((c) => sectionOf(k, c)?.loc?.doc === d.path))
  const linkers = k.docs.filter((o) => o !== d && linksOf(o).includes(d.id))
  const names = [d.title, ...d.sections.flatMap((s) => coordsOfSection(k, d, s.h).flatMap((c) => [labelOf(k, c), ...(k.vocab.coords.get(c)?.aliases || [])]))].filter((x) => x && x.length >= 2)
  const uniq = [...new Set(names)]
  const ments = []
  for (const o of k.docs) {
    if (o === d || linkers.includes(o)) continue
    const s = o.sections.find((s) => uniq.some((x) => `${s.h} ${s.body}`.includes(x)))
    if (s) ments.push({ d: o.id, title: o.title, h: s.h, x: uniq.find((x) => `${s.h} ${s.body}`.includes(x)) })
  }
  return { recs: recs.map(recRow), linkers: linkers.map((o) => ({ id: o.id, title: o.title })), ments }
}

export function docView(k, docId, { src = {} } = {}) {
  const d = k.docs.find((x) => x.id === docId)
  if (!d) return null
  const last = d.sections.map((s) => s.applied && k.byWork.get(s.applied)).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date))[0]
  const sections = d.sections.map((s) => {
    const coords = coordsOfSection(k, d, s.h)
    const recs = k.works.filter((w) => w.touches.some((c) => coords.includes(c)))
    const { pick: pendRecs, more: pendMore } = pendPick(recs)
    const by = s.applied && k.byWork.get(s.applied)
    return {
      h: s.h,
      html: render(k, d.path, s.body, { src }),
      ...editParts(s.body, { src }),

      base: sha16(s.body),
      recs: recs.length,
      pend: pendRecs.map((w) => ({ id: w.id, date: w.date, author: w.author, title: w.title })),
      pendMore,
      by: by ? { id: by.id, date: by.date, author: by.author } : null,
      named: coords.length > 0,
    }
  })
  const links = linksOf(d).filter((id) => k.docs.some((o) => o.id === id)).map((id) => ({ id, title: k.docs.find((o) => o.id === id).title }))
  return {
    id: d.id,
    title: d.title,
    path: d.path,
    when: d.mtime,
    intro: d.intro ? render(k, d.path, d.intro) : '',
    sections,
    links,
    backlinks: backlinks(k, d),
    last: last ? { date: last.date, author: last.author } : null,
    items: sections.filter((s) => s.named).length,
  }
}

export function recView(k, id) {
  const w = k.byWork.get(id)
  if (!w) return null
  const items = w.touches.map((c) => {
    const x = sectionOf(k, c)
    return { coord: c, name: labelOf(k, c), kind: c.split(':')[0], doc: x?.doc?.id || null, docTitle: x?.doc?.title || null, h: x?.sec?.h || null }
  })
  const fixes = w.fixes.map((f) => k.byWork.get(f)).filter(Boolean).map(recRow)
  const fixedBy = k.works.filter((o) => o.fixes.includes(w.id)).map(recRow)
  return { ...recRow(w), html: render(k, w.path, w.body), tags: w.tags, items, fixes, fixedBy }
}

// 찾기 — 사다리 결과(core/search.js)를 화면의 찾은 것 줄로. 정확한 이름이면 「문서의 항목」, 아니면 비슷한 글
export function findView(pairs) {
  const hits = []
  let exact = false
  const words = []
  let more = 0
  for (const { k, r } of pairs) {
    for (const w of r.words || []) if (!words.includes(w)) words.push(w)
    const secText = (docId, h) => {
      const d = k.docs.find((x) => x.id === docId)
      const sec = d && d.sections.find((x) => x.h === h)
      return { title: d ? d.title : docId, text: sec ? sec.body.replace(/`/g, '').slice(0, 220) : '' }
    }
    for (const c of r.exact) {
      if (!c.doc || !c.heading) continue
      exact = true
      const t = secText(c.doc, c.heading)
      hits.push({ k: k.id, kn: k.name, d: c.doc, title: t.title, h: c.heading, text: t.text, coord: c.coord || null, exact: true, alias: !!c.coord && !!k.vocab.coords.get(c.coord)?.aliases?.length })
    }
    if (exact) continue
    for (const c of r.coords) {
      if (!c.doc || !c.heading) continue
      const t = secText(c.doc, c.heading)
      hits.push({ k: k.id, kn: k.name, d: c.doc, title: t.title, h: c.heading, text: t.text, coord: c.coord || null })
    }
    const body = (p) => p.text.split('\n').slice(1).join(' ').replace(/`/g, '').slice(0, 220)
    for (const p of r.passages) {
      if (p.doc) hits.push({ k: k.id, kn: k.name, d: p.doc, title: k.docs.find((x) => x.id === p.doc)?.title || p.doc, h: p.head, text: body(p), label: p.label })
      else if (p.record) hits.push({ k: k.id, kn: k.name, r: p.record, title: k.byWork.get(p.record)?.title || p.record, h: '', text: body(p), label: p.label })
    }
    more += (r.more?.coords?.n || 0) + (r.more?.passages?.n || 0)
  }
  return { hits: exact ? hits.filter((h) => h.exact) : hits.slice(0, 30), toks: words, exact, more }
}

// ── 지식 한 벌의 모양 — 항목으로 보기 · 그래프 · 글 속 항목 이름 · 미리보기 카드가 같이 쓴다 ──
//
// 항목 = 이름 장부의 이름(그 이름이 드는 문서 항목이 있으면 거기) + 장부에 없는 문서 항목 머리.
// 항목 열쇠(key)는 이름(coord)이 있으면 그것, 없으면 `#문서#머리`.
const KIND = { table: '테이블', screen: '화면', api: 'API', term: '용어', proc: '절차', code: '코드', module: '모듈', issue: '이슈', ops: '운영', prog: '프로그램', batch: '배치', req: '요구사항', func: '기능', arch: '구조', test: '시험', scenario: '시나리오', domain: '업무 영역' }
export const kindOf = (coord) => (coord ? KIND[coord.split(':')[0]] || coord.split(':')[0] : '항목')
const firstOf = (body) => String(body || '').slice(0, 1500).split('\n').map((l) => l.replace(/[`*#>|]/g, '').trim()).find((l) => l && !/^[-:| ]+$/.test(l)) || ''
const keyOf = (coord, doc, h) => coord || `#${doc}#${h}`

const models = new WeakMap()
export function model(k) {
  if (models.has(k)) return models.get(k)
  const items = []
  const byKey = new Map()
  const add = (it) => {
    if (byKey.has(it.key)) return
    byKey.set(it.key, it)
    items.push(it)
  }
  for (const [coord, v] of k.vocab.coords) {
    if (v.deprecated) continue
    const s = sectionOf(k, coord)
    add({ key: coord, coord, name: v.label, kind: kindOf(coord), doc: s?.sec ? s.doc.id : null, sec: s?.sec?.h || null, aliases: v.aliases, table: coord.startsWith('table:'), first: firstOf(s?.sec?.body) })
  }
  for (const d of k.docs)
    for (const s of d.sections) {
      if (coordsOfSection(k, d, s.h).length) continue
      add({ key: keyOf(null, d.id, s.h), coord: null, name: s.h, kind: '항목', doc: d.id, sec: s.h, aliases: [], table: false, first: firstOf(s.body) })
    }
  // 기록이 건드렸지만 장부에도 문서에도 없는 이름 — 「문서가 없는 항목」
  for (const w of k.works)
    for (const c of w.touches) if (!byKey.has(c) && !c.startsWith('domain:')) add({ key: c, coord: c, name: labelOf(k, c), kind: kindOf(c), doc: null, sec: null, aliases: [], table: c.startsWith('table:'), first: '' })
  const itemOfSec = new Map(items.filter((i) => i.doc).map((i) => [`${i.doc}\n${i.sec}`, i.key]))
  const recs = k.works.map((w) => ({ id: w.id, date: w.date, author: w.author, title: w.title, body: w.body.replace(/\s+/g, ' ').slice(0, 200), state: w.state, fixes: w.fixes, items: w.touches.filter((c) => byKey.has(c)) }))
  const docs = k.docs.map((d) => ({ id: d.id, title: d.title, when: d.mtime, first: firstOf(d.intro || d.sections[0]?.body), links: linksOf(d).filter((x) => k.docs.some((o) => o.id === x)), items: d.sections.map((s) => itemOfSec.get(`${d.id}\n${s.h}`)).filter(Boolean) }))
  // 이 항목을 쓰는 곳 — 다른 항목의 글에 이 항목 이름 · 다른 이름이 나온다(테이블 빼고)
  const uses = {}
  const bodies = items.filter((i) => i.doc && !i.table).map((i) => {
    const d = k.docs.find((x) => x.id === i.doc)
    return { key: i.key, text: d?.sections.find((s) => s.h === i.sec)?.body || '' }
  })
  // 2글자 조각 → 그 조각이 든 글들 — 이름마다 가장 드문 조각의 글만 대조한다(gdi 1,200 항목에서 2초 → 수십 ms)
  const grams = new Map()
  bodies.forEach((b, i) => {
    const t = b.text.toLowerCase()
    const seen = new Set()
    for (let j = 0; j < t.length - 1; j++) {
      const g = t.slice(j, j + 2)
      if (seen.has(g)) continue
      seen.add(g)
      if (!grams.has(g)) grams.set(g, [])
      grams.get(g).push(i)
    }
  })
  for (const it of items) {
    if (it.table) continue
    const names = [it.name, ...it.aliases].filter((x) => x && x.length >= 2)
    const hit = new Set()
    for (const n of names) {
      const low = n.toLowerCase()
      let best = null
      for (let j = 0; j < low.length - 1; j++) {
        const l = grams.get(low.slice(j, j + 2)) || []
        if (!best || l.length < best.length) best = l
      }
      for (const i of best || []) if (bodies[i].key !== it.key && bodies[i].text.includes(n)) hit.add(bodies[i].key)
    }
    if (hit.size) uses[it.key] = [...hit].sort()
  }
  // 가져오는 곳 — 항목 글 안 블록의 원천 이름(그래프의 「채운다」 선)
  const sources = {}
  for (const it of items) {
    if (!it.doc) continue
    const d = k.docs.find((x) => x.id === it.doc)
    const s = d?.sections.find((x) => x.h === it.sec)
    for (const b of s ? splitBlocks(s.body).blocks : []) (sources[b.src] ||= []).push(it.key)
  }
  const m = { items, docs, recs, uses, sources: Object.entries(sources).map(([name, keys]) => ({ id: name, name, items: keys })) }
  models.set(k, m)
  return m
}

// 항목 한 장 — 지금 글(그 문서 안의 그 부분)
export function itemView(k, key, { src = {} } = {}) {
  const it = model(k).items.find((x) => x.key === key)
  if (!it) return null
  const d = it.doc && k.docs.find((x) => x.id === it.doc)
  const s = d && d.sections.find((x) => x.h === it.sec)
  const by = s?.applied && k.byWork.get(s.applied)
  return { ...it, docTitle: d ? d.title : null, html: s ? render(k, d.path, s.body, { src }) : null, by: by ? { id: by.id, date: by.date, author: by.author } : null }
}
