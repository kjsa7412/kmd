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
