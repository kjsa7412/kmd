// 팀 일꾼(core/worker.js) — claude 동시 호출 상한 · 지난 일꾼 폴더 걷기 · 서버는 들이기 일감만 낸다(개편 S13 · 옛 tidy-plan.test 에서 옮김)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { slots, sweepProjects, polishFixPromptOf } from '../core/worker.js'
import { makeHub } from '../server/hub.js'
import { copyDir } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

test('claude 동시 호출 상한: 셋이 받으면 넷째는 하나가 돌려줄 때까지 기다린다', async () => {
  const g = slots(3)
  await g.take(); await g.take(); await g.take()
  let fourth = false
  const p = g.take().then(() => (fourth = true))
  await new Promise((ok) => setTimeout(ok, 20))
  assert.equal(fourth, false)
  g.give()
  await p
  assert.equal(fourth, true)
})

test('지난 일꾼 폴더: 하루 지난 「kmd-worker-」 · 「kmd-agent-」 만 걷는다', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-home-'))
  const pj = path.join(home, '.claude', 'projects')
  for (const x of ['C--tmp-kmd-worker-old', 'C--tmp-kmd-agent-old', 'C--tmp-kmd-worker-new', 'C--project-kmd']) fs.mkdirSync(path.join(pj, x), { recursive: true })
  const old = (Date.now() - 2 * 864e5) / 1000
  fs.utimesSync(path.join(pj, 'C--tmp-kmd-worker-old'), old, old)
  fs.utimesSync(path.join(pj, 'C--tmp-kmd-agent-old'), old, old)
  fs.utimesSync(path.join(pj, 'C--project-kmd'), old, old)
  const cfg = process.env.CLAUDE_CONFIG_DIR
  delete process.env.CLAUDE_CONFIG_DIR
  try { assert.equal(sweepProjects({ home }), 2) } finally { if (cfg) process.env.CLAUDE_CONFIG_DIR = cfg }
  assert.deepEqual(fs.readdirSync(pj).sort(), ['C--project-kmd', 'C--tmp-kmd-worker-new'])
  fs.rmSync(home, { recursive: true, force: true })
})

test('켤 때: 일감이 없으면 일꾼에게 줄 것이 없다 · 개편 때(cutover.json)는 적지 않는다(P12)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-wk-'))
  try {
    copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
    const data = path.join(tmp, 'kn', '.kmd')
    fs.mkdirSync(data, { recursive: true })
    fs.writeFileSync(path.join(data, 'serve.json'), JSON.stringify({ decideMs: 3600000, sourceTickMs: 3600000, sendTickMs: 3600000, jobTickMs: 3600000, queueResumeMs: 3600000 }))
    fs.writeFileSync(path.join(data, 'jobs.json'), '[]')
    const hub = await makeHub({ root: path.join(tmp, 'kn'), dataDir: data, mode: 'team', log: () => {} })
    await hub.start()
    try {
      assert.equal(hub.workerNext({ worker: { id: 'w-test' } }), null, '들이기 일감이 없으면 일감이 없다')
      assert.ok(!fs.existsSync(path.join(data, 'cutover.json')), '개편 때는 걷었다(P12)')
    } finally { hub.stop() }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
  }
})

