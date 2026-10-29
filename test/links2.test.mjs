// 화면 링크(Q80): 항목 앵커를 대상 문서의 ## 이름 · GitHub 꼴 slug(## · ###)로 맞추고 못 찾으면 「없는 항목」 ·
// 이름 열쇠(Q78): `kind:id` 가 이름 장부에 있으면 이름 링크(openItem) · 없으면 그대로 · 코드 울타리 안은 그대로

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { render, linkTarget, slugOf } from '../server/views.js'

const k = {
  id: 'K',
  docs: [
    { id: '화면', path: 'docs/화면.md', intro: '', sections: [{ h: '준비', body: '' }, { h: 'DPA020 — 원격', body: '### 원격 제어 확인 창 (DPA020 · DPC010 공통)\n본문\n```\n### 울타리 안\n```' }] },
    { id: '배포', path: 'docs/배포.md', intro: '', sections: [{ h: '롤백', body: '' }] },
  ],
  vocab: { coords: new Map([['screen:ACA011', { label: '지출처리' }], ['ops:OLD', { label: '옛', deprecated: true }]]) },
  byWork: new Map(),
  atts: [],
}

test('slug: GitHub 꼴', () => {
  assert.equal(slugOf('원격 제어 확인 창 (DPA020 · DPC010 공통)'), '원격-제어-확인-창-dpa020--dpc010-공통')
})

test('항목 앵커: ## 이름 · slug ## · slug ### · 없는 항목', () => {
  assert.deepEqual(linkTarget(k, 'docs/화면.md', '#준비'), { t: 'item', d: '화면', h: '준비' })
  assert.deepEqual(linkTarget(k, 'docs/화면.md', '#준비'.normalize('NFD')), { t: 'item', d: '화면', h: '준비' })
  assert.deepEqual(linkTarget(k, 'docs/화면.md', '#dpa020--원격'), { t: 'item', d: '화면', h: 'DPA020 — 원격' })
  assert.deepEqual(linkTarget(k, 'docs/화면.md', '#원격-제어-확인-창-dpa020--dpc010-공통'), { t: 'item', d: '화면', h: 'DPA020 — 원격', sub: '원격 제어 확인 창 (DPA020 · DPC010 공통)' })
  assert.deepEqual(linkTarget(k, 'docs/화면.md', '배포.md#롤백'), { t: 'item', d: '배포', h: '롤백' })
  assert.equal(linkTarget(k, 'docs/화면.md', '#울타리-안').miss, true)
  assert.equal(linkTarget(k, 'docs/화면.md', '배포.md#없음').miss, true)
  const h = render(k, 'docs/화면.md', '[a](#원격-제어-확인-창-dpa020--dpc010-공통) [b](배포.md#없음)')
  assert.match(h, /class="dlink item" data-a="openDoc" data-k="K" data-d="화면" data-h="DPA020 — 원격" data-sub="원격 제어 확인 창 \(DPA020 · DPC010 공통\)"/)
  assert.match(h, /class="dlink item missing" data-a="openDoc" data-k="K" data-d="배포" title="없는 항목"/)
})

test('이름 열쇠: 장부에 있으면 이름 링크 · 없거나 버린 이름 · 울타리 · 링크 글 안은 그대로', () => {
  const h = render(k, 'docs/화면.md', '흐름 `screen:ACA011` · `screen:NONE` · `ops:OLD` · [`screen:ACA011`](배포.md)\n\n```\n`screen:ACA011`\n```')
  assert.match(h, /<span class="ilink coord" data-a="openItem" data-k="K" data-n="screen:ACA011" data-pv="item\|K\|screen:ACA011" title="screen:ACA011">지출처리<\/span>/)
  assert.match(h, /<code>screen:NONE<\/code>/)
  assert.match(h, /<code>ops:OLD<\/code>/)
  assert.match(h, /<a [^>]*><code>screen:ACA011<\/code><\/a>/)
  assert.match(h, /<pre><code>`screen:ACA011`/)
  // 지식을 모르면 그대로
  assert.match(render(null, 'docs/화면.md', '`screen:ACA011`'), /<code>screen:ACA011<\/code>/)
})
