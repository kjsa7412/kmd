// 파일 · 폴더 넣기 — 한 번 들여온다(폴더 잇기와 다르다 · KM82).
//
//   md                → 그대로 문서(폴더 짜임 = 문서 경로)
//   docx · pptx · xlsx → 서버가 바로 md 로(core/ooxml.js · 압축 해제 상한) + 원본은 첨부
//   hwpx · hwp · pdf  → 원본만 첨부 · 「바꾸지 못한 파일」(바꾸기는 PC 프로그램 몫)
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
const DOCX = ['docx', 'pptx', 'xlsx']
const PCONLY = ['hwpx', 'hwp', 'pdf']
const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']

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
export async function planImport(k, files, { direct = true, asRecord = false, convert: conv = true, read = async () => null } = {}) {
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
      else if (DOCX.includes(ext) && conv) md = `# ${path.posix.basename(base)}\n\n${convert(rel, f.data)}\n`
    } catch (e) {
      row('fail', e.message)
      continue
    }
    if (md != null) {
      if (!direct || asRecord) {
        // 원본(docx · pptx · xlsx)은 첨부로 둔다 — 바로 넣을 수 있는 사람만
        if (direct && ext !== 'md' && ext !== 'markdown' && !(await read(attRel))?.equals(f.data)) plan.atts.push({ rel: attRel, data: f.data })
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
      if (ext !== 'md' && ext !== 'markdown') plan.atts.push({ rel: attRel, data: f.data })
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
  return { doc: n('doc'), record: n('record'), att: n('att'), same: n('same'), fail: n('fail'), skip: n('skip') }
}
