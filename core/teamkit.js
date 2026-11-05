// 팀 에이전트 설치 — 작업 폴더의 Claude Code 에 팀 지식을 붙인다. 개인 프로그램 없이 팀 서버가 내주는 한 줄로.
//
//   한 줄   팀 화면 › 설정 › 에이전트 설치의 `irm '<팀>/a/<표>?kn=<팀 지식>' | iex` — 붙여 넣은 폴더에
//   스킬   <폴더>/.claude/skills/kmd-team-work · kmd-team-save · kmd-team-import(저장 · 대량 넣기에 작성가이드.md 사본) · 개인 스킬(kmd-work · kmd-save · kmd-build)과 따로
//          대량 넣기 파서(kmd-parse)는 여기서 두지 않는다 — 처음 대량 넣기 때 스킬이 받는다(K-D9 · GET /api/agent/parser)
//   확인   Claude Code 가 이 PC 에 있나 · 로그인했나(K11-1) — 알리기만 하고 멈추지 않는다(KMD_SKIP_CLAUDE_CHECK 가 있으면 건너뜀)
//   연결   <폴더>/.mcp.json 의 mcpServers.kmd-team 하나. 열쇠는 넣지 않고 헤더 도우미가 꺼낸다
//          도우미는 실행 파일 %USERPROFILE%\.kmd\bin\kmd-key-<판>.exe(core/keyexe.js · 한 줄이 Add-Type 으로 만든다)
//          못 만든 PC 만 %USERPROFILE%\.kmd\kmd-team-key.ps1 — PowerShell 은 켜지는 데만 7초 넘게 걸려 Claude Code 의 10초 제한에 잘릴 수 있다
//   열쇠   이 PC 의 기기 열쇠(Windows 자격 저장소: DPAPI 로 감싼 %USERPROFILE%\.kmd\keys\<지문>.dpapi · core/keystore.js 와 같은 꼴 · 같은 자리)
//          이미 있고 팀 서버가 받으면 그대로 · 없거나 끊겼으면 표(10분 · 한 번)로 하나 받는다(내 기기에 한 줄)
//          %APPDATA% 에 두지 않는다 — Claude 데스크톱 앱(MSIX) 안에서 쓰면 앱 전용 자리로 가상화되어 앱 안 · 밖이 다른 열쇠를 읽는다.
//          예전 자리(%APPDATA%\kmd\keys · %APPDATA%\kmd\kmd-team-key.ps1)는 새 자리에 없을 때 읽고, 받아지면 새 자리로 옮겨 적는다
//   안내   <폴더>/CLAUDE.md 안 `<!-- kmd-team:begin v=… -->` ~ `<!-- kmd-team:end -->` · 「이 폴더의 팀 지식」 표 · 표지 밖의 줄은 그대로
//   옛 꼴  예전 한 덩이(`kmd:begin` · 팀 · 개인 섞인 표)의 팀 줄은 팀 덩이로 옮긴다. 그 덩이에 개인 지식이 없으면 덩이와 옛 스킬을 걷는다
//
// 판단(표 읽기 · 덩이 만들기 · 옛 덩이 보기)은 여기(서버) · PC 의 스크립트는 파일을 읽고 쓰기만 한다.

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const KIT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agent')
export const TEAM_SKILLS = ['kmd-team-work', 'kmd-team-save', 'kmd-team-import']
// 작성가이드 사본을 둘 스킬(항목 글을 짓는 스킬) — 원본은 개인 kmd-build 의 것 한 벌
const GUIDE_SKILLS = ['kmd-team-save', 'kmd-team-import']
export const OLD_SKILLS = ['kmd-work', 'kmd-save', 'kmd-build']
// 스킬 판(S-D15) — 팀 스킬 글 · 팀 덩이 · 작성가이드를 고치면 하나 올린다(test/teamkit.test.mjs 의 판 표가 잊으면 실패한다).
//   스킬 글의 자리표 {{KIT_REV}} 를 이 값으로 바꿔 싣는다 → 세션이 MCP save 에 kit 으로 싣는다 →
//   팀 서버가 이 값보다 옛것이면 저장은 그대로 하고 답에 reinstall(다시 설치) · 없으면 nokit(스킬을 거치지 않은 저장)을 싣는다(server/mcp.js)
export const TEAM_KIT_REV = 5
const withRev = (t) => t.replace(/\{\{KIT_REV\}\}/g, String(TEAM_KIT_REV))

