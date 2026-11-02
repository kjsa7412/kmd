// 정리 화면(절차) — 정리 계획 · 고른 것만 정리(일반은 자기 기록만) · 정리 일 줄의 자리 · 사람이 자리 정하기

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { workOnce } from '../core/worker.js'
import { copyDir, signIn, seat } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, park, wkey
const api = async (who, p, body) => {
  const r = await fetch(s.url + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json().catch(() => null) }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-tp-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, tidyTickMs: 3600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  await signIn(s, { id: 'kim' })
  park = await signIn(s, { id: 'park', admin: false })
  await signIn(s, { id: 'lee', admin: false })
  // 기본 자리는 없음 — 서버가 선 뒤 만든 사람이라 옮김도 없다. 보통 팀원(쓰기)으로 자리를 준다
  await seat(s, 'park', { dpms: 'write' })
  await seat(s, 'lee', { dpms: 'write' })
  wkey = (await s.auth.workerAdd()).key
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('계획 · 일반은 자기 기록만 정리 · 정리 일 줄의 자리 · 자리 정하기', async () => {
  const lee = await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '카나리 비율', body: '첫 30분 요청 10% → 20%', touches: ['proc:카나리'] } })
  const mine = await s.hub.save({ user: 'park' }, 'dpms', { record: { title: '롤백 순서', body: '앱 먼저, 그다음 DB', touches: ['proc:롤백'] } })
  const memo = await s.hub.save({ user: 'park' }, 'dpms', { record: { title: '점검 공지', body: '다음 주 점검 공지를 돌린다' } })
  // 들어온 길이 기록 줄에 실린다
  assert.equal((await api(park, '/api/k/dpms/tree')).body.records.find((r) => r.id === mine.id).route, 'sess')
  // 계획 — 자리마다 모이는 기록
  const plan = (await api(park, '/api/k/dpms/tidy/plan')).body
  assert.ok(plan.spots.some((x) => x.target.endsWith('카나리') && x.records.includes(lee.id)))
  // 일반(park) — 남의 기록을 골라도 자기 것만
  const job = (await api(park, '/api/k/dpms/tidy', { ids: [lee.id, mine.id] })).body
  assert.ok(job.ids.includes(mine.id) && !job.ids.includes(lee.id), '남의 기록은 같은 자리일 때만 같이')
  await workOnce({ server: s.url, key: wkey })
  const done = (await api(park, '/api/job/' + job.id)).body
  assert.equal(done.spots.length, 1)
  assert.equal(done.spots[0].st, 'done', JSON.stringify(done.spots[0]))
  assert.ok(done.spots[0].lines.some((l) => l[1] === 'tool'), '일꾼이 글 쓰기를 알렸다')
  assert.equal((await s.hub.get('dpms')).byWork.get(lee.id).state, 'pend', '남의 기록은 그대로')
  // 자리 정하기 — 쓴 사람만 · 정하면 그 항목을 기다린다
  assert.equal((await api(park, `/api/k/dpms/rec/${lee.id}/touches`, { coord: 'proc:롤백' })).status, 403)
  assert.equal((await api(park, `/api/k/dpms/rec/${memo.id}/touches`, { coord: 'proc:롤백' })).status, 200)
  const w = (await s.hub.get('dpms')).byWork.get(memo.id)
  assert.deepEqual([w.state, w.touches], ['pend', ['proc:롤백']])
})

test('도는 정리 그만두기: 일꾼이 다음 자리에서 멈춘다 · 쓰지 않은 기록은 받은 것에 그대로 · 일감은 그만둠', async () => {
  const a = await s.hub.save({ user: 'park' }, 'dpms', { record: { title: '배포 창', body: '화요일 저녁', touches: ['proc:카나리'] } })
  const b = await s.hub.save({ user: 'park' }, 'dpms', { record: { title: '롤백 기준', body: '오류율 2%', touches: ['proc:롤백'] } })
  const job = (await api(park, '/api/k/dpms/tidy', { ids: [a.id, b.id] })).body
  // 일꾼이 맡은 뒤(재료를 받은 때) 사람이 그만두기
  const orig = globalThis.fetch
  let asked = null
  globalThis.fetch = async (u, o) => {
    const r = await orig(u, o)
    if (!asked && String(u).includes('/worker/material')) asked = await api(park, `/api/queue/t:${job.id}/cancel`, {})
    return r
  }
  try {
    await workOnce({ server: s.url, key: wkey, log: () => {} })
  } finally {
    globalThis.fetch = orig
  }
  assert.equal(asked.status, 200)
  assert.equal(asked.body.stopping, true, '도는 정리는 멈추는 중으로')
  const st = (await api(park, '/api/job/' + job.id)).body
  assert.equal(st.state, 'cancelled', st.why)
  assert.match(st.why, /그만뒀다: park/)
  assert.ok(st.spots.length >= 2 && st.spots.every((x) => x.st === 'stop'), JSON.stringify(st.spots.map((x) => x.st)))
  const k = await s.hub.get('dpms')
  assert.deepEqual([k.byWork.get(a.id).state, k.byWork.get(b.id).state], ['pend', 'pend'], '쓰지 않은 기록은 받은 것에 그대로')
  // 끝난 정리는 다시 그만둘 수 없다
  assert.equal((await api(park, `/api/queue/t:${job.id}/cancel`, {})).status, 409)
})

