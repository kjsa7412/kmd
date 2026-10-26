// 문서 폴더 감시 — 지켜보는 폴더의 문서(md · docx · pptx · xlsx · hwpx · pdf · 그림)를 지식 안의 사본으로(감시 검토 v0.1 단계 2).
//
//   기록 먼저(대원칙) — 지식은 늘 기록 → 문서 순서로 든다. 들어온 파일 · 원본에서 지운 파일마다 기록 하나(work/ · 작성자 kmd ·
//                        태그 watched · 글은 바꾼 글 그대로)를 남기고, 그 기록을 문서 표지의 rec 로 단다(「이 문서가 온 곳」).
//                        이력(log/ · 태그 sources) 하나가 그 기록들을 넣었다고 적는다(reflects — 기록은 「문서에 들어감」).
//   원본이 주인(결정 ①) — 들어온 문서의 첫 줄에 `<!-- watched: src="이름" path="원본 경로" rec="기록 id" -->` 를 단다. 사람 · 세션의 저장과
//                        편집기 고침은 그 문서를 바꾸지 못한다(save 거절 · 거두기가 되돌린다) — 고치려면 원본 파일을 고친다.
//   바뀐 것만           감시 엔진이 낸 「더함 · 고침」 파일만 다시 바꾼다(파일 넣기와 같은 길 · 같은 글이면 쓰지 않는다 — 기록도 없다).
//                        표지에 rec 가 없는 문서(기록 없이 들어온 예전 사본)는 같은 글이어도 기록을 세운다(backfill).
//   원본에서 지움(결정 ②) — 지식의 문서를 지우지 않고 표지에 missing="날짜" 를 단다(화면에 「원본에 없다」).
//   쓰기               한 번에 한 묶음 — 기록들 + 이력 하나 + 바뀐 문서 · 첨부.

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { planImport } from './importer.js'
import { renderRecord } from './frontmatter.js'
import { localStamp, serial, recordTakenSync } from './save.js'
import { ensureRepo, commitPaths } from './git.js'
import { readText, nfc } from './text.js'
import { watchedOf } from './watchmark.js'

export const DOC_EXT = /\.(md|markdown|docx|pptx|xlsx|hwpx|hwp|pdf|png|jpe?g|gif|webp|svg|bmp)$/i
// 문서로 볼 파일 — 오피스가 여는 동안 만드는 잠금 파일(~$…) · 임시 파일은 뺀다
export const wantDoc = (p) => DOC_EXT.test(p) && !p.split('/').some((x) => x.startsWith('~$') || x.startsWith('.~'))

// 첫 줄의 표지 → { src, path, missing } 또는 null
export { watchedOf }
const markLine = (o) => `<!-- watched: ${Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}="${String(v).replace(/"/g, "'")}"`).join(' ')} -->`
const strip = (t) => (watchedOf(t) ? String(t).split('\n').slice(1).join('\n') : String(t))

// 원본 경로 → 지식 안의 자리(prefix 폴더 아래 · 짜임 그대로)
const docRelOf = (prefix, rel) => `docs/${prefix ? prefix + '/' : ''}${rel.replace(/\.[^./]+$/, '')}.md`
const MAX_REC = 200_000
// 기록 id 조각 — 파일 이름(확장자 뺌) · 파일 이름에 못 쓰는 글자는 뺀다
const slug = (rel) => nfc(rel.split('/').pop().replace(/\.[^.]+$/, '')).replace(/[\\/:*?"<>|#%`'\u0000-\u001f]/g, '').trim().replace(/\s+/g, '-').slice(0, 40).replace(/[-.]+$/, '') || '문서'

