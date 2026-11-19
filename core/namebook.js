// 항목 세우기 — 항목 장부(`_vocab.md`) · 문서 장부(`_managed.md`)에 항목을 더한다(요구 v0.2 R7 · R8).
//
//   names: [{ coord: '종류:값', label: '라벨', aliases?: ['별칭'], doc?: '문서', heading?: '머리' }]
//
// 글을 다시 짓지 않고 줄만 더하거나 바꾼다 — 사람이 적은 설명 · 순서는 그대로 남는다.
//   항목 장부 — `## 종류` 아래 `- \`종류:값\`: 라벨` · 이미 있으면 별칭만 보탠다(라벨은 사람이 정한 것을 지킨다)
//     새 항목의 뜻 한 줄은 `  gist: …`(aliases 뒤) · 새 종류의 뜻은 `## 종류` 아래 `뜻: …` 한 줄(names 의 kindGist · 씨앗 종류는 적지 않는다)
//   문서 장부 — doc · heading 이 있으면 `| \`종류:값\` | \`docs/문서.md\` | \`## 머리\` |` · 같은 항목 줄이 있으면 바꾼다

import { nfc } from './text.js'
import { parseVocab } from './vocab.js'
import { TYPE_RE, parseForms, FORM_KINDS, formsOf, NATURES_HEAD, parseNatures } from './guard.js'

