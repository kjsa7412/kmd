// 문서 꼴 — 본문과 시스템 참고 정보를 나눈다(docs/kmd_문서_작성기준.md).
//
//   검사(formatProblems)  항목 글(사람 · 세션 · 에이전트 · Claude 초안)에 본문이 아닌 것이 섞였나 — 8절 E_FORMAT
//                         기록 · 이력 링크 · 시스템 주소 · 표지 밖 주석 · 경과 꼬리 · 참고 블록 표식 · # · ## 머리 줄(코드 울타리 밖)
//   옮기기(convertDoc)    옛 꼴(항목 끝 **경과** 목록 · 「> 기록 그대로: …」 줄)을 문서 끝 참고 블록으로 — 9절
//                         옛 CDP 표식도 — 줄마다 CDP 꼴(날짜 + 기록 링크나 `날짜`)인 **경과** 목록(줄 그대로 메모로 · 날짜만 있는 사람의 타임라인은 둔다)
//                         · cdp:baseline 주석 두 줄(표는 본문에 · 「표 출처」 메모)
//                         · 그 밖의 표지 밖 주석 줄(「표식」 메모 · 있던 항목 · gen: 은 바로 아래 항목 · 머리글의 것은 (문서) 아래)
//                         앞뒤 「본문 글」 이 한 글자라도 다르면 옮기지 않는다(ok: false)
//   지식 하나(docfmtDir)   모든 문서를 옮기고 원자 쓰기 · git 한 묶음 · 이력(log/) 하나(태그 docfmt)

import fs from 'node:fs/promises'
import path from 'node:path'
import { parseDoc, moveOldLogs, splitLog, splitRef, logAt, isLogEntry, headsOf, withRef, mergeLog, noteLine, REF_OPEN, REF_CLOSE, RULE_LINE, DOC_KEY } from './sections.js'
import { KmdError } from './errors.js'
import { readText, nfc } from './text.js'
import { renderRecord } from './frontmatter.js'
import { ensureRepo, commitPaths } from './git.js'
import { begin, writeAtomic } from './journal.js'
import { watchedOf } from './watchmark.js'
import { LOG_DIR } from './names.js'
import { serial, localStamp, recordTaken } from './save.js'

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const APPLIED_LINE = /^\s*<!--\s*applied:.*-->\s*$/
const OK_MARK =/^\s*<!--\s*(applied:.*|\/?baseline\b.*)-->\s*$/i
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

