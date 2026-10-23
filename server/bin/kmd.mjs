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

import { addMcp, mcpLine } from '../../core/claudecfg.js'
import { taskXml, upgrade } from '../../core/pcops.js'
import { installLines, pickBackupDir } from '../../core/install.js'
import { ensureRepo } from '../../core/git.js'

const HELP = `kmd ${VERSION}

  kmd serve [폴더] [--port 7373] [--host 127.0.0.1] [--user 이름]
      팀 서버로 연다 — 폴더 안의 폴더 하나하나가 지식이다
  kmd up [폴더] [--port 7373] [--no-open]
      이 PC 의 kmd 를 연다 — 폴더 기본 D:\\kmd(없으면 집 폴더의 kmd)
  kmd backup [--root 폴더]                     백업 상태 — 지식마다 한 줄
  kmd backup add <지식> <주소> [--root 폴더]    백업 자리를 붙이고 지금 보낸다
  kmd backup pull <지식> [--root 폴더]          백업에서 받기(앞으로만 · 받은 뒤 검사)
  kmd restore <백업 주소> [이름] [--root 폴더]  백업 자리에서 지식을 새 폴더로 되살린다
  kmd auth reapply <auth.log>                  옛 명부로 되살린 뒤 늦은 일을 다시 적용
  kmd pc task [폴더]                           로그온 때 켜고 멈추면 다시(작업 스케줄러)
  kmd pc update <새 판 폴더> <판>              새 판을 켜 보고 될 때만 바꾼다
  kmd owner <지식> [사람] [--private] [--curators 가,나] [--root 폴더]
      지식의 주인 · 개인(주인만 본다) · 정리하는 사람

  공통: --data <폴더>  kmd 의 살림 자리(기본 <폴더>/.kmd)

  Claude Code 에 잇기:  claude mcp add --transport http kmd http://127.0.0.1:7373/mcp
`

function parse(argv) {
  const o = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--no-open') o.open = false
    else if (a.startsWith('--no-')) o[a.slice(5)] = 'false' // --no-backup · --no-task · --no-worker
    else if (a === '--private' || a === '--team') o.private = a === '--private'
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      o[k] = v ?? argv[++i]
    } else o._.push(a)
  }
  return o
}

