// 종합 검토 「바로 고칠 것」 — 서버 · core 쪽(Q53 · Q54 · Q56 · Q57 · Q61 · Q62 · Q79 · Q88).
//
// 찾기 학습은 지식마다 한 줄 · 깨진 파일을 덮지 않는다 · 물려받은 이름을 잡지 않는다 · 잘못된 % 열은 400 ·
// /mcp 묶음 한도 · 넣기는 자리부터 · 부탁 카드 검사 · `[단추](설명)` 은 쓴 그대로 · `applied: null` 표지 걷기.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { learn, loadLearned } from '../core/search.js'
import { render } from '../server/views.js'
import { convertDoc } from '../core/docformat.js'
import { parseDoc } from '../core/sections.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, root, data, s
const P = {}
const req = async (p, who, body, raw = false) => {
  const r = await fetch(s.url + p, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${who.key}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}) })
  return { status: r.status, j: await r.json().catch(() => null) }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-qfix-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  root = path.join(tmp, 'kn')
  data = path.join(root, '.kmd')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  P.boss = await signIn(s, { id: 'boss', admin: true })
  P.rd = await signIn(s, { id: 'rd', admin: false })
  await s.hub.setAccess(SHELL, 'dpms', { all: 'read' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('Q53 찾기 학습: 동시에 20번 눌러도 모두 남는다 · 깨진 파일은 덮지 않고 이번 것만 건너뛴다', async () => {
  const dir = path.join(tmp, 'learn1')
  await Promise.all(Array.from({ length: 20 }, (_, i) => learn(dir, 'k', { q: '배포 시간대', coord: 'proc:준비', who: `u${i}` })))
  const j = await loadLearned(dir, 'k')
  assert.equal(j['배포시간대']?.['proc:준비']?.n ?? Object.values(j)[0]['proc:준비'].n, 20)
  const f = path.join(dir, 'learn', 'k.json')
  fs.writeFileSync(f, '{깨짐')
  const logs = []
  assert.equal(await learn(dir, 'k', { q: '다른 말', coord: 'proc:준비', who: 'x', log: (m) => logs.push(m) }), null)
  assert.equal(fs.readFileSync(f, 'utf8'), '{깨짐', '깨진 파일을 {} 로 덮지 않는다')
  assert.equal(logs.length, 1)
  assert.deepEqual(Object.keys(await loadLearned(dir, 'k')), [], '찾기는 빈 학습으로 돈다')
})

test('Q54 찾기 학습: 물려받은 이름 · 없는 항목 · 긴 글은 받지 않는다', async () => {
  const dir = path.join(tmp, 'learn2')
  const j = await learn(dir, 'k', { q: 'constructor', coord: 'toString', who: 'a' })
  assert.equal(j.constructor.toString.n, 1, '물려받은 함수를 잡지 않는다')
  for (const coord of ['constructor', 'toString', '__proto__']) assert.equal((await req('/api/k/dpms/learn', P.boss, { q: '배포', coord })).status, 400, coord)
  assert.equal((await req('/api/k/dpms/learn', P.boss, { q: 'x'.repeat(201), coord: 'proc:준비' })).status, 400)
  assert.equal((await req('/api/k/dpms/learn', P.boss, { q: '배포', coord: 'proc:준비' })).status, 200)
})

test('Q57 잘못된 % 열: 500 이 아니라 400', async () => {
  assert.equal((await req('/api/k/%E0/tree', P.boss)).status, 400)
  const r = await fetch(s.url + '/manual/%E0')
  assert.equal(r.status, 400)
})

test('Q61 /mcp: 묶음 20개 안 · 객체 아닌 원소 · 물려받은 도구 이름', async () => {
  const one = (id) => ({ jsonrpc: '2.0', id, method: 'ping' })
  const big = await req('/mcp', P.boss, Array.from({ length: 21 }, (_, i) => one(i)))
  assert.equal(big.j.error.code, -32600)
  const mixed = await req('/mcp', P.boss, [one(1), null, 3])
  assert.equal(mixed.status, 200)
  assert.deepEqual(mixed.j.map((x) => x.error?.code ?? 'ok'), ['ok', -32600, -32600])
  for (const name of ['constructor', 'toString', '__proto__']) {
    const r = await req('/mcp', P.boss, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } })
    assert.equal(r.j.error?.code, -32602, name)
  }
})

