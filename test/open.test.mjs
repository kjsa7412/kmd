// WP1 필수 — 들어가기 · 설치 · 판(제품화 검토 v0.1 F-001 · F-037 · F-038 · F-044 · F-060 · F-061 · F-116 · WP1 리뷰 37건).
//
// 이 PC 의 kmd 화면은 한 번용 번호로만 열리므로 설치한 사람이 언제든 다시 열 길이 있어야 한다 — `kmd open`(시작 메뉴의 kmd).
// 번호는 도는 kmd 에게 이 PC 의 열쇠(자격 저장소의 기기 열쇠)로 받는다 · 이미 켜져 있으면 `kmd up` 은 하나 더 켜지 않고 화면만 연다 ·
// 지난 번호 · 번호 없는 주소는 PC 전용 안내(팀 로그인 양식이 아니다) · 같은 탭에 새 번호를 붙여도 들어온다 · PC 쿠키는 쓰는 동안 늘어난다.
// 판을 바꾸면 실행기(<집>/bin)만 다시 쓴다(종료 코드는 그대로) · `kmd pc update` 는 지금 폴더 · 포트로 다시 켠다 · 설치 한 줄은 꾸러미가
// 있으면 받아 깐다 · Claude Code 잇기는 따옴표가 든 헤더 도우미도 JSON 그대로 · 설명서는 /manual · 명령 목록은 HELP 와 갈래가 같다.
// 팀 화면은 내 PC 프로그램이 답하지 않아도 지식 목록을 바로 그린다 · 처음 들어오기를 마치면 머리가 들어온 사람을 보인다.
// 이 PC 를 바꾸지 않는다 — 셸 명령은 KMD_NO_TASK · KMD_NO_BROWSER · KMD_NO_CLAUDE · 임시 HOME/APPDATA · --port 0 으로만 돌린다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { startServer, installPs } from '../server/http.js'
import { VERSION } from '../server/version.js'
import { makeAuth } from '../core/auth.js'
import { appHomeOf, linkVersion, taskXml, shortcutPs } from '../core/pcops.js'
import { mcpConfig, addMcp, mcpLine } from '../core/claudecfg.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KMD = path.join(HERE, '..', 'server', 'bin', 'kmd.mjs')
const CHROME = [process.env.KMD_CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p))
let tmp
const cliEnv = () => ({ ...process.env, HOME: tmp, USERPROFILE: tmp, APPDATA: path.join(tmp, 'appdata'), XDG_CONFIG_HOME: path.join(tmp, 'xdg'), KMD_NO_CLAUDE: '1', KMD_NO_BROWSER: '1', KMD_NO_TASK: '1', KMD_APP_HOME: '' })
const until = async (f, ms = 30_000) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 150)) } return true }
const readUp = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, '.kmd', 'up.json'), 'utf8')) } catch { return null } }
const kill = (pid) => { try { if (pid) process.kill(pid) } catch {} }

