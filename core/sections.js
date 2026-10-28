// 문서를 항목으로 가른다 — 항목 = `## 머리` 아래의 글.
//
// 코드 울타리(``` · ~~~) 안의 `#` 은 머리가 아니다. 항목 하나는 다음 같은 깊이 이상의
// 머리 앞까지다 — `## 가` 아래의 `### 나` 는 가에 든다.
//
// `<!-- applied: <기록 id> -->` 는 「이 항목에 마지막으로 넣은 기록」 표지다. 읽을 때
// 떼어 applied 로 돌려주고, 쓸 때 kmd 가 다시 붙인다.
//
// 참고 블록(docs/kmd_문서_작성기준.md 2-1) — 문서 끝 하나. 항목마다 「무엇이 언제 어느 기록에서 들어왔나」 줄.
//   <!-- kmd:참고 · kmd 가 적고 고친다. 손으로 고치지 않는다 -->
//   **참고**
//
//   - 준비
//     - 2026-10-21 [배포 창은 화 · 목](../work/2026-1021-배포-창.md)
//   <!-- /kmd:참고 -->
// 읽을 때 떼어 항목마다 log(줄 목록)로 돌려준다 · 항목 글(body)에는 본문만 남는다.
// 옛 꼴도 받는다 — 항목 끝 `**경과**` 목록(모두 kmd 꼴의 기록 줄일 때만 · LOG_ENTRY) ·「> 기록 그대로: [제목](../work/…) · Claude 로 다듬지 못했다」 줄은
// 읽을 때 log 로 옮기고, 그 항목을 쓸 때 참고 블록으로 옮겨 적는다.

const APPLIED = /^<!--\s*applied:\s*(.+?)\s*-->\s*$/
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
export const REF_OPEN = /^<!--\s*kmd:참고/
export const REF_CLOSE = /^<!--\s*\/kmd:참고\s*-->\s*$/
export const REF_HEAD = '<!-- kmd:참고 · kmd 가 적고 고친다. 손으로 고치지 않는다 -->'
const REF_END = '<!-- /kmd:참고 -->'
// 규칙 대체(Claude 로 다듬지 못한 정리)의 옛 줄
export const RULE_LINE = /^>\s*기록 그대로:\s*\[([^\]]*)\]\(([^)\s]+)\)\s*·\s*Claude 로 다듬지 못했다\.?\s*$/
export const ROUGH = '다듬지 못함'

// kmd 가 쓴 참고 줄 꼴 — `- YYYY-MM-DD [제목](…/work|log/<id>.md)` (뒤에 「 · 한 마디」 가 붙기도). 이 꼴이 아닌 목록 줄은 본문이다
//   (장애 · 회의의 「**경과**」 타임라인 같은 본문 목록을 출처 줄로 잘못 떼지 않게)
export const LOG_ENTRY = /^\s*-\s+(?:\d{4}-\d{2}-\d{2}\s+)?\[[^\]]*\]\((?:\.\.\/)*(?:work|log)\/[^)\s/]+\.md\)(?:\s+·\s+.*)?\s*$/
export const isLogEntry = (l) => LOG_ENTRY.test(String(l))

// 울타리 줄이면 다음 울타리 상태 · 아니면 undefined
function fenceOf(ln, fence) {
  const f = ln.match(FENCE)
  if (!f) return undefined
  if (!fence) return f[1]
  return f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence
}

export function headsOf(lines) {
  const heads = []
  let fence = null
  lines.forEach((ln, i) => {
    const f = fenceOf(ln, fence)
    if (f !== undefined) {
      fence = f
      return
    }
    if (fence) return
    const m = ln.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) heads.push({ level: m[1].length, heading: m[2].trim(), line: i })
  })
  heads.forEach((h, i) => {
    h.end = lines.length
    for (let j = i + 1; j < heads.length; j++)
      if (heads[j].level <= h.level) {
        h.end = heads[j].line
        break
      }
  })
  return heads
}
// 끝까지 열린 코드 울타리 — 닫는 줄 글(``` · ~~~) · 닫혀 있으면 null
export function openFence(lines) {
  let fence = null
  for (const ln of lines) {
    const f = fenceOf(ln, fence)
    if (f !== undefined) fence = f
  }
  return fence
}

