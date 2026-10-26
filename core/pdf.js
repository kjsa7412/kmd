// pdf → 글 — 서버가 바로 꺼낸다(pdf.js · Claude 없이). 글 층이 없는 pdf(스캔)만 Claude 로 옮긴다.
//
// 글     쪽마다 글 조각을 줄로 모은다(같은 높이 · 조각 사이가 벌면 빈칸).
// 뺀다   쪽마다 되풀이되는 머리글 · 바닥글(쪽 위아래 두 줄 · 숫자는 같게 보고 쪽의 절반 넘게 나오면) · 쪽 번호 줄.
// 빈 글  쪽당 글자가 거의 없으면 '' — 스캔이다(부르는 쪽이 Claude 로).
// 표는 줄로 편다(칸 짜임은 살리지 못한다).

import path from 'node:path'
import { createRequire } from 'node:module'
import { KmdError } from './errors.js'

const MAX_PAGES = 2000
const SCAN_PER_PAGE = 20 // 쪽당 이만큼(빈칸 뺀 글자)이 안 되면 스캔으로 본다

let lib = null
async function pdfjs() {
  if (lib) return lib
  try {
    const require = createRequire(import.meta.url)
    const root = path.dirname(require.resolve('pdfjs-dist/package.json'))
    const m = await import('pdfjs-dist/legacy/build/pdf.mjs')
    lib = { m, cmaps: path.join(root, 'cmaps') + path.sep, fonts: path.join(root, 'standard_fonts') + path.sep }
  } catch {
    throw new KmdError('E_INPUT', 'pdf 를 읽는 꾸러미가 없다')
  }
  return lib
}

// 쪽 하나의 글 조각 → 줄들
function pageLines(items) {
  const lines = []
  let cur = ''
  let y = null
  let endX = null
  for (const it of items) {
    if (typeof it.str !== 'string') continue
    const [, , , d, x, yy] = it.transform || [0, 0, 0, 0, 0, 0]
    const h = Math.abs(d) || it.height || 10
    if (y != null && Math.abs(yy - y) > h * 0.5) {
      lines.push(cur)
      cur = ''
      endX = null
    } else if (endX != null && it.str && x - endX > h * 0.25 && !/\s$/.test(cur) && !/^\s/.test(it.str)) cur += ' '
    cur += it.str
    if (it.str) {
      y = yy
      endX = x + (it.width || 0)
    }
    if (it.hasEOL) {
      lines.push(cur)
      cur = ''
      endX = null
      y = null
    }
  }
  if (cur) lines.push(cur)
  return lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

const PAGE_NO = /^(?:[-–—(\[]?\s*\d{1,4}\s*[-–—)\]]?|\d{1,4}\s*\/\s*\d{1,4}|page\s*\d+(?:\s*of\s*\d+)?|-\s*\d+\s*-|\d+\s*쪽)$/i
const shape = (l) => l.replace(/\d+/g, '#')

// 쪽들(줄 목록) → 글 · 쪽 번호 줄을 빼고, 쪽의 첫 줄 · 끝 줄이 쪽의 절반 넘게 같으면(숫자는 같게 본다) 머리글 · 바닥글로 뺀다
export function cleanPages(pages) {
  const ps = pages.map((ls) => ls.filter((l) => !PAGE_NO.test(l)))
  const n = ps.length
  const rep = { top: new Set(), bottom: new Set() }
  if (n >= 3) {
    for (const [side, pick] of [['top', (ls) => ls[0]], ['bottom', (ls) => ls[ls.length - 1]]]) {
      const seen = new Map()
      for (const ls of ps) if (ls.length > 1) seen.set(shape(pick(ls)), (seen.get(shape(pick(ls))) || 0) + 1)
      for (const [s, c] of seen) if (c > n / 2) rep[side].add(s)
    }
  }
  return ps
    .map((ls) => ls.filter((l, i) => !(ls.length > 1 && ((i === 0 && rep.top.has(shape(l))) || (i === ls.length - 1 && rep.bottom.has(shape(l)))))).join('\n'))
    .filter((t) => t.trim())
    .join('\n\n')
}

export async function pdfToMd(buf) {
  const { m, cmaps, fonts } = await pdfjs()
  let doc
  try {
    doc = await m.getDocument({ data: new Uint8Array(buf), cMapUrl: cmaps, cMapPacked: true, standardFontDataUrl: fonts, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise
  } catch (e) {
    throw new KmdError('E_INPUT', /password/i.test(e?.name || e?.message || '') ? '암호가 걸린 pdf' : 'pdf 모양이 아니다')
  }
  try {
    const pages = []
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
      const p = await doc.getPage(i)
      pages.push(pageLines((await p.getTextContent()).items))
      p.cleanup()
    }
    const chars = pages.flat().join('').replace(/\s/g, '').length
    if (chars < SCAN_PER_PAGE * Math.max(1, pages.length)) return ''
    return cleanPages(pages)
  } finally {
    await doc.destroy().catch(() => {})
  }
}
