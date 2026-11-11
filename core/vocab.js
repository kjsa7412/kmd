// 항목 장부(`_vocab.md`) — 항목마다 `종류:값` 하나를 정하고 같은 것을 가리키는 다른 말은 별칭으로 잇는다.
//
//   ## 종류
//   - `종류:값` — 라벨
//     aliases: 별칭, 또 별칭
//     deprecated: 2026-03-26 → 종류:새값

import { nfc } from './text.js'

export function parseVocab(text) {
  const coords = new Map()
  let cur = null
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(/^\s*-\s+`([^`\s:]+:[^`]+)`\s*(?:[—–:-]\s*(.*))?$/)
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
