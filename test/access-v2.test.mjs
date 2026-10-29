// 권한 넷 · 기본 없음 · 옛 지식 한 번 옮기기(docs/kmd_권한_모델.md v1.1 — 4절 · 6절).
//
// 순수 함수(owners.migrateV2 · setSeats)와 서버(켤 때 한 번 옮기기 · 사람 더하기의 지식마다 자리 · 사람 카드의 자리 보기 · 바꾸기)를 본다.
// 받지 않은 지식은 목록 · 문서 · MCP 어디에도 없다(404) · 옮긴 뒤에는 겉으로 바뀌는 것이 없다 · 다시 켜도 다시 돌지 않는다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import * as owners from '../core/owners.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-accv2-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
})
after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('옮기기(순수): 있던 사람에게 옛 기본 자리 · 낮추지 않는다 · 정리하는 사람은 지식관리자 · 되살림 · 주인 없음은 그대로 · 한 번만', () => {
  const reg = {
    groups: { 운영: { members: ['g'] } },
    knowledge: {
      old: { owner: 'o', curators: ['c'] }, // 옛 줄 — 모두 쓰기
      rd: { owner: 'o', curators: [], access: { all: 'read', users: { w: 'write' }, groups: {} } }, // 새 꼴 · 모두 읽기
      ad: { owner: null, curators: [], access: { all: 'write', users: { a: 'admin' }, groups: { 운영: 'admin' } } },
      dead: { owner: null, curators: [], restored: true }, // 되살림 · 주인 없음 — 총괄 관리자만
      shut: { owner: 'o', curators: [], access: { all: 'none', users: { r: 'read' }, groups: {} } },
    },
  }
  const people = ['o', 'c', 'w', 'a', 'g', 'n']
  const touched = owners.migrateV2(reg, ['old', 'rd', 'ad', 'dead', 'shut', 'norow'], people)
  assert.deepEqual(touched.sort(), ['ad', 'dead', 'norow', 'old', 'rd'].sort())
  assert.equal(reg.accessV, 2)
  const L = (id, u) => owners.levelOf(reg, id, { user: u })
  // 옛 줄 — 모두에게 쓰기 · 정리하는 사람은 지식관리자 · 주인은 주인 · 기본은 없음
  assert.deepEqual(reg.knowledge.old.access, { all: 'none', users: { a: 'write', c: 'admin', g: 'write', n: 'write', w: 'write' }, groups: {} })
  assert.deepEqual(reg.knowledge.old.curators, [])
  assert.deepEqual(people.map((u) => L('old', u)), ['admin', 'admin', 'write', 'write', 'write', 'write'])
  // 모두 읽기였던 지식 — 읽기를 적는다 · 이미 쓰기인 사람은 그대로
  assert.deepEqual(['w', 'n'].map((u) => L('rd', u)), ['write', 'read'])
  assert.equal(reg.knowledge.rd.access.all, 'none')
  // 모두 쓰기 · 묶음 지식관리자 — 묶음 자리는 그대로 · 사람 줄 지식관리자도 그대로(낮추지 않는다)
  assert.deepEqual(['a', 'g', 'n'].map((u) => L('ad', u)), ['admin', 'admin', 'write'])
  assert.equal(reg.knowledge.ad.access.groups.운영, 'admin')
  // 되살림 · 주인 없음 — 사람 줄을 적지 않는다(모두 없음을 새 꼴로 · 총괄 관리자만) · 이미 없음인 지식은 그대로
  assert.deepEqual(reg.knowledge.dead.access, { all: 'none', users: {}, groups: {} })
  assert.equal(L('dead', 'n'), 'none')
  assert.deepEqual(reg.knowledge.shut.access.users, { r: 'read' })
  // 장부에 줄이 없던 지식도 옮긴다(쓰기)
  assert.equal(L('norow', 'n'), 'write')
  // 두 번째는 아무것도 하지 않는다 · 옮긴 뒤 새 사람은 아무것도 보지 않는다
  assert.deepEqual(owners.migrateV2(reg, ['old', 'norow'], ['new']), [])
  assert.equal(L('old', 'new'), 'none')
  assert.equal(L('brandnew', 'n'), 'none', '줄이 없는 지식의 기본은 없음')
  assert.equal(owners.levelOf(reg, 'brandnew', { user: 'x', admin: true }), 'admin', '총괄 관리자는 모든 지식')
})

