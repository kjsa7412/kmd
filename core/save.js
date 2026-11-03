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
//
// 저장 문(docs/품질개선/KMD_개편_설계.md 3-2 · S3) — 옵션을 주지 않으면 옛 저장과 결과가 같다.
//   prepare   같은 줄(serial) 안 · 남은 저널을 되돌린 다음에 부른다 → { sections?, held?, proposals?, warnings? } | { abort: { same, id } }
//             돌려준 sections 도 입력과 같은 검사(guardSections)를 거친다
//   partial   항목 하나의 실패(넣을 곳 없음 · 원본이 주인 · 문서 꼴 · 저절로 채우는 표)를 그 항목의 「넣지 못함」 으로(기록은 남긴다)
//   intake    { tags } — 들이기 일감의 저장. 예약 사람 kmd · 저장 문이 붙이는 예약 태그(intake · job/<id> · code-change · polish)
//   asEdit    edit 태그 하나를 받는다(사람의 화면 고치기) · structure — 항목 지우기 · 이름 바꾸기를 받는다(지식관리자 화면 고치기)
//   correction 좌표정정(touches-fix) 판정을 건너뛴다(서버가 정한 다시 저장) · onCommit — 커밋 뒤 줄을 놓기 전에(던져도 log 만)
//   partial · intake 저장은 넣은 항목을 기록 끝 `## 넣은 것`(태그 put) · 못 넣은 조각을 `## 넣지 못함`(태그 held) 칸으로 남긴다(core/parts.js)
//   record.memo — 메모(태그 memo · 항목 글을 받지 않는다) · input.attach — docs/assets/ 아래 첨부(같은 저널 · 같은 커밋)

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fail, KmdError } from './errors.js'
import { nfc, oneLine, readText, sha16 } from './text.js'
import { renderRecord, parseRecord } from './frontmatter.js'
import { replaceSection, removeSection, renameSection, parseDoc, findHeading, splitLog, splitRef, mergeLog, logLine, logHas, ROUGH } from './sections.js'
import { formatCheck, formatMessage, keptMessage, lintNew, lintMessage } from './docformat.js'
import { isReservedUser, isReservedTag, isLogRecord, LOG_DIR } from './names.js'
import { isReservedFile } from './owners.js'
import { keepBlocks, hasBlockMarker } from './baseline.js'
import { locate, parseRegistry } from './registry.js'
import { parseVocab } from './vocab.js'
import { ensureRepo, commitPaths, headSha } from './git.js'
import { begin, recover, writeAtomic } from './journal.js'
import { watchedOf } from './watchmark.js'
import { upsertVocab, upsertRegistry, cleanNames, upsertPatternRow, upsertForms, cleanForms } from './namebook.js'
import { guardRecord, guardNames, guardNewDoc, formsOf, EMPTY_MAX } from './guard.js'
import { valuesOf, valueDiff } from './values.js'
import { renderPut, renderHeld, KMD_PART_RE } from './parts.js'

const DATE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/
const COORD = /^[^\s:`]+:[^\n`]+$/
const MAX_BODY = 200_000
// 한 저장의 항목 수 — 새 저장 문(prepare · partial · intake)에서만 센다(옛 길은 그대로)
export const SECTIONS_MAX = 50
// 첨부(S-D30) — docs/assets/ 아래 · 허용 꼴 · 한 저장 20개 · 파일 하나 32MB(채널마다 더 작은 한도는 hub 가 본다)
export const ATTACH_MAX_FILES = 20
export const ATTACH_MAX_BYTES = 32 * 1024 * 1024
const ASSET_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'hwp', 'hwpx', 'txt', 'zip'])
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
// 들이기 저장에 저장 문이 붙이는 예약 태그(S-D43)
const INTAKE_TAG = (t) => ['intake', 'code-change', 'polish'].includes(t) || /^job\/[A-Za-z0-9_-]{1,64}$/.test(t)

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

