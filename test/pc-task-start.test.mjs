// Q95 — 늘 켜기 작업으로 다시 켜기: 멈춘 kmd 의 작업 인스턴스가 아직 「실행 중」 이면 /Run 이 버려진다(IgnoreNew · 작업 기록 322).
// 끝나기를 기다리고 · 끝내 실행 중이면 /End · /Run 으로 안 서면 /End 뒤 같은 판을 바로 띄운다. schtasks 없이 가짜로 본다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startViaTask } from '../core/install.js'

// 가짜 작업 — states: state() 가 차례로 돌려줄 값(끝나면 마지막 값) · runUp: /Run 이 새 kmd 를 세우나 · runCode: /Run 의 종료 코드
function fake({ states = ['Ready'], runUp = true, runCode = 0, directUp = true } = {}) {
  const calls = []
  let i = 0
  let up = null
  let clock = 0
  const o = {
    now: () => clock,
    calls,
    state: async () => { calls.push('state'); return states[Math.min(i++, states.length - 1)] },
    end: async () => { calls.push('end'); return 0 },
    run: async () => { calls.push('run'); if (runCode === 0 && runUp) up = { pid: 2, how: 'task' }; return runCode },
    direct: () => { calls.push('direct'); if (directUp) up = { pid: 3, how: 'direct' } },
    waitUp: async (ms) => { calls.push('wait:' + ms); return up },
    // 상태 묻기도 시간이 든다 — 한 번 기다릴 때마다 step 에 묻기 500ms 를 더한다(시계로 재는가)
    sleep: async (ms) => { clock += ms + 500 },
    settleMs: 2000, taskMs: 30, directMs: 60, step: 500
  }
  return o
}

test('작업이 쉬고 있으면 /Run 한 번으로 · 바로 띄우지 않는다', async () => {
  const f = fake()
  const r = await startViaTask(f)
  assert.equal(r.how, 'task')
  assert.deepEqual(r.steps, ['run'])
  assert.ok(!f.calls.includes('direct') && !f.calls.includes('end'))
})

test('앞 인스턴스가 잠깐 실행 중이면 끝나기를 기다린 뒤 /Run(버려지지 않게)', async () => {
  const f = fake({ states: ['Running', 'Running', 'Ready'] })
  const r = await startViaTask(f)
  assert.equal(r.how, 'task')
  assert.deepEqual(r.steps, ['run'])
  assert.ok(f.calls.indexOf('run') > f.calls.lastIndexOf('state'), '/Run 은 실행 중이 끝난 뒤')
})

test('끝내 실행 중이면 /End 뒤 /Run', async () => {
  const f = fake({ states: ['Running'] })
  const r = await startViaTask(f)
  assert.equal(r.how, 'task')
  assert.deepEqual(r.steps, ['end', 'run'])
  // settleMs 2000 · 한 번에 1000ms(기다림 500 + 묻기 500) — 처음 한 번 + 두 번만 묻는다(시계로 잰다)
  assert.equal(f.calls.filter((c) => c === 'state').length, 3, '시계로 settleMs 까지만 묻는다')
})

test('/Run 이 0 인데 새 kmd 가 서지 않으면 /End 뒤 같은 판을 바로 띄운다', async () => {
  const f = fake({ runUp: false })
  const r = await startViaTask(f)
  assert.equal(r.how, 'direct')
  assert.deepEqual(r.steps, ['run', 'end', 'direct'])
  assert.equal(r.up.how, 'direct')
  assert.deepEqual(f.calls.filter((c) => c.startsWith('wait:')), ['wait:30', 'wait:60'])
})

test('/Run 이 실패하면(작업 없음 등) 기다리지 않고 바로 띄운다', async () => {
  const f = fake({ runCode: 1 })
  const r = await startViaTask(f)
  assert.equal(r.how, 'direct')
  assert.deepEqual(r.steps, ['direct'])
  assert.deepEqual(f.calls.filter((c) => c.startsWith('wait:')), ['wait:60'])
})

test('바로 띄워도 서지 않으면 up 은 null(부른 쪽이 앞 판으로 되돌린다)', async () => {
  const f = fake({ runUp: false, directUp: false })
  const r = await startViaTask(f)
  assert.equal(r.how, 'direct')
  assert.equal(r.up, null)
})

test('상태를 묻지 못하면(null) 기다리지 않고 /Run', async () => {
  const f = fake({ states: [null] })
  const r = await startViaTask(f)
  assert.deepEqual(r.steps, ['run'])
  assert.equal(f.calls.filter((c) => c === 'state').length, 1)
})
