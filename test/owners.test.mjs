// WP2 필수 — 「나만」 경계(제품화 검토 v0.1 G1-2 · F-003 · F-013 · G3-1 · G3-2 · G3-5 · G3-6 · F-009 · F-055 · F-084).
//
// 주인 장부는 한 줄로 서서 고친다(두 사람이 거의 같은 때 개인 지식을 만들어도 앞사람의 「나만」 이 지워지지 않는다) ·
// 셸(kmd owner · restore)이 쓴 장부를 도는 서버가 곧바로 보고, 다음 화면 쓰기가 그것을 지우지 않는다 ·
// 장부를 잃어도(밤 묶음으로 되돌림 · 줄 유실) 지식 안의 `_members.md` 가 켤 때 · 동기화 때 다시 가린다 ·
// `_members.md` 에 정리 설정도 싣고 되살릴 때 따른다(없으면 팀 지식 · 옛 꼴이면 안전한 쪽) ·
// 지운 지식의 일(파일 이름 · 터미널 줄)은 남지 않는다 · 주인은 개인 · 주인을 바꾸지 못한다(관리자 · 셸만) ·
// 개인 지식의 주인 줄 · 이름은 남에게 보이지 않는다 · /healthz 는 살아 있나 · 판만.

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

test('_members.md — 주인 · 개인 · 정리하는 사람 · 정리 방식 · Claude 에 보내지 않음을 싣고 다시 읽는다', () => {
  const t = owners.renderMembers({ owner: 'kim', private: true, curators: ['park', 'lee'], tidyMode: 'time', tidyAt: '05:10', noClaude: true })
  assert.match(t, /- 주인: kim\n- 개인: 예\n- 정리: park, lee\n- 정리 방식: 정해진 시각 05:10\n- Claude 에 보내지 않음: 예/)
  assert.deepEqual(owners.parseMembers(t), { owner: 'kim', private: true, curators: ['park', 'lee'], settings: true, tidyMode: 'time', tidyAt: '05:10', noClaude: true })
  assert.equal(owners.parseMembers(owners.renderMembers({ owner: 'a', tidyMode: 'live' })).tidyMode, 'live')
  assert.equal(owners.parseMembers('- 주인: kim\n- 개인: 예\n').settings, false, '옛 꼴 — 설정 줄 없음')
})

test('한 줄로 서서 고친다 — 여럿이 같은 때 개인 지식을 만들고 정리 시각을 바꿔도 「나만」 줄을 잃지 않는다', async () => {
  const jobs = []
  for (let i = 0; i < 6; i++) jobs.push(s.hub.addKnowledge({ ...(i % 2 ? PARK : LEE), admin: true }, { kind: 'new', name: `일기${i}` }))
  for (let i = 0; i < 4; i++) jobs.push(s.hub.setOwner(SHELL, 'dpms', { tidyAt: `0${i}:30` }))
  const r = await Promise.allSettled(jobs)
  assert.deepEqual(r.filter((x) => x.status === 'rejected').map((x) => x.reason?.message), [], '쓰기가 다투다 넘어지지 않는다')
  const L = ledger()
  for (let i = 0; i < 6; i++) {
    const id = `일기${i}-${i % 2 ? 'park' : 'lee'}`
    assert.equal(L[id]?.private, true, `${id} 줄`)
    assert.match(fs.readFileSync(path.join(root, id, '_members.md'), 'utf8'), /- 개인: 예/, `${id} 의 _members.md 는 첫 묶음에`)
  }
  assert.ok(!(await ids(PARK)).includes('일기0-lee'), '남의 개인 지식은 보이지 않는다')
  assert.ok(!(await ids(KIM)).includes('일기1-park'), '관리자에게도')
})

test('셸이 쓴 장부를 도는 서버가 곧바로 본다 — 다음 화면 쓰기가 그것을 지우지 않는다', async () => {
  const shell = await makeHub({ root, dataDir: data, log: () => {} }) // kmd owner 와 같은 길(다른 프로세스 대신 다른 hub)
  await new Promise((r) => setTimeout(r, 30))
  await shell.setOwner(SHELL, 'gdi', { owner: 'park', private: true })
  assert.ok(!(await ids(LEE)).includes('gdi'), '도는 서버가 곧바로 가린다')
  await s.hub.setOwner(SHELL, 'dpms', { tidyAt: '04:00' })
  assert.equal(ledger().gdi?.private, true, '다음 쓰기가 셸의 줄을 지우지 않는다')
  // 셸은 가림을 건너뛰어 감춘 지식을 되찾는다 · 주인 없는 개인은 받지 않는다
  await shell.setOwner(SHELL, 'gdi', { private: false })
  assert.ok((await ids(LEE)).includes('gdi'))
  assert.equal(await code(shell.setOwner(SHELL, 'gdi', { owner: null, private: true })), 'ok', '주인 park 그대로라 된다')
  await shell.setOwner(SHELL, 'gdi', { private: false })
  shell.stop()
})

