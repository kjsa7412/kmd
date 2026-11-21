// 저장 승인 P3 — approve 모드 특성 시험(저장 승인 설계 6-5 「먼저 더하는 특성 시험」 · 3절 · P-D5 · P-D12 · P-D16 · P-D17 · P-D29 · P-D34)
//
// 모든 지식이 approve(dpms · apv) · 결과 = 들어감 하나 + 입력 오류(아무것도 안 씀) · proposal 없음 = E_APPROVE + propose 결과 ·
// 해시 어긋남 = E_APPROVE · 대화 조절 뒤 마지막 해시만 · 경고를 그대로 승인 = 들어감 + 「## 받아들인 경고」 · 옛 키트 · 키트 없음 = E_APPROVE(안내 없음) ·
// memo = E_INPUT · 경위만 = 들어감(글 그대로 · 이력) · 바뀐 것 값이 본문에 없음 = 오류 · touchesEmpty = 기록 모음 달 항목 · ingest/ 위조 = E_INPUT ·
// 쓰기 자리 새 문서 · fresh 는 14일 뒤 떨어짐 · 새 지식 = approve · 저장 방식 스위치(총괄 관리자 · 이행 먼저) · 측정 줄 · 하루 요약

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { copyDir, signIn, seat } from './helpers.mjs'
import { TEAM_KIT_REV } from '../core/teamkit.js'
import { freshItems, parseAccepted, parseLinked, parseFresh, KMD_PART_RE } from '../core/parts.js'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileToMd } from '../core/importer.js'
import { makeMcp } from '../server/mcp.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s
const P = {}
const KIT = String(TEAM_KIT_REV)

