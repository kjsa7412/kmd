// 원본 올리기 + 참조 첨부(저장승인 설계 P-D47 · 권한 모델 7절 · 채널 평가 T12)
//
// PUT /api/k/:id/stage/:sha: 팀 서버만 · hub.meta(읽기 미만 404) → 사람 기기 열쇠만(에이전트 · 기계 · 쿠키 403) → 쓰기(403) → sha 꼴 · 바이트 sha 대조 ·
//   32MB(413) · 사람 · 지식마다 stageMax · 서버 합 stageTotal(E_RATE) · 24시간 걷기 · 자리는 <살림>/stage(지식 폴더 밖 = 백업 · 보내기에 없다)
// save 의 attach { path, ref }: 대량 넣기(ingest/) 채널만 · 저장 문이 내 올린 자리 → docs/assets 차례로 풀어 { path, b64 } 와 같은 줄 ·
//   들어간 뒤 올린 원본 지움 · 다시 same · 남이 올린 ref · junction · 바꿔치기 · b64+ref · file · HTTP /save · ingest/ 없는 세션 = E_INPUT · 하루 합은 풀린 바이트 · 실패 저장은 올린 원본이 남는다

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { copyDir, signIn, seat } from './helpers.mjs'
import { TEAM_KIT_REV } from '../core/teamkit.js'
import { fileToMd } from '../core/importer.js'
import { storedZip } from './fixture/officefiles.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s
const P = {}
const KIT = String(TEAM_KIT_REV)
const KN = 'stg'

