// 자동으로 가져오는 곳 — `_sources.json`(지식 안 · 예약 파일)에 선언하고 원천 실행기가 할 일 시계에 맞춰 읽는다(v0.6 §5).
//
//   선언   { name, kind: git | folder, at(가린 주소 · 폴더), every, rules[{ rule, into: { doc, heading? } }], by, since }
//          자격 · 상태 · bare 사본은 넣지 않는다 — `<data>`(자격은 secrets · 상태는 baseline/<지식>.json)
//   한 번  ① 바뀌었나(git 은 받은 sha · 폴더는 지문 — 같으면 확인 시각만) ② 규칙 → 항목 ③ 지금 블록과 견줌
//          ④ 브레이크(새 항목 10 초과 · 사라짐 10% 초과면 쓰지 않고 멈춤 — 처음 잇기는 첫 배치 확인이라 예외)
//          ⑤ 바뀐 것만 저장 한 번(작성자 kmd · 태그 sources · 표지는 그대로 · 200 블록씩) ⑥ 실패면 마지막 표를 두고 실패를 센다
//   대상   git 은 bare · protocol https · ssh 만(ext:: · file:// 거절 · 이 PC 폴더는 허락된 원천 루트 안만) · 서브모듈 끔
//          폴더는 허락된 원천 루트 안만(팀) · <data> · 지식 폴더 · 백업 주소 거절 · 숨김 · .git · node_modules 는 읽지 않음 · 1MB
//
// 원천 실행기는 판정하지 않고 대기열에 세우지 않고 블록 밖 글 · 표지 · 다른 이름을 바꾸지 않는다. LLM 을 부르지 않는다.

import fs from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { tryGit, maskUrl, commitPaths, ensureRepo } from './git.js'
import { readText, nfc } from './text.js'
import { parseDoc, headingMatches } from './sections.js'
import { renderRecord } from './frontmatter.js'
import { localStamp, save as coreSave, serial } from './save.js'
import { RULES, splitBlocks, putBlock, tableMd, sameTable, sameRows, probe, parseTable } from './baseline.js'
import { getSecret, setSecret } from './secrets.js'
import { KmdError } from './errors.js'
import { stopLine, ageText } from './stopline.js'
import { readLedger, writeLedger, scanFolder, scanGit, changeCount } from './watch.js'
import { applyDocs, wantDoc } from './docwatch.js'
import { parseDbUrl, readDb } from './db.js'
import { locate } from './registry.js'
import { wantCode, codeRecord, diffFolder, diffGit, syncSnap, hasSnap, MAX_FILES as CODE_MAX } from './codechange.js'

export const DECL = '_sources.json'
const MAX_FILE = 1 << 20
const MAX_FILES = 3000
// change — 「바뀔 때만」: 5분마다 보고 바뀐 것만 쓴다(같으면 묶음 0 이라 자주 봐도 조용하다)
const EVERY_MS = { change: 300_000, hourly: 3600_000, daily: 86400_000, weekly: 7 * 86400_000 }
export const everyMs = (e) => EVERY_MS[String(e || 'hourly').split(' ')[0]] || 3600_000

