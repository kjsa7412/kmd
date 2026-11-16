// 지식 생성 하네스의 결정적 시험(설계 9-3) — 제안이 지나가면 저장도 지나간다(조사 Z V1 · V2 회귀 · H-D14).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadKnowledge } from '../core/knowledge.js'
import { buildProposal } from '../core/propose.js'
import { formsAfter } from '../core/namebook.js'
import { save as coreSave } from '../core/save.js'

function emptyKn() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-hgate-'))
  fs.mkdirSync(path.join(dir, 'docs'))
  fs.mkdirSync(path.join(dir, 'work'))
  fs.writeFileSync(path.join(dir, 'README.md'), '# 빈지식(테스트)\n')
  fs.writeFileSync(path.join(dir, '_members.md'), '# 사람\n\n- 저장 방식: 승인\n')
  fs.writeFileSync(path.join(dir, 'docs', '기록 모음.md'), '# 기록 모음\n\n이을 항목이 없던 기록을 달마다 잇는다. 기록은 각 달 항목의 이력으로 붙는다.\n')
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' })
  git('init', '-q'); git('config', 'user.name', 't'); git('config', 'user.email', 't@example.invalid'); git('add', '-A'); git('commit', '-q', '-m', '처음')
  return dir
}
const load = (dir) => loadKnowledge({ id: 't', name: 't', dir })
const human = (k, input) => buildProposal(k, input, { newDoc: true, approve: true, curator: false, reverts: () => 0, month: '2026-11', head: { name: 't', viewers: 1, path: '시험' } })
const R = { title: '게이트웨이 설계: 수집기 주기', body: '수집기 주기를 정했다.\n\n## 바뀐 것\n- 수집 주기: 5초', touchesEmpty: '첫 문서라 장부 항목이 아직 없다' }
const sec = (doc, heading) => ({ doc, heading, content: '수집기는 PLC 에서 5초마다 값을 읽는다. 수집 주기: 5초' })

test('V1: 새 갈래와 기본 갈래 문서를 한 제안에 실으면 제안에서 걸린다(저장과 같은 갈래 목록 · formsAfter)', async () => {
  const dir = emptyKn()
  const k = await load(dir)
  assert.equal(k.forms.own, false)
  assert.equal(k.formsRaw, '')
  // 저장 뒤의 갈래 목록에는 기본 갈래가 없다
  const after = formsAfter(k.formsRaw, [{ name: '설계서', kind: '대상' }])
  assert.deepEqual([after.own, after.rows.map((f) => f.name)], [true, ['설계서']])
  const both = { record: R, sections: [sec('설계서', '수집기'), sec('회의록', '2026-11-10 주간 회의')], forms: [{ name: '설계서', kind: '대상' }] }
  const p = human(k, both)
  assert.ok(p.errors.some((e) => e.code === 'format' && /갈래 장부에 없는 문서/.test(e.why)), JSON.stringify(p.errors))
  // 새 갈래 문서만 실으면 제안도 저장도 지나간다
  const one = { record: R, sections: [sec('설계서', '수집기')], forms: [{ name: '설계서', kind: '대상' }] }
  const p1 = human(k, one)
  assert.deepEqual(p1.errors, [])
  const r = await coreSave(dir, one, { user: 't', guard: 'strict' })
  assert.ok(r.id)
  const k2 = await load(dir)
  assert.deepEqual([k2.forms.own, k2.forms.rows.map((f) => f.name)], [true, ['설계서']])
  assert.ok(k2.formsRaw.includes('설계서'))
})

test('V2: 같은 제안의 names(doc · heading)로 세우는 항목을 sections[].coord 로 가리킨다', async () => {
  const dir = emptyKn()
  const k = await load(dir)
  const input = {
    record: { title: R.title, body: R.body, touches: ['module:수집기'] },
    sections: [{ coord: 'module:수집기', content: '수집기는 PLC 에서 5초마다 값을 읽는다. 수집 주기: 5초' }],
    names: [{ coord: 'module:수집기', label: '수집기', doc: '게이트웨이 설계', heading: '수집기' }],
  }
  const p = human(k, input)
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  const it = p.items.find((x) => x.kind === '신설')
  assert.deepEqual([it.doc, it.heading, it.coord], ['docs/게이트웨이 설계.md', '수집기', 'module:수집기'])
  // names 에 자리가 없으면 여전히 notfound
  const bad = human(k, { ...input, names: [{ coord: 'module:수집기', label: '수집기' }] })
  assert.ok(bad.errors.some((e) => e.code === 'notfound'))
  // 저장도 지나간다(저장 문은 이번에 세우는 항목을 자리로 쓴다)
  const r = await coreSave(dir, input, { user: 't', guard: 'strict' })
  assert.ok(r.id)
  const k2 = await load(dir)
  assert.ok(k2.byDocPath.get('docs/게이트웨이 설계.md').sections.some((s) => s.h === '수집기'))
  assert.ok(k2.vocab.coords.has('module:수집기'))
})
