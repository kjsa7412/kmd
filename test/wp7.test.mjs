// WP7 필수 — 백업 · 되살리기(제품화 검토 v0.1 G3-3 · F-022 · F-020 · F-021 · G3-8 · F-017 · G3-9).
//
// 연습 · 다른 이름으로 되살리면 원래 백업에 붙이지 않는다(같은 자리를 다른 지식이 쓰면 --attach 도 거절) ·
// .git 없는 지식 폴더가 다른 저장소 안에 있어도 바깥 저장소를 밀지 않는다 · 이 PC 는 백업 자리를 정하면 모든 지식 · 새 지식이 저절로 붙는다 ·
// 갈라지면 이어 쓰기가 빼는 기록을 먼저 보이고 쓴 사람에게 알린다 · 서버 것으로 백업을 덮을 수 있다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import * as backup from '../core/backup.js'
import * as feed from '../core/feed.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KIM = { user: 'kim', admin: true }
const G = (cwd, ...a) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', windowsHide: true }).trim()
const until = async (f, ms = 15_000) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 100)) } return true }
const code = (p) => p.then(() => 'ok', (e) => e.code)
let tmp, root, data, bk, s

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-wp7-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  root = path.join(tmp, 'kn')
  data = path.join(root, '.kmd')
  bk = path.join(tmp, 'bk')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  fs.mkdirSync(data, { recursive: true })
  fs.mkdirSync(bk, { recursive: true })
  fs.writeFileSync(path.join(data, 'serve.json'), JSON.stringify({ decideMs: 3600000, tidyTickMs: 3600000, backupRoots: [bk], privateBackup: path.join(bk, '개인') }))
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('되살리기: 다른 이름 · 연습은 붙이지 않는다 · 같은 자리를 다른 지식이 쓰면 --attach 도 거절', async () => {
  const bare = path.join(bk, 'dpms.git')
  G(tmp, 'init', '-q', '--bare', '-b', 'main', bare)
  await s.hub.backupAttach(SHELL, 'dpms', bare)
  assert.ok(await until(() => G(bare, 'rev-parse', 'main') === G(path.join(root, 'dpms'), 'rev-parse', 'HEAD')))
  const r = await s.hub.restore(SHELL, { url: bare, name: 'dpms-연습' })
  assert.equal(r.attached, false, '다른 이름: 읽기만 사본')
  assert.equal(await code(s.hub.restore(SHELL, { url: bare, name: 'dpms-또', attach: true })), 'E_CONFLICT')
  // 연습 사본에서 저장해도 운영 백업은 그대로
  const head = G(bare, 'rev-parse', 'main')
  await s.hub.save(KIM, 'dpms-연습', { record: { title: '연습: 저장', body: '연습' } })
  await new Promise((ok) => setTimeout(ok, 1500))
  assert.equal(G(bare, 'rev-parse', 'main'), head)
  assert.equal(backup.stateOf(await s.hub.meta('dpms-연습')), null)
})

