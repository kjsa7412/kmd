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
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `call${args.includes('--model') ? ' ' + val('--model') : ''}\n`)
  const ok = args.includes('-p') && args.includes('--tools') && val('--tools') === '' && args.includes('--strict-mcp-config') && JSON.parse(val('--mcp-config') || '{}').mcpServers && val('--json-schema') && fs.readdirSync(process.cwd()).length === 0
  if (!ok) return say({ is_error: true, subtype: 'error', result: '가짜 claude: 도구 0 · 빈 MCP · 스키마 · 빈 폴더를 지키지 않았다' })
  if (process.env.FAKE_CLAUDE_MODE === 'logout') return say({ is_error: true, subtype: 'error', result: 'Invalid API key · Please run /login' })
  // 넣은 파일 — 파일의 머리(##)가 후보 문서의 항목과 같으면 그 항목을 파일 글로 · 아니면 새 문서(경로 = 파일 이름)
  if (prompt.startsWith('넣은 파일(기록)을 지식에 들인다')) {
    const cands = (prompt.split('문서 후보:\n')[1] || '').split('\n\n넣은 파일(')[0]
    const head = /넣은 파일\(기록 [^ ]+ · ([^)]+)\):\n/.exec(prompt)
    const body = prompt.split(/넣은 파일\(기록 [^)]+\):\n/)[1] || ''
    const secs = [...body.matchAll(/^## (.+)\n([\s\S]*?)(?=\n## |(?![\s\S]))/gm)].map((m) => ({ heading: m[1].trim(), content: m[2].trim() }))
    const docs = [...cands.matchAll(/^\[doc ([^\]]+)\]/gm)].map((m) => m[1])
    const updates = []
    for (const s of secs) {
      const d = docs.find((p) => cands.split(`[doc ${p}]`)[1]?.split('\n[doc ')[0].includes(`\n## ${s.heading}\n`))
      if (d) updates.push({ doc: d, heading: s.heading, content: s.content })
    }
    const rest = secs.filter((s) => !updates.some((u) => u.heading === s.heading))
    const name = (head ? head[1] : '넣은 파일').split('/').pop().replace(/\.[^.]+$/, '')
    return say({ structured_output: { updates, newDoc: rest.length ? { path: name, sections: rest } : null, why: updates.length ? '같은 항목이 있다' : '이어지는 문서가 없다' } })
  }
  // 넣은 파일의 기록 정리 — FAKE_CLAUDE_READ=<ms> 일 때만 답한다. FAKE_CLAUDE_SPANS 에 시작(s)을 적고, 함께 도는 부르기가
  //   둘이 되거나 그 ms 가 지나면 「e 함께 돈 수」 를 적고 답한다(띄우는 시간이 느린 PC 에서도 겹침을 그대로 잰다)
  if (prompt.startsWith('너는 지식 관리 도구 kmd 의 기록 작성자다') && process.env.FAKE_CLAUDE_READ) {
    const f = process.env.FAKE_CLAUDE_SPANS
    const live = () => { const ls = f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n') : []; return ls.filter((l) => l === 's').length - ls.filter((l) => l.startsWith('e ')).length }
    if (f) fs.appendFileSync(f, 's\n')
    const until = Date.now() + Number(process.env.FAKE_CLAUDE_READ)
    const tick = () => {
      if (live() < 2 && Date.now() < until) return setTimeout(tick, 50)
      if (f) fs.appendFileSync(f, `e ${live()}\n`)
      const file = (/^파일 이름: (.+)$/m.exec(prompt) || [, '파일'])[1]
      say({ structured_output: { title: file.replace(/\.[^.]+$/, ''), kind: '메모', summary: `${file} 이다.`, points: ['핵심 한 줄'], decisions: [], open: [] } })
    }
    return tick()
  }
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
    const sw = /(\S+) → ([^\s:]+)/.exec(r.body)
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
