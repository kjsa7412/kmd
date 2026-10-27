// 요구 v0.2 필수 — 에이전트로 지식 세우기 · 터미널 · 이름 세우기 · 메뉴 순서 · 동기화 · 가져오는 곳 고치기 · 지우기.
//
// 가짜 Claude Code(test/fixture/fake-claude-agent.mjs)가 kmd MCP 를 진짜 HTTP 로 부른다:
//   「DPMS_회의록_261021_HNC_통화.md」 → 회의록 › 「2026-10-21 HNC 통화」 + 이름 term:펄스 명령 · 들인 기록은 「넣음」 · 터미널 줄
//   단기 열쇠(kmda_)는 /api 를 못 쓰고 다른 지식에 쓰지 못한다 · 넣지 않고 끝나면 규칙으로
//   pdf → 글로 바꾼 뒤 기록 → 들이기 · hwpx 는 kmd 안에서 · names(save) → 이름 장부 · 자리 장부

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { upsertVocab, upsertRegistry } from '../core/namebook.js'
import { parseVocab } from '../core/vocab.js'
import { parseRegistry, locate } from '../core/registry.js'
import { makeMcp } from '../server/mcp.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ME = { user: 'kim', admin: true, pc: true }
let tmp, s
const HNC = '# DPMS 통화 기록\n\n## 요약\n\n| 일자 | 2026-10-21 |\n|---|---|\n| 상대 | HNC 권순용 차장 |\n\n## 원격 명령\n펄스 방식: 게이트웨이가 3초 동안 1을 쓰고 0으로 되돌린다.\n'
const wait = async (f, ms = 15000) => { const t = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t > ms) throw new Error('기다림 초과'); await new Promise((r) => setTimeout(r, 100)) } }

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-agent-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  process.env.KMD_CLAUDE_AGENT = path.join(HERE, 'fixture', 'fake-claude-agent.mjs')
  const root = path.join(tmp, 'kn')
  fs.mkdirSync(root, { recursive: true })
  s = await startServer({ root, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  await s.hub.addKnowledge(ME, { kind: 'new', name: '회의' })
})
after(async () => {
  await s?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('이름 장부 · 자리 장부: 더하고 · 다른 이름만 보태고 · 자리는 바꾼다', () => {
  let v = upsertVocab('', [{ coord: 'table:tb_user', label: '사용자', aliases: [] }])
  v = upsertVocab(v, [{ coord: 'table:tb_user', label: '다른 이름표', aliases: ['회원'] }, { coord: 'proc:배포', label: '배포', aliases: [] }])
  const c = parseVocab(v).coords
  assert.equal(c.get('table:tb_user').label, '사용자')
  assert.deepEqual(c.get('table:tb_user').aliases, ['회원'])
  assert.ok(c.get('proc:배포'))
  let r = upsertRegistry('', [{ coord: 'table:tb_user', doc: '테이블 정의', heading: 'tb_user: 사용자' }])
  r = upsertRegistry(r, [{ coord: 'table:tb_user', doc: '테이블 정의', heading: 'tb_user' }])
  assert.deepEqual(locate(parseRegistry(r), 'table:tb_user'), { doc: 'docs/테이블 정의.md', level: 2, heading: 'tb_user' })
  assert.equal(parseRegistry(r).rows.length, 1)
})

test('파일 넣기 → 에이전트가 회의록 항목 · 이름을 세운다 · 터미널 줄 · 기록은 넣음', async () => {
  const r = await s.hub.importFiles(ME, '회의', [{ path: 'DPMS_회의록_261021_HNC_통화.md', data: Buffer.from(HNC) }])
  assert.equal(r.rows[0].kind, 'run')
  const id = r.rows[0].run
  await s.hub.curateIdle('회의')
  const run = s.hub.runGet(ME, id)
  assert.equal(run.state, 'done', run.msg)
  assert.deepEqual(run.docs, ['회의록'])
  assert.equal(run.names, 1)
  assert.ok(run.lines.some((l) => l.k === 'tool' && l.x.startsWith('저장')), '터미널에 저장 줄')
  assert.ok(run.lines.some((l) => l.k === 'cost'))
  const dir = path.join(tmp, 'kn', '회의')
  const doc = fs.readFileSync(path.join(dir, 'docs', '회의록.md'), 'utf8')
  assert.match(doc, /^## 2026-10-21 HNC 통화$/m)
  assert.match(doc, /3초 동안 1을 쓰고/)
  assert.match(fs.readFileSync(path.join(dir, '_vocab.md'), 'utf8'), /`term:펄스 명령`: 펄스 명령\n  aliases: 펄스 방식/)
  assert.match(fs.readFileSync(path.join(dir, '_managed.md'), 'utf8'), /\| `term:펄스 명령` \| `docs\/회의록.md` \| `## 2026-10-21 HNC 통화` \|/)
  const k = await s.hub.get('회의')
  assert.notEqual(k.byWork.get(r.rows[0].rec).state, 'pend')
  assert.ok(!fs.existsSync(path.join(dir, 'docs', 'DPMS_회의록_261021_HNC_통화.md')), '파일 이름 문서가 서지 않는다')
})

test('단기 열쇠: 화면 길 거절 · 다른 지식 거절 · 일이 끝나면 끝', async () => {
  const run = s.hub.newRun('회의', { title: 'x' })
  const key = s.hub.agentToken('회의', 'none', run.id)
  const api = await fetch(s.url + '/api/knowledge', { headers: { authorization: `Bearer ${key}` } })
  assert.equal(api.status, 403)
  await s.hub.addKnowledge(ME, { kind: 'new', name: '다른' })
  const call = async (name, a) => (await (await fetch(s.url + '/mcp', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: a } }) })).json()).result
  const other = await call('save', { knowledge: '다른', record: { title: '엉뚱', body: 'x' } })
  assert.equal(other.isError, true)
  const list = await call('brief', {})
  assert.deepEqual(list.structuredContent.knowledge.map((x) => x.id), ['회의'])
  const bad = await fetch(s.url + '/mcp', { method: 'POST', headers: { authorization: 'Bearer kmda_nosuchkey', 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' })
  assert.equal(bad.status, 401)
})

test('넣지 않고 끝나면 규칙으로: 까닭이 터미널 · 갈래 문서', async () => {
  process.env.FAKE_AGENT_MODE = 'idle'
  try {
    const r = await s.hub.importFiles(ME, '회의', [{ path: '회의_20261022_v2(최종).md', data: Buffer.from('# 회의\n\n## 안건\n카나리 20%\n') }])
    await s.hub.curateIdle('회의')
    const run = s.hub.runGet(ME, r.rows[0].run)
    assert.equal(run.state, 'rule', run.msg)
    assert.ok(run.lines.some((l) => l.x.includes('규칙으로 넣는다')))
    assert.match(fs.readFileSync(path.join(tmp, 'kn', '회의', 'docs', '회의록.md'), 'utf8'), /^## 2026-10-22 /m)
  } finally {
    delete process.env.FAKE_AGENT_MODE
  }
})

test('pdf: Claude Code 가 글로 바꾼 뒤 기록 · 들이기 · 원본은 첨부 · 같은 pdf 는 다시 바꾸지 않는다', async () => {
  const pdf = Buffer.from('%PDF-1.4 점검 보고 시험')
  const r = await s.hub.importFiles(ME, '회의', [{ path: '점검 보고.pdf', data: pdf }])
  assert.equal(r.rows[0].kind, 'run')
  await s.hub.curateIdle('회의')
  const run = s.hub.runGet(ME, r.rows[0].run)
  assert.equal(run.state, 'done', run.msg)
  assert.ok(run.lines.some((l) => l.x.includes('글로 바꿨다')))
  const dir = path.join(tmp, 'kn', '회의')
  assert.ok(fs.existsSync(path.join(dir, 'docs', 'assets', '점검 보고.pdf')))
  const k = await s.hub.get('회의')
  const rec = k.works.find((w) => w.tags.includes('ingest/점검 보고.pdf'))
  assert.ok(rec && /다음 점검 2026-11-02/.test(rec.body), '기록에 바꾼 글')
  // 보관한 글 — 두 번째는 바꾸기 줄 없이
  const again = await s.hub.mdOf('점검 보고.pdf', pdf)
  assert.match(again, /펌프 3대 정상/)
})

test('메뉴: 순서 · 뺌은 사람마다 · 동기화는 새로 놓인 지식을 맨 아래로', async () => {
  const ids = async () => (await (await fetch(s.url + '/api/knowledge', { headers: { cookie: await pcCookie() } })).json()).map((k) => k.id + (k.hidden ? '(뺌)' : ''))
  await s.hub.menuSet(ME, { order: ['다른', '회의'], hidden: ['다른'] })
  assert.deepEqual(await ids(), ['다른(뺌)', '회의'])
  fs.mkdirSync(path.join(tmp, 'kn', '옮겨온', 'docs'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '옮겨온', 'docs', '메모.md'), '# 메모\n\n## 하나\n둘\n')
  const r = await s.hub.sync(ME)
  assert.deepEqual(r.added.map((x) => x.id), ['옮겨온'])
  assert.deepEqual(await ids(), ['다른(뺌)', '회의', '옮겨온'])
  assert.ok(fs.existsSync(path.join(tmp, 'kn', '옮겨온', '.git')), '동기화가 git 을 세운다')
  assert.deepEqual((await s.hub.sync(ME)).added, [])
})

test('가져오는 곳: 고치기(언제 · 넣을 문서) · 지우기(문서는 둔다)', async () => {
  const src = path.join(tmp, 'src-docs')
  fs.mkdirSync(src, { recursive: true })
  fs.writeFileSync(path.join(src, '운영.md'), '# 운영\n\n## 점검\n매주\n')
  await s.hub.sourceAdd(ME, '회의', { name: '운영 문서', kind: 'docs', at: src, every: 'hourly', rules: [{ rule: 'docs', into: { doc: '운영' } }] })
  const e = await s.hub.sourceEdit(ME, '회의', { name: '운영 문서', every: 'daily 07:30', doc: '운영2' })
  assert.equal(e.source.every, 'daily 07:30')
  assert.equal(e.source.rules[0].into.doc, '운영2')
  assert.ok(fs.existsSync(path.join(tmp, 'kn', '회의', 'docs', '운영2', '운영.md')), '넣을 문서를 바꾸면 처음부터 다시')
  await s.hub.sourceRemove(ME, '회의', { name: '운영 문서' })
  assert.deepEqual((await s.hub.sources(ME, '회의')).map((x) => x.name), [])
  assert.ok(fs.existsSync(path.join(tmp, 'kn', '회의', 'docs', '운영2', '운영.md')), '들어온 문서는 그대로')
})

test('가져오는 곳: 넣을 지식 · 문서를 함께 바꾸면 옮겨 처음부터 · 옛 사본은 고른 대로', async () => {
  const src = path.join(tmp, 'src-move')
  fs.mkdirSync(src, { recursive: true })
  fs.writeFileSync(path.join(src, '설계.md'), '# 설계\n\n## 구조\n셋\n')
  await s.hub.sourceAdd(ME, '회의', { name: '설계 문서', kind: 'docs', at: src, every: 'hourly', rules: [{ rule: 'docs', into: { doc: '설계' } }] })
  assert.ok(fs.existsSync(path.join(tmp, 'kn', '회의', 'docs', '설계', '설계.md')))
  const e = await s.hub.sourceEdit(ME, '회의', { name: '설계 문서', kn: '다른', doc: '설계2', copies: 'drop' })
  assert.equal(e.moved, '다른')
  assert.equal(e.copies, 1)
  assert.deepEqual((await s.hub.sources(ME, '회의')).map((x) => x.name).filter((n) => n === '설계 문서'), [])
  assert.equal((await s.hub.sources(ME, '다른')).find((x) => x.name === '설계 문서').rules[0].into.doc, '설계2')
  assert.ok(fs.existsSync(path.join(tmp, 'kn', '다른', 'docs', '설계2', '설계.md')), '새 지식에 처음부터')
  assert.ok(!fs.existsSync(path.join(tmp, 'kn', '회의', 'docs', '설계', '설계.md')), '옛 사본은 지웠다')
  await assert.rejects(s.hub.sourceEdit(ME, '다른', { name: '설계 문서', kn: '없는지식' }))
  await s.hub.sourceRemove(ME, '다른', { name: '설계 문서' })
})

test('팀: 정리 일꾼이 넣은 파일을 에이전트로(서버 MCP · 단기 열쇠) · 터미널 줄은 서버 일 목록에', async () => {
  const { workOnce } = await import('../core/worker.js')
  const root = path.join(tmp, 'team')
  fs.mkdirSync(path.join(root, 'ops', 'docs'), { recursive: true })
  fs.writeFileSync(path.join(root, 'ops', 'docs', '처음.md'), '# 처음\n\n## 개요\n팀 지식\n')
  const t = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const KIM = { user: 'kim', admin: true }
    const r = await t.hub.importFiles(KIM, 'ops', [{ path: 'DPMS_회의록_261021_HNC_통화.md', data: Buffer.from(HNC) }])
    assert.equal(r.rows[0].kind, 'record')
    const key = (await t.auth.workerAdd()).key
    const done = await wait(async () => (await workOnce({ server: t.url, key, log: () => {} })) || null)
    assert.ok(done.job)
    const runs = t.hub.runList(KIM, 'ops')
    assert.equal(runs[0].state, 'done', runs[0].msg)
    const lines = t.hub.runGet(KIM, runs[0].id).lines
    assert.ok(lines.some((l) => l.k === 'tool' && l.x.startsWith('저장')), '일꾼이 올린 터미널 줄')
    assert.match(fs.readFileSync(path.join(root, 'ops', 'docs', '회의록.md'), 'utf8'), /^## 2026-10-21 HNC 통화$/m)
    const k = await t.hub.get('ops')
    assert.notEqual(k.byWork.get(r.rows[0].rec).state, 'pend')
  } finally {
    await t.close()
  }
})

// PC 화면 들어가기 — 한 번용 번호
async function pcCookie() {
  const r = await fetch(s.url + '/once', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: s.auth.once(s.pcUser) }) })
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}