export async function teamKitParts() {
  const skills = []
  for (const s of TEAM_SKILLS) {
    const files = (await fs.readdir(path.join(KIT, 'team', 'skills', s))).filter((f) => f.endsWith('.md')).sort()
    for (const f of files) skills.push({ rel: `.claude/skills/${s}/${f}`, text: withRev(await fs.readFile(path.join(KIT, 'team', 'skills', s, f), 'utf8')) })
  }
  // 항목 글 모양 — 개인 kmd-build 의 작성가이드를 팀 저장 스킬 옆에 같이 둔다(한 벌만 고친다)
  const guide = await fs.readFile(path.join(KIT, 'skills', 'kmd-build', '작성가이드.md'), 'utf8')
  for (const s of GUIDE_SKILLS) skills.push({ rel: `.claude/skills/${s}/작성가이드.md`, text: guide })
  const block = withRev((await fs.readFile(path.join(KIT, 'CLAUDE-kmd-team.md'), 'utf8')).replace(/\r/g, '').trim())
  const ver = crypto.createHash('sha256').update(JSON.stringify([skills.map((x) => x.text), block])).digest('hex').slice(0, 8)
  return { skills, block, ver, rev: TEAM_KIT_REV }
}

const ROW = /^\|\s*「(.+?)」\s*\|\s*([^|\s]+)\s*\|/
// 팀 덩이의 표 줄 — | 「이름」 | id | 보는 사람 |
export function teamRows(block = '') {
  return String(block).replace(/\r/g, '').split('\n').map((l) => l.match(ROW)).filter(Boolean).filter((m) => m[2] !== 'id' && !/^-+$/.test(m[2])).map((m) => ({ kn: m[2], knName: m[1] }))
}
// 옛 한 덩이(kmd:begin)의 표 — | 「이름」 (기본) | 팀|개인 | kmd-team|kmd | id | … |
const OLD_ROW = /^\|\s*「(.+?)」(?:\s*\(기본\))?\s*\|\s*(팀|개인)\s*\|\s*(kmd-team|kmd)\s*\|\s*([^|\s]+)\s*\|/
export function legacyRows(block = '') {
  return String(block).replace(/\r/g, '').split('\n').map((l) => l.match(OLD_ROW)).filter(Boolean).map((m) => ({ area: m[2] === '팀' ? 'team' : 'me', kn: m[4], knName: m[1] }))
}
// 옛 덩이를 걷어도 되나 — 표가 있고 개인 지식 줄이 없을 때만(개인 지식이 있으면 개인 프로그램이 고친다)
export const legacyTeamOnly = (block = '') => { const rs = legacyRows(block); return rs.length > 0 && rs.every((r) => r.area === 'team') }

export function teamBlock({ block, ver }, kns) {
  const rows = kns.map((k) => `| 「${k.knName || k.kn}」 | ${k.kn} | 이 팀 지식을 보는 팀 사람 |`)
  const table = ['\n\n## 이 폴더의 팀 지식\n', '| 지식 | id | 남기면 보는 사람 |', '|---|---|---|', ...rows].join('\n')
  return `<!-- kmd-team:begin v=${ver} -->\n${block}${table}\n<!-- kmd-team:end -->`
}

// 붙일 팀 지식 목록 — 있던 팀 덩이 + 옛 덩이의 팀 줄 + 새 지식 · 지금 그 사람이 볼 수 있는 것만(이름은 팀 서버의 지금 이름)
export function teamKns({ old = '', legacy = '', add, visible }) {
  const name = new Map(visible.map((k) => [k.id, k.name]))
  const out = []
  for (const r of [...teamRows(old), ...legacyRows(legacy).filter((r) => r.area === 'team'), { kn: add }]) {
    if (!name.has(r.kn) || out.some((x) => x.kn === r.kn)) continue
    out.push({ kn: r.kn, knName: name.get(r.kn) })
  }
  return out
}

