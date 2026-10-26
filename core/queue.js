// 일 줄 — 들여오는 일(파일 들이기 · 가져오기 · 기록을 문서에 넣기 · 여러 파일 묶음)을 한 줄로 세운다(가져오기 일 줄 검토안 2 · 3단계).
//
//   일     { id, kind, origin, kn, title, by, auto, state, stage, stages[], lane, order, msg, at, startedAt, endedAt, spec, parent, lines }
//          파일 들이기는 hub 의 run 그대로가 일이다(/api/runs 도 같은 것을 본다)
//   상태   wait 기다림 · run 도는 중 · pausing 멈추는 중 · pause 멈춤 · check 확인할 것 · fail 못함 — 아직 줄에 있다
//          done · rule(규칙으로 넣음) · cancel(그만둠 · 건너뜀) — 끝났다
//   단계   수집 › 검토 › 기록 생성 › 문서 생성 — 일을 하는 쪽이 step(일, i) 로 단계에 들어간다. 단계 사이가 멈출 수 있는 자리다:
//          멈춤을 눌렀거나 줄 멈춤이면 거기서 서서 이어서를 기다리고, 그만두면 Cancelled 를 던진다. 도는 단계 안에서 끊는 것은 signal(그만두기)
//   길     claude(Claude Code 로 들이는 문서 생성) · fetch(가져오기) — 길마다 동시에 도는 수(caps) · 기다리는 일은 order 차례로
//   남기기 <살림>/queue.json — 줄에 남은 일 · 끝난 일(30일 · 300개까지 · 줄은 400) · 도는 중이던 일은 다시 켤 때 「멈춤 — 프로그램이 꺼졌다」
//   이어 하기 — 일을 다시 돌리는 법은 spec.type 마다 runner(일, { from, force }) 로 hub 가 준다(다시 · 그대로 맞추기 · 다시 켠 뒤 이어서)

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export const STAGES = ['수집', '검토', '기록 생성', '문서 생성']
const FINAL = new Set(['done', 'rule', 'cancel'])
export const isFinal = (j) => FINAL.has(j.state)
export class Cancelled extends Error {
  constructor(message = '그만뒀다') {
    super(message)
    this.cancelled = true
  }
}
const now = () => new Date().toISOString()

