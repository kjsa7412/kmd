// 들이기 엔진(S7 · docs/품질개선/KMD_개편_설계.md 3-5 · S-D18 ~ S-D22 · S-D43 · S-D47 · S-D48 · S-D50 · S-D51)
//
// 문서 폴더 · git 가져오기 → 정리 일감이 아니라 들이기 일감(원천마다 하나) → 팀 일꾼(가짜 claude) workOnce 한 번 = 기록 + 조각 저장 한 번 = 커밋 하나 ·
// 기록 author(kmd · 만든 사람) · 태그 intake · job/<id> · work/ · 상태 in · 항목 참고 줄 · 지어낸 값 → 고쳐 쓰기 두 번까지(서버가 센다) → 그래도면 기록만 + 넣지 못함 ·
// 재료 뒤 사람이 고침 → 조각은 새 글에 다시 대 넣음 / 새 글은 넣지 못함(conflict) · 커밋 뒤 일감을 다시 집음 · 다시 켬 → same · 같은 원천 → 일감 하나 ·
// 기다림 상한 → E_RATE · 자리를 잃음 → seat · Claude 에 보내지 않음 → noclaude · ## 없는 새 문서 → nosec · 장부 밖 이름 → names · 24시간 → worker

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { workOnce } from '../core/worker.js'
import { copyDir, seat } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, s, wk, docsDir, repo
const ADMIN = { user: 'kim', admin: true }
const W = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }
const G = (dir, ...a) => execFileSync('git', ['-c', 'user.name=박개발', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim()
const KD = () => path.join(tmp, 'kn', 'dpms')
const section = (doc, h) => fs.readFileSync(path.join(KD(), 'docs', `${doc}.md`), 'utf8').split(`## ${h}`)[1].split('\n## ')[0]
const commits = () => Number(G(KD(), 'rev-list', '--count', 'HEAD'))
const fresh = async () => { s.hub.forget?.('dpms'); return s.hub.get('dpms') }
const queued = () => s.hub.intakesOf('dpms').filter((j) => j.state === 'queued')
const work = () => workOnce({ server: s.url, key: wk })
const env = (k, v, f) => async () => { const old = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; try { return await f() } finally { if (old == null) delete process.env[k]; else process.env[k] = old } }
// 일꾼처럼 부르기 — 일감 열쇠(kmdd_)로 재료 · 끝(본문을 마음대로)
const raw = async (key, kn, p, body) => {
  const r = await fetch(`${s.url}/api/k/${encodeURIComponent(kn)}/worker/intake${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, j: await r.json() }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-intake-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  docsDir = path.join(tmp, 'src', '운영문서')
  W(path.join(docsDir, '회의', '10월.md'), '# 10월\n\n## 정한 것\n화 · 목 배포. 창은 14:00 부터.\n')
  W(path.join(docsDir, '야간점검.md'), '# 야간점검\n\n## 점검 순서\n밤 11시에 디스크를 본다.\n')
  repo = path.join(tmp, 'src', 'repo')
  W(path.join(repo, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 3초\nclass HealthCheck {\n  int timeoutSec = 3;\n}\n')
  G(repo, 'init', '-q', '-b', 'main')
  G(repo, 'add', '-A')
  G(repo, 'commit', '-q', '-m', '처음')
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ sourceRoots: [path.join(tmp, 'src')], decideMs: 3600000, sourceTickMs: 3600000, inboxTickMs: 3600000, jobTickMs: 3600000, watchQuietMs: 600000, intakeQueue: 2 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  wk = (await s.auth.workerAdd()).key
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('문서 폴더: 파일마다 들이기 일감(정리 일감 0) · 일꾼 한 번 = 기록 + 조각 = 커밋 하나 · kmd · intake · job/ · 상태 in · 참고 줄', async () => {
  const r0 = await s.hub.sourceAdd(ADMIN, 'dpms', { name: '운영문서', kind: 'docs', at: docsDir, rules: [{ rule: 'docs', into: { doc: '운영문서' } }] })
  const run = r0.run[0]
  assert.equal(run.state, 'changed', JSON.stringify(run).slice(0, 400))
  assert.equal(run.queued, 2, '파일 둘 → 들이기 일감 둘')
  assert.equal(queued().length, 2)
  assert.ok(!(await fresh()).works.some((w) => w.tags.some((t) => t.startsWith('ingest/운영문서/'))), '기록은 일꾼이 지을 때 한 번에(먼저 쓰지 않는다)')
  // 같은 파일 · 같은 글이면 다시 확인해도 일감이 늘지 않는다
  assert.equal((await s.hub.sourceRun('dpms', '운영문서'))[0].state, 'same')
  assert.equal(queued().length, 2)

  const c0 = commits()
  const a = await work()
  assert.equal(a.job.kind, 'intake')
  assert.equal(commits(), c0 + 1, '저장 한 번 = 커밋 하나')
  const job = s.hub.job(a.job.id)
  assert.equal(job.state, 'done')
  const k = await fresh()
  const w = k.byWork.get(job.result.rec)
  assert.ok(w, '기록이 섰다')
  assert.equal(w.author, 'kmd')
  assert.ok(w.path.startsWith('work/'), '기록은 work/(이력 아님)')
  for (const t of ['intake', `job/${a.job.id}`, 'put']) assert.ok(w.tags.includes(t), `태그 ${t}: ${w.tags}`)
  assert.ok(w.tags.some((t) => t.startsWith('ingest/운영문서/')) && w.tags.some((t) => /^md\/[0-9a-f]{16}$/.test(t)))
  assert.equal(w.state, 'in')
  assert.match(w.body, /## 원천\n- 파일 /)
  // 넣은 항목 — 표지와 참고 줄(kmd 가 쓴 들이기도 항목 「출처」 에 남는다 · S-D43)
  const put = w.body.split('## 넣은 것\n')[1]
  assert.ok(put, w.body)
  const doc = fs.readFileSync(path.join(KD(), ...put.split('\n')[0].replace(/^- /, '').split(' › ')[0].split('/')), 'utf8')
  assert.ok(doc.includes(w.id), '참고 줄에 기록 id')
  // 측정 줄 — 채널 intake-src · 비용
  const sl = fs.readFileSync(path.join(tmp, 'kn', '.kmd', 'savelog', 'dpms.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop()
  assert.equal(sl.ch, 'intake-src')
  assert.equal(sl.cost.calls, 1)
  // 둘째 일감도
  await work()
  assert.equal(queued().length, 0)
})

test('git: 커밋마다 들이기 일감 → 항목 값이 바뀐다(기록 kmd · code-change · intake) · 브레이크 「새 10」 은 문서 폴더에 없다', async () => {
  const r0 = await s.hub.sourceAdd(ADMIN, 'dpms', { name: 'api 코드', kind: 'git', at: repo, every: 'manual' })
  assert.equal(r0.run[0].codeRecords, 0)
  W(path.join(repo, 'HealthCheck.java'), '// 헬스 체크 — 시간 초과는 5초\nclass HealthCheck {\n  int timeoutSec = 5;\n}\n')
  G(repo, 'commit', '-q', '-am', '헬스 체크 시간 초과를 늘림')
  const r1 = (await s.hub.sourceRun('dpms', 'api 코드'))[0]
  assert.equal(r1.codeRecords, 1)
  assert.equal(r1.queued, 1)
  await work()
  assert.match(section('배포절차', '헬스 체크'), /시간 초과는 5초 — 5초 안에 200/)
  const w = (await fresh()).works.find((x) => x.tags.includes('code-change') && x.tags.includes('intake'))
  assert.equal(w.author, 'kmd')
  assert.equal(w.state, 'in')
  assert.deepEqual(w.touches, ['proc:헬스 체크'])
})

test('지어낸 값 → 고쳐 쓰기(서버가 센다) · 두 번 넘게 걸리면 기록만 + 넣지 못함 · 원천은 held/ 에', env('FAKE_CLAUDE_MODE', 'bad', async () => {
  const log = path.join(tmp, 'calls-bad.log')
  process.env.FAKE_CLAUDE_LOG = log
  try {
    const o = await s.hub.openJob('dpms', { type: 'file', by: 'kmd', auto: true, src: { rel: '운영문서/고침.md', sha: 'a'.repeat(16), title: '고침.md' }, md: '# 고침\n\n## 고침 순서\n먼저 끈다. 30초 기다린다.\n' })
    const r = await work()
    assert.equal(r.job.id, o.job)
    assert.equal(fs.readFileSync(log, 'utf8').split('\n').filter((l) => l === 'fix').length, 1, '한 번 고쳐 썼다')
    assert.equal(s.hub.job(o.job).result.held, 0)
    assert.ok(!/999초/.test(fs.readFileSync(path.join(KD(), 'docs', '고침.md'), 'utf8')))
  } finally { delete process.env.FAKE_CLAUDE_LOG }
}))

test('그래도 지어내면: 세 번째에 기록만 + 넣지 못함(values) · 본문의 tries 를 속여도 서버가 센다 · held/<기록>.md', env('FAKE_CLAUDE_MODE', 'badall', async () => {
  const o = await s.hub.openJob('dpms', { type: 'file', by: 'kmd', auto: true, src: { rel: '운영문서/거짓.md', sha: 'b'.repeat(16), title: '거짓.md' }, md: '# 거짓\n\n## 거짓 순서\n먼저 끈다.\n' })
  const n = s.hub.workerNext(s.auth.bearer(wk))
  assert.equal(n.job.id, o.job)
  const g = await raw(n.key, 'dpms', '')
  assert.equal(g.status, 200)
  const bad = { record: { title: '거짓: 들임', body: '들였다.', changes: [] }, updates: [], newDoc: { path: '거짓', sections: [{ heading: '거짓 순서', content: '먼저 끈다. 999초 기다린다.' }] } }
  // 본문의 tries · last 는 믿지 않는다
  for (let i = 0; i < 2; i++) {
    const d = await raw(n.key, 'dpms', '/done', { draft: bad, tries: 99, last: true })
    assert.equal(d.status, 200, JSON.stringify(d.j))
    assert.match(d.j.fix || '', /근거에 없는 값/, `${i + 1}번째는 고쳐 쓰기`)
  }
  // GET 아닌 길은 POST 만(일감이 도는 동안)
  assert.equal((await fetch(`${s.url}/api/k/dpms/worker/intake/done`, { headers: { authorization: `Bearer ${n.key}` } })).status, 405)
  const d = await raw(n.key, 'dpms', '/done', { draft: bad, tries: 0, last: false })
  assert.equal(d.j.ok, true)
  assert.equal(d.j.held[0].code, 'values')
  const w = (await fresh()).byWork.get(d.j.rec)
  assert.equal(w.state, 'held')
  assert.ok(w.tags.includes('intake') && w.tags.includes(`job/${o.job}`))
  assert.ok(!fs.existsSync(path.join(KD(), 'docs', '거짓.md')), '문서는 쓰지 않았다')
  assert.ok(fs.existsSync(path.join(tmp, 'kn', '.kmd', 'held', 'dpms', `${d.j.rec}.md`)), '원천을 남긴다(S-D50)')
  // 끝난 일감의 열쇠는 더 쓰지 못한다
  assert.equal((await raw(n.key, 'dpms', '')).status, 401)
}))

test('재료 뒤 사람이 항목을 고침 → 조각은 새 글에 다시 대 넣는다 · 새 글(content)은 넣지 못함(conflict)', async () => {
  const src = { src: 'api 코드', commit: 'stale01', title: '롤백 대기를 늘림: api 코드 stale01', touches: ['proc:헬스 체크'] }
  const run = async (mode, commit) => {
    const o = await s.hub.openJob('dpms', { type: 'commit', by: 'kmd', auto: true, src: { ...src, commit }, md: '바뀐 값: 30초마다 → 20초마다: HealthCheck.java' })
    const n = s.hub.workerNext(s.auth.bearer(wk))
    assert.equal(n.job.id, o.job)
    const g = (await raw(n.key, 'dpms', '')).j
    const c = g.docs.find((d) => d.doc === 'docs/배포절차.md').sections.find((x) => x.h === '헬스 체크')
    // 재료를 받은 뒤 사람이 같은 항목의 다른 곳을 고친다
    const k = await fresh()
    const cur = k.byDocPath.get('docs/배포절차.md').sections.find((x) => x.h === '헬스 체크')
    const { sha16 } = await import('../core/text.js')
    await s.hub.save(ADMIN, 'dpms', { record: { title: `헬스 체크 설명 ${mode}: 배포 뒤`, body: '설명 다듬음', touches: ['proc:헬스 체크'] }, sections: [{ coord: 'proc:헬스 체크', base: sha16(cur.body), edits: [mode === 'edits' ? { find: '배포 뒤 서버 상태는', replace: '배포 뒤(edits) 서버 상태는' } : { find: '(edits)', replace: '(content)' }] }] })
    const up = mode === 'edits' ? { doc: 'docs/배포절차.md', heading: '헬스 체크', base: c.base, edits: [{ find: '30초마다', replace: '20초마다' }] } : { doc: 'docs/배포절차.md', heading: '헬스 체크', base: c.base, content: c.body.replace('30초마다', '20초마다') }
    return (await raw(n.key, 'dpms', '/done', { draft: { record: { title: '헬스 체크 주기: 30초마다 → 20초마다', body: '주기를 줄였다.', changes: ['헬스 체크: 30초마다 → 20초마다'] }, updates: [up] } })).j
  }
  const a = await run('edits', 'stale01')
  assert.equal(a.put, 1, JSON.stringify(a))
  assert.match(section('배포절차', '헬스 체크'), /20초마다[\s\S]*배포 뒤\(edits\)/, '사람 고침은 그대로 · 조각은 새 글에')
  const b = await run('content', 'stale02')
  assert.equal(b.put, 0)
  assert.equal(b.held[0].code, 'conflict')
  assert.match(section('배포절차', '헬스 체크'), /배포 뒤\(content\)/, '그사이 남이 고친 글을 덮지 않는다')
})

test('커밋 뒤 일감을 다시 집어도 · 다시 켜도 같은 것(job/) · 같은 원천은 일감 하나', async () => {
  const src = { rel: '운영문서/같은.md', sha: 'c'.repeat(16), title: '같은.md' }
  const md = '# 같은\n\n## 같은 순서\n한 번만 넣는다.\n'
  const o1 = await s.hub.openJob('dpms', { type: 'file', by: 'kmd', auto: true, src, md })
  const o2 = await s.hub.openJob('dpms', { type: 'file', by: 'kmd', auto: true, src, md })
  assert.equal(o2.job, o1.job, '같은 원천에 열린 일감은 하나')
  await work()
  const j = s.hub.job(o1.job)
  const rec = j.result.rec
  // 커밋 뒤 · 장부를 쓰기 전에 꺼진 것처럼 — 일감을 되돌려 다시 집는다
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'queue', `${o1.job}.md`), md)
  Object.assign(j, { state: 'queued', result: null })
  const c0 = commits()
  await work()
  assert.equal(s.hub.job(o1.job).state, 'done')
  assert.equal(s.hub.job(o1.job).result.same, true)
  assert.equal(commits(), c0, '다시 쓰지 않았다')
  assert.equal((await fresh()).works.filter((w) => w.tags.includes(`job/${o1.job}`)).length, 1)
  assert.ok(rec)
  // 다시 켬 — 도는 중이던 일감의 기록이 이미 있으면 닫는다(S-D48)
  const jf = path.join(tmp, 'kn', '.kmd', 'jobs.json')
  const list = JSON.parse(fs.readFileSync(jf, 'utf8')).map((x) => (x.id === o1.job ? { ...x, state: 'running', result: null } : x))
  await s.close()
  fs.writeFileSync(jf, JSON.stringify(list))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  wk = (await s.auth.workerAdd()).key
  assert.equal(s.hub.job(o1.job).state, 'done')
})

test('사람이 연 일감: 기다림 상한 → E_RATE · 자리를 잃으면 기록만 + 넣지 못함(seat) · 그 사람 이름', async () => {
  await s.auth.addUser({ id: 'lee', admin: false })
  await seat(s, 'lee', { dpms: 'write' })
  const mk = (i) => s.hub.openJob('dpms', { type: 'file', by: 'lee', src: { rel: `운영문서/이${i}.md`, sha: String(i).repeat(16).slice(0, 16), title: `이${i}.md` }, md: `# 이${i}\n\n## 이${i} 순서\n${i} 번째.\n` })
  const a = await mk(1)
  await mk(2)
  await assert.rejects(mk(3), { code: 'E_RATE' })
  await seat(s, 'lee', { dpms: 'none' })
  while (queued().length) await work()
  const j = s.hub.job(a.job)
  const w = (await fresh()).byWork.get(j.result.rec)
  assert.equal(w.author, 'lee')
  assert.equal(w.state, 'held')
  assert.match(w.body, /"code": ?"seat"/)
})

test('Claude 에 보내지 않음 → 일감 없이 기록만 + 넣지 못함(noclaude) · file · again · fix 모두', async () => {
  await s.hub.setOwner(SHELL, 'dpms', { noClaude: true })
  try {
    const any = (await fresh()).works.find((w) => w.author === 'kim' || w.author === 'lee')
    for (const [type, src] of [['file', { rel: '운영문서/비밀.md', sha: 'd'.repeat(16), title: '비밀.md' }], ['again', { rec: any.id, title: '다시' }], ['fix', { rec: any.id, title: '정정' }]]) {
      const r = await s.hub.openJob('dpms', { type, by: 'kmd', src, md: '# 비밀\n\n## 비밀 순서\n보내지 않는다.\n' })
      assert.equal(r.state, 'held', type)
      const w = (await fresh()).byWork.get(r.rec)
      assert.match(w.body, /"code": ?"noclaude"/, type)
    }
    assert.equal(queued().length, 0)
  } finally { await s.hub.setOwner(SHELL, 'dpms', { noClaude: false }) }
})

test('기다리는 사이 Claude 에 보내지 않음이 켜짐 → 재료를 내지 않고 바로 기록만 + 넣지 못함(noclaude · 임대를 돌지 않는다)', async () => {
  const o = await s.hub.openJob('dpms', { type: 'file', by: 'kmd', auto: true, src: { rel: '운영문서/나중비밀.md', sha: '9'.repeat(16), title: '나중비밀.md' }, md: '# 나중비밀\n\n## 나중비밀 순서\n보내지 않는다.\n' })
  await s.hub.setOwner(SHELL, 'dpms', { noClaude: true })
  try {
    await work()
    const j = s.hub.job(o.job)
    assert.equal(j.state, 'done')
    assert.match((await fresh()).byWork.get(j.result.rec).body, /"code": ?"noclaude"/)
    assert.ok(fs.existsSync(path.join(tmp, 'kn', '.kmd', 'held', 'dpms', `${j.result.rec}.md`)))
  } finally { await s.hub.setOwner(SHELL, 'dpms', { noClaude: false }) }
})

test('## 없는 새 문서 → nosec · 후보 밖 문서 → notfound · 장부 밖 이름 → 기록의 세울 이름 + 넣지 못함(names)', async () => {
  const one = (mode, n) => env('FAKE_CLAUDE_MODE', mode, async () => {
    const o = await s.hub.openJob('dpms', { type: 'file', by: 'kmd', auto: true, src: { rel: `운영문서/${n}.md`, sha: n.padEnd(16, 'e').slice(0, 16).replace(/[^0-9a-f]/g, 'e'), title: `${n}.md` }, md: `# ${n}\n\n## ${n} 순서\n밤에 본다.\n` })
    await work()
    return (await fresh()).byWork.get(s.hub.job(o.job).result.rec)
  })()
  const a = await one('nosec', '항목없음')
  assert.match(a.body, /"code": ?"nosec"/)
  assert.equal(a.state, 'held')
  const b = await one('outside', '바깥')
  assert.match(b.body, /"code": ?"notfound"/)
  const c = await one('names', '이름새로')
  assert.match(c.body, /## 세울 이름\n- 이름새로 순서 \(term:이름새로 순서\)/)
  assert.match(c.body, /"code": ?"names"/)
  assert.equal(c.state, 'held')
  assert.ok(!(await fresh()).vocab.coords.has('term:이름새로 순서'), '장부는 지식관리자가 세운다')
})

test('24시간 넘게 기다린 들이기 → 팀 시계(jobTick)가 기록만 + 넣지 못함(worker)', async () => {
  const o = await s.hub.openJob('dpms', { type: 'file', by: 'kmd', auto: true, src: { rel: '운영문서/늦음.md', sha: 'f'.repeat(16), title: '늦음.md' }, md: '# 늦음\n\n## 늦음 순서\n기다린다.\n' })
  s.hub.job(o.job).at = new Date(Date.now() - 25 * 3600_000).toISOString()
  await s.hub.jobTick()
  const j = s.hub.job(o.job)
  assert.equal(j.state, 'done')
  assert.match((await fresh()).byWork.get(j.result.rec).body, /"code": ?"worker"/)
  assert.ok(!fs.existsSync(path.join(tmp, 'kn', '.kmd', 'queue', `${o.job}.md`)), '원천은 held/ 로')
  assert.ok(fs.existsSync(path.join(tmp, 'kn', '.kmd', 'held', 'dpms', `${j.result.rec}.md`)))
})

test('문서 다듬기(S13 · K10-4 · S-D37): 같은 문서 두 번 → 일감 하나 · 값 장부가 같은 항목만 들어간다(값이 바뀐 항목은 빼고 까닭) · 기록은 이력(다듬기) · Claude 에 보내지 않음은 거절', async () => {
  // 앞 시험이 남긴 일감을 비운다
  for (let i = 0; i < 6 && queued().length; i++) await work()
  await s.auth.addUser({ id: 'kim', admin: true })
  const doc = '백업절차'
  const before = (await fresh()).docs.find((d) => d.id === doc).sections.filter((x) => x.h).map((x) => [x.h, x.body])
  assert.ok(before.length >= 2, '항목 둘 이상인 문서')
  await assert.rejects(s.hub.polish(ADMIN, 'dpms', { doc: '없는문서' }), { code: 'E_NOTFOUND' })
  await assert.rejects(s.hub.polish(ADMIN, 'dpms', { doc: '' }), { code: 'E_INPUT' })
  const a = await s.hub.polish(ADMIN, 'dpms', { doc })
  const b = await s.hub.polish(ADMIN, 'dpms', { doc })
  assert.ok(a.job)
  assert.deepEqual([b.job, b.again], [a.job, true], '같은 문서에 열린 일감이 있으면 그것')
  const c0 = commits()
  await work()
  const j = s.hub.job(a.job)
  assert.equal(j.state, 'done', j.why)
  assert.equal(j.result.put, before.length - 1, '값을 바꾼 첫 항목만 빠진다')
  assert.match(j.why || '', /뺀 항목 1/)
  const k = await fresh()
  const w = k.logs.find((x) => x.tags.includes('polish') && x.tags.includes(`job/${a.job}`))
  assert.ok(w, '다듬기 기록은 이력(log/)')
  assert.match(w.title, /^다듬기: /)
  assert.match(w.body, /넣지 않은 항목[\s\S]*값이 바뀐다/)
  const now = k.docs.find((d) => d.id === doc).sections
  assert.equal(now.find((x) => x.h === before[0][0]).body.trim(), before[0][1].trim(), '값을 바꾼 항목은 그대로')
  assert.match(now.find((x) => x.h === before[1][0]).body, /\(다듬음\)/)
  assert.equal(commits(), c0 + 1, '저장 한 번 = 커밋 하나')
  // Claude 에 보내지 않음 — 다듬기는 팀 일꾼(Claude)이 하므로 거절
  await s.hub.setOwner(SHELL, 'dpms', { noClaude: true })
  try { await assert.rejects(s.hub.polish(ADMIN, 'dpms', { doc }), { code: 'E_FORBIDDEN' }) } finally { await s.hub.setOwner(SHELL, 'dpms', { noClaude: false }) }
})

test('일꾼이 머리를 「## 머리」 꼴로 보내도 그 항목에 댄다(notfound 가 아니다) · 새 문서 항목 머리도 # 없이', async () => {
  const { draftToSave } = await import('../core/ingest.js')
  const body = '- 일정: 12-10 ~ 12-16\n'
  const k = { byDocPath: new Map([['docs/a.md', { sections: [{ h: '4. 개소 현황', body }] }]]) }
  const g = { docs: [{ doc: 'docs/a.md', sections: [{ h: '4. 개소 현황', body, base: 'b0' }] }], src: { md: '시험 일정이 12-21 ~ 12-24 로 바뀌었다' } }
  const r = draftToSave(k, g, { record: { title: '테스트 일정' }, updates: [{ doc: 'a', heading: '## 4. 개소 현황', edits: [{ find: '12-10 ~ 12-16', replace: '12-21 ~ 12-24' }] }], newDoc: { path: '테스트/새문서', sections: [{ heading: '## 테스트 항목', content: '글' }] } })
  assert.equal(r.ok, true)
  assert.deepEqual(r.held, [])
  const sec = r.input.sections.find((x) => x.doc === 'docs/a.md')
  assert.equal(sec.heading, '4. 개소 현황')
  assert.equal(sec.base, 'b0')
  assert.equal(r.input.sections.find((x) => x.doc !== 'docs/a.md').heading, '테스트 항목')
})

test('항목에 이미 있던 가로줄(---)은 프런트매터로 걸지 않는다 · 새로 든 --- 는 건다', async () => {
  const { draftBad } = await import('../core/gate.js')
  const cur = '- 질매: 10월 말\n\n---\n'
  assert.equal(draftBad('- 질매: 11월 말\n\n---\n', cur, { old: cur }), null)
  assert.equal(draftBad('---\n- 질매: 11월 말\n\n---\n', cur, { old: cur }), '프런트매터 줄(---)')
  assert.equal(draftBad('---\n글\n', '', { old: null }), '프런트매터 줄(---)')
})
