// 개인 기초 세우기(TODO 9 · Z7 · 바탕 설계 5-3 · 메뉴개편 8-1 · 통합 I1) — 원본 조사 → 거르기 → 구조안(Claude 안 · 폴더 그대로) → 짓기(가짜 Claude) →
//   연습 판 끝 진단 → 넣기(빈 approve 개인 지식 · 짜임 걸음) · 이어 하기(다시 켠 hub) · 빈 지식이 아니면 거절 · kmd-seed 꾸러미 경로
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeHub } from '../server/hub.js'
import { parseDoc } from '../core/sections.js'
import { survey } from '../core/survey.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = {
  '입사 안내.md': '# 입사 안내\n\n## 첫날\n09:00 까지 3층 접수에 온다.\n\n## 준비물\n신분증과 통장 사본.\n',
  '장비/장비 지급.md': '# 장비 지급\n\n## 노트북\nThinkPad X1 을 지급한다. 반납 기한은 퇴사일 7일 전.\n',
  '반납 절차 v1.md': '# 반납 절차\n\n## 반납\n총무팀에 낸다.\n',
  '반납 절차 v2.md': '# 반납 절차\n\n## 반납\n총무팀 김 대리에게 낸다. 내선 1234.\n',
  '접속정보.md': '# 접속정보\n\n비밀번호: hunter2abc\n',
}
async function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-seed-'))
  const src = path.join(tmp, 'src')
  for (const [rel, text] of Object.entries(SRC)) {
    fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true })
    fs.writeFileSync(path.join(src, rel), text)
  }
  const root = path.join(tmp, 'kn')
  fs.mkdirSync(root, { recursive: true })
  const dataDir = path.join(tmp, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  delete process.env.FAKE_CLAUDE_MODE
  const hub = await makeHub({ root, dataDir, mode: 'pc', pcUser: 'me', log: () => {} })
  const ctx = { user: 'me', pc: true }
  const make = async (name) => (await hub.addKnowledge(ctx, { kind: 'new', name, empty: true, backup: false })).id
  return { tmp, src, root, dataDir, hub, ctx, make, done: () => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) }
}
// 도는 일(조사 · 구조안 · 짓기)이 끝날 때까지
async function settle(hub, ctx, id) {
  for (let i = 0; i < 300; i++) {
    const v = await hub.seedView(ctx, id)
    if (!v.run || v.run.state !== 'running') return v
    await new Promise((ok) => setTimeout(ok, 100))
  }
  throw new Error('도는 일이 끝나지 않았다')
}
const code = (p) => p.then(() => 'ok', (e) => e.code)
const LONG = { timeout: 180000 }

test('Claude 안 세션 — 답하지 않는 세션은 그만두기로 끊는다(동작 내역에 그만뒀다)', LONG, async () => {
  const s = await setup()
  try {
    const id = await s.make('세션 끊기')
    await s.hub.seedSurvey(s.ctx, id, { dir: s.src })
    await settle(s.hub, s.ctx, id)
    process.env.FAKE_CLAUDE_MODE = 'hang'
    await s.hub.seedPlan(s.ctx, id, { mode: 'claude' })
    let fd
    for (let i = 0; i < 100; i++) {
      fd = await s.hub.seedFeed(s.ctx, id)
      if (fd.rows.some((r) => r.k === 'start')) break
      await new Promise((ok) => setTimeout(ok, 100))
    }
    assert.equal(fd.running, true)
    assert.ok(fd.rows.some((r) => r.k === 'start'), JSON.stringify(fd.rows))
    await s.hub.seedWrite(s.ctx, id, { stop: true })
    const v = await settle(s.hub, s.ctx, id)
    delete process.env.FAKE_CLAUDE_MODE
    assert.equal(v.run.state, 'cancelled')
    for (let i = 0; i < 100; i++) {
      fd = await s.hub.seedFeed(s.ctx, id)
      if (fd.rows.some((r) => r.k === 'kmd' && r.text === '그만뒀다')) break
      await new Promise((ok) => setTimeout(ok, 100))
    }
    assert.ok(fd.rows.some((r) => r.k === 'kmd' && r.text === '그만뒀다'), JSON.stringify(fd.rows.slice(-3)))
    // 다시 걸 수 있다(세션이 닫혔다)
    await s.hub.seedPlan(s.ctx, id, { mode: 'claude' })
    assert.equal((await settle(s.hub, s.ctx, id)).run.state, 'done')
  } finally {
    delete process.env.FAKE_CLAUDE_MODE
    s.done()
  }
})

