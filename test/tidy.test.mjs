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
import { copyDir, signIn, seat } from './helpers.mjs'

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
  // lee 는 보통 팀 사람 — 기본 자리가 「없음」 이 되어(권한 모델 v1.1) 쓰기 자리를 따로 준다
  await s.auth.addUser({ id: 'lee', admin: false })
  await seat(s, 'lee', { dpms: 'write', gdi: 'write' })
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

test('늦게 받은 옛 기록: 쓴 때로 받는다 · 그 전 정리로 「넣음」 이 되지 않는다 · 「지금 글보다 오래됨」 · 값을 되돌리지 못한다', async () => {
  // 앞 시험에서 헬스 체크에 넣은 「30초」 보다 앞서 쓴 기록을 이제야 보냈다
  const got = await s.hub.receive(LEE, 'dpms', { from: '내 PC', items: [{ title: '헬스 체크: 옛 간격', body: '헬스 체크 30초 → 10초', date: '2026-01-02 09:00' }] })
  assert.equal(got.saved, 1)
  const k0 = await s.hub.get('dpms')
  const o = k0.works.find((w) => w.title === '헬스 체크: 옛 간격')
  assert.equal(o.date, '2026-01-02 09:00', '받은 때가 아니라 쓴 때')
  assert.ok(o.tags.some((t) => t.startsWith('recv/')))
  assert.equal(o.state, 'pend', '그 전 정리보다 앞서 썼어도 받은 것은 뒤 · 아직 안 넣음')
  const { material, promptOf, check } = await import('../core/tidy.js')
  const g = material(k0, { ids: [o.id] }).find((x) => x.kind === 'section')
  assert.deepEqual([g.records[0].old, /지금 글보다 오래됨/.test(promptOf(g))], [true, true])
  // 검사 — 옛 기록의 값으로 바꾸면 막고 · 없던 글을 보태는 것은 된다(옛 기록의 값이 글에 없어도 된다)
  const back = g.content.replace(/30초/g, '10초')
  assert.match(check(k0, g, { content: back, used: [o.id], left: [], drop: ['30초'] }).why, /옛 기록은 값을 바꾸지 않는다/)
  assert.equal(check(k0, g, { content: g.content + ' 옛 메모.', used: [o.id], left: [] }).ok, true)
  await api('/api/k/dpms/tidy', { ids: [o.id] })
  const r = await workOnce({ server: s.url, key: wkey })
  const row = r.rows.find((x) => x.target.includes('헬스 체크'))
  assert.equal(row.kind, 'put')
  assert.match(fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '배포절차.md'), 'utf8'), /30초마다/)
})

