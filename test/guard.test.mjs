// 지식 생성 가드(core/guard.js) — G1 모양 · G2 등재 · G3 자리 · G4 새 문서 · 거절형 / 붙잡아 두기 · core save 와 saveRecords 연결

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseVocab } from '../core/vocab.js'
import { newNameWhy, resolveName, guardRecord, guardNames, guardNewDoc, formsOf, parseForms, nearNames, recordBody } from '../core/guard.js'
import { save, saveRecords } from '../core/save.js'
import { parseRecord } from '../core/frontmatter.js'

const VOCAB = `# 이름 장부

## 이슈

- \`이슈:DPMS-ISS-15\` — 공수 부족 (필요 공수가 1명 가용 공수의 4.3배)
  aliases: ISS-15, 공수 부족
- \`이슈:DPMS-ISS-02\` — SCADA 연계 방식 결정
  deprecated: 2026-10-16 → 이슈:DPMS-ISS-15 — 합침

## term

- \`term:PLC\` — 현장 설비를 실제로 제어하는 장치
- \`proc:헬스 체크\` — 옛 모양(빈칸) 이름
`
const MANAGED = `# 자리 장부

| 이름 | 문서 | 항목 |
|---|---|---|
| \`이슈:*\` | \`docs/대장.md\` | \`## {값}\` |
| \`term:*\` | \`docs/용어집.md\` | \`## {값}\` |
`
const vocab = parseVocab(VOCAB)

test('G1 — 새 이름 모양: 한글 종류는 되고 값의 빈칸 · 문장 · 긴 글은 안 된다', () => {
  assert.equal(newNameWhy('이슈:DPMS-ISS-20'), null)
  assert.equal(newNameWhy('게이트웨이DB:gt_link'), null)
  assert.equal(newNameWhy('table:rp_mst'), null)
  assert.match(newNameWhy('이슈:공수 부족 필요 공수가 4.3배'), /빈칸/)
  assert.match(newNameWhy('Table:x'), /종류/)
  assert.match(newNameWhy('term:' + 'a'.repeat(61)), /60자/)
  assert.match(newNameWhy('term:__proto__'), /쓸 수 없는/)
  assert.match(newNameWhy('PLC'), /종류:값/)
})

test('G2 — 이름 풀기: 같음 · 폐기 → 새 이름 · 같은 말(다른 이름) · 모름', () => {
  assert.deepEqual(resolveName(vocab, '이슈:DPMS-ISS-15'), { coord: '이슈:DPMS-ISS-15', how: 'same' })
  assert.deepEqual(resolveName(vocab, '이슈:DPMS-ISS-02'), { coord: '이슈:DPMS-ISS-15', how: 'deprecated' })
  assert.deepEqual(resolveName(vocab, '이슈:ISS-15'), { coord: '이슈:DPMS-ISS-15', how: 'alias' })
  assert.equal(resolveName(vocab, '이슈:DPMS-ISS-99').coord, null)
  assert.ok(nearNames(vocab, '공수').includes('이슈:DPMS-ISS-15'))
})

test('거절형(strict) — 장부 밖 · 폐기 · 이름 없는 기록 · 둘 다 보냄을 거절하고 후보를 말한다', () => {
  const g1 = guardRecord(vocab, { touches: ['이슈:공수부족'] }, { mode: 'strict' })
  assert.equal(g1.errors.length, 1)
  assert.match(g1.errors[0].message, /장부에 없다/)
  assert.match(guardRecord(vocab, { touches: ['이슈:DPMS-ISS-02'] }).errors[0].message, /폐기된 이름.*DPMS-ISS-15/)
  assert.match(guardRecord(vocab, { touches: [] }).errors[0].message, /touchesEmpty/)
  assert.equal(guardRecord(vocab, { touches: [], touchesEmpty: '사업 전체 일정 메모 — 항목이 없다' }).errors.length, 0)
  assert.match(guardRecord(vocab, { touches: ['term:PLC'], touchesEmpty: 'x' }).errors[0].message, /둘 중 하나/)
  // 옛 모양 이름(장부에 있다)은 그대로 받는다
  assert.equal(guardRecord(vocab, { touches: ['proc:헬스 체크'] }).errors.length, 0)
  // 자리가 있는 기록(화면의 항목 고침 at/ · 이력 · 정리)은 이름이 없어도 된다
  assert.equal(guardRecord(vocab, { touches: [], tags: ['at/대장#개요'] }).errors.length, 0)
  assert.equal(guardRecord(vocab, { touches: [], tags: ['edit'] }).errors.length, 0)
  // 세울 이름으로 실어 둔 것은 장부 밖이어도 받는다(모양은 본다)
  assert.equal(guardRecord(vocab, { touches: ['이슈:DPMS-ISS-20'] }, { proposed: new Set(['이슈:DPMS-ISS-20']) }).errors.length, 0)
  assert.equal(guardRecord(vocab, { touches: ['이슈:새 이슈'] }, { proposed: new Set(['이슈:새 이슈']) }).errors.length, 1)
})

