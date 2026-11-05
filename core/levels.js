// 수준 표시(작성기준 v1.2 5-1절) — 항목 안의 짜임을 들여쓰지 않고 줄 머리의 표시 하나로 나타낸다.
//
//   1 「1.」 · 2 「1.1.」 · 3 「1.1.1.」 · 4 「1)」 · 5 「1.1)」 · 6 「1.1.1)」 · 7 「-」 · 8 「*」
//
//   levelOf(line)        — 맨 왼쪽에서 시작한 수준 줄이면 { n, mark, text } · 아니면 null
//   eachLive(lines, fn)  — 코드 울타리 · 표 · 인용 · 표지 · 참고 블록 · 저절로 채우는 표 밖의 줄만 fn(line, i)
//   toLevels(text)       — 옛 짜임(### 소제목 · 들여쓴 목록 · 맨 왼쪽 번호 목록)을 수준 표시로(옮기기 `docfmt --levels`)
//   verifyLevels(a, b)   — 옮긴 글이 표시 · 빈칸 · 뗀 옛 번호 말고는 같은가 · ## 머리가 그대로인가
//   lintLevels(lines)    — 짜임 알림: indent-list · level-skip · sub-head
//
//   이 모듈은 다른 kmd 모듈을 부르지 않는다(화면 그리기 · 저장 검사 · 옮기기가 같이 쓴다).

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

// 수준 표시를 읽지 않는 줄 — 울타리 안 · 표 · 인용 · 표지(주석) · 참고 블록 · 저절로 채우는 표
//   fn(line, i, head) — head: 그 줄이 # 머리면 그 단계(1~6) · 아니면 0
export function eachLive(lines, fn) {
  let fence = null
  let skip = null // 닫는 표지를 기다리는 덩이(참고 · 저절로 채우는 표 · 여러 줄 주석)
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
    if (/^\s*<!--\s*(?:cdp:)?baseline\b/.test(ln)) { skip = /<!--\s*\/(?:cdp:)?baseline\s*-->/; continue }
    if (/^\s*<!--/.test(ln)) { if (!/-->/.test(ln)) skip = /-->/; continue }
    if (/^\s*[|>]/.test(ln) || /^\s*</.test(ln)) continue
    const h = ln.match(/^(#{1,6})\s+\S/)
    fn(ln, i, h ? h[1].length : 0)
  }
}

// ── 옮기기 ──
const LIST = /^([ \t]*)([-*+]|\d+[.)])\s+(.*)$/
const OLDNUM = /^(?:\d+(?:\.\d+)*[.)]?|\(\d+\))\s+(?=\S)/
const indentOf = (s) => s.replace(/\t/g, '    ').length