test('여러 항목에 걸린 기록: 항목 하나에 기록의 값을 다 요구하지 않는다 · 묶음 답의 다른 항목 id 는 넘긴다 · 커밋 해시 · 기록 id 는 값이 아니다', async () => {
  const { material, promptOf, check, planSave } = await import('../core/tidy.js')
  const w = await s.hub.save(LEE, 'dpms', { record: { title: '롤백 · 헬스 체크 시간', body: '롤백 대기 `rb_wait` 5초. 헬스 체크 타임아웃 `hc_timeout` 90초. 커밋 092cc4a · 2026-1012-예전-기록.', touches: ['proc:롤백', 'proc:헬스 체크'] } })
  const one = await s.hub.save(LEE, 'dpms', { record: { title: '롤백 확인 횟수', body: '롤백 뒤 `rb_retry` 3번 본다. 커밋 092cc4a.', touches: ['proc:롤백'] } })
  const k = await s.hub.get('dpms')
  const gs = material(k, { ids: [w.id, one.id] }).filter((x) => x.kind === 'section')
  const g = gs.find((x) => x.heading.includes('롤백'))
  const rec = (id) => g.records.find((r) => r.id === id)
  assert.deepEqual([gs.length, rec(w.id).spread, rec(one.id).spread, /항목 여러 곳에 걸림/.test(promptOf(g))], [2, 2, undefined, true])
  // 여러 항목에 걸린 기록은 이 항목에 맞는 값만 옮겨도 넘는다(헬스 체크 값 · 해시 · 기록 id 는 요구하지 않는다) ·
  //   한 항목에만 걸린 기록은 값을 다 요구한다(해시 092cc4a 속 「092」 는 빼고) · 지어낸 값은 그대로 막는다
  const mine = g.content + '\n\n롤백 대기는 `rb_wait` 5초다. 롤백 뒤 `rb_retry` 3번 본다.'
  const ids = [w.id, one.id]
  assert.deepEqual(check(k, g, { content: mine, used: ids, left: [] }), { ok: true, changed: [] })
  assert.match(check(k, g, { content: mine.replace('3번', '여러 번'), used: ids, left: [] }).why, /기록의 값이 글에 없다: 3$/)
  assert.match(check(k, g, { content: mine + ' `zz_x` 7초.', used: ids, left: [] }).why, /근거에 없는 값/)
  // 묶음 답이 다른 항목의 기록 id 를 섞어도 이 항목 것만 본다 · 넣기도 이 항목의 기록만 둠으로
  const d = { content: mine, used: [...ids, 'x-다른-기록'], left: [{ id: 'y-다른-기록', why: '다른 항목' }] }
  assert.equal(check(k, g, d).ok, true)
  assert.deepEqual(planSave(k, g, d).record.curates, [])
  assert.match(check(k, g, { content: mine, used: ['x-다른-기록'], left: [] }).why, /받지 않은 기록을 말했다/)
})

test('서식대로 쓴 기록: 까닭 · 버린 안 · 근거의 값(날짜 · 판 · 커밋)은 글에 요구하지 않는다 · 꼭 옮길 값을 프롬프트에 적어 준다', async () => {
  const { material, promptOf, check, mustValues } = await import('../core/tidy.js')
  const body = '기다림 시간을 늘렸다.\n\n## 바뀐 것\n- 대기 표지: 아이콘 `wait_icon` 56px\n\n## 까닭\n- 사용자 지시, 2026-11-02\n\n## 버린 안\n- 40px: 작다\n\n## 영향\n- 재시도 3번 · 배포는 deploy-gw.ps1 [-Reset] 뒤 DB 127.0.0.1:55432\n\n## 근거\n- 설계서 v0.15 · 커밋 5c76aba'
  assert.deepEqual(mustValues(body).sort(), ['56px', 'wait_icon'], '영향(재시도 3번)은 요구하지 않는다(작성기준 7절)')
  const w = await s.hub.save(LEE, 'dpms', { record: { title: '대기 표지', body, touches: ['proc:매일 백업'] } })
  const k = await s.hub.get('dpms')
  const g = material(k, { ids: [w.id] }).find((x) => x.kind === 'section')
  assert.match(promptOf(g), /글에 꼭 옮길 값: 「(56px|wait_icon)」/)
  const mine = g.content + '\n\n대기 표지는 아이콘 `wait_icon` 56px 이다. 재시도는 3번이다.'
  assert.equal(check(k, g, { content: mine, used: [w.id], left: [] }).ok, true)
  assert.match(check(k, g, { content: mine.replace('56px', '큰'), used: [w.id], left: [] }).why, /기록의 값이 글에 없다: 56px$/)
  // 기록에 묶지 않고 쓴 값을 초안이 `…` 로 묶어도 근거의 값이다(188 「4. 구성 순서」 를 늘 「근거에 없는 값」 으로 두던 것) · 바꾼 값은 그대로 막는다
  const tick = mine + ' 배포는 `deploy-gw.ps1 [-Reset]` 뒤 DB `127.0.0.1:55432`.'
  assert.equal(check(k, g, { content: tick, used: [w.id], left: [] }).ok, true)
  assert.match(check(k, g, { content: tick.replace('`127.0.0.1:55432`', '`127.0.0.1:55433`'), used: [w.id], left: [] }).why, /근거에 없는 값이 있다: 127\.0\.0\.1:55433$/)
})

