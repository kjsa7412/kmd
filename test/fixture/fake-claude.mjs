// 시험용 가짜 `claude -p` — KMD_CLAUDE 로 주면 core/claude.js 가 node 로 돌린다.
//
// 지키는 것을 본다 — `-p` · `--tools ""` · 빈 MCP · `--json-schema` · 빈 폴더. 어기면 is_error.
// 표준 입력의 프롬프트(core/tidy.js promptOf)를 읽어 초안을 낸다:
//   보통   지금 글 + 기록 글을 잇는다(기록의 값이 모두 든다) · used = 모든 기록
//   기록에 「지어낸」 → 근거에 없는 값(999초)을 더한다 · 「누락」 → 그 기록 글을 빼고도 used 에 넣는다
//   「옛값빼기 X」 → 지금 글의 X 를 drop 없이 지운다(고쳐쓰기 기록이면 고쳐 쓸 때 되살린다)
//   「주입」 → 글에 머리 줄을 넣는다 · 「A → B」 꼴(값) → 지금 글의 A 를 B 로 바꾸고 drop 에 A
//   이름 바로잡기 → 후보의 첫 이름
//   고쳐 쓰기(fixPromptOf · 「지난 초안이 kmd 검사에 걸렸다」) → 「고쳐쓰기」 가 든 기록만 고친다(누락 · 지어낸 것을 하지 않는다)
// 들이기(「넣을 것을 지식에 들인다」 · S7) → 기록 + 조각 초안(아래 갈래 · FAKE_CLAUDE_MODE=bad · badall · content · nosec · names · outside)
// FAKE_CLAUDE_MODE=logout → 로그인 끝 · FAKE_CLAUDE_LOG=<파일> → 부를 때마다 한 줄

import fs from 'node:fs'

const args = process.argv.slice(2)
const val = (k) => args[args.indexOf(k) + 1]
const say = (o) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.001, model: 'fake-claude', ...o }) + '\n')

