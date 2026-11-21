// 짜임 꾸러미(core/survey.js · scripts/kmd-seed.mjs · 세션 스킬 kmd-seed · 바탕 세우기 설계 6절 · Z9)
//   조사(판 · 같은 글 · 사건 날짜 · 비밀 의심 · 스캔) → 스캔 글 넣기 → 구조안 → 마른 검사(덮임 · 비밀 · 재료 · 글 초안 꼴) · 꾸러미 열기 · 지식 폴더에 쓰지 않음

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { survey, openPack, packCheck, addText, isPack, promptOf, srcOf, secretsIn } from '../core/survey.js'
import { main } from '../scripts/kmd-seed.mjs'

// 글 층이 빈 pdf(스캔처럼) — Helvetica 한 쪽 · 빈칸만
function blankPdf() {
  const body = 'BT /F1 12 Tf 50 700 Td ( ) Tj ET'
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${body.length} >>\nstream\n${body}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let out = '%PDF-1.4\n'
  const offs = objs.map((o, i) => { const at = Buffer.byteLength(out, 'latin1'); out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
const put = (root, files) => { for (const [rel, data] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), data) } }
async function run(...argv) {
  const out = []
  const log = console.log
  const err = console.error
  console.log = (...a) => out.push(a.join(' '))
  console.error = (...a) => out.push(a.join(' '))
  process.exitCode = 0
  try { await main(argv) } finally { console.log = log; console.error = err }
  const code = process.exitCode
  process.exitCode = 0
  return { text: out.join('\n'), code }
}

let tmp, src, pack
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-seedpack-'))
  src = path.join(tmp, '원본')
  pack = path.join(tmp, '꾸러미')
  put(src, {
    '운영/배포절차_v1.md': '# 배포절차\n\n## 배포 창\n화요일 10:00.\n',
    '운영/배포절차_v2_최종.md': '# 배포절차\n\n## 배포 창\n목요일 14:00.\n\n## 되돌리기\n이전 판으로.\n',
    '보관/배포절차.md': '# 배포절차\n\n## 배포 창\n목요일 14:00.\n\n## 되돌리기\n이전 판으로.\n',
    '회의/2026-11-01 회의록.md': '# 회의\n\n결정: 배포는 목요일.\n',
    '회의/2026-11-08 회의록.md': '# 회의\n\n결정: 되돌리기 연습.\n',
    '운영/접속.txt': 'db password: hunter22\n',
    '스캔/서약서.pdf': blankPdf(),
    '.git/HEAD': 'x',
    '~$임시.docx': 'x',
  })
})
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

