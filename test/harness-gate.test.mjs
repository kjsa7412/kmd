// 지식 생성 하네스의 결정적 시험(설계 9-3) — 제안이 지나가면 저장도 지나간다(조사 Z V1 · V2 회귀 · H-D14).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadKnowledge } from '../core/knowledge.js'
import { buildProposal } from '../core/propose.js'
import { formsAfter } from '../core/namebook.js'
import { save as coreSave } from '../core/save.js'

function emptyKn() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-hgate-'))
  fs.mkdirSync(path.join(dir, 'docs'))
  fs.mkdirSync(path.join(dir, 'work'))
  fs.writeFileSync(path.join(dir, 'README.md'), '# 빈지식(테스트)\n')
  fs.writeFileSync(path.join(dir, '_members.md'), '# 사람\n\n- 저장 방식: 승인\n')
  fs.writeFileSync(path.join(dir, 'docs', '기록 모음.md'), '# 기록 모음\n\n이을 항목이 없던 기록을 달마다 잇는다. 기록은 각 달 항목의 이력으로 붙는다.\n')
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' })
  git('init', '-q'); git('config', 'user.name', 't'); git('config', 'user.email', 't@example.invalid'); git('add', '-A'); git('commit', '-q', '-m', '처음')
  return dir
}
const load = (dir) => loadKnowledge({ id: 't', name: 't', dir })
const human = (k, input) => buildProposal(k, input, { newDoc: true, approve: true, curator: false, reverts: () => 0, month: '2026-11', head: { name: 't', viewers: 1, path: '시험' } })
const R = { title: '게이트웨이 설계: 수집기 주기', body: '수집기 주기를 정했다.\n\n## 바뀐 것\n- 수집 주기: 5초', touchesEmpty: '첫 문서라 장부 항목이 아직 없다' }
// 장부 짝(R7-1 · 채널 평가 P4) · 뜻 한 줄(R5-3 · P3)
const NM = (coord, label, doc, heading) => ({ coord, label, doc, heading, gist: `${label} 를 시험하려고 세운 항목 하나(테스트)` })
const sec = (doc, heading) => ({ doc, heading, content: '수집기는 PLC 에서 5초마다 값을 읽는다. 수집 주기: 5초' })

test('V1: 제안과 저장이 같은 갈래 목록으로 판정한다(formsAfter) · 새로 서는 갈래 장부는 열림이라 갈래 밖 문서도 같이 선다', async () => {
  const dir = emptyKn()
  const k = await load(dir)
  assert.equal(k.forms.own, false)
  assert.equal(k.formsRaw, '')
  assert.deepEqual([k.forms.rows.length, k.forms.closed], [0, false]) // 기본 갈래는 판정에 없다(H-O4)
  // 저장 뒤의 갈래 목록 — 새로 서는 갈래 장부는 열림이다
  const after = formsAfter(k.formsRaw, [{ name: '설계서', kind: '대상' }])
  assert.deepEqual([after.own, after.closed, after.rows.map((f) => f.name)], [true, false, ['설계서']])
  const both = { record: R, sections: [sec('설계서', '수집기'), sec('회의록', '2026-11-10 주간 회의')], forms: [{ name: '설계서', kind: '대상' }], names: [NM('module:수집기', '수집기', '설계서', '수집기'), NM('회의:2026-11-10_주간_회의', '2026-11-10 주간 회의', '회의록', '2026-11-10 주간 회의')] }
  const p = human(k, both)
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  // 갈래가 없는 새 문서(회의록)에 성격 줄이 없으면 경고(R3-4) · 갈래가 있는 설계서는 경고 없음 · natures 를 실으면 경고가 사라진다
  assert.deepEqual(p.warnings.filter((w) => w.code === 'nature').map((w) => w.at), ['docs/회의록.md'])
  const pn = human(k, { ...both, natures: [{ doc: '회의록', nature: '사건', summary: '회의마다 한 항목.' }] })
  assert.deepEqual([pn.errors, pn.warnings.filter((w) => w.code === 'nature')], [[], []])
  assert.ok(pn.fresh.some((x) => x.kind === '성격' && x.name === '회의록: 사건'))
  // 제안이 지나가면 저장도 지나간다
  const r = await coreSave(dir, both, { user: 't', guard: 'strict' })
  assert.ok(r.id)
  const k2 = await load(dir)
  assert.deepEqual([k2.forms.own, k2.forms.closed, k2.forms.rows.map((f) => f.name)], [true, false, ['설계서']])
  assert.ok(k2.formsRaw.includes('- 새 문서: 열림'))
  assert.ok(k2.byDocPath.get('docs/회의록.md'))
  // 닫음으로 바꾼 지식(옛 갈래 장부도 같다)은 제안도 저장도 갈래 밖 새 문서를 거절한다
  fs.writeFileSync(path.join(dir, '_forms.md'), k2.formsRaw.replace('- 새 문서: 열림', '- 새 문서: 닫음'))
  const k3 = await load(dir)
  const out = { record: R, sections: [sec('화면 설계', '로그인')] }
  assert.ok(human(k3, out).errors.some((e) => e.code === 'format' && /갈래 장부에 없는 문서/.test(e.why)))
  await assert.rejects(coreSave(dir, out, { user: 't', guard: 'strict' }), /갈래 장부에 없는 문서/)
  // 있는 갈래와 정규화가 같은 새 갈래는 near 오류다(기본 갈래가 아니라 이 지식의 갈래 줄과 견준다)
  assert.deepEqual(human(k3, { record: R, forms: [{ name: '설계 서' }] }).errors.map((e) => e.code), ['near'])
})

