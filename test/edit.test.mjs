// E4 필수 — 저장이 곧 반영 · 거두기 · 결정 규칙 · 되돌리기 · 팀 지식의 기록 길.
//
// 한 save → 대기 0 · 옛 날짜 고친 기록 → 거절 · 손 편집 → 고요 뒤 묶음 1 · 건드린 항목을 빠뜨린 기록 → 저절로 두기 0 · 일감 1 ·
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
import { copyDir, seat, ensureRecordsDoc } from './helpers.mjs'
import { sha16 } from '../core/text.js'
import { sectionOf } from '../core/knowledge.js'

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

test('팀 지식: 쓰기 자리의 항목 글도 검사를 넘으면 그 순간 문서에(K-D13) · 화면 고치기도 쓰기 자리부터 바로(S9)', async () => {
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
  // 화면 고치기(S9) — 쓰기 자리도 저장 문으로 곧바로 문서에(값 검사 없음 · 이력 「고침」 · 넣은 것 칸에 옛 값 → 새 값)
  const sv = await s.hub.get('dpms')
  const b0 = sha16(sv.docs.find((x) => x.id === '서버목록').sections.find((x) => x.h === '점검 시간').body)
  const d = await s.hub.edit(LEE, 'dpms', { doc: '서버목록', sections: [{ h: '점검 시간', base: b0, body: '정기 점검은 매달 둘째 토요일 02:00 ~ 05:00.' }] })
  assert.equal(d.direct, true)
  const doc = fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '서버목록.md'), 'utf8')
  assert.match(doc, new RegExp(`<!-- applied: ${d.id} -->\\n정기 점검은 매달 둘째 토요일 02:00 ~ 05:00\\.`))
  const dw = (await s.hub.get('dpms')).byWork.get(d.id)
  assert.ok(dw.path.startsWith('log/') && dw.tags.includes('edit') && dw.tags.includes('put'), dw.tags.join(' '))
  assert.equal(dw.author, 'lee')
  assert.match(dw.body, /## 넣은 것\n- docs\/서버목록\.md › 점검 시간: 04:00 → 05:00/)
  // 쓰기 자리는 항목 지우기 · 이름 바꾸기를 못 한다 · 읽은 뒤 바뀐 항목은 E_CONFLICT(아무것도 쓰지 않는다)
  assert.equal(await code(s.hub.edit(LEE, 'dpms', { doc: '서버목록', rename: [{ from: '점검 시간', to: '점검 때' }] })), 'E_FORBIDDEN')
  assert.equal(await code(s.hub.edit(LEE, 'dpms', { doc: '서버목록', sections: [{ h: '점검 시간', base: b0, body: '다른 글.' }] })), 'E_CONFLICT')
  // 화면 길(needBase)은 이미 있는 항목의 지문을 꼭 받는다
  assert.equal(await code(s.hub.edit(LEE, 'dpms', { doc: '서버목록', sections: [{ h: '점검 시간', body: '지문 없음.' }] }, { needBase: true })), 'E_INPUT')
  // 새 항목 「운영」 은 있는 「운영 서버」 를 집을 수 있다 — 다른 이름을 쓰게 한다(S5 검토 ⑫)
  assert.equal(await code(s.hub.edit(KIM, 'dpms', { doc: '서버목록', sections: [{ h: '운영', body: '새 항목.' }] })), 'E_INPUT')
  const k = await s.hub.edit(KIM, 'dpms', { doc: '서버목록', sections: [{ h: '운영 서버', body: 'app-1 ~ app-5 · canary-1.' }] })
  assert.equal(k.direct, true)
  assert.match(fs.readFileSync(path.join(tmp, 'kn', 'dpms', 'docs', '서버목록.md'), 'utf8'), new RegExp(`<!-- applied: ${k.id} -->\\napp-1 ~ app-5`))
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

test('되돌리기 항목마다(S5): 이력 줄 · 자리 · 하나 되돌린 뒤 원 기록 in · 모두면 reverted · 새 항목은 지움 · 그 뒤 고친 항목은 E_CONFLICT · 쓰기 자리는 자기 기록을 되돌린다', async () => {
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
  // 항목 하나뿐인 기록을 그 항목으로 되돌리면 원 기록은 되돌림
  const b4 = sha16(sectionOf(await s.hub.get('dpms'), 'term:디스크 점검').sec.body)
  const one = await s.hub.save(LEE, 'dpms', { record: { title: '디스크 점검: 70%', body: '## 바뀐 것\n- 디스크 기준: 80% → 70%' }, sections: [{ coord: 'term:디스크 점검', base: b4, content: '로그 디스크가 70% 를 넘는지 매일 본다.' }] })
  assert.equal(one.put, 1, JSON.stringify(one))
  await s.hub.revert(LEE, 'dpms', { record: one.id, doc: 'docs/로그보관.md', heading: '디스크 점검' })
  k = await s.hub.get('dpms')
  assert.equal(k.byWork.get(one.id).state, 'reverted')
  // 쓰기 자리는 자기 기록을 되돌린다(옛 사본 문서 watched · 저절로 채우는 표 막기는 걷었다 · 옛잔재 G3)
  const b5 = sha16(sectionOf(k, 'term:보관 기간').sec.body)
  const wr = await s.hub.save(LEE, 'dpms', { record: { title: '보관 기간: 앱 60일', body: '## 바뀐 것\n- 앱 로그: 30일 → 60일' }, sections: [{ coord: 'term:보관 기간', base: b5, content: '앱 로그는 60일, 감사 로그는 1년 둔다.' }] })
  assert.equal(wr.put, 1, JSON.stringify(wr))
  const lf = path.join(dir, 'docs', '로그보관.md')
  s.hub.forget('dpms')
  assert.equal(await code(s.hub.revert(LEE, 'dpms', { record: wr.id, doc: 'docs/로그보관.md', heading: '보관 기간' })), 'ok')
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

// 거두기는 걷었다(지식 생성 하네스 H6 · H-D33) — 편집기로 직접 고친 문서는 들이지 않는다: 사본을 두고 되돌린 뒤 「손으로 고친 파일」 로 선다
test('손으로 고친 파일: 편집기로 고친 문서는 들이지 않고 되돌린다(커밋 0) · 목록에 선다 · [버리기] · 기록 손 고침은 되돌린다', async () => {
  collect.configure({ quietMs: 300 })
  const pc = await startServer({ root: path.join(tmp, 'kn'), data: path.join(tmp, 'pcdata'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const dir = path.join(tmp, 'kn', 'dpms')
    const n0 = Number(G(dir, 'rev-list', '--count', 'HEAD'))
    const f = path.join(dir, 'docs', '접속안내.md')
    const before = fs.readFileSync(f, 'utf8')
    fs.writeFileSync(f, before.replace('사내 VPN 뒤에서만 열린다.', '사내 VPN 뒤에서만 열린다. 집에서는 OTP 를 쓴다.'))
    const rec = path.join(dir, 'work', '2026-1021-배포-창.md')
    const recBefore = fs.readFileSync(rec, 'utf8')
    fs.appendFileSync(rec, '\n손으로 고친 줄\n')
    let items = []
    for (let i = 0; i < 100 && !items.length; i++) {
      await wait(100)
      items = await pc.hub.handEdits({ user: 'kim' }, 'dpms')
    }
    assert.equal(items.length, 1, '손으로 고친 파일 하나')
    assert.equal(items[0].doc, '접속안내')
    assert.equal(items[0].kind, 'mod')
    assert.ok(items[0].heads.length >= 1)
    assert.equal(Number(G(dir, 'rev-list', '--count', 'HEAD')), n0, '지식에는 아무것도 쓰지 않는다')
    assert.equal(G(dir, 'status', '--porcelain'), '', '트리 깨끗')
    assert.equal(fs.readFileSync(f, 'utf8'), before, '문서는 되돌렸다')
    assert.equal(fs.readFileSync(rec, 'utf8'), recBefore, '기록의 손 고침은 되돌렸다')
    const d = await pc.hub.handEditAct({ user: 'kim' }, 'dpms', { hand: items[0].id, act: 'drop' })
    assert.equal(d.dropped, true)
    assert.deepEqual(await pc.hub.handEdits({ user: 'kim' }, 'dpms'), [])
    assert.equal(await code(pc.hub.handEditAct({ user: 'kim' }, 'dpms', { hand: items[0].id, act: 'drop' })), 'E_NOTFOUND')
  } finally {
    await pc.close()
  }
})

// 화면 문서 고치기의 글 고침은 걷었다(H6 · H-D33) — 화면 길(지문 필수)은 글이 든 입력을 받지 않는다 · 고친 글은 「넣을 것」 으로(edit-source) · 지움 · 이름 바꿈은 그대로
test('저장 승인 P5: approve 지식의 화면 고치기는 저장 제안 — dry 는 쓰지 않음 · proposal 없음 · 어긋남 = E_APPROVE · 넣기 = 받아들인 경고 · 지움만은 제안 없음 · held 지식은 그대로', async () => {
  const dir = path.join(tmp, 'kn', 'apv5')
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), dir)
  fs.rmSync(path.join(dir, 'work'), { recursive: true, force: true })
  fs.writeFileSync(path.join(dir, 'README.md'), '# 테스트 승인 지식\n')
  await s.hub.sync(KIM)
  await ensureRecordsDoc(s, 'apv5')
  await s.auth.addUser({ id: 'test-p5', admin: false }).catch(() => {})
  await seat(s, 'test-p5', { apv5: 'write' })
  const P5 = { user: 'test-p5' }
  const ed = (b) => s.hub.edit(P5, 'apv5', { doc: '배포절차', ...b }, { needBase: true })
  const sec = (h) => (s.hub.get('apv5').then((k) => k.docs.find((x) => x.id === '배포절차').sections.find((x) => x.h === h)))
  const c0 = await sec('카나리')
  const secs = [{ h: '카나리', base: sha16(c0.body), body: c0.body.replace('10%', '20%') }]
  const logs = () => (fs.existsSync(path.join(dir, 'log')) ? fs.readdirSync(path.join(dir, 'log')) : [])
  // dry — 쓰지 않고 저장 제안(경고: 바뀐 값이 기록에 없다)
  const d1 = await ed({ sections: secs, dry: true })
  assert.equal(d1.dry, true)
  assert.ok(d1.propose.proposal && d1.propose.items[0].changed[0].to === '20%', JSON.stringify(d1.propose.items))
  assert.ok(d1.propose.warnings.length >= 1)
  assert.deepEqual(logs(), [], 'dry 는 쓰지 않는다')
  // proposal 없음 · 어긋남 = E_APPROVE + 새 제안(아무것도 쓰지 않는다)
  const e1 = await s.hub.edit(P5, 'apv5', { doc: '배포절차', sections: secs }, { needBase: true }).catch((e) => e)
  assert.equal(e1.code, 'E_APPROVE')
  assert.ok(e1.details.propose.proposal)
  const e2 = await ed({ sections: secs, why: '다른 까닭', proposal: d1.propose.proposal }).catch((e) => e)
  assert.equal(e2.code, 'E_APPROVE')
  assert.deepEqual(logs(), [])
  assert.equal(await code(ed({ sections: secs, changes: ['줄\n바꿈'], dry: true })), 'E_INPUT')
  assert.equal(await code(ed({ sections: secs, proposal: 'x' })), 'E_INPUT')
  // 넣기 = 승인(경고 받아들임) — 기록 「## 받아들인 경고」 · 문서에 들어감
  const r = await ed({ sections: secs, proposal: d1.propose.proposal })
  assert.equal(r.direct, true)
  const w = fs.readFileSync(path.join(dir, r.record), 'utf8')
  assert.match(w, /## 받아들인 경고/)
  assert.match(fs.readFileSync(path.join(dir, 'docs', '배포절차.md'), 'utf8'), /요청의 20% 만/)
  // 바뀐 것 · 까닭 칸 — 경고 없이 · 기록 칸으로
  const c1 = await sec('카나리')
  const secs2 = [{ h: '카나리', base: sha16(c1.body), body: c1.body.replace('20%', '30%') }]
  const d2 = await ed({ sections: secs2, changes: ['카나리 첫 30분 비율: 20% → 30%'], why: '테스트', dry: true })
  assert.deepEqual(d2.propose.warnings, [])
  const r2 = await ed({ sections: secs2, changes: ['카나리 첫 30분 비율: 20% → 30%'], why: '테스트', proposal: d2.propose.proposal })
  const w2 = fs.readFileSync(path.join(dir, r2.record), 'utf8')
  assert.match(w2, /## 바뀐 것\n- 카나리 첫 30분 비율: 20% → 30%\n\n## 까닭\n- 테스트/)
  assert.doesNotMatch(w2, /받아들인 경고/)
  // 읽은 뒤 바뀜 — dry 도 E_CONFLICT
  assert.equal(await code(ed({ sections: secs2, dry: true })), 'E_CONFLICT')
  // 지식관리자의 항목 지우기만 — 제안 없음(dry 는 propose: null)
  const d3 = await s.hub.edit(KIM, 'apv5', { doc: '배포절차', remove: ['헬스 체크'], dry: true }, { needBase: true })
  assert.deepEqual(d3, { dry: true, propose: null })
  const r3 = await s.hub.edit(KIM, 'apv5', { doc: '배포절차', remove: ['헬스 체크'] }, { needBase: true })
  assert.equal(r3.direct, true)
  // 새 항목은 화면 길로 받지 않는다(H-D38) — 넣을 것으로 올라가 Claude 가 짓고 승인 대기를 거친다 · 있는 항목의 글 고침만 바로 들어간다
  const eNew = await ed({ sections: [{ h: '테스트 새로 쓴 항목', body: '새 글이다.' }], dry: true }).catch((e) => e)
  assert.equal(eNew.code, 'E_INPUT')
  assert.match(eNew.message, /넣을 것/)
  const q = await s.hub.editAsSource(P5, 'apv5', { doc: '배포절차', sections: [{ h: '테스트 새로 쓴 항목', body: '새 글이다.' }], why: '테스트' })
  assert.equal(q.queued, true)
  const j = s.hub.intakesOf('apv5').find((x) => x.state === 'queued')
  assert.ok(j && j.ask === true && j.by === 'test-p5', JSON.stringify(j))
  // 방금 바꾼 옛 값이 다른 항목에도 남아 있으면 알린다(also) — 고치지는 않는다
  const c9 = await sec('카나리')
  const m9 = c9.body.match(/\d+%/)
  const other = (await s.hub.get('apv5')).docs.flatMap((d) => d.sections.map((x) => ({ d: d.id, h: x.h, body: x.body }))).find((x) => !(x.d === '배포절차' && x.h === '카나리') && m9 && x.body.includes(m9[0]))
  const r9 = await s.hub.edit(KIM, 'apv5', { doc: '배포절차', sections: [{ h: '카나리', base: sha16(c9.body), body: c9.body.replace(m9[0], '77%') }], changes: [`카나리 비율: ${m9[0]} → 77%`], why: '테스트' }, { needBase: false })
  if (other) assert.ok((r9.also || []).some((x) => x.doc === other.d && x.heading === other.h), JSON.stringify(r9.also))
})
