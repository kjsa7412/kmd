// 감시 단계 2 필수 — 문서 폴더 감시 · 원본이 주인 · 내 PC 폴더 → 팀은 걷었다.
//
// 문서 폴더: 처음 → 문서 · 첨부 · 표지 / 한 파일 고침 → 그 파일만 / 지움 → 「원본에 없다」 / 화면 · 세션 고치기 거절 · 편집기 고침 되돌림 /
// 한꺼번에 많이 사라지면 멈춤 · 내 PC 폴더(파일을 팀으로 나르기)는 없다 — 지식은 「보내기」 로(send.test)

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { stats } from '../core/watch.js'
import { copyDir } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, team, pc, docsDir
const ADMIN = { user: 'kim', admin: true }
const W = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }
const R = (f) => fs.readFileSync(f, 'utf8')

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-watch2-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  docsDir = path.join(tmp, 'src', '운영문서')
  for (let i = 1; i <= 12; i++) W(path.join(docsDir, `절차${String(i).padStart(2, '0')}.md`), `# 절차${i}\n\n## 순서\n${i} 번째.\n`)
  W(path.join(docsDir, '회의', '10월.md'), '# 10월\n\n## 정한 것\n화 · 목 배포.\n')
  W(path.join(docsDir, '구성도.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  W(path.join(docsDir, '~$열린문서.docx'), 'lock')
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ sourceRoots: [path.join(tmp, 'src')], decideMs: 3600000, sourceTickMs: 3600000, watchQuietMs: 600000 }))
  team = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  fs.mkdirSync(path.join(tmp, 'pc', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'pc', '.kmd', 'serve.json'), JSON.stringify({ watchQuietMs: 600000 }))
  pc = await startServer({ root: path.join(tmp, 'pc'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15 })
})
after(async () => {
  await pc?.close()
  await team?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('문서 폴더 — 바뀐 파일만 문서로 · 원본이 주인(고치기 거절 · 편집기 고침 되돌림) · 지움은 「원본에 없다」 · 많이 사라지면 멈춤', async () => {
  const kd = path.join(tmp, 'kn', 'dpms')
  const r0 = await team.hub.sourceAdd(ADMIN, 'dpms', { name: '운영문서', kind: 'docs', at: docsDir, rules: [{ rule: 'docs', into: { doc: '운영문서' } }] })
  assert.equal(r0.run[0].state, 'changed')
  assert.equal(r0.run[0].docs, 13, 'md 13 → 문서 13(잠금 파일 ~$ 는 뺀다)')
  const t = R(path.join(kd, 'docs', '운영문서', '회의', '10월.md'))
  assert.match(t, /^<!-- watched: src="운영문서" path="회의\/10월\.md" -->\n# 10월/)
  assert.ok(fs.existsSync(path.join(kd, 'docs', 'assets', '운영문서', '구성도.png')), '그림은 첨부')
  assert.ok(!fs.existsSync(path.join(kd, 'docs', '운영문서', '~$열린문서.md')))

  // 한 파일 고침 → 그 파일만
  W(path.join(docsDir, '절차03.md'), '# 절차3\n\n## 순서\n3 번째 — 고침.\n')
  const n0 = stats.reads
  const r1 = (await team.hub.sourceRun('dpms', '운영문서'))[0]
  assert.deepEqual([r1.state, r1.files, r1.docs], ['changed', 1, 1])
  assert.equal(stats.reads - n0, 2, '지문 한 번 · 바꾸기 한 번')
  assert.match(R(path.join(kd, 'docs', '운영문서', '절차03.md')), /3 번째 — 고침/)

  // 원본이 주인 — 화면 고치기 · 세션 저장(항목 글) 거절 · 기록만은 된다
  await assert.rejects(team.hub.edit(ADMIN, 'dpms', { doc: '운영문서/절차03', sections: [{ h: '순서', body: '손으로' }] }), { code: 'E_FORBIDDEN' })
  await assert.rejects(team.hub.save(ADMIN, 'dpms', { record: { title: '절차3 — 손으로', body: 'x' }, sections: [{ doc: 'docs/운영문서/절차03.md', heading: '순서', content: '손으로' }] }), { code: 'E_FORBIDDEN' })
  assert.ok((await team.hub.save(ADMIN, 'dpms', { record: { title: '절차3 — 메모', body: '기록으로는 남긴다' } })).id)
  // 편집기 손 고침 → 거두기가 되돌린다
  const f3 = path.join(kd, 'docs', '운영문서', '절차03.md')
  fs.writeFileSync(f3, R(f3).replace('고침', '편집기로'))
  const c = await team.hub.collect('dpms')
  assert.ok(c.reverted.includes('docs/운영문서/절차03.md'))
  assert.match(R(f3), /3 번째 — 고침/)
  // 화면 자료 — 표지 · 고치기 없음
  const v = await fetch(`${team.url}/api/k/dpms/doc?d=${encodeURIComponent('운영문서/절차03')}`, { headers: { cookie: await cookieOf(team) } }).then((x) => x.json())
  assert.equal(v.watched.src, '운영문서')
  assert.equal(v.direct, false)

  // 지움 → 「원본에 없다」(문서는 남는다)
  fs.rmSync(path.join(docsDir, '절차12.md'))
  const r2 = (await team.hub.sourceRun('dpms', '운영문서'))[0]
  assert.equal(r2.missing, 1)
  assert.match(R(path.join(kd, 'docs', '운영문서', '절차12.md')), /^<!-- watched: src="운영문서" path="절차12\.md" missing="\d{4}-\d{2}-\d{2}" -->/)
  // 한꺼번에 많이 사라지면 멈춤
  for (let i = 1; i <= 3; i++) fs.rmSync(path.join(docsDir, `절차${String(i).padStart(2, '0')}.md`))
  assert.equal((await team.hub.sourceRun('dpms', '운영문서'))[0].state, 'stopped')
  assert.match(R(path.join(kd, 'docs', '운영문서', '절차01.md')), /^<!-- watched: src="운영문서" path="절차01\.md" -->/, '멈추면 쓰지 않는다')
})

let cookie = null
async function cookieOf(s) {
  if (cookie) return cookie
  const { signIn } = await import('./helpers.mjs')
  cookie = (await signIn(s, { id: 'kim2', admin: true })).cookie
  return cookie
}

test('내 PC 폴더 → 팀은 없다 — 팀은 더하지 못하고 · PC 에는 팀으로 보내는 길이 없다', async () => {
  await assert.rejects(team.hub.sourceAdd(ADMIN, 'gdi', { name: '김 설계문서', kind: 'pc', mode: 'docs', rules: [{ rule: 'docs', into: { doc: '설계' } }] }), { code: 'E_INPUT' })
  const r = await fetch(`${pc.url}/api/pushes`)
  assert.ok(!r.ok, "길이 없다")
  assert.equal(pc.hub.pushAdd, undefined)
})
