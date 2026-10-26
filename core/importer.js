// 파일 · 폴더 넣기 — 한 번 들여온다(폴더 잇기와 다르다 · KM82).
//
//   md                → 그대로 문서(폴더 짜임 = 문서 경로)
//   docx · pptx · xlsx · hwpx → 서버가 바로 md 로(core/ooxml.js · 압축 해제 상한) + 원본은 첨부
//   pdf · hwp         → 서버가 바로 글로(core/pdf.js · core/hwp.js) + 원본은 첨부. 글 층이 없는 pdf(스캔) · 암호 · 배포용 · 깨진 파일만
//                       mdOf(바꾼 글 보관 · Claude Code 가 원본을 읽어 옮긴 것)로 · 그것도 없으면 원본만 첨부 · 「바꾸지 못한 파일」
//   txt · log         → 글 그대로 · csv · tsv → md 표 · html → 글(태그 뺌) · json → 코드 덩이
//   그림              → 첨부
//   그 밖              → 「넣지 않은 파일」
//   한 번에 300 파일 · 200MB. 같은 글이면 다시 쓰지 않는다(묶음 0).
// 넣은 파일은 기록이 된다(태그 ingest/<경로> · asRecord — 지식 만들기의 파일 · 폴더 넣기) — 정리(큐레이션)가 그 기록을 읽어
// 기존 문서 항목에 넣거나 새 문서로 세운다. 바로 문서로 서는 것은 옛 폴더로 지식을 세울 때(지식 추가)와 문서 폴더 감시뿐.
// 팀 지식에서 바로 넣지 못하는 사람도 기록으로 남긴다.

import path from 'node:path'
import crypto from 'node:crypto'
import { convert } from './ooxml.js'
import { hwpToMd } from './hwp.js'
import { pdfToMd } from './pdf.js'
import { readText, nfc, dropToc } from './text.js'
import { KmdError } from './errors.js'

