// 지식 하나 읽기 — md 폴더 하나가 지식 하나다.
//
//   docs/**.md    문서(항목 = ## 머리)
//   work/<id>.md  기록(머리에 id · title · date · author · touches)
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
    } else if (/^work\/[^/]+\.md$/i.test(p)) {
      const r = await parsed(f, p, (text) => {
        const x = parseRecord(text, path.basename(p))
        return x ? { ...x, path: p, body: stripTitle(x.body, x.title) } : null
      })
      if (r) works.push({ ...r })
    }
  }
  if (cache) for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k)
  docs.sort((a, b) => b.mtime.localeCompare(a.mtime) || a.id.localeCompare(b.id, 'ko'))
  works.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  const vocab = parseVocab(await readOr(path.join(dir, '_vocab.md')))
  const registry = parseRegistry(await readOr(path.join(dir, '_managed.md')))
  const k = { id, name, dir, docs, works, atts, vocab, registry }
  k.byDocPath = new Map(docs.map((d) => [d.path, d]))
  k.byWork = new Map(works.map((w) => [w.id, w]))
  for (const w of works) w.state = recordState(k, w)
  return k
}

// 이름 → 문서 · 항목(있으면)
export function sectionOf(k, coord) {
  const loc = locate(k.registry, coord)
  if (!loc) return null
  const doc = k.byDocPath.get(loc.doc) || null
  const sec = doc ? doc.sections.find((s) => headingMatches(s.h, loc.heading)) || null : null
  return { loc, doc, sec }
}

// 항목 하나에 드는 이름들(장부로 거꾸로)
export function coordsOfSection(k, doc, h) {
  const out = []
  const names = new Set([...k.vocab.coords.keys()])
  for (const w of k.works) for (const c of w.touches) names.add(c)
  for (const c of names) {
    const loc = locate(k.registry, c)
    if (loc && loc.doc === doc.path && headingMatches(h, loc.heading)) out.push(c)
  }
  return out
}

// 기록이 문서에 들어갔나 — 건드린 이름이 장부로 문서 항목에 닿고, 그 항목의 표지가
// 이 기록보다 앞선 기록(또는 없음)이면 아직 안 넣은 기록(pend)
export function recordState(k, w) {
  let any = false
  for (const c of w.touches) {
    const s = sectionOf(k, c)
    if (!s) continue
    any = true
    if (!s.sec || !s.sec.applied) return 'pend'
    if (s.sec.applied === w.id) continue
    const a = k.byWork.get(s.sec.applied)
    if (!a || a.date < w.date || (a.date === w.date && a.id < w.id)) return 'pend'
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