test('켤 때: 풀지 못한 장부(jobs · 하루 들이기 수 · 하루 첨부 합)는 .broken-<때> 로 비켜 두고 빈 것으로 시작한다(깨진 파일을 덮지 않는다)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-wk-'))
  try {
    copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
    const data = path.join(tmp, 'kn', '.kmd')
    fs.mkdirSync(data, { recursive: true })
    fs.writeFileSync(path.join(data, 'serve.json'), JSON.stringify({ decideMs: 3600000, sourceTickMs: 3600000, sendTickMs: 3600000, jobTickMs: 3600000, queueResumeMs: 3600000 }))
    const bad = { 'jobs.json': '[{"id":"aaaaaaaaaaaa", 깨짐', 'intake-day.json': '{"dpms":', 'attach-day.json': 'xx' }
    for (const [f, t] of Object.entries(bad)) fs.writeFileSync(path.join(data, f), t)
    const logs = []
    const hub = await makeHub({ root: path.join(tmp, 'kn'), dataDir: data, mode: 'team', log: (...a) => logs.push(a.join(' ')) })
    await hub.start()
    hub.stop()
    const names = fs.readdirSync(data)
    for (const [f, t] of Object.entries(bad)) {
      const aside = names.find((n) => n.startsWith(`${f}.broken-`))
      assert.ok(aside, `${f} 를 비켜 두었다`)
      assert.equal(fs.readFileSync(path.join(data, aside), 'utf8'), t, '원래 바이트 그대로')
    }
    assert.ok(logs.some((l) => /비켜 두고/.test(l)))
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
  }
})

// ── Claude 짜임(바탕 세우기 Z6 · 설계 7-3) — 팀 일감 shape-plan · shape-write · 가짜 Claude(KMD_CLAUDE) · 개인 프로그램 claude -p ──
const ZFILES = {
  'README.md': '# ops\n',
  'docs/배포 절차.md': '# 배포 절차\n\n## 배포 창\n화요일 10:00.\n\n## 사전 점검\n디스크 80% 확인.\n\n## 사후 점검\n헬스 체크 3회.\n',
  'docs/장애 대응.md': '# 장애 대응\n\n## 롤백\n이전 판으로 5분 안에.\n\n## 연락\n당번에게.\n',
}
const zEnv = async (mode, fn) => {
  const keep = { KMD_CLAUDE: process.env.KMD_CLAUDE, FAKE_CLAUDE_MODE: process.env.FAKE_CLAUDE_MODE, FAKE_CLAUDE_LOG: process.env.FAKE_CLAUDE_LOG }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-z6-'))
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  process.env.FAKE_CLAUDE_LOG = path.join(tmp, 'calls.log')
  for (const [rel, text] of Object.entries(ZFILES)) { fs.mkdirSync(path.dirname(path.join(tmp, 'kn', 'ops', rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, 'kn', 'ops', rel), text) }
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sourceTickMs: 3600000, sendTickMs: 3600000, jobTickMs: 3600000, queueResumeMs: 3600000, inboxTickMs: 3600000 }))
  const { startServer } = await import('../server/http.js')
  const s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15, ...(mode === 'pc' ? { mode: 'pc', user: 'kim' } : {}) })
  if (mode !== 'pc') await s.auth.addUser({ id: 'kim', admin: true }) // 일감을 건 사람(intakeCtx 가 명부에서 다시 본다)
  const set = (m) => { if (m) process.env.FAKE_CLAUDE_MODE = m; else delete process.env.FAKE_CLAUDE_MODE }
  const calls = () => (fs.existsSync(process.env.FAKE_CLAUDE_LOG) ? fs.readFileSync(process.env.FAKE_CLAUDE_LOG, 'utf8').split('\n').filter((l) => l.startsWith('shape')) : [])
  try { await fn({ s, tmp, set, calls }) } finally {
    await s.close()
    for (const [k, v] of Object.entries(keep)) { if (v == null) delete process.env[k]; else process.env[k] = v }
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
  }
}
const ZA = { user: 'kim', admin: true }
const MERGE = { sources: [{ doc: '배포 절차', h: '사전 점검' }, { doc: '배포 절차', h: '사후 점검' }], targets: [{ doc: '배포 절차', h: '점검 목록' }] }

