// E9 필수 — 되살리기 · PC 운영.
//
// 재난 시험(지식 폴더 · 살림 자리를 지우고 백업에서 되살려 첨부 · 이름 장부 · `_members.md` · 한글 경로 · fsck · 트리 해시 · 다시 백업) ·
// 갈라진 백업 이어 쓰기(지금 머리는 가지로) · auth.log 다시 적용 · GitLab 봇으로 백업 자리 저절로 · 깨진 판으로 올림 → 앞 판 그대로.

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
import { makeAuth } from '../core/auth.js'
import { setSecret } from '../core/secrets.js'
import { taskXml, upgrade, readCurrent } from '../core/pcops.js'
import { copyDir } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp
const G = (dir, ...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: dir, encoding: 'utf8' }).trim()
const KIM = { user: 'kim', admin: true }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// git 한 번이 수 초씩 걸리는 PC 가 있다 — 지식 둘을 차례로 붙이고 보내는 데도 15초를 넘는다
async function until(f, ms = 60000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await Promise.resolve().then(f).catch(() => false)) return true; await wait(200) }
  return false
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-e9-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
})
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {} })

function serve(root, extra = {}) {
  fs.mkdirSync(path.join(root, '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(root, '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, backupRoots: [path.join(tmp, 'bk')], ...extra }))
  return startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
}

test('재난 시험 — 지우고 백업에서 되살린다(첨부 · 이름 장부 · 사람 · 한글 경로 · fsck · 트리 해시) · 다시 백업된다', async () => {
  const root = path.join(tmp, 'home1')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  const kd = path.join(root, 'dpms')
  fs.mkdirSync(path.join(kd, 'docs', 'assets'), { recursive: true })
  fs.writeFileSync(path.join(kd, 'docs', 'assets', '구성도.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
  fs.mkdirSync(path.join(kd, 'docs', '운영 절차'), { recursive: true })
  fs.writeFileSync(path.join(kd, 'docs', '운영 절차', '장애 — 첫 10분.md'), '# 장애 — 첫 10분\n\n## 연락\n당번 → 박.\n')
  fs.mkdirSync(path.join(tmp, 'bk'), { recursive: true })
  const bare = path.join(tmp, 'bk', 'dpms.git')
  G(path.join(tmp, 'bk'), 'init', '-q', '--bare', '-b', 'main', bare)
  let s = await serve(root)
  await s.hub.setOwner(SHELL, 'dpms', { owner: 'kim', curators: ['lee'] })
  await s.hub.backupAttach(SHELL, 'dpms', bare)
  await s.hub.save(KIM, 'dpms', { record: { title: '재난 전 마지막 저장', body: '이것도 돌아와야 한다.' } })
  assert.ok(await until(() => G(bare, 'rev-parse', 'main') === G(kd, 'rev-parse', 'HEAD')), '백업에 다 갔다')
  const tree = G(kd, 'rev-parse', 'HEAD^{tree}')
  await s.close()

  // 집을 지운다 — 지식 폴더와 살림 자리 모두
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  const root2 = path.join(tmp, 'home2')
  fs.mkdirSync(root2, { recursive: true })
  s = await serve(root2)
  const r = await s.hub.restore(SHELL, { url: bare, name: 'dpms' })
  assert.equal(r.fsck, true)
  assert.equal(r.tree, tree, '트리 해시가 같다')
  assert.ok(r.atts >= 1 && r.vocab && r.members)
  assert.equal(r.owner, 'kim', '_members.md 로 주인을 다시 건다')
  assert.ok(fs.existsSync(path.join(root2, 'dpms', 'docs', '운영 절차', '장애 — 첫 10분.md')), '한글 경로')
  assert.deepEqual(r.errors, [])
  const k = await s.hub.get('dpms')
  assert.ok(k.works.some((w) => w.title === '재난 전 마지막 저장'))
  // 되살린 지식은 같은 백업 자리로 이어서 간다
  await s.hub.save(KIM, 'dpms', { record: { title: '되살린 뒤 첫 저장', body: '이어서 백업.' } })
  assert.ok(await until(() => G(bare, 'rev-parse', 'main') === G(path.join(root2, 'dpms'), 'rev-parse', 'HEAD')))
  await assert.rejects(s.hub.restore(SHELL, { url: 'ext::sh -c x', name: 'x' }), { code: 'E_INPUT' })
  await assert.rejects(s.hub.restore(SHELL, { url: path.join(tmp, 'elsewhere.git'), name: 'y' }), { code: 'E_FORBIDDEN' })

  // 갈라진 백업 — 사람이 「백업 쪽이 맞다」 → 지금 머리는 가지로 남기고 백업 머리로
  const other = path.join(tmp, 'other')
  G(tmp, 'clone', '-q', bare, other)
  fs.writeFileSync(path.join(other, 'docs', '다른 곳.md'), '# 다른 곳\n')
  G(other, 'add', '-A')
  G(other, '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '-m', 'other')
  G(other, 'push', '-q', 'origin', 'HEAD:main')
  const kd2 = path.join(root2, 'dpms')
  fs.writeFileSync(path.join(kd2, 'docs', '여기.md'), '# 여기\n')
  G(kd2, 'add', '-A')
  G(kd2, '-c', 'user.name=y', '-c', 'user.email=y@y', 'commit', '-q', '-m', 'here')
  const mine = G(kd2, 'rev-parse', 'HEAD')
  const a = await s.hub.backupAdopt(SHELL, 'dpms')
  assert.equal(G(kd2, 'rev-parse', 'HEAD'), G(bare, 'rev-parse', 'main'))
  assert.equal(G(kd2, 'rev-parse', a.kept), mine, '지금 머리는 가지로 남았다')
  await s.close()
})

test('auth.log 다시 적용 — 옛 명부로 되살린 뒤 끊은 기기 · 바꾼 비밀번호가 돌아오지 않는다', async () => {
  const d = path.join(tmp, 'authdata')
  let auth = await makeAuth({ dataDir: d, scryptN: 1 << 14 })
  await auth.addUser({ id: 'lee' })
  const key = await auth.deviceKeyFor('lee', { host: 'LEE-PC' })
  assert.ok(auth.bearer(key))
  const snapshot = fs.readFileSync(path.join(d, 'auth.json'))
  const dev = auth.devices('lee')[0].id
  await auth.revokeDevice('lee', dev)
  await auth.reset('lee')
  const log = fs.readFileSync(path.join(d, 'auth.log'), 'utf8')
  // 옛 명부로 되살림
  fs.writeFileSync(path.join(d, 'auth.json'), snapshot)
  auth = await makeAuth({ dataDir: d, scryptN: 1 << 14 })
  assert.ok(auth.bearer(key), '옛 명부에서는 끊은 기기가 살아 있다')
  const r = await auth.reapply(log)
  assert.equal(r.revoked, 1)
  assert.deepEqual(r.reset, ['lee'])
  assert.equal(auth.bearer(key), null)
  assert.equal((await auth.reapply(log)).revoked, 0, '두 번 적용해도 같은 일은 한 번')
})

test('GitLab 봇 — 백업 자리가 없는 지식에 저장소를 찾거나 만들어 붙인다', async () => {
  const bk = path.join(tmp, 'bk')
  fs.mkdirSync(bk, { recursive: true })
  const made = []
  const gl = http.createServer((req, res) => {
    const send = (st, j) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)) }
    if (req.headers['private-token'] !== 'bot-token') return send(401, {})
    if (req.method === 'GET' && req.url.startsWith('/api/v4/projects/')) return send(404, {})
    if (req.method === 'GET' && req.url.startsWith('/api/v4/groups/')) return send(200, { id: 7 })
    if (req.method === 'POST' && req.url === '/api/v4/projects') {
      let b = ''
      req.on('data', (c) => (b += c))
      req.on('end', () => {
        const j = JSON.parse(b)
        const bare = path.join(bk, `gl-${j.path}.git`)
        G(bk, 'init', '-q', '--bare', '-b', 'main', bare)
        made.push(j.path)
        send(201, { ssh_url_to_repo: bare })
      })
      return
    }
    send(404, {})
  })
  await new Promise((r) => gl.listen(0, '127.0.0.1', r))
  const root = path.join(tmp, 'home3')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  fs.mkdirSync(path.join(root, '.kmd'), { recursive: true })
  await setSecret(path.join(root, '.kmd'), 'gitlab', 'bot-token')
  const s = await serve(root, { gitlab: { api: `http://127.0.0.1:${gl.address().port}`, group: 'kmd-backup' } })
  assert.ok(await until(async () => !!(await s.hub.backupState(SHELL, 'dpms')) && !!(await s.hub.backupState(SHELL, 'gdi'))), '두 지식 모두 붙었다')
  assert.deepEqual(made.sort(), ['dpms', 'gdi'])
  assert.ok(!fs.readFileSync(path.join(root, '.kmd', 'backup', 'dpms.json'), 'utf8').includes('bot-token'), '열쇠는 상태 파일에 0')
  await s.close()
  gl.close()
})

