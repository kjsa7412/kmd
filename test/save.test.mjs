// 저장 문 core — 기록 + 항목 글 + 표지가 한 저장 · 한 커밋(docs/품질개선/KMD_개편_설계.md S3 · core/save.js · core/parts.js · core/knowledge.js)
//   서버(hub.save · S4): 속도 한도 · 같은 저장(md/) · 메모 거절 · 걸린 항목은 입력 오류(아무것도 쓰지 않음) · 바로잡기 자리 · sent/ · 측정 줄 · 이 PC 는 그대로

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { save, assetPath } from '../core/save.js'
import { begin } from '../core/journal.js'
import { ensureRepo, tryGit } from '../core/git.js'
import { loadKnowledge } from '../core/knowledge.js'
import { parsePut, renderPut, parseReverted, renderReverted, dropPart, metaRefsOf } from '../core/parts.js'
import { parseDoc } from '../core/sections.js'
import { isReservedTag } from '../core/names.js'
import { valueDiff, rowsAdded } from '../core/values.js'
import { httpStatusOf } from '../core/errors.js'
import { copyDir, signIn, seat } from './helpers.mjs'
import { startServer } from '../server/http.js'
import { sha16 } from '../core/text.js'
import { sectionOf } from '../core/knowledge.js'
import { valuesOf as valuesIn } from '../core/values.js'
import { makeMcp } from '../server/mcp.js'
import { TEAM_KIT_REV } from '../core/teamkit.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOC = 'docs/배포절차.md'
let tmp, dir
const read = (rel) => fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8')
const G = async (...a) => (await tryGit(dir, a)).out.trim()
const status = () => G('status', '--porcelain', '-uall')
const head = () => G('rev-parse', 'HEAD')
const load = (opt) => loadKnowledge({ id: 'dpms', name: 'dpms', dir }, opt)
const code = (f) => Promise.resolve().then(f).then(() => 'ok', (e) => e.code)
const LEE = { user: 'lee' }

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-save-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  dir = path.join(tmp, 'dpms')
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), dir)
  await ensureRepo(dir)
})
after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('칸 쓰고 읽기: 넣은 것 · 되돌린 항목 · 떼기(json 칸은 울타리째)', () => {
  const put = renderPut([{ doc: DOC, heading: '롤백', from: '5분', to: '10분' }, { doc: DOC, heading: '값: 설명', from: '', to: '3' }, { doc: 'docs/회의록.md', heading: '2026-10-21 HNC 통화', isNew: true }])
  assert.match(put, /^## 넣은 것\n- docs\/배포절차\.md › 롤백: 5분 → 10분\n/)
  assert.deepEqual(parsePut(`사람 글\n\n## 넣은 것\n- docs/x.md › 가짜\n\n${put}`), [
    { doc: DOC, heading: '롤백', from: '5분', to: '10분', isNew: false },
    { doc: DOC, heading: '값: 설명', from: '', to: '3', isNew: false },
    { doc: 'docs/회의록.md', heading: '2026-10-21 HNC 통화', from: '', to: '', isNew: true },
  ])
  // 새 값만 · 새 표 행 · 뺀 값만(채널 평가 P16): 줄표 없이 「새로: 행 이름 값」 · 「뺌: 옛 값」 · 옛 기록의 「— → 새」 도 읽는다
  const put2 = renderPut([{ doc: DOC, heading: '점검', from: '', to: '09:00, 21:00', rows: ['정기 점검 09:00', '야간 점검 21:00'] }, { doc: DOC, heading: '값: 설명', from: '3', to: '' }])
  assert.equal(put2, `## 넣은 것\n- ${DOC} › 점검: 새로: 정기 점검 09:00 · 새로: 야간 점검 21:00\n- ${DOC} › 값: 설명: 뺌: 3`)
  assert.ok(!put.includes('—') && !put2.includes('—'))
  assert.deepEqual(parsePut(put2).map((x) => [x.heading, x.from, x.to]), [['점검', '', '정기 점검 09:00, 야간 점검 21:00'], ['값: 설명', '3', '']])
  assert.deepEqual(parsePut(`## 넣은 것\n- ${DOC} › 값: 설명: — → 3`).map((x) => [x.heading, x.from, x.to]), [['값: 설명', '', '3']])
  assert.deepEqual(rowsAdded('| 일 | 때 |\n|---|---|\n| 백업 | 02:00 |', '| 일 | 때 |\n|---|---|\n| 백업 | 02:00 |\n| 정기 점검 | 09:00 |\n| 야간 점검 | `21:00` |', '09:00, 21:00'), ['정기 점검 09:00', '야간 점검 21:00'])
  // 표 행과 표 밖 값이 섞였다(gate 검토) — 행이 덮지 못한 값(재시도 3회의 3)도 「새로: 값」 으로 남는다
  const mixOld = '수집 주기는 5초다.\n\n| 일 | 때 |\n|---|---|\n| 백업 | 02:00 |'
  const mixNew = '수집 주기는 5초다. 재시도는 3회다.\n\n| 일 | 때 |\n|---|---|\n| 백업 | 02:00 |\n| 정기 점검 | 09:00 |'
  const mixD = valueDiff(mixOld, mixNew)
  const mixRows = rowsAdded(mixOld, mixNew, mixD.to)
  assert.deepEqual(mixRows, ['정기 점검 09:00', '3'], JSON.stringify(mixD))
  assert.equal(renderPut([{ doc: DOC, heading: '점검', ...mixD, rows: mixRows }]), `## 넣은 것\n- ${DOC} › 점검: 새로: 정기 점검 09:00 · 새로: 3`)
  // json 칸(받아들인 경고)은 울타리 끝까지 뗀다(울타리 안의 「## 」 줄에서 멈추지 않는다)
  const held = '## 받아들인 경고\n```json\n[{ "id": "x",\n## "why": "가짜" }]\n```'
  const rv = renderReverted([{ rec: '2026-1103-롤백', doc: DOC, heading: '롤백' }])
  assert.deepEqual(parseReverted(rv), [{ rec: '2026-1103-롤백', doc: DOC, heading: '롤백' }])
  assert.equal(dropPart(`글\n\n${put}\n\n${held}`, '받아들인 경고'), `글\n\n${put}`)
  assert.equal(dropPart(`글\n\n${put}\n\n${held}`, '넣은 것'), `글\n\n${held}`)
  assert.deepEqual(valueDiff('시간 초과는 3초', '시간 초과는 5초'), { from: '3초', to: '5초' })
  assert.equal(valueDiff('같은 10분', '여전히 10분'), null)
  // 링크 대상 주소 안의 수는 값이 아니다(%20 · %28 · 포트 · 경로) · 링크 글의 수는 값
  assert.deepEqual([...valuesIn('[배포 창](../a/x.md#%EB%B0%B0%ED%8F%AC%20%28%EC%B0%BD%29) 은 10분 · [홈 3](https://ex.com:8090/a/2026) · <https://h.io/7>')], ['10분', '3'])
  assert.equal(valueDiff('[가](x.md#a%201) 5분', '[가](x.md#a%202) 5분'), null)
  assert.ok(['held', 'memo', 'intake', 'polish', 'revert', 'put', 'drop', 'job/abc'].every(isReservedTag))
  assert.equal(httpStatusOf('E_RATE'), 429)
})

test('옵션 없는 저장: 기록 + 문서 + 장부가 커밋 하나 · 새 표지 · 넣은 것 칸 없음 · 항목 글을 썼으니 put', async () => {
  const h0 = await head()
  const r = await save(dir, {
    record: { title: '꾸러미 서버 이름', body: '꾸러미는 pkg-1 에 둔다.' },
    sections: [{ coord: 'term:운영 서버', content: 'app-1 ~ app-4 · 꾸러미는 pkg-1.' }],
    names: [{ coord: 'term:꾸러미서버', label: '꾸러미 서버', doc: 'docs/서버목록.md', heading: '꾸러미 서버' }],
  }, LEE)
  assert.equal(await G('rev-list', '--count', `${h0}..HEAD`), '1')
  const files = (await G('show', '--name-only', '--format=', 'HEAD')).split('\n')
  assert.ok(files.includes(r.record) && files.includes('docs/서버목록.md') && files.includes('_vocab.md') && files.includes('_managed.md'), files.join(' '))
  assert.equal(r.put, undefined)
  assert.equal(r.held, undefined)
  assert.ok(!read(r.record).includes('## 넣은 것'))
  assert.ok(/\n {2}- put\n/.test(read(r.record)), '항목 글을 쓴 기록은 put(기록 상태는 put 으로만 가른다)')
  assert.equal(await status(), '')
})

test('문서 쓰기가 넘어지면 기록도 되돌린다(반쯤 쓴 저장 없음)', async () => {
  const h0 = await head()
  fs.mkdirSync(path.join(dir, 'docs', '막힘.md'))
  fs.writeFileSync(path.join(dir, 'docs', '막힘.md', 'x.txt'), 'x')
  const works = fs.readdirSync(path.join(dir, 'work')).length
  await assert.rejects(save(dir, { record: { title: '막힌 문서', body: '막힌 문서에 넣는다.' }, sections: [{ doc: 'docs/막힘.md', heading: '가', content: '가 글.' }] }, LEE))
  assert.equal(fs.readdirSync(path.join(dir, 'work')).length, works)
  assert.equal(await head(), h0)
  fs.rmSync(path.join(dir, 'docs', '막힘.md'), { recursive: true, force: true })
  assert.equal(await status(), '')
})

test('원본 메타(문서 번호 · 판)는 기록 근거 칸에서 그 문서의 (문서) 메모 「글 출처:」 로 · 요약 · 항목 글이 아니다(채널 평가 P22)', async () => {
  assert.deepEqual(metaRefsOf('요약.\n\n## 바뀐 것\n- 가: 1 → 2\n\n## 근거\n- 게이트웨이 설계서 v0.3 · 문서 번호 GW-DS-001\n- 커밋 a1b2c3d v1.2\n- [앞 기록](../work/x.md)\n- 회의에서 정함'), ['글 출처: 게이트웨이 설계서 v0.3 · 문서 번호 GW-DS-001'])
  assert.deepEqual(metaRefsOf('## 근거\n- 운영 지침 2판\n- 장애 대응 절차'), ['글 출처: 운영 지침 2판'])
  assert.deepEqual(metaRefsOf('## 까닭\n- v0.3 이라서'), [], '근거 칸만')
  const body = '새 문서를 세운다.\n\n## 바뀐 것\n- 테스트 원본 메타: 새 항목\n\n## 근거\n- 테스트 설계서 v0.3 · 문서 번호 TS-DS-001'
  const r = await save(dir, { record: { title: '테스트 원본 메타', body }, sections: [{ doc: 'docs/테스트 원본 메타.md', heading: '개요', content: '수집 주기는 5초다.' }] }, LEE)
  const doc = parseDoc(read('docs/테스트 원본 메타.md'), '')
  assert.deepEqual(doc.docLog, ['- 글 출처: 테스트 설계서 v0.3 · 문서 번호 TS-DS-001'])
  assert.ok(!/v0\.3|TS-DS/.test(doc.sections.map((y) => y.body).join('\n') + doc.intro), '본문 · 요약에 없다')
  assert.equal(await status(), '', '한 커밋')
  // 같은 메타로 다시 저장하면 줄이 늘지 않는다
  await save(dir, { record: { title: '테스트 원본 메타 둘', body: body.replace('새 항목', '값 바꿈') }, sections: [{ doc: 'docs/테스트 원본 메타.md', heading: '개요', content: '수집 주기는 10초다.' }] }, LEE)
  assert.deepEqual(parseDoc(read('docs/테스트 원본 메타.md'), '').docLog, ['- 글 출처: 테스트 설계서 v0.3 · 문서 번호 TS-DS-001'])
  assert.ok(r.id)
})

let putRec
test('put 기록은 그 항목에 다음 저장이 들어가도 「들어감」', async () => {
  const a = await save(dir, { record: { title: '카나리 비율 20%', body: '카나리 첫 30분은 20%.' }, sections: [{ doc: DOC, heading: '카나리', content: '`canary-1` 에 먼저 올리고, 첫 30분은 요청의 20% 만 보낸다. 오류율이 1% 를 넘으면 멈추고 롤백으로 간다.' }] }, { ...LEE, marks: true })
  assert.equal((await load()).byWork.get(a.id).state, 'in')
  await save(dir, { record: { title: '카나리 비율 30%', body: '카나리 첫 30분은 30%.' }, sections: [{ doc: DOC, heading: '카나리', content: '`canary-1` 에 먼저 올리고, 첫 30분은 요청의 30% 만 보낸다. 오류율이 1% 를 넘으면 멈추고 롤백으로 간다.' }] }, { user: 'kim', marks: true })
  const k = await load()
  assert.equal(k.byWork.get(a.id).state, 'in', '표지가 다음 기록으로 바뀌어도')
  // 되돌림 기록이 넣은 항목을 모두 되돌렸으면 「되돌림」(S5 가 쓰는 칸 · 지금은 system 저장으로 흉내)
  await save(dir, { record: { title: `되돌림: ${k.byWork.get(a.id).title}`, body: renderReverted([{ rec: a.id, doc: DOC, heading: '카나리' }]), tags: ['revert'] } }, { user: 'kmd', system: true })
  assert.equal((await load()).byWork.get(a.id).state, 'reverted')
})

test('메모(기록만)는 남기지 않는다 — memo 는 늘 E_INPUT(P11 · P12)', async () => {
  const h0 = await head()
  assert.equal(await code(() => save(dir, { record: { title: '배포 창 늘릴까', body: '금요일도 배포 창으로 둘지 이야기했다.', memo: true } }, LEE)), 'E_INPUT')
  assert.equal(await head(), h0, '아무것도 쓰지 않았다')
  assert.equal(await code(() => save(dir, { record: { title: '메모', body: '글', memo: true }, sections: [{ doc: DOC, heading: '준비', content: '준비 글.' }] }, LEE)), 'E_INPUT')
  assert.equal(await code(() => save(dir, { record: { title: '메모', body: '글', memo: 'yes' } }, LEE)), 'E_INPUT')
})

test('kmd 가 쓰는 칸 머리를 본문에 쓴 입력은 E_INPUT', async () => {
  for (const h of ['넣은 것', '넣지 못함', '되돌린 항목']) {
    assert.equal(await code(() => save(dir, { record: { title: '가짜 이력', body: `글\n\n## ${h}\n- docs/배포절차.md › 롤백` } }, LEE)), 'E_INPUT', h)
  }
})

test('prepare: 줄 안에서 부르고 결과도 같은 검사 · rename 은 structure 없이 E_FORBIDDEN · abort 는 아무것도 쓰지 않는다', async () => {
  const h0 = await head()
  assert.equal(await code(() => save(dir, { record: { title: '이름 바꾸기', body: '항목 이름을 바꾼다.' } }, { ...LEE, prepare: async () => ({ sections: [{ doc: DOC, heading: '준비', rename: '배포 준비' }] }) })), 'E_FORBIDDEN')
  const r = await save(dir, { record: { title: '같은 저장', body: '같은 것.' } }, { ...LEE, prepare: async () => ({ abort: { same: true, id: '2026-1103-같은' } }) })
  assert.deepEqual(r, { same: true, id: '2026-1103-같은' })
  assert.equal(await head(), h0)
  assert.equal(await status(), '')
  // prepare 가 걸린 항목(held)을 실으면 아무것도 쓰지 않는 입력 오류(넣지 못함은 없다 · P11)
  const sec = { doc: DOC, heading: '준비', content: '배포 창은 화 · 목 14:00 ~ 17:00 이다. DB 커넥션 풀은 50 으로 둔다.' }
  const bad = await save(dir, { record: { title: '준비 DB 풀 50', body: 'DB 커넥션 풀을 50 으로.' } }, { ...LEE, prepare: async () => ({ sections: [sec], held: [{ doc: DOC, heading: '롤백', code: 'values', why: '기록의 값이 글에 없다: 50' }] }) }).then(() => null, (e) => e)
  assert.equal(bad?.code, 'E_INPUT')
  assert.deepEqual(bad.details.fail.map((x) => x.code), ['values'])
  assert.equal(await head(), h0)
  // prepare 가 고른 항목 글이 그대로 저장된다
  const p = await save(dir, { record: { title: '준비 DB 풀 50', body: 'DB 커넥션 풀을 50 으로.' } }, { ...LEE, marks: true, prepare: async () => ({ sections: [sec], proposals: [{ coord: 'x', ok: true }] }) })
  assert.equal(p.put, 1)
  assert.equal(p.held, undefined)
  assert.deepEqual(p.proposals, [{ coord: 'x', ok: true }])
  assert.match(read(DOC), /DB 커넥션 풀은 50 으로/)
})

test('남은 저널은 prepare 앞에서 되돌린다', async () => {
  const was = read(DOC)
  const j = await begin(dir)
  await j.add(DOC)
  fs.writeFileSync(path.join(dir, DOC), '반쯤 쓴 글')
  let seen = null
  await save(dir, { record: { title: '저널 뒤 저장', body: '저널 뒤에 남긴다.' } }, { ...LEE, prepare: async () => ((seen = read(DOC)), {}) })
  assert.equal(seen, was)
  assert.equal(await status(), '')
})

test('intake: 사람 kmd · 저장 문이 붙이는 태그 · 참고 줄을 단다 · 문서 꼴은 그대로 본다', async () => {
  const r = await save(dir, { record: { title: '가져옴: 백업 시각', body: '매일 백업은 02:00 으로 옮겼다.' }, sections: [{ coord: 'proc:매일 백업', content: '매일 02:00 에 전체 백업을 한다.' }] }, { user: 'kmd', intake: { tags: ['job/j-1', 'code-change'] } })
  const w = (await load()).byWork.get(r.id)
  assert.equal(w.author, 'kmd')
  assert.ok(['intake', 'job/j-1', 'code-change', 'put'].every((t) => w.tags.includes(t)), w.tags.join(' '))
  assert.ok(read('docs/백업절차.md').includes('[가져옴: 백업 시각](../work/'), 'kmd 가 써도 항목 출처 줄')
  assert.equal(await code(() => save(dir, { record: { title: '주석 넣기', body: '주석.' }, sections: [{ coord: 'proc:매일 백업', content: '매일 02:00.\n<!-- 몰래 -->' }] }, { user: 'kmd', intake: { tags: [] } })), 'E_FORMAT')
  assert.equal(await code(() => save(dir, { record: { title: 'x', body: 'y' } }, { user: 'kmd' })), 'E_FORBIDDEN', 'intake 없이 kmd')
  assert.equal(await code(() => save(dir, { record: { title: 'x', body: 'y' } }, { user: 'kmd-auto', intake: {} })), 'E_FORBIDDEN', 'kmd-auto 는 아니다')
  assert.equal(await code(() => save(dir, { record: { title: 'x', body: 'y', tags: ['intake'] } }, { user: 'kmd', intake: {} })), 'E_FORBIDDEN', '입력 태그로 온 예약 태그는 거절')
  assert.equal(await code(() => save(dir, { record: { title: 'x', body: 'y' } }, { user: 'kmd', intake: { tags: ['held'] } })), 'E_INPUT')
})

test('attach: 같은 커밋 · 같은 글은 건너뜀 · 다른 글은 E_CONFLICT · 자리 검사', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
  const r = await save(dir, { record: { title: '배포 그림', body: '배포 흐름 그림을 붙였다.' }, attach: [{ path: 'docs/assets/배포/흐름2.png', b64: png }] }, LEE)
  assert.ok((await G('show', '--name-only', '--format=', 'HEAD')).split('\n').includes('docs/assets/배포/흐름2.png'))
  assert.deepEqual(r.attach, { put: ['docs/assets/배포/흐름2.png'], same: [] })
  const again = await save(dir, { record: { title: '배포 그림 다시', body: '같은 그림.' }, attach: [{ path: 'assets/배포/흐름2.png', b64: png }] }, LEE)
  assert.deepEqual(again.attach, { put: [], same: ['docs/assets/배포/흐름2.png'] })
  const h0 = await head()
  assert.equal(await code(() => save(dir, { record: { title: '다른 그림', body: '다른 그림.' }, attach: [{ path: 'docs/assets/배포/흐름2.png', b64: Buffer.from('다른').toString('base64') }] }, LEE)), 'E_CONFLICT')
  assert.equal(await head(), h0, '아무것도 쓰지 않았다')
  for (const p of ['docs/assets/../x.png', 'docs/assets/CON.png', 'docs/assets/a:b.png', 'docs/assets/x.exe', 'docs/x.png', 'docs\\assets\\x.png']) assert.throws(() => assetPath(dir, p), (e) => e.code === 'E_INPUT', p)
  assert.equal(await status(), '')
})

