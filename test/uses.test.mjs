// 글 속 이름 찾기(그래프 「가리킨다」 · 항목의 「이 항목을 쓰는 곳」) — 낱말 경계 · 짧은 이름 · 같이 쓰는 이름 · 흔한 말
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mentions, usesNames, USES_MIN } from '../server/views.js'

test('낱말 경계: 영문 · 숫자 이름은 앞뒤가 이어지면 세지 않는다', () => {
  assert.equal(mentions('화면 PSA010 을 고친다', 'PSA010'), true)
  assert.equal(mentions('화면 PSA0101 을 고친다', 'PSA010'), false, '뒤에 숫자가 붙으면 다른 이름')
  assert.equal(mentions('OPS-209 이슈', 'OPS'), false, '하이픈 뒤 숫자가 이어지면 다른 이름(OPS-209)')
  assert.equal(mentions('OPS 담당 이슈', 'OPS'), true)
  assert.equal(mentions('OPS-209 이슈', 'OPS-2'), false)
  assert.equal(mentions('XPSA010 에서', 'PSA010'), false, '앞에 글자가 붙으면 다른 이름')
  assert.equal(mentions('A-PSA010', 'PSA010'), false, '앞이 영문-이면 이어진 이름')
  assert.equal(mentions('(PSA010)', 'PSA010'), true)
})

test('한글 이름은 뒤에 붙는 조사를 허락하고 앞은 끊겨야 한다', () => {
  assert.equal(mentions('헬스 체크를 돌린다', '헬스 체크'), true)
  assert.equal(mentions('표시상태값', '상태값'), false)
  assert.equal(mentions('- 인터록이 걸리면', '인터록'), true)
})

test('이름 후보: 장부 값 · 라벨 · 별칭 가운데 USES_MIN 글자 이상', () => {
  assert.equal(USES_MIN, 3)
  assert.deepEqual(usesNames({ coord: '화면설계서:DPA010', name: '상황 지도', aliases: ['상황판', 'PS'] }), ['DPA010', '상황 지도', '상황판'])
  assert.deepEqual(usesNames({ coord: '연계API:명령', name: '명령', aliases: [] }), [], '두 글자 흔한 말은 이름으로 쓰지 않는다')
  assert.deepEqual(usesNames({ coord: null, name: '배포 절차', aliases: [] }), ['배포 절차'])
})
