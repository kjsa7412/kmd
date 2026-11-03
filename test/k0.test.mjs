// K0 필수 — 지식 하나를 띄워 화면 자료로 문서를 읽고, MCP save 로 기록이 git 에 한 묶음으로 남는다.
//
// 서버는 이 시험 안에서 빈 포트 · 임시 폴더로 띄우고 끝나면 끈다. HOME · APPDATA 도 임시로 돌린다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { copyDir, signIn } from './helpers.mjs'
import { TEAM_KIT_REV } from '../core/teamkit.js'

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture', 'kmd')
let tmp, s, me

const j = async (p, body, headers = {}) => {
  const auth = p === '/mcp' ? { authorization: `Bearer ${me.key}` } : { cookie: me.cookie }
  const r = await fetch(s.url + p, body ? { method: 'POST', headers: { 'content-type': 'application/json', ...auth, ...headers }, body: JSON.stringify(body) } : { headers: auth })
  return { status: r.status, body: await r.json() }
}
let rpcId = 0
const rpc = async (method, params) => (await j('/mcp', { jsonrpc: '2.0', id: ++rpcId, method, params })).body
const tool = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result
const git = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: path.join(tmp, 'kn', 'dpms'), encoding: 'utf8' })

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-k0-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  copyDir(FIX, path.join(tmp, 'kn'))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {} })
  me = await signIn(s, { id: 'kim' })
})
after(async () => {
  await s?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('화면 자료: 지식 목록 · 나무 · 문서 한 장', async () => {
  const ks = (await j('/api/knowledge')).body
  assert.deepEqual(ks.map((k) => [k.id, k.name, k.docs, k.records, k.pend]), [['dpms', 'DPMS 지식', 17, 15, 1], ['gdi', 'GDI 지식', 5, 0, 0]])
  const tr = (await j('/api/k/dpms/tree')).body
  assert.equal(tr.records.filter((r) => r.state === 'pend').length, 1)
  assert.deepEqual(tr.atts.sort(), ['배포 흐름.png', '운영 대시보드.png'])
  const d = (await j('/api/k/dpms/doc?d=' + encodeURIComponent('배포절차'))).body
  assert.deepEqual(d.sections.map((x) => x.h), ['준비', '카나리', '헬스 체크', '롤백', '꾸러미 판'])
  assert.equal(d.sections[3].pend.length, 1, '롤백에 아직 안 넣은 기록 1')
  assert.match(d.sections[3].html, /data-a="openDoc" data-k="dpms" data-d="롤백절차"/, '문서 링크는 화면 안에서 연다')
  assert.match(d.sections[4].html, /<table class="t">/)
  assert.deepEqual(d.links.map((x) => x.id).sort(), ['롤백절차', '서버목록'])
  assert.equal((await j('/api/k/dpms/doc?d=없는문서')).status, 404)
})

test('MCP: 도구 · brief · match · section', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })
  assert.equal(init.result.serverInfo.name, 'kmd')
  assert.equal(init.result.protocolVersion, '2025-06-18')
  assert.deepEqual((await rpc('tools/list')).result.tools.map((t) => t.name), ['brief', 'match', 'search', 'section', 'save'])
  const b = (await tool('brief', {})).structuredContent
  assert.equal(b.knowledge.length, 2)
  // 팀 서버의 스킬 판 · 지식마다 내 안 넣은 메모 · 넣지 못함 수(S6 · 스킬 kmd-team-work 1단계가 한 줄로 전한다)
  assert.equal(b.kit, TEAM_KIT_REV)
  assert.deepEqual(b.knowledge.map((k) => k.mine), [{ memos: 0, held: 0 }, { memos: 0, held: 0 }])
  const list = (await rpc('tools/list')).result.tools
  assert.match(list.find((t) => t.name === 'brief').description, /mine\(.*안 넣은 메모 memos · 넣지 못함 held/)
  assert.ok(list.find((t) => t.name === 'save').inputSchema.properties.kit, 'save 에 스킬 판 칸')
  const one = (await tool('brief', { knowledge: 'dpms' })).structuredContent
  assert.deepEqual([one.kit, one.you.memos, one.you.held, one.you.recent], [TEAM_KIT_REV, 0, 0, []])
  const m = (await tool('match', { q: '상태 점검' })).structuredContent
  assert.equal(m.found[0].coord, 'proc:헬스 체크', '다른 이름으로도 찾는다')
  assert.equal(m.found[0].doc, '배포절차')
  const sec = (await tool('section', { knowledge: 'dpms', coord: 'proc:롤백' })).structuredContent
  assert.match(sec.content, /DB 를 먼저 되돌리고/)
  assert.equal(sec.notYetInDocs.length, 1)
})