test('주인은 정리 설정 · 정리하는 사람만 — 개인 · 주인은 관리자 · 셸이 바꾼다', async () => {
  await s.hub.setOwner(SHELL, 'dpms', { owner: 'park' })
  assert.equal(await code(s.hub.setOwner(PARK, 'dpms', { private: true })), 'E_FORBIDDEN', '주인 혼자 팀 지식을 감추지 못한다')
  assert.equal(await code(s.hub.setOwner(PARK, 'dpms', { owner: 'lee' })), 'E_FORBIDDEN', '주인 넘기기는 관리자')
  assert.equal((await s.hub.setOwner(PARK, 'dpms', { tidyMode: 'manual', curators: ['park', 'lee'] })).tidyMode, 'manual')
  assert.equal(await code(s.hub.setOwner(PARK, 'dpms', { private: false, tidyMode: 'time' })), 'ok', '바꾸지 않는 개인 값은 그대로 받는다')
  assert.equal(await code(s.hub.setOwner(LEE, 'dpms', { tidyMode: 'live' })), 'E_FORBIDDEN', '정리하는 사람은 아니다')
  // _members.md 에 정리 설정이 따라간다
  assert.match(fs.readFileSync(path.join(root, 'dpms', '_members.md'), 'utf8'), /- 주인: park\n- 개인: 아니오\n- 정리: park, lee\n- 정리 방식: 정해진 시각/)
})

test('장부를 잃어도 _members.md 가 다시 가린다 — 켤 때(밤 묶음으로 되돌림) · 동기화 때(새로 놓인 개인 지식)', async () => {
  // 밤 묶음 뒤에 만든 개인 지식 — 장부에서 줄이 빠진 채 다시 켠다
  await s.close()
  const L = ledger()
  delete L['일기0-lee']
  L['team-old'] = { restored: true } // 옛 판의 「되살림 — 관리자만」 표지(_members.md 없음)
  fs.mkdirSync(path.join(root, 'team-old', 'docs'), { recursive: true })
  fs.writeFileSync(path.join(root, 'team-old', 'docs', '가.md'), '# 가\n\n## 나\n다\n')
  fs.writeFileSync(path.join(data, 'owners.json'), JSON.stringify({ knowledge: L }, null, 1))
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  assert.equal(ledger()['일기0-lee']?.private, true, '켤 때 _members.md 로 다시 가렸다')
  assert.ok(!(await ids(PARK)).includes('일기0-lee'))
  assert.equal(ledger()['team-old']?.restored, true, '앞 판의 「되살림 — 관리자만」 표지는 말없이 열지 않는다')
  assert.ok(!(await ids(LEE)).includes('team-old'))
  // 옛 꼴 _members.md(설정 줄 없음)는 켤 때 장부의 값으로 새 꼴로 고쳐 쓴다 — 정리 설정은 건드리지 않는다
  assert.match(fs.readFileSync(path.join(root, 'dpms', '_members.md'), 'utf8'), /- 정리 방식: /)
  assert.notEqual(ledger().dpms?.noClaude, true)
  // 다른 서버에서 옮겨 온 개인 지식 폴더 — 동기화가 누른 관리자의 팀 지식으로 바꾸지 않는다
  copyDir(path.join(root, '일기2-lee'), path.join(root, '옮긴일기-lee'))
  fs.rmSync(path.join(root, '옮긴일기-lee', '.git'), { recursive: true, force: true })
  copyDir(path.join(root, 'team-old'), path.join(root, '새팀'))
  const r = await s.hub.sync(KIM)
  assert.deepEqual(r.added.map((x) => x.id).sort(), ['team-old', '새팀', '옮긴일기-lee'], '꺼진 사이 놓은 폴더도 새로 놓인 지식')
  assert.deepEqual([ledger()['옮긴일기-lee']?.owner, ledger()['옮긴일기-lee']?.private], ['lee', true])
  assert.ok(!(await ids(KIM)).includes('옮긴일기-lee'), '관리자도 못 본다')
  assert.match(fs.readFileSync(path.join(root, '옮긴일기-lee', '_members.md'), 'utf8'), /- 개인: 예/, '_members.md 를 「아니오」 로 바꾸지 않았다')
  assert.deepEqual([ledger()['새팀']?.owner, !!ledger()['새팀']?.private], ['kim', false], '_members.md 없는 새 폴더는 누른 관리자의 팀 지식')
})