// 셸 명령 한 번 — 끝날 때까지
function kmd(args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [KMD, ...args], { env: { ...cliEnv(), ...env }, windowsHide: true })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('exit', (code) => resolve({ code, out }))
  })
}
// 오래 도는 kmd up — 다 켜질 때(「… 로 다시 연다」 줄)까지 기다린다
async function upPc(args) {
  const p = spawn(process.execPath, [KMD, 'up', ...args], { env: cliEnv(), windowsHide: true })
  const st = { p, out: '', exited: new Promise((r) => p.on('exit', (c) => r(c))) }
  p.stdout.on('data', (d) => (st.out += d))
  p.stderr.on('data', (d) => (st.out += d))
  assert.ok(await until(() => /로 다시 연다. 끄기 Ctrl C/.test(st.out), 60_000), '켜졌다: ' + st.out)
  return st
}
const opened = (out) => { const m = String(out).match(/\[열 주소\] (http:\/\/127\.0\.0\.1:\d+)\/#once=(\S+)/); return m ? { url: m[1], code: m[2] } : null }
const once = (url, code) => fetch(url + '/once', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
const cookieOf = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
const sameDir = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-open-'))
  delete process.env.KMD_APP_HOME
})
after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('kmd up → kmd open → 이미 켜짐 → 멈추기: 번호는 도는 kmd 에게 이 PC 의 열쇠로 · 지난 번호는 PC 의 말로', async () => {
  const root = path.join(tmp, 'pc')
  fs.mkdirSync(root, { recursive: true })
  const up = await upPc([root, '--port', '0', '--no-worker'])
  try {
    const first = opened(up.out)
    assert.ok(first, '첫 창의 한 번용 주소')
    const port = new URL(first.url).port
    const rec = readUp(root)
    assert.equal(rec.url, first.url, 'up.json 에 도는 주소')
    assert.equal(rec.pid, up.p.pid)
    assert.ok(sameDir(rec.root, root))
    // 첫 번호로 들어온다 · 같은 번호는 두 번 안 된다(까닭은 PC 의 말 — 시작 메뉴 · kmd open)
    const r1 = await once(first.url, first.code)
    assert.equal(r1.status, 200)
    const r1b = await once(first.url, first.code)
    assert.equal(r1b.status, 401)
    assert.match((await r1b.json()).message, /지났거나 이미 썼다. 시작 메뉴의 kmd\(또는 터미널에서 kmd open\)/)
    // kmd open — 새 번호로 연다(못 찾아도 그 포트로만 켜 본다 — 7373 에 남지 않게)
    const o = await kmd(['open', root, '--port', port])
    assert.equal(o.code, 0, o.out)
    assert.match(o.out, /✓ 이 PC 의 kmd 화면을 열었다/)
    const second = opened(o.out)
    assert.ok(second && second.code !== first.code, '새 번호')
    const r2 = await once(second.url, second.code)
    assert.equal(r2.status, 200)
    const me = await fetch(second.url + '/api/me', { headers: { cookie: cookieOf(r2) } }).then((x) => x.json())
    assert.equal(me.mode, 'pc')
    assert.ok(!me.anon, '들어왔다')
    // 같은 포트로 kmd up 을 다시 치면 — 하나 더 켜지 않고 그 화면을 연다(늘 켜기 작업이 다시 돌아도 실패로 남지 않는다)
    const again = await kmd(['up', root, '--port', port, '--no-worker'])
    assert.equal(again.code, 0, again.out)
    assert.match(again.out, /이미 켜져 있다/)
    assert.ok(opened(again.out), '그 화면을 연다')
    // 다른 폴더로 같은 포트를 켜면 — 남의 kmd 를 열지 않는다
    const other = await kmd(['up', path.join(tmp, 'pc-other'), '--port', port, '--no-worker'])
    assert.equal(other.code, 1, other.out)
    assert.match(other.out, /다른 폴더의 kmd 가 돈다/)
    // 멈추기 — 이 PC 의 kmd 만(쿠키 · 이 PC 의 열쇠) · 끄면 up.json 을 치운다
    const st = await fetch(first.url + '/api/pc/stop', { method: 'POST', headers: { cookie: cookieOf(r2), 'content-type': 'application/json' }, body: '{}' })
    assert.equal(st.status, 200)
    assert.equal(await up.exited, 0, '스스로 끝났다')
    assert.equal(readUp(root), null, 'up.json 을 치웠다')
    // 꺼져 있을 때 kmd open — 켜고 연다(따로 띄운 kmd 는 아래에서 멈춘다)
    const o2 = await kmd(['open', root, '--port', '0', '--no-worker'])
    assert.equal(o2.code, 0, o2.out)
    assert.match(o2.out, /꺼져 있다. 켠다/)
    const third = opened(o2.out)
    assert.ok(third, o2.out)
    const r3 = await once(third.url, third.code)
    assert.equal(r3.status, 200)
    await fetch(third.url + '/api/pc/stop', { method: 'POST', headers: { cookie: cookieOf(r3), 'content-type': 'application/json' }, body: '{}' })
    assert.ok(await until(async () => !(await fetch(third.url + '/healthz?live=1').then(() => true, () => false)), 20_000), '따로 띄운 kmd 도 멈췄다')
  } finally {
    up.p.kill()
    kill(readUp(root)?.pid) // 실패한 길에서 따로 켜진 kmd 가 남지 않게
  }
})

test('kmd pc update: 그 판으로 켜 보고 · 지금 폴더 · 포트로 다시 켠다 · 지금 판 이름에는 덮어쓰지 않는다', async () => {
  const { stage } = await import('../scripts/pack.mjs')
  const home = path.join(tmp, 'app2')
  const nv = stage(path.join(tmp, 'newver'))
  const root = path.join(tmp, 'pc5')
  fs.mkdirSync(root, { recursive: true })
  const up = await upPc([root, '--port', '0', '--no-worker', '--no-open'])
  try {
    const rec = readUp(root)
    const port = new URL(rec.url).port
    // --root 없이 — 도는 kmd 에게 이 PC 의 열쇠로 물어 그 폴더를 쓴다(기본 폴더로 바꿔 놓지 않는다)
    const u = await kmd(['pc', 'update', nv, '9.9.9-t', '--home', home, '--port', port])
    assert.equal(u.code, 0, u.out)
    assert.match(u.out, /✓ 새 판 9\.9\.9-t 이 켜지는 것을 보고 지금 판으로 했다/)
    assert.match(u.out, /✓ 다시 켰다/)
    assert.equal(await up.exited, 0, '앞 kmd 는 이 PC 의 열쇠로 멈췄다')
    const rec2 = readUp(root)
    assert.ok(rec2 && rec2.pid !== rec.pid, '새 kmd')
    assert.equal(rec2.url, rec.url, '같은 포트')
    assert.ok(sameDir(rec2.root, root), '같은 폴더')
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'current.json'), 'utf8')).ver, '9.9.9-t')
    assert.ok(fs.readFileSync(path.join(home, 'bin', process.platform === 'win32' ? 'kmd.cmd' : 'kmd'), 'utf8').includes('9.9.9-t'), '실행기가 새 판')
    // 지금 판 이름으로 다시 — 도는 판 폴더 위에 덮어쓰지 않는다
    const same = await kmd(['pc', 'update', nv, '9.9.9-t', '--home', home, '--port', port])
    assert.equal(same.code, 1, same.out)
    assert.match(same.out, /9\.9\.9-t 은 지금 판이다/)
    // kmd pc restart — 멈추고 같은 포트로 다시
    const rs = await kmd(['pc', 'restart', '--root', root, '--port', port])
    assert.equal(rs.code, 0, rs.out)
    assert.match(rs.out, /✓ 다시 켰다/)
    assert.notEqual(readUp(root).pid, rec2.pid)
  } finally {
    up.p.kill()
    kill(readUp(root)?.pid)
  }
})

