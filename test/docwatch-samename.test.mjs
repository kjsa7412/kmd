// 문서 폴더 감시 — 같은 이름 다른 확장자(킥오프.pdf · 킥오프.pptx)가 한 문서를 덮지 않는다(이 PC 에서 본 것: 킥오프 pptx 가 pdf 의 글 151 줄을 빈 슬라이드 머리로 덮음)
//
// 먼저 든 파일은 「이름.md」 · 뒤에 온 같은 이름은 「이름 (확장자).md」 · 다시 바뀌어도 제 자리 · 한쪽을 지우면 그 파일의 문서에만 「원본에 없다」 ·
// 사람이 쓴 같은 이름의 문서도 덮지 않는다

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyDocs } from '../core/docwatch.js'
import { watchedOf } from '../core/watchmark.js'

const R = (f) => fs.readFileSync(f, 'utf8')
const B = (t) => Buffer.from(t, 'utf8')

test('같은 이름 다른 확장자 — 앞 문서를 덮지 않고 「이름 (확장자)」 · 지움은 제 문서에만', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-samename-'))
  try {
    const k = { dir, name: '회의', works: [] }
    const src = { name: '테스트문서' }
    const docs = path.join(dir, 'docs', '테스트')
    // ① 처음 — 킥오프.md 만
    await applyDocs(k, { src, prefix: '테스트', files: [{ rel: '킥오프.md', data: B('# 킥오프\n\n## 순서\n긴 본문.\n') }] })
    assert.equal(watchedOf(R(path.join(docs, '킥오프.md'))).path, '킥오프.md')
    // ② 같은 이름의 txt 가 들어온다 — 「킥오프 (txt).md」 로 · 앞 문서는 그대로
    const r2 = await applyDocs(k, { src, prefix: '테스트', files: [{ rel: '킥오프.txt', data: B('빈 슬라이드') }] })
    assert.equal(r2.docs, 1)
    assert.match(R(path.join(docs, '킥오프.md')), /긴 본문/, '앞 문서를 덮지 않는다')
    assert.equal(watchedOf(R(path.join(docs, '킥오프 (txt).md'))).path, '킥오프.txt')
    assert.equal(r2.rows[0].doc, '테스트/킥오프 (txt)')
    // ③ txt 가 다시 바뀐다 — 제 자리(「킥오프 (txt).md」)에
    await applyDocs(k, { src, prefix: '테스트', files: [{ rel: '킥오프.txt', data: B('고친 슬라이드') }] })
    assert.match(R(path.join(docs, '킥오프 (txt).md')), /고친 슬라이드/)
    assert.match(R(path.join(docs, '킥오프.md')), /긴 본문/)
    // ④ 한 묶음에 같은 이름 둘이 새로 — 하나는 이름 그대로 · 하나는 이름 (확장자)
    await applyDocs(k, { src, prefix: '테스트', files: [{ rel: '일정.md', data: B('# 일정\n\n## 10월\n분석.\n') }, { rel: '일정.csv', data: B('달,일\n10,분석\n') }] })
    assert.equal(watchedOf(R(path.join(docs, '일정.md'))).path, '일정.md')
    assert.equal(watchedOf(R(path.join(docs, '일정 (csv).md'))).path, '일정.csv')
    // ⑤ txt 를 원본에서 지운다 — 그 문서에만 「원본에 없다」 · 같은 이름의 md 문서는 그대로
    const r5 = await applyDocs(k, { src, prefix: '테스트', removed: ['킥오프.txt'] })
    assert.equal(r5.missing, 1)
    assert.ok(watchedOf(R(path.join(docs, '킥오프 (txt).md'))).missing)
    assert.ok(!watchedOf(R(path.join(docs, '킥오프.md'))).missing, '같은 이름의 다른 파일 문서에 「원본에 없다」 를 달지 않는다')
    // ⑥ 사람이 쓴 같은 이름의 문서(표지 없음)도 덮지 않는다
    fs.writeFileSync(path.join(docs, '메모.md'), '# 메모\n\n## 사람이 쓴 것\n그대로.\n')
    await applyDocs(k, { src, prefix: '테스트', files: [{ rel: '메모.md', data: B('# 메모\n\n## 원본\n폴더에서.\n') }] })
    assert.match(R(path.join(docs, '메모.md')), /사람이 쓴 것/)
    assert.equal(watchedOf(R(path.join(docs, '메모 (md).md'))).path, '메모.md')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
