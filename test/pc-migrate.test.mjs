// 개인 지식 이행(저장 승인 PC5 · P-D45 · 6-2-1) — 격리 사본에서만
//   새 판 개인 프로그램이 켤 때 옛 길 개인 지식마다 한 번: 지식백업 먼저(실패면 시작 안 함 + 멈춤 줄 「이행 못함」) ·
//   옛 pend 는 옛 바로 넣기 마지막 한 번 · 둠 · 메모는 이은 항목 이력(글 그대로) · 이름 없는 기록은 기록 모음 달 항목 ·
//   이행 기록 + 기록 모음 + 저장 방식 표지가 커밋 하나 · 되돌리기 · 다시 돌리면 할 일 없음 · 다시 하기

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { copyDir } from './helpers.mjs'
import { ensureRepo, tryGit } from '../core/git.js'
import { renderRecord } from '../core/frontmatter.js'
import { loadKnowledge } from '../core/knowledge.js'
import { parseLinked } from '../core/parts.js'
import { RECORDS_DOC_PATH } from '../core/guard.js'
import { pcPlan } from '../core/migrate.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOC = 'docs/배포절차.md'
const KIM = { user: 'kim' }
let tmp, root, data, pc
const kd = (id) => path.join(root, id)
const git = async (id, ...a) => (await tryGit(kd(id), a)).out.trim()
const load = (id) => loadKnowledge({ id, name: id, dir: kd(id) }, { team: false })
const R = { P: '2026-1020-롤백-시간', K: '2026-1021-준비-둠', C: '2026-1022-정리', M: '2026-1023-카나리-메모', M2: '2026-0905-분기-메모' }

