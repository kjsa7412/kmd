// 지식관리 2: 저장소 · GitLab 새로 · 가지 · 같은 저장소 막기 · 떼기 · 이슈 주소(관리 설계 6 · 9-2 · 메뉴개편 8-3).
//
// 바깥에 나가지 않는다 — 가짜 GitLab(127.0.0.1 의 작은 http: 그룹 목록 · 저장소 찾기 · 만들기 = 이 PC 의 빈 git 저장소)을 띄우고
// serve.json 의 gitlab 을 그리로 돌린다. 열쇠는 secrets.json 에만 · 응답 어디에도 실리지 않는다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { setSecret } from '../core/secrets.js'
import * as backup from '../core/backup.js'
import { copyDir, signIn, seat } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOKEN = 'glpat-test-SECRET-0123456789'
const G = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=남', '-c', 'user.email=nam@x', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const refOf = (bare, b) => { try { return G(bare, 'rev-parse', `refs/heads/${b}`) } catch { return null } }
let tmp, root, data, s, gl, glUrl, repos
const P = {}
const calls = []

// 가짜 GitLab — private-token 이 맞아야 답한다 · 그룹 kmd · platform(만들 수 있음) · 저장소는 repos/<그룹>/<이름>.git
function fakeGitlab() {
  const groups = [{ id: 1, full_path: 'kmd', name: 'kmd' }, { id: 2, full_path: 'platform', name: 'platform' }]
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    calls.push(`${req.method} ${u.pathname}`)
    const send = (st, j) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)) }
    if (req.headers['private-token'] !== TOKEN) return send(401, { message: '401 Unauthorized' })
    if (req.method === 'GET' && u.pathname === '/api/v4/groups') return send(200, groups)
    let m = u.pathname.match(/^\/api\/v4\/groups\/([^/]+)$/)
    if (req.method === 'GET' && m) { const g = groups.find((x) => x.full_path === decodeURIComponent(m[1])); return g ? send(200, g) : send(404, {}) }
    m = u.pathname.match(/^\/api\/v4\/projects\/([^/]+)$/)
    if (req.method === 'GET' && m) {
      const [g, n] = decodeURIComponent(m[1]).split('/')
      const bare = path.join(repos, g, `${n}.git`)
      if (!fs.existsSync(bare)) return send(404, {})
      let empty = true
      try { empty = !G(bare, 'for-each-ref', '--count=1', 'refs/heads') } catch {}
      return send(200, { ssh_url_to_repo: bare, http_url_to_repo: bare, empty_repo: empty })
    }
    if (req.method === 'POST' && u.pathname === '/api/v4/projects') {
      let b = ''
      req.on('data', (c) => { b += c })
      req.on('end', () => {
        const j = JSON.parse(b)
        const g = groups.find((x) => x.id === j.namespace_id)
        const bare = path.join(repos, g.full_path, `${j.path}.git`)
        fs.mkdirSync(path.dirname(bare), { recursive: true })
        G(path.dirname(bare), 'init', '-q', '--bare', '-b', 'main', bare)
        send(201, { ssh_url_to_repo: bare, http_url_to_repo: bare })
      })
      return
    }
    send(404, {})
  })
}