const req = async (p, who, body) => {
  const r = await fetch(s.url + p, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${who.key}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, j: await r.json().catch(() => null) }
}
const mcp = async (name, args, who = P.wr) => (await req('/mcp', who, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).j.result.structuredContent
const kdir = (id) => path.join(tmp, 'kn', id)
const snap = (d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.name !== '.git').flatMap((e) => (e.isDirectory() ? snap(path.join(d, e.name)) : [`${path.join(d, e.name)} ${fs.statSync(path.join(d, e.name)).size}`])).sort().join('|')
const works = (id) => (fs.existsSync(path.join(kdir(id), 'work')) ? fs.readdirSync(path.join(kdir(id), 'work')) : [])
const recText = (id, rec) => fs.readFileSync(path.join(kdir(id), 'work', `${rec}.md`), 'utf8')
const savelogOf = (id) => fs.readFileSync(path.join(tmp, 'data', 'savelog', `${encodeURIComponent(id)}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l))

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-approve-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  // apv — dpms 의 문서 · 장부만(기록 없음 = 이행할 것이 없는 지식)
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), kdir('apv'))
  fs.rmSync(path.join(kdir('apv'), 'work'), { recursive: true, force: true })
  fs.writeFileSync(path.join(kdir('apv'), 'README.md'), '# 승인 지식\n')
  s = await startServer({ root: path.join(tmp, 'kn'), data: path.join(tmp, 'data'), port: 0, log: () => {}, scryptN: 1 << 15 })
  P.boss = await signIn(s, { id: 'boss', admin: true })
  for (const id of ['wr', 'rd']) P[id] = await signIn(s, { id, admin: false })
  await seat(s, 'wr', { dpms: 'write', apv: 'write' })
  await seat(s, 'rd', { dpms: 'read', apv: 'read' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

const canary = async (kn = 'apv') => mcp('section', { knowledge: kn, coord: 'proc:카나리' })
const input = (base, over = {}) => ({
  knowledge: 'apv',
  record: { title: '카나리: 첫 30분 비율 20%', changes: ['첫 30분 비율: 10% → 20%'], why: ['테스트 — 비율을 올림'], touches: ['proc:카나리'] },
  sections: [{ coord: 'proc:카나리', base, edits: [{ find: '요청의 10% 만', replace: '요청의 20% 만' }] }],
  ...over,
})
// propose → save(proposal) 한 번에
const approved = async (inp, who = P.wr) => {
  const p = await mcp('propose', inp, who)
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  return { p, r: await mcp('save', { ...inp, proposal: p.proposal, kit: KIT }, who) }
}

test('모든 팀 지식 = approve(P11): 옛 지식도 proposal 없이 저장하면 E_APPROVE · 메모 = E_INPUT · 걸린 항목은 넣지 못함이 아니라 제안 오류(아무것도 쓰지 않음)', async () => {
  const n0 = snap(kdir('dpms'))
  const sec = await canary('dpms')
  const no = await mcp('save', { ...input(sec.base), knowledge: 'dpms', kit: KIT })
  assert.equal(no.error, 'E_APPROVE', JSON.stringify(no))
  const memo = await mcp('save', { knowledge: 'dpms', kit: KIT, record: { title: '카나리: 비율 다시 볼 것', body: '아직 정하지 않았다.', touches: ['proc:카나리'], memo: true } })
  assert.equal(memo.error, 'E_INPUT', JSON.stringify(memo))
  assert.equal(snap(kdir('dpms')), n0, '아무것도 쓰지 않는다')
})

test('approve: proposal 없음 = E_APPROVE + propose 결과 · 아무것도 쓰지 않음 · 측정 줄 unproposed', async () => {
  const n0 = snap(kdir('apv'))
  const sec = await canary()
  const r = await mcp('save', { ...input(sec.base), kit: KIT })
  assert.equal(r.error, 'E_APPROVE', JSON.stringify(r))
  assert.match(r.details.propose.text, /^【저장 제안】 지식: .* · 길: 이 세션의 작업/)
  assert.match(r.details.propose.proposal, /^[0-9a-f]{64}$/)
  assert.equal(snap(kdir('apv')), n0, '아무것도 쓰지 않는다')
  const last = savelogOf('apv').at(-1)
  assert.deepEqual([last.err, last.mode, last.unproposed], ['E_APPROVE', 'approve', true])
  // 화면 길도 사람 채널 — 428
  const h = await req('/api/k/apv/save', P.wr, { record: { title: '카나리: 비율', body: '## 바뀐 것\n- 비율: 10% → 20%', touches: ['proc:카나리'] } })
  assert.equal(h.status, 428)
  assert.equal(h.j.error, 'E_APPROVE')
})

test('approve: 승인한 해시로 save = 들어감(기록 + 항목 글 한 덩이 · put) · 대화 조절 뒤 마지막 해시만 · 앞 해시 = E_APPROVE', async () => {
  const sec = await canary()
  const first = await mcp('propose', input(sec.base))
  const changed = input(sec.base, { record: { ...input().record, why: ['테스트 — 비율을 올림 · 김 과장이 정함'] } })
  const second = await mcp('propose', changed)
  assert.notEqual(first.proposal, second.proposal)
  const old = await mcp('save', { ...changed, proposal: first.proposal, kit: KIT })
  assert.equal(old.error, 'E_APPROVE', '앞 해시로는 넣지 않는다')
  assert.equal(old.details.propose.proposal, second.proposal, '새 propose 결과를 싣는다')
  // 채널 평가 P18 — 어긋남 측정 표지: 바뀐 쪽(지문은 같다 → 입력) · 해시 앞 8자
  assert.deepEqual(savelogOf('apv').at(-1).approve, { miss: 'hash', side: 'input', got: first.proposal.slice(0, 8), now: second.proposal.slice(0, 8) })
  const r = await mcp('save', { ...changed, proposal: second.proposal, kit: KIT })
  assert.ok(r.saved, JSON.stringify(r))
  assert.equal(r.put, 1)
  assert.ok(!r.held, '넣지 못함이 없다')
  assert.match(fs.readFileSync(path.join(kdir('apv'), 'docs', '배포절차.md'), 'utf8'), /요청의 20% 만/)
  const body = recText('apv', r.saved)
  assert.match(body, /^tags:\n(?: {2}- .*\n)*? {2}- put\n/m)
  assert.ok(!/## 받아들인 경고/.test(body), '경고가 없으면 칸이 없다')
  const last = savelogOf('apv').at(-1)
  assert.equal(last.mode, 'approve')
  assert.equal(last.rounds, 2, '다시 제안 수')
  assert.deepEqual(last.accepted, [])
})

test('approve: 경고가 든 제안서를 그대로 승인 = 들어감 + 「## 받아들인 경고」 · brief mine.accepted', async () => {
  const sec = await canary()
  // 기록은 30% 라고 하고 글에는 25% — 빠진 값 · 지어낸 값(경고)
  const inp = input(sec.base, { record: { ...input().record, title: '카나리: 비율 30%', changes: ['첫 30분 비율: 20% → 30%'] }, sections: [{ coord: 'proc:카나리', base: sec.base, edits: [{ find: '요청의 20% 만', replace: '요청의 30% 만 · 그 다음 25%' }] }] })
  const p = await mcp('propose', inp)
  assert.deepEqual(p.errors, [])
  assert.ok(p.warnings.length >= 1, JSON.stringify(p.warnings))
  const r = await mcp('save', { ...inp, proposal: p.proposal, kit: KIT })
  assert.ok(r.saved, JSON.stringify(r))
  const acc = parseAccepted(recText('apv', r.saved))
  assert.deepEqual(acc.map((w) => w.id), p.warnings.map((w) => w.id))
  assert.match(r.note, /받아들인 경고/)
  const b = await mcp('brief', { knowledge: 'apv' })
  assert.ok((b.you?.accepted ?? b.knowledge?.find((x) => x.id === 'apv')?.mine?.accepted) >= 1, JSON.stringify(b.you || b.knowledge))
  assert.deepEqual(savelogOf('apv').at(-1).accepted.sort(), p.warnings.map((w) => w.code).sort())
})

test('approve: 옛 키트 · 키트 없음 = E_APPROVE(옛 판 안내 reinstall · nokit 은 걷었다 · P11) · memo = E_INPUT', async () => {
  const sec = await canary()
  const old = await mcp('save', { ...input(sec.base), kit: String(TEAM_KIT_REV - 1) })
  assert.deepEqual([old.error, old.details.reinstall, old.details.nokit], ['E_APPROVE', undefined, undefined])
  const none = await mcp('save', input(sec.base))
  assert.deepEqual([none.error, none.details.nokit], ['E_APPROVE', undefined])
  const memo = await mcp('save', { knowledge: 'apv', kit: KIT, record: { title: '카나리: 비율 다시 볼 것', body: '아직 정하지 않았다.', touches: ['proc:카나리'], memo: true } })
  assert.equal(memo.error, 'E_INPUT')
  assert.match(memo.message, /메모/)
  const pm = await mcp('propose', { knowledge: 'apv', record: { title: '카나리: 비율 다시 볼 것', body: '아직 정하지 않았다.', touches: ['proc:카나리'], memo: true } })
  assert.equal(pm.error, 'E_INPUT', '제안도 memo 를 입력 오류로(P12)')
})

test('approve: 경위만 기록 = 들어감(글 그대로 · 이은 항목 · 이력) · 바뀐 것 값이 본문에 없으면 오류', async () => {
  const doc0 = fs.readFileSync(path.join(kdir('apv'), 'docs', '배포절차.md'), 'utf8')
  const why = { knowledge: 'apv', record: { title: '카나리: 비율을 올린 경위', why: ['장애 회고에서 김 과장이 정했다'], body: '비율을 정한 경위를 남긴다.', touches: ['proc:카나리'] } }
  const p = await mcp('propose', why)
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  assert.deepEqual(p.items.map((x) => x.kind), ['잇기'])
  const r = await mcp('save', { ...why, proposal: p.proposal, kit: KIT })
  assert.ok(r.saved, JSON.stringify(r))
  assert.equal(r.put, 0)
  assert.equal(fs.readFileSync(path.join(kdir('apv'), 'docs', '배포절차.md'), 'utf8'), doc0, '본문 바뀜 0')
  assert.deepEqual(parseLinked(recText('apv', r.saved)), [{ doc: 'docs/배포절차.md', heading: '카나리' }])
  const sec = await canary()
  assert.ok(sec.history.some((x) => x.id === r.saved && x.state === '문서에 들어감'), JSON.stringify(sec.history))
  const t = await req('/api/k/apv/tree', P.wr)
  assert.equal(t.j.records.find((x) => x.id === r.saved)?.state, 'in', '들어감')
  // 값이 있는데 고칠 항목이 없다 — 오류(사람 채널)
  const val = { knowledge: 'apv', record: { title: '카나리: 비율 50%', changes: ['첫 30분 비율: 30% → 50%'], touches: ['proc:카나리'] } }
  const pv = await mcp('propose', val)
  assert.deepEqual(pv.errors.map((e) => e.code), ['unreflected'])
  assert.equal(pv.proposal, null)
  const sv = await mcp('save', { ...val, proposal: p.proposal, kit: KIT })
  assert.equal(sv.error, 'E_INPUT')
  // 같은 값이 이은 항목의 지금 글에 다른 뜻으로 이미 있어도(오류율 「1%」) 고칠 항목이 없으면 막는다: 이은 항목은 값을 바꾸지 않은 관련 항목이다
  //   (2026-11-18 DPMS 「설계 문서 6종」: 바뀐 것 5 · 30초 · 365일 이 잇기 항목들의 다른 줄에 있어 기록만 들어갔다)
  assert.match(fs.readFileSync(path.join(kdir('apv'), 'docs', '배포절차.md'), 'utf8'), /오류율이 1% 를 넘으면/)
  const n1 = snap(kdir('apv'))
  const same = { knowledge: 'apv', record: { title: '카나리: 첫 30분 비율 1%', changes: ['첫 30분 비율: 30% → 1%'], touches: ['proc:카나리'] } }
  const ps = await mcp('propose', same)
  assert.deepEqual(ps.errors.map((e) => e.code), ['unreflected'], JSON.stringify(ps.errors))
  assert.equal(ps.proposal, null)
  const ss = await mcp('save', { ...same, proposal: p.proposal, kit: KIT })
  assert.equal(ss.error, 'E_INPUT')
  assert.equal(snap(kdir('apv')), n1, '아무것도 쓰지 않는다')
})

test('approve: touchesEmpty = 기록 모음 달 항목(없으면 저장 문이 세움) · 두 번째는 잇기만', async () => {
  const rec = { knowledge: 'apv', record: { title: '주간 회의: 다음 주 쉼', why: ['명절'], body: '다음 주 회의는 쉰다.', touchesEmpty: '항목이 아직 없는 일정 메모' } }
  const p = await mcp('propose', rec)
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  const month = p.items[0].heading
  assert.match(month, /^\d{4}-\d{2}$/)
  assert.equal(p.items[0].doc, 'docs/기록 모음.md')
  assert.match(p.text, /기록 모음 › \d{4}-\d{2} {3}잇기 {3}\(항목이 아직 없음\)/)
  const r = await mcp('save', { ...rec, proposal: p.proposal, kit: KIT })
  assert.ok(r.saved, JSON.stringify(r))
  const doc = fs.readFileSync(path.join(kdir('apv'), 'docs', '기록 모음.md'), 'utf8')
  assert.match(doc, new RegExp(`## ${month}\\n`))
  const rec2 = { ...rec, record: { ...rec.record, title: '주간 회의: 그다음 주는 연다' } }
  const p2 = await mcp('propose', rec2)
  const r2 = await mcp('save', { ...rec2, proposal: p2.proposal, kit: KIT })
  assert.equal(r2.put, 0)
  assert.deepEqual(parseLinked(recText('apv', r2.saved)), [{ doc: 'docs/기록 모음.md', heading: month }])
  const h = await mcp('section', { knowledge: 'apv', doc: '기록 모음', heading: month })
  assert.deepEqual(h.history.map((x) => x.id).sort(), [r.saved, r2.saved].sort())
})

test('approve: 쓰기 자리 새 문서 · 새 항목(장부 · P-D8) · 「## 새로 세움」 · fresh 는 14일 뒤 떨어짐', async () => {
  const inp = { knowledge: 'apv', record: { title: '점검표: 배포 전 점검', changes: ['배포 전 점검: 세 가지'], touches: ['proc:배포전점검'] }, names: [{ coord: 'proc:배포전점검', label: '배포 전 점검', doc: 'docs/점검표.md', heading: '배포 전 점검', gist: '배포하기 앞서 디스크 · 인증서 · 백업을 보는 절차' }], sections: [{ doc: '점검표', heading: '배포 전 점검', content: '배포 전 점검은 세 가지다: 디스크 · 인증서 · 백업.' }] }
  const { p, r } = await approved(inp)
  assert.deepEqual(p.newDocs.map((d) => d.doc), ['docs/점검표.md'])
  assert.ok(r.saved, JSON.stringify(r))
  assert.ok(fs.existsSync(path.join(kdir('apv'), 'docs', '점검표.md')))
  const fresh = parseFresh(recText('apv', r.saved))
  assert.deepEqual(fresh.map((x) => x.kind).sort(), ['문서', '이름', '항목'])
  // 장부에 오른 새 항목의 줄 머리도 「항목」(채널 평가 P21 · 걷은 말 「이름」 을 새로 쓰지 않는다)
  assert.match(recText('apv', r.saved), /^- 항목 proc:배포전점검$/m)
  assert.doesNotMatch(recText('apv', r.saved), /^- 이름 /m)
  const w = { id: r.saved, date: '2026-11-10 10:00', author: 'wr', body: recText('apv', r.saved) }
  assert.equal(freshItems([w], { now: new Date(2026, 10, 12) }).length, 3)
  assert.equal(freshItems([w], { now: new Date(2026, 10, 25) }).length, 0, '14일 뒤 저절로 떨어진다')
})

test('approve: ingest/ 위조 = E_INPUT(P-D16) · 사람 글의 kmd 칸 머리 = E_INPUT · 지문 어긋남 = E_CONFLICT + 새 propose', async () => {
  const sec = await canary()
  // 지금 글에 대는 바꿀 곳(앞 시험이 비율을 바꿨다) — 문장 끝에 한 줄 보탬
  const tail = (base) => [{ coord: 'proc:카나리', base, edits: [{ find: '롤백으로 간다.', replace: '롤백으로 간다. 롤백 뒤 헬스 체크를 다시 한다.' }] }]
  const ok = (base, over = {}) => input(base, { record: { title: '카나리: 롤백 뒤 헬스 체크', changes: ['롤백 뒤: 헬스 체크를 다시 한다'], touches: ['proc:카나리'] }, sections: tail(base), ...over })
  const forged = ok(sec.base, { record: { ...ok(sec.base).record, tags: ['ingest/가짜.md', 'md/0123456789abcdef'] } })
  const p = await mcp('propose', forged)
  assert.match(p.proposal, /^[0-9a-f]{64}$/, JSON.stringify(p.errors))
  const r = await mcp('save', { ...forged, proposal: p.proposal, kit: KIT })
  assert.equal(r.error, 'E_INPUT')
  assert.match(r.message, /대량 넣기/)
  for (const h of ['받아들인 경고', '값 대조', '이은 항목', '새로 세움']) assert.ok(KMD_PART_RE.test(`## ${h}`), h)
  const forge = await mcp('propose', input(sec.base, { record: { title: '카나리: 위조', body: '요약\n\n## 받아들인 경고\n가짜', touches: ['proc:카나리'] } }))
  assert.equal(forge.error, 'E_INPUT', JSON.stringify(forge))
  const ps = await mcp('propose', ok(sec.base))
  assert.match(ps.proposal, /^[0-9a-f]{64}$/)
  const c = await mcp('save', { ...ok('deadbeefdeadbeef'), proposal: ps.proposal, kit: KIT })
  assert.equal(c.error, 'E_CONFLICT')
  assert.equal(c.details.propose.errors[0].code, 'conflict')
})

test('새 지식 = approve(기록 모음 같이) · 빈 지식 판정은 기록 모음을 세지 않음 · 저장 방식 스위치 · /held 길은 걷음(P11)', async () => {
  const made = await s.hub.addKnowledge({ user: 'boss', admin: true }, { kind: 'new', name: '새승인', empty: true })
  assert.ok(fs.existsSync(path.join(kdir(made.id), 'docs', '기록 모음.md')))
  assert.doesNotMatch(fs.readFileSync(path.join(kdir(made.id), '_members.md'), 'utf8'), /저장 방식/, '저장 방식 표지는 없다(늘 승인)')
  await s.hub.seedGate({ user: 'boss', admin: true }, made.id)
  // 저장 방식 스위치는 걷었다(P11) — 길이 없다 · 옛 지식도 approve
  const no = await req('/api/k/apv/save-mode', P.wr, { save: 'held' })
  assert.ok([404, 405].includes(no.status), String(no.status))
  assert.equal(s.hub.setSaveMode, undefined)
  // 넣지 못함 길(/held)도 걷었다
  const h = await fetch(`${s.url}/api/k/dpms/held`, { headers: { cookie: P.wr.cookie } })
  assert.ok([404, 405].includes(h.status), String(h.status))
})

test('하루 요약(P-D13): approve 지식의 review 스위치는 지난날 들어간 기록 수를 지식관리자에게 알림', async () => {
  await s.hub.setOwner({ shell: true }, 'apv', { review: true })
  const tomorrow = new Date(Date.now() + 86_400_000)
  const out = await s.hub.digest(tomorrow)
  assert.equal(out.find((x) => x.kn === 'apv')?.n >= 1, true, JSON.stringify(out))
  assert.deepEqual(await s.hub.digest(tomorrow), [], '하루 한 번')
  // 승인 받고 넣기(review)는 approve 지식의 저장을 막지 않는다
  const sec = await canary()
  const { r } = await approved(input(sec.base, { record: { ...input().record, title: '카나리: 비율 40%', changes: ['첫 30분 비율: 30% → 40%'] }, sections: [{ coord: 'proc:카나리', base: sec.base, edits: [{ find: '요청의 30% 만', replace: '요청의 40% 만' }] }] }))
  assert.equal(r.put, 1, JSON.stringify(r))
})

test('측정 읽기(scripts/savelog.mjs · P-D37): approve 줄의 승인 없음 · 받아들인 경고 · 다시 제안 수 · 옛 줄은 그대로', async () => {
  const { summarize } = await import('../scripts/savelog.mjs')
  const sum = summarize([
    { at: '2026-11-10 10:00', kn: 'apv', user: 'wr', ch: 'session', kit: 7, err: 'E_APPROVE', mode: 'approve', unproposed: true },
    { at: '2026-11-10 10:01', kn: 'apv', user: 'wr', ch: 'session', kit: 7, n: 1, put: 1, ok: ['x'], held: [], mode: 'approve', accepted: ['missing', 'invented'], rounds: 3, linked: 1, fresh: 0 },
    { at: '2026-11-10 10:02', kn: 'apv', user: 'wr', ch: 'session', kit: 7, n: 0, put: 0, held: [], mode: 'approve', accepted: [], rounds: 1, linked: 1, fresh: 2 },
    { at: '2026-11-10 10:03', kn: 'dpms', user: 'wr', ch: 'session', kit: 7, n: 1, put: 1, held: [] },
  ])
  const a = sum.channels.find((c) => c.ch === 'session').approve
  assert.deepEqual([a.saves, a.unproposed, a.accepted.missing, a.acceptedRatio, a.roundsPerSave, a.linked, a.fresh], [2, 1, 1, 0.5, 2, 2, 2])
  assert.equal(sum.channels.find((c) => c.ch === 'session').saves, 3, '옛 줄도 같이 센다')
})

test('반박 검토: 있는 장부 항목 덮기(쓰기 자리) · 종류만 · 기록 모음에 보낸 글 = 제안 오류 · 화면 ingest/ = E_INPUT · 보내기는 sent/ 를 뺀 제안으로 · 옛 받기 = E_APPROVE', async () => {
  const sec = await canary()
  const base = { knowledge: 'apv', record: { title: '카나리: 경위', why: ['경위'], body: '경위만.', touches: ['proc:카나리'] } }
  const over = await mcp('propose', { ...base, names: [{ coord: 'proc:카나리', label: '카나리', doc: 'docs/엉뚱.md', heading: 'x' }] })
  assert.deepEqual(over.errors.map((e) => e.code), ['name'], '쓰기 자리는 있는 장부 항목의 자리를 바꾸지 못한다')
  const boss = await mcp('propose', { ...base, names: [{ coord: 'proc:카나리', label: '카나리', aliases: ['canary'] }] }, P.boss)
  assert.deepEqual(boss.errors, [], JSON.stringify(boss.errors))
  assert.match(boss.text, /proc:카나리 {3}장부 고침 · 별칭 canary/, '지식관리자의 장부 고침은 제안서에 보인다')
  const kind = await mcp('propose', { ...base, kinds: ['job'] })
  assert.deepEqual(kind.errors.map((e) => e.code), ['kind'])
  const rec = await mcp('propose', { ...base, sections: [{ doc: '기록 모음', heading: '아무거나', content: '글.' }] })
  assert.deepEqual(rec.errors.map((e) => e.code), ['records'])
  // 화면 길 — ingest/ 표지는 대량 넣기만
  const ing = await req('/api/k/apv/save', P.wr, { record: { title: '카나리: 경위 2', body: '경위만.', changes: ['카나리: 경위'], touches: ['proc:카나리'], tags: ['ingest/가짜.md', 'md/0123456789abcdef'] }, proposal: 'a'.repeat(64) })
  assert.equal(ing.status, 400)
  assert.match(ing.j.message, /ingest\//)
  // 보내기(기기 열쇠 · sent/ 표지) — 제안은 sent/ 없이 받고 같은 해시로 들어간다
  const sendRec = { title: '카나리: 보낸 경위', body: '보낸 경위만.', touches: ['proc:카나리'] }
  const ps = await req('/api/k/apv/propose', P.wr, { record: sendRec })
  assert.deepEqual(ps.j.errors, [], JSON.stringify(ps.j))
  const sent = await req('/api/k/apv/save', P.wr, { channel: 'send', record: { ...sendRec, tags: ['sent/00112233aabbccdd'] }, proposal: ps.j.proposal })
  assert.equal(sent.status, 200, JSON.stringify(sent.j))
  assert.ok(works('apv').includes(`${sent.j.id}.md`))
  const old = await req('/api/k/apv/save', P.wr, { channel: 'send', record: { ...sendRec, title: '카나리: 옛 판', tags: ['sent/00112233aabbccee'] }, left: [{ doc: 'x', heading: 'y', why: '못 고름' }] })
  assert.equal(old.j.error, 'E_APPROVE')
  await assert.rejects(s.hub.receive({ user: 'wr', device: 'd' }, 'apv', { from: '내 PC', items: [{ title: '옛 판', body: '글' }] }), (e) => e.code === 'E_APPROVE')
  assert.ok(sec.base)
})

test('채널 평가 P18: 승인 어긋남의 바뀐 쪽 — 이은 항목(잇기)이 그사이 바뀌면 knowledge · 이 프로세스가 내지 않은 해시는 unknown', async () => {
  const why = { knowledge: 'apv', record: { title: '테스트 카나리: 비율 경위 다시', why: ['테스트 — 회고에서 다시 정했다'], body: '비율을 정한 경위를 다시 남긴다.', touches: ['proc:카나리'] } }
  const p = await mcp('propose', why)
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  assert.deepEqual(p.items.map((x) => x.kind), ['잇기'])
  // 그사이 이은 항목의 글이 바뀐다(다른 저장)
  const sec = await canary()
  const m = /요청의 ([0-9]+)% 만/.exec(sec.content)
  assert.ok(m, JSON.stringify(sec).slice(0, 300))
  const to = String(Number(m[1]) + 7)
  const { r } = await approved(input(sec.base, { record: { title: `테스트 카나리: 비율 ${to}%`, changes: [`첫 30분 비율: ${m[1]}% → ${to}%`], why: ['테스트'], touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', base: sec.base, edits: [{ find: m[0], replace: `요청의 ${to}% 만` }] }] }))
  assert.ok(r.saved, JSON.stringify(r))
  const miss = await mcp('save', { ...why, proposal: p.proposal, kit: KIT })
  assert.equal(miss.error, 'E_APPROVE')
  assert.equal(savelogOf('apv').at(-1).approve.side, 'knowledge', '입력은 같고 이은 항목의 지문이 바뀌었다')
  const fake = await mcp('save', { ...why, proposal: 'f'.repeat(64), kit: KIT })
  assert.equal(fake.error, 'E_APPROVE')
  assert.equal(savelogOf('apv').at(-1).approve.side, 'unknown')
})

test('채널 평가 T10: 승인한 제안 그대로면 save 는 { knowledge, proposal, kit } 만(입력을 다시 내지 않음) · 다른 사람 · 모르는 지문 = E_INPUT(아무것도 쓰지 않음) · E_APPROVE 뒤 새 지문으로도', async () => {
  const sec = await canary()
  const cur = /요청의 (\d+)% 만/.exec(sec.content)[1]
  const to = cur === '30' ? '40' : '30'
  const inp = input(sec.base, { record: { title: `카나리: 첫 30분 비율 ${to}%`, changes: [`첫 30분 비율: ${cur}% → ${to}%`], why: ['테스트: 비율을 바꿈'], touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', base: sec.base, edits: [{ find: `요청의 ${cur}% 만`, replace: `요청의 ${to}% 만` }] }] })
  const p = await mcp('propose', inp)
  assert.deepEqual(p.errors, [])
  const n0 = snap(kdir('apv'))
  const unknown = await mcp('save', { knowledge: 'apv', proposal: 'e'.repeat(64), kit: KIT })
  assert.equal(unknown.error, 'E_INPUT', JSON.stringify(unknown))
  const other = await mcp('save', { knowledge: 'apv', proposal: p.proposal, kit: KIT }, P.boss)
  assert.equal(other.error, 'E_INPUT', '다른 사람의 제안 입력은 꺼내지 않는다')
  assert.equal(snap(kdir('apv')), n0, '아무것도 쓰지 않는다')
  const r = await mcp('save', { knowledge: 'apv', proposal: p.proposal, kit: KIT })
  assert.ok(r.saved, JSON.stringify(r))
  assert.equal(r.put, 1)
  assert.match(fs.readFileSync(path.join(kdir('apv'), 'docs', '배포절차.md'), 'utf8'), new RegExp(`요청의 ${to}% 만`))
  assert.match(recText('apv', r.saved), new RegExp(`첫 30분 비율: ${cur}% → ${to}%`))
  // 그사이 지식이 바뀜 → E_APPROVE · 같은 입력을 새 지문으로 들어 둔다
  const sec2 = await canary()
  const back = cur
  const inp2 = input(sec2.base, { record: { title: `카나리: 첫 30분 비율 ${back}%`, changes: [`첫 30분 비율: ${to}% → ${back}%`], why: ['테스트: 되돌림'], touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', base: sec2.base, edits: [{ find: `요청의 ${to}% 만`, replace: `요청의 ${back}% 만` }] }] })
  const p2 = await mcp('propose', inp2)
  assert.deepEqual(p2.errors, [])
  const miss = await mcp('save', { ...inp2, proposal: 'd'.repeat(64), kit: KIT })
  assert.equal(miss.error, 'E_APPROVE')
  const again = await mcp('save', { knowledge: 'apv', proposal: miss.details.propose.proposal, kit: KIT })
  assert.ok(again.saved, JSON.stringify(again))
})

// 비율 한 칸 바꾸는 입력(T10 시험들) — 지금 글을 읽어 다른 값으로
const flip = async (kn, title, over = {}, call = mcp) => {
  const sec = await call('section', { knowledge: kn, coord: 'proc:카나리' })
  const cur = /요청의 (\d+)% 만/.exec(sec.content)[1]
  const to = String(Number(cur) + 1)
  return { cur, to, inp: { knowledge: kn, record: { title: `${title}: 첫 30분 비율 ${to}%`, changes: [`첫 30분 비율: ${cur}% → ${to}%`], why: ['테스트: 비율을 바꿈'], touches: ['proc:카나리'], ...(over.record || {}) }, sections: [{ coord: 'proc:카나리', base: sec.base, edits: [{ find: `요청의 ${cur}% 만`, replace: `요청의 ${to}% 만` }] }] } }
}
const fileOf = async (name, text) => {
  const buf = Buffer.from(text)
  const md = (await fileToMd(name, buf, { convert: true })).md
  return { tags: [`ingest/${name}`, `md/${crypto.createHash('sha256').update(md.trim()).digest('hex').slice(0, 16)}`], attach: [{ path: `docs/assets/${name}`, b64: buf.toString('base64') }] }
}

test('채널 평가 T10: 대량 넣기(ingest/ 표지 + attach)도 proposal 만 · 두 파일 차례로 · E_APPROVE 뒤 새 지문으로 다시 들어 proposal + attach 만', async () => {
  const A = await fileOf('테스트 A.txt', '# 테스트 A\n\n카나리 비율을 바꾼다.\n')
  const a = await flip('apv', '테스트 A', { record: { tags: A.tags } })
  const pa = await mcp('propose', a.inp)
  assert.deepEqual(pa.errors, [], JSON.stringify(pa.errors))
  const ra = await mcp('save', { knowledge: 'apv', proposal: pa.proposal, kit: KIT, attach: A.attach })
  assert.ok(ra.saved, JSON.stringify(ra))
  assert.equal(savelogOf('apv').at(-1).ch, 'bulk', '꺼낸 입력의 ingest/ 표지로 채널이 대량 넣기')
  assert.ok(fs.existsSync(path.join(kdir('apv'), 'docs', 'assets', '테스트 A.txt')), '첨부는 save 때 따로 받아 같은 저장에 든다')
  // 첨부 없이 proposal 만 = 대량 넣기 증명이 없어 E_INPUT(아무것도 쓰지 않음)
  const B = await fileOf('테스트 B.txt', '# 테스트 B\n\n카나리 비율을 다시 바꾼다.\n')
  const b = await flip('apv', '테스트 B', { record: { tags: B.tags } })
  const pb = await mcp('propose', b.inp)
  assert.deepEqual(pb.errors, [], JSON.stringify(pb.errors))
  const n0 = snap(kdir('apv'))
  const noAtt = await mcp('save', { knowledge: 'apv', proposal: pb.proposal, kit: KIT })
  assert.equal(noAtt.error, 'E_INPUT', JSON.stringify(noAtt))
  assert.equal(snap(kdir('apv')), n0)
  // 승인과 다른 지문(E_APPROVE) → 같은 입력을 새 지문으로 들어 둔다 → proposal + attach 만으로 들어간다
  const miss = await mcp('save', { ...b.inp, proposal: 'c'.repeat(64), kit: KIT, attach: B.attach })
  assert.equal(miss.error, 'E_APPROVE', JSON.stringify(miss))
  const rb = await mcp('save', { knowledge: 'apv', proposal: miss.details.propose.proposal, kit: KIT, attach: B.attach })
  assert.ok(rb.saved, JSON.stringify(rb))
  assert.equal(savelogOf('apv').at(-1).ch, 'bulk')
  assert.match(fs.readFileSync(path.join(kdir('apv'), 'docs', '배포절차.md'), 'utf8'), new RegExp(`요청의 ${b.to}% 만`))
})

test('채널 평가 T10: 30분이 지난 제안 입력은 꺼내지 않는다(E_INPUT · 아무것도 쓰지 않음)', async () => {
  const { inp } = await flip('apv', '테스트 지남')
  const p = await mcp('propose', inp)
  assert.deepEqual(p.errors, [])
  const n0 = snap(kdir('apv'))
  const real = Date.now
  Date.now = () => real() + 31 * 60_000
  let late
  try { late = await mcp('save', { knowledge: 'apv', proposal: p.proposal, kit: KIT }) } finally { Date.now = real }
  assert.equal(late.error, 'E_INPUT', JSON.stringify(late))
  assert.match(late.message || JSON.stringify(late), /30분/)
  assert.equal(snap(kdir('apv')), n0, '아무것도 쓰지 않는다')
})

test('채널 평가 T10: 개인 프로그램(PC) MCP 도 승인한 제안이면 save 는 { knowledge, proposal } 만', async () => {
  const pcRoot = path.join(tmp, 'pc')
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), path.join(pcRoot, 'apv'))
  fs.rmSync(path.join(pcRoot, 'apv', 'work'), { recursive: true, force: true })
  fs.writeFileSync(path.join(pcRoot, 'apv', 'README.md'), '# 승인 지식\n')
  fs.writeFileSync(path.join(pcRoot, 'apv', '_members.md'), '# 사람\n\n- 주인: kim\n- 저장 방식: 승인\n')
  const G = (...a) => execFileSync('git', ['-c', 'user.name=테스트', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd: path.join(pcRoot, 'apv'), encoding: 'utf8' })
  G('init', '-q'); G('add', '-A'); G('commit', '-q', '-m', '처음')
  fs.mkdirSync(path.join(tmp, 'pcdata'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'pcdata', 'serve.json'), JSON.stringify({ curateOnStart: false, decideMs: 3600000, inboxTickMs: 3600000 }))
  const pc = await startServer({ root: pcRoot, data: path.join(tmp, 'pcdata'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const ME = { user: 'kim', admin: true, pc: true }
    const m = makeMcp(pc.hub)
    const call = async (name, args) => (await m.call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ME)).result.structuredContent
    const { inp, to } = await flip('apv', '테스트 개인', {}, call)
    const p = await call('propose', inp)
    assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
    const r = await call('save', { knowledge: 'apv', proposal: p.proposal })
    assert.ok(r.saved, JSON.stringify(r))
    assert.match(fs.readFileSync(path.join(pcRoot, 'apv', 'docs', '배포절차.md'), 'utf8'), new RegExp(`요청의 ${to}% 만`))
  } finally { await pc.close() }
})
