// 저장 저널 — 저장 중에 프로세스가 죽거나 정전이면 반쯤 쓴 저장을 다음에 되돌린다(core/journal.js)
//   꺼짐은 begin 뒤 done 을 부르지 않는 것으로 흉내 낸다 — 같은 pid 의 남은 저널은 꺼진 것으로 본다

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { save } from '../core/save.js'
import { begin, recover } from '../core/journal.js'
import { ensureRepo, commitPaths, tryGit } from '../core/git.js'
import { collectNow } from '../core/collect.js'
import { copyDir } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOC = 'docs/배포절차.md'
let tmp, dir
const read = (rel) => fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf8')
const write = (rel, t) => fs.writeFileSync(path.join(dir, ...rel.split('/')), t)
const status = async () => (await tryGit(dir, ['status', '--porcelain', '-uall'])).out.trim()
const journals = () => fs.readdirSync(path.join(dir, '.git')).filter((n) => n.startsWith('kmd-saving-'))

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-journal-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  dir = path.join(tmp, 'dpms')
  copyDir(path.join(HERE, 'fixture', 'kmd', 'dpms'), dir)
  await ensureRepo(dir)
})
after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('저장이 끝나면 저널도 임시 파일도 남지 않는다', async () => {
  await save(dir, { record: { title: '카나리: 첫 30분', body: '첫 30분 요청 20%', touches: ['proc:카나리'] }, sections: [{ coord: 'proc:카나리', content: '첫 30분 요청 20% 로 보낸다.' }] }, { user: 'lee' })
  assert.deepEqual(journals(), [])
  assert.equal(await status(), '')
})

test('커밋 전에 꺼진 저장: 새 기록은 지우고 문서는 원래 글로 · 스테이징도 풀고 · 지금 글은 사본으로', async () => {
  const was = read(DOC)
  const j = await begin(dir)
  await j.add('work/2026-1028-꺼짐.md')
  write('work/2026-1028-꺼짐.md', '---\nid: 2026-1028-꺼짐\n---\n')
  await j.add(DOC)
  write(DOC, was.slice(0, 20)) // 잘린 글
  await tryGit(dir, ['add', '--', 'work/2026-1028-꺼짐.md', DOC])
  // 여기서 꺼졌다
  assert.deepEqual(await recover(dir), ['work/2026-1028-꺼짐.md', DOC])
  assert.equal(fs.existsSync(path.join(dir, 'work', '2026-1028-꺼짐.md')), false)
  assert.equal(read(DOC), was)
  assert.equal(await status(), '')
  assert.deepEqual(journals(), [])
  const kept = fs.readdirSync(path.join(dir, '.git', 'kmd-rescued'))
  assert.ok(kept.some((n) => n.endsWith('docs_배포절차.md')))
})

test('커밋까지 가고 저널을 지우기 전에 꺼진 저장: 그대로 둔다', async () => {
  const j = await begin(dir)
  await j.add('work/2026-1028-커밋됨.md')
  write('work/2026-1028-커밋됨.md', '---\nid: 2026-1028-커밋됨\n---\n')
  await commitPaths(dir, ['work/2026-1028-커밋됨.md'], '커밋됨', 'lee')
  assert.deepEqual(await recover(dir), [])
  assert.ok(fs.existsSync(path.join(dir, 'work', '2026-1028-커밋됨.md')))
  assert.deepEqual(journals(), [])
})

test('다음 저장이 남은 저널부터 되돌린다', async () => {
  const was = read(DOC)
  const j = await begin(dir)
  await j.add(DOC)
  write(DOC, '반쯤')
  await save(dir, { record: { title: '기록만', body: '기록만 남긴다' } }, { user: 'lee' })
  assert.equal(read(DOC), was)
  assert.equal(await status(), '')
})

test('거두기는 반쯤 쓴 저장을 사람의 고침으로 들이지 않는다', async () => {
  const was = read(DOC)
  const j = await begin(dir)
  await j.add(DOC)
  write(DOC, was + '\nkmd 가 쓰다 만 글\n')
  const r = await collectNow(dir, { user: 'lee', save: () => assert.fail('고침으로 들였다') })
  assert.equal(r, null)
  assert.equal(read(DOC), was)
})

test('살아 있는 다른 kmd 의 저널은 건드리지 않는다', async () => {
  const at = path.join(dir, '.git', 'kmd-saving-other')
  fs.mkdirSync(at)
  fs.writeFileSync(path.join(at, 'journal.json'), JSON.stringify({ pid: process.ppid, at: Date.now(), head: null, files: [{ rel: 'work/남의것.md', had: false }] }))
  write('work/남의것.md', '쓰는 중')
  assert.deepEqual(await recover(dir), [])
  assert.ok(fs.existsSync(path.join(dir, 'work', '남의것.md')))
  // 10분이 지났으면 꺼진 것으로 본다
  fs.writeFileSync(path.join(at, 'journal.json'), JSON.stringify({ pid: process.ppid, at: Date.now() - 11 * 60_000, head: null, files: [{ rel: 'work/남의것.md', had: false }] }))
  assert.deepEqual(await recover(dir), ['work/남의것.md'])
  assert.equal(fs.existsSync(path.join(dir, 'work', '남의것.md')), false)
})
