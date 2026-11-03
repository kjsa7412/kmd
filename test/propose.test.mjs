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

test('저장 길(hub.save · 쓰기 자리): 조각은 검사해 기록 「고친 조각」 칸에 싣고 proposals 로 답한다 · 걸려도 기록은 남는다 · base 없으면 거절', async () => {
  const k0 = await s.hub.get('dpms')
  const coord = 'proc:헬스 체크'
  const base = sha16(sectionOf(k0, coord).sec.body)
  const r = await s.hub.save(LEE, 'dpms', { record: { title: '헬스 체크: 시간 초과', body: '## 바뀐 것\n- 시간 초과: 3초 → 5초', touches: [coord] }, sections: [{ coord, base, edits: [{ find: '시간 초과는 3초', replace: '시간 초과는 5초' }] }] }, { queue: true })
  assert.equal(r.queued, true)
  assert.equal(r.proposals.length, 1)
  assert.equal(r.proposals[0].ok, true, r.proposals[0].why)
  // 「3초」 가 글에 두 번 있어 하나만 고쳤다 — 값이 빠지지 않아 apply(저장 즉시 넣음) 지만 옛 값이 남았다고 알린다
  assert.equal(r.proposals[0].waits, 'apply')
  assert.match(r.proposals[0].warnings[0], /옛 값 3초 이 글에 아직 남아 있다/)
  assert.equal(r.proposals[0].applied, true, r.proposals[0].why)
  let k = await s.hub.get('dpms')
  assert.equal(k.byWork.get(r.id).state, 'in', '저장하는 순간 넣었다')
  assert.deepEqual(parseProposals(k.byWork.get(r.id).body).map((p) => [p.coord, p.waits]), [[coord, 'apply']])
  const doc = fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '배포절차.md'), 'utf8')
  assert.match(doc, /시간 초과는 5초 — 3초 안에/)
  const put = k.byWork.get(r.proposals[0].record)
  assert.ok(put.tags.includes('curate-llm') && put.tags.includes('curate-proposal') && put.reflects.includes(r.id), '정리와 같은 꼴(되돌리기가 듣는다)')
  // 걸린 조각 — 기록은 남고 제안만 거절(지문이 바뀌었다 · 가까운 줄)
  const bad = await s.hub.save(LEE, 'dpms', { record: { title: '헬스 체크: 주기', body: '## 바뀐 것\n- 주기: 30초 → 20초', touches: [coord] }, sections: [{ coord, base, edits: [{ find: '/health 를 30초마다 부른다', replace: '/health 를 20초마다 부른다' }] }] }, { queue: true })
  assert.equal(bad.proposals[0].ok, false)
  assert.match(bad.proposals[0].why, /그사이 항목이 바뀌었다/)
  assert.equal(bad.proposals[0].stale, true)
  assert.ok((await s.hub.get('dpms')).byWork.get(bad.id), '기록은 남는다')
  // 확인 대기 — 옛 값을 바꾼 제안은 문서에 들어가지 않고, 지식관리자가 넣는다
  k = await s.hub.get('dpms')
  const pb = sha16(sectionOf(k, 'proc:준비').sec.body)
  const rv = await s.hub.save(LEE, 'dpms', { record: { title: '준비: 커넥션 풀', body: '## 바뀐 것\n- DB 커넥션 풀: 40 → 60', touches: ['proc:준비'] }, sections: [{ coord: 'proc:준비', base: pb, edits: [{ find: '커넥션 풀은 40 으로', replace: '커넥션 풀은 60 으로' }] }] }, { queue: true })
  assert.equal(rv.proposals[0].waits, 'review')
  assert.equal(rv.proposals[0].applied, undefined)
  assert.equal((await s.hub.get('dpms')).byWork.get(rv.id).state, 'pend')
  assert.deepEqual((await s.hub.applyProposals('dpms', rv.id)).rows.map((x) => x.kind), ['wait'], '확인 없이는 넣지 않는다')
  // 정리 화면의 반영 대기 줄(A8) — 나무 기록 줄에 「제안 있음」 수 · 확인 대기 수
  const { tree } = await import('../server/views.js')
  assert.deepEqual(tree(await s.hub.get('dpms')).records.find((x) => x.id === rv.id).prop, { n: 1, review: 1 })
  const ap = await s.hub.applyProposals('dpms', rv.id, { force: true, by: 'kim' })
  assert.equal(ap.rows[0].kind, 'changed', ap.rows[0].why)
  assert.match(ap.rows[0].from, /40/)
  assert.match(fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '배포절차.md'), 'utf8'), /커넥션 풀은 60 으로/)
  assert.equal((await s.hub.get('dpms')).byWork.get(rv.id).state, 'in')
  await assert.rejects(s.hub.save(LEE, 'dpms', { record: { title: 'x', body: '## 바뀐 것\n- a: 1', touches: [coord] }, sections: [{ coord, edits: [{ find: 'a', replace: 'b' }] }] }, { queue: true }), /base/)
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

test('지식관리자의 제안: 옛 값을 바꿔도 검사를 넘으면 저장하는 순간 넣는다(권한 모델 7절) · 쓰기 자리는 그대로 확인 대기', async () => {
  const KIM = { user: 'kim', admin: true }
  const k = await s.hub.get('dpms')
  const pb = sha16(sectionOf(k, 'proc:준비').sec.body)
  const r = await s.hub.save(KIM, 'dpms', { record: { title: '준비: 커넥션 풀 80', body: '## 바뀐 것\n- DB 커넥션 풀: 60 → 80', touches: ['proc:준비'] }, sections: [{ coord: 'proc:준비', base: pb, edits: [{ find: '커넥션 풀은 60 으로', replace: '커넥션 풀은 80 으로' }] }] }, { queue: true })
  assert.equal(r.queued, true, '팀 MCP 저장은 지식관리자도 기록으로')
  assert.equal(r.proposals[0].waits, 'apply')
  assert.match(fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '배포절차.md'), 'utf8'), /커넥션 풀은 80 으로/)
  assert.equal((await s.hub.get('dpms')).byWork.get(r.id).state, 'in')
})
