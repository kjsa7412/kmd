// 파일 · 폴더 넣기 — 한 번 들여온다(폴더 잇기와 다르다 · KM82).
//
//   md                → 그대로 문서(폴더 짜임 = 문서 경로)
//   docx · pptx · xlsx · hwpx → 서버가 바로 md 로(core/ooxml.js · 압축 해제 상한) + 원본은 첨부
//   pdf · hwp         → mdOf(바꾼 글 보관 · Claude Code 가 원본을 읽어 옮긴 것)가 있으면 그 글로 · 없으면 원본만 첨부 · 「바꾸지 못한 파일」
//   txt · log         → 글 그대로 · csv · tsv → md 표 · html → 글(태그 뺌) · json → 코드 덩이
//   그림              → 첨부
//   그 밖              → 「넣지 않은 파일」
//   한 번에 300 파일 · 200MB. 같은 글이면 다시 쓰지 않는다(묶음 0).
// 넣은 파일은 기록이 된다(태그 ingest/<경로> · asRecord — 지식 만들기의 파일 · 폴더 넣기) — 정리(큐레이션)가 그 기록을 읽어
// 기존 문서 항목에 넣거나 새 문서로 세운다. 바로 문서로 서는 것은 옛 폴더로 지식을 세울 때(지식 추가)와 문서 폴더 감시뿐.
// 팀 지식에서 바로 넣지 못하는 사람도 기록으로 남긴다.

import path from 'node:path'
import { convert } from './ooxml.js'
import { readText, nfc } from './text.js'
import { KmdError } from './errors.js'

export const MAX_FILES = 300
export const MAX_BYTES = 200 << 20
const DOCX = ['docx', 'pptx', 'xlsx', 'hwpx']
export const PCONLY = ['hwp', 'pdf']
const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
// 보통 글 파일 — 서버가 바로 md 로(원본은 첨부로 두지 않는다 — 글이 곧 원본이다)
const TEXT = ['txt', 'log', 'csv', 'tsv', 'html', 'htm', 'json']
export function textToMd(ext, buf) {
  const t = readText(buf.toString('utf8')).replace(/^\uFEFF/, '')
  if (ext === 'txt' || ext === 'log') return t
  if (ext === 'json') return '```json\n' + t.trim() + '\n```'
  if (ext === 'html' || ext === 'htm') {
    return t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim()
  }
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
      else if (DOCX.includes(ext) && conv) md = `# ${path.posix.basename(base)}\n\n${convert(rel, f.data)}\n`
      else if (PCONLY.includes(ext) && conv && mdOf) {
        const got = await mdOf(rel, f.data)
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
        const same = k.works.some((w) => w.tags.includes(tag) && w.body.trim() === md.trim())
        if (same) row('same', '같은 파일 — 그대로 두었다')
        else {
          plan.records.push({ title: `${path.posix.basename(rel)} — 넣은 파일`, body: md, tags: [tag] })
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
      row('fail', direct ? '원본은 첨부로 두었다 — 내 PC 프로그램이 있는 PC 에서 바꾼다' : '바꾸지 못한 파일 — 내 PC 프로그램이 있는 PC 에서 넣는다')
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
