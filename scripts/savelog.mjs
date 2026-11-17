// 저장 측정 읽기(K12-2 · K12-4 · 설계 9절) — 팀 서버가 저장마다 덧붙인 <data>/savelog/<지식>.jsonl 을 읽어 표를 낸다.
//
//   node scripts/savelog.mjs <data 폴더> [--kn dpms] [--since 2026-11-10] [--until 2026-11-24] [--ch session,bulk] [--json]
//
//   채널마다  저장 수 · 항목 수 · 항목 통과율(넣음 / 항목) · 걸린 까닭 상위 10 · E_CONFLICT 수 ·
//             다시 넣은 비율(같은 사람 · 같은 자리가 넣지 못함 또는 E_CONFLICT 뒤 30분 안에 넣음이 된 비율) ·
//             자리당 시간(ms / 항목의 중앙값) · 비용(cost.usd 합 · 자리당) · 스킬 판(kit)
//   동시 쓰기  conflictWith 가 있는 줄을 「채널 ↔ 그 항목에 먼저 넣은 쪽」 짝으로 센다(K12-4)
//   비교 기준  같은 data 폴더의 정리 장부 tidy/*.json 이 있으면 정리의 넣음 비율 · 자리당 시간을 옆에 낸다
//   목표       통과 70% 이상 · 자리당 1분대(2분 안)
//   approve    받아들인 경고 · 다시 제안 · 무인 값 경고(code 별) · 규칙 길(까닭) · FIX 번 수 · 다시 대기 · 입력 오류(code) — 같은 측정 줄(P-D37)을 지표 탭(GET /api/k/:id/metrics · core/metrics.js)도 읽는다(탭은 그 가운데 줄 여섯 · 입력 오류 · 다시 대기는 이 표에만)
//
// 읽기만 한다(188 에서도 사람이 돌린다: node /opt/kmd/scripts/savelog.mjs /srv/kmd/.kmd). 아무것도 쓰지 않는다.

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isReservedUser } from '../core/names.js'

// 문턱(P-D37 · Q2): 규칙 길 10% · 무인 값 경고 20% 를 넘는 채널부터 고친다
export const GOAL = { pass: 0.7, msPerSpot: 120_000, rule: 0.1, fail: 0.1, warned: 0.2 }
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
  const o = { data: null, kn: null, since: null, until: null, ch: null, json: false }
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
    else if (a.startsWith('--')) throw new Error(`모르는 칸: ${a}`)
    else if (!o.data) o.data = a
    else throw new Error(`data 폴더는 하나다: ${a}`)
  }
  if (!o.data) throw new Error('쓰는 법: node scripts/savelog.mjs <data 폴더> [--kn id] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--ch session,bulk] [--json]')
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
    if (!chans.has(ch)) chans.set(ch, { ch, saves: 0, same: 0, memo: 0, pieces: 0, put: 0, held: 0, errors: {}, reasons: new Map(), perSpot: [], ms: [], usd: 0, calls: 0, costPieces: 0, kits: {}, retry: { events: 0, done: 0 }, ap: { lines: 0, saves: 0, unproposed: 0, accepted: {}, acceptedSaves: 0, rounds: 0, linked: 0, fresh: 0, human: 0, un: 0, warned: {}, warnedSaves: 0, rule: 0, rules: {}, fail: 0, failFinal: 0, fails: {}, dup: 0, fix: 0, conflict: 0, code: {} } })
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
    // approve 모드 줄(저장 승인 설계 P-D37 · P3) — 승인 없음(unproposed) · 받아들인 경고(code 별) · 다시 제안 수 · 글 그대로 이음 · 새로 세움
    const ap = x.mode === 'approve' ? c.ap : null
    if (ap) {
      ap.lines++
      if (x.unproposed) ap.unproposed++
      for (const code of Array.isArray(x.code) ? x.code : []) ap.code[code] = (ap.code[code] || 0) + 1
    }
    // 무인 실패(지식 생성 하네스 H4b) — 첫 시도에 못 넘은 일감 · 끝내 실패로 남은 일감 · 까닭 코드. 같은 것 가림(H4c-2)은 dup
    if (ap && x.fail && typeof x.fail === 'object') {
      if (Number(x.fail.n) === 1) { ap.fail++; const r = String(x.fail.code || 'fail').slice(0, 40); ap.fails[r] = (ap.fails[r] || 0) + 1 }
      if (x.fail.final) ap.failFinal++
    }
    if (ap && x.dup) ap.dup++
    if (x.err) {
      c.errors[x.err] = (c.errors[x.err] || 0) + 1
      return
    }
    if (ap && !x.same) {
      ap.saves++
      const acc = Array.isArray(x.accepted) ? x.accepted : []
      if (acc.length) ap.acceptedSaves++
      for (const code of acc) ap.accepted[code] = (ap.accepted[code] || 0) + 1
      ap.rounds += Number(x.rounds) || 0
      ap.linked += Number(x.linked) || 0
      ap.fresh += Number(x.fresh) || 0
      // 지표(P-D37 · P10) — 사람 채널(accepted 칸) · 무인 채널(warned 칸) · 규칙 길 · FIX 번 수 · 다시 대기
      if (Array.isArray(x.accepted)) ap.human++
      if (Array.isArray(x.warned)) {
        ap.un++
        if (x.warned.length) ap.warnedSaves++
        for (const code of x.warned) ap.warned[code] = (ap.warned[code] || 0) + 1
      }
      if (x.rule) { ap.rule++; const r = String(x.rule).slice(0, 40); ap.rules[r] = (ap.rules[r] || 0) + 1 }
      ap.fix += Number(x.fix) || 0
      ap.conflict += Number(x.conflict) || 0
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
    ...(c.ap.lines ? { approve: { ...c.ap, acceptedRatio: c.ap.human ? c.ap.acceptedSaves / c.ap.human : null, warnedRatio: c.ap.un ? c.ap.warnedSaves / c.ap.un : null, ruleRatio: c.ap.un ? c.ap.rule / c.ap.un : null, failRatio: c.ap.un + c.ap.failFinal ? c.ap.fail / (c.ap.un + c.ap.failFinal) : null, roundsPerSave: c.ap.saves ? c.ap.rounds / c.ap.saves : null } } : {}),
    goal: { pass: c.pieces ? c.put / c.pieces >= GOAL.pass : null, time: c.perSpot.length ? median(c.perSpot) <= GOAL.msPerSpot : null },
  })).sort((a, b) => b.saves - a.saves || a.ch.localeCompare(b.ch))
  return { lines: lines.length, channels, pairs: [...pairs.entries()].sort((a, b) => b[1] - a[1]).map(([pair, n]) => ({ pair, n })) }
}