test('서버 길: 번호 · 멈추기는 PC 의 kmd 에만 · 짝 열쇠는 닿지 않는다 · PC 쿠키는 쓰는 동안 늘고 모든 곳에서 나가기로 끊긴다', async () => {
  const pcRoot = path.join(tmp, 'pc2')
  fs.mkdirSync(path.join(pcRoot, '.kmd'), { recursive: true })
  let tk = null
  const pc = await startServer({ root: pcRoot, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15, deviceKey: async () => tk })
  const team = await startServer({ root: path.join(tmp, 'team2'), port: 0, log: () => {}, scryptN: 1 << 15 })
  const teamO = new URL(team.url).origin
  fs.writeFileSync(path.join(pcRoot, '.kmd', 'teams.json'), JSON.stringify([teamO]))
  try {
    const key = await pc.auth.deviceKeyFor('kim', { host: 'KIM-PC', osuser: 'kim' })
    const post = (u, p, headers = {}, body = '{}') => fetch(u + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })
    const r = await post(pc.url, '/api/pc/once', { authorization: 'Bearer ' + key })
    assert.equal(r.status, 200)
    const { code } = await r.json()
    const in1 = await once(pc.url, code)
    assert.equal(in1.status, 200, '받은 번호로 들어온다')
    assert.equal((await post(pc.url, '/api/pc/once')).status, 401, '열쇠 없이는 안 된다')
    assert.equal((await fetch(pc.url + '/api/pc/once', { headers: { authorization: 'Bearer ' + key } })).status, 405, 'POST 로만')
    const st = await post(pc.url, '/api/pc/stop', { authorization: 'Bearer ' + key })
    assert.equal(st.status, 404, '멈출 길이 없는 kmd(시험 안의 서버)는 멈추지 않는다')
    // 살아 있나는 가볍게 — 멈춤 줄 없이 곧바로
    const live = await fetch(pc.url + '/healthz?live=1').then((x) => x.json())
    assert.deepEqual(Object.keys(live).sort(), ['mode', 'ok', 'version'])
    // 팀 화면의 짝 열쇠 — 읽기 · 저장만이라 번호를 받지 못한다
    const kim = await signIn(team, { id: 'kim' })
    tk = kim.key
    const pass = (await post(team.url, '/api/me/pcpass', { cookie: kim.cookie }).then((x) => x.json())).pass
    const pr = await post(pc.url, '/pair', { origin: teamO }, JSON.stringify({ pass }))
    assert.equal(pr.status, 200)
    const pair = (await pr.json()).token
    assert.equal((await post(pc.url, '/api/pc/once', { origin: teamO, authorization: 'Bearer ' + pair })).status, 403)
    // 허락한 팀 화면 끊기 — 이 PC 화면에서만 · 이름 · IP 와 포트만 · 받은 짝 열쇠도 끊긴다
    const ck = cookieOf(in1)
    assert.equal((await post(pc.url, '/api/pair/forget', { cookie: ck }, JSON.stringify({ origin: 'http://x&calc.example' }))).status, 400)
    assert.equal((await post(pc.url, '/api/pair/forget', { origin: teamO, authorization: 'Bearer ' + pair }, JSON.stringify({ origin: teamO }))).status, 403)
    assert.equal((await post(pc.url, '/api/pair/forget', { cookie: ck }, JSON.stringify({ origin: teamO }))).status, 200)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pcRoot, '.kmd', 'teams.json'), 'utf8')), [])
    assert.equal((await fetch(pc.url + '/api/knowledge', { headers: { origin: teamO, authorization: 'Bearer ' + pair } })).status, 403)
    // 팀 서버에는 이 길이 없다
    const lee = await signIn(team, { id: 'lee' })
    assert.notEqual((await post(team.url, '/api/pc/once', { cookie: lee.cookie })).status, 200)
  } finally {
    await pc.close()
    await team.close()
  }
  // 쓰는 동안 늘어난다 — 하루가 지나 쓰면 새 쿠키(그날부터 30일) · 안 쓰면 30일 뒤 끝 · 모든 곳에서 나가기면 바로 끝
  let t = Date.parse('2026-10-01T00:00:00Z')
  const dataDir = path.join(tmp, 'pcauth')
  fs.mkdirSync(dataDir, { recursive: true })
  const a = await makeAuth({ dataDir, mode: 'pc', scryptN: 1 << 15, now: () => t })
  await a.ensurePc('kim')
  const c0 = a.takeOnce(a.once('kim')).split(';')[0]
  t += 3600_000
  assert.ok(a.session(c0)?.ctx && !a.session(c0).set, '하루 안에는 그대로')
  t += 2 * 24 * 3600_000
  const s1 = a.session(c0)
  assert.ok(s1.set, '새 쿠키')
  const c1 = s1.set.split(';')[0]
  t += 29 * 24 * 3600_000
  assert.equal(a.session(c0), null, '옛 쿠키는 30일 뒤 끝')
  assert.equal(a.session(c1)?.ctx.user, 'kim', '새 쿠키는 쓴 날부터 30일')
  await a.logoutAll('kim')
  assert.equal(a.session(c1), null, '모든 곳에서 나가기로 끊긴다')
})

