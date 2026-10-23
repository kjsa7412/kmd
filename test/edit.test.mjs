// E4 필수 — 저장이 곧 반영 · 거두기 · 결정 규칙 · 되돌리기 · 팀 지식의 기록 길.
//
// 한 save → 대기 0 · 옛 날짜 고친 기록 → 거절 · 손 편집 → 고요 뒤 묶음 1 · 이름을 빠뜨린 기록 → 저절로 두기 0 · 일감 1 ·
// 사람이 답한 기록만 두기 · 좌표정정은 서버가 구조로 판정 · 되돌리면 원 기록이 다시 대기 · 주인이 아니면 기록으로.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import * as collect from '../core/collect.js'
import { HUMAN_ANSWER } from '../core/curate.js'
import { copyDir } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s
const KIM = { user: 'kim', admin: true }
const LEE = { user: 'lee' }
const code = async (p) => p.then(() => 'ok', (e) => e.code)
const G = (dir, ...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: dir, encoding: 'utf8' }).trim()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const stateOf = async (srv, kn, id) => (await srv.hub.get(kn)).byWork.get(id)?.state

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-e4-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
})
after(async () => {
  await s?.close()
  // Windows — 감시 손잡이가 늦게 풀려 지우기가 EBUSY 일 때가 있다(임시 폴더라 남겨도 된다)
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('저장이 곧 반영 — 한 save → 대기 0 · 옛 날짜 고친 기록은 거절', async () => {
  const r = await s.hub.save(KIM, 'dpms', { record: { title: '롤백 — 앱 먼저', body: '앱을 먼저 내린다.' }, sections: [{ coord: 'proc:롤백', content: '앱을 먼저 이전 판으로 내리고, 그다음 DB 를 되돌린다.' }] })
  assert.equal(await stateOf(s, 'dpms', r.id), 'in')
  const old = await code(s.hub.save(KIM, 'dpms', { record: { title: '헬스 체크 — 옛 날짜 고침', body: 'x', tags: ['edit'], date: '2026-01-02' }, sections: [{ coord: 'proc:헬스 체크', content: '옛 글' }] }, { system: true }))
  assert.equal(old, 'E_CONFLICT')
})

test('팀 지식 — 주인 · 정리하는 사람이 아니면 항목 글은 기록에 실려 정리를 기다린다', async () => {
  const before = fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '운영.md'), 'utf8')
  const r = await s.hub.save(LEE, 'dpms', { record: { title: '알람 — 당번 채널도', body: '#ops-oncall 도 받는다.' }, sections: [{ coord: 'term:알람', content: 'CPU 경고는 85% 에서 울린다. 받는 곳은 #ops-alert · #ops-oncall.' }] })
  assert.equal(r.queued, true)
  assert.equal(fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '운영.md'), 'utf8'), before, '문서는 그대로')
  assert.equal(await stateOf(s, 'dpms', r.id), 'pend')
  const w = fs.readFileSync(path.join(tmp, 'kn', 'dpms', r.record), 'utf8')
  assert.match(w, /## 알람\n.*#ops-oncall/)
  // 화면 고치기도 같은 길
  const d = await s.hub.edit(LEE, 'dpms', { doc: '서버목록', sections: [{ h: '점검 시간', body: '정기 점검은 매달 둘째 토요일.' }] })
  assert.equal(d.direct, false)
  const k = await s.hub.edit(KIM, 'dpms', { doc: '서버목록', sections: [{ h: '운영 서버', body: 'app-1 ~ app-5 · canary-1.' }] })
  assert.equal(k.direct, true)
  assert.match(fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '서버목록.md'), 'utf8'), new RegExp(`<!-- applied: ${k.id} -->\\napp-1 ~ app-5`))
})

