// 스키마 답 하나를 받는 Claude Code 세션(지식 생성 하네스 H4a-3 · H-D34) — 정정 · 다듬기 · 보내기 초안 · 짜임 · 커밋 분석.
//
// 일반 세션이다: 읽기 도구(Read · Glob · Grep)를 쥐고, mcp 를 주면 kmd MCP 에 붙어 지금 글 · 과거 결정을 스스로 찾아 읽는다
// (도구 0 의 단발 `claude -p` 는 걷었다). 답은 JSON 스키마(`--json-schema`) 한 덩이 · 세션 남기지 않음 · 예산 상한 ·
// 빈 임시 폴더에서 · 환경변수는 허용 목록만(이 PC 의 다른 세션 변수 · 열쇠를 넘기지 않는다) · 사용자 폴더의 숨은 파일은 읽지 못한다.
// 들인 문서 속 주입 문장이 움직일 수 있는 것은 JSON 초안 하나뿐이다 — 그 초안도 서버가 검사한다(이 세션의 열쇠로는 저장하지 못한다).
//
// 시험은 KMD_CLAUDE 에 가짜(node 스크립트)를 준다.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { modelArgs } from './models.js'

export const ENV_ALLOW = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'TEMP', 'TMP', 'LANG', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'FAKE_CLAUDE_MODE', 'FAKE_CLAUDE_LOG', 'FAKE_CLAUDE_MCP_LOG', 'FAKE_CLAUDE_READ', 'FAKE_CLAUDE_SPANS', 'FAKE_CLAUDE_STREAM_MS', 'FAKE_CLAUDE_LIMIT_FILE', 'FAKE_AGENT_MODE', 'FAKE_AGENT_WAIT_MS', 'FAKE_AGENT_SCRIPT', 'FAKE_AGENT_LOG', 'FAKE_AGENT_SYS']

// model — 별칭(haiku · sonnet · opus) · 비면 그 PC 의 기본 모델(core/models.js)
// onTick({ out, think, ms }) — 흘려 받기(stream-json): 쓴 글(답 · 스키마 답) · 생각 글자 수와 지난 시간을 tickMs 마다 한 번(끝날 때만 답하던 json 은 몇 분씩 소식이 없었다)
// effort — 생각 정도(low · medium · high · max · 비면 넘기지 않는다)
// onEvent(e) — 흐름 줄마다 풀어 준 것(streamEvents · 동작 내역)
export const SESSION_TOOLS = ['Read', 'Glob', 'Grep']
const SESSION_DENY = ['Read(~/.*)', 'Read(~/.*/**)', 'Read(~/AppData/Roaming/**)', 'Read(~/AppData/Local/Packages/**)']
export const MCP_READ = ['brief', 'match', 'section', 'search']
// 폴더 하나를 읽지 못하게 하는 규칙(Claude Code 권한 꼴 · 절대 경로는 「//」 · Windows 는 /c/… 꼴) — Read 규칙은 Glob · Grep 에도 걸린다
export const denyDir = (dir) => {
  const p = path.resolve(dir).split(path.sep).join('/').replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase())
  return [`Read(/${p}/**)`]
}
export async function runClaude({ prompt, schema, budget = 0.5, timeoutMs = 180_000, model = '', onTick = null, tickMs = 10_000, effort = '', onEvent = null, tools = SESSION_TOOLS, mcp = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-worker-'))
  // MCP 설정은 일 폴더 밖의 파일로(따옴표가 깨지지 않게 · 세션이 제 열쇠를 일 폴더에서 읽지 않게)
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-worker-cfg-'))
  const cfgFile = path.join(cfgDir, 'mcp.json')
  fs.writeFileSync(cfgFile, JSON.stringify({ mcpServers: mcp ? { kmd: { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } } } : {} }))
  const env = Object.fromEntries(ENV_ALLOW.filter((k) => process.env[k] != null).map((k) => [k, process.env[k]]))
  //   mcp.read — 읽기 도구만(보내기 초안 · 열쇠는 팀 서버가 내준 읽기 열쇠라 서버도 막는다): 허용은 읽기 넷 · propose · save 는 도구 목록에서도 막는다
  const allow = mcp ? (mcp.read ? MCP_READ.map((t) => `mcp__kmd__${t}`).join(',') : 'mcp__kmd') : ''
  //   MCP 설정 폴더(열쇠가 든 mcp.json)도 읽지 못한다 — 임시 폴더(~/AppData/Local/Temp)는 SESSION_DENY 밖이다
  const deny = [...SESSION_DENY, ...denyDir(cfgDir), ...(mcp?.read ? ['mcp__kmd__propose', 'mcp__kmd__save'] : [])]
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', tools.join(','), ...(allow ? ['--allowedTools', allow] : []), '--disallowedTools', deny.join(','), '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', cfgFile, '--no-session-persistence', '--max-budget-usd', String(budget), '--json-schema', JSON.stringify(schema), ...modelArgs(model)]
  if (/^(low|medium|high|max)$/.test(effort)) args.push('--effort', effort)
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
        if (onEvent) for (const e of streamEvents(j)) { try { onEvent(e) } catch {} }
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
        resolve(late ? { code, so: '', se: `시간이 넘었다(${Math.round(timeoutMs / 60_000)}분): 글이 길면 나눠 넣거나 다시 시도한다` } : { code, so, se })
      })
      p.stdin.end(prompt)
    })
    const r = parse(out)
    return r
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {} // Windows 의 EBUSY — 남겨도 답은 버리지 않는다
    try { fs.rmSync(cfgDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
  }
}