test('붙잡아 두기(hold) — 폐기 · 같은 말은 바꿔 달고, 장부 밖은 남기고, 이름 없으면 까닭을 단다', () => {
  const g = guardRecord(vocab, { touches: ['이슈:DPMS-ISS-02', '이슈:ISS-15', '이슈:모름'] }, { mode: 'hold' })
  assert.deepEqual(g.errors, [])
  assert.deepEqual(g.touches, ['이슈:DPMS-ISS-15', '이슈:모름'])
  assert.equal(g.fixes.length, 2)
  assert.deepEqual(g.outside, ['이슈:모름'])
  const e = guardRecord(vocab, { touches: [] }, { mode: 'hold', why: '가져옴' })
  assert.equal(e.touchesEmpty, '가져옴')
})

test('세울 이름 — 장부에 없던 이름만 모양을 본다 · 값이 다른 이름의 것이면 알린다', () => {
  assert.equal(guardNames(vocab, [{ coord: '이슈:새 이슈' }]).errors.length, 1)
  assert.equal(guardNames(vocab, [{ coord: 'proc:헬스 체크' }]).errors.length, 0)
  assert.equal(guardNames(vocab, [{ coord: '이슈:ISS-15' }]).warnings.length, 1)
})

test('G4 — 새 문서: 파일 이름 조각 · 갈래의 다른 이름 · 갈래 장부 밖 · 폴더 · 머리 꼴', () => {
  const def = formsOf('')
  assert.equal(def.own, false)
  assert.match(guardNewDoc(def, 'docs/전화통화기록.md').errors[0].message, /회의록/)
  assert.match(guardNewDoc(def, 'docs/2026-10-21_미팅메모.md').errors[0].message, /파일 이름 조각/)
  assert.equal(guardNewDoc(def, 'docs/회의록.md', ['2026-10-21 HNC 통화']).errors.length, 0)
  assert.match(guardNewDoc(def, 'docs/회의록.md', ['HNC 통화']).errors[0].message, /YYYY-MM-DD/)
  assert.equal(guardNewDoc(def, 'docs/게이트웨이 설계.md').errors.length, 0) // 장부가 없으면 갈래 밖 주제 문서는 된다
  const own = formsOf(`| 갈래 | 다른 이름 | 폴더 | 종류 | 이름 | 서식 |
|---|---|---|---|---|---|
| 회의록 | 회의, 미팅, 통화 | 1.2_사업관리 | 사건 | — | 작업기록 |
| 위험및이슈관리대장 | 이슈, 위험 | 1.2_사업관리 | 대장 | \`이슈:*\` | 결정기록 |
`)
  assert.equal(own.own, true)
  assert.equal(parseForms(`| 회의록 | 회의 | — | 사건 | — | — |`)[0].name, '회의록')
  assert.match(guardNewDoc(own, 'docs/게이트웨이 설계.md').errors[0].message, /갈래 장부에 없는/)
  assert.match(guardNewDoc(own, 'docs/회의록.md', ['2026-10-21 x']).errors[0].message, /1\.2_사업관리/)
  const ok = guardNewDoc(own, 'docs/1.2_사업관리/위험및이슈관리대장.md', ['DPMS-ISS-01 — 첫 이슈'])
  assert.deepEqual(ok.errors, [])
  assert.deepEqual(ok.registryRow, { pattern: '이슈:*', doc: 'docs/1.2_사업관리/위험및이슈관리대장.md' })
})