export async function readDecl(dir) {
  const t = await fs.readFile(path.join(dir, DECL), 'utf8').catch(() => null)
  if (!t) return []
  try {
    const j = JSON.parse(t)
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

// 선언을 바꾸는 저장 — 기록 하나 + _sources.json · 작성자 그 사람 · 태그 sources
async function writeDecl(dir, list, { user, title }) {
  return serial(path.resolve(dir), async () => {
    await ensureRepo(dir)
    const date = localStamp()
    const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
    let id = `${day}-가져오는-곳`
    for (let n = 2; existsSync(path.join(dir, 'work', `${id}.md`)); n++) id = `${day}-가져오는-곳-${n}`
    await fs.mkdir(path.join(dir, 'work'), { recursive: true })
    await fs.writeFile(path.join(dir, 'work', `${id}.md`), renderRecord({ id, title, date, author: user, tags: ['sources'] }, title), 'utf8')
    await fs.writeFile(path.join(dir, DECL), JSON.stringify(list, null, 1) + '\n', 'utf8')
    return commitPaths(dir, [`work/${id}.md`, DECL], title, user)
  })
}

// ── 상태 — <data>/baseline/<지식>.json ──
const stateFile = (dataDir, kn) => path.join(dataDir, 'baseline', `${encodeURIComponent(kn)}.json`)
export async function readState(dataDir, kn) {
  return fs.readFile(stateFile(dataDir, kn), 'utf8').then(JSON.parse, () => ({}))
}
async function writeState(dataDir, kn, st) {
  await fs.mkdir(path.dirname(stateFile(dataDir, kn)), { recursive: true })
  await fs.writeFile(stateFile(dataDir, kn), JSON.stringify(st, null, 1))
}

// ── 대상 제한 ──
const inside = (p, root) => {
  const a = path.resolve(p).toLowerCase()
  const b = path.resolve(root).toLowerCase()
  return a === b || a.startsWith(b + path.sep)
}
export function checkTarget(at, { kind, roots = [], dataDir, knowledgeDirs = [], backups = [], pc = false }) {
  const s = String(at || '').trim()
  if (!s || /[\r\n\0]/.test(s) || /^-/.test(s) || /^ext::/i.test(s) || /^file:/i.test(s)) throw new KmdError('E_INPUT', '이 주소는 받지 않는다')
  if (backups.some((b) => b && maskUrl(b) === maskUrl(s))) throw new KmdError('E_INPUT', '이 kmd 의 백업 자리는 가져오는 곳이 될 수 없다')
  const isUrl = /^(https?|ssh):\/\//i.test(s) || /^[^/\\\s]+@[^/\\\s]+:/.test(s)
  if (kind === 'git' && isUrl) return { url: s }
  // 이 PC 의 폴더(폴더 원천 · 이 PC 의 git 저장소)
  if (/^\\\\/.test(s)) throw new KmdError('E_INPUT', '네트워크 폴더(\\\\…)는 받지 않는다')
  let real
  try {
    real = realpathSync(s)
  } catch {
    throw new KmdError('E_INPUT', '그 폴더가 없다')
  }
  if (inside(real, dataDir) || knowledgeDirs.some((d) => inside(real, d) || inside(d, real))) throw new KmdError('E_INPUT', 'kmd 의 살림 자리 · 지식 폴더는 가져오는 곳이 될 수 없다')
  if (!pc && !roots.some((r) => inside(real, r))) throw new KmdError('E_FORBIDDEN', '이 폴더는 가져오는 곳으로 허락되지 않았다 — serve.json 의 sourceRoots 에 더한다')
  return { folder: real }
}

// 주소의 자격(사용자:비밀@)은 떼어 비밀로 — 선언 · 로그 · 화면에는 가린 주소
// 가져오는 곳의 자격 이름 — 셸에서 치기 쉽게 영문 소문자로. 한글 · 그 밖의 글자가 있으면 짧은 지문을 붙여 겹치지 않게
//   dpms · dpms-api → src/dpms/dpms-api   ·   배포노트 · 운영 DB → src/k-1a2b3c/db-4d5e6f
const part = (x) => {
  const t = String(x).normalize('NFC')
  const a = t.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  return /^[A-Za-z0-9._-]+$/.test(t) && a ? a.slice(0, 24) : `${(a || 'k').slice(0, 16)}-${crypto.createHash('sha1').update(t).digest('hex').slice(0, 6)}`
}
export const secretPrefix = (kn) => `src/${part(kn)}/`
export const secretName = (kn, name) => secretPrefix(kn) + part(name)
export async function stripCreds(at, { dataDir, kn, name }) {
  try {
    const u = new URL(at)
    if (!u.username && !u.password) return at
    await setSecret(dataDir, secretName(kn, name), `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`)
    u.username = ''
    u.password = ''
    return u.toString()
  } catch {
    return at
  }
}

// ── 원천 읽기 → { sig, asof, files: [{ path, text }] } ──
const WANT = /\.(json|csv|tsv|toml|xml|gradle|kts|mod|js|mjs|ts|tsx|jsx|java|py|go|kt|cs|sql)$/i
const HIDDEN = /(^|\/)(\.[^/]*|node_modules)(\/|$)/
async function readFolder(root) {
  const files = []
  const stats = []
  let newest = 0
  const walk = async (dir, rel) => {
    if (files.length >= MAX_FILES) return
    const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (HIDDEN.test(r)) continue
      const full = path.join(dir, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) await walk(full, r)
      else if (WANT.test(e.name)) {
        const st = await fs.stat(full).catch(() => null)
        if (!st || st.size > MAX_FILE) continue
        newest = Math.max(newest, st.mtimeMs)
        stats.push(`${r}:${st.size}:${st.mtimeMs}`)
        files.push({ path: nfc(r), full })
      }
    }
  }
  await walk(root, '')
  const sig = crypto.createHash('sha1').update(stats.join('\n')).digest('hex')
  return { sig, asof: newest ? localStamp(new Date(newest)) : localStamp(), files, read: async () => Promise.all(files.map(async (f) => ({ path: f.path, text: readText(await fs.readFile(f.full, 'utf8')) }))) }
}
async function readGit(src, { dataDir, kn }) {
  const bare = path.join(dataDir, 'sources', encodeURIComponent(kn), `${crypto.createHash('sha1').update(src.name).digest('hex').slice(0, 12)}.git`)
  if (!existsSync(bare)) {
    await fs.mkdir(bare, { recursive: true })
    await tryGit(bare, ['init', '-q', '--bare'])
  }
  const local = src.folder != null
  const remote = local ? src.folder : src.at
  const cred = await getSecret(dataDir, secretName(kn, src.name))
  const env = cred ? { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(cred).toString('base64')}` } : {}
  const guard = ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', '-c', `protocol.file.allow=${local ? 'always' : 'never'}`, '-c', 'fetch.recurseSubmodules=false']
  const f = await tryGit(bare, [...guard, 'fetch', '-q', '--depth=1', remote, '+HEAD:refs/heads/kmd-src'], { timeout: 120_000, env })
  if (!f.ok) throw new KmdError('E_SOURCE', f.timedOut ? '원천이 답하지 않는다' : /auth|denied|403|401/i.test(f.err) ? '원천 자격이 맞지 않는다' : '원천에 닿지 않는다')
  const sig = (await tryGit(bare, ['rev-parse', 'refs/heads/kmd-src'])).out.trim()
  const asof = (await tryGit(bare, ['log', '-1', '--format=%ci', 'refs/heads/kmd-src'])).out.trim().slice(0, 16)
  const tree = (await tryGit(bare, ['ls-tree', '-r', '-l', 'refs/heads/kmd-src'])).out.split('\n').filter(Boolean)
  const files = []
  for (const l of tree) {
    const m = l.match(/^\d+ blob ([0-9a-f]+)\s+(\d+)\t(.+)$/)
    if (!m || Number(m[2]) > MAX_FILE || HIDDEN.test(m[3]) || !WANT.test(m[3])) continue
    files.push({ path: nfc(m[3].replace(/^"|"$/g, '')), blob: m[1] })
    if (files.length >= MAX_FILES) break
  }
  return { sig, asof, files, read: async () => Promise.all(files.map(async (x) => ({ path: x.path, text: readText((await tryGit(bare, ['cat-file', '-p', x.blob])).out) }))) }
}
export async function readSource(src, ctx) {
  if (src.kind === 'folder') return readFolder(src.folder || src.at)
  if (src.kind === 'git') return readGit(src, ctx)
  throw new KmdError('E_INPUT', src.kind === 'db' ? 'DB 원천은 다음 판에서 연다' : '모르는 원천 종류')
}

// ── 항목 → 블록 → 저장 계획 ──
// rules[{ rule, into: { doc, heading? } }] — heading 이 있으면 그 항목 하나에(의존성 판), 없으면 항목마다 머리 = 항목 이름
const DEFAULT_HEAD = { deps: '라이브러리 버전' }
// 규칙 결과 → 보낼 표들(내 PC 폴더 → 팀의 baseline 길) — 넣을 문서 · 머리 · 칸 · 줄
export function pushItems(src, items) {
  const out = []
  for (const r of src.rules) for (const it of items[r.rule] || []) {
    const heading = r.into.heading || it.key || DEFAULT_HEAD[r.rule]
    if (heading) out.push({ doc: it.doc || r.into.doc, heading: nfc(String(heading)), cols: it.cols, rows: it.rows })
  }
  return out
}
function targetsOf(src, items) {
  const out = []
  for (const r of src.rules) {
    const its = items[r.rule] || []
    for (const it of its) {
      // 머리 — 정한 것 · 항목 이름(표 파일마다) · 한 표만 내는 규칙은 그 규칙 이름(라이브러리 버전)
      const heading = r.into.heading || it.key || DEFAULT_HEAD[r.rule]
      if (!heading) continue
      out.push({ rule: r.rule, doc: it.doc || r.into.doc, heading: nfc(String(heading)), table: tableMd(it.cols, it.rows) })
    }
  }
  return out
}
const docPath = (doc) => `docs/${String(doc).replace(/^docs\/|\.md$/g, '')}.md`

export async function planRun(k, src, items, { asof, first = false, prev = [] }) {
  const targets = targetsOf(src, items)
  const changed = []
  const now = new Set(targets.map((t) => `${t.doc}\n${t.heading}`))
  let added = 0
  for (const t of targets) {
    const d = k.byDocPath.get(docPath(t.doc))
    const sec = d && d.sections.find((s) => headingMatches(s.h, t.heading))
    const old = sec ? splitBlocks(sec.body).blocks.find((b) => b.src === src.name && b.rule === t.rule) : null
    if (old && sameTable(old.table, t.table) && !old.missing) continue
    if (!sec) added++
    let body = sec ? sec.body : ''
    // 처음 잇기 — 블록 밖 옛 표가 규칙 결과와 같으면 그 표를 걷고 블록으로(같지 않으면 그대로 둔다)
    if (first && sec && !old) {
      const { text } = splitBlocks(body)
      const tbl = text.split('\n\n').find((para) => /^\s*\|/.test(para) && sameRows(para, t.table))
      if (tbl) body = body.replace(tbl, '').replace(/\n{3,}/g, '\n\n').trim()
    }
    changed.push({ doc: docPath(t.doc), heading: t.heading, content: putBlock(body, { src: src.name, rule: t.rule, asof, table: t.table }), applied: sec ? sec.applied || null : null })
  }
  // 사라진 항목 — 지우지 않고 「원천에 없다」
  const vanished = prev.filter((key) => !now.has(key))
  const today = localStamp().slice(0, 10)
  for (const key of vanished) {
    const [doc, heading] = key.split('\n')
    const d = k.byDocPath.get(docPath(doc))
    const sec = d && d.sections.find((s) => s.h === heading)
    const blk = sec && splitBlocks(sec.body).blocks.find((b) => b.src === src.name)
    if (!blk || blk.missing) continue
    changed.push({ doc: docPath(doc), heading, content: putBlock(sec.body, { ...blk, missing: today }), applied: sec.applied || null })
  }
  const brake = !first && (added > 10 || (prev.length && vanished.length / prev.length > 0.1))
  return { changed, added, vanished: vanished.length, items: [...now], brake, total: targets.length }
}

// ── 바뀐 것만 — 규칙마다 파일 단위 캐시(지문 장부의 out) ──
//   deps    — 꾸러미 파일(package.json · go.mod · pom.xml · build.gradle · pyproject.toml)마다 줄 · 모아서 한 표
//   tables  — 사람이 고른 파일 · 폴더(rule.paths) 안의 csv · tsv · json 마다 표 하나
//   files   — 예전 규칙(새로는 더하지 않는다) — 바뀐 코드 파일이 있으면 그 규칙만 다시
const MANIFEST = /(^|\/)(package\.json|go\.mod|pom\.xml|build\.gradle(\.kts)?|pyproject\.toml)$/
const CODE = /\.(js|mjs|ts|tsx|jsx|java|py|go|kt|cs|sql|xml)$/i
const underPaths = (p, paths) => !paths?.length || paths.some((x) => { const q = String(x).replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, ''); return !q || p === q || p.startsWith(q + '/') })
const wants = {
  deps: () => (p) => MANIFEST.test(p),
  tables: (r) => (p) => /\.(csv|tsv|json)$/i.test(p) && underPaths(p, r.paths),
  files: () => (p) => CODE.test(p),
}
export function wantOf(src) {
  const fs2 = src.rules.map((r) => (wants[r.rule] ? wants[r.rule](r) : () => false))
  return (p) => fs2.some((f) => f(p))
}
export async function rulesOut(src, scan, cache, { all }) {
  const touched = new Set([...scan.changes.added, ...scan.changes.changed])
  const items = {}
  const next = {}
  for (const r of src.rules) {
    const want = wants[r.rule] ? wants[r.rule](r) : () => false
    const paths = Object.keys(scan.files).filter(want).sort()
    if (r.rule === 'files') {
      const hit = all || !cache.files || paths.some((p) => touched.has(p)) || scan.changes.removed.some(want)
      next.files = hit ? RULES.files(await Promise.all(paths.map(async (p) => ({ path: p, text: await scan.read(p) })))) : cache.files
      items.files = next.files
      continue
    }
    if (!RULES[r.rule]) continue
    const c = all ? {} : { ...(cache[r.rule] || {}) }
    for (const p of paths) if (all || touched.has(p) || !(p in c)) c[p] = RULES[r.rule]([{ path: p, text: await scan.read(p) }])
    for (const p of Object.keys(c)) if (!paths.includes(p)) delete c[p]
    next[r.rule] = c
    if (r.rule === 'deps') {
      const m = new Map()
      for (const p of Object.keys(c).sort()) for (const it of c[p]) for (const row of it.rows) m.set(row[0], row)
      const rows = [...m.values()].sort((a, b) => a[0].localeCompare(b[0]))
      items.deps = rows.length ? [{ key: null, cols: ['꾸러미', '판'], rows }] : []
    } else items[r.rule] = Object.keys(c).sort().flatMap((p) => c[p]).sort((a, b) => String(a.key).localeCompare(String(b.key)))
  }
  return { items, cache: next }
}

// git 받아 오기 — bare 사본 · 새 커밋 · 그 시각
async function gitFetch(src, { dataDir, kn }) {
  const bare = path.join(dataDir, 'sources', encodeURIComponent(kn), `${crypto.createHash('sha1').update(src.name).digest('hex').slice(0, 12)}.git`)
  if (!existsSync(bare)) {
    await fs.mkdir(bare, { recursive: true })
    await tryGit(bare, ['init', '-q', '--bare'])
  }
  const local = src.folder != null
  const remote = local ? src.folder : src.at
  const cred = await getSecret(dataDir, secretName(kn, src.name))
  const env = cred ? { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(cred).toString('base64')}` } : {}
  const guard = ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', '-c', `protocol.file.allow=${local ? 'always' : 'never'}`, '-c', 'fetch.recurseSubmodules=false']
  const f = await tryGit(bare, [...guard, 'fetch', '-q', '--depth=1', remote, '+HEAD:refs/heads/kmd-src'], { timeout: 120_000, env })
  if (!f.ok) throw new KmdError('E_SOURCE', f.timedOut ? '원천이 답하지 않는다' : /auth|denied|403|401/i.test(f.err) ? '원천 자격이 맞지 않는다' : '원천에 닿지 않는다')
  const commit = (await tryGit(bare, ['rev-parse', 'refs/heads/kmd-src'])).out.trim()
  const asof = (await tryGit(bare, ['log', '-1', '--format=%ci', commit])).out.trim().slice(0, 16)
  return { bare, commit, asof }
}