export const MAX_FILES = 300
export const MAX_BYTES = 200 << 20
const DOCX = ['docx', 'pptx', 'xlsx', 'hwpx']
// 서버가 글을 꺼내 보고 못 꺼내면(스캔 · 암호 · 배포용) 내 PC 의 Claude 로 옮기는 종류
export const PCONLY = ['hwp', 'pdf']
// pdf · hwp 의 글 — Claude 없이(못 꺼내면 '')
export async function localMd(ext, buf) {
  try {
    return dropToc(ext === 'hwp' ? hwpToMd(buf) : ext === 'pdf' ? await pdfToMd(buf) : '')
  } catch {
    return ''
  }
}
const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
// 보통 글 파일 — 서버가 바로 md 로(원본은 첨부로 두지 않는다 — 글이 곧 원본이다)
const TEXT = ['txt', 'log', 'csv', 'tsv', 'html', 'htm', 'json']
export function textToMd(ext, buf) {
  const t = readText(buf.toString('utf8')).replace(/^\uFEFF/, '')
  if (ext === 'txt' || ext === 'log') return t
  if (ext === 'json') return '```json\n' + t.trim() + '\n```'
  if (ext === 'html' || ext === 'htm') return htmlToMd(t)
  // csv · tsv — 따옴표 칸(쉼표 · 줄바꿈 · "" ) 을 읽어 md 표로
  const sep = ext === 'tsv' ? '\t' : ','
  const rows = []
  let row = []
  let cell = ''
  let q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const live = rows.filter((r) => r.some((x) => x.trim()))
  if (!live.length) return ''
  const w = Math.max(...live.map((r) => r.length))
  const md = (r) => '| ' + Array.from({ length: w }, (_, i) => String(r[i] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()).join(' | ') + ' |'
  return [md(live[0]), '|' + ' --- |'.repeat(w), ...live.slice(1).map(md)].join('\n')
}

// html → md — 짜임(머리 · 문단 · 목록 · 표 · 코드 · 굵게 · 그림 설명)을 살린다. 꾸밈(script · style · svg · nav · 단추)은 뺀다.
//   태그만 지우면 머리 · 표가 한 덩이 글이 되어 기록으로 읽히지 않았다
const ENT = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&', middot: '·', ndash: '–', mdash: '—', hellip: '…', rarr: '→', larr: '←', harr: '↔', times: '×', le: '≤', ge: '≥', ne: '≠', bull: '•' }
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m))
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'figure', 'figcaption', 'blockquote', 'details', 'summary', 'dl', 'dt', 'dd', 'hr', 'address', 'center', 'caption', 'body'])
export function htmlToMd(html) {
  const src = String(html || '')
    .replace(/<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*>/g, '')
    .replace(/<(script|style|svg|noscript|template|head|nav|button|select|textarea|iframe|object|canvas)\b[\s\S]*?<\/\1\s*>/gi, '')
  let out = ''
  let cell = null // 표 칸 안이면 그 칸의 글
  const tables = [] // { rows: [[칸]], head: bool }
  const lists = [] // 'ul' | 'ol' 와 번호
  let pre = null
  let bold = 0
  const put = (s) => { if (cell != null) cell += s; else out += s }
  const nl = (n = 2) => { if (cell != null) { cell += ' '; return } out = out.replace(/[ \t]+$/, ''); const have = (out.match(/\n*$/) || [''])[0].length; if (out && have < n) out += '\n'.repeat(n - have) }
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g
  let m
  while ((m = re.exec(src))) {
    const [, close, tag0, attrs, text] = m
    if (text != null) {
      if (pre != null) { pre += decode(text); continue }
      const s = decode(text).replace(/\s+/g, ' ')
      if (!s.trim() && !/\S$/.test(cell ?? out)) continue
      put(s)
      continue
    }
    const tag = tag0.toLowerCase()
    if (pre != null && !(close && tag === 'pre')) continue
    if (/^h[1-6]$/.test(tag)) { nl(); if (!close && cell == null) put('#'.repeat(+tag[1]) + ' '); continue }
    if (tag === 'br') { if (cell != null) cell += ' '; else out += '\n'; continue }
    if (tag === 'pre') {
      if (!close) { nl(); pre = '' } else { out += '```\n' + pre.replace(/^\n+|\s+$/g, '') + '\n```'; pre = null; nl() }
      continue
    }
    if (tag === 'code') { put('`'); continue }
    if (tag === 'strong' || tag === 'b') { if (close ? bold > 0 : true) { bold += close ? -1 : 1; put('**') } continue }
    if (tag === 'img') { const alt = (attrs.match(/\balt\s*=\s*"([^"]*)"/i) || [])[1]; if (alt) put(`[그림: ${decode(alt)}]`); continue }
    if (tag === 'ul' || tag === 'ol') { if (close) { lists.pop(); if (!lists.length) nl() } else { if (!lists.length) nl(); lists.push({ tag, n: 0 }) } continue }
    if (tag === 'li') {
      if (!close && cell == null) { const L = lists[lists.length - 1] || { tag: 'ul', n: 0 }; out = out.replace(/[ \t]+$/, ''); out += (out && !out.endsWith('\n') ? '\n' : '') + '  '.repeat(Math.max(0, lists.length - 1)) + (L.tag === 'ol' ? `${++L.n}. ` : '- ') }
      else if (cell != null) cell += ' '
      continue
    }
    if (tag === 'table') {
      if (!close) { if (cell != null) { tables.push({ rows: [], nested: cell }); cell = null } else { nl(); tables.push({ rows: [] }) } continue }
      const T = tables.pop()
      if (!T) continue
      const rows = T.rows.filter((r) => r.some((x) => x.trim()))
      const w = Math.max(0, ...rows.map((r) => r.length))
      const md = !rows.length ? '' : rows.length === 1 || w === 1 ? rows.map((r) => r.map((x) => x.trim()).filter(Boolean).join(' · ')).join('\n') : [rows[0], null, ...rows.slice(1)].map((r) => (r ? '| ' + Array.from({ length: w }, (_, i) => (r[i] || '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')).join(' | ') + ' |' : '|' + ' --- |'.repeat(w))).join('\n')
      if (T.nested != null) { cell = T.nested + ' ' + md.replace(/\n/g, ' ') } else { out += md; nl() }
      continue
    }
    if (tag === 'tr') { const T = tables[tables.length - 1]; if (T && !close) T.rows.push([]); continue }
    if (tag === 'td' || tag === 'th') {
      const T = tables[tables.length - 1]
      if (!T) continue
      if (!close) { if (!T.rows.length) T.rows.push([]); cell = '' } else if (cell != null) { T.rows[T.rows.length - 1].push(cell); cell = null }
      continue
    }
    if (BLOCK.has(tag) || tag === 'li') { nl(); continue }
  }
  return out.split('\n').map((l) => l.replace(/[ \t]+$/, '').replace(/^ (?=\S)/, '')).join('\n').replace(/\*\*\s*\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

const extOf = (n) => (String(n).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || ''
// 넣은 경로 — 폴더 짜임 그대로 · 폴더 밖으로 못 나간다 · 파일 이름에 못 쓰는 글자 뺌
function cleanPath(p) {
  const parts = nfc(String(p || '')).replace(/\\/g, '/').split('/').map((x) => x.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim()).filter((x) => x && x !== '.' && x !== '..')
  if (!parts.length) throw new KmdError('E_INPUT', '파일 이름이 없다')
  return parts.join('/')
}

// files: [{ path, data(Buffer) }] → 계획 { docs, atts, records, rows }
// read(rel) → 지금 글(Buffer) 또는 null — 같은 파일이면 쓰지 않는다
// convert — docx · pptx · xlsx 를 md 로 바꾸나(설정 「넣은 파일을 문서로」 · 끄면 원본 첨부만)
// mdOf(rel, data) — pdf · hwp 의 바꾼 글(없으면 null · 요구 v0.2 R6)
export async function planImport(k, files, { direct = true, asRecord = false, convert: conv = true, read = async () => null, mdOf = null } = {}) {
  if (!Array.isArray(files) || !files.length) throw new KmdError('E_INPUT', '넣을 파일이 없다')
  if (files.length > MAX_FILES) throw new KmdError('E_INPUT', `한 번에 ${MAX_FILES} 파일까지 — 나눠 넣는다`)
  const total = files.reduce((a, f) => a + (f.data?.length || 0), 0)
  if (total > MAX_BYTES) throw new KmdError('E_INPUT', '한 번에 200MB 까지 — 나눠 넣는다')
  const plan = { docs: [], atts: [], records: [], rows: [] }
  for (const f of files) {
    const rel = cleanPath(f.path || f.name)
    const ext = extOf(rel)
    const base = rel.replace(/\.[^./]+$/, '')
    const docRel = `docs/${base}.md`
    const attRel = `docs/assets/${rel}`
    const row = (kind, msg, extra = {}) => plan.rows.push({ name: rel, kind, msg, ...extra })
    let md = null
    try {
      if (ext === 'md' || ext === 'markdown') md = readText(f.data.toString('utf8'))
      else if (TEXT.includes(ext)) md = `# ${path.posix.basename(base)}\n\n${textToMd(ext, f.data)}\n`
      else if (DOCX.includes(ext) && conv) md = `# ${path.posix.basename(base)}\n\n${dropToc(convert(rel, f.data))}\n`
      else if (PCONLY.includes(ext) && conv) {
        const got = (await localMd(ext, f.data)).trim() || (mdOf ? await mdOf(rel, f.data) : null)
        if (got) md = `# ${path.posix.basename(base)}\n\n${String(got).replace(/^# .*\n+/, '')}\n`
      }
    } catch (e) {
      row('fail', e.message)
      continue
    }
    if (md != null) {
      if (!direct || asRecord) {
        // 원본(docx · pptx · xlsx)은 첨부로 둔다 — 바로 넣을 수 있는 사람만
        if (direct && ext !== 'md' && ext !== 'markdown' && !TEXT.includes(ext) && !(await read(attRel))?.equals(f.data)) plan.atts.push({ rel: attRel, data: f.data })
        const tag = `ingest/${rel}`.slice(0, 60)
        // 받은 글의 지문 — Claude 가 기록을 정리해 글이 바뀌어도(ingest-read) 같은 파일을 다시 넣으면 「같은 파일」
        const dig = `md/${crypto.createHash('sha256').update(md.trim()).digest('hex').slice(0, 16)}`
        const same = k.works.some((w) => w.tags.includes(tag) && (w.tags.includes(dig) || w.body.trim() === md.trim()))
        if (same) row('same', '같은 파일 — 그대로 두었다')
        else {
          plan.records.push({ title: `${path.posix.basename(rel)} — 넣은 파일`, body: md, tags: [tag, dig] })
          row('record', `기록이 됐다 — ${k.name} › 기록 · 정리가 기존 문서에 넣거나 새 문서로 세운다`)
        }
        continue
      }
      const cur = await read(docRel)
      if (cur && tidy(cur.toString('utf8')) === tidy(md)) {
        row('same', '같은 파일 — 그대로 두었다')
        continue
      }
      plan.docs.push({ rel: docRel, text: md })
      if (ext !== 'md' && ext !== 'markdown' && !TEXT.includes(ext)) plan.atts.push({ rel: attRel, data: f.data })
      row('doc', `문서가 됐다 — ${k.name} › ${base.split('/').join(' › ')}`, { doc: base })
      continue
    }
    if (DOCX.includes(ext) && !conv) {
      if (direct && !(await read(attRel))?.equals(f.data)) plan.atts.push({ rel: attRel, data: f.data })
      row(direct ? 'att' : 'skip', direct ? '원본은 첨부로 두었다 — 문서로 바꾸기를 꺼 두었다' : '문서로 바꾸기를 꺼 두었다')
      continue
    }
    if (PCONLY.includes(ext)) {
      if (direct && !(await read(attRel))?.equals(f.data)) plan.atts.push({ rel: attRel, data: f.data })
      row('fail', !conv ? (direct ? '원본은 첨부로 두었다 — 문서로 바꾸기를 꺼 두었다' : '문서로 바꾸기를 꺼 두었다') : direct ? '원본은 첨부로 두었다 — 글이 없는 파일(스캔 · 암호 · 배포용)이라 내 PC 프로그램이 Claude 로 옮긴다' : '바꾸지 못한 파일(스캔 · 암호 · 배포용) — 내 PC 프로그램이 있는 PC 에서 넣는다')
      continue
    }
    if (IMG.includes(ext)) {
      if (direct && !(await read(attRel))?.equals(f.data)) plan.atts.push({ rel: attRel, data: f.data })
      row(direct ? 'att' : 'skip', direct ? `그림은 첨부로 두었다 — ${k.name}` : '그림은 정리하는 사람이 넣는다')
      continue
    }
    row('skip', `넣지 않은 파일 — 읽지 못하는 종류(.${ext || '?'})`)
  }
  return plan
}

// 줄 끝 · 끝 공백을 맞춰 견준다
const tidy = (t) => readText(t).split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim()

export function summary(rows) {
  const n = (k) => rows.filter((r) => r.kind === k).length
  return { doc: n('doc'), record: n('record'), att: n('att'), same: n('same'), fail: n('fail'), skip: n('skip'), run: n('run') }
}
