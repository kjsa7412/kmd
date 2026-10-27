// docx · pptx · xlsx → md — 서버가 바로 바꾼다(바깥 의존성 없이 zip + XML).
//
// 압축 해제 상한 — 항목마다 32MB · 모두 64MB · 압축률 200배 넘으면 거절(zip 폭탄). 넘으면 E_INPUT.
// 글만 옮긴다 — 제목 문단(Heading · 제목) → `#` · 표 → md 표 · 슬라이드마다 `## 슬라이드 n` · 시트마다 `## 시트 이름` + 표(500행).

import zlib from 'node:zlib'
import { KmdError } from './errors.js'

const ITEM_MAX = 32 << 20
const TOTAL_MAX = 64 << 20

// zip 의 가운데 목록을 읽어 { 이름 → 풀린 바이트 } (필요한 이름만)
export function unzip(buf, want = () => true) {
  const b = Buffer.from(buf)
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new KmdError('E_INPUT', 'zip 모양이 아니다')
  const count = b.readUInt16LE(eocd + 10)
  let p = b.readUInt32LE(eocd + 16)
  const out = new Map()
  let total = 0
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new KmdError('E_INPUT', 'zip 목록이 깨졌다')
    const method = b.readUInt16LE(p + 10)
    const csize = b.readUInt32LE(p + 20)
    const usize = b.readUInt32LE(p + 24)
    const nlen = b.readUInt16LE(p + 28)
    const elen = b.readUInt16LE(p + 30)
    const clen = b.readUInt16LE(p + 32)
    const off = b.readUInt32LE(p + 42)
    const name = b.slice(p + 46, p + 46 + nlen).toString('utf8')
    p += 46 + nlen + elen + clen
    if (!want(name)) continue
    if (usize > ITEM_MAX || (csize > 0 && usize / csize > 200 && usize > 1 << 20)) throw new KmdError('E_INPUT', `압축을 풀면 너무 크다: ${name}`)
    total += usize
    if (total > TOTAL_MAX) throw new KmdError('E_INPUT', '압축을 풀면 너무 크다')
    const lnlen = b.readUInt16LE(off + 26)
    const lelen = b.readUInt16LE(off + 28)
    const data = b.slice(off + 30 + lnlen + lelen, off + 30 + lnlen + lelen + csize)
    let raw
    if (method === 0) raw = data
    else if (method === 8) {
      try {
        raw = zlib.inflateRawSync(data, { maxOutputLength: ITEM_MAX })
      } catch {
        throw new KmdError('E_INPUT', `압축을 풀지 못했다: ${name}`)
      }
    } else throw new KmdError('E_INPUT', '모르는 압축 방식')
    out.set(name, raw)
  }
  return out
}

const ent = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&')
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
// 모든 줄이 빈 열은 뺀다(병합 · 띄움 열 — 빈 칸 「|  |」 만 Claude 에 보내지 않게)
const mdTable = (rows) => {
  if (!rows.length) return ''
  const w = Math.max(...rows.map((r) => r.length))
  const keep = Array.from({ length: w }, (_, i) => rows.some((r) => cell(r[i] ?? '')))
  if (!keep.some(Boolean)) return ''
  const full = rows.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? '').filter((_, i) => keep[i]))
  return [`| ${full[0].map(cell).join(' | ')} |`, `|${full[0].map(() => '---').join('|')}|`, ...full.slice(1).map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n')
}

// ── docx ──
function wText(xml) {
  return ent(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|\t|\n/g)
      ?.map((t) => (t.startsWith('<') ? t.replace(/<[^>]+>/g, '') : t))
      .join('') || '',
  )
}
export function docxToMd(buf) {
  const z = unzip(buf, (n) => n === 'word/document.xml')
  const xml = z.get('word/document.xml')?.toString('utf8')
  if (!xml) throw new KmdError('E_INPUT', 'docx 모양이 아니다')
  const body = (xml.match(/<w:body>([\s\S]*)<\/w:body>/) || [, xml])[1]
  const out = []
  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    const x = m[0]
    if (x.startsWith('<w:tbl')) {
      const rows = [...x.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) => [...c[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => wText(p[0])).join(' ')))
      if (rows.length) out.push(mdTable(rows))
      continue
    }
    // 목차 줄(목차 필드 · _Toc 책갈피로 가는 쪽 번호) — 본문 머리를 되풀이할 뿐이다
    if (/PAGEREF\s+_Toc|w:anchor="_Toc/.test(x)) continue
    const t = wText(x).trim()
    if (!t) continue
    const st = (x.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || ''
    const lv = /^(Heading|heading|제목)\s*(\d)$/.exec(st) || /^(\d)$/.exec(st) ? Number((st.match(/\d/) || ['2'])[0]) : 0
    if (/^Title$/i.test(st)) out.push(`# ${t}`)
    else if (lv) out.push(`${'#'.repeat(Math.min(6, lv + 1))} ${t}`)
    else if (/<w:numPr>/.test(x)) out.push(`- ${t}`)
    else out.push(t)
  }
  return out.join('\n\n')
}

