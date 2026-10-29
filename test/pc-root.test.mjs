// 개인 프로그램 — 지식 폴더 바꾸기 · 빼기는 개인 화면(이 PC 화면)에서 한다.
//
// 팀 화면은 개인 프로그램을 부르지 않는다(분리): 다른 출처에서 온 요청은 살아 있나(/healthz) 말고는 받지 않고,
// 짝짓기(/pair) · 짝 끊기(/api/pair/forget) · 확인 창(/ok · /api/confirm) 길은 없다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startServer } from '../server/http.js'
import { noneRoot } from '../core/pcops.js'

let tmp, pc, cookie
const roots = []
const TEAM = 'http://kmd.team.local'

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-pcroot-'))
  process.env.KMD_NO_BROWSER = '1'
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_PC_ROOT_FILE = path.join(tmp, 'kmd-pc.json') // 빼기의 빈자리 폴더가 이 옆에 선다
  const kd = path.join(tmp, 'pc', '설계메모')
  fs.mkdirSync(path.join(kd, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(kd, 'README.md'), '# 설계메모\n')
  fs.writeFileSync(path.join(kd, 'docs', '배치.md'), '# 배치\n\n## 재시도\n5분 뒤 한 번 더.\n')
  pc = await startServer({ root: path.join(tmp, 'pc'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15, onRoot: (r) => roots.push(r) })
  fs.writeFileSync(path.join(tmp, 'pc', '.kmd', 'teams.json'), JSON.stringify([TEAM]))
  cookie = await signInPc(pc)
})
after(async () => {
  await pc?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

// 개인 화면 — 한 번용 번호로 들어온 쿠키
async function signInPc(s) {
  const r = await fetch(s.url + '/once', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: s.auth.once(s.pcUser) }) })
  assert.equal(r.status, 200)
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}
const call = (s, ck, p, body) => fetch(s.url + p, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: ck, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

test('다른 출처(팀 화면)에서 온 요청은 받지 않는다 · 살아 있나만 · 짝 · 확인 창 길은 없다', async () => {
  const o = { origin: TEAM, 'content-type': 'application/json' }
  assert.equal((await fetch(pc.url + '/api/knowledge', { headers: o })).status, 403)
  assert.equal((await fetch(pc.url + '/api/pc/root', { method: 'POST', headers: o, body: JSON.stringify({ none: true }) })).status, 403)
  const pre = await fetch(pc.url + '/api/knowledge', { method: 'OPTIONS', headers: { ...o, 'access-control-request-method': 'GET' } })
  assert.equal(pre.headers.get('access-control-allow-origin'), null, 'CORS 를 열지 않는다')
  const live = await fetch(pc.url + '/healthz', { headers: { origin: TEAM } })
  assert.equal(live.status, 200)
  assert.equal(live.headers.get('access-control-allow-origin'), '*')
  assert.notEqual((await fetch(pc.url + '/pair', { method: 'POST', headers: o, body: '{}' })).status, 200)
  assert.equal((await call(pc, cookie, '/api/pair/forget', { origin: TEAM })).status, 404)
  assert.equal((await call(pc, cookie, '/api/confirm/abcdefgh')).status, 404)
  assert.equal((await fetch(pc.url + '/ok')).status, 404)
  // 개인 화면의 일은 확인 창 없이 바로(같은 출처 · 들어온 사람)
  const r = await call(pc, cookie, '/api/knowledge/add', { kind: 'new', name: '테스트-개인' })
  assert.equal(r.status, 200)
})

test('지식 폴더 바꾸기 — .kmd 가 있거나 빈 폴더만 · 그 폴더로 다시 켠다 · 이은 팀은 함께 간다', async () => {
  roots.length = 0
  const move = (root) => call(pc, cookie, '/api/pc/root', { root })
  // 다른 파일만 있는 폴더는 받지 않는다
  const busy = path.join(tmp, 'busy')
  fs.mkdirSync(busy, { recursive: true })
  fs.writeFileSync(path.join(busy, 'a.txt'), 'x')
  assert.equal((await move(busy)).status, 400)
  // 있던 지식 폴더(.kmd) — 그대로 잇는다
  const old = path.join(tmp, 'old')
  fs.mkdirSync(path.join(old, '.kmd'), { recursive: true })
  const r = await move(old)
  assert.equal(r.status, 200)
  assert.equal((await r.json()).kind, 'open')
  // 없는 폴더 — 새로 세운다
  const fresh = path.join(tmp, 'fresh')
  const r2 = await move(fresh)
  assert.equal((await r2.json()).kind, 'new')
  assert.ok(fs.existsSync(path.join(fresh, '.kmd')))
  await new Promise((ok) => setTimeout(ok, 400))
  assert.deepEqual(roots, [path.resolve(old), path.resolve(fresh)])
  // 이은 팀(지식 보내기 · Claude Code 의 팀 연결)은 새 폴더로 함께 간다
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fresh, '.kmd', 'teams.json'), 'utf8')), [TEAM])
})

test('지식 폴더 빼기 — 빈자리로 다시 켠다 · 폴더의 파일은 그대로 · 빈자리에서는 지식을 만들지 않는다', async () => {
  roots.length = 0
  const r = await call(pc, cookie, '/api/pc/root', { none: true })
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.equal(j.kind, 'none')
  assert.equal(j.root, noneRoot())
  await new Promise((ok) => setTimeout(ok, 400))
  assert.deepEqual(roots, [noneRoot()])
  assert.ok(fs.existsSync(path.join(tmp, 'pc', '설계메모', 'docs', '배치.md')), '뺀 폴더의 파일은 그대로')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(noneRoot(), '.kmd', 'teams.json'), 'utf8')), [TEAM])
  // 빈자리로 켠 개인 프로그램 — /api/me 에 none · 지식 만들기는 막는다
  const nd = await startServer({ root: noneRoot(), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const ck = await signInPc(nd)
    assert.equal((await call(nd, ck, '/api/me').then((x) => x.json())).none, true)
    assert.equal((await call(nd, ck, '/api/knowledge/add', { kind: 'new', name: '안됨' })).status, 400, '지식 폴더가 서기 전에는 만들지 않는다')
    assert.ok(!fs.existsSync(path.join(noneRoot(), '안됨')))
    assert.equal((await call(pc, cookie, '/api/me').then((x) => x.json())).none, undefined, '지식 폴더가 있는 쪽은 none 이 아니다')
  } finally {
    await nd.close()
  }
})
