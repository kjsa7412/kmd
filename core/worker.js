// 정리 일꾼 — kmd 서버 밖에서 도는 클라이언트(`kmd worker`). 서버 프로세스는 Claude 를 부르지 않고 그 로그인도 못 읽는다.
//
//   1  일꾼 열쇠(kmdw_)로 다음 일감을 받는다 — 그 일감 · 그 지식에만 쓰는 단기 열쇠(kmdd_)가 같이 온다
//   2  단기 열쇠로 재료를 받는다(「Claude 에 보내지 않음」 지식은 서버가 재료를 내주지 않는다)
//   3  묶음마다 claude -p 한 번(도구 0) → JSON 초안 · 넣은 파일은 에이전트(Claude Code + 서버 MCP · 단기 열쇠)가 세션처럼 넣는다
//   4  초안을 올린다 — 서버가 검사하고 넣는다(일꾼은 쓰지 않는다)
//   로그인이 끝났거나 한도면 다시 시도하지 않고 멈춘 뒤 서버에 알린다(멈춤 한 줄 「자동 정리가 쉬고 있다」)

import { runClaude } from './claude.js'
import { promptOf, DRAFT_SCHEMA, TOUCH_SCHEMA, INGEST_SCHEMA } from './tidy.js'
import { runAgent, agentAvailable } from './agent.js'
import { modelOf } from './models.js'

async function call(server, key, p, body) {
  const r = await fetch(server + p, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.message || `${r.status}`), { code: j.error, status: r.status })
  return j
}

// 넣은 파일 하나 — 서버에서 일(일 설명 · 스킬 · 파일 · 단기 열쇠)을 받아 에이전트를 띄우고, 줄은 1초마다 올리고, 끝을 알린다
async function agentIngest({ server, dkey, kn, g, log, models }) {
  const t = await call(server, dkey, `/api/k/${kn}/worker/agent`, { rec: g.record.id })
  let buf = []
  const flush = async () => {
    if (!buf.length) return
    const lines = buf
    buf = []
    await call(server, dkey, `/api/k/${kn}/worker/agent/log`, { run: t.run, lines }).catch(() => {})
  }
  const timer = setInterval(flush, 1000)
  let r
  try {
    r = await runAgent({ prompt: t.prompt, system: t.system, files: t.files.map((f) => ({ name: f.name, data: Buffer.from(f.b64, 'base64') })), mcp: { url: `${server}/mcp`, token: t.token }, budget: 3, model: modelOf('agent', models), onLine: (l) => buf.push(l) })
  } finally {
    clearInterval(timer)
    await flush()
  }
  const d = await call(server, dkey, `/api/k/${kn}/worker/agent/done`, { run: t.run, ok: r.ok, why: r.ok ? null : r.message })
  log(`${decodeURIComponent(kn)}: 넣은 파일 ${g.record.file} ${d.placed ? '에이전트로 넣음' : '에이전트가 넣지 못함'}`)
  return { placed: !!d.placed, error: r.ok ? null : r.error }
}

