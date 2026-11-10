// 글 걸음(바탕 세우기 설계 4-3 · 4-5 · Z3) — checkShape · hub.save opt.shape(hub.shapeWrite) · 예약 태그 · touches · 이름 다시 놓기 · 참고 줄 · 넣지 못함 · fixes · 되돌리기 끔
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { makeHub } from '../server/hub.js'
import { loadKnowledge, sectionOf } from '../core/knowledge.js'
import { readStructure } from '../core/restructure.js'
import { readShape, diffPlan, cleanPlan, unitFp } from '../core/shape.js'
import { checkShape } from '../core/gate.js'
import { parseDoc } from '../core/sections.js'

const git = (dir, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' })
const rec = (id, date, touches) => `---\nid: ${id}\ntitle: "${id}"\ndate: ${date}\nauthor: 김\ntouches:\n${touches.map((c) => `  - ${c}`).join('\n')}\n---\n\n# ${id}\n\n## 바뀐 것\n- 값\n`
const FILES = {
  'docs/배포 절차.md': '# 배포 절차\n\n## 배포 창\n<!-- applied: 2026-1101-a -->\n화요일 10:00.\n\n## 사전 점검\n<!-- applied: 2026-1102-b -->\n디스크 80% 확인.\n\n## 사후 점검\n헬스 체크 3회.\n\n<!-- kmd:참고 · kmd 가 적고 고친다. 손으로 고치지 않는다 -->\n**참고**\n\n- 사전 점검\n  - 2026-11-02 [b](../work/2026-1102-b.md)\n<!-- /kmd:참고 -->\n',
  'work/2026-1101-a.md': rec('2026-1101-a', '2026-11-01 09:00', ['proc:배포창']),
  'work/2026-1102-b.md': rec('2026-1102-b', '2026-11-02 09:00', ['check:사전 점검']),
  '_managed.md': '| 이름 | 문서 | 항목 |\n|---|---|---|\n| `proc:배포창` | `docs/배포 절차.md` | `## 배포 창` |\n| `check:*` | `docs/배포 절차.md` | `## {값}` |\n',
  '_vocab.md': '# 이름 장부\n\n## proc\n\n- `proc:배포창`: 배포 창\n\n## check\n\n- `check:사전 점검`: 사전 점검\n- `check:사후 점검`: 사후 점검\n',
}
async function setup({ mode = 'team', extra = {}, serve = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-shapew-'))
  const dir = path.join(tmp, 'kn', 'ops')
  for (const [rel, text] of Object.entries({ ...FILES, ...extra })) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  const dataDir = path.join(tmp, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  if (serve) fs.writeFileSync(path.join(dataDir, 'serve.json'), JSON.stringify(serve))
  const hub = await makeHub({ root: path.join(tmp, 'kn'), dataDir, mode, pcUser: mode === 'pc' ? 'me' : null, log: () => {} })
  const ctx = mode === 'pc' ? { user: 'me', pc: true } : { user: '이', admin: true }
  return { tmp, dir, hub, ctx, done: () => fs.rmSync(tmp, { recursive: true, force: true }) }
}
const MERGE = {
  v: 1, kind: 'reshape',
  docs: [{ id: '배포 절차', was: '배포 절차', items: [
    { h: '배포 창', from: [{ doc: '배포 절차', h: '배포 창' }] },
    { h: '점검 목록', from: [{ doc: '배포 절차', h: '사전 점검' }, { doc: '배포 절차', h: '사후 점검' }] },
  ] }],
  names: [{ coord: 'check:사전 점검', doc: '배포 절차', h: '점검 목록' }, { coord: 'check:사후 점검', doc: '배포 절차', h: '점검 목록' }],
}
const WORK = '0123456789ab'
const GOOD = '디스크 80% 확인.\n\n헬스 체크 3회.'
async function unitOf(dir, plan = MERGE, n = 1) {
  const k = await loadKnowledge({ id: 'ops', name: 'ops', dir })
  const u = diffPlan(readShape(k, await readStructure(dir)), cleanPlan(plan).plan).writes.find((x) => x.n === n)
  return { k, u }
}
const write = (s, content, extra = {}) => s.hub.shapeWrite(s.ctx, 'ops', { plan: MERGE, n: 1, texts: [{ doc: '배포 절차', h: '점검 목록', content }], work: WORK, step: `shape/${WORK}/1`, ...extra })
const code = (p) => p.then(() => 'ok', (e) => e.code)

test('합치기 — 목표를 쓰고 출처를 걷는다 · 참고 줄이 목표로 · 패턴 줄로 닿던 이름이 목표 항목에(정확한 줄 위에) · 기록은 work/(shape · 걸음 표지 · touches) · 기록 상태 그대로 · 멱등 · 되돌리기 끔', async () => {
  const s = await setup()
  try {
    const { u } = await unitOf(s.dir)
    const r = await write(s, GOOD, { fp: unitFp(u) })
    assert.equal(r.put, 1, JSON.stringify(r))
    const t = fs.readFileSync(path.join(s.dir, 'docs/배포 절차.md'), 'utf8')
    const pd = parseDoc(t, '')
    assert.deepEqual(pd.sections.map((x) => x.h), ['배포 창', '점검 목록'], '출처 둘을 걷었다')
    assert.equal(pd.sections[1].body, GOOD)
    assert.ok(pd.sections[1].log.some((l) => l.includes('(../work/2026-1102-b.md)')), '출처의 참고 줄을 목표로: ' + JSON.stringify(pd.sections[1].log))
    const reg = fs.readFileSync(path.join(s.dir, '_managed.md'), 'utf8').split('\n')
    const ip = reg.findIndex((l) => l.includes('`check:*`'))
    for (const c of ['check:사전 점검', 'check:사후 점검']) {
      const i = reg.findIndex((l) => l.includes('`' + c + '`'))
      assert.ok(i >= 0 && i < ip && reg[i].includes('## 점검 목록'), reg.join('\n'))
    }
    const k = await loadKnowledge({ id: 'ops', name: 'ops', dir: s.dir })
    assert.equal(sectionOf(k, 'check:사전 점검').sec.h, '점검 목록')
    assert.equal(sectionOf(k, 'check:사후 점검').sec.h, '점검 목록')
    const w = k.works.find((x) => x.tags.includes('shape'))
    assert.ok(w && fs.existsSync(path.join(s.dir, 'work', `${w.id}.md`)), '기록은 work/')
    assert.ok(w.tags.includes(`shape/${WORK}/1`))
    assert.ok(w.touches.includes('check:사전 점검') && w.touches.includes('check:사후 점검'))
    assert.match(w.title, /^합치기: 배포 절차 › 사전 점검 · 배포 절차 › 사후 점검 → 배포 절차 › 점검 목록/)
    assert.equal(k.works.find((x) => x.id === '2026-1101-a').state, 'in')
    assert.equal(k.works.find((x) => x.id === '2026-1102-b').state, 'in', '들어간 기록은 그대로 들어감')
    assert.equal(w.state, 'in')
    assert.equal(git(s.dir, 'status', '--porcelain').trim(), '', '한 커밋')
    const again = await write(s, GOOD)
    assert.equal(again.skipped, true, '같은 걸음은 한 번')
    assert.equal(await code(s.hub.revert(s.ctx, 'ops', { record: w.id })), 'E_FORBIDDEN', '짜임 기록은 되돌리기를 싣지 않는다')
  } finally { s.done() }
})

test('값 대조 — 지어낸 값 · 잃은 값은 넣지 못함(work/ · held) · 다시 넣기에 fixes · 출처 지문 어긋남 E_CONFLICT · 기록 본문은 근거가 아님', async () => {
  const s = await setup()
  try {
    const head0 = git(s.dir, 'rev-parse', 'HEAD').trim()
    const { k, u } = await unitOf(s.dir)
    const fp = unitFp(u)
    const bad = await write(s, '디스크 90% 확인.\n\n헬스 체크 3회.', { fp })
    assert.equal(bad.put, 0)
    assert.ok(bad.held.some((x) => x.code === 'values' && /90%/.test(x.why)), JSON.stringify(bad.held))
    const lost = await write(s, '디스크 80% 확인.', { fp })
    assert.ok(lost.held.some((x) => x.code === 'values' && /3/.test(x.why)), JSON.stringify(lost.held))
    const k1 = await loadKnowledge({ id: 'ops', name: 'ops', dir: s.dir })
    const helds = k1.works.filter((w) => w.tags.includes('shape'))
    assert.equal(helds.length, 2)
    assert.ok(helds.every((w) => w.state === 'held' && w.tags.includes('held')))
    assert.ok(parseDoc(fs.readFileSync(path.join(s.dir, 'docs/배포 절차.md'), 'utf8'), '').sections.some((x) => x.h === '사전 점검'), '문서는 그대로')
    // 기록 본문 · 제목은 근거가 아니다 — 근거는 출처 글뿐
    const units = { targets: [{ doc: 'docs/배포 절차.md', h: '점검 목록', content: '디스크 80% 확인. 헬스 체크 3회. 7일 보관.' }], sources: u.sources.map((x) => ({ doc: `docs/${x.doc}.md`, h: x.h, base: x.sha })), record: { title: '7일', body: '7일 보관' } }
    assert.equal(checkShape(k, units).code, 'values')
    // 다시 넣기 — 넣지 못함 기록을 fixes 로
    const ok = await write(s, GOOD, { fp })
    assert.equal(ok.put, 1, JSON.stringify(ok))
    const k2 = await loadKnowledge({ id: 'ops', name: 'ops', dir: s.dir })
    const last = k2.works.find((w) => w.id === ok.id)
    assert.deepEqual([...last.fixes].sort(), helds.map((w) => w.id).sort())
    assert.ok(helds.every((h) => k2.works.find((w) => w.id === h.id).state === 'fixed'))
    assert.notEqual(git(s.dir, 'rev-parse', 'HEAD').trim(), head0)
  } finally { s.done() }
})

test('출처가 바뀌면 E_CONFLICT · 아무것도 쓰지 않는다 · 입력 태그 shape · shape/… 거절', async () => {
  const s = await setup()
  try {
    const { u } = await unitOf(s.dir)
    const fp = unitFp(u)
    const f = path.join(s.dir, 'docs/배포 절차.md')
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('헬스 체크 3회.', '헬스 체크 3회. 5분 간격.'))
    git(s.dir, 'commit', '-qam', '남의 고침')
    s.hub.forget('ops')
    const head = git(s.dir, 'rev-parse', 'HEAD').trim()
    assert.equal(await code(write(s, GOOD, { fp })), 'E_CONFLICT')
    assert.equal(git(s.dir, 'rev-parse', 'HEAD').trim(), head)
    for (const tag of ['shape', 'shape-done', `shape/${WORK}/1`]) {
      assert.equal(await code(s.hub.save(s.ctx, 'ops', { record: { title: '흉내', body: '흉내', tags: [tag], touchesEmpty: '시험' } }, { channel: 'http' })), 'E_FORBIDDEN', tag)
    }
    assert.equal(await code(s.hub.shapeWrite(s.ctx, 'ops', { plan: MERGE, n: 1, texts: [], work: WORK, step: 'shape/zz/1' })), 'E_INPUT')
    assert.equal(await code(s.hub.shapeWrite({ user: '박' }, 'ops', { plan: MERGE, n: 1, texts: [], work: WORK, step: `shape/${WORK}/1` })), 'E_NOTFOUND', '자리 없는 사람')
  } finally { s.done() }
})

test('섞인 자리 — 출처에 개편 전 기록(pend)이 걸린 합치기는 legacy-mix 넣지 못함(팀)', async () => {
  const s = await setup({ serve: { cutoverAt: '2026-11-05 00:00' }, extra: { 'work/2026-1103-l.md': rec('2026-1103-l', '2026-11-03 09:00', ['check:사후 점검']) } })
  try {
    const k = await loadKnowledge({ id: 'ops', name: 'ops', dir: s.dir }, { cutoverAt: '2026-11-05 00:00', team: true })
    assert.equal(k.works.find((w) => w.id === '2026-1103-l').state, 'pend')
    const r = await write(s, GOOD)
    assert.equal(r.put, 0)
    assert.ok(r.held.some((x) => x.code === 'legacy-mix'), JSON.stringify(r.held))
  } finally { s.done() }
})

test('개인 프로그램에서도 checkShape — 지어낸 값은 넣지 못함 · 맞으면 넣는다 · 나누기(같은 머리 고쳐 쓰기)', async () => {
  const s = await setup({ mode: 'pc' })
  try {
    const bad = await write(s, '디스크 70% 확인.\n\n헬스 체크 3회.')
    assert.equal(bad.put, 0)
    assert.ok(bad.held.some((x) => x.code === 'values'))
    const SPLIT = { v: 1, kind: 'reshape', docs: [{ id: '배포 절차', was: '배포 절차', items: [
      { h: '배포 창', from: [{ doc: '배포 절차', h: '배포 창' }] },
      { h: '사전 점검', from: [{ doc: '배포 절차', h: '사전 점검' }], part: '디스크' },
      { h: '사전 점검 기록', from: [{ doc: '배포 절차', h: '사전 점검' }], part: '없음' },
      { h: '사후 점검', from: [{ doc: '배포 절차', h: '사후 점검' }] },
    ] }], names: [{ coord: 'check:사전 점검', doc: '배포 절차', h: '사전 점검' }] }
    const r = await s.hub.shapeWrite(s.ctx, 'ops', { plan: SPLIT, n: 1, texts: [{ doc: '배포 절차', h: '사전 점검', content: '디스크 80% 확인.' }, { doc: '배포 절차', h: '사전 점검 기록', content: '점검한 사람이 남긴다.' }], work: WORK, step: `shape/${WORK}/1` })
    assert.equal(r.put, 2, JSON.stringify(r))
    const pd = parseDoc(fs.readFileSync(path.join(s.dir, 'docs/배포 절차.md'), 'utf8'), '')
    assert.deepEqual(pd.sections.map((x) => x.h), ['배포 창', '사전 점검', '사전 점검 기록', '사후 점검'], '계획한 차례로')
  } finally { s.done() }
})

test('문서 요약(intros) — 문서 글에 있는 값만 · # 제목 아래에 · 항목은 그대로', async () => {
  const s = await setup()
  try {
    const INTRO = { v: 1, kind: 'reshape', docs: [{ id: '배포 절차', was: '배포 절차', intro: { ask: '요약' }, items: ['배포 창', '사전 점검', '사후 점검'].map((h) => ({ h, from: [{ doc: '배포 절차', h }] })) }] }
    const go = (text, w = WORK) => s.hub.shapeWrite(s.ctx, 'ops', { plan: INTRO, n: 1, intros: { '배포 절차': text }, work: w, step: `shape/${w}/1` })
    const bad = await go('배포는 수요일 11:00 에 연다.')
    assert.ok(bad.held.some((x) => x.code === 'values'), JSON.stringify(bad))
    const ok = await go('배포는 화요일 10:00 에 열고 디스크 80% 를 먼저 본다.', '0123456789ac')
    assert.equal(ok.held, undefined, JSON.stringify(ok))
    const t = fs.readFileSync(path.join(s.dir, 'docs/배포 절차.md'), 'utf8')
    assert.match(t, /^# 배포 절차\n\n배포는 화요일 10:00 에 열고 디스크 80% 를 먼저 본다\.\n\n## 배포 창\n<!-- applied: 2026-1101-a -->/)
    assert.match(t, /- 사전 점검\n  - 2026-11-02 \[b\]/, '참고 블록 그대로')
  } finally { s.done() }
})
