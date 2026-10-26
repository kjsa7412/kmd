// 감시 엔진 — 바뀐 것만 안다(감시 검토 v0.1 단계 1).
//
//   지문 장부  `<data>/watch/<지식>/<감시 지문>.json`
//              { v, files: { 경로: { size, mtime, hash, blob?, pass } }, commit?, out: { 규칙: 규칙마다의 캐시 }, resync? }
//   바뀐 것    폴더 — 크기 · 시각이 같으면 읽지 않는다 · 다르면 내용 해시까지 보고 정말 다른 것만 「고침」
//              git  — 지난번 본 커밋과 새 커밋의 차이(`diff --name-status`) · 처음이면 모두 「더함」
//   전체 다시 맞추기  pass 번호를 새로 받아 모든 파일을 다시 읽는다(해시 · 규칙 결과) — 200 파일마다 장부를 적어
//              끊겨도 같은 pass 로 다시 부르면 이미 한 파일은 건너뛴다(이어하기) · 진행은 onProgress(done, total)
// 엔진은 지식에 쓰지 않는다 — 바뀐 것 목록과 읽는 길만 돌려준다(쓰기는 sources.js 의 planRun · 브레이크).

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { tryGit } from './git.js'
import { readText, nfc } from './text.js'

export const stats = { reads: 0 } // 내용을 읽은 파일 수 — 시험이 「바뀐 것만 읽었다」 를 센다
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex')

const fileOf = (dataDir, kn, name) => path.join(dataDir, 'watch', encodeURIComponent(kn), `${sha1(String(name)).slice(0, 16)}.json`)
export async function readLedger(dataDir, kn, name) {
  const j = await fs.readFile(fileOf(dataDir, kn, name), 'utf8').then(JSON.parse, () => null)
  return j && j.v === 1 ? j : { v: 1, files: {}, out: {} }
}
export async function writeLedger(dataDir, kn, name, L) {
  const f = fileOf(dataDir, kn, name)
  await fs.mkdir(path.dirname(f), { recursive: true })
  await fs.writeFile(f + '.tmp', JSON.stringify(L))
  await fs.rename(f + '.tmp', f)
}
export const dropLedger = (dataDir, kn, name) => fs.rm(fileOf(dataDir, kn, name), { force: true })
// 파일 하나를 장부에서 걷는다 — 다음 확인이 그 파일을 「더함」 으로 다시 본다(뒤에서 하던 일이 도중에 깨졌을 때)
export async function forgetFile(dataDir, kn, name, rel) {
  const L = await readLedger(dataDir, kn, name)
  if (!L.files?.[rel]) return
  delete L.files[rel]
  await writeLedger(dataDir, kn, name, L)
}

const sortChanges = (c) => ({ added: c.added.sort(), changed: c.changed.sort(), removed: c.removed.sort() })
export const changeCount = (c) => c.added.length + c.changed.length + c.removed.length

