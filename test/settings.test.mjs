// S7 필수(엔진) — 에이전트 설치 · 정리 전용 로그인 · 저절로 하는 일 켬/끔.
//
// 폴더에 붙이기 → 스킬 둘 · 연결 둘 · kmd 덩이(사람 줄은 그대로) · 옛 판 → 최신으로 · 빼기 → 사람 줄만 남음 ·
// 정리 전용 로그인 → 주소 · 번호 → 열쇠는 비밀에만(응답 · 로그에 0) · 「넣은 파일을 문서로」 끄면 docx 는 첨부만.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { install, status, remove } from '../core/kit.js'
import { getSecret } from '../core/secrets.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, me
const logs = []

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-s7-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_CLAUDE_LOGIN = path.join(HERE, 'fixture', 'fake-claude-login.mjs')
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: (...a) => logs.push(a.join(' ')), scryptN: 1 << 15 })
  me = await signIn(s, { id: 'kim' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('에이전트 설치 — 붙이기 · 옛 판 → 최신 · 빼기 · 사람이 쓴 줄은 그대로', async () => {
  const w = path.join(tmp, 'work', 'dpms-batch')
  fs.mkdirSync(w, { recursive: true })
  fs.writeFileSync(path.join(w, 'CLAUDE.md'), '# 이 레포\n\n빌드는 gradle 로.\n')
  fs.writeFileSync(path.join(w, '.mcp.json'), JSON.stringify({ mcpServers: { other: { type: 'stdio', command: 'x' } } }))
  assert.equal((await status(w)).state, 'none')
  await install(w, { pcUrl: 'http://127.0.0.1:7373', teamUrl: 'http://kmd.team.local' })
  assert.ok(fs.existsSync(path.join(w, '.claude', 'skills', 'kmd-work', 'SKILL.md')))
  assert.ok(fs.existsSync(path.join(w, '.claude', 'skills', 'kmd-save', 'SKILL.md')))
  const mcp = JSON.parse(fs.readFileSync(path.join(w, '.mcp.json'), 'utf8')).mcpServers
  assert.deepEqual(Object.keys(mcp).sort(), ['kmd', 'kmd-team', 'other'])
  assert.match(mcp['kmd-team'].headersHelper, /kmd-key\.mjs" http:\/\/kmd\.team\.local$/)
  assert.ok(!JSON.stringify(mcp).includes('kmdk_'), '열쇠는 설정에 0')
  const md = fs.readFileSync(path.join(w, 'CLAUDE.md'), 'utf8')
  assert.match(md, /^# 이 레포\n\n빌드는 gradle 로\.\n\n<!-- kmd:begin v=\w+ -->/)
  assert.equal((await status(w)).state, 'latest')
  // 옛 판 — 덩이 판 표지가 다르면 「옛 판」 · 다시 붙이면 kmd 덩이만 바뀐다
  fs.writeFileSync(path.join(w, 'CLAUDE.md'), md.replace(/v=\w+/, 'v=old00000').replace('<!-- kmd:end -->', '<!-- kmd:end -->\n\n사람이 덧붙인 줄.\n'))
  assert.equal((await status(w)).state, 'old')
  await install(w, { pcUrl: 'http://127.0.0.1:7373' })
  const md2 = fs.readFileSync(path.join(w, 'CLAUDE.md'), 'utf8')
  assert.equal((await status(w)).state, 'latest')
  assert.match(md2, /사람이 덧붙인 줄\./)
  assert.equal((md2.match(/kmd:begin/g) || []).length, 1)
  await remove(w)
  assert.equal(fs.readFileSync(path.join(w, 'CLAUDE.md'), 'utf8').includes('kmd:begin'), false)
  assert.match(fs.readFileSync(path.join(w, 'CLAUDE.md'), 'utf8'), /빌드는 gradle 로\.[\s\S]*사람이 덧붙인 줄\./)
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(w, '.mcp.json'), 'utf8')).mcpServers), ['other'])
  assert.ok(!fs.existsSync(path.join(w, '.claude', 'skills', 'kmd-work')))
})

