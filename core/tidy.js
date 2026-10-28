// 정리 — 아직 문서에 안 넣은 기록을 문서 항목에 넣는다(v0.6 §6 · KM81 — 검사를 넘으면 승인 없이 바로).
//
//   재료(material)   항목마다 묶음 하나 — 지금 글 · 지문(base) · 그 항목의 안 넣은 기록 · 기록의 값 장부.
//                    내주는 쪽에서 거른다: 「Claude 에 보내지 않음」 지식은 재료 0(나가기 전에 막는다) · private 태그 기록 뺌.
//                    이름이 없는 기록은 「이름 바로잡기」 묶음(후보 이름은 찾기 사다리가 준다).
//   초안(draft)      일꾼(claude -p)이 JSON 으로 — { content, used[], left[{id, why}], drop[] } / { touches[] }
//   검사(check)      G1 모양 · 기록마다 넣음(used) 또는 둠(left) · G2 base · G4 값 대조(빠진 값 · 지어낸 값) ·
//                    G5 크기 · G6 표지(항목 머리 # · ## · applied · 프런트매터 · script — 소제목 ### 아래는 된다).
//                    못 넘으면 「그대로 둔 것」(까닭 한 줄)
//   경과            Claude 는 본문만 보고 쓴다 — 항목 끝 `**경과**` 는 저장이 지키고 넣은 기록의 줄을 더한다
//   넣기(apply)      작성자 kmd-auto · 태그 curate-llm · 항목 글 + 표지 · 둔 기록은 같은 기록의 curates(keep)
//
// 값이 바뀐 것(옛 글의 값이 빠지고 새 값이 들어감)은 그 기록을 쓴 사람의 「오늘 바뀐 것」 노란 줄이 된다.

import { valuesOf } from './save.js'
// 코드 바뀜 기록(code-change)은 차이 속의 수를 다 볼 수 없다 — 「바뀐 값」 의 새 값만 글에 있어야 한다
import { newValuesOf } from './codechange.js'
import { sha16 } from './text.js'
import { sectionOf, coordsOfSection, labelOf } from './knowledge.js'
import { splitLog } from './sections.js'

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

// 재료 — 항목마다 묶음 · 이름 없는 기록은 바로잡기 묶음 · ids 가 있으면 그 기록만(고른 것만 정리)
export function material(k, { candidates = () => [], ids = null } = {}) {
  const groups = new Map()
  const off = (w) => (ids ? !ids.includes(w.id) : false)
  const keyOf = (x) => `${x.loc.doc}\n${x.sec ? x.sec.h : x.loc.heading}`
  // 항목마다 이미 넣은 기록 중 가장 늦게 쓴 때 — 그보다 앞서 쓴 기록(늦게 정리되는 옛 기록)은 값을 바꾸지 못한다(check)
  const since = new Map()
  for (const w of k.works) {
    if (w.state !== 'in' || w.author === 'kmd-auto') continue
    for (const c of w.touches) {
      const x = sectionOf(k, c)
      if (x?.loc && String(w.date) > (since.get(keyOf(x)) || '')) since.set(keyOf(x), String(w.date))
    }
  }
  for (const w of k.works) {
    if (w.state !== 'pend' || isPrivate(w) || k.reverted.has(w.id) || off(w)) continue
    for (const c of w.touches) {
      const x = sectionOf(k, c)
      if (!x?.loc) continue
      const key = keyOf(x)
      if (!groups.has(key)) groups.set(key, { kind: 'section', coord: c, doc: x.loc.doc, heading: x.sec ? x.sec.h : x.loc.heading, name: labelOf(k, c), content: splitLog(x.sec ? x.sec.body : '').body, base: sha16(x.sec ? x.sec.body : ''), records: [], ...(since.has(key) ? { since: since.get(key) } : {}) })
      const g = groups.get(key)
      if (!g.records.some((r) => r.id === w.id)) g.records.push({ id: w.id, date: w.date, author: w.author, title: w.title, body: w.body, ...(w.tags.includes('code-change') ? { code: true } : {}), ...(g.since && String(w.date) < g.since ? { old: true } : {}) })
    }
  }
  const out = [...groups.values()].map((g) => ({ ...g, records: g.records.sort((a, b) => a.date.localeCompare(b.date)), values: [...new Set(g.records.flatMap((r) => (r.code ? newValuesOf(r.body) : [...valuesOf(r.body + ' ' + r.title)])))] }))
  for (const w of k.works) {
    if (w.state !== 'nowhere' || isPrivate(w) || k.reverted.has(w.id) || off(w)) continue
    out.push({ kind: 'touches', record: { id: w.id, date: w.date, author: w.author, title: w.title, body: w.body }, candidates: candidates(w).slice(0, 8) })
  }
  // 넣은 파일의 기록 — 기존 문서 항목에 넣거나 새 문서로(큐레이션) · 후보 문서는 제목 · 머리 말이 겹치는 것(원본이 주인인 문서는 빼고)
  for (const w of k.works) {
    if (w.state !== 'pend' || w.touches.length || !w.tags.some((t) => t.startsWith('ingest/')) || isPrivate(w) || k.reverted.has(w.id) || off(w)) continue
    out.push({ kind: 'ingest', record: { id: w.id, date: w.date, author: w.author, title: w.title, body: w.body, file: w.tags.find((t) => t.startsWith('ingest/')).slice(7) }, docs: ingestCandidates(k, w) })
  }
  return out
}