test('V2: 같은 제안의 names(doc · heading)로 세우는 항목을 sections[].coord 로 가리킨다', async () => {
  const dir = emptyKn()
  const k = await load(dir)
  const input = {
    record: { title: R.title, body: R.body, touches: ['module:수집기'] },
    sections: [{ coord: 'module:수집기', content: '수집기는 PLC 에서 5초마다 값을 읽는다. 수집 주기: 5초' }],
    names: [{ coord: 'module:수집기', label: '수집기', doc: '게이트웨이 설계', heading: '수집기', gist: 'PLC 값을 읽어 묶음으로 만들어 전송기에 넘기는 프로세스' }],
  }
  const p = human(k, input)
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  const it = p.items.find((x) => x.kind === '신설')
  assert.deepEqual([it.doc, it.heading, it.coord], ['docs/게이트웨이 설계.md', '수집기', 'module:수집기'])
  // names 에 자리가 없으면 여전히 notfound
  const bad = human(k, { ...input, names: [{ coord: 'module:수집기', label: '수집기', gist: 'PLC 값을 읽어 묶음으로 만들어 전송기에 넘기는 프로세스' }] })
  assert.ok(bad.errors.some((e) => e.code === 'notfound'))
  // 저장도 지나간다(저장 문은 이번에 세우는 항목을 자리로 쓴다)
  const r = await coreSave(dir, input, { user: 't', guard: 'strict' })
  assert.ok(r.id)
  const k2 = await load(dir)
  assert.ok(k2.byDocPath.get('docs/게이트웨이 설계.md').sections.some((s) => s.h === '수집기'))
  assert.ok(k2.vocab.coords.has('module:수집기'))
})

