// 짝 짓기(core/weave.js · 지식 생성 하네스 H2) — 판정 한 줄에서 섹션 · 항목 장부 줄 · 문서 장부 줄 · 건드린 항목 · 문서 성격 줄을 같이 짓는다.
//   빈 지식에서 짝이 100% 로 서는가 · 종류를 접지 않는가 · 열쇠 겹침 · 모으는 문서 접기 · 짜임 머리 · 자리 없는 장부 줄 · 저장과 다시 읽기.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadKnowledge, sectionOf } from '../core/knowledge.js'
import { weave, valueOf, isFrameHead, cleanGist } from '../core/weave.js'
import { buildProposal } from '../core/propose.js'
import { save as coreSave } from '../core/save.js'
import { kindOf } from '../core/forms.js'
import { draftToSave } from '../core/ingest.js'

const BT = '`'
function emptyKn(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-weave-'))
  for (const [p, t] of Object.entries({ 'README.md': '# 빈지식(테스트)\n', '_members.md': '# 사람\n\n- 저장 방식: 승인\n', 'docs/기록 모음.md': '# 기록 모음\n\n이을 항목이 없던 기록을 달마다 잇는다. 기록은 각 달 항목의 이력으로 붙는다.\n', ...files })) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
    fs.writeFileSync(path.join(dir, p), t)
  }
  fs.mkdirSync(path.join(dir, 'work'), { recursive: true })
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.name', 't')
  git('config', 'user.email', 't@example.invalid')
  git('add', '-A')
  git('commit', '-q', '-m', '처음')
  return dir
}
const load = (dir) => loadKnowledge({ id: 't', name: 't', dir })
const human = (k, input, curator = false) => buildProposal(k, input, { newDoc: true, approve: true, curator, reverts: () => 0, month: '2026-11', head: { name: 't', viewers: 1, path: '시험' } })

test('열쇠 · 짜임 머리 · 뜻 한 줄', () => {
  assert.equal(valueOf({ heading: '수집기' }), '수집기')
  assert.equal(valueOf({ heading: '2026-11-10 주간 회의' }), '2026-11-10_주간_회의')
  assert.equal(valueOf({ heading: 'IS01: 수집기 재전송 실패' }), 'IS01')
  assert.equal(valueOf({ id: 'gw_log', heading: '테이블 gw_log' }), 'gw_log')
  assert.equal(valueOf({ heading: `장애 ${BT}대응${BT} | 절차` }), '장애_대응_절차')
  assert.equal(valueOf({ heading: '가'.repeat(80) }).length, 60)
  assert.ok(isFrameHead('개요') && isFrameHead('1. 변경 이력') && isFrameHead('개정이력') && !isFrameHead('수집기 개요'))
  assert.equal(cleanGist(`PLC 값을\n모아 ${BT}묶음${BT}으로 | 넘긴다`), 'PLC 값을 모아 묶음 으로 넘긴다')
})