test('MCP save: 기록 글은 서식 칸으로 · 팀 지식은 검사를 넘은 항목 조각이 기록과 한 묶음으로 문서에(지식관리자도 같은 저장 문) · 섞인 자리는 넣지 못함 · 나쁜 입력은 아무것도 안 쓴다', async () => {
  // 이미 있는 항목을 고치려면 section 이 준 base 를 같이(그사이 남이 고친 글을 덮지 않게)
  const base = (await tool('section', { knowledge: 'dpms', coord: 'proc:카나리' })).structuredContent.base
  const r = await tool('save', {
    knowledge: 'dpms',
    record: { title: '카나리 비율: 20% 로 올린다', body: '카나리 첫 30분 비율을 올린다.', changes: ['첫 30분 비율: 10% → 20%'], why: ['10% 로는 오류를 늦게 본다.'], touches: ['proc:카나리'] },
    sections: [{ coord: 'proc:카나리', base, edits: [{ find: '요청의 10% 만', replace: '요청의 20% 만' }] }],
  })
  assert.ok(!r.isError, JSON.stringify(r.structuredContent))
  const out = r.structuredContent
  const id = out.saved
  assert.deepEqual(out.docs, ['배포절차'], '검사를 넘은 조각은 그 순간 문서에')
  assert.match(out.note, /저장했다\. 기록 1 · 넣음 1 · 넣지 못함 0/)
  assert.equal(out.reinstall?.want, TEAM_KIT_REV, '스킬 판(kit) 없이 온 세션 저장: 저장은 하고 다시 설치 안내(S6)')
  assert.equal(out.proposals[0].ok, true, out.proposals[0].why)
  assert.equal(out.proposals[0].applied, true)
  assert.match(out.proposals[0].changed[0].from, /10%/)
  const dir = path.join(tmp, 'kn', 'dpms')
  const w = fs.readFileSync(path.join(dir, 'work', `${id}.md`), 'utf8')
  assert.match(w, /^---\nid: /)
  assert.match(w, /author: kim/)
  assert.match(w, /카나리 첫 30분 비율을 올린다\.\n\n## 바뀐 것\n- 첫 30분 비율: 10% → 20%\n\n## 까닭\n- 10% 로는/, '칸마다 머리를 달아 엮는다')
  assert.match(w, /## 넣은 것\n- docs\/배포절차\.md › 카나리: 10% → 20%/, '넣은 항목 · 옛 값 → 새 값')
  const doc = fs.readFileSync(path.join(dir, 'docs', '배포절차.md'), 'utf8')
  assert.match(doc, new RegExp(`<!-- applied: ${id} -->\\n\`canary-1\` 에 먼저 올리고, 첫 30분은 요청의 20% 만`))
  const log = git('log', '--format=%an|%s').trim().split('\n')
  assert.equal(log.length, 2, '처음 묶음 + 저장 한 묶음')
  assert.equal(log[0], 'kim|카나리 비율: 20% 로 올린다')
  assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort(), ['docs/배포절차.md', `work/${id}.md`], '기록과 문서가 한 묶음')
  assert.equal(git('status', '--porcelain').trim(), '')
  // 화면 자료도 바로 바뀐다 — 문서에 들어감
  const tr = (await j('/api/k/dpms/tree')).body
  assert.equal(tr.records.find((x) => x.id === id).state, 'in')
  // 섞인 자리 — 롤백에는 아직 안 들어간 개편 전 기록이 있다: 기록은 남고 그 조각은 넣지 못함(문서는 그대로)
  const rb = (await tool('section', { knowledge: 'dpms', coord: 'proc:롤백' })).structuredContent
  const mix = (await tool('save', { knowledge: 'dpms', record: { title: '롤백 순서: 앱 먼저 내린다', body: '앱을 먼저 내린다.', changes: ['롤백 순서: DB 먼저 → 앱 먼저'], touches: ['proc:롤백'] }, sections: [{ coord: 'proc:롤백', content: '앱을 먼저 이전 판으로 내리고, 그다음 DB 를 되돌린다.', base: rb.base }] })).structuredContent
  assert.deepEqual(mix.docs, [])
  assert.match(mix.note, /넣음 0 · 넣지 못함 1/)
  assert.equal(mix.held[0].code, 'legacy-mix')
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'docs', '배포절차.md'), 'utf8'), /앱을 먼저 이전 판으로 내리고/, '문서는 그대로')
  assert.equal((await j('/api/k/dpms/tree')).body.records.find((x) => x.id === mix.saved).state, 'held')
  const n0 = git('log', '--format=%s').trim().split('\n').length
  const prose = await tool('save', { knowledge: 'dpms', record: { title: '줄글', body: '앱을 먼저 내린다.', touches: ['proc:롤백'] } })
  assert.equal(prose.structuredContent.error, 'E_INPUT', '서식 칸(바뀐 것) 없는 줄글은 받지 않는다')
  const long = await tool('save', { knowledge: 'dpms', record: { title: '긴 요약', body: '가.\n\n나.', changes: ['x'], touches: ['proc:롤백'] } })
  assert.equal(long.structuredContent.error, 'E_INPUT', '요약은 문단 하나')

  const bad = await tool('save', { knowledge: 'dpms', record: { title: '두 줄\nid: 가짜', body: 'x' } })
  assert.equal(bad.isError, true)
  assert.equal(bad.structuredContent.error, 'E_INPUT')
  const nowhere = await tool('save', { knowledge: 'dpms', record: { title: '자리 없음', changes: ['x'] }, sections: [{ coord: 'proc:없는것', content: 'y' }] })
  assert.equal(nowhere.structuredContent.error, 'E_NOTFOUND')
  assert.equal(git('log', '--format=%s').trim().split('\n').length, n0, '실패한 저장은 묶음 0')
  assert.equal(git('status', '--porcelain').trim(), '', '실패한 저장은 파일도 남기지 않는다')

  const evil = await j('/mcp', { jsonrpc: '2.0', id: 99, method: 'tools/list' }, { origin: 'http://evil.example' })
  assert.equal(evil.status, 403, '다른 곳의 화면에서 온 쓰기는 받지 않는다')
})
