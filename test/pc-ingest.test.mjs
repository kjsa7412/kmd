// 저장 승인 PC4 — 개인 들이기 = 무인 채널 규칙(저장 승인 설계 P-D42 · b18 · b21 · b24 · 6-5 「개인 프로그램 특성 시험」 · 7-1 PC4)
//
// approve 개인 지식의 파일 넣기 · 가져올 곳(코드 바뀜)은 기록을 먼저(pend) 세우지 않는다: 초안(claude -p 들이기 초안) → 검사 → FIX → 규칙 길 →
// 기록(원천 인용 · 원본 첨부) + 문서가 한 커밋 · 값 경고는 막지 않고 `## 값 대조`(규칙 길로 떨어지지 않는다) · Claude 끔 · 한 번 넣기 상한 → 규칙 길 ·
// 코드 바뀜도 같은 규칙(초안이면 기능 항목 + 기록 · 규칙 길이면 이은 항목에 잇기만) · 정리(curateSoon)를 걸지 않는다 · 옛 개인 지식은 기록 먼저 그대로(PC5 · PC6 전)

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { startServer } from '../server/http.js'
import { copyDir } from './helpers.mjs'
import { RECORDS_DOC, RECORDS_INTRO, RECORDS_DOC_PATH } from '../core/guard.js'
import { storedZip } from './fixture/officefiles.mjs'
import { judgeReflect } from '../core/values.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ME = { user: 'kim', admin: true, pc: true }
let tmp, pc, repo
const curates = []

