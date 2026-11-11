// 이행 도구(저장 승인 P8 · scripts/kmd-migrate.mjs held-scan · held-put · 세션 스킬 kmd-migrate) — 격리 사본에서만
//   진단 수(넣지 못함 줄 code · 승인 기다림 · 메모 · 개편 전 기록 · held/ 원천 · 기록 모음 · 이슈 갈래) · 깨끗하지 않은 저장소 거절 ·
//   사람이 고를 기록이 있으면 거절 · 지식마다 커밋 하나(태그로 되돌리기 자리) · 옛 기록은 들어간 기록 · 항목 글 그대로 ·
//   이슈 갈래가 있으면 이슈 항목 · 없으면 기록 모음 달 항목 · 다시 돌리면 할 일 없음 · 그 뒤 총괄 관리자의 승인 저장 켜기가 된다

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureRepo, tryGit } from '../core/git.js'
import { loadKnowledge } from '../core/knowledge.js'
import { renderRecord } from '../core/frontmatter.js'
import { renderHeld, parseLinked } from '../core/parts.js'
import { localStamp } from '../core/save.js'
import { copyDir } from './helpers.mjs'
import { main } from '../scripts/kmd-migrate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOC = 'docs/배포절차.md'
let tmp, root, data, cur
const kd = (id) => path.join(root, id)
const load = (id) => loadKnowledge({ id, name: id, dir: kd(id) }, { team: true })
const git = async (id, ...a) => (await tryGit(kd(id), a)).out.trim()
async function run(...argv) {
  const out = []
  const log = console.log
  const err = console.error
  console.log = (...a) => out.push(a.join(' '))
  console.error = (...a) => out.push(a.join(' '))
  process.exitCode = 0
  let thrown = null
  try {
    await main(argv)
  } catch (e) {
    thrown = e
  } finally {
    console.log = log
    console.error = err
  }
  const code = process.exitCode
  process.exitCode = 0
  return { text: out.join('\n'), code, thrown }
}
const rec = (id, { date, title, touches = [], touchesEmpty = null, tags = [], body }) => fs.writeFileSync(path.join(kd(cur), 'work', `${id}.md`), renderRecord({ id, title, date, author: '김', touches, touchesEmpty, tags }, body))
const held = (rows) => renderHeld(rows)
const sec = async (id, doc, h) => (await load(id)).byDocPath.get(doc)?.sections.find((s) => s.h === h)?.body
const H = { H1: '2026-1022-헬스-값', H2: '2026-1016-카나리-옛', H3: '2026-1025-배포-창-승인', H4: '2026-1027-헬스-새-주소', M1: '2026-1018-카나리-메모', M2: '2026-1005-분기-메모', M3: '2026-1026-롤백-상한', L: '2026-1023-롤백-순서' }

