// WP8 필수 — 같은 화면 · 같은 지식 · 넣기 결과(제품화 검토 v0.1 F-030 · F-031 · F-028 · F-029 · G1-7 · F-026 · F-027 · F-039 · F-086 · F-087 · F-091 · F-095 · F-075 · F-077 · F-073).
//
// 보통 글 파일(txt · csv · html · json)을 받는다 · 큰 파일 하나가 넣기 전체를 끊지 않는다(파일마다 결과 · 까닭) · 넣기 한 번이 이력 한 줄 ·
// 드라이브 통째 · 집 폴더 통째는 가져오지 않는다(path.relative 로 「품은 폴더」 막기) · 가져오는 곳을 지우면 사본을 내 문서로 남기거나 지운다 ·
// 원본이 없어진 사본은 내 문서로 풀 수 있다 · 코드 바뀜 기록은 문서로 세우지 않는다 · 화면 — 넣을 곳은 고른 지식 · 찾기에 이름이 맞는 문서가 먼저.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { textToMd } from '../core/importer.js'
import { checkTarget } from '../core/sources.js'
import * as feed from '../core/feed.js'
import { copyDir } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KIM = { user: 'kim', admin: true }
let tmp, root, data, src, s
const code = (p) => p.then(() => 'ok', (e) => e.code)

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-wp8-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  root = path.join(tmp, 'kn')
  data = path.join(root, '.kmd')
  src = path.join(tmp, 'src', '운영')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  fs.mkdirSync(data, { recursive: true })
  fs.mkdirSync(src, { recursive: true })
  fs.writeFileSync(path.join(src, '절차.md'), '# 절차\n\n## 순서\n첫째.\n')
  fs.writeFileSync(path.join(data, 'serve.json'), JSON.stringify({ sourceRoots: [path.join(tmp, 'src')], decideMs: 3600000, sourceTickMs: 3600000, tidyTickMs: 3600000, watchQuietMs: 600000 }))
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  await s.hub.setOwner(SHELL, 'dpms', { owner: 'kim' })
})
after(async () => {
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('보통 글 파일: txt · log 그대로 · csv 는 md 표(따옴표 칸) · html 은 짜임을 살린 md(문단마다 빈 줄) · json 은 코드 덩이', () => {
  assert.equal(textToMd('txt', Buffer.from('한 줄\n두 줄')), '한 줄\n두 줄')
  assert.equal(textToMd('csv', Buffer.from('이름,값\n"가, 나",1\n"따옴""표",2\n')), '| 이름 | 값 |\n| --- | --- |\n| 가, 나 | 1 |\n| 따옴"표 | 2 |')
  assert.equal(textToMd('tsv', Buffer.from('a\tb|c\n1\t2')), '| a | b\\|c |\n| --- | --- |\n| 1 | 2 |')
  assert.equal(textToMd('html', Buffer.from('<p>첫 &amp; 둘</p><script>x()</script><div>셋</div>')), '첫 & 둘\n\n셋')
  assert.match(textToMd('json', Buffer.from('{"a":1}')), /^```json\n\{"a":1\}\n```$/)
})

test('넣기: 큰 파일 하나가 전체를 끊지 않는다 · 파일마다 결과 · 까닭 · 넣기 한 번이 이력 한 줄', async () => {
  const big = Buffer.from('가'.repeat(210_000))
  const r = await s.hub.importFiles(KIM, 'dpms', [
    { path: '메모.txt', data: Buffer.from('회의 메모 — 다음 점검은 11월') },
    { path: '큰글.txt', data: big },
    { path: '표.csv', data: Buffer.from('코드,뜻\nA,활성\n') },
    { path: '모름.xyz', data: Buffer.from('?') },
  ])
  const by = Object.fromEntries(r.rows.map((x) => [x.name, x]))
  assert.equal(by['메모.txt'].kind, 'record')
  assert.equal(by['표.csv'].kind, 'record')
  assert.equal(by['큰글.txt'].kind, 'fail')
  assert.match(by['큰글.txt'].msg, /넣지 못했다: /)
  assert.equal(by['모름.xyz'].kind, 'skip')
  const k = await s.hub.get('dpms')
  assert.ok(k.works.some((w) => w.tags.includes('ingest/표.csv') && /\| A \| 활성 \|/.test(w.body)))
  const lines = (await feed.list(data, 'kim')).filter((x) => x.kind === 'import')
  assert.equal(lines.length, 1, '넣기 한 번: 이력 한 줄')
  assert.match(lines[0].small, /못 넣음 1: 큰글\.txt: /)
})

test('가져오는 곳: 드라이브 통째 · 집 폴더 통째는 받지 않는다(품은 폴더 막기는 path.relative 로)', () => {
  const ctx = { kind: 'folder', pc: true, dataDir: data, knowledgeDirs: [path.join(root, 'dpms')] }
  assert.throws(() => checkTarget(path.parse(tmp).root, ctx), /드라이브 통째/)
  assert.throws(() => checkTarget(os.homedir(), ctx), /집 폴더 통째|살림 자리/)
  assert.throws(() => checkTarget(root, ctx), /지식 폴더는 가져오는 곳이 될 수 없다/)
})

test('가져오는 곳을 지우면: 사본은 내 문서로(기본) 또는 함께 지움 · 원본이 없어진 사본은 내 문서로 풀린다', async () => {
  await s.hub.sourceAdd(KIM, 'dpms', { name: '운영', kind: 'docs', at: src, rules: [{ rule: 'docs', into: { doc: '운영' } }] })
  const f = path.join(root, 'dpms', 'docs', '운영', '절차.md')
  assert.match(fs.readFileSync(f, 'utf8'), /^<!-- watched: src="운영"/)
  const r = await s.hub.sourceRemove(KIM, 'dpms', { name: '운영' })
  assert.deepEqual([r.copies, r.kept], [1, true])
  assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /watched/)
  assert.equal((await s.hub.edit(KIM, 'dpms', { doc: '운영/절차', sections: [{ h: '순서', body: '이제 고칠 수 있다.' }] })).direct, true)
  // 다시 붙이고 함께 지움
  fs.writeFileSync(path.join(src, '둘.md'), '# 둘\n\n## 하나\n둘.\n')
  await s.hub.sourceAdd(KIM, 'dpms', { name: '운영2', kind: 'docs', at: src, rules: [{ rule: 'docs', into: { doc: '운영2' } }] })
  assert.ok(fs.existsSync(path.join(root, 'dpms', 'docs', '운영2', '둘.md')))
  await s.hub.sourceRemove(KIM, 'dpms', { name: '운영2', copies: 'drop' })
  assert.ok(!fs.existsSync(path.join(root, 'dpms', 'docs', '운영2', '둘.md')))
  // 원본이 없어진 사본(표지만 남음) — 문서 화면이 「없어졌다」 · 내 문서로
  const orphan = path.join(root, 'dpms', 'docs', '남은사본.md')
  fs.writeFileSync(orphan, '<!-- watched: src="옛곳" path="x.md" -->\n# 남은사본\n\n## 글\n옛 글.\n')
  s.hub.forget()
  assert.equal(await code(s.hub.edit(KIM, 'dpms', { doc: '남은사본', sections: [{ h: '글', body: '새 글' }] })), 'E_FORBIDDEN')
  await s.hub.unwatch(KIM, 'dpms', { doc: '남은사본' })
  assert.doesNotMatch(fs.readFileSync(orphan, 'utf8'), /watched/)
})

test('코드 바뀜 기록은 규칙으로 넣을 때 문서로 세우지 않는다(묶음마다 새 문서가 나무를 덮지 않게)', async () => {
  const r = await s.hub.save({ user: 'kmd-auto' }, 'gdi', { record: { title: '세션 만료 30분 → 60분', body: 'diff', tags: ['code-change'] } }, { system: true })
  const got = await s.hub.ingestNow('gdi', r.id)
  assert.match(got.why, /코드 바뀜은 기록으로 둔다/)
  assert.ok(!fs.existsSync(path.join(root, 'gdi', 'docs', '세션 만료 30분 → 60분.md')))
})