// ── PC 쪽 PowerShell — 파일을 읽고 쓰기만 · 판단은 POST /api/agent/team-kit ──
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'"
// 기기 열쇠 파일 — keystore.js 와 같은 이름 · 같은 자리: sha256('device:' + origin) 앞 24 · DPAPI(현재 사용자)
//   $kf  새 자리 %USERPROFILE%\.kmd\keys(쓰기는 여기만 — AppData 는 Claude 데스크톱 앱 안에서 가상화된다)
//   $kfr 읽을 파일 — 새 자리에 없으면 예전 자리 %APPDATA%\kmd\keys
const PS_KEYFILE = [
  '$sha = [Security.Cryptography.SHA256]::Create()',
  "$kn24 = (-join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes('device:' + $o)) | ForEach-Object { $_.ToString('x2') })).Substring(0, 24) + '.dpapi'",
  "$kf = Join-Path $env:USERPROFILE ('.kmd\\keys\\' + $kn24)",
  "$kfr = if (Test-Path $kf) { $kf } else { Join-Path $env:APPDATA ('kmd\\keys\\' + $kn24) }",
]

// 헤더 도우미 — Claude Code 가 연결할 때 부른다: 열쇠 파일을 풀어 {"Authorization":"Bearer …"} 한 줄
export function teamKeyHelperPs() {
  return [
    '# kmd 팀 연결의 헤더 도우미(팀 화면 › 설정 › 에이전트 설치가 둔다). 이 PC 의 자격 저장소에서 기기 열쇠를 꺼낸다',
    "$ErrorActionPreference = 'Stop'",
    'try {',
    '  Add-Type -AssemblyName System.Security',
    "  $o = ([Uri]$args[0]).GetLeftPart('Authority')",
    ...PS_KEYFILE.map((l) => '  ' + l),
    "  $k = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String((Get-Content $kfr -Raw).Trim()), $null, 'CurrentUser'))",
    `  [Console]::Out.Write('{"Authorization":"Bearer ' + $k + '"}')`,
    '} catch {',
    "  [Console]::Error.WriteLine('kmd: no team key on this PC. Paste the install line from team screen > Settings > Agent install again')",
    '  exit 1',
    '}',
    '',
  ].join('\r\n')
}

// Claude Code 확인(K11-1) — 있나(Get-Command) · 로그인했나(claude auth status 의 loggedIn: true 와 종료 0). 알리기만 · 멈추지 않는다
//   cmd 로 부른다(npm 이 둔 claude.cmd · 설치기의 claude.exe 둘 다) · 20초 안에 답이 없으면 「확인하지 못했다」
export function claudeCheckPs() {
  return [
    'if (-not $env:KMD_SKIP_CLAUDE_CHECK) {',
    '  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-Host "· Claude Code 가 이 PC 에 없다. 깔고 이 폴더에서 claude 를 연다" }',
    '  else {',
    '    $cs = $null',
    '    try {',
    "      $pi = New-Object Diagnostics.ProcessStartInfo 'cmd.exe', '/d /c claude auth status'",
    '      $pi.UseShellExecute = $false; $pi.RedirectStandardOutput = $true; $pi.RedirectStandardError = $true; $pi.CreateNoWindow = $true',
    '      $pr = [Diagnostics.Process]::Start($pi); $po = $pr.StandardOutput.ReadToEndAsync(); $pe = $pr.StandardError.ReadToEndAsync()',
    "      if (-not $pr.WaitForExit(20000)) { try { $pr.Kill() } catch { }; $cs = 'unknown' } elseif ($pr.ExitCode -eq 0 -and $po.Result -match 'loggedIn\\W*:\\s*true') { $cs = 'ok' } else { $cs = 'no' }",
    "    } catch { $cs = 'unknown' }",
    "    if ($cs -eq 'ok') { Write-Host '✓ Claude Code 로그인을 보았다' } elseif ($cs -eq 'no') { Write-Host '· Claude Code 에 로그인되어 있지 않다. 터미널에서 claude auth login' } else { Write-Host '· 확인하지 못했다: claude 를 열어 로그인 상태를 본다' }",
    '  }',
    '}',
  ]
}

