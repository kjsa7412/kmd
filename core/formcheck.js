// 서식 검사(서식 설계 4-7 · 작성기준 7절) — 서식 계약(core/forms.js FORMS)을 기계로 본다. 막지 않는다.
//   level 「fix」(1단계 확정 검사): 짓기 길(바탕 세우기 · 들이기 · 다듬기)은 같은 세션에 고쳐 받기(formFixOf) · 그 밖은 알림
//   level 「note」(알림): 짜임 알림으로만 · 오탐을 잰 뒤 올린다
//   lintForm(text, { kind, props }) → [{ code, level, line, where, msg }] (줄은 1부터 · 참고 블록 · 코드 울타리 · 표지 줄은 본문으로 보지 않는다)
//   lintFormNew(before, after, opt) — 저장 알림: 앞에 없던 것만 + 옛 머리 「값:」 이 사라짐(head-value)
//   missingIds(sourceTexts, heads) — 대장: 원본 표의 ID 가 머리에 다 있나(id-rows · 짓기만)

import { readText } from './text.js'
import { splitRef, REF_OPEN, REF_CLOSE } from './sections.js'
import { FORMS } from './forms.js'

export const FIX_CODES = new Set(['no-summary', 'no-lead', 'head-form', 'head-value', 'form-meta', 'id-rows', 'num-repeat', 'table-cols', 'missing-label', 'prop-rows', 'date-mismatch', 'raw-date', 'ref-key'])
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const LIST = /^(?:[-*+]|\d+(?:\.\d+)*[.)])\s/
const LABEL = /^- \*\*(.+?)\*\*\s*[:：]/
const META_HEAD = /^(표지|개정\s*이력|작성\s*지침|해더|헤더|양식(\s|$)|필드\s*구조)|필드 구조$|작성지침$/
const HEAD_NUM = /^(?:[^:]{1,40}:\s*)?\d+(?:\.\d+)*\.?\s+\S/
const DATE = /\d{4}-\d{2}-\d{2}/
const cellsOf = (ln) => ln.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((x) => x.trim())
const isSep = (ln) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(ln) && /-/.test(ln)
// cell-list 거름 — 설명 칸 머리 · 값 꼴 조각(수 · 영문 코드가 든 조각)
// 날짜 머리 종류(사건 · 정례 보고) — 장 번호 검사 밖 · 주차 머리 알림
const DATED = new Set(['사건', '보고'])
// 사건 · 보고 항목의 알림 기준(작성기준 6-3): 정한 것 한 줄의 길이(링크 없이 이보다 길면 값을 풀어 적은 것) · 무엇을 문장 수
export const DECIDED_MAX = 80
export const WHAT_SENTENCES = 3
// 단계 표(절차 · 시험) — 첫 칸 번호 · 결과 칸 · 동작 칸 · 시험 케이스 덩이 머리(「1. T1 …」 · 「2. IT-03 …」)
const STEP_COL = /^(단계|순서)$/
const NUM_COL = /^(번호|#|No\.?)$/i
const RESULT_COL = /결과|확인|기대|예상|나오는 것|판정/
const ACT_COL = /^(할 일|절차|동작|수행( 절차)?|명령|하는 일)$/
const CASE_HEAD = /^\d+\.\s+[A-Z]{1,4}-?\d+[A-Za-z]?\b/
const DESC_COL = /설명|내용|기능|비고|역할|하는 일|담당|조치|결과|범위|확인|목적|용도|정의|뜻|무엇|절차|방법|근거|요약|변경|관련|메모|기대|언제|주의|구성|대응|원인|영향|조건|기준/
const VALUE_SEG = (x) => /\d|[A-Za-z_]{2,}/.test(x)

// 문서 → 본문 줄(참고 블록 · 울타리 · 표지 줄은 빈 줄로 · 줄 번호는 그대로) · 머리 · 항목
function parse(text0) {
  const raw = readText(String(text0 ?? '')).split('\n')
  const lines = raw.slice()
  const spans = splitRef(raw).spans || []
  const refLines = []
  for (const [a, b] of spans) for (let i = a; i <= b; i++) { refLines.push([i, raw[i]]); lines[i] = '' }
  let fence = null
  const body = lines.map((ln) => {
    const f = ln.match(FENCE)
    if (f) { fence = !fence ? f[1] : f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence; return '' }
    if (fence) return ''
    return /^\s*<!--.*-->\s*$/.test(ln) ? '' : ln
  })
  const secs = []
  let title = -1
  body.forEach((ln, i) => {
    if (/^#\s+\S/.test(ln) && title < 0) title = i
    const m = ln.match(/^##\s+(.+?)\s*#*\s*$/)
    if (m) secs.push({ h: m[1].trim(), i, end: body.length })
  })
  secs.forEach((s, k) => { s.end = k + 1 < secs.length ? secs[k + 1].i : body.length })
  return { raw, body, secs, title, refLines }
}

// 번호 차례 — 점 번호(1. · 1.1.)와 괄호 번호(1) · 1.1))를 따로 · 같은 부모 아래 되풀이 · 뒤로 감 · 건너뜀
function numIssues(rows, add, where) {
  const dot = []
  let par = []
  for (const [i, ln] of rows) {
    const d = ln.match(/^(\d+(?:\.\d+)*)\.\s/)
    const p = !d && ln.match(/^(\d+(?:\.\d+)*)\)\s/)
    if (!d && !p) continue
    const ns = (d || p)[1].split('.').map(Number)
    const st = d ? dot : par
    const lv = ns.length - 1
    const prev = st[lv]
    const sameParent = prev && prev.slice(0, lv).join('.') === ns.slice(0, lv).join('.')
    if (prev && sameParent) {
      const a = prev[lv]
      const b = ns[lv]
      if (b === a) add('num-repeat', i, where, `번호 되풀이(${(d || p)[1]}${d ? '.' : ')'}): 같은 수준은 1 → 2 → 3 으로 이어 센다`)
      else if (b < a) add('num-repeat', i, where, `번호가 뒤로 간다(${a} 다음 ${b})`)
      else if (b > a + 1) add('num-skip', i, where, `번호 건너뜀(${a} 다음 ${b})`)
    }
    st[lv] = ns
    st.length = lv + 1
    if (d) par = []
  }
}

export function lintForm(text0, { kind = '대상', props = null, form = null } = {}) {
  const F = FORMS[kind] || FORMS.대상
  const { body, secs, title, refLines } = parse(text0)
  const out = []
  const add = (code, i, where, msg) => out.push({ code, level: FIX_CODES.has(code) ? 'fix' : 'note', line: i + 1, where: where || '', msg })
  // 요약(문서) — 제목 다음 첫 글이 문단이어야 한다
  const firstSec = secs.length ? secs[0].i : body.length
  const lead = body.slice(title + 1, firstSec).map((ln, k) => [title + 1 + k, ln]).filter(([, ln]) => ln.trim())
  if (secs.length && kind !== '기록') {
    if (!lead.length) add('no-summary', Math.max(title, 0), '', '요약 없음: 「# 제목」 다음에 이 문서가 무엇을 어떤 단위로 적나 1~3문장')
    else if (/^\s*(\||>)/.test(lead[0][1]) || LIST.test(lead[0][1].trim())) add('no-summary', lead[0][0], '', '요약 자리가 표 · 목록 · 인용이다: 그 위에 1~3문장 요약')
  }
  // 참고 블록 키 — 항목 키는 머리 전체 글과 같아야 한다(withRef 가 걷는다)
  const heads = new Set(secs.map((s) => s.h))
  for (const [i, ln] of refLines) {
    const m = ln.match(/^- (?!\(문서\))(\S.*?)\s*$/)
    if (m && !REF_OPEN.test(ln) && !REF_CLOSE.test(ln) && !heads.has(m[1]) && !/^\*\*/.test(m[1])) add('ref-key', i, m[1], `참고 블록 키 「${m[1].slice(0, 30)}」 가 문서 머리에 없다: 머리 전체 글과 같게`)
  }
  const ids = new Map()
  for (const s of secs) {
    const rows = []
    for (let i = s.i + 1; i < s.end; i++) if (body[i].trim()) rows.push([i, body[i]])
    // 머리
    if (META_HEAD.test(s.h)) add('form-meta', s.i, s.h, `양식 항목(「${s.h.slice(0, 20)}」): 표지 · 개정 이력 · 작성지침 · 필드 구조는 항목이 아니다`)
    else if (HEAD_NUM.test(s.h) && !DATED.has(kind)) add('head-form', s.i, s.h, `머리에 장 번호(「${s.h.slice(0, 20)}」): 번호를 떼고 대상 이름만`)
    else if (F.headRe && !F.headRe.test(s.h)) {
      if (DATED.has(kind) && /주차/.test(s.h)) add('week-head', s.i, s.h, '날짜 없는 주차 머리: 원본에 날짜가 있으면 「YYYY-MM-DD N주차」')
      else add('head-form', s.i, s.h, `머리 꼴(${kind}): ${F.head}`)
    }
    const id = kind === '대장' ? (s.h.match(/^([^:\s]+)/) || [])[1] : null
    if (id) { if (ids.has(id)) add('dup-id', s.i, s.h, `같은 ID 머리가 둘이다(${id})`); ids.set(id, s.i) }
    if (!rows.length) continue
    // 첫 블록 — 1~2문장 문단
    const first = rows[0][1].trim()
    if (/^\|/.test(first) || LIST.test(first) || LABEL.test(first) || /^>/.test(first)) add('no-lead', rows[0][0], s.h, '첫 문장 없음: 머리 다음은 대상 · 결론 한 문장(표 · 목록 · 라벨은 그 아래)')
    // 라벨(사건 · 대장 · 결정)
    if (F.labels?.length && !(F.labelsWhen === 'props' && !props?.length)) {
      const names = F.labels.map((l) => l.name)
      const got = rows.map(([i, ln]) => [i, (ln.match(LABEL) || [])[1]]).filter(([, n]) => n && names.includes(n.trim()))
      const have = got.map(([, n]) => n.trim())
      const routine = kind === '사건' && (/주차|주간|월간/.test(s.h) || /보고/.test(form || ''))
      if (!routine) for (const l of F.labels) if (l.must && !have.includes(l.name)) add('missing-label', s.i, s.h, `필수 라벨 「${l.name}」 없음(${kind}: ${names.join(' · ')})`)
      const order = have.map((n) => names.indexOf(n))
      if (order.some((x, k) => k && x <= order[k - 1])) add('label-order', got[0][0], s.h, `라벨 차례 · 되풀이(${have.join(' → ')}): ${names.join(' → ')}`)
      // 남은 것 줄 꼴
      const li = got.find(([, n]) => n.trim() === '남은 것')
      if (li) {
        for (const [i, ln] of rows.filter(([i]) => i > li[0])) {
          if (LABEL.test(ln) || !/^\*\s/.test(ln)) break
          if (!/^\* .+: .+ · 기한 (\d{4}-\d{2}-\d{2}|-)\s*$/.test(ln) && !/^\* (원본에 따로 없음|없음)\s*$/.test(ln)) add('todo-form', i, s.h, '남은 것 줄 꼴: 「* <할 일>: <맡은 이> · 기한 <YYYY-MM-DD 또는 ->」')
        }
      }
      // 날짜(사건) — 머리 날짜와 「때 · 곳」 날짜
      if (kind === '사건') {
        const hd = (s.h.match(DATE) || [])[0]
        const at = rows.find(([, ln]) => /^- \*\*때 · 곳\*\*/.test(ln))
        const ad = at && (at[1].match(DATE) || [])[0]
        if (hd && ad && hd !== ad) add('date-mismatch', at[0], s.h, `머리 날짜 ${hd} 와 때 · 곳 날짜 ${ad} 가 다르다`)
      }
    }
    // 라벨 아래 「*」 줄 수 — 사건 무엇을(여섯 줄까지) · 보고 한 일(여덟 줄까지)
    const starsUnder = (name) => {
      const at = rows.findIndex(([, ln]) => (ln.match(LABEL) || [])[1]?.trim() === name)
      if (at < 0) return null
      let n = 0
      for (let k = at + 1; k < rows.length && !LABEL.test(rows[k][1]); k++) if (/^\*\s/.test(rows[k][1])) n++
      return { at: rows[at][0], n, rows: rows.slice(at + 1, (rows.findIndex(([, ln], k) => k > at && LABEL.test(ln)) + 1 || rows.length + 1) - 1) }
    }
    if (kind === '사건') { const w = starsUnder('무엇을'); if (w && w.n > 6) add('what-long', w.at, s.h, `무엇을 아래 ${w.n}줄: 여섯 줄까지(정한 것 · 남은 것 · 따로 항목으로)`) }
    // 사건 · 보고(작성기준 6-3 · 생성 룰 R4-3): 정한 것 줄이 값을 풀어 적음(길고 링크 없음) · 무엇을이 세 문장을 넘음
    if (DATED.has(kind)) {
      const block = (name) => {
        const at = rows.findIndex(([, ln]) => (ln.match(LABEL) || [])[1]?.trim() === name)
        if (at < 0) return null
        const xs = []
        const inline = rows[at][1].replace(LABEL, '').trim()
        if (inline) xs.push([rows[at][0], inline])
        for (let k = at + 1; k < rows.length && !LABEL.test(rows[k][1]); k++) if (/^\*\s/.test(rows[k][1])) xs.push([rows[k][0], rows[k][1].replace(/^\*\s+/, '').trim()])
        return { at: rows[at][0], xs }
      }
      const d = block('정한 것')
      for (const [i, x] of d ? d.xs : []) {
        if (/\]\([^)]+\)/.test(x)) continue
        const n = x.replace(/`[^`]*`/g, '`').length
        if (n > DECIDED_MAX) add('decided-long', i, s.h, `정한 것 줄이 ${n}자이고 링크가 없다: 한 줄(${DECIDED_MAX}자 안)로 줄이고 값은 그 값이 사는 항목에 넣어 링크한다(R4-3)`)
      }
      const w = block('무엇을')
      if (w) {
        const n = w.xs.reduce((a, [, x]) => a + Math.max(1, (x.match(/[.!?。](?=\s|$)/g) || []).length), 0)
        if (n > WHAT_SENTENCES) add('what-sentences', w.at, s.h, `무엇을이 ${n}문장: 다룬 거리 ${WHAT_SENTENCES}문장까지 · 배경 사실은 그 대상 항목으로(R4-3)`)
      }
    }
    if (kind === '보고') {
      const w = starsUnder('한 일')
      if (w && w.n > 8) add('what-long', w.at, s.h, `한 일 아래 ${w.n}줄: 분야마다 한 줄 · 여덟 줄까지`)
      const p = starsUnder('진도')
      if (p && !p.rows.some(([, ln]) => /^\|/.test(ln))) add('prog-table', p.at, s.h, '진도는 「| 구분 | 계획 | 실적 |」 표로(문장에 섞지 않는다)')
      if (rows.some(([, ln]) => /^\*\s/.test(ln) && /진도율|\d+(\.\d+)?\s*%\s*\//.test(ln))) add('prog-table', s.i, s.h, '진도율이 줄 글에 있다: 진도 표로')
    }
    // 단계(절차 · 시험) — 단계 표 · 「1)」 줄: 열 단계까지 · 결과 칸 · 한 단계에 동작 하나
    if (kind === '절차' || kind === '시험') {
      let run = 0
      for (const [i, ln] of rows) {
        if (/^\d+\)\s/.test(ln)) { if (++run === 11) add('steps-long', i, s.h, '「1)」 단계가 열을 넘는다: 덩이로 나눈다') }
        else if (!/^\*\s/.test(ln)) run = 0
      }
      for (let k = 0; k < rows.length; k++) {
        if (!/^\|/.test(rows[k][1]) || !rows[k + 1] || !isSep(rows[k + 1][1])) continue
        const hd = cellsOf(rows[k][1])
        const body = []
        for (let j = k + 2; j < rows.length && /^\|/.test(rows[j][1]); j++) body.push(rows[j])
        // 단계 표 — 첫 칸 「단계 · 순서」, 또는 「# · 번호」 에 동작 칸이 있고 행 첫 칸이 번호(목록 · 시나리오 표는 아니다)
        const numbered = body.every(([, ln]) => /^(\d+(-\d+)?|끝|-)?$/.test(cellsOf(ln)[0] || ''))
        if (!(STEP_COL.test(hd[0] || '') || (NUM_COL.test(hd[0] || '') && hd.some((h) => ACT_COL.test(h)))) || !numbered) { k += body.length + 1; continue }
        if (body.length < 2) continue
        if (!hd.some((h) => RESULT_COL.test(h))) add('step-result', rows[k][0], s.h, `단계 표에 결과 칸이 없다(${hd.join(' · ')}): 결과 · 기대 결과 칸`)
        if (body.length > 10) add('steps-long', rows[k][0], s.h, `단계 표가 ${body.length}행: 열까지 · 넘으면 덩이로 나눈다`)
        const act = hd.findIndex((h) => ACT_COL.test(h))
        for (const [i, ln] of body) { const c = cellsOf(ln)[act >= 0 ? act : 1] || ''; if ((c.replace(/`[^`]*`/g, '').match(/→/g) || []).length >= 2) add('step-multi', i, s.h, '한 단계에 동작 여럿(「→」): 단계를 나눈다') }
        k += body.length + 1
      }
    }
    // 시험 케이스 덩이(「1. ID 이름」) — 단계 표(기대 결과) · 판정 줄
    if (kind === '시험') {
      const starts = rows.map(([i, ln], k) => [k, ln]).filter(([, ln]) => CASE_HEAD.test(ln)).map(([k]) => k)
      starts.forEach((a, n) => {
        const b = n + 1 < starts.length ? starts[n + 1] : rows.length
        const part = rows.slice(a, b)
        const tbl = part.some(([, ln], q) => /^\|/.test(ln) && part[q + 1] && isSep(part[q + 1][1]) && cellsOf(ln).some((h) => /기대|예상/.test(h)))
        if (!tbl) add('case-steps', rows[a][0], s.h, `시험 덩이(${rows[a][1].slice(0, 24)})에 「| 순서 | 절차 | 기대 결과 |」 표가 없다`)
        if (!part.some(([, ln]) => /^(\*\*)?판정(\*\*)?\s*[:：]|^- \*\*판정\*\*/.test(ln))) add('case-verdict', rows[a][0], s.h, `시험 덩이(${rows[a][1].slice(0, 24)})에 「판정: …」 줄이 없다`)
      })
    }
    // 용어 — 옛 꼴 줄 · 길이
    if (kind === '용어') {
      const bad = rows.find(([, ln]) => /^\*\*별칭\*\*|^관련\s*:|^\*\*[^*]+\.\*\*/.test(ln.trim()))
      if (bad) add('term-form', bad[0], s.h, '「**별칭** · …」 · 「관련: …」 · 굵은 정의: 첫 문장(정의) 뒤 라벨 줄(별칭 · 설명 · 관련)로')
      if (rows.length > 14) add('term-long', s.i, s.h, `용어 항목이 ${rows.length}줄: 정의 1~2문장 · 긴 설계 · 표는 대상 · 절차 항목으로 잇는다`)
    }
    // 대장 속성 표
    if (kind === '대장' && props?.length) {
      const hi = rows.findIndex(([, ln]) => /^\|/.test(ln) && cellsOf(ln)[0] === '속성')
      if (hi < 0) add('prop-rows', s.i, s.h, `속성 표(| 속성 | 값 |) 없음: ${props.map((p) => p.name).join(' · ')}`)
      else {
        const got = []
        for (let k = hi + 2; k < rows.length && /^\|/.test(rows[k][1]); k++) got.push(cellsOf(rows[k][1]))
        const names = got.map((c) => c[0])
        const miss = props.filter((p) => p.must && !names.includes(p.name))
        if (miss.length) add('prop-rows', rows[hi][0], s.h, `필수 속성 행 없음: ${miss.map((p) => p.name).join(' · ')}(빈 값은 「-」)`)
        const want = props.map((p) => p.name)
        const ord = names.map((n) => want.indexOf(n)).filter((x) => x >= 0)
        if (ord.some((x, k) => k && x < ord[k - 1])) add('prop-order', rows[hi][0], s.h, `속성 행 차례: ${want.join(' · ')}`)
        if (got.length && got.every((c) => !c[1] || c[1] === '-')) add('empty-row', rows[hi][0], s.h, '속성 값이 모두 「-」 다(원본 빈 행)')
      }
    }
    // 표 · 줄
    let header = null
    for (let k = 0; k < rows.length; k++) {
      const [i, ln] = rows[k]
      if (!/^\s*\|/.test(ln)) {
        header = null
        if (!LIST.test(ln.trim()) && !/^#/.test(ln) && (ln.match(/(?:^|[\s.,·])[가-힣A-Za-z][가-힣A-Za-z ]{0,10}\s*:\s+\S/g) || []).length >= 3) add('meta-lump', i, s.h, '한 문단에 「X: … Y: … Z: …」 셋 이상: 라벨 줄 · 표로 나눈다')
        if (/\d{4}\.\s?\d{1,2}\.\s?\d{1,2}/.test(ln)) add('raw-date', i, s.h, '날짜 꼴 「YYYY. MM. DD」: YYYY-MM-DD 로')
        continue
      }
      // 구분 줄이 뒤따르면 새 표의 머리다(빈 줄로만 나뉜 두 표가 앞 표 머리로 이어 읽히지 않게)
      if (rows[k + 1] && isSep(rows[k + 1][1])) {
        header = cellsOf(ln)
        if (header.length >= 8) add('wide-table', i, s.h, `열이 ${header.length}개: 일곱까지 · 넘으면 첫 열을 같이 두고 나눈다`)
        k++
        continue
      }
      if (header == null) continue
      const cs = cellsOf(ln)
      cs.forEach((c, j) => {
        const key = `${header[j] || ''} ${cs[0] || ''}`
        if (/^[34]\d{4}(\.\d+)?$/.test(c) && /일|날짜|일자|기한|일시|date/i.test(key)) add('raw-date', i, s.h, `날짜 칸에 숫자 「${c}」(엑셀 일련번호): YYYY-MM-DD 로`)
        if (/\d{4}\.\s?\d{1,2}\.\s?\d{1,2}/.test(c)) add('raw-date', i, s.h, `날짜 꼴 「${c.slice(0, 16)}」: YYYY-MM-DD 로`)
        if (/^(〃|"|위와 같음|상동)$/.test(c)) add('ditto', i, s.h, '「〃 · 위와 같음」: 값을 되풀이한다')
        const bare = c.replace(/`[^`]*`/g, '').replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]\([^)]*\)/g, '')
        const segs = bare.split(/\s·\s|,\s/).map((x) => x.trim()).filter(Boolean)
        //   값 나열만 — 설명 칸(머리가 설명 · 내용 · 기능 …)의 나열과 말 조각 나열(「확인 창 열기 · 취소 · 확인」)은 글이다 · 조각 절반 이상이 값 꼴(수 · 영문 코드)일 때
        if (j > 0 && segs.length >= 5 && !DESC_COL.test(header[j] || '') && segs.filter(VALUE_SEG).length * 2 >= segs.length && segs.every((x) => x.length <= 25 && !/다[.)]?$/.test(x))) add('cell-list', i, s.h, `표 한 칸에 값 ${segs.length}개: 대상마다 행 · 항목으로`)
      })
    }
    numIssues(rows, add, s.h)
  }
  return out.sort((a, b) => a.line - b.line)
}

