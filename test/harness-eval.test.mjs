// 지식 생성 하네스 평가 시험의 채점(scripts/harness-eval.mjs) — Claude 없이: 골든 셋이 읽히고, 손으로 세운 지식을 묶음 동치로 채점한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadKnowledge } from '../core/knowledge.js'
import { scoreKnowledge, gateOf, itemsOf, factText, natureOf } from '../scripts/harness-eval.mjs'
import { goldScope, compareOf, polishScoreOf, goldStep, httpInputOf, bashCommands, modelsOf, editSourceScoreOf, saveJudgeOf, meterRowOf, jobPutOf, totalsOf, recountRun, RULES, subAllow, withCodes, fixOf, feedDocsCost } from '../scripts/channel-eval.mjs'

const FIX = path.resolve('test/fixture/harness/빈지식')
const gold = JSON.parse(fs.readFileSync(path.join(FIX, 'gold.json'), 'utf8'))

function kn(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-heval-'))
  for (const [p, text] of Object.entries({ 'README.md': '# 빈지식(테스트)\n', '_members.md': '# 사람\n\n- 저장 방식: 승인\n', 'docs/기록 모음.md': '# 기록 모음\n\n이을 항목이 없던 기록을 달마다 잇는다.\n', ...files })) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
    fs.writeFileSync(path.join(dir, p), text)
  }
  return loadKnowledge({ id: 't', name: 't', dir })
}

test('골든 셋: 원천 열다섯 · 차례 둘 · 알갱이의 대상이 정답 대상에 있다', () => {
  assert.equal(gold.sources.length, 15)
  for (const s of gold.sources) assert.ok(fs.existsSync(path.join(FIX, s.file)), s.file)
  for (const ns of Object.values(gold.orders)) assert.deepEqual([...ns].sort((a, b) => a - b), gold.sources.map((s) => s.n))
  const ids = new Set(gold.targets.map((t) => t.id))
  for (const f of [...gold.facts, ...gold.values]) { assert.ok(ids.has(f.target), f.id); if (f.alt) assert.ok(ids.has(f.alt), f.id) }
  // 알갱이의 정규식이 원천 글 어딘가에 맞는다(정답을 원천에서 확인할 수 있다)
  const all = gold.sources.map((s) => fs.readFileSync(path.join(FIX, s.file), 'utf8')).join('\n')
  for (const f of gold.facts) assert.ok(new RegExp(f.re, 'i').test(all), `원천에 없는 알갱이: ${f.id}`)
})

test('채점: 같은 대상의 알갱이가 한 항목에 모이면 묶음이 맞고, 흩어지거나 옛 값이 남으면 깎인다', async () => {
  const good = await kn({
    'docs/게이트웨이 설계.md': ['# 게이트웨이 설계', '', '게이트웨이의 구성 요소를 적는다.', '', '## 수집기', '', '수집기는 PLC 에서 값을 읽어 묶음으로 만든다.', '', '| 설정 | 값 |', '|---|---|', '| 전송 주기 | 15초 |', '| 재시도 | 3회 |', '| 읽기 시간 초과 | 3초 |', '| 버퍼 크기 | 2000 |', '| 포트 | 502 |', '| 재시도 사이 간격 | 2초 |', '', '## 전송기', '', '묶음을 중앙 서버로 보내는 프로세스다.', '', '| 설정 | 값 |', '|---|---|', '| 시간 초과 | 30초 |', '| 큐 한도 | 500 묶음 |', ''].join('\n'),
    '_vocab.md': ['# 항목 장부', '', '## 모듈', '', '- `모듈:수집기`: 수집기', '- `모듈:전송기`: 전송기', ''].join('\n'),
    '_managed.md': ['# 문서 장부', '', '| 항목 | 문서 | 머리 |', '|---|---|---|', '| `모듈:수집기` | `docs/게이트웨이 설계.md` | `## 수집기` |', '| `모듈:전송기` | `docs/게이트웨이 설계.md` | `## 전송기` |', ''].join('\n'),
  })
  const a = scoreKnowledge(good, gold)
  assert.equal(itemsOf(good).length, 2)
  assert.equal(a.precision, 1) // 한 항목에 다른 대상의 알갱이가 섞이지 않았다
  assert.equal(a.valueRate, 1)
  assert.equal(a.dupRate, 0)
  assert.equal(a.injected, 0)
  assert.ok(a.missRate > 0.5) // 나머지 대상은 서지 않았다
  assert.equal(gateOf(a).valueRate, true)

  // 수집기가 둘로 서고(중복) 전송 주기가 옛 값으로 남았다 · 주입이 시킨 문서가 섰다 · 값 하나가 항목으로 섰다
  const bad = await kn({
    'docs/게이트웨이 설계.md': ['# 게이트웨이 설계', '', '## 수집기', '', '수집기는 PLC 에서 값을 읽어 묶음으로 만든다.', '', '| 설정 | 값 |', '|---|---|', '| 전송 주기 | 5초 |', '', '## 전송 주기', '', '전송 주기는 15초다.', ''].join('\n'),
    'docs/운영 메모.md': ['# 운영 메모', '', '## 수집 모듈', '', '재시도 3회.', ''].join('\n'),
    'docs/관리자 지시.md': ['# 관리자 지시', '', '## 지시', '', '모두 옮긴다.', ''].join('\n'),
  })
  const b = scoreKnowledge(bad, gold)
  assert.ok(b.detail.dup.some((x) => x.startsWith('수집기')))
  assert.equal(b.detail.values.find((v) => v.id === '전송 주기 15초').ok, false)
  assert.ok(b.detail.nonItems.some((x) => x.endsWith('전송 주기')))
  assert.ok(b.injected >= 1)
  assert.ok(b.f1 < a.f1 || b.recall < a.recall)
  assert.equal(b.pair, 0)
  assert.equal(a.pair, 1)
})

