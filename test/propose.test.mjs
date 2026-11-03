// 제안 — 기록할 때 쓴 항목 조각(core/propose.js · 권한 모델 7절 · 작성기준 7절)
//
// 조각 대기: 꼭 한 번 · 없음(가까운 줄) · 두 번 · 겹침 · 줄 끝 빈칸은 맞춰 보되 원문은 그대로 ·
// 검사(S4 · 저장 문): 지문(base) → E_CONFLICT · 섞인 자리 → legacy-mix · 값 더하기 · 옛 값 바꿈 · 문장 지움 모두 그 순간 넣는다(확인 대기 없음) ·
// 지어낸 값 · 빠진 값 → 그 조각만 넣지 못함(기록은 남는다) · 이름 없는 항목은 문서 · 머리로

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { startServer } from '../server/http.js'
import { copyDir, signIn, seat } from './helpers.mjs'
import { applyEdits, validEdits, checkProposal, renderProposals, parseProposals } from '../core/propose.js'
import { mustValues } from '../core/tidy.js'
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
  // 기록의 값이 조각에 없다 · 여러 항목에 나뉘면(spread) 항목 하나에서는 묻지 않는다(저장 문이 합쳐서 본다)
  const miss = { coord, base, edits: [{ find: '롤백으로 간다.', replace: '롤백으로 간다. 알림을 보낸다.' }], record: rec('## 바뀐 것\n- 알림 간격: 5분') }
  assert.match(checkProposal(k, miss).why, /기록의 값이 글에 없다: 5분/)
  assert.equal(checkProposal(k, { ...miss, spread: true }).ok, true)
  // 조각이 맞지 않으면 edits · 섞인 자리면 legacy-mix · 없는 항목이면 notfound
  assert.deepEqual([checkProposal(k, { coord, base, edits: [{ find: '없는 글', replace: 'x' }], record: rec('x') }).code], ['edits'])
  assert.equal(checkProposal(k, { ...miss, spread: true, legacyPend: ['2026-0101-옛-기록'] }).code, 'legacy-mix')
  assert.equal(checkProposal(k, { coord: 'proc:없는것', base, edits: [{ find: 'a', replace: 'b' }], record: rec('x') }).code, 'notfound')
  // 이름이 없는 항목도 문서 · 머리로(S-D55)
  const byDoc = checkProposal(k, { doc: '배포절차', heading: '카나리', base, edits: [{ find: '요청의 10% 만', replace: '요청의 20% 만' }], record: rec('## 바뀐 것\n- 첫 30분 비율: 10% → 20%') })
  assert.equal(byDoc.ok, true, byDoc.why)
})

