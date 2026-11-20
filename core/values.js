// 값 장부 — 글 속의 수 · `코드` · 따옴표 값과, 기록이 글에 꼭 옮겨야 할 값 · 뺀 옛 값(docs/품질개선/KMD_개편_설계.md 3-1).
//
//   저장 · 검사(core/gate.js) · 제안(core/propose.js) · 들이기(core/ingest.js) · 바로 넣기(core/pcplace.js) 가 같이 쓴다. 이 모듈은 다른 kmd 모듈을 부르지 않는다.

import { createHash } from 'node:crypto'

// 판정 id — 같은 입력이면 같은 id(저장 승인 설계 P1 · P-D4). 「갈래:10자 해시」 · 해시 재료는 문서 · 머리 · 값(부르는 쪽이 값을 늘어놓은 차례와 상관없게 고른다)
export const judgeId = (code, ...parts) => `${code}:${createHash('sha256').update(parts.map((x) => String(x ?? '').normalize('NFC')).join('\n'), 'utf8').digest('hex').slice(0, 10)}`

// 값 장부 — 글 속의 수 · `코드` · 따옴표 값(같은 값이면 새 사실이 아니다)
//   코드 울타리(``` 줄)는 값 따옴표가 아니다 — 백틱을 짝지으면 울타리와 울타리 사이 글 전체가 값 하나가 된다 · `코드` 는 한 줄 안에서만
//   날짜(2026-11-02)는 값 하나(2026 · 11 · 02 로 쪼개면 늘 「기록의 값이 글에 없다」 가 된다) ·
//   수에 붙은 단위는 붙어 있으면 그대로(3개 · 10분간 → 10분), 띄어 쓴 단위는 뒤에 한글이 이어지지 않을 때만(「4.2 개발 PC」 는 4.2개 가 아니라 4.2)
const UNIT = '%|초|분|시간|일|개|건|자|px|MB|GB|KB|ms|s'
const VALUE_RE = new RegExp(`\`([^\`\\n]+)\`|「([^」]+)」|"([^"]+)"|(\\d{4}-\\d{2}-\\d{2}|\\d+(?:[.,]\\d+)*(?:(?:${UNIT})|\\s+(?:${UNIT})(?![가-힣]))?)`, 'g')
//   식별자 속 수는 값이 아니다 — 「LS-201 · T920 · 03_계측기 · deploy-gw.ps1」 의 201 · 920 · 03 · 1 을 따로 요구하면 늘 「기록의 값이 글에 없다」 가 된다
//   (앞이 영문 · _ · 「영문-」 이거나 뒤가 영문 · _ 이면 이름의 한 조각)
const inName = (s, i, n) => /[A-Za-z_]/.test(s[i - 1] || '') || (s[i - 1] === '-' && /[A-Za-z]/.test(s[i - 2] || '')) || /[A-Za-z_]/.test(s[i + n] || '')
// 서식 맞춤(이력 · 작성기준 「기록과 이력」)의 값 견주기 — 옛 글과 새 글의 값 장부가 같아야 한다 · 날짜 표기만 YYYY-MM-DD 로 맞춰 견준다
//   { same, lost: [옛 글에만], added: [새 글에만] }
//   줄 머리 수준 표시(「1.」 · 「1.1.」 · 「2)」 · 작성기준 5-1)는 짜임이지 값이 아니다 — 옛 「###」 소제목을 수준 줄로 옮기면 번호가 새로 붙는다
//   날짜 표기 맞추기: 「2026.08.01」 · 「2026. 8. 1.」 · 「2026/08/01」 · 「2026-8-1」 → 「2026-08-01」(달 1~12 · 날 1~31 일 때만 · 판 번호 「1.2.3」 은 네 자리가 아니라 그대로).
//   서식 맞춤의 값 견주기는 여기 한 곳만 쓴다(저장 문 core/save.js · kmd-migrate check · put --format)
//   연도는 1900 ~ 2099 만(「4096/8/2」 · 「0001.1.1」 은 날짜가 아니다) · 빗금 · 대시는 붙여 쓴 것만(「1024 / 8 / 4」 는 셈) · 점은 「2026. 8. 1.」 처럼 띄어 써도 날짜 ·
//   앞이 글자 · 수 · 점이거나(「v2024.1.3」) 뒤에 또 「.수」 가 이어지면(「2026.1.12.5」) 판 번호라 그대로 ·
//   코드 꼴(「`…`」 · 울타리 코드 블록) 속은 값 그대로라 맞추지 않는다(서식 검사 raw-date 와 같은 원칙)
//   끝 점은 점 꼴(「2026. 8. 1.」)만 먹는다(「기준일: 2026-01-01.」 의 문장 끝 점은 글이다)
const DAY_RE = /(?<![\w.])((?:19|20)\d{2})(?:(?<sep>[/-])(\d{1,2})\k<sep>(\d{1,2})(?!\d)(?![./-]\d)|\.[ \t]*(\d{1,2})\.[ \t]*(\d{1,2})(?!\d)(?![./-]\d)(?:\.(?!\d))?)/g
const CODE_OR_DAY = new RegExp(`(\`+)[^\\n]*?\\1|${DAY_RE.source}`, 'g')
const isoLine = (l) => l.replace(CODE_OR_DAY, (m, code, y, _sep, mo1, d1, mo2, d2) => {
  if (code) return m
  const mo = mo1 ?? mo2, d = d1 ?? d2
  return +mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31 ? `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}` : m
})
// 서식 검사 raw-date: 코드 꼴 밖에 isoDates 가 맞출 날짜 표기가 있나(한 줄 · 검사와 맞추기가 같은 기준)
export const hasRawDate = (line) => isoLine(String(line ?? '')) !== String(line ?? '')
export function isoDates(s) {
  let fence = null
  return String(s ?? '').split('\n').map((l) => {
    const f = l.match(/^[ \t]*(`{3,}|~{3,})/)?.[1]
    if (f && (!fence || (f[0] === fence[0] && f.length >= fence.length))) { fence = fence ? null : f; return l }
    return fence ? l : isoLine(l)
  }).join('\n')
}
//   옛 머리 줄의 장 번호(「### 4.1 설치」)도 같은 짜임이다(머리 줄에서만 점 없는 번호를 뗀다 · 일반 줄의 「3 개소」 는 값)
const noMarks = (s) => String(s || '').replace(/^(#{1,6}[ \t]+|\*\*)(\d+(?:\.\d+){0,3})\.?[ \t]+(?=\S)/gm, '$1').replace(/^([ \t]*)(\d+(?:\.\d+){0,3})[.)][ \t]+(?=\S)/gm, '$1')
export function sameValues(oldText, newText) {
  const a = valuesOf(noMarks(isoDates(oldText)))
  const b = valuesOf(noMarks(isoDates(newText)))
  const lost = [...a].filter((v) => !b.has(v))
  const added = [...b].filter((v) => !a.has(v))
  return { same: !lost.length && !added.length, lost, added }
}
// 다듬기(core/ingest.js polishToSave)의 값 견주기 — sameValues(수준 표시 · 날짜 표기는 짜임) 위에, 백틱으로 감싼 것은 값이 바뀐 것이 아니다:
//   새 글에만 있는 `코드` 값이 옛 글에 맨글로 이미 있으면(앞뒤가 영문 · 수 · _ 가 아닌 같은 글자) 같은 값으로 친다 · 거꾸로 옛 `코드` 를 맨글로 푼 것도 같다
//   (다듬기 정돈 거리: 맨글 식별자를 백틱으로 감싼다 · 「가.」 · 「①」 를 1. 2. 로 바꾼다 · 값 글자가 바뀐 것은 그대로 잡힌다)
const plainHas = (text, v) => {
  const t = String(text || '')
  for (let i = t.indexOf(v); i >= 0; i = t.indexOf(v, i + 1)) {
    if (!/[A-Za-z0-9_]/.test(t[i - 1] || '') && !/[A-Za-z0-9_]/.test(t[i + v.length] || '')) return true
  }
  return false
}
export function samePolished(oldText, newText) {
  const r = sameValues(oldText, newText)
  const lost = r.lost.filter((v) => !plainHas(newText, v))
  const added = r.added.filter((v) => !plainHas(oldText, v))
  return { same: !lost.length && !added.length, lost, added }
}
// 링크 대상 주소는 값이 아니다: 「](x.md#머리%20%28가%29)」 · 「](https://…:8090/…)」 · 「<https://…>」 속의 수(%20 → 20)를 값으로 읽지 않는다(링크 글은 값으로 읽는다)
const LINK_TARGET_RE = /\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)|<https?:\/\/[^\s>]+>/g
export const noLinkTargets = (s) => String(s || '').replace(LINK_TARGET_RE, (m) => (m[0] === '<' ? ' ' : ']()'))
// 값마다 나온 수(valuesOf 와 같은 읽기) — 본문 반영 검사가 「이번에 늘었나」 를 본다
export function valueCounts(text) {
  const out = new Map()
  const s = noLinkTargets(text).replace(/^[ \t]*(?:`{3,}|~{3,}).*$/gm, '')
  for (const m of s.matchAll(VALUE_RE)) {
    if (m[4] && inName(s, m.index, m[0].length)) continue
    const v = (m[1] || m[2] || m[3] || m[4]).replace(/\s+/g, '')
    out.set(v, (out.get(v) || 0) + 1)
  }
  return out
}
export const valuesOf = (text) => new Set(valueCounts(text).keys())

// 글에 꼭 있어야 할 기록의 값 — 커밋 해시 · 기록 id 는 경위라 글에 옮기지 않는다(작성기준) · 해시 속 숫자(092cc4a → 092)도 값이 아니다 ·
//   30자 넘는 따옴표 말은 값이 아니라 옮긴 문장이다 ·
//   서식대로 쓴 기록(「## 바뀐 것」 …)은 바뀐 것 칸만 요구한다. 영향은 「무엇이 바뀌나 · 누가 알아야 하나」(템플릿)라 그 항목의 지식이 아닐 때가 많고, 요약은 바뀐 것을 다시 말하는 칸이라 「187 에 배포했다」 같은 경위가 섞이고,
//   그 값을 요구하면 Claude 가 「187 환경에 배포돼 있다」 를 지식 글에 넣는다(188 DPA020 · 11-03) — 요약의 값은 넣어도 되지만 요구하지 않는다. 까닭 · 버린 안 · 근거는 경위라 글에 옮기지 않는다(작성기준) —
//   거기 든 날짜(「2026-11-02」 → 2026 · 02) · 문서 판 · 커밋을 요구하면 늘 「기록의 값이 글에 없다」 로 남는다
export const HASH_RE = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g
export const REC_ID_RE = /\b\d{4}-\d{4}-[^\s`」"'),]+/g
//   「넣은 것」 · 「되돌린 항목」 · 「받아들인 경고」 · 「값 대조」 · 「이은 항목」 · 「새로 세움」 은 kmd 가 쓰는 칸(작성기준 2-3)이라 기록의 값이 아니다
export const NOT_KNOWLEDGE = new Set(['지은 근거', '까닭', '버린 안', '근거', '넣은 것', '되돌린 항목', '받아들인 경고', '값 대조', '이은 항목', '새로 세움'])
export const knowledgeParts = (body) => {
  const s = String(body)
  if (!/^## 바뀐 것\s*$/m.test(s)) return s
  return s.split(/^(?=## )/m).filter((p) => !NOT_KNOWLEDGE.has((p.match(/^## (.+?)\s*$/m) || [])[1])).join('')
}
//   「무엇: 옛 값 → 새 값」 줄의 옛 값은 글에서 빠져야 할 값이라 요구하지 않는다(요구하면 옛 값을 지운 바른 초안이 늘 「값이 글에 없다」 로 남는다) — 새 값만
export const ARROW_RE = /^(\s*[-*]\s*[^\n]*?)\s*(?:→|->)\s*([^\n]*)$/gm
// 「- 무엇: 옛 값」 → [「- 무엇:」, 「옛 값」] (「무엇:」 이 없으면 줄 전체가 옛 값)
export const splitLeft = (left) => { const m = left.match(/^(\s*[-*]\s*[^\n]*?:)\s+([^\n]*)$/); return m ? [m[1], m[2]] : [left.replace(/^(\s*[-*]\s*)[^\n]*$/, '$1'), left.replace(/^\s*[-*]\s*/, '')] }
const newSide = (body) => String(body).replace(ARROW_RE, (_, left, right) => `${splitLeft(left)[0]} ${right}`)
// 꼭 옮길 칸 — 서식이면 바뀐 것만 · 서식이 아니면 글 전체
export const MUST_PARTS = new Set(['바뀐 것'])
const mustParts = (body) => {
  const s = String(body)
  if (!/^## 바뀐 것\s*$/m.test(s)) return s
  return s.split(/^(?=## )/m).filter((p) => MUST_PARTS.has((p.match(/^## (.+?)\s*$/m) || [])[1])).join('')
}
export const mustValues = (body) => [...valuesOf(newSide(mustParts(body)).replace(HASH_RE, ' ').replace(REC_ID_RE, ' '))].filter((v) => v.length <= 30)
// 기록이 뺀 옛 값(「옛 값 → 새 값」 의 왼쪽에만 있는 값) — 초안에 남아 있으면 알린다(거절하지 않는다: 같은 값이 다른 뜻으로 쓰였을 수 있다)
export const oldValues = (body) => {
  const out = new Set()
  for (const m of String(body).matchAll(ARROW_RE)) {
    const nv = valuesOf(m[2])
    for (const v of valuesOf(splitLeft(m[1])[1])) if (!nv.has(v)) out.add(v)
  }
  return [...out]
}

// 값 바뀜 — 옛 글에만 있는 값 → 새 글에만 있는 값(각 5개까지 · 「, 」 로 잇는다). 바뀐 값이 없으면 null
//   저장 문이 기록의 `## 넣은 것` 줄(「문서 › 머리: 5분 → 10분」)에 싣는다(설계 2-2)
export const DIFF_MAX = 5
// 보이기 전용 값 목록(같은 값도 수만큼) — 시각(10:30) · 주소:포트(10.0.0.1:8090)는 쪼개지 않는다(UX T2-08 「00 → 30」)
const WHOLE_RE = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{2,5})?\b|\b\d{1,2}:\d{2}(?::\d{2})?\b/g
function valueList(text) {
  const s0 = noLinkTargets(text).replace(/^[ \t]*(?:`{3,}|~{3,}).*$/gm, '')
  const out = [...s0.matchAll(WHOLE_RE)].map((m) => m[0])
  const s = s0.replace(WHOLE_RE, ' ')
  for (const m of s.matchAll(VALUE_RE)) {
    if (m[4] && inName(s, m.index, m[0].length)) continue
    out.push((m[1] || m[2] || m[3] || m[4]).replace(/\s+/g, ''))
  }
  return out
}
const minus = (a, b) => { const left = [...b]; return a.filter((v) => { const i = left.indexOf(v); if (i >= 0) { left.splice(i, 1); return false } return true }) }
export function valueDiff(oldText, newText) {
  const a = valueList(oldText), b = valueList(newText)
  const from = [...new Set(minus(a, b))].slice(0, DIFF_MAX)
  const to = [...new Set(minus(b, a))].slice(0, DIFF_MAX)
  if (!from.length && !to.length) return null
  return { from: from.join(', '), to: to.join(', ') }
}

// 새 값만 든 표 행(채널 평가 P16) — 옛 글에 없던 표 행마다 「행 이름 새 값」(첫 칸 + 그 행에 든 새 값) · 새 값이 없는 행은 뺀다
//   「## 넣은 것」 이 새 행 둘을 「— → 09:00」 로 뭉뚱그리지 않게 행마다 「새로: 정기 점검 09:00」 로 적는다(core/parts.js renderPut)
export function rowsAdded(oldText, newText, to) {
  const want = new Set(String(to || '').split(', ').filter(Boolean))
  if (!want.size) return []
  const had = new Set(String(oldText || '').split('\n').map((l) => l.trim()))
  const lines = String(newText || '').split('\n')
  const out = []
  const got = new Set()
  lines.forEach((l, i) => {
    const t = l.trim()
    if (!/^\|.*\|$/.test(t) || had.has(t) || /^\|[\s:|-]+\|$/.test(t)) return
    if (lines[i + 1] && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) return // 표 머리 줄
    const cells = t.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((x) => x.trim().replace(/[`*]/g, ''))
    const vals = [...new Set(valueList(t))].filter((v) => want.has(v))
    if (vals.length && cells[0]) { out.push(`${cells[0]} ${vals.join(', ')}`); vals.forEach((v) => got.add(v)) }
  })
  if (!out.length) return []
  // 표 행이 덮지 못한 새 값(표 밖 문장 · 첫 칸이 빈 행)은 그 값 그대로 한 줄 더한다 — 행만 적어 값이 빠지지 않게(gate 검토)
  const rest = [...want].filter((v) => !got.has(v))
  return [...out.slice(0, DIFF_MAX), ...(rest.length ? [rest.join(', ')] : [])]
}

