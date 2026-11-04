// 감시 단계 4 필수 — 소스 코드(git) 커밋 → 기록 → Claude 뜻 갱신(정정 2026-10-23: 소스 코드는 git 하나 · 커밋 이력으로).
//
// 더하면 지금 커밋이 기준(기록 0) / 새 커밋 → 커밋마다 들이기 일감 하나(S7 · 정리 일감 0) → 팀 일꾼(가짜 claude)이 기록과 항목 글을 저장 한 번에
// (기록에 원천: 바뀐 값 · 차이 · 걸린 이름) / 여러 커밋을 한 번에 — 코드가 안 바뀐 커밋 · 시험 파일은 보지 않는다 · 넣을 항목이 없는 커밋은
// 기록만 + 넣지 못함 / 「Claude 에 보내지 않음」 지식은 일감 없이 기록만 + 넣지 못함 / 코드 폴더 · 다시 맞추기 없음 · 예약 태그 code-change

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { workOnce } from '../core/worker.js'
import { copyDir } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, repo
const ADMIN = { user: 'kim', admin: true }
const W = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }
const G = (dir, ...a) => execFileSync('git', ['-c', 'user.name=박개발', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim()
const commit = (msg) => { G(repo, 'add', '-A'); G(repo, 'commit', '-q', '-m', msg) }
const codeRecs = async (kn) => (await s.hub.get(kn)).works.filter((w) => w.tags.includes('code-change'))
const section = (kn, doc, h) => fs.readFileSync(path.join(tmp, 'kn', kn, 'docs', `${doc}.md`), 'utf8').split(`## ${h}`)[1].split('\n## ')[0]

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-meaning-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  repo = path.join(tmp, 'src', 'repo')
  W(path.join(repo, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 3초\nclass HealthCheck {\n  int timeoutSec = 3;\n}\n')
  W(path.join(repo, 'Util.java'), '// 문자열 도우미\nclass Util { static String trim(String s) { return s.trim(); } }\n')
  W(path.join(repo, 'test', 'HealthCheckTest.java'), '// 시험은 보지 않는다\n')
  W(path.join(repo, 'Canary.java'), '// 카나리 — 첫 30분 요청의 10%\nclass Canary { int pct = 10; }\n')
  G(repo, 'init', '-q', '-b', 'main')
  commit('처음')
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ sourceRoots: [path.join(tmp, 'src')], decideMs: 3600000, sourceTickMs: 3600000, tidyTickMs: 3600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('소스 코드(git): 지금 커밋이 기준 · 새 커밋마다 들이기 일감 → 팀 일꾼이 기록 + 항목 글(값이 바뀐다)을 한 번에', async () => {
  const r0 = await s.hub.sourceAdd(ADMIN, 'dpms', { name: 'api 코드', kind: 'git', at: repo, every: 'manual' })
  assert.deepEqual(r0.source.rules, [], '무엇을 채우나가 없다. 커밋만 본다')
  assert.equal(r0.run[0].codeRecords, 0, '처음은 기준만: 기록 0')
  assert.match((await s.hub.sources(ADMIN, 'dpms')).find((x) => x.name === 'api 코드').state.lastNote, /^기준 묶음 [0-9a-f]{7}/)

  W(path.join(repo, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 5초\nclass HealthCheck {\n  int timeoutSec = 5;\n}\n')
  W(path.join(repo, 'test', 'HealthCheckTest.java'), '// 시험은 보지 않는다 — 고침\n')
  commit('헬스 체크 시간 초과를 늘림')
  const r1 = (await s.hub.sourceRun('dpms', 'api 코드'))[0]
  assert.equal(r1.commits, 1)
  assert.equal(r1.codeRecords, 1)
  assert.equal(r1.queued, 1)
  assert.equal(s.hub.jobsOf('dpms').length, 0, '정리 일감은 세우지 않는다')
  assert.deepEqual(await codeRecs('dpms'), [], '기록은 일꾼이 기록 + 항목 글을 한 번에 지을 때')
  const job = s.hub.intakesOf('dpms').find((j) => j.state === 'queued')
  assert.ok(job && job.auto && job.type === 'commit')
  // 팀 일꾼(가짜 claude) — 항목 글의 3초 를 5초 로 · 기록과 한 저장
  const wk = (await s.auth.workerAdd()).key
  await workOnce({ server: s.url, key: wk })
  assert.equal(s.hub.job(job.id).state, 'done')
  assert.match(section('dpms', '배포절차', '헬스 체크'), /시간 초과는 5초 — 5초 안에 200/)
  const [rec] = await codeRecs('dpms')
  assert.deepEqual(rec.touches, ['proc:헬스 체크'])
  assert.match(rec.body, /^## 바뀐 것\n- 헬스 체크: 3초 → 5초/m)
  assert.match(rec.body, /## 원천\n- 커밋 [0-9a-f]{7} · api 코드/)
  assert.match(rec.body, /> 바뀐 값: 3초 → 5초: HealthCheck\.java/)
  assert.match(rec.body, /api 코드 · 묶음 [0-9a-f]{7} · 박개발 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  assert.match(rec.body, /> ```diff\n> # HealthCheck\.java[\s\S]*-\/\/ 헬스 체크 — 시간 초과는 3초[\s\S]*\+\/\/ 헬스 체크 — 시간 초과는 5초/)
  assert.ok(!rec.body.includes('HealthCheckTest'), '시험 파일은 보지 않는다')
  assert.equal(rec.author, 'kmd')
  assert.ok(rec.tags.includes('intake') && rec.tags.includes(`job/${job.id}`))
  assert.equal(rec.state, 'in')
  assert.ok(rec.path.startsWith('work/'), '커밋 기록은 기록(지식이 될 글): 이력이 아니다')

  // 여러 커밋을 한 번에 — 커밋마다 기록 · 코드가 안 바뀐 커밋은 기록하지 않는다 · 이름이 안 걸리면 이름 없는 기록
  W(path.join(repo, 'Util.java'), '// 문자열 도우미\nclass Util { static String trim(String s) { return s == null ? "" : s.trim(); } }\n')
  commit('Util 빈 값 처리')
  W(path.join(repo, 'README.md'), '# 설명만\n')
  commit('설명 글')
  W(path.join(repo, 'Canary.java'), '// 카나리 — 첫 30분 요청의 20%\nclass Canary { int pct = 20; }\n')
  commit('카나리 비율 올림')
  const r2 = (await s.hub.sourceRun('dpms', 'api 코드'))[0]
  assert.equal(r2.commits, 3)
  assert.equal(r2.codeRecords, 2, '설명 글 커밋은 코드가 안 바뀌었다')
  while (s.hub.intakesOf('dpms').some((j) => j.state === 'queued')) await workOnce({ server: s.url, key: wk })
  const recs = await codeRecs('dpms')
  // 넣을 항목이 없는 커밋 — 기록만 + 넣지 못함(넣을 곳을 고르지 않았다 · 정리가 집지 않는다)
  const util = recs.find((w) => w.title.startsWith('Util 빈 값 처리'))
  assert.deepEqual(util.touches, [])
  assert.equal(util.state, 'held')
  assert.match(util.body, /"code": ?"notfound"/)
  const can = recs.find((w) => w.title.startsWith('카나리 비율 올림'))
  assert.deepEqual(can.touches, ['proc:카나리'])
  assert.match(can.body, /> 바뀐 값: 10% → 20%/)
  assert.equal(can.state, 'in')
  assert.match(section('dpms', '배포절차', '카나리'), /요청의 20% 만/)
  // 그대로면 0
  assert.equal((await s.hub.sourceRun('dpms', 'api 코드'))[0].state, 'same')
})

test('「Claude 에 보내지 않음」 지식은 일감 없이 기록만 + 넣지 못함 · 코드 폴더 · 다시 맞추기는 없다 · 예약 태그는 사람이 못 단다', async () => {
  await s.hub.setOwner(SHELL, 'dpms', { noClaude: true })
  const queued = () => s.hub.intakesOf('dpms').filter((j) => j.state === 'queued').length + s.hub.jobsOf('dpms').filter((j) => j.state === 'queued').length
  const q0 = queued()
  W(path.join(repo, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 7초\nclass HealthCheck {\n  int timeoutSec = 7;\n}\n')
  commit('헬스 체크 7초')
  const r = (await s.hub.sourceRun('dpms', 'api 코드'))[0]
  assert.equal(r.codeRecords, 1, '기록은 남는다. 무엇이 바뀌었나는 지식')
  assert.equal(r.held, 1)
  assert.equal(queued(), q0, '들이기(Claude) 일감은 세우지 않는다')
  const w7 = (await codeRecs('dpms')).find((w) => w.body.includes('> 바뀐 값: 5초 → 7초'))
  assert.match(w7.body, /"code": ?"noclaude"/)
  assert.equal((await s.hub.sources(ADMIN, 'dpms')).find((x) => x.name === 'api 코드').meaningBlocked, true)
  await s.hub.setOwner(SHELL, 'dpms', { noClaude: false })

  await assert.rejects(s.hub.sourceAdd(ADMIN, 'dpms', { name: '폴더', kind: 'folder', at: repo, rules: [] }), { code: 'E_INPUT' }, '코드 폴더는 없다. git 으로')
  await assert.rejects(s.hub.sourceResync(ADMIN, 'dpms', 'api 코드'), { code: 'E_INPUT' }, '커밋으로 본다. 다시 맞출 것이 없다')
  await assert.rejects(s.hub.save(ADMIN, 'dpms', { record: { title: '흉내', body: 'x', tags: ['code-change'] } }), { code: 'E_FORBIDDEN' })
})
