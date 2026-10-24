// 저장 하나 — 기록 하나 + (있으면) 문서 항목들 + git 한 묶음.
//
//   { record: { title, body, touches?, tags?, date?, fixes? },
//     sections?: [{ coord, content }  또는  { doc, heading, content }],
//     names?: [{ coord, label, aliases?, doc?, heading? }] }   ← 이름 장부 · 자리 장부에 이름을 세운다(같은 묶음)
//
// 기록은 늘 남는다(누가 왜 바꿨나의 유일한 자리). 항목을 같이 보내면 그 항목 글을
// 갈아 끼우고 「이 기록을 넣었다」 표지를 단다. 같은 지식의 저장은 한 줄로 선다.

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fail } from './errors.js'
import { nfc, oneLine, readText, sha16 } from './text.js'
import { renderRecord, parseRecord } from './frontmatter.js'
import { replaceSection, parseDoc, headingMatches } from './sections.js'
import { isReservedUser, isReservedTag, isLogRecord, LOG_DIR } from './names.js'
import { isReservedFile } from './owners.js'
import { keepBlocks, hasBlockMarker } from './baseline.js'
import { locate, parseRegistry } from './registry.js'
import { parseVocab } from './vocab.js'
import { ensureRepo, commitPaths } from './git.js'
import { watchedOf } from './watchmark.js'
import { upsertVocab, upsertRegistry, cleanNames } from './namebook.js'

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
    if (s.base != null && !(typeof s.base === 'string' && /^[0-9a-f]{16}$/.test(s.base))) fail('E_INPUT', 'base 는 읽을 때 받은 16자 지문이다')
  }
  return secs
}

// 문서 자리 — docs/ 아래 md 만 · 폴더 밖으로 못 나간다
function docPath(dir, doc) {
  let p = nfc(String(doc)).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!p.startsWith('docs/')) p = `docs/${p}`
  if (!p.endsWith('.md')) p += '.md'
  if (p.split('/').some((x) => x === '..' || x === '.' || x === '') || /[\u0000-\u001f]/.test(p)) fail('E_INPUT', `문서 자리가 아니다 — ${doc}`)
  if (isReservedFile(p)) fail('E_FORBIDDEN', `kmd 가 쓰는 파일이다 — ${doc}`)
  return { rel: p, full: path.join(dir, ...p.split('/')) }
}

// 기록 · 이력 파일 — id 하나로(work/ 먼저 · 없으면 log/)
export async function readRecordFile(dir, id, none = '') {
  for (const sub of ['work', LOG_DIR]) {
    const t = await fs.readFile(path.join(dir, sub, `${id}.md`), 'utf8').catch(() => null)
    if (t != null) return readText(t)
  }
  return none
}
export const recordTaken = async (dir, id) => (await Promise.all(['work', LOG_DIR].map((sub) => fs.stat(path.join(dir, sub, `${id}.md`)).then(() => true, () => false)))).some(Boolean)
export const recordTakenSync = (dir, id) => ['work', LOG_DIR].some((sub) => existsSync(path.join(dir, sub, `${id}.md`)))

const locks = new Map()
export function serial(key, f) {
  const prev = locks.get(key) || Promise.resolve()
  const run = prev.then(f, f)
  locks.set(key, run.catch(() => {}))
  return run
}

// system — kmd 자신이 쓰는 저장(고친 기록 · 정리 · 가져오기). 예약 이름 · 태그는 system 만
// agent — kmd 가 띄운 에이전트(요구 v0.2 R8): 작성자 kmd-auto · 태그 curate-llm · 들인 기록의 reflects 는 쓰되,
//         원본이 주인인 문서 · 저절로 채우는 표 · kmd 파일은 사람 · 세션과 같이 막힌다(system 이 아니다)
export function save(dir, input, { user, now = new Date(), system = false, agent = false } = {}) {
  if (!user || !oneLine(user)) fail('E_INPUT', '누가 쓰는지 모른다')
  if (isReservedUser(user) && !system && !agent) fail('E_FORBIDDEN', `「${user}」 는 kmd 가 쓰는 이름이다`)
  const secs = check(input)
  const bad = (input.record.tags || []).filter(isReservedTag)
  if (bad.length && !system && !(agent && bad.every((t) => t === 'curate-llm'))) fail('E_FORBIDDEN', `kmd 가 쓰는 태그다 — ${bad.join(' · ')}`)
  if (!system && (input.record.curates?.length || input.record.reopens?.length || (input.record.reflects?.length && !agent))) fail('E_FORBIDDEN', '정리 판정은 kmd 가 쓴다')
  if (!system && secs.some((s) => hasBlockMarker(s.content))) fail('E_FORBIDDEN', '저절로 채우는 표는 kmd 가 원천에서 채운다 — 고치지 않는다', { need: 'machine' })
  const names = cleanNames(input.names)
  if (!names) fail('E_INPUT', 'names 는 { coord: "종류:값", label, aliases?, doc?, heading? } 의 목록이다(종류는 영문 소문자)')
  return serial(path.resolve(dir), () => saveNow(dir, input.record, secs, { user: nfc(user), now, system, names }))
}

