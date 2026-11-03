// 저장 문 core — 기록 + 조각 + 표지가 한 저장 · 한 커밋(docs/품질개선/KMD_개편_설계.md S3 · core/save.js · core/parts.js · core/knowledge.js)
//   서버(hub.save · S4): 속도 한도 · 같은 저장(md/) · 메모 · 넣지 못함(값 · 표 · 되돌림 잦은 문서) · 바로잡기 자리 · sent/ · 측정 줄 · 이 PC 는 그대로

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { save, saveRecords, assetPath } from '../core/save.js'
import { begin } from '../core/journal.js'
import { ensureRepo, tryGit } from '../core/git.js'
import { loadKnowledge, isLegacy } from '../core/knowledge.js'
import { decide } from '../core/curate.js'
import { parseHeld, parsePut, renderPut, parseReverted, renderReverted, renderHeld, dropPart } from '../core/parts.js'
import { isReservedTag } from '../core/names.js'
import { valueDiff } from '../core/values.js'
import { httpStatusOf } from '../core/errors.js'
import { copyDir, signIn, seat } from './helpers.mjs'
import { startServer } from '../server/http.js'
import { sha16 } from '../core/text.js'
import { sectionOf } from '../core/knowledge.js'
import { valuesOf as valuesIn } from '../core/values.js'

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

