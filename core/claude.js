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

export const ENV_ALLOW = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'TEMP', 'TMP', 'LANG', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'FAKE_CLAUDE_MODE', 'FAKE_CLAUDE_LOG', 'FAKE_CLAUDE_READ', 'FAKE_CLAUDE_SPANS', 'FAKE_CLAUDE_STREAM_MS', 'FAKE_AGENT_MODE', 'FAKE_AGENT_WAIT_MS']

// model — 별칭(haiku · sonnet · opus) · 비면 그 PC 의 기본 모델(core/models.js)
// onTick({ out, think, ms }) — 흘려 받기(stream-json): 쓴 글(답 · 스키마 답) · 생각 글자 수와 지난 시간을 tickMs 마다 한 번(끝날 때만 답하던 json 은 몇 분씩 소식이 없었다)
export async function runClaude({ prompt, schema, budget = 0.5, timeoutMs = 180_000, model = '', onTick = null, tickMs = 10_000 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-worker-'))
  const env = Object.fromEntries(ENV_ALLOW.filter((k) => process.env[k] != null).map((k) => [k, process.env[k]]))
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', '', '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: {} }), '--no-session-persistence', '--max-budget-usd', String(budget), '--json-schema', JSON.stringify(schema), ...modelArgs(model)]
  if (process.env.ANTHROPIC_API_KEY) args.push('--bare')
  const fake = process.env.KMD_CLAUDE
  const win = process.platform === 'win32'
  const [cmd, argv, opt] = fake ? [process.execPath, [fake, ...args], {}] : [win ? 'claude.cmd' : 'claude', args, win ? { shell: true } : {}]
  const quoted = opt.shell ? argv.map((a) => (a === '' ? '""' : /[\s"{}]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : argv
  try {
    const out = await new Promise((resolve) => {
      const p = spawn(cmd, quoted, { cwd: dir, env, windowsHide: true, ...opt })
      // 줄마다 읽는다 — 답은 끝 줄(result) 하나만 두고, 사이 줄은 글자 수만 센다(긴 글을 통째로 쌓지 않는다)
      let so = ''
      let se = ''
      let buf = ''
      let late = false
      const n = { out: 0, think: 0 }
      const t0 = Date.now()
      const line = (l) => {
        if (!l.trim().startsWith('{')) return
        let j
        try { j = JSON.parse(l) } catch { return }
        if (j.type === 'result') { so = l; return }
        const d = j.type === 'stream_event' ? j.event?.delta : null
        if (d?.type === 'thinking_delta') n.think += String(d.thinking || '').length
        else if (d?.type === 'text_delta') n.out += String(d.text || '').length
        else if (d?.type === 'input_json_delta') n.out += String(d.partial_json || '').length
      }
      const t = setTimeout(() => { late = true; p.kill() }, timeoutMs)
      const tick = onTick ? setInterval(() => { try { onTick({ out: n.out, think: n.think, ms: Date.now() - t0 }) } catch {} }, tickMs) : null
      p.stdout.on('data', (c) => {
        buf += c
        const ls = buf.split('\n')
        buf = ls.pop()
        ls.forEach(line)
      })
      p.stderr.on('data', (c) => (se += c))
      p.on('error', (e) => { clearInterval(tick); resolve({ code: -1, so, se: String(e.message) }) })
      p.on('close', (code) => {
        clearTimeout(t)
        clearInterval(tick)
        if (buf) line(buf)
        // 시간이 넘어 끊었다(종료 143 · SIGTERM) — 「종료 143」 만으로는 무엇인지 모른다
        resolve(late ? { code, so: '', se: `시간이 넘었다(${Math.round(timeoutMs / 60_000)}분): 글이 길면 다음 정리 때 다시` } : { code, so, se })
      })
      p.stdin.end(prompt)
    })
    const r = parse(out)
    return r
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
  // 끝 JSON 의 수치 — 시간 · 토큰 · 비용 · 턴(정리 장부 · 일꾼 기록이 자리마다 남긴다)
  const stat = j ? { cost: j.total_cost_usd || 0, model: j.model || null, apiMs: j.duration_api_ms || j.duration_ms || 0, tokens: (j.usage?.output_tokens || 0) + (j.usage?.input_tokens || 0), outTokens: j.usage?.output_tokens || 0, turns: j.num_turns || 0 } : {}
  if (!j || j.is_error || code) {
    // claude 가 이 PC 에 없다 — 자리마다 다시 불러도 같다(일꾼은 멈추고 서버가 규칙으로 넣는다)
    if (!j && /ENOENT|not found|is not recognized/i.test(se || '')) return { error: 'missing', message: 'Claude Code(claude) 가 설치되어 있지 않다' }
    // 까닭은 subtype(error_max_budget_usd · error_max_turns · error_during_execution)이 먼저 — 「종료 1」 만으로는 무엇인지 모른다 ·
    //   subtype 이 말하면 글로 가르지 않는다: 글 속 「limit · auth」 같은 낱말이 일꾼 전체를 멈추던 것(로그인 · 한도는 STOP)
    const sub = j?.subtype && j.subtype !== 'success' && j.subtype !== 'error' ? String(j.subtype) : ''
    const errs = Array.isArray(j?.errors) ? j.errors.map(String).join(' · ') : ''
    const text = `${j?.is_error ? j.result || '' : ''} ${errs} ${se || ''}`
    const why = [sub, text.trim()].filter(Boolean).join(' · ').slice(0, 200)
    const tag = { sub: sub || null, ...stat }
    if (/budget/i.test(sub)) return { error: 'budget', message: `예산을 넘었다: ${why}`, ...tag }
    if (sub) return { error: 'fail', message: why, ...tag }
    if (/not logged in|please run \/login|invalid api key|oauth token (?:has )?expired|authentication[_ ]error|\bunauthori[sz]ed\b|\b401\b/i.test(text)) return { error: 'login', message: why, ...tag }
    if (/usage limit|rate[_ ]?limit|quota|\b429\b/i.test(text)) return { error: 'limit', message: why, ...tag }
    if (/exceeded.*budget|budget.*exceeded/i.test(text)) return { error: 'budget', message: `예산을 넘었다: ${why}`, ...tag }
    return { error: 'fail', message: why || `종료 ${code}`, ...tag }
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
  return { value: v, ...stat }
}

// 로그인 확인 — 아주 작은 부르기 한 번(`claude auth status` 는 끝난 로그인도 「됨」 으로 말해서 실제로 불러 본다)
export async function checkClaude() {
  const r = await runClaude({ prompt: '이 물음에는 {"ok": true} 로만 답한다.', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, budget: 0.05, timeoutMs: 90_000, model: 'haiku' })
  return r.error ? { ok: false, reason: r.error, message: r.message } : { ok: true }
}