test('일마다 모델: 에이전트는 기본 sonnet · 설정으로 바꾸면 그 모델', async () => {
  assert.equal(s.hub.models().agent, 'sonnet')
  assert.equal(s.hub.models().read, 'haiku')
  const one = async (name) => {
    const r = await s.hub.importFiles(ME, '회의', [{ path: name, data: Buffer.from(HNC.replace('3초', `${name.length}초`)) }])
    await s.hub.curateIdle('회의')
    return s.hub.runGet(ME, r.rows[0].run)
  }
  assert.ok((await one('모델-하나.md')).lines.some((l) => /fake-agent\(sonnet\)/.test(l.x)))
  await s.hub.setModel(ME, 'agent', 'opus')
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'prefs.json'), 'utf8')).pc.models.agent, 'opus')
  assert.ok((await one('모델-둘.md')).lines.some((l) => /fake-agent\(opus\)/.test(l.x)))
  await assert.rejects(s.hub.setModel(ME, 'agent', 'gpt-4'), /고를 수 있는 모델이 아니다/)
  await assert.rejects(s.hub.setModel(ME, 'nope', 'haiku'), /그런 일은 없다/)
  await s.hub.setModel(ME, 'agent', '')
  assert.ok(!(await one('모델-셋.md')).lines.some((l) => /fake-agent\(/.test(l.x)), '「기본」 이면 --model 을 넘기지 않는다')
})