test('Claude 짜임 팀: 구조안 일감(shape-plan) · 글 일감(shape-write) 이 서로 막지 않고 · 옛 일꾼은 받지 않고 · 하루 수를 센다 · 구조안은 넣지 않는다', async () => {
  await zEnv('team', async ({ s, tmp, set, calls }) => {
    set(null)
    const { workOnce } = await import('../core/worker.js')
    const wk = (await s.auth.workerAdd()).key
    const c0 = fs.readFileSync(path.join(tmp, 'kn', 'ops', 'docs', '배포 절차.md'), 'utf8')
    assert.deepEqual((await s.hub.shape('ops', ZA)).claude, { ok: true, team: true })
    const a = await s.hub.shapeAsk(ZA, 'ops', { type: 'shape-plan', note: '점검은 하나로' })
    const b = await s.hub.shapeAsk(ZA, 'ops', { type: 'shape-write', ...MERGE })
    assert.notEqual(a.job, b.job, '둘이 서로 막지 않는다(열쇠 s: · w:)')
    assert.equal((await s.hub.shapeAsk(ZA, 'ops', { type: 'shape-plan', note: '점검은 하나로' })).job, a.job, '같은 사람 · 같은 입력의 열린 구조안 일감은 그것')
    assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'intake-day.json'), 'utf8')).ops.n, 2, '하루 들이기 수를 센다')
    assert.equal((await s.hub.shapeAskOf(ZA, 'ops', a.job)).state, 'queued')
    // 옛 일꾼(아는 type 을 싣지 않음)은 shape 일감을 받지 않는다
    const old = await fetch(`${s.url}/api/worker/next`, { method: 'POST', headers: { authorization: `Bearer ${wk}`, 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json())
    assert.equal(old.job, null)
    assert.equal(s.hub.shapeClaudeState('ops').old, true, '화면: 팀 일꾼 판이 옛것이다')
    await assert.rejects(s.hub.shapeAsk(ZA, 'ops', { type: 'shape-plan', note: '다른 말' }), { code: 'E_CONFLICT' }, '옛 일꾼뿐이면 세우지 않는다')
    const r1 = await workOnce({ server: s.url, key: wk })
    const r2 = await workOnce({ server: s.url, key: wk })
    assert.deepEqual([r1.job.type, r2.job.type].sort(), ['shape-plan', 'shape-write'])
    const pa = await s.hub.shapeAskOf(ZA, 'ops', a.job)
    assert.equal(pa.state, 'done', JSON.stringify(pa))
    const d = pa.result.plan.docs.find((x) => x.id === '배포 절차')
    assert.deepEqual(d.items.map((x) => x.h), ['배포 창', '점검 목록'])
    assert.equal(pa.result.plan.kind, 'reshape')
    assert.ok(pa.result.notes.some((x) => x.h === '점검 목록'))
    const pb = await s.hub.shapeAskOf(ZA, 'ops', b.job)
    assert.equal(pb.state, 'done', JSON.stringify(pb))
    assert.match(pb.result.texts[0].content, /디스크 80% 확인[\s\S]*헬스 체크 3회/)
    assert.deepEqual(pb.result.values, [])
    assert.equal(fs.readFileSync(path.join(tmp, 'kn', 'ops', 'docs', '배포 절차.md'), 'utf8'), c0, '지식은 그대로(초안만)')
    assert.deepEqual(calls().sort(), ['shape-plan', 'shape-write'])
  })
})

