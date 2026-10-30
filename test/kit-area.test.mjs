// 개인 에이전트 설치: 작업 폴더 하나에 개인 지식 여럿 · 연결 kmd · CLAUDE.md 안내에 개인 지식 표(기본 지식은 없다 · 세션이 묻는다)
//   팀 지식은 따로(test/teamkit.test.mjs) — 개인 설치는 팀 연결 kmd-team · 팀 덩이를 건드리지 않는다
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { install, status, folders, addKn, dropKn } from '../core/kit.js'
import { installPs, safeKn, safeRoot, startServer } from '../server/http.js'
import { pcRootKind } from '../core/pcops.js'

const URLS = { teamUrl: 'http://kmd.team:7381', meUrl: 'http://127.0.0.1:7373' }
const servers = (dir) => Object.keys(JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8')).mcpServers).sort()

test('개인 지식을 더하면 표에 쌓인다 · 연결은 kmd 하나 · 팀 연결 · 팀 덩이 · 표지 밖의 줄은 그대로 · 기본 지식은 없다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-kit-'))
  try {
    const team = '<!-- kmd-team:begin v=t1 -->\n## kmd: 팀 지식\n<!-- kmd-team:end -->'
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# 내 프로젝트\n\n사람이 쓴 줄\n\n${team}\n`)
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { 'kmd-team': { type: 'http', url: URLS.teamUrl + '/mcp', headersHelper: 'x' } } }))
    let row = addKn({ path: dir, kns: [] }, { area: 'me', kn: '설계메모', knName: '설계메모' })
    await install(dir, { meUrl: URLS.meUrl, kns: row.kns })
    assert.deepEqual(servers(dir), ['kmd', 'kmd-team'], '팀 연결은 그대로')
    let md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
    assert.match(md, /사람이 쓴 줄/)
    assert.ok(md.includes(team), '팀 덩이는 그대로')
    assert.match(md, /## 이 폴더의 개인 지식[\s\S]*\| 「설계메모」 \| 설계메모 \| 나만\(이 PC\) \|/)
    assert.equal((await status(dir)).state, 'latest', '지식 표는 판 지문에 들지 않는다')

    row = addKn(row, { area: 'me', kn: 'memo', knName: '메모' })
    row = addKn(row, { area: 'team', kn: 'dpms', knName: 'DPMS' })
    assert.deepEqual(row.kns.map((k) => k.kn), ['설계메모', 'memo'], '팀 지식은 개인 줄에 들지 않는다')
    assert.equal(row.def, undefined)
    await install(dir, { meUrl: URLS.meUrl, kns: row.kns })
    md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
    assert.match(md, /\| 「메모」 \| memo \|/)
    assert.doesNotMatch(md, /\(기본\)|기본 지식/)
    assert.equal((md.match(/kmd:begin/g) || []).length, 1)

    row = dropKn(row, '설계메모')
    assert.deepEqual(row.kns.map((k) => k.kn), ['memo'])
    fs.writeFileSync(path.join(dir, '.mcp.json'), '{ 깨짐')
    await assert.rejects(install(dir, { meUrl: URLS.meUrl, kns: row.kns }), /JSON 이 아니다/)
    assert.equal(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'), '{ 깨짐', '깨진 .mcp.json 은 덮지 않는다')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('옛 폴더 줄: { area, kn } 은 하나짜리 목록 · 팀 지식만 붙었던 폴더는 개인 목록에 두지 않는다 · 섞인 폴더는 개인 지식만', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-kitd-'))
  try {
    fs.writeFileSync(path.join(data, 'agent.json'), JSON.stringify([
      { name: 'w', path: 'D:\\w', at: 'x', area: 'me', kn: 'memo', knName: '메모' },
      { name: 't', path: 'D:\\t', at: 'x', area: 'team', kn: 'dpms', knName: 'DPMS', team: 'http://t' },
      { name: 'm', path: 'D:\\m', at: 'x', kns: [{ area: 'team', kn: 'dpms', knName: 'DPMS' }, { area: 'me', kn: 'memo', knName: '메모' }], def: 'team:dpms' },
    ]))
    const fs2 = await folders(data)
    assert.deepEqual(fs2.map((f) => f.name), ['w', 'm'])
    assert.deepEqual(fs2[0].kns, [{ area: 'me', kn: 'memo', knName: '메모' }])
    assert.deepEqual(fs2[1].kns, [{ area: 'me', kn: 'memo', knName: '메모' }])
    assert.equal(fs2[1].def, undefined)
    assert.equal(addKn(fs2[0], { area: 'me', kn: 'memo', knName: '새 이름' }).kns.length, 1, '같은 지식은 이름만 새로')
  } finally {
    fs.rmSync(data, { recursive: true, force: true })
  }
})

