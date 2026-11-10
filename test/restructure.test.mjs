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

test('제목만 맞추기(titles) — 경로는 그대로 · `# 제목` 만 파일 이름으로 · 한 커밋', async () => {
  const dir = make(BASE)
  const r = await applyRestructure(dir, { titles: ['설계/게이트웨이테이블정의서'] }, { user: 'kim' })
  assert.ok(r.commit)
  assert.equal(r.summary.titled, 1)
  assert.match(read(dir, 'docs/설계/게이트웨이테이블정의서.md'), /^# 게이트웨이테이블정의서$/m)
  assert.ok(r.lines.some((l) => l.startsWith('- 제목:')))
  assert.match(git(dir, 'log', '-1', '--format=%s'), /제목 1/)
  assert.equal(git(dir, 'status', '--porcelain').trim(), '')
  await assert.rejects(applyRestructure(dir, { titles: ['원본'] }, { user: 'kim' }), /원본이 주인/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('옮겼다 되돌리면 같은 글 — %xx 링크 꼴 그대로 · 갈래 장부 폴더 칸이 따라온다(맨 위 → 다시 폴더)', async () => {
  const files = { ...BASE, 'docs/공통/용어집.md': '# 용어집\n\n## PLC\n- [기록](../../work/2026-1101-%EA%B0%80.md) · [설계](../%EC%84%A4%EA%B3%84/%EA%B2%8C%EC%9D%B4%ED%8A%B8%EC%9B%A8%EC%9D%B4%EC%84%A4%EA%B3%84%EC%84%9C.md)\n', 'work/2026-1101-가.md': '---\nid: 2026-1101-가\ntitle: "가"\ndate: 2026-11-01 09:00\nauthor: 김\n---\n\n# 가\n', '_forms.md': BASE['_forms.md'] + '| 용어집 | 용어 | 공통 | 대장 | `term:*` | 지식문서 |\n' }
  const dir = make(files)
  const t0 = read(dir, 'docs/공통/용어집.md')
  await applyRestructure(dir, { moves: [{ from: '공통/용어집', to: '용어집' }] }, { user: 'kim' })
  assert.match(read(dir, '_forms.md'), /\| 용어집 \| 용어 \| — \|/)
  assert.match(read(dir, 'docs/용어집.md'), /\(\.\.\/work\/2026-1101-%EA%B0%80\.md\)/, '%xx 꼴 그대로')
  await applyRestructure(dir, { moves: [{ from: '용어집', to: '공통/용어집' }] }, { user: 'kim' })
  assert.match(read(dir, '_forms.md'), /\| 용어집 \| 용어 \| 공통 \|/, '다시 폴더로 오면 폴더 칸도')
  assert.equal(read(dir, 'docs/공통/용어집.md'), t0, '옮겼다 되돌리면 글이 같다')
  fs.rmSync(dir, { recursive: true, force: true })
})

// ── 항목 옮기기 · 이름 · 걷기(바탕 세우기 설계 4-3 · 4-4 · Z1) ──
const rec = (id, date, touches, extra = '') => `---\nid: ${id}\ntitle: "${id}"\ndate: ${date}\nauthor: 김\n${touches.length ? `touches:\n${touches.map((c) => `  - ${c}`).join('\n')}\n` : ''}${extra}---\n\n# ${id}\n\n## 바뀐 것\n- 값\n`
const ITEM = {
  'docs/운영/배포.md': '# 배포\n\n배포 절차를 모은다.\n\n## 배포 창\n화요일 09:00 에 연다.\n\n## 롤백\n되돌린다.\n',
  'docs/점검.md': '# 점검\n\n## 사전 점검\n[배포 창](운영/배포.md#배포%20창) 앞에 본다.\n',
  'docs/서버대장.md': '# 서버대장\n\n## web01\n웹 서버. [창](운영/배포.md#배포%20창)\n<!-- applied: 2026-1102-b -->\n\n## web02\n예비.\n',
  'docs/원본.md': '<!-- watched: src="s" path="p.docx" -->\n# 원본\n\n## 가\n글\n',
  'work/2026-1101-a.md': rec('2026-1101-a', '2026-11-01 09:00', ['proc:배포창']),
  'work/2026-1102-b.md': rec('2026-1102-b', '2026-11-02 09:00', ['server:web01']),
  '_managed.md': '| 이름 | 문서 | 항목 |\n|---|---|---|\n| `proc:배포창` | `docs/운영/배포.md` | `## 배포 창` |\n| `server:*` | `docs/서버대장.md` | `## {값}` |\n',
  '_vocab.md': '# 이름 장부\n\n## proc\n\n- `proc:배포창`: 배포 창\n\n## server\n\n- `server:web01`: web01\n- `server:web02`: web02\n',
}
// 둘째 커밋 — 기록 a 를 배포 창에 넣는다(되돌리기가 찾을 앞 판) · 그 뒤 기록 c(아직 안 넣음)
function makeItems() {
  const dir = make(ITEM)
  fs.writeFileSync(path.join(dir, 'docs/운영/배포.md'), '# 배포\n\n배포 절차를 모은다.\n\n## 배포 창\n<!-- applied: 2026-1101-a -->\n화요일 10:00 에 연다. [롤백](#롤백) · [서버](../서버대장.md)\n\n### 세부\n- 값 3\n\n## 롤백\n되돌린다.\n\n<!-- kmd:참고 · kmd 가 적고 고친다. 손으로 고치지 않는다 -->\n**참고**\n\n- 배포 창\n  - 2026-11-01 [a](../../work/2026-1101-a.md)\n<!-- /kmd:참고 -->\n')
  fs.writeFileSync(path.join(dir, 'work/2026-1103-c.md'), rec('2026-1103-c', '2026-11-03 09:00', ['proc:배포창']))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'a 넣음')
  return dir
}
const states = (k) => Object.fromEntries(k.works.map((w) => [w.id, w.state]))

test('항목 옮기기 · 이름 — 글자 그대로 · applied · 링크(글 속 · 들어오는 #머리) · 참고 줄 깊이 · 자리 장부(제자리 · 패턴 줄 위) · 기록 상태 그대로 · 한 커밋', async () => {
  const { sectionOf } = await import('../core/knowledge.js')
  const { parseDoc } = await import('../core/sections.js')
  const dir = makeItems()
  const k0 = await loadKnowledge({ id: 't', name: 't', dir })
  const s0 = states(k0)
  assert.equal(s0['2026-1101-a'], 'in')
  assert.equal(s0['2026-1103-c'], 'pend')
  const body0 = parseDoc(read(dir, 'docs/운영/배포.md'), '').sections.find((s) => s.h === '배포 창').body
  const ops = { creates: ['운영/서버'], items: [
    { from: { doc: '운영/배포', h: '배포 창' }, to: { doc: '점검', h: '배포 창', before: '사전 점검' } },
    { from: { doc: '서버대장', h: 'web01' }, to: { doc: '운영/서버' } },
    { from: { doc: '서버대장', h: 'web02' }, to: { doc: '서버대장', h: 'web03' } },
  ] }
  const dry = await applyRestructure(dir, ops, { user: 'kim', dry: true })
  assert.equal(dry.summary.items, 3)
  assert.ok(dry.lines.includes('- 항목 옮김: 운영/배포 › 배포 창 → 점검 › 배포 창'), dry.lines.join('\n'))
  const r = await applyRestructure(dir, ops, { user: 'kim', base: dry.stepFp })
  assert.ok(r.commit)
  assert.equal(git(dir, 'status', '--porcelain').trim(), '', '모두 한 커밋')
  const t = read(dir, 'docs/점검.md')
  const secs = parseDoc(t, '').sections
  assert.deepEqual(secs.map((s) => s.h), ['배포 창', '사전 점검'], '놓을 차례(before)')
  const moved = secs[0]
  assert.equal(moved.applied, '2026-1101-a', 'applied 표지가 글과 같이')
  assert.match(moved.body, /### 세부\n- 값 3/, '### 소제목까지')
  assert.match(moved.body, /\[롤백\]\(운영\/배포\.md#/, '원래 문서의 #머리 는 원래.md#머리')
  assert.match(moved.body, /\[서버\]\(서버대장\.md\)/, '글 속 상대 링크는 새 자리 기준')
  assert.equal(moved.body.replace(/\(운영\/배포\.md#[^)]*\)/, '(#롤백)').replace('(서버대장.md)', '(../서버대장.md)'), body0, '링크 말고는 글자 그대로')
  assert.match(t, /\[배포 창\]\(#배포%20창\)/, '같은 문서가 된 들어오는 링크는 #머리')
  assert.match(t, /- 2026-11-01 \[a\]\(\.\.\/work\/2026-1101-a\.md\)/, '참고 줄 기록 링크는 목표 깊이로')
  assert.match(read(dir, 'docs/운영/서버.md'), /\[창\]\(\.\.\/점검\.md#배포%20창\)/, '다른 문서의 들어오는 링크(옮긴 항목 속 링크도)')
  const src = read(dir, 'docs/운영/배포.md')
  assert.ok(!/배포 창/.test(src) && !/kmd:참고/.test(src), '출처에서 항목 · 참고 줄이 빠진다')
  assert.match(src, /## 롤백/)
  assert.match(read(dir, 'docs/운영/서버.md'), /## web01\n웹 서버\./)
  assert.match(read(dir, 'docs/서버대장.md'), /## web03\n예비\./, '항목 이름')
  const reg = read(dir, '_managed.md')
  assert.match(reg, /\| `proc:배포창` \| `docs\/점검\.md` \| `## 배포 창` \|/, '정확한 줄은 제자리에서')
  const rl = reg.split('\n')
  const iw1 = rl.findIndex((l) => l.includes('`server:web01`')), iw2 = rl.findIndex((l) => l.includes('`server:web02`')), ip = rl.findIndex((l) => l.includes('`server:*`'))
  assert.ok(iw1 >= 0 && iw1 < ip && iw2 >= 0 && iw2 < ip, '패턴 줄로 닿던 이름은 패턴 줄 위에 정확한 줄:\n' + reg)
  assert.match(rl[iw1], /docs\/운영\/서버\.md/)
  assert.match(rl[iw2], /## web03/)
  const k = await loadKnowledge({ id: 't', name: 't', dir })
  assert.equal(sectionOf(k, 'proc:배포창').sec.h, '배포 창')
  assert.equal(sectionOf(k, 'proc:배포창').doc.path, 'docs/점검.md')
  assert.equal(sectionOf(k, 'server:web01').doc.path, 'docs/운영/서버.md')
  assert.equal(sectionOf(k, 'server:web02').sec.h, 'web03')
  assert.deepEqual(states(k), s0, '기록 상태 앞뒤 같음')
  const log = k.logs.find((w) => w.tags.includes('structure'))
  assert.match(log.body, /- 항목 이름: 서버대장 › web02 → 서버대장 › web03/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('항목 막는 것 — 앞부분 겹침 · 같은 머리 · 원본이 주인 · 갈래 머리 꼴 · 섞인 자리(legacy-mix) · 없는 항목 · 아무것도 쓰지 않는다', async () => {
  const dir = makeItems()
  fs.writeFileSync(path.join(dir, '_forms.md'), '| 갈래 | 다른 이름 | 폴더 | 종류 | 이름 | 서식 |\n|---|---|---|---|---|---|\n| 회의록 | 회의 | — | 사건 | — | 작업기록 |\n| 점검 | — | — | 대상 | — | 지식문서 |\n| 배포 | — | 운영 | 대상 | — | 지식문서 |\n| 서버대장 | — | — | 대장 | `server:*` | 지식문서 |\n| 원본 | — | — | 대상 | — | 지식문서 |\n')
  fs.writeFileSync(path.join(dir, 'docs/회의록.md'), '# 회의록\n\n## 2026-11-01 착수\n정했다.\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', '갈래')
  const head0 = git(dir, 'rev-parse', 'HEAD').trim()
  const go = (items, opt = {}) => applyRestructure(dir, { items }, { user: 'kim', ...opt })
  await assert.rejects(go([{ from: { doc: '운영/배포', h: '롤백' }, to: { doc: '운영/배포', h: '배포' } }]), /겹치는 머리/, '「배포」 와 「배포 창」')
  await assert.rejects(go([{ from: { doc: '운영/배포', h: '롤백' }, to: { doc: '점검', h: '사전 점검' } }]), /겹치는 머리/)
  await assert.rejects(go([{ from: { doc: '원본', h: '가' }, to: { doc: '점검' } }]), /원본이 주인/)
  await assert.rejects(go([{ from: { doc: '점검', h: '사전 점검' }, to: { doc: '원본' } }]), /원본이 주인/)
  await assert.rejects(go([{ from: { doc: '운영/배포', h: '롤백' }, to: { doc: '회의록' } }]), /머리 꼴/)
  await assert.rejects(go([{ from: { doc: '운영/배포', h: '없음' }, to: { doc: '점검' } }]), /없는 항목/)
  await assert.rejects(go([{ from: { doc: '운영/배포', h: '배포' }, to: { doc: '점검' } }]), /없는 항목/, '앞부분 맞춤으로 집지 않는다')
  const legacy = (k, d, s) => (s.h === '배포 창' ? ['2026-1103-c'] : [])
  await assert.rejects(go([{ from: { doc: '운영/배포', h: '배포 창' }, to: { doc: '점검' } }], { legacy }), (e) => e.code === 'E_INPUT' && e.details.some((x) => x.code === 'legacy-mix'))
  await assert.rejects(go([{ from: { doc: '운영/배포' }, to: { doc: '점검' } }]), /items 는/)
  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), head0)
  assert.equal(git(dir, 'status', '--porcelain').trim(), '')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('항목 옮김 · 이름 뒤 옛 기록 되돌리기 — 항목을 지우지 않고 앞 자리의 앞 판 글로 · 짜임 이력 줄이 없으면 E_CONFLICT', async () => {
  const { revertPlan, priorPlace } = await import('../core/revert.js')
  const dir = makeItems()
  await applyRestructure(dir, { items: [{ from: { doc: '운영/배포', h: '배포 창' }, to: { doc: '점검', h: '배포 시간' } }] }, { user: 'kim' })
  await applyRestructure(dir, { moves: [{ from: '점검', to: '운영/점검' }] }, { user: 'kim' })
  const k = await loadKnowledge({ id: 't', name: 't', dir })
  const plan = await revertPlan(k, '2026-1101-a')
  assert.equal(plan.sections.length, 1)
  const s = plan.sections[0]
  assert.equal(s.doc, 'docs/운영/점검.md')
  assert.equal(s.heading, '배포 시간')
  assert.ok(!s.remove, '지우지 않는다')
  assert.match(s.content, /화요일 09:00/, '넣기 앞 글')
  assert.deepEqual(priorPlace('- 항목 이름: a › 가 → a › 나\n- 옮김: b → c', 'a', '나'), { doc: 'a', h: '가' })
  assert.deepEqual(priorPlace('- 옮김: b → c', 'c', '가'), { doc: 'b', h: '가' })
  assert.equal(priorPlace('- 옮김: b → c', 'd', '가'), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('같은 문서 안 이름 바꾸기 · 그 기록의 표지가 있던 문서로 옮김 뒤 되돌리기 — 항목을 지우지 않고 앞 판 글로 · 짜임 이력이 없으면 E_CONFLICT', async () => {
  const { revertPlan } = await import('../core/revert.js')
  // 같은 문서 안 이름 바꾸기 — 표지 수가 그대로라 -S 가 짜임 커밋을 못 본다
  const d1 = makeItems()
  await applyRestructure(d1, { items: [{ from: { doc: '운영/배포', h: '배포 창' }, to: { doc: '운영/배포', h: '배포 시간' } }] }, { user: 'kim' })
  const p1 = await revertPlan(await loadKnowledge({ id: 't', name: 't', dir: d1 }), '2026-1101-a')
  assert.equal(p1.sections.length, 1)
  assert.equal(p1.sections[0].heading, '배포 시간')
  assert.ok(!p1.sections[0].remove, '지우지 않는다')
  assert.match(p1.sections[0].content, /화요일 09:00/, '넣기 앞 글')
  // 짜임 이력 없이 손으로 이름을 바꾼 것 — 지우지 않고 E_CONFLICT
  const f = path.join(d1, 'docs/운영/배포.md')
  fs.writeFileSync(f, read(d1, 'docs/운영/배포.md').replace('## 배포 시간', '## 배포 때'))
  git(d1, 'commit', '-qam', '손으로 이름')
  await assert.rejects(revertPlan(await loadKnowledge({ id: 't', name: 't', dir: d1 }), '2026-1101-a'), (e) => e.code === 'E_CONFLICT')
  fs.rmSync(d1, { recursive: true, force: true })
  // 그 기록의 표지가 이미 있던 문서로 옮김 — -S 의 가장 옛 묶음은 그 문서에 처음 단 묶음(옮긴 항목은 거기 없다)
  const d2 = makeItems()
  fs.writeFileSync(path.join(d2, 'docs/점검.md'), '# 점검\n\n## 사전 점검\n<!-- applied: 2026-1101-a -->\n[배포 창](운영/배포.md#배포%20창) 앞에 본다.\n')
  git(d2, 'commit', '-qam', '점검에도 a')
  await applyRestructure(d2, { items: [{ from: { doc: '운영/배포', h: '배포 창' }, to: { doc: '점검' } }] }, { user: 'kim' })
  const p2 = await revertPlan(await loadKnowledge({ id: 't', name: 't', dir: d2 }), '2026-1101-a', { doc: 'docs/점검.md', heading: '배포 창' })
  assert.equal(p2.sections.length, 1)
  assert.ok(!p2.sections[0].remove, '지우지 않는다')
  assert.match(p2.sections[0].content, /화요일 09:00/)
  fs.rmSync(d2, { recursive: true, force: true })
})

test('새 대장 문서의 패턴 줄 · 빈 문서 걷기(항목 0 · 요약 0 · 들어오는 링크 0 · 장부 줄 0) · 걸음 표지 멱등 · stepFp 는 건드리지 않는 문서 글에 안 바뀜', async () => {
  const { stepFp } = await import('../core/restructure.js')
  const dir = makeItems()
  fs.writeFileSync(path.join(dir, '_forms.md'), '| 갈래 | 다른 이름 | 폴더 | 종류 | 이름 | 서식 |\n|---|---|---|---|---|---|\n| 이슈 대장 | — | — | 대장 | `이슈:*` | 지식문서 |\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', '갈래')
  await applyRestructure(dir, { creates: ['이슈 대장', '빈 문서', '링크 받는 문서'] }, { user: 'kim' })
  assert.match(read(dir, '_managed.md'), /\| `이슈:\*` \| `docs\/이슈 대장\.md` \| `## \{값\}` \|/)
  fs.appendFileSync(path.join(dir, 'docs/점검.md'), '\n[받는](링크%20받는%20문서.md)\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', '링크')
  await assert.rejects(applyRestructure(dir, { drops: ['점검'] }, { user: 'kim' }), /빈 문서가 아니다/)
  await assert.rejects(applyRestructure(dir, { drops: ['링크 받는 문서'] }, { user: 'kim' }), /들어오는 링크/)
  await assert.rejects(applyRestructure(dir, { drops: ['이슈 대장'] }, { user: 'kim' }), /자리 장부/)
  const step = 'shape/0123456789ab/2'
  const r = await applyRestructure(dir, { drops: ['빈 문서'] }, { user: 'kim', step })
  assert.ok(r.commit)
  assert.ok(!has(dir, 'docs/빈 문서.md'))
  assert.ok(!parseOrder(read(dir, '_order.md')).order[''].includes('빈 문서'), '차례에서도')
  const again = await applyRestructure(dir, { drops: ['빈 문서'] }, { user: 'kim', step })
  assert.equal(again.skipped, true, '같은 걸음은 한 번만')
  assert.equal(again.log, r.log)
  await assert.rejects(applyRestructure(dir, {}, { user: 'kim', step: 'shape/x/1' }), /걸음 표지/)
  // stepFp — 건드리지 않는 문서의 글이 바뀌어도 그대로 · 옮기는 항목 글이 바뀌면 바뀐다
  const ops = { items: [{ from: { doc: '운영/배포', h: '롤백' }, to: { doc: '운영/배포', h: '되돌리기' } }] }
  const f1 = stepFp(await readStructure(dir), ops)
  fs.appendFileSync(path.join(dir, 'docs/서버대장.md'), '\n덧붙인 글\n')
  assert.equal(stepFp(await readStructure(dir), ops), f1)
  fs.writeFileSync(path.join(dir, 'docs/운영/배포.md'), read(dir, 'docs/운영/배포.md').replace('되돌린다.', '되돌린다. 바뀜'))
  assert.notEqual(stepFp(await readStructure(dir), ops), f1)
  await assert.rejects(applyRestructure(dir, ops, { user: 'kim', base: f1 }), (e) => e.code === 'E_CONFLICT')
  fs.rmSync(dir, { recursive: true, force: true })
})
