// 기록 고치기(S9 · K4-2 ~ K4-4 · docs/품질개선/KMD_개편_설계.md 3-6 · 4-3 · S-D23)
//
// 옛 값이 그 항목에 한 곳 → 규칙으로 정정 기록 + 조각 한 저장(커밋 하나 · Claude 0번) · 원 기록은 그대로 · recView.fixedBy ·
// 두 곳 → 들이기 일감 fix → 팀 일꾼(가짜 claude) → 정정 기록 + 조각 한 저장 · 남의 기록 정정은 쓰기 자리 403 · 내 기록은 쓰기 자리도 ·
// 들어간 항목이 없으면 정정 기록만 + 넣지 못함(nosec) · GET 이면 405 · 옛 값 = 새 값이면 400

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { workOnce } from '../core/worker.js'
import * as V from '../server/views.js'
import { sha16 } from '../core/text.js'
import { sectionOf } from '../core/knowledge.js'
import { copyDir, seat, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, wk, lee
const KIM = { user: 'kim', admin: true }
const LEE = { user: 'lee' }
const KD = () => path.join(tmp, 'kn', 'dpms')
const G = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', '-c', 'core.autocrlf=false', ...a], { cwd: KD(), encoding: 'utf8' }).trim()
const commits = () => Number(G('rev-list', '--count', 'HEAD'))
const section = (doc, h) => fs.readFileSync(path.join(KD(), 'docs', `${doc}.md`), 'utf8').split(`## ${h}`)[1].split('\n## ')[0]
const fresh = async () => { s.hub.forget?.('dpms'); return s.hub.get('dpms') }
const code = async (p) => p.then(() => 'ok', (e) => e.code)

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-fix-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  // 커밋 수를 세려고 처음 판을 먼저 세운다
  G('init', '-q', '-b', 'main')
  G('add', '-A')
  G('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', '처음')
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sourceTickMs: 3600000, tidyTickMs: 3600000, jobTickMs: 3600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  await s.auth.addUser({ id: 'kim', admin: true })
  lee = await signIn(s, { id: 'lee', admin: false })
  await seat(s, 'lee', { dpms: 'write' })
  wk = (await s.auth.workerAdd()).key
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('규칙: 옛 값이 그 항목에 한 곳 → 정정 기록 + 조각 한 저장(커밋 하나 · Claude 0번) · 원 기록은 그대로 · fixedBy', async () => {
  const log = path.join(tmp, 'calls-rule.log')
  process.env.FAKE_CLAUDE_LOG = log
  try {
    const orig = fs.readFileSync(path.join(KD(), 'work', '2026-1017-카나리.md'), 'utf8')
    const c0 = commits()
    const r = await s.hub.fixRecord(KIM, 'dpms', '2026-1017-카나리', { body: '첫 30분은 20% 로 바꿨다.', from: '10%', to: '20%' })
    assert.deepEqual([r.put, r.held, r.job], [1, 0, undefined], JSON.stringify(r))
    assert.equal(commits(), c0 + 1, '저장 한 번 = 커밋 하나')
    assert.ok(!fs.existsSync(log), 'Claude 를 부르지 않았다')
    assert.match(section('배포절차', '카나리'), /첫 30분은 요청의 20% 만 보낸다/)
    assert.doesNotMatch(section('배포절차', '카나리'), /10%/)
    assert.equal(fs.readFileSync(path.join(KD(), 'work', '2026-1017-카나리.md'), 'utf8'), orig, '원 기록은 그대로')
    const k = await fresh()
    const w = k.byWork.get(r.id)
    assert.equal(w.title, '정정: 카나리 — 첫 30분은 10%')
    assert.deepEqual(w.fixes, ['2026-1017-카나리'])
    assert.equal(w.author, 'kim')
    assert.ok(w.tags.includes('put') && !w.tags.includes('held'), w.tags.join(' '))
    assert.match(w.body, /## 바뀐 것\n- 10% → 20%/)
    assert.match(w.body, /## 넣은 것\n- docs\/배포절차\.md › 카나리/)
    assert.ok(V.recView(k, '2026-1017-카나리').fixedBy.some((x) => x.id === r.id), '원 기록 화면에 「바로잡음」')
    // 측정 줄 — 채널 fix
    const sl = fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'savelog', 'dpms.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop()
    assert.equal(sl.ch, 'fix')
  } finally { delete process.env.FAKE_CLAUDE_LOG }
})

test('규칙이 못 하면(두 곳): 저장하지 않고 일감 fix → 팀 일꾼 → 정정 기록 + 조각 한 저장', async () => {
  const log = path.join(tmp, 'calls-job.log')
  process.env.FAKE_CLAUDE_LOG = log
  try {
    const c0 = commits()
    const r = await s.hub.fixRecord(KIM, 'dpms', '2026-1021-헬스-체크', { body: '시간 초과를 5초로 늘렸다.', from: '3초', to: '5초' })
    assert.ok(r.job, JSON.stringify(r))
    assert.equal(commits(), c0, '일꾼 전에는 쓰지 않는다')
    // 같은 기록을 다시 고쳐도 일감은 하나
    const again = await s.hub.fixRecord(KIM, 'dpms', '2026-1021-헬스-체크', { body: '시간 초과를 5초로 늘렸다.', from: '3초', to: '5초' })
    assert.equal(again.job, r.job)
    const a = await workOnce({ server: s.url, key: wk })
    assert.equal(a.job.id, r.job)
    assert.ok(fs.readFileSync(log, 'utf8').includes('fix-record'), '정정 프롬프트')
    assert.equal(commits(), c0 + 1, '저장 한 번 = 커밋 하나')
    const job = s.hub.job(r.job)
    assert.equal(job.state, 'done', JSON.stringify(job))
    assert.equal(job.result.held, 0, JSON.stringify(job))
    const sec = section('배포절차', '헬스 체크')
    assert.match(sec, /시간 초과는 5초 — 5초 안에 200/)
    assert.doesNotMatch(sec, /3초/)
    const w = (await fresh()).byWork.get(job.result.rec)
    assert.deepEqual(w.fixes, ['2026-1021-헬스-체크'])
    assert.equal(w.author, 'kim')
    assert.ok(w.tags.includes('intake') && w.tags.includes(`job/${r.job}`) && w.tags.includes('put'), w.tags.join(' '))
  } finally { delete process.env.FAKE_CLAUDE_LOG }
})

test('자리: 남의 기록 정정은 쓰기 자리 403 · 내 기록은 쓰기 자리도 · 들어간 항목이 없으면 정정 기록만 + 넣지 못함(nosec)', async () => {
  assert.equal(await code(s.hub.fixRecord(LEE, 'dpms', '2026-1017-카나리', { body: '남의 기록', from: '20%', to: '25%' })), 'E_FORBIDDEN')
  // lee 가 쓴 기록(항목에 들어감) → lee 가 고친다
  const base = sha16(sectionOf(await fresh(), 'term:알람').sec.body)
  const mine = await s.hub.save(LEE, 'dpms', { record: { title: '알람: 당번 채널', body: '## 바뀐 것\n- 받는 곳: #ops-oncall 더함' }, sections: [{ coord: 'term:알람', base, content: 'CPU 경고는 85% 에서 울린다. 알람 받는 곳은 운영 채널 #ops-alert · 당번 채널 #ops-oncall.' }] })
  assert.equal(mine.put, 1, JSON.stringify(mine))
  const r = await s.hub.fixRecord(LEE, 'dpms', mine.id, { body: '경고 기준을 90% 로', from: '85%', to: '90%' })
  assert.deepEqual([r.put, r.held], [1, 0], JSON.stringify(r))
  assert.match(fs.readFileSync(path.join(KD(), 'docs', '운영.md'), 'utf8'), /CPU 경고는 90% 에서 울린다/)
  // 들어간 항목이 없는 기록(메모) — 정정 기록만 + 넣지 못함
  const memo = await s.hub.save(LEE, 'dpms', { record: { title: '알람 메모', body: '경고 소리 10초', touchesEmpty: '시험 메모' } })
  const n = await s.hub.fixRecord(LEE, 'dpms', memo.id, { body: '소리는 20초', from: '10초', to: '20초' })
  assert.deepEqual([n.put, n.held], [0, 1], JSON.stringify(n))
  const w = (await fresh()).byWork.get(n.id)
  assert.ok(w.tags.includes('held'), w.tags.join(' '))
  assert.equal(w.state, 'held')
  // 이력(log/) 기록은 고치지 않는다 · 없는 기록
  assert.equal(await code(s.hub.fixRecord(KIM, 'dpms', '없는-기록', { body: 'x', from: 'a', to: 'b' })), 'E_NOTFOUND')
})

test('길: POST 만(GET 405) · 옛 값 = 새 값이면 400 · 읽기 자리 403', async () => {
  const at = (rec) => `${s.url}/api/k/dpms/rec/${encodeURIComponent(rec)}/fix`
  const g = await fetch(at('2026-1017-카나리'), { headers: { cookie: lee.cookie } })
  assert.equal(g.status, 405)
  const post = (body, cookie = lee.cookie) => fetch(at('2026-1023-롤백-순서'), { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const same = await post({ body: '같은 값', from: '3', to: '3' })
  assert.equal(same.status, 400)
  const half = await post({ body: '옛 값만', from: '3' })
  assert.equal(half.status, 400)
  await seat(s, 'lee', { dpms: 'read' })
  try {
    const rd = await post({ body: '읽기 자리', from: '3', to: '4' })
    assert.equal(rd.status, 403)
  } finally { await seat(s, 'lee', { dpms: 'write' }) }
})