test('결정 규칙 — 이름을 빠뜨린 기록은 두지 않고 일감 · 사람이 답한 것만 두기 · 좌표정정은 구조로', async () => {
  const a = await s.hub.save(KIM, 'dpms', { record: { title: '어디에 넣을지 모르는 메모', body: '서버 이름 규칙을 바꾸자는 이야기.' } })
  const b = await s.hub.save(KIM, 'dpms', { record: { title: '넣을 곳 없음 — 회의 잡담', body: `커피 이야기.\n${HUMAN_ANSWER}` } })
  // 좌표정정 — 앞 기록(헬스 체크 주소 /healthz)의 이름만 바로잡는 짧은 글 → 서버가 touches-fix 를 붙인다
  const fix = await s.hub.save(KIM, 'dpms', { record: { title: '이름 바로잡음', body: '/healthz 이야기는 헬스 체크 항목이다.', touches: ['proc:헬스 체크'], fixes: ['2026-1020-헬스-체크-주소'] } })
  const fresh = await s.hub.save(KIM, 'dpms', { record: { title: '새 값이 든 정정', body: '시간 초과는 5초 로 바꾼다.', touches: ['proc:헬스 체크'], fixes: ['2026-1021-헬스-체크'] } })
  const kk = await s.hub.get('dpms')
  assert.ok(kk.byWork.get(fix.id).tags.includes('touches-fix'))
  assert.ok(!kk.byWork.get(fresh.id).tags.includes('touches-fix'), '새 값이 든 정정은 아니다')
  assert.equal(await code(s.hub.save(KIM, 'dpms', { record: { title: 'x', body: 'y', tags: ['touches-fix'] } })), 'E_FORBIDDEN')
  const r = await s.hub.decide('dpms')
  const k2 = await s.hub.get('dpms')
  assert.equal(k2.byWork.get(a.id).state, 'nowhere', '세션이 이름을 빠뜨린 기록 → 저절로 두지 않는다')
  assert.equal(k2.byWork.get(b.id).state, 'kept')
  assert.equal(k2.byWork.get(fix.id).state, 'kept')
  assert.notEqual(k2.byWork.get(fresh.id).state, 'kept', '새 값이 든 정정 기록 → 저절로 두기 0')
  assert.ok(r.tasks >= 1, '이름 바로잡기 일감')
  const dec = k2.works.find((w) => w.tags.includes('curate-auto') && w.curates.length)
  assert.equal(dec.author, 'kmd-auto')
})

test('되돌리기 — 옛 본문 + 판정 거두기 · 원 기록은 다시 대기', async () => {
  const doc = path.join(tmp, 'kn', 'dpms', 'docs', '배포절차.md')
  const r = await s.hub.save(KIM, 'dpms', { record: { title: '카나리 — 20%', body: '첫 30분은 20%.', touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', content: '`canary-1` 에 먼저 올리고, 첫 30분은 요청의 20% 만 보낸다.' }] })
  assert.match(fs.readFileSync(doc, 'utf8'), /요청의 20%/)
  await s.hub.revert(KIM, 'dpms', { record: r.id })
  const t = fs.readFileSync(doc, 'utf8')
  assert.match(t, /요청의 10% 만 보낸다/)
  assert.match(t, /<!-- applied: 2026-1017-카나리 -->/)
  const k = await s.hub.get('dpms')
  assert.equal(k.byWork.get(r.id).state, 'pend', '되돌린 기록은 다시 아직 안 넣은 기록')
  assert.ok(k.reverted.has(r.id), '주인이 되돌림 — 다시 초안하지 않는다')
})

test('거두기 — 편집기로 고친 문서는 고요 뒤 묶음 1 · 기록 손 고침은 되돌린다', async () => {
  collect.configure({ quietMs: 300 })
  const pc = await startServer({ root: path.join(tmp, 'kn'), data: path.join(tmp, 'pcdata'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const dir = path.join(tmp, 'kn', 'dpms')
    const n0 = Number(G(dir, 'rev-list', '--count', 'HEAD'))
    const f = path.join(dir, 'docs', '접속안내.md')
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('사내 VPN 뒤에서만 열린다.', '사내 VPN 뒤에서만 열린다. 집에서는 OTP 를 쓴다.'))
    const rec = path.join(dir, 'work', '2026-1021-배포-창.md')
    const recBefore = fs.readFileSync(rec, 'utf8')
    fs.appendFileSync(rec, '\n손으로 고친 줄\n')
    let n = n0
    for (let i = 0; i < 100 && n === n0; i++) {
      await wait(100)
      n = Number(G(dir, 'rev-list', '--count', 'HEAD'))
    }
    assert.equal(n, n0 + 1, '묶음 1')
    assert.equal(G(dir, 'status', '--porcelain'), '', '트리 깨끗')
    assert.equal(fs.readFileSync(rec, 'utf8'), recBefore, '기록의 손 고침은 되돌렸다')
    await wait(200) // 묶음 뒤 캐시를 걷는 것까지
    pc.hub.forget('dpms')
    const k = await pc.hub.get('dpms')
    const w = k.works.find((x) => x.tags.includes('edit') && x.title.startsWith('편집기에서 고침'))
    assert.equal(w.author, 'kim')
    assert.deepEqual(w.touches, ['term:VPN'])
    assert.equal(w.state, 'in', '자기 반영 — 아직 안 넣은 기록이 생기지 않는다')
  } finally {
    await pc.close()
  }
})
