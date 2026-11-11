// 지식 하나 읽기 — md 폴더 하나가 지식 하나다.
//
//   docs/**.md    문서(항목 = ## 머리)
//   work/<id>.md  기록(머리에 id · title · date · author · touches) — 그 자체로 지식이 될 글
//   log/<id>.md   이력 — kmd 가 지식을 다룬 일(가져옴 · 가져올 곳 · 바로 고침 · 정리) · 기록과 같은 모양
//   _vocab.md     이름 장부 · _managed.md 자리 장부
//   그 밖          첨부(docs/assets · work/assets 의 파일) · 나머지는 보지 않는다
//
// 루트 폴더(`D:\kmd`) 안의 폴더 하나하나가 지식이다. 루트 자체가 지식 모양이면 그 하나만.

import fs from 'node:fs/promises'
import path from 'node:path'
import { readText, nfc } from './text.js'
import { parseRecord } from './frontmatter.js'
import { parseDoc, headingMatches } from './sections.js'
import { parseVocab } from './vocab.js'
import { formsOf } from './guard.js'
import { parseRegistry, locate } from './registry.js'
import { LOG_TAGS, isLogRecord } from './names.js'
import { parsePut, parseReverted, parseLinked, itemKey } from './parts.js'
import { watchedOf } from './watchmark.js'
import { parseOrder, ORDER_FILE } from './order.js'

const isDir = (p) => fs.stat(p).then((s) => s.isDirectory(), () => false)
const readOr = (p) => fs.readFile(p, 'utf8').then(readText, () => null)

export async function looksLikeKnowledge(dir) {
  for (const n of ['docs', 'work']) if (await isDir(path.join(dir, n))) return true
  for (const n of ['_vocab.md', '_managed.md']) if ((await readOr(path.join(dir, n))) != null) return true
  return false
}

// 루트 → [{ id, name, dir }] · id 는 주소에 쓰는 폴더 이름
export async function listKnowledge(root) {
  if (await looksLikeKnowledge(root)) return [{ id: nfc(path.basename(root)), name: await nameOf(root), dir: root }]
  const ents = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const out = []
  for (const e of ents) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
    const dir = path.join(root, e.name)
    if (await looksLikeKnowledge(dir)) out.push({ id: nfc(e.name), name: await nameOf(dir), dir })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id, 'ko'))
}

// 보이는 이름 — 문서 README 첫 머리가 있으면 그것, 없으면 폴더 이름
async function nameOf(dir) {
  const t = await readOr(path.join(dir, 'README.md'))
  const m = t && t.match(/^#\s+(.+)$/m)
  return nfc(m ? m[1].trim() : path.basename(dir))
}

async function walk(dir, rel, out) {
  const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of ents) {
    if (e.name.startsWith('.')) continue
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) await walk(path.join(dir, e.name), r, out)
    else out.push(r)
  }
  return out
}

