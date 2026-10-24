// 정리하는 길 — 팀 지식은 팀 서버의 정리 전용 로그인(일꾼) + 지식마다 정리 방식(정해진 시각 · 실시간 · 손으로만),
// 팀 서버의 개인 지식은 그 사람 PC 프로그램의 일꾼이 그 사람의 Claude 로 곧바로(운영자 결정 2026-10-24).
//
// 개인 지식 일감은 주인의 PC 일꾼만 받는다(팀 일꾼 · 남의 PC 일꾼은 못 받는다) · PC 일꾼을 본 적 없는 사람은 규칙으로 곧바로 ·
// 팀 서버 프로세스는 Claude 를 부르지 않는다 · 실시간은 조용해진 뒤 한 번 · 손으로만은 넣은 파일에도 일감을 걸지 않는다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { workOnce } from '../core/worker.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, teamKey, calls
const KIM = { user: 'kim' }
const LEE = { user: 'lee' }
const callsN = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).length : 0)
const until = async (f, ms = 30_000) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 200)) } return true }
const myWorker = async (user) => {
  const dk = await s.auth.deviceKeyFor(user, { host: `${user}-PC`, osuser: user })
  const r = await fetch(s.url + '/api/me/worker', { method: 'POST', headers: { authorization: `Bearer ${dk}`, 'content-type': 'application/json' }, body: '{}' })
  assert.equal(r.status, 200)
  return (await r.json()).key
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-private-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  calls = path.join(tmp, 'calls.log')
  process.env.FAKE_CLAUDE_LOG = calls
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, tidyTickMs: 3600000, liveQuietMs: 8000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  await signIn(s, { id: 'kim' })
  await signIn(s, { id: 'lee', admin: false })
  teamKey = (await s.auth.workerAdd()).key
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('개인 지식 — 주인의 PC 일꾼(그 사람의 Claude)만 받는다 · 팀 일꾼 · 남의 일꾼은 못 받는다 · PC 일꾼이 없는 사람은 규칙으로 곧바로', async () => {
  const kimKey = await myWorker('kim')
  const leeKey = await myWorker('lee')
  const { id } = await s.hub.addKnowledge(KIM, { kind: 'new', name: '김메모' })
  const state = async (k, rid) => (s.hub.forget(k), (await s.hub.get(k)).byWork.get(rid)?.state)
  // kim 의 PC 일꾼이 한 번 물었다(켜져 있다)
  assert.equal(await workOnce({ server: s.url, key: kimKey }), null)
  await new Promise((r) => setTimeout(r, 300))

  const a = await s.hub.save(KIM, id, { record: { title: '당번 — 이번 주', body: '이번 주 당번은 박.' } })
  assert.ok(await until(() => s.hub.jobsOf(id).some((j) => j.state === 'queued')), '정해진 시각을 기다리지 않고 곧바로 일감')
  const n0 = callsN()
  assert.equal(await workOnce({ server: s.url, key: teamKey }), null, '팀의 정리 전용 로그인으로는 나가지 않는다')
  assert.equal(await workOnce({ server: s.url, key: leeKey }), null, '남의 PC 일꾼은 못 받는다')
  assert.equal(callsN(), n0)
  const r = await workOnce({ server: s.url, key: kimKey })
  assert.equal(r.job.kn, id)
  assert.ok(callsN() > n0, '주인의 PC 일꾼이 그 사람의 Claude 로')
  assert.ok(await until(async () => (await state(id, a.id)) === 'in'), '기록은 넣음')

  // park 은 PC 일꾼을 띄운 적이 없다(브라우저만) — 규칙으로 곧바로(파일 이름이 아니라 갈래 · 주제)
  const { id: lid } = await s.hub.addKnowledge({ user: 'park' }, { kind: 'new', name: '박메모' })
  const n1 = callsN()
  const b = await s.hub.save({ user: 'park' }, lid, { record: { title: '2026-10-21 HNC 통화 — 메모', body: '납기는 11-02.' } })
  assert.ok(await until(async () => (await state(lid, b.id)) === 'in'), '규칙으로 문서에')
  assert.equal(callsN(), n1, '팀 서버 프로세스는 Claude 를 부르지 않는다')
  assert.ok(fs.existsSync(path.join(tmp, 'kn', lid, 'docs', '회의록.md')))
  // 이은 PC 의 기기 열쇠가 아니면 일꾼 열쇠를 주지 않는다
  assert.equal((await fetch(s.url + '/api/me/worker', { method: 'POST', headers: { authorization: `Bearer ${teamKey}` } })).status, 403)
})

test('팀 지식의 정리 방식 — 정해진 시각(저장해도 기다림) · 실시간(조용해진 뒤 한 번) · 손으로만(넣은 파일에도 일감 없음)', async () => {
  const jobs = () => s.hub.jobsOf('dpms').filter((j) => j.state === 'queued').length
  await s.hub.save(LEE, 'dpms', { record: { title: '알람 — 채널', body: '받는 곳에 #ops 도.' } })
  await new Promise((r) => setTimeout(r, 1500))
  assert.equal(jobs(), 0, '정해진 시각 — 저장은 기다린다')
  await assert.rejects(s.hub.setOwner(SHELL, 'dpms', { tidyMode: 'often' }), { code: 'E_INPUT' })
  await s.hub.setOwner(SHELL, 'dpms', { tidyMode: 'live' })
  assert.equal((await (await fetch(s.url + '/api/k/dpms/tidy', { headers: { authorization: `Bearer ${await s.auth.deviceKeyFor('kim', { host: 'K' })}` } })).json()).tidyMode, 'live')
  const t0 = Date.now()
  await s.hub.save(LEE, 'dpms', { record: { title: '알람 — 채널 둘', body: '#ops-oncall 도.' } })
  await s.hub.save(LEE, 'dpms', { record: { title: '알람 — 채널 셋', body: '#ops-db 도.' } })
  if (Date.now() - t0 < 6000) assert.equal(jobs(), 0, '조용해지기 전') // 이 PC 의 느린 git 으로 저장이 늦으면 건너뛴다
  assert.ok(await until(() => jobs() === 1, 30_000), '조용해진 뒤 한 번')
  for (const j of s.hub.jobsOf('dpms')) j.state = 'done'
  await s.hub.setOwner(SHELL, 'dpms', { tidyMode: 'manual' })
  await s.hub.importFiles({ user: 'kim', admin: true }, 'dpms', [{ path: '회의.md', data: Buffer.from('## 정한 것\n배포 창은 화 · 목.\n') }])
  await new Promise((r) => setTimeout(r, 1500))
  assert.equal(jobs(), 0, '손으로만 — 넣은 파일에도 일감을 걸지 않는다')
})
