// save 입력 2판(지식 생성 하네스 5-2 · H4c) — items · docs · skip 을 엮기가 저장 입력으로 바꾼다.
//   사람 채널: 제안서에 「지은 근거」 가 보이고 승인한 저장이 기록 끝 `## 지은 근거` · 장부 줄 · 갈래 줄 · 문서 성격 줄을 한 커밋에 세운다.
//   모두 뺌은 아무것도 쓰지 않는다 · 엮기가 짓는 칸을 바깥에서 보내면 걷는다 · 옛 꼴과 섞어 보내면 입력 오류.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { copyDir, signIn, seat } from './helpers.mjs'
import { inputFromItems } from '../core/weave.js'
import { loadKnowledge } from '../core/knowledge.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s
const P = {}
const KD = () => path.join(tmp, 'kn', 'dpms')
const mcp = async (name, args, who = P.wr) => {
  const r = await fetch(s.url + '/mcp', { method: 'POST', headers: { authorization: `Bearer ${who.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
  return (await r.json()).result.structuredContent
}
const J = { none: { rule: ['R1-1', 'R5-1'], none: 'all' } }

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-hitems-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  P.wr = await signIn(s, { id: 'wr', admin: false })
  await seat(s, 'wr', { dpms: 'write' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('엮기(코어): items · docs · skip → 저장 입력 · 지은 근거 줄 · 한 일 수 · 태도 수 · 판단 칸의 꼴 흠은 세기만', async () => {
  const k = await loadKnowledge({ id: 'dpms', name: 'dpms', dir: KD() })
  const v = inputFromItems(k, {
    record: { title: '게이트웨이: 수집기를 세움', summary: '수집기를 세웠다.', changes: ['새로: 수집기'], asOf: '2026-11-10' },
    docs: [{ path: '게이트웨이 설계', nature: '대상', summary: '게이트웨이의 구성 요소를 적는다.', judge: J.none }],
    items: [
      { doc: '게이트웨이 설계', heading: '수집기', act: 'new', nature: '대상', kind: '모듈', gist: 'PLC 값을 모아 묶음으로 넘기는 프로세스', content: '수집기는 값을 모은다.', judge: J.none },
      { target: 'proc:카나리', act: 'same', judge: { rule: ['R2-1', 'R9-9'], prec: [{ of: 'proc:카나리', stance: 'follow' }] } },
    ],
    skip: [{ what: '개정 이력', rule: 'R6-1', why: '경위다' }],
  })
  assert.deepEqual(v.errors, [])
  assert.deepEqual(v.acts, { edit: 0, new: 1, same: 1, skip: 1, doc: 1 })
  assert.deepEqual([v.stances.shown, v.stances.follow, v.stances.none.all], [1, 1, 2])
  assert.equal(v.miss, 1) // 없는 조문 번호 R9-9 는 지우고 센다(막지 않는다)
  assert.equal(v.empty, false)
  assert.deepEqual(v.input.sections, [{ doc: 'docs/게이트웨이 설계.md', heading: '수집기', content: '수집기는 값을 모은다.' }])
  assert.deepEqual(v.input.names.map((n) => [n.coord, n.gist]), [['모듈:수집기', 'PLC 값을 모아 묶음으로 넘기는 프로세스']])
  assert.deepEqual(v.input.natures, [{ doc: '게이트웨이 설계', nature: '대상', summary: '게이트웨이의 구성 요소를 적는다.' }])
  assert.deepEqual(v.input.record.touches, ['모듈:수집기', 'proc:카나리'])
  assert.deepEqual(v.input.record.refs, ['근거 날짜: 2026-11-10'])
  assert.equal(v.input.record.body, '수집기를 세웠다.')
  assert.deepEqual(v.input.judge, [
    '새 항목 게이트웨이 설계 › 수집기: R1-1 · R5-1 · 판례 없음',
    '그대로 배포절차 › 카나리: R2-1 · proc:카나리 따름',
    '새 문서 게이트웨이 설계: R1-1 · R5-1 · 판례 없음',
    '뺌 개정 이력: R6-1 · 경위다',
  ])
  // 모두 뺌 — 쓸 것이 없다
  assert.equal(inputFromItems(k, { record: { title: '메모', summary: 'x' }, items: [], skip: [{ what: '미정 메모', rule: 'R6-2', why: '정해지지 않았다' }] }).empty, true)
  // 꼴 오류
  assert.deepEqual(inputFromItems(k, { record: { title: 'x' }, items: [{ doc: 'a', heading: 'b', act: 'new' }, { target: 'proc:없는것', act: 'edit', content: 'x' }, { doc: 'a', heading: 'b', act: 'what' }] }).errors.map((e) => e.code), ['content', 'target', 'act'])
})

test('사람 채널: 제안서에 지은 근거 · 승인한 저장이 기록 끝 칸 · 장부 줄 · 모으는 갈래 줄 · 문서 성격 줄을 한 번에 세운다', async () => {
  const input = {
    knowledge: 'dpms',
    record: { title: '주간 회의: 카나리 비율', summary: '주간 회의에서 카나리 비율을 정했다.', changes: ['새로: 2026-11-10 주간 회의'], asOf: '2026-11-10' },
    docs: [{ path: '회의록', nature: '사건', summary: '회의마다 정한 것과 남은 것을 적는다.', gather: { aliases: ['회의', '주간 회의'] }, judge: { rule: ['R3-2', 'R4-1'], none: 'all' } }],
    items: [{ doc: '회의록', heading: '2026-11-10 주간 회의', act: 'new', nature: '사건', kind: '회의', gist: '카나리 비율을 정한 주간 회의', content: '카나리 비율을 그대로 두기로 했다.\n\n- **누가**: 김, 박\n- **정한 것**:\n* 카나리 비율은 그대로 둔다\n- **남은 것**:\n* 없음', judge: { rule: ['R4-1', 'R5-1'], prec: [{ of: 'proc:카나리', stance: 'na', why: '절차 항목이고 이것은 회의다' }], none: 'part' } }],
    skip: [{ what: '인사말', rule: 'R6-1', why: '인사말이다' }],
    // 엮기가 짓는 칸을 바깥에서 보내도 받지 않는다
    natures: [{ doc: '엉뚱한 문서', nature: '대상' }],
    judge: ['사람이 지어 보낸 근거'],
  }
  const p = await mcp('propose', input)
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  assert.match(p.text, /―― 지은 근거 ――\n {2}새 항목 회의록 › 2026-11-10 주간 회의: R4-1 · R5-1 · proc:카나리 해당 없음\(절차 항목이고 이것은 회의다\)\n {2}새 문서 회의록: R3-2 · R4-1 · 판례 없음\n {2}뺌 인사말: R6-1 · 인사말이다/)
  assert.ok(!p.text.includes('사람이 지어 보낸 근거') && !p.text.includes('엉뚱한 문서'))
  assert.match(p.text, /회의록 {3}신설 {3}갈래: 회의록 {3}성격: 사건/)
  assert.ok(p.fresh.some((f) => f.kind === '갈래' && f.name === '회의록') && p.fresh.some((f) => f.kind === '이름' && f.name === '회의:2026-11-10_주간_회의'))
  // 같은 입력이면 같은 지문(엮기는 결정적이다)
  assert.equal((await mcp('propose', input)).proposal, p.proposal)
  const r = await mcp('save', { ...input, proposal: p.proposal })
  assert.ok(r.saved, JSON.stringify(r))
  const rec = fs.readFileSync(path.join(KD(), 'work', `${r.saved}.md`), 'utf8')
  assert.match(rec, /## 지은 근거\n- 새 항목 회의록 › 2026-11-10 주간 회의: R4-1 · R5-1 · proc:카나리 해당 없음/)
  assert.match(rec, /근거 날짜: 2026-11-10/)
  assert.match(rec, /touches:.*회의:2026-11-10_주간_회의/s)
  // 새 문서 글 — `# 제목` 아래에 요약(R3-4)
  assert.ok(fs.readFileSync(path.join(KD(), 'docs', '회의록.md'), 'utf8').replace(/\r/g, '').startsWith('# 회의록\n\n회의마다 정한 것과 남은 것을 적는다.\n\n## 2026-11-10 주간 회의\n'))
  const forms = fs.readFileSync(path.join(KD(), '_forms.md'), 'utf8')
  assert.match(forms, /- 새 문서: 열림/)
  assert.match(forms, /\| 회의록 \| 회의, 주간 회의 \| - \| 사건 \|/)
  assert.match(forms, /## 문서 성격\n\n\| 문서 \| 성격 \| 요약 \|\n\|---\|---\|---\|\n\| 회의록 \| 사건 \| 회의마다 정한 것과 남은 것을 적는다\. \|/)
  assert.match(fs.readFileSync(path.join(KD(), '_vocab.md'), 'utf8'), /`회의:2026-11-10_주간_회의`: 2026-11-10 주간 회의\n {2}gist: 카나리 비율을 정한 주간 회의/)
  assert.match(fs.readFileSync(path.join(KD(), '_managed.md'), 'utf8'), /\| `회의:2026-11-10_주간_회의` \| `docs\/회의록\.md` \| `## 2026-11-10 주간 회의` \|/)
  // 사람이 기록 글에 「## 지은 근거」 를 쓰면 거절한다(kmd 가 쓰는 칸)
  const forged = await mcp('propose', { knowledge: 'dpms', record: { title: '흉내', body: '글\n\n## 지은 근거\n- 흉내', touchesEmpty: '없음' } })
  assert.equal(forged.error, 'E_INPUT')
  // 측정 줄 — 판 · 한 일 수 · 태도 수
  const line = fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'savelog', 'dpms.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.rec === r.saved)
  assert.deepEqual([line.rev, line.acts, line.prec.na, line.none], [1, { edit: 0, new: 1, same: 0, skip: 1, doc: 1 }, 1, { all: 1, part: 1 }], JSON.stringify(line))
})

test('모두 뺌은 아무것도 쓰지 않는다 · 옛 꼴과 섞어 보내면 입력 오류 · 옛 꼴 입력은 그대로 지난다', async () => {
  const before = fs.readdirSync(path.join(KD(), 'work')).length
  const only = { knowledge: 'dpms', record: { title: '버퍼 압축 메모', summary: '정해진 것이 없다.' }, items: [], skip: [{ what: '버퍼 압축 방식', rule: 'R6-2', why: '아직 정하지 못했다' }] }
  const p = await mcp('propose', only)
  assert.deepEqual([p.empty, p.proposal], [true, null])
  assert.match(p.text, /^넣을 것 없음: 버퍼 압축 방식\(R6-2 · 아직 정하지 못했다\)/)
  const r = await mcp('save', only)
  assert.deepEqual([r.saved, r.empty], [null, true])
  assert.equal(fs.readdirSync(path.join(KD(), 'work')).length, before)
  const last = fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'savelog', 'dpms.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop()
  assert.deepEqual([last.empty, last.acts.skip, last.rec], [true, 1, null])
  // 섞어 보내기
  assert.equal((await mcp('propose', { knowledge: 'dpms', record: { title: 'x', summary: 'y' }, items: [{ doc: 'a', heading: 'b', act: 'new', content: 'c' }], sections: [{ doc: 'a', heading: 'b', content: 'c' }] })).error, 'E_INPUT')
  assert.equal((await mcp('propose', { knowledge: 'dpms', record: { title: 'x', summary: 'y' }, items: [{ doc: 'a', heading: 'b', act: 'new', content: 'c' }], names: [{ coord: 'term:b', label: 'b' }] })).error, 'E_INPUT')
  // 옛 꼴
  const old = await mcp('propose', { knowledge: 'dpms', record: { title: '옛 꼴: 메모', body: '옛 꼴로 보낸다.', changes: ['새로: 옛 항목'], touchesEmpty: '첫 문서' }, sections: [{ doc: '옛 문서', heading: '옛 항목', content: '옛 항목이다.' }] })
  assert.deepEqual(old.errors, [])
  assert.ok(!old.text.includes('지은 근거'))
})
