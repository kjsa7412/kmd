// hwp(한글 97 뒤 · HWP 5) → md — 서버가 바로 바꾼다(바깥 의존성 없이 · ooxml.js 와 같은 자리).
//
// 짜임  복합 파일(CFB) 안의 FileHeader · BodyText/Section* — 섹션은 레코드(태그 · 깊이 · 크기)의 줄이고 압축이면 deflate.
// 글     PARA_TEXT(UTF-16) — 제어 글자는 뺀다(문단 끝 · 줄바꿈은 살리고 탭은 칸으로). 문단마다 한 줄.
// 표     'tbl ' 제어 아래의 칸(LIST_HEADER — 행 · 열 자리) 글을 모아 md 표로. 표 안의 표는 그 칸의 글로 편다.
// 뺀다   머리말 · 꼬리말(쪽마다 되풀이되는 글) · 쪽 번호.
// 못 바꾸는 것 — 암호 · 배포용 문서 · 깨진 파일 → E_INPUT(부르는 쪽이 Claude 로 옮긴다). 글이 거의 없으면 빈 글.

import zlib from 'node:zlib'
import { KmdError } from './errors.js'

const MAX = 64 << 20
const END = 0xfffffffe

// ── 복합 파일(CFB) — { 경로 → 바이트 } ──
export function readCfb(buf) {
  const b = Buffer.from(buf)
  if (b.length < 512 || b.readUInt32LE(0) !== 0xe011cfd0 || b.readUInt32LE(4) !== 0xe11ab1a1) throw new KmdError('E_INPUT', 'hwp 모양이 아니다')
  const ss = 1 << b.readUInt16LE(30)
  const mss = 1 << b.readUInt16LE(32)
  const nFat = b.readUInt32LE(44)
  const dir0 = b.readUInt32LE(48)
  const cutoff = b.readUInt32LE(56)
  const mfat0 = b.readUInt32LE(60)
  let difat = b.readUInt32LE(68)
  const at = (s) => 512 + s * ss
  const fatSecs = []
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(b.readUInt32LE(76 + i * 4))
  for (let guard = 0; fatSecs.length < nFat && difat < END && guard < 10000; guard++) {
    for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) fatSecs.push(b.readUInt32LE(at(difat) + i * 4))
    difat = b.readUInt32LE(at(difat) + ss - 4)
  }
  const fat = []
  for (const s of fatSecs) for (let i = 0; i < ss / 4; i++) fat.push(at(s) + i * 4 + 4 <= b.length ? b.readUInt32LE(at(s) + i * 4) : END)
  const chain = (s, table) => {
    const out = []
    for (let n = 0; s < END && n < table.length; n++) {
      out.push(s)
      s = table[s]
    }
    return out
  }
  const read = (s, size) => {
    const parts = chain(s, fat).map((x) => b.subarray(at(x), at(x) + ss))
    return Buffer.concat(parts).subarray(0, size)
  }
  const dirBuf = read(dir0, chain(dir0, fat).length * ss)
  const ents = []
  for (let o = 0; o + 128 <= dirBuf.length; o += 128) {
    const nl = dirBuf.readUInt16LE(o + 64)
    ents.push({ name: dirBuf.subarray(o, o + Math.max(0, nl - 2)).toString('utf16le'), type: dirBuf[o + 66], left: dirBuf.readUInt32LE(o + 68), right: dirBuf.readUInt32LE(o + 72), child: dirBuf.readUInt32LE(o + 76), start: dirBuf.readUInt32LE(o + 116), size: dirBuf.readUInt32LE(o + 120) })
  }
  const root = ents[0]
  if (!root || root.type !== 5) throw new KmdError('E_INPUT', 'hwp 목록이 깨졌다')
  const ministream = root.size ? read(root.start, root.size) : Buffer.alloc(0)
  const mfat = []
  if (mfat0 < END) for (const s of chain(mfat0, fat)) for (let i = 0; i < ss / 4; i++) mfat.push(b.readUInt32LE(at(s) + i * 4))
  const files = new Map()
  let total = 0
  const walk = (i, pre, seen = new Set()) => {
    if (i >= ents.length || seen.has(i)) return
    seen.add(i)
    const e = ents[i]
    walk(e.left, pre, seen)
    walk(e.right, pre, seen)
    const p = pre + e.name
    if (e.type === 1) walk(e.child, p + '/', seen)
    else if (e.type === 2) {
      if (e.size > MAX || (total += e.size) > MAX) throw new KmdError('E_INPUT', 'hwp 가 너무 크다')
      files.set(p, e.size < cutoff ? Buffer.concat(chain(e.start, mfat).map((x) => ministream.subarray(x * mss, x * mss + mss))).subarray(0, e.size) : read(e.start, e.size))
    }
  }
  walk(root.child, '')
  return files
}

