// 정리 — 아직 문서에 안 넣은 기록을 문서 항목에 넣는다(v0.6 §6 · KM81 — 검사를 넘으면 승인 없이 바로).
//
//   재료(material)   항목마다 묶음 하나 — 지금 글 · 지문(base) · 그 항목의 안 넣은 기록 · 기록의 값 장부.
//                    내주는 쪽에서 거른다: 「Claude 에 보내지 않음」 지식은 재료 0(나가기 전에 막는다) · private 태그 기록 뺌.
//                    이름이 없는 기록은 「이름 바로잡기」 묶음(후보 이름은 찾기 사다리가 준다).
//   초안(draft)      일꾼(claude -p)이 JSON 으로 — { content, used[], left[{id, why}], drop[] } / { touches[] }
//   검사(check)      G1 모양 · 기록마다 넣음(used) 또는 둠(left) · G2 base · G4 값 대조(빠진 값 · 지어낸 값) ·
//                    G5 크기 · G6 표지(머리 · applied · 프런트매터 · script). 못 넘으면 「그대로 둔 것」(까닭 한 줄)
//   넣기(apply)      작성자 kmd-auto · 태그 curate-llm · 항목 글 + 표지 · 둔 기록은 같은 기록의 curates(keep)
//
// 값이 바뀐 것(옛 글의 값이 빠지고 새 값이 들어감)은 그 기록을 쓴 사람의 「오늘 바뀐 것」 노란 줄이 된다.

import { valuesOf } from './save.js'
// 코드 바뀜 기록(code-change)은 차이 속의 수를 다 볼 수 없다 — 「바뀐 값」 의 새 값만 글에 있어야 한다
import { newValuesOf } from './codechange.js'
import { sha16 } from './text.js'
import { sectionOf, coordsOfSection, labelOf } from './knowledge.js'

export const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    content: { type: 'string', description: '항목의 새 글 전체(머리 줄 빼고)' },
    used: { type: 'array', items: { type: 'string' }, description: '글에 넣은 기록 id' },
    left: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] }, description: '넣지 않고 둔 기록과 까닭' },
    drop: { type: 'array', items: { type: 'string' }, description: '옛 글에서 일부러 뺀 값(새 기록이 바꾼 값)' },
  },
  required: ['content', 'used', 'left'],
}
export const TOUCH_SCHEMA = {
  type: 'object',
  properties: { touches: { type: 'array', items: { type: 'string' }, description: '이 기록이 바꾼 항목의 이름(후보 중에서) · 없으면 빈 목록' }, why: { type: 'string' } },
  required: ['touches'],
}

const isPrivate = (w) => w.tags.some((t) => /^private$/i.test(t))

// 재료 — 항목마다 묶음 · 이름 없는 기록은 바로잡기 묶음
export function material(k, { candidates = () => [] } = {}) {
  const groups = new Map()
  for (const w of k.works) {
    if (w.state !== 'pend' || isPrivate(w) || k.reverted.has(w.id)) continue
    for (const c of w.touches) {
      const x = sectionOf(k, c)
      if (!x?.loc) continue
      const key = `${x.loc.doc}\n${x.sec ? x.sec.h : x.loc.heading}`
      if (!groups.has(key)) groups.set(key, { kind: 'section', coord: c, doc: x.loc.doc, heading: x.sec ? x.sec.h : x.loc.heading, name: labelOf(k, c), content: x.sec ? x.sec.body : '', base: sha16(x.sec ? x.sec.body : ''), records: [] })
      const g = groups.get(key)
      if (!g.records.some((r) => r.id === w.id)) g.records.push({ id: w.id, date: w.date, author: w.author, title: w.title, body: w.body, ...(w.tags.includes('code-change') ? { code: true } : {}) })
    }
  }
  const out = [...groups.values()].map((g) => ({ ...g, records: g.records.sort((a, b) => a.date.localeCompare(b.date)), values: [...new Set(g.records.flatMap((r) => (r.code ? newValuesOf(r.body) : [...valuesOf(r.body + ' ' + r.title)])))] }))
  for (const w of k.works) {
    if (w.state !== 'nowhere' || isPrivate(w) || k.reverted.has(w.id)) continue
    out.push({ kind: 'touches', record: { id: w.id, date: w.date, author: w.author, title: w.title, body: w.body }, candidates: candidates(w).slice(0, 8) })
  }
  // 넣은 파일의 기록 — 기존 문서 항목에 넣거나 새 문서로(큐레이션) · 후보 문서는 제목 · 머리 말이 겹치는 것(원본이 주인인 문서는 빼고)
  for (const w of k.works) {
    if (w.state !== 'pend' || w.touches.length || !w.tags.some((t) => t.startsWith('ingest/')) || isPrivate(w) || k.reverted.has(w.id)) continue
    out.push({ kind: 'ingest', record: { id: w.id, date: w.date, author: w.author, title: w.title, body: w.body, file: w.tags.find((t) => t.startsWith('ingest/')).slice(7) }, docs: ingestCandidates(k, w) })
  }
  return out
}