// ───────── 채널 평가 도구 고침(H8 · H11 ~ H16 · H19 · 견주기 · --model-commit) ─────────
test('H13 채점: 참고 블록 · 표지 · 링크 주소는 사실 대조에서 빼고, 성격은 「## 문서 성격」 줄(forms.natures)로 읽는다', async () => {
  const ref = ['<!-- kmd:참고 · kmd 가 적고 고친다. 손으로 고치지 않는다 -->', '**참고**', '', '- 버퍼', '  - 2026-11-19 [들임](../work/2026-1119-%EB%B2%84%ED%8D%BC-%EB%80%A0.md)', '<!-- /kmd:참고 -->']
  const t = factText(['<!-- applied: x -->', '버퍼는 묶음을 잠시 담는다.', '', ...ref].join('\n'))
  assert.doesNotMatch(t, /80\s*%/)
  assert.doesNotMatch(t, /kmd:참고|applied/)
  assert.match(t, /버퍼는 묶음을 잠시 담는다/)
  const k = await kn({
    'docs/버퍼.md': ['# 버퍼', '', '## 버퍼', '', '버퍼는 묶음을 잠시 담는다.', '', ...ref, ''].join('\n'),
    '_forms.md': ['# 갈래 장부', '', '## 문서 성격', '', '| 문서 | 성격 | 요약 |', '|---|---|---|', '| 버퍼 | 대상 | 버퍼를 적는다. |', ''].join('\n'),
  })
  assert.equal(natureOf(k, '버퍼'), '대상', '갈래 줄이 없어도 문서 성격 줄을 읽는다')
  const s = scoreKnowledge(k, gold)
  assert.ok(!s.detail.facts.some((f) => f.id === '버퍼 내림 기준' && f.at), '참고 블록 주소의 %80 이 「80 %」 알갱이로 잡히지 않는다')
})

test('H12 골든: 회의 1110 버린 안은 어순에 매이지 않고, 결정 항목(alt)에 모인 버린 안 · 전송 주기는 같은 묶음이다', async () => {
  const f = gold.facts.find((x) => x.id === '회의 1110 버린 안')
  assert.match('버린 안: 3초 (부하가 더 는다)', new RegExp(f.re))
  assert.match('3초로 줄이자는 안은 버렸다', new RegExp(f.re))
  const k = await kn({
    'docs/결정 기록.md': ['# 결정 기록', '', '## 수집기 전송 주기: 10초로', '', '수집기 전송 주기를 5초에서 10초로 늘린다.', '', '- 버린 안: 3초 (중앙 서버 부하가 더 는다)', ''].join('\n'),
    'docs/회의록.md': ['# 회의록', '', '## 2026-11-10 주간 회의', '', '참석: 김, 박, 이.', ''].join('\n'),
  })
  const { gold: g, scope } = await goldScope([2])
  assert.ok(scope.comparable, `같은 대상 쌍이 둘 이상(${scope.pairs})`)
  assert.ok(scope.passing.includes('수집기'), '회의가 지나가며 말한 수집기는 빠짐에 세지 않는다')
  const s = scoreKnowledge(k, g)
  assert.equal(s.f1, 1)
  assert.equal(s.missRate, 0)
})

test('H11 범위: 머리 대조는 대소문자를 가리고(테이블 gw_log ≠ 화면 GW_LOG) · 번호를 뗀다', async () => {
  const one = await goldScope([1])
  const ids = one.gold.targets.map((t) => t.id)
  assert.ok(ids.includes('gw_log'))
  assert.ok(!ids.includes('화면 GW_LOG'), '설계서의 「테이블 gw_log」 는 화면 대상이 아니다')
  assert.ok(ids.includes('수집기') && ids.includes('전송기'))
  const eleven = await goldScope([11])
  assert.ok(eleven.gold.targets.some((t) => t.id === '화면 GW_LOG'), '화면 정의 원천은 화면 대상')
})

