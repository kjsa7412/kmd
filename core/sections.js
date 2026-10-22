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
