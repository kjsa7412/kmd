// 저장 측정 읽기(K12-2 · K12-4 · 설계 9절) — 팀 서버가 저장마다 덧붙인 <data>/savelog/<지식>.jsonl 을 읽어 표를 낸다.
//
//   node scripts/savelog.mjs <data 폴더> [--kn dpms] [--since 2026-11-10] [--until 2026-11-24] [--ch session,bulk] [--json] [--trend] [--root <지식 폴더>]
//
//   채널마다  저장 수 · 조각 수 · 조각 통과율(넣음 / 조각) · 걸린 까닭 상위 10 · E_CONFLICT 수 ·
//             다시 넣은 비율(같은 사람 · 같은 자리가 넣지 못함 또는 E_CONFLICT 뒤 30분 안에 넣음이 된 비율) ·
//             자리당 시간(ms / 조각의 중앙값) · 비용(cost.usd 합 · 자리당) · 스킬 판(kit)
//   동시 쓰기  conflictWith 가 있는 줄을 「채널 ↔ 그 항목에 먼저 넣은 쪽」 짝으로 센다(K12-4)
//   비교 기준  같은 data 폴더의 정리 장부 tidy/*.json 이 있으면 정리의 넣음 비율 · 자리당 시간을 옆에 낸다
//   목표       통과 70% 이상 · 자리당 1분대(2분 안)
//   --trend    지식 폴더를 읽어 날마다 열린 넣지 못함 · 메모 수(K12-3 「쌓이나 줄어드나」) · 지식 폴더는 --root, 없으면 data 폴더의 위
//
// 읽기만 한다(188 에서도 사람이 돌린다: node /opt/kmd/scripts/savelog.mjs /srv/kmd/.kmd). 아무것도 쓰지 않는다.

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listKnowledge, loadKnowledge } from '../core/knowledge.js'
import { isReservedUser } from '../core/names.js'

export const GOAL = { pass: 0.7, msPerSpot: 120_000 }
const RETRY_MS = 30 * 60_000
const DAY = /^\d{4}-\d{2}-\d{2}$/

const timeOf = (at) => Date.parse(String(at || '').replace(' ', 'T'))
const dayOf = (at) => String(at || '').slice(0, 10)
const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function parseArgs(argv) {
  const o = { data: null, kn: null, since: null, until: null, ch: null, json: false, trend: false, root: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => {
      const v = argv[++i]
      if (v == null || v.startsWith('--')) throw new Error(`${a} 뒤에 값이 없다`)
      return v
    }
    if (a === '--kn') o.kn = val()
    else if (a === '--since' || a === '--until') {
      const v = val()
      if (!DAY.test(v)) throw new Error(`${a} 는 YYYY-MM-DD 다: ${v}`)
      o[a.slice(2)] = v
    } else if (a === '--ch') o.ch = val().split(',').map((x) => x.trim()).filter(Boolean)
    else if (a === '--json') o.json = true
    else if (a === '--trend') o.trend = true
    else if (a === '--root') o.root = val()
    else if (a.startsWith('--')) throw new Error(`모르는 칸: ${a}`)
    else if (!o.data) o.data = a
    else throw new Error(`data 폴더는 하나다: ${a}`)
  }
  if (!o.data) throw new Error('쓰는 법: node scripts/savelog.mjs <data 폴더> [--kn id] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--ch session,bulk] [--json] [--trend] [--root 지식 폴더]')
  return o
}

const inRange = (day, { since, until }) => (!since || day >= since) && (!until || day <= until)

// 줄 읽기 — 지식마다 <id>.jsonl 과 돌려 둔 <id>.jsonl.1 · 깨진 줄은 세기만 한다
export async function readLines(data, opt = {}) {
  const dir = path.join(data, 'savelog')
  const names = await fs.readdir(dir).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)))
  const lines = []
  let broken = 0
  for (const n of names.sort()) {
    const m = n.match(/^(.+)\.jsonl(\.1)?$/)
    if (!m) continue
    let kn
    try { kn = decodeURIComponent(m[1]) } catch { continue }
    if (opt.kn && kn !== opt.kn) continue
    const text = await fs.readFile(path.join(dir, n), 'utf8')
    for (const t of text.split('\n')) {
      if (!t.trim()) continue
      let x
      try { x = JSON.parse(t) } catch { broken++; continue }
      if (!x || typeof x !== 'object') { broken++; continue }
      x.kn ||= kn
      if (!inRange(dayOf(x.at), opt)) continue
      if (opt.ch && !opt.ch.includes(x.ch)) continue
      lines.push(x)
    }
  }
  lines.sort((a, b) => timeOf(a.at) - timeOf(b.at))
  return { lines, broken }
}