let prompt = ''
let fixing = false
process.stdin.on('data', (c) => (prompt += c))
// FAKE_CLAUDE_STREAM_MS=<ms> → 답 전에 그 시간 동안 흘려 받기 줄(생각 · 스키마 답 조각)을 50ms 마다 낸다(일꾼의 쓰는 중 소식)
const streamFor = (ms) => new Promise((ok) => {
  const until = Date.now() + ms
  const t = setInterval(() => {
    process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '생각' } } }) + '\n' + JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"content": "' } } }) + '\n')
    if (Date.now() >= until) { clearInterval(t); ok() }
  }, 50)
})
process.stdin.on('end', () => (Number(process.env.FAKE_CLAUDE_STREAM_MS) ? streamFor(Number(process.env.FAKE_CLAUDE_STREAM_MS)).then(answer) : answer()))
function answer() {
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `call${args.includes('--model') ? ' ' + val('--model') : ''}\n`)
  const ok = args.includes('-p') && args.includes('--tools') && val('--tools') === '' && args.includes('--strict-mcp-config') && JSON.parse(val('--mcp-config') || '{}').mcpServers && val('--json-schema') && fs.readdirSync(process.cwd()).length === 0
  if (!ok) return say({ is_error: true, subtype: 'error', result: '가짜 claude: 도구 0 · 빈 MCP · 스키마 · 빈 폴더를 지키지 않았다' })
  if (process.env.FAKE_CLAUDE_MODE === 'logout') return say({ is_error: true, subtype: 'error', result: 'Invalid API key · Please run /login' })
  // 정정(S9 · core/fix.js corrPromptOf) — 항목마다 옛 값이 든 줄을 통째로 find 로 잡고 그 줄의 옛 값을 모두 새 값으로(줄이 같으면 하나만)
  if (prompt.startsWith('정정 기록 하나를 항목에 반영한다')) {
    if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, 'fix-record\n')
    const sw = /^바꿀 값: (.+) → (.+)$/m.exec(prompt)
    const items = (prompt.split('\n\n항목:\n')[1] || '').split(/^(?=\[item )/m).filter((x) => x.startsWith('[item ')).map((blk) => {
      const m = /^\[item (.+?) › (.+)\]\n\(base ([0-9a-f]{16})\)\n([\s\S]*)$/.exec(blk.replace(/\n+$/, ''))
      return m ? { doc: m[1], heading: m[2], base: m[3], body: m[4] } : null
    }).filter(Boolean)
    const updates = []
    if (sw) {
      const [, a, b] = sw
      for (const it of items) {
        const lines = [...new Set(it.body.split('\n').filter((l) => l.includes(a)))]
        if (!lines.length) continue
        updates.push({ doc: it.doc, heading: it.heading, base: it.base, edits: lines.map((l) => ({ find: l, replace: l.split(a).join(b) + (process.env.FAKE_CLAUDE_MODE === 'bad' && !prompt.includes('지난 초안이 kmd 검사에 걸렸다') ? ' 999초' : '') })) })
      }
    }
    return say({ structured_output: { updates, why: updates.length ? '옛 값을 고쳤다' : '고칠 곳이 없다' } })
  }
  // 들이기(S7 · core/ingest.js intakePromptOf) — 기록 + 조각 초안 하나
  //   커밋: 「바뀐 값: A → B」 의 A 가 든 후보 항목을 B 로(꼭 한 번이면 조각 · 아니면 새 글) · 없으면 updates 비움
  //   파일: 파일의 ## 머리가 후보 항목과 같으면 그 항목을 파일 글로(새 글) · 나머지는 새 문서(경로 = 파일 이름)
  //   FAKE_CLAUDE_MODE=bad → 처음 답에 지어낸 값(999초) · badall → 고쳐 써도 · content → 커밋도 조각 대신 새 글 · nosec → 새 문서에 항목 없음 ·
  //   names → 새 항목의 이름(term:<머리>)을 싣는다 · outside → 후보 밖 문서를 고친다
  if (prompt.startsWith('넣을 것을 지식에 들인다')) {
    if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, 'intake\n')
    const FIXI = '\n\n지난 초안이 kmd 검사에 걸렸다'
    const fixingI = prompt.includes(FIXI)
    if (fixingI && process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, 'fix\n')
    const p = fixingI ? prompt.slice(0, prompt.indexOf(FIXI)) : prompt
    const mode = process.env.FAKE_CLAUDE_MODE || ''
    const cands = (p.split('문서 후보:\n')[1] || '').split(/\n\n넣을 것\((?:파일|커밋) · /)[0]
    const docs = cands.split(/^\[doc /m).slice(1).map((blk) => {
      const path = blk.slice(0, blk.indexOf(']'))
      const secs = [...blk.matchAll(/^## (.+)\n\(base ([0-9a-f]{16})\)\n([\s\S]*?)(?=\n## |(?![\s\S]))/gm)].map((m) => ({ h: m[1].trim(), base: m[2], body: m[3] }))
      return { path, secs }
    })
    const srcM = /\n\n넣을 것\((파일|커밋) · ([^)]*)\):\n([\s\S]*)$/.exec(p)
    const kind = srcM ? srcM[1] : '파일'
    const name = srcM ? srcM[2] : '넣을 것'
    const md = srcM ? srcM[3] : ''
    const lie = (mode === 'bad' && !fixingI) || mode === 'badall'
    const out = { record: { title: '', body: '', changes: [] }, updates: [], newDoc: null, names: [], why: '' }
    if (kind === '커밋') {
      const sw = /바뀐 값:? (\S+) → (\S+?)(?::|\s|$)/.exec(md)
      out.record.title = name.split(': ')[0] || name
      out.record.body = '코드가 바뀌었다.'
      if (sw) {
        const [, a, b] = sw
        for (const d of docs) for (const s of d.secs) {
          if (out.updates.length || !s.body.includes(a)) continue
          out.record.changes.push(`${s.h}: ${a} → ${b}`)
          const once = s.body.split(a).length === 2
          if (once && mode !== 'content') out.updates.push({ doc: d.path, heading: s.h, base: s.base, edits: [{ find: a, replace: b + (lie ? ' 그리고 999초 기다린다' : '') }] })
          else out.updates.push({ doc: d.path, heading: s.h, base: s.base, content: s.body.split(a).join(b) + (lie ? ' 그리고 999초 기다린다.' : '') })
        }
      }
      if (!out.updates.length) out.why = '문서와 상관없는 커밋'
      return say({ structured_output: out })
    }
    const file = name.split('/').pop().replace(/\.[^.]+$/, '')
    const secs = [...md.matchAll(/^## (.+)\n([\s\S]*?)(?=\n## |(?![\s\S]))/gm)].map((m) => ({ heading: m[1].trim(), content: m[2].trim() }))
    out.record.title = `${file}: 들임`
    out.record.body = `${file} 을 들였다.`
    for (const s of secs) {
      const d = docs.find((x) => x.secs.some((y) => y.h === s.heading))
      if (!d) continue
      const at = d.secs.find((y) => y.h === s.heading)
      out.updates.push({ doc: d.path, heading: s.heading, base: at.base, content: s.content })
    }
    const rest = secs.filter((s) => !out.updates.some((u) => u.heading === s.heading))
    if (mode === 'outside') out.updates.push({ doc: '없는/후보밖', heading: '무엇', content: rest[0]?.content || '글' })
    if (mode === 'nosec') out.newDoc = { path: file, sections: [] }
    else if (rest.length) out.newDoc = { path: file, sections: rest.map((s) => ({ heading: s.heading, content: s.content })) }
    if (lie) {
      const t = out.newDoc?.sections?.[0] || out.updates[0]
      if (t) t.content += ' 그리고 999초 기다린다.'
    }
    if (mode === 'names') out.names = rest.map((s) => ({ name: s.heading, kind: 'term' }))
    out.why = out.updates.length ? '같은 항목이 있다' : '이어지는 문서가 없다'
    return say({ structured_output: out })
  }
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
    // 갈래(프롬프트의 「이 지식의 갈래」 줄) — 파일 이름이 갈래 이름 · 다른 이름을 품으면 그 갈래 문서의 항목 하나(「YYYY-MM-DD 무엇」)로
    const forms = [...((/- 이 지식의 갈래\(갈래 장부\): (.+)/.exec(prompt) || [])[1] || '').matchAll(/([^\s·(]+)\((사건|대상|서술|대장)(?: · ([^)]*))?\)/g)].map((m) => ({ path: m[1], kind: m[2], keys: [m[1].split('/').pop(), ...String(m[3] || '').split(',').map((x) => x.trim())].filter(Boolean) }))
    const form = rest.length && forms.find((f) => f.kind === '사건' && f.keys.some((k) => k.length >= 2 && name.includes(k)))
    if (form) {
      const when = new Date().toISOString().slice(0, 10)
      const content = rest.map((s) => `**${s.heading}**\n${s.content}`).join('\n\n')
      return say({ structured_output: { updates, newDoc: { path: form.path, sections: [{ heading: `${when} ${name.replace(form.keys[0], '').replace(/^[-_ ]+/, '') || name}`, content }] }, why: '갈래 문서가 없다' } })
    }
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
    // 후보 줄은 「- 이름: 보이는 이름」(이름에 빈칸이 들 수 있다 · 첫 「: 」 앞까지가 이름)
    const first = /^- (.+?): .+$/m.exec(prompt.split('후보:')[1] || '')
    return say({ structured_output: { touches: first ? [first[1].trim()] : [], why: '제목이 그 항목을 말한다' } })
  }
  // 조각 꼴(PATCH_RULE 이 끝에 붙는다) — 같은 초안을 지금 글 전체를 찾아 바꾸는 조각 하나로(빈 글이면 rewrite) · 기록에 「조각어긋남」 이면 지금 글에 없는 find
  const patch = prompt.includes('\n\n답 꼴(조각)')
  if (patch) prompt = prompt.slice(0, prompt.indexOf('\n\n답 꼴(조각)'))
  const FIX = '\n\n지난 초안이 kmd 검사에 걸렸다'
  if (prompt.includes(FIX)) {
    if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, 'fix\n')
    fixing = true
    prompt = prompt.slice(0, prompt.indexOf(FIX))
  }
  const recPart = prompt.split('기록(오래된 것부터):\n')[1] || ''
  const all = [...recPart.matchAll(/^\[([^\]]+)\] [^\n]*\n([\s\S]*?)(?=\n\n\[|$)/gm)].map((m) => ({ id: m[1], body: m[2].trim() }))
  // 한 문서의 항목 묶음(batchPromptOf) — 항목마다 같은 초안 · 기록에 「묶음빠짐」 이 있으면 그 항목은 답에서 뺀다(일꾼이 따로 다시)
  if (prompt.includes('[key ')) {
    if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, 'batch\n')
    const blocks = prompt.split('\n\n기록(오래된 것부터):')[0].split('[key ').slice(1)
    const items = blocks.map((x) => {
      const ids = (/^그 항목의 기록: (.+)$/m.exec(x) || [, ''])[1].split(', ').map((x) => x.replace(/\(.*$/, ''))
      const cur = (x.split('지금 글:\n')[1] || '').split('\n\n---\n\n')[0].trim()
      return { key: x.slice(0, x.indexOf(']')), recs: all.filter((r) => ids.includes(r.id)), cur }
    })
    // 조각 묶음(A9) — 항목마다 지금 글 전체를 찾아 바꾸는 조각 하나(빈 글이면 rewrite)
    const asPatch = (cur, d) => { const { content, ...rest } = d; const now = cur === '(아직 없음)' ? '' : cur; return now.trim() ? { ...rest, edits: [{ find: now, replace: content }] } : { ...rest, edits: [], rewrite: content } }
    if (patch && process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, 'bpatch\n')
    return say({ structured_output: { items: items.filter((x) => !x.recs.some((r) => r.body.includes('묶음빠짐'))).map((x) => ({ key: x.key, ...(patch ? asPatch(x.cur, draft(x.cur, x.recs)) : draft(x.cur, x.recs)) })) } })
  }
  const cur = (prompt.split('지금 글:\n')[1] || '').split('\n\n기록(오래된 것부터):')[0]
  const d = draft(cur, all)
  if (!patch) return say({ structured_output: d })
  const { content, ...rest } = d
  const now = cur === '(아직 없음)' ? '' : cur
  if (!now.trim()) return say({ structured_output: { ...rest, edits: [], rewrite: content } })
  const off = all.some((r) => r.body.includes('조각어긋남')) && !fixing
  say({ structured_output: { ...rest, edits: [{ find: off ? '지금 글에 없는 줄' : now, replace: content }] } })
}

function draft(cur, recs) {
  let content = cur === '(아직 없음)' ? '' : cur
  const drop = []
  for (const r of recs) {
    const sw = /(\S+) → ([^\s:]+)/.exec(r.body)
    if (sw && content.includes(sw[1])) {
      content = content.split(sw[1]).join(sw[2])
      drop.push(sw[1])
      continue
    }
    const fixed = fixing && r.body.includes('고쳐쓰기')
    // 「옛값빼기 X」 → 지금 글의 X 를 drop 에 적지 않고 지운다(옛 글 사실을 잃음 · 고쳐 쓰면 되살린다)
    const lose = /옛값빼기 (\S+)/.exec(r.body)
    if (lose && !fixed) content = content.split(lose[1]).join('')
    if (r.body.includes('누락') && !fixed) continue
    content += (content ? '\n' : '') + r.body
    if (r.body.includes('지어낸') && !fixed) content += ' 그리고 999초 기다린다.'
    if (r.body.includes('주입')) content += '\n## 새 머리\n엉뚱한 항목'
  }
  return { content, used: recs.map((r) => r.id), left: [], drop }
}
