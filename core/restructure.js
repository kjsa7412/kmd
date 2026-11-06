// 문서 짜임 바꾸기 — 문서를 옮기고 · 이름(= 제목 = 파일 이름)을 바꾸고 · 새 문서 · 빈 폴더 · 차례를 한 번에(작성기준 6-1절 · 권한 모델 7-1절).
//
//   계획(planRestructure · 순수 함수) — 파일 글을 받아 바뀔 글을 돌려준다. 쓰지 않는다
//     moves   [{ from: 'a/b', to: 'c/d' }]   문서 id(docs/ 아래 · .md 없이). 이름이 바뀌면 `# 제목` 도 그 이름으로
//     creates ['c/새 문서' | { doc }]          새 문서 `# 이름` 한 줄 · 갈래 장부가 있는 지식이면 그 갈래 줄을 같이 세운다(G4)
//     dirs    ['c/빈 폴더']                   문서가 없는 폴더(차례 장부에만 남는다 · git 은 빈 폴더를 남기지 않는다)
//     order   { '': ['0_공통/', '용어집'], '0_공통': [...] }   폴더마다 형제 차례(폴더는 끝에 /) · 없으면 폴더 먼저 · 이름 차례
//   같이 고치는 것 — 옮긴 문서를 가리키는 링크 · 옮긴 문서 안의 상대 링크(다른 문서 · 첨부 · 참고 블록의 기록) ·
//     자리 장부(_managed.md)의 문서 경로 · 갈래 장부(_forms.md)의 갈래 이름 · 폴더 · 가져올 곳(_sources.json)의 into.doc · 차례 장부(_order.md)
//   링크는 글 전체에서 같은 규칙으로 경로만 바꾼다(참고 블록의 짜임은 건드리지 않는다 · 코드 울타리 안은 그대로)
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
import { watchedOf } from './watchmark.js'
import { LOG_DIR } from './names.js'
import { serial, localStamp, recordTaken } from './save.js'
import { parseForms, guardNewDoc, formsOf } from './guard.js'
import { ORDER_FILE, parseOrder, renderOrder, byName, sortSiblings } from './order.js'

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
      const out = (angle ? `<${rel}>` : encPath(rel)) + frag
      if (out === href0) return all
      n++
      return a + out + z
    })
  })
  return { text: lines.join('\n'), n }
}
// 문서 첫 `# 제목` 을 이름으로(없으면 맨 위에 · 표지 watched 줄 아래)
function retitle(text, title) {
  const lines = text.split('\n')
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence
    if (fence) continue
    if (/^#\s+/.test(lines[i])) { if (lines[i] === `# ${title}`) return text; lines[i] = `# ${title}`; return lines.join('\n') }
    if (/^##\s/.test(lines[i])) break
  }
  const at = lines[0] && /^<!--\s*watched:/.test(lines[0]) ? 1 : 0
  lines.splice(at, 0, `# ${title}`, '')
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

// ── 계획 ──
//   files: { docs: Map('docs/x.md' → 글), registry, forms, sources(글 | null), order }
//   → { errors[], moves[{ from, to, text }], writes[{ rel, text }], creates[], summary, lines[] }
export function planRestructure(files, ops = {}) {
  const errors = []
  const err = (where, why) => errors.push({ where, why })
  const docs = files.docs
  const docSet = new Set([...docs.keys()].map(nfc))
  const idOf = (rel) => rel.slice(5, -3)
  const relOf = (id) => `docs/${id}.md`
  const moves = (Array.isArray(ops.moves) ? ops.moves : []).map((m) => ({ from: nfc(String(m?.from ?? '')).replace(/^\/+|\/+$/g, ''), to: nfc(String(m?.to ?? '')).replace(/^\/+|\/+$/g, '') })).filter((m) => m.from !== m.to)
  const creates = (Array.isArray(ops.creates) ? ops.creates : []).map((c) => nfc(String((typeof c === 'string' ? c : c?.doc) ?? '')).replace(/^\/+|\/+$/g, ''))
  const dirs = (Array.isArray(ops.dirs) ? ops.dirs : []).map((d) => nfc(String(d ?? '')).replace(/^\/+|\/+$/g, '')).filter(Boolean)
  if (moves.length + creates.length > 500) fail('E_INPUT', '한 번에 500 개까지 바꾼다')
  // 옮김표 — 옛 rel → 새 rel
  const map = new Map()
  const seenFrom = new Set()
  for (const m of moves) {
    const fr = relOf(m.from)
    if (!docSet.has(fr)) { err(m.from, '없는 문서다'); continue }
    if (seenFrom.has(fr)) { err(m.from, '같은 문서를 두 번 옮긴다'); continue }
    seenFrom.add(fr)
    if (watchedOf(readText(docs.get(fr)))) { err(m.from, '원본이 주인인 문서라 옮기지 않는다'); continue }
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
  for (const c of creates) {
    const w = pathProblem(c, { doc: true })
    if (w) { err(c, w); continue }
    const g = guardNewDoc(formsAll, c, [])
    // 장부가 있는 지식 — 장부 밖 이름이면 그 갈래 줄을 같이 세운다(지식관리자의 짜임 바꾸기 · G4 를 지난다)
    const bad = g.errors.filter((e) => !/갈래 장부에 없는 문서/.test(e.message))
    if (bad.length) { err(c, bad[0].message); continue }
    if (formsAll.own && !g.form) newForms.push({ name: P.basename(c), folder: P.dirname(c) === '.' ? '' : P.dirname(c) })
    claim(relOf(c), c)
  }
  for (const d of dirs) { const w = pathProblem(d); if (w) err(d + '/', w) }
  if (errors.length) return { errors, moves: [], writes: [], creates: [], summary: null, lines: [] }

  // 문서 글 — 옮긴 문서는 새 자리 기준으로 · 제목은 새 이름 · 모든 문서의 링크
  const outDocs = []
  let links = 0
  for (const rel of [...docSet].sort()) {
    const to = map.get(rel) || rel
    let text = readText(docs.get(rel))
    const r = rewriteLinks(text, rel, to, map, docSet)
    text = r.text
    links += r.n
    if (to !== rel && P.basename(to) !== P.basename(rel)) text = retitle(text, P.basename(to, '.md'))
    if (to !== rel) outDocs.push({ kind: 'move', from: rel, to, text })
    else if (r.n) outDocs.push({ kind: 'write', rel, text })
  }
  const writes = outDocs.filter((x) => x.kind === 'write').map((x) => ({ rel: x.rel, text: x.text }))
  const mv = outDocs.filter((x) => x.kind === 'move').map((x) => ({ from: x.from, to: x.to, text: x.text }))
  // 자리 장부 — 표 줄의 docs/… 경로
  let regRows = 0
  if (files.registry && map.size) {
    const t = readText(files.registry).split('\n').map((line) => {
      if (!line.startsWith('|')) return line
      let x = line
      for (const [a, b] of map) if (x.includes(a)) x = x.split(a).join(b)
      if (x !== line) regRows++
      return x
    }).join('\n')
    if (regRows) writes.push({ rel: '_managed.md', text: t })
  }
  // 갈래 장부 — 갈래 이름 = 문서 이름 · 폴더 칸
  let formRows = 0
  if (files.forms && (map.size || newForms.length)) {
    const rows = parseForms(files.forms)
    const lines = readText(files.forms).split('\n')
    const strip = (s) => String(s || '').trim().replace(/^`|`$/g, '')
    for (const [a, b] of map) {
      const oldName = P.basename(a, '.md'), newName = P.basename(b, '.md')
      const oldDir = P.dirname(idOf(a)) === '.' ? '' : P.dirname(idOf(a)), newDir = P.dirname(idOf(b)) === '.' ? '' : P.dirname(idOf(b))
      const row = rows.find((f) => f.name === oldName && (!f.folder || f.folder === oldDir))
      if (!row || (oldName === newName && (row.folder || '') === (row.folder ? newDir : ''))) continue
      const i = lines.findIndex((l) => { const c = l.match(/^\|(.+)\|\s*$/)?.[1].split('|'); return c && strip(c[0]) === oldName })
      if (i < 0) continue
      lines[i] = editFormRow(lines[i], newName, row.folder ? newDir : '')
      formRows++
    }
    for (const f of newForms) {
      lines.push(`| ${f.name} | — | ${f.folder || '—'} | 대상 | — | 지식문서 |`)
      formRows++
    }
    if (formRows) writes.push({ rel: '_forms.md', text: lines.join('\n').replace(/\n*$/, '\n') })
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
  const finalIds = [...[...docSet].map((r) => idOf(map.get(r) || r)), ...creates]
  const folders = new Set(dirs)
  for (const id of finalIds) { let f = P.dirname(id); while (f && f !== '.') { folders.add(f); f = P.dirname(f) } }
  const kids = new Map([['', []]])
  for (const f of folders) kids.set(f, [])
  for (const f of folders) kids.get(P.dirname(f) === '.' ? '' : P.dirname(f))?.push(P.basename(f) + '/')
  for (const id of finalIds) kids.get(P.dirname(id) === '.' ? '' : P.dirname(id))?.push(P.basename(id))
  const want = ops.order && typeof ops.order === 'object' ? ops.order : parseOrder(files.order).order
  const order = {}
  for (const [f, names] of kids) {
    const listed = (Array.isArray(want[f]) ? want[f] : []).map((x) => nfc(String(x)))
    order[f] = sortSiblings(names, listed)
  }
  const orderText = renderOrder(order)
  const orderChanged = readText(files.order || '') !== orderText
  if (orderChanged) writes.push({ rel: ORDER_FILE, text: orderText })

  const created = creates.map((c) => ({ rel: relOf(c), text: `# ${P.basename(c)}\n` }))
  const lines = [
    ...mv.map((m) => `- ${P.basename(idOf(m.from)) !== P.basename(idOf(m.to)) && P.dirname(m.from) === P.dirname(m.to) ? '이름' : '옮김'}: ${idOf(m.from)} → ${idOf(m.to)}`),
    ...creates.map((c) => `- 새 문서: ${c}`),
    ...dirs.filter((d) => !finalIds.some((id) => id.startsWith(d + '/'))).map((d) => `- 빈 폴더: ${d}/`),
  ]
  const summary = { moved: mv.length, created: creates.length, links, registry: regRows, forms: formRows, sources: srcRows, order: orderChanged, docsTouched: writes.filter((w) => w.rel.startsWith('docs/')).length }
  return { errors: [], moves: mv, writes, creates: created, summary, lines }
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
  return { docs, registry: await readOr(path.join(dir, '_managed.md')), forms: await readOr(path.join(dir, '_forms.md')), sources, order: await readOr(path.join(dir, ORDER_FILE)) }
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

// ── 적용 ──
//   { dry } 면 쓰지 않고 계획 요약 · base 가 지금 지문과 다르면 E_CONFLICT · 바뀔 것이 없으면 commit null
export function applyRestructure(dir, ops, { user, by = null, base = null, dry = false, now = new Date() } = {}) {
  if (!user) fail('E_INPUT', '누가 쓰는지 모른다')
  return serial(path.resolve(dir), async () => {
    const files = await readStructure(dir)
    const fp = structureFp([...files.docs.keys()].map((r) => r.slice(5, -3)), files.order)
    if (base && base !== fp) fail('E_CONFLICT', '그사이 문서 짜임이 바뀌었다. 다시 읽고 고친다')
    const plan = planRestructure(files, ops)
    if (plan.errors.length) fail('E_INPUT', `${plan.errors[0].where}: ${plan.errors[0].why}${plan.errors.length > 1 ? ` · 그 밖 ${plan.errors.length - 1}` : ''}`, plan.errors)
    const nothing = !plan.moves.length && !plan.writes.length && !plan.creates.length
    if (dry || nothing) return { dry, fp, summary: plan.summary, lines: plan.lines, commit: null, log: null }
    await ensureRepo(dir)
    const date = localStamp(now)
    const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
    let id = `${day}-문서-짜임-바꿈`
    for (let n = 2; await recordTaken(dir, id); n++) id = `${day}-문서-짜임-바꿈-${n}`
    const logRel = `${LOG_DIR}/${id}.md`
    const s = plan.summary
    const title = `문서 짜임 바꿈: ${[s.moved ? `옮김 ${s.moved}` : '', s.created ? `새 문서 ${s.created}` : '', s.links ? `링크 ${s.links}` : '', s.order ? '차례' : ''].filter(Boolean).join(' · ') || '장부'}`
    const body = [`문서 짜임 화면에서 바꿨다(옛 경로 → 새 경로). 이름이 바뀐 문서는 제목도 그 이름이다${by ? ` · 바꾼 사람 ${by}` : ''}`, ...plan.lines, s.links ? `- 고친 링크 ${s.links}(문서 ${s.docsTouched + s.moved})` : '', s.registry ? `- 자리 장부 줄 ${s.registry}` : '', s.forms ? `- 갈래 장부 줄 ${s.forms}` : '', s.sources ? `- 가져올 곳 ${s.sources}` : '', s.order ? '- 차례 장부' : ''].filter(Boolean).join('\n')
    const j = await begin(dir)
    const paths = []
    try {
      for (const m of plan.moves) { await j.add(m.from); await j.add(m.to) }
      for (const c of plan.creates) await j.add(c.rel)
      for (const w of plan.writes) await j.add(w.rel)
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
      await fs.mkdir(path.join(dir, LOG_DIR), { recursive: true })
      await j.add(logRel)
      await writeAtomic(path.join(dir, LOG_DIR, `${id}.md`), renderRecord({ id, title, date, author: user, tags: ['structure'] }, body))
      paths.push(...new Set([...plan.moves.flatMap((m) => [m.from, m.to]), ...plan.creates.map((c) => c.rel), ...plan.writes.map((w) => w.rel), logRel]))
      const commit = await commitPaths(dir, paths, title, user)
      await j.done()
      await pruneEmpty(dir).catch(() => {})
      return { dry: false, fp: null, summary: plan.summary, lines: plan.lines, commit, log: id }
    } catch (e) {
      await j.undo().catch(() => {})
      throw e
    }
  })
}