test('지식마다 자리(순수): 사람 줄만 바꾼다 · 없음이면 지운다 · 주인은 그대로 · 모르는 자리는 거절 · 새 이름 「지식관리자」 와 옛 이름 「관리」', () => {
  const reg = { groups: {}, knowledge: { a: { owner: 'o', curators: ['c'], access: { all: 'none', users: { x: 'read' }, groups: {} } } } }
  assert.deepEqual(owners.setSeats(reg, 'x', { a: '쓰기', b: 'read' }).sort(), ['a', 'b'])
  assert.equal(owners.levelOf(reg, 'a', { user: 'x' }), 'write')
  assert.equal(owners.levelOf(reg, 'b', { user: 'x' }), 'read')
  assert.equal(owners.levelOf(reg, 'a', { user: 'c' }), 'admin', '예전 정리하는 사람은 사람 줄 지식관리자로 남는다')
  assert.deepEqual(owners.setSeats(reg, 'o', { a: 'none' }), [], '주인은 늘 지식관리자')
  owners.setSeats(reg, 'x', { a: 'none' })
  assert.equal(owners.levelOf(reg, 'a', { user: 'x' }), 'none')
  assert.throws(() => owners.setSeats(reg, 'x', { a: '주인' }), /없음 · 읽기 · 쓰기 · 지식관리자/)
  assert.equal(owners.levelWord('지식관리자'), 'admin')
  assert.equal(owners.levelWord('관리'), 'admin', '옛 이름도 읽는다')
  // _members.md — 새 이름으로 쓰고 옛 줄도 읽는다
  const md = owners.renderMembers({ owner: 'o', access: { all: 'none', users: { x: 'admin' }, groups: {} } })
  assert.match(md, /^- 지식관리자: x$/m)
  assert.doesNotMatch(md, /^- 관리:/m)
  assert.deepEqual(owners.parseMembers('- 주인: o\n- 모두: 없음\n- 관리: y\n').access.users, { y: 'admin' })
})

