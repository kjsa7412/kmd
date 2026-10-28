// E5 필수 — 정리 일꾼(가짜 claude). 검사를 넘으면 승인 없이 바로 넣는다(KM81).
//
// [지금 정리] → 넣음 · 값 바뀜(그 기록을 쓴 사람에게 노랑) · 지어낸 값 · 빠진 값 · 머리 주입 → 그대로 둠 · 이름 바로잡기 ·
// 「Claude 에 보내지 않음」 → claude 0 번 · 초안 전용 열쇠로 save → 403 · 되돌리면 원 기록이 다시 대기 · 로그인 끝 → 멈춤 줄.

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
let tmp, s, me, wkey, calls
const LEE = { user: 'lee' }
const callsN = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).length : 0)
const api = async (p, body, auth = { cookie: me.cookie }) => {
  const r = await fetch(s.url + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...auth }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json().catch(() => null) }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-e5-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  calls = path.join(tmp, 'calls.log')
  process.env.FAKE_CLAUDE_LOG = calls
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, tidyTickMs: 3600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  me = await signIn(s, { id: 'kim' })
  wkey = (await s.auth.workerAdd()).key
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

let caRow
test('[지금 정리]: 넣음 · 값 바뀜 · 그대로 둠(지어낸 값 · 빠진 값 · 머리) · 이름 바로잡기', async () => {
  const a = await s.hub.save(LEE, 'dpms', { record: { title: '카나리 비율', body: '첫 30분 요청 10% → 20%', touches: ['proc:카나리'] } })
  await s.hub.save(LEE, 'dpms', { record: { title: '준비 메모', body: '지어낸 값이 섞인다.', touches: ['proc:준비'] } })
  await s.hub.save(LEE, 'dpms', { record: { title: 'VPN 메모', body: '누락 OTP 6자리 필수.', touches: ['term:VPN'] } })
  await s.hub.save(LEE, 'dpms', { record: { title: '복구 메모', body: '주입: 매주 월요일 복구 점검.', touches: ['proc:복구 점검'] } })
  const e = await s.hub.save(LEE, 'dpms', { record: { title: '연락 순서: 최 를 더한다', body: '당번 다음에 최에게도 알린다.' } })
  const job = (await api('/api/k/dpms/tidy', {})).body
  assert.equal(job.state, 'queued')
  const r = await workOnce({ server: s.url, key: wkey })
  const by = (t) => r.rows.find((x) => x.target.includes(t))
  assert.equal(by('롤백').kind, 'put')
  caRow = by('카나리')
  assert.equal(caRow.kind, 'changed')
  assert.match(caRow.from, /10%/)
  assert.match(caRow.to, /20%/)
  assert.match(by('준비').why, /근거에 없는 값/)
  assert.match(by('VPN').why, /기록의 값이 글에 없다/)
  assert.match(by('복구 점검').why, /머리/)
  assert.equal(by('연락 순서').kind, 'touches')
  // 문서 · 상태
  assert.match(fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '배포절차.md'), 'utf8'), /요청의 20% 만/)
  const k = await s.hub.get('dpms')
  assert.equal(k.byWork.get(a.id).state, 'in')
  const cur = k.byWork.get(caRow.record)
  assert.equal(cur.author, 'kmd-auto')
  assert.ok(cur.tags.includes('curate-llm'))
  assert.deepEqual(k.byWork.get(e.id).touches, ['proc:연락 순서'], '이름 바로잡음. 원 기록의 이름을 그것으로 읽는다')
  assert.equal(k.byWork.get(e.id).state, 'pend')
  // 값이 바뀐 것은 그 기록을 쓴 사람(lee)의 오늘 바뀐 것에 노랑
  const feedLee = await s.hub.today(LEE)
  assert.ok(feedLee.some((x) => x.yl && /10% → .*20%/.test(x.b)))
  // 이력 — 같은 일은 한 줄: lee 에게는 되돌리기가 있는 내 줄이 그 정리의 이력 줄을 대신한다 · 다른 사람에게는 이력 줄
  const hl = await s.hub.history(LEE)
  const yl = hl.find((x) => x.yl && x.revert)
  assert.equal(yl.kind, '정리')
  assert.ok(yl.rec && !hl.some((x) => x.id.startsWith('l:') && x.rec === yl.rec), '같은 일은 한 줄')
  const hk = await s.hub.history({ user: 'kim', admin: true })
  assert.ok(hk.some((x) => x.id.startsWith('l:') && x.rec === yl.rec && x.kind === '정리'))
  assert.equal((await s.hub.job(job.id)).state, 'done')
})

test('되돌리기: 원 기록이 다시 대기 · 다음 정리에서 다시 넣지 않는다', async () => {
  await s.hub.revert({ user: 'kim', admin: true }, 'dpms', { record: caRow.record })
  const k = await s.hub.get('dpms')
  const a = k.works.find((w) => w.title === '카나리 비율')
  assert.equal(a.state, 'pend')
  assert.ok(k.reverted.has(a.id))
  assert.match(fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '배포절차.md'), 'utf8'), /요청의 10% 만/)
  await api('/api/k/dpms/tidy', {})
  const r = await workOnce({ server: s.url, key: wkey })
  assert.ok(!r.rows.some((x) => x.target.includes('카나리')), '되돌린 기록은 다시 초안하지 않는다')
})

