// 감시 단계 4 필수 — 소스 변경 → 기록 → Claude 뜻 갱신.
//
// 뜻 갱신 켬 → 처음은 사본만 / 코드 한 파일 고침 → 기록 하나(바뀐 값 · 차이 · 걸린 이름) → 정리가 저절로 걸리고 일꾼(가짜 claude)이
// 항목 글의 값을 바꾼다 / 이름이 안 걸리는 코드 → 이름 없는 기록 / git 도 커밋 차이로 / 「Claude 에 보내지 않음」 지식 → 기록 0 /
// 예약 태그 code-change 는 사람이 못 단다

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
let tmp, s, src, repo
const ADMIN = { user: 'kim', admin: true }
const W = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }
const G = (dir, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim()
const codeRecs = async (kn) => (await s.hub.get(kn)).works.filter((w) => w.tags.includes('code-change'))
const section = (kn, doc, h) => fs.readFileSync(path.join(tmp, 'kn', kn, 'docs', `${doc}.md`), 'utf8').split(`## ${h}`)[1].split('\n## ')[0]

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-meaning-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  src = path.join(tmp, 'src', 'api')
  W(path.join(src, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 3초\nclass HealthCheck {\n  int timeoutSec = 3;\n}\n')
  W(path.join(src, 'Util.java'), '// 문자열 도우미\nclass Util { static String trim(String s) { return s.trim(); } }\n')
  W(path.join(src, 'test', 'HealthCheckTest.java'), '// 시험은 보지 않는다\n')
  repo = path.join(tmp, 'src', 'repo')
  W(path.join(repo, 'Canary.java'), '// 카나리 — 첫 30분 요청의 10%\nclass Canary { int pct = 10; }\n')
  G(repo, 'init', '-q', '-b', 'main')
  G(repo, 'add', '-A')
  G(repo, 'commit', '-q', '-m', 'c1')
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ sourceRoots: [path.join(tmp, 'src')], decideMs: 3600000, sourceTickMs: 3600000, tidyTickMs: 3600000, watchQuietMs: 600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('코드 폴더 — 바뀐 파일마다 기록(바뀐 값 · 차이 · 이름) → 정리가 저절로 걸려 항목 글의 값이 바뀐다', async () => {
  const r0 = await s.hub.sourceAdd(ADMIN, 'dpms', { name: 'api 코드', kind: 'folder', at: src, every: 'manual', meaning: true, rules: [{ rule: 'deps', into: { doc: '라이브러리' } }] })
  assert.equal(r0.source.meaning, true)
  assert.equal(r0.run[0].codeRecords || 0, 0, '처음은 사본만 — 기록 0')

  W(path.join(src, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 5초\nclass HealthCheck {\n  int timeoutSec = 5;\n}\n')
  W(path.join(src, 'test', 'HealthCheckTest.java'), '// 시험은 보지 않는다 — 고침\n')
  const r1 = (await s.hub.sourceRun('dpms', 'api 코드'))[0]
  assert.equal(r1.codeRecords, 1, '시험 폴더는 보지 않는다')
  const [rec] = await codeRecs('dpms')
  assert.match(rec.title, /^코드가 바뀌었다 — HealthCheck\.java \(\+2 −2\)$/)
  assert.deepEqual(rec.touches, ['proc:헬스 체크'])
  assert.match(rec.body, /바뀐 값: 3초 → 5초/)
  assert.match(rec.body, /```diff[\s\S]*-\/\/ 헬스 체크 — 시간 초과는 3초[\s\S]*\+\/\/ 헬스 체크 — 시간 초과는 5초/)
  assert.equal(rec.author, 'kmd')
  assert.equal(rec.state, 'pend')

  // 정리가 저절로 걸렸다 → 일꾼(가짜 claude)이 항목 글의 3초 를 5초 로
  const job = s.hub.jobsOf('dpms').find((j) => j.state === 'queued')
  assert.ok(job && job.auto, '정리가 저절로 걸렸다')
  await workOnce({ server: s.url, key: (await s.auth.workerAdd()).key })
  assert.equal(s.hub.job(job.id).state, 'done')
  assert.match(section('dpms', '배포절차', '헬스 체크'), /시간 초과는 5초 — 5초 안에 200/)
  assert.equal((await s.hub.get('dpms')).byWork.get(rec.id).state, 'in')

  // 이름이 안 걸리는 코드 → 이름 없는 기록(정리 일꾼이 후보 중에서 고른다)
  W(path.join(src, 'Util.java'), '// 문자열 도우미\nclass Util { static String trim(String s) { return s == null ? "" : s.trim(); } }\n')
  assert.equal((await s.hub.sourceRun('dpms', 'api 코드'))[0].codeRecords, 1)
  const util = (await codeRecs('dpms')).find((w) => /Util\.java/.test(w.title))
  assert.deepEqual(util.touches, [])
  assert.equal(util.state, 'nowhere')
})

test('git — 커밋 차이로 기록 · 「Claude 에 보내지 않음」 지식은 기록 0 · 예약 태그는 사람이 못 단다', async () => {
  const r0 = await s.hub.sourceAdd(ADMIN, 'dpms', { name: 'repo 코드', kind: 'git', at: repo, every: 'manual', meaning: true, rules: [{ rule: 'deps', into: { doc: '라이브러리 2' } }] })
  assert.equal(r0.run[0].codeRecords || 0, 0)
  W(path.join(repo, 'Canary.java'), '// 카나리 — 첫 30분 요청의 20%\nclass Canary { int pct = 20; }\n')
  G(repo, 'commit', '-q', '-am', 'c2')
  assert.equal((await s.hub.sourceRun('dpms', 'repo 코드'))[0].codeRecords, 1)
  const rec = (await codeRecs('dpms')).find((w) => /Canary\.java/.test(w.title))
  assert.deepEqual(rec.touches, ['proc:카나리'])
  assert.match(rec.body, /바뀐 값: 10% → 20%/)

  // Claude 에 보내지 않는 지식 — 뜻 갱신을 켜 두어도 기록하지 않는다(표는 그대로 채운다)
  await s.hub.setOwner(SHELL, 'dpms', { noClaude: true })
  const before = (await codeRecs('dpms')).length
  W(path.join(src, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 7초\nclass HealthCheck {\n  int timeoutSec = 7;\n}\n')
  const r = (await s.hub.sourceRun('dpms', 'api 코드'))[0]
  assert.equal(r.codeRecords || 0, 0)
  assert.equal((await codeRecs('dpms')).length, before)
  assert.equal((await s.hub.sources(ADMIN, 'dpms')).find((x) => x.name === 'api 코드').meaningBlocked, true)
  await s.hub.setOwner(SHELL, 'dpms', { noClaude: false })

  await assert.rejects(s.hub.save(ADMIN, 'dpms', { record: { title: '흉내', body: 'x', tags: ['code-change'] } }), { code: 'E_FORBIDDEN' })
  // 끄기 — 표만 채운다
  await s.hub.sourceMeaning(ADMIN, 'dpms', { name: 'repo 코드', on: false })
  assert.equal((await s.hub.sources(ADMIN, 'dpms')).find((x) => x.name === 'repo 코드').meaning, undefined)
})
