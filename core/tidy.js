// 정리 — 아직 문서에 안 넣은 기록을 문서 항목에 넣는다(v0.6 §6 · KM81 — 검사를 넘으면 승인 없이 바로).
//
//   재료(material)   항목마다 묶음 하나 — 지금 글 · 지문(base) · 그 항목의 안 넣은 기록 · 기록의 값 장부.
//                    내주는 쪽에서 거른다: 「Claude 에 보내지 않음」 지식은 재료 0(나가기 전에 막는다) · private 태그 기록 뺌.
//                    이름이 없는 기록은 「이름 바로잡기」 묶음(후보 이름은 찾기 사다리가 준다).
//   초안(draft)      일꾼(claude -p)이 JSON 으로 — { content, used[], left[{id, why}], drop[] } / { touches[] }
//   검사(check)      G1 모양 · 기록마다 넣음(used) 또는 둠(left) · G2 base · G4 값 대조(빠진 값 · 지어낸 값) ·
//                    G5 크기 · G6 표지(항목 머리 # · ## · applied · 프런트매터 · script — 소제목 ### 아래는 된다).
//                    못 넘으면 「그대로 둔 것」(까닭 한 줄)
//   참고 줄          Claude 는 본문만 보고 쓴다 — 출처 줄은 문서 끝 참고 블록에 저장이 지키고 넣은 기록의 줄을 더한다
//                    초안 검사는 저장과 같은 문서 꼴 검사(core/docformat.js formatProblems)를 쓴다
//   넣기(apply)      작성자 kmd-auto · 태그 curate-llm · 항목 글 + 표지 · 둔 기록은 같은 기록의 curates(keep)
//
// 값이 바뀐 것(옛 글의 값이 빠지고 새 값이 들어감)은 그 기록을 쓴 사람의 「오늘 바뀐 것」 노란 줄이 된다.

import { sha16 } from './text.js'
import { formFor, DEFAULT_FORMS, FORM_GUIDE } from './guard.js'
import { sectionOf, coordsOfSection, labelOf, reflectedIn } from './knowledge.js'
// 코드 바뀜 기록(code-change)은 차이 속의 수를 다 볼 수 없다 — 「바뀐 값」 의 새 값만 글에 있어야 한다
import { newValuesOf } from './codechange.js'
import { valuesOf, mustValues } from './values.js'
import { WRITE_RULES } from './writerules.js'
import { ingestCandidates, formsOf, spotKey, topicOfName, DATE_RE, docRel } from './ingest.js'

// 옮긴 것(S2 · docs/품질개선/KMD_개편_설계.md 3-1) — 부르는 곳을 바꾸지 않게 다시 내보낸다. 이 파일은 S13 에 걷는다
//   검사 · 꼴 → core/gate.js · 값 장부 → core/values.js · 쓰기 규칙 → core/writerules.js · 들이기 후보 · 갈래 · 자리 열쇠 → core/ingest.js
export { check, applyDraft as applyEdits } from './gate.js'
export { knowledgeParts, mustValues, oldValues } from './values.js'
export { WRITE_RULES } from './writerules.js'
export { formsOf, spotKey, spotTarget, ingestCandidates, INGEST_SCHEMA, kindOfName, topicOfName } from './ingest.js'

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
    // 걸린 항목 수 — 여럿이면 기록의 값은 그 항목들에 나뉘어 들어간다(항목 하나에 기록의 값을 다 요구하지 않는다 · check)
    const spread = new Set(w.touches.map((c) => sectionOf(k, c)).filter((x) => x?.loc).map(keyOf)).size
    for (const c of w.touches) {
      const x = sectionOf(k, c)
      if (!x?.loc) continue
      // 이미 든 항목은 다시 정리하지 않는다 — 남은 항목만(한 항목이 걸려 다른 항목까지 매번 다시 쓰지 않게)
      if (reflectedIn(k, w, x.sec)) continue
      const key = keyOf(x)
      if (!groups.has(key)) groups.set(key, { kind: 'section', coord: c, doc: x.loc.doc, heading: x.sec ? x.sec.h : x.loc.heading, name: labelOf(k, c), content: x.sec ? x.sec.body : '', base: sha16(x.sec ? x.sec.body : ''), records: [], ...(since.has(key) ? { since: since.get(key) } : {}) })
      const g = groups.get(key)
      if (!g.records.some((r) => r.id === w.id)) g.records.push({ id: w.id, date: w.date, author: w.author, title: w.title, body: w.body, ...(w.tags.includes('code-change') ? { code: true } : {}), ...(spread > 1 ? { spread } : {}), ...(g.since && String(w.date) < g.since ? { old: true } : {}) })
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
    out.push({ kind: 'ingest', record: { id: w.id, date: w.date, author: w.author, title: w.title, body: w.body, file: w.tags.find((t) => t.startsWith('ingest/')).slice(7) }, docs: ingestCandidates(k, w), ...formsOf(k) })
  }
  return out
}