// 참고 줄 하나의 링크 — 같은 기록인지 견줄 때
const hrefOf = (l) => (String(l).match(/\]\(([^)\s]+)\)/) || [])[1] || String(l).trim()
const roughOf = (l) => new RegExp(` · ${ROUGH}\\s*$`).test(l)
// 줄 목록 합치기 — 같은 기록(링크)은 한 줄 · 「다듬지 못함」 은 남긴다
export function mergeLog(...lists) {
  const out = []
  for (const l0 of lists.flat()) {
    const l = String(l0 || '').trim()
    if (!l) continue
    const i = out.findIndex((x) => hrefOf(x) === hrefOf(l))
    if (i < 0) out.push(l)
    else if (roughOf(l) && !roughOf(out[i])) out[i] = `${out[i]} · ${ROUGH}`
  }
  return out
}

// 블록 안 줄 → ref 에 보탠다
function readBlock(xs, ref) {
  let cur = null
  for (const x of xs) {
    const en = x.match(/^\s+- (.+?)\s*$/)
    const it = !en && x.match(/^- (.+?)\s*$/)
    if (it) {
      cur = it[1]
      if (!ref.has(cur)) ref.set(cur, [])
    } else if (en && cur != null) ref.set(cur, mergeLog(ref.get(cur), [`- ${en[1]}`]))
  }
}
// 문서 줄에서 참고 블록을 뗀다 — { lines(블록 뺀 줄), ref: Map(항목 이름 → 줄 목록), found, spans: [[여는 줄, 닫는 줄]] }
//   문서 맨 끝의 블록은 울타리와 상관없이 블록이다(마지막 항목이 닫히지 않은 울타리로 끝나도 · 끝에 여럿이면 합친다)
//   그 밖에서는 코드 울타리 안의 같은 글은 블록이 아니다 · 닫는 줄이 없으면 블록으로 보지 않는다
export function splitRef(lines) {
  const out = []
  const ref = new Map()
  let found = false
  let fence = null
  // 맨 끝 블록들(빈 줄은 건너뛴다)
  const tails = []
  let end = lines.length
  for (;;) {
    let e = end - 1
    while (e >= 0 && !lines[e].trim()) e--
    if (e < 0 || !REF_CLOSE.test(lines[e])) break
    let s = e - 1
    while (s >= 0 && !REF_OPEN.test(lines[s]) && !REF_CLOSE.test(lines[s])) s--
    if (s < 0 || !REF_OPEN.test(lines[s])) break
    tails.unshift([s, e])
    end = s
  }
  const spans = []
  for (let i = 0; i < end; i++) {
    const ln = lines[i]
    const f = fenceOf(ln, fence)
    if (f !== undefined) {
      fence = f
      out.push(ln)
      continue
    }
    if (!fence && REF_OPEN.test(ln)) {
      let j = i + 1
      while (j < end && !REF_CLOSE.test(lines[j])) j++
      if (j < end) {
        found = true
        readBlock(lines.slice(i + 1, j), ref)
        spans.push([i, j])
        i = j
        continue
      }
    }
    out.push(ln)
  }
  for (const [s, e] of tails) {
    found = true
    readBlock(lines.slice(s + 1, e), ref)
    spans.push([s, e])
  }
  return { lines: out, ref, found, spans }
}
// 참고 블록 줄을 빈 줄로(줄 번호는 그대로) — 찾기 색인이 블록을 마지막 항목의 글로 보지 않게
export function blankRef(lines) {
  const { spans } = splitRef(lines)
  if (!spans.length) return lines
  const out = lines.slice()
  for (const [s, e] of spans) for (let i = s; i <= e; i++) out[i] = ''
  return out
}
// 참고 블록 줄 — [{ h, log }] (줄이 없는 항목은 뺀다) · 빈 목록이면 []
export function refLines(items) {
  const xs = items.filter((x) => x.log?.length)
  if (!xs.length) return []
  return [REF_HEAD, '**참고**', '', ...xs.flatMap((x) => [`- ${x.h}`, ...x.log.map((l) => `  ${l}`)]), REF_END]
}
// 블록 뺀 줄 + 참고 → 문서 글(블록은 맨 끝 · 항목 차례대로)
//   문서에 없는 이름의 줄은 걷는다(문서 밖에서 머리 이름을 바꾸거나 지운 항목) · 끝까지 열린 울타리는 블록 앞에서 닫는다
function withRef(lines, ref) {
  const order = headsOf(lines).filter((h) => h.level === 2).map((h) => h.heading)
  const names = [...new Set(order)].filter((h) => ref.get(h)?.length)
  const block = refLines(names.map((h) => ({ h, log: ref.get(h) })))
  const fence = block.length ? openFence(lines) : null
  const body = [...lines, ...(fence ? [fence] : [])].join('\n').replace(/\n*$/, '')
  if (!block.length) return body + '\n'
  return `${body.replace(/\s+$/, '')}${body.trim() ? '\n\n' : ''}${block.join('\n')}\n`
}

