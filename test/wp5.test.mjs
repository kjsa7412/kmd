// WP5 필수 — 멈추지 않는 일(제품화 검토 v0.1 F-002 · F-023 · F-024 · F-006 · F-007 · F-008 · F-046 · G1-3 · G4-6 · F-043 · F-005 · F-053).
//
// 보내기 — 닿지 않음(저절로 다시)과 거절(사람이 [다시] · [버리기])을 가르고 · 대기 하나가 다른 보내기를 막지 않고 ·
// 거절이면 보낸 것으로 표시하지 않고 · 받는 쪽에 없는 지식은 정할 때 막고 · 보낼 곳을 바꾸면 대기도 따라가고 · 크면 나눠 보낸다.
// 정리 일감 — 맡은 일감은 임대가 지나면 다시 기다림(세 번째면 failed · 까닭) · 다시 켜도 남는다 · 일꾼이 묻지 않으면 멈춤 줄 ·
// 팀 서버의 개인 지식은 두 번째 일감도 「하루 뒤 규칙으로」 · 남은 .git/index.lock 은 치운다 · 실패하는 가져오는 곳은 주기를 지킨다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { git } from '../core/git.js'
import * as sendLib from '../core/send.js'
import { sourceLines } from '../core/sources.js'
import { copyDir } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KIM = { user: 'kim', admin: true }
let tmp, root, data, s
const code = (p) => p.then(() => 'ok', (e) => e.code)
const until = async (f, ms = 10_000) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 50)) } return true }

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-wp5-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  root = path.join(tmp, 'kn')
  data = path.join(root, '.kmd')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  fs.mkdirSync(data, { recursive: true })
  fs.writeFileSync(path.join(data, 'serve.json'), JSON.stringify({ decideMs: 3600000, tidyTickMs: 3600000, sendTickMs: 3600000, jobLeaseMs: 300, privateWaitMs: 2000 }))
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  await s.hub.addKnowledge(KIM, { kind: 'new', name: '노트', team: true })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('보내기 — 정할 때 받는 쪽을 본다 · 닿지 않음과 거절을 가른다 · 거절은 보낸 것으로 표시하지 않는다 · [다시] · [버리기] · 대기를 따라 바꾼다', async () => {
  assert.equal(await code(s.hub.sendDests(KIM, '노트', [{ kn: '없는지식' }])), 'E_INPUT')
  assert.equal(await code(s.hub.sendDests(KIM, '노트', [{ kn: '노트' }])), 'E_INPUT')
  await s.hub.sendDests(KIM, '노트', [{ kn: 'dpms' }])
  // 받는 쪽이 거절(지운 지식) — 같은 kmd 의 오류도 거절로
  await s.hub.edit(KIM, '노트', { doc: '처음', sections: [{ h: '개요', body: '첫 글 — 하나.' }] })
  fs.renameSync(path.join(root, 'dpms'), path.join(tmp, 'dpms-away'))
  s.hub.forget()
  const r = await s.hub.send(KIM, '노트')
  assert.deepEqual([r.sent, r.wait, r.fail], [0, 0, 1])
  assert.equal((await s.hub.sendQueue(KIM, '노트')).items.length, 1, '보낸 것으로 표시하지 않는다 — 다시 고를 수 있다')
  const q = await s.hub.sendQueue(KIM, '노트')
  assert.equal(q.wait[0].state, 'fail')
  assert.match(q.wait[0].fix, /팀에 그 지식이 없다/)
  assert.ok((await s.hub.stops(KIM)).some((l) => l.kind === 'send' && /보내지 못했다/.test(l.b)))
  // 분마다 다시 보내기는 거절된 것을 건드리지 않는다 · [다시] 는 고친 뒤 보낸다
  assert.equal(await s.hub.sendRetry(), 0)
  fs.renameSync(path.join(tmp, 'dpms-away'), path.join(root, 'dpms'))
  s.hub.forget()
  assert.equal((await s.hub.sendWaitAct(KIM, '노트', { wid: q.wait[0].id, act: 'retry' })).sent, 1)
  assert.equal((await s.hub.sendQueue(KIM, '노트')).wait.length, 0)
  // 닿지 않는 다른 kmd — 기다림(저절로) · 다른 보내기를 막지 않는다 · 보낼 곳을 바꾸면 대기의 주소도 · 빼면 걷는다
  await s.hub.sendDests(KIM, '노트', [{ kn: 'dpms', url: 'http://127.0.0.1:9' }])
  await s.hub.edit(KIM, '노트', { doc: '처음', sections: [{ h: '개요', body: '첫 글 — 둘.' }] })
  const w = await s.hub.send(KIM, '노트')
  assert.deepEqual([w.sent, w.wait], [0, 1])
  let st = await sendLib.readState(data, '노트')
  assert.equal(st.wait[0].state, 'wait')
  await s.hub.sendDests(KIM, '노트', [{ kn: 'dpms', url: 'http://127.0.0.1:10' }])
  st = await sendLib.readState(data, '노트')
  assert.equal(st.wait[0].to.url, 'http://127.0.0.1:10')
  await s.hub.sendDests(KIM, '노트', [{ kn: 'gdi' }])
  assert.equal((await sendLib.readState(data, '노트')).wait.length, 0, '뺀 보낼 곳의 대기는 걷는다')
  // [버리기]
  fs.renameSync(path.join(root, 'gdi'), path.join(tmp, 'gdi-away'))
  s.hub.forget()
  await s.hub.edit(KIM, '노트', { doc: '처음', sections: [{ h: '개요', body: '첫 글 — 셋.' }] })
  await s.hub.send(KIM, '노트')
  const f = (await s.hub.sendQueue(KIM, '노트')).wait[0]
  assert.equal((await s.hub.sendWaitAct(KIM, '노트', { wid: f.id, act: 'drop' })).dropped, 1)
  fs.renameSync(path.join(tmp, 'gdi-away'), path.join(root, 'gdi'))
  s.hub.forget()
})

