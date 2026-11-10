// 팀 기초 세우기 올리기(메뉴개편 8-2 · N7 · docs/kmd_권한_모델.md 7절) — POST /api/k/:id/seed/upload
//
// 자리부터(본문을 읽기 전에): 자리 없음 404 · 쓰기 403 · 빈 지식이 아니면 409 · 묶음 누계 300 파일을 서버가 센다(다시 보낸 같은 파일은 세지 않는다) ·
// 받은 파일은 fileToMd 글로 재료 자리(<살림>/shape/<지식>.seed/)에 두고 원본은 두지 않는다 · 「폴더 그대로」 짓기는 hub.save 채널 seed 로.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { seedAsIsDoc } from '../core/importer.js'
import { copyDir, signIn, seat } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, root, data, s
const P = {}
const KN = 'test-기초'
const U = `/api/k/${encodeURIComponent(KN)}/seed/upload`

const req = async (p, who, body) => {
  const r = await fetch(s.url + p, { method: 'POST', headers: { authorization: `Bearer ${who.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, j: await r.json().catch(() => null) }
}
const file = (p, text) => ({ path: p, b64: Buffer.from(text, 'utf8').toString('base64') })

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-seed-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  root = path.join(tmp, 'kn')
  data = path.join(root, '.kmd')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  P.boss = await signIn(s, { id: 'boss', admin: true })
  for (const id of ['ad', 'wr', 'no']) P[id] = await signIn(s, { id, admin: false })
  await s.hub.addKnowledge({ user: 'boss', admin: true }, { kind: 'new', name: KN, empty: true })
  await seat(s, 'ad', { [KN]: 'admin', gdi: 'admin' })
  await seat(s, 'wr', { [KN]: 'write' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('자리부터: 자리 없음 404 · 쓰기 403 · 빈 지식 아님 409 · 꼴 400', async () => {
  const body = { group: { total: 1, last: true }, files: [file('a.md', '# a\n\n## 개요\n글\n')] }
  assert.equal((await req(U, P.no, body)).status, 404, '자리 없는 사람은 없는 지식')
  const w = await req(U, P.wr, body)
  assert.equal(w.status, 403, '쓰기 자리는 지식관리자가 아니다')
  assert.equal(w.j.error, 'E_FORBIDDEN')
  const full = await req(`/api/k/gdi/seed/upload`, P.ad, body)
  assert.equal(full.status, 409, '문서가 있는 지식')
  assert.match(full.j.message, /빈 지식이 아니다/)
  assert.equal((await req(U, P.ad, { group: { id: '../../x' }, files: [] })).status, 400, '묶음 id 꼴')
  assert.equal((await req(U, P.ad, { group: { id: 'abcdefabcdef' }, files: [] })).status, 404, '없는 묶음')
  assert.equal((await req(U, P.ad, { files: [{ path: 'a.md', b64: '!!!' }] })).status, 400, 'base64 아님')
  assert.equal((await req(U, P.ad, { files: [{ path: '../..', b64: '' }] })).status, 400, '이름 없는 경로')
  assert.equal(fs.existsSync(path.join(data, 'shape', `${encodeURIComponent(KN)}.seed`)), false, '거절된 올리기는 재료 자리를 만들지 않는다')
  const bad = await fetch(s.url + '/api/k/%E0/seed/upload', { method: 'POST', headers: { authorization: `Bearer ${P.ad.key}`, 'content-type': 'application/json' }, body: '{}' })
  assert.equal(bad.status, 400, '풀리지 않는 주소 조각')
})

test('묶음 누계: 300 파일 넘으면 거절 · 같은 파일 다시 보내기는 세지 않는다', async () => {
  const many = (from, n) => Array.from({ length: n }, (_, i) => file(`많음/f${from + i}.txt`, `줄 ${from + i}`))
  const a = await req(U, P.ad, { group: { total: 301 }, files: many(0, 200) })
  assert.equal(a.status, 400, 'total 은 300 안')
  const b = await req(U, P.ad, { group: { total: 300 }, files: many(0, 200) })
  assert.equal(b.status, 200, JSON.stringify(b.j))
  assert.equal(b.j.files, 200)
  const gid = b.j.group
  assert.match(gid, /^[0-9a-f]{12}$/)
  const again = await req(U, P.ad, { group: { id: gid }, files: many(0, 50) })
  assert.equal(again.j.files, 200, '다시 보낸 같은 파일은 누계에 더하지 않는다')
  assert.equal(again.j.rows.filter((x) => x.same).length, 50, '다시 보낸 줄도 답에 싣는다')
  const mats = () => fs.readdirSync(path.join(data, 'shape', `${encodeURIComponent(KN)}.seed`, gid)).length
  for (let i = 0; i < 3; i++) {
    const sw = await req(U, P.ad, { group: { id: gid }, files: [file('많음/f0.txt', `바뀐 글 ${i}`)] })
    assert.equal(sw.j.files, 200, '같은 경로 다른 원본은 바꿔 센다')
  }
  assert.equal(mats(), 200, '바꿔 보낸 앞 재료 글은 걷는다(디스크가 쌓이지 않는다)')
  assert.equal((await fetch(s.url + U, { method: 'POST', headers: { authorization: `Bearer ${P.ad.key}`, 'content-type': 'application/json' }, body: 'null' })).status, 400, '본문 null')
  const over = await req(U, P.ad, { group: { id: gid }, files: many(200, 101) })
  assert.equal(over.status, 400, '누계 301')
  assert.match(over.j.message, /300 파일/)
  const other = await req(U, P.boss, { group: { id: gid }, files: many(400, 1) })
  assert.equal(other.status, 409, '남이 연 묶음에 이어 올리지 못한다')
  const steal = await req(U, P.boss, { files: many(500, 1) })
  assert.equal(steal.status, 409, '남이 올리는 중인 묶음이 있으면 새 묶음을 열지 못한다')
  const fit = await req(U, P.ad, { group: { id: gid, last: true }, files: many(200, 100) })
  assert.equal(fit.status, 200)
  assert.equal(fit.j.files, 300)
  assert.equal(fit.j.last, true)
  assert.equal((await req(U, P.ad, { group: { id: gid }, files: many(900, 1) })).status, 409, '닫힌 묶음')
})

test('재료: fileToMd 글만 두고 원본은 두지 않는다 · 폴더 그대로는 hub.save 채널 seed', async () => {
  const md = '# 배포 절차\n\n머리 앞 글: 서버 10.0.0.5 에 올린다.\n\n## 순서\n1. 빌드한다\n2. 포트 8090 으로 띄운다\n\n## 되돌리기\n앞 판으로 바꾼다\n'
  const r = await req(U, P.ad, { group: { total: 3, last: true }, files: [file('운영/배포.md', md), file('표.csv', 'a,b\n1,2\n'), { path: '그림.png', b64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') }] })
  assert.equal(r.status, 200, JSON.stringify(r.j))
  const gid = r.j.group
  const rows = Object.fromEntries(r.j.rows.map((x) => [x.path, x]))
  assert.equal(rows['운영/배포.md'].ok, true)
  assert.match(rows['운영/배포.md'].src, /^m:[0-9a-f]{16}$/)
  assert.equal(rows['그림.png'].ok, false, '그림은 재료 글이 아니다')
  const dir = path.join(data, 'shape', `${encodeURIComponent(KN)}.seed`)
  const names = fs.readdirSync(path.join(dir, gid))
  assert.equal(names.length, 2, '글이 된 둘만')
  assert.ok(names.every((n) => /^[0-9a-f]{16}\.md$/.test(n)), '원본 파일 이름 · 꼴로 두지 않는다')
  assert.equal(fs.readFileSync(path.join(dir, gid, `${rows['운영/배포.md'].src.slice(2)}.md`), 'utf8'), md)
  const g = JSON.parse(fs.readFileSync(path.join(dir, `${gid}.json`), 'utf8'))
  assert.equal(g.by, 'ad')
  assert.equal(g.files, 3)
  assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length, 1, '새 묶음이 앞 묶음을 걷었다')

  assert.equal((await req(U, P.boss, { files: [file('c.md', '# c')] })).status, 409, '남이 닫고 짓기를 기다리는 묶음은 걷지 못한다')

  // 폴더 그대로 — 서버 안 함수(짓기 단계가 부른다) · 쓰기 자리는 403 · 묶음을 연 사람만
  const ad = { user: 'ad' }
  await assert.rejects(s.hub.seedAsIs({ user: 'boss', admin: true }, KN, { group: gid }), { code: 'E_CONFLICT' })
  await assert.rejects(s.hub.seedAsIs({ user: 'wr' }, KN, { group: gid }), { code: 'E_FORBIDDEN' })
  const out = await s.hub.seedAsIs(ad, KN, { group: gid })
  assert.equal(out.put, 2, JSON.stringify(out.rows))
  const k = await s.hub.get(KN, ad)
  const d = k.byDocPath.get('docs/운영/배포.md')
  assert.ok(d, '폴더 짜임 그대로 문서')
  assert.deepEqual(d.sections.map((x) => x.h), ['개요', '순서', '되돌리기'])
  assert.match(d.sections[1].body, /8090/)
  const log = fs.readFileSync(path.join(data, 'savelog', `${encodeURIComponent(KN)}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.ok(log.length >= 2 && log.every((l) => l.ch === 'seed'), '채널 seed 로 저장 문을 지났다')
  // 빈 지식이 아니게 됐다 — 새 올리기는 409 · 같은 묶음을 다시 부르면 남은 것이 없다
  assert.equal((await req(U, P.ad, { files: [file('b.md', '# b\n')] })).status, 409)
  const again = await s.hub.seedAsIs(ad, KN, { group: gid })
  assert.equal(again.put, 0)
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, `${gid}.json`), 'utf8')).put.finished, '다 지으면 끝 표지')
})