function check(input, { system = false, many = false } = {}) {
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
  if (r.memo != null && typeof r.memo !== 'boolean') fail('E_INPUT', 'memo 는 참 · 거짓이다')
  // kmd 가 쓰는 칸(S-D45) — 사람 · 세션 · 받은 기록의 본문에 같은 머리가 있으면 거짓 이력 · 엉뚱한 다시 들이기가 된다
  const part = !system && String(r.body).match(KMD_PART_RE)
  if (part) fail('E_INPUT', `「## ${part[1]}」 머리는 kmd 가 쓴다. 기록 글에 쓰지 않는다`)
  const secs = sectionShape(input.sections ?? [], { many })
  if (r.memo === true && secs.length) fail('E_INPUT', '메모는 항목 글을 받지 않는다')
  checkAttach(input.attach)
  return secs
}

// 항목 모양 — 입력과 prepare 결과가 같이 거친다(S-D44)
function sectionShape(secs, { many = false } = {}) {
  if (!Array.isArray(secs)) fail('E_INPUT', 'sections 는 목록이다')
  if (many && secs.length > SECTIONS_MAX) fail('E_INPUT', `항목은 한 번에 ${SECTIONS_MAX}개까지 보낸다`)
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

function checkAttach(att) {
  if (att == null) return
  if (!Array.isArray(att) || att.length > ATTACH_MAX_FILES) fail('E_INPUT', `attach 는 { path, b64 } 의 목록이다(${ATTACH_MAX_FILES}개까지)`)
  for (const a of att) {
    if (!a || typeof a.path !== 'string' || typeof a.b64 !== 'string') fail('E_INPUT', '첨부마다 path(docs/assets/ 아래)와 b64(base64 글)가 있다')
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(a.b64)) fail('E_INPUT', `첨부 글이 base64 가 아니다: ${a.path}`)
    if (Math.floor((a.b64.length * 3) / 4) > ATTACH_MAX_BYTES + 3) fail('E_INPUT', `첨부가 너무 크다: ${a.path}`)
  }
}

