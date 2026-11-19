// 문서 짜임 바꾸기 — 문서를 옮기고 · 이름(= 제목 = 파일 이름)을 바꾸고 · 새 문서 · 빈 폴더 · 차례를 한 번에(작성기준 6-1절 · 권한 모델 7-1절).
//
//   계획(planRestructure · 순수 함수) — 파일 글을 받아 바뀔 글을 돌려준다. 쓰지 않는다
//     moves   [{ from: 'a/b', to: 'c/d' }]   문서 id(docs/ 아래 · .md 없이). 이름이 바뀌면 `# 제목` 도 그 이름으로
//     creates ['c/새 문서' | { doc }]          새 문서 `# 이름` 한 줄 · 갈래 장부가 있는 지식이면 그 갈래 줄을 같이 세운다(G4)
//     titles  ['a/b']                         경로는 그대로 두고 `# 제목` 만 끝 이름(파일 이름)으로 — 제목만 파일 이름에 맞출 때(이름 = 제목 = 파일 이름)
//     dirs    ['c/빈 폴더']                   문서가 없는 폴더(차례 장부에만 남는다 · git 은 빈 폴더를 남기지 않는다)
//     order   { '': ['0_공통/', '용어집'], '0_공통': [...] }   폴더마다 형제 차례(폴더는 끝에 /) · 없으면 폴더 먼저 · 이름 차례
//   같이 고치는 것 — 옮긴 문서를 가리키는 링크 · 옮긴 문서 안의 상대 링크(다른 문서 · 첨부 · 참고 블록의 기록) ·
//     문서 장부(_managed.md)의 문서 경로 · 갈래 장부(_forms.md)의 갈래 이름 · 폴더 · 가져올 곳(_sources.json)의 into.doc · 차례 장부(_order.md)
//   링크는 글 전체에서 같은 규칙으로 경로만 바꾼다(참고 블록의 짜임은 건드리지 않는다 · 코드 울타리 안은 그대로)
//
//   항목(바탕 세우기 설계 4-3 · 4-4 · 권한 모델 7-1) — 글은 글자 그대로 · 값 검사 없음
//     items   [{ from: { doc, h }, to: { doc, h, before } }]   항목 옮기기 · 항목 이름 · 같은 문서 차례
//             from.doc 는 지금 문서 id(옮기기 앞) · to.doc 는 끝 문서 id(옮긴 뒤 · 새 문서도) · to.h 가 없으면 같은 머리 · before 는 목표 문서의 머리
//     drops   ['문서 id']                       빈 문서 걷기(끝 id · 항목 0 · 요약 0 · 들어오는 링크 0 · 문서 장부 줄 0 일 때만 · 작성기준 6-1)
//     creates 의 갈래가 대장(항목 패턴)이면 문서 장부에 패턴 줄을 같이 세운다
//   같이 고치는 것 — 옮긴 항목 글 속 상대 링크 · 들어오는 `x.md#머리` · `#머리` · 참고 줄(moveSection) · applied 표지(글과 같이) ·
//     문서 장부(placeExact: 정확한 줄은 제자리 · 패턴 줄로 닿던 장부 항목은 패턴 줄 위에 정확한 줄)
//     relabel: true 면 이름을 바꾼 항목의 항목 장부(_vocab.md) 라벨도 새 머리로 · 옛 머리는 별칭으로 남긴다(kmd-migrate rename · namebook relabelVocab)
//   noNewOrder: true 면 차례 장부(_order.md)가 없을 때 새로 만들지 않는다(kmd-migrate rename)
//   막는 것: 겹치는 머리(같은 머리 · 앞부분 겹침) · 갈래 머리 꼴 · 머리 잃는 항목 ·
//     쓴 뒤 기록 상태가 바뀜(저널 되돌림)
//   지문 — base 는 structureFp(옛 화면) 또는 stepFp(이 걸음이 건드리는 것만) · step('shape/<work>/<n>')이 있으면 이력 표지 · 멱등
//
//   적용(applyRestructure) — 지식마다 한 줄(save.serial) · 저널(넘어지면 되돌림) · 커밋 하나 · 이력(log/) 하나 · 지문이 어긋나면 E_CONFLICT

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { KmdError } from './errors.js'
import { readText, nfc } from './text.js'
import { renderRecord } from './frontmatter.js'
import { ensureRepo, commitPaths } from './git.js'
import { begin, writeAtomic } from './journal.js'
import { LOG_DIR } from './names.js'
import { serial, localStamp, recordTaken } from './save.js'
import { parseForms, guardNewDoc, formsOf, formFor, headingFits, formHeadRule } from './guard.js'
import { ORDER_FILE, parseOrder, renderOrder, byName, sortSiblings } from './order.js'
import { parseDoc, headsOf, headingMatches, findHeading, moveSection } from './sections.js'
import { parseRegistry, locate } from './registry.js'
import { placeExact, upsertPatternRow, relabelVocab } from './namebook.js'
import { loadKnowledge, coordsOfSection, sectionOf } from './knowledge.js'
import { parseRecord } from './frontmatter.js'

export { ORDER_FILE, parseOrder, renderOrder, byName, sortSiblings }
export const NAME_MAX = 40
const P = path.posix
const fail = (code, msg, details) => { throw new KmdError(code, msg, details ? { details } : undefined) }

