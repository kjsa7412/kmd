// 감시 단계 4 필수 — 소스 코드(git) 커밋 → 기록 → Claude 뜻 갱신(정정 2026-10-23: 소스 코드는 git 하나 · 커밋 이력으로).
//
// 더하면 지금 커밋이 기준(기록 0) / 새 커밋 → 커밋마다 기록 하나(제목은 커밋 메시지 · 바뀐 값 · 차이 · 걸린 이름) → 정리가 저절로 걸리고
// 일꾼(가짜 claude)이 항목 글의 값을 바꾼다 / 여러 커밋을 한 번에 — 코드가 안 바뀐 커밋 · 시험 파일은 기록하지 않는다 · 이름이 안 걸리면
// 이름 없는 기록 / 「Claude 에 보내지 않음」 지식은 기록만(정리는 걸지 않는다) / 코드 폴더 · 다시 맞추기 없음 · 예약 태그 code-change

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

test('소스 코드(git) — 지금 커밋이 기준 · 새 커밋마다 기록(커밋 메시지 · 바뀐 값 · 차이 · 이름) → 정리가 저절로 걸려 항목 글의 값이 바뀐다', async () => {
  const r0 = await s.hub.sourceAdd(ADMIN, 'dpms', { name: 'api 코드', kind: 'git', at: repo, every: 'manual' })
  assert.deepEqual(r0.source.rules, [], '무엇을 채우나가 없다 — 커밋만 본다')
  assert.equal(r0.run[0].codeRecords, 0, '처음은 기준만 — 기록 0')
  assert.match((await s.hub.sources(ADMIN, 'dpms')).find((x) => x.name === 'api 코드').state.lastNote, /^기준 묶음 [0-9a-f]{7}/)

  W(path.join(repo, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 5초\nclass HealthCheck {\n  int timeoutSec = 5;\n}\n')
  W(path.join(repo, 'test', 'HealthCheckTest.java'), '// 시험은 보지 않는다 — 고침\n')
  commit('헬스 체크 시간 초과를 늘림')
  const r1 = (await s.hub.sourceRun('dpms', 'api 코드'))[0]
  assert.equal(r1.commits, 1)
  assert.equal(r1.codeRecords, 1)
  const [rec] = await codeRecs('dpms')
  assert.match(rec.title, /^헬스 체크 시간 초과를 늘림 — api 코드 [0-9a-f]{7}$/, '제목은 커밋 메시지')
  assert.deepEqual(rec.touches, ['proc:헬스 체크'])
  assert.match(rec.body, /^바뀐 값: 3초 → 5초 — HealthCheck\.java/)
  assert.match(rec.body, /api 코드 · 묶음 [0-9a-f]{7} · 박개발 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  assert.match(rec.body, /```diff\n# HealthCheck\.java[\s\S]*-\/\/ 헬스 체크 — 시간 초과는 3초[\s\S]*\+\/\/ 헬스 체크 — 시간 초과는 5초/)
  assert.ok(!rec.body.includes('HealthCheckTest'), '시험 파일은 보지 않는다')
  assert.equal(rec.author, 'kmd')
  assert.equal(rec.state, 'pend')
  assert.ok(rec.path.startsWith('work/'), '커밋 기록은 기록(지식이 될 글) — 이력이 아니다')

  // 정리가 저절로 걸렸다 → 일꾼(가짜 claude)이 항목 글의 3초 를 5초 로
  const job = s.hub.jobsOf('dpms').find((j) => j.state === 'queued')
  assert.ok(job && job.auto, '정리가 저절로 걸렸다')
  await workOnce({ server: s.url, key: (await s.auth.workerAdd()).key })
  assert.equal(s.hub.job(job.id).state, 'done')
  assert.match(section('dpms', '배포절차', '헬스 체크'), /시간 초과는 5초 — 5초 안에 200/)
  assert.equal((await s.hub.get('dpms')).byWork.get(rec.id).state, 'in')

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
  const recs = await codeRecs('dpms')
  const util = recs.find((w) => w.title.startsWith('Util 빈 값 처리'))
  assert.deepEqual(util.touches, [])
  assert.equal(util.state, 'nowhere')
  const can = recs.find((w) => w.title.startsWith('카나리 비율 올림'))
  assert.deepEqual(can.touches, ['proc:카나리'])
  assert.match(can.body, /^바뀐 값: 10% → 20%/)
  // 그대로면 0
  assert.equal((await s.hub.sourceRun('dpms', 'api 코드'))[0].state, 'same')
})

test('「Claude 에 보내지 않음」 지식은 기록만 · 코드 폴더 · 다시 맞추기는 없다 · 예약 태그는 사람이 못 단다', async () => {
  await s.hub.setOwner(SHELL, 'dpms', { noClaude: true })
  const queued = () => s.hub.jobsOf('dpms').filter((j) => j.state === 'queued').length
  const q0 = queued()
  W(path.join(repo, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 7초\nclass HealthCheck {\n  int timeoutSec = 7;\n}\n')
  commit('헬스 체크 7초')
  const r = (await s.hub.sourceRun('dpms', 'api 코드'))[0]
  assert.equal(r.codeRecords, 1, '기록은 남는다 — 무엇이 바뀌었나는 지식')
  assert.equal(queued(), q0, '정리(Claude)는 걸지 않는다')
  assert.equal((await s.hub.sources(ADMIN, 'dpms')).find((x) => x.name === 'api 코드').meaningBlocked, true)
  await s.hub.setOwner(SHELL, 'dpms', { noClaude: false })

  await assert.rejects(s.hub.sourceAdd(ADMIN, 'dpms', { name: '폴더', kind: 'folder', at: repo, rules: [] }), { code: 'E_INPUT' }, '코드 폴더는 없다 — git 으로')
  await assert.rejects(s.hub.sourceResync(ADMIN, 'dpms', 'api 코드'), { code: 'E_INPUT' }, '커밋으로 본다 — 다시 맞출 것이 없다')
  await assert.rejects(s.hub.save(ADMIN, 'dpms', { record: { title: '흉내', body: 'x', tags: ['code-change'] } }), { code: 'E_FORBIDDEN' })
})