const req = async (p, who, body, { cookie = false } = {}) => {
  const h = { 'content-type': 'application/json', ...(cookie ? { cookie: who.cookie } : { authorization: `Bearer ${who.key}` }) }
  const r = await fetch(s.url + p, { method: body === undefined ? 'GET' : 'POST', headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  const text = await r.text()
  return { status: r.status, text, j: (() => { try { return JSON.parse(text) } catch { return null } })() }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-gl-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  backup.configure({ delays: [150], lsTimeout: 30000 })
  repos = path.join(tmp, 'repos')
  gl = fakeGitlab()
  await new Promise((ok) => gl.listen(0, '127.0.0.1', ok))
  glUrl = `http://127.0.0.1:${gl.address().port}`
  root = path.join(tmp, 'kn')
  data = path.join(root, '.kmd')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  fs.mkdirSync(data, { recursive: true })
  fs.writeFileSync(path.join(data, 'serve.json'), JSON.stringify({ backupRoots: [tmp], decideMs: 3600000 }))
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  P.boss = await signIn(s, { id: 'boss', admin: true })
  for (const id of ['rd', 'wr', 'ka']) P[id] = await signIn(s, { id, admin: false })
  await seat(s, 'rd', { dpms: 'read' })
  await seat(s, 'wr', { dpms: 'write' })
  await seat(s, 'ka', { dpms: 'admin' })
  // 비밀번호 한 번 더 — 총괄 관리자 쿠키
  const { prehash } = await import('../app/prehash.js')
  const r = await fetch(s.url + '/api/sudo', { method: 'POST', headers: { 'content-type': 'application/json', cookie: P.boss.cookie }, body: JSON.stringify({ pw: prehash('boss', P.boss.pw) }) })
  assert.equal(r.status, 200)
  const set = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  P.sudo = { ...P.boss, cookie: set || P.boss.cookie }
})
after(async () => {
  await s?.close()
  await new Promise((ok) => gl?.close(ok))
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('GitLab 그룹: 총괄 관리자만 · 연결 없음 · 열쇠 없음 · 열쇠는 응답에 없다', async () => {
  // 연결 없음(serve.json 에 gitlab 없음)
  assert.deepEqual((await req('/api/gitlab/groups', P.boss)).j, { why: 'noconfig' })
  for (const who of ['rd', 'wr', 'ka']) assert.equal((await req('/api/gitlab/groups', P[who])).status, 403, `${who}: 총괄 관리자만`)
  // 켠 뒤에 연결을 건다(켤 때 저절로 붙이기가 돌지 않게)
  s.hub.config.gitlab = { api: glUrl, group: 'platform', secret: 'gitlab' }
  assert.deepEqual((await req('/api/gitlab/groups', P.boss)).j, { why: 'nosecret' })
  await setSecret(data, 'gitlab', TOKEN)
  const g = await req('/api/gitlab/groups', P.boss)
  assert.equal(g.status, 200)
  assert.deepEqual(g.j, { groups: [{ path: 'kmd', name: 'kmd' }, { path: 'platform', name: 'platform' }], group: 'platform' })
  assert.ok(!g.text.includes(TOKEN) && !g.text.includes(glUrl), '열쇠 · API 주소는 싣지 않는다')
  assert.equal((await req('/api/gitlab/groups', P.boss, {})).status, 405, 'GET 만')
  // 열쇠가 틀리면 까닭 auth(열쇠 글은 오류에도 없다)
  await setSecret(data, 'gitlab', 'wrong')
  const bad = await req('/api/gitlab/groups', P.boss)
  assert.equal(bad.status, 400)
  assert.equal(bad.j.details.why, 'auth')
  await setSecret(data, 'gitlab', TOKEN)
})

test('GitLab 새로: 총괄 관리자 · 비밀번호 한 번 더 · 고른 그룹 · 이름 · 가지 · 꼴 검사 · 같은 이름 · 다른 지식이 쓰면 막음', async () => {
  const body = { group: 'kmd', name: 'dpms-wiki', branch: 'dev' }
  for (const who of ['rd', 'wr', 'ka']) assert.equal((await req('/api/k/dpms/backup/gitlab', P[who], body)).status, 403, `${who}: 총괄 관리자만`)
  const ns = await req('/api/k/dpms/backup/gitlab', P.boss, body, { cookie: true })
  assert.equal(ns.j.error, 'E_SUDO', '비밀번호 한 번 더')
  assert.equal((await req('/api/k/없음/backup/gitlab', P.sudo, body, { cookie: true })).status, 404)
  for (const bad of [{ ...body, group: 'other' }, { ...body, name: '한글' }, { ...body, name: '-x' }, { ...body, branch: 'a..b' }, { ...body, group: '' }]) {
    assert.equal((await req('/api/k/dpms/backup/gitlab', P.sudo, bad, { cookie: true })).status, 400, JSON.stringify(bad))
  }
  assert.equal(fs.existsSync(path.join(repos, 'kmd', 'dpms-wiki.git')), false, '꼴이 틀리면 만들지 않는다')
  const r = await req('/api/k/dpms/backup/gitlab', P.sudo, body, { cookie: true })
  assert.equal(r.status, 200, r.text)
  const bare = path.join(repos, 'kmd', 'dpms-wiki.git')
  assert.equal(r.j.made.branch, 'dev')
  assert.equal(r.j.made.created, true)
  assert.ok(!r.text.includes(TOKEN))
  const head = G(path.join(root, 'dpms'), 'rev-parse', 'HEAD')
  for (let i = 0; i < 100 && refOf(bare, 'dev') !== head; i++) await new Promise((ok) => setTimeout(ok, 100))
  assert.equal(refOf(bare, 'dev'), head, '고른 가지로 보냈다')
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'backup', 'dpms.json'), 'utf8')).branch, 'dev')
  // 이미 붙음
  assert.equal((await req('/api/k/dpms/backup/gitlab', P.sudo, body, { cookie: true })).j.why, 'attached')
  // 다른 지식이 같은 이름(이미 dpms 가 쓰는 저장소)
  const used = await req('/api/k/gdi/backup/gitlab', P.sudo, body, { cookie: true })
  assert.deepEqual([used.j.why, used.j.by], ['used', 'DPMS 지식'])
  // 이력이 있는 같은 이름(아무 지식도 쓰지 않음) → exists · 빈 같은 이름 → found + empty
  const hist = path.join(repos, 'platform', 'old.git')
  fs.mkdirSync(path.dirname(hist), { recursive: true })
  G(tmp, 'init', '-q', '--bare', '-b', 'main', hist)
  const w = path.join(tmp, 'w'); G(tmp, 'init', '-q', '-b', 'main', w); fs.writeFileSync(path.join(w, 'a.md'), 'a'); G(w, 'add', '.'); G(w, 'commit', '-qm', 'a'); G(w, 'push', '-q', hist, 'main')
  assert.equal((await req('/api/k/gdi/backup/gitlab', P.sudo, { group: 'platform', name: 'old' }, { cookie: true })).j.why, 'exists')
  G(tmp, 'init', '-q', '--bare', '-b', 'main', path.join(repos, 'platform', 'blank.git'))
  const f = await req('/api/k/gdi/backup/gitlab', P.sudo, { group: 'platform', name: 'blank' }, { cookie: true })
  assert.equal(f.j.empty, true)
  assert.equal(f.j.found, path.join(repos, 'platform', 'blank.git'))
  assert.equal(s.hub.backupStateSync(await s.hub.meta('gdi')), null, '찾기만 · 붙이지 않았다')
})

