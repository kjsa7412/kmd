// 가져온 것 → 기록 · 출처(2026-10-26).
//
// DB 의 두 번째 확인이 항목을 모두 「사라짐」 으로 세어 멈추지 않는다(첫 확인의 키는 「문서」, 항목 장부가 선 뒤는 「docs/문서.md」) ·
// html 은 머리 · 표 · 목록을 살린 md 로 · Claude 분석은 「무엇 · 핵심 · 정한 것 · 남은 것 + 본문」 기록으로(커밋은 첫 줄 · 차이를 지킨다) ·
// 기록 → 간 문서 · 문서 → 온 기록이 항목 표지(applied)와 reflects 로 이어진다(넣은 파일 기록은 건드린 항목이 없어도).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { planOut } from '../core/sources.js'
import { htmlToMd } from '../core/importer.js'
import { fileRecord, commitAnalyzed, demote } from '../core/analyze.js'
import { commitRecord } from '../core/codechange.js'
import { loadKnowledge } from '../core/knowledge.js'
import { docView, recView } from '../server/views.js'

test('DB 두 번째 확인: 항목 장부가 선 뒤에도 같은 항목이다(멈추지 않는다)', async () => {
  const tables = Array.from({ length: 30 }, (_, i) => `t${i}`)
  const sec = (h) => ({ h, body: '', applied: null })
  const doc = { path: 'docs/테이블 정의.md', sections: tables.map((t) => sec(t)) }
  const k = { byDocPath: new Map([[doc.path, doc]]) }
  const src = { name: 'db', rules: [{ rule: 'dbtables', into: { doc: '테이블 정의' } }] }
  // 첫 확인이 남긴 키(「테이블 정의」) · 이번 확인은 항목 장부 자리(「docs/테이블 정의.md」) — 한 테이블만 칼럼이 늘었다
  const prev = tables.map((t) => `테이블 정의\n${t}`)
  const items = { dbtables: tables.map((t) => ({ key: t, doc: 'docs/테이블 정의.md', cols: ['칼럼'], rows: [[t === 't3' ? 'testcol' : 'id']] })) }
  const plan = await planOut(k, src, items, { asof: '2026-10-26 14:00', s0: { items: prev, sent: {} } })
  assert.equal(plan.vanished, 0)
  assert.equal(plan.added, 0)
  assert.equal(plan.brake, false)
  assert.ok(plan.items.every((x) => x.startsWith('docs/테이블 정의.md\n')))
})

