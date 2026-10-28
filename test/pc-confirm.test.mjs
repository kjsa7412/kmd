// 팀 화면 → 내 PC 쪽(짝 열쇠) — 팀 프로그램이 개인 프로그램의 일을 다 한다.
//
// 짝 열쇠로 이 PC 화면의 일(설정 · 가져오기 · 이력 · Claude 연결 · 지식 만들기)이 된다 · 닫힌 길(멈추기 · 한 번용 번호 · 기기)은 403.
// 이 PC 밖으로 손이 닿는 일(백업 자리 · 지식 폴더 · 에이전트 설치 · 폴더 들이기 · 지우기)은 428 — 이 PC 가 연 확인 창에서 [확인] 한
// 같은 일(출처 · 길 · 글이 같은 것)만 확인 번호로 한 번 지나간다. 확인 창의 답은 같은 출처(이 PC 의 창)에서만 받는다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, team, pc, me, dkey = null, origin, token
const roots = []

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-pcok-'))
  process.env.KMD_NO_BROWSER = '1'
  process.env.KMD_NO_CLAUDE = '1'
  const kd = path.join(tmp, 'pc', '설계메모')
  fs.mkdirSync(path.join(kd, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(kd, 'README.md'), '# 설계메모\n')
  fs.writeFileSync(path.join(kd, 'docs', '배치.md'), '# 배치\n\n## 재시도\n5분 뒤 한 번 더.\n')
  pc = await startServer({ root: path.join(tmp, 'pc'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15, onRoot: (r) => roots.push(r), deviceKey: async (o) => (team && o === origin ? dkey : null) })
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  team = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  origin = new URL(team.url).origin
  me = await signIn(team, { id: 'kim' })
  dkey = await team.auth.deviceKeyFor('kim', { host: 'KIM-PC', osuser: 'kim' })
  fs.writeFileSync(path.join(tmp, 'pc', '.kmd', 'teams.json'), JSON.stringify([team.url]))
  const { pass } = await fetch(team.url + '/api/me/pcpass', { method: 'POST', headers: { cookie: me.cookie, 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json())
  token = (await fetch(pc.url + '/pair', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ pass }) }).then((r) => r.json())).token
})
after(async () => {
  await team?.close()
  await pc?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

// 팀 화면에서 내 PC 쪽으로 — 짝 열쇠 · 그 팀 화면의 출처
const call = (p, body, extra = {}) => fetch(pc.url + p, { method: body === undefined ? 'GET' : 'POST', headers: { origin, authorization: 'Bearer ' + token, 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })
// 이 PC 의 확인 창 — 같은 출처에서 창 열쇠로 답한다
const answer = (id, ok = true, o = pc.url) => fetch(pc.url + '/ok/answer', { method: 'POST', headers: { origin: o, 'content-type': 'application/json' }, body: JSON.stringify({ s: pc.asks.get(id)?.secret, ok }) })

test('짝 열쇠로 이 PC 화면의 일을 한다 · 닫힌 길은 403', async () => {
  for (const p of ['/api/settings', '/api/history', '/api/sources', '/api/queue', '/api/claude/state', '/api/stops', '/api/busy', '/api/pc/root']) assert.equal((await call(p)).status, 200, p)
  assert.equal((await call('/api/pc/root').then((r) => r.json())).root, path.resolve(tmp, 'pc'))
  assert.equal((await call('/api/settings/auto', { key: 'find', on: false })).status, 200)
  const made = await call('/api/knowledge/add', { kind: 'new', name: '팀화면에서' })
  assert.equal(made.status, 200)
  assert.ok(fs.existsSync(path.join(tmp, 'pc', '팀화면에서', 'docs')))
  for (const p of ['/api/pc/once', '/api/pc/stop', '/api/me/devices/revoke', '/api/pair/forget']) assert.equal((await call(p, {})).status, 403, p)
  assert.equal((await call('/api/me/devices')).status, 403)
  // 짝 열쇠 없이는 아무것도
  assert.equal((await fetch(pc.url + '/api/settings', { headers: { origin } })).status, 401)
})

test('이 PC 밖으로 손이 닿는 일은 이 PC 의 확인 창에서 [확인] 한 같은 일만 한 번', async () => {
  const bk = path.join(tmp, 'bk')
  const r1 = await call('/api/pc/backup', { root: bk })
  assert.equal(r1.status, 428)
  const j1 = await r1.json()
  assert.equal(j1.error, 'E_CONFIRM')
  assert.ok(j1.confirm)
  assert.equal((await call('/api/confirm/' + j1.confirm).then((r) => r.json())).state, 'wait')
  // 확인 전 · 남의 출처의 답 · 창 열쇠 없는 답은 지나가지 못한다
  assert.equal((await call('/api/pc/backup', { root: bk }, { 'x-kmd-ok': j1.confirm })).status, 403)
  assert.equal((await answer(j1.confirm, true, origin)).status, 403)
  assert.equal((await fetch(pc.url + '/ok/answer', { method: 'POST', headers: { origin: pc.url, 'content-type': 'application/json' }, body: JSON.stringify({ s: 'x', ok: true }) }).then((r) => r.json())).gone, true)
  // 확인 창 — 무엇을 하는지 그대로 · [확인]
  const info = await fetch(pc.url + '/ok/info', { method: 'POST', headers: { origin: pc.url, 'content-type': 'application/json' }, body: JSON.stringify({ s: pc.asks.get(j1.confirm).secret }) }).then((r) => r.json())
  assert.equal(info.path, '/api/pc/backup')
  assert.equal(info.body.root, bk)
  assert.equal(info.origin, origin)
  assert.equal((await answer(j1.confirm).then((r) => r.json())).state, 'ok')
  assert.equal((await call('/api/confirm/' + j1.confirm).then((r) => r.json())).state, 'ok')
  // 다른 글로는 지나가지 못한다 · 같은 글은 한 번
  assert.equal((await call('/api/pc/backup', { root: path.join(tmp, 'other') }, { 'x-kmd-ok': j1.confirm })).status, 403)
  const ok = await call('/api/pc/backup', { root: bk }, { 'x-kmd-ok': j1.confirm })
  assert.equal(ok.status, 200, await ok.clone().text())
  assert.equal((await call('/api/settings').then((r) => r.json())).backup.root, bk)
  assert.equal((await call('/api/pc/backup', { root: bk }, { 'x-kmd-ok': j1.confirm })).status, 403, '확인은 한 번만')
  // 거절
  const r2 = await call('/api/agent/add', { dir: path.join(tmp, 'work') })
  const j2 = await r2.json()
  assert.equal(r2.status, 428)
  assert.equal((await answer(j2.confirm, false).then((r) => r.json())).state, 'no')
  assert.equal((await call('/api/confirm/' + j2.confirm).then((r) => r.json())).state, 'no')
  // 폴더 들이기는 확인 · 새 이름은 바로
  assert.equal((await call('/api/knowledge/add', { kind: 'folder', dir: path.join(tmp, 'pc', '설계메모') })).status, 428)
  // 개인 지식 지우기도 확인
  assert.equal((await call('/api/k/' + encodeURIComponent('팀화면에서') + '/delete', { confirm: '팀화면에서' })).status, 428)
})

test('지식 폴더 바꾸기 — .kmd 가 있거나 빈 폴더만 · 확인한 뒤 그 폴더로 다시 켠다', async () => {
  const move = async (root) => {
    const r = await call('/api/pc/root', { root })
    if (r.status !== 428) return r
    const { confirm } = await r.json()
    await answer(confirm)
    return call('/api/pc/root', { root }, { 'x-kmd-ok': confirm })
  }
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
})
