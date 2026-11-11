// 시험용 가짜 `claude -p` — KMD_CLAUDE 로 주면 core/claude.js 가 node 로 돌린다.
//
// 지키는 것을 본다 — `-p` · `--tools ""` · 빈 MCP · `--json-schema` · 빈 폴더. 어기면 is_error.
// 표준 입력의 프롬프트(core/tidy.js promptOf)를 읽어 초안을 낸다:
//   보통   지금 글 + 기록 글을 잇는다(기록의 값이 모두 든다) · used = 모든 기록
//   기록에 「지어낸」 → 근거에 없는 값(999초)을 더한다 · 「누락」 → 그 기록 글을 빼고도 used 에 넣는다
//   「옛값빼기 X」 → 지금 글의 X 를 drop 없이 지운다(고쳐쓰기 기록이면 고쳐 쓸 때 되살린다)
//   「주입」 → 글에 머리 줄을 넣는다 · 「A → B」 꼴(값) → 지금 글의 A 를 B 로 바꾸고 drop 에 A
//   건드린 항목 바로잡기 → 후보의 첫 항목
//   고쳐 쓰기(fixPromptOf · 「지난 초안이 kmd 검사에 걸렸다」) → 「고쳐쓰기」 가 든 기록만 고친다(누락 · 지어낸 것을 하지 않는다)
// 들이기(「넣을 것을 지식에 들인다」 · S7 · 보낸 글 S12) → 기록 + 항목 글 초안(아래 갈래 · FAKE_CLAUDE_MODE=bad · badall · content · nosec · names · outside)
// FAKE_CLAUDE_MODE=logout → 로그인 끝 · FAKE_CLAUDE_LOG=<파일> → 부를 때마다 한 줄

import fs from 'node:fs'

const args = process.argv.slice(2)
const val = (k) => args[args.indexOf(k) + 1]
const say = (o) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.001, model: 'fake-claude', ...o }) + '\n')

