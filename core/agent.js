// 에이전트 — Claude Code 를 세션처럼 띄워 지식을 세운다(요구 v0.2 R8).
//
// `claude -p --output-format stream-json` 한 번:
//   도구      내장은 Read · Glob · Grep 만(일 폴더 안 원본 · 바꾼 글을 읽는다) · MCP 는 kmd 하나(그 지식 · 그 일감의 단기 열쇠)
//   허락      --permission-mode dontAsk + --allowedTools mcp__kmd — 읽기는 일 폴더 안만(기본) · 그 밖은 묻지 않고 거절(쓰기 · 셸 · 웹 없음)
//   연결      init 에 kmd 가 connected 가 아니면 끊고 다시 띄운다(세 번까지 — 도구 없이 헤매지 않게)
//   일 순서   --append-system-prompt-file 에 스킬(agent/skills/kmd-build) · 일 설명은 표준 입력
//   줄        stream-json 한 줄마다 터미널 줄(말 · 도구 · 결과 · 비용)로 바꿔 onLine 에 준다
// 환경변수는 허용 목록만(claude.js 와 같다). 시험은 KMD_CLAUDE_AGENT 에 가짜(node 스크립트)를 준다 —
// KMD_CLAUDE(한 번 부르기 가짜)만 있으면 에이전트는 없는 것으로 본다(옛 길로).

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ENV_ALLOW } from './claude.js'
import { modelArgs } from './models.js'

export function agentAvailable() {
  return !!process.env.KMD_CLAUDE_AGENT || !process.env.KMD_CLAUDE
}

// 도구 부름 한 줄 — 무엇을 어디에
const short = (s, n = 90) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
export function toolLine(name, input = {}) {
  const n = String(name).replace(/^mcp__kmd__/, '')
  if (n === 'Read') return `읽기 ${path.basename(String(input.file_path || ''))}${input.offset ? ` (${input.offset}줄부터)` : ''}`
  if (n === 'Glob' || n === 'Grep') return `${n === 'Glob' ? '파일 찾기' : '글 찾기'} ${short(input.pattern, 60)}`
  if (n === 'brief') return `지식 둘러보기${input.knowledge ? ' ' + input.knowledge : ''}`
  if (n === 'match') return `이름 맞추기 「${short(input.q, 50)}」`
  if (n === 'search') return `찾기 「${short(input.q || (input.words || []).join(' '), 50)}」`
  if (n === 'section') return `항목 읽기 ${input.coord || [input.doc, input.heading].filter(Boolean).join(' › ')}`
  if (n === 'save') {
    const secs = (input.sections || []).map((s) => s.coord || `${s.doc} › ${s.heading}`)
    return `저장 「${short(input.record?.title, 60)}」${secs.length ? ` · 항목 ${secs.length}(${short(secs.join(', '), 70)})` : ''}${input.names?.length ? ` · 이름 ${input.names.length}` : ''}`
  }
  return `${n} ${short(JSON.stringify(input), 60)}`
}
function resultLine(c) {
  const text = Array.isArray(c.content) ? c.content.map((x) => x.text || '').join(' ') : String(c.content ?? '')
  let t = text
  try {
    const j = JSON.parse(text)
    t = j.note || j.saved ? `${j.note || '저장했다'}${j.saved ? ' · ' + j.saved : ''}` : j.docs ? `문서 ${j.docs.length}` : j.found ? `맞는 이름 ${j.found.length}` : j.content != null ? `항목 글 ${String(j.content).length}자` : j.message || text
  } catch {}
  return short(t, 140)
}

