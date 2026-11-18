// 옛 꼴 이행기(core/oldform.js): 계획 · 쓰기 · 멱등 · 상태가 바뀌지 않음 · 지운 기록의 참고 줄 걷기 · 개인 지식 한 번 이행
//   끝에 팀 사본(.kmd-data/residue/dpms · gdi)이 있으면 residue 를 돌려 셈을 찍는다(읽기만)

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureRepo, tryGit } from '../core/git.js'
import { loadKnowledge } from '../core/knowledge.js'
import { locate } from '../core/registry.js'
import { parseDoc } from '../core/sections.js'
import { parsePut } from '../core/parts.js'
import { plan, apply, runOnce, verifyPlan, oldStates, vocabDash, registryHead, membersFix, formsNewdoc, formsHead, MARK_FILE } from '../core/oldform.js'
import { main } from '../scripts/kmd-migrate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
let tmp

// 옛 꼴 지식 하나: 옛 장부 머리 · 줄표 줄 · 저장 문 밖 기록 · 옛 표지 기록 · 정리 시절 이력 · 세움 메모 · 기록 없는 첨부
const REC = (id, { title = id, date, tags = [], touches = [], extra = '', body = '요약 한 문장.' }) =>
  `---\nid: ${id}\ntitle: ${title}\ndate: ${date}\nauthor: kim\n${touches.length ? `touches:\n${touches.map((t) => `  - ${t}`).join('\n')}\n` : ''}${tags.length ? `tags: [${tags.join(', ')}]\n` : ''}${extra}---\n\n# ${title}\n\n${body}\n`
