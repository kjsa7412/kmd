// 팀 에이전트 설치 — 개인 프로그램 없이 팀 서버가 내주는 한 줄로 작업 폴더에 팀 지식을 붙인다(core/teamkit.js)
//   팀 덩이 · 표 · 옛 한 덩이 옮기기 · /a/ 스크립트 · /api/agent/team-kit · 실제 PowerShell 로 붙이고 헤더 도우미로 MCP 부르기
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { prehash } from '../app/prehash.js'
import { teamKitParts, teamRows, legacyRows, legacyTeamOnly, teamKns, teamBlock, asciiJson } from '../core/teamkit.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s

function copyDir(a, b) {
  fs.mkdirSync(b, { recursive: true })
  for (const e of fs.readdirSync(a, { withFileTypes: true })) {
    const x = path.join(a, e.name), y = path.join(b, e.name)
    if (e.isDirectory()) copyDir(x, y)
    else fs.copyFileSync(x, y)
  }
}
const req = async (p, { body, cookie, bearer } = {}) => {
  const headers = { 'content-type': 'application/json' }
  if (cookie) headers.cookie = cookie
  if (bearer) headers.authorization = `Bearer ${bearer}`
  const r = await fetch(s.url + p, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let j = null
  try { j = JSON.parse(text) } catch {}
  return { status: r.status, body: j, text, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') }
}
const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
// 이 프로세스 안의 팀 서버가 답하는 동안 이벤트 고리를 막지 않는다(spawnSync 금지)
const ps = (args, { cwd, env = {} } = {}) => new Promise((ok) => {
  const c = spawn(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], { cwd, env: { ...process.env, ...env } })
  const o = [], e = []
  c.stdout.on('data', (d) => o.push(d))
  c.stderr.on('data', (d) => e.push(d))
  const dec = (b) => { const buf = Buffer.concat(b); const u = buf.toString('utf8'); return u.includes('�') ? new TextDecoder('euc-kr').decode(buf) : u }
  c.on('close', (status) => ok({ status, out: dec(o) + dec(e), stdout: dec(o) }))
})

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-teamkit-'))
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
})
after(async () => {
  await s?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('팀 덩이: 표 읽기 · 옛 한 덩이의 팀 줄 옮기기 · 개인 지식이 없을 때만 옛 덩이를 걷는다 · 볼 수 없는 지식은 뺀다', async () => {
  const parts = await teamKitParts()
  assert.deepEqual(parts.skills.map((x) => x.rel), ['.claude/skills/kmd-team-work/SKILL.md', '.claude/skills/kmd-team-save/SKILL.md', '.claude/skills/kmd-team-save/작성가이드.md'])
  const visible = [{ id: 'dpms', name: 'DPMS 지식' }, { id: 'gdi', name: 'GDI 지식' }]
  const b1 = teamBlock(parts, teamKns({ add: 'dpms', visible }))
  assert.match(b1, /^<!-- kmd-team:begin v=\w{8} -->\n## kmd: 팀 지식/)
  assert.match(b1, /\| 「DPMS 지식」 \| dpms \| 이 팀 지식을 보는 팀 사람 \|\n<!-- kmd-team:end -->$/)
  assert.deepEqual(teamRows(b1), [{ kn: 'dpms', knName: 'DPMS 지식' }])
  const b2 = teamBlock(parts, teamKns({ old: b1, add: 'gdi', visible }))
  assert.deepEqual(teamRows(b2).map((r) => r.kn), ['dpms', 'gdi'], '더하기 · 처음 것이 먼저')
  assert.deepEqual(teamRows(teamBlock(parts, teamKns({ old: b2, add: 'dpms', visible }))).map((r) => r.kn), ['dpms', 'gdi'], '같은 지식은 한 번')
  assert.deepEqual(teamKns({ old: b2, add: 'dpms', visible: [visible[0]] }).map((r) => r.kn), ['dpms'], '지금 볼 수 없는 지식은 뺀다')
  assert.doesNotMatch(b2, /기본/, '기본 지식은 없다')
  // 옛 한 덩이(팀 · 개인 섞인 표)
  const oldTeam = '<!-- kmd:begin v=abc -->\n## kmd\n\n| 지식 | 영역 | 연결 | id | 남기면 보는 사람 |\n|---|---|---|---|---|\n| 「DPMS 지식」 (기본) | 팀 | kmd-team | dpms | 이 팀 지식을 보는 팀 사람 |\n<!-- kmd:end -->'
  const oldMixed = oldTeam.replace('<!-- kmd:end -->', '| 「메모」 | 개인 | kmd | memo | 나만(이 PC) |\n<!-- kmd:end -->')
  assert.deepEqual(legacyRows(oldMixed).map((r) => `${r.area}:${r.kn}`), ['team:dpms', 'me:memo'])
  assert.equal(legacyTeamOnly(oldTeam), true)
  assert.equal(legacyTeamOnly(oldMixed), false, '개인 지식이 있으면 개인 프로그램이 고친다')
  assert.equal(legacyTeamOnly('<!-- kmd:begin v=abc -->\n## kmd\n<!-- kmd:end -->'), false, '표 없는 옛 덩이는 걷지 않는다')
  assert.deepEqual(teamKns({ legacy: oldMixed, add: 'gdi', visible }).map((r) => r.kn), ['dpms', 'gdi'], '옛 덩이의 팀 줄을 옮긴다')
  assert.equal(JSON.parse(asciiJson({ a: '한글 「」' })).a, '한글 「」')
  assert.match(asciiJson({ a: '한' }), /^[\x00-\x7f]*$/)
})

test('팀 에이전트 설치: 표 한 줄은 /a/ · 개인 프로그램을 깔지 않는다 · team-kit 은 읽기 자리를 본다 · 실제 PowerShell 로 붙이고 다시 붙이면 열쇠를 그대로 쓴다', async () => {
  const code = await s.auth.setupCode()
  assert.equal((await req('/setup', { body: { code, name: 'kim', pw: prehash('kim', 'admin-pw-1234') } })).status, 200)
  const c = (await req('/login', { body: { user: 'kim', pw: prehash('kim', 'admin-pw-1234') } })).cookie
  const kns = (await req('/api/knowledge', { cookie: c })).body.map((k) => k.id)
  assert.ok(kns.includes('dpms') && kns.includes('gdi'), kns.join())
  const t = await req('/api/device/ticket', { body: { kn: 'dpms' }, cookie: c })
  assert.equal(t.status, 200, t.text)
  assert.match(t.body.line, new RegExp(`^irm '${s.url.replace(/[.]/g, '\\.')}/a/kmdt_[A-Za-z0-9_-]+\\?kn=dpms' \\| iex$`))
  assert.equal(t.body.sh, null)
  assert.equal((await req('/api/device/ticket', { body: { kn: '없는-지식' }, cookie: c })).status, 400)
  const plain = await req('/api/device/ticket', { body: {}, cookie: c })
  assert.match(plain.body.line, /\/i\/kmdt_/, '지식을 고르지 않으면 개인 프로그램 설치 한 줄')
  // 스크립트 — 개인 프로그램을 받거나 · 올리거나 · 늘 켜지 않는다
  const url = new URL(t.body.line.match(/'([^']+)'/)[1])
  const script = await fetch(url).then((x) => x.text())
  for (const no of ['/dl/', 'pc update', 'pc link', 'connect', 'schtasks', 'KMD_APP_HOME']) assert.ok(!script.includes(no), `스크립트에 ${no} 가 없다`)
  assert.ok(script.includes('/device/keys') && script.includes('/api/agent/team-kit') && script.includes("'CurrentUser'"))
  assert.equal((await fetch(`${s.url}/a/${url.pathname.split('/')[2]}`)).status, 400, '지식이 없으면 400')
  // team-kit — 열쇠 없이는 401 · 모양이 이상하면 400
  assert.equal((await req('/api/agent/team-kit', { body: { kn: 'dpms' } })).status, 401)

  if (process.platform !== 'win32') return
  const app = path.join(tmp, '앱 데이터')
  const work = path.join(tmp, 'work', 'dpms 일')
  fs.mkdirSync(work, { recursive: true })
  fs.mkdirSync(app, { recursive: true })
  fs.writeFileSync(path.join(work, 'CLAUDE.md'), '# 이 레포\n\n빌드는 gradle 로.\n')
  fs.writeFileSync(path.join(work, '.mcp.json'), JSON.stringify({ mcpServers: { other: { type: 'stdio', command: 'x' } } }))
  // 예전 한 덩이(팀 지식만) · 옛 스킬 — 걷힌다
  fs.mkdirSync(path.join(work, '.claude', 'skills', 'kmd-work'), { recursive: true })
  fs.writeFileSync(path.join(work, '.claude', 'skills', 'kmd-work', 'SKILL.md'), 'old')
  fs.appendFileSync(path.join(work, 'CLAUDE.md'), '\n<!-- kmd:begin v=old -->\n## kmd\n\n| 지식 | 영역 | 연결 | id | 남기면 보는 사람 |\n|---|---|---|---|---|\n| 「DPMS 지식」 (기본) | 팀 | kmd-team | dpms | x |\n<!-- kmd:end -->\n\n사람이 덧붙인 줄.\n')
  const env = { APPDATA: app }
  const r1 = await ps(['-Command', t.body.line], { cwd: work, env })
  assert.equal(r1.status, 0, r1.out)
  assert.match(r1.out, /이 PC 를 팀 .* kim 로 이었다/, r1.out)
  assert.match(r1.out, /팀 지식 「DPMS 지식」 을 붙였다\. 이 폴더의 팀 지식 1/, r1.out)
  assert.match(r1.out, /예전 한 덩이/, r1.out)
  const keys = fs.readdirSync(path.join(app, 'kmd', 'keys'))
  assert.equal(keys.length, 1)
  assert.ok(!fs.readFileSync(path.join(app, 'kmd', 'keys', keys[0]), 'utf8').includes('kmdk_'), '열쇠는 DPAPI 로 감싼다')
  const mcp = JSON.parse(fs.readFileSync(path.join(work, '.mcp.json'), 'utf8')).mcpServers
  assert.deepEqual(Object.keys(mcp).sort(), ['kmd-team', 'other'], '다른 연결은 그대로')
  assert.equal(mcp['kmd-team'].url, s.url + '/mcp')
  assert.match(mcp['kmd-team'].headersHelper, /^powershell\.exe .*-File ".+kmd-team-key\.ps1" http:\/\/127\.0\.0\.1:\d+$/)
  assert.ok(!JSON.stringify(mcp).includes('kmdk_'), '열쇠는 설정에 0')
  assert.ok(fs.existsSync(path.join(work, '.claude', 'skills', 'kmd-team-work', 'SKILL.md')))
  assert.ok(fs.existsSync(path.join(work, '.claude', 'skills', 'kmd-team-save', '작성가이드.md')))
  assert.equal(fs.existsSync(path.join(work, '.claude', 'skills', 'kmd-work')), false, '옛 스킬을 걷었다')
  let md = fs.readFileSync(path.join(work, 'CLAUDE.md'), 'utf8')
  assert.match(md, /^# 이 레포\n\n빌드는 gradle 로\./)
  assert.match(md, /사람이 덧붙인 줄\./)
  assert.doesNotMatch(md, /kmd:begin/, '옛 한 덩이를 걷었다')
  assert.match(md, /<!-- kmd-team:begin v=\w+ -->[\s\S]*\| 「DPMS 지식」 \| dpms \|[\s\S]*<!-- kmd-team:end -->/)
  assert.ok(!md.startsWith('\ufeff'), 'BOM 없이')

  // 헤더 도우미 — Claude Code 가 부르는 그대로(셸 없이 인자로) · 그 머리글로 MCP 가 받는다
  const hp = mcp['kmd-team'].headersHelper.match(/-File "([^"]+)" (\S+)$/)
  const h = await ps(['-File', hp[1], hp[2]], { env })
  assert.equal(h.status, 0, h.out)
  const auth = JSON.parse(h.stdout).Authorization
  assert.match(auth, /^Bearer kmdk_/)
  const m = await fetch(s.url + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
  assert.equal(m.status, 200)

  // 두 번째 지식 — 이미 있는 열쇠를 그대로(표는 쓰지 않는다 · 내 기기가 늘지 않는다)
  const devs = (await req('/api/me/devices', { cookie: c })).body.length
  const t2 = await req('/api/device/ticket', { body: { kn: 'gdi' }, cookie: c })
  const r2 = await ps(['-Command', t2.body.line], { cwd: work, env })
  assert.equal(r2.status, 0, r2.out)
  assert.match(r2.out, /팀 열쇠를 그대로 쓴다/, r2.out)
  assert.match(r2.out, /이 폴더의 팀 지식 2/, r2.out)
  assert.equal((await req('/api/me/devices', { cookie: c })).body.length, devs, '새 기기를 만들지 않았다')
  md = fs.readFileSync(path.join(work, 'CLAUDE.md'), 'utf8')
  assert.equal((md.match(/kmd-team:begin/g) || []).length, 1)
  assert.deepEqual(teamRows(md).map((r) => r.kn), ['dpms', 'gdi'])

  // 깨진 .mcp.json 은 덮지 않는다
  fs.writeFileSync(path.join(work, '.mcp.json'), '{ 깨짐')
  const t3 = await req('/api/device/ticket', { body: { kn: 'dpms' }, cookie: c })
  const r3 = await ps(['-Command', t3.body.line], { cwd: work, env })
  assert.match(r3.out, /JSON 이 아니라 고치지 않았다/, r3.out)
  assert.equal(fs.readFileSync(path.join(work, '.mcp.json'), 'utf8'), '{ 깨짐')
})
