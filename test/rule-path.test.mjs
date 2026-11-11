// 저장 승인 P6 — approve 모드 지식의 무인 채널(저장 승인 설계 5절 · P-D2 · P-D14 · P-D15 · P-D33 · P-D35 · P-D38 · 6-7 b5 ~ b11 · b18)
//
// 규칙 길 꼴(ruleSections · ruleText · ruleRecord) · E_FORMAT 을 지난다 · 「들인 자료」 고정 갈래 · 원본 첨부 ·
// 값 경고는 다시 짓기를 부르지 않고 들어감 + `## 값 대조` · FIX(errors 만) → 규칙 길 · 일꾼 실패 · 하루 상한 → 규칙 길 ·
// 지문 어긋남 → 다시 대기 → 새 재료로 다시 짓기 → 규칙 길 · 일을 건 사람이 자리를 잃음 → 아무것도 쓰지 않음 · 정정 nosec → 이은 항목 ·
// held 모드(dpms)는 그대로 · 넣지 못함 · held/ 원천이 생기지 않는다

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { workOnce } from '../core/worker.js'
import { copyDir, seat, signIn } from './helpers.mjs'
import { ruleSections, ruleText } from '../core/pcplace.js'
import { ruleRecord } from '../core/ingest.js'
import { formatCheck } from '../core/docformat.js'
import { guardNewDoc, INTAKE_FORM } from '../core/guard.js'
import { parseValues } from '../core/parts.js'
import { sha16 } from '../core/text.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, wk
const KN = 'apv'
const kdir = () => path.join(tmp, 'kn', KN)
const W = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }
const fresh = async () => { s.hub.forget?.(KN); return s.hub.get(KN) }
const work = () => workOnce({ server: s.url, key: wk })
const env = (k, v, f) => async () => { const old = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; try { return await f() } finally { if (old == null) delete process.env[k]; else process.env[k] = old } }
const raw = async (key, p, body) => {
  const r = await fetch(`${s.url}/api/k/${KN}/worker/intake${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, j: await r.json() }
}
const savelog = () => fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'savelog', `${KN}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const noHeld = (k) => assert.ok(!k.works.some((w) => w.tags.includes('held')), '넣지 못함이 없다')
const calls = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => l === 'intake').length : 0)

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-rule-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), kdir())
  fs.rmSync(path.join(kdir(), 'work'), { recursive: true, force: true })
  W(path.join(kdir(), 'README.md'), '# 승인 지식\n')
  W(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sourceTickMs: 3600000, inboxTickMs: 3600000, jobTickMs: 3600000, watchQuietMs: 600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  wk = (await s.auth.workerAdd()).key
  await s.hub.ensureRecordsDoc(KN)
  await signIn(s, { id: 'lee', admin: false })
  await seat(s, 'lee', { [KN]: 'write' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('규칙 길 꼴: 갈래 문서의 새 항목 · 맞는 갈래가 없으면 「들인 자료」 주제 문서 · 글은 E_FORMAT 을 지난다 · 기록은 원천 인용', async () => {
  const k = await fresh()
  const meet = ruleSections(k, { file: '운영/2026-10-21_회의록.md', title: '회의록', body: '# 회의\n\n## 정한 것\n배포는 화 — 목.\n<!-- 메모 -->\n# 다른 큰 머리\n', date: '2026-10-22' }, { home: INTAKE_FORM })
  assert.equal(meet.kind, '회의록')
  assert.equal(meet.sections.length, 1)
  assert.equal(meet.sections[0].heading, '2026-10-21 회의록')
  assert.match(meet.sections[0].content, /\*\*정한 것\*\*/)
  assert.match(meet.sections[0].content, /\*\*다른 큰 머리\*\*/)
  assert.ok(!/<!--| — /.test(meet.sections[0].content))
  const topic = ruleSections(k, { file: '자료/야간점검 v2.txt', body: '앞글\n## 순서\n밤 11시.\n## 순서\n둘째.\n[기록](../../work/x.md)\n' }, { home: INTAKE_FORM })
  assert.equal(topic.doc, `${INTAKE_FORM}/야간점검`)
  assert.deepEqual(topic.sections.map((x) => x.heading), ['개요', '순서', '순서 (2)'])
  for (const x of [...meet.sections, ...topic.sections]) assert.deepEqual(formatCheck(x.content, { doc: x.doc }).problems, [], x.content)
  assert.match(topic.sections[2].content, /^`{3,}text\n/, '그래도 걸리는 줄은 울타리 안 원문으로')
  assert.deepEqual(guardNewDoc({ rows: [], own: true }, `${INTAKE_FORM}/야간점검`, ['개요'], { intake: true }).errors, [], '들인 자료는 무인 채널의 고정 갈래(장부 밖이어도 선다)')
  assert.ok(guardNewDoc({ rows: [], own: true }, `${INTAKE_FORM}/야간점검`, ['개요']).errors.length, '사람 채널은 갈래 장부 그대로')
  assert.equal(ruleText('```\n열림'), '```\n열림\n```')
  const rec = ruleRecord({ type: 'file', rel: '자료/야간점검 v2.txt', sha: 'a'.repeat(16), title: '야간점검 v2.txt' }, '앞글\n## 넣은 것\n', { why: '검사', line: topic.line })
  assert.match(rec.title, /규칙 길로 들임$/)
  assert.match(rec.body, /> ## 넣은 것/, '원천은 인용(kmd 칸으로 읽히지 않게)')
  assert.ok(!/^## 바뀐 것/m.test(rec.body))
})

test('값 경고는 다시 짓기를 부르지 않는다: 첫 초안 그대로 들어감 + `## 값 대조` · savelog warned · 넣지 못함 없음', env('FAKE_CLAUDE_MODE', 'bad', async () => {
  const log = path.join(tmp, 'calls-warn.log')
  process.env.FAKE_CLAUDE_LOG = log
  try {
    const o = await s.hub.openJob(KN, { type: 'file', by: 'kmd', auto: true, src: { rel: '운영문서/야간점검.md', sha: 'a'.repeat(16), title: '야간점검.md' }, md: '# 야간점검\n\n## 점검 순서\n밤 11시에 디스크를 본다.\n' })
    assert.equal(o.state, 'queued')
    const a = await work()
    assert.equal(calls(log), 1, 'Claude 한 번(값 경고는 FIX 방아쇠가 아니다)')
    assert.equal(a.summary.put >= 1, true, JSON.stringify(a))
    const j = s.hub.job(o.job)
    assert.equal(j.state, 'done')
    assert.ok(!j.result.rule, '규칙 길이 아니다')
    const k = await fresh()
    const w = k.byWork.get(j.result.rec)
    assert.equal(w.state, 'in')
    assert.ok(w.tags.includes('put') && !w.tags.includes('held'))
    const vs = parseValues(w.body)
    assert.ok(vs.some((x) => x.code === 'invented' && /999/.test(x.why)), w.body)
    assert.match(fs.readFileSync(path.join(kdir(), 'docs', '야간점검.md'), 'utf8'), /999초/, '값 경고가 있어도 들어간다(측정만)')
    const sl = savelog().filter((x) => x.rec === w.id).pop()
    assert.equal(sl.mode, 'approve')
    assert.ok(sl.warned.includes('invented'))
    noHeld(k)
    assert.ok(!fs.existsSync(path.join(tmp, 'kn', '.kmd', 'held', KN)), 'held/ 원천을 두지 않는다')
  } finally { delete process.env.FAKE_CLAUDE_LOG }
}))

test('FIX 가 끝내 못 넘으면 규칙 길: 「들인 자료」 주제 문서 · 원본 첨부 · 기록 + 문서 한 커밋 · 진행 결과 rule', env('FAKE_CLAUDE_MODE', 'outside', async () => {
  const log = path.join(tmp, 'calls-rule.log')
  process.env.FAKE_CLAUDE_LOG = log
  try {
    const bin = Buffer.from('# 창고 점검\n앞글.\n\n## 점검표\n# 큰 머리\n문은 22시에 잠근다.\n<!-- 손 메모 -->\n', 'utf8')
    const o = await s.hub.openJob(KN, { type: 'file', by: 'kmd', auto: true, src: { rel: '자료/창고 점검.txt', sha: 'b'.repeat(16), title: '창고 점검.txt' }, md: bin.toString('utf8'), bin })
    await work()
    assert.equal(calls(log), 3, '처음 + 고쳐 쓰기 두 번')
    const j = s.hub.job(o.job)
    assert.equal(j.state, 'done')
    assert.match(j.result.rule || '', /3번 지어도 검사를 넘지 못했다/)
    const k = await fresh()
    const w = k.byWork.get(j.result.rec)
    assert.equal(w.state, 'in')
    assert.match(w.title, /규칙 길로 들임$/)
    assert.match(w.body, /규칙 길 까닭: 3번 지어도/)
    const doc = fs.readFileSync(path.join(kdir(), 'docs', INTAKE_FORM, '창고 점검.md'), 'utf8')
    assert.match(doc, /## 점검표/)
    assert.match(doc, /\*\*큰 머리\*\*/)
    assert.match(doc, /문은 22시에 잠근다/)
    assert.ok(!/손 메모/.test(doc))
    assert.ok(fs.existsSync(path.join(kdir(), 'docs', 'assets', '자료', '창고 점검.txt')), '원본 첨부')
    const sl = savelog().filter((x) => x.rec === w.id).pop()
    assert.match(sl.rule, /3번 지어도/)
    assert.equal(sl.fix, 3)
    // 진행 탭 — 들어간 곳 · 규칙 길
    const q = await s.hub.queueList({ user: 'boss', admin: true })
    const it = q.items.find((x) => x.id === 't:' + o.job)
    assert.ok(it.rule, JSON.stringify(it))
    assert.ok((it.docs || []).some((d) => d.startsWith(INTAKE_FORM)), JSON.stringify(it))
    noHeld(k)
  } finally { delete process.env.FAKE_CLAUDE_LOG }
}))

test('커밋 규칙 길(일꾼 실패): 코드 차이는 항목 글이 아니다 · 건드린 이름 항목에 글 그대로 잇는다 · 기록 모음 달 항목', async () => {
  const o = await s.hub.openJob(KN, { type: 'commit', by: 'kmd', auto: true, src: { src: 'api 코드', commit: 'r001', title: '헬스 체크: api 코드 r001', touches: ['proc:헬스 체크'] }, md: '바뀐 값: 3초 → 5초' })
  const r = await s.hub.intakeGiveUp(s.hub.job(o.job), 'claude', '팀 일꾼이 초안을 받지 못했다: budget')
  assert.equal(r.state, 'rule', JSON.stringify(r))
  const k = await fresh()
  const w = k.byWork.get(r.rec)
  assert.equal(w.state, 'in')
  assert.ok(w.body.includes('## 이은 항목\n- docs/배포절차.md › 헬스 체크'), w.body)
  assert.match(fs.readFileSync(path.join(kdir(), 'docs', '배포절차.md'), 'utf8'), /시간 초과는 3초/, '항목 글은 그대로')
  const o2 = await s.hub.openJob(KN, { type: 'commit', by: 'kmd', auto: true, src: { src: 'api 코드', commit: 'r002', title: '빌드 정리: api 코드 r002', touches: ['proc:없는 이름'] }, md: '빌드 스크립트 정리' })
  const r2 = await s.hub.intakeGiveUp(s.hub.job(o2.job), 'worker', '팀 일꾼이 24시간 넘게 일감을 받지 않았다')
  assert.equal(r2.state, 'rule')
  const w2 = (await fresh()).byWork.get(r2.rec)
  assert.match(w2.body, /## (이은 항목|넣은 것)\n- docs\/기록 모음\.md › \d{4}-\d{2}/, '이을 이름이 없으면 기록 모음 달 항목')
  assert.match(w2.body, /기록 모음 달 항목에 잇는다/)
  noHeld(await fresh())
})

test('하루 상한 · Claude 에 보내지 않는 지식 → 일감 없이 곧바로 규칙 길(사람이 건 것도)', async () => {
  const old = s.hub.config.intakeDaily
  s.hub.config.intakeDaily = 0
  try {
    const r = await s.hub.openJob(KN, { type: 'file', by: 'lee', src: { rel: '자료/상한 메모.md', sha: 'c'.repeat(16), title: '상한 메모.md' }, md: '## 메모\n상한을 넘은 날의 글.\n' })
    assert.equal(r.state, 'rule', JSON.stringify(r))
    assert.match(r.why, /오늘 들이기 수/)
    const w = (await fresh()).byWork.get(r.rec)
    assert.equal(w.author, 'lee')
    assert.equal(w.state, 'in')
    assert.ok(fs.existsSync(path.join(kdir(), 'docs', INTAKE_FORM, '상한 메모.md')))
  } finally { s.hub.config.intakeDaily = old }
})

test('일꾼 실패(예산 · 시간)는 다시 짓지 않고 곧바로 규칙 길 · 다듬기는 하루 상한에서 E_RATE(규칙 길 아님)', async () => {
  const o = await s.hub.openJob(KN, { type: 'file', by: 'kmd', auto: true, src: { rel: '자료/예산 넘음.md', sha: '1'.repeat(16), title: '예산 넘음.md' }, md: '## 무엇\n예산을 넘은 글.\n' })
  const n = s.hub.workerNext(s.auth.bearer(wk))
  assert.equal(n.job.id, o.job)
  assert.equal((await raw(n.key, '')).status, 200)
  const f = (await raw(n.key, '/fail', { code: 'budget', why: '예산을 넘었다' })).j
  assert.match(f.rule || '', /예산을 넘었다/, JSON.stringify(f))
  assert.ok(!f.retry)
  assert.equal(s.hub.job(o.job).state, 'done')
  const old = s.hub.config.intakeDaily
  s.hub.config.intakeDaily = 0
  try {
    await assert.rejects(s.hub.polish({ user: 'boss', admin: true }, KN, { doc: 'docs/배포절차.md' }), (e) => e.code === 'E_RATE')
  } finally { s.hub.config.intakeDaily = old }
})

test('지문 어긋남: 같은 조각을 새 글에 다시 대고 · 안 되면 다시 대기(새 재료로 한 번 더) · 또 어긋나면 규칙 길', async () => {
  const o = await s.hub.openJob(KN, { type: 'commit', by: 'kmd', auto: true, src: { src: 'api 코드', commit: 's001', title: '카나리 비율: api 코드 s001', touches: ['proc:카나리'] }, md: '바뀐 값: 10% → 15%' })
  const file = path.join(kdir(), 'docs', '배포절차.md')
  let last = null
  const turn = async (find) => {
    const n = s.hub.workerNext(s.auth.bearer(wk))
    assert.equal(n.job.id, o.job)
    const g = (await raw(n.key, '')).j
    const c = g.docs.find((d) => d.doc === 'docs/배포절차.md').sections.find((x) => x.h === '카나리')
    // 재료 뒤 누가 그 항목의 찾을 글을 바꾼다(조각을 새 글에 댈 수 없다)
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(find, find === '요청의 10% 만' ? '요청의 일부(10%) 만' : '요청의 일부(10% 정도) 만'))
    s.hub.forget?.(KN)
    last = n.key
    return (await raw(n.key, '/done', { draft: { record: { title: '카나리 비율: 10% → 15%', body: '비율을 올렸다.', changes: ['카나리: 10% → 15%'] }, updates: [{ doc: 'docs/배포절차.md', heading: '카나리', base: c.base, edits: [{ find, replace: find.replace('10%', '15%') }] }] } })).j
  }
  const a = await turn('요청의 10% 만')
  assert.equal(a.requeued, true, JSON.stringify(a))
  const j = s.hub.job(o.job)
  assert.equal(j.state, 'queued')
  assert.equal(j.requeues, 1)
  assert.equal((await raw(last, '')).status, 401, '다시 대기하면 옛 임대의 일감 열쇠는 끊긴다')
  const b = await turn('요청의 일부(10%) 만')
  assert.match(b.rule || '', /그사이 항목이 또 바뀌었다/, JSON.stringify(b))
  const w = (await fresh()).byWork.get(b.rec)
  assert.equal(w.state, 'in')
  assert.match(w.body, /## 이은 항목\n- docs\/배포절차\.md › 카나리/)
  assert.equal(savelog().filter((x) => x.rec === w.id).pop().conflict, 1)
})

test('일을 건 사람이 자리를 잃으면 아무것도 쓰지 않는다: 진행 탭에 원천 이름과 까닭', async () => {
  const before = (await fresh()).works.length
  const o = await s.hub.openJob(KN, { type: 'file', by: 'lee', src: { rel: '자료/떠난 사람.md', sha: 'd'.repeat(16), title: '떠난 사람.md' }, md: '## 무엇\n글.\n' })
  assert.equal(o.state, 'queued')
  await seat(s, 'lee', { [KN]: 'read' })
  try {
    const n = s.hub.workerNext(s.auth.bearer(wk))
    assert.equal(n.job.id, o.job)
    const g = await raw(n.key, '')
    assert.equal(g.status, 403, '들이기를 시작하기 전에 자리를 다시 본다')
    const j = s.hub.job(o.job)
    assert.equal(j.state, 'done')
    assert.equal(j.result.aborted, true)
    assert.equal((await fresh()).works.length, before, '아무것도 쓰지 않았다')
    const it = (await s.hub.queueList({ user: 'boss', admin: true })).items.find((x) => x.id === 't:' + o.job)
    assert.equal(it.state, 'fail')
    assert.match(it.title, /떠난 사람\.md/)
    assert.match(it.msg, /쓰기 자리를 잃었다/)
  } finally { await seat(s, 'lee', { [KN]: 'write' }) }
})

test('정정 nosec(P-D33): 들어간 항목이 없으면 원 기록의 이름 항목에 잇는다(넣지 못함 없음 · P11)', async () => {
  const k = await fresh()
  const base = k.works.find((w) => w.tags.includes('intake') && w.touches.includes('proc:헬스 체크'))
  assert.ok(base, '앞 시험의 커밋 기록')
  const r = await s.hub.fixRecord({ user: 'boss', admin: true }, KN, base.id, { body: '시간 초과는 5초로 바로잡는다.', from: '3초', to: '5초' })
  assert.equal(r.held, 0, JSON.stringify(r))
  const w = (await fresh()).byWork.get(r.id)
  assert.ok(w && w.state === 'in', JSON.stringify(w?.tags))
  noHeld(await fresh())
  void sha16
})