// 묶음 하나 = 정리 일 줄의 자리 하나 — 일꾼 · 서버가 같은 열쇠로 진행을 맞춘다
export const spotKey = (g) => (g?.kind === 'section' ? 'c:' + g.coord : 'r:' + (g?.record?.id || ''))
export const spotTarget = (g) => (g.kind === 'section' ? `${g.doc.replace(/^docs\/|\.md$/g, '')} › ${g.heading}` : g.kind === 'ingest' ? `${g.record.file || g.record.title} · 문서에 들이기` : `${g.record.title} · 자리 고르기`)

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
    .map(({ d }) => ({ doc: d.path, title: d.title, sections: d.sections.filter((s) => s.h).map((s) => ({ h: s.h, body: splitLog(s.body).body.slice(0, 1500), base: sha16(s.body) })) }))
}
export const INGEST_SCHEMA = {
  type: 'object',
  properties: {
    updates: { type: 'array', items: { type: 'object', properties: { doc: { type: 'string' }, heading: { type: 'string' }, content: { type: 'string' } }, required: ['doc', 'heading', 'content'] }, description: '기존 문서(후보)의 항목에 넣을 것: 항목의 새 글 전체 · 없는 머리면 그 문서에 새 항목' },
    newDoc: { type: ['object', 'null'], properties: { path: { type: 'string' }, sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, content: { type: 'string' } }, required: ['heading', 'content'] } } }, description: '새 문서가 맞으면: 경로(폴더/이름 · .md 없이)와 항목들' },
    why: { type: 'string' },
  },
  required: ['updates'],
}

// 항목 글 쓰기 규칙(agent/skills/kmd-build/작성가이드.md 의 줄임) — 정리 · 들이기 프롬프트가 같이 쓴다
const WRITE_RULES = [
  '항목 글 쓰기:',
  '- 항목 하나는 대상 하나(기능 · 화면 · 테이블 · 절차 · 회의 한 번)의 지금이다. 기록을 날짜별로 덧붙이지 말고 지금 글에 녹여 다시 쓴다. 「추가했다 · 고쳤다」 가 아니라 「…한다 · …이다」.',
  '- 뒤집힌 내용은 지운다. 기록의 경위 · 논의 · 「바뀐 것 · 영향 · 맞춰 볼 것」 목록 · 커밋 메시지 · 코드 차이는 옮기지 않는다. 기록에 남아 있다.',
  '- 항목 머리(# · ##)와 표지(<!-- -->)는 쓰지 않는다. 항목 안의 소제목은 ### 아래나 굵은 글로: 지금 글의 소제목은 그대로 둔다.',
  '- 끝의 「**경과**」 목록은 kmd 가 단다. 쓰지 않는다.',
].join('\n')

