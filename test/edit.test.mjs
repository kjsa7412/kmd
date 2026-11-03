// E4 필수 — 저장이 곧 반영 · 거두기 · 결정 규칙 · 되돌리기 · 팀 지식의 기록 길.
//
// 한 save → 대기 0 · 옛 날짜 고친 기록 → 거절 · 손 편집 → 고요 뒤 묶음 1 · 이름을 빠뜨린 기록 → 저절로 두기 0 · 일감 1 ·
// 사람이 답한 기록만 두기 · 좌표정정은 서버가 구조로 판정 · 되돌린 기록은 되돌림(S5) · 항목마다 되돌리기 · 주인이 아니면 기록으로.

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
import { copyDir, seat } from './helpers.mjs'
import { sha16 } from '../core/text.js'
import { sectionOf, isLegacy } from '../core/knowledge.js'

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

test('저장이 곧 반영: 한 save → 대기 0 · 옛 날짜 고친 기록은 거절', async () => {
  // 팀 저장 문(S4) — 이미 있는 항목은 base 를 같이 · 바꾼 값은 기록의 「옛 → 새」 로
  const base = sha16(sectionOf(await s.hub.get('dpms'), 'proc:준비').sec.body)
  const r = await s.hub.save(KIM, 'dpms', { record: { title: '준비: 커넥션 풀 50', body: '## 바뀐 것\n- DB 커넥션 풀: 40 → 50' }, sections: [{ coord: 'proc:준비', base, content: '배포 창은 화 · 목 14:00 ~ 17:00 이다. DB 커넥션 풀은 50 으로 둔다.\n이미지 이름은 날짜-순번으로 짓는다(예 1022-01).' }] })
  assert.deepEqual([r.put, r.held], [1, undefined], JSON.stringify(r.held))
  assert.equal(await stateOf(s, 'dpms', r.id), 'in')
  assert.equal(await code(s.hub.save(KIM, 'dpms', { record: { title: '준비: 지문 없음', body: '## 바뀐 것\n- DB 커넥션 풀: 50 → 60' }, sections: [{ coord: 'proc:준비', content: '배포 창은 화 · 목 14:00 ~ 17:00 이다. DB 커넥션 풀은 60 으로 둔다.\n이미지 이름은 날짜-순번으로 짓는다(예 1022-01).' }] })), 'E_CONFLICT', '이미 있는 항목에 base 가 없으면 덮지 않는다')
  const old = await code(s.hub.save(KIM, 'dpms', { record: { title: '헬스 체크: 옛 날짜 고침', body: 'x', tags: ['edit'], date: '2026-01-02' }, sections: [{ coord: 'proc:헬스 체크', content: '옛 글' }] }, { system: true }))
  assert.equal(old, 'E_CONFLICT')
})

test('팀 지식: 쓰기 자리의 항목 글도 검사를 넘으면 그 순간 문서에(K-D13) · 화면 고치기는 아직 지식관리자만 바로(S9)', async () => {
  // lee 는 보통 팀원 — 자리 없음이 기본이라(권한 모델 v1.1) dpms 쓰기 자리를 받는다
  await s.auth.addUser({ id: 'lee', admin: false })
  await seat(s, 'lee', { dpms: 'write' })
  const base = sha16(sectionOf(await s.hub.get('dpms'), 'term:알람').sec.body)
  const r = await s.hub.save(LEE, 'dpms', { record: { title: '알람: 당번 채널도', body: '#ops-oncall 도 받는다.' }, sections: [{ coord: 'term:알람', base, content: 'CPU 경고는 85% 에서 울린다. 알람 받는 곳은 운영 채널 #ops-alert · 당번 채널 #ops-oncall.' }] })
  assert.deepEqual([r.put, r.held], [1, undefined], JSON.stringify(r.held))
  assert.match(fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '운영.md'), 'utf8'), new RegExp(`<!-- applied: ${r.id} -->\\nCPU 경고는 85% 에서 울린다\\. 알람 받는 곳은 운영 채널 #ops-alert · 당번 채널 #ops-oncall\\.`))
  assert.equal(await stateOf(s, 'dpms', r.id), 'in')
  const w = fs.readFileSync(path.join(tmp, 'kn', 'dpms', r.record), 'utf8')
  assert.match(w, /## 넣은 것\n- docs\/운영\.md › /)
  // 화면 고치기는 지금 그대로(쓰기 자리는 기록으로 · 지식관리자는 바로 · S9 에 저장 문으로)
  const d = await s.hub.edit(LEE, 'dpms', { doc: '서버목록', sections: [{ h: '점검 시간', body: '정기 점검은 매달 둘째 토요일.' }] })
  assert.equal(d.direct, false)
  const k = await s.hub.edit(KIM, 'dpms', { doc: '서버목록', sections: [{ h: '운영 서버', body: 'app-1 ~ app-5 · canary-1.' }] })
  assert.equal(k.direct, true)
  assert.match(fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '서버목록.md'), 'utf8'), new RegExp(`<!-- applied: ${k.id} -->\\napp-1 ~ app-5`))
})

