// 저장 제안(저장 승인 설계 P-D3 · P-D4 · P-D10 · P-D31 · P-D32 · 2-1 · 7절 P2) — propose 는 쓰지 않고
// 서버가 정한 꼴의 【저장 제안】 글 · 항목 · 경고(id) · 오류 · proposal(sha256)을 돌려준다.
//
// 글(text) · 경고 · 오류 · 같은 입력이면 같은 해시 · 입력이 바뀌면 다른 해시 · 오류면 해시 없음 · near(같음 = 오류 · distinct · 비슷함 = 경고) ·
// 자리(없음 404 · 읽기 403 · 쓰기 200) · 입력 모양(E_INPUT) · 아무것도 쓰지 않음 · section history · brief mine.accepted

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { copyDir, signIn, seat } from './helpers.mjs'
import { proposeInputWhy, nearOf, nameNear } from '../core/guard.js'
import { lineDiff } from '../core/propose.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s
const P = {}

const req = async (p, who, body) => {
  const r = await fetch(s.url + p, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${who.key}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, j: await r.json().catch(() => null) }
}
const mcp = async (name, args, who = P.wr) => (await req('/mcp', who, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).j.result.structuredContent
// 지식 폴더의 모든 파일(경로 · 크기 · 바뀐 때) — propose 뒤에 같아야 한다
const snap = (d = path.join(tmp, 'kn', 'dpms')) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? snap(path.join(d, e.name)) : [`${path.join(d, e.name)} ${fs.statSync(path.join(d, e.name)).size} ${fs.statSync(path.join(d, e.name)).mtimeMs}`])).sort().join('|')

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-propose-tool-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  P.boss = await signIn(s, { id: 'boss', admin: true })
  for (const id of ['wr', 'rd', 'no']) P[id] = await signIn(s, { id, admin: false })
  await seat(s, 'wr', { dpms: 'write' })
  await seat(s, 'rd', { dpms: 'read' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

const canary = async () => (await mcp('section', { knowledge: 'dpms', coord: 'proc:카나리' }))
const input = (base, over = {}) => ({
  knowledge: 'dpms',
  record: { title: '카나리: 첫 30분 비율 20%', changes: ['첫 30분 비율: 10% → 20%'], why: ['테스트 — 비율을 올림'], touches: ['proc:카나리'] },
  sections: [{ coord: 'proc:카나리', base, edits: [{ find: '요청의 10% 만', replace: '요청의 20% 만' }] }],
  ...over,
})

test('글 · 항목 · 해시: 서버가 정한 꼴 · 같은 입력이면 같은 해시 · 입력이 바뀌면 다른 해시 · 아무것도 쓰지 않는다', async () => {
  const n0 = snap()
  const sec = await canary()
  const r = await mcp('propose', input(sec.base))
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors))
  assert.match(r.proposal, /^[0-9a-f]{64}$/)
  assert.match(r.text, /^【저장 제안】 지식: DPMS 지식\(보는 사람 \d+\) · 길: 이 세션의 작업\n【기록】 「카나리: 첫 30분 비율 20%」/)
  assert.match(r.text, /바뀐 것 {2,}첫 30분 비율: 10% → 20%/)
  assert.match(r.text, /―― 고칠 항목 ――\n {2}배포절차 › 카나리 {3}변경 {3}10% → 20%\n {5}- .*요청의 10% 만.*\n {5}\+ .*요청의 20% 만/)
  for (const h of ['새 항목(문서)', '새 문서', '새 갈래 · 새 종류', '새 항목(장부)', '이을 항목(글 그대로)', '뺀다', '검사']) assert.match(r.text, new RegExp(`―― ${h.replace(/[()]/g, '\\$&')} ――`))
  assert.match(r.text, /오류 없음\n승인하시면/)
  assert.equal(r.items.length, 1)
  assert.deepEqual([r.items[0].kind, r.items[0].doc, r.items[0].heading, r.items[0].base], ['고침', 'docs/배포절차.md', '카나리', sec.base])
  assert.match(r.items[0].after, /요청의 20% 만/)
  assert.equal(r.items[0].before, sec.content)
  assert.equal((await mcp('propose', input(sec.base))).proposal, r.proposal, '같은 입력이면 같은 해시(시각을 싣지 않는다)')
  const again = await mcp('propose', input(sec.base, { record: { ...input().record, why: ['테스트 — 비율을 올림 · 김 과장이 정함'] } }))
  assert.notEqual(again.proposal, r.proposal, '기록 칸을 고치면 해시가 바뀐다')
  const ex = await mcp('propose', input(sec.base, { excluded: [{ name: 'screen:BZD020', why: '사람이 뺌' }] }))
  assert.notEqual(ex.proposal, r.proposal, '뺀 것도 해시에 든다')
  assert.match(ex.text, /―― 뺀다 ――\n {2}screen:BZD020 {3}사람이 뺌/)
  assert.equal(snap(), n0, 'propose 는 쓰지 않는다(지식 폴더 그대로)')
  // 이을 항목(글 그대로) — 항목 글 없는 건드린 항목
  const link = await mcp('propose', input(sec.base, { record: { ...input().record, touches: ['proc:카나리', 'proc:준비'] } }))
  assert.deepEqual(link.items.map((x) => x.kind), ['고침', '잇기'])
  assert.match(link.text, /―― 이을 항목\(글 그대로\) ――\n {2}배포절차 › 준비 {3}잇기/)
  assert.equal(link.items[1].before, link.items[1].after)
})