// ── 이름 검사 — 폴더 · 문서 이름 한 조각 ──
const BAD_CH = /[\\/:*?"<>|#%\r\n\t]/
const FILEISH = [/(20\d\d)[-._ ]?(0[1-9]|1[0-2])[-._ ]?(0[1-9]|[12]\d|3[01])/, /(^|[\s_-])[vV]\d+(\.\d+)*($|[\s_-])/, /최종|사본|final|copy|\(\d+\)/i, /\.(md|docx?|hwpx?|pdf|xlsx?|pptx?|txt)$/i]
export function nameProblem(seg, { doc = false } = {}) {
  const s = String(seg ?? '')
  if (!s.trim()) return '이름이 비었다'
  if (s !== s.trim()) return '이름 앞뒤에 빈칸을 두지 않는다'
  if (BAD_CH.test(s)) return '쓸 수 없는 글자가 있다(\\ / : * ? " < > | # %)'
  if (s === '.' || s === '..' || s.startsWith('.')) return '. 으로 시작하는 이름은 쓰지 않는다'
  if (s.startsWith('_')) return '_ 로 시작하는 이름은 kmd 가 쓴다'
  if (/^assets$/i.test(s)) return 'assets 는 첨부 자리다'
  if ([...s].length > NAME_MAX) return `${NAME_MAX}자 안으로`
  if (doc && FILEISH.some((re) => re.test(s))) return '날짜 · 판 · 최종 · 확장자 같은 파일 이름 조각은 쓰지 않는다'
  return ''
}
const pathProblem = (p, { doc = false } = {}) => {
  const segs = String(p).split('/')
  for (const [i, s] of segs.entries()) {
    const w = nameProblem(s, { doc: doc && i === segs.length - 1 })
    if (w) return w
  }
  return ''
}

// ── 링크 다시 쓰기 ──
const safeDec = (s) => { try { return decodeURIComponent(s) } catch { return null } }
const encPath = (p) => p.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
// 원래 %xx 로 쓴 링크(한글까지 %EA…)는 그 꼴 그대로 — 옮긴 문서의 다른 링크 글이 쓸데없이 바뀌지 않게
const encAll = (p) => encodeURI(p).replace(/\(/g, '%28').replace(/\)/g, '%29')
// 글 속 링크 · 그림 `](href)` · `](<href>)` — 코드 울타리 안은 건드리지 않는다
const LINK = /(\]\()(<[^>\n]*>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g
function rewriteLinks(text, fromOld, fromNew, mapDoc, docSet) {
  let n = 0
  let fence = null
  const lines = text.split('\n').map((line) => {
    const f = line.match(/^\s*(```+|~~~+)/)
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return line }
    if (fence) return line
    return line.replace(LINK, (all, a, href0, z) => {
      const angle = href0.startsWith('<')
      const href = angle ? href0.slice(1, -1) : href0
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return all
      const at = href.indexOf('#')
      const part = (at < 0 ? href : href.slice(0, at)).split('?')[0]
      const frag = at < 0 ? '' : href.slice(at)
      if (!part) return all
      const dec = safeDec(part)
      if (dec == null) return all
      const root = dec.startsWith('/')
      const t0 = root ? P.normalize(dec.replace(/^\/+/, '')) : P.normalize(P.join(P.dirname(fromOld), dec))
      if (t0 === '..' || t0.startsWith('../')) return all
      // 확장자 없는 문서 링크(작성기준 밖이지만 읽기는 받는다)
      const noExt = !/\.md$/i.test(t0) && docSet.has(nfc(t0) + '.md')
      const tOld = nfc(noExt ? t0 + '.md' : t0)
      const tNew = mapDoc.get(tOld) || tOld
      if (tNew === tOld && fromNew === fromOld) return all
      let rel = root ? '/' + tNew : P.relative(P.dirname(fromNew), tNew) || P.basename(tNew)
      if (noExt) rel = rel.replace(/\.md$/i, '')
      const out = (angle ? `<${rel}>` : /%[89a-f][0-9a-f]/i.test(part) ? encAll(rel) : encPath(rel)) + frag
      if (out === href0) return all
      n++
      return a + out + z
    })
  })
  return { text: lines.join('\n'), n }
}
// 링크 하나씩 — fn({ href, target(지식 뿌리 기준 rel · 문서 밖 · 바깥이면 null), frag(# 뒤 · 풀어 읽은 글) , self(# 만) }) 이 새 href 를 돌려주면 바꾼다
//   코드 울타리 안은 건드리지 않는다
function mapLinks(text, fromRel, docSet, fn) {
  let n = 0
  let fence = null
  const out = text.split('\n').map((line) => {
    const f = line.match(/^\s*(```+|~~~+)/)
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return line }
    if (fence) return line
    return line.replace(LINK, (all, a, href0, z) => {
      const angle = href0.startsWith('<')
      const href = angle ? href0.slice(1, -1) : href0
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return all
      const at = href.indexOf('#')
      if (at < 0) return all
      const frag = safeDec(href.slice(at + 1))
      if (frag == null) return all
      const part = href.slice(0, at).split('?')[0]
      let target = fromRel
      if (part) {
        const dec = safeDec(part)
        if (dec == null) return all
        const t0 = dec.startsWith('/') ? P.normalize(dec.replace(/^\/+/, '')) : P.normalize(P.join(P.dirname(fromRel), dec))
        if (t0 === '..' || t0.startsWith('../')) return all
        target = nfc(!/\.md$/i.test(t0) && docSet.has(nfc(t0) + '.md') ? t0 + '.md' : t0)
      }
      const got = fn({ target, frag: nfc(frag), self: !part, angle })
      if (got == null || got === href) return all
      n++
      return a + (angle ? `<${got}>` : got) + z
    })
  })
  return { text: out.join('\n'), n }
}
const anchor = (h) => encPath(String(h)).replace(/#/g, '%23')
const relLink = (fromRel, toRel) => encPath(P.relative(P.dirname(fromRel), toRel) || P.basename(toRel))
// 걷힌 항목으로 들어오는 링크 — `x.md#옛머리` · 같은 문서의 `#옛머리` 를 새 항목으로(문서 짜임 글 걸음 · 합치기 · 나누기 · core/save.js)
//   texts — Map(rel → 글) · moves — [{ srcRel, h, heads(걷기 앞 그 문서의 머리), dstRel, to }] → { texts: 바뀐 것만, n }
export function relinkItems(texts, moves) {
  const docSet = new Set(texts.keys())
  const out = new Map()
  let n = 0
  for (const [rel, text] of texts) {
    const r = mapLinks(text, rel, docSet, ({ target, frag }) => {
      const m = moves.find((x) => x.srcRel === target && findHeading(x.heads, frag, (y) => y) === x.h)
      if (!m) return null
      return (m.dstRel === rel ? '' : relLink(rel, m.dstRel)) + '#' + anchor(m.to)
    })
    if (r.n) { out.set(rel, r.text); n += r.n }
  }
  return { texts: out, n }
}
// 끊긴 `#머리` 링크 — 있는 문서를 가리키는데 그 머리(모든 단계)가 없다 · [「문서\n목표#머리」] (끝 진단 「고칠 링크」 · core/shape.js diagnose)
export function brokenLinks(docs) {
  const docSet = new Set(docs.map((d) => d.rel))
  const heads = new Map(docs.map((d) => [d.rel, headsOf(String(d.text).split('\n')).map((x) => x.heading)]))
  const out = []
  for (const d of docs) {
    mapLinks(String(d.text), d.rel, docSet, ({ target, frag }) => {
      const hs = heads.get(target)
      if (hs && frag && !findHeading(hs, frag, (y) => y)) out.push(`${d.rel}\n${target}#${frag}`)
      return null
    })
  }
  return out
}
// 머리 한 줄 검사(항목 머리)
const headProblem = (h) => (!h || !String(h).trim() ? '머리가 비었다' : /[\r\n]/.test(h) ? '머리는 한 줄이다' : String(h) !== String(h).trim() ? '머리 앞뒤에 빈칸을 두지 않는다' : [...String(h)].length > 120 ? '머리는 120자 안으로' : /^#/.test(h) ? '머리는 # 으로 시작하지 않는다' : '')
const h2Of = (text) => headsOf(String(text).split('\n')).filter((x) => x.level === 2)

// 문서 첫 `# 제목` 을 이름으로(없으면 맨 위에)
function retitle(text, title) {
  const lines = text.split('\n')
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence
    if (fence) continue
    if (/^#\s+/.test(lines[i])) { if (lines[i] === `# ${title}`) return text; lines[i] = `# ${title}`; return lines.join('\n') }
    if (/^##\s/.test(lines[i])) break
  }
  lines.splice(0, 0, `# ${title}`, '')
  return lines.join('\n')
}
// 갈래 장부 줄 — 첫 칸(갈래) · 셋째 칸(폴더)만 바꾼다
function editFormRow(line, name, folder) {
  const m = line.match(/^\|(.+)\|\s*$/)
  if (!m) return line
  const cells = m[1].split('|')
  const strip = (s) => s.trim().replace(/^`|`$/g, '')
  cells[0] = ` ${name} `
  if (cells.length > 2) cells[2] = ` ${folder || '—'} `
  void strip
  return `|${cells.join('|')}|`
}

// 지문 — 문서 목록 + 차례 장부 글(화면이 읽은 짜임과 지금이 같은가)
export function structureFp(docIds, orderText) {
  return crypto.createHash('sha256').update([...docIds].map(nfc).sort().join('\n') + '\n--\n' + readText(orderText || '')).digest('hex').slice(0, 16)
}
// 걸음 지문(바탕 세우기 설계 4-6) — 이 걸음이 건드리는 문서들의 머리 목록 + 옮기는 항목 글 sha16 + 장부 셋 + docs/ 문서 id 목록.
//   건드리지 않는 문서의 글이 바뀐 것으로는 바뀌지 않는다
export function stepFp(files, ops = {}) {
  const ids = [...files.docs.keys()].map((r) => nfc(r.slice(5, -3))).sort()
  const clean = (s) => nfc(String(s ?? '')).replace(/^\/+|\/+$/g, '')
  const moves = Array.isArray(ops.moves) ? ops.moves : []
  const pre = (id) => clean(moves.find((m) => clean(m?.to) === id)?.from ?? id)
  const touched = new Set()
  for (const m of moves) { touched.add(clean(m?.from)); touched.add(clean(m?.to)) }
  for (const t of Array.isArray(ops.titles) ? ops.titles : []) touched.add(clean(t))
  for (const d of Array.isArray(ops.drops) ? ops.drops : []) touched.add(pre(clean(d)))
  const bodies = []
  for (const it of Array.isArray(ops.items) ? ops.items : []) {
    const f = clean(it?.from?.doc)
    touched.add(f)
    touched.add(pre(clean(it?.to?.doc)))
    const text = files.docs.get(`docs/${f}.md`)
    const sec = text == null ? null : parseDoc(readText(text), '').sections.find((s) => s.h === nfc(String(it?.from?.h ?? '')))
    bodies.push(`${f}\n${it?.from?.h}\n${sec ? crypto.createHash('sha256').update(sec.body).digest('hex').slice(0, 16) : '-'}`)
  }
  const heads = [...touched].filter(Boolean).sort().map((id) => {
    const text = files.docs.get(`docs/${id}.md`)
    return `${id}:${text == null ? '-' : h2Of(readText(text)).map((h) => h.heading).join('\u0001')}`
  })
  const all = [ids.join('\n'), heads.join('\n'), bodies.join('\n'), readText(files.registry || ''), readText(files.forms || ''), readText(files.order || '')].join('\n--\n')
  return crypto.createHash('sha256').update(all).digest('hex').slice(0, 16)
}

// ── 계획 ──
//   files: { docs: Map('docs/x.md' → 글), registry, forms, sources(글 | null), order }
//   → { errors[], moves[{ from, to, text }], writes[{ rel, text }], creates[], summary, lines[] }
export function planRestructure(files, ops = {}) {
  const errors = []
  const err = (where, why, code) => errors.push({ where, why, ...(code ? { code } : {}) })
  const docs = files.docs
  const docSet = new Set([...docs.keys()].map(nfc))
  const idOf = (rel) => rel.slice(5, -3)
  const relOf = (id) => `docs/${id}.md`
  const moves = (Array.isArray(ops.moves) ? ops.moves : []).map((m) => ({ from: nfc(String(m?.from ?? '')).replace(/^\/+|\/+$/g, ''), to: nfc(String(m?.to ?? '')).replace(/^\/+|\/+$/g, '') })).filter((m) => m.from !== m.to)
  const creates = (Array.isArray(ops.creates) ? ops.creates : []).map((c) => nfc(String((typeof c === 'string' ? c : c?.doc) ?? '')).replace(/^\/+|\/+$/g, ''))
  const titles = new Set((Array.isArray(ops.titles) ? ops.titles : []).map((t) => `docs/${nfc(String(t ?? '')).replace(/^\/+|\/+$/g, '')}.md`))
  const dirs = (Array.isArray(ops.dirs) ? ops.dirs : []).map((d) => nfc(String(d ?? '')).replace(/^\/+|\/+$/g, '')).filter(Boolean)
  if (moves.length + creates.length > 500) fail('E_INPUT', '한 번에 500 개까지 바꾼다')
  const clean = (s) => nfc(String(s ?? '')).replace(/^\/+|\/+$/g, '')
  const rawItems = Array.isArray(ops.items) ? ops.items : []
  const drops = (Array.isArray(ops.drops) ? ops.drops : []).map(clean).filter(Boolean)
  if (rawItems.length > 5000 || drops.length > 500) fail('E_INPUT', '항목은 한 번에 5000 · 걷기는 500 개까지')
  const items = []
  for (const x of rawItems) {
    const ok = x && typeof x === 'object' && x.from && typeof x.from === 'object' && x.to && typeof x.to === 'object' && typeof x.from.doc === 'string' && typeof x.from.h === 'string' && typeof x.to.doc === 'string' && (x.to.h == null || typeof x.to.h === 'string') && (x.to.before == null || typeof x.to.before === 'string')
    if (!ok) fail('E_INPUT', 'items 는 [{ from: { doc, h }, to: { doc, h, before } }] 다')
    items.push({ from: { doc: clean(x.from.doc), h: nfc(x.from.h) }, to: { doc: clean(x.to.doc), h: x.to.h == null ? '' : nfc(x.to.h), before: x.to.before ? nfc(x.to.before) : null } })
  }
  // 옮김표 — 옛 rel → 새 rel
  const map = new Map()
  const seenFrom = new Set()
  for (const m of moves) {
    const fr = relOf(m.from)
    if (!docSet.has(fr)) { err(m.from, '없는 문서다'); continue }
    if (seenFrom.has(fr)) { err(m.from, '같은 문서를 두 번 옮긴다'); continue }
    seenFrom.add(fr)
    const oldName = P.basename(m.from), newName = P.basename(m.to)
    const w = pathProblem(m.to, { doc: newName !== oldName })
    if (w) { err(m.to, w); continue }
    map.set(fr, relOf(m.to))
  }
  // 끝 짜임 — 겹침(대소문자 무시 · Windows) 검사
  const finalRels = new Map()
  const claim = (rel, who) => {
    const key = rel.toLowerCase()
    if (finalRels.has(key)) err(idOf(rel), `같은 이름의 문서가 있다(${finalRels.get(key)})`)
    else finalRels.set(key, who)
  }
  for (const rel of docSet) claim(map.get(rel) || rel, idOf(rel))
  const formsAll = formsOf(files.forms || '')
  const newForms = []
  const patternRows = []
  for (const c of creates) {
    const w = pathProblem(c, { doc: true })
    if (w) { err(c, w); continue }
    const g = guardNewDoc(formsAll, c, [])
    // 장부가 있는 지식 — 장부 밖 항목이면 그 갈래 줄을 같이 세운다(지식관리자의 짜임 바꾸기 · G4 를 지난다)
    const bad = g.errors.filter((e) => !/갈래 장부에 없는 문서/.test(e.message))
    if (bad.length) { err(c, bad[0].message); continue }
    if (g.registryRow) patternRows.push({ pattern: g.registryRow.pattern, doc: c })
    if (formsAll.own && !g.form) newForms.push({ name: P.basename(c), folder: P.dirname(c) === '.' ? '' : P.dirname(c) })
    claim(relOf(c), c)
  }
  for (const d of dirs) { const w = pathProblem(d); if (w) err(d + '/', w) }
  for (const t of titles) {
    if (!docSet.has(t)) err(idOf(t), '없는 문서다')
  }
  if (errors.length) return { errors, moves: [], writes: [], creates: [], summary: null, lines: [] }

  // 문서 글 — 옮긴 문서는 새 자리 기준으로 · 제목은 새 이름 · 모든 문서의 링크
  //   final: 끝 rel → 글 · origin: 끝 rel → 지금 rel(새 문서는 없음)
  const final = new Map()
  const origin = new Map()
  let links = 0
  let titled = 0
  for (const rel of [...docSet].sort()) {
    const to = map.get(rel) || rel
    let text = readText(docs.get(rel))
    const r = rewriteLinks(text, rel, to, map, docSet)
    text = r.text
    links += r.n
    // 이름 = 제목 = 파일 이름 — 파일 이름이 바뀌었거나 제목만 맞추라고 했으면 `# 제목` 을 끝 이름으로
    if ((to !== rel && P.basename(to) !== P.basename(rel)) || titles.has(rel)) {
      const t2 = retitle(text, P.basename(to, '.md'))
      if (t2 !== text) titled++
      text = t2
    }
    final.set(to, text)
    origin.set(to, rel)
  }
  for (const c of creates) final.set(relOf(c), `# ${P.basename(c)}\n`)
  const finalSet = new Set(final.keys())
  const lines = []

  // ── 항목 옮기기 · 이름 · 차례(4-3) — 차례대로 · 앞 것이 바꾼 글 위에서 ──
  const k = files.k || null
  const moved = [] // { srcRel(끝), h, dstRel, to, heads(옮기기 앞 출처 머리) }
  const coordMoves = [] // { coord, doc, heading }
  let itemsMoved = 0
  for (const it of items) {
    const where = `${it.from.doc} › ${it.from.h}`
    const src0 = relOf(it.from.doc)
    if (!docSet.has(src0)) { err(where, '없는 문서다'); continue }
    const srcRel = map.get(src0) || src0
    const dstRel = relOf(it.to.doc)
    if (!final.has(srcRel)) { err(where, '없는 문서다'); continue }
    if (!final.has(dstRel)) { err(`${it.to.doc}`, '옮길 문서가 없다(새 문서는 creates 로 같이 세운다)'); continue }
    const toH = it.to.h || it.from.h
    const hp = headProblem(toH)
    if (hp) { err(where, hp); continue }
    const same = srcRel === dstRel
    if (same && toH === it.from.h && !it.to.before) continue
    const srcText = final.get(srcRel)
    const heads = h2Of(srcText)
    const sec = heads.find((x) => x.heading === it.from.h)
    if (!sec) { err(where, '없는 항목이다(머리가 똑같아야 한다)'); continue }
    // 겹치는 머리 — 같은 머리 · 앞부분 겹침(「배포」 와 「배포 절차」 · sectionOf 가 앞부분으로도 집는다)
    const others = h2Of(final.get(dstRel)).filter((x) => !(same && x.heading === it.from.h)).map((x) => x.heading)
    const clash = others.find((x) => x === toH || headingMatches(x, toH) || headingMatches(toH, x))
    if (clash) { err(where, `「${it.to.doc}」 에 겹치는 머리가 있다: ${clash}`); continue }
    if (it.to.before && (it.to.before === it.from.h || !others.includes(it.to.before))) { err(where, `놓을 차례의 머리가 「${it.to.doc}」 에 없다: ${it.to.before}`); continue }
    if (toH !== it.from.h || !same) {
      // 갈래 — 지식으로 읽은 갈래(기본 갈래가 같은 이름의 절차 문서와 부딪치면 걷는다 · loadKnowledge)
      const f = formFor(k ? k.forms : formsAll, P.basename(it.to.doc))
      if (f && !headingFits(f, toH)) { err(where, `「${f.name}」 의 항목 머리 꼴이 아니다: ${formHeadRule(f)}`); continue }
    }
    // 장부 항목 — 옮기기 앞 지식(k)으로
    let coords = []
    if (k) {
      const dObj = k.byDocPath.get(src0)
      const s0 = dObj?.sections.find((s) => s.h === it.from.h) || null
      const prev = moved.find((m) => m.dstRel === srcRel && m.to === it.from.h)
      coords = prev ? prev.coords : dObj && s0 ? coordsOfSection(k, dObj, s0.h) : []
    }
    // 옮긴 글 속 링크 — 다른 문서 · 첨부는 새 자리 기준으로 · `#머리` 는 원래 문서(자기 머리는 새 머리)
    const mapBody = (chunk) => {
      let t = chunk.join('\n')
      if (!same) t = rewriteLinks(t, srcRel, dstRel, new Map(), finalSet).text
      t = mapLinks(t, srcRel, finalSet, ({ frag, self }) => {
        if (!self) return null
        const hit = findHeading(heads.map((x) => x.heading), frag, (x) => x)
        if (hit === it.from.h) return '#' + anchor(toH)
        return same ? null : `${relLink(dstRel, srcRel)}#${anchor(frag)}`
      }).text
      return t.split('\n')
    }
    const up = '../'.repeat(dstRel.split('/').length - 1)
    // 같은 문서에서 이름만 바꾸면(차례를 주지 않으면) 제자리 — 바로 뒤 항목 앞에 둔다(없으면 끝 · 원래도 끝)
    const stay = same && !it.to.before ? heads[heads.indexOf(sec) + 1]?.heading || null : null
    const r = moveSection(srcText, same ? null : final.get(dstRel), { heading: it.from.h, to: toH, before: it.to.before || stay, up, mapBody })
    if (!r) { err(where, '없는 항목이다'); continue }
    // 글자 그대로 — 떼어 낸 글과 넣은 글을 견준다(엔진 잘못이면 쓰지 않는다)
    const want = parseDoc(`## ${toH}\n${r.body.join('\n')}`, '').sections[0]
    const got = parseDoc(same ? r.src : r.dst, '').sections.filter((s) => s.h === toH)
    if (got.length !== 1 || got[0].body !== want.body || got[0].applied !== want.applied) { err(where, '옮긴 글이 글자 그대로가 아니다(엔진 잘못 · 쓰지 않았다)'); continue }
    final.set(srcRel, r.src)
    if (!same) final.set(dstRel, r.dst)
    // 앞에서 옮긴 항목을 다시 옮기면 앞 줄의 끝 자리를 고친다
    for (const m of moved) if (m.dstRel === srcRel && m.to === it.from.h) { m.dstRel = dstRel; m.to = toH }
    moved.push({ srcRel, h: it.from.h, dstRel, to: toH, heads: heads.map((x) => x.heading), coords })
    for (const c of coords) coordMoves.push({ coord: c, doc: idOf(dstRel), heading: toH })
    itemsMoved++
    const kind = same ? (toH === it.from.h ? '항목 차례' : '항목 이름') : '항목 옮김'
    lines.push(`- ${kind}: ${it.from.doc} › ${it.from.h} → ${idOf(dstRel)} › ${toH}`)
  }
  // 들어오는 링크 — `x.md#머리` · 같은 문서의 `#머리` 가 옮긴 항목을 가리키면 새 문서 · 새 머리로
  if (moved.length) {
    for (const [rel, text] of final) {
      const r = mapLinks(text, rel, finalSet, ({ target, frag, self }) => {
        const m = moved.find((x) => x.srcRel === target && findHeading(x.heads, frag, (y) => y) === x.h)
        if (!m) return null
        if (self && m.srcRel === m.dstRel && m.to === m.h) return null
        return (m.dstRel === rel ? '' : relLink(rel, m.dstRel)) + '#' + anchor(m.to)
      })
      if (r.n) { final.set(rel, r.text); links += r.n }
    }
  }

  // ── 빈 문서 걷기(작성기준 6-1) — 항목 0 · 요약 0 · 들어오는 링크 0 · 문서 장부 줄 0 ──
  const dropped = []
  const regRowsNow = parseRegistry(files.registry || '')
  for (const d of drops) {
    const rel = relOf(d)
    if (!final.has(rel)) { err(d, '없는 문서다'); continue }
    const text = final.get(rel)
    const pd = parseDoc(text, P.basename(d))
    if (pd.sections.length) { err(d, `빈 문서가 아니다(항목 ${pd.sections.length})`); continue }
    if (pd.intro.trim()) { err(d, '빈 문서가 아니다(요약이 있다)'); continue }
    const from0 = origin.get(rel) || rel
    if (regRowsNow.rows.some((x) => x.doc === from0 || x.doc === rel)) { err(d, '문서 장부 줄이 이 문서를 가리킨다'); continue }
    let inbound = null
    for (const [r2, t2] of final) {
      if (r2 === rel) continue
      const hit = []
      t2.replace(LINK, (all, a, href0) => {
        const href = href0.startsWith('<') ? href0.slice(1, -1) : href0
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return all
        const dec = safeDec(href.split('#')[0].split('?')[0])
        if (!dec) return all
        const t0 = dec.startsWith('/') ? P.normalize(dec.replace(/^\/+/, '')) : P.normalize(P.join(P.dirname(r2), dec))
        if (nfc(t0) === rel || nfc(t0) + '.md' === rel) hit.push(r2)
        return all
      })
      if (hit.length) { inbound = r2; break }
    }
    if (inbound) { err(d, `들어오는 링크가 있다(${idOf(inbound)})`); continue }
    final.delete(rel)
    finalSet.delete(rel)
    dropped.push({ rel, from: origin.get(rel) || null })
    lines.push(`- 문서 걷음: ${d}`)
  }
  if (errors.length) return { errors, moves: [], writes: [], creates: [], drops: [], summary: null, lines: [] }

  const writes = []
  const mv = []
  for (const [to, text] of final) {
    const from = origin.get(to)
    if (!from) continue
    if (from !== to) mv.push({ from, to, text })
    else if (text !== readText(docs.get(from))) writes.push({ rel: from, text })
  }
  // 걷은 문서가 옮긴 문서였으면 — 옛 자리만 지운다
  const removes = dropped.map((d) => d.from).filter(Boolean)
  // 문서 장부 — 표 줄의 docs/… 경로 · 새 대장 문서의 패턴 줄 · 옮긴 항목의 장부 줄(placeExact)
  let regRows = 0
  let regText = readText(files.registry || '')
  if (files.registry && map.size) {
    regText = regText.split('\n').map((line) => {
      if (!line.startsWith('|')) return line
      let x = line
      for (const [a, b] of map) if (x.includes(a)) x = x.split(a).join(b)
      if (x !== line) regRows++
      return x
    }).join('\n')
  }
  for (const p of patternRows) {
    const t2 = upsertPatternRow(regText, p.pattern, p.doc)
    if (t2 !== regText) { regText = t2; regRows++ }
  }
  if (coordMoves.length) {
    const t2 = placeExact(regText, coordMoves)
    if (t2 !== regText) regRows += Math.max(1, t2.split('\n').filter((l, i) => l !== regText.split('\n')[i]).length)
    regText = t2
  }
  // 머리 잃는 항목 — 옮기기 앞에 항목에 닿던 장부 항목이 끝 짜임에서도 머리에 닿나(옮긴 것은 새 자리에 꼭)
  if (k && moved.length) {
    const reg = parseRegistry(regText)
    const names = new Set([...k.vocab.coords.keys()])
    for (const w of k.works) for (const c of w.touches) names.add(c)
    const want = new Map(coordMoves.map((c) => [c.coord, c]))
    const lost = []
    const hcache = new Map()
    const hsOf = (rel) => { if (!hcache.has(rel)) hcache.set(rel, final.has(rel) ? h2Of(final.get(rel)).map((x) => x.heading) : []); return hcache.get(rel) }
    for (const c of names) {
      if (!sectionOf(k, c)?.sec) continue
      const loc = locate(reg, c)
      const hs = loc ? hsOf(loc.doc) : []
      const hit = loc ? findHeading(hs, loc.heading, (x) => x) : null
      const w = want.get(c)
      if (!hit || (w && (loc.doc !== relOf(w.doc) || hit !== w.heading))) lost.push(c)
    }
    if (lost.length) { err(lost.slice(0, 3).join(' · '), `옮긴 뒤 머리에 닿지 않는 장부 항목이 생긴다(${lost.length})`); return { errors, moves: [], writes: [], creates: [], drops: [], summary: null, lines: [] } }
  }
  if (regText !== readText(files.registry || '')) writes.push({ rel: '_managed.md', text: regText.endsWith('\n') ? regText : regText + '\n' })
  // 항목 장부: 이름을 바꾼 항목의 라벨 · 옛 머리 별칭(relabel)
  let vocabRows = 0
  let aliased = 0 // 옛 머리를 실제로 별칭으로 남긴 수(이력 첫 줄)
  if (ops.relabel && files.vocab && moved.length) {
    const renames = moved.filter((m) => m.h !== m.to).flatMap((m) => m.coords.map((coord) => ({ coord, from: m.h, to: m.to })))
    const v = relabelVocab(readText(files.vocab), renames)
    if (v.text !== readText(files.vocab)) { writes.push({ rel: '_vocab.md', text: v.text.endsWith('\n') ? v.text : v.text + '\n' }); vocabRows = v.done.length; aliased = v.done.filter((x) => x.startsWith('별칭:')).length }
    lines.push(...v.done.map((x) => `- 항목 장부 ${x}`), ...v.skipped.map((x) => `- 항목 장부 ${x}`))
  }
  // 갈래 장부 — 갈래 이름 = 문서 이름 · 폴더 칸
  let formRows = 0
  if (files.forms && (map.size || newForms.length)) {
    const rows = parseForms(files.forms)
    const flines = readText(files.forms).split('\n')
    const strip = (s) => String(s || '').trim().replace(/^`|`$/g, '')
    for (const [a, b] of map) {
      const oldName = P.basename(a, '.md'), newName = P.basename(b, '.md')
      const oldDir = P.dirname(idOf(a)) === '.' ? '' : P.dirname(idOf(a)), newDir = P.dirname(idOf(b)) === '.' ? '' : P.dirname(idOf(b))
      const row = rows.find((f) => f.name === oldName && (!f.folder || f.folder === oldDir))
      if (!row || (oldName === newName && (row.folder || '') === newDir)) continue
      const i = flines.findIndex((l) => { const c = l.match(/^\|(.+)\|\s*$/)?.[1].split('|'); return c && strip(c[0]) === oldName })
      if (i < 0) continue
      flines[i] = editFormRow(flines[i], newName, newDir)
      formRows++
    }
    for (const f of newForms) {
      flines.push(`| ${f.name} | — | ${f.folder || '—'} | 대상 | — | 지식문서 |`)
      formRows++
    }
    if (formRows) writes.push({ rel: '_forms.md', text: flines.join('\n').replace(/\n*$/, '\n') })
  }
  // 가져올 곳 — into.doc 가 옮긴 문서면
  let srcRows = 0
  if (files.sources && map.size) {
    let j = null
    try { j = JSON.parse(files.sources) } catch { j = null }
    if (j) {
      const walk = (o) => {
        if (!o || typeof o !== 'object') return
        if (o.into && typeof o.into.doc === 'string') {
          const rel = relOf(nfc(o.into.doc).replace(/^docs\/|\.md$/g, ''))
          if (map.has(rel)) { o.into.doc = idOf(map.get(rel)); srcRows++ }
        }
        for (const v of Object.values(o)) walk(v)
      }
      walk(j)
      if (srcRows) writes.push({ rel: '_sources.json', text: JSON.stringify(j, null, 1) + '\n' })
    }
  }
  // 차례 장부 — 끝 짜임의 폴더 · 문서로 거른다(없는 것은 뺀다 · 빠진 것은 기본 차례로 뒤에)
  const finalIds = [...final.keys()].map(idOf)
  const folders = new Set(dirs)
  for (const id of finalIds) { let f = P.dirname(id); while (f && f !== '.') { folders.add(f); f = P.dirname(f) } }
  const kids = new Map([['', []]])
  for (const f of folders) kids.set(f, [])
  for (const f of folders) kids.get(P.dirname(f) === '.' ? '' : P.dirname(f))?.push(P.basename(f) + '/')
  for (const id of finalIds) kids.get(P.dirname(id) === '.' ? '' : P.dirname(id))?.push(P.basename(id))
  const wantOrder = ops.order && typeof ops.order === 'object' ? ops.order : parseOrder(files.order).order
  const order = {}
  for (const [f, names] of kids) {
    const listed = (Array.isArray(wantOrder[f]) ? wantOrder[f] : []).map((x) => nfc(String(x)))
    order[f] = sortSiblings(names, listed)
  }
  const orderText = renderOrder(order)
  const orderChanged = readText(files.order || '') !== orderText && !(ops.noNewOrder && !readText(files.order || '').trim())
  if (orderChanged) writes.push({ rel: ORDER_FILE, text: orderText })

  const created = creates.filter((c) => final.has(relOf(c))).map((c) => ({ rel: relOf(c), text: final.get(relOf(c)) }))
  const head = [
    ...mv.map((m) => `- ${P.basename(idOf(m.from)) !== P.basename(idOf(m.to)) && P.dirname(m.from) === P.dirname(m.to) ? '이름' : '옮김'}: ${idOf(m.from)} → ${idOf(m.to)}`),
    ...[...titles].filter((t) => !map.has(t)).map((t) => `- 제목: ${idOf(t)} → ${P.basename(t, '.md')}`),
    ...creates.map((c) => `- 새 문서: ${c}`),
    ...dirs.filter((d) => !finalIds.some((id) => id.startsWith(d + '/'))).map((d) => `- 빈 폴더: ${d}/`),
  ]
  const summary = { vocab: vocabRows, aliased, moved: mv.length, titled, created: creates.length, links, registry: regRows, forms: formRows, sources: srcRows, order: orderChanged, docsTouched: writes.filter((w) => w.rel.startsWith('docs/')).length, items: itemsMoved, dropped: dropped.length }
  return { errors: [], moves: mv, writes, creates: created, drops: removes, summary, lines: [...head, ...lines] }
}

// ── 지식 폴더에서 읽기 ──
async function docFiles(dir, rel = 'docs', out = []) {
  for (const e of await fs.readdir(path.join(dir, ...rel.split('/')), { withFileTypes: true }).catch(() => [])) {
    const p = `${rel}/${e.name}`
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && !/^assets$/i.test(e.name)) await docFiles(dir, p, out)
    } else if (/\.md$/i.test(e.name)) out.push(nfc(p))
  }
  return out.sort()
}
const readOr = (full) => fs.readFile(full, 'utf8').then(readText, (e) => (e.code === 'ENOENT' ? '' : Promise.reject(e)))
export async function readStructure(dir) {
  const docs = new Map()
  for (const rel of await docFiles(dir)) docs.set(rel, await readOr(path.join(dir, ...rel.split('/'))))
  const sources = await fs.readFile(path.join(dir, '_sources.json'), 'utf8').catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)))
  return { docs, vocab: await readOr(path.join(dir, '_vocab.md')), registry: await readOr(path.join(dir, '_managed.md')), forms: await readOr(path.join(dir, '_forms.md')), sources, order: await readOr(path.join(dir, ORDER_FILE)) }
}

