// 항목 세우기 — 항목 장부(`_vocab.md`) · 문서 장부(`_managed.md`)에 항목을 더한다(요구 v0.2 R7 · R8).
//
//   names: [{ coord: '종류:값', label: '라벨', aliases?: ['별칭'], doc?: '문서', heading?: '머리' }]
//
// 글을 다시 짓지 않고 줄만 더하거나 바꾼다 — 사람이 적은 설명 · 순서는 그대로 남는다.
//   항목 장부 — `## 종류` 아래 `- \`종류:값\` — 라벨` · 이미 있으면 별칭만 보탠다(라벨은 사람이 정한 것을 지킨다)
//   문서 장부 — doc · heading 이 있으면 `| \`종류:값\` | \`docs/문서.md\` | \`## 머리\` |` · 같은 항목 줄이 있으면 바꾼다

import { nfc } from './text.js'
import { parseVocab } from './vocab.js'
import { TYPE_RE, parseForms, FORM_KINDS, formsOf } from './guard.js'

// 새로 서는 장부의 머리 글 — 이미 선 장부(옛 제목 「이름 장부」 · 「자리 장부」 · 표 머리 「| 이름 | 문서 | 항목 |」)는 고쳐 쓰지 않고 그대로 읽는다
const VOCAB_HEAD = '# 항목 장부\n\n항목마다 `종류:값` 하나를 정하고 같은 것을 가리키는 다른 말은 별칭으로 잇는다.\n'
const REG_TABLE = '| 항목 | 문서 | 머리 |\n|---|---|---|\n'
const REG_HEAD = `# 문서 장부\n\n항목 하나가 어느 문서의 어느 머리(\`##\`)인지 여기에만 적는다.\n\n${REG_TABLE}`
// 표 머리가 있나 — 새 꼴 「| 항목 |」 · 옛 꼴 「| 이름 |」 둘 다
const hasRegTable = (t) => /^\|\s*(?:항목|이름)\s*\|/m.test(t)

export const docRelOf = (doc) => `docs/${nfc(String(doc)).replace(/\\/g, '/').replace(/^docs\/|\.md$/g, '')}.md`

