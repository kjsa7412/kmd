// 비용 · 속도 — 문서 변환 비용 절감(2026-10-26).
//
// 일마다 Claude 모델(옮겨 적기 · 고르기는 haiku · 판단은 sonnet · 설정으로 바꾼다 · 「기본」 이면 --model 을 넘기지 않는다).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { modelOf, modelArgs, DEFAULT_MODELS, ROLES } from '../core/models.js'
import { runClaude } from '../core/claude.js'
import { runAgent } from '../core/agent.js'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture')

test('일마다 모델 — 기본 배분 · 고른 값 · 「기본」 · 모르는 값', () => {
  assert.deepEqual(ROLES.map((r) => modelOf(r)), ROLES.map((r) => DEFAULT_MODELS[r]))
  assert.equal(modelOf('read'), 'haiku')
  assert.equal(modelOf('agent'), 'sonnet')
  assert.equal(modelOf('agent', { agent: 'opus' }), 'opus')
  assert.equal(modelOf('read', { read: '' }), '', '「기본」 은 그대로 빈 값')
  assert.equal(modelOf('read', { read: 'gpt-4' }), 'haiku', '모르는 값은 기본 배분으로')
  assert.deepEqual(modelArgs('haiku'), ['--model', 'haiku'])
  assert.deepEqual(modelArgs(''), [])
})

test('claude -p · 에이전트에 --model 이 간다(비면 넘기지 않는다)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-cost-'))
  const log = path.join(tmp, 'calls.log')
  const keep = { KMD_CLAUDE: process.env.KMD_CLAUDE, KMD_CLAUDE_AGENT: process.env.KMD_CLAUDE_AGENT, FAKE_CLAUDE_LOG: process.env.FAKE_CLAUDE_LOG }
  process.env.KMD_CLAUDE = path.join(FIX, 'fake-claude.mjs')
  process.env.KMD_CLAUDE_AGENT = path.join(FIX, 'fake-claude-agent.mjs')
  process.env.FAKE_CLAUDE_LOG = log
  try {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } }
    await runClaude({ prompt: 'x', schema, model: 'haiku' })
    await runClaude({ prompt: 'x', schema })
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['call haiku', 'call'])
    const lines = []
    const r = await runAgent({ prompt: '바꾼다', files: [{ name: '원본/a.pdf', data: Buffer.from('%PDF') }], model: 'haiku', onLine: (l) => lines.push(l) })
    assert.ok(r.ok)
    assert.ok(lines.some((l) => l.k === 'sys' && /모델 haiku/.test(l.x)))
    assert.ok(lines.some((l) => l.k === 'sys' && /fake-agent\(haiku\)/.test(l.x)))
  } finally {
    for (const [k, v] of Object.entries(keep)) v == null ? delete process.env[k] : (process.env[k] = v)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