const req = async (p, who, body, method) => {
  const r = await fetch(s.url + p, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { ...(who?.key ? { authorization: `Bearer ${who.key}` } : {}), ...(who?.cookie && !who.key ? { cookie: who.cookie } : {}), 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  return { status: r.status, j: await r.json().catch(() => null) }
}
const put = async (who, buf, { kn = KN, sha = crypto.createHash('sha256').update(buf).digest('hex'), auth = who?.key ? `Bearer ${who.key}` : null, cookie = null } = {}) => {
  const r = await fetch(`${s.url}/api/k/${encodeURIComponent(kn)}/stage/${sha}`, { method: 'PUT', headers: { ...(auth ? { authorization: auth } : {}), ...(cookie ? { cookie } : {}), 'content-type': 'application/octet-stream' }, body: buf })
  return { status: r.status, j: await r.json().catch(() => null), sha }
}
const mcp = async (name, args, who = P.wr) => (await req('/mcp', who, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).j.result.structuredContent
const kdir = (id = KN) => path.join(tmp, 'kn', id)
const stageRoot = () => path.join(tmp, 'data', 'stage')
const homeOf = (user, kn = KN) => s.hub.stageHome(kn, user)
const savelogOf = (id = KN) => fs.readFileSync(path.join(tmp, 'data', 'savelog', `${encodeURIComponent(id)}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const snap = (d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.name !== '.git').flatMap((e) => (e.isDirectory() ? snap(path.join(d, e.name)) : [`${path.join(d, e.name)} ${fs.statSync(path.join(d, e.name)).size}`])).sort().join('|')

// 원본 docx 하나: 머리 하나 · 글 한 줄(n 이 다르면 다른 바이트 · 다른 글 지문)
const docx = (title, line) => storedZip([['word/document.xml', `<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${title}</w:t></w:r></w:p><w:p><w:r><w:t>${line}</w:t></w:r></w:p></w:body></w:document>`]])
const fileOf = async (name, buf) => {
  const md = (await fileToMd(name, buf, { convert: true })).md
  return { md, tags: [`ingest/${name}`, `md/${crypto.createHash('sha256').update(md.trim()).digest('hex').slice(0, 16)}`] }
}
// 대량 넣기 입력 하나: 새 문서 「테스트 올림 <n>」 의 새 항목 + 장부 짝
const bulkInput = (n, tags) => ({
  knowledge: KN,
  record: { title: `테스트 올림 ${n}: 첫 들임`, changes: [`테스트 올림 ${n}: 배포는 화요일 ${n}시`], why: ['시험'], touchesEmpty: '시험', tags },
  sections: [{ doc: `테스트 올림 ${n}`, heading: '배포 창', content: `배포는 화요일 ${n}시에 한다.` }],
  names: [{ coord: `주제:테스트_올림_${n}`, label: `테스트 올림 ${n} 배포 창`, doc: `테스트 올림 ${n}`, heading: '배포 창', gist: `테스트 올림 ${n} 의 배포를 하는 요일과 시각을 적은 항목` }],
  forms: [{ name: `테스트 올림 ${n}`, kind: '서술' }],
})
const proposeOk = async (inp, who = P.wr) => {
  const p = await mcp('propose', inp, who)
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  return p
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-stage-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), kdir())
  fs.rmSync(path.join(kdir(), 'work'), { recursive: true, force: true })
  fs.writeFileSync(path.join(kdir(), 'README.md'), '# 올림 지식\n')
  s = await startServer({ root: path.join(tmp, 'kn'), data: path.join(tmp, 'data'), port: 0, log: () => {}, scryptN: 1 << 15 })
  P.boss = await signIn(s, { id: 'boss', admin: true })
  for (const id of ['wr', 'wr2', 'rd', 'no']) P[id] = await signIn(s, { id, admin: false })
  await seat(s, 'wr', { [KN]: 'write' })
  await seat(s, 'wr2', { [KN]: 'write' })
  await seat(s, 'rd', { [KN]: 'read' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('올리기 판정: 쓰기 기기 열쇠 200 { ref, bytes } · 멱등 · sha 어긋남 E_INPUT · 읽기 403 · 없음 404 · 에이전트 · 기계 · 쿠키 403 · 자리는 지식 폴더 밖', async () => {
  const buf = docx('판정', '한 줄')
  const a = await put(P.wr, buf)
  assert.equal(a.status, 200, JSON.stringify(a.j))
  assert.deepEqual([a.j.ref, a.j.bytes], [`sha256:${a.sha}`, buf.length])
  const f = path.join(homeOf('wr'), a.sha)
  assert.ok(fs.existsSync(f), '사람마다 자리')
  assert.ok(f.startsWith(stageRoot()) && !f.startsWith(path.join(tmp, 'kn')), '<살림>/stage 아래 · 지식 폴더 밖(백업 · 보내기 · 지식 폴더 다시 읽기에 들지 않는다)')
  const again = await put(P.wr, buf)
  assert.equal(again.status, 200)
  assert.equal(again.j.same, true)
  assert.equal((await put(P.wr, buf, { sha: 'a'.repeat(64) })).j.error, 'E_INPUT', 'sha 어긋남')
  assert.equal((await put(P.wr, buf, { sha: 'XYZ' })).j.error, 'E_INPUT', 'sha 꼴')
  const rd = await put(P.rd, buf)
  assert.deepEqual([rd.status, rd.j.error], [403, 'E_FORBIDDEN'])
  const no = await put(P.no, buf)
  assert.deepEqual([no.status, no.j.error], [404, 'E_NOTFOUND'])
  assert.equal((await put(null, buf)).status, 401)
  const ak = s.hub.agentToken(KN, null, null, { team: true })
  const ag = await put(null, buf, { auth: `Bearer ${ak}` })
  assert.deepEqual([ag.status, ag.j.error], [403, 'E_FORBIDDEN'], '에이전트 열쇠')
  const m = await s.auth.machineAdd({ kn: KN, source: 'test-원천' })
  const mc = await put(null, buf, { auth: `Bearer ${m.key}` })
  assert.deepEqual([mc.status, mc.j.error], [403, 'E_FORBIDDEN'], '기계 열쇠')
  const ck = await put(null, buf, { cookie: P.wr.cookie })
  assert.equal(ck.status, 403, '쿠키(화면)는 올리지 않는다')
  assert.equal((await req(`/api/k/${KN}/stage/${a.sha}`, P.wr, {})).status, 405, 'POST 는 받지 않는다')
})

test('올리기 한도: 32MB 넘음 413 · stageMax E_RATE · stageTotal E_RATE · 24시간 지난 것은 걷는다', async () => {
  const big = await put(P.wr, Buffer.alloc((32 << 20) + 1))
  assert.deepEqual([big.status, big.j?.error], [413, 'E_TOO_BIG'])
  const c0 = { ...s.hub.config }
  try {
    s.hub.config.stageMax = 64
    const r = await put(P.wr2, Buffer.alloc(100, 1))
    assert.deepEqual([r.status, r.j.error], [429, 'E_RATE'])
    delete s.hub.config.stageMax
    s.hub.config.stageTotal = 64
    const r2 = await put(P.wr2, Buffer.alloc(100, 2))
    assert.deepEqual([r2.status, r2.j.error], [429, 'E_RATE'])
  } finally { delete s.hub.config.stageMax; delete s.hub.config.stageTotal; Object.assign(s.hub.config, c0) }
  // 24시간 지난 것
  const old = await put(P.wr2, docx('지남', '오래된 원본'))
  const of = path.join(homeOf('wr2'), old.sha)
  const t = new Date(Date.now() - 25 * 3600_000)
  fs.utimesSync(of, t, t)
  assert.equal((await put(P.wr2, docx('새것', '새 원본'))).status, 200)
  assert.ok(!fs.existsSync(of), '올릴 때 24시간 지난 것을 걷는다')
})

test('참조 첨부: 대량 넣기 save { path, ref } → 들어감 · docs/assets 원본 · attachVia ref · 올린 원본 지움 · 하루 합은 풀린 바이트 · 다시 same(docs/assets 로 풀림)', async () => {
  const name = '테스트 올림 1.docx'
  const buf = docx('배포 창', '배포는 화요일 1시에 한다.')
  const F = await fileOf(name, buf)
  const up = await put(P.wr, buf)
  assert.equal(up.status, 200)
  const inp = bulkInput(1, F.tags)
  const p = await proposeOk(inp)
  const dayFile = path.join(tmp, 'data', 'attach-day.json')
  const day0 = fs.existsSync(dayFile) ? JSON.parse(fs.readFileSync(dayFile, 'utf8'))[KN]?.bytes || 0 : 0
  const r = await mcp('save', { knowledge: KN, proposal: p.proposal, kit: KIT, attach: [{ path: `docs/assets/${name}`, ref: up.j.ref }] })
  assert.ok(r.saved, JSON.stringify(r))
  const last = savelogOf().at(-1)
  assert.equal(last.ch, 'bulk')
  assert.deepEqual(last.attachVia, { b64: 0, ref: 1, b64Kb: 0 })
  assert.ok(fs.readFileSync(path.join(kdir(), 'docs', 'assets', name)).equals(buf), '원본이 docs/assets 에')
  assert.ok(!fs.existsSync(path.join(homeOf('wr'), up.sha)), '들어간 뒤 올린 원본을 지운다')
  const day1 = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'attach-day.json'), 'utf8'))[KN].bytes
  assert.ok(Math.abs(day1 - day0 - buf.length) <= 2, `하루 첨부 합은 풀린 바이트로 센다(base64 길이 셈 · 채움 2자 안): ${day1 - day0} · ${buf.length}`)
  // 이어 하기: 올린 원본 없이 같은 ref · docs/assets 의 sha 가 같은 파일로 풀려 same
  const p2 = await mcp('propose', inp)
  const r2 = await mcp('save', { ...inp, proposal: p2.proposal || 'b'.repeat(64), kit: KIT, attach: [{ path: `docs/assets/${name}`, ref: up.j.ref }] })
  assert.equal(r2.same, true, JSON.stringify(r2))
})

test('참조 첨부 거절: 남이 올린 ref · junction 으로 바꾼 자리 · 바꿔치기 · b64+ref · file · HTTP /save · ingest/ 없는 세션 = E_INPUT(아무것도 쓰지 않음) · 실패 저장은 올린 원본이 남는다', async () => {
  const name = '테스트 올림 2.docx'
  const buf = docx('배포 창', '배포는 화요일 2시에 한다.')
  const F = await fileOf(name, buf)
  const inp = bulkInput(2, F.tags)
  const p = await proposeOk(inp)
  const at = `docs/assets/${name}`
  const ref = `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`
  const n0 = snap(kdir())
  const no = async (attach, extra = {}) => {
    const r = await mcp('save', { knowledge: KN, proposal: p.proposal, kit: KIT, attach, ...extra })
    assert.equal(r.error, 'E_INPUT', JSON.stringify(r))
    assert.equal(snap(kdir()), n0, '아무것도 쓰지 않는다')
    return r
  }
  // 남이 올린 원본: 내 자리에 없고 docs/assets 에도 없다
  assert.equal((await put(P.wr2, buf)).status, 200)
  assert.match((await no([{ path: at, ref }])).message, /올린 원본이 없다/)
  // 바꿔치기: 내 자리의 그 이름 파일이 다른 바이트
  fs.mkdirSync(homeOf('wr'), { recursive: true })
  fs.writeFileSync(path.join(homeOf('wr'), ref.slice(7)), Buffer.from('다른 바이트'))
  assert.match((await no([{ path: at, ref }])).message, /다르다/)
  fs.rmSync(path.join(homeOf('wr'), ref.slice(7)))
  // junction: 내 자리 폴더가 남의 자리를 가리킨다(realpath 가 제자리가 아니다)
  fs.rmSync(homeOf('wr'), { recursive: true, force: true })
  fs.symlinkSync(homeOf('wr2'), homeOf('wr'), 'junction')
  try { assert.match((await no([{ path: at, ref }])).message, /제자리 밖/) } finally { fs.rmSync(homeOf('wr'), { recursive: true, force: true }) }
  // 모양
  await no([{ path: at, ref, b64: buf.toString('base64') }])
  await no([{ path: at, file: 'C:\\Users\\x\\a.docx' }])
  await no([{ path: at, ref: 'sha256:xyz' }])
  // 내 원본을 올린 뒤: ingest/ 없는 세션 저장 · HTTP /save 의 ref 는 받지 않는다
  const mine = await put(P.wr, buf)
  assert.equal(mine.status, 200)
  const plain = await mcp('save', { ...inp, record: { ...inp.record, tags: [] }, proposal: p.proposal, kit: KIT, attach: [{ path: at, ref }] })
  assert.equal(plain.error, 'E_INPUT', JSON.stringify(plain))
  const http = await req(`/api/k/${KN}/save`, P.wr, { ...inp, proposal: p.proposal, attach: [{ path: at, ref }] })
  assert.equal(http.j?.error, 'E_INPUT', JSON.stringify(http.j))
  // 실패한 저장(승인과 다른 지문): 올린 원본은 남아 다시 시도할 수 있다
  const miss = await mcp('save', { ...inp, proposal: 'c'.repeat(64), kit: KIT, attach: [{ path: at, ref }] })
  assert.equal(miss.error, 'E_APPROVE', JSON.stringify(miss))
  assert.ok(fs.existsSync(path.join(homeOf('wr'), mine.sha)), '실패한 저장은 올린 원본을 지우지 않는다')
  const ok = await mcp('save', { knowledge: KN, proposal: miss.details.propose.proposal, kit: KIT, attach: [{ path: at, ref }] })
  assert.ok(ok.saved, JSON.stringify(ok))
  assert.ok(!fs.existsSync(path.join(homeOf('wr'), mine.sha)))
})

test('개인 프로그램에는 올리기 길이 없다(404)', async () => {
  const pcRoot = path.join(tmp, 'pc')
  fs.mkdirSync(pcRoot, { recursive: true })
  const pc = await startServer({ root: pcRoot, data: path.join(tmp, 'pcdata'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const r = await fetch(`${pc.url}/api/k/x/stage/${'a'.repeat(64)}`, { method: 'PUT', body: Buffer.from('x') })
    assert.equal(r.status, 404)
  } finally { await pc.close() }
})

test('24시간 지난 올린 원본은 걷기 전이라도 풀지 않는다(E_INPUT) · 지식을 지우면 stage/<지식> 도 같이 지운다', async () => {
  const name = '테스트 올림 3.docx'
  const buf = docx('배포 창', '배포는 화요일 3시에 한다.')
  const F = await fileOf(name, buf)
  const up = await put(P.wr, buf)
  assert.equal(up.status, 200)
  const f = path.join(homeOf('wr'), up.sha)
  const t = new Date(Date.now() - 25 * 3600_000)
  fs.utimesSync(f, t, t)
  const p = await proposeOk(bulkInput(3, F.tags))
  const r = await mcp('save', { knowledge: KN, proposal: p.proposal, kit: KIT, attach: [{ path: `docs/assets/${name}`, ref: up.j.ref }] })
  assert.equal(r.error, 'E_INPUT', JSON.stringify(r))
  assert.match(r.message, /올린 원본이 없다/)
  assert.ok(fs.existsSync(f), '걷기 전이라 파일은 있지만 풀지 않았다')
  // 지식 지우기
  const home = path.join(stageRoot(), encodeURIComponent(KN))
  assert.ok(fs.existsSync(home))
  const sh = { user: 'boss', admin: true, shell: true }
  const meta = await s.hub.meta(KN, sh)
  await s.hub.deleteKnowledge(sh, KN, { confirm: meta.name })
  assert.ok(!fs.existsSync(home), '지식을 지우면 올린 원본 자리도 지운다')
})
