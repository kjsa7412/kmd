// WP4 필수 — 사람 관리 · 떠남(제품화 검토 v0.1 G4-1 · G4-2 · G4-3 · F-010 · F-014 · F-015 · F-016 · F-019 · G4-4 · F-068).
//
// 떠남 한 번 — 들어가기 · 기기 · 세션을 끊고 아이디를 남긴다(되쓰지 않는다 · 링크도 막는다) · 그 사람의 지식은 넘기거나
// 주인 칸을 비운다 · 사람 몫 PC 일꾼 열쇠는 걷었다(옛 열쇠는 받지 않는다) ·
// 관리자는 화면에서 팀 지식을 세운다 · 주인 넘기기 · 개인 ↔ 팀은 비밀번호 한 번 더 · 팀 지식 지우기는 주인이어도 비밀번호 한 번 더 ·
// 부탁은 합치고 · 개인 지식에는 받지 않고 · 더하면 닫히고 · 거절하면 부탁한 사람에게 알린다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import * as feed from '../core/feed.js'
import { prehash } from '../app/prehash.js'
import { copyDir, signIn, seat } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, root, data, s, kim, lee, park
const code = (p) => p.then(() => 'ok', (e) => e.code)
const post = (p, who, body = {}) => fetch(s.url + p, { method: 'POST', headers: { cookie: who.cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const get = (p, who) => fetch(s.url + p, { headers: { cookie: who.cookie } })
async function sudo(who) {
  const r = await post('/api/sudo', who, { pw: prehash(who.id, who.pw) })
  assert.equal(r.status, 200)
  const c = r.headers.getSetCookie().map((x) => x.split(';')[0])
  who.cookie = [...who.cookie.split('; ').filter((x) => !c.some((y) => y.split('=')[0] === x.split('=')[0])), ...c].join('; ')
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-wp4-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  root = path.join(tmp, 'kn')
  data = path.join(root, '.kmd')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  kim = await signIn(s, { id: 'kim', admin: true })
  lee = await signIn(s, { id: 'lee', admin: false })
  park = await signIn(s, { id: 'park', admin: false })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('사람 몫 PC 일꾼 열쇠는 걷었다: 새로 만들지 않고 · 옛 열쇠는 받지 않고 켤 때 명부에서 지운다 · 팀 정리 일꾼은 그대로', async () => {
  // 팀 정리 일꾼 열쇠 — 그대로(사람에 묶이지 않는다)
  const tw = await s.auth.workerAdd()
  assert.deepEqual(Object.keys(s.auth.bearer(tw.key).worker), ['id'])
  // 옛 판의 명부에 남은 사람 몫 PC 일꾼(owner) — 켤 때 지우고 · 열쇠는 받지 않는다
  const { makeAuth } = await import('../core/auth.js')
  const pwmod = await import('../core/passwd.js')
  const d = path.join(tmp, 'oldauth')
  fs.mkdirSync(d, { recursive: true })
  const key = 'kmdw_' + 'x'.repeat(43)
  fs.writeFileSync(path.join(d, 'auth.json'), JSON.stringify({ v: 1, setup: null, users: { yoon: { kind: 'person', keys: [{ id: 'd1', sha: 'a', at: new Date().toISOString() }] }, 'worker-old1': { kind: 'worker', owner: 'yoon', device: 'd1', keys: [{ id: 'w', sha: pwmod.sha(key), at: new Date().toISOString() }] } } }))
  const a = await makeAuth({ dataDir: d, scryptN: 1 << 15 })
  assert.equal(a.bearer(key), null, '옛 PC 일꾼 열쇠는 받지 않는다')
  assert.ok(!a.users().some((u) => u.id === 'worker-old1'), '명부에서 지웠다')
})

test('떠남: 한 번에 끊고 아이디를 남긴다 · 지식은 넘기거나 주인 칸을 비운다 · 떠난 사람은 목록 · 링크 · 고르기에서 빠진다', async () => {
  const leeKey = lee.key
  await s.hub.setOwner(SHELL, 'dpms', { curators: ['lee'] })
  await s.hub.setOwner(SHELL, 'gdi', { owner: 'lee' })
  // 비밀번호 한 번 더 없이는 안 된다 · 나 자신은 안 된다
  assert.equal((await post('/api/admin/users/lee/off', kim)).status, 403)
  await sudo(kim)
  assert.equal((await post('/api/admin/users/kim/off', kim)).status, 400)
  assert.equal((await get('/api/admin/users/lee/off', kim)).status, 405)
  const r = await post('/api/admin/users/lee/off', kim, { to: 'none' }).then((x) => x.json())
  assert.deepEqual([r.devices >= 1, r.workers, r.kn.team, r.kn.curate], [true, undefined, 1, 1])
  assert.equal((await get('/api/me', lee).then((x) => x.json())).anon, true, '세션이 끊긴다')
  assert.equal(s.auth.bearer(leeKey), null, '기기 열쇠')
  assert.equal(await code(s.auth.addUser({ id: 'lee' })), 'E_CONFLICT')
  await assert.rejects(s.auth.addUser({ id: 'lee' }), /떠난 사람의 아이디다. 되쓰지 않는다\(예: lee2\)/)
  assert.equal(await code(s.auth.reset('lee')), 'E_FORBIDDEN')
  assert.ok(!(await get('/api/people', kim).then((x) => x.json())).includes('lee'))
  const ov = await get('/api/admin/overview', kim).then((x) => x.json())
  assert.ok(!ov.nopw.includes('lee') && !ov.people.includes('lee') && ov.off.includes('lee'))
  // 지식 — 팀 지식 gdi 는 주인 없음 · dpms 정리하는 사람에서 빠짐
  const L = JSON.parse(fs.readFileSync(path.join(data, 'owners.json'), 'utf8')).knowledge
  assert.deepEqual([L.gdi.owner, L.dpms.curators], [null, []])
  // 사람 카드 — 떠난 사람 표 · 사람마다 지식 수
  const us = await get('/api/admin/users', kim).then((x) => x.json())
  assert.ok(us.users.find((u) => u.id === 'lee').off)
  assert.ok(!us.users.some((u) => u.kind === 'worker'))
})

test('관리자는 화면에서 팀 지식을 세운다 · 주인 넘기기 · 팀 지식 지우기는 비밀번호 한 번 더 · 팀 서버에는 개인 지식이 없다', async () => {
  const r = await post('/api/knowledge/add', kim, { kind: 'new', name: '보안점검' }).then((x) => x.json())
  assert.equal(r.id, '보안점검')
  // 새로 세운 지식은 all = none 으로 선다(권한 모델 v1.1 1절) — 자리를 받기 전에는 보이지 않고, 받으면 보인다
  assert.ok(!(await get('/api/knowledge', park).then((x) => x.json())).some((k) => k.id === '보안점검'), '자리 없으면 안 보인다')
  await seat(s, 'park', { 보안점검: 'read' })
  assert.ok((await get('/api/knowledge', park).then((x) => x.json())).some((k) => k.id === '보안점검'), '자리를 받으면 본다')
  assert.equal(await code(s.hub.addKnowledge({ user: 'park' }, { kind: 'new', name: '몰래팀' })), 'E_FORBIDDEN')
  // 일반은 팀 서버에 지식을 세우지 못한다(개인 지식은 내 PC 에) · 개인 지식 폴더 길은 없다
  assert.equal((await post('/api/knowledge/add', park, { kind: 'new', name: '내 메모' })).status, 403)
  assert.notEqual((await post('/api/me/personal', park, { root: path.join(root, '..', 'park-personal') })).status, 200)
  assert.equal((await get('/api/me', park).then((x) => x.json())).personalRoot, undefined)
  // 비밀번호 한 번 더가 끝난 관리자 — 주인 넘기기 · 지우기는 E_SUDO
  const kim2 = { ...kim }
  kim2.cookie = (await fetch(s.url + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'kim', pw: prehash('kim', kim.pw) }) })).headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const j = async (res) => (await res.json()).error
  assert.equal(await j(await post('/api/k/' + encodeURIComponent('보안점검') + '/owner', kim2, { owner: 'park' })), 'E_SUDO')
  assert.equal((await post('/api/k/' + encodeURIComponent('보안점검') + '/owner', kim2, { tidyAt: '04:00' })).status, 200, '정리 설정은 그대로')
  assert.equal(await j(await post('/api/k/' + encodeURIComponent('보안점검') + '/delete', kim2, { confirm: '보안점검' })), 'E_SUDO', '주인인 관리자라도')
  await sudo(kim2)
  assert.equal((await post('/api/k/' + encodeURIComponent('보안점검') + '/delete', kim2, { confirm: '보안점검' })).status, 200)
})

test('부탁: 같은 것은 합친다 · 더하면 닫힌다 · 거절하면 부탁한 사람에게', async () => {
  // 부탁하는 사람은 dpms 에 쓰기 자리가 있는 팀 사람(기본 자리는 없음 · 권한 모델 v1.1)
  await seat(s, 'park', { dpms: 'write' })
  await signIn(s, { id: 'choi', admin: false })
  await seat(s, 'choi', { dpms: 'write' })
  const card = { name: '회의록', at: 'https://git.example/team/minutes.git', kind: 'git', rules: [] }
  const a = await s.hub.sourceRequest({ user: 'park' }, 'dpms', card)
  const b = await s.hub.sourceRequest({ user: 'choi' }, 'dpms', card)
  assert.equal(b.id, a.id)
  assert.equal(b.again, true)
  assert.equal((await s.hub.requests()).length, 1)
  assert.equal((await s.hub.requests())[0].by, 'park, choi')
  const c = await s.hub.sourceRequest({ user: 'park' }, 'dpms', { ...card, name: '다른것' })
  // 거절 — 부탁한 사람의 이력에 · 목록에서 빠진다
  assert.equal((await post(`/api/requests/${c.id}/close`, kim, { state: 'no', why: '이미 백업에서 받는다' })).status, 200)
  assert.ok((await feed.list(data, 'park')).some((x) => /더하지 않았다. 다른것/.test(x.text) && /이미 백업에서 받는다/.test(x.small)))
  assert.deepEqual((await s.hub.requests()).map((r) => r.name), ['회의록'])
  // 더함은 부탁을 닫는다 — 같은 지식 · 같은 이름(여기서는 닫기만 시험)
  await s.hub.requestClose({ user: 'kim' }, a.id, { state: 'done' })
  assert.deepEqual(await s.hub.requests(), [])
  for (const u of ['park', 'choi']) assert.ok((await feed.list(data, u)).some((x) => /부탁한 가져올 곳을 더했다. 회의록/.test(x.text)), u)
})
