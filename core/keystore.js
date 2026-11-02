// OS 자격 저장소 — 기기 열쇠 · PC 의 나가는 자격을 둔다(환경변수 · 평문 파일에 두지 않는다).
//
//   Windows  DPAPI(현재 사용자) 로 감싼 파일 `%USERPROFILE%\.kmd\keys\<이름 지문>.dpapi` — 도우미 실행 파일(core/keyexe.js)이 감싸고 푼다.
//            도우미는 처음 쓸 때 .NET Framework 의 csc 로 `%USERPROFILE%\.kmd\bin\kmd-key-<판>.exe` 에 만든다 · 못 만들면 PowerShell 로.
//            (PowerShell 은 PC 에 따라 켜지는 데만 7초 넘게 걸려 Claude Code 의 headersHelper 10초 제한에 잘린다)
//            %APPDATA% 에 두지 않는다: Claude 데스크톱 앱(MSIX) 안에서 뜬 프로세스가 쓰면 AppData 쓰기가 앱 전용 자리로 가상화되어
//            앱 안 · 밖이 서로 다른 열쇠를 읽는다. 예전 자리(`%APPDATA%\kmd\keys`)는 새 자리에 없을 때만 읽는다
//   macOS    키체인(security · 서비스 kmd)
//   Linux    secret-tool(서비스 kmd) · 없으면 0600 파일 `~/.config/kmd/keys/`
//
// 값은 표준 입력으로 넘긴다(명령 줄에 남지 않게 — macOS security 만 예외). PowerShell 과는 base64 로 오간다(입력 인코딩이 한글을 깨뜨린다).

import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { KEY_EXE_CS, KEY_EXE_VER } from './keyexe.js'

const run = (cmd, args, input) =>
  new Promise((resolve) => {
    const p = execFile(cmd, args, { windowsHide: true, timeout: 20000, maxBuffer: 1 << 20 }, (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || err?.message || '') }))
    p.stdin.end(input ?? '')
  })

const slug = (name) => crypto.createHash('sha256').update(String(name)).digest('hex').slice(0, 24)
const winDir = () => path.join(os.homedir(), '.kmd', 'keys')
const oldWinDir = () => path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'kmd', 'keys')
const fileDir = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'kmd', 'keys')

const PS = (body) => ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$in=[Console]::In.ReadToEnd();${body}`]
const exists = (f) => fs.stat(f).then(() => true, () => false)

// 도우미 실행 파일 — 있으면 그대로 · 없으면 csc 로 만들어 이름 바꾸기로 둔다(둘이 같이 만들어도 반쯤 쓴 파일을 읽지 않게)
let exeP = null
function keyExe() {
  exeP ??= (async () => {
    const exe = path.join(os.homedir(), '.kmd', 'bin', `kmd-key-${KEY_EXE_VER}.exe`)
    if (await exists(exe)) return exe
    const win = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
    for (const d of ['Framework64', 'Framework']) {
      const csc = path.join(win, 'Microsoft.NET', d, 'v4.0.30319', 'csc.exe')
      if (!(await exists(csc))) continue
      await fs.mkdir(path.dirname(exe), { recursive: true })
      const tmp = `${exe}.${process.pid}.${Date.now()}`
      await fs.writeFile(tmp + '.cs', KEY_EXE_CS)
      const r = await run(csc, ['/nologo', '/target:exe', '/optimize+', '/r:System.Security.dll', `/out:${tmp}.exe`, tmp + '.cs'])
      await fs.rm(tmp + '.cs', { force: true })
      if (!r.ok) {
        await fs.rm(tmp + '.exe', { force: true })
        throw new Error((r.out || r.err).trim().split('\n')[0])
      }
      await fs.rename(tmp + '.exe', exe).catch(async (e) => {
        await fs.rm(tmp + '.exe', { force: true })
        if (!(await exists(exe))) throw e
      })
      return exe
    }
    return null
  })().catch((e) => {
    console.error('kmd: 열쇠 도우미를 만들지 못해 PowerShell 로 한다: ' + e.message)
    return null
  })
  return exeP
}

// DPAPI 감싸기(p) · 풀기(u) — base64 로 오간다. 도우미가 없거나 실패하면 PowerShell 로
async function dpapi(mode, b64) {
  const exe = await keyExe()
  if (exe) {
    const r = await run(exe, [mode], b64)
    if (r.ok) return r
  }
  const op = mode === 'p' ? 'Protect' : 'Unprotect'
  return run('powershell.exe', PS(`[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${op}([Convert]::FromBase64String($in.Trim()),$null,'CurrentUser')))`), b64)
}

export async function put(name, value) {
  if (process.platform === 'win32') {
    const r = await dpapi('p', Buffer.from(String(value), 'utf8').toString('base64'))
    if (!r.ok) throw new Error('자격 저장소에 넣지 못했다: ' + r.err.trim().split('\n')[0])
    await fs.mkdir(winDir(), { recursive: true })
    await fs.writeFile(path.join(winDir(), slug(name) + '.dpapi'), r.out.trim() + '\n', { mode: 0o600 })
    return
  }
  if (process.platform === 'darwin') {
    const r = await run('security', ['add-generic-password', '-U', '-s', 'kmd', '-a', name, '-w', value])
    if (r.ok) return
  } else {
    const r = await run('secret-tool', ['store', '--label', `kmd ${name}`, 'service', 'kmd', 'account', name], value)
    if (r.ok) return
  }
  await fs.mkdir(fileDir(), { recursive: true, mode: 0o700 })
  await fs.writeFile(path.join(fileDir(), slug(name)), value, { mode: 0o600 })
}

export async function get(name) {
  if (process.platform === 'win32') {
    const f = slug(name) + '.dpapi'
    const b = (await fs.readFile(path.join(winDir(), f), 'utf8').catch(() => null)) ?? (await fs.readFile(path.join(oldWinDir(), f), 'utf8').catch(() => null))
    if (!b) return null
    const r = await dpapi('u', b)
    return r.ok ? Buffer.from(r.out.trim(), 'base64').toString('utf8') : null
  }
  if (process.platform === 'darwin') {
    const r = await run('security', ['find-generic-password', '-s', 'kmd', '-a', name, '-w'])
    if (r.ok) return r.out.replace(/\n$/, '')
  } else {
    const r = await run('secret-tool', ['lookup', 'service', 'kmd', 'account', name])
    if (r.ok && r.out) return r.out.replace(/\n$/, '')
  }
  return fs.readFile(path.join(fileDir(), slug(name)), 'utf8').catch(() => null)
}

export async function del(name) {
  if (process.platform === 'win32') {
    await fs.rm(path.join(winDir(), slug(name) + '.dpapi'), { force: true })
    return fs.rm(path.join(oldWinDir(), slug(name) + '.dpapi'), { force: true })
  }
  if (process.platform === 'darwin') await run('security', ['delete-generic-password', '-s', 'kmd', '-a', name])
  else await run('secret-tool', ['clear', 'service', 'kmd', 'account', name])
  await fs.rm(path.join(fileDir(), slug(name)), { force: true })
}

// 기기 열쇠의 이름 — 서버 주소(origin) 하나에 열쇠 하나
export const keyName = (url) => 'device:' + new URL(url).origin