test('판 자리 · 실행기: 판을 바꾸면 실행기만 다시 쓴다 · 종료 코드를 그대로 넘긴다 · 작업 · 시작 메뉴 · 헤더 도우미는 실행기를 부른다', async () => {
  const home = path.join(tmp, 'app')
  const mk = (ver, body = null) => {
    const d = path.join(home, 'versions', ver, 'server', 'bin')
    fs.mkdirSync(d, { recursive: true })
    for (const n of ['kmd', 'kmd-key']) fs.writeFileSync(path.join(d, n + '.mjs'), body || `console.log('${n} ${ver} ' + process.argv.slice(2).join(' '))\n`)
    return path.join(d, 'kmd.mjs')
  }
  const s1 = mk('1.2.3')
  mk('1.2.4')
  assert.equal(appHomeOf(s1), null, '실행기가 서기 전에는 판 자리로 보지 않는다')
  assert.deepEqual(appHomeOf(s1, { shape: true }), { home, ver: '1.2.3' }, '처음 실행기를 세우는 pc link 만 모양으로')
  assert.equal(appHomeOf(KMD, { shape: true }), null, '저장소에서 돌면 판 자리가 아니다')
  const r1 = await linkVersion(home, '1.2.3')
  assert.deepEqual(appHomeOf(s1), { home, ver: '1.2.3' })
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'current.json'), 'utf8')).ver, '1.2.3')
  const r2 = await linkVersion(home, '1.2.4')
  assert.equal(r2.prev, '1.2.3')
  assert.ok(fs.existsSync(r1.kmd) && fs.existsSync(r1.key))
  await assert.rejects(linkVersion(home, '9.9.9'), /판 자리에 9.9.9 이 없다/)
  await assert.rejects(linkVersion(home, '../x'), /판 이름이 아니다/)
  // 실행기는 지금 판을 부른다(인자 그대로 · 임시 폴더가 한글이어도 — %~dp0 상대 경로)
  const runL = (f, args) => (process.platform === 'win32' ? spawnSync('cmd.exe', ['/d', '/c', f, ...args], { encoding: 'utf8' }) : spawnSync(f, args, { encoding: 'utf8' }))
  assert.equal(runL(r2.kmd, ['open', 'D:\\kmd']).stdout.trim(), 'kmd 1.2.4 open D:\\kmd')
  assert.equal(runL(r2.key, ['http://127.0.0.1:7373']).stdout.trim(), 'kmd-key 1.2.4 http://127.0.0.1:7373')
  // 종료 코드 — node 가 3 으로 끝나면 실행기도 3 · 도는 중에 바뀐 파일의 뒤쪽 줄은 읽지 않는다
  mk('7.0.0', 'process.exit(3)\n')
  const r7 = await linkVersion(home, '7.0.0')
  assert.equal(runL(r7.kmd, []).status, 3, '종료 코드를 그대로')
  if (process.platform === 'win32') {
    fs.appendFileSync(r7.kmd, '@echo 새는줄\r\n')
    const x = runL(r7.kmd, [])
    assert.equal(x.status, 3)
    assert.ok(!x.stdout.includes('새는줄'), '같은 줄에서 끝난다')
  }
  await linkVersion(home, '1.2.4')
  // 늘 켜기 작업 — 실행기를 부르면 판을 바꿔도 다시 걸 일이 없다
  const xml = taskXml({ root: 'D:\\kmd', launcher: r2.kmd, user: 'kim' })
  // 창 없이 — .cmd 곁의 kmd-hidden.vbs 를 wscript 로
  const vbs = path.join(path.dirname(r2.kmd), 'kmd-hidden.vbs')
  if (process.platform === 'win32') {
    assert.ok(xml.includes('<Command>wscript.exe</Command>'))
    assert.ok(xml.includes(`<Arguments>&quot;${vbs}&quot; up &quot;D:\\kmd&quot; --no-open</Arguments>`))
    assert.ok(fs.existsSync(vbs), '실행기와 함께 쓴다')
    // 인자(빈칸 · 한글)를 그대로 넘기고 kmd.cmd 의 종료 코드를 돌려준다
    mk('7.0.1', "process.exit(process.argv.slice(2).join('|') === 'up|D:\\\\내 지식|--no-open' ? 5 : 4)\n")
    await linkVersion(home, '7.0.1')
    assert.equal(spawnSync('cscript', ['//nologo', vbs, 'up', 'D:\\내 지식', '--no-open']).status, 5)
    await linkVersion(home, '1.2.4')
  } else {
    assert.ok(xml.includes(`<Command>${r2.kmd}</Command>`))
    assert.match(xml, /<Arguments>up &quot;D:\\kmd&quot; --no-open<\/Arguments>/)
  }
  assert.ok(taskXml({ node: 'C:\\n\\node.exe', script: 'C:\\k\\kmd.mjs', root: 'D:\\kmd', user: 'kim' }).includes('&quot;C:\\k\\kmd.mjs&quot; up'), '실행기가 없으면 예전처럼')
  const task = await kmd(['pc', 'task', '--root', path.join(tmp, '내 지식'), '--print'])
  assert.ok(task.out.includes(path.join(tmp, '내 지식')), '--root 를 받는다')
  const ps = shortcutPs({ target: r2.kmd, args: 'open', dir: 'C:\\x' })
  assert.match(ps, /CreateShortcut/)
  assert.ok(ps.includes(`$s.TargetPath='${r2.kmd}'`) && ps.includes("$s.Arguments='open'"))
  assert.equal(mcpConfig('http://h', `"${r2.key}"`).headersHelper, `"${r2.key}" http://h`)
  assert.match(mcpConfig('http://h').headersHelper, /^node ".+kmd-key\.mjs" http:\/\/h$/, '저장소에서 돌면 node 와 kmd-key.mjs')
  // kmd pc link — 판 자리의 그 판이 부르면(설치 한 줄) 지금 판이 된다
  const l = await kmd(['pc', 'link', '1.2.3'], { KMD_APP_HOME: home })
  assert.equal(l.code, 0, l.out)
  assert.match(l.out, /✓ 지금 판 1\.2\.3/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'current.json'), 'utf8')).ver, '1.2.3')
})

