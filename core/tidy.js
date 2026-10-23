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
  return out
}

export function promptOf(g) {
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

// 넣기 계획 — 검사를 넘은 초안 하나 → save 입력(작성자 kmd-auto · curate-llm)
export function planSave(k, g, d, { model = null } = {}) {
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