// 항목 장부 — 새 글(바뀐 것이 없으면 같은 글)
export function upsertVocab(text, names) {
  let t = String(text || '').replace(/\r\n/g, '\n')
  if (!t.trim()) t = VOCAB_HEAD
  for (const n of names) {
    const have = parseVocab(t).coords.get(n.coord)
    const lines = t.split('\n')
    if (have) {
      const add = (n.aliases || []).filter((a) => a && a !== have.label && !have.aliases.includes(a))
      if (!add.length) continue
      const i = lines.findIndex((l) => l.match(/^\s*-\s+`([^`]+)`/)?.[1]?.trim() === n.coord)
      const j = i + 1
      if (lines[j] && /^\s+aliases:/.test(lines[j])) lines[j] = `${lines[j].replace(/\s+$/, '')}, ${add.join(', ')}`
      else lines.splice(j, 0, `  aliases: ${add.join(', ')}`)
      t = lines.join('\n')
      continue
    }
    const type = n.coord.slice(0, n.coord.indexOf(':'))
    const entry = [`- \`${n.coord}\`: ${n.label || n.coord.slice(type.length + 1)}`, ...((n.aliases || []).length ? [`  aliases: ${n.aliases.join(', ')}`] : [])]
    const h = lines.findIndex((l) => l.trim() === `## ${type}`)
    if (h < 0) {
      t = `${t.replace(/\n*$/, '\n')}\n## ${type}\n\n${entry.join('\n')}\n`
      continue
    }
    // 그 갈래의 끝(다음 ## 앞) — 빈 줄은 건너 마지막 항목 바로 뒤에
    let end = h + 1
    while (end < lines.length && !/^##\s/.test(lines[end])) end++
    let at = end
    while (at > h + 1 && !lines[at - 1].trim()) at--
    if (at === h + 1) lines.splice(at, 0, '', ...entry)
    else lines.splice(at, 0, ...entry)
    t = lines.join('\n')
  }
  return t.endsWith('\n') ? t : t + '\n'
}

// 문서 장부 — 새 글
export function upsertRegistry(text, names) {
  let t = String(text || '').replace(/\r\n/g, '\n')
  if (!t.trim()) t = REG_HEAD
  if (!hasRegTable(t)) t = `${t.replace(/\n*$/, '\n')}\n${REG_TABLE}`
  for (const n of names) {
    if (!n.doc || !n.heading) continue
    const row = `| \`${n.coord}\` | \`${docRelOf(n.doc)}\` | \`## ${n.heading}\` |`
    const lines = t.split('\n')
    const i = lines.findIndex((l) => l.match(/^\|\s*`([^`]+)`/)?.[1]?.trim() === n.coord)
    if (i >= 0) {
      if (lines[i] === row) continue
      lines[i] = row
    } else {
      let last = -1
      lines.forEach((l, x) => { if (/^\|/.test(l)) last = x })
      lines.splice(last + 1, 0, row)
    }
    t = lines.join('\n')
  }
  return t.endsWith('\n') ? t : t + '\n'
}

// 들어온 항목(names) — 모양 검사 · 다듬기
export function cleanNames(list) {
  if (list == null) return []
  if (!Array.isArray(list) || list.length > 3000) return null
  const out = []
  for (const x of list) {
    if (!x || typeof x !== 'object') return null
    const coord = nfc(String(x.coord || '').trim())
    const i = coord.indexOf(':')
    if (i < 1 || !TYPE_RE.test(coord.slice(0, i)) || !/^[^\n`|]{1,160}$/.test(coord.slice(i + 1))) return null
    const one = (v, max) => (v == null ? null : nfc(String(v)).replace(/[\r\n`|]/g, ' ').trim().slice(0, max))
    out.push({ coord, label: one(x.label, 160) || '', aliases: Array.isArray(x.aliases) ? x.aliases.map((a) => one(a, 120).replace(/,/g, ' ')).filter(Boolean).slice(0, 20) : [], doc: one(x.doc, 200), heading: one(x.heading, 160) })
  }
  return out
}

// 문서 장부 — 패턴 줄 하나(`종류:*` → 문서의 `## {값}`) · 같은 패턴 줄이 있으면 그대로
export function upsertPatternRow(text, pattern, doc) {
  let t = String(text || '').replace(/\r\n/g, '\n')
  if (!t.trim()) t = REG_HEAD
  const lines = t.split('\n')
  if (lines.some((l) => l.match(/^\|\s*`([^`]+)`/)?.[1]?.trim() === pattern)) return t
  const row = `| \`${pattern}\` | \`${docRelOf(doc)}\` | \`## {값}\` |`
  let last = -1
  lines.forEach((l, x) => { if (/^\|/.test(l)) last = x })
  if (last < 0) lines.push('| 항목 | 문서 | 머리 |', '|---|---|---|', row)
  else lines.splice(last + 1, 0, row)
  t = lines.join('\n')
  return t.endsWith('\n') ? t : t + '\n'
}

// 이 저장 뒤의 갈래 목록 — 제안(core/propose.js)과 저장(core/save.js)이 같은 함수로 본다(지식 생성 하네스 H-D14 · 조사 Z V1).
//   갈래 장부가 없던 지식은 첫 갈래 줄이 서는 순간 기본 갈래가 사라진다: 제안도 그 뒤의 목록으로 판정한다(제안이 지나가면 저장도 지나간다).
//   raw — 지금 `_forms.md` 글(없으면 '') · formsIn — 이번에 세우는 갈래 줄
export const formsAfter = (raw, formsIn = []) => formsOf(formsIn.length ? upsertForms(raw || '', formsIn) : raw || '')

// 갈래 장부(`_forms.md`) — 갈래 줄을 더하거나 바꾼다(core/guard.js parseForms 와 같은 꼴)
const FORMS_HEAD = '# 갈래 장부\n\n새 문서는 여기 있는 갈래로만 선다. 문서 이름은 파일 이름이 아니라 갈래다(전화 통화 메모 → 회의록).\n\n| 갈래 | 별칭 | 폴더 | 종류 | 항목 | 서식 |\n|---|---|---|---|---|---|\n'
export function upsertForms(text, forms) {
  let t = String(text || '').replace(/\r\n/g, '\n')
  if (!t.trim()) t = FORMS_HEAD
  for (const f of forms) {
    const row = `| ${f.name} | ${(f.aliases || []).join(', ') || '-'} | ${f.folder || '-'} | ${f.kind || '대상'} | ${f.pattern ? '`' + f.pattern + '`' : '-'} | ${f.form || '-'} |`
    const lines = t.split('\n')
    // 갈래 표는 첫 「## 속성:」 머리 앞까지(속성 정의 표에 갈래 줄을 넣지 않는다)
    const propsAt = lines.findIndex((l) => /^##\s+속성\s*[:：]/.test(l))
    const end = propsAt < 0 ? lines.length : propsAt
    const i = lines.findIndex((l, x) => x < end && parseForms(l)[0]?.name === f.name)
    if (i >= 0) lines[i] = row
    else {
      let last = -1
      lines.forEach((l, x) => { if (x < end && /^\|/.test(l)) last = x })
      lines.splice(last + 1, 0, row)
    }
    t = lines.join('\n')
    // 속성 정의(서식 설계 F7) — props 가 오면 그 갈래의 「## 속성: <갈래>」 블록을 바꾼다(빈 목록이면 걷는다)
    if (Array.isArray(f.props)) {
      const ls = t.replace(/\n+$/, '').split('\n')
      const a = ls.findIndex((l) => new RegExp('^##\\s+속성\\s*[:：]\\s*' + f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$').test(l))
      if (a >= 0) {
        let b = ls.findIndex((l, x) => x > a && /^##\s/.test(l))
        if (b < 0) b = ls.length
        let s0 = a
        while (s0 > 0 && !ls[s0 - 1].trim()) s0--
        ls.splice(s0, b - s0)
      }
      t = ls.join('\n') + '\n'
      if (f.props.length) t += `\n## 속성: ${f.name}\n\n| 속성 | 원본 칸 | 쓰는 법 | 필수 |\n|---|---|---|---|\n${f.props.map((p) => `| ${p.name} | ${p.src || '-'} | ${p.how || '-'} | ${p.must ? '!' : '?'} |`).join('\n')}\n`
    }
  }
  return t.endsWith('\n') ? t : t + '\n'
}

// 들어온 갈래 — 모양 검사 · 다듬기
export function cleanForms(list) {
  if (list == null) return []
  if (!Array.isArray(list) || list.length > 200) return null
  const one = (v, max) => (v == null ? '' : nfc(String(v)).replace(/[\r\n`|]/g, ' ').trim().slice(0, max))
  const out = []
  for (const x of list) {
    if (!x || typeof x !== 'object') return null
    const name = one(x.name, 40)
    if (!name || /[/\\]/.test(name) || ['__proto__', 'prototype', 'constructor'].includes(name)) return null
    const pattern = x.pattern ? one(x.pattern, 60) : ''
    if (pattern && !/^[^:\s]+:\*$/.test(pattern)) return null
    let props
    if (x.props != null) {
      if (!Array.isArray(x.props) || x.props.length > 40) return null
      props = []
      for (const p of x.props) {
        const pn = one(p?.name, 40)
        if (!pn || ['__proto__', 'prototype', 'constructor', '속성'].includes(pn) || props.some((q) => q.name === pn)) return null
        props.push({ name: pn, src: one(p.src, 60) || null, how: one(p.how, 160) || null, must: p.must === true })
      }
    }
    out.push({ name, aliases: Array.isArray(x.aliases) ? x.aliases.map((a) => one(a, 40).replace(/,/g, ' ')).filter(Boolean).slice(0, 20) : [], folder: one(x.folder, 120).replace(/^docs\//, '').replace(/\/+$/, ''), kind: FORM_KINDS.includes(x.kind) ? x.kind : '대상', pattern: pattern || null, form: one(x.form, 40) || null, ...(props ? { props } : {}) })
  }
  return out
}

// 문서 장부 — 정확한 자리 줄(문서 짜임의 항목 옮기기 · 이름 · 합치기 · 나누기).
//   names: [{ coord, doc, heading }] — 그 항목이 이제 닿을 문서 · 머리
//   있는 정확한 줄은 제자리에서 고친다. 없으면 그 항목에 닿던 패턴 줄(`종류:*`) **위에** 끼운다(위에서 먼저 걸리는 줄을 쓴다 · core/registry.js) ·
//   패턴 줄도 없으면 표 끝에. 그 문서의 패턴 줄로 이미 그 머리에 닿으면(값 = 머리) 더하지 않는다. upsertRegistry 는 표 끝에 붙이므로 여기서 쓰지 않는다
export function placeExact(text, names) {
  let t = String(text || '').replace(/\r\n/g, '\n')
  if (!t.trim()) t = REG_HEAD
  if (!hasRegTable(t)) t = `${t.replace(/\n*$/, '\n')}\n${REG_TABLE}`
  const first = (l) => l.match(/^\|\s*`([^`]+)`/)?.[1]?.trim() ?? null
  for (const n of names) {
    if (!n?.coord || !n.doc || !n.heading) continue
    const coord = nfc(n.coord)
    const type = coord.slice(0, coord.indexOf(':'))
    const value = coord.slice(type.length + 1)
    const rel = docRelOf(n.doc)
    const row = `| \`${coord}\` | \`${rel}\` | \`## ${n.heading}\` |`
    const lines = t.split('\n')
    const i = lines.findIndex((l) => first(l) === coord)
    if (i >= 0) {
      if (lines[i] !== row) { lines[i] = row; t = lines.join('\n') }
      continue
    }
    const p = lines.findIndex((l) => first(l) === `${type}:*`)
    if (p >= 0) {
      const m = lines[p].match(/^\|\s*`[^`]+`\s*\|\s*`([^`]+)`\s*\|\s*`(#{1,6})\s+([^`]+)`/)
      if (m && nfc(m[1].trim()) === rel && m[2].length === 2 && nfc(m[3].trim()).replace('{값}', value) === nfc(n.heading)) continue
      lines.splice(p, 0, row)
    } else {
      let last = -1
      lines.forEach((l, x) => { if (/^\|/.test(l)) last = x })
      lines.splice(last + 1, 0, row)
    }
    t = lines.join('\n')
  }
  return t.endsWith('\n') ? t : t + '\n'
}
