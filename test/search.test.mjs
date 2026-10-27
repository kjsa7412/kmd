// E3 필수 — 찾기 사다리 · 색인.
//
// gdi 사본(C:\project\gdi_wiki 의 docs · work · 장부 — 없으면 그 칸은 건너뛴다)에서 6개 안 ≥ 88(위 한계) ·
// 2 ~ 4단 빈손 → exhaustive:false · 증분 = 처음부터 · 같은 순서 · 남의 개인 지식 토막 0 · 표 토막 머리 행 · 정정 동봉.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { loadKnowledge } from '../core/knowledge.js'
import { buildIndex, ladder, chunkText, searchCheck } from '../core/search.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GDI = process.env.KMD_GDI || 'C:\\project\\gdi_wiki'
let tmp, s, me
const KIM = { user: 'kim' }

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-e3-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  me = await signIn(s, { id: 'kim' })
})
after(async () => {
  await s?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const tool = async (name, args) => {
  const r = await fetch(s.url + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${me.key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
  return (await r.json()).result.structuredContent
}

test('1단 확정 · 2단 약함 · 빈손은 「없다」 가 아니다', async () => {
  const m = await tool('match', { q: '상태 점검', knowledge: 'dpms' })
  assert.equal(m.found[0].coord, 'proc:헬스 체크')
  assert.equal(m.ladder, undefined, '확정이고 항목이 있으면 사다리를 싣지 않는다')
  const w = await tool('match', { q: '헬스 체크를', knowledge: 'dpms' })
  assert.equal(w.found.length, 0)
  assert.ok(w.weak.items.some((x) => x.coord === 'proc:헬스 체크'), JSON.stringify(w.weak))
  assert.ok(w.ladder, '확정이 없으면 같은 응답에 2 ~ 4단')
  const none = await tool('search', { q: 'zzqx 꿻꿻', knowledge: 'dpms' })
  assert.equal(none.results[0].exhaustive, false)
  assert.match(none.results[0].note, /없다는 뜻은 아니다/)
  const q = await tool('search', { q: '롤백 뒤에 서버가 200 인지 어떻게 보나', knowledge: 'dpms' })
  assert.ok(q.results[0].coords.length > 0)
  assert.ok(q.results[0].coords.every((c) => c.via && c.hits))
  assert.equal(typeof q.results[0].more.coords.n, 'number')
})

test('정정 동봉 · 토막이 말하는 이름', async () => {
  const r = await tool('search', { q: '/healthz 새 주소로 바꾼다고', knowledge: 'dpms' })
  const p = r.results[0].passages.find((x) => x.record === '2026-1020-헬스-체크-주소')
  assert.ok(p, JSON.stringify(r.results[0].passages.map((x) => x.path)))
  assert.match(p.label, /정정 앞/)
  assert.equal(p.correctedBy[0].id, '2026-1020-헬스-체크-주소는-health-그대로')
})

test('표 토막: 행 경계에서 자르고 머리 줄 · 표 머리 행을 붙인다', () => {
  const rows = Array.from({ length: 80 }, (_, i) => `| 칸${i} | VARCHAR | 설명 ${'가'.repeat(20)} |`)
  const text = ['# 문서', '', '## 테이블', '| 칸 | 형 | 설명 |', '|---|---|---|', ...rows].join('\n')
  const ch = chunkText(text).filter((c) => c.head === '테이블')
  assert.ok(ch.length >= 2)
  for (const c of ch.slice(1)) {
    const ls = c.text.split('\n')
    assert.equal(ls[0], '## 테이블')
    assert.equal(ls[1], '| 칸 | 형 | 설명 |')
    assert.ok(ls.slice(3).every((l) => /^\| 칸\d+ \|/.test(l)), '행 중간에서 자르지 않는다')
  }
})

test('증분 = 처음부터 · 같은 순서 · 지운 파일의 옛 토막은 없다', async () => {
  const meta = (await s.hub.list()).find((k) => k.id === 'dpms')
  const data = path.join(tmp, 'idx')
  const k0 = await loadKnowledge(meta)
  await buildIndex(k0, { dataDir: data })
  fs.appendFileSync(path.join(meta.dir, 'docs', '운영.md'), '\n## 야간 당번\n밤에는 당번이 알람을 받는다.\n')
  fs.rmSync(path.join(meta.dir, 'docs', '회의 규칙.md'))
  const k1 = await loadKnowledge(meta)
  const inc = await buildIndex(k1, { dataDir: data })
  const fresh = await buildIndex(k1, {})
  const strip = (x) => Object.fromEntries(Object.entries(x.files).map(([p, f]) => [p, f.chunks]))
  assert.deepEqual(strip(inc), strip(fresh))
  assert.ok(!inc.files['docs/회의 규칙.md'])
  const a = await ladder(k1, inc, { q: '당번 알람' })
  const b = await ladder(k1, fresh, { q: '당번 알람' })
  assert.deepEqual(a, b)
  assert.ok(a.passages.some((p) => p.head === '야간 당번'))
})

test('남의 개인 지식 토막 0', async () => {
  await s.hub.setOwner(SHELL, 'gdi', { owner: 'park', private: true })
  const rs = await s.hub.search(KIM, null, { q: '작업 이력 테이블' })
  assert.deepEqual(rs.map((r) => r.knowledge), ['dpms'])
  const r = await fetch(s.url + '/api/find?q=' + encodeURIComponent('작업 이력'), { headers: { cookie: me.cookie } })
  assert.ok((await r.json()).hits.every((h) => h.k !== 'gdi'))
})

test('찾기 후보 배우기: 사람이 고른 것은 다음에 약한 후보로', async () => {
  await s.hub.learn(KIM, 'dpms', { q: '배포 시간대', coord: 'proc:준비' })
  const r = (await s.hub.search(KIM, 'dpms', { q: '배포 시간대' }))[0]
  assert.ok(r.weak.some((w) => w.coord === 'proc:준비' && w.via === '배운 이름'))
})

test('gdi 사본: 6개 안 ≥ 88(위 한계)', { skip: !fs.existsSync(path.join(GDI, '_vocab.md')) && 'gdi 사본이 없다' }, async () => {
  const dir = path.join(tmp, 'gdi')
  for (const d of ['docs', 'work']) copyDir(path.join(GDI, d), path.join(dir, d))
  for (const f of ['_vocab.md', '_managed.md']) fs.copyFileSync(path.join(GDI, f), path.join(dir, f))
  const k = await loadKnowledge({ id: 'gdi', name: 'gdi', dir })
  const idx = await buildIndex(k, {})
  const r = await searchCheck(k, idx, {})
  console.log(`# gdi 찾기 점검: 문항 ${r.score.n} · 6개 안 ${r.score.in}% · 첫째 ${r.score.first}%`)
  assert.ok(r.score.in >= 88, JSON.stringify(r.score))
})