export function teamAgentPs({ origin, ticket, kn }) {
  const L = [
    '& {',
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$o = ([Uri]${q(origin)}).GetLeftPart('Authority'); $t = ${q(ticket)}; $kn = ${q(kn)}`,
    '$d = (Get-Location).Path',
    '$u8 = New-Object System.Text.UTF8Encoding $false',
    'Add-Type -AssemblyName System.Security',
    // 응답의 거절 까닭(팀 서버의 message) — 없으면 PowerShell 의 말
    'function Why($e) { try { ($e.ErrorDetails.Message | ConvertFrom-Json).message } catch { $e.Exception.Message } }',
    ...PS_KEYFILE,
    // ① 열쇠 — 있고 팀 서버가 받으면 그대로 · 아니면 표로 하나 받아 자격 저장소에
    '$key = $null',
    "if (Test-Path $kfr) { try { $key = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String((Get-Content $kfr -Raw).Trim()), $null, 'CurrentUser')) } catch { $key = $null } }",
    'if ($key) { try { Invoke-RestMethod "$o/api/knowledge" -Headers @{ Authorization = "Bearer $key" } -UseBasicParsing | Out-Null; Write-Host "· 이 PC 의 팀 열쇠를 그대로 쓴다" } catch { $key = $null } }',
    // 예전 자리의 열쇠가 받아졌으면 새 자리로 옮겨 적는다(예전 파일은 그대로 · 개인 프로그램 예전 판이 읽는다)
    "if ($key -and $kfr -ne $kf) { New-Item -ItemType Directory -Force (Split-Path $kf) | Out-Null; Copy-Item -LiteralPath $kfr -Destination $kf -Force }",
    'if (-not $key) {',
    '  $b = $u8.GetBytes((@{ ticket = $t; host = $env:COMPUTERNAME; osuser = $env:USERNAME } | ConvertTo-Json -Compress))',
    "  try { $r = Invoke-RestMethod \"$o/device/keys\" -Method Post -ContentType 'application/json; charset=utf-8' -Body $b -UseBasicParsing } catch { Write-Host \"· 팀에 잇지 못했다: $(Why $_) · 팀 화면 › 설정 › 에이전트 설치에서 한 줄을 다시 복사한다\"; return }",
    '  $key = $r.key',
    '  New-Item -ItemType Directory -Force (Split-Path $kf) | Out-Null',
    "  [IO.File]::WriteAllText($kf, [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($u8.GetBytes($key), $null, 'CurrentUser')) + \"`n\")",
    '  Write-Host "✓ 이 PC 를 팀 $o 에 $($r.user) 로 이었다. 팀 화면 › 개인 지식 쓰기 › 내 기기에 한 줄이 생긴다"',
    '}',
    // ② 팀 덩이 · 스킬 — 지금 CLAUDE.md 의 팀 덩이 · 옛 덩이만 보내고 새 덩이를 받는다
    "$cf = Join-Path $d 'CLAUDE.md'",
    "$c = if (Test-Path $cf) { [IO.File]::ReadAllText($cf, $u8) } else { '' }",
    "$rt = '(?s)<!--\\s*kmd-team:begin[^>]*-->.*?<!--\\s*kmd-team:end\\s*-->'",
    "$rp = '(?s)<!--\\s*kmd:begin[^>]*-->.*?<!--\\s*kmd:end\\s*-->'",
    '$mt = [regex]::Match($c, $rt); $mp = [regex]::Match($c, $rp)',
    '$q = $u8.GetBytes((@{ kn = $kn; block = $mt.Value; legacy = $mp.Value } | ConvertTo-Json -Compress))',
    "try { $r = Invoke-RestMethod \"$o/api/agent/team-kit\" -Method Post -Headers @{ Authorization = \"Bearer $key\" } -ContentType 'application/json; charset=utf-8' -Body $q -UseBasicParsing } catch { Write-Host \"· 붙이지 못했다: $(Why $_)\"; return }",
    // .mcp.json — 깨진 파일은 덮지 않고 멈춘다(다른 연결은 그대로)
    "$mf = Join-Path $d '.mcp.json'",
    '$m = $null',
    "if (Test-Path $mf) { try { $m = [IO.File]::ReadAllText($mf, $u8) | ConvertFrom-Json } catch { Write-Host \"· $mf 가 JSON 이 아니라 고치지 않았다. 고친 뒤 이 줄을 다시 붙여 넣는다\"; return } }",
    'if (-not $m) { $m = New-Object PSObject }',
    "if (-not $m.mcpServers) { $m | Add-Member -Force -NotePropertyName mcpServers -NotePropertyValue (New-Object PSObject) }",
    // 헤더 도우미 — 새 자리에. 예전 자리에 있으면 같은 글로 바꿔 둔다(예전 .mcp.json 이 그것을 가리킨다)
    "$hp = Join-Path $env:USERPROFILE '.kmd\\kmd-team-key.ps1'",
    'New-Item -ItemType Directory -Force (Split-Path $hp) | Out-Null',
    '[IO.File]::WriteAllText($hp, $r.helper, (New-Object System.Text.UTF8Encoding $true))',
    "$hpo = Join-Path $env:APPDATA 'kmd\\kmd-team-key.ps1'",
    'if (Test-Path $hpo) { [IO.File]::WriteAllText($hpo, $r.helper, (New-Object System.Text.UTF8Encoding $true)) }',
    // 빠른 도우미 — 같은 일을 하는 실행 파일(core/keyexe.js · 개인 프로그램과 같은 이름 · 같은 자리). PowerShell 은 PC 에 따라 켜지는 데만
    // 7초 넘게 걸려 Claude Code 의 headersHelper 10초 제한에 잘린다. 못 만들면 .ps1 도우미로
    "$he = Join-Path $env:USERPROFILE ('.kmd\\bin\\kmd-key-' + $r.exeVer + '.exe')",
    'if (-not (Test-Path $he)) {',
    '  try {',
    '    New-Item -ItemType Directory -Force (Split-Path $he) | Out-Null',
    '    $het = "$he.$PID.tmp.exe"',
    '    Add-Type -TypeDefinition $r.exeCs -ReferencedAssemblies System.Security -OutputAssembly $het -OutputType ConsoleApplication',
    '    Move-Item -LiteralPath $het -Destination $he -Force',
    '  } catch { Remove-Item -LiteralPath $het -Force -ErrorAction SilentlyContinue; if (-not (Test-Path $he)) { $he = $null; Write-Host "· 빠른 열쇠 도우미를 만들지 못해 PowerShell 도우미로 잇는다(Claude Code 연결이 시간 초과로 끊길 수 있다): $($_.Exception.Message)" } }',
    '}',
    "$hh = if ($he) { \"`\"$he`\" $o\" } else { \"powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `\"$hp`\" $o\" }",
    "$m.mcpServers | Add-Member -Force -NotePropertyName 'kmd-team' -NotePropertyValue ([pscustomobject]@{ type = 'http'; url = \"$o/mcp\"; headersHelper = $hh })",
    // 스킬 · 옛 것 걷기 · CLAUDE.md
    'foreach ($s in $r.skills) { $f = Join-Path $d $s.rel; New-Item -ItemType Directory -Force (Split-Path $f) | Out-Null; [IO.File]::WriteAllText($f, $s.text, $u8) }',
    'if ($r.dropLegacy) {',
    "  foreach ($s in $r.oldSkills) { Remove-Item (Join-Path $d \".claude\\skills\\$s\") -Recurse -Force -ErrorAction SilentlyContinue }",
    "  $c = [regex]::Replace($c, $rp, '').Trim(); if ($c) { $c += \"`n\" }",
    '  $mt = [regex]::Match($c, $rt)',
    '}',
    '[IO.File]::WriteAllText($mf, ($m | ConvertTo-Json -Depth 20), $u8)',
    'if ($mt.Success) { $c = $c.Substring(0, $mt.Index) + $r.block + $c.Substring($mt.Index + $mt.Length) } elseif ($c.Trim()) { $c = $c.TrimEnd() + "`n`n" + $r.block + "`n" } else { $c = $r.block + "`n" }',
    '[IO.File]::WriteAllText($cf, $c, $u8)',
    'Write-Host "✓ $d 에 팀 지식 「$($r.name)」 을 붙였다. 이 폴더의 팀 지식 $($r.n) · 스킬 $($r.skillNames -join \' · \') · 연결 kmd-team"',
    'if ($r.dropLegacy) { Write-Host "    예전 한 덩이 kmd 안내 · 스킬(kmd-work · kmd-save · kmd-build)을 걷었다" } elseif ($r.legacy) { Write-Host "    개인 지식 안내(kmd)는 개인 프로그램이 고친다: 개인 화면 › 설정 › 에이전트 설치 › 지금 모두 최신으로" }',
    ...claudeCheckPs(),
    'Write-Host "    이 폴더에서 Claude Code 를 새로 연다(열려 있던 것은 다시 연다) · 폴더째 많은 파일은 그 Claude Code 에서 대량 넣기(kmd-team-import)"',
    '}',
    '',
  ]
  return L.join('\r\n')
}

// JSON 응답을 ASCII 로 — Windows PowerShell 5.1 의 Invoke-RestMethod 가 charset 을 놓쳐도 한글이 깨지지 않게
export const asciiJson = (v) => JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