// 빈 폴더 거두기(docs/ 아래 · 커밋 뒤 · 던지지 않는다)
async function pruneEmpty(dir, rel = 'docs') {
  const full = path.join(dir, ...rel.split('/'))
  let left = 0
  for (const e of await fs.readdir(full, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && !e.name.startsWith('.')) { if (await pruneEmpty(dir, `${rel}/${e.name}`)) left++ } else left++
  }
  if (!left && rel !== 'docs') await fs.rmdir(full).catch(() => {})
  return left > 0 || rel === 'docs'
}

// 이 걸음 표지(shape/<work>/<n>)를 단 짜임 이력이 이미 있나 — 있으면 그 이력 id(멱등)
export async function stepDone(dir, step) {
  if (!step) return null
  const names = await fs.readdir(path.join(dir, LOG_DIR)).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)))
  for (const n of names) {
    if (!/\.md$/i.test(n)) continue
    const text = await fs.readFile(path.join(dir, LOG_DIR, n), 'utf8')
    if (!text.includes(step)) continue
    const r = parseRecord(readText(text), n)
    if (r?.tags.includes(step) && r.tags.includes('structure')) return r.id
  }
  return null
}
export const STEP_RE = /^shape\/[0-9a-f]{12}\/\d{1,4}$/

// ── 적용 ──
//   { dry } 면 쓰지 않고 계획 요약 · base 가 지금 지문(structureFp 또는 stepFp)과 다르면 E_CONFLICT · 바뀔 것이 없으면 commit null
//   step — 'shape/<work>/<n>' · 이력 표지(같은 표지의 이력이 있으면 쓰지 않고 { skipped: true })
//   via: 이력 첫 줄의 채널 · 출처(「세션에서 kmd-migrate rename 으로」 · 없으면 「구조 화면에서」 · 부르는 코드가 정한다)
export function applyRestructure(dir, ops, { user, by = null, base = null, dry = false, now = new Date(), step = null, via = null } = {}) {
  if (!user) fail('E_INPUT', '누가 쓰는지 모른다')
  return serial(path.resolve(dir), async () => {
    if (step != null && !STEP_RE.test(String(step))) fail('E_INPUT', '걸음 표지 꼴이 아니다')
    if (step) {
      const had = await stepDone(dir, step)
      if (had) return { dry: !!dry, fp: null, summary: null, lines: [], commit: null, log: had, skipped: true }
    }
    const files = await readStructure(dir)
    const fp = structureFp([...files.docs.keys()].map((r) => r.slice(5, -3)), files.order)
    const sfp = stepFp(files, ops)
    if (base && base !== fp && base !== sfp) fail('E_CONFLICT', '그사이 문서 짜임이 바뀌었다. 다시 읽고 고친다')
    const deep = (Array.isArray(ops?.items) && ops.items.length) || (Array.isArray(ops?.drops) && ops.drops.length)
    const kopt = {}
    const k = deep ? await loadKnowledge({ id: '_', name: '_', dir }, kopt) : null
    const plan = planRestructure({ ...files, k }, ops)
    if (plan.errors.length) fail('E_INPUT', `${plan.errors[0].where}: ${plan.errors[0].why}${plan.errors.length > 1 ? ` · 그 밖 ${plan.errors.length - 1}` : ''}`, plan.errors)
    const nothing = !plan.moves.length && !plan.writes.length && !plan.creates.length && !plan.drops.length
    if (dry || nothing) return { dry, fp, stepFp: sfp, summary: plan.summary, lines: plan.lines, commit: null, log: null }
    await ensureRepo(dir)
    const date = localStamp(now)
    const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
    let id = `${day}-문서-짜임-바꿈`
    for (let n = 2; await recordTaken(dir, id); n++) id = `${day}-문서-짜임-바꿈-${n}`
    const logRel = `${LOG_DIR}/${id}.md`
    const s = plan.summary
    const title = `문서 짜임 바꿈: ${[s.moved ? `옮김 ${s.moved}` : '', s.titled ? `제목 ${s.titled}` : '', s.created ? `새 문서 ${s.created}` : '', s.items ? `항목 ${s.items}` : '', s.dropped ? `걷음 ${s.dropped}` : '', s.links ? `링크 ${s.links}` : '', s.order ? '차례' : ''].filter(Boolean).join(' · ') || '장부'}`
    const said = via ? `${via} 바꿨다(옛 → 새)${ops.relabel && s.aliased ? '. 이름을 바꾼 항목의 옛 머리는 항목 장부 별칭으로 남겼다' : ''}` : '구조 화면에서 바꿨다(옛 경로 → 새 경로). 이름이 바뀐 문서는 제목도 그 이름이다'
    const body = [`${said}${by ? ` · 바꾼 사람 ${by}` : ''}`, ...plan.lines, s.links ? `- 고친 링크 ${s.links}(문서 ${s.docsTouched + s.moved})` : '', s.registry ? `- 문서 장부 줄 ${s.registry}` : '', s.vocab ? `- 항목 장부 줄 ${s.vocab}` : '', s.forms ? `- 갈래 장부 줄 ${s.forms}` : '', s.sources ? `- 가져올 곳 ${s.sources}` : '', s.order ? '- 차례 장부' : ''].filter(Boolean).join('\n')
    const j = await begin(dir)
    const paths = []
    try {
      for (const m of plan.moves) { await j.add(m.from); await j.add(m.to) }
      for (const c of plan.creates) await j.add(c.rel)
      for (const w of plan.writes) await j.add(w.rel)
      for (const d of plan.drops) await j.add(d)
      // 옮김 — 새 자리에 쓰고 옛 자리를 지운다(저널이 둘 다 안다)
      for (const m of plan.moves) {
        const to = path.join(dir, ...m.to.split('/'))
        await fs.mkdir(path.dirname(to), { recursive: true })
        await writeAtomic(to, m.text)
      }
      for (const m of plan.moves) {
        if (plan.moves.some((x) => x.to === m.from)) continue // 자리 바꿈(a → b · b → a)의 옛 자리는 이미 새 글이다
        await fs.rm(path.join(dir, ...m.from.split('/')), { force: true })
      }
      for (const c of plan.creates) {
        const full = path.join(dir, ...c.rel.split('/'))
        await fs.mkdir(path.dirname(full), { recursive: true })
        await writeAtomic(full, c.text)
      }
      for (const w of plan.writes) await writeAtomic(path.join(dir, ...w.rel.split('/')), w.text)
      // 빈 문서 걷기 — 옛 글은 git 이력에
      for (const d of plan.drops) await fs.rm(path.join(dir, ...d.split('/')), { force: true })
      await fs.mkdir(path.join(dir, LOG_DIR), { recursive: true })
      await j.add(logRel)
      await writeAtomic(path.join(dir, LOG_DIR, `${id}.md`), renderRecord({ id, title, date, author: user, tags: ['structure', ...(step ? [step] : [])] }, body))
      // 기록 상태 앞뒤 같음(4-7) — 항목을 옮긴 뒤 모든 기록의 상태가 그대로여야 한다(이 이력은 기록이 아니다)
      if (k) {
        const k2 = await loadKnowledge({ id: '_', name: '_', dir }, kopt)
        const after = new Map(k2.works.map((w) => [w.id, w.state]))
        const moved = k.works.filter((w) => after.get(w.id) !== w.state)
        if (moved.length) fail('E_INPUT', `짜임을 바꾸면 기록 상태가 바뀐다: ${moved.slice(0, 3).map((w) => `${w.id}(${w.state} → ${after.get(w.id) || '없음'})`).join(' · ')}. 쓰지 않았다`)
      }
      paths.push(...new Set([...plan.moves.flatMap((m) => [m.from, m.to]), ...plan.creates.map((c) => c.rel), ...plan.writes.map((w) => w.rel), ...plan.drops, logRel]))
      const commit = await commitPaths(dir, paths, title, user)
      await j.done()
      await pruneEmpty(dir).catch((e) => console.error(`[structure] 빈 폴더를 거두지 못했다: ${e?.message || e}`))
      return { dry: false, fp: null, summary: plan.summary, lines: plan.lines, commit, log: id }
    } catch (e) {
      await j.undo().catch((u) => console.error(`[structure] 되돌리기 실패: ${u?.message || u}`))
      throw e
    }
  })
}
