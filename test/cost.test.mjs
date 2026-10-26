// 비용 · 속도 — 문서 변환 비용 절감(2026-10-26).
//
// 일마다 Claude 모델(옮겨 적기 · 고르기는 haiku · 판단은 sonnet · 설정으로 바꾼다 · 「기본」 이면 --model 을 넘기지 않는다) ·
// pdf · hwp 는 서버가 글로(Claude 는 글 층이 없는 스캔 · 배포용 · 깨진 파일만) ·
// 넣기 에이전트는 파일 글을 다시 쓰지 않는다(from · append — kmd 가 원문을 옮긴다).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { modelOf, modelArgs, DEFAULT_MODELS, ROLES } from '../core/models.js'
import { runClaude } from '../core/claude.js'
import { runAgent } from '../core/agent.js'
import zlib from 'node:zlib'
import { hwpToMd } from '../core/hwp.js'
import { pdfToMd, cleanPages } from '../core/pdf.js'
import { planImport } from '../core/importer.js'
import { excerpt, fileText } from '../core/excerpt.js'
import { fileRecord } from '../core/analyze.js'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture')

test('일마다 모델 — 기본 배분 · 고른 값 · 「기본」 · 모르는 값', () => {
  assert.deepEqual(ROLES.map((r) => modelOf(r)), ROLES.map((r) => DEFAULT_MODELS[r]))
  assert.equal(modelOf('read'), 'haiku')
  assert.equal(modelOf('agent'), 'sonnet')
  assert.equal(modelOf('agent', { agent: 'opus' }), 'opus')
  assert.equal(modelOf('read', { read: '' }), '', '「기본」 은 그대로 빈 값')
  assert.equal(modelOf('read', { read: 'gpt-4' }), 'haiku', '모르는 값은 기본 배분으로')
  assert.deepEqual(modelArgs('haiku'), ['--model', 'haiku'])
  assert.deepEqual(modelArgs(''), [])
})

