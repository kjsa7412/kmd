// HTTP 서버 — 화면(app/) · 화면 자료(/api) · MCP(/mcp) · 들어가기 · 살아 있나(/healthz) 를 한 포트로.
//
// 누구인가 — 요청마다 한 번: Bearer 열쇠(기기 kmdk_ · 기계 kmdm_ · 예전 열쇠) 또는 서명 쿠키(화면).
// 들어오지 않은 요청이 받는 것은 화면 파일 · /healthz · /api/me · 들어가기 길뿐이다. 기계 열쇠는 그 지식의
// 기준선 길 하나만. 사람 관리(더하기 · 다시 정하기 · 풀기 · 기기 모두 끊기)는 관리자 + 재인증(15분).
// 쓰는 요청(POST)은 같은 화면(Origin)이나 Origin 없는 프로그램만 받는다.

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { KmdError, httpStatusOf } from '../core/errors.js'
import { makeAuth } from '../core/auth.js'
import { makeMcp } from './mcp.js'
import { makeHub, defaultDataDir } from './hub.js'
import { VERSION } from './version.js'
import * as V from './views.js'
import * as kit from '../core/kit.js'
import * as sendLib from '../core/send.js'
import { watchedOf } from '../core/watchmark.js'
import { pcLogin, makeTeamLogin } from '../core/claudelogin.js'
import { checkClaude } from '../core/claude.js'
import { getSecret, delSecret } from '../core/secrets.js'
import { safeOrigin } from '../core/claudecfg.js'
import { get as kget, keyName } from '../core/keystore.js'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import MarkdownIt from 'markdown-it'

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.json': 'application/json' }
const MAX_BODY = 2 << 20

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  res.writeHead(status, { 'content-type': type, 'content-length': buf.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra })
  res.end(buf)
}

function sameOrigin(req) {
  try {
    return new URL(req.headers.origin).host === req.headers.host
  } catch {
    return false
  }
}

function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const parts = []
    let n = 0
    req.on('data', (c) => {
      n += c.length
      if (n > max) {
        reject(new KmdError('E_INPUT', '보낸 글이 너무 크다'))
        req.destroy()
      } else parts.push(c)
    })
    req.on('end', () => {
      try {
        resolve(n ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {})
      } catch {
        reject(new KmdError('E_INPUT', 'JSON 모양이 아니다'))
      }
    })
    req.on('error', reject)
  })
}

