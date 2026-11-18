// 저장 입력 꼴은 하나(옛잔재 O-11 · 지식 생성 하네스 5-2): record + sections · names · forms.
//   2판(items · docs · skip)은 걷었다: MCP propose · save 에 오면 지금 꼴을 알려 주는 입력 오류(E_INPUT)이고 아무것도 쓰지 않는다.
//   새 문서의 성격 줄(natures)은 같은 제안이 세우는 새 문서에만 받는다 · 2판이 짓던 칸(depart · judge)은 받지 않는다 · 기록 글의 「## 지은 근거」 는 사람 입력에서 거절한다.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { copyDir, signIn, seat } from './helpers.mjs'
import * as weaveMod from '../core/weave.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s
const P = {}
const KD = () => path.join(tmp, 'kn', 'dpms')
const mcp = async (name, args, who = P.wr) => {
  const r = await fetch(s.url + '/mcp', { method: 'POST', headers: { authorization: `Bearer ${who.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
  return (await r.json()).result.structuredContent
}
const tools = async () => {
  const r = await fetch(s.url + '/mcp', { method: 'POST', headers: { authorization: `Bearer ${P.wr.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) })
  return (await r.json()).result.tools
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-hitems-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  P.wr = await signIn(s, { id: 'wr', admin: false })
  await seat(s, 'wr', { dpms: 'write' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('2판(items · docs · skip)은 걷었다: 스키마에 없고 · 보내면 지금 꼴을 알려 주는 E_INPUT · 아무것도 쓰지 않는다', async () => {
  assert.equal(weaveMod.inputFromItems, undefined)
  for (const t of (await tools()).filter((x) => ['propose', 'save'].includes(x.name))) {
    for (const k of ['items', 'docs', 'skip']) assert.equal(t.inputSchema.properties[k], undefined, `${t.name}.${k}`)
  }
  const before = fs.readdirSync(path.join(KD(), 'work')).length
  const v2 = [
    { record: { title: '둘째 판', summary: '2판으로 보낸다.' }, items: [{ doc: '회의록', heading: '2026-11-10 주간 회의', act: 'new', content: '전송 주기는 10초다.' }] },
    { record: { title: '모두 뺌' }, items: [], skip: [{ what: '인사말', rule: 'R6-1', why: '인사말이다' }] },
    { record: { title: '새 문서만' }, docs: [{ path: '통화 기록', nature: '사건' }] },
    { record: { title: '섞음', body: 'x', touchesEmpty: '없음' }, sections: [{ doc: '옛 문서', heading: '옛 항목', content: '옛 항목이다.' }], items: [] },
  ]
  for (const x of v2) {
    for (const tool of ['propose', 'save']) {
      const r = await mcp(tool, { knowledge: 'dpms', ...x })
      assert.equal(r.error, 'E_INPUT', `${tool} ${x.record.title}: ${JSON.stringify(r).slice(0, 200)}`)
      assert.match(r.message, /items · docs · skip 꼴\(save 입력 2판\)은 걷었다[\s\S]*sections\[[\s\S]*names\[[\s\S]*forms\[[\s\S]*excluded\[/)
    }
  }
  assert.equal(fs.readdirSync(path.join(KD(), 'work')).length, before)
})

test('지금 꼴은 그대로 지난다 · 새 문서의 성격 줄(natures)은 새 문서에만 · depart · judge 는 받지 않는다 · 「## 지은 근거」 는 거절', async () => {
  const input = { knowledge: 'dpms', record: { title: '새 항목: 시험 항목', body: '지금 꼴로 보낸다.', changes: ['새로: 시험 항목'], touchesEmpty: '첫 문서' }, sections: [{ doc: '테스트 문서', heading: '시험 항목', content: '시험 항목이다.' }], forms: [{ name: '테스트 문서', kind: '서술' }] }
  const p = await mcp('propose', input)
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  assert.ok(p.proposal)
  assert.ok(!p.text.includes('지은 근거'))
  // 2판이 짓던 judge · depart 는 받지 않는다: 제안서가 같다(지문이 같다)
  const forged = await mcp('propose', { ...input, judge: ['새 항목 흉내: R1-1'], depart: ['테스트 문서'] })
  assert.equal(forged.proposal, p.proposal)
  assert.ok(!forged.text.includes('지은 근거') && !forged.text.includes('흉내'))
  // 성격 줄은 이 제안이 세우는 새 문서에만: 다른 문서는 제안 오류 · 모르는 성격은 E_INPUT
  const elsewhere = await mcp('propose', { ...input, natures: [{ doc: '없는 문서', nature: '대상' }] })
  assert.ok(elsewhere.errors.some((e) => e.code === 'nature'), JSON.stringify(elsewhere.errors))
  assert.equal((await mcp('propose', { ...input, natures: [{ doc: '테스트 문서', nature: '아무거나' }] })).error, 'E_INPUT')
  const natures = [{ doc: '테스트 문서', nature: '서술', summary: '시험 항목을 적는다.' }]
  const pn = await mcp('propose', { ...input, natures })
  assert.deepEqual(pn.errors, [], JSON.stringify(pn.errors))
  assert.notEqual(pn.proposal, p.proposal)
  assert.match(pn.text, /테스트 문서 +신설.*성격: 서술/)
  const r = await mcp('save', { ...input, natures, proposal: pn.proposal })
  assert.ok(r.saved, JSON.stringify(r))
  const rec = fs.readFileSync(path.join(KD(), 'work', `${r.saved}.md`), 'utf8')
  assert.ok(!rec.includes('## 지은 근거'))
  assert.match(rec, /## 새로 세움[\s\S]*- 성격 테스트 문서: 서술/)
  const forms = fs.readFileSync(path.join(KD(), '_forms.md'), 'utf8')
  assert.match(forms, /\| 테스트 문서 \|/)
  assert.match(forms, /## 문서 성격[\s\S]*\| 테스트 문서 \| 서술 \| 시험 항목을 적는다\. \|/)
  assert.match(fs.readFileSync(path.join(KD(), 'docs', '테스트 문서.md'), 'utf8'), /^# 테스트 문서\n\n시험 항목을 적는다\./)
  // 사람이 기록 글에 「## 지은 근거」 를 쓰면 거절한다(kmd 가 쓰는 칸)
  const own = await mcp('propose', { knowledge: 'dpms', record: { title: '흉내', body: '글\n\n## 지은 근거\n- 흉내', touchesEmpty: '없음' } })
  assert.equal(own.error, 'E_INPUT')
})