// 흐름 줄(stream-json) 하나 → 동작 내역 줄 0 ~ n. 모양:
//   start { model, tools } · open { kind } · delta { kind: think | say | json, text } · think { text } · say { text } ·
//   tool { name, input } · toolres { text, err } · note { text } · result { ok, cost, ms, turns, why? }
export function streamEvents(j) {
  if (!j || typeof j !== 'object') return []
  if (j.type === 'system' && j.subtype === 'init') return [{ k: 'start', model: j.model || '', tools: Array.isArray(j.tools) ? j.tools : [] }]
  if (j.type === 'stream_event') {
    const ev = j.event || {}
    if (ev.type === 'content_block_start') { const b = ev.content_block || {}; return [{ k: 'open', kind: b.type === 'thinking' ? 'think' : b.type === 'tool_use' ? 'json' : 'say', name: b.name || '' }] }
    if (ev.type === 'content_block_delta') {
      const d = ev.delta || {}
      if (d.type === 'thinking_delta') return [{ k: 'delta', kind: 'think', text: String(d.thinking || '') }]
      if (d.type === 'text_delta') return [{ k: 'delta', kind: 'say', text: String(d.text || '') }]
      if (d.type === 'input_json_delta') return [{ k: 'delta', kind: 'json', text: String(d.partial_json || '') }]
    }
    return []
  }
  const content = Array.isArray(j.message?.content) ? j.message.content : []
  if (j.type === 'assistant') {
    return content.flatMap((c) => c.type === 'thinking' ? (c.thinking ? [{ k: 'think', text: String(c.thinking) }] : [])
      : c.type === 'text' ? (String(c.text || '').trim() ? [{ k: 'say', text: String(c.text) }] : [])
      : c.type === 'tool_use' ? [{ k: 'tool', name: String(c.name || ''), input: c.input && typeof c.input === 'object' ? c.input : {} }] : [])
  }
  if (j.type === 'user') {
    const flat = (x) => (typeof x === 'string' ? x : Array.isArray(x) ? x.map((y) => (y && y.type === 'text' ? y.text : '')).join('\n') : '')
    return content.flatMap((c) => c.type === 'tool_result' ? [{ k: 'toolres', text: flat(c.content), err: !!c.is_error }] : c.type === 'text' && c.text ? [{ k: 'note', text: String(c.text) }] : [])
  }
  if (j.type === 'result') {
    const bad = !!j.is_error || (!!j.subtype && j.subtype !== 'success')
    return [{ k: 'result', ok: !bad, cost: j.total_cost_usd || 0, ms: j.duration_ms || 0, turns: j.num_turns || 0, ...(bad ? { why: String(j.subtype && j.subtype !== 'success' ? j.subtype : j.result || '').slice(0, 200) } : {}) }]
  }
  return []
}

