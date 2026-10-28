// 에이전트 설치 · 팀 / 개인: 작업 폴더 하나에 지식 여럿. 연결은 붙은 영역의 것 · CLAUDE.md 안내에 지식 표와 기본 지식
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { install, status, folders, addKn, dropKn, setDef, defOf } from '../core/kit.js'
import { installPs, safeKn, startServer } from '../server/http.js'

const URLS = { teamUrl: 'http://kmd.team:7381', pcUrl: 'http://127.0.0.1:7373' }
const servers = (dir) => Object.keys(JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8')).mcpServers).sort()

test('팀 지식을 붙인 폴더에 개인 지식을 더하면 둘 다 남는다 · 연결 둘 · 지식 표 · 기본은 처음 것 · 표지 밖의 줄은 그대로', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-kit-'))
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# 내 프로젝트\n\n사람이 쓴 줄\n')
    let row = addKn({ path: dir, kns: [], def: null }, { area: 'team', kn: 'dpms', knName: 'DPMS 지식', team: URLS.teamUrl })
    await install(dir, { ...URLS, ...row })
    assert.deepEqual(servers(dir), ['kmd-team'], '팀 지식만 붙은 폴더에는 팀 연결 하나')
    let md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
    assert.match(md, /사람이 쓴 줄/)
    assert.match(md, /## 이 폴더의 지식[\s\S]*\| 「DPMS 지식」 \(기본\) \| 팀 \| kmd-team \| dpms \|/)
    assert.equal((await status(dir)).state, 'latest', '지식 표는 판 지문에 들지 않는다')

    row = addKn(row, { area: 'me', kn: '설계메모', knName: '설계메모' })
    await install(dir, { ...URLS, ...row })
    assert.deepEqual(servers(dir), ['kmd', 'kmd-team'], '개인 지식을 더해도 팀 연결은 그대로')
    md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
    assert.match(md, /「DPMS 지식」 \(기본\) \| 팀/)
    assert.match(md, /\| 「설계메모」 \| 개인 \| kmd \| 설계메모 \| 나만\(이 PC\) \|/)
    assert.match(md, /기본 지식 「DPMS 지식」 에 남긴다/)
    assert.equal((md.match(/kmd:begin/g) || []).length, 1)

    row = setDef(row, 'me', '설계메모')
    await install(dir, { ...URLS, ...row })
    md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
    assert.match(md, /「설계메모」 \(기본\) \| 개인/)
    assert.doesNotMatch(md, /「DPMS 지식」 \(기본\)/)

    row = dropKn(row, 'team', 'dpms')
    await install(dir, { ...URLS, ...row })
    assert.deepEqual(servers(dir), ['kmd'], '팀 지식을 떼면 팀 연결도 걷는다')
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /DPMS 지식/)
    assert.throws(() => setDef(row, 'team', 'dpms'), /붙지 않은/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('옛 폴더 줄({ area, kn })은 지식 하나짜리 목록으로 읽는다 · 기본을 떼면 남은 첫 지식이 기본', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-kitd-'))
  try {
    fs.writeFileSync(path.join(data, 'agent.json'), JSON.stringify([{ name: 'w', path: 'D:\\w', at: 'x', area: 'team', kn: 'dpms', knName: 'DPMS', team: 'http://t' }]))
    const [f] = await folders(data)
    assert.deepEqual(f.kns, [{ area: 'team', kn: 'dpms', knName: 'DPMS', team: 'http://t' }])
    assert.equal(f.def, 'team:dpms')
    assert.equal(f.area, undefined)
    const two = addKn(f, { area: 'me', kn: 'memo', knName: '메모' })
    assert.equal(two.def, 'team:dpms', '더해도 기본은 그대로')
    assert.equal(defOf(dropKn(two, 'team', 'dpms')).kn, 'memo')
    assert.equal(addKn(two, { area: 'me', kn: 'memo', knName: '새 이름' }).kns.length, 2, '같은 지식은 이름만 새로')
  } finally {
    fs.rmSync(data, { recursive: true, force: true })
  }
})

test('설치 한 줄: 팀 지식을 고르면 kmd connect 에 --kn · 이상한 이름은 싣지 않는다', () => {
  const ps = installPs({ origin: 'http://kmd.team:7381', ticket: 'kmdt_abcdefghijklmnop', pkg: null, kn: 'DPMS 지식' })
  assert.match(ps, /connect \$o --ticket \$t --kn 'DPMS 지식'/)
  assert.doesNotMatch(installPs({ origin: 'http://kmd.team:7381', ticket: 'kmdt_abcdefghijklmnop', pkg: null }), /--kn/)
  assert.equal(safeKn("a'; rm -rf /"), null)
  assert.equal(safeKn('$(x)'), null)
  assert.equal(safeKn('배포노트-2'), '배포노트-2')
})

test('PC /api/agent: 팀 지식이 붙은 폴더에 개인 지식을 더하면 팀 지식은 남는다 · 기본 바꾸기 · 하나 떼기 · 마지막을 떼면 폴더째', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-kitpc-'))
  const env = { ...process.env }
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  const root = path.join(tmp, 'kn')
  const data = path.join(tmp, 'data')
  const work = path.join(tmp, 'work')
  fs.mkdirSync(root, { recursive: true })
  fs.mkdirSync(work, { recursive: true })
  const s = await startServer({ root, data, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    await s.hub.addKnowledge({ user: 'kim', pc: true, admin: true }, { kind: 'new', name: '메모' })
    // 팀 화면의 설치 한 줄(kmd connect --kn)이 먼저 붙인 폴더 — 옛 줄 꼴로
    await install(work, { teamUrl: URLS.teamUrl, ...addKn({ kns: [] }, { area: 'team', kn: 'dpms', knName: 'DPMS', team: URLS.teamUrl }) })
    fs.writeFileSync(path.join(data, 'agent.json'), JSON.stringify([{ name: 'work', path: work, at: 'x', area: 'team', kn: 'dpms', knName: 'DPMS', team: URLS.teamUrl }]))
    const c = await fetch(s.url + '/once', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: s.auth.once(s.pcUser) }) })
    const cookie = c.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ')
    const post = async (p, b) => { const r = await fetch(s.url + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json() } }
    const kn = (await s.hub.list()).find((k) => k.name === '메모').id

    let r = await post('/api/agent/add', { dir: work, kn })
    assert.equal(r.status, 200, JSON.stringify(r.j))
    assert.equal(r.j.again, true)
    assert.deepEqual(servers(work), ['kmd', 'kmd-team'])
    let list = (await (await fetch(s.url + '/api/agent', { headers: { cookie } })).json()).folders
    assert.equal(list.length, 1)
    assert.deepEqual(list[0].kns.map((k) => `${k.area}:${k.kn}`), ['team:dpms', `me:${kn}`])
    assert.equal(list[0].def, 'team:dpms', '더해도 기본은 처음 것')

    r = await post('/api/agent/def', { dir: work, area: 'me', kn })
    assert.equal(r.j.def, `me:${kn}`)
    assert.match(fs.readFileSync(path.join(work, 'CLAUDE.md'), 'utf8'), /「메모」 \(기본\) \| 개인/)

    r = await post('/api/agent/rm', { dir: work, area: 'team', kn: 'dpms' })
    assert.equal(r.j.kns.length, 1)
    assert.deepEqual(servers(work), ['kmd'])
    r = await post('/api/agent/rm', { dir: work, area: 'me', kn })
    assert.equal(r.j.n, 1)
    assert.equal(fs.existsSync(path.join(work, '.mcp.json')), false, '마지막 지식을 떼면 폴더째 뺀다')
    assert.equal((await (await fetch(s.url + '/api/agent', { headers: { cookie } })).json()).folders.length, 0)
  } finally {
    await s.close()
    Object.assign(process.env, env)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
