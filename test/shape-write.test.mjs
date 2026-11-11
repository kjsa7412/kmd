// 글 걸음(바탕 세우기 설계 4-3 · 4-5 · Z3) — checkShape · hub.save opt.shape(hub.shapeWrite) · 예약 태그 · touches · 장부 항목 다시 놓기 · 참고 줄 · 넣지 못함 · fixes · 되돌리기 끔
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
  '_vocab.md': '# 항목 장부\n\n## proc\n\n- `proc:배포창`: 배포 창\n\n## check\n\n- `check:사전 점검`: 사전 점검\n- `check:사후 점검`: 사후 점검\n',
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

test('합치기 — 목표를 쓰고 출처를 걷는다 · 참고 줄이 목표로 · 패턴 줄로 닿던 장부 항목이 목표 항목에(정확한 줄 위에) · 기록은 work/(shape · 걸음 표지 · touches) · 기록 상태 그대로 · 멱등 · 되돌리기 끔', async () => {
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

test('걷힌 출처로 들어오던 링크 — 같은 묶음에서 첫 목표 항목으로(`x.md#옛머리` · 앞부분 맞춤) · 다른 머리 링크는 그대로', async () => {
  const s = await setup({ extra: { 'docs/안내.md': '# 안내\n\n## 순서\n[앞](배포%20절차.md#사전%20점검) · [뒤](배포%20절차.md#사후) · [창](배포%20절차.md#배포%20창)\n' } })
  try {
    const { u } = await unitOf(s.dir)
    const r = await write(s, GOOD, { fp: unitFp(u) })
    assert.equal(r.put, 1, JSON.stringify(r))
    const t = fs.readFileSync(path.join(s.dir, 'docs/안내.md'), 'utf8')
    assert.match(t, /\[앞\]\(배포%20절차\.md#점검%20목록\)/, t)
    assert.match(t, /\[뒤\]\(배포%20절차\.md#점검%20목록\)/, '앞부분 맞춤 링크도')
    assert.match(t, /\[창\]\(배포%20절차\.md#배포%20창\)/, '다른 머리는 그대로')
    assert.equal(git(s.dir, 'status', '--porcelain').trim(), '', '같은 묶음')
    assert.match(git(s.dir, '-c', 'core.quotepath=false', 'show', '--name-only', '--format=', 'HEAD'), /안내\.md/)
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
      assert.equal(await code(s.hub.save(s.ctx, 'ops', { record: { title: '흉내', body: '흉내', tags: [tag], touchesEmpty: '시험' } })), 'E_FORBIDDEN', tag)
    }
    assert.equal(await code(s.hub.shapeWrite(s.ctx, 'ops', { plan: MERGE, n: 1, texts: [], work: WORK, step: 'shape/zz/1' })), 'E_INPUT')
    assert.equal(await code(s.hub.shapeWrite({ user: '박' }, 'ops', { plan: MERGE, n: 1, texts: [], work: WORK, step: `shape/${WORK}/1` })), 'E_NOTFOUND', '자리 없는 사람')
  } finally { s.done() }
})