export function promptOf(g) {
  if (g.kind === 'ingest')
    return [
      '넣은 파일(기록)을 지식에 들인다. 후보 문서에 이어지는 내용이면 그 문서의 항목을 고쳐 쓰고(updates: 항목의 새 글 전체 · 후보에 없는 머리면 그 문서에 새 항목), 이어지는 문서가 없으면 새 문서를 세운다(newDoc: 경로와 항목들). 둘 다 해도 된다.',
      [
        '자리 고르기:',
        '- 문서 이름은 파일 이름이 아니라 그 글의 갈래 · 주제로 짓는다(예: 회의록 · 게이트웨이 설계 · 장애 대응). 날짜 · 번호 · 판 · 회사 약어 같은 파일 이름 조각은 문서 이름에 쓰지 않는다.',
        '- 같은 갈래의 문서가 후보에 있으면(예: 회의록) 새 문서를 세우지 않고 그 문서에 새 항목으로 넣는다. 항목 머리는 「언제 · 무엇」(예: 2026-10-21 HNC 통화).',
        '- 갈래 문서가 없으면 그 갈래 이름으로 새 문서를 세우고(예: newDoc.path = 회의록), 이 파일은 그 안의 항목 하나(머리 「언제 · 무엇」)로 둔다.',
        '- 파일에 정한 것 · 바뀐 값 · 할 일이 있고 그 주제의 문서가 후보에 있으면, 그 문서의 해당 항목에도 그 내용을 고쳐 넣는다(updates).',
        '- 표 · 목록은 그대로 둔다.',
      ].join('\n'),
      WRITE_RULES,
      '파일에 있는 값(수 · 이름 · 코드)은 빠짐없이 그대로 옮기고, 파일에 없는 값을 지어내지 않는다. 옛 글의 값은 파일이 바꾼 것만 바꾼다. JSON 으로만 답한다.',
      `문서 후보:\n${g.docs.map((d) => `[doc ${d.doc}] ${d.title}\n${d.sections.map((s) => `## ${s.h}\n${s.body}`).join('\n')}`).join('\n\n') || '(없음)'}`,
      `넣은 파일(기록 ${g.record.id} · ${g.record.file}):\n${g.record.body}`,
    ].join('\n\n')
  if (g.kind === 'touches')
    return [
      '아래 기록이 바꾼 항목을 후보 중에서 고른다. 후보에 맞는 것이 없으면 빈 목록. JSON 으로만 답한다.',
      `기록: ${g.record.title}\n${g.record.body}`,
      `후보:\n${g.candidates.map((c) => `- ${c.coord}: ${c.name}`).join('\n') || '(없음)'}`,
    ].join('\n\n')
  return [
    `문서 항목 「${g.name}」 의 글을 새 기록에 맞게 고쳐 쓴다. 기록에 있는 값(수 · 이름 · 코드)은 그대로 옮기고, 기록에 없는 값을 지어내지 않는다.`,
    '옛 글의 값을 새 기록이 바꿨으면 새 값으로 바꾸고 drop 에 옛 값을 적는다. 넣을 것이 없는 기록은 left 에 까닭과 함께 둔다.',
    ...(g.records.some((r) => r.code) ? ['코드 커밋 기록은 「바뀐 값」 줄과 차이를 본다. 글에 옛 값이 있으면 새 값으로 고치고, 코드에 없는 설명은 지어내지 않는다. 이 항목 글과 상관없는 커밋은 left 에 둔다.'] : []),
    ...(g.records.some((r) => r.old) ? [OLD_RULE] : []),
    WRITE_RULES,
    'JSON 으로만 답한다.',
    `지금 글:\n${g.content || '(아직 없음)'}`,
    `기록(오래된 것부터):\n${g.records.map(recLine).join('\n\n')}`,
  ].join('\n\n')
}