const HELD = '## 넣지 못함\n```json\n[\n {\n  "doc": "docs/배포.md",\n  "heading": "절차",\n  "code": "format",\n  "why": "꼴이 틀렸다",\n  "edits": [{ "find": "주 1회", "replace": "주 2회" }]\n }\n]\n```'
function build(dir) {
  const w = (rel, text) => {
    const full = path.join(dir, ...rel.split('/'))
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, text)
  }
  w('_forms.md', '# 갈래 장부\n\n새 문서는 여기 있는 갈래로만 선다.\n\n| 갈래 | 다른 이름 | 폴더 | 종류 | 이름 | 서식 |\n|---|---|---|---|---|---|\n| 회의록 | 회의 | - | 사건 | - | 작업기록 |\n| 배포 | - | - | 대상 | `배포:*` | 지식문서 |\n')
  w('_vocab.md', '# 좌표 어휘\n\n이 파일이 통제 어휘다. `ctx check` 가 막는다.\n\n## 아직 비어 있다\n\n| 자리 | 모양 |\n|---|---|\n| 타입 절 | 설명 |\n\n## 배포\n\n- `배포:절차` — 배포 절차 (구)\n  aliases: 배포순서\n- `배포:창` — 배포 창\n- `배포:옛창` — 옛 배포 창\n  deprecated: 2026-01-01 → 배포:창 — 합침\n\n## 회의\n\n- `회의:2026-01-02`: 킥오프\n')
  w('_managed.md', '# 관리 문서 등록부\n\n좌표가 어느 관리 문서에 대응하는지 적는다.\n\n| 좌표 패턴 | 관리 문서 | 섹션 | 비고 | 종류 |\n|---|---|---|---|---|\n| `배포:*` | `docs/배포.md` | `## {값}` | 서버 추가 · 2026-0101-이관 | 대상 |\n| `범위:전체` | `docs/배포.md` | - | 서버 추가 |\n\n**행은 큐레이터가 더한다**.\n\n## 등록부에 없는 좌표는 정상이다\n\n설명 단락.\n\n| 이름 | 문서 | 항목 |\n|---|---|---|\n| `회의:2026-01-02` | `docs/회의록.md` | `## 2026-01-02 킥오프` |\n')
  w('_members.md', '# 사람\n\n- 주인: \n- 정리: lee\n- Claude 에 보내지 않음: 아니오\n- 저장 방식: 승인\n- 모두: 없음\n- 읽기: \n- 쓰기: kim\n- 지식관리자: \n- 묶음: \n')
  w('_seed.json', '{"note":"세움"}\n')
  w('README.md', '# 시험 지식\n\n작업 기록을 남기면 정리가 그 기록을 문서에 넣는다.\n')
  w('docs/배포.md', [
    '# 배포', '', '배포 절차와 창을 적는다.', '',
    '## 절차', '<!-- applied: 2026-0103-정리 -->', '주 1회 화요일에 배포한다.', '',
    '## 창', '<!-- applied: 2026-0107-바로잡기 -->', '배포 창은 화 · 목 오후다.', '',
    '<!-- kmd:참고 · kmd 가 적고 고친다. 손으로 고치지 않는다 -->', '**참고**', '',
    '- (문서)', '  - 표식: cdp:form public-si/BM_501',
    '- 절차', '  - 2026-01-02 [배포 절차 정함](../work/2026-0102-배포-절차.md)',
    '- 창', '  - 2026-01-02 [배포 창](../work/2026-0102-배포-창.md)', '  - 2026-01-06 [창 넓힘](../work/2026-0106-창-넓힘.md)', '  - 2026-01-07 [창 바로잡기](../work/2026-0107-바로잡기.md)',
    '<!-- /kmd:참고 -->', '',
  ].join('\n'))
  w('docs/회의록.md', '# 회의록\n\n회의마다 한 항목.\n\n## 2026-01-02 킥오프\n- 누가: kim\n- 무엇을: 배포 창\n')
  // 저장 문 밖에서 들어간 기록(표지 날짜 · 정리 이력의 reflects) · 머리말 옛 칸
  w('work/2026-0102-배포-절차.md', REC('2026-0102-배포-절차', { date: '2026-01-02 10:00', touches: ['배포:절차'], tags: ['배포'], extra: 'source: "dpms_docs@abc/x.md"\nattachments: [assets/2026-0102-배포-절차/b.txt]\n' }))
  w('work/2026-0102-배포-창.md', REC('2026-0102-배포-창', { date: '2026-01-02 11:00', touches: ['배포:창'] }))
  // 표지보다 늦은 기록(old · 판단)
  w('work/2026-0104-늦은-기록.md', REC('2026-0104-늦은-기록', { date: '2026-01-04 09:00', touches: ['배포:절차'] }))
  // 옛 표지 기록(넣지 못함)
  w('work/2026-0105-넣지-못함.md', REC('2026-0105-넣지-못함', { date: '2026-01-05 09:00', touches: ['배포:절차'], tags: ['held'], body: `절차를 주 2회로.\n\n${HELD}` }))
  // 저장 문이 넣은 기록 · 그것을 바로잡은 기록(세션이 지우기로 정한 것)
  w('work/2026-0106-창-넓힘.md', REC('2026-0106-창-넓힘', { date: '2026-01-06 09:00', touches: ['배포:창'], tags: ['put'], body: '창을 넓혔다.\n\n## 넣은 것\n- docs/배포.md › 창: 화 → 화 · 목' }))
  w('work/2026-0107-바로잡기.md', REC('2026-0107-바로잡기', { date: '2026-01-07 09:00', touches: ['배포:창'], tags: ['put'], extra: 'supersedes: 2026-0106-창-넓힘\n', body: '창을 바로잡았다.\n\n## 넣은 것\n- docs/배포.md › 창: 화 · 목 → 화 · 목 오후' }))
  // 정리 시절 이력
  w('log/2026-0103-정리.md', REC('2026-0103-정리', { date: '2026-01-03 09:00', tags: ['curate-llm'], extra: 'reflects:\n  - 2026-0102-배포-절차\n' }))
  w('log/2026-0101-문서-꼴-옮김.md', REC('2026-0101-문서-꼴-옮김', { date: '2026-01-01 09:00', tags: ['docfmt'] }))
  w('log/2026-0108-손-고침.md', REC('2026-0108-손-고침', { date: '2026-01-08 09:00', tags: ['edit'] }))
  // 첨부: 기록 것 · 기록 없는 것
  w('work/assets/2026-0102-배포-절차/b.txt', 'b')
  w('work/assets/2026-0101-이관/a.txt', 'a')
}
// 옮기기 전 상태는 옛 읽기로 잰다(지금 knowledge.js 는 put 으로만 가른다)
const oldStatesOf = async (dir) => Object.fromEntries(oldStates(await loadKnowledge({ id: 'k', name: 'k', dir })))
const states = async (dir) => Object.fromEntries((await loadKnowledge({ id: 'k', name: 'k', dir })).works.map((w) => [w.id, w.state]))
const read = (dir, rel) => fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8')
const has = (dir, rel) => fs.existsSync(path.join(dir, ...rel.split('/')))

