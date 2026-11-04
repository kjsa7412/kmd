// 감시 단계 2 필수 — 문서 폴더 감시 · 원본이 주인 · 내 PC 폴더 → 팀은 걷었다.
//
// 문서 폴더: 파일마다 들이기 일감(S7) — 처음 → 파일마다 일감(정리 일감 0 · 「새 10」 브레이크 없음) → 팀 일꾼이 기록 + 조각 · 사본 문서 없음 / 한 파일 고침 → 그 파일만 새 일감 / 지움 → 지식은 그대로 /
// 한꺼번에 많이 사라지면 멈춤 · 예전 사본 문서(표지 watched)는 원본이 주인으로 남는다 · 내 PC 폴더(파일을 팀으로 나르기)는 없다 — 지식은 「보내기」 로(send.test)

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { copyDir } from './helpers.mjs'
import { workOnce } from '../core/worker.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let tmp, team, pc, docsDir
const ADMIN = { user: 'kim', admin: true }
const W = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }
const R = (f) => fs.readFileSync(f, 'utf8')

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-watch2-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_CLAUDE = path.join(HERE, 'fixture', 'fake-claude.mjs')
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

test('문서 폴더: 바뀐 파일만 들이기 일감으로(정리 일감 0 · 새 10 브레이크 없음) · 사본 문서를 만들지 않는다 · 지움은 지식을 바꾸지 않는다 · 많이 사라지면 멈춤', async () => {
  const kd = path.join(tmp, 'kn', 'dpms')
  const ingested = async () => (await team.hub.get('dpms')).works.filter((w) => w.tags.some((x) => x.startsWith('ingest/운영문서/')))
  const wk = (await team.auth.workerAdd()).key
  const drain = async () => { while (team.hub.intakesOf('dpms').some((j) => j.state === 'queued')) await workOnce({ server: team.url, key: wk }) }
  const r0 = await team.hub.sourceAdd(ADMIN, 'dpms', { name: '운영문서', kind: 'docs', at: docsDir, rules: [{ rule: 'docs', into: { doc: '운영문서' } }] })
  assert.equal(r0.run[0].state, 'changed', JSON.stringify(r0.run[0]).slice(0, 600))
  assert.equal(r0.run[0].queued, 13, 'md 13 → 들이기 일감 13(잠금 파일 ~$ 는 뺀다 · 새 파일 10 을 넘어도 멈추지 않는다)')
  assert.equal(team.hub.intakesOf('dpms').length, 13)
  assert.equal(team.hub.jobsOf('dpms').length, 0, '정리 일감은 세우지 않는다')
  assert.equal((await ingested()).length, 0, '기록은 일꾼이 기록 + 조각을 한 번에 지을 때')
  // 팀 일꾼 — 파일마다 기록(태그 ingest/…) · 원천 글을 기록에 싣는다
  await drain()
  const w0 = (await ingested()).find((w) => w.tags.includes('ingest/운영문서/회의/10월.md'))
  assert.ok(w0 && /화 · 목 배포/.test(w0.body), '기록에 파일 글')
  assert.equal((await ingested()).length, 13)
  assert.ok(!(await ingested()).some((w) => w.tags.some((x) => x.includes('~$'))))
  // 사본 문서(표지 watched)를 만들지 않는다 — 파일 이름을 문서 이름으로 쓰지 않는다
  const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : [])
  assert.deepEqual(walk(path.join(kd, 'docs')).filter((x) => x.endsWith('.md') && /^<!-- watched:/.test(R(x))), [], '사본 문서 없음')

  // 한 파일 고침 → 그 파일만 새 기록
  W(path.join(docsDir, '절차03.md'), '# 절차3\n\n## 순서\n3 번째: 고침.\n')
  const r1 = (await team.hub.sourceRun('dpms', '운영문서'))[0]
  assert.deepEqual([r1.state, r1.files, r1.queued], ['changed', 1, 1])
  await drain()
  assert.ok((await ingested()).some((w) => w.tags.includes('ingest/운영문서/절차03.md') && /3 번째: 고침/.test(w.body)))
  assert.equal((await team.hub.sourceRun('dpms', '운영문서'))[0].state, 'same', '그대로면 기록 없음')

  // 지움 → 지식은 그대로(줄에 「원본에서 지움」)
  const n1 = (await team.hub.get('dpms')).works.length
  fs.rmSync(path.join(docsDir, '절차12.md'))
  const r2 = (await team.hub.sourceRun('dpms', '운영문서'))[0]
  assert.deepEqual([r2.state, r2.removed], ['same', 1])
  assert.equal((await team.hub.get('dpms')).works.length, n1)
  // 한꺼번에 많이 사라지면 멈춤
  for (let i = 1; i <= 3; i++) fs.rmSync(path.join(docsDir, `절차${String(i).padStart(2, '0')}.md`))
  assert.equal((await team.hub.sourceRun('dpms', '운영문서'))[0].state, 'stopped')
})

test('문서 폴더: 예전 사본 문서(표지 watched)는 원본이 주인으로 남는다 · 가져오기가 건드리지 않는다', async () => {
  const kd = path.join(tmp, 'kn', 'dpms')
  const f = path.join(kd, 'docs', '운영문서', '옛사본.md')
  W(f, '<!-- watched: src="운영문서" path="옛사본.md" rec="2026-1001-옛사본" -->\n# 옛사본\n\n## 순서\n그대로.\n')
  await team.hub.collect('dpms')
  await assert.rejects(team.hub.edit(ADMIN, 'dpms', { doc: '운영문서/옛사본', sections: [{ h: '순서', body: '손으로' }] }), { code: 'E_FORBIDDEN' })
  const t0 = R(f)
  await team.hub.sourceRun('dpms', '운영문서', { force: true })
  assert.equal(R(f), t0)
})

let cookie = null
async function cookieOf(s) {
  if (cookie) return cookie
  const { signIn } = await import('./helpers.mjs')
  cookie = (await signIn(s, { id: 'kim2', admin: true })).cookie
  return cookie
}

test('내 PC 폴더 → 팀은 없다. 팀은 더하지 못하고 · PC 에는 팀으로 보내는 길이 없다', async () => {
  await assert.rejects(team.hub.sourceAdd(ADMIN, 'gdi', { name: '김 설계문서', kind: 'pc', mode: 'docs', rules: [{ rule: 'docs', into: { doc: '설계' } }] }), { code: 'E_INPUT' })
  const r = await fetch(`${pc.url}/api/pushes`)
  assert.ok(!r.ok, "길이 없다")
  assert.equal(pc.hub.pushAdd, undefined)
})
