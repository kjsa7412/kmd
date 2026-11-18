// 지식 생성 가드(core/guard.js) — G1 모양 · G2 등재 · G3 자리 · G4 새 문서 · 거절형 / 붙잡아 두기 · core save 연결

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseVocab } from '../core/vocab.js'
import { newNameWhy, resolveName, guardRecord, guardNames, guardNewDoc, formsOf, parseForms, nearNames, recordBody } from '../core/guard.js'
import * as G from '../core/guard.js'
import { save } from '../core/save.js'
import { parseRecord } from '../core/frontmatter.js'

const VOCAB = `# 항목 장부

## 이슈

- \`이슈:DPMS-ISS-15\`: 공수 부족 (필요 공수가 1명 가용 공수의 4.3배)
  aliases: ISS-15, 공수 부족
- \`이슈:DPMS-ISS-02\`: SCADA 연계 방식 결정
  deprecated: 2026-10-16 → 이슈:DPMS-ISS-15: 합침

## term

- \`term:PLC\`: 현장 설비를 실제로 제어하는 장치
- \`proc:헬스 체크\`: 옛 모양(빈칸) 이름
`
const MANAGED = `# 문서 장부

| 이름 | 문서 | 항목 |
|---|---|---|
| \`이슈:*\` | \`docs/대장.md\` | \`## {값}\` |
| \`term:*\` | \`docs/용어집.md\` | \`## {값}\` |
`
const vocab = parseVocab(VOCAB)

test('G1 — 새 항목 모양: 한글 종류는 되고 값의 빈칸 · 문장 · 긴 글은 안 된다', () => {
  assert.equal(newNameWhy('이슈:DPMS-ISS-20'), null)
  assert.equal(newNameWhy('게이트웨이DB:gt_link'), null)
  assert.equal(newNameWhy('table:rp_mst'), null)
  assert.match(newNameWhy('이슈:공수 부족 필요 공수가 4.3배'), /빈칸/)
  assert.match(newNameWhy('Table:x'), /종류/)
  assert.match(newNameWhy('term:' + 'a'.repeat(61)), /60자/)
  assert.match(newNameWhy('term:__proto__'), /쓸 수 없는/)
  assert.match(newNameWhy('PLC'), /종류:값/)
})

test('G2 — 항목 풀기: 같음 · 폐기 → 새 항목 · 같은 말(별칭) · 모름', () => {
  assert.deepEqual(resolveName(vocab, '이슈:DPMS-ISS-15'), { coord: '이슈:DPMS-ISS-15', how: 'same' })
  assert.deepEqual(resolveName(vocab, '이슈:DPMS-ISS-02'), { coord: '이슈:DPMS-ISS-15', how: 'deprecated' })
  assert.deepEqual(resolveName(vocab, '이슈:ISS-15'), { coord: '이슈:DPMS-ISS-15', how: 'alias' })
  assert.equal(resolveName(vocab, '이슈:DPMS-ISS-99').coord, null)
  assert.ok(nearNames(vocab, '공수').includes('이슈:DPMS-ISS-15'))
})

test('거절형(strict) — 장부 밖 · 폐기 · 항목 없는 기록 · 둘 다 보냄을 거절하고 후보를 말한다', () => {
  const g1 = guardRecord(vocab, { touches: ['이슈:공수부족'] }, { mode: 'strict' })
  assert.equal(g1.errors.length, 1)
  assert.match(g1.errors[0].message, /장부에 없다/)
  assert.match(guardRecord(vocab, { touches: ['이슈:DPMS-ISS-02'] }).errors[0].message, /폐기된 항목.*DPMS-ISS-15/)
  assert.match(guardRecord(vocab, { touches: [] }).errors[0].message, /touchesEmpty/)
  assert.equal(guardRecord(vocab, { touches: [], touchesEmpty: '사업 전체 일정 메모 — 항목이 없다' }).errors.length, 0)
  assert.match(guardRecord(vocab, { touches: ['term:PLC'], touchesEmpty: 'x' }).errors[0].message, /둘 중 하나/)
  // 옛 모양 항목(장부에 있다)은 그대로 받는다
  assert.equal(guardRecord(vocab, { touches: ['proc:헬스 체크'] }).errors.length, 0)
  // 자리가 있는 기록(화면의 항목 고침 at/ · 이력 · 정리)은 건드린 항목이 없어도 된다
  assert.equal(guardRecord(vocab, { touches: [], tags: ['at/대장#개요'] }).errors.length, 0)
  assert.equal(guardRecord(vocab, { touches: [], tags: ['edit'] }).errors.length, 0)
  // 세울 항목으로 실어 둔 것은 장부 밖이어도 받는다(모양은 본다)
  assert.equal(guardRecord(vocab, { touches: ['이슈:DPMS-ISS-20'] }, { proposed: new Set(['이슈:DPMS-ISS-20']) }).errors.length, 0)
  assert.equal(guardRecord(vocab, { touches: ['이슈:새 이슈'] }, { proposed: new Set(['이슈:새 이슈']) }).errors.length, 1)
})