// 넣은 파일과 가까운 문서 — 말(2글자 넘는 것)이 제목 · 머리에 겹치는 수로 다섯까지 · 항목마다 지금 글 · 지문
const wordsIn = (t) => new Set(String(t || '').toLowerCase().split(/[^0-9a-z가-힣]+/).filter((x) => x.length >= 2))
export function ingestCandidates(k, w, max = 5) {
  const want = wordsIn(`${w.title} ${[...String(w.body).matchAll(/^#{1,3} (.+)$/gm)].map((m) => m[1]).join(' ')}`)
  const scored = []
  for (const d of k.docs) {
    if (/<!--\s*watched:/.test(d.intro || '')) continue
    const have = wordsIn(`${d.title} ${d.id} ${d.sections.map((s) => s.h).join(' ')}`)
    const n = [...want].filter((x) => have.has(x)).length
    if (n) scored.push({ d, n })
  }
  return scored
    .sort((a, b) => b.n - a.n || a.d.id.localeCompare(b.d.id))
    .slice(0, max)
    .map(({ d }) => ({ doc: d.path, title: d.title, sections: d.sections.filter((s) => s.h).map((s) => ({ h: s.h, body: s.body.slice(0, 1500), base: sha16(s.body) })) }))
}
export const INGEST_SCHEMA = {
  type: 'object',
  properties: {
    updates: { type: 'array', items: { type: 'object', properties: { doc: { type: 'string' }, heading: { type: 'string' }, content: { type: 'string' } }, required: ['doc', 'heading', 'content'] }, description: '기존 문서(후보)의 항목에 넣을 것 — 항목의 새 글 전체 · 없는 머리면 그 문서에 새 항목' },
    newDoc: { type: ['object', 'null'], properties: { path: { type: 'string' }, sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, content: { type: 'string' } }, required: ['heading', 'content'] } } }, description: '새 문서가 맞으면 — 경로(폴더/이름 · .md 없이)와 항목들' },
    why: { type: 'string' },
  },
  required: ['updates'],
}

export function promptOf(g) {
  if (g.kind === 'ingest')
    return [
      '넣은 파일(기록)을 지식에 들인다. 후보 문서에 이어지는 내용이면 그 문서의 항목을 고쳐 쓰고(updates — 항목의 새 글 전체 · 후보에 없는 머리면 그 문서에 새 항목), 이어지는 문서가 없으면 새 문서를 세운다(newDoc — 경로와 항목들). 둘 다 해도 된다.',
      '파일에 있는 값(수 · 이름 · 코드)은 빠짐없이 그대로 옮기고, 파일에 없는 값을 지어내지 않는다. 옛 글의 값은 파일이 바꾼 것만 바꾼다. 머리 줄(##)과 표지(<!-- -->)는 글에 쓰지 않는다. JSON 으로만 답한다.',
      `문서 후보:\n${g.docs.map((d) => `[doc ${d.doc}] ${d.title}\n${d.sections.map((s) => `## ${s.h}\n${s.body}`).join('\n')}`).join('\n\n') || '(없음)'}`,
      `넣은 파일(기록 ${g.record.id} · ${g.record.file}):\n${g.record.body}`,
    ].join('\n\n')
  if (g.kind === 'touches')
    return [
      '아래 기록이 바꾼 항목을 후보 중에서 고른다. 후보에 맞는 것이 없으면 빈 목록. JSON 으로만 답한다.',
      `기록: ${g.record.title}\n${g.record.body}`,
      `후보:\n${g.candidates.map((c) => `- ${c.coord} — ${c.name}`).join('\n') || '(없음)'}`,
    ].join('\n\n')
  return [
    `문서 항목 「${g.name}」 의 글을 새 기록에 맞게 고쳐 쓴다. 기록에 있는 값(수 · 이름 · 코드)은 그대로 옮기고, 기록에 없는 값을 지어내지 않는다.`,
    '옛 글의 값을 새 기록이 바꿨으면 새 값으로 바꾸고 drop 에 옛 값을 적는다. 넣을 것이 없는 기록은 left 에 까닭과 함께 둔다.',
    ...(g.records.some((r) => r.code) ? ['코드 커밋 기록은 「바뀐 값」 줄과 차이를 본다 — 글에 옛 값이 있으면 새 값으로 고치고, 코드에 없는 설명은 지어내지 않는다. 이 항목 글과 상관없는 커밋은 left 에 둔다.'] : []),
    '머리 줄(##)과 표지(<!-- -->)는 쓰지 않는다. JSON 으로만 답한다.',
    `지금 글:\n${g.content || '(아직 없음)'}`,
    `기록(오래된 것부터):\n${g.records.map((r) => `[${r.id}] ${r.date} ${r.author} — ${r.title}\n${r.body}`).join('\n\n')}`,
  ].join('\n\n')
}

