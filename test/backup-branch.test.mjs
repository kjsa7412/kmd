// 저장소 · 지식백업 나눔(메뉴개편 8-3 · 11절 5 · G1) — 원격 둘 · 가지 받기.
//
// 저장소(kmd-backup · <살림>/backup/)는 지식마다 주소 + 가지(처음 값 main · git 가지 이름 규칙) · 지식백업(kmd-copy · <살림>/copy/)은
// 이 PC 사본 자리 아래 <지식>.git · 저장소를 붙여도 꺼지지 않고 둘 다 보낸다 · 멈춤 줄 · 상태는 원격마다 .

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
import { copyDir } from './helpers.mjs'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture', 'kmd')
const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=남', '-c', 'user.email=nam@x', '-c', 'core.autocrlf=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const refOf = (bare, b) => { try { return G(bare, 'rev-parse', `refs/heads/${b}`) } catch { return null } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(f, ms = 240000) {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (await f()) return true
    await wait(80)
  }
  return false
}
const rec = (title) => ({ record: { title, body: title + ' 본문', touches: ['proc:카나리'] } })
let tmp

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-g1-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  backup.configure({ delays: [150], lsTimeout: 30000 })
})
after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('가지 이름: git 가지 규칙 · 길이 · 빈 값은 main', () => {
  for (const ok of ['main', 'dev', 'feature/x-1', 'release_2.0']) assert.equal(backup.checkBranch(ok), ok)
  assert.equal(backup.checkBranch(''), 'main')
  assert.equal(backup.checkBranch(null), 'main')
  for (const bad of ['../a', 'a..b', '-x', 'a.lock', 'a b', '@', 'x/', '.h', 'a/.b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b', 'a@{1}', 'a//b', 'HEAD', 'x'.repeat(101), 3, {}, ['main']]) {
    assert.throws(() => backup.checkBranch(bad), { code: 'E_INPUT' }, JSON.stringify(bad))
  }
})

test('팀: 저장소는 고른 가지로 민다 · 상태에 가지 · 나쁜 가지는 아무것도 붙이지 않는다', async () => {
  const dir = path.join(tmp, 'team')
  copyDir(FIX, path.join(dir, 'kn'))
  const bare = path.join(dir, 'repo.git')
  G(dir, 'init', '-q', '--bare', '-b', 'main', bare)
  fs.mkdirSync(path.join(dir, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'kn', '.kmd', 'serve.json'), JSON.stringify({ backupRoots: [dir], decideMs: 3600000 }))
  const s = await startServer({ root: path.join(dir, 'kn'), port: 0, log: () => {} })
  try {
    await assert.rejects(s.hub.backupAttach(SHELL, 'dpms', bare, { branch: '../x' }), { code: 'E_INPUT' })
    assert.equal(fs.existsSync(path.join(dir, 'kn', '.kmd', 'backup', 'dpms.json')), false, '나쁜 가지 — 상태 파일 없음')
    await assert.rejects(s.hub.backupAttach({ user: 'x' }, 'dpms', bare, { branch: 'dev' }), { code: 'E_FORBIDDEN' }, '총괄 관리자만')
    const r = await s.hub.backupAttach(SHELL, 'dpms', bare, { branch: 'dev' })
    assert.equal(r.ok, true)
    const head = G(path.join(dir, 'kn', 'dpms'), 'rev-parse', 'HEAD')
    assert.equal(refOf(bare, 'dev'), head, 'dev 가지로 보냈다')
    assert.equal(refOf(bare, 'main'), null, 'main 에는 보내지 않았다')
    assert.equal(r.backup.branch, 'dev')
    const again = await s.hub.backupAttach(SHELL, 'dpms', bare)
    assert.equal(again.backup.branch, 'dev', '가지를 정하지 않고 다시 붙이면 붙어 있던 가지 그대로(main 으로 갈라지지 않는다)')
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'kn', '.kmd', 'backup', 'dpms.json'), 'utf8')).branch, 'dev')
    await assert.rejects(s.hub.restore(SHELL, { url: bare, name: 'test-가지', branch: 'a..b' }), { code: 'E_INPUT' }, '불러오기 가지도 같은 규칙')
    assert.equal(fs.existsSync(path.join(dir, 'kn', 'test-가지')), false)
    assert.equal(s.hub.copyStateSync(await s.hub.meta('dpms')), null, '팀에는 지식백업이 없다')
  } finally {
    await s.close()
  }
})