// 값 장부 — 글 속의 수 · `코드` · 따옴표 값(같은 값이면 새 사실이 아니다)
export function valuesOf(text) {
  const out = new Set()
  for (const m of String(text || '').matchAll(/`([^`]+)`|「([^」]+)」|"([^"]+)"|(\d+(?:[.,]\d+)*\s*(?:%|초|분|시간|일|개|건|자|MB|GB|KB|ms|s)?)/g)) out.add((m[1] || m[2] || m[3] || m[4]).replace(/\s+/g, ''))
  return out
}

// 좌표정정(R-A2)인가 — 서버가 구조로 판정한다: 바로잡는 기록 하나 · 이름 ⊆ 원 기록의 이름 · 원문을 다시 싣지 않는
// 짧은 글(값이 원 기록 안의 값뿐). 참이면 서버가 예약 태그 touches-fix 를 붙인다(세션이 붙이면 E_FORBIDDEN)
async function isTouchesFix(dir, r, touches, registry) {
  if (!r.fixes || r.fixes.length !== 1) return false
  const orig = await readRecordFile(dir, r.fixes[0], null)
  const o = orig && parseRecord(orig, `${r.fixes[0]}.md`)
  if (!o || !touches.length) return false
  // 원 기록이 반영된 이름 — 원 기록의 이름이거나, 그 항목의 표지가 원 기록인 이름
  for (const c of touches) {
    if (o.touches.includes(c)) continue
    const loc = locate(registry, c)
    const text = loc && (await fs.readFile(path.join(dir, ...loc.doc.split('/')), 'utf8').then(readText, () => null))
    const sec = text && parseDoc(text, '').sections.find((x) => headingMatches(x.h, loc.heading))
    if (!sec || sec.applied !== o.id) return false
  }
  if (String(r.body).length > 400) return false
  const ov = valuesOf(o.body + ' ' + o.title)
  return [...valuesOf(r.body)].every((v) => ov.has(v))
}

// 항목 지문 — 읽을 때 준 base 와 같은 계산(applied 표지는 뺀 글 · 항목이 없으면 빈 글)
export function sectionBase(text, heading) {
  const d = text == null ? null : parseDoc(text, '')
  const sec = d && d.sections.find((x) => headingMatches(x.h, heading))
  return sha16(sec ? sec.body : '')
}

async function saveNow(dir, r, secs, { user, now, system = false, names = [] }) {
  const regRaw = await fs.readFile(path.join(dir, '_managed.md'), 'utf8').then(readText, () => null)
  const vocRaw = await fs.readFile(path.join(dir, '_vocab.md'), 'utf8').then(readText, () => null)
  // 이번에 세우는 이름은 이 저장의 항목 자리(coord)로도 쓴다
  const regNext = names.length ? upsertRegistry(regRaw || '', names) : regRaw || ''
  const vocNext = names.length ? upsertVocab(vocRaw || '', names) : vocRaw || ''
  const registry = parseRegistry(regNext)
  const vocab = parseVocab(vocNext)
  const date = r.date || localStamp(now)
  const touches = [...new Set((r.touches || []).map((x) => nfc(x.trim())))]

  // 항목 자리 먼저 — 하나라도 못 찾으면 아무것도 쓰지 않는다
  const plan = secs.map((s) => {
    if (s.coord != null) {
      const coord = nfc(s.coord.trim())
      const loc = locate(registry, coord)
      if (!loc) fail('E_NOTFOUND', `「${vocab.coords.get(coord)?.label || coord}」 이 들어갈 문서가 정해져 있지 않다 — 기록만 보내거나 문서 · 머리로 가리킨다`)
      if (!touches.includes(coord)) touches.push(coord)
      return { ...docPath(dir, loc.doc), level: loc.level, heading: loc.heading, content: s.content, base: s.base, ...(system && s.applied !== undefined ? { applied: s.applied } : {}) }
    }
    return { ...docPath(dir, s.doc), level: 2, heading: nfc(s.heading.trim()), content: s.content, base: s.base, ...(system && s.applied !== undefined ? { applied: s.applied } : {}) }
  })
  // 고친 기록(edit)은 표지를 뒤로 돌리지 않는다 — 그 항목에 이미 든 기록보다 옛 날짜면 거절
  if ((r.tags || []).includes('edit') && r.date) {
    for (const p of plan) {
      const cur = await fs.readFile(p.full, 'utf8').then(readText, () => null)
      const sec = cur && parseDoc(cur, '').sections.find((x) => headingMatches(x.h, p.heading))
      const a = sec?.applied && parseRecord(await readRecordFile(dir, sec.applied), `${sec.applied}.md`)
      if (a && a.date > date) fail('E_CONFLICT', `「${p.heading}」 에는 더 늦은 기록(${a.date})이 이미 들어 있다 — 옛 날짜로 고치지 않는다`)
    }
  }
  // 원본이 주인 — 문서 감시로 들어온 문서는 사람 · 세션이 고치지 못한다(원본 파일을 고친다 · 덧붙일 말은 기록으로)
  if (!system) {
    for (const p of plan) {
      const w = watchedOf(await fs.readFile(p.full, 'utf8').catch(() => ''))
      if (w) fail('E_FORBIDDEN', `이 문서는 원본이 주인이다 — ${w.src} 의 ${w.path} 를 고친다 · 덧붙일 말은 기록으로 남긴다`, { need: 'source' })
    }
  }
  // 읽은 뒤 바뀌었나(F4) — base 를 보낸 항목만. 하나라도 어긋나면 아무것도 쓰지 않는다
  for (const p of plan) {
    if (p.base == null) continue
    const cur = await fs.readFile(p.full, 'utf8').then(readText, () => null)
    if (sectionBase(cur, p.heading) !== p.base) fail('E_CONFLICT', `「${p.heading}」 이 읽은 뒤 바뀌었다 — 다시 읽고 고친다`)
  }

  await ensureRepo(dir)
  const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
  const base = `${day}-${slugOf(r.title)}`
  // 이력(kmd 가 지식을 다룬 일)은 log/ · 그 밖은 기록(work/) — id 는 둘을 합쳐 겹치지 않게
  const sub = isLogRecord(r.tags) ? LOG_DIR : 'work'
  await fs.mkdir(path.join(dir, sub), { recursive: true })
  let id = base
  for (let n = 2; await recordTaken(dir, id); n++) id = `${base}-${n}`

  const rec = { id, title: nfc(r.title.trim()), date, author: user, touches, tags: (r.tags || []).map((t) => nfc(t.trim())), fixes: (r.fixes || []).map((x) => nfc(x.trim())), curates: r.curates || [], reopens: r.reopens || [], reflects: r.reflects || [] }
  if (!system && (await isTouchesFix(dir, { ...rec, body: r.body }, touches, registry))) rec.tags.push('touches-fix')
  const workRel = `${sub}/${id}.md`
  const workFull = path.join(dir, sub, `${id}.md`)
  // 중간에 넘어지면 쓴 것을 되돌린다 — 반쯤 쓴 저장은 남기지 않는다
  const undo = [() => fs.rm(workFull, { force: true })]
  try {
    await fs.writeFile(workFull, renderRecord(rec, nfc(r.body)), 'utf8')
    // 다시 읽어 대조(F1) — 쓴 머리가 보낸 값 그대로 읽혀야 한다
    const back = parseRecord(readText(await fs.readFile(workFull, 'utf8')), `${id}.md`)
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    if (!back || back.id !== id || back.title !== rec.title || back.date !== date || back.author !== user || !same(back.touches, touches) || !same(back.tags, rec.tags)) fail('E_INPUT', '기록 머리가 보낸 값과 다르게 읽힌다 — 제목 · 이름 · 태그의 글자를 확인한다')
    const docs = []
    for (const p of plan) {
      const raw = await fs.readFile(p.full, 'utf8').catch(() => null)
      const start = raw == null ? `# ${path.basename(p.rel, '.md')}\n` : readText(raw)
      // 사람 · 세션의 저장은 그 항목의 저절로 채우는 표를 그대로 둔다(블록 안은 원천 실행기 · 기계 열쇠만)
      let content = nfc(p.content)
      if (!system) {
        const old = parseDoc(start, '').sections.find((x) => headingMatches(x.h, p.heading))
        if (old) content = keepBlocks(old.body, content)
      }
      const after = replaceSection(start, { level: p.level, heading: p.heading, body: content, applied: p.applied !== undefined ? p.applied : id })
      if (!docs.includes(p.rel)) {
        undo.push(() => (raw == null ? fs.rm(p.full, { force: true }) : fs.writeFile(p.full, raw, 'utf8')))
        docs.push(p.rel)
      }
      await fs.mkdir(path.dirname(p.full), { recursive: true })
      await fs.writeFile(p.full, after, 'utf8')
    }
    // 이름 장부 · 자리 장부 — 바뀐 것만
    const books = []
    for (const [rel, raw, next] of [['_vocab.md', vocRaw, vocNext], ['_managed.md', regRaw, regNext]]) {
      if (!names.length || (raw || '') === next) continue
      undo.push(() => (raw == null ? fs.rm(path.join(dir, rel), { force: true }) : fs.writeFile(path.join(dir, rel), raw, 'utf8')))
      await fs.writeFile(path.join(dir, rel), next, 'utf8')
      books.push(rel)
    }
    const commit = await commitPaths(dir, [workRel, ...docs, ...books], rec.title, user)
    return { id, record: workRel, docs, commit, date, ...(books.length ? { names: names.length } : {}) }
  } catch (e) {
    for (const u of undo.reverse()) await u().catch(() => {})
    throw e
  }
}
