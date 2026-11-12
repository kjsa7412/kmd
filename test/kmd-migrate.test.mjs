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
  fs.writeFileSync(path.join(dir, '_forms.md'), '# 갈래 장부\n\n| 갈래 | 별칭 | 폴더 | 종류 | 이름 | 서식 |\n|---|---|---|---|---|---|\n| 장애대응 | 카나리 | - | 사건 | - | 작업기록 |\n')
  await tryGit(dir, ['add', '-A'])
  await tryGit(dir, ['commit', '-qm', '갈래 장부'])
  const { eventGaps } = await import('../scripts/kmd-migrate.mjs')
  const g0 = eventGaps(await load()).find((g) => g.doc === EV)
  assert.ok(g0.missing.some((w) => w.id === '2026-1017-카나리'), '제목에 갈래의 별칭이 든 기록이 빠진 후보')
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
  // 날짜 차례 — 더 이른 날의 새 항목은 늦은 항목 앞에 끼운다(옛 줄은 그대로)
  const before = fs.readFileSync(path.join(dir, ...EV.split('/')), 'utf8')
  const early = input('ev3.json', { record: { title: '회의록 채우기: 2026-10-10 처음 10분', body: '앞선 날의 항목을 채웠다.\n\n## 바뀐 것\n- 장애대응 항목: 처음 10분 새로 둠' }, sections: [{ doc: EV, heading: '2026-10-10 처음 10분', new: true, sources: ['2026-1017-카나리'], content: '- **정한 것**: 오류율 1% 를 넘으면 멈춘다' }] })
  assert.match((await run('check', dir, early)).text, /자리: 「2026-10-17 카나리」 앞/)
  assert.equal((await run('put', dir, early, '--user', 'kim')).thrown, null)
  const heads = (await load()).byDocPath.get(EV).sections.map((s) => s.h)
  assert.ok(heads.indexOf('2026-10-10 처음 10분') === heads.indexOf('2026-10-17 카나리') - 1, '날짜 자리')
  const after = fs.readFileSync(path.join(dir, ...EV.split('/')), 'utf8')
  for (const l of before.split('\n').filter((x) => x.trim() && !/kmd:참고|^\*\*참고|^- |^  - /.test(x))) assert.ok(after.includes(l), `옛 줄 그대로: ${l}`)
  const { outOfOrder } = await import('../scripts/kmd-migrate.mjs')
  assert.equal(outOfOrder({ sections: [{ h: '2026-11-04 a' }, { h: '2026-09-30 b' }, { h: '머리' }, { h: '2026-12-01 c' }] }), 1)
})