// 정리 장부(비교 기준) — tidy/<id>.json 의 지난 정리 · 넣음(left 아닌 줄) 비율 · 자리 시간 중앙값
export async function readTidy(data, opt = {}) {
  const dir = path.join(data, 'tidy')
  const names = await fs.readdir(dir).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)))
  let rows = 0
  let put = 0
  let runs = 0
  const ms = []
  for (const n of names) {
    const m = n.match(/^(.+)\.json$/)
    if (!m) continue
    let kn
    try { kn = decodeURIComponent(m[1]) } catch { continue }
    if (opt.kn && kn !== opt.kn) continue
    let all
    try { all = JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')) } catch (e) {
      console.error(`정리 장부를 읽지 못해 비교에서 뺀다 ${n}: ${e.message}`)
      continue
    }
    for (const r of Array.isArray(all) ? all : []) {
      if (!r || !inRange(dayOf(r.at), opt)) continue
      runs++
      for (const x of Array.isArray(r.rows) ? r.rows : []) {
        if (!x || x.kind === 'stopped') continue
        rows++
        if (x.kind !== 'left') put++
      }
      for (const t of Array.isArray(r.took) ? r.took : []) if (Number.isFinite(t?.ms)) ms.push(t.ms)
    }
  }
  if (!runs) return null
  return { runs, spots: rows, put, pass: rows ? put / rows : null, msPerSpot: median(ms) }
}

const whoOf = (by, user) => (by == null ? '모름' : isReservedUser(by) ? 'kmd(가져올 곳 · 정리)' : by === user ? '같은 사람' : '다른 사람')

// 줄 → 채널마다 셈
export function summarize(lines) {
  const chans = new Map()
  const of = (ch) => {
    if (!chans.has(ch)) chans.set(ch, { ch, saves: 0, same: 0, memo: 0, pieces: 0, put: 0, held: 0, errors: {}, reasons: new Map(), perSpot: [], ms: [], usd: 0, calls: 0, costPieces: 0, kits: {}, retry: { events: 0, done: 0 } })
    return chans.get(ch)
  }
  const pairs = new Map()
  // 다시 넣은 비율 — 넣지 못함 · E_CONFLICT 자리를 사건으로, 뒤 30분 안의 같은 사람 · 같은 지식 줄이 그 자리를 넣었나
  const putIn = (x, coord) => (Array.isArray(x.ok) ? x.ok.includes(coord) : (x.put || 0) > 0 && !(x.held || []).some((h) => h.coord === coord) && !(x.stale || []).includes(coord))
  lines.forEach((x, i) => {
    const c = of(x.ch || '모름')
    const kit = x.kit == null ? '없음' : String(x.kit)
    c.kits[kit] = (c.kits[kit] || 0) + 1
    for (const w of Array.isArray(x.conflictWith) ? x.conflictWith : []) {
      const key = `${x.ch || '모름'} ↔ ${whoOf(w?.by, x.user)}`
      pairs.set(key, (pairs.get(key) || 0) + 1)
    }
    const misses = x.err ? (x.err === 'E_CONFLICT' ? (x.stale || []) : []) : (x.held || []).map((h) => h.coord).filter(Boolean)
    for (const coord of new Set(misses)) {
      c.retry.events++
      const t = timeOf(x.at)
      if (lines.slice(i + 1).some((y) => y.user === x.user && y.kn === x.kn && !y.err && timeOf(y.at) - t <= RETRY_MS && timeOf(y.at) >= t && putIn(y, coord))) c.retry.done++
    }
    if (x.err) {
      c.errors[x.err] = (c.errors[x.err] || 0) + 1
      return
    }
    c.saves++
    if (x.same) { c.same++; return }
    if (x.memo) c.memo++
    const n = Number(x.n) || 0
    c.pieces += n
    c.put += Number(x.put) || 0
    c.held += (x.held || []).length
    for (const h of x.held || []) {
      const key = `${h.code || '?'}${h.why ? ' · ' + String(h.why).slice(0, 40) : ''}`
      c.reasons.set(key, (c.reasons.get(key) || 0) + 1)
    }
    if (Number.isFinite(x.ms)) {
      c.ms.push(x.ms)
      if (n > 0) c.perSpot.push(x.ms / n)
    }
    if (x.cost && Number.isFinite(x.cost.usd)) {
      c.usd += x.cost.usd
      c.calls += Number(x.cost.calls) || 0
      c.costPieces += n
    }
  })
  const channels = [...chans.values()].map((c) => ({
    ch: c.ch,
    saves: c.saves,
    same: c.same,
    memo: c.memo,
    pieces: c.pieces,
    put: c.put,
    held: c.held,
    pass: c.pieces ? c.put / c.pieces : null,
    conflicts: c.errors.E_CONFLICT || 0,
    errors: c.errors,
    reasons: [...c.reasons.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([why, n]) => ({ why, n })),
    retry: { ...c.retry, ratio: c.retry.events ? c.retry.done / c.retry.events : null },
    msMedian: median(c.ms),
    msPerSpot: median(c.perSpot),
    cost: c.calls || c.usd ? { usd: c.usd, calls: c.calls, perSpot: c.costPieces ? c.usd / c.costPieces : null } : null,
    kits: c.kits,
    goal: { pass: c.pieces ? c.put / c.pieces >= GOAL.pass : null, time: c.perSpot.length ? median(c.perSpot) <= GOAL.msPerSpot : null },
  })).sort((a, b) => b.saves - a.saves || a.ch.localeCompare(b.ch))
  return { lines: lines.length, channels, pairs: [...pairs.entries()].sort((a, b) => b[1] - a[1]).map(([pair, n]) => ({ pair, n })) }
}

