// 세션 일감(지식 생성 하네스 H4a · H-D34) — 팀 일꾼이 Claude Code 세션(가짜 에이전트)을 띄워 팀 서버의 MCP 에 단기 열쇠로 붙는다.
//   세션이 스스로 brief → section → save 를 부르고, 세션의 save 는 무인 저장 문을 지나 기록 + 항목 글 + 장부가 한 커밋에 선다.
//   열쇠는 그 지식 · 그 일감에만 · 끝나면 끊긴다 · 세션이 아무것도 넣지 않으면 일감이 닫히는 길(지금은 규칙 길 · H4b 에서 다시 시도로).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { workOnce, knownTypes } from '../core/worker.js'
import { copyDir } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, wk, docsDir
const ADMIN = { user: 'kim', admin: true }
const W = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }
const KD = () => path.join(tmp, 'kn', 'dpms')
const fresh = async () => { s.hub.forget?.('dpms'); return s.hub.get('dpms') }
const jobsOf = (st) => s.hub.intakesOf('dpms').filter((j) => j.state === st)
const mcp = async (token, name, args) => {
  const r = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
  return { status: r.status, j: await r.json().catch(() => null) }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-hsession-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  delete process.env.KMD_CLAUDE
  process.env.KMD_CLAUDE_AGENT = path.join(HERE, 'fixture', 'fake-claude-agent.mjs')
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  docsDir = path.join(tmp, 'src', '통화')
  W(path.join(docsDir, 'HNC 통화.md'), '# HNC 통화\n\n2026-10-21 HNC 와 통화했다.\n\n## 원격 명령\n\n원격 명령은 펄스 방식으로 보낸다. 펄스 길이는 300ms 다.\n')
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ sourceRoots: [path.join(tmp, 'src')], decideMs: 3600000, sourceTickMs: 3600000, inboxTickMs: 3600000, jobTickMs: 3600000, watchQuietMs: 600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  wk = (await s.auth.workerAdd()).key
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('팀 일꾼이 세션을 띄운다: 세션이 팀 서버의 MCP 로 찾고 저장한다 · 기록 + 항목 글 + 장부가 한 저장 · 열쇠는 끝나면 끊긴다', async () => {
  assert.ok(knownTypes().includes('session'))
  const r0 = await s.hub.sourceAdd(ADMIN, 'dpms', { name: '통화', kind: 'docs', at: docsDir, rules: [{ rule: 'docs', into: { doc: '통화' } }] })
  assert.equal(r0.run[0].queued, 1, JSON.stringify(r0.run[0]).slice(0, 300))
  const logs = []
  const a = await workOnce({ server: s.url, key: wk, log: (x) => logs.push(x) })
  assert.equal(a.job.session, true, '세션을 아는 일꾼에게는 세션 일감으로')
  assert.deepEqual([a.summary.put, a.summary.rule], [1, 0], logs.join('\n'))
  assert.equal(jobsOf('done').length, 1)
  const k = await fresh()
  const w = k.byWork.get(a.rec)
  assert.ok(w, '세션의 save 가 기록을 세웠다')
  assert.ok(w.tags.includes('intake') && w.tags.some((t) => t.startsWith('job/')) && w.tags.some((t) => t.startsWith('ingest/')), w.tags.join(' '))
  assert.equal(w.author, 'kmd') // 가져올 곳의 들이기는 예약 사람 kmd
  assert.match(w.body, /## 원천/)
  assert.ok(k.byDocPath.get('docs/회의록.md').sections.some((x) => x.h === '2026-10-21 HNC 통화'))
  assert.ok(k.vocab.coords.has('term:펄스명령'))
  // 측정 줄 — 무인 채널(가져올 곳)
  const line = fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'savelog', 'dpms.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.rec === a.rec)
  assert.equal(line?.ch, 'intake-src', JSON.stringify(line))
})

test('세션 일감의 열쇠: 그 지식에만 · 팀 서버는 세션 일감의 열쇠만 받는다 · 끝난 일감의 열쇠는 끊긴다', async () => {
  W(path.join(docsDir, '둘째 통화.md'), '# 둘째 통화\n\n## 원격 명령\n\n펄스 길이를 400ms 로 바꾼다.\n')
  await s.hub.sourceRun('dpms', '통화')
  const n = await (await fetch(`${s.url}/api/worker/next`, { method: 'POST', headers: { authorization: `Bearer ${wk}`, 'content-type': 'application/json' }, body: JSON.stringify({ types: knownTypes() }) })).json()
  assert.equal(n.job.session, true)
  const call = async (p, body) => (await fetch(`${s.url}/api/k/dpms/worker/intake${p}`, { method: 'POST', headers: { authorization: `Bearer ${n.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })).json()
  const t = await call('/session')
  assert.match(t.token, /^kmda_/)
  assert.match(t.system, /^아래 「생성 룰」 이 이 일의 규칙이다/)
  assert.match(t.system, /생성 룰 1판/)
  assert.match(t.system, /R8 판례를 따름 · 가름 · 벗어남/)
  assert.match(t.prompt, /knowledge id: dpms\)/)
  assert.ok(t.files.some((f) => f.name === '둘째 통화.md' && Buffer.from(f.b64, 'base64').toString('utf8').includes('400ms')))
  // 그 지식만 — 다른 지식은 목록에도 없고 저장도 거절된다
  const b = await mcp(t.token, 'brief', {})
  assert.deepEqual(b.j.result.structuredContent.knowledge.map((x) => x.id), ['dpms'])
  const other = (await s.hub.list()).find((x) => x.id !== 'dpms')
  if (other) assert.equal((await mcp(t.token, 'save', { knowledge: other.id, record: { title: '엉뚱한 곳', body: 'x' } })).j.result.structuredContent.error, 'E_FORBIDDEN')
  // 과거 결정 카드를 세션이 받는다(match)
  const m = (await mcp(t.token, 'match', { q: '카나리', knowledge: 'dpms' })).j.result.structuredContent
  assert.ok(m.cards.some((c) => c.key === 'proc:카나리'))
  // 갈래 · 종류를 따로 세우는 입력은 거절(무인 저장 문)
  assert.equal((await mcp(t.token, 'save', { knowledge: 'dpms', record: { title: '갈래를 세운다', body: 'x' }, forms: [{ name: '새갈래' }] })).j.result.structuredContent.error, 'E_INPUT')
  // 세션이 아무것도 넣지 않고 끝났다 — 일감이 닫힌다(지금은 규칙 길로 · H4b 에서 다시 시도로 바꾼다)
  const d = await call('/done', { session: { ok: true, error: null, message: '', cost: 0.02 } })
  assert.ok(d.rule, JSON.stringify(d))
  // 끝난 일감의 열쇠는 끊긴다
  assert.equal((await mcp(t.token, 'brief', {})).status, 401)
  // 일감 열쇠가 아닌 손으로 지은 kmda_ 는 받지 않는다
  assert.equal((await mcp('kmda_' + 'x'.repeat(32), 'brief', {})).status, 401)
})
