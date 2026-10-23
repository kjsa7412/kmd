// E1 필수 — 고침판(F1 · F4 · F12 · I7) · 예약 이름 · 태그 · 파일 · 주인 · 개인 가림 · 허용 백업 루트.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { makeHub, SHELL } from '../server/hub.js'
import { readStats } from '../core/knowledge.js'
import { copyDir } from './helpers.mjs'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture', 'kmd')
let tmp, s
const KIM = { user: '김' }
const ADMIN = { user: '이', admin: true }
const PARK = { user: '박' }
let rpcId = 0
async function tool(name, args) {
  const r = await fetch(s.url + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) })
  return (await r.json()).result
}
const commits = (id) => execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: path.join(tmp, 'kn', id), encoding: 'utf8' }).trim() * 1
const code = async (p) => p.then(() => 'ok', (e) => e.code)

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-e1-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  copyDir(FIX, path.join(tmp, 'kn'))
  s = await startServer({ root: path.join(tmp, 'kn'), user: '김', port: 0, log: () => {} })
})
after(async () => {
  await s?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('F1 — 머리 주입 · 날짜 모양 · 예약 이름 · 태그 · 파일은 받지 않는다', async () => {
  const h = s.hub
  const rec = (x) => ({ record: { title: '제목', body: '글', ...x } })
  assert.equal(await code(h.save(KIM, 'dpms', rec({ date: '2026-10-23\nbaseline: 가짜' }))), 'E_INPUT')
  assert.equal(await code(h.save(KIM, 'dpms', rec({ date: '어제' }))), 'E_INPUT')
  assert.equal(await code(h.save(KIM, 'dpms', rec({ title: '한 줄\nsnapshot: 가짜' }))), 'E_INPUT')
  assert.equal(await code(h.save(KIM, 'dpms', rec({ touches: ['proc:카나리\nid: x'] }))), 'E_INPUT')
  assert.equal(await code(h.save(KIM, 'dpms', rec({ tags: ['curate-auto'] }))), 'E_FORBIDDEN', '예약 태그')
  assert.equal(await code(h.save({ user: 'kmd-auto' }, 'dpms', rec({}))), 'E_FORBIDDEN', '예약 이름')
  assert.equal(await code(h.save(KIM, 'dpms', { ...rec({}), sections: [{ doc: '_members', heading: '가', content: '나' }] })), 'E_FORBIDDEN', '예약 파일')
  const r = await h.save(KIM, 'dpms', rec({ title: '따옴표 "와" 콜론: 이 든 제목', tags: ['배포'] }))
  const w = fs.readFileSync(path.join(tmp, 'kn', 'dpms', r.record), 'utf8')
  assert.match(w, /title: .*따옴표/)
})

test('F4 — 읽은 뒤 바뀐 항목은 덮지 않는다', async () => {
  const sec = (await tool('section', { knowledge: 'dpms', coord: 'proc:헬스 체크' })).structuredContent
  assert.match(sec.base, /^[0-9a-f]{16}$/)
  const put = (content, base) => tool('save', { knowledge: 'dpms', record: { title: '헬스 체크 — 고침', body: content }, sections: [{ coord: 'proc:헬스 체크', content, base }] })
  const n0 = commits('dpms')
  assert.ok(!(await put('3초 안에 200 · 고친 글', sec.base)).isError)
  const late = await put('늦게 온 글', sec.base)
  assert.equal(late.structuredContent.error, 'E_CONFLICT')
  assert.equal(commits('dpms'), n0 + 1, '늦은 저장은 묶음 0')
})

test('F12 — 캐시는 요청 밖 · 둘째 요청은 다시 읽지 않는다 · 저장 뒤엔 바뀐 파일만', async () => {
  await tool('brief', { knowledge: 'dpms' })
  const a = readStats.files
  await tool('section', { knowledge: 'dpms', coord: 'proc:카나리' })
  assert.ok(readStats.files - a <= 10, `둘째 요청 파일 읽기 ${readStats.files - a}`)
  await tool('save', { knowledge: 'dpms', record: { title: '카나리 — 메모', body: '메모' } })
  const b = readStats.files
  await tool('section', { knowledge: 'dpms', coord: 'proc:카나리' })
  assert.ok(readStats.files - b <= 3, `저장 뒤 파일 읽기 ${readStats.files - b}`)
})

test('I7 — 안 넣은 기록은 최신 8 · 날짜 순 · 넘친 수', async () => {
  for (let i = 1; i <= 12; i++) await s.hub.save(KIM, 'dpms', { record: { title: `준비 메모 ${i}`, body: `${i}`, touches: ['proc:준비'], date: `2026-10-22 10:${String(i).padStart(2, '0')}` } })
  const sec = (await tool('section', { knowledge: 'dpms', coord: 'proc:준비' })).structuredContent
  assert.equal(sec.notYetInDocs.length, 8)
  assert.equal(sec.notYetMore, 4)
  assert.deepEqual(sec.notYetInDocs.map((x) => x.title), [5, 6, 7, 8, 9, 10, 11, 12].map((i) => `준비 메모 ${i}`))
  const doc = await (await fetch(s.url + '/api/k/dpms/doc?d=' + encodeURIComponent('배포절차'))).json()
  assert.deepEqual(doc.sections.find((x) => x.h === '준비').pend.map((x) => x.title), sec.notYetInDocs.map((x) => x.title), '화면과 같은 고름')
})

test('주인 · 개인 — 관리자의 모두도 가린다 · _members.md 가 따라간다', async () => {
  const row = await s.hub.setOwner(SHELL, 'gdi', { owner: '박', private: true, curators: ['박'] })
  assert.equal(row.private, true)
  assert.match(fs.readFileSync(path.join(tmp, 'kn', 'gdi', '_members.md'), 'utf8'), /- 주인: 박\n- 개인: 예/)
  assert.equal(await code(s.hub.get('gdi', ADMIN)), 'E_FORBIDDEN')
  assert.equal(await code(s.hub.save(ADMIN, 'gdi', { record: { title: 'x', body: 'y' } })), 'E_FORBIDDEN')
  assert.deepEqual((await s.hub.visible(ADMIN)).map((k) => k.id), ['dpms'])
  assert.deepEqual((await s.hub.visible(PARK)).map((k) => k.id), ['dpms', 'gdi'])
  assert.equal(await code(s.hub.setOwner(KIM, 'gdi', { private: false })), 'E_FORBIDDEN', '주인이 아니면 못 바꾼다')
  // 세션(김)의 MCP 에서도 같은 판정
  assert.deepEqual((await tool('brief', {})).structuredContent.knowledge.map((k) => k.id), ['dpms'])
  assert.equal((await tool('section', { knowledge: 'gdi', doc: '공통코드' })).structuredContent.error, 'E_FORBIDDEN')
  // 깨진 장부면 서버가 뜨지 않는다(빈 것으로 읽어 가림이 풀리지 않게)
  const d2 = path.join(tmp, 'data2')
  fs.mkdirSync(d2)
  fs.writeFileSync(path.join(d2, 'owners.json'), '{깨짐')
  await assert.rejects(makeHub({ root: path.join(tmp, 'kn'), dataDir: d2 }), /owners\.json/)
})

test('허용 백업 루트 — 팀 서버는 허락된 폴더만 · 지식 안은 안 된다', async () => {
  assert.equal(await code(s.hub.backupAttach(ADMIN, 'dpms', path.join(tmp, 'elsewhere.git'))), 'E_FORBIDDEN')
  assert.equal(await code(s.hub.backupAttach(ADMIN, 'dpms', path.join(tmp, 'kn', 'dpms', 'b.git'))), 'E_INPUT')
  assert.equal(await code(s.hub.backupAttach(KIM, 'dpms', 'https://git.example/x.git')), 'E_FORBIDDEN', '관리자만')
  assert.equal(await code(s.hub.backupAttach(ADMIN, 'dpms', 'ext::sh -c touch% /tmp/x')), 'E_INPUT')
})