async function makeKn(id, { issue, recs }) {
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), kd(id))
  cur = id
  if (issue) fs.writeFileSync(path.join(kd(id), '_forms.md'), '# 갈래 장부\n\n| 갈래 | 다른 이름 | 폴더 | 종류 | 이름 | 서식 |\n|---|---|---|---|---|---|\n| 이슈 대장 | 이슈 | - | 대장 | - | 지식문서 |\n')
  recs()
  await ensureRepo(kd(id))
  await tryGit(kd(id), ['add', '-A'])
  await tryGit(kd(id), ['commit', '-qm', '옛 기록'])
}
const heldRecs = () => {
  rec(H.H1, { date: '2026-10-22 10:00', title: '헬스 체크 값', touches: ['proc:헬스 체크'], tags: ['held'], body: `헬스 체크 값을 적었다.\n\n${held([{ doc: DOC, heading: '헬스 체크', code: 'values', why: '값 대조', content: '각 서버의 `/health` 를 30초마다 부른다.' }])}` })
  rec(H.H2, { date: '2026-10-16 10:00', title: '카나리 옛 서버', touches: ['proc:카나리'], tags: ['held'], body: `카나리 서버를 적었다.\n\n${held([{ doc: DOC, heading: '카나리', code: 'values', why: '값 대조', content: '`canary-2` 에 먼저 올린다.' }])}` })
  rec(H.H3, { date: '2026-10-25 10:00', title: '배포 창 바꿈', touches: ['proc:준비'], tags: ['held'], body: `배포 창을 바꾸자고 했다.\n\n${held([{ doc: DOC, heading: '준비', code: 'review', why: '승인을 기다린다', content: '배포 창은 `월 · 수 10:00 ~ 12:00` 이다.' }])}` })
  rec(H.H4, { date: '2026-10-27 10:00', title: '헬스 체크 새 주소', touches: ['proc:헬스 체크'], tags: ['held'], body: `헬스 주소를 바꾸자고 했다.\n\n${held([{ doc: DOC, heading: '헬스 체크', code: 'values', why: '근거에 없는 값', content: '각 서버의 `/livez` 를 부른다.' }])}` })
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-migrate-held-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  root = path.join(tmp, 'kn')
  data = path.join(tmp, 'data')
  // kn1 — 이슈 갈래가 있고 갈래마다 하나씩(넣지 못함: 값이 글에 있음 · 낡음 · 열림 / 승인 기다림 / 메모: 글에 있음 · 이름 없음 · 글에 없음 / 개편 전 기록(사본에 있던 것))
  await makeKn('kn1', {
    issue: true,
    recs: () => {
      heldRecs()
      rec(H.M1, { date: '2026-10-18 10:00', title: '카나리 서버 메모', touches: ['proc:카나리'], tags: ['memo'], body: '카나리 서버는 `canary-1` 이다.' })
      rec(H.M2, { date: '2026-10-05 10:00', title: '분기 메모', touchesEmpty: '아직 정할 곳이 없다', tags: ['memo'], body: '다음 분기에 다시 본다.' })
      rec(H.M3, { date: '2026-10-26 10:00', title: '롤백 시간 상한', touches: ['proc:롤백'], tags: ['memo'], body: '롤백 시간 상한은 `15분` 이다.' })
    },
  })
  // kn2 — 이슈 갈래가 없다: 열린 넣지 못함은 기록 모음 달 항목으로
  await makeKn('kn2', { issue: false, recs: () => rec(H.H4, { date: '2026-10-27 10:00', title: '헬스 체크 새 주소', touches: ['proc:헬스 체크'], tags: ['held'], body: `헬스 주소를 바꾸자고 했다.\n\n${held([{ doc: DOC, heading: '헬스 체크', code: 'values', why: '근거에 없는 값', content: '각 서버의 `/livez` 를 부른다.' }])}` }) })
  fs.mkdirSync(path.join(data, 'held', 'kn1'), { recursive: true })
  fs.writeFileSync(path.join(data, 'held', 'kn1', `${H.H4}.md`), '원천')
})
after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})


const CUT = ['--cutover', 'none']
const put = (id, ...more) => run('held-put', kd(id), '--user', 'boss', ...CUT, ...more)
const planFile = (name, j) => {
  const p = path.join(tmp, name)
  fs.writeFileSync(p, JSON.stringify(j))
  return p
}