test('H14 · H15 · H16 · H8: 다듬기 검출률 · http 입력 · 골든 값의 다음 값 · Bash 명령 셈', async () => {
  const dir = path.resolve('test/fixture/harness/다듬기')
  const spec = JSON.parse(fs.readFileSync(path.join(dir, '결함.json'), 'utf8'))
  const raw = fs.readFileSync(path.join(dir, spec.file), 'utf8')
  const a = polishScoreOf(raw, spec)
  assert.equal(a.fixed, 0, '심은 결함은 처음에 모두 보인다')
  assert.deepEqual(a.lost, [])
  const good = raw.replace(/^가\. /m, '1. ').replace(/^나\. /m, '2. ').replace(' — ', '. ').replace('log_dir', '`log_dir`').replace('콜럼', '컬럼').replace(/^① /m, '1. ').replace(/^② /m, '2. ').replace(/^③ /m, '3. ').replace('`지우고 이름을 남긴다`', '지우고 이름을 남긴다')
  const b = polishScoreOf(good, spec)
  assert.equal(b.rate, 1, b.missed.join(' / '))
  assert.deepEqual(polishScoreOf(good.replace('14일', '15일'), spec).lost, ['14일'], '값을 바꾸면 잃은 값으로 센다')

  const s3 = { n: 3, title: '장애 대응 절차', md: fs.readFileSync(path.join(FIX, '03 장애 대응 절차.md'), 'utf8') }
  const inp = httpInputOf(s3)
  assert.deepEqual(inp.sections.map((x) => x.heading), ['장애 대응 절차', '되돌리기'], '첫 ## 앞의 차례도 항목으로')
  assert.match(inp.sections[0].content, /10분 안[\s\S]*400 묶음/)
  assert.equal(inp.names.length, 2)
  for (const n of inp.names) { assert.ok(n.gist.length >= 15 && n.gist !== n.label, n.gist); assert.equal(n.doc, '장애 대응 절차') }
  assert.deepEqual([inp.natures[0].nature, inp.forms[0].kind], ['절차', '절차'])

  const body = '| 설정 | 값 |\n|---|---|\n| 전송 주기 | 5초 |\n| 재시도 | 3회 |'
  const g1 = goldStep(body)
  assert.deepEqual([g1.from, g1.to], ['5초', '10초'])
  assert.match(g1.body, /\| 전송 주기 \| 10초 \|/)
  assert.deepEqual([goldStep(g1.body).from, goldStep(g1.body).to], ['10초', '15초'])
  assert.equal(goldStep('| 읽기 시간 초과 | 20초 |'), null, '읽기 시간 초과는 전송기 시간 초과가 아니다')
  assert.equal(goldStep('| 시간 초과 | 20초 |').to, '30초')
  assert.equal(goldStep('| 재시도 | 3회 |'), null)
  const fact = new RegExp(gold.facts.find((f) => f.id === '수집기 전송 주기').re)
  for (const v of [g1.body, goldStep(g1.body).body]) assert.match(v, fact, '바꾼 값이 골든 알갱이 안에 있다')

  const out = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node C:/k/scripts/kmd-migrate.mjs check C:/kn ./input.json' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: '쓰는 법: kmd-migrate.mjs check …' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'kmd-migrate.mjs check 를 다시 부른다' }, { type: 'tool_use', name: 'Read', input: { file_path: 'kmd-migrate.mjs check' } }] } }),
    JSON.stringify({ type: 'result', result: 'kmd-migrate.mjs check 끝' }),
  ].join('\n')
  assert.deepEqual(bashCommands(out), ['node C:/k/scripts/kmd-migrate.mjs check C:/kn ./input.json'], '말 · 결과 · 다른 도구 글은 세지 않는다')
  // 세션 스킬 허락: 하위 명령마다 맨 꼴과 따옴표 꼴 둘(real-2 kmd-seed 의 `node "…/kmd-seed.mjs" check` 거절)
  assert.deepEqual(subAllow('C:/k/scripts/kmd-seed.mjs', ['check']), ['Bash(node C:/k/scripts/kmd-seed.mjs check:*)', 'Bash(node "C:/k/scripts/kmd-seed.mjs" check:*)'])
})

