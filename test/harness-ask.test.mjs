// 화면의 「넣을 것」 저장 제안(지식 생성 하네스 H6 · H-D33 · 설계 8-4).
//   사람이 화면으로 올린 파일 · 글은 세션이 지은 뒤 바로 들어가지 않는다: 저장 제안으로 서고(승인 대기 · 지식에는 아무것도 쓰지 않는다)
//   올린 사람 · 그 지식의 지식관리자가 보고 [넣기] 를 눌러야 들어간다. [버리기] 는 원천을 버린다. 가져올 곳 같은 무인 일감은 그대로 바로 들어간다.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { workOnce } from '../core/worker.js'
import { copyDir, signIn, seat } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, wk
const P = {}
const KD = () => path.join(tmp, 'kn', 'dpms')
const commits = () => (fs.existsSync(path.join(KD(), '.git')) ? Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: KD(), encoding: 'utf8' }).trim()) : 0) * 1000 + fs.readdirSync(path.join(KD(), 'work')).length
const jobs = () => s.hub.intakesOf('dpms')
const work = () => workOnce({ server: s.url, key: wk, log: () => {} })
const api = async (who, p, body) => {
  const r = await fetch(s.url + p, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: who.cookie, 'content-type': 'application/json', 'x-kmd': '1' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, j: await r.json().catch(() => null) }
}
const MEMO = (v) => `# 통화 메모\n\n## 원격 명령\n\n펄스 길이는 ${v}ms 다.\n`
const upload = (who, name, md) => s.hub.importFiles({ user: who }, 'dpms', [{ path: name, data: Buffer.from(md) }])

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-hask-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  delete process.env.KMD_CLAUDE
  delete process.env.FAKE_AGENT_SCRIPT
  process.env.KMD_CLAUDE_AGENT = path.join(HERE, 'fixture', 'fake-claude-agent.mjs')
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  wk = (await s.auth.workerAdd()).key
  P.kim = await signIn(s, { id: 'kim', admin: true })
  P.wr = await signIn(s, { id: 'wr', admin: false })
  P.w2 = await signIn(s, { id: 'w2', admin: false })
  await seat(s, 'wr', { dpms: 'write' })
  await seat(s, 'w2', { dpms: 'write' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('올린 것은 세션이 지은 뒤 승인 대기로 선다(아무것도 쓰지 않는다) · 올린 사람이 [넣기] 하면 기록 + 항목 글이 한 번에', async () => {
  const c0 = commits()
  const r = await upload('wr', '통화 메모 하나.md', MEMO(300))
  assert.ok(r.rows[0], JSON.stringify(r).slice(0, 300))
  const j = jobs().find((x) => x.state === 'queued')
  assert.equal(j.ask, true, '사람이 올린 파일은 저장 제안으로 선다')
  await work()
  const j1 = jobs().find((x) => x.id === j.id)
  assert.deepEqual([j1.state, j1.askN], ['ask', 1])
  assert.equal(commits(), c0, '승인 전에는 지식에 아무것도 쓰지 않는다')
  assert.equal(await work(), null, '승인 대기 일감은 일꾼에게 다시 가지 않는다')
  // 보기 — 올린 사람 · 지식관리자만
  const v = await api(P.wr, `/api/k/dpms/intake/${j.id}/ask`)
  assert.equal(v.status, 200)
  assert.match(v.j.items[0].text, /회의록/)
  assert.equal((await api(P.w2, `/api/k/dpms/intake/${j.id}/ask`)).status, 403, '다른 쓰기 자리 사람은 보지 못한다')
  assert.equal((await api(P.w2, `/api/k/dpms/intake/${j.id}/approve`, {})).status, 403)
  assert.equal((await api(P.kim, `/api/k/dpms/intake/${j.id}/ask`)).status, 200, '지식관리자는 본다')
  // 넣기 — 승인
  const a = await api(P.wr, `/api/k/dpms/intake/${j.id}/approve`, {})
  assert.equal(a.status, 200, JSON.stringify(a.j))
  assert.ok(a.j.rec, '기록이 섰다')
  assert.ok(commits() > c0)
  assert.equal(jobs().find((x) => x.id === j.id).state, 'done')
  const k = await s.hub.get('dpms')
  const w = k.byWork.get(a.j.rec)
  assert.equal(w.state, 'in')
  assert.equal(w.author, 'wr', '기록은 올린 사람의 것이다')
  assert.equal((await api(P.wr, `/api/k/dpms/intake/${j.id}/ask`)).status, 404, '넣은 뒤에는 제안이 없다')
})

test('[버리기] 는 원천을 버린다(지식에 아무것도 쓰지 않는다) · 무인 일감(가져올 곳 · 직접 연 일감)은 승인 없이 바로 들어간다', async () => {
  await upload('wr', '통화 메모 둘.md', MEMO(450))
  const j = jobs().find((x) => x.state === 'queued')
  await work()
  assert.equal(jobs().find((x) => x.id === j.id).state, 'ask')
  const c0 = commits()
  const d = await api(P.kim, `/api/k/dpms/intake/${j.id}/discard`, {})
  assert.deepEqual([d.status, d.j.state], [200, 'cancelled'])
  assert.equal(commits(), c0)
  // 서버 코드가 연 일감(ask 없음)은 그대로 바로 들어간다
  const o = await s.hub.openJob('dpms', { type: 'file', by: 'kim', src: { rel: '직접 연 메모.md', file: '직접 연 메모.md', title: '직접 연 메모.md', sha: 'b'.repeat(16) }, md: MEMO(500) })
  assert.equal(jobs().find((x) => x.id === o.job).ask, undefined)
  const r = await work()
  assert.equal(r.summary.put, 1)
  assert.equal(jobs().find((x) => x.id === o.job).state, 'done')
})

test('되돌림이 그 기록이 세운 장부 줄을 거둔다(지식관리자가 통째로 되돌릴 때): 항목 장부는 폐기 표시 · 문서 장부 줄은 걷는다', async () => {
  const o = await s.hub.openJob('dpms', { type: 'file', by: 'kim', src: { rel: '되돌릴 메모.md', file: '되돌릴 메모.md', title: '되돌릴 메모.md', sha: 'c'.repeat(16) }, md: MEMO(700) })
  await work()
  const j = jobs().find((x) => x.id === o.job)
  assert.equal(j.state, 'done', JSON.stringify([j.state, j.why]))
  s.hub.forget('dpms')
  let k = await s.hub.get('dpms')
  const w = k.byWork.get(j.result.rec)
  const made = [...w.body.matchAll(/^- 이름 (\S+)$/gm)].map((m) => m[1]).filter((c) => k.vocab.coords.has(c) && !k.vocab.coords.get(c).deprecated)
  if (!made.length) return // 앞 시험이 같은 항목을 이미 세웠으면 이 기록이 세운 장부 줄이 없다
  const reg = () => fs.readFileSync(path.join(KD(), '_managed.md'), 'utf8')
  assert.ok(made.some((c) => reg().includes(`\`${c}\``)))
  await s.hub.revert({ user: 'kim', admin: true }, 'dpms', { record: w.id })
  s.hub.forget('dpms')
  k = await s.hub.get('dpms')
  for (const c of made) {
    if (k.works.some((x) => x.id !== w.id && x.touches.includes(c))) continue
    assert.match(k.vocab.coords.get(c).deprecated || '', /세운 기록을 되돌림/, `${c} 폐기 표시`)
    assert.ok(!reg().includes(`| \`${c}\` |`), `${c} 의 문서 장부 줄을 걷었다`)
  }
})
