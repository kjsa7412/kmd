// 프런트매터 — 기록(`work/<id>.md`)의 머리.
//
// 읽을 때는 너그럽게(사람이 손으로 쓴 기록도 읽힌다), 쓸 때는 kmd 가 정한 모양
// 하나로만 쓴다. 값은 js-yaml 이 인용하므로 줄바꿈 · `---` 로 머리를 깨지 못한다.

import yaml from 'js-yaml'
import { nfc } from './text.js'

const FM = /^---\n([\s\S]*?)\n---(?:\n|$)/

// js-yaml 은 인용 없는 2026-10-23 을 Date 로 만든다 — UTC 로 읽고 UTC 로 되돌린다
function normDate(v) {
  if (v == null) return null
  if (v instanceof Date) {
    const iso = v.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ')
  }
  return String(v).trim()
}

const list = (v) => (v == null ? [] : (Array.isArray(v) ? v : [v]).filter((x) => x != null).map((x) => nfc(String(x).trim())).filter(Boolean))

export function splitFrontmatter(text) {
  const m = text.match(FM)
  if (!m) return { data: null, body: text }
  let data = null
  try {
    data = yaml.load(m[1], { schema: yaml.DEFAULT_SCHEMA })
  } catch {
    data = null
  }
  return { data: data && typeof data === 'object' ? data : null, body: text.slice(m[0].length) }
}

// 기록 하나 — 머리가 없거나 id 가 없으면 기록이 아니다(null)
export function parseRecord(text, file) {
  const { data, body } = splitFrontmatter(text)
  if (!data) return null
  const id = nfc(String(data.id ?? file.replace(/\.md$/i, '')).trim())
  if (!id) return null
  return {
    id,
    title: nfc(String(data.title ?? id).trim()),
    date: normDate(data.date) || '',
    author: data.author != null ? nfc(String(data.author).trim()) : '',
    touches: list(data.touches),
    tags: list(data.tags),
    fixes: data.supersedes != null ? list(typeof data.supersedes === 'object' && !Array.isArray(data.supersedes) ? data.supersedes.id : data.supersedes) : [],
    curates: normCurates(data.curates),
    reopens: list(data.reopens),
    body: body.replace(/^\n+/, ''),
  }
}

// 정리 판정 — kmd 가 쓰는 정리 기록의 칸. { id, verdict: keep, reason, rule } 의 목록(읽을 때는 너그럽게 모양만)
export const VERDICTS = ['keep']
function normCurates(v) {
  if (v == null) return []
  return (Array.isArray(v) ? v : [v])
    .filter((x) => x && typeof x === 'object' && x.id)
    .map((x) => ({ id: nfc(String(x.id).trim()), verdict: String(x.verdict || '').trim(), reason: x.reason != null ? String(x.reason) : null, rule: x.rule != null ? String(x.rule) : null }))
    .filter((x) => VERDICTS.includes(x.verdict))
}

export function renderRecord({ id, title, date, author, touches, tags, fixes, curates, reopens }, body) {
  const head = { id, title, date, author }
  if (touches?.length) head.touches = touches
  if (tags?.length) head.tags = tags
  if (fixes?.length) head.supersedes = fixes.length === 1 ? fixes[0] : fixes
  if (curates?.length) head.curates = curates.map((c) => ({ id: c.id, verdict: c.verdict, ...(c.rule ? { rule: c.rule } : {}), ...(c.reason ? { reason: c.reason } : {}) }))
  if (reopens?.length) head.reopens = reopens
  const y = yaml.dump(head, { lineWidth: -1, quotingType: '"', forceQuotes: false }).replace(/\n$/, '')
  return `---\n${y}\n---\n\n# ${title}\n\n${String(body).replace(/^\n+|\s+$/g, '')}\n`
}
