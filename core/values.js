// 값 장부 — 글 속의 수 · `코드` · 따옴표 값과, 기록이 글에 꼭 옮겨야 할 값 · 뺀 옛 값(docs/품질개선/KMD_개편_설계.md 3-1).
//
//   저장 · 검사(core/gate.js) · 제안(core/propose.js) · 정리(core/tidy.js) 가 같이 쓴다. 이 모듈은 다른 kmd 모듈을 부르지 않는다.

// 값 장부 — 글 속의 수 · `코드` · 따옴표 값(같은 값이면 새 사실이 아니다)
//   코드 울타리(``` 줄)는 값 따옴표가 아니다 — 백틱을 짝지으면 울타리와 울타리 사이 글 전체가 값 하나가 된다 · `코드` 는 한 줄 안에서만
//   날짜(2026-11-02)는 값 하나(2026 · 11 · 02 로 쪼개면 늘 「기록의 값이 글에 없다」 가 된다) ·
//   수에 붙은 단위는 붙어 있으면 그대로(3개 · 10분간 → 10분), 띄어 쓴 단위는 뒤에 한글이 이어지지 않을 때만(「4.2 개발 PC」 는 4.2개 가 아니라 4.2)
const UNIT = '%|초|분|시간|일|개|건|자|px|MB|GB|KB|ms|s'
const VALUE_RE = new RegExp(`\`([^\`\\n]+)\`|「([^」]+)」|"([^"]+)"|(\\d{4}-\\d{2}-\\d{2}|\\d+(?:[.,]\\d+)*(?:(?:${UNIT})|\\s+(?:${UNIT})(?![가-힣]))?)`, 'g')
//   식별자 속 수는 값이 아니다 — 「LS-201 · T920 · 03_계측기 · deploy-gw.ps1」 의 201 · 920 · 03 · 1 을 따로 요구하면 늘 「기록의 값이 글에 없다」 가 된다
//   (앞이 영문 · _ · 「영문-」 이거나 뒤가 영문 · _ 이면 이름의 한 조각)
const inName = (s, i, n) => /[A-Za-z_]/.test(s[i - 1] || '') || (s[i - 1] === '-' && /[A-Za-z]/.test(s[i - 2] || '')) || /[A-Za-z_]/.test(s[i + n] || '')
export function valuesOf(text) {
  const out = new Set()
  const s = String(text || '').replace(/^[ \t]*(?:`{3,}|~{3,}).*$/gm, '')
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
//   「고친 조각」 은 제안(core/propose.js)이라 값이 아니다 · 「넣은 것」 · 「넣지 못함」 · 「되돌린 항목」 은 kmd 가 쓰는 칸(작성기준 2-3)이라 기록의 값이 아니다
export const NOT_KNOWLEDGE = new Set(['까닭', '버린 안', '근거', '고친 조각', '넣은 것', '넣지 못함', '되돌린 항목'])
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

// 지식에 있는 이름 — 그 문서의 항목 머리(「값: 설명」 이면 값도) · 이름 장부의 이름 · 보이는 이름 · 다른 이름(값과 같이 빈칸을 뺀다)
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