test('빈 지식: 판례 0 건에서도 항목마다 짝이 선다 · 종류는 적은 낱말 그대로 · 문서 성격 줄 · 모으는 갈래 줄', async () => {
  const dir = emptyKn()
  const k = await load(dir)
  const w = weave(k, {
    docs: [
      { path: '게이트웨이 설계', nature: '대상', summary: '게이트웨이의 구성 요소를 대상마다 적는다.' },
      { path: '회의록', nature: '사건', summary: '회의마다 정한 것과 남은 것을 적는다.', gather: { aliases: ['회의', '주간 회의', '회의록'] } },
    ],
    lines: [
      { doc: '게이트웨이 설계', heading: '개요', act: 'new' },
      { doc: '게이트웨이 설계', heading: '수집기', act: 'new', kind: '모듈', gist: 'PLC 값을 모아 묶음으로 넘기는 프로세스', aliases: ['collector', '수집기'] },
      { doc: '게이트웨이 설계', heading: '테이블 gw_log', act: 'new', kind: '테이블', id: 'gw_log', gist: '보낸 묶음의 결과를 한 줄씩 남기는 테이블' },
      { doc: '게이트웨이 설계', heading: '게이트 A', act: 'new', kind: '게이트', kindGist: '현장에 놓인 출입 게이트 한 대', gist: '정문의 출입 게이트' },
      { doc: '회의록', heading: '2026-11-10 주간 회의', act: 'new', kind: '회의', gist: '전송 주기를 10초로 정한 주간 회의' },
    ],
  })
  assert.deepEqual(w.errors, [])
  assert.deepEqual(w.names.map((n) => n.coord), ['모듈:수집기', '테이블:gw_log', '게이트:게이트_A', '회의:2026-11-10_주간_회의'])
  assert.deepEqual(w.touches, w.names.map((n) => n.coord))
  assert.deepEqual(w.names[0], { coord: '모듈:수집기', label: '수집기', aliases: ['collector'], doc: '게이트웨이 설계', heading: '수집기', gist: 'PLC 값을 모아 묶음으로 넘기는 프로세스' })
  assert.equal(w.names[2].kindGist, '현장에 놓인 출입 게이트 한 대') // 씨앗이 아닌 새 종류의 뜻
  assert.equal(w.names[0].kindGist, undefined) // 씨앗 종류의 뜻은 장부에 적지 않는다
  assert.deepEqual(w.skipped.map((x) => x.at), ['게이트웨이 설계 › 개요']) // 짜임 머리는 짝을 세우지 않는다(H-O13)
  assert.deepEqual(w.natures.map((x) => [x.doc, x.nature]), [['게이트웨이 설계', '대상'], ['회의록', '사건']])
  assert.deepEqual(w.forms, [{ name: '회의록', aliases: ['회의', '주간 회의'], kind: '사건' }]) // 모으는 문서만 갈래 줄
  assert.deepEqual(w.kinds.map((x) => [x.name, x.seed]), [['모듈', true], ['테이블', true], ['게이트', false], ['회의', true]])

  // 저장하고 다시 읽는다 — 장부 셋이 한 커밋에 서고 모든 새 항목이 짝이다
  const input = {
    record: { title: '게이트웨이 설계: 들임', body: '게이트웨이 설계와 회의를 들였다.', touches: w.touches },
    sections: w.lines.map((l) => ({ doc: l.doc, heading: l.heading, content: `${l.heading} 의 글이다.` })),
    names: w.names,
    forms: w.forms,
    natures: w.natures,
  }
  const p = human(k, input)
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  assert.ok(p.fresh.some((f) => f.kind === '성격' && f.name === '게이트웨이 설계: 대상'))
  assert.match(p.text, /게이트웨이 설계 {3}신설 {3}성격: 대상/)
  const r = await coreSave(dir, input, { user: 't', guard: 'strict' })
  assert.ok(r.id)
  const k2 = await load(dir)
  for (const c of w.touches) assert.ok(sectionOf(k2, c)?.sec, `짝이 닿지 않는다: ${c}`)
  assert.equal(k2.vocab.coords.get('모듈:수집기').gist, 'PLC 값을 모아 묶음으로 넘기는 프로세스')
  assert.deepEqual(k2.vocab.coords.get('모듈:수집기').aliases, ['collector'])
  assert.equal(k2.vocab.kinds.get('게이트'), '현장에 놓인 출입 게이트 한 대')
  assert.equal(k2.vocab.kinds.has('모듈'), false)
  assert.deepEqual([k2.forms.own, k2.forms.closed, k2.forms.rows.map((f) => f.name)], [true, false, ['회의록']])
  assert.deepEqual(kindOf(k2.forms, '게이트웨이 설계'), { kind: '대상', form: null, props: null }) // 문서 성격 줄(짐작이 아니다)
  assert.equal(kindOf(k2.forms, '회의록').kind, '사건')
  assert.deepEqual(kindOf(k2.forms, '장애 대응 절차'), { kind: '', form: null, props: null }) // 성격 줄도 갈래 줄도 없으면 빈 칸(이름으로 짐작하지 않는다 · O-9)

  // 둘째 걸음 — 있는 머리는 그 장부 항목을 건드린다 · 열쇠 겹침은 문서 줄기를 붙인다 · 같은 종류를 모으는 문서로 접는다 · 벗어남이면 접지 않는다
  const w2 = weave(k2, {
    docs: [{ path: '고객 회의록', nature: '사건' }, { path: '수집기 설치', nature: '절차', summary: '수집기를 설치하는 차례.' }, { path: '회의 운영 규칙', nature: '절차', depart: 'R4-1' }],
    lines: [
      { doc: '게이트웨이 설계', heading: '수집기', act: 'edit' },
      { doc: '고객 회의록', heading: '2026-11-15 검토 회의', act: 'new', kind: '회의' },
      { doc: '수집기 설치', heading: '수집기', act: 'new', kind: '모듈', gist: '설치 대상인 수집기 꾸러미' },
      { doc: '수집기 설치', heading: '설치', act: 'new', nature: '절차' },
      { doc: '회의 운영 규칙', heading: '회의 운영', act: 'new', kind: '절차' },
      { doc: '게이트웨이 설계', heading: '전송기', act: 'new' }, // 종류를 비우면 그 문서에서 가장 많이 쓰는 종류
    ],
  })
  assert.deepEqual(w2.errors, [])
  assert.deepEqual(w2.fold.map((f) => [f.what, f.from, f.to]), [['doc', '고객 회의록', '회의록'], ['key', '모듈:수집기', '모듈:수집기_설치_수집기']])
  assert.deepEqual(w2.lines.map((l) => l.doc), ['docs/게이트웨이 설계.md', 'docs/회의록.md', 'docs/수집기 설치.md', 'docs/수집기 설치.md', 'docs/회의 운영 규칙.md', 'docs/게이트웨이 설계.md'])
  assert.deepEqual(w2.touches.slice(0, 5), ['모듈:수집기', '회의:2026-11-15_검토_회의', '모듈:수집기_설치_수집기', '절차:설치', '절차:회의_운영'])
  assert.match(w2.touches[5], /^(모듈|테이블|게이트):전송기$/)
  assert.deepEqual(w2.natures.map((x) => x.doc), ['수집기 설치', '회의 운영 규칙']) // 접힌 문서는 성격 줄이 없다
})