test('여러 항목에 걸린 기록: 넣은 항목은 다시 정리하지 않는다 · 바꿀 것이 없는 항목은 「넣음」 표지만 · 관련 항목 이름은 지어낸 값이 아니다', async () => {
  const { material, check, planSave } = await import('../core/tidy.js')
  const { save: coreSave } = await import('../core/save.js')
  const dir = path.join(tmp, 'kn', 'dpms')
  const w = await s.hub.save(LEE, 'dpms', { record: { title: '준비 · 꾸러미 판 메모', body: '배포 전에 `warm-cache` 를 돌린다.', touches: ['proc:준비', 'term:꾸러미 판'] } })
  let k = await s.hub.get('dpms')
  const gs = material(k, { ids: [w.id] }).filter((x) => x.kind === 'section')
  assert.equal(gs.length, 2)
  const ready = gs.find((g) => g.heading === '준비')
  // 준비 만 넣었다(꾸러미 판 묶음은 검사에서 걸렸다) — 기록은 아직 대기 · 다음 정리는 꾸러미 판 하나만
  const d1 = { content: ready.content + ' 배포 전에 `warm-cache` 를 돌린다.', used: [w.id], left: [] }
  assert.deepEqual(check(k, ready, d1), { ok: true, changed: [] })
  await coreSave(dir, planSave(k, ready, d1), { user: 'kmd-auto', system: true })
  s.hub.forget('dpms')
  k = await s.hub.get('dpms')
  assert.equal(k.byWork.get(w.id).state, 'pend')
  const rest = material(k, { ids: [w.id] }).filter((x) => x.kind === 'section')
  assert.deepEqual(rest.map((g) => g.heading), ['꾸러미 판'])
  // 같은 문서의 항목 머리를 가리키는 것은 지어낸 값이 아니다 · 없는 이름은 그대로 막는다
  const pk = rest[0]
  assert.equal(check(k, pk, { content: pk.content + '\n\n관련: `카나리`', used: [], left: [{ id: w.id, why: '판 표와 상관없다' }] }).ok, true)
  assert.match(check(k, pk, { content: pk.content + '\n\n관련: `없는항목`', used: [], left: [{ id: w.id, why: 'x' }] }).why, /근거에 없는 값/)
  // 이 항목에는 바꿀 것이 없다(left) — 두기(keep)가 아니라 이 항목에 넣음 표지 · 기록은 「넣음」
  const d2 = { content: pk.content, used: [], left: [{ id: w.id, why: '판 표와 상관없다' }] }
  assert.equal(check(k, pk, d2).ok, true)
  const plan = planSave(k, pk, d2)
  assert.deepEqual([plan.record.curates, plan.record.reflects], [[], [w.id]])
  await coreSave(dir, plan, { user: 'kmd-auto', system: true })
  s.hub.forget('dpms')
  k = await s.hub.get('dpms')
  assert.equal(k.byWork.get(w.id).state, 'in')
  assert.equal(material(k, { ids: [w.id] }).length, 0)
})