function defaultPcRoot() {
  if (process.platform === 'win32' && fs.existsSync('D:\\')) return 'D:\\kmd'
  return path.join(os.homedir(), 'kmd')
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref()
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
  if (cmd !== 'serve' && cmd !== 'up') {
    console.error(`모르는 명령 — ${cmd}\n`)
    process.stdout.write(HELP)
    process.exit(2)
  }
  const o = parse(rest)
  const pc = cmd === 'up'
  const root = path.resolve(o._[0] || (pc ? defaultPcRoot() : '.'))
  if (pc) fs.mkdirSync(root, { recursive: true })
  if (!fs.existsSync(root)) {
    console.error(`폴더가 없다 — ${root}`)
    process.exit(2)
  }
  const port = o.port != null ? Number(o.port) : 7373
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`포트는 0 ~ 65535 의 수다 — ${o.port}`)
    process.exit(2)
  }
  const user = String(o.user || os.userInfo().username)
  if (isReservedUser(user)) {
    console.error(`「${user}」 는 kmd 가 쓰는 이름이다 — --user 로 다른 이름을 준다`)
    process.exit(2)
  }
  let s
  try {
    s = await startServer({ root, data: o.data ? path.resolve(o.data) : null, mode: pc ? 'pc' : 'team', user, host: o.host || '127.0.0.1', port })
  } catch (e) {
    if (e.code === 'EADDRINUSE') console.error(`포트 ${port} 를 이미 다른 프로그램이 쓴다 — --port 로 다른 수를 준다`)
    else console.error(e.message)
    process.exit(1)
  }
  const ks = await s.store.list()
  console.log(`kmd ${VERSION} — ${pc ? '이 PC' : '팀 서버'} · ${s.url}`)
  console.log(`지식 ${ks.length} — ${root}${ks.length ? ' · ' + ks.map((k) => k.name).join(' · ') : ''}`)
  if (!pc) {
    const code = await s.auth.setupCode()
    if (code) console.log(`첫 관리자 — 이 주소를 브라우저로 연다(24시간 · 한 번): ${s.url}/setup#code=${code}`)
  } else {
    // 이 PC 의 Claude Code 가 쓸 열쇠 — 자격 저장소에 없거나 끊겼으면 새로
    const name = keyName(s.url)
    let key = await kget(name).catch(() => null)
    if (!key || !s.auth.bearer(key)) {
      key = await s.auth.deviceKeyFor(s.pcUser, { host: os.hostname(), osuser: os.userInfo().username })
      await kput(name, key).catch((e) => console.error(e.message))
    }
    const c = await addMcp('kmd', s.url)
    console.log(c.ok ? '✓ Claude Code 에 이었다 — 이 PC 의 kmd(kmd)' : `Claude Code 에 잇기(한 번): ${c.line}`)
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
    if (o.open !== false) openBrowser(`${s.url}/#once=${s.auth.once(s.pcUser)}`)
  }
  const stop = () => s.close().then(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

// 백업 — 서버를 띄우지 않고 지식 폴더 · 살림 자리에 바로 한다(서버가 돌고 있으면 다시 띄울 때 붙는다)
async function backupCmd(o) {
  const root = path.resolve(o.root || (fs.existsSync(defaultPcRoot()) ? defaultPcRoot() : '.'))
  const hub = await makeHub({ root, dataDir: o.data ? path.resolve(o.data) : defaultDataDir(root), log: (...a) => console.log(...a) })
  const [sub, id, url] = o._
  try {
    if (sub === 'add') {
      if (!id || !url) throw new Error('kmd backup add <지식> <주소>')
      const r = await hub.backupAttach(SHELL, id, url)
      console.log(r.ok ? `붙였다 — ${id} → ${r.backup.url} · 지금까지 보냈다` : `붙였다 — ${id} · 아직 못 보냈다(다시 보내기를 건다)`)
    } else if (sub === 'pull') {
      if (!id) throw new Error('kmd backup pull <지식>')
      const r = await hub.backupPull(SHELL, id)
      console.log(r.pulled ? `받았다 — ${r.pulled}개 · 이제 다시 저장된다` : '받을 것이 없다')
    } else {
      await hub.start()
      for (const k of await hub.list()) {
        const st = await hub.backupState(SHELL, k.id)
        if (!st) { console.log(`${k.name} — 백업 자리 없음`); continue }
        await enqueue(k)
        const lines = await hub.stops(SHELL, k.id)
        console.log(`${k.name} — ${st.url} · ${lines.length ? lines.map((l) => l.text).join(' / ') : '잘 보내고 있다'}`)
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
    if (!id) throw new Error('kmd owner <지식> [사람] [--private | --team] [--curators 가,나]')
    const hub = await makeHub({ root, dataDir: o.data ? path.resolve(o.data) : defaultDataDir(root), log: () => {} })
    const row = await hub.setOwner(SHELL, id, { owner: who || undefined, private: o.private, curators: o.curators ? String(o.curators).split(',').map((x) => x.trim()).filter(Boolean) : undefined })
    console.log(`${id} — 주인 ${row.owner || '없음'} · ${row.private ? '개인(주인만 본다)' : '팀'} · 정리 ${row.curators.join(', ') || '없음'}`)
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
      console.log(`더했다 — ${r.id} · 처음 들어오기 링크(24시간 · 한 번): ${base}/first#code=${r.code}`)
    } else if (sub === 'reset') {
      const r = await auth.reset(id, { by: '셸' })
      console.log(`다시 정하게 했다 — ${r.id} · 새 링크(24시간 · 한 번): ${base}/first#code=${r.code} · 기기 열쇠는 그대로`)
    } else {
      for (const u of auth.users()) console.log(`${u.id} — ${u.kind === 'machine' ? '기계 열쇠 · ' + u.machine.kn + ' · ' + u.machine.source : (u.admin ? '관리자' : '사람') + (u.password ? '' : ' · 비밀번호 안 정함') + ` · 기기 ${u.devices}`}`)
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
      console.log(`기계 열쇠 — ${r.id} · ${kn} · ${source} · 1년
${r.key}
(지금 한 번만 보인다 — 그 생성기의 비밀 칸에 붙인다)`)
    } else if (sub === 'revoke') {
      await auth.machineRevoke(kn)
      console.log(`끊었다 — ${kn}`)
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
      await setSecret(dataOf(o), name, await hidden(`${name} 의 값(보이지 않는다): `))
      console.log(`넣었다 — ${name}`)
    } else for (const x of await listSecrets(dataOf(o))) console.log(`${x.name} — ${x.at.slice(0, 16).replace('T', ' ')} 에 넣음`)
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
    console.log(`${id} — 문항 ${r.score.n} · 6개 안 ${r.score.in}% · 첫째 ${r.score.first}%${r.frozen ? ` · 얼린 시험지보다 나빠진 문항 ${r.worse.length}${r.worse.length ? ' — ' + r.worse.slice(0, 5).join(' · ') : ''}` : ' · 이 시험지를 얼렸다'}`)
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
      console.log(`정리 일꾼 열쇠 — ${r.id}\n${r.key}\n(지금 한 번만 보인다 — 정리용 OS 사용자로 「kmd worker key set <팀 주소>」 에 붙인다)`)
      return
    }
    if (sub === 'key') {
      const url = new URL(o._[2] || '').origin
      await kput('worker:' + url, (await hidden('정리 일꾼 열쇠(보이지 않는다): ')).trim())
      console.log(`넣었다 — ${url} 의 정리 일꾼 열쇠`)
      return
    }
    const url = new URL(sub || '').origin
    const key = o.key || process.env.KMD_WORKER_KEY || (await kget('worker:' + url))
    if (!key) throw new Error('정리 일꾼 열쇠가 없다 — kmd worker key set <팀 주소>')
    // 팀 서버의 정리 일꾼 — 관리 › Claude 연결에서 받은 정리 전용 로그인(비밀 claude-token)을 이 프로세스에만
    if (o.data) { const t = await getSecret(path.resolve(o.data), 'claude-token').catch(() => null); if (t) process.env.CLAUDE_CODE_OAUTH_TOKEN = t }
    const { runWorker } = await import('../../core/worker.js')
    runWorker({ server: url, key, poll: o.poll ? Number(o.poll) : 10_000 })
    console.log(`kmd worker — ${url} 의 정리 일감을 기다린다`)
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
  const url = new URL(url0).origin
  const root = path.resolve(o.root || defaultPcRoot())
  fs.mkdirSync(root, { recursive: true })
  const pcData = o.data ? path.resolve(o.data) : path.join(root, '.kmd')
  fs.mkdirSync(pcData, { recursive: true })
  // ① 세우기 — 지식 폴더 · 다른 드라이브의 백업 자리(지식마다 저장소 하나)
  const hub = await makeHub({ root, dataDir: pcData, mode: 'pc', log: () => {} })
  const kns = await hub.list()
  let backupDir = o.backup === 'false' ? null : pickBackupDir(root)
  if (backupDir) {
    try {
      fs.mkdirSync(backupDir, { recursive: true })
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
  const c = team.ok ? await addMcp('kmd-team', url) : { ok: false, line: mcpLine('kmd-team', url) }
  // ④ 늘 켜기 — 로그온 작업 + 지금 한 번
  let task = { ok: false, why: '이 PC 에서 kmd up 으로 켠다' }
  if (o.task !== 'false' && process.platform === 'win32') {
    const f = path.join(os.tmpdir(), 'kmd-task.xml')
    fs.writeFileSync(f, '\ufeff' + taskXml({ script: process.argv[1], root }), 'utf16le')
    const code = await new Promise((ok) => spawn('schtasks', ['/Create', '/F', '/TN', 'kmd', '/XML', f], { stdio: 'ignore', windowsHide: true }).on('exit', ok).on('error', () => ok(1)))
    if (code === 0) {
      spawn('schtasks', ['/Run', '/TN', 'kmd'], { stdio: 'ignore', windowsHide: true }).on('error', () => {})
      task = { ok: true }
    } else task = { ok: false, why: '작업을 만들지 못했다 — kmd pc task 로 다시' }
  }
  for (const l of installLines({ version: VERSION, root, backup: backupDir, kns: kns.map((k) => k.name), team, user: who, host: os.hostname(), osuser: os.userInfo().username, claude: c, task })) console.log(l)
}

// 되살리기 — 백업 자리에서 새 폴더로(새 PC 의 「이 PC 로 되살리기」 · 지식 받아 오기)
async function restoreCmd(o) {
  const [url, name] = o._
  const root = path.resolve(o.root || (fs.existsSync(defaultPcRoot()) ? defaultPcRoot() : '.'))
  fs.mkdirSync(root, { recursive: true })
  const hub = await makeHub({ root, dataDir: o.data ? path.resolve(o.data) : defaultDataDir(root), mode: o.team ? 'team' : 'pc', log: (...a) => console.log(...a) })
  try {
    if (!url) throw new Error('kmd restore <백업 주소> [이름] [--root 폴더]')
    const r = await hub.restore(SHELL, { url, name })
    console.log(`되살렸다 — ${r.id} · 문서 ${r.docs} · 기록 ${r.records} · 첨부 ${r.atts} · 이름 장부 ${r.vocab ? '있음' : '없음'} · 사람 ${r.owner || '관리자만 본다'}`)
    if (r.errors.length) console.log(`검사 줄 ${r.errors.length} — ${r.errors.slice(0, 3).join(' · ')}`)
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
    console.log(`다시 적용했다 — 일 ${r.to - r.from} · 끊은 기기 ${r.revoked} · 모두 내보냄 ${r.sv} · 기계 열쇠 끊음 ${r.machines}`)
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
      const root = path.resolve(a || defaultPcRoot())
      const xml = taskXml({ script: process.argv[1], root })
      const f = path.join(os.tmpdir(), 'kmd-task.xml')
      fs.writeFileSync(f, '\ufeff' + xml, 'utf16le')
      if (process.platform !== 'win32' || o.print) return void console.log(xml)
      const r = spawn('schtasks', ['/Create', '/F', '/TN', 'kmd', '/XML', f], { stdio: 'inherit', windowsHide: true })
      r.on('exit', (c) => { console.log(c === 0 ? '✓ 로그온 때 켜고 멈추면 1분마다 다시 켠다 — 작업 이름 kmd' : '작업을 만들지 못했다'); process.exitCode = c || 0 })
    } else if (sub === 'update') {
      if (!a || !b) throw new Error('kmd pc update <새 판 폴더> <판> [--home 폴더]')
      const home = path.resolve(o.home || path.join(os.homedir(), '.kmd-app'))
      const r = await upgrade({ home, from: path.resolve(a), ver: b })
      console.log(r.ok ? `✓ 새 판 ${r.ver} 로 바꿨다 — 앞 판 ${r.prev || '없음'} 은 그대로 둔다` : `새 판 ${r.tried} 이 켜지지 않아 그대로 ${r.ver || '앞 판'} 을 쓴다`)
      if (!r.ok) process.exitCode = 1
    } else throw new Error('kmd pc task [폴더] · kmd pc update <새 판 폴더> <판>')
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

main()
