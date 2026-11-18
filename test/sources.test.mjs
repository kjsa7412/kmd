// E6 필수 — 자동으로 가져오는 곳(폴더 원천 · 닫힌 규칙 · 바뀐 것만 · 브레이크 · 대상 제한 · 기계 열쇠).
//
// 같은 원천 두 번 → 묶음 0 · 옛 표가 규칙 결과와 같으면 블록으로 · 바뀐 판 → 묶음 1 · 사라짐 10% 초과 → 묶음 0 · 멈춤 줄 ·
// ext:: · file:// · 허락 밖 폴더 · 지식 폴더 거절 · 자격 든 주소 → 선언 · 로그에 0 · 세션은 표를 못 고친다 · 기계 열쇠 길.
// 코드 폴더 · 표 규칙은 새로 더하지 않는다(소스 코드는 git 커밋으로) — 표 엔진(DB · 바깥 생성기가 쓴다)은 예전 선언을 직접 적어 본다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { copyDir, signIn, seat } from './helpers.mjs'
import { editDecl } from '../core/sources.js'
import { sha16 } from '../core/text.js'
import { sectionOf } from '../core/knowledge.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, me, src, kdir
const ADMIN = { user: 'kim', admin: true }
const code = async (p) => p.then(() => 'ok', (e) => e.code)
const commits = () => Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: kdir, encoding: 'utf8' }).trim())
const doc = (n) => fs.readFileSync(path.join(kdir, 'docs', `${n}.md`), 'utf8')
const pkg = (deps) => fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'dpms-api', dependencies: deps }, null, 2))

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-e6-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  kdir = path.join(tmp, 'kn', 'dpms')
  src = path.join(tmp, 'src', 'dpms-api')
  fs.mkdirSync(path.join(src, 'data'), { recursive: true })
  pkg({ 'spring-boot': '3.3.4', 'mybatis-spring': '3.0.3', postgresql: '42.7.4', 'jackson-databind': '2.17.2' })
  for (let i = 1; i <= 12; i++) fs.writeFileSync(path.join(src, 'data', `코드${String(i).padStart(2, '0')}.csv`), `코드,이름\nC${i}A,가${i}\nC${i}B,나${i}\n`)
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ sourceRoots: [path.join(tmp, 'src')], decideMs: 3600000, sourceTickMs: 3600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  me = await signIn(s, { id: 'kim' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

// 가져온 표는 원천이다(지식 생성 하네스 H4d · H-D32) — 코드는 표를 문서에 바로 쓰지 않고, 바뀐 표만 원천 글로 지어 들이기 일감으로 넘긴다
const srcJobs = () => s.hub.intakesOf('dpms').filter((j) => String(j.src?.rel || '').startsWith('가져올 곳/dpms-api 코드/'))
const mdOf = (j) => fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'queue', `${j.id}.md`), 'utf8')
test('잇기: 바뀐 표만 원천 글로 들이기에 넘긴다(문서에 바로 쓰지 않는다) · 같은 원천 두 번 → 일감 0 · 바뀐 판 → 그 표만', async () => {
  // 코드 폴더는 새로 더하지 못한다 — 예전 선언은 그대로 돈다
  assert.equal(await code(s.hub.sourceAdd(ADMIN, 'dpms', { name: 'x', kind: 'folder', at: src, rules: [] })), 'E_INPUT')
  await editDecl(kdir, (cur) => [...cur, { name: 'dpms-api 코드', kind: 'folder', at: src, every: 'hourly', rules: [{ rule: 'deps', into: { doc: '배포절차', heading: '꾸러미 판' } }, { rule: 'tables', paths: ['data'], into: { doc: '코드표' } }], by: 'kim', since: '2026-10-23' }], { user: 'kim', title: '가져오는 곳 더함. dpms-api 코드' })
  s.hub.forget('dpms')
  const n0 = commits()
  const before = doc('배포절차')
  const r = await s.hub.sourceRun('dpms', 'dpms-api 코드', { first: true })
  assert.equal(r[0].state, 'changed')
  assert.deepEqual([commits(), doc('배포절차')], [n0, before], '코드는 지식에 아무것도 쓰지 않는다')
  const j1 = srcJobs()
  assert.equal(j1.length, 1, '표 13 은 한 원천(15 까지)')
  const md = mdOf(j1[0])
  assert.match(md, /^# 가져옴: dpms-api 코드\(/)
  assert.match(md, /## 꾸러미 판\n\n자리: 배포절차 › 꾸러미 판/)
  assert.match(md, /\| spring-boot \| 3\.3\.4 \|/)
  assert.equal((md.match(/^## 코드\d\d$/gm) || []).length, 12)
  const again = await s.hub.sourceRun('dpms', 'dpms-api 코드')
  assert.equal(again[0].state, 'same')
  assert.equal(srcJobs().length, 1, '같은 원천 두 번 → 일감 0')
  pkg({ 'spring-boot': '3.3.5', 'mybatis-spring': '3.0.3', postgresql: '42.7.4', 'jackson-databind': '2.17.2' })
  const ch = await s.hub.sourceRun('dpms', 'dpms-api 코드')
  assert.equal(ch[0].n, 1)
  const j2 = srcJobs().filter((j) => j.id !== j1[0].id)
  assert.equal(j2.length, 1)
  const md2 = mdOf(j2[0])
  assert.match(md2, /\| spring-boot \| 3\.3\.5 \|/)
  assert.equal((md2.match(/^## /gm) || []).length, 1, '바뀐 표만 보낸다')
  assert.equal(commits(), n0)
})

test('브레이크: 사라짐 10% 초과면 넘기지 않고 멈춤 줄 · [그대로 반영] 은 「원천에서 없어진 것」 을 원천 글에', async () => {
  for (const i of [1, 2, 3]) fs.rmSync(path.join(src, 'data', `코드0${i}.csv`))
  const n = srcJobs().length
  const r = await s.hub.sourceRun('dpms', 'dpms-api 코드')
  assert.equal(r[0].state, 'stopped')
  assert.equal(srcJobs().length, n)
  const st = await s.hub.stops(ADMIN)
  assert.ok(st.some((l) => l.kind === 'source' && /항목 3개가 한꺼번에 사라졌다/.test(l.text)))
  const f = await s.hub.sourceRun('dpms', 'dpms-api 코드', { force: true })
  assert.equal(f[0].state, 'changed')
  const last = srcJobs().slice(-1)[0]
  assert.match(mdOf(last), /## 원천에서 없어진 것\n\n- 코드표 › 코드01: \d{4}-\d{2}-\d{2} 확인에 원천에 없다/)
  // 한 번 알린 사라짐은 다시 알리지 않는다
  assert.equal((await s.hub.sourceRun('dpms', 'dpms-api 코드'))[0].state, 'same')
})

test('대상 제한 · 자격 든 주소는 비밀로', async () => {
  const add = (at, x = {}) => s.hub.sourceAdd(ADMIN, 'dpms', { name: x.name || '시험', at, rules: [{ rule: 'deps', into: { doc: '배포절차', heading: '꾸러미 판' } }], ...x })
  assert.equal(await code(add('ext::sh -c touch% /tmp/x')), 'E_INPUT')
  assert.equal(await code(add('file:///C:/x')), 'E_INPUT')
  assert.equal(await code(add(tmp)), 'E_INPUT', '살림 자리 · 지식 폴더를 품는 폴더')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-out-'))
  assert.equal(await code(add(out)), 'E_FORBIDDEN', '허락 밖 폴더')
  // 자리 기본이 「없음」이 되었으므로 lee 를 쓰기 자리 가진 보통 팀 사람으로 세운다(관리자 아님 → 403)
  await s.auth.addUser({ id: 'lee', admin: false })
  await seat(s, 'lee', { dpms: 'write' })
  assert.equal(await code(s.hub.sourceAdd({ user: 'lee' }, 'dpms', { name: 'x', at: src, rules: [{ rule: 'deps', into: { doc: 'a' } }] })), 'E_FORBIDDEN', '팀은 관리자만')
  const r = await add('https://bot:s3cr3t-token@git.example.invalid/dpms-api.git', { name: '원격' })
  assert.equal(r.run[0].state, 'failed', '닿지 않아도 선언은 남는다')
  const decl = fs.readFileSync(path.join(kdir, '_sources.json'), 'utf8')
  assert.ok(!decl.includes('s3cr3t-token'))
  assert.ok(decl.includes('https://git.example.invalid/dpms-api.git'))
  assert.ok(!execFileSync('git', ['log', '-p'], { cwd: kdir, encoding: 'utf8' }).includes('s3cr3t-token'), '이력에 0')
  assert.match(fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'secrets.json'), 'utf8'), /s3cr3t-token/)
  fs.rmSync(out, { recursive: true, force: true })
})

test('바깥 생성기: 기계 열쇠로 그 원천 · 그 종류만 · 같으면 묶음 0', async () => {
  const m = await s.auth.machineAdd({ kn: 'dpms', source: 'gen', types: ['term'] })
  const put = (body) => fetch(s.url + '/api/k/dpms/baseline', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${m.key}` }, body: JSON.stringify(body) })
  const body = { source: 'gen', items: [{ coord: 'term:VPN', cols: ['망', '주소'], rows: [['사내', '10.0.0.0/8']] }] }
  const r1 = await (await put(body)).json()
  assert.equal(r1.changed, 1)
  // 표를 문서에 바로 쓰지 않는다 — 원천 글이 들이기 일감이 된다(H4d)
  assert.doesNotMatch(doc('접속안내'), /<!-- baseline: src="gen"/)
  const gj = s.hub.intakesOf('dpms').filter((j) => String(j.src?.rel || '').startsWith('가져올 곳/gen/'))
  assert.equal(gj.length, 1)
  assert.match(fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'queue', `${gj[0].id}.md`), 'utf8'), /\| 사내 \| 10\.0\.0\.0\/8 \|/)
  const n0 = commits()
  assert.equal((await (await put(body)).json()).changed, 0)
  assert.equal(commits(), n0)
  assert.equal((await put({ ...body, source: '다른것' })).status, 403)
  assert.equal((await put({ source: 'gen', items: [{ coord: 'proc:카나리', cols: ['a'], rows: [['b']] }] })).status, 403)
})