test('값 장부: 날짜는 값 하나 · 띄어 쓴 단위는 뒤에 한글이 없을 때만 · 「옛 → 새」 의 옛 값은 요구하지 않는다(188 둔 까닭 재현)', async () => {
  const { valuesOf } = await import('../core/save.js')
  const { mustValues, oldValues } = await import('../core/tidy.js')
  // 「### 4.2 개발 PC」 가 4.2개 로 읽혀 초안의 4.2 가 「근거에 없는 값」 이 되던 것 · 붙은 단위는 그대로 · 띄어 쓴 단위도 뒤에 한글이 없으면 붙는다
  assert.deepEqual([...valuesOf('### 4.2 개발 PC · 3개를 · 10분간 · 5 건 · 7 초 뒤')].sort(), ['10분', '3개', '4.2', '5건', '7초'])
  // 날짜는 쪼개지 않는다(「2026 · 02」 로 요구하던 것) · 56px 는 값 하나
  assert.deepEqual([...valuesOf('2026-11-02 에 56px 로')].sort(), ['2026-11-02', '56px'])
  // 식별자 속 수는 값이 아니다(188 DPA020: LS-201 · T920 · 03_계측기 를 늘 「값이 글에 없다」 로 두던 것)
  assert.deepEqual([...valuesOf('LS-201 · T920 · 03_계측기 · deploy-gw.ps1 · 1-2 · 127.0.0.1:5432 · 129°')].sort(), ['1', '127.0.0.1', '129', '2', '5432'])
  const body = '뷰어 자리를 옮겼다.\n\n## 바뀐 것\n- 뷰어: 개발 PC `127.0.0.1:18444` → 188 `127.0.0.1:18444`, SSH 터널로 본다\n- PLC 시뮬레이터 Modbus: 0.0.0.0 → 127.0.0.1\n- 표지 크기: 40px → 56px\n- 재시도: 3번\n\n## 까닭\n- 2026-11-02 지시'
  // 옛 값(0.0.0.0 · 40px)은 글에서 빠져야 할 값이라 요구하지 않는다 · 새 값과 화살표 없는 줄의 값은 요구한다
  assert.deepEqual(mustValues(body).sort(), ['127.0.0.1', '127.0.0.1:18444', '188', '3', '56px'])
  assert.deepEqual(oldValues(body).sort(), ['0.0.0.0', '40px'])
})

test('검사에 걸린 초안은 까닭을 붙여 한 번 고쳐 쓴다 · 그래도 걸리면 그대로 둔다 · 코드 울타리는 값 하나가 아니다', async () => {
  const { valuesOf } = await import('../core/save.js')
  assert.deepEqual([...valuesOf('`a` 이다.\n```\nx `b`\ny\n```\n끝 `c`')].sort(), ['a', 'b', 'c'])
  const w = await s.hub.save(LEE, 'dpms', { record: { title: '처음 10분 확인', body: '누락 고쳐쓰기: 첫 확인은 `first_chk` 7분.', touches: ['proc:처음 10분'] } })
  const bad = await s.hub.save(LEE, 'dpms', { record: { title: '되돌린 뒤 확인 메모', body: '누락 승인자는 `appr_lead` 2명.', touches: ['proc:되돌린 뒤 확인'] } })
  const before = callsN()
  await api('/api/k/dpms/tidy', { ids: [w.id, bad.id] })
  const r = await workOnce({ server: s.url, key: wkey, batch: 1 })
  const by = (t) => r.rows.find((x) => x.target.includes(t))
  assert.equal(by('처음 10분').kind, 'put')
  assert.match(by('되돌린 뒤 확인').why, /기록의 값이 글에 없다/)
  const log = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).slice(before)
  assert.equal(log.filter((l) => l === 'fix').length, 2, '자리마다 한 번씩만 고쳐 쓴다')
})