test('같은 저장소 막기: 다른 지식이 쓰는 주소는 E_CONFLICT(꼴이 달라도 · .git · 끝 /)', async () => {
  const used = path.join(repos, 'kmd', 'dpms-wiki.git')
  for (const url of [used, used.replace(/\.git$/, ''), used + path.sep, used.toUpperCase()]) {
    const r = await req('/api/k/gdi/backup', P.sudo, { url }, { cookie: true })
    assert.equal(r.status, 409, url)
    assert.equal(r.j.error, 'E_CONFLICT')
    assert.match(r.j.message, /다른 지식\(DPMS 지식\)이 이미 이 저장소를 쓴다/)
  }
  await assert.rejects(s.hub.backupAttach(SHELL, 'gdi', used), { code: 'E_CONFLICT' })
  // 같은 지식이 다시 붙이는 것은 된다
  const again = await req('/api/k/dpms/backup', P.sudo, { url: used }, { cookie: true })
  assert.equal(again.status, 200, again.text)
  // 못 찾음 — 까닭 notfound
  const nf = await req('/api/k/gdi/backup', P.sudo, { url: path.join(tmp, 'nope.git') }, { cookie: true })
  assert.equal(nf.status, 400)
  assert.equal(nf.j.details.why, 'notfound')
})

test('떼기: 총괄 관리자 · 비밀번호 한 번 더 · 상태 · 원격이 걷힌다 · 저장소의 이력은 그대로', async () => {
  for (const who of ['rd', 'wr', 'ka']) assert.equal((await req('/api/k/dpms/backup/detach', P[who], {})).status, 403)
  assert.equal((await req('/api/k/dpms/backup/detach', P.boss, {}, { cookie: true })).j.error, 'E_SUDO')
  const r = await req('/api/k/dpms/backup/detach', P.sudo, {}, { cookie: true })
  assert.deepEqual(r.j, { ok: true })
  assert.equal(fs.existsSync(path.join(data, 'backup', 'dpms.json')), false)
  assert.deepEqual((await req('/api/k/dpms/backup', P.ka)).j, { off: true }, '지식관리자 보기: 없음')
  assert.ok(refOf(path.join(repos, 'kmd', 'dpms-wiki.git'), 'dev'), '저장소 쪽 이력은 그대로')
  assert.deepEqual((await req('/api/k/dpms/backup/detach', P.sudo, {}, { cookie: true })).j, { ok: true, off: true }, '다시 떼도 된다')
  assert.equal(s.hub.backupStateSync(await s.hub.meta('dpms')), null)
  assert.equal((await req('/api/k/없음/backup/detach', P.sudo, {}, { cookie: true })).status, 404)
  // 도는 보내기 중에 떼도 상태 파일이 다시 서지 않는다(끝난 보내기가 persist 하지 않는다)
  const bare2 = path.join(tmp, 'detach2.git')
  G(tmp, 'init', '-q', '--bare', '-b', 'main', bare2)
  await s.hub.backupAttach(SHELL, 'dpms', bare2)
  const kdir = path.join(root, 'dpms')
  G(kdir, 'commit', '-q', '--allow-empty', '-m', 'test-떼기 중 보냄')
  const meta = await s.hub.meta('dpms')
  const pushing = backup.enqueue(meta)
  await s.hub.backupDetach(SHELL, 'dpms')
  await pushing
  await new Promise((ok) => setTimeout(ok, 300))
  assert.equal(fs.existsSync(path.join(data, 'backup', 'dpms.json')), false, '떼기가 이긴다')
  // 뗀 뒤에는 다른 지식이 그 저장소를 쓸 수 있다(같은 저장소 막기가 풀림)
  const free = await req('/api/k/gdi/backup', P.sudo, { url: path.join(repos, 'kmd', 'dpms-wiki.git') }, { cookie: true })
  assert.notEqual(free.j?.error, 'E_CONFLICT', free.text)
})

