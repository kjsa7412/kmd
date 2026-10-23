// Claude 연결 — 정리 · 기록 만들기에 쓰는 Claude Code 로그인.
//
//   이 PC      [Claude 로그인] → 새 창에서 `claude setup-token`(브라우저가 열린다) · 로그인은 그 PC 의 Claude Code 몫
//   팀 서버    관리 › Claude 연결 — 비밀번호 한 번 더 → 서버가 정리 전용 OS 사용자로 `claude setup-token` 을 띄우고 나온
//              주소를 화면에 → 관리자가 그 주소에서 받은 번호를 붙여 넣으면 그 프로세스의 입력으로만 넘긴다(저장 안 함)
//              → 나온 오래 가는 열쇠는 비밀 `claude-token` 으로만(화면 · 로그 · 응답에 0) → 정리 일꾼이 그것으로 돈다
//   시험       KMD_CLAUDE_LOGIN = 가짜 스크립트(node 로 부른다)
// 한 번에 하나 · 10분 지나면 끈다.

import { spawn } from 'node:child_process'
import { setSecret } from './secrets.js'
import { KmdError } from './errors.js'

const URL_RE = /https:\/\/\S+/
const TOKEN_RE = /sk-ant-[A-Za-z0-9_-]{20,}/

function launch(args, opt = {}) {
  const fake = process.env.KMD_CLAUDE_LOGIN
  const win = process.platform === 'win32'
  if (fake) return spawn(process.execPath, [fake, ...args], { windowsHide: true, ...opt })
  return spawn(win ? 'claude.cmd' : 'claude', args, { windowsHide: true, shell: win, ...opt })
}

// 이 PC — 보이는 창으로 띄우고 손 뗀다(로그인은 사람이 그 창 · 브라우저에서)
export function pcLogin() {
  if (process.env.KMD_CLAUDE_LOGIN) {
    const p = launch(['setup-token'], { stdio: 'ignore', detached: true })
    p.on('error', () => {})
    p.unref()
    return { opened: true }
  }
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', 'kmd — Claude 로그인', 'cmd', '/k', 'claude', 'setup-token']] : process.platform === 'darwin' ? ['open', ['-a', 'Terminal', '--args', 'claude', 'setup-token']] : ['x-terminal-emulator', ['-e', 'claude setup-token']]
  const p = spawn(cmd, args, { stdio: 'ignore', detached: true })
  p.on('error', () => {})
  p.unref()
  return { opened: true }
}

// 팀 서버 — 주소 · 번호 흐름
export function makeTeamLogin({ dataDir, timeoutMs = 10 * 60_000 }) {
  let cur = null
  const stop = () => { if (cur) { clearTimeout(cur.timer); try { cur.p.kill() } catch {} cur = null } }
  return {
    get state() { return cur ? (cur.url ? 'code' : 'wait') : null },
    async start() {
      stop()
      const p = launch(['setup-token'], { stdio: ['pipe', 'pipe', 'pipe'] })
      const c = (cur = { p, out: '', url: null, done: null, timer: setTimeout(stop, timeoutMs) })
      p.on('error', () => { if (cur === c) stop() })
      const onData = (d) => { c.out += d; if (!c.url) { const m = c.out.match(URL_RE); if (m) c.url = m[0] } }
      p.stdout.on('data', onData)
      p.stderr.on('data', onData)
      const end = Date.now() + 20_000
      while (!c.url && Date.now() < end && cur === c) await new Promise((r) => setTimeout(r, 100))
      if (!c.url) { stop(); throw new KmdError('E_INPUT', '로그인 주소가 나오지 않았다 — 서버에 Claude Code 가 깔렸나 본다') }
      return { url: c.url }
    },
    async code(code) {
      const c = cur
      if (!c || !c.url) throw new KmdError('E_INPUT', '먼저 로그인을 시작한다')
      code = String(code || '').trim()
      if (!code || code.length > 500 || /[\r\n]/.test(code)) throw new KmdError('E_INPUT', '받은 번호가 아니다')
      const before = c.out.length
      c.p.stdin.write(code + '\n')
      const end = Date.now() + 30_000
      let tok = null
      while (Date.now() < end && cur === c) {
        const m = c.out.slice(before).match(TOKEN_RE)
        if (m) { tok = m[0]; break }
        await new Promise((r) => setTimeout(r, 100))
      }
      stop()
      if (!tok) throw new KmdError('E_INPUT', '로그인을 마치지 못했다 — 번호를 다시 받아 붙여 넣는다')
      await setSecret(dataDir, 'claude-token', tok)
      return { ok: true }
    },
    cancel: stop,
  }
}
