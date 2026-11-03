// 저장 하나 — 기록 하나 + (있으면) 문서 항목들 + git 한 묶음.
//
//   { record: { title, body, touches?, tags?, date?, fixes? },
//     sections?: [{ coord, content }  또는  { doc, heading, content }],
//     names?: [{ coord, label, aliases?, doc?, heading? }] }   ← 이름 장부 · 자리 장부에 이름을 세운다(같은 묶음)
//
// 기록은 늘 남는다(누가 왜 바꿨나의 유일한 자리). 항목을 같이 보내면 그 항목 글을
// 갈아 끼우고 「이 기록을 넣었다」 표지를 단다. 같은 지식의 저장은 한 줄로 선다.
//
// 항목 글은 본문만이다(docs/kmd_문서_작성기준.md). 출처 줄은 저장이 문서 끝 참고 블록에 단다.
// 사람 · 세션 · 에이전트의 글에 기록 링크 · 시스템 주소 · 주석 · 경과 꼬리 · 머리 줄이 섞이면 E_FORMAT 으로 거절한다.
// kmd 자신의 쓰기(system)는 sections[].rough: [기록 id] 로 그 기록의 참고 줄에 「다듬지 못함」 을 붙일 수 있다.

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fail, KmdError } from './errors.js'
import { nfc, oneLine, readText, sha16 } from './text.js'
import { renderRecord, parseRecord } from './frontmatter.js'
import { replaceSection, removeSection, renameSection, parseDoc, headingMatches, splitLog, splitRef, mergeLog, logLine, logHas, ROUGH } from './sections.js'
import { formatCheck, formatMessage, keptMessage, lintNew, lintMessage } from './docformat.js'
import { isReservedUser, isReservedTag, isLogRecord, LOG_DIR } from './names.js'
import { isReservedFile } from './owners.js'
import { keepBlocks, hasBlockMarker } from './baseline.js'
import { locate, parseRegistry } from './registry.js'
import { parseVocab } from './vocab.js'
import { ensureRepo, commitPaths } from './git.js'
import { begin, writeAtomic } from './journal.js'
import { watchedOf } from './watchmark.js'
import { upsertVocab, upsertRegistry, cleanNames, upsertPatternRow, upsertForms, cleanForms } from './namebook.js'
import { guardRecord, guardNames, guardNewDoc, formsOf, EMPTY_MAX } from './guard.js'
import { valuesOf } from './values.js'

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
    .split(/\s+[—–-]\s+|:\s+/)[0]
    .replace(/[\\/:*?"<>|#%`'\u0000-\u001f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/[-.]+$/, '')
  return s || '기록'
}

function check(input) {
  const r = input?.record
  if (!r || typeof r !== 'object') fail('E_INPUT', '기록(record)이 없다. 제목과 글을 보낸다')
  if (!oneLine(r.title) || !r.title.trim()) fail('E_INPUT', '제목은 한 줄 글이다')
  if (r.title.length > 200) fail('E_INPUT', '제목이 너무 길다. 200자 안')
  if (typeof r.body !== 'string') fail('E_INPUT', '글(body)이 없다')
  if (r.body.length > MAX_BODY) fail('E_INPUT', '글이 너무 길다')
  if (r.date != null && !(oneLine(r.date) && DATE.test(r.date))) fail('E_INPUT', '날짜는 YYYY-MM-DD 또는 YYYY-MM-DD HH:MM 모양이다')
  for (const [k, re] of [['touches', COORD], ['tags', /^[^\n]{1,60}$/], ['fixes', /^[^\s/\\]{1,120}$/]]) {
    if (r[k] == null) continue
    if (!Array.isArray(r[k]) || r[k].some((x) => typeof x !== 'string' || !re.test(x.trim()))) fail('E_INPUT', `${k} 는 한 줄 글의 목록이다`)
  }
  if (r.touchesEmpty != null && !(typeof r.touchesEmpty === 'string' && oneLine(r.touchesEmpty) && r.touchesEmpty.trim() && r.touchesEmpty.length <= EMPTY_MAX)) fail('E_INPUT', `touchesEmpty 는 이름이 없는 까닭 한 줄이다(${EMPTY_MAX}자 안)`)
  const secs = input.sections ?? []
  if (!Array.isArray(secs)) fail('E_INPUT', 'sections 는 목록이다')
  for (const s of secs) {
    if (!s || (typeof s.content !== 'string' && !s.remove && s.rename == null)) fail('E_INPUT', '항목마다 content(새 글)가 있다')
    if (s.rename != null && !(oneLine(s.rename) && String(s.rename).trim())) fail('E_INPUT', '새 머리는 한 줄 글이다')
    if (s.coord == null && (s.doc == null || s.heading == null)) fail('E_INPUT', '항목은 이름(coord) 또는 문서 · 머리(doc · heading)로 가리킨다')
    if (s.coord != null && !(typeof s.coord === 'string' && COORD.test(s.coord.trim()))) fail('E_INPUT', `이름 모양이 아니다: ${s.coord}`)
    if (s.heading != null && !(oneLine(s.heading) && s.heading.trim())) fail('E_INPUT', '머리는 한 줄 글이다')
    if (String(s.content ?? '').length > MAX_BODY) fail('E_INPUT', '항목 글이 너무 길다')
    if (s.base != null && !(typeof s.base === 'string' && /^[0-9a-f]{16}$/.test(s.base))) fail('E_INPUT', 'base 는 읽을 때 받은 16자 지문이다')
  }
  return secs
}

// 문서 자리 — docs/ 아래 md 만 · 폴더 밖으로 못 나간다
function docPath(dir, doc) {
  let p = nfc(String(doc)).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!p.startsWith('docs/')) p = `docs/${p}`
  if (!p.endsWith('.md')) p += '.md'
  if (p.split('/').some((x) => x === '..' || x === '.' || x === '') || /[\u0000-\u001f]/.test(p)) fail('E_INPUT', `문서 자리가 아니다: ${doc}`)
  if (isReservedFile(p)) fail('E_FORBIDDEN', `kmd 가 쓰는 파일이다: ${doc}`)
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
// guard — 지식 생성 가드(core/guard.js)의 길. 'strict'(거절형 — 세션 · 화면) · 'hold'(붙잡아 두기 — 그 밖의 길 · 기본)
//         holdWhy — hold 에서 이름 없는 기록에 kmd 가 다는 까닭 · proposed — 세울 이름으로 실어 둔 이름(일반 자리의 names)
export function save(dir, input, { user, now = new Date(), system = false, agent = false, guard = 'hold', holdWhy = null, proposed = [] } = {}) {
  if (!user || !oneLine(user)) fail('E_INPUT', '누가 쓰는지 모른다')
  if (isReservedUser(user) && !system && !agent) fail('E_FORBIDDEN', `「${user}」 는 kmd 가 쓰는 이름이다`)
  const secs = check(input)
  const bad = (input.record.tags || []).filter(isReservedTag)
  if (bad.length && !system && !(agent && bad.every((t) => t === 'curate-llm'))) fail('E_FORBIDDEN', `kmd 가 쓰는 태그다: ${bad.join(' · ')}`)
  if (!system && (input.record.curates?.length || input.record.reopens?.length || (input.record.reflects?.length && !agent))) fail('E_FORBIDDEN', '정리 판정은 kmd 가 쓴다')
  // 항목 지우기 · 이름 바꾸기 — 화면의 고치기(관리자)만 · kmd 가 대신 쓴다
  if (!system && secs.some((s) => s.remove || s.rename != null)) fail('E_FORBIDDEN', '항목 지우기 · 이름 바꾸기는 화면의 고치기로 한다')
  if (!system && secs.some((s) => hasBlockMarker(s.content ?? ''))) fail('E_FORBIDDEN', '저절로 채우는 표는 kmd 가 원천에서 채운다. 고치지 않는다', { need: 'machine' })
  // 문서 꼴(작성기준 8절) — 사람 · 세션 · 에이전트의 항목 글은 본문만. 지금 글과 견주어야 하므로 saveNow 에서 본다
  //   (kmd 자신의 쓰기는 고쳐서 넣는다)
  const names = cleanNames(input.names)
  if (!names) fail('E_INPUT', 'names 는 { coord: "종류:값", label, aliases?, doc?, heading? } 의 목록이다(종류는 영문 소문자 또는 한글)')
  const forms = cleanForms(input.forms)
  if (!forms) fail('E_INPUT', 'forms 는 { name: 갈래, aliases?, folder?, kind?: 대상 · 서술 · 사건 · 대장, pattern?: "종류:*", form? } 의 목록이다')
  const mode = guard === 'strict' && !system ? 'strict' : 'hold'
  return serial(path.resolve(dir), () => saveNow(dir, input.record, secs, { user: nfc(user), now, system, names, forms, mode, holdWhy, proposed: new Set((proposed || []).map((x) => nfc(String(x).trim()))) }))
}

// 가드 오류 — 첫 까닭을 글로 · 나머지는 details 로
function guardFail(errors) {
  const e = errors[0]
  fail(e.code || 'E_INPUT', errors.length > 1 ? `${e.message} (그 밖에 ${errors.length - 1}건)` : e.message, { guard: errors.map(({ code, ...x }) => x) })
}

// 기록 여럿 — 문서 항목 없이 기록만 · git 한 묶음(받기 — 보낸 것 150개가 커밋 150번이 되지 않게)
//   글마다 검사하고 거절된 것은 { i, error } 로 돌려준다(나머지는 남긴다) · 커밋이 넘어지면 쓴 기록을 모두 지운다
//   { records: [{ i, id } | { i, error }], commit } — 남긴 것이 없으면 commit null
//   가드는 붙잡아 두기(hold) — 받은 것은 잃지 않는다: 폐기 · 같은 말 이름은 바꿔 달고, 장부 밖 이름 · 이름 없는 기록은 그 상태로(까닭 holdWhy)
export function saveRecords(dir, records, { user, now = new Date(), holdWhy = '받음: 이 지식의 이름 장부에서 맞는 이름을 찾지 못했다' } = {}) {
  if (!user || !oneLine(user)) fail('E_INPUT', '누가 쓰는지 모른다')
  if (isReservedUser(user)) fail('E_FORBIDDEN', `「${user}」 는 kmd 가 쓰는 이름이다`)
  return serial(path.resolve(dir), async () => {
    await ensureRepo(dir)
    const vocab = parseVocab(await fs.readFile(path.join(dir, '_vocab.md'), 'utf8').then(readText, () => ''))
    // 쓰인 id — 처음에 폴더를 한 번 읽는다(같은 제목이 많으면 -2 · -3 … 을 찾느라 글마다 stat 수백 번이 된다)
    const taken = new Set()
    for (const sub of ['work', LOG_DIR]) for (const f of await fs.readdir(path.join(dir, sub)).catch(() => [])) if (f.endsWith('.md')) taken.add(nfc(f.slice(0, -3)).toLowerCase()) // 키는 소문자 — Windows 파일 이름은 대소문자를 가리지 않는다
    const out = []
    const written = []
    const j = await begin(dir)
    try {
      for (const [i, r] of records.entries()) {
        try {
          if ((r?.sections?.length ?? 0) || (r?.names?.length ?? 0)) fail('E_INPUT', '기록 여럿 저장은 기록만 받는다')
          check({ record: r })
          const bad = (r.tags || []).filter(isReservedTag)
          if (bad.length) fail('E_FORBIDDEN', `kmd 가 쓰는 태그다: ${bad.join(' · ')}`)
          if (r.curates?.length || r.reopens?.length || r.reflects?.length) fail('E_FORBIDDEN', '정리 판정은 kmd 가 쓴다')
          const g = guardRecord(vocab, r, { mode: 'hold', why: holdWhy })
          const w = await writeRecord(dir, { ...r, touches: g.touches, touchesEmpty: g.touchesEmpty }, { user: nfc(user), now, taken, j })
          written.push(w)
          out.push({ i, id: w.id, ...(g.touchesEmpty ? { unnamed: true } : {}), ...(g.outside.length ? { outside: g.outside } : {}), ...(g.fixes.length ? { fixes: g.fixes } : {}) })
        } catch (e) {
          if (!(e instanceof KmdError)) throw e // 디스크 · git 은 묶음 전체의 실패
          out.push({ i, error: e })
        }
      }
      const commit = written.length ? await commitPaths(dir, written.map((w) => w.rel), written.length === 1 ? written[0].title : `${written[0].title} 외 ${written.length - 1}개`, nfc(user)) : null
      await j.done()
      return { records: out, commit }
    } catch (e) {
      await j.undo().catch(() => {})
      throw e
    }
  })
}

// 기록 파일 하나 쓰기(커밋 없이) — id 를 정하고 쓰고 다시 읽어 대조한다 · 대조가 어긋나면 지우고 던진다
async function writeRecord(dir, r, { user, now, taken, j }) {
  const date = r.date || localStamp(now)
  const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
  const base = `${day}-${slugOf(r.title)}`
  const sub = isLogRecord(r.tags) ? LOG_DIR : 'work'
  await fs.mkdir(path.join(dir, sub), { recursive: true })
  let id = base
  for (let n = 2; taken.has(id.toLowerCase()); n++) id = `${base}-${n}`
  taken.add(id.toLowerCase())
  const touches = [...new Set((r.touches || []).map((x) => nfc(x.trim())))]
  const rec = { id, title: nfc(r.title.trim()), date, author: user, touches, touchesEmpty: touches.length ? null : r.touchesEmpty || null, tags: (r.tags || []).map((t) => nfc(t.trim())), fixes: (r.fixes || []).map((x) => nfc(x.trim())), curates: [], reopens: [], reflects: [] }
  const full = path.join(dir, sub, `${id}.md`)
  await j.add(`${sub}/${id}.md`)
  await writeAtomic(full, renderRecord(rec, nfc(r.body)))
  const back = parseRecord(readText(await fs.readFile(full, 'utf8')), `${id}.md`)
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  if (!back || back.id !== id || back.title !== rec.title || back.date !== date || back.author !== user || !same(back.touches, touches) || !same(back.tags, rec.tags)) {
    await fs.rm(full, { force: true })
    fail('E_INPUT', '기록 머리가 보낸 값과 다르게 읽힌다. 제목 · 이름 · 태그의 글자를 확인한다')
  }
  return { id, rel: `${sub}/${id}.md`, full, title: rec.title }
}

// 값 장부는 core/values.js 로 옮겼다(S2 · docs/품질개선/KMD_개편_설계.md 3-1) — 부르는 곳을 바꾸지 않게 다시 내보낸다
export { valuesOf }

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

async function saveNow(dir, r, secs, { user, now, system = false, names = [], forms: formsIn = [], mode = 'hold', holdWhy = null, proposed = new Set() }) {
  const regRaw = await fs.readFile(path.join(dir, '_managed.md'), 'utf8').then(readText, () => null)
  const vocRaw = await fs.readFile(path.join(dir, '_vocab.md'), 'utf8').then(readText, () => null)
  const formRaw = await fs.readFile(path.join(dir, '_forms.md'), 'utf8').then(readText, () => null)
  const guardWarn = []
  // 가드 G1 — 세울 이름의 모양(장부에 없던 이름만). 거절형은 거절 · 붙잡아 두기는 그 이름만 세우지 않는다
  {
    const g = guardNames(parseVocab(vocRaw || ''), names)
    if (g.errors.length && mode === 'strict') guardFail(g.errors)
    if (g.errors.length) {
      const bad = new Set(g.errors.map((e) => e.name))
      names = names.filter((n) => !bad.has(n.coord))
      guardWarn.push(...g.errors.map((e) => `이름을 세우지 않았다: ${e.message}`))
    }
    guardWarn.push(...g.warnings)
  }
  // 이번에 세우는 이름은 이 저장의 항목 자리(coord)로도 쓴다
  let regNext = names.length ? upsertRegistry(regRaw || '', names) : regRaw || ''
  const vocNext = names.length ? upsertVocab(vocRaw || '', names) : vocRaw || ''
  const formNext = formsIn.length ? upsertForms(formRaw || '', formsIn) : formRaw || ''
  const vocab = parseVocab(vocNext)
  const forms = formsOf(formNext)
  const date = r.date || localStamp(now)
  let touches = [...new Set((r.touches || []).map((x) => nfc(x.trim())))]
  // 새 문서(G4) — 지금 없는 문서를 세우는 항목 글. 갈래 · 폴더 · 머리 꼴을 보고, 갈래에 이름 패턴이 있으면 자리 장부 행을 같이 세운다
  {
    const fresh = new Map()
    for (const s of secs) {
      if (s.coord != null || s.remove || s.rename != null) continue
      const p = docPath(dir, s.doc)
      if (existsSync(p.full)) continue
      if (!fresh.has(p.rel)) fresh.set(p.rel, [])
      fresh.get(p.rel).push(nfc(String(s.heading).trim()))
    }
    for (const [rel, hs] of fresh) {
      const g = guardNewDoc(forms, rel, hs)
      if (g.errors.length && mode === 'strict') guardFail(g.errors)
      guardWarn.push(...g.errors.map((e) => `새 문서 ${rel.replace(/^docs\/|\.md$/g, '')}: ${e.message}`))
      if (g.registryRow) regNext = upsertPatternRow(regNext, g.registryRow.pattern, g.registryRow.doc)
    }
  }
  const registry = parseRegistry(regNext)

  // 항목 자리 먼저 — 하나라도 못 찾으면 아무것도 쓰지 않는다
  const plan = secs.map((s) => {
    if (s.coord != null) {
      const coord = nfc(s.coord.trim())
      const loc = locate(registry, coord)
      if (!loc) fail('E_NOTFOUND', `「${vocab.coords.get(coord)?.label || coord}」 이 들어갈 문서가 정해져 있지 않다. 기록만 보내거나 문서 · 머리로 가리킨다`)
      if (!touches.includes(coord)) touches.push(coord)
      return { ...docPath(dir, loc.doc), level: loc.level, heading: loc.heading, content: s.content, base: s.base, ...(system && s.applied !== undefined ? { applied: s.applied } : {}) }
    }
    return { ...docPath(dir, s.doc), level: 2, heading: nfc(s.heading.trim()), content: s.content ?? '', base: s.base, ...(s.remove ? { remove: true } : {}), ...(s.rename != null ? { rename: nfc(String(s.rename).trim()) } : {}), ...(system && s.applied !== undefined ? { applied: s.applied } : {}) }
  }).map((p, i) => (system && Array.isArray(secs[i].rough) ? { ...p, rough: secs[i].rough.map(String) } : p))
  // 가드 G2 · G3 — 건드린 이름은 장부에 있는 것 · 이름 없는 기록은 까닭과 함께
  //   (항목 글로 가리킨 이름은 위에서 touches 에 들었다 · 문서 · 머리로 가리킨 항목은 이 기록의 자리다)
  const placed = plan.some((p) => !p.remove && p.rename == null)
  const g = guardRecord(vocab, { ...r, touches, ...(placed ? { tags: [...(r.tags || []), 'at/'] } : {}) }, { mode, proposed, why: holdWhy })
  if (g.errors.length) guardFail(g.errors)
  touches = g.touches
  const touchesEmpty = g.touchesEmpty
  guardWarn.push(...g.fixes.map((f) => `이름을 바꿔 달았다: ${f.from} → ${f.to}${f.how === 'deprecated' ? '(폐기된 이름)' : '(같은 말)'}`))
  if (g.outside.length) guardWarn.push(`이름 장부에 없는 이름: ${g.outside.join(' · ')}. 지식관리자가 이름을 세우거나 고를 때까지 「장부 밖 이름」 으로 보인다`)
  // 고친 기록(edit)은 표지를 뒤로 돌리지 않는다 — 그 항목에 이미 든 기록보다 옛 날짜면 거절
  if ((r.tags || []).includes('edit') && r.date) {
    for (const p of plan) {
      const cur = await fs.readFile(p.full, 'utf8').then(readText, () => null)
      const sec = cur && parseDoc(cur, '').sections.find((x) => headingMatches(x.h, p.heading))
      const a = sec?.applied && parseRecord(await readRecordFile(dir, sec.applied), `${sec.applied}.md`)
      if (a && a.date > date) fail('E_CONFLICT', `「${p.heading}」 에는 더 늦은 기록(${a.date})이 이미 들어 있다. 옛 날짜로 고치지 않는다`)
    }
  }
  // 원본이 주인 — 문서 감시로 들어온 문서는 사람 · 세션이 고치지 못한다(원본 파일을 고친다 · 덧붙일 말은 기록으로)
  if (!system) {
    for (const p of plan) {
      const w = watchedOf(await fs.readFile(p.full, 'utf8').catch(() => ''))
      if (w) fail('E_FORBIDDEN', `이 문서는 원본이 주인이다: ${w.src} 의 ${w.path} 를 고친다 · 덧붙일 말은 기록으로 남긴다`, { need: 'source' })
    }
  }
  // 읽은 뒤 바뀌었나(F4) — base 를 보낸 항목만. 하나라도 어긋나면 아무것도 쓰지 않는다
  for (const p of plan) {
    if (p.base == null) continue
    const cur = await fs.readFile(p.full, 'utf8').then(readText, () => null)
    if (sectionBase(cur, p.heading) !== p.base) fail('E_CONFLICT', `「${p.heading}」 이 읽은 뒤 바뀌었다. 다시 읽고 고친다`)
  }
  // 문서 꼴(작성기준 8절) — 사람 · 세션 · 에이전트가 넣은 줄만 거절한다. 지금 글에 이미 있던 줄(옛 들이기 · 손으로 쓴 줄)은
  //   거절하지 않고 알린다(formatKept) — append 처럼 서버가 지금 글에 덧붙인 것을 보낸 쪽이 고칠 수 없으므로
  const formatKept = []
  if (!system) {
    for (const [i, p] of plan.entries()) {
      if (typeof p.content !== 'string' || p.remove || p.rename != null) continue
      const cur = await fs.readFile(p.full, 'utf8').then(readText, () => null)
      const old = cur && parseDoc(cur, '').sections.find((x) => headingMatches(x.h, p.heading))
      const name = secs[i].heading || secs[i].coord || '항목'
      const r = formatCheck(p.content, { doc: p.rel, old: old ? old.body : null })
      if (r.problems.length) fail('E_FORMAT', formatMessage(name, r.problems), { problems: r.problems })
      if (r.kept.length) formatKept.push(keptMessage(name, r.kept))
    }
  }

  await ensureRepo(dir)
  const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
  const base = `${day}-${slugOf(r.title)}`
  // 이력(kmd 가 지식을 다룬 일)은 log/ · 그 밖은 기록(work/) — id 는 둘을 합쳐 겹치지 않게
  const sub = isLogRecord(r.tags) ? LOG_DIR : 'work'
  await fs.mkdir(path.join(dir, sub), { recursive: true })
  let id = base
  for (let n = 2; await recordTaken(dir, id); n++) id = `${base}-${n}`

  const rec = { id, title: nfc(r.title.trim()), date, author: user, touches, touchesEmpty, tags: (r.tags || []).map((t) => nfc(t.trim())), fixes: (r.fixes || []).map((x) => nfc(x.trim())), curates: r.curates || [], reopens: r.reopens || [], reflects: r.reflects || [] }
  if (!system && (await isTouchesFix(dir, { ...rec, body: r.body }, touches, registry))) rec.tags.push('touches-fix')
  const workRel = `${sub}/${id}.md`
  const workFull = path.join(dir, sub, `${id}.md`)
  // 중간에 넘어지거나 꺼지면 쓴 것을 되돌린다 — 반쯤 쓴 저장은 남기지 않는다(저널 · 꺼졌으면 다음 저장 · 켤 때)
  const j = await begin(dir)
  try {
    await j.add(workRel)
    await writeAtomic(workFull, renderRecord(rec, nfc(r.body)))
    // 다시 읽어 대조(F1) — 쓴 머리가 보낸 값 그대로 읽혀야 한다
    const back = parseRecord(readText(await fs.readFile(workFull, 'utf8')), `${id}.md`)
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    if (!back || back.id !== id || back.title !== rec.title || back.date !== date || back.author !== user || !same(back.touches, touches) || !same(back.tags, rec.tags)) fail('E_INPUT', '기록 머리가 보낸 값과 다르게 읽힌다. 제목 · 이름 · 태그의 글자를 확인한다')
    const docs = []
    // 경과에 달 기록 — 정리 · 넣기는 넣은 기록들(reflects) · 사람의 기록은 그 자신. 원천이 쓰는 저장(kmd)은 달지 않는다
    const logged = []
    for (const x of rec.reflects.length ? rec.reflects : sub === 'work' && user !== 'kmd' && user !== 'kmd-auto' ? [id] : []) {
      if (x === id) logged.push({ id, title: rec.title, date, sub })
      else {
        const w = parseRecord(await readRecordFile(dir, x), `${x}.md`)
        if (w) logged.push({ ...w, id: x, sub: existsSync(path.join(dir, 'work', `${x}.md`)) ? 'work' : LOG_DIR })
      }
    }
    // 문서 짜임(제목 · 요약 · 머리 단계) — 이 저장으로 새로 생긴 것만 알린다(거절하지 않는다) · 문서마다 처음 글과 마지막 글
    const shape = new Map()
    for (const p of plan) {
      const raw = await fs.readFile(p.full, 'utf8').catch(() => null)
      const start = raw == null ? `# ${path.basename(p.rel, '.md')}\n` : readText(raw)
      // 새 문서는 kmd 가 세운 「# 이름」 과 견준다(요약이 없는 것은 이 저장 탓이 아니다)
      if (!shape.has(p.rel)) shape.set(p.rel, { before: start, after: null })
      // 사람 · 세션의 저장은 그 항목의 저절로 채우는 표를 그대로 둔다(블록 안은 원천 실행기 · 기계 열쇠만)
      let content = nfc(p.content ?? '')
      const old = parseDoc(start, '').sections.find((x) => headingMatches(x.h, p.heading))
      if (!system && old) content = keepBlocks(old.body, content)
      // 참고 줄(작성기준 2-1) — 옛 줄은 지키고(보낸 글에 없어도) 이번 기록의 줄을 더한다 · 문서 끝 참고 블록에 쓴다(본문에는 넣지 않는다)
      //   kmd 자신의 쓰기에 섞인 경과 꼬리 · 참고 블록은 떼어 줄로 옮긴다(사람 · 세션의 것은 save 의 검사가 이미 거절했다)
      //   원본이 주인인 문서는 원본 글 그대로(줄을 달지 않는다)
      let log
      if (!p.remove && p.rename == null && !watchedOf(start)) {
        const r = splitRef(content.split('\n'))
        const now = splitLog(r.lines.join('\n'))
        log = mergeLog(old?.log || [], now.log, ...r.ref.values())
        for (const w of logged) if (!logHas(log, w.id)) log.push(logLine(p.rel, w, p.rough?.includes(w.id) ? ROUGH : ''))
        content = now.log.length || r.found ? now.body : content
      }
      const after = p.remove ? removeSection(start, { level: p.level, heading: p.heading }) : p.rename ? renameSection(start, { level: p.level, heading: p.heading, to: p.rename }) : replaceSection(start, { level: p.level, heading: p.heading, body: content, applied: p.applied !== undefined ? p.applied : id, log })
      if (!docs.includes(p.rel)) {
        await j.add(p.rel)
        docs.push(p.rel)
      }
      await fs.mkdir(path.dirname(p.full), { recursive: true })
      await writeAtomic(p.full, after)
      shape.get(p.rel).after = after
    }
    // 이름 장부 · 자리 장부 — 바뀐 것만
    const books = []
    for (const [rel, raw, next] of [['_vocab.md', vocRaw, vocNext], ['_managed.md', regRaw, regNext], ['_forms.md', formRaw, formNext]]) {
      if ((raw || '') === next) continue
      await j.add(rel)
      await writeAtomic(path.join(dir, rel), next)
      books.push(rel)
    }
    // 항목 이름을 바꿨으면 자리 장부의 그 항목 줄도 새 머리로(이름은 그대로 · 항목이 문서에서 떨어지지 않게)
    const renames = plan.filter((p) => p.rename)
    const regNow = books.includes('_managed.md') ? regNext : regRaw
    if (renames.length && regNow) {
      let t = regNow
      for (const p of renames) t = t.split('\n').map((l) => (l.includes(`\`${p.rel}\``) && l.includes(`\`## ${p.heading}\``) ? l.replace(`\`## ${p.heading}\``, `\`## ${p.rename}\``) : l)).join('\n')
      if (t !== regNow) {
        await j.add('_managed.md')
        await writeAtomic(path.join(dir, '_managed.md'), t)
        if (!books.includes('_managed.md')) books.push('_managed.md')
      }
    }
    const commit = await commitPaths(dir, [workRel, ...docs, ...books], rec.title, user)
    await j.done()
    const docLint = []
    for (const [rel, x] of shape) {
      if (x.after == null) continue
      const xs = lintNew(x.before, x.after)
      if (xs.length) docLint.push(lintMessage(rel.replace(/^docs\/|\.md$/g, ''), xs))
    }
    return { id, record: workRel, docs, commit, date, ...(books.length ? { names: names.length } : {}), ...(formsIn.length ? { forms: formsIn.length } : {}), ...(formatKept.length ? { formatKept } : {}), ...(docLint.length ? { docLint } : {}), ...(guardWarn.length ? { guardWarn } : {}), ...(touchesEmpty ? { touchesEmpty } : {}) }
  } catch (e) {
    await j.undo().catch(() => {})
    throw e
  }
}