const pdir = (id) => path.join(tmp, 'pc', id)
const G = (dir, ...a) => execFileSync('git', ['-c', 'user.name=박개발', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', '-c', 'core.quotepath=false', ...a], { cwd: dir, encoding: 'utf8' }).trim()
const commits = (id) => Number(G(pdir(id), 'rev-list', '--count', 'HEAD'))
const headFiles = (id) => G(pdir(id), 'show', '--name-only', '--format=', 'HEAD').split(/\r?\n/).filter(Boolean)
const fresh = async (id) => { pc.hub.forget?.(id); return pc.hub.get(id) }
const section = (id, doc, h) => fs.readFileSync(path.join(pdir(id), 'docs', `${doc}.md`), 'utf8').split(`## ${h}`)[1].split('\n## ')[0]
const savelogOf = (id) => fs.readFileSync(path.join(tmp, 'pcdata', 'savelog', `${encodeURIComponent(id)}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const env = (k, v, f) => async () => { const old = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; try { return await f() } finally { if (old == null) delete process.env[k]; else process.env[k] = old } }
const docx = (paras) => storedZip([['word/document.xml', `<?xml version="1.0"?><w:document><w:body>${paras.map(([st, t]) => `<w:p>${st ? `<w:pPr><w:pStyle w:val="${st}"/></w:pPr>` : ''}<w:r><w:t>${t}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`]])

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-pc-ingest-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  delete process.env.KMD_CLAUDE_AGENT // 넣기 에이전트 없이 — claude -p 들이기 초안 길(에이전트 길은 agent 시험)
  // dpms(옛 개인 지식 · 이행 전) · apv(이행을 마친 개인 지식 = 「저장 방식: 승인」 · 기록 없는 dpms 문서 · 기록 모음)
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'pc'))
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), pdir('apv'))
  fs.rmSync(path.join(pdir('apv'), 'work'), { recursive: true, force: true })
  fs.writeFileSync(path.join(pdir('apv'), 'README.md'), '# 승인 지식\n')
  fs.writeFileSync(path.join(pdir('apv'), '_members.md'), '# 사람\n\n- 주인: kim\n- 저장 방식: 승인\n')
  fs.mkdirSync(path.dirname(path.join(pdir('apv'), ...RECORDS_DOC_PATH.split('/'))), { recursive: true })
  fs.writeFileSync(path.join(pdir('apv'), ...RECORDS_DOC_PATH.split('/')), `# ${RECORDS_DOC}\n\n${RECORDS_INTRO}\n`)
  // 코드 저장소(가져올 곳 git)
  repo = path.join(tmp, 'src', 'repo')
  fs.mkdirSync(repo, { recursive: true })
  fs.writeFileSync(path.join(repo, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 3초\nclass HealthCheck {\n  int timeoutSec = 3;\n}\n')
  G(repo, 'init', '-q', '-b', 'main')
  G(repo, 'add', '-A')
  G(repo, 'commit', '-q', '-m', '처음')
  fs.mkdirSync(path.join(tmp, 'pcdata'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'pcdata', 'serve.json'), JSON.stringify({ curateOnStart: false, decideMs: 3600000, inboxTickMs: 3600000 }))
  // 처음 커밋(손으로 둔 파일) — 시험이 세는 커밋은 그 뒤부터
  for (const id of ['apv', 'dpms']) { G(pdir(id), 'init', '-q'); G(pdir(id), 'add', '-A'); G(pdir(id), 'commit', '-q', '-m', '처음') }
  pc = await startServer({ root: path.join(tmp, 'pc'), data: path.join(tmp, 'pcdata'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  const soon = pc.hub.curateSoon
  pc.hub.curateSoon = (id) => { curates.push(id); return soon(id) }
})
after(async () => {
  await pc?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('개인 들이기 = 기록 + 문서 한 커밋 · pend 를 거치지 않음 · 원본 첨부 · 정리를 걸지 않는다', async () => {
  assert.equal(pc.hub.saveModeOf('apv'), 'approve')
  const n0 = commits('apv')
  const file = docx([['Heading1', '매일 백업'], ['', 'DB 는 매일 02:00 에 백업한다. 14일치를 둔다.']])
  const r = await pc.hub.importFiles(ME, 'apv', [{ path: '운영/백업 바꿈.docx', data: file }])
  assert.equal(r.rows[0].kind, 'doc', JSON.stringify(r.rows[0]))
  assert.equal(commits('apv'), n0 + 1, '기록 + 문서 + 첨부가 한 커밋')
  const k = await fresh('apv')
  const w = k.byWork.get(r.rows[0].rec)
  assert.equal(w.state, 'in')
  for (const t of ['intake', 'put', 'ingest/운영/백업 바꿈.docx']) assert.ok(w.tags.includes(t), `태그 ${t}: ${w.tags}`)
  assert.ok(w.tags.some((t) => /^md\/[0-9a-f]{16}$/.test(t)))
  assert.match(w.body, /^## 원천\n- 파일 운영\/백업 바꿈\.docx · 지문 /m)
  assert.ok(!k.works.some((x) => x.state === 'pend'), '기록만 서는 상태(pend)가 없다')
  const files = headFiles('apv')
  assert.ok(files.includes(`work/${w.id}.md`) && files.includes('docs/백업절차.md') && files.includes('docs/assets/운영/백업 바꿈.docx'), files.join(' · '))
  assert.ok(fs.readFileSync(path.join(pdir('apv'), 'docs', 'assets', '운영', '백업 바꿈.docx')).equals(file), '원본 첨부')
  assert.match(section('apv', '백업절차', '매일 백업'), /02:00 에 백업한다. 14일치/)
  assert.ok(!curates.includes('apv'), '정리(curateSoon)를 걸지 않는다')
  const sl = savelogOf('apv').pop()
  assert.equal(sl.ch, 'intake-file')
  assert.equal(sl.mode, 'approve')
  // 같은 파일을 다시 넣으면 그대로(같은 기록 · 커밋 없음)
  const again = await pc.hub.importFiles(ME, 'apv', [{ path: '운영/백업 바꿈.docx', data: file }])
  assert.equal(again.rows[0].kind, 'same')
  assert.equal(commits('apv'), n0 + 1)
})

test('개인 들이기 값 경고 = 들어감 + `## 값 대조`(규칙 길로 떨어지지 않음 · savelog warned)', env('FAKE_CLAUDE_MODE', 'badall', async () => {
  const r = await pc.hub.importFiles(ME, 'apv', [{ path: '카나리 바꿈.md', data: Buffer.from('# 카나리 바꿈\n\n## 카나리\n`canary-1` 에 먼저 올리고, 첫 30분은 요청의 20% 만 보낸다.\n') }])
  assert.equal(r.rows[0].kind, 'doc', JSON.stringify(r.rows[0]))
  const w = (await fresh('apv')).byWork.get(r.rows[0].rec)
  assert.equal(w.state, 'in')
  assert.match(w.body, /^## 값 대조$/m)
  assert.ok(!/규칙 길/.test(w.body), '규칙 길이 아니다')
  assert.match(section('apv', '배포절차', '카나리'), /20%.*999초/s)
  const sl = savelogOf('apv').pop()
  assert.ok(sl.warned.includes('invented'), JSON.stringify(sl.warned))
  assert.equal(sl.rule, undefined)
}))

test('Claude 끔 = 규칙 길(원문 인용 · 기록 + 항목 한 커밋 · 원본 첨부)', async () => {
  await pc.hub.setAuto(ME, 'claude', false)
  try {
    const n0 = commits('apv')
    const file = docx([['Heading1', '점검 결과'], ['', '펌프 3대 정상. 다음 점검은 11월.']])
    const r = await pc.hub.importFiles(ME, 'apv', [{ path: '점검 결과.docx', data: file }])
    assert.equal(r.rows[0].kind, 'rule', JSON.stringify(r.rows[0]))
    assert.match(r.rows[0].msg, /Claude 로 들이기를 껐다/)
    assert.equal(commits('apv'), n0 + 1)
    const w = (await fresh('apv')).byWork.get(r.rows[0].rec)
    assert.equal(w.state, 'in')
    assert.match(w.title, /규칙 길로 들임/)
    assert.match(w.body, /규칙 길 까닭: Claude 로 들이기를 껐다/)
    const files = headFiles('apv')
    assert.ok(files.includes(`work/${w.id}.md`) && files.includes('docs/assets/점검 결과.docx') && files.some((x) => x.startsWith('docs/들인 자료/')), files.join(' · '))
    assert.ok(savelogOf('apv').pop().rule)
  } finally {
    await pc.hub.setAuto(ME, 'claude', true)
  }
})

test('한 번 넣기 상한(INGEST_CLAUDE_MAX) = 규칙 길', async () => {
  const r = await pc.hub.importFiles(ME, 'apv', [{ path: '상한 넘음.md', data: Buffer.from('# 상한 넘음\n\n## 메모\n스무 번째 넘는 파일.\n') }], { offset: 20 })
  assert.equal(r.rows[0].kind, 'rule', JSON.stringify(r.rows[0]))
  assert.match(r.rows[0].msg, /Claude 로 들이는 수\(20\)를 넘었다/)
  assert.equal((await fresh('apv')).byWork.get(r.rows[0].rec).state, 'in')
})

test('코드 바뀜도 같은 규칙: 초안이면 기능 항목 + 기록 한 커밋 · Claude 끔이면 이은 항목에 잇기만(규칙 길)', async () => {
  const r0 = await pc.hub.sourceAdd(ME, 'apv', { name: 'api 코드', kind: 'git', at: repo, every: 'manual' })
  assert.equal(r0.run[0].codeRecords, 0)
  fs.writeFileSync(path.join(repo, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 5초\nclass HealthCheck {\n  int timeoutSec = 5;\n}\n')
  G(repo, 'commit', '-q', '-am', '헬스 체크 시간 초과를 늘림')
  const n0 = commits('apv')
  const r1 = (await pc.hub.sourceRun('apv', 'api 코드'))[0]
  assert.equal(r1.put, 1, JSON.stringify(r1).slice(0, 400))
  assert.equal(commits('apv'), n0 + 1, '기록 + 항목 한 커밋')
  assert.match(section('apv', '배포절차', '헬스 체크'), /시간 초과는 5초/)
  let k = await fresh('apv')
  const w = k.works.find((x) => x.tags.includes('code-change'))
  assert.equal(w.state, 'in')
  assert.ok(w.tags.includes('intake'))
  assert.ok(headFiles('apv').includes(`work/${w.id}.md`))
  assert.ok(!k.works.some((x) => x.state === 'pend'))
  // Claude 끔 — 코드 차이는 항목 글이 아니다: 이은 항목(건드린 항목) · 기록 모음 달 항목에 잇기만
  await pc.hub.setAuto(ME, 'claude', false)
  try {
    fs.writeFileSync(path.join(repo, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 7초\nclass HealthCheck {\n  int timeoutSec = 7;\n}\n')
    G(repo, 'commit', '-q', '-am', '헬스 체크 시간 초과를 더 늘림')
    const before = fs.readFileSync(path.join(pdir('apv'), 'docs', '배포절차.md'), 'utf8')
    const r2 = (await pc.hub.sourceRun('apv', 'api 코드'))[0]
    assert.equal(r2.rule, 1, JSON.stringify(r2).slice(0, 400))
    k = await fresh('apv')
    const w2 = k.works.filter((x) => x.tags.includes('code-change')).find((x) => x.id !== w.id)
    assert.equal(w2.state, 'in')
    assert.match(w2.body, /규칙 길 까닭/)
    assert.equal(fs.readFileSync(path.join(pdir('apv'), 'docs', '배포절차.md'), 'utf8').split('<!-- kmd:참고')[0].replace(/<!--[^>]*-->\n?/g, ''), before.split('<!-- kmd:참고')[0].replace(/<!--[^>]*-->\n?/g, ''), '항목 글은 그대로(잇기만)')
  } finally {
    await pc.hub.setAuto(ME, 'claude', true)
  }
  assert.ok(!curates.includes('apv'))
  await pc.hub.sourceRemove(ME, 'apv', { name: 'api 코드' })
})

test('들인 기록은 저장 문 밖에서 고쳐 쓰지 않는다([기록 정리] 막음) · 반영 검사는 서버가 단 원천 칸만 뺀다', async () => {
  const w = (await fresh('apv')).works.find((x) => x.tags.includes('ingest/운영/백업 바꿈.docx'))
  await assert.rejects(pc.hub.readRecord(ME, 'apv', w.id), (e) => e.code === 'E_FORBIDDEN')
  const items = [{ doc: 'docs/a.md', heading: '가', text: '아무 값 없음' }]
  assert.equal(judgeReflect({ body: '들였다.\n\n## 원천\n- 파일 a.md · 지문 0123456789abcdef\n\n> 시간 초과는 5초' }, items).errors.length, 0)
  assert.equal(judgeReflect({ body: '들였다.\n\n## 원천\n시간 초과는 5초' }, items).errors.length, 1, '사람 글의 「## 원천」 머리는 빼지 않는다')
})