const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`)
const sec = (ms) => (ms == null ? '-' : ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}분` : `${(ms / 1000).toFixed(1)}초`)
const mark = (b) => (b == null ? '' : b ? ' ✓' : ' ✗')
const pad = (s, n) => { s = String(s); const w = [...s].reduce((a, ch) => a + (/[ᄀ-ￜ]/.test(ch) ? 2 : 1), 0); return s + ' '.repeat(Math.max(0, n - w)) }

export function render(sum, { tidy = null, broken = 0, opt = {} } = {}) {
  const out = []
  const range = [opt.kn ? `지식 ${opt.kn}` : '모든 지식', opt.since || opt.until ? `${opt.since || '…'} ~ ${opt.until || '…'}` : '모든 날', opt.ch ? `채널 ${opt.ch.join(',')}` : null].filter(Boolean).join(' · ')
  out.push(`저장 측정(savelog) — ${range} · 줄 ${sum.lines}${broken ? ` · 깨진 줄 ${broken}` : ''}`)
  out.push(`목표: 항목 통과 ${pct(GOAL.pass)} 이상 · 자리당 ${sec(GOAL.msPerSpot)} 안`)
  out.push('')
  const head = ['채널', '저장', '같은것', '메모', '항목', '넣음', '통과율', '넣지못함', 'E_CONFLICT', '다시넣음', '자리당', '비용']
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
    if (c.approve) {
      const a = c.approve
      out.push('')
      out.push(`[${c.ch}] approve: 들어감 ${a.saves} · 승인 없음 ${a.unproposed} · 받아들인 경고가 든 저장 ${pct(a.acceptedRatio)}(${Object.entries(a.accepted).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'}) · 다시 제안 ${a.roundsPerSave == null ? '-' : a.roundsPerSave.toFixed(1)}/저장 · 글 그대로 이음 ${a.linked} · 새로 세움 ${a.fresh}`)
      if (a.un) out.push(`[${c.ch}] 무인: 저장 ${a.un} · 무인 값 경고 ${pct(a.warnedRatio)}${a.warnedRatio != null && a.warnedRatio > GOAL.warned ? ' ✗' : ''}(${Object.entries(a.warned).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'}) · 무인 실패 ${pct(a.failRatio)}${a.failRatio != null && a.failRatio > GOAL.fail ? ' ✗' : ''}(${Object.entries(a.fails).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'} · 끝내 실패 ${a.failFinal})${a.rule ? ` · 옛 규칙 길 ${a.rule}` : ''}${a.dup ? ` · 같은 것 가림 ${a.dup}` : ''} · FIX ${a.fix}번 · 다시 대기 ${a.conflict}`)
      if (Object.keys(a.code).length) out.push(`[${c.ch}] 입력 오류: ${Object.entries(a.code).map(([k, n]) => `${k} ${n}`).join(' · ')}`)
    }
    if (!c.reasons.length && !errs) continue
    out.push('')
    out.push(`[${c.ch}] 걸린 까닭 상위${errs ? ` · 저장 전체 실패 ${errs}` : ''} · 스킬 판 ${kits}`)
    for (const r of c.reasons) out.push(`  ${String(r.n).padStart(4)}  ${r.why}`)
  }
  out.push('')
  out.push(`동시 쓰기(K12-4): ${sum.pairs.length ? sum.pairs.map((p) => `${p.pair} ${p.n}`).join(' · ') : '겹친 줄 없음'}`)
  return out.map((l) => l.trimEnd()).join('\n')
}

export async function main(argv) {
  const opt = parseArgs(argv)
  const { lines, broken } = await readLines(opt.data, opt)
  const sum = summarize(lines)
  const tidy = await readTidy(opt.data, opt)
  if (opt.json) return JSON.stringify({ ...sum, broken, tidy }, null, 1)
  return render(sum, { tidy, broken, opt })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((t) => console.log(t), (e) => { console.error(e.message); process.exitCode = 1 })
}