test('seedAsIsDoc: 개요 · ## 항목 · 같은 머리 · 코드 울타리 · 기록 본문의 머리 내림 · 덩이 · 늦은 # 줄 · 경로', () => {
  const p = seedAsIsDoc('가/나.docx', '# 제목\n앞 글\n<!-- 숨김 -->\n## 바뀐 것\n값 1\n## 바뀐 것\n값 2\n```\n## 코드 속\n# 코드\n```\n# 둘째 제목\n')
  assert.equal(p.doc, '가/나')
  assert.deepEqual(p.sections.map((x) => x.heading), ['개요', '바뀐 것', '바뀐 것 (2)'])
  assert.match(p.sections[2].content, /## 코드 속/, '울타리 안은 그대로')
  assert.match(p.sections[2].content, /^### 둘째 제목$/m, '울타리 밖 # 은 ###')
  assert.equal(p.chunks.length, 1)
  const body = p.chunks[0].body
  assert.doesNotMatch(body, /^##? /m, '기록 본문의 # · ## 는 울타리 안까지 ### 로(기록 서식 칸 · kmd 칸으로 읽히지 않게)')
  assert.doesNotMatch(body, /숨김/)
  const late = seedAsIsDoc('a/b.md', 'intro\n\n## A\nx\n# Important line\ny')
  assert.deepEqual(late.sections.map((x) => x.heading), ['개요', 'A'])
  assert.match(late.sections[1].content, /### Important line/, '첫 줄이 아닌 # 줄은 제목으로 걷지 않는다')
  assert.equal(seedAsIsDoc('C#/%x.md', 'a').doc, 'C/x')
  assert.equal(seedAsIsDoc('.md', 'a').doc, '문서')
  const big = seedAsIsDoc('big.md', Array.from({ length: 7 }, (_, i) => `## h${i}\n${'가'.repeat(30)}`).join('\n'), { sections: 3, chars: 100 })
  assert.deepEqual(big.chunks.map((c) => c.sections.length), [2, 2, 2, 1], '덩이마다 항목 · 글자 한도')
  const huge = seedAsIsDoc('h.md', `## 큼\n${'나'.repeat(200)}\n## 작음\n짧다`, { sections: 50, chars: 100 })
  assert.equal(huge.chunks[0].too, true)
  assert.equal(huge.chunks[1].sections[0].heading, '작음')
})
