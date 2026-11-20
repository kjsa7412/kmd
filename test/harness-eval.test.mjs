// 지식 생성 하네스 평가 시험의 채점(scripts/harness-eval.mjs) — Claude 없이: 골든 셋이 읽히고, 손으로 세운 지식을 묶음 동치로 채점한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadKnowledge } from '../core/knowledge.js'
import { scoreKnowledge, gateOf, itemsOf, factText, natureOf } from '../scripts/harness-eval.mjs'
import { goldScope, compareOf, polishScoreOf, goldStep, httpInputOf, bashCommands, modelsOf, editSourceScoreOf } from '../scripts/channel-eval.mjs'

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
  assert.match(md, /\| session \| opus-4-6 → sonnet-4-6 \(모델 다름\) \| 1\.600 → 0\.800 \| -50% \|/)
  assert.match(md, /\| intake-file \| sonnet-4-6 → sonnet-4-6 \| 0\.660 → 0\.330 \| -50% \| 304 → 200 \| -34\.2% \|/)
  assert.match(md, /1\/2 → 2\/2/)
  assert.match(md, /\| session \| 3\/31 → 3\/31 \| 0\.95 → 1 \(\+0\.05\) \|/)

  assert.equal(modelsOf('', ''), null)
  assert.deepEqual(modelsOf('', 'haiku'), { agentCommit: 'haiku', commit: 'haiku' })
  assert.deepEqual(modelsOf('sonnet', 'haiku'), { agent: 'sonnet', ingest: 'sonnet', commit: 'haiku', agentCommit: 'haiku' })
  const { modelOf, sessionRole } = await import('../core/models.js')
  assert.equal(modelOf(sessionRole({ type: 'commit' }), modelsOf('', 'haiku')), 'haiku', '커밋 들이기 세션만 haiku')
  assert.equal(modelOf(sessionRole({ type: 'file' }), modelsOf('', 'haiku')), 'sonnet', '파일 들이기는 기본 그대로')
})
