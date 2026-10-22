// 화면 도우미 — 목업(kmd_목업_인터랙션.html)의 도우미 · 아이콘을 그대로 옮겼다.

export const $ = (s) => document.querySelector(s)
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
export const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase()
let UID = 1
export const uid = () => 'u' + UID++

const C = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 -${2 * r} 0`
const IC = {
  doc: 'M6 3h9l3 3v15H6z M14 3v4h4', list: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
  check: 'M5 12l4 4 10-10', plug: 'M9 3v5 M15 3v5 M6 8h12v3a6 6 0 0 1-12 0z M12 17v4', pair: 'M4 8h13l-3-3 M20 16H7l3 3',
  hour: 'M7 3h10 M7 21h10 M8 3c0 5 8 5 8 9s-8 4-8 9 M16 3c0 5-8 5-8 9s8 4 8 9', users: C(9, 8, 3) + 'M3 20c0-4 3-6 6-6s6 2 6 6 M16 5a3 3 0 0 1 0 6 M21 20c0-3-2-5-4-5.5',
  server: 'M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01', book: 'M4 5c3-1 5-1 8 1 3-2 5-2 8-1v14c-3-1-5-1-8 1-3-2-5-2-8-1z M12 6v14',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', search: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13 M15.5 15.5L20 20',
  user: 'M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5', sync: 'M4 12a8 8 0 0 1 14-5l2 2 M20 12a8 8 0 0 1-14 5l-2-2 M20 4v5h-5 M4 20v-5h5',
  lock: 'M6 11h12v10H6z M9 11V8a3 3 0 0 1 6 0v3',
  tag: 'M3 12V4h8l10 10-8 8z M7.5 8h.01',
  graph: C(6, 6, 2.2) + C(18, 7, 2.2) + C(9, 18, 2.2) + C(18, 17, 1.8) + ' M8.2 6.2l7.6.6 M6.6 8.1l1.8 7.8 M11.2 17.8l5-.6 M17.9 9.2l.1 6',
  gear: C(12, 12, 3) + ' M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1',
  clip: 'M8 12l6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l7-7',
}
export const svg = (k, c) => `<svg viewBox="0 0 24 24"${c ? ` class="${c}"` : ''}><path d="${IC[k] || IC.doc}"/></svg>`

// 때 — 「오늘 11:05」 · 「어제 17:02」 · 「10-20」
const pad = (n) => String(n).padStart(2, '0')
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export function stampDate(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null
}
export function whenTxt(v) {
  const d = v instanceof Date ? v : String(v || '').includes('T') ? new Date(v) : stampDate(v)
  if (!d || isNaN(d)) return ''
  const now = new Date()
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (dayKey(d) === dayKey(now)) return '오늘 ' + hm
  if (dayKey(d) === dayKey(y)) return '어제 ' + hm
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export function isToday(v) {
  const d = stampDate(v) || new Date(v)
  return !!d && !isNaN(d) && dayKey(d) === dayKey(new Date())
}
export const hhmm = (v) => {
  const d = stampDate(v)
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ''
}
export function clock() {
  const d = new Date()
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}(${'일월화수목금토'[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
