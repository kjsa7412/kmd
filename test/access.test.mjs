// 지식마다 자리(읽기 · 쓰기 · 관리 — docs/kmd_권한_모델.md) — 서버 쪽 전부.
//
// 사람 넷(총괄 관리자 · 읽기 · 쓰기 · 없음)과 주인 하나 · 지식 둘(dpms 는 모두=없음 · gdi 는 모두=쓰기)을 세우고, 각 사람의 기기 열쇠
// (Authorization: Bearer)로 목록 · 찾기 · 문서 · 기록 저장 · 바로 고치기 · 가져올 곳 · 지금 하는 일 · 이력 · 정리 일감 · MCP 가
// 자리대로 보이고 막히는지 본다(없음 → 404 · 읽기의 쓰기 → 403 E_FORBIDDEN · 쓰기의 고치기 → 기록으로).
// 자리 표가 없으면 없음(권한 모델 v1.1 · 주인 · 총괄 관리자만) · _members.md 왕복 · 묶음 · 떠남 · 지식 지우기 · 셸(kmd access · group · user key).

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import * as owners from '../core/owners.js'
import * as feed from '../core/feed.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KMD = path.join(HERE, '..', 'server', 'bin', 'kmd.mjs')
let tmp, root, data, s
const P = {} // boss(전역 관리자) · rd(읽기) · wr(쓰기 — 묶음 개발) · no(없음) · own(dpms 주인)
const ledger = () => JSON.parse(fs.readFileSync(path.join(data, 'owners.json'), 'utf8'))