test('붙잡아 두기(hold) — 폐기 · 같은 말은 바꿔 달고, 장부 밖은 남기고, 건드린 항목이 없으면 까닭을 단다', () => {
  const g = guardRecord(vocab, { touches: ['이슈:DPMS-ISS-02', '이슈:ISS-15', '이슈:모름'] }, { mode: 'hold' })
  assert.deepEqual(g.errors, [])
  assert.deepEqual(g.touches, ['이슈:DPMS-ISS-15', '이슈:모름'])
  assert.equal(g.fixes.length, 2)
  assert.deepEqual(g.outside, ['이슈:모름'])
  const e = guardRecord(vocab, { touches: [] }, { mode: 'hold', why: '가져옴' })
  assert.equal(e.touchesEmpty, '가져옴')
})

test('세울 항목 — 장부에 없던 것만 모양을 본다 · 값이 다른 항목의 것이면 알린다', () => {
  assert.equal(guardNames(vocab, [{ coord: '이슈:새 이슈' }]).errors.length, 1)
  assert.equal(guardNames(vocab, [{ coord: 'proc:헬스 체크' }]).errors.length, 0)
  assert.equal(guardNames(vocab, [{ coord: '이슈:ISS-15' }]).warnings.length, 1)
})

test('저장 제안 입력 모양(P-D32) · near(P-D10): 정규화 같음 · 비슷함 · 문턱 아래', () => {
  assert.equal(G.proposeInputWhy({ record: {}, distinct: ['a'], excluded: [{ name: 'x', why: 'y' }], kinds: ['job'], forms: [{ name: '회의록' }], names: [{ coord: 'a:b', label: 'b' }] }), null)
  for (const bad of [[], { proposal: 'x' }, JSON.parse('{"constructor": 1}'), { excluded: [{}] }, { kinds: ['A B'] }, { names: [JSON.parse('{"coord": "a:b", "label": "b", "__proto__": 1}')] }]) assert.equal(typeof G.proposeInputWhy(bad), 'string', JSON.stringify(bad))
  assert.deepEqual(G.nearOf(['배포 절차'], '배포절차').same, ['배포 절차'])
  assert.deepEqual(G.nearOf(['배포절차'], '배포절차서').similar, ['배포절차'])
  assert.deepEqual(G.nearOf(['배'], '배포'), { same: [], similar: [] })
})