// ── 레코드 — [{ tag, level, data }] ──
function records(buf) {
  const out = []
  let p = 0
  while (p + 4 <= buf.length) {
    const h = buf.readUInt32LE(p)
    p += 4
    let size = h >>> 20
    if (size === 0xfff) {
      if (p + 4 > buf.length) break
      size = buf.readUInt32LE(p)
      p += 4
    }
    out.push({ tag: h & 0x3ff, level: (h >>> 10) & 0x3ff, data: buf.subarray(p, p + size) })
    p += size
  }
  return out
}

const PARA_TEXT = 67
const CTRL_HEADER = 71
const LIST_HEADER = 72
const TABLE = 77
// 제어 글자 — 한 칸(0 · 10 · 13 · 24~31) · 나머지는 여덟 칸(제어 id · 자리를 품는다)
const ONE = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31])

function paraText(data) {
  let s = ''
  for (let i = 0; i + 1 < data.length; ) {
    const c = data.readUInt16LE(i)
    if (c >= 32) { s += String.fromCharCode(c); i += 2; continue }
    if (c === 10) s += '\n'
    else if (c === 9) s += '\t'
    else if (c === 30 || c === 31) s += ' ' // 묶음 빈칸 · 고정폭 빈칸
    i += ONE.has(c) ? 2 : 16
  }
  return s.replace(/[ \t]+$/gm, '').trim()
}
const ctrlId = (data) => (data.length >= 4 ? String.fromCharCode(data[3], data[2], data[1], data[0]) : '')

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
function mdTable(grid) {
  const rows = grid.filter((r) => r && r.some((x) => String(x ?? '').trim()))
  if (!rows.length) return ''
  const w = Math.max(...rows.map((r) => r.length))
  if (rows.length === 1 || w === 1) return rows.map((r) => r.map((x) => cell(x ?? '')).filter(Boolean).join(' · ')).join('\n')
  const full = rows.map((r) => Array.from({ length: w }, (_, i) => cell(r[i] ?? '')))
  return [`| ${full[0].join(' | ')} |`, `|${full[0].map(() => '---').join('|')}|`, ...full.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n')
}

// 섹션 하나 → 덩이들(문단 글 · 표 md)
function sectionMd(buf) {
  const rs = records(buf)
  const out = []
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i]
    if (r.tag === PARA_TEXT && r.level === 1) {
      const t = paraText(r.data)
      if (t) out.push(t)
      continue
    }
    if (r.tag !== CTRL_HEADER) continue
    const id = ctrlId(r.data)
    const L = r.level
    let j = i + 1
    while (j < rs.length && rs[j].level > L) j++
    if (id === 'tbl ') {
      const grid = []
      let cur = null
      for (let x = i + 1; x < j; x++) {
        const y = rs[x]
        if (y.tag === LIST_HEADER && y.level === L + 1 && y.data.length >= 12) {
          const col = y.data.readUInt16LE(8)
          const row = y.data.readUInt16LE(10)
          ;(grid[row] ||= [])[col] = ''
          cur = { row, col }
        } else if (y.tag === PARA_TEXT && cur) {
          const t = paraText(y.data)
          if (t) grid[cur.row][cur.col] = (grid[cur.row][cur.col] ? grid[cur.row][cur.col] + ' ' : '') + t
        } else if (y.tag === TABLE && y.level === L + 1 && !grid.length && y.data.length >= 8) {
          for (let k = 0; k < Math.min(y.data.readUInt16LE(4), 2000); k++) grid[k] = []
        }
      }
      const md = mdTable(Array.from(grid, (r) => Array.from(r || [], (x) => x ?? '')))
      if (md) out.push(md)
    } else if (id !== 'head' && id !== 'foot' && id !== 'pgnp' && id !== 'pghd') {
      // 글상자 · 각주 따위 — 안의 문단 글을 차례로
      for (let x = i + 1; x < j; x++) if (rs[x].tag === PARA_TEXT) { const t = paraText(rs[x].data); if (t) out.push(t) }
    }
    i = j - 1
  }
  return out
}

export function hwpToMd(buf) {
  const files = readCfb(buf)
  const head = files.get('FileHeader')
  if (!head || !head.subarray(0, 17).toString('latin1').startsWith('HWP Document File')) throw new KmdError('E_INPUT', 'hwp 모양이 아니다')
  const prop = head.readUInt32LE(36)
  if (prop & 2) throw new KmdError('E_INPUT', '암호가 걸린 hwp')
  if (prop & 4) throw new KmdError('E_INPUT', '배포용 hwp — 글을 꺼낼 수 없다')
  const secs = [...files.keys()].filter((n) => /^BodyText\/Section\d+$/.test(n)).sort((a, b) => Number(a.match(/\d+$/)[0]) - Number(b.match(/\d+$/)[0]))
  if (!secs.length) throw new KmdError('E_INPUT', 'hwp 본문이 없다')
  const out = []
  for (const n of secs) {
    let data = files.get(n)
    if (prop & 1) {
      try {
        data = zlib.inflateRawSync(data, { maxOutputLength: MAX })
      } catch {
        throw new KmdError('E_INPUT', `hwp 본문을 풀지 못했다 — ${n}`)
      }
    }
    out.push(...sectionMd(data))
  }
  return out.join('\n\n')
}
