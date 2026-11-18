// 권한 넷 · 기본 없음(docs/kmd_권한_모델.md v1.1 — 6절) — 순수 함수 setSeats · 자리 이름 · _members.md 자리 줄.

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

test('지식마다 자리(순수): 사람 줄만 바꾼다 · 없음이면 지운다 · 주인은 그대로 · 모르는 자리는 거절 · 이름 「지식관리자」', () => {
  const reg = { groups: {}, knowledge: { a: { owner: 'o', access: { all: 'none', users: { x: 'read' }, groups: {} } } } }
  assert.deepEqual(owners.setSeats(reg, 'x', { a: '쓰기', b: 'read' }).sort(), ['a', 'b'])
  assert.equal(owners.levelOf(reg, 'a', { user: 'x' }), 'write')
  assert.equal(owners.levelOf(reg, 'b', { user: 'x' }), 'read')
  assert.deepEqual(owners.setSeats(reg, 'o', { a: 'none' }), [], '주인은 늘 지식관리자')
  owners.setSeats(reg, 'x', { a: 'none' })
  assert.equal(owners.levelOf(reg, 'a', { user: 'x' }), 'none')
  assert.throws(() => owners.setSeats(reg, 'x', { a: '주인' }), /없음 · 읽기 · 쓰기 · 지식관리자/)
  assert.equal(owners.levelWord('지식관리자'), 'admin')
  assert.equal(owners.levelWord('관리'), null, '옛 이름 「관리」 는 읽지 않는다(이행기가 옮긴다)')
  // _members.md — 「지식관리자」 줄로 쓰고 읽는다
  const md = owners.renderMembers({ owner: 'o', access: { all: 'none', users: { x: 'admin' }, groups: {} } })
  assert.match(md, /^- 지식관리자: x$/m)
  assert.doesNotMatch(md, /^- 관리:/m)
  assert.deepEqual(owners.parseMembers('- 주인: o\n- 모두: 없음\n- 지식관리자: y\n').access.users, { y: 'admin' })
  // 같은 자리 표 · 다른 차례는 같다(켤 때 _members.md 를 괜히 다시 쓰지 않는다 — 188 에서 본 것)
  assert.ok(owners.sameAccess({ all: 'none', users: { b: 'write', a: 'read' } }, { all: 'none', users: { a: 'read', b: 'write' } }))
  assert.ok(!owners.sameAccess({ all: 'none', users: { a: 'read' } }, { all: 'none', users: { a: 'write' } }))
})
