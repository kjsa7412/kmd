// 팀 일꾼 — kmd 서버 밖에서 도는 클라이언트(`kmd worker`). 서버 프로세스는 Claude 를 부르지 않고 그 로그인도 못 읽는다.
//
//   1  일꾼 열쇠(kmdw_)로 다음 일감을 받는다 — 그 일감 · 그 지식에만 쓰는 단기 열쇠(kmdd_)가 같이 온다
//   2  단기 열쇠로 재료를 받는다(「Claude 에 보내지 않음」 지식은 서버가 재료를 내주지 않는다)
//   3  들이기 일감(kind intake · S7)은 원천 하나를 claude -p 한 번(도구 0)으로 기록 + 조각 초안 하나 → 서버가 저장 문 한 번으로 넣는다.
//      고칠 수 있는 까닭으로 돌려보내면 그 까닭을 붙여 KMD_INGEST_FIX 번(1 ~ 2 · 기본 2)까지 다시 쓴다(intakeOnce)
//      정정(type fix)은 남은 항목의 조각만(FIX_SCHEMA) · 다듬기(type polish · S13)는 문서 하나의 항목 글(POLISH_SCHEMA · 값은 그대로)
//   4  옛 정리 일감 · 팀 쪽 에이전트 길은 개편 S13 에 걷었다(서버가 들이기 일감만 낸다 · S-D21)
//   로그인이 끝났거나 한도면 다시 시도하지 않고 멈춘 뒤 서버에 알린다(멈춤 한 줄 「팀 일꾼이 쉬고 있다」)
//   환경 변수(K7-3 · S-D38): KMD_WORKER_PAR · KMD_WORKER_JOBS · KMD_WORKER_TICK_MS · KMD_INGEST_BUDGET · KMD_INGEST_EFFORT · KMD_INGEST_FIX —
//   옛 이름 KMD_TIDY_PAR · _JOBS · _TICK_MS · _BUDGET · _EFFORT 도 뒤 순서로 읽는다(188 의 worker.env · S-D38)

import { runClaude } from './claude.js'
import { INTAKE_SCHEMA, intakePromptOf, intakeFixPromptOf, POLISH_SCHEMA, polishPromptOf } from './ingest.js'
import { FIX_SCHEMA, corrPromptOf, corrRetryPromptOf } from './fix.js'
import { WRITE_RULES } from './writerules.js'
import { modelOf } from './models.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 멈추는 까닭 — 다음 자리에서 다시 불러도 같다(로그인 · 한도 · claude 없음)
const STOP = { login: '로그인이 끝났다', limit: '한도에 닿았다', missing: 'Claude Code(claude) 가 설치되어 있지 않다' }
async function call(server, key, p, body) {
  const r = await fetch(server + p, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.message || `${r.status}`), { code: j.error, status: r.status })
  return j
}

// 환경 변수 — 새 이름 먼저 · 없으면 옛 이름(188 의 worker.env 에 옛 이름이 있다 · S-D38)
const envOf = (now, old) => process.env[now] ?? process.env[old]
// claude 동시 호출 상한 — 일감 둘이 나란히 돌아도 합쳐서(KMD_WORKER_PAR · 1~8 · 기본 3)
const PAR = Math.min(8, Math.max(1, Number(envOf('KMD_WORKER_PAR', 'KMD_TIDY_PAR')) || 3))
// 초안 하나의 시간 — 원천 · 항목 글이 길면 5분을 넘긴다: 프롬프트 2천 자마다 1분을 더한다(15분까지)
const INTAKE_TIMEOUT = 5 * 60_000
const timeoutOf = (prompt) => Math.min(15 * 60_000, INTAKE_TIMEOUT + Math.floor(String(prompt).length / 2000) * 60_000)
// 생각 정도(KMD_INGEST_EFFORT · low · medium · high · max · 비면 그 PC 의 기본)
const EFFORT = () => envOf('KMD_INGEST_EFFORT', 'KMD_TIDY_EFFORT') || ''
// Claude 한 번의 예산 상한(KMD_INGEST_BUDGET · 달러 · 비면 1.0) — 들이기 한 번은 파일 하나 + 후보 다섯 × 1500자를 읽고 기록과 항목 글을 같이 쓴다
//   (옛 정리 기본 0.5 는 긴 항목에서 생각 글만으로 넘겼다 · 188 「4. 구성 순서」 · 11-03)
const BUDGET = () => (Number(envOf('KMD_INGEST_BUDGET', 'KMD_TIDY_BUDGET')) > 0 ? Number(envOf('KMD_INGEST_BUDGET', 'KMD_TIDY_BUDGET')) : 1.0)
// 고쳐 쓰기 횟수(KMD_INGEST_FIX · 1 ~ 2 · 기본 2) — 서버도 같은 수를 센다(일꾼 말을 믿지 않는다 · S-D20)
const INGEST_FIX = () => Math.min(2, Math.max(1, Number(process.env.KMD_INGEST_FIX) || 2))
// 쓰는 동안 소식 간격 — 이 사이 소식이 없으면 화면이 「멈춘 것 같다」 를 1분에 띄운다
const TICK = () => Number(envOf('KMD_WORKER_TICK_MS', 'KMD_TIDY_TICK_MS')) || 15_000

