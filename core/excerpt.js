// 넣기 에이전트의 항목 글 — 파일 글은 서버가 옮긴다(모델이 다시 쓰지 않는다 · 출력은 입력보다 비싸다).
//
//   from    "*"(파일 글 전체) 또는 파일 글 속 머리 하나 — 그 머리 아래 글(다음 같거나 높은 머리 앞까지)을 옮긴다.
//           파일 글 = 기록의 「## 본문」 아래(Claude 가 정리한 기록) · 없으면 기록 글 전체(맨 앞 # 제목 줄 뺌).
//           옮긴 글의 머리는 ### 아래로 내린다(항목 머리 ## 와 섞이지 않게). content 가 있으면 그 글 다음에 붙인다.
//   append  지금 항목 글 끝에 이 글을 보탠다(지금 글을 다시 보내지 않는다).
// 값은 원문 그대로 남고 모델은 자리 · 잇는 말 · 바뀐 값만 쓴다.

import { headingMatches } from './sections.js'
import { sectionOf } from './knowledge.js'
import { KmdError } from './errors.js'

const HEAD = /^(#{1,6})\s+(.*?)\s*#*\s*$/

// 기록 글 → 파일 글
export function fileText(body) {
  const lines = String(body || '').split('\n')
  const at = lines.findIndex((l) => /^## 본문\s*$/.test(l))
  const rest = at >= 0 ? lines.slice(at + 1) : lines[0]?.startsWith('# ') ? lines.slice(1) : lines
  // 「원문 「…」 의 짜임 그대로 — 값은 원문과 같다.」 안내 줄은 뺀다
  if (at >= 0 && /^\s*$/.test(rest[0] || '')) rest.shift()
  if (at >= 0 && /^원문 「.*」 의 짜임 그대로/.test(rest[0] || '')) rest.shift()
  return rest.join('\n').trim()
}

// 머리를 맞춘다 — 가장 높은 머리가 ### 가 되게(기록 정리가 #### 로 내린 것도 올린다 · 코드 덩이 안은 그대로)
function lower(text) {
  let fence = false
  const levels = []
  for (const l of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    const m = !fence && HEAD.exec(l)
    if (m) levels.push(m[1].length)
  }
  const by = levels.length ? 3 - Math.min(...levels) : 0
  fence = false
  return text
    .split('\n')
    .map((l) => {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence
      const m = !fence && HEAD.exec(l)
      return m ? `${'#'.repeat(Math.min(6, Math.max(3, m[1].length + by)))} ${m[2]}` : l
    })
    .join('\n')
}

// 파일 글에서 머리 하나 아래 글 · "*" 면 전체
export function excerpt(body, part) {
  const text = fileText(body)
  if (String(part).trim() === '*') return lower(text)
  const lines = text.split('\n')
  const want = String(part).replace(/^#+\s*/, '').trim()
  let fence = false
  let start = -1
  let level = 0
  const heads = []
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence
    const m = !fence && HEAD.exec(lines[i])
    if (!m) continue
    heads.push(m[2])
    if (start < 0 && headingMatches(m[2], want)) {
      start = i
      level = m[1].length
    } else if (start >= 0 && m[1].length <= level) {
      return lower(lines.slice(start + 1, i).join('\n').trim())
    }
  }
  if (start < 0) throw new KmdError('E_INPUT', `파일 글에 그 머리가 없다 — 「${want}」 · 있는 머리: ${heads.slice(0, 30).join(' · ') || '없음(전체는 "*")'}`)
  return lower(lines.slice(start + 1).join('\n').trim())
}

// 에이전트의 sections — from · append 를 풀어 보통 sections(content 전체)로
export function expandSections(k, w, sections) {
  if (!Array.isArray(sections)) return sections
  return sections.map((s) => {
    if (!s || (s.from == null && !s.append)) return s
    const { from, append, ...rest } = s
    if (from != null && !w) throw new KmdError('E_NOTFOUND', '옮길 파일 글(이 일의 기록)이 없다')
    let content = [typeof s.content === 'string' ? s.content.trim() : '', from != null ? excerpt(w?.body, from) : ''].filter(Boolean).join('\n\n')
    if (!content) throw new KmdError('E_INPUT', '항목 글이 비었다 — content 또는 from 을 준다')
    if (append) {
      const cur = s.coord ? sectionOf(k, String(s.coord).trim().normalize('NFC'))?.sec : k.docs.find((d) => d.id === String(s.doc || '').replace(/^docs\/|\.md$/g, ''))?.sections.find((y) => headingMatches(y.h, String(s.heading || '')))
      // section 이 주는 content 와 같은 글(sec.body) 끝에
      content = [String(cur?.body || '').trim(), content].filter(Boolean).join('\n\n')
    }
    return { ...rest, content }
  })
}
