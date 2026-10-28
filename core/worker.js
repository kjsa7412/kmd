// 정리 일꾼 — kmd 서버 밖에서 도는 클라이언트(`kmd worker`). 서버 프로세스는 Claude 를 부르지 않고 그 로그인도 못 읽는다.
//
//   1  일꾼 열쇠(kmdw_)로 다음 일감을 받는다 — 그 일감 · 그 지식에만 쓰는 단기 열쇠(kmdd_)가 같이 온다
//   2  단기 열쇠로 재료를 받는다(「Claude 에 보내지 않음」 지식은 서버가 재료를 내주지 않는다)
//   3  묶음마다 claude -p 한 번(도구 0) → JSON 초안 · 넣은 파일은 에이전트(Claude Code + 서버 MCP · 단기 열쇠)가 세션처럼 넣는다
//   4  초안을 올린다 — 서버가 검사하고 넣는다(일꾼은 쓰지 않는다)
//   로그인이 끝났거나 한도면 다시 시도하지 않고 멈춘 뒤 서버에 알린다(멈춤 한 줄 「자동 정리가 쉬고 있다」)

import { runClaude } from './claude.js'
import { promptOf, DRAFT_SCHEMA, TOUCH_SCHEMA, INGEST_SCHEMA, spotKey, batchesOf, batchPromptOf, BATCH_SCHEMA, BATCH_MAX } from './tidy.js'
import { runAgent, agentAvailable } from './agent.js'
import { modelOf } from './models.js'

// 멈추는 까닭 — 다음 자리에서 다시 불러도 같다(로그인 · 한도 · claude 없음)
const STOP = { login: '로그인이 끝났다', limit: '한도에 닿았다', missing: 'Claude Code(claude) 가 설치되어 있지 않다' }
// 초안과 같이 돌려보내는 묶음 — 서버는 묶음을 지금 지식에서 다시 만든다(groupFor) · 찾는 데 쓰는 것만(묶음 통째는 수 MB 가 된다)
const slim = (g) => ({ kind: g.kind, coord: g.coord, doc: g.doc, heading: g.heading, record: g.record ? { id: g.record.id, title: g.record.title } : undefined })

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

// 한 번에 쓰는 자리 수 — 자리마다 claude -p 한 번이라 하나씩이면 자리 수백 개가 몇 시간이 된다(KMD_TIDY_PAR · 1~8)
const PAR = Math.min(8, Math.max(1, Number(process.env.KMD_TIDY_PAR) || 3))
// 자리 하나의 글 쓰기 시간 — 기록이 많이 모인 자리는 3분을 넘기기도 한다
const TIDY_TIMEOUT = 5 * 60_000
// 한 문서의 항목을 한 번에 쓰는 수(KMD_TIDY_BATCH · 1 이면 자리마다 따로)
const BATCH = Math.max(1, Number(process.env.KMD_TIDY_BATCH) || BATCH_MAX)

