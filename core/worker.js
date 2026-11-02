// 정리 일꾼 — kmd 서버 밖에서 도는 클라이언트(`kmd worker`). 서버 프로세스는 Claude 를 부르지 않고 그 로그인도 못 읽는다.
//
//   1  일꾼 열쇠(kmdw_)로 다음 일감을 받는다 — 그 일감 · 그 지식에만 쓰는 단기 열쇠(kmdd_)가 같이 온다
//   2  단기 열쇠로 재료를 받는다(「Claude 에 보내지 않음」 지식은 서버가 재료를 내주지 않는다)
//   3  묶음마다 claude -p 한 번(도구 0) → JSON 초안 · 넣은 파일은 에이전트(Claude Code + 서버 MCP · 단기 열쇠)가 세션처럼 넣는다
//   4  초안을 올린다 — 서버가 검사하고 넣는다(일꾼은 쓰지 않는다)
//   로그인이 끝났거나 한도면 다시 시도하지 않고 멈춘 뒤 서버에 알린다(멈춤 한 줄 「자동 정리가 쉬고 있다」)

import { runClaude } from './claude.js'
import { promptOf, fixPromptOf, DRAFT_SCHEMA, TOUCH_SCHEMA, INGEST_SCHEMA, spotKey, spotTarget, batchesOf, batchPromptOf, BATCH_SCHEMA, BATCH_MAX } from './tidy.js'
import { runAgent, agentAvailable } from './agent.js'
import { modelOf } from './models.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
  const nm = decodeURIComponent(kn)
  const t = await call(server, dkey, `/api/k/${kn}/worker/agent`, { rec: g.record.id })
  let buf = []
  const flush = async () => {
    if (!buf.length) return
    const lines = buf
    buf = []
    await call(server, dkey, `/api/k/${kn}/worker/agent/log`, { run: t.run, lines }).catch((e) => log(`${nm}: 에이전트 줄을 올리지 못했다(${e.status || e.message})`))
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
// 자리 하나의 글 쓰기 시간 — 기록이 많이 모인 자리는 3분을 넘기기도 한다 · 항목 글이 길면(화면설계서 한 항목 9천 자) 다시 쓰는 데 5분을 넘긴다:
//   프롬프트 2천 자마다 1분을 더한다(15분까지)
const TIDY_TIMEOUT = 5 * 60_000
const timeoutOf = (prompt) => Math.min(15 * 60_000, TIDY_TIMEOUT + Math.floor(String(prompt).length / 2000) * 60_000)
// 한 문서의 항목을 한 번에 쓰는 수(KMD_TIDY_BATCH · 1 이면 자리마다 따로)
const BATCH = Math.max(1, Number(process.env.KMD_TIDY_BATCH) || BATCH_MAX)
// 쓰는 동안 소식 간격 — 이 사이 소식이 없으면 화면이 「멈춘 것 같다」 를 1분에 띄운다
const TICK = () => Number(process.env.KMD_TIDY_TICK_MS) || 15_000

// 일감 하나 — 없으면 null · models — 일마다 모델(core/models.js · 없으면 기본 배분)
//   한 문서의 항목은 batch 개까지 claude -p 한 번에(batchesOf) · 그 묶음을 PAR 개씩 같이 쓰고, 초안을 받으면 그 자리만 바로 올린다(서버가 검사해 넣고 받은 것에서 빠진다) ·
//   서버가 다시 켜져 일감이 다시 기다림이 되어도 넣은 자리는 다시 쓰지 않는다. 못 쓴 자리 · 그만둔 자리는 끝에 한꺼번에
export async function workOnce({ server, key, log = () => {}, budget = 0.5, models = null, par = PAR, batch = BATCH, gate = slots(par) }) {
  const n = await call(server, key, '/api/worker/next', {})
  if (!n.job) return null
  const { job, key: dkey } = n
  const kn = encodeURIComponent(job.kn)
  let groups = []
  try {
    groups = (await call(server, dkey, `/api/k/${kn}/worker/material`)).groups
  } catch (e) {
    log(`재료를 받지 못했다: ${job.kn}: ${e.message}`)
    await call(server, dkey, `/api/k/${kn}/worker/drafts`, { drafts: [] }).catch((x) => log(`${job.kn}: 빈 정리를 알리지 못했다(${x.status || x.message})`))
    return { job, rows: [], skipped: e.message }
  }
  const items = []
  let stop = null
  let quit = false // 사람이 [그만두기] — 서버가 progress · drafts 답으로 알린다 · 쓴 초안은 올리고 남은 자리는 쓰지 않는다
  let lost = false // 단기 열쇠가 끊겼다(서버가 다시 켜졌다 · 일감이 다른 일꾼에게) — 더 쓰지 않는다
  const gone = (e) => {
    if (e.status === 401 || e.status === 403) lost = true
    else log(`${decodeURIComponent(kn)}: 서버에 소식을 올리지 못했다(${e.status || e.message}${e.cause?.code ? ' · ' + e.cause.code : ''})`)
    return {}
  }
  // 자리 시작 — 서버에 알린다 · 그만뒀거나 열쇠가 끊겼으면 false(그 자리는 끝에 「그만둠」 으로 올린다) · why — 다시 쓰는 까닭(묶음 답에 없음)
  const name = (g) => `${decodeURIComponent(kn)}: ${spotTarget(g)}`
  const secs = (ms) => `${Math.round((ms || 0) / 1000)}초`
  const kindOf = (r) => `${r.error}${r.sub ? ' · ' + r.sub : ''}${r.turns ? ` · 턴 ${r.turns}` : ''}`
  const begin = async (g, model, why = null) => {
    if (stop || quit || lost) {
      items.push({ group: slim(g), error: stop && !quit && !lost ? stop : 'stopped' })
      return false
    }
    const p = await call(server, dkey, `/api/k/${kn}/worker/progress`, { key: spotKey(g), model, par: true, ...(why ? { why } : {}) }).catch(gone)
    if (p.stop || lost) {
      if (p.stop && !quit) log(`${decodeURIComponent(kn)}: 정리를 그만둔다(사람이 멈췄다)`)
      quit ||= !!p.stop
      items.push({ group: slim(g), error: 'stopped' })
      return false
    }
    return true
  }
  const schemaOf = (g) => (g.kind === 'touches' ? TOUCH_SCHEMA : g.kind === 'ingest' ? INGEST_SCHEMA : DRAFT_SCHEMA)
  // claude -p 한 번 — 걸린 시간 · 보낸 글 크기를 답에 붙인다(서버 장부 · 일꾼 기록이 자리마다 남긴다) ·
  //   쓰는 동안 TICK 마다 그 자리들(keys)에 쓴 글 · 생각 글자 수와 지난 시간을 올린다(서버 · 화면이 「쓰는 중 3:12 · 쓴 글 1.2k자」 를 보인다)
  const ask = async (prompt, o, keys = []) => {
    await gate.take()
    try { return await ask1(prompt, o, keys) } finally { gate.give() }
  }
  const ask1 = async (prompt, o, keys = []) => {
    const t0 = Date.now()
    const onTick = keys.length && !lost ? (t) => { call(server, dkey, `/api/k/${kn}/worker/progress`, { keys, tick: true, out: t.out, think: t.think, ms: t.ms }).then((p) => { if (p.stop) quit = true }, gone) } : null
    const r = await runClaude({ prompt, budget, timeoutMs: timeoutOf(prompt), onTick, tickMs: TICK(), ...o })
    return { ...r, ms: Date.now() - t0, chars: prompt.length }
  }
  const write = (g, model) => ask(promptOf(g), { schema: schemaOf(g), model }, [spotKey(g)])
  // 자리 끝 — 서버에 알리고, 초안이면 바로 올린다. 못 올리면 끝에 같이 ·
  //   서버 검사가 고칠 수 있는 까닭(빠진 값 · 지어낸 값 · 크기 · 머리)으로 돌려보내면 그 까닭을 붙여 한 번만 다시 쓴다
  const finish = async (g, r, again = true) => {
    log(`${name(g)}: ${r.error ? `초안을 받지 못했다(${kindOf(r)})` : '초안'} · ${secs(r.ms)} · 보낸 글 ${r.chars || 0}자${r.outTokens ? ` · 받은 토큰 ${r.outTokens}` : ''}${r.model ? ` · ${r.model}` : ''}`)
    const e = await call(server, dkey, `/api/k/${kn}/worker/progress`, { key: spotKey(g), end: true, ok: !r.error, why: r.error ? (STOP[r.error] ? r.error : r.message || r.error) : null, ms: r.ms || 0, chars: r.chars || 0, cost: r.cost || 0, tokens: r.outTokens || 0 }).catch(gone)
    if (e.stop) quit = true
    if (STOP[r.error] && !stop) {
      stop = r.error
      log(`정리 일꾼이 쉰다: ${STOP[stop]}`)
    }
    const item = { group: slim(g), draft: r.value ?? null, model: r.model, error: r.error || null, why: r.error ? r.message || null : null }
    if (!item.draft || lost) { items.push(item); return }
    const d = await call(server, dkey, `/api/k/${kn}/worker/drafts`, { drafts: [item], part: true, fix: again }).catch((x) => (gone(x), null))
    if (!d) items.push(item)
    else if (d.stop) quit = true
    // 고쳐 쓰기는 일 줄에 되돌려 빈 칸이 집는다(같은 칸에서 이어 쓰면 뒤 자리가 그만큼 밀린다)
    else if (d.fix && again && !(stop || quit || lost)) todo.unshift([{ ...g, fix: { draft: item.draft, why: d.fix } }])
  }
  // 고쳐 쓰기 한 번 — 서버가 이미 「까닭을 알려 고쳐 쓴다」 줄을 달았다
  const refix = async (g) => {
    const model = modelOf(g.kind === 'touches' ? 'touch' : 'tidy', models)
    if (await begin(g, model)) await finish(g, await ask(fixPromptOf(g, g.fix.draft, g.fix.why), { schema: schemaOf(g), model }, [spotKey(g)]), false)
  }
  const one = async (g) => {
    if (g.fix) return refix(g)
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
    if (await begin(g, model, g.again || null)) await finish(g, await write(g, model))
  }
  // 한 문서의 항목 묶음 — claude -p 한 번에 쓰고 자리마다 초안으로 나눈다. 묶음 답이 틀렸거나 그 자리 답이 없으면 그 자리를 일 줄에 되돌려
  //   빈 칸이 따로 다시 쓴다(까닭을 줄에 남긴다 · 같은 칸에서 차례로 쓰면 묶음 6분 + 자리마다 5분이 한 줄로 쌓이고 화면에는 아무 줄도 없었다)
  const many = async (gs) => {
    const model = modelOf('tidy', models)
    const go = []
    for (const g of gs) if (await begin(g, model)) go.push(g)
    if (go.length < 2) return go.length ? finish(go[0], await write(go[0], model)) : undefined
    const prompt = batchPromptOf(go)
    // 묶음 시간 상한 — 항목마다 따로 쓸 때(timeoutOf)보다 짧으면 안 된다(큰 항목 둘의 묶음이 7분에 끊겨 다시 쓰던 것)
    const r = await ask(prompt, { schema: BATCH_SCHEMA, budget: budget * Math.min(go.length, 8), model, timeoutMs: Math.min(15 * 60_000, Math.max(timeoutOf(prompt), TIDY_TIMEOUT + go.length * 60_000)) }, go.map(spotKey))
    const got = new Map((Array.isArray(r.value?.items) ? r.value.items : []).filter((x) => x && typeof x === 'object').map((x) => [String(x.key), x]))
    log(`${decodeURIComponent(kn)}: 묶음 ${go[0].doc.replace(/^docs\/|\.md$/g, '')} 자리 ${go.length} → 답 ${got.size}${r.error ? ` · ${kindOf(r)}` : ''} · ${secs(r.ms)} · 보낸 글 ${r.chars}자${r.outTokens ? ` · 받은 토큰 ${r.outTokens}` : ''}`)
    for (const g of go) {
      const d = got.get(spotKey(g))
      if (d) { await finish(g, { value: { content: d.content, used: d.used, left: d.left, drop: d.drop || [] }, model: r.model, ms: r.ms, chars: r.chars, cost: r.cost }); continue }
      if (STOP[r.error] || stop) { await finish(g, STOP[r.error] ? r : { error: stop, message: STOP[stop] }); continue }
      if (quit || lost) { items.push({ group: slim(g), error: 'stopped' }); continue }
      todo.push([{ ...g, again: `묶음 답에 ${r.error ? `실패(${r.message || r.error})` : '이 자리가 없다'} · 따로 다시 쓴다` }])
    }
  }
  // 일 줄 — 큰 자리부터(긴 일이 끝에 혼자 남지 않게) · 묶음에서 빠진 자리는 뒤에 되돌아와 빈 칸이 집는다
  const sizeOf = (u) => u.reduce((n, g) => n + (g.content || '').length + (g.records || [g.record]).reduce((m, r) => m + (r?.body || '').length, 0), 0)
  const todo = batchesOf(groups, { max: batch }).sort((a, b) => sizeOf(b) - sizeOf(a))
  let active = 0
  const runner = async () => {
    for (;;) {
      const u = todo.shift()
      if (!u) { if (!active) return; await new Promise((ok) => setTimeout(ok, 500)); continue }
      active++
      try { await (u.length > 1 ? many(u) : one(u[0])) } finally { active-- }
    }
  }
  // 칸은 늘 par 개 — 처음 일이 하나여도 되돌아온 다시 쓰기 · 고쳐 쓰기를 빈 칸이 같이 집는다
  await Promise.all(Array.from({ length: par }, runner))
  if (lost) {
    log(`${decodeURIComponent(kn)}: 이 일감의 열쇠가 끊겼다(서버가 다시 켜졌다). 넣은 자리는 그대로 · 남은 자리는 다음에`)
    return { job, rows: [], skipped: 'lost' }
  }
  const res = await call(server, dkey, `/api/k/${kn}/worker/drafts`, { drafts: items })
  await call(server, key, '/api/worker/status', stop ? { ok: false, reason: stop, message: STOP[stop] } : { ok: true }).catch((e) => log(`일꾼 상태를 알리지 못했다(${e.status || e.message})`))
  return { job, ...res }
}

// claude 동시 호출 상한 — 일감 둘이 나란히 돌아도 전체가 PAR 를 넘지 않는다
export function slots(n) {
  let free = n
  const wait = []
  return { take: () => (free > 0 ? (free--, Promise.resolve()) : new Promise((ok) => wait.push(ok))), give: () => (wait.length ? wait.shift()() : free++) }
}
// 일꾼이 남긴 Claude Code 프로젝트 폴더 — 부를 때마다 새 임시 폴더라 ~/.claude/projects 에 「…kmd-worker-…」 가 쌓이기만 했다(188 에 28개).
//   하루 지난 것을 걷는다(지금 부르는 것은 건드리지 않는다)
export function sweepProjects({ home = os.homedir(), log = () => {}, ageMs = 24 * 3600_000 } = {}) {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects')
  let n = 0
  let names = []
  try { names = fs.readdirSync(dir) } catch (e) { if (e.code !== 'ENOENT') log(`일꾼 폴더를 읽지 못했다: ${e.message}`); return 0 }
  for (const x of names.filter((y) => /kmd-worker-/.test(y))) {
    const p = path.join(dir, x)
    try {
      if (Date.now() - fs.statSync(p).mtimeMs < ageMs) continue
      fs.rmSync(p, { recursive: true, force: true })
      n++
    } catch (e) { log(`일꾼 폴더를 지우지 못했다: ${x}: ${e.message}`) }
  }
  if (n) log(`지난 일꾼 폴더 ${n}개를 걷었다`)
  return n
}

// 늘 — poll 마다 일감을 본다
// onLost — 서버가 열쇠를 끊었다(401 · 다시 정하기 · 떠남) · 멈추고 알린다
// before — 일감을 묻기 전마다(팀 서버 일꾼: 정리 전용 로그인을 다시 읽는다)
// jobs — 일감을 나란히 맡는 수(다른 지식 · 같은 지식은 서버가 한 일감만 낸다 · KMD_TIDY_JOBS) · claude 동시 호출은 둘이 합쳐 PAR
const JOBS = Math.min(4, Math.max(1, Number(process.env.KMD_TIDY_JOBS) || 2))
export function runWorker({ server, key, poll = 10_000, log = (...a) => console.log('[kmd worker]', ...a), onLost = null, models = null, before = null, jobs = JOBS }) {
  let stopped = false
  const gate = slots(PAR)
  sweepProjects({ log })
  const sweep = setInterval(() => sweepProjects({ log }), 6 * 3600_000)
  sweep.unref?.()
  const loop = async (i) => {
    // 둘째 칸부터는 조금 늦게 — 같은 순간에 일감을 묻지 않게
    if (i) await new Promise((ok) => setTimeout(ok, 1000 * i))
    while (!stopped) {
      try {
        if (before) await before()
        const r = await workOnce({ server, key, log, models, gate })
        if (r) {
          log(`${r.job.kn}: 넣음 ${r.summary?.put ?? 0} · 값 바뀜 ${r.summary?.changed ?? 0} · 그대로 둠 ${r.summary?.left ?? 0}`)
          continue
        }
      } catch (e) {
        if (e.status === 401 && onLost) { if (!stopped) { stopped = true; clearInterval(sweep); log('일꾼 열쇠가 끊겼다. 다시 받는다'); onLost() } return }
        log(`서버에 닿지 않는다: ${e.message}${e.cause?.code ? ` (${e.cause.code})` : ''}`)
      }
      await new Promise((ok) => setTimeout(ok, poll))
    }
  }
  for (let i = 0; i < jobs; i++) loop(i)
  return { stop: () => { stopped = true; clearInterval(sweep) } }
}