// 새로 서는 장부의 머리 글 — 이미 선 장부는 고쳐 쓰지 않는다(옛 제목 · 옛 표 머리는 core/oldform.js 가 지금 꼴로 옮긴다 · O-9)
const VOCAB_HEAD = '# 항목 장부\n\n항목마다 `종류:값` 하나를 정하고 같은 것을 가리키는 다른 말은 별칭으로 잇는다.\n'
const REG_TABLE = '| 항목 | 문서 | 머리 |\n|---|---|---|\n'
const REG_HEAD = `# 문서 장부\n\n항목 하나가 어느 문서의 어느 머리(\`##\`)인지 여기에만 적는다.\n\n${REG_TABLE}`
// 표 머리가 있나 — 「| 항목 | 문서 | 머리 |」
const hasRegTable = (t) => /^\|\s*항목\s*\|/m.test(t)

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
    const entry = [`- \`${n.coord}\`: ${n.label || n.coord.slice(type.length + 1)}`, ...((n.aliases || []).length ? [`  aliases: ${n.aliases.join(', ')}`] : []), ...(n.gist ? [`  gist: ${n.gist}`] : [])]
    const h = lines.findIndex((l) => l.trim() === `## ${type}`)
    if (h < 0) {
      t = `${t.replace(/\n*$/, '\n')}\n## ${type}\n\n${n.kindGist ? `뜻: ${n.kindGist}\n\n` : ''}${entry.join('\n')}\n`
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
    const gist = one(x.gist, 80)
    const kindGist = one(x.kindGist, 80)
    out.push({ coord, label: one(x.label, 160) || '', aliases: Array.isArray(x.aliases) ? x.aliases.map((a) => one(a, 120).replace(/,/g, ' ')).filter(Boolean).slice(0, 20) : [], doc: one(x.doc, 200), heading: one(x.heading, 160), ...(gist ? { gist } : {}), ...(kindGist ? { kindGist } : {}) })
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
//   naturesIn — 이번에 세우는 문서 성격 줄(엮기가 짓는다 · H-O6)
export const formsText = (raw, formsIn = [], naturesIn = []) => { const t = formsIn.length ? upsertForms(raw || '', formsIn) : raw || ''; return naturesIn.length ? upsertNatures(t, naturesIn) : t }
export const formsAfter = (raw, formsIn = [], naturesIn = []) => formsOf(formsText(raw, formsIn, naturesIn))

// 갈래 장부(`_forms.md`) — 갈래 줄을 더하거나 바꾼다(core/guard.js parseForms 와 같은 꼴)
const FORMS_HEAD = '# 갈래 장부\n\n모으는 갈래(같은 꼴의 항목이 쌓이는 문서)의 계약과 문서의 성격을 적는다. 문서 이름은 파일 이름이 아니라 갈래 · 주제다(전화 통화 메모 → 회의록).\n\n- 새 문서: 열림\n\n| 갈래 | 별칭 | 폴더 | 종류 | 항목 | 서식 |\n|---|---|---|---|---|---|\n'
export function upsertForms(text, forms) {
  let t = String(text || '').replace(/\r\n/g, '\n')
  if (!t.trim()) t = FORMS_HEAD
  for (const f of forms) {
    const row = `| ${f.name} | ${(f.aliases || []).join(', ') || '-'} | ${f.folder || '-'} | ${f.kind || '대상'} | ${f.pattern ? '`' + f.pattern + '`' : '-'} | ${f.form || '-'} |`
    const lines = t.split('\n')
    // 갈래 표는 첫 「## 」 머리 앞까지(속성 정의 표 · 문서 성격 표에 갈래 줄을 넣지 않는다)
    const propsAt = lines.findIndex((l) => /^##\s/.test(l))
    const end = propsAt < 0 ? lines.length : propsAt
    const i = lines.findIndex((l, x) => x < end && parseForms(l)[0]?.name === f.name)
    if (i >= 0) lines[i] = row
    else {
      let last = -1
      lines.forEach((l, x) => { if (x < end && /^\|/.test(l)) last = x })
      // 갈래 표가 아직 없는 장부(문서 성격 표만 있는 것)면 첫 「## 」 앞에 표 머리째 세운다(파일 맨 앞에 줄을 넣지 않는다)
      if (last < 0 && t.trim()) {
        let at = end
        while (at > 0 && !lines[at - 1].trim()) at--
        lines.splice(at, 0, ...(at > 0 ? [''] : []), '| 갈래 | 별칭 | 폴더 | 종류 | 항목 | 서식 |', '|---|---|---|---|---|---|', row, ...(at < lines.length && lines[at].trim() ? [''] : []))
      } else lines.splice(last + 1, 0, row)
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

// 문서 성격 표(「## 문서 성격」 · 파일 끝) — 문서마다 한 줄 · 이미 있는 문서의 줄은 고치지 않는다(으뜸 성격은 세울 때 한 번 정한다 · R3-4)
export function upsertNatures(text, rows) {
  let t = String(text || '').replace(/\r\n/g, '\n')
  if (!t.trim()) t = FORMS_HEAD
  const have = parseNatures(t)
  const add = []
  for (const r of rows) {
    const doc = nfc(String(r?.doc || '')).replace(/\\/g, '/').replace(/^docs\//, '').replace(/\.md$/, '').replace(/[\r\n`|]/g, ' ').trim()
    if (!doc || have.has(doc) || add.some((x) => x.doc === doc) || !FORM_KINDS.includes(r.nature)) continue
    add.push({ doc, nature: r.nature, summary: nfc(String(r.summary || '')).replace(/[\r\n`|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) })
  }
  if (!add.length) return t.endsWith('\n') ? t : t + '\n'
  const lines = t.replace(/\n+$/, '').split('\n')
  let a = lines.findIndex((l) => l.trim() === NATURES_HEAD)
  if (a < 0) { lines.push('', NATURES_HEAD, '', '| 문서 | 성격 | 요약 |', '|---|---|---|'); a = lines.length - 3 }
  let b = lines.findIndex((l, x) => x > a && /^##\s/.test(l))
  if (b < 0) b = lines.length
  let last = -1
  lines.forEach((l, x) => { if (x > a && x < b && /^\|/.test(l)) last = x })
  const out = add.map((r) => `| ${r.doc} | ${r.nature} | ${r.summary || '-'} |`)
  if (last < 0) lines.splice(a + 1, 0, '', '| 문서 | 성격 | 요약 |', '|---|---|---|', ...out)
  else lines.splice(last + 1, 0, ...out)
  return lines.join('\n') + '\n'
}
export function cleanNatures(list) {
  if (list == null) return []
  if (!Array.isArray(list) || list.length > 200) return null
  const out = []
  for (const x of list) {
    if (!x || typeof x !== 'object' || typeof x.doc !== 'string' || !FORM_KINDS.includes(x.nature)) return null
    const doc = nfc(x.doc).replace(/\\/g, '/').replace(/^docs\//, '').replace(/\.md$/, '').trim()
    if (!doc || doc.length > 200 || /[\r\n`|]/.test(doc) || doc.split('/').some((p) => !p.trim() || p === '.' || p === '..' || ['__proto__', 'prototype', 'constructor'].includes(p))) return null
    out.push({ doc, nature: x.nature, summary: nfc(String(x.summary || '')).replace(/[\r\n`|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) })
  }
  return out
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

// 항목 장부: 머리 이름 바꾸기(kmd-migrate rename · core/restructure.js items 의 relabel)
//   renames: [{ coord, from(옛 머리), to(새 머리) }]: 라벨이 옛 머리와 같으면 새 머리로 · 옛 머리는 별칭으로 남긴다(옛 이름으로도 찾게)
//   별칭으로 남기지 않는 것: 이미 라벨 · 별칭인 말 · 다른 항목의 라벨 · 별칭(같은 말이 두 항목을 가리키지 않게) · 쉼표가 든 말(별칭 줄을 쉼표로 가른다)
//   → { text, done: [한 줄 말], skipped: [까닭] }
export function relabelVocab(text, renames) {
  const t0 = String(text || '').replace(/\r\n/g, '\n')
  const lines = t0.split('\n')
  const done = []
  const skipped = []
  const at = (coord) => lines.findIndex((l) => l.match(/^\s*-\s+`([^`]+)`/)?.[1]?.trim() === coord)
  for (const r of Array.isArray(renames) ? renames : []) {
    const coord = nfc(String(r?.coord || ''))
    const from = nfc(String(r?.from || '')).trim()
    const to = nfc(String(r?.to || '')).trim()
    if (!coord || !from || !to || from === to) continue
    const i = at(coord)
    if (i < 0) continue
    const voc = parseVocab(lines.join('\n')).coords
    const have = voc.get(coord)
    let label = have.label
    if (label === from) {
      lines[i] = lines[i].replace(/^(\s*-\s+`[^`]+`).*$/, `$1: ${to}`)
      label = to
      done.push(`라벨: ${coord} ${from} → ${to}`)
    }
    let aliases = [...new Set(have.aliases.filter((a) => a !== label))]
    const other = [...voc.values()].find((v) => v.coord !== coord && (v.label === from || v.aliases.includes(from)))
    if (from === label || aliases.includes(from)) { /* 이미 있다 */ }
    else if (/[,，]/.test(from)) skipped.push(`별칭으로 남기지 않음(쉼표가 든 말): ${coord} ${from}`)
    else if (other) skipped.push(`별칭으로 남기지 않음(다른 항목 ${other.coord} 의 말): ${coord} ${from}`)
    else { aliases = [...aliases, from]; done.push(`별칭: ${coord} + ${from}`) }
    if (aliases.join('\u0001') === have.aliases.join('\u0001')) continue
    // 별칭 줄은 그 항목의 하위 줄 어디든 있을 수 있다(gist · deprecated 뒤 · 다음 항목 줄이나 들여쓰지 않은 줄 앞까지) · 여럿이면 하나로 합친다
    const row = `  aliases: ${aliases.join(', ')}`
    const subs = []
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]) && !/^\s*-\s+`/.test(lines[j]); j++) if (/^\s+aliases:/.test(lines[j])) subs.push(j)
    for (const j of subs.slice(1).reverse()) lines.splice(j, 1)
    if (subs.length) { if (aliases.length) lines[subs[0]] = row; else lines.splice(subs[0], 1) }
    else if (aliases.length) lines.splice(i + 1, 0, row)
  }
  return { text: lines.join('\n'), done, skipped }
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

// ── 장부 고침(지식 생성 하네스 H7 · H-O12 · H-D24) — 지식관리자가 항목 장부의 과거 결정을 거둔다 ──
//   ops: [{ op: 'retire', coord, to?, why? }      폐기 — 그 줄에 「deprecated: <날짜>[ → 새 항목]: 까닭」(줄은 지우지 않는다)
//         { op: 'merge', coord, into }             합치기 — coord 를 폐기하고 into 로 잇는다 · coord 의 라벨 · 별칭을 into 의 별칭으로 옮긴다
//         { op: 'unalias', coord, alias }          별칭 빼기 — 그 항목의 별칭 하나를 걷는다
//         { op: 'gist', coord, gist }              뜻 한 줄 적기 — 그 항목이 무엇인가 한 줄(80자 안 · 있으면 갈음한다 · H12)
//         { op: 'kind', kind, gist }]              종류 뜻 줄 적기 — 「## 종류」 머리 아래 「뜻: …」 한 줄(80자 안 · 있으면 갈음한다 · R5-1 라 · 그 종류 절이 있어야 한다)
//   → { text, done: [한 줄 말], errors: [까닭] } · 오류가 하나라도 있으면 text 는 처음 글 그대로다(아무것도 고치지 않는다)
export function ledgerOps(text, ops, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const t0 = String(text || '').replace(/\r\n/g, '\n')
  let lines = t0.split('\n')
  const done = []
  const errors = []
  const one = (v, max) => nfc(String(v ?? '')).replace(/[\r\n`|]/g, ' ').trim().slice(0, max)
  const at = (coord) => lines.findIndex((l) => l.match(/^\s*-\s+`([^`]+)`/)?.[1]?.trim() === coord)
  const endOf = (i) => { let j = i + 1; while (j < lines.length && /^\s+\S/.test(lines[j])) j++; return j }
  const retire = (coord, to, why) => {
    const i = at(coord)
    if (i < 0) { errors.push(`「${coord}」 는 항목 장부에 없다`); return false }
    const j = endOf(i)
    if (lines.slice(i + 1, j).some((l) => /^\s+deprecated:/.test(l))) { errors.push(`「${coord}」 는 이미 폐기된 항목이다`); return false }
    if (to && at(to) < 0) { errors.push(`이을 항목 「${to}」 가 항목 장부에 없다`); return false }
    lines.splice(j, 0, `  deprecated: ${today}${to ? ` → ${to}` : ''}: ${why || '지식관리자가 폐기'}`)
    return true
  }
  const addAliases = (coord, add) => {
    const i = at(coord)
    const have = parseVocab(lines.join('\n')).coords.get(coord)
    const xs = add.filter((a) => a && a !== have.label && !have.aliases.includes(a))
    if (!xs.length) return
    if (lines[i + 1] && /^\s+aliases:/.test(lines[i + 1])) lines[i + 1] = `${lines[i + 1].replace(/\s+$/, '')}, ${xs.join(', ')}`
    else lines.splice(i + 1, 0, `  aliases: ${xs.join(', ')}`)
  }
  for (const o of Array.isArray(ops) ? ops : []) {
    if (o?.op === 'kind') {
      const kind = one(o.kind, 40)
      const gist = one(o.gist, 80)
      const h = lines.findIndex((l) => /^##\s/.test(l) && nfc(l.replace(/^##\s+/, '').trim()) === kind)
      if (!kind || h < 0) { errors.push(`「${kind}」 종류 절(## ${kind})이 항목 장부에 없다`); continue }
      if (!gist) { errors.push(`「${kind}」 종류의 뜻(gist)이 비었다`); continue }
      let e = h + 1
      while (e < lines.length && !/^##\s/.test(lines[e])) e++
      const g = lines.slice(h + 1, e).findIndex((l) => /^뜻\s*[:：]/.test(l))
      if (g >= 0) lines[h + 1 + g] = `뜻: ${gist}`
      else lines.splice(h + 1, 0, '', `뜻: ${gist}`)
      done.push(`종류 뜻: ${kind}`)
      continue
    }
    const coord = one(o?.coord, 200)
    if (!coord) { errors.push('항목(coord)이 없다'); continue }
    if (o.op === 'retire') {
      const to = o.to ? one(o.to, 200) : ''
      if (to === coord) { errors.push(`「${coord}」 를 자기 자신으로 이을 수 없다`); continue }
      if (retire(coord, to, one(o.why, 120))) done.push(`폐기: ${coord}${to ? ` → ${to}` : ''}`)
    } else if (o.op === 'merge') {
      const into = one(o.into, 200)
      if (!into || into === coord) { errors.push(`합칠 곳(into)이 없거나 같은 항목이다: ${coord}`); continue }
      const v = parseVocab(lines.join('\n')).coords
      const from = v.get(coord)
      if (!from) { errors.push(`「${coord}」 는 항목 장부에 없다`); continue }
      if (v.get(into)?.deprecated) { errors.push(`합칠 곳 「${into}」 는 폐기된 항목이다`); continue }
      if (!retire(coord, into, one(o.why, 120) || '합침')) continue
      addAliases(into, [from.label, ...from.aliases].map((a) => one(a, 120).replace(/,/g, ' ')))
      done.push(`합침: ${coord} → ${into}`)
    } else if (o.op === 'unalias') {
      const alias = one(o.alias, 120)
      const i = at(coord)
      if (i < 0) { errors.push(`「${coord}」 는 항목 장부에 없다`); continue }
      const j = lines[i + 1] && /^\s+aliases:/.test(lines[i + 1]) ? i + 1 : -1
      const xs = j < 0 ? [] : lines[j].replace(/^\s+aliases:\s*/, '').split(',').map((x) => nfc(x.trim())).filter(Boolean)
      if (!alias || !xs.includes(alias)) { errors.push(`「${coord}」 에 별칭 「${alias}」 이 없다`); continue }
      const left = xs.filter((x) => x !== alias)
      if (left.length) lines[j] = `  aliases: ${left.join(', ')}`
      else lines.splice(j, 1)
      done.push(`별칭 뺌: ${coord} 의 「${alias}」`)
    } else if (o.op === 'gist') {
      const gist = one(o.gist, 80)
      const i = at(coord)
      if (i < 0) { errors.push(`「${coord}」 는 항목 장부에 없다`); continue }
      if (!gist) { errors.push(`「${coord}」 의 뜻 한 줄(gist)이 비었다`); continue }
      const j = endOf(i)
      const g = lines.slice(i + 1, j).findIndex((l) => /^\s+gist:/.test(l))
      if (g >= 0) lines[i + 1 + g] = `  gist: ${gist}`
      else lines.splice(j, 0, `  gist: ${gist}`)
      done.push(`뜻 한 줄: ${coord}`)
    } else errors.push(`모르는 걸음: ${String(o?.op).slice(0, 20)}`)
  }
  if (errors.length) return { text: t0, done: [], errors }
  const out = lines.join('\n')
  return { text: out.endsWith('\n') ? out : out + '\n', done, errors }
}

// ── 되돌림이 걷는 줄(H6 · H-D24) — 그 기록이 세운 문서 장부 줄 · 갈래 줄 · 문서 성격 줄. 없는 줄은 그대로 지나간다 ──
const cellOf = (l) => l.split('|').map((x) => x.trim())
export function dropRegistryRows(text, coords) {
  const set = new Set((coords || []).map((c) => nfc(String(c))))
  if (!set.size || !text) return text || ''
  return String(text).split('\n').filter((l) => !set.has(nfc(l.match(/^\|\s*`([^`]+)`/)?.[1]?.trim() || '\u0000'))).join('\n')
}
export function dropFormRows(text, names) {
  const set = new Set((names || []).map((c) => nfc(String(c)).trim()))
  if (!set.size || !text) return text || ''
  const lines = String(text).split('\n')
  const end = lines.findIndex((l) => /^##\s/.test(l))
  return lines.filter((l, i) => !((end < 0 || i < end) && /^\|/.test(l) && set.has(nfc(cellOf(l)[1] || '')))).join('\n')
}
export function dropNatureRows(text, docs) {
  const set = new Set((docs || []).map((c) => nfc(String(c)).replace(/^docs\//, '').replace(/\.md$/, '').trim()))
  if (!set.size || !text) return text || ''
  const lines = String(text).split('\n')
  const a = lines.findIndex((l) => l.trim() === NATURES_HEAD)
  if (a < 0) return text
  let b = lines.findIndex((l, x) => x > a && /^##\s/.test(l))
  if (b < 0) b = lines.length
  return lines.filter((l, i) => !(i > a && i < b && /^\|/.test(l) && set.has(nfc(cellOf(l)[1] || '')))).join('\n')
}