// 날마다 열린 넣지 못함 · 메모(K12-3) — 지식 폴더의 기록에서. 바로잡힘(나중 기록이 fixes 로 가리킴 · 그 기록이 held · touches-fix 가 아님) · 정리 판정 「두기」(kept)는 그날 닫힌다
export async function trend(root, opt = {}) {
  const items = []
  for (const meta of await listKnowledge(root)) {
    if (opt.kn && meta.id !== opt.kn) continue
    const k = await loadKnowledge(meta)
    const all = [...k.works, ...(k.logs || [])]
    const closed = new Map()
    const close = (x, d) => { if (!closed.has(x) || d < closed.get(x)) closed.set(x, d) }
    for (const w of all) {
      if (!w.fixes?.length || w.tags.includes('held') || w.tags.includes('touches-fix')) continue
      for (const x of w.fixes) close(x, dayOf(w.date))
    }
    // 정리 판정 「두기」(kept · 거두기로 걷히지 않은 것)도 그날 닫힌다 — 화면 · brief 의 넣지 못함 셈(recordState)과 같게
    for (const [x, v] of k.kept || []) { const by = k.byWork?.get(v.by); if (by) close(x, dayOf(by.date)) }
    for (const w of k.works) {
      const kind = w.tags.includes('held') ? 'held' : w.tags.includes('memo') ? 'memo' : null
      if (kind) items.push({ kind, open: dayOf(w.date), close: closed.get(w.id) || null })
    }
  }
  if (!items.length) return []
  const first = opt.since || items.map((x) => x.open).sort()[0]
  const last = opt.until || new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
  const out = []
  for (let d = new Date(first + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10)
    const open = (kind) => items.filter((x) => x.kind === kind && x.open <= day && !(x.close && x.close <= day)).length
    out.push({ day, held: open('held'), memo: open('memo') })
    if (out.length > 3660) break
  }
  return out
}

const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`)
const sec = (ms) => (ms == null ? '-' : ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}분` : `${(ms / 1000).toFixed(1)}초`)
const mark = (b) => (b == null ? '' : b ? ' ✓' : ' ✗')
const pad = (s, n) => { s = String(s); const w = [...s].reduce((a, ch) => a + (/[ᄀ-ￜ]/.test(ch) ? 2 : 1), 0); return s + ' '.repeat(Math.max(0, n - w)) }

