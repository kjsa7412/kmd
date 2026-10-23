// 시험용 가짜 `claude -p` — KMD_CLAUDE 로 주면 core/claude.js 가 node 로 돌린다.
//
// 지키는 것을 본다 — `-p` · `--tools ""` · 빈 MCP · `--json-schema` · 빈 폴더. 어기면 is_error.
// 표준 입력의 프롬프트(core/tidy.js promptOf)를 읽어 초안을 낸다:
//   보통   지금 글 + 기록 글을 잇는다(기록의 값이 모두 든다) · used = 모든 기록
//   기록에 「지어낸」 → 근거에 없는 값(999초)을 더한다 · 「누락」 → 그 기록 글을 빼고도 used 에 넣는다
//   「주입」 → 글에 머리 줄을 넣는다 · 「A → B」 꼴(값) → 지금 글의 A 를 B 로 바꾸고 drop 에 A
//   이름 바로잡기 → 후보의 첫 이름
// FAKE_CLAUDE_MODE=logout → 로그인 끝 · FAKE_CLAUDE_LOG=<파일> → 부를 때마다 한 줄

import fs from 'node:fs'

const args = process.argv.slice(2)
const val = (k) => args[args.indexOf(k) + 1]
const say = (o) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.001, model: 'fake-claude', ...o }) + '\n')

let prompt = ''
process.stdin.on('data', (c) => (prompt += c))
process.stdin.on('end', () => {
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, 'call\n')
  const ok = args.includes('-p') && args.includes('--tools') && val('--tools') === '' && args.includes('--strict-mcp-config') && JSON.parse(val('--mcp-config') || '{}').mcpServers && val('--json-schema') && fs.readdirSync(process.cwd()).length === 0
  if (!ok) return say({ is_error: true, subtype: 'error', result: '가짜 claude: 도구 0 · 빈 MCP · 스키마 · 빈 폴더를 지키지 않았다' })
  if (process.env.FAKE_CLAUDE_MODE === 'logout') return say({ is_error: true, subtype: 'error', result: 'Invalid API key · Please run /login' })
  if (prompt.startsWith('아래 기록이 바꾼 항목을')) {
    const first = /^- (\S+:[^ ]+(?: [^—]+)?) — /m.exec(prompt.split('후보:')[1] || '')
    return say({ structured_output: { touches: first ? [first[1].trim()] : [], why: '제목이 그 항목을 말한다' } })
  }
  const cur = (prompt.split('지금 글:\n')[1] || '').split('\n\n기록(오래된 것부터):')[0]
  const recPart = prompt.split('기록(오래된 것부터):\n')[1] || ''
  const recs = [...recPart.matchAll(/^\[([^\]]+)\] [^\n]*\n([\s\S]*?)(?=\n\n\[|$)/gm)].map((m) => ({ id: m[1], body: m[2].trim() }))
  let content = cur === '(아직 없음)' ? '' : cur
  const drop = []
  for (const r of recs) {
    const sw = /(\S+) → (\S+)/.exec(r.body)
    if (sw && content.includes(sw[1])) {
      content = content.split(sw[1]).join(sw[2])
      drop.push(sw[1])
      continue
    }
    if (r.body.includes('누락')) continue
    content += (content ? '\n' : '') + r.body
    if (r.body.includes('지어낸')) content += ' 그리고 999초 기다린다.'
    if (r.body.includes('주입')) content += '\n## 새 머리\n엉뚱한 항목'
  }
  say({ structured_output: { content, used: recs.map((r) => r.id), left: [], drop } })
})