before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-oldform-test-')) })
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

test('장부 규칙: 줄 단위 · 읽기 결과 그대로', () => {
  assert.equal(vocabDash('- `a:b` — 라벨 (구)\n  deprecated: 2026-01-01 → a:c — 까닭'), '- `a:b`: 라벨\n  deprecated: 2026-01-01 → a:c: 까닭')
  assert.equal(vocabDash('- `a:b`: 라벨'), '- `a:b`: 라벨')
  const t = formsNewdoc('# 갈래 장부\n\n| 갈래 | 다른 이름 | 폴더 | 종류 | 이름 | 서식 |\n|---|---|---|---|---|---|\n| 회의록 | - | - | 사건 | - | - |\n')
  assert.match(t, /- 새 문서: 닫음\n\n\| 갈래/)
  assert.equal(formsNewdoc(t), t)
  assert.match(formsHead(t), /\| 갈래 \| 별칭 \| 폴더 \| 종류 \| 항목 \| 서식 \|/)
  const r = registryHead('# 등록부\n\n| 좌표 패턴 | 정본 문서 | 섹션 |\n|---|---|---|\n| `a:*` | `docs/a.md` | `## {값}` | 덧칸 |\n\n## 설명\n\n| 이름 | 문서 | 항목 |\n|---|---|---|\n| `b:x` | `docs/b.md` | — |\n')
  assert.equal(r, '# 문서 장부\n\n항목 하나가 어느 문서의 어느 머리(`##`)인지 여기에만 적는다.\n\n| 항목 | 문서 | 머리 |\n|---|---|---|\n| `a:*` | `docs/a.md` | `## {값}` |\n| `b:x` | `docs/b.md` | - |\n')
  assert.equal(registryHead(r), r)
  const m = membersFix('# 사람\n\n- 정리: lee\n- 저장 방식: 승인\n- 모두: 없음\n- 쓰기: kim\n- 관리: park\n')
  assert.equal(m.text, '# 사람\n\n- 모두: 없음\n- 쓰기: kim\n- 지식관리자: park, lee\n')
})

