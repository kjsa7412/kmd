// Claude 연결 — 정리 · 기록 만들기에 쓰는 Claude Code 로그인.
//
//   이 PC      설정 › Claude 연결 [Claude 로그인] — 「kmd — Claude 로그인」 창에서 `claude auth login`(그 창이 브라우저를 연다 ·
//              이 PC 의 Claude Code 로그인을 새로 받는다 — `claude -p` 가 그것을 쓴다). Claude Code 의 로그인은 진짜 터미널이 있어야 돌아
//              프로그램 안에 넣지 못한다 — 대신 화면이 그 창을 알려 주고 작은 부르기로 저절로 확인한다(core/claude.js checkClaude)
//   팀 서버    관리 › Claude 연결 — 비밀번호 한 번 더 → 서버 PC 에 화면이 있으면(Windows · macOS · 화면 있는 Linux) 이 PC 와 같은
//              「kmd — Claude 로그인」 창 → 그 PC 의 Claude Code 로그인을 정리 일꾼이 쓴다 · 화면이 작은 부르기로 확인
//              화면 없는 서버(헤드리스 Linux)만 — 서버가 정리 전용 OS 사용자로 `claude setup-token` 을 띄우고 나온
//              주소를 화면에 → 관리자가 그 주소에서 받은 번호를 붙여 넣으면 그 프로세스의 입력으로만 넘긴다(저장 안 함)
//              → 나온 오래 가는 열쇠는 비밀 `claude-token` 으로만(화면 · 로그 · 응답에 0) → 정리 일꾼이 그것으로 돈다
//              setup-token 은 진짜 터미널이 있어야 돌아 `script` 의 가짜 터미널로 띄운다(Linux · macOS) — 못 다는 곳은
//              자기 터미널에서 받은 열쇠를 `kmd secret set claude-token` 으로 넣으라고 알린다
//   시험       KMD_CLAUDE_LOGIN = 가짜 스크립트(node 로 부른다)
// 한 번에 하나 · 20분 지나면 끈다(메일 링크로 들어가는 로그인이 10분을 넘기기 쉽다).

import { spawn } from 'node:child_process'
import { setSecret } from './secrets.js'
import { KmdError } from './errors.js'

const URL_RE = /https:\/\/[^\s"'<>]+(?=\s)/g // 뒤에 빈칸이 와야 — 반쯤 받은 주소를 잡지 않게
const TOKEN_RE = /sk-ant-[A-Za-z0-9_-]{20,}/
// 색 · 커서 · 링크 · 글자판 고르기(ESC ( B) · 그 밖의 제어 글자(SI 등 — 서버 기록이 바이너리로 보이지 않게)
const ANSI_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()*+][0-9A-Za-z]|\x1b[@-Z\\-_]|[\x00-\x08\x0b-\x1f\x7f]/g
const NO_TTY = '서버에서 Claude 로그인 창을 띄울 수 없다. 자기 터미널에서 `claude setup-token` 으로 받은 열쇠를 서버에서 `kmd secret set claude-token` 으로 넣는다'

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

// 팀 서버의 로그인 길 — 'window'(화면 있는 PC · 보이는 창) · 'pty'(헤드리스 · 주소 + 번호) · 'none'(셸 한 줄 안내)
// KMD_TEAM_LOGIN 으로 정할 수 있다(시험 · 화면은 있으나 서비스로 도는 서버)
export function teamLoginKind(platform = process.platform, env = process.env) {
  if (['window', 'pty', 'none'].includes(env.KMD_TEAM_LOGIN)) return env.KMD_TEAM_LOGIN
  if (platform === 'win32' || platform === 'darwin' || env.DISPLAY || env.WAYLAND_DISPLAY) return 'window'
  return ptyArgs(platform) ? 'pty' : 'none'
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
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', 'kmd: Claude 로그인', 'cmd', '/k', 'claude', 'auth', 'login']] : process.platform === 'darwin' ? ['open', ['-a', 'Terminal', '--args', 'claude', 'auth', 'login']] : ['x-terminal-emulator', ['-e', 'claude auth login']]
  const p = spawn(cmd, args, { stdio: 'ignore', detached: true })
  p.on('error', () => {})
  p.unref()
  return { opened: true }
}

