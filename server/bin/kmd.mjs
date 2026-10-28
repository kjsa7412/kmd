#!/usr/bin/env node
// kmd 명령 — 하나로 다 한다.
//
//   kmd serve [폴더]   팀 서버로 연다(같이 쓴다) · 기본 포트 7373
//   kmd up [폴더]      이 PC 의 kmd 를 열고 화면을 띄운다(나만 쓴다) · 폴더 기본 D:\kmd 또는 ~/kmd
//
// 폴더 안의 폴더 하나하나가 지식이다. 폴더 자체가 지식 모양(docs/ · work/)이면 그 하나만.

import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { startServer } from '../http.js'
import { makeHub, defaultDataDir, SHELL } from '../hub.js'
import { enqueue } from '../../core/backup.js'
import { VERSION } from '../version.js'
import { isReservedUser } from '../../core/names.js'
import { makeAuth } from '../../core/auth.js'
import { put as kput, get as kget, keyName } from '../../core/keystore.js'
import { setSecret, listSecrets, getSecret } from '../../core/secrets.js'
import { prehash } from '../../app/prehash.js'

import { addMcp, mcpLine, safeOrigin } from '../../core/claudecfg.js'
import { taskXml, upgrade, appHomeOf, launcherOf, linkVersion, makeShortcut, readPcRoot, writePcRoot, pcRootKind } from '../../core/pcops.js'
import { installLines, pickBackupDir } from '../../core/install.js'
import { ensureRepo } from '../../core/git.js'
import { install as kitInstall, folders as kitFolders, setFolders as kitSetFolders, addKn as kitAddKn, defOf as kitDefOf } from '../../core/kit.js'

// 명령 목록 — 여기 줄과 아래 main 의 갈래가 같아야 한다(test/open.test.mjs 가 센다). 관리자 설명서의 셸 표도 이 줄에서 고른다
const HELP = `kmd ${VERSION}

  이 PC
  kmd up [폴더] [--port 7373] [--no-open]
      이 PC 의 kmd 를 켜고 화면을 연다. 폴더 기본 D:\\kmd(없으면 집 폴더의 kmd) · 이미 켜져 있으면 화면만 연다
  kmd open [폴더] [--pc]                       화면을 연다: 팀에 이은 PC 는 팀 화면(내 PC 쪽은 켜 둔다) · --pc 면 이 PC 의 화면. 시작 메뉴의 kmd 와 같다
  kmd agent add <개인 지식> [--dir 폴더]          작업 폴더의 Claude Code 에 이 PC 의 개인 지식을 더한다(팀 화면 › 에이전트 설치가 복사해 준다)
  kmd connect <팀 주소> [--ticket kmdt_…]       팀에 잇는다. 설치 한 줄이 부른다(아이디 · 비밀번호로도)
                                               --kn <팀 지식>: 지금 폴더를 그 팀 지식에 붙인다(에이전트 설치 · 팀)
  kmd pc task [폴더]                           로그온 때 켜고 멈추면 다시(작업 스케줄러) · 시작 메뉴의 kmd
  kmd pc update <새 판 폴더> <판> [--root 폴더]
      새 판을 켜 보고 될 때만 바꾸고 다시 켠다(안 켜지면 앞 판으로): 폴더는 늘 켜기 작업 · 도는 kmd 의 것
  kmd pc restart                               도는 이 PC 의 kmd 를 멈추고 다시 켠다(꺼져 있으면 켠다)
  kmd pc switch <폴더> [--pid 앞 kmd]             지식 폴더를 바꿔 다시 켠다(팀 화면 › 설정 · 개인 › 지식 폴더가 부른다)
  kmd pc link [판]                             판 자리(~/.kmd-app/versions)의 이 판을 지금 판으로: 설치 한 줄이 부른다

  팀 서버
  kmd serve [폴더] [--port 7373] [--host 127.0.0.1] [--user 이름]
      팀 서버로 연다. 폴더 안의 폴더 하나하나가 지식이다
  kmd user [add <아이디> [--admin] | reset <아이디> | off <아이디> [--to 받을 사람]] [--url 팀 주소]
      사람 목록 · 더하기 · 비밀번호 다시 정하기: 처음 들어오기 링크(24시간 · 한 번)를 찍는다
      off: 떠남: 들어가기 · 기기 · PC 일꾼을 끊고 아이디를 남긴다(되쓰지 않는다) · 그 사람이 주인인 지식은 --to 에게,
            없으면 주인 칸을 비운다(개인 지식은 관리자만 본다)
  kmd owner <지식> [사람] [--curators 가,나]
      지식의 주인 · 개인(주인만 본다) · 정리하는 사람
  kmd worker add                               정리 일꾼 열쇠를 만든다(한 번만 보인다)
  kmd worker key set <팀 주소>                 정리 일꾼 열쇠를 이 OS 사용자의 자격 저장소에(숨김 입력)
  kmd worker <팀 주소>                         정리 일꾼: 늘 돈다(이 OS 사용자의 Claude Code 로그인으로)
  kmd secret set <이름>                        비밀 넣기(숨김 입력) · kmd secret 은 목록
  kmd machine add <지식> <원천> [--types 가,나] · kmd machine revoke <machine-…>
      바깥 생성기용 기계 열쇠(그 지식 · 그 표만 · 1년)
  kmd search-check <지식> [--freeze]           찾기 점검: 얼린 시험지 위에서 나빠진 문항
  kmd auth reapply <auth.log>                  옛 명부로 되살린 뒤 늦은 일을 다시 적용

  둘 다
  kmd backup [add <지식> <주소> | pull <지식>]  백업 상태 · 백업 자리 붙이기 · 백업에서 받기(앞으로만): 개인 지식도(관리 권한)
  kmd restore <백업 주소> [이름] [--practice | --attach]
      백업 자리에서 지식을 새 폴더로 되살린다. 원래 이름이면 같은 백업으로 이어 보낸다 · 다른 이름 · --practice 는 읽기만 사본

  공통: --root <폴더>  지식 폴더 · --data <폴더>  kmd 의 살림 자리(기본 <폴더>/.kmd)
  설명서: 화면 오른쪽 위 「설명서」 · <서버 주소>/manual
`

function parse(argv) {
  const o = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--no-open') o.open = false
    else if (a.startsWith('--no-')) o[a.slice(5)] = 'false' // --no-backup · --no-task · --no-worker
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      o[k] = v ?? (argv[i + 1] == null || argv[i + 1].startsWith('--') ? 'true' : argv[++i])
    } else o._.push(a)
  }
  return o
}

// 이 PC 의 지식 폴더 — KMD_PC_ROOT(시험 · 손 설치) · 팀 화면에서 고른 폴더(지식 폴더 표) · D:\kmd · 집 폴더의 kmd
function defaultPcRoot() {
  if (process.env.KMD_PC_ROOT) return path.resolve(process.env.KMD_PC_ROOT)
  const picked = readPcRoot()
  if (picked) return picked
  if (process.platform === 'win32' && fs.existsSync('D:\\')) return 'D:\\kmd'
  return path.join(os.homedir(), 'kmd')
}

function openBrowser(url) {
  if (process.env.KMD_NO_BROWSER) return void console.log(`[열 주소] ${url}`) // 시험 — 브라우저를 띄우지 않고 주소만
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref()
}