export function promptOf(g) {
  if (g.kind === 'ingest')
    return [
      '넣은 파일(기록)을 지식에 들인다. 후보 문서에 이어지는 내용이면 그 문서의 항목을 고쳐 쓰고(updates: 항목의 새 글 전체 · 후보에 없는 머리면 그 문서에 새 항목), 이어지는 문서가 없으면 새 문서를 세운다(newDoc: 경로와 항목들). 둘 다 해도 된다.',
      [
        '자리 고르기:',
        '- 문서 이름은 파일 이름이 아니라 그 글의 갈래 · 주제로 짓는다(예: 회의록 · 게이트웨이 설계 · 장애 대응). 날짜 · 번호 · 판 · 회사 약어 같은 파일 이름 조각은 문서 이름에 쓰지 않는다.',
        '- 같은 갈래의 문서가 후보에 있으면(예: 회의록) 새 문서를 세우지 않고 그 문서에 새 항목으로 넣는다. 항목 머리는 「언제 · 무엇」(예: 2026-10-21 HNC 통화).',
        '- 갈래 문서가 없으면 그 갈래 이름으로 새 문서를 세우고(예: newDoc.path = 회의록), 이 파일은 그 안의 항목 하나(머리 「언제 · 무엇」)로 둔다.',
        `- 이 지식의 갈래(갈래 장부): ${(g.forms || []).map((f) => `${f.folder ? f.folder + '/' : ''}${f.name}(${f.kind}${f.aliases?.length ? ' · ' + f.aliases.join(', ') : ''})`).join(' · ') || '없음'}. 다른 이름에 걸리는 글은 그 갈래 문서로 간다(newDoc.path 는 폴더/갈래 이름).${g.formsOwn ? ' 갈래 장부에 없는 새 문서는 세우지 않는다: 이어지는 후보 문서에 넣는다.' : ''}`,
        `- 새 문서는 그 갈래의 꼴을 따른다: 사건 갈래는 머리 「YYYY-MM-DD 무엇」 · 이름 패턴이 있는 대장은 머리 「값: 설명」. 머리와 글에 줄표 「—」 를 쓰지 않는다(풀이는 쌍점 · 문장 끊기는 마침표). 짜임은 ${FORM_GUIDE.지식문서} (사건 갈래는 ${FORM_GUIDE.작업기록}).`,
        '- 파일에 정한 것 · 바뀐 값 · 할 일이 있고 그 주제의 문서가 후보에 있으면, 그 문서의 해당 항목에도 그 내용을 고쳐 넣는다(updates).',
        '- 회의록은 이미 열린 회의 · 통화에서 정한 것 · 할 일만. 회의 · 통화를 준비하는 글(통화 스크립트 · 안건 · 준비 TODO · 체크리스트)은 회의록에 넣지 않고, 그 안의 확정 사실(구성 · 역할 · 범위 · 일정 · 규칙)을 그 주제 문서의 항목으로 넣는다.',
        '- 파일을 통째로 옮기지 않는다. 대상의 지금으로 요약 · 정리해 쓴다. 인사말 · 말할 거리 · 시간 배분 · 묻는 말 · 확인할 것 · 빈 칸 양식 · 메모 칸 · 준비 체크 상태 · 구분선은 옮기지 않는다(기록에 남는다).',
        '- 값을 담은 표 · 목록은 그 사실을 그대로 살려 둔다.',
        '- 항목 이름은 대상의 이름이다(예: 준비 · rp_mst 연구과제마스터). 날짜 · 「수정」 · 「추가」 를 이름에 넣지 않는다(회의록 · 사건 문서만 「YYYY-MM-DD 주제」).',
      ].join('\n'),
      WRITE_RULES,
      '옮기는 사실의 값(수 · 이름 · 코드)은 파일 그대로 정확히 쓰고, 파일에 없는 값을 지어내지 않는다. 옛 글의 값은 파일이 바꾼 것만 바꾼다. JSON 으로만 답한다.',
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
    '옛 글의 값을 새 기록이 바꿨으면 새 값으로 바꾸고 drop 에 옛 값을 적는다. 기록이 바꾸지 않은 옛 글의 값(버전 · 포트 · 이름 · 수)은 빼지 않는다. 넣을 것이 없는 기록은 left 에 까닭과 함께 둔다.',
    ...(g.records.some((r) => r.code) ? ['코드 커밋 기록은 「바뀐 값」 줄과 차이를 본다. 글에 옛 값이 있으면 새 값으로 고치고, 코드에 없는 설명은 지어내지 않는다. 이 항목 글과 상관없는 커밋은 left 에 둔다.'] : []),
    ...(g.records.some((r) => r.old) ? [OLD_RULE] : []),
    ...(g.records.some((r) => r.spread) ? [SPREAD_RULE] : []),
    MUST_RULE,
    WRITE_RULES,
    'JSON 으로만 답한다.',
    `지금 글:\n${g.content || '(아직 없음)'}`,
    `기록(오래된 것부터):\n${g.records.map((r) => recLine(r)).join('\n\n')}`,
  ].join('\n\n')
}