// 폴더 — want(경로) 가 참인 파일만 · 숨김 · node_modules · 링크는 보지 않는다
export async function scanFolder(root, L, { want, maxFile = 1 << 20, maxFiles = 3000, full = false, pass = null, onProgress = null, save = null } = {}) {
  const seen = []
  const walk = async (dir, rel) => {
    if (seen.length >= maxFiles) return
    const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.isSymbolicLink()) continue
      if (e.isDirectory()) await walk(path.join(dir, e.name), r)
      else if (want(nfc(r))) seen.push({ path: nfc(r), full: path.join(dir, e.name) })
      if (seen.length >= maxFiles) return
    }
  }
  await walk(root, '')
  const prev = L.files || {}
  const files = {}
  const changes = { added: [], changed: [], removed: [] }
  let done = 0
  let newest = 0
  for (const f of seen) {
    const st = await fs.stat(f.full).catch(() => null)
    done++
    if (!st || st.size > maxFile) continue
    newest = Math.max(newest, st.mtimeMs)
    const p = prev[f.path]
    // 전체 다시 맞추기 — 이번 pass 에서 이미 읽은 파일은 건너뛴다(이어하기)
    const skip = full ? p && p.pass === pass && p.size === st.size && p.mtime === st.mtimeMs : p && p.size === st.size && p.mtime === st.mtimeMs
    if (skip) {
      files[f.path] = p
    } else {
      const buf = await fs.readFile(f.full).catch(() => null)
      if (!buf) continue
      stats.reads++
      const hash = sha1(buf)
      files[f.path] = { size: st.size, mtime: st.mtimeMs, hash, ...(full ? { pass } : {}) }
      if (!p) changes.added.push(f.path)
      else if (p.hash !== hash || full) changes.changed.push(f.path)
    }
    if (onProgress && done % 25 === 0) onProgress(done, seen.length)
    if (save && full && done % 200 === 0) await save({ ...L, files: { ...prev, ...files } })
  }
  for (const k of Object.keys(prev)) if (!files[k]) changes.removed.push(k)
  if (onProgress) onProgress(seen.length, seen.length)
  const byPath = new Map(seen.map((f) => [f.path, f.full]))
  return {
    files,
    changes: sortChanges(changes),
    newest,
    read: async (p) => {
      stats.reads++
      return readText(await fs.readFile(byPath.get(p), 'utf8'))
    },
    readBuf: async (p) => {
      stats.reads++
      return fs.readFile(byPath.get(p))
    },
  }
}

// git — bare 사본의 두 커밋 사이 · 지난 커밋은 ref `kmd-seen` 으로 붙들어 둔다(받아 오기를 해도 지워지지 않게)
export async function scanGit(bare, L, newCommit, { want, maxFile = 1 << 20, maxFiles = 3000, full = false, onProgress = null } = {}) {
  const tree = (await tryGit(bare, ['ls-tree', '-r', '-l', '-z', newCommit])).out.split('\0').filter(Boolean)
  const now = {}
  for (const l of tree) {
    const m = l.match(/^\d+ blob ([0-9a-f]+)\s+(\d+)\t([\s\S]+)$/)
    if (!m || Number(m[2]) > maxFile) continue
    const p = nfc(m[3])
    if (p.split('/').some((x) => x.startsWith('.') || x === 'node_modules') || !want(p)) continue
    now[p] = { size: Number(m[2]), blob: m[1], hash: m[1] }
    if (Object.keys(now).length >= maxFiles) break
  }
  const prev = L.files || {}
  const changes = { added: [], changed: [], removed: [] }
  const haveOld = !full && L.commit && (await tryGit(bare, ['cat-file', '-e', `${L.commit}^{commit}`])).ok
  if (haveOld && L.commit !== newCommit) {
    // 두 커밋의 차이 — 바뀐 파일 목록만(내용은 읽지 않는다)
    const d = (await tryGit(bare, ['diff', '--name-status', '--no-renames', '-z', L.commit, newCommit])).out.split('\0').filter(Boolean)
    for (let i = 0; i + 1 < d.length; i += 2) {
      const st = d[i]
      const p = nfc(d[i + 1])
      if (!want(p) && !prev[p]) continue
      if (st === 'D' || !now[p]) { if (prev[p]) changes.removed.push(p) }
      else if (st === 'A' || !prev[p]) changes.added.push(p)
      else changes.changed.push(p)
    }
  } else if (!haveOld || full) {
    // 처음 · 전체 다시 맞추기 · 옛 커밋이 없을 때 — 장부와 견준다(블롭 해시가 곧 내용 지문)
    for (const [p, x] of Object.entries(now)) {
      if (!prev[p]) changes.added.push(p)
      else if (prev[p].hash !== x.hash || full) changes.changed.push(p)
    }
    for (const p of Object.keys(prev)) if (!now[p]) changes.removed.push(p)
  }
  if (onProgress) onProgress(Object.keys(now).length, Object.keys(now).length)
  return {
    files: now,
    changes: sortChanges(changes),
    read: async (p) => {
      stats.reads++
      return readText((await tryGit(bare, ['cat-file', '-p', now[p].blob])).out)
    },
  }
}
