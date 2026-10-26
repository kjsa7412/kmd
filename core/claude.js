// claude -p 한 번 — 정리 일꾼이 초안 하나를 받는 길.
//
// 도구 0(`--tools ""`) · 빈 MCP(`--strict-mcp-config`) · JSON 스키마(`--json-schema`) · 세션 남기지 않음 · 예산 상한 ·
// 빈 임시 폴더에서 · 환경변수는 허용 목록만(이 PC 의 다른 세션 변수 · 열쇠를 넘기지 않는다).
// 들인 문서 속 주입 문장이 움직일 수 있는 것은 JSON 초안 하나뿐이다 — 그 초안도 서버가 검사한다.
//
// 시험은 KMD_CLAUDE 에 가짜(node 스크립트)를 준다.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { modelArgs } from './models.js'

export const ENV_ALLOW = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'TEMP', 'TMP', 'LANG', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'FAKE_CLAUDE_MODE', 'FAKE_CLAUDE_LOG', 'FAKE_CLAUDE_READ', 'FAKE_CLAUDE_SPANS', 'FAKE_AGENT_MODE', 'FAKE_AGENT_WAIT_MS']

// model — 별칭(haiku · sonnet · opus) · 비면 그 PC 의 기본 모델(core/models.js)
export async function runClaude({ prompt, schema, budget = 0.5, timeoutMs = 180_000, model = '' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-worker-'))
  const env = Object.fromEntries(ENV_ALLOW.filter((k) => process.env[k] != null).map((k) => [k, process.env[k]]))
  const args = ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: {} }), '--no-session-persistence', '--max-budget-usd', String(budget), '--json-schema', JSON.stringify(schema), ...modelArgs(model)]
  if (process.env.ANTHROPIC_API_KEY) args.push('--bare')
  const fake = process.env.KMD_CLAUDE
  const win = process.platform === 'win32'
  const [cmd, argv, opt] = fake ? [process.execPath, [fake, ...args], {}] : [win ? 'claude.cmd' : 'claude', args, win ? { shell: true } : {}]
  const quoted = opt.shell ? argv.map((a) => (a === '' ? '""' : /[\s"{}]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : argv
  try {
    const out = await new Promise((resolve) => {
      const p = spawn(cmd, quoted, { cwd: dir, env, windowsHide: true, ...opt })
      let so = ''
      let se = ''
      const t = setTimeout(() => p.kill(), timeoutMs)
      p.stdout.on('data', (c) => (so += c))
      p.stderr.on('data', (c) => (se += c))
      p.on('error', (e) => resolve({ code: -1, so, se: String(e.message) }))
      p.on('close', (code) => {
        clearTimeout(t)
        resolve({ code, so, se })
      })
      p.stdin.end(prompt)
    })
    return parse(out)
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {} // Windows 의 EBUSY — 남겨도 답은 버리지 않는다
  }
}

// 답 — 마지막 JSON 줄의 structured_output(또는 result 안의 JSON). 로그인 · 한도는 따로 가른다
export function parse({ code, so, se }) {
  const line = String(so).trim().split('\n').reverse().find((l) => l.trim().startsWith('{'))
  let j = null
  try {
    j = line ? JSON.parse(line) : null
  } catch {}
  const text = `${j?.result || ''} ${se || ''}`
  if (!j || j.is_error || code) {
    if (/login|log in|api key|auth|unauthori|credential|401/i.test(text)) return { error: 'login', message: text.trim().slice(0, 200) }
    if (/limit|quota|rate|usage|budget|429/i.test(text)) return { error: 'limit', message: text.trim().slice(0, 200) }
    return { error: 'fail', message: text.trim().slice(0, 200) || `종료 ${code}` }
  }
  let v = j.structured_output ?? null
  if (v == null && typeof j.result === 'string') {
    const m = j.result.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, j.result]
    try {
      v = JSON.parse(m[1])
    } catch {
      return { error: 'shape', message: '초안이 JSON 이 아니다' }
    }
  }
  return { value: v, cost: j.total_cost_usd || 0, model: j.model || null }
}

// 로그인 확인 — 아주 작은 부르기 한 번(`claude auth status` 는 끝난 로그인도 「됨」 으로 말해서 실제로 불러 본다)
export async function checkClaude() {
  const r = await runClaude({ prompt: '이 물음에는 {"ok": true} 로만 답한다.', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, budget: 0.05, timeoutMs: 90_000, model: 'haiku' })
  return r.error ? { ok: false, reason: r.error, message: r.message } : { ok: true }
}