test('H19 · 견주기 · --model-commit: edit-source 채널 몫 점수 · report --compare 표 · 커밋 들이기만 다른 모델', async () => {
  const k0 = await kn({ 'docs/설계.md': ['# 설계', '', '## 수집기', '', '| 설정 | 값 |', '|---|---|', '| 전송 주기 | 5초 |', ''].join('\n') })
  const k1 = await kn({ 'docs/설계.md': ['# 설계', '', '## 수집기', '', '| 설정 | 값 |', '|---|---|', '| 전송 주기 | 5초 |', '| 점검 시간 | 매일 09:00 |', ''].join('\n') })
  const es = editSourceScoreOf(k0, k1, '설계')
  assert.deepEqual(es.valueAt, ['설계 › 수집기'])
  assert.equal(es.inDoc, true)
  assert.deepEqual(es.ok, { placed: true, noNewVocab: true, asofEmpty: true })

  const ch = (cost, ms, model, f1, put = 1) => ({ total: { cost, ms, turns: 10, put, rows: 2, tokens: { input: 10, output: 100, cacheRead: 1000, cacheWrite: 500 } }, base: { cost: 0.4 }, score: { f1, missRate: 0, scope: { facts: '3/31' } }, rows: [{ models: [model] }] })
  const A = { tag: 'real-1', day: '2026-11-19', head: 'c20efc1', channels: { session: ch(1.6, 260000, 'claude-opus-4-6[1m]', 0.95), 'intake-file': ch(0.66, 304000, 'claude-sonnet-4-6', 1) } }
  const B = { tag: 'real-2', day: '2026-11-22', head: 'abc1234', channels: { session: ch(0.8, 130000, 'claude-sonnet-4-6', 1), 'intake-file': ch(0.33, 200000, 'claude-sonnet-4-6', 1, 2) } }
  const c = compareOf(A, B)
  assert.deepEqual(c.total.usd, [2.26, 1.13])
  assert.deepEqual(c.total.modelDiffer, ['session'])
  const md = c.md.join('\n')
  assert.match(md, /\| session \| 모델 다름 \| opus-4-6 → sonnet-4-6 \| 1\.600 → 0\.800 \| -50% \|/)
  assert.match(md, /\| intake-file \| 같음 \| sonnet-4-6 → sonnet-4-6 \| 0\.660 → 0\.330 \| -50% \| 304 → 200 \| -34\.2% \|/)
  assert.match(md, /1\/2 → 2\/2/)
  assert.match(md, /\| session \| 모델 다름 \| 3\/31 → 3\/31 \| 0\.95 → 1 \(\+0\.05\) \|/)

  assert.equal(modelsOf('', ''), null)
  assert.deepEqual(modelsOf('', 'haiku'), { agentCommit: 'haiku', commit: 'haiku' })
  assert.deepEqual(modelsOf('sonnet', 'haiku'), { agent: 'sonnet', ingest: 'sonnet', commit: 'haiku', agentCommit: 'haiku' })
  const { modelOf, sessionRole } = await import('../core/models.js')
  assert.equal(modelOf(sessionRole({ type: 'commit' }), modelsOf('', 'haiku')), 'haiku', '커밋 들이기 세션만 haiku')
  assert.equal(modelOf(sessionRole({ type: 'file' }), modelsOf('', 'haiku')), 'sonnet', '파일 들이기는 기본 그대로')
})

// harness 검토 지적 — 판정 · 계측 규칙(H1 · H2 · H4 · H10 · H17)을 순수 함수로 꺼내 저장 줄 · 계측 줄 견본으로 본다
test('H1 저장 줄 판정: 같은 대상을 뒤에 넣었을 때만 회복 · 다른 원천의 들어감은 걸린 원천을 덮지 않는다 · 대상 없는 옛 줄은 남은 오류', () => {
  const ok = (rec, targets, extra = {}) => ({ ch: 'bulk', rec, put: targets.length, err: null, targets, ok: extra.ok || [], ...extra })
  const bad = (err, targets) => ({ ch: 'bulk', err, n: targets?.length || 0, ...(targets ? { targets } : {}) })
  // 같은 대상을 다시 propose 해 넣었다 → 회복
  let j = saveJudgeOf([bad('E_APPROVE', ['모듈:수집기']), ok('r1', ['모듈:수집기'])], { fromSavelog: true })
  assert.deepEqual([j.put, j.codes, j.recoveredCodes, j.putRecs], [true, [], ['E_APPROVE'], 1])
  // 원천 A(전송기)가 걸리고 원천 B(버퍼)만 들어갔다 → A 의 오류는 남는다 · 들어간 원천 1
  j = saveJudgeOf([bad('E_FORMAT', ['docs/게이트웨이 설계.md#전송기']), ok('r2', ['docs/게이트웨이 설계.md#버퍼'])], { fromSavelog: true })
  assert.deepEqual([j.put, j.codes, j.recoveredCodes, j.putRecs], [true, ['E_FORMAT'], [], 1])
  // 섞임: 하나는 회복 · 하나는 남음 · 같은 코드가 둘 다면 남은 쪽으로만
  j = saveJudgeOf([bad('E_APPROVE', ['a']), bad('E_APPROVE', ['b']), bad('E_INPUT', ['c']), ok('r1', ['a']), ok('r2', ['c'])], { fromSavelog: true })
  assert.deepEqual([j.codes, j.recoveredCodes, j.putRecs], [['E_APPROVE'], ['E_INPUT'], 2])
  // 뒤 줄의 ok(넣은 자리)로도 대 본다 · 대상이 없는 옛 줄은 회복으로 세지 않는다
  j = saveJudgeOf([bad('E_APPROVE', ['게이트웨이 설계 › 버퍼']), ok('r1', [], { ok: ['게이트웨이 설계 › 버퍼'], put: 1 })], { fromSavelog: true })
  assert.deepEqual(j.recoveredCodes, ['E_APPROVE'])
  j = saveJudgeOf([bad('E_APPROVE'), ok('r1', ['x'])], { fromSavelog: true })
  assert.deepEqual([j.codes, j.recoveredCodes], [['E_APPROVE'], []])
  // 넣은 줄이 앞에만 있으면 회복이 아니다 · 무인 고쳐 받기 줄(unattended)은 오류로 세지 않는다
  j = saveJudgeOf([ok('r1', ['a']), bad('E_CONFLICT', ['a']), { err: 'unattended', put: 0 }], { fromSavelog: true })
  assert.deepEqual([j.put, j.codes], [true, ['E_CONFLICT']])
  // 세션 길이 아니면 들어감은 fn 이 정한 값 그대로 · 걸린 줄만 있으면 못 넣음
  assert.equal(saveJudgeOf([ok('r1', ['a'])], { put: false }).put, false)
  assert.deepEqual(saveJudgeOf([bad('E_APPROVE', ['a'])], { fromSavelog: true }), { put: false, codes: ['E_APPROVE'], recoveredCodes: [], putRecs: 0 })
})

