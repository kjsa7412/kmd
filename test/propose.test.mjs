// 제안 — 기록할 때 쓴 항목 글(core/propose.js · 권한 모델 7절 · 작성기준 7절)
//
// 바꿀 곳 대기: 꼭 한 번 · 없음(가까운 줄) · 두 번 · 겹침 · 줄 끝 빈칸은 맞춰 보되 원문은 그대로 ·
// 검사(S4 · 저장 문): 지문(base) → E_CONFLICT · 값 더하기 · 옛 값 바꿈 · 문장 지움 모두 그 순간 넣는다(확인 대기 없음) ·
// 지어낸 값 · 빠진 값 → 저장 제안의 경고(승인이 받아들임) · 장부에 없는 항목은 문서 · 머리로

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { startServer } from '../server/http.js'
import { copyDir, signIn, seat } from './helpers.mjs'
import { applyEdits, validEdits, checkProposal } from '../core/propose.js'
import { mustValues } from '../core/values.js'
import { sha16 } from '../core/text.js'
import { sectionOf } from '../core/knowledge.js'
import { makeMcp } from '../server/mcp.js'
import { ensureRepo } from '../core/git.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s
const LEE = { user: 'lee' }

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-propose-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, inboxTickMs: 3600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  await signIn(s, { id: 'kim' })
  await s.auth.addUser({ id: 'lee', admin: false })
  await seat(s, 'lee', { dpms: 'write' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('바꿀 곳 대기: 꼭 한 번 · 없으면 가까운 줄 · 두 번은 거절 · 겹침 거절 · 줄 끝 빈칸은 맞춰 보되 원문은 그대로', () => {
  const t = '첫 줄은 10% 다.  \n둘째 줄은 그대로.\n셋째 줄은 1% 다.'
  const a = applyEdits(t, [{ find: '첫 줄은 10% 다.', replace: '첫 줄은 20% 다.' }])
  assert.equal(a.ok, true)
  assert.equal(a.text, '첫 줄은 20% 다.  \n둘째 줄은 그대로.\n셋째 줄은 1% 다.', '바꿀 곳 밖(둘째 줄 · 첫 줄의 끝 빈칸까지)은 원문 그대로')
  const b = applyEdits(t, [{ find: '셋째 줄은 1% 다.', replace: '셋째 줄은 2% 다.' }, { find: '첫 줄은 10% 다.', replace: '첫 줄은 20% 다.' }])
  assert.equal(b.text, '첫 줄은 20% 다.  \n둘째 줄은 그대로.\n셋째 줄은 2% 다.', '바꿀 곳 차례와 상관없이 원문 자리로')
  const none = applyEdits(t, [{ find: '첫 줄은 15% 다.', replace: 'x' }])
  assert.equal(none.ok, false)
  assert.match(none.why, /1째 바꿀 곳을 댈 수 없다: 지금 글에 없다/)
  assert.equal(none.near, '첫 줄은 10% 다.', '세션이 다시 맞출 가까운 줄')
  assert.match(applyEdits(t, [{ find: '줄은', replace: 'x' }]).why, /두 번 넘게/)
  assert.match(applyEdits(t, [{ find: '첫 줄은 10%', replace: 'a' }, { find: '10% 다.', replace: 'b' }]).why, /겹친다/)
  assert.match(validEdits([]).why, /바꿀 곳이 없다/)
  assert.match(validEdits([{ find: 'a', replace: 'b', extra: 1 }]).why, /모르는 칸/)
  assert.match(validEdits([{ find: ' ', replace: 'b' }]).why, /find 가 비었다/)
})

test('검사: 지문이 다르면 stale(conflict) · 값 더하기 · 옛 값 바꿈(changed) · 문장 지움 모두 넘는다(확인 대기 없음 · K-D13) · 지어낸 값 · 빠진 값은 거절(values)', async () => {
  const k = await s.hub.get('dpms')
  const coord = 'proc:카나리'
  const cur = sectionOf(k, coord).sec.body
  const base = sha16(cur)
  const rec = (body) => ({ title: '카나리', body })
  const st = checkProposal(k, { coord, base: 'deadbeefdeadbeef', edits: [{ find: '10%', replace: '20%' }], record: rec('비율: 10% → 20%') })
  assert.deepEqual([st.ok, st.code, st.stale], [false, 'conflict', true])
  assert.match(st.why, /그사이 항목이 바뀌었다/)
  // 값 더하기
  const add = checkProposal(k, { coord, base, edits: [{ find: '롤백으로 간다.', replace: '롤백으로 간다. 지켜보는 시간은 30분이다.' }], record: rec('## 바뀐 것\n- 지켜보는 시간: 30분') })
  assert.equal(add.ok, true, add.why)
  assert.equal(add.waits, undefined, '확인 대기는 걷었다')
  assert.deepEqual(add.changed, [])
  assert.match(add.text, /지켜보는 시간은 30분이다/)
  // 옛 값을 바꿨다 — 넘는다 · 바뀐 값은 changed(이력에 옛 값 → 새 값)
  const chg = checkProposal(k, { coord, base, edits: [{ find: '요청의 10% 만', replace: '요청의 20% 만' }], record: rec('## 바뀐 것\n- 첫 30분 비율: 10% → 20%') })
  assert.equal(chg.ok, true, chg.why)
  assert.match(chg.changed[0].from, /10%/)
  assert.match(chg.changed[0].to, /20%/)
  // 값이 든 문장을 지웠다 — 기록이 그 옛 값을 말하지 않으면 거절(옛 글의 값이 빠졌다) · 말했으면 넘는다
  const lost = checkProposal(k, { coord, base, edits: [{ find: ' 오류율이 1% 를 넘으면 멈추고 롤백으로 간다.', replace: '' }], record: rec('## 바뀐 것\n- 뺌: 오류율 규칙은 롤백 항목으로') })
  assert.deepEqual([lost.ok, lost.code], [false, 'values'])
  assert.match(lost.why, /옛 글의 값이 빠졌다: 1%/)
  const del = checkProposal(k, { coord, base, edits: [{ find: ' 오류율이 1% 를 넘으면 멈추고 롤백으로 간다.', replace: '' }], record: rec('## 바뀐 것\n- 오류율 규칙: 1% → 없음(롤백 항목으로)') })
  assert.equal(del.ok, true, del.why)
  // 값 없는 문장을 지웠다 — 넘는다
  assert.equal(checkProposal(k, { coord, base, edits: [{ find: '멈추고 롤백으로 간다.', replace: '멈춘다.' }], record: rec('## 바뀐 것\n- 뺌: 롤백 안내는 롤백 항목으로') }).ok, true)
  // 지어낸 값 — 기록에도 지금 글에도 없는 값
  const inv = checkProposal(k, { coord, base, edits: [{ find: '롤백으로 간다.', replace: '롤백으로 간다. 알림은 `pager-9` 로.' }], record: rec('## 바뀐 것\n- 알림 추가') })
  assert.deepEqual([inv.ok, inv.code], [false, 'values'])
  assert.match(inv.why, /근거에 없는 값/)
  // 기록의 값이 항목 글에 없다 · 여러 항목에 나뉘면(spread) 항목 하나에서는 묻지 않는다(저장 문이 합쳐서 본다)
  const miss = { coord, base, edits: [{ find: '롤백으로 간다.', replace: '롤백으로 간다. 알림을 보낸다.' }], record: rec('## 바뀐 것\n- 알림 간격: 5분') }
  assert.match(checkProposal(k, miss).why, /기록의 값이 글에 없다: 5분/)
  assert.equal(checkProposal(k, { ...miss, spread: true }).ok, true)
  // 바꿀 곳이 맞지 않으면 edits · 없는 항목이면 notfound
  assert.deepEqual([checkProposal(k, { coord, base, edits: [{ find: '없는 글', replace: 'x' }], record: rec('x') }).code], ['edits'])
  assert.equal(checkProposal(k, { coord: 'proc:없는것', base, edits: [{ find: 'a', replace: 'b' }], record: rec('x') }).code, 'notfound')
  // 장부에 없는 항목도 문서 · 머리로(S-D55)
  const byDoc = checkProposal(k, { doc: '배포절차', heading: '카나리', base, edits: [{ find: '요청의 10% 만', replace: '요청의 20% 만' }], record: rec('## 바뀐 것\n- 첫 30분 비율: 10% → 20%') })
  assert.equal(byDoc.ok, true, byDoc.why)
})

test('「고친 조각」 머리: 값 검사는 이 칸을 값으로 치지 않는다 · 새 입력의 그 머리는 E_INPUT', async () => {
  const ps = [{ coord: 'proc:카나리', base: 'ab12', edits: [{ find: '10%', replace: '20%' }], waits: 'review' }]
  const part = '## 고친 조각\n```json\n' + JSON.stringify(ps, null, 1) + '\n```'
  const body = `## 바뀐 것\n- 비율: 10% → 20%\n\n${part}`
  assert.deepEqual(mustValues(body).sort(), ['20%'], '옛 칸 속 값(ab12 · 10%)은 요구하지 않는다')
  const e = await s.hub.save(LEE, 'dpms', { record: { title: '카나리: 칸 흉내', body, touches: ['proc:카나리'] } }).then(() => null, (x) => x)
  assert.equal(e?.code, 'E_INPUT')
  assert.match(e.message, /「## 고친 조각」 머리는 kmd 가 쓴다/)
})

test('장부에 없는 항목에 문서 · 머리로 바꿀 곳 · 새 항목은 content 로', async () => {
  const k = await s.hub.get('dpms')
  const d = k.docs.find((x) => x.id === '배포절차')
  const sec = d.sections.find((x) => x.h === '헬스 체크')
  const r = await s.hub.save(LEE, 'dpms', { record: { title: '헬스 체크: 결과 남기기', body: '## 바뀐 것\n- 헬스 체크 결과: 운영 채널에 남긴다' }, sections: [{ doc: '배포절차', heading: '헬스 체크', base: sha16(sec.body), edits: [{ find: '이것으로 본다.', replace: '이것으로 본다. 결과는 운영 채널에 남긴다.' }] }, { doc: '배포절차', heading: '테스트 새 항목', content: '새 항목은 결과 채널을 따로 둔다.' }] })
  assert.deepEqual(r.proposals.map((p) => [p.ok, p.applied]), [[true, true], [true, true]], JSON.stringify(r.proposals))
  assert.equal(r.put, 2)
  const doc = fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '배포절차.md'), 'utf8')
  assert.match(doc, /결과는 운영 채널에 남긴다\./)
  assert.match(doc, /## 테스트 새 항목\n/)
  assert.match(fs.readFileSync(path.join(tmp, 'kn', 'dpms', r.record), 'utf8'), /- docs\/배포절차\.md › 테스트 새 항목 \(새 항목\)/)
})

