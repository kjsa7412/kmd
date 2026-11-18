// 수준 표시(작성기준 v1.2 5-1절) — 항목 안의 짜임을 들여쓰지 않고 줄 머리의 표시 하나로 나타낸다.
//
//   1 「1.」 · 2 「1.1.」 · 3 「1.1.1.」 · 4 「1)」 · 5 「1.1)」 · 6 「1.1.1)」 · 7 「-」 · 8 「*」
//
//   levelOf(line)        — 맨 왼쪽에서 시작한 수준 줄이면 { n, mark, text } · 아니면 null
//   eachLive(lines, fn)  : 코드 울타리 · 표 · 인용 · 표지 · 참고 블록 밖의 줄만 fn(line, i)
//   lintLevels(lines)    — 짜임 알림: indent-list · level-skip · sub-head
//
//   이 모듈은 다른 kmd 모듈을 부르지 않는다(화면 그리기 · 저장 검사가 같이 쓴다).

const FENCE = /^\s*(`{3,}|~{3,})/
const NUM = /^(\d+(?:\.\d+){0,2})([.)])\s+(\S.*)$/
const BUL = /^([-*])\s+(\S.*)$/
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/

export function levelOf(line) {
  const s = String(line ?? '')
  if (HR.test(s)) return null
  let m = s.match(NUM)
  if (m) {
    const parts = m[1].split('.').length
    return { n: m[2] === '.' ? parts : 3 + parts, mark: m[1] + m[2], text: m[3] }
  }
  m = s.match(BUL)
  if (m) return { n: m[1] === '-' ? 7 : 8, mark: m[1], text: m[2] }
  return null
}

// 수준 표시를 읽지 않는 줄: 울타리 안 · 표 · 인용 · 표지(주석) · 참고 블록
//   fn(line, i, head) — head: 그 줄이 # 머리면 그 단계(1~6) · 아니면 0
export function eachLive(lines, fn) {
  let fence = null
  let skip = null // 닫는 표지를 기다리는 덩이(참고 · 여러 줄 주석)
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (skip) {
      if (skip.test(ln)) skip = null
      continue
    }
    const f = ln.match(FENCE)
    if (f) {
      fence = !fence ? f[1] : f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence
      continue
    }
    if (fence) continue
    if (/^\s*<!--\s*kmd:참고/.test(ln)) { skip = /<!--\s*\/kmd:참고\s*-->/; continue }
    if (/^\s*<!--/.test(ln)) { if (!/-->/.test(ln)) skip = /-->/; continue }
    if (/^\s*[|>]/.test(ln) || /^\s*</.test(ln)) continue
    const h = ln.match(/^(#{1,6})\s+\S/)
    fn(ln, i, h ? h[1].length : 0)
  }
}

// ── 짜임 알림(저장은 받는다) ──
//   [{ code, line(1부터), msg }] — 줄은 참고 블록 · 울타리 · 표 · 인용 밖만 본다
export function lintLevels(lines) {
  const out = []
  let dot = 0, par = 0
  eachLive(lines, (ln, i, head) => {
    if (head) {
      if (head <= 2) { dot = 0; par = 0 }
      else out.push({ code: 'sub-head', line: i + 1, msg: `소제목(${'#'.repeat(head)} ${ln.replace(/^#+\s*/, '').slice(0, 20)}): 항목 안의 짜임은 수준 표시(1. · 1.1.)로` })
      return
    }
    if (/^[ \t]+(?:[-*+]|\d+[.)])\s+\S/.test(ln)) { out.push({ code: 'indent-list', line: i + 1, msg: '들여쓴 목록 줄: 들여쓰지 않고 수준 표시(1) · 1.1) · - · *)로' }); return }
    const lv = levelOf(ln)
    if (!lv) return
    if (lv.n <= 3) {
      // 항목의 첫 덩이는 어느 수준이든 된다(옛 글의 「3.1.」 · 항목이 곧 「3.」) · 그다음부터 한 수준씩
      if (dot && lv.n > dot + 1) out.push({ code: 'level-skip', line: i + 1, msg: `수준 건너뜀(${lv.mark}): 한 수준씩 내려간다` })
      dot = lv.n
      par = 0
    } else if (lv.n <= 6) {
      const p = lv.n - 3
      if (p > par + 1) out.push({ code: 'level-skip', line: i + 1, msg: `수준 건너뜀(${lv.mark}): 위에 ${p === 2 ? '1)' : '1.1)'} 없이` })
      par = p
    }
  })
  return out
}
