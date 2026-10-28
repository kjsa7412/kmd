// PC 운영 — 늘 켜기(작업 스케줄러 「로그온 시 · 실패하면 다시」) · 새 판 올리기(healthz 뒤 바꾸고 · 안 되면 앞 판 그대로).
//
//   판 자리   <집>/versions/<판>/ (각 판의 server/bin/kmd.mjs) · <집>/current.json { ver, prev, at } · 집 기본 ~/.kmd-app
//   실행기    <집>/bin/kmd.cmd · kmd-key.cmd — 지금 판 폴더를 가리킨다. PATH · 늘 켜기 작업 · 시작 메뉴 · Claude Code 헤더 도우미가
//             모두 이 둘만 부르므로 판을 바꿀 때는 실행기만 다시 쓴다(설치 한 줄 · `kmd pc link` · `kmd pc update`).
//   올리기    새 판을 versions/ 에 두고 → 빈 임시 폴더로 그 판을 띄워 /healthz 가 20초 안에 ok 인가 → 그때만 current 와 실행기를 바꾼다.
//             안 되면 current 는 앞 판 그대로(저절로 되돌림) · 띄운 것은 끈다. 지식 · 살림 자리는 건드리지 않는다.
//   늘 켜기   작업 XML 을 만들어 `schtasks /Create /XML` — 로그온 때 `kmd up --no-open` · 실패하면 1분마다 다시.

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { KmdError } from './errors.js'

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// 이 PC 의 지식 폴더 표 — 팀 화면 › 설정 · 개인에서 고른 지식 폴더(<집 폴더>/.kmd-pc.json { root }). kmd up · 늘 켜기가 기본 폴더로 읽는다
export const pcRootFile = () => process.env.KMD_PC_ROOT_FILE || path.join(os.homedir(), '.kmd-pc.json')
export function readPcRoot() {
  try {
    const r = JSON.parse(fsSync.readFileSync(pcRootFile(), 'utf8')).root
    return r && path.isAbsolute(r) ? path.resolve(r) : null
  } catch {
    return null
  }
}
export function writePcRoot(root) {
  fsSync.writeFileSync(pcRootFile(), JSON.stringify({ root: path.resolve(root), ...(isNoneRoot(root) ? { none: true } : {}), at: new Date().toISOString() }, null, 1))
}
// 지식 폴더를 뗀 내 PC 쪽 — 빈 빈자리 폴더(지식 폴더 표 옆)로 돈다. 팀 연결 · 내 Claude 는 그대로 · 지식은 없다 · 경로를 쓰면 그 폴더로 다시 켜진다
export const noneRoot = () => path.join(path.dirname(pcRootFile()), '.kmd-pc-none')
export const isNoneRoot = (r) => !!r && path.resolve(r).toLowerCase() === path.resolve(noneRoot()).toLowerCase()
// 지식 폴더를 옮길 때 함께 가는 이 PC 의 살림 — 이은 팀(teams.json · 합친다) · 내 Claude 로그인(secrets.json · 새 곳에 없을 때만).
//   지식 폴더마다 .kmd 가 따로라, 옮기지 않으면 새 폴더의 내 PC 쪽에 팀 화면이 닿지 못한다
export function carryPcData(fromData, toData) {
  fsSync.mkdirSync(toData, { recursive: true })
  const read = (f) => { try { return JSON.parse(fsSync.readFileSync(f, 'utf8')) } catch { return null } }
  const ta = read(path.join(fromData, 'teams.json')) || [], tb = read(path.join(toData, 'teams.json')) || []
  const teams = [...new Set([...tb, ...ta])]
  if (teams.length) fsSync.writeFileSync(path.join(toData, 'teams.json'), JSON.stringify(teams, null, 1))
  const sa = path.join(fromData, 'secrets.json'), sb = path.join(toData, 'secrets.json')
  if (fsSync.existsSync(sa) && !fsSync.existsSync(sb)) fsSync.copyFileSync(sa, sb)
}
// 지식 폴더로 쓸 수 있나 — 'open'(.kmd 가 있다 · 그대로 잇는다) · 'new'(없거나 빈 폴더 · 새로 세운다) · 아니면 KmdError(드라이브 통째 · 다른 파일만 있는 폴더)
//   팀 화면의 [바꾸기](/api/pc/root) · 경로를 실은 설치 한 줄(kmd connect --root)이 같은 잣대로 본다
export function pcRootKind(want) {
  if (!want || !path.isAbsolute(want)) throw new KmdError('E_INPUT', '이 PC 의 절대 경로를 쓴다(예: D:\\kmd)')
  const full = path.resolve(want)
  if (path.parse(full).root.toLowerCase() === full.toLowerCase()) throw new KmdError('E_INPUT', '드라이브 통째는 쓰지 않는다. 그 안의 폴더를 고른다')
  let names
  try {
    names = fsSync.readdirSync(full)
  } catch (e) {
    if (e.code === 'ENOENT') return { root: full, kind: 'new' }
    throw new KmdError('E_INPUT', `그 폴더를 읽지 못한다: ${e.code}`)
  }
  if (names.includes('.kmd')) return { root: full, kind: 'open' }
  if (names.filter((n) => !n.startsWith('.')).length === 0) return { root: full, kind: 'new' }
  throw new KmdError('E_INPUT', '이 폴더에는 다른 파일이 있다. kmd 지식 폴더(.kmd 가 있는 곳)나 빈 폴더를 고른다')
}

