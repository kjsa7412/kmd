// 파서 꾸러미(K6-2 · 설계 4-6) — kmd-parse-<pver>.zip 의 짜임 · 같은 내용이면 같은 판 · 묶음 밖 import 면 멈춘다 · 묶음만으로 돈다
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { packParser, parserVer, parserImportsOutside, PARSER_FILES } from '../scripts/pack.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'

test('파서 꾸러미: zip 짜임 · 같은 내용이면 같은 pver · 묶음만으로 kmd-parse 가 돈다', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-packparse-'))
  try {
    const fakeNode = path.join(out, 'fake-node.exe')
    fs.writeFileSync(fakeNode, 'node')
    const a = packParser({ out, nodeExe: fakeNode })
    assert.match(a.pver, /^[0-9a-f]{12}$/)
    assert.equal(path.basename(a.zip), `kmd-parse-${a.pver}.zip`)
    assert.equal(a.pver, parserVer(), '판은 묶는 파일 글 + node 판 + pdf.js 판')
    const list = execFileSync(TAR, ['-tf', a.zip], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).map((x) => x.replace(/\\/g, '/'))
    const has = (p) => list.includes(`kmd-parse-${a.pver}/${p}`)
    for (const f of [...PARSER_FILES, 'node.exe', 'kmd-parse.cmd', 'package.json', 'build.json', 'node_modules/pdfjs-dist/legacy/build/pdf.mjs', 'node_modules/pdfjs-dist/package.json']) assert.ok(has(f), `zip 에 ${f}`)
    assert.ok(!list.some((x) => /\/(app|agent)\/|server\/(hub|http|mcp)\.js|core\/(save|hub)\.js/.test(x)), '파서 밖의 파일은 묶지 않는다')
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(a.dir, 'build.json'), 'utf8')), { parse: a.pver })
    assert.match(fs.readFileSync(path.join(a.dir, 'kmd-parse.cmd'), 'utf8'), /"%~dp0node\.exe" "%~dp0server\\bin\\kmd-parse\.mjs" %\*/)
    // 같은 내용 → 같은 판(PC 가 다시 받지 않는다) · node 판이 다르면 다른 판
    const b = packParser({ out, nodeExe: fakeNode })
    assert.equal(b.pver, a.pver)
    assert.notEqual(parserVer({ nodeVer: 'v0.0.0' }), a.pver)
    // 묶음만으로 돈다 — 저장소 밖(꾸러미 폴더)의 kmd-parse 가 글 파일을 바꾼다
    const src = path.join(out, '자료')
    fs.mkdirSync(src)
    fs.writeFileSync(path.join(src, '메모.txt'), '포트는 502 다.')
    const r = spawnSync(process.execPath, [path.join(a.dir, 'server', 'bin', 'kmd-parse.mjs'), src], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(lines[0].rel, '메모.txt')
    assert.match(lines[0].md, /포트는 502 다/)
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})

test('파서 꾸러미: 파서 파일이 묶음 밖을 부르면 pack 이 멈춘다', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-packparse-bad-'))
  try {
    for (const f of PARSER_FILES) {
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true })
      fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f))
    }
    assert.deepEqual(parserImportsOutside(tmp), [], '지금 파서 파일은 묶음 안만 부른다')
    fs.appendFileSync(path.join(tmp, 'core', 'text.js'), "\nimport { x } from './knowledge.js'\n")
    fs.appendFileSync(path.join(tmp, 'core', 'hwp.js'), "\nconst y = await import('ws')\n")
    assert.deepEqual(parserImportsOutside(tmp), ['core/hwp.js → ws', 'core/text.js → ./knowledge.js'])
    assert.throws(() => packParser({ out: tmp, root: tmp, nodeExe: path.join(tmp, 'core', 'text.js') }), /묶음 밖을 부른다\(core\/hwp\.js → ws · core\/text\.js → \.\/knowledge\.js\)/)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
