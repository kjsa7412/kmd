// 꾸러미 만들기 — dist/ 에 PC 꾸러미(폴더 + zip)와 팀 서버 꾸러미(tgz).
//
//   PC    kmd-<판>-pc/   node.exe(이 Node 그대로) · app · core · server · agent · 설명서(docs) · 쓰는 node_modules · kmd.cmd · kmd-key.cmd · 처음.txt
//         → kmd-<판>-pc.zip. 한 파일 exe(SEA)는 ESM 묶기(번들러)가 있어야 해 이 판은 「풀면 바로 도는 폴더」 로 낸다.
//         설치 한 줄이 이 zip 을 팀 서버의 받기 자리(/dl)에서 받아 ~/.kmd-app/versions/<판> 에 풀고 실행기를 세운다.
//   팀    kmd-<판>-team.tgz  같은 것(node 빼고) + kmd-install.sh(systemd) + PC zip(설치가 받기 자리에 둔다) — 서버의 node 22 를 쓴다
//   걸러 냄  test · 설명서 밖의 docs · .git · .kmd-data · devDependencies
// 쓰기: node scripts/pack.mjs   (서명 · 올리기는 사람)

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))
const DIST = path.join(ROOT, 'dist')
const SRC = ['app', 'core', 'server', 'agent', 'package.json', 'CHANGELOG.md']
// 화면의 「설명서」(/manual)가 그리는 문서 — server/http.js 의 MANUALS 와 같다
const MANUAL_DOCS = ['설명서_사용자.md', '설명서_정리하는사람.md', '설명서_관리자.md', 'kmd_운영.md']

function copy(from, to) {
  const st = fs.statSync(from)
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true })
    for (const n of fs.readdirSync(from)) copy(path.join(from, n), path.join(to, n))
  } else fs.copyFileSync(from, to)
}
// 쓰는 꾸러미만(lock 의 dev 아닌 것) — pdf.js 의 그리기(@napi-rs/canvas · 고른 꾸러미)는 글만 꺼내므로 뺀다
const prodModules = () => Object.entries(lock.packages || {}).filter(([k, v]) => k.startsWith('node_modules/') && !v.dev && !k.startsWith('node_modules/@napi-rs/')).map(([k]) => k)
// 큰 꾸러미는 쓰는 파일만 — pdf.js 는 Node 판(legacy) · 글자 표(cmaps) · 기본 글꼴(37MB → 몇 MB)
const ONLY = { 'node_modules/pdfjs-dist': ['package.json', 'LICENSE', 'legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs', 'cmaps', 'standard_fonts'] }

function base(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  for (const s of SRC) copy(path.join(ROOT, s), path.join(dir, s))
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true })
  for (const d of MANUAL_DOCS) copy(path.join(ROOT, 'docs', d), path.join(dir, 'docs', d))
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

export function pack({ out = DIST } = {}) {
  const v = pkg.version
  const pc = path.join(out, `kmd-${v}-pc`)
  base(pc)
  fs.copyFileSync(process.execPath, path.join(pc, 'node.exe'))
  fs.writeFileSync(path.join(pc, 'kmd.cmd'), '@echo off\r\n"%~dp0node.exe" "%~dp0server\\bin\\kmd.mjs" %*\r\n')
  fs.writeFileSync(path.join(pc, 'kmd-key.cmd'), '@echo off\r\n"%~dp0node.exe" "%~dp0server\\bin\\kmd-key.mjs" %*\r\n')
  fs.writeFileSync(path.join(pc, '처음.txt'), `kmd ${v}: 이 PC\r\n\r\n보통은 이 꾸러미를 손으로 깔 일이 없다. 팀 화면 › 설정 › 에이전트 설치의 「설치 한 줄」 을 PowerShell 에 붙여 넣으면\r\n팀 서버에서 이 꾸러미를 받아 %USERPROFILE%\\.kmd-app 에 깔고, 팀에 잇고, 늘 켜고, 화면을 연다.\r\n\r\n팀 없이 쓰려면: 이 폴더에서 kmd.cmd up: 화면은 그 뒤 kmd.cmd open 으로 다시 연다.\r\n`)
  const zip = path.join(out, `kmd-${v}-pc.zip`)
  const tgz = path.join(out, `kmd-${v}-team.tgz`)
  fs.rmSync(zip, { force: true })
  fs.rmSync(tgz, { force: true })
  // Windows 는 시스템 tar(bsdtar · -a 로 zip) — Git 의 GNU tar 는 C: 를 원격 주소로 읽는다 · 경로는 dist 안 이름만
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  // 파일 이름은 UTF-8(깃발 11) — 그냥 묶으면 한글 이름(설명서_사용자.md)이 이 PC 의 코드 페이지로 들어가 다른 코드 페이지의 PC 에서 깨진다
  execFileSync(tar, ['-a', '-cf', path.basename(zip), ...(process.platform === 'win32' ? ['--options', 'hdrcharset=UTF-8'] : []), path.basename(pc)], { cwd: out })
  // 팀 꾸러미 — PC zip 을 함께 넣어 팀 설치가 받기 자리(/dl)에 둔다(설치 한 줄이 거기서 받는다)
  const team = path.join(out, `kmd-${v}-team`)
  base(team)
  copy(path.join(ROOT, 'scripts', 'kmd-install.sh'), path.join(team, 'kmd-install.sh'))
  copy(zip, path.join(team, path.basename(zip)))
  execFileSync(tar, ['-czf', path.basename(tgz), path.basename(team)], { cwd: out })
  return { pc, team, zip, tgz, modules: prodModules().length }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = pack()
  console.log(`✓ ${path.relative(ROOT, r.zip)} · ${path.relative(ROOT, r.tgz)}: 꾸러미 ${r.modules}`)
}