export const launcherOf = (home, name = 'kmd') => path.join(home, 'bin', name + (process.platform === 'win32' ? '.cmd' : ''))
// 이 판이 판 자리(<집>/versions/<판>/server/bin/…)에서 도는가 — 그러면 { home, ver } · 아니면 null(저장소 · 손으로 푼 폴더).
// 실행기가 선 집만 판 자리로 본다(폴더 이름이 우연히 versions 인 곳을 작업 · 헤더 도우미로 걸지 않게) — 처음 실행기를 세우는
// `kmd pc link` 만 모양으로 본다(shape)
export function appHomeOf(file = process.argv[1], { shape = false } = {}) {
  if (process.env.KMD_APP_HOME) return { home: path.resolve(process.env.KMD_APP_HOME), ver: null }
  if (!file) return null
  const verDir = path.resolve(path.dirname(file), '..', '..')
  if (path.basename(path.dirname(verDir)) !== 'versions') return null
  const home = path.dirname(path.dirname(verDir))
  if (!shape && !fsSync.existsSync(launcherOf(home))) return null
  return { home, ver: path.basename(verDir) }
}

// 바꿔 쓰기 — 임시 파일 뒤 이름 바꾸기. Windows 는 막 쓴 .cmd 를 백신이 잠깐 잡아 rename 이 EPERM 일 때가 있어 몇 번 더 · 끝내 안 되면 덮어쓴다
async function replaceFile(f, body) {
  await fs.writeFile(f + '.tmp', body, { mode: 0o755 })
  for (let i = 0; i < 20; i++) {
    try {
      return await fs.rename(f + '.tmp', f)
    } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  await fs.writeFile(f, body, { mode: 0o755 })
  await fs.rm(f + '.tmp', { force: true })
}

// 실행기 — 지금 판을 가리키는 kmd · kmd-key(Windows .cmd · 그 밖은 sh). 판 폴더에 node.exe 가 있으면 그것을, 없으면 PATH 의 node.
// .cmd 는 자기 자리(%~dp0)에서 판 폴더를 찾는다 — cmd 는 .cmd 를 시스템 코드 페이지로 읽어 한글 사용자 폴더(C:\Users\홍길동)의
// 절대 경로가 깨진다. 판 이름만 글자로 넣는다(영문 · 숫자). node 를 부른 같은 줄에서 끝낸다 — 도는 중에 판을 바꿔 이 파일이
// 바뀌어도 cmd 가 뒤쪽 바이트를 명령으로 읽지 않는다. `call exit /b %errorlevel%` 은 node 가 끝난 뒤에 펼쳐 그 종료 코드를 넘긴다
// (`& exit /b` 만 쓰면 늘 0 이다)
export async function writeLaunchers(home, ver) {
  const dir = path.join(home, 'versions', ver)
  const bin = path.join(home, 'bin')
  await fs.mkdir(bin, { recursive: true })
  const win = process.platform === 'win32'
  const nodeExe = path.join(dir, win ? 'node.exe' : 'node')
  const hasNode = await fs.access(nodeExe).then(() => true, () => false)
  for (const name of ['kmd', 'kmd-key']) {
    const body = win
      ? `@${hasNode ? `"%~dp0..\\versions\\${ver}\\node.exe"` : 'node'} "%~dp0..\\versions\\${ver}\\server\\bin\\${name}.mjs" %* & call exit /b %%errorlevel%%\r\n`
      : `#!/bin/sh\nexec "${hasNode ? nodeExe : 'node'}" "${path.join(dir, 'server', 'bin', name + '.mjs')}" "$@"\n`
    await replaceFile(launcherOf(home, name), body)
  }
  return { bin, kmd: launcherOf(home, 'kmd'), key: launcherOf(home, 'kmd-key') }
}

// 이 판을 지금 판으로 — current.json 과 실행기(설치 한 줄 · 새 판 올리기가 부른다)
export async function linkVersion(home, ver) {
  if (!/^[0-9A-Za-z._-]{1,40}$/.test(String(ver))) throw new KmdError('E_INPUT', '판 이름이 아니다')
  await fs.access(path.join(home, 'versions', ver, 'server', 'bin', 'kmd.mjs')).catch(() => { throw new KmdError('E_NOTFOUND', `판 자리에 ${ver} 이 없다`) })
  const cur = await readCurrent(home)
  const next = { ver, prev: cur?.ver && cur.ver !== ver ? cur.ver : cur?.prev || null, at: new Date().toISOString() }
  await fs.mkdir(home, { recursive: true })
  await replaceFile(path.join(home, 'current.json'), JSON.stringify(next, null, 1))
  return { ...next, ...(await writeLaunchers(home, ver)) }
}

// 시작 메뉴 바로가기 「kmd」 — 누르면 `kmd open`(켜져 있지 않으면 켜고 화면을 연다). Windows 만 · PowerShell 의 WScript.Shell
export function shortcutPs({ target, args = '', dir = null, name = 'kmd' }) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'"
  const where = dir ? q(dir) : "[Environment]::GetFolderPath('Programs')"
  return `$ErrorActionPreference='Stop';$d=${where};New-Item -ItemType Directory -Force $d | Out-Null;$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d ${q(name + '.lnk')}));$s.TargetPath=${q(target)};$s.Arguments=${q(args)};$s.WindowStyle=7;$s.Description=${q('kmd: 이 PC 의 지식 화면을 연다')};$s.Save()`
}
export function makeShortcut(o) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, why: 'Windows 가 아니다' })
  return new Promise((ok) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', shortcutPs(o)], { stdio: 'ignore', windowsHide: true })
    p.on('exit', (c) => ok(c === 0 ? { ok: true } : { ok: false, why: '바로가기를 만들지 못했다' }))
    p.on('error', () => ok({ ok: false, why: 'PowerShell 이 없다' }))
  })
}

