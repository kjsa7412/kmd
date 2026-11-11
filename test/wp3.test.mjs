// WP3 필수 — 요청 · 짝 · 세션 쓰기 안전(제품화 검토 v0.1 G1-1 · F-011 · F-012 · G1-4 · G2-4 · F-047 · G2-1 · F-079).
//
// 상태를 바꾸는 길은 POST 로만 · 다른 사이트의 쿠키 요청은 받지 않는다 · 글 속 그림은 이 지식의 첨부만(/api/… 는 그리지 않는다) ·
// 기록만 하는 사람의 names 는 항목 장부를 바꾸지 않고 기록에 실린다(응답이 그렇게 말한다) · 없는 항목 · 문서는 자리와 상관없이 같은 검사 ·
// 남의 기록이 섞인 정리는 기록만 하는 사람이 되돌리지 못하고, 되돌려도 함께 든 기록의 주인에게 알리지 않는다(S-D14 · 이력에 남는다) ·
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
import { copyDir, signIn, seat } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LEE = { user: 'lee' }
const PARK = { user: 'park', admin: true } // 팀 지식의 정리 · 바로 고치기는 총괄 관리자(지식관리자와 같은 자리)
let tmp, root, data, s, kim, lee
// 자동 정리(kmd-auto)는 사람이 아니다 — 자리 없이 셸로 쓴다(기본 자리 「없음」 · 권한 모델 v1.1)
const AUTO = { user: 'kmd-auto', shell: true }
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
  await signIn(s, { id: 'choi', admin: false })
  // 기본 자리는 「없음」(권한 모델 v1.1 4절) — 기록만 하는 팀 사람(lee · choi)에게 쓰기 자리를 준다
  await seat(s, 'lee', { dpms: 'write' })
  await seat(s, 'choi', { dpms: 'write' })
  await s.hub.setOwner(SHELL, 'dpms', { owner: 'park' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('상태를 바꾸는 길은 POST 로만: 글 속 그림 한 줄이 연 사람의 쿠키로 나가기 · 비밀번호 지우기 · 관리자 해제를 부르지 않는다', async () => {
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

test('글 속 그림은 이 지식의 첨부만: /api/… · 밖의 주소는 그리지 않는다', async () => {
  await s.hub.save(SHELL, 'dpms', {
    record: { title: '그림 시험: 셋', body: '그림 셋' },
    sections: [{ coord: 'proc:카나리', content: '흐름\n\n![흐름](assets/배포%20흐름.png)\n\n![](/api/me/logout-all)\n\n![x](https://evil.example/a.png)' }],
  }, { system: true })
  const v = await fetch(s.url + '/api/k/dpms/doc?d=' + encodeURIComponent('배포절차'), { headers: { cookie: kim.cookie } }).then((x) => x.json())
  const html = JSON.stringify(v)
  assert.match(html, /data-att=\\"배포 흐름\.png\\" data-ak=\\"dpms\\"/)
  assert.doesNotMatch(html, /src=\\"\/api/)
  assert.doesNotMatch(html, /evil\.example\/a\.png\\"/)
  assert.match(html, /\[그림\]/)
})

test('남의 기록이 섞인 정리: 기록만 하는 사람은 되돌리지 못한다 · 되돌려도 알리지 않는다(S-D14)', async () => {
  const a = await s.hub.save(LEE, 'dpms', { record: { title: '헬스 체크: lee', touches: ['proc:헬스 체크'], body: '주기 20초' } })
  const c = await s.hub.save({ user: 'choi' }, 'dpms', { record: { title: '헬스 체크: choi', touches: ['proc:헬스 체크'], body: '시간 초과 2초' } })
  const tidy = await s.hub.save(AUTO, 'dpms', {
    record: { title: '정리: 헬스 체크', tags: ['curate-llm'], reflects: [a.id, c.id], body: `- 넣음 ${a.id}: 헬스 체크\n- 넣음 ${c.id}: 헬스 체크` },
    sections: [{ coord: 'proc:헬스 체크', content: '주기 20초 · 시간 초과 2초' }],
  }, { system: true })
  assert.equal(await code(s.hub.revert(LEE, 'dpms', { record: tidy.id })), 'E_FORBIDDEN')
  // HTTP 몸 모양(설계 3-4) — 머리만 · docs/ 밖 문서 · 기록 id 가 아닌 것은 400(아무것도 쓰지 않는다)
  const post = (body) => fetch(s.url + '/api/k/dpms/revert', { method: 'POST', headers: { cookie: kim.cookie, 'content-type': 'application/json', origin: s.url }, body: JSON.stringify(body) })
  for (const body of [{ record: tidy.id, heading: '헬스 체크' }, { record: tidy.id, doc: '../_managed.md' }, { record: tidy.id, doc: 'docs/../x.md' }, { record: '../x' }, { record: tidy.id, doc: 'docs/배포절차.md', heading: 'a\nb' }, {}])
    assert.equal((await post(body)).status, 400, JSON.stringify(body))
  // 자기 기록만 든 정리는 되돌린다
  const own = await s.hub.save(AUTO, 'dpms', {
    record: { title: '정리: 롤백', tags: ['curate-llm'], reflects: [a.id], body: `- 넣음 ${a.id}: 롤백` },
    sections: [{ coord: 'proc:롤백', content: '이전 판으로' }],
  }, { system: true })
  assert.equal(await code(s.hub.revert(LEE, 'dpms', { record: own.id })), 'ok')
  // 주인(park)이 섞인 정리를 되돌린다 — 알림 없이 이력에만(S-D14) · 되돌림 기록은 태그 revert · 「## 되돌린 항목」
  assert.equal(await code(s.hub.revert(PARK, 'dpms', { record: tidy.id })), 'ok')
  for (const u of ['lee', 'choi']) assert.ok(!(await feed.list(data, u)).some((x) => /정리를 되돌렸다/.test(x.text || '')), u)
  const back = (await s.hub.get('dpms')).logs.find((w) => w.title === '되돌림: 정리: 헬스 체크')
  assert.ok(back.tags.includes('revert') && back.reopens.includes(tidy.id))
  assert.match(back.body, new RegExp(`^- ${tidy.id}: docs/.+\.md › 헬스 체크$`, 'm'))
})
