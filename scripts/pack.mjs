// 꾸러미 만들기 — dist/ 에 PC 꾸러미(폴더 + zip)와 팀 서버 꾸러미(tgz).
//
//   PC    kmd-<판>-pc/   node.exe(이 Node 그대로) · app · core · server · agent · 설명서(docs_ops/manual) · 쓰는 node_modules · kmd.cmd · kmd-key.cmd · 처음.txt
//         → kmd-<판>-pc.zip. 한 파일 exe(SEA)는 ESM 묶기(번들러)가 있어야 해 이 판은 「풀면 바로 도는 폴더」 로 낸다.
//         설치 한 줄이 이 zip 을 팀 서버의 받기 자리(/dl)에서 받아 ~/.kmd-app/versions/<판> 에 풀고 실행기를 세운다.
//   팀    kmd-<판>-team.tgz  같은 것(node 빼고) + kmd-install.sh(systemd) + PC zip · 파서 zip(설치가 받기 자리에 둔다) — 서버의 node 22 를 쓴다
//   파서  kmd-parse-<pver>/   대량 넣기 파서(K6-2 · 설계 4-6) — node.exe · 파서 core 여섯 · server/bin/kmd-parse.mjs · kmd-parse.cmd · pdf.js 쓰는 부분
//         → kmd-parse-<pver>.zip(팀 꾸러미에 같이 · 팀 설치가 받기 자리(/dl)에 둔다 · Claude Code 스킬 kmd-team-import 가 처음 대량 넣기 때 받는다)
//         pver = sha256(묶는 파일 글 + node 판 + pdf.js 판) 앞 12 — 내용이 같으면 판이 같다(PC 가 다시 받지 않는다)
//   걸러 냄  test · docs · 설명서 밖의 docs_ops · .git · .kmd-data · devDependencies
// 쓰기: node scripts/pack.mjs   (서명 · 올리기는 사람)

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))
const DIST = path.join(ROOT, 'dist')
// scripts/savelog.mjs — 저장 측정 읽기(설계 9절 · 팀 서버에서 node /opt/kmd/scripts/savelog.mjs /srv/kmd/.kmd)
const SRC = ['app', 'core', 'server', 'agent', 'package.json', 'CHANGELOG.md', 'scripts/savelog.mjs', 'scripts/kmd-migrate.mjs']
// 화면의 「설명서」(/manual)가 그리는 설명서 폴더(html · manual.css · img) — server/http.js 의 MANUAL_DIR
const MANUAL = path.join('docs_ops', 'manual')

function copy(from, to) {
  const st = fs.statSync(from)
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true })
    for (const n of fs.readdirSync(from)) copy(path.join(from, n), path.join(to, n))
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }
}
// 쓰는 꾸러미만(lock 의 dev 아닌 것) — pdf.js 의 그리기(@napi-rs/canvas · 고른 꾸러미)는 글만 꺼내므로 뺀다
const prodModules = () => Object.entries(lock.packages || {}).filter(([k, v]) => k.startsWith('node_modules/') && !v.dev && !k.startsWith('node_modules/@napi-rs/')).map(([k]) => k)
// 큰 꾸러미는 쓰는 파일만 — pdf.js 는 Node 판(legacy) · 글자 표(cmaps) · 기본 글꼴(37MB → 몇 MB)
const ONLY = { 'node_modules/pdfjs-dist': ['package.json', 'LICENSE', 'legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs', 'cmaps', 'standard_fonts'] }

function base(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  for (const s of SRC) copy(path.join(ROOT, s), path.join(dir, s))
  copy(path.join(ROOT, MANUAL), path.join(dir, MANUAL))
  for (const m of prodModules()) {
    if (!ONLY[m]) copy(path.join(ROOT, m), path.join(dir, m))
    else for (const f of ONLY[m]) {
      fs.mkdirSync(path.dirname(path.join(dir, m, f)), { recursive: true })
      copy(path.join(ROOT, m, f), path.join(dir, m, f))
    }
  }
}

// 판 폴더 하나(node 빼고) — 시험이 `kmd pc update` 에 줄 새 판을 만든다
export function stage(dir) {
  base(dir)
  return dir
}

