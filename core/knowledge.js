// 지식 하나 읽기 — md 폴더 하나가 지식 하나다.
//
//   docs/**.md    문서(항목 = ## 머리)
//   work/<id>.md  기록(머리에 id · title · date · author · touches) — 그 자체로 지식이 될 글
//   log/<id>.md   이력 — kmd 가 지식을 다룬 일(가져옴 · 가져오는 곳 · 바로 고침 · 정리) · 기록과 같은 모양
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
import { parseRegistry, locate } from './registry.js'
import { LOG_TAGS, isLogRecord } from './names.js'

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
      docs.push(await parsed(f, p, (text, st) => ({ id: docId, path: p, mtime: st.mtime.toISOString(), ...parseDoc(text, path.basename(docId)) })))
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
  const k = { id, name, dir, docs, works, logs, atts, vocab, registry }
  k.byDocPath = new Map(docs.map((d) => [d.path, d]))
  // byWork — 기록 · 이력 모두(항목 표지 · 판정 · 바로잡기가 이력의 id 를 가리킨다)
  k.byWork = new Map([...works, ...logs].map((w) => [w.id, w]))
  const all = [...works, ...logs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  // 정리 판정 — 날짜 순으로 「두기(keep)」 를 쌓고 「거두기(reopen)」 로 걷는다. 거둔 기록은 「주인이 되돌림」(다시 초안하지 않는다)
  k.kept = new Map()
  k.reverted = new Set()
  for (const w of all) {
    for (const c of w.curates) k.kept.set(c.id, { by: w.id, rule: c.rule, reason: c.reason })
    for (const id of w.reopens) {
      k.kept.delete(id)
      k.reverted.add(id)
    }
  }
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
    // 머리 → 항목 표 — 문서마다 한 번(정확히 같은 머리 먼저 · 「값 」 으로 시작하는 머리는 다음)
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

// 기록이 문서에 들어갔나 — 건드린 이름이 장부로 문서 항목에 닿고, 그 항목의 표지가
// 이 기록보다 앞선 기록(또는 없음)이면 아직 안 넣은 기록(pend)
// kmd 가 스스로 쓰는 기록(고친 기록 · 정리 · 가져오기)은 넣을 것이 아니다
export const SYSTEM_TAGS = LOG_TAGS
export const isSystemRecord = (w) => isLogRecord(w.tags)
const INGEST = (w) => w.tags.some((t) => /^(ingest|touches\??)\//.test(t))

// 상태 — in(문서에 들어감) · pend(아직 안 넣음) · kept(넣지 않기로 둠) · nowhere(넣을 곳이 없는 메모 — 이름이 없다) · none
export function recordState(k, w) {
  if (k.kept?.has(w.id)) return 'kept'
  if (w.tags.some((t) => t === 'curate-auto' || t === 'curate-llm')) return 'none' // 정리 기록 자신은 넣을 것이 아니다
  // 넣은 파일(ingest/)의 기록 — 정리가 기존 문서에 넣거나 새 문서로 세울 때까지 「아직 안 넣음」
  if (!w.touches.length && w.tags.some((t) => t.startsWith('ingest/'))) return k.reflected?.has(w.id) ? 'in' : 'pend'
  if (!w.touches.length) return isSystemRecord(w) || INGEST(w) || w.curates.length || w.reopens.length ? 'none' : 'nowhere'
  let any = false
  for (const c of w.touches) {
    const s = sectionOf(k, c)
    if (!s) continue
    any = true
    if (!s.sec || !s.sec.applied) return 'pend'
    if (s.sec.applied === w.id) continue
    const a = k.byWork.get(s.sec.applied)
    if (a?.reflects?.includes(w.id)) continue // 정리 기록이 이 기록을 넣었다고 적었다
    // 같은 분이면 순서를 모른다 — 넣었다고 적지 않은 한 아직 안 넣은 것으로(조용히 「넣음」 이 되지 않게)
    if (!a || a.date <= w.date) return 'pend'
  }
  return any ? 'in' : 'none'
}

// 보이는 이름 — 장부의 이름이 있으면 그것
export function labelOf(k, coord) {
  const v = k.vocab.coords.get(coord)
  return v ? v.label : coord.split(':').slice(1).join(':')
}

// 안 넣은 기록 — 최신 8 을 골라 날짜 순으로 · 넘친 수를 센다(I7 · 화면과 MCP 가 같은 계산)
export const PEND_MAX = 8
export function pendPick(recs) {
  const p = recs.filter((w) => w.state === 'pend').sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  return { pick: p.slice(0, PEND_MAX).reverse(), more: Math.max(0, p.length - PEND_MAX) }
}