// 조각 초안(찾아 바꾸기) — 항목 글 전체를 다시 쓰지 않고 바꿀 곳만 받는다(작성기준 7절 · 나오는 글이 항목 크기가 아니라 바뀐 양을 따른다).
//   서버가 지금 글에 대어(applyEdits) 새 글을 만든 뒤 전체 초안과 같은 검사(G4 값 · G5 크기 · G6 꼴)를 거친다
export const PATCH_SCHEMA = {
  type: 'object',
  properties: {
    edits: { type: 'array', items: { type: 'object', properties: { find: { type: 'string', description: '지금 글에 꼭 한 번 나오는 글 그대로(한 줄 이상)' }, replace: { type: 'string', description: '그 자리에 들어갈 글' } }, required: ['find', 'replace'] }, description: '바꿀 곳마다 하나 · 차례대로 댄다' },
    rewrite: { type: 'string', description: '지금 글이 비었거나 고칠 곳이 글의 절반을 넘을 때만: 항목의 새 글 전체(그때는 edits 를 비운다)' },
    ...Object.fromEntries(Object.entries(DRAFT_SCHEMA.properties).filter(([k]) => k !== 'content')),
  },
  required: ['edits', 'used', 'left'],
}
export const PATCH_RULE = [
  '답 꼴(조각): 항목 글 전체를 다시 쓰지 않는다. 바꿀 곳만 edits 에 { find, replace } 로 쓴다.',
  '- find 는 지금 글에 꼭 한 번 나오는 글을 글자 그대로(줄바꿈 · 띄어쓰기 · 기호까지) 옮긴다. 짧아서 여러 곳에 맞을 것 같으면 앞뒤 줄을 더 붙인다.',
  '- 새 내용을 보탤 때는 이어질 자리의 줄을 find 로 잡고, replace 에 그 줄과 새 글을 같이 쓴다.',
  '- 값을 바꿀 때는 그 값이 든 줄을 find 로 잡고 replace 에 새 값으로 고친 줄을 쓴다(drop 에 옛 값).',
  '- 기록을 녹여 쓰는 규칙(위 항목 글 쓰기)은 replace 글에도 같다. 지금 글의 다른 곳은 건드리지 않는다.',
  '- 지금 글이 비었거나 고칠 곳이 글의 절반을 넘으면 edits 를 비우고 rewrite 에 새 글 전체를 쓴다.',
].join('\n')
export const patchPromptOf = (g) => [promptOf(g), PATCH_RULE].join('\n\n')
// 고쳐 쓰기 — 초안이 검사에 걸렸다. 같은 프롬프트에 지난 초안과 걸린 까닭을 붙여 한 번 더(일꾼이 자리마다 한 번만)
export function fixPromptOf(g, draft, why) {
  return [
    promptOf(g),
    `지난 초안이 kmd 검사에 걸렸다: ${why}`,
    '「조각이 지금 글에 맞지 않는다 · 여러 곳에 맞는다」 면 find 를 지금 글 그대로 더 길게 잡거나 rewrite 에 새 글 전체를 쓴다. 「기록의 값이 글에 없다」 면 그 값을 기록에 쓰인 글자 그대로(단위까지) 글에 넣는다. 그 항목에 맞지 않는 값이면 그 기록을 left 에 까닭과 함께 둔다. 「근거에 없는 값」 이면 지금 글과 기록에 없는 그 값을 빼거나 근거에 있는 값으로 바꾼다. 「옛 글의 값이 빠졌다」 면 그 값을 지금 글 그대로 되살린다. 기록이 그 값을 바꿨으면 새 값을 쓰고 drop 에 옛 값을 적는다. 나머지는 지난 초안을 그대로 두고 걸린 것만 고친다.',
    `지난 초안:\n${JSON.stringify(draft)}`,
  ].join('\n\n')
}