test('held-scan: 갈래마다 수 · 기록마다 상태와 할 일 · 읽기만', async () => {
  const h0 = await git('kn1', 'rev-parse', 'HEAD')
  const r = await run('held-scan', kd('kn1'), '--data', data, '--json')
  assert.equal(r.thrown, null, String(r.thrown))
  const j = JSON.parse(r.text)
  assert.deepEqual(
    { held: j.sum.held, review: j.sum.review, memo: j.sum.memo, memoOff: j.sum.memoOff, legacy: j.sum.legacy, recordsDoc: j.sum.recordsDoc, issueForm: j.sum.issueForm, rebuild: j.sum.rebuild, heldFiles: j.sum.heldFiles, ready: j.sum.ready, left: j.sum.left },
    { held: 3, review: 1, memo: 3, memoOff: 1, legacy: 1, recordsDoc: false, issueForm: '이슈 대장', rebuild: 2, heldFiles: 1, ready: false, left: 8 },
  )
  assert.deepEqual(j.sum.heldCodes, { review: 1, values: 3 })
  const by = Object.fromEntries(j.recs.map((x) => [x.id, x]))
  assert.equal(by[H.H1].status, 'in')
  assert.deepEqual(by[H.H1].links, [{ doc: DOC, heading: '헬스 체크' }])
  assert.equal(by[H.H2].status, 'stale')
  assert.equal(by[H.H2].rows[0].by, '2026-1017-카나리', '대신한 기록')
  assert.equal(by[H.H3].kind, 'review')
  assert.equal(by[H.H3].rebuild, true, '승인 기다림의 값이 글에 없으면 사람이 고른다')
  assert.equal(by[H.H4].issue.doc, 'docs/이슈 대장.md', '열린 넣지 못함 = 이슈 갈래가 있으면 이슈 항목')
  assert.equal(by[H.M1].status, 'in')
  assert.deepEqual(by[H.M1].links, [{ doc: DOC, heading: '카나리' }])
  assert.equal(by[H.M2].month, '2026-10', '이을 항목이 없는 메모 = 그 달 항목')
  assert.equal(by[H.M3].status, 'open')
  assert.equal(by[H.M3].rebuild, true, '값이 글에 없고 낡지 않은 메모는 사람이 고른다(6-2)')
  assert.equal(by[H.L].kind, 'legacy')
  assert.equal(by[H.L].status, 'trail')
  assert.deepEqual(by[H.L].links, [{ doc: DOC, heading: '롤백' }])
  const t = await run('held-scan', kd('kn1'), '--data', data)
  assert.match(t.text, /\| 승인 기다림\(review\) \| 1 \|/)
  assert.match(t.text, /\| 메모 \| 3 \(값이 글에 없음 1\) \|/)
  assert.match(t.text, /\| 개편 때 \| 모름/)
  assert.match(t.text, /= 아직: 사람이 고를 것 2/)
  assert.equal(await git('kn1', 'rev-parse', 'HEAD'), h0, '읽기만')
  assert.equal(await git('kn1', 'status', '--porcelain'), '')
})