// 팀 서버 — 화면 있는 PC 는 보이는 창 · 헤드리스는 주소 · 번호 흐름
// 기다리는 시간 — 메일 링크로 들어가는 Claude 로그인은 10분을 넘기기 쉽다
export function makeTeamLogin({ dataDir, timeoutMs = 20 * 60_000 }) {
  let cur = null
  const stop = () => { if (cur) { clearTimeout(cur.timer); try { cur.p?.kill() } catch {} cur = null } }
  return {
    get kind() { return teamLoginKind() },
    get state() { return cur ? (cur.window ? 'window' : cur.url ? 'code' : 'wait') : null },
    async start() {
      stop()
      const kind = teamLoginKind()
      if (kind === 'none') throw new KmdError('E_INPUT', NO_TTY)
      if (kind === 'window') {
        pcLogin()
        cur = { window: true, timer: setTimeout(stop, timeoutMs) }
        return { window: true }
      }
      const pty = process.env.KMD_CLAUDE_LOGIN ? null : ptyArgs()
      if (!process.env.KMD_CLAUDE_LOGIN && !pty) throw new KmdError('E_INPUT', NO_TTY)
      // script 는 $SHELL 로 돈다 — 서비스 사용자(kmd)의 셸은 nologin 이라 sh 로 못 박는다
      const p = pty ? spawn(pty[0], pty[1], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, SHELL: '/bin/sh', TERM: process.env.TERM || 'xterm-256color' } }) : launch(['setup-token'], { stdio: ['pipe', 'pipe', 'pipe'] })
      const c = (cur = { p, pty: !!pty, out: '', from: 0, url: null, err: null, timer: setTimeout(stop, timeoutMs) })
      p.on('error', (e) => { c.err = e; if (cur === c) stop() })
      p.on('exit', () => { if (cur === c && !c.url) stop() })
      // 주소는 from 뒤에서만 — 다시 받을 때 옛 주소를 집지 않게
      const onData = (d) => { c.out += d; if (!c.url) c.url = pickUrl(c.out.slice(c.from)) }
      p.stdout.on('data', onData)
      p.stderr.on('data', onData)
      const end = Date.now() + 20_000
      while (!c.url && Date.now() < end && cur === c) await new Promise((r) => setTimeout(r, 100))
      if (!c.url) {
        stop()
        // 오류 글의 주소는 집지 않는다 — 쉬운 말로만
        const why = c.err?.code === 'ENOENT' || /raw mode is not supported|not a tty|not found/i.test(plain(c.out)) ? NO_TTY : '서버에서 Claude 로그인 창을 띄울 수 없다. 로그인 주소가 나오지 않았다(서버에 Claude Code 가 깔렸나 본다) · 안 되면 ' + NO_TTY.split(/ — |: /)[1]
        throw new KmdError('E_INPUT', why)
      }
      // 콘솔 글(열쇠 모양은 지운다) — 화면이 그대로 보여 준다
      return { url: c.url, log: plain(c.out).replace(TOKEN_RE, '(열쇠)').slice(-2000) }
    },
    async code(code) {
      const c = cur
      // 기다리던 로그인이 없다 — 20분이 지났거나 · 팀 서버가 다시 켜졌거나 · 다른 관리자가 새로 시작했다. 그 주소의 번호는 더 쓰지 못한다
      if (!c || !c.url) throw new KmdError('E_INPUT', '기다리던 로그인이 끝났다(20분이 지났거나 팀 서버가 다시 켜졌다). 그 번호는 더 쓰지 못한다. [다시 시작] 으로 새 주소를 받는다', { need: 'restart' })
      code = String(code || '').trim()
      if (!code || code.length > 500 || /[\r\n]/.test(code)) throw new KmdError('E_INPUT', '받은 번호가 아니다')
      const enter = c.pty ? '\r' : '\n' // 가짜 터미널의 Enter 는 \r
      const before = c.out.length
      // 번호와 Enter 를 따로 — 한 덩이로 보내면 setup-token(ink)이 긴 글을 붙여 넣기로 받아 Enter 를 삼킨다(실제 번호 92자에서 그랬다)
      c.p.stdin.write(code)
      await new Promise((r) => setTimeout(r, 400))
      const sent = c.out.length
      c.p.stdin.write(enter)
      // 열쇠가 나오거나 · Claude 가 번호를 받지 않았다고 하거나(OAuth error … · Press Enter to retry) · 30초
      const end = Date.now() + 30_000
      let tok = null, err = null, again = Date.now() + 5000
      while (Date.now() < end && cur === c) {
        // Enter 뒤 5초 동안 아무 글도 없으면 한 번 더 누른다(아직 붙여 넣기로 받는 중이었다)
        if (again && Date.now() > again) { again = 0; if (c.out.length === sent) c.p.stdin.write(enter) }
        const t = plain(c.out.slice(before))
        const m = t.match(TOKEN_RE)
        if (m) { tok = m[0]; break }
        // 터미널 다시 그리기로 글자가 빠지거나 붙는다(Requstfailed withstatus …) — 상태 번호가 있으면 그것만 짧게
        const e = t.match(/((?:OAuth\s*)?error:?[^\n]*?)\s*(?:Press\s*Enter|\n|$)/i)
        if (e && /retry|\n/i.test(t.slice(e.index))) {
          const st = e[1].match(/status\s*code\s*(\d{3})/i)
          err = st ? `${/oauth/i.test(e[1]) ? 'OAuth ' : ''}error ${st[1]}` : e[1].replace(/\s+/g, ' ').trim().slice(0, 160)
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      if (tok) {
        stop()
        await setSecret(dataDir, 'claude-token', tok)
        return { ok: true, token: tok }
      }
      if (err && cur === c) {
        // Claude 가 번호를 받지 않았다(옛 주소의 번호 · 이미 쓴 번호 · 시간이 지난 번호) — Enter 로 새 주소를 받아 같은 로그인을 잇는다
        console.log(`정리 로그인: Claude 가 번호를 받지 않았다: ${err} · 새 주소를 받는다`)
        c.from = c.out.length
        c.url = null
        c.p.stdin.write(enter)
        const end2 = Date.now() + 20_000
        while (!c.url && Date.now() < end2 && cur === c) await new Promise((r) => setTimeout(r, 100))
        if (c.url) {
          clearTimeout(c.timer)
          c.timer = setTimeout(stop, timeoutMs)
          return { ok: false, again: true, url: c.url, why: err }
        }
      }
      const last = plain(c.out.slice(before)).split('\n').map((x) => x.trim()).filter(Boolean).pop() || ''
      console.log(`정리 로그인: 마치지 못했다: ${err || last.replace(TOKEN_RE, '(열쇠)').slice(0, 160)}`)
      stop()
      throw new KmdError('E_INPUT', `로그인을 마치지 못했다${err ? `: Claude 가 번호를 받지 않았다(${err})` : ''}. [다시 시작] 으로 새 주소를 받는다`, { need: 'restart' })
    },
    cancel: stop,
  }
}