test('Claude 안 — 조사(옛 판 · 비밀 의심 보류) → 거르기 → 구조안 → 짓기 · 승인 → 연습 판 → 넣기(빈 approve 지식에 문서 · 이름 · 기록)', LONG, async () => {
  const s = await setup()
  try {
    const id = await s.make('온보딩')
    assert.equal(s.hub.saveModeOf(id), 'approve', '새 개인 지식은 approve')
    assert.equal(await code(s.hub.seedSurvey(s.ctx, id, { dir: 'src' })), 'E_INPUT', '전체 경로만')
    const st = await s.hub.seedSurvey(s.ctx, id, { dir: s.src })
    assert.equal(st.started, true)
    let v = await settle(s.hub, s.ctx, id)
    assert.equal(v.run.state, 'done', JSON.stringify(v.run))
    assert.equal(v.work.ui, 2)
    const row = (p) => v.work.rows.find((r) => r.path === p)
    assert.equal(row('반납 절차 v1.md').role, '옛 판')
    assert.equal(row('반납 절차 v1.md').pick, '빼기')
    assert.equal(row('접속정보.md').role, '비밀 의심')
    assert.equal(row('접속정보.md').pick, '보류')
    assert.ok(row('접속정보.md').secret.length, '비밀 의심 까닭(값은 싣지 않는다)')
    assert.ok(!JSON.stringify(v).includes('hunter2abc'), '비밀 값은 응답에 없다')
    // 거르기 — 비밀 의심은 넣지 않는다 · 근거만은 된다
    assert.equal(await code(s.hub.seedPick(s.ctx, id, { picks: { '접속정보.md': '넣음' } })), 'E_INPUT')
    assert.equal(await code(s.hub.seedPick(s.ctx, id, { picks: { '없는.md': '넣음' } })), 'E_INPUT')
    v = await s.hub.seedPick(s.ctx, id, { picks: { '반납 절차 v1.md': '근거만' } })
    assert.equal(v.work.rows.find((r) => r.path === '반납 절차 v1.md').pick, '근거만')
    // 지식은 아직 그대로
    assert.ok(!fs.existsSync(path.join(s.root, id, 'docs', '업무 안내.md')))
    // 구조안 — Claude 안(덮임 걸림 → 고쳐 쓰기)
    process.env.FAKE_CLAUDE_MODE = 'badseed'
    await s.hub.seedPlan(s.ctx, id, { mode: 'claude' })
    v = await settle(s.hub, s.ctx, id)
    delete process.env.FAKE_CLAUDE_MODE
    assert.equal(v.run.state, 'done', JSON.stringify(v.run))
    assert.ok(v.run.tries >= 2, '덮임 걸림이면 고쳐 쓴다')
    assert.equal(v.work.check.ok, true, JSON.stringify(v.work.check))
    assert.deepEqual(v.work.plan.docs.map((d) => d.id), ['업무 안내'])
    assert.equal(v.work.mode, 'claude')
    assert.equal(v.work.top, 4)
    // 동작 내역(Z9) — 세션 하나에서 시작 · 보낸 말 · 생각 · 도구(원본 이름으로) · 검사 걸림 → 같은 세션에 고쳐 받기 · 나무에 놓음
    const fd = await s.hub.seedFeed(s.ctx, id)
    const ks = fd.rows.map((r) => r.k)
    assert.match(fd.sid, /^[0-9a-f]{8}$/)
    assert.equal(fd.title, '구조안')
    assert.equal(ks.filter((k) => k === 'start').length, 1, '세션은 하나: ' + ks.join(' '))
    assert.equal(ks.filter((k) => k === 'me').length, 2, '처음 말 + 고쳐 받기 말')
    assert.ok(fd.rows[0].k === 'kmd' && /세션 폴더/.test(fd.rows[0].text), JSON.stringify(fd.rows[0]))
    assert.ok(!/\[material /.test(fd.rows.find((r) => r.k === 'me').text), '재료 글 · 카드를 프롬프트에 싣지 않는다')
    const res = fd.rows.find((r) => r.k === 'toolres')
    assert.match(res.text, /「반납 절차 v2\.md」/, '세션 폴더 md/<16자>.md 는 원본 이름으로: ' + res.text)
    assert.ok(!res.text.includes(os.tmpdir()), '세션 폴더 경로를 싣지 않는다')
    assert.ok(fd.rows.some((r) => r.k === 'tool' && r.name === 'Grep'))
    assert.ok(fd.rows.some((r) => r.k === 'answer'))
    assert.ok(fd.rows.some((r) => r.k === 'kmd' && r.tone === 'warn' && /같은 세션/.test(r.text)))
    assert.ok(fd.rows.some((r) => r.k === 'kmd' && r.tone === 'ok' && /나무에 놓았다/.test(r.text)))
    assert.equal(fd.running, false)
    const fd2 = await s.hub.seedFeed(s.ctx, id, { after: fd.seq, sid: fd.sid })
    assert.equal(fd2.rows.length, 0, '이어 읽기는 새 줄만')
    assert.equal((await s.hub.seedFeed(s.ctx, id, { after: fd.seq, sid: 'ffffffff' })).rows.length, fd.rows.length, '다른 일이면 처음부터')
    assert.notEqual(await code(s.hub.seedFeed({ user: 'other' }, id)), 'ok', '일을 연 사람이 아니면 못 본다')
    // 짓기 — 처음 3 문서 승인 전에는 모두 짓기 안 됨 · 하나 짓고 승인
    assert.equal(await code(s.hub.seedWrite(s.ctx, id, { all: true })), 'E_INPUT')
    assert.equal(await code(s.hub.seedTry(s.ctx, id)), 'E_INPUT', '글이 없으면 해 보지 않는다')
    await s.hub.seedWrite(s.ctx, id, { doc: '업무 안내' })
    v = await settle(s.hub, s.ctx, id)
    const d0 = v.work.docs[0]
    assert.equal(d0.state, 'ok', JSON.stringify(d0))
    assert.ok(d0.chars > 0)
    assert.equal(await code(s.hub.seedTry(s.ctx, id)), 'E_INPUT', '처음 문서 승인 전')
    v = await s.hub.seedWrite(s.ctx, id, { approve: '업무 안내' })
    assert.equal(v.work.docs[0].ok, true)
    // 이름만 바꾼 문서는 지은 글 · 승인을 잇는다(구조안 names 도 따라간다)
    const ren = (from, to) => ({ docs: v.work.plan.docs.map((d) => ({ id: d.id === from ? to : d.id, items: d.items.map((it) => ({ h: it.h, src: it.src })) })), names: v.work.plan.names.map((n) => (n.doc === from ? { ...n, doc: to } : n)), skip: v.work.plan.skip })
    v = (await s.hub.seedPlan(s.ctx, id, { mode: 'hand', plan: ren('업무 안내', '안내') })).view
    assert.deepEqual(v.work.docs.map((d) => [d.id, d.state, d.ok]), [['안내', 'ok', true]])
    assert.equal(v.work.mode, 'claude', '손으로 고쳐도 Claude 안')
    v = (await s.hub.seedPlan(s.ctx, id, { mode: 'hand', plan: ren('안내', '업무 안내') })).view
    // 연습 판 → 끝 진단
    let t = await s.hub.seedTry(s.ctx, id)
    assert.equal(t.ok, true, JSON.stringify(t.diag))
    v = await s.hub.seedView(s.ctx, id)
    assert.equal(v.work.stage, 'tried')
    assert.equal(v.work.top, 6)
    assert.equal(await code(s.hub.shapeTry(s.ctx, id)), 'E_CONFLICT', '다시 잡기 길의 해 보기는 기초 세우기를 받지 않는다')
    // 해 본 뒤 글을 고치면 연습 판 결과를 걷는다(넣기는 다시 해 본 글만)
    const w0 = await s.hub.shapeWork(id)
    v = await s.hub.seedWrite(s.ctx, id, { doc: '업무 안내', items: w0.seed.texts['업무 안내'].items })
    assert.equal(v.work.stage, 'plan')
    assert.equal(v.work.tried, null)
    assert.equal(await code(s.hub.shapePut(s.ctx, id)), 'E_CONFLICT', '해 보기 전에는 넣지 않는다')
    await s.hub.seedWrite(s.ctx, id, { approve: '업무 안내' })
    t = await s.hub.seedTry(s.ctx, id)
    assert.equal(t.ok, true, JSON.stringify(t.diag))
    assert.ok(!fs.existsSync(path.join(s.root, id, 'docs', '업무 안내.md')), '연습 판은 진짜를 건드리지 않는다')
    // 넣기 — 짜임 걸음 그대로(approve 지식 strict)
    const p = await s.hub.shapePut(s.ctx, id)
    assert.equal(p.done, true, JSON.stringify(p))
    const text = fs.readFileSync(path.join(s.root, id, 'docs', '업무 안내.md'), 'utf8')
    const pd = parseDoc(text, '')
    assert.deepEqual(pd.sections.map((x) => x.h), ['반납 절차 v2', '입사 안내', '장비 지급'], '넣음 재료마다 항목(구조안 차례)')
    assert.match(text, /09:00/)
    assert.match(text, /내선 1234/)
    assert.ok(!text.includes('hunter2abc'))
    assert.match(fs.readFileSync(path.join(s.root, id, '_vocab.md'), 'utf8'), /topic:반납절차v2/, '구조안 이름이 이름 장부에')
    assert.match(fs.readFileSync(path.join(s.root, id, '_managed.md'), 'utf8'), /topic:반납절차v2.*업무 안내\.md.*## 반납 절차 v2/)
    const recs = fs.readdirSync(path.join(s.root, id, 'work')).map((f) => fs.readFileSync(path.join(s.root, id, 'work', f), 'utf8')).join('\n')
    assert.match(recs, /기초 세우기로 세웠다/)
    assert.match(recs, /원본 입사 안내\.md/)
    v = await s.hub.seedView(s.ctx, id)
    assert.equal(v.own, 1)
    assert.equal(v.work.stage, 'done')
    assert.deepEqual(await s.hub.seedOpen(s.ctx), [], '다 넣은 일은 만들던 것이 아니다')
    // 이제 빈 지식이 아니다
    assert.equal(await code(s.hub.seedSurvey(s.ctx, id, { dir: s.src })), 'E_CONFLICT')
  } finally { s.done() }
})

test('폴더 그대로 — Claude 없이 파일마다 문서 · 머리마다 항목(재료 글 그대로) · 넣기', LONG, async () => {
  const s = await setup()
  try {
    process.env.KMD_CLAUDE = path.join(s.tmp, '없는-claude.mjs') // 부르면 넘어진다
    const id = await s.make('폴더')
    await s.hub.seedSurvey(s.ctx, id, { dir: s.src })
    await settle(s.hub, s.ctx, id)
    let v = (await s.hub.seedPlan(s.ctx, id, { mode: 'folder' })).view
    assert.equal(v.work.mode, 'folder')
    assert.equal(v.work.check.ok, true, JSON.stringify(v.work.check))
    assert.deepEqual(v.work.plan.docs.map((d) => d.id).sort(), ['반납 절차', '입사 안내', '장비/장비 지급'])
    assert.ok(v.work.docs.every((d) => d.state === 'ok' && d.by === 'folder'), JSON.stringify(v.work.docs))
    assert.ok(v.work.docs.every((d) => !d.values.length), '재료 글 그대로라 값 경고가 없다')
    // 손으로 — 문서 이름 바꾸기(같은 항목이면 지은 글을 이어받는다)
    const plan = { docs: v.work.plan.docs.map((d) => ({ id: d.id === '입사 안내' ? '첫 주 안내' : d.id, items: d.items.map((it) => ({ h: it.h === '준비물' ? '챙길 것' : it.h, src: it.src })) })), names: [], skip: v.work.plan.skip }
    assert.equal((await s.hub.seedPlan(s.ctx, id, { mode: 'hand', plan })).ok, true)
    v = await s.hub.seedView(s.ctx, id)
    assert.ok(v.work.plan.docs.some((d) => d.id === '첫 주 안내'))
    assert.equal(v.work.docs.find((d) => d.id === '장비/장비 지급').state, 'ok', '항목이 그대로인 문서는 지은 글을 잇는다')
    assert.equal(v.work.docs.find((d) => d.id === '첫 주 안내').state, 'wait', '항목 머리가 바뀐 문서는 글을 다시 짓는다')
    // 손으로 쓰기 — 머리 줄이 든 글은 걸린다(꼴) · 맞는 글은 지음
    const it = v.work.plan.docs.find((d) => d.id === '첫 주 안내').items
    const bad = await s.hub.seedWrite(s.ctx, id, { doc: '첫 주 안내', items: it.map((x) => ({ h: x.h, content: '## 머리\n글' })) })
    assert.equal(bad.work.docs.find((d) => d.id === '첫 주 안내').state, 'fail')
    v = await s.hub.seedWrite(s.ctx, id, { doc: '첫 주 안내', items: it.map((x) => ({ h: x.h, content: x.h === '첫날' ? '09:00 까지 3층 접수에 온다.' : '신분증과 통장 사본.' })) })
    assert.equal(v.work.docs.find((d) => d.id === '첫 주 안내').state, 'ok')
    // 다른 문서는 폴더 그대로 글을 이어받았다
    assert.equal(v.work.docs.find((d) => d.id === '반납 절차').state, 'ok')
    const t = await s.hub.seedTry(s.ctx, id)
    assert.equal(t.ok, true, JSON.stringify(t.diag))
    const p = await s.hub.shapePut(s.ctx, id)
    assert.equal(p.done, true, JSON.stringify(p))
    const pd = parseDoc(fs.readFileSync(path.join(s.root, id, 'docs', '장비', '장비 지급.md'), 'utf8'), '')
    assert.deepEqual(pd.sections.map((x) => x.h), ['노트북'])
    assert.match(pd.sections[0].body, /ThinkPad X1/)
    assert.match(fs.readFileSync(path.join(s.root, id, 'docs', '반납 절차.md'), 'utf8'), /내선 1234/, '늦은 판(정본)')
  } finally { s.done() }
})

test('이어 하기 · 거절 — 다시 켠 hub 에서 만들던 것(구조안 · 단계) · 빈 지식이 아니면 409 · 남이 연 일 · 다시 잡기와 겹치지 않음 · 그만두기', LONG, async () => {
  const s = await setup()
  try {
    const id = await s.make('이어')
    await s.hub.seedSurvey(s.ctx, id, { dir: s.src })
    await settle(s.hub, s.ctx, id)
    await s.hub.seedPlan(s.ctx, id, { mode: 'folder' })
    await s.hub.seedStep(s.ctx, id, { ui: 6 })
    let v = await s.hub.seedView(s.ctx, id)
    assert.equal(v.work.ui, 4, '다다를 수 있는 단계까지만')
    // 다시 켬 — 장부가 남아 잇는다(도는 일은 메모리)
    const hub2 = await makeHub({ root: s.root, dataDir: s.dataDir, mode: 'pc', pcUser: 'me', log: () => {} })
    const open = await hub2.seedOpen(s.ctx)
    assert.deepEqual(open.map((x) => [x.kn, x.ui, x.mine]), [[id, 4, true]])
    v = await hub2.seedView(s.ctx, id)
    assert.equal(v.run, null)
    assert.equal(v.work.mode, 'folder')
    assert.ok(v.work.docs.length >= 3)
    // 다시 잡기 검사는 열린 기초 세우기를 덮지 않는다
    assert.equal(await code(hub2.shapeCheck(id, s.ctx, { plan: { v: 1, kind: 'reshape', docs: [] } })), 'E_CONFLICT')
    // 남은 연 사람만 잇는다
    assert.equal(await code(hub2.seedPick({ user: 'park' }, id, { picks: {} })), 'E_CONFLICT')
    // 빈 지식이 아니면 거절
    const full = await s.make('찬 지식')
    fs.writeFileSync(path.join(s.root, full, 'docs', '문서.md'), '# 문서\n\n## 하나\n글.\n')
    await hub2.sync?.(full).catch(() => {})
    const hub3 = await makeHub({ root: s.root, dataDir: s.dataDir, mode: 'pc', pcUser: 'me', log: () => {} })
    assert.equal(await code(hub3.seedSurvey(s.ctx, full, { dir: s.src })), 'E_CONFLICT')
    // 지식 폴더 · 살림 폴더는 재료가 아니다
    assert.equal(await code(hub3.seedSurvey(s.ctx, id, { dir: s.root })), 'E_INPUT')
    // 그만두기 — 장부 · 이 PC 꾸러미를 걷는다(지식은 그대로)
    await hub3.shapeStop(s.ctx, id)
    v = await hub3.seedView(s.ctx, id)
    assert.equal(v.work, null)
    assert.deepEqual((fs.existsSync(hub3.seedDir(id)) ? fs.readdirSync(hub3.seedDir(id)) : []).filter((x) => x.startsWith('pack')), [], '이 PC 꾸러미를 걷는다')
    assert.equal(v.own, 0)
  } finally { s.done() }
})

test('kmd-seed 꾸러미 경로 — 꾸러미를 열고(한도 없음 · 읽기만) plan.json 이 처음 구조안 · 꾸러미 글 초안은 지음으로', LONG, async () => {
  const s = await setup()
  try {
    const pack = path.join(s.tmp, 'pack')
    const r = await survey(s.src, { out: pack })
    const keep = r.rows.filter((x) => x.src && x.pick === '넣음')
    const plan = { v: 1, kind: 'seed', docs: [{ id: '안내', was: null, items: keep.map((x) => ({ h: x.topic, src: [x.src] })) }], names: [], skip: [] }
    fs.writeFileSync(path.join(pack, 'plan.json'), JSON.stringify(plan))
    fs.mkdirSync(path.join(pack, 'texts'))
    fs.writeFileSync(path.join(pack, 'texts', '안내.json'), JSON.stringify({ doc: '안내', items: keep.map((x) => ({ h: x.topic, text: `${x.topic} 글.` })) }))
    const before = fs.readFileSync(path.join(pack, 'manifest.json'), 'utf8')
    const id = await s.make('꾸러미')
    const st = await s.hub.seedSurvey(s.ctx, id, { dir: pack })
    assert.equal(st.packed, true)
    const v = await settle(s.hub, s.ctx, id)
    assert.equal(v.run.state, 'done', JSON.stringify(v.run))
    assert.equal(v.work.packed, true)
    assert.equal(v.work.check.ok, true, JSON.stringify(v.work.check))
    assert.deepEqual(v.work.plan.docs.map((d) => d.id), ['안내'])
    assert.equal(v.work.docs[0].state, 'ok')
    assert.equal(v.work.docs[0].by, 'pack')
    assert.equal(fs.readFileSync(path.join(pack, 'manifest.json'), 'utf8'), before, '꾸러미는 읽기만')
    // 꾸러미 재료 글을 손으로 고치면 그 재료는 쓰지 않는다(지문)
    const one = keep[0].src.slice(2)
    fs.writeFileSync(path.join(pack, 'md', `${one}.md`), '고친 글\n')
    const w = await s.hub.shapeWork(id)
    const m = await s.hub.seedMats(w)
    assert.equal(m.text(keep[0].src), null)
    // 그만두기는 사람이 준 꾸러미를 지우지 않는다
    await s.hub.shapeStop(s.ctx, id)
    assert.ok(fs.existsSync(path.join(pack, 'manifest.json')))
  } finally { s.done() }
})

// ── 팀 기초 세우기(TODO 10 · Z8 · 메뉴개편 8-2 · 통합 I1 · I2) — 브라우저 올리기 → 조사(묶음) → 팀 일꾼 shape-plan · shape-write(가짜 Claude) →
//   연습 판 → 넣기(빈 approve 팀 지식) · 폴더 그대로(I1 짜임 걸음) · 앞 묶음을 넣은 뒤 다음 묶음(I2) · 쓰기 403 · 문서 있는 지식 409 · 옛 일꾼
async function teamSetup() {
  const { startServer } = await import('../server/http.js')
  const { signIn, seat, copyDir } = await import('./helpers.mjs')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-tseed-'))
  const keep = { KMD_CLAUDE: process.env.KMD_CLAUDE, FAKE_CLAUDE_MODE: process.env.FAKE_CLAUDE_MODE, FAKE_CLAUDE_LOG: process.env.FAKE_CLAUDE_LOG, KMD_NO_CLAUDE: process.env.KMD_NO_CLAUDE }
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  process.env.FAKE_CLAUDE_LOG = path.join(tmp, 'calls.log')
  delete process.env.FAKE_CLAUDE_MODE
  delete process.env.KMD_NO_CLAUDE
  const root = path.join(tmp, 'kn')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  fs.mkdirSync(path.join(root, '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(root, '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sourceTickMs: 3600000, sendTickMs: 3600000, jobTickMs: 3600000, queueResumeMs: 3600000, inboxTickMs: 3600000 }))
  const s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  const P = {}
  P.boss = await signIn(s, { id: 'boss', admin: true })
  for (const id of ['ad', 'wr']) P[id] = await signIn(s, { id, admin: false })
  const make = async (name) => { const r = await s.hub.addKnowledge({ user: 'boss', admin: true }, { kind: 'new', name, empty: true }); await seat(s, 'ad', { [r.id]: 'admin' }); await seat(s, 'wr', { [r.id]: 'write' }); return r.id }
  const http = async (p, who, body) => {
    const r = await fetch(s.url + p, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${who.key}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, j: await r.json().catch(() => null) }
  }
  const files = (o) => Object.entries(o).map(([p, t]) => ({ path: p, b64: Buffer.from(t, 'utf8').toString('base64') }))
  const wk = (await s.auth.workerAdd()).key
  const { workOnce } = await import('../core/worker.js')
  const work = () => workOnce({ server: s.url, key: wk })
  const done = async () => {
    await s.close()
    for (const [k, v] of Object.entries(keep)) { if (v == null) delete process.env[k]; else process.env[k] = v }
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
  }
  return { s, tmp, root, P, make, http, files, work, done, AD: { user: 'ad' } }
}

test('팀 — 올리기 → 조사 → Claude 구조안 · 짓기(팀 일꾼 일감) → 연습 판 → 넣기 · 쓰기 403 · 문서 있는 지식 409 · 옛 일꾼 · 하루 수', LONG, async () => {
  const t = await teamSetup()
  try {
    const id = await t.make('테스트-팀기초')
    assert.equal(t.s.hub.saveModeOf(id), 'approve', '새 팀 지식은 approve')
    const U = `/api/k/${encodeURIComponent(id)}/seed`
    // 올리기 → 닫기 → 조사(묶음)
    const up = await t.http(`${U}/upload`, t.P.ad, { group: { total: 5, last: true }, files: t.files(SRC) })
    assert.equal(up.status, 200, JSON.stringify(up.j))
    assert.equal((await t.http('/api/shape/survey', t.P.wr, { kn: id, group: up.j.group })).status, 403, '쓰기 자리는 조사하지 못한다')
    assert.equal((await t.http('/api/shape/survey', t.P.ad, { kn: id, dir: 'C:/Windows' })).status, 400, '팀은 서버 경로를 받지 않는다')
    const sv = await t.http('/api/shape/survey', t.P.ad, { kn: id, group: up.j.group })
    assert.equal(sv.status, 200, JSON.stringify(sv.j))
    assert.equal((await t.http(U, t.P.wr)).status, 403, '쓰기 자리는 보지 못한다')
    let v = (await t.http(U, t.P.ad)).j
    assert.equal(v.work.ui, 2)
    assert.equal(v.work.group, up.j.group)
    const row = (p) => v.work.rows.find((r) => r.path === p)
    assert.equal(row('반납 절차 v1.md').role, '옛 판')
    assert.equal(row('접속정보.md').role, '비밀 의심')
    assert.ok(!JSON.stringify(v).includes('hunter2abc'), '비밀 값은 응답에 없다')
    assert.equal(v.team.cost.files, 3, '넣음 재료 수')
    assert.ok(v.team.cost.chars > 0)
    const left0 = v.team.day.left
    // 팀 일꾼 — 없음(열 분 안에 물은 일꾼 없음) · 옛 일꾼(shape-seed 모름)뿐이면 Claude 안을 세우지 않는다
    assert.equal(v.claude.none, true, '팀 일꾼 없음')
    t.s.hub.workerNext({ worker: { id: 'old' } }, { types: ['file', 'shape-plan', 'shape-write'] })
    assert.equal(t.s.hub.shapeClaudeState(id, { seed: true }).old, true)
    assert.equal(await code(t.s.hub.seedPlan(t.AD, id, { mode: 'claude' })), 'E_CONFLICT', '옛 일꾼뿐이면 E_CONFLICT')
    // 새 일꾼(shape-seed 를 안다)이 물으면 Claude 구조안 일감을 세운다 · 덮임 걸림이면 고쳐 쓴다
    assert.equal(await t.work(), null, '일감이 없다')
    process.env.FAKE_CLAUDE_MODE = 'badseed'
    const pl = await t.s.hub.seedPlan(t.AD, id, { mode: 'claude' })
    assert.equal(pl.started, true)
    v = await t.s.hub.seedView(t.AD, id)
    assert.equal(v.run.kind, 'plan')
    assert.equal(v.run.state, 'running')
    assert.equal(await code(t.s.hub.seedPlan(t.AD, id, { mode: 'folder' })), 'E_CONFLICT', '도는 동안 구조안을 바꾸지 않는다')
    assert.equal((await t.http(`${U}/upload`, t.P.ad, { group: { total: 1, last: true }, files: t.files({ 'x.md': '# x\n\n## 하나\n글\n' }) })).status, 409, '팀 일꾼이 짓는 중에는 새 묶음을 열지 않는다')
    assert.equal(t.s.hub.workerNext({ worker: { id: 'old' } }, { types: ['shape-plan', 'shape-write'] }), null, '옛 일꾼은 기초 세우기 일감을 받지 않는다')
    const w1 = await t.work()
    delete process.env.FAKE_CLAUDE_MODE
    assert.equal(w1.job.type, 'shape-plan')
    v = await t.s.hub.seedView(t.AD, id)
    assert.equal(v.run.state, 'done', JSON.stringify(v.run))
    assert.equal(v.work.mode, 'claude')
    assert.equal(v.work.check.ok, true, JSON.stringify(v.work.check))
    assert.deepEqual(v.work.plan.docs.map((d) => d.id), ['업무 안내'])
    assert.match(fs.readFileSync(path.join(t.tmp, 'calls.log'), 'utf8'), /seed-plan\n(call \S+\n)?seed-plan fix/,'덮임 걸림 → 고쳐 썼다')
    // 짓기 — 문서마다 일감 · 지은 글 · 승인
    await t.s.hub.seedWrite(t.AD, id, { doc: '업무 안내' })
    v = await t.s.hub.seedView(t.AD, id)
    assert.equal(v.run.kind, 'write')
    assert.equal(v.run.state, 'running')
    assert.equal(v.team.cost.docs, 1)
    assert.equal(await code(t.s.hub.seedTry(t.AD, id)), 'E_CONFLICT', '짓는 중에는 해 보지 않는다')
    const w2 = await t.work()
    assert.equal(w2.job.type, 'shape-write')
    v = await t.s.hub.seedView(t.AD, id)
    assert.equal(v.work.docs[0].state, 'ok', JSON.stringify(v.work.docs[0]))
    assert.equal(v.team.day.left, left0 - 2, '하루 들이기 수를 센다(구조안 1 · 문서 1)')
    await t.s.hub.seedWrite(t.AD, id, { approve: '업무 안내' })
    const tr = await t.s.hub.seedTry(t.AD, id)
    assert.equal(tr.ok, true, JSON.stringify(tr.diag))
    const p = await t.s.hub.shapePut(t.AD, id)
    assert.equal(p.done, true, JSON.stringify(p))
    const k = await t.s.hub.get(id, t.AD)
    const d = k.byDocPath.get('docs/업무 안내.md')
    assert.ok(d, '문서를 세웠다')
    assert.match(d.sections.map((x) => x.body).join('\n'), /내선 1234/)
    assert.ok(!JSON.stringify(d.sections).includes('hunter2abc'))
    // 문서 있는 지식 · 쓰기 자리
    const full = await t.http('/api/k/gdi/seed/upload', t.P.boss, { group: { total: 1, last: true }, files: t.files({ 'a.md': '# a\n\n## 개요\n글\n' }) })
    assert.equal(full.status, 409, '문서가 있는 지식')
    assert.equal((await t.http(`${U}/upload`, t.P.wr, { group: { total: 1, last: true }, files: t.files({ 'a.md': '# a\n' }) })).status, 403)
  } finally { await t.done() }
})

test('팀 — 폴더 그대로는 짜임 걸음(I1 · 채널 shape · 넣지 못함 없음) · 앞 묶음을 넣은 뒤 다음 묶음(I2) · 걸음 실패면 멈춤 → 글 고쳐 이어 넣기', LONG, async () => {
  const t = await teamSetup()
  try {
    const id = await t.make('테스트-팀폴더')
    const U = `/api/k/${encodeURIComponent(id)}/seed`
    const up = await t.http(`${U}/upload`, t.P.ad, { group: { total: 2, last: true }, files: t.files({ '운영/배포.md': '# 배포\n\n## 순서\n포트 8090 으로 띄운다.\n\n## 되돌리기\n앞 판으로 바꾼다.\n', '운영/점검.md': '# 점검\n\n## 디스크\n80% 넘으면 알린다.\n' }) })
    assert.equal(up.status, 200)
    await assert.rejects(t.s.hub.seedAsIs({ user: 'wr' }, id, { group: up.j.group }), { code: 'E_FORBIDDEN' })
    const out = await t.s.hub.seedAsIs(t.AD, id, { group: up.j.group })
    assert.equal(out.done, true, JSON.stringify(out))
    const k = await t.s.hub.get(id, t.AD)
    assert.deepEqual(k.byDocPath.get('docs/운영/배포.md').sections.map((x) => x.h), ['순서', '되돌리기'])
    const log = fs.readFileSync(path.join(t.root, '.kmd', 'savelog', `${encodeURIComponent(id)}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    assert.ok(log.every((l) => l.ch === 'shape'), '짜임 걸음(채널 shape) · 옛 채널 seed 를 쓰지 않는다')
    assert.ok(!log.some((l) => (l.held || 0) > 0), '넣지 못함 없음')
    // 다음 묶음(I2) — 앞 묶음이 세운 문서뿐이면 받는다 · 같은 이름은 「이름 2」
    const up2 = await t.http(`${U}/upload`, t.P.ad, { group: { total: 2, last: true }, files: t.files({ '운영/배포.md': '# 배포\n\n## 새 순서\n포트 9090.\n', '인사/휴가.md': '# 휴가\n\n## 신청\n사흘 전에 낸다.\n' }) })
    assert.equal(up2.status, 200, JSON.stringify(up2.j))
    const out2 = await t.s.hub.seedAsIs(t.AD, id, { group: up2.j.group })
    assert.equal(out2.done, true, JSON.stringify(out2))
    const k2 = await t.s.hub.get(id, t.AD)
    assert.ok(k2.byDocPath.get('docs/인사/휴가.md'))
    assert.ok(k2.byDocPath.get('docs/운영/배포 2.md'), '겹치는 이름은 「이름 2」')
    assert.deepEqual(k2.byDocPath.get('docs/운영/배포.md').sections.map((x) => x.h), ['순서', '되돌리기'], '앞 묶음 문서는 그대로')
    // 걸음 실패 → 멈춤 → 그 문서 글 고쳐 이어 넣기(P-D24)
    const id2 = await t.make('테스트-팀실패')
    const up3 = await t.http(`/api/k/${encodeURIComponent(id2)}/seed/upload`, t.P.ad, { group: { total: 1, last: true }, files: t.files({ '안내.md': '# 안내\n\n## 첫날\n09:00 접수.\n' }) })
    await t.http('/api/shape/survey', t.P.ad, { kn: id2, group: up3.j.group })
    await t.s.hub.seedPlan(t.AD, id2, { mode: 'folder' })
    assert.equal((await t.s.hub.seedTry(t.AD, id2)).ok, true)
    // 연습 판 뒤 장부의 실은 글을 꼴이 깨진 글로(진짜에서 걸림)
    const f = t.s.hub.shapeFile(id2)
    const w0 = JSON.parse(fs.readFileSync(f, 'utf8'))
    for (const u of Object.values(w0.texts)) for (const x of u.items) x.content = '## 머리 줄\n글'
    fs.writeFileSync(f, JSON.stringify(w0))
    const p1 = await t.s.hub.shapePut(t.AD, id2)
    assert.ok(p1.stopped?.fail?.length, JSON.stringify(p1))
    let v = await t.s.hub.seedView(t.AD, id2)
    assert.equal(v.work.stage, 'stopped')
    assert.equal(v.work.docs[0].state, 'fail', '걸음 실패 문서')
    assert.equal(await code(t.s.hub.seedWrite(t.AD, id2, { all: true })), 'E_CONFLICT')
    // Claude 로 다시 짓는 중에는 넣지 않는다(넣는 장부를 깨지 않게) · 그만두면 손으로
    await t.s.hub.seedWrite(t.AD, id2, { doc: '안내' })
    assert.equal(await code(t.s.hub.shapePut(t.AD, id2)), 'E_CONFLICT')
    await t.s.hub.seedWrite(t.AD, id2, { stop: true })
    v = await t.s.hub.seedWrite(t.AD, id2, { doc: '안내', items: [{ h: '첫날', content: '09:00 접수.' }] })
    assert.equal(v.work.stage, 'stopped', '연습 판 · 넣은 걸음은 그대로')
    const p2 = await t.s.hub.shapePut(t.AD, id2)
    assert.equal(p2.done, true, JSON.stringify(p2))
    assert.match(fs.readFileSync(path.join(t.root, id2, 'docs', '안내.md'), 'utf8'), /09:00 접수/)
  } finally { await t.done() }
})
