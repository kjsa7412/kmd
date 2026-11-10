// 연습 판 · 넣기(바탕 세우기 설계 4-6 · 4-7 · Z4) — try(연습 판 · 진짜는 그대로) · put(걸음마다 멱등 · 이어 넣기) · 넣는 중 남의 저장 ·
//   건드리지 않는 문서 고침은 안 섬 · 건드리는 항목 고침은 다시 맞추기(같은 걸음이면 다시 승인 없음 · 바뀐 단위면 again) · 장부 깨짐 · 되돌리기 구조안
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { makeHub } from '../server/hub.js'
import { loadKnowledge } from '../core/knowledge.js'
import { parseDoc } from '../core/sections.js'

const git = (dir, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' })
const rec = (id, date, touches) => `---\nid: ${id}\ntitle: "${id}"\ndate: ${date}\nauthor: 김\ntouches:\n${touches.map((c) => `  - ${c}`).join('\n')}\n---\n\n# ${id}\n\n## 바뀐 것\n- 값\n`
const FILES = {
  'docs/배포 절차.md': '# 배포 절차\n\n## 배포 창\n<!-- applied: 2026-1101-a -->\n화요일 10:00.\n\n## 사전 점검\n디스크 80% 확인.\n\n## 사후 점검\n헬스 체크 3회.\n',
  'docs/장애 대응.md': '# 장애 대응\n\n## 롤백\n이전 판으로 5분 안에.\n\n## 연락\n당번에게.\n',
  'docs/회의 규칙.md': '# 회의 규칙\n\n## 시간\n30분.\n',
  'work/2026-1101-a.md': rec('2026-1101-a', '2026-11-01 09:00', ['proc:배포창']),
  '_managed.md': '| 이름 | 문서 | 항목 |\n|---|---|---|\n| `proc:배포창` | `docs/배포 절차.md` | `## 배포 창` |\n| `check:*` | `docs/배포 절차.md` | `## {값}` |\n',
  '_vocab.md': '# 이름 장부\n\n## proc\n\n- `proc:배포창`: 배포 창\n\n## check\n\n- `check:사전 점검`: 사전 점검\n- `check:사후 점검`: 사후 점검\n',
}
// 문서 옮기기(배포 절차 → 운영/배포) + 항목 옮기기(장애 대응 › 롤백 → 운영/배포 › 되돌리기) + 합치기(사전 · 사후 점검 → 점검 목록)
const PLAN = (text = '디스크 80% 확인.\n\n헬스 체크 3회.') => ({
  v: 1, kind: 'reshape',
  docs: [
    { id: '운영/배포', was: '배포 절차', items: [
      { h: '배포 창', from: [{ doc: '배포 절차', h: '배포 창' }] },
      { h: '점검 목록', from: [{ doc: '배포 절차', h: '사전 점검' }, { doc: '배포 절차', h: '사후 점검' }], text },
      { h: '되돌리기', from: [{ doc: '장애 대응', h: '롤백' }] },
    ] },
    { id: '장애 대응', was: '장애 대응', items: [{ h: '연락', from: [{ doc: '장애 대응', h: '연락' }] }] },
    { id: '회의 규칙', was: '회의 규칙', items: [{ h: '시간', from: [{ doc: '회의 규칙', h: '시간' }] }] },
  ],
  names: [{ coord: 'check:사전 점검', doc: '운영/배포', h: '점검 목록' }, { coord: 'check:사후 점검', doc: '운영/배포', h: '점검 목록' }],
})
async function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-shapep-'))
  const dir = path.join(tmp, 'kn', 'ops')
  for (const [rel, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  const dataDir = path.join(tmp, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const hub = await makeHub({ root: path.join(tmp, 'kn'), dataDir, mode: 'team', log: () => {} })
  return { tmp, dir, dataDir, hub, ctx: { user: '이', admin: true }, done: () => fs.rmSync(tmp, { recursive: true, force: true }) }
}
const head = (dir) => git(dir, 'rev-parse', 'HEAD').trim()
const heads = (dir, doc) => parseDoc(fs.readFileSync(path.join(dir, 'docs', doc + '.md'), 'utf8'), '').sections.map((x) => x.h)
const code = (p) => p.then(() => 'ok', (e) => e.code)
const states = async (dir) => Object.fromEntries((await loadKnowledge({ id: 'ops', name: 'ops', dir })).works.map((w) => [w.id, w.state]))

test('해 보기 → 넣기 — 연습 판은 진짜를 건드리지 않음 · 같은 core 검사(걸린 글은 연습 판에서 막힘) · 걸음마다 멱등 · 마감 이력 · 장부 「끝남」', async () => {
  const s = await setup()
  try {
    // 지어낸 값 — 연습 판에서 걸리고 진짜는 그대로 · 넣기는 막힌다
    const h0 = head(s.dir)
    await s.hub.shapeCheck('ops', s.ctx, { plan: PLAN('디스크 90% 확인.\n\n헬스 체크 3회.') })
    const bad = await s.hub.shapeTry(s.ctx, 'ops')
    assert.equal(bad.ok, false)
    assert.ok(bad.stopped?.held?.some((x) => x.code === 'values'), JSON.stringify(bad))
    assert.equal(head(s.dir), h0, '진짜는 그대로')
    assert.equal(git(s.dir, 'status', '--porcelain').trim(), '')
    assert.ok(!fs.readdirSync(path.join(s.dataDir, 'shape')).some((x) => !x.endsWith('.json')), '연습 판은 지운다')
    assert.equal(await code(s.hub.shapePut(s.ctx, 'ops')), 'E_CONFLICT', '막는 것이 있으면 넣지 않는다')
    // 맞는 글 — 해 보기 · 넣기
    const c = await s.hub.shapeCheck('ops', s.ctx, { plan: PLAN() })
    assert.equal(c.ok, true, JSON.stringify(c.errors))
    const t = await s.hub.shapeTry(s.ctx, 'ops')
    assert.equal(t.ok, true, JSON.stringify(t))
    assert.deepEqual(t.steps.map((x) => x.kind), ['frame', 'write', 'seal'])
    assert.equal(head(s.dir), h0)
    const st0 = await states(s.dir)
    assert.equal(await code(s.hub.shapePut({ user: '박', admin: true }, 'ops')), 'E_CONFLICT', '연 사람만 잇는다')
    const p = await s.hub.shapePut(s.ctx, 'ops')
    assert.equal(p.done, true, JSON.stringify(p))
    assert.deepEqual(heads(s.dir, '운영/배포'), ['배포 창', '점검 목록', '되돌리기'])
    assert.deepEqual(heads(s.dir, '장애 대응'), ['연락'])
    assert.ok(!fs.existsSync(path.join(s.dir, 'docs/배포 절차.md')))
    const k = await loadKnowledge({ id: 'ops', name: 'ops', dir: s.dir })
    const work = c.work
    assert.equal(k.logs.filter((w) => w.tags.includes(`shape/${work}/2`)).length, 1, '짜임 걸음 이력 하나')
    assert.equal(k.works.filter((w) => w.tags.includes(`shape/${work}/11`)).length, 1, '글 걸음 기록 하나')
    assert.ok(k.logs.some((w) => w.tags.includes('shape-done') && w.tags.includes(`shape/${work}/9999`)), '마감 이력')
    assert.equal((await states(s.dir))['2026-1101-a'], st0['2026-1101-a'])
    // 다시 눌러도 그대로
    const h1 = head(s.dir)
    const again = await s.hub.shapePut(s.ctx, 'ops')
    assert.equal(again.done, true)
    assert.equal(head(s.dir), h1)
    assert.equal((await s.hub.shape('ops', s.ctx)).work.stage, 'done')
  } finally { s.done() }
})

test('이어 넣기 · 넣는 중 남의 저장 — 건드리지 않는 문서 글 고침은 안 서고 · 머리가 바뀌어도 걸음이 같으면 다시 묻지 않고 잇는다', async () => {
  const s = await setup()
  try {
    await s.hub.shapeCheck('ops', s.ctx, { plan: PLAN() })
    await s.hub.shapeTry(s.ctx, 'ops')
    const p1 = await s.hub.shapePut(s.ctx, 'ops', { max: 1 })
    assert.equal(p1.putting, true)
    assert.deepEqual(heads(s.dir, '운영/배포'), ['배포 창', '사전 점검', '사후 점검', '되돌리기'], '짜임만 들어갔다')
    // 남의 저장 — 건드리지 않는 문서 글
    const f = path.join(s.dir, 'docs/회의 규칙.md')
    fs.writeFileSync(f, '# 회의 규칙\n\n## 시간\n30분. 늦으면 기다리지 않는다.\n')
    git(s.dir, 'commit', '-qam', '남의 글 고침')
    s.hub.forget('ops')
    const p2 = await s.hub.shapePut(s.ctx, 'ops', { max: 1 })
    assert.ok(p2.putting && !p2.rebased, JSON.stringify(p2))
    // 남의 저장 — 건드리지 않는 문서에 머리 더함(지문이 바뀜) → 다시 맞추기 · 걸음 같음 → 잇는다
    fs.writeFileSync(f, '# 회의 규칙\n\n## 시간\n30분. 늦으면 기다리지 않는다.\n\n## 장소\n3층.\n')
    git(s.dir, 'commit', '-qam', '남의 머리 더함')
    s.hub.forget('ops')
    const p3 = await s.hub.shapePut(s.ctx, 'ops')
    assert.equal(p3.done, true, JSON.stringify(p3))
    assert.deepEqual(heads(s.dir, '회의 규칙'), ['시간', '장소'])
  } finally { s.done() }
})

test('건드리는 항목 고침 — 넣는 중 E_CONFLICT 로 서고(아무것도 안 씀) · 다시 맞추기는 바뀐 단위라 다시 승인(again)', async () => {
  const s = await setup()
  try {
    await s.hub.shapeCheck('ops', s.ctx, { plan: PLAN() })
    await s.hub.shapeTry(s.ctx, 'ops')
    await s.hub.shapePut(s.ctx, 'ops', { max: 1 })
    const f = path.join(s.dir, 'docs/운영/배포.md')
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('헬스 체크 3회.', '헬스 체크 3회. 1분 간격.'))
    git(s.dir, 'commit', '-qam', '남이 출처 고침')
    s.hub.forget('ops')
    const h = head(s.dir)
    const r = await s.hub.shapePut(s.ctx, 'ops')
    assert.ok(r.again && r.rebased, JSON.stringify(r))
    assert.equal(head(s.dir), h, '아무것도 쓰지 않았다')
    assert.ok(r.diag.blockers.length, '바뀐 출처의 값(1분)이 글에 없어 연습 판에서 걸린다')
  } finally { s.done() }
})

test('장부 깨짐 · 그만두기 · 되돌리기 구조안으로 넣기 앞 짜임에', async () => {
  const s = await setup()
  try {
    const before = { a: heads(s.dir, '배포 절차'), b: heads(s.dir, '장애 대응') }
    const body0 = parseDoc(fs.readFileSync(path.join(s.dir, 'docs/배포 절차.md'), 'utf8'), '').sections
    await s.hub.shapeCheck('ops', s.ctx, { plan: PLAN() })
    // 장부 깨짐 — 덮지 않고 409 · 그만두면 새로 연다
    const lf = s.hub.shapeFile('ops')
    const good = fs.readFileSync(lf, 'utf8')
    fs.writeFileSync(lf, '{깨짐')
    assert.equal(await code(s.hub.shapeTry(s.ctx, 'ops')), 'E_CONFLICT')
    assert.equal(fs.readFileSync(lf, 'utf8'), '{깨짐')
    assert.equal((await s.hub.shapeStop({ user: '박', admin: true }, 'ops')).stopped, true, '지식관리자 누구나 그만두게 한다')
    assert.ok(!fs.existsSync(lf))
    void good
    // 넣고 → 되돌리기 구조안 → 해 보기 → 넣기
    await s.hub.shapeCheck('ops', s.ctx, { plan: PLAN() })
    await s.hub.shapeTry(s.ctx, 'ops')
    assert.equal((await s.hub.shapePut(s.ctx, 'ops')).done, true)
    const u = await s.hub.shapeUndo(s.ctx, 'ops')
    assert.equal(u.ok, true, JSON.stringify(u.errors))
    const t = await s.hub.shapeTry(s.ctx, 'ops')
    assert.equal(t.ok, true, JSON.stringify(t))
    assert.equal((await s.hub.shapePut(s.ctx, 'ops')).done, true)
    assert.deepEqual(heads(s.dir, '배포 절차'), before.a)
    assert.deepEqual(heads(s.dir, '장애 대응'), before.b)
    const body1 = parseDoc(fs.readFileSync(path.join(s.dir, 'docs/배포 절차.md'), 'utf8'), '').sections
    assert.deepEqual(body1.map((x) => x.body), body0.map((x) => x.body), '나눈 글이 넣기 앞 글로')
    assert.ok(!fs.existsSync(path.join(s.dir, 'docs/운영/배포.md')), '되돌린 뒤 빈 문서는 걷었다')
  } finally { s.done() }
})

const ledger = (s) => JSON.parse(fs.readFileSync(s.hub.shapeFile('ops'), 'utf8'))
const putLedger = (s, w) => fs.writeFileSync(s.hub.shapeFile('ops'), JSON.stringify(w))
const tagged = (k, tag) => [...k.works, ...k.logs].filter((w) => w.tags.includes(tag)).length

test('이어 넣기 — 짜임 걸음이 커밋된 뒤 장부 쓰기를 잃어도 이력의 걸음 표지로 다시 하지 않고 잇는다', async () => {
  const s = await setup()
  try {
    const c = await s.hub.shapeCheck('ops', s.ctx, { plan: PLAN() })
    await s.hub.shapeTry(s.ctx, 'ops')
    await s.hub.shapePut(s.ctx, 'ops', { max: 1 })
    // 커밋 뒤 장부 쓰기를 잃었다 — done 비고 지문도 짜임 앞
    const w = ledger(s)
    assert.deepEqual(w.done, [2])
    putLedger(s, { ...w, done: [], tried: { ...w.tried, nowFp: w.tried.fp } })
    const p = await s.hub.shapePut(s.ctx, 'ops')
    assert.equal(p.done, true, JSON.stringify(p))
    const k = await loadKnowledge({ id: 'ops', name: 'ops', dir: s.dir })
    assert.equal(tagged(k, `shape/${c.work}/2`), 1, '짜임 걸음은 한 번')
    assert.deepEqual(heads(s.dir, '운영/배포'), ['배포 창', '점검 목록', '되돌리기'])
  } finally { s.done() }
})

test('한 지식에 한 줄 — 넣기 둘이 같이 와도 걸음마다 한 번', async () => {
  const s = await setup()
  try {
    const c = await s.hub.shapeCheck('ops', s.ctx, { plan: PLAN() })
    await s.hub.shapeTry(s.ctx, 'ops')
    const [a, b] = await Promise.all([s.hub.shapePut(s.ctx, 'ops'), s.hub.shapePut(s.ctx, 'ops')])
    assert.ok(a.done && b.done, JSON.stringify([a, b]))
    const k = await loadKnowledge({ id: 'ops', name: 'ops', dir: s.dir })
    for (const n of [2, 11, 9999]) assert.equal(tagged(k, `shape/${c.work}/${n}`), 1, `걸음 ${n} 은 한 번`)
  } finally { s.done() }
})

test('넣는 중 그만두기 — 다음 걸음 앞에서 서고(넣은 걸음은 그대로) · 넣기 직전 짜임을 남겨(stopped-final) 되돌리기 구조안으로 넣기 앞 짜임에', async () => {
  const s = await setup()
  try {
    const before = { a: heads(s.dir, '배포 절차'), b: heads(s.dir, '장애 대응') }
    const c = await s.hub.shapeCheck('ops', s.ctx, { plan: PLAN() })
    await s.hub.shapeTry(s.ctx, 'ops')
    // 글 걸음 사이에 다른 지식관리자가 그만두게 한다
    const orig = s.hub.shapeWrite
    let stopP = null
    s.hub.shapeWrite = async (...a) => {
      stopP = s.hub.shapeStop({ user: '박', admin: true }, 'ops')
      for (let i = 0; i < 200 && ledger(s).stage !== 'stopped-final'; i++) await new Promise((r) => setTimeout(r, 10))
      return orig(...a)
    }
    const p = await s.hub.shapePut(s.ctx, 'ops')
    s.hub.shapeWrite = orig
    assert.equal(p.halted, true, JSON.stringify(p))
    const st = await stopP
    assert.equal(st.stopped, true)
    assert.equal(st.undoable, true)
    const k = await loadKnowledge({ id: 'ops', name: 'ops', dir: s.dir })
    assert.equal(tagged(k, `shape/${c.work}/9999`), 0, '마감은 하지 않았다')
    const w = ledger(s)
    assert.equal(w.stage, 'stopped-final')
    assert.ok(w.before, '넣기 직전 짜임을 남겼다')
    assert.equal(await code(s.hub.shapePut(s.ctx, 'ops')), 'E_CONFLICT', '그만둔 일은 잇지 않는다')
    // 되돌리기 구조안 → 해 보기 → 넣기
    const u = await s.hub.shapeUndo(s.ctx, 'ops')
    assert.equal(u.ok, true, JSON.stringify(u.errors))
    assert.equal(u.undoOf, c.work)
    assert.equal((await s.hub.shapeTry(s.ctx, 'ops')).ok, true)
    assert.equal((await s.hub.shapePut(s.ctx, 'ops')).done, true)
    assert.deepEqual(heads(s.dir, '배포 절차'), before.a)
    assert.deepEqual(heads(s.dir, '장애 대응'), before.b)
  } finally { s.done() }
})

test('진짜 넣기에서 넣지 못함 — 막다른 길이 아니다: 지금 짜임에 맞춘 구조안으로 다시 검사(일 · 넣은 걸음 · 넣기 직전 짜임 그대로) → 해 보기 → 넣기', async () => {
  const s = await setup()
  try {
    const c = await s.hub.shapeCheck('ops', s.ctx, { plan: PLAN() })
    await s.hub.shapeTry(s.ctx, 'ops')
    // 해 보기 뒤 짜임 뒤 구조안의 글이 틀어졌다(진짜에서만 걸리는 글)
    const w0 = ledger(s)
    const post = JSON.parse(JSON.stringify(w0.tried.post))
    post.docs[0].items[1].text = '디스크 90% 확인.\n\n헬스 체크 3회.'
    putLedger(s, { ...w0, tried: { ...w0.tried, post } })
    const p = await s.hub.shapePut(s.ctx, 'ops')
    assert.ok(p.stopped?.held?.length, JSON.stringify(p))
    const w1 = ledger(s)
    assert.equal(w1.stage, 'stopped')
    // 지금 짜임(짜임 걸음 뒤)에 맞춘 구조안 — 글 걸음만
    const S = await s.hub.shape('ops', s.ctx)
    const plan = {
      v: 1, kind: 'reshape', base: S.fp,
      docs: [
        { id: '운영/배포', was: '운영/배포', items: [
          { h: '배포 창', from: [{ doc: '운영/배포', h: '배포 창' }] },
          { h: '점검 목록', from: [{ doc: '운영/배포', h: '사전 점검' }, { doc: '운영/배포', h: '사후 점검' }], text: '디스크 80% 확인.\n\n헬스 체크 3회.' },
          { h: '되돌리기', from: [{ doc: '운영/배포', h: '되돌리기' }] },
        ] },
        { id: '장애 대응', was: '장애 대응', items: [{ h: '연락', from: [{ doc: '장애 대응', h: '연락' }] }] },
        { id: '회의 규칙', was: '회의 규칙', items: [{ h: '시간', from: [{ doc: '회의 규칙', h: '시간' }] }] },
      ],
      names: [{ coord: 'check:사전 점검', doc: '운영/배포', h: '점검 목록' }, { coord: 'check:사후 점검', doc: '운영/배포', h: '점검 목록' }],
    }
    // 이미 넣은 짜임 걸음을 다시 하는 구조안은 걸림
    const back = { ...plan, docs: [{ ...plan.docs[0], id: '운영/배포2' }, ...plan.docs.slice(1)] }
    assert.ok((await s.hub.shapeCheck('ops', s.ctx, { plan: back })).errors.some((e) => e.where === 'frame'))
    const r = await s.hub.shapeCheck('ops', s.ctx, { plan })
    assert.equal(r.ok, true, JSON.stringify(r.errors))
    assert.equal(r.work, c.work, '같은 일')
    const w2 = ledger(s)
    assert.deepEqual(w2.done, w1.done, '넣은 걸음 그대로')
    assert.deepEqual(w2.before, w1.before, '넣기 직전 짜임 그대로')
    const t = await s.hub.shapeTry(s.ctx, 'ops')
    assert.equal(t.ok, true, JSON.stringify(t))
    assert.equal((await s.hub.shapePut(s.ctx, 'ops')).done, true)
    assert.deepEqual(heads(s.dir, '운영/배포'), ['배포 창', '점검 목록', '되돌리기'])
    assert.deepEqual(ledger(s).before, w1.before, '끝나도 처음 넣기 직전 짜임')
    const k = await loadKnowledge({ id: 'ops', name: 'ops', dir: s.dir })
    assert.equal(k.works.find((x) => x.id === p.stopped.rec).state, 'fixed', '앞 넣지 못함은 바로잡힘')
  } finally { s.done() }
})

test('끝난 일 뒤 새 검사가 걸려도 넣기 직전 짜임을 잃지 않는다 — 되돌리기 구조안을 그대로 연다', async () => {
  const s = await setup()
  try {
    const c = await s.hub.shapeCheck('ops', s.ctx, { plan: PLAN() })
    await s.hub.shapeTry(s.ctx, 'ops')
    assert.equal((await s.hub.shapePut(s.ctx, 'ops')).done, true)
    const bad = await s.hub.shapeCheck('ops', s.ctx, { plan: { v: 1, kind: 'reshape', docs: [] } })
    assert.equal(bad.ok, false)
    assert.equal(ledger(s).undoable?.work, c.work)
    const u = await s.hub.shapeUndo(s.ctx, 'ops')
    assert.equal(u.ok, true, JSON.stringify(u.errors))
    assert.equal(u.undoOf, c.work)
  } finally { s.done() }
})

test('남은 연습 판 — 켤 때 걷기(shapeSweep) · 깨진 장부를 그만두게 하면 그 지식의 연습 판도 걷는다 · http 는 자리를 본문보다 먼저', async () => {
  const s = await setup()
  try {
    const base = path.join(s.dataDir, 'shape')
    fs.mkdirSync(path.join(base, 'ops.0123456789ab', 'docs'), { recursive: true })
    fs.mkdirSync(path.join(base, 'other.aaaaaaaaaaaa'), { recursive: true })
    assert.deepEqual((await s.hub.shapeSweep('ops')).sort(), ['ops.0123456789ab'])
    assert.ok(fs.existsSync(path.join(base, 'other.aaaaaaaaaaaa')), '다른 지식의 연습 판은 그대로')
    assert.deepEqual(await s.hub.shapeSweep(), ['other.aaaaaaaaaaaa'])
    fs.mkdirSync(path.join(base, 'ops.bbbbbbbbbbbb'), { recursive: true })
    fs.writeFileSync(s.hub.shapeFile('ops'), '{깨짐')
    assert.equal((await s.hub.shapeStop(s.ctx, 'ops')).stopped, true)
    assert.ok(!fs.existsSync(path.join(base, 'ops.bbbbbbbbbbbb')), '깨진 장부의 연습 판도 걷었다')
    assert.ok(!fs.existsSync(s.hub.shapeFile('ops')))
  } finally { s.done() }
})