test('보내기 — 크면 나눠 보낸다(받는 쪽 200 개 상한) · 시간 제한은 묶음 크기에 맞춘다 · 거절의 까닭을 서버 모양에서 읽는다', async () => {
  const items = Array.from({ length: 320 }, (_, i) => ({ title: `t${i}`, body: 'x'.repeat(10), sha: String(i).padStart(16, '0') }))
  assert.deepEqual(sendLib.chunks(items).map((c) => c.length), [150, 150, 20])
  assert.deepEqual(sendLib.chunks([{ body: 'y'.repeat(4 << 20) }, { body: 'y'.repeat(4 << 20) }]).map((c) => c.length), [1, 1])
  // 다른 kmd 의 거절 — { error: 'E_NOTFOUND', message } 모양에서 까닭을 읽는다(전에는 「HTTP 404」)
  const e = await sendLib.post(s.url, '없는지식', { from: 'x', items: [{ title: 'a', body: 'b' }] }, 'kmdk_wrongkey0000').catch((x) => x)
  assert.equal(e.status, 401)
  assert.equal(e.reach, true)
  assert.doesNotMatch(e.message, /^HTTP/)
  const off = await sendLib.post('http://127.0.0.1:9', 'dpms', { items: [] }, null).catch((x) => x)
  assert.equal(off.reach, false)
})

test('정리 일감 — 임대가 지나면 다시 기다림 · 세 번째면 failed · 옛 일꾼의 초안은 받지 않는다 · 다시 켜도 남는다', async () => {
  const wk = (await s.auth.workerAdd()).key
  const wctx = s.auth.bearer(wk)
  await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '헬스 체크 — 주기', body: '주기 15초', touches: ['proc:헬스 체크'] } })
  const j = await s.hub.tidyNow(KIM, 'dpms')
  assert.equal(j.state, 'queued')
  const n1 = s.hub.workerNext(wctx)
  assert.equal(n1.job.id, j.id)
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(s.hub.job(j.id).state, 'queued', '임대가 지나 다시 기다림')
  assert.equal(s.hub.draftCtx(n1.key), null, '옛 일꾼의 열쇠는 이제 쓰지 못한다')
  s.hub.workerNext(wctx)
  await new Promise((r) => setTimeout(r, 400))
  s.hub.workerNext(wctx)
  await new Promise((r) => setTimeout(r, 400))
  const jj = s.hub.job(j.id)
  assert.deepEqual([jj.state, /세 번/.test(jj.why)], ['failed', true])
  // 다시 켜도 기다리던 일감이 남는다(맡았던 것은 기다림으로)
  const j2 = await s.hub.tidyNow(KIM, 'dpms')
  await new Promise((r) => setTimeout(r, 100))
  await s.close()
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  assert.equal(s.hub.job(j2.id)?.state, 'queued')
  // 일꾼이 묻지 않는다 — 10분 넘게 기다린 팀 정리 → 관리자에게 멈춤 줄
  s.hub.job(j2.id).at = new Date(Date.now() - 11 * 60_000).toISOString()
  assert.ok((await s.hub.stops(KIM)).some((l) => l.kind === 'worker' && /정리 일꾼이 일감을 받지 않는다/.test(l.b) && /한 번도 묻지 않았다/.test(l.text)))
  s.hub.workerNext(s.auth.bearer(wk))
  assert.ok(!(await s.hub.stops(KIM)).some((l) => /정리 일꾼이 일감을 받지 않는다/.test(l.b)))
})