// { text, changed, heads(### 이하를 바꾼 수), lists(바꾼 목록 줄 수), lifted(왼쪽으로 옮긴 이어지는 줄 수) }
export function toLevels(text0) {
  const text = String(text0 ?? '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const out = lines.slice()
  let heads = 0, lists = 0, lifted = 0
  let last = [null, null, null] // 항목(##) 안 깊이마다(### · #### · #####) 마지막 번호
  let stack = [] // 목록 덩이 — { indent, ol, n, label }
  let inList = false
  const listAt = new Set() // 목록 줄 · 왼쪽으로 옮긴 줄
  eachLive(lines, (ln, i, head) => {
    if (head) {
      stack = []
      inList = false
      if (head <= 2) { last = [null, null, null]; return }
      const m = ln.match(/^#{3,6}\s+(.*?)\s*#*\s*$/)
      let d = Math.min(head - 3, 2)
      while (d > 0 && !last[d] && !last[d - 1]) d-- // 위 단계 없이 내려온 머리는 한 단계 위로
      // 옛 번호가 있으면 그대로 둔다(「### 6.3 X」 → 「6.3. X」 · 글 속 「(6.3)」 참조가 깨지지 않게)
      //   없으면 같은 깊이 앞 머리의 번호에 이어 센다(「3.1」 다음 → 「3.2」) · 처음이면 위 머리 번호 + 1 · 그것도 없으면 1
      const old = m[1].match(/^(\d+(?:\.\d+){0,2})[.)]?\s+(?=\S)/)
      let parts, label
      if (old) {
        parts = old[1].split('.').map(Number)
        label = m[1].slice(old[0].length).trim()
      } else {
        parts = last[d] ? [...last[d].slice(0, -1), last[d][last[d].length - 1] + 1] : d > 0 && last[d - 1] ? [...last[d - 1], 1].slice(0, 3) : [1]
        label = m[1].replace(OLDNUM, '').trim() || m[1].trim()
      }
      last[d] = parts
      for (let k = d + 1; k < 3; k++) last[k] = null
      out[i] = `${parts.join('.')}. ${label}`
      heads++
      return
    }
    if (!ln.trim()) return // 빈 줄은 목록을 끊지 않는다(느슨한 목록)
    const m = ln.match(LIST)
    if (m && !HR.test(ln) && !/^\d+(?:\.\d+)+[.)]/.test(ln.trim())) {
      const ind = indentOf(m[1])
      while (stack.length && stack[stack.length - 1].indent > ind) stack.pop()
      const ol = /\d/.test(m[2])
      const top = stack[stack.length - 1]
      if (top && top.indent === ind) {
        stack.pop()
        if (top.ol === ol) { const it = { indent: ind, ol, n: top.n + 1 }; stack.push(it) } else stack.push({ indent: ind, ol, n: ol ? parseInt(m[2], 10) : 0 })
      } else stack.push({ indent: ind, ol, n: ol ? parseInt(m[2], 10) : 0 })
      const me = stack[stack.length - 1]
      const parent = stack[stack.length - 2]
      let mark
      if (ol) {
        const chain = stack.filter((x) => x.ol).map((x) => x.n)
        mark = chain.length <= 3 ? chain.join('.') + ')' : '*'
      } else mark = parent && !parent.ol ? '*' : '-'
      me.mark = mark
      const nl = `${mark} ${m[3]}`
      if (nl !== ln) { out[i] = nl; lists++ }
      inList = true
      listAt.add(i)
      return
    }
    // 목록 안의 이어지는 줄(들여쓴 글) → 왼쪽으로
    if (inList && /^[ \t]+\S/.test(ln)) {
      out[i] = ln.replace(/^[ \t]+/, '')
      lifted++
      listAt.add(i)
      return
    }
    // 맨 왼쪽 글 줄 — 목록이 끝났다
    stack = []
    inList = false
  })
  // 목록 안에 들여 둔 코드 울타리 · 표 — 목록 줄을 왼쪽으로 옮겼으니 같이 옮긴다(울타리 안 글은 상대 들여쓰기 그대로)
  const prevLine = (i) => { for (let p = i - 1; p >= 0; p--) if (out[p].trim()) return p; return -1 }
  for (let i = 0; i < out.length; i++) {
    const m = out[i].match(/^([ \t]+)(`{3,}|~{3,}|\|)/)
    if (!m || !listAt.has(prevLine(i))) continue
    const k = m[1].length
    const strip = (s) => s.replace(new RegExp(`^[ \\t]{0,${k}}`), '')
    let j = i
    if (m[2] === '|') {
      while (j < out.length && /^[ \t]*\|/.test(out[j])) { out[j] = strip(out[j]); listAt.add(j); j++ }
    } else {
      const fc = m[2]
      out[j] = strip(out[j]); listAt.add(j); j++
      while (j < out.length) {
        const c = out[j].match(/^[ \t]*(`{3,}|~{3,})\s*$/)
        out[j] = strip(out[j]); listAt.add(j)
        j++
        if (c && c[1][0] === fc[0] && c[1].length >= fc.length) break
      }
    }
    lifted += j - i
    i = j - 1
  }
  const t = out.join('\n')
  return { text: t, changed: t !== text, heads, lists, lifted }
}

// 옮긴 글 견주기 — 표시 · 빈칸 · 머리 기호 · 옛 번호를 뗀 줄들이 같고 ## 머리가 그대로여야
function bare(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => {
    let s = l.replace(/^\s*#{3,6}\s+/, '').trim()
    for (let k = 0; k < 3; k++) s = s.replace(/^(?:\d+(?:\.\d+)*[.)]?|\(\d+\)|[-*+])\s+(?=\S)/, '')
    return s.replace(/\s+/g, ' ')
  }).filter(Boolean)
}
const h2s = (text) => String(text ?? '').split('\n').filter((l) => /^#{1,2}\s/.test(l)).map((l) => l.trim())
export function verifyLevels(before, after) {
  const a = bare(before), b = bare(after)
  if (a.length !== b.length) return { ok: false, why: `글 줄 수가 달라졌다(${a.length} → ${b.length})` }
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return { ok: false, why: `글이 달라졌다: 「${a[i].slice(0, 30)}」 → 「${b[i].slice(0, 30)}」` }
  if (h2s(before).join('\n') !== h2s(after).join('\n')) return { ok: false, why: '## 항목 머리가 달라졌다' }
  return { ok: true }
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
