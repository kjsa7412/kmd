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
import { VERSION } from '../version.js'

const HELP = `kmd ${VERSION}

  kmd serve [폴더] [--port 7373] [--host 127.0.0.1] [--user 이름]
      팀 서버로 연다 — 폴더 안의 폴더 하나하나가 지식이다
  kmd up [폴더] [--port 7373] [--no-open]
      이 PC 의 kmd 를 연다 — 폴더 기본 D:\\kmd(없으면 집 폴더의 kmd)

  Claude Code 에 잇기:  claude mcp add --transport http kmd http://127.0.0.1:7373/mcp
`

function parse(argv) {
  const o = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--no-open') o.open = false
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
  let s
  try {
    s = await startServer({ root, mode: pc ? 'pc' : 'team', user, host: o.host || '127.0.0.1', port })
  } catch (e) {
    if (e.code === 'EADDRINUSE') console.error(`포트 ${port} 를 이미 다른 프로그램이 쓴다 — --port 로 다른 수를 준다`)
    else console.error(e.message)
    process.exit(1)
  }
  const ks = await s.store.list()
  console.log(`kmd ${VERSION} — ${pc ? '이 PC' : '팀 서버'} · ${s.url}`)
  console.log(`지식 ${ks.length} — ${root}${ks.length ? ' · ' + ks.map((k) => k.name).join(' · ') : ''}`)
  console.log(`Claude Code 에 잇기: claude mcp add --transport http kmd ${s.url}/mcp`)
  if (pc && o.open !== false) openBrowser(s.url)
  const stop = () => s.close().then(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main()