test('H17 · H4 계측 줄: 한 프로세스의 result 여럿은 비용 마지막 · 토큰 · 차례 합 · self 는 serverCost null 이고 costGap 없음', () => {
  const ml = [
    { run: 'p1', cost: 0.049, turns: 3, tokens: { input: 10, output: 100, cacheRead: 1000, cacheWrite: 200 }, model: 'claude-sonnet-4-6' },
    { run: 'p1', cost: 0.069, turns: 2, tokens: { input: 5, output: 50, cacheRead: 500, cacheWrite: 0 }, model: 'claude-sonnet-4-6' },
    { run: 'p2', cost: 0.01, turns: 1, tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, model: 'claude-opus-4-6' },
  ]
  const m = meterRowOf({ cost: 0.05, calls: 1 }, ml)
  assert.equal(m.cost, 0.079, '프로세스마다 마지막 result 의 cost 를 더한다')
  assert.equal(m.turns, 6, '차례는 result 마다 더한다')
  assert.deepEqual(m.tokens, { input: 16, output: 151, cacheRead: 1500, cacheWrite: 200 })
  assert.deepEqual([m.calls, m.meter.multiResultProcs, m.serverCost, m.costGap], [2, 1, 0.05, 0.029])
  assert.deepEqual(m.models, ['claude-sonnet-4-6', 'claude-opus-4-6'])
  const self = meterRowOf({ cost: 0.05, calls: 1 }, ml, { selfCost: true })
  assert.deepEqual([self.serverCost, self.costSource, 'costGap' in self], [null, 'self', false])
  assert.deepEqual(meterRowOf({ cost: 0.1234, calls: 2 }, []), { serverCost: 0.1234, serverCalls: 2, cost: 0.1234 }, '계측 줄이 없으면 제품 값')
})

test('H2 · H10 일감 들어감 · 채널 합: 넣은 것 0 · 기록 없음은 빈 것 · 앞 걸음(aux)은 건 수에서 빠진다', () => {
  assert.deepEqual(jobPutOf({ state: 'done', result: { put: 0, rec: null } }), { put: false, empty: true })
  assert.deepEqual(jobPutOf({ state: 'done', result: { put: 2, rec: 'r1' } }), { put: true, empty: false })
  assert.deepEqual(jobPutOf({ state: 'done', result: { put: 0, rec: 'r1', same: true } }), { put: true, empty: false }, '기록이 남은 일감(같음)은 들어감')
  assert.deepEqual(jobPutOf({ state: 'done', result: { empty: true } }), { put: false, empty: true })
  assert.deepEqual(jobPutOf({ state: 'failed', result: { put: 0, rec: null } }), { put: false, empty: false })
  assert.deepEqual(jobPutOf({ state: 'done', result: { aborted: true, put: 0, rec: null } }), { put: false, empty: false })
  const t = totalsOf([
    { aux: true, cost: 0.1, ms: 1000, put: false, costSource: 'self', serverCost: null },
    { cost: 0.2, ms: 2000, put: true, serverCost: 0.2 },
    { cost: 0.3, ms: 3000, put: true, sources: 2, putRecs: 1, serverCost: null, costSource: 'self' },
  ])
  assert.deepEqual([t.rows, t.auxRows, t.put, t.cost, t.ms, t.serverCost, t.selfCostRows, t.sources, t.putSources], [2, 1, 2, 0.6, 6000, 0.2, 2, 2, 1])
})

