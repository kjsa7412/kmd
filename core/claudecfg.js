// Claude Code 에 kmd 를 잇는다 — `claude mcp add-json <이름> <설정> --scope user`.
//
// 이름 둘 — `kmd-team`(팀 서버) · `kmd`(이 PC 의 kmd). 열쇠는 설정에 넣지 않고 헤더 도우미(kmd-key)가
// 자격 저장소에서 꺼낸다. claude 가 없거나 실패하면 사람이 붙일 한 줄을 돌려준다(묻지 않는다).
// 시험 · 꾸러미 만들기에서는 KMD_NO_CLAUDE=1 로 부르지 않는다.

import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const KEY_HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'bin', 'kmd-key.mjs')

export function mcpConfig(url) {
  return { type: 'http', url: url + '/mcp', headersHelper: `node "${KEY_HELPER}" ${url}` }
}
export const mcpLine = (name, url) => `claude mcp add-json ${name} '${JSON.stringify(mcpConfig(url))}' --scope user`

function run(args) {
  return new Promise((resolve) => {
    const win = process.platform === 'win32'
    // Windows 의 claude 는 .cmd — 셸로 부르고 JSON 의 따옴표를 감싼다
    const quoted = win ? args.map((a) => (/[\s"{}]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args
    execFile(win ? 'claude' : 'claude', quoted, { shell: win, windowsHide: true, timeout: 30000 }, (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || err?.message || '') }))
  })
}

export async function addMcp(name, url) {
  if (process.env.KMD_NO_CLAUDE) return { ok: false, skipped: true, line: mcpLine(name, url) }
  await run(['mcp', 'remove', name, '--scope', 'user'])
  const r = await run(['mcp', 'add-json', name, JSON.stringify(mcpConfig(url)), '--scope', 'user'])
  return r.ok ? { ok: true } : { ok: false, line: mcpLine(name, url), why: r.err.trim().split('\n')[0] }
}
