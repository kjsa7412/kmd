// 문서 짜임 바꾸기(core/restructure.js) — 옮김 · 이름 = 제목 · 링크 · 장부 셋 · 차례 장부 · 한 커밋 · 지문 · 막는 것
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { planRestructure, applyRestructure, readStructure, structureFp, parseOrder, nameProblem } from '../core/restructure.js'
import { loadKnowledge } from '../core/knowledge.js'

const git = (dir, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' })
function make(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-restr-'))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8')
const has = (dir, rel) => fs.existsSync(path.join(dir, rel))

const BASE = {
  'docs/설계/게이트웨이테이블정의서.md': '# 테이블정의서\n\n요약.\n\n## 개요\n[설계서](게이트웨이설계서.md) · [운영](../운영/백업%20절차.md) · ![그림](../assets/x.png)\n\n```\n[코드 속](게이트웨이설계서.md)\n```\n\n<!-- kmd:참고 -->\n- 개요\n  - 2026-11-01 [기록](../../work/2026-1101-a.md)\n',
  'docs/설계/게이트웨이설계서.md': '# 게이트웨이설계서\n\n## 표\n[테이블](게이트웨이테이블정의서.md#개요) · [같은 문서](#표)\n',
  'docs/운영/백업 절차.md': '# 백업 절차\n\n## 매일\n[표](/docs/설계/게이트웨이테이블정의서.md) · [바깥](https://example.com/a.md)\n',
  'docs/회의록.md': '# 회의록\n\n## 2026-11-01 착수\n정했다.\n',
  'docs/원본.md': '<!-- watched: src="s" path="p.docx" -->\n# 원본\n',
  'docs/assets/x.png': 'png',
  'work/2026-1101-a.md': '---\nid: 2026-1101-a\ntitle: "a"\ndate: 2026-11-01 09:00\nauthor: 김\n---\n\n# a\n',
  '_managed.md': '| 이름 | 문서 | 머리 |\n|---|---|---|\n| `table:*` | `docs/설계/게이트웨이테이블정의서.md` | `## {값}` |\n| `proc:매일` | `docs/운영/백업 절차.md` | `## 매일` |\n',
  '_forms.md': '| 갈래 | 다른 이름 | 폴더 | 종류 | 이름 | 서식 |\n|---|---|---|---|---|---|\n| 회의록 | 회의, 미팅 | — | 사건 | — | 작업기록 |\n| 게이트웨이테이블정의서 | — | 설계 | 대장 | `table:*` | 지식문서 |\n| 게이트웨이설계서 | — | 설계 | 대상 | — | 지식문서 |\n| 백업 절차 | — | 운영 | 대상 | — | 지식문서 |\n',
  '_sources.json': JSON.stringify({ sources: [{ name: 'db', rules: [{ rule: 'tables', into: { doc: '설계/게이트웨이테이블정의서' } }] }] }),
}

test('이름 검사 — 글자 · 조각 · 길이 · 예약', () => {
  assert.equal(nameProblem('보관'), '')
  assert.match(nameProblem('a/b'), /글자/)
  assert.match(nameProblem('_order'), /kmd/)
  assert.match(nameProblem('회의록 2026-11-01', { doc: true }), /조각/)
  assert.match(nameProblem('x'.repeat(41)), /40자/)
  assert.match(nameProblem(' 앞'), /빈칸/)
})

test('옮기기 + 이름 바꾸기 — 링크(가리키는 쪽 · 옮긴 문서 안) · 제목 · 장부 셋 · 차례 · 한 커밋 · 이력', async () => {
  const dir = make(BASE)
  const head0 = git(dir, 'rev-parse', 'HEAD').trim()
  const files = await readStructure(dir)
  const fp = structureFp([...files.docs.keys()].map((r) => r.slice(5, -3)), files.order)
  const ops = {
    moves: [{ from: '설계/게이트웨이테이블정의서', to: '설계/표/게이트웨이 테이블정의서' }],
    creates: ['운영/장애 대처'],
    dirs: ['보관'],
    order: { '': ['운영/', '설계/', '보관/', '회의록', '원본'] },
  }
  // 마른 실행 — 쓰지 않는다
  const dry = await applyRestructure(dir, ops, { user: 'kim', base: fp, dry: true })
  assert.equal(dry.commit, null)
  assert.equal(dry.summary.moved, 1)
  assert.ok(dry.summary.links >= 5, JSON.stringify(dry.summary))
  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), head0)
  const r = await applyRestructure(dir, ops, { user: 'kim', by: 'kim', base: fp })
  assert.ok(r.commit)
  assert.equal(git(dir, 'status', '--porcelain').trim(), '', '모두 한 커밋')
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD').trim(), '2')
  const moved = 'docs/설계/표/게이트웨이 테이블정의서.md'
  assert.ok(!has(dir, 'docs/설계/게이트웨이테이블정의서.md') && has(dir, moved))
  const t = read(dir, moved)
  assert.match(t, /^# 게이트웨이 테이블정의서$/m, '이름 = 제목')
  assert.match(t, /\[설계서\]\(\.\.\/게이트웨이설계서\.md\)/, '옮긴 문서 안 — 다른 문서')
  assert.match(t, /\(\.\.\/\.\.\/운영\/백업%20절차\.md\)/, '빈칸은 %20')
  assert.match(t, /!\[그림\]\(\.\.\/\.\.\/assets\/x\.png\)/, '첨부')
  assert.match(t, /\(\.\.\/\.\.\/\.\.\/work\/2026-1101-a\.md\)/, '참고 블록의 기록')
  assert.match(t, /\[코드 속\]\(게이트웨이설계서\.md\)/, '코드 울타리 안은 그대로')
  const g = read(dir, 'docs/설계/게이트웨이설계서.md')
  assert.match(g, /\(표\/게이트웨이%20테이블정의서\.md#개요\)/, '가리키는 쪽 · #머리 그대로')
  assert.match(g, /\(#표\)/)
  assert.match(read(dir, 'docs/운영/백업 절차.md'), /\(\/docs\/설계\/표\/게이트웨이 테이블정의서\.md\)|\(\/docs\/설계\/표\/게이트웨이%20테이블정의서\.md\)/, '뿌리 기준 링크는 뿌리 기준으로')
  assert.match(read(dir, '_managed.md'), /`docs\/설계\/표\/게이트웨이 테이블정의서\.md`/)
  assert.match(read(dir, '_forms.md'), /\| 게이트웨이 테이블정의서 \|.*\| 설계\/표 \|/)
  assert.match(read(dir, '_forms.md'), /\| 장애 대처 \| — \| 운영 \| 대상 \|/, '새 문서의 갈래 줄')
  assert.equal(JSON.parse(read(dir, '_sources.json')).sources[0].rules[0].into.doc, '설계/표/게이트웨이 테이블정의서')
  assert.equal(read(dir, 'docs/운영/장애 대처.md'), '# 장애 대처\n')
  const ord = parseOrder(read(dir, '_order.md'))
  assert.deepEqual(ord.order[''], ['운영/', '설계/', '보관/', '회의록', '원본'])
  assert.ok(ord.dirs.includes('보관'), '빈 폴더는 차례 장부에')
  assert.ok(fs.readdirSync(path.join(dir, 'log')).some((f) => f.includes('문서-짜임-바꿈')))
  // 지식으로 읽으면 — 링크가 풀리고 장부가 맞다
  const k = await loadKnowledge({ id: 't', name: 't', dir })
  assert.ok(k.docs.some((d) => d.id === '설계/표/게이트웨이 테이블정의서' && d.title === '게이트웨이 테이블정의서'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('막는 것 — 원본이 주인 · 같은 이름 · 지문 어긋남 · 갈래 다른 이름(G4) · 아무것도 쓰지 않는다', async () => {
  const dir = make(BASE)
  const head0 = git(dir, 'rev-parse', 'HEAD').trim()
  await assert.rejects(applyRestructure(dir, { moves: [{ from: '원본', to: '보관/원본' }] }, { user: 'kim' }), /원본이 주인/)
  await assert.rejects(applyRestructure(dir, { moves: [{ from: '회의록', to: '설계/게이트웨이설계서' }] }, { user: 'kim' }), /같은 이름/)
  await assert.rejects(applyRestructure(dir, { moves: [{ from: '회의록', to: '설계/게이트웨이설계서' }] }, { user: 'kim' }), (e) => e.code === 'E_INPUT' && Array.isArray(e.details))
  await assert.rejects(applyRestructure(dir, { creates: ['주간 회의 메모'] }, { user: 'kim' }), /회의록/)
  await assert.rejects(applyRestructure(dir, { moves: [{ from: '회의록', to: '보관/회의록' }] }, { user: 'kim', base: '0000000000000000' }), (e) => e.code === 'E_CONFLICT')
  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), head0)
  assert.equal(git(dir, 'status', '--porcelain').trim(), '')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('자리 바꿈(a ↔ b) · 폴더째 옮김(문서마다) · 빈 폴더 거두기', async () => {
  const dir = make(BASE)
  const r = await applyRestructure(dir, { moves: [
    { from: '설계/게이트웨이설계서', to: '설계/게이트웨이테이블정의서' },
    { from: '설계/게이트웨이테이블정의서', to: '설계/게이트웨이설계서' },
  ] }, { user: 'kim' })
  assert.ok(r.commit)
  assert.match(read(dir, 'docs/설계/게이트웨이설계서.md'), /^# 게이트웨이설계서$/m)
  assert.match(read(dir, 'docs/설계/게이트웨이설계서.md'), /## 개요/, '옛 테이블정의서 글')
  assert.match(read(dir, 'docs/설계/게이트웨이테이블정의서.md'), /## 표/)
  const r2 = await applyRestructure(dir, { moves: [
    { from: '설계/게이트웨이설계서', to: '3.3_설계/게이트웨이설계서' },
    { from: '설계/게이트웨이테이블정의서', to: '3.3_설계/게이트웨이테이블정의서' },
  ] }, { user: 'kim' })
  assert.ok(r2.commit)
  assert.ok(!has(dir, 'docs/설계'), '빈 폴더는 거둔다')
  assert.match(read(dir, '_managed.md'), /docs\/3\.3_설계\//)
  assert.equal(git(dir, 'status', '--porcelain').trim(), '')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('계획만 — 차례 장부가 없으면 폴더 먼저 · 이름 차례(숫자는 수로)', () => {
  const docs = new Map([['docs/10.3_납품/a.md', '# a\n'], ['docs/2.1_요구/b.md', '# b\n'], ['docs/용어집.md', '# 용어집\n']])
  const p = planRestructure({ docs, registry: '', forms: '', sources: null, order: '' }, { creates: ['2.1_요구/c'] })
  const w = p.writes.find((x) => x.rel === '_order.md')
  assert.deepEqual(parseOrder(w.text).order[''], ['2.1_요구/', '10.3_납품/', '용어집'])
})

test('서버: 문서 짜임 — 쓰기 자리는 403 · 지식관리자는 읽고(지문) 바꾼다 · 지문이 어긋나면 409 · 나무에 차례', async () => {
  const { startServer } = await import('../server/http.js')
  const { copyDir, signIn, seat } = await import('./helpers.mjs')
  const { fileURLToPath } = await import('node:url')
  const HERE = path.dirname(fileURLToPath(import.meta.url))
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-restr-srv-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  const root = path.join(tmp, 'kn')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  const s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const kim = await signIn(s, { id: 'kim', admin: false })
    const lee = await signIn(s, { id: 'lee', admin: false })
    await seat(s, 'kim', { dpms: 'admin' })
    await seat(s, 'lee', { dpms: 'write' })
    const req = async (u, who, body) => { const r = await fetch(s.url + u, { method: body ? 'POST' : 'GET', headers: { cookie: who.cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json() } }
    assert.equal((await req('/api/k/dpms/structure', lee)).status, 403, '쓰기 자리는 짜임을 바꾸지 않는다')
    const st = await req('/api/k/dpms/structure', kim)
    assert.equal(st.status, 200)
    assert.match(st.j.fp, /^[0-9a-f]{16}$/)
    assert.ok(st.j.docs.some((d) => d.id === '배포절차' && d.title === '배포절차'))
    const ops = { moves: [{ from: '배포절차', to: '운영/배포 절차' }], dirs: ['보관'], order: { '': ['보관/', '운영/'] } }
    assert.equal((await req('/api/k/dpms/structure', lee, { ops })).status, 403)
    const dry = await req('/api/k/dpms/structure', kim, { ops, base: st.j.fp, dry: true })
    assert.equal(dry.status, 200, JSON.stringify(dry.j))
    assert.equal(dry.j.commit, null)
    assert.ok(dry.j.summary.links >= 1)
    const r = await req('/api/k/dpms/structure', kim, { ops, base: st.j.fp })
    assert.equal(r.status, 200, JSON.stringify(r.j))
    assert.ok(r.j.commit)
    assert.equal((await req('/api/k/dpms/structure', kim, { ops, base: st.j.fp })).status, 409, '지문이 어긋나면 아무것도 쓰지 않는다')
    const tree = await req('/api/k/dpms/tree', kim)
    assert.ok(tree.j.docs.some((d) => d.id === '운영/배포 절차' && d.title === '배포 절차'))
    assert.deepEqual(tree.j.order[''].slice(0, 2), ['보관/', '운영/'])
    assert.ok(tree.j.dirs.includes('보관'))
    const doc = await req('/api/k/dpms/doc?d=' + encodeURIComponent('롤백절차'), kim)
    assert.equal(doc.status, 200)
    assert.ok(JSON.stringify(doc.j).includes('운영/배포 절차') || JSON.stringify(doc.j).includes('배포%20절차'), '가리키던 링크가 새 경로로')
  } finally {
    await s.close()
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
  }
})
