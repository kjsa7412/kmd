// 문서 꼴 — 본문과 시스템 참고 정보를 나눈다(docs/kmd_문서_작성기준.md).
//
//   검사(formatProblems)  항목 글(사람 · 세션 · 에이전트 · Claude 초안)에 본문이 아닌 것이 섞였나 — 8절 E_FORMAT
//                         기록 · 이력 링크 · 시스템 주소 · 표지 밖 주석 · 경과 꼬리 · 참고 블록 표식 · # · ## 머리 줄(코드 울타리 밖)
//   짜임 검사(lintDoc)    문서 짜임 알림(거절하지 않는다)
//   옛 꼴 옮기기(convertDoc · kmd docfmt)는 걷었다: 옛 꼴은 core/oldform.js 한 곳만 안다(KMD_옛잔재_정리 O-9)

import path from 'node:path'
import { splitLog, splitRef, logAt, REF_OPEN, REF_CLOSE } from './sections.js'
import { KmdError } from './errors.js'
import { readText } from './text.js'
import { lintLevels } from './levels.js'

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const APPLIED_LINE = /^\s*<!--\s*applied:.*-->\s*$/
const OK_MARK = /^\s*<!--\s*applied:.*-->\s*$/i
const safeDec = (s) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
// 문서 자리 — 'docs/a/b.md' 꼴로(「a/b」 · 'docs/a/b' 도 받는다) · 없으면 null
const docRelOf = (doc) => {
  if (!doc) return null
  let p = String(doc).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!p.startsWith('docs/')) p = `docs/${p}`
  return p.endsWith('.md') ? p : `${p}.md`
}
// 링크가 기록 · 이력(지식 뿌리의 work/ · log/ 의 .md)으로 풀리나 — 화면(linkTarget)처럼 그 문서 자리에서 푼다
//   doc 이 없으면(문서를 모르는 초안) 「../ 로 올라가 work/ · log/」 · 뿌리(/) 기준만 본다 — docs/ 안의 work/ 폴더는 문서다
export function isRecordLink(href, doc = null) {
  const t = safeDec(String(href || '').split(/[?#]/)[0]).replace(/\\/g, '/').trim()
  if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t)) return false
  const rec = (p) => /^(work|log)\/[^/]+\.md$/i.test(p)
  if (t.startsWith('/')) return rec(path.posix.normalize(t).replace(/^\/+/, ''))
  const from = docRelOf(doc)
  if (from) return rec(path.posix.normalize(path.posix.join(path.posix.dirname(from), t)))
  return /^(\.\/)?(\.\.\/)+/.test(t) && rec(path.posix.normalize(t).replace(/^(\.\.\/)+/, ''))
}
// 시스템 주소 — /api/… · #/… (화면 길) · 절대 주소라도 #/ 조각(화면 길)이 있거나 origins(이 서버 주소)의 /api/ 면
export function isSystemLink(href, origins = []) {
  const h = String(href || '').trim()
  if (/^(\/api\/|#\/)/i.test(h)) return true
  const m = h.match(/^(https?:\/\/[^/?#]+)([^#]*)(#.*)?$/i)
  if (!m) return false
  if (m[3] && /^#\//.test(m[3])) return true
  const o = m[1].toLowerCase()
  return origins.some((x) => String(x || '').replace(/\/+$/, '').toLowerCase() === o) && /^\/api\//i.test(m[2])
}

// 줄 하나의 링크 주소 — 인라인 [a](x) · [a](<x y>) · 자동 링크 <https://…> · 참조 정의 [r]: x
function hrefsIn(t) {
  const out = []
  for (const m of t.matchAll(/\]\(\s*(?:<([^>\n]*)>|([^)\s]+))|<((?:https?:\/\/|\/|#\/)[^>\s]+)>/g)) out.push(m[1] ?? m[2] ?? m[3])
  const d = t.match(/^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]*)>|(\S+))/)
  if (d) out.push(d[1] ?? d[2])
  return out.filter((x) => x != null && x !== '')
}

// 항목 글 검사 — [{ line, what }] (줄은 1부터) · 코드 울타리 안과 `코드` 안은 보지 않는다
//   doc — 그 항목의 문서(링크를 그 자리에서 푼다) · old — 지금 항목 글(이미 있던 줄의 것은 거절하지 않고 kept 로 · 보낸 사람이 넣은 줄만 본다)
//   origins — 이 서버 주소(절대 주소로 쓴 시스템 주소)
export function formatProblems(content, { doc = null, old = null, origins = [] } = {}) {
  return formatCheck(content, { doc, old, origins }).problems
}
// { problems(새로 든 줄), kept(지금 글에 이미 있던 줄 — 알리기만) }
export function formatCheck(content, { doc = null, old = null, origins = [] } = {}) {
  const out = []
  const text = String(content ?? '')
  const lines = text.split('\n')
  let fence = null
  let fenceAt = 0
  lines.forEach((ln, i) => {
    const f = ln.match(FENCE)
    if (f) {
      if (!fence) fenceAt = i + 1
      fence = !fence ? f[1] : f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence
      return
    }
    if (fence) return
    const n = i + 1
    if (/^\s{0,3}#{1,2}\s/.test(ln)) out.push({ line: n, what: `머리 줄(${ln.trim().slice(0, 30)}): 항목 글은 머리 아래 내용만 · 소제목은 ### 아래로` })
    const t = ln.replace(/(`+)[^`]*?\1/g, '')
    if (REF_OPEN.test(t.trim()) || REF_CLOSE.test(t.trim())) out.push({ line: n, what: '참고 블록 표식: 참고는 kmd 가 단다' })
    else if (/<!--/.test(t) && !OK_MARK.test(t)) out.push({ line: n, what: '표지 밖 주석(<!-- -->): 본문에 두지 않는다' })
    for (const href of hrefsIn(t)) {
      if (isRecordLink(href, doc)) out.push({ line: n, what: `기록 · 이력 링크(${href.slice(0, 60)}): 본문에 두지 않는다 · 출처는 kmd 가 참고에 단다` })
      else if (isSystemLink(href, origins)) out.push({ line: n, what: `시스템 주소(${href.slice(0, 60)}): 본문에 두지 않는다` })
    }
  })
  if (fence) out.push({ line: fenceAt, what: `닫히지 않은 코드 울타리(${fence}): 코드 끝에 닫는 줄(${fence})을 둔다` })
  if (splitLog(text).log.length) {
    const at = logAt(text.replace(/\s+$/, '').split('\n'))
    out.push({ line: at + 1, what: '끝의 「**경과**」 목록: 출처는 kmd 가 참고에 단다' })
  }
  out.sort((a, b) => a.line - b.line)
  if (old == null) return { problems: out, kept: [] }
  // 지금 글에 이미 있던 줄 — 보낸 사람이 넣은 것이 아니다(옛 들이기 · 옛 정리 · 손으로 쓴 줄) · 거절하지 않고 알린다
  const had = new Set(String(old).split('\n').map((l) => l.trim()).filter(Boolean))
  const kept = out.filter((p) => had.has(String(lines[p.line - 1] ?? '').trim()))
  return { problems: out.filter((p) => !kept.includes(p)), kept }
}
// 사람이 읽는 한 줄 — 어느 항목 · 몇째 줄 · 무엇
export function formatMessage(name, probs) {
  const xs = probs.slice(0, 5).map((p) => `${p.line}째 줄 ${p.what}`)
  return `「${name}」 글을 받지 않는다: ${xs.join(' / ')}${probs.length > 5 ? ` / 그 밖 ${probs.length - 5}` : ''}. 본문만 보낸다(기록 링크 · 참고 줄은 kmd 가 단다)`
}
// 이미 있던 줄의 알림 한 줄
export function keptMessage(name, kept) {
  return `「${name}」 에 전부터 본문이 아닌 줄이 있다(그대로 두었다): ${kept.slice(0, 3).map((p) => `${p.line}째 줄 ${p.what.split(':')[0]}`).join(' / ')}${kept.length > 3 ? ` / 그 밖 ${kept.length - 3}` : ''}`
}
// 검사하고 거절 — 새로 든 줄만 · { kept } 를 돌려준다
export function checkFormat(name, content, opt = {}) {
  const r = formatCheck(content, opt)
  if (r.problems.length) throw new KmdError('E_FORMAT', formatMessage(name, r.problems), { problems: r.problems })
  return r
}

// ── 문서 짜임 검사(알림만 · 거절하지 않는다) — 작성기준 3절 「# 제목 하나 → 요약(1~3문장) → ## 항목 · 소제목은 ### · #### 까지」
//   lintDoc(text) → [{ code, msg, line }] (줄은 1부터 · 참고 블록 · 코드 울타리 안은 보지 않는다)
//   code: no-title · many-titles · top-applied · no-summary · long-summary · ops-word · sub-before-sec · skip-level · too-deep · repeat-note
//         · 수준 표시(작성기준 5-1 · core/levels.js): sub-head · indent-list · level-skip
// 머리글(요약 자리)에 두지 않는 kmd 운영 말
export const OPS_WORDS = ['좌표', '섹션', '기준선', '원천', '동기화', '등록부', 'touches', '_vocab', '_managed', 'applied']
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s/
const QUOTE_OR_TABLE = /^\s*(\||>)/
export function lintDoc(text0) {
  const raw = readText(String(text0 ?? '')).split('\n')
  // 참고 블록 줄은 비운다(줄 번호는 그대로)
  const lines = raw.slice()
  for (const [a, b] of splitRef(raw).spans) for (let i = a; i <= b; i++) lines[i] = ''
  const out = []
  const add = (code, line, msg) => out.push({ code, line, msg })
  const heads = []
  const live = [] // 울타리 밖 줄 번호
  let fence = null
  lines.forEach((ln, i) => {
    const f = ln.match(FENCE)
    if (f) {
      fence = !fence ? f[1] : f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence
      return
    }
    if (fence) return
    live.push(i)
    const m = ln.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) heads.push({ level: m[1].length, h: m[2].trim(), i })
  })
  const h1s = heads.filter((h) => h.level === 1)
  const firstSec = heads.find((h) => h.level === 2)
  const secAt = firstSec ? firstSec.i : lines.length
  const titleAt = h1s.length ? h1s[0].i : -1
  if (!h1s.length) add('no-title', 1, '제목(# ) 없음: 화면 제목이 파일 이름으로 나온다 · 맨 위에 「# 제목」 한 줄을 둔다')
  for (const h of h1s.slice(1)) add('many-titles', h.i + 1, `제목(# )이 둘 이상(${h.h.slice(0, 20)}): 제목은 하나 · 나머지는 ## 항목으로`)
  for (const i of live) if (i < secAt && APPLIED_LINE.test(lines[i])) add('top-applied', i + 1, '첫 ## 앞의 applied 표지: 표지는 ## 머리 바로 아래에만 · 이 줄은 지운다')
  // 요약 — 제목 아래(제목이 없으면 맨 위)부터 그다음 머리 앞까지의 글
  const from = titleAt + 1
  const nextHead = heads.find((h) => h.i >= from && h.level >= 2)
  const to = nextHead ? nextHead.i : lines.length
  const lead = live.filter((i) => i >= from && i < to && lines[i].trim() && !/^\s*<!--.*-->\s*$/.test(lines[i]) && !/^#\s/.test(lines[i]))
  const first = lead.length ? lines[lead[0]].trim() : ''
  if (!first) add('no-summary', Math.max(titleAt, 0) + 1, '요약 없음: 제목 바로 아래에 이 문서가 무엇을 다루고 지금 결론이 무엇인지 1~3문장')
  else if (/^\|/.test(first)) add('no-summary', lead[0] + 1, '요약 없음(제목 아래 첫 글이 표): 메타 표(작성 · 판 · 상태)는 요약이 아니다 · 표 위에 1~3문장 요약')
  else if (/^>/.test(first)) add('no-summary', lead[0] + 1, '요약 없음(제목 아래 첫 글이 인용): 인용 위에 1~3문장 요약')
  else if (LIST_LINE.test(first)) add('no-summary', lead[0] + 1, '요약 없음(제목 아래 첫 글이 목록): 목록 위에 1~3문장 요약')
  else {
    // 요약 글 — 머리 앞의 글 줄(표 · 인용 · 목록 줄은 문장으로 세지 않는다)
    const prose = lead.filter((i) => !QUOTE_OR_TABLE.test(lines[i]) && !LIST_LINE.test(lines[i]))
    const sentences = (prose.map((i) => lines[i]).join(' ').match(/[.!?。](?=\s|$)/g) || []).length
    if (lead.length > 5 || sentences > 3) add('long-summary', lead[0] + 1, `요약이 길다(${lead.length}줄 · ${sentences}문장): 요약은 1~3문장 · 나머지는 ## 항목으로`)
  }
  // 머리글(첫 ## 앞)의 kmd 운영 말 — `코드` 안도 본다(「좌표는 `screen:{화면ID}`」 같은 줄)
  for (const i of live) {
    if (i >= secAt || i === titleAt || /^\s*<!--/.test(lines[i])) continue
    const ws = OPS_WORDS.filter((w) => lines[i].includes(w))
    if (ws.length) add('ops-word', i + 1, `머리글에 kmd 운영 말(${ws.join(' · ')}): 읽는 사람의 지식만 · 운영 메모는 참고 메모나 CLAUDE.md 로`)
  }
  // 머리 단계
  let prev = 0
  for (const h of heads) {
    if (h.level >= 3 && h.i < secAt) add('sub-before-sec', h.i + 1, `첫 ## 앞의 소제목(${'#'.repeat(h.level)} ${h.h.slice(0, 20)}): 개요에서 갈 수 없다 · ## 항목으로 올리거나 요약에 녹인다`)
    else if (prev >= 2 && h.level > prev + 1) add('skip-level', h.i + 1, `머리 단계 건너뜀(${'#'.repeat(prev)} → ${'#'.repeat(h.level)} ${h.h.slice(0, 20)}): 한 단계씩 내려간다`)
    if (h.level >= 5) add('too-deep', h.i + 1, `${h.level}단계 머리(${h.h.slice(0, 20)}): 소제목은 #### 까지`)
    prev = h.level
  }
  // 수준 표시(작성기준 5-1절) — 새로 쓴 ### 소제목 · 들여쓴 목록 · 수준 건너뜀
  for (const x of lintLevels(lines)) out.push(x)
  // 되풀이 글(Q86) — 같은 인용 줄(출처 · 상태 문장: 「> 아래는 매뉴얼에서 옮긴 것이다」 · 「> 운영 DB 에 없다」)이 다섯 번 이상(REPEAT_NOTE)
  //   처음 나온 줄에 한 번 알린다 · 날짜 · 수가 달라도 같은 문장으로 본다
  const seen = new Map()
  for (const i of live) {
    if (!/^\s*>/.test(lines[i])) continue
    const key = lines[i].replace(/^\s*>\s*/, '').replace(/\d+/g, '0').replace(/\s+/g, ' ').trim()
    if (key.length < 12) continue
    const x = seen.get(key) || { first: i, n: 0, text: lines[i].replace(/^\s*>\s*/, '').trim() }
    x.n++
    seen.set(key, x)
  }
  for (const x of seen.values()) if (x.n >= REPEAT_NOTE) add('repeat-note', x.first + 1, `같은 인용 문장이 ${x.n}번 되풀이된다(${x.text.replace(/[*_`]/g, '').slice(0, 24)}…): 출처 · 상태 문장은 (문서) 참고 메모에 한 번 · 공통 설명은 한 항목에 두고 링크`)
  // 표 칸 수 — 머리 줄(다음 줄이 |---|) 칸 수와 다른 줄
  const cells = (ln) => ln.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).length
  let head = null
  for (const i of live) {
    const ln = lines[i]
    if (!/^\s*\|/.test(ln)) { head = null; continue }
    if (head == null && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] || '') && /-/.test(lines[i + 1] || '')) { head = cells(ln); continue }
    if (head != null && !/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(ln) && cells(ln) !== head) add('table-cols', i + 1, `표 줄 칸 수: 머리는 ${head}칸인데 이 줄은 ${cells(ln)}칸이다`)
  }
  return out.sort((a, b) => a.line - b.line)
}
export const REPEAT_NOTE = 5
// 항목 글 하나(머리 아래 내용)의 머리 단계 — 정리 초안 알림용 · ## 아래로 본다
export function lintSection(body) {
  return lintDoc(`# x\n\n요약.\n\n## x\n${String(body ?? '')}`)
    .filter((x) => ['skip-level', 'too-deep', 'level-skip'].includes(x.code))
    .map((x) => ({ ...x, line: x.line - 5 }))
}
// 검사 결과 줄임 — { n, codes: { code: 수 }, top: [{ code, line, msg }] (앞 3) } · 없으면 { n: 0 }
export function lintSummary(xs) {
  if (!xs.length) return { n: 0 }
  const codes = {}
  for (const x of xs) codes[x.code] = (codes[x.code] || 0) + 1
  return { n: xs.length, codes, top: xs.slice(0, 3) }
}
// 저장 알림 — 앞에 없던 짜임 문제만(같은 code · 글이면 같은 것 · 줄 번호는 보지 않는다)
export function lintNew(before, after) {
  const key = (x) => `${x.code}\n${x.msg}`
  const had = new Map()
  for (const x of before == null ? [] : lintDoc(before)) had.set(key(x), (had.get(key(x)) || 0) + 1)
  const out = []
  for (const x of lintDoc(after)) {
    const n = had.get(key(x)) || 0
    if (n) had.set(key(x), n - 1)
    else out.push(x)
  }
  return out
}
// 문서마다 한 줄
export function lintMessage(doc, xs) {
  return `「${doc}」 문서 짜임(알림 · 저장은 했다): ${xs.slice(0, 3).map((x) => `${x.line}째 줄 ${x.msg.split(':')[0]}`).join(' / ')}${xs.length > 3 ? ` / 그 밖 ${xs.length - 3}` : ''}`
}
