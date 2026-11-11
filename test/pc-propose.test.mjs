// 저장 승인 PC1 — 개인 프로그램 같은 저장 문(저장 승인 설계 6-5 「개인 프로그램 특성 시험」 · P-D40 · P-D41 · P-D43 · 7-1 PC1)
//
// 개인 approve 지식 save 에 proposal 없음 = E_APPROVE + propose 결과(아무것도 안 씀) · 개인 propose 가 팀과 같은 글 · 경고 · 해시(같은 입력 · 머리 줄만 「나만 · 이 PC」) ·
// 개인 memo:true = E_INPUT · 경위만 = 들어감(글 그대로) · curateSoon 안 부름 · 「기록을 문서에 넣기」 일 줄 안 생김 · 승인한 해시 = 들어감 + 측정 줄 칸 ·
// 지문은 저장 문 한 벌(base 없음 = 저장 문의 E_CONFLICT) · 새 개인 지식 = approve(_members.md · 기록 모음) · 개인 지식은 모두 approve(P12 · 옛 길 · 이행 걷음)

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { startServer } from '../server/http.js'
import { makeMcp } from '../server/mcp.js'
import { PC_KIT_REV } from '../core/kit.js'
import { knowledgeRow } from '../server/views.js'
import { copyDir } from './helpers.mjs'
import { parseLinked } from '../core/parts.js'
import { RECORDS_DOC, RECORDS_INTRO, RECORDS_DOC_PATH } from '../core/guard.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KIM = { user: 'kim' }
let tmp, pc, team, call
const curates = []

