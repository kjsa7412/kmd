// 세션 일감(지식 생성 하네스 H4a · H-D34) — 팀 일꾼이 Claude Code 세션(가짜 에이전트)을 띄워 팀 서버의 MCP 에 단기 열쇠로 붙는다.
//   세션이 스스로 brief → section → save 를 부르고, 세션의 save 는 무인 저장 문을 지나 기록 + 항목 글 + 장부가 한 커밋에 선다.
//   열쇠는 그 지식 · 그 일감에만 · 끝나면 끊긴다 · 세션이 아무것도 넣지 않으면 일감은 다시 시도(H4b · 규칙 길은 걷었다).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { workOnce, knownTypes } from '../core/worker.js'
import { copyDir } from './helpers.mjs'
import { GEN_RULES_REV } from '../core/genrules.js'
import { TOOLS } from '../server/mcp.js'
import { polishPromptOf, polishToSave } from '../core/ingest.js'
import { sha16 } from '../core/text.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, wk, docsDir
const ADMIN = { user: 'kim', admin: true }
const W = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }
const KD = () => path.join(tmp, 'kn', 'dpms')
const fresh = async () => { s.hub.forget?.('dpms'); return s.hub.get('dpms') }
const jobsOf = (st) => s.hub.intakesOf('dpms').filter((j) => j.state === st)
const mcp = async (token, name, args) => {
  const r = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
  return { status: r.status, j: await r.json().catch(() => null) }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-hsession-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  delete process.env.KMD_CLAUDE
  process.env.KMD_CLAUDE_AGENT = path.join(HERE, 'fixture', 'fake-claude-agent.mjs')
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  docsDir = path.join(tmp, 'src', '통화')
  W(path.join(docsDir, 'HNC 통화.md'), '# HNC 통화\n\n2026-10-21 HNC 와 통화했다.\n\n## 원격 명령\n\n원격 명령은 펄스 방식으로 보낸다. 펄스 길이는 300ms 다.\n')
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ sourceRoots: [path.join(tmp, 'src')], decideMs: 3600000, sourceTickMs: 3600000, inboxTickMs: 3600000, jobTickMs: 3600000, watchQuietMs: 600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  wk = (await s.auth.workerAdd()).key
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('팀 일꾼이 세션을 띄운다: 세션이 팀 서버의 MCP 로 찾고 저장한다 · 기록 + 항목 글 + 장부가 한 저장 · 열쇠는 끝나면 끊긴다', async () => {
  assert.ok(knownTypes().includes('session'))
  const r0 = await s.hub.sourceAdd(ADMIN, 'dpms', { name: '통화', kind: 'docs', at: docsDir, rules: [{ rule: 'docs', into: { doc: '통화' } }] })
  assert.equal(r0.run[0].queued, 1, JSON.stringify(r0.run[0]).slice(0, 300))
  const logs = []
  const a = await workOnce({ server: s.url, key: wk, log: (x) => logs.push(x) })
  assert.equal(a.job.session, true, '세션을 아는 일꾼에게는 세션 일감으로')
  assert.deepEqual([a.summary.put, a.summary.rule], [1, undefined], logs.join('\n'))
  assert.equal(jobsOf('done').length, 1)
  const k = await fresh()
  const w = k.byWork.get(a.rec)
  assert.ok(w, '세션의 save 가 기록을 세웠다')
  assert.ok(w.tags.includes('intake') && w.tags.some((t) => t.startsWith('job/')) && w.tags.some((t) => t.startsWith('ingest/')), w.tags.join(' '))
  assert.equal(w.author, 'kmd') // 가져올 곳의 들이기는 예약 사람 kmd
  assert.match(w.body, /## 원천/)
  assert.ok(k.byDocPath.get('docs/회의록.md').sections.some((x) => x.h === '2026-10-21 HNC 통화'))
  assert.ok(k.vocab.coords.has('term:펄스명령'))
  // 측정 줄 — 무인 채널(가져올 곳)
  const line = fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'savelog', 'dpms.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.rec === a.rec)
  assert.equal(line?.ch, 'intake-src', JSON.stringify(line))
})

test('세션 일감의 열쇠: 그 지식에만 · 팀 서버는 세션 일감의 열쇠만 받는다 · 끝난 일감의 열쇠는 끊긴다', async () => {
  W(path.join(docsDir, '둘째 통화.md'), '# 둘째 통화\n\n## 원격 명령\n\n펄스 길이를 400ms 로 바꾼다.\n')
  await s.hub.sourceRun('dpms', '통화')
  const n = await (await fetch(`${s.url}/api/worker/next`, { method: 'POST', headers: { authorization: `Bearer ${wk}`, 'content-type': 'application/json' }, body: JSON.stringify({ types: knownTypes() }) })).json()
  assert.equal(n.job.session, true)
  const call = async (p, body) => (await fetch(`${s.url}/api/k/dpms/worker/intake${p}`, { method: 'POST', headers: { authorization: `Bearer ${n.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })).json()
  const t = await call('/session')
  assert.match(t.token, /^kmda_/)
  assert.match(t.system, /^아래 「생성 룰」 이 이 일의 규칙이다/)
  assert.match(t.system, new RegExp(`생성 룰 ${GEN_RULES_REV}판`))
  assert.match(t.system, /이 일은 무인 일감이다. 사람에게 묻거나 승인을 기다리지 않는다/)
  assert.match(t.system, /R8 판례를 따름 · 가름 · 벗어남/)
  // 채널 평가 P3 · P5 · P9 · P14 · P22 — 틀리기 쉬운 칸을 반례와 함께 싣는다 · 들인 때는 근거 날짜가 아니라고 일 설명에 적는다
  assert.match(t.system, /gist 는 뜻 한 줄로 새 항목마다 꼭/)
  for (const re of [/names\[\]\.gist\(뜻 한 줄/, /넣을 글에 날짜가 없으면 적지 않는다/, /까닭에 커밋 메시지를 그대로 옮김/, /원본 메타\(문서 번호 · 판/, /이을 항목\(R3-5 · R2-1\)/, /뜻이 같은 항목이 있으면 새 항목을 세우지 않고/]) assert.match(t.system, re)
  assert.match(t.prompt, /kmd 에 넣은 사람 · 때: .*근거 날짜 · 까닭 · 제목에 쓰지 않는다/)
  assert.ok(TOOLS.find((x) => x.name === 'save').inputSchema.properties.names.items.properties.gist, 'MCP save 의 names 에 gist 칸')
  assert.match(t.prompt, /knowledge id: dpms\)/)
  assert.ok(t.files.some((f) => f.name === '둘째 통화.md' && Buffer.from(f.b64, 'base64').toString('utf8').includes('400ms')))
  // 그 지식만 — 다른 지식은 목록에도 없고 저장도 거절된다
  const b = await mcp(t.token, 'brief', {})
  assert.deepEqual(b.j.result.structuredContent.knowledge.map((x) => x.id), ['dpms'])
  const other = (await s.hub.list()).find((x) => x.id !== 'dpms')
  if (other) assert.equal((await mcp(t.token, 'save', { knowledge: other.id, record: { title: '엉뚱한 곳', body: 'x' } })).j.result.structuredContent.error, 'E_FORBIDDEN')
  // 과거 결정 카드를 세션이 받는다(match)
  const m = (await mcp(t.token, 'match', { q: '카나리', knowledge: 'dpms' })).j.result.structuredContent
  assert.ok(m.cards.some((c) => c.key === 'proc:카나리'))
  // 무인 세션에는 승인할 사람이 없다 — 저장 제안은 거절하고 save 를 바로 부르게 한다
  const pr = (await mcp(t.token, 'propose', { knowledge: 'dpms', record: { title: '제안', body: 'x', touchesEmpty: '없음' } })).j.result.structuredContent
  assert.equal(pr.error, 'E_INPUT')
  assert.match(pr.message, /save 를 바로 부른다/)
  // 무인 프롬프트도 지금 꼴(sections · names · forms)을 가르친다(옛잔재 O-11) · 2판 꼴은 가르치지 않는다
  assert.match(t.system, /저장 입력은 뒤의 스킬 글과 같은 꼴이다/)
  assert.match(t.system, /내는 것: save 입력\(record · sections · names · forms/)
  assert.doesNotMatch(t.system, /items · docs · skip|items\(항목마다/)
  // 2판(items · docs · skip)은 걷었다: 무인 세션의 save 도 지금 꼴을 알려 주는 E_INPUT(아무것도 쓰지 않는다)
  const old = (await mcp(t.token, 'save', { knowledge: 'dpms', record: { title: '2판' }, items: [], skip: [{ what: '인사말', rule: 'R6-1', why: '인사말이다' }] })).j.result.structuredContent
  assert.equal(old.error, 'E_INPUT')
  assert.match(old.message, /save 입력 2판\)은 걷었다/)
  // 세션의 save(지금 꼴): 새 모으는 문서의 갈래(forms) · 장부 줄(names) · 새 항목(sections)이 무인 저장 문을 한 번에 지난다
  const v2 = (await mcp(t.token, 'save', {
    knowledge: 'dpms',
    record: { title: '둘째 통화: 펄스 길이 400ms', body: '둘째 통화에서 펄스 길이를 바꿨다.', changes: ['펄스 길이: 400ms'], refs: ['근거 날짜: 2026-10-22'], touches: ['통화:2026-10-22_둘째_통화'] },
    forms: [{ name: '통화 기록', aliases: ['통화'], kind: '사건' }],
    names: [{ coord: '통화:2026-10-22_둘째_통화', label: '2026-10-22 둘째 통화', doc: '통화 기록', heading: '2026-10-22 둘째 통화', gist: '펄스 길이를 400ms 로 바꾼 둘째 업체 통화' }],
    sections: [{ doc: '통화 기록', heading: '2026-10-22 둘째 통화', content: '펄스 길이를 400ms 로 바꾼다.' }],
  })).j.result.structuredContent
  assert.ok(v2.saved, JSON.stringify(v2))
  const kd = path.join(tmp, 'kn', 'dpms')
  assert.match(fs.readFileSync(path.join(kd, '_forms.md'), 'utf8'), /\| 통화 기록 \| 통화 \| - \| 사건 \|/)
  assert.match(fs.readFileSync(path.join(kd, '_vocab.md'), 'utf8'), /- `통화:2026-10-22_둘째_통화`: 2026-10-22 둘째 통화/)
  const rec = fs.readFileSync(path.join(kd, 'work', `${v2.saved}.md`), 'utf8')
  assert.ok(!rec.includes('## 지은 근거'))
  assert.match(rec, /## 원천/)
  // 세션 끝 — 세션이 저장했으므로 일감이 그 저장으로 닫힌다
  const d = await call('/done', { session: { ok: true, error: null, message: '', cost: 0.02 } })
  assert.deepEqual([d.put, d.rule, d.rec], [1, undefined, v2.saved], JSON.stringify(d))
  // 끝난 일감의 열쇠는 끊긴다
  assert.equal((await mcp(t.token, 'brief', {})).status, 401)
  // 일감 열쇠가 아닌 손으로 지은 kmda_ 는 받지 않는다
  assert.equal((await mcp('kmda_' + 'x'.repeat(32), 'brief', {})).status, 401)
})

test('스키마 답 세션의 읽기 열쇠: 팀 MCP 로 읽기는 되고 저장은 막힌다(E_FORBIDDEN)', async () => {
  const token = s.hub.agentToken('dpms', null, null, { team: true, ro: true })
  assert.ok((await mcp(token, 'brief', { knowledge: 'dpms' })).j.result.structuredContent.docs?.length >= 0)
  assert.ok(Array.isArray((await mcp(token, 'match', { q: '카나리', knowledge: 'dpms' })).j.result.structuredContent.cards))
  assert.equal((await mcp(token, 'save', { knowledge: 'dpms', record: { title: '읽기 열쇠로 저장', body: 'x', touchesEmpty: '없음' } })).j.result.structuredContent.error, 'E_FORBIDDEN')
})

test('새 판 Claude Code 는 시작할 때 kmd 를 「pending」 으로 알린다: 끊지 않고 끝까지 둔다(들어간다)', async () => {
  const old = process.env.FAKE_AGENT_MODE
  process.env.FAKE_AGENT_MODE = 'pending'
  try {
    const o = await s.hub.openJob('dpms', { type: 'file', by: 'kim', src: { rel: 'pending 메모.md', file: 'pending 메모.md', title: 'pending 메모.md', sha: 'd'.repeat(16) }, md: '# 메모\n\n## 원격 명령\n\n펄스 길이는 910ms 다.\n' })
    const r = await workOnce({ server: s.url, key: wk, log: () => {} })
    assert.equal(s.hub.intakesOf('dpms').find((x) => x.id === o.job).state, 'done', JSON.stringify(r?.summary))
  } finally { if (old == null) delete process.env.FAKE_AGENT_MODE; else process.env.FAKE_AGENT_MODE = old }
})

// 채널 평가 P17 — 다듬기 프롬프트가 오기 · 백틱 · 수준 표시를 다듬기 몫으로 낱낱이 적고 반례를 싣는다
test('다듬기 프롬프트: 정돈 거리(오기 · 백틱 · 수준 표시 · 줄표)와 반례', () => {
  const p = polishPromptOf({ doc: 'docs/게이트웨이 설계.md', title: '게이트웨이 설계', sections: [{ h: 'gw_log', base: 'b1', body: '| 콜럼 | 형 |\n|---|---|\n| log_id | bigint |' }] })
  for (const re of [/정돈 거리/, /오기 · 맞춤법/, /「콜럼」 → 「컬럼」/, /백틱/, /수준 표시/, /줄표/, /반례\(다듬기가 아니다\)/]) assert.match(p, re)
  assert.match(p, /## gw_log\n\(base b1\)/)
})

// 검토 지적(prompts) — 프롬프트가 시키는 정돈(맨글 식별자에 백틱 · 「가.」 → 1. 2.)은 다듬기의 값 검사를 넘는다 · 값 글자를 바꾸면 그 항목만 빠진다
test('다듬기 저장: 백틱 · 수준 표시 정돈은 값이 바뀐 것이 아니다', () => {
  const old = '로그는 gw_log 테이블에 쌓인다.\n가. 수집\n나. 전송'
  const k = { byDocPath: new Map([['docs/게이트웨이 설계.md', { sections: [{ h: 'gw_log', body: old }, { h: 'gw_send', body: '주기는 send_interval_sec 5초.' }] }]]) }
  const g = { doc: 'docs/게이트웨이 설계.md', title: '게이트웨이 설계', sections: [{ h: 'gw_log', base: sha16(old), body: old }, { h: 'gw_send', base: sha16('주기는 send_interval_sec 5초.'), body: '주기는 send_interval_sec 5초.' }] }
  const r = polishToSave(k, g, { updates: [
    { heading: 'gw_log', base: sha16(old), content: '로그는 `gw_log` 테이블에 쌓인다.\n1. 수집\n2. 전송' },
    { heading: 'gw_send', base: sha16('주기는 send_interval_sec 5초.'), content: '주기는 `send_interval_sc` 5초.' },
  ] })
  assert.equal(r.ok, true)
  assert.deepEqual(r.input.sections.map((x) => x.heading), ['gw_log'])
  assert.equal(r.dropped.length, 1)
  assert.match(r.dropped[0].why, /값이 바뀐다.*\+send_interval_sc/)
  // harness 검토 지적 — 일꾼의 까닭(why)에 값이 들면(바꾼 값) 기록 글에 싣지 않는다 · 값이 없는 까닭은 싣는다
  const w = polishToSave(k, g, { updates: [{ heading: 'gw_log', base: sha16(old), content: '로그는 `gw_log` 테이블에 쌓인다.\n1. 수집\n2. 전송' }], why: '보존 기간을 14일로 맞췄다' })
  assert.doesNotMatch(w.input.record.body, /14일/)
  const w2 = polishToSave(k, g, { updates: [{ heading: 'gw_log', base: sha16(old), content: '로그는 `gw_log` 테이블에 쌓인다.\n1. 수집\n2. 전송' }], why: '번호 표기를 맞췄다' })
  assert.match(w2.input.record.body, /번호 표기를 맞췄다/)
})
