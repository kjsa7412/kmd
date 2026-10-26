// 일 줄(core/queue.js · 가져오기 일 줄 검토안 2 · 3 · 4단계) — 차례 · 길 · 멈춤 · 그만두기 · 다시 · 줄 멈춤 · 남기기,
// 그리고 서버에서: 파일 넣기 → 네 단계 · Claude 길 하나씩 · 도는 Claude Code 를 그만두기 · 멈춘 일은 시작하지 않기 ·
// 여러 파일 묶음 · 가져오기 브레이크 → 확인할 것 → 그대로 맞추기 · 다시 켜면 남은 일을 잇는다.
//
// 가짜 Claude Code(test/fixture/fake-claude-agent.mjs) — FAKE_AGENT_WAIT_MS 만큼 둘러본 뒤 쉰다(도는 동안을 본다)

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createQueue, Cancelled, isFinal } from '../core/queue.js'
import { startServer } from '../server/http.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ME = { user: 'kim', admin: true, pc: true }
const wait = async (f, ms = 20000) => { const t = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t > ms) throw new Error('기다림 초과'); await new Promise((r) => setTimeout(r, 40)) } }
const tick = () => new Promise((r) => setTimeout(r, 20))
const MD = (t) => Buffer.from(`# ${t}\n\n## 원격 명령\n펄스 방식 — 3초 동안 1을 쓰고 0 으로 돌린다.\n`)
let tmp, root, s

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-queue-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  process.env.KMD_CLAUDE_AGENT = path.join(HERE, 'fixture', 'fake-claude-agent.mjs')
  root = path.join(tmp, 'kn')
  fs.mkdirSync(root, { recursive: true })
  s = await startServer({ root, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  await s.hub.addKnowledge(ME, { kind: 'new', name: '회의' })
})
after(async () => {
  delete process.env.FAKE_AGENT_WAIT_MS
  await s?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

// ── 일 줄 하나만 ──

test('차례 · 길 — 길마다 동시에 도는 수만 · 끝나면 다음 · 맨 앞으로', async () => {
  const q = createQueue({ caps: { fetch: 1 } })
  const [a, b, c] = ['a', 'b', 'c'].map((t) => q.add({ kind: 'source', kn: 'k', title: t }))
  const got = []
  const go = (j) => q.step(j, 0, { lane: 'fetch' }).then(() => got.push(j.title))
  go(a); go(b); go(c)
  await tick()
  assert.deepEqual(got, ['a'])
  assert.equal(b.state, 'wait')
  q.top(c.id) // 기다리던 c 를 맨 앞으로
  q.end(a, 'done')
  await tick()
  assert.deepEqual(got, ['a', 'c'])
  assert.deepEqual(q.lanes().fetch, { cap: 1, busy: 1, wait: 1 })
  q.setCaps({ fetch: 2 })
  await tick()
  assert.deepEqual(got, ['a', 'c', 'b'], '동시에 도는 수를 늘리면 바로 다음 일이 든다')
  assert.deepEqual(a.stages.map((x) => x.state), ['done', 'skip', 'skip', 'skip'])
})

test('멈춤은 단계 사이에서 — 도는 단계는 마치고 서고 이어서를 기다린다', async () => {
  const q = createQueue()
  const j = q.add({ kind: 'file', kn: 'k', title: 'x' })
  await q.step(j, 0)
  q.pause(j.id)
  assert.equal(j.state, 'pausing', '도는 중이면 멈추는 중')
  let at2 = false
  const p = q.step(j, 1).then(() => { at2 = true })
  await tick()
  assert.equal(j.state, 'pause')
  assert.equal(j.stage, 1)
  assert.match(j.msg, /「검토」 에서 이어 간다/)
  assert.equal(at2, false)
  q.resume(j.id)
  await p
  assert.equal(j.state, 'run')
  assert.deepEqual(j.stages.map((x) => x.state), ['done', 'run', 'wait', 'wait'])
})

test('그만두기 — 기다리던 일은 곧바로 끝 · 도는 일은 signal · 멈춘 자리에서도 Cancelled', async () => {
  const q = createQueue({ caps: { claude: 1 } })
  const a = q.add({ kind: 'file', kn: 'k', title: 'a' })
  const b = q.add({ kind: 'file', kn: 'k', title: 'b' })
  await q.step(a, 3, { lane: 'claude' })
  const pb = q.step(b, 3, { lane: 'claude' })
  q.cancel(b.id)
  await assert.rejects(pb, (e) => e instanceof Cancelled)
  assert.equal(b.state, 'cancel')
  assert.ok(isFinal(b))
  q.cancel(a.id)
  assert.equal(a.state, 'run', '도는 일은 일을 하는 쪽이 끝낸다')
  assert.equal(q.signal(a).aborted, true)
  await assert.rejects(q.step(a, 3), (e) => e.cancelled)
  // 못함 · 확인할 것은 줄에 남는다 — 그만두기는 걷기
  const c = q.add({ kind: 'source', kn: 'k', title: 'c' })
  q.end(c, 'check', '크게 바뀜')
  assert.equal(isFinal(c), false)
  q.cancel(c.id)
  assert.equal(c.state, 'cancel')
  assert.match(c.msg, /건너뛰었다/)
})

test('줄 멈춤 — 도는 일은 다음 단계 앞에서 · 새 일은 시작하지 않고 · 풀면 잇는다', async () => {
  const q = createQueue({ caps: { fetch: 2 } })
  const a = q.add({ kind: 'source', kn: 'k', title: 'a' })
  await q.step(a, 0, { lane: 'fetch' })
  q.setHold(true)
  assert.equal(a.state, 'pausing')
  const b = q.add({ kind: 'source', kn: 'k', title: 'b' })
  let bIn = false
  q.step(b, 0, { lane: 'fetch' }).then(() => { bIn = true })
  const pa = q.step(a, 1)
  await tick()
  assert.equal(a.state, 'pause')
  assert.equal(a.parked, 'hold')
  assert.equal(bIn, false)
  assert.equal(b.state, 'pause', '새 일도 줄 멈춤 자리에 선다')
  q.setHold(false)
  await pa
  await tick()
  assert.equal(bIn, true)
  assert.equal(a.state, 'run')
})

test('다시 · 남기기 — 못함은 그 단계부터 · 다시 켜면 돌던 일은 멈춤(프로그램이 꺼졌다)', async () => {
  const file = path.join(tmp, 'q1', 'queue.json')
  const q = createQueue({ file })
  const ran = []
  q.runner('t', async (j, o) => { ran.push(o.from); await q.step(j, o.from); q.end(j, 'done') })
  const a = q.add({ kind: 'file', kn: 'k', title: 'a', spec: { type: 't' } })
  await q.step(a, 2)
  q.end(a, 'fail', '넘어졌다')
  q.retry(a.id)
  await wait(() => a.state === 'done')
  assert.deepEqual(ran, [2])
  assert.deepEqual(a.stages.map((x) => x.state), ['skip', 'skip', 'done', 'skip'], '앞 단계는 지난 것 · 들지 않은 단계는 건너뜀')
  const b = q.add({ kind: 'file', kn: 'k', title: 'b', spec: { type: 't' } })
  await q.step(b, 1)
  await q.flush()
  const q2 = createQueue({ file })
  const back = await q2.load()
  const b2 = back.find((x) => x.id === b.id)
  assert.equal(b2.state, 'pause')
  assert.equal(b2.parked, 'restart')
  assert.match(b2.msg, /프로그램이 꺼졌다 — \[이어서\] 로 「검토」 부터/)
  assert.equal(back.find((x) => x.id === a.id).state, 'done', '끝난 일도 남는다(30일)')
})

// ── 서버 ──

test('파일 넣기 — 네 단계 · 줄마다 단계 · Claude 길은 하나씩(차례로)', async () => {
  process.env.FAKE_AGENT_WAIT_MS = '250'
  const r = await s.hub.importFiles(ME, '회의', ['가', '나', '다'].map((t) => ({ path: `${t}.md`, data: MD(`${t} 통화`) })))
  const ids = r.rows.map((x) => x.run)
  assert.equal(ids.length, 3)
  let most = 0
  await wait(async () => {
    const v = await s.hub.queueList(ME)
    const mine = v.items.filter((x) => ids.includes(x.id))
    most = Math.max(most, mine.filter((x) => x.stage === 3 && x.state === 'run').length)
    return mine.every((x) => x.fin)
  })
  assert.equal(most, 1, 'Claude 길(문서 생성)은 한 번에 하나')
  const one = await s.hub.queueGet(ME, ids[0])
  assert.equal(one.state, 'done', one.msg)
  assert.deepEqual(one.stages.map((x) => x.state), ['done', 'done', 'done', 'done'])
  assert.ok(one.lines.some((l) => l.s === 3 && l.x.startsWith('지식 둘러보기')), '둘러보기는 문서 생성 단계의 줄')
  assert.ok(one.lines.some((l) => l.s === 2), '기록 정리는 기록 생성 단계의 줄')
  delete process.env.FAKE_AGENT_WAIT_MS
})

test('그만두기 — 도는 Claude Code 를 끈다 · 기록은 남는다 · 멈춘 기다림은 시작하지 않고 이어서로 돈다', async () => {
  process.env.FAKE_AGENT_WAIT_MS = '4000'
  const r = await s.hub.importFiles(ME, '회의', [{ path: '라.md', data: MD('라 통화') }, { path: '마.md', data: MD('마 통화') }])
  const [a, b] = r.rows.map((x) => x.run)
  await wait(async () => (await s.hub.queueGet(ME, a)).lines.some((l) => l.x.startsWith('지식 둘러보기')))
  // 뒤의 일 — 차례를 기다리는 동안 멈춘다
  await wait(async () => (await s.hub.queueGet(ME, b)).stage === 3)
  await s.hub.queueAct(ME, b, 'pause')
  const t0 = Date.now()
  await s.hub.queueAct(ME, a, 'cancel')
  const ja = await wait(async () => { const x = await s.hub.queueGet(ME, a); return x.fin && x })
  assert.equal(ja.state, 'cancel')
  assert.ok(Date.now() - t0 < 3000, '쉬던 Claude Code 를 기다리지 않고 끊었다')
  assert.ok(ja.lines.some((l) => /그만두기 — Claude Code 를 끈다/.test(l.x)))
  const k = await s.hub.get('회의')
  assert.equal(k.byWork.get(r.rows[0].rec).state, 'pend', '기록은 남았다(정리 때 넣는다)')
  await new Promise((ok) => setTimeout(ok, 400))
  const jb = await s.hub.queueGet(ME, b)
  assert.equal(jb.state, 'pause', '멈춘 일은 길이 비어도 시작하지 않는다')
  process.env.FAKE_AGENT_WAIT_MS = '0'
  await s.hub.queueAct(ME, b, 'resume')
  const jb2 = await wait(async () => { const x = await s.hub.queueGet(ME, b); return x.fin && x })
  assert.equal(jb2.state, 'done', jb2.msg)
  delete process.env.FAKE_AGENT_WAIT_MS
})

test('줄 멈춤 · 맨 앞으로 · 빼기 · 동시에 도는 수 — 화면의 손잡이', async () => {
  await s.hub.queueHold(ME, true)
  const r = await s.hub.importFiles(ME, '회의', ['바', '사', '아'].map((t) => ({ path: `${t}.md`, data: MD(`${t} 통화`) })))
  const ids = r.rows.map((x) => x.run)
  await wait(async () => (await s.hub.queueList(ME)).items.filter((x) => ids.includes(x.id)).every((x) => x.state === 'pause' && x.parked === 'hold'))
  const top = await s.hub.queueAct(ME, ids[2], 'top')
  const v = await s.hub.queueList(ME)
  assert.equal(v.hold, true)
  assert.equal(top.order, Math.min(...v.items.filter((x) => !x.fin && x.kind !== 'tidy').map((x) => x.order)))
  await s.hub.queueAct(ME, ids[1], 'cancel')
  assert.equal((await s.hub.queueGet(ME, ids[1])).state, 'cancel')
  assert.deepEqual(s.hub.queueCaps(ME, { claude: 2, fetch: 9 }), { claude: 2, fetch: 8 })
  s.hub.queueCaps(ME, { claude: 1 })
  await s.hub.queueHold(ME, false)
  await wait(async () => (await s.hub.queueList(ME)).items.filter((x) => ids.includes(x.id)).every((x) => x.fin))
  assert.equal((await s.hub.queueGet(ME, ids[0])).state, 'done')
  assert.equal((await s.hub.queueGet(ME, ids[2])).state, 'done')
  // 길 — 화면이 부르는 대로
  const res = await fetch(`${s.url}/api/queue/${ids[0]}/nope`, { method: 'POST' })
  assert.equal(res.status, 401, '들어오지 않으면 일 줄을 만지지 못한다')
})

test('여러 파일 묶음 — 나눠 보내도 일 하나 · 안의 파일이 끝나면 닫힌다 · 그만두면 나머지는 받지 않는다', async () => {
  const a = await s.hub.importFiles(ME, '회의', [{ path: '묶음/자.md', data: MD('자') }], { group: { title: '묶음 폴더 → 회의', total: 2 } })
  const gid = a.group
  assert.ok(gid)
  let g = await s.hub.queueGet(ME, gid)
  assert.equal(g.kind, 'group')
  assert.equal(g.state, 'run')
  await s.hub.importFiles(ME, '회의', [{ path: '묶음/차.md', data: MD('차') }], { group: { id: gid, last: true } })
  g = await wait(async () => { const x = await s.hub.queueGet(ME, gid); return x.fin && x })
  assert.equal(g.state, 'done')
  assert.match(g.msg, /받았다 2\/2/)
  assert.equal(g.children, 2)
  // 그만두기 — 다음 조각은 「stopped」
  const b = await s.hub.importFiles(ME, '회의', [{ path: '묶음2/카.md', data: MD('카') }], { group: { id: 'abcdef012345', title: '묶음2', total: 3 } })
  assert.equal(b.group, 'abcdef012345', '화면이 정한 id 로 선다')
  await s.hub.queueAct(ME, b.group, 'cancel')
  const c = await s.hub.importFiles(ME, '회의', [{ path: '묶음2/타.md', data: MD('타') }], { group: { id: b.group } })
  assert.equal(c.stopped, true)
  assert.equal((await s.hub.queueGet(ME, b.group)).state, 'cancel')
  await s.hub.curateIdle('회의')
})

test('가져오기 — 한 번이 일 하나 · 크게 바뀌면 확인할 것 · 그대로 맞추기 · 같은 곳의 지난 확인은 걷는다', async () => {
  const dir = path.join(tmp, '공유')
  fs.mkdirSync(dir, { recursive: true })
  for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(dir, `메모${i}.md`), `# 메모${i}\n\n## 내용\n${i} 번째.\n`)
  await s.hub.sourceAdd(ME, '회의', { name: '공유', kind: 'docs', at: dir, every: 'manual', rules: [{ rule: 'docs', into: { doc: '공유' } }] })
  const first = (await s.hub.queueList(ME)).items.filter((x) => x.kind === 'source' && x.src === '공유')
  assert.ok(first.length >= 1)
  assert.ok(first.every((x) => x.fin && x.state === 'done'), JSON.stringify(first.map((x) => [x.state, x.msg])))
  for (let i = 0; i < 4; i++) fs.rmSync(path.join(dir, `메모${i}.md`))
  const [r] = await s.hub.sourceRun('회의', '공유', { by: 'kim' })
  assert.equal(r.state, 'stopped')
  let jobs = (await s.hub.queueList(ME)).items.filter((x) => x.kind === 'source' && x.src === '공유' && !x.fin)
  assert.equal(jobs.length, 1)
  const chk = jobs[0]
  assert.equal(chk.state, 'check')
  assert.equal(chk.stage, 1, '검토 단계에서 섰다')
  assert.match(chk.msg, /한꺼번에 크게 바뀌었다 — 사라진 항목 4 \/ 10 · 아직 아무것도 쓰지 않았다/)
  assert.equal(chk.by, 'kim')
  await s.hub.queueAct(ME, chk.id, 'force')
  await wait(async () => { const v = (await s.hub.queueList(ME)).items.filter((x) => x.kind === 'source' && x.src === '공유'); return !v.some((x) => x.id === chk.id) && v.some((x) => x.fin && /원본에 없다 4/.test(x.msg)) })
  jobs = (await s.hub.queueList(ME)).items.filter((x) => x.kind === 'source' && x.src === '공유' && !x.fin)
  assert.equal(jobs.length, 0, '확인할 것이 걷혔다')
  // 그대로 — 지난 「그대로」 는 마지막 것만
  await s.hub.sourceRun('회의', '공유')
  await s.hub.sourceRun('회의', '공유')
  const same = (await s.hub.queueList(ME)).items.filter((x) => x.kind === 'source' && x.src === '공유' && x.msg === '그대로')
  assert.equal(same.length, 1)
  assert.equal(same[0].auto, 'manual', '정한 때(자동)로 돈 일')
})

test('다시 켜면 — 멈춘 일 · 줄 멈춤은 그대로 · 돌던 일은 그 단계부터 다시', async () => {
  await s.hub.queueHold(ME, true)
  const r = await s.hub.importFiles(ME, '회의', [{ path: '파.md', data: MD('파 통화') }])
  const id = r.rows[0].run
  await wait(async () => (await s.hub.queueGet(ME, id)).parked === 'hold')
  await s.hub.queue.flush()
  await s.close()
  s = await startServer({ root, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  const j = await s.hub.queueGet(ME, id)
  assert.equal(j.state, 'pause')
  assert.equal(j.parked, 'hold')
  assert.equal((await s.hub.queueList(ME)).hold, true, '줄 멈춤도 남는다')
  await s.hub.queueHold(ME, false)
  const done = await wait(async () => { const x = await s.hub.queueGet(ME, id); return x.fin && x })
  assert.equal(done.state, 'done', done.msg)
  assert.ok((await s.hub.queueList(ME)).items.some((x) => x.kind === 'group' && x.fin), '끝난 일도 다시 켜도 남는다')
})

test('팀 — 정리 일감도 같은 줄 · 기다리는 것은 뺀다(일꾼이 받지 않는다) · 맡은 것은 빼지 못한다', async () => {
  const { copyDir } = await import('./helpers.mjs')
  const { workOnce } = await import('../core/worker.js')
  const troot = path.join(tmp, 'team')
  copyDir(path.join(HERE, 'fixture', 'kmd'), troot)
  fs.mkdirSync(path.join(troot, '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(troot, '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, tidyTickMs: 3600000 }))
  const t = await startServer({ root: troot, port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const KIM = { user: 'kim', admin: true }
    const wkey = (await t.auth.workerAdd()).key
    const j = await t.hub.tidyNow(KIM, 'dpms')
    let it = (await t.hub.queueList(KIM)).items.find((x) => x.id === 't:' + j.id)
    assert.equal(it.kind, 'tidy')
    assert.equal(it.state, 'wait')
    assert.equal(it.msg, '정리 일꾼을 기다린다')
    await assert.rejects(t.hub.queueAct({ user: 'lee' }, 't:' + j.id, 'cancel'), { code: 'E_FORBIDDEN' })
    await t.hub.queueAct(KIM, 't:' + j.id, 'cancel')
    it = (await t.hub.queueList(KIM)).items.find((x) => x.id === 't:' + j.id)
    assert.equal(it.state, 'cancel')
    assert.equal(it.fin, true)
    assert.equal(await workOnce({ server: t.url, key: wkey }), null, '뺀 일감은 일꾼이 받지 않는다')
    await assert.rejects(t.hub.queueAct(KIM, 't:' + j.id, 'cancel'), { code: 'E_CONFLICT' })
    assert.throws(() => t.hub.queueHold({ user: 'lee' }, true), { code: 'E_FORBIDDEN' }, '줄 멈춤은 관리자만')
  } finally {
    await t.close()
  }
})