test('정리 전용 로그인 — 비밀번호 한 번 더 → 주소 → 번호 → 열쇠는 비밀에만', async () => {
  const H = { 'content-type': 'application/json', cookie: me.cookie }
  const post = (p, b) => fetch(s.url + p, { method: 'POST', headers: H, body: JSON.stringify(b || {}) })
  assert.equal((await post('/api/admin/claude/start')).status, 403, '비밀번호 한 번 더 없이는 안 된다')
  const { prehash } = await import('../app/prehash.js')
  const su = await post('/api/sudo', { pw: prehash('kim', me.pw) })
  H.cookie = [me.cookie, ...su.headers.getSetCookie().map((c) => c.split(';')[0])].join('; ')
  const st = await (await post('/api/admin/claude/start')).json()
  assert.match(st.url, /^https:\/\/claude\.ai\/oauth\/authorize/)
  const done = await post('/api/admin/claude/code', { code: 'abc#123' })
  const body = await done.text()
  assert.equal(done.status, 200)
  assert.ok(!body.includes('sk-ant'), '응답에 열쇠 0')
  assert.equal(await getSecret(path.join(tmp, 'kn', '.kmd'), 'claude-token'), 'sk-ant-oat01-TESTTOKEN0123456789abcdefABCDEF')
  assert.ok(!logs.join('\n').includes('sk-ant'), '로그에 열쇠 0')
  const ov = await (await fetch(s.url + '/api/admin/overview', { headers: H })).json()
  assert.equal(ov.claude.token, true)
})

test('저절로 하는 일 — 「넣은 파일을 문서로」 를 끄면 docx 는 원본 첨부만', async () => {
  const KIM = { user: 'kim', admin: true }
  await s.hub.setAuto(KIM, 'file', false)
  const fake = Buffer.from('PK not really a zip')
  const r = await s.hub.importFiles(KIM, 'dpms', [{ path: '꺼둠.docx', data: fake }])
  assert.equal(r.summary.doc, 0)
  assert.equal(r.summary.att, 1)
  assert.ok(fs.existsSync(path.join(tmp, 'kn', 'dpms', 'docs', 'assets', '꺼둠.docx')))
  await s.hub.setAuto(KIM, 'file', true)
  assert.equal(s.hub.autoOf('kim', 'file'), true)
  assert.equal(s.hub.autoOf('lee', 'file'), true, '사람마다 따로')
  await assert.rejects(s.hub.setAuto(KIM, 'save', false), { code: 'E_INPUT' })
})

test('DB 가져오는 곳 — 팀은 비밀번호를 받지 않는다 · 선언에 비밀 0 · 실패로 세지 않고 쉰다 · 연결 확인은 닿는지만', async () => {
  const KIM = { user: 'kim', admin: true }
  const db = { host: '127.0.0.1', port: 5432, database: 'gdi', schema: 'public', user: 'kmd_read' }
  const rules = [{ rule: 'dbtables', into: { doc: '테이블 정의' } }]
  await assert.rejects(s.hub.sourceAdd(KIM, 'gdi', { name: 'gdi DB', kind: 'db', db: { ...db, password: 'pw' }, rules }), { code: 'E_FORBIDDEN' })
  await assert.rejects(s.hub.sourceAdd(KIM, 'gdi', { name: 'gdi DB', kind: 'db', db, rules: [{ rule: 'deps', into: { doc: 'x' } }] }), { code: 'E_INPUT' })
  const r = await s.hub.sourceAdd(KIM, 'gdi', { name: 'gdi DB', kind: 'db', db, rules })
  // 팀 서버에 비밀번호(kmd secret set)가 아직 없으면 붙지 않고 그 까닭을 남긴다 — 한 번 실패는 멈춤 줄이 아니다
  assert.equal(r.run[0].state, 'failed')
  assert.match(r.run[0].why, /비밀번호가 없다/)
  assert.match(r.secret, /^src\/gdi\/gdi-db-[0-9a-f]{6}$/)
  const decl = fs.readFileSync(path.join(tmp, 'kn', 'gdi', '_sources.json'), 'utf8')
  assert.match(decl, /postgres:\/\/kmd_read@127\.0\.0\.1:5432\/gdi\?schema=public/)
  assert.ok(!/pw/.test(decl.replace(/postgres/g, '')), '선언에 비밀번호 0')
  assert.deepEqual((await s.hub.stops(KIM)).filter((l) => l.kind === 'source'), [], '멈춤 줄 없음')
  assert.equal((await s.hub.sourceCheckDb(KIM, 'gdi', { host: '127.0.0.1', port: s.port })).reach, true)
  assert.equal((await s.hub.sourceCheckDb(KIM, 'gdi', { host: '127.0.0.1', port: 9 })).reach, false)
  await assert.rejects(s.hub.sourceCheckDb({ user: 'lee' }, 'gdi', { host: '127.0.0.1', port: 9 }), { code: 'E_FORBIDDEN' })
})
