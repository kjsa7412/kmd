// 화면이 읽는 자료 — 지식 목록 · 나무 · 문서 한 장 · 기록 한 장 · 찾기.
//
// 글은 서버가 markdown 을 HTML 로 바꿔 보낸다(날 HTML 은 받지 않는다 — html:false).
// 문서 · 기록을 가리키는 링크는 화면 안에서 탭으로 열리게 표지를 단다.

import MarkdownIt from 'markdown-it'
import path from 'node:path'
import { coordsOfSection, labelOf, sectionOf } from '../core/knowledge.js'

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
export function render(k, fromPath, text) {
  const env = { k, fromPath }
  return md.render(String(text || ''), env).replace(/<p>([\s\S]*?)<\/p>/g, (all, inner) => inner.split('<br>\n').map((x) => `<p>${x}</p>`).join('\n'))
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

export function docView(k, docId) {
  const d = k.docs.find((x) => x.id === docId)
  if (!d) return null
  const last = d.sections.map((s) => s.applied && k.byWork.get(s.applied)).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date))[0]
  const sections = d.sections.map((s) => {
    const coords = coordsOfSection(k, d, s.h)
    const recs = k.works.filter((w) => w.touches.some((c) => coords.includes(c)))
    const pendRecs = recs.filter((w) => w.state === 'pend')
    const by = s.applied && k.byWork.get(s.applied)
    return {
      h: s.h,
      html: render(k, d.path, s.body),
      recs: recs.length,
      pend: pendRecs.map((w) => ({ id: w.id, date: w.date, author: w.author, title: w.title })),
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

// 찾기(K0) — 항목 머리 · 글에 낱말이 든 곳. 찾기 사다리는 E3 에서 이것을 갈아 끼운다
export function find(ks, q) {
  const nq = String(q || '').replace(/\s+/g, '').toLowerCase()
  if (!nq) return { hits: [] }
  const toks = String(q).trim().split(/\s+/).filter(Boolean)
  const hits = []
  for (const k of ks)
    for (const d of k.docs)
      for (const s of d.sections) {
        const hay = `${s.h} ${s.body}`
        const exact = s.h.replace(/\s+/g, '').toLowerCase() === nq
        const m = toks.filter((t) => hay.includes(t)).length
        if (!exact && m < Math.ceil(toks.length / 2)) continue
        hits.push({ k: k.id, kn: k.name, d: d.id, title: d.title, h: s.h, text: s.body.replace(/`/g, '').slice(0, 220), v: (exact ? 100 : 0) + m * 10 + (toks.some((t) => s.h.includes(t)) ? 5 : 0) })
      }
  hits.sort((a, b) => b.v - a.v)
  return { hits: hits.slice(0, 30), toks, exact: hits.length > 0 && hits[0].v >= 100 }
}