test('파일 글은 kmd 가 옮긴다. 에이전트는 from(전체 · 머리) · append(있는 항목 끝)만 · 세션은 쓰지 못한다', async () => {
  await s.hub.addKnowledge(ME, { kind: 'new', name: '회의셋' })
  const dir = path.join(tmp, 'kn', '회의셋')
  const one = async (name, mode, text) => {
    process.env.FAKE_AGENT_MODE = mode
    try {
      const r = await s.hub.importFiles(ME, '회의셋', [{ path: name, data: Buffer.from(text) }])
      await s.hub.curateIdle('회의셋')
      return s.hub.runGet(ME, r.rows[0].run)
    } finally {
      delete process.env.FAKE_AGENT_MODE
    }
  }
  const a = await one('HNC_통화_from.md', 'from', HNC)
  assert.equal(a.state, 'done', a.msg)
  let doc = fs.readFileSync(path.join(dir, 'docs', '회의록.md'), 'utf8')
  assert.match(doc, /^## 2026-10-21 HNC 통화\n(?:<!--.*-->\n)?HNC 와 통화했다\.\n\n/m, '잇는 말이 먼저')
  assert.match(doc, /^### 원격 명령$/m, '파일의 머리는 ### 로')
  assert.match(doc, /\| 상대 \| HNC 권순용 차장 \|/, '표는 원문 그대로')
  assert.match(doc, /3초 동안 1을 쓰고 0으로 되돌린다/)
  const b = await one('HNC_통화_보탬.md', 'append', HNC.replace('3초 동안', '5초 동안'))
  assert.equal(b.state, 'done', b.msg)
  doc = fs.readFileSync(path.join(dir, 'docs', '회의록.md'), 'utf8')
  assert.match(doc, /3초 동안[\s\S]*5초 동안/, '있는 글 뒤에 보탰다')
  assert.equal((doc.match(/HNC 와 통화했다/g) || []).length, 1, '있는 글은 그대로 한 번')
  assert.doesNotMatch(doc.split('5초 동안')[0].split('3초 동안').pop(), /권순용/, '보탠 것은 「원격 명령」 아래만')
  // 사람의 세션은 from · append 를 쓰지 못한다
  const out = await makeMcp(s.hub).call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save', arguments: { knowledge: '회의셋', record: { title: 'x', body: 'y' }, sections: [{ doc: '회의록', heading: '새 항목', from: '*' }] } } }, { user: 'kim', admin: true, pc: true })
  assert.ok(out.result.isError)
  assert.match(out.result.content[0].text, /넣기 에이전트만/)
})

test('앞일은 함께 · 들이기는 한 줄: 파일 넷의 기록 정리가 셋까지 겹치고 넷 모두 들어간다 · curateIdle 은 앞일까지 기다린다', async () => {
  await s.hub.addKnowledge(ME, { kind: 'new', name: '넣기넷' })
  const spans = path.join(tmp, 'spans.log')
  process.env.FAKE_CLAUDE_READ = '20000' // 둘이 함께 돌 때까지 기다린다(차례로 돌면 20초 뒤 혼자 답한다)
  process.env.FAKE_CLAUDE_SPANS = spans
  try {
    const files = [1, 2, 3, 4].map((n) => ({ path: `통화-${n}.md`, data: Buffer.from(HNC.replace('3초', `${n + 10}초`)) }))
    const r = await s.hub.importFiles(ME, '넣기넷', files)
    await s.hub.curateIdle('넣기넷')
    const runs = r.rows.map((x) => s.hub.runGet(ME, x.run))
    assert.deepEqual(runs.map((x) => x.state), ['done', 'done', 'done', 'done'], runs.map((x) => x.msg).join(' / '))
    const ls = fs.readFileSync(spans, 'utf8').trim().split('\n')
    assert.equal(ls.filter((l) => l === 's').length, 4)
    const most = Math.max(...ls.filter((l) => l.startsWith('e ')).map((l) => Number(l.slice(2))))
    assert.ok(most >= 2 && most <= 3, `함께 돈 기록 정리 ${most}`)
    const k = await s.hub.get('넣기넷')
    assert.ok(r.rows.every((x) => k.byWork.get(x.rec).state !== 'pend'), '넷 모두 들어갔다')
  } finally {
    delete process.env.FAKE_CLAUDE_READ
    delete process.env.FAKE_CLAUDE_SPANS
  }
})