// 늦게 정리되는 옛 기록 — 지금 글에 이미 그보다 늦게 쓴 기록이 들어갔다(material 의 since)
const OLD_MARK = '지금 글보다 오래됨'
const OLD_RULE = `「${OLD_MARK}」 이 붙은 기록은 지금 글에 더 늦게 쓴 기록이 이미 들어간 뒤에 정리되는 옛 기록이다. 지금 글에 없는 내용만 보태고, 지금 글의 값을 그 기록의 값으로 바꾸지 않는다. 지금 글과 값이 다르면 그 기록은 left 에 「더 새 값이 이미 있다」 로 둔다.`
const recLine = (r) => `[${r.id}] ${r.date} ${r.author}${r.old ? ` (${OLD_MARK})` : ''}: ${r.title}\n${r.body}`

// 한 문서의 항목 여럿을 claude -p 한 번에 — 자리마다 부르면 기록 22건이 자리 159개 · 159번이 된다.
//   같은 문서의 항목 묶음만(문서 하나가 거의 한 번) · 묶음 하나는 BATCH_MAX 자리 · 글(지금 글 + 기록)은 BATCH_CHARS 까지(기록 글은 한 번만 센다). 답은 자리마다 DRAFT_SCHEMA 와 같은 초안
export const BATCH_MAX = 16
export const BATCH_CHARS = 60_000
export const BATCH_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: { type: 'object', properties: { key: { type: 'string', description: '항목의 key(그대로)' }, ...DRAFT_SCHEMA.properties }, required: ['key', ...DRAFT_SCHEMA.required] },
      description: '항목마다 하나',
    },
  },
  required: ['items'],
}
// 묶음의 글 크기 — 항목마다 지금 글 + 기록 글은 한 번만(한 기록이 항목 스무 곳에 걸려도 프롬프트에는 한 번 실린다)
const sizeOf = (gs) => {
  const recs = new Map(gs.flatMap((g) => g.records.map((r) => [r.id, r])))
  return gs.reduce((n, g) => n + (g.content || '').length, 0) + [...recs.values()].reduce((n, r) => n + r.title.length + r.body.length, 0)
}
// 묶음 — 문서 항목 자리만 같은 문서끼리 · 나머지(이름 바로잡기 · 넣은 파일)는 하나씩
export function batchesOf(groups, { max = BATCH_MAX, chars = BATCH_CHARS } = {}) {
  const out = []
  const open = new Map()
  for (const g of groups) {
    if (g.kind !== 'section' || max < 2) { out.push([g]); continue }
    const b = open.get(g.doc)
    if (b && b.length < max && sizeOf([...b, g]) <= chars) { b.push(g); continue }
    const nb = [g]
    open.set(g.doc, nb)
    out.push(nb)
  }
  return out
}
export function batchPromptOf(gs) {
  const recs = new Map()
  for (const g of gs) for (const r of g.records) recs.set(r.id, r)
  return [
    `문서 ${gs[0].doc.replace(/^docs\/|\.md$/g, '')} 의 항목 ${gs.length} 개를 새 기록에 맞게 각각 고쳐 쓴다. 항목마다 items 에 하나씩 · key 는 받은 그대로.`,
    '항목마다: 그 항목의 기록에 있는 값(수 · 이름 · 코드)은 그대로 옮기고, 기록에 없는 값을 지어내지 않는다. 옛 글의 값을 새 기록이 바꿨으면 새 값으로 바꾸고 drop 에 옛 값을 적는다. 그 항목에 넣을 것이 없는 기록은 left 에 까닭과 함께 둔다. used · left 에는 그 항목의 기록 id 만 쓴다.',
    ...([...recs.values()].some((r) => r.code) ? ['코드 커밋 기록은 「바뀐 값」 줄과 차이를 본다. 글에 옛 값이 있으면 새 값으로 고치고, 코드에 없는 설명은 지어내지 않는다. 그 항목 글과 상관없는 커밋은 left 에 둔다.'] : []),
    ...(gs.some((g) => g.records.some((r) => r.old)) ? [OLD_RULE.replace('붙은 기록은', '붙은 기록은(그 항목에서)')] : []),
    WRITE_RULES,
    'JSON 으로만 답한다.',
    // 옛 기록인지는 항목마다 다르다 — 항목의 기록 줄에 붙인다
    gs.map((g) => `[key ${spotKey(g)}] 항목 「${g.name}」\n그 항목의 기록: ${g.records.map((r) => (r.old ? `${r.id}(${OLD_MARK})` : r.id)).join(', ')}\n지금 글:\n${g.content || '(아직 없음)'}`).join('\n\n---\n\n'),
    `기록(오래된 것부터):\n${[...recs.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => recLine({ ...r, old: false })).join('\n\n')}`,
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
  const whole = x?.sec ? x.sec.body : ''
  if (sha16(whole) !== g.base) return { ok: false, why: '그사이 항목이 바뀌었다. 다음 정리 때 다시 만든다', stale: true }
  // 그사이 같은 항목에 새 기록이 왔으면 같이 넣어야 한다(표지가 그 기록까지 「넣음」 으로 보이게 되므로)
  const pendNow = k.works.filter((w) => w.state === 'pend' && w.touches.includes(g.coord)).map((w) => w.id)
  if (pendNow.some((x) => !ids.includes(x))) return { ok: false, why: '그사이 새 기록이 왔다. 다음 정리 때 같이 넣는다', stale: true }
  // 값 · 크기는 본문끼리 견준다(경과 줄은 저장이 지킨다)
  const cur = splitLog(whole).body
  // G6 — 표지 · 항목 머리 · 프런트매터 · script(소제목 ### 아래는 된다)
  if (BAD_TEXT(d.content)) return { ok: false, why: '글에 머리 · 표지가 들었다' }
  if (!d.content.trim() && cur.trim()) return { ok: false, why: '글을 비웠다' }
  // G5 — 근거보다 크게 쓰지 않는다
  const used = g.records.filter((r) => d.used.includes(r.id))
  const budget = cur.length + used.reduce((a, r) => a + r.body.length + r.title.length, 0) * 1.5 + 300
  if (d.content.length > budget) return { ok: false, why: '근거보다 크게 썼다' }
  // G4 — 값 대조: 넣은 기록의 값이 글에 있나(빠진 값) · 글의 값이 옛 글이나 기록에 있나(지어낸 값)
  const drop = new Set((d.drop || []).map((v) => String(v).replace(/\s+/g, '')))
  const now = valuesOf(d.content)
  const oldV = valuesOf(cur)
  const vOf = (rs) => new Set(rs.flatMap((r) => [...valuesOf(r.body + ' ' + r.title)]))
  const recV = vOf(used)
  // 코드 바뀜 기록은 「바뀐 값」 의 새 값만 글에 있어야 한다(차이 속의 다른 수 · 옛 값까지 요구하면 늘 남는다) ·
  //   옛 기록(지금 글에 더 늦게 쓴 기록이 이미 들어갔다)의 값은 글에 없어도 된다 — 더 새 값이 이겼을 수 있다
  const missing = [...new Set(used.filter((r) => !r.old).flatMap((r) => (r.code ? newValuesOf(r.body) : [...valuesOf(r.body)])))].filter((v) => !now.has(v) && !drop.has(v))
  if (missing.length) return { ok: false, why: `기록의 값이 글에 없다: ${missing.slice(0, 3).join(' · ')}` }
  const invented = [...now].filter((v) => !oldV.has(v) && !recV.has(v))
  if (invented.length) return { ok: false, why: `근거에 없는 값이 있다: ${invented.slice(0, 3).join(' · ')}` }
  const gone = [...oldV].filter((v) => !now.has(v))
  const came = [...now].filter((v) => !oldV.has(v))
  // 옛 기록은 지금 글의 값을 바꾸지 못한다 — 빠진 값이 있는데 새로 든 값이 옛 기록에서만 왔으면 되돌림이다
  const newerV = vOf(used.filter((r) => !r.old))
  const back = vOf(used.filter((r) => r.old))
  if (gone.length && came.some((v) => back.has(v) && !newerV.has(v))) return { ok: false, why: '더 늦게 쓴 기록이 이미 들어간 항목: 옛 기록은 값을 바꾸지 않는다' }
  const changed = gone.length && came.length ? [{ from: gone.join(' · '), to: came.join(' · ') }] : []
  return { ok: true, changed }
}

// 넣은 파일 검사 — 모양 · 후보 문서만 고친다 · 새 문서 경로 · 지문(그사이 바뀜) · 표지 · 크기 · 값 대조(빠짐 · 지어냄)
const BAD_TEXT = (t) => /^#{1,2}\s/m.test(t) || /<!--/.test(t) || /^---\s*$/m.test(t) || /<script/i.test(t)
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
    if (s && (!cur || sha16(cur.body) !== s.base)) return { ok: false, why: '그사이 항목이 바뀌었다. 다음 정리 때 다시 만든다', stale: true }
    const curBody = cur ? splitLog(cur.body).body : ''
    if (s && !u.content.trim() && curBody.trim()) return { ok: false, why: '글을 비웠다' }
    if (cur) {
      old += '\n' + curBody
      const a = valuesOf(curBody)
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
    if (k.byDocPath.get(docRel(p))) return { ok: false, why: '이미 있는 문서다. 새 문서가 아니라 고치기로' }
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
  if (missing.length) return { ok: false, why: `파일의 값이 글에 없다: ${missing.slice(0, 3).join(' · ')}` }
  const invented = [...now].filter((v) => !recV.has(v) && !oldV.has(v))
  if (invented.length) return { ok: false, why: `근거에 없는 값이 있다: ${invented.slice(0, 3).join(' · ')}` }
  return { ok: true, changed }
}

// 갈래 — 파일 이름 · 제목에 든 말로 고른다(Claude 없이). 문서 이름은 파일 이름이 아니라 갈래 · 주제(요구 15)
const KINDS = [
  [/회의록|회의|미팅|통화|면담|minutes|meeting/i, '회의록'],
  [/장애|사고|incident|postmortem/i, '장애 대응'],
  [/보고서|주간\s*보고|월간\s*보고|report/i, '보고서'],
]
export function kindOfName(s) {
  const hit = KINDS.find(([re]) => re.test(String(s)))
  return hit ? hit[1] : null
}
// 날짜 — 파일 이름의 YYYY-MM-DD · YYYYMMDD · YYYY.MM.DD
const DATE_RE = /(20\d\d)[-._ ]?(0[1-9]|1[0-2])[-._ ]?(0[1-9]|[12]\d|3[01])/
// 주제 — 파일 이름에서 날짜 · 번호 · 판 · 「최종」 같은 조각을 걷은 것(남는 것이 없으면 파일 이름)
export function topicOfName(file) {
  const base = String(file).split('/').pop().replace(/\.[^.]+$/, '')
  const t = base
    .replace(/_+/g, ' ')
    .replace(DATE_RE, ' ')
    .replace(/[([](?:최종|final|사본|copy|\d+)[)\]]/gi, ' ')
    .replace(/(^|[\s-])[vV]\d+(\.\d+)*(?=$|[\s-])|\d+\s*판|최종|final|사본|copy/gi, ' ')
    .replace(/^\s*\d+[. -]+/, ' ')
    .replace(/[\s-]\d{2,8}\s*$/, ' ')
    .replace(/\s*[-·]\s*$|^\s*[-·]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t || base
}

// 규칙으로 들이기(Claude 없이 · 이 PC 의 넣기가 바로 문서까지 갈 때) — 이름은 파일 이름이 아니라 갈래 · 주제로
//   갈래(회의록 · 장애 대응 · 보고서)가 보이면 그 갈래 문서의 새 항목 「언제 · 무엇」(갈래 문서가 없으면 세운다) — 글 속 머리는 굵은 글로
//   갈래가 없으면 주제(날짜 · 번호 · 판을 걷은 이름)로 새 문서(이름이 겹치면 -2 …) — 머리(##) 앞 글은 「개요」 · 머리마다 항목
//   이력에 「규칙으로」 와 까닭
export function ingestRule(k, g, { why = null } = {}) {
  const name = g.record.file.split('/').pop()
  const topic = topicOfName(g.record.file)
  const kind = kindOfName(name) || kindOfName(g.record.title)
  const why1 = why ? [`- Claude 로 하지 못한 까닭: ${why}`] : []
  if (kind) {
    const text = String(g.record.body).replace(/^# .*\n?/m, '').replace(/^#{2,6} (.+)$/gm, '**$1**').trim()
    if (!text) return null
    const dm = DATE_RE.exec(name)
    const when = dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : String(g.record.date || '').slice(0, 10)
    const what = topic.replace(new RegExp(`^${kind}\\s*`), '').trim() || topic
    const doc = k.byDocPath.get(docRel(kind))
    let heading = [when, what].filter(Boolean).join(' ') || kind
    for (let n = 2; doc && doc.sections.some((s) => s.h === heading); n++) heading = `${[when, what].filter(Boolean).join(' ')} (${n})`
    return {
      doc: kind,
      note: `갈래 「${kind}」 ${doc ? '문서에 새 항목' : '새 문서'} ${heading}`,
      input: {
        record: { title: `정리: ${name} 들임`, body: [`규칙으로: 갈래 「${kind}」 ${doc ? '문서에 새 항목' : '새 문서'} ${heading}`, ...why1].join('\n'), tags: ['curate-auto'], reflects: [g.record.id] },
        sections: [{ doc: docRel(kind), heading, content: text }],
      },
    }
  }
  const lines = String(g.record.body).replace(/^# .*\n?/m, '').split('\n')
  const secs = []
  let cur = { heading: '개요', content: [] }
  for (const l of lines) {
    const m = /^## (.+)$/.exec(l)
    if (m) {
      if (cur.content.join('\n').trim()) secs.push(cur)
      cur = { heading: m[1].trim(), content: [] }
    } else cur.content.push(l)
  }
  if (cur.content.join('\n').trim()) secs.push(cur)
  if (!secs.length) return null
  // 폴더 짜임은 그대로 · 마지막 이름만 주제로
  const dir = g.record.file.includes('/') ? g.record.file.slice(0, g.record.file.lastIndexOf('/') + 1) : ''
  const base = dir + topic
  let p = base
  for (let n = 2; k.byDocPath.get(docRel(p)); n++) p = `${base}-${n}`
  return {
    doc: p,
    note: '주제로 새 문서',
    input: {
      record: { title: `정리: ${name} 들임`, body: [`규칙으로: 주제 문서 ${p} · 항목 ${secs.length}`, ...why1].join('\n'), tags: ['curate-auto'], reflects: [g.record.id] },
      sections: secs.map((s) => ({ doc: docRel(p), heading: s.heading, content: s.content.join('\n').trim() })),
    },
  }
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
        title: `정리: ${name} 들임`,
        body: [`초안: 정리 일꾼${model ? `(${model})` : ''} · 넣음: kmd · 넣은 파일 ${g.record.id}`, ...(p ? [`- 새 문서 ${p}: 항목 ${news.length}`] : []), ...ups.map((u) => `- 고침 ${u.doc.replace(/^docs\/|\.md$/g, '')} › ${u.heading}`), ...(d.why ? [`- 까닭: ${d.why}`] : [])].join('\n'),
        tags: ['curate-llm'],
        reflects: [g.record.id],
      },
      sections: [...ups, ...news],
    }
  }
  if (g.kind === 'touches')
    return { record: { title: `이름 바로잡음: ${g.record.title.split(/ — |: /)[0]}`, body: `정리 일꾼이 이 기록이 바꾼 항목을 골랐다${d.why ? `: ${d.why}` : ''}`, touches: d.touches, tags: ['curate-llm', 'touches-fix'], fixes: [g.record.id], date: g.record.date } }
  const used = g.records.filter((r) => d.used.includes(r.id))
  return {
    record: {
      title: `정리: ${g.name}`,
      body: [`초안: 정리 일꾼${model ? `(${model})` : ''} · 넣음: kmd`, ...used.map((r) => `- 넣음 ${r.id}: ${r.title}`), ...d.left.map((x) => `- 둠 ${x.id}: ${x.why}`)].join('\n'),
      touches: [g.coord],
      tags: ['curate-llm'],
      curates: d.left.map((x) => ({ id: x.id, verdict: 'keep', rule: 'tidy', reason: x.why })),
      reflects: used.map((r) => r.id),
    },
    sections: [{ coord: g.coord, content: d.content, base: g.base }],
  }
}

export { coordsOfSection }