let tmp
const mk = (name) => {
  const d = path.join(tmp, name)
  fs.mkdirSync(path.join(d, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(d, '_vocab.md'), VOCAB)
  fs.writeFileSync(path.join(d, '_managed.md'), MANAGED)
  fs.writeFileSync(path.join(d, 'docs', '대장.md'), '# 대장\n\n이슈 대장.\n\n## DPMS-ISS-15 — 공수 부족\n\n공수가 모자란다.\n')
  return d
}
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-guard-'))
  process.env.HOME = process.env.USERPROFILE = tmp
})
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

test('core save — 거절형: 이름 없는 기록 · 장부 밖 이름 · 갈래 밖 새 문서를 쓰지 않는다', async () => {
  const d = mk('strict')
  await assert.rejects(save(d, { record: { title: '메모', body: '무언가' } }, { user: 'kim', guard: 'strict' }), /touchesEmpty/)
  await assert.rejects(save(d, { record: { title: '메모', body: 'x', touches: ['이슈:공수'] } }, { user: 'kim', guard: 'strict' }), (e) => e.code === 'E_INPUT' && /가까운 이름/.test(e.message) && Array.isArray(e.guard))
  await assert.rejects(save(d, { record: { title: '통화', body: 'x', touchesEmpty: '통화 메모' }, sections: [{ doc: '전화통화기록', heading: '2026-10-21 통화', content: '정한 것: 없음.' }] }, { user: 'kim', guard: 'strict' }), /회의록/)
  assert.equal(fs.readdirSync(path.join(d)).includes('work'), false)
  // 한글 종류 이름을 같은 묶음에서 세우면 받는다
  const r = await save(d, { record: { title: '새 이슈: 인원', body: '인원이 모자란다', touches: ['이슈:DPMS-ISS-20'] }, names: [{ coord: '이슈:DPMS-ISS-20', label: '인원 부족' }] }, { user: 'kim', guard: 'strict' })
  assert.ok(r.id)
  assert.match(fs.readFileSync(path.join(d, '_vocab.md'), 'utf8'), /이슈:DPMS-ISS-20/)
  // 까닭을 적은 이름 없는 기록은 받고 머리말에 남는다
  const r2 = await save(d, { record: { title: '일정 메모', body: '다음 주 회의', touchesEmpty: '항목이 아직 없는 일정 메모' } }, { user: 'kim', guard: 'strict' })
  const w = parseRecord(fs.readFileSync(path.join(d, 'work', `${r2.id}.md`), 'utf8'), `${r2.id}.md`)
  assert.equal(w.touchesEmpty, '항목이 아직 없는 일정 메모')
  // 회의록 갈래 문서는 「언제 · 무엇」 머리로 선다
  const r3 = await save(d, { record: { title: '통화: HNC', body: '정한 것', touchesEmpty: '회의록 항목' }, sections: [{ doc: '회의록', heading: '2026-10-21 HNC 통화', content: '납기를 12월로 정했다.' }] }, { user: 'kim', guard: 'strict' })
  assert.deepEqual(r3.docs, ['docs/회의록.md'])
})

test('core save — 붙잡아 두기: 폐기 이름은 바꿔 달고 이름 없는 기록에 kmd 까닭', async () => {
  const d = mk('hold')
  const r = await save(d, { record: { title: '가져옴', body: 'x', touches: ['이슈:DPMS-ISS-02'] } }, { user: 'kim' })
  const w = parseRecord(fs.readFileSync(path.join(d, 'work', `${r.id}.md`), 'utf8'), `${r.id}.md`)
  assert.deepEqual(w.touches, ['이슈:DPMS-ISS-15'])
  assert.ok(r.guardWarn.some((x) => /폐기/.test(x)))
  const r2 = await save(d, { record: { title: '가져옴2', body: 'x' } }, { user: 'kim', holdWhy: '가져옴 — 파일' })
  assert.equal(r2.touchesEmpty, '가져옴 — 파일')
})

test('saveRecords(받기) — 같은 말 이름을 바꿔 달고 이름 없는 기록은 「받음」 까닭', async () => {
  const d = mk('recv')
  const r = await saveRecords(d, [{ title: '받은 것', body: 'x', touches: ['이슈:ISS-15'] }, { title: '받은 메모', body: 'y' }], { user: 'kim' })
  assert.equal(r.records.length, 2)
  assert.equal(r.records[1].unnamed, true)
  const w = parseRecord(fs.readFileSync(path.join(d, 'work', `${r.records[0].id}.md`), 'utf8'), 'x.md')
  assert.deepEqual(w.touches, ['이슈:DPMS-ISS-15'])
  const w2 = parseRecord(fs.readFileSync(path.join(d, 'work', `${r.records[1].id}.md`), 'utf8'), 'x.md')
  assert.match(w2.touchesEmpty, /받음/)
})