test('GitLab 새로: 연결 · 열쇠가 없으면 까닭 · 오류 글에 열쇠 · API 주소가 없다', async () => {
  const keep = s.hub.config.gitlab
  try {
    delete s.hub.config.gitlab
    assert.deepEqual((await req('/api/k/gdi/backup/gitlab', P.sudo, { group: 'kmd', name: 'x' }, { cookie: true })).j, { why: 'noconfig' })
    s.hub.config.gitlab = { ...keep, secret: 'gitlab-none' }
    assert.deepEqual((await req('/api/k/gdi/backup/gitlab', P.sudo, { group: 'kmd', name: 'x' }, { cookie: true })).j, { why: 'nosecret' })
    s.hub.config.gitlab = { ...keep, api: 'http://127.0.0.1:1' } // 닿지 않음
    const net = await req('/api/k/gdi/backup/gitlab', P.sudo, { group: 'kmd', name: 'x' }, { cookie: true })
    assert.equal(net.status, 400)
    assert.equal(net.j.details.why, 'net')
    assert.ok(!net.text.includes(TOKEN) && !net.text.includes('127.0.0.1:1'), net.text)
  } finally { s.hub.config.gitlab = keep }
})

test('새 지식: backup false 면 GitLab 저절로 붙이기 없음 · 없으면 붙음 · 꼴 검사 · 기록 모음 · approve', async () => {
  const bad = [{ kind: 'new', name: 'test-x', empty: 'yes' }, { kind: 'new', name: 'test-x', backup: 'no' }, { kind: 'new', name: 7 }]
  for (const b of bad) assert.equal((await req('/api/knowledge/add', P.boss, b)).status, 400, JSON.stringify(b))
  assert.equal((await req('/api/knowledge/add', P.ka, { kind: 'new', name: 'test-x' })).status, 403, '팀 지식은 총괄 관리자가 세운다')
  const a = await req('/api/knowledge/add', P.boss, { kind: 'new', name: 'test-나중', empty: true, backup: false })
  assert.equal(a.status, 200, a.text)
  const meta = await s.hub.meta(a.j.id)
  assert.equal(s.hub.backupStateSync(meta), null, 'backup: false — 저장소를 저절로 붙이지 않았다')
  assert.equal(fs.existsSync(path.join(meta.dir, 'docs', '처음.md')), false, '빈 지식')
  assert.equal(fs.existsSync(path.join(meta.dir, 'docs', '기록 모음.md')), true, '기록 모음은 같이(P3)')
  assert.equal(s.hub.saveModeOf(a.j.id), 'approve')
  const n0 = calls.length
  const b = await req('/api/knowledge/add', P.boss, { kind: 'new', name: 'test-저절로', empty: true })
  assert.equal(b.status, 200)
  assert.ok(calls.length > n0, '옛 길(backup 없음)은 GitLab 저절로 붙이기')
  assert.ok(s.hub.backupStateSync(await s.hub.meta(b.j.id)), '붙었다')
  // 이름 겹침
  assert.equal((await req('/api/knowledge/add', P.boss, { kind: 'new', name: 'test-나중', backup: false })).status, 409)
})

test('이슈 주소: 읽기 · 쓰기 자리는 issue(주소만) · 지식관리자는 issueUrl 도 · 자리 없음은 줄째 없음', async () => {
  await s.hub.setOwner(SHELL, 'dpms', { issueUrl: 'https://jira.example/browse/{값}' })
  const row = async (who) => (await req('/api/knowledge', P[who])).j.find((k) => k.id === 'dpms')
  for (const who of ['rd', 'wr']) {
    const k = await row(who)
    assert.equal(k.issue, 'https://jira.example/browse/{값}', `${who}: 이슈 주소`)
    assert.equal(k.issueUrl, undefined, `${who}: 정책 칸은 없다`)
    assert.equal(k.review, undefined)
  }
  const ka = await row('ka')
  assert.equal(ka.issue, 'https://jira.example/browse/{값}')
  assert.equal(ka.issueUrl, 'https://jira.example/browse/{값}')
  assert.equal((await req('/api/knowledge', P.rd)).j.some((k) => k.id === 'gdi'), false, '자리 없는 지식은 없다')
})