// 늦게 정리되는 옛 기록 — 지금 글에 이미 그보다 늦게 쓴 기록이 들어갔다(material 의 since)
const OLD_MARK = '지금 글보다 오래됨'
const OLD_RULE = `「${OLD_MARK}」 이 붙은 기록은 지금 글에 더 늦게 쓴 기록이 이미 들어간 뒤에 정리되는 옛 기록이다. 지금 글에 없는 내용만 보태고, 지금 글의 값을 그 기록의 값으로 바꾸지 않는다. 지금 글과 값이 다르면 그 기록은 left 에 「더 새 값이 이미 있다」 로 둔다.`
// 여러 항목에 걸린 기록 — 한 항목에는 그 항목에 맞는 것만(나머지는 다른 항목이 받는다)
const SPREAD_MARK = '항목 여러 곳에 걸림'
const SPREAD_RULE = `「${SPREAD_MARK}」 이 붙은 기록은 한 기록이 여러 항목을 바꿨다. 이 항목에는 이 항목에 맞는 내용 · 값만 옮긴다. 다른 항목의 내용은 그 항목이 받는다.`
// 꼭 옮길 값을 기록 끝에 적어 준다 — 검사(check 의 빠진 값)가 무엇을 보는지 claude 가 모르면 같은 값을 빼고 「다시 · N번째」 를 되풀이한다
const MUST_MARK = '글에 꼭 옮길 값'
const mustLine = (r, req) => {
  const vs = req && !r.code ? mustValues(r.body) : []
  return vs.length ? `\n(${MUST_MARK}: ${vs.map((v) => `「${v}」`).join(' · ')})` : ''
}
const recLine = (r, req = !r.old && !r.spread) => `[${r.id}] ${r.date} ${r.author}${r.old ? ` (${OLD_MARK})` : ''}${r.spread ? ` (${SPREAD_MARK} · ${r.spread})` : ''}: ${r.title}\n${r.body}${mustLine(r, req)}`
const MUST_RULE = `「${MUST_MARK}」 은 기록의 「바뀐 것」 에 든 값이다(요약 · 영향의 배포 자리 · 알릴 사람 같은 경위는 옮기지 않는다). 넣는 기록이면 그 값을 글자 그대로(단위까지) 글에 쓴다. 옛 글의 값을 바꿔 뺀 값만 drop 에 적는다. 그 항목에 맞지 않는 값이면 그 기록을 left 에 둔다.`

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
// 묶음이 다시 쓸 글(지금 글 합) 상한 — 답은 한 응답 안에서 차례로 나와 큰 항목 둘을 묶으면 7분에 끊겼다. 큰 항목은 혼자(따로 부르면 나란히 돈다)
export const BATCH_OUT = 3000
const outOf = (gs) => gs.reduce((n, g) => n + (g.content || '').length, 0)
//   isPatch(g) — 그 항목을 조각으로 쓰나(일꾼의 KMD_TIDY_PATCH). 조각 항목은 조각 항목끼리 묶고, 답이 바뀐 양만큼이라 다시 쓸 글 상한(outMax)을 보지 않는다(A9)
export function batchesOf(groups, { max = BATCH_MAX, chars = BATCH_CHARS, out: outMax = BATCH_OUT, isPatch = () => false } = {}) {
  const out = []
  const open = new Map()
  for (const g of groups) {
    const pt = g.kind === 'section' && !!isPatch(g)
    if (g.kind !== 'section' || max < 2 || (!pt && outOf([g]) > outMax)) { out.push([g]); continue }
    const key = pt ? `${g.doc}|조각` : g.doc
    const b = open.get(key)
    if (b && b.length < max && sizeOf([...b, g]) <= chars && (pt || outOf([...b, g]) <= outMax)) { b.push(g); continue }
    const nb = [g]
    open.set(key, nb)
    out.push(nb)
  }
  return out
}
// 조각 묶음(A9) — 한 문서의 항목 여럿을 한 번에 조각으로 · 항목마다 PATCH_SCHEMA 와 같은 초안
export const BATCH_PATCH_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: { type: 'object', properties: { key: { type: 'string', description: '항목의 key(그대로)' }, ...PATCH_SCHEMA.properties }, required: ['key', ...PATCH_SCHEMA.required] },
      description: '항목마다 하나',
    },
  },
  required: ['items'],
}
export const BATCH_PATCH_RULE = [PATCH_RULE, '- 묶음에서는 항목마다 items 하나에 key · edits(또는 rewrite) · used · left 를 쓴다. find 는 그 항목의 지금 글에서만 찾는다.'].join('\n')
export function batchPromptOf(gs, { patch = false } = {}) {
  const recs = new Map()
  for (const g of gs) for (const r of g.records) recs.set(r.id, r)
  return [
    `문서 ${gs[0].doc.replace(/^docs\/|\.md$/g, '')} 의 항목 ${gs.length} 개를 새 기록에 맞게 각각 고쳐 쓴다. 항목마다 items 에 하나씩 · key 는 받은 그대로.`,
    '항목마다: 그 항목의 기록에 있는 값(수 · 이름 · 코드)은 그대로 옮기고, 기록에 없는 값을 지어내지 않는다. 옛 글의 값을 새 기록이 바꿨으면 새 값으로 바꾸고 drop 에 옛 값을 적는다. 기록이 바꾸지 않은 옛 글의 값은 빼지 않는다. 그 항목에 넣을 것이 없는 기록은 left 에 까닭과 함께 둔다. used · left 에는 그 항목의 기록 id 만 쓴다.',
    ...([...recs.values()].some((r) => r.code) ? ['코드 커밋 기록은 「바뀐 값」 줄과 차이를 본다. 글에 옛 값이 있으면 새 값으로 고치고, 코드에 없는 설명은 지어내지 않는다. 그 항목 글과 상관없는 커밋은 left 에 둔다.'] : []),
    ...(gs.some((g) => g.records.some((r) => r.old)) ? [OLD_RULE.replace('붙은 기록은', '붙은 기록은(그 항목에서)')] : []),
    ...(gs.some((g) => g.records.some((r) => r.spread)) ? [SPREAD_RULE] : []),
    MUST_RULE,
    WRITE_RULES,
    'JSON 으로만 답한다.',
    // 옛 기록인지는 항목마다 다르다 — 항목의 기록 줄에 붙인다
    gs.map((g) => `[key ${spotKey(g)}] 항목 「${g.name}」\n그 항목의 기록: ${g.records.map((r) => (r.old ? `${r.id}(${OLD_MARK})` : r.id)).join(', ')}\n지금 글:\n${g.content || '(아직 없음)'}`).join('\n\n---\n\n'),
    `기록(오래된 것부터):\n${[...recs.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => recLine({ ...r, old: false }, gs.some((g) => g.records.some((x) => x.id === r.id && !x.old && !x.spread)))).join('\n\n')}`,
    // 조각 묶음 — 답 꼴은 맨 끝에(항목 글 전체를 다시 쓰지 않는다)
    ...(patch ? [BATCH_PATCH_RULE] : []),
  ].join('\n\n')
}