// 경과 꼬리 — 항목 끝 `**경과**` 아래가 모두 kmd 가 쓴 참고 줄(LOG_ENTRY)일 때만. 다른 글 · 다른 목록 줄이 하나라도 있으면 본문
const LOG_HEAD = /^\*\*경과\*\*\s*$/
// 꼬리가 시작하는 줄(**경과** 줄 번호) · 꼬리가 아니면 -1
export function logAt(lines) {
  const at = lines.findLastIndex((l) => LOG_HEAD.test(l.trim()))
  if (at < 0) return -1
  const tail = lines.slice(at + 1).filter((l) => l.trim())
  return tail.length && tail.every(isLogEntry) ? at : -1
}
function cutLog(text) {
  const lines = text.split('\n')
  const at = logAt(lines)
  const tail = at < 0 ? [] : lines.slice(at + 1)
  if (at < 0) return { body: text, log: [] }
  return { body: lines.slice(0, at).join('\n').replace(/^\n+|\s+$/g, ''), log: tail.map((l) => l.trim()).filter(Boolean) }
}
// 규칙 대체 줄 → 참고 줄(날짜는 기록 id 의 YYYY-MMDD)
function ruleEntry(m) {
  const d = String(m[2]).match(/(\d{4})-(\d{2})(\d{2})-[^/]*\.md$/)
  return `- ${d ? `${d[1]}-${d[2]}-${d[3]} ` : ''}[${m[1]}](${m[2]}) · ${ROUGH}`
}

// 항목 글 — { body, applied, log(옛 꼴에서 옮긴 줄), old(옛 꼴 줄 수) } · cut 이 거짓이면(머리글) 옛 꼴을 보지 않는다
function bodyOf(lines, from, to, { cut = true } = {}) {
  let applied = null
  const out = []
  const rule = []
  let fence = null
  for (let i = from; i < to; i++) {
    const ln = lines[i]
    const f = fenceOf(ln, fence)
    if (f !== undefined) fence = f
    const m = ln.match(APPLIED)
    if (m && applied == null) {
      applied = m[1]
      continue
    }
    const r = cut && !fence && f === undefined && ln.match(RULE_LINE)
    if (r) {
      rule.push(ruleEntry(r))
      if (i + 1 < to && !lines[i + 1].trim()) i++
      continue
    }
    out.push(ln)
  }
  const text = out.join('\n').replace(/^\n+|\s+$/g, '')
  const c = cut ? cutLog(text) : { body: text, log: [] }
  return { body: c.body, applied, log: mergeLog(c.log, rule), old: c.log.length + rule.length }
}