// claude 세션 하나(바탕 세우기 Z9) — 띄워 둔 `claude -p --input-format stream-json` 에 말을 이어 보낸다(같은 세션에서 고쳐 받기).
//   cwd 는 부르는 쪽이 만든 세션 폴더(재료 사본만) · 도구는 tools(읽기만) · 빈 MCP · 세션 남기지 않음 · 스키마 · 예산 상한 · 환경변수 허용 목록.
//   ask(글) → 그 턴의 답 { value } | { error, message }(parse 와 같은 꼴) · end() 입력을 닫고 끝을 기다린다 · kill(까닭) 끊는다.
//   소식 없음 idleMs(흐름 줄이 하나도 오지 않음) · 전체 maxMs 면 끊는다 · onEvent 는 streamEvents 줄 + me { text }(보낸 말)
//   thinking — 생각 상한(토큰 · MAX_THINKING_TOKENS) · 0 이면 claude 기본(구조안 한 덩이 생각이 9분을 넘던 일)
export function claudeSession({ cwd, schema, tools = ['Read', 'Glob', 'Grep'], budget = 5, model = '', effort = '', thinking = 0, onEvent = null, idleMs = 300_000, maxMs = 2_400_000 }) {
  const env = Object.fromEntries(ENV_ALLOW.filter((k) => process.env[k] != null).map((k) => [k, process.env[k]]))
  if (Number(thinking) > 0) env.MAX_THINKING_TOKENS = String(Math.round(Number(thinking)))
  const tl = tools.join(',')
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', tl, '--allowedTools', tl, '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: {} }), '--no-session-persistence', '--max-budget-usd', String(budget), '--json-schema', JSON.stringify(schema), ...modelArgs(model)]
  if (/^(low|medium|high|max)$/.test(effort)) args.push('--effort', effort)
  if (process.env.ANTHROPIC_API_KEY) args.push('--bare')
  const fake = process.env.KMD_CLAUDE
  const win = process.platform === 'win32'
  const [cmd, argv, opt] = fake ? [process.execPath, [fake, ...args], {}] : [win ? 'claude.cmd' : 'claude', args, win ? { shell: true } : {}]
  const quoted = opt.shell ? argv.map((a) => (a === '' ? '""' : /[\s"{}]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : argv
  const emit = (e) => { if (onEvent) { try { onEvent(e) } catch {} } }
  let p = null
  let wait = null // 지금 턴의 { ok }
  let ended = null // 끝난 까닭(끊음 · 닫힘)
  let se = ''
  let buf = ''
  let idle = null
  let all = null
  let closed = Promise.resolve()
  // 쓴 돈 · 차례(P12) — stream-json 입력 세션의 result 는 그 프로세스의 쌓인 값이다: 마지막 것을 쥔다(부르는 쪽이 측정 줄에)
  let spent = { cost: 0, turns: 0 }
  const t0 = Date.now()
  const finish = (r) => { const w = wait; wait = null; if (w) w.ok(r) }
  const stop = (why) => { if (ended) return; ended = why; try { p.kill() } catch {} }
  const poke = () => { clearTimeout(idle); idle = setTimeout(() => stop(`소식이 ${Math.round(idleMs / 60_000)}분 없다: 끊었다`), idleMs) }
  const line = (l) => {
    if (!l.trim().startsWith('{')) return
    let j
    try { j = JSON.parse(l) } catch { return }
    for (const e of streamEvents(j)) emit(e)
    if (j.type === 'result') {
      spent = { cost: Number(j.total_cost_usd) || spent.cost, turns: Number(j.num_turns) || spent.turns }
      finish(parse({ code: 0, so: l, se: '' }))
    }
  }
  const start = () => {
    p = spawn(cmd, quoted, { cwd, env, windowsHide: true, ...opt })
    all = setTimeout(() => stop(`${Math.round(maxMs / 60_000)}분이 넘었다: 끊었다`), maxMs)
    poke()
    p.stdout.on('data', (c) => {
      poke()
      buf += c
      const ls = buf.split('\n')
      buf = ls.pop()
      for (const l of ls) line(l)
    })
    p.stderr.on('data', (c) => { se += c; if (se.length > 8000) se = se.slice(-8000) })
    p.stdin.on('error', () => {}) // 먼저 닫힌 세션에 쓰기(EPIPE) — 닫힘에서 까닭을 낸다
    closed = new Promise((ok) => {
      p.on('error', (e) => { se += String(e.message); clearTimeout(idle); clearTimeout(all); ended ||= 'error'; finish(parse({ code: -1, so: '', se })); ok() })
      p.on('close', (code) => {
        clearTimeout(idle)
        clearTimeout(all)
        if (buf) line(buf)
        if (wait) finish(ended && ended !== 'end' && ended !== 'error' ? { error: 'fail', message: ended } : parse({ code: code || 1, so: '', se: se || `닫혔다(종료 ${code})` }))
        ended ||= 'closed'
        ok()
      })
    })
  }
  return {
    get ms() { return Date.now() - t0 },
    get cost() { return spent.cost },
    get turns() { return spent.turns },
    get started() { return !!p },
    ask(text) {
      if (ended) return Promise.resolve({ error: 'fail', message: ended })
      if (!p) start()
      emit({ k: 'me', text })
      return new Promise((ok) => {
        wait = { ok }
        p.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n')
      })
    },
    async end() {
      if (!p) return
      ended ||= 'end'
      try { p.stdin.end() } catch {}
      const t = setTimeout(() => { try { p.kill() } catch {} }, 10_000)
      await closed
      clearTimeout(t)
    },
    kill(why = '그만뒀다') {
      if (!p) { ended ||= why; return }
      stop(why)
      finish({ error: 'fail', message: why })
    },
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
    // claude 가 이 PC 에 없다: 자리마다 다시 불러도 같다(일꾼은 멈추고 일감은 기다린다)
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