// 검사 — { ok, why, changed: [{from, to}] }
export function check(k, g, d) {
  if (!d || typeof d !== 'object') return { ok: false, why: '초안 모양이 아니다' }
  if (g.kind === 'ingest') return checkIngest(k, g, d)
  if (g.kind === 'touches') {
    if (!Array.isArray(d.touches)) return { ok: false, why: '초안 모양이 아니다' }
    const allowed = new Set(g.candidates.map((c) => c.coord))
    if (d.touches.some((c) => !allowed.has(c))) return { ok: false, why: '후보 밖의 이름을 골랐다' }
    return { ok: true, changed: [] }
  }
  if (typeof d.content !== 'string' || !Array.isArray(d.used) || !Array.isArray(d.left)) return { ok: false, why: '초안 모양이 아니다' }
  const ids = g.records.map((r) => r.id)
  const said = [...d.used, ...d.left.map((x) => x?.id)]
  if (said.some((x) => !ids.includes(x))) return { ok: false, why: '받지 않은 기록을 말했다' }
  if (ids.some((x) => !said.includes(x))) return { ok: false, why: '빠뜨린 기록이 있다' }
  // G2 — 지금 글이 재료를 줄 때와 같나
  const x = sectionOf(k, g.coord)
  const cur = x?.sec ? x.sec.body : ''
  if (sha16(cur) !== g.base) return { ok: false, why: '그사이 항목이 바뀌었다 — 다음 정리 때 다시 만든다', stale: true }
  // 그사이 같은 항목에 새 기록이 왔으면 같이 넣어야 한다(표지가 그 기록까지 「넣음」 으로 보이게 되므로)
  const pendNow = k.works.filter((w) => w.state === 'pend' && w.touches.includes(g.coord)).map((w) => w.id)
  if (pendNow.some((x) => !ids.includes(x))) return { ok: false, why: '그사이 새 기록이 왔다 — 다음 정리 때 같이 넣는다', stale: true }
  // G6 — 표지 · 머리 · 프런트매터 · script
  if (/^#{1,6}\s/m.test(d.content) || /<!--/.test(d.content) || /^---\s*$/m.test(d.content) || /<script/i.test(d.content)) return { ok: false, why: '글에 머리 · 표지가 들었다' }
  if (!d.content.trim() && cur.trim()) return { ok: false, why: '글을 비웠다' }
  // G5 — 근거보다 크게 쓰지 않는다
  const used = g.records.filter((r) => d.used.includes(r.id))
  const budget = cur.length + used.reduce((a, r) => a + r.body.length + r.title.length, 0) * 1.5 + 300
  if (d.content.length > budget) return { ok: false, why: '근거보다 크게 썼다' }
  // G4 — 값 대조: 넣은 기록의 값이 글에 있나(빠진 값) · 글의 값이 옛 글이나 기록에 있나(지어낸 값)
  const drop = new Set((d.drop || []).map((v) => String(v).replace(/\s+/g, '')))
  const now = valuesOf(d.content)
  const oldV = valuesOf(cur)
  const recV = new Set(used.flatMap((r) => [...valuesOf(r.body + ' ' + r.title)]))
  // 코드 바뀜 기록은 「바뀐 값」 의 새 값만 글에 있어야 한다(차이 속의 다른 수 · 옛 값까지 요구하면 늘 남는다)
  const missing = [...new Set(used.flatMap((r) => (r.code ? newValuesOf(r.body) : [...valuesOf(r.body)])))].filter((v) => !now.has(v) && !drop.has(v))
  if (missing.length) return { ok: false, why: `기록의 값이 글에 없다 — ${missing.slice(0, 3).join(' · ')}` }
  const invented = [...now].filter((v) => !oldV.has(v) && !recV.has(v))
  if (invented.length) return { ok: false, why: `근거에 없는 값이 있다 — ${invented.slice(0, 3).join(' · ')}` }
  const gone = [...oldV].filter((v) => !now.has(v))
  const came = [...now].filter((v) => !oldV.has(v))
  const changed = gone.length && came.length ? [{ from: gone.join(' · '), to: came.join(' · ') }] : []
  return { ok: true, changed }
}

// 넣은 파일 검사 — 모양 · 후보 문서만 고친다 · 새 문서 경로 · 지문(그사이 바뀜) · 표지 · 크기 · 값 대조(빠짐 · 지어냄)
const BAD_TEXT = (t) => /^#{1,6}\s/m.test(t) || /<!--/.test(t) || /^---\s*$/m.test(t) || /<script/i.test(t)
const oneLineH = (h) => typeof h === 'string' && h.trim() && !/[\r\n]/.test(h) && h.length <= 120
const docRel = (p) => `docs/${String(p).replace(/^docs\/|\.md$/g, '')}.md`
function checkIngest(k, g, d) {
  const ups = Array.isArray(d.updates) ? d.updates : null
  const nd = d.newDoc && typeof d.newDoc === 'object' ? d.newDoc : null
  if (!ups || (nd && !Array.isArray(nd.sections))) return { ok: false, why: '초안 모양이 아니다' }
  if (!ups.length && !nd?.sections?.length) return { ok: false, why: '넣을 곳을 고르지 않았다' }
  const outs = []
  let old = ''
  const changed = []
  for (const u of ups) {
    const c = g.docs.find((x) => x.doc === docRel(u.doc))
    if (!c) return { ok: false, why: '후보 밖의 문서를 고쳤다' }
    if (!oneLineH(u.heading) || typeof u.content !== 'string') return { ok: false, why: '초안 모양이 아니다' }
    const s = c.sections.find((x) => x.h === u.heading.trim())
    // 그사이 그 항목이 바뀌었나
    const cur = k.byDocPath.get(c.doc)?.sections.find((x) => x.h === u.heading.trim())
    if (s && (!cur || sha16(cur.body) !== s.base)) return { ok: false, why: '그사이 항목이 바뀌었다 — 다음 정리 때 다시 만든다', stale: true }
    if (s && !u.content.trim() && cur.body.trim()) return { ok: false, why: '글을 비웠다' }
    if (cur) {
      old += '\n' + cur.body
      const a = valuesOf(cur.body)
      const b = valuesOf(u.content)
      const gone = [...a].filter((v) => !b.has(v))
      const came = [...b].filter((v) => !a.has(v))
      if (gone.length && came.length) changed.push({ from: gone.join(' · '), to: came.join(' · ') })
    }
    outs.push(u.content)
  }
  if (nd) {
    const p = String(nd.path || '').replace(/\\/g, '/').replace(/^docs\/|\.md$/g, '').trim()
    if (!p || p.split('/').some((x) => !x.trim() || x === '.' || x === '..' || x.length > 80) || /[<>:"|?*\u0000-\u001f]/.test(p)) return { ok: false, why: '새 문서 경로가 아니다' }
    if (k.byDocPath.get(docRel(p))) return { ok: false, why: '이미 있는 문서다 — 새 문서가 아니라 고치기로' }
    for (const s of nd.sections) {
      if (!oneLineH(s?.heading) || typeof s.content !== 'string') return { ok: false, why: '초안 모양이 아니다' }
      outs.push(s.content)
    }
  }
  if (outs.some(BAD_TEXT)) return { ok: false, why: '글에 머리 · 표지가 들었다' }
  const text = outs.join('\n')
  if (text.length > old.length + g.record.body.length * 1.5 + 500) return { ok: false, why: '근거보다 크게 썼다' }
  // 파일의 글을 거의 옮기지 않았다(값이 없는 글도 잃지 않게) — 머리 · 제목 줄을 뺀 글의 3할은 넘어야 한다
  const plain = (t) => String(t).replace(/^#{1,6} .*$/gm, '').replace(/\s+/g, '')
  if (plain(text).length < plain(g.record.body).length * 0.3 && !ups.length) return { ok: false, why: '파일의 글을 거의 옮기지 않았다' }
  const now = valuesOf(text)
  const recV = valuesOf(g.record.body + ' ' + g.record.title + ' ' + g.record.file)
  const oldV = valuesOf(old)
  // 파일의 값은 빠짐없이 — 다른 후보 문서에 이미 있는 값 · 새 문서 이름에 든 값은 거기 있으므로 괜찮다 · 파일의 제목 줄(# …)은 문서 이름이 된다
  const elsewhere = valuesOf(g.docs.flatMap((c) => c.sections.map((s) => s.body)).join('\n') + ' ' + (nd ? nd.path : ''))
  const missing = [...valuesOf(g.record.body.replace(/^# .*$/gm, ''))].filter((v) => !now.has(v) && !elsewhere.has(v))
  if (missing.length) return { ok: false, why: `파일의 값이 글에 없다 — ${missing.slice(0, 3).join(' · ')}` }
  const invented = [...now].filter((v) => !recV.has(v) && !oldV.has(v))
  if (invented.length) return { ok: false, why: `근거에 없는 값이 있다 — ${invented.slice(0, 3).join(' · ')}` }
  return { ok: true, changed }
}

// 넣기 계획 — 검사를 넘은 초안 하나 → save 입력(작성자 kmd-auto · curate-llm)
export function planSave(k, g, d, { model = null } = {}) {
  if (g.kind === 'ingest') {
    const p = d.newDoc ? String(d.newDoc.path).replace(/\\/g, '/').replace(/^docs\/|\.md$/g, '').trim() : null
    const ups = d.updates.map((u) => {
      const c = g.docs.find((x) => x.doc === docRel(u.doc))
      const s = c.sections.find((x) => x.h === u.heading.trim())
      return { doc: c.doc, heading: u.heading.trim(), content: u.content, ...(s ? { base: s.base } : {}) }
    })
    const news = p ? d.newDoc.sections.map((s) => ({ doc: docRel(p), heading: s.heading.trim(), content: s.content })) : []
    const name = g.record.file.split('/').pop()
    return {
      record: {
        title: `정리 — ${name} 들임`,
        body: [`초안: 정리 일꾼${model ? `(${model})` : ''} · 넣음: kmd · 넣은 파일 ${g.record.id}`, ...(p ? [`- 새 문서 ${p} — 항목 ${news.length}`] : []), ...ups.map((u) => `- 고침 ${u.doc.replace(/^docs\/|\.md$/g, '')} › ${u.heading}`), ...(d.why ? [`- 까닭 — ${d.why}`] : [])].join('\n'),
        tags: ['curate-llm'],
        reflects: [g.record.id],
      },
      sections: [...ups, ...news],
    }
  }
  if (g.kind === 'touches')
    return { record: { title: `이름 바로잡음 — ${g.record.title.split(' — ')[0]}`, body: `정리 일꾼이 이 기록이 바꾼 항목을 골랐다${d.why ? ` — ${d.why}` : ''}`, touches: d.touches, tags: ['curate-llm', 'touches-fix'], fixes: [g.record.id], date: g.record.date } }
  const used = g.records.filter((r) => d.used.includes(r.id))
  return {
    record: {
      title: `정리 — ${g.name}`,
      body: [`초안: 정리 일꾼${model ? `(${model})` : ''} · 넣음: kmd`, ...used.map((r) => `- 넣음 ${r.id} — ${r.title}`), ...d.left.map((x) => `- 둠 ${x.id} — ${x.why}`)].join('\n'),
      touches: [g.coord],
      tags: ['curate-llm'],
      curates: d.left.map((x) => ({ id: x.id, verdict: 'keep', rule: 'tidy', reason: x.why })),
      reflects: used.map((r) => r.id),
    },
    sections: [{ coord: g.coord, content: d.content, base: g.base }],
  }
}

export { coordsOfSection }