test('Claude 짜임 팀: 글 결정적 오류는 고쳐 쓰기(errors 만) · 그래도면 걸음 실패 · 지어낸 값은 재기만 · 구조안 덮임 걸림도 고쳐 쓰기', async () => {
  await zEnv('team', async ({ s, set, calls }) => {
    const { workOnce } = await import('../core/worker.js')
    const wk = (await s.auth.workerAdd()).key
    const run = async (type, input) => { const a = await s.hub.shapeAsk(ZA, 'ops', { type, ...input }); await workOnce({ server: s.url, key: wk }); return s.hub.shapeAskOf(ZA, 'ops', a.job) }
    set('badwrite')
    const fix = await run('shape-write', MERGE)
    assert.equal(fix.state, 'done', JSON.stringify(fix))
    assert.deepEqual(calls(), ['shape-write', 'shape-write fix'], '머리 줄(꼴) → 한 번 고쳐 썼다')
    set('badwriteall')
    const fail = await run('shape-write', { ...MERGE, targets: [{ doc: '배포 절차', h: '점검' }] })
    assert.equal(fail.state, 'fail')
    assert.match(fail.why, /^걸음 실패: /)
    assert.equal(fail.stepFail[0].code, 'format')
    assert.equal(fail.texts.length, 1, '마지막 초안은 손으로 고치게 같이 준다')
    assert.equal(calls().filter((x) => x.startsWith('shape-write')).length, 2 + 3, '처음 + 고쳐 쓰기 두 번 · 규칙 길로 가지 않는다')
    set('lie')
    const lie = await run('shape-write', { sources: [{ doc: '장애 대응', h: '롤백' }], targets: [{ doc: '장애 대응', h: '되돌리기', part: '앞' }, { doc: '장애 대응', h: '롤백' }] })
    assert.equal(lie.state, 'done', '값 대조는 막지 않는다')
    assert.ok(lie.result.values.some((v) => v.code === 'invented' && /999초/.test(v.why)), JSON.stringify(lie.result.values))
    set('badplan')
    const n0 = calls().length
    const plan = await run('shape-plan', {})
    assert.equal(plan.state, 'done')
    assert.deepEqual(calls().slice(n0), ['shape-plan', 'shape-plan fix'], '덮임 걸림 → 고쳐 썼다')
    assert.equal(plan.result.errors.filter((e) => e.code !== 'names').length, 0)
    set(null)
  })
})

test('Claude 짜임 팀: 지식관리자만 · Claude 에 보내지 않는 지식은 E_FORBIDDEN · 없는 출처 E_INPUT · 하루 수를 넘으면 E_RATE · 그만두기', async () => {
  await zEnv('team', async ({ s }) => {
    const { SHELL } = await import('../server/hub.js')
    const { seat } = await import('./helpers.mjs')
    await s.auth.addUser({ id: 'lee' })
    await s.auth.addUser({ id: 'kang' })
    await seat(s, 'lee', { ops: 'write' })
    await assert.rejects(s.hub.shapeAsk({ user: 'lee' }, 'ops', { type: 'shape-plan' }), { code: 'E_FORBIDDEN' }, '쓰기 자리 403')
    await assert.rejects(s.hub.shapeAsk({ user: 'kang' }, 'ops', { type: 'shape-plan' }), { code: 'E_NOTFOUND' }, '자리 없음 404')
    const own = await s.hub.shapeAsk(ZA, 'ops', { type: 'shape-write', ...MERGE })
    await assert.rejects(s.hub.shapeAskOf({ user: 'lee' }, 'ops', own.job), { code: 'E_FORBIDDEN' })
    await assert.rejects(s.hub.shapeAskStop({ user: 'kang' }, 'ops', own.job), { code: 'E_NOTFOUND' })
    await assert.rejects(s.hub.shapeAskOf(ZA, 'ops', 'abcdefabcdef'), { code: 'E_NOTFOUND' })
    // 짓는 중 그만두기 — 일꾼의 다음 소식에서 닫히고(쓰지 않음) · 같은 입력으로 다시 걸면 새 일
    const n0 = s.hub.workerNext({ worker: { id: 'w-z6' } }, { types: ['shape-plan', 'shape-write'] })
    assert.equal(n0.job.id, own.job)
    assert.equal((await s.hub.shapeAskStop(ZA, 'ops', own.job)).state, 'stopping')
    const again = await s.hub.shapeAsk(ZA, 'ops', { type: 'shape-write', ...MERGE })
    assert.notEqual(again.job, own.job, '그만두는 중인 일은 다시 잡지 않는다')
    await s.hub.shapeAskStop(ZA, 'ops', again.job)
    await assert.rejects(s.hub.shapeAsk(ZA, 'ops', { type: 'shape-write', sources: [{ doc: '배포 절차', h: '없음' }], targets: [{ doc: '배포 절차', h: '새' }] }), { code: 'E_INPUT' })
    await assert.rejects(s.hub.shapeAsk(ZA, 'ops', { type: 'shape-write', sources: [{ doc: '배포 절차', h: '__proto__\n' }], targets: [] }), { code: 'E_INPUT' })
    await s.hub.setOwner(SHELL, 'ops', { noClaude: true })
    try {
      await assert.rejects(s.hub.shapeAsk(ZA, 'ops', { type: 'shape-plan' }), { code: 'E_FORBIDDEN' })
      assert.equal((await s.hub.shape('ops', ZA)).claude.ok, false)
    } finally { await s.hub.setOwner(SHELL, 'ops', { noClaude: false }) }
    const a = await s.hub.shapeAsk(ZA, 'ops', { type: 'shape-plan' })
    assert.equal((await s.hub.shapeAskStop(ZA, 'ops', a.job)).state, 'cancelled')
    assert.equal((await s.hub.shapeAskOf(ZA, 'ops', a.job)).state, 'cancelled')
    const cap = s.hub.config.intakeDaily
    s.hub.config.intakeDaily = 1
    try { await assert.rejects(s.hub.shapeAsk(ZA, 'ops', { type: 'shape-write', ...MERGE }), { code: 'E_RATE' }) } finally { if (cap == null) delete s.hub.config.intakeDaily; else s.hub.config.intakeDaily = cap }
    // HTTP — 일 하나 GET · 모르는 일 404
    const r = await fetch(`${s.url}/api/k/ops/shape/job/abcdefabcdef`, { headers: { authorization: 'Bearer x' } })
    assert.ok([401, 403, 404].includes(r.status))
  })
})

