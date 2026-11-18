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
const dayOf = (v) => { const m = /^(\d{4})[./](\d{1,2})[./](\d{1,2})\.?$/.exec(v); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : v }
//   옛 머리 줄의 장 번호(「### 4.1 설치」)도 같은 짜임이다(머리 줄에서만 점 없는 번호를 뗀다 · 일반 줄의 「3 개소」 는 값)
const noMarks = (s) => String(s || '').replace(/^(#{1,6}[ \t]+|\*\*)(\d+(?:\.\d+){0,3})\.?[ \t]+(?=\S)/gm, '$1').replace(/^([ \t]*)(\d+(?:\.\d+){0,3})[.)][ \t]+(?=\S)/gm, '$1')
export function sameValues(oldText, newText) {
  const a = new Set([...valuesOf(noMarks(oldText))].map(dayOf))
  const b = new Set([...valuesOf(noMarks(newText))].map(dayOf))
  const lost = [...a].filter((v) => !b.has(v))
  const added = [...b].filter((v) => !a.has(v))
  return { same: !lost.length && !added.length, lost, added }
}
// 링크 대상 주소는 값이 아니다: 「](x.md#머리%20%28가%29)」 · 「](https://…:8090/…)」 · 「<https://…>」 속의 수(%20 → 20)를 값으로 읽지 않는다(링크 글은 값으로 읽는다)
const LINK_TARGET_RE = /\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)|<https?:\/\/[^\s>]+>/g
export const noLinkTargets = (s) => String(s || '').replace(LINK_TARGET_RE, (m) => (m[0] === '<' ? ' ' : ']()'))
export function valuesOf(text) {
  const out = new Set()
  const s = noLinkTargets(text).replace(/^[ \t]*(?:`{3,}|~{3,}).*$/gm, '')
  for (const m of s.matchAll(VALUE_RE)) {
    if (m[4] && inName(s, m.index, m[0].length)) continue
    out.add((m[1] || m[2] || m[3] || m[4]).replace(/\s+/g, ''))
  }
  return out
}

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

// 본문 반영 검사(저장 승인 설계 P-D12 · 3-1 「바뀐 것 값이 있는데 본문 바뀜 없음」 · 3-2) — 기록 「바뀐 것」 의 값(mustValues)이
//   이 기록이 잇는 항목들의 글(이번 저장으로 바뀐 새 글 · 항목 글이 없으면 지금 글)이나 머리 가운데 어디에도 없으면 오류다.
//   경위만 있는 기록(값 없음)은 넘는다.
//   record — { title, body } · items — [{ doc, heading, text }] → { errors: [{ id, code: 'unreflected', values, why }], values }
//   쓰지 않고 판정만: 사람 채널은 propose 오류 · 무인 채널은 저장 문 판정(P3 · P6 에서 부른다)
//   기록 끝 `## 원천`(들인 원천 인용 · core/ingest.js intakeSrcPart)은 기록이 말한 값이 아니라 받은 글이다 — 바뀐 것 칸이 없는 들이기 기록도 원천 값으로 걸리지 않게 뺀다(PC4)
//   서버가 단 꼴(머리 다음 줄 「- 파일 … · 지문 <16자>」)일 때만 뺀다 — 사람 글이 「## 원천」 머리로 값을 숨겨 반영 검사를 피하지 않게
const SRC_PART_RE = /^## 원천[ \t]*\r?\n- (?:파일|커밋|다시 들이기|보낸 글) .* · 지문 [0-9a-f]{16}[ \t]*(?:\r?\n|$)/
export function judgeReflect(record, items = []) {
  const body0 = String(record?.body || '')
  const values = mustValues(body0.split(/^(?=## )/m).filter((p) => !SRC_PART_RE.test(p)).join(''))
  if (!values.length) return { errors: [], values }
  const seen = new Set()
  for (const x of items) for (const v of valuesOf(`${x?.heading || ''}\n${x?.text || ''}`)) seen.add(v)
  const missing = values.filter((v) => !seen.has(v))
  if (!missing.length) return { errors: [], values }
  const where = items.length ? '이은 항목 글에' : '이은 항목이 없어 어느 글에도'
  return {
    errors: [{ id: judgeId('unreflected', ...items.map((x) => `${x?.doc || ''}#${x?.heading || ''}`).sort(), ...[...missing].sort()), code: 'unreflected', values: missing, why: `기록의 바뀐 것 값이 ${where} 없다: ${missing.slice(0, 3).join(' · ')}. 그 값을 넣는 고칠 항목(sections)을 더하거나, 값이 아니면 바뀐 것에서 뺀다` }],
    values,
  }
}