test('빠진 사건 채우기: 갈래 문서가 없으면 new 항목이 그 문서를 세운다 · 장부에 없는 문서는 거절', async () => {
  const WK = 'docs/주간보고.md'
  fs.writeFileSync(path.join(dir, '_forms.md'), '# 갈래 장부\n\n| 갈래 | 별칭 | 폴더 | 종류 | 이름 | 서식 |\n|---|---|---|---|---|---|\n| 장애대응 | 카나리 | - | 사건 | - | 작업기록 |\n| 주간보고 | 주간 업무 보고 | - | 사건 | - | 작업기록 |\n')
  await tryGit(dir, ['add', '-A'])
  await tryGit(dir, ['commit', '-qm', '갈래 장부: 주간보고'])
  assert.ok(!fs.existsSync(path.join(dir, ...WK.split('/'))))
  const mk = (doc) => input('wk.json', { record: { title: '주간보고 채우기: 2026-10-17 카나리 주', body: '주간보고 문서가 없어 세우고 첫 항목을 넣었다.\n\n## 바뀐 것\n- 주간보고 항목: 카나리 주 새로 둠' }, sections: [{ doc, heading: '2026-10-17 카나리 주', new: true, sources: ['2026-1017-카나리'], content: '- **정한 것**: 오류율 1% 를 넘으면 멈춘다' }] })
  assert.match((await run('check', dir, mk('docs/없는갈래.md'))).text, /문서가 없다/)
  assert.match((await run('check', dir, mk(WK))).text, /자리: 새 문서/)
  const p = await run('put', dir, mk(WK), '--user', 'kim')
  assert.equal(p.thrown, null, p.text)
  const d = (await load()).byDocPath.get(WK)
  assert.deepEqual(d.sections.map((s) => s.h), ['2026-10-17 카나리 주'])
  assert.match(fs.readFileSync(path.join(dir, ...WK.split('/')), 'utf8'), /^# 주간보고/)
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

test('서식 맞춤(--format): 값이 같으면 이력(log/ · format) · 참고 줄 없음 · 값이 바뀌면 아무것도 안 씀 · relog 가 기록을 이력으로', async () => {
  const H = '준비'
  const refOf = () => decodeURI(fs.readFileSync(path.join(dir, DOC), 'utf8').split('<!-- kmd:참고')[1] || '')
  const cur = await sectionBody(H)
  // 값이 바뀌는 글(기록이 40 → 50 이라 말해 값 대조는 넘는다) → 서식 맞춤이 아니다: 저장 문이 아무것도 쓰지 않는다
  const h0 = await head()
  assert.ok(cur.includes('40'))
  const bad = input('fmt-bad.json', { record: { title: '서식 맞춤: 배포절차 › 준비', body: '풀 크기를 바꿨다.\n\n## 바뀐 것\n- DB 커넥션 풀: 40 → 50' }, sections: [{ doc: DOC, heading: H, base: sha16(cur), content: cur.replace('40', '50') }] })
  const p0 = await run('put', dir, bad, '--user', 'kim', '--format', '--allow-drop')
  assert.match(String(p0.thrown?.message), /서식 맞춤은 값을 바꾸지 않는다/)
  assert.equal(await head(), h0)
  // 값이 같은 글(첫 문장만) → 이력
  const ok = input('fmt-ok.json', { record: { title: '서식 맞춤: 배포절차 › 준비', body: '첫 문장을 더했다.' }, sections: [{ doc: DOC, heading: H, base: sha16(cur), content: `배포 전에 갖출 것을 적는다.\n\n${cur}` }] })
  const p1 = await run('put', dir, ok, '--user', 'kim', '--format')
  assert.equal(p1.thrown, null, String(p1.thrown?.message))
  const r = JSON.parse(p1.text)
  assert.ok(fs.existsSync(path.join(dir, 'log', `${r.record}.md`)), '이력 파일')
  assert.ok(!fs.existsSync(path.join(dir, 'work', `${r.record}.md`)), '기록이 아니다')
  const k = await load()
  const w = k.logs.find((x) => x.id === r.record)
  assert.ok(w && w.tags.includes('format') && !w.tags.includes('rebuild'), '태그 format')
  assert.ok(!refOf().includes(r.record), '참고 블록에 이력 줄을 달지 않는다')
  // 앞서 기록으로 남긴 서식 맞춤 → relog 로 이력으로(참고 줄도 걷는다)
  const cur2 = await sectionBody(H)
  const old = input('fmt-old.json', { record: { title: '서식 맞춤: 배포절차 › 준비 옛', body: '서식만 맞췄다.' }, sections: [{ doc: DOC, heading: H, base: sha16(cur2), content: cur2.replace('배포 전에 갖출 것을 적는다.', '배포 전에 갖출 것.') }] })
  const p2 = await run('put', dir, old, '--user', 'kim', '--allow-drop')
  assert.equal(p2.thrown, null, String(p2.thrown?.message))
  const id2 = JSON.parse(p2.text).record
  assert.ok(fs.existsSync(path.join(dir, 'work', `${id2}.md`)) && refOf().includes(id2), '기록 · 참고 줄')
  const dry = await run('relog', dir, '--user', 'kim', '--title', '서식 맞춤: 배포절차 › 준비 옛', '--dry')
  assert.match(dry.text, /옮길 기록 1/)
  assert.ok(fs.existsSync(path.join(dir, 'work', `${id2}.md`)), '마른 실행은 쓰지 않는다')
  const h1 = await head()
  const p3 = await run('relog', dir, '--user', 'kim', '--title', '서식 맞춤: 배포절차 › 준비 옛')
  assert.equal(p3.thrown, null, String(p3.thrown?.message))
  assert.notEqual(await head(), h1)
  assert.ok(!fs.existsSync(path.join(dir, 'work', `${id2}.md`)) && fs.existsSync(path.join(dir, 'log', `${id2}.md`)), '옮김')
  assert.ok(!refOf().includes(id2), '참고 줄 걷음')
  const k2 = await load()
  assert.ok(k2.logs.find((x) => x.id === id2)?.tags.includes('format'))
  assert.equal(k2.byDocPath.get(DOC).sections.find((s) => s.h === H).applied, id2, '표지는 그대로(이력 id · 다듬기와 같다)')
  assert.equal((await tryGit(dir, ['status', '--porcelain', '--', 'work', 'log', 'docs'])).out.trim(), '', '남은 변경 없음')
})
