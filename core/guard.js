// 지식 생성 가드 — 지식이 들어오는 모든 길(세션 · 화면 · 받기 · 가져오기 · 가져올 곳 · 감시 · 정리 …)이 이 하나를 부른다.
// 팀 서버와 개인 프로그램이 같은 판정을 쓴다. 판정만 하고 파일은 쓰지 않는다(docs/kmd_문서_작성기준.md 9절).
//
//   G1 모양  — 이름은 `종류:값`. 새 이름은 종류가 영문 소문자 또는 한글 · 값에 빈칸 · 제어 글자가 없고 60자 안
//   G2 등재  — 기록이 건드린 이름은 이름 장부에 있거나 같은 묶음에서 세운 것. 폐기된 이름은 이어 둔 새 이름으로
//   G3 자리  — 이름도 자리(at/ · ingest/)도 없는 기록은 까닭(touchesEmpty)이 있어야 한다
//   G4 새 문서 — 갈래 장부(`_forms.md`)의 갈래 · 폴더 · 머리 꼴로만. 장부가 없으면 기본 갈래(회의록 · 장애 대응 · 보고서)와 파일 이름 조각 검사
//
// 길은 둘이다.
//   strict(거절형)     사람 · 세션이 그 자리에서 고칠 수 있는 길 — 어기면 errors · 후보를 같이 말한다
//   hold(붙잡아 두기)  밖에서 온 것 · kmd 자신의 쓰기 — 거절하면 잃으므로 바로잡을 것은 바로잡고(fixes) 나머지는 상태로 남긴다

import { nfc } from './text.js'
import { isLogRecord } from './names.js'

export const TYPE_RE = /^(?:[a-z][a-z0-9_-]{0,23}|[가-힣][A-Za-z0-9가-힣_-]{0,23})$/
export const NEW_VALUE_RE = /^[^\s\x00-\x1f`|]{1,60}$/
const BAD_NAMES = new Set(['__proto__', 'prototype', 'constructor'])
export const EMPTY_MAX = 200

const norm = (s) => nfc(String(s ?? '')).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
const valueOf = (c) => c.slice(c.indexOf(':') + 1)

// 새 이름 모양 — 맞으면 null · 아니면 까닭
export function newNameWhy(coord) {
  const c = nfc(String(coord ?? '').trim())
  const i = c.indexOf(':')
  if (i < 1) return '이름은 「종류:값」 이다'
  const type = c.slice(0, i)
  const value = c.slice(i + 1)
  if (!TYPE_RE.test(type)) return `종류 「${type}」 는 영문 소문자 또는 한글로 시작하는 24자 안의 낱말이다`
  if (BAD_NAMES.has(type) || BAD_NAMES.has(value)) return `「${c}」 는 쓸 수 없는 이름이다`
  if (/\s/.test(value)) return `값 「${value}」 에 빈칸이 있다. 이름은 문장이 아니라 열쇠다: 붙여 쓰거나(헬스체크) _ 로 잇는다. 설명은 보이는 이름(label)에 쓴다`
  if (!NEW_VALUE_RE.test(value)) return `값 「${value.slice(0, 80)}」 은 60자 안 · 빈칸 · \` · | 없는 글이다`
  if (value.includes('..')) return `값에 .. 을 쓰지 않는다`
  return null
}

// 폐기 줄의 새 이름 — 「2026-10-19 → 종류:값 — 까닭」
const nextOf = (dep) => String(dep || '').match(/→\s*([^\s`]+:[^\s`]+)/)?.[1] || null

// 이름 키 — 값 · 보이는 이름 · 다른 이름(살아 있는 이름만) → 이름들
const keyCache = new WeakMap()
function keysOf(vocab) {
  let m = keyCache.get(vocab)
  if (m) return m
  m = new Map()
  for (const [c, v] of vocab.coords) {
    if (v.deprecated) continue
    for (const a of [c, valueOf(c), v.label, ...v.aliases]) {
      const n = norm(a)
      if (!n) continue
      if (!m.has(n)) m.set(n, new Set())
      m.get(n).add(c)
    }
  }
  keyCache.set(vocab, m)
  return m
}