test('줄이 없는 틈에도 가린다 — 개인 _members.md 가 있는 폴더는 동기화 · 맞추기 전에도 남에게 0 · 주인 칸이 비면 관리자만', async () => {
  copyDir(path.join(root, '일기2-lee'), path.join(root, '놓인일기-lee'))
  fs.rmSync(path.join(root, '놓인일기-lee', '.git'), { recursive: true, force: true })
  s.hub.forget() // 목록을 다시 읽는다(누군가의 요청이 목록을 새로 만든 때)
  assert.ok((await ids(LEE)).includes('놓인일기-lee'), '주인은 본다')
  assert.ok(!(await ids(PARK)).includes('놓인일기-lee'), '장부 줄이 없어도 남에게 0')
  assert.ok(!(await ids(KIM)).includes('놓인일기-lee'), '관리자에게도 0')
  copyDir(path.join(root, '일기2-lee'), path.join(root, '주인없음'))
  fs.rmSync(path.join(root, '주인없음', '.git'), { recursive: true, force: true })
  fs.writeFileSync(path.join(root, '주인없음', '_members.md'), '- 주인: \n- 개인: 예\n')
  s.hub.forget()
  assert.ok(!(await ids(LEE)).includes('주인없음'))
  assert.ok((await ids(KIM)).includes('주인없음'), '주인이 빈 개인 지식은 관리자가 주인을 정할 때까지 관리자만')
  for (const d of ['놓인일기-lee', '주인없음']) fs.rmSync(path.join(root, d), { recursive: true, force: true })
  s.hub.forget()
})

test('셸과 서버가 겹쳐 써도 — 파일 잠금 안에서 다시 읽고 고쳐 써 어느 쪽도 잃지 않는다', async () => {
  const shell = await makeHub({ root, dataDir: data, log: () => {} })
  await Promise.all([s.hub.setOwner(SHELL, 'dpms', { tidyAt: '06:00' }), shell.setOwner(SHELL, 'gdi', { owner: 'park', private: true }), s.hub.setOwner(SHELL, 'gdi', { curators: ['park'] })])
  const L = ledger()
  assert.equal(L.dpms.tidyAt, '06:00')
  assert.deepEqual([L.gdi.owner, L.gdi.private, L.gdi.curators], ['park', true, ['park']])
  assert.ok(!(await ids(LEE)).includes('gdi'))
  await shell.setOwner(SHELL, 'gdi', { private: false })
  shell.stop()
  // private 은 참 · 거짓으로만 — 문자열 'false' 가 지식을 가리지 않는다
  assert.equal((await s.hub.setOwner(SHELL, 'gdi', { private: 'false' })).private, false)
  // 같은 이름 두 번 — 둘째만 E_CONFLICT · 첫째의 「나만」 줄은 남는다
  const r = await Promise.allSettled([s.hub.addKnowledge({ ...LEE, admin: true }, { kind: 'new', name: '두번' }), s.hub.addKnowledge({ ...LEE, admin: true }, { kind: 'new', name: '두번' })])
  assert.deepEqual(r.map((x) => x.status).sort(), ['fulfilled', 'rejected'])
  assert.equal(r.find((x) => x.status === 'rejected').reason.code, 'E_CONFLICT')
  assert.equal(ledger()['두번-lee']?.private, true)
  assert.ok(!(await ids(PARK)).includes('두번-lee'))
})

test('이 PC 의 kmd 는 장부를 _members.md 로 맞추지 않는다 — 팀에서 받아 온 지식의 사람 칸이 이 PC 주인을 가리지 않는다', async () => {
  const pcRoot = path.join(tmp, 'pcroot')
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), path.join(pcRoot, '받은지식'))
  fs.writeFileSync(path.join(pcRoot, '받은지식', '_members.md'), owners.renderMembers({ owner: 'park', private: true, noClaude: true }))
  const pc = await startServer({ root: pcRoot, mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
  try {
    assert.deepEqual((await pc.hub.visible({ user: 'kim', admin: true, pc: true })).map((k) => k.id), ['받은지식'])
    assert.ok(!fs.existsSync(path.join(pcRoot, '.kmd', 'owners.json')) || !JSON.parse(fs.readFileSync(path.join(pcRoot, '.kmd', 'owners.json'), 'utf8')).knowledge['받은지식'])
  } finally {
    await pc.close()
  }
})