const req = async (p, who, body) => {
  const r = await fetch(s.url + p, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${who.key}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, j: await r.json().catch(() => null) }
}
const mcp = async (name, args, who) => {
  const r = await req('/mcp', who, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  return r.j.result.structuredContent
}
const levels = async (who) => Object.fromEntries((await req('/api/knowledge', who)).j.map((k) => [k.id, `${k.level}/${k.role}`]))
const D = encodeURIComponent('배포절차')

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-access-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  root = path.join(tmp, 'kn')
  data = path.join(root, '.kmd')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  P.boss = await signIn(s, { id: 'boss', admin: true })
  for (const id of ['rd', 'wr', 'no', 'own']) P[id] = await signIn(s, { id, admin: false })
  // 켠 뒤에 만든 사람은 옮기기(migrateAccess)의 옛 기본 자리를 받지 않는다 — 자리 표 없는 지식은 보이지 않는다(권한 모델 v1.1)
  assert.deepEqual(await levels(P.no), {}, '기본 없음: 자리를 받기 전에는 아무 지식도 없다')
  assert.deepEqual(await levels(P.boss), { dpms: 'admin/지식관리자', gdi: 'admin/지식관리자' })
  // gdi 는 「모두: 쓰기」 로 연다(예전 기본을 이제는 자리 표에 적어서) — 아래 시험의 gdi 는 들어온 사람 모두 쓰기
  await s.hub.setAccess(SHELL, 'gdi', { all: 'write' })
  await s.hub.setGroup(SHELL, { name: '개발', members: ['wr'] })
  await s.hub.setOwner(SHELL, 'dpms', { owner: 'own' })
  await s.hub.setAccess(SHELL, 'dpms', { all: 'none', users: { rd: 'read' }, groups: { 개발: 'write' } })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('판정: 총괄 관리자 · 주인 · 정리하는 사람 → 지식관리자 · 사람 · 묶음 · 모두의 가장 높은 것 · 자리 표가 없으면 없음', () => {
  const reg = { groups: { 운영: { members: ['a'] } }, knowledge: { k: { owner: 'o', curators: ['c'], access: { all: 'read', users: { b: 'write' }, groups: { 운영: 'admin' } } }, old: { owner: 'o', curators: [] }, back: { restored: true } } }
  const L = (id, ctx) => owners.levelOf(reg, id, ctx)
  assert.deepEqual(['o', 'c', 'a', 'b', 'z'].map((u) => L('k', { user: u })), ['admin', 'admin', 'admin', 'write', 'read'])
  assert.equal(L('k', { user: 'z', admin: true }), 'admin', '전역 관리자')
  // 기본이 바뀌었다(권한 모델 v1.1) — 예전 「줄 없음 · access 없음 → 모두 쓰기」 는 이제 없음 · 주인 · 총괄 관리자 · 예전 정리하는 사람만
  assert.equal(L('nothing', { user: 'z' }), 'none', '줄이 없는 지식: 없음')
  assert.equal(L('nothing', { user: 'z', admin: true }), 'admin')
  assert.equal(L('old', { user: 'z' }), 'none', 'access 없는 옛 줄: 없음')
  assert.equal(L('old', { user: 'o' }), 'admin', 'access 없는 옛 줄의 주인은 그대로 지식관리자')
  assert.deepEqual(owners.legacyAccessOf(reg.knowledge.old), { all: 'write', users: {}, groups: {} }, '옛 규칙은 옮기기에만 남는다')
  assert.equal(L('back', { user: 'z' }), 'none', '되살림 · 주인 없음: 관리자만(지금과 같다)')
  assert.equal(L('back', { user: 'z', admin: true }), 'admin')
  reg.knowledge.back.curators = ['c']
  assert.equal(L('back', { user: 'c' }), 'none', '되살림 · 주인 없음 줄의 정리하는 사람도 관리자만(권한 모델 4절)')
  assert.equal(owners.seatOf(reg, 'back', 'c'), null)
  assert.equal(L('k', { agent: { kn: 'k' } }), 'admin', '에이전트 열쇠는 그 지식만')
  assert.equal(L('old', { agent: { kn: 'k' } }), 'none')
  assert.throws(() => owners.normAccess({ all: '아무거나' }), /자리는/)
})

test('목록 · 자리: /api/knowledge 의 level · role(읽기 · 쓰기 · 지식관리자) · 없음이면 보이지 않는다', async () => {
  assert.deepEqual(await levels(P.boss), { dpms: 'admin/지식관리자', gdi: 'admin/지식관리자' })
  assert.deepEqual(await levels(P.own), { dpms: 'admin/지식관리자', gdi: 'write/쓰기' })
  assert.deepEqual(await levels(P.rd), { dpms: 'read/읽기', gdi: 'write/쓰기' })
  assert.deepEqual(await levels(P.wr), { dpms: 'write/쓰기', gdi: 'write/쓰기' }, '묶음 개발=쓰기')
  assert.deepEqual(await levels(P.no), { gdi: 'write/쓰기' }, '없음: 목록에 없다 · gdi 는 모두 쓰기')
})

test('읽기 길: 찾기 · 문서 · MCP brief/section 은 읽기 이상 · 없음은 「없는 지식」(404)', async () => {
  const f = await req('/api/find?q=' + encodeURIComponent('배포 카나리'), P.no)
  assert.equal(f.status, 200)
  assert.ok(!JSON.stringify(f.j).includes('"k":"dpms"'), '없음: 찾기에 dpms 가 없다')
  assert.ok(JSON.stringify((await req('/api/find?q=' + encodeURIComponent('배포 카나리'), P.rd)).j).includes('"k":"dpms"'), '읽기: 찾기에 보인다')
  assert.equal((await req('/api/find?k=dpms&q=x', P.no)).status, 404)
  const nd = await req(`/api/k/dpms/doc?d=${D}`, P.no)
  assert.deepEqual([nd.status, nd.j.error], [404, 'E_NOTFOUND'])
  assert.match(nd.j.message, /지식 「dpms」 이 없다/, '없는 지식과 같은 글')
  const rd = await req(`/api/k/dpms/doc?d=${D}`, P.rd)
  assert.deepEqual([rd.status, rd.j.direct], [200, false])
  assert.equal((await req(`/api/k/dpms/doc?d=${D}`, P.own)).j.direct, true, '주인 = 지식관리자: 바로 고치기')
  assert.ok(!(await mcp('brief', {}, P.no)).knowledge.some((k) => k.id === 'dpms'))
  assert.equal((await mcp('brief', { knowledge: 'dpms' }, P.no)).error, 'E_NOTFOUND')
  assert.deepEqual((await mcp('brief', { knowledge: 'dpms' }, P.rd)).you, { role: '읽기', direct: false, ledgers: false })
  assert.deepEqual((await mcp('brief', { knowledge: 'dpms' }, P.wr)).you, { role: '쓰기', direct: true, ledgers: false }, '쓰기 자리의 조각은 검사를 넘으면 그 순간 문서에(S4) · 장부는 기록으로')
  assert.deepEqual((await mcp('brief', { knowledge: 'dpms' }, P.own)).you, { role: '지식관리자', direct: true, ledgers: true }, '지식관리자는 장부도 곧바로')
  assert.equal((await mcp('section', { knowledge: 'dpms', doc: '배포절차', heading: '롤백' }, P.rd)).heading, '롤백')
  assert.equal((await mcp('section', { knowledge: 'dpms', doc: '배포절차', heading: '롤백' }, P.no)).error, 'E_NOTFOUND')
})

test('쓰기 길: 읽기는 403 E_FORBIDDEN · 쓰기는 같은 저장 문(검사를 넘은 조각은 그 순간 문서에) · 읽은 뒤 바뀌면 E_CONFLICT', async () => {
  // 지식 생성 가드 — 화면 · 세션의 save 는 건드린 이름(touches)이나 이름 없는 까닭(touchesEmpty)이 있어야 한다
  const rec = { record: { title: '롤백: 앱 먼저', body: '앱을 먼저 내린다', touchesEmpty: '시험 — 롤백 순서 메모' } }
  assert.equal((await req('/api/k/dpms/save', P.wr, { record: { title: '이름 없음', body: 'x' } })).status, 400, '이름도 까닭도 없는 기록은 받지 않는다')
  const r1 = await req('/api/k/dpms/save', P.rd, rec)
  assert.deepEqual([r1.status, r1.j.error], [403, 'E_FORBIDDEN'])
  assert.match(r1.j.message, /이 지식에 쓰기 자리가 없다/)
  assert.equal((await req('/api/k/dpms/save', P.no, rec)).status, 404)
  assert.equal((await req('/api/k/dpms/save', P.wr, rec)).status, 200)
  // 화면 고치기 — 쓰기는 기록으로 · 읽기는 막힌다
  const ed = { doc: '배포절차', sections: [{ h: '롤백', body: '앱을 먼저 내리고 DB 를 되돌린다.' }] }
  assert.equal((await req('/api/k/dpms/edit', P.rd, ed)).status, 403)
  const e2 = await req('/api/k/dpms/edit', P.wr, ed)
  assert.deepEqual([e2.status, e2.j.direct], [200, false], '쓰기의 고치기는 기록으로')
  // MCP save — 읽기는 막히고 · 쓰기도 지식관리자(주인)도 같은 저장 문: 검사를 넘은 조각은 그 순간 문서에(이름 없는 항목은 문서 · 머리로)
  const sec = await mcp('section', { knowledge: 'dpms', doc: '배포절차', heading: '헬스 체크' }, P.own)
  const args = (base, n) => ({ knowledge: 'dpms', record: { title: `헬스 체크: 결과 남기기 ${n}`, body: '헬스 체크 결과를 남긴다.', changes: [`헬스 체크 결과: 운영 채널에 남긴다 ${n}`] }, sections: [{ doc: '배포절차', heading: '헬스 체크', base, edits: [{ find: '배포 뒤 서버 상태는 이것으로 본다.', replace: `배포 뒤 서버 상태는 이것으로 본다. 결과는 운영 채널에 남긴다 ${n}.` }] }] })
  assert.equal((await mcp('save', args(sec.base, 'A'), P.rd)).error, 'E_FORBIDDEN')
  const wr = await mcp('save', args(sec.base, 'A'), P.wr)
  assert.deepEqual([wr.docs, wr.put, wr.proposals[0].applied], [['배포절차'], 1, true], JSON.stringify(wr))
  // 같은 base 로 다시 — 그사이 바뀌었다: 아무것도 쓰지 않고 E_CONFLICT · 다시 읽을 항목
  const late = await mcp('save', args(sec.base, 'B'), P.own)
  assert.equal(late.error, 'E_CONFLICT')
  assert.deepEqual(late.details.stale, ['배포절차 › 헬스 체크'])
  const sec2 = await mcp('section', { knowledge: 'dpms', doc: '배포절차', heading: '헬스 체크' }, P.own)
  const own = await mcp('save', { ...args(sec2.base, 'B'), sections: [{ doc: '배포절차', heading: '헬스 체크', base: sec2.base, edits: [{ find: '남긴다 A.', replace: '남긴다 A. 지식관리자도 본다.' }] }] }, P.own)
  assert.deepEqual(own.docs, ['배포절차'], '지식관리자의 세션도 같은 저장 문')
  assert.equal((await mcp('save', { ...args(sec2.base, 'C'), record: { title: '롤백: 줄글', body: '앱을 먼저 내린다' } }, P.own)).error, 'E_INPUT', '서식 칸(바뀐 것) 없는 기록은 받지 않는다')
  // 찾기 학습 · 넣을 자리 · 정리 부탁 — 쓰기 이상
  assert.equal((await req('/api/k/dpms/learn', P.rd, { q: '롤백', coord: 'x' })).status, 403)
  assert.equal((await req('/api/k/dpms/tidy', P.rd, {})).status, 403)
  // 파일 넣기 · 받기
  assert.equal((await req('/api/k/dpms/import', P.rd, { files: [{ path: 'a.md', b64: Buffer.from('# a\n').toString('base64') }] })).status, 403)
  assert.equal((await req('/api/k/dpms/receive', P.rd, { from: 'x', items: [{ title: 't', body: 'b' }] })).status, 403)
  assert.equal((await req('/api/k/dpms/receive', P.wr, { from: 'x', items: [{ title: '받은 것', body: '본문' }] })).j.saved, 1)
  // 모두=쓰기(gdi) — 들어온 사람 모두 기록한다
  assert.equal((await req('/api/k/gdi/save', P.no, { record: { title: '공통코드: 메모', body: '모두 쓰기', touchesEmpty: '시험 메모' } })).status, 200)
})

test('관리 길: 가져올 곳 더하기 · 지금 가져오기 · 그대로 반영 · 문서 옮기기 · 자리 표는 관리 자리', async () => {
  const add = { name: '코드', at: 'https://example.com/x.git' }
  assert.equal((await req('/api/k/dpms/sources', P.wr, add)).status, 403)
  assert.equal((await req('/api/k/dpms/sources', P.no, add)).status, 404)
  assert.equal((await req('/api/k/dpms/sources/probe', P.wr, add)).status, 403)
  assert.equal((await req('/api/k/dpms/sources/run', P.rd, {})).status, 403)
  assert.equal((await req('/api/k/dpms/sources/run', P.wr, {})).status, 403, '지금 가져오기는 관리 자리(권한 모델 1절) · 쓰기는 부탁')
  assert.equal((await req('/api/k/dpms/sources/run', P.wr, { force: true })).status, 403)
  assert.equal((await req('/api/k/dpms/sources/run', P.own, {})).status, 200)
  // 지식 관리자는 허락된 호스트 안의 https git · DB 만 — 서버 자격(ssh) · 아무 포트 · 서버 폴더는 전역 관리자
  for (const at of ['git@gitlab.local:team/x.git', 'ssh://git@gitlab.local/team/x', 'https://example.com/x.git', HERE]) {
    const r = await req('/api/k/dpms/sources', P.own, { name: '코드', at })
    assert.deepEqual([r.status, r.j.error], [403, 'E_FORBIDDEN'], at)
  }
  assert.match((await req('/api/k/dpms/sources/probe', P.own, add)).j.message, /허락된 곳: 아직 없다/)
  assert.equal((await req('/api/k/dpms/sources/checkdb', P.own, { host: '127.0.0.1', port: 1 })).status, 403, 'DB 확인(포트 두드리기)도 허락된 호스트만')
  s.hub.config.sourceHosts = ['db.example.com']
  try {
    assert.equal((await req('/api/k/dpms/sources/checkdb', P.own, { host: '127.0.0.1', port: 1 })).status, 403)
    assert.equal((await req('/api/k/dpms/sources/checkdb', P.own, { host: 'db.example.com', port: 1 })).status, 200, '허락된 호스트는 지식 관리자도')
  } finally { delete s.hub.config.sourceHosts }
  assert.equal((await req('/api/k/dpms/sources/request', P.rd, add)).status, 403)
  assert.equal((await req('/api/k/dpms/docfmt', P.wr, { dry: true })).status, 403)
  assert.equal((await req('/api/k/dpms/docfmt', P.own, { dry: true })).status, 200, '지식 관리자도 문서 옮기기')
  assert.equal((await req('/api/k/dpms/owner', P.wr, { tidyMode: 'live' })).status, 403)
  assert.equal((await req('/api/k/dpms/owner', P.own, { tidyMode: 'manual' })).j.tidyMode, 'manual', '주인 = 관리: 정리 설정')
  assert.equal((await req('/api/k/dpms/owner', P.own, { owner: 'wr' })).status, 403, '주인 넘기기는 전역 관리자')
  const ro = (await req('/api/k/dpms/owner', P.rd)).j
  assert.deepEqual([ro.owner, ro.access, ro.curators], ['own', undefined, undefined], '읽기 자리의 주인 줄에 자리 표가 없다')
  assert.ok((await req('/api/k/dpms/owner', P.own)).j.access, '관리 자리는 자리 표까지')
  // 자리 표 — 보기 · 바꾸기
  assert.equal((await req('/api/k/dpms/access', P.wr)).status, 403)
  assert.equal((await req('/api/k/dpms/access', P.no)).status, 404)
  const v = (await req('/api/k/dpms/access', P.own)).j
  assert.deepEqual([v.all, v.users, v.groups, v.owner], ['none', { rd: 'read' }, { 개발: 'write' }, 'own'])
  assert.ok(v.people.includes('no') && v.groupNames.includes('개발'))
  assert.equal((await req('/api/k/dpms/access', P.own, { users: { 없는사람: 'read' } })).status, 400)
  assert.equal((await req('/api/k/dpms/access', P.own, { groups: { 없는묶음: 'read' } })).status, 400)
  const sudo = await req('/api/k/dpms/access', P.boss, { all: 'read' })
  assert.deepEqual([sudo.status, sudo.j.error], [403, 'E_SUDO'], '전역 관리자는 비밀번호 한 번 더')
  // no 에게 읽기를 줬다가 거둔다 — 거둔 뒤의 메뉴 응답에 옛 id 가 없다
  assert.equal((await req('/api/k/dpms/access', P.own, { users: { rd: 'read', no: '읽기' } })).j.users.no, 'read')
  assert.equal((await levels(P.no)).dpms, 'read/읽기')
  await req('/api/k/dpms/access', P.own, { users: { rd: 'read' } })
  assert.equal((await levels(P.no)).dpms, undefined)
  const menu = (await req('/api/knowledge/menu', P.no, { hidden: [] })).j
  assert.ok(!menu.order.includes('dpms'), '메뉴 응답에 볼 수 없는 지식 id 가 없다')
  // 가져오는 곳 부탁 목록 — 전역 관리자가 아니면 관리 자리인 지식의 것만
  assert.equal((await req('/api/requests', P.wr)).status, 200)
  assert.deepEqual((await req('/api/requests', P.wr)).j, [])
})

test('거르기: 지금 하는 일 · 정리 일감 · 일 줄 · 이력 · 오늘 · MCP 알림은 읽기 이상인 지식만', async () => {
  const t = await req('/api/k/dpms/tidy', P.wr, {})
  assert.equal(t.status, 200)
  const jid = t.j.id
  assert.ok(jid, '정리 일감')
  const busyRd = (await req('/api/busy', P.rd)).j.items.find((x) => x.kind === 'tidy' && x.kn === 'dpms')
  assert.deepEqual([busyRd?.job, busyRd?.qid], [jid, 't:' + jid], '정리에 job · 일 줄 id')
  assert.ok(!(await req('/api/busy', P.no)).j.items.some((x) => x.kn === 'dpms'))
  assert.equal((await req(`/api/job/${jid}`, P.rd)).j.kn, 'dpms')
  assert.equal((await req(`/api/job/${jid}`, P.no)).status, 404, '없음: 그 일감도 없다')
  assert.ok(!(await req('/api/queue', P.no)).j.items.some((x) => x.kn === 'dpms'))
  assert.ok((await req('/api/queue', P.rd)).j.items.some((x) => x.kn === 'dpms'))
  // 사람마다 쌓인 줄 — 자리를 잃은 지식의 것은 읽을 때 거른다
  await feed.add(data, 'no', { kind: 'save', kn: 'dpms', yl: true, b: '숨길 줄: dpms' })
  await feed.add(data, 'no', { kind: 'save', kn: 'gdi', yl: true, b: '보일 줄: gdi' })
  const h = (await req('/api/history', P.no)).j
  assert.ok(!h.some((x) => x.kn === 'dpms'), '이력에 dpms 줄이 없다')
  assert.ok(h.some((x) => x.title === '보일 줄: gdi'))
  assert.ok(!(await req('/api/today', P.no)).j.some((x) => x.kn === 'dpms'))
  const n = (await mcp('brief', {}, P.no)).notices
  assert.ok(n.includes('보일 줄: gdi') && !n.includes('숨길 줄: dpms'))
  assert.equal((await feed.list(data, 'no')).find((x) => x.b === '숨길 줄: dpms').briefed, true, '거른 줄도 알림은 끝난다(자리를 다시 받아도 옛 알림이 몰려오지 않게)')
  assert.ok((await req('/api/history', P.wr)).j.some((x) => x.kn === 'dpms'), '쓰기는 dpms 이력을 본다')
  // 가져오기 화면 · 설정 · 멈춤 줄
  assert.ok(!(await req('/api/stops', P.no)).j.some((x) => x.kn === 'dpms'))
  assert.equal((await req('/api/settings', P.no)).j.kns, 1)
})

test('_members.md 왕복: 자리 표를 싣고 · 장부가 잃으면 켤 때 되찾는다 · 옛 꼴은 자리 줄 없음', async () => {
  const md = fs.readFileSync(path.join(root, 'dpms', '_members.md'), 'utf8')
  assert.match(md, /- 주인: own\n/)
  assert.match(md, /- 모두: 없음\n- 읽기: rd\n- 쓰기: \n- 지식관리자: \n- 묶음: 개발=쓰기\n/)
  assert.deepEqual(owners.parseMembers(md).access, { all: 'none', users: { rd: 'read' }, groups: { 개발: 'write' } })
  assert.equal(owners.parseMembers('- 주인: kim\n- 정리 방식: 손으로만\n').access, undefined, '옛 꼴: 자리 줄 없음')
  assert.deepEqual(owners.parseMembers('- 모두: 없음\n- 관리: kim\n').access?.users, { kim: 'admin' }, '옛 이름 「관리」 도 읽는다')
  // 장부가 옛 꼴로 돌아갔다(줄의 access 를 잃음) — 맞추기가 _members.md 를 따른다
  const L = ledger()
  delete L.knowledge.dpms.access
  fs.writeFileSync(path.join(data, 'owners.json'), JSON.stringify(L, null, 1))
  // 잃은 동안은 기본 없음(권한 모델 v1.1 — 예전에는 모두 쓰기로 열렸다) · 주인은 그대로
  assert.equal((await levels(P.no)).dpms, undefined, '잃은 동안은 기본 없음')
  assert.equal((await levels(P.rd)).dpms, undefined)
  assert.equal((await levels(P.own)).dpms, 'admin/지식관리자')
  await s.hub.reconcileOwners()
  assert.deepEqual(ledger().knowledge.dpms.access, { all: 'none', users: { rd: 'read' }, groups: { 개발: 'write' } })
  assert.equal((await levels(P.no)).dpms, undefined)
  assert.deepEqual(ledger().groups.개발, { members: ['wr'] }, '장부를 고쳐 써도 묶음이 남는다')
})

test('묶음: 관리자만 · 사람을 빼면 그 자리도 빠진다 · 지우면 지식의 묶음 줄도', async () => {
  assert.equal((await req('/api/admin/groups', P.wr)).status, 403)
  const g = (await req('/api/admin/groups', P.boss)).j
  assert.deepEqual(g.groups.find((x) => x.name === '개발'), { name: '개발', members: ['wr'], kns: ['dpms'] })
  assert.equal((await req('/api/admin/groups', P.boss, { name: '운영', members: ['rd'] })).j.error, 'E_SUDO')
  const users = (await req('/api/admin/users', P.boss)).j.users
  assert.equal(users.find((u) => u.id === 'wr').roles.kns, 1, '자리 있는 지식 수(묶음으로)')
  assert.equal(users.find((u) => u.id === 'own').roles.kns, 1)
  await s.hub.setGroup(SHELL, { name: '개발', members: [] })
  assert.equal((await req(`/api/k/dpms/doc?d=${D}`, P.wr)).status, 404, '묶음에서 빠지면 자리도 없다')
  await s.hub.setGroup(SHELL, { name: '개발', members: ['wr'] })
  await assert.rejects(s.hub.setGroup(SHELL, { name: '운영', members: ['없는사람'] }), /그런 사람은 없다/)
  await assert.rejects(s.hub.setGroup(SHELL, { name: 'a=b', members: [] }), /묶음 이름/)
  await s.hub.setGroup(SHELL, { name: '임시', members: ['no'] })
  await s.hub.setAccess(SHELL, 'gdi', { all: 'read', groups: { 임시: 'write' } })
  assert.equal((await levels(P.no)).gdi, 'write/쓰기')
  assert.equal((await levels(P.rd)).gdi, 'read/읽기', 'gdi 를 모두 읽기로')
  const r = await s.hub.dropGroup(SHELL, '임시')
  assert.deepEqual(r.kns, ['gdi'])
  assert.deepEqual(ledger().knowledge.gdi.access.groups, {})
  assert.match(fs.readFileSync(path.join(root, 'gdi', '_members.md'), 'utf8'), /- 묶음: \n/)
})

test('떠남 · 지식 지우기 · setAdmin: 자리 줄 · 묶음에서 빠진다 · 지식을 지우면 자리 표도 · 기계 줄은 관리자가 되지 않는다', async () => {
  await s.hub.setGroup(SHELL, { name: '운영', members: ['rd', 'wr'] })
  await s.auth.off('rd', { by: 'boss' })
  const k = await s.hub.handOver('rd')
  assert.ok(k.seat >= 1)
  const L = ledger()
  assert.equal(L.knowledge.dpms.access.users.rd, undefined, '사람 줄에서 빠진다')
  assert.deepEqual(L.groups.운영.members, ['wr'], '묶음에서 빠진다')
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'dpms', '_members.md'), 'utf8'), /rd/)
  const made = await s.hub.addKnowledge({ user: 'boss', admin: true }, { kind: 'new', name: '임시지식' })
  await s.hub.setAccess(SHELL, made.id, { all: 'none', users: { no: 'admin' } })
  assert.ok(ledger().knowledge[made.id].access)
  await s.hub.deleteKnowledge(SHELL, made.id, { confirm: '임시지식' })
  assert.equal(ledger().knowledge[made.id], undefined, '지운 지식의 자리 표도 걷힌다')
  const m = await s.auth.machineAdd({ kn: 'dpms', source: 'x' })
  await assert.rejects(s.auth.setAdmin(m.id, true), /그런 사람은 없다/, 'setAdmin 은 사람 줄만(userOf 가 kind 를 본다)')
})