// 한 번 돌기 — { state: 'same' | 'changed' | 'stopped' | 'failed', n, files }
//   full — 전체 다시 맞추기(pass 로 이어하기 · onProgress) · force — 브레이크를 넘어 그대로 반영
export async function runSource(k, src, opt) {
  if (src.kind === 'docs') return runDocs(k, src, opt)
  if (src.kind === 'db') return runDb(k, src, opt)
  return runTables(k, src, opt)
}

// DB — 카탈로그를 읽어 테이블마다 지문 · 바뀐 테이블만 「바뀐 것」 으로 센다 · 표는 테이블마다 하나(테이블 정의)
//   자리 — 이름 장부에 `table:*` 자리가 있으면 그 문서 · 머리 · 없으면 넣을 문서 아래 「테이블 — 설명」 머리
//   계정 — 읽기 전용이 아니면 거절(시험 DB 만 serve.json dbAllowUnsafeAccount) · 비밀번호는 비밀에서
async function runDb(k, src, { dataDir, save, first = false, force = false, full = false, dbAllowUnsafe = false }) {
  const st = await readState(dataDir, k.id)
  const s0 = (st[src.name] ||= {})
  const now = new Date().toISOString()
  try {
    const conn = parseDbUrl(src.at)
    conn.password = await getSecret(dataDir, secretName(k.id, src.name))
    const { acct, tables } = await readDb(conn, { allowUnsafe: dbAllowUnsafe })
    s0.account = { problems: acct.problems, at: now }
    const L = await readLedger(dataDir, k.id, src.name)
    const prev = L.files || {}
    const files = Object.fromEntries([...tables.values()].map((t) => [t.name, { hash: t.hash }]))
    const changes = { added: [], changed: [], removed: [] }
    for (const [n, x] of Object.entries(files)) if (!prev[n]) changes.added.push(n); else if (prev[n].hash !== x.hash) changes.changed.push(n)
    for (const n of Object.keys(prev)) if (!files[n]) changes.removed.push(n)
    const n = changes.added.length + changes.changed.length + changes.removed.length
    const ruleSig = JSON.stringify(src.rules)
    if (!force && !first && !full && n === 0 && !s0.stopped && L.rules === ruleSig) {
      Object.assign(s0, { checkedAt: now, failures: 0, failingSince: null, lastNote: '그대로' })
      await writeState(dataDir, k.id, st)
      return { state: 'same', n: 0, files: 0 }
    }
    const into = src.rules[0]?.into?.doc || '테이블 정의'
    const items = { dbtables: [...tables.values()].map((t) => {
      const loc = locate(k.registry, `table:${t.name}`)
      return { key: loc ? loc.heading : t.comment ? `${t.name} — ${t.comment}` : t.name, doc: loc ? loc.doc : into, cols: t.cols, rows: t.rows }
    }) }
    const plan = await planRun(k, src, items, { asof: now.slice(0, 16).replace('T', ' '), first, prev: s0.items || [] })
    if (plan.brake && !force) {
      s0.stopped = { at: now, added: plan.added, vanished: plan.vanished, of: (s0.items || []).length }
      s0.lastNote = '멈춤'
      await writeState(dataDir, k.id, st)
      return { state: 'stopped', n: 0, files: n, ...s0.stopped }
    }
    for (let i = 0; i < plan.changed.length; i += 200) {
      const part = plan.changed.slice(i, i + 200)
      await save({ record: { title: `가져옴 — ${src.name} · 바뀐 테이블 ${part.length}`, body: [`바뀐 테이블 ${n} — ${[...changes.added.map((x) => x + '(새로)'), ...changes.changed, ...changes.removed.map((x) => x + '(없어짐)')].slice(0, 30).join(' · ')}${n > 30 ? ' …' : ''}`, '', ...part.map((c) => `- ${c.doc.replace(/^docs\/|\.md$/g, '')} › ${c.heading}`)].join('\n'), tags: ['sources'] }, sections: part.map((c) => ({ doc: c.doc, heading: c.heading, content: c.content, applied: c.applied })) })
    }
    await writeLedger(dataDir, k.id, src.name, { v: 1, files, out: {}, rules: ruleSig })
    const lastChange = plan.changed.length ? { at: now, files: full ? 0 : n, tables: plan.changed.length, added: changes.added.length, changed: changes.changed.length, removed: changes.removed.length } : s0.lastChange
    Object.assign(s0, { checkedAt: now, asof: now.slice(0, 16).replace('T', ' '), items: plan.items, failures: 0, failingSince: null, stopped: null, lastChange, lastNote: `${full ? '다시 맞춤 — ' : ''}${plan.changed.length ? `바뀐 테이블 ${plan.changed.length}` : '그대로'} · 테이블 ${tables.size}${acct.problems.length ? ' · 읽기 전용 계정이 아니다(시험용)' : ''}` })
    await writeState(dataDir, k.id, st)
    return { state: plan.changed.length ? 'changed' : 'same', n: plan.changed.length, files: n, tables: tables.size }
  } catch (e) {
    s0.failures = (s0.failures || 0) + 1
    s0.failingSince ||= now
    s0.lastNote = e.message
    await writeState(dataDir, k.id, st)
    return { state: 'failed', n: 0, why: e.message }
  }
}

