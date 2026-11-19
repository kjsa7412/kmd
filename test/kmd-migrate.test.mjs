// 다시 그리기 도구(scripts/kmd-migrate.mjs · 세션 스킬 kmd-migrate) — 이어진 기록 · 사라지는 표 행 · 문장 · 마른 검사 · 넣기(줄 안 다시 검사 · 걸리면 아무것도 안 씀)

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureRepo, tryGit, commitPaths } from '../core/git.js'
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
  const mk = (heading, content) => input('ev.json', { record: { title: `회의록 채우기: ${heading}`, body: '장애대응 문서에 빠진 카나리 결정을 그 기록으로 채웠다.\n\n## 바뀐 것\n- 장애대응 항목: 카나리 새로 둠\n\n## 근거\n- 재료 기록: 2026-1017-카나리' }, sections: [{ doc: EV, heading, new: true, sources: ['2026-1017-카나리'], kind: '사건', gist: '카나리 결정을 정한 일', content }] })
  const good = '- **정한 것**: 첫 30분은 요청의 10% 만 보낸다. 오류율 1% 를 넘으면 멈춘다'
  assert.match((await run('check', dir, mk('2026-10-17 카나리', good.replace('10%', '20%')))).text, /근거에 없는 값이 있다: 20%/)
  assert.match((await run('check', dir, mk('카나리', good))).text, /사건 갈래 문서의 머리는/)
  assert.match((await run('check', dir, input('ev2.json', { record: { title: 't', body: 'b\n\n## 바뀐 것\n- x' }, sections: [{ doc: EV, heading: '2026-10-17 카나리', new: true, sources: [], kind: '사건', gist: '카나리 결정을 정한 일', content: good }] }))).text, /sources/)
  const p = await run('put', dir, mk('2026-10-17 카나리', good), '--user', 'kim')
  assert.equal(p.thrown, null, p.text)
  const k = await load()
  assert.ok(k.byDocPath.get(EV).sections.some((s) => s.h === '2026-10-17 카나리'))
  assert.ok(!eventGaps(k).find((g) => g.doc === EV).missing.some((w) => w.id === '2026-1017-카나리'), '채운 뒤 빠진 목록에서 사라진다')
  assert.match((await run('check', dir, mk('2026-10-17 카나리', good))).text, /이미 있는 머리다/)
  // 날짜 차례 — 더 이른 날의 새 항목은 늦은 항목 앞에 끼운다(옛 줄은 그대로)
  const before = fs.readFileSync(path.join(dir, ...EV.split('/')), 'utf8')
  const early = input('ev3.json', { record: { title: '회의록 채우기: 2026-10-10 처음 10분', body: '앞선 날의 항목을 채웠다.\n\n## 바뀐 것\n- 장애대응 항목: 처음 10분 새로 둠' }, sections: [{ doc: EV, heading: '2026-10-10 처음 10분', new: true, sources: ['2026-1017-카나리'], kind: '사건', gist: '오류율로 멈추기를 정한 일', content: '- **정한 것**: 오류율 1% 를 넘으면 멈춘다' }] })
  assert.match((await run('check', dir, early)).text, /자리: 「2026-10-17 카나리」 앞/)
  assert.equal((await run('put', dir, early, '--user', 'kim')).thrown, null)
  const heads = (await load()).byDocPath.get(EV).sections.map((s) => s.h)
  assert.ok(heads.indexOf('2026-10-10 처음 10분') === heads.indexOf('2026-10-17 카나리') - 1, '날짜 자리')
  const after = fs.readFileSync(path.join(dir, ...EV.split('/')), 'utf8')
  for (const l of before.split('\n').filter((x) => x.trim() && !/kmd:참고|^\*\*참고|^- |^  - /.test(x))) assert.ok(after.includes(l), `옛 줄 그대로: ${l}`)
  // 짝 짓기(H6 · 엮기) — 새 항목의 종류 · 뜻 한 줄로 put 이 항목 장부 줄(뜻 한 줄) · 문서 장부 줄을 같이 짓는다. 적지 않으면 check 가 거절한다(장부 밖 항목을 세우지 않는다)
  const bare = input('ev5.json', { record: { title: '회의록 채우기: 2026-10-13 종류 없음', body: '시험.\n\n## 바뀐 것\n- 장애대응 항목: 종류 없음 새로 둠' }, sections: [{ doc: EV, heading: '2026-10-13 종류 없음', new: true, sources: ['2026-1017-카나리'], content: '- **정한 것**: 오류율 1% 를 넘으면 멈춘다' }] })
  assert.match((await run('check', dir, bare)).text, /종류\(kind\)와 뜻 한 줄\(gist\)/)
  const vocabOf = async () => (await load()).vocab.coords
  const n0 = (await vocabOf()).size
  const woven = input('ev4.json', { record: { title: '회의록 채우기: 2026-10-12 엮기 시험', body: '시험으로 채웠다.\n\n## 바뀐 것\n- 장애대응 항목: 엮기 시험 새로 둠' }, sections: [{ doc: EV, heading: '2026-10-12 엮기 시험', new: true, sources: ['2026-1017-카나리'], kind: '사건', gist: '카나리에서 오류율이 넘어 멈춘 일', content: '- **정한 것**: 오류율 1% 를 넘으면 멈춘다' }] })
  const pw = await run('put', dir, woven, '--user', 'kim')
  assert.equal(pw.thrown, null, pw.text)
  const made = [...(await vocabOf()).entries()].filter(([, v]) => v.gist === '카나리에서 오류율이 넘어 멈춘 일')
  assert.equal(made.length, 1, '항목 장부에 뜻 한 줄과 함께 섰다')
  assert.equal((await vocabOf()).size, n0 + 1)
  assert.ok(made[0][0].startsWith('사건:'), made[0][0])
  assert.ok(fs.readFileSync(path.join(dir, '_managed.md'), 'utf8').includes('`' + made[0][0] + '`'), '문서 장부 줄도 섰다')
  const { outOfOrder } = await import('../scripts/kmd-migrate.mjs')
  assert.equal(outOfOrder({ sections: [{ h: '2026-11-04 a' }, { h: '2026-09-30 b' }, { h: '머리' }, { h: '2026-12-01 c' }] }), 1)
})

