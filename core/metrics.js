// 점검 지표(저장 승인 설계 P-D27 · P-D28 · P-D37 · P10) — 저장 측정 줄(savelog)과 기록 끝 「새로 세움」 표지(fresh)를 지식 · 기간으로 센다.
//   지표 탭(GET /api/k/:id/metrics · 팀 지식관리자 · 개인 주인)과 scripts/savelog.mjs 가 같은 함수를 쓴다.
//   할 일 목록이 아니다 — 「봤음」 장부 · 배지 없음. 로직(프롬프트 · FIX · 규칙 길 · 검사 기준) 개선의 근거다.
import fs from 'node:fs/promises'
import path from 'node:path'
import { freshItems, FRESH_LABEL } from './parts.js'

export const METRIC_DAYS = Object.freeze([7, 14, 30, 90])
export const METRIC_DEFAULT = 14 // Q15
// 지표 줄 차례 — fresh 새로 생긴 것 · accepted 받아들인 경고 · warned 무인 값 경고 · fail 무인 실패 · fix FIX 번 수 · rounds 다시 제안 수
//   fail(지식 생성 하네스 H4b · 옛 「규칙 길」 줄을 갈음한다): 첫 시도에 못 넘어 다시 시도로 간 무인 일감 / 무인 일감 · 끝내 실패로 남은 수는 codes 의 「끝내 실패」.
//   측정 줄의 옛 rule 칸(규칙 길로 들어간 저장)은 읽지 않는다(옛 줄은 그대로 둔다)
export const METRIC_KEYS = Object.freeze(['fresh', 'accepted', 'warned', 'fail', 'fix', 'rounds'])
export const FAIL_FINAL = '끝내 실패'
const RECS_MAX = 50

const pad = (n) => String(n).padStart(2, '0')
const dayOf = (at) => String(at || '').slice(0, 10)
export const daysOf = (v) => { const n = Number(v); return METRIC_DAYS.includes(n) ? n : METRIC_DEFAULT }
// 기간의 첫날(그날 포함) — now 에서 days-1 일 앞(오늘 포함 days 일)
export function sinceOf(days, now = new Date()) {
  const d = new Date(now.getTime() - (days - 1) * 86_400_000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 지식 하나의 측정 줄 — <data>/savelog/<id>.jsonl(.1) · since 부터 · 깨진 줄은 세기만
export async function readKnLines(dataDir, id, since) {
  const dir = path.join(dataDir, 'savelog')
  const base = path.join(dir, `${encodeURIComponent(id)}.jsonl`)
  const lines = []
  let broken = 0
  for (const f of [base + '.1', base]) {
    let text
    try { text = await fs.readFile(f, 'utf8') } catch (e) { if (e.code === 'ENOENT') continue; throw e }
    for (const t of text.split('\n')) {
      if (!t.trim()) continue
      let x
      try { x = JSON.parse(t) } catch { broken++; continue }
      if (!x || typeof x !== 'object' || Array.isArray(x)) { broken++; continue }
      if (since && dayOf(x.at) < since) continue
      lines.push(x)
    }
  }
  return { lines, broken }
}

// 줄 → 지표 줄 여섯. works(지식의 기록 · 있으면) — 기록 이름 · fresh 표지
//   줄 하나 { key, n(수), base(분모 · 없으면 null), codes{ code: n }, recs[{ rec, at, ch, n, codes? }] }
export function metricsOf(lines, { works = null, days = METRIC_DEFAULT, now = new Date(), since = sinceOf(days, now) } = {}) {
  const row = (key) => ({ key, n: 0, base: null, codes: {}, recs: [] })
  const R = Object.fromEntries(METRIC_KEYS.map((k) => [k, row(k)]))
  // 기록 목록은 다 담고 끝에서 새 것 위로 정렬해 자른다(줄은 옛 것부터 온다 · 검토 1)
  const addRec = (r, x, n, codes) => { if (x.rec) r.recs.push({ rec: String(x.rec), at: String(x.at || ''), ch: String(x.ch || ''), n, ...(codes ? { codes } : {}) }) }
  const count = (r, codes) => { for (const c of codes) r.codes[c] = (r.codes[c] || 0) + 1 }
  let human = 0, un = 0, saves = 0, finals = 0
  for (const x of lines) {
    // 무인 실패 줄(다시 시도 · 실패 일감 · H-D30) — 첫 시도의 실패와 끝내 실패를 센다
    if (x.mode === 'approve' && x.fail && typeof x.fail === 'object') {
      if (Number(x.fail.n) === 1) { R.fail.n++; count(R.fail, [String(x.fail.code || 'fail').slice(0, 40)]) }
      if (x.fail.final) { finals++; count(R.fail, [FAIL_FINAL]) }
      continue
    }
    if (x.mode !== 'approve' || x.err || x.same) continue
    saves++
    const acc = Array.isArray(x.accepted) ? x.accepted.map(String) : null
    const warned = Array.isArray(x.warned) ? x.warned.map(String) : null
    // 사람 채널 줄은 accepted 칸(빈 배열이어도)이 · 무인 채널 줄은 warned 칸이 있다
    if (acc) human++
    if (warned) un++
    if (acc && acc.length) { R.accepted.n++; count(R.accepted, acc); addRec(R.accepted, x, acc.length, acc) }
    if (warned && warned.length) { R.warned.n++; count(R.warned, warned); addRec(R.warned, x, warned.length, warned) }
    const fix = Number(x.fix) || 0
    if (fix > 0) { R.fix.n += fix; addRec(R.fix, x, fix) }
    const rounds = Number(x.rounds) || 0
    if (rounds > 1) { R.rounds.n += rounds - 1; addRec(R.rounds, x, rounds - 1) }
  }
  R.accepted.base = human
  R.warned.base = un
  R.fail.base = un + finals // 무인 일감 = 들어간 무인 저장 + 끝내 실패
  R.fix.base = un
  R.rounds.base = human
  // 새로 생긴 것 — 기간 안 기록 끝 「새로 세움」(fresh 표지 · 14일 뒤 저절로 떨어지는 것과 같은 읽기)
  if (works) {
    // 측정 줄과 같은 첫날(since · 그날 0시부터)로 한 번 더 거른다(freshItems 는 시각 단위 · 검토 5)
    const fr = freshItems(works, { now, days: days + 1 }).filter((f) => String(f.date).slice(0, 10) >= since)
    R.fresh.n = fr.length
    for (const f of fr) R.fresh.codes[f.kind] = (R.fresh.codes[f.kind] || 0) + 1
    const by = new Map()
    for (const f of fr) { const e = by.get(f.rec) || { rec: f.rec, at: f.date, ch: '', n: 0, names: [] }; e.n++; if (e.names.length < 5) e.names.push(`${FRESH_LABEL[f.kind] || f.kind} ${f.name}`); by.set(f.rec, e) }
    R.fresh.recs = [...by.values()]
  } else {
    for (const x of lines) if (x.mode === 'approve' && !x.err && !x.same && Number(x.fresh) > 0) { R.fresh.n += Number(x.fresh); addRec(R.fresh, x, Number(x.fresh)) }
  }
  const title = works ? new Map(works.map((w) => [w.id, w.title || ''])) : null
  for (const r of Object.values(R)) {
    r.recs.sort((a, b) => String(b.at).localeCompare(String(a.at)))
    r.recs = r.recs.slice(0, RECS_MAX)
    if (title) for (const e of r.recs) e.title = title.has(e.rec) ? title.get(e.rec) : null
  }
  return { saves, human, unattended: un, rows: METRIC_KEYS.map((k) => R[k]) }
}
