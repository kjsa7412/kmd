// 문서 꼴 — 본문과 시스템 참고 정보를 나눈다(docs/kmd_문서_작성기준.md).
//
//   검사(formatProblems)  항목 글(사람 · 세션 · 에이전트 · Claude 초안)에 본문이 아닌 것이 섞였나 — 8절 E_FORMAT
//                         기록 · 이력 링크 · 시스템 주소 · 표지 밖 주석 · 경과 꼬리 · 참고 블록 표식 · # · ## 머리 줄(코드 울타리 밖)
//   옮기기(convertDoc)    옛 꼴(항목 끝 **경과** 목록 · 「> 기록 그대로: …」 줄)을 문서 끝 참고 블록으로 — 9절
//                         앞뒤 「본문 글」 이 한 글자라도 다르면 옮기지 않는다(ok: false)
//   지식 하나(docfmtDir)   모든 문서를 옮기고 원자 쓰기 · git 한 묶음 · 이력(log/) 하나(태그 docfmt)

import fs from 'node:fs/promises'
import path from 'node:path'
import { parseDoc, moveOldLogs, splitLog, splitRef, logAt, isLogEntry, REF_OPEN, REF_CLOSE, RULE_LINE } from './sections.js'
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
// 옮긴 글 검사 — 뗀 줄이 kmd 꼴(경과 머리 · 기록 줄 · 「기록 그대로」 줄)뿐이고 · 옛 꼴이 남지 않고 · 참고 줄을 잃지 않았나
//   앞은 원문(옛 꼴을 떼지 않은 것)으로 잰다 — parseDoc 끼리 견주면 잘못 뗀 본문을 놓친다
export function verifyConvert(before, after) {
  const A = rawLines(after)
  const gone = []
  let k = 0
  for (const l of rawLines(before)) {
    if (k < A.length && A[k] === l) k++
    else gone.push(l)
  }
  if (k < A.length || gone.some((l) => !/^\*\*경과\*\*$/.test(l) && !isLogEntry(l) && !RULE_LINE.test(l))) return { ok: false, why: '옮기면 본문 글이 달라진다' }
  const a = parseDoc(readText(before), '')
  const b = parseDoc(readText(after), '')
  if (b.sections.some((s) => s.old)) return { ok: false, why: '옮긴 뒤에도 옛 꼴이 남는다' }
  for (const s of a.sections) {
    const t = b.sections.find((x) => x.h === s.h)
    if (!t || s.log.some((l) => !t.log.includes(l) && !t.log.includes(`${l} · 다듬지 못함`))) return { ok: false, why: `「${s.h}」 의 출처 줄을 잃는다` }
    if ((t.applied || null) !== (s.applied || null)) return { ok: false, why: `「${s.h}」 의 표지가 바뀐다` }
  }
  // 뗀 기록 줄은 모두 참고 블록에 있어야 한다
  const now = b.sections.flatMap((s) => s.log).join('\n')
  const hrefOf = (l) => (l.match(/\]\(([^)\s]+)\)/) || [])[1]
  if (gone.some((l) => hrefOf(l) && !now.includes(`](${hrefOf(l)})`))) return { ok: false, why: '뗀 출처 줄이 참고에 없다' }
  return { ok: true }
}

// 문서 하나 옮기기 — { text, changed, moved, ok, why }
export function convertDoc(text0) {
  const text = readText(text0)
  const r = moveOldLogs(text)
  if (!r.moved) return { text, changed: false, moved: 0, ok: true, why: null }
  const v = verifyConvert(text, r.text)
  if (!v.ok) return { text, changed: false, moved: 0, ok: false, why: v.why }
  return { text: r.text, changed: r.text !== text, moved: r.moved, ok: true, why: null }
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
      rows.push({ doc, changed: c.changed, moved: c.moved, ok: c.ok, why: c.why })
      if (c.ok && c.changed) put.push({ rel, full, text: c.text, moved: c.moved, doc })
    }
    const moved = put.reduce((n, x) => n + x.moved, 0)
    if (dry || !put.length) return { docs: rows, moved, files: put.length, commit: null, log: null, dry }
    await ensureRepo(dir)
    const date = localStamp(now)
    const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
    let id = `${day}-문서-꼴-옮김`
    for (let n = 2; await recordTaken(dir, id); n++) id = `${day}-문서-꼴-옮김-${n}`
    const logRel = `${LOG_DIR}/${id}.md`
    const title = `문서 꼴 옮김: 문서 ${put.length} · 줄 ${moved}`
    const body = [`옛 꼴(항목 끝 **경과** 목록 · 「기록 그대로」 줄)을 문서 끝 참고 블록으로 옮겼다. 본문 글은 그대로다${by ? ` · 부른 사람 ${by}` : ''}`, ...put.map((x) => `- ${x.doc}: 줄 ${x.moved}`), ...rows.filter((x) => !x.ok).map((x) => `- 옮기지 않음 ${x.doc}: ${x.why}`)].join('\n')
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
      return { docs: rows, moved, files: put.length, commit, log: id, dry }
    } catch (e) {
      await j.undo().catch(() => {})
      throw e
    }
  })
}