test('셸: kmd access(보기 · 바꾸기) · kmd group · kmd user key(그 사람의 자리 그대로)', async () => {
  const run = (...a) => execFileSync(process.execPath, [KMD, ...a, '--root', root], { encoding: 'utf8', env: { ...process.env, KMD_NO_BROWSER: '1' } })
  assert.match(run('access', 'dpms'), /dpms: 모두 없음 · 주인 own/)
  const out = run('access', 'dpms', '--user', 'no=읽기', '--group', '개발=관리')
  assert.match(out, /읽기: no/)
  assert.match(out, /묶음: 개발=지식관리자/)
  assert.equal((await levels(P.no)).dpms, 'read/읽기', '도는 서버가 곧바로 본다')
  assert.equal((await levels(P.wr)).dpms, 'admin/지식관리자', '셸의 옛 이름 「관리」 도 받는다')
  run('access', 'dpms', '--user', 'no=없음', '--group', '개발=쓰기')
  assert.equal((await levels(P.no)).dpms, undefined, '「없음」 은 그 줄을 뺀다')
  assert.match(run('group', 'add', '검토', 'no,wr'), /묶음 검토: no, wr/)
  assert.match(run('group', '검토', '-wr'), /묶음 검토: no$/m)
  assert.match(run('group'), /검토: no/)
  assert.match(run('group', 'rm', '검토'), /지웠다: 검토/)
  const key = run('user', 'key', 'no').split('\n').find((l) => l.startsWith('kmdk_'))
  assert.ok(key, '기기 열쇠 한 줄')
  assert.deepEqual(await levels({ key }), { gdi: 'read/읽기' }, '그 사람의 자리 그대로')
  assert.throws(() => run('user', 'key', '없는사람'), /그런 사람은 없다/)
})

