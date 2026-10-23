// Claude 연결 — 정리 · 기록 만들기에 쓰는 Claude Code 로그인.
//
//   이 PC      설정 › Claude 연결 [Claude 로그인] — 「kmd — Claude 로그인」 창에서 `claude auth login`(그 창이 브라우저를 연다 ·
//              이 PC 의 Claude Code 로그인을 새로 받는다 — `claude -p` 가 그것을 쓴다). Claude Code 의 로그인은 진짜 터미널이 있어야 돌아
//              프로그램 안에 넣지 못한다 — 대신 화면이 그 창을 알려 주고 작은 부르기로 저절로 확인한다(core/claude.js checkClaude)
//   팀 서버    관리 › Claude 연결 — 비밀번호 한 번 더 → 서버가 정리 전용 OS 사용자로 `claude setup-token` 을 띄우고 나온
//              주소를 화면에 → 관리자가 그 주소에서 받은 번호를 붙여 넣으면 그 프로세스의 입력으로만 넘긴다(저장 안 함)
//              → 나온 오래 가는 열쇠는 비밀 `claude-token` 으로만(화면 · 로그 · 응답에 0) → 정리 일꾼이 그것으로 돈다
//              setup-token 은 진짜 터미널이 있어야 돌아 `script` 의 가짜 터미널로 띄운다(Linux · macOS) — 못 다는 곳은
//              자기 터미널에서 받은 열쇠를 `kmd secret set claude-token` 으로 넣으라고 알린다
//   시험       KMD_CLAUDE_LOGIN = 가짜 스크립트(node 로 부른다)
// 한 번에 하나 · 10분 지나면 끈다.

import { spawn } from 'node:child_process'
import { setSecret } from './secrets.js'
import { KmdError } from './errors.js'

const URL_RE = /https:\/\/[^\s"'<>]+(?=\s)/g // 뒤에 빈칸이 와야 — 반쯤 받은 주소를 잡지 않게
const TOKEN_RE = /sk-ant-[A-Za-z0-9_-]{20,}/
const ANSI_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g
const NO_TTY = '이 서버에서는 화면 안 로그인을 띄우지 못한다 — 자기 터미널에서 `claude setup-token` 으로 받은 열쇠를 서버에서 `kmd secret set claude-token` 으로 넣는다'

// 터미널 글 → 맨글(색 · 커서 · 링크 표시를 지운다 · ink 는 띄어쓰기를 「오른쪽으로 n 칸」 으로 낸다)
export const plain = (s) => String(s).replace(/\x1b\[(\d*)C/g, (_, n) => ' '.repeat(Math.min(+n || 1, 200))).replace(ANSI_RE, '').replace(/\r/g, '')

// 로그인 주소 — claude.com · claude.ai · anthropic.com 의 것만(ink 오류 안내 같은 다른 주소는 버린다)
export function pickUrl(s) {
  for (const m of plain(s).match(URL_RE) || []) {
    try { if (/(^|\.)(claude\.com|claude\.ai|anthropic\.com)$/.test(new URL(m).hostname)) return m } catch {}
  }
  return null
}

// 진짜 Claude Code 의 setup-token 은 진짜 터미널이 있어야 돈다 — 새 꾸러미 없이 `script` 로 가짜 터미널을 단다(넓게 — 주소 · 열쇠가 줄에서 끊기지 않게)
export function ptyArgs(platform = process.platform) {
  const run = 'stty cols 4000 rows 50 2>/dev/null; exec claude setup-token'
  if (platform === 'linux') return ['script', ['-qfec', run, '/dev/null']]
  if (platform === 'darwin') return ['script', ['-q', '/dev/null', 'sh', '-c', run]]
  return null
}

function launch(args, opt = {}) {
  const fake = process.env.KMD_CLAUDE_LOGIN
  const win = process.platform === 'win32'
  if (fake) return spawn(process.execPath, [fake, ...args], { windowsHide: true, ...opt })
  return spawn(win ? 'claude.cmd' : 'claude', args, { windowsHide: true, shell: win, ...opt })
}

// 이 PC — 보이는 창으로 띄우고 손 뗀다(로그인은 사람이 그 창 · 브라우저에서)
export function pcLogin() {
  if (process.env.KMD_CLAUDE_LOGIN) {
    const p = launch(['auth', 'login'], { stdio: 'ignore', detached: true })
    p.on('error', () => {})
    p.unref()
    return { opened: true }
  }
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', 'kmd — Claude 로그인', 'cmd', '/k', 'claude', 'auth', 'login']] : process.platform === 'darwin' ? ['open', ['-a', 'Terminal', '--args', 'claude', 'auth', 'login']] : ['x-terminal-emulator', ['-e', 'claude auth login']]
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
      const pty = process.env.KMD_CLAUDE_LOGIN ? null : ptyArgs()
      if (!process.env.KMD_CLAUDE_LOGIN && !pty) throw new KmdError('E_INPUT', NO_TTY)
      const p = pty ? spawn(pty[0], pty[1], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TERM: process.env.TERM || 'xterm-256color' } }) : launch(['setup-token'], { stdio: ['pipe', 'pipe', 'pipe'] })
      const c = (cur = { p, pty: !!pty, out: '', url: null, err: null, timer: setTimeout(stop, timeoutMs) })
      p.on('error', (e) => { c.err = e; if (cur === c) stop() })
      p.on('exit', () => { if (cur === c && !c.url) stop() })
      const onData = (d) => { c.out += d; if (!c.url) c.url = pickUrl(c.out) }
      p.stdout.on('data', onData)
      p.stderr.on('data', onData)
      const end = Date.now() + 20_000
      while (!c.url && Date.now() < end && cur === c) await new Promise((r) => setTimeout(r, 100))
      if (!c.url) {
        stop()
        const why = c.err?.code === 'ENOENT' || /raw mode is not supported|not a tty|command not found|not found/i.test(plain(c.out)) ? NO_TTY : '로그인 주소가 나오지 않았다 — 서버에 Claude Code 가 깔렸나 본다 · 안 되면 ' + NO_TTY.split(' — ')[1]
        throw new KmdError('E_INPUT', why)
      }
      // 콘솔 글(열쇠 모양은 지운다) — 화면이 그대로 보여 준다
      return { url: c.url, log: plain(c.out).replace(TOKEN_RE, '(열쇠)').slice(-2000) }
    },
    async code(code) {
      const c = cur
      if (!c || !c.url) throw new KmdError('E_INPUT', '먼저 로그인을 시작한다')
      code = String(code || '').trim()
      if (!code || code.length > 500 || /[\r\n]/.test(code)) throw new KmdError('E_INPUT', '받은 번호가 아니다')
      const before = c.out.length
      c.p.stdin.write(code + (c.pty ? '\r' : '\n')) // 가짜 터미널의 Enter 는 \r
      const end = Date.now() + 30_000
      let tok = null
      while (Date.now() < end && cur === c) {
        const m = plain(c.out.slice(before)).match(TOKEN_RE)
        if (m) { tok = m[0]; break }
        await new Promise((r) => setTimeout(r, 100))
      }
      stop()
      if (!tok) throw new KmdError('E_INPUT', '로그인을 마치지 못했다 — 번호를 다시 받아 붙여 넣는다')
      await setSecret(dataDir, 'claude-token', tok)
      return { ok: true, token: tok }
    },
    cancel: stop,
  }
}