export function render(sum, { tidy = null, broken = 0, trendRows = null, opt = {} } = {}) {
  const out = []
  const range = [opt.kn ? `지식 ${opt.kn}` : '모든 지식', opt.since || opt.until ? `${opt.since || '…'} ~ ${opt.until || '…'}` : '모든 날', opt.ch ? `채널 ${opt.ch.join(',')}` : null].filter(Boolean).join(' · ')
  out.push(`저장 측정(savelog) — ${range} · 줄 ${sum.lines}${broken ? ` · 깨진 줄 ${broken}` : ''}`)
  out.push(`목표: 조각 통과 ${pct(GOAL.pass)} 이상 · 자리당 ${sec(GOAL.msPerSpot)} 안`)
  out.push('')
  const head = ['채널', '저장', '같은것', '메모', '조각', '넣음', '통과율', '넣지못함', 'E_CONFLICT', '다시넣음', '자리당', '비용']
  const W = [10, 6, 6, 5, 6, 6, 9, 8, 10, 12, 10, 14]
  out.push(head.map((h, i) => pad(h, W[i])).join(' '))
  for (const c of sum.channels) {
    out.push([c.ch, c.saves, c.same, c.memo, c.pieces, c.put, pct(c.pass) + mark(c.goal.pass), c.held, c.conflicts, c.retry.events ? `${pct(c.retry.ratio)} (${c.retry.done}/${c.retry.events})` : '-', sec(c.msPerSpot) + mark(c.goal.time), c.cost ? `$${c.cost.usd.toFixed(2)}${c.cost.perSpot != null ? ` · $${c.cost.perSpot.toFixed(3)}/자리` : ''}` : '-'].map((v, i) => pad(v, W[i])).join(' '))
  }
  if (!sum.channels.length) out.push('(줄이 없다)')
  if (tidy) {
    out.push('')
    out.push(`비교 기준 · 정리 장부(tidy/): 정리 ${tidy.runs}번 · 자리 ${tidy.spots} · 넣음 ${tidy.put} · 넣음 비율 ${pct(tidy.pass)} · 자리당 ${sec(tidy.msPerSpot)} · 비용은 장부에 없다`)
  }
  for (const c of sum.channels) {
    const errs = Object.entries(c.errors).map(([e, n]) => `${e} ${n}`).join(' · ')
    const kits = Object.entries(c.kits).map(([k, n]) => `${k}: ${n}`).join(' · ')
    if (!c.reasons.length && !errs) continue
    out.push('')
    out.push(`[${c.ch}] 걸린 까닭 상위${errs ? ` · 저장 전체 실패 ${errs}` : ''} · 스킬 판 ${kits}`)
    for (const r of c.reasons) out.push(`  ${String(r.n).padStart(4)}  ${r.why}`)
  }
  out.push('')
  out.push(`동시 쓰기(K12-4): ${sum.pairs.length ? sum.pairs.map((p) => `${p.pair} ${p.n}`).join(' · ') : '겹친 줄 없음'}`)
  if (trendRows) {
    out.push('')
    out.push('날마다 열린 넣지 못함 · 메모(K12-3)')
    for (const r of trendRows) out.push(`  ${r.day}  넣지 못함 ${String(r.held).padStart(3)}  메모 ${String(r.memo).padStart(3)}`)
    if (!trendRows.length) out.push('  (넣지 못함 · 메모 기록이 없다)')
  }
  return out.map((l) => l.trimEnd()).join('\n')
}

export async function main(argv) {
  const opt = parseArgs(argv)
  const { lines, broken } = await readLines(opt.data, opt)
  const sum = summarize(lines)
  const tidy = await readTidy(opt.data, opt)
  const root = opt.root || (path.basename(path.resolve(opt.data)) === '.kmd' ? path.dirname(path.resolve(opt.data)) : null)
  if (opt.trend && !root) throw new Error('--trend 는 지식 폴더가 있어야 한다: --root <지식 폴더>')
  const trendRows = opt.trend ? await trend(root, opt) : null
  if (opt.json) return JSON.stringify({ ...sum, broken, tidy, ...(trendRows ? { trend: trendRows } : {}) }, null, 1)
  return render(sum, { tidy, broken, trendRows, opt })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((t) => console.log(t), (e) => { console.error(e.message); process.exitCode = 1 })
}