// 지식에 있는 말 — 그 문서의 항목 머리(「값: 설명」 이면 값도) · 항목 장부의 항목(종류:값) · 라벨 · 별칭(값과 같이 빈칸을 뺀다)
export const squeeze = (s) => String(s).replace(/\s+/g, '')
export function namesIn(k, doc) {
  const out = new Set()
  for (const s of doc?.sections || []) if (s.h) out.add(squeeze(s.h)).add(squeeze(s.h.split(/:\s/)[0]))
  for (const v of k.vocab?.coords?.values() || []) for (const n of [v.coord, v.label, ...v.aliases]) if (n) out.add(squeeze(n))
  return out
}

// 묶은 값(`…` · 「…」 · "…")은 통째로 값 하나라 근거에 묶지 않고 쓴 같은 글과 어긋난다 — 기록 「deploy-gw.ps1 [-Reset] · 127.0.0.1:55432」 ·
//   초안 `deploy-gw.ps1 [-Reset]` · `127.0.0.1:55432`. 근거 글(빈칸 뺌)에 그대로 있고 속의 수도 다 근거에 있으면 지어낸 값이 아니다
export function groundedIn(text, ...sets) {
  const flat = squeeze(text).replace(/[`「」"]/g, '')
  return (v) => flat.includes(v) && [...valuesOf(v)].every((x) => sets.some((s) => s.has(x)))
}

// 본문 반영 검사(저장 승인 설계 P-D12 · 3-1 「바뀐 것 값이 있는데 본문 바뀜 없음」 · 3-2 · 생성 룰 R6-5): 기록 「바뀐 것」 이 말한 새 값이
//   이번 저장이 고치거나 세우는 항목(고칠 항목 · sections)의 새 글이나 머리 가운데 어디에도 없으면 오류다.
//   이은 항목(touches 만 · 글 그대로)은 값을 바꾸지 않은 관련 항목이라 그 지금 글로 대신하지 않는다. 같은 수가 다른 뜻으로 이미 있으면
//   (재시작 간격 「30초」 를 접수 상한 30초가 받아 줌 · 2026-11-18 DPMS 「설계 문서 6종」) 글을 하나도 고치지 않은 기록이 넘었다.
//   새 값은 수 · 따옴표 값(mustValues)과, 「무엇: 옛 → 새」 줄의 새 쪽에만 있는 영문 이름(rollback.ps1 · cmdCodes · reflectNames)이다.
//   경위만 있는 기록(값 없음)은 넘는다.
//   record — { title, body } · items — 고칠 항목 [{ doc, heading, text(새 글) }] → { errors: [{ id, code: 'unreflected', values, why }], values }
//   쓰지 않고 판정만: 사람 채널은 propose 오류(제안 막음 · 경고가 아니다) · 무인 채널은 저장 문 판정(고쳐 받기 → 다시 시도 · P3 · P6 에서 부른다)
//   기록 끝 `## 원천`(들인 원천 인용 · core/ingest.js intakeSrcPart)은 기록이 말한 값이 아니라 받은 글이다 — 바뀐 것 칸이 없는 들이기 기록도 원천 값으로 걸리지 않게 뺀다(PC4)
//   서버가 단 꼴(머리 다음 줄 「- 파일 … · 지문 <16자>」)일 때만 뺀다 — 사람 글이 「## 원천」 머리로 값을 숨겨 반영 검사를 피하지 않게
const SRC_PART_RE = /^## 원천[ \t]*\r?\n- (?:파일|커밋|다시 들이기|보낸 글) .* · 지문 [0-9a-f]{16}[ \t]*(?:\r?\n|$)/
// 「무엇: 옛 → 새」 줄의 새 쪽에만 있는 영문 이름(파일 · 설정 키 · 식별자): 수가 아니라 값 장부(valuesOf)에 들지 않는 새 값.
//   문서 판(v0.4)은 원본 메타라 지식 글에 넣지 않는다(옛 잔재 정리 O-1) · 커밋 해시 · 기록 id 는 경위다
const NAME_RE = /[A-Za-z_][A-Za-z0-9_.\-]*[A-Za-z0-9_]/g
const VER_RE = /^v\d+(?:\.\d+)*$/i
//   화살표 오른쪽 괄호 속(「5초 (dpms_gateway 기준 · PR 승인)」)은 근거 · 경위 말이라 이름으로 세지 않는다
const PAREN_RE = /\([^()\n]*\)|（[^（）\n]*）/g
const arrowNames = (left, right) => {
  const old = new Set(splitLeft(left)[1].match(NAME_RE) || [])
  return [...new Set(right.replace(PAREN_RE, ' ').replace(HASH_RE, ' ').replace(REC_ID_RE, ' ').match(NAME_RE) || [])].filter((n) => !old.has(n) && !VER_RE.test(n) && n.length <= 30)
}
export function reflectNames(body) {
  const out = new Set()
  for (const m of mustParts(body).matchAll(ARROW_RE)) for (const n of arrowNames(m[1], m[2])) out.add(n)
  return [...out]
}
const countIn = (s, n) => (n ? s.split(n).length - 1 : 0)
//   「옛 → 새」 줄의 새 값은 고칠 항목 글에 있기만 해서는 안 되고 이번에 들어가야 한다(옛 글보다 늘었거나 그 줄의 옛 값이 줄었다) —
//   같은 값이 다른 뜻으로 이미 있는 항목(보존 항목의 gt_api_log 「365일」)을 한 글자만 고쳐 sections 에 넣으면 값을 하나도 옮기지 않고 넘었다.
//   items[].before — 그 항목의 지금 글(신설은 빈 글 · 없으면 빈 글로 본다)
export function judgeReflect(record, items = []) {
  const body0 = String(record?.body || '').split(/^(?=## )/m).filter((p) => !SRC_PART_RE.test(p)).join('')
  const values = mustValues(body0)
  const names = reflectNames(body0).filter((n) => !values.includes(n))
  if (!values.length && !names.length) return { errors: [], values }
  const its = items.map((x) => {
    const after = `${x?.heading || ''}\n${x?.text || ''}`
    const before = x?.before ? `${x?.heading || ''}\n${x.before}` : ''
    return { after, before, a: valueCounts(after), b: valueCounts(before) }
  })
  const seen = new Set()
  for (const it of its) for (const v of it.a.keys()) seen.add(v)
  const flat = its.map((it) => it.after).join('\n')
  const missing = [...values.filter((v) => !seen.has(v)), ...names.filter((n) => !flat.includes(n))]
  // 「옛 → 새」 줄마다: 새 쪽에만 있는 값 · 이름이 어느 고칠 항목에서 이번에 들어갔나
  const stale = new Set()
  for (const m of mustParts(body0).matchAll(ARROW_RE)) {
    const oldV = valuesOf(splitLeft(m[1])[1])
    const newV = [...valuesOf(m[2].replace(HASH_RE, ' ').replace(REC_ID_RE, ' '))].filter((v) => v.length <= 30)
    const gone = [...oldV].filter((o) => !newV.includes(o))
    const dropped = (it) => gone.some((o) => (it.a.get(o) || 0) < (it.b.get(o) || 0))
    for (const v of newV.filter((x) => !oldV.has(x) && seen.has(x))) {
      if (!its.some((it) => (it.a.get(v) || 0) > 0 && ((it.a.get(v) || 0) > (it.b.get(v) || 0) || dropped(it)))) stale.add(v)
    }
    for (const n of arrowNames(m[1], m[2]).filter((x) => !values.includes(x) && flat.includes(x))) {
      if (!its.some((it) => countIn(it.after, n) > 0 && (countIn(it.after, n) > countIn(it.before, n) || dropped(it)))) stale.add(n)
    }
  }
  const all = [...missing, ...[...stale].filter((v) => !missing.includes(v))]
  if (!all.length) return { errors: [], values }
  const part = /^## 바뀐 것\s*$/m.test(body0) ? '기록의 바뀐 것 값이' : '기록 글의 값이(바뀐 것 칸이 없어 글 전체를 본다)'
  const bits = []
  if (missing.length) bits.push(`${part} ${items.length ? '고칠 항목 글에' : '고칠 항목(sections)이 없어 어느 글에도'} 없다: ${missing.slice(0, 3).join(' · ')}`)
  if (stale.size) bits.push(`「옛 → 새」 의 새 값이 고칠 항목 글에 옛 글 그대로만 있다(이번에 들어가지 않았다): ${[...stale].slice(0, 3).join(' · ')}`)
  return {
    errors: [{ id: judgeId('unreflected', ...items.map((x) => `${x?.doc || ''}#${x?.heading || ''}`).sort(), ...[...all].sort()), code: 'unreflected', values: all, why: `${bits.join('. ')}. 그 값을 지닌 항목을 고쳐 새 값을 넣는 고칠 항목(sections)을 더한다. 바꾸지 않은 값(그대로임을 확인 · 이슈 제기 · 경위)은 바뀐 것이 아니라 요약 · 까닭에 적는다(이은 항목 touches 는 값을 바꾸지 않은 관련 항목이라 그 지금 글로 대신하지 않는다 · 생성 룰 R6-5)` }],
    values,
  }
}