test('조사 — 판 묶음(늦은 판이 정본) · 사건은 날짜가 다르면 다른 사건 · 같은 글 · 비밀 의심 보류 · 스캔 보류 · 숨은 것 뺌 · 재료 글은 md/<sha16>', async () => {
  const r = await survey(src, { out: pack })
  for (const d of ['cards', 'texts']) assert.ok(fs.statSync(path.join(pack, d)).isDirectory(), `조사가 ${d}/ 자리를 만든다(세션이 mkdir 을 부르지 않는다)`)
  const by = Object.fromEntries(r.rows.map((x) => [x.path, x]))
  assert.deepEqual(Object.keys(by).sort(), ['스캔/서약서.pdf', '보관/배포절차.md', '운영/배포절차_v1.md', '운영/배포절차_v2_최종.md', '운영/접속.txt', '회의/2026-11-01 회의록.md', '회의/2026-11-08 회의록.md'].sort())
  assert.equal(by['운영/배포절차_v1.md'].role, '옛 판')
  assert.equal(by['운영/배포절차_v1.md'].pick, '빼기')
  assert.ok(['정본', '같은 글'].includes(by['운영/배포절차_v2_최종.md'].role))
  assert.equal(by['운영/배포절차_v1.md'].group, by['운영/배포절차_v2_최종.md'].group)
  // 같은 글 — 둘 가운데 하나만 정본
  const twins = [by['운영/배포절차_v2_최종.md'], by['보관/배포절차.md']]
  assert.equal(twins[0].src, twins[1].src)
  assert.deepEqual(twins.map((x) => x.role).sort(), ['같은 글', '정본'].sort())
  assert.equal(by['회의/2026-11-01 회의록.md'].role, '정본')
  assert.equal(by['회의/2026-11-08 회의록.md'].role, '정본', '날짜가 다른 회의는 옛 판이 아니다')
  assert.equal(by['운영/접속.txt'].role, '비밀 의심')
  assert.equal(by['운영/접속.txt'].pick, '보류')
  assert.ok(!JSON.stringify(by['운영/접속.txt'].secret).includes('hunter22'), '비밀 값은 싣지 않는다')
  assert.equal(by['스캔/서약서.pdf'].role, '스캔')
  assert.equal(by['스캔/서약서.pdf'].pick, '보류')
  assert.equal(r.counts.scanNeed, 1)
  const v2 = by['운영/배포절차_v2_최종.md']
  assert.match(v2.src, /^m:[0-9a-f]{16}$/)
  assert.equal(srcOf(fs.readFileSync(path.join(pack, 'md', `${v2.src.slice(2)}.md`), 'utf8')), v2.src, '재료 id 는 들이기 md/<sha16> 와 같은 지문')
  assert.deepEqual(v2.digest.heads, ['# 배포절차', '## 배포 창', '## 되돌리기'])
  assert.ok(await isPack(pack))
  assert.deepEqual(secretsIn('-----BEGIN RSA PRIVATE KEY-----').map((x) => x.why), ['개인 열쇠'])
  assert.deepEqual(secretsIn('주민 900101-1234567').map((x) => x.why), ['주민번호 꼴'])
  assert.deepEqual(secretsIn('비밀번호 정책은 10자 이상이다'), [], '말로 쓴 비밀번호 규칙은 걸지 않는다')
})

test('꾸러미 자리 — 지식 폴더 · 비어 있지 않은 폴더 · 원본 자신에는 쓰지 않는다', async () => {
  const kn = path.join(tmp, '지식')
  put(kn, { 'docs/처음.md': '# 처음\n' })
  await assert.rejects(survey(src, { out: kn }), /지식 폴더처럼/)
  const other = path.join(tmp, '다른')
  put(other, { 'a.txt': 'x' })
  await assert.rejects(survey(src, { out: other }), /비어 있지 않은 폴더/)
  await assert.rejects(survey(src, { out: src }), /원본 폴더 자신/)
  assert.deepEqual(fs.readdirSync(kn), ['docs'], '지식 폴더에 아무것도 쓰지 않았다')
})

test('스캔 글 넣기 — 재료가 되고(scan · 넣음) 다시 조사해도 이어 쓴다 · 스캔이 아닌 파일 · 없는 파일은 거절', async () => {
  const row = await addText(pack, '스캔/서약서.pdf', '# 서약서\n\n보안 서약은 입사 첫날 받는다.\n')
  assert.equal(row.role, '스캔')
  assert.equal(row.scan, true)
  assert.equal(row.pick, '넣음')
  assert.match(row.src, /^m:/)
  await assert.rejects(addText(pack, '운영/배포절차_v1.md', '# x\n\n글\n'), /스캔이 아니다/)
  await assert.rejects(addText(pack, '없는.pdf', '# x\n'), /없는 파일/)
  const again = await survey(src, { out: pack })
  const s = again.rows.find((x) => x.path === '스캔/서약서.pdf')
  assert.equal(s.src, row.src, '같은 원본의 스캔 글을 이어 쓴다')
  assert.equal(again.counts.scanNeed, 0)
})

