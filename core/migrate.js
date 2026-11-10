// 이행 판정 — 옛 저장 길의 기록이 지금 글에 어떻게 닿아 있나(저장 승인 P8 · PC5 · P-D21 · P-D45).
//
//   팀(scripts/kmd-migrate.mjs held-put)과 개인 프로그램(server/hub.js pcMigrate)이 같은 판정을 쓴다:
//     itemAt · touchItems  — 넣지 못함 줄 · 건드린 이름이 가리키는 지금 항목
//     laterMap · laterOf   — 값이 낡음(그 기록 뒤에 같은 항목을 고친 들어간 기록)
//     rowState             — 넣지 못함 줄 하나의 지금 상태(값이 글에 있음 · 낡음 · 열림)
//     needOf · hasAll      — 값이 글에 있나
//   pcPlan — 옛 개인 지식 하나의 이행 계획(P-D45 · 6-2-1): 둠 · 메모 · 남은 안 넣은 기록 · 넣지 못함은 이은 항목 이력(글 그대로) ·
//     이을 항목이 없으면 그 기록의 달 항목(기록 모음). 사람이 고를 것이 없다(개인 지식에는 따로 고를 지식관리자가 없다).

import { sectionOf } from './knowledge.js'
import { parsePut, parseHeld, namesOfRecord, itemKey } from './parts.js'
import { headingMatches } from './sections.js'
import { valuesOf, squeeze, knowledgeParts, mustValues, HASH_RE, REC_ID_RE } from './values.js'
import { RECORDS_DOC_PATH } from './guard.js'

export const MIGRATE_TAG = 'migrate-held'
export const MONTH = (d) => String(d || '').slice(0, 7)
export const needOf = (text) => [...valuesOf(String(text || '').replace(HASH_RE, ' ').replace(REC_ID_RE, ' '))].filter((v) => v.length <= 30)
export const hasAll = (vals, body) => {
  const have = valuesOf(body)
  const flat = squeeze(body)
  return vals.every((v) => have.has(v) || flat.includes(v))
}

// 항목 자리 — 넣지 못함 줄(coord 또는 doc · heading) · 기록의 건드린 이름
export function itemAt(k, { coord, doc, heading }) {
  if (coord) {
    const x = sectionOf(k, String(coord).trim().normalize('NFC'))
    return x?.sec ? { doc: x.doc.path, heading: x.sec.h, sec: x.sec } : null
  }
  const d = doc ? k.byDocPath.get(doc) : null
  const s = d && heading ? d.sections.find((x) => x.h === heading) || d.sections.find((x) => headingMatches(x.h, heading)) : null
  return s ? { doc: d.path, heading: s.h, sec: s } : null
}
export function touchItems(k, w) {
  const out = new Map()
  for (const c of w.touches || []) {
    const t = itemAt(k, { coord: c })
    if (t && !out.has(itemKey(t.doc, t.heading))) out.set(itemKey(t.doc, t.heading), t)
  }
  return [...out.values()]
}
// 값이 낡음(P-D21) — 그 기록 뒤에 같은 항목을 고친 들어간 기록(항목 표지 · 넣은 것 칸)
export function laterMap(k) {
  const m = new Map()
  for (const x of k.works) {
    if (x.state !== 'in' || !(x.tags || []).includes('put')) continue
    for (const p of parsePut(x.body)) {
      const key = itemKey(p.doc, p.heading)
      if (!m.has(key) || m.get(key).date < x.date) m.set(key, { id: x.id, date: x.date })
    }
  }
  return m
}
export function laterOf(k, w, t, later) {
  const a = t.sec.applied && t.sec.applied !== w.id ? k.byWork.get(t.sec.applied) : null
  if (a && a.date > w.date) return a.id
  const p = later.get(itemKey(t.doc, t.heading))
  return p && p.id !== w.id && p.date > w.date ? p.id : null
}
// 넣지 못함 줄 하나의 지금 상태
export function rowState(k, w, r, later) {
  if (r.code === 'names') {
    const { names, forms } = namesOfRecord(w.body)
    const nn = names.filter((n) => !k.vocab.coords.has(n.coord))
    const ff = forms.filter((f) => !(k.forms?.rows || []).some((x) => x.name === f.name))
    return nn.length || ff.length ? { status: 'open', names: nn, forms: ff } : { status: 'in' }
  }
  const t = itemAt(k, r)
  const text = typeof r.content === 'string' ? r.content : Array.isArray(r.edits) ? r.edits.map((e) => String(e?.replace ?? '')).join('\n') : ''
  if (t && squeeze(text)) {
    const vals = needOf(text)
    if (vals.length ? hasAll(vals, t.sec.body) : squeeze(t.sec.body).includes(squeeze(text))) return { status: 'in', target: t }
  } else if (t && Array.isArray(r.edits) && r.edits.length && r.edits.every((e) => squeeze(e?.find ?? ''))) {
    // 지우기만 한 조각(replace 가 빈 글) — 지운 글이 지금 글에 없으면 들어간 것이다
    if (r.edits.every((e) => !squeeze(t.sec.body).includes(squeeze(e.find)))) return { status: 'in', target: t }
  }
  const by = t ? laterOf(k, w, t, later) : null
  return by ? { status: 'stale', target: t, by } : { status: 'open', target: t }
}

