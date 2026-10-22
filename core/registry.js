// 자리 장부(`_managed.md`) — 이름 하나가 어느 문서의 어느 항목에 드는지 여기에만 적는다.
//
//   | `종류:*`        | `docs/문서.md` | `## {값}`   |   ← 그 종류의 이름은 모두 이 문서의 ## 항목
//   | `종류:정확한값` | `docs/문서.md` | `## 머리`   |   ← 하나만
//
// 위에서부터 먼저 걸리는 줄을 쓴다.

import { nfc } from './text.js'

export function parseRegistry(text) {
  const rows = []
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`(#{1,6})\s+([^`]+)`\s*\|/)
    if (!m) continue
    rows.push({ pattern: nfc(m[1].trim()), doc: nfc(m[2].trim()), level: m[3].length, heading: nfc(m[4].trim()) })
  }
  return { rows }
}

// 이름 → { doc, level, heading } · 걸리는 줄이 없으면 null(장부 밖 이름은 정상이다)
export function locate(registry, coord) {
  const c = nfc(coord)
  const i = c.indexOf(':')
  if (i < 1) return null
  const type = c.slice(0, i)
  const value = c.slice(i + 1)
  for (const r of registry.rows) {
    const hit = r.pattern === c || (r.pattern === `${type}:*`)
    if (hit) return { doc: r.doc, level: r.level, heading: r.heading.replace('{값}', value) }
  }
  return null
}