test('오류: 지문 어긋남 · 장부 밖 항목 · 없는 문서(쓰기 자리) → errors · 해시 없음 · 제안서 끝 줄', async () => {
  const sec = await canary()
  const st = await mcp('propose', input('deadbeefdeadbeef'))
  assert.equal(st.proposal, null)
  assert.deepEqual(st.errors.map((e) => [e.code, e.at]), [['conflict', '배포절차 › 카나리']])
  assert.match(st.text, /오류 e1 {2}배포절차 › 카나리: 그사이 항목이 바뀌었다/)
  assert.match(st.text, /오류가 있어 이대로는 남지 않습니다/)
  const out = await mcp('propose', input(sec.base, { record: { ...input().record, touches: ['proc:카나리배포'] } }))
  assert.equal(out.errors[0].code, 'touches')
  assert.deepEqual(out.errors[0].near, ['proc:카나리'])
  // 개인 프로그램은 PC1 까지 막는다 — 팀 서버에서는 걸리지 않는다
})

test('near(P-D10): 정규화가 같으면 오류 · distinct 로 넘음 · 비슷하면 경고 · 새 종류 · 새 갈래', async () => {
  const sec = await canary()
  const base = input(sec.base)
  const same = await mcp('propose', { ...base, names: [{ coord: 'proc:헬스체크', label: '헬스체크' }], record: { ...base.record, touches: ['proc:카나리', 'proc:헬스체크'] } })
  assert.deepEqual(same.errors.map((e) => e.code), ['near'])
  assert.deepEqual(same.errors[0].near, ['proc:헬스 체크'])
  assert.equal(same.proposal, null)
  const ok = await mcp('propose', { ...base, names: [{ coord: 'proc:헬스체크', label: '헬스체크' }], distinct: ['proc:헬스체크'], record: { ...base.record, touches: ['proc:카나리', 'proc:헬스체크'] } })
  assert.deepEqual(ok.errors, [], JSON.stringify(ok.errors))
  assert.deepEqual(ok.newNames.map((n) => n.coord), ['proc:헬스체크'])
  const sim = await mcp('propose', { ...base, names: [{ coord: 'proc:카나리2', label: '카나리 2' }], record: { ...base.record, touches: ['proc:카나리', 'proc:카나리2'] } })
  assert.deepEqual(sim.errors, [])
  assert.deepEqual(sim.warnings.filter((w) => w.code === 'near').map((w) => w.at), ['proc:카나리2'])
  assert.deepEqual(sim.newNames[0].near, ['proc:카나리'])
  assert.match(sim.text, /―― 새 항목\(장부\) ――\n {2}proc:카나리2 {3}신설 {3}자리: 없음 · 비슷한 항목 proc:카나리/)
  const fm = await mcp('propose', { ...base, forms: [{ name: '회의 록' }] })
  // 기본 갈래는 판정에 없다(지식 생성 하네스 H-O4): 갈래 장부가 없는 지식에서는 견줄 갈래가 없다(있는 갈래와의 near 는 test/harness-gate.test.mjs)
  assert.deepEqual([fm.errors.map((e) => e.code), fm.newForms.map((f) => f.name)], [[], ['회의 록']])
})