// 본문 글(옮기기 앞) — 표지 · 참고 블록만 뺀 원문 줄(옛 꼴은 떼지 않는다 — 옮기기가 무엇을 뗐는지 따로 본다)
const rawLines = (text) =>
  splitRef(readText(text).split('\n'))
    .lines.filter((l) => !APPLIED_LINE.test(l))
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
// 본문 글 — 머리글 · 항목 머리 · 항목 본문(표지 · 옛 꼴 · 참고 블록 뺌) · 빈칸은 하나로
export function plainOf(text) {
  const d = parseDoc(readText(text), '')
  return [d.title || '', d.intro, ...d.sections.flatMap((s) => [`## ${s.h}`, s.body])].join('\n').replace(/\s+/g, ' ').trim()
}
// 옛 CDP 표식 — 경과 머리 · 날짜로 시작하는 목록 줄(백틱 있든 없든) · 저절로 채우던 표의 주석 · 남겨 두는 표지
const LOG_HEAD = /^\*\*경과\*\*\s*$/
const DATED = /^\s*[-*+]\s+`?\d{4}-\d{2}-\d{2}/
// CDP 가 쓴 경과 줄 — 날짜로 시작하고 · 「`YYYY-MM-DD`」(백틱 날짜)이거나 기록 링크(../work · ../log)가 있다
const TICK_DATED = /^\s*[-*+]\s+`\d{4}-\d{2}-\d{2}`/
const isCdpLog = (l) => DATED.test(l) && (TICK_DATED.test(l) || hrefsIn(l).some((h) => isRecordLink(h)))
// 옛 GDI 변경 이력 — 「**변경 이력** (…)」 · 「**변경**」 머리(뒤에 첫 줄이 「 · 날짜 [..](기록)」 으로 붙기도) 아래
//   「· YYYY-MM-DD [제목](../work|log/….md) 한 마디」 가운뎃점 줄들 → 그 항목의 기록 줄(「- 날짜 [제목](…) · 한 마디」)
const CHANGE_HEAD = /^\*\*변경(?: 이력)?\*\*(?:\s*\([^)]*\))?(?:\s+·\s+(.*?))?\s*$/
const CHANGE_LINE = /^\s*·\s+(\d{4}-\d{2}-\d{2})(?:\s+\d{1,2}:\d{2})?\s+\[([^\]]*)\]\(([^)\s]+)\)\s*(.*?)\s*$/
// 가운뎃점 줄 하나(「**변경** · …」 처럼 머리가 붙은 줄도) → { href, rest, line(기록 줄 · 시각은 뺀다 — 기록에 있다) } · 그 꼴이 아니면 null
function changeEntry(l) {
  const h = changeHeadOf(l)
  const m = String(h ? h.inline || '' : l).trim().match(CHANGE_LINE)
  if (!m || !isRecordLink(m[3])) return null
  const title = m[2].replace(/^`([^`]*)`$/, '$1')
  return { href: m[3], rest: m[4], line: `- ${m[1]} [${title}](${m[3]})${m[4] ? ` · ${m[4]}` : ''}` }
}
// 머리 줄 · 그 아래 줄 → 가운뎃점 줄 목록(머리에 붙은 첫 줄 포함) · 머리가 아니면 null
const changeHeadOf = (l) => {
  const m = String(l).trim().match(CHANGE_HEAD)
  return m ? { inline: m[1] ? `· ${m[1]}` : null } : null
}