test('Claude 짜임 개인: 이 PC 의 claude -p 로 구조안 · 글(같은 프롬프트 · 같은 검사 · 고쳐 쓰기)', async () => {
  await zEnv('pc', async ({ s, set, calls }) => {
    const ctx = { user: 'kim', admin: true }
    const wait = async (job) => { for (let i = 0; i < 200; i++) { const x = await s.hub.shapeAskOf(ctx, 'ops', job); if (!['running', 'queued'].includes(x.state)) return x; await new Promise((ok) => setTimeout(ok, 50)) } throw new Error('끝나지 않는다') }
    set('badwrite')
    const w = await wait((await s.hub.shapeAsk(ctx, 'ops', { type: 'shape-write', ...MERGE })).job)
    assert.equal(w.state, 'done', JSON.stringify(w))
    assert.deepEqual(calls(), ['shape-write', 'shape-write fix'])
    set(null)
    const p = await wait((await s.hub.shapeAsk(ctx, 'ops', { type: 'shape-plan' })).job)
    assert.equal(p.state, 'done')
    assert.ok(p.result.plan.docs.some((d) => d.items.some((it) => it.h === '점검 목록')))
  })
})

// 채널 평가 T14: 다듬기 고쳐 받기 꼬리 · 값은 옛 글 그대로 · 값 아닌 정돈은 옛 글로 되돌리지 않는다
test('다듬기 고쳐 받기: 값 아닌 정돈(백틱 · 수준 표시 · 줄표 · 오기)은 옛 글로 되돌리지 않는다', () => {
  const p = polishFixPromptOf({ doc: 'docs/a.md', title: 'a', sections: [{ h: '지우기 차례', base: 'b1', body: '② 고른 파일을 `지우고 이름을 남긴다`' }] }, { updates: [] }, '옛 글의 값이 빠졌다: x')
  assert.match(p, /지난 초안이 kmd 검사에 걸렸다: 옛 글의 값이 빠졌다: x/)
  assert.match(p, /값은 옛 글 그대로 둔다/)
  assert.match(p, /값 아닌 정돈\(백틱 · 수준 표시 · 줄표 · 오기\)은 옛 글로 되돌리지 않는다/)
  assert.match(p, /지난 초안:\n\{"updates":\[\]\}/)
  assert.match(p, /백틱만 걷고 글자는 그대로 둔다/, '다듬기 프롬프트를 그대로 싣는다')
})