// 일감 하나 — 없으면 null · models — 일마다 모델(core/models.js · 없으면 기본 배분)
//   한 문서의 항목은 batch 개까지 claude -p 한 번에(batchesOf) · 그 묶음을 PAR 개씩 같이 쓰고, 초안을 받으면 그 자리만 바로 올린다(서버가 검사해 넣고 받은 것에서 빠진다) ·
//   서버가 다시 켜져 일감이 다시 기다림이 되어도 넣은 자리는 다시 쓰지 않는다. 못 쓴 자리 · 그만둔 자리는 끝에 한꺼번에
export async function workOnce({ server, key, log = () => {}, budget = 0.5, models = null, par = PAR, batch = BATCH }) {
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
  let quit = false // 사람이 [그만두기] — 서버가 progress · drafts 답으로 알린다 · 쓴 초안은 올리고 남은 자리는 쓰지 않는다
  let lost = false // 단기 열쇠가 끊겼다(서버가 다시 켜졌다 · 일감이 다른 일꾼에게) — 더 쓰지 않는다
  const gone = (e) => { if (e.status === 401 || e.status === 403) lost = true; return {} }
  // 자리 시작 — 서버에 알린다 · 그만뒀거나 열쇠가 끊겼으면 false(그 자리는 끝에 「그만둠」 으로 올린다)
  const begin = async (g, model) => {
    if (stop || quit || lost) {
      items.push({ group: slim(g), error: stop && !quit && !lost ? stop : 'stopped' })
      return false
    }
    const p = await call(server, dkey, `/api/k/${kn}/worker/progress`, { key: spotKey(g), model, par: true }).catch(gone)
    if (p.stop || lost) {
      if (p.stop && !quit) log(`${decodeURIComponent(kn)}: 정리를 그만둔다(사람이 멈췄다)`)
      quit ||= !!p.stop
      items.push({ group: slim(g), error: 'stopped' })
      return false
    }
    return true
  }
  const write = (g, model) => runClaude({ prompt: promptOf(g), schema: g.kind === 'touches' ? TOUCH_SCHEMA : g.kind === 'ingest' ? INGEST_SCHEMA : DRAFT_SCHEMA, budget, model, timeoutMs: TIDY_TIMEOUT })
  // 자리 끝 — 서버에 알리고, 초안이면 바로 올린다. 못 올리면 끝에 같이
  const finish = async (g, r) => {
    const e = await call(server, dkey, `/api/k/${kn}/worker/progress`, { key: spotKey(g), end: true, ok: !r.error, why: r.error ? (STOP[r.error] ? r.error : r.message || r.error) : null }).catch(gone)
    if (e.stop) quit = true
    if (STOP[r.error] && !stop) {
      stop = r.error
      log(`정리 일꾼이 쉰다: ${STOP[stop]}`)
    }
    const item = { group: slim(g), draft: r.value ?? null, model: r.model, error: r.error || null, why: r.error ? r.message || null : null }
    if (!item.draft || lost) { items.push(item); return }
    const d = await call(server, dkey, `/api/k/${kn}/worker/drafts`, { drafts: [item], part: true }).catch((x) => (gone(x), null))
    if (!d) items.push(item)
    else if (d.stop) quit = true
  }
  const one = async (g) => {
    // 넣은 파일 — 세션처럼 일하는 에이전트로(이 PC 의 Claude Code · MCP 는 서버 · 단기 열쇠). 넣었으면 초안은 없다 · 못 넣으면 아래 초안 길로
    if (g.kind === 'ingest' && agentAvailable() && !(stop || quit || lost)) {
      const a = await agentIngest({ server, dkey, kn, g, log, models }).catch((e) => ({ placed: false, error: null, why: e.message }))
      if (STOP[a.error]) {
        stop = a.error
        log(`정리 일꾼이 쉰다: ${STOP[stop]}`)
        items.push({ group: slim(g), error: stop })
        return
      }
      if (a.placed) return
    }
    const model = modelOf(g.kind === 'touches' ? 'touch' : 'tidy', models)
    if (await begin(g, model)) await finish(g, await write(g, model))
  }
  // 한 문서의 항목 묶음 — claude -p 한 번에 쓰고 자리마다 초안으로 나눈다. 묶음 답이 틀렸거나 그 자리 답이 없으면 그 자리만 따로 한 번 더
  const many = async (gs) => {
    const model = modelOf('tidy', models)
    const go = []
    for (const g of gs) if (await begin(g, model)) go.push(g)
    if (go.length < 2) return go.length ? finish(go[0], await write(go[0], model)) : undefined
    const r = await runClaude({ prompt: batchPromptOf(go), schema: BATCH_SCHEMA, budget: budget * Math.min(go.length, 4), model, timeoutMs: Math.min(2 * TIDY_TIMEOUT, TIDY_TIMEOUT + go.length * 60_000) })
    const got = new Map((Array.isArray(r.value?.items) ? r.value.items : []).filter((x) => x && typeof x === 'object').map((x) => [String(x.key), x]))
    for (const g of go) {
      const d = got.get(spotKey(g))
      if (d) { await finish(g, { value: { content: d.content, used: d.used, left: d.left, drop: d.drop || [] }, model: r.model }); continue }
      if (STOP[r.error] || stop) { await finish(g, STOP[r.error] ? r : { error: stop, message: STOP[stop] }); continue }
      if (quit || lost) { items.push({ group: slim(g), error: 'stopped' }); continue }
      await finish(g, await write(g, model))
    }
  }
  const todo = batchesOf(groups, { max: batch })
  await Promise.all(Array.from({ length: Math.min(par, todo.length) }, async () => { while (todo.length) { const u = todo.shift(); await (u.length > 1 ? many(u) : one(u[0])) } }))
  if (lost) {
    log(`${decodeURIComponent(kn)}: 이 일감의 열쇠가 끊겼다(서버가 다시 켜졌다). 넣은 자리는 그대로 · 남은 자리는 다음에`)
    return { job, rows: [], skipped: 'lost' }
  }
  const res = await call(server, dkey, `/api/k/${kn}/worker/drafts`, { drafts: items })
  await call(server, key, '/api/worker/status', stop ? { ok: false, reason: stop, message: STOP[stop] } : { ok: true }).catch(() => {})
  return { job, ...res }
}

// 늘 — poll 마다 일감을 본다
// onLost — 서버가 열쇠를 끊었다(401 · 다시 정하기 · 떠남) · 멈추고 알린다
// before — 일감을 묻기 전마다(팀 서버 일꾼: 정리 전용 로그인을 다시 읽는다)
export function runWorker({ server, key, poll = 10_000, log = (...a) => console.log('[kmd worker]', ...a), onLost = null, models = null, before = null }) {
  let stopped = false
  const loop = async () => {
    while (!stopped) {
      try {
        if (before) await before()
        const r = await workOnce({ server, key, log, models })
        if (r) {
          log(`${r.job.kn}: 넣음 ${r.summary?.put ?? 0} · 값 바뀜 ${r.summary?.changed ?? 0} · 그대로 둠 ${r.summary?.left ?? 0}`)
          continue
        }
      } catch (e) {
        if (e.status === 401 && onLost) { stopped = true; log('일꾼 열쇠가 끊겼다. 다시 받는다'); onLost(); return }
        log(`서버에 닿지 않는다: ${e.message}${e.cause?.code ? ` (${e.cause.code})` : ''}`)
      }
      await new Promise((ok) => setTimeout(ok, poll))
    }
  }
  loop()
  return { stop: () => (stopped = true) }
}