test('개인 프로그램 설치 한 줄은 작업 폴더를 팀 지식에 붙이지 않는다 · 이상한 이름은 싣지 않는다', () => {
  assert.doesNotMatch(installPs({ origin: 'http://kmd.team:7381', ticket: 'kmdt_abcdefghijklmnop', pkg: null }), /--kn/)
  assert.equal(safeKn("a'; rm -rf /"), null)
  assert.equal(safeKn('$(x)'), null)
  assert.equal(safeKn('배포노트-2'), '배포노트-2')
})

test('설치 한 줄: 내 PC 지식 폴더를 쓰면 kmd connect 에 --root · 절대 경로만 · 셸 글자는 싣지 않는다', () => {
  const ps = installPs({ origin: 'http://kmd.team:7381', ticket: 'kmdt_abcdefghijklmnop', pkg: null, root: 'D:\\내 지식' })
  assert.match(ps, /connect \$o --ticket \$t --root 'D:\\내 지식'/)
  assert.doesNotMatch(ps, /--kn/, '지식 폴더만 세운다 · 작업 폴더를 팀 지식에 붙이지 않는다')
  assert.equal(safeRoot('D:\\kmd'), 'D:\\kmd')
  assert.equal(safeRoot('/home/kim/kmd'), '/home/kim/kmd')
  assert.equal(safeRoot('kmd'), null, '상대 경로')
  assert.equal(safeRoot("D:\\a'; rm"), null)
  assert.equal(safeRoot('D:\\$(x)'), null)
  assert.equal(safeRoot('D:\\a\nb'), null)
})

test('내 PC 지식 폴더 잣대: 없거나 빈 폴더는 새로 · .kmd 가 있으면 그대로 · 다른 파일만 있으면 · 드라이브 통째는 받지 않는다', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-rootkind-'))
  try {
    assert.equal(pcRootKind(path.join(tmp, '없음')).kind, 'new')
    fs.mkdirSync(path.join(tmp, '빈'))
    assert.equal(pcRootKind(path.join(tmp, '빈')).kind, 'new')
    fs.mkdirSync(path.join(tmp, '있던', '.kmd'), { recursive: true })
    assert.equal(pcRootKind(path.join(tmp, '있던')).kind, 'open')
    fs.mkdirSync(path.join(tmp, '남의'))
    fs.writeFileSync(path.join(tmp, '남의', 'a.txt'), 'x')
    assert.throws(() => pcRootKind(path.join(tmp, '남의')), /다른 파일이 있다/)
    assert.throws(() => pcRootKind(path.parse(tmp).root), /드라이브 통째/)
    assert.throws(() => pcRootKind('상대'), /절대 경로/)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('PC /api/agent: 개인 지식 더하기 · 팀 연결은 그대로 · 하나 떼기 · 마지막을 떼면 폴더째 · 기본 바꾸기 길은 없다', async () => {
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
    await s.hub.addKnowledge({ user: 'kim', pc: true, admin: true }, { kind: 'new', name: '설계' })
    // 팀 화면의 에이전트 설치가 먼저 붙인 폴더 — 연결 kmd-team
    fs.writeFileSync(path.join(work, '.mcp.json'), JSON.stringify({ mcpServers: { 'kmd-team': { type: 'http', url: URLS.teamUrl + '/mcp', headersHelper: 'x' } } }))
    const c = await fetch(s.url + '/once', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: s.auth.once(s.pcUser) }) })
    const cookie = c.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ')
    const post = async (p, b) => { const r = await fetch(s.url + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json() } }
    const id = async (n) => (await s.hub.list()).find((k) => k.name === n).id
    const kn = await id('메모'), kn2 = await id('설계')

    let r = await post('/api/agent/add', { dir: work, kn })
    assert.equal(r.status, 200, JSON.stringify(r.j))
    assert.deepEqual(servers(work), ['kmd', 'kmd-team'])
    r = await post('/api/agent/add', { dir: work, kn: kn2 })
    assert.equal(r.j.again, true)
    let list = (await (await fetch(s.url + '/api/agent', { headers: { cookie } })).json()).folders
    assert.equal(list.length, 1)
    assert.deepEqual(list[0].kns.map((k) => `${k.area}:${k.kn}`), [`me:${kn}`, `me:${kn2}`])
    assert.equal((await post('/api/agent/def', { dir: work, area: 'me', kn })).status, 404, '기본 바꾸기 길은 없다')

    r = await post('/api/agent/rm', { dir: work, area: 'me', kn })
    assert.equal(r.j.kns.length, 1)
    assert.deepEqual(servers(work), ['kmd', 'kmd-team'])
    r = await post('/api/agent/rm', { dir: work, area: 'me', kn: kn2 })
    assert.equal(r.j.n, 1)
    assert.deepEqual(servers(work), ['kmd-team'], '마지막 개인 지식을 떼면 개인 것만 걷는다 · 팀 연결은 그대로')
    assert.equal((await (await fetch(s.url + '/api/agent', { headers: { cookie } })).json()).folders.length, 0)
  } finally {
    await s.close()
    Object.assign(process.env, env)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