// 한 번 돌기 — { ok, text(마지막 답), cost, turns, error: login|limit|fail|null, message }
//   mcp: { url, token } 이 없으면 MCP 없이(바꾸기만) · files: 일 폴더에 둘 파일 [{ name, data }]
//   signal — 그만두기(일 줄). 끊기면 Claude Code 를 나무째 끄고 { ok: false, error: 'cancel' }
export async function runAgent({ prompt, system = '', files = [], mcp = null, budget = 2, timeoutMs = 20 * 60_000, model = '', onLine = () => {}, signal = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-agent-'))
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-agent-cfg-')) // 단기 열쇠 · 스킬 — 일 폴더 밖(에이전트가 읽는 자리가 아니다)
  const t0 = Date.now()
  const line = (k, x) => onLine({ t: Date.now() - t0, k, x })
  try {
    for (const f of files) {
      const p = path.join(dir, f.name)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, f.data)
    }
    const sysFile = path.join(cfgDir, 'system.md')
    fs.writeFileSync(sysFile, system || '')
    const cfgFile = path.join(cfgDir, 'mcp.json')
    fs.writeFileSync(cfgFile, JSON.stringify({ mcpServers: mcp ? { kmd: { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } } } : {} }))
    const tools = ['Read', 'Glob', 'Grep']
    // 읽기 도구는 미리 허락하지 않는다 — 일 폴더(cwd) 안 읽기는 기본으로 되고, 밖(사용자 폴더의 설정 · 열쇠 파일)은 dontAsk 가 거절한다.
    //   (Read · Glob · Grep 을 통째로 허락했더니 kmd 연결이 없던 에이전트가 ~/.claude.json · .mcp.json 을 읽으며 헤맸다)
    //   -p 에서는 읽기가 어디서나 되므로 사용자 집 폴더의 숨은 파일 · 폴더(.claude · .claude.json · .ssh · .kmd-app …)와 AppData\Roaming 은 막는다
    const deny = ['Read(~/.*)', 'Read(~/.*/**)', 'Read(~/AppData/Roaming/**)', 'Read(~/AppData/Local/Packages/**)']
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--tools', tools.join(','), ...(mcp ? ['--allowedTools', 'mcp__kmd'] : []), '--disallowedTools', deny.join(','), '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', cfgFile, '--no-session-persistence', '--max-budget-usd', String(budget), '--append-system-prompt-file', sysFile, ...modelArgs(model)]
    const env = Object.fromEntries(ENV_ALLOW.filter((k) => process.env[k] != null).map((k) => [k, process.env[k]]))
    // kmd 연결을 기다리는 시간 — 정리가 도는 동안 kmd 가 늦게 답하면 기본 대기로는 「pending」 인 채 시작했다
    env.MCP_TIMEOUT ||= process.env.MCP_TIMEOUT || '60000'
    const fake = process.env.KMD_CLAUDE_AGENT
    const win = process.platform === 'win32'
    const [cmd, argv, opt] = fake ? [process.execPath, [fake, ...args], {}] : [win ? 'claude.cmd' : 'claude', args, win ? { shell: true } : {}]
    const quoted = opt.shell ? argv.map((a) => (a === '' ? '""' : /[\s"{}&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : argv
    line('sys', `Claude Code 를 띄운다 — 도구 ${tools.join(' · ')}${mcp ? ' · kmd' : ''}${model ? ` · 모델 ${model}` : ''} · 예산 $${budget}`)
    // kmd 연결이 아직 서지 않은 채 시작하면(init 에 kmd 가 connected 가 아니다) 도구 없이 헤매므로 곧바로 끊고 다시 띄운다(세 번까지)
    for (let attempt = 1; ; attempt++) {
      if (signal?.aborted) return { ok: false, error: 'cancel', message: '그만뒀다' }
      const r = await once()
      if (!r.mcpDown || signal?.aborted) return r.mcpDown ? { ok: false, error: 'cancel', message: '그만뒀다' } : r
      if (attempt >= 3) { line('err', 'kmd 연결이 서지 않았다 — 세 번 띄워도 · 다음 정리 때 다시'); return { ok: false, error: 'fail', message: 'kmd MCP 가 이어지지 않았다' } }
      line('sys', `kmd 연결이 아직 서지 않았다 — 끊고 다시 띄운다(${attempt + 1}번째)`)
      await new Promise((ok) => setTimeout(ok, 3000 * attempt))
    }
    function once() { return new Promise((resolve) => {
      const p = spawn(cmd, quoted, { cwd: dir, env, windowsHide: true, ...opt })
      // 끊기 — Windows 는 cmd 를 거쳐 띄우므로 p.kill() 은 cmd 만 죽고 Claude Code 는 남는다 · 나무째(taskkill /T)
      const stop = () => { if (win && !fake && p.pid) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }).on('error', () => p.kill()); else p.kill() }
      let mcpDown = false
      let buf = ''
      let se = ''
      let last = null
      const kill = setTimeout(() => { line('err', `시간이 넘었다(${Math.round(timeoutMs / 60000)}분) — 멈춘다`); stop() }, timeoutMs)
      const onAbort = () => { line('err', '그만두기 — Claude Code 를 끈다'); stop() }
      signal?.addEventListener('abort', onAbort, { once: true })
      const eat = (raw) => {
        let j
        try { j = JSON.parse(raw) } catch { return }
        if (j.type === 'system' && j.subtype === 'init') {
          line('sys', `시작 — ${j.model || 'Claude'}${j.mcp_servers?.length ? ' · ' + j.mcp_servers.map((s) => `${s.name} ${s.status === 'connected' ? '이어짐' : s.status}`).join(' · ') : ''}`)
          const k = (j.mcp_servers || []).find((s) => s.name === 'kmd')
          if (mcp && k && k.status !== 'connected') { mcpDown = true; stop() }
        }
        if (j.type === 'assistant') for (const c of j.message?.content || []) {
          if (c.type === 'text' && c.text.trim()) line('say', c.text.trim())
          if (c.type === 'tool_use') line('tool', toolLine(c.name, c.input))
        }
        if (j.type === 'user') for (const c of j.message?.content || []) if (c.type === 'tool_result') line(c.is_error ? 'err' : 'ok', resultLine(c))
        if (j.type === 'result') last = j
      }
      p.stdout.on('data', (c) => {
        buf += c
        let i
        while ((i = buf.indexOf('\n')) >= 0) { eat(buf.slice(0, i)); buf = buf.slice(i + 1) }
      })
      p.stderr.on('data', (c) => (se += c))
      p.on('error', (e) => { clearTimeout(kill); resolve({ ok: false, error: 'fail', message: e.message }) })
      p.on('close', (code) => {
        clearTimeout(kill)
        signal?.removeEventListener('abort', onAbort)
        if (signal?.aborted) { resolve({ ok: false, error: 'cancel', message: '그만뒀다', cost: last?.total_cost_usd || 0 }); return }
        if (mcpDown) { resolve({ mcpDown: true }); return }
        if (buf.trim()) eat(buf)
        const text = `${last?.result || ''} ${se}`
        if (!last || last.is_error || code) {
          const error = /login|log in|api key|auth|unauthori|credential|401/i.test(text) ? 'login' : /limit|quota|rate|usage|budget|429/i.test(text) ? 'limit' : 'fail'
          line('err', error === 'login' ? 'Claude 로그인이 없다 — 머리의 「Claude」 에서 로그인' : error === 'limit' ? 'Claude 한도 · 예산에 닿았다' : `Claude 가 끝을 내지 못했다 — ${short(text.trim() || '종료 ' + code, 160)}`)
          resolve({ ok: false, error, message: text.trim().slice(0, 300), cost: last?.total_cost_usd || 0 })
          return
        }
        line('cost', `끝 — ${last.num_turns ?? '?'} 차례 · $${(last.total_cost_usd || 0).toFixed(3)} · ${Math.round((Date.now() - t0) / 1000)}초`)
        resolve({ ok: true, text: String(last.result || ''), cost: last.total_cost_usd || 0, turns: last.num_turns || 0, model: last.model || null })
      })
      p.stdin.end(prompt)
    }) }
  } finally {
    // 일 폴더 치우기 — Windows 는 끝난 Claude Code 가 잠깐 폴더를 잡고 있다(EBUSY). 몇 번 기다려 지우고, 그래도 안 되면 남긴다(일은 실패로 만들지 않는다)
    for (const d of [dir, cfgDir]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
  }
}