// 실행기가 있으면 작업은 실행기를(판을 바꿔도 다시 걸 일이 없다) · 없으면 지금 도는 node 와 kmd.mjs 를
export function taskXml({ node = process.execPath, script, root, user = os.userInfo().username, launcher = null }) {
  const cmd = launcher || node
  const args = `${launcher ? '' : `"${script}" `}up "${root}" --no-open`
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>kmd: 이 PC 의 지식(로그온 때 켜고 멈추면 다시)</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xmlEsc(user)}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${xmlEsc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
    <Hidden>true</Hidden>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xmlEsc(cmd)}</Command><Arguments>${xmlEsc(args)}</Arguments></Exec></Actions>
</Task>
`
}

const freePort = () => new Promise((ok, no) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) }); s.on('error', no) })

async function healthy(port, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`)
      if (r.ok && (await r.json()).ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

// fs.cp 는 Node 22 · Windows 의 한글 경로에서 넘어진다 — 손으로 복사
async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true })
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    if (e.name === '.git') continue
    const a = path.join(from, e.name)
    const b = path.join(to, e.name)
    if (e.isDirectory()) await copyDir(a, b)
    else await fs.copyFile(a, b)
  }
}

// 폴더 이름 바꾸기 — 막 복사한 파일을 Windows(백신 검사)가 잠깐 잡아 EPERM 일 때가 있어 몇 초 더 · 끝내 안 되면 복사하고 지운다
async function renameDir(a, b) {
  for (let i = 0; i < 30; i++) {
    try {
      return await fs.rename(a, b)
    } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(e.code)) throw e
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  await copyDir(a, b)
  await fs.rm(a, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {})
}

export async function readCurrent(home) {
  return fs.readFile(path.join(home, 'current.json'), 'utf8').then(JSON.parse, () => null)
}

// from — 새 판 폴더(풀어 둔 것) · ver — 판 이름. 지금 판 이름에는 덮어쓰지 않는다(도는 판 폴더를 반쯤 바꾼 채 멈출 수 있다) ·
// 옆 임시 폴더에 다 복사한 뒤 이름을 바꾼다 · 켜 보기는 실행기가 쓸 그 node 로(판 폴더에 node.exe 가 있으면 그것)
export async function upgrade({ home, from, ver, waitMs = 20_000, node = null }) {
  if (!/^[0-9A-Za-z._-]{1,40}$/.test(String(ver))) throw new KmdError('E_INPUT', '판 이름이 아니다')
  const dest = path.join(home, 'versions', ver)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  if (path.resolve(from) !== path.resolve(dest)) {
    if ((await readCurrent(home))?.ver === ver) throw new KmdError('E_INPUT', `${ver} 은 지금 판이다. 다른 판 이름으로 올린다`)
    const stage = `${dest}.tmp-${process.pid}`
    await fs.rm(stage, { recursive: true, force: true })
    try {
      await copyDir(from, stage)
      await fs.rm(dest, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      await renameDir(stage, dest)
    } catch (e) {
      await fs.rm(stage, { recursive: true, force: true }).catch(() => {})
      throw e
    }
  }
  const script = path.join(dest, 'server', 'bin', 'kmd.mjs')
  if (!node) {
    const exe = path.join(dest, process.platform === 'win32' ? 'node.exe' : 'node')
    node = await fs.access(exe).then(() => exe, () => process.execPath)
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kmd-up-'))
  const port = await freePort()
  const child = spawn(node, [script, 'serve', tmp, '--port', String(port)], { stdio: 'ignore', windowsHide: true, env: { ...process.env, KMD_NO_CLAUDE: '1' } })
  let exited = false
  child.on('exit', () => { exited = true })
  const ok = await Promise.race([healthy(port, waitMs), new Promise((r) => child.on('exit', () => r(false)))])
  if (!exited) child.kill()
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  const cur = await readCurrent(home)
  if (!ok) return { ok: false, ver: cur?.ver || null, tried: ver, rolledBack: true }
  return { ok: true, ...(await linkVersion(home, ver)) }
}