test('Claude Code 잇기: 따옴표가 든 헤더 도우미도 JSON 그대로 · 있던 것을 먼저 지우지 않는다 · 주소가 아니면 부르지 않는다', { skip: process.platform !== 'win32' && 'Windows 의 claude.cmd 길' }, async () => {
  // 가짜 claude.cmd(npm 꼴 — %* 를 node 로 넘긴다)를 PATH 맨 앞에 — 진짜 Claude Code 설정은 건드리지 않는다
  const bin = path.join(tmp, 'fakeclaude')
  fs.mkdirSync(bin, { recursive: true })
  const log = path.join(bin, 'args.jsonl')
  fs.writeFileSync(path.join(bin, 'fake.js'), `require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n')\n`)
  fs.writeFileSync(path.join(bin, 'claude.cmd'), '@node "%~dp0fake.js" %*\r\n')
  const old = { PATH: process.env.PATH, NO: process.env.KMD_NO_CLAUDE }
  process.env.PATH = bin + ';' + process.env.PATH
  delete process.env.KMD_NO_CLAUDE
  try {
    const helper = `"${path.join(tmp, "홍 길동's", '.kmd-app', 'bin', 'kmd-key.cmd')}"`
    const r = await addMcp('kmd', 'http://127.0.0.1:7373', helper)
    assert.equal(r.ok, true, JSON.stringify(r))
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    assert.deepEqual(calls.map((c) => c.slice(0, 3)), [['mcp', 'add-json', 'kmd']], '더하기만: 먼저 지우지 않는다')
    assert.equal(JSON.parse(calls[0][3]).headersHelper, `${helper} http://127.0.0.1:7373`, 'JSON 이 그대로 닿는다')
    const bad = await addMcp('kmd-team', 'http://x&calc.example', helper)
    assert.equal(bad.ok, false)
    assert.match(bad.why, /주소가 아니다/)
    assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1, '나쁜 주소로는 부르지 않았다')
    assert.match(mcpLine('kmd', 'http://127.0.0.1:7373', helper), /^claude\.cmd --% mcp add-json kmd "\{\\"type\\":/, '손 줄은 PowerShell 에서 되는 꼴')
  } finally {
    process.env.PATH = old.PATH
    if (old.NO) process.env.KMD_NO_CLAUDE = old.NO
  }
})

