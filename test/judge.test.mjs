// 판정 나누기(저장 승인 설계 P1) — core 판정을 오류(errors) · 경고(warnings · id)로 나누는 함수와 「못 넘음」 으로 접는 덮개(foldJudge)
//
// judgeSection · judgeProposal · judgeEdits · judgeShape · judgeReflect(본문 반영) · planCheck id ·
// 덮개(checkSection · checkProposal · applyEdits · checkShape)가 옛 판정 그대로인지(첫 오류 · 막는 첫 값 경고)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgeSection, checkSection, judgeShape, checkShape, foldJudge } from '../core/gate.js'
import { judgeProposal, checkProposal } from '../core/propose.js'
import { judgeEdits, applyEdits } from '../core/edits.js'
import { judgeReflect, judgeId } from '../core/values.js'
import { sha16 } from '../core/text.js'

// 작은 지식 — 문서 하나(docs/배포절차.md) · 항목 둘
const kOf = (secs) => {
  const d = { id: '배포절차', path: 'docs/배포절차.md', sections: secs.map(([h, body]) => ({ h, body })) }
  return { docs: [d], byDocPath: new Map([[d.path, d]]), vocab: { coords: new Map() }, forms: null }
}
const CUR = '헬스체크 주기는 10초 다.\n재시도는 `3` 번 한다.'
const k = kOf([['헬스체크', CUR], ['롤백', '롤백은 손으로 한다.']])
const at = { doc: 'docs/배포절차.md', heading: '헬스체크' }
const rec = (changed) => ({ title: '헬스체크 주기', body: `## 바뀐 것\n${changed}\n\n## 까닭\n- 늦게 알아챘다\n` })

test('judgeSection: 오류와 값 경고를 따로 · 경고 id 는 같은 입력이면 같다 · checkSection 은 첫 오류 → 첫 경고 차례로 접는다', () => {
  // 넘음 — 오류 · 경고 0
  const good = judgeSection(k, { ...at, base: sha16(CUR), content: CUR.replace('10초', '20초'), record: rec('- 주기: 10초 → 20초') })
  assert.deepEqual(good.errors, [])
  assert.deepEqual(good.warnings, [])
  assert.deepEqual(checkSection(k, { ...at, base: sha16(CUR), content: CUR.replace('10초', '20초'), record: rec('- 주기: 10초 → 20초') }).ok, true)
  // 지어낸 값(30초) · 옛 값 빠짐(10초 를 기록이 말하지 않음) — 경고 둘 · 오류 0
  const inv = { ...at, base: sha16(CUR), content: CUR.replace('10초', '30초'), record: rec('- 주기를 늘렸다') }
  const j = judgeSection(k, inv)
  assert.deepEqual(j.errors, [])
  assert.deepEqual(j.warnings.map((w) => w.code), ['invented', 'lost'])
  assert.deepEqual(j.warnings[0].values, ['30초'])
  assert.match(j.warnings[0].id, /^invented:[0-9a-f]{10}$/)
  assert.equal(judgeSection(k, inv).warnings[0].id, j.warnings[0].id, '같은 입력 → 같은 id')
  assert.notEqual(judgeSection(k, { ...inv, content: CUR.replace('10초', '40초') }).warnings[0].id, j.warnings[0].id, '다른 값 → 다른 id')
  const c = checkSection(k, inv)
  assert.deepEqual(c, { ok: false, code: 'values', why: j.warnings[0].why }, '옛 판정: 첫 값 경고가 「못 넘음」')
  // 빠진 값(기록의 새 값이 글에 없음) — 경고 · spread 면 묻지 않는다
  const miss = { ...at, base: sha16(CUR), content: CUR, record: rec('- 주기: 10초 → 20초') }
  assert.deepEqual(judgeSection(k, miss).warnings.map((w) => w.code), ['missing'])
  assert.deepEqual(judgeSection(k, { ...miss, spread: true }).warnings, [])
  // 지문 어긋남 + 지어낸 값 — 오류(conflict · stale)가 먼저, 경고도 같이 낸다
  const both = judgeSection(k, { ...inv, base: 'deadbeefdeadbeef' })
  assert.deepEqual(both.errors.map((e) => [e.code, e.stale]), [['conflict', true]])
  assert.equal(both.warnings.length, 2)
  const cb = checkSection(k, { ...inv, base: 'deadbeefdeadbeef' })
  assert.equal(cb.code, 'conflict')
  assert.equal(cb.stale, true)
  // 섞인 자리 · 꼴(머리 줄) · 빈 글 · 글 없음
  assert.deepEqual(judgeSection(k, { ...at, base: sha16(CUR), content: '## 새 머리\n글', record: rec('- 없음') }).errors.map((e) => e.code), ['format'])
  assert.deepEqual(judgeSection(k, { ...at, base: sha16(CUR), content: '  ', record: rec('- 없음') }).errors.map((e) => e.code), ['format'])
  assert.deepEqual(checkSection(k, { ...at, content: null }), { ok: false, code: 'format', why: '항목 글이 없다' })
  // foldJudge — 넘기는 경고(pass)
  assert.equal(foldJudge({ errors: [], warnings: [{ code: 'dropped', why: 'x' }] }, { pass: (w) => w.code === 'dropped' }), null)
})