test('자리(P-D31): 없음 404 · 읽기 403 · 쓰기 200(HTTP · MCP) · 기기 열쇠 길은 「길: 보내기」', async () => {
  const sec = await canary()
  const { knowledge: _k, ...body } = input(sec.base)
  body.record = { title: '카나리: 첫 30분 비율 20%', body: '## 바뀐 것\n- 첫 30분 비율: 10% → 20%', touches: ['proc:카나리'] }
  assert.equal((await req('/api/k/dpms/propose', P.no, body)).status, 404)
  const rd = await req('/api/k/dpms/propose', P.rd, body)
  assert.deepEqual([rd.status, rd.j.error], [403, 'E_FORBIDDEN'])
  const wr = await req('/api/k/dpms/propose', P.wr, body)
  assert.equal(wr.status, 200, JSON.stringify(wr.j))
  // 기기 열쇠로 온 제안은 개인 프로그램의 보내기 확인 창(P7 · P-D22) — 화면(쿠키) 길의 「길: 화면」 은 screen-kmd 저장 확인 창이 본다
  assert.match(wr.j.text, /· 길: 보내기\n/)
  assert.match(wr.j.proposal, /^[0-9a-f]{64}$/)
  assert.equal((await req('/api/k/dpms/propose', P.wr)).status, 405, 'POST 만')
  assert.equal((await mcp('propose', input(sec.base), P.rd)).error, 'E_FORBIDDEN')
  assert.equal((await mcp('propose', input(sec.base), P.no)).error, 'E_NOTFOUND')
  assert.equal((await req('/api/k/%E0%A4%A/propose', P.wr, body)).status, 400, '깨진 경로 조각은 400')
})

test('입력 모양(P-D32): proposal · distinct · excluded · forms · kinds · names · prototype 이름 → E_INPUT', async () => {
  assert.equal(proposeInputWhy({ record: {} }), null)
  assert.match(proposeInputWhy({ proposal: 'abc' }), /64자/)
  assert.equal(proposeInputWhy({ proposal: 'a'.repeat(64) }), null)
  assert.match(proposeInputWhy(JSON.parse('{"__proto__": {"x": 1}}')), /제안은/)
  assert.match(proposeInputWhy({ distinct: ['constructor'] }), /distinct/)
  assert.match(proposeInputWhy({ distinct: Array(51).fill('a') }), /50개/)
  assert.match(proposeInputWhy({ excluded: [{ name: 'a', why: 'b', more: 1 }] }), /excluded/)
  assert.match(proposeInputWhy({ excluded: [{ name: 'a\nb' }] }), /excluded/)
  assert.match(proposeInputWhy({ forms: [{ name: 'prototype' }] }), /갈래 이름/)
  assert.match(proposeInputWhy({ forms: [JSON.parse('{"name": "a", "__proto__": 1}')] }), /forms/)
  assert.match(proposeInputWhy({ kinds: ['Bad Kind'] }), /kinds/)
  assert.equal(proposeInputWhy({ kinds: ['job', { name: '이슈', label: '이슈' }] }), null)
  assert.match(proposeInputWhy({ names: [{ coord: 'a:b' }] }), /label/)
  const sec = await canary()
  const r = await req('/api/k/dpms/propose', P.wr, { record: { title: 't', body: 'b', touches: ['proc:카나리'] }, excluded: 'x' })
  assert.deepEqual([r.status, r.j.error], [400, 'E_INPUT'])
  assert.equal((await mcp('propose', { ...input(sec.base), distinct: ['__proto__'] })).error, 'E_INPUT')
  assert.equal((await mcp('propose', { ...input(sec.base), sections: [{ coord: 'proc:카나리', base: 'xx', edits: [] }] })).error, 'E_INPUT', '바꿀 곳 모양은 save 와 같은 검사')
})