test('PC 운영 — 늘 켜기 작업 · 깨진 판으로 올리면 앞 판 그대로', async () => {
  const xml = taskXml({ node: 'C:\\node\\node.exe', script: 'C:\\kmd\\server\\bin\\kmd.mjs', root: 'D:\\kmd', user: 'kim' })
  assert.match(xml, /<LogonTrigger>/)
  assert.match(xml, /<RestartOnFailure><Interval>PT1M<\/Interval>/)
  assert.match(xml, /up &quot;D:\\kmd&quot; --no-open/)
  // 판 둘 — 켜지는 판 · 켜자마자 넘어지는 판
  const mk = (name, body) => {
    const d = path.join(tmp, 'rel', name, 'server', 'bin')
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'kmd.mjs'), body)
    return path.join(tmp, 'rel', name)
  }
  const good = mk('good', "import http from 'node:http'\nconst p = Number(process.argv[process.argv.indexOf('--port') + 1])\nhttp.createServer((q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ ok: true })) }).listen(p, '127.0.0.1')\n")
  const bad = mk('bad', "throw new Error('깨진 판')\n")
  const home = path.join(tmp, 'app')
  const r1 = await upgrade({ home, from: good, ver: '0.2.0', waitMs: 10000 })
  assert.equal(r1.ok, true)
  assert.equal((await readCurrent(home)).ver, '0.2.0')
  const r2 = await upgrade({ home, from: bad, ver: '0.3.0', waitMs: 5000 })
  assert.equal(r2.ok, false)
  assert.equal(r2.rolledBack, true)
  assert.equal((await readCurrent(home)).ver, '0.2.0', '앞 판 그대로')
})
