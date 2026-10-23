// E2 필수 — 들어가기 · 잠금 · 세션 판 · 처음 들어오기 링크 · 첫 관리자 · 기기 열쇠 · 기계 열쇠 · 예전 열쇠 · PC 한 번용 번호 · 비밀.
//
// 자리(IP)는 serve.json 의 trustProxy 로 X-Forwarded-For 를 받아 흉내 낸다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { prehash } from '../app/prehash.js'
import { setSecret, getSecret } from '../core/secrets.js'
import { put, get, keyName } from '../core/keystore.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, kim
const N = 1 << 15

const req = async (p, { body, cookie, bearer, ip, method } = {}) => {
  const headers = { 'content-type': 'application/json' }
  if (cookie) headers.cookie = cookie
  if (bearer) headers.authorization = `Bearer ${bearer}`
  if (ip) headers['x-forwarded-for'] = ip
  const r = await fetch(s.url + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') }
}
const login = (user, password, o = {}) => req('/login', { body: { user, pw: prehash(user, password) }, ...o })
const rpc = (bearer, method = 'tools/list') => req('/mcp', { body: { jsonrpc: '2.0', id: 1, method }, bearer })

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-e2-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ trustProxy: true }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: N })
})
after(async () => {
  await s?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('첫 관리자 — 셸이 받은 주소 한 번 · 토큰 원문 없음 · 두 번은 안 된다', async () => {
  assert.equal((await req('/api/me')).body.setup, true)
  assert.equal((await req('/api/knowledge')).status, 401, '들어오기 전에는 자료 0')
  const code = await s.auth.setupCode()
  const r = await req('/setup', { body: { code, name: 'lee', pw: prehash('lee', 'admin-pw-1234') } })
  assert.equal(r.status, 200)
  assert.deepEqual(Object.keys(r.body), ['user'], '열쇠 원문을 돌려주지 않는다')
  assert.equal((await req('/api/me', { cookie: r.cookie })).body.admin, true)
  assert.equal((await req('/setup', { body: { code, name: 'x', pw: prehash('x', 'y'.repeat(12)) } })).status, 401)
  assert.equal(await s.auth.setupCode(), null)
})

test('들어가기 — 같은 실패 문구 · 잠김 응답 같음 · 남의 IP 5번 → 전에 들어온 브라우저는 들어감', async () => {
  kim = await signIn(s, { id: 'kim', admin: false })
  const unknown = await login('nobody', 'whatever-123', { ip: '10.0.0.1' })
  const wrong = await login('kim', 'wrong-pw-123', { ip: '10.0.0.1' })
  assert.equal(unknown.status, 401)
  assert.deepEqual(unknown.body, wrong.body, '없는 아이디와 틀린 비밀번호는 같은 답')
  const mark = (await login('kim', kim.pw, { ip: '10.0.0.2' })).cookie // 이 브라우저는 전에 들어왔다
  for (let i = 0; i < 5; i++) await login('kim', 'wrong-pw-123', { ip: '10.0.0.9' })
  const locked = await login('kim', kim.pw, { ip: '10.0.0.9' })
  assert.equal(locked.status, 401)
  assert.deepEqual(locked.body, wrong.body, '잠긴 동안은 맞아도 같은 답')
  const marked = await login('kim', kim.pw, { ip: '10.0.0.9', cookie: mark })
  assert.equal(marked.status, 200, '전에 들어온 브라우저는 잠금 밖')
  assert.equal((await rpc(kim.key)).status, 200, '잠겨도 기기 열쇠는 멈추지 않는다')
})

test('세션 판 — 모든 기기에서 나가기 · 다시 정하기가 옛 쿠키를 끊는다 · 새 링크 알림', async () => {
  const a = (await login('kim', kim.pw, { ip: '10.0.1.1' })).cookie
  assert.equal((await req('/api/knowledge', { cookie: a })).status, 200)
  await req('/api/me/logout-all', { body: {}, cookie: a })
  assert.equal((await req('/api/knowledge', { cookie: a })).status, 401)
  const b = (await login('kim', kim.pw, { ip: '10.0.1.1' })).cookie
  const { code } = await s.auth.reset('kim', { by: 'lee' })
  assert.equal((await req('/api/knowledge', { cookie: b })).status, 401, '다시 정하면 쓰던 화면은 나간다')
  assert.equal((await rpc(kim.key)).status, 200, '기기 열쇠는 그대로')
  assert.equal((await req('/first', { body: { check: true, code } })).body.user, 'kim')
  await req('/first', { body: { code, pw: prehash('kim', 'new-pw-12345') } })
  assert.equal((await req('/first', { body: { code, pw: prehash('kim', 'again-12345') } })).status, 401, '링크는 한 번')
  kim.pw = 'new-pw-12345'
  const r = await login('kim', kim.pw, { ip: '10.0.1.1' })
  assert.match(r.body.notice || '', /관리자가 새 링크를 만들었다/)
})

test('기기 열쇠 — 설치 표는 한 번 · 열쇠로는 들어가기 · 표 만들기 · 관리 불가', async () => {
  const c = (await login('kim', kim.pw, { ip: '10.0.2.1' })).cookie
  const t = await req('/api/device/ticket', { body: {}, cookie: c })
  assert.match(t.body.line, /^irm http:\/\/.+\/i\/kmdt_\S+ \| iex$/)
  // 설치 한 줄이 받는 스크립트 — 표를 그대로 kmd connect 에 넘긴다(받기만으로는 표가 쓰이지 않는다)
  const sc = await fetch(t.body.line.split(' ')[1]).then((x) => x.text())
  assert.match(sc, new RegExp(`kmd connect '.+' --ticket '${t.body.ticket}'`))
  const k1 = await req('/device/keys', { body: { ticket: t.body.ticket, host: 'LAPTOP-KIM', osuser: 'kim' } })
  assert.match(k1.body.key, /^kmdk_/)
  assert.equal((await req('/device/keys', { body: { ticket: t.body.ticket } })).status, 401, '표는 한 번')
  assert.equal((await rpc(k1.body.key)).status, 200)
  assert.equal((await req('/login', { body: { token: k1.body.key } })).status, 401, '기기 열쇠로 들어가기 불가')
  assert.equal((await req('/api/device/ticket', { body: {}, bearer: k1.body.key })).status, 403, '열쇠로 열쇠를 만들지 못한다')
  assert.ok((await req('/api/me/devices', { cookie: c })).body.some((d) => d.host === 'LAPTOP-KIM'))
  const dev = (await req('/api/me/devices', { cookie: c })).body.find((d) => d.host === 'LAPTOP-KIM')
  await req('/api/me/devices/revoke', { body: { id: dev.id }, cookie: c })
  assert.equal((await rpc(k1.body.key)).status, 401, '끊은 열쇠는 거절')
  // 아이디 · 비밀번호로도(설치 표 없는 한 줄)
  const k2 = await req('/device/keys', { body: { user: 'kim', pw: prehash('kim', kim.pw), host: 'X' } })
  assert.match(k2.body.key, /^kmdk_/)
})

test('관리 — 사람 더하기는 관리자 + 재인증 · 기계 열쇠는 기준선 길 하나만', async () => {
  const lee = (await login('lee', 'admin-pw-1234', { ip: '10.0.3.1' })).cookie
  const no = await req('/api/admin/users', { body: { id: 'park' }, cookie: lee })
  assert.equal(no.body.error, 'E_SUDO')
  const kimC = (await login('kim', kim.pw, { ip: '10.0.3.2' })).cookie
  assert.equal((await req('/api/admin/users', { body: { id: 'park' }, cookie: kimC })).status, 403, '관리자만')
  const su = await req('/api/sudo', { body: { pw: prehash('lee', 'admin-pw-1234') }, cookie: lee })
  const ok = await req('/api/admin/users', { body: { id: 'park' }, cookie: su.cookie })
  assert.match(ok.body.link, /\/first#code=/)
  const m = await s.auth.machineAdd({ kn: 'dpms', source: 'dpms-api', types: ['term'] })
  assert.equal((await req('/api/knowledge', { bearer: m.key })).status, 403)
  assert.equal((await rpc(m.key)).status, 403)
  assert.equal((await req('/api/k/gdi/baseline', { body: {}, bearer: m.key })).status, 403, '다른 지식')
  assert.equal((await req('/api/admin/users', { body: { id: 'kmd-auto' }, cookie: su.cookie })).status, 400, '예약 이름')
})

test('예전 열쇠 — 비밀번호를 안 정한 사람만 · 곧바로 비밀번호 정하기 · 그 뒤 화면 불가 · MCP 는 그대로', async () => {
  const { code: c0 } = await s.auth.addUser({ id: 'old' })
  const legacy = crypto.randomBytes(32).toString('base64url')
  await s.auth.addLegacy('old', legacy)
  assert.equal((await req('/api/me')).body.legacy, true)
  const r = await req('/login', { body: { token: legacy } })
  assert.equal(r.body.setPassword, true)
  await req('/first', { body: { code: r.body.code, pw: prehash('old', 'old-pw-12345') } })
  assert.equal((await req('/login', { body: { token: legacy } })).status, 401)
  assert.equal((await rpc(legacy)).status, 200)
  assert.ok(c0)
})

test('PC — 한 번용 번호(60초) → 루프백 쿠키 · 팀 쿠키는 PC 에서 안 된다', async () => {
  const pc = await startServer({ root: path.join(tmp, 'kn'), data: path.join(tmp, 'pcdata'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: N })
  try {
    const once = pc.auth.once(pc.pcUser)
    const r = await fetch(pc.url + '/once', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: once }) })
    const c = r.headers.getSetCookie()[0].split(';')[0]
    assert.equal((await fetch(pc.url + '/api/knowledge', { headers: { cookie: c } })).status, 200)
    const again = await fetch(pc.url + '/once', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: once }) })
    assert.equal(again.status, 401, '번호는 한 번')
    assert.equal((await fetch(s.url + '/api/knowledge', { headers: { cookie: c } })).status, 401, 'PC 쿠키는 팀에서 안 된다')
  } finally {
    await pc.close()
  }
})

test('비밀 · 자격 저장소 · kmd-key', async () => {
  const d = path.join(tmp, 'sec')
  await setSecret(d, 'db/gdi', '비밀값')
  assert.equal(await getSecret(d, 'db/gdi'), '비밀값')
  const url = 'http://team.example:7373'
  await put(keyName(url), 'kmdk_시험')
  assert.equal(await get(keyName(url)), 'kmdk_시험')
  const out = execFileSync(process.execPath, [path.join(HERE, '..', 'server', 'bin', 'kmd-key.mjs'), url], { encoding: 'utf8', env: { ...process.env } })
  assert.deepEqual(JSON.parse(out), { Authorization: 'Bearer kmdk_시험' })
  assert.equal(prehash('Kim', '비밀번호1'), crypto.pbkdf2Sync('비밀번호1', 'kmd-login-v1:kim', 20000, 32, 'sha256').toString('base64url'), '화면의 전처리 = node')
})