test('G4 — 새 문서: 파일 이름 조각 · 갈래의 별칭 · 갈래 장부 밖 · 폴더 · 머리 꼴', () => {
  const def = formsOf('')
  assert.equal(def.own, false)
  // 기본 갈래는 판정에 쓰지 않는다(지식 생성 하네스 H-O4): 갈래 장부가 없으면 갈래 줄도 없고 새 문서는 열림이다
  assert.deepEqual([def.rows.length, def.closed, def.natures.size], [0, false, 0])
  assert.equal(guardNewDoc(def, 'docs/전화통화기록.md').errors.length, 0)
  assert.equal(guardNewDoc(def, 'docs/장애 대응 절차.md', ['1차 대응']).errors.length, 0) // 이름의 낱말(장애)로 사건 갈래에 끌지 않는다
  assert.match(guardNewDoc(def, 'docs/2026-10-21_미팅메모.md').errors[0].message, /파일 이름 조각/)
  assert.equal(guardNewDoc(def, 'docs/회의록.md', ['2026-10-21 HNC 통화']).errors.length, 0)
  assert.equal(guardNewDoc(def, 'docs/게이트웨이 설계.md').errors.length, 0)
  const table = `| 갈래 | 별칭 | 폴더 | 종류 | 항목 | 서식 |
|---|---|---|---|---|---|
| 회의록 | 회의, 미팅, 통화 | 1.2_사업관리 | 사건 | — | 작업기록 |
| 위험및이슈관리대장 | 이슈, 위험 | 1.2_사업관리 | 대장 | \`이슈:*\` | 결정기록 |
`
  // 「새 문서:」 줄이 없으면 갈래 줄이 있어도 열림이다(옛 「닫힘」 읽기는 걷었다 · O-3 · 옛 장부는 core/oldform.js 가 「닫음」 줄을 적는다)
  assert.equal(formsOf(table).closed, false)
  assert.equal(guardNewDoc(formsOf(table), 'docs/게이트웨이 설계.md').errors.length, 0)
  const own = formsOf(`- 새 문서: 닫음\n\n${table}`)
  assert.equal(own.own, true)
  assert.equal(own.closed, true)
  assert.match(guardNewDoc(own, 'docs/전화통화기록.md').errors[0].message, /회의록/) // 품기 맞춤은 모으는 갈래(사건 · 보고 · 대장)에만
  assert.match(guardNewDoc(own, 'docs/1.2_사업관리/회의록.md', ['HNC 통화']).errors[0].message, /YYYY-MM-DD/)
  // 벗어남 옵션(depart)은 2판과 함께 걷었다: 닫힌 갈래 밖 문서 · 파일 이름 조각은 그대로 걸린다
  assert.match(guardNewDoc(own, 'docs/회의 운영 규칙.md', ['주간 회의']).errors[0].message, /갈래 장부에 없는 문서|회의록/)
  assert.match(guardNewDoc(own, 'docs/회의 운영 규칙_v2.md', []).errors[0].message, /파일 이름 조각/)
  // 「새 문서: 열림」 줄이 있으면 갈래 밖 문서도 선다 · 문서 성격 표는 갈래 줄이 아니다(세 칸)
  const open = formsOf('# 갈래 장부\n\n- 새 문서: 열림\n\n| 갈래 | 별칭 | 폴더 | 종류 | 항목 | 서식 |\n|---|---|---|---|---|---|\n| 회의록 | 회의, 미팅 | - | 사건 | - | - |\n| 설계서 | 설계 | - | 대상 | - | - |\n\n## 문서 성격\n\n| 문서 | 성격 | 요약 |\n|---|---|---|\n| 게이트웨이 설계 | 대상 | 게이트웨이의 구성 요소를 적는다 |\n')
  assert.deepEqual([open.own, open.closed, open.rows.map((f) => f.name), [...open.natures.keys()]], [true, false, ['회의록', '설계서'], ['게이트웨이 설계']])
  assert.equal(guardNewDoc(open, 'docs/화면 설계.md').errors.length, 0) // 「설계」 별칭을 품지만 성격 대상 갈래는 이름이 같을 때만 맞는다
  assert.match(guardNewDoc(open, 'docs/고객 미팅 메모.md').errors[0].message, /회의록/)
  assert.equal(formsOf('- 새 문서: 닫음\n').closed, true)
  assert.equal(parseForms(`| 회의록 | 회의 | — | 사건 | — | — |`)[0].name, '회의록')
  assert.match(guardNewDoc(own, 'docs/게이트웨이 설계.md').errors[0].message, /갈래 장부에 없는/)
  assert.match(guardNewDoc(own, 'docs/회의록.md', ['2026-10-21 x']).errors[0].message, /1\.2_사업관리/)
  const ok = guardNewDoc(own, 'docs/1.2_사업관리/위험및이슈관리대장.md', ['DPMS-ISS-01: 첫 이슈'])
  assert.deepEqual(ok.errors, [])
  assert.match(guardNewDoc(own, 'docs/1.2_사업관리/위험및이슈관리대장.md', ['DPMS-ISS-01 — 첫 이슈']).errors[0].message, /값: 설명/) // 줄표 꼴은 받지 않는다
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

test('core save — 거절형: 항목 없는 기록 · 장부 밖 항목 · 갈래 밖 새 문서를 쓰지 않는다', async () => {
  const d = mk('strict')
  await assert.rejects(save(d, { record: { title: '메모', body: '무언가' } }, { user: 'kim', guard: 'strict' }), /touchesEmpty/)
  await assert.rejects(save(d, { record: { title: '메모', body: 'x', touches: ['이슈:공수'] } }, { user: 'kim', guard: 'strict' }), (e) => e.code === 'E_INPUT' && /가까운 항목/.test(e.message) && Array.isArray(e.guard))
  fs.writeFileSync(path.join(d, '_forms.md'), '# 갈래 장부\n\n- 새 문서: 열림\n\n| 갈래 | 별칭 | 폴더 | 종류 | 항목 | 서식 |\n|---|---|---|---|---|---|\n| 회의록 | 회의, 미팅, 통화 | - | 사건 | - | 작업기록 |\n')
  await assert.rejects(save(d, { record: { title: '통화', body: 'x', touchesEmpty: '통화 메모' }, sections: [{ doc: '전화통화기록', heading: '2026-10-21 통화', content: '정한 것: 없음.' }] }, { user: 'kim', guard: 'strict' }), /회의록/)
  assert.equal(fs.readdirSync(path.join(d)).includes('work'), false)
  // 한글 종류 이름을 같은 묶음에서 세우면 받는다
  const r = await save(d, { record: { title: '새 이슈: 인원', body: '인원이 모자란다', touches: ['이슈:DPMS-ISS-20'] }, names: [{ coord: '이슈:DPMS-ISS-20', label: '인원 부족' }] }, { user: 'kim', guard: 'strict' })
  assert.ok(r.id)
  assert.match(fs.readFileSync(path.join(d, '_vocab.md'), 'utf8'), /이슈:DPMS-ISS-20/)
  // 까닭을 적은 항목 없는 기록은 받고 머리말에 남는다
  const r2 = await save(d, { record: { title: '일정 메모', body: '다음 주 회의', touchesEmpty: '항목이 아직 없는 일정 메모' } }, { user: 'kim', guard: 'strict' })
  const w = parseRecord(fs.readFileSync(path.join(d, 'work', `${r2.id}.md`), 'utf8'), `${r2.id}.md`)
  assert.equal(w.touchesEmpty, '항목이 아직 없는 일정 메모')
  // 회의록 갈래 문서는 「언제 · 무엇」 머리로 선다
  const r3 = await save(d, { record: { title: '통화: HNC', body: '정한 것', touchesEmpty: '회의록 항목' }, sections: [{ doc: '회의록', heading: '2026-10-21 HNC 통화', content: '납기를 12월로 정했다.' }] }, { user: 'kim', guard: 'strict' })
  assert.deepEqual(r3.docs, ['docs/회의록.md'])
})

test('core save — 붙잡아 두기: 폐기 항목은 바꿔 달고 항목 없는 기록에 kmd 까닭', async () => {
  const d = mk('hold')
  const r = await save(d, { record: { title: '가져옴', body: 'x', touches: ['이슈:DPMS-ISS-02'] } }, { user: 'kim' })
  const w = parseRecord(fs.readFileSync(path.join(d, 'work', `${r.id}.md`), 'utf8'), `${r.id}.md`)
  assert.deepEqual(w.touches, ['이슈:DPMS-ISS-15'])
  assert.ok(r.guardWarn.some((x) => /폐기/.test(x)))
  const r2 = await save(d, { record: { title: '가져옴2', body: 'x' } }, { user: 'kim', holdWhy: '가져옴: 파일' })
  assert.equal(r2.touchesEmpty, '가져옴: 파일')
})

test('core save — 장부만 바꾼 저장은 이력(log/ · ledger) · 항목을 세우며 건드린 기록은 기록(work/)', async () => {
  const d = mk('ledger')
  const r = await save(d, { record: { title: '갈래 장부: 회의록 폴더', body: 'x', touchesEmpty: '갈래 장부만 고쳤다' }, forms: [{ name: '회의록', folder: '1.2_사업관리', kind: '사건' }] }, { user: 'kim' })
  assert.equal(r.record, `log/${r.id}.md`)
  const w = parseRecord(fs.readFileSync(path.join(d, 'log', `${r.id}.md`), 'utf8'), `${r.id}.md`)
  assert.ok(w.tags.includes('ledger'))
  const r2 = await save(d, { record: { title: '이름만', body: 'x', touchesEmpty: '항목 장부만' }, names: [{ coord: '이슈:DPMS-ISS-15', label: '공수 부족', doc: 'docs/대장.md', heading: 'DPMS-ISS-15 — 공수 부족' }] }, { user: 'kim' })
  assert.match(r2.record, /^log[/]/)
  const r3 = await save(d, { record: { title: '새 이슈: 인원', body: '인원이 모자란다', touches: ['이슈:DPMS-ISS-21'] }, names: [{ coord: '이슈:DPMS-ISS-21', label: '인원 부족' }] }, { user: 'kim' })
  assert.match(r3.record, /^work[/]/)
  await assert.rejects(async () => save(d, { record: { title: '흉내', body: 'x', touchesEmpty: 'y', tags: ['ledger'] } }, { user: 'kim' }), /kmd 가 쓰는 태그/)
  const { logKind } = await import('../server/views.js')
  assert.equal(logKind(w), '장부')
  assert.equal(logKind({ tags: ['structure'], title: '문서 짜임 바꿈' }), '짜임')
})

test('지식 점검 — 항목 없는 기록 · 까닭을 적은 기록은 까닭과 함께 센다', async () => {
  const { audit } = await import('../core/guard.js')
  const w = (id, state, extra = {}) => ({ id, title: id, date: '2026-10-30', author: 'kim', touches: [], tags: [], reflects: [], curates: [], reopens: [], state, ...extra })
  const k = { vocab, docs: [], works: [w('까닭', 'old', { touchesEmpty: '갈래 장부만' }), w('빈것', 'old')] }
  const a = audit(k, { sectionOf: () => null, coordsOfSection: () => [] })
  assert.deepEqual(a.unnamed.map((x) => [x.id, x.why]), [['까닭', '갈래 장부만'], ['빈것', null]])
})

test('갈래 서식 안내 — 머리 꼴과 짜임 한 줄(brief · 정리 프롬프트)', async () => {
  const { formGuide } = await import('../core/guard.js')
  const g1 = formGuide({ name: '회의록', kind: '사건', form: '작업기록' })
  assert.match(g1.head, /YYYY-MM-DD/)
  assert.match(g1.body, /누가 · 무엇을 · 정한 것 · 남은 것/)
  const g2 = formGuide({ name: '위험및이슈관리대장', kind: '대장', pattern: '이슈:*', form: null })
  assert.match(g2.head, /값: 설명/)
  assert.match(g2.body, /항목 하나가 대상 하나/)
})

test('지식 점검 — 같은 말을 둘로: 별칭 겹침(고칠 것) · 같은 라벨(알림)', async () => {
  const { audit } = await import('../core/guard.js')
  const v = parseVocab(`## 테이블정의서

- \`테이블정의서:dp_chg_hst\`: 기준정보 변경 이력
  aliases: 변경 이력
- \`테이블정의서:dp_cmd_ldgr\`: 명령 원장

## 납품

- \`납품:변경이력\`: 변경 이력

## 시험

- \`시험:변경이력\`: 변경 이력
- \`시험:요약\`: 요약

## 결과

- \`결과:요약\`: 요약
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

test('머리 꼴 「값: 설명」 — 값으로 항목을 찾고 · 폐기 줄의 새 항목 · 깨진 머리', async () => {
  const { headingMatches } = await import('../core/sections.js')
  const { audit } = await import('../core/guard.js')
  assert.equal(headingMatches('OPS-001: 결재 알림 오류', 'OPS-001'), true)
  assert.equal(headingMatches('OPS-001 — 결재 알림 오류', 'OPS-001'), true)
  assert.equal(headingMatches('OPS-0012: 다른 것', 'OPS-001'), false)
  const v = parseVocab('## 이슈\n\n- `이슈:A`: 옛 이슈\n  deprecated: 2026-10-16 → 이슈:B: 합침\n- `이슈:B`: 새 이슈\n')
  assert.deepEqual(resolveName(v, '이슈:A'), { coord: '이슈:B', how: 'deprecated' })
  assert.equal(v.coords.get('이슈:B').label, '새 이슈')
  const doc = (hs) => ({ id: 'd', sections: hs.map((h) => ({ h })) })
  const a = audit({ vocab: v, docs: [doc(['수집기: (Collector · CollectorService)', '권한: · 관리자 유지', '빈 설명:', '권한 — · 관리자', 'OPS-004: (정책)경상북도 연구 조회 오류', 'OPS-005: 연차 확인'])], works: [] }, { sectionOf: () => null, coordsOfSection: () => [] })
  assert.deepEqual(a.brokenHead.map((x) => x.heading), ['수집기: (Collector · CollectorService)', '권한: · 관리자 유지', '빈 설명:'])
})
