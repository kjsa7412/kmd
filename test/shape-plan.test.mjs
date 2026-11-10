// 구조안(core/shape.js · 바탕 세우기 설계 3-3 · 4-2 · 4-3 · Z2) — 꼴 · shapeFp · diffPlan(옮기기 · 이름 · 나누기 · 합치기) · planCheck 걸림 · GET shape · POST shape/check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { readStructure } from '../core/restructure.js'
import { loadKnowledge } from '../core/knowledge.js'
import { cleanPlan, shapeFp, readShape, diffPlan, planCheck, stepsOf } from '../core/shape.js'

const git = (dir, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' })
function make(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-shape-'))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}
const rec = (id, date, touches, applied = false) => `---\nid: ${id}\ntitle: "${id}"\ndate: ${date}\nauthor: 김\ntouches:\n${touches.map((c) => `  - ${c}`).join('\n')}\n---\n\n# ${id}\n\n## 바뀐 것\n- 값\n`
const BASE = {
  'docs/배포 절차.md': '# 배포 절차\n\n## 배포 창\n<!-- applied: 2026-1101-a -->\n화요일 10:00.\n\n## 사전 점검\n디스크 80%.\n\n## 사후 점검\n헬스 체크 3회.\n',
  'docs/장애 대응.md': '# 장애 대응\n\n## 롤백\n이전 판으로.\n\n## 서버 목록\nweb01 은 10.0.0.1 · web02 는 10.0.0.2\n',
  'work/2026-1101-a.md': rec('2026-1101-a', '2026-11-01 09:00', ['proc:배포창']),
  '_managed.md': '| 이름 | 문서 | 항목 |\n|---|---|---|\n| `proc:배포창` | `docs/배포 절차.md` | `## 배포 창` |\n| `proc:사전점검` | `docs/배포 절차.md` | `## 사전 점검` |\n',
  '_vocab.md': '# 이름 장부\n\n## proc\n\n- `proc:배포창`: 배포 창\n- `proc:사전점검`: 사전 점검\n',
}
async function load(dir) {
  const files = await readStructure(dir)
  const k = await loadKnowledge({ id: 't', name: 't', dir })
  return { files, k, S: readShape(k, files) }
}
// 지금 짜임 그대로의 구조안
const same = (S) => ({ v: 1, kind: 'reshape', base: S.fp, docs: S.docs.map((d) => ({ id: d.id, was: d.id, items: d.items.map((it) => ({ h: it.h, from: [{ doc: d.id, h: it.h }] })) })) })
const P = (raw) => { const c = cleanPlan(raw); assert.ok(c.plan, c.error); return c.plan }

test('꼴 — 모양 · 길이 · prototype 이름 · 재료 id', () => {
  assert.match(cleanPlan(null).error, /꼴/)
  assert.match(cleanPlan({ v: 2, kind: 'reshape', docs: [] }).error, /v 는 1/)
  assert.match(cleanPlan({ v: 1, kind: 'x', docs: [] }).error, /kind/)
  assert.match(cleanPlan(JSON.parse('{"v":1,"kind":"reshape","docs":[],"__proto__":{}}')).error, /__proto__/)
  assert.match(cleanPlan({ v: 1, kind: 'reshape', docs: [{ id: 'a', items: [{ h: 'x'.repeat(121), from: [] }] }] }).error, /items\[\]\.h/)
  assert.match(cleanPlan({ v: 1, kind: 'seed', docs: [{ id: 'a', items: [{ h: 'x', src: ['m:zz'] }] }] }).error, /src/)
  assert.match(cleanPlan({ v: 1, kind: 'reshape', docs: [], order: JSON.parse('{"__proto__":[]}') }).error, /order/)
  assert.ok(cleanPlan({ v: 1, kind: 'reshape', base: '0123456789abcdef', docs: [{ id: '/운영/배포/', was: null, intro: { ask: '요약' }, items: [{ h: '가', from: [{ doc: 'a', h: 'b' }], part: '몫' }] }] }).plan.docs[0].id === '운영/배포')
})

test('그대로인 구조안 — 걸음 없음 · 걸림 없음 · shapeFp 는 남의 글 저장에 안 바뀌고 머리 · 장부가 바뀌면 바뀐다', async () => {
  const dir = make(BASE)
  const { files, k, S } = await load(dir)
  const r = planCheck(k, S, P(same(S)))
  assert.ok(r.ok, JSON.stringify(r.errors))
  assert.equal(r.stale, false)
  assert.deepEqual(r.summary, { moves: 0, creates: 0, items: 0, writes: 0, merges: 0, splits: 0, drops: 0, forms: false })
  assert.deepEqual(stepsOf(r.diff).map((s) => s.kind), ['seal'])
  const fp0 = shapeFp(files)
  // 남의 저장(항목 글 고침) — 지문 그대로
  fs.writeFileSync(path.join(dir, 'docs/장애 대응.md'), BASE['docs/장애 대응.md'].replace('이전 판으로.', '이전 판으로 되돌린다. 5분 안.'))
  assert.equal(shapeFp(await readStructure(dir)), fp0, '항목 글은 지문에 넣지 않는다')
  fs.appendFileSync(path.join(dir, 'docs/장애 대응.md'), '\n## 연락\n당번.\n')
  assert.notEqual(shapeFp(await readStructure(dir)), fp0, '머리가 늘면 바뀐다')
  const f2 = shapeFp(await readStructure(dir))
  fs.appendFileSync(path.join(dir, '_managed.md'), '| `proc:롤백` | `docs/장애 대응.md` | `## 롤백` |\n')
  assert.notEqual(shapeFp(await readStructure(dir)), f2, '장부가 바뀌면 바뀐다')
  const again = planCheck(k, readShape(k, await readStructure(dir)), P(same(S)))
  assert.equal(again.stale, true, '지을 때 본 지문과 다르다')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('옮기기 · 이름 · 차례 · 문서 옮기기 판정 — frame 걸음(값 검사 없음)', async () => {
  const dir = make(BASE)
  const { k, S } = await load(dir)
  const plan = P({ v: 1, kind: 'reshape', base: S.fp, docs: [
    { id: '운영/배포', was: '배포 절차', items: [
      { h: '배포 창', from: [{ doc: '배포 절차', h: '배포 창' }] },
      { h: '되돌리기', from: [{ doc: '장애 대응', h: '롤백' }] },
      { h: '사후 점검', from: [{ doc: '배포 절차', h: '사후 점검' }] },
      { h: '사전 점검', from: [{ doc: '배포 절차', h: '사전 점검' }] },
    ] },
    { id: '장애 대응', was: '장애 대응', items: [{ h: '서버 목록', from: [{ doc: '장애 대응', h: '서버 목록' }] }] },
  ] })
  const r = planCheck(k, S, plan)
  assert.ok(r.ok, JSON.stringify(r.errors))
  const f = r.diff.frame
  assert.deepEqual(f.moves, [{ from: '배포 절차', to: '운영/배포' }])
  assert.equal(r.diff.writes.length, 0, '글을 다시 쓰지 않는다')
  const mv = f.items.find((x) => x.from.h === '롤백')
  assert.deepEqual(mv, { from: { doc: '장애 대응', h: '롤백' }, to: { doc: '운영/배포', h: '되돌리기', before: '사후 점검' } }, '항목 옮기기 + 이름 · 다음 항목 앞에')
  assert.ok(f.items.some((x) => x.from.h === '사전 점검' && x.to.before == null), '차례가 바뀌면 그대로인 항목도 차례 걸음')
  assert.deepEqual(stepsOf(r.diff).map((s) => s.kind), ['frame', 'seal'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('합치기 · 나누기 · 엮임 판정 — write 단위 · 고쳐 쓰기 base · 50 조각 넘는 엮임 걸림', async () => {
  const dir = make(BASE)
  const { k, S } = await load(dir)
  const base = same(S)
  // 합치기: 사전 · 사후 점검 → 점검 목록 · 나누기: 서버 목록 → web01 · web02(하나는 같은 머리로 고쳐 쓰기)
  base.docs[0].items = [
    { h: '배포 창', from: [{ doc: '배포 절차', h: '배포 창' }] },
    { h: '점검 목록', from: [{ doc: '배포 절차', h: '사전 점검' }, { doc: '배포 절차', h: '사후 점검' }] },
  ]
  base.docs[1].items = [
    { h: '롤백', from: [{ doc: '장애 대응', h: '롤백' }] },
    { h: '서버 목록', from: [{ doc: '장애 대응', h: '서버 목록' }], part: 'web01' },
    { h: 'web02', from: [{ doc: '장애 대응', h: '서버 목록' }], part: 'web02' },
  ]
  base.names = [{ coord: 'proc:사전점검', doc: '배포 절차', h: '점검 목록' }]
  const r = planCheck(k, S, P(base))
  assert.ok(r.ok, JSON.stringify(r.errors))
  const merge = r.diff.writes.find((u) => u.kind === 'merge')
  const split = r.diff.writes.find((u) => u.kind === 'split')
  assert.deepEqual(merge.sources.map((s) => s.h), ['사전 점검', '사후 점검'])
  assert.deepEqual(split.targets.map((t) => t.h), ['서버 목록', 'web02'])
  assert.match(split.targets[0].base, /^[0-9a-f]{16}$/, '출처와 같은 머리 = 고쳐 쓰기(base)')
  assert.equal(r.summary.merges, 1)
  assert.equal(r.summary.splits, 1)
  // 이름을 다시 놓지 않으면 걸림
  const noName = P({ ...base, names: [] })
  assert.ok(planCheck(k, S, noName).errors.some((e) => e.code === 'names' && /proc:사전점검/.test(e.where)))
  // 엮임 — 출처 · 목표가 서로 걸리면 한 단위 · 50 넘으면 걸림
  const many = { 'docs/큰 문서.md': '# 큰 문서\n\n' + Array.from({ length: 30 }, (_, i) => `## 칸 ${i}\n글 ${i}\n`).join('\n') }
  const dir2 = make(many)
  const L = await load(dir2)
  const big = same(L.S)
  big.docs[0].items = Array.from({ length: 30 }, (_, i) => ({ h: `새 ${i}`, from: [{ doc: '큰 문서', h: `칸 ${i}` }, { doc: '큰 문서', h: `칸 ${(i + 1) % 30}` }] }))
  const rb = planCheck(L.k, L.S, P(big))
  assert.equal(rb.diff.writes.length, 1, '엮인 덩이는 한 단위')
  assert.ok(rb.errors.some((e) => e.code === 'unit'), '50 조각 넘음')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(dir2, { recursive: true, force: true })
})

test('걸림 — 덮임 빠짐 · 구조안에 없는 문서 · G4 · 별칭 겹침 · 이름 자리 밖 · 머리 겹침 · 출처 대기 기록 · 원본이 주인', async () => {
  const files = { ...BASE, 'docs/원본.md': '<!-- watched: src="s" path="p.docx" -->\n# 원본\n\n## 가\n글\n', 'work/2026-1103-c.md': rec('2026-1103-c', '2026-11-03 09:00', ['proc:배포창']) }
  const dir = make(files)
  const { k, S } = await load(dir)
  assert.equal(k.works.find((w) => w.id === '2026-1103-c').state, 'pend')
  const codes = (plan) => planCheck(k, S, P(plan))
  // 덮임 빠짐
  const a = same(S)
  a.docs[0].items.pop()
  assert.ok(codes(a).errors.some((e) => e.code === 'coverage' && /사후 점검/.test(e.where)))
  // 지금 문서가 구조안에 없음
  const b = same(S)
  b.docs = b.docs.filter((d) => d.id !== '원본')
  assert.ok(codes(b).errors.some((e) => /구조안에 없다/.test(e.why)))
  // G4 — 문서 이름이 다른 갈래의 다른 이름에 걸림(기본 갈래 회의록: 회의)
  const c = same(S)
  c.docs.push({ id: '주간 회의', items: [] })
  assert.ok(codes(c).errors.some((e) => e.code === 'g4' && e.where === '주간 회의'))
  // 별칭 겹침 — 갈래 다른 이름이 다른 갈래 이름 안에
  const d = same(S)
  d.forms = [{ name: '배포 절차', kind: '대상' }, { name: '장애 대응', kind: '대상' }, { name: '원본', kind: '대상' }, { name: '점검', aliases: ['배포'], kind: '대상' }]
  assert.ok(codes(d).errors.some((e) => e.code === 'g4' && /배포/.test(e.why)))
  // 이름 자리 밖
  const e = same(S)
  e.names = [{ coord: 'proc:배포창', doc: '배포 절차', h: '없는 머리' }]
  assert.ok(codes(e).errors.some((x) => x.code === 'names' && /없는 머리/.test(x.why)))
  // 머리 겹침(앞부분)
  const f = same(S)
  f.docs[0].items[1].h = '배포'
  assert.ok(codes(f).errors.some((x) => /머리가 겹친다/.test(x.why)))
  // 출처에 아직 안 넣은 기록(c · 배포 창)이 걸린 합치기
  const g = same(S)
  g.docs[0].items = [{ h: '배포 창 · 사전 점검', from: [{ doc: '배포 절차', h: '배포 창' }, { doc: '배포 절차', h: '사전 점검' }] }, { h: '사후 점검', from: [{ doc: '배포 절차', h: '사후 점검' }] }]
  g.names = [{ coord: 'proc:배포창', doc: '배포 절차', h: '배포 창 · 사전 점검' }, { coord: 'proc:사전점검', doc: '배포 절차', h: '배포 창 · 사전 점검' }]
  const rg = codes(g)
  assert.ok(rg.errors.some((x) => x.code === 'pend' && /배포 창/.test(x.where)), JSON.stringify(rg.errors))
  // 원본이 주인 — 항목 이름을 바꾸면 걸림
  const h = same(S)
  h.docs.find((x) => x.id === '원본').items[0].h = '나'
  assert.ok(codes(h).errors.some((x) => /원본이 주인/.test(x.why)))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('서버: GET shape · POST shape/check — 쓰기 자리 403 · 지식관리자 · 초안을 장부에 · 다른 사람이 연 짜임 일은 409 · 걸림은 200 + errors', async () => {
  const { startServer } = await import('../server/http.js')
  const { copyDir, signIn, seat } = await import('./helpers.mjs')
  const { fileURLToPath } = await import('node:url')
  const HERE = path.dirname(fileURLToPath(import.meta.url))
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-shape-srv-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  const root = path.join(tmp, 'kn')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  const s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const kim = await signIn(s, { id: 'kim', admin: false })
    const lee = await signIn(s, { id: 'lee', admin: false })
    const park = await signIn(s, { id: 'park', admin: false })
    await seat(s, 'kim', { dpms: 'admin' })
    await seat(s, 'park', { dpms: 'admin' })
    await seat(s, 'lee', { dpms: 'write' })
    const req = async (u, who, body) => { const r = await fetch(s.url + u, { method: body ? 'POST' : 'GET', headers: { cookie: who.cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json() } }
    assert.equal((await req('/api/k/dpms/shape', lee)).status, 403)
    assert.equal((await req('/api/k/gdi/shape', kim)).status, 404, '자리 없는 지식은 없는 것과 같다')
    const g = await req('/api/k/dpms/shape', kim)
    assert.equal(g.status, 200, JSON.stringify(g.j))
    assert.match(g.j.fp, /^[0-9a-f]{16}$/)
    assert.equal(g.j.work, null)
    assert.ok(g.j.docs.some((d) => d.id === '배포절차' && d.items.length))
    const plan = { v: 1, kind: 'reshape', base: g.j.fp, docs: g.j.docs.map((d) => ({ id: d.id, was: d.id, items: d.items.map((it) => ({ h: it.h, from: [{ doc: d.id, h: it.h }] })) })) }
    assert.equal((await req('/api/k/dpms/shape/check', lee, { plan })).status, 403)
    assert.equal((await req('/api/k/dpms/shape/check', kim, { plan: { v: 1 } })).status, 400)
    const c = await req('/api/k/dpms/shape/check', kim, { plan })
    assert.equal(c.status, 200, JSON.stringify(c.j))
    assert.equal(c.j.ok, true, JSON.stringify(c.j.errors))
    assert.match(c.j.work, /^[0-9a-f]{12}$/)
    const g2 = await req('/api/k/dpms/shape', kim)
    assert.equal(g2.j.work.work, c.j.work)
    assert.equal(g2.j.work.draft, true)
    const led = JSON.parse(fs.readFileSync(path.join(s.hub.shapeFile('dpms')), 'utf8'))
    assert.equal(led.by, 'kim')
    assert.equal(led.plan.docs.length, plan.docs.length, '초안을 장부에')
    assert.equal((await req('/api/k/dpms/shape/check', park, { plan })).status, 409, '연 사람만 잇는다')
    // 걸린 구조안도 200 + errors(초안은 남는다)
    const bad = { ...plan, docs: plan.docs.slice(1) }
    const cb = await req('/api/k/dpms/shape/check', kim, { plan: bad })
    assert.equal(cb.status, 200)
    assert.equal(cb.j.ok, false)
    assert.ok(cb.j.errors.length)
    // 깨진 장부는 덮지 않는다
    fs.writeFileSync(s.hub.shapeFile('dpms'), '{깨짐')
    assert.equal((await req('/api/k/dpms/shape/check', kim, { plan })).status, 409)
    assert.equal(fs.readFileSync(s.hub.shapeFile('dpms'), 'utf8'), '{깨짐')
    assert.equal((await req('/api/k/dpms/shape', kim)).j.work.broken, true)
    // 해 보기 · 넣기 · 그만두기 · 되돌리기 구조안 — 쓰기 자리 403 · 그만두기는 지식관리자 누구나
    for (const x of ['try', 'put', 'stop', 'undo']) assert.equal((await req(`/api/k/dpms/shape/${x}`, lee, {})).status, 403, x)
    assert.equal((await req('/api/k/dpms/shape/try', kim, {})).status, 409, '깨진 장부')
    const st = await req('/api/k/dpms/shape/stop', park, {})
    assert.equal(st.status, 200, JSON.stringify(st.j))
    assert.equal((await req('/api/k/dpms/shape', kim)).j.work, null)
    assert.equal((await req('/api/k/dpms/shape/put', kim, {})).status, 404, '열린 짜임 일이 없다')
    assert.equal((await req('/api/k/dpms/shape/undo', kim, {})).status, 409)
  } finally {
    await s.close()
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
  }
})
