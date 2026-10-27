// 감시 단계 1 필수 — 바뀐 것만 본다.
//
// 폴더: 한 파일 고침 → 그 파일만 읽고 그 표만 · 그대로면 0 읽음 · 시각만 바뀜 → 1 읽고 묶음 0 · 지움 → 「원천에 없다」
// git: 커밋 차이로 바뀐 파일만 · 실시간 감시: 고치면 조용해진 뒤 저절로 · 전체 다시 맞추기: 진행률 · 이어하기 · 다른 것만 씀

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { stats, scanFolder, readLedger } from '../core/watch.js'
import { copyDir } from './helpers.mjs'
import { writeDecl, readDecl } from '../core/sources.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, src, repo, kdir
const ADMIN = { user: 'kim', admin: true }
const G = (dir, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim()
const commits = () => Number(G(kdir, 'rev-list', '--count', 'HEAD'))
// 표 규칙 · 코드 폴더는 새로 더하지 않는다(소스 코드는 git 커밋) — 감시 엔진은 예전 선언을 직접 적어 본다
const legacyAdd = async (x) => {
  const src0 = { ...x, by: 'kim', since: '2026-10-23' }
  await writeDecl(kdir, [...(await readDecl(kdir)), src0], { user: 'kim', title: `가져오는 곳 더함: ${x.name}` })
  s.hub.forget('dpms')
  s.hub.watchSource('dpms', src0)
  return { source: src0, run: await s.hub.sourceRun('dpms', x.name, { first: true }) }
}
const csv = (dir, i, v = '') => fs.writeFileSync(path.join(dir, 'data', `코드${String(i).padStart(2, '0')}.csv`), `코드,이름\nC${i},가${i}${v}\n`)
async function until(f, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await f()) return true; await new Promise((r) => setTimeout(r, 200)) }
  return false
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-watch-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  kdir = path.join(tmp, 'kn', 'dpms')
  src = path.join(tmp, 'src', 'api')
  fs.mkdirSync(path.join(src, 'data'), { recursive: true })
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ dependencies: { express: '4.19.2', pg: '8.11.0' } }))
  for (let i = 1; i <= 20; i++) csv(src, i)
  fs.writeFileSync(path.join(src, 'app.js'), '// 관계없는 코드 — 규칙이 보지 않는다\n')
  repo = path.join(tmp, 'src', 'repo')
  fs.mkdirSync(path.join(repo, 'data'), { recursive: true })
  for (let i = 1; i <= 20; i++) csv(repo, i)
  G(repo, 'init', '-q', '-b', 'main')
  G(repo, 'add', '-A')
  G(repo, 'commit', '-q', '-m', 'c1')
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ sourceRoots: [path.join(tmp, 'src')], decideMs: 3600000, sourceTickMs: 3600000, watchQuietMs: 400 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('폴더: 바뀐 파일만 읽고 그 표만 · 그대로면 0 · 시각만 바뀌면 1 읽고 묶음 0 · 지우면 「원천에 없다」', async () => {
  const r0 = await legacyAdd({ name: 'api 코드', kind: 'folder', at: src, every: 'manual', rules: [{ rule: 'deps', into: { doc: '라이브러리' } }, { rule: 'tables', paths: ['data'], into: { doc: '코드표' } }] })
  assert.equal(r0.run[0].state, 'changed')
  assert.equal(r0.run[0].n, 21, '라이브러리 표 1 + 코드표 20')
  const L = await readLedger(path.join(tmp, 'kn', '.kmd'), 'dpms', 'api 코드')
  assert.ok(!('app.js' in L.files), '규칙이 보지 않는 파일은 장부에도 없다')

  let n0 = stats.reads
  assert.equal((await s.hub.sourceRun('dpms', 'api 코드'))[0].state, 'same')
  assert.equal(stats.reads - n0, 0, '그대로면 하나도 읽지 않는다')

  csv(src, 7, ' 고침')
  n0 = stats.reads
  let c0 = commits()
  const r1 = (await s.hub.sourceRun('dpms', 'api 코드'))[0]
  assert.deepEqual([r1.state, r1.n, r1.files], ['changed', 1, 1])
  assert.equal(stats.reads - n0, 2, '바뀐 파일 하나: 지문 한 번 · 규칙 한 번')
  assert.equal(commits() - c0, 1)
  assert.match(fs.readFileSync(path.join(kdir, 'docs', '코드표.md'), 'utf8'), /가7 고침/)

  // 시각만 바뀐 파일 — 내용 지문으로 거른다(쓰지 않는다)
  const f3 = path.join(src, 'data', '코드03.csv')
  fs.utimesSync(f3, new Date(), new Date(Date.now() + 5000))
  n0 = stats.reads
  c0 = commits()
  assert.equal((await s.hub.sourceRun('dpms', 'api 코드'))[0].state, 'same')
  assert.equal(stats.reads - n0, 1)
  assert.equal(commits(), c0, '묶음 0')

  // 지움 — 표를 지우지 않고 「원천에 없다」(20 중 1 = 5% · 브레이크 아래)
  fs.rmSync(path.join(src, 'data', '코드20.csv'))
  const r2 = (await s.hub.sourceRun('dpms', 'api 코드'))[0]
  assert.ok(['changed', 'same'].includes(r2.state), r2.state) // 실시간 감시가 먼저 거뒀으면 same — 결과(원천에 없다 표지 · removed 1)는 아래에서 본다
  assert.match(fs.readFileSync(path.join(kdir, 'docs', '코드표.md'), 'utf8'), /missing="\d{4}-\d{2}-\d{2}"/)
  const st = (await s.hub.sources(ADMIN, 'dpms')).find((x) => x.name === 'api 코드')
  assert.equal(st.state.lastChange.removed, 1)
})