// ── 서버(hub.save · S4) — 자리 · 속도 한도 · 같은 저장 · 메모 거절 · 입력 오류 · 바로잡기 · 보내기 표지 · 측정 줄 ──
let srv = null
let sroot = null
let me = null
const KIM = { user: 'kim', admin: true }
async function server() {
  if (srv) return srv
  sroot = path.join(tmp, 'srv')
  copyDir(path.join(HERE, 'fixture', 'kmd'), sroot)
  fs.mkdirSync(path.join(sroot, '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(sroot, '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, inboxTickMs: 3600000 }))
  srv = await startServer({ root: sroot, port: 0, log: () => {}, scryptN: 1 << 15 })
  me = await signIn(srv, { id: 'kim' })
  for (const u of ['lee', 'test-b']) {
    await srv.auth.addUser({ id: u, admin: false })
    await seat(srv, u, { dpms: 'write' })
  }
  return srv
}
after(async () => { await srv?.close() })
const sdir = () => path.join(sroot, 'dpms')
const SG = async (...a) => (await tryGit(sdir(), a)).out.trim()
const baseOf = async (coord) => sha16(sectionOf(await srv.hub.get('dpms'), coord).sec.body)
const err = (p) => p.then(() => null, (e) => e)

test('서버: 31번째 저장은 E_RATE(429 · Retry-After) · 서버 안의 저장은 세지 않는다', async () => {
  const s = await server()
  // 속도는 자리 검사 뒤 · 입력 검사 앞에서 뺀다 — 빨리 넘어지는 잘못된 입력 30번으로 통을 비운다
  const post = (body) => fetch(s.url + '/api/k/dpms/save', { method: 'POST', headers: { 'content-type': 'application/json', cookie: me.cookie }, body: JSON.stringify(body) })
  //   동시에 45번 — 통(1분 30)이 비면 429 · 그사이 채워지는 토큰(초당 0.5)은 몇 개뿐이다
  const rs = await Promise.all(Array.from({ length: 45 }, () => post({ record: { title: '' } })))
  const n400 = rs.filter((x) => x.status === 400 || x.status === 428).length // 428 — 승인 없음(P11 · 모든 팀 지식)
  assert.ok(n400 >= 30 && n400 <= 35, `통 30 + 그사이 채워진 몇 개만 지난다: ${n400}`)
  assert.equal(n400 + rs.filter((x) => x.status === 429).length, 45)
  const r = rs.find((x) => x.status === 429)
  assert.ok(Number(r.headers.get('retry-after')) >= 1)
  const j = await r.json()
  assert.equal(j.error, 'E_RATE')
  assert.ok(j.details.retryAfter >= 1)
  // 서버 안의 저장(채널 없음)은 세지 않는다
  const ok = await s.hub.save(KIM, 'dpms', { record: { title: '테스트 서버 안 저장', body: 'x', touchesEmpty: '시험' } })
  assert.ok(ok.id)
})

