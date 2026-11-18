// 지식 생성 하네스 평가 시험의 채점(scripts/harness-eval.mjs) — Claude 없이: 골든 셋이 읽히고, 손으로 세운 지식을 묶음 동치로 채점한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadKnowledge } from '../core/knowledge.js'
import { scoreKnowledge, gateOf, itemsOf } from '../scripts/harness-eval.mjs'

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