test('자리 없는 장부 줄(O-2 · 자리 채움을 걷었다): 같은 열쇠의 새 머리는 다른 항목이다 · 자리에 선 항목은 다시 세우지 않는다 · fill 은 받지 않는다', async () => {
  const VOCAB = `# 항목 장부\n\n## term\n\n- ${BT}term:버퍼${BT}: 버퍼\n- ${BT}term:수집기${BT}: 수집기\n`
  const dir = emptyKn({
    '_vocab.md': VOCAB,
    '_managed.md': `# 문서 장부\n\n| 항목 | 문서 | 머리 |\n|---|---|---|\n| ${BT}term:수집기${BT} | ${BT}docs/설계.md${BT} | ${BT}## 수집기${BT} |\n`,
    'docs/설계.md': '# 설계\n\n게이트웨이 설계.\n\n## 수집기\n\n수집기는 값을 모은다.\n',
  })
  const k = await load(dir)
  const w = weave(k, { lines: [{ doc: '설계', heading: '버퍼', act: 'new', kind: 'term', gist: '보낼 묶음을 잠시 담는 자리' }, { doc: '설계', heading: '수집기', act: 'edit', kind: 'term' }] })
  assert.deepEqual(w.errors, [])
  assert.deepEqual(w.names, [{ coord: 'term:설계_버퍼', label: '버퍼', doc: '설계', heading: '버퍼', gist: '보낼 묶음을 잠시 담는 자리' }])
  assert.deepEqual(w.fold.map((f) => [f.what, f.from, f.to]), [['key', 'term:버퍼', 'term:설계_버퍼']])
  assert.ok(w.touches.includes('term:수집기'))
  const { cleanNames } = await import('../core/namebook.js')
  assert.equal(cleanNames([{ coord: 'term:버퍼', label: '버퍼', doc: '설계', heading: '버퍼', fill: true }])[0].fill, undefined)
})