// 아래 항목을 가리키는 생성 표식
const GEN_MARK = /^\s*<!--\s*gen\s*:|이 줄 아래/i
const CDP_BASE = /^\s{0,3}<!--\s*cdp:baseline\b(.*?)-->\s*$/i
const CDP_BASE_END = /^\s{0,3}<!--\s*\/cdp:baseline\s*-->\s*$/i
const MARK_START = /^\s{0,3}<!--/
// 표지(작성기준 2-2) · 참고 블록 — 옮기지 않는다
const KEEP_MARK = /^\s{0,3}<!--\s*(applied:|watched:|\/?baseline\b|\/?kmd:참고)/i
// cdp:baseline 주석 → 「표 출처: <src> · <asof>」 메모
function srcNote(attrs) {
  const a = (k) => (String(attrs).match(new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`)) || [])[1]
  const xs = [a('src'), a('asof')].filter(Boolean)
  return noteLine(`표 출처: ${xs.length ? xs.join(' · ') : String(attrs).trim() || 'cdp:baseline'}`)
}
// 주석 줄(여럿이면 이어 붙인 글) → 「표식: <주석 안 글>」 메모
const markNote = (t) => noteLine(`표식: ${String(t).replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim()}`)
const norm = (l) => String(l).replace(/\s+/g, ' ').trim()

// 남은 표지 밖 주석 줄 수(코드 울타리 밖 · 표지 · 참고 블록 뺌) — 옮긴 뒤 0 이어야 한다
export function strayMarks(text) {
  let fence = null
  let n = 0
  for (const ln of splitRef(readText(text).split('\n')).lines) {
    const f = ln.match(FENCE)
    if (f) {
      fence = !fence ? f[1] : f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence
      continue
    }
    if (!fence && MARK_START.test(ln) && !KEEP_MARK.test(ln)) n++
  }
  return n
}

// 옛 CDP 표식을 참고 블록 메모로 — { text, moved, kinds: { log, table, mark }, why: [옮기지 않은 까닭], placed: [{ h, l }] }
//   항목 안의 것은 그 항목 · 첫 ## 위(머리글)의 것은 (문서) 아래 · 다른 줄은 바이트 그대로(뗀 자리의 빈 줄만 하나로)
export function moveOldMarks(text) {
  const { lines, ref } = splitRef(String(text).split('\n'))
  const secs = headsOf(lines).filter((h) => h.level === 2)
  const owner = (i) => secs.find((h) => h.line < i && i < h.end)?.heading ?? DOC_KEY
  const drop = new Set()
  const notes = new Map()
  // placed — 옮긴 메모마다 { h(붙인 항목 이름), l } · 검사(verifyConvert)가 이름까지 대조한다
  const placed = []
  const put = (h, l) => {
    notes.set(h, [...(notes.get(h) || []), l])
    placed.push({ h, l })
  }
  const note = (i, l) => put(owner(i), l)
  const kinds = { log: 0, table: 0, mark: 0 }
  const why = []
  let chg = 0
  let fence = null
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    const f = ln.match(FENCE)
    if (f) {
      fence = !fence ? f[1] : f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence
      continue
    }
    if (fence) continue
    if (LOG_HEAD.test(ln.trim())) {
      // 아래 목록(빈 줄은 건너 찾고 · 다음 빈 줄 앞까지) — 줄마다 CDP 꼴(날짜로 시작 · 기록 링크나 `날짜`)이어야 옛 경과다
      //   날짜로만 시작하는 줄(장애 · 회의 타임라인)은 사람이 쓴 본문이다
      let s = i + 1
      while (s < lines.length && !lines[s].trim()) s++
      let j = s
      while (j < lines.length && lines[j].trim()) j++
      const xs = lines.slice(s, j)
      if (!xs.length) continue
      if (xs.every(isCdpLog)) {
        for (let x = i; x < j; x++) drop.add(x)
        for (const l of xs) note(i, noteLine(l))
        kinds.log += xs.length
      } else if (xs.every((l) => DATED.test(l))) why.push(`「${owner(i)}」 의 **경과** 목록은 날짜 줄뿐이지만 기록 링크 · \`날짜\` 꼴이 아니라 사람이 쓴 타임라인으로 보고 본문으로 둔다`)
      else why.push(`「${owner(i)}」 의 **경과** 목록에 날짜로 시작하지 않는 줄이 있어 본문으로 둔다`)
      i = j - 1
      continue
    }
    const ch = changeHeadOf(ln)
    if (ch) {
      // 아래 줄(머리에 붙은 첫 줄 + 다음 빈 줄 앞까지) — 모두 「· 날짜 [..](기록)」 꼴이어야 옮긴다 · 머리만 있고 붙은 줄이 없으면 빈 줄을 건너 찾는다
      let s = i + 1
      if (!ch.inline) while (s < lines.length && !lines[s].trim()) s++
      let j = s
      while (j < lines.length && lines[j].trim()) j++
      const xs = [...(ch.inline ? [ln] : []), ...lines.slice(s, j)]
      const es = xs.map(changeEntry)
      if (!xs.length || es.some((e) => !e)) {
        if (xs.length) why.push(`「${owner(i)}」 의 ${ln.trim().slice(0, 12)} 아래에 「· 날짜 [기록](../work/…)」 꼴이 아닌 줄이 있어 본문으로 둔다`)
        continue
      }
      for (let x = i; x < j; x++) drop.add(x)
      const h = owner(i)
      for (const e of es) {
        // 같은 항목에 같은 기록이 또 오면 한 줄로(읽을 때 같은 기록 줄은 하나로 합쳐지므로 한 마디를 잃지 않게)
        const prev = placed.find((p) => p.h === h && p.href === e.href)
        if (prev) {
          if (e.rest) {
            const at = notes.get(h).indexOf(prev.l)
            prev.l = prev.l.endsWith(')') ? `${prev.l} · ${e.rest}` : `${prev.l} / ${e.rest}`
            notes.get(h)[at] = prev.l
          }
        } else {
          put(h, e.line)
          placed[placed.length - 1].href = e.href
        }
      }
      chg += es.length
      i = j - 1
      continue
    }
    if (!MARK_START.test(ln) || KEEP_MARK.test(ln)) continue
    const cb = ln.match(CDP_BASE)
    if (cb) {
      drop.add(i)
      note(i, srcNote(cb[1]))
      kinds.table++
      continue
    }
    if (CDP_BASE_END.test(ln)) {
      drop.add(i)
      continue
    }
    // 그 밖의 주석 — 닫는 「-->」 가 줄 끝에 오는 데까지(여러 줄도) · 뒤에 글이 붙거나 닫히지 않으면 둔다
    let j = i
    while (j < lines.length && !lines[j].slice(j === i ? ln.indexOf('<!--') + 4 : 0).includes('-->')) j++
    if (j >= lines.length || !/-->\s*$/.test(lines[j])) {
      why.push(`「${owner(i)}」 의 주석(${ln.trim().slice(0, 30)})이 닫히지 않거나 뒤에 글이 있어 둔다`)
      continue
    }
    for (let x = i; x <= j; x++) drop.add(x)
    // 아래를 가리키는 생성 표식(gen: · 「이 줄 아래는 다시 쓴다」)이고 바로 아래(빈 줄 건너) ## 머리가 오면 그 항목의 것
    //   그 밖의 주석은 있던 항목의 것이다(항목 끝 메모가 다음 항목에 붙지 않게)
    const t = lines.slice(i, j + 1).join(' ')
    let n = j + 1
    while (n < lines.length && !lines[n].trim()) n++
    const next = GEN_MARK.test(t) && secs.find((h) => h.line === n)
    if (next) put(next.heading, markNote(t))
    else note(i, markNote(t))
    kinds.mark++
    i = j
  }
  if (chg) kinds.change = chg
  if (!drop.size) return { text: String(text), moved: 0, kinds, why, placed }
  // 뗀 자리 — 앞뒤 빈 줄이 겹치면 하나로
  const out = []
  let cut = false
  lines.forEach((ln, i) => {
    if (drop.has(i)) return void (cut = true)
    if (cut && !ln.trim() && (!out.length || !out[out.length - 1].trim())) return
    if (ln.trim()) cut = false
    out.push(ln)
  })
  // 옮긴 메모는 합치지 않고 그대로 앞에 이어 붙인다(같은 글의 줄 둘도 둘)
  for (const [h, xs] of notes) ref.set(h, [...xs, ...(ref.get(h) || [])])
  return { text: withRef(out, ref), moved: kinds.log + kinds.table + kinds.mark + chg, kinds, why, placed: placed.map(({ h, l }) => ({ h, l })) }
}

