// Claude Code 에 kmd 를 잇는다 — `claude mcp add-json <이름> <설정> --scope user`.
//
// 이름 둘 — `kmd-team`(팀 서버) · `kmd`(이 PC 의 kmd). 열쇠는 설정에 넣지 않고 헤더 도우미(kmd-key)가
// 자격 저장소에서 꺼낸다. claude 가 없거나 실패하면 사람이 붙일 한 줄을 돌려준다(묻지 않는다).
// 시험 · 꾸러미 만들기에서는 KMD_NO_CLAUDE=1 로 부르지 않는다.
//
// Windows — claude.exe(설치 프로그램)면 셸 없이 부른다. npm 의 claude.cmd 면 셸(cmd)을 거치므로 인자를 MSVCRT 규칙으로 감싸고,
// 주소 · 도우미 경로에 cmd 가 따로 읽는 글자(% ^ & | < > ! ")가 있으면 부르지 않고 붙일 한 줄만 준다 — 짝 [허락] 으로 들어온
// 팀 주소가 셸 명령이 되지 않게.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appHomeOf, launcherOf } from './pcops.js'

export const KEY_HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'bin', 'kmd-key.mjs')

// 판 자리에서 돌면 실행기(<집>/bin/kmd-key) — 판을 바꿔도 Claude Code 설정을 다시 쓸 일이 없고 PATH 에 node 가 없어도 된다
export function keyHelper() {
  const h = appHomeOf(KEY_HELPER)
  return h ? `"${launcherOf(h.home, 'kmd-key')}"` : `node "${KEY_HELPER}"`
}
export function mcpConfig(url, helper = keyHelper()) {
  return { type: 'http', url: url + '/mcp', headersHelper: `${helper} ${url}` }
}

// 팀 · 이 PC 주소 — http(s) 의 이름 · IP · [IPv6] 과 포트만(그 밖은 Claude Code 설정에도 셸에도 넣지 않는다)
export function safeOrigin(u) {
  try {
    const x = new URL(String(u))
    if (!/^https?:$/.test(x.protocol) || x.username || x.password) return null
    if (!/^([a-z0-9-]+\.)*[a-z0-9-]+$/i.test(x.hostname) && !/^\[[0-9a-f:.]+\]$/i.test(x.hostname)) return null
    return x.origin
  } catch {
    return null
  }
}
const CMD_META = /[%^&|<>!\r\n]/
// MSVCRT(CommandLineToArgvW) 규칙 — 따옴표 앞 역슬래시는 두 배로, 따옴표는 \" 로, 끝 역슬래시는 두 배로
const msvcrt = (a) => (/[\s"{}]/.test(a) ? '"' + a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"' : a)

// claude 의 자리 — Windows 는 PATH 에서 claude.exe · claude.cmd 를 찾는다
function claudeOnPath() {
  if (process.platform !== 'win32') return { kind: 'posix', file: 'claude' }
  for (const d of String(process.env.PATH || '').split(';').filter(Boolean)) {
    for (const [kind, n] of [['exe', 'claude.exe'], ['cmd', 'claude.cmd']]) if (fs.existsSync(path.join(d, n))) return { kind, file: path.join(d, n) }
  }
  return null
}

// 사람이 붙일 한 줄 — Windows 는 설치 한 줄을 붙인 PowerShell 에서 그대로 되는 꼴(--% 뒤는 PowerShell 이 손대지 않는다)
export function mcpLine(name, url, helper) {
  const json = JSON.stringify(mcpConfig(url, helper))
  if (process.platform !== 'win32') return `claude mcp add-json ${name} '${json}' --scope user`
  const c = claudeOnPath()
  const cmd = c?.kind === 'exe' ? `& "${c.file}"` : 'claude.cmd'
  return `${cmd} --% mcp add-json ${name} ${msvcrt(json)} --scope user`
}

function run(args) {
  return new Promise((resolve) => {
    const c = claudeOnPath()
    if (!c) return resolve({ ok: false, out: '', err: 'claude 가 PATH 에 없다' })
    const done = (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || err?.message || '') })
    if (c.kind !== 'cmd') return void execFile(c.file, args, { windowsHide: true, timeout: 30000 }, done)
    // cmd 를 거친다 — 따옴표는 MSVCRT 로 감싸고, cmd 가 따옴표 밖에서도 읽는 글자가 든 인자는 아예 넘기지 않는다
    if (args.some((a) => CMD_META.test(a))) return resolve({ ok: false, out: '', err: '주소나 경로에 셸이 따로 읽는 글자(% ^ & | < > !)가 있다' })
    execFile('claude.cmd', args.map(msvcrt), { shell: true, windowsHide: true, timeout: 30000 }, done)
  })
}

// helper — 헤더 도우미를 정해 줄 때(새 판 올리기가 새 집의 실행기를 준다). 있던 것을 먼저 지우지 않는다 — 더하기가 되지 않을 때만
// 지우고 다시 더한다(따옴표 · claude 없음으로 실패해도 있던 연결이 사라지지 않게)
export async function addMcp(name, url, helper) {
  const origin = safeOrigin(url)
  if (!origin || origin !== String(url)) return { ok: false, line: '', why: `주소가 아니다 — ${String(url).slice(0, 80)}` }
  if (process.env.KMD_NO_CLAUDE) return { ok: false, skipped: true, line: mcpLine(name, url, helper) }
  const add = () => run(['mcp', 'add-json', name, JSON.stringify(mcpConfig(url, helper)), '--scope', 'user'])
  let r = await add()
  if (!r.ok && /exist|already|이미/i.test(r.err + r.out)) {
    await run(['mcp', 'remove', name, '--scope', 'user'])
    r = await add()
  }
  return r.ok ? { ok: true } : { ok: false, line: mcpLine(name, url, helper), why: r.err.trim().split('\n')[0] }
}
