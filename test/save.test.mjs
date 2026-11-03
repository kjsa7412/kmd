// 저장 문 core — 기록 + 조각 + 표지가 한 저장 · 한 커밋(docs/품질개선/KMD_개편_설계.md S3 · core/save.js · core/parts.js · core/knowledge.js)
//   서버(hub.save · 속도 한도 · 같은 저장 · savelog)는 S4 에서 이 파일에 더한다

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
import { copyDir } from './helpers.mjs'

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