test('서버: 켤 때 한 번 옮긴다(있던 사람은 그대로 본다 · 뒤에 더한 사람은 받은 지식만) · 사람 더하기 · 지식마다 자리 보기 · 바꾸기', async () => {
  const root = path.join(tmp, 'kn')
  const data = path.join(root, '.kmd')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  const ledger = () => JSON.parse(fs.readFileSync(path.join(data, 'owners.json'), 'utf8'))
  // 옛 판의 서버 — 사람 둘(boss 총괄 관리자 · lee)이 있고 장부는 옛 꼴(accessV 없음 · 자리 표 없음)
  let s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  const boss = await signIn(s, { id: 'boss', admin: true })
  const lee = await signIn(s, { id: 'lee', admin: false })
  await s.close()
  const old = ledger()
  delete old.accessV
  for (const r of Object.values(old.knowledge)) { delete r.access; r.curators = [] }
  fs.writeFileSync(path.join(data, 'owners.json'), JSON.stringify(old))
  // 옛 판의 _members.md — 자리 표 줄이 없다(주인 · 정리 설정만)
  for (const id of Object.keys(old.knowledge)) {
    const mf = path.join(root, id, '_members.md')
    if (fs.existsSync(mf)) fs.writeFileSync(mf, fs.readFileSync(mf, 'utf8').split('\n').filter((l) => !/^- (모두|읽기|쓰기|지식관리자|관리|묶음):/.test(l)).join('\n'))
  }
  // 새 판으로 켠다 — 있던 lee 는 옛 지식마다 쓰기(겉으로 그대로) · 장부에 accessV 2 · _members.md 도
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const req = async (p, who, body) => {
      const r = await fetch(s.url + p, { method: body === undefined ? 'GET' : 'POST', headers: { ...(who.key ? { authorization: `Bearer ${who.key}` } : { cookie: who.cookie }), 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
      return { status: r.status, j: await r.json().catch(() => null) }
    }
    const ids = (await s.hub.list()).map((k) => k.id).sort()
    assert.ok(ids.length >= 2)
    assert.equal(ledger().accessV, 2)
    for (const id of ids) assert.equal(ledger().knowledge[id].access.users.lee, 'write', `${id}: lee 는 쓰기`)
    assert.deepEqual((await req('/api/knowledge', lee)).j.map((k) => `${k.id}/${k.level}`).sort(), ids.map((id) => `${id}/write`))
    assert.match(fs.readFileSync(path.join(root, 'dpms', '_members.md'), 'utf8'), /^- 모두: 없음$/m)
    // 다시 켜도 다시 돌지 않는다 — 옮긴 뒤 줄인 자리는 그대로
    await s.hub.setSeats({ shell: true }, 'lee', { gdi: 'none' })
    await s.close()
    s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
    assert.equal(ledger().knowledge.gdi.access.users.lee, undefined, '다시 돌아 쓰기를 되돌려 적지 않는다')
    // 뒤에 더한 사람 — 받지 않은 지식은 없다(목록 · 문서 · MCP 모두 404)
    const kim = await signIn(s, { id: 'kim', admin: false })
    assert.deepEqual((await req('/api/knowledge', kim)).j, [])
    assert.equal((await req('/api/k/dpms/tree', kim)).status, 404)
    const brief = await req('/mcp', kim, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'brief', arguments: { knowledge: 'dpms' } } })
    assert.match(JSON.stringify(brief.j), /없|E_NOTFOUND|404/)
    // 사람 더하기 — 지식마다 자리를 함께 · 처음 들어오기 링크 · 고르지 않은 지식은 없음
    const bossNow = { cookie: (await signInAgain(s, boss)).cookie }
    const add = await req('/api/admin/users', bossNow, { id: 'park', admin: false, seats: { dpms: '읽기' } })
    assert.equal(add.status, 200)
    assert.match(add.j.link, /\/first#code=/)
    assert.deepEqual(add.j.kns, ['dpms'])
    const seats = await req('/api/admin/users/park/seats', bossNow)
    assert.equal(seats.j.seats.dpms.mine, 'read')
    assert.equal(seats.j.seats.gdi.mine, 'none')
    // 사람 카드에서 바꾸기 — 쓰기로 · 없음으로(그 지식이 사라진다) · 모르는 지식 · 자리는 거절 · 총괄 관리자가 아니면 403
    const ch = await req('/api/admin/users/park/seats', bossNow, { seats: { dpms: 'write', gdi: '지식관리자' } })
    assert.equal(ch.status, 200)
    assert.deepEqual([ch.j.seats.dpms.level, ch.j.seats.gdi.level], ['write', 'admin'])
    assert.equal((await req('/api/admin/users/park/seats', bossNow, { seats: { 없는지식: 'read' } })).status, 400)
    assert.equal((await req('/api/admin/users/park/seats', bossNow, { seats: { dpms: '주인' } })).status, 400)
    assert.equal((await req('/api/admin/users/park/seats', bossNow, { seats: { __proto__: 'read' } })).status, 200, 'prototype 이름은 빈 것으로 본다')
    assert.equal((await req('/api/admin/users/park/seats', lee, { seats: { dpms: 'admin' } })).status, 403)
    assert.equal((await req('/api/admin/users/lee/seats', lee)).status, 403)
    assert.equal((await req('/api/admin/users', bossNow, { id: 'bad1', seats: [1] })).status, 400, '자리 모양이 아니면 사람을 세우지 않는다')
    assert.ok(!s.auth.people().includes('bad1'))
    // 오류 말 — 새 이름
    const w = await req('/api/k/dpms/sources/run', lee, { name: 'x' })
    assert.equal(w.status, 403)
    assert.match(w.j.message, /지식관리자/)
  } finally {
    await s.close()
  }
})

// 비밀번호 한 번 더(/api/sudo) — 총괄 관리자 일(사람 더하기 · 자리 바꾸기)은 15분 안의 확인이 있어야 한다
async function signInAgain(s, who) {
  const { prehash } = await import('../app/prehash.js')
  const r = await fetch(s.url + '/api/sudo', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ pw: prehash(who.id, who.pw) }) })
  assert.equal(r.status, 200)
  const set = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  return { cookie: set || who.cookie }
}