// 문서 하나 → { title, intro, sections: [{ h, level, body, applied, log }], ref: [{ h, log }] }
//   body 는 본문만(표지 · 경과 · 참고 블록 뺌) — 지문(base)은 늘 이 글로 잰다
export function parseDoc(text, fallbackTitle) {
  const { lines, ref } = splitRef(String(text ?? '').split('\n'))
  const heads = headsOf(lines)
  const h1 = heads.find((h) => h.level === 1)
  const secs = heads.filter((h) => h.level === 2)
  const introFrom = h1 ? h1.line + 1 : 0
  const introTo = secs.length ? secs[0].line : lines.length
  return {
    title: h1 ? h1.heading : fallbackTitle,
    intro: introFrom < introTo ? bodyOf(lines, introFrom, introTo, { cut: false }).body : '',
    sections: secs.map((h) => {
      const b = bodyOf(lines, h.line + 1, h.end)
      return { h: h.heading, level: 2, body: b.body, applied: b.applied, log: mergeLog(b.log, ref.get(h.heading) || []), ...(b.old ? { old: b.old } : {}) }
    }),
    ref: [...ref].map(([h, log]) => ({ h, log })),
  }
}

// 머리 이름 맞추기 — 「rp_mst — 연구과제마스터」 는 값 rp_mst 의 항목이다
export function headingMatches(heading, want) {
  const a = heading.normalize('NFC')
  const b = want.normalize('NFC')
  return a === b || a.startsWith(b + ' ')
}

// 항목 하나를 뺀다(머리째 · 참고 줄도) — 없으면 그대로. 다른 줄은 바이트 그대로 둔다
export function removeSection(text, { level = 2, heading }) {
  const { lines, ref, found } = splitRef(String(text).split('\n'))
  const h = headsOf(lines).find((x) => x.level === level && headingMatches(x.heading, heading))
  if (!h) return text
  const out = [...lines.slice(0, h.line), ...lines.slice(h.end)]
  ref.delete(h.heading)
  if (!found) return out.join('\n').replace(/\n*$/, '\n')
  return withRef(out, ref)
}
// 항목 이름만 바꾼다 — 글 · 표지는 그대로 · 참고 줄 이름도 같이
export function renameSection(text, { level = 2, heading, to }) {
  const { lines, ref, found } = splitRef(String(text).split('\n'))
  const h = headsOf(lines).find((x) => x.level === level && headingMatches(x.heading, heading))
  if (!h) return text
  lines[h.line] = `${'#'.repeat(level)} ${to}`
  if (!found) return lines.join('\n')
  if (ref.has(h.heading)) {
    const log = ref.get(h.heading)
    ref.delete(h.heading)
    ref.set(to, mergeLog(ref.get(to) || [], log))
  }
  return withRef(lines, ref)
}

// 항목 하나를 갈아 끼운다 — 없으면 문서 끝에 새로 붙인다. 블록과 그 항목 밖의 줄은 바이트 그대로 둔다
//   log — 그 항목의 참고 줄 전부(없으면 지금 줄을 그대로) · 글 끝에 경과 꼬리가 오면 떼어 줄에 보탠다
//   그 항목의 옛 꼴(경과 꼬리 · 규칙 대체 줄)은 이때 참고 블록으로 옮긴다
export function replaceSection(text, { level = 2, heading, body, applied, log }) {
  const { lines, ref, found } = splitRef(String(text).split('\n'))
  const h = headsOf(lines).find((x) => x.level === level && headingMatches(x.heading, heading))
  const name = h ? h.heading : heading
  const sent = cutLog(String(body ?? '').replace(/^\n+|\s+$/g, ''))
  const cur = h ? mergeLog(bodyOf(lines, h.line + 1, h.end).log, ref.get(name) || []) : ref.get(name) || []
  const next = mergeLog(log !== undefined ? log : cur, sent.log)
  const block = [...(applied ? [`<!-- applied: ${applied} -->`] : []), ...sent.body.replace(/^\n+|\s+$/g, '').split('\n')]
  // 항목 글이 열린 울타리로 끝나면 닫는다 — 다음 항목 · 참고 블록이 코드 안으로 들어가지 않게
  const open = openFence(block)
  if (open) block.push(open)
  let out
  if (h) {
    const tail = lines.slice(h.end)
    const gap = tail.length && tail.some((l) => l.trim()) ? [''] : []
    out = [...lines.slice(0, h.line + 1), ...block, ...gap, ...tail]
  } else {
    const base = lines.join('\n').replace(/\s+$/, '')
    out = `${base}${base ? '\n\n' : ''}${'#'.repeat(level)} ${heading}\n${block.join('\n')}\n`.split('\n')
  }
  if (next.length) ref.set(name, next)
  else ref.delete(name)
  if (!found && !ref.size) return out.join('\n').replace(/\n*$/, '\n')
  return withRef(out, ref)
}