test('마른 검사 — 구조안 없음 · 덮임 빠짐 · 비밀 의심 재료 · 없는 재료 · 글 초안 꼴 · 다 맞으면 걸림 없음(지식에 쓰지 않음)', async () => {
  const P0 = await openPack(pack)
  assert.equal(P0.plan, null)
  let r = await run('check', pack)
  assert.equal(r.code, 2)
  assert.match(r.text, /구조안이 아직 없다/)
  const rows = P0.rows
  const s = (p) => rows.find((x) => x.path === p).src
  const plan = {
    v: 1, kind: 'seed',
    docs: [
      { id: '운영/배포', was: null, intro: { text: '배포 창과 되돌리기 절차를 다룬다.' }, items: [{ h: '배포 창', src: [s('운영/배포절차_v2_최종.md')] }, { h: '되돌리기', src: [s('운영/배포절차_v2_최종.md'), s('운영/접속.txt')] }] },
    ],
  }
  fs.writeFileSync(path.join(pack, 'plan.json'), JSON.stringify(plan))
  const c1 = await packCheck(pack)
  assert.equal(c1.ok, false)
  assert.ok(c1.errors.some((e) => e.code === 'secret'), '비밀 의심 재료를 쓰면 걸림')
  assert.ok(c1.errors.filter((e) => e.code === 'coverage').map((e) => e.where).includes('회의/2026-11-01 회의록.md'), '넣음 재료가 어디에도 없으면 걸림')
  // 고침 — 비밀 재료 빼고 · 회의는 회의록 사건 항목 · 스캔 글은 서약 문서 · 없는 재료 하나 · 글 초안에 기록 링크
  plan.docs[0].items[1].src = [s('운영/배포절차_v2_최종.md')]
  plan.docs.push({ id: '회의록', was: null, items: [{ h: '2026-11-01 배포 요일', src: [s('회의/2026-11-01 회의록.md')] }, { h: '2026-11-08 되돌리기 연습', src: [s('회의/2026-11-08 회의록.md')] }] })
  plan.docs.push({ id: '보안 서약', was: null, items: [{ h: '서약 받는 때', src: [s('스캔/서약서.pdf'), 'm:0000000000000000'] }] })
  fs.writeFileSync(path.join(pack, 'plan.json'), JSON.stringify(plan))
  fs.mkdirSync(path.join(pack, 'texts'), { recursive: true })
  fs.writeFileSync(path.join(pack, 'texts', '운영__배포.json'), JSON.stringify({ doc: '운영/배포', items: [{ h: '배포 창', text: '목요일 14:00 이다. [기록](../../work/2026-1101-a.md)' }, { h: '없는 항목', text: '글' }] }))
  const c2 = await packCheck(pack)
  assert.ok(c2.errors.some((e) => e.code === 'src' && /m:0000000000000000/.test(e.why)), '꾸러미에 없는 재료')
  assert.ok(c2.errors.some((e) => e.code === 'format' && /기록 · 이력 링크/.test(e.why)), '글 초안 꼴(작성기준 3절)')
  assert.ok(c2.errors.some((e) => e.code === 'text' && /없는 항목/.test(e.where)))
  assert.ok(!c2.errors.some((e) => e.code === 'secret' || e.code === 'coverage'), JSON.stringify(c2.errors))
  // 다 고침
  plan.docs[2].items[0].src = [s('스캔/서약서.pdf')]
  fs.writeFileSync(path.join(pack, 'plan.json'), JSON.stringify(plan))
  fs.writeFileSync(path.join(pack, 'texts', '운영__배포.json'), JSON.stringify({ doc: '운영/배포', items: [{ h: '배포 창', text: '배포 창은 목요일 14:00 이다.' }] }))
  r = await run('check', pack)
  assert.equal(r.code, 0, r.text)
  assert.match(r.text, /걸림 없음/)
  // 꾸러미 열기 — 화면(기초 세우기)이 원본 대신 받는 것
  const P = await openPack(pack)
  assert.equal(P.plan.kind, 'seed')
  assert.equal(P.texts.length, 1)
  assert.deepEqual(P.problems, [])
  // 넣을 지식을 읽기만 — 빈 지식(처음 하나)에 견주면 「처음」 을 걷을 문서로 · 지식 폴더는 그대로
  const kn = path.join(tmp, '빈지식')
  put(kn, { 'docs/처음.md': '# 처음\n' })
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: kn, encoding: 'utf8' })
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-q', '-m', 'init')
  r = await run('check', pack, '--kn', kn)
  assert.match(r.text, /처음/)
  plan.empty = ['처음']
  fs.writeFileSync(path.join(pack, 'plan.json'), JSON.stringify(plan))
  r = await run('check', pack, '--kn', kn)
  assert.equal(r.code, 0, r.text)
  assert.equal(git('status', '--porcelain'), '', '지식 폴더에 쓰지 않는다')
})

