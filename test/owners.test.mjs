// 주인 장부 — 팀 서버에는 팀 지식만 선다(개인 지식은 각자의 PC 에만).
//
// 주인 장부는 한 줄로 서서 고친다(여럿이 같은 때 팀 지식을 만들고 정리 시각을 바꿔도 줄을 잃지 않는다) ·
// 셸(kmd owner · restore)이 쓴 장부를 도는 서버가 곧바로 보고, 다음 화면 쓰기가 그것을 지우지 않는다 ·
// `_members.md` 에 주인 · 정리 설정을 싣고 켤 때 · 동기화 · 되살릴 때 따른다(옛 꼴이면 안전한 쪽) ·
// 옛 장부 · `_members.md` 의 「개인」 은 읽지 않는다(팀 지식으로 본다) · 주인 넘기기는 관리자 · 셸만 ·
// 지운 지식의 일(파일 이름 · 터미널 줄)은 남지 않는다 · /healthz 는 살아 있나 · 판만.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { makeHub, SHELL } from '../server/hub.js'
import * as owners from '../core/owners.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LEE = { user: 'lee' }
const PARK = { user: 'park' }
const KIM = { user: 'kim', admin: true }
let tmp, root, data, s
const code = (p) => p.then(() => 'ok', (e) => e.code)
const ledger = () => JSON.parse(fs.readFileSync(path.join(data, 'owners.json'), 'utf8')).knowledge
const ids = async (ctx) => (await s.hub.visible(ctx)).map((k) => k.id).sort()
const until = async (f, ms = 10_000) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 50)) } return true }

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-owners-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  root = path.join(tmp, 'kn')
  data = path.join(root, '.kmd')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('_members.md: 주인 · 정리하는 사람 · 정리 방식 · Claude 에 보내지 않음을 싣고 다시 읽는다 · 「개인」 은 읽지 않는다', () => {
  const t = owners.renderMembers({ owner: 'kim', curators: ['park', 'lee'], tidyMode: 'time', tidyAt: '05:10', noClaude: true })
  assert.match(t, /- 주인: kim\n- 정리: park, lee\n- 정리 방식: 정해진 시각 05:10\n- Claude 에 보내지 않음: 예/)
  assert.doesNotMatch(t, /개인/)
  assert.deepEqual(owners.parseMembers(t), { owner: 'kim', curators: ['park', 'lee'], settings: true, tidyMode: 'time', tidyAt: '05:10', noClaude: true })
  assert.equal(owners.parseMembers(owners.renderMembers({ owner: 'a', tidyMode: 'live' })).tidyMode, 'live')
  const old = owners.parseMembers('- 주인: kim\n- 개인: 예\n')
  assert.equal(old.settings, false, '옛 꼴: 설정 줄 없음')
  assert.equal('private' in old, false, '옛 「개인」 줄은 읽지 않는다')
})

test('한 줄로 서서 고친다. 여럿이 같은 때 팀 지식을 만들고 정리 시각을 바꿔도 줄을 잃지 않는다 · 팀 지식은 팀 모두 본다', async () => {
  const jobs = []
  for (let i = 0; i < 6; i++) jobs.push(s.hub.addKnowledge({ ...(i % 2 ? PARK : LEE), admin: true }, { kind: 'new', name: `회의${i}` }))
  for (let i = 0; i < 4; i++) jobs.push(s.hub.setOwner(SHELL, 'dpms', { tidyAt: `0${i}:30` }))
  const r = await Promise.allSettled(jobs)
  assert.deepEqual(r.filter((x) => x.status === 'rejected').map((x) => x.reason?.message), [], '쓰기가 다투다 넘어지지 않는다')
  const L = ledger()
  for (let i = 0; i < 6; i++) {
    const id = `회의${i}`
    assert.equal(L[id]?.owner, i % 2 ? 'park' : 'lee', `${id} 줄`)
    assert.equal('private' in L[id], false)
    assert.match(fs.readFileSync(path.join(root, id, '_members.md'), 'utf8'), /- 주인: /, `${id} 의 _members.md 는 첫 묶음에`)
  }
  assert.ok((await ids(PARK)).includes('회의0'), '팀 지식은 팀 모두 본다')
  // 팀 서버에는 관리자만 지식을 세운다(개인 지식은 내 PC 에)
  assert.equal(await code(s.hub.addKnowledge(LEE, { kind: 'new', name: '내일기' })), 'E_FORBIDDEN')
  assert.equal(await code(s.hub.addKnowledge(KIM, { kind: 'folder', dir: tmp })), 'E_FORBIDDEN', '팀 서버는 폴더를 들이지 않는다')
})

test('셸이 쓴 장부를 도는 서버가 곧바로 본다. 다음 화면 쓰기가 그것을 지우지 않는다', async () => {
  const shell = await makeHub({ root, dataDir: data, log: () => {} }) // kmd owner 와 같은 길(다른 프로세스 대신 다른 hub)
  await new Promise((r) => setTimeout(r, 30))
  await shell.setOwner(SHELL, 'gdi', { owner: 'park', curators: ['park'] })
  assert.equal(s.hub.owner('gdi')?.owner, 'park', '도는 서버가 곧바로 본다')
  await s.hub.setOwner(SHELL, 'dpms', { tidyAt: '04:00' })
  assert.equal(ledger().gdi?.owner, 'park', '다음 쓰기가 셸의 줄을 지우지 않는다')
  shell.stop()
})