const pdir = (id) => path.join(tmp, 'pc', id)
const snap = (d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.name !== '.git').flatMap((e) => (e.isDirectory() ? snap(path.join(d, e.name)) : [`${path.join(d, e.name)} ${fs.statSync(path.join(d, e.name)).size}`])).sort().join('|')
const recText = (id, rec) => fs.readFileSync(path.join(pdir(id), 'work', `${rec}.md`), 'utf8')
const savelogOf = (id) => fs.readFileSync(path.join(tmp, 'pcdata', 'savelog', `${encodeURIComponent(id)}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
// 기록 없는 dpms 문서 · 장부 + 기록 모음(팀 apv 와 같은 글)
const seedApv = (dir, members) => {
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), dir)
  fs.rmSync(path.join(dir, 'work'), { recursive: true, force: true })
  fs.writeFileSync(path.join(dir, 'README.md'), '# 승인 지식\n')
  if (members) fs.writeFileSync(path.join(dir, '_members.md'), members)
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-pc-propose-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  // 개인 프로그램 — dpms(표지 없는 개인 지식도 approve · P12) · apv(_members.md 「저장 방식: 승인」)
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'pc'))
  seedApv(pdir('apv'), '# 사람\n\n- 주인: kim\n- 저장 방식: 승인\n')
  fs.mkdirSync(path.dirname(path.join(pdir('apv'), ...RECORDS_DOC_PATH.split('/'))), { recursive: true })
  fs.writeFileSync(path.join(pdir('apv'), ...RECORDS_DOC_PATH.split('/')), `# ${RECORDS_DOC}\n\n${RECORDS_INTRO}\n`)
  // 켤 때의 바로 넣기(curateOnStart)는 끈다 — 저장이 거는 것만 센다
  fs.mkdirSync(path.join(tmp, 'pcdata'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'pcdata', 'serve.json'), JSON.stringify({ curateOnStart: false, decideMs: 3600000, inboxTickMs: 3600000 }))
  pc = await startServer({ root: path.join(tmp, 'pc'), data: path.join(tmp, 'pcdata'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  // 바로 넣기(curateSoon)는 걷었다(PC6) — 그 손잡이가 없다
  if (pc.hub.curateSoon || pc.hub.curatePending) throw new Error('바로 넣기가 남았다')
  const mcp = makeMcp(pc.hub)
  call = async (name, args) => (await mcp.call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, KIM)).result.structuredContent
  // 팀 — 같은 apv(총괄 관리자가 approve 로 켬 · 기록 모음을 세움)
  fs.mkdirSync(path.join(tmp, 'team'), { recursive: true })
  seedApv(path.join(tmp, 'team', 'apv'))
  team = await startServer({ root: path.join(tmp, 'team'), data: path.join(tmp, 'tdata'), port: 0, log: () => {}, scryptN: 1 << 15 })
  await team.hub.ensureRecordsDoc('apv')
})
after(async () => {
  await pc?.close()
  await team?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

const canary = async () => call('section', { knowledge: 'apv', coord: 'proc:카나리' })
const input = (base, over = {}) => ({
  knowledge: 'apv',
  record: { title: '카나리: 첫 30분 비율 20%', changes: ['첫 30분 비율: 10% → 20%'], why: ['테스트 — 비율을 올림'], touches: ['proc:카나리'] },
  sections: [{ coord: 'proc:카나리', base, edits: [{ find: '요청의 10% 만', replace: '요청의 20% 만' }] }],
  ...over,
})

test('저장 방식: 개인 지식은 모두 approve(표지 없는 지식도 · P12) · 옛 지식도 propose 를 받는다', async () => {
  assert.equal(pc.hub.saveModeOf('apv'), 'approve')
  assert.equal(pc.hub.saveModeOf('dpms'), 'approve')
  const r = await call('propose', { knowledge: 'dpms', record: { title: '헬스 체크: 주기', why: ['시험'], touches: ['proc:헬스 체크'] } })
  assert.ok(!r.error, JSON.stringify(r))
  assert.match(r.proposal, /^[0-9a-f]{64}$/)
})

test('개인 approve: proposal 없음 = E_APPROVE + propose 결과(나만 · 이 PC) · 아무것도 쓰지 않음 · 측정 줄 unproposed', async () => {
  const n0 = snap(pdir('apv'))
  const sec = await canary()
  const r = await call('save', input(sec.base))
  assert.equal(r.error, 'E_APPROVE', JSON.stringify(r))
  assert.match(r.details.propose.text, /^【저장 제안】 지식: 승인 지식\(보는 사람: 나만 · 이 PC\) · 길: 이 세션의 작업/)
  assert.match(r.details.propose.proposal, /^[0-9a-f]{64}$/)
  // 옛 판 · 판 없음 안내(reinstall · nokit)는 걷었다(P11 · PC6)
  const old = await call('save', { ...input(sec.base), kit: String(PC_KIT_REV - 1) })
  assert.deepEqual([old.error, old.details.reinstall, old.details.nokit], ['E_APPROVE', undefined, undefined])
  assert.equal(r.details.nokit, undefined)
  assert.equal(snap(pdir('apv')), n0, '아무것도 쓰지 않는다')
  const last = savelogOf('apv').at(-1)
  assert.deepEqual([last.err, last.mode, last.unproposed], ['E_APPROVE', 'approve', true])
  // 개인 화면 길(http 채널)도 사람 채널 — E_APPROVE(428)
  await assert.rejects(pc.hub.save(KIM, 'apv', { record: { title: '카나리: 비율', body: '## 바뀐 것\n- 비율: 10% → 20%', touches: ['proc:카나리'] } }, { guard: 'strict', channel: 'http' }), (e) => e.code === 'E_APPROVE' && !!e.details?.propose)
  assert.equal(snap(pdir('apv')), n0)
  assert.ok(!curates.includes('apv'), '바로 넣기를 걸지 않는다')
})

test('개인 propose = 팀 propose: 같은 입력이면 같은 글(머리 줄 빼고) · 경고 · 해시', async () => {
  const sec = await canary()
  const inp = input(sec.base)
  const { knowledge: _k, ...body } = inp
  const mine = await pc.hub.propose(KIM, 'apv', body, { form: true, path: '이 세션의 작업' })
  const theirs = await team.hub.propose({ user: 'boss', admin: true }, 'apv', body, { form: true, path: '이 세션의 작업' })
  assert.deepEqual(mine.errors, [], JSON.stringify(mine.errors))
  assert.equal(mine.proposal, theirs.proposal, '해시가 같다')
  assert.deepEqual(mine.warnings, theirs.warnings)
  assert.deepEqual(mine.text.split('\n').slice(1), theirs.text.split('\n').slice(1), '머리 줄 밖은 같은 글')
  assert.match(mine.text.split('\n')[0], /보는 사람: 나만 · 이 PC/)
  assert.doesNotMatch(theirs.text.split('\n')[0], /나만/)
  // 경고가 든 입력도 같은 경고 id
  const warn = { ...body, record: { ...body.record, title: '카나리: 비율 조정' } }
  const w1 = await pc.hub.propose(KIM, 'apv', warn, { form: true })
  const w2 = await team.hub.propose({ user: 'boss', admin: true }, 'apv', warn, { form: true })
  assert.deepEqual(w1.warnings.map((w) => w.id), w2.warnings.map((w) => w.id))
  assert.equal(w1.proposal, w2.proposal)
})

test('개인 approve: 승인한 해시로 save = 들어감(기록 + 항목 글 한 덩이 · put) · 측정 줄 칸 · 바로 넣기 안 부름', async () => {
  const sec = await canary()
  const p = await call('propose', input(sec.base))
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  const r = await call('save', { ...input(sec.base), proposal: p.proposal })
  assert.ok(r.saved, JSON.stringify(r))
  assert.equal(r.put, 1)
  assert.ok(!r.held, '넣지 못함이 없다')
  assert.match(r.note, /^저장했다\. 기록 1 · 넣음 1/)
  assert.doesNotMatch(r.note, /곧바로/)
  assert.match(fs.readFileSync(path.join(pdir('apv'), 'docs', '배포절차.md'), 'utf8'), /요청의 20% 만/)
  assert.match(recText('apv', r.saved), /^tags:\n(?: {2}- .*\n)*? {2}- put\n/m)
  const k = await pc.hub.get('apv')
  assert.equal(k.byWork.get(r.saved).state, 'in')
  const last = savelogOf('apv').at(-1)
  assert.equal(last.mode, 'approve')
  assert.ok(last.rounds >= 1, '다시 제안 수')
  assert.deepEqual([last.accepted, last.linked, last.fresh, last.err], [[], 0, 0, null])
  await pc.hub.idle('apv')
  assert.ok(!curates.includes('apv'), '바로 넣기를 걸지 않는다')
})

test('개인 approve: memo:true = E_INPUT(propose 는 memo 오류) · 아무것도 쓰지 않음', async () => {
  const n0 = snap(pdir('apv'))
  const memo = { knowledge: 'apv', record: { title: '카나리: 비율 다시 볼 것', body: '아직 정하지 않았다.', touches: ['proc:카나리'], memo: true } }
  const r = await call('save', memo)
  assert.equal(r.error, 'E_INPUT')
  assert.match(r.message, /메모/)
  const pm = await call('propose', memo)
  assert.equal(pm.error, 'E_INPUT', '제안도 memo 를 입력 오류로(P12)')
  assert.equal(snap(pdir('apv')), n0)
})

test('개인 approve: 경위만 = 들어감(글 그대로 · 이은 항목) · curateSoon 안 부름 · 「기록을 문서에 넣기」 일 줄 없음', async () => {
  const doc0 = fs.readFileSync(path.join(pdir('apv'), 'docs', '배포절차.md'), 'utf8')
  const why = { knowledge: 'apv', record: { title: '카나리: 비율을 올린 경위', why: ['장애 회고에서 김 과장이 정했다'], body: '비율을 정한 경위를 남긴다.', touches: ['proc:카나리'] } }
  const p = await call('propose', why)
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  assert.deepEqual(p.items.map((x) => x.kind), ['잇기'])
  const r = await call('save', { ...why, proposal: p.proposal })
  assert.ok(r.saved, JSON.stringify(r))
  assert.equal(r.put, 0)
  assert.match(r.note, /글 그대로 이음 1/)
  assert.equal(fs.readFileSync(path.join(pdir('apv'), 'docs', '배포절차.md'), 'utf8'), doc0, '본문 바뀜 0')
  assert.deepEqual(parseLinked(recText('apv', r.saved)), [{ doc: 'docs/배포절차.md', heading: '카나리' }])
  const k = await pc.hub.get('apv')
  assert.equal(k.byWork.get(r.saved).state, 'in', '들어감(pend 가 아니다)')
  await pc.hub.idle('apv')
  assert.ok(!curates.includes('apv'))
  assert.doesNotMatch(JSON.stringify(await pc.hub.queueList(KIM)), /기록을 문서에 넣기/)
  const sec = await canary()
  assert.ok(sec.history.some((x) => x.id === r.saved && x.state === '문서에 들어감'), JSON.stringify(sec.history))
})

test('지문은 저장 문 한 벌: approve 개인 지식에 base 없는 고침 = 저장 문의 E_CONFLICT(+ propose)', async () => {
  const sec = await canary()
  const r = await call('save', { knowledge: 'apv', record: { title: '카나리: 비율 30%', changes: ['첫 30분 비율: 20% → 30%'], touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', content: sec.content.replace('요청의 20% 만', '요청의 30% 만') }], proposal: 'a'.repeat(64) })
  assert.equal(r.error, 'E_CONFLICT', JSON.stringify(r))
  assert.ok(r.details?.propose, '저장 문이 새 propose 결과를 싣는다')
  assert.doesNotMatch(r.message, /이미 있는 항목이다/)
})

test('새 개인 지식 = approve: _members.md 「저장 방식: 승인」 · 기록 모음을 같이 세워 한 커밋 · proposal 없음 = E_APPROVE', async () => {
  const made = await pc.hub.addKnowledge(KIM, { kind: 'new', name: '테스트 새 개인' })
  assert.equal(pc.hub.saveModeOf(made.id), 'approve')
  const d = made.dir
  assert.match(fs.readFileSync(path.join(d, '_members.md'), 'utf8'), /^- 저장 방식: 승인$/m)
  assert.ok(fs.existsSync(path.join(d, ...RECORDS_DOC_PATH.split('/'))), '기록 모음')
  const tracked = execFileSync('git', ['-c', 'core.quotepath=false', '-C', d, 'ls-files'], { encoding: 'utf8' }).split('\n')
  for (const f of ['_members.md', RECORDS_DOC_PATH, 'README.md', 'docs/처음.md']) assert.ok(tracked.includes(f), `${f} 커밋`)
  assert.equal(execFileSync('git', ['-C', d, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '')
  const r = await call('save', { knowledge: made.id, record: { title: '개요: 첫 글', why: ['시험'], touches: [] , touchesEmpty: '시험' } })
  assert.equal(r.error, 'E_APPROVE', JSON.stringify(r))
  // touchesEmpty = 기록 모음 달 항목(개인 지식도 같다)
  const p = await call('propose', { knowledge: made.id, record: { title: '주간 회의: 다음 주 쉼', why: ['명절'], body: '다음 주 회의는 쉰다.', touchesEmpty: '항목이 아직 없는 일정 메모' } })
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  assert.equal(p.items[0].doc, 'docs/기록 모음.md')
  const s = await call('save', { knowledge: made.id, record: { title: '주간 회의: 다음 주 쉼', why: ['명절'], body: '다음 주 회의는 쉰다.', touchesEmpty: '항목이 아직 없는 일정 메모' }, proposal: p.proposal })
  assert.ok(s.saved, JSON.stringify(s))
  assert.match(fs.readFileSync(path.join(d, ...RECORDS_DOC_PATH.split('/')), 'utf8'), new RegExp(`^## ${p.items[0].heading}$`, 'm'))
  await pc.hub.idle(made.id)
  assert.ok(!curates.includes(made.id), '새 개인 지식은 바로 넣기를 걸지 않는다')
})

test('개인 화면 길(http 채널)도 승인한 제안이면 들어감 · 표지를 손으로 지워도 approve(P12)', async () => {
  const sec = await canary()
  const body = { record: { title: '카나리: 첫 30분 비율 25%', body: ['## 바뀐 것', '- 첫 30분 비율: 20% → 25%'].join('\n'), touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', base: sec.base, edits: [{ find: '요청의 20% 만', replace: '요청의 25% 만' }] }] }
  const p = await pc.hub.propose(KIM, 'apv', body, { path: '화면' })
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  assert.match(p.text, /^【저장 제안】 .* · 길: 화면/)
  const r = await pc.hub.save(KIM, 'apv', { ...body, proposal: p.proposal }, { guard: 'strict', channel: 'http' })
  assert.equal(r.put, 1, JSON.stringify(r))
  assert.ok(!curates.includes('apv'))
  // 표지 — _members.md 의 줄과 상관없이 늘 approve(옛 길은 걷었다)
  const mf = path.join(pdir('apv'), '_members.md')
  const keep = fs.readFileSync(mf, 'utf8')
  try {
    fs.writeFileSync(mf, ['# 사람', '', '- 주인: kim', ''].join('\n'))
    assert.equal(pc.hub.saveModeOf('apv'), 'approve')
  } finally { fs.writeFileSync(mf, keep) }
})

test('새 개인 지식: 사람 칸에 주인 · Claude 줄이 없다 · 주인 · 자리 고침이 저장 방식 표지를 지우지 않는다 · 빈 지식은 기록 모음을 세지 않는다', async () => {
  const made = await pc.hub.addKnowledge(KIM, { kind: 'new', name: '테스트 사람 칸', empty: true })
  const mf = path.join(made.dir, '_members.md')
  assert.equal(fs.readFileSync(mf, 'utf8'), ['# 사람', '', '- 저장 방식: 승인', ''].join('\n'))
  await pc.hub.setOwner(KIM, made.id, { curators: ['kim'] })
  assert.match(fs.readFileSync(mf, 'utf8'), /^- 저장 방식: 승인$/m, '주인 · 지식관리자 고침 뒤에도')
  assert.equal(pc.hub.saveModeOf(made.id), 'approve')
  assert.equal(knowledgeRow(await pc.hub.get(made.id)).docs, 0, '빈 지식(기록 모음은 세지 않는다)')
})
