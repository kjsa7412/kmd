// 이름 장부(`_vocab.md`) — 같은 것을 가리키는 여러 이름 중 하나를 정하고 나머지를 다른 이름으로 잇는다.
//
//   ## 종류
//   - `종류:값` — 보이는 이름
//     aliases: 다른 이름, 또 다른 이름
//     deprecated: 2026-03-26 → 종류:새값

import { nfc } from './text.js'

export function parseVocab(text) {
  const coords = new Map()
  let cur = null
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(/^\s*-\s+`([^`\s:]+:[^`]+)`\s*(?:[—–-]\s*(.*))?$/)
    if (m) {
      const coord = nfc(m[1].trim())
      cur = { coord, label: nfc((m[2] || '').replace(/\s*\((?:구|example)\)\s*$/, '').trim()) || coord.split(':').slice(1).join(':'), aliases: [], deprecated: null }
      coords.set(coord, cur)
      continue
    }
    const a = raw.match(/^\s+aliases:\s*(.+)$/)
    if (a && cur) {
      cur.aliases.push(...a[1].split(',').map((x) => nfc(x.trim())).filter(Boolean))
      continue
    }
    const d = raw.match(/^\s+deprecated:\s*(.+)$/)
    if (d && cur) {
      cur.deprecated = d[1].trim()
      continue
    }
    if (/^\S/.test(raw)) cur = null
  }
  return { coords }
}
