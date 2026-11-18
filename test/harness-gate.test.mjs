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

test('V1: 제안과 저장이 같은 갈래 목록으로 판정한다(formsAfter) · 새로 서는 갈래 장부는 열림이라 갈래 밖 문서도 같이 선다', async () => {
  const dir = emptyKn()
  const k = await load(dir)
  assert.equal(k.forms.own, false)
  assert.equal(k.formsRaw, '')
  assert.deepEqual([k.forms.rows.length, k.forms.closed], [0, false]) // 기본 갈래는 판정에 없다(H-O4)
  // 저장 뒤의 갈래 목록 — 새로 서는 갈래 장부는 열림이다
  const after = formsAfter(k.formsRaw, [{ name: '설계서', kind: '대상' }])
  assert.deepEqual([after.own, after.closed, after.rows.map((f) => f.name)], [true, false, ['설계서']])
  const both = { record: R, sections: [sec('설계서', '수집기'), sec('회의록', '2026-11-10 주간 회의')], forms: [{ name: '설계서', kind: '대상' }] }
  const p = human(k, both)
  assert.deepEqual(p.errors, [], JSON.stringify(p.errors))
  // 갈래가 없는 새 문서(회의록)에 성격 줄이 없으면 경고(R3-4) · 갈래가 있는 설계서는 경고 없음 · natures 를 실으면 경고가 사라진다
  assert.deepEqual(p.warnings.filter((w) => w.code === 'nature').map((w) => w.at), ['docs/회의록.md'])
  const pn = human(k, { ...both, natures: [{ doc: '회의록', nature: '사건', summary: '회의마다 한 항목.' }] })
  assert.deepEqual([pn.errors, pn.warnings.filter((w) => w.code === 'nature')], [[], []])
  assert.ok(pn.fresh.some((x) => x.kind === '성격' && x.name === '회의록: 사건'))
  // 제안이 지나가면 저장도 지나간다
  const r = await coreSave(dir, both, { user: 't', guard: 'strict' })
  assert.ok(r.id)
  const k2 = await load(dir)
  assert.deepEqual([k2.forms.own, k2.forms.closed, k2.forms.rows.map((f) => f.name)], [true, false, ['설계서']])
  assert.ok(k2.formsRaw.includes('- 새 문서: 열림'))
  assert.ok(k2.byDocPath.get('docs/회의록.md'))
  // 닫음으로 바꾼 지식(옛 갈래 장부도 같다)은 제안도 저장도 갈래 밖 새 문서를 거절한다
  fs.writeFileSync(path.join(dir, '_forms.md'), k2.formsRaw.replace('- 새 문서: 열림', '- 새 문서: 닫음'))
  const k3 = await load(dir)
  const out = { record: R, sections: [sec('화면 설계', '로그인')] }
  assert.ok(human(k3, out).errors.some((e) => e.code === 'format' && /갈래 장부에 없는 문서/.test(e.why)))
  await assert.rejects(coreSave(dir, out, { user: 't', guard: 'strict' }), /갈래 장부에 없는 문서/)
  // 있는 갈래와 정규화가 같은 새 갈래는 near 오류다(기본 갈래가 아니라 이 지식의 갈래 줄과 견준다)
  assert.deepEqual(human(k3, { record: R, forms: [{ name: '설계 서' }] }).errors.map((e) => e.code), ['near'])
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
