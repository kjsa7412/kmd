// 무인 실패는 다시 시도(지식 생성 하네스 H4b · H-D29 ~ H-D31 · 설계 8-1) — 규칙 길은 없다.
//   세션이 끝내 못 넣으면 지식에 아무것도 쓰지 않고 일감이 다시 대기로 간다(간격 10분 · 1시간 · 6시간) · 세 번 뒤에도 못 넘으면 「실패」 일감 ·
//   지식관리자가 「다시 시도」 · 「그만두기」 · Claude 를 못 써서 못 돈 것은 세지 않는다 · 「Claude 에 보내지 않음」 지식은 무인 일감을 열지 않는다 ·
//   하루 상한은 다음 날로 넘긴다 · 모두 뺌은 실패가 아니다 · 옛 「들인 자료」 문서는 그대로 읽는다.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { workOnce, knownTypes } from '../core/worker.js'
import { copyDir, signIn, seat } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, wk
const P = {}
const KD = () => path.join(tmp, 'kn', 'dpms')
// 지식에 쓴 것을 본다 — 커밋 수(저장소가 아직 없으면 0) + 기록 수
const commits = () => (fs.existsSync(path.join(KD(), '.git')) ? Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: KD(), encoding: 'utf8' }).trim()) : 0) * 1000 + fs.readdirSync(path.join(KD(), 'work')).length
const jobs = () => s.hub.intakesOf('dpms')
const open = (name, md = '# 메모\n\n## 원격 명령\n\n펄스 길이는 300ms 다.\n') => s.hub.openJob('dpms', { type: 'file', by: 'kim', src: { rel: name, file: name, title: name, sha: 'a'.repeat(16) }, md })
const withEnv = async (k, v, f) => { const old = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; try { return await f() } finally { if (old == null) delete process.env[k]; else process.env[k] = old } }
const idle = (f) => withEnv('FAKE_AGENT_MODE', 'idle', f) // 가짜 세션이 아무것도 넣지 않고 끝낸다
const work = () => workOnce({ server: s.url, key: wk, log: () => {} })
const api = async (who, p, body) => {
  const r = await fetch(s.url + p, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: who.cookie, 'content-type': 'application/json', 'x-kmd': '1' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, j: await r.json().catch(() => null) }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-hretry-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  delete process.env.KMD_CLAUDE
  process.env.KMD_CLAUDE_AGENT = path.join(HERE, 'fixture', 'fake-claude-agent.mjs')
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  // 다시 시도 간격을 0 으로(시험) — 처음 값은 10분 · 1시간 · 6시간이다
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sourceTickMs: 3600000, inboxTickMs: 3600000, jobTickMs: 3600000, watchQuietMs: 600000, retryGaps: [0, 0, 0], intakeDaily: 6 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  wk = (await s.auth.workerAdd()).key
  P.kim = await signIn(s, { id: 'kim', admin: true })
  P.wr = await signIn(s, { id: 'wr', admin: false })
  await seat(s, 'wr', { dpms: 'write' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('세션이 끝내 못 넣으면 지식에 아무것도 쓰지 않고 일감이 다시 시도한다 · 세 번 뒤에도 못 넘으면 실패 일감 · 원문 문서는 생기지 않는다', async () => {
  assert.ok(knownTypes().includes('session'))
  const c0 = commits()
  const o = await open('실패하는 메모.md')
  assert.equal(o.state, 'queued')
  await idle(async () => {
    for (let n = 1; n <= 3; n++) {
      await work()
      const j = jobs().find((x) => x.id === o.job)
      assert.deepEqual([j.state, j.fails, typeof j.retryAt], ['queued', n, 'number'], `다시 대기(${n}번째 실패)`)
      assert.match(j.why, /세션이 이 원천을 문서에 넣지 않았다/)
    }
    // 처음 + 자동 세 번 뒤에도 못 넘었다 — 실패 일감
    await work()
  })
  const j = jobs().find((x) => x.id === o.job)
  assert.deepEqual([j.state, j.fails, j.result.failed], ['failed', 4, true])
  assert.equal(commits(), c0, '지식에는 아무것도 쓰지 않았다')
  assert.ok(!fs.existsSync(path.join(KD(), 'docs', '들인 자료')), '원문을 그대로 옮긴 문서(들인 자료)는 생기지 않는다')
  // 측정 줄 — 실패마다 한 줄 · 같은 까닭이 세 번이면 fail.same
  const lines = fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'savelog', 'dpms.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.job === o.job)
  assert.deepEqual(lines.map((l) => [l.fail.n, l.fail.code, l.fail.final, !!l.fail.same]), [[1, 'nosave', false, false], [2, 'nosave', false, false], [3, 'nosave', false, true], [4, 'nosave', true, true]])
  // 실패 일감은 일꾼에게 다시 가지 않는다
  assert.equal(await work(), null)
})

test('실패 일감의 손잡이: 지식관리자만 · 「다시 시도」 는 처음부터 다시(이번에는 들어간다) · 「그만두기」 는 원천을 버린다', async () => {
  const failed = (await api(P.kim, '/api/k/dpms/intake/failed')).j.jobs
  assert.equal(failed.length, 1)
  assert.deepEqual([failed[0].title, failed[0].fails, failed[0].codes.slice(-1)[0]], ['실패하는 메모.md', 4, 'nosave'])
  // 쓰기 자리는 보지도 누르지도 못한다
  assert.equal((await api(P.wr, '/api/k/dpms/intake/failed')).status, 403)
  assert.equal((await api(P.wr, `/api/k/dpms/intake/${failed[0].id}/again`, {})).status, 403)
  assert.equal((await api(P.kim, `/api/k/dpms/intake/${failed[0].id}/again`)).status, 405, 'GET 은 받지 않는다')
  // 다시 시도 — 대기로 돌아가고 시도 수를 다시 센다. 이번에는 세션이 저장한다
  const a = await api(P.kim, `/api/k/dpms/intake/${failed[0].id}/again`, {})
  assert.deepEqual([a.status, a.j.state], [200, 'queued'])
  const r = await work()
  assert.equal(r.summary.put, 1)
  assert.equal(jobs().find((x) => x.id === failed[0].id).state, 'done')
  // 그만두기 — 실패 일감의 원천을 버린다(기록 없음)
  const o = await open('버릴 메모.md')
  await idle(async () => { for (let n = 0; n < 4; n++) await work() })
  assert.equal(jobs().find((x) => x.id === o.job).state, 'failed')
  const c0 = commits()
  const d = await api(P.kim, `/api/k/dpms/intake/${o.job}/drop`, {})
  assert.deepEqual([d.status, d.j.state], [200, 'cancelled'])
  assert.equal(commits(), c0)
  assert.equal((await api(P.kim, '/api/k/dpms/intake/failed')).j.jobs.length, 0)
  assert.equal((await api(P.kim, `/api/k/dpms/intake/${o.job}/again`, {})).status, 404)
})

test('Claude 를 못 써서 못 돈 것은 시도로 세지 않는다 · 「Claude 에 보내지 않음」 지식은 무인 일감을 열지 않는다 · 하루 상한은 다음 날로', async () => {
  // 로그인이 끊긴 세션 — 세지 않고 다시 대기
  const o = await open('한도 메모.md')
  const n = await (await fetch(`${s.url}/api/worker/next`, { method: 'POST', headers: { authorization: `Bearer ${wk}`, 'content-type': 'application/json' }, body: JSON.stringify({ types: knownTypes() }) })).json()
  const call = async (p, body) => (await fetch(`${s.url}/api/k/dpms/worker/intake${p}`, { method: 'POST', headers: { authorization: `Bearer ${n.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })).json()
  await call('/session')
  const d = await call('/done', { session: { ok: false, error: 'login', message: '로그인이 끝났다', cost: 0 } })
  assert.equal(d.requeued, true)
  const j = jobs().find((x) => x.id === o.job)
  assert.deepEqual([j.state, j.fails || 0, j.retryAt || null], ['queued', 0, null])
  await work() // 이번에는 들어간다
  assert.equal(jobs().find((x) => x.id === o.job).state, 'done')
  // 「Claude 에 보내지 않음」 — 일감을 열지 않고 알린다
  await s.hub.setOwner(SHELL, 'dpms', { noClaude: true })
  const c0 = commits()
  const q0 = jobs().length
  const nc = await open('보내지 않는 메모.md')
  assert.deepEqual([nc.state, nc.why], ['noclaude', '이 지식은 Claude 를 쓰지 않아 무인으로 들일 수 없다'])
  assert.deepEqual([jobs().length, commits()], [q0, c0])
  await s.hub.setOwner(SHELL, 'dpms', { noClaude: false })
  const c1 = commits() // 설정을 되돌린 커밋 뒤
  // 하루 상한(시험에서는 6) — 넘으면 원문을 넣지 않고 다음 날로 넘긴다(시도 수에 세지 않는다)
  let last
  for (let i = 0; i < 4; i++) last = await open(`상한 ${i}.md`, `# 상한 ${i}\n\n## 원격 명령\n\n글 ${i}.\n`)
  assert.equal(last.tomorrow, true, JSON.stringify(last))
  const tj = jobs().find((x) => x.id === last.job)
  assert.ok(tj.retryAt > Date.now() + 60_000 && !tj.fails)
  assert.match(tj.why, /오늘 들이기 수\(6\)를 넘었다: 내일 이어서 든다/)
  assert.equal(commits(), c1)
})