// 설명서 — 저장소 · 꾸러미의 docs/ 를 화면 밖 한 장으로(들어오지 않아도 본다 · 비밀이 아니다)
const DOCS = path.join(APP, '..', 'docs')
const MANUALS = [
  { slug: '사용자', file: '설명서_사용자.md', title: '쓰는 사람', modes: ['team', 'pc'] },
  { slug: '정리하는사람', file: '설명서_정리하는사람.md', title: '정리하는 사람', modes: ['team'] },
  { slug: '관리자', file: '설명서_관리자.md', title: '관리자', modes: ['team'] },
  { slug: '운영', file: 'kmd_운영.md', title: '운영 · 되살리기', modes: ['team', 'pc'] },
]
const manualMd = new MarkdownIt({ html: false, linkify: true })
async function manualPage(mode, slug) {
  const list = MANUALS.filter((m) => m.modes.includes(mode))
  const m = list.find((x) => x.slug === slug) || (slug ? null : list[0])
  if (!m) return null
  const src = await fs.readFile(path.join(DOCS, m.file), 'utf8').catch(() => null)
  if (src == null) return null
  // 설명서끼리의 링크는 /manual/… 로 · 꾸러미에 없는 문서 링크는 글만
  const body = src.replace(/\[([^\]]+)\]\(([^)#\s]+\.md)(#[^)\s]*)?\)/g, (_, t, f, h) => { const x = MANUALS.find((y) => y.file === f); return x ? `[${t}](/manual/${encodeURIComponent(x.slug)}${h || ''})` : t })
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])
  const nav = list.map((x) => (x === m ? `<b>${esc(x.title)}</b>` : `<a href="/manual/${encodeURIComponent(x.slug)}">${esc(x.title)}</a>`)).join(' · ')
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>kmd 설명서: ${esc(m.title)}</title>
<style>body{font:14px/1.65 system-ui,-apple-system,'Malgun Gothic',sans-serif;margin:0;background:#f6f7f9;color:#1d232b}main{max-width:820px;margin:0 auto;padding:22px 16px 60px;background:#fff;min-height:100vh;box-sizing:border-box}nav{font-size:13px;color:#5b6573;margin-bottom:18px;padding-bottom:10px;border-bottom:1px solid #e3e6ea}a{color:#2f6fd6}h1{font-size:20px}h2{font-size:16px;margin-top:26px}table{border-collapse:collapse;width:100%;font-size:13px;display:block;overflow-x:auto}th,td{border:1px solid #e3e6ea;padding:5px 8px;text-align:left;vertical-align:top}code{background:#f1f3f5;padding:1px 4px;border-radius:4px;font-size:12.5px}pre{background:#f1f3f5;padding:10px;border-radius:7px;overflow-x:auto;white-space:pre-wrap}</style>
<main><nav>kmd 설명서: ${nav}</nav>${manualMd.render(body)}</main></html>`
}

// 설치 한 줄의 PowerShell 본문 — kmd 가 있으면 잇기만 · 없으면 받기 → 풀기(<집>/versions/<판>) → 실행기 · 사용자 PATH → 잇기.
// 시험은 KMD_APP_HOME(집) · KMD_NO_PATH(사용자 PATH 를 건드리지 않는다)로 이 PC 를 바꾸지 않고 돌린다
// kn — 설치 한 줄을 붙여 넣은 작업 폴더를 그 팀 지식에 붙인다(에이전트 설치 · 팀)
export const safeKn = (kn) => (/^[^\s'"`$\\;|&<>(){}]{1,80}$/u.test(String(kn || '')) ? String(kn) : null)
export function installPs({ origin, ticket, pkg, kn = null }) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'"
  const L = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$o = ${q(origin)}; $t = ${q(ticket)}`,
    '$k = Get-Command kmd -ErrorAction SilentlyContinue',
  ]
  if (!pkg) {
    L.push(`if ($k) { $k = $k.Source } else { Write-Host ${q(`· kmd 가 이 PC 에 없고 팀 서버에도 PC 꾸러미가 없다. 관리자에게 「PC 꾸러미를 받기 자리에 둔다」 를 부탁한 뒤 이 줄을 다시 붙여 넣는다 · ${origin}/dl`)} }`)
  } else {
    L.push(
      'if ($k) { $k = $k.Source } else {',
      `  $v = ${q(pkg.ver)}; $n = ${q(pkg.name)}`,
      "  $a = if ($env:KMD_APP_HOME) { $env:KMD_APP_HOME } else { Join-Path $env:USERPROFILE '.kmd-app' }",
      // 이미 깐 kmd(실행기)가 있으면 그것을 쓴다 — PATH 를 아직 모르는 창에서 다시 붙여도 더 새 판을 옛 판으로 되돌리지 않는다(새 판은 kmd pc update)
      "  $e = Join-Path $a 'bin\\kmd.cmd'",
      "  if (Test-Path $e) { $k = $e; $env:Path = \"$(Split-Path $e);$env:Path\"; Write-Host '· 이 PC 에 이미 깐 kmd 를 쓴다. 새 판은 kmd pc update' } else {",
      '  $d = Join-Path $a "versions\\$v"',
      "  if (-not (Test-Path (Join-Path $d 'server\\bin\\kmd.mjs'))) {",
      '    Write-Host "kmd $v 을 받는다. $o/dl"',
      '    $z = Join-Path $env:TEMP $n',
      '    Invoke-WebRequest "$o/dl/$n" -OutFile $z -UseBasicParsing',
      // 판 폴더에 바로 푼다(zip 안의 kmd-<판>-pc 폴더 한 겹을 걷는다) — 막 푼 폴더를 옮기면 백신 검사가 잡고 있어 「액세스 거부」 일 때가 있다.
      // Windows 10 1803 부터 있는 tar 가 빨리 푼다 — 없거나 실패하면 Expand-Archive 로 풀어 복사한다
      '    if (Test-Path $d) { Remove-Item $d -Recurse -Force }',
      '    New-Item -ItemType Directory -Force $d | Out-Null',
      "    $tar = Join-Path $env:SystemRoot 'System32\\tar.exe'",
      '    $ok = $false',
      '    if (Test-Path $tar) { & $tar -xf $z -C $d --strip-components 1; $ok = ($LASTEXITCODE -eq 0) }',
      '    if (-not $ok) {',
      '      $x = Join-Path $env:TEMP "kmd-unz-$v"',
      '      if (Test-Path $x) { Remove-Item $x -Recurse -Force }',
      '      Expand-Archive $z $x -Force',
      '      $i = Get-ChildItem $x -Directory | Select-Object -First 1',
      "      Copy-Item (Join-Path $i.FullName '*') $d -Recurse -Force",
      '      Remove-Item $x -Recurse -Force -ErrorAction SilentlyContinue',
      '    }',
      '    Remove-Item $z -Force -ErrorAction SilentlyContinue',
      '  }',
      "  & (Join-Path $d 'kmd.cmd') pc link $v",
      "  if ($LASTEXITCODE) { throw 'kmd 실행기를 세우지 못했다' }",
      "  $b = Join-Path $a 'bin'",
      // 사용자 PATH — 원문(%변수% 그대로)과 종류(REG_EXPAND_SZ)를 지켜 끝에 더한다 · 바뀜 알림은 없는 변수를 지우는 부르기로 보낸다
      '  if (-not $env:KMD_NO_PATH) {',
      "    $r = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')",
      "    $p = [string]$r.GetValue('Path', '', 'DoNotExpandEnvironmentNames')",
      "    if (-not (($p -split ';') -contains $b)) { $r.SetValue('Path', ((@($p.TrimEnd(';'), $b) | Where-Object { $_ }) -join ';'), 'ExpandString'); [Environment]::SetEnvironmentVariable('KMD_PATH_SET', $null, 'User') }",
      '    $r.Close()',
      '  }',
      '  $env:Path = "$b;$env:Path"',
      "  $k = Join-Path $b 'kmd.cmd'",
      '  Write-Host "✓ kmd $v 을 깔았다. $d · 새로 여는 터미널부터 kmd 명령이 선다"',
      '  }',
      '}',
    )
  }
  L.push(`if ($k) { & $k connect $o --ticket $t${kn ? ' --kn ' + q(kn) : ''} }`, '')
  return L.join('\r\n')
}

export async function startServer({ root, data = null, mode = 'team', user = os.userInfo().username, host = '127.0.0.1', port = 7373, log, scryptN = null, onStop = null, deviceKey = (origin) => kget(keyName(origin)) }) {
  const dataDir = data || defaultDataDir(root)
  const pcUser = mode === 'pc' ? String(user).toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'me' : null
  const hub = await makeHub({ root, dataDir, mode, pcUser, log })
  const auth = await makeAuth({ dataDir, mode, scryptN: scryptN || hub.config.scryptN || null })
  hub.admins = () => auth.users().filter((u) => u.admin && !u.off && u.kind !== 'worker').map((u) => u.id)
  const mcp = makeMcp(hub)
  if (pcUser) await auth.ensurePc(pcUser)
  const teamLogin = makeTeamLogin({ dataDir })
  // 받기 자리의 PC 꾸러미 — kmd-<판>-pc.zip · 이 서버와 같은 판을 먼저, 없으면 가장 높은 판
  const dlDir = () => path.resolve(hub.config.dl || path.join(dataDir, 'dl'))
  const pcPackage = async () => {
    const all = (await fs.readdir(dlDir()).catch(() => [])).map((n) => [n, n.match(/^kmd-([0-9A-Za-z._-]{1,40})-pc\.zip$/i)]).filter(([, m]) => m).map(([name, m]) => ({ name, ver: m[1] }))
    return all.find((x) => x.ver === VERSION) || all.sort((a, b) => b.ver.localeCompare(a.ver, undefined, { numeric: true }))[0] || null
  }
  // 이 PC — 프로그램 안에서 받은 Claude 로그인(비밀 claude-token)을 이 프로그램이 부르는 Claude 에만
  if (mode === 'pc') getSecret(dataDir, 'claude-token').then((t) => { if (t) process.env.CLAUDE_CODE_OAUTH_TOKEN = t }, () => {})

  // ── 팀 화면 ↔ 내 PC(E8 · v0.5 §5 · v0.6 ⑫) — PC 프로그램만 ──
  // 설치(kmd connect)가 적은 팀 주소(<data>/teams.json)의 화면이 물으면 Origin 을 대조해 12시간 짝 열쇠(kmdp_)를 응답으로
  // 준다(누름 없음 · 화면은 탭 메모리에만 · 여기는 해시만). 적히지 않은 주소는 이 PC 화면의 [허락] 한 번.
  // 짝 열쇠 · CORS 는 그 출처의 읽기 · save 길에만 — 가져오는 곳 · 넣기 권한 · 보내지 않음 끄기 · 백업 주소 · 설정 · 관리 · /mcp 는 403.
  const pairs = new Map()
  // 팀 화면이 부를 내 PC 프로그램 주소(serve.json pcUrl · 기본 이 PC 의 7373) — CSP connect-src 에 이 하나만
  const pcUrl = (() => { try { return new URL(hub.config.pcUrl || 'http://127.0.0.1:7373').origin } catch { return 'http://127.0.0.1:7373' } })()
  const PAIR_MS = 12 * 3600_000
  const teamsFile = path.join(dataDir, 'teams.json')
  const teamsOf = async () => (await fs.readFile(teamsFile, 'utf8').then(JSON.parse, () => [])).map((u) => { try { return new URL(u).origin } catch { return null } }).filter(Boolean)
  // 팀 화면에서 내 PC 지식 — 읽기 · 저장 · 새 지식(이름 · 내 PC 폴더 경로). 같은 사람인지 짝을 지을 때 대조했다
  const CORS_OK = [/^GET \/api\/knowledge$/, /^GET \/api\/(me|agent)$/, /^POST \/api\/knowledge\/(add|fromteam)$/,/^GET \/api\/k\/[^/]+\/(tree|doc|rec|att|model|item)$/, /^POST \/api\/k\/[^/]+\/(save|edit|send|send\/route|send\/wait)$/, /^GET \/api\/k\/[^/]+\/send$/]
  const pairSha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex')
  const issuePair = (origin) => {
    const token = 'kmdp_' + crypto.randomBytes(24).toString('base64url')
    pairs.set(pairSha(token), { origin, exp: Date.now() + PAIR_MS })
    return { token, user: pcUser, exp: Date.now() + PAIR_MS }
  }
  // 다른 출처에서 온 요청 — 짝 지은 팀 화면이면 { ctx } · 아니면 throw · 같은 출처면 null
  async function crossOrigin(req, res, p) {
    const origin = req.headers.origin
    if (mode !== 'pc' || !origin || sameOrigin(req)) return null
    if (p === '/healthz') { res.setHeader('access-control-allow-origin', '*'); return { open: true } }
    const known = (await teamsOf()).includes(origin)
    if (!known) throw new KmdError('E_FORBIDDEN', '이 팀 화면은 이 PC 에 이어지지 않았다. 그 팀 화면 › 설치 한 줄(kmd connect)로 잇는다', { need: 'connect' })
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'Origin')
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-private-network': 'true', 'access-control-max-age': '600' })
      res.end()
      return { done: true }
    }
    if (p === '/pair' && req.method === 'POST') return { pair: true, origin }
    if (!CORS_OK.some((re) => re.test(`${req.method} ${p}`))) throw new KmdError('E_FORBIDDEN', '팀 화면에서는 읽기 · 저장만: 이 일은 이 PC 화면에서 한다')
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(kmdp_\S+)$/)
    const pr = m && pairs.get(pairSha(m[1]))
    if (!pr || pr.exp < Date.now() || pr.origin !== origin) throw new KmdError('E_AUTH', '짝 열쇠가 끝났다. 화면을 다시 연다')
    return { ctx: { user: pcUser, admin: true, pc: true, pair: true, origin } }
  }
  // 짝 — 팀 화면에 들어온 사람이 이 PC 의 사람인가. 팀 화면이 팀 서버에서 받은 한 번용 표(kmdq_)를 이 PC 의 기기 열쇠로 그 팀 서버에
  // 물어 대조한다(기기 열쇠의 사람 = 표를 받은 사람). 남이 내 PC 브라우저로 팀에 들어오거나 · 같은 기계의 다른 OS 사용자 ·
  // Origin 을 꾸민 프로세스는 짝 열쇠를 받지 못한다
  async function pairWith(origin, b) {
    const dk = await Promise.resolve(deviceKey(origin)).catch(() => null)
    if (!dk) throw new KmdError('E_FORBIDDEN', '이 PC 는 이 팀에 이어지지 않았다. 그 팀 화면 › 설치 한 줄(kmd connect)로 잇는다', { need: 'connect' })
    const pass = String(b?.pass || '')
    if (!/^kmdq_[A-Za-z0-9_-]{20,80}$/.test(pass)) throw new KmdError('E_INPUT', '팀 서버의 표가 없다. 팀 화면을 새로 고친다')
    const r = await fetch(origin + '/api/me/pcpass/check', { method: 'POST', headers: { authorization: 'Bearer ' + dk, 'content-type': 'application/json' }, body: JSON.stringify({ pass }), signal: AbortSignal.timeout(10_000) }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r || !r.ok) throw new KmdError('E_FORBIDDEN', '팀 서버가 이 PC 의 열쇠를 받지 않았다. 끊겼으면 팀 화면 › 설치 한 줄로 다시 잇는다', { need: 'connect' })
    if (!j.same) throw new KmdError('E_FORBIDDEN', '이 PC 의 kmd 는 다른 사람의 것이다. 내 PC 지식은 이 PC 를 이은 사람이 들어왔을 때만 열린다', { need: 'person' })
    return issuePair(origin)
  }
  // 팀 서버 쪽 — 한 번용 표(1분)
  const pcPasses = new Map()

  const ipOf = (req) => (hub.config.trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress)

  // 누구인가 → { ctx, set } · 열쇠가 틀리면 E_AUTH(물러서지 않는다)
  function who(req) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)
    if (m) {
      // 초안 전용 단기 열쇠(kmdd_) — 그 일감 · 그 지식의 재료 · 초안 길만
      // 에이전트 단기 열쇠(kmda_) — 그 지식 · 그 일의 MCP 길만(요구 v0.2 R8)
      if (m[1].startsWith('kmda_')) {
        const actx = hub.agentCtx(m[1])
        if (!actx) throw new KmdError('E_AUTH', '이 일의 열쇠가 끝났다')
        return { ctx: actx }
      }
      if (m[1].startsWith('kmdd_')) {
        const dctx = hub.draftCtx(m[1])
        if (!dctx) throw new KmdError('E_AUTH', '이 일감의 열쇠가 끝났다')
        return { ctx: dctx }
      }
      const ctx = auth.bearer(m[1])
      if (!ctx) throw new KmdError('E_AUTH', '열쇠가 맞지 않는다. 끊겼거나 90일 동안 쓰지 않았다. 팀 화면 › 설치 한 줄을 다시 붙여 넣는다')
      return { ctx }
    }
    const s = auth.session(req.headers.cookie)
    return s || { ctx: null }
  }
  const need = (ctx) => {
    if (!ctx) throw new KmdError('E_AUTH', '들어온 뒤 쓴다')
    if (ctx.machine) throw new KmdError('E_FORBIDDEN', '기계 열쇠는 저절로 채우는 표의 길만 쓴다', { need: 'person' })
    if (ctx.draft || ctx.worker) throw new KmdError('E_FORBIDDEN', '정리 일꾼은 초안만 올린다', { need: 'person' })
    return ctx
  }
  const admin = (ctx, { sudo = true } = {}) => {
    need(ctx)
    if (!ctx.admin) throw new KmdError('E_FORBIDDEN', '관리자만 한다')
    if (sudo && !ctx.sudo && !ctx.pc) throw new KmdError('E_SUDO', '비밀번호를 한 번 더 넣는다(15분)')
    return ctx
  }

  // ── 들어가기 길 — 들어오지 않아도 받는다 ──
  const gate = async (req, res, p) => {
    const ip = ipOf(req)
    const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map((x) => x.trim().split('=')).filter((x) => x[0]))
    const b = await readBody(req)
    if (p === '/login') {
      if (b.token) return send(res, 200, await auth.loginLegacy({ token: b.token, ip }))
      const r = await auth.login({ user: b.user, pw: b.pw, ip, cookies })
      return send(res, 200, { user: r.user, notice: r.notice }, undefined, { 'set-cookie': r.cookies })
    }
    if (p === '/logout') return send(res, 200, { ok: true }, undefined, { 'set-cookie': auth.logoutCookie() })
    if (p === '/first') {
      if (b.check) return send(res, 200, { user: auth.firstUser(b.code) })
      const r = await auth.first({ code: b.code, pw: b.pw })
      return send(res, 200, { user: r.user }, undefined, { 'set-cookie': r.cookies })
    }
    if (p === '/setup') {
      const r = await auth.setup({ code: b.code, name: b.name, pw: b.pw })
      return send(res, 200, { user: r.user }, undefined, { 'set-cookie': r.cookie })
    }
    if (p === '/once') return send(res, 200, { ok: true }, undefined, { 'set-cookie': auth.takeOnce(b.code) })
    if (p === '/device/keys') {
      const r = await auth.deviceKey({ ticket: b.ticket, user: b.user, pw: b.pw, host: b.host, osuser: b.osuser, ip })
      hub.notifyDevice?.(r.user, r.device)
      return send(res, 200, { key: r.key, user: r.user })
    }
    throw new KmdError('E_NOTFOUND', '그런 길은 없다')
  }

  const GET_OK = [
    /^\/api\/(me|today|history|people|logs|sources|settings|agent|knowledge|runs|stops|find|requests|me\/devices|admin\/overview|admin\/users|claude\/state|busy)$/,
    /^\/api\/job\/[0-9a-f]+$/, /^\/api\/runs\/[0-9a-f]{12}$/, /^\/api\/queue$/, /^\/api\/queue\/[0-9a-f]{12}$/,
    /^\/api\/k\/[^/]+\/(tree|doc|rec|att|model|item|diff|tidy|sources|send|backup|backup\/lost|owner|worker\/material|bundle)$/,
  ]
  const api = async (req, res, url, ctx, set) => {
    const p = url.pathname
    const out = (status, body) => send(res, status, body, undefined, set ? { 'set-cookie': set } : {})
    // 읽기 길만 GET — 그 밖은 모두 POST(글 속 그림 한 줄 ![](/api/…) 이 연 사람의 쿠키로 나가기 · 비밀번호 지우기 · 관리자 해제를 부르지 않게)
    if (req.method !== 'POST' && !(['GET', 'HEAD'].includes(req.method) && GET_OK.some((re) => re.test(p)))) throw new KmdError('E_METHOD', 'POST 로 보낸다')
    if (ctx?.agent) throw new KmdError('E_FORBIDDEN', '에이전트 열쇠는 MCP 길만 쓴다')
    if (p === '/api/me') {
      // pcUrl — 내 PC 프로그램으로 이은 기기(설치 한 줄 · osuser 가 실린 것)가 있는 사람에게만 · 없으면 화면이 PC 를 묻지 않는다
      if (!ctx) return out(200, { mode, anon: true, setup: !auth.hasUsers(), legacy: auth.legacyWaiting(), version: VERSION, host: req.headers.host })
      return out(200, { mode, user: ctx.user, admin: !!ctx.admin, sudo: !!ctx.sudo, password: ctx.password !== false, version: VERSION, host: req.headers.host, ...(mode === 'pc' ? { root: path.resolve(root) } : auth.devices(ctx.user).some((d) => d.osuser) ? { pcUrl } : {}), ...(mode === 'team' && ctx.admin ? { root: path.resolve(root) } : {}) })
    }
    // 이 PC 화면의 한 번용 번호 · 멈추기 — `kmd open` · `kmd pc update` 가 이 PC 의 열쇠(자격 저장소의 기기 열쇠)로 부른다.
    // 같은 PC 의 같은 OS 사용자만 그 열쇠를 푼다 · 팀 화면의 짝 열쇠는 CORS 목록 밖이라 닿지 않는다
    if (mode === 'pc' && (p === '/api/pc/once' || p === '/api/pc/stop')) {
      need(ctx)
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      if (ctx.user !== pcUser || ctx.pair) throw new KmdError('E_FORBIDDEN', '이 PC 의 kmd 만 한다')
      if (p === '/api/pc/once') return out(200, { code: auth.once(pcUser) })
      if (!onStop) throw new KmdError('E_NOTFOUND', '이 kmd 는 여기서 멈추지 않는다')
      out(200, { ok: true })
      setTimeout(() => onStop(), 200)
      return
    }
    // 기계 열쇠 — 그 지식의 기준선 길 하나만(E6 이 채운다)
    const bl = p.match(/^\/api\/k\/([^/]+)\/baseline$/)
    if (bl && ctx?.machine) {
      if (ctx.machine.kn !== decodeURIComponent(bl[1])) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      if (!hub.baseline) throw new KmdError('E_NOTFOUND', '아직 없는 길이다')
      return out(200, await hub.baseline(ctx, decodeURIComponent(bl[1]), await readBody(req)))
    }
    // 정리 일꾼 — 일감 받기 · 상태 알리기(kmdw_) · 재료 · 초안(kmdd_)
    if (p === '/api/worker/next' || p === '/api/worker/status') {
      if (!ctx?.worker) throw new KmdError('E_FORBIDDEN', '정리 일꾼 열쇠로 부른다')
      if (p === '/api/worker/next') return out(200, hub.workerNext(ctx) || { job: null })
      return out(200, await hub.workerStatus(ctx, await readBody(req)))
    }
    // 내 PC 일꾼 열쇠 — 설치 한 줄로 이은 PC(기기 열쇠)가 묻는다 · 그 사람의 개인 지식 일감만 받는다(그 사람의 Claude 로)
    if (p === '/api/me/worker' && req.method === 'POST') {
      if (mode !== 'team') throw new KmdError('E_NOTFOUND', '팀 서버의 길이다')
      if (!ctx?.device) throw new KmdError('E_FORBIDDEN', '이은 PC 의 기기 열쇠로 부른다')
      return out(200, { key: (await auth.workerAdd({ owner: ctx.user, device: ctx.device })).key })
    }
    const wk = p.match(/^\/api\/k\/([^/]+)\/worker\/(material|drafts|agent|agent\/log|agent\/done)$/)
    if (wk) {
      if (!ctx?.draft) throw new KmdError('E_FORBIDDEN', '이 일감의 열쇠로 부른다')
      if (wk[2] === 'material') return out(200, await hub.material(ctx, decodeURIComponent(wk[1])))
      // 넣은 파일 하나를 에이전트로 — 일 받기 · 줄 올리기 · 끝(요구 v0.2 F)
      if (wk[2] === 'agent') return out(200, await hub.workerAgent(ctx, decodeURIComponent(wk[1]), await readBody(req)))
      if (wk[2] === 'agent/log') return out(200, hub.workerAgentLog(ctx, decodeURIComponent(wk[1]), await readBody(req, 4 << 20)))
      if (wk[2] === 'agent/done') return out(200, await hub.workerAgentDone(ctx, decodeURIComponent(wk[1]), await readBody(req)))
      return out(200, await hub.drafts(ctx, decodeURIComponent(wk[1]), (await readBody(req)).drafts))
    }
    need(ctx)
    if (p === '/api/me/pcpass' || p === '/api/me/pcpass/check') {
      if (mode !== 'team') throw new KmdError('E_NOTFOUND', '팀 서버의 길이다')
      const now = Date.now()
      for (const [k, v] of pcPasses) if (v.exp < now) pcPasses.delete(k)
      if (p === '/api/me/pcpass') {
        if (ctx.device || ctx.legacy) throw new KmdError('E_FORBIDDEN', '들어온 화면이 받는다')
        const pass = 'kmdq_' + crypto.randomBytes(24).toString('base64url')
        pcPasses.set(pairSha(pass), { user: ctx.user, exp: now + 60_000 })
        return out(200, { pass })
      }
      if (!ctx.device) throw new KmdError('E_FORBIDDEN', '이은 PC 의 기기 열쇠로 부른다')
      const h = pairSha(String((await readBody(req)).pass || ''))
      const rec = pcPasses.get(h)
      pcPasses.delete(h)
      return out(200, { same: !!rec && rec.exp >= now && rec.user === ctx.user })
    }
    if (p === '/api/today') return out(200, await hub.today(ctx))
    if (p === '/api/history') return out(200, await hub.history(ctx))
    // 사람 목록 — 아이디만(정리하는 사람 고르기)
    if (p === '/api/people') return out(200, auth.people())
    const dm = p.match(/^\/api\/k\/([^/]+)\/diff$/)
    if (dm) return out(200, await hub.diff(ctx, decodeURIComponent(dm[1]), url.searchParams.get('record') || ''))
    const jm = p.match(/^\/api\/job\/([0-9a-f]+)$/)
    if (jm) return out(200, hub.job(jm[1]) || { state: 'gone' })
    // 자동으로 가져오는 곳 — 목록 · 더하기(관리자 · PC) · 살펴보기 · 지금 가져오기 · 관리자에게 부탁
    // 이력 — 보는 지식들의 kmd 가 한 일(가져옴 · 가져오는 곳 · 바로 고침 · 정리) 한 곳에 · 새 것 위
    if (p === '/api/logs') {
      const rows = []
      for (const m of await hub.visible(ctx)) rows.push(...V.logRows(await hub.get(m.id, ctx)))
      rows.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      return out(200, { items: rows.slice(0, 500) })
    }
    if (p === '/api/sources') return out(200, { items: await hub.allSources(ctx), can: hub.mode === 'pc' || !!ctx.admin })
    // ── 설정(S7) — 이 팀 서버 · 이 PC · 저절로 하는 일 · Claude 연결 · 에이전트 설치 ──
    if (p === '/api/settings') {
      const ks = await hub.visible(ctx)
      const bk = ks.map((k) => hub.backupStateSync(k)).filter(Boolean)
      const ws = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => null)
      const keys = mode === 'pc' ? ['save', 'file', 'src', 'claude', 'find'] : ['file', 'find']
      const month = new Date().toISOString().slice(0, 7)
      let tidied = 0
      for (const k of ks) tidied += (await hub.get(k.id)).logs.filter((w) => w.tags.includes('curate-llm') && String(w.date).startsWith(month)).length
      return out(200, {
        host: req.headers.host,
        root: mode === 'pc' ? path.resolve(root) : undefined,
        kns: ks.length,
        backup: { n: bk.length, of: ks.length, urls: [...new Set(bk.map((b) => b.url))].slice(0, 3), bad: bk.filter((b) => b.verdict && b.verdict !== 'ok' && b.verdict !== 'lag').length, ...(mode === 'pc' ? { root: hub.config.backupRoot || null, list: ks.map((k) => { const b = hub.backupStateSync(k); return { id: k.id, name: k.name, url: b?.url || null, verdict: b?.verdict || null } }) } : {}) },
        teams: mode === 'pc' ? await teamsOf() : undefined,
        auto: Object.fromEntries(keys.map((x) => [x, hub.autoOf(ctx.user, x)])),
        ...(mode === 'pc' ? { models: hub.models() } : {}),
        claude: { off: !!process.env.KMD_NO_CLAUDE && !process.env.KMD_CLAUDE, worker: ws, month: tidied, token: !!(await getSecret(dataDir, 'claude-token').catch(() => null)), team: mode === 'team' ? { token: !!(await getSecret(dataDir, 'claude-token').catch(() => null)), flow: teamLogin.state, kind: teamLogin.kind } : undefined },
        ...(mode === 'team' ? { pcWorker: (await hub.pcWorkerSeen(ctx.user)) || null } : {}),
        version: VERSION,
      })
    }
    if (p === '/api/settings/model' && req.method === 'POST') { const b = await readBody(req); return out(200, await hub.setModel(ctx, String(b.role), String(b.model ?? ''))) }
    if (p === '/api/settings/auto' && req.method === 'POST') { const b = await readBody(req); return out(200, await hub.setAuto(ctx, String(b.key), !!b.on)) }
    // Claude 연결 상태 — 머리의 칩(가볍게 · 마지막으로 Claude 를 쓴 결과 · worker.json)
    if (p === '/api/claude/state') {
      const ws = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => null)
      return out(200, { pc: mode === 'pc', ok: ws ? ws.ok : null, reason: ws?.reason || null, since: ws?.since || null, at: ws?.at || null, off: mode === 'pc' ? !hub.autoOf(ctx.user, 'claude') : false })
    }
    if (p === '/api/claude/login' && req.method === 'POST') {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '팀 정리 로그인은 관리 › Claude 연결에서')
      return out(200, pcLogin())
    }
    // 이 PC — 로그인 확인(작은 부르기 한 번) · 됐으면 쉼 줄을 걷는다
    if (p === '/api/claude/check' && req.method === 'POST') {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '팀 정리 로그인은 관리 › Claude 연결에서')
      const r = await checkClaude()
      await hub.workerStatus({ worker: { id: null } }, r.ok ? { ok: true } : { ok: false, reason: r.reason, message: r.message })
      return out(200, { ok: r.ok, reason: r.reason || null })
    }
    // 에이전트 설치 — 이 PC 의 작업 폴더마다(스킬 · 연결 하나 · CLAUDE.md 안 kmd 덩이 · 기본 지식)
    //   개인(area me): 이 화면에서 폴더 · 개인 지식을 고른다 · 팀(area team): 팀 화면의 설치 한 줄이 그 폴더에서 붙인다(kmd connect --kn)
    //   팀 화면은 짝 열쇠로 목록만 읽는다
    const ag = p.match(/^\/api\/agent(?:\/(add|up|rm))?$/)
    if (ag) {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '에이전트 설치는 내 PC 프로그램이 한다. 팀 화면은 설치 한 줄 복사')
      const list = await kit.folders(dataDir)
      if (!ag[1]) return out(200, { latest: await kit.kitVersion(), folders: await Promise.all(list.map(async (f) => ({ ...f, area: f.area || null, ...(await kit.status(f.path)) }))) })
      if (ctx.pair) throw new KmdError('E_FORBIDDEN', '이 PC 화면에서 한다')
      const b = await readBody(req)
      const teamUrl = (await teamsOf())[0] || null
      const urls = (f) => ({ pcUrl: `http://${req.headers.host}`, teamUrl, area: f.area || null, kn: f.kn || null, knName: f.knName || null })
      if (ag[1] === 'add') {
        // 개인 지식 하나에 붙인다 — 같은 폴더면 지식 · 영역을 바꾼다(팀에 붙어 있었으면 팀 연결을 걷는다)
        const kn = String(b.kn || '')
        const k = kn ? (await hub.list()).find((x) => x.id === kn) : null
        if (kn && !k) throw new KmdError('E_INPUT', `「${kn}」 개인 지식이 없다`)
        const want = k ? { area: 'me', kn: k.id, knName: k.name } : {}
        const r = await kit.install(String(b.dir || ''), urls(want))
        const again = list.some((f) => path.resolve(f.path).toLowerCase() === r.dir.toLowerCase())
        const row = { name: path.basename(r.dir), path: r.dir, at: new Date().toISOString(), ...want }
        await kit.setFolders(dataDir, again ? list.map((f) => (path.resolve(f.path).toLowerCase() === r.dir.toLowerCase() ? { ...f, ...row, at: f.at } : f)) : [...list, row])
        return out(200, { ...r, ...(again ? { again: true } : {}) })
      }
      const pick = b.dir ? list.filter((f) => path.resolve(f.path).toLowerCase() === path.resolve(String(b.dir)).toLowerCase()) : list
      if (ag[1] === 'up') { for (const f of pick) await kit.install(f.path, urls(f)); return out(200, { n: pick.length }) }
      for (const f of pick) await kit.remove(f.path)
      await kit.setFolders(dataDir, list.filter((f) => !pick.includes(f)))
      return out(200, { n: pick.length })
    }
    // 관리 — 문제 줄만 · 정리 전용 로그인 · 링크 한꺼번에
    if (p === '/api/admin/overview') {
      admin(ctx, { sudo: false })
      const users = auth.users()
      const ws = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => null)
      // 관리자가 보는 지식만 이름으로 — 남의 개인 지식은 수로만(이름 · 백업 상태를 보이지 않는다)
      const all = await hub.list()
      const ks = await hub.visible(ctx)
      const checks = []
      for (const k of ks) { const c = await fs.readFile(path.join(dataDir, 'searchcheck', `${encodeURIComponent(k.id)}.json`), 'utf8').then(JSON.parse, () => null); if (c?.score) checks.push({ name: k.name, in: c.score.in, n: c.score.n, at: c.at }) }
      return out(200, {
        nopw: users.filter((u) => u.kind === 'person' && !u.off && !u.password && !u.firstOpen).map((u) => u.id),
        waiting: users.filter((u) => u.kind === 'person' && !u.off && u.firstOpen).map((u) => u.id),
        locked: auth.locked(),
        requests: await hub.requests(),
        worker: ws,
        people: auth.people(),
        off: users.filter((u) => u.off).map((u) => u.id),
        kns: ks.length,
        knsPrivate: all.length - ks.length,
        // 개인 지식 중 백업 자리가 없는 것 — 수로만(관리자는 그 지식을 보지 못한다)
        privateUnbacked: all.filter((k) => hub.owner(k.id)?.private && !hub.backupStateSync(k)).length,
        sources: (await hub.allSources(ctx)).map((s) => ({ name: s.name, kn: s.knName, last: s.state?.checkedAt || null })),
        backups: ks.map((k) => ({ name: k.name, ...(hub.backupStateSync(k) || { off: true }) })),
        checks,
        claude: { token: !!(await getSecret(dataDir, 'claude-token').catch(() => null)), flow: teamLogin.state, kind: teamLogin.kind },
        https: req.headers['x-forwarded-proto'] === 'https',
      })
    }
    if (p === '/api/admin/links' && req.method === 'POST') {
      admin(ctx)
      const ids = (await readBody(req)).users
      const links = []
      for (const id of Array.isArray(ids) ? ids.slice(0, 100) : []) links.push({ id, link: `http://${req.headers.host}/first#code=${(await auth.reset(id, { by: ctx.user })).code}` })
      return out(200, { links })
    }
    const ac = p.match(/^\/api\/admin\/claude\/(start|code|cancel|check)$/)
    if (ac && req.method === 'POST') {
      admin(ctx)
      if (mode !== 'team') throw new KmdError('E_FORBIDDEN', '팀 서버에서만')
      if (ac[1] === 'start') return out(200, await teamLogin.start())
      if (ac[1] === 'cancel') return out(200, { ok: !!teamLogin.cancel() || true })
      // 화면 있는 서버 PC — 그 PC 의 Claude Code 로그인을 작은 부르기로 확인 · 됐으면 옛 정리 전용 열쇠를 걷어 그 로그인을 쓰게
      if (ac[1] === 'check') {
        const r = await checkClaude()
        if (r.ok) {
          teamLogin.cancel()
          await delSecret(dataDir, 'claude-token').catch(() => {})
        }
        if (r.ok) await hub.workerStatus({ worker: { id: null } }, { ok: true }) // 아직 로그인 전인 확인은 쉼으로 적지 않는다
        return out(200, { ok: r.ok, reason: r.reason || null })
      }
      const r = await teamLogin.code((await readBody(req)).code)
      await fs.rm(path.join(dataDir, 'worker.json'), { force: true }).catch(() => {}) // 쉼 줄을 걷는다 — 다음 일감에서 다시 잰다
      return out(200, { ok: r.ok })
    }
    // 되살리기 · 이 백업 이어 쓰기 — 관리자(비밀번호 한 번 더) · PC 는 그 PC 의 주인
    if (p === '/api/restore' && req.method === 'POST') {
      admin(ctx)
      return out(200, await hub.restore(ctx, await readBody(req)))
    }
    if (p === '/api/pc/backup') {
      if (mode !== 'pc') throw new KmdError('E_NOTFOUND', '이 PC 의 길이다')
      return out(200, await hub.setBackupRoot(ctx, (await readBody(req)).root))
    }
    const bl2 = p.match(/^\/api\/k\/([^/]+)\/backup\/(lost|keep)$/)
    if (bl2) {
      admin(ctx, { sudo: bl2[2] === 'keep' })
      if (bl2[2] === 'lost') return out(200, await hub.backupLost(ctx, decodeURIComponent(bl2[1])))
      return out(200, await hub.backupKeep(ctx, decodeURIComponent(bl2[1])))
    }
    const ba = p.match(/^\/api\/k\/([^/]+)\/backup\/adopt$/)
    if (ba && req.method === 'POST') {
      admin(ctx)
      return out(200, await hub.backupAdopt(ctx, decodeURIComponent(ba[1])))
    }
    // 팀 서버의 옛 개인 지식 옮기기 — 팀 서버는 주인에게 bundle 을 · 내 PC 프로그램은 받아 세운다
    const bn = p.match(/^\/api\/k\/([^/]+)\/bundle$/)
    if (bn) {
      need(ctx)
      const r = await hub.bundleOf(ctx, decodeURIComponent(bn[1]))
      return send(res, 200, r.buf, 'application/x-git-bundle', { 'x-kmd-name': encodeURIComponent(r.name), ...(set ? { 'set-cookie': set } : {}) })
    }
    if (p === '/api/knowledge/fromteam') {
      need(ctx)
      return out(200, await hub.fromTeam(ctx, await readBody(req)))
    }
    // 지식 추가 — 새 이름 · 내 폴더(PC)
    if (p === '/api/knowledge/add') {
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      const b = await readBody(req)
      // 팀 서버에는 팀 지식만 선다(관리자). 개인 지식은 내 PC 프로그램의 지식 폴더에
      if (mode === 'team' && !b.team) throw new KmdError('E_FORBIDDEN', '개인 지식은 팀 서버에 세우지 않는다. 내 PC 프로그램의 지식 폴더에 만든다')
      if (mode === 'team') admin(ctx, { sudo: false })
      return out(200, await hub.addKnowledge(ctx, b))
    }
    const sm = p.match(/^\/api\/k\/([^/]+)\/sources(?:\/(probe|run|request|every|checkdb|resync|meaning|edit|remove))?$/)
    if (sm) {
      const id = decodeURIComponent(sm[1])
      if (req.method === 'GET' && !sm[2]) return out(200, await hub.sources(ctx, id))
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      const b = await readBody(req)
      if (sm[2] === 'every') return out(200, await hub.sourceEvery(ctx, id, b))
      if (sm[2] === 'edit') return out(200, await hub.sourceEdit(ctx, id, b))
      if (sm[2] === 'remove') return out(200, await hub.sourceRemove(ctx, id, { name: String(b.name || ''), copies: b.copies === 'drop' ? 'drop' : 'keep' }))
      if (sm[2] === 'checkdb') return out(200, await hub.sourceCheckDb(ctx, id, b))
      if (sm[2] === 'resync') return out(200, await hub.sourceResync(ctx, id, String(b.name || '')))
      if (sm[2] === 'meaning') return out(200, await hub.sourceMeaning(ctx, id, { name: String(b.name || ''), on: !!b.on }))
      if (sm[2] === 'probe') {
        if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '가져올 곳은 관리자가 더한다')
        return out(200, await hub.sourceProbe(ctx, id, b))
      }
      if (sm[2] === 'request') return out(200, await hub.sourceRequest(ctx, id, b))
      if (sm[2] === 'run') {
        await hub.meta(id, ctx)
        if (b.force && !hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '[그대로 반영] 은 관리자가 한다')
        return out(200, await hub.sourceRun(id, b.name || null, { force: !!b.force, by: ctx.user }))
      }
      if (hub.mode === 'team') admin(ctx, { sudo: false })
      return out(200, await hub.sourceAdd(ctx, id, b))
    }
    if (p === '/api/requests') {
      admin(ctx, { sudo: false })
      return out(200, await hub.requests())
    }
    const rq = p.match(/^\/api\/requests\/([0-9a-f]{10})\/close$/)
    if (rq) {
      admin(ctx, { sudo: false })
      const b = await readBody(req)
      return out(200, await hub.requestClose(ctx, rq[1], { state: String(b.state || ''), why: b.why || '' }))
    }
    const tm = p.match(/^\/api\/k\/([^/]+)\/tidy$/)
    if (tm) {
      const id = decodeURIComponent(tm[1])
      if (req.method === 'POST') return out(200, await hub.tidyNow(ctx, id))
      await hub.meta(id, ctx)
      const k = await hub.get(id, ctx)
      const runs = (await hub.runs(id)).map((run) => ({ ...run, rows: run.rows.map((r) => ({ ...r, reverted: !!r.record && k.reverted.has(r.record) })) }))
      return out(200, { tidyAt: hub.tidyAtOf(id), tidyMode: hub.tidyModeOf(id), jobs: hub.jobsOf(id), runs, pend: k.works.filter((w) => w.state === 'pend').length, nowhere: k.works.filter((w) => w.state === 'nowhere').length })
    }
    // 메뉴 — 사람마다 순서 · 뺀 지식 · 동기화(지식 폴더 다시 읽기)
    if (p === '/api/knowledge/menu') {
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      need(ctx)
      return out(200, await hub.menuSet(ctx, await readBody(req)))
    }
    if (p === '/api/knowledge/sync') {
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      need(ctx)
      return out(200, await hub.sync(ctx))
    }
    if (p === '/api/knowledge') {
      const ks0 = await hub.all(ctx)
      // 메뉴 순서대로 · 뺀 지식은 hidden(목록 아래 「뺀 지식」 · 옆 메뉴에는 안 나온다)
      const menu = await hub.menuOf(ctx, ks0.map((k) => k.id))
      const ks = [...ks0].sort((a, b) => menu.order.indexOf(a.id) - menu.order.indexOf(b.id))
      return out(200, await Promise.all(ks.map(async (k) => {
        // 팀 서버의 내 개인 지식 — 받는 지식(보내는 길) · 보내지 않은 기록 수(옆 메뉴 「지식 보내기」 의 수) · 내 PC 프로그램에는 보내기가 없다
        const row = hub.owner(k.id)
        const sv = (mode === 'pc' && (await sendLib.destsOf(k.dir)).length) || (row?.private && row.owner === ctx.user) ? await hub.sendView(ctx, k.id).catch(() => null) : null
        return { ...V.knowledgeRow(k), role: hub.roleIn(k.id, ctx), ...(mode === 'pc' ? { dir: k.dir } : {}), ...(sv?.route ? { route: sv.route.kn, sendN: sv.recs.filter((r) => !r.sent).length, sendWait: sv.wait.length } : {}), private: !!row?.private, ...(mode === 'team' ? { owner: row?.owner || null } : {}), tidyAt: hub.tidyAtOf(k.id), tidyMode: hub.tidyModeOf(k.id), pendText: hub.pendText(k.id), ...(menu.hidden.includes(k.id) ? { hidden: true } : {}) }
      })))
    }
    // 에이전트 일 — 목록 · 줄(터미널)
    if (p === '/api/busy') { need(ctx); return out(200, await hub.busy(ctx)) }
    if (p === '/api/runs') { need(ctx); return out(200, hub.runList(ctx, url.searchParams.get('k') || null)) }
    // 일 줄 — 들여오는 일 모두(가져오기 화면) · 일 하나의 줄(from 부터) · 손잡이 · 줄 멈춤 · 동시에 도는 수
    if (p === '/api/queue') { need(ctx); return out(200, await hub.queueList(ctx)) }
    if (p === '/api/queue/hold' && req.method === 'POST') { need(ctx); return out(200, hub.queueHold(ctx, !!(await readBody(req)).on)) }
    if (p === '/api/queue/caps' && req.method === 'POST') { need(ctx); return out(200, hub.queueCaps(ctx, await readBody(req))) }
    const qa = p.match(/^\/api\/queue\/([0-9a-f]{12}|t:[0-9a-f]+)(?:\/(pause|resume|cancel|retry|force|top|move))?$/)
    if (qa) {
      need(ctx)
      if (!qa[2]) return out(200, await hub.queueGet(ctx, qa[1], Number(url.searchParams.get('from')) || 0))
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      return out(200, await hub.queueAct(ctx, qa[1], qa[2], await readBody(req)))
    }
    const rn = p.match(/^\/api\/runs\/([0-9a-f]{12})$/)
    if (rn) { need(ctx); return out(200, hub.runGet(ctx, rn[1], Number(url.searchParams.get('from')) || 0)) }
    if (p === '/api/stops') return out(200, await hub.stops(ctx))
    if (p === '/api/find') {
      const rs = await hub.search(ctx, url.searchParams.get('k') || null, { q: url.searchParams.get('q') || '' })
      return out(200, V.findView(await Promise.all(rs.map(async (r) => ({ k: await hub.get(r.knowledge), r })))))
    }
    // ── 나 — 재인증 · 설치 표 · 내 기기 · 모든 기기에서 나가기 ──
    if (p === '/api/sudo') return send(res, 200, { ok: true }, undefined, { 'set-cookie': await auth.sudo(ctx, { pw: (await readBody(req)).pw, ip: ipOf(req), cookieHeader: req.headers.cookie }) })
    if (p === '/api/device/ticket') {
      if (ctx.device || ctx.legacy) throw new KmdError('E_FORBIDDEN', '열쇠로는 다른 열쇠를 만들지 못한다')
      const t = auth.ticket(ctx, { ip: ipOf(req) })
      const origin = `http://${req.headers.host}`
      // 붙일 팀 지식(에이전트 설치 · 팀) — 보이는 팀 지식만
      const kb = req.method === 'POST' ? await readBody(req).catch(() => ({})) : {}
      const kn = kb.kn ? safeKn(kb.kn) : null
      if (kb.kn && (!kn || hub.owner(kn)?.private || !(await hub.visible(ctx)).some((k) => k.id === kn))) throw new KmdError('E_INPUT', '붙일 팀 지식이 없다')
      const qk = kn ? `?kn=${encodeURIComponent(kn)}` : ''
      return out(200, { ticket: t, line: kn ? `irm '${origin}/i/${t}${qk}' | iex` : `irm ${origin}/i/${t} | iex`, sh: kn ? `curl -fsSL '${origin}/i/${t}.sh${qk}' | sh` : `curl -fsSL ${origin}/i/${t}.sh | sh`, kmd: `kmd connect ${origin} --ticket ${t}${kn ? ' --kn ' + kn : ''}`, expires: 10, kn })
    }
    if (p === '/api/me/devices') return out(200, auth.devices(ctx.user))
    if (p === '/api/me/devices/revoke') return out(200, { revoked: await auth.revokeDevice(ctx.user, String((await readBody(req)).id || '')) })
    if (p === '/api/me/logout-all') {
      await auth.logoutAll(ctx.user)
      return send(res, 200, { ok: true }, undefined, { 'set-cookie': auth.logoutCookie() })
    }
    // ── 관리 — 사람 ──
    if (p === '/api/admin/users') {
      // 사람 카드 — 사람마다 상태 · 기기 · PC 일꾼 · 주인인 지식 수(이름은 싣지 않는다)
      if (req.method === 'GET') {
        admin(ctx, { sudo: false })
        const all = auth.users()
        const roles = await hub.peopleRoles()
        const people = all.filter((u) => u.kind === 'person' && !u.machine).map((u) => ({ ...u, workers: all.filter((w) => w.kind === 'worker' && w.owner === u.id).length, roles: roles[u.id] || { team: 0, private: 0, curate: 0 } }))
        return out(200, { users: people, locked: auth.locked() })
      }
      admin(ctx)
      const b = await readBody(req)
      const r = await auth.addUser({ id: b.id, admin: b.admin })
      return out(200, { id: r.id, link: `http://${req.headers.host}/first#code=${r.code}` })
    }
    const am = p.match(/^\/api\/admin\/users\/([^/]+)\/(reset|unlock|revoke-all|logout-all|admin|off)$/)
    if (am) {
      admin(ctx)
      const id = decodeURIComponent(am[1])
      // 떠남 — 들어가기 · 기기 · PC 일꾼을 끊고 아이디를 남긴다 · 그 사람의 지식은 넘겨받거나(to: 'me') 주인 칸을 비운다(개인 지식은 관리자만)
      if (am[2] === 'off') {
        if (id === ctx.user) throw new KmdError('E_INPUT', '나 자신은 떠나게 하지 못한다. 다른 관리자가 한다')
        const b = await readBody(req)
        const r = await auth.off(id, { by: ctx.user })
        const kn = r.already ? null : await hub.handOver(id, { to: b.to === 'me' ? ctx.user : null })
        return out(200, { ...r, kn })
      }
      if (am[2] === 'reset') {
        const r = await auth.reset(id, { by: ctx.user })
        return out(200, { id, link: `http://${req.headers.host}/first#code=${r.code}` })
      }
      if (am[2] === 'unlock') return out(200, { ok: auth.unlock(id) ?? true })
      if (am[2] === 'revoke-all') return out(200, { revoked: await auth.revokeDevice(id, '*') })
      if (am[2] === 'logout-all') return out(200, { ok: await auth.logoutAll(id) ?? true })
      return out(200, { ok: (await auth.setAdmin(id, !!(await readBody(req)).admin)) ?? true })
    }

    // 파일 · 폴더 넣기 — { files: [{ path, b64 }] } · 한 번에 300 파일 · 200MB(글자로 바꾸면 커져 길 상한은 280MB)
    const im = p.match(/^\/api\/k\/([^/]+)\/import$/)
    if (im) {
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      const b = await readBody(req, 280 << 20)
      const files = (Array.isArray(b.files) ? b.files : []).map((f) => ({ path: String(f.path || f.name || ''), data: Buffer.from(String(f.b64 || ''), 'base64') }))
      // group — 여러 파일을 나눠 보낼 때 한 일로 묶는다({ title, total } → 받은 id 로 이어 보내고 마지막에 last)
      const group = b.group && typeof b.group === 'object' ? { id: b.group.id ? String(b.group.id) : null, title: String(b.group.title || ''), total: Number(b.group.total) || 0, last: !!b.group.last } : null
      return out(200, await hub.importFiles(ctx, decodeURIComponent(im[1]), files, { group }))
    }
    // 지식 지우기 — 보관하지 않고 완전히 · 확인은 지식 이름 · 팀 관리자는 비밀번호 한 번 더(개인 지식의 주인은 이름 확인만)
    const dl = p.match(/^\/api\/k\/([^/]+)\/delete$/)
    if (dl && req.method === 'POST') {
      const id = decodeURIComponent(dl[1])
      const b = await readBody(req)
      const row = hub.owner(id)
      if (mode === 'team' && (!row?.private || row.owner !== ctx.user)) admin(ctx)
      return out(200, await hub.deleteKnowledge(ctx, id, b))
    }
    // 보내기 — 보낼 것(GET send) · 보내는 길(send/route) · 보내기 · 대기 줄 · 받기 · 받은편지함 정리
    //   보내는 지식은 내 PC 프로그램의 개인 지식(팀 서버는 옛 개인 지식만) · 받는 것은 팀 서버
    const sd = p.match(/^\/api\/k\/([^/]+)\/(send|send\/route|send\/wait|receive|inbox\/tidy|inbox\/send)$/)
    if (sd) {
      const id = decodeURIComponent(sd[1])
      if (sd[2] === 'send' && req.method === 'GET') return out(200, await hub.sendView(ctx, id))
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      const b = await readBody(req, sd[2] === 'receive' ? 8 << 20 : MAX_BODY)
      if (sd[2] === 'send') return out(200, await hub.sendPicked(ctx, id, b))
      if (sd[2] === 'send/route') return out(200, await hub.sendRoute(ctx, id, b))
      if (sd[2] === 'send/wait') return out(200, await hub.sendWaitAct(ctx, id, { wid: b.id, act: b.act }))
      if (sd[2] === 'receive') return out(200, await hub.receive(ctx, id, b))
      if (sd[2] === 'inbox/send') return out(200, await hub.inboxSend(ctx, id, b))
      return out(200, await hub.inboxTidy(ctx, id, { dry: !!b.dry }))
    }
    // 넣은 파일의 기록을 Claude 로 정리 — { r: 기록 id }
    const rr = p.match(/^\/api\/k\/([^/]+)\/rec\/read$/)
    if (rr) {
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      return out(200, await hub.readRecord(ctx, decodeURIComponent(rr[1]), (await readBody(req)).r))
    }
    const uw = p.match(/^\/api\/k\/([^/]+)\/unwatch$/)
    if (uw) return out(200, await hub.unwatch(ctx, decodeURIComponent(uw[1]), await readBody(req)))
    const m = p.match(/^\/api\/k\/([^/]+)\/(tree|doc|rec|att|model|item|save|backup|backup\/pull|owner|learn|edit|revert)$/)
    if (!m) throw new KmdError('E_NOTFOUND', '그런 길은 없다')
    const id = decodeURIComponent(m[1])
    const what = m[2]
    if (['save', 'backup', 'backup/pull', 'owner', 'learn', 'edit', 'revert'].includes(what)) {
      if (what === 'backup' && req.method === 'GET') return out(200, (await hub.backupState(ctx, id)) || { off: true })
      // 주인 줄 — 그 지식을 보는 사람에게만(개인 지식의 주인 · 설정을 남에게 보이지 않게)
      if (what === 'owner' && req.method === 'GET') { await hub.meta(id, ctx); return out(200, hub.owner(id) || {}) }
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      const body = await readBody(req)
      if (what === 'save') return out(200, await hub.save(ctx, id, body))
      if (what === 'learn') return out(200, await hub.learn(ctx, id, body))
      if (what === 'edit') return out(200, await hub.edit(ctx, id, body))
      if (what === 'revert') return out(200, await hub.revert(ctx, id, body))
      if (what === 'owner') {
        // 주인 · 정리하는 사람은 명부에 있는 사람만
        const people = new Set(auth.users().filter((u) => u.kind === 'person' && !u.off).map((u) => u.id))
        for (const u of [body.owner, ...(Array.isArray(body.curators) ? body.curators : [])].filter((x) => x != null && x !== '')) if (!people.has(String(u))) throw new KmdError('E_INPUT', `그런 사람은 없다: ${String(u).slice(0, 40)}`)
        // 주인 넘기기 · 개인 ↔ 팀 — 관리자(팀 서버)는 비밀번호 한 번 더(남의 지식을 감추거나 넘기는 일)
        const cur = hub.owner(id)
        if (mode === 'team' && ctx.admin && ((body.owner != null && body.owner !== (cur?.owner ?? null)) || (body.private != null && String(body.private) !== String(!!cur?.private)))) admin(ctx)
        return out(200, await hub.setOwner(ctx, id, body))
      }
      admin(ctx)
      if (what === 'backup') return out(200, await hub.backupAttach(ctx, id, String(body.url || '')))
      return out(200, await hub.backupPull(ctx, id))
    }
    const k = await hub.get(id, ctx)
    if (what === 'tree') return out(200, V.tree(k))
    if (what === 'model') return out(200, V.model(k))
    if (what === 'item') {
      const v = V.itemView(k, url.searchParams.get('key') || '', { src: await hub.sourceState(k.id) })
      if (!v) throw new KmdError('E_NOTFOUND', '이 항목은 이제 없다')
      return out(200, v)
    }
    if (what === 'att') {
      // 첨부 — 나무에 보인 그림만 그대로 보낸다
      const name = url.searchParams.get('a') || ''
      const rel = k.atts.find((a) => a.replace(/^(docs|work)\/assets\//i, '') === name)
      const type = rel && TYPES[path.extname(rel).toLowerCase()]
      if (!rel || !type || !type.startsWith('image/') || type === 'image/svg+xml') throw new KmdError('E_NOTFOUND', '그림 첨부만 화면에 보인다')
      return send(res, 200, await fs.readFile(path.join(k.dir, ...rel.split('/'))), type)
    }
    if (what === 'doc') {
      const v = V.docView(k, url.searchParams.get('d'), { src: await hub.sourceState(k.id) })
      if (!v) throw new KmdError('E_NOTFOUND', '이 문서는 이제 없다')
      // 원본이 주인인 문서 — 어디서 왔나 · 고치기 없음
      const dd = k.docs.find((x) => x.id === url.searchParams.get('d'))
      const watched = dd ? watchedOf(await fs.readFile(path.join(k.dir, ...dd.path.split('/')), 'utf8').catch(() => '')) : null
      // 원본이 주인인 문서 — 그 가져오는 곳이 이제 없으면 「원본이 없어졌다」(표지를 걷을 수 있다)
      const orphan = watched ? !(await hub.sources(ctx, k.id).catch(() => [])).some((s) => s.name === watched.src) : false
      return out(200, { ...v, watched: watched ? { ...watched, ...(orphan ? { orphan: true } : {}) } : null, direct: hub.canDirect(ctx, k.id) && !watched })
    }
    const v = V.recView(k, url.searchParams.get('r'))
    if (!v) throw new KmdError('E_NOTFOUND', '이 기록은 이제 없다')
    return out(200, v)
  }

  const staticFile = async (res, p) => {
    // 화면 길(/first · /setup)은 같은 화면 한 장이 연다
    const rel = p === '/' || p === '/first' || p === '/setup' || (p === '/pair' && mode === 'pc') ? 'index.html' : p.slice(1)
    const full = path.join(APP, ...rel.split('/'))
    if (!full.startsWith(APP + path.sep) || rel.split('/').includes('..')) return send(res, 404, '없다', 'text/plain; charset=utf-8')
    const buf = await fs.readFile(full).catch(() => null)
    if (!buf) return send(res, 404, '없다', 'text/plain; charset=utf-8')
    send(res, 200, buf, TYPES[path.extname(full)] || 'application/octet-stream', rel === 'index.html' ? { 'content-security-policy': `default-src 'self'; connect-src 'self'${mode === 'team' ? ' ' + pcUrl : ''}; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'` } : {})
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x')
      const p = url.pathname
      const xo = await crossOrigin(req, res, p)
      if (xo?.done) return
      if (xo?.pair) return send(res, 200, await pairWith(xo.origin, await readBody(req)))
      if (xo?.ctx) {
        if (p.startsWith('/api/')) return await api(req, res, url, xo.ctx, null)
        throw new KmdError('E_FORBIDDEN', '팀 화면에서는 읽기 · 저장만')
      }
      if (req.method === 'POST' && req.headers.origin && !sameOrigin(req) && !xo?.open) throw new KmdError('E_FORBIDDEN', '다른 곳의 화면에서 온 요청은 받지 않는다')
      // Origin 을 싣지 않는 브라우저 길도 — 다른 사이트(같은 호스트의 다른 포트 포함)에서 온 쿠키 요청은 받지 않는다
      if (req.method === 'POST' && ['cross-site', 'same-site'].includes(String(req.headers['sec-fetch-site'] || '')) && !xo?.open) throw new KmdError('E_FORBIDDEN', '다른 곳의 화면에서 온 요청은 받지 않는다')
      // 이 PC 화면 — 팀 화면 허락 목록에서 빼기(그 팀 화면은 더 내 PC 지식을 열지 못한다 · 받은 짝 열쇠도 끊는다)
      if (p === '/api/pair/forget' && mode === 'pc' && req.method === 'POST') {
        const { ctx: me } = who(req)
        need(me)
        if (me.pair) throw new KmdError('E_FORBIDDEN', '이 PC 화면에서 한다')
        const origin = safeOrigin((await readBody(req)).origin || '')
        if (!origin) throw new KmdError('E_INPUT', '팀 주소가 아니다')
        const teams = await fs.readFile(teamsFile, 'utf8').then(JSON.parse, () => [])
        await fs.writeFile(teamsFile, JSON.stringify(teams.filter((u) => { try { return new URL(u).origin !== origin } catch { return true } }), null, 1))
        for (const [k, v] of pairs) if (v.origin === origin) pairs.delete(k)
        return send(res, 200, { ok: true })
      }
      if (p === '/healthz') {
        // 살아 있나 · 판 · 갈래만 — 들어오지 않아도 받으므로 지식 이름 · 멈춤 줄은 싣지 않는다(그것은 들어온 사람의 /api/stops).
        // 지식마다 git 을 재지 않아 가볍다(?live=1 은 예전 판과의 호환)
        return send(res, 200, { ok: true, version: VERSION, mode })
      }
      // 설명서 — /manual(이 서버 갈래의 첫 설명서) · /manual/<이름>
      const mm = req.method === 'GET' && p.match(/^\/manual(?:\/([^/]+))?$/)
      if (mm) {
        const page = await manualPage(mode, mm[1] ? decodeURIComponent(mm[1]) : null)
        if (!page) return send(res, 404, '없다', 'text/plain; charset=utf-8')
        return send(res, 200, page, 'text/html; charset=utf-8', { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" })
      }
      // 설치 한 줄이 받는 작은 스크립트 — `irm <팀>/i/<표> | iex`(PowerShell) · `curl -fsSL <팀>/i/<표>.sh | sh`. 표는 여기서 쓰지 않는다(설치가 /device/keys 로 한 번)
      // kmd 가 없는 Windows PC 면 받기 자리의 PC 꾸러미를 받아 <집>/versions/<판> 에 풀고 실행기(<집>/bin)를 사용자 PATH 에 더한 뒤 잇는다
      const im = mode === 'team' && req.method === 'GET' && p.match(/^\/i\/(kmdt_[A-Za-z0-9_-]{10,80})(\.sh)?$/)
      if (im) {
        const origin = `http://${req.headers.host}`
        const pkg = await pcPackage()
        const kn = safeKn(new URL(req.url, origin).searchParams.get('kn'))
        const ps = installPs({ origin, ticket: im[1], pkg, kn })
        const sh = `#!/bin/sh\nif command -v kmd >/dev/null 2>&1; then kmd connect '${origin}' --ticket '${im[1]}'${kn ? " --kn '" + kn + "'" : ''}; else echo '· kmd 가 이 PC 에 없다. 받을 수 있는 꾸러미는 Windows 용뿐이다. 저장소에서 kmd 를 깔고(node 20 이상) 이 줄을 다시 붙여 넣는다: ${origin}/dl'; fi\n`
        return send(res, 200, im[2] ? sh : ps, 'text/plain; charset=utf-8')
      }
      // 꾸러미 받기 — PC 꾸러미(serve.json dl · 기본 <살림 자리>/dl · 팀 설치가 꾸러미 안의 것을 둔다). 비밀이 아니라 들어오지 않아도 받는다
      if (mode === 'team' && req.method === 'GET' && (p === '/dl' || p.startsWith('/dl/'))) {
        const dl = dlDir()
        const files = (await fs.readdir(dl).catch(() => [])).filter((n) => /\.(zip|tgz|exe|msi)$/i.test(n))
        if (p === '/dl') return send(res, 200, `<!doctype html><meta charset="utf-8"><title>kmd 받기</title><body style="font:15px system-ui;margin:40px;max-width:760px"><h1>kmd 받기</h1>${files.length ? `<ul>${files.map((n) => `<li><a href="/dl/${encodeURIComponent(n)}">${n.replace(/[<>&"]/g, '')}</a></li>`).join('')}</ul><p>보통은 받을 일이 없다. 팀 화면 › 설정 › 에이전트 설치의 <b>설치 한 줄</b>을 PowerShell 에 붙여 넣으면 이 꾸러미를 저절로 받아 깔고 팀에 잇는다.</p><p>손으로 깔려면: zip 을 풀고 그 폴더에서 <code>kmd.cmd up</code> 으로 켠다.</p>` : '<p>아직 PC 꾸러미가 없다. 관리자가 팀 꾸러미로 설치하면 함께 놓인다. 관리자에게 묻는다.</p>'}<p><a href="/manual">설명서</a></p></body>`, 'text/html; charset=utf-8')
        const n = decodeURIComponent(p.slice(4))
        if (!files.includes(n)) return send(res, 404, '없다', 'text/plain; charset=utf-8')
        // 꾸러미는 수십 MB — 메모리에 다 읽지 않고 흘려 보낸다(여럿이 함께 깔아도 서버 메모리가 받는 사람 수만큼 늘지 않게)
        const file = path.join(dl, n)
        const st = await fs.stat(file)
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(n)}` })
        return void (await pipeline(createReadStream(file), res).catch(() => res.destroy()))
      }
      if (req.method === 'POST' && ['/login', '/logout', '/first', '/setup', '/once', '/device/keys'].includes(p)) return await gate(req, res, p)
      const { ctx, set } = who(req)
      if (p === '/mcp') {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST 로 보낸다' })
        need(ctx)
        const body = await readBody(req)
        if (Array.isArray(body)) {
          const out = (await Promise.all(body.map((m) => mcp.call(m, ctx)))).filter(Boolean)
          return out.length ? send(res, 200, out) : (res.writeHead(202), res.end())
        }
        const out = await mcp.call(body, ctx)
        return out ? send(res, 200, out) : (res.writeHead(202), res.end())
      }
      if (p.startsWith('/api/')) return await api(req, res, url, ctx, set)
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '읽기만', 'text/plain; charset=utf-8')
      return await staticFile(res, p)
    } catch (e) {
      if (!(e instanceof KmdError)) console.error('[kmd]', e)
      const status = e instanceof KmdError ? httpStatusOf(e.code) : 500
      send(res, status, { error: e.code || 'E_INTERNAL', message: e instanceof KmdError ? e.message : '서버 안에서 넘어졌다', ...(e.need ? { need: e.need } : {}) }, undefined, status === 401 && req.url.startsWith('/mcp') ? { 'www-authenticate': 'Bearer' } : {})
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  // 에이전트가 이 kmd 의 MCP 에 닿는 주소(같은 PC 안)
  hub.selfUrl = `http://127.0.0.1:${server.address().port}`
  await hub.start()
  const a = server.address()
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host
  const origin = `http://${shown.includes(':') ? `[${shown}]` : shown}:${a.port}`
  return {
    url: origin,
    port: a.port,
    hub,
    auth,
    store: hub,
    pcUser,
    close: () =>
      new Promise((r) => {
        hub.stop()
        server.close(() => r())
        server.closeAllConnections?.()
      }),
  }
}