// 이름 하나 풀기 — { coord, how: same | deprecated | alias | null }
export function resolveName(vocab, coord) {
  let c = nfc(String(coord ?? '').trim())
  let v = vocab.coords.get(c)
  if (v && !v.deprecated) return { coord: c, how: 'same' }
  if (v) {
    for (let n = 0; n < 6 && v?.deprecated; n++) {
      const to = nextOf(v.deprecated)
      if (!to) break
      c = to
      v = vocab.coords.get(c)
    }
    if (v && !v.deprecated) return { coord: c, how: 'deprecated' }
    return { coord: null, how: 'gone' }
  }
  const hit = keysOf(vocab).get(norm(valueOf(c))) || keysOf(vocab).get(norm(c))
  if (hit && hit.size === 1) return { coord: [...hit][0], how: 'alias' }
  return { coord: null, how: null }
}

// 가까운 이름 — 글 속 낱말이 키에 들거나 키가 낱말에 드는 것 · 많이 겹친 순
export function nearNames(vocab, text, n = 3) {
  const words = nfc(String(text ?? '')).split(/[\s:_\-·,./()]+/).map(norm).filter((w) => w.length >= 2)
  if (!words.length) return []
  const score = new Map()
  for (const [key, cs] of keysOf(vocab)) {
    let s = 0
    for (const w of words) if (key === w) s += 3
    else if (key.includes(w) || (key.length >= 2 && w.includes(key))) s += 1
    if (s) for (const c of cs) score.set(c, Math.max(score.get(c) || 0, s))
  }
  return [...score].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([c]) => c)
}