// files: [{ rel, data }] (더함 · 고침) · removed: [rel] — 지식 폴더에 쓴다 · { docs, atts, missing, recs, rows, commit }
export async function applyDocs(k, { src, prefix = '', files = [], removed = [], user = 'kmd', mdOf = null }) {
  const dir = k.dir
  // 같은 글인지 견줄 지금 글 — 표지에 기록(rec)이 없는 사본은 없는 것으로(기록을 세우게)
  const read = (rel) => fs.readFile(path.join(dir, ...rel.split('/'))).then((b) => {
    if (!rel.endsWith('.md')) return b
    const t = b.toString('utf8')
    const w = watchedOf(t)
    return w && !w.rec ? null : Buffer.from(strip(t))
  }, () => null)
  const writes = []
  const rows = []
  const recs = [] // { rel(원본) , doc, text } — 문서마다 기록 하나
  for (const f of files) {
    const pathIn = prefix ? `${prefix}/${f.rel}` : f.rel
    const plan = await planImport(k, [{ path: pathIn, data: f.data }], { direct: true, read, mdOf })
    rows.push(...plan.rows)
    for (const d of plan.docs) recs.push({ rel: f.rel, doc: d.rel, text: d.text })
    for (const a of plan.atts) writes.push({ rel: a.rel, data: a.data })
  }
  const today = localStamp().slice(0, 10)
  const gone = []
  for (const rel of removed) {
    const dr = docRelOf(prefix, rel)
    const t = await fs.readFile(path.join(dir, ...dr.split('/')), 'utf8').then(readText, () => null)
    const w = t && watchedOf(t)
    if (!w || w.missing) continue
    gone.push({ rel, doc: dr, w, text: strip(t) })
  }
  if (!recs.length && !gone.length && !writes.length) return { docs: 0, atts: 0, missing: 0, recs: 0, rows, commit: null }
  const docsN = recs.length
  const attsN = writes.length
  const commit = await serial(path.resolve(dir), async () => {
    await ensureRepo(dir)
    const date = localStamp()
    const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
    const taken = new Set()
    const idOf = (base) => {
      let id = base
      for (let n = 2; taken.has(id) || recordTakenSync(dir, id); n++) id = `${base}-${n}`
      taken.add(id)
      return id
    }
    const paths = []
    const put = async (rel, data) => {
      const full = path.join(dir, ...rel.split('/'))
      if (!path.resolve(full).startsWith(path.resolve(dir) + path.sep)) return
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, data)
      paths.push(rel)
    }
    // ① 기록 — 파일마다 하나(글은 바꾼 글 그대로 · 원본에서 지운 파일은 그 사실)
    const ids = []
    const docWrites = []
    for (const r of recs) {
      const id = idOf(`${day}-${slug(r.rel)}`)
      const body = r.text.length > MAX_REC ? `${r.text.slice(0, MAX_REC)}\n\n…(길어서 줄였다 — 문서에 전체)\n` : r.text
      await put(`work/${id}.md`, renderRecord({ id, title: `${r.rel.split('/').pop()} — 가져온 파일 · ${src.name}`, date, author: user, tags: ['watched'] }, body))
      ids.push(id)
      docWrites.push({ rel: r.doc, data: Buffer.from(`${markLine({ src: src.name, path: r.rel, rec: id })}\n${r.text}`, 'utf8') })
    }
    for (const g of gone) {
      const id = idOf(`${day}-${slug(g.rel)}-원본에-없다`)
      await put(`work/${id}.md`, renderRecord({ id, title: `${g.rel.split('/').pop()} — 원본에서 없어짐 · ${src.name}`, date, author: user, tags: ['watched'] }, `${src.name} 의 ${g.rel} 이 원본 폴더에서 없어졌다 — 지식의 문서는 지우지 않고 「원본에 없다」 로 둔다.`))
      ids.push(id)
      docWrites.push({ rel: g.doc, data: Buffer.from(`${markLine({ src: g.w.src, path: g.w.path, missing: today, rec: id })}\n${g.text}`, 'utf8') })
    }
    // ② 이력 — 이 가져옴이 그 기록들을 문서에 넣었다(reflects)
    let lid = `${day}-문서-감시`
    for (let n = 2; taken.has(lid) || recordTakenSync(dir, lid); n++) lid = `${day}-문서-감시-${n}`
    const title = `가져옴 — ${src.name} · 문서 ${docsN}${attsN ? ' · 첨부 ' + attsN : ''}${gone.length ? ' · 원본에 없다 ' + gone.length : ''}`
    const lbody = [...files.map((f) => `- ${f.rel}`), ...gone.map((g) => `- ${g.rel} — 원본에 없다`)].slice(0, 200).join('\n')
    await put(`log/${lid}.md`, renderRecord({ id: lid, title, date, author: user, tags: ['sources'], ...(ids.length ? { reflects: ids } : {}) }, lbody))
    // ③ 문서 · 첨부 — 기록 다음
    for (const w of [...docWrites, ...writes]) await put(w.rel, w.data)
    return commitPaths(dir, paths, title, user)
  })
  return { docs: docsN, atts: attsN, missing: gone.length, recs: docsN + gone.length, rows, commit }
}

// 그 지식에서 이 감시가 단 문서 수(브레이크의 분모)
export async function watchedCount(k, srcName) {
  let n = 0
  for (const d of k.docs) {
    const t = await fs.readFile(path.join(k.dir, ...d.path.split('/')), 'utf8').then(readText, () => '')
    const w = watchedOf(t)
    if (w && w.src === srcName && !w.missing) n++
  }
  return n
}

// 기록 없이 들어온 사본(표지에 rec 가 없다 — 대원칙 전의 것)의 원본 경로 — 문서 감시가 한 번 기록을 세운다
export async function noRecPaths(k, srcName) {
  const out = new Set()
  for (const d of k.docs) {
    const t = await fs.readFile(path.join(k.dir, ...d.path.split('/')), 'utf8').then(readText, () => '')
    const w = watchedOf(t)
    if (w && w.src === srcName && !w.missing && !w.rec && w.path) out.add(w.path)
  }
  return out
}