test('옛 「고친 조각」 칸: 옛 기록 읽기는 그대로 · 값 검사는 이 칸을 값으로 치지 않는다 · 새 입력의 그 머리는 E_INPUT', async () => {
  const ps = [{ coord: 'proc:카나리', base: 'ab12', edits: [{ find: '10%', replace: '20%' }], waits: 'review' }]
  const part = renderProposals(ps)
  assert.match(part, /^## 고친 조각\n```json\n/)
  const body = `## 바뀐 것\n- 비율: 10% → 20%\n\n${part}`
  assert.deepEqual(parseProposals(body), ps)
  assert.deepEqual(parseProposals('## 고친 조각\n```json\n[{"coord":1}]\n```'), [])
  assert.deepEqual(parseProposals('글만'), [])
  assert.deepEqual(mustValues(body).sort(), ['20%'], '조각 속 값(ab12 · 10%)은 요구하지 않는다')
  assert.equal(renderProposals([]), '')
  const e = await s.hub.save(LEE, 'dpms', { record: { title: '카나리: 칸 흉내', body, touches: ['proc:카나리'] } }).then(() => null, (x) => x)
  assert.equal(e?.code, 'E_INPUT')
  assert.match(e.message, /「## 고친 조각」 머리는 kmd 가 쓴다/)
})

test('저장 길(hub.save · 쓰기 자리): 값을 바꾸는 조각도 검사를 넘으면 그 순간 문서에 · 기록과 문서가 커밋 하나 · 그 기록이 표지 · stale 이면 E_CONFLICT 로 아무것도 안 쓴다', async () => {
  const dir = path.join(tmp, 'kn', 'dpms')
  const G = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: dir, encoding: 'utf8' }).trim()
  const k0 = await s.hub.get('dpms')
  const coord = 'proc:준비'
  const base = sha16(sectionOf(k0, coord).sec.body)
  await ensureRepo(dir) // 처음 저장 전이면 처음 묶음을 먼저(묶음 수를 셀 수 있게)
  const n0 = Number(G('rev-list', '--count', 'HEAD'))
  const r = await s.hub.save(LEE, 'dpms', { record: { title: '준비: 커넥션 풀', body: '## 바뀐 것\n- DB 커넥션 풀: 40 → 60', touches: [coord] }, sections: [{ coord, base, edits: [{ find: '커넥션 풀은 40 으로', replace: '커넥션 풀은 60 으로' }] }] }, { channel: 'session' })
  assert.equal(r.proposals.length, 1)
  assert.deepEqual([r.proposals[0].ok, r.proposals[0].applied], [true, true], r.proposals[0].why)
  assert.equal(r.proposals[0].waits, undefined)
  assert.match(r.proposals[0].changed[0].from, /40/)
  assert.deepEqual([r.put, r.held], [1, undefined])
  assert.match(r.note, /넣음 1 · 넣지 못함 0/)
  const k = await s.hub.get('dpms')
  assert.equal(k.byWork.get(r.id).state, 'in', '저장하는 순간 넣었다')
  const doc = fs.readFileSync(path.join(dir, 'docs', '배포절차.md'), 'utf8')
  assert.match(doc, new RegExp(`<!-- applied: ${r.id} -->\\n배포 창은 화 · 목 14:00 ~ 17:00 이다\\. DB 커넥션 풀은 60 으로`), '같은 저장의 기록이 표지')
  assert.equal(Number(G('rev-list', '--count', 'HEAD')), n0 + 1, '커밋 하나')
  assert.deepEqual(G('show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['docs/배포절차.md', r.record])
  assert.match(fs.readFileSync(path.join(dir, r.record), 'utf8'), /## 넣은 것\n- docs\/배포절차\.md › 준비: 40 → 60/)
  assert.doesNotMatch(fs.readFileSync(path.join(dir, r.record), 'utf8'), /## 고친 조각/, '조각을 기록에 싣지 않는다')
  assert.equal(G('status', '--porcelain'), '')
  // 같은 base 로 다시 — 그사이 바뀌었다: E_CONFLICT · details.stale · 아무것도 쓰지 않았다
  const e = await s.hub.save(LEE, 'dpms', { record: { title: '준비: 커넥션 풀 70', body: '## 바뀐 것\n- DB 커넥션 풀: 40 → 70', touches: [coord] }, sections: [{ coord, base, edits: [{ find: '커넥션 풀은 40 으로', replace: '커넥션 풀은 70 으로' }] }] }, { channel: 'session' }).then(() => null, (x) => x)
  assert.equal(e?.code, 'E_CONFLICT')
  assert.deepEqual(e.details.stale, [coord])
  assert.equal(e.details.proposals[0].stale, true)
  assert.equal(Number(G('rev-list', '--count', 'HEAD')), n0 + 1, '묶음 0')
  assert.equal(G('status', '--porcelain'), '', 'git 깨끗')
  // 이미 있는 항목에 base 가 없으면 edits 든 content 든 E_CONFLICT · 조각 모양이 틀리면 E_INPUT
  assert.equal((await s.hub.save(LEE, 'dpms', { record: { title: 'x', body: '## 바뀐 것\n- a: 1', touches: [coord] }, sections: [{ coord, edits: [{ find: 'a', replace: 'b' }] }] }).catch((x) => x)).code, 'E_CONFLICT')
  assert.equal((await s.hub.save(LEE, 'dpms', { record: { title: 'x', body: '## 바뀐 것\n- a: 1', touches: [coord] }, sections: [{ coord, base, edits: [] }] }).catch((x) => x)).code, 'E_INPUT')
  // 걸린 조각 — 기록은 남고 그 조각만 넣지 못함(held 태그 · 넣지 못함 칸)
  const b2 = sha16(sectionOf(await s.hub.get('dpms'), coord).sec.body)
  const bad = await s.hub.save(LEE, 'dpms', { record: { title: '준비: 알림 간격', body: '## 바뀐 것\n- 알림 간격: 5분', touches: [coord] }, sections: [{ coord, base: b2, edits: [{ find: '날짜-순번으로 짓는다', replace: '날짜-순번으로 짓고 알린다' }] }] })
  assert.deepEqual([bad.proposals[0].ok, bad.proposals[0].code, bad.proposals[0].applied], [false, 'values', false])
  assert.match(bad.proposals[0].why, /기록의 값이 글에 없다: 5분/)
  assert.deepEqual(bad.docs, [])
  const kb = await s.hub.get('dpms')
  assert.equal(kb.byWork.get(bad.id).state, 'held')
  assert.ok(kb.byWork.get(bad.id).tags.includes('held'))
})

test('이름 없는 항목에 문서 · 머리 조각 · 새 항목은 content 로', async () => {
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

test('섞인 자리: 같은 항목에 아직 안 들어간 개편 전 기록이 있으면 넣지 않는다(legacy-mix · 기록은 남는다)', async () => {
  await s.hub.save(LEE, 'dpms', { record: { title: '카나리 메모', body: '## 바뀐 것\n- 메모: 지켜본다', touches: ['proc:카나리'] } })
  const k = await s.hub.get('dpms')
  const cur = sectionOf(k, 'proc:카나리').sec.body
  const r = await s.hub.save(LEE, 'dpms', { record: { title: '카나리: 지켜보는 시간', body: '## 바뀐 것\n- 지켜보는 시간: 30분', touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', base: sha16(cur), edits: [{ find: '롤백으로 간다.', replace: '롤백으로 간다. 지켜보는 시간은 30분이다.' }] }] })
  assert.deepEqual([r.proposals[0].ok, r.proposals[0].code], [false, 'legacy-mix'])
  assert.equal(sectionOf(await s.hub.get('dpms'), 'proc:카나리').sec.body, cur, '문서는 그대로')
  assert.equal((await s.hub.get('dpms')).byWork.get(r.id).state, 'held')
})

test('지식관리자도 같은 저장 문(값을 바꿔도 검사를 넘으면 그 순간)', async () => {
  const KIM = { user: 'kim', admin: true }
  const k = await s.hub.get('dpms')
  const pb = sha16(sectionOf(k, 'proc:준비').sec.body)
  const r = await s.hub.save(KIM, 'dpms', { record: { title: '준비: 커넥션 풀 80', body: '## 바뀐 것\n- DB 커넥션 풀: 60 → 80', touches: ['proc:준비'] }, sections: [{ coord: 'proc:준비', base: pb, edits: [{ find: '커넥션 풀은 60 으로', replace: '커넥션 풀은 80 으로' }] }] }, { channel: 'session' })
  assert.equal(r.proposals[0].applied, true, r.proposals[0].why)
  assert.match(fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '배포절차.md'), 'utf8'), /커넥션 풀은 80 으로/)
  assert.equal((await s.hub.get('dpms')).byWork.get(r.id).state, 'in')
})

test('MCP save: 읽은 뒤 바뀐 조각은 E_CONFLICT(아무것도 안 씀 · details.stale) · 넘은 조각은 proposals 에 applied(스킬 kmd-team-save 4단계)', async () => {
  const mcp = makeMcp(s.hub)
  const call = async (args) => {
    const out = await mcp.call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save', arguments: args } }, LEE)
    return { err: !!out.result.isError, r: JSON.parse(out.result.content[0].text) }
  }
  const stale = await call({ knowledge: 'dpms', record: { title: '헬스 체크: 주기 20초', changes: ['주기: 30초 → 20초'], touches: ['proc:헬스 체크'] }, sections: [{ coord: 'proc:헬스 체크', base: '0000000000000000', edits: [{ find: '/health 를 30초마다 부른다', replace: '/health 를 20초마다 부른다' }] }] })
  assert.equal(stale.err, true)
  assert.equal(stale.r.error, 'E_CONFLICT')
  assert.deepEqual(stale.r.details.stale, ['proc:헬스 체크'])
  const base = sha16(sectionOf(await s.hub.get('dpms'), 'proc:헬스 체크').sec.body)
  const ok = await call({ knowledge: 'dpms', record: { title: '헬스 체크: 주기 20초', changes: ['주기: 30초 → 20초'], touches: ['proc:헬스 체크'] }, sections: [{ coord: 'proc:헬스 체크', base, edits: [{ find: '/health` 를 30초마다 부른다', replace: '/health` 를 20초마다 부른다' }] }] })
  assert.equal(ok.err, false, JSON.stringify(ok.r))
  assert.deepEqual([ok.r.proposals[0].applied, ok.r.put, ok.r.docs], [true, 1, ['배포절차']])
  assert.match(ok.r.note, /넣음 1 · 넣지 못함 0/)
  // 메모 — 바뀐 것 없이 body 만 · 문서는 그대로 · 항목 글을 같이 보내면 E_INPUT
  const memo = await call({ knowledge: 'dpms', record: { title: '헬스 체크: 주기 더 줄일지', body: '15초도 볼 만하다. 다음 주 배포 뒤 정한다.', memo: true, touches: ['proc:헬스 체크'] } })
  assert.equal(memo.err, false, JSON.stringify(memo.r))
  assert.deepEqual([memo.r.memo, memo.r.docs], [true, []])
  assert.equal((await s.hub.get('dpms')).byWork.get(memo.r.saved).state, 'memo')
  const memo2 = await call({ knowledge: 'dpms', record: { title: '헬스 체크: 메모', body: '메모', memo: true, touches: ['proc:헬스 체크'] }, sections: [{ coord: 'proc:헬스 체크', base, content: 'x' }] })
  assert.equal(memo2.r.error, 'E_INPUT')
})
