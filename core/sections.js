// 문서를 항목으로 가른다 — 항목 = `## 머리` 아래의 글.
//
// 코드 울타리(``` · ~~~) 안의 `#` 은 머리가 아니다. 항목 하나는 다음 같은 깊이 이상의
// 머리 앞까지다 — `## 가` 아래의 `### 나` 는 가에 든다.
//
// `<!-- applied: <기록 id> -->` 는 「이 항목에 마지막으로 넣은 기록」 표지다. 읽을 때
// 떼어 applied 로 돌려주고, 쓸 때 kmd 가 다시 붙인다.

const APPLIED = /^<!--\s*applied:\s*(.+?)\s*-->\s*$/

export function headsOf(lines) {
  const heads = []
  let fence = null
  lines.forEach((ln, i) => {
    const f = ln.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (f) {
      if (!fence) fence = f[1]
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      return
    }
    if (fence) return
    const m = ln.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) heads.push({ level: m[1].length, heading: m[2].trim(), line: i })
  })
  heads.forEach((h, i) => {
    h.end = lines.length
    for (let j = i + 1; j < heads.length; j++)
      if (heads[j].level <= h.level) {
        h.end = heads[j].line
        break
      }
  })
  return heads
}

function bodyOf(lines, from, to) {
  let applied = null
  const out = []
  for (let i = from; i < to; i++) {
    const m = lines[i].match(APPLIED)
    if (m && applied == null) applied = m[1]
    else out.push(lines[i])
  }
  return { body: out.join('\n').replace(/^\n+|\s+$/g, ''), applied }
}

// 문서 하나 → { title, intro, sections: [{ h, level, body, applied }] }
export function parseDoc(text, fallbackTitle) {
  const lines = text.split('\n')
  const heads = headsOf(lines)
  const h1 = heads.find((h) => h.level === 1)
  const secs = heads.filter((h) => h.level === 2)
  const introFrom = h1 ? h1.line + 1 : 0
  const introTo = secs.length ? secs[0].line : lines.length
  return {
    title: h1 ? h1.heading : fallbackTitle,
    intro: introFrom < introTo ? bodyOf(lines, introFrom, introTo).body : '',
    sections: secs.map((h) => ({ h: h.heading, level: 2, ...bodyOf(lines, h.line + 1, h.end) })),
  }
}

// 머리 이름 맞추기 — 「rp_mst — 연구과제마스터」 는 값 rp_mst 의 항목이다
export function headingMatches(heading, want) {
  const a = heading.normalize('NFC')
  const b = want.normalize('NFC')
  return a === b || a.startsWith(b + ' ')
}

// 항목 하나를 뺀다(머리째) — 없으면 그대로. 다른 줄은 바이트 그대로 둔다
export function removeSection(text, { level = 2, heading }) {
  const lines = text.split('\n')
  const h = headsOf(lines).find((x) => x.level === level && headingMatches(x.heading, heading))
  if (!h) return text
  return [...lines.slice(0, h.line), ...lines.slice(h.end)].join('\n').replace(/\n*$/, '\n')
}
// 항목 이름만 바꾼다 — 글 · 표지는 그대로
export function renameSection(text, { level = 2, heading, to }) {
  const lines = text.split('\n')
  const h = headsOf(lines).find((x) => x.level === level && headingMatches(x.heading, heading))
  if (!h) return text
  lines[h.line] = `${'#'.repeat(level)} ${to}`
  return lines.join('\n')
}

// 항목 하나를 갈아 끼운다 — 없으면 문서 끝에 새로 붙인다. 다른 줄은 바이트 그대로 둔다
export function replaceSection(text, { level = 2, heading, body, applied }) {
  const lines = text.split('\n')
  const h = headsOf(lines).find((x) => x.level === level && headingMatches(x.heading, heading))
  const block = [...(applied ? [`<!-- applied: ${applied} -->`] : []), ...String(body).replace(/^\n+|\s+$/g, '').split('\n')]
  if (h) {
    const tail = lines.slice(h.end)
    const next = tail.length && tail.some((l) => l.trim()) ? [''] : []
    return [...lines.slice(0, h.line + 1), ...block, ...next, ...tail].join('\n').replace(/\n*$/, '\n')
  }
  const base = text.replace(/\s+$/, '')
  return `${base}${base ? '\n\n' : ''}${'#'.repeat(level)} ${heading}\n${block.join('\n')}\n`
}

// 모든 항목(## 머리)에 같은 표지를 단다 — 있던 표지는 걷는다(통째로 들인 문서 · 그 문서가 온 기록). 다른 줄은 그대로
export function stampAll(text, applied) {
  const lines = String(text).split('\n')
  const heads = new Set(headsOf(lines).filter((h) => h.level === 2).map((h) => h.line))
  const out = []
  let fence = null
  lines.forEach((ln, i) => {
    const f = ln.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (f) fence = !fence ? f[1] : f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence
    if (!fence && !f && APPLIED.test(ln)) return
    out.push(ln)
    if (heads.has(i)) out.push(`<!-- applied: ${applied} -->`)
  })
  return out.join('\n')
}

// 경과 — 항목 끝 `**경과**` 아래 한 줄씩 「- YYYY-MM-DD [기록 제목](../work/<id>.md)」.
//   이 항목에 무엇이 언제 어느 기록에서 들어왔나를 글 안에서 보인다(CDP 의 경과와 같은 모양).
//   줄은 kmd 가 단다 — 사람 · Claude 는 본문만 쓰고, 저장이 옛 줄을 지키며 이번에 넣은 기록의 줄을 더한다(지우지 않는다).
const LOG_HEAD = /^\*\*경과\*\*\s*$/
export function splitLog(body) {
  const text = String(body ?? '').replace(/\s+$/, '')
  const lines = text.split('\n')
  const at = lines.findLastIndex((l) => LOG_HEAD.test(l.trim()))
  const tail = at < 0 ? [] : lines.slice(at + 1)
  // 끝까지 목록 줄만이어야 경과다 — 그 밖의 글이 따라오면 본문의 굵은 글로 본다
  if (at < 0 || tail.some((l) => l.trim() && !/^\s*- /.test(l))) return { body: text.trim(), log: [] }
  return { body: lines.slice(0, at).join('\n').trim(), log: tail.map((l) => l.trim()).filter(Boolean) }
}
export const joinLog = (body, log) => (log.length ? [String(body).trim(), `**경과**\n${log.join('\n')}`].filter(Boolean).join('\n\n') : String(body).trim())
const linkId = (id) => encodeURI(id).replace(/\(/g, '%28').replace(/\)/g, '%29')
// 기록 하나의 경과 줄 — 링크는 그 문서에서 본 상대 경로(docs/X.md 면 ../work/…)
export function logLine(docRel, w) {
  const up = '../'.repeat(String(docRel).split('/').length - 1)
  const title = String(w.title || w.id).split(' — ')[0].replace(/[[\]]/g, '').trim()
  return `- ${String(w.date || '').slice(0, 10)} [${title}](${up}${w.sub || 'work'}/${linkId(w.id)}.md)`
}
export const logHas = (log, id) => log.some((l) => l.includes(`/${linkId(id)}.md)`) || l.includes(`/${id}.md)`))