// 옮긴 글 검사 — 뗀 줄이 kmd 꼴(경과 머리 · 기록 줄 · 「기록 그대로」 줄) · 옛 CDP 표식뿐이고 · 옛 꼴이 남지 않고 · 참고 줄을 잃지 않았나
//   앞은 원문(옛 꼴을 떼지 않은 것)으로 잰다 — parseDoc 끼리 견주면 잘못 뗀 본문을 놓친다
//   뗀 옛 경과 줄 · 주석은 모두 참고 블록에 메모로 있어야 한다
//   placed — 옮기기가 붙인 메모({ h, l }) · 주면 메모가 그 항목 이름 아래 그 개수만큼 있는지도 본다
//   메모는 개수까지 센다(같은 글의 줄 둘이 하나로 줄면 잃은 것이다)
export function verifyConvert(before, after, placed = null) {
  const A = rawLines(after)
  const gone = []
  let k = 0
  for (const l of rawLines(before)) {
    if (k < A.length && A[k] === l) k++
    else gone.push(l)
  }
  if (k < A.length) return { ok: false, why: '옮기면 본문 글이 달라진다' }
  const a = parseDoc(readText(before), '')
  const b = parseDoc(readText(after), '')
  const refOf = (t) => splitRef(readText(t).split('\n')).ref
  const ra = refOf(before)
  const rb = refOf(after)
  const cnt = (xs, x) => (xs || []).filter((y) => norm(y) === x).length
  const allOf = (r) => [...r.values()].flat()
  const wants = []
  for (let i = 0; i < gone.length; i++) {
    const l = gone[i]
    if (/^\*\*경과\*\*$/.test(l) || isLogEntry(l) || RULE_LINE.test(l) || CDP_BASE_END.test(l)) continue
    let want
    const ch = changeHeadOf(l)
    if (ch && !ch.inline) continue
    if (changeEntry(l)) continue // 기록 줄 — 아래 링크 대조가 본다
    if (ch) return { ok: false, why: '옮기면 본문 글이 달라진다' }
    if (DATED.test(l)) want = noteLine(l)
    else if (CDP_BASE.test(l)) want = srcNote(l.match(CDP_BASE)[1])
    else if (MARK_START.test(l) && !KEEP_MARK.test(l)) {
      let t = l
      while (!/-->$/.test(t) && i + 1 < gone.length) t += ` ${gone[++i]}`
      want = markNote(t)
    } else return { ok: false, why: '옮기면 본문 글이 달라진다' }
    // 기록 줄 꼴이 된 것은 아래 링크 대조가 본다
    if (!isLogEntry(want)) wants.push(norm(want))
  }
  // 뗀 줄마다 참고에 메모 하나씩(앞에 있던 같은 글은 빼고 센다)
  const before0 = allOf(ra)
  const after0 = allOf(rb)
  for (const w of new Set(wants)) {
    const n = wants.filter((x) => x === w).length
    if (cnt(after0, w) < cnt(before0, w) + n) return { ok: false, why: `뗀 줄이 참고에 없다(${w.slice(2, 32)})` }
  }
  if (placed) {
    const ps = placed.filter((p) => !isLogEntry(p.l)).map((p) => ({ h: p.h, l: norm(p.l) }))
    const key = (xs) => xs.slice().sort().join('\n')
    if (key(ps.map((p) => p.l)) !== key(wants)) return { ok: false, why: '뗀 줄과 옮긴 메모가 맞지 않는다' }
    for (const p of ps) {
      const n = ps.filter((x) => x.h === p.h && x.l === p.l).length
      if (cnt(rb.get(p.h), p.l) < cnt(ra.get(p.h), p.l) + n) return { ok: false, why: `「${p.h}」 에 붙을 메모가 없다(${p.l.slice(2, 32)})` }
    }
  }
  if (b.sections.some((s) => s.old)) return { ok: false, why: '옮긴 뒤에도 옛 꼴이 남는다' }
  if (a.docLog.some((l) => !b.docLog.includes(l))) return { ok: false, why: '(문서) 참고 줄을 잃는다' }
  for (const s of a.sections) {
    const t = b.sections.find((x) => x.h === s.h)
    if (!t || s.log.some((l) => !t.log.includes(l) && !t.log.includes(`${l} · 다듬지 못함`))) return { ok: false, why: `「${s.h}」 의 출처 줄을 잃는다` }
    if ((t.applied || null) !== (s.applied || null)) return { ok: false, why: `「${s.h}」 의 표지가 바뀐다` }
  }
  // 뗀 기록 줄은 모두 참고 블록에 있어야 한다
  const now = [...b.sections.flatMap((s) => s.log), ...b.docLog].join('\n')
  const hrefOf = (l) => (l.match(/\]\(([^)\s]+)\)/) || [])[1]
  if (gone.some((l) => hrefOf(l) && !now.includes(`](${hrefOf(l)})`))) return { ok: false, why: '뗀 출처 줄이 참고에 없다' }
  return { ok: true }
}

