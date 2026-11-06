// 차례 장부(_order.md) — 문서 짜임의 차례(폴더마다 형제 차례 · 문서가 없는 폴더도 선다). kmd 가 쓰는 장부다(core/restructure.js).
//
//   # 문서 차례
//   ## (맨 위)
//   - 0_공통/          ← 폴더는 끝에 /
//   - 용어집
//   ## 0_공통
//   - 용어집
//
//   장부에 없는 것은 폴더 먼저 · 이름 차례(숫자는 수로: 2.1_ < 10.3_) · 이 모듈은 다른 kmd 모듈을 부르지 않는다(지식 읽기 · 화면 · 짜임 바꾸기가 같이 쓴다)

export const ORDER_FILE = '_order.md'
const nfc = (s) => String(s ?? '').normalize('NFC')

export function parseOrder(text) {
  const order = {}
  let cur = null
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const h = raw.match(/^##\s+(.+?)\s*$/)
    if (h) { cur = h[1] === '(맨 위)' ? '' : nfc(h[1]).replace(/^\/+|\/+$/g, ''); order[cur] = order[cur] || []; continue }
    const li = raw.match(/^\s*-\s+(.+?)\s*$/)
    if (li && cur != null) order[cur].push(nfc(li[1]))
  }
  return { order, dirs: Object.keys(order).filter(Boolean) }
}
export function renderOrder(order) {
  const keys = Object.keys(order).sort((a, b) => (a === '' ? -1 : b === '' ? 1 : byName(a, b)))
  const out = ['# 문서 차례', '', 'kmd 가 쓰는 장부다(문서 짜임 화면). 폴더마다 안의 차례 · 폴더는 끝에 /.', '']
  for (const k of keys) {
    out.push(`## ${k || '(맨 위)'}`)
    for (const x of order[k]) out.push(`- ${x}`)
    out.push('')
  }
  return out.join('\n')
}
export const byName = (a, b) => a.localeCompare(b, 'ko', { numeric: true })
// 형제 차례 — 장부 차례 먼저 · 장부에 없는 것은 폴더 먼저 · 이름 차례
export function sortSiblings(names, listed = []) {
  const at = new Map(listed.map((x, i) => [x, i]))
  return [...names].sort((a, b) => {
    const ia = at.has(a) ? at.get(a) : Infinity, ib = at.has(b) ? at.get(b) : Infinity
    if (ia !== ib) return ia - ib
    const da = a.endsWith('/'), db = b.endsWith('/')
    if (da !== db) return da ? -1 : 1
    return byName(a, b)
  })
}