// ── 이 PC 의 kmd 찾기 · 화면 열기 · 멈추기 · 다시 켜기 ──
// `kmd up` 은 다 켜진 뒤(열쇠 · Claude Code 잇기까지) <살림 자리>/up.json 에 주소를 적고 끌 때 지운다.
// 화면은 한 번용 번호로만 열리므로, 번호는 도는 kmd 에게 이 PC 의 열쇠(자격 저장소의 기기 열쇠)로 받는다.
const upFileOf = (root, o) => path.join(o.data ? path.resolve(o.data) : defaultDataDir(root), 'up.json')
const readUp = (root, o) => { try { return JSON.parse(fs.readFileSync(upFileOf(root, o), 'utf8')) } catch { return null } }
const runCode = (cmd, args) => new Promise((ok) => spawn(cmd, args, { stdio: 'ignore', windowsHide: true }).on('exit', (c) => ok(c)).on('error', () => ok(1)))
const runOut = (cmd, args) => new Promise((ok) => { let out = ''; const p = spawn(cmd, args, { windowsHide: true }); p.stdout.on('data', (d) => (out += d)); p.on('exit', (c) => ok(c === 0 ? out : null)); p.on('error', () => ok(null)) })
const sameDir = (a, b) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b))
// 살아 있나 — 'up'(이 PC 의 kmd 가 답한다) · 'busy'(받았는데 답이 늦다 — 넣기 · 정리로 바쁜 kmd) · null(꺼짐 · 다른 프로그램).
// 가벼운 /healthz?live=1 로 묻는다(멈춤 줄을 재지 않는다)
async function pcAlive(url, ms = 10_000) {
  try {
    const r = await fetch(url + '/healthz?live=1', { signal: AbortSignal.timeout(ms) })
    const j = await r.json()
    return r.ok && j.ok && j.mode === 'pc' ? 'up' : null
  } catch (e) {
    return e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'busy' : null
  }
}
// 그 주소의 kmd 가 이 OS 사용자의 · 이 폴더의 kmd 인가 — 이 PC 의 열쇠로 물어 지식 폴더를 견준다(남의 kmd 를 열지 않게)
async function pcRootOf(url) {
  const key = await kget(keyName(url)).catch(() => null)
  if (!key) return null
  try {
    const r = await fetch(url + '/api/me', { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(10_000) })
    const j = await r.json()
    return r.ok && j.mode === 'pc' && j.root ? j.root : null
  } catch {
    return null
  }
}
// 도는 이 폴더의 kmd 주소 — up.json 이 먼저(바빠도 이 폴더의 것) · 없으면(옛 판) --port 또는 7373 의 kmd 가 이 폴더의 것일 때
async function runningPc(root, o, { fresh = false } = {}) {
  const up = readUp(root, o)
  if (up?.url) {
    const st = await pcAlive(up.url)
    if (st === 'busy') return up.url
    if (st === 'up' && sameDir((await pcRootOf(up.url)) || root, root)) return up.url
  }
  if (fresh) return null
  const u = `http://127.0.0.1:${o.port || 7373}`
  if (u !== up?.url && (await pcAlive(u)) === 'up') {
    const r = await pcRootOf(u)
    if (r && sameDir(r, root)) return u
  }
  return null
}
async function waitPc(root, o, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const u = await runningPc(root, o, { fresh: true })
    if (u) return u
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}
async function pcCall(url, p) {
  const key = await kget(keyName(url)).catch(() => null)
  if (!key) throw Object.assign(new Error('이 PC 의 열쇠가 없다. kmd up 으로 한 번 켠다'), { status: 0 })
  const r = await fetch(url + p, { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15_000) })
  const j = await r.json().catch(() => ({}))
  // 404 — 도는 kmd 가 이 길이 없는 앞 판이다(이 판 전에 깐 kmd)
  if (r.status === 404) throw Object.assign(new Error('도는 kmd 가 앞 판이다. 로그아웃했다 들어오면(늘 켜기) 새 판으로 켜지고 그 뒤 kmd open 이 된다'), { status: 404 })
  if (!r.ok) throw Object.assign(new Error(j.message || `HTTP ${r.status}`), { status: r.status })
  return j
}
async function openPc(url) {
  const { code } = await pcCall(url, '/api/pc/once')
  openBrowser(`${url}/#once=${code}`)
}
// 꺼져 있으면 켠다 — 기본 폴더면 늘 켜기 작업으로(한 벌만 돈다) · 아니면 이 판을 따로 띄운다
async function startPc(root, o, { node = process.execPath, script = process.argv[1] } = {}) {
  const plain = !o.port && !o.data && sameDir(root, defaultPcRoot())
  if (process.platform === 'win32' && plain && !process.env.KMD_NO_TASK && (await runCode('schtasks', ['/Run', '/TN', 'kmd'])) === 0) return
  const args = [script, 'up', root, '--no-open', ...(o.port ? ['--port', String(o.port)] : []), ...(o.data ? ['--data', path.resolve(o.data)] : []), ...(o.worker === 'false' ? ['--no-worker'] : [])]
  spawn(node, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}
// 지식 폴더 바꾸기(도는 kmd 안에서) — 표에 적고 · 늘 켜기 작업 · 시작 메뉴를 새 폴더로 · 꺼진 뒤 새 폴더로 켤 도우미를 띄운다
async function switchRoot(next, o) {
  writePcRoot(next)
  if (process.platform === 'win32' && !process.env.KMD_NO_TASK && (await runCode('schtasks', ['/Query', '/TN', 'kmd'])) === 0) {
    await makeTask(next)
    await makeShortcut(shortcutFor(next)).catch(() => {})
  }
  spawn(process.execPath, [process.argv[1], 'pc', 'switch', next, '--pid', String(process.pid), ...(o.port ? ['--port', String(o.port)] : [])], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}
// 멈추기 — 이 PC 의 열쇠로 · 앞 판(길 없음)이면 늘 켜기 작업을 끝낸다 · 꺼질 때까지 기다린다
async function stopPc(url) {
  const e = await pcCall(url, '/api/pc/stop').then(() => null, (er) => er)
  if (e && e.status === 404 && process.platform === 'win32' && !process.env.KMD_NO_TASK) await runCode('schtasks', ['/End', '/TN', 'kmd'])
  for (let i = 0; i < 40; i++) {
    if (!(await pcAlive(url, 2000))) return null
    await new Promise((r) => setTimeout(r, 500))
  }
  return e ? e.message : '도는 kmd 가 멈추지 않는다'
}
// 다시 켜기 — 멈추고 같은 포트로(기본 7373 이면 늘 켜기 작업으로) 켜고, 새 up.json 이 설 때까지
async function restartPc(root, o, url, { node, script } = {}) {
  const oldPid = readUp(root, o)?.pid
  const why = await stopPc(url)
  if (why) return { ok: false, why: `도는 kmd 를 멈추지 못했다: ${why}` }
  const port = Number(new URL(url).port)
  await startPc(root, port === 7373 ? o : { ...o, port }, { node, script })
  for (let i = 0; i < 90; i++) {
    const up = readUp(root, o)
    if (up && up.pid !== oldPid && (await pcAlive(up.url)) === 'up') return { ok: true, up }
    await new Promise((r) => setTimeout(r, 500))
  }
  return { ok: false, why: '다시 켜지 않았다. kmd open 으로 켠다' }
}
// 지금 이 PC 의 kmd 가 쓰는 지식 폴더 — --root · 늘 켜기 작업의 인자 · 도는 kmd 에게 묻기 · 기본 폴더 순
async function pcRootNow(o) {
  if (o.root) return path.resolve(o.root)
  if (process.platform === 'win32' && !process.env.KMD_NO_TASK) {
    const xml = await runOut('schtasks', ['/Query', '/TN', 'kmd', '/XML'])
    const m = xml && xml.match(/<Arguments>[^<]*?up &quot;(.+?)&quot;/)
    if (m) return m[1]
  }
  const u = `http://127.0.0.1:${o.port || 7373}`
  if ((await pcAlive(u)) === 'up') {
    const r = await pcRootOf(u)
    if (r) return r
  }
  return defaultPcRoot()
}
// 이 PC 가 이은 팀(설치 한 줄로 · 이 PC 의 열쇠가 있는 것)의 마지막 주소 — 없으면 null
async function connectedTeam(root, o) {
  const tf = path.join(o.data ? path.resolve(o.data) : defaultDataDir(root), 'teams.json')
  const teams = (() => { try { return JSON.parse(fs.readFileSync(tf, 'utf8')) } catch { return [] } })().map(safeOrigin).filter(Boolean)
  let team = null
  for (const t of teams) if (await kget(keyName(t)).catch(() => null)) team = t
  return team
}
// 에이전트 설치 · 개인 지식 — `kmd agent add <개인 지식>`(지금 폴더 · --dir 로 다른 폴더). 팀 화면 › 에이전트 설치가 복사해 주는 명령.
//   이 PC 의 지식 폴더의 그 지식을 작업 폴더의 Claude Code 에 더한다(붙어 있던 지식 · 기본은 그대로) · 연결은 이 PC 의 kmd
async function agentCmd(o) {
  const [sub, kn] = o._
  try {
    if (sub !== 'add' || !kn) throw new Error('kmd agent add <개인 지식> [--dir 작업 폴더]')
    const root = await pcRootNow(o)
    const pcData = o.data ? path.resolve(o.data) : defaultDataDir(root)
    const hub = await makeHub({ root, dataDir: pcData, mode: 'pc', log: () => {} })
    const k = (await hub.list()).find((x) => x.id === kn || x.name === kn)
    hub.stop()
    if (!k) throw new Error(`이 PC 의 지식 폴더(${root})에 「${kn}」 개인 지식이 없다`)
    const dir = path.resolve(o.dir || process.cwd())
    const pcUrl = (await runningPc(root, o)) || `http://127.0.0.1:${o.port || 7373}`
    const list = await kitFolders(pcData)
    const same = (f) => path.resolve(f.path).toLowerCase() === dir.toLowerCase()
    const cur = list.find(same)
    const row = kitAddKn(cur || { name: path.basename(dir), path: dir, at: new Date().toISOString(), kns: [], def: null }, { area: 'me', kn: k.id, knName: k.name })
    const teamUrl = await connectedTeam(root, o)
    const r = await kitInstall(dir, { pcUrl, teamUrl, kns: row.kns, def: row.def })
    await kitSetFolders(pcData, cur ? list.map((f) => (f === cur ? { ...row, path: r.dir } : f)) : [...list, { ...row, path: r.dir }])
    console.log(`✓ ${r.dir} 에 개인 지식 「${k.name}」 을 더했다 · 붙은 지식 ${row.kns.length} · 기본 「${kitDefOf(row)?.knName || k.name}」 · Claude Code 는 새로 여는 것부터`)
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}
// 시작 메뉴의 kmd — 내 PC 쪽을 켜 두고(꺼져 있으면 켠다) 팀 화면을 연다(팀이 없으면 · --pc 면 이 PC 의 화면)
async function openCmd(o) {
  const root = path.resolve(o._[0] || o.root || defaultPcRoot())
  let url = await runningPc(root, o)
  if (!url) {
    console.log('이 PC 의 kmd 가 꺼져 있다. 켠다')
    await startPc(root, o)
    url = await waitPc(root, o, 60_000)
    if (!url) {
      console.error('kmd 가 켜지지 않았다. 터미널에서 kmd up 으로 켜 보면 까닭이 보인다')
      process.exitCode = 1
      return
    }
  }
  const team = o.pc ? null : await connectedTeam(root, o)
  if (team) {
    openBrowser(team)
    console.log(`✓ 팀 화면을 열었다: ${team} · 개인 지식은 내 PC 쪽(${url})이 연다`)
    return
  }
  try {
    await openPc(url)
    console.log(`✓ 이 PC 의 kmd 화면을 열었다: ${url}`)
  } catch (e) {
    console.error(`화면을 열지 못했다: ${e.message}`)
    process.exitCode = 1
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return void process.stdout.write(HELP)
  if (cmd === '--version' || cmd === '-v') return void console.log(VERSION)
  if (cmd === 'backup') return backupCmd(parse(rest))
  if (cmd === 'owner') return ownerCmd(parse(rest))
  if (cmd === 'user') return userCmd(parse(rest))
  if (cmd === 'machine') return machineCmd(parse(rest))
  if (cmd === 'secret') return secretCmd(parse(rest))
  if (cmd === 'connect') return connectCmd(parse(rest))
  if (cmd === 'search-check') return searchCheckCmd(parse(rest))
  if (cmd === 'worker') return workerCmd(parse(rest))
  if (cmd === 'restore') return restoreCmd(parse(rest))
  if (cmd === 'auth') return authCmd(parse(rest))
  if (cmd === 'pc') return pcCmd(parse(rest))
  if (cmd === 'open') return openCmd(parse(rest))
  if (cmd === 'agent') return agentCmd(parse(rest))
  if (cmd !== 'serve' && cmd !== 'up') {
    console.error(`모르는 명령: ${cmd}\n`)
    process.stdout.write(HELP)
    process.exit(2)
  }
  const o = parse(rest)
  const pc = cmd === 'up'
  const root = path.resolve(o._[0] || o.root || (pc ? defaultPcRoot() : '.'))
  if (pc) fs.mkdirSync(root, { recursive: true })
  if (!fs.existsSync(root)) {
    console.error(`폴더가 없다: ${root}`)
    process.exit(2)
  }
  const port = o.port != null ? Number(o.port) : 7373
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`포트는 0 ~ 65535 의 수다: ${o.port}`)
    process.exit(2)
  }
  const user = String(o.user || os.userInfo().username)
  // 이 PC 의 사람 이름 — 팀 서버는 쓰지 않는다(들어오는 사람은 명부에서 · 서비스는 OS 사용자 kmd 로 돈다)
  if (pc && isReservedUser(user)) {
    console.error(`「${user}」 는 kmd 가 쓰는 이름이다. --user 로 다른 이름을 준다`)
    process.exit(2)
  }
  let s
  let stop = () => process.exit(0)
  try {
    s = await startServer({ root, data: o.data ? path.resolve(o.data) : null, mode: pc ? 'pc' : 'team', user, host: o.host || '127.0.0.1', port, onStop: pc ? () => stop() : null, onRoot: pc ? (next) => switchRoot(next, { ...o, port: o.port }).then(() => stop()) : null })
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      // 이 PC 의 kmd 가 이미 그 포트에서 돈다(늘 켜기 작업 · 앞서 켠 창) — 하나 더 켜지 않고 그 화면을 연다.
      // 이 OS 사용자의 · 이 폴더의 kmd 일 때만(이 PC 의 열쇠로 물어 지식 폴더를 견준다) · 바쁘면 그것으로 본다
      const url = `http://127.0.0.1:${port}`
      const st = pc ? await pcAlive(url) : null
      const theirs = st === 'up' ? await pcRootOf(url) : null
      if (st === 'up' && theirs && !sameDir(theirs, root)) {
        console.error(`포트 ${port} 에서 다른 폴더의 kmd 가 돈다(${theirs}): 그 kmd 를 쓰거나 --port 로 다른 수를 준다`)
        process.exit(1)
      }
      if (st === 'busy' || (st === 'up' && theirs)) {
        console.log(`이 PC 의 kmd 가 이미 켜져 있다: ${url}`)
        if (o.open !== false) {
          try {
            await openPc(url)
            console.log('✓ 화면을 열었다')
          } catch (er) {
            console.error(`화면을 열지 못했다: ${er.message}`)
          }
        }
        process.exit(0)
      }
      console.error(`포트 ${port} 를 이미 다른 프로그램이 쓴다. --port 로 다른 수를 준다`)
    } else console.error(e.message)
    process.exit(1)
  }
  const ks = await s.store.list()
  console.log(`kmd ${VERSION}: ${pc ? '이 PC' : '팀 서버'} · ${s.url}`)
  console.log(`지식 ${ks.length}: ${root}${ks.length ? ' · ' + ks.map((k) => k.name).join(' · ') : ''}`)
  if (!pc) {
    const code = await s.auth.setupCode()
    if (code) console.log(`첫 관리자: 이 주소를 브라우저로 연다(24시간 · 한 번): ${s.url}/setup#code=${code}`)
  } else {
    // 이 PC 의 Claude Code 가 쓸 열쇠 — 자격 저장소에 없거나 끊겼으면 새로
    const name = keyName(s.url)
    let key = await kget(name).catch(() => null)
    if (!key || !s.auth.bearer(key)) {
      key = await s.auth.deviceKeyFor(s.pcUser, { host: os.hostname(), osuser: os.userInfo().username })
      await kput(name, key).catch((e) => console.error(e.message))
    }
    const c = await addMcp('kmd', s.url)
    console.log(c.ok ? '✓ Claude Code 에 이었다. 이 PC 의 kmd(kmd)' : `Claude Code 에 잇기(한 번): ${c.line}`)
    // 이 PC 의 정리 일꾼 — 내 Claude 로그인으로(자식 프로세스 · 서버 프로세스는 Claude 를 부르지 않는다)
    if (o.worker !== 'false') {
      let wk = await kget('worker:' + s.url).catch(() => null)
      if (!wk || !s.auth.bearer(wk)) {
        wk = (await s.auth.workerAdd()).key
        await kput('worker:' + s.url, wk).catch(() => {})
      }
      const child = spawn(process.execPath, [process.argv[1], 'worker', s.url], { stdio: 'inherit', windowsHide: true, env: { ...process.env, KMD_WORKER_KEY: wk } })
      process.on('exit', () => child.kill())
    }
    // 다 켜졌다 — `kmd open` · 시작 메뉴가 이 주소로 번호를 받는다(열쇠는 위에서 자격 저장소에 넣었다)
    const upFile = upFileOf(root, o)
    fs.writeFileSync(upFile, JSON.stringify({ url: s.url, pid: process.pid, root, ver: VERSION, at: new Date().toISOString() }, null, 1))
    process.on('exit', () => { try { if (JSON.parse(fs.readFileSync(upFile, 'utf8')).pid === process.pid) fs.rmSync(upFile) } catch {} })
    if (o.open !== false) openBrowser(`${s.url}/#once=${s.auth.once(s.pcUser)}`)
    // 다시 여는 길 — 설치 한 줄로 깐 PC 는 시작 메뉴 · PATH 의 kmd, 손으로 푼 꾸러미 · 저장소는 부른 그대로
    const pkgCmd = path.resolve(path.dirname(process.argv[1]), '..', '..', 'kmd.cmd')
    const again = appHomeOf() ? '시작 메뉴의 kmd(또는 kmd open)' : fs.existsSync(pkgCmd) ? `"${pkgCmd}" open` : `node "${process.argv[1]}" open`
    console.log(`화면은 ${again} 로 다시 연다. 끄기 Ctrl C`)
  }
  stop = () => s.close().then(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

// 백업 — 서버를 띄우지 않고 지식 폴더 · 살림 자리에 바로 한다(서버가 돌고 있으면 다시 띄울 때 붙는다)
async function backupCmd(o) {
  const root = path.resolve(o.root || (fs.existsSync(defaultPcRoot()) ? defaultPcRoot() : '.'))
  const pc = !o.team && (o.pc !== undefined || path.resolve(root) === path.resolve(defaultPcRoot()))
  const hub = await makeHub({ root, dataDir: o.data ? path.resolve(o.data) : defaultDataDir(root), mode: pc ? 'pc' : 'team', log: (...a) => console.log(...a) })
  const [sub, id, url] = o._
  try {
    if (sub === 'add') {
      if (!id || !url) throw new Error('kmd backup add <지식> <주소>')
      const r = await hub.backupAttach(SHELL, id, url)
      console.log(r.ok ? `붙였다: ${id} → ${r.backup.url} · 지금까지 보냈다` : `붙였다: ${id} · 아직 못 보냈다(다시 보내기를 건다)`)
    } else if (sub === 'pull') {
      if (!id) throw new Error('kmd backup pull <지식>')
      const r = await hub.backupPull(SHELL, id)
      console.log(r.pulled ? `받았다: ${r.pulled}개 · 이제 다시 저장된다` : '받을 것이 없다')
    } else {
      await hub.start()
      for (const k of await hub.list()) {
        try {
          const st = await hub.backupState(SHELL, k.id)
          if (!st) { console.log(`${k.name}: 백업 자리 없음`); continue }
          await enqueue(k)
          const lines = await hub.stops({ ...SHELL, admin: true }, k.id).catch(() => [])
          console.log(`${k.name}: ${st.url} · ${lines.length ? lines.map((l) => l.text).join(' / ') : '잘 보내고 있다'}`)
        } catch (e) {
          console.log(`${k.name}: 보지 못했다(${e.message})`)
        }
      }
    }
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  } finally {
    hub.stop()
  }
}

// 주인 · 개인 · 정리하는 사람 — 셸(서버를 띄운 사람)이 바로 정한다
async function ownerCmd(o) {
  const root = path.resolve(o.root || (fs.existsSync(defaultPcRoot()) ? defaultPcRoot() : '.'))
  const [id, who] = o._
  try {
    if (!id) throw new Error('kmd owner <지식> [사람] [--curators 가,나]')
    const hub = await makeHub({ root, dataDir: o.data ? path.resolve(o.data) : defaultDataDir(root), log: () => {} })
    const row = await hub.setOwner(SHELL, id, { owner: who || undefined, curators: o.curators ? String(o.curators).split(',').map((x) => x.trim()).filter(Boolean) : undefined })
    console.log(`${id}: 주인 ${row.owner || '없음'} · 정리 ${row.curators.join(', ') || '없음'}: 도는 서버에도 곧 보인다`)
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

const rootOf = (o) => path.resolve(o.root || (fs.existsSync(defaultPcRoot()) ? defaultPcRoot() : '.'))
const dataOf = (o) => (o.data ? path.resolve(o.data) : defaultDataDir(rootOf(o)))

// 사람 — 더하기 · 다시 정하기(마지막 관리자가 잊었을 때도) · 목록. 링크를 그 사람에게 건넨다
async function userCmd(o) {
  const [sub, id] = o._
  try {
    const auth = await makeAuth({ dataDir: dataOf(o) })
    const base = o.url || 'http://<팀 서버>'
    if (sub === 'add') {
      const r = await auth.addUser({ id, admin: o.admin !== undefined })
      console.log(`더했다: ${r.id} · 처음 들어오기 링크(24시간 · 한 번): ${base}/first#code=${r.code}`)
    } else if (sub === 'reset') {
      const r = await auth.reset(id, { by: '셸' })
      console.log(`다시 정하게 했다: ${r.id} · 새 링크(24시간 · 한 번): ${base}/first#code=${r.code} · 기기 열쇠는 그대로 · PC 일꾼 열쇠는 걷었다`)
    } else if (sub === 'off') {
      if (!id) throw new Error('kmd user off <아이디> [--to 받을 사람]')
      if (o.to && !auth.people().includes(String(o.to))) throw new Error(`그런 사람은 없다: ${o.to}`)
      const r = await auth.off(id, { by: '셸' })
      if (r.already) { console.log(`${id}: 이미 떠났다`); return }
      const hub = await makeHub({ root: rootOf(o), dataDir: dataOf(o), log: () => {} })
      const k = await hub.handOver(id, { to: o.to ? String(o.to) : null })
      console.log(`떠났다: ${id} · 끊은 기기 ${r.devices} · PC 일꾼 ${r.workers} · 아이디는 남겨 두고 되쓰지 않는다`)
      console.log(`지식: 주인인 팀 지식 ${k.team} · 정리하는 지식 ${k.curate} → ${k.to ? k.to + ' 이 주인을 잇는다' : '주인 칸을 비웠다(개인 지식은 관리자만 본다. 관리 화면에서 넘기거나 지운다)'}`)
    } else {
      const all = auth.users()
      for (const u of all.filter((x) => x.kind !== 'worker')) console.log(`${u.id}: ${u.kind === 'machine' ? '기계 열쇠 · ' + u.machine.kn + ' · ' + u.machine.source : u.off ? '떠남 · ' + String(u.off.at).slice(0, 10) : (u.admin ? '관리자' : '사람') + (u.password ? '' : ' · 비밀번호 안 정함') + ` · 기기 ${u.devices}` + (all.some((w) => w.owner === u.id) ? ` · PC 일꾼 ${all.filter((w) => w.owner === u.id).length}` : '')}`)
      const team = all.filter((x) => x.kind === 'worker' && !x.owner)
      if (team.length) console.log(`정리 일꾼 열쇠(팀): ${team.map((x) => x.id).join(' · ')}`)
    }
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

// 기계 열쇠 — 바깥 생성기 · 원천 실행기용. 열쇠는 이때 한 번만 보인다
async function machineCmd(o) {
  const [sub, kn, source] = o._
  try {
    const auth = await makeAuth({ dataDir: dataOf(o) })
    if (sub === 'add') {
      const r = await auth.machineAdd({ kn, source, types: o.types ? String(o.types).split(',') : [] })
      console.log(`기계 열쇠: ${r.id} · ${kn} · ${source} · 1년
${r.key}
(지금 한 번만 보인다. 그 생성기의 비밀 칸에 붙인다)`)
    } else if (sub === 'revoke') {
      await auth.machineRevoke(kn)
      console.log(`끊었다: ${kn}`)
    } else throw new Error('kmd machine add <지식> <원천 이름> [--types 종류,종류] · kmd machine revoke <machine-…>')
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

// 숨김 입력 — 화면에 찍지 않는다
function hidden(prompt) {
  return new Promise((resolve) => {
    process.stderr.write(prompt)
    const stdin = process.stdin
    let buf = ''
    if (!stdin.isTTY) {
      stdin.setEncoding('utf8')
      stdin.on('data', (d) => (buf += d))
      stdin.on('end', () => resolve(buf.replace(/\r?\n$/, '')))
      return
    }
    stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    const on = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false)
        stdin.off('data', on)
        stdin.pause()
        process.stderr.write('\n')
        resolve(buf)
      } else if (ch === '\u0003') process.exit(130)
      else if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1)
      else buf += ch
    }
    stdin.on('data', on)
    stdin.resume()
  })
}

// 나가는 자격 — 셸의 숨김 입력으로만(화면으로 받지 않는다)
async function secretCmd(o) {
  const [sub, name] = o._
  try {
    if (sub === 'set') {
      if (!name) throw new Error('kmd secret set <이름>')
      // --stdin — 설치 스크립트가 숨김 입력으로 받은 것을 관으로 넘긴다(인자 · 셸 기록에 남지 않게)
      const v = o.stdin != null ? fs.readFileSync(0, 'utf8').trim() : await hidden(`${name} 의 값(보이지 않는다): `)
      await setSecret(dataOf(o), name, v)
      console.log(`넣었다: ${name}`)
    } else for (const x of await listSecrets(dataOf(o))) console.log(`${x.name}: ${x.at.slice(0, 16).replace('T', ' ')} 에 넣음`)
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

// 찾기 점검 — 기록 제목으로 그 기록이 건드린 이름을 찾는다. 처음 한 번 얼리고, 그 뒤는 같은 시험지 위에서 나빠진 문항을 센다
async function searchCheckCmd(o) {
  const [id] = o._
  try {
    if (!id) throw new Error('kmd search-check <지식> [--freeze]')
    const hub = await makeHub({ root: rootOf(o), dataDir: dataOf(o), log: () => {} })
    const r = await hub.searchCheck(SHELL, id, { freeze: o.freeze !== undefined })
    console.log(`${id}: 문항 ${r.score.n} · 6개 안 ${r.score.in}% · 첫째 ${r.score.first}%${r.frozen ? ` · 얼린 시험지보다 나빠진 문항 ${r.worse.length}${r.worse.length ? ': ' + r.worse.slice(0, 5).join(' · ') : ''}` : ' · 이 시험지를 얼렸다'}`)
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

// 정리 일꾼 — `kmd worker add`(셸 · 열쇠를 한 번 보인다) · `kmd worker key set <팀 주소>`(숨김 입력 → 자격 저장소) ·
// `kmd worker <팀 주소>`(늘 돈다 · 그 OS 사용자의 Claude Code 로그인으로)
async function workerCmd(o) {
  const [sub, arg] = o._
  try {
    if (sub === 'add') {
      const auth = await makeAuth({ dataDir: dataOf(o) })
      const r = await auth.workerAdd()
      console.log(`정리 일꾼 열쇠: ${r.id}\n${r.key}\n(지금 한 번만 보인다. 정리용 OS 사용자로 「kmd worker key set <팀 주소>」 에 붙인다)`)
      return
    }
    if (sub === 'key') {
      const url = new URL(o._[2] || '').origin
      await kput('worker:' + url, (await hidden('정리 일꾼 열쇠(보이지 않는다): ')).trim())
      console.log(`넣었다: ${url} 의 정리 일꾼 열쇠`)
      return
    }
    const url = new URL(sub || '').origin
    const key = o.key || process.env.KMD_WORKER_KEY || (await kget('worker:' + url))
    if (!key) throw new Error('정리 일꾼 열쇠가 없다. kmd worker key set <팀 주소>')
    // 팀 서버의 정리 일꾼 — 설정 · 팀 › Claude 연결에서 받은 정리 전용 로그인(비밀 claude-token)을 이 프로세스에만
    //   일감마다 다시 읽는다 — 관리자가 일꾼이 도는 사이에 로그인하거나 걷어도 다시 켜지 않고 따른다
    const token = async () => {
      if (!o.data) return
      const t = await getSecret(path.resolve(o.data), 'claude-token').catch(() => null)
      if (t) process.env.CLAUDE_CODE_OAUTH_TOKEN = t
      else delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    }
    await token()
    const { runWorker } = await import('../../core/worker.js')
    runWorker({ server: url, key, poll: o.poll ? Number(o.poll) : 10_000, before: token })
    console.log(`kmd worker: ${url} 의 정리 일감을 기다린다`)
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

// 설치 한 줄 — 이 PC 에 세우고(D:\kmd · 다른 드라이브의 백업) · 팀에 잇고(설치 표 또는 아이디 · 비밀번호 한 번 → 기기 열쇠 → 자격 저장소)
// · Claude Code 에 잇고 · 늘 켠다. 묻는 것 없이 끝나고 ✓ 넷을 찍는다(목업 M1). --no-backup · --no-task 는 시험 · 손 설치용.
async function connectCmd(o) {
  const [url0] = o._
  if (!url0) {
    console.error('kmd connect <팀 주소> [--ticket kmdt_…]')
    process.exitCode = 1
    return
  }
  // 팀 주소 — 이름 · IP 와 포트만(teams.json 과 Claude Code 잇기로 가므로 그 밖의 글자는 받지 않는다)
  const url = safeOrigin(url0)
  if (!url) {
    console.error(`팀 주소가 아니다: ${url0}`)
    process.exitCode = 1
    return
  }
  // --root(팀 화면에서 쓴 내 PC 지식 폴더) — 있던 지식 폴더면 그대로 · 없거나 빈 폴더면 새로 세운다 · 다른 파일만 있으면 아무것도 하지 않고 멈춘다.
  //   고른 폴더는 이 PC 의 지식 폴더 표에 적는다(kmd up · open · 늘 켜기가 기본 폴더로 읽는다)
  let root
  if (o.root && o.root !== 'true') {
    try {
      root = pcRootKind(o.root).root
    } catch (e) {
      console.error(`내 PC 지식 폴더로 쓰지 못한다: ${o.root} · ${e.message}. 팀 화면 › 지식 목록 › 내 PC 지식 폴더에서 다른 경로로 설치 한 줄을 다시 받는다`)
      process.exitCode = 1
      return
    }
    writePcRoot(root)
  } else root = path.resolve(defaultPcRoot())
  fs.mkdirSync(root, { recursive: true })
  const pcData = o.data ? path.resolve(o.data) : path.join(root, '.kmd')
  fs.mkdirSync(pcData, { recursive: true })
  // ① 세우기 — 지식 폴더 · 다른 드라이브의 백업 자리(지식마다 저장소 하나)
  const hub = await makeHub({ root, dataDir: pcData, mode: 'pc', log: () => {} })
  const kns = await hub.list()
  let backupDir = o.backup === 'false' || process.env.KMD_NO_BACKUP ? null : pickBackupDir(root)
  if (backupDir) {
    try {
      fs.mkdirSync(backupDir, { recursive: true })
      // 이 PC 의 백업 자리로 적는다 — 뒤에 만드는 지식 · 되살린 지식도 저절로 그 아래에 붙는다
      const sj = path.join(pcData, 'serve.json')
      const cur = fs.existsSync(sj) ? JSON.parse(fs.readFileSync(sj, 'utf8')) : {}
      if (!cur.backupRoot) fs.writeFileSync(sj, JSON.stringify({ ...cur, backupRoot: backupDir }, null, 1))
      for (const k of kns) {
        if (await hub.backupState(SHELL, k.id)) continue
        const bare = path.join(backupDir, `${k.id}.git`)
        if (!fs.existsSync(bare)) await new Promise((ok) => spawn('git', ['init', '-q', '--bare', '-b', 'main', bare], { stdio: 'ignore', windowsHide: true }).on('exit', ok))
        await ensureRepo(k.dir)
        await hub.backupAttach(SHELL, k.id, bare).catch(() => {})
      }
    } catch {
      backupDir = null
    }
  }
  hub.stop()
  // ② 팀에 잇기
  let team
  let who = null
  try {
    let body = { ticket: o.ticket, host: os.hostname(), osuser: os.userInfo().username }
    if (!o.ticket) {
      const user = o.user || (await hidden('아이디: '))
      body = { ...body, ticket: undefined, user, pw: prehash(user, await hidden('비밀번호(보이지 않는다): ')) }
    }
    const r = await fetch(url + '/device/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json()
    if (!r.ok) throw new Error(j.message || '잇지 못했다')
    await kput(keyName(url), j.key)
    who = j.user
    // 이 PC 의 kmd 가 팀 주소를 미리 허락하게 적어 둔다(E8 — 팀 화면의 「내 PC」 줄)
    const tf = path.join(pcData, 'teams.json')
    const teams = fs.existsSync(tf) ? JSON.parse(fs.readFileSync(tf, 'utf8')) : []
    if (!teams.includes(url)) fs.writeFileSync(tf, JSON.stringify([...teams, url], null, 1))
    team = { ok: true, host: new URL(url).host }
  } catch (e) {
    team = { ok: false, why: e.message }
    process.exitCode = 1
  }
  // ③ Claude Code — 팀(kmd-team) · 이 PC(kmd 는 늘 켜기가 kmd up 으로 열 때 잇는다)
  //   --kn(에이전트 설치 · 팀): 설치 한 줄을 붙여 넣은 작업 폴더만 그 팀 지식에 붙인다(연결 kmd-team 하나 · 기본 지식 한 줄)
  let c
  if (team.ok && o.kn && o.kn !== 'true') {
    try {
      const key = await kget(keyName(url))
      const ks = await fetch(url + '/api/knowledge', { headers: { authorization: `Bearer ${key}` } }).then((r) => (r.ok ? r.json() : []), () => [])
      const k = ks.find((x) => x.id === o.kn)
      if (!k) throw new Error(`팀에 「${o.kn}」 팀 지식이 없다`)
      const dir = path.resolve(o.dir || process.cwd())
      // 더하기 — 이 폴더에 붙어 있던 지식(개인 지식도)은 그대로 · 기본도 그대로(처음이면 이것)
      const list = await kitFolders(pcData)
      const same = (f) => path.resolve(f.path).toLowerCase() === dir.toLowerCase()
      const cur = list.find(same)
      const row = kitAddKn(cur || { name: path.basename(dir), path: dir, at: new Date().toISOString(), kns: [], def: null }, { area: 'team', kn: k.id, knName: k.name, team: url })
      // 개인 지식의 연결(kmd)은 .mcp.json 에 있던 것을 그대로 둔다
      const r = await kitInstall(dir, { teamUrl: url, kns: row.kns, def: row.def })
      await kitSetFolders(pcData, cur ? list.map((f) => (f === cur ? { ...row, path: r.dir } : f)) : [...list, { ...row, path: r.dir }])
      c = { ok: true, folder: r.dir, kn: k.name, def: kitDefOf(row)?.knName, n: row.kns.length }
    } catch (e) {
      c = { ok: false, line: `${e.message}. 팀 화면 › 설정 › 에이전트 설치에서 설치 한 줄을 다시 복사한다` }
    }
  } else c = team.ok ? await addMcp('kmd-team', url) : { ok: false, line: mcpLine('kmd-team', url) }
  // ④ 늘 켜기 — 로그온 작업 + 시작 메뉴의 kmd + 지금 한 번 켜고 화면을 연다
  let task = { ok: false, why: '이 PC 에서 kmd up 으로 켠다' }
  let screen = null
  if (o.task !== 'false' && process.platform === 'win32' && !process.env.KMD_NO_TASK) {
    // 늘 켜기 작업이 지금 여는 폴더 — 작업을 새 폴더로 바꾸기 전에 읽는다
    const prev = await pcRootNow({})
    if ((await makeTask(root)) === 0) {
      task = { ok: true, shortcut: (await makeShortcut(shortcutFor(root))).ok }
      // 켜지면(열쇠 · Claude Code 잇기까지) 팀 화면을 연다 — 팀 화면이 개인 지식 · 내 Claude 까지 다룬다(내 PC 쪽은 뒤에서 돈다) ·
      //   팀에 잇지 못했으면 이 PC 의 화면 · 다음부터는 시작 메뉴의 kmd
      let url = await runningPc(root, { ...o, data: pcData })
      // 다른 폴더(--root 전의 폴더)로 도는 kmd 가 있으면 멈춘다 — 늘 켜기 작업이 돌고 있으면 /Run 이 무시되어 옛 폴더가 그대로 열린다
      if (!url && !sameDir(prev, root)) {
        const old = await runningPc(prev, {})
        if (old) await stopPc(old)
      }
      if (!url) {
        await runCode('schtasks', ['/Run', '/TN', 'kmd'])
        url = await waitPc(root, { ...o, data: pcData }, 45_000)
      }
      screen = !url ? { ok: false, why: '아직 켜지는 중이다' } : team.ok ? (openBrowser(url0 && safeOrigin(url0)), { ok: true, team: true }) : await openPc(url).then(() => ({ ok: true }), (e) => ({ ok: false, why: e.message }))
    } else task = { ok: false, why: '작업을 만들지 못했다. kmd pc task 로 다시' }
  }
  for (const l of installLines({ version: VERSION, root, backup: backupDir, kns: kns.map((k) => k.name), team, user: who, host: os.hostname(), osuser: os.userInfo().username, claude: c, task, screen })) console.log(l)
}

// 늘 켜기 작업 — 판 자리에서 돌면 실행기를(판을 바꿔도 그대로) · 아니면 이 node 와 kmd.mjs 를
async function makeTask(root) {
  const h = appHomeOf()
  const f = path.join(os.tmpdir(), 'kmd-task.xml')
  fs.writeFileSync(f, '\ufeff' + taskXml({ script: process.argv[1], root, launcher: h ? launcherOf(h.home) : null }), 'utf16le')
  return runCode('schtasks', ['/Create', '/F', '/TN', 'kmd', '/XML', f])
}
// 시작 메뉴의 kmd — `kmd open`(기본 폴더가 아니면 그 폴더를 준다)
function shortcutFor(root) {
  const h = appHomeOf()
  const where = path.resolve(root) === path.resolve(defaultPcRoot()) ? '' : ` "${root}"`
  return h ? { target: launcherOf(h.home), args: 'open' + where } : { target: process.execPath, args: `"${process.argv[1]}" open${where}` }
}

// 되살리기 — 백업 자리에서 새 폴더로(새 PC 의 「이 PC 로 되살리기」 · 지식 받아 오기)
async function restoreCmd(o) {
  const [url, name] = o._
  const root = path.resolve(o.root || (fs.existsSync(defaultPcRoot()) ? defaultPcRoot() : '.'))
  fs.mkdirSync(root, { recursive: true })
  const hub = await makeHub({ root, dataDir: o.data ? path.resolve(o.data) : defaultDataDir(root), mode: o.team ? 'team' : 'pc', log: (...a) => console.log(...a) })
  try {
    if (!url) throw new Error('kmd restore <백업 주소> [이름] [--root 폴더] [--practice | --attach]')
    const r = await hub.restore(SHELL, { url, name, attach: o.practice !== undefined ? false : o.attach !== undefined ? true : null })
    console.log(r.attached ? `· 같은 백업 자리로 이어 보낸다` : `· 읽기만 사본: 원래 백업 자리에는 보내지 않는다(연습 · 다른 이름 · 같은 자리를 다른 지식이 쓴다 · 붙이려면 --attach)`)
    console.log(`되살렸다: ${r.id} · 문서 ${r.docs} · 기록 ${r.records} · 첨부 ${r.atts} · 이름 장부 ${r.vocab ? '있음' : '없음'} · ${r.owner ? `주인 ${r.owner}` : '주인 없음(_members.md 없음)'}: 도는 서버에는 관리자의 [동기화] 로 목록에 선다(개인 지식은 그 전에도 가려져 있다)`)
    if (r.check) console.log('· 옛 백업이라 정리 설정이 없어 「손으로만 · Claude 에 보내지 않음」 으로 두었다. 이 지식의 사람에서 다시 정한다')
    if (r.errors.length) console.log(`검사 줄 ${r.errors.length}: ${r.errors.slice(0, 3).join(' · ')}`)
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  } finally {
    hub.stop()
  }
}

// 명부 다시 적용 — 옛 auth.json 으로 되살린 뒤 더 늦은 auth.log 를 준다
async function authCmd(o) {
  const [sub, file] = o._
  try {
    if (sub !== 'reapply' || !file) throw new Error('kmd auth reapply <auth.log> [--root 폴더 | --data 폴더]')
    const root = path.resolve(o.root || '.')
    const auth = await makeAuth({ dataDir: o.data ? path.resolve(o.data) : defaultDataDir(root) })
    const r = await auth.reapply(fs.readFileSync(file, 'utf8'))
    console.log(`다시 적용했다. 일 ${r.to - r.from} · 끊은 기기 ${r.revoked} · 모두 내보냄 ${r.sv} · 기계 열쇠 끊음 ${r.machines}`)
    if (r.reset.length) console.log(`비밀번호를 다시 정한다(관리자가 링크를 새로): ${r.reset.join(' · ')}`)
    if (r.devices.length) console.log(`다시 이을 기기: ${r.devices.join(' · ')}`)
    if (r.missing.length) console.log(`다시 만들 사람: ${r.missing.join(' · ')}`)
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

// 이 PC — 늘 켜기(작업 스케줄러) · 새 판 올리기(healthz 뒤 바꾸고 안 되면 앞 판 그대로)
async function pcCmd(o) {
  const [sub, a, b] = o._
  try {
    if (sub === 'task') {
      const root = path.resolve(a || o.root || defaultPcRoot())
      const h = appHomeOf()
      if (process.platform !== 'win32' || o.print) return void console.log(taskXml({ script: process.argv[1], root, launcher: h ? launcherOf(h.home) : null }))
      const c = await makeTask(root)
      if (c !== 0) { console.log('작업을 만들지 못했다'); process.exitCode = c || 1; return }
      const sc = await makeShortcut(shortcutFor(root))
      console.log(`✓ 로그온 때 켜고 멈추면 1분마다 다시 켠다. 작업 이름 kmd${sc.ok ? ' · 시작 메뉴에 kmd(화면 열기)' : ' · 시작 메뉴 바로가기는 만들지 못했다'}`)
    } else if (sub === 'link') {
      // 처음 설치 — 실행기가 아직 없으니 판 자리 모양만 본다
      const h = appHomeOf(process.argv[1], { shape: true })
      if (!h) throw new Error('판 자리(~/.kmd-app/versions/<판>)의 kmd 로 부른다. 설치 한 줄이 부른다')
      const r = await linkVersion(h.home, a || h.ver)
      console.log(`✓ 지금 판 ${r.ver}: 실행기 ${r.bin}`)
    } else if (sub === 'switch') {
      // 지식 폴더 바꾸기 — 앞 kmd(--pid)가 꺼지기를 기다렸다가 새 폴더로 켠다(팀 화면 › 설정 · 개인 › 지식 폴더가 띄운다)
      const root = path.resolve(a || defaultPcRoot())
      const pid = Number(o.pid) || 0
      for (let i = 0; pid && i < 60; i++) {
        try { process.kill(pid, 0) } catch { break }
        await new Promise((r) => setTimeout(r, 500))
      }
      await startPc(root, o)
      const u = await waitPc(root, o, 60_000)
      console.log(u ? `✓ 지식 폴더 ${root} 로 켰다: ${u}` : `${root} 로 켜지 않았다. kmd up "${root}" 로 켜 보면 까닭이 보인다`)
      if (!u) process.exitCode = 1
    } else if (sub === 'restart') {
      const root = await pcRootNow(o)
      const url = await runningPc(root, o)
      if (!url) {
        await startPc(root, o)
        const u = await waitPc(root, o, 60_000)
        console.log(u ? `✓ 켰다: ${u}` : 'kmd 가 켜지지 않았다. 터미널에서 kmd up 으로 켜 보면 까닭이 보인다')
        if (!u) process.exitCode = 1
        return
      }
      const r = await restartPc(root, o, url)
      console.log(r.ok ? `✓ 다시 켰다. 판 ${r.up.ver} · ${r.up.url}` : `· ${r.why}`)
      if (!r.ok) process.exitCode = 1
    } else if (sub === 'update') {
      if (!a || !b) throw new Error('kmd pc update <새 판 폴더> <판> [--root 지식 폴더] [--home 판 자리]')
      const home = path.resolve(o.home || appHomeOf()?.home || path.join(os.homedir(), '.kmd-app'))
      // 지금 이 PC 의 kmd 가 쓰는 폴더 — 다른 폴더를 켜던 PC 를 기본 폴더로 바꿔 놓지 않게
      const root = await pcRootNow(o)
      const r = await upgrade({ home, from: path.resolve(a), ver: b })
      if (!r.ok) {
        console.log(`새 판 ${r.tried} 이 켜지지 않았다. 그대로 ${r.ver || '앞 판'} 을 쓴다`)
        process.exitCode = 1
        return
      }
      console.log(`✓ 새 판 ${r.ver} 이 켜지는 것을 보고 지금 판으로 했다. 실행기 ${r.bin}${r.prev ? ` · 앞 판 ${r.prev} 폴더는 그대로 둔다` : ''}`)
      // 늘 켜기 작업 · 시작 메뉴 · Claude Code 헤더 도우미를 실행기로(옛 설치는 판 폴더를 가리킨다) — 폴더는 그대로
      const kmdL = launcherOf(home)
      const where = sameDir(root, defaultPcRoot()) ? '' : ` "${root}"`
      if (process.platform === 'win32' && !process.env.KMD_NO_TASK && (await runCode('schtasks', ['/Query', '/TN', 'kmd'])) === 0) {
        const f = path.join(os.tmpdir(), 'kmd-task.xml')
        fs.writeFileSync(f, '\ufeff' + taskXml({ root, launcher: kmdL }), 'utf16le')
        await runCode('schtasks', ['/Create', '/F', '/TN', 'kmd', '/XML', f])
        await makeShortcut({ target: kmdL, args: 'open' + where })
      }
      const helper = `"${launcherOf(home, 'kmd-key')}"`
      const url = await runningPc(root, o)
      // kmd-team 은 하나 — 이 PC 의 열쇠가 있는 팀(설치 한 줄로 이은 팀)의 마지막 것만 · [허락] 으로만 더해진 주소는 걸지 않는다
      const tf = path.join(o.data ? path.resolve(o.data) : defaultDataDir(root), 'teams.json')
      const teams = (() => { try { return JSON.parse(fs.readFileSync(tf, 'utf8')) } catch { return [] } })().map(safeOrigin).filter(Boolean)
      let team = null
      for (const t of teams) if (await kget(keyName(t)).catch(() => null)) team = t
      for (const [name, u] of [['kmd', url || `http://127.0.0.1:${o.port || 7373}`], ...(team ? [['kmd-team', team]] : [])]) {
        const c = await addMcp(name, u, helper)
        if (!c.ok && !c.skipped) console.log(`· Claude Code 의 ${name} 을 다시 걸지 못했다${c.why ? ': ' + c.why : ''}${c.line ? ` · 한 번: ${c.line}` : ''}`)
      }
      // 다시 켜기 — 도는 kmd 를 이 PC 의 열쇠로 멈추고 새 판으로 · 안 켜지면 앞 판으로 되돌려 켠다
      if (!url) return void console.log('이 PC 의 kmd 가 꺼져 있다. 다음에 켤 때부터 새 판이다')
      const dir = path.join(home, 'versions', r.ver)
      const node = fs.existsSync(path.join(dir, 'node.exe')) ? path.join(dir, 'node.exe') : process.execPath
      const back = await restartPc(root, o, url, { node, script: path.join(dir, 'server', 'bin', 'kmd.mjs') })
      if (back.ok) console.log(`✓ 다시 켰다. 판 ${back.up.ver} · ${back.up.url}`)
      else if (/멈추지 못했다/.test(back.why)) {
        console.log(`· ${back.why}: 로그아웃했다 들어오면(늘 켜기) 새 판으로 켜진다`)
        process.exitCode = 1
      } else {
        process.exitCode = 1
        if (!r.prev) return void console.log(`· ${back.why}`)
        const p = await linkVersion(home, r.prev)
        const pd = path.join(home, 'versions', p.ver)
        await startPc(root, o, { node: fs.existsSync(path.join(pd, 'node.exe')) ? path.join(pd, 'node.exe') : process.execPath, script: path.join(pd, 'server', 'bin', 'kmd.mjs') })
        const u = await waitPc(root, o, 60_000)
        console.log(`· 새 판이 다시 켜지지 않아 앞 판 ${p.ver} 으로 되돌렸다${u ? ': ' + u : ': kmd open 으로 켠다'}`)
      }
      if (!appHomeOf()) console.log(`· 터미널의 kmd 명령도 새 판으로: PATH 에 ${r.bin} 을 더한다`)
    } else throw new Error('kmd pc task [폴더] · kmd pc update <새 판 폴더> <판> · kmd pc restart · kmd pc link [판]')
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

main()