test('꾸러미 열기 — 손으로 고친 재료 글 · 깨진 manifest · 꾸러미 아닌 폴더 · 깨진 plan', async () => {
  const P = await openPack(pack)
  const one = P.rows.find((x) => x.role === '정본')
  const f = path.join(pack, 'md', `${one.src.slice(2)}.md`)
  const keep = fs.readFileSync(f, 'utf8')
  fs.writeFileSync(f, keep + '\n덧붙임\n')
  assert.ok((await openPack(pack)).problems.some((p) => /지문이 다르다/.test(p.why)))
  fs.writeFileSync(f, keep)
  const pj = fs.readFileSync(path.join(pack, 'plan.json'), 'utf8')
  fs.writeFileSync(path.join(pack, 'plan.json'), '{ 깨짐')
  assert.match((await openPack(pack)).planError, /깨졌다/)
  fs.writeFileSync(path.join(pack, 'plan.json'), pj)
  await assert.rejects(openPack(src), /꾸러미가 아니다/)
  const bad = path.join(tmp, '깨진꾸러미')
  put(bad, { 'manifest.json': '{ 깨짐' })
  await assert.rejects(openPack(bad), /깨졌다/)
  await assert.rejects(survey(src, { out: bad }), /깨졌다/, '깨진 manifest 를 빈 것으로 보고 덮지 않는다')
})

test('프롬프트 — 카드 · 구조안 · 글에 작성기준(좋은 예 · 나쁜 예) · 6-1 판단 기준 · 비밀 의심 재료는 카드에 싣지 않는다', async () => {
  const P = await openPack(pack)
  const card = promptOf(P, 'card', { n: 50 })
  assert.match(card, /짜임 판단 기준/)
  assert.ok(!card.includes('운영/접속.txt'), '비밀 의심 재료는 카드로 보내지 않는다')
  assert.ok(!card.includes('배포절차_v1'), '빼기로 고른 옛 판은 카드로 보내지 않는다')
  assert.match(promptOf(P, 'plan'), /"kind": "seed"/)
  const text = promptOf(P, 'text', { doc: '운영/배포' })
  assert.match(text, /좋은 예/)
  assert.match(text, /나쁜 예/)
  assert.match(text, /배포 창/)
  assert.throws(() => promptOf(P, 'text', { doc: '없음' }), /구조안에 없는 문서/)
  const r = await run('status', pack)
  assert.match(r.text, /구조안 문서 3/)
})

test('프롬프트 --save(채널 평가 T10): 꾸러미 prompts/ 에 쓰고 경로 한 줄만 · 글은 출력과 같다 · 꾸러미 검사는 prompts/ 를 보지 않는다', async () => {
  const P = await openPack(pack)
  const plan = await run('prompt', pack, 'plan', '--save')
  assert.equal(plan.code, 0)
  assert.equal(plan.text.trim(), path.join(P.pack, 'prompts', 'plan.md'))
  assert.equal(fs.readFileSync(plan.text.trim(), 'utf8'), promptOf(P, 'plan') + '\n')
  assert.match(promptOf(P, 'plan'), /쓸 것은 plan\.json 하나다/)
  const text = await run('prompt', pack, 'text', '운영/배포', '--save')
  assert.equal(text.text.trim(), path.join(P.pack, 'prompts', 'text-운영__배포.md'))
  const card = await run('prompt', pack, 'card', '--from', '0', '--save')
  assert.ok(fs.existsSync(path.join(P.pack, 'prompts', 'card-0.md')), card.text)
  assert.ok(!(await openPack(pack)).problems.some((x) => /prompts/.test(x.where)))
})
