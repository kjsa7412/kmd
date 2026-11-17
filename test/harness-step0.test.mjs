// 걸음 0 과 서버가 미리 맞춰 주는 것(지식 생성 하네스 H4c-2 · H-D16 · H-D17 · H-D25 · 설계 5-2 · 9-1).
//   같은 것 가림(경로가 다른 사본은 일감을 열지 않는다 · 측정 줄 dup) · 같은 줄기의 앞 판 · 같이 온 것을 일 설명에 ·
//   얇은 지식의 무인 들이기는 지식마다 한 줄 · 한 저장이 고치는 있는 항목 수 상한.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { workOnce, knownTypes } from '../core/worker.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, wk
const jobs = () => s.hub.intakesOf('dpms')
const shaOf = (md) => crypto.createHash('sha256').update(md).digest('hex').slice(0, 16)
const MD = (v) => `# 메모\n\n## 원격 명령\n\n펄스 길이는 ${v}ms 다.\n`
const open = (name, md) => s.hub.openJob('dpms', { type: 'file', by: 'kim', src: { rel: name, file: name.split('/').pop(), title: name.split('/').pop(), sha: shaOf(md) }, md })
const work = () => workOnce({ server: s.url, key: wk, log: () => {} })
const next = async () => (await fetch(`${s.url}/api/worker/next`, { method: 'POST', headers: { authorization: `Bearer ${wk}`, 'content-type': 'application/json' }, body: JSON.stringify({ types: knownTypes() }) })).json()
const call = async (key, p, body) => (await fetch(`${s.url}/api/k/dpms/worker/intake${p}`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })).json()
const savelog = () => fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'savelog', 'dpms.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-hstep0-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  delete process.env.KMD_CLAUDE
  process.env.KMD_CLAUDE_AGENT = path.join(HERE, 'fixture', 'fake-claude-agent.mjs')
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  // 얇은 지식의 문턱을 크게(시험) — 시험 지식이 늘 얇은 지식이다. 처음 값은 항목 20 이다
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sourceTickMs: 3600000, inboxTickMs: 3600000, jobTickMs: 3600000, watchQuietMs: 600000, retryGaps: [0, 0, 0], thinItems: 100000, editCap: 2 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  wk = (await s.auth.workerAdd()).key
  await signIn(s, { id: 'kim', admin: true })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('같은 것 가림: 경로가 다른 사본은 일감을 열지 않는다(측정 줄 dup) · 같은 경로를 다시 넣는 것은 가리지 않는다', async () => {
  const a = await open('회의/원격 명령 메모.md', MD(300))
  assert.equal(a.state, 'queued')
  const r = await work()
  assert.equal(r.summary.put, 1)
  const n0 = jobs().length
  const works0 = fs.readdirSync(path.join(tmp, 'kn', 'dpms', 'work')).length
  const b = await open('보관/원격 명령 메모 사본.md', MD(300))
  assert.deepEqual([b.state, b.dup], ['same', true])
  assert.ok(b.rec, '먼저 들어간 기록을 알려 준다')
  assert.deepEqual([jobs().length, fs.readdirSync(path.join(tmp, 'kn', 'dpms', 'work')).length], [n0, works0], '일감도 기록도 생기지 않는다')
  const l = savelog().slice(-1)[0]
  assert.deepEqual([l.dup, l.same, l.put, l.rec], [true, true, 0, b.rec])
})

test('얇은 지식은 한 줄: 같은 지식의 무인 들이기가 도는 동안 다음 것을 내주지 않는다 · 일 설명에 같이 온 것과 같은 줄기의 앞 판', async () => {
  const a = await open('회의/원격 명령 메모 v2.md', MD(250))
  const b = await open('회의/전송 주기 메모.md', '# 메모\n\n## 원격 명령\n\n전송 주기는 15초다.\n')
  assert.deepEqual([a.state, b.state], ['queued', 'queued'])
  const n = await next()
  assert.equal(n.job.id, a.job)
  assert.equal((await next()).job ?? null, null, '첫 일감이 도는 동안 같은 지식의 다음 일감은 기다린다')
  const t = await call(n.key, '/session')
  assert.match(t.prompt, /같이 온 것\(아직 들이지 않은 다른 원천 1\): 전송 주기 메모\.md/)
  assert.match(t.prompt, /같은 줄기의 앞 판을 이미 들였다: 기록 「/)
  await call(n.key, '/done', { session: { ok: false, error: 'login', message: '로그인이 끝났다', cost: 0 } })
  // 앞의 것이 줄에서 빠지면 다음 것이 나온다(둘 다 대기 → 하나씩)
  assert.ok((await next()).job)
  assert.equal((await next()).job ?? null, null)
})