// 세션(바탕 세우기 Z9 · core/claude.js claudeSession) — `--input-format stream-json` 으로 줄마다 말을 받고 턴마다 result 하나.
//   지키는 것: 도구는 Read · Glob · Grep 만(--tools · --allowedTools) · 빈 MCP · 스키마 · 세션 폴더는 재료.tsv · md/ · cards/ 만. 어기면 is_error.
//   뼈대(「바탕 세우기 뼈대를 짓는다(세션)」): 넣음 재료를 모두 문서 「업무 안내」 하나로 · 묶음(「…한 묶음을 짓는다(세션)」): 재료마다 항목 하나 ·
//   글(「바탕 세우기 항목 글을 짓는다(세션)」): 목표마다 제 몫 재료 글(md/ · 머리 줄은 걷는다). 흐름 줄(생각 · Grep · 결과 · 쓰는 중 · StructuredOutput)을 낸다.
//   FAKE_CLAUDE_MODE=badseed → 뼈대 첫 턴은 재료 하나를 빠뜨린다(같은 세션에 고쳐 받기) · lie → 글에 지어낸 값 · logout → 로그인 끝 · hang → 답하지 않는다
const SESSION = args.includes('--input-format') && val('--input-format') === 'stream-json'
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
function session() {
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `call${args.includes('--model') ? ' ' + val('--model') : ''}\n`)
  const tools = 'Read,Glob,Grep'
  const files = fs.readdirSync(process.cwd())
  const ok = args.includes('-p') && val('--tools') === tools && val('--allowedTools') === tools && args.includes('--strict-mcp-config') && JSON.parse(val('--mcp-config') || '{}').mcpServers && val('--json-schema') && files.includes('md') && files.every((x) => ['재료.tsv', 'md', 'cards'].includes(x))
  out({ type: 'system', subtype: 'init', model: 'fake-claude', tools: ['Glob', 'Grep', 'Read', 'StructuredOutput'], cwd: process.cwd() })
  let buf = ''
  let turn = 0
  let kind = ''
  process.stdin.on('data', (c) => {
    buf += c
    const ls = buf.split('\n')
    buf = ls.pop()
    for (const l of ls) if (l.trim()) one(JSON.parse(l))
  })
  process.stdin.on('end', () => process.exit(0))
  const tsv = () => fs.readFileSync('재료.tsv', 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('\t')).map(([src, p, pick]) => ({ src, path: p, pick }))
  const headOf = (p) => p.split('/').pop().replace(/\.[^.]+$/, '').replace(/[#%]/g, '')
  function one(m) {
    const text = String(m?.message?.content || '')
    turn++
    if (!ok) return say({ is_error: true, subtype: 'error', result: '가짜 claude 세션: 읽기 도구 셋 · 빈 MCP · 스키마 · 세션 폴더를 지키지 않았다' })
    if (process.env.FAKE_CLAUDE_MODE === 'logout') return say({ is_error: true, subtype: 'error', result: 'Invalid API key · Please run /login' })
    if (process.env.FAKE_CLAUDE_MODE === 'hang') return
    const lim = process.env.FAKE_CLAUDE_LIMIT_FILE
    if (lim && fs.existsSync(lim)) { fs.rmSync(lim); return say({ is_error: true, subtype: 'error', result: 'Claude usage limit reached · resets 3pm' }) }
    const fixing = text.startsWith('지난 초안이 kmd 검사에 걸렸다')
    if (!fixing) kind = text.startsWith('바탕 세우기 뼈대를') ? 'frame' : text.startsWith('바탕 세우기 구조안의 한 묶음') ? 'batch' : text.startsWith('바탕 세우기 항목 글을') ? 'write' : 'other'
    if (!fixing) m.first = text
    if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `seed-${kind}${fixing ? ' fix' : ''}\n`)
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: fixing ? '걸린 곳을 고친다' : '재료를 훑는다' }] } })
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't' + turn, name: 'Grep', input: { pattern: '^#{1,3} ', path: 'md', output_mode: 'content' } }] } })
    const mds = fs.readdirSync('md')
    out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't' + turn, content: mds.map((x) => `${process.cwd()}\\md\\${x}:1:# 머리`).join('\n') }] } })
    out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'StructuredOutput' } } })
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"docs": [' } } })
    let o
    if (kind === 'frame') {
      let src = tsv().filter((r) => r.pick === '넣음').map((r) => r.src)
      if (process.env.FAKE_CLAUDE_MODE === 'badseed' && !fixing) src = src.slice(1)
      o = { docs: [{ id: '업무 안내', src }], skip: [], why: '파일마다 항목 하나' }
    } else if (kind === 'batch') {
      const rows = tsv()
      const docs = [...(session.batch ||= text).matchAll(/^\[doc (.+?)\](?: \(.*?\))? 재료: (.*)$/gm)].map((x) => ({ id: x[1], src: [...x[2].matchAll(/m:[0-9a-f]{16}/g)].map((y) => y[0]) }))
      const out2 = docs.map((d) => ({ id: d.id, items: d.src.filter((s) => rows.find((r) => r.src === s)?.pick === '넣음').map((s) => ({ h: headOf(rows.find((r) => r.src === s).path), src: [s], note: '파일 하나가 대상 하나' })) }))
      const first = out2.find((d) => d.items.length)?.items[0]
      o = { docs: out2, names: first ? [{ coord: 'topic:' + first.h.replace(/\s+/g, ''), label: first.h, doc: out2.find((d) => d.items.length).id, h: first.h }] : [], skip: [], why: '재료마다 항목' }
    } else if (kind === 'write') {
      const src = session.write ||= text
      const fileOf = new Map([...src.matchAll(/^- md\/(\S+) · (.+?)(?: · [\d,]+ 자)?$/gm)].map((x) => [x[2], x[1]]))
      const body = (p) => { const f = fileOf.get(p); return f ? fs.readFileSync(`md/${f}`, 'utf8').split('\n').filter((l) => !/^#{1,6}\s/.test(l)).join('\n').trim() : '' }
      const items = [...src.matchAll(/^\[target (.+?) › (.+?)\](?: 몫: 재료 (.*))?$/gm)].map((x) => ({ doc: x[1], h: x[2], text: ((x[3] || '').split(' · ').map(body).filter(Boolean).join('\n\n') || '글') + (process.env.FAKE_CLAUDE_MODE === 'lie' ? '\n그리고 999초 기다린다.' : '') }))
      o = { items, why: '재료 글로 지었다' }
    } else return say({ is_error: true, subtype: 'error', result: '가짜 claude 세션: 모르는 말' })
    const wait = Number(process.env.FAKE_CLAUDE_STREAM_MS) || 0
    setTimeout(() => {
      out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 's' + turn, name: 'StructuredOutput', input: o }] } })
      out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 's' + turn, content: 'Structured output provided successfully' }] } })
      say({ structured_output: o, num_turns: 3, duration_ms: 1200 })
    }, wait)
  }
}