// 규칙으로 들이기(Claude 없이 · 이 PC 의 넣기가 바로 문서까지 갈 때) — 이름은 파일 이름이 아니라 갈래 · 주제로
//   갈래(회의록 · 장애 대응 · 보고서)가 보이면 그 갈래 문서의 새 항목 「언제 · 무엇」(갈래 문서가 없으면 세운다) — 글 속 머리는 굵은 글로
//   갈래가 없으면 주제(날짜 · 번호 · 판을 걷은 이름)로 새 문서(이름이 겹치면 -2 …) — 머리(##) 앞 글은 「개요」 · 머리마다 항목
//   이력에 「규칙으로」 와 까닭
export function ingestRule(k, g, { why = null } = {}) {
  const name = g.record.file.split('/').pop()
  const topic = topicOfName(g.record.file)
  const fm = formFor(k.forms || { rows: DEFAULT_FORMS }, topicOfName(name)) || formFor(k.forms || { rows: DEFAULT_FORMS }, g.record.title)
  const form = fm && fm.kind === '사건' ? fm : null
  const kind = form ? form.name : null
  const kindPath = form ? (form.folder ? `${form.folder}/${form.name}` : form.name) : null
  const why1 = why ? [`- Claude 로 하지 못한 까닭: ${why}`] : []
  // 기록 글 속 주석(<!-- -->)은 문서에 옮기지 않는다(작성기준 3절 — 본문만) ·
  //   줄표 「 — 」 는 문서에 쓰지 않는다(작성기준 v1.1 · 풀이는 쌍점): 코드 울타리 밖의 줄만 「: 」 로
  let fence = false
  const src = String(g.record.body).replace(/<!--[\s\S]*?-->/g, '').split('\n').map((l) => {
    if (/^\s*(?:`{3,}|~{3,})/.test(l)) fence = !fence
    return fence ? l : l.replace(/ — /g, ': ')
  }).join('\n')
  if (kind) {
    const text = src.replace(/^# .*\n?/m, '').replace(/^#{2,6} (.+)$/gm, '**$1**').trim()
    if (!text) return null
    const dm = DATE_RE.exec(name)
    const when = dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : String(g.record.date || '').slice(0, 10)
    const what = topic.replace(new RegExp(`^${kind}\\s*`), '').trim() || topic
    const doc = k.byDocPath.get(docRel(kindPath))
    let heading = [when, what].filter(Boolean).join(' ') || kind
    for (let n = 2; doc && doc.sections.some((s) => s.h === heading); n++) heading = `${[when, what].filter(Boolean).join(' ')} (${n})`
    return {
      doc: kindPath,
      note: `갈래 「${kind}」 ${doc ? '문서에 새 항목' : '새 문서'} ${heading}`,
      input: {
        record: { title: `정리: ${name} 들임`, body: [`규칙으로: 갈래 「${kind}」 ${doc ? '문서에 새 항목' : '새 문서'} ${heading}`, ...why1].join('\n'), tags: ['curate-auto'], reflects: [g.record.id] },
        sections: [{ doc: docRel(kindPath), heading, content: text }],
      },
    }
  }
  const lines = src.replace(/^# .*\n?/m, '').split('\n')
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
  const left = d.left.filter((x) => g.records.some((r) => r.id === x?.id))
  // 여러 항목에 걸린 기록을 이 항목에서 둔 것은 「이 항목에는 바꿀 것이 없다」 — 이 항목에 넣음 표지만 단다.
  //   두기(keep)로 적으면 기록 전체가 「넣지 않기로 둠」 이 되어 다른 항목에 넣을 것까지 묻힌다
  const spreadOf = (x) => g.records.find((r) => r.id === x.id)?.spread
  const pass = left.filter(spreadOf)
  const keep = left.filter((x) => !spreadOf(x))
  return {
    record: {
      title: `정리: ${g.name}`,
      body: [`초안: 정리 일꾼${model ? `(${model})` : ''} · 넣음: kmd`, ...used.map((r) => `- 넣음 ${r.id}: ${r.title}`), ...pass.map((x) => `- 이 항목에는 없음 ${x.id}: ${x.why}`), ...keep.map((x) => `- 둠 ${x.id}: ${x.why}`)].join('\n'),
      touches: [g.coord],
      tags: ['curate-llm'],
      curates: keep.map((x) => ({ id: x.id, verdict: 'keep', rule: 'tidy', reason: x.why })),
      reflects: [...used.map((r) => r.id), ...pass.map((x) => x.id)],
    },
    sections: [{ coord: g.coord, content: d.content, base: g.base }],
  }
}

export { coordsOfSection }