// 들이기 일감 하나(S7 · 설계 3-5) — 재료 → claude -p → done → { fix } 이면 까닭을 붙여 다시(KMD_INGEST_FIX 번까지) → 마지막.
//   일꾼은 쓰지 않는다: 서버가 시도를 세고(본문의 tries 를 믿지 않는다) · 검사하고 · 저장 한 번으로 넣거나 기록만 + 넣지 못함
//   돌려주는 것 { job, summary: { put, held }, rec?, skipped? }
export async function intakeOnce({ server, key, job, dkey, log = () => {}, budget = BUDGET(), models = null, gate = slots(PAR) }) {
  const kn = encodeURIComponent(job.kn)
  const base = `/api/k/${kn}/worker/intake`
  let lost = false
  const gone = (e) => {
    if (e.status === 401 || e.status === 403) lost = true
    else log(`${job.kn}: 서버에 소식을 올리지 못했다(${e.status || e.message})`)
    return {}
  }
  let g
  try {
    g = await call(server, dkey, base)
  } catch (e) {
    log(`재료를 받지 못했다: ${job.kn}: ${e.message}`)
    // 「Claude 에 보내지 않음」 이 그사이 켜졌다 · 원천이 없다 — 일감은 서버가 시계로 닫는다(24시간) · 여기서는 쉰다
    return { job, summary: { put: 0, held: 0 }, skipped: e.message }
  }
  const name = `${job.kn}: ${g.src?.file || g.src?.title || job.id}`
  const model = modelOf('ingest', models)
  const opt = { writeRules: WRITE_RULES }
  // 정정 일감(S9 · type fix) — 남은 항목마다 조각만(FIX_SCHEMA) · 다듬기(S13 · type polish) — 문서 하나의 항목 글(POLISH_SCHEMA) · 그 밖은 기록 + 조각(INTAKE_SCHEMA)
  const corr = g.type === 'fix'
  const pol = g.type === 'polish'
  const schema = corr ? FIX_SCHEMA : pol ? POLISH_SCHEMA : INTAKE_SCHEMA
  let prompt = corr ? corrPromptOf(g, opt) : pol ? polishPromptOf(g, opt) : intakePromptOf(g, opt)
  for (let i = 0; i <= INGEST_FIX(); i++) {
    const p0 = await call(server, dkey, `${base}/progress`, {}).catch(gone)
    if (lost || p0.stop) return { job, summary: { put: 0, held: 0 }, skipped: lost ? 'lost' : 'stopped' }
    await gate.take()
    let r
    const t0 = Date.now()
    try {
      r = await runClaude({ prompt, schema, budget, model, timeoutMs: timeoutOf(prompt), effort: EFFORT(), tickMs: TICK(), onTick: () => call(server, dkey, `${base}/progress`, { tick: true }).catch(gone) })
    } finally { gate.give() }
    log(`${name}: ${r.error ? `초안을 받지 못했다(${r.error}${r.message ? ' · ' + String(r.message).slice(0, 80) : ''})` : '초안'} · ${Math.round((Date.now() - t0) / 1000)}초 · 보낸 글 ${prompt.length}자${r.model ? ` · ${r.model}` : ''}`)
    await call(server, dkey, `${base}/progress`, { end: true, ok: !r.error, why: r.error ? String(r.message || r.error).slice(0, 200) : null }).catch(gone)
    if (lost) return { job, summary: { put: 0, held: 0 }, skipped: 'lost' }
    if (r.error) {
      const code = ['login', 'limit', 'missing', 'budget', 'shape'].includes(r.error) ? r.error : /^시간이 넘었다/.test(r.message || '') ? 'timeout' : 'fail'
      const why = String(r.message || r.error).replace(/\s+/g, ' ').slice(0, 200)
      const d = await call(server, dkey, `${base}/fail`, { code, why }).catch((e) => (gone(e), null))
      if (STOP[r.error]) {
        log(`팀 일꾼이 쉰다: ${STOP[r.error]}`)
        await call(server, key, '/api/worker/status', { ok: false, reason: r.error, message: STOP[r.error] }).catch((e) => log(`일꾼 상태를 알리지 못했다(${e.status || e.message})`))
        return { job, summary: { put: 0, held: 0 }, skipped: r.error, stop: r.error }
      }
      if (d?.retry) continue
      return { job, summary: { put: 0, held: d?.held || 0 }, rec: d?.rec || null }
    }
    const d = await call(server, dkey, `${base}/done`, { draft: r.value, cost: r.cost || 0 }).catch((e) => (gone(e), { error: e.message }))
    if (lost) return { job, summary: { put: 0, held: 0 }, skipped: 'lost' }
    if (d.error) { log(`${name}: 초안을 넣지 못했다(${d.error})`); return { job, summary: { put: 0, held: 0 }, skipped: d.error } }
    if (d.fix) {
      log(`${name}: 검사에 걸렸다 · 고쳐 쓴다(${String(d.fix).slice(0, 120)})`)
      prompt = corr ? corrRetryPromptOf(g, r.value, d.fix, opt) : pol ? [polishPromptOf(g, opt), `지난 초안이 kmd 검사에 걸렸다: ${d.fix}`, '걸린 항목만 고치고 값은 옛 글 그대로 둔다.', `지난 초안:\n${JSON.stringify(r.value)}`].join('\n\n') : intakeFixPromptOf(g, r.value, d.fix, opt)
      continue
    }
    await call(server, key, '/api/worker/status', { ok: true }).catch((e) => log(`일꾼 상태를 알리지 못했다(${e.status || e.message})`))
    log(`${name}: ${d.same ? '같은 것을 이미 들였다' : `넣음 ${d.put || 0} · 넣지 못함 ${(d.held || []).length}`}`)
    return { job, summary: { put: d.put || 0, held: (d.held || []).length }, rec: d.rec || null }
  }
  return { job, summary: { put: 0, held: 0 } }
}