// 일감 하나 — 없으면 null · models — 일마다 모델(core/models.js · 없으면 기본 배분)
export async function workOnce({ server, key, log = () => {}, budget = 0.5, models = null }) {
  const n = await call(server, key, '/api/worker/next', {})
  if (!n.job) return null
  const { job, key: dkey } = n
  const kn = encodeURIComponent(job.kn)
  let groups = []
  try {
    groups = (await call(server, dkey, `/api/k/${kn}/worker/material`)).groups
  } catch (e) {
    log(`재료를 받지 못했다: ${job.kn}: ${e.message}`)
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
    // 넣은 파일 — 세션처럼 일하는 에이전트로(이 PC 의 Claude Code · MCP 는 서버 · 단기 열쇠). 넣었으면 초안은 없다 · 못 넣으면 아래 초안 길로
    if (g.kind === 'ingest' && agentAvailable()) {
      const a = await agentIngest({ server, dkey, kn, g, log, models }).catch((e) => ({ placed: false, error: null, why: e.message }))
      if (a.error === 'login' || a.error === 'limit') {
        stop = a.error
        log(`정리 일꾼이 쉰다: ${a.error === 'login' ? '로그인이 끝났다' : '한도에 닿았다'}`)
        items.push({ group: g, error: stop })
        continue
      }
      if (a.placed) continue
    }
    const r = await runClaude({ prompt: promptOf(g), schema: g.kind === 'touches' ? TOUCH_SCHEMA : g.kind === 'ingest' ? INGEST_SCHEMA : DRAFT_SCHEMA, budget, model: modelOf(g.kind === 'touches' ? 'touch' : 'tidy', models) })
    if (r.error === 'login' || r.error === 'limit') {
      stop = r.error
      log(`정리 일꾼이 쉰다: ${r.error === 'login' ? '로그인이 끝났다' : '한도에 닿았다'}`)
    }
    items.push({ group: g, draft: r.value ?? null, model: r.model, error: r.error || null })
  }
  const res = await call(server, dkey, `/api/k/${kn}/worker/drafts`, { drafts: items })
  await call(server, key, '/api/worker/status', stop ? { ok: false, reason: stop } : { ok: true }).catch(() => {})
  return { job, ...res }
}

// 늘 — poll 마다 일감을 본다
// onLost — 서버가 열쇠를 끊었다(401 · 기기 끊기 · 다시 정하기 · 떠남) · 멈추고 알린다(PC 일꾼은 기기 열쇠로 다시 받는다)
export function runWorker({ server, key, poll = 10_000, log = (...a) => console.log('[kmd worker]', ...a), onLost = null, models = null }) {
  let stopped = false
  const loop = async () => {
    while (!stopped) {
      try {
        const r = await workOnce({ server, key, log, models })
        if (r) {
          log(`${r.job.kn}: 넣음 ${r.summary?.put ?? 0} · 값 바뀜 ${r.summary?.changed ?? 0} · 그대로 둠 ${r.summary?.left ?? 0}`)
          continue
        }
      } catch (e) {
        if (e.status === 401 && onLost) { stopped = true; log('일꾼 열쇠가 끊겼다. 다시 받는다'); onLost(); return }
        log(`서버에 닿지 않는다: ${e.message}`)
      }
      await new Promise((ok) => setTimeout(ok, poll))
    }
  }
  loop()
  return { stop: () => (stopped = true) }
}

// 내 PC 의 개인 일꾼 — 이은 팀 서버마다 「내 개인 지식」 의 일감을 이 PC 의 Claude 로(팀의 정리 전용 로그인으로는 나가지 않는다).
//   일꾼 열쇠는 설치 한 줄이 넣은 기기 열쇠로 받는다(그 사람 · 그 기기에만 · 켤 때마다 갈아 끼운다) · 못 닿으면 retryMs 뒤 다시
export function runPersonalWorkers({ teams, deviceKey, poll = 10_000, retryMs = 10 * 60_000, log = (...a) => console.log('[kmd worker]', ...a), models = null }) {
  const stops = []
  for (const server of teams) {
    const start = async () => {
      try {
        const dk = await deviceKey(server)
        if (!dk) return log(`${server}: 이은 기기 열쇠가 없다 · 개인 지식은 팀 서버가 규칙으로 넣는다`)
        const r = await fetch(server + '/api/me/worker', { method: 'POST', headers: { authorization: `Bearer ${dk}`, 'content-type': 'application/json' }, body: '{}' })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.message || `${r.status}`)
        stops.push(runWorker({ server, key: j.key, poll, log, models, onLost: () => { const t = setTimeout(start, 5000); t.unref?.(); stops.push({ stop: () => clearTimeout(t) }) } }))
        log(`${server}: 내 개인 지식의 정리 일감을 이 PC 의 Claude 로 받는다`)
      } catch (e) {
        log(`${server}: 내 개인 지식 일꾼을 띄우지 못했다(${e.message}) · 다시 한다`)
        const t = setTimeout(start, retryMs)
        t.unref?.()
        stops.push({ stop: () => clearTimeout(t) })
      }
    }
    start()
  }
  return { stop: () => stops.forEach((x) => x.stop()) }
}