test('옛 글의 값은 기록이 바꾼 것만 빠진다: drop 없이 빠지면 까닭을 붙여 고쳐 쓰고 · 그래도 빠지면 둔다(작성기준 3절 5)', async () => {
  const { valuesOf } = await import('../core/save.js')
  const body = async () => (await s.hub.get('dpms')).byDocPath.get('docs/배포절차.md').sections.find((x) => x.h === '헬스 체크')?.body || ''
  const v = [...valuesOf(await body())][0]
  assert.ok(v, '헬스 체크 항목에 값이 있다')
  const once = await s.hub.save(LEE, 'dpms', { record: { title: '헬스 체크 공지 고쳐쓰기', body: `옛값빼기 ${v} 고쳐쓰기: 롤백 전에 공지한다.`, touches: ['proc:헬스 체크'] } })
  await api('/api/k/dpms/tidy', { ids: [once.id] })
  let r = await workOnce({ server: s.url, key: wkey, batch: 1 })
  assert.equal(r.rows.find((x) => x.target.includes('헬스 체크')).kind, 'put', '고쳐 쓰며 옛 값을 되살렸다')
  assert.ok((await body()).includes(v), '옛 값이 글에 남는다')
  const lose = await s.hub.save(LEE, 'dpms', { record: { title: '헬스 체크 공지 둘', body: `옛값빼기 ${v} 그리고 롤백 뒤에도 공지한다.`, touches: ['proc:헬스 체크'] } })
  await api('/api/k/dpms/tidy', { ids: [lose.id] })
  r = await workOnce({ server: s.url, key: wkey, batch: 1 })
  assert.match(r.rows.find((x) => x.target.includes('헬스 체크')).why, /옛 글의 값이 빠졌다/)
})

test('세 번 둔 기록: 지식관리자에게 「사람이 볼 것」 한 번 · 자동 정리에서 빠진다 · 손 정리는 된다', async () => {
  const rec = await s.hub.save(LEE, 'dpms', { record: { title: '복구 점검 지어낸 값', body: '지어낸 복구 칸을 더한다.', touches: ['proc:복구 점검'] } })
  for (let i = 0; i < 3; i++) {
    await api('/api/k/dpms/tidy', { ids: [rec.id] })
    const r = await workOnce({ server: s.url, key: wkey, batch: 1 })
    assert.equal(r.rows.find((x) => x.records?.includes(rec.id))?.kind, 'left', `${i + 1}번째도 둔다`)
  }
  const warn = (await s.hub.today({ user: 'kim', admin: true })).filter((x) => x.rec === rec.id && /세 번 넣지 못한/.test(x.text || ''))
  assert.equal(warn.length, 1, '알림은 한 번')
  const plan = (await api('/api/k/dpms/tidy/plan')).body
  assert.equal(plan.tries[rec.id], 3)
  assert.equal(plan.hold, 3)
  // 자동 정리 — 그 자리는 재료에 없다
  const j = await s.hub.tidyNow({ user: 'kmd', admin: true }, 'dpms', { by: 'kmd', auto: true })
  await workOnce({ server: s.url, key: wkey, batch: 1 })
  const done = s.hub.job(j.id)
  assert.ok(done.held >= 1, '뺀 자리 수를 남긴다')
  assert.ok(!(done.spots || []).some((x) => x.records.includes(rec.id)), '세 번 둔 기록의 자리는 자동 정리에서 빠진다')
})

