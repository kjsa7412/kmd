// WP3 필수 — 요청 · 짝 · 세션 쓰기 안전(제품화 검토 v0.1 G1-1 · F-011 · F-012 · G1-4 · G2-4 · F-047 · G2-1 · F-079).
//
// 상태를 바꾸는 길은 POST 로만 · 다른 사이트의 쿠키 요청은 받지 않는다 · 글 속 그림은 이 지식의 첨부만(/api/… 는 그리지 않는다) ·
// 기록만 하는 사람의 names 는 이름 장부를 바꾸지 않고 기록에 실린다(응답이 그렇게 말한다) · 없는 이름 · 문서는 자리와 상관없이 같은 검사 ·
// 남의 기록이 섞인 정리는 기록만 하는 사람이 되돌리지 못하고, 되돌리면 함께 든 기록의 주인에게 알린다 ·
// brief 에 내 자리 · 정리 방식 · 「자동 정리에 Claude 쓰지 않음」. 짝 짓기(F-011 · F-012)는 pair · open 시험.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { makeMcp } from '../server/mcp.js'
import * as feed from '../core/feed.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LEE = { user: 'lee' }
const PARK = { user: 'park' }
let tmp, root, data, s, kim, lee
const code = (p) => p.then(() => 'ok', (e) => e.code)

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-wp3-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  root = path.join(tmp, 'kn')
  data = path.join(root, '.kmd')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  kim = await signIn(s, { id: 'kim', admin: true })
  lee = await signIn(s, { id: 'lee', admin: false })
  await signIn(s, { id: 'park', admin: false })
  await s.hub.setOwner(SHELL, 'dpms', { owner: 'park' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('상태를 바꾸는 길은 POST 로만 — 글 속 그림 한 줄이 연 사람의 쿠키로 나가기 · 비밀번호 지우기 · 관리자 해제를 부르지 않는다', async () => {
  const get = (p, who) => fetch(s.url + p, { headers: { cookie: who.cookie } })
  for (const p of ['/api/me/logout-all', '/api/sudo', '/api/admin/users/lee/reset', '/api/admin/users/lee/admin', '/api/admin/users/lee/revoke-all', '/api/me/devices/revoke', '/api/device/ticket', '/api/k/dpms/revert', '/api/k/dpms/delete'])
    assert.equal((await get(p, kim)).status, 405, p)
  // 읽기 길은 그대로
  for (const p of ['/api/me', '/api/knowledge', '/api/k/dpms/tree', '/api/admin/users', '/api/me/devices']) assert.equal((await get(p, kim)).status, 200, p)
  assert.equal((await get('/api/me', lee)).status, 200, 'lee 는 아직 들어와 있다')
  // 다른 사이트에서 온 쿠키 POST — Origin 이 없어도 Sec-Fetch-Site 로
  const r = await fetch(s.url + '/api/me/logout-all', { method: 'POST', headers: { cookie: lee.cookie, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: '{}' })
  assert.equal(r.status, 403)
  assert.equal((await get('/api/me', lee)).status, 200)
})

test('글 속 그림은 이 지식의 첨부만 — /api/… · 밖의 주소는 그리지 않는다', async () => {
  await s.hub.save(SHELL, 'dpms', {
    record: { title: '그림 시험 — 셋', body: '그림 셋' },
    sections: [{ coord: 'proc:카나리', content: '흐름\n\n![흐름](assets/배포%20흐름.png)\n\n![](/api/me/logout-all)\n\n![x](https://evil.example/a.png)' }],
  }, { system: true })
  const v = await fetch(s.url + '/api/k/dpms/doc?d=' + encodeURIComponent('배포절차'), { headers: { cookie: kim.cookie } }).then((x) => x.json())
  const html = JSON.stringify(v)
  assert.match(html, /data-att=\\"배포 흐름\.png\\" data-ak=\\"dpms\\"/)
  assert.doesNotMatch(html, /src=\\"\/api/)
  assert.doesNotMatch(html, /evil\.example\/a\.png\\"/)
  assert.match(html, /\[그림\]/)
})

test('기록만 하는 사람의 names — 이름 장부는 그대로 · 기록에 「세울 이름」 · 응답이 말한다 · 없는 이름 · 문서는 주인과 같은 검사', async () => {
  const before = fs.readFileSync(path.join(root, 'dpms', '_managed.md'), 'utf8')
  const r = await s.hub.save(LEE, 'dpms', { record: { title: '카나리 — 이름 옮기기' }, names: [{ coord: 'proc:카나리', label: '카나리', doc: '장애대응', heading: '없는 머리' }] })
  assert.equal(r.queued, true)
  assert.equal(r.namesHeld, 1)
  assert.equal(fs.readFileSync(path.join(root, 'dpms', '_managed.md'), 'utf8'), before, '자리 장부를 바꾸지 않는다')
  assert.match(fs.readFileSync(path.join(root, 'dpms', r.record), 'utf8'), /## 세울 이름\n- 카나리 \(proc:카나리\) → 장애대응 › 없는 머리/)
  assert.equal(await code(s.hub.save(LEE, 'dpms', { record: { title: '없는 것 — 하나', body: 'a' }, sections: [{ coord: 'proc:없는것', content: 'a' }] })), 'E_NOTFOUND')
  assert.equal(await code(s.hub.save(PARK, 'dpms', { record: { title: '없는 것 — 하나', body: 'a' }, sections: [{ coord: 'proc:없는것', content: 'a' }] })), 'E_NOTFOUND')
  assert.equal(await code(s.hub.save(LEE, 'dpms', { record: { title: '없는 것 — 하나', body: 'a' }, sections: [{ doc: '없는문서', heading: '머리', content: 'a' }] })), 'E_NOTFOUND')
  // MCP — note 가 세우지 않았다고 말한다 · brief 에 내 자리
  const mcp = makeMcp(s.hub)
  const call = async (name, args, ctx) => {
    const out = await mcp.call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx)
    return JSON.parse(out.result.content[0].text)
  }
  const sv = await call('save', { knowledge: 'dpms', record: { title: '용어 — 하나' }, names: [{ coord: 'term:카나리 비율', label: '카나리 비율' }] }, LEE)
  assert.match(sv.note, /이름 1 은 아직 세우지 않았다/)
  const b = await call('brief', { knowledge: 'dpms' }, LEE)
  assert.deepEqual(b.you, { role: '기록', direct: false })
  assert.match(b.tidy, /정해진 시각/)
  assert.equal(b.noClaude, undefined)
  await s.hub.setOwner(SHELL, 'dpms', { noClaude: true })
  assert.match((await call('brief', { knowledge: 'dpms' }, PARK)).noClaude, /자동 정리에 Claude 를 쓰지 않는다/)
  assert.deepEqual((await call('brief', { knowledge: 'dpms' }, PARK)).you, { role: '주인', direct: true })
  await s.hub.setOwner(SHELL, 'dpms', { noClaude: false })
})

test('남의 기록이 섞인 정리 — 기록만 하는 사람은 되돌리지 못한다 · 되돌리면 함께 든 기록의 주인에게 알린다', async () => {
  const a = await s.hub.save(LEE, 'dpms', { record: { title: '헬스 체크 — lee', touches: ['proc:헬스 체크'], body: '주기 20초' } })
  const c = await s.hub.save({ user: 'choi' }, 'dpms', { record: { title: '헬스 체크 — choi', touches: ['proc:헬스 체크'], body: '시간 초과 2초' } })
  const tidy = await s.hub.save({ user: 'kmd-auto' }, 'dpms', {
    record: { title: '정리 — 헬스 체크', tags: ['curate-llm'], reflects: [a.id, c.id], body: `- 넣음 ${a.id} — 헬스 체크\n- 넣음 ${c.id} — 헬스 체크` },
    sections: [{ coord: 'proc:헬스 체크', content: '주기 20초 · 시간 초과 2초' }],
  }, { system: true })
  assert.equal(await code(s.hub.revert(LEE, 'dpms', { record: tidy.id })), 'E_FORBIDDEN')
  // 자기 기록만 든 정리는 되돌린다
  const own = await s.hub.save({ user: 'kmd-auto' }, 'dpms', {
    record: { title: '정리 — 롤백', tags: ['curate-llm'], reflects: [a.id], body: `- 넣음 ${a.id} — 롤백` },
    sections: [{ coord: 'proc:롤백', content: '이전 판으로' }],
  }, { system: true })
  assert.equal(await code(s.hub.revert(LEE, 'dpms', { record: own.id })), 'ok')
  // 주인(park)이 섞인 정리를 되돌린다 — lee · choi 에게 알린다
  assert.equal(await code(s.hub.revert(PARK, 'dpms', { record: tidy.id })), 'ok')
  for (const u of ['lee', 'choi']) assert.ok((await feed.list(data, u)).some((x) => /park 이 정리를 되돌렸다 — 내 기록도 문서에서 빠졌다/.test(x.text)), u)
})