test('들이기 초안 → 저장 덩이: 새 머리마다 짝 · 종류를 term 으로 접지 않는다 · 가짜 초안 다섯 뒤 짝 100%', async () => {
  const dir = emptyKn()
  const rec = (title) => ({ title, body: '들였다.', changes: [] })
  const drafts = [
    { record: rec('게이트웨이 설계: 들임'), updates: [], newDoc: { path: '게이트웨이 설계', sections: [{ heading: '수집기', content: '수집기는 값을 모은다.' }, { heading: 'gw_log: 전송 로그', content: '전송 결과를 남긴다.' }] }, names: [{ name: '수집기', kind: '모듈' }, { name: 'gw_log: 전송 로그', kind: '테이블' }] },
    { record: rec('주간 회의: 들임'), updates: [], newDoc: { path: '회의록', sections: [{ heading: '2026-11-10 주간 회의', content: '전송 주기를 정했다.' }] }, names: [{ name: '2026-11-10 주간 회의', kind: '회의' }] },
    { record: rec('장애 대응 절차: 들임'), updates: [], newDoc: { path: '장애 대응 절차', sections: [{ heading: '장애 대응', content: '알림을 받으면 확인한다.' }] }, names: [{ name: '장애 대응', kind: '절차' }] },
    { record: rec('용어: 들임'), updates: [], newDoc: { path: '용어집', sections: [{ heading: 'PLC: 제어 장치', content: '설비를 제어한다.' }] }, names: [{ name: 'PLC', kind: '용어' }] },
    { record: rec('전송기: 더함'), updates: [{ doc: '게이트웨이 설계', heading: '전송기', content: '전송기는 묶음을 보낸다.' }], names: [] },
  ]
  for (const draft of drafts) {
    const k = await load(dir)
    const g = { type: 'file', src: { title: draft.record.title, rel: 'x.md', md: draft.record.body }, docs: k.docs.filter((d) => d.id !== '기록 모음').map((d) => ({ doc: d.path, title: d.title, sections: [] })), kinds: [] }
    const d = draftToSave(k, g, draft, { measure: true })
    assert.equal(d.ok, true, d.why)
    assert.deepEqual(d.held, [])
    assert.ok(!d.warn.includes('names-missing'))
    await coreSave(dir, d.input, { user: 't', guard: 'strict' })
  }
  const k = await load(dir)
  const coords = [...k.vocab.coords.keys()]
  assert.deepEqual([...coords].sort(), ['모듈:수집기', '모듈:전송기', '용어:PLC', '절차:장애_대응', '테이블:gw_log', '회의:2026-11-10_주간_회의'].sort())
  assert.ok(!coords.some((c) => c.startsWith('term:')))
  // 짝 100% — 모든 항목 머리에 장부 줄이 닿는다 · 기록은 그 항목을 건드린다
  const reached = new Set(coords.map((c) => { const s = sectionOf(k, c); return s?.sec ? `${s.doc.path} › ${s.sec.h}` : null }))
  for (const d of k.docs) if (d.id !== '기록 모음') for (const s of d.sections) if (s.h) assert.ok(reached.has(`${d.path} › ${s.h}`), `짝 없는 머리: ${d.path} › ${s.h}`)
  assert.ok(k.works.every((x) => x.touches.length >= 1))
})