test('초안 전용 열쇠로는 쓰지 못한다 · 「Claude 에 보내지 않음」 이면 claude 0 번', async () => {
  await api('/api/k/dpms/tidy', {})
  const n = (await api('/api/worker/next', {}, { authorization: `Bearer ${wkey}` })).body
  assert.match(n.key, /^kmdd_/)
  const bad = await api('/api/k/dpms/save', { record: { title: 'x', body: 'y' } }, { authorization: `Bearer ${n.key}` })
  assert.equal(bad.status, 403)
  assert.equal((await api('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${n.key}` })).status, 403)
  await api('/api/k/dpms/worker/drafts', { drafts: [] }, { authorization: `Bearer ${n.key}` })

  await s.hub.setOwner(SHELL, 'gdi', { noClaude: true })
  await s.hub.save({ user: 'kim', admin: true }, 'gdi', { record: { title: '어디 넣을지 모르는 메모', body: '작업 순번을 늘린다.' } })
  const c0 = callsN()
  // 일꾼에게 내지 않고 서버가 규칙으로 넣는다(전에는 빈 초안 · 「정리했다 — 0건」 만 쌓였다)
  const j = await s.hub.tidyNow({ user: 'kim', admin: true }, 'gdi')
  assert.equal(j.rule, true)
  assert.match(j.why, /자동 정리에 Claude 를 쓰지 않는 지식: 규칙으로/)
  await s.hub.curateIdle('gdi')
  assert.equal(s.hub.job(j.id).state, 'done')
  assert.ok(!(await s.hub.get('gdi')).works.some((w) => w.title === '어디 넣을지 모르는 메모' && w.state === 'pend'), '규칙으로 들어갔다')
  assert.equal(await workOnce({ server: s.url, key: wkey }), null, '일꾼에게는 일감이 없다')
  assert.equal(callsN(), c0, 'claude 를 부르지 않았다')
  await s.hub.setOwner(SHELL, 'gdi', { noClaude: false })
})

test('로그인이 끝나면 멈춘다. 「자동 정리가 쉬고 있다」 · 관리자에게 길', async () => {
  process.env.FAKE_CLAUDE_MODE = 'logout'
  try {
    await s.hub.save(LEE, 'dpms', { record: { title: '점검 시간', body: '정기 점검은 매달 첫 토요일 01:00 ~ 03:00.', touches: ['term:점검 시간'] } })
    await api('/api/k/dpms/tidy', {})
    const r = await workOnce({ server: s.url, key: wkey })
    assert.ok(r.rows.every((x) => x.kind === 'left'))
    const st = await s.hub.stops({ user: 'kim', admin: true })
    assert.ok(st.some((l) => l.kind === 'worker' && /자동 정리가 쉬고 있다/.test(l.text) && /Claude 연결/.test(l.text)))
    // 기록만 하는 사람에게도 — 쉬는 동안은 규칙으로 넣는다(고칠 길은 관리자에게)
    const st2 = await s.hub.stops({ user: 'lee' })
    assert.ok(st2.some((l) => l.kind === 'worker' && /그동안은 규칙으로 넣는다/.test(l.text) && !/Claude 연결/.test(l.text)))
    // 모든 묶음이 로그인 끝으로 끝난 일감은 「정리했다 — 0건」 이 아니라 failed · 까닭
    const last = s.hub.jobsOf('dpms').filter((x) => !x.rule).pop()
    assert.deepEqual([last.state, /로그인이 끝났다/.test(last.why)], ['failed', true])
    // 쉬는 동안 [지금 정리] 는 일꾼에게 내지 않고 규칙으로
    const j2 = await s.hub.tidyNow({ user: 'kim', admin: true }, 'dpms')
    assert.equal(j2.rule, true)
    await s.hub.curateIdle('dpms')
    // 둔 자리는 글 쓰기에서 멈춘 것 — 검사 줄을 적지 않는다(초안이 없다)
    const sp = last.spots.find((x) => x.st === 'left')
    assert.deepEqual([sp.stage, sp.lines.some((l) => l[0] === 3)], [2, false])
    // 다시 로그인하면(번호 받음) 쉼이 파일 · 메모리에서 같이 걷혀 다음 [지금 정리] 는 일꾼에게 간다
    await s.hub.workerClear()
    assert.equal(s.hub.ruleOnly('dpms'), false)
  } finally {
    delete process.env.FAKE_CLAUDE_MODE
  }
})

test('한 문서의 항목은 claude 한 번에: 묶음 답을 자리마다 넣는다 · 묶음 답에 빠진 자리는 따로 한 번 더', async () => {
  const a = await s.hub.save(LEE, 'dpms', { record: { title: '헬스 체크 간격', body: '헬스 체크는 30초마다 본다.', touches: ['proc:헬스 체크'] } })
  const b = await s.hub.save(LEE, 'dpms', { record: { title: '롤백 확인', body: '롤백 뒤 헬스 체크를 2번 본다 묶음빠짐.', touches: ['proc:롤백'] } })
  const job = (await api('/api/k/dpms/tidy', { ids: [a.id, b.id] })).body
  fs.rmSync(calls, { force: true })
  const r = await workOnce({ server: s.url, key: wkey })
  const log = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean)
  assert.deepEqual([log.filter((l) => l === 'batch').length, log.filter((l) => l.startsWith('call')).length], [1, 2], '묶음 한 번 + 빠진 자리 한 번')
  assert.deepEqual(r.rows.map((x) => x.kind).sort(), ['put', 'put'])
  const k = await s.hub.get('dpms')
  assert.deepEqual([k.byWork.get(a.id).state, k.byWork.get(b.id).state], ['in', 'in'])
  assert.equal(s.hub.job(job.id).state, 'done')
})