// 자리가 있는 기록 — 이름이 없어도 들어갈 곳이 정해진 것(화면의 항목 고침 at/ · 넣은 파일 ingest/) · kmd 의 일(이력 · 정리)
export const hasPlace = (rec) => (rec.tags || []).some((t) => /^(at|ingest)\//.test(t)) || isLogRecord(rec.tags) || (rec.reflects || []).length > 0 || (rec.curates || []).length > 0 || (rec.reopens || []).length > 0

// 기록 하나 — touches · touchesEmpty 를 판정한다
//   vocab    — 이 저장 뒤의 이름 장부(같은 묶음에서 세운 이름이 들어 있다)
//   proposed — 세울 이름으로 실어 둔 것(일반 자리의 names · 정리 때 관리자가 세운다) — 장부 밖이지만 거절하지 않는다
//   why      — hold 에서 까닭이 없을 때 kmd 가 다는 까닭
export function guardRecord(vocab, rec, { mode = 'strict', proposed = new Set(), why = null } = {}) {
  const errors = []
  const fixes = []
  const outside = []
  const touches = []
  for (const raw of rec.touches || []) {
    const t = nfc(String(raw).trim())
    if (proposed.has(t)) {
      const bad = newNameWhy(t)
      if (bad) errors.push({ code: 'E_INPUT', name: t, message: bad })
      touches.push(t)
      outside.push(t)
      continue
    }
    const r = resolveName(vocab, t)
    if (r.how === 'same') {
      touches.push(t)
      continue
    }
    if (r.how === 'deprecated' || r.how === 'alias') {
      if (mode === 'strict') {
        errors.push({ code: 'E_INPUT', name: t, to: r.coord, message: r.how === 'deprecated' ? `「${t}」 는 폐기된 이름이다. 이어 둔 「${r.coord}」 를 쓴다` : `「${t}」 는 이름 장부에 없다. 같은 말의 이름 「${r.coord}」 를 쓴다` })
        touches.push(t)
      } else {
        fixes.push({ from: t, to: r.coord, how: r.how })
        touches.push(r.coord)
      }
      continue
    }
    // 장부에 없는 이름
    if (mode === 'strict') {
      const near = nearNames(vocab, valueOf(t))
      const bad = newNameWhy(t)
      errors.push({ code: 'E_INPUT', name: t, near, message: `「${t}」 는 이름 장부에 없다.${near.length ? ` 가까운 이름: ${near.join(' · ')}.` : ''} match 로 찾은 이름을 쓰거나, 새 이름이면 names 로 같이 세운다${bad ? ` (${bad})` : ''}` })
      touches.push(t)
    } else {
      touches.push(t)
      outside.push(t)
    }
  }
  const uniq = [...new Set(touches)]
  let empty = rec.touchesEmpty == null ? null : nfc(String(rec.touchesEmpty)).replace(/[\r\n]+/g, ' ').trim().slice(0, EMPTY_MAX) || null
  if (uniq.length && empty) {
    if (mode === 'strict') errors.push({ code: 'E_INPUT', message: 'touches 가 있는데 touchesEmpty 를 보냈다. 둘 중 하나다' })
    empty = null
  }
  if (!uniq.length && !empty && !hasPlace(rec)) {
    if (mode === 'strict') errors.push({ code: 'E_INPUT', message: '건드린 이름(touches)이 없다. match 로 그 항목의 이름을 찾아 단다 · 새 이름이면 names 로 같이 세운다 · 정말 이름이 없으면 touchesEmpty 에 까닭 한 줄을 적는다(이름 없는 기록은 어디로도 닿지 않는다)' })
    else empty = why || '까닭을 적지 않았다'
  }
  return { touches: uniq, touchesEmpty: uniq.length ? null : empty, errors, fixes, outside }
}

// 세울 이름 — 장부에 없던 이름만 모양을 본다(있던 이름은 옛 모양 그대로 둔다)
export function guardNames(vocab, names) {
  const errors = []
  const warnings = []
  for (const n of names || []) {
    if (vocab.coords.has(n.coord)) continue
    const bad = newNameWhy(n.coord)
    if (bad) {
      errors.push({ code: 'E_INPUT', name: n.coord, message: bad })
      continue
    }
    const r = resolveName(vocab, n.coord)
    if (r.how === 'alias') warnings.push(`「${n.coord}」 의 값은 이미 「${r.coord}」 의 이름 · 다른 이름이다. 같은 것이면 그 이름을 쓴다`)
  }
  return { errors, warnings }
}

// ── 갈래 장부(`_forms.md`) — 새 문서가 설 수 있는 갈래 ──
//
//   | 갈래 | 다른 이름 | 폴더 | 종류 | 이름 | 서식 |
//   |---|---|---|---|---|---|
//   | 회의록 | 회의, 미팅, 통화, 면담, 전화 | 1.2_사업관리 | 사건 | — | 작업기록 |
//
//   종류: 대상(「지금」 을 적는 문서) · 서술 · 사건(머리가 「YYYY-MM-DD 무엇」) · 대장(항목 하나가 이름 하나)
//   이름: 그 문서의 항목 이름 패턴(`이슈:*`) — 있으면 새 문서를 세울 때 자리 장부 행을 같이 세운다
export const FORM_KINDS = ['대상', '서술', '사건', '대장']
export const DEFAULT_FORMS = [
  { name: '회의록', aliases: ['회의', '미팅', '통화', '전화', '면담', 'minutes', 'meeting'], folder: '', kind: '사건', pattern: null, form: '작업기록' },
  { name: '장애 대응', aliases: ['장애', '사고', 'incident', 'postmortem'], folder: '', kind: '사건', pattern: null, form: '작업기록' },
  { name: '보고서', aliases: ['주간보고', '월간보고', 'report'], folder: '', kind: '사건', pattern: null, form: '작업기록' },
]

export function parseForms(text) {
  const rows = []
  for (const raw of String(text || '').split('\n')) {
    const cells = raw.match(/^\|(.+)\|\s*$/)?.[1].split('|').map((x) => nfc(x.trim()))
    if (!cells || cells.length < 4) continue
    if (/^[-: ]+$/.test(cells.join('')) || cells[0] === '갈래') continue
    const strip = (s) => String(s || '').replace(/^`|`$/g, '').trim()
    const none = (s) => (!s || s === '—' || s === '-' ? '' : s)
    const name = strip(cells[0])
    if (!name) continue
    rows.push({
      name,
      aliases: none(cells[1]).split(/[,،、]/).map((x) => x.trim()).filter(Boolean),
      folder: strip(none(cells[2])).replace(/^docs\//, '').replace(/\/+$/, ''),
      kind: FORM_KINDS.includes(cells[3]) ? cells[3] : '대상',
      pattern: strip(none(cells[4])) || null,
      form: strip(none(cells[5])) || null,
    })
  }
  return rows
}
export const formsOf = (text) => {
  const rows = parseForms(text)
  return { rows: rows.length ? rows : DEFAULT_FORMS, own: rows.length > 0 }
}

// 파일 이름 조각 — 날짜 · 판 · 최종 · 사본 · 번호 꼬리
const FILEISH = [/(20\d\d)[-._ ]?(0[1-9]|1[0-2])[-._ ]?(0[1-9]|[12]\d|3[01])/, /(^|[\s_-])[vV]\d+(\.\d+)*($|[\s_-])/, /최종|사본|final|copy|\(\d+\)/i, /\.(docx?|hwpx?|pdf|xlsx?|pptx?|txt)$/i]

// 갈래 고르기 — 문서 이름(경로의 마지막)이 갈래 이름이거나 다른 이름을 품으면 그 갈래
export function formFor(forms, docName) {
  const n = norm(docName)
  if (!n) return null
  return forms.rows.find((f) => norm(f.name) === n) || forms.rows.find((f) => [f.name, ...f.aliases].some((a) => norm(a).length >= 2 && n.includes(norm(a)))) || null
}

// 새 문서 하나 — 경로(docs/ 아래 · .md 없이)와 처음 머리들
//   { errors[], form, registryRow? }
export function guardNewDoc(forms, docRel, headings = []) {
  const errors = []
  const p = nfc(String(docRel)).replace(/\\/g, '/').replace(/^docs\//, '').replace(/\.md$/, '')
  const parts = p.split('/')
  const name = parts.pop()
  const folder = parts.join('/')
  if (FILEISH.some((re) => re.test(name))) errors.push({ code: 'E_INPUT', message: `새 문서 이름 「${name}」 에 파일 이름 조각(날짜 · 판 · 최종 · 확장자)이 있다. 문서 이름은 갈래 · 주제로 짓는다(예: 회의록 · 게이트웨이 설계)` })
  if (name.length > 40) errors.push({ code: 'E_INPUT', message: `새 문서 이름이 너무 길다(40자 안). 문서 이름은 갈래 · 주제다` })
  const f = formFor(forms, name)
  if (f && norm(f.name) !== norm(name)) errors.push({ code: 'E_INPUT', form: f.name, message: `「${name}」 은 「${f.name}」 갈래다. 새 문서를 세우지 않고 「${f.name}」 문서에 항목(「언제 · 무엇」)으로 넣는다` })
  if (!f && forms.own) errors.push({ code: 'E_INPUT', message: `「${name}」 은 갈래 장부에 없는 문서다. 있는 갈래(${forms.rows.map((x) => x.name).slice(0, 8).join(' · ')}${forms.rows.length > 8 ? ' …' : ''}) 문서에 넣거나, 지식관리자가 갈래 장부에 갈래를 더한 뒤 세운다` })
  if (f && f.folder && folder !== f.folder) errors.push({ code: 'E_INPUT', form: f.name, message: `「${f.name}」 갈래 문서는 「${f.folder}/」 폴더에 둔다` })
  if (f) {
    const bad = headings.filter((h) => !headingFits(f, h))
    if (bad.length) errors.push({ code: 'E_INPUT', form: f.name, message: `「${f.name}」 의 항목 머리 꼴이 아니다: ${bad.slice(0, 3).join(' · ')} — ${formHeadRule(f)}` })
  }
  return { errors, form: f || null, ...(f?.pattern ? { registryRow: { pattern: f.pattern, doc: `docs/${p}.md` } } : {}) }
}

// 갈래의 항목 머리 꼴 — 사건은 「YYYY-MM-DD 무엇」 · 이름 패턴이 있는 대장 · 대상은 「값 — 설명」 또는 「값」
export function formHeadRule(f) {
  if (f.kind === '사건') return '머리는 「YYYY-MM-DD 무엇」 이다'
  if (f.pattern) return `머리는 「값 — 설명」 이다(값 = ${f.pattern} 의 값 · 빈칸 없이)`
  return '머리는 주제 이름이다'
}
// 서식 — 갈래의 서식(docs/템플릿/)이 정한 짜임을 한 줄로(brief · 정리 프롬프트가 싣는다). 서식의 안내 글은 본문에 넣지 않는다
export const FORM_GUIDE = {
  지식문서: '문서 맨 위 1~3문장: 무엇을 다루고 지금 결론이 무엇인가 · 항목 하나가 대상 하나 · 확정된 것만 「…한다」 체 · 나란한 것 셋 이상은 목록 · 값은 표',
  결정기록: '문서 맨 위 1~2문장: 모인 결정의 범위 · 항목 하나가 결정 하나 · 항목 글은 정한 것 · 까닭 · 영향 · 정한 때와 사람 · 뒤집힌 결정은 고쳐 쓴다',
  작업기록: '문서 맨 위 1문장: 무엇이 쌓이나 · 항목 머리 「YYYY-MM-DD 주제」 · 항목 글은 누가 · 무엇을 · 정한 것 · 남은 것 · 오래 갈 결정은 결정 기록에도',
}
export const formGuide = (f) => ({ head: formHeadRule(f), body: FORM_GUIDE[f.form] || (f.kind === '사건' ? FORM_GUIDE.작업기록 : FORM_GUIDE.지식문서) })
export function headingFits(f, h) {
  const s = nfc(String(h || '').trim())
  if (f.kind === '사건') return /^20\d\d-\d\d-\d\d\b/.test(s) || s === '개요'
  if (f.pattern) return /^[^\s`|]{1,60}(?: — .+)?$/.test(s) || s === '개요'
  return true
}

// ── 지식 한 벌 점검 — 위반 목록(화면 · `kmd guard --check` 가 같은 계산) ──
//   sectionOf · coordsOfSection 은 core/knowledge.js 의 것을 받는다(이 모듈이 지식 읽기를 끌어오지 않게)
export function audit(k, { sectionOf, coordsOfSection }) {
  const live = [...k.vocab.coords].filter(([, v]) => !v.deprecated)
  // 넣지 않기로 둔 기록(정리 판정 「두기」)은 셈하지 않는다 — 까닭이 판정에 있다
  const unnamed = k.works.filter((w) => w.state !== 'kept' && (w.state === 'nowhere' || (!w.touches.length && !hasPlace(w) && !w.author.startsWith('kmd')))).map((w) => ({ id: w.id, title: w.title, date: w.date, why: w.touchesEmpty || null }))
  const outside = []
  for (const w of k.works) {
    const xs = w.touches.filter((c) => !k.vocab.coords.has(c))
    if (xs.length) outside.push({ id: w.id, title: w.title, date: w.date, names: xs })
  }
  const deprecatedUse = []
  for (const w of k.works) {
    if (w.state !== 'pend') continue
    const xs = w.touches.filter((c) => k.vocab.coords.get(c)?.deprecated)
    if (xs.length) deprecatedUse.push({ id: w.id, title: w.title, names: xs })
  }
  const lost = []
  for (const [c] of live) {
    const s = sectionOf(k, c)
    if (s?.loc && !s.sec) lost.push({ coord: c, doc: s.loc.doc, heading: s.loc.heading })
  }
  const noName = []
  for (const d of k.docs) for (const s of d.sections) if (s.h && !coordsOfSection(k, d, s.h).length) noName.push({ doc: d.id, heading: s.h })
  // 같은 말 — 둘로 가른다
  //   aliasClash(고칠 것): 다른 이름(aliases)이 다른 이름의 값 · 보이는 이름 · 다른 이름과 같다 — 그 말로 찾으면 정본이 갈린다
  //   sameLabel(알림): 값 · 보이는 이름만 같다 — 문서마다 있는 「변경 이력」 · 층이 다른 「경보 코드」 처럼 서로 다른 항목이다(화면은 종류:값으로 가른다)
  const own = new Map()
  const addKey = (m, n, c) => { if (n.length < 2) return; if (!m.has(n)) m.set(n, new Set()); m.get(n).add(c) }
  for (const [c, v] of live) for (const a of [valueOf(c), v.label]) addKey(own, norm(a), c)
  const alias = new Map()
  for (const [c, v] of live) for (const a of v.aliases) addKey(alias, norm(a), c)
  const aliasClash = []
  for (const [n, cs] of alias) {
    const all = new Set([...cs, ...(own.get(n) || [])])
    if (all.size > 1) aliasClash.push({ word: n, names: [...all], aliasOf: [...cs] })
  }
  const sameLabel = [...own].filter(([n, s]) => s.size > 1 && !alias.has(n)).map(([word, s]) => ({ word, names: [...s] }))
  const brokenHead = []
  for (const d of k.docs) for (const s of d.sections) if (/ — [·(]| —$/.test(s.h || '')) brokenHead.push({ doc: d.id, heading: s.h })
  const spaced = live.filter(([c]) => /\s/.test(valueOf(c))).map(([c]) => c)
  return {
    counts: { names: k.vocab.coords.size, live: live.length, records: k.works.length, sections: k.docs.reduce((n, d) => n + d.sections.length, 0), unnamed: unnamed.length, outside: outside.length, deprecatedUse: deprecatedUse.length, lost: lost.length, noName: noName.length, aliasClash: aliasClash.length, sameLabel: sameLabel.length, brokenHead: brokenHead.length, spaced: spaced.length },
    unnamed, outside, deprecatedUse, lost, noName, aliasClash, sameLabel, brokenHead, spaced,
  }
}
