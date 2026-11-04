// 조각(find → replace) — 지금 글에 꼭 한 번 나오는 글을 찾아 바꾼다(docs/kmd_권한_모델.md 7절 · docs/kmd_문서_작성기준.md 7절).
//
//   제안(core/propose.js) · 검사(core/gate.js) · 저장이 같은 대는 법을 쓴다. 이 모듈은 다른 kmd 모듈을 부르지 않는다
//   (propose ↔ 옛 정리 모듈 순환을 끊으려고 따로 뺐다 · docs/품질개선/KMD_개편_설계.md 3-1 · S-D27).
//   두 번 나오거나 없으면 그 조각은 못 댄다 · 느슨한 맞춤은 두지 않는다. 맞춰 볼 때는 줄 끝 빈칸 · NFC 만 고르고, 바꾸는 자리는 원문 위치 그대로.

export const EDIT_MAX = 50 // 제안 하나의 조각 수 상한
export const EDIT_CHARS = 20_000 // 조각 글 합의 상한

const nfc = (s) => String(s ?? '').normalize('NFC')
// 맞춰 볼 꼴 — 줄 끝 빈칸을 걷고 줄 바꿈을 \n 으로(원문 자리는 바꾸지 않는다: 아래 locate 가 원문에서 다시 찾는다)
export const norm = (s) => nfc(s).replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n')

// 조각 모양 검사 — { ok, why }
export function validEdits(edits) {
  if (!Array.isArray(edits) || !edits.length) return { ok: false, why: '조각이 없다' }
  if (edits.length > EDIT_MAX) return { ok: false, why: `조각이 ${EDIT_MAX} 개를 넘는다` }
  let chars = 0
  for (const [i, e] of edits.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return { ok: false, why: `${i + 1}째 조각이 모양이 아니다` }
    if (typeof e.find !== 'string' || !e.find.trim()) return { ok: false, why: `${i + 1}째 조각의 find 가 비었다` }
    if (typeof e.replace !== 'string') return { ok: false, why: `${i + 1}째 조각의 replace 가 글이 아니다` }
    if (Object.keys(e).some((k) => !['find', 'replace'].includes(k))) return { ok: false, why: `${i + 1}째 조각에 모르는 칸이 있다(find · replace 만)` }
    chars += e.find.length + e.replace.length
  }
  if (chars > EDIT_CHARS) return { ok: false, why: `조각 글이 ${EDIT_CHARS} 자를 넘는다` }
  return { ok: true }
}

// 원문에서 find 의 자리 — 꼭 한 번. norm 한 글에서 찾고, 원문의 같은 자리를 돌려준다.
//   norm 은 줄마다 끝 빈칸만 걷으므로(줄 수 · 줄 안 자리는 같다) 줄 · 칸으로 되짚는다
export function locate(text, find) {
  const t = norm(text), f = norm(find).replace(/^\n+|\n+$/g, '')
  if (!f) return { why: '빈 조각' }
  const first = t.indexOf(f)
  if (first < 0) return { why: '지금 글에 없다', near: nearest(t, f) }
  if (t.indexOf(f, first + 1) >= 0) return { why: '지금 글에 두 번 넘게 나온다' }
  const src = nfc(text)
  const rows = [] // 줄마다 [원문 시작, norm 시작]
  let o = 0, n = 0
  for (const m of src.split(/(\r\n|\n)/)) {
    if (m === '\n' || m === '\r\n') { o += m.length; n += 1; continue }
    rows.push([o, n])
    o += m.length
    n += m.replace(/[ \t]+$/, '').length
  }
  const at = (p) => { let r = rows[0]; for (const x of rows) { if (x[1] <= p) r = x; else break } return r[0] + (p - r[1]) }
  return { start: at(first), end: at(first + f.length) }
}
// 가장 가까운 줄 — 세션이 조각을 다시 맞출 수 있게(첫 줄의 앞 20자가 겹치는 줄)
export function nearest(t, f) {
  const head = f.split('\n')[0].trim()
  const lines = t.split('\n')
  for (let n = Math.min(20, head.length); n >= 4; n--) {
    const l = lines.find((x) => x.includes(head.slice(0, n)))
    if (l) return l.trim().slice(0, 120)
  }
  return null
}

// 조각을 댄다 — { ok, text, why, at(몇째 조각) , near }. 겹치는 조각은 거절. 차례는 원문 위치 순으로 댄다
export function applyEdits(text, edits) {
  const v = validEdits(edits)
  if (!v.ok) return { ok: false, why: v.why }
  const src = nfc(text)
  const spots = []
  for (const [i, e] of edits.entries()) {
    const at = locate(src, e.find)
    if (at.why) return { ok: false, why: `${i + 1}째 조각을 댈 수 없다: ${at.why}`, at: i, ...(at.near ? { near: at.near } : {}) }
    spots.push({ ...at, i, replace: nfc(e.replace) })
  }
  spots.sort((a, b) => a.start - b.start)
  for (let n = 1; n < spots.length; n++) if (spots[n].start < spots[n - 1].end) return { ok: false, why: `${spots[n].i + 1}째 조각이 ${spots[n - 1].i + 1}째 조각과 겹친다`, at: spots[n].i }
  let out = '', pos = 0
  for (const s of spots) { out += src.slice(pos, s.start) + s.replace; pos = s.end }
  out += src.slice(pos)
  return { ok: true, text: out }
}