test('정리 장부가 깨졌으면 빈 것으로 읽어 덮지 않는다: 옆으로 옮기고 새로 쓴다', async () => {
  const f = path.join(tmp, 'kn', '.kmd', 'tidy', 'dpms.json')
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, '[{"at": "2026-11-01T00:00:00Z", "rows": [')
  assert.deepEqual(await s.hub.runs('dpms'), [], '읽기는 빈 것(보이기만)')
  assert.ok(fs.existsSync(f), '읽기는 파일을 건드리지 않는다')
  await s.hub.save({ user: 'park' }, 'dpms', { record: { title: '장부 깨짐 뒤 정리', body: '롤백은 앱 먼저', touches: ['proc:롤백'] } })
  await api(park, '/api/k/dpms/tidy', {})
  await workOnce({ server: s.url, key: wkey })
  const aside = fs.readdirSync(path.dirname(f)).filter((x) => x.startsWith('dpms.json.broken-'))
  assert.equal(aside.length, 1, '깨진 장부는 옆에 남는다')
  assert.equal(fs.readFileSync(path.join(path.dirname(f), aside[0]), 'utf8'), '[{"at": "2026-11-01T00:00:00Z", "rows": [')
  assert.ok(Array.isArray(JSON.parse(fs.readFileSync(f, 'utf8'))), '새 장부')
})

test('쓰는 동안 소식: 쓴 글 · 생각 글자 수 · 지난 시간이 자리에 온다 · 화면 일감에는 일꾼 · 임대 · 일감 범위가 없다 · 비용은 지식관리자만', async () => {
  process.env.FAKE_CLAUDE_STREAM_MS = '900'
  process.env.KMD_TIDY_TICK_MS = '100'
  try {
    const rec = await s.hub.save({ user: 'park' }, 'dpms', { record: { title: '카나리 소식', body: '카나리 비율은 첫 30분 10%', touches: ['proc:카나리'] } })
    const job = (await api(park, '/api/k/dpms/tidy', { ids: [rec.id] })).body
    const seen = []
    const w = workOnce({ server: s.url, key: wkey })
    for (let i = 0; i < 40 && seen.length < 2; i++) {
      await new Promise((ok) => setTimeout(ok, 50))
      const sp = s.hub.job(job.id)?.spots?.find((x) => x.st === 'run' && x.out > 0)
      if (sp) seen.push({ out: sp.out, think: sp.think, runMs: sp.runMs })
    }
    await w
    assert.ok(seen.length, '쓰는 중에 쓴 글 수가 왔다')
    assert.ok(seen[0].think > 0 && seen[0].runMs > 0)
    const mine = (await api(park, '/api/job/' + job.id)).body
    assert.equal(mine.worker, undefined)
    assert.equal(mine.leaseUntil, undefined)
    assert.equal(mine.ids, undefined)
    assert.equal(mine.picked, 1)
    assert.ok(mine.spots.every((x) => x.cost === undefined), '쓰기 자리는 비용을 보지 않는다')
    assert.ok(mine.spots[0].name && !mine.spots[0].name.includes('docs/'), '문서 제목으로 부른다: ' + mine.spots[0].name)
  } finally {
    delete process.env.FAKE_CLAUDE_STREAM_MS
    delete process.env.KMD_TIDY_TICK_MS
  }
})

test('묶음은 다시 쓸 글 합 3천 자까지 · 큰 항목은 혼자', async () => {
  const { batchesOf } = await import('../core/tidy.js')
  const g = (h, n) => ({ kind: 'section', doc: 'docs/a.md', heading: h, content: 'x'.repeat(n), records: [{ id: h, title: h, body: '' }] })
  const b = batchesOf([g('큰', 3500), g('작1', 1000), g('작2', 1500), g('작3', 1000)])
  assert.deepEqual(b.map((x) => x.map((y) => y.heading)), [['큰'], ['작1', '작2'], ['작3']])
})