test('주인은 정리 설정 · 정리하는 사람만: 주인은 관리자 · 셸이 바꾼다 · 「개인」 은 받지 않는다', async () => {
  await s.hub.setOwner(SHELL, 'dpms', { owner: 'park' })
  assert.equal(await code(s.hub.setOwner(PARK, 'dpms', { owner: 'lee' })), 'E_FORBIDDEN', '주인 넘기기는 관리자')
  assert.equal((await s.hub.setOwner(PARK, 'dpms', { tidyMode: 'manual', curators: ['park', 'lee'] })).tidyMode, 'manual')
  const r = await s.hub.setOwner(PARK, 'dpms', { private: true, tidyMode: 'time' })
  assert.equal('private' in r, false, '「개인」 은 걷고 나머지만 받는다')
  assert.ok((await ids(LEE)).includes('dpms'), '팀 지식은 감춰지지 않는다')
  assert.equal(await code(s.hub.setOwner(LEE, 'dpms', { tidyMode: 'live' })), 'E_FORBIDDEN', '정리하는 사람은 아니다')
  assert.match(fs.readFileSync(path.join(root, 'dpms', '_members.md'), 'utf8'), /- 주인: park\n- 정리: park, lee\n- 정리 방식: 정해진 시각/)
})

test('옛 개인 지식은 없다: 옛 장부 줄 · _members.md 의 「개인: 예」 는 팀 지식으로 본다', async () => {
  await s.close()
  const L = ledger()
  L['옛일기-lee'] = { owner: 'lee', private: true, curators: [] }
  L['team-old'] = { restored: true } // 옛 판의 「되살림 — 관리자만」 표지(_members.md 없음)
  for (const id of ['옛일기-lee', 'team-old']) {
    fs.mkdirSync(path.join(root, id, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(root, id, 'docs', '가.md'), '# 가\n\n## 나\n다\n')
  }
  fs.writeFileSync(path.join(root, '옛일기-lee', '_members.md'), '- 주인: lee\n- 개인: 예\n')
  fs.writeFileSync(path.join(data, 'owners.json'), JSON.stringify({ knowledge: L }, null, 1))
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  assert.ok((await ids(PARK)).includes('옛일기-lee'), '남도 본다(팀 지식)')
  assert.equal('private' in (s.hub.owner('옛일기-lee') || {}), false)
  assert.equal(ledger()['team-old']?.restored, true, '앞 판의 「되살림: 관리자만」 표지는 말없이 열지 않는다')
  assert.ok(!(await ids(LEE)).includes('team-old'))
  // 옛 꼴 _members.md(설정 줄 없음)는 켤 때 장부의 값으로 새 꼴로 고쳐 쓴다 — 「개인」 줄은 없어진다
  assert.ok(await until(() => /- 정리 방식: /.test(fs.readFileSync(path.join(root, '옛일기-lee', '_members.md'), 'utf8'))))
  assert.doesNotMatch(fs.readFileSync(path.join(root, '옛일기-lee', '_members.md'), 'utf8'), /개인/)
  // 동기화 — _members.md 없는 새 폴더는 누른 관리자의 팀 지식
  copyDir(path.join(root, 'team-old'), path.join(root, '새팀'))
  const r = await s.hub.sync(KIM)
  assert.ok(r.added.some((x) => x.id === '새팀'))
  assert.equal(ledger()['새팀']?.owner, 'kim')
})

test('셸과 서버가 겹쳐 써도: 파일 잠금 안에서 다시 읽고 고쳐 써 어느 쪽도 잃지 않는다', async () => {
  const shell = await makeHub({ root, dataDir: data, log: () => {} })
  await Promise.all([s.hub.setOwner(SHELL, 'dpms', { tidyAt: '06:00' }), shell.setOwner(SHELL, 'gdi', { owner: 'lee' }), s.hub.setOwner(SHELL, 'gdi', { curators: ['park'] })])
  const L = ledger()
  assert.equal(L.dpms.tidyAt, '06:00')
  assert.deepEqual([L.gdi.owner, L.gdi.curators], ['lee', ['park']])
  shell.stop()
  // 같은 이름 두 번 — 둘째만 E_CONFLICT · 첫째의 줄은 남는다
  const r = await Promise.allSettled([s.hub.addKnowledge(KIM, { kind: 'new', name: '두번' }), s.hub.addKnowledge(KIM, { kind: 'new', name: '두번' })])
  assert.deepEqual(r.map((x) => x.status).sort(), ['fulfilled', 'rejected'])
  assert.equal(r.find((x) => x.status === 'rejected').reason.code, 'E_CONFLICT')
  assert.equal(ledger()['두번']?.owner, 'kim')
})

test('이 PC 의 kmd 는 장부를 _members.md 로 맞추지 않는다. 팀에서 받아 온 지식의 사람 칸이 이 PC 주인을 가리지 않는다', async () => {
  const pcRoot = path.join(tmp, 'pcroot')
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), path.join(pcRoot, '받은지식'))
  fs.writeFileSync(path.join(pcRoot, '받은지식', '_members.md'), '- 주인: park\n- 개인: 예\n- Claude 에 보내지 않음: 예\n')
  const pc = await startServer({ root: pcRoot, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    assert.deepEqual((await pc.hub.visible({ user: 'kim', admin: true, pc: true })).map((k) => k.id), ['받은지식'])
    assert.ok(!fs.existsSync(path.join(pcRoot, '.kmd', 'owners.json')) || !JSON.parse(fs.readFileSync(path.join(pcRoot, '.kmd', 'owners.json'), 'utf8')).knowledge['받은지식'])
  } finally {
    await pc.close()
  }
})