test('빠진 사건 채우기: 갈래 문서가 없으면 new 항목이 그 문서를 세운다 · 장부에 없는 문서는 거절', async () => {
  const WK = 'docs/주간보고.md'
  fs.writeFileSync(path.join(dir, '_forms.md'), '# 갈래 장부\n\n| 갈래 | 별칭 | 폴더 | 종류 | 이름 | 서식 |\n|---|---|---|---|---|---|\n| 장애대응 | 카나리 | - | 사건 | - | 작업기록 |\n| 주간보고 | 주간 업무 보고 | - | 사건 | - | 작업기록 |\n')
  await tryGit(dir, ['add', '-A'])
  await tryGit(dir, ['commit', '-qm', '갈래 장부: 주간보고'])
  assert.ok(!fs.existsSync(path.join(dir, ...WK.split('/'))))
  const mk = (doc) => input('wk.json', { record: { title: '주간보고 채우기: 2026-10-17 카나리 주', body: '주간보고 문서가 없어 세우고 첫 항목을 넣었다.\n\n## 바뀐 것\n- 주간보고 항목: 카나리 주 새로 둠' }, sections: [{ doc, heading: '2026-10-17 카나리 주', new: true, sources: ['2026-1017-카나리'], kind: '보고', gist: '카나리를 돌린 주의 보고', content: '- **정한 것**: 오류율 1% 를 넘으면 멈춘다' }] })
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

test('본문 반영: 항목이 여럿이면 기록의 바뀐 것 값을 합쳐 본다 · 없는 값 · 옛 글 그대로인 값은 걸림(아무것도 쓰지 않음)', async () => {
  const k = await load()
  const sec = (h) => k.byDocPath.get(DOC).sections.find((s) => s.h === h).body
  const two = (body, hc) => input('reflect.json', { record: { title: '두 항목', body }, sections: [{ doc: DOC, heading: '카나리', base: sha16(sec('카나리')), content: `${sec('카나리')} 그렇다.` }, { doc: DOC, heading: '헬스 체크', base: sha16(sec('헬스 체크')), content: hc ?? `${sec('헬스 체크')} 그렇다.` }] })
  const h0 = await head()
  const c1 = await run('check', dir, two('두 항목을 다듬었다.\n\n## 바뀐 것\n- 보존: 90일 → 777일\n- 부르는 주기: 10초 → 30초'))
  assert.equal(c1.code, 2)
  assert.match(c1.text, /기록 › 본문 반영\n검사: 걸림\(unreflected\)/)
  assert.match(c1.text, /없다: 777일/)
  assert.match(c1.text, /옛 글 그대로만 있다\(이번에 들어가지 않았다\): 30초/)
  const p1 = await run('put', dir, two('두 항목을 다듬었다.\n\n## 바뀐 것\n- 보존: 90일 → 777일'), '--user', 'kim')
  assert.match(String(p1.thrown?.message), /검사에 걸렸다/)
  assert.equal(await head(), h0, '걸리면 커밋 없음')
  // 새 값을 고칠 항목에 넣으면 넘는다
  const c2 = await run('check', dir, two('두 항목을 다듬었다.\n\n## 바뀐 것\n- 시간 초과: 3초 → 5초', sec('헬스 체크').replace('시간 초과는 3초 — 3초', '시간 초과는 5초 — 5초')))
  assert.doesNotMatch(c2.text, /본문 반영/)
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

test('장부만 고치기(ledger): 뜻 한 줄 · 종류 뜻 · 폐기 · 합치기 · 장부 줄 걷기 · 있는 항목 names+gist → 이력 하나 · 걸리면 아무것도 쓰지 않는다', async () => {
  const voc = () => fs.readFileSync(path.join(dir, '_vocab.md'), 'utf8')
  const reg = () => fs.readFileSync(path.join(dir, '_managed.md'), 'utf8')
  // 걸림: 없는 항목 · 없는 종류 절 · sections 와 같이 싣기 → 아무것도 쓰지 않는다
  const v0 = voc()
  const h0 = await head()
  const bad = input('lg-bad.json', { ledger: [{ op: 'gist', coord: 'proc:없음', gist: 'x' }, { op: 'kind', kind: '없는종류', gist: 'y' }] })
  const c0 = await run('check', dir, bad)
  assert.equal(c0.code, 2)
  assert.match(c0.text, /proc:없음」 는 항목 장부에 없다/)
  assert.match(c0.text, /없는종류」 종류 절/)
  const p0 = await run('put', dir, bad, '--user', 'kim')
  assert.ok(p0.thrown && p0.thrown.exit === 2)
  assert.equal(voc(), v0)
  assert.equal(await head(), h0)
  assert.match((await run('check', dir, input('lg-mix.json', { ledger: [{ op: 'gist', coord: 'proc:롤백', gist: 'x' }], sections: [{ doc: DOC, heading: '롤백', base: 'x', content: 'y' }] }))).thrown?.message || '', /sections 를 비운다/)
  assert.match((await run('check', dir, input('lg-op.json', { ledger: [{ op: 'drop', coord: 'proc:롤백' }] }))).thrown?.message || '', /input\.ledger/)
  // 넣기: 한 커밋 · 이력(log/ · 태그 ledger) · 항목 글은 그대로
  const good = input('lg.json', {
    why: '옛 장부 줄 보강',
    ledger: [
      { op: 'kind', kind: 'proc', gist: '배포 · 되돌림의 한 걸음' },
      { op: 'retire', coord: 'proc:되돌리기', to: 'proc:롤백', why: '같은 걸음' },
      { op: 'unplace', coord: 'proc:되돌리기' },
    ],
    names: [{ coord: 'proc:롤백', gist: '배포를 앞 판으로 되돌리는 걸음' }],
  })
  const c1 = await run('check', dir, good)
  assert.equal(c1.code, 0, c1.text)
  assert.match(c1.text, /종류 뜻: proc/)
  assert.match(c1.text, /뜻 한 줄: proc:롤백/)
  const body0 = await sectionBody('롤백')
  const p1 = await run('put', dir, good, '--user', 'kim')
  assert.equal(p1.thrown, null, String(p1.thrown?.message) + p1.text)
  const r = JSON.parse(p1.text)
  assert.ok(r.commit && r.commit !== h0)
  assert.ok(fs.existsSync(path.join(dir, 'log', `${r.record}.md`)) && !fs.existsSync(path.join(dir, 'work', `${r.record}.md`)), '이력이다')
  const k = await load()
  assert.ok(k.logs.find((x) => x.id === r.record)?.tags.includes('ledger'))
  assert.equal(k.vocab.coords.get('proc:롤백').gist, '배포를 앞 판으로 되돌리는 걸음')
  assert.equal(k.vocab.kinds.get('proc'), '배포 · 되돌림의 한 걸음')
  assert.match(k.vocab.coords.get('proc:되돌리기').deprecated, /→ proc:롤백: 같은 걸음$/)
  assert.ok(!reg().includes('`proc:되돌리기`'), '문서 장부 줄을 걷었다')
  assert.equal(await sectionBody('롤백'), body0, '항목 글은 그대로')
  // 종류 뜻 · 뜻 한 줄은 다시 적으면 갈음한다
  const p2 = await run('put', dir, input('lg2.json', { ledger: [{ op: 'kind', kind: 'proc', gist: '배포 걸음' }, { op: 'gist', coord: 'proc:롤백', gist: '앞 판으로 되돌림' }] }), '--user', 'kim', '--format')
  assert.equal(p2.thrown, null, String(p2.thrown?.message))
  const k2 = await load()
  assert.equal(k2.vocab.kinds.get('proc'), '배포 걸음')
  assert.equal(k2.vocab.coords.get('proc:롤백').gist, '앞 판으로 되돌림')
  assert.equal((voc().match(/^뜻: /gm) || []).length, 4, '종류마다 한 줄(proc 는 갈음 · 늘지 않는다)')
  assert.ok(k2.logs.find((x) => x.id === JSON.parse(p2.text).record)?.tags.includes('format'), '--format 은 태그 format 도')
})

test('서식 맞춤(--format) 날짜 표기: 2026.08.01 · 2026/09/01 을 ISO 로 맞춘 글은 check --format · put --format 을 넘는다(값 대조는 날짜 표기를 맞춰 견준다)', async () => {
  const full = path.join(dir, DOC)
  fs.writeFileSync(full, fs.readFileSync(full, 'utf8').replace('## 꾸러미 판', '## 점검 일정\n정기 점검은 2026.08.01 과 2026/09/01 에 한다.\n\n## 꾸러미 판'))
  await commitPaths(dir, [DOC], '테스트: 점검 일정', 'kim')
  const cur = await sectionBody('점검 일정')
  const j = { record: { title: '서식 맞춤: 점검 일정 날짜 꼴', body: '날짜 꼴만 YYYY-MM-DD 로 맞췄다.' }, sections: [{ doc: DOC, heading: '점검 일정', base: sha16(cur), content: '정기 점검은 2026-08-01 과 2026-09-01 에 한다.' }] }
  const plain = await run('check', dir, input('fmt-date0.json', j))
  assert.equal(plain.code, 2, '서식 맞춤이 아니면 값 대조(근거에 없는 값)에 걸린다')
  const c = await run('check', dir, input('fmt-date.json', j), '--format')
  assert.equal(c.code, 0, c.text)
  // 값이 바뀌면 --format 검사도 걸린다
  const bad = await run('check', dir, input('fmt-date-bad.json', { ...j, sections: [{ ...j.sections[0], content: '정기 점검은 2026-08-02 과 2026-09-01 에 한다.' }] }), '--format')
  assert.equal(bad.code, 2)
  assert.match(bad.text, /서식 맞춤은 값을 바꾸지 않는다/)
  const p = await run('put', dir, input('fmt-date.json', j), '--user', 'kim', '--format')
  assert.equal(p.thrown, null, String(p.thrown?.message))
  assert.equal(await sectionBody('점검 일정'), '정기 점검은 2026-08-01 과 2026-09-01 에 한다.')
})

test('머리 이름 바꾸기(rename): 같은 엔진 · 장부 줄 · 옛 머리 별칭 · 본문 링크 · 이력 글(세션) · 차례 장부를 만들지 않음 · 마른 실행 · 검사 · residue 가 structure 이력을 옛 태그로 세지 않음', async () => {
  const ops = path.join(dir, 'docs', '운영.md')
  fs.writeFileSync(ops, `${fs.readFileSync(ops, 'utf8').replace(/\s*$/, '')}\n\n자세히는 [헬스 체크](배포절차.md#헬스%20체크).\n`)
  await commitPaths(dir, ['docs/운영.md'], '테스트: 링크', 'kim')
  // 검사: 장 번호 머리 · 없는 머리는 걸리고 아무것도 쓰지 않는다
  const h0 = await head()
  const bad = await run('rename', dir, DOC, '헬스 체크', '3. 헬스 점검', '--user', 'kim')
  assert.equal(bad.thrown?.exit, 2)
  assert.match(bad.text, /장 번호/)
  const none = await run('rename', dir, DOC, '없는 머리', '헬스 점검', '--user', 'kim', '--dry')
  assert.equal(none.thrown?.exit, 2)
  // 마른 실행: 바뀔 것만 보이고 쓰지 않는다
  const dry = await run('rename', dir, DOC, '헬스 체크', '헬스 점검', '--user', 'kim', '--dry')
  assert.equal(dry.thrown, null, String(dry.thrown?.message))
  assert.match(dry.text, /항목 이름: 배포절차 › 헬스 체크 → 배포절차 › 헬스 점검/)
  assert.match(dry.text, /별칭: proc:헬스 체크 \+ 헬스 체크/)
  assert.equal(await head(), h0)
  const r = await run('rename', dir, DOC, '헬스 체크', '헬스 점검', '--user', 'kim')
  assert.equal(r.thrown, null, String(r.thrown?.message))
  const out = JSON.parse(r.text.slice(r.text.indexOf('{')))
  assert.ok(out.commit && out.log)
  const k = await load()
  const d = k.byDocPath.get(DOC)
  assert.ok(d.sections.some((s) => s.h === '헬스 점검') && !d.sections.some((s) => s.h === '헬스 체크'))
  assert.equal(d.sections.find((s) => s.h === '헬스 점검').applied, '2026-1021-헬스-체크', '표지는 글과 같이')
  const v = k.vocab.coords.get('proc:헬스 체크')
  assert.equal(v.label, '헬스 점검', '라벨은 새 머리')
  assert.deepEqual(v.aliases, ['상태 점검', '헬스 체크'], '옛 머리는 별칭')
  assert.match(fs.readFileSync(path.join(dir, '_managed.md'), 'utf8'), /\| `proc:헬스 체크` \| `docs\/배포절차.md` \| `## 헬스 점검` \|/)
  assert.match(fs.readFileSync(ops, 'utf8'), /\[헬스 체크\]\(배포절차\.md#헬스%20점검\)/, '본문 링크')
  assert.ok(!fs.existsSync(path.join(dir, '_order.md')), '차례 장부를 새로 만들지 않는다')
  const lg = k.logs.find((x) => x.id === out.log)
  assert.ok(lg.tags.includes('structure'))
  assert.match(lg.body, /세션에서 kmd-migrate rename 으로 바꿨다/)
  assert.doesNotMatch(lg.body, /구조 화면/)
  assert.equal((await tryGit(dir, ['status', '--porcelain', '--', 'docs', 'log', '_vocab.md', '_managed.md'])).out.trim(), '', '남은 변경 없음')
  // residue: 지금 엔진이 단 structure 이력은 옛 태그 이력이 아니다
  const res = await run('residue', dir, '--json')
  assert.ok(!JSON.parse(res.text).judge.some((j) => /옛 태그 이력/.test(j.what)), res.text)
})