let prompt = ''
let fixing = false
if (SESSION) session()
else process.stdin.on('data', (c) => (prompt += c))
// FAKE_CLAUDE_STREAM_MS=<ms> → 답 전에 그 시간 동안 흘려 받기 줄(생각 · 스키마 답 조각)을 50ms 마다 낸다(일꾼의 쓰는 중 소식)
const streamFor = (ms) => new Promise((ok) => {
  const until = Date.now() + ms
  const t = setInterval(() => {
    process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '생각' } } }) + '\n' + JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"content": "' } } }) + '\n')
    if (Date.now() >= until) { clearInterval(t); ok() }
  }, 50)
})
if (!SESSION) process.stdin.on('end', () => (Number(process.env.FAKE_CLAUDE_STREAM_MS) ? streamFor(Number(process.env.FAKE_CLAUDE_STREAM_MS)).then(answer) : answer()))
function answer() {
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `call${args.includes('--model') ? ' ' + val('--model') : ''}\n`)
  const ok = args.includes('-p') && args.includes('--tools') && val('--tools') === '' && args.includes('--strict-mcp-config') && JSON.parse(val('--mcp-config') || '{}').mcpServers && val('--json-schema') && fs.readdirSync(process.cwd()).length === 0
  if (!ok) return say({ is_error: true, subtype: 'error', result: '가짜 claude: 도구 0 · 빈 MCP · 스키마 · 빈 폴더를 지키지 않았다' })
  if (process.env.FAKE_CLAUDE_MODE === 'logout') return say({ is_error: true, subtype: 'error', result: 'Invalid API key · Please run /login' })
  if (prompt.startsWith('이 물음에는 {"ok": true}')) return say({ structured_output: { ok: true } }) // checkClaude
  // 바탕 세우기 구조안(Z7 · core/shape.js seedPlanPromptOf) — 넣음 재료마다 항목 하나(머리 = 파일 이름) · 문서 「업무 안내」 하나 · 첫 재료에 장부 항목 하나
  //   FAKE_CLAUDE_MODE=badseed → 처음 답은 재료 하나를 빠뜨린다(덮임 걸림 → 고쳐 쓰기)
  if (prompt.startsWith('바탕 세우기 구조안을 짓는다')) {
    const fixing = prompt.includes('\n\n지난 초안이 kmd 검사에 걸렸다')
    if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, fixing ? 'seed-plan fix\n' : 'seed-plan\n')
    const p = prompt.split('\n\n지난 초안이')[0]
    const mats = [...p.matchAll(/^\[material (m:[0-9a-f]{16})\] (.+?) · (넣음|근거만)/gm)].map((m) => ({ src: m[1], path: m[2], pick: m[3] }))
    let items = mats.filter((m) => m.pick === '넣음').map((m) => ({ h: m.path.split('/').pop().replace(/\.[^.]+$/, '').replace(/[#%]/g, ''), src: [m.src], note: '파일 하나가 대상 하나' }))
    if (process.env.FAKE_CLAUDE_MODE === 'badseed' && !fixing) items = items.slice(1)
    const out = { docs: [{ id: '업무 안내', items }], names: items.length ? [{ coord: 'topic:' + items[0].h.replace(/\s+/g, ''), label: items[0].h, doc: '업무 안내', h: items[0].h }] : [], skip: [], why: '파일마다 항목 하나' }
    return say({ structured_output: out })
  }
  // Claude 짜임 구조안(Z6 · core/shape.js shapePlanPromptOf) — 지금 짜임 그대로 + 문서마다 끝 낱말이 같은 항목 둘 이상을 「<낱말> 목록」 하나로 합친다
  //   FAKE_CLAUDE_MODE=badplan → 처음 답은 항목 하나를 빠뜨린다(덮임 걸림 → 고쳐 쓰기) · badplanall → 고쳐 써도
  if (prompt.startsWith('문서 짜임 구조안을 짓는다')) {
    const fixing = prompt.includes('\n\n지난 초안이 kmd 검사에 걸렸다')
    if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, fixing ? 'shape-plan fix\n' : 'shape-plan\n')
    const p = prompt.split('\n\n지난 초안이')[0]
    const body = p.slice(p.indexOf('지금 짜임(지문'))
    const docs = body.split(/^\[doc /m).slice(1).map((blk) => ({ id: blk.slice(0, blk.indexOf(']')), heads: [...blk.matchAll(/^- ## (.+?) \(\d+줄/gm)].map((m) => m[1]) }))
    const out = { docs: [], names: [], empty: [], why: '끝 낱말이 같은 항목을 합쳤다' }
    for (const d of docs) {
      const by = new Map()
      for (const h of d.heads) { const w = h.split(' ').pop(); if (h.includes(' ')) by.set(w, [...(by.get(w) || []), h]) }
      const items = []
      const done = new Set()
      for (const h of d.heads) {
        if (done.has(h)) continue
        const g = by.get(h.split(' ').pop())
        if (h.includes(' ') && g && g.length > 1) { g.forEach((x) => done.add(x)); items.push({ h: `${h.split(' ').pop()} 목록`, from: g.map((x) => ({ doc: d.id, h: x })), note: '같은 대상' }) }
        else items.push({ h, from: [{ doc: d.id, h }] })
      }
      out.docs.push({ id: d.id, was: d.id, items })
    }
    const mode = process.env.FAKE_CLAUDE_MODE || ''
    if ((mode === 'badplan' && !fixing) || mode === 'badplanall') { const d = out.docs.find((x) => x.items.length); if (d) d.items.pop() }
    return say({ structured_output: out })
  }
  // Claude 짜임 글(Z6 · core/shape.js shapeWritePromptOf) — 합치기는 출처 글을 잇는다 · 나누기는 출처 줄을 목표 수로 고루 나눈다
  //   FAKE_CLAUDE_MODE=badwrite → 처음 답에 머리 줄(꼴 걸림 → 고쳐 쓰기) · badwriteall → 고쳐 써도(걸음 실패) · lie → 지어낸 값(999초 · 재기만)
  if (prompt.startsWith('문서 짜임의 항목 글을 짓는다')) {
    const fixing = prompt.includes('\n\n지난 초안이 kmd 검사에 걸렸다')
    if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, fixing ? 'shape-write fix\n' : 'shape-write\n')
    const p = prompt.split('\n\n지난 초안이')[0]
    const targets = [...p.matchAll(/^\[target (.+?) › (.+?)\](?: 몫: .*)?$/gm)].map((m) => ({ doc: m[1], h: m[2] }))
    const srcs = p.split('\n출처:\n')[1] || ''
    const bodies = srcs.split(/^\[source .+\]$/m).map((x) => x.trim()).filter(Boolean)
    const lines = bodies.join('\n').split('\n').filter((l) => l.trim())
    const mode = process.env.FAKE_CLAUDE_MODE || ''
    // 바탕 세우기(Z7) — 목표마다 제 몫의 재료 글(머리 줄은 걷는다)
    if (p.includes('- 바탕 세우기: 출처는')) {
      const mat = new Map([...srcs.matchAll(/^\[source 재료 › (.+)\]\n([\s\S]*?)(?=^\[source |(?![\s\S]))/gm)].map((m) => [m[1], m[2].split('\n').filter((l) => !/^#{1,6}\s/.test(l)).join('\n').trim()]))
      const part = new Map([...p.matchAll(/^\[target (.+?) › (.+?)\] 몫: 재료 (.*)$/gm)].map((m) => [m[2], m[3].split(' · ')]))
      const items = targets.map((t) => ({ doc: t.doc, h: t.h, text: ((part.get(t.h) || []).map((x) => mat.get(x)).filter(Boolean).join('\n\n') || '글') + (mode === 'lie' ? '\n그리고 999초 기다린다.' : '') }))
      return say({ structured_output: { items, why: '재료 글로 지었다' } })
    }
    const items = targets.map((t, i) => {
      let text = targets.length === 1 ? bodies.join('\n\n') : lines.filter((_, j) => Math.floor((j * targets.length) / lines.length) === i).join('\n') || lines[0] || '글'
      if ((mode === 'badwrite' && !fixing) || mode === 'badwriteall') text = `## 주입\n${text}`
      if (mode === 'lie' && i === 0) text += '\n그리고 999초 기다린다.'
      return { doc: t.doc, h: t.h, text }
    })
    return say({ structured_output: { items, why: '출처 글로 지었다' } })
  }
  // 문서 다듬기(S13 · core/ingest.js polishPromptOf) — 항목마다 끝에 「(다듬음)」 한 줄 · 첫 항목만 값을 바꾼다(서버가 그 항목을 빼는지 본다)
  if (prompt.startsWith('문서 「') && prompt.includes('의 항목 글을 다듬는다')) {
    if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, 'polish\n')
    const part = prompt.split('항목(base 는 그대로 돌려준다):\n')[1] || ''
    const secs = [...part.matchAll(/^## (.+)\n\(base ([0-9a-f]{16})\)\n([\s\S]*?)(?=\n\n## |(?![\s\S]))/gm)].map((m) => ({ h: m[1].trim(), base: m[2], body: m[3] }))
    return say({ structured_output: { updates: secs.map((s, i) => ({ heading: s.h, base: s.base, content: `${s.body.trim()}${i === 0 ? ' 999초' : ''}\n\n(다듬음)` })), why: '문장을 짧게' } })
  }
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
  // 들이기(S7 · core/ingest.js intakePromptOf) — 기록 + 항목 글 초안 하나
  //   커밋: 「바뀐 값: A → B」 의 A 가 든 후보 항목을 B 로(꼭 한 번이면 바꿀 곳 · 아니면 새 글) · 없으면 updates 비움
  //   파일: 파일의 ## 머리가 후보 항목과 같으면 그 항목을 파일 글로(새 글) · 나머지는 새 문서(경로 = 파일 이름)
  //   FAKE_CLAUDE_MODE=bad → 처음 답에 지어낸 값(999초) · badall → 고쳐 써도 · content → 커밋도 바꿀 곳 대신 새 글 · nosec → 새 문서에 항목 없음 ·
  //   names → 새 항목을 장부에 올린다(term:<머리>) · outside → 후보 밖 문서를 고친다
  if (prompt.startsWith('넣을 것을 지식에 들인다')) {
    if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, 'intake\n')
    const FIXI = '\n\n지난 초안이 kmd 검사에 걸렸다'
    const fixingI = prompt.includes(FIXI)
    if (fixingI && process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, 'fix\n')
    const p = fixingI ? prompt.slice(0, prompt.indexOf(FIXI)) : prompt
    const mode = process.env.FAKE_CLAUDE_MODE || ''
    const cands = (p.split('문서 후보:\n')[1] || '').split(/\n\n넣을 것\((?:파일|커밋|기록|보낸 글) · /)[0]
    const docs = cands.split(/^\[doc /m).slice(1).map((blk) => {
      const path = blk.slice(0, blk.indexOf(']'))
      const secs = [...blk.matchAll(/^## (.+)\n\(base ([0-9a-f]{16})\)\n([\s\S]*?)(?=\n## |(?![\s\S]))/gm)].map((m) => ({ h: m[1].trim(), base: m[2], body: m[3] }))
      return { path, secs }
    })
    // 기록(다시 들이기 · S10) — 파일과 같이 다룬다(## 머리가 후보 항목과 같으면 그 항목 · 나머지는 새 문서)
    const srcM = /\n\n넣을 것\((파일|커밋|기록|보낸 글) · ([^)]*)\):\n([\s\S]*)$/.exec(p)
    const kind = srcM && srcM[1] === '커밋' ? '커밋' : '파일'
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
    // 보낸 글(S12) — 제목 「문서: 문서 전체」 의 앞 조각이 문서 이름
    const file = srcM && srcM[1] === '보낸 글' ? name.split(': ')[0] : name.split('/').pop().replace(/\.[^.]+$/, '')
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
    // 갈래(프롬프트의 「이 지식의 갈래」 줄) — 파일 이름이 갈래 이름 · 별칭을 품으면 그 갈래 문서의 항목 하나(「YYYY-MM-DD 무엇」)로
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
    // 후보 줄은 「- 종류:값: 라벨」(값에 빈칸이 들 수 있다 · 첫 「: 」 앞까지가 항목)
    const first = /^- (.+?): .+$/m.exec(prompt.split('후보:')[1] || '')
    return say({ structured_output: { touches: first ? [first[1].trim()] : [], why: '제목이 그 항목을 말한다' } })
  }
  // 바꿀 곳 꼴(옛 PATCH_RULE 「답 꼴(조각)」 이 끝에 붙을 때) — 같은 초안을 지금 글 전체를 찾아 바꾸는 바꿀 곳 하나로(빈 글이면 rewrite) · 기록에 「조각어긋남」 이면 지금 글에 없는 find
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
    // 바꿀 곳 묶음(A9) — 항목마다 지금 글 전체를 찾아 바꾸는 바꿀 곳 하나(빈 글이면 rewrite)
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
