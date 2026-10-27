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
import { copyDir, signIn } from './helpers.mjs'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture', 'kmd')
let tmp, s, kn, bare, me
const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=남', '-c', 'user.email=nam@x', '-c', 'core.autocrlf=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const rec = (title) => ({ record: { title, body: title + '본문', touches: ['proc:카나리'] } })
const ctx = { user: '김' }
const ADMIN = { user: '이', admin: true }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// git 한 번이 수 초씩 걸리는 PC(보안 프로그램 · 다른 시험)가 있다 — 기다림은 넉넉히, 판정은 끝난 보내기로
async function until(f, ms = 60000) {
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
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ backupRoots: [tmp], decideMs: 3600000 }))
  // ls-remote 를 5초에 끊으면 느린 PC 에서 판정마다 'timeout' 이 되어 다시 보내기만 되풀이한다
  backup.configure({ delays: [150], lsTimeout: 30000 })
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {} })
  me = await signIn(s, { id: 'kim' })
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
// Windows — 도는 git 이 폴더를 쥐고 있으면 이름 바꾸기가 EPERM · EBUSY 로 넘어진다. 잠깐 기다려 다시
async function rename(a, b) {
  for (let i = 0; ; i++) {
    try {
      return fs.renameSync(a, b)
    } catch (e) {
      if (i > 50 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e
      await wait(100)
    }
  }
}

test('붙이면 지금까지 보낸다 · 상태 파일이 남는다 · 잘 될 때 줄 0', async () => {
  const r = await s.hub.backupAttach(ADMIN, 'dpms', bare)
  assert.equal(r.ok, true)
  assert.equal(remoteHead(), head())
  assert.ok(fs.existsSync(path.join(tmp, 'kn', '.kmd', 'backup', 'dpms.json')))
  assert.deepEqual(await s.hub.stops(ADMIN), [])
  const r2 = await s.hub.save(ctx, 'dpms', rec('둘째 저장'))
  assert.deepEqual(r2.warnings, [])
  assert.ok(await until(() => remoteHead() === head()), '저장하면 저절로 보낸다')
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
  // healthz 는 들어오지 않아도 받으므로 살아 있나 · 판만 — 멈춤 줄(지식 이름이 든다)은 들어온 사람의 /api/stops 로만
  const h = await (await fetch(s.url + '/healthz')).json()
  assert.deepEqual(Object.keys(h).sort(), ['mode', 'ok', 'version'])
})

test('끊긴 동안 저장은 그대로 · 나이 경보 · 닿으면 저절로 다시 보낸다', async () => {
  const off = bare + '.off'
  await backup.enqueue(kn)
  await rename(bare, off)
  try {
    const r = await s.hub.save(ctx, 'dpms', rec('끊긴 동안'))
    assert.ok(r.id, '저장은 막히지 않는다')
    // 저장은 백업을 3초까지만 기다린다 — 저장 뒤의 보내기가 끝난 것을 보고 판정한다
    assert.notEqual((await backup.enqueue(kn)).ok, true)
    assert.notEqual(backup.stateOf(kn).last.ok, true)
    const later = backup.lines(kn, { now: Date.now() + 7 * 3600000 }).find((l) => /멈췄다/.test(l.text))
    assert.equal(later?.level, 'warn', '6시간이면 노랑')
    assert.equal(backup.lines(kn, { now: Date.now() + 25 * 3600000 }).find((l) => /멈췄다/.test(l.text))?.level, 'bad', '24시간이면 빨강')
  } finally {
    await rename(off, bare) // 넘어져도 다음 시험이 백업 자리를 잃지 않게
  }
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
  const res = await fetch(s.url + '/api/k/dpms/save', { method: 'POST', headers: { 'content-type': 'application/json', cookie: me.cookie }, body: JSON.stringify(rec('막힐 저장')) })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, 'E_BEHIND')
  const p = await s.hub.backupPull(ADMIN, 'dpms')
  assert.equal(p.pulled, 1)
  assert.match(fs.readFileSync(path.join(kn.dir, 'docs', '운영.md'), 'utf8'), /남이 더한 줄/)
  const r = await s.hub.save(ctx, 'dpms', rec('받은 뒤 저장'))
  assert.ok(!r.warnings.some((w) => /읽기만|멈췄다/.test(w)), r.warnings.join())
  assert.ok(await until(() => remoteHead() === head()))

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

test('상태 파일 없는 clone: origin 은 백업이 아니다 · 보내지 않는다', async () => {
  const before = remoteHead()
  G(path.join(tmp, 'kn'), 'clone', '-q', bare, 'cl')
  s.hub.forget()
  await s.hub.save(ctx, 'cl', rec('받아 온 지식에 저장'))
  assert.equal(remoteHead(), before)
  assert.equal(backup.stateOf({ id: 'cl', dir: path.join(tmp, 'kn', 'cl') }), null)
})