test('git: 두 커밋의 차이로 바뀐 파일만 읽는다', async () => {
  const r0 = await legacyAdd({ name: 'repo 코드', kind: 'git', at: repo, every: 'manual', rules: [{ rule: 'tables', paths: ['data'], into: { doc: '저장소 코드표' } }] })
  assert.equal(r0.run[0].n, 20)
  csv(repo, 11, ' 바뀜')
  G(repo, 'commit', '-q', '-am', 'c2')
  const n0 = stats.reads
  const r1 = (await s.hub.sourceRun('dpms', 'repo 코드'))[0]
  assert.deepEqual([r1.state, r1.n, r1.files], ['changed', 1, 1])
  assert.equal(stats.reads - n0, 1, '바뀐 파일 하나만 읽는다(커밋 차이: 지문 계산 없음)')
  assert.equal((await s.hub.sourceRun('dpms', 'repo 코드'))[0].state, 'same')
})

test('실시간 감시: 코드 폴더를 고치면 조용해진 뒤 저절로 그곳만 확인한다', async () => {
  const st0 = (await s.hub.sources(ADMIN, 'dpms')).find((x) => x.name === 'api 코드')
  assert.equal(st0.watch, 'live')
  const before = st0.state.lastChange?.at
  csv(src, 2, ' 실시간')
  assert.ok(await until(async () => {
    const st = (await s.hub.sources(ADMIN, 'dpms')).find((x) => x.name === 'api 코드')
    return st.state.lastChange?.at && st.state.lastChange.at !== before
  }), '저절로 반영')
  assert.match(fs.readFileSync(path.join(kdir, 'docs', '코드표.md'), 'utf8'), /가2 실시간/)
})

test('전체 다시 맞추기: 진행률 · 다른 것만 씀 · 끊기면 같은 pass 로 이어서(이미 한 파일은 건너뜀)', async () => {
  const c0 = commits()
  const job = await s.hub.sourceResync(ADMIN, 'dpms', 'api 코드')
  assert.equal(job.state, 'running')
  assert.ok(await until(() => job.state !== 'running'))
  assert.equal(job.state, 'done')
  assert.equal(job.total, 20, '규칙이 보는 파일 모두(package.json + csv 19)')
  assert.equal(job.done, job.total)
  assert.equal(commits(), c0, '다른 것이 없으면 묶음 0')
  assert.equal((await s.hub.sources(ADMIN, 'dpms')).find((x) => x.name === 'api 코드').resync.state, 'done')

  // 이어하기 — 절반을 이번 pass 로 이미 읽은 장부라면 나머지만 읽는다
  const dir = path.join(tmp, 'half')
  fs.mkdirSync(dir)
  for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(dir, `${i}.csv`), `a\n${i}\n`)
  const want = (p) => p.endsWith('.csv')
  const first = await scanFolder(dir, { files: {} }, { want })
  const pass = 777
  const files = Object.fromEntries(Object.entries(first.files).map(([p, x], i) => [p, i < 5 ? { ...x, pass } : x]))
  const n0 = stats.reads
  const again = await scanFolder(dir, { files }, { want, full: true, pass })
  assert.equal(stats.reads - n0, 5, '이번 pass 로 아직 안 읽은 다섯만')
  assert.equal(Object.values(again.files).filter((x) => x.pass === pass).length, 10)
})