test('채널 평가 P3 · P4 · P5 · P11: 뜻 한 줄 · 장부 짝 · 근거 날짜 측정 · 링크 대상(저장 문 · approve 판정)', async () => {
  const dir = emptyKn()
  fs.writeFileSync(path.join(dir, 'docs', '결정 기록.md'), '# 결정 기록\n\n갈림길마다 고른 것을 적는다.\n\n## 2026-11-10 전송 주기\n\n전송 주기를 10초로 정했다.\n')
  fs.writeFileSync(path.join(dir, '_managed.md'), '# 문서 장부\n\n| 항목 | 문서 | 머리 |\n|---|---|---|\n| `회의:*` | `docs/회의록.md` | `## {값}` |\n')
  execFileSync('git', ['add', '-A'], { cwd: dir }); execFileSync('git', ['commit', '-q', '-m', '바탕'], { cwd: dir })
  const k = await load(dir)
  const name = { coord: 'module:수집기', label: '수집기', doc: '설계서', heading: '수집기' }
  const base = { record: R, sections: [sec('설계서', '수집기')] }
  const codes = (input) => human(k, input).errors.map((e) => e.code)
  // P3 뜻 한 줄: 없음 · 이름 되풀이 · 15자 미만은 오류 · 장부에 있는 항목을 다시 보내면 보지 않는다
  assert.deepEqual(codes({ ...base, names: [name] }), ['gist'])
  assert.deepEqual(codes({ ...base, names: [{ ...name, gist: '수집기' }] }), ['gist'])
  assert.deepEqual(codes({ ...base, names: [{ ...name, gist: '값을 읽는 것' }] }), ['gist'])
  assert.deepEqual(codes({ ...base, names: [{ ...name, gist: 'PLC 값을 읽어 묶음으로 만들어 전송기에 넘기는 프로세스' }] }), [])
  // P4 장부 짝: names 없이 새 머리만 · 패턴 줄(회의:*)이 있는 모으는 문서의 새 머리도 names 가 있어야 한다
  assert.deepEqual(codes(base), ['pair'])
  assert.deepEqual(codes({ record: R, sections: [sec('회의록', '2026-11-10 주간 회의')] }), ['pair'])
  assert.deepEqual(codes({ record: R, sections: [sec('회의록', '2026-11-10 주간 회의')], names: [{ coord: '회의:2026-11-10_주간', label: '2026-11-10 주간 회의', gist: '수집 주기를 정한 11월 둘째 주 정례 회의' }] }).filter((c) => c === 'pair'), ['pair'])
  // 패턴 줄로 자리가 닿는 coord(값이 머리와 같다)는 짝이다
  const kp = await load(dir)
  assert.ok(!human(kp, { record: R, sections: [sec('회의록', '2026-11-10')], names: [{ coord: '회의:2026-11-10', label: '11월 정례', gist: '수집 주기를 정한 11월 둘째 주 정례 회의' }] }).errors.some((e) => e.code === 'pair'))
  // P5 근거 날짜: 오늘(들인 날)이고 원천 글에 없으면 경고(asof) · 원천에 그 날짜가 있으면 · 원천 칸이 없으면 경고 없음
  const ok = { ...base, names: [{ ...name, gist: 'PLC 값을 읽어 묶음으로 만들어 전송기에 넘기는 프로세스' }] }
  const withSrc = (src) => ({ ...ok, record: { ...R, body: `${R.body}\n\n## 근거\n- 설계서 v0.3\n- 근거 날짜: 2026-11-19\n\n## 원천\n- 파일 설계서.md · 지문 0123456789abcdef\n\n> ${src}` } })
  const asof = (input) => buildProposal(k, input, { newDoc: true, approve: true, reverts: () => 0, month: '2026-11', today: '2026-11-19' }).warnings.filter((w) => w.code === 'asof').length
  assert.equal(asof(withSrc('수집기는 5초마다 읽는다')), 1)
  assert.equal(asof(withSrc('작성일 2026. 11. 19 · 수집기는 5초마다 읽는다')), 0)
  assert.equal(asof({ ...ok, record: { ...R, body: `${R.body}\n\n## 근거\n- 근거 날짜: 2026-11-19` } }), 0)
  // P11 링크: 없는 문서 · 없는 머리는 오류(비슷한 문서를 알린다) · 빈칸은 %20 으로 맞춘다 · 이번에 세우는 문서 · 머리는 된다
  const linked = (text) => human(k, { ...ok, sections: [{ doc: '설계서', heading: '수집기', content: `수집기는 PLC 에서 5초마다 값을 읽는다. 수집 주기: 5초. ${text}` }] })
  const e1 = linked('정한 것은 [결정](결정기록.md) 에 있다.').errors
  assert.deepEqual(e1.map((e) => e.code), ['link'])
  assert.match(e1[0].why, /있는 문서: 결정 기록\.md/)
  assert.deepEqual(linked('[결정](결정%20기록.md#2026-11-11 없는 결정)').errors.map((e) => e.code), ['link'])
  const sp = linked('[결정](결정 기록.md#2026-11-10 전송 주기)')
  assert.deepEqual(sp.errors, [])
  assert.match(sp.items[0].after, /\[결정\]\(결정%20기록\.md#2026-11-10%20전송%20주기\)/)
  assert.deepEqual(linked('[자기](#수집기) · [바깥](https://example.invalid/a b.md) · `[코드](없음.md)`').errors, [])
})
