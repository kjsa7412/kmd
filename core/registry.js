// 문서 장부(`_managed.md`) — 항목 하나가 어느 문서의 어느 머리(`##`)인지 여기에만 적는다.
//
//   | `종류:*`        | `docs/문서.md` | `## {값}`   |   ← 그 종류의 항목은 모두 이 문서의 ## 머리
//   | `종류:정확한값` | `docs/문서.md` | `## 머리`   |   ← 하나만
//
// 위에서부터 먼저 걸리는 줄을 쓴다. 머리 칸이 없는 줄(옛 「문서 한 벌」 줄)은 읽지 않는다(옛 꼴은 core/oldform.js 만 안다 · O-2).

import { nfc } from './text.js'

export function parseRegistry(text) {
  const rows = []
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`(#{1,6})\s+([^`]+)`\s*\|/)
    if (m) rows.push({ pattern: nfc(m[1].trim()), doc: nfc(m[2].trim()), level: m[3].length, heading: nfc(m[4].trim()) })
  }
  return { rows }
}

// 항목(coord) → { doc, level, heading } · 걸리는 줄이 없으면 null(장부 밖 항목은 정상이다)
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
