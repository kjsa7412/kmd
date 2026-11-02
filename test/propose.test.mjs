// 제안 — 기록할 때 쓴 항목 조각(core/propose.js · 권한 모델 7절 · 작성기준 7절)
//
// 조각 대기: 꼭 한 번 · 없음(가까운 줄) · 두 번 · 겹침 · 줄 끝 빈칸은 맞춰 보되 원문은 그대로 ·
// 검사: 지문(base) · 섞인 자리 · 값 더하기 → apply · 옛 값 바꿈 → review(changed) · 값 없는 문장 지움 → review · 지어낸 값 → 거절

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { copyDir, signIn, seat } from './helpers.mjs'
import { applyEdits, validEdits, checkProposal, renderProposals, parseProposals } from '../core/propose.js'
import { mustValues } from '../core/tidy.js'
import { sha16 } from '../core/text.js'
import { sectionOf } from '../core/knowledge.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s
const LEE = { user: 'lee' }

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-propose-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, tidyTickMs: 3600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  await signIn(s, { id: 'kim' })
  await s.auth.addUser({ id: 'lee', admin: false })
  await seat(s, 'lee', { dpms: 'write' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('조각 대기: 꼭 한 번 · 없으면 가까운 줄 · 두 번은 거절 · 겹침 거절 · 줄 끝 빈칸은 맞춰 보되 원문은 그대로', () => {
  const t = '첫 줄은 10% 다.  \n둘째 줄은 그대로.\n셋째 줄은 1% 다.'
  const a = applyEdits(t, [{ find: '첫 줄은 10% 다.', replace: '첫 줄은 20% 다.' }])
  assert.equal(a.ok, true)
  assert.equal(a.text, '첫 줄은 20% 다.  \n둘째 줄은 그대로.\n셋째 줄은 1% 다.', '조각 밖(둘째 줄 · 첫 줄의 끝 빈칸까지)은 원문 그대로')
  const b = applyEdits(t, [{ find: '셋째 줄은 1% 다.', replace: '셋째 줄은 2% 다.' }, { find: '첫 줄은 10% 다.', replace: '첫 줄은 20% 다.' }])
  assert.equal(b.text, '첫 줄은 20% 다.  \n둘째 줄은 그대로.\n셋째 줄은 2% 다.', '조각 차례와 상관없이 원문 자리로')
  const none = applyEdits(t, [{ find: '첫 줄은 15% 다.', replace: 'x' }])
  assert.equal(none.ok, false)
  assert.match(none.why, /1째 조각을 댈 수 없다: 지금 글에 없다/)
  assert.equal(none.near, '첫 줄은 10% 다.', '세션이 다시 맞출 가까운 줄')
  assert.match(applyEdits(t, [{ find: '줄은', replace: 'x' }]).why, /두 번 넘게/)
  assert.match(applyEdits(t, [{ find: '첫 줄은 10%', replace: 'a' }, { find: '10% 다.', replace: 'b' }]).why, /겹친다/)
  assert.match(validEdits([]).why, /조각이 없다/)
  assert.match(validEdits([{ find: 'a', replace: 'b', extra: 1 }]).why, /모르는 칸/)
  assert.match(validEdits([{ find: ' ', replace: 'b' }]).why, /find 가 비었다/)
})

test('검사: 지문이 다르면 stale · 값 더하기는 apply · 옛 값 바꿈은 review(changed) · 값 없는 문장 지움은 review · 지어낸 값은 거절', async () => {
  const k = await s.hub.get('dpms')
  const coord = 'proc:카나리'
  const cur = sectionOf(k, coord).sec.body
  const base = sha16(cur)
  const rec = (body) => ({ id: 'x-제안', date: '2026-11-02', author: 'lee', title: '카나리', body })
  assert.match(checkProposal(k, { coord, base: 'deadbeefdeadbeef', edits: [{ find: '10%', replace: '20%' }], record: rec('비율: 10% → 20%') }).why, /그사이 항목이 바뀌었다/)
  // 값 더하기만 — 바로 넣는다
  const add = checkProposal(k, { coord, base, edits: [{ find: '롤백으로 간다.', replace: '롤백으로 간다. 지켜보는 시간은 30분이다.' }], record: rec('## 바뀐 것\n- 지켜보는 시간: 30분') })
  assert.equal(add.ok, true, add.why)
  assert.equal(add.waits, 'apply')
  assert.match(add.text, /지켜보는 시간은 30분이다/)
  // 옛 값을 바꿨다 — 지식관리자 확인
  const chg = checkProposal(k, { coord, base, edits: [{ find: '요청의 10% 만', replace: '요청의 20% 만' }], record: rec('## 바뀐 것\n- 첫 30분 비율: 10% → 20%') })
  assert.equal(chg.ok, true, chg.why)
  assert.equal(chg.waits, 'review')
  assert.match(chg.changed[0].from, /10%/)
  assert.match(chg.changed[0].to, /20%/)
  // 값이 든 문장을 지웠다 — 기록이 그 옛 값을 말하지 않으면 거절(옛 글의 값이 빠졌다) · 말했으면 확인 대기
  assert.match(checkProposal(k, { coord, base, edits: [{ find: ' 오류율이 1% 를 넘으면 멈추고 롤백으로 간다.', replace: '' }], record: rec('## 바뀐 것\n- 뺌: 오류율 규칙은 롤백 항목으로') }).why, /옛 글의 값이 빠졌다: 1%/)
  const del = checkProposal(k, { coord, base, edits: [{ find: ' 오류율이 1% 를 넘으면 멈추고 롤백으로 간다.', replace: '' }], record: rec('## 바뀐 것\n- 오류율 규칙: 1% → 없음(롤백 항목으로)') })
  assert.equal(del.ok, true, del.why)
  assert.equal(del.waits, 'review')
  // 값 없는 문장을 지웠다 — 확인 대기
  const del2 = checkProposal(k, { coord, base, edits: [{ find: '멈추고 롤백으로 간다.', replace: '멈춘다.' }], record: rec('## 바뀐 것\n- 뺌: 롤백 안내는 롤백 항목으로') })
  assert.equal(del2.ok, true, del2.why)
  assert.equal(del2.waits, 'review')
  // 지어낸 값 — 기록에도 지금 글에도 없는 값
  assert.match(checkProposal(k, { coord, base, edits: [{ find: '롤백으로 간다.', replace: '롤백으로 간다. 알림은 `pager-9` 로.' }], record: rec('## 바뀐 것\n- 알림 추가') }).why, /근거에 없는 값/)
  // 기록의 값이 조각에 없다
  assert.match(checkProposal(k, { coord, base, edits: [{ find: '롤백으로 간다.', replace: '롤백으로 간다. 알림을 보낸다.' }], record: rec('## 바뀐 것\n- 알림 간격: 5분') }).why, /기록의 값이 글에 없다: 5분/)
})

test('「고친 조각」 칸: 기록 본문에 넣고 다시 읽는다 · 모양이 아니면 빈 목록 · 값 검사는 이 칸을 값으로 치지 않는다', () => {
  const ps = [{ coord: 'proc:카나리', base: 'ab12', edits: [{ find: '10%', replace: '20%' }], waits: 'review' }]
  const part = renderProposals(ps)
  assert.match(part, /^## 고친 조각\n```json\n/)
  const body = `## 바뀐 것\n- 비율: 10% → 20%\n\n${part}`
  assert.deepEqual(parseProposals(body), ps)
  assert.deepEqual(parseProposals('## 고친 조각\n```json\n[{"coord":1}]\n```'), [])
  assert.deepEqual(parseProposals('글만'), [])
  assert.deepEqual(mustValues(body).sort(), ['20%'], '조각 속 값(ab12 · 10%)은 요구하지 않는다')
  assert.equal(renderProposals([]), '')
})

test('섞인 자리: 같은 항목에 먼저 온 기록(제안 없음)이 있으면 결정적으로 넣지 않는다', async () => {
  await s.hub.save(LEE, 'dpms', { record: { title: '카나리 메모', body: '## 바뀐 것\n- 메모: 지켜본다', touches: ['proc:카나리'] } })
  const k = await s.hub.get('dpms')
  const cur = sectionOf(k, 'proc:카나리').sec.body
  const r = checkProposal(k, { coord: 'proc:카나리', base: sha16(cur), edits: [{ find: '롤백으로 간다.', replace: '롤백으로 간다. 지켜보는 시간은 30분이다.' }], record: { id: 'x-제안2', date: '2026-11-02', author: 'lee', title: '카나리', body: '## 바뀐 것\n- 지켜보는 시간: 30분' } })
  assert.equal(r.ok, false)
  assert.equal(r.mixed, true)
  assert.equal(r.others.length, 1)
})
