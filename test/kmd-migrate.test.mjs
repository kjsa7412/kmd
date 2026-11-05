// 다시 그리기 도구(scripts/kmd-migrate.mjs · 세션 스킬 kmd-migrate) — 이어진 기록 · 사라지는 표 행 · 문장 · 마른 검사 · 넣기(줄 안 다시 검사 · 걸리면 아무것도 안 씀)

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureRepo, tryGit } from '../core/git.js'
import { loadKnowledge } from '../core/knowledge.js'
import { sha16 } from '../core/text.js'
import { copyDir } from './helpers.mjs'
import { main, linksOf, dropsOf } from '../scripts/kmd-migrate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOC = 'docs/배포절차.md'
let tmp, dir
const load = () => loadKnowledge({ id: 'dpms', name: 'dpms', dir }, { team: true })
const head = async () => (await tryGit(dir, ['rev-parse', 'HEAD'])).out.trim()
// main 을 부르고 찍은 글 · 나간 코드를 받는다
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
const input = (name, j) => {
  const p = path.join(tmp, name)
  fs.writeFileSync(p, JSON.stringify(j))
  return p
}
const sectionBody = async (h) => (await load()).byDocPath.get(DOC).sections.find((s) => s.h === h).body

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-migrate-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  dir = path.join(tmp, 'dpms')
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), dir)
  await ensureRepo(dir)
})
after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('이어진 기록: 항목 표지 · 오래된 순 · 표시', async () => {
  const k = await load()
  const d = k.byDocPath.get(DOC)
  const links = linksOf(k, d, d.sections.find((s) => s.h === '준비'))
  assert.ok(links.some((x) => x.id === '2026-1021-배포-창' && x.how.includes('applied')), '항목 표지가 가리키는 기록')
  assert.deepEqual(links.map((x) => x.date), [...links.map((x) => x.date)].sort(), '오래된 순')
  const t = await run('trail', dir, DOC, '준비', '--json')
  assert.equal(JSON.parse(t.text).base, sha16(d.sections.find((s) => s.h === '준비').body))
  const s = await run('scan', dir)
  assert.match(s.text, /^# dpms — 항목 \d+ · 기록 없는 항목 \d+/)
})

test('빠진 사건 채우기: 진단이 찾고 · 재료에 없는 값 · 머리 꼴 거절 · 넣으면 빠진 목록에서 사라짐', async () => {
  const EV = 'docs/장애대응.md'
  fs.writeFileSync(path.join(dir, '_forms.md'), '# 갈래 장부\n\n| 갈래 | 다른 이름 | 폴더 | 종류 | 이름 | 서식 |\n|---|---|---|---|---|---|\n| 장애대응 | 카나리 | - | 사건 | - | 작업기록 |\n')
  await tryGit(dir, ['add', '-A'])
  await tryGit(dir, ['commit', '-qm', '갈래 장부'])
  const { eventGaps } = await import('../scripts/kmd-migrate.mjs')
  const g0 = eventGaps(await load()).find((g) => g.doc === EV)
  assert.ok(g0.missing.some((w) => w.id === '2026-1017-카나리'), '제목에 갈래의 다른 이름이 든 기록이 빠진 후보')
  const mk = (heading, content) => input('ev.json', { record: { title: `회의록 채우기: ${heading}`, body: '장애대응 문서에 빠진 카나리 결정을 그 기록으로 채웠다.\n\n## 바뀐 것\n- 장애대응 항목: 카나리 새로 둠\n\n## 근거\n- 재료 기록: 2026-1017-카나리' }, sections: [{ doc: EV, heading, new: true, sources: ['2026-1017-카나리'], content }] })
  const good = '- **정한 것**: 첫 30분은 요청의 10% 만 보낸다. 오류율 1% 를 넘으면 멈춘다'
  assert.match((await run('check', dir, mk('2026-10-17 카나리', good.replace('10%', '20%')))).text, /근거에 없는 값이 있다: 20%/)
  assert.match((await run('check', dir, mk('카나리', good))).text, /사건 갈래 문서의 머리는/)
  assert.match((await run('check', dir, input('ev2.json', { record: { title: 't', body: 'b\n\n## 바뀐 것\n- x' }, sections: [{ doc: EV, heading: '2026-10-17 카나리', new: true, sources: [], content: good }] }))).text, /sources/)
  const p = await run('put', dir, mk('2026-10-17 카나리', good), '--user', 'kim')
  assert.equal(p.thrown, null, p.text)
  const k = await load()
  assert.ok(k.byDocPath.get(EV).sections.some((s) => s.h === '2026-10-17 카나리'))
  assert.ok(!eventGaps(k).find((g) => g.doc === EV).missing.some((w) => w.id === '2026-1017-카나리'), '채운 뒤 빠진 목록에서 사라진다')
  assert.match((await run('check', dir, mk('2026-10-17 카나리', good))).text, /이미 있는 머리다/)
})

test('사라지는 표 행 · 문장', () => {
  const old = '첫 문장은 운영 배포 창을 정하는 팀의 규칙을 설명한다.\n\n| 꾸러미 | 판 |\n|---|---|\n| spring-boot | 3.3.4 |\n| mybatis | 3.0.3 |'
  const r = dropsOf(old, '| 꾸러미 | 판 |\n|---|---|\n| spring-boot | 3.3.4 |')
  assert.deepEqual(r.rows, ['mybatis'])
  assert.equal(r.lines.length, 1)
  assert.deepEqual(dropsOf(old, old), { rows: [], lines: [] })
})

test('검사 · 넣기: 값이 빠지면 걸림 · 사라지는 문장은 사람 확인 · 걸리면 아무것도 안 씀 · 넣으면 기록 + 표지 + 커밋', async () => {
  const cur = await sectionBody('준비')
  const base = sha16(cur)
  const next = '배포 창은 화 · 목 14:00 ~ 17:00 이다. DB 커넥션 풀은 40 으로 둔다.'
  // 값(1022-01)이 빠졌는데 기록이 말하지 않았다 → 걸림
  const bad = input('bad.json', { record: { title: '다시 그림: 배포절차 › 준비', body: '준비를 지금으로 다시 썼다.\n\n## 바뀐 것\n- 이미지 이름 예: 없음' }, sections: [{ doc: DOC, heading: '준비', base, content: next }] })
  const c1 = await run('check', dir, bad)
  assert.equal(c1.code, 2)
  assert.match(c1.text, /옛 글의 값이 빠졌다: 1022/)
  // 기록이 「옛 → (뺌)」 으로 말하면 값은 넘고, 사라지는 문장이 남는다
  const okIn = input('ok.json', { record: { title: '다시 그림: 배포절차 › 준비', body: '준비를 지금으로 다시 썼다.\n\n## 바뀐 것\n- 이미지 이름 예: 1022-01 → (뺌)\n\n## 근거\n- 이어진 기록 1' }, sections: [{ doc: DOC, heading: '준비', base, content: next }] })
  const c2 = await run('check', dir, okIn)
  assert.equal(c2.code, 0)
  assert.match(c2.text, /사라지는 문장\(1\)/)
  const h0 = await head()
  const p1 = await run('put', dir, okIn, '--user', 'kim')
  assert.match(String(p1.thrown?.message), /사라지는 표 행 · 문장이 있다/)
  assert.equal(await head(), h0, '걸리면 커밋 없음')
  assert.equal(await sectionBody('준비'), cur)
  const p0 = await run('put', dir, okIn, '--user', 'kmd', '--allow-drop')
  assert.equal(p0.thrown?.code, 'E_FORBIDDEN', '예약 이름은 쓰지 못한다')
  // 사람이 본 뒤 --allow-drop → 넣는다
  const p2 = await run('put', dir, okIn, '--user', 'kim', '--allow-drop')
  assert.equal(p2.thrown, null)
  const r = JSON.parse(p2.text)
  assert.ok(r.ok && r.commit)
  assert.notEqual(await head(), h0)
  const k = await load()
  const w = k.byWork.get(r.record)
  assert.ok(w.tags.includes('rebuild') && w.tags.includes('put'), '태그 rebuild · put')
  assert.equal(k.byDocPath.get(DOC).sections.find((s) => s.h === '준비').applied, r.record, '항목 표지')
  assert.equal(await sectionBody('준비'), next)
  // 같은 입력을 다시 넣으면 지문이 어긋나 아무것도 쓰지 않는다
  const h1 = await head()
  const p3 = await run('put', dir, okIn, '--user', 'kim', '--allow-drop')
  assert.match(p3.text, /그사이 항목이 바뀌었다/)
  assert.equal(await head(), h1)
})