test('되살릴 때: _members.md 를 따른다 · 없으면 줄 없이 · 옛 꼴이면 「손으로만 · Claude 에 보내지 않음」', async () => {
  const mk = (name, members) => {
    const d = path.join(tmp, 'restored', name)
    fs.mkdirSync(d, { recursive: true })
    if (members != null) fs.writeFileSync(path.join(d, '_members.md'), members)
    return d
  }
  const reg = { knowledge: { none: { restored: true } } }
  assert.equal(await owners.adoptMembers(reg, 'none', mk('none', null)), null)
  assert.equal(reg.knowledge.none, undefined, '없으면 줄 없음')
  const old = await owners.adoptMembers(reg, 'old', mk('old', '- 주인: lee\n- 개인: 예\n- 정리: lee\n'), { restore: true })
  assert.deepEqual([old.owner, 'private' in old, old.tidyMode, old.noClaude, old.check], ['lee', false, 'manual', true, true])
  const keep = await owners.adoptMembers(reg, 'old2', mk('old2', '- 주인: lee\n'))
  assert.deepEqual([keep.tidyMode, keep.noClaude, keep.check], [undefined, undefined, undefined], '켤 때 · 동기화 때는 옛 꼴이어도 정리 설정을 건드리지 않는다')
  const cur = await owners.adoptMembers(reg, 'cur', mk('cur', owners.renderMembers({ owner: 'park', curators: ['park'], tidyMode: 'live', noClaude: true })))
  assert.deepEqual([cur.owner, cur.tidyMode, cur.noClaude, cur.check], ['park', 'live', true, undefined], '정리 설정을 그대로')
})

test('지운 지식의 일(넣은 파일 이름 · 터미널 줄)은 남지 않는다. 다시 켜도', async () => {
  const id = '회의4'
  const run = s.hub.newRun(id, { title: '연봉협상-메모.md', by: 'lee' })
  s.hub.runLine(run, 'say', '파일을 읽었다. 연봉 협상 메모')
  run.endedAt = new Date().toISOString()
  run.state = 'done'
  s.hub.runSave(run)
  const rf = path.join(data, 'runs', `${encodeURIComponent(id)}.json`)
  assert.ok(await until(() => fs.existsSync(rf)), '일 파일')
  assert.deepEqual(s.hub.runList(LEE).map((r) => r.title), ['연봉협상-메모.md'])
  assert.equal(await code(s.hub.deleteKnowledge(LEE, id, { confirm: id })), 'E_FORBIDDEN', '팀 지식은 관리자가 지운다')
  await s.hub.deleteKnowledge(KIM, id, { confirm: id })
  assert.deepEqual(s.hub.runList(LEE), [])
  assert.ok(!fs.existsSync(rf), '일 파일도 지웠다')
  assert.equal(ledger()[id], undefined)
})

test('HTTP: 일반은 지식을 세우지 못한다 · 없는 사람은 주인 · 정리가 되지 않는다 · 옛 개인 길은 없다 · /healthz 는 살아 있나 · 판만', async () => {
  const kim = await signIn(s, { id: 'kim', admin: true })
  const park = await signIn(s, { id: 'park', admin: false })
  const post = (p, who, body) => fetch(s.url + p, { method: 'POST', headers: { cookie: who.cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await post('/api/knowledge/add', park, { kind: 'new', name: '내것' })).status, 403)
  assert.equal((await post('/api/k/dpms/owner', kim, { curators: ['park', '없는사람'] })).status, 400)
  assert.equal((await post('/api/k/dpms/owner', kim, { owner: 'nobody' })).status, 400)
  for (const p of ['/api/me/personal', '/api/me/worker', '/api/knowledge/fromteam']) assert.notEqual((await post(p, park, {})).status, 200, p)
  assert.notEqual((await fetch(s.url + '/api/k/dpms/bundle', { headers: { cookie: park.cookie } })).status, 200)
  const h = await fetch(s.url + '/healthz').then((x) => x.json())
  assert.deepEqual(Object.keys(h).sort(), ['mode', 'ok', 'version'])
})
