// 생각 글자 수 계측(채널 평가 T14): runAgent 가 stream-json 의 thinking 블록 글자 수를 합 · 차례(message id)별 최댓값으로 센다(글은 남기지 않는다)
//   가짜 에이전트(KMD_CLAUDE_AGENT)가 차례 둘(한 차례는 thinking 블록 둘로 나뉘어 온다)을 낸다

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runAgent } from '../core/agent.js'

test('runAgent: 생각 글자 수(합 · 차례 최댓값) · 끝 줄에 「생각 N자」 · 생각 글은 줄에 싣지 않는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-think-'))
  const fake = path.join(dir, 'fake-think.mjs')
  const lines = [
    { type: 'system', subtype: 'init', model: 'fake', mcp_servers: [] },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: '가'.repeat(30) }] } },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: '나'.repeat(20) }, { type: 'text', text: '읽는다' }] } },
    { type: 'assistant', message: { id: 'm2', content: [{ type: 'thinking', thinking: '다'.repeat(40) }, { type: 'text', text: '끝' }] } },
    { type: 'result', result: '끝', total_cost_usd: 0, num_turns: 2, is_error: false },
  ]
  fs.writeFileSync(fake, `process.stdin.resume(); process.stdin.on('end', () => { for (const l of ${JSON.stringify(lines)}) process.stdout.write(JSON.stringify(l) + '\\n') })`)
  const old = process.env.KMD_CLAUDE_AGENT
  process.env.KMD_CLAUDE_AGENT = fake
  const got = []
  try {
    const r = await runAgent({ prompt: '일', onLine: (l) => got.push(l), timeoutMs: 30_000 })
    assert.equal(r.ok, true)
    assert.deepEqual(r.thinkChars, { sum: 90, max: 50 })
    const end = got.find((l) => l.k === 'cost')
    assert.match(end.x, /생각 90자\(차례 최대 50자\)/)
    assert.ok(!got.some((l) => /가가가|나나나|다다다/.test(String(l.x))), '생각 글은 줄에 싣지 않는다')
  } finally {
    if (old == null) delete process.env.KMD_CLAUDE_AGENT; else process.env.KMD_CLAUDE_AGENT = old
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