// 문서 하나 옮기기 — { text, changed, moved, kinds: { kmd, log, table, mark }, ok, why, left(남은 표지 밖 주석 줄) }
//   why — 옮기지 않은 까닭(ok 여도 · 사람이 쓴 것으로 보고 둔 경과 목록 같은 것)
export function convertDoc(text0) {
  const text = readText(text0)
  const z0 = dropNullApplied(text)
  const top = dropTopApplied(z0.text)
  const z = { text: top.text, n: z0.n }
  const r = moveOldLogs(z.text)
  const m = moveOldMarks(r.text)
  const kinds = { kmd: r.moved, ...m.kinds, ...(z.n ? { nul: z.n } : {}), ...(top.n ? { top: top.n } : {}) }
  const moved = r.moved + m.moved + z.n + top.n
  const note = m.why.length ? m.why.join(' / ') : null
  if (!moved) return { text, changed: false, moved: 0, kinds, ok: true, why: note, left: strayMarks(text) }
  const v = verifyConvert(text, m.text, m.placed)
  if (!v.ok) return { text, changed: false, moved: 0, kinds: { kmd: 0, log: 0, table: 0, mark: 0 }, ok: false, why: v.why, left: strayMarks(text) }
  return { text: m.text, changed: m.text !== text, moved, kinds, ok: true, why: note, left: strayMarks(m.text) }
}