// 머리 하나(구조안 묶음 · 짓기 전) — 양식 항목 · 장 번호 · 종류 머리 꼴 · 없으면 null
export function headProblem(kind, h) {
  const F = FORMS[kind] || FORMS.대상
  if (META_HEAD.test(h)) return `양식 항목 「${h}」: 표지 · 개정 이력 · 작성지침 · 필드 구조는 항목이 아니다(빼거나 문서 요약에)`
  if (HEAD_NUM.test(h) && !DATED.has(kind)) return `머리 「${h}」 에 장 번호: 떼고 대상 이름만`
  if (F.headRe && !F.headRe.test(h) && !(DATED.has(kind) && /주차/.test(h))) return `머리 「${h}」 꼴(${kind}): ${F.head}`
  return null
}
// 저장 알림 — 앞에 없던 것만(같은 code · where · msg) + 옛 머리의 「값:」 앞부분이 사라짐
export function lintFormNew(before, after, opt = {}) {
  const key = (x) => `${x.code}\n${x.where}\n${x.msg}`
  const had = new Map()
  for (const x of before == null ? [] : lintForm(before, opt)) had.set(key(x), (had.get(key(x)) || 0) + 1)
  const out = []
  for (const x of lintForm(after, opt)) {
    const n = had.get(key(x)) || 0
    if (n) had.set(key(x), n - 1)
    else out.push(x)
  }
  if (before != null) {
    const vals = (t) => new Set(parse(t).secs.map((s) => (s.h.match(/^([^:\s][^:]{0,40}):\s/) || [])[1]).filter(Boolean))
    const now = vals(after)
    for (const v of vals(before)) if (!now.has(v)) out.push({ code: 'head-value', level: 'fix', line: 1, where: v, msg: `옛 머리의 값 「${v}:」 이 사라졌다: 장부 값은 지우거나 바꾸지 않는다(장 번호만 뗀다)` })
  }
  return out
}

// 대장 — 원본 표 첫 열의 ID(IS01 · RQ12 · ISS-09) 가운데 머리에 없는 것
export function missingIds(sourceTexts, heads) {
  const ids = new Set()
  for (const t of sourceTexts) {
    const lines = String(t || '').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*\|/.test(lines[i])) continue
      for (const c of cellsOf(lines[i]).slice(0, 3)) if (/^[A-Z]{1,6}-?\d{1,4}$/.test(c)) { ids.add(c); break }
    }
  }
  const hs = heads.map((h) => String(h).trim())
  return [...ids].filter((id) => !hs.some((h) => h === id || h.startsWith(id + ':') || h.startsWith(id + ' ')))
}

// 짧게 — 줄 하나(저장 알림 · 동작 내역)
export const formMessage = (doc, xs) => `「${doc}」 서식(알림 · 저장은 했다): ${xs.slice(0, 3).map((x) => `${x.code}${x.where ? ` ${x.where.slice(0, 20)}` : ''}`).join(' / ')}${xs.length > 3 ? ` / 그 밖 ${xs.length - 3}` : ''}`