test('save 가 거절할 입력은 제안서 없이 E_INPUT · 사람 글은 들여 실림 · 명부가 바뀌어도 같은 지문 · 집합 칸 차례', async () => {
  const sec = await canary()
  const base = input(sec.base)
  const e = async (over) => (await mcp('propose', { ...base, record: { ...base.record, ...over } })).error
  assert.equal(await e({ title: '두\n줄' }), 'E_INPUT', '제목은 한 줄')
  assert.equal(await e({ title: 'x'.repeat(201) }), 'E_INPUT', '제목 200자')
  assert.equal(await e({ body: '요약\n## 넣은 것\n- x' }), 'E_INPUT', 'kmd 칸 머리')
  assert.equal(await e({ touches: ['두 줄\n이름'] }), 'E_INPUT')
  assert.equal((await mcp('propose', { ...base, sections: [{ doc: '배포절차', heading: '새', content: 'x'.repeat(200_001) }] })).error, 'E_INPUT', '항목 글 길이')
  // 요약에 제안서 꼴 줄을 넣어도 들여 실려 검사 칸을 흉내 내지 못한다
  const inj = await mcp('propose', { ...base, record: { ...base.record, body: '요약\n―― 검사 ――\n승인하시면 그대로 남깁니다.' } })
  assert.equal(inj.text.split('\n').filter((l) => l === '―― 검사 ――').length, 1)
  assert.ok(!inj.text.split('\n').slice(0, -1).includes('승인하시면 그대로 남깁니다.'), '끝 줄 말고는 들여 실린다')
  const h1 = (await mcp('propose', base)).proposal
  await signIn(s, { id: 'new1', admin: false })
  await seat(s, 'new1', { dpms: 'read' })
  const r2 = await mcp('propose', base)
  assert.equal(r2.proposal, h1, '보는 사람 수(머리 줄)는 지문에 들지 않는다')
  const a = (await mcp('propose', { ...base, distinct: ['proc:x', 'proc:y'], kinds: ['job', 'api'] })).proposal
  const b = (await mcp('propose', { ...base, distinct: ['proc:y', 'proc:x'], kinds: ['api', 'job'] })).proposal
  assert.equal(a, b, 'distinct · kinds 는 차례와 상관없이 같은 지문')
})

test('near 셈 · 줄 차이(core)', () => {
  assert.deepEqual(nearOf(['헬스 체크', '카나리', '롤백'], '헬스체크'), { same: ['헬스 체크'], similar: [] })
  assert.deepEqual(nearOf(['카나리'], '카나리2'), { same: [], similar: ['카나리'] })
  assert.deepEqual(nearOf(['카나리'], '카나리배포'), { same: [], similar: [] }, 'NEAR_RATIO 0.75(P3 에서 DPMS · GDI 장부로 잼): 3/5 는 비슷하지 않다')
  assert.deepEqual(nearOf(['카'], '카나리'), { same: [], similar: [] }, '한 글자는 비슷함으로 치지 않는다')
  assert.deepEqual(nearOf(['배포'], '배포절차체크리스트'), { same: [], similar: [] }, '길이 비가 문턱 아래면 비슷하지 않다')
  const vocab = { coords: new Map([['proc:헬스 체크', { label: '헬스 체크', aliases: ['상태 점검'], deprecated: null }]]) }
  assert.deepEqual(nameNear(vocab, 'proc:상태점검', '상태 점검').same, ['proc:헬스 체크'], '별칭과 같아도 같음')
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nB\nc'), [['-', 'b'], ['+', 'B']])
  assert.deepEqual(lineDiff('same', 'same'), [])
})

test('section history · brief mine.accepted(b1)', async () => {
  const sec = await canary()
  assert.ok(Array.isArray(sec.history), 'section 에 항목 이력')
  assert.equal(typeof sec.historyMore, 'number')
  assert.ok(sec.history.some((x) => x.id === sec.lastPut), '표지 기록이 이력에 든다')
  for (const x of sec.history) assert.deepEqual(Object.keys(x).sort(), ['author', 'date', 'id', 'state', 'title'])
  const b = await mcp('brief', {})
  assert.deepEqual(b.knowledge.find((x) => x.id === 'dpms').mine, { accepted: 0 })
  const one = await mcp('brief', { knowledge: 'dpms' })
  assert.equal(one.you.accepted, 0)
})