export function createQueue({ file = null, caps = {}, keepDays = 30, keepMax = 300, log = () => {} } = {}) {
  const jobs = new Map()
  const ctl = new Map() // 일 → { ac(그만두기), pause(멈춤을 눌렀다), wake · fail(멈춘 자리에서 깨우기), lane(기다리는 길), active(일을 하는 쪽이 붙어 있다), p(그 일의 끝) }
  const lanes = { claude: new Set(), fetch: new Set() }
  const waiting = [] // 길을 기다리는 일 — { j, lane, ok, no }
  const runners = {}
  const Q = { caps: { claude: 1, fetch: 2, ...caps }, hold: false }
  let order = 0
  let closed = false
  const C = (j) => {
    let c = ctl.get(j.id)
    if (!c) ctl.set(j.id, (c = { ac: new AbortController(), pause: false }))
    return c
  }

  // ── 남기기 ──
  let saveT = null
  let saving = Promise.resolve()
  const save = () => {
    if (!file || saveT || closed) return
    saveT = setTimeout(() => {
      saveT = null
      saving = saving.then(() => q.flush()).catch((e) => log('일 줄 적기', e.message))
    }, 800) // 일이 몰려도 몇 번만 적는다
    saveT.unref?.()
  }

  // 길 — 놓인 차례대로 · 멈춘 일은 건너뛴다 · 줄 멈춤이면 아무도 시작하지 않는다
  function pump() {
    if (Q.hold) return
    for (const lane of Object.keys(lanes)) {
      const cap = Math.max(1, Number(Q.caps[lane]) || 1)
      for (const w of waiting.filter((x) => x.lane === lane).sort((a, b) => a.j.order - b.j.order)) {
        if (lanes[lane].size >= cap) break
        if (C(w.j).pause || w.j.state === 'pause') continue
        waiting.splice(waiting.indexOf(w), 1)
        lanes[lane].add(w.j.id)
        C(w.j).lane = lane
        w.ok()
      }
    }
  }
  const release = (j) => {
    const c = ctl.get(j.id)
    if (!c?.lane) return
    lanes[c.lane]?.delete(j.id)
    c.lane = null
    pump()
  }
  const acquire = (j, lane) => new Promise((ok, no) => {
    waiting.push({ j, lane, ok, no })
    pump()
  })
  const setStage = (j, i, state) => {
    const s = j.stages[i]
    if (!s) return
    if (state === 'run' && s.state !== 'run') s.at = now()
    if (['done', 'fail', 'cancel', 'check', 'skip'].includes(state)) s.end = now()
    s.state = state
  }
  // 멈출 자리 — 이어서(wake) · 그만두기(fail) 를 기다린다 · 쥔 길은 놓는다
  async function park(j, i, why) {
    const c = C(j)
    release(j)
    j.state = 'pause'
    j.stage = i
    setStage(j, i, 'pause')
    j.parked = why
    j.msg = why === 'hold' ? `줄 멈춤 — 「${STAGES[i]}」 에서 이어 간다` : `멈췄다 — 「${STAGES[i]}」 에서 이어 간다`
    q.line(j, 'sys', j.msg)
    save()
    await new Promise((ok, no) => { c.wake = ok; c.fail = no })
    c.wake = c.fail = null
    c.pause = false
    j.parked = null
  }

  const q = {
    STAGES,
    get hold() { return Q.hold },
    get caps() { return { ...Q.caps } },
    runner(type, f) { runners[type] = f },
    get: (id) => jobs.get(id) || null,
    list: () => [...jobs.values()],
    // 일 하나를 줄에 — 기다림 · 맨 뒤 차례
    add(j) {
      j.id ||= crypto.randomBytes(6).toString('hex')
      j.at ||= now()
      j.state ||= 'wait'
      j.stage ??= 0
      j.stages ||= STAGES.map(() => ({ state: 'wait' }))
      j.lines ||= []
      j.order ??= ++order
      jobs.set(j.id, j)
      C(j).active = true // 줄에 세운 쪽이 일을 한다
      save()
      return j
    },
    line(j, k, x) {
      j.lines.push({ t: Date.now() - Date.parse(j.startedAt || j.at), k, x: String(x).slice(0, 4000), s: j.stage ?? 0 })
      if (j.lines.length > 2000) j.lines.splice(0, j.lines.length - 2000)
    },
    signal: (j) => C(j).ac.signal,
    cancelled: (j) => !!ctl.get(j.id)?.ac.signal.aborted,
    // 단계에 들어간다 — 앞 단계는 끝 · 멈출 자리(멈춤 · 줄 멈춤 · 그만두기) · lane 이면 그 길의 차례를 기다린다
    async step(j, i, { lane = null } = {}) {
      if (isFinal(j)) throw new Cancelled(j.msg || undefined)
      const c = C(j)
      c.active = true
      for (let k = 0; k < i; k++) if (!['done', 'skip'].includes(j.stages[k].state)) setStage(j, k, j.stages[k].state === 'wait' ? 'skip' : 'done')
      if (c.ac.signal.aborted) throw new Cancelled()
      if (c.pause || Q.hold) {
        await park(j, i, c.pause ? 'user' : 'hold')
        if (c.ac.signal.aborted) throw new Cancelled()
      }
      const want = lane || j.lane
      if (want && c.lane !== want) {
        release(j)
        j.lane = want
        j.state = 'wait'
        j.stage = i
        setStage(j, i, 'wait')
        save()
        await acquire(j, want)
        if (c.ac.signal.aborted) { release(j); throw new Cancelled() }
      }
      j.state = c.pause ? 'pausing' : 'run'
      j.stage = i
      j.startedAt ||= now()
      setStage(j, i, 'run')
      save()
    },
    // 멈출 자리만 — 단계는 그대로(앞일 자리를 잡기 전처럼 아직 단계에 들지 않았을 때)
    async gate(j) {
      if (isFinal(j)) throw new Cancelled(j.msg || undefined)
      const c = C(j)
      if (c.ac.signal.aborted) throw new Cancelled()
      if (c.pause || Q.hold) {
        await park(j, j.stage ?? 0, c.pause ? 'user' : 'hold')
        if (c.ac.signal.aborted) throw new Cancelled()
        j.state = 'wait'
      }
    },
    // 단계 표시만 — 멈출 자리가 아니다(되돌릴 수 없는 쓰기 뒤의 마무리)
    mark(j, i) {
      if (isFinal(j)) return j
      for (let k = 0; k < i; k++) if (!['done', 'skip'].includes(j.stages[k].state)) setStage(j, k, j.stages[k].state === 'wait' ? 'skip' : 'done')
      if (j.state !== 'pausing') j.state = 'run'
      j.stage = i
      j.startedAt ||= now()
      setStage(j, i, 'run')
      save()
      return j
    },
    // 예전 일(일 줄 전에 남은 runs 파일) — 끝난 일로만 싣는다
    adopt(j) {
      if (jobs.has(j.id)) return jobs.get(j.id)
      j.at ||= j.startedAt || now()
      j.lines ||= []
      j.stage ??= 3
      j.stages ||= STAGES.map(() => ({ state: j.state === 'cancel' ? 'skip' : j.state === 'fail' ? 'wait' : 'done' }))
      j.order ??= ++order
      if (!isFinal(j)) j.legacy = true
      jobs.set(j.id, j)
      return j
    },
    // 줄에서 아예 뺀다(남길 것이 없는 일)
    drop(j) {
      release(j)
      ctl.delete(j.id)
      jobs.delete(j.id)
      save()
    },
    // 끝 — 일의 state(done · rule · fail · check · cancel)대로 단계를 닫는다 · 못함 · 확인할 것은 줄에 남는다
    end(j, state = j.state, msg = j.msg) {
      const c = ctl.get(j.id)
      release(j)
      if (state === 'run' || state === 'wait' || state === 'pausing' || state === 'pause') state = 'done'
      j.state = state
      if (msg != null) j.msg = msg
      const i = Math.min(j.stage ?? 0, 3)
      if (state === 'done' || state === 'rule') j.stages.forEach((s, k) => { if (k <= i && s.state !== 'skip') setStage(j, k, 'done'); else if (s.state === 'wait') setStage(j, k, 'skip') })
      else setStage(j, i, state === 'cancel' ? 'cancel' : state === 'check' ? 'check' : 'fail')
      j.endedAt = now()
      j.parked = null
      if (c) { c.active = false; c.pause = false }
      if (isFinal(j)) ctl.delete(j.id)
      save()
      return j
    },
    // 줄에 남은 못함 · 확인할 것을 걷는다(뒤의 일이 맞췄다 · 사람이 지웠다)
    dismiss(j, msg) {
      if (isFinal(j)) return j
      return q.end(j, 'cancel', msg)
    },
    // ── 손잡이 ──
    pause(id) {
      const j = need(id)
      if (isFinal(j) || j.state === 'fail' || j.state === 'check' || j.state === 'pause') return j
      const c = C(j)
      c.pause = true
      if (j.state === 'run') j.state = 'pausing'
      else { j.state = 'pause'; j.parked = 'user'; j.msg = `멈췄다 — 「${STAGES[j.stage ?? 0]}」 에서 이어 간다` }
      save()
      return j
    },
    resume(id) {
      const j = need(id)
      const c = C(j)
      if (j.state === 'pausing') { c.pause = false; j.state = 'run'; save(); return j }
      if (j.state !== 'pause') return j
      c.pause = false
      j.msg = ''
      if (c.wake) { j.state = 'run'; c.wake() } // 멈춘 자리에서 깨운다(길은 다시 기다린다)
      else if (waiting.some((w) => w.j === j) || c.active) { j.state = 'wait'; j.parked = null; pump() } // 길을 기다리던 일 · 아직 멈출 자리에 닿지 않은 일
      else return q.retry(id) // 일을 하는 쪽이 없다(다시 켰다) — 그 단계부터 다시
      save()
      return j
    },
    cancel(id, msg = '그만뒀다') {
      const j = need(id)
      if (isFinal(j)) return j
      const c = C(j)
      if (j.state === 'fail' || j.state === 'check' || (!c.active && !waiting.some((w) => w.j === j))) return q.end(j, 'cancel', j.state === 'check' ? '건너뛰었다 — 다음 정한 때에 다시 본다' : msg)
      c.ac.abort()
      const w = waiting.find((x) => x.j === j)
      if (w) { waiting.splice(waiting.indexOf(w), 1); w.no(new Cancelled(msg)) }
      if (c.fail) c.fail(new Cancelled(msg))
      j.msg = msg
      // 도는 중이 아니면(기다림 · 멈춤) 곧바로 끝 — 일을 하는 쪽은 다음 단계에서 Cancelled 를 받는다
      if (j.state !== 'run' && j.state !== 'pausing') return q.end(j, 'cancel', msg)
      save()
      return j
    },
    // 다시 — 못함 · 확인할 것 · 다시 켜서 멈춘 일을 그 단계부터 · force 면 브레이크를 넘어(그대로 맞추기)
    retry(id, { force = false } = {}) {
      const j = need(id)
      const run = runners[j.spec?.type]
      if (!run) throw Object.assign(new Error('이 일은 다시 할 수 없다 — 파일을 다시 넣거나 [지금 가져오기]'), { code: 'E_INPUT' })
      const from = Math.min(j.stage ?? 0, 3)
      ctl.delete(j.id)
      const c = C(j)
      c.active = true
      Object.assign(j, { state: 'wait', endedAt: null, parked: null, msg: `다시 — 「${STAGES[from]}」 부터${force ? ' · 그대로 맞춘다' : ''}` })
      for (let k = from; k < 4; k++) j.stages[k] = { state: 'wait' }
      j.order = ++order
      q.line(j, 'sys', j.msg)
      save()
      Promise.resolve().then(() => run(j, { from, force })).catch((e) => {
        if (!isFinal(j)) q.end(j, e?.cancelled ? 'cancel' : 'fail', e?.message || String(e))
      })
      return j
    },
    // 기다리는 일의 차례 — 맨 앞으로 · 다른 일 앞으로
    top(id) {
      const j = need(id)
      j.order = Math.min(0, ...q.list().filter((x) => !isFinal(x)).map((x) => x.order)) - 1
      save()
      pump()
      return j
    },
    move(id, beforeId) {
      const j = need(id)
      const b = need(beforeId)
      const ws = q.list().filter((x) => !isFinal(x) && x !== j).sort((a, c) => a.order - c.order)
      const at = ws.indexOf(b)
      ws.splice(at < 0 ? ws.length : at, 0, j)
      ws.forEach((x, k) => { x.order = k + 1 })
      order = Math.max(order, ws.length)
      save()
      pump()
      return j
    },
    // 줄 멈춤 — 도는 일은 지금 단계를 마치고 서고 기다리는 일은 시작하지 않는다 · 풀면 줄 멈춤으로 선 일을 깨운다
    setHold(on) {
      Q.hold = !!on
      for (const j of jobs.values()) {
        const c = ctl.get(j.id)
        if (Q.hold && j.state === 'run') j.state = 'pausing'
        if (!Q.hold && j.state === 'pausing' && !c?.pause) j.state = 'run'
        if (!Q.hold && j.state === 'pause' && j.parked === 'hold' && c?.wake) { j.state = 'run'; c.wake() }
        else if (!Q.hold && j.state === 'pause' && j.parked === 'hold' && runners[j.spec?.type]) q.retry(j.id) // 다시 켠 뒤 — 일을 하는 쪽이 없다
      }
      save()
      pump()
      return { hold: Q.hold }
    },
    setCaps(x = {}) {
      for (const k of Object.keys(lanes)) if (x[k] != null) Q.caps[k] = Math.min(8, Math.max(1, Math.round(Number(x[k]) || 1)))
      save()
      pump()
      return q.caps
    },
    lanes: () => Object.fromEntries(Object.keys(lanes).map((k) => [k, { cap: Q.caps[k], busy: lanes[k].size, wait: waiting.filter((w) => w.lane === k).length }])),
    // 적기 · 읽기
    async flush() {
      if (!file) return
      const cut = Date.now() - keepDays * 864e5
      const all = q.list().sort((a, b) => a.order - b.order)
      const live = all.filter((j) => !isFinal(j))
      const done = all.filter((j) => isFinal(j) && Date.parse(j.endedAt || j.at) >= cut).slice(-keepMax)
      const body = JSON.stringify({ v: 1, hold: Q.hold, caps: Q.caps, order, jobs: [...live, ...done].map((j) => ({ ...j, lines: (j.lines || []).slice(-400) })) })
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file + '.tmp', body)
      await fs.rename(file + '.tmp', file)
    },
    async load() {
      if (!file) return []
      const j0 = await fs.readFile(file, 'utf8').then(JSON.parse, () => null)
      if (!j0 || j0.v !== 1) return []
      Q.hold = !!j0.hold
      Object.assign(Q.caps, j0.caps || {})
      order = Number(j0.order) || 0
      const back = []
      for (const j of j0.jobs || []) {
        if (!j?.id || jobs.has(j.id)) continue
        // 도는 중 · 기다리던 일 — 일을 하는 쪽이 없다 · 멈춤으로 세우고 [이어서] 를 기다린다(그 단계부터 다시)
        if (['run', 'pausing', 'wait'].includes(j.state)) Object.assign(j, { state: 'pause', parked: 'restart', msg: `프로그램이 꺼졌다 — [이어서] 로 「${STAGES[Math.min(j.stage ?? 0, 3)]}」 부터` })
        if (j.state === 'pause') { const s = j.stages?.[Math.min(j.stage ?? 0, 3)]; if (s && s.state !== 'pause') s.state = 'pause' }
        jobs.set(j.id, j)
        order = Math.max(order, j.order || 0)
        back.push(j)
      }
      return back
    },
    // 닫기 — 더 적지 않는다(지운 살림 자리에 다시 쓰지 않게) · 적던 것은 마친다
    async close() {
      closed = true
      clearTimeout(saveT)
      saveT = null
      await saving
    },
    forget(pred) {
      for (const j of q.list()) if (pred(j) && isFinal(j)) jobs.delete(j.id)
      save()
    },
  }
  function need(id) {
    const j = jobs.get(id)
    if (!j) throw Object.assign(new Error('그 일은 이제 없다'), { code: 'E_NOTFOUND' })
    return j
  }
  return q
}