test('되살릴 때 — _members.md 를 따른다 · 없으면 팀 지식 · 옛 꼴이면 「손으로만 · Claude 에 보내지 않음」', async () => {
  const mk = (name, members) => {
    const d = path.join(tmp, 'restored', name)
    fs.mkdirSync(d, { recursive: true })
    if (members != null) fs.writeFileSync(path.join(d, '_members.md'), members)
    return d
  }
  const reg = { knowledge: { none: { restored: true } } }
  assert.equal(await owners.adoptMembers(reg, 'none', mk('none', null)), null)
  assert.equal(reg.knowledge.none, undefined, '없으면 팀 지식(줄 없음)')
  const old = await owners.adoptMembers(reg, 'old', mk('old', '- 주인: lee\n- 개인: 예\n- 정리: lee\n'), { restore: true })
  assert.deepEqual([old.owner, old.private, old.tidyMode, old.noClaude, old.check], ['lee', true, 'manual', true, true])
  const keep = await owners.adoptMembers(reg, 'old2', mk('old2', '- 주인: lee\n- 개인: 아니오\n'))
  assert.deepEqual([keep.tidyMode, keep.noClaude, keep.check], [undefined, undefined, undefined], '켤 때 · 동기화 때는 옛 꼴이어도 정리 설정을 건드리지 않는다')
  const cur = await owners.adoptMembers(reg, 'cur', mk('cur', owners.renderMembers({ owner: 'park', curators: ['park'], tidyMode: 'live', noClaude: true })))
  assert.deepEqual([cur.owner, cur.private, cur.tidyMode, cur.noClaude, cur.check], ['park', false, 'live', true, undefined], '정리 설정을 그대로')
})

test('지운 지식의 일(넣은 파일 이름 · 터미널 줄)은 남지 않는다 — 다시 켜도', async () => {
  const id = '일기4-lee'
  const run = s.hub.newRun(id, { title: '연봉협상-메모.md', by: 'lee' })
  s.hub.runLine(run, 'say', '파일을 읽었다 — 연봉 협상 메모')
  run.endedAt = new Date().toISOString()
  run.state = 'done'
  s.hub.runSave(run)
  const rf = path.join(data, 'runs', `${encodeURIComponent(id)}.json`)
  assert.ok(await until(() => fs.existsSync(rf)), '일 파일')
  assert.deepEqual(s.hub.runList(LEE).map((r) => r.title), ['연봉협상-메모.md'])
  assert.deepEqual(s.hub.runList(PARK), [], '남의 개인 지식의 일은 보이지 않는다')
  await s.hub.deleteKnowledge(LEE, id, { confirm: '일기4' })
  assert.deepEqual(s.hub.runList(PARK), [], '지운 뒤에도')
  assert.deepEqual(s.hub.runList(LEE), [])
  assert.ok(!fs.existsSync(rf), '일 파일도 지웠다')
  assert.equal(ledger()[id], undefined)
})

test('HTTP — 개인 지식의 주인 줄 · 이름은 남에게 0 · 없는 사람은 주인 · 정리가 되지 않는다 · /healthz 는 살아 있나 · 판만', async () => {
  const kim = await signIn(s, { id: 'kim', admin: true })
  const park = await signIn(s, { id: 'park', admin: false })
  await signIn(s, { id: 'lee', admin: false })
  const get = (p, who) => fetch(s.url + p, { headers: { cookie: who.cookie } })
  const post = (p, who, body) => fetch(s.url + p, { method: 'POST', headers: { cookie: who.cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const lid = encodeURIComponent('일기0-lee')
  assert.equal((await get(`/api/k/${lid}/owner`, park)).status, 403, '남의 개인 지식의 주인 줄')
  assert.equal((await post('/api/k/dpms/owner', kim, { curators: ['park', '없는사람'] })).status, 400)
  assert.equal((await post('/api/k/dpms/owner', kim, { owner: 'nobody' })).status, 400)
  assert.equal((await post('/api/k/dpms/owner', park, { private: true })).status, 403, '주인이 API 로 감추지 못한다')
  const ov = await get('/api/admin/overview', kim).then((x) => x.json())
  const names = ov.backups.map((b) => b.name)
  assert.ok(!names.some((n) => /일기/.test(n)), '관리 개관에 남의 개인 지식 이름 0 — ' + names.join(','))
  assert.ok(ov.knsPrivate >= 4, '수로만 ' + ov.knsPrivate)
  const h = await fetch(s.url + '/healthz').then((x) => x.json())
  assert.deepEqual(Object.keys(h).sort(), ['mode', 'ok', 'version'])
})
