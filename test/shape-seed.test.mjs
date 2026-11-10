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