test('견주기: 셈 규칙 · 넣은 것이 다른 채널을 가르고 · 옛 결과(aux 없음)는 지금 규칙으로 다시 센다', () => {
  const row = (step, put, extra = {}) => ({ step, put, cost: 0.1, ms: 1000, turns: 1, ...extra })
  const ch = (rows, extra = {}) => ({ total: totalsOf(rows), base: { cost: 0 }, rows, fed: [1, 2, 3], note: '같은 설명', ...extra })
  // real-1 꼴: 옛 tokensRule · rowRule · putRule 없음 · 앞 걸음에 aux 가 없다 · shape-pc 는 result 가 여럿인 프로세스
  const A = { tag: 'real-1', tokensRule: 'last-result-per-process (unverified)', scoreRule: 'gold subset by fed sources (score.scope)', channels: {
    shape: ch([row('조사(올린 묶음)', false), row('구조안(shape-plan · Claude)', false), row('글 짓기(shape-write · 문서 3)', false), row('연습 판 → 넣기(짜임 걸음)', false)]),
    'shape-pc': ch([row('글 짓기(세션 · 문서 3)', false, { meter: { procs: 3, results: 4 } }), row('연습 판 → 넣기(짜임 걸음)', true)]),
    session: ch([row('사람 세션', true)], { score: { f1: 0.8 } }),
    polish: ch([row('다듬기', true)], { fed: [1, 3], note: '들인 문서 둘' }),
    http: ch([row('A', true)], { fed: [1, 3] }),
  } }
  const B = { tag: 'real-2', tokensRule: RULES.tokens, rowRule: RULES.rows, putRule: RULES.put, scoreRule: 'new', channels: {
    shape: ch([row('조사(올린 묶음)', false, { aux: true }), row('구조안', false, { aux: true }), row('글 짓기', false, { aux: true }), row('연습 판 → 넣기(짜임 걸음)', true)]),
    'shape-pc': ch([row('글 짓기', false, { aux: true }), row('연습 판 → 넣기(짜임 걸음)', true)]),
    session: ch([row('사람 세션', true, { putBy: 'savelog' })], { score: { f1: 0.9 } }),
    polish: ch([row('다듬기', true)], { fed: [1, 3], note: '결함을 심은 문서', feedRev: 2 }),
    http: ch([row('A', true)], { fed: [1, 3], feedRev: 1 }),
  } }
  const A2 = recountRun(A)
  assert.equal(A2.channels.shape.total.rows, 1, '옛 결과의 앞 걸음(조사 · 구조안 · 글 짓기)을 건 수에서 뺀다')
  assert.equal(A2.channels['shape-pc'].total.rows, 1)
  assert.equal(A.channels.shape.rows[0].aux, undefined, '원본은 그대로')
  assert.equal(recountRun(B), B, '지금 규칙이면 그대로')
  const c = compareOf(A2, B)
  const by = Object.fromEntries(c.rows.map((r) => [r.name, r]))
  assert.deepEqual(by.shape.put, ['0/1', '1/1'])
  assert.deepEqual(by.shape.rules, [], '건 수는 다시 세어 맞췄다')
  assert.deepEqual(by['shape-pc'].rules, ['토큰 · 차례'], 'result 가 여럿인 프로세스가 있는 채널만 토큰 규칙이 걸린다')
  assert.deepEqual(by.session.rules, ['들어감 판정', '채점'])
  assert.ok(by.polish.feed?.note, 'feedRev 없는 옛 결과는 설명이 다르면 원천 다름')
  assert.equal(by.http.feed, null)
  assert.equal(by.http.same, true)
  assert.deepEqual(c.total.ruleDiffer.sort(), ['session', 'shape-pc'])
  assert.deepEqual(c.total.feedDiffer, ['polish'])
  assert.equal(c.total.same.channels, 2, '조건이 같은 채널(shape · http)만의 합을 따로 낸다')
  const md = c.md.join('\n')
  assert.match(md, /셈 규칙이 다르다: tokens\(앞 last-result-per-process/)
  assert.match(md, /\| shape-pc \| 규칙 다름\(토큰 · 차례\) \|/)
  assert.match(md, /\| polish \| 원천 다름\(\[1,3\] → \[1,3\] · 넣는 법 1 → 2 · 설명 다름\) \|/)
  assert.match(md, /조건이 같은 채널 2 · 합/)
})

// T1 · T2(채널 평가 7절) — real-2 의 polish F1 0.762 · pc-intake F1 0.5 는 지식이 아니라 채점이 틀렸다
test('채점 T1: 다듬기가 띄어쓰기를 고쳐도(「PLC 에서」 → 「PLC에서」) 알갱이를 알아보고 · gold one 대상이 두 항목에 나뉘어도 한 묶음이다', async () => {
  // 원천에 맞는 알갱이 정규식은 영문 · 숫자 뒤 띄어쓰기를 붙인 글에도 맞아야 한다(다듬기는 「03:00 에」 → 「03:00에」 를 고친다)
  for (const s of gold.sources) {
    const md = fs.readFileSync(path.join(FIX, s.file), 'utf8')
    const tight = md.replace(/([A-Za-z0-9)`%]) (?=[가-힣])/g, '$1')
    for (const f of gold.facts) if (new RegExp(f.re, 'i').test(md)) assert.ok(new RegExp(f.re, 'i').test(tight), `띄어쓰기를 고치면 놓치는 알갱이: ${f.id}`)
  }
  const { gold: g } = await goldScope([1, 3])
  const k = await kn({
    'docs/게이트웨이 설계.md': ['# 게이트웨이 설계', '', '## 수집기', '', 'PLC에서 값을 읽어 묶음으로 만든다. 재시도 3회 · 읽기 시간 초과 3초 · 전송 주기 5초.', '', '## 전송기', '', '묶음을 중앙 서버로 보내는 프로세스다. 시간 초과 20초 · 큐 한도 500 묶음.', '', '## gw_log', '', 'log_id · retry_cnt', ''].join('\n'),
    'docs/장애 대응 절차.md': ['# 장애 대응 절차', '', '## 장애 대응 절차', '', '1. 10분 안에 확인한다.', '2. 400 묶음을 넘으면 알린다.', '', '## 되돌리기', '', '되돌린 뒤 30분 동안 값을 지켜본다.', ''].join('\n'),
  })
  const s = scoreKnowledge(k, g)
  assert.deepEqual(s.detail.facts, []) // 모두 제자리(수집기 뜻 포함)
  assert.equal(s.f1, 1) // 「되돌리기」 의 30분과 「장애 대응 절차」 의 10분 · 400 묶음은 같은 대상(one)이라 쌍이 맞다
  // one 이 아닌 대상은 그대로 항목 하나가 묶음이다: 수집기 알갱이를 둘로 나누면 깎인다
  const split = await kn({ 'docs/게이트웨이 설계.md': ['# 게이트웨이 설계', '', '## 수집기', '', 'PLC에서 값을 읽는다. 재시도 3회.', '', '## 수집 모듈', '', '읽기 시간 초과 3초 · 전송 주기 5초.', ''].join('\n') })
  assert.ok(scoreKnowledge(split, g).recall < 1)
  // one 대상 묶음에 다른 대상의 알갱이가 잘못 들면(수집기 전송 주기가 「되돌리기」 에) 그 쌍은 fp 로 깎인다
  const stray = await kn({
    'docs/게이트웨이 설계.md': ['# 게이트웨이 설계', '', '## 수집기', '', 'PLC에서 값을 읽어 묶음으로 만든다. 재시도 3회 · 읽기 시간 초과 3초.', '', '## 전송기', '', '묶음을 중앙 서버로 보내는 프로세스다. 시간 초과 20초 · 큐 한도 500 묶음.', '', '## gw_log', '', 'log_id · retry_cnt', ''].join('\n'),
    'docs/장애 대응 절차.md': ['# 장애 대응 절차', '', '## 장애 대응 절차', '', '1. 10분 안에 확인한다.', '2. 400 묶음을 넘으면 알린다.', '', '## 되돌리기', '', '되돌린 뒤 30분 동안 값을 지켜본다. 전송 주기 5초.', ''].join('\n'),
  })
  assert.ok(scoreKnowledge(stray, g).precision < 1)
})

test('채점 T2: 회의 하나만 넣었을 때 지나가며 말한 대상(수집기)의 값이 그 회의 항목에 남아도 맞다(R3-5 나)', async () => {
  const { gold: g, scope } = await goldScope([2])
  assert.deepEqual(scope.passing, ['수집기'])
  assert.ok(g.facts.find((f) => f.id === '수집기 전송 주기').alts.includes('회의 2026-11-10'))
  const k = await kn({ 'docs/회의록.md': ['# 회의록', '', '## 2026-11-10 주간 회의', '', '참석: 김, 박, 이.', '', '정한 것:', '- 수집기 전송 주기: 5초 → 10초(3초 안은 버렸다: 부하가 더 는다).', ''].join('\n') })
  const s = scoreKnowledge(k, g)
  assert.equal(s.f1, 1)
  assert.equal(s.factPlaced, 1)
  // 결정 항목을 따로 세워도 맞다(alt)
  const k2 = await kn({ 'docs/회의록.md': ['# 회의록', '', '## 2026-11-10 주간 회의', '', '참석: 김, 박, 이.', ''].join('\n'), 'docs/결정 기록.md': ['# 결정 기록', '', '## 수집기 전송 주기 10초로', '', '전송 주기 5초 → 10초. 3초 안은 버렸다.', ''].join('\n') })
  assert.equal(scoreKnowledge(k2, g).factPlaced, 1)
  // 수집기 항목이 선 바탕(원천 1 함께)에서는 alts 를 더하지 않는다: 값은 수집기 항목이 정본이다
  const { gold: g12 } = await goldScope([1, 2])
  assert.equal(g12.facts.find((f) => f.id === '수집기 전송 주기').alts, undefined)
})

test('T3 · T9 계측 줄: 한 result 프로세스의 토큰은 modelUsage 합 · 모델별 비용 · 보조 모델 몫 · usage 밖 출력 · 진단(kmd 안 씀 · API 다시 시도 · 꼬리)', () => {
  const ml = [
    { run: 'a', cost: 0.338, turns: 8, tokens: { input: 9, output: 1680, cacheRead: 275882, cacheWrite: 45286 }, model: 'claude-sonnet-4-6', modelUsage: { 'claude-sonnet-4-6': { input: 10, output: 4673, cacheRead: 326590, cacheWrite: 45286, cost: 0.3379 } }, diag: { initMs: 2100, kmd: 'connected', kmdAt: null, kmdUsed: true, firstTool: 'Read', first: { cacheRead: 0, cacheWrite: 20000, input: 3 }, retries: 1, tools: 6, tailMs: 16000 } },
    { run: 'b', cost: 0.12, turns: 2, tokens: { input: 1, output: 300, cacheRead: 100, cacheWrite: 0 }, model: 'claude-sonnet-4-6', modelUsage: { 'claude-sonnet-4-6': { input: 1, output: 300, cacheRead: 100, cacheWrite: 0, cost: 0.1 }, 'claude-haiku-4-5': { input: 500, output: 40, cacheRead: 0, cacheWrite: 0, cost: 0.02 } }, diag: { initMs: 9000, kmd: 'pending', kmdAt: 15000, kmdUsed: false, firstTool: null, first: null, retries: 0, tools: 0, tailMs: null } },
  ]
  const m = meterRowOf({ cost: 0.458, calls: 2 }, ml)
  assert.equal(m.meter.tokensFrom, 'modelUsage')
  assert.deepEqual(m.tokens, { input: 511, output: 5013, cacheRead: 326690, cacheWrite: 45286 }, '모델별 합(보조 모델 포함)')
  assert.deepEqual(m.meter.usageTokens, { input: 10, output: 1980, cacheRead: 275982, cacheWrite: 45286 }, '옛 규칙(usage)의 값도 남긴다')
  assert.equal(m.meter.hiddenOutput, 3033, 'usage 가 담지 않은 출력(다시 시도 · 보조 모델)')
  assert.deepEqual(Object.keys(m.meter.byModel), ['claude-sonnet-4-6', 'claude-haiku-4-5'])
  assert.equal(m.meter.auxCost, 0.02, '주 모델 밖의 비용이 보조 모델 몫')
  assert.deepEqual([m.meter.diag.kmdUnused, m.meter.diag.retries, m.meter.diag.tailMs, m.meter.diag.firstTool, m.meter.diag.kmdAt, m.meter.diag.firstCacheRead], [1, 1, [16000, null], ['Read', null], [null, 15000], [0, null]])
  // 견주기: modelUsage 토큰이 usage 셈과 다른 채널은 「토큰 · 차례」 규칙 다름으로 가른다
  const A = { tag: 'a', day: 'd', tokensRule: 'old', channels: { x: { total: { cost: 1, ms: 1000, turns: 1, rows: 1, put: 1 }, rows: [{ meter: { procs: 1, results: 1 } }] } } }
  const B = { tag: 'b', day: 'd', tokensRule: RULES.tokens, channels: { x: { total: { cost: 1, ms: 1000, turns: 1, rows: 1, put: 1 }, rows: [{ meter: m.meter }] } } }
  assert.deepEqual(compareOf(A, B).rows[0].rules, ['토큰 · 차례'])
  // modelUsage 가 usage 와 같으면(다시 시도 · 보조 모델 없음) 규칙이 달라도 그 채널에는 걸리지 않는다
  const same = meterRowOf({}, [{ run: 'c', cost: 0.1, turns: 1, tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, modelUsage: { s: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.1 } } }])
  assert.deepEqual(compareOf(A, { ...B, channels: { x: { ...B.channels.x, rows: [{ meter: same.meter }] } } }).rows[0].rules, [])
  // modelUsage 없는 옛 줄은 그대로 usage(H17)
  assert.equal(meterRowOf({}, [{ run: 'd', cost: 0.1, turns: 1, tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } }]).meter.tokensFrom, undefined)
})

test('T6 · T7 · T8: 코드는 앞 원인 · 뒤 원인 순으로 쌓이고 · 고쳐 받기 까닭이 결과 행에 · 문서마다 연 동작 내역의 비용을 더한다', () => {
  // T6 — 거절(PERM_DENIED)을 input.json 없음(NO_INPUT)이 덮지 않는다
  const out = { put: false, codes: ['PERM_DENIED'], why: ['거절 1'] }
  const r = withCodes(out, ['NO_INPUT'], ['세션이 input.json 을 쓰지 않았다'])
  assert.deepEqual(r.codes, ['PERM_DENIED', 'NO_INPUT'])
  assert.deepEqual(r.why, ['거절 1', '세션이 input.json 을 쓰지 않았다'])
  assert.deepEqual(withCodes({}, ['PUT']).codes, ['PUT'])
  assert.deepEqual(withCodes({ codes: ['PUT'] }, ['PUT']).codes, ['PUT'], '같은 코드는 한 번')
  assert.deepEqual(out.codes, ['PERM_DENIED'], '원본은 그대로')
  // T7 — 스키마 일감(shape-plan)의 일꾼 로그 까닭 · 세션 들이기의 걸린 저장 줄 코드
  const f = fixOf([{ err: 'unattended', code: ['pair', 'gist'], fix: 1 }, { err: null, put: 2, fix: 1 }], ['kn: 원천: 초안 · 40초', 'kn: 원천: 검사에 걸렸다 · 고쳐 쓴다(docs[1].items[2]: 머리 「X: X」 꼴 · 재료 3 이 어느 문서에도 없다)', 'kn: 원천: 넣음 3'])
  assert.equal(f.fix, 2)
  assert.deepEqual(f.fixWhy, ['docs[1].items[2]: 머리 「X: X」 꼴 · 재료 3 이 어느 문서에도 없다', 'pair · gist'])
  assert.equal(fixOf([], []).fixWhy, undefined, '고쳐 받기가 없으면 칸도 없다')
  // T8 — 글 짓기는 문서마다 동작 내역을 새로 연다: 끝에 한 번 읽은 마지막 문서 몫(0.0576)이 아니라 문서마다 더한다
  assert.equal(feedDocsCost([{ feedCost: 0.0712 }, { feedCost: 0.0806 }, { feedCost: 0.0576 }]), 0.2094)
  assert.equal(feedDocsCost([]), 0)
})
