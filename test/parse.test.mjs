// 대량 넣기 파서 kmd-parse(K6-1 · 설계 4-6) — 파일마다 한 줄 · 개인 프로그램 · 팀 화면과 같은 fileToMd · 같은 지문(md/)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { fileToMd } from '../core/importer.js'
import { storedZip, fakeHwp } from './fixture/officefiles.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BIN = path.join(HERE, '..', 'server', 'bin', 'kmd-parse.mjs')
const parse = (args) => new Promise((ok) => {
  const c = spawn(process.execPath, [BIN, ...args])
  const o = []
  c.stdout.on('data', (d) => o.push(d))
  c.stderr.on('data', (d) => o.push(d))
  c.on('close', (code) => ok({ code, lines: Buffer.concat(o).toString('utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) }))
})
const sha16 = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16)

const DOCX = storedZip([['word/document.xml', '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>배포 창</w:t></w:r></w:p><w:p><w:r><w:t>배포는 화요일 14:00 에 한다.</w:t></w:r></w:p></w:body></w:document>']])
const HWP = fakeHwp([[66, 0], [67, 1, ['점검 주기']], [66, 0], [67, 1, ['주기', 9, '5초']]])

function folder() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-parse-'))
  const src = path.join(d, '자료')
  fs.mkdirSync(path.join(src, '회의'), { recursive: true })
  fs.mkdirSync(path.join(src, '.git'), { recursive: true })
  fs.mkdirSync(path.join(src, 'node_modules', 'x'), { recursive: true })
  fs.writeFileSync(path.join(src, '배포.docx'), DOCX)
  fs.writeFileSync(path.join(src, '회의', '점검.hwp'), HWP)
  fs.writeFileSync(path.join(src, '메모.txt'), '﻿포트는 502 다.\r\n')
  fs.writeFileSync(path.join(src, '깨짐.hwp'), Buffer.from('not a hwp at all'.repeat(40)))
  fs.writeFileSync(path.join(src, '~$배포.docx'), 'lock')
  fs.writeFileSync(path.join(src, '.git', 'HEAD'), 'ref')
  fs.writeFileSync(path.join(src, 'node_modules', 'x', 'a.md'), '# x')
  fs.writeFileSync(path.join(src, '실행.exe'), 'MZ')
  return { d, src }
}

test('kmd-parse: docx · hwp · txt 를 한 줄씩 · 지문은 팀 화면 파일 넣기의 md/ 와 같다 · 숨김 · node_modules · 잠금 파일 · 모르는 꼴은 건너뜀 · 깨진 파일은 why · 종료 2', async () => {
  const { d, src } = folder()
  try {
    const r = await parse([src])
    assert.equal(r.code, 2, '일부 못 바꿈')
    const done = r.lines.at(-1)
    assert.deepEqual(done, { done: true, n: 4, fail: 1 })
    const by = Object.fromEntries(r.lines.slice(0, -1).map((l) => [l.rel, l]))
    assert.deepEqual(Object.keys(by).sort(), ['깨짐.hwp', '메모.txt', '배포.docx', '회의/점검.hwp'].sort())
    for (const rel of ['배포.docx', '회의/점검.hwp', '메모.txt']) {
      const l = by[rel]
      const want = await fileToMd(rel, fs.readFileSync(path.join(src, ...rel.split('/'))))
      assert.equal(l.md, want.md, `${rel}: 같은 fileToMd`)
      assert.equal(l.sha, sha16(want.md.trim()), `${rel}: 지문은 sha256(md.trim()) 앞 16`)
      assert.deepEqual(l.tags, [`ingest/${rel}`, `md/${l.sha}`])
      assert.deepEqual(l.atts, [], '--attach 가 없으면 첨부 자리를 싣지 않는다')
      assert.equal(l.failed, undefined)
    }
    assert.match(by['배포.docx'].md, /^# 배포\n\n## 배포 창\n\n배포는 화요일 14:00 에 한다\./)
    assert.match(by['회의/점검.hwp'].md, /주기\t5초/)
    assert.match(by['메모.txt'].md, /^# 메모\n\n포트는 502 다\.\n/)
    assert.ok(by['깨짐.hwp'].failed)
    assert.match(by['깨짐.hwp'].why, /hwp 모양이 아니다/)
  } finally {
    fs.rmSync(d, { recursive: true, force: true })
  }
})

test('kmd-parse: --out 은 글을 파일로 · index.json · --attach 는 원본 첨부 자리(오피스 · hwp 만 · 글은 원본이 곧 글)', async () => {
  const { d, src } = folder()
  try {
    const out = path.join(d, '나옴')
    const r = await parse([src, '--out', out, '--attach'])
    assert.equal(r.code, 2)
    const by = Object.fromEntries(r.lines.slice(0, -1).map((l) => [l.rel, l]))
    assert.equal(by['배포.docx'].md, undefined, '--out 이면 줄에 글을 싣지 않는다')
    assert.equal(fs.readFileSync(by['배포.docx'].mdFile, 'utf8'), (await fileToMd('배포.docx', DOCX)).md)
    assert.ok(fs.existsSync(path.join(out, '회의', '점검.hwp.md')))
    assert.deepEqual(by['배포.docx'].atts, [{ path: 'docs/assets/배포.docx', file: path.join(src, '배포.docx'), bytes: DOCX.length }])
    assert.equal(by['회의/점검.hwp'].atts[0].path, 'docs/assets/회의/점검.hwp')
    assert.deepEqual(by['메모.txt'].atts, [])
    const idx = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'))
    assert.deepEqual(idx.map((l) => l.rel).sort(), Object.keys(by).sort())
  } finally {
    fs.rmSync(d, { recursive: true, force: true })
  }
})

test('kmd-parse: 없는 파일은 why · 종료 1 · 파일 하나도 받는다 · 다시 돌려도 같은 지문(이어 하기)', async () => {
  const { d, src } = folder()
  try {
    const r = await parse([path.join(src, '없다.docx')])
    assert.equal(r.code, 1)
    assert.equal(r.lines[0].why, '없는 파일이다')
    assert.deepEqual(r.lines.at(-1), { done: true, n: 0, fail: 1 })
    const one = await parse([path.join(src, '메모.txt')])
    assert.equal(one.code, 0)
    assert.equal(one.lines[0].rel, '메모.txt')
    const again = await parse([path.join(src, '메모.txt')])
    assert.equal(again.lines[0].sha, one.lines[0].sha)
    const none = await parse([])
    assert.equal(none.code, 1)
    assert.match(none.lines[0].why, /쓰는 법/)
  } finally {
    fs.rmSync(d, { recursive: true, force: true })
  }
})