test('지식 점검 — 넣지 않기로 둔 기록은 이름 없는 기록으로 세지 않는다 · 까닭을 적은 기록은 까닭과 함께 센다', async () => {
  const { audit } = await import('../core/guard.js')
  const w = (id, state, extra = {}) => ({ id, title: id, date: '2026-10-30', author: 'kim', touches: [], tags: [], reflects: [], curates: [], reopens: [], state, ...extra })
  const k = { vocab, docs: [], works: [w('둔것', 'kept'), w('까닭', 'nowhere', { touchesEmpty: '갈래 장부만' }), w('빈것', 'nowhere')] }
  const a = audit(k, { sectionOf: () => null, coordsOfSection: () => [] })
  assert.deepEqual(a.unnamed.map((x) => [x.id, x.why]), [['까닭', '갈래 장부만'], ['빈것', null]])
})

test('갈래 서식 안내 — 머리 꼴과 짜임 한 줄(brief · 정리 프롬프트)', async () => {
  const { formGuide } = await import('../core/guard.js')
  const g1 = formGuide({ name: '회의록', kind: '사건', form: '작업기록' })
  assert.match(g1.head, /YYYY-MM-DD/)
  assert.match(g1.body, /누가 · 무엇을 · 정한 것 · 남은 것/)
  const g2 = formGuide({ name: '위험및이슈관리대장', kind: '대장', pattern: '이슈:*', form: null })
  assert.match(g2.head, /값 — 설명/)
  assert.match(g2.body, /항목 하나가 대상 하나/)
})

test('지식 점검 — 같은 말을 둘로: 다른 이름 겹침(고칠 것) · 같은 보이는 이름(알림)', async () => {
  const { audit } = await import('../core/guard.js')
  const v = parseVocab(`## 테이블정의서

- \`테이블정의서:dp_chg_hst\` — 기준정보 변경 이력
  aliases: 변경 이력
- \`테이블정의서:dp_cmd_ldgr\` — 명령 원장

## 납품

- \`납품:변경이력\` — 변경 이력

## 시험

- \`시험:변경이력\` — 변경 이력
- \`시험:요약\` — 요약

## 결과

- \`결과:요약\` — 요약
`)
  const a = audit({ vocab: v, docs: [], works: [] }, { sectionOf: () => null, coordsOfSection: () => [] })
  assert.deepEqual(a.aliasClash.map((x) => [x.word, x.aliasOf]), [['변경이력', ['테이블정의서:dp_chg_hst']]])
  assert.deepEqual(a.sameLabel.map((x) => x.word), ['요약'])
})

test('기록 서식: 칸을 머리 달아 엮는다 · 바뀐 것이 없거나 요약이 길면 거절 · 서식대로 쓴 글은 그대로', () => {
  const r = recordBody({ body: '롤백 순서를 바꿨다.', changes: ['롤백 순서: DB 먼저 → 앱 먼저'], why: '옛 DB 칸을 쓰지 않게', refs: '["커밋 abc1234"]' })
  assert.equal(r.body, '롤백 순서를 바꿨다.\n\n## 바뀐 것\n- 롤백 순서: DB 먼저 → 앱 먼저\n\n## 까닭\n- 옛 DB 칸을 쓰지 않게\n\n## 근거\n- 커밋 abc1234')
  assert.match(recordBody({ body: '줄글만 길게 쓴 기록' }).error, /changes/)
  assert.match(recordBody({ body: '가.\n\n나.', changes: ['x'] }).error, /한두 문장/)
  assert.match(recordBody({ body: 'x'.repeat(301), changes: ['x'] }).error, /300자/)
  assert.match(recordBody({ body: '## 머리\n가', changes: ['x'] }).error, /머리 줄/)
  assert.equal(recordBody({ body: '요약.\n\n## 바뀐 것\n- a' }).body, '요약.\n\n## 바뀐 것\n- a')
})