test('팀 서버의 개인 지식 — 두 번째 일감도 하루 뒤 규칙으로 · 기다리는 동안 주인에게 줄 · [지금 정리] 는 규칙으로', async () => {
  await s.hub.addKnowledge({ user: 'park', admin: true }, { kind: 'new', name: '메모' })
  const id = '메모-park'
  await s.auth.addUser({ id: 'park' })
  const dk = await s.auth.deviceKeyFor('park', { host: 'P' })
  const pw = await s.auth.workerAdd({ owner: 'park', device: s.auth.bearer(dk).device })
  const pctx = s.auth.bearer(pw.key)
  s.hub.workerNext(pctx) // 이 PC 일꾼을 봤다(7일 안)
  const save = (t) => s.hub.save({ user: 'park' }, id, { record: { title: t, body: t } })
  await save('첫 메모 — 하나')
  await until(() => s.hub.jobsOf(id).some((j) => j.state === 'queued'))
  const a = s.hub.workerNext(pctx)
  assert.ok(a, 'PC 일꾼이 첫 일감을 받았다')
  await s.hub.workerStatus(pctx, { ok: false, reason: 'login' }) // 받고 넘어졌다 → 규칙으로
  await save('둘째 메모 — 둘')
  await until(() => s.hub.jobsOf(id).some((j) => j.state === 'queued'))
  assert.ok((await s.hub.stops({ user: 'park' })).some((l) => /내 PC 일꾼을 기다린다/.test(l.b)))
  // 두 번째 일감도 「하루」(시험은 2초) 뒤 규칙으로 — 전에는 시계를 다시 걸지 않아 7일까지 기다렸다
  assert.ok(await until(() => s.hub.jobsOf(id).filter((j) => j.state === 'queued').length === 0, 15000))
  await s.hub.curateIdle(id)
  assert.ok(!(await s.hub.get(id)).works.some((w) => w.title === '둘째 메모 — 둘' && w.state === 'pend'))
  // [지금 정리] — 기다리는 일감이 있으면 규칙으로 곧바로
  await save('셋째 메모 — 셋')
  await until(() => s.hub.jobsOf(id).some((j) => j.state === 'queued'))
  const r = await s.hub.tidyNow({ user: 'park' }, id)
  assert.equal(r.rule, true)
  await s.hub.curateIdle(id)
  assert.ok(!(await s.hub.get(id)).works.some((w) => w.title === '셋째 메모 — 셋' && w.state === 'pend'))
})

test('남은 .git/index.lock — 오래된 것은 치우고 저장한다 · 막 생긴 것은 기다렸다가 쉬운 말로', async () => {
  const lock = path.join(root, 'dpms', '.git', 'index.lock')
  fs.writeFileSync(lock, '')
  const old = new Date(Date.now() - 60_000)
  fs.utimesSync(lock, old, old)
  await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '잠금 — 뒤', body: '꺼진 kmd 가 남긴 잠금' } })
  assert.ok(!fs.existsSync(lock))
  fs.writeFileSync(lock, '')
  const e = await git(path.join(root, 'dpms'), ['add', '--', 'README.md']).catch((x) => x)
  assert.equal(e.code, 'E_BUSY')
  assert.match(e.message, /다른 일이 쓰고 있다/)
  fs.rmSync(lock)
})

test('실패하는 가져오는 곳 — 해 본 때를 남겨 주기를 지킨다 · 처음부터 실패하면 두 번째부터 줄', () => {
  const k = { id: 'dpms' }
  const decl = [{ name: '회의록', every: 'hourly' }]
  assert.deepEqual(sourceLines(k, decl, { 회의록: { failures: 1, triedAt: new Date().toISOString(), lastNote: '닿지 않는다' } }), [])
  const l = sourceLines(k, decl, { 회의록: { failures: 2, triedAt: new Date().toISOString(), lastNote: '닿지 않는다' } }, { admin: true })
  assert.equal(l.length, 1)
  assert.match(l[0].b, /아직 한 번도 가져오지 못했다 · 2번/)
})

test('설치 — 팀 설치가 정리 일꾼도 늘 켠다(kmd-worker.service · 열쇠는 root 만 읽는 파일)', () => {
  const sh = fs.readFileSync(path.join(HERE, '..', 'scripts', 'kmd-install.sh'), 'utf8')
  assert.match(sh, /kmd-worker\.service/)
  assert.match(sh, /EnvironmentFile=\/etc\/kmd\/worker\.env/)
  assert.match(sh, /umask 077/)
  assert.match(sh, /systemctl enable kmd-worker/)
})
