// 팀 일꾼(core/worker.js) — claude 동시 호출 상한 · 지난 일꾼 폴더 걷기 · 서버는 들이기 일감만 낸다(개편 S13 · 옛 tidy-plan.test 에서 옮김)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { slots, sweepProjects } from '../core/worker.js'
import { makeHub } from '../server/hub.js'
import { copyDir } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

test('claude 동시 호출 상한: 셋이 받으면 넷째는 하나가 돌려줄 때까지 기다린다', async () => {
  const g = slots(3)
  await g.take(); await g.take(); await g.take()
  let fourth = false
  const p = g.take().then(() => (fourth = true))
  await new Promise((ok) => setTimeout(ok, 20))
  assert.equal(fourth, false)
  g.give()
  await p
  assert.equal(fourth, true)
})

test('지난 일꾼 폴더: 하루 지난 「kmd-worker-」 · 「kmd-agent-」 만 걷는다', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-home-'))
  const pj = path.join(home, '.claude', 'projects')
  for (const x of ['C--tmp-kmd-worker-old', 'C--tmp-kmd-agent-old', 'C--tmp-kmd-worker-new', 'C--project-kmd']) fs.mkdirSync(path.join(pj, x), { recursive: true })
  const old = (Date.now() - 2 * 864e5) / 1000
  fs.utimesSync(path.join(pj, 'C--tmp-kmd-worker-old'), old, old)
  fs.utimesSync(path.join(pj, 'C--tmp-kmd-agent-old'), old, old)
  fs.utimesSync(path.join(pj, 'C--project-kmd'), old, old)
  const cfg = process.env.CLAUDE_CONFIG_DIR
  delete process.env.CLAUDE_CONFIG_DIR
  try { assert.equal(sweepProjects({ home }), 2) } finally { if (cfg) process.env.CLAUDE_CONFIG_DIR = cfg }
  assert.deepEqual(fs.readdirSync(pj).sort(), ['C--project-kmd', 'C--tmp-kmd-worker-new'])
  fs.rmSync(home, { recursive: true, force: true })
})

test('켤 때: 옛 정리 일감 줄은 그만둠(「개편으로 걷은 정리 일감」) · 일꾼에게는 들이기 일감만 · 개편 때(cutover.json)를 한 번 적는다', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-wk-'))
  try {
    copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
    const data = path.join(tmp, 'kn', '.kmd')
    fs.mkdirSync(data, { recursive: true })
    fs.writeFileSync(path.join(data, 'serve.json'), JSON.stringify({ decideMs: 3600000, sourceTickMs: 3600000, sendTickMs: 3600000, jobTickMs: 3600000, queueResumeMs: 3600000 }))
    const at = new Date(Date.now() - 3600_000).toISOString()
    fs.writeFileSync(path.join(data, 'jobs.json'), JSON.stringify([{ id: 'aaaaaaaaaaaa', kn: 'dpms', by: 'kim', auto: false, at, state: 'queued' }, { id: 'bbbbbbbbbbbb', kn: 'dpms', by: 'kmd', auto: true, at, state: 'running', worker: 'w1' }]))
    const hub = await makeHub({ root: path.join(tmp, 'kn'), dataDir: data, mode: 'team', log: () => {} })
    await hub.start()
    try {
      for (const id of ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']) {
        const j = hub.job(id)
        assert.equal(j.state, 'cancelled', id)
        assert.equal(j.why, '개편으로 걷은 정리 일감')
      }
      assert.equal(hub.workerNext({ worker: { id: 'w-test' } }), null, '들이기 일감이 없으면 일감이 없다')
      const cut = JSON.parse(fs.readFileSync(path.join(data, 'cutover.json'), 'utf8'))
      assert.match(cut.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
      assert.equal(hub.config.cutoverAt, cut.at)
      // 장부의 옛 pend 사람 기록은 개편 때보다 앞서 들어왔다 — 개편 전 기록(넣지 못함 화면)
      const k = await hub.get('dpms')
      assert.equal(k.cutoverAt, cut.at)
    } finally { hub.stop() }
    // 다시 켜도 같은 때(덮지 않는다)
    const before = fs.readFileSync(path.join(data, 'cutover.json'), 'utf8')
    const hub2 = await makeHub({ root: path.join(tmp, 'kn'), dataDir: data, mode: 'team', log: () => {} })
    await hub2.start()
    hub2.stop()
    assert.equal(fs.readFileSync(path.join(data, 'cutover.json'), 'utf8'), before)
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
  }
})
