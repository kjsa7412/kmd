// 이름 세우기 — 이름 장부(`_vocab.md`) · 자리 장부(`_managed.md`)에 이름을 더한다(요구 v0.2 R7 · R8).
//
//   names: [{ coord: '종류:값', label: '보이는 이름', aliases?: ['다른 이름'], doc?: '문서', heading?: '머리' }]
//
// 글을 다시 짓지 않고 줄만 더하거나 바꾼다 — 사람이 적은 설명 · 순서는 그대로 남는다.
//   이름 장부 — `## 종류` 아래 `- \`종류:값\` — 보이는 이름` · 이미 있으면 다른 이름만 보탠다(보이는 이름은 사람이 정한 것을 지킨다)
//   자리 장부 — doc · heading 이 있으면 `| \`종류:값\` | \`docs/문서.md\` | \`## 머리\` |` · 같은 이름 줄이 있으면 바꾼다

import { nfc } from './text.js'
import { parseVocab } from './vocab.js'

const VOCAB_HEAD = '# 이름 장부\n\n같은 것을 가리키는 이름 중 하나를 정하고 나머지를 다른 이름으로 잇는다.\n'
const REG_HEAD = '# 자리 장부\n\n이름 하나가 어느 문서의 어느 항목에 드는지 여기에만 적는다.\n\n| 이름 | 문서 | 항목 |\n|---|---|---|\n'

export const docRelOf = (doc) => `docs/${nfc(String(doc)).replace(/\\/g, '/').replace(/^docs\/|\.md$/g, '')}.md`

// 이름 장부 — 새 글(바뀐 것이 없으면 같은 글)
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
    const entry = [`- \`${n.coord}\` — ${n.label || n.coord.slice(type.length + 1)}`, ...((n.aliases || []).length ? [`  aliases: ${n.aliases.join(', ')}`] : [])]
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

// 자리 장부 — 새 글
export function upsertRegistry(text, names) {
  let t = String(text || '').replace(/\r\n/g, '\n')
  if (!t.trim()) t = REG_HEAD
  if (!/^\|\s*이름\s*\|/m.test(t)) t = `${t.replace(/\n*$/, '\n')}\n| 이름 | 문서 | 항목 |\n|---|---|---|\n`
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

// 들어온 이름 — 모양 검사 · 다듬기
export function cleanNames(list) {
  if (list == null) return []
  if (!Array.isArray(list) || list.length > 3000) return null
  const out = []
  for (const x of list) {
    if (!x || typeof x !== 'object') return null
    const coord = nfc(String(x.coord || '').trim())
    if (!/^[a-z][a-z0-9_-]{0,23}:[^\n`|]{1,160}$/.test(coord)) return null
    const one = (v, max) => (v == null ? null : nfc(String(v)).replace(/[\r\n`|]/g, ' ').trim().slice(0, max))
    out.push({ coord, label: one(x.label, 160) || '', aliases: Array.isArray(x.aliases) ? x.aliases.map((a) => one(a, 120).replace(/,/g, ' ')).filter(Boolean).slice(0, 20) : [], doc: one(x.doc, 200), heading: one(x.heading, 160) })
  }
  return out
}