test('조각 초안: 지금 글에 꼭 한 번 맞는 곳만 바꾼다 · 어긋나면 고쳐 쓴다 · 같은 검사(지어낸 값)를 거친다', async () => {
  const { applyEdits } = await import('../core/tidy.js')
  assert.deepEqual(applyEdits('가 나 다', { edits: [{ find: '나', replace: '라' }] }), { content: '가 라 다' })
  assert.match(applyEdits('가 나 나', { edits: [{ find: '나', replace: '라' }] }).why, /^조각이 지금 글에 맞지 않는다/)
  assert.match(applyEdits('가 나 다', { edits: [{ find: '마', replace: '라' }] }).why, /맞지 않는다/)
  assert.deepEqual(applyEdits('가', { edits: [], rewrite: '새 글' }), { content: '새 글' })
  assert.deepEqual(applyEdits('가', { edits: [] }), { content: '가' })
  process.env.KMD_TIDY_PATCH = 'all'
  try {
    const before = callsN()
    const put = await s.hub.save(LEE, 'dpms', { record: { title: '되돌리기 순서', body: '되돌리기는 `revert_app` 로 한다.', touches: ['proc:되돌리기'] } })
    const off = await s.hub.save(LEE, 'dpms', { record: { title: '대시보드 조각어긋남', body: '조각어긋남 대시보드는 `dash_main` 로 본다.', touches: ['screen:대시보드'] } })
    const bad = await s.hub.save(LEE, 'dpms', { record: { title: '보관 기간 지어낸', body: '지어낸 보관 기간은 `keep_days` 로 정한다.', touches: ['term:보관 기간'] } })
    await api('/api/k/dpms/tidy', { ids: [put.id, off.id, bad.id] })
    const r = await workOnce({ server: s.url, key: wkey, batch: 1 })
    const by = (t) => r.rows.find((x) => x.target.includes(t))
    assert.equal(by('되돌리기').kind, 'put', JSON.stringify(r.rows))
    assert.match((await s.hub.get('dpms')).byDocPath.get('docs/롤백절차.md').sections.find((x) => x.h === '되돌리기').body, /revert_app/)
    assert.equal(by('대시보드').kind, 'put', '어긋난 조각은 까닭을 붙여 한 번 고쳐 쓴다')
    const log = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).slice(before)
    assert.ok(log.includes('fix'))
    assert.match(by('보관 기간').why, /근거에 없는 값/, '조각도 지어낸 값 검사를 거친다')
  } finally {
    delete process.env.KMD_TIDY_PATCH
  }
})

test('A9 조각 묶음: 같은 문서 항목 둘을 claude 한 번에 조각으로 · 자리마다 지금 글에 대어 넣는다', async () => {
  process.env.KMD_TIDY_PATCH = 'all'
  try {
    const before = callsN()
    const a = await s.hub.save(LEE, 'dpms', { record: { title: '되돌리기 묶음조각', body: '되돌리기 묶음은 `revert_batch` 로 한다.', touches: ['proc:되돌리기'] } })
    const b = await s.hub.save(LEE, 'dpms', { record: { title: '되돌린 뒤 확인 묶음조각', body: '되돌린 뒤 묶음 확인은 `check_batch` 로 본다.', touches: ['proc:되돌린 뒤 확인'] } })
    await api('/api/k/dpms/tidy', { ids: [a.id, b.id] })
    const r = await workOnce({ server: s.url, key: wkey })
    const log = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).slice(before)
    assert.ok(log.includes('bpatch'), log.join(' '))
    const secs = (await s.hub.get('dpms')).byDocPath.get('docs/롤백절차.md').sections
    assert.match(secs.find((x) => x.h === '되돌리기').body, /revert_batch/, JSON.stringify(r.rows))
    // 둘째 자리 — 앞 시험이 남긴 반영 대기 기록과 같이 정리돼 값 검사로 둘 수 있다. 조각이 어긋나서 둔 것은 아니어야 한다
    const second = r.rows.find((x) => x.target.includes('되돌린 뒤 확인'))
    assert.ok(second, JSON.stringify(r.rows))
    if (second.kind === 'put') assert.match(secs.find((x) => x.h === '되돌린 뒤 확인').body, /check_batch/)
    else assert.doesNotMatch(second.why, /조각|모양/, second.why)
  } finally {
    delete process.env.KMD_TIDY_PATCH
  }
})

test('꼭 옮길 값은 「바뀐 것」 칸만: 요약 · 영향의 경위(「187 에 배포했다」)는 요구하지 않는다(188 DPA020 · 11-03)', async () => {
  const { mustValues } = await import('../core/tidy.js')
  const body = '보기를 셋으로 줄이고 187 에 배포했다.\n\n## 바뀐 것\n- 기준 표고: 18.30\n\n## 까닭\n- 2026-11-02 지시\n\n## 영향\n- 187 은 -ResetDb 로 새 배치(T920)를 넣었다'
  assert.deepEqual(mustValues(body), ['18.30'])
  assert.deepEqual(mustValues('서식 없는 기록: 포트 5432 · 30초'), ['5432', '30초'], '서식이 아니면 글 전체')
})