// `<!-- applied: null -->` — 기록 id 가 아닌 뜻 없는 표지(옛 생성기가 남긴 것). 걷는다 · 본문 글이 아니라 보존 검증 대상이 아니다
const NULL_APPLIED = /^\s{0,3}<!--\s*applied:\s*null\s*-->\s*$/i
function dropNullApplied(text) {
  const out = []
  let fence = null
  let n = 0
  for (const l of text.split('\n')) {
    const f = l.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (f) fence = !fence ? f[1][0] : f[1][0] === fence ? null : fence
    if (!fence && NULL_APPLIED.test(l)) {
      n++
      continue
    }
    out.push(l)
  }
  return { text: out.join('\n'), n }
}

// 첫 ## 앞(제목 위 · 머리글)의 `<!-- applied: … -->` — 표지는 ## 머리 바로 아래에만 뜻이 있다(작성기준 2-2). 걷는다
function dropTopApplied(text) {
  const out = []
  let fence = null
  let n = 0
  let sec = false
  for (const l of text.split('\n')) {
    const f = l.match(FENCE)
    if (f) fence = !fence ? f[1][0] : f[1][0] === fence ? null : fence
    else if (!fence && /^##\s/.test(l)) sec = true
    if (!sec && !fence && !f && APPLIED_LINE.test(l)) {
      n++
      continue
    }
    out.push(l)
  }
  return n ? { text: out.join('\n').replace(/^\n+/, ''), n } : { text, n: 0 }
}

// ── 문서 짜임 검사(알림만 · 거절하지 않는다) — 작성기준 3절 「# 제목 하나 → 요약(1~3문장) → ## 항목 · 소제목은 ### · #### 까지」
//   lintDoc(text) → [{ code, msg, line }] (줄은 1부터 · 참고 블록 · 코드 울타리 안은 보지 않는다)
//   code: no-title · many-titles · top-applied · no-summary · long-summary · ops-word · sub-before-sec · skip-level · too-deep
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
  for (const i of live) if (i < secAt && APPLIED_LINE.test(lines[i])) add('top-applied', i + 1, '첫 ## 앞의 applied 표지: 표지는 ## 머리 바로 아래에만 · 옮기기(docfmt)가 걷는다')
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
  return out.sort((a, b) => a.line - b.line)
}
// 항목 글 하나(머리 아래 내용)의 머리 단계 — 정리 초안 알림용 · ## 아래로 본다
export function lintSection(body) {
  return lintDoc(`# x\n\n요약.\n\n## x\n${String(body ?? '')}`)
    .filter((x) => x.code === 'skip-level' || x.code === 'too-deep')
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

async function docFiles(dir, rel = 'docs', out = []) {
  for (const e of await fs.readdir(path.join(dir, ...rel.split('/')), { withFileTypes: true }).catch(() => [])) {
    const p = `${rel}/${e.name}`
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && !/^assets$/i.test(e.name)) await docFiles(dir, p, out)
    } else if (/\.md$/i.test(e.name)) out.push(p)
  }
  return out.sort()
}

