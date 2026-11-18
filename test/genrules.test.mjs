// 생성 룰(core/genrules.js) — 조문 대조(지식 생성 하네스 설계 9-3): 기준 문서 = 데이터 · 판과 지문 · 짧은 판이 긴 판의 부분 · 조문 번호 · 씨앗 종류 · 채널 블록.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GEN_RULES_REV, GEN_RULES_HASH, rulesHash, ARTICLES, NATURES, SEED_KINDS, seedKind, PROFILES, genRulesText, genRulesBlock, articleText, ruleIds, isRuleId, ruleTitles, headLines } from '../core/genrules.js'
import { FORMS, COMMON_RULES, KINDS } from '../core/forms.js'
import { check } from '../scripts/genrules.mjs'

test('판과 지문: 글이 바뀌면 판을 올린다 · 작성기준 6-4 는 데이터에서 뽑은 글이다', () => {
  assert.equal(rulesHash(), GEN_RULES_HASH[GEN_RULES_REV], '조문 글이 바뀌었다: GEN_RULES_REV 를 올리고 GEN_RULES_HASH 에 새 지문을 더한다')
  assert.ok(check(), '작성기준 6-4 가 데이터와 다르다: node scripts/genrules.mjs --write')
})

test('조문: R0 ~ R9 · 두 겹 · 「꼭」 줄 · 긴 판과 짧은 판', () => {
  assert.deepEqual(ARTICLES.map((a) => a.id), ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9'])
  assert.deepEqual(ARTICLES.filter((a) => a.layer === '첫 겹').map((a) => a.id), ['R1', 'R4', 'R6'])
  assert.deepEqual(ARTICLES.filter((a) => a.layer === '둘째 겹').map((a) => a.id), ['R2', 'R3', 'R7', 'R8', 'R9'])
  for (const a of ARTICLES) assert.ok(a.core.length >= 4, `${a.id} 의 「꼭」 줄`)
  const long = genRulesText({ long: true })
  const short = genRulesText({ long: false })
  assert.ok(long.startsWith(`생성 룰 ${GEN_RULES_REV}판\n`))
  // 짧은 판 = 긴 판에서 「헷갈릴 때」 묶음만 뺀 것(따로 쓴 글이 아니다)
  const longLines = new Set(long.split('\n'))
  for (const l of short.split('\n')) assert.ok(longLines.has(l), `짧은 판에만 있는 줄: ${l}`)
  assert.ok(!short.includes('헷갈릴 때:'))
  const dropped = long.split('\n').filter((l) => !short.split('\n').includes(l))
  const aid = new Set(['헷갈릴 때:', ...ARTICLES.flatMap((a) => a.aid)])
  for (const l of dropped) assert.ok(aid.has(l), `「헷갈릴 때」 가 아닌 줄이 짧은 판에서 빠졌다: ${l}`)
  // 답을 가르는 줄은 「꼭」 줄에 있다(걷기에서 답을 가른 줄)
  for (const id of ['2-4 ', '2-5 ', '3-5 ', '4-3 ', '8-2 ', '9-1 ']) assert.ok(short.split('\n').some((l) => l.startsWith(id)), id)
  assert.ok(long.length < 12000 && short.length < long.length)
})

test('성격 아홉: R4-1 의 물음은 서식 계약의 pick 한 곳에서 온다 · 계약 글이 R4-3 과 같은 답을 준다', () => {
  assert.deepEqual(NATURES, KINDS.filter((k) => k !== '기록'))
  const r4 = articleText(ARTICLES.find((a) => a.id === 'R4'))
  for (const n of NATURES) {
    assert.ok(FORMS[n].pick && FORMS[n].head, n)
    assert.ok(r4.includes(`  ${n}: ${FORMS[n].pick}`), n)
  }
  assert.ok(!r4.includes('{{PICK}}'))
  // 가르는 물음은 서로 다른 첫마디로 시작한다(ask 는 서술 · 사건 · 결정이 모두 「무엇을 정했고」 라 가르지 못한다)
  assert.equal(new Set(NATURES.map((n) => FORMS[n].pick)).size, 9)
  assert.ok(/대상의 값과 정의는 대상 항목/.test(COMMON_RULES.join('\n')))
  assert.ok(!/결정은 결정 항목, 정의는 대상 항목/.test(COMMON_RULES.join('\n')))
  assert.ok(FORMS.사건.rules.some((r) => /대상의 값이면 그 대상 항목이 정본/.test(r)))
  assert.ok(headLines().split('\n').length === 10)
})

test('조문 번호: 닫힌 목록 · 씨앗 종류 · 채널 블록(닫힌 칸)', () => {
  const ids = ruleIds()
  for (const id of ['R1', 'R1-1', 'R2-1', 'R2-6', 'R3-5', 'R4-1', 'R5-1', 'R6-3', 'R7-3', 'R8-5', 'R9-3']) assert.ok(ids.has(id), id)
  assert.ok(!isRuleId('R2-9') && !isRuleId('R10') && isRuleId('r4-1'))
  assert.equal(ruleTitles().length, 10)
  // 씨앗 낱말은 성격마다 하나 이상 · 낱말은 겹치지 않는다 · 뜻 한 줄이 있다
  const all = NATURES.flatMap((n) => SEED_KINDS[n].map((s) => s.kind))
  assert.equal(new Set(all).size, all.length)
  for (const n of NATURES) for (const s of SEED_KINDS[n]) assert.ok(s.gist.length >= 8 && s.gist.length <= 60, s.kind)
  assert.deepEqual(seedKind('회의'), { nature: '사건', gist: SEED_KINDS.사건[0].gist })
  assert.equal(seedKind('term'), null)
  // R5-1 다 의 낱말이 씨앗 데이터와 같다
  const r5 = ARTICLES.find((a) => a.id === 'R5').core.find((l) => l.includes('씨앗 낱말'))
  for (const k of all) assert.ok(r5.includes(k), `R5-1 다 에 없는 씨앗 낱말: ${k}`)
  // 채널 블록 — 덧붙임은 닫힌 칸뿐이다
  for (const [name, p] of Object.entries(PROFILES)) {
    assert.deepEqual(Object.keys(p).filter((k) => !['rev', 'only', 'materials', 'output', 'limits'].includes(k)), [], name)
    const b = genRulesBlock({ profile: name })
    assert.ok(b.startsWith(`생성 룰 ${GEN_RULES_REV}판`), name)
    assert.equal(b.includes('헷갈릴 때:'), p.rev === 'long', name)
  }
  assert.ok(genRulesBlock({ profile: 'agent' }).includes('재료: brief'))
  assert.ok(!genRulesBlock({ profile: 'shape' }).includes('R8 판례를'))
  assert.throws(() => genRulesBlock({ profile: 'x' }))
})
