// 작성 가이드(agent/skills/kmd-build/작성가이드.md) — 항목 글의 모양을 kmd 가 지키는 것.
//
// 경과(항목 끝 **경과** · 기록 링크 한 줄씩)는 저장이 단다 — 옛 줄은 보낸 글에 없어도 지키고 넣은 기록의 줄을 더한다 ·
// 정리 검사는 소제목 ### 을 받고 항목 머리 ## 는 거절한다 · 코드 바뀜 기록은 from · append 로 넣지 못한다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { save } from '../core/save.js'
import { loadKnowledge } from '../core/knowledge.js'
import { splitLog, joinLog, logLine, parseDoc } from '../core/sections.js'
import { check, material } from '../core/tidy.js'
import { expandSections } from '../core/excerpt.js'
import { copyDir } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, dir
const load = () => loadKnowledge({ id: 'dpms', name: 'dpms', dir })
const sec = (doc, h) => parseDoc(fs.readFileSync(path.join(dir, 'docs', `${doc}.md`), 'utf8'), '').sections.find((s) => s.h === h)

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-guide-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  dir = path.join(tmp, 'dpms')
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), dir)
})
after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('경과 가르기: 끝의 목록만 경과 · 뒤에 글이 오면 본문의 굵은 글', () => {
  assert.deepEqual(splitLog('본문\n\n**경과**\n- 2026-10-26 [가](../work/a.md)\n'), { body: '본문', log: ['- 2026-10-26 [가](../work/a.md)'] })
  assert.deepEqual(splitLog('**경과**\n- 줄\n\n이어지는 글'), { body: '**경과**\n- 줄\n\n이어지는 글', log: [] })
  assert.equal(joinLog('본문', []), '본문')
  assert.equal(joinLog('본문', ['- 줄']), '본문\n\n**경과**\n- 줄')
  // 링크는 그 문서에서 본 상대 경로 · 괄호는 링크를 끊지 않게
  assert.equal(logLine('docs/a/X.md', { id: '2026-1027-가(나)', title: '가: 나', date: '2026-10-27 10:00' }), '- 2026-10-27 [가](../../work/2026-1027-%EA%B0%80%28%EB%82%98%29.md)')
})

test('저장이 경과를 단다. 사람의 기록은 그 자신 · 옛 줄은 보낸 글에 없어도 지킨다 · 정리는 넣은 기록', async () => {
  const k0 = await load()
  const base = (await import('../core/text.js')).sha16(k0.byDocPath.get('docs/배포절차.md').sections.find((s) => s.h === '카나리').body)
  const a = await save(dir, { record: { title: '카나리: 첫 30분 20%', body: '첫 30분 요청 20%', touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', content: '첫 30분 요청 20% 로 보낸다.', base }] }, { user: 'lee' })
  let s = sec('배포절차', '카나리')
  assert.match(s.body, /\*\*경과\*\*\n- \d{4}-\d{2}-\d{2} \[카나리\]\(\.\.\/work\/.+\.md\)$/)
  assert.ok(s.body.includes(`/${encodeURI(a.id)}.md)`))
  // 경과 없이 다시 보내도 옛 줄은 남고 새 줄이 더해진다
  const b = await save(dir, { record: { title: '카나리: 첫 1시간', body: '첫 1시간 20%', touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', content: '첫 1시간 요청 20% 로 보낸다.' }] }, { user: 'lee' })
  s = sec('배포절차', '카나리')
  const { body, log } = splitLog(s.body)
  assert.equal(body, '첫 1시간 요청 20% 로 보낸다.')
  assert.equal(log.length, 2)
  assert.ok(log[1].includes(encodeURI(b.id)))
  // 정리(kmd-auto · reflects)는 넣은 기록의 줄 — 정리 이력 자신은 달지 않는다
  const w = await save(dir, { record: { title: '롤백: 5분 안', body: '롤백은 5분 안에 끝낸다', touches: ['proc:롤백'] } }, { user: 'lee' })
  const c = await save(dir, { record: { title: '정리: 롤백', body: '넣음', touches: ['proc:롤백'], tags: ['curate-llm'], reflects: [w.id] }, sections: [{ coord: 'proc:롤백', content: '롤백은 5분 안에 끝낸다.' }] }, { user: 'kmd-auto', system: true })
  const rl = splitLog(sec('배포절차', '롤백').body).log
  assert.equal(rl.length, 1)
  assert.ok(rl[0].includes(encodeURI(w.id)) && !rl[0].includes(encodeURI(c.id)))
  // 원천이 쓰는 저장(kmd)은 달지 않는다
  await save(dir, { record: { title: '가져옴: 표', body: '표', tags: ['sources'] }, sections: [{ doc: 'docs/운영.md', heading: '알람', content: '원천의 글' }] }, { user: 'kmd', system: true })
  assert.equal(sec('운영', '알람').body.trim(), '원천의 글')
})

test('정리 검사: 소제목 ### 은 받고 항목 머리 ## 는 거절 · Claude 는 경과 없는 본문을 받는다', async () => {
  await save(dir, { record: { title: '되돌리기: 순서', body: '이전 판으로 되돌린다 3단계', touches: ['proc:되돌리기'] } }, { user: 'lee' })
  const k = await load()
  const g = material(k).find((x) => x.coord === 'proc:되돌리기')
  assert.ok(g && !/\*\*경과\*\*/.test(g.content))
  const draft = (content) => ({ content, used: g.records.map((r) => r.id), left: [] })
  assert.equal(check(k, g, draft(`${g.content}\n\n### 순서\n이전 판으로 되돌린다 3단계`)).ok, true)
  assert.match(check(k, g, draft(`${g.content}\n\n## 순서\n이전 판으로 되돌린다 3단계`)).why, /머리 · 표지/)
})

test('코드 바뀜 기록은 from · append 로 넣지 못한다. 지금 동작으로 고친 글 전체만', async () => {
  const k = await load()
  const w = { id: 'c1', tags: ['code-change'], body: '# 커밋\n\n**무엇이 바뀌었나**\n…\n\n```diff\n+x\n```' }
  assert.throws(() => expandSections(k, w, [{ coord: 'proc:롤백', from: '*' }]), /from · append 로 넣지 않는다/)
  assert.throws(() => expandSections(k, w, [{ coord: 'proc:롤백', content: '덧붙임', append: true }]), /from · append 로 넣지 않는다/)
  // 넣은 파일의 append 는 경과 앞에 붙는다
  const f = { id: 'f1', tags: ['ingest/a.md'], body: '보탤 글' }
  const [x] = expandSections(k, f, [{ coord: 'proc:롤백', from: '*', append: true }])
  const { body, log } = splitLog(x.content)
  assert.ok(body.endsWith('보탤 글'))
  assert.equal(log.length, 1)
})
