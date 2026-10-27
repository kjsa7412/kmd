// 보내기 운영 — 큰 문서는 나눠 보낸다 · 받는 쪽은 거절된 글만 빼고 받는다 · 같은 묶음이 겹쳐 와도 기록 하나 ·
// 저절로 다시는 겹쳐 돌지 않고 · 그동안 새로 생긴 대기 줄을 덮어쓰지 않는다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { split, ITEM_MAX, readState } from '../core/send.js'
import { copyDir } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KIM = { user: 'kim', admin: true }
let tmp, s, team
// 가짜 팀 서버 — how: 'ok' · 'down'(503) · 'slow'(풀어 줄 때까지) · 'bad'(첫 글만 거절)
const fake = { how: 'ok', hits: 0, slow: 0, release: null }

const sec = (h, n) => `## ${h}\n${'가'.repeat(n)}`
const sentRecs = async (kn) => (s.hub.forget(kn), (await s.hub.get(kn)).works.filter((w) => w.tags.some((t) => t.startsWith('sent/'))))
const until = async (f) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > 10_000) throw new Error('기다림 초과'); await new Promise((r) => setTimeout(r, 20)) } }

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-sendops-'))
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  process.env.KMD_SEND_KEY = 'test-key'
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  const note = path.join(tmp, 'kn', 'note')
  fs.mkdirSync(path.join(note, 'docs'), { recursive: true })
  fs.mkdirSync(path.join(note, 'work'), { recursive: true })
  fs.writeFileSync(path.join(note, '_vocab.md'), '# 이름 장부\n\n')
  fs.writeFileSync(path.join(note, 'docs', '배포메모.md'), '# 배포메모\n\n## 카나리\n첫 30분은 요청의 10%.\n')
  fs.writeFileSync(path.join(note, 'docs', '큰문서.md'), `# 큰문서\n\n${['하나', '둘', '셋', '넷', '다섯'].map((h) => sec(h, 60_000)).join('\n\n')}\n`)
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sendTickMs: 3600000, tidyTickMs: 3600000 }))
  s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
  await s.hub.setOwner(SHELL, 'note', { owner: 'kim', private: true })

  team = http.createServer((req, res) => {
    const parts = []
    req.on('data', (c) => parts.push(c))
    req.on('end', async () => {
      const reply = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)) }
      if (req.method !== 'POST') return reply(200, [{ id: 'dpms', name: 'DPMS 지식' }]) // 보낼 곳을 정할 때 그 팀의 지식 목록
      fake.hits++
      const n = JSON.parse(Buffer.concat(parts).toString('utf8')).items.length
      if (fake.how === 'down') return reply(503, { error: 'E_INTERNAL', message: '쉬는 중' })
      if (fake.how === 'bad') return reply(200, { saved: n - 1, same: 0, bad: [{ i: 0, why: '글이 너무 길다' }] })
      if (fake.how === 'slow') { fake.slow++; await new Promise((ok) => (fake.release = ok)) }
      reply(200, { saved: n, same: 0 })
    })
  })
  await new Promise((ok) => team.listen(0, '127.0.0.1', ok))
})
after(async () => {
  fake.release?.()
  await new Promise((ok) => team?.close(ok))
  await s?.close()
  delete process.env.KMD_SEND_KEY
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('나누기: 한도 안의 글은 그대로 · 넘으면 항목마다 묶어서 · 항목 하나가 넘으면 글자로 · 조각마다 다른 지문', () => {
  const small = { title: 'a', body: 'x', sha: '0123456789abcdef' }
  assert.deepEqual(split(small), [small])
  const body = ['하나', '둘', '셋', '넷', '다섯'].map((h) => sec(h, 60_000)).join('\n\n')
  const parts = split({ title: '큰문서: 문서 전체', body, sha: '0123456789abcdef' })
  assert.equal(parts.length, 2)
  assert.ok(parts.every((p) => p.body.length <= ITEM_MAX))
  assert.deepEqual(parts.map((p) => p.title), ['큰문서: 문서 전체 (1/2)', '큰문서: 문서 전체 (2/2)'])
  assert.equal(parts.map((p) => p.body).join('\n'), body, '이어 붙이면 원래 글')
  assert.ok(parts.every((p) => /^## /.test(p.body)), '조각은 항목 머리에서 시작한다')
  const giant = split({ title: 'x'.repeat(200), body: sec('하나', 500_000), sha: '0123456789abcdef' })
  assert.equal(giant.length, 3)
  assert.ok(giant.every((p) => p.body.length <= ITEM_MAX && p.title.length <= 200))
  assert.equal(new Set(giant.map((p) => p.sha)).size, 3)
})

test('큰 문서 전체 보내기: 기록 한도를 넘지 않게 나눠 모두 받는다 · 다시 보내면 받는 쪽 0', async () => {
  await s.hub.sendDests(KIM, 'note', [{ kn: 'dpms' }])
  const r = await s.hub.send(KIM, 'note', { changes: [], docs: ['docs/큰문서.md'] })
  assert.deepEqual(r, { sent: 2, wait: 0 })
  const got = (await sentRecs('dpms')).filter((w) => w.title.startsWith('큰문서: 문서 전체'))
  assert.deepEqual(got.map((w) => w.title).sort(), ['큰문서: 문서 전체 (1/2)', '큰문서: 문서 전체 (2/2)'])
  await s.hub.send(KIM, 'note', { changes: [], docs: ['docs/큰문서.md'] })
  assert.equal((await sentRecs('dpms')).filter((w) => w.title.startsWith('큰문서: 문서 전체')).length, 2)
})

test('받기: 너무 긴 글 하나는 bad 로 빼고 그 앞뒤는 받는다', async () => {
  const r = await s.hub.receive(KIM, 'dpms', { from: 'note', items: [
    { title: '앞: 받는다', body: '앞 글', sha: 'aaaaaaaaaaaaaa01' },
    { title: '긴 글', body: '가'.repeat(250_000), sha: 'aaaaaaaaaaaaaa02' },
    null,
    { title: '뒤: 받는다', body: '뒤 글', sha: 'aaaaaaaaaaaaaa03' },
  ] })
  assert.equal(r.saved, 2)
  assert.deepEqual(r.bad.map((b) => b.i), [1, 2])
  assert.match(r.bad[0].why, /너무 길다/)
  const titles = (await sentRecs('dpms')).map((w) => w.title)
  assert.ok(titles.includes('앞: 받는다') && titles.includes('뒤: 받는다') && !titles.includes('긴 글'))
})

test('받기: 묶음 하나는 git 커밋 하나 · 거절된 글 · 묶음 안의 같은 지문은 빼고', async () => {
  const dir = path.join(tmp, 'kn', 'dpms')
  const count = () => Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }))
  const n0 = count()
  const items = [1, 2, 3, 4].map((i) => ({ title: `묶음: ${i}`, body: `글 ${i}`, sha: `cccccccccccccc0${i}` }))
  const r = await s.hub.receive(KIM, 'dpms', { from: 'note', items: [...items, { title: '긴 글', body: '가'.repeat(250_000), sha: 'cccccccccccccc05' }, items[0]] })
  assert.equal(r.saved, 4)
  assert.equal(r.same, 1, '묶음 안에서 두 번 온 것')
  assert.deepEqual(r.bad.map((b) => b.i), [4])
  assert.equal(count() - n0, 1, '커밋 하나')
  assert.equal(execFileSync('git', ['status', '--porcelain', 'work'], { cwd: dir, encoding: 'utf8' }).trim(), '', '거절된 글의 파일은 남지 않는다')
  assert.deepEqual((await sentRecs('dpms')).filter((w) => w.title.startsWith('묶음: ')).map((w) => w.title).sort(), ['묶음. 1', '묶음. 2', '묶음. 3', '묶음. 4'])
})

test('받기: 같은 묶음이 동시에 두 번 와도 기록은 하나씩', async () => {
  const items = [1, 2, 3].map((i) => ({ title: `겹침: ${i}`, body: `글 ${i}`, sha: `bbbbbbbbbbbbbb0${i}` }))
  const [a, b] = await Promise.all([s.hub.receive(KIM, 'dpms', { from: 'note', items }), s.hub.receive(KIM, 'dpms', { from: 'note', items })])
  assert.equal(a.saved + b.saved, 3)
  assert.equal(a.same + b.same, 3)
  assert.equal((await sentRecs('dpms')).filter((w) => w.title.startsWith('겹침: ')).length, 3)
})

test('보내기: 받는 쪽이 몇 개만 거절하면 그것만 fail 줄 · 나머지는 보낸 것', async () => {
  const url = `http://127.0.0.1:${team.address().port}`
  await s.hub.sendDests(KIM, 'note', [{ kn: 'dpms', url }])
  fake.how = 'bad'
  const r = await s.hub.send(KIM, 'note', { changes: [], extra: [{ title: '하나', body: '1' }, { title: '둘', body: '2' }] })
  assert.equal(r.sent, 1)
  assert.equal(r.fail, 1)
  const st = await readState(path.join(tmp, 'kn', '.kmd'), 'note')
  const f = st.wait.filter((w) => w.state === 'fail')
  assert.equal(f.length, 1)
  assert.deepEqual(f[0].payload.items.map((x) => x.title), ['하나'])
  await s.hub.sendWaitAct(KIM, 'note', { wid: f[0].id, act: 'drop' })
  fake.how = 'ok'
})

test('저절로 다시: 겹쳐 돌지 않는다 · 보내는 동안 새로 생긴 대기 줄을 덮어쓰지 않는다', async () => {
  const dataDir = path.join(tmp, 'kn', '.kmd')
  // 닿지 않아 대기 1
  fake.how = 'down'
  await s.hub.edit(KIM, 'note', { doc: '배포메모', sections: [{ h: '카나리', body: '첫 30분은 요청의 20%.' }] })
  assert.equal((await s.hub.send(KIM, 'note')).wait, 1)
  const first = (await readState(dataDir, 'note')).wait.map((w) => w.id)
  // 다시 보내기가 팀 서버의 답을 기다리는 동안 — 또 걸어도 같은 일 · 그사이 보낸 것이 또 대기에
  fake.how = 'slow'
  const hits = fake.hits
  const a = s.hub.sendRetry()
  const b = s.hub.sendRetry()
  assert.equal(a, b, '도는 중이면 같은 일을 기다린다')
  await until(() => fake.slow === 1)
  fake.how = 'down'
  await s.hub.edit(KIM, 'note', { doc: '배포메모', sections: [{ h: '카나리', body: '첫 30분은 요청의 30%.' }] })
  assert.equal((await s.hub.send(KIM, 'note')).wait, 1)
  fake.release()
  assert.equal(await a, 1)
  assert.equal(fake.hits - hits, 2, '다시 보내기 1번 + 새로 보내기 1번')
  const wait = (await readState(dataDir, 'note')).wait
  assert.equal(wait.length, 1, '새 대기 줄은 남는다')
  assert.ok(!first.includes(wait[0].id), '보낸 옛 줄은 걷혔다')
  assert.match(wait[0].payload.items[0].body, /30%/)
})