test('held-put 거절(아무것도 안 씀 · 태그 없음): 개편 때 모름 · 깨끗하지 않은 저장소 · 남의 저장소 · 사람이 고를 것 · 고른 것 오류', async () => {
  const h0 = await git('kn1', 'rev-parse', 'HEAD')
  const z = await run('held-put', kd('kn1'), '--user', 'boss')
  assert.equal(z.thrown?.exit, 2)
  assert.match(z.thrown.message, /개편 때를 모른다/)
  fs.writeFileSync(path.join(kd('kn1'), 'stray.txt'), 'x')
  const a = await put('kn1')
  assert.equal(a.thrown?.exit, 2)
  assert.match(a.thrown.message, /커밋하지 않은 바뀜/)
  fs.rmSync(path.join(kd('kn1'), 'stray.txt'))
  // 지식 폴더 자신의 .git 이 없다(바깥 저장소 안의 폴더)
  const inner = path.join(kd('kn1'), 'inner')
  fs.mkdirSync(path.join(inner, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(inner, 'docs', 'x.md'), '# x\n')
  const o = await put('kn1/inner')
  assert.match(o.thrown?.message || '', /자신의 git 저장소가 아니/)
  fs.rmSync(inner, { recursive: true, force: true })
  const b = await put('kn1')
  assert.equal(b.thrown?.exit, 2)
  assert.match(b.thrown.message, new RegExp(`사람이 고를 기록 2: ${H.H3} · ${H.M3}`))
  for (const [j, re] of [
    [{ [H.H1]: 'issue' }, /고를 것이 없다/],
    [{ [H.M3]: 'link' }, /issue · month · rebuild/],
    [{ 'no-such-id': 'month' }, /이행할 옛 기록이 아니다/],
    [{ [H.H3]: 'month', [H.M3]: { do: 'issue', heading: '헬스 체크 새 주소' } }, /이미 있다/],
  ]) {
    const c = await put('kn1', '--plan', planFile('bad.json', j))
    assert.match(c.thrown?.message || '', re, JSON.stringify(j))
  }
  const proto = await put('kn1', '--plan', planFile('proto.json', JSON.parse('{"__proto__": "month"}')))
  assert.match(proto.thrown?.message || '', /사람이 고를 기록 2/, 'prototype 이름은 고른 것이 아니다')
  const d = await run('held-put', kd('kn1'), ...CUT)
  assert.match(d.thrown.message, /--user/)
  const lim = await put('kn1', '--limit', '0')
  assert.match(lim.thrown.message, /--limit/)
  assert.equal(await git('kn1', 'rev-parse', 'HEAD'), h0)
  assert.equal(await git('kn1', 'tag', '-l'), '')
  assert.equal(await git('kn1', 'status', '--porcelain'), '')
})

test('held-put: 지식마다 커밋 하나 · 옛 기록은 이은 항목의 들어간 기록 · 항목 글 그대로 · 이슈 항목 · 기록 모음 달 항목 · 다시 돌리면 할 일 없음', async () => {
  const h0 = await git('kn1', 'rev-parse', 'HEAD')
  const before0 = { health: await sec('kn1', DOC, '헬스 체크'), canary: await sec('kn1', DOC, '카나리'), ready: await sec('kn1', DOC, '준비'), back: await sec('kn1', DOC, '롤백') }
  const plan = planFile('plan.json', { [H.H3]: 'month', [H.M3]: 'issue' })
  const r = await put('kn1', '--plan', plan)
  assert.equal(r.thrown, null, String(r.thrown?.stack || r.thrown))
  const j = JSON.parse(r.text)
  assert.equal(j.ok, true)
  assert.equal(j.moved, 8)
  assert.equal(j.issues, 2)
  assert.equal(j.ready, true)
  assert.equal(j.left, 0)
  assert.equal(await git('kn1', 'rev-list', '--count', `${h0}..HEAD`), '1', '커밋 하나')
  assert.equal(await git('kn1', 'rev-parse', `${j.backup}^{commit}`), h0, '되돌리기 태그 = 이행 앞 HEAD')
  assert.equal(await git('kn1', 'status', '--porcelain'), '')
  const k = await load('kn1')
  for (const id of Object.values(H)) assert.equal(k.byWork.get(id).state, 'in', `${id} 이행 뒤 들어간 기록`)
  const m = k.byWork.get(j.record)
  assert.ok(m.tags.includes('put') && m.tags.includes('migrate-held'), JSON.stringify(m.tags))
  assert.equal(m.state, 'in')
  assert.deepEqual([...m.fixes].sort(), Object.values(H).sort())
  assert.match(m.body, /개편 때: 없음/)
  const linked = parseLinked(m.body).map((x) => `${x.doc} › ${x.heading}`)
  for (const h of ['헬스 체크', '카나리', '롤백']) assert.ok(linked.includes(`${DOC} › ${h}`), `${h} 를 글 그대로 이음: ${linked}`)
  assert.ok(!linked.includes(`${DOC} › 준비`), '고른 month 는 달 항목으로만')
  // 항목 글 그대로(이행은 있던 항목을 고치지 않는다)
  assert.equal(await sec('kn1', DOC, '헬스 체크'), before0.health)
  assert.equal(await sec('kn1', DOC, '카나리'), before0.canary)
  assert.equal(await sec('kn1', DOC, '준비'), before0.ready)
  assert.equal(await sec('kn1', DOC, '롤백'), before0.back)
  // 기록 모음 — 저장 문으로 세움(그 기록의 달 + 이번 달) · 이슈 항목(넣지 못함 · 메모)
  const rd = k.byDocPath.get('docs/기록 모음.md')
  assert.ok(rd, '기록 모음 문서')
  assert.deepEqual(rd.sections.map((s) => s.h).sort(), [...new Set(['2026-10', localStamp(new Date()).slice(0, 7)])].sort())
  assert.equal(rd.sections.find((s) => s.h === '2026-10').applied, j.record)
  const iss = k.byDocPath.get('docs/이슈 대장.md')
  assert.ok(iss?.sections.some((s) => s.h === '헬스 체크 새 주소' && s.body.includes('/livez') && s.body.includes('열림')), JSON.stringify(iss?.sections))
  assert.ok(iss?.sections.some((s) => s.h === '롤백 시간 상한' && s.body.includes('15분')), '메모 이슈 제기')
  // 다시 그리기 재료(b13): 이행 기록 · 옛 넣지 못함 · 메모는 재료가 아니다 · 이행된 개편 전 기록은 재료
  const t = JSON.parse((await run('trail', kd('kn1'), DOC, '헬스 체크', '--json')).text)
  assert.ok(t.records.some((x) => x.id === j.record && x.mark.includes('migrate') && x.how.includes('linked')), '이행 기록 = 표지 migrate')
  assert.ok(t.records.some((x) => x.id === H.H1 && x.mark.includes('held')), '이행된 옛 넣지 못함도 표지 held(재료 밖)')
  const tb = JSON.parse((await run('trail', kd('kn1'), DOC, '롤백', '--json')).text)
  assert.ok(tb.records.some((x) => x.id === H.L && !x.mark.length), '이행된 개편 전 기록은 재료')
  if (process.env.KMD_DUMP) for (const p of [`work/${j.record}.md`, 'docs/기록 모음.md', 'docs/이슈 대장.md']) console.log(fs.readFileSync(path.join(kd('kn1'), p), 'utf8'))
  // 다시 돌리면 할 일 없음 — 커밋 · 태그 그대로(같은 고른 것 파일이어도)
  const tags = await git('kn1', 'tag', '-l')
  const h1 = await git('kn1', 'rev-parse', 'HEAD')
  const again = await put('kn1', '--plan', plan)
  assert.equal(again.thrown, null, String(again.thrown))
  assert.equal(JSON.parse(again.text).same, true)
  assert.equal(await git('kn1', 'rev-parse', 'HEAD'), h1)
  assert.equal(await git('kn1', 'tag', '-l'), tags)
  const s2 = JSON.parse((await run('held-scan', kd('kn1'), '--json')).text)
  assert.equal(s2.sum.ready, true)
})

test('held-put: 이슈 갈래가 없으면 사람이 고른 month 로 기록 모음 · 서버는 늘 승인 저장(P11 · 스위치 없음)', async () => {
  const { startServer } = await import('../server/http.js')
  const s = await startServer({ root, data, port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    assert.equal(s.hub.saveModeOf('kn2'), 'approve')
    const b = await put('kn2')
    assert.match(b.thrown?.message || '', new RegExp(`사람이 고를 기록 1: ${H.H4}`), '이슈 갈래가 없으면 값이 저절로 기록 모음으로 가지 않는다')
    assert.equal(await git('kn2', 'status', '--porcelain'), '', '서버가 돌아도 지식은 깨끗하다')
    const r = await put('kn2', '--plan', planFile('kn2.json', { [H.H4]: 'month' }))
    assert.equal(r.thrown, null, String(r.thrown?.stack || r.thrown))
    const j = JSON.parse(r.text)
    assert.equal(j.issues, 0)
    assert.equal(j.ready, true)
    const k = await load('kn2')
    assert.equal(k.byWork.get(H.H4).state, 'in')
    assert.ok(!k.byDocPath.has('docs/이슈 대장.md'))
    assert.ok(k.byDocPath.get('docs/기록 모음.md').sections.some((x) => x.h === '2026-10'))
  } finally {
    await s.close()
  }
})