test('칸 쓰고 읽기: 넣은 것 · 넣지 못함(울타리 · 마지막 칸만) · 되돌린 항목 · 떼기', () => {
  const put = renderPut([{ doc: DOC, heading: '롤백', from: '5분', to: '10분' }, { doc: DOC, heading: '값: 설명', from: '', to: '3' }, { doc: 'docs/회의록.md', heading: '2026-10-21 HNC 통화', isNew: true }])
  assert.match(put, /^## 넣은 것\n- docs\/배포절차\.md › 롤백: 5분 → 10분\n/)
  assert.deepEqual(parsePut(`사람 글\n\n## 넣은 것\n- docs/x.md › 가짜\n\n${put}`), [
    { doc: DOC, heading: '롤백', from: '5분', to: '10분', isNew: false },
    { doc: DOC, heading: '값: 설명', from: '', to: '3', isNew: false },
    { doc: 'docs/회의록.md', heading: '2026-10-21 HNC 통화', from: '', to: '', isNew: true },
  ])
  const held = renderHeld([{ doc: DOC, heading: '롤백', code: 'values', why: '기록의 값이 글에 없다: 5분', content: '```\n코드\n```' }])
  assert.match(held, /^## 넣지 못함\n````json\n/, '울타리는 글 안 가장 긴 백틱 줄보다 하나 길게')
  assert.equal(parseHeld(`앞\n\n${held}`)[0].content, '```\n코드\n```')
  const big = renderHeld([{ doc: DOC, heading: '롤백', code: 'format', why: '꼴', content: 'x'.repeat(50_000) }])
  assert.equal(parseHeld(big)[0].content, undefined, '4만 자를 넘으면 content 를 떼고 까닭만')
  const rv = renderReverted([{ rec: '2026-1103-롤백', doc: DOC, heading: '롤백' }])
  assert.deepEqual(parseReverted(rv), [{ rec: '2026-1103-롤백', doc: DOC, heading: '롤백' }])
  assert.equal(dropPart(`글\n\n${put}\n\n${held}`, '넣지 못함'), `글\n\n${put}`)
  assert.equal(dropPart(`글\n\n${put}\n\n${held}`, '넣은 것'), `글\n\n${held}`)
  assert.deepEqual(valueDiff('시간 초과는 3초', '시간 초과는 5초'), { from: '3초', to: '5초' })
  assert.equal(valueDiff('같은 10분', '여전히 10분'), null)
  assert.ok(['held', 'memo', 'intake', 'polish', 'revert', 'put', 'drop', 'job/abc'].every(isReservedTag))
  assert.equal(httpStatusOf('E_RATE'), 429)
})

test('옵션 없는 저장은 옛 결과 그대로: 기록 + 문서 + 장부가 커밋 하나 · 새 표지 · 칸 없음', async () => {
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
  assert.ok(!/\n {2}- put\n/.test(read(r.record)))
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

let putRec
test('partial: 문서 · 머리로 넣은 항목은 put 태그 + 「넣은 것」(옛 값 → 새 값) · 없는 항목은 held 태그 + json · 기록은 남는다', async () => {
  const r = await save(dir, {
    record: { title: '헬스 체크 시간 초과 5초', body: '시간 초과를 5초 로 늘린다.' },
    sections: [
      { doc: DOC, heading: '헬스 체크', content: '각 서버의 `/health` 를 30초마다 부른다. 시간 초과는 5초 — 5초 안에 200 이 와야 통과. 배포 뒤 서버 상태는 이것으로 본다.' },
      { coord: 'proc:없는 항목', content: '어디에도 없는 항목.' },
    ],
  }, { ...LEE, partial: true })
  putRec = r.id
  assert.deepEqual(r.docs, [DOC])
  assert.equal(r.put, 1)
  assert.deepEqual(r.held.map((x) => x.code), ['notfound'])
  const body = read(r.record)
  assert.match(body, /## 넣은 것\n- docs\/배포절차\.md › 헬스 체크: 3초 → 5초/)
  assert.equal(parseHeld(body)[0].content, '어디에도 없는 항목.', '다시 들이기 재료')
  const k = await load()
  const w = k.byWork.get(r.id)
  assert.ok(w.tags.includes('held') && w.tags.includes('put'))
  assert.equal(w.state, 'held', '못 넣은 조각이 하나라도 있으면 넣지 못함')
  assert.equal(await status(), '')
})

test('put 기록은 그 항목에 다음 저장이 들어가도 「들어감」', async () => {
  const a = await save(dir, { record: { title: '카나리 비율 20%', body: '카나리 첫 30분은 20%.' }, sections: [{ doc: DOC, heading: '카나리', content: '`canary-1` 에 먼저 올리고, 첫 30분은 요청의 20% 만 보낸다. 오류율이 1% 를 넘으면 멈추고 롤백으로 간다.' }] }, { ...LEE, partial: true })
  assert.equal((await load()).byWork.get(a.id).state, 'in')
  await save(dir, { record: { title: '카나리 비율 30%', body: '카나리 첫 30분은 30%.' }, sections: [{ doc: DOC, heading: '카나리', content: '`canary-1` 에 먼저 올리고, 첫 30분은 요청의 30% 만 보낸다. 오류율이 1% 를 넘으면 멈추고 롤백으로 간다.' }] }, { user: 'kim', partial: true })
  const k = await load()
  assert.equal(k.byWork.get(a.id).state, 'in', '표지가 다음 기록으로 바뀌어도')
  // 되돌림 기록이 넣은 항목을 모두 되돌렸으면 「되돌림」(S5 가 쓰는 칸 · 지금은 system 저장으로 흉내)
  await save(dir, { record: { title: `되돌림: ${k.byWork.get(a.id).title}`, body: renderReverted([{ rec: a.id, doc: DOC, heading: '카나리' }]), tags: ['revert'] } }, { user: 'kmd', system: true })
  assert.equal((await load()).byWork.get(a.id).state, 'reverted')
})

test('메모는 문서를 바꾸지 않는다 · 메모에 항목 글은 E_INPUT', async () => {
  const h0 = await head()
  const m = await save(dir, { record: { title: '배포 창 늘릴까', body: '금요일도 배포 창으로 둘지 이야기했다.', memo: true } }, LEE)
  assert.deepEqual(m.docs, [])
  assert.equal(m.memo, true)
  assert.equal(await G('rev-list', '--count', `${h0}..HEAD`), '1')
  assert.equal((await load()).byWork.get(m.id).state, 'memo')
  assert.equal(await code(() => save(dir, { record: { title: '메모', body: '글', memo: true }, sections: [{ doc: DOC, heading: '준비', content: '준비 글.' }] }, LEE)), 'E_INPUT')
  assert.equal(await code(() => save(dir, { record: { title: '메모', body: '글', memo: 'yes' } }, LEE)), 'E_INPUT')
})

test('바로잡힘: held 기록을 fixes 로 가리키면 fixed(R-A3 이 있어도) · touches-fix 의 fixes 는 바로잡힘이 아니다', async () => {
  const old = await save(dir, { record: { title: '넣은 파일: 점검표', body: '점검표 1판.', tags: ['ingest/점검표.md'] }, sections: [{ coord: 'proc:없는 점검', content: '점검표 1판.' }] }, { ...LEE, partial: true })
  const fix = await save(dir, { record: { title: '넣은 파일: 점검표 다시', body: '점검표 2판.', tags: ['ingest/점검표.md'], fixes: [old.id] }, sections: [{ doc: 'docs/배포 체크리스트.md', heading: '점검표', content: '점검표 2판.' }] }, { ...LEE, partial: true })
  let k = await load()
  assert.equal(k.byWork.get(old.id).state, 'fixed')
  assert.ok(!decide(k).curates.some((c) => c.id === old.id), 'R-A3 이 바로잡힘을 「둠」 으로 바꾸지 않는다')
  assert.equal(k.byWork.get(fix.id).state, 'in')
  // 메모를 이름만 바로잡는 기록(touches-fix)이 가리켜도 메모 그대로
  const memo = await save(dir, { record: { title: '경보 메모', body: '경보 이야기.', memo: true } }, LEE)
  await save(dir, { record: { title: '이름 바로잡음: 경보 메모', body: 'lee 가 자리를 골랐다', touches: ['screen:경보 기준'], tags: ['touches-fix'], fixes: [memo.id] } }, { user: 'lee', system: true })
  k = await load()
  assert.equal(k.byWork.get(memo.id).state, 'memo')
  // 개편 전 기록 — 안 넣은 사람 기록 · cutoverAt 앞
  const pend = await save(dir, { record: { title: '롤백 순서 메모', body: '앱 먼저 내린다.', touches: ['proc:롤백'] } }, LEE)
  k = await load()
  assert.equal(k.byWork.get(pend.id).state, 'pend')
  assert.equal(isLegacy(k, k.byWork.get(pend.id)), true, 'cutoverAt 이 없으면 모든 pend')
  k = await load({ cutoverAt: '2000-01-01 00:00' })
  assert.equal(isLegacy(k, k.byWork.get(pend.id)), false, 'cutoverAt 뒤에 온 기록은 개편 전이 아니다')
})

test('kmd 가 쓰는 칸 머리를 본문에 쓴 입력은 E_INPUT', async () => {
  for (const h of ['넣은 것', '넣지 못함', '되돌린 항목']) {
    assert.equal(await code(() => save(dir, { record: { title: '가짜 이력', body: `글\n\n## ${h}\n- docs/배포절차.md › 롤백` } }, LEE)), 'E_INPUT', h)
  }
  assert.equal(await code(() => saveRecords(dir, [{ title: '받은 가짜', body: '## 넣은 것\n- x' }], LEE).then((r) => { if (r.records[0].error) throw r.records[0].error })), 'E_INPUT')
})

test('prepare: 줄 안에서 부르고 결과도 같은 검사 · rename 은 structure 없이 E_FORBIDDEN · abort 는 아무것도 쓰지 않는다', async () => {
  const h0 = await head()
  assert.equal(await code(() => save(dir, { record: { title: '이름 바꾸기', body: '항목 이름을 바꾼다.' } }, { ...LEE, prepare: async () => ({ sections: [{ doc: DOC, heading: '준비', rename: '배포 준비' }] }) })), 'E_FORBIDDEN')
  const r = await save(dir, { record: { title: '같은 저장', body: '같은 것.' } }, { ...LEE, prepare: async () => ({ abort: { same: true, id: '2026-1103-같은' } }) })
  assert.deepEqual(r, { same: true, id: '2026-1103-같은' })
  assert.equal(await head(), h0)
  assert.equal(await status(), '')
  // prepare 가 고른 조각 · 넣지 못함 줄이 그대로 저장된다
  const p = await save(dir, { record: { title: '준비 DB 풀 50', body: 'DB 커넥션 풀을 50 으로.' } }, {
    ...LEE,
    partial: true,
    prepare: async () => ({ sections: [{ doc: DOC, heading: '준비', content: '배포 창은 화 · 목 14:00 ~ 17:00 이다. DB 커넥션 풀은 50 으로 둔다.\n이미지 이름은 날짜-순번으로 짓는다(예 1022-01).' }], held: [{ doc: DOC, heading: '롤백', code: 'values', why: '기록의 값이 글에 없다: 50' }], proposals: [{ coord: 'x', ok: true }] }),
  })
  assert.equal(p.put, 1)
  assert.deepEqual(p.held, [{ doc: DOC, heading: '롤백', code: 'values', why: '기록의 값이 글에 없다: 50' }])
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
  assert.ok(read('docs/백업절차.md').includes('[가져옴](../work/'), 'kmd 가 써도 항목 출처 줄')
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

test('saveRecords: serverTags 는 held 를 붙이고 넣지 못함 칸을 단다 · 입력 held 는 거절', async () => {
  const r = await saveRecords(dir, [{ title: '옛 보내기', body: '옛 판이 보낸 기록.' }, { title: '가짜 held', body: '글', tags: ['held'] }], { user: 'lee', serverTags: ['held'], heldPart: [{ code: 'legacy-send', why: '옛 보내기: 조각 없이 기록만 왔다' }] })
  assert.equal(r.records[1].error.code, 'E_FORBIDDEN')
  const w = (await load()).byWork.get(r.records[0].id)
  assert.ok(w.tags.includes('held'))
  assert.equal(w.state, 'held')
  assert.equal(parseHeld(w.body)[0].code, 'legacy-send')
  assert.equal(await code(() => saveRecords(dir, [{ title: 'x', body: 'y' }], { user: 'lee', serverTags: ['memo'] })), 'E_INPUT')
})

test('partial: 모든 항목이 넣지 못함(저절로 채우는 표 · prepare 의 held)이어도 「이름 없는 기록」 이 아니다 · CRLF 머리도 E_INPUT (S3 검토)', async () => {
  const r = await save(dir, { record: { title: '표 손으로 고침', body: '표를 손으로 고쳤다.' }, sections: [{ doc: DOC, heading: '준비', content: '<!-- baseline x -->\n표' }] }, { ...LEE, partial: true, guard: 'strict' })
  assert.deepEqual(r.held.map((x) => x.code), ['machine'])
  assert.ok(!r.touchesEmpty)
  const p = await save(dir, { record: { title: '값 안 맞음', body: '값이 안 맞는다.' } }, { ...LEE, partial: true, guard: 'strict', prepare: async () => ({ sections: [], held: [{ doc: DOC, heading: '롤백', code: 'values', why: '값이 글에 없다' }] }) })
  assert.deepEqual(p.held.map((x) => x.code), ['values'])
  assert.equal((await load()).byWork.get(p.id).state, 'held')
  assert.equal(await code(() => save(dir, { record: { title: '가짜', body: '글\r\n\r\n## 넣은 것\r\n- docs/배포절차.md › 롤백' } }, LEE)), 'E_INPUT')
  assert.equal(await status(), '')
})

// ── 서버(hub.save · S4) — 자리 · 속도 한도 · 같은 저장 · 메모 · 넣지 못함 · 바로잡기 · 보내기 표지 · 측정 줄 ──
let srv = null
let sroot = null
let me = null
const KIM = { user: 'kim', admin: true }
async function server() {
  if (srv) return srv
  sroot = path.join(tmp, 'srv')
  copyDir(path.join(HERE, 'fixture', 'kmd'), sroot)
  fs.mkdirSync(path.join(sroot, '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(sroot, '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, tidyTickMs: 3600000 }))
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
  const n400 = rs.filter((x) => x.status === 400).length
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

test('서버: 같은 md/ 지문은 same(아무것도 안 씀) · 동시에 둘이면 기록 하나 · 남이 단 지문은 내 저장을 막지 않는다', async () => {
  const s = await server()
  const rec = (n) => ({ record: { title: `테스트 넣은 파일 ${n}`, body: '파일 글.', tags: ['ingest/test-a.md', 'md/0123456789abcdef'], touchesEmpty: '시험 파일' } })
  const n0 = Number(await SG('rev-list', '--count', 'HEAD'))
  const [a, b] = await Promise.all([s.hub.save({ user: 'lee' }, 'dpms', rec(1), { channel: 'bulk' }), s.hub.save({ user: 'lee' }, 'dpms', rec(2), { channel: 'bulk' })])
  const same = [a, b].filter((x) => x.same)
  assert.equal(same.length, 1, '동시에 둘이면 하나만 쓴다')
  assert.equal(same[0].id, [a, b].find((x) => !x.same).id)
  assert.equal(Number(await SG('rev-list', '--count', 'HEAD')), n0 + 1)
  const again = await s.hub.save({ user: 'lee' }, 'dpms', rec(3), { channel: 'bulk' })
  assert.equal(again.same, true)
  // 남(test-b)이 같은 지문을 달아도 lee 의 것과 겹치지 않는다(남의 가짜 기록으로 넣기를 막지 못하게)
  const other = await s.hub.save({ user: 'test-b' }, 'dpms', rec(4), { channel: 'bulk' })
  assert.ok(other.id && !other.same)
  assert.equal(await SG('status', '--porcelain'), '')
})

test('서버: 메모는 문서를 바꾸지 않는다 · 값이 안 맞는 조각 · 저절로 채우는 표를 고친 조각은 넣지 못함(기록은 남는다)', async () => {
  const s = await server()
  const memo = await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 메모: 풀 크기', body: '풀 크기를 늘릴지 본다.', memo: true, touches: ['proc:준비'] } }, { channel: 'session' })
  assert.deepEqual([memo.memo, memo.docs, memo.note], [true, [], '메모로 남겼다. 문서는 바꾸지 않았다'])
  assert.equal((await s.hub.get('dpms')).byWork.get(memo.id).state, 'memo')
  // 세션(MCP 서식 칸 · form) 메모는 changes 없이 된다 · 메모가 아니면 changes 가 꼭 있다(S4 검토)
  const fm = await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 메모: 서식 칸', body: '경보 간격을 줄일지 본다.', why: '아직 정하지 않았다', memo: true, touches: ['proc:준비'] } }, { channel: 'session', form: true, guard: 'strict' })
  assert.equal(fm.memo, true)
  assert.equal((await err(s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 서식 칸', body: '요약.', touches: ['proc:준비'] } }, { channel: 'session', form: true, guard: 'strict' })))?.code, 'E_INPUT')
  assert.equal((await err(s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 메모', body: 'x', memo: true, touches: ['proc:준비'] }, sections: [{ coord: 'proc:준비', base: await baseOf('proc:준비'), content: 'x' }] })))?.code, 'E_INPUT')
  // 값 대조 — 기록의 값이 글에 없다
  const v = await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 값: 알림 간격', body: '## 바뀐 것\n- 알림 간격: 7분', touches: ['proc:준비'] }, sections: [{ coord: 'proc:준비', base: await baseOf('proc:준비'), edits: [{ find: '날짜-순번으로 짓는다', replace: '날짜-순번으로 짓고 알린다' }] }] }, { channel: 'session' })
  assert.deepEqual([v.docs, v.held.map((x) => x.code)], [[], ['values']])
  assert.equal((await s.hub.get('dpms')).byWork.get(v.id).state, 'held')
  // 저절로 채우는 표를 고쳤다 — machine
  const cur = sectionOf(await s.hub.get('dpms'), 'term:꾸러미 판').sec.body
  const m = await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 표 고침', body: '표를 고쳤다.', touches: ['term:꾸러미 판'] }, sections: [{ coord: 'term:꾸러미 판', base: sha16(cur), content: `${cur}\n\n<!-- baseline: src="가짜" rule=deps asof="2026-01-01" -->\n| a |\n|---|\n<!-- /baseline -->` }] }, { channel: 'session' })
  assert.deepEqual(m.held.map((x) => x.code), ['machine'])
  assert.equal(sectionOf(await s.hub.get('dpms'), 'term:꾸러미 판').sec.body, cur, '표는 그대로')
})

test('서버: 7일 안에 두 번 되돌린 문서는 값을 바꾸는 조각만 넣지 못함(reverts)', async () => {
  const s = await server()
  for (const n of [41, 42]) {
    const r = await s.hub.save(KIM, 'dpms', { record: { title: `테스트 창 ${n}`, body: `## 바뀐 것\n- 롤백 기다림: ${n}분`, touches: ['proc:카나리'] }, sections: [{ doc: '서버목록', heading: `테스트 기다림 ${n}`, content: `롤백 전에 ${n}분 기다린다.` }] })
    assert.equal(r.put, 1, JSON.stringify(r.held))
    await s.hub.revert(KIM, 'dpms', { record: r.id })
  }
  const d = (await s.hub.get('dpms')).docs.find((x) => x.id === '서버목록')
  const sec = d.sections.find((x) => x.h === '점검 시간')
  const add = await s.hub.save(KIM, 'dpms', { record: { title: '테스트 값 더하기', body: '## 바뀐 것\n- 메모: 서버 이름 규칙은 그대로' }, sections: [{ doc: '서버목록', heading: sec.h, base: sha16(sec.body), content: `${sec.body}\n\n서버 이름 규칙은 그대로 둔다.` }] })
  assert.equal(add.put, 1, '값을 바꾸지 않는 조각은 그대로 들어간다')
  const vals = [...valuesIn(sec.body)]
  assert.ok(vals.length, '값이 든 항목')
  const d2 = (await s.hub.get('dpms')).docs.find((x) => x.id === '서버목록').sections.find((x) => x.h === sec.h)
  const from = vals[0]
  const to = /\d/.test(from) ? from.replace(/\d/, (x) => String((Number(x) + 1) % 10)) : `${from}-2`
  const chg = await s.hub.save(KIM, 'dpms', { record: { title: '테스트 값 바꿈', body: `## 바뀐 것\n- 값: ${from} → ${to}` }, sections: [{ doc: '서버목록', heading: sec.h, base: sha16(d2.body), content: d2.body.replace(from, to) }] })
  assert.deepEqual(chg.held?.map((x) => x.code), ['reverts'], JSON.stringify(chg.proposals))
})

test('서버: 남의 기록을 fixes 로 가리키면 403 · 내 기록은 된다 · sent/ 는 보내기만 · 앞 저장 바로 뒤 같은 항목 저장은 헛 E_CONFLICT 없이', async () => {
  const s = await server()
  const mine = await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 내 메모', body: '내 메모.', memo: true, touchesEmpty: '시험' } })
  const kims = await s.hub.save(KIM, 'dpms', { record: { title: '테스트 김 메모', body: '김의 메모.', memo: true, touchesEmpty: '시험' } })
  assert.equal((await err(s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 바로잡음', body: '바로잡는다.', fixes: [kims.id], touchesEmpty: '시험' } })))?.code, 'E_FORBIDDEN')
  const fx = await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 바로잡음', body: '바로잡는다.', fixes: [mine.id], touchesEmpty: '시험' } })
  assert.equal((await s.hub.get('dpms')).byWork.get(mine.id).state, 'fixed')
  assert.ok(fx.id)
  assert.ok((await s.hub.save(KIM, 'dpms', { record: { title: '테스트 관리자 바로잡음', body: '바로잡는다.', fixes: [fx.id], touchesEmpty: '시험' } })).id, '지식관리자는 남의 기록도')
  assert.equal((await err(s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 보낸 척', body: 'x', tags: ['sent/0123456789abcdef'], touchesEmpty: '시험' } }, { channel: 'session' })))?.code, 'E_INPUT')
  // 앞 저장 바로 뒤 — 새로 읽은 지식으로 보므로 새 base 로 보낸 다음 저장이 헛 E_CONFLICT 로 넘어지지 않는다
  const b0 = await baseOf('proc:카나리')
  const one = s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 카나리 하나', body: '## 바뀐 것\n- 지켜보기: 대시보드', touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', base: b0, edits: [{ find: '롤백으로 간다.', replace: '롤백으로 간다. 대시보드로 지켜본다.' }] }] }, { channel: 'session' })
  const r1 = await one
  assert.equal(r1.put, 1, JSON.stringify(r1.proposals))
  const b1 = await baseOf('proc:카나리')
  const r2 = await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 카나리 둘', body: '## 바뀐 것\n- 알림: 운영 채널', touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', base: b1, edits: [{ find: '대시보드로 지켜본다.', replace: '대시보드로 지켜보고 운영 채널에 알린다.' }] }] }, { channel: 'session' })
  assert.equal(r2.put, 1, JSON.stringify(r2.proposals))
})

test('서버: 측정 줄(savelog) — 저장마다 한 줄 · E_CONFLICT 도 · 측정 줄을 못 써도 저장은 성공', async () => {
  const s = await server()
  const f = path.join(sroot, '.kmd', 'savelog', 'dpms.jsonl')
  const lines = () => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const n0 = fs.existsSync(f) ? lines().length : 0
  const r = await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 측정', body: '## 바뀐 것\n- 측정: 한 줄', touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', base: await baseOf('proc:카나리'), edits: [{ find: '롤백으로 간다.', replace: '롤백으로 간다. 측정 줄을 남긴다.' }] }] }, { channel: 'session' })
  const l = lines().slice(n0)
  assert.equal(l.length, 1)
  assert.deepEqual([l[0].kn, l[0].user, l[0].ch, l[0].rec, l[0].n, l[0].put, l[0].err], ['dpms', 'lee', 'session', r.id, 1, 1, null])
  await err(s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 늦음', body: '## 바뀐 것\n- x: 1', touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', base: '0000000000000000', edits: [{ find: '롤백으로 간다.', replace: '롤백으로 간다 1.' }] }] }, { channel: 'session' }))
  const last = lines().pop()
  assert.deepEqual([last.err, last.stale], ['E_CONFLICT', ['proc:카나리']])
  // 측정 줄 자리를 막아도(파일이 아닌 폴더) 저장은 성공
  fs.rmSync(path.join(sroot, '.kmd', 'savelog'), { recursive: true, force: true })
  fs.writeFileSync(path.join(sroot, '.kmd', 'savelog'), '막음')
  const ok = await s.hub.save({ user: 'lee' }, 'dpms', { record: { title: '테스트 측정 막힘', body: '메모.', memo: true, touchesEmpty: '시험' } }, { channel: 'session' })
  assert.ok(ok.id && ok.memo)
  fs.rmSync(path.join(sroot, '.kmd', 'savelog'), { force: true })
})

test('이 PC 는 지금 그대로(S-D52): 항목 글은 곧바로 문서에 · 조각 검사 · 넣지 못함 표지 없음', async () => {
  const proot = path.join(tmp, 'pc')
  copyDir(path.join(HERE, 'fixture', 'kmd'), proot)
  const pc = await startServer({ root: proot, data: path.join(tmp, 'pcdata'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    const r = await pc.hub.save({ user: 'kim' }, 'dpms', { record: { title: '롤백: 앱 먼저', body: '앱을 먼저 내린다.' }, sections: [{ coord: 'proc:롤백', content: '앱을 먼저 이전 판으로 내리고, 그다음 DB 를 되돌린다.' }] }, { noCurate: true })
    assert.deepEqual([r.docs, r.put, r.held, r.proposals], [['docs/배포절차.md'], undefined, undefined, undefined], '섞인 자리 · base 없음도 지금처럼 곧바로')
    assert.ok(!(await pc.hub.get('dpms')).byWork.get(r.id).tags.includes('put'))
  } finally { await pc.close() }
})