test('Q56 넣기: 읽기 자리는 본문을 읽기 전에 막는다', async () => {
  const r = await req('/api/k/dpms/import', P.rd, { files: [{ path: 'a.md', b64: Buffer.from('# a').toString('base64') }] })
  assert.equal(r.status, 403)
})

test('Q62 가져오는 곳 부탁: every · rules · kind 를 본다 · 큰 본문은 받지 않는다', async () => {
  const card = { name: '부탁', at: 'https://example.com/a.git' }
  assert.equal((await req('/api/k/dpms/sources/request', P.boss, { ...card, every: 'xx' })).status, 400)
  assert.equal((await req('/api/k/dpms/sources/request', P.boss, { ...card, kind: 'pc' })).status, 400)
  assert.equal((await req('/api/k/dpms/sources/request', P.boss, { ...card, rules: Array.from({ length: 21 }, () => ({ rule: 'docs', into: { doc: 'a' } })) })).status, 400)
  // 64KB 넘는 본문 — 읽다 끊는다(400 이거나 연결이 끊긴다)
  const big = await req('/api/k/dpms/sources/request', P.boss, { ...card, rules: [{ rule: 'docs', into: { doc: 'x'.repeat(70_000) } }] }).catch(() => ({ status: 'cut' }))
  assert.ok([400, 'cut'].includes(big.status), String(big.status))
  assert.equal((await req('/api/k/dpms/sources/request', P.boss, { ...card, rules: [{ rule: 'docs', into: { doc: 'x'.repeat(300) } }] })).status, 400)
  const ok = await req('/api/k/dpms/sources/request', P.boss, { ...card, every: 'daily 09:30', rules: [{ rule: 'docs', into: { doc: '배포절차' }, junk: 'y' }] })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.j.rules, [{ rule: 'docs', into: { doc: '배포절차' } }])
  assert.equal(ok.j.every, 'daily 09:30')
})

test('Q79 `[단추](설명)` 은 쓴 그대로 · 경로 꼴의 열 수 없는 링크만 deadlink', () => {
  const k = { id: 'x', docs: [], byWork: new Map() }
  const h = render(k, 'docs/a.md', '[점수현황] · [의견관리](관리자만), 칸 아래')
  assert.match(h, /\[의견관리\]\(관리자만\), 칸 아래/)
  assert.doesNotMatch(h, /deadlink/)
  assert.match(render(k, 'docs/a.md', '[계획서초안등록](미작성=신규/기작성=수정)'), /\[계획서초안등록\]\(미작성=신규\/기작성=수정\)/)
  assert.match(render(k, 'docs/a.md', '[a](../x/y)'), /deadlink/)
})

test('Q88 `applied: null` 은 표지가 아니다 — 읽을 때 떼고 · 문서 옮기기가 걷는다', () => {
  const doc = '# 문서\n\n## 하나\n<!-- applied: null -->\n본문 줄\n\n## 둘\n<!-- applied: null -->\n<!-- applied: 2026-0101-x -->\n둘 본문\n'
  const d = parseDoc(doc, '문서')
  assert.equal(d.sections[0].applied, null)
  assert.equal(d.sections[0].body, '본문 줄')
  assert.equal(d.sections[1].applied, '2026-0101-x')
  const c = convertDoc(doc)
  assert.ok(c.ok && c.changed, c.why)
  assert.doesNotMatch(c.text, /applied: null/)
  assert.match(c.text, /applied: 2026-0101-x/)
  assert.equal(c.kinds.nul, 2)
  assert.equal(convertDoc('# a\n\n```\n<!-- applied: null -->\n```\n').changed, false, '코드 울타리 안은 두다')
})