test('설치 한 줄 · 받기 · 설명서: 꾸러미가 있으면 받아 깔고 잇는다 · 없으면 까닭과 할 일 · 설명서는 들어오지 않아도', async () => {
  const kn = path.join(tmp, 'team3')
  copyDir(path.join(HERE, 'fixture', 'kmd'), kn)
  const team = await startServer({ root: kn, port: 0, log: () => {}, scryptN: 1 << 15 })
  const pc = await startServer({ root: path.join(tmp, 'pc3'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const T = 'kmdt_ABCDEFGHIJKLMNOP'
    const none = await fetch(`${team.url}/i/${T}`).then((x) => x.text())
    assert.match(none, /팀 서버에도 PC 꾸러미가 없다/)
    assert.ok(!none.includes('Invoke-WebRequest'))
    assert.match(await fetch(team.url + '/dl').then((x) => x.text()), /아직 PC 꾸러미가 없다/)
    // 고르기 — 이 서버와 같은 판을 먼저, 없으면 가장 높은 판
    const dl = path.join(kn, '.kmd', 'dl')
    fs.mkdirSync(dl, { recursive: true })
    for (const v of ['0.0.9', VERSION, '9.9.9']) fs.writeFileSync(path.join(dl, `kmd-${v}-pc.zip`), 'zip')
    const ps = await fetch(`${team.url}/i/${T}`).then((x) => x.text())
    assert.ok(ps.includes(`$n = 'kmd-${VERSION}-pc.zip'`), '이 서버와 같은 판 · ' + ps.slice(0, 200))
    fs.rmSync(path.join(dl, `kmd-${VERSION}-pc.zip`))
    assert.ok((await fetch(`${team.url}/i/${T}`).then((x) => x.text())).includes("$n = 'kmd-9.9.9-pc.zip'"), '없으면 가장 높은 판')
    assert.ok(ps.includes('Invoke-WebRequest "$o/dl/$n"') && ps.includes('pc link $v') && ps.includes('& $k connect $o --ticket $t'))
    assert.ok(ps.includes("'DoNotExpandEnvironmentNames'") && ps.includes("'ExpandString'"), '사용자 PATH 의 원문과 종류를 지킨다')
    assert.ok(ps.includes("Join-Path $a 'bin\\kmd.cmd'") && ps.includes('이미 깐 kmd 를 쓴다'), '이미 깐 실행기는 다시 받지 않는다')
    assert.ok(ps.includes('$env:KMD_NO_PATH') && ps.includes('$env:KMD_APP_HOME'), '시험이 이 PC 를 바꾸지 않을 길')
    assert.match(await fetch(team.url + '/dl').then((x) => x.text()), /설치 한 줄/)
    const z = await fetch(team.url + '/dl/kmd-9.9.9-pc.zip')
    assert.equal(z.status, 200)
    assert.equal(z.headers.get('content-length'), '3')
    assert.equal(await z.text(), 'zip', '흘려 보낸 꾸러미')
    // PowerShell 이 읽을 수 있는 글인가(돌리지 않고 해석만)
    if (process.platform === 'win32') {
      for (const [i, body] of [ps, none, installPs({ origin: "http://it's", ticket: T, pkg: { name: 'kmd-1-pc.zip', ver: '1' } })].entries()) {
        const f = path.join(tmp, `i${i}.ps1`)
        fs.writeFileSync(f, '\ufeff' + body)
        const errs = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${f}',[ref]$t,[ref]$e);$e.Count`], { encoding: 'utf8' }).trim()
        assert.equal(errs, '0', `해석 오류 없음 ${i}`)
      }
    }
    // 설명서 — 팀은 넷 · PC 는 둘 · 설명서끼리 링크 · 없는 것은 404
    const m0 = await fetch(team.url + '/manual')
    assert.equal(m0.status, 200)
    assert.match(m0.headers.get('content-security-policy'), /default-src 'none'/)
    const t0 = await m0.text()
    assert.match(t0, /kmd 설명서: <b>쓰는 사람<\/b>/)
    assert.ok(t0.includes('/manual/' + encodeURIComponent('관리자')))
    const adm = await fetch(team.url + '/manual/' + encodeURIComponent('관리자')).then((x) => x.text())
    assert.ok(adm.includes(`href="/manual/${encodeURIComponent('운영')}"`), '관리자 설명서 → 운영 링크')
    assert.equal((await fetch(pc.url + '/manual/' + encodeURIComponent('관리자'))).status, 404, 'PC 에는 관리자 설명서가 없다')
    assert.match(await fetch(pc.url + '/manual').then((x) => x.text()), /쓰는 사람/)
    assert.equal((await fetch(team.url + '/manual/없음')).status, 404)
  } finally {
    await team.close()
    await pc.close()
  }
})

test('명령 목록: main 의 갈래마다 HELP 에 한 줄 · 관리자 설명서의 셸 표도 HELP 안의 것', async () => {
  const src = fs.readFileSync(KMD, 'utf8')
  const cmds = [...new Set([...src.matchAll(/cmd === '([a-z][a-z-]*)'\) return/g)].map((m) => m[1]).concat(['serve', 'up']))]
  const help = (await kmd(['help'])).out
  for (const c of cmds) assert.match(help, new RegExp(`kmd ${c}\\b`), `HELP 에 kmd ${c}`)
  for (const s of ['pc update', 'pc restart', 'pc link', 'pc task']) assert.ok(help.includes('kmd ' + s), `HELP 에 kmd ${s}`)
  const admin = fs.readFileSync(path.join(HERE, '..', 'docs', '설명서_관리자.md'), 'utf8')
  const inTable = [...admin.matchAll(/^\| `kmd ([a-z-]+)/gm)].map((m) => m[1])
  assert.ok(inTable.length >= 8, '관리자 셸 표 ' + inTable.join(' '))
  for (const c of inTable) assert.ok(cmds.includes(c), `관리자 표의 kmd ${c} 는 있는 명령`)
})

test('화면: PC 전용 안내 · 같은 탭의 새 번호 · 처음 들어오기 뒤 머리 · 내 PC 가 답하지 않아도 목록 · 들어가기 화면에서 벗어나기 · 설명서 입구', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const env = { ...process.env }
  const pc = await startServer({ root: path.join(tmp, 'pc4'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  // 연결은 받고 답하지 않는 「멈춘 내 PC 프로그램」
  const hung = net.createServer(() => {})
  await new Promise((r) => hung.listen(0, '127.0.0.1', r))
  const kn = path.join(tmp, 'team4')
  copyDir(path.join(HERE, 'fixture', 'kmd'), kn)
  fs.mkdirSync(path.join(kn, '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(kn, '.kmd', 'serve.json'), JSON.stringify({ pcUrl: `http://127.0.0.1:${hung.address().port}` }))
  const team = await startServer({ root: kn, port: 0, log: () => {}, scryptN: 1 << 15 })
  if (!/^[\x20-\x7e]*$/.test(os.tmpdir())) {
    const ascii = path.join(HERE, '..', '.kmd-data', 'tmp')
    fs.mkdirSync(ascii, { recursive: true })
    env.TEMP = env.TMP = ascii
  }
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, env })
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 820 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    // PC — 번호 없이 · 지난 번호로 열면 PC 의 안내(팀 로그인 양식이 아니다)
    await page.goto(pc.url + '/')
    await page.waitForSelector('[data-t=pcGate]')
    assert.equal(await page.locator('#lgId').count(), 0, '아이디 칸이 없다')
    assert.match(await page.locator('[data-t=pcGate]').innerText(), /시작 메뉴 › kmd[\s\S]*kmd open[\s\S]*kmd\.cmd open/)
    await page.goto(pc.url + '/#once=지난번호')
    await page.waitForSelector('[data-t=onceErr]')
    assert.match(await page.locator('[data-t=onceErr]').innerText(), /지났거나 이미 썼다/)
    // 같은 탭에 새 번호(시작 메뉴 kmd 가 이미 열린 탭을 다시 쓸 때) — 새로 고침 없이 들어온다
    await page.evaluate((c) => { location.hash = 'once=' + c }, pc.auth.once(pc.pcUser))
    await page.waitForSelector('[data-t=klist]')
    assert.equal(await page.locator('[data-t=pcGate]').count(), 0)
    assert.equal(await page.locator('[data-t=manual]').getAttribute('href'), '/manual', '설명서 입구')
    // 팀 — 처음 들어오기를 마치면 머리 · 옆 메뉴가 들어온 사람이다 · 같은 링크를 다시 열면 「쓸 수 없다 — 들어와 있다」
    const { code } = await team.auth.addUser({ id: 'choi' })
    await team.auth.deviceKeyFor('choi', { host: 'CHOI-PC', osuser: 'choi' }) // 설치 한 줄로 이은 PC — 팀 화면이 내 PC 를 묻는다
    const tp = await browser.newPage({ viewport: { width: 1300, height: 820 } })
    tp.on('pageerror', (e) => errors.push(e.message))
    await tp.goto(`${team.url}/first#code=${code}`)
    await tp.fill('#fsPw', 'choi-password-1')
    await tp.click('[data-t=firstBtn]')
    await tp.waitForSelector('[data-t=firstDone]')
    assert.match(await tp.locator('[data-t=me]').innerText(), /choi/)
    assert.equal(await tp.locator('aside.side.dim').count(), 0, '옆 메뉴가 흐리지 않다')
    await tp.goto(`${team.url}/first#code=${code}`)
    await tp.waitForSelector('[data-t=firstGone]')
    assert.match(await tp.locator('[data-t=firstGone]').innerText(), /쓸 수 없다\(이미 썼거나 지났다\)\. 지금 choi로 들어와 있다/)
    // 들어온 채 보던 들어가기 화면 — 찾기(Ctrl K)로 옮기면 닫히고 찾기가 열린다
    await tp.keyboard.press('Control+KeyK')
    await tp.waitForSelector('[data-t=pal]')
    assert.equal(await tp.locator('[data-t=firstGone]').count(), 0, '들어가기 화면이 닫혔다')
    await tp.keyboard.press('Escape')
    await tp.waitForSelector('[data-t=klist]')
    // 새로 고침 — 멈춘 내 PC 프로그램을 기다리지 않는다: 목록이 설 때 내 PC 는 아직 「잇는 중」 이다(시간이 아니라 순서로 본다)
    await tp.reload()
    await tp.waitForSelector('[data-t=klist]')
    assert.equal(await tp.locator('[data-t=pcWait]').count(), 1, '목록은 PC 를 기다리지 않고 섰다')
    // 묻는 시간(15초)이 지나면 꺼짐 한 줄 — 다시 잇기는 15초마다
    await tp.waitForSelector('[data-t=pcOff]', { timeout: 40_000 })
    assert.equal(await tp.locator('[data-t=klist]').count(), 1)
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    hung.close()
    await team.close()
    await pc.close()
  }
})