test('judgeEdits: 못 대는 바꿀 곳을 모두 오류로 · applyEdits 는 첫 오류 그대로', () => {
  const t = '첫 줄 10%.\n둘째 줄.\n셋째 줄 1%.'
  const j = judgeEdits(t, [{ find: '없는 글', replace: 'x' }, { find: '줄', replace: 'y' }, { find: '셋째 줄 1%.', replace: '셋째 줄 2%.' }])
  assert.equal(j.text, undefined)
  assert.deepEqual(j.errors.map((e) => e.at), [0, 1], '1째 · 2째 바꿀 곳 둘 다')
  assert.match(j.errors[1].why, /두 번 넘게/)
  const a = applyEdits(t, [{ find: '없는 글', replace: 'x' }, { find: '줄', replace: 'y' }])
  assert.deepEqual(a, { ok: false, why: j.errors[0].why, at: 0 })
  assert.deepEqual(judgeEdits(t, []).errors, [{ code: 'edits', why: '바꿀 곳이 없다' }])
  assert.deepEqual(applyEdits(t, []), { ok: false, why: '바꿀 곳이 없다' })
  const ok = judgeEdits(t, [{ find: '둘째 줄.', replace: '둘째 줄!' }])
  assert.deepEqual(ok, { text: '첫 줄 10%.\n둘째 줄!\n셋째 줄 1%.', errors: [] })
})

test('judgeProposal: 바꿀 곳 · 지문 · 항목 없음은 오류 · 옛 값 남음(remain)은 막지 않는 경고 · checkProposal 은 옛 꼴 그대로', () => {
  const base = sha16(CUR)
  const r = rec('- 재시도: `3` → `5`')
  // `3` 을 `5` 로 바꾸면서 다른 곳에 `3` 을 남긴다 — remain(막지 않음)
  const p = { ...at, base, edits: [{ find: '재시도는 `3` 번 한다.', replace: '재시도는 `5` 번 한다(옛 `3`).' }], record: r }
  const j = judgeProposal(k, p)
  assert.deepEqual(j.errors, [])
  assert.deepEqual(j.warnings.map((w) => w.code), ['remain'])
  assert.match(j.warnings[0].id, /^remain:/)
  const c = checkProposal(k, p)
  assert.equal(c.ok, true)
  assert.deepEqual(c.warnings, [j.warnings[0].why])
  // 지문 없음 · 어긋남 · 항목 없음 · 바꿀 곳 못 댐
  assert.deepEqual(checkProposal(k, { ...p, base: null }), { ok: false, code: 'conflict', stale: true, why: '항목 지문(base)이 없다. section 이 준 base 를 같이 보낸다' })
  assert.equal(judgeProposal(k, { ...p, base: 'x' }).errors[0].code, 'conflict')
  assert.equal(checkProposal(k, { ...p, heading: '없는 머리' }).code, 'notfound')
  const bad = judgeProposal(k, { ...p, edits: [{ find: '없다', replace: 'x' }, { find: '없음2', replace: 'y' }] })
  assert.deepEqual(bad.errors.map((e) => e.code), ['edits', 'edits'])
  assert.ok(bad.errors.every((e) => /^edits:/.test(e.id)))
  const cb = checkProposal(k, { ...p, edits: [{ find: '헬스체크 주기는 10', replace: 'x' }, { find: '없음2', replace: 'y' }] })
  assert.equal(cb.code, 'edits')
  assert.match(cb.why, /2째 바꿀 곳/)
  // 지어낸 값 — 경고(judge) · 옛 판정은 못 넘음(values)
  const inv = { ...p, edits: [{ find: '10초', replace: '10초, 최대 99초' }], record: rec('- 최대를 정했다') }
  assert.deepEqual(judgeProposal(k, inv).warnings.map((w) => w.code), ['invented'])
  assert.equal(checkProposal(k, inv).code, 'values')
})

