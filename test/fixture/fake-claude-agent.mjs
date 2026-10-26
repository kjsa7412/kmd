// 시험용 가짜 Claude Code(에이전트) — KMD_CLAUDE_AGENT 로 주면 core/agent.js 가 node 로 돌린다.
//
// 지키는 것을 본다 — `-p` · stream-json · 내장 도구는 Read,Glob,Grep 만 · dontAsk · strict MCP · 설정 파일 둘.
// MCP 가 있으면(들이기) 일 폴더의 md 를 읽어 kmd MCP 를 진짜 HTTP 로 부른다:
//   brief → save(회의록 › 「2026-10-21 HNC 통화」 + 이름 term:펄스 명령) — 줄마다 stream-json 을 낸다
//   FAKE_AGENT_MODE=other → 다른 지식에 save 를 해 본다(거절돼야 한다) · =idle → 아무것도 넣지 않고 끝낸다
// MCP 가 없으면(바꾸기) 「원본/…」 을 읽은 것처럼 md 글 하나를 답한다.

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const val = (k) => args[args.indexOf(k) + 1]
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const end = (o) => out({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, num_turns: 3, model: 'fake-agent', ...o })

let prompt = ''
process.stdin.on('data', (c) => (prompt += c))
process.stdin.on('end', async () => {
  const ok = args.includes('-p') && val('--output-format') === 'stream-json' && val('--tools') === 'Read,Glob,Grep' && val('--permission-mode') === 'dontAsk' && args.includes('--strict-mcp-config') && fs.existsSync(val('--mcp-config')) && fs.existsSync(val('--append-system-prompt-file'))
  if (!ok) return end({ is_error: true, subtype: 'error', result: '가짜 에이전트: 도구 · 허락 · 설정을 지키지 않았다' })
  const cfg = JSON.parse(fs.readFileSync(val('--mcp-config'), 'utf8')).mcpServers.kmd
  out({ type: 'system', subtype: 'init', model: args.includes('--model') ? `fake-agent(${val('--model')})` : 'fake-agent', mcp_servers: cfg ? [{ name: 'kmd', status: 'connected' }] : [] })
  if (!cfg) {
    const f = fs.readdirSync(path.join(process.cwd(), '원본'))[0]
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: path.join(process.cwd(), '원본', f) } }] } })
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '(쪽 1)' }] } })
    return end({ result: '# 점검 보고\n\n## 결과\n펌프 3대 정상 · 다음 점검 2026-11-02' })
  }
  let n = 0
  const mcp = async (name, a) => {
    const id = `t${++n}`
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: `mcp__kmd__${name}`, input: a }] } })
    const r = await fetch(cfg.url, { method: 'POST', headers: { ...cfg.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: a } }) })
    const j = await r.json().catch(() => ({}))
    const text = j.result?.content?.[0]?.text || JSON.stringify(j.error || { status: r.status })
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: !!j.result?.isError || !r.ok }] } })
    return j.result?.structuredContent || null
  }
  const kn = /knowledge id: ([^)]+)\)/.exec(prompt)[1]
  const md = /바꾼 글: 「([^」]+)」/.exec(prompt)[1]
  const body = fs.readFileSync(path.join(process.cwd(), md), 'utf8')
  out({ type: 'assistant', message: { content: [{ type: 'text', text: '파일을 읽고 지식을 둘러본다.' }] } })
  await mcp('brief', { knowledge: kn })
  // FAKE_AGENT_WAIT_MS — 둘러본 뒤 그만큼 쉰다(일 줄의 그만두기 · 멈춤 · 차례를 본다)
  if (process.env.FAKE_AGENT_WAIT_MS) await new Promise((ok) => setTimeout(ok, Number(process.env.FAKE_AGENT_WAIT_MS)))
  if (process.env.FAKE_AGENT_MODE === 'idle') return end({ result: '넣을 곳을 못 찾았다' })
  if (process.env.FAKE_AGENT_MODE === 'other') await mcp('save', { knowledge: 'dpms', record: { title: '엉뚱한 곳', body: 'x' } })
  await mcp('save', {
    knowledge: kn,
    record: { title: 'HNC 통화 — 회의록에 새 항목', body: '회의록 갈래 · 펄스 명령 이름을 세웠다', touches: ['term:펄스 명령'] },
    // =from → 파일 글은 kmd 가 옮긴다(잇는 말만 쓴다) · =append → 있는 항목 끝에 「원격 명령」 아래만 보탠다
    sections: [process.env.FAKE_AGENT_MODE === 'from' ? { doc: '회의록', heading: '2026-10-21 HNC 통화', content: 'HNC 와 통화했다.', from: '*' } : process.env.FAKE_AGENT_MODE === 'append' ? { doc: '회의록', heading: '2026-10-21 HNC 통화', append: true, from: '원격 명령' } : { doc: '회의록', heading: '2026-10-21 HNC 통화', content: body.replace(/^#{1,2} .*$/gm, '').trim() }],
    names: [{ coord: 'term:펄스 명령', label: '펄스 명령', aliases: ['펄스 방식'], doc: '회의록', heading: '2026-10-21 HNC 통화' }],
  })
  end({ result: '회의록 › 2026-10-21 HNC 통화 · 이름 1' })
})