// 첨부 자리 — docs/assets/ 아래만 · 폴더 밖 · 장치 이름 · 이상한 글자 · 허용하지 않는 꼴은 거절(docPath 는 .md 를 붙이므로 따로)
export function assetPath(dir, p) {
  const s = nfc(String(p ?? ''))
  if (!s || s.length > 300 || /[\u0000-\u001f\\:*?"<>|]/.test(s)) fail('E_INPUT', `첨부 자리가 아니다: ${p}`)
  const rel = s.startsWith('docs/assets/') ? s : s.startsWith('assets/') ? `docs/${s}` : null
  if (!rel) fail('E_INPUT', `첨부는 docs/assets/ 아래에만 둔다: ${p}`)
  const parts = rel.split('/')
  if (parts.length < 3 || parts.some((x) => x === '' || x === '.' || x === '..' || DEVICE.test(x) || /[ .]$/.test(x))) fail('E_INPUT', `첨부 자리가 아니다: ${p}`)
  const ext = (parts[parts.length - 1].match(/\.([^.]+)$/) || [])[1]?.toLowerCase()
  if (!ext || !ASSET_EXT.has(ext)) fail('E_INPUT', `올릴 수 없는 첨부 꼴이다: ${p}`)
  return { rel, full: path.join(dir, ...parts) }
}

// 문서 자리(글) — 던지지 않는다(넣지 못함 줄에 싣는 값)
const relOf = (doc) => {
  let p = nfc(String(doc ?? '')).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!p.startsWith('docs/')) p = `docs/${p}`
  return p.endsWith('.md') ? p : `${p}.md`
}
// 넣지 못함 줄 하나(core/parts.js renderHeld) — 다시 들이기 · 고치기의 재료로 base · content 를 같이 둔다
function heldRow(s, code, why, extra = {}) {
  return {
    ...(s.coord != null ? { coord: nfc(String(s.coord).trim()) } : {}),
    ...(s.doc != null ? { doc: relOf(s.doc) } : extra.doc ? { doc: extra.doc } : {}),
    ...(s.heading != null ? { heading: nfc(String(s.heading).trim()) } : extra.heading ? { heading: extra.heading } : {}),
    code,
    why: String(why).slice(0, 500),
    ...(s.base ? { base: s.base } : {}),
    ...(Array.isArray(s.edits) ? { edits: s.edits } : {}),
    ...(typeof s.content === 'string' ? { content: s.content } : {}),
  }
}

// 항목 검사(S-D44) — 입력 sections 와 prepare 가 돌려준 sections 에 둘 다 돈다.
//   지우기 · 이름 바꾸기는 system 이나 structure(지식관리자 화면 고치기)만 · 저절로 채우는 표 표지는 partial 이면 넣지 못함(machine)
function guardSections(secs, { system = false, structure = false, partial = false } = {}) {
  const keep = []
  const held = []
  for (const s of secs) {
    if (!system && !structure && (s.remove || s.rename != null)) fail('E_FORBIDDEN', '항목 지우기 · 이름 바꾸기는 화면의 고치기로 한다')
    if (s.doc != null && isReservedFile(relOf(s.doc))) fail('E_FORBIDDEN', `kmd 가 쓰는 파일이다: ${s.doc}`)
    if (!system && hasBlockMarker(s.content ?? '')) {
      const why = '저절로 채우는 표는 kmd 가 원천에서 채운다. 고치지 않는다'
      if (!partial) fail('E_FORBIDDEN', why, { need: 'machine' })
      held.push(heldRow(s, 'machine', why))
      continue
    }
    keep.push(s)
  }
  return { secs: keep, held }
}

// prepare 가 실은 넣지 못함 줄 — 정해진 칸만(core/parts.js 가 다시 고른다) · 까닭은 한 줄
function cleanHeld(rows) {
  if (rows == null) return []
  if (!Array.isArray(rows)) fail('E_INPUT', 'held 는 목록이다')
  return rows.filter((x) => x && typeof x === 'object' && typeof x.code === 'string' && x.code).map((x) => ({ ...x, code: x.code.slice(0, 40), why: String(x.why ?? '').replace(/\s+/g, ' ').slice(0, 500) }))
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
export function save(dir, input, { user, now = new Date(), system = false, agent = false, guard = 'hold', holdWhy = null, proposed = [], prepare = null, onCommit = null, partial = false, asEdit = false, structure = false, correction = false, intake = null } = {}) {
  if (!user || !oneLine(user)) fail('E_INPUT', '누가 쓰는지 모른다')
  // 들이기 일감은 예약 사람 kmd 로 쓸 수 있다(가져올 곳) — kmd-auto · kmd-worker 는 아니다(S-D43)
  const kmdIntake = !!intake && nfc(user).trim().toLowerCase() === 'kmd'
  if (isReservedUser(user) && !system && !agent && !kmdIntake) fail('E_FORBIDDEN', `「${user}」 는 kmd 가 쓰는 이름이다`)
  if (prepare != null && typeof prepare !== 'function') fail('E_INPUT', 'prepare 는 함수다')
  const fresh = !!(prepare || partial || intake) // 새 저장 문 — 항목 수를 센다
  const secs0 = check(input, { system, many: fresh && !system })
  // 예약 태그 — 입력으로는 받지 않는다(저장 문이 붙이는 것은 아래 serverTags) · asEdit 은 edit 하나만
  const bad = (input.record.tags || []).filter(isReservedTag).filter((t) => !(asEdit && String(t).trim() === 'edit'))
  if (bad.length && !system && !(agent && bad.every((t) => t === 'curate-llm'))) fail('E_FORBIDDEN', `kmd 가 쓰는 태그다: ${bad.join(' · ')}`)
  if (!system && (input.record.curates?.length || input.record.reopens?.length || (input.record.reflects?.length && !agent))) fail('E_FORBIDDEN', '정리 판정은 kmd 가 쓴다')
  let serverTags = []
  if (intake) {
    const t = intake.tags ?? []
    if (!Array.isArray(t) || t.some((x) => typeof x !== 'string' || !INTAKE_TAG(x))) fail('E_INPUT', '들이기 태그는 intake · job/<일감 id> · code-change · polish 만 붙인다')
    serverTags = [...new Set(['intake', ...t])]
  }
  // 항목 지우기 · 이름 바꾸기 — 화면의 고치기(지식관리자)만 · 저절로 채우는 표는 고치지 않는다(partial 이면 그 항목만 넣지 못함)
  const g0 = guardSections(secs0, { system, structure, partial })
  // 문서 꼴(작성기준 8절) — 사람 · 세션 · 에이전트의 항목 글은 본문만. 지금 글과 견주어야 하므로 saveNow 에서 본다
  //   (kmd 자신의 쓰기는 고쳐서 넣는다)
  const names = cleanNames(input.names)
  if (!names) fail('E_INPUT', 'names 는 { coord: "종류:값", label, aliases?, doc?, heading? } 의 목록이다(종류는 영문 소문자 또는 한글)')
  const forms = cleanForms(input.forms)
  if (!forms) fail('E_INPUT', 'forms 는 { name: 갈래, aliases?, folder?, kind?: 대상 · 서술 · 사건 · 대장, pattern?: "종류:*", form? } 의 목록이다')
  const mode = guard === 'strict' && !system ? 'strict' : 'hold'
  return serial(path.resolve(dir), async () => {
    // 줄 첫머리 — 남은 저널(꺼진 저장)부터 되돌린다. 판정(prepare)이 반쯤 쓴 글을 읽지 않게(S-D7 · 검토 R-18)
    await recover(dir)
    let secs = g0.secs
    let held = g0.held
    let prep = null
    if (prepare) {
      prep = (await prepare()) || {}
      // 같은 저장(S-D16 · S-D48) — 아무것도 쓰지 않는다
      if (prep.abort) return { same: !!prep.abort.same, id: prep.abort.id ?? null }
      if (prep.sections != null) {
        const g = guardSections(sectionShape(prep.sections, { many: !system }), { system, structure, partial })
        if (input.record.memo === true && g.secs.length) fail('E_INPUT', '메모는 항목 글을 받지 않는다')
        secs = g.secs
        held = g.held
      }
      held = [...cleanHeld(prep.held), ...held]
    }
    return saveNow(dir, input.record, secs, { user: nfc(user), now, system, names, forms, mode, holdWhy, proposed: new Set((proposed || []).map((x) => nfc(String(x).trim()))), held, partial, marks: partial || !!intake, intake: !!intake, serverTags, correction, attach: input.attach || [], onCommit, prep })
  })
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
//   serverTags · heldPart — 입력 검사(예약 태그 거절) 뒤 저장 문이 붙이는 표지(옛 판의 받기 · S-D36): ['held'] 와 `## 넣지 못함` 칸 줄
export function saveRecords(dir, records, { user, now = new Date(), holdWhy = '받음: 이 지식의 이름 장부에서 맞는 이름을 찾지 못했다', serverTags = [], heldPart = null } = {}) {
  if (!user || !oneLine(user)) fail('E_INPUT', '누가 쓰는지 모른다')
  if (isReservedUser(user)) fail('E_FORBIDDEN', `「${user}」 는 kmd 가 쓰는 이름이다`)
  if (!Array.isArray(serverTags) || serverTags.some((t) => t !== 'held')) fail('E_INPUT', '받기에 저장 문이 붙이는 표지는 held 뿐이다')
  const heldRows = cleanHeld(heldPart)
  if (serverTags.includes('held') !== heldRows.length > 0) fail('E_INPUT', 'held 표지와 넣지 못함 칸은 같이 붙인다')
  const heldText = renderHeld(heldRows, { slim: true })
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
          const marked = serverTags.length ? { tags: [...(r.tags || []), ...serverTags], body: `${String(r.body).replace(/\s+$/, '')}\n\n${heldText}` } : {}
          const w = await writeRecord(dir, { ...r, ...marked, touches: g.touches, touchesEmpty: g.touchesEmpty }, { user: nfc(user), now, taken, j })
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
      await j.undo().catch((u) => console.error(`[save] 받기 되돌리기 실패 ${dir}: ${u?.message || u}`))
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
    const sec = text && findHeading(parseDoc(text, '').sections, loc.heading)
    if (!sec || sec.applied !== o.id) return false
  }
  if (String(r.body).length > 400) return false
  const ov = valuesOf(o.body + ' ' + o.title)
  return [...valuesOf(r.body)].every((v) => ov.has(v))
}

// 항목 지문 — 읽을 때 준 base 와 같은 계산(applied 표지는 뺀 글 · 항목이 없으면 빈 글)
export function sectionBase(text, heading) {
  const d = text == null ? null : parseDoc(text, '')
  const sec = d && findHeading(d.sections, heading)
  return sha16(sec ? sec.body : '')
}

async function saveNow(dir, r, secs, { user, now, system = false, names = [], forms: formsIn = [], mode = 'hold', holdWhy = null, proposed = new Set(), held: heldIn = [], partial = false, marks = false, intake = false, serverTags = [], correction = false, attach = [], onCommit = null, prep = null }) {
  const held = [...heldIn]
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

  // 항목 자리 먼저 — 하나라도 못 찾으면 아무것도 쓰지 않는다(partial 이면 그 항목만 넣지 못함 · S-D8)
  let plan = []
  for (const s of secs) {
    let p
    if (s.coord != null) {
      const coord = nfc(s.coord.trim())
      const loc = locate(registry, coord)
      if (!loc) {
        const why = `「${vocab.coords.get(coord)?.label || coord}」 이 들어갈 문서가 정해져 있지 않다. 기록만 보내거나 문서 · 머리로 가리킨다`
        if (!partial) fail('E_NOTFOUND', why)
        held.push(heldRow(s, 'notfound', why))
        continue
      }
      if (!touches.includes(coord)) touches.push(coord)
      p = { ...docPath(dir, loc.doc), level: loc.level, heading: loc.heading, content: s.content, base: s.base, ...(system && s.applied !== undefined ? { applied: s.applied } : {}) }
    } else {
      p = { ...docPath(dir, s.doc), level: 2, heading: nfc(s.heading.trim()), content: s.content ?? '', base: s.base, ...(s.remove ? { remove: true } : {}), ...(s.rename != null ? { rename: nfc(String(s.rename).trim()) } : {}), ...(system && s.applied !== undefined ? { applied: s.applied } : {}) }
    }
    if (system && Array.isArray(s.rough)) p.rough = s.rough.map(String)
    p.src = s
    plan.push(p)
  }
  // 넣지 못함 줄에 문서 · 머리를 채운다(이름으로 가리킨 항목)
  const heldOf = (p, code, why) => heldRow(p.src, code, why, { doc: p.rel, heading: p.heading })
  // 가드 G2 · G3 — 건드린 이름은 장부에 있는 것 · 이름 없는 기록은 까닭과 함께
  //   (항목 글로 가리킨 이름은 위에서 touches 에 들었다 · 문서 · 머리로 가리킨 항목은 이 기록의 자리다 — 넣지 못한 항목도 이 기록이 가리킨 자리다)
  //   저절로 채우는 표(guardSections) · prepare 가 넣지 못함으로 돌린 항목도 같다 — 모두 넣지 못함이어도 「이름 없는 기록」 이 아니다(S-D8 · S3 검토)
  const placed = secs.some((p) => !p.remove && p.rename == null) || held.some((x) => x.doc || x.coord)
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
      const sec = cur && findHeading(parseDoc(cur, '').sections, p.heading)
      const a = sec?.applied && parseRecord(await readRecordFile(dir, sec.applied), `${sec.applied}.md`)
      if (a && a.date > date) fail('E_CONFLICT', `「${p.heading}」 에는 더 늦은 기록(${a.date})이 이미 들어 있다. 옛 날짜로 고치지 않는다`)
    }
  }
  // 원본이 주인 — 문서 감시로 들어온 문서는 사람 · 세션이 고치지 못한다(원본 파일을 고친다 · 덧붙일 말은 기록으로)
  if (!system) {
    const keep = []
    for (const p of plan) {
      const w = watchedOf(await fs.readFile(p.full, 'utf8').catch(() => ''))
      if (w) {
        const why = `이 문서는 원본이 주인이다: ${w.src} 의 ${w.path} 를 고친다 · 덧붙일 말은 기록으로 남긴다`
        if (!partial) fail('E_FORBIDDEN', why, { need: 'source' })
        held.push(heldOf(p, 'watched', why))
        continue
      }
      keep.push(p)
    }
    plan = keep
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
    const keep = []
    for (const p of plan) {
      if (typeof p.content !== 'string' || p.remove || p.rename != null) {
        keep.push(p)
        continue
      }
      const cur = await fs.readFile(p.full, 'utf8').then(readText, () => null)
      const old = cur && findHeading(parseDoc(cur, '').sections, p.heading)
      const name = p.src.heading || p.src.coord || '항목'
      const r = formatCheck(p.content, { doc: p.rel, old: old ? old.body : null })
      if (r.problems.length) {
        if (!partial) fail('E_FORMAT', formatMessage(name, r.problems), { problems: r.problems })
        held.push(heldOf(p, 'format', formatMessage(name, r.problems)))
        continue
      }
      if (r.kept.length) formatKept.push(keptMessage(name, r.kept))
      keep.push(p)
    }
    plan = keep
  }
  // 넣은 것(S-D5 · S-D12) — 새 저장 문(partial · intake)만 기록 끝 칸으로 남긴다 · 값 바뀜은 옛 글 → 새 글(core/values.js valueDiff)
  const putRows = []
  if (marks) {
    for (const p of plan) {
      if (p.remove || p.rename != null || putRows.some((x) => x.doc === p.rel && x.heading === p.heading)) continue
      const cur = await fs.readFile(p.full, 'utf8').then(readText, () => null)
      const old = cur && findHeading(parseDoc(cur, '').sections, p.heading)
      const d = old ? valueDiff(old.body, p.content ?? '') : null
      putRows.push({ doc: p.rel, heading: p.heading, isNew: !old, ...(d || {}) })
    }
  }
  // 첨부(S-D30) — 같은 경로가 있으면 같은 글이면 건너뛰고 다르면 덮지 않는다(아무것도 쓰기 전에 본다)
  const atts = []
  const attSame = []
  for (const a of attach) {
    const p = assetPath(dir, a.path)
    const buf = Buffer.from(a.b64, 'base64')
    const twin = atts.find((x) => x.rel === p.rel)
    if (twin) {
      if (!twin.buf.equals(buf)) fail('E_INPUT', `같은 첨부 자리에 다른 글이 둘이다: ${p.rel}`)
      continue
    }
    const have = await fs.readFile(p.full).catch(() => null)
    if (have) {
      if (have.equals(buf)) {
        if (!attSame.includes(p.rel)) attSame.push(p.rel)
        continue
      }
      fail('E_CONFLICT', `같은 이름의 다른 첨부가 있다: ${p.rel}`)
    }
    atts.push({ ...p, buf })
  }

  await ensureRepo(dir)
  const day = date.slice(0, 10).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1-$2$3')
  const base = `${day}-${slugOf(r.title)}`
  // 이력(kmd 가 지식을 다룬 일)은 log/ · 그 밖은 기록(work/) — id 는 둘을 합쳐 겹치지 않게
  //   저장 문이 붙이는 표지(입력으로는 받지 않는다) — 들이기 태그 · memo · held · put
  const tags = [...(r.tags || []).map((t) => nfc(t.trim())), ...serverTags]
  if (r.memo === true) tags.push('memo')
  if (held.length) tags.push('held')
  if (putRows.length) tags.push('put')
  const allTags = [...new Set(tags)]
  const sub = isLogRecord(allTags) ? LOG_DIR : 'work'
  await fs.mkdir(path.join(dir, sub), { recursive: true })
  let id = base
  for (let n = 2; await recordTaken(dir, id); n++) id = `${base}-${n}`

  const rec = { id, title: nfc(r.title.trim()), date, author: user, touches, touchesEmpty, tags: allTags, fixes: (r.fixes || []).map((x) => nfc(x.trim())), curates: r.curates || [], reopens: r.reopens || [], reflects: r.reflects || [] }
  if (!system && !correction && (await isTouchesFix(dir, { ...rec, body: r.body }, touches, registry))) rec.tags.push('touches-fix')
  // 본문 끝 칸 — 넣은 것 · 넣지 못함(넘치면 넣지 못함의 content · edits 를 떼고 까닭만 · S-D45)
  let body = nfc(r.body)
  {
    const lead = body.replace(/\s+$/, '')
    const withParts = (slim) => [lead, renderPut(putRows), renderHeld(held, { slim })].filter(Boolean).join('\n\n')
    if (putRows.length || held.length) {
      body = withParts(false)
      if (body.length > MAX_BODY) body = withParts(true)
    }
  }
  const workRel = `${sub}/${id}.md`
  const workFull = path.join(dir, sub, `${id}.md`)
  // 중간에 넘어지거나 꺼지면 쓴 것을 되돌린다 — 반쯤 쓴 저장은 남기지 않는다(저널 · 꺼졌으면 다음 저장 · 켤 때)
  const j = await begin(dir)
  try {
    await j.add(workRel)
    await writeAtomic(workFull, renderRecord(rec, body))
    // 다시 읽어 대조(F1) — 쓴 머리가 보낸 값 그대로 읽혀야 한다
    const back = parseRecord(readText(await fs.readFile(workFull, 'utf8')), `${id}.md`)
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    if (!back || back.id !== id || back.title !== rec.title || back.date !== date || back.author !== user || !same(back.touches, touches) || !same(back.tags, rec.tags)) fail('E_INPUT', '기록 머리가 보낸 값과 다르게 읽힌다. 제목 · 이름 · 태그의 글자를 확인한다')
    const docs = []
    // 경과에 달 기록 — 정리 · 넣기는 넣은 기록들(reflects) · 사람의 기록은 그 자신. 원천이 쓰는 저장(kmd)은 달지 않는다
    const logged = []
    //   들이기 일감의 저장은 kmd 가 써도 단다(항목 「출처」 에 남게 · S-D43)
    for (const x of rec.reflects.length ? rec.reflects : sub === 'work' && (intake || (user !== 'kmd' && user !== 'kmd-auto')) ? [id] : []) {
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
      const old = findHeading(parseDoc(start, '').sections, p.heading)
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
    // 첨부 — 같은 저널 · 같은 커밋
    for (const a of atts) {
      await j.add(a.rel)
      await fs.mkdir(path.dirname(a.full), { recursive: true })
      await writeAtomic(a.full, a.buf)
    }
    let commit
    try {
      commit = await commitPaths(dir, [workRel, ...docs, ...books, ...atts.map((a) => a.rel)], rec.title, user)
    } catch (e) {
      // 커밋이 들어간 뒤 던졌으면(HEAD 가 움직였다) 되돌리지 않는다 — 성공한 저장을 실패로 만들지 않는다(S-D49)
      const head = await headSha(dir).catch(() => null)
      if (!head || head === j.head) throw e
      console.error(`[save] ${dir} 커밋 뒤 오류(커밋은 남겼다): ${e?.message || e}`)
      commit = head
    }
    await j.done()
    if (onCommit) {
      try {
        await onCommit()
      } catch (e) {
        console.error(`[save] ${dir} 커밋 뒤 할 일 실패: ${e?.message || e}`)
      }
    }
    const docLint = []
    for (const [rel, x] of shape) {
      if (x.after == null) continue
      const xs = lintNew(x.before, x.after)
      if (xs.length) docLint.push(lintMessage(rel.replace(/^docs\/|\.md$/g, ''), xs))
    }
    const marked = {
      ...(marks ? { put: putRows.length, putRows } : {}),
      ...(held.length ? { held: held.map(({ edits, content, ...x }) => x) } : {}),
      ...(r.memo === true ? { memo: true } : {}),
      ...(atts.length || attSame.length ? { attach: { put: atts.map((a) => a.rel), same: attSame } } : {}),
      ...(prep?.proposals ? { proposals: prep.proposals } : {}),
      ...(prep?.warnings?.length ? { warnings: prep.warnings } : {}),
    }
    return { id, record: workRel, docs, commit, date, ...(books.length ? { names: names.length } : {}), ...(formsIn.length ? { forms: formsIn.length } : {}), ...(formatKept.length ? { formatKept } : {}), ...(docLint.length ? { docLint } : {}), ...(guardWarn.length ? { guardWarn } : {}), ...(touchesEmpty ? { touchesEmpty } : {}), ...marked }
  } catch (e) {
    await j.undo().catch((u) => console.error(`[save] ${dir} 되돌리기 실패(다음 저장 · 켤 때 저널로 다시): ${u?.message || u}`))
    throw e
  }
}