test('judgeShape: 출처 지문은 오류(값은 보지 않음) · 지어낸 값 · 잃은 값 · 바뀐 문장은 경고 · checkShape 는 옛 꼴 그대로', () => {
  const src = '헬스체크 주기는 10초 다. 재시도는 3 번 한다. 실패하면 롤백을 건다.'
  const ks = kOf([['헬스체크', src]])
  const s = { doc: 'docs/배포절차.md', h: '헬스체크', base: sha16(src) }
  // 나누기: 값은 다 옮기고 문장 하나를 바꿈 → 경고 dropped 하나 · 넘음
  const unit = { sources: [s], targets: [{ doc: 'docs/배포절차.md', h: '헬스체크 주기', content: '헬스체크 주기는 10초 다.' }, { doc: 'docs/배포절차.md', h: '재시도', content: '재시도는 3 번 한다. 실패하면 되돌린다.' }] }
  const j = judgeShape(ks, unit)
  assert.deepEqual(j.errors, [])
  assert.deepEqual(j.warnings.map((w) => w.code), ['dropped'])
  assert.deepEqual(checkShape(ks, unit), { ok: true, warnings: [j.warnings[0].why] })
  // 지어낸 값(99초) · 잃은 값(3)
  const bad = { ...unit, targets: [{ doc: 'docs/배포절차.md', h: '헬스체크 주기', content: '헬스체크 주기는 10초 다. 최대 99초.' }] }
  const jb = judgeShape(ks, bad)
  assert.deepEqual(jb.errors, [])
  assert.deepEqual(jb.warnings.map((w) => w.code), ['invented', 'lost', 'dropped'])
  assert.deepEqual(jb.warnings[1].values, ['3'])
  assert.deepEqual(checkShape(ks, bad), { ok: false, code: 'values', why: jb.warnings[0].why })
  assert.equal(judgeShape(ks, bad).warnings[0].id, jb.warnings[0].id, '같은 입력 → 같은 id')
  // 출처 바뀜 — 오류 하나만(값은 보지 않는다)
  const stale = judgeShape(ks, { ...bad, sources: [{ ...s, base: 'x' }] })
  assert.deepEqual(stale.errors.map((e) => [e.code, e.stale]), [['conflict', true]])
  assert.deepEqual(stale.warnings, [])
  assert.deepEqual(checkShape(ks, { ...bad, sources: [{ ...s, base: 'x' }] }), { ok: false, code: 'conflict', stale: true, why: '그사이 출처 항목이 바뀌었다: 헬스체크' })
  // 꼴 오류는 모두(빈 글 · 머리 줄) — 옛 판정은 첫 것
  const fmt = { sources: [s], targets: [{ doc: 'docs/배포절차.md', h: '가', content: ' ' }, { doc: 'docs/배포절차.md', h: '나', content: '## 머리\n글' }] }
  assert.deepEqual(judgeShape(ks, fmt).errors.map((e) => e.code), ['format', 'format'])
  assert.deepEqual(checkShape(ks, fmt), { ok: false, code: 'format', why: '「가」 글이 비었다' })
})

test('judgeReflect(본문 반영): 「바뀐 것」 값이 이은 항목 글 · 머리 어디에도 없으면 오류 · 경위만', () => {
  const r = rec('- 주기: 10초 → 20초')
  const item = (text, extra = {}) => ({ doc: 'docs/배포절차.md', heading: '헬스체크', text, ...extra })
  // 항목 글 없이 기록만(글은 아직 10초) — 오류
  const no = judgeReflect(r, [item(CUR)])
  assert.deepEqual(no.values, ['20초'])
  assert.deepEqual(no.errors.map((e) => [e.code, e.values]), [['unreflected', ['20초']]])
  assert.match(no.errors[0].id, /^unreflected:[0-9a-f]{10}$/)
  assert.equal(judgeReflect(r, [item(CUR)]).errors[0].id, no.errors[0].id, '같은 입력 → 같은 id')
  // 새 글에 값이 있으면 넘음 · 여러 항목 가운데 하나에만 있어도 넘음 · 머리에 있어도 넘음
  assert.deepEqual(judgeReflect(r, [item(CUR.replace('10초', '20초'))]).errors, [])
  assert.deepEqual(judgeReflect(r, [item(CUR), { doc: 'docs/배포절차.md', heading: '롤백', text: '20초 뒤 롤백' }]).errors, [])
  assert.deepEqual(judgeReflect(r, [{ doc: 'docs/배포절차.md', heading: '주기 20초', text: '' }]).errors, [])
  // 경위만(값 없음) — 넘음
  assert.deepEqual(judgeReflect(rec('- 주기 정한 까닭을 적었다'), [item(CUR)]).errors, [])
  // 이은 항목이 없다 — 오류(기록 모음으로 빠져나가지 않게)
  assert.match(judgeReflect(r, []).errors[0].why, /이은 항목이 없어/)
  // judgeId — 차례 · NFC 와 상관없이 같은 재료면 같다
  assert.equal(judgeId('x', 'a', 'b'), judgeId('x', 'a', 'b'))
  assert.notEqual(judgeId('x', 'a', 'b'), judgeId('y', 'a', 'b'))
})
