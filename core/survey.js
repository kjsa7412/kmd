// 원본 조사 · 짜임 꾸러미(바탕 세우기 설계 4-1 · 6절 · Z9).
//
//   원본 폴더를 읽어 파일마다 글로 바꾸고(core/importer.js fileToMd 그대로) 판 · 같은 글 · 스캔 · 비밀 의심을 가른다.
//   세션 스킬 kmd-seed(scripts/kmd-seed.mjs)가 이 결과를 「짜임 꾸러미」 폴더로 쓰고, 개인 프로그램의 기초 세우기(TODO 9 · /api/shape/survey)가
//   같은 함수로 원본이나 꾸러미를 연다(openPack). 꾸러미의 결정 · 구조안은 처음 값일 뿐이고 사람이 화면에서 승인한다.
//   지식에 쓰지 않는다 — 꾸러미 폴더(out)에만 쓴다.
//
//   꾸러미 꼴(6절)
//     manifest.json        { v, kind: 'kmd-seed', made, root, counts, rows: [row] }
//     md/<sha16>.md        재료 글(글로 바꾼 것 · 스캔은 Claude Code 가 원본을 읽어 지은 글 · 줄 표시 scan: true)
//     cards/*.json         재료 카드(하위 에이전트) · plan.json 구조안(3-3 꼴 · kind seed) · texts/*.json 항목 글 초안(선택)
//   row — { path, size, mtime, orig(원본 지문), kind, date, topic, form, group?, src?(m:<sha16>), chars?, scan?, digest?, secret?, role, pick, why? }
//     role  정본 · 옛 판 · 같은 글 · 스캔 · 비밀 의심 · 그림 · 못 읽음
//     pick  넣음 · 근거만 · 빼기 · 보류(5-3 2 기본값: 정본 넣음 · 옛 판 빼기 · 같은 글 빼기 · 스캔 보류(글로 바꾼 판이 있으면 넣음) · 비밀 의심 보류 · 못 읽음 빼기)
//   지문 — 재료 id 는 들이기 md/<sha16> 와 같은 sha256(글.trim()) 앞 16자(importer.js planImport · hub.seedUpload)

import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileToMd, cleanPath } from './importer.js'
import { DATE_RE, topicOfName } from './ingest.js'
import { formFor, DEFAULT_FORMS } from './guard.js'
import { readText } from './text.js'
import { writeFileAtomic, writeJsonAtomic } from './atomic.js'
import { cleanPlan, readShape, planCheck, SEED_RULES } from './shape.js'
import { formatProblems } from './docformat.js'
import { WRITE_RULES } from './writerules.js'
import { KmdError } from './errors.js'

export const PACK_V = 1
export const PACK_KIND = 'kmd-seed'
export const MANIFEST = 'manifest.json'
export const BIG = 20 << 20 // 큰 파일(알림만)
export const ROLES = ['정본', '옛 판', '같은 글', '스캔', '비밀 의심', '그림', '못 읽음']
export const PICKS = ['넣음', '근거만', '빼기', '보류']
const SRC_RE = /^m:[0-9a-f]{16}$/
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex')
export const srcOf = (md) => `m:${sha(String(md).trim()).slice(0, 16)}`
const mdFile = (pack, src) => path.join(pack, 'md', `${src.slice(2)}.md`)

