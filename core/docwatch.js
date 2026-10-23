// 문서 폴더 감시 — 지켜보는 폴더의 문서(md · docx · pptx · xlsx · hwpx · pdf · 그림)를 지식 안의 사본으로(감시 검토 v0.1 단계 2).
//
//   원본이 주인(결정 ①) — 들어온 문서의 첫 줄에 `<!-- watched: src="이름" path="원본 경로" -->` 를 단다. 사람 · 세션의 저장과
//                        편집기 고침은 그 문서를 바꾸지 못한다(save 거절 · 거두기가 되돌린다) — 고치려면 원본 파일을 고친다.
//   바뀐 것만           감시 엔진이 낸 「더함 · 고침」 파일만 다시 바꾼다(파일 넣기와 같은 길 · 같은 글이면 쓰지 않는다).
//   원본에서 지움(결정 ②) — 지식의 문서를 지우지 않고 표지에 missing="날짜" 를 단다(화면에 「원본에 없다」).
//   쓰기               한 번에 한 묶음 — 작성자 kmd · 태그 sources 기록 하나 + 바뀐 문서 · 첨부.

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { planImport } from './importer.js'
import { renderRecord } from './frontmatter.js'
import { localStamp, serial, recordTakenSync } from './save.js'
import { ensureRepo, commitPaths } from './git.js'
import { readText } from './text.js'
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

// files: [{ rel, data }] (더함 · 고침) · removed: [rel] — 지식 폴더에 쓴다 · { docs, atts, missing, rows, commit }
export async function applyDocs(k, { src, prefix = '', files = [], removed = [], user = 'kmd' }) {
  const dir = k.dir
  const read = (rel) => fs.readFile(path.join(dir, ...rel.split('/'))).then((b) => (rel.endsWith('.md') ? Buffer.from(strip(b.toString('utf8'))) : b), () => null)
  const writes = []
  const rows = []
  for (const f of files) {
    const pathIn = prefix ? `${prefix}/${f.rel}` : f.rel
    const plan = await planImport(k, [{ path: pathIn, data: f.data }], { direct: true, read })
    rows.push(...plan.rows)
    for (const d of plan.docs) writes.push({ rel: d.rel, data: Buffer.from(`${markLine({ src: src.name, path: f.rel })}\n${d.text}`, 'utf8') })
    for (const a of plan.atts) writes.push({ rel: a.rel, data: a.data })
  }
  const today = localStamp().slice(0, 10)
  const missing = []
  for (const rel of removed) {
    const dr = docRelOf(prefix, rel)
    const t = await fs.readFile(path.join(dir, ...dr.split('/')), 'utf8').then(readText, () => null)
    const w = t && watchedOf(t)
    if (!w || w.missing) continue
    writes.push({ rel: dr, data: Buffer.from(`${markLine({ ...w, missing: today })}\n${strip(t)}`, 'utf8') })
    missing.push(rel)
  }
  if (!writes.length) return { docs: 0, atts: 0, missing: 0, rows, commit: null }
  const docsN = writes.filter((w) => w.rel.endsWith('.md')).length - missing.length
  const attsN = writes.filter((w) => !w.rel.endsWith('.md')).length
  const commit = await serial(path.resolve(dir), async () => {
    await ensureRepo(dir)
    const paths = []
    for (const w of writes) {
      const full = path.join(dir, ...w.rel.split('/'))
      if (!path.resolve(full).startsWith(path.resolve(dir) + path.sep)) continue
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, w.data)
      paths.push(w.rel)
    }
    const date = localStamp()
    const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
    let id = `${day}-문서-감시`
    for (let n = 2; recordTakenSync(dir, id); n++) id = `${day}-문서-감시-${n}`
    const title = `가져옴 — ${src.name} · 문서 ${docsN}${attsN ? ' · 첨부 ' + attsN : ''}${missing.length ? ' · 원본에 없다 ' + missing.length : ''}`
    const body = [...files.map((f) => `- ${f.rel}`), ...missing.map((r) => `- ${r} — 원본에 없다`)].slice(0, 200).join('\n')
    // 이력(log/) — kmd 가 가져온 일은 기록이 아니다
    await fs.mkdir(path.join(dir, 'log'), { recursive: true })
    await fs.writeFile(path.join(dir, 'log', `${id}.md`), renderRecord({ id, title, date, author: user, tags: ['sources'] }, body), 'utf8')
    return commitPaths(dir, [`log/${id}.md`, ...paths], title, user)
  })
  return { docs: docsN, atts: attsN, missing: missing.length, rows, commit }
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
