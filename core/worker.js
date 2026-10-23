// 정리 일꾼 — kmd 서버 밖에서 도는 클라이언트(`kmd worker`). 서버 프로세스는 Claude 를 부르지 않고 그 로그인도 못 읽는다.
//
//   1  일꾼 열쇠(kmdw_)로 다음 일감을 받는다 — 그 일감 · 그 지식에만 쓰는 단기 열쇠(kmdd_)가 같이 온다
//   2  단기 열쇠로 재료를 받는다(「Claude 에 보내지 않음」 지식은 서버가 재료를 내주지 않는다)
//   3  묶음마다 claude -p 한 번(도구 0) → JSON 초안
//   4  초안을 올린다 — 서버가 검사하고 넣는다(일꾼은 쓰지 않는다)
//   로그인이 끝났거나 한도면 다시 시도하지 않고 멈춘 뒤 서버에 알린다(멈춤 한 줄 「자동 정리가 쉬고 있다」)

import { runClaude } from './claude.js'
import { promptOf, DRAFT_SCHEMA, TOUCH_SCHEMA } from './tidy.js'

async function call(server, key, p, body) {
  const r = await fetch(server + p, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.message || `${r.status}`), { code: j.error, status: r.status })
  return j
}

// 일감 하나 — 없으면 null
export async function workOnce({ server, key, log = () => {}, budget = 0.5 }) {
  const n = await call(server, key, '/api/worker/next', {})
  if (!n.job) return null
  const { job, key: dkey } = n
  const kn = encodeURIComponent(job.kn)
  let groups = []
  try {
    groups = (await call(server, dkey, `/api/k/${kn}/worker/material`)).groups
  } catch (e) {
    log(`재료를 받지 못했다 — ${job.kn}: ${e.message}`)
    await call(server, dkey, `/api/k/${kn}/worker/drafts`, { drafts: [] }).catch(() => {})
    return { job, rows: [], skipped: e.message }
  }
  const items = []
  let stop = null
  for (const g of groups) {
    if (stop) {
      items.push({ group: g, error: stop })
      continue
    }
    const r = await runClaude({ prompt: promptOf(g), schema: g.kind === 'touches' ? TOUCH_SCHEMA : DRAFT_SCHEMA, budget })
    if (r.error === 'login' || r.error === 'limit') {
      stop = r.error
      log(`정리 일꾼이 쉰다 — ${r.error === 'login' ? '로그인이 끝났다' : '한도에 닿았다'}`)
    }
    items.push({ group: g, draft: r.value ?? null, model: r.model, error: r.error || null })
  }
  const res = await call(server, dkey, `/api/k/${kn}/worker/drafts`, { drafts: items })
  await call(server, key, '/api/worker/status', stop ? { ok: false, reason: stop } : { ok: true }).catch(() => {})
  return { job, ...res }
}

// 늘 — poll 마다 일감을 본다
export async function runWorker({ server, key, poll = 10_000, log = (...a) => console.log('[kmd worker]', ...a) }) {
  let stopped = false
  const loop = async () => {
    while (!stopped) {
      try {
        const r = await workOnce({ server, key, log })
        if (r) {
          log(`${r.job.kn} — 넣음 ${r.summary?.put ?? 0} · 값 바뀜 ${r.summary?.changed ?? 0} · 그대로 둠 ${r.summary?.left ?? 0}`)
          continue
        }
      } catch (e) {
        log(`서버에 닿지 않는다 — ${e.message}`)
      }
      await new Promise((ok) => setTimeout(ok, poll))
    }
  }
  loop()
  return { stop: () => (stopped = true) }
}