const stripTitle = (body, title) => body.replace(/^#\s+(.+)\n+/, (all, h) => (h.trim() === title ? '' : all))

// 읽은 파일 수 — 시험이 「둘째 요청은 바뀐 파일만 읽는다」 를 센다(F12)
export const readStats = { files: 0 }

// cache — 지식마다 하나 { 경로 → { mtimeMs, size, value } }. 저장 뒤에는 바뀐 파일만 다시 읽는다
export async function loadKnowledge({ id, name, dir }, { cache = null } = {}) {
  const files = await walk(dir, '', [])
  const docs = []
  const works = []
  const logs = []
  const atts = []
  const seen = new Set()
  const parsed = async (f, p, parse) => {
    const full = path.join(dir, f)
    const st = await fs.stat(full)
    const hit = cache?.get(p)
    seen.add(p)
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.value
    readStats.files++
    const value = parse(await readOr(full), st)
    cache?.set(p, { mtimeMs: st.mtimeMs, size: st.size, value })
    return value
  }
  for (const f of files) {
    const p = nfc(f)
    if (/^(docs|work)\/assets\//i.test(p)) {
      atts.push(p)
      continue
    }
    if (/^docs\/.+\.md$/i.test(p)) {
      const docId = p.slice(5, -3)
      // rec — 문서 감시가 들인 사본의 앞 기록(표지의 rec · 문서 전체가 그 기록에서 왔다)
      docs.push(await parsed(f, p, (text, st) => ({ id: docId, path: p, mtime: st.mtime.toISOString(), ...parseDoc(text, path.basename(docId)), rec: watchedOf(text)?.rec || null, watched: !!watchedOf(text) })))
    } else if (/^(work|log)\/[^/]+\.md$/i.test(p)) {
      const r = await parsed(f, p, (text) => {
        const x = parseRecord(text, path.basename(p))
        return x ? { ...x, path: p, body: stripTitle(x.body, x.title) } : null
      })
      // 이력 — log/ 의 것과 예전에 work/ 에 쓴 kmd 의 일(태그로 가른다)
      if (r) (p.startsWith('log/') || isLogRecord(r.tags) ? logs : works).push({ ...r })
    }
  }
  if (cache) for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k)
  docs.sort((a, b) => b.mtime.localeCompare(a.mtime) || a.id.localeCompare(b.id, 'ko'))
  works.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  logs.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  const vocab = parseVocab(await readOr(path.join(dir, '_vocab.md')))
  const registry = parseRegistry(await readOr(path.join(dir, '_managed.md')))
  // 갈래 장부 — 새 문서가 설 수 있는 갈래(없으면 기본 갈래 · core/guard.js)
  const forms = formsOf(await readOr(path.join(dir, '_forms.md')))
  // 차례 장부 — 옆 메뉴 나무 · 문서 짜임의 차례 · 문서가 없는 폴더(core/order.js)
  const order = parseOrder(await readOr(path.join(dir, ORDER_FILE)))
  // README 본문(첫 # 제목 줄 뒤) — 지식 홈 「먼저 읽을 것」 카드(UX T5-09)
  const readme = String((await readOr(path.join(dir, 'README.md'))) || '').replace(/^\s*#\s+.*\n?/, '').trim().slice(0, 6000)
  // 기본 갈래(갈래 장부가 없는 지식)가 같은 이름의 문서와 부딪치면 — 그 문서 머리가 사건 꼴(날짜 머리)이 아닐 때 그 기본 갈래는 쓰지 않는다
  //   (「장애 대응」 갈래가 절차 문서 「장애대응」 에 사건 기록을 넣으라고 하지 않게 · UX T2-14)
  if (!forms.own) {
    const sq = (x) => String(x).replace(/\s+/g, '')
    forms.rows = forms.rows.filter((f) => { const d = docs.find((x) => sq(x.title) === sq(f.name)); return !d || !(d.sections || []).length || (d.sections || []).some((x) => /^\d{4}-\d{2}-\d{2}/.test(x.h)) })
  }
  const k = { id, name, dir, docs, works, logs, atts, vocab, registry, forms, order, readme }
  k.byDocPath = new Map(docs.map((d) => [d.path, d]))
  // byWork — 기록 · 이력 모두(항목 표지 · 판정 · 바로잡기가 이력의 id 를 가리킨다)
  k.byWork = new Map([...works, ...logs].map((w) => [w.id, w]))
  const all = [...works, ...logs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  // 통째로 되돌린 기록(reopens)
  k.reverted = new Set()
  for (const w of all) for (const id of w.reopens) k.reverted.add(id)
  // 좌표정정 — 이름만 바로잡은 기록(touches-fix)이 있으면 원 기록의 이름을 그것으로 읽는다(늦은 것이 이긴다 · ownTouches 에 원래 이름)
  for (const w of all) {
    if (!w.tags.includes('touches-fix') || w.fixes.length !== 1) continue
    const o = k.byWork.get(w.fixes[0])
    if (o) {
      o.ownTouches ||= o.touches
      o.touches = w.touches
    }
  }
  // 정리가 넣었다고 적은 기록(reflects) — 이름 없이 들어간 넣은 파일의 기록도 「넣음」 이 된다
  k.reflected = new Set([...works, ...logs].flatMap((w) => w.reflects || []))
  // 바로잡힘(S-D46) — 나중 기록이 fixes 로 가리킨 기록. 이름만 바로잡은 것(touches-fix)은 바로잡힘이 아니다(누가 fixes 를 실을 수 있는지는 쓸 때 막는다 · S-D17)
  //   저장 승인 전 기록의 fixes(옛 넣지 못함 다시 하기 · 이행 기록 migrate-held)도 바로잡힘으로 읽지 않는다 — 그 기록들은 「기록」 으로만 보인다(P12)
  k.superseded = new Set()
  for (const w of all) {
    if (!w.fixes?.length || w.tags.some((t) => t === 'held' || t === 'migrate-held' || t === 'touches-fix')) continue
    for (const x of w.fixes) k.superseded.add(x)
  }
  // 항목마다 되돌림(S-D13) — revert 태그 기록의 마지막 「## 되돌린 항목」 칸 · 원 기록 id → 「문서 › 머리」 모음
  k.revertedItems = new Map()
  for (const w of all) {
    if (!w.tags.includes('revert')) continue
    for (const r of parseReverted(w.body)) {
      if (!k.revertedItems.has(r.rec)) k.revertedItems.set(r.rec, new Set())
      k.revertedItems.get(r.rec).add(itemKey(r.doc, r.heading))
    }
  }
  for (const w of works) w.state = recordState(k, w)
  return k
}

// 이름 → 문서 · 항목(있으면)
const secCache = new WeakMap()
export function sectionOf(k, coord) {
  let m = secCache.get(k)
  if (!m) secCache.set(k, (m = new Map()))
  if (m.has(coord)) return m.get(coord)
  const loc = locate(k.registry, coord)
  let out = null
  if (loc) {
    const doc = k.byDocPath.get(loc.doc) || null
    // 머리 → 항목 표 — 문서마다 한 번(정확히 같은 머리 먼저 · 「값:」 · 「값 」 으로 시작하는 머리는 다음)
    let heads = doc && headIndex.get(doc)
    if (doc && !heads) headIndex.set(doc, (heads = new Map(doc.sections.map((s) => [s.h.normalize('NFC'), s]).reverse())))
    const want = loc.heading.normalize('NFC')
    const sec = doc ? heads.get(want) || doc.sections.find((s) => headingMatches(s.h, want)) || null : null
    out = { loc, doc, sec }
  }
  m.set(coord, out)
  return out
}
const headIndex = new WeakMap()

// 항목 하나에 드는 이름들(장부로 거꾸로)
// 지식마다 한 번 — 「문서 경로 \n 항목 머리」 → 그 항목에 드는 이름들
const sectionMaps = new WeakMap()
function sectionMap(k) {
  let m = sectionMaps.get(k)
  if (m) return m
  m = new Map()
  const names = new Set([...k.vocab.coords.keys()])
  for (const w of k.works) for (const c of w.touches) names.add(c)
  for (const c of [...names].sort()) {
    const x = sectionOf(k, c)
    const doc = x?.doc
    const sec = x?.sec
    if (!sec) continue
    const key = `${doc.path}\n${sec.h}`
    if (!m.has(key)) m.set(key, [])
    m.get(key).push(c)
  }
  sectionMaps.set(k, m)
  return m
}
export function coordsOfSection(k, doc, h) {
  return sectionMap(k).get(`${doc.path}\n${h}`) || []
}

// kmd 가 스스로 쓰는 기록(고친 기록 · 정리 · 가져오기)은 넣을 것이 아니다
export const SYSTEM_TAGS = LOG_TAGS
export const isSystemRecord = (w) => isLogRecord(w.tags)
const INGEST = (w) => w.tags.some((t) => /^(ingest|touches\??)\//.test(t))

// 상태 — in(문서에 들어감) · fixed(바로잡힘) · reverted(되돌림) · none(kmd 가 한 일) · old(저장 승인 전에 남은 기록 · 읽기만 · 옛 상태를 가르지 않는다)
// 이 지식에 들어온 때 — 받은 기록은 recv/YYYYMMDDHHMM 태그(hub.receive) · 아니면 쓴 때
export function arrivedOf(w) {
  const t = w.tags.find((x) => /^recv\/\d{12}$/.test(x))
  return t ? t.slice(5).replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5') : w.date
}
// 이 항목에 그 기록이 들었나 — 항목 표지가 그 기록이거나 · 표지의 정리 기록이 넣었다고 적었거나 · 더 늦은 기록이 들었다.
export function reflectedIn(k, w, sec) {
  if (!sec?.applied) return false
  if (sec.applied === w.id) return true
  const a = k.byWork.get(sec.applied)
  if (a?.reflects?.includes(w.id)) return true // 정리 기록이 이 기록을 넣었다고 적었다
  // 같은 분이면 순서를 모른다 — 넣었다고 적지 않은 한 아직 안 넣은 것으로(조용히 「넣음」 이 되지 않게) ·
  //   받은 기록은 쓴 때가 아니라 받은 때로 본다(옛 날짜로 늦게 받은 기록이 그 전 정리로 「넣음」 이 되지 않게)
  return !!a && a.date > arrivedOf(w)
}

// 상태 — 저장 문이 넣은 기록(put)은 들어감 · 항목마다 모두 되돌렸으면 되돌림 · 나중 정정 기록이 바로잡았으면 바로잡힘.
//   저장 승인 전 기록(옛 넣지 못함 · 메모 · 아직 안 넣음 · 둠 · 이행된 기록)은 상태를 가르지 않고 old 하나(P12)
export function recordState(k, w) {
  const tags = w.tags || []
  if (tags.some((t) => t === 'curate-auto' || t === 'curate-llm' || t === 'touches-fix')) return 'none'
  if (k.reverted?.has(w.id)) return 'reverted'
  if (tags.some((t) => t === 'held' || t === 'memo')) return 'old' // 옛 표지(넣지 못함 · 메모) — 값이 확정이 아니었다: 늘 「기록」
  const sup = !!k.superseded?.has(w.id)
  if (tags.includes('put')) {
    const items = parsePut(w.body)
    const back = k.revertedItems?.get(w.id)
    if (items.length && back && items.every((x) => back.has(itemKey(x.doc, x.heading)))) return 'reverted'
    return sup ? 'fixed' : 'in' // 넣은 뒤 정정 기록이 바로잡았으면 바로잡힘(UX T2-03 · 정함 안 A)
  }
  // 저장 문 밖에서 들어간 기록(문서 표지 · 정리 기록의 reflects — 지식 추가로 들여온 문서 · 옛 정리) — 들어감 · 아니면 old
  const st = reflectedState(k, w)
  return sup && st !== 'none' ? 'fixed' : st
}

function reflectedState(k, w) {
  if (!w.touches.length) {
    if (k.reflected?.has(w.id)) return 'in'
    if (w.tags.some((t) => t.startsWith('ingest/'))) return 'old' // 넣은 파일의 옛 기록(정리가 넣지 않았다)
    return isSystemRecord(w) || INGEST(w) || w.curates.length || w.reopens.length ? 'none' : 'old'
  }
  let any = false
  for (const c of w.touches) {
    const x = sectionOf(k, c)
    if (!x) continue
    any = true
    if (!reflectedIn(k, w, x.sec)) return 'old'
  }
  if (!any && w.tags.includes('code-change')) return k.reflected?.has(w.id) ? 'in' : 'old'
  return any ? 'in' : 'none'
}

// 보이는 이름 — 장부의 이름이 있으면 그것
export function labelOf(k, coord) {
  const v = k.vocab.coords.get(coord)
  return v ? v.label : coord.split(':').slice(1).join(':')
}

// 항목 이력(저장 승인 설계 P-D12 · section.history · P2) — 그 항목에 이어진 기록 하나 줄: 그 항목의 이름을 건드렸거나 ·
//   그 항목의 표지 기록이거나 · 저장 문이 그 항목에 넣었다고 적은(넣은 것 칸) 기록. 새것부터 · max 까지 + 넘친 수
export const HISTORY_MAX = 20
export function sectionHistory(k, doc, h, { max = HISTORY_MAX } = {}) {
  const coords = new Set(coordsOfSection(k, doc, h))
  const sec = doc.sections.find((s) => s.h === h) || null
  const hit = (w) => w.touches.some((c) => coords.has(c)) || (sec?.applied && sec.applied === w.id) || ((w.tags || []).includes('put') && [...parsePut(w.body), ...parseLinked(w.body)].some((x) => x.doc === doc.path && headingMatches(x.heading || '', h)))
  const all = k.works.filter(hit).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  return { items: all.slice(0, max), more: Math.max(0, all.length - max) }
}