// 일감 하나 — 없으면 null · models — 일마다 모델(core/models.js · 없으면 기본 배분) · 서버는 들이기 일감만 낸다(S13)
export async function workOnce({ server, key, log = () => {}, budget = BUDGET(), models = null, gate = slots(PAR) }) {
  const n = await call(server, key, '/api/worker/next', {})
  if (!n.job) return null
  if (n.job.kind !== 'intake') {
    log(`모르는 일감이다(${n.job.kind}): 건너뛴다`)
    return { job: n.job, summary: { put: 0, held: 0 }, skipped: 'kind' }
  }
  return intakeOnce({ server, key, job: n.job, dkey: n.key, log, budget, models, gate })
}

// claude 동시 호출 상한 — 일감 둘이 나란히 돌아도 전체가 PAR 를 넘지 않는다
export function slots(n) {
  let free = n
  const wait = []
  return { take: () => (free > 0 ? (free--, Promise.resolve()) : new Promise((ok) => wait.push(ok))), give: () => (wait.length ? wait.shift()() : free++) }
}
// 일꾼이 남긴 Claude Code 프로젝트 폴더 — 부를 때마다 새 임시 폴더라 ~/.claude/projects 에 「…kmd-worker-…」 가 쌓이기만 했다(188 에 28개).
//   옛 에이전트의 「…kmd-agent-…」 도 같다 · 하루 지난 것을 걷는다(지금 부르는 것은 건드리지 않는다)
export function sweepProjects({ home = os.homedir(), log = () => {}, ageMs = 24 * 3600_000 } = {}) {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects')
  let n = 0
  let names = []
  try { names = fs.readdirSync(dir) } catch (e) { if (e.code !== 'ENOENT') log(`일꾼 폴더를 읽지 못했다: ${e.message}`); return 0 }
  for (const x of names.filter((y) => /kmd-(?:worker|agent)-/.test(y))) {
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
// before — 일감을 묻기 전마다(팀 서버 일꾼: 팀 일꾼 로그인을 다시 읽는다)
// jobs — 일감을 나란히 맡는 수(KMD_WORKER_JOBS · 1 ~ 4 · 기본 2) · claude 동시 호출은 둘이 합쳐 PAR
const JOBS = Math.min(4, Math.max(1, Number(envOf('KMD_WORKER_JOBS', 'KMD_TIDY_JOBS')) || 2))
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
          log(`${r.job.kn}: ${r.job.type === 'polish' ? '다듬기' : '들이기'} · 넣음 ${r.summary?.put ?? 0} · 넣지 못함 ${r.summary?.held ?? 0}`)
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