test('팀 지식: 계획 · 대 보기 · 쓰기 · 멱등 · 상태 그대로', async () => {
  const dir = path.join(tmp, 'team')
  build(dir)
  await ensureRepo(dir)
  const s0 = await oldStatesOf(dir)
  const k0 = await loadKnowledge({ id: 'k', name: 'k', dir })
  const voc0 = read(dir, '_vocab.md')
  const p = await plan(dir, { drop: ['2026-0107-바로잡기'] })
  const c = p.counts
  assert.equal(c['forms.newdoc'], 1)
  assert.equal(c['forms.head'], 1)
  assert.equal(c['vocab.head'], 1)
  assert.ok(c['vocab.dash'] >= 3)
  assert.equal(c['registry.head'], 1)
  assert.ok(c.members >= 2)
  assert.equal(c['record.state'], 2, '절차 · 창 기록을 굳힌다')
  assert.equal(c['record.fm'], 1)
  assert.equal(c['record.drop'], 1)
  assert.equal(c['log.old'], 2, '정리 · 문서 꼴 옮김 이력')
  assert.equal(c.seed, 2, '_seed.json · 기록 없는 첨부')
  assert.ok(c['doc.marks'] >= 1)
  const what = p.judge.map((j) => j.what).join('\n')
  assert.match(what, /옛 표지 기록/)
  assert.match(what, /지금 글에 다 들지 않은 것/)
  assert.match(what, /섹션 없는 문서 장부 줄/)
  assert.match(what, /README/)
  assert.ok(p.judge.find((j) => /옛 표지/.test(j.what)).why.includes('2026-0105-넣지-못함'))
  assert.ok(p.judge.find((j) => /다 들지 않은/.test(j.what)).why.includes('2026-0104-늦은-기록'))
  assert.equal((await verifyPlan(dir, p)).ok, true)

  // 계획 뒤에 바뀐 파일이 있으면 쓰지 않는다
  const doc0 = read(dir, 'docs/배포.md')
  fs.writeFileSync(path.join(dir, 'docs', '배포.md'), doc0.replace('주 1회', '주 3회'))
  await assert.rejects(apply(dir, p, { user: 'kim' }), (e) => e.code === 'E_CONFLICT')
  fs.writeFileSync(path.join(dir, 'docs', '배포.md'), doc0)

  const head0 = (await tryGit(dir, ['rev-parse', 'HEAD'])).out.trim()
  const r = await apply(dir, p, { user: 'kim', msg: '시험' })
  assert.ok(r.commit && r.commit !== head0)
  assert.equal((await tryGit(dir, ['status', '--porcelain'])).out.trim(), '', '모두 커밋했다')
  const logRel = `log/${r.log}.md`
  assert.match(read(dir, logRel), /tags:\n\s+- format/)
  assert.match(read(dir, logRel), /\| 정리 시절 이력 \|/)

  // 상태: 앞과 같다(지운 기록이 바로잡았던 기록만 바로잡힘이 풀린다)
  const s1 = await states(dir)
  for (const [id, st] of Object.entries(s0)) {
    if (id === '2026-0107-바로잡기') { assert.equal(s1[id], undefined); continue }
    if (id === '2026-0106-창-넓힘') { assert.equal(st, 'fixed'); assert.equal(s1[id], 'in'); continue }
    assert.equal(s1[id], st, id)
  }
  // 굳힌 기록: put + 넣은 것(닿은 항목) · 머리말 옛 칸 걷음
  const rec = read(dir, 'work/2026-0102-배포-절차.md')
  assert.match(rec, /- put/)
  assert.deepEqual(parsePut(rec).map((x) => `${x.doc} › ${x.heading}`), ['docs/배포.md › 절차'])
  assert.doesNotMatch(rec, /^source:|^attachments:/m)
  // 지운 이력 · 기록 · 세움 메모 · 기록 없는 첨부
  for (const f of ['log/2026-0103-정리.md', 'log/2026-0101-문서-꼴-옮김.md', 'work/2026-0107-바로잡기.md', '_seed.json', 'work/assets/2026-0101-이관/a.txt']) assert.equal(has(dir, f), false, f)
  for (const f of ['log/2026-0108-손-고침.md', 'work/assets/2026-0102-배포-절차/b.txt', 'work/2026-0105-넣지-못함.md', 'work/2026-0104-늦은-기록.md']) assert.equal(has(dir, f), true, f)
  // 문서: 지운 기록의 참고 줄 · 표지(옮기지 않고 걷는다) · 옛 표식 메모
  const d = parseDoc(read(dir, 'docs/배포.md'), '배포')
  const sec = (h) => d.sections.find((x) => x.h === h)
  assert.equal(sec('절차').applied, null)
  assert.equal(sec('창').applied, null)
  // 옮김 뒤 표지는 모두 앞 판에 있던 것이다(새 id 를 표지로 들이지 않는다 · 되돌리기가 지운 id 를 살리지 않는다)
  const before0 = parseDoc(doc0, '배포').sections.map((x) => x.applied).filter(Boolean)
  for (const x of d.sections) if (x.applied) assert.ok(before0.includes(x.applied), x.h)
  assert.ok(!read(dir, 'docs/배포.md').includes('2026-0103-정리') && !read(dir, 'docs/배포.md').includes('2026-0107-바로잡기'))
  // 옮김 커밋을 되돌리면 앞 판 그대로다(지운 기록 · 표지가 함께 돌아오고 다른 id 는 생기지 않는다)
  const GE = { env: { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }
  const lf = (t) => t.replace(/\r\n/g, '\n')
  assert.equal((await tryGit(dir, ['revert', '--no-edit', r.commit], GE)).ok, true)
  assert.equal(lf(read(dir, 'docs/배포.md')), lf(doc0))
  assert.equal((await tryGit(dir, ['revert', '--no-edit', 'HEAD'], GE)).ok, true)
  assert.ok(!sec('창').log.some((l) => l.includes('바로잡기')))
  assert.equal(d.docLog.length, 0)
  assert.equal(sec('절차').body, '주 1회 화요일에 배포한다.')
  // 장부: 지금 꼴 · 읽기는 그대로
  const k1 = await loadKnowledge({ id: 'k', name: 'k', dir })
  assert.match(read(dir, '_vocab.md'), /^# 항목 장부\n/)
  assert.match(read(dir, '_vocab.md'), /- `배포:절차`: 배포 절차\n/)
  assert.match(read(dir, '_managed.md'), /^# 문서 장부\n[\s\S]*\| 항목 \| 문서 \| 머리 \|/)
  assert.doesNotMatch(read(dir, '_managed.md'), /등록부|큐레이터|서버 추가/)
  // 지금 읽기는 옛 줄표 줄을 모른다: 옛 장부의 항목 줄이 모두 지금 꼴로 읽힌다(값 · 라벨 · 별칭 · 폐기의 대 보기는 verifyPlan 이 옛 읽기로 했다)
  const coords0 = [...voc0.matchAll(/^\s*-\s+`([^`]+)`/gm)].map((m) => m[1].trim())
  assert.deepEqual([...k1.vocab.coords.keys()].sort(), coords0.sort())
  assert.ok(k0.vocab.coords.size < coords0.length, '옮기기 전 장부는 지금 읽기로 다 읽히지 않는다')
  assert.match(read(dir, '_vocab.md'), /deprecated: 2026-01-01 → 배포:창: 합침/)
  for (const cd of ['배포:절차', '회의:2026-01-02', '범위:전체']) assert.deepEqual(locate(k1.registry, cd), locate(k0.registry, cd))
  assert.equal(k1.forms.closed, true)
  assert.match(read(dir, '_forms.md'), /- 새 문서: 닫음/)
  assert.doesNotMatch(read(dir, '_members.md'), /정리:|저장 방식/)
  assert.match(read(dir, '_members.md'), /- 지식관리자: lee/)

  // 멱등: 두 번째 계획은 바꿀 것이 없다
  const p2 = await plan(dir)
  assert.deepEqual(p2.changes.map((x) => `${x.rule} ${x.path}`), [])
})

test('지킴: 바로잡힘이 풀린 기록은 in 만 · 계획 뒤 지운 파일 · touches-fix 이력은 판단', async () => {
  const dir = path.join(tmp, 'guard')
  build(dir)
  fs.writeFileSync(path.join(dir, 'log', '2026-0109-건드린-항목-바로잡기.md'), REC('2026-0109-건드린-항목-바로잡기', { date: '2026-01-09 09:00', tags: ['curate-llm', 'touches-fix'], extra: 'supersedes: 2026-0102-배포-창\n' }))
  await ensureRepo(dir)
  const p = await plan(dir, { drop: ['2026-0107-바로잡기'] })
  assert.ok(!p.gone.includes('2026-0109-건드린-항목-바로잡기'), 'touches-fix 이력은 지우지 않는다')
  assert.ok(p.judge.some((j) => /바로잡기를 지닌 정리 시절 이력/.test(j.what) && j.where.includes('2026-0109')))
  // 바로잡힘이 풀린 기록이 in 이 아닌 상태가 되면 대 보기가 막는다
  const rel = 'work/2026-0106-창-넓힘.md'
  const t = read(dir, rel)
  const bad = { ...p, changes: [...p.changes, { path: rel, kind: 'write', before: t, after: t.replace(/tags: \[put\]\n/, '').replace(/\n## 넣은 것[\s\S]*$/, '\n'), why: '시험', rule: 'record.state' }] }
  const v = await verifyPlan(dir, bad)
  assert.equal(v.ok, false)
  assert.ok(v.why.some((x) => x.startsWith('2026-0106-창-넓힘')), v.why.join(' / '))
  // 계획 뒤에 지운 파일은 되살리지 않는다
  fs.rmSync(path.join(dir, 'docs', '배포.md'))
  await assert.rejects(apply(dir, p, { user: 'kim' }), (e) => e.code === 'E_CONFLICT' && /지워졌다/.test(e.message))
  assert.equal(has(dir, 'docs/배포.md'), false)
})

test('개인 지식: 한 번 이행(runOnce) · 옛 표지 기록은 남은 것 글로', async () => {
  const dir = path.join(tmp, 'me')
  build(dir)
  await ensureRepo(dir)
  const r = await runOnce(dir, { personal: true, user: 'kim' })
  assert.equal(r.skipped, false)
  assert.ok(r.commit)
  assert.equal(fs.readFileSync(path.join(dir, '.git', MARK_FILE), 'utf8').trim(), '1')
  const held = read(dir, 'work/2026-0105-넣지-못함.md')
  assert.doesNotMatch(held, /^\s+- held$/m)
  assert.doesNotMatch(held, /## 넣지 못함|```json/)
  assert.match(held, /## 남은 것\n- docs\/배포.md › 절차: 넣지 못했다\(꼴이 틀렸다\)\n {2}- 「주 1회」 을 「주 2회」 로 바꾸려 했다/)
  assert.match(held, /touchesEmpty:/)
  assert.equal((await states(dir))['2026-0105-넣지-못함'], 'old')
  assert.equal((await plan(dir, { personal: true })).changes.length, 0)
  const again = await runOnce(dir, { personal: true, user: 'kim' })
  assert.equal(again.skipped, true)
})

test('kmd-migrate residue · oldform --dry: 쓰지 않는다', async () => {
  const dir = path.join(tmp, 'cli')
  build(dir)
  await ensureRepo(dir)
  const head0 = (await tryGit(dir, ['rev-parse', 'HEAD'])).out.trim()
  const out = []
  const log = console.log
  console.log = (...a) => out.push(a.join(' '))
  try {
    await main(['residue', dir])
    await main(['oldform', dir, '--user', 'kim', '--dry'])
  } finally {
    console.log = log
  }
  const text = out.join('\n')
  assert.match(text, /\| record\.state \| [^|]+ \| 2 \|/)
  assert.match(text, /대 보기[\s\S]*- 같다/)
  assert.equal((await tryGit(dir, ['rev-parse', 'HEAD'])).out.trim(), head0)
  assert.equal((await tryGit(dir, ['status', '--porcelain'])).out.trim(), '')
})

// 팀 사본: 있으면 셈을 찍는다(읽기만 · 쓰지 않는다)
for (const kn of ['dpms', 'gdi']) {
  const dir = path.join(ROOT, '.kmd-data', 'residue', kn)
  test(`팀 사본 셈(읽기만): ${kn}`, { skip: !fs.existsSync(path.join(dir, 'docs')) && '사본이 없다' }, async () => {
    const head0 = (await tryGit(dir, ['rev-parse', 'HEAD'])).out.trim()
    const p = await plan(dir)
    const v = await verifyPlan(dir, p)
    console.log(`# ${kn} 옛 꼴 셈 ${JSON.stringify(p.counts)} · 지울 기록 · 이력 ${p.gone.length} · 볼 것 ${p.judge.length} · 대 보기 ${v.ok ? '같다' : v.why.slice(0, 3).join(' / ')}`)
    assert.equal(v.ok, true)
    assert.equal((await tryGit(dir, ['rev-parse', 'HEAD'])).out.trim(), head0)
  })
}

// 참고 블록의 옛 기록 줄 · work/ 에 쓴 이력(G2 · C-REF-2 · C-STATE-1)
test('ref.line: 링크 뒤 「 · 」 없는 옛 기록 줄을 지금 꼴로 · 같은 기록 줄은 한 줄로 · record.logdir: work/ 의 이력을 log/ 로', async () => {
  const dir = path.join(tmp, 'refline')
  const w = (rel, text) => {
    const full = path.join(dir, ...rel.split('/'))
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, text)
  }
  w('_vocab.md', '# 항목 장부\n\n## 배포\n\n- `배포:절차`: 배포 절차\n')
  w('_managed.md', '# 문서 장부\n\n| 항목 | 문서 | 머리 |\n|---|---|---|\n| `배포:절차` | `docs/배포.md` | `## 절차` |\n')
  w('docs/배포.md', [
    '# 배포', '', '## 절차', '<!-- applied: 2026-0102-절차 -->', '주 1회 배포한다.', '',
    '<!-- kmd:참고 · kmd 가 적고 고친다. 손으로 고치지 않는다 -->', '**참고**', '',
    '- 절차',
    '  - 2026-01-02 [절차](../work/2026-0102-절차.md) PLC · SCADA 조사',
    '  - 2026-01-02 [절차 다시](../work/2026-0102-절차.md) · §1~3',
    '  - 2026-01-03 [손 고침](../work/2026-0103-손-고침.md)',
    '  - 표 출처: 옛 문서',
    '<!-- /kmd:참고 -->', '',
  ].join('\n'))
  w('work/2026-0102-절차.md', REC('2026-0102-절차', { date: '2026-01-02 10:00', touches: ['배포:절차'], tags: ['put'], body: '절차.\n\n## 넣은 것\n- docs/배포.md › 절차 (새 항목)' }))
  w('work/2026-0103-손-고침.md', REC('2026-0103-손-고침', { date: '2026-01-03 10:00', tags: ['edit'] }))
  await ensureRepo(dir)
  // 지금 읽기: 옛 줄은 메모 줄 · work/ 의 이력 태그 기록은 기록으로 보인다(폴더로 가른다)
  const k0 = await loadKnowledge({ id: 'k', name: 'k', dir })
  assert.ok(k0.works.some((x) => x.id === '2026-0103-손-고침'))
  const p = await plan(dir)
  assert.equal(p.counts['ref.line'], 2, '고친 옛 줄 1 · 합친 줄 1')
  assert.equal(p.counts['record.logdir'], 2, '기록 파일 · 참고 줄')
  assert.deepEqual(p.moved, ['2026-0103-손-고침'])
  assert.equal((await verifyPlan(dir, p)).ok, true)
  await apply(dir, p, { user: 'kim' })
  assert.equal(has(dir, 'work/2026-0103-손-고침.md'), false)
  assert.equal(has(dir, 'log/2026-0103-손-고침.md'), true)
  const d = parseDoc(read(dir, 'docs/배포.md'), '배포')
  assert.deepEqual(d.sections[0].log, ['- 2026-01-02 [절차](../work/2026-0102-절차.md) · PLC · SCADA 조사 · §1~3', '- 2026-01-03 [손 고침](../log/2026-0103-손-고침.md)', '- 표 출처: 옛 문서'])
  const k1 = await loadKnowledge({ id: 'k', name: 'k', dir })
  assert.ok(k1.logs.some((x) => x.id === '2026-0103-손-고침'))
  assert.equal(k1.works.find((x) => x.id === '2026-0102-절차').state, 'in')
  // 멱등
  const p2 = await plan(dir)
  assert.equal(p2.counts['ref.line'], 0)
  assert.equal(p2.counts['record.logdir'], 0)
})
