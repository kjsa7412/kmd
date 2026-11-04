// 넣지 못함(S10 · K8 · K10-3 · docs/품질개선/KMD_개편_설계.md 4-8 · S-D24 ~ S-D26 · S-D42 · S-D46 · S-D51)
//
// 목록은 held 태그 기록 + 팀의 「개편 전 기록」(옛 pend · nowhere 사람 기록) · 지식관리자는 모두 · 쓰기 자리는 내 것만 · 읽기 자리 미만은 404 ·
// [다시 들이기] → 들이기 일감 again(같은 기록 두 번 → 일감 하나) → 넘으면 fixes 새 기록 · 원 기록 바로잡힘 · 넣지 못함 알림 ·
// [버리기] → 버림 결정 기록(log/ · 이력 「버림」) · 원 기록 kept · [이름 세우기] → 장부에 이름 · 원 기록 바로잡힘 ·
// [옛 기록 다시 들이기] 는 개편 전 기록만 · 두 번 눌러도 일감이 늘지 않음 · 넣을 곳 고르기(touches-fix)만으로는 목록에서 빠지지 않음 · GET 이면 405

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { workOnce } from '../core/worker.js'
import * as V from '../server/views.js'
import { copyDir, seat, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, wk, lee, park, choi
const KIM = { user: 'kim', admin: true }
const LEE = { user: 'lee' }
const PARK = { user: 'park' }
const LEGACY = '2026-1023-롤백-순서' // 픽스처의 「개편 전 기록」(김 · pend)
const fresh = async () => { s.hub.forget?.('dpms'); return s.hub.get('dpms') }
const code = async (p) => p.then(() => 'ok', (e) => e.code)
const work = () => workOnce({ server: s.url, key: wk })
const env = (k, v, f) => async () => { const old = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; try { return await f() } finally { if (old == null) delete process.env[k]; else process.env[k] = old } }
const api = (u, p, method = 'GET', body) => fetch(`${s.url}${p}`, { method, headers: { cookie: u.cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
// lee 가 연 파일 들이기를 팀 일꾼이 세 번 지어도 지어낸 값(badall) → 기록만 + 넣지 못함(values)
async function heldByLee(n) {
  const old = process.env.FAKE_CLAUDE_MODE
  process.env.FAKE_CLAUDE_MODE = 'badall'
  try {
    const o = await s.hub.openJob('dpms', { type: 'file', by: 'lee', src: { rel: `운영문서/${n}.md`, sha: n.padEnd(16, 'a').replace(/[^0-9a-f]/g, 'a').slice(0, 16), title: `${n}.md` }, md: `# ${n}\n\n## ${n} 순서\n먼저 끈다. 30초 기다린다.\n` })
    assert.equal(o.state, 'queued', JSON.stringify(o))
    await work()
    const j = s.hub.job(o.job)
    assert.equal(j.result.held, 1, JSON.stringify(j))
    return j.result.rec
  } finally { if (old == null) delete process.env.FAKE_CLAUDE_MODE; else process.env.FAKE_CLAUDE_MODE = old }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-held-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sourceTickMs: 3600000, inboxTickMs: 3600000, jobTickMs: 3600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  await s.auth.addUser({ id: 'kim', admin: true })
  lee = await signIn(s, { id: 'lee', admin: false })
  park = await signIn(s, { id: 'park', admin: false })
  choi = await signIn(s, { id: 'choi', admin: false })
  await seat(s, 'lee', { dpms: 'write' })
  await seat(s, 'park', { dpms: 'read' })
  wk = (await s.auth.workerAdd()).key
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

let r1
test('목록: 지식관리자는 모두(넣지 못함 + 개편 전) · 쓰기 자리는 내 것만 · 읽기 자리는 빈 목록 · 자리 없음 404 · 넣지 못함 알림', async () => {
  r1 = await heldByLee('밤점검')
  assert.ok(fs.existsSync(path.join(tmp, 'kn', '.kmd', 'held', 'dpms', `${r1}.md`)), '원천을 남겼다')
  const all = await s.hub.heldList(KIM, 'dpms')
  assert.ok(all.admin)
  const mine = all.rows.find((x) => x.rec === r1)
  assert.ok(mine, JSON.stringify(all.rows.map((x) => x.rec)))
  assert.equal(mine.author, 'lee')
  assert.equal(mine.parts[0].code, 'values')
  assert.ok(all.rows.find((x) => x.rec === LEGACY)?.legacy, '개편 전 기록')
  assert.equal(all.legacy, 1)
  assert.equal(all.held, all.rows.length - 1)
  const l = await s.hub.heldList(LEE, 'dpms')
  assert.deepEqual(l.rows.map((x) => x.rec), [r1], '쓰기 자리는 내 것만')
  assert.equal((await s.hub.heldList(PARK, 'dpms')).rows.length, 0)
  // 길 — 읽기 자리는 200(빈 목록) · 자리 없음은 404 · 지식 목록 줄의 수
  assert.equal((await api(park, '/api/k/dpms/held')).status, 200)
  assert.equal((await api(choi, '/api/k/dpms/held')).status, 404)
  const row = (await (await api(lee, '/api/knowledge')).json()).find((k) => k.id === 'dpms')
  assert.equal(row.heldMine, 1)
  // 넣지 못함 알림(만든 사람) · 이력 갈래 「넣지 못함」
  const h = await s.hub.history(LEE)
  assert.ok(h.some((x) => x.kind === '넣지 못함' && x.rec === r1), JSON.stringify(h.slice(0, 5)))
  // 항목 · 나무 — 볼 수 있는 것만
  const k = await fresh()
  const tr = V.tree(k, { team: true, user: 'park', admin: false })
  assert.ok(!tr.docs.some((d) => d.held), '읽기 자리에게는 남의 넣지 못함 점이 없다')
})

test('다시 들이기: 같은 기록 두 번 → 일감 하나 · 읽기 자리 403 · 남의 기록은 지식관리자 · 넘으면 fixes 새 기록 · 원 기록 바로잡힘', async () => {
  const a = await s.hub.heldAgain(LEE, 'dpms', r1)
  assert.equal(a.state, 'queued', JSON.stringify(a))
  const b = await s.hub.heldAgain(LEE, 'dpms', r1)
  assert.equal(b.job, a.job)
  assert.ok(b.again)
  assert.equal(await code(s.hub.heldAgain(PARK, 'dpms', r1)), 'E_FORBIDDEN')
  assert.equal(await code(s.hub.heldAgain(LEE, 'dpms', LEGACY)), 'E_FORBIDDEN', '남의 기록')
  // 목록에 열린 일감이 보인다
  assert.equal((await s.hub.heldList(LEE, 'dpms')).rows[0].job?.id, a.job)
  // GET 이면 405
  assert.equal((await api(lee, `/api/k/dpms/held/${encodeURIComponent(r1)}/again`)).status, 405)
  assert.equal((await api(lee, '/api/k/dpms/held/again-all')).status, 405)
  await work()
  const j = s.hub.job(a.job)
  assert.equal(j.state, 'done', JSON.stringify(j))
  assert.equal(j.result.held, 0, JSON.stringify(j))
  const k = await fresh()
  const w = k.byWork.get(j.result.rec)
  assert.deepEqual(w.fixes, [r1])
  assert.equal(k.byWork.get(r1).state, 'fixed')
  assert.ok(!(await s.hub.heldList(KIM, 'dpms')).rows.some((x) => x.rec === r1))
})

test('버리기: 지식관리자만 · 버림 결정 기록(log/ · 이력 「버림」) · 원 기록 kept', async () => {
  const r = await heldByLee('새벽점검')
  assert.equal(await code(s.hub.heldDrop(LEE, 'dpms', r, '안 쓴다')), 'E_FORBIDDEN')
  const res = await api(lee, `/api/k/dpms/held/${encodeURIComponent(r)}/drop`, 'POST', { why: '안 쓴다' })
  assert.equal(res.status, 403)
  const d = await s.hub.heldDrop(KIM, 'dpms', r, '다른 문서에 이미 있다')
  assert.ok(d.ok)
  const k = await fresh()
  assert.equal(k.byWork.get(r).state, 'kept')
  const log = k.logs.find((x) => x.id === d.record)
  assert.ok(log && log.tags.includes('drop'), '이력(log/)')
  assert.equal(V.logKind(log), '버림')
  assert.match(log.title, /^버림: /)
  assert.ok(!fs.existsSync(path.join(tmp, 'kn', '.kmd', 'held', 'dpms', `${r}.md`)), '버린 원천은 걷는다')
  assert.ok(!(await s.hub.heldList(KIM, 'dpms')).rows.some((x) => x.rec === r))
  // 몸 검사 — why 는 한 줄
  const bad = await fetch(`${s.url}/api/k/dpms/held/${encodeURIComponent(LEGACY)}/drop`, { method: 'POST', headers: { cookie: lee.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ why: '두\n줄' }) })
  assert.equal(bad.status, 400)
})

test('이름 세우기: 쓰기 자리의 장부 밖 이름(넣지 못함 names) → 지식관리자가 세운다 · 원 기록 바로잡힘', async () => {
  const r = await s.hub.save(LEE, 'dpms', { record: { title: '캐시 만료 이름', body: '## 바뀐 것\n- 캐시만료: 새 이름' }, names: [{ coord: 'term:캐시만료', label: '캐시만료' }] })
  const k0 = await fresh()
  assert.equal(k0.byWork.get(r.id).state, 'held', JSON.stringify(r))
  const row = (await s.hub.heldList(KIM, 'dpms')).rows.find((x) => x.rec === r.id)
  assert.ok(row?.names, JSON.stringify(row))
  assert.equal(await code(s.hub.heldNames(LEE, 'dpms', r.id)), 'E_FORBIDDEN')
  const n = await s.hub.heldNames(KIM, 'dpms', r.id)
  assert.equal(n.names, 1)
  const k = await fresh()
  assert.ok(k.vocab.coords.has('term:캐시만료'), '장부에 이름')
  assert.equal(k.byWork.get(r.id).state, 'fixed')
  // 세울 이름이 없는 기록 · 없는 기록
  assert.equal(await code(s.hub.heldNames(KIM, 'dpms', LEGACY)), 'E_INPUT')
  assert.equal(await code(s.hub.heldNames(KIM, 'dpms', '2026-1017-카나리')), 'E_NOTFOUND')
})

test('넣을 곳 고르기(touches-fix)만으로는 목록에서 빠지지 않는다 · 길은 POST 만', async () => {
  assert.equal((await api(lee, `/api/k/dpms/rec/${encodeURIComponent(LEGACY)}/touches`)).status, 405)
  await s.hub.setTouches(KIM, 'dpms', LEGACY, 'proc:롤백')
  assert.ok((await s.hub.heldList(KIM, 'dpms')).rows.some((x) => x.rec === LEGACY && x.legacy))
})

test('옛 기록 다시 들이기: 지식관리자만 · 개편 전 기록만 · 두 번 눌러도 일감이 늘지 않음 · 못 넘으면 새 넣지 못함이 맡는다', async () => {
  assert.equal((await api(lee, '/api/k/dpms/held/again-all', 'POST', {})).status, 403)
  const a = await s.hub.heldAgainAll(KIM, 'dpms')
  assert.deepEqual([a.jobs, a.open], [1, 0], JSON.stringify(a))
  const b = await s.hub.heldAgainAll(KIM, 'dpms')
  assert.deepEqual([b.jobs, b.open], [0, 1], JSON.stringify(b))
  assert.equal(s.hub.intakesOf('dpms').filter((j) => j.type === 'again' && j.state === 'queued').length, 1)
  await work()
  const k = await fresh()
  const list = await s.hub.heldList(KIM, 'dpms')
  assert.equal(list.legacy, 0, '넘겨받은 옛 기록은 개편 전에서 빠진다')
  const nw = k.works.find((w) => w.fixes.includes(LEGACY) && w.tags.includes('intake'))
  assert.ok(nw, '다시 들인 기록')
  if (nw.state === 'held') assert.ok(list.rows.some((x) => x.rec === nw.id), '못 넘은 새 기록이 목록에 남는다')
  else assert.equal(k.byWork.get(LEGACY).state, 'fixed')
  const c = await s.hub.heldAgainAll(KIM, 'dpms')
  assert.deepEqual([c.jobs, c.open], [0, 0])
})
