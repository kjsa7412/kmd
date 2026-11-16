// 항목 장부(`_vocab.md`) — 항목마다 `종류:값` 하나를 정하고 같은 것을 가리키는 다른 말은 별칭으로 잇는다.
//
//   ## 종류
//   - `종류:값` — 라벨
//     aliases: 별칭, 또 별칭
//     deprecated: 2026-03-26 → 종류:새값
//     gist: 그 항목이 무엇인가 한 문장(뜻 한 줄 · 다음 판단의 재료 · 지식 생성 하네스 4-3) — aliases · deprecated 뒤에 쓴다
//   「## 종류」 머리 아래 「뜻: …」 한 줄은 그 종류의 뜻이다(씨앗 종류가 아닌 새 종류 · R5-1 라)

import { nfc } from './text.js'

export function parseVocab(text) {
  const coords = new Map()
  const kinds = new Map() // 종류 → 뜻(「뜻:」 줄이 있는 것만)
  let cur = null
  let head = null
  for (const raw of String(text || '').split('\n')) {
    const hm = raw.match(/^##\s+(.+?)\s*$/)
    if (hm) { head = nfc(hm[1]); cur = null; continue }
    const km = raw.match(/^뜻\s*[:：]\s*(.+)$/)
    if (km && head && !kinds.has(head)) { kinds.set(head, nfc(km[1].trim()).slice(0, 80)); continue }
    const m = raw.match(/^\s*-\s+`([^`\s:]+:[^`]+)`\s*(?:[—–:-]\s*(.*))?$/)
    if (m) {
      const coord = nfc(m[1].trim())
      cur = { coord, label: nfc((m[2] || '').replace(/\s*\((?:구|example)\)\s*$/, '').trim()) || coord.split(':').slice(1).join(':'), aliases: [], deprecated: null, gist: '' }
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
    const gm = raw.match(/^\s+gist:\s*(.+)$/)
    if (gm && cur) {
      cur.gist = nfc(gm[1].trim()).slice(0, 80)
      continue
    }
    if (/^\S/.test(raw)) cur = null
  }
  return { coords, kinds }
}