// 옛 꼴을 모두 참고 블록으로(옛 문서 옮기기 · core/docformat.js) — { text, moved }
//   항목마다 경과 꼬리 · 규칙 대체 줄을 떼고 본문은 그대로 · 머리글과 다른 줄은 바이트 그대로
export function moveOldLogs(text) {
  const { lines, ref, found } = splitRef(String(text).split('\n'))
  const secs = headsOf(lines).filter((h) => h.level === 2)
  const out = lines.slice()
  let moved = 0
  for (const h of [...secs].reverse()) {
    const b = bodyOf(lines, h.line + 1, h.end)
    if (!b.old) continue
    moved += b.old
    ref.set(h.heading, mergeLog(b.log, ref.get(h.heading) || []))
    const gap = lines.slice(h.end).some((l) => l.trim()) ? [''] : []
    out.splice(h.line + 1, h.end - h.line - 1, ...(b.applied ? [`<!-- applied: ${b.applied} -->`] : []), ...b.body.split('\n'), ...gap)
  }
  if (!moved) return { text: String(text), moved: 0, found }
  return { text: withRef(out, ref), moved, found }
}

// 모든 항목(## 머리)에 같은 표지를 단다 — 있던 표지는 걷는다(통째로 들인 문서 · 그 문서가 온 기록). 다른 줄은 그대로
export function stampAll(text, applied) {
  const lines = String(text).split('\n')
  const heads = new Set(headsOf(lines).filter((h) => h.level === 2).map((h) => h.line))
  const out = []
  let fence = null
  lines.forEach((ln, i) => {
    const f = ln.match(FENCE)
    if (f) fence = !fence ? f[1] : f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence
    if (!fence && !f && APPLIED.test(ln)) return
    out.push(ln)
    if (heads.has(i)) out.push(`<!-- applied: ${applied} -->`)
  })
  return out.join('\n')
}

// 경과(옛 꼴) — 항목 끝 `**경과**` 아래 한 줄씩. 이제는 참고 블록(위)에 둔다 — 아래는 옛 글을 읽고 옮기는 데 쓴다.
//   줄은 kmd 가 단다 — 사람 · Claude 는 본문만 쓰고, 저장이 옛 줄을 지키며 이번에 넣은 기록의 줄을 더한다(지우지 않는다).
export function splitLog(body) {
  const text = String(body ?? '').replace(/\s+$/, '')
  const lines = text.split('\n')
  const at = logAt(lines)
  const tail = at < 0 ? [] : lines.slice(at + 1)
  // 끝까지 kmd 꼴의 참고 줄만이어야 경과다 — 그 밖의 글 · 목록이 따라오면 본문(타임라인 같은)으로 본다
  if (at < 0) return { body: text.trim(), log: [] }
  return { body: lines.slice(0, at).join('\n').trim(), log: tail.map((l) => l.trim()).filter(Boolean) }
}
export const joinLog = (body, log) => (log.length ? [String(body).trim(), `**경과**\n${log.join('\n')}`].filter(Boolean).join('\n\n') : String(body).trim())
const linkId = (id) => encodeURI(id).replace(/\(/g, '%28').replace(/\)/g, '%29')
// 기록 하나의 참고 줄 — 링크는 그 문서에서 본 상대 경로(docs/X.md 면 ../work/…) · note 는 뒤에 「 · 다듬지 못함」 같은 한 마디
export function logLine(docRel, w, note = '') {
  const up = '../'.repeat(String(docRel).split('/').length - 1)
  const title = String(w.title || w.id).split(/ — |: /)[0].replace(/[[\]]/g, '').trim()
  return `- ${String(w.date || '').slice(0, 10)} [${title}](${up}${w.sub || 'work'}/${linkId(w.id)}.md)${note ? ` · ${note}` : ''}`
}
export const logHas = (log, id) => log.some((l) => l.includes(`/${linkId(id)}.md)`) || l.includes(`/${id}.md)`))
