// 감시 단계 2 필수 — 문서 폴더 감시 · 원본이 주인 · 내 PC 폴더 → 팀.
//
// 문서 폴더: 처음 → 문서 · 첨부 · 표지 / 한 파일 고침 → 그 파일만 / 지움 → 「원본에 없다」 / 화면 · 세션 고치기 거절 · 편집기 고침 되돌림 /
// 한꺼번에 많이 사라지면 멈춤 · 내 PC 폴더(관리자만 · 기계 열쇠): 문서 — 바뀐 파일만 보내 팀이 문서로 / 코드 — PC 가 표만 만들어 보냄

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
let tmp, team, pc, docsDir, pcDocs, pcCode
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
  // 내 PC — 팀으로 보낼 폴더 둘
  pcDocs = path.join(tmp, 'pcsrc', '설계문서')
  W(path.join(pcDocs, '배치 설계.md'), '# 배치 설계\n\n## 재시도\n5분 뒤 한 번.\n')
  W(path.join(pcDocs, '화면 설계.md'), '# 화면 설계\n\n## 목록\n열 다섯.\n')
  pcCode = path.join(tmp, 'pcsrc', 'batch')
  W(path.join(pcCode, 'package.json'), JSON.stringify({ dependencies: { quartz: '2.3.2', lombok: '1.18.34' } }))
  W(path.join(pcCode, 'src', 'Main.java'), '// 코드는 팀으로 가지 않는다\nclass Main {}\n')
  fs.mkdirSync(path.join(tmp, 'pc', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'pc', '.kmd', 'serve.json'), JSON.stringify({ watchQuietMs: 600000, pushTickMs: 3600000 }))
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

test('내 PC 폴더 → 팀 — 관리자만 허락 · 문서는 바뀐 파일만 보내 팀이 문서로 · 코드는 PC 가 만든 표만', async () => {
  await assert.rejects(team.hub.sourceAdd({ user: 'lee' }, 'gdi', { name: 'x', kind: 'pc', mode: 'docs', rules: [{ rule: 'docs', into: { doc: 'x' } }] }), { code: 'E_FORBIDDEN' })
  const d = await team.hub.sourceAdd(ADMIN, 'gdi', { name: '김 설계문서', kind: 'pc', mode: 'docs', rules: [{ rule: 'docs', into: { doc: '설계' } }] })
  assert.match(d.key, /^kmdm_/)
  const KIMPC = { user: pc.pcUser, admin: true, pc: true }
  const a = await pc.hub.pushAdd(KIMPC, { team: team.url, key: d.key, folder: pcDocs })
  assert.equal(a.push.mode, 'docs')
  assert.equal(a.run.state, 'changed')
  const gd = path.join(tmp, 'kn', 'gdi', 'docs', '설계')
  assert.match(R(path.join(gd, '배치 설계.md')), /^<!-- watched: src="김 설계문서" path="배치 설계\.md" -->/)
  // PC 에서 한 파일 고침 → 그 파일만 보낸다
  W(path.join(pcDocs, '배치 설계.md'), '# 배치 설계\n\n## 재시도\n10분 뒤 두 번.\n')
  const n0 = stats.reads
  const r = await pc.hub.pushRun(a.push.id)
  assert.deepEqual([r.state, r.files, r.docs], ['changed', 1, 1])
  assert.equal(stats.reads - n0, 2)
  assert.match(R(path.join(gd, '배치 설계.md')), /10분 뒤 두 번/)
  const row = (await team.hub.sources(ADMIN, 'gdi')).find((x) => x.name === '김 설계문서')
  assert.equal(row.watch, 'pc')
  assert.equal(row.state.host, os.hostname())
  // 그대로면 아무것도 안 보낸다
  assert.equal((await pc.hub.pushRun(a.push.id)).state, 'same')

  // 코드 — 표만 간다(코드 파일은 팀에 0)
  const c = await team.hub.sourceAdd(ADMIN, 'gdi', { name: '김 배치 코드', kind: 'pc', mode: 'code', rules: [{ rule: 'deps', into: { doc: '배치 라이브러리' } }] })
  const b = await pc.hub.pushAdd(KIMPC, { team: team.url, key: c.key, folder: pcCode })
  assert.equal(b.run.state, 'changed')
  const lib = R(path.join(tmp, 'kn', 'gdi', 'docs', '배치 라이브러리.md'))
  assert.match(lib, /baseline: src="김 배치 코드"[\s\S]*\| quartz \| 2\.3\.2 \|/)
  assert.ok(!fs.readdirSync(path.join(tmp, 'kn', 'gdi'), { recursive: true }).some((f) => String(f).endsWith('Main.java')), '코드 파일은 팀으로 가지 않는다')
  // 다른 지식에는 그 열쇠가 안 듣는다
  const bad = await fetch(`${team.url}/api/k/dpms/watched`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${d.key}` }, body: JSON.stringify({ files: [] }) })
  assert.equal(bad.status, 403)
})
