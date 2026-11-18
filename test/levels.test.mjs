// 수준 표시(작성기준 v1.2 5-1절): 읽기 · 그리기 · 짜임 알림
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { levelOf, lintLevels } from '../core/levels.js'
import { render } from '../server/views.js'
import { lintDoc } from '../core/docformat.js'

test('levelOf: 여덟 수준 · 맨 왼쪽만 · 가로줄 · 굵은 글은 아니다', () => {
  const n = (s) => levelOf(s)?.n ?? null
  assert.deepEqual(['1. a', '1.1. a', '1.1.1. a', '1) a', '1.1) a', '1.1.1) a', '- a', '* a'].map(n), [1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(['  - a', '---', '* * *', '**굵게**', '1.5 기준', '2026-10-26 회의', '1.1.1.1. a'].map(n), [null, null, null, null, null, null, null])
  assert.deepEqual(levelOf('3.1. 준비'), { n: 2, mark: '3.1.', text: '준비' })
})

test('그리기(문서 표시): 수준 줄은 목록으로 넘기지 않는다 · 번호는 쓴 그대로 · 단만큼 들임 · 점 · 표 · 울타리 · 인용은 그대로', () => {
  const h = render(null, 'docs/a.md', '1. 준비 **굵게**\n3) 셋째부터\n1.1) 세부\n- 나열\n* 덧말\n\n| a |\n|---|\n| 1. x |\n\n```\n1. 코드\n```\n\n> - 인용\n')
  assert.match(h, /<div class="lv l1" data-lv="준비 굵게"><span class="lvm">1\.<\/span><span class="lvx">준비 <strong>굵게<\/strong><\/span><\/div>/)
  assert.match(h, /<span class="lvm">3\)<\/span>/, '번호를 다시 매기지 않는다')
  assert.match(h, /class="lv l5 d2"[\s\S]*class="lv l7 d3"><span class="lvm" data-m="dot"[\s\S]*class="lv l8 d4"><span class="lvm" data-m="ring"/)
  assert.match(h, /class="lv l4 d1"><span class="lvm">3\)<\/span>/, '「1)」 은 위 점 번호 한 단 아래')
  assert.doesNotMatch(h, /<ol|<li>준비|<li>셋째/)
  assert.match(h, /<td>1\. x<\/td>/)
  assert.match(h, /<code>1\. 코드\n<\/code>/)
  assert.match(h, /<blockquote>\n<ul>\n<li>인용<\/li>/)
})

test('짜임 알림: 새 ### 소제목 · 들여쓴 목록 · 수준 건너뜀(항목의 첫 덩이는 어느 수준이든)', () => {
  const codes = (t) => lintLevels(t.split('\n')).map((x) => x.code)
  assert.deepEqual(codes('## a\n### 소제목\n- x\n  - y'), ['sub-head', 'indent-list'])
  assert.deepEqual(codes('## a\n1. 덩이\n1.1.1. 건너뜀'), ['level-skip'])
  assert.deepEqual(codes('## a\n1) 하나\n1.1.1) 건너뜀'), ['level-skip'])
  assert.deepEqual(codes('## a\n3.1. 옛 번호\n3.2. 다음\n3.2.1. 아래\n1) 낱낱\n1.1) 세부\n- 나열\n* 덧말'), [])
  assert.deepEqual(codes('## a\n```\n  - 울타리\n### 안\n```'), [])
  const all = lintDoc('# 제목\n\n요약.\n\n## a\n\n### 소제목\n')
  assert.ok(all.some((x) => x.code === 'sub-head'), 'lintDoc 도 같이 알린다')
})

test('그리기(문서 표시): 라벨 줄은 라벨 칸 + 내용 칸 · 아래 「*」 줄과 표는 그 칸 안 · 남은 것 줄 나눔 · 머리 · 문단에서 닫음', () => {
  const src = '첫 문장.\n\n- **누가**: 사경진 과장\n- **진도**:\n\n| 구분 | 계획 |\n|---|---|\n| a | 1% |\n\n- **한 일**:\n* 설계: 갱신\n- **남은 것**:\n* 회신 확인: 권순용 차장 · 기한 -\n* 준비: - · 기한 2026-11-13\n\n문단.\n\n## 다음\n\n- 나열\n'
  const h = render(null, 'docs/a.md', src)
  assert.equal((h.match(/<div/g) || []).length, (h.match(/<\/div>/g) || []).length, '짝')
  assert.match(h, /<div class="lbr" data-t="lbRow"><div class="lbn">누가<\/div><div class="lbv"><p>사경진 과장<\/p>\n<\/div><\/div>/)
  assert.match(h, /<div class="lbn">진도<\/div><div class="lbv">\n<div class="tblwrap">[\s\S]*?<\/table><\/div>\n<\/div><\/div>/, '표는 라벨 칸 안')
  assert.match(h, /<div class="lbn">한 일<\/div><div class="lbv">\n<div class="lv l8"><span class="lvm" data-m="dot"[^>]*><\/span><span class="lvx">설계: 갱신<\/span><\/div>\n<\/div><\/div>/)
  assert.match(h, /회신 확인<span class="lvt"> · 권순용 차장 · 기한 없음<\/span>/)
  assert.match(h, /준비<span class="lvt"> · 기한 2026-11-13<\/span>/, '맡은 이 「-」 는 뺀다')
  assert.match(h, /<\/div><\/div>\n<p>문단\.<\/p>/, '문단에서 닫는다')
  assert.match(h, /<div class="lv l7"><span class="lvm" data-m="dot"/, '머리 뒤는 단을 처음부터')
})