test('결정 규칙: 이름을 빠뜨린 기록은 두지 않고 일감 · 사람이 답한 것만 두기 · 좌표정정은 구조로', async () => {
  const a = await s.hub.save(KIM, 'dpms', { record: { title: '어디에 넣을지 모르는 메모', body: '서버 이름 규칙을 바꾸자는 이야기.' } })
  const b = await s.hub.save(KIM, 'dpms', { record: { title: '넣을 곳 없음. 회의 잡담', body: `커피 이야기.\n${HUMAN_ANSWER}` } })
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
  const dec = k2.logs.find((w) => w.tags.includes('curate-auto') && w.curates.length) // 정리 판정은 이력(log/)
  assert.equal(dec.author, 'kmd-auto')
})

test('되돌리기: 옛 본문 + 판정 거두기 · 저장 문이 넣은 기록은 되돌림', async () => {
  const doc = path.join(tmp, 'kn', 'dpms', 'docs', '배포절차.md')
  const base = sha16(sectionOf(await s.hub.get('dpms'), 'proc:카나리').sec.body)
  const r = await s.hub.save(KIM, 'dpms', { record: { title: '카나리: 20%', body: '## 바뀐 것\n- 첫 30분 비율: 10% → 20%', touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', base, content: '`canary-1` 에 먼저 올리고, 첫 30분은 요청의 20% 만 보낸다. 오류율이 1% 를 넘으면 멈추고 롤백으로 간다.' }] })
  assert.match(fs.readFileSync(doc, 'utf8'), /요청의 20%/)
  await s.hub.revert(KIM, 'dpms', { record: r.id })
  const t = fs.readFileSync(doc, 'utf8')
  assert.match(t, /요청의 10% 만 보낸다/)
  assert.match(t, /<!-- applied: 2026-1017-카나리 -->/)
  const k = await s.hub.get('dpms')
  // 저장 문이 넣은 기록(put)을 통째로 되돌리면 되돌림 — 「들어감」 으로 남거나 다시 대기로 떨어지지 않는다(S4 · 옛 기록은 S5)
  assert.equal(k.byWork.get(r.id).state, 'reverted', '되돌린 기록은 되돌림')
  assert.ok(k.reverted.has(r.id), '주인이 되돌림: 다시 초안하지 않는다')
})

test('되돌리기 항목마다(S5): 이력 줄 · 자리 · 하나 되돌린 뒤 원 기록 in · 모두면 reverted · 새 항목은 지움 · 그 뒤 고친 항목은 E_CONFLICT · 쓰기 자리는 watched 403', async () => {
  // lee 는 앞 시험에서 dpms 쓰기 자리 · choi 도 쓰기 자리(B)
  await s.auth.addUser({ id: 'choi', admin: false })
  await seat(s, 'choi', { dpms: 'write' })
  const CHOI = { user: 'choi' }
  const dir = path.join(tmp, 'kn', 'dpms')
  const doc = path.join(dir, 'docs', '백업절차.md')
  const k0 = await s.hub.get('dpms')
  const b1 = sha16(sectionOf(k0, 'proc:매일 백업').sec.body)
  const b2 = sha16(sectionOf(k0, 'proc:복구 점검').sec.body)
  const r = await s.hub.save(LEE, 'dpms', {
    record: { title: '백업: 14일 · 화요일 · 위치', body: '## 바뀐 것\n- 보관: 7일 → 14일\n- 복구 점검: 월요일 → 화요일\n- 백업 위치: `backup-1`' },
    sections: [
      { coord: 'proc:매일 백업', base: b1, content: 'DB 는 매일 01:00 에 백업한다. 14일치를 둔다.' },
      { coord: 'proc:복구 점검', base: b2, content: '매주 화요일 복구를 한 번 해 본다.' },
      { doc: 'docs/백업절차.md', heading: '백업 위치', content: '백업은 `backup-1` 에 둔다.' },
    ],
  })
  assert.deepEqual([r.put, r.held], [3, undefined], JSON.stringify(r))
  // 이력 — 지식관리자에게도 쓰기 자리의 세션 저장 줄이 보인다 · 「옛 값 → 새 값」 · 되돌리기는 쓴 사람과 지식관리자만(canRevert)
  const rowOf = async (ctx) => (await s.hub.history(ctx)).find((x) => x.rec === r.id)
  const hk = await rowOf(KIM)
  assert.equal(hk.kind, '저장')
  assert.equal(hk.who, 'lee')
  assert.equal(hk.items.length, 3)
  assert.ok(hk.items.every((x) => x.live), JSON.stringify(hk.items))
  assert.ok(hk.items.find((x) => x.heading === '백업 위치').isNew)
  assert.match(hk.sub, /→/)
  assert.equal(hk.canRevert, true)
  assert.equal((await rowOf(LEE)).canRevert, true)
  const hc = await rowOf(CHOI)
  assert.ok(hc, '쓰기 자리 B 도 줄은 본다')
  assert.equal(hc.canRevert, false, 'B 에게 A 줄의 [되돌리기] 가 없다')
  assert.equal(await code(s.hub.revert(CHOI, 'dpms', { record: r.id, doc: 'docs/백업절차.md', heading: '매일 백업' })), 'E_FORBIDDEN')
  // 하나만 되돌림 — 넣기 전 글로 · reopens 없이 · 원 기록은 그대로 들어감
  await s.hub.revert(LEE, 'dpms', { record: r.id, doc: 'docs/백업절차.md', heading: '매일 백업' })
  let t = fs.readFileSync(doc, 'utf8')
  assert.match(t, /7일치를 둔다/)
  assert.match(t, /14일 · 화요일|화요일 복구/)
  let k = await s.hub.get('dpms')
  assert.equal(k.byWork.get(r.id).state, 'in', '남은 항목이 있으면 들어감')
  assert.ok(!k.reverted.has(r.id), '항목 하나 되돌림은 판정을 거두지 않는다')
  const back = k.logs.find((w) => w.tags.includes('revert') && w.title === '되돌림: 백업절차 › 매일 백업')
  assert.ok(back && !back.reopens.length, '태그 revert · 제목 「되돌림: 문서 › 머리」 · reopens 없음')
  assert.match(back.body, new RegExp(`^## 되돌린 항목\\n- ${r.id}: docs/백업절차\\.md › 매일 백업$`, 'm'))
  assert.equal((await s.hub.history(KIM)).find((x) => x.rec === back.id)?.kind, '되돌림')
  assert.equal(await code(s.hub.revert(LEE, 'dpms', { record: r.id, doc: 'docs/백업절차.md', heading: '매일 백업' })), 'E_CONFLICT', '같은 항목 두 번은 「이미 되돌렸다」')
  const h2 = await rowOf(LEE)
  assert.deepEqual(h2.items.map((x) => [x.heading, x.live, x.reverted]), [['매일 백업', false, true], ['복구 점검', true, false], ['백업 위치', true, false]])
  assert.equal(h2.canRevert, true, '하나 되돌린 뒤에도 다른 항목은 되돌린다')
  // 새 항목을 되돌리면 항목이 없어진다(빈 머리가 남지 않는다 · S-D53)
  await s.hub.revert(LEE, 'dpms', { record: r.id, doc: 'docs/백업절차.md', heading: '백업 위치' })
  t = fs.readFileSync(doc, 'utf8')
  assert.doesNotMatch(t, /## 백업 위치/)
  assert.doesNotMatch(t, /backup-1/)
  // 그 뒤 남(지식관리자)이 고친 항목은 되돌리지 않는다 — 덮지 않게
  const b3 = sha16(sectionOf(await s.hub.get('dpms'), 'proc:복구 점검').sec.body)
  await s.hub.save(KIM, 'dpms', { record: { title: '복구 점검: 수요일', body: '## 바뀐 것\n- 복구 점검: 화요일 → 수요일' }, sections: [{ coord: 'proc:복구 점검', base: b3, content: '매주 수요일 복구를 한 번 해 본다.' }] })
  assert.equal(await code(s.hub.revert(LEE, 'dpms', { record: r.id, doc: 'docs/백업절차.md', heading: '복구 점검' })), 'E_CONFLICT')
  assert.match(fs.readFileSync(doc, 'utf8'), /수요일 복구/)
  assert.equal((await rowOf(LEE)).canRevert, false, '지금 그 기록이 표지인 항목이 없으면 되돌리기 없음')
  assert.equal(G(dir, 'status', '--porcelain'), '', '트리 깨끗')
  // 항목 하나뿐인 기록을 그 항목으로 되돌리면 원 기록은 되돌림 — 「개편 전 기록」 으로 보이지 않는다
  const b4 = sha16(sectionOf(await s.hub.get('dpms'), 'term:디스크 점검').sec.body)
  const one = await s.hub.save(LEE, 'dpms', { record: { title: '디스크 점검: 70%', body: '## 바뀐 것\n- 디스크 기준: 80% → 70%' }, sections: [{ coord: 'term:디스크 점검', base: b4, content: '로그 디스크가 70% 를 넘는지 매일 본다.' }] })
  assert.equal(one.put, 1, JSON.stringify(one))
  await s.hub.revert(LEE, 'dpms', { record: one.id, doc: 'docs/로그보관.md', heading: '디스크 점검' })
  k = await s.hub.get('dpms')
  assert.equal(k.byWork.get(one.id).state, 'reverted')
  assert.equal(isLegacy(k, k.byWork.get(one.id)), false)
  // 원본이 주인인 문서(watched)의 항목은 쓰기 자리가 되돌리지 못한다 — 지식관리자는 된다
  const b5 = sha16(sectionOf(k, 'term:보관 기간').sec.body)
  const wr = await s.hub.save(LEE, 'dpms', { record: { title: '보관 기간: 앱 60일', body: '## 바뀐 것\n- 앱 로그: 30일 → 60일' }, sections: [{ coord: 'term:보관 기간', base: b5, content: '앱 로그는 60일, 감사 로그는 1년 둔다.' }] })
  assert.equal(wr.put, 1, JSON.stringify(wr))
  const lf = path.join(dir, 'docs', '로그보관.md')
  fs.writeFileSync(lf, '<!-- watched: src="원본" path="로그보관.md" -->\n' + fs.readFileSync(lf, 'utf8'))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'watched'], { cwd: dir })
  s.hub.forget('dpms')
  assert.equal(await code(s.hub.revert(LEE, 'dpms', { record: wr.id, doc: 'docs/로그보관.md', heading: '보관 기간' })), 'E_FORBIDDEN')
  assert.equal(await code(s.hub.revert(KIM, 'dpms', { record: wr.id, doc: 'docs/로그보관.md', heading: '보관 기간' })), 'ok')
  assert.match(fs.readFileSync(lf, 'utf8'), /앱 로그는 30일/)
  // 머리가 다른 머리 안에 든 항목(배포 / 배포 절차) — 「배포」 만 되돌리면 「배포 절차」 는 그대로(S5 검토)
  const two = await s.hub.save(KIM, 'dpms', { record: { title: '배포: 순서', body: '## 바뀐 것\n- 배포 · 배포 절차를 세움' }, sections: [
    { doc: 'docs/백업절차.md', heading: '배포', content: '배포는 화요일에 한다.' },
    { doc: 'docs/백업절차.md', heading: '배포 절차', content: '배포 절차는 빌드 → 올리기 → 확인 순서다.' },
  ] })
  assert.equal(two.put, 2, JSON.stringify(two))
  const hb = (await s.hub.history(KIM)).find((x) => x.rec === two.id)
  assert.deepEqual(hb.items.map((x) => [x.heading, x.live]), [['배포', true], ['배포 절차', true]])
  await s.hub.revert(KIM, 'dpms', { record: two.id, doc: 'docs/백업절차.md', heading: '배포' })
  t = fs.readFileSync(doc, 'utf8')
  assert.doesNotMatch(t, /^## 배포$/m)
  assert.match(t, /^## 배포 절차$/m)
  assert.match(t, /빌드 → 올리기/)
  // 되돌림 기록 줄의 항목에는 [되돌리기] 가 없다(표지를 앞 기록에 돌려 둔다)
  const hr = (await s.hub.history(KIM)).find((x) => x.kind === '되돌림' && x.title === '되돌림: 백업절차 › 배포')
  assert.ok(hr && !hr.canRevert, JSON.stringify(hr))
})

test('거두기: 편집기로 고친 문서는 고요 뒤 묶음 1 · 기록 손 고침은 되돌린다', async () => {
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
    // 편집기로 바로 고친 일은 기록이 아니라 이력(log/) — 기록 목록에 아직 안 넣은 기록이 생기지 않는다
    const w = k.logs.find((x) => x.tags.includes('edit') && x.title.startsWith('편집기에서 고침'))
    assert.equal(w.author, 'kim')
    assert.deepEqual(w.touches, ['term:VPN'])
    assert.ok(w.path.startsWith('log/'))
    assert.ok(!k.works.some((x) => x.title.startsWith('편집기에서 고침')))
  } finally {
    await pc.close()
  }
})