test('claude -p · 에이전트에 --model 이 간다(비면 넘기지 않는다)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-cost-'))
  const log = path.join(tmp, 'calls.log')
  const keep = { KMD_CLAUDE: process.env.KMD_CLAUDE, KMD_CLAUDE_AGENT: process.env.KMD_CLAUDE_AGENT, FAKE_CLAUDE_LOG: process.env.FAKE_CLAUDE_LOG }
  process.env.KMD_CLAUDE = path.join(FIX, 'fake-claude.mjs')
  process.env.KMD_CLAUDE_AGENT = path.join(FIX, 'fake-claude-agent.mjs')
  process.env.FAKE_CLAUDE_LOG = log
  try {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } }
    await runClaude({ prompt: 'x', schema, model: 'haiku' })
    await runClaude({ prompt: 'x', schema })
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['call haiku', 'call'])
    const lines = []
    const r = await runAgent({ prompt: '바꾼다', files: [{ name: '원본/a.pdf', data: Buffer.from('%PDF') }], model: 'haiku', onLine: (l) => lines.push(l) })
    assert.ok(r.ok)
    assert.ok(lines.some((l) => l.k === 'sys' && /모델 haiku/.test(l.x)))
    assert.ok(lines.some((l) => l.k === 'sys' && /fake-agent\(haiku\)/.test(l.x)))
  } finally {
    for (const [k, v] of Object.entries(keep)) v == null ? delete process.env[k] : (process.env[k] = v)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// ── pdf · hwp 를 서버에서 글로(Claude 는 스캔 · 깨진 파일만) ──

// 글 pdf — Helvetica · 줄 [y, 글] · 쪽마다
export function textPdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`]
  const font = 3 + pages.length * 2
  pages.forEach((lines, i) => {
    const body = lines.map(([y, t]) => `BT /F1 12 Tf 50 ${y} Td (${t}) Tj ET`).join('\n')
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`)
    objs.push(`<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`)
  })
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  let out = '%PDF-1.4\n'
  const offs = objs.map((o, i) => {
    const at = Buffer.byteLength(out, 'latin1')
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
    return at
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

// hwp — 복합 파일(작은 흐름 없이 · 경계 0) · FileHeader + BodyText/Section0
//   레코드 [태그, 깊이, 값] — 67 글(문자열 · 제어 번호) · 71 제어 id · 72 칸 [행, 열] · 77 표 [행 수, 열 수]
export function fakeHwp(recs, { compress = false, prop = 0 } = {}) {
  const rec = (tag, level, data) => {
    const h = Buffer.alloc(4)
    h.writeUInt32LE(((tag & 0x3ff) | ((level & 0x3ff) << 10) | (data.length << 20)) >>> 0)
    return Buffer.concat([h, data])
  }
  const ch = (c) => {
    const one = c === 10 || c === 13
    const b = Buffer.alloc(one ? 2 : 16)
    b.writeUInt16LE(c, 0)
    if (!one) b.writeUInt16LE(c, 14)
    return b
  }
  const text = (parts) => Buffer.concat([...parts.map((p) => (typeof p === 'number' ? ch(p) : Buffer.from(p, 'utf16le'))), ch(13)])
  const u16s = (vals, size) => {
    const b = Buffer.alloc(size)
    for (const [at, v] of vals) b.writeUInt16LE(v, at)
    return b
  }
  const data = ([tag, , x]) =>
    tag === 67 ? text(x) : tag === 71 ? Buffer.from(x.split('').reverse().join('') + '\0\0\0\0', 'latin1') : tag === 72 ? u16s([[0, 1], [10, x[0]], [8, x[1]]], 34) : tag === 77 ? u16s([[4, x[0]], [6, x[1]]], 8) : Buffer.alloc(0)
  const body = Buffer.concat(recs.map((r) => rec(r[0], r[1], data(r))))
  const section = compress ? zlib.deflateRawSync(body) : body
  const head = Buffer.alloc(256)
  head.write('HWP Document File', 0, 'latin1')
  head.writeUInt32LE(prop | (compress ? 1 : 0), 36)
  const SS = 512
  const pad = (b) => Buffer.concat([b, Buffer.alloc((SS - (b.length % SS)) % SS)])
  const streams = [pad(head), pad(section)]
  const fat = new Array(SS / 4).fill(0xffffffff)
  fat[0] = 0xfffffffd
  fat[1] = 0xfffffffe
  let s = 2
  const starts = streams.map((b) => {
    const st = s
    const n = b.length / SS
    for (let i = 0; i < n; i++) fat[s + i] = i === n - 1 ? 0xfffffffe : s + i + 1
    s += n
    return st
  })
  const fatBuf = Buffer.alloc(SS)
  fat.forEach((v, i) => fatBuf.writeUInt32LE(v >>> 0, i * 4))
  const N = 0xffffffff
  const ent = (name, type, child, right, start, size) => {
    const e = Buffer.alloc(128)
    e.write(name, 0, 'utf16le')
    e.writeUInt16LE((name.length + 1) * 2, 64)
    e[66] = type
    e.writeUInt32LE(N, 68)
    e.writeUInt32LE(right >>> 0, 72)
    e.writeUInt32LE(child >>> 0, 76)
    e.writeUInt32LE(start >>> 0, 116)
    e.writeUInt32LE(size, 120)
    return e
  }
  const dir = Buffer.concat([ent('Root Entry', 5, 1, N, 0xfffffffe, 0), ent('FileHeader', 2, N, 2, starts[0], head.length), ent('BodyText', 1, 3, N, 0, 0), ent('Section0', 2, N, N, starts[1], section.length)])
  const hdr = Buffer.alloc(512)
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(hdr, 0)
  hdr.writeUInt16LE(9, 30)
  hdr.writeUInt16LE(6, 32)
  hdr.writeUInt32LE(1, 44)
  hdr.writeUInt32LE(1, 48)
  hdr.writeUInt32LE(0, 56) // 작은 흐름 경계 0 — 모든 흐름을 보통 칸에
  hdr.writeUInt32LE(0xfffffffe, 60)
  hdr.writeUInt32LE(0xfffffffe, 68)
  for (let i = 0; i < 109; i++) hdr.writeUInt32LE(i === 0 ? 0 : N, 76 + i * 4)
  return Buffer.concat([hdr, fatBuf, pad(dir), ...streams])
}
const HWP_RECS = [
  [66, 0], [67, 1, ['배포 점검 규칙']],
  [66, 0], [67, 1, ['주기', 9, '3초 → 5초']],
  [66, 0], [67, 1, [11]], [71, 1, 'tbl '], [77, 2, [2, 2]],
  [72, 2, [0, 0]], [66, 2], [67, 3, ['항목']], [72, 2, [0, 1]], [66, 2], [67, 3, ['값']],
  [72, 2, [1, 0]], [66, 2], [67, 3, ['포트']], [72, 2, [1, 1]], [66, 2], [67, 3, ['502']],
  [66, 0], [67, 1, [16]], [71, 1, 'head'], [72, 2, [0, 0]], [66, 2], [67, 3, ['머리말 — 쪽마다']],
  [66, 0], [67, 1, ['끝 문단']],
]

test('hwp — 문단 · 탭 · 표는 md 표로 · 머리말은 뺀다 · 압축도 · 배포용은 못 꺼낸다', () => {
  for (const compress of [false, true]) {
    const md = hwpToMd(fakeHwp(HWP_RECS, { compress }))
    assert.match(md, /^배포 점검 규칙$/m)
    assert.match(md, /^주기\t3초 → 5초$/m)
    assert.match(md, /^\| 항목 \| 값 \|\n\|---\|---\|\n\| 포트 \| 502 \|$/m)
    assert.match(md, /끝 문단$/)
    assert.doesNotMatch(md, /머리말/)
  }
  assert.throws(() => hwpToMd(fakeHwp(HWP_RECS, { prop: 4 })), /배포용/)
  assert.throws(() => hwpToMd(Buffer.from('not a hwp at all'.repeat(40))), /hwp 모양이 아니다/)
})

test('pdf — 글을 줄로 · 되풀이 머리글 · 쪽 번호는 뺀다 · 글이 없으면 빈 글(스캔)', async () => {
  const pages = [1, 2, 3].map((n) => [[780, 'ACME Confidential'], [700, `Pump ${n} stopped at 14:0${n} for inspection`], [680, `Restart window ${n * 10} minutes`], [40, 'Plant A weekly report'], [20, `- ${n} -`]])
  const md = await pdfToMd(textPdf(pages))
  assert.match(md, /^Pump 1 stopped at 14:01 for inspection\nRestart window 10 minutes$/m)
  assert.match(md, /Pump 3 stopped/)
  assert.doesNotMatch(md, /ACME Confidential|Plant A weekly report/)
  assert.doesNotMatch(md, /^- \d -$/m)
  assert.equal(await pdfToMd(textPdf([[[700, ' ']]])), '', '글이 없다 — 스캔')
  await assert.rejects(pdfToMd(Buffer.from('%PDF-1.4 broken')), /pdf 모양이 아니다/)
  assert.equal(cleanPages([['머리', '본문 하나'], ['머리', '본문 둘']]), '머리\n본문 하나\n\n머리\n본문 둘', '두 쪽은 되풀이로 보지 않는다')
})

test('넣기 — pdf · hwp 는 Claude 없이 기록이 된다 · 스캔 pdf 만 mdOf(Claude) · 원본은 첨부', async () => {
  const k = { name: '시험', works: [] }
  const pdf = textPdf([1, 2, 3].map((n) => [[700, `Pump ${n} stopped at 14:0${n} for inspection`]]))
  let asked = 0
  const mdOf = async () => (asked++, '# 스캔\n\n옮긴 글')
  const plan = await planImport(k, [{ path: '점검.pdf', data: pdf }, { path: '규칙.hwp', data: fakeHwp(HWP_RECS) }, { path: '스캔.pdf', data: textPdf([[[700, ' ']]]) }], { asRecord: true, mdOf })
  assert.deepEqual(plan.rows.map((r) => r.kind), ['record', 'record', 'record'])
  assert.equal(asked, 1, 'Claude 는 스캔 pdf 하나만')
  assert.match(plan.records[0].body, /Pump 2 stopped/)
  assert.match(plan.records[1].body, /\| 포트 \| 502 \|/)
  assert.match(plan.records[2].body, /옮긴 글/)
  assert.deepEqual(plan.atts.map((a) => a.rel), ['docs/assets/점검.pdf', 'docs/assets/규칙.hwp', 'docs/assets/스캔.pdf'])
  const team = await planImport(k, [{ path: '스캔.pdf', data: textPdf([[[700, ' ']]]) }], { asRecord: true })
  assert.equal(team.rows[0].kind, 'fail')
  assert.match(team.rows[0].msg, /스캔/)
})

test('파일 글 옮기기 — 정리한 기록의 「본문」 · 머리 아래만 · 머리는 ### 로 · 없는 머리는 있는 머리를 알려 준다', () => {
  const md = '# 배포 절차\n\n## 1. 준비\n\n백업을 먼저 한다.\n\n### 1.1 점검\n\n- 디스크 80%\n\n## 2. 승인\n\n| 단계 | 사람 |\n|---|---|\n| 1 | 팀장 |\n\n```\n## 코드 안의 머리 아님\n```\n'
  const rec = fileRecord({ file: 'a/배포 절차.docx', author: 'kim', date: '2026-10-26', md }, { title: '배포 절차', summary: '배포 순서다.', points: ['백업 먼저'] })
  assert.ok(!fileText(rec.body).includes('무엇인가'), '분석은 옮기지 않는다')
  assert.ok(!fileText(rec.body).includes('짜임 그대로'), '안내 줄도')
  const all = excerpt(rec.body, '*')
  assert.match(all, /^### 1\. 준비$/m)
  assert.match(all, /^#### 1\.1 점검$/m)
  assert.match(all, /\| 1 \| 팀장 \|/)
  assert.match(all, /^## 코드 안의 머리 아님$/m, '코드 덩이 안은 그대로')
  const one = excerpt(rec.body, '1. 준비')
  assert.match(one, /^백업을 먼저 한다\.\n\n### 1\.1 점검\n\n- 디스크 80%$/)
  assert.equal(excerpt(rec.body, '## 2. 승인').split('\n')[0], '| 단계 | 사람 |')
  assert.throws(() => excerpt(rec.body, '3. 배포'), /그 머리가 없다 — 「3\. 배포」 · 있는 머리: 1\. 준비 · 1\.1 점검 · 2\. 승인/)
  assert.match(excerpt('# 제목\n\n그냥 글', '*'), /^그냥 글$/, '정리 전 기록은 # 제목 줄만 뺀다')
})