test('.git 없는 지식 폴더가 다른 저장소 안에 있어도: 붙이기는 그 폴더에 저장소를 세운다(바깥 저장소를 밀지 않는다)', async () => {
  const outer = path.join(tmp, 'outer')
  fs.mkdirSync(outer)
  G(outer, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(outer, 'a.txt'), 'outer')
  G(outer, 'add', '-A')
  G(outer, 'commit', '-qm', 'outer')
  const kn = { id: 'inner', dir: path.join(outer, 'inner') }
  fs.mkdirSync(path.join(kn.dir, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(kn.dir, 'docs', 'x.md'), '# x\n')
  const bare = path.join(bk, 'inner.git')
  G(tmp, 'init', '-q', '--bare', '-b', 'main', bare)
  await backup.register(kn, { dataDir: data })
  await backup.attach(kn, bare, { dataDir: data })
  assert.ok(fs.existsSync(path.join(kn.dir, '.git')), '그 폴더에 저장소')
  assert.doesNotMatch(G(outer, 'remote'), /kmd-backup/, '바깥 저장소의 설정은 그대로')
})

test('갈라졌을 때: 이어 쓰기가 뺄 기록을 먼저 보이고 쓴 사람에게 알린다 · 서버 것으로 백업을 덮는다', async () => {
  const kdir = path.join(root, 'gdi')
  const bare = path.join(bk, 'gdi.git')
  G(tmp, 'init', '-q', '--bare', '-b', 'main', bare)
  await s.hub.backupAttach(SHELL, 'gdi', bare)
  assert.ok(await until(() => G(bare, 'rev-parse', 'main') === G(kdir, 'rev-parse', 'HEAD')))
  // 남이 백업에 밀고 · 여기서도 저장 → 갈라짐
  const other = path.join(tmp, 'other-gdi')
  G(tmp, 'clone', '-q', bare, other)
  fs.appendFileSync(path.join(other, 'README.md'), '\n남의 줄\n')
  G(other, 'commit', '-qam', '남의 저장')
  G(other, 'push', '-q', 'origin', 'HEAD:main')
  await s.hub.save({ user: 'lee' }, 'gdi', { record: { title: '갈라지기 전 lee 의 기록', body: '이 글은 서버에만 있다' } })
  await backup.enqueue(await s.hub.meta('gdi'))
  const lost = await s.hub.backupLost(KIM, 'gdi')
  assert.ok(lost.records.some((r) => r.title === '갈라지기 전 lee 의 기록' && r.author === 'lee'), JSON.stringify(lost))
  // 서버 것으로 덮기
  const k = await s.hub.backupKeep(KIM, 'gdi')
  assert.equal(k.ok, true)
  assert.equal(G(bare, 'rev-parse', 'main'), G(kdir, 'rev-parse', 'HEAD'))
  // 다시 갈라지게 한 뒤 이어 쓰기 — lee 에게 알린다
  G(other, 'fetch', '-q', 'origin')
  G(other, 'reset', '-q', '--hard', 'origin/main')
  fs.appendFileSync(path.join(other, 'README.md'), '\n또 남의 줄\n')
  G(other, 'commit', '-qam', '또 남의 저장')
  G(other, 'push', '-q', 'origin', 'HEAD:main')
  await s.hub.save({ user: 'lee' }, 'gdi', { record: { title: '두 번째 lee 의 기록', body: '또 서버에만' } })
  await backup.enqueue(await s.hub.meta('gdi'))
  const a = await s.hub.backupAdopt(KIM, 'gdi')
  assert.ok(a.kept && a.lost >= 1)
  assert.ok((await feed.list(data, 'lee')).some((x) => /백업의 글로 되돌렸다. 내 기록 \d+ 이 지식에서 빠졌다/.test(x.b || '')))
})

test('이 PC: 백업 자리를 정하면 붙지 않은 지식을 모두 붙이고 · 새 지식도 저절로 · 지식 폴더 안은 받지 않는다', async () => {
  const pcRoot = path.join(tmp, 'pc')
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), path.join(pcRoot, '설계메모'))
  const pc = await startServer({ root: pcRoot, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const ctx = { user: 'kim', admin: true, pc: true }
    assert.equal(await code(pc.hub.setBackupRoot(ctx, path.join(pcRoot, '설계메모', 'bk'))), 'E_INPUT')
    const r = await pc.hub.setBackupRoot(ctx, path.join(tmp, 'pcbk'))
    assert.equal(r.attached, 1)
    await pc.hub.addKnowledge(ctx, { kind: 'new', name: '새메모' })
    assert.ok(await pc.hub.backupState(ctx, '새메모'), '새 지식도 저절로')
    assert.ok(JSON.parse(fs.readFileSync(path.join(pcRoot, '.kmd', 'serve.json'), 'utf8')).backupRoot)
    // 팀 화면(짝 열쇠)이 시키면 이 PC 의 확인 창을 거친다(HTTP 층 · pc-confirm.test)
  } finally {
    await pc.close()
  }
})
