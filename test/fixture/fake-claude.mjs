// 시험용 가짜 `claude -p` — KMD_CLAUDE 로 주면 core/claude.js 가 node 로 돌린다.
//
// 지키는 것을 본다 — `-p` · 읽기 도구만(`--tools Read,Glob,Grep` · dontAsk) · MCP 설정 파일(비었거나 kmd 하나) · `--json-schema` · 빈 폴더. 어기면 is_error.
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
// 사용자 훅 끄기(--settings 파일의 disableAllHooks · 채널 평가 T13): 없으면 is_error
const noHooks = () => { try { return JSON.parse(fs.readFileSync(val('--settings'), 'utf8')).disableAllHooks === true } catch { return false } }
const say = (o) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.001, model: 'fake-claude', ...o }) + '\n')

// 세션(바탕 세우기 Z9 · core/claude.js claudeSession) — `--input-format stream-json` 으로 줄마다 말을 받고 턴마다 result 하나.
//   지키는 것: 도구는 Read · Glob · Grep 만(--tools · --allowedTools) · 빈 MCP · 스키마 · 세션 폴더는 재료.tsv · md/ · cards/ 만. 어기면 is_error.
//   뼈대(「바탕 세우기 뼈대를 짓는다(세션)」): 넣음 재료를 모두 문서 「업무 안내」 하나로 · 묶음(「…한 묶음을 짓는다(세션)」): 재료마다 항목 하나 ·
//   글(「바탕 세우기 항목 글을 짓는다(세션)」): 목표마다 제 몫 재료 글(md/ · 머리 줄은 걷는다). 흐름 줄(생각 · Grep · 결과 · 쓰는 중 · StructuredOutput)을 낸다.
//   FAKE_CLAUDE_MODE=badseed → 뼈대 첫 턴은 재료 하나를 빠뜨린다(같은 세션에 고쳐 받기) · lie → 글에 지어낸 값 · logout → 로그인 끝 · hang → 답하지 않는다
//   seedsub → 글 첫 턴의 첫 항목에 재료 소제목(### 되돌리기 · 고쳐 받기) · seedsuball → 고쳐 받아도(마지막 차례는 알림만 남기고 받는다 · 채널 평가 4차 shape)
const SUBHEAD = '\n\n### 되돌리기\n\n1. 앞 판으로 돌린다.'
const subOn = (fixing) => (process.env.FAKE_CLAUDE_MODE === 'seedsub' && !fixing) || process.env.FAKE_CLAUDE_MODE === 'seedsuball'
const SESSION = args.includes('--input-format') && val('--input-format') === 'stream-json'
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
function session() {
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `call${args.includes('--model') ? ' ' + val('--model') : ''}\n`)
  const files = fs.readdirSync(process.cwd())
  // 스캔 글 바꾸기(바탕 설계 Z11) — 도구는 Read 하나 · 세션 폴더에는 원본 사본(원본.<확장자>) 하나만
  const scanDir = files.length === 1 && /^원본\.[a-z]+$/.test(files[0])
  const tools = scanDir ? 'Read' : 'Read,Glob,Grep'
  const ok = args.includes('-p') && val('--tools') === tools && val('--allowedTools') === tools && args.includes('--strict-mcp-config') && JSON.parse(val('--mcp-config') || '{}').mcpServers && val('--json-schema') && noHooks() && (scanDir || (files.includes('md') && files.every((x) => ['재료.tsv', 'md', 'cards'].includes(x))))
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
    const text0 = String(m?.message?.content || '')
    const tailAt = text0.indexOf('아래는 이 일에 같이 따르는 고정 생성 룰이다') // 일 설명 끝의 생성 룰 덩이(H5)는 재료가 아니다
    const text = tailAt > 0 ? text0.slice(0, tailAt).trimEnd() : text0
    turn++
    if (!ok) return say({ is_error: true, subtype: 'error', result: '가짜 claude 세션: 읽기 도구 셋 · 빈 MCP · 스키마 · 세션 폴더를 지키지 않았다' })
    if (process.env.FAKE_CLAUDE_MODE === 'logout') return say({ is_error: true, subtype: 'error', result: 'Invalid API key · Please run /login' })
    if (process.env.FAKE_CLAUDE_MODE === 'hang') return
    const lim = process.env.FAKE_CLAUDE_LIMIT_FILE
    if (lim && fs.existsSync(lim)) { fs.rmSync(lim); return say({ is_error: true, subtype: 'error', result: 'Claude usage limit reached · resets 3pm' }) }
    const fixing = text.startsWith('지난 초안이 kmd 검사에 걸렸다')
    const scanFix = text.startsWith('받은 글이 걸렸다')
    if (scanDir && (text.startsWith('이 폴더의 「') || scanFix)) {
      // FAKE_CLAUDE_MODE=scanbad → 첫 턴은 `# 제목` 없이(같은 세션에 고쳐 받기) · scanbadall → 고쳐도 · scansecret → 비밀번호 꼴 줄
      if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `seed-scan${scanFix ? ' fix' : ''}\n`)
      const title = (session.scanTitle ||= (text.match(/^- 첫 줄은 `# (.+)`/m) || [])[1] || '스캔')
      const mode = process.env.FAKE_CLAUDE_MODE || ''
      const head = mode === 'scanbadall' || (mode === 'scanbad' && !scanFix) ? '' : `# ${title}\n\n`
      const o = { text: `${head}스캔에서 옮긴 글 ${files[0]} ${fs.statSync(files[0]).size} 바이트.\n${mode === 'scansecret' ? '비밀번호: hunter2abc\n' : ''}`, unsure: ['둘째 쪽 도장'] }
      out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't' + turn, name: 'Read', input: { file_path: `${process.cwd()}\\${files[0]}`, pages: '1-20' } }] } })
      out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't' + turn, content: '(쪽 그림)' }] } })
      out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 's' + turn, name: 'StructuredOutput', input: o }] } })
      return say({ structured_output: o, num_turns: 2, duration_ms: 800 })
    }
    if (!fixing) kind = text.startsWith('바탕 세우기 뼈대를') ? 'frame' : text.startsWith('바탕 세우기 구조안의 한 묶음') ? 'batch' : text.startsWith('바탕 세우기 항목 글을') ? 'write' : 'other'
    if (!fixing) m.first = text
    if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `seed-${kind}${fixing ? ' fix' : ''}\n`)
    // FAKE_CLAUDE_BUDGET_FILE=<파일> → 그 파일이 있으면 묶음 · 짓기 턴 한 번은 예산을 넘는다(파일을 지운다) · 그 뒤 세션은 예산을 <파일>.used 에 남긴다
    const bud = process.env.FAKE_CLAUDE_BUDGET_FILE
    if (bud && (kind === 'batch' || kind === 'write')) {
      if (fs.existsSync(bud)) { fs.rmSync(bud); return say({ is_error: true, subtype: 'error_max_budget_usd', result: '', total_cost_usd: 5.2, num_turns: 4 }) }
      fs.appendFileSync(bud + '.used', `${kind} ${val('--max-budget-usd')}\n`)
    }
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
      const docs = [...(session.batch ||= text).matchAll(/^\[doc (.+?)\](?: 종류: \S+)?(?: \(.*?\))? 재료: (.*)$/gm)].map((x) => ({ id: x[1], src: [...x[2].matchAll(/m:[0-9a-f]{16}/g)].map((y) => y[0]) }))
      // 문서 성격(채널 평가 P6) — 프롬프트가 nature 를 물으면 서술로
      const nat = text.includes('nature(으뜸 성격)') ? { nature: '서술' } : {}
      const out2 = docs.map((d) => ({ id: d.id, ...nat, items: d.src.filter((s) => rows.find((r) => r.src === s)?.pick === '넣음').map((s) => ({ h: headOf(rows.find((r) => r.src === s).path), src: [s], note: '파일 하나가 대상 하나' })) }))
      const first = out2.find((d) => d.items.length)?.items[0]
      o = { docs: out2, names: first ? [{ coord: 'topic:' + first.h.replace(/\s+/g, ''), label: first.h, doc: out2.find((d) => d.items.length).id, h: first.h }] : [], skip: [], why: '재료마다 항목' }
    } else if (kind === 'write') {
      const src = session.write ||= text
      const fileOf = new Map([...src.matchAll(/^- md\/(\S+) · (.+?)(?: · [\d,]+ 자)?$/gm)].map((x) => [x[2], x[1]]))
      const body = (p) => { const f = fileOf.get(p); return f ? fs.readFileSync(`md/${f}`, 'utf8').split('\n').filter((l) => !/^#{1,6}\s/.test(l)).join('\n').trim() : '' }
      const items = [...src.matchAll(/^\[target (.+?) › (.+?)\](?: 몫: 재료 (.*))?$/gm)].map((x) => ({ doc: x[1], h: x[2], text: ((x[3] || '').split(' · ').map(body).filter(Boolean).join('\n\n') || '글') + (process.env.FAKE_CLAUDE_MODE === 'lie' ? '\n그리고 999초 기다린다.' : '') }))
      if (items.length && subOn(fixing)) items[0].text += SUBHEAD
      o = { items, summary: `${(src.match(/문서 「([^」]+)」/) || [])[1] || '문서'} 의 항목을 재료 글로 적는다.`, why: '재료 글로 지었다' }
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
  // 일 설명 끝의 생성 룰 덩이(H5)는 재료가 아니다 — 있는지만 보고 떼고 읽는다
  const RULES_TAIL = prompt.indexOf('아래는 이 일에 같이 따르는 고정 생성 룰이다')
  if (RULES_TAIL > 0) prompt = prompt.slice(0, RULES_TAIL).trimEnd()
  // 붙은 MCP(열쇠 꼴 · 허용 · 막은 길) — 보내기 초안이 기기 열쇠가 아니라 읽기 열쇠로 붙나 · 설정 폴더를 막나(채널 평가 P2 검토)
  if (process.env.FAKE_CLAUDE_MCP_LOG) {
    const k = JSON.parse(fs.readFileSync(val('--mcp-config'), 'utf8')).mcpServers?.kmd
    fs.appendFileSync(process.env.FAKE_CLAUDE_MCP_LOG, JSON.stringify({ auth: k?.headers?.Authorization || null, url: k?.url || null, allow: val('--allowedTools') || '', deny: val('--disallowedTools') || '', cfg: val('--mcp-config') }) + '\n')
  }
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `call${args.includes('--model') ? ' ' + val('--model') : ''}\n`)
  const ok = args.includes('-p') && val('--tools') === 'Read,Glob,Grep' && val('--permission-mode') === 'dontAsk' && args.includes('--strict-mcp-config') && JSON.parse(fs.readFileSync(val('--mcp-config'), 'utf8')).mcpServers && val('--json-schema') && noHooks() && fs.readdirSync(process.cwd()).length === 0
  if (!ok) return say({ is_error: true, subtype: 'error', result: '가짜 claude: 도구 0 · 빈 MCP · 스키마 · 빈 폴더를 지키지 않았다' })
  if (process.env.FAKE_CLAUDE_MODE === 'logout') return say({ is_error: true, subtype: 'error', result: 'Invalid API key · Please run /login' })
  if (prompt.startsWith('이 물음에는 {"ok": true}')) return say({ structured_output: { ok: true } }) // checkClaude
  // 바탕 세우기 구조안(Z7 · core/shape.js seedPlanPromptOf) — 넣음 재료마다 항목 하나(머리 = 파일 이름) · 문서 「업무 안내」 하나 · 첫 재료에 장부 항목 하나
  //   FAKE_CLAUDE_MODE=badseed → 처음 답은 재료 하나를 빠뜨린다(덮임 걸림 → 고쳐 쓰기)
  // FAKE_CLAUDE_EFFORT_LOG=<파일> → 스키마 답 한 번마다 「<프롬프트 앞 12자> <effort | ->」 한 줄(채널 평가 T4 · 구조안 생각 정도)
  if (process.env.FAKE_CLAUDE_EFFORT_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_EFFORT_LOG, `${prompt.slice(0, 12)} ${args.includes('--effort') ? val('--effort') : '-'}\n`)
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
      if (items.length && subOn(fixing)) items[0].text += SUBHEAD // 재료 소제목(채널 평가 4차 shape)
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
  // 문서 다듬기(S13 · core/ingest.js polishPromptOf) — 항목마다 끝에 「(다듬음)」 한 줄 · 첫 항목만 값을 바꾼다(서버가 그 항목을 빼는지 본다) · 까닭(why)에도 그 값을 적는다(기록 글에 실리면 값 검사가 다듬기 전체를 막는다)
  if (prompt.startsWith('문서 「') && prompt.includes('의 항목 글을 다듬는다')) {
    if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, 'polish\n')
    const FIXP = '\n\n지난 초안이 kmd 검사에 걸렸다'
    const fixingP = prompt.includes(FIXP)
    const part = (fixingP ? prompt.slice(0, prompt.indexOf(FIXP)) : prompt).split('항목(base 는 그대로 돌려준다):\n')[1] || ''
    const secs = [...part.matchAll(/^## (.+)\n\(base ([0-9a-f]{16})\)\n([\s\S]*?)(?=\n\n## |(?![\s\S]))/gm)].map((m) => ({ h: m[1].trim(), base: m[2], body: m[3] }))
    // FAKE_CLAUDE_MODE=polishedits → 처음 답은 첫 항목을 못 대는 바꿀 곳(edits)으로 · 나머지는 다듬음(고쳐 받으면 모두 다듬음 · 값은 그대로)
    if (process.env.FAKE_CLAUDE_MODE === 'polishedits') {
      if (fixingP && process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, 'fix\n')
      return say({ structured_output: { updates: secs.map((s, i) => (i === 0 && !fixingP ? { heading: s.h, base: s.base, edits: [{ find: '받은 글에 없는 줄', replace: '바꾼 줄' }] } : { heading: s.h, base: s.base, content: `${s.body.trim()}\n\n(다듬음)` })), why: '문장을 짧게' } })
    }
    return say({ structured_output: { updates: secs.map((s, i) => ({ heading: s.h, base: s.base, content: `${s.body.trim()}${i === 0 ? ' 999초' : ''}\n\n(다듬음)` })), why: '문장을 짧게 · 첫 항목은 999초로 고쳤다' } })
  }
  // 들이기(S7 · core/ingest.js intakePromptOf) — 기록 + 항목 글 초안 하나
  //   커밋: 「바뀐 값: A → B」 의 A 가 든 후보 항목을 B 로(꼭 한 번이면 바꿀 곳 · 아니면 새 글) · 없으면 updates 비움
  //   파일: 파일의 ## 머리가 후보 항목과 같으면 그 항목을 파일 글로(새 글) · 나머지는 새 문서(경로 = 파일 이름)
  //   FAKE_CLAUDE_MODE=bad → 처음 답에 지어낸 값(999초) · badall → 고쳐 써도 · content → 커밋도 바꿀 곳 대신 새 글 · nosec → 새 문서에 항목 없음 ·
  //   names → 새 항목을 장부에 올린다(term:<머리>) · gist → 새 항목 + 뜻 한 줄(proc:<머리>) · outside → 후보 밖 문서를 고친다
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
    // 바뀐 것 — 넣은 항목의 머리를 한 줄씩(파일 이름의 숫자가 요약에 들어 「본문 반영」 에 걸리지 않게: 바뀐 것 칸이 있으면 그 칸의 값만 본다)
    out.record.changes = [...out.updates.map((u) => `고침: ${u.heading}`), ...(out.newDoc?.sections || []).map((s) => `새로: ${s.heading}`)]
    if (mode === 'names') out.names = rest.map((s) => ({ name: s.heading, kind: 'term' }))
    // gist → 새 머리마다 장부 짝 + 뜻 한 줄(채널 평가 P3 · P4 · 보내기의 새 머리)
    if (mode === 'gist') out.names = rest.map((s) => ({ name: s.heading, kind: 'proc', gist: `${s.heading} 때 무엇을 어떤 차례로 보는지 정한 절차` }))
    out.why = out.updates.length ? '같은 항목이 있다' : '이어지는 문서가 없다'
    return say({ structured_output: out })
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
  const FIX = '\n\n지난 초안이 kmd 검사에 걸렸다'
  if (prompt.includes(FIX)) {
    if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, 'fix\n')
    fixing = true
    prompt = prompt.slice(0, prompt.indexOf(FIX))
  }
  const recPart = prompt.split('기록(오래된 것부터):\n')[1] || ''
  const all = [...recPart.matchAll(/^\[([^\]]+)\] [^\n]*\n([\s\S]*?)(?=\n\n\[|$)/gm)].map((m) => ({ id: m[1], body: m[2].trim() }))
  const cur = (prompt.split('지금 글:\n')[1] || '').split('\n\n기록(오래된 것부터):')[0]
  say({ structured_output: draft(cur, all) })
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
