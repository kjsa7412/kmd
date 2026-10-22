// 저장 하나 — 기록 하나 + (있으면) 문서 항목들 + git 한 묶음.
//
//   { record: { title, body, touches?, tags?, date?, fixes? },
//     sections?: [{ coord, content }  또는  { doc, heading, content }] }
//
// 기록은 늘 남는다(누가 왜 바꿨나의 유일한 자리). 항목을 같이 보내면 그 항목 글을
// 갈아 끼우고 「이 기록을 넣었다」 표지를 단다. 같은 지식의 저장은 한 줄로 선다.

import fs from 'node:fs/promises'
import path from 'node:path'
import { fail } from './errors.js'
import { nfc, oneLine, readText } from './text.js'
import { renderRecord } from './frontmatter.js'
import { replaceSection } from './sections.js'
import { locate, parseRegistry } from './registry.js'
import { parseVocab } from './vocab.js'
import { ensureRepo, commitPaths } from './git.js'

const DATE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/
const COORD = /^[^\s:`]+:[^\n`]+$/
const MAX_BODY = 200_000

const pad = (n) => String(n).padStart(2, '0')
export function localStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 파일 이름 조각 — 제목의 앞부분 · 파일 이름에 못 쓰는 글자는 뺀다
function slugOf(title) {
  const s = nfc(title)
    .split(/\s+[—–-]\s+/)[0]
    .replace(/[\\/:*?"<>|#%`'\u0000-\u001f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/[-.]+$/, '')
  return s || '기록'
}

function check(input) {
  const r = input?.record
  if (!r || typeof r !== 'object') fail('E_INPUT', '기록(record)이 없다 — 제목과 글을 보낸다')
  if (!oneLine(r.title) || !r.title.trim()) fail('E_INPUT', '제목은 한 줄 글이다')
  if (r.title.length > 200) fail('E_INPUT', '제목이 너무 길다 — 200자 안')
  if (typeof r.body !== 'string') fail('E_INPUT', '글(body)이 없다')
  if (r.body.length > MAX_BODY) fail('E_INPUT', '글이 너무 길다')
  if (r.date != null && !(oneLine(r.date) && DATE.test(r.date))) fail('E_INPUT', '날짜는 YYYY-MM-DD 또는 YYYY-MM-DD HH:MM 모양이다')
  for (const [k, re] of [['touches', COORD], ['tags', /^[^\n]{1,60}$/], ['fixes', /^[^\s/\\]{1,120}$/]]) {
    if (r[k] == null) continue
    if (!Array.isArray(r[k]) || r[k].some((x) => typeof x !== 'string' || !re.test(x.trim()))) fail('E_INPUT', `${k} 는 한 줄 글의 목록이다`)
  }
  const secs = input.sections ?? []
  if (!Array.isArray(secs)) fail('E_INPUT', 'sections 는 목록이다')
  for (const s of secs) {
    if (!s || typeof s.content !== 'string') fail('E_INPUT', '항목마다 content(새 글)가 있다')
    if (s.coord == null && (s.doc == null || s.heading == null)) fail('E_INPUT', '항목은 이름(coord) 또는 문서 · 머리(doc · heading)로 가리킨다')
    if (s.coord != null && !(typeof s.coord === 'string' && COORD.test(s.coord.trim()))) fail('E_INPUT', `이름 모양이 아니다 — ${s.coord}`)
    if (s.heading != null && !(oneLine(s.heading) && s.heading.trim())) fail('E_INPUT', '머리는 한 줄 글이다')
    if (s.content.length > MAX_BODY) fail('E_INPUT', '항목 글이 너무 길다')
  }
  return secs
}

// 문서 자리 — docs/ 아래 md 만 · 폴더 밖으로 못 나간다
function docPath(dir, doc) {
  let p = nfc(String(doc)).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!p.startsWith('docs/')) p = `docs/${p}`
  if (!p.endsWith('.md')) p += '.md'
  if (p.split('/').some((x) => x === '..' || x === '.' || x === '') || /[\u0000-\u001f]/.test(p)) fail('E_INPUT', `문서 자리가 아니다 — ${doc}`)
  return { rel: p, full: path.join(dir, ...p.split('/')) }
}

const locks = new Map()
function serial(key, f) {
  const prev = locks.get(key) || Promise.resolve()
  const run = prev.then(f, f)
  locks.set(key, run.catch(() => {}))
  return run
}

export function save(dir, input, { user, now = new Date() } = {}) {
  if (!user || !oneLine(user)) fail('E_INPUT', '누가 쓰는지 모른다')
  const secs = check(input)
  return serial(path.resolve(dir), () => saveNow(dir, input.record, secs, { user: nfc(user), now }))
}

async function saveNow(dir, r, secs, { user, now }) {
  const registry = parseRegistry(await fs.readFile(path.join(dir, '_managed.md'), 'utf8').then(readText, () => ''))
  const vocab = parseVocab(await fs.readFile(path.join(dir, '_vocab.md'), 'utf8').then(readText, () => ''))
  const date = r.date || localStamp(now)
  const touches = [...new Set((r.touches || []).map((x) => nfc(x.trim())))]

  // 항목 자리 먼저 — 하나라도 못 찾으면 아무것도 쓰지 않는다
  const plan = secs.map((s) => {
    if (s.coord != null) {
      const coord = nfc(s.coord.trim())
      const loc = locate(registry, coord)
      if (!loc) fail('E_NOTFOUND', `「${vocab.coords.get(coord)?.label || coord}」 이 들어갈 문서가 정해져 있지 않다 — 기록만 보내거나 문서 · 머리로 가리킨다`)
      if (!touches.includes(coord)) touches.push(coord)
      return { ...docPath(dir, loc.doc), level: loc.level, heading: loc.heading, content: s.content }
    }
    return { ...docPath(dir, s.doc), level: 2, heading: nfc(s.heading.trim()), content: s.content }
  })

  await ensureRepo(dir)
  const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
  const base = `${day}-${slugOf(r.title)}`
  await fs.mkdir(path.join(dir, 'work'), { recursive: true })
  let id = base
  for (let n = 2; await fs.stat(path.join(dir, 'work', `${id}.md`)).then(() => true, () => false); n++) id = `${base}-${n}`

  const rec = { id, title: nfc(r.title.trim()), date, author: user, touches, tags: (r.tags || []).map((t) => nfc(t.trim())), fixes: (r.fixes || []).map((x) => nfc(x.trim())) }
  const workRel = `work/${id}.md`
  const workFull = path.join(dir, 'work', `${id}.md`)
  // 중간에 넘어지면 쓴 것을 되돌린다 — 반쯤 쓴 저장은 남기지 않는다
  const undo = [() => fs.rm(workFull, { force: true })]
  try {
    await fs.writeFile(workFull, renderRecord(rec, nfc(r.body)), 'utf8')
    const docs = []
    for (const p of plan) {
      const raw = await fs.readFile(p.full, 'utf8').catch(() => null)
      const start = raw == null ? `# ${path.basename(p.rel, '.md')}\n` : readText(raw)
      const after = replaceSection(start, { level: p.level, heading: p.heading, body: nfc(p.content), applied: id })
      if (!docs.includes(p.rel)) {
        undo.push(() => (raw == null ? fs.rm(p.full, { force: true }) : fs.writeFile(p.full, raw, 'utf8')))
        docs.push(p.rel)
      }
      await fs.mkdir(path.dirname(p.full), { recursive: true })
      await fs.writeFile(p.full, after, 'utf8')
    }
    const commit = await commitPaths(dir, [workRel, ...docs], rec.title, user)
    return { id, record: workRel, docs, commit, date }
  } catch (e) {
    for (const u of undo.reverse()) await u().catch(() => {})
    throw e
  }
}
