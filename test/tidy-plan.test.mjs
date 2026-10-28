// 정리 화면(절차) — 정리 계획 · 고른 것만 정리(일반은 자기 기록만) · 정리 일 줄의 자리 · 사람이 자리 정하기

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { workOnce } from '../core/worker.js'
import { copyDir, signIn } from './helpers.mjs'

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