// 꾸러미 판 이름 — KMD_BUILD 가 있으면 그것 · 없으면 <판>-<날짜>-<시각>(이 PC 시각 · 꾸러미마다 다르고 뒤의 것이 늘 크다)
export function buildName(now = new Date()) {
  if (process.env.KMD_BUILD) {
    if (!/^[0-9A-Za-z._-]{1,40}$/.test(process.env.KMD_BUILD)) throw new Error('KMD_BUILD 는 영문 · 숫자 · . _ - 40자 안')
    return process.env.KMD_BUILD
  }
  const p = (n) => String(n).padStart(2, '0')
  return `${pkg.version}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
}

// Windows 는 시스템 tar(bsdtar · -a 로 zip) — Git 의 GNU tar 는 C: 를 원격 주소로 읽는다 · 경로는 dist 안 이름만
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
// 파일 이름은 UTF-8(깃발 11) — 그냥 묶으면 한글 이름(설명서 사용자.html)이 이 PC 의 코드 페이지로 들어가 다른 코드 페이지의 PC 에서 깨진다
const zipDir = (out, name) => execFileSync(TAR, ['-a', '-cf', `${name}.zip`, ...(process.platform === 'win32' ? ['--options', 'hdrcharset=UTF-8'] : []), name], { cwd: out })

// ── 파서 꾸러미(K6-2) ──
// 묶는 파서 파일 — server/bin/kmd-parse.mjs 가 부르는 것만. 저장소와 같은 짜임(server/bin · core)으로 묶어 상대 import 가 그대로 돈다
export const PARSER_FILES = ['core/importer.js', 'core/ooxml.js', 'core/pdf.js', 'core/hwp.js', 'core/text.js', 'core/errors.js', 'server/bin/kmd-parse.mjs']
// 묶음 밖에서 부를 수 있는 것 — node 안의 것과 pdf.js 뿐
const PARSER_BARE = /^(node:|pdfjs-dist(\/|$))/
const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm
// import 그래프 검사 — 묶는 파일이 묶음 밖의 상대 경로 · 다른 꾸러미를 부르면 그 목록(빈 목록이면 됐다)
export function parserImportsOutside(root = ROOT, files = PARSER_FILES) {
  const inside = new Set(files.map((f) => f.replace(/\\/g, '/')))
  const bad = []
  for (const f0 of files) {
    const f = f0.replace(/\\/g, '/')
    const text = fs.readFileSync(path.join(root, f), 'utf8')
    for (const m of text.matchAll(IMPORT_RE)) {
      const sp = m[1] || m[2] || m[3]
      if (sp.startsWith('.')) {
        if (!inside.has(path.posix.normalize(path.posix.join(path.posix.dirname(f), sp)))) bad.push(`${f} → ${sp}`)
      } else if (!PARSER_BARE.test(sp)) bad.push(`${f} → ${sp}`)
    }
  }
  return bad
}
const pdfjsVer = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'pdfjs-dist', 'package.json'), 'utf8')).version } catch { return 'none' } }
// 파서 판 — 묶는 파일 글 + node 판 + pdf.js 판
export function parserVer({ root = ROOT, files = PARSER_FILES, nodeVer = process.version } = {}) {
  const h = crypto.createHash('sha256')
  for (const f of files) h.update(f + '\0').update(fs.readFileSync(path.join(root, f))).update('\0')
  return h.update(`node ${nodeVer}\0pdfjs ${pdfjsVer(root)}`).digest('hex').slice(0, 12)
}
// 파서 꾸러미 — out/kmd-parse-<pver>/ → out/kmd-parse-<pver>.zip · 묶음 밖 import 가 있으면 멈춘다
//   nodeExe — 묶을 node(기본 이 node) · 시험은 작은 가짜 파일로
export function packParser({ out = DIST, root = ROOT, files = PARSER_FILES, nodeExe = process.execPath, nodeVer = process.version } = {}) {
  const bad = parserImportsOutside(root, files)
  if (bad.length) throw new Error(`파서 꾸러미: 묶음 밖을 부른다(${bad.join(' · ')}). 파서 파일이 다른 kmd 파일을 부르면 PARSER_FILES 에 더하거나 부르지 않게 고친다`)
  const pver = parserVer({ root, files, nodeVer })
  const name = `kmd-parse-${pver}`
  const dir = path.join(out, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  for (const f of files) copy(path.join(root, f), path.join(dir, f))
  const pj = 'node_modules/pdfjs-dist'
  if (fs.existsSync(path.join(root, pj))) for (const f of ONLY[pj]) copy(path.join(root, pj, f), path.join(dir, pj, f))
  fs.copyFileSync(nodeExe, path.join(dir, 'node.exe'))
  fs.writeFileSync(path.join(dir, 'kmd-parse.cmd'), '@echo off\r\n"%~dp0node.exe" "%~dp0server\\bin\\kmd-parse.mjs" %*\r\n')
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }) + '\n')
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ parse: pver }) + '\n')
  const zip = path.join(out, `${name}.zip`)
  fs.rmSync(zip, { force: true })
  zipDir(out, name)
  return { dir, zip, pver, name }
}

export function pack({ out = DIST, build = buildName() } = {}) {
  const v = build
  const pc = path.join(out, `kmd-${v}-pc`)
  base(pc)
  fs.writeFileSync(path.join(pc, 'build.json'), JSON.stringify({ build: v }) + '\n')
  fs.copyFileSync(process.execPath, path.join(pc, 'node.exe'))
  fs.writeFileSync(path.join(pc, 'kmd.cmd'), '@echo off\r\n"%~dp0node.exe" "%~dp0server\\bin\\kmd.mjs" %*\r\n')
  fs.writeFileSync(path.join(pc, 'kmd-key.cmd'), '@echo off\r\n"%~dp0node.exe" "%~dp0server\\bin\\kmd-key.mjs" %*\r\n')
  fs.writeFileSync(path.join(pc, '처음.txt'), `kmd ${v}: 이 PC\r\n\r\n보통은 이 꾸러미를 손으로 깔 일이 없다. 팀 화면 › 개인 지식 쓰기의 「설치 · 잇기 한 줄」 을 PowerShell 에 붙여 넣으면\r\n팀 서버에서 이 꾸러미를 받아 %USERPROFILE%\\.kmd-app 에 깔고(이미 깔려 있으면 이 판으로 올리고), 팀에 잇고, 늘 켜고, 개인 화면을 연다.\r\n\r\n팀 없이 쓰려면: 이 폴더에서 kmd.cmd up: 화면은 그 뒤 kmd.cmd open 으로 다시 연다.\r\n`)
  const zip = path.join(out, `kmd-${v}-pc.zip`)
  const tgz = path.join(out, `kmd-${v}-team.tgz`)
  fs.rmSync(zip, { force: true })
  fs.rmSync(tgz, { force: true })
  zipDir(out, path.basename(pc))
  // 파서 꾸러미 — 팀 꾸러미에 같이 넣어 팀 설치가 받기 자리(/dl)에 둔다
  const parser = packParser({ out })
  // 팀 꾸러미 — PC zip 을 함께 넣어 팀 설치가 받기 자리(/dl)에 둔다(설치 한 줄이 거기서 받는다)
  const team = path.join(out, `kmd-${v}-team`)
  base(team)
  fs.writeFileSync(path.join(team, 'build.json'), JSON.stringify({ build: v }) + '\n')
  copy(path.join(ROOT, 'scripts', 'kmd-install.sh'), path.join(team, 'kmd-install.sh'))
  copy(zip, path.join(team, path.basename(zip)))
  copy(parser.zip, path.join(team, path.basename(parser.zip)))
  execFileSync(TAR, ['-czf', path.basename(tgz), path.basename(team)], { cwd: out })
  return { pc, team, zip, tgz, build: v, modules: prodModules().length, parser }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = pack()
  console.log(`✓ 판 ${r.build} · ${path.relative(ROOT, r.zip)} · ${path.relative(ROOT, r.tgz)} · ${path.relative(ROOT, r.parser.zip)}: 꾸러미 ${r.modules}`)
}