test('옛 줄의 정리하는 사람: 첫 자리 표 저장에서 낮추면 곧바로 · 사람 줄을 보내지 않으면 지식관리자로 옮긴다', async () => {
  const reg = { groups: {}, knowledge: { k: { owner: 'o', curators: ['c', 'd'] } } }
  owners.setAccess(reg, 'k', { all: 'read', users: { c: 'read' } })
  assert.deepEqual(reg.knowledge.k.access.users, { c: 'read' }, '보낸 사람 줄 그대로(빠진 d 는 자리 없음)')
  assert.deepEqual(reg.knowledge.k.curators, [])
  const reg2 = { groups: {}, knowledge: { k: { owner: 'o', curators: ['c'] } } }
  owners.setAccess(reg2, 'k', { all: 'none' })
  assert.deepEqual(reg2.knowledge.k.access.users, { c: 'admin' }, '사람 줄을 안 보냈으면 지식관리자 줄로 옮긴다')
  // 화면 — 주인이 첫 저장에서 정리하는 사람을 읽기로
  const made = await s.hub.addKnowledge({ user: 'boss', admin: true }, { kind: 'new', name: '정리지식' })
  await s.hub.setOwner(SHELL, made.id, { owner: 'own', curators: ['wr'] })
  assert.equal((await levels(P.wr))[made.id], 'admin/지식관리자')
  assert.deepEqual((await req(`/api/k/${made.id}/access`, P.own)).j.users, { wr: 'admin' })
  const r = await req(`/api/k/${made.id}/access`, P.own, { all: 'none', users: { wr: 'read' } })
  assert.deepEqual([r.status, r.j.users], [200, { wr: 'read' }])
  assert.equal((await levels(P.wr))[made.id], 'read/읽기', '한 번에 낮아진다')
  await s.hub.deleteKnowledge(SHELL, made.id, { confirm: '정리지식' })
})

test('맞추기: 손으로 고쳐 깨진 _members.md(나쁜 묶음 이름)가 있어도 넘어지지 않고 장부의 값으로 고쳐 쓴다', async () => {
  const mf = path.join(root, 'gdi', '_members.md')
  fs.writeFileSync(mf, fs.readFileSync(mf, 'utf8').replace(/- 묶음: .*\n/, '- 묶음: a:b=쓰기\n'))
  assert.throws(() => owners.sameAccess({ groups: { 'a:b': 'write' } }, { all: 'none' }), /묶음 이름/)
  await s.hub.reconcileOwners()
  assert.doesNotMatch(fs.readFileSync(mf, 'utf8'), /a:b/)
})
