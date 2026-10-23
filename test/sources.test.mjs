// E6 필수 — 자동으로 가져오는 곳(폴더 원천 · 닫힌 규칙 · 바뀐 것만 · 브레이크 · 대상 제한 · 기계 열쇠).
//
// 같은 원천 두 번 → 묶음 0 · 옛 표가 규칙 결과와 같으면 블록으로 · 바뀐 판 → 묶음 1 · 사라짐 10% 초과 → 묶음 0 · 멈춤 줄 ·
// ext:: · file:// · 허락 밖 폴더 · 지식 폴더 거절 · 자격 든 주소 → 선언 · 로그에 0 · 세션은 표를 못 고친다 · 기계 열쇠 길.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { copyDir, signIn } from './helpers.mjs'

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

test('잇기 — 첫 배치 · 옛 표가 같으면 블록으로 · 같은 원천 두 번 → 묶음 0 · 바뀐 판 → 묶음 1', async () => {
  const pr = await s.hub.sourceProbe(ADMIN, 'dpms', { at: src })
  assert.deepEqual(pr.rules.map((r) => r.rule).sort(), ['deps', 'tables'])
  const r = await s.hub.sourceAdd(ADMIN, 'dpms', { name: 'dpms-api 코드', at: src, rules: [{ rule: 'deps', into: { doc: '배포절차', heading: '꾸러미 판' } }, { rule: 'tables', into: { doc: '코드표' } }] })
  assert.equal(r.run[0].state, 'changed')
  const d = doc('배포절차')
  assert.match(d, /<!-- baseline: src="dpms-api 코드" rule=deps/)
  assert.equal((d.match(/\| spring-boot \| 3\.3\.4 \|/g) || []).length, 1, '블록 밖 옛 표는 걷혔다(같았으므로)')
  assert.equal((doc('코드표').match(/^## 코드\d\d$/gm) || []).length, 12)
  const decl = JSON.parse(fs.readFileSync(path.join(kdir, '_sources.json'), 'utf8'))
  assert.equal(decl[0].name, 'dpms-api 코드')
  const n0 = commits()
  const again = await s.hub.sourceRun('dpms', 'dpms-api 코드')
  assert.equal(again[0].state, 'same')
  assert.equal(commits(), n0, '같은 원천 두 번 → 묶음 0')
  pkg({ 'spring-boot': '3.3.5', 'mybatis-spring': '3.0.3', postgresql: '42.7.4', 'jackson-databind': '2.17.2' })
  const ch = await s.hub.sourceRun('dpms', 'dpms-api 코드')
  assert.equal(ch[0].n, 1)
  assert.equal(commits(), n0 + 1)
  assert.match(doc('배포절차'), /\| spring-boot \| 3\.3\.5 \|/)
  const k = await s.hub.get('dpms')
  assert.equal(k.works.filter((w) => w.tags.includes('sources') && w.state === 'pend').length, 0, '가져오기는 대기열에 세우지 않는다')
})

test('브레이크 — 사라짐 10% 초과면 쓰지 않고 멈춤 줄 · [그대로 반영] 은 「원천에 없다」', async () => {
  for (const i of [1, 2, 3]) fs.rmSync(path.join(src, 'data', `코드0${i}.csv`))
  const n0 = commits()
  const r = await s.hub.sourceRun('dpms', 'dpms-api 코드')
  assert.equal(r[0].state, 'stopped')
  assert.equal(commits(), n0)
  const st = await s.hub.stops(ADMIN)
  assert.ok(st.some((l) => l.kind === 'source' && /항목 3개가 한꺼번에 사라졌다/.test(l.text)))
  const f = await s.hub.sourceRun('dpms', 'dpms-api 코드', { force: true })
  assert.equal(f[0].state, 'changed')
  assert.match(doc('코드표'), /missing="\d{4}-\d{2}-\d{2}"/)
  assert.match(doc('코드표'), /## 코드01/, '지우지 않는다')
})

test('대상 제한 · 자격 든 주소는 비밀로', async () => {
  const add = (at, x = {}) => s.hub.sourceAdd(ADMIN, 'dpms', { name: x.name || '시험', at, rules: [{ rule: 'deps', into: { doc: '배포절차', heading: '꾸러미 판' } }], ...x })
  assert.equal(await code(add('ext::sh -c touch% /tmp/x')), 'E_INPUT')
  assert.equal(await code(add('file:///C:/x')), 'E_INPUT')
  assert.equal(await code(add(tmp)), 'E_INPUT', '살림 자리 · 지식 폴더를 품는 폴더')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-out-'))
  assert.equal(await code(add(out)), 'E_FORBIDDEN', '허락 밖 폴더')
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

test('표는 kmd 만 — 세션은 표를 못 고치고, 글을 고쳐도 표는 그대로 · MCP section 에 원천 · 확인 시각', async () => {
  assert.equal(await code(s.hub.save(ADMIN, 'dpms', { record: { title: 'x', body: 'y' }, sections: [{ coord: 'term:꾸러미 판', content: '<!-- baseline: src="가짜" rule=deps asof="2026-01-01" -->\n| a |\n|---|\n<!-- /baseline -->' }] })), 'E_FORBIDDEN')
  await s.hub.save(ADMIN, 'dpms', { record: { title: '꾸러미 판 — 설명 고침', body: '설명만' }, sections: [{ coord: 'term:꾸러미 판', content: '배포 전에 운영 서버의 판이 아래 표와 같은지 본다.' }] })
  assert.match(doc('배포절차'), /배포 전에 운영 서버의 판이 아래 표와 같은지 본다\.\n\n<!-- baseline: src="dpms-api 코드"/)
  const r = await fetch(s.url + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${me.key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'section', arguments: { knowledge: 'dpms', coord: 'term:꾸러미 판' } } }) })
  const sec = (await r.json()).result.structuredContent
  assert.equal(sec.baseline[0].src, 'dpms-api 코드')
  assert.ok(sec.baseline[0].checkedAt)
})

test('바깥 생성기 — 기계 열쇠로 그 원천 · 그 종류만 · 같으면 묶음 0', async () => {
  const m = await s.auth.machineAdd({ kn: 'dpms', source: 'gen', types: ['term'] })
  const put = (body) => fetch(s.url + '/api/k/dpms/baseline', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${m.key}` }, body: JSON.stringify(body) })
  const body = { source: 'gen', items: [{ coord: 'term:VPN', cols: ['망', '주소'], rows: [['사내', '10.0.0.0/8']] }] }
  const r1 = await (await put(body)).json()
  assert.equal(r1.changed, 1)
  assert.match(doc('접속안내'), /<!-- baseline: src="gen" rule=outside/)
  const n0 = commits()
  assert.equal((await (await put(body)).json()).changed, 0)
  assert.equal(commits(), n0)
  assert.equal((await put({ ...body, source: '다른것' })).status, 403)
  assert.equal((await put({ source: 'gen', items: [{ coord: 'proc:카나리', cols: ['a'], rows: [['b']] }] })).status, 403)
})
