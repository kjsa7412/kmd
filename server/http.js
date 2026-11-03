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
import { VERSION, BUILD } from './version.js'
import * as V from './views.js'
import * as kit from '../core/kit.js'
import * as teamkit from '../core/teamkit.js'
import { KEY_EXE_CS, KEY_EXE_VER } from '../core/keyexe.js'
import * as sendLib from '../core/send.js'
import { watchedOf } from '../core/watchmark.js'
import { pcLogin, makeTeamLogin } from '../core/claudelogin.js'
import { checkClaude } from '../core/claude.js'
import { getSecret, delSecret } from '../core/secrets.js'
import { safeOrigin } from '../core/claudecfg.js'
import { pcRootKind, noneRoot, isNoneRoot, carryPcData } from '../core/pcops.js'
import { createReadStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { writeJsonAtomic } from '../core/atomic.js'

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.json': 'application/json' }
const MAX_BODY = 2 << 20

// 나눠 보내기(Q71) — 기록 · 이력은 새 것 위(날짜 · id 내림)로 늘 정렬돼 있다. 커서는 그 순서의 「이것보다 앞(옛) 것」.
//   ?limit=  한 번에(1 ~ 1000 · 없으면 dflt)
//   ?before= 기록 id(그 기록 다음부터) · 「날짜|id」(next 로 받은 것 그대로) · 날짜(YYYY-MM-DD[ HH:MM] — 그보다 옛 것)
//   ?days=   최근 며칠만(이력)
const PAGE_MAX = 1000
const pageLimit = (url, dflt) => {
  const n = Number(url.searchParams.get('limit'))
  return Number.isInteger(n) && n > 0 ? Math.min(n, PAGE_MAX) : dflt
}
const cursorOf = (w) => `${w.date}|${w.id}`
// before → 거르는 함수(w → 옛 것이면 true) · 없으면 null
function olderThan(before, byId = null) {
  const b = String(before || '').trim()
  if (!b) return null
  const hit = byId?.get(b)
  const [d, id] = hit ? [hit.date, hit.id] : b.includes('|') ? [b.slice(0, b.indexOf('|')), b.slice(b.indexOf('|') + 1)] : [b.replace('T', ' '), null]
  if (id == null) return (w) => w.date < d
  return (w) => w.date < d || (w.date === d && w.id < id)
}
const sinceDays = (days) => {
  const n = Number(days)
  if (!(n > 0)) return null
  const t = new Date(Date.now() - n * 864e5)
  const p = (x) => String(x).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
}

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  // https 로 온 요청(Q68) — 들어가기 쿠키에 Secure 를 붙인다(http 로 다시 나가지 않게)
  if (res.kmdSecure && extra['set-cookie']) extra = { ...extra, 'set-cookie': [].concat(extra['set-cookie']).map((c) => /;s*Secure/i.test(c) ? c : c + '; Secure') }
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

// 주소 조각 풀기 — 잘못된 % 열(%E0 등)은 URIError(500) 가 아니라 입력 오류로
const dec = (s) => {
  try {
    return decodeURIComponent(s)
  } catch {
    throw new KmdError('E_INPUT', '주소 모양이 아니다')
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

// 설명서 — 저장소 · 꾸러미의 docs_ops/manual/<이름>.html 을 화면 밖 한 벌로(들어오지 않아도 본다 · 비밀이 아니다).
//   설명서 파일은 <article class="man"> 하나만 싣고, 머리 띠 · 왼쪽 길잡이(설명서 목록 · 이 설명서의 차례) · 앞뒤는 여기서 두른다.
//   그림은 docs_ops/manual/img(설명서 안에서 img/… 로 · /manual/img/… 로 낸다). 이 서버 갈래에 없는 설명서로 가는 링크는 글만 남긴다
const MANUAL_DIR = path.join(APP, '..', 'docs_ops', 'manual')
const MANUALS = [
  { slug: '사용자', title: '쓰는 사람', sub: '팀 화면에서 보기 · 찾기 · 고치기 · 가져오기', img: 't-doc.png', modes: ['team'] },
  { slug: '개인', title: '개인 프로그램', sub: '내 PC 의 kmd · 파일 넣기 · 지식 보내기', img: 'p-home.png', modes: ['team', 'pc'] },
  { slug: '지식관리자', title: '지식관리자', sub: '정리 · 권한 · 가져올 곳', img: 't-tidy.png', modes: ['team'] },
  { slug: '관리자', title: '총괄 관리자', sub: '설치 · 사람 · Claude 연결 · 백업 · 셸 명령', img: 't-people.png', modes: ['team'] },
  { slug: '운영', title: '운영 · 되살리기', sub: '밤 묶음 · 되살리기 · 새 판', img: 't-admin.png', modes: ['team', 'pc'] },
]
const MANUAL_IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' }
// 서버가 그리는 페이지(설명서 · 확인 · 받기)도 화면과 같은 토큰을 쓴다. 이 페이지들의 CSP 는 바깥 CSS 를 막으니(style-src 'unsafe-inline')
// kmd.css 맨 위 :root(토큰의 유일한 자리)만 떼어 <style> 에 넣는다 — 값은 kmd.css 하나만 고친다
let pageRoot = ''
const pageRootP = fs.readFile(path.join(APP, 'kmd.css'), 'utf8').then((s) => { pageRoot = s.match(/:root\{[\s\S]*?\n\}/)?.[0] || '' }).catch((e) => console.error('kmd.css 를 읽지 못했다:', e.message))
const PAGE_CSS = `*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:var(--fs-md)/1.65 var(--font)}a{color:var(--accent)}h1{font-size:var(--fs-xl);line-height:1.35}h2{font-size:var(--fs-lg);margin-top:26px}main{max-width:var(--w-text);margin:0 auto;padding:var(--sp-9) var(--sp-8) 60px;background:var(--surface);min-height:100vh;min-height:100dvh;overflow-wrap:anywhere}nav{font-size:var(--fs);color:var(--text-2);margin-bottom:18px;padding-bottom:var(--sp-5);border-bottom:1px solid var(--border)}table{border-collapse:collapse;width:100%;max-width:100%;font-size:var(--fs);display:block;overflow-x:auto}th,td{border:1px solid var(--border);padding:5px var(--sp-4);text-align:left;vertical-align:top;overflow-wrap:normal;min-width:4em}th{background:var(--surface-2)}code{font:var(--fs-mono) var(--mono);background:var(--surface-2);padding:1px 5px;border-radius:var(--r-xs)}pre{background:var(--surface-2);border:1px solid var(--border);padding:var(--sp-5) var(--sp-6);border-radius:var(--r);overflow-x:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:var(--fs-mono)/1.55 var(--mono)}pre code{background:none;padding:0}img{max-width:100%;height:auto}.m{color:var(--text-3);font-size:var(--fs)}button{font:inherit;height:34px;padding:0 var(--sp-8);border-radius:var(--r);border:1px solid var(--border-strong);background:var(--surface);color:var(--text);cursor:pointer}button:hover{background:var(--hover)}button.ok{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}button.ok:hover{background:var(--accent-hover)}a:focus-visible,button:focus-visible{outline:0;box-shadow:var(--focus-ring)}@media (max-width:600px){main{padding:var(--sp-7) var(--sp-6) 40px}}`
let manualCss = null
const manualCssOf = async () => (manualCss ??= await fs.readFile(path.join(MANUAL_DIR, 'manual.css'), 'utf8').catch((e) => { console.error('설명서 모양(manual.css)을 읽지 못했다:', e.message); return '' }))
const manualHref = (x) => `/manual/${encodeURIComponent(x.slug)}`
// 설명서 한 장 — slug 가 없으면 고르는 첫 장 · <이름> 과 <이름>.html 을 같이 받는다 · 이 갈래에 없으면 null(404)
async function manualPage(mode, slug) {
  await pageRootP
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])
  const list = MANUALS.filter((m) => m.modes.includes(mode))
  const name = slug ? String(slug).replace(/\.html$/i, '') : null
  const m = name ? list.find((x) => x.slug === name) : null
  if (name && !m) return null
  const page = (title, crumb, nav, body) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>${pageRoot}${css}</style></head><body>
<header class="mtop"><a class="m-brand" href="/manual"><span class="m-logo">K</span>kmd 설명서</a>${crumb ? `<span class="m-crumb">› ${esc(crumb)}</span>` : ''}<span class="m-sp"></span><a class="m-back" href="/">kmd 화면으로</a></header>
<div class="mwrap"><nav class="mnav" aria-label="설명서">${nav}</nav><main class="mmain">${body}</main></div></body></html>`
  const css = await manualCssOf()
  const mans = (cur) => `<h4 class="h-mans">설명서</h4><ul class="mans">${list.map((x) => `<li><a href="${manualHref(x)}"${x === cur ? ' aria-current="page"' : ''}>${esc(x.title)}<small>${esc(x.sub)}</small></a></li>`).join('')}</ul>`
  if (!m) {
    const cards = list.map((x) => `<a class="m-card" href="${manualHref(x)}"><img src="/manual/img/${esc(x.img)}" alt="" loading="lazy"><b>${esc(x.title)}</b><p>${esc(x.sub)}</p></a>`).join('')
    const body = `<div class="m-hero"><h1>kmd 설명서</h1><p>${mode === 'team' ? '팀 지식을 읽고 고치고, Claude Code 가 같은 지식으로 일하게 하는 팀 서버' : '내 PC 에서 개인 지식을 읽고 고치는 개인 프로그램'}의 쓰는 법이다. 나에게 맞는 설명서를 고른다. 들어오지 않아도 본다.</p></div>
<section><h2>설명서 고르기</h2><div class="m-cards">${cards}</div></section>
${mode === 'team' ? `<section><h2>누가 무엇을 읽나</h2><article class="man"><div class="m-tbl"><table><tr><th>나는</th><th>먼저 읽을 것</th><th>다음</th></tr>
<tr><td>팀 지식을 보고 고치는 사람(읽기 · 쓰기 자리)</td><td><a href="${manualHref(MANUALS[0])}">쓰는 사람</a></td><td><a href="${manualHref(MANUALS[1])}">개인 프로그램</a></td></tr>
<tr><td>지식 하나를 맡은 사람(지식관리자 · 주인)</td><td><a href="${manualHref(MANUALS[2])}">지식관리자</a></td><td><a href="${manualHref(MANUALS[0])}">쓰는 사람</a></td></tr>
<tr><td>팀 서버를 세우고 사람을 더하는 사람</td><td><a href="${manualHref(MANUALS[3])}">총괄 관리자</a></td><td><a href="${manualHref(MANUALS[4])}">운영 · 되살리기</a></td></tr></table></div></article></section>` : ''}
<p class="m-foot">kmd ${esc(VERSION)} · 화면 오른쪽 위 「설명서」 로 언제든 다시 연다</p>`
    return page('kmd 설명서', '', mans(null), body)
  }
  const src = await fs.readFile(path.join(MANUAL_DIR, `${m.slug}.html`), 'utf8').catch((e) => { console.error(`설명서 ${m.slug} 를 읽지 못했다:`, e.message); return null })
  const art = src?.match(/<article class="man"[\s\S]*<\/article>/)?.[0]
  if (!art) return null
  // 이 갈래에 없는 설명서로 가는 링크는 글만 · 있는 것은 /manual/<이름>
  const body = art.replace(/<a href="([^"#/:]+)\.html(#[^"]*)?">([\s\S]*?)<\/a>/g, (_, f, h, t) => { const x = list.find((y) => y.slug === f); return x ? `<a href="${manualHref(x)}${h || ''}">${t}</a>` : t })
  const toc = [...body.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map(([, id, t]) => `<li><a href="#${esc(id)}">${t.replace(/<span class="m-no">[^<]*<\/span>/, '').replace(/<[^>]+>/g, '').trim()}</a></li>`).join('')
  const i = list.indexOf(m), prev = list[i - 1], next = list[i + 1]
  const pager = `<nav class="m-pager" aria-label="앞뒤 설명서">${prev ? `<a href="${manualHref(prev)}"><small>앞</small>‹ ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="m-nx" href="${manualHref(next)}"><small>다음</small>${esc(next.title)} ›</a>` : ''}</nav>`
  return page(`kmd 설명서: ${m.title}`, m.title, `${mans(m)}<div class="toc-wide"><h4>이 설명서의 차례</h4><ul class="toc">${toc}</ul></div><details class="toc-narrow"><summary>이 설명서의 차례</summary><ul class="toc">${toc}</ul></details>`, body + pager)
}
// 설명서 그림 — docs_ops/manual/img 의 이름만(경로 조각 없음)
async function manualImg(name) {
  const ext = /^[A-Za-z0-9_-]{1,80}\.(png|jpe?g|svg)$/.exec(name)?.[1]
  if (!ext) return null
  const buf = await fs.readFile(path.join(MANUAL_DIR, 'img', name)).catch(() => null)
  return buf && { buf, type: MANUAL_IMG[ext] }
}

// 설치 한 줄의 PowerShell 본문 — kmd 가 있으면 잇기만 · 없으면 받기 → 풀기(<집>/versions/<판>) → 실행기 · 사용자 PATH → 잇기.
// 시험은 KMD_APP_HOME(집) · KMD_NO_PATH(사용자 PATH 를 건드리지 않는다)로 이 PC 를 바꾸지 않고 돌린다
// kn — 팀 지식 id 잣대(팀 에이전트 설치 한 줄 · core/teamkit.js). 개인 프로그램 설치 한 줄은 작업 폴더를 팀 지식에 붙이지 않는다
export const safeKn = (kn) => (/^[^\s'"`$\\;|&<>(){}]{1,80}$/u.test(String(kn || '')) ? String(kn) : null)
// root — 지식 폴더(팀 화면 › 지식 목록 › 개인 칸 띠에서 쓴 경로). 그 폴더에 세우거나(없거나 빈 폴더) 있던 지식 폴더를 그대로 쓴다.
//   Windows(D:\…) · POSIX(/…) 절대 경로만 · 따옴표 · 셸 글자 · 줄바꿈은 받지 않는다(PowerShell · sh 의 홑따옴표 안에 싣는다)
export const safeRoot = (r) => {
  const s = String(r || '').trim()
  return s.length <= 240 && /^([A-Za-z]:\\|\/)/.test(s) && !/['"`$;|&<>\u0000-\u001f]/u.test(s) ? s : null
}
export function installPs({ origin, ticket, pkg, root = null }) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'"
  const L = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$o = ${q(origin)}; $t = ${q(ticket)}`,
    '$k = Get-Command kmd -ErrorAction SilentlyContinue',
    '$fresh = $false',
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
      "  if (Test-Path $e) { $k = $e; $env:Path = \"$(Split-Path $e);$env:Path\"; Write-Host '· 이 PC 에 이미 깐 kmd 를 쓴다' } else {",
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
      '  $fresh = $true',
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
      // 이미 깐 개인 프로그램 — 팀 서버의 판보다 옛 판이면 그 판으로 올린다(kmd pc update: 새 판을 켜 보고 · 지금 판과 실행기를 바꾸고 ·
      //   다시 켠다 · 안 켜지면 앞 판 그대로). 판 이름 <판>-<날짜>-<시각> 끼리는 글자 차례가 곧 새 차례 · 그 꼴이 아닌 옛 이름은 옛 판으로 본다
      "$a = if ($env:KMD_APP_HOME) { $env:KMD_APP_HOME } else { Join-Path $env:USERPROFILE '.kmd-app' }",
      "$e = Join-Path $a 'bin\\kmd.cmd'",
      `$v = ${q(pkg.ver)}; $n = ${q(pkg.name)}`,
      'if (-not $fresh -and (Test-Path $e)) {',
      '  $cur = $null',
      "  try { $cur = (Get-Content (Join-Path $a 'current.json') -Raw -Encoding UTF8 | ConvertFrom-Json).ver } catch { $cur = $null }",
      "  $st = '^\\d+\\.\\d+\\.\\d+-\\d{8}-\\d{4}$'",
      '  $old = (-not $cur) -or ($cur -ne $v -and (-not ($cur -match $st) -or [string]::CompareOrdinal($v, $cur) -gt 0))',
      '  if ($old) {',
      '    Write-Host "개인 프로그램을 팀 서버의 판으로 올린다: $cur → $v"',
      '    $z = Join-Path $env:TEMP $n',
      '    Invoke-WebRequest "$o/dl/$n" -OutFile $z -UseBasicParsing',
      '    $x = Join-Path $env:TEMP "kmd-up-$v"',
      '    if (Test-Path $x) { Remove-Item $x -Recurse -Force }',
      '    New-Item -ItemType Directory -Force $x | Out-Null',
      "    $tar = Join-Path $env:SystemRoot 'System32\\tar.exe'",
      '    $ok = $false',
      '    if (Test-Path $tar) { & $tar -xf $z -C $x --strip-components 1; $ok = ($LASTEXITCODE -eq 0) }',
      '    if (-not $ok) { Remove-Item $x -Recurse -Force; Expand-Archive $z $x -Force; $x = (Get-ChildItem $x -Directory | Select-Object -First 1).FullName }',
      '    & $e pc update $x $v',
      '    if ($LASTEXITCODE) { Write-Host "· 새 판으로 올리지 못했다. 앞 판 그대로 쓴다 · 이 줄을 다시 붙여 넣거나 관리자에게 알린다" } else { Write-Host "✓ 개인 프로그램을 팀 서버의 판으로 올렸다: $v" }',
      '    Remove-Item $z -Force -ErrorAction SilentlyContinue',
      '  } else { Write-Host "· 개인 프로그램은 이미 팀 서버의 판이다: $cur" }',
      '  $k = $e',
      '} elseif ($k -and -not $fresh) { Write-Host "· 이 kmd 는 손으로 푼 꾸러미다. 새 판은 그 폴더의 kmd.cmd pc update 로 올린다" }',
    )
  }
  L.push(`if ($k) { & $k connect $o --ticket $t${root ? ' --root ' + q(root) : ''} }`, '')
  return L.join('\r\n')
}

export async function startServer({ root, data = null, mode = 'team', user = os.userInfo().username, host = '127.0.0.1', port = 7373, log, scryptN = null, onStop = null, onRoot = null }) {
  const dataDir = data || defaultDataDir(root)
  const pcUser = mode === 'pc' ? String(user).toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'me' : null
  const hub = await makeHub({ root, dataDir, mode, pcUser, log })
  const auth = await makeAuth({ dataDir, mode, scryptN: scryptN || hub.config.scryptN || null })
  hub.admins = () => auth.users().filter((u) => u.admin && !u.off && u.kind === 'person').map((u) => u.id)
  hub.people = () => auth.people()
  const mcp = makeMcp(hub)
  if (pcUser) await auth.ensurePc(pcUser)
  const teamLogin = makeTeamLogin({ dataDir })
  // 받기 자리의 PC 꾸러미 — kmd-<판>-pc.zip · 이 서버와 같은 판을 먼저, 없으면 가장 높은 판
  const dlDir = () => path.resolve(hub.config.dl || path.join(dataDir, 'dl'))
  const pcPackage = async () => {
    const all = (await fs.readdir(dlDir()).catch(() => [])).map((n) => [n, n.match(/^kmd-([0-9A-Za-z._-]{1,40})-pc\.zip$/i)]).filter(([, m]) => m).map(([name, m]) => ({ name, ver: m[1] }))
    return all.find((x) => x.ver === BUILD) || all.find((x) => x.ver === VERSION) || all.sort((a, b) => b.ver.localeCompare(a.ver, undefined, { numeric: true }))[0] || null
  }
  // 이 PC — 프로그램 안에서 받은 Claude 로그인(비밀 claude-token)을 이 프로그램이 부르는 Claude 에만
  if (mode === 'pc') getSecret(dataDir, 'claude-token').then((t) => { if (t) process.env.CLAUDE_CODE_OAUTH_TOKEN = t }, () => {})

  // 이 PC 가 이은 팀 주소(kmd connect 가 적은 <data>/teams.json) — 설정 · 에이전트 설치가 읽는다
  const teamsFile = path.join(dataDir, 'teams.json')
  const teamsOf = async () => (await fs.readFile(teamsFile, 'utf8').then(JSON.parse, () => [])).map((u) => { try { return new URL(u).origin } catch { return null } }).filter(Boolean)
  // 다른 출처에서 온 요청 — 개인 프로그램은 살아 있나(/healthz)만 연다 · 팀 화면은 개인 프로그램을 부르지 않는다(분리)
  async function crossOrigin(req, res, p) {
    const origin = req.headers.origin
    if (mode !== 'pc' || !origin || sameOrigin(req)) return null
    if (p === '/healthz') { res.setHeader('access-control-allow-origin', '*'); return { open: true } }
    throw new KmdError('E_FORBIDDEN', '다른 화면에서 온 요청은 받지 않는다. 개인 화면(시작 메뉴 › kmd)에서 한다')
  }
  // 프록시 뒤 — x-forwarded-for 의 왼쪽 값은 보내는 사람이 꾸밀 수 있다. 우리 프록시가 붙인 오른쪽 끝에서 센다
  //   trustProxy: true 는 프록시 하나 · 숫자면 그만큼(프록시가 여럿 겹친 때)
  const ipOf = (req) => {
    const tp = hub.config.trustProxy
    const xs = tp && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',').map((x) => x.trim()).filter(Boolean) : []
    if (!xs.length) return req.socket.remoteAddress
    const hops = Number.isInteger(tp) && tp > 0 ? tp : 1
    return xs[Math.max(0, xs.length - hops)]
  }

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
    if (!ctx.admin) throw new KmdError('E_FORBIDDEN', '총괄 관리자만 한다')
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
    /^\/api\/(me|today|history|people|logs|sources|settings|agent|knowledge|runs|stops|find|requests|me\/devices|admin\/overview|admin\/users|admin\/groups|claude\/state|busy|send\/teams)$/,
    /^\/api\/admin\/users\/[^/]+\/seats$/, /^\/api\/job\/[0-9a-f]+$/, /^\/api\/runs\/[0-9a-f]{12}$/, /^\/api\/queue$/, /^\/api\/queue\/[0-9a-f]{12}$/, /^\/api\/confirm\/[A-Za-z0-9_-]{6,40}$/, /^\/api\/pc\/root$/,
    /^\/api\/k\/[^/]+\/(tree|doc|rec|att|model|item|diff|tidy|tidy\/plan|sources|send|backup|backup\/lost|owner|access|worker\/material|guard)$/,
  ]
  const api = async (req, res, url, ctx, set) => {
    const p = url.pathname
    const out = (status, body) => send(res, status, body, undefined, set ? { 'set-cookie': set } : {})
    // 읽기 길만 GET — 그 밖은 모두 POST(글 속 그림 한 줄 ![](/api/…) 이 연 사람의 쿠키로 나가기 · 비밀번호 지우기 · 관리자 해제를 부르지 않게)
    if (req.method !== 'POST' && !(['GET', 'HEAD'].includes(req.method) && GET_OK.some((re) => re.test(p)))) throw new KmdError('E_METHOD', 'POST 로 보낸다')
    if (ctx?.agent) throw new KmdError('E_FORBIDDEN', '에이전트 열쇠는 MCP 길만 쓴다')
    if (p === '/api/me') {
      if (!ctx) return out(200, { mode, anon: true, setup: !auth.hasUsers(), legacy: auth.legacyWaiting(), version: VERSION, host: req.headers.host })
      return out(200, { mode, user: ctx.user, admin: !!ctx.admin, sudo: !!ctx.sudo, password: ctx.password !== false, version: VERSION, host: req.headers.host, ...(mode === 'pc' ? { root: path.resolve(root), ...(isNoneRoot(root) ? { none: true } : {}) } : {}), ...(mode === 'team' && ctx.admin ? { root: path.resolve(root) } : {}) })
    }
    // 이 PC 의 지식 폴더 바꾸기 — 그 폴더에 .kmd 가 있으면 그대로 잇고 · 없거나 빈 폴더면 새로 세운다 · 다른 파일만 있는 폴더는 받지 않는다.
    //   고른 폴더는 이 PC 의 「지식 폴더 표」 에 적고 kmd 가 그 폴더로 다시 켜진다(onRoot).
    //   { none: true } — 지식 폴더 빼기: 빈자리 폴더로 다시 켜진다(폴더의 파일은 그대로 · 팀 연결 · 내 Claude 는 그대로). 이은 팀 · 내 Claude 로그인은 새 곳으로 함께 간다
    if (p === '/api/pc/root') {
      if (mode !== 'pc') throw new KmdError('E_NOTFOUND', '이 PC 의 길이다')
      need(ctx)
      if (req.method === 'GET') return out(200, { root: path.resolve(root), ...(isNoneRoot(root) ? { none: true } : {}) })
      const b = await readBody(req)
      const want = b.none === true ? noneRoot() : String(b.root || '').trim()
      if (want && path.isAbsolute(want) && path.resolve(want).toLowerCase() === path.resolve(root).toLowerCase()) return out(200, { root: path.resolve(want), same: true })
      const { root: full, kind } = b.none === true ? { root: path.resolve(want), kind: 'none' } : pcRootKind(want)
      if (!onRoot) throw new KmdError('E_NOTFOUND', '이 kmd 는 지식 폴더를 바꿔 다시 켜지 못한다. kmd up <폴더> 로 켠다')
      await fs.mkdir(path.join(full, '.kmd'), { recursive: true })
      carryPcData(dataDir, path.join(full, '.kmd'))
      out(200, { root: full, kind })
      setTimeout(() => onRoot(full), 200)
      return
    }
    // 이 PC 화면의 한 번용 번호 · 멈추기 — `kmd open` · `kmd pc update` 가 이 PC 의 열쇠(자격 저장소의 기기 열쇠)로 부른다.
    // 같은 PC 의 같은 OS 사용자만 그 열쇠를 푼다
    if (mode === 'pc' && (p === '/api/pc/once' || p === '/api/pc/stop')) {
      need(ctx)
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      if (ctx.user !== pcUser) throw new KmdError('E_FORBIDDEN', '개인 프로그램만 한다')
      if (p === '/api/pc/once') return out(200, { code: auth.once(pcUser) })
      if (!onStop) throw new KmdError('E_NOTFOUND', '이 kmd 는 여기서 멈추지 않는다')
      out(200, { ok: true })
      setTimeout(() => onStop(), 200)
      return
    }
    // 기계 열쇠 — 그 지식의 기준선 길 하나만(E6 이 채운다)
    const bl = p.match(/^\/api\/k\/([^/]+)\/baseline$/)
    if (bl && ctx?.machine) {
      if (ctx.machine.kn !== dec(bl[1])) throw new KmdError('E_FORBIDDEN', '이 열쇠는 다른 지식의 것이다')
      if (!hub.baseline) throw new KmdError('E_NOTFOUND', '아직 없는 길이다')
      return out(200, await hub.baseline(ctx, dec(bl[1]), await readBody(req)))
    }
    // 정리 일꾼 — 일감 받기 · 상태 알리기(kmdw_) · 재료 · 초안(kmdd_)
    if (p === '/api/worker/next' || p === '/api/worker/status') {
      if (!ctx?.worker) throw new KmdError('E_FORBIDDEN', '정리 일꾼 열쇠로 부른다')
      if (p === '/api/worker/next') return out(200, hub.workerNext(ctx) || { job: null })
      return out(200, await hub.workerStatus(ctx, await readBody(req)))
    }
    const wk = p.match(/^\/api\/k\/([^/]+)\/worker\/(material|drafts|progress|agent|agent\/log|agent\/done)$/)
    if (wk) {
      if (!ctx?.draft) throw new KmdError('E_FORBIDDEN', '이 일감의 열쇠로 부른다')
      if (wk[2] === 'material') return out(200, await hub.material(ctx, dec(wk[1])))
      if (wk[2] === 'progress') return out(200, hub.workerProgress(ctx, dec(wk[1]), await readBody(req)))
      // 넣은 파일 하나를 에이전트로 — 일 받기 · 줄 올리기 · 끝(요구 v0.2 F)
      if (wk[2] === 'agent') return out(200, await hub.workerAgent(ctx, dec(wk[1]), await readBody(req)))
      if (wk[2] === 'agent/log') return out(200, hub.workerAgentLog(ctx, dec(wk[1]), await readBody(req, 4 << 20)))
      if (wk[2] === 'agent/done') return out(200, await hub.workerAgentDone(ctx, dec(wk[1]), await readBody(req)))
      // 자리 수백 개의 초안 · part — 자리 하나를 쓰는 대로(일감은 끝나지 않는다)
      const db = await readBody(req, 32 << 20)
      return out(200, await hub.drafts(ctx, dec(wk[1]), db.drafts, { part: !!db.part, fix: !!db.fix }))
    }
    need(ctx)
    if (p === '/api/today') return out(200, await hub.today(ctx))
    if (p === '/api/history') return out(200, await hub.history(ctx))
    // 사람 목록 — 아이디만(지식관리자(예전 정리하는 사람) 고르기)
    if (p === '/api/people') return out(200, auth.people())
    const dm = p.match(/^\/api\/k\/([^/]+)\/diff$/)
    if (dm) return out(200, await hub.diff(ctx, dec(dm[1]), url.searchParams.get('record') || ''))
    const jm = p.match(/^\/api\/job\/([0-9a-f]+)$/)
    if (jm) return out(200, hub.jobFor(ctx, jm[1]) || { state: 'gone' }) // 그 지식을 읽는 사람만(아니면 404)
    // 자동으로 가져올 곳 — 목록 · 더하기(관리자 · PC) · 살펴보기 · 지금 가져오기 · 관리자에게 부탁
    // 이력 — 보는 지식들의 kmd 가 한 일(가져옴 · 가져올 곳 · 바로 고침 · 정리) 한 곳에 · 새 것 위
    if (p === '/api/logs') {
      // 지식마다 거른 뒤 최근 limit 만 합친다(모두 모아 자르지 않게) · more — 거른 것 가운데 이번에 싣지 않은 수 · next — 다음 ?before=
      const limit = pageLimit(url, 300)
      const older = olderThan(url.searchParams.get('before'))
      const since = sinceDays(url.searchParams.get('days'))
      const rows = []
      let total = 0
      for (const m of await hub.visible(ctx)) {
        const k = await hub.get(m.id, ctx)
        const logs = older || since ? k.logs.filter((w) => (!older || older(w)) && (!since || w.date >= since)) : k.logs
        total += logs.length
        rows.push(...V.logRows({ id: k.id, name: k.name, logs }, { limit }))
      }
      rows.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      const items = rows.slice(0, limit)
      const more = total - items.length
      return out(200, { items, more, next: more > 0 && items.length ? cursorOf(items[items.length - 1]) : null })
    }
    // can — 가져올 곳을 더할 수 있는 지식이 하나라도 있나(지식마다는 items 의 can)
    if (p === '/api/sources') {
      const items = (await hub.allSources(ctx)).map((s) => ({ ...s, can: hub.canSource(ctx, s.kn) }))
      return out(200, { items, can: hub.mode === 'pc' || !!ctx.admin || (await hub.visible(ctx)).some((k) => hub.canSource(ctx, k.id)) })
    }
    // ── 설정(S7) — 이 팀 서버 · 이 PC · 저절로 하는 일 · Claude 연결 · 에이전트 설치 ──
    if (p === '/api/settings') {
      const ks = await hub.visible(ctx)
      const bk = ks.map((k) => hub.backupStateSync(k)).filter(Boolean)
      const ws = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => null)
      const keys = mode === 'pc' ? ['save', 'file', 'src', 'claude', 'find'] : ['file', 'find']
      const month = new Date().toISOString().slice(0, 7)
      // 이달 정리 수(Q64) — 지식마다 읽은 지식(같은 것이면 다시 세지 않는다)에 기대어 동시에 센다
      const tidied = (await Promise.all(ks.map(async (k) => {
        const kn = await hub.get(k.id)
        const c = tidiedC.get(k.id)
        if (c?.kn === kn && c.month === month) return c.n
        const n = kn.logs.filter((w) => w.tags.includes('curate-llm') && String(w.date).startsWith(month)).length
        tidiedC.set(k.id, { kn, month, n })
        return n
      }))).reduce((a, b) => a + b, 0)
      return out(200, {
        host: req.headers.host,
        root: mode === 'pc' ? path.resolve(root) : undefined,
        kns: ks.length,
        backup: { n: bk.length, of: ks.length, urls: [...new Set(bk.map((b) => b.url))].slice(0, 3), bad: bk.filter((b) => b.verdict && b.verdict !== 'ok' && b.verdict !== 'lag').length, ...(mode === 'pc' ? { root: hub.config.backupRoot || null, list: ks.map((k) => { const b = hub.backupStateSync(k); return { id: k.id, name: k.name, url: b?.url || null, verdict: b?.verdict || null } }) } : {}) },
        teams: mode === 'pc' ? await teamsOf() : undefined,
        auto: Object.fromEntries(keys.map((x) => [x, hub.autoOf(ctx.user, x)])),
        ...(mode === 'pc' ? { models: hub.models() } : {}),
        claude: { off: !!process.env.KMD_NO_CLAUDE && !process.env.KMD_CLAUDE, worker: ws, month: tidied, token: !!(await getSecret(dataDir, 'claude-token').catch(() => null)), team: mode === 'team' ? { token: !!(await getSecret(dataDir, 'claude-token').catch(() => null)), flow: teamLogin.state, kind: teamLogin.kind } : undefined },
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
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '팀 정리 로그인은 설정 · 팀 › Claude 연결에서')
      return out(200, pcLogin())
    }
    // 이 PC — 로그인 확인(작은 부르기 한 번) · 됐으면 쉼 줄을 걷는다
    if (p === '/api/claude/check' && req.method === 'POST') {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '팀 정리 로그인은 설정 · 팀 › Claude 연결에서')
      const r = await checkClaude()
      await hub.workerStatus({ worker: { id: null } }, r.ok ? { ok: true } : { ok: false, reason: r.reason, message: r.message })
      return out(200, { ok: r.ok, reason: r.reason || null })
    }
    // 개인 에이전트 설치 — 이 PC 의 작업 폴더마다(개인 스킬 · 연결 kmd · CLAUDE.md 안 kmd 덩이 · 이 폴더의 개인 지식 표)
    //   한 폴더에 개인 지식 여럿 · 팀 지식은 따로(팀 화면 › 설정 › 에이전트 설치 · core/teamkit.js) — 여기서는 건드리지 않는다
    //   떼기(rm + kn)는 지식 하나 · 마지막 하나를 떼거나 kn 없이 rm 이면 폴더째 뺀다
    const ag = p.match(/^\/api\/agent(?:\/(add|up|rm))?$/)
    if (ag) {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '에이전트 설치는 개인 프로그램이 한다. 팀 화면은 설치 한 줄 복사')
      const list = await kit.folders(dataDir)
      if (!ag[1]) return out(200, { latest: await kit.kitVersion(), folders: await Promise.all(list.map(async (f) => ({ ...f, ...(await kit.status(f.path)) }))) })
      const b = await readBody(req)
      const urls = (f) => ({ meUrl: `http://${req.headers.host}`, kns: f.kns || [] })
      const same = (f, dir) => path.resolve(f.path).toLowerCase() === path.resolve(String(dir)).toLowerCase()
      if (ag[1] === 'add') {
        // 개인 지식 하나를 더한다 — 같은 폴더면 붙어 있던 개인 지식은 그대로
        const kn = String(b.kn || '')
        const k = kn ? (await hub.list()).find((x) => x.id === kn) : null
        if (kn && !k) throw new KmdError('E_INPUT', `「${kn}」 개인 지식이 없다`)
        const cur = b.dir ? list.find((f) => same(f, b.dir)) : null
        const base = cur || { name: '', path: String(b.dir || ''), at: new Date().toISOString(), kns: [] }
        const row = k ? kit.addKn(base, { area: 'me', kn: k.id, knName: k.name }) : base
        const r = await kit.install(String(b.dir || ''), urls(row))
        const next = { ...row, name: path.basename(r.dir), path: r.dir }
        await kit.setFolders(dataDir, cur ? list.map((f) => (f === cur ? next : f)) : [...list, next])
        return out(200, { ...r, ...(cur ? { again: true } : {}) })
      }
      const pick = b.dir ? list.filter((f) => same(f, b.dir)) : list
      if (ag[1] === 'up') { for (const f of pick) await kit.install(f.path, urls(f)); return out(200, { n: pick.length }) }
      if (ag[1] === 'rm' && b.kn) {
        const f = pick[0]
        if (!b.dir || !f) throw new KmdError('E_NOTFOUND', '붙인 폴더가 아니다')
        const next = kit.dropKn(f, String(b.kn))
        if (next.kns.length) {
          await kit.install(f.path, urls(next))
          await kit.setFolders(dataDir, list.map((x) => (x === f ? next : x)))
          return out(200, { n: 1, kns: next.kns })
        }
      }
      for (const f of pick) await kit.remove(f.path)
      await kit.setFolders(dataDir, list.filter((f) => !pick.includes(f)))
      return out(200, { n: pick.length })
    }
    // 관리 — 문제 줄만 · 정리 전용 로그인 · 링크 한꺼번에
    if (p === '/api/admin/overview') {
      admin(ctx, { sudo: false })
      const users = auth.users()
      const ws = await fs.readFile(path.join(dataDir, 'worker.json'), 'utf8').then(JSON.parse, () => null)
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
        sources: (await hub.allSources(ctx)).map((s) => ({ name: s.name, kn: s.knName, last: s.state?.checkedAt || null })),
        backups: ks.map((k) => ({ id: k.id, name: k.name, ...(hub.backupStateSync(k) || { off: true }) })),
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
      if (r.ok) await hub.workerClear() // 쉼 줄을 걷는다(파일 · 메모리 둘 다) — 다음 일감에서 다시 잰다
      return out(200, { ok: r.ok, ...(r.again ? { again: true, url: r.url, why: r.why } : {}) })
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
      if (bl2[2] === 'lost') return out(200, await hub.backupLost(ctx, dec(bl2[1])))
      return out(200, await hub.backupKeep(ctx, dec(bl2[1])))
    }
    const ba = p.match(/^\/api\/k\/([^/]+)\/backup\/adopt$/)
    if (ba && req.method === 'POST') {
      admin(ctx)
      return out(200, await hub.backupAdopt(ctx, dec(ba[1])))
    }
    // 옛 문서 옮기기(경과 → 참고 블록) — 그 지식의 관리 자리(총괄 관리자는 비밀번호 한 번 더) · { dry } 면 쓰지 않고 결과만
    const dfm = p.match(/^\/api\/k\/([^/]+)\/docfmt$/)
    if (dfm && req.method === 'POST') {
      if (ctx?.admin) admin(ctx)
      else need(ctx)
      return out(200, await hub.docfmt(dec(dfm[1]), ctx, { dry: !!(await readBody(req)).dry }))
    }
    // 지식 추가 — 새 이름 · 내 폴더(PC)
    if (p === '/api/knowledge/add') {
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      const b = await readBody(req)
      // 팀 프로그램 — 팀 지식만 · 관리자(개인 지식은 개인 프로그램에)
      need(ctx)
      // 지식 폴더를 뺀 개인 프로그램 — 폴더가 서기 전에는 지식을 만들지 않는다
      if (mode === 'pc' && isNoneRoot(root)) throw new KmdError('E_INPUT', '지식 폴더가 없다. 지식 목록 › 지식 폴더에 경로를 쓰고 세운다')
      if (mode === 'team') admin(ctx, { sudo: false })
      return out(200, await hub.addKnowledge(ctx, b))
    }
    const sm = p.match(/^\/api\/k\/([^/]+)\/sources(?:\/(probe|run|request|every|checkdb|resync|meaning|edit|remove))?$/)
    if (sm) {
      const id = dec(sm[1])
      if (req.method === 'GET' && !sm[2]) return out(200, await hub.sources(ctx, id))
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      const b = await readBody(req, sm[2] === 'request' ? 64 << 10 : MAX_BODY) // 부탁은 작은 카드 하나
      if (sm[2] === 'every') return out(200, await hub.sourceEvery(ctx, id, b))
      if (sm[2] === 'edit') return out(200, await hub.sourceEdit(ctx, id, b))
      if (sm[2] === 'remove') return out(200, await hub.sourceRemove(ctx, id, { name: String(b.name || ''), copies: b.copies === 'drop' ? 'drop' : 'keep' }))
      if (sm[2] === 'checkdb') return out(200, await hub.sourceCheckDb(ctx, id, b))
      if (sm[2] === 'resync') return out(200, await hub.sourceResync(ctx, id, String(b.name || '')))
      if (sm[2] === 'meaning') return out(200, await hub.sourceMeaning(ctx, id, { name: String(b.name || ''), on: !!b.on }))
      // 가져올 곳 관리(더하기 · 살펴보기 · 지금 가져오기 · 그대로 반영)는 그 지식의 관리 자리(docs/kmd_권한_모델.md 1절) · 쓰기는 부탁
      if (sm[2] === 'probe') {
        await hub.meta(id, ctx)
        if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', '가져올 곳은 그 지식의 지식관리자가 더한다')
        return out(200, await hub.sourceProbe(ctx, id, b))
      }
      if (sm[2] === 'request') return out(200, await hub.sourceRequest(ctx, id, b))
      if (sm[2] === 'run') {
        await hub.meta(id, ctx)
        if (!hub.canSource(ctx, id)) throw new KmdError('E_FORBIDDEN', b.force ? '[그대로 반영] 은 그 지식의 지식관리자가 한다' : '지금 가져오기는 그 지식의 지식관리자가 한다. [관리자에게 부탁]', { need: 'admin' })
        return out(200, await hub.sourceRun(id, b.name || null, { force: !!b.force, by: ctx.user }))
      }
      if (hub.mode === 'team' && !hub.canSource(ctx, id)) { await hub.meta(id, ctx); hub.need(ctx, id, 'admin') }
      return out(200, await hub.sourceAdd(ctx, id, b))
    }
    // 가져올 곳 부탁 — 총괄 관리자는 모두 · 그 밖은 관리 자리인 지식의 것만
    if (p === '/api/requests') {
      if (ctx.admin) return out(200, await hub.requests())
      return out(200, (await hub.requests()).filter((r) => hub.levelOf(ctx, r.kn) === 'admin'))
    }
    const rq = p.match(/^\/api\/requests\/([0-9a-f]{10})\/close$/)
    if (rq) {
      if (!ctx.admin) {
        const r = (await hub.requestsAll()).find((x) => x.id === rq[1])
        if (!r || hub.levelOf(ctx, r.kn) !== 'admin') throw new KmdError('E_FORBIDDEN', '그 지식의 지식관리자가 닫는다')
      }
      const b = await readBody(req)
      return out(200, await hub.requestClose(ctx, rq[1], { state: String(b.state || ''), why: b.why || '' }))
    }
    const tp = p.match(/^\/api\/k\/([^/]+)\/tidy\/plan$/)
    if (tp) return out(200, await hub.tidyPlan(ctx, dec(tp[1])))
    const rt = p.match(/^\/api\/k\/([^/]+)\/rec\/([^/]+)\/touches$/)
    if (rt) return out(200, await hub.setTouches(ctx, dec(rt[1]), dec(rt[2]), (await readBody(req)).coord))
    const tm = p.match(/^\/api\/k\/([^/]+)\/tidy$/)
    if (tm) {
      const id = dec(tm[1])
      if (req.method === 'POST') {
        const b = await readBody(req)
        return out(200, await hub.tidyNow(ctx, id, Array.isArray(b?.ids) ? { ids: b.ids.slice(0, 500) } : {}))
      }
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
        // 개인 화면의 개인 지식 — 받는 지식(보내는 길) · 보내지 않은 기록 수(옆 메뉴 「지식 보내기」 의 수)
        const row = hub.owner(k.id)
        const sv = mode === 'pc' && (await sendLib.destsOf(k.dir)).length ? await hub.sendView(ctx, k.id).catch(() => null) : null
        // level — 이 지식에서의 내 자리(read · write · admin) · role 은 그 화면 이름(PC 는 주인)
        return { ...V.knowledgeRow(k), level: hub.levelOf(ctx, k.id), role: hub.roleIn(k.id, ctx), ...(mode === 'pc' ? { dir: k.dir } : {}), ...(sv?.route ? { route: sv.route.kn, sendN: sv.recs.filter((r) => !r.sent).length, sendWait: sv.wait.length } : {}), ...(mode === 'team' ? { owner: row?.owner || null } : {}), tidyAt: hub.tidyAtOf(k.id), tidyMode: hub.tidyModeOf(k.id), pendText: hub.pendText(k.id), ...(menu.hidden.includes(k.id) ? { hidden: true } : {}) }
      })))
    }
    // 에이전트 일 — 목록 · 줄(터미널)
    if (p === '/api/busy') { need(ctx); return out(200, await hub.busy(ctx)) }
    if (p === '/api/runs') { need(ctx); return out(200, hub.runList(ctx, url.searchParams.get('k') || null)) }
    // 일 줄 — 들여오는 일 모두(가져오기 화면) · 일 하나의 줄(from 부터) · 손잡이 · 줄 멈춤 · 동시에 도는 수
    if (p === '/api/queue') { need(ctx); return out(200, await hub.queueList(ctx)) }
    if (p === '/api/queue/hold' && req.method === 'POST') { need(ctx); return out(200, hub.queueHold(ctx, !!(await readBody(req)).on)) }
    if (p === '/api/queue/caps' && req.method === 'POST') { need(ctx); return out(200, hub.queueCaps(ctx, await readBody(req))) }
    // 화면은 정리 일감 id 의 「t:」 를 %3A 로 보낸다
    const qa = p.replace(/^(\/api\/queue\/t)%3A/i, '$1:').match(/^\/api\/queue\/([0-9a-f]{12}|t:[0-9a-f]+)(?:\/(pause|resume|cancel|retry|force|top|move))?$/)
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
      // 붙일 팀 지식(에이전트 설치 · 팀) — 보이는 팀 지식만 · 그 한 줄은 /a/ (작업 폴더에 붙이기만 · 개인 프로그램을 깔지 않는다)
      const kb = req.method === 'POST' ? await readBody(req).catch((e) => { (log || console.error)('표: 본문을 읽지 못했다 ' + e.message); return {} }) : {}
      const kn = kb.kn ? safeKn(kb.kn) : null
      if (kb.kn && (!kn || !(await hub.visible(ctx)).some((k) => k.id === kn))) throw new KmdError('E_INPUT', '붙일 팀 지식이 없다')
      if (kn) return out(200, { ticket: t, line: `irm '${origin}/a/${t}?kn=${encodeURIComponent(kn)}' | iex`, sh: null, expires: 10, kn })
      // 지식 폴더(지식 목록 › 개인 칸) — 설치가 그 폴더에 세우거나 있던 지식 폴더를 그대로 쓴다
      const pr = kb.root ? safeRoot(kb.root) : null
      if (kb.root && !pr) throw new KmdError('E_INPUT', '이 PC 의 절대 경로를 쓴다(예: D:\\kmd) · 따옴표 · $ ; | & < > 는 쓰지 않는다')
      const qs = pr ? `root=${encodeURIComponent(pr)}` : ''
      const qk = qs ? '?' + qs : ''
      const qa = (s) => "'" + s + "'"
      return out(200, { ticket: t, line: qk ? `irm ${qa(`${origin}/i/${t}${qk}`)} | iex` : `irm ${origin}/i/${t} | iex`, sh: qk ? `curl -fsSL ${qa(`${origin}/i/${t}.sh${qk}`)} | sh` : `curl -fsSL ${origin}/i/${t}.sh | sh`, kmd: `kmd connect ${origin} --ticket ${t}${pr ? ` --root "${pr}"` : ''}`, expires: 10, kn: null, root: pr, pcVer: (await pcPackage())?.ver || null })
    }
    // 팀 에이전트 설치 — 붙여 넣은 폴더의 팀 덩이 · 옛 덩이를 받아 새 팀 덩이 · 스킬 · 헤더 도우미를 준다(core/teamkit.js)
    //   읽기 자리가 없는 지식은 붙이지 않는다(404) · 응답은 ASCII JSON(Windows PowerShell 5.1 이 charset 을 놓쳐도 한글이 그대로)
    if (p === '/api/agent/team-kit' && req.method === 'POST') {
      if (mode !== 'team') throw new KmdError('E_FORBIDDEN', '팀 서버의 길이다')
      need(ctx)
      const b = await readBody(req)
      const kn = safeKn(b.kn)
      const block = typeof b.block === 'string' ? b.block : ''
      const legacy = typeof b.legacy === 'string' ? b.legacy : ''
      if (!kn || block.length > 60000 || legacy.length > 60000) throw new KmdError('E_INPUT', '팀 지식 id · 안내 덩이 모양이 맞지 않는다')
      const visible = await hub.visible(ctx)
      const k = visible.find((x) => x.id === kn)
      if (!k) throw new KmdError('E_NOTFOUND', `「${kn}」 팀 지식이 없거나 읽을 자리가 없다`)
      const parts = await teamkit.teamKitParts()
      const kns = teamkit.teamKns({ old: block, legacy, add: kn, visible })
      const body = { block: teamkit.teamBlock(parts, kns), ver: parts.ver, skills: parts.skills, helper: teamkit.teamKeyHelperPs(), exeCs: KEY_EXE_CS, exeVer: KEY_EXE_VER, name: k.name, n: kns.length, dropLegacy: teamkit.legacyTeamOnly(legacy), legacy: !!legacy.trim(), oldSkills: teamkit.OLD_SKILLS }
      return send(res, 200, teamkit.asciiJson(body), undefined, set ? { 'set-cookie': set } : {})
    }
    if (p === '/api/me/devices') return out(200, auth.devices(ctx.user))
    if (p === '/api/me/devices/revoke') return out(200, { revoked: await auth.revokeDevice(ctx.user, String((await readBody(req)).id || '')) })
    if (p === '/api/me/logout-all') {
      await auth.logoutAll(ctx.user)
      return send(res, 200, { ok: true }, undefined, { 'set-cookie': auth.logoutCookie() })
    }
    // ── 관리 — 사람 ──
    if (p === '/api/admin/users') {
      // 사람 카드 — 사람마다 상태 · 기기 · 주인인 지식 수(이름은 싣지 않는다)
      if (req.method === 'GET') {
        admin(ctx, { sudo: false })
        const all = auth.users()
        const roles = await hub.peopleRoles()
        // roles.kns — 자리 있는 지식 수(주인 · 정리 · 사람 줄 · 묶음 줄)
        const people = all.filter((u) => u.kind === 'person' && !u.machine).map((u) => ({ ...u, roles: roles[u.id] || { team: 0, curate: 0, kns: 0 } }))
        return out(200, { users: people, locked: auth.locked() })
      }
      admin(ctx)
      const b = await readBody(req)
      // 지식마다 자리(seats: { 지식: 없음|읽기|쓰기|지식관리자 }) — 고르지 않은 지식은 없음(보이지 않는다) · 사람을 세우기 전에 모양을 본다
      const seats = b.seats == null ? {} : b.seats
      if (typeof seats !== 'object' || Array.isArray(seats)) throw new KmdError('E_INPUT', '자리는 { 지식: 자리 } 이다')
      const r = await auth.addUser({ id: b.id, admin: b.admin })
      const given = Object.keys(seats).length ? await hub.setSeats(ctx, r.id, seats) : { kns: [] }
      return out(200, { id: r.id, link: `http://${req.headers.host}/first#code=${r.code}`, kns: given.kns })
    }
    const am = p.match(/^\/api\/admin\/users\/([^/]+)\/(reset|unlock|revoke-all|logout-all|admin|off|seats)$/)
    if (am) {
      const id = dec(am[1])
      // 지식마다 자리 — 보기(GET) · 바꾸기(POST { seats })
      if (am[2] === 'seats') {
        if (req.method === 'GET') { admin(ctx, { sudo: false }); return out(200, { user: id, seats: await hub.seatsOf(ctx, id) }) }
        admin(ctx)
        return out(200, await hub.setSeats(ctx, id, (await readBody(req)).seats))
      }
      admin(ctx)
      // 떠남 — 들어가기 · 기기를 끊고 아이디를 남긴다 · 그 사람의 지식은 넘겨받거나(to: 'me') 주인 칸을 비운다(개인 지식은 관리자만)
      if (am[2] === 'off') {
        if (id === ctx.user) throw new KmdError('E_INPUT', '나 자신은 떠나게 하지 못한다. 다른 총괄 관리자가 한다')
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

    // ── 관리 — 묶음(사람 여럿에 한 번에 자리를) · 총괄 관리자 ──
    if (p === '/api/admin/groups') {
      if (req.method === 'GET') {
        admin(ctx, { sudo: false })
        return out(200, { groups: hub.groups(), people: auth.people() })
      }
      admin(ctx)
      const b = await readBody(req)
      return out(200, await hub.setGroup(ctx, { name: b.name, members: b.members }))
    }
    const gd = p.match(/^\/api\/admin\/groups\/([^/]+)\/delete$/)
    if (gd && req.method === 'POST') {
      admin(ctx)
      return out(200, await hub.dropGroup(ctx, dec(gd[1])))
    }
    // 지식의 자리 표 — 보기 · 바꾸기(그 지식의 관리 자리 · 총괄 관리자는 비밀번호 한 번 더)
    const ax = p.match(/^\/api\/k\/([^/]+)\/access$/)
    if (ax) {
      const id = dec(ax[1])
      if (req.method === 'GET') return out(200, await hub.accessView(ctx, id))
      const b = await readBody(req)
      await hub.meta(id, ctx)
      hub.need(ctx, id, 'admin')
      if (mode === 'team' && ctx.admin) admin(ctx)
      return out(200, await hub.setAccess(ctx, id, { all: b.all ?? undefined, users: b.users ?? undefined, groups: b.groups ?? undefined }))
    }
    // 파일 · 폴더 넣기 — { files: [{ path, b64 }] } · 한 번에 300 파일 · 200MB(글자로 바꾸면 커져 길 상한은 280MB)
    const im = p.match(/^\/api\/k\/([^/]+)\/import$/)
    if (im) {
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      // 자리부터 — 큰 본문을 메모리에 모으기 전에(자리 없는 사람 · 읽기 자리가 서버 메모리를 쓰게 하지 않게)
      const iid = dec(im[1])
      await hub.meta(iid, ctx)
      hub.need(ctx, iid, 'write')
      const b = await readBody(req, 280 << 20)
      const files = (Array.isArray(b.files) ? b.files : []).map((f) => ({ path: String(f.path || f.name || ''), data: Buffer.from(String(f.b64 || ''), 'base64') }))
      // group — 여러 파일을 나눠 보낼 때 한 일로 묶는다({ title, total } → 받은 id 로 이어 보내고 마지막에 last)
      const group = b.group && typeof b.group === 'object' ? { id: b.group.id ? String(b.group.id) : null, title: String(b.group.title || ''), total: Number(b.group.total) || 0, last: !!b.group.last } : null
      return out(200, await hub.importFiles(ctx, iid, files, { group }))
    }
    // 지식 지우기 — 보관하지 않고 완전히 · 확인은 지식 이름 · 팀 관리자는 비밀번호 한 번 더
    const dl = p.match(/^\/api\/k\/([^/]+)\/delete$/)
    if (dl && req.method === 'POST') {
      const id = dec(dl[1])
      const b = await readBody(req)
      if (mode === 'team') admin(ctx)
      return out(200, await hub.deleteKnowledge(ctx, id, b))
    }
    // 보내기 — 보낼 것(GET send) · 보내는 길(send/route) · 보내기 · 대기 줄 · 받기 · 받은편지함 정리
    //   보내는 지식은 개인 프로그램의 개인 지식(팀 서버는 옛 개인 지식만) · 받는 것은 팀 서버
    // 받는 팀 지식 고르기(개인 화면) — 이 PC 가 이은 팀마다 이 PC 의 기기 열쇠로 본 팀 지식(쓰기 자리 이상)
    if (p === '/api/send/teams' && req.method === 'GET') {
      if (mode !== 'pc') throw new KmdError('E_FORBIDDEN', '지식 보내기는 개인 프로그램에서 한다')
      need(ctx)
      return out(200, { teams: (await hub.sendTargets(ctx)).teams })
    }
    const sd = p.match(/^\/api\/k\/([^/]+)\/(send|send\/route|send\/wait|send\/preview|receive|receive\/preview|inbox\/tidy|inbox\/send)$/)
    if (sd) {
      const id = dec(sd[1])
      if (sd[2] === 'send' && req.method === 'GET') return out(200, await hub.sendView(ctx, id))
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      const b = await readBody(req, sd[2] === 'receive' || sd[2] === 'receive/preview' ? 8 << 20 : MAX_BODY)
      if (sd[2] === 'send') return out(200, await hub.sendPicked(ctx, id, b))
      if (sd[2] === 'send/route') return out(200, await hub.sendRoute(ctx, id, b))
      if (sd[2] === 'send/wait') return out(200, await hub.sendWaitAct(ctx, id, { wid: b.id, act: b.act }))
      if (sd[2] === 'receive') return out(200, await hub.receive(ctx, id, b))
      if (sd[2] === 'receive/preview') return out(200, await hub.receivePreview(ctx, id, b))
      if (sd[2] === 'send/preview') return out(200, await hub.sendPreview(ctx, id, b))
      if (sd[2] === 'inbox/send') return out(200, await hub.inboxSend(ctx, id, b))
      return out(200, await hub.inboxTidy(ctx, id, { dry: !!b.dry }))
    }
    // 넣은 파일의 기록을 Claude 로 정리 — { r: 기록 id }
    const rr = p.match(/^\/api\/k\/([^/]+)\/rec\/read$/)
    if (rr) {
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      return out(200, await hub.readRecord(ctx, dec(rr[1]), (await readBody(req)).r))
    }
    const uw = p.match(/^\/api\/k\/([^/]+)\/unwatch$/)
    if (uw) return out(200, await hub.unwatch(ctx, dec(uw[1]), await readBody(req)))
    const m = p.match(/^\/api\/k\/([^/]+)\/(tree|doc|rec|att|model|item|save|backup|backup\/pull|owner|learn|edit|revert|guard)$/)
    if (!m) throw new KmdError('E_NOTFOUND', '그런 길은 없다')
    const id = dec(m[1])
    const what = m[2]
    if (['save', 'backup', 'backup/pull', 'owner', 'learn', 'edit', 'revert'].includes(what)) {
      if (what === 'backup' && req.method === 'GET') return out(200, (await hub.backupState(ctx, id)) || { off: true })
      // 주인 줄 — 그 지식을 보는 사람에게만. 자리 표(access) · 지식관리자(예전 정리하는 사람)은 관리 자리에게만(자리 표 보기와 같게)
      if (what === 'owner' && req.method === 'GET') {
        await hub.meta(id, ctx)
        const row = hub.owner(id) || {}
        if (hub.levelOf(ctx, id) === 'admin') return out(200, row)
        const { owner = null, tidyAt, tidyMode, noClaude } = row
        return out(200, { owner, tidyAt, tidyMode, noClaude })
      }
      if (req.method !== 'POST') throw new KmdError('E_INPUT', 'POST 로 보낸다')
      const body = await readBody(req)
      // 저장 문(S4) — 채널은 서버가 정한다: 본문에서는 channel: 'send'(보내기) 하나만 읽고 나머지 opt 칸은 받지 않는다(S-D54)
      if (what === 'save') {
        const { channel, ...input } = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
        return out(200, await hub.save(ctx, id, input, { guard: 'strict', channel: channel === 'send' ? 'send' : 'http' }))
      }
      if (what === 'learn') return out(200, await hub.learn(ctx, id, body))
      if (what === 'edit') return out(200, await hub.edit(ctx, id, body))
      if (what === 'revert') return out(200, await hub.revert(ctx, id, body))
      if (what === 'owner') {
        // 주인 · 지식관리자(예전 정리하는 사람)은 명부에 있는 사람만
        const people = new Set(auth.users().filter((u) => u.kind === 'person' && !u.off).map((u) => u.id))
        for (const u of [body.owner, ...(Array.isArray(body.curators) ? body.curators : [])].filter((x) => x != null && x !== '')) if (!people.has(String(u))) throw new KmdError('E_INPUT', `그런 사람은 없다: ${String(u).slice(0, 40)}`)
        // 주인 넘기기 — 관리자(팀 서버)는 비밀번호 한 번 더(남의 지식을 넘기는 일)
        const cur = hub.owner(id)
        if (mode === 'team' && ctx.admin && body.owner != null && body.owner !== (cur?.owner ?? null)) admin(ctx)
        return out(200, await hub.setOwner(ctx, id, body))
      }
      admin(ctx)
      if (what === 'backup') return out(200, await hub.backupAttach(ctx, id, String(body.url || '')))
      return out(200, await hub.backupPull(ctx, id))
    }
    const k = await hub.get(id, ctx)
    if (what === 'tree') {
      // 문서 목록은 그대로 · 기록은 최근 limit(기본 200)만. 첫 쪽(before 없음)에는 그보다 옛 것이라도 아직 넣지 않은 기록(pend · nowhere)을
      // 함께 싣는다(받은 것 · 반영 대기 수가 첫 쪽만으로 맞게 · 화면은 id 로 겹침을 거른다). ?all=1 은 예전처럼 모두
      const t = V.tree(k)
      if (url.searchParams.get('all') === '1') return out(200, { ...t, total: t.records.length, more: 0, next: null })
      const limit = pageLimit(url, 200)
      const byId = new Map(k.works.map((w) => [w.id, w]))
      const older = olderThan(url.searchParams.get('before'), byId)
      const all = older ? t.records.filter(older) : t.records
      const head = all.slice(0, limit)
      const open = older ? [] : all.slice(limit).filter((r) => r.state === 'pend' || r.state === 'nowhere')
      const more = all.length - head.length
      // held — 넣지 못함 수(저장 문이 넣지 못한 조각이 있는 기록 · S4 · 목록 화면은 S10)
      return out(200, { ...t, records: open.length ? [...head, ...open] : head, total: t.records.length, more, next: more > 0 && head.length ? cursorOf(head[head.length - 1]) : null, held: k.works.filter((w) => w.state === 'held').length })
    }
    if (what === 'model') return out(200, V.model(k))
    if (what === 'guard') return out(200, await hub.guardAudit(ctx, id))
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
      const v = V.docView(k, url.searchParams.get('d'), { src: await hub.sourceState(k.id), edit: url.searchParams.get('edit') === '1' })
      if (!v) throw new KmdError('E_NOTFOUND', '이 문서는 이제 없다')
      // 원본이 주인인 문서 — 어디서 왔나 · 고치기 없음
      const dd = k.docs.find((x) => x.id === url.searchParams.get('d'))
      const watched = dd ? watchedOf(await fs.readFile(path.join(k.dir, ...dd.path.split('/')), 'utf8').catch(() => '')) : null
      // 원본이 주인인 문서 — 그 가져올 곳이 이제 없으면 「원본이 없어졌다」(표지를 걷을 수 있다)
      const orphan = watched ? !(await hub.sources(ctx, k.id).catch(() => [])).some((s) => s.name === watched.src) : false
      return out(200, { ...v, watched: watched ? { ...watched, ...(orphan ? { orphan: true } : {}) } : null, direct: hub.canDirect(ctx, k.id) && !watched })
    }
    const v = V.recView(k, url.searchParams.get('r'))
    if (!v) throw new KmdError('E_NOTFOUND', '이 기록은 이제 없다')
    return out(200, v)
  }

  const tidiedC = new Map() // 지식 → { 읽은 지식 · 달 · 정리 수 }(설정 탭)
  const staticFile = async (res, p) => {
    // 화면 길(/first · /setup)은 같은 화면 한 장이 연다
    const rel = p === '/' || p === '/first' || p === '/setup' ? 'index.html' : p.slice(1)
    const full = path.join(APP, ...rel.split('/'))
    if (!full.startsWith(APP + path.sep) || rel.split('/').includes('..')) return send(res, 404, '없다', 'text/plain; charset=utf-8')
    const buf = await fs.readFile(full).catch(() => null)
    if (!buf) return send(res, 404, '없다', 'text/plain; charset=utf-8')
    const type = TYPES[path.extname(full)] || 'application/octet-stream'
    if (rel === 'index.html') return send(res, 200, buf, type, { 'content-security-policy': `default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'` })
    // 정적 파일(Q72) — 내용 지문(ETag)으로 다시 묻게 한다. 바뀌지 않았으면 304 로 몸 없이(화면을 열 때마다 main.js 를 다 받지 않게)
    const etag = `"${crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20)}"`
    const cc = { etag, 'cache-control': 'no-cache' }
    if (String(res.req?.headers['if-none-match'] || '').split(',').map((x) => x.trim()).includes(etag)) {
      res.writeHead(304, { ...cc, 'x-content-type-options': 'nosniff' })
      return res.end()
    }
    send(res, 200, buf, type, cc)
  }

  const server = http.createServer(async (req, res) => {
    try {
      res.kmdSecure = !!req.socket.encrypted || (!!hub.config.trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https')
      const url = new URL(req.url, 'http://x')
      const p = url.pathname
      const xo = await crossOrigin(req, res, p)
      if (xo?.done) return
      if (req.method === 'POST' && req.headers.origin && !sameOrigin(req) && !xo?.open) throw new KmdError('E_FORBIDDEN', '다른 곳의 화면에서 온 요청은 받지 않는다')
      // Origin 을 싣지 않는 브라우저 길도 — 다른 사이트(같은 호스트의 다른 포트 포함)에서 온 쿠키 요청은 받지 않는다
      if (req.method === 'POST' && ['cross-site', 'same-site'].includes(String(req.headers['sec-fetch-site'] || '')) && !xo?.open) throw new KmdError('E_FORBIDDEN', '다른 곳의 화면에서 온 요청은 받지 않는다')
      if (p === '/healthz') {
        // 살아 있나 · 판 · 갈래만 — 들어오지 않아도 받으므로 지식 이름 · 멈춤 줄은 싣지 않는다(그것은 들어온 사람의 /api/stops).
        // 지식마다 git 을 재지 않아 가볍다(?live=1 은 예전 판과의 호환)
        return send(res, 200, { ok: true, version: VERSION, build: BUILD, mode })
      }
      // 설명서 — /manual(고르는 첫 장) · /manual/<이름> · /manual/img/<그림>
      const mi = req.method === 'GET' && p.match(/^\/manual\/img\/([^/]+)$/)
      if (mi) {
        const img = await manualImg(dec(mi[1]))
        if (!img) return send(res, 404, '없다', 'text/plain; charset=utf-8')
        return send(res, 200, img.buf, img.type, { 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' })
      }
      const mm = req.method === 'GET' && p.match(/^\/manual\/?(?:([^/]+))?$/)
      if (mm) {
        const page = await manualPage(mode, mm[1] ? dec(mm[1]) : null)
        if (!page) return send(res, 404, '없다', 'text/plain; charset=utf-8')
        return send(res, 200, page, 'text/html; charset=utf-8', { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" })
      }
      // 설치 한 줄이 받는 작은 스크립트 — `irm <팀>/i/<표> | iex`(PowerShell) · `curl -fsSL <팀>/i/<표>.sh | sh`. 표는 여기서 쓰지 않는다(설치가 /device/keys 로 한 번)
      // kmd 가 없는 Windows PC 면 받기 자리의 PC 꾸러미를 받아 <집>/versions/<판> 에 풀고 실행기(<집>/bin)를 사용자 PATH 에 더한 뒤 잇는다
      const im = mode === 'team' && req.method === 'GET' && p.match(/^\/i\/(kmdt_[A-Za-z0-9_-]{10,80})(\.sh)?$/)
      if (im) {
        const origin = `http://${req.headers.host}`
        const pkg = await pcPackage()
        const sp = new URL(req.url, origin).searchParams
        const pr = safeRoot(sp.get('root'))
        const ps = installPs({ origin, ticket: im[1], pkg, root: pr })
        const sh = `#!/bin/sh\nif command -v kmd >/dev/null 2>&1; then kmd connect '${origin}' --ticket '${im[1]}'${pr ? " --root '" + pr + "'" : ''}; else echo '· kmd 가 이 PC 에 없다. 받을 수 있는 꾸러미는 Windows 용뿐이다. 저장소에서 kmd 를 깔고(node 20 이상) 이 줄을 다시 붙여 넣는다: ${origin}/dl'; fi\n`
        return send(res, 200, im[2] ? sh : ps, 'text/plain; charset=utf-8')
      }
      // 팀 에이전트 설치 한 줄이 받는 스크립트 — `irm <팀>/a/<표>?kn=<팀 지식> | iex`. 열쇠가 없을 때만 표를 쓴다(core/teamkit.js)
      const am0 = mode === 'team' && req.method === 'GET' && p.match(/^\/a\/(kmdt_[A-Za-z0-9_-]{10,80})$/)
      if (am0) {
        const kn = safeKn(new URL(req.url, 'http://x').searchParams.get('kn'))
        if (!kn) return send(res, 400, "Write-Host '· 붙일 팀 지식이 없다. 팀 화면 › 설정 › 에이전트 설치에서 한 줄을 다시 복사한다'", 'text/plain; charset=utf-8')
        return send(res, 200, teamkit.teamAgentPs({ origin: `http://${req.headers.host}`, ticket: am0[1], kn }), 'text/plain; charset=utf-8')
      }
      // 꾸러미 받기 — PC 꾸러미(serve.json dl · 기본 <살림 자리>/dl · 팀 설치가 꾸러미 안의 것을 둔다). 비밀이 아니라 들어오지 않아도 받는다
      if (mode === 'team' && req.method === 'GET' && (p === '/dl' || p.startsWith('/dl/'))) {
        const dl = dlDir()
        const files = (await fs.readdir(dl).catch(() => [])).filter((n) => /\.(zip|tgz|exe|msi)$/i.test(n))
        if (p === '/dl') { await pageRootP; return send(res, 200, `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>kmd 받기</title><style>${pageRoot}${PAGE_CSS}main{padding-top:40px}</style><body><main><h1>kmd 받기</h1>${files.length ? `<ul>${files.map((n) => `<li><a href="/dl/${encodeURIComponent(n)}">${n.replace(/[<>&"]/g, '')}</a></li>`).join('')}</ul><p>보통은 받을 일이 없다. 팀 화면 › 설정 › 에이전트 설치의 <b>설치 한 줄</b>을 PowerShell 에 붙여 넣으면 이 꾸러미를 저절로 받아 깔고 팀에 잇는다.</p><p>손으로 깔려면: zip 을 풀고 그 폴더에서 <code>kmd.cmd up</code> 으로 켠다.</p>` : '<p>아직 PC 꾸러미가 없다. 관리자가 팀 꾸러미로 설치하면 함께 놓인다. 관리자에게 묻는다.</p>'}<p><a href="/manual">설명서</a></p></main></body></html>`, 'text/html; charset=utf-8') }
        const n = dec(p.slice(4))
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
          // 묶음은 20개 안 — 찾기 수천 개로 CPU 를 오래 붙잡지 않게
          if (!body.length || body.length > 20) return send(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32600, message: '묶음은 1 ~ 20개' } })
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
      // details — 저장 문의 E_CONFLICT { stale, proposals } · E_RATE { retryAfter }(+ Retry-After 머리)
      const details = e instanceof KmdError && e.details && typeof e.details === 'object' ? e.details : null
      const head = { ...(status === 401 && req.url.startsWith('/mcp') ? { 'www-authenticate': 'Bearer' } : {}), ...(e.code === 'E_RATE' && details?.retryAfter ? { 'retry-after': String(details.retryAfter) } : {}) }
      send(res, status, { error: e.code || 'E_INTERNAL', message: e instanceof KmdError ? e.message : '서버 안에서 넘어졌다', ...(e.need ? { need: e.need } : {}), ...(e.confirm ? { confirm: e.confirm } : {}), ...(details ? { details } : {}) }, undefined, head)
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  // 에이전트가 이 kmd 의 MCP 에 닿는 주소(같은 PC 안)
  hub.selfUrl = `http://127.0.0.1:${server.address().port}`
  await hub.start()
  // 옛 지식 한 번 옮기기 — 기본 자리 「모두: 쓰기」 → 「없음」(있던 사람에게 옛 기본 자리를 적은 뒤 · 장부에 accessV 2)
  if (mode === 'team') await hub.migrateAccess(auth.people())
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