// 문서 폴더 — 바뀐 파일만 지식 안의 사본 문서로(원본이 주인) · 지운 파일은 「원본에 없다」 · 브레이크는 한꺼번에 많이 사라질 때만
// (문서는 묶음으로 더해지는 일이 흔하고 더함은 아무것도 지우지 않는다 — 사라짐 10% 초과만 멈춘다)
const DOC_MAX_FILE = 32 << 20
async function runDocs(k, src, { dataDir, first = false, force = false, full = false, pass = null, onProgress = null }) {
  const st = await readState(dataDir, k.id)
  const s0 = (st[src.name] ||= {})
  const now = new Date().toISOString()
  try {
    const L = await readLedger(dataDir, k.id, src.name)
    const scan = await scanFolder(src.folder || src.at, L, { want: wantDoc, maxFile: DOC_MAX_FILE, maxFiles: MAX_FILES, full, pass, onProgress, save: (x) => writeLedger(dataDir, k.id, src.name, x) })
    const n = changeCount(scan.changes)
    if (!force && !first && !full && n === 0 && !s0.stopped) {
      await writeLedger(dataDir, k.id, src.name, { ...L, files: scan.files })
      Object.assign(s0, { checkedAt: now, failures: 0, failingSince: null, lastNote: '그대로' })
      await writeState(dataDir, k.id, st)
      return { state: 'same', n: 0, files: 0 }
    }
    const before = Object.keys(L.files || {}).length
    const gone = scan.changes.removed.length
    if (!force && !first && before && gone / before > 0.1) {
      s0.stopped = { at: now, added: 0, vanished: gone, of: before }
      s0.lastNote = '멈춤'
      await writeState(dataDir, k.id, st)
      return { state: 'stopped', n: 0, files: n, ...s0.stopped }
    }
    const files = []
    for (const rel of [...scan.changes.added, ...scan.changes.changed]) files.push({ rel, data: await scan.readBuf(rel) })
    const r = await applyDocs(k, { src, prefix: docPrefix(src), files, removed: scan.changes.removed })
    await writeLedger(dataDir, k.id, src.name, { v: 1, files: scan.files, out: {}, rules: JSON.stringify(src.rules) })
    const real = full ? 0 : n
    const lastChange = r.commit ? { at: now, files: real, docs: r.docs, tables: 0, atts: r.atts, removed: r.missing, added: full ? 0 : scan.changes.added.length, changed: full ? 0 : scan.changes.changed.length } : s0.lastChange
    const note = r.commit ? `${full ? '다시 맞춤 — ' : ''}문서 ${r.docs}${r.atts ? ' · 첨부 ' + r.atts : ''}${r.missing ? ' · 원본에 없다 ' + r.missing : ''}` : full ? '다시 맞춤 — 그대로' : n ? `바뀐 파일 ${n} · 문서는 그대로` : '그대로'
    Object.assign(s0, { checkedAt: now, failures: 0, failingSince: null, stopped: null, lastChange, lastNote: note })
    await writeState(dataDir, k.id, st)
    return { state: r.commit ? 'changed' : 'same', n: r.docs + r.missing, files: n, docs: r.docs, missing: r.missing, rows: r.rows }
  } catch (e) {
    s0.failures = (s0.failures || 0) + 1
    s0.failingSince ||= now
    s0.lastNote = e.message
    await writeState(dataDir, k.id, st)
    return { state: 'failed', n: 0, why: e.message }
  }
}
// 문서가 들어갈 지식 안의 폴더 — 선언의 into.doc(비면 감시 이름)
export const docPrefix = (src) => String(src.rules?.[0]?.into?.doc ?? src.name).replace(/^docs\/|\/+$/g, '').replace(/[<>:"|?*\\]/g, '').trim()

// meaning — 뜻 갱신(소스 변경 → 기록)을 해도 되나(지식이 「Claude 에 보내지 않음」 이면 hub 가 false)
async function runTables(k, src, { dataDir, save, first = false, force = false, full = false, pass = null, onProgress = null, meaning = true }) {
  const st = await readState(dataDir, k.id)
  const s0 = (st[src.name] ||= {})
  const now = new Date().toISOString()
  try {
    const L = await readLedger(dataDir, k.id, src.name)
    // 뜻 갱신이 켜졌으면 규칙이 보지 않는 코드 파일도 지켜본다
    const ruleWant = wantOf(src)
    const want = src.meaning ? (p) => ruleWant(p) || wantCode(p) : ruleWant
    const ruleSig = JSON.stringify(src.rules) + (src.meaning ? '+meaning' : '')
    let scan
    let commit = null
    let asof
    if (src.kind === 'folder') {
      scan = await scanFolder(src.folder || src.at, L, { want, maxFile: MAX_FILE, maxFiles: MAX_FILES, full, pass, onProgress, save: (x) => writeLedger(dataDir, k.id, src.name, x) })
      asof = scan.newest ? localStamp(new Date(scan.newest)) : localStamp()
    } else if (src.kind === 'git') {
      const g = await gitFetch(src, { dataDir, kn: k.id })
      commit = g.commit
      asof = g.asof
      scan = await scanGit(g.bare, L, commit, { want, maxFile: MAX_FILE, maxFiles: MAX_FILES, full, onProgress })
      scan.bare = g.bare
    } else throw new KmdError('E_INPUT', '모르는 원천 종류')
    const n = changeCount(scan.changes)
    const all = first || full || L.rules !== ruleSig || !L.out
    if (!force && !all && n === 0 && !s0.stopped) {
      await writeLedger(dataDir, k.id, src.name, { ...L, files: scan.files, ...(commit ? { commit } : {}) })
      Object.assign(s0, { checkedAt: now, failures: 0, failingSince: null, lastNote: '그대로' })
      await writeState(dataDir, k.id, st)
      return { state: 'same', n: 0, files: 0 }
    }
    const out = await rulesOut(src, scan, L.out || {}, { all })
    const plan = await planRun(k, src, out.items, { asof, first, prev: s0.items || [] })
    if (plan.brake && !force) {
      // 장부는 그대로 둔다 — 다음 확인이 같은 바뀐 것을 다시 본다
      s0.stopped = { at: now, added: plan.added, vanished: plan.vanished, of: (s0.items || []).length }
      s0.lastNote = '멈춤'
      await writeState(dataDir, k.id, st)
      return { state: 'stopped', n: 0, files: n, ...s0.stopped }
    }
    for (let i = 0; i < plan.changed.length; i += 200) {
      const part = plan.changed.slice(i, i + 200)
      await save({ record: { title: `가져옴 — ${src.name} · 바뀐 표 ${part.length}`, body: [`바뀐 파일 ${n} — ${[...scan.changes.added, ...scan.changes.changed, ...scan.changes.removed].slice(0, 20).join(' · ')}${n > 20 ? ' …' : ''}`, '', ...part.map((c) => `- ${c.doc.replace(/^docs\/|\.md$/g, '')} › ${c.heading}`)].join('\n'), tags: ['sources'] }, sections: part.map((c) => ({ doc: c.doc, heading: c.heading, content: c.content, applied: c.applied })) })
    }
    // 뜻 갱신 — 바뀐 코드 파일마다 기록 하나(이름이 걸리면 그 항목 정리로) · 처음 · 전체 다시 맞추기는 사본만 맞춘다
    let codeRecords = 0
    if (src.meaning) {
      const code = (xs) => xs.filter(wantCode)
      const ch = { added: code(scan.changes.added), changed: code(scan.changes.changed), removed: code(scan.changes.removed) }
      const folder = src.kind === 'folder'
      if (folder && (first || full || !(await hasSnap(dataDir, k.id, src.name)))) await syncSnap(dataDir, k.id, src.name, Object.keys(scan.files).filter(wantCode), scan.readBuf)
      else if (meaning && !first && !full) {
        const todo = [...ch.changed.map((r) => [r, 'changed']), ...ch.added.map((r) => [r, 'added']), ...ch.removed.map((r) => [r, 'removed'])]
        for (const [rel, status] of todo.slice(0, CODE_MAX)) {
          const d = folder ? await diffFolder(dataDir, k.id, src.name, rel, status === 'removed' ? null : path.join(src.folder || src.at, ...rel.split('/'))) : await diffGit(scan.bare, L.commit, commit, rel)
          if (!d.plus && !d.minus) continue
          const rec = codeRecord(k, src, rel, d, status)
          if (rel === todo[Math.min(todo.length, CODE_MAX) - 1][0] && todo.length > CODE_MAX) rec.body += `\n\n그 밖에 바뀐 코드 ${todo.length - CODE_MAX} — ${todo.slice(CODE_MAX).map((x) => x[0]).slice(0, 40).join(' · ')}`
          await save({ record: rec })
          codeRecords++
        }
        if (folder) await syncSnap(dataDir, k.id, src.name, [...ch.added, ...ch.changed], scan.readBuf, ch.removed)
      } else if (folder) await syncSnap(dataDir, k.id, src.name, [...ch.added, ...ch.changed], scan.readBuf, ch.removed)
    }
    await writeLedger(dataDir, k.id, src.name, { v: 1, files: scan.files, out: out.cache, rules: ruleSig, ...(commit ? { commit } : {}) })
    if (commit) await tryGit(scan.bare, ['update-ref', 'refs/heads/kmd-seen', commit]) // 다음 차이의 기준 — 받아 오기에 지워지지 않게
    // 전체 다시 맞추기는 모든 파일을 다시 읽어 「고침」 으로 세므로 바뀐 파일 수로 알리지 않는다 — 실제로 다른 표만 말한다
    const real = full ? 0 : n
    const lastChange = real || plan.changed.length ? { at: now, files: real, tables: plan.changed.length, added: full ? 0 : scan.changes.added.length, changed: full ? 0 : scan.changes.changed.length, removed: scan.changes.removed.length } : s0.lastChange
    const note = (full ? (plan.changed.length ? `다시 맞춤 — 바뀐 표 ${plan.changed.length}` : '다시 맞춤 — 그대로') : plan.changed.length ? `바뀐 표 ${plan.changed.length}` : n ? `바뀐 파일 ${n} · 표는 그대로` : '그대로') + (codeRecords ? ` · 코드 바뀜 기록 ${codeRecords} — 정리가 항목 글을 맞춘다` : '')
    Object.assign(s0, { sig: commit || null, asof, checkedAt: now, items: plan.items, failures: 0, failingSince: null, stopped: null, lastChange, lastNote: note })
    if (codeRecords) s0.lastCode = { at: now, n: codeRecords }
    await writeState(dataDir, k.id, st)
    return { state: plan.changed.length || codeRecords ? 'changed' : 'same', n: plan.changed.length, files: n, codeRecords }
  } catch (e) {
    s0.failures = (s0.failures || 0) + 1
    s0.failingSince ||= now
    s0.lastNote = e.message
    await writeState(dataDir, k.id, st)
    return { state: 'failed', n: 0, why: e.message }
  }
}

// 낡음 · 멈춤 — 멈춤 한 줄(잘 될 때는 없음)
export function sourceLines(k, decl, st, { now = Date.now(), admin = false } = {}) {
  const out = []
  for (const src of decl) {
    const s = st[src.name] || {}
    if (s.stopped) {
      const what = s.stopped.vanished ? `${src.name} 에서 항목 ${s.stopped.vanished}개가 한꺼번에 사라졌다` : `${src.name} 에서 새 항목 ${s.stopped.added}개가 한꺼번에 생겼다`
      out.push(stopLine({ kind: 'source', kn: k.id, level: 'warn', what, fix: '표는 그대로 둠', told: admin ? '[그대로 반영] 은 자료 가져오기에서' : '관리자에게 알렸다' }))
      continue
    }
    if ((s.failures || 0) >= 2 && s.checkedAt && now - Date.parse(s.checkedAt) >= 2 * everyMs(src.every)) {
      out.push(stopLine({ kind: 'source', kn: k.id, level: 'warn', what: `${src.name} 표를 못 가져왔다`, amount: ageText(now - Date.parse(s.checkedAt)), fix: `표는 ${String(s.asof || '').slice(5, 10)} 것`, told: admin ? s.lastNote : '관리자에게 알렸다' }))
    }
  }
  return out
}

export { probe, writeDecl, stateFile, writeState }