test('html → md: 머리 · 표 · 목록 · 코드 · 굵게를 살리고 꾸밈은 뺀다', () => {
  const md = htmlToMd(`<!doctype html><html><head><title>x</title><style>p{}</style></head><body><nav>목차 1 2 3</nav>
    <h1>PLC 연계 규격서</h1><p>게이트웨이가 <b>Modbus TCP</b>로 &amp; 읽는다</p>
    <h2>값</h2><table><tr><th>항목</th><th>값</th></tr><tr><td>포트</td><td>502</td></tr><tr><td>주기</td><td>0.5<br>초</td></tr></table>
    <ul><li>하나</li><li>둘<ol><li>둘-1</li></ol></li></ul><pre><code>a = 1
b = 2</code></pre><button>복사</button><script>alert(1)</script></body></html>`)
  assert.match(md, /^# PLC 연계 규격서$/m)
  assert.match(md, /게이트웨이가 \*\*Modbus TCP\*\*로 & 읽는다/)
  assert.match(md, /^## 값$/m)
  assert.match(md, /^\| 항목 \| 값 \|$/m)
  assert.match(md, /^\| 포트 \| 502 \|$/m)
  assert.match(md, /^- 하나$/m)
  assert.match(md, /^ {2}1\. 둘-1$/m)
  assert.match(md, /```\na = 1\nb = 2\n```/)
  assert.doesNotMatch(md, /목차|복사|alert|doctype|p\{\}/)
})

test('넣은 파일 기록: 분석(무엇 · 핵심 · 정한 것 · 남은 것) + 본문(머리를 내린 원문) · 답이 틀리면 null', () => {
  const src = { file: '설계/DPMS_3.2.1_PLC연계규격서_초안.html', author: 'kim', date: '2026-10-26 13:29', md: '# DPMS_3.2.1\n\n# 규격\n\n## 값\n\n| a | b |\n| --- | --- |\n| 포트 | 502 |\n\n```\n# 코드 속 머리는 그대로\n```' }
  const r = fileRecord(src, { title: 'PLC 연계 규격서 v0.6', kind: '규격서', summary: '게이트웨이와 PLC 사이의 규격이다.', points: ['포트 502'], decisions: ['2026-10-14 PLC 직결 확정'], open: [] })
  assert.equal(r.title, 'PLC 연계 규격서 v0.6: 넣은 파일')
  for (const h of ['## 무엇인가', '## 핵심', '## 정한 것', '## 본문']) assert.ok(r.body.includes(`\n${h}\n`), h)
  assert.ok(!r.body.includes('## 남은 것'))
  assert.match(r.body, /^### 규격$/m)
  assert.match(r.body, /^#### 값$/m)
  assert.match(r.body, /^\| 포트 \| 502 \|$/m)
  assert.match(r.body, /^# 코드 속 머리는 그대로$/m)
  assert.equal(fileRecord(src, { title: 'x', summary: 'y', points: [] }), null)
  assert.equal(fileRecord(src, null), null)
  assert.equal(demote('# 제목\n\n# 하나'), '### 하나')
})

test('커밋 기록: Claude 분석을 앞에 · 첫 줄(바뀐 값)과 차이는 그대로 · 답이 틀리면 원래 기록', () => {
  const d = { patch: '-  retry: 3초\n+  retry: 5초', plus: 1, minus: 1, added: ['  retry: 5초'], removed: ['  retry: 3초'] }
  const k = { vocab: { coords: new Map() }, registry: { rows: [] }, docs: [], works: [] }
  const c = { sha: 'abc1234', author: 'kjsa', date: '2026-10-26 13:00', subject: 'fix' }
  const rec = { ...commitRecord(k, { name: 'gw' }, c, [{ rel: 'cfg/app.yml', status: 'changed', d }]), touches: [] }
  const a = commitAnalyzed(rec, { title: '재시도 간격을 5초로', summary: '재시도 간격을 늘렸다.', changes: [{ what: 'retry 3초 → 5초', why: '현장 회선이 느리다' }], impact: ['명령 재시도'], check: [] }, { src: 'gw', c })
  assert.equal(a.title, '재시도 간격을 5초로: gw abc1234')
  assert.equal(a.body.split('\n')[0], rec.body.split('\n')[0])
  assert.match(a.body.split('\n')[0], /^바뀐 값: 3초 → 5초/)
  assert.match(a.body, /## 무엇이 바뀌었나\n재시도 간격을 늘렸다\./)
  assert.match(a.body, /- retry 3초 → 5초: 왜: 현장 회선이 느리다/)
  assert.match(a.body, /커밋 메시지: fix/)
  assert.match(a.body, /```diff\n# cfg\/app\.yml\n-  retry: 3초/)
  assert.equal(commitAnalyzed(rec, { title: 't', summary: 's', changes: [] }, { src: 'gw', c }), rec)
})

test('코드 바뀜 기록: 넣은 것이 없으면 「기록」(none 에 갇히지 않는다) · 저장 문이 넣었으면(put) 「넣음」 · 정리 reflects 는 상태를 가르지 않는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-code-'))
  try {
    fs.mkdirSync(path.join(dir, 'work'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'log'))
    const rec = (id, extra = '') => `---\nid: ${id}\ntitle: 바뀜 — src abc1234\ndate: 2026-10-26 16:11\nauthor: kmd\ntouches:\n  - org:HNC\ntags:\n  - code-change\n${extra}---\n\n# 바뀜\n\n글\n`
    fs.writeFileSync(path.join(dir, 'work', 'c1.md'), rec('c1'))
    fs.writeFileSync(path.join(dir, 'work', 'c2.md'), rec('c2').replace('  - code-change\n', '  - code-change\n  - put\n'))
    fs.writeFileSync(path.join(dir, 'work', 'c3.md'), rec('c3'))
    fs.writeFileSync(path.join(dir, 'log', 't.md'), '---\nid: t\ntitle: 정리\ndate: 2026-10-26 16:20\nauthor: kmd-auto\ntags:\n  - curate-llm\nreflects:\n  - c3\n---\n\n# 정리\n\n넣었다\n')
    const k = await loadKnowledge({ id: 't', name: 't', dir })
    assert.equal(k.byWork.get('c1').state, 'old', '넣은 것이 없는 기록은 「기록」')
    assert.equal(k.byWork.get('c2').state, 'in')
    assert.equal(k.byWork.get('c3').state, 'old', '옛 정리 reflects 는 상태를 가르지 않는다(oldform 이 put 으로 굳혔다)')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('출처: 넣은 파일 기록 → 간 문서 · 문서 → 온 기록(정리 기록의 reflects · 항목 표지)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-origin-'))
  try {
    fs.mkdirSync(path.join(dir, 'docs'))
    fs.mkdirSync(path.join(dir, 'work'))
    fs.mkdirSync(path.join(dir, 'log'))
    fs.writeFileSync(path.join(dir, 'docs', 'PLC 연계 규격서.md'), '# PLC 연계 규격서\n\n## 개요\n<!-- applied: 2026-1026-정리 -->\n글\n\n## 본문\n<!-- applied: 2026-1026-정리 -->\n글\n\n## 손으로\n글\n')
    fs.writeFileSync(path.join(dir, 'work', '2026-1026-넣음.md'), '---\nid: 2026-1026-넣음\ntitle: 규격서 — 넣은 파일\ndate: 2026-10-26 13:29\nauthor: kim\ntags:\n  - ingest/규격서.html\n  - put\n---\n\n# 규격서 — 넣은 파일\n\n글\n\n## 넣은 것\n- docs/PLC 연계 규격서.md › 개요 (새 항목)\n- docs/PLC 연계 규격서.md › 본문 (새 항목)\n')
    fs.writeFileSync(path.join(dir, 'log', '2026-1026-정리.md'), '---\nid: 2026-1026-정리\ntitle: 규격서 — 문서에 새 항목 2\ndate: 2026-10-26 13:43\nauthor: kmd-auto\ntags:\n  - curate-llm\nreflects:\n  - 2026-1026-넣음\n---\n\n# 규격서 — 문서에 새 항목 2\n\n넣었다\n')
    const k = await loadKnowledge({ id: 't', name: 't', dir })
    const d = docView(k, 'PLC 연계 규격서')
    assert.deepEqual(d.origins.map((x) => [x.id, x.how, x.hs]), [['2026-1026-넣음', 'rec', ['개요', '본문']], ['2026-1026-정리', 'kmd', ['개요', '본문']]])
    const r = recView(k, '2026-1026-넣음')
    assert.equal(r.state, 'in')
    assert.deepEqual(r.went, [{ id: 'PLC 연계 규격서', title: 'PLC 연계 규격서', hs: ['개요', '본문'] }])
    assert.deepEqual(r.via.map((x) => x.id), ['2026-1026-정리'])
    assert.deepEqual(r.ingest, { read: false })
    const t = recView(k, '2026-1026-정리')
    assert.deepEqual(t.from.map((x) => x.id), ['2026-1026-넣음'])
    assert.equal(t.went.length, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('기록 → 간 문서: 나중 기록이 같은 항목을 고쳐 표지가 옮겨 가도 「문서에 들어감」 기록의 문서는 남는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-went-'))
  try {
    fs.mkdirSync(path.join(dir, 'docs'))
    fs.mkdirSync(path.join(dir, 'work'))
    fs.writeFileSync(path.join(dir, '_vocab.md'), '# 좌표 어휘\n\n## 화면\n- `화면:A`: 상황 지도\n- `화면:B`: 공정 도식\n')
    fs.writeFileSync(path.join(dir, '_managed.md'), '# 관리\n\n| 항목 | 문서 | 머리 |\n| --- | --- | --- |\n| `화면:A` | `docs/화면.md` | `## A: 상황 지도` |\n| `화면:B` | `docs/화면.md` | `## B: 공정 도식` |\n')
    fs.writeFileSync(path.join(dir, 'docs', '화면.md'), '# 화면\n\n## A: 상황 지도\n<!-- applied: 2026-1102-뒤 -->\n글\n\n## B: 공정 도식\n<!-- applied: 2026-1102-뒤 -->\n글\n')
    const rec = (id, date) => `---\nid: ${id}\ntitle: ${id}\ndate: ${date}\nauthor: kim\ntouches:\n  - 화면:A\n  - 화면:B\ntags:\n  - put\n---\n\n# ${id}\n\n글\n\n## 넣은 것\n- docs/화면.md › A: 상황 지도\n- docs/화면.md › B: 공정 도식\n`
    fs.writeFileSync(path.join(dir, 'work', '2026-1031-앞.md'), rec('2026-1031-앞', '2026-10-31 08:42'))
    fs.writeFileSync(path.join(dir, 'work', '2026-1102-뒤.md'), rec('2026-1102-뒤', '2026-11-02 13:51'))
    const k = await loadKnowledge({ id: 't', name: 't', dir })
    const r = recView(k, '2026-1031-앞')
    assert.equal(r.state, 'in')
    assert.deepEqual(r.went, [{ id: '화면', title: '화면', hs: ['A: 상황 지도', 'B: 공정 도식'] }])
    // 글 그대로(P-D12 · 정정 기록처럼 글을 바꾸지 않고 이은 항목만) — 들어감이고 그 문서가 「글 그대로」 로 보인다
    fs.writeFileSync(path.join(dir, 'work', '2026-1103-이음.md'), '---\nid: 2026-1103-이음\ntitle: 이음\ndate: 2026-11-03 09:00\nauthor: kim\ntouches:\n  - 화면:A\ntags:\n  - put\n---\n\n# 이음\n\n경위\n\n## 이은 항목\n- docs/화면.md › A: 상황 지도\n')
    const k2 = await loadKnowledge({ id: 't', name: 't', dir })
    const s = recView(k2, '2026-1103-이음')
    assert.equal(s.state, 'in')
    assert.deepEqual(s.went, [{ id: '화면', title: '화면', hs: ['A: 상황 지도'], same: ['A: 상황 지도'] }])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