// ── 원본 걷기 — 숨은 것 · 오피스 임시 파일 · 꾸러미 자신은 뺀다 ──
const SKIP_NAME = /^(\.|~\$)|^(node_modules|Thumbs\.db|desktop\.ini)$/i
async function walk(root, skipAbs = []) {
  const out = []
  const go = async (abs, rel) => {
    if (skipAbs.some((s) => path.resolve(abs) === s)) return
    for (const e of (await fs.readdir(abs, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'ko'))) {
      if (SKIP_NAME.test(e.name)) continue
      const a = path.join(abs, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await go(a, r)
      else if (e.isFile()) out.push({ abs: a, rel: cleanPath(r) })
    }
  }
  await go(root, '')
  return out
}

// ── 비밀 의심(5-3 2 · 1차 규칙) — 비밀번호 · 열쇠 꼴 줄 · 개인 열쇠 · 주민번호 꼴. 값은 싣지 않고 줄 번호와 까닭만 ──
const SECRET_RULES = [
  [/(비밀\s*번호|패스워드|암호|password|passwd|pwd|secret|api[_-]?key|access[_-]?key|token)\s*[:=：]\s*\S{4,}/i, '비밀번호 · 열쇠 꼴 줄'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '개인 열쇠'],
  [/\b(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/, '열쇠 꼴 값'],
  [/(?<!\d)\d{6}-[1-4]\d{6}(?!\d)/, '주민번호 꼴'],
]
export function secretsIn(md) {
  const out = []
  readText(md).split('\n').forEach((l, i) => {
    for (const [re, why] of SECRET_RULES) if (re.test(l) && !out.some((x) => x.why === why)) out.push({ line: i + 1, why })
  })
  return out
}

// ── digest — 머리 줄 · 첫 문단 · 표 머리 · 길이 · 되풀이 ID(카드를 지을 때 원문 대신 먼저 본다) ──
export function digestOf(md) {
  const lines = readText(md).split('\n')
  const heads = lines.filter((l) => /^#{1,6}\s/.test(l)).slice(0, 20).map((l) => l.trim().slice(0, 120))
  const tables = []
  for (let i = 0; i < lines.length - 1 && tables.length < 5; i++) if (/^\s*\|/.test(lines[i]) && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1]) && /-/.test(lines[i + 1])) tables.push(lines[i].trim().slice(0, 160))
  const para = []
  for (const l of lines) {
    if (/^#|^\s*\|/.test(l)) { if (para.length) break; continue }
    if (!l.trim()) { if (para.length) break; continue }
    para.push(l.trim())
  }
  const ids = {}
  for (const m of readText(md).matchAll(/\b([A-Z]{2,8})-\d{1,6}\b/g)) ids[m[1]] = (ids[m[1]] || 0) + 1
  return { heads, first: para.join(' ').slice(0, 300), tables, chars: md.length, lines: lines.length, ids: Object.fromEntries(Object.entries(ids).filter(([, n]) => n >= 3)) }
}

const dateOf = (rel) => { const m = DATE_RE.exec(path.posix.basename(rel)); return m ? `${m[1]}-${m[2]}-${m[3]}` : null }
// 판 꼬리 — v2 · 2판 · 최종(final) 이 앞 판보다 늦다(날짜가 같거나 없을 때)
const verOf = (rel) => {
  const b = path.posix.basename(rel)
  const v = b.match(/(?:^|[\s_-])[vV](\d+(?:\.\d+)?)|(\d+)\s*판/)
  return (v ? Number(v[1] || v[2]) : 0) + (/최종|final/i.test(b) ? 1e6 : 0)
}
const DEFAULT_PICK = { 정본: '넣음', '옛 판': '빼기', '같은 글': '빼기', 스캔: '보류', '비밀 의심': '보류', 그림: '빼기', '못 읽음': '빼기' }

// 재료 글 하나를 줄에 싣는다(조사 · 스캔 글 넣기가 같이 쓴다)
function withText(row, md, { scan = false } = {}) {
  const secret = secretsIn(md)
  return { ...row, src: srcOf(md), chars: md.length, digest: digestOf(md), ...(scan ? { scan: true } : {}), ...(secret.length ? { secret } : {}) }
}

// 판 · 같은 글 · 비밀 의심 · 기본 고르기 — 줄 목록 전체를 다시 가른다(스캔 글을 넣은 뒤에도 부른다)
export function classify(rows) {
  const out = rows.map((r) => {
    const { group, same, ...x } = r
    let role = x.src ? (x.scan ? '스캔' : '정본') : x.kind === 'img' ? '그림' : x.scanNeed ? '스캔' : '못 읽음'
    return { ...x, role }
  })
  // 판 묶음 — 같은 폴더 · 같은 주제(파일 이름에서 날짜 · 판 · 최종을 걷은 것). 사건 갈래(회의록 · 장애 · 보고)는 날짜가 다르면 다른 사건이다
  const groups = new Map()
  for (const r of out) {
    if (!r.src) continue
    const kind = DEFAULT_FORMS.find((f) => f.name === r.form)?.kind
    const key = `${path.posix.dirname(r.path)}\n${r.topic.toLowerCase()}${kind === '사건' && r.date ? `\n${r.date}` : ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  let gn = 0
  for (const g of groups.values()) {
    if (g.length < 2) continue
    gn++
    const late = [...g].sort((a, b) => (b.date || '').localeCompare(a.date || '') || verOf(b.path) - verOf(a.path) || (b.mtime || '').localeCompare(a.mtime || '') || a.path.localeCompare(b.path))[0]
    for (const r of g) { r.group = `g${gn}`; if (r !== late) r.role = '옛 판' }
  }
  // 같은 글 — 같은 재료 id 는 앞 줄 하나만(옛 판이 아닌 것을 앞에)
  const first = new Map()
  for (const r of [...out].sort((a, b) => (a.role === '옛 판') - (b.role === '옛 판') || a.path.localeCompare(b.path))) {
    if (!r.src) continue
    if (first.has(r.src)) { if (r.role !== '옛 판') r.role = '같은 글'; r.same = first.get(r.src) } else first.set(r.src, r.path)
  }
  for (const r of out) {
    if (r.secret?.length) r.role = '비밀 의심'
    r.pick = r.role === '스캔' && r.src ? '넣음' : DEFAULT_PICK[r.role]
  }
  return out
}

// 팀 올리기 묶음(hub.seedUpload) → 조사 줄 — 브라우저가 올린 파일마다 { path, size, orig, kind, src?, why? } 와 재료 글(textOf(src))로
//   조사와 같은 줄(주제 · 갈래 · 날짜 · 비밀 의심 · digest · 판 · 같은 글 · 기본 고르기)을 짓는다. 글은 바꾸지 않는다(재료 id 그대로)
export function rowsOfUpload(list, textOf) {
  const rows = list.map((x) => {
    const topic = topicOfName(x.path)
    const form = formFor({ rows: DEFAULT_FORMS }, topic)?.name || formFor({ rows: DEFAULT_FORMS }, x.path)?.name || null
    const row = { path: x.path, size: x.size || 0, orig: x.orig, kind: x.kind, date: dateOf(x.path), topic, form }
    const md = x.src ? textOf(x.src) : null
    if (typeof md === 'string' && md.trim()) return withText(row, md)
    return { ...row, ...(/글 층이 없다|스캔/.test(x.why || '') ? { scanNeed: true } : {}), why: x.why || '재료 글이 없다' }
  })
  return classify(rows)
}

export function countsOf(rows) {
  const c = { files: rows.length, bytes: rows.reduce((a, r) => a + (r.size || 0), 0), big: rows.filter((r) => r.size > BIG).length, scanNeed: rows.filter((r) => r.role === '스캔' && !r.src).length }
  for (const k of ROLES) c[k] = rows.filter((r) => r.role === k).length
  for (const k of PICKS) c[`pick:${k}`] = rows.filter((r) => r.pick === k).length
  return c
}

// 꾸러미 자리가 지식 폴더 · 원본 안 · 아무 폴더가 아닌가(지식 · 서버 폴더에 쓰지 않는다)
async function exists(p) { try { await fs.access(p); return true } catch { return false } }
async function guardOut(root, out) {
  const r = path.resolve(root)
  const o = path.resolve(out)
  if (o === r || r.startsWith(o + path.sep)) throw new KmdError('E_INPUT', '꾸러미 폴더는 원본 폴더 자신이거나 그 위가 아니어야 한다')
  if ((await exists(path.join(o, 'docs'))) || (await exists(path.join(o, '.git'))) || (await exists(path.join(o, '_vocab.md')))) throw new KmdError('E_INPUT', `지식 폴더처럼 보인다(docs/ · .git): 꾸러미는 빈 폴더나 앞 꾸러미에만 쓴다: ${o}`)
  if (await exists(o)) {
    const ents = (await fs.readdir(o)).filter((n) => !n.startsWith('.'))
    if (ents.length && !ents.includes(MANIFEST)) throw new KmdError('E_INPUT', `비어 있지 않은 폴더다(꾸러미 표지 ${MANIFEST} 없음): ${o}`)
  }
}

// 원본 조사 → 꾸러미(manifest + md/) — 다시 돌리면 같은 원본(orig)에 넣어 둔 스캔 글은 이어 쓴다
export async function survey(root, { out, now = new Date(), log = () => {} } = {}) {
  const r = path.resolve(root)
  if (!(await fs.stat(r).catch(() => null))?.isDirectory()) throw new KmdError('E_INPUT', `원본 폴더가 없다: ${r}`)
  if (!out) throw new KmdError('E_INPUT', '꾸러미 폴더(--out)를 준다')
  await guardOut(r, out)
  const o = path.resolve(out)
  const prev = (await exists(path.join(o, MANIFEST))) ? await readManifest(o) : null
  const prevScan = new Map((prev?.rows || []).filter((x) => x.scan && x.src).map((x) => [x.orig, x]))
  const rows = []
  const files = await walk(r, [o])
  for (const [i, f] of files.entries()) {
    const buf = await fs.readFile(f.abs)
    const st = await fs.stat(f.abs)
    const topic = topicOfName(f.rel)
    const form = formFor({ rows: DEFAULT_FORMS }, topic)?.name || formFor({ rows: DEFAULT_FORMS }, f.rel)?.name || null
    let row = { path: f.rel, size: buf.length, mtime: st.mtime.toISOString(), orig: sha(buf).slice(0, 16), date: dateOf(f.rel), topic, form }
    const fm = await fileToMd(f.rel, buf, { convert: true })
    row.kind = fm.kind
    const md = typeof fm.md === 'string' && fm.md.trim() ? fm.md : null
    const old = prevScan.get(row.orig)
    if (md) {
      row = withText(row, md)
      await writeFileAtomic(mdFile(o, row.src), md)
    } else if (old && (await exists(mdFile(o, old.src)))) {
      row = withText(row, await fs.readFile(mdFile(o, old.src), 'utf8'), { scan: true })
    } else {
      if (fm.scan || fm.blank) row.scanNeed = true
      row.why = fm.why || (fm.scan ? '글 층이 없다(스캔): 세션이 원본을 읽어 글을 짓는다(kmd-seed text)' : fm.blank ? '글이 없다(그림만)' : fm.kind === 'img' ? '그림: 재료 글이 아니다' : '글로 바꾸지 못하는 꼴이다')
    }
    rows.push(row)
    if ((i + 1) % 50 === 0) log(`조사 ${i + 1}/${files.length}`)
  }
  const all = classify(rows)
  await writeManifest(o, { root: r, made: now.toISOString(), rows: all })
  // 카드 · 글 초안 · 프롬프트 자리를 미리 만든다(세션 · 하위 에이전트가 ls · mkdir 을 부르지 않고 Write 만으로 쓴다 · 허락 거절을 줄인다)
  for (const d of ['cards', 'texts', 'prompts']) await fs.mkdir(path.join(o, d), { recursive: true })
  await pruneMd(o, all)
  return { pack: o, root: r, rows: all, counts: countsOf(all) }
}

async function writeManifest(o, { root, made, rows }) {
  const m = { v: PACK_V, kind: PACK_KIND, made, root, counts: countsOf(rows), rows }
  await writeJsonAtomic(path.join(o, MANIFEST), m, { indent: 1, nl: true })
  return m
}
// 줄이 가리키지 않는 재료 글을 치운다(manifest 를 쓴 뒤 · 던지지 않는다)
async function pruneMd(o, rows) {
  try {
    const keep = new Set(rows.filter((x) => x.src).map((x) => `${x.src.slice(2)}.md`))
    for (const n of await fs.readdir(path.join(o, 'md')).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)))) if (!keep.has(n)) await fs.rm(path.join(o, 'md', n), { force: true })
  } catch (e) { console.error('꾸러미: 쓰지 않는 재료 글을 치우지 못했다', e.message) }
}

// manifest 읽기 — 깨졌으면 빈 것으로 보지 않고 멈춘다
export async function readManifest(pack) {
  let m
  try {
    m = JSON.parse(await fs.readFile(path.join(pack, MANIFEST), 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') throw new KmdError('E_INPUT', `꾸러미가 아니다(${MANIFEST} 없음): ${pack}`)
    throw new KmdError('E_INPUT', `꾸러미 ${MANIFEST} 가 깨졌다(덮지 않는다 · 다시 조사한다): ${e.message}`)
  }
  if (!m || m.kind !== PACK_KIND || m.v !== PACK_V || !Array.isArray(m.rows)) throw new KmdError('E_INPUT', `꾸러미 꼴이 아니다(kind ${PACK_KIND} · v ${PACK_V})`)
  for (const x of m.rows) {
    if (!x || typeof x !== 'object' || typeof x.path !== 'string' || (x.src != null && !SRC_RE.test(x.src)) || !ROLES.includes(x.role) || !PICKS.includes(x.pick)) throw new KmdError('E_INPUT', `꾸러미 줄 꼴이 아니다: ${String(x?.path).slice(0, 80)}`)
  }
  return m
}
export const isPack = async (dir) => exists(path.join(path.resolve(dir), MANIFEST))

// 스캔 글 넣기 — 세션(Claude Code)이 원본을 읽어 지은 글을 그 줄의 재료로(표시 scan: true · 고르기 넣음)
export async function addText(pack, rel, md) {
  const o = path.resolve(pack)
  const m = await readManifest(o)
  const want = cleanPath(rel)
  const row = m.rows.find((x) => x.path === want)
  if (!row) throw new KmdError('E_NOTFOUND', `꾸러미에 없는 파일이다: ${want}`)
  if (row.src && !row.scan) throw new KmdError('E_CONFLICT', `이미 글로 바뀐 파일이다(스캔이 아니다): ${want}`)
  const text = readText(String(md || ''))
  if (!text.trim()) throw new KmdError('E_INPUT', '빈 글이다')
  const { role, pick, why, scanNeed, ...base } = row
  const next = withText(base, text.endsWith('\n') ? text : `${text}\n`, { scan: true })
  await writeFileAtomic(mdFile(o, next.src), text.endsWith('\n') ? text : `${text}\n`)
  const rows = classify(m.rows.map((x) => (x === row ? next : x)))
  await writeManifest(o, { root: m.root, made: m.made, rows })
  await pruneMd(o, rows)
  return rows.find((x) => x.path === want)
}

// ── 꾸러미 열기 — manifest · 재료 글 지문 · cards · plan.json(cleanPlan) · texts/*.json(꼴 검사) ──
//   개인 기초 세우기(TODO 9 · /api/shape/survey { dir })가 원본 대신 꾸러미 폴더를 받으면 이것으로 연다.
//   → { pack, root, made, rows, counts, cards, plan, planError, texts: [{ file, doc, items: [{ h, text }] }], problems: [{ where, why }] }
export async function openPack(dir) {
  const o = path.resolve(dir)
  const m = await readManifest(o)
  const problems = []
  for (const x of m.rows) {
    if (!x.src) continue
    const text = await fs.readFile(mdFile(o, x.src), 'utf8').catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)))
    if (text == null) problems.push({ where: x.path, why: `재료 글이 없다(md/${x.src.slice(2)}.md)` })
    else if (srcOf(text) !== x.src) problems.push({ where: x.path, why: '재료 글이 조사 뒤 바뀌었다(지문이 다르다): 손으로 고치지 않는다 · 다시 조사하거나 text 로 넣는다' })
  }
  const jsonIn = async (sub) => {
    const names = (await fs.readdir(path.join(o, sub)).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)))).filter((n) => n.endsWith('.json')).sort()
    const out = []
    for (const n of names) {
      try { out.push({ file: `${sub}/${n}`, data: JSON.parse(await fs.readFile(path.join(o, sub, n), 'utf8')) }) } catch (e) { problems.push({ where: `${sub}/${n}`, why: `JSON 이 깨졌다: ${e.message}` }) }
    }
    return out
  }
  const cards = await jsonIn('cards')
  let plan = null
  let planError = null
  const rawPlan = await fs.readFile(path.join(o, 'plan.json'), 'utf8').catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)))
  if (rawPlan != null) {
    let raw
    try { raw = JSON.parse(rawPlan) } catch (e) { planError = `plan.json 이 깨졌다: ${e.message}` }
    if (raw !== undefined) {
      const c = cleanPlan(raw)
      if (c.error) planError = c.error
      else if (c.plan.kind !== 'seed') planError = '꾸러미 구조안은 kind: seed 다'
      else plan = c.plan
    }
  }
  const texts = []
  for (const t of await jsonIn('texts')) {
    const d = t.data
    if (!d || typeof d !== 'object' || typeof d.doc !== 'string' || !Array.isArray(d.items) || d.items.some((x) => !x || typeof x.h !== 'string' || typeof x.text !== 'string' || x.text.length > 200000)) {
      problems.push({ where: t.file, why: '글 초안 꼴이 아니다: { doc, items: [{ h, text }] }' })
      continue
    }
    texts.push({ file: t.file, doc: d.doc, items: d.items.map((x) => ({ h: x.h, text: x.text })) })
  }
  return { pack: o, root: m.root, made: m.made, rows: m.rows, counts: countsOf(m.rows), cards: cards.length, plan, planError, texts, problems }
}

export const EMPTY_FILES = () => ({ docs: new Map(), registry: '', forms: '', sources: null, order: '' })

// ── 꾸러미 검사(지식에 쓰지 않음) — planCheck(빈 지식 · 또는 넣을 지식을 읽기만) + 꾸러미 규칙(재료 있음 · 덮임 · 비밀 의심 · 글 초안 꼴) ──
//   k · files — 넣을 지식(loadKnowledge · readStructure)을 주면 그 지식에 견준다 · 없으면 빈 지식
export async function packCheck(dir, { k = null, files = null } = {}) {
  const P = await openPack(dir)
  const errors = P.problems.map((p) => ({ ...p, code: 'pack' }))
  const warnings = []
  const S = readShape(k, files || EMPTY_FILES())
  if (P.planError) errors.push({ where: 'plan.json', why: P.planError, code: 'plan' })
  if (!P.plan) {
    if (!P.planError) errors.push({ where: 'plan.json', why: '구조안이 아직 없다(plan.json)', code: 'plan' })
    return { ok: false, stale: false, base: S.fp, errors, warnings, summary: null, counts: P.counts }
  }
  const r = planCheck(k, S, P.plan)
  errors.push(...r.errors)
  warnings.push(...r.warnings)
  const bySrc = new Map()
  for (const x of P.rows) if (x.src && !bySrc.has(x.src)) bySrc.set(x.src, x)
  const used = new Set()
  for (const d of P.plan.docs) for (const it of d.items) {
    for (const s of it.src || []) {
      used.add(s)
      const row = bySrc.get(s)
      if (!row) { errors.push({ where: `${d.id} › ${it.h}`, why: `꾸러미에 없는 재료다: ${s}`, code: 'src' }); continue }
      if (row.role === '비밀 의심' || P.rows.some((x) => x.src === s && x.role === '비밀 의심')) errors.push({ where: `${d.id} › ${it.h}`, why: `비밀 의심 재료를 쓴다(${row.path}): 빼거나 사람이 본 뒤 비밀을 가린 글로 다시 넣는다`, code: 'secret' })
      else if (row.pick === '빼기' || row.pick === '보류') warnings.push({ where: `${d.id} › ${it.h}`, why: `${row.role} 재료를 쓴다(${row.path} · 고르기 ${row.pick})` })
    }
    if (typeof it.text === 'string') for (const p of formatProblems(it.text, { doc: `docs/${d.id}.md` })) errors.push({ where: `${d.id} › ${it.h}`, why: `${p.line}째 줄 ${p.what}`, code: 'format' })
  }
  // 덮임(6-1 7) — 넣음으로 고른 재료는 모두 어느 항목에 쓰이거나 까닭과 함께 skip
  const skipped = new Set(P.plan.skip.map((x) => x.src))
  for (const x of P.rows) if (x.src && x.pick === '넣음' && !used.has(x.src) && !skipped.has(x.src) && x.role !== '같은 글') errors.push({ where: x.path, why: '넣음으로 고른 재료가 구조안 어디에도 없다(items[].src 에 쓰거나 skip 에 까닭과 함께)', code: 'coverage' })
  for (const x of P.plan.skip) if (!bySrc.has(x.src)) warnings.push({ where: x.src, why: 'skip 의 재료가 꾸러미에 없다' })
  // 글 초안 — 구조안에 있는 항목 · 꼴(작성기준 3 · 4절)
  const planned = new Map(P.plan.docs.map((d) => [d.id, new Set(d.items.map((it) => it.h))]))
  for (const t of P.texts) {
    const hs = planned.get(t.doc)
    for (const it of t.items) {
      if (!hs?.has(it.h)) errors.push({ where: `${t.file} › ${it.h}`, why: `구조안에 없는 항목이다: ${t.doc} › ${it.h}`, code: 'text' })
      for (const p of formatProblems(it.text, { doc: `docs/${t.doc}.md` })) errors.push({ where: `${t.file} › ${it.h}`, why: `${p.line}째 줄 ${p.what}`, code: 'format' })
    }
  }
  if (P.counts.scanNeed) warnings.push({ where: '스캔', why: `글이 없는 스캔 ${P.counts.scanNeed}: 보류로 남는다(kmd-seed text 로 글을 넣으면 재료가 된다)` })
  return { ok: !errors.length, stale: r.stale, base: S.fp, errors, warnings, summary: r.summary, counts: P.counts }
}

// ── 판단 기준(바탕 설계 6-1) — core/shape.js 한 벌(구조안 프롬프트 · 스킬 · planCheck 공통 · Z6 에서 옮김) ──
export { SEED_RULES }

// 하위 에이전트가 부르는 꼴(채널 평가 T10 ⑦ · real-4 · 4b 의 거절은 「cd <저장소> && node scripts/… check」 · 「ls … || mkdir …」 였다):
//   스크립트는 절대 경로(앞으로 빗금 · 시험 허락 subAllow 와 같은 꼴) 한 줄 · cd · && · || · ls · mkdir 없음 · 폴더는 survey 가 만들어 두었다
export const SEED_SCRIPT = fileURLToPath(new URL('../scripts/kmd-seed.mjs', import.meta.url)).split(path.sep).join('/')
//   빈칸이 든 경로(설치된 판 ~/.kmd-app/versions/<판> 이 「C:/Users/홍 길동/…」 같은 곳)면 스크립트 경로도 따옴표로 감싼다(subAllow 가 두 꼴을 다 허락한다)
export const seedCheckCmd = (pack, script = SEED_SCRIPT) => `node ${/\s/.test(script) ? `"${script}"` : script} check "${pack}"`
const checkCmd = (pack) => seedCheckCmd(pack)
const CALL_LINE = '- 명령은 위 한 줄 그대로 부른다: cd · && · || · 파이프 · 2>&1 · ls · mkdir 을 쓰지 않는다. cards/ · texts/ · prompts/ 폴더는 이미 있다(파일은 Write 로 바로 쓴다).'

const CARD_FORM = '{ "src": "m:<16자>", "path": "<원본 경로>", "topic": "<대상 이름>", "form": "대상|사건|대장|서술", "date": "YYYY-MM-DD|null", "names": ["종류:값"], "facts": ["확정 사실 한 줄(값 글자 그대로)"], "secret": false, "note": "애매한 것 한 줄" }'

// 하위 에이전트 프롬프트(Claude Code 세션이 Agent 에 그대로 넘긴다) — 작성기준 3 ~ 5절(WRITE_RULES · 좋은 예 · 나쁜 예) · 6-1 판단 기준을 싣는다
export function promptOf(P, kind, { from = 0, n = 10, doc = null } = {}) {
  const pack = P.pack
  if (kind === 'card') {
    const rows = P.rows.filter((x) => x.src && x.pick !== '빼기' && x.role !== '비밀 의심').slice(from, from + n)
    if (!rows.length) throw new KmdError('E_INPUT', `카드를 지을 재료가 없다(from ${from})`)
    return [
      `너는 kmd 바탕 세우기의 재료 카드를 짓는다. 꾸러미: ${pack}`,
      `아래 재료마다 digest 를 먼저 보고, 애매할 때만 md/<16자>.md 원문을 읽는다. 재료마다 카드 하나를 ${path.join(pack, 'cards', '<16자>.json')} 에 쓴다(JSON 하나 · 다른 파일은 쓰지 않는다).`,
      `카드 꼴: ${CARD_FORM}`,
      '- 셸 명령을 부르지 않는다(Read 와 Write 만). cards/ 폴더는 이미 있다: ls · mkdir 없이 Write 로 바로 쓴다.',
      '- facts 는 원문에 있는 확정 사실만(값 · 날짜 · 이름 · `코드` 는 글자 그대로). 지어내지 않는다. 경위 · 논의 · 질문은 옮기지 않는다.',
      '- 비밀(비밀번호 · 열쇠 · 개인정보)이 보이면 secret: true 로 두고 facts 에 그 값을 옮기지 않는다.',
      SEED_RULES,
      '재료:',
      ...rows.map((x) => JSON.stringify({ src: x.src, path: x.path, role: x.role, date: x.date, form: x.form, digest: x.digest })),
    ].join('\n')
  }
  if (kind === 'plan') {
    return [
      `너는 kmd 바탕 세우기의 구조안을 짓는다. 꾸러미: ${pack}. 카드(${path.join(pack, 'cards')})를 모두 읽고 구조안 하나를 ${path.join(pack, 'plan.json')} 에 쓴다. 쓸 것은 plan.json 하나다(texts/ 는 아직 비었다 · 꾸러미 폴더를 둘러보거나 스킬 글 · 도움말을 읽지 않는다: 이 프롬프트가 전부다).`,
      '구조안 꼴(바탕 세우기 설계 3-3): { "v": 1, "kind": "seed", "forms": [{ "name", "kind", "folder", "aliases", "pattern?" }], "dirs": [], "docs": [{ "id": "폴더/문서", "was": null, "nature": "대상|서술|절차|시험|용어|사건|보고|대장|결정", "intro": { "ask": "…" } | { "text": "…" }, "items": [{ "h": "항목 머리", "src": ["m:<16자>"] }] }], "names": [{ "coord": "종류:값", "label", "gist": "뜻 한 줄", "doc", "h" }], "order": { "": ["폴더/"], "폴더": ["문서"] }, "skip": [{ "src": "m:<16자>", "why": "…" }] }',
      '- 문서마다 was: null · 항목마다 src(재료) · 넣음으로 고른 재료는 모두 src 이거나 skip. secret: true 카드의 재료는 쓰지 않고 skip(까닭 「비밀 의심」).',
      '- 문서마다 nature(으뜸 성격 · 생성 룰 R4-1: 그 문서를 찾으러 오는 사람의 물음 하나 · 못 고르면 서술) · 세우는 항목마다 names 에 짝(종류:값 · gist 뜻 한 줄 15 ~ 60자 · 생성 룰 R7-1 · 머리만 세우지 않는다).',
      '- 항목 머리는 대상 이름(사건 갈래만 「YYYY-MM-DD 주제」 · 대장은 「값: 설명」). 머리끼리 같거나 앞부분이 겹치지 않게.',
      SEED_RULES,
      `다 쓰면 ${checkCmd(pack)} 로 검사하고 걸림이 0 이 될 때까지 고친다.`,
      CALL_LINE,
    ].join('\n')
  }
  if (kind === 'text') {
    if (!P.plan) throw new KmdError('E_INPUT', '구조안(plan.json)이 먼저다')
    const d = P.plan.docs.find((x) => x.id === doc)
    if (!d) throw new KmdError('E_NOTFOUND', `구조안에 없는 문서다: ${doc}`)
    const file = path.join(pack, 'texts', `${d.id.replace(/[\\/:*?"<>|]/g, '__')}.json`)
    return [
      `너는 kmd 문서 「${d.id}」 의 항목 글 초안을 짓는다. 꾸러미: ${pack}. 항목마다 src 재료(md/<16자>.md)만 읽고 쓴다.`,
      `결과는 ${file} 에 { "doc": "${d.id}", "items": [{ "h": "<머리 그대로>", "text": "<항목 글>" }] } 하나로 쓴다.`,
      '- 재료에 없는 값을 지어내지 않는다(값 대조가 걸러 넣지 못함으로 남긴다). 같은 대상의 여러 재료는 늦은 판이 이긴다.',
      WRITE_RULES,
      '항목:',
      ...d.items.map((it) => JSON.stringify({ h: it.h, src: it.src || [] })),
      `다 쓰면 ${checkCmd(pack)} 로 꼴을 검사한다.`,
      CALL_LINE,
    ].join('\n')
  }
  throw new KmdError('E_INPUT', 'prompt 는 card · plan · text')
}
