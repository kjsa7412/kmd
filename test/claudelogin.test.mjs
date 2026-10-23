// 팀 서버의 정리 전용 로그인 — 터미널 글에서 로그인 주소를 바로 고르는지 · 가짜 터미널을 다는 길
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-claudelogin-'))
process.env.HOME = tmp
process.env.APPDATA = tmp
const { plain, pickUrl, ptyArgs, makeTeamLogin } = await import('../core/claudelogin.js')

const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c&response_type=code&state=ab4u'

test('색 · 커서 글을 지우고 로그인 주소만 — ink 의 띄어쓰기(오른쪽 n 칸)도 빈칸으로', () => {
  const tty = '\x1b[?25l\x1b[38;5;174mWelcome\x1b[1Cto\x1b[1CClaude\x1b[39m\r\r\n Browser\x1b[1Cdidn\'t\x1b[1Copen?\r\r\n\r\r\n\x1b[38;5;153m' + URL + '\x1b[39m\r\r\n\r\r\n Paste\x1b[1Ccode\x1b[1Chere\x1b[1Cif\x1b[1Cprompted\x1b[1C>\x1b[?25h'
  assert.equal(pickUrl(tty), URL)
  assert.match(plain(tty), /Welcome to Claude/)
  assert.ok(!plain(tty).includes('\x1b'))
  // 링크 표시(OSC 8)로 감싸도
  assert.equal(pickUrl(`\x1b]8;;${URL}\x07${URL}\x1b]8;;\x07\n`), URL)
  assert.equal(pickUrl(`https://claude.ai/oauth/authorize?x=1\n`), 'https://claude.ai/oauth/authorize?x=1')
  assert.equal(pickUrl(`https://console.anthropic.com/oauth?x=1\n`), 'https://console.anthropic.com/oauth?x=1')
})

test('claude.com · claude.ai · anthropic.com 이 아닌 주소는 버린다 — 터미널 없음의 ink 안내 · 반쯤 받은 주소', () => {
  const ink = 'ERROR Raw mode is not supported on the current process.stdin, which Ink uses as input stream by default.\nRead about how to prevent this error on https://github.com/vadimdemedes/ink/#israwmodesupported\n'
  assert.equal(pickUrl(ink), null)
  assert.equal(pickUrl('https://evilclaude.ai/x\nhttps://claude.ai.evil.com/y\n'), null)
  assert.equal(pickUrl(ink + URL + '\n'), URL, '앞에 다른 주소가 있어도 맞는 것을 고른다')
  assert.equal(pickUrl(URL.slice(0, 40)), null, '아직 끝나지 않은 주소')
})

test('가짜 터미널 — Linux · macOS 는 script 로 · 다른 곳은 없다', () => {
  const [lc, la] = ptyArgs('linux')
  assert.equal(lc, 'script')
  assert.deepEqual([la[0], la.at(-1)], ['-qfec', '/dev/null'])
  assert.match(la[1], /stty cols \d+.*exec claude setup-token/)
  const [mc, ma] = ptyArgs('darwin')
  assert.equal(mc, 'script')
  assert.deepEqual(ma.slice(0, 4), ['-q', '/dev/null', 'sh', '-c'])
  assert.equal(ptyArgs('win32'), null)
})

test('가짜 터미널을 못 다는 서버 — 자기 터미널에서 받은 열쇠를 kmd secret set 으로 넣으라고', { skip: process.platform !== 'win32' }, async () => {
  const fake = process.env.KMD_CLAUDE_LOGIN
  delete process.env.KMD_CLAUDE_LOGIN
  try {
    await assert.rejects(makeTeamLogin({ dataDir: tmp }).start(), /kmd secret set claude-token/)
  } finally { if (fake) process.env.KMD_CLAUDE_LOGIN = fake }
})