// 지식 하나 — { docs: [{ doc, changed, moved, ok, why, skipped? }], moved, files, commit, log }
//   dry 면 쓰지 않는다 · ok 인 것만 쓴다 · 원본이 주인인 문서는 건너뛴다
export function docfmtDir(dir, { dry = false, user = 'kmd', by = null, now = new Date() } = {}) {
  return serial(path.resolve(dir), async () => {
    const rows = []
    const put = []
    for (const rel of await docFiles(dir)) {
      const full = path.join(dir, ...rel.split('/'))
      const raw = await fs.readFile(full, 'utf8').catch(() => null)
      if (raw == null) continue
      const doc = nfc(rel).replace(/^docs\/|\.md$/g, '')
      if (watchedOf(readText(raw))) {
        rows.push({ doc, changed: false, moved: 0, ok: true, why: '원본이 주인인 문서라 건너뛴다', skipped: true })
        continue
      }
      const c = convertDoc(raw)
      rows.push({ doc, changed: c.changed, moved: c.moved, kinds: c.kinds, ok: c.ok, why: c.why, lint: lintSummary(lintDoc(c.text)) })
      if (c.ok && c.changed) put.push({ rel, full, text: c.text, moved: c.moved, doc })
    }
    const moved = put.reduce((n, x) => n + x.moved, 0)
    // 짜임 알림 합계 — { docs(알림이 있는 문서 수), n(알림 수), codes }
    const lint = { docs: 0, n: 0, codes: {} }
    for (const x of rows) {
      if (!x.lint?.n) continue
      lint.docs++
      lint.n += x.lint.n
      for (const [c, n] of Object.entries(x.lint.codes)) lint.codes[c] = (lint.codes[c] || 0) + n
    }
    if (dry || !put.length) return { docs: rows, moved, files: put.length, commit: null, log: null, dry, lint }
    await ensureRepo(dir)
    const date = localStamp(now)
    const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
    let id = `${day}-문서-꼴-옮김`
    for (let n = 2; await recordTaken(dir, id); n++) id = `${day}-문서-꼴-옮김-${n}`
    const logRel = `${LOG_DIR}/${id}.md`
    const title = `문서 꼴 옮김: 문서 ${put.length} · 줄 ${moved}`
    const body = [`옛 꼴(항목 끝 **경과** 목록 · 「기록 그대로」 줄 · 옛 CDP 경과 · 표 · 생성 주석)을 문서 끝 참고 블록으로 옮겼다. 본문 글은 그대로다${by ? ` · 부른 사람 ${by}` : ''}`, ...put.map((x) => `- ${x.doc}: 줄 ${x.moved}`), ...rows.filter((x) => !x.ok).map((x) => `- 옮기지 않음 ${x.doc}: ${x.why}`)].join('\n')
    const j = await begin(dir)
    try {
      for (const x of put) {
        await j.add(x.rel)
        await writeAtomic(x.full, x.text)
      }
      await fs.mkdir(path.join(dir, LOG_DIR), { recursive: true })
      await j.add(logRel)
      await writeAtomic(path.join(dir, LOG_DIR, `${id}.md`), renderRecord({ id, title, date, author: user, tags: ['docfmt'] }, body))
      const commit = await commitPaths(dir, [...put.map((x) => x.rel), logRel], title, user)
      await j.done()
      return { docs: rows, moved, files: put.length, commit, log: id, dry, lint }
    } catch (e) {
      await j.undo().catch(() => {})
      throw e
    }
  })
}
