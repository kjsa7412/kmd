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
import { fileToMd, ingestFp, ingestTags } from '../core/importer.js'
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
  // 올린 원본은 그 사람만(T20): 폴더 700 · 파일 600(POSIX 만 · Windows 는 모드를 쓰지 않는다)
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(f).mode & 0o777, 0o600, '파일 600')
    for (const d of [homeOf('wr'), path.dirname(homeOf('wr')), stageRoot()]) assert.equal(fs.statSync(d).mode & 0o777, 0o700, `폴더 700: ${d}`)
  }
  assert.ok(f.startsWith(stageRoot()) && !f.startsWith(path.join(tmp, 'kn')), '<살림>/stage 아래 · 지식 폴더 밖(백업 · 보내기 · 지식 폴더 다시 읽기에 들지 않는다)')
  // 모드를 좁히기 전에 올린 것(644 · 755)도 같은 원본을 다시 올리면(same) 좁힌다
  if (process.platform !== 'win32') { fs.chmodSync(f, 0o644); fs.chmodSync(homeOf('wr'), 0o755) }
  const again = await put(P.wr, buf)
  assert.equal(again.status, 200)
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(f).mode & 0o777, 0o600, '다시 올린 same 도 파일 600')
    assert.equal(fs.statSync(homeOf('wr')).mode & 0o777, 0o700, '다시 올린 same 도 폴더 700')
  }
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
  const att1 = [{ path: `docs/assets/${name}`, ref: up.j.ref }]
  const p = await proposeOk({ ...inp, attach: att1 })
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
  //   제안은 증명을 넘고(원본이 docs/assets 로 풀림) 항목이 이미 있어 오류 · 저장은 같은 표지로 same
  const p2 = await mcp('propose', { ...inp, attach: att1 })
  assert.notEqual(p2.error, 'E_INPUT', JSON.stringify(p2))
  const r2 = await mcp('save', { ...inp, proposal: p2.proposal || 'b'.repeat(64), kit: KIT, attach: att1 })
  assert.equal(r2.same, true, JSON.stringify(r2))
})