test('서버: 남의 기록을 fixes 로 가리키면 403 · 내 기록은 된다 · sent/ 는 보내기만 · 앞 저장 바로 뒤 같은 항목 저장은 헛 E_CONFLICT 없이', async () => {
  const s = await server()
  const mine = await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 내 기록', body: '내 기록.', touchesEmpty: '시험' } })
  const kims = await s.hub.save(KIM, 'dpms', { record: { title: '테스트 김 기록', body: '김의 기록.', touchesEmpty: '시험' } })
  assert.equal((await err(s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 바로잡음', body: '바로잡는다.', fixes: [kims.id], touchesEmpty: '시험' } })))?.code, 'E_FORBIDDEN')
  const fx = await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 바로잡음', body: '바로잡는다.', fixes: [mine.id], touchesEmpty: '시험' } })
  assert.equal((await s.hub.get('dpms')).byWork.get(mine.id).state, 'fixed')
  assert.ok(fx.id)
  assert.ok((await s.hub.save(KIM, 'dpms', { record: { title: '테스트 관리자 바로잡음', body: '바로잡는다.', fixes: [fx.id], touchesEmpty: '시험' } })).id, '지식관리자는 남의 기록도')
  assert.equal((await err(s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 보낸 척', body: 'x', tags: ['sent/0123456789abcdef'], touchesEmpty: '시험' } }, { channel: 'session' })))?.code, 'E_INPUT')
  // 앞 저장 바로 뒤 — 새로 읽은 지식으로 보므로 새 base 로 보낸 다음 저장이 헛 E_CONFLICT 로 넘어지지 않는다
  const b0 = await baseOf('proc:카나리')
  const one = s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 카나리 하나', body: '## 바뀐 것\n- 지켜보기: 대시보드', touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', base: b0, edits: [{ find: '롤백으로 간다.', replace: '롤백으로 간다. 대시보드로 지켜본다.' }] }] })
  const r1 = await one
  assert.equal(r1.put, 1, JSON.stringify(r1.proposals))
  const b1 = await baseOf('proc:카나리')
  const r2 = await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 카나리 둘', body: '## 바뀐 것\n- 알림: 운영 채널', touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', base: b1, edits: [{ find: '대시보드로 지켜본다.', replace: '대시보드로 지켜보고 운영 채널에 알린다.' }] }] })
  assert.equal(r2.put, 1, JSON.stringify(r2.proposals))
})

// 대량 넣기(S11 · K6-3 · K6-4) — 가짜 세션이 스킬 kmd-team-import 대로: kmd-parse 의 tags 를 단 파일마다 save 하나 · 다시 돌리면 same ·
//   원본 첨부는 같은 저장 덩이(attach · 같은 커밋) · 한 번 8MB · /mcp 본문은 들어온 사람만 12MB(넘으면 413)
const read2 = (rel) => fs.readFileSync(path.join(sdir(), ...rel.split('/')), 'utf8')


// 채널 평가 T10 ⑧: stage 를 주면 저장 문의 걸음마다 ms 를 더한다(측정만 · 결과 · 쓰기와 무관)
test('단계 시각: stage 에 wait · recover · prepare · check · write · commit · after 가 든다', async () => {
  const stage = {}
  const r = await save(dir, { record: { title: '테스트 단계 시각', body: '단계 시각을 잰다.' }, sections: [{ doc: 'docs/테스트 단계 시각.md', heading: '개요', content: '수집 주기는 5초다.' }] }, { ...LEE, stage, prepare: async () => ({}) })
  assert.ok(r.commit)
  for (const k of ['wait', 'recover', 'prepare', 'check', 'write', 'commit', 'after']) assert.equal(typeof stage[k], 'number', k)
  assert.ok(stage._t0 <= stage._t)
  assert.equal(await status(), '')
})
