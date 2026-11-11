// 보내기 운영 — 큰 문서는 나눠 보낸다 · 받는 쪽은 거절된 글만 빼고 받는다 · 같은 묶음이 겹쳐 와도 기록 하나 ·
// 저절로 다시는 겹쳐 돌지 않고 · 그동안 새로 생긴 대기 줄을 덮어쓰지 않는다.
// 옛 판의 받기(S12 · S-D36)는 같은 팀 서버 안에서만 팀 지식에 넣지 못함(legacy-send)으로 남는다 · HTTP 받기(/receive)는 걷었다(저장 승인 P-D23 · P7).

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
import { split, ITEM_MAX, readState, post } from '../core/send.js'
import { copyDir, signIn } from './helpers.mjs'

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
  fs.writeFileSync(path.join(note, '_vocab.md'), '# 항목 장부\n\n')
  fs.writeFileSync(path.join(note, 'docs', '배포메모.md'), '# 배포메모\n\n## 카나리\n첫 30분은 요청의 10%.\n')
  fs.writeFileSync(path.join(note, 'docs', '큰문서.md'), `# 큰문서\n\n${['하나', '둘', '셋', '넷', '다섯'].map((h) => sec(h, 60_000)).join('\n\n')}\n`)
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sendTickMs: 3600000, inboxTickMs: 3600000 }))
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

test('받기(HTTP · 옛 판)는 걷었다: 받침 없이 E_INPUT 「새 판으로」 · 아무것도 쓰지 않는다 · 옛 판 PC 의 보낼 것은 fail 줄로 남는다', async () => {
  const k = await signIn(s, { id: 'rate1', admin: true })
  const n0 = (await sentRecs('dpms')).length
  const items = [{ title: '옛 판: 하나', body: '글', sha: 'aaaaaaaaaaaaaa01' }]
  await assert.rejects(post(s.url, 'dpms', { from: 'note', items }, k.key, { rateTries: 1 }), (e) => e.status === 400 && e.code === 'E_INPUT' && /새 판/.test(e.message))
  await assert.rejects(post(s.url, 'dpms', { items }, k.key, { path: 'receive/preview', rateTries: 1 }), (e) => e.status === 400 && e.code === 'E_INPUT')
  assert.equal((await sentRecs('dpms')).length, n0, '아무것도 쓰지 않았다')
  assert.equal(typeof s.hub.receive, 'function', '같은 팀 서버 안의 옛 개인 지식 길만 남는다(P11)')
})

