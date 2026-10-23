// 꾸러미 만들기 — dist/ 에 PC 꾸러미(폴더 + zip)와 팀 서버 꾸러미(tgz).
//
//   PC    kmd-<판>-pc/   node.exe(이 Node 그대로) · app · core · server · agent · 쓰는 node_modules · kmd.cmd · kmd-key.cmd · 처음.txt
//         → kmd-<판>-pc.zip. 한 파일 exe(SEA)는 ESM 묶기(번들러)가 있어야 해 이 판은 「풀면 바로 도는 폴더」 로 낸다.
//   팀    kmd-<판>-team.tgz  같은 것(node 빼고) + kmd-install.sh(systemd) — 서버의 node 22 를 쓴다
//   걸러 냄  test · docs · .git · .kmd-data · devDependencies
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

function copy(from, to) {
  const st = fs.statSync(from)
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true })
    for (const n of fs.readdirSync(from)) copy(path.join(from, n), path.join(to, n))
  } else fs.copyFileSync(from, to)
}
// 쓰는 꾸러미만(lock 의 dev 아닌 것)
const prodModules = () => Object.entries(lock.packages || {}).filter(([k, v]) => k.startsWith('node_modules/') && !v.dev).map(([k]) => k)

function base(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  for (const s of SRC) copy(path.join(ROOT, s), path.join(dir, s))
  for (const m of prodModules()) copy(path.join(ROOT, m), path.join(dir, m))
}

export function pack({ out = DIST } = {}) {
  const v = pkg.version
  const pc = path.join(out, `kmd-${v}-pc`)
  base(pc)
  fs.copyFileSync(process.execPath, path.join(pc, 'node.exe'))
  fs.writeFileSync(path.join(pc, 'kmd.cmd'), '@echo off\r\n"%~dp0node.exe" "%~dp0server\\bin\\kmd.mjs" %*\r\n')
  fs.writeFileSync(path.join(pc, 'kmd-key.cmd'), '@echo off\r\n"%~dp0node.exe" "%~dp0server\\bin\\kmd-key.mjs" %*\r\n')
  fs.writeFileSync(path.join(pc, '처음.txt'), `kmd ${v} — 이 PC\r\n\r\n이 폴더를 그대로 두고(예: %LOCALAPPDATA%\\kmd) PATH 에 더한 뒤,\r\n팀 화면 › 설치 한 줄을 PowerShell 에 붙여 넣는다. 팀 없이 쓰려면: kmd up\r\n`)
  const team = path.join(out, `kmd-${v}-team`)
  base(team)
  copy(path.join(ROOT, 'scripts', 'kmd-install.sh'), path.join(team, 'kmd-install.sh'))
  const zip = path.join(out, `kmd-${v}-pc.zip`)
  const tgz = path.join(out, `kmd-${v}-team.tgz`)
  fs.rmSync(zip, { force: true })
  fs.rmSync(tgz, { force: true })
  // Windows 는 시스템 tar(bsdtar · -a 로 zip) — Git 의 GNU tar 는 C: 를 원격 주소로 읽는다 · 경로는 dist 안 이름만
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  execFileSync(tar, ['-a', '-cf', path.basename(zip), path.basename(pc)], { cwd: out })
  execFileSync(tar, ['-czf', path.basename(tgz), path.basename(team)], { cwd: out })
  return { pc, team, zip, tgz, modules: prodModules().length }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = pack()
  console.log(`✓ ${path.relative(ROOT, r.zip)} · ${path.relative(ROOT, r.tgz)} — 꾸러미 ${r.modules}`)
}
