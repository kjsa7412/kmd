// 수준 표시(작성기준 v1.2 5-1절) — 읽기 · 그리기 · 옮기기(docfmt --levels) · 짜임 알림
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { levelOf, toLevels, verifyLevels, lintLevels } from '../core/levels.js'
import { render } from '../server/views.js'
import { lintDoc, docfmtDir } from '../core/docformat.js'

test('levelOf: 여덟 수준 · 맨 왼쪽만 · 가로줄 · 굵은 글은 아니다', () => {
  const n = (s) => levelOf(s)?.n ?? null
  assert.deepEqual(['1. a', '1.1. a', '1.1.1. a', '1) a', '1.1) a', '1.1.1) a', '- a', '* a'].map(n), [1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(['  - a', '---', '* * *', '**굵게**', '1.5 기준', '2026-10-26 회의', '1.1.1.1. a'].map(n), [null, null, null, null, null, null, null])
  assert.deepEqual(levelOf('3.1. 준비'), { n: 2, mark: '3.1.', text: '준비' })
})

test('그리기: 수준 줄은 목록으로 넘기지 않는다 · 들이지 않고 표시는 쓴 그대로 · 표 · 울타리 · 인용은 그대로', () => {
  const h = render(null, 'docs/a.md', '1. 준비 **굵게**\n3) 셋째부터\n1.1) 세부\n- 나열\n* 덧말\n\n| a |\n|---|\n| 1. x |\n\n```\n1. 코드\n```\n\n> - 인용\n')
  assert.match(h, /<div class="lv l1" data-lv="준비 굵게"><span class="lvm">1\.<\/span><span class="lvx">준비 <strong>굵게<\/strong><\/span><\/div>/)
  assert.match(h, /<span class="lvm">3\)<\/span>/, '번호를 다시 매기지 않는다')
  assert.match(h, /class="lv l5"[\s\S]*class="lv l7"[\s\S]*class="lv l8"/)
  assert.doesNotMatch(h, /<ol|<li>준비|<li>셋째/)
  assert.match(h, /<td>1\. x<\/td>/)
  assert.match(h, /<code>1\. 코드\n<\/code>/)
  assert.match(h, /<blockquote>\n<ul>\n<li>인용<\/li>/)
})

test('옮기기: ### · #### 는 수준 표시로 · 옛 번호는 그대로 · 없으면 항목 안에서 센다 · 목록은 들이지 않게', () => {
  const src = [
    '# 제목', '', '요약.', '',
    '## 설치: 3. 설치 순서', '', '### 3.1 준비', '', '- a', '  - b', '* c', '',
    '1. 하나', '2. 둘', '   - 둘의 덧말', '   1. 둘-하나', '      이어지는 줄', '',
    '   ```', '   code', '     inner', '   ```', '',
    '### 화면', '#### 버튼', '',
    '## 다음', '', '#### 바로 아래', '', '| 1. x |', '|---|', '', '> - 인용', '',
    '<!-- kmd:참고 · kmd 가 적고 고친다. 손으로 고치지 않는다 -->', '**참고**', '', '- 설치', '  - 2026-10-26 [x](../work/x.md)', '<!-- /kmd:참고 -->',
  ].join('\n')
  const r = toLevels(src)
  const out = r.text.split('\n')
  assert.equal(out[6], '3.1. 준비', '옛 번호를 표시로')
  assert.deepEqual(out.slice(8, 11), ['- a', '* b', '- c'])
  assert.deepEqual(out.slice(12, 17), ['1) 하나', '2) 둘', '- 둘의 덧말', '2.1) 둘-하나', '이어지는 줄'])
  assert.deepEqual(out.slice(18, 22), ['```', 'code', '  inner', '```'], '목록 안 울타리는 같이 왼쪽으로 · 안의 상대 들여쓰기는 그대로')
  assert.deepEqual(out.slice(23, 25), ['3.2. 화면', '3.2.1. 버튼'], '번호 없는 머리는 앞 번호에 이어 센다')
  assert.equal(out[28], '1. 바로 아래', '위 단계 없이 내려온 머리는 한 단계 위로 · 항목마다 새로')
  assert.deepEqual(out.slice(30, 34), ['| 1. x |', '|---|', '', '> - 인용'], '표 · 인용은 그대로')
  assert.ok(r.text.includes('- 설치\n  - 2026-10-26 [x](../work/x.md)'), '참고 블록은 그대로')
  assert.deepEqual(verifyLevels(src, r.text), { ok: true })
  assert.deepEqual(lintLevels(out), [])
  // 글이 바뀌면 검사가 막는다
  assert.equal(verifyLevels(src, r.text.replace('하나', '한')).ok, false)
  assert.equal(verifyLevels(src, r.text.replace('## 다음', '## 다른')).ok, false)
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

test('docfmt --levels: 옮기고 이력 하나 · 다시 걸어도 옮긴 문서는 그대로', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-levels-'))
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true })
  const doc = '# 운영\n\n운영 절차다.\n\n## 설치\n\n### 준비\n\n1. 하나\n2. 둘\n   - 덧말\n'
  fs.writeFileSync(path.join(dir, 'docs', '운영.md'), doc)
  const dry = await docfmtDir(dir, { dry: true, levels: true })
  assert.equal(dry.files, 1)
  assert.equal(fs.readFileSync(path.join(dir, 'docs', '운영.md'), 'utf8'), doc, 'dry 는 쓰지 않는다')
  const r = await docfmtDir(dir, { levels: true, now: new Date('2026-11-05T15:00:00') })
  assert.equal(r.levels, 1)
  assert.match(r.log, /^2026-1105-수준-표시-옮김$/)
  assert.equal(fs.readFileSync(path.join(dir, 'docs', '운영.md'), 'utf8'), '# 운영\n\n운영 절차다.\n\n## 설치\n\n1. 준비\n\n1) 하나\n2) 둘\n- 덧말\n')
  assert.match(fs.readFileSync(path.join(dir, 'log', `${r.log}.md`), 'utf8'), /- 운영: 수준 표시 · 소제목 1 · 목록 줄 3/)
  // 다시 — 「1. 준비」 를 「1) 준비」 로 또 바꾸지 않는다
  const again = await docfmtDir(dir, { levels: true })
  assert.equal(again.files, 0)
  assert.equal(again.commit, null)
})