// ── pptx ──
export function pptxToMd(buf) {
  const z = unzip(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  const slides = [...z.keys()].sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  if (!slides.length) throw new KmdError('E_INPUT', 'pptx 모양이 아니다')
  return slides
    .map((n, i) => {
      const xml = z.get(n).toString('utf8')
      const paras = [...xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((p) => ent((p[0].match(/<a:t>[^<]*<\/a:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join(''))).filter((t) => t.trim())
      return [`## 슬라이드 ${i + 1}${paras[0] ? `: ${paras[0]}` : ''}`, ...paras.slice(1)].join('\n\n')
    })
    .join('\n\n')
}

// ── xlsx ──
export function xlsxToMd(buf) {
  const z = unzip(buf, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  const wb = z.get('xl/workbook.xml')?.toString('utf8')
  if (!wb) throw new KmdError('E_INPUT', 'xlsx 모양이 아니다')
  const shared = [...(z.get('xl/sharedStrings.xml')?.toString('utf8') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => ent((m[1].match(/<t(?:\s[^>]*)?>[^<]*<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')))
  // 속성 차례는 만든 프로그램마다 다르다(Target 이 Id 앞에 오기도)
  const attr = (tag, n) => (new RegExp(`\\s${n}="([^"]*)"`).exec(tag) || [])[1]
  const rels = Object.fromEntries([...(z.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '').matchAll(/<Relationship\s[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]).filter(([k, v]) => k && v))
  const sheets = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({ name: ent(m[1]), file: 'xl/' + String(rels[m[2]] || '').replace(/^\/?xl\//, '') }))
  const col = (ref) => [...ref.replace(/\d+/g, '')].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1
  const out = []
  for (const s of sheets) {
    const xml = z.get(s.file)?.toString('utf8')
    if (!xml) continue
    const rows = []
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = []
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = (c[1].match(/r="([A-Z]+\d+)"/) || [])[1] || ''
        const t = (c[1].match(/t="([^"]+)"/) || [])[1]
        const v = ((c[2] || '').match(/<v>([^<]*)<\/v>/) || [])[1]
        const inl = ((c[2] || '').match(/<t(?:\s[^>]*)?>([^<]*)<\/t>/) || [])[1]
        row[col(ref)] = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? ent(inl || '') : ent(v ?? '')
      }
      if (row.some((x) => String(x ?? '').trim())) rows.push(Array.from(row, (x) => x ?? ''))
      if (rows.length >= 501) break
    }
    out.push(`## ${s.name}\n\n${mdTable(rows)}`)
  }
  return out.join('\n\n')
}

// ── hwpx(한글 · OWPML) — Contents/section*.xml 의 문단 · 표 ──
//   표는 문단 안에 든다 — 자리표로 먼저 빼 두고 문단을 차례로 읽는다 · 글은 <hp:t> 만
const hText = (x) =>
  ent(
    (x.match(/<hp:t(?:\s[^>]*)?>[\s\S]*?<\/hp:t>/g) || [])
      .map((t) => t.replace(/<hp:tab[^>]*\/>/g, '\t').replace(/<hp:lineBreak[^>]*\/>/g, '\n').replace(/<[^>]+>/g, ''))
      .join(''),
  )
export function hwpxToMd(buf) {
  const z = unzip(buf, (n) => /^Contents\/section\d+\.xml$/.test(n))
  const secs = [...z.keys()].sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  if (!secs.length) throw new KmdError('E_INPUT', 'hwpx 모양이 아니다')
  const out = []
  for (const n of secs) {
    const tables = []
    const xml = z.get(n).toString('utf8').replace(/<hp:tbl[ >][\s\S]*?<\/hp:tbl>/g, (t) => {
      tables.push(t)
      return `<hp:t>\u0000T${tables.length - 1}\u0000</hp:t>`
    })
    for (const m of xml.matchAll(/<hp:p[ >][\s\S]*?<\/hp:p>/g)) {
      for (const part of hText(m[0]).split(/(\u0000T\d+\u0000)/)) {
        const tm = /^\u0000T(\d+)\u0000$/.exec(part)
        if (tm) {
          const rows = [...tables[Number(tm[1])].matchAll(/<hp:tr[ >][\s\S]*?<\/hp:tr>/g)].map((r) => [...r[0].matchAll(/<hp:tc[ >][\s\S]*?<\/hp:tc>/g)].map((c) => hText(c[0]).replace(/\s+/g, ' ').trim()))
          if (rows.length) out.push(mdTable(rows))
        } else if (part.trim()) out.push(part.trim())
      }
    }
  }
  return out.join('\n\n')
}

export function convert(name, buf) {
  const ext = String(name).toLowerCase().split('.').pop()
  if (ext === 'docx') return docxToMd(buf)
  if (ext === 'pptx') return pptxToMd(buf)
  if (ext === 'xlsx') return xlsxToMd(buf)
  if (ext === 'hwpx') return hwpxToMd(buf)
  throw new KmdError('E_INPUT', '바꿀 수 없는 종류')
}