test('개인: 지식백업 · 저장소는 따로 돈다 · 저장소를 붙여도 지식백업이 꺼지지 않는다', async () => {
  const dir = path.join(tmp, 'pc')
  const root = path.join(dir, 'kn')
  copyDir(FIX, root)
  const copies = path.join(dir, 'copies')
  const repo = path.join(dir, 'repo.git')
  fs.mkdirSync(copies, { recursive: true })
  G(dir, 'init', '-q', '--bare', '-b', 'main', repo)
  fs.mkdirSync(path.join(root, '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(root, '.kmd', 'serve.json'), JSON.stringify({ backupRoot: copies, backupRoots: [dir], decideMs: 3600000 }))
  const s = await startServer({ root, mode: 'pc', user: 'me', port: 0, log: () => {} })
  try {
    const me = { user: 'me' }
    const dmeta = await s.hub.meta('dpms', me)
    assert.ok(await until(() => !!s.hub.copyStateSync(dmeta)), '켤 때 지식백업이 저절로 붙는다')
    // 저장소를 붙인다 — 지식백업은 그대로
    const r = await s.hub.backupAttach(SHELL, 'dpms', repo)
    assert.equal(r.ok, true)
    assert.equal(r.backup.branch, 'main')
    assert.ok(s.hub.copyStateSync(dmeta), '저장소를 붙여도 지식백업이 꺼지지 않는다')
    const dpms = path.join(root, 'dpms')
    const remotes = G(dpms, 'remote').split('\n').sort()
    assert.deepEqual(remotes.filter((x) => x.startsWith('kmd-')), ['kmd-backup', 'kmd-copy'])
    await assert.rejects(s.hub.backupAttach(SHELL, 'dpms', path.join(copies, 'dpms.git')), { code: 'E_INPUT' }, '지식백업 사본 자리는 저장소로 붙이지 않는다')
    await assert.rejects(s.hub.backupAttach(SHELL, 'dpms', path.join(copies, 'gdi.git')), { code: 'E_INPUT' }, '사본 자리 아래 어느 것도')
    // 저장하면 둘 다 보낸다
    await s.hub.save(me, 'dpms', rec('둘 다 보낸다'))
    const head = G(dpms, 'rev-parse', 'HEAD')
    // 저장 뒤 바로 넣기가 커밋을 더할 수 있다 — 원격 머리가 그 저장을 품으면 된다
    const has = (bare) => { const r = refOf(bare, 'main'); if (!r) return false; try { G(dpms, 'merge-base', '--is-ancestor', head, r); return true } catch { return false } }
    assert.ok(await until(() => has(repo)), '저장소')
    assert.ok(await until(() => has(path.join(copies, 'dpms.git'))), '지식백업')
    // 상태 — 원격마다
    assert.equal(s.hub.backupStateSync(dmeta).branch, 'main')
    assert.notEqual(s.hub.copyStateSync(dmeta).url, s.hub.backupStateSync(dmeta).url, '지식백업 상태가 따로')
    // 멈춤 줄 — 지식백업 사본을 지우면 지식백업 줄만(갈래 backup · 저장소 줄은 갈래 repo)
    await backup.copy.enqueue(dmeta) // 도는 보내기가 끝난 뒤에 지운다(겹치면 도는 보내기가 다시 올려 「지워짐」 을 못 본다)
    G(path.join(copies, 'dpms.git'), 'update-ref', '-d', 'refs/heads/main')
    await backup.copy.enqueue(dmeta)
    const stops = await s.hub.stops(me, 'dpms')
    assert.ok(stops.some((x) => x.kind === 'backup' && /지식백업이 지워졌다/.test(x.text)), JSON.stringify(stops))
    assert.ok(!stops.some((x) => x.kind === 'repo'), '저장소는 잘 돈다')
    // 지식백업은 저장을 닫지 않는다(사본일 뿐)
    G(path.join(copies, 'dpms.git'), 'update-ref', 'refs/heads/main', G(dpms, 'rev-parse', 'HEAD'))
  } finally {
    await s.close()
  }
})