test('참조 첨부 거절: 남이 올린 ref · junction 으로 바꾼 자리 · 바꿔치기 · b64+ref · file · HTTP /save · ingest/ 없는 세션 = E_INPUT(아무것도 쓰지 않음) · 실패 저장은 올린 원본이 남는다', async () => {
  const name = '테스트 올림 2.docx'
  const buf = docx('배포 창', '배포는 화요일 2시에 한다.')
  const F = await fileOf(name, buf)
  const inp = bulkInput(2, F.tags)
  const at = `docs/assets/${name}`
  const ref = `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`
  // 제안도 원본으로 증명한다(T18): 올려서 제안받은 뒤 내 올린 자리를 비운다(아래 거절 시험의 바탕)
  const up0 = await put(P.wr, buf)
  assert.equal(up0.status, 200)
  const p = await proposeOk({ ...inp, attach: [{ path: at, ref }] })
  fs.rmSync(path.join(homeOf('wr'), up0.sha))
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

// 글 원천(채널 평가 T18 · T19): md · txt · csv 는 첨부를 짓지 않고 올린 원본(source)으로 md/ 지문을 증명한다 · 제안에서 먼저 걸린다 · 기록 id 에 원본 확장자가 없다
test('글 원천: 파서 tags 그대로 + source → propose · save 들어감(첨부 없음 · 올린 원본 지움 · 다시 same) · 기록 id 에 .md 가 없다', async () => {
  const name = '테스트 백업 절차.md'
  const buf = Buffer.from('# 테스트 백업 절차\n\n백업은 매일 2시에 한다.\n')
  const fp = ingestFp((await fileToMd(name, buf)).md, buf)
  const tags = ingestTags(name, fp)
  const up = await put(P.wr, buf)
  assert.equal(up.status, 200)
  const source = { path: name, ref: up.j.ref }
  const inp = { ...bulkInput(4, tags), record: { ...bulkInput(4, tags).record, title: `${name}: 백업 시각` } }
  // 고치기 전(188 T18): tags 그대로 · 첨부 없음 → 승인 뒤 save 에서 처음 E_INPUT 이었다 · 이제 source 가 없으면 제안에서 걸린다
  const bare = await mcp('propose', inp)
  assert.equal(bare.error, 'E_INPUT', JSON.stringify(bare))
  const p = await proposeOk({ ...inp, source })
  const r = await mcp('save', { knowledge: KN, proposal: p.proposal, kit: KIT, source })
  assert.ok(r.saved, JSON.stringify(r))
  assert.equal(savelogOf().at(-1).ch, 'bulk')
  assert.doesNotMatch(r.saved, /\.md/, `기록 id 에 원본 확장자가 없다: ${r.saved}`)
  assert.match(r.saved, /테스트-백업-절차/)
  assert.ok(fs.readdirSync(path.join(kdir(), 'work')).every((x) => !/\.md\.md$/.test(x)), '기록 파일 이름에 .md.md 가 없다')
  assert.ok(!fs.existsSync(path.join(kdir(), 'docs', 'assets', name)), '글 원천은 docs/assets 에 두지 않는다')
  assert.ok(!fs.existsSync(path.join(homeOf('wr'), up.sha)), '들어간 뒤 올린 원본을 지운다')
  // 이어 하기: 파서가 다시 올리고 같은 표지 → same
  assert.equal((await put(P.wr, buf)).status, 200)
  const p2 = await mcp('propose', { ...inp, source })
  assert.notEqual(p2.error, 'E_INPUT', JSON.stringify(p2))
  const r2 = await mcp('save', { ...inp, proposal: p2.proposal || 'b'.repeat(64), kit: KIT, source })
  assert.equal(r2.same, true, JSON.stringify(r2))
})

test('글 원천 거절: 지문 틀림 · tags 만 흉내 · 경로 다름 · 남이 올린 것 · b64 를 직접 · 첨부 꼴을 source 로 · ingest/ 없는 source · HTTP /save = E_INPUT(아무것도 쓰지 않음)', async () => {
  const name = '테스트 장비 메모.txt'
  const buf = Buffer.from('장비는 열 대다.\n')
  const fp = ingestFp((await fileToMd(name, buf)).md, buf)
  const tags = ingestTags(name, fp)
  const ref = `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`
  const n0 = snap(kdir())
  const noP = async (inp, why) => {
    const r = await mcp('propose', inp)
    assert.equal(r.error, 'E_INPUT', `${why}: ${JSON.stringify(r)}`)
    return r
  }
  // 남이 올린 원본: 내 자리에 없다
  assert.equal((await put(P.wr2, buf)).status, 200)
  assert.match((await noP({ ...bulkInput(5, tags), source: { path: name, ref } }, '남이 올린 것')).message, /올린 글 원천이 없다/)
  assert.equal((await put(P.wr, buf)).status, 200)
  // 지문 틀림
  assert.match((await noP({ ...bulkInput(5, [tags[0], 'md/0123456789abcdef']), source: { path: name, ref } }, '지문 틀림')).message, /지문이/)
  // tags 만 흉내(원본 없음)
  await noP(bulkInput(5, tags), 'tags 만')
  // 경로가 ingest/ 와 다르다
  assert.match((await noP({ ...bulkInput(5, tags), source: { path: '다른 이름.txt', ref } }, '경로 다름')).message, /경로가/)
  // b64 를 직접 실은 source · 모르는 칸
  await noP({ ...bulkInput(5, tags), source: { path: name, b64: buf.toString('base64') } }, 'b64 직접')
  await noP({ ...bulkInput(5, tags), source: { path: name, ref, b64: 'x' } }, '모르는 칸')
  // 첨부 원천(docx)을 source 로
  const dbuf = docx('배포 창', '배포는 화요일 5시에 한다.')
  const dname = '테스트 올림 5.docx'
  const dF = await fileOf(dname, dbuf)
  const dup = await put(P.wr, dbuf)
  assert.match((await noP({ ...bulkInput(5, dF.tags), source: { path: dname, ref: dup.j.ref } }, '첨부 꼴')).message, /attach 로/)
  // ingest/ 없는 세션의 source(제안 · 저장)
  await noP({ ...bulkInput(5, []), source: { path: name, ref } }, 'ingest/ 없는 source')
  const okp = await proposeOk(bulkInput(5, []))
  const ps = await mcp('save', { ...bulkInput(5, []), proposal: okp.proposal, kit: KIT, source: { path: name, ref } })
  assert.equal(ps.error, 'E_INPUT', JSON.stringify(ps))
  // HTTP /save 의 source 는 받지 않는다
  const http = await req(`/api/k/${KN}/save`, P.wr, { ...bulkInput(5, tags), proposal: okp.proposal, source: { path: name, ref } })
  assert.equal(http.j?.error, 'E_INPUT', JSON.stringify(http.j))
  // 승인된 제안이 있어도 save 의 source 가 지문을 못 넘으면 E_INPUT(제안 해시는 원본을 보지 않는다 · 저장 문이 다시 증명한다)
  const good = await proposeOk({ ...bulkInput(5, tags), source: { path: name, ref } })
  const other = Buffer.from('장비는 스무 대다.\n')
  const oup = await put(P.wr, other)
  const bad = await mcp('save', { knowledge: KN, proposal: good.proposal, kit: KIT, source: { path: name, ref: oup.j.ref } })
  assert.equal(bad.error, 'E_INPUT', JSON.stringify(bad))
  assert.equal(snap(kdir()), n0, '아무것도 쓰지 않는다')
})

// 검토 지적(5c496b2 뒤): 첨부도 ingest/ 경로와 대 본다 · 원본이 없으면 다시 설치 안내 · NFC · 대량 넣기가 아닌 제안의 attach 는 떼어 버린다
test('증명 경계: 첨부 경로 다름 E_INPUT · 원본 없음은 팀 키트 다시 설치 안내 · NFD 경로도 받음 · 대량 넣기 밖 제안의 attach 는 버리고 판정', async () => {
  const dname = '테스트 올림 6.docx'
  const dbuf = docx('배포 창', '배포는 화요일 6시에 한다.')
  const dF = await fileOf(dname, dbuf)
  const dup = await put(P.wr, dbuf)
  // 첨부의 docs/assets/<경로> 가 ingest/ 와 다르다(지문은 맞아도)
  const wrongPath = await mcp('propose', { ...bulkInput(6, dF.tags), attach: [{ path: 'docs/assets/다른 파일.docx', ref: dup.j.ref }] })
  assert.equal(wrongPath.error, 'E_INPUT', JSON.stringify(wrongPath))
  assert.match(wrongPath.message, /docs\/assets/)
  await proposeOk({ ...bulkInput(6, dF.tags), attach: [{ path: `docs/assets/${dname}`, ref: dup.j.ref }] })
  // 표지만 있고 원본이 없다: 옛 판 스킬 세션이 고칠 길(다시 설치)을 알린다
  const none = await mcp('propose', bulkInput(6, dF.tags))
  assert.equal(none.error, 'E_INPUT')
  assert.match(none.message, /다시 설치/)
  // 경로를 NFD 로 옮겨도(macOS 파일 이름) 같은 경로로 본다
  const name = '테스트 한글 메모.md'
  const buf = Buffer.from('# 테스트 한글 메모\n\n메모는 한 줄이다.\n')
  const tags = ingestTags(name, ingestFp((await fileToMd(name, buf)).md, buf))
  const up = await put(P.wr, buf)
  await proposeOk({ ...bulkInput(7, tags), source: { path: name.normalize('NFD'), ref: up.j.ref } })
  // 대량 넣기가 아닌 제안: attach(빈 목록 · 사람이 「원본도 첨부」 한 b64)는 떼고 판정한다 · source 는 거절
  const http = await req(`/api/k/${KN}/propose`, P.wr, { ...bulkInput(8, []), attach: [] })
  assert.equal(http.status, 200, JSON.stringify(http.j))
  await proposeOk({ ...bulkInput(8, []), attach: [{ path: 'docs/assets/테스트 첨부.txt', b64: Buffer.from('첨부').toString('base64') }] })
  const src = await mcp('propose', { ...bulkInput(8, []), source: { path: name, ref: up.j.ref } })
  assert.equal(src.error, 'E_INPUT', JSON.stringify(src))
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
  // 제안에서 먼저 걸린다(승인 전 · T18)
  const r = await mcp('propose', { ...bulkInput(3, F.tags), attach: [{ path: `docs/assets/${name}`, ref: up.j.ref }] })
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

