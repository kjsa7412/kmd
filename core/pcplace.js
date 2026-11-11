// 규칙 길 — Claude 없이 원본 하나를 갈래 · 주제 문서의 항목으로(저장 승인 설계 P-D35 · P6 · PC4).
//
// 개인 프로그램의 옛 「저장 즉시 넣기」(재료 material · 초안 · 넣기 planSave · DRAFT_SCHEMA · TOUCH_SCHEMA)는 PC6 에서 걷었다(저장 승인 설계 b22 · b23) —
// 기록과 문서는 저장 문 한 번에 들어간다(사람 채널은 승인한 제안 · 무인 채널은 FIX 고리 → 규칙 길). 남은 것은 규칙 길 하나:
//   ruleSections(갈래 · 주제 문서의 항목 조각) · ruleText(문서 꼴을 지나는 원문) · ingestRule(규칙 길 save 입력)
// 부르는 곳: server/hub.js(rulePut · 정정 · 개인 들이기).

import { formFor, DEFAULT_FORMS } from './guard.js'
import { coordsOfSection } from './knowledge.js'
import { topicOfName, DATE_RE, docRel } from './ingest.js'
import { formatCheck } from './docformat.js'

// 규칙 길(저장 승인 설계 P-D35 · P6) — Claude 없이 원본 하나를 갈래 · 주제 문서의 항목으로. 팀 저장 문의 무인 채널(hub 들이기 · 가져올 곳 · 정정 ·
//   다시 들이기)과 이 PC 의 넣기(ingestRule · PC4 부터 개인 들이기)가 같은 함수를 쓴다.
//   이름은 파일 이름이 아니라 갈래 · 주제로:
//   갈래(사건 갈래 · 회의록 · 장애 대응 · 보고서)가 보이면 그 갈래 문서의 새 항목 「언제 · 무엇」(갈래 문서가 없으면 세운다) — 글 속 머리는 굵은 글로
//   갈래가 없으면 주제(날짜 · 번호 · 판을 걷은 이름)로 새 문서(이름이 겹치면 -2 …) — 머리(##) 앞 글은 「개요」 · 머리마다 항목.
//   home — 그 주제 문서를 둘 폴더(팀 · 개인 approve: 서버 고정 갈래 「들인 자료」 · 없으면 원본 폴더 짜임 그대로 = 이 PC 옛 꼴)
//   글은 원문 그대로 옮기되 문서 꼴(E_FORMAT)을 지나도록 짓는다(ruleText) · 항목은 저장 한 번 상한(RULE_MAX)까지(넘는 머리는 끝 항목에 굵은 글로)
//   src { file, title, body, date } → { doc(.md 없는 경로), kind(갈래 | null), fresh(새 문서), note, line, sections[{ doc, heading, content }] } | null(넣을 글이 없다)
export const RULE_MAX = 50 // core/save.js SECTIONS_MAX
export function ruleSections(k, src, { home = null, max = RULE_MAX } = {}) {
  const file = String(src?.file || src?.title || '들인 것').replace(/\\/g, '/')
  const name = file.split('/').pop()
  const topic = topicOfName(file)
  const forms = k.forms || { rows: DEFAULT_FORMS }
  const fm = formFor(forms, topicOfName(name)) || formFor(forms, String(src?.title || ''))
  const form = fm && fm.kind === '사건' ? fm : null
  const kind = form ? form.name : null
  const kindPath = form ? (form.folder ? `${form.folder}/${form.name}` : form.name) : null
  // 기록 글 속 주석(<!-- -->)은 문서에 옮기지 않는다(작성기준 3절 — 본문만) ·
  //   줄표 「 — 」 는 문서에 쓰지 않는다(작성기준 v1.1 · 풀이는 쌍점): 코드 울타리 밖의 줄만 「: 」 로
  let fence = false
  const text0 = String(src?.body ?? '').replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').map((l) => {
    if (/^\s*(?:`{3,}|~{3,})/.test(l)) fence = !fence
    return fence ? l : l.replace(/ — /g, ': ')
  }).join('\n')
  if (kind) {
    const text = ruleText(text0.replace(/^# .*\n?/m, '').replace(/^#{2,6} (.+)$/gm, '**$1**').trim(), docRel(kindPath))
    if (!text) return null
    const dm = DATE_RE.exec(name)
    const when = dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : String(src?.date || '').slice(0, 10)
    const what = (topic.startsWith(kind) ? topic.slice(kind.length) : topic).trim() || topic
    const doc = k.byDocPath.get(docRel(kindPath))
    let heading = [when, what].filter(Boolean).join(' ') || kind
    for (let n = 2; doc && doc.sections.some((s) => s.h === heading); n++) heading = `${[when, what].filter(Boolean).join(' ')} (${n})`
    const note = `갈래 「${kind}」 ${doc ? '문서에 새 항목' : '새 문서'} ${heading}`
    return { doc: kindPath, kind, fresh: !doc, note, line: note, sections: [{ doc: docRel(kindPath), heading, content: text }] }
  }
  const lines = text0.replace(/^# .*\n?/m, '').split('\n')
  let secs = []
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
  // 같은 머리가 둘이면 (2) … · 저장 한 번 상한을 넘는 머리는 끝 항목에 굵은 글로
  const seen = new Map()
  secs = secs.map((s) => { const n = (seen.get(s.heading) || 0) + 1; seen.set(s.heading, n); return n > 1 ? { ...s, heading: `${s.heading} (${n})` } : s })
  if (secs.length > max) {
    const tail = secs.slice(max - 1)
    secs = [...secs.slice(0, max - 1), { heading: tail[0].heading, content: [tail[0].content.join('\n'), ...tail.slice(1).map((s) => `**${s.heading}**\n${s.content.join('\n')}`)] }]
  }
  // 폴더 짜임은 그대로 · 마지막 이름만 주제로(home 이 있으면 그 폴더 아래 · 주제는 40자 안)
  const dir = home ? `${home}/` : file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : ''
  const base = dir + (home ? topic.slice(0, 36).trim() || '들인 것' : topic)
  let p = base
  for (let n = 2; k.byDocPath.get(docRel(p)); n++) p = `${base}-${n}`
  return {
    doc: p,
    kind: null,
    fresh: true,
    note: '주제로 새 문서',
    line: `주제 문서 ${p} · 항목 ${secs.length}`,
    sections: secs.map((s) => ({ doc: docRel(p), heading: s.heading, content: ruleText(s.content.join('\n').trim(), docRel(p)) })).filter((s) => s.content),
  }
}
// 규칙 길 글 — 원문을 옮기되 문서 꼴(작성기준 8절 · E_FORMAT)을 지나게: 울타리 밖의 # · ## 머리 줄은 굵은 글 · 닫히지 않은 울타리는 닫는다 ·
//   그래도 걸리는 줄(기록 · 시스템 링크 · 참고 표식 · 경과 꼬리)이 남으면 글 전체를 울타리 안 원문으로 둔다(지나도록 짓는다 · 손으로 고치지 않는다)
export function ruleText(text0, doc = null) {
  let fence = null
  let t = String(text0 ?? '').replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').map((l) => {
    const f = l.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (f) { fence = !fence ? f[1] : f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence; return l }
    if (fence) return l
    const h = /^\s{0,3}#{1,2}\s+(.+?)\s*#*\s*$/.exec(l)
    return h ? `**${h[1]}**` : l
  }).join('\n').trim()
  if (fence) t += `\n${fence}`
  if (!t || !formatCheck(t, { doc }).problems.length) return t
  const n = Math.max(2, ...[...t.matchAll(/`{3,}/g)].map((m) => m[0].length)) + 1
  return `${'`'.repeat(n)}text\n${t}\n${'`'.repeat(n)}`
}

// 규칙으로 들이기(Claude 없이 · 이 PC 의 넣기가 바로 문서까지 갈 때) — ruleSections 위의 PC 꼴(작성자 kmd-auto · curate-auto · reflects) · 이력에 「규칙으로」 와 까닭
export function ingestRule(k, g, { why = null, home = null } = {}) {
  const r = ruleSections(k, { file: g.record.file, title: g.record.title, body: g.record.body, date: g.record.date }, { home })
  if (!r) return null
  const name = g.record.file.split('/').pop()
  return {
    doc: r.doc,
    note: r.note,
    input: {
      record: { title: `정리: ${name} 들임`, body: [`규칙으로: ${r.line}`, ...(why ? [`- Claude 로 하지 못한 까닭: ${why}`] : [])].join('\n'), tags: ['curate-auto'], reflects: [g.record.id] },
      sections: r.sections,
    },
  }
}

export { coordsOfSection }
