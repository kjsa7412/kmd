// 종합 검토 「따로 할 것」 — 안정성(Q55 · Q59) · 응답 크기(Q71 서버 쪽).
//
// Q55 깨진 _sources.json 은 던진다 · 더하기는 거절되고 원래 파일이 그대로 · 고치기는 지식마다 한 줄 안에서 · 멈춤 줄에 경고
// Q59 writeJsonAtomic — 겹쳐 써도 파일은 늘 온전한 JSON · 임시 파일이 남지 않는다 · 자격 지우기도 원자적
// Q71 /api/k/:k/tree 의 기록은 최근 limit + more + next(?before=) · /api/logs 는 지식마다 최근 limit · ?before= · ?days=

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { writeJsonAtomic } from '../core/atomic.js'
import { readDecl, editDecl, DECL } from '../core/sources.js'
import { setSecret, delSecret, listSecrets } from '../core/secrets.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, root, s
const P = {}
const req = async (p, who) => {
  const r = await fetch(s.url + p, { headers: { authorization: `Bearer ${who.key}` } })
  return { status: r.status, j: await r.json().catch(() => null) }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-stab-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  root = path.join(tmp, 'kn')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  P.boss = await signIn(s, { id: 'boss', admin: true })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('Q59 writeJsonAtomic: 50번 겹쳐 써도 온전한 JSON 하나 · 임시 파일이 남지 않는다', async () => {
  const dir = path.join(tmp, 'atomic')
  const f = path.join(dir, 'a.json')
  const vals = Array.from({ length: 50 }, (_, i) => ({ i, pad: 'x'.repeat(2000 + i) }))
  await Promise.all(vals.map((v) => writeJsonAtomic(f, v)))
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  assert.ok(vals.some((v) => v.i === j.i && v.pad === j.pad))
  assert.deepEqual(fs.readdirSync(dir), ['a.json'])
  await writeJsonAtomic(f, [1], { indent: 1, nl: true })
  assert.equal(fs.readFileSync(f, 'utf8'), '[\n 1\n]\n')
})

test('Q59 자격: 겹친 넣기가 서로를 지우지 않는다 · 지우기도 임시 파일 뒤 이름 바꾸기', async () => {
  const dir = path.join(tmp, 'sec')
  await Promise.all(Array.from({ length: 20 }, (_, i) => setSecret(dir, `s${i}`, `v${i}`)))
  assert.equal((await listSecrets(dir)).length, 20)
  await Promise.all([delSecret(dir, 's0'), delSecret(dir, 's1'), setSecret(dir, 'z', '1')])
  const names = (await listSecrets(dir)).map((x) => x.name)
  assert.equal(names.length, 19)
  assert.ok(!names.includes('s0') && !names.includes('s1') && names.includes('z'))
  assert.deepEqual(fs.readdirSync(dir), ['secrets.json'])
})

test('Q55 장부: 깨지면 던진다 · 더하기는 거절되고 파일은 그대로 · 멈춤 줄에 경고 · 가져오기 목록은 그 지식만 건너뛴다', async () => {
  const kdir = path.join(root, 'dpms')
  const f = path.join(kdir, DECL)
  const bad = '[{"name": "a", "kind": "git"'
  fs.writeFileSync(f, bad)
  await assert.rejects(readDecl(kdir), (e) => e.code === 'E_INPUT' && e.declBroken && /가져올 곳 장부가 깨졌다/.test(e.message))
  await assert.rejects(s.hub.sourceAdd(SHELL, 'dpms', { name: '새 곳', kind: 'git', at: 'https://example.com/x.git' }), (e) => e.code === 'E_INPUT' && /장부가 깨졌다/.test(e.message))
  await assert.rejects(editDecl(kdir, (cur) => [...cur, { name: 'b' }], { user: 'boss', title: 't' }), /장부가 깨졌다/)
  assert.equal(fs.readFileSync(f, 'utf8'), bad, '깨진 장부 위에 덮어쓰지 않는다')
  // 목록이 아닌 JSON 도 깨진 것
  fs.writeFileSync(f, '{"name":"a"}')
  await assert.rejects(readDecl(kdir), /목록이 아니다/)
  fs.writeFileSync(f, bad)
  const st = await req('/api/stops', P.boss)
  assert.equal(st.status, 200)
  assert.ok(JSON.stringify(st.j).includes('가져올 곳 장부가 깨졌다'), '멈춤 줄에 경고')
  const src = await req('/api/sources', P.boss)
  assert.equal(src.status, 200, '한 지식의 깨진 장부로 가져오기 화면 전체가 넘어지지 않는다')
  fs.rmSync(f)
  assert.deepEqual(await readDecl(kdir), [], '없으면 빈 목록')
})

test('Q55 장부: 고치기 둘이 겹쳐도 앞의 것이 사라지지 않는다(지식마다 한 줄 안에서 읽기 · 고치기 · 쓰기)', async () => {
  const kdir = path.join(tmp, 'decl')
  fs.mkdirSync(kdir, { recursive: true })
  await Promise.all(Array.from({ length: 5 }, (_, i) => editDecl(kdir, (cur) => [...cur, { name: `s${i}`, kind: 'git' }], { user: 'kim', title: `더함 ${i}` })))
  assert.deepEqual((await readDecl(kdir)).map((x) => x.name).sort(), ['s0', 's1', 's2', 's3', 's4'])
  // 같은 이름 — 한 줄 안의 검사가 막는다
  await assert.rejects(editDecl(kdir, (cur) => { if (cur.some((x) => x.name === 's0')) throw Object.assign(new Error('같은 이름'), { code: 'E_CONFLICT' }); return cur }, { user: 'kim', title: 't' }), /같은 이름/)
  assert.ok(!fs.readdirSync(kdir).some((n) => n.endsWith('.tmp')))
})

test('Q71 tree: 기록은 최근 limit · more · next 로 이어 받는다 · 문서 목록은 그대로 · all=1 은 예전처럼', async () => {
  const full = (await req('/api/k/dpms/tree?all=1', P.boss)).j
  const n = full.records.length
  assert.ok(n >= 6, `기록이 여섯 이상(${n})`)
  assert.equal(full.total, n)
  assert.equal(full.more, 0)
  const p1 = (await req('/api/k/dpms/tree?limit=3', P.boss)).j
  assert.deepEqual(p1.docs, full.docs, '문서 목록은 그대로')
  assert.deepEqual(p1.records.slice(0, 3).map((r) => r.id), full.records.slice(0, 3).map((r) => r.id))
  // 첫 쪽에 덧붙는 것은 옛 것 가운데 아직 넣지 않은 기록뿐
  for (const r of p1.records.slice(3)) assert.ok(r.state === 'pend' || r.state === 'nowhere', r.state)
  assert.equal(p1.total, n)
  assert.equal(p1.more, n - 3)
  assert.equal(p1.next, `${full.records[2].date}|${full.records[2].id}`)
  // 다음 쪽 — next 그대로 · 기록 id 로도 같은 쪽
  const p2 = (await req(`/api/k/dpms/tree?limit=3&before=${encodeURIComponent(p1.next)}`, P.boss)).j
  assert.deepEqual(p2.records.map((r) => r.id), full.records.slice(3, 6).map((r) => r.id))
  assert.equal(p2.more, n - 6)
  const p2b = (await req(`/api/k/dpms/tree?limit=3&before=${encodeURIComponent(full.records[2].id)}`, P.boss)).j
  assert.deepEqual(p2b.records.map((r) => r.id), p2.records.map((r) => r.id))
  // 기본 200 — 이 지식은 그보다 적어 모두 · more 0 · next null
  const d = (await req('/api/k/dpms/tree', P.boss)).j
  assert.equal(d.records.length, n)
  assert.equal(d.more, 0)
  assert.equal(d.next, null)
})

test('Q71 logs: 지식마다 최근 limit · more · next · ?before= · ?days=', async () => {
  // 이력(log/) 둘 — 가져오는 곳 장부 고치기가 남긴다
  const kdir = path.join(root, 'gdi')
  await editDecl(kdir, (cur) => [...cur, { name: 'l1', kind: 'git' }], { user: 'boss', title: '가져오는 곳 더함: l1' })
  await editDecl(kdir, (cur) => [...cur, { name: 'l2', kind: 'git' }], { user: 'boss', title: '가져오는 곳 더함: l2' })
  s.hub.forget?.('gdi')
  const all = (await req('/api/logs', P.boss)).j
  assert.ok(all.items.length >= 2, `이력 ${all.items.length}`)
  assert.equal(all.more, 0)
  assert.equal(all.next, null)
  const one = (await req('/api/logs?limit=1', P.boss)).j
  assert.equal(one.items.length, 1)
  assert.equal(one.more, all.items.length - 1)
  assert.equal(one.next, `${all.items[0].date}|${all.items[0].id}`)
  const rest = (await req(`/api/logs?before=${encodeURIComponent(one.next)}`, P.boss)).j
  assert.deepEqual(rest.items.map((x) => x.id), all.items.slice(1).map((x) => x.id))
  assert.equal((await req('/api/logs?before=1999-01-01', P.boss)).j.items.length, 0)
  assert.equal((await req('/api/logs?days=1', P.boss)).j.items.length, all.items.length, '오늘 남긴 것은 최근 하루 안')
})
