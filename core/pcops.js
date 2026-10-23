// PC 운영 — 늘 켜기(작업 스케줄러 「로그온 시 · 실패하면 다시」) · 새 판 올리기(healthz 뒤 바꾸고 · 안 되면 앞 판 그대로).
//
//   판 자리   <집>/versions/<판>/ (각 판의 server/bin/kmd.mjs) · <집>/current.json { ver, prev, at }
//   올리기    새 판을 versions/ 에 두고 → 빈 임시 폴더로 그 판을 띄워 /healthz 가 20초 안에 ok 인가 → 그때만 current 를 바꾼다.
//             안 되면 current 는 앞 판 그대로(저절로 되돌림) · 띄운 것은 끈다. 지식 · 살림 자리는 건드리지 않는다.
//   늘 켜기   작업 XML 을 만들어 `schtasks /Create /XML` — 로그온 때 `kmd up --no-open` · 실패하면 1분마다 다시.

import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { KmdError } from './errors.js'

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function taskXml({ node = process.execPath, script, root, user = os.userInfo().username }) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>kmd — 이 PC 의 지식(로그온 때 켜고 멈추면 다시)</Description></RegistrationInfo>
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
  <Actions Context="Author"><Exec><Command>${xmlEsc(node)}</Command><Arguments>${xmlEsc(`"${script}" up "${root}" --no-open`)}</Arguments></Exec></Actions>
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

export async function readCurrent(home) {
  return fs.readFile(path.join(home, 'current.json'), 'utf8').then(JSON.parse, () => null)
}

// from — 새 판 폴더(풀어 둔 것) · ver — 판 이름
export async function upgrade({ home, from, ver, waitMs = 20_000, node = process.execPath }) {
  if (!/^[0-9A-Za-z._-]{1,40}$/.test(String(ver))) throw new KmdError('E_INPUT', '판 이름이 아니다')
  const dest = path.join(home, 'versions', ver)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  if (path.resolve(from) !== path.resolve(dest)) await copyDir(from, dest)
  const script = path.join(dest, 'server', 'bin', 'kmd.mjs')
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
  const next = { ver, prev: cur?.ver || null, at: new Date().toISOString() }
  await fs.writeFile(path.join(home, 'current.json.tmp'), JSON.stringify(next, null, 1))
  await fs.rename(path.join(home, 'current.json.tmp'), path.join(home, 'current.json'))
  return { ok: true, ...next }
}
