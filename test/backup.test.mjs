// E0 필수 — 백업이 조용히 멈추지 않는다.
//
// 백업 자리는 임시 폴더의 bare 저장소. gone 두 장면(지움 · 되감음은 같은 길) → 다시 올리고 빨강 ·
// 끊김 뒤 다시 보내기 → 원격 = HEAD · 나이 경보 · 남이 앞서 민 백업 → 읽기만(E_BEHIND) → 백업에서 받기 ·
// 갈라짐 → moved · 상태 파일 없는 clone → 보내지 않는다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import * as backup from '../core/backup.js'
import { copyDir } from './helpers.mjs'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture', 'kmd')
let tmp, s, kn, bare
const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=남', '-c', 'user.email=nam@x', '-c', 'core.autocrlf=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const rec = (title) => ({ record: { title, body: title + ' — 본문', touches: ['proc:카나리'] } })
const ctx = { user: '김' }
const ADMIN = { user: '이', admin: true }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(f, ms = 20000) {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (await f()) return true
    await wait(60)
  }
  return false
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-e0-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  copyDir(FIX, path.join(tmp, 'kn'))
  bare = path.join(tmp, 'remote.git')
  G(tmp, 'init', '-q', '--bare', '-b', 'main', bare)
  // 이 PC 의 폴더를 백업 자리로 쓰려면 허락된 루트 안이어야 한다(E1)
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ backupRoots: [tmp] }))
  backup.configure({ delays: [150], lsTimeout: 5000 })
  s = await startServer({ root: path.join(tmp, 'kn'), user: '김', port: 0, log: () => {} })
  kn = { id: 'dpms', dir: path.join(tmp, 'kn', 'dpms') }
  await s.hub.save(ctx, 'dpms', rec('첫 저장'))
})
after(async () => {
  await s?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const remoteHead = () => {
  try {
    return G(bare, 'rev-parse', 'refs/heads/main')
  } catch {
    return null
  }
}
const head = () => G(kn.dir, 'rev-parse', 'HEAD')

test('붙이면 지금까지 보낸다 · 상태 파일이 남는다 · 잘 될 때 줄 0', async () => {
  const r = await s.hub.backupAttach(ADMIN, 'dpms', bare)
  assert.equal(r.ok, true)
  assert.equal(remoteHead(), head())
  assert.ok(fs.existsSync(path.join(tmp, 'kn', '.kmd', 'backup', 'dpms.json')))
  assert.deepEqual(await s.hub.stops(ADMIN), [])
  const r2 = await s.hub.save(ctx, 'dpms', rec('둘째 저장'))
  assert.deepEqual(r2.warnings, [])
  assert.ok(await until(() => remoteHead() === head(), 30000), '저장하면 저절로 보낸다')
})

test('지워진 백업 → 다시 올리고 하루 빨강 · 판정은 순수 함수', async () => {
  G(bare, 'update-ref', '-d', 'refs/heads/main')
  const r = await backup.enqueue(kn)
  assert.equal(r.ok, true)
  assert.equal(remoteHead(), head(), '다시 올렸다')
  const st = await s.hub.stops(ADMIN)
  assert.equal(st.length, 1)
  assert.equal(st[0].level, 'bad')
  assert.match(st[0].text, /지워졌다/)
  assert.equal(backup.judge({ head: 'b', remote: 'a', pushed: 'c', remoteInHead: true, remoteInPushed: true }), 'rewound')
  assert.equal(backup.judge({ head: 'b', remote: null, pushed: 'a' }), 'gone')
  assert.equal(backup.judge({ head: 'b', remote: null }), 'lag', '빈 자리는 첫 보내기')
  assert.equal(backup.judge({ head: 'b', remote: 'c', headInRemote: true }), 'behind')
  assert.equal(backup.judge({ head: 'b', remote: 'c' }), 'moved')
  const h = await (await fetch(s.url + '/healthz')).json()
  assert.match(h.stops[0].text, /지워졌다/, 'healthz 도 같은 줄')
})

test('끊긴 동안 저장은 그대로 · 나이 경보 · 닿으면 저절로 다시 보낸다', async () => {
  const off = bare + '.off'
  fs.renameSync(bare, off)
  const r = await s.hub.save(ctx, 'dpms', rec('끊긴 동안'))
  assert.ok(r.id, '저장은 막히지 않는다')
  assert.notEqual(backup.stateOf(kn).last.ok, true)
  const later = backup.lines(kn, { now: Date.now() + 7 * 3600000 }).find((l) => /멈췄다/.test(l.text))
  assert.equal(later?.level, 'warn', '6시간이면 노랑')
  assert.equal(backup.lines(kn, { now: Date.now() + 25 * 3600000 }).find((l) => /멈췄다/.test(l.text))?.level, 'bad', '24시간이면 빨강')
  fs.renameSync(off, bare)
  assert.ok(await until(() => remoteHead() === head()), '다시 보내기가 저절로 보냈다')
})

test('남이 앞서 민 백업 → 읽기만(E_BEHIND) → 백업에서 받기 → 다시 저장', async () => {
  const other = path.join(tmp, 'other')
  G(tmp, 'clone', '-q', bare, other)
  fs.appendFileSync(path.join(other, 'docs', '운영.md'), '\n남이 더한 줄\n')
  G(other, 'commit', '-qam', '남의 저장')
  G(other, 'push', '-q', 'origin', 'HEAD:main')
  await backup.enqueue(kn)
  assert.equal(backup.stateOf(kn).verdict, 'behind')
  const res = await fetch(s.url + '/api/k/dpms/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec('막힐 저장')) })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, 'E_BEHIND')
  const p = await s.hub.backupPull(ADMIN, 'dpms')
  assert.equal(p.pulled, 1)
  assert.match(fs.readFileSync(path.join(kn.dir, 'docs', '운영.md'), 'utf8'), /남이 더한 줄/)
  const r = await s.hub.save(ctx, 'dpms', rec('받은 뒤 저장'))
  assert.ok(!r.warnings.some((w) => /읽기만|멈췄다/.test(w)), r.warnings.join())
  assert.ok(await until(() => remoteHead() === head(), 30000))

  // 갈라짐 — 남이 또 밀었는데 여기서도 저장했다 → moved · 읽기만
  G(other, 'pull', '-q', 'origin', 'main')
  fs.appendFileSync(path.join(other, 'docs', '운영.md'), '\n또 남의 줄\n')
  G(other, 'commit', '-qam', '남의 둘째 저장')
  G(other, 'push', '-q', 'origin', 'HEAD:main')
  await s.hub.save(ctx, 'dpms', rec('갈라지는 저장'))
  await backup.enqueue(kn) // 저장은 백업을 3초까지만 기다린다 — 바쁜 PC 에서도 판정이 끝나게
  assert.match((await s.hub.stops(ADMIN)).map((l) => l.text).join(' '), /다른 서버/)
  assert.equal(backup.stateOf(kn).verdict, 'moved')
  await assert.rejects(s.hub.save(ctx, 'dpms', rec('또')), (e) => e.code === 'E_BEHIND')
})

test('상태 파일 없는 clone — origin 은 백업이 아니다 · 보내지 않는다', async () => {
  const before = remoteHead()
  G(path.join(tmp, 'kn'), 'clone', '-q', bare, 'cl')
  s.hub.forget()
  await s.hub.save(ctx, 'cl', rec('받아 온 지식에 저장'))
  assert.equal(remoteHead(), before)
  assert.equal(backup.stateOf({ id: 'cl', dir: path.join(tmp, 'kn', 'cl') }), null)
})