// ── 개인 지식 이행(PC5 · P-D45) ──
export const PC_KIND_WORD = { pend: '안 넣은 기록', nowhere: '넣을 곳 없음', kept: '둠', memo: '메모', held: '넣지 못함' }
const PC_STATES = new Set(Object.keys(PC_KIND_WORD))
const oneLine = (s, n) => String(s || '').replace(/\s+/g, ' ').replace(/ — /g, ': ').trim().slice(0, n)

// 옛 개인 지식 하나의 이행 계획 — 기록마다 갈래 · 이은 항목 · 달 항목 · 값이 글에 없는 메모
//   pend 는 부르는 쪽이 옛 바로 넣기를 마지막으로 한 번 돌린 뒤에 남은 것(넣을 곳을 찾지 못함 · 원본이 주인인 문서)
export function pcPlan(k, { now = new Date() } = {}) {
  const later = laterMap(k)
  const recordsDoc = k.byDocPath.get(RECORDS_DOC_PATH) || null
  const recs = []
  const old = k.works.filter((w) => PC_STATES.has(w.state)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  for (const w of old) {
    const x = { id: w.id, date: w.date, title: w.title, kind: w.state, links: [], month: null, off: false, why: null }
    const ts = new Map(touchItems(k, w).map((t) => [itemKey(t.doc, t.heading), t]))
    if (w.state === 'held') for (const r of parseHeld(w.body)) {
      const s = rowState(k, w, r, later)
      if (s.target) ts.set(itemKey(s.target.doc, s.target.heading), s.target)
      if (s.status === 'open') x.off = true
    }
    if (w.state === 'memo') {
      // 값이 본문에 없는 메모 — 본문에 넣지 않는다(그때 주인이 「정해지지 않음」 으로 둔 것) · 알림에 센다(남은 위험 10)
      const vals = mustValues(knowledgeParts(w.body))
      const items = [...ts.values()]
      x.off = vals.length > 0 && !(items.length && hasAll(vals, items.map((t) => t.sec.body).join('\n'))) && !items.some((t) => laterOf(k, w, t, later))
    }
    if (w.state === 'kept') x.why = oneLine(k.kept?.get(w.id)?.reason, 160) || null
    x.links = [...ts.values()].map((t) => ({ doc: t.doc, heading: t.heading }))
    if (!x.links.length) x.month = MONTH(w.date)
    recs.push(x)
  }
  const months = new Set(recs.filter((x) => x.month).map((x) => x.month))
  // 기록 모음이 없으면 세운다(이번 달 항목으로 · 이행 기록이 그 항목에 잇는다)
  if (!recordsDoc) months.add(MONTH(localMonth(now)))
  const n = (kind) => recs.filter((x) => x.kind === kind).length
  const sum = { pend: n('pend'), nowhere: n('nowhere'), kept: n('kept'), memo: n('memo'), held: n('held'), memoOff: recs.filter((x) => x.kind === 'memo' && x.off).length, linked: recs.filter((x) => x.links.length).length, month: recs.filter((x) => x.month).length, left: recs.length, recordsDoc: !!recordsDoc }
  return { sum, recs, months: [...months].sort(), recordsDoc }
}
const localMonth = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// 이행 기록 글의 기록마다 한 줄
export function pcLine(x) {
  const at = [...x.links.map((t) => `${t.doc.replace(/^docs\/|\.md$/g, '')} › ${t.heading}`), x.month ? `기록 모음 › ${x.month}` : null].filter(Boolean).join(' · ')
  return `- ${x.id}: ${PC_KIND_WORD[x.kind]}${x.why ? ` · 둔 까닭: ${x.why}` : ''}${x.off ? ' · 값이 본문에 없음' : ''} · ${at}`
}