async function makeKn(id) {
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), kd(id))
  fs.rmSync(path.join(kd(id), 'work'), { recursive: true, force: true })
  fs.mkdirSync(path.join(kd(id), 'work'))
  const rec = (rid, head, body) => fs.writeFileSync(path.join(kd(id), 'work', `${rid}.md`), renderRecord({ id: rid, author: 'kim', touches: [], tags: [], ...head }, body))
  rec(R.P, { title: '롤백 시간', date: '2026-10-20 10:00', touches: ['proc:롤백'] }, '롤백은 5분 안에 끝낸다.')
  rec(R.K, { title: '준비 메모', date: '2026-10-21 10:00', touches: ['proc:준비'] }, '준비 때 담당을 다시 본다.')
  rec(R.C, { title: '정리: 준비', date: '2026-10-21 11:00', author: 'kmd-auto', tags: ['curate-auto'], touches: ['proc:준비'], curates: [{ id: R.K, verdict: 'keep', reason: '이미 글에 있다' }] }, '두기')
  rec(R.M, { title: '카나리 서버 메모', date: '2026-10-23 10:00', touches: ['proc:카나리'], tags: ['memo'] }, '카나리 서버는 `canary-9` 이다.')
  rec(R.M2, { title: '분기 메모', date: '2026-09-05 10:00', touchesEmpty: '아직 정할 곳이 없다', tags: ['memo'] }, '다음 분기에 다시 본다.')
  // 있던 사람 칸(CRLF) — 다른 줄은 그대로 두고 저장 방식 줄만 단다
  if (id === 'ok1') fs.writeFileSync(path.join(kd(id), '_members.md'), ['# 사람', '', '- 주인: kim', '- 저장 방식: 옛', ''].join('\r\n'))
  await ensureRepo(kd(id))
  await tryGit(kd(id), ['add', '-A'])
  await tryGit(kd(id), ['-c', 'user.name=kim', '-c', 'user.email=kim@kmd', 'commit', '-qm', '옛 기록'])
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-pc-migrate-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  root = path.join(tmp, 'pc')
  data = path.join(tmp, 'pcdata')
  fs.mkdirSync(root, { recursive: true })
  await makeKn('ok1')
  await makeKn('bad')
  // bad — 지식백업이 닿지 않는 곳에 붙어 있다(보내기 실패)
  const nowhere = path.join(tmp, 'gone', 'bad.git')
  await tryGit(kd('bad'), ['remote', 'add', 'kmd-copy', nowhere])
  fs.mkdirSync(path.join(data, 'copy'), { recursive: true })
  fs.writeFileSync(path.join(data, 'copy', 'bad.json'), JSON.stringify({ url: nowhere, branch: 'main', pushed: null, at: new Date().toISOString() }))
  fs.writeFileSync(path.join(data, 'serve.json'), JSON.stringify({ backupRoot: path.join(tmp, 'bk'), pcMigrateMs: 1500, decideMs: 3600000, inboxTickMs: 3600000 }))
  pc = await startServer({ root, data, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  await pc.hub.pcMigrateWait()
})
after(async () => {
  await pc?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('이행: 켤 때 지식마다 · pend · 둠 · 메모는 이은 항목 이력 · 이름 없는 메모는 달 항목 · 커밋 하나에 표지', async () => {
  assert.equal(pc.hub.saveModeOf('ok1'), 'approve')
  const k = await load('ok1')
  const st = (id) => k.byWork.get(id).state
  assert.equal(st(R.P), 'in', 'pend 도 이은 항목 이력(글 그대로 · 바로 넣기는 PC6 에서 걷었다)')
  assert.doesNotMatch(k.byDocPath.get(DOC).sections.find((s) => s.h === '롤백').body, /5분 안에/, 'pend 값은 본문에 넣지 않는다')
  assert.equal(st(R.K), 'in', '둠 = 이은 항목 이력')
  assert.equal(st(R.M), 'in', '메모 = 이은 항목 이력')
  assert.equal(st(R.M2), 'in')
  assert.doesNotMatch(k.byDocPath.get(DOC).sections.find((s) => s.h === '카나리').body, /canary-9/, '메모 값은 본문에 넣지 않는다')
  // 이행 기록 — 태그 migrate-held · fixes · 이은 항목 · 둔 까닭 · 값이 본문에 없는 메모
  const w = k.works.find((x) => x.tags.includes('migrate-held'))
  assert.ok(w, '이행 기록')
  assert.deepEqual([...w.fixes].sort(), [R.P, R.K, R.M, R.M2].sort())
  const linked = parseLinked(w.body).map((x) => `${x.doc} › ${x.heading}`)
  assert.ok(linked.includes(`${DOC} › 준비`) && linked.includes(`${DOC} › 카나리`), linked.join(' / '))
  assert.match(w.body, /둔 까닭: 이미 글에 있다/)
  assert.match(w.body, /값이 본문에 없는 옛 메모 1/)
  // 기록 모음 + 달 항목(그 기록의 달 · 이번 달)
  const rd = k.byDocPath.get(RECORDS_DOC_PATH)
  assert.ok(rd?.sections.some((s) => s.h === '2026-09'), '이름 없는 메모의 달 항목')
  // 커밋 하나: 이행 기록 + 기록 모음 + 표지
  const files = (await git('ok1', 'show', '--name-only', '--format=', 'HEAD')).split('\n')
  assert.ok(files.includes('_members.md') && files.includes(RECORDS_DOC_PATH) && files.some((f) => f.startsWith('work/')), files.join(' · '))
  const mem = fs.readFileSync(path.join(kd('ok1'), '_members.md'), 'utf8')
  assert.match(mem, /^- 주인: kim\s*$/m, '있던 줄 그대로')
  assert.equal(mem.match(/저장 방식/g).length, 1, mem)
  assert.match(mem, /^- 저장 방식: 승인$/m)
  // 되돌리기 자리 태그 · 지식백업에 이행까지 보냄
  const tags = await git('ok1', 'tag', '--list', 'kmd-migrate/pc-*')
  assert.equal(tags.split('\n').filter(Boolean).length, 1)
  assert.equal(pcPlan(k).recs.length, 0, '남은 옛 기록 없음')
  // 이력 갈래 「이행」 · 알림 한 줄
  const h = await pc.hub.history(KIM)
  assert.ok(h.some((x) => x.kind === '이행' && x.kn === 'ok1'), '이력 갈래 이행')
  assert.ok(h.some((x) => /개인 지식 1 이행: 넣음 \d+ · 이력으로 이음 4 · 값이 본문에 없는 옛 메모 1/.test(x.title || '')), h.map((x) => x.title).join(' / '))
})

test('지식백업 실패 = 시작 안 함(옛 길 · 커밋 · 태그 없음) + 멈춤 줄 「이행 못함」', async () => {
  assert.equal(pc.hub.saveModeOf('bad'), 'pc')
  const mf = path.join(kd('bad'), '_members.md')
  assert.doesNotMatch(fs.existsSync(mf) ? fs.readFileSync(mf, 'utf8') : '', /저장 방식/, '표지 없음')
  assert.equal(await git('bad', 'tag', '--list', 'kmd-migrate/*'), '')
  const k = await load('bad')
  assert.equal(k.byWork.get(R.K).state, 'kept', '둠 그대로')
  assert.ok(!k.works.some((w) => w.tags.includes('migrate-held')), '이행 기록 없음')
  assert.equal(k.byWork.get(R.M).state, 'memo', '메모 그대로')
  const st = await pc.hub.stops(KIM)
  const line = st.find((x) => x.kind === 'migrate' && x.kn === 'bad')
  assert.ok(line, JSON.stringify(st))
  assert.match(line.b, /^이행 못함: DPMS 지식 · 지식백업에 보내지 못했다/)
  assert.ok(!st.some((x) => x.kind === 'migrate' && x.kn === 'ok1'))
  const h = await pc.hub.history(KIM)
  assert.ok(h.some((x) => /이행 못함: DPMS 지식.지식백업에 보내지 못했다/.test(x.title || '')), '알림 한 줄')
  // 사람 저장은 옛 길 그대로(propose 를 막음)
  await assert.rejects(pc.hub.propose(KIM, 'bad', { record: { title: '시험', why: ['시험'], touches: ['proc:준비'] } }), (e) => e.code === 'E_INPUT')
})

test('다시 돌리면 할 일 없음 · 같은 까닭의 실패는 알림을 더하지 않는다', async () => {
  const h0 = await git('ok1', 'rev-parse', 'HEAD')
  const n0 = (await pc.hub.history(KIM)).filter((x) => x.kind === '이행').length
  const r = await pc.hub.pcMigrateAll()
  assert.deepEqual(r.done, [])
  assert.equal(r.failed.length, 1)
  assert.equal(r.failed[0].fresh, false)
  assert.equal(await git('ok1', 'rev-parse', 'HEAD'), h0)
  assert.equal((await pc.hub.history(KIM)).filter((x) => x.kind === '이행').length, n0)
  const again = await pc.hub.pcMigrate('ok1')
  assert.equal(again.same, true)
})

test('되돌리기: 이행 커밋을 되돌려 옛 길 · 둠 · 메모가 돌아오고 저절로 다시 하지 않는다 · 다시 하기로 다시', async () => {
  const r = await pc.hub.pcMigrateUndo(KIM, 'ok1')
  assert.equal(r.save, 'pc')
  let k = await load('ok1')
  assert.equal(k.byWork.get(R.K).state, 'kept')
  assert.equal(k.byWork.get(R.M).state, 'memo')
  assert.ok(!fs.existsSync(path.join(kd('ok1'), ...RECORDS_DOC_PATH.split('/'))), '이행이 세운 기록 모음도 빠짐')
  assert.equal(k.byWork.get(R.P).state, 'pend', 'pend 도 옛 상태로 돌아온다(그동안 저장은 닫힌다 · PC6)')
  const h0 = await git('ok1', 'rev-parse', 'HEAD')
  await pc.hub.pcMigrateAll()
  assert.equal(await git('ok1', 'rev-parse', 'HEAD'), h0, '되돌린 지식은 저절로 다시 하지 않는다')
  assert.ok((await pc.hub.stops(KIM)).some((x) => x.kind === 'migrate' && x.kn === 'ok1' && /되돌렸다/.test(x.b)))
  // 다시 하기(멈춤 줄 단추) — POST /api/pc/migrate/<지식> · GET 은 받지 않는다
  const ck = (await fetch(pc.url + '/once', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pc.auth.once(pc.pcUser) }) })).headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  assert.notEqual((await fetch(pc.url + '/api/pc/migrate/ok1', { headers: { cookie: ck } })).status, 200)
  const res = await fetch(pc.url + '/api/pc/migrate/ok1', { method: 'POST', headers: { cookie: ck, 'content-type': 'application/json' }, body: '{}' })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).ok, true)
  assert.equal(pc.hub.saveModeOf('ok1'), 'approve')
  k = await load('ok1')
  assert.equal(k.byWork.get(R.K).state, 'in')
  assert.ok(!(await pc.hub.stops(KIM)).some((x) => x.kind === 'migrate' && x.kn === 'ok1'))
})

test('다시 하기: 지식백업을 바로잡으면 이행 · 멈춤 줄이 걷힌다', async () => {
  const bare = path.join(tmp, 'bk2', 'bad.git')
  fs.mkdirSync(path.dirname(bare), { recursive: true })
  await tryGit(path.dirname(bare), ['init', '-q', '--bare', '-b', 'main', bare])
  const meta = await pc.hub.meta('bad')
  const backup = await import('../core/backup.js')
  await backup.copy.attach(meta, bare, { dataDir: data, branch: 'main' })
  const r = await pc.hub.pcMigrateAgain(KIM, 'bad')
  assert.equal(r.ok, true, r.why)
  assert.equal(pc.hub.saveModeOf('bad'), 'approve')
  assert.ok(!(await pc.hub.stops(KIM)).some((x) => x.kind === 'migrate'))
  // 지식백업에 이행 커밋까지
  await backup.copy.enqueue(meta)
  assert.equal((await tryGit(bare, ['rev-parse', 'main'])).out.trim(), await git('bad', 'rev-parse', 'HEAD'))
})