test('과거 결정 카드(지식 생성 하네스 H3): match 가 카드 · 앞선 값 · 덮임 줄을 준다 · brief 가 생성 룰의 판과 조문 제목을 준다 · 옛 칸은 그대로 · 자리로 거른다', async () => {
  const m = await mcp('match', { q: '카나리', knowledge: 'dpms', source: '# 배포 메모\n\n카나리 비율을 30% 로 올리고 헬스 체크 시간 초과를 5초로 한다.' }, P.rd)
  // 옛 칸
  assert.equal(m.found[0].coord, 'proc:카나리')
  // 새 칸 — 카드는 번호가 아니라 열쇠로 가리킨다
  const id = m.cards.filter((c) => c.type === '정체')
  const hit = id.find((c) => c.key === 'proc:카나리')
  assert.deepEqual([hit.via, hit.doc, hit.heading, hit.kind, typeof hit.base, typeof hit.body], ['이름 맞음', '배포절차', '카나리', 'proc', 'string', 'string'])
  assert.ok(!('gist' in hit) && !('gistFrom' in hit)) // 뜻 한 줄이 없는 줄은 빈 칸(첫 문장으로 메우지 않는다 · O-9 · 점검이 알린다)
  assert.ok(id.some((c) => c.key === 'proc:헬스 체크' && c.via === '원천에 나옴'), JSON.stringify(id.map((c) => [c.key, c.via]))) // 넣을 글에 나오는 있는 항목(거꾸로 대기)
  assert.ok(m.cards.some((c) => c.type === '놓임' && c.key === '배포절차'))
  assert.ok(m.cards.some((c) => c.type === '꼴' && c.key === 'proc' && c.items >= 1))
  assert.ok(m.cards.every((c) => !('n' in c) && !('no' in c)))
  assert.match(m.coverage.line, /^이름으로는 전수 \d+ · 뜻으로는 상위 \d+ \/ \d+/)
  assert.ok(Array.isArray(m.prior) && Array.isArray(m.toc) && m.toc.some((t) => t.doc === '배포절차'))
  assert.equal(m.rulesRev, 2)
  // 걸리는 이름이 없으면 「판례 없음」 한 줄
  const none = await mcp('match', { q: '없는이름xyz', knowledge: 'dpms' }, P.rd)
  assert.equal(none.cards.filter((c) => c.type === '정체').length, 0)
  assert.match(none.none, /^판례 없음\(항목 \d+ 을 이름으로 다 댔다 · 맞은 것 0\)/)
  // 지식을 가리키지 않으면 카드는 없다(옛 응답 그대로)
  assert.equal((await mcp('match', { q: '카나리' }, P.rd)).cards, undefined)
  // 자리 — 받지 않은 지식의 카드는 404 로 막힌다
  const no = await req('/mcp', P.no, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'match', arguments: { q: '카나리', knowledge: 'dpms' } } })
  assert.equal(no.j.result.structuredContent.error, 'E_NOTFOUND')
  assert.equal(no.j.result.structuredContent.cards, undefined)
  // 넣을 글 길이
  assert.equal((await mcp('match', { q: '카나리', knowledge: 'dpms', source: 'x'.repeat(60_001) }, P.rd)).error, 'E_INPUT')
  // brief — 새 칸(옛 칸 rules · forms · kinds 는 그대로)
  const b = await mcp('brief', { knowledge: 'dpms' }, P.rd)
  assert.deepEqual([b.rulesRev, b.ruleTitles.length, b.ruleTitles[1], typeof b.rulesHash, b.formsOwn], [1, 10, 'R1 무엇이 항목 하나인가', 'string', false])
  assert.ok(b.kindCards.seed.some((x) => x.kind === '회의' && x.nature === '사건' && x.gist))
  assert.ok(Array.isArray(b.natures) && Array.isArray(b.rules) && Array.isArray(b.kinds) && Array.isArray(b.forms))
})
