// OS 자격 저장소 — 기기 열쇠 · PC 의 나가는 자격을 둔다(환경변수 · 평문 파일에 두지 않는다).
//
//   Windows  DPAPI(현재 사용자) 로 감싼 파일 `%APPDATA%\kmd\keys\<이름 지문>.dpapi` — PowerShell 이 감싸고 푼다
//   macOS    키체인(security · 서비스 kmd)
//   Linux    secret-tool(서비스 kmd) · 없으면 0600 파일 `~/.config/kmd/keys/`
//
// 값은 표준 입력으로 넘긴다(명령 줄에 남지 않게 — macOS security 만 예외). PowerShell 과는 base64 로 오간다(입력 인코딩이 한글을 깨뜨린다).

import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const run = (cmd, args, input) =>
  new Promise((resolve) => {
    const p = execFile(cmd, args, { windowsHide: true, timeout: 20000, maxBuffer: 1 << 20 }, (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || err?.message || '') }))
    p.stdin.end(input ?? '')
  })

const slug = (name) => crypto.createHash('sha256').update(String(name)).digest('hex').slice(0, 24)
const winDir = () => path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'kmd', 'keys')
const fileDir = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'kmd', 'keys')

const PS = (body) => ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$in=[Console]::In.ReadToEnd();${body}`]

export async function put(name, value) {
  if (process.platform === 'win32') {
    const r = await run('powershell.exe', PS("[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String($in.Trim()),$null,'CurrentUser'))"), Buffer.from(String(value), 'utf8').toString('base64'))
    if (!r.ok) throw new Error('자격 저장소에 넣지 못했다 — ' + r.err.trim().split('\n')[0])
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
    const b = await fs.readFile(path.join(winDir(), slug(name) + '.dpapi'), 'utf8').catch(() => null)
    if (!b) return null
    const r = await run('powershell.exe', PS("[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in.Trim()),$null,'CurrentUser')))"), b)
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
  if (process.platform === 'win32') return fs.rm(path.join(winDir(), slug(name) + '.dpapi'), { force: true })
  if (process.platform === 'darwin') await run('security', ['delete-generic-password', '-s', 'kmd', '-a', name])
  else await run('secret-tool', ['clear', 'service', 'kmd', 'account', name])
  await fs.rm(path.join(fileDir(), slug(name)), { force: true })
}

// 기기 열쇠의 이름 — 서버 주소(origin) 하나에 열쇠 하나
export const keyName = (url) => 'device:' + new URL(url).origin
