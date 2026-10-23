// 저절로 채우는 표(기준선 블록) — 원천을 규칙으로 읽은 결과를 항목 글 안에 둔다(v0.6 §5).
//
//   <!-- baseline: src="dpms-api 코드" rule=deps asof="2026-10-23 10:00" -->
//   | 꾸러미 | 판 |
//   |---|---|
//   | spring-boot | 3.3.4 |
//   <!-- /baseline -->
//
// 블록 안은 원천 실행기 · 기계 열쇠만 쓴다(사람 · 세션의 저장은 블록을 그대로 둔다 — 고치려 하면 E_FORBIDDEN need:machine).
// 같은 원천 · 같은 규칙이면 같은 글이 나온다(결정적 · 정렬 고정). 블록 글이 같으면 쓰지 않는다(확인 시각만 — 묶음 0).

import { nfc } from './text.js'

const OPEN = /^<!--\s*baseline:\s*(.*?)\s*-->\s*$/
const CLOSE = /^<!--\s*\/baseline\s*-->\s*$/

function attrs(s) {
  const out = {}
  for (const m of String(s).matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)) out[m[1]] = m[2] ?? m[3]
  return out
}

// 항목 글 → { text(블록 자리 표시), blocks: [{ src, rule, asof, missing, table }] }
export function splitBlocks(body) {
  const lines = String(body || '').split('\n')
  const blocks = []
  const text = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(OPEN)
    if (!m) {
      text.push(lines[i])
      continue
    }
    const a = attrs(m[1])
    const inner = []
    let j = i + 1
    while (j < lines.length && !CLOSE.test(lines[j])) inner.push(lines[j++])
    blocks.push({ src: a.src || '', rule: a.rule || '', asof: a.asof || '', missing: a.missing || null, table: inner.join('\n').trim() })
    text.push(`\u0000block${blocks.length - 1}\u0000`)
    i = j
  }
  return { text: text.join('\n'), blocks }
}

const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim()
export function tableMd(cols, rows) {
  return [`| ${cols.map(esc).join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${cols.map((_, i) => esc(r[i])).join(' | ')} |`)].join('\n')
}
export function blockMd({ src, rule, asof, missing = null, table }) {
  const a = [`src="${String(src).replace(/"/g, "'")}"`, `rule=${rule}`, `asof="${asof}"`, ...(missing ? [`missing="${missing}"`] : [])]
  return `<!-- baseline: ${a.join(' ')} -->\n${table}\n<!-- /baseline -->`
}
// 블록 표를 다시 칸으로(화면 · 견주기)
export function parseTable(md) {
  const ls = String(md || '').split('\n').filter((l) => /^\s*\|/.test(l))
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())
  if (ls.length < 2) return { cols: [], rows: [] }
  return { cols: cells(ls[0]), rows: ls.slice(2).map(cells) }
}
const norm = (t) => nfc(String(t || '')).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
export const sameTable = (a, b) => norm(a) === norm(b)
// 옛 표와 규칙 결과 — 칸이 같고 줄의 모임이 같으면 같다(옛 표는 줄 차례가 다를 수 있다)
export function sameRows(a, b) {
  const x = parseTable(a)
  const y = parseTable(b)
  const key = (t) => JSON.stringify([t.cols.map((c) => nfc(c)), t.rows.map((r) => r.map((c) => nfc(c)).join('\u0001')).sort()])
  return x.cols.length > 0 && key(x) === key(y)
}

// 글에 블록을 넣거나 갈아 끼운다(같은 원천 · 규칙의 블록 자리) — 블록 밖 글은 그대로
export function putBlock(body, block) {
  const { text, blocks } = splitBlocks(body)
  const i = blocks.findIndex((b) => b.src === block.src && b.rule === block.rule)
  const all = i >= 0 ? blocks.map((b, j) => (j === i ? block : b)) : [...blocks, block]
  let out = text
  if (i < 0) out = (out.trim() ? out.replace(/\s+$/, '') + '\n\n' : '') + `\u0000block${all.length - 1}\u0000`
  return out.replace(/\u0000block(\d+)\u0000/g, (_, n) => blockMd(all[Number(n)])).trim()
}

// 사람 · 세션이 쓴 새 글에 원래 블록을 그대로 다시 단다(블록 자리는 원래 차례대로 · 새 글에 섞인 블록 표지는 걷는다)
export function keepBlocks(oldBody, newBody) {
  const { blocks } = splitBlocks(oldBody)
  const cleaned = splitBlocks(newBody).text.replace(/\u0000block\d+\u0000/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (!blocks.length) return cleaned
  return [cleaned, ...blocks.map(blockMd)].filter(Boolean).join('\n\n')
}
export const hasBlockMarker = (s) => /<!--\s*\/?baseline/i.test(String(s || ''))

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
  // 파일 목록 — 같은 종류 코드 파일 5개 넘는 폴더 · 이름 · 첫 설명 줄
  files(files) {
    const by = new Map()
    for (const f of files) {
      if (SKIP.test(f.path)) continue
      const m = f.path.match(/^(.*)\/([^/]+)\.(js|mjs|ts|tsx|jsx|java|py|go|kt|cs|sql|xml)$/i)
      if (!m) continue
      const key = `${m[1]} · ${m[3].toLowerCase()}`
      if (!by.has(key)) by.set(key, [])
      const first = (f.text.split('\n').find((l) => /^\s*(\/\/|#|\*|--|\/\*\*?)\s*\S/.test(l)) || '').replace(/^\s*(\/\/|#|\*|--|\/\*\*?)\s*/, '').trim().slice(0, 80)
      by.get(key).push([`${m[2]}.${m[3]}`, first])
    }
    return [...by.entries()].filter(([, r]) => r.length > 5).map(([key, rows]) => ({ key, cols: ['파일', '첫 설명'], rows: rows.sort((a, b) => a[0].localeCompare(b[0])) })).sort((a, b) => a.key.localeCompare(b.key))
  },
}

// 살펴보기 — 파일들을 보고 어떤 규칙이 무엇을 내는지(초안)
export function probe(files) {
  return Object.entries(RULES).map(([rule, f]) => ({ rule, items: f(files) })).filter((x) => x.items.length)
}
