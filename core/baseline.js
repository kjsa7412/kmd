// 표 원천 규칙(가져올 곳의 deps · tables · 꾸러미 찾기 probe)과 표 글(tableMd · parseTable).
//
//   옛 「저절로 채우는 표」 블록(<!-- baseline: … --> 표 <!-- /baseline -->)은 새로 쓰지 않는다(가져온 표는 원천이다 · H-D36).
//   블록을 읽는 곳은 없다. 팀 지식에는 블록이 없고 개인 지식은 열 때 이행기(core/oldform.js)가 블록 표식을 걷는다(옛잔재 G5b).
//   본문에 남은 블록 표식은 표지 밖 주석이라 저장 검사(E_FORMAT)가 거절한다.

const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim()
export function tableMd(cols, rows) {
  return [`| ${cols.map(esc).join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${cols.map((_, i) => esc(r[i])).join(' | ')} |`)].join('\n')
}
// 표 글을 다시 칸으로
export function parseTable(md) {
  const ls = String(md || '').split('\n').filter((l) => /^\s*\|/.test(l))
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())
  if (ls.length < 2) return { cols: [], rows: [] }
  return { cols: cells(ls[0]), rows: ls.slice(2).map(cells) }
}
// ── 닫힌 규칙 — 원천 파일들 → 항목들 [{ key(머리), cols, rows }] ──
// files: [{ path, text }] (1MB 이하만 · 숨김 · .git · node_modules 밖)
const SKIP = /(^|\/)(\.|node_modules\/|test\/|tests\/|attic\/|dist\/|build\/|target\/)/
export const RULES = {
  // 의존성 판 — package.json · pyproject.toml · pom.xml · build.gradle · go.mod
  deps(files) {
    const rows = []
    for (const f of files) {
      if (SKIP.test(f.path)) continue
      const base = f.path.split('/').pop()
      try {
        if (base === 'package.json') {
          const j = JSON.parse(f.text)
          for (const [n, v] of Object.entries({ ...(j.dependencies || {}), ...(j.devDependencies || {}) })) rows.push([n, String(v).replace(/^[\^~]/, '')])
        } else if (base === 'go.mod') {
          for (const m of f.text.matchAll(/^\s*(?:require\s+)?([\w.\-/]+\.[\w.\-/]+)\s+(v[\w.\-+]+)/gm)) rows.push([m[1], m[2]])
        } else if (base === 'pom.xml') {
          for (const m of f.text.matchAll(/<dependency>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?(?:<version>([^<]+)<\/version>)?[\s\S]*?<\/dependency>/g)) rows.push([m[1].trim(), (m[2] || '').trim()])
        } else if (/^build\.gradle(\.kts)?$/.test(base)) {
          for (const m of f.text.matchAll(/(?:implementation|api|compile|runtimeOnly|testImplementation)\s*\(?\s*["']([^:"']+):([^:"']+):([^"']+)["']/g)) rows.push([m[2], m[3]])
        } else if (base === 'pyproject.toml') {
          const deps = (f.text.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m) || [])[1] || ''
          for (const m of deps.matchAll(/["']([A-Za-z0-9_.\-]+)\s*([<>=!~]=?\s*[\w.*]+)?/g)) rows.push([m[1], (m[2] || '').replace(/\s+/g, '')])
        }
      } catch {}
    }
    const uniq = [...new Map(rows.map((r) => [r[0], r])).values()].sort((a, b) => a[0].localeCompare(b[0]))
    return uniq.length ? [{ key: null, cols: ['꾸러미', '판'], rows: uniq }] : []
  },
  // 표 파일 — csv · tsv · 객체 배열 json(파일마다 표 하나 · 500행)
  tables(files) {
    const out = []
    for (const f of files) {
      if (SKIP.test(f.path) || f.text.length > 1 << 20) continue
      const m = f.path.match(/([^/]+)\.(csv|tsv|json)$/i)
      if (!m) continue
      let cols = []
      let rows = []
      if (m[2].toLowerCase() === 'json') {
        try {
          const j = JSON.parse(f.text)
          if (!Array.isArray(j) || !j.length || typeof j[0] !== 'object') continue
          cols = Object.keys(j[0])
          rows = j.map((o) => cols.map((c) => (o[c] == null ? '' : typeof o[c] === 'object' ? JSON.stringify(o[c]) : String(o[c]))))
        } catch {
          continue
        }
      } else {
        const sep = m[2].toLowerCase() === 'tsv' ? '\t' : ','
        const ls = f.text.replace(/\r/g, '').split('\n').filter((l) => l.trim())
        if (ls.length < 1) continue
        const split = (l) => (sep === ',' ? [...l.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].map((x) => x[1].replace(/^"|"$/g, '').replace(/""/g, '"')).slice(0, -1) : l.split('\t'))
        cols = split(ls[0])
        rows = ls.slice(1).map(split)
      }
      out.push({ key: m[1], cols, rows: rows.slice(0, 500) })
    }
    return out.sort((a, b) => a.key.localeCompare(b.key))
  },
}

// 살펴보기 — 파일들을 보고 어떤 규칙이 무엇을 내는지(초안)
export function probe(files) {
  return Object.entries(RULES).map(([rule, f]) => ({ rule, items: f(files) })).filter((x) => x.items.length)
}
