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
import { LOG_TAGS, isLogRecord, isReservedUser } from './names.js'
import { parsePut, parseReverted, itemKey } from './parts.js'
import { watchedOf } from './watchmark.js'

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
// cutoverAt — 개편(저장이 곧 반영)을 켠 때(설정 · 「YYYY-MM-DD HH:MM」). 개편 전 기록(isLegacy)을 가른다
// team — 팀 서버가 읽는 지식(넣을 곳 고르기 기록 touches-fix 는 넣을 기록이 아니다: recordState)
export async function loadKnowledge({ id, name, dir }, { cache = null, cutoverAt = null, team = false } = {}) {
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
      docs.push(await parsed(f, p, (text, st) => ({ id: docId, path: p, mtime: st.mtime.toISOString(), ...parseDoc(text, path.basename(docId)), rec: watchedOf(text)?.rec || null })))
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
  const k = { id, name, dir, docs, works, logs, atts, vocab, registry, forms }
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
  // 바로잡힘(S-D46) — 나중 기록이 fixes 로 가리킨 기록. 그 기록이 넣지 못함(held)이거나 이름만 바로잡은 것(touches-fix)이면 바로잡힘이 아니다
  //   (누가 fixes 를 실을 수 있는지는 쓸 때 막는다 · S-D17) · handedOff — 들이기 기록이 fixes 로 가리킨 기록(held 여도 일을 넘겨받았다)
  k.superseded = new Set()
  k.handedOff = new Set()
  for (const w of all) {
    if (!w.fixes?.length) continue
    if (w.tags.includes('intake')) for (const x of w.fixes) k.handedOff.add(x)
    if (w.tags.includes('held') || w.tags.includes('touches-fix')) continue
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
  // 개편 전 기록을 가르는 때(S-D46) — 설정 cutoverAt(없으면 모든 pend · nowhere 가 개편 전)
  k.cutoverAt = cutoverAt || null
  k.team = !!team
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

// 기록이 문서에 들어갔나 — 건드린 이름이 장부로 문서 항목에 닿고, 그 항목의 표지가
// 이 기록보다 앞선 기록(또는 없음)이면 아직 안 넣은 기록(pend)
// kmd 가 스스로 쓰는 기록(고친 기록 · 정리 · 가져오기)은 넣을 것이 아니다
export const SYSTEM_TAGS = LOG_TAGS
export const isSystemRecord = (w) => isLogRecord(w.tags)
const INGEST = (w) => w.tags.some((t) => /^(ingest|touches\??)\//.test(t))

// 상태 — in(문서에 들어감) · pend(아직 안 넣음) · kept(넣지 않기로 둠) · nowhere(넣을 곳이 없는 메모 — 이름이 없다) · none
// 이 지식에 들어온 때 — 받은 기록은 recv/YYYYMMDDHHMM 태그(hub.receive) · 아니면 쓴 때
export function arrivedOf(w) {
  const t = w.tags.find((x) => /^recv\/\d{12}$/.test(x))
  return t ? t.slice(5).replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5') : w.date
}
// 이 항목에 그 기록이 들었나 — 항목 표지가 그 기록이거나 · 표지의 정리 기록이 넣었다고 적었거나 · 더 늦은 기록이 들었다.
//   개인 프로그램의 바로 넣기 재료(core/pcplace.js material)도 같은 판정으로 이미 든 항목을 건너뛴다(여러 항목에 걸린 기록이 한 항목 때문에 다 다시 정리되지 않게)
export function reflectedIn(k, w, sec) {
  if (!sec?.applied) return false
  if (sec.applied === w.id) return true
  const a = k.byWork.get(sec.applied)
  if (a?.reflects?.includes(w.id)) return true // 정리 기록이 이 기록을 넣었다고 적었다
  // 같은 분이면 순서를 모른다 — 넣었다고 적지 않은 한 아직 안 넣은 것으로(조용히 「넣음」 이 되지 않게) ·
  //   받은 기록은 쓴 때가 아니라 받은 때로 본다(옛 날짜로 늦게 받은 기록이 그 전 정리로 「넣음」 이 되지 않게)
  return !!a && a.date > arrivedOf(w)
}

// 상태(설계 S-D4 의 차례) — 새 표지(held · memo · put)를 지금 갈래(touches 를 도는 것)보다 먼저 본다.
//   그래야 넣지 못함 · 메모가 「아직 안 넣음」 으로 보이지 않고, put 기록은 그 뒤 누가 같은 항목을 고쳐도 「들어감」 이 흔들리지 않는다.
//   held · memo · 개편 전 pend · nowhere 를 나중 기록이 fixes 로 바로잡았으면 fixed(바로잡힘)
//   ⑥ 통째로 되돌린 기록(k.reverted · reopens)은 저장 문 기록이든 옛 기록이든 되돌림(S5) — 다시 대기(pend)로 떨어져
//   「개편 전 기록」 이 되거나 다음 정리 · 다시 들이기가 되돌린 값을 다시 넣지 않게
export function recordState(k, w) {
  const tags = w.tags || []
  const sup = !!k.superseded?.has(w.id)
  if (tags.includes('held') && sup) return 'fixed' // ① R-A3 의 kept 보다 먼저
  if (k.kept?.has(w.id)) return 'kept' // ②
  if (tags.some((t) => t === 'curate-auto' || t === 'curate-llm')) return 'none' // ③ 정리 기록 자신은 넣을 것이 아니다
  if (tags.includes('memo')) return sup ? 'fixed' : 'memo' // ④
  if (tags.includes('held')) return 'held' // ⑤
  // ⑤' 팀의 넣을 곳 고르기(setTouches · touches-fix)는 원 기록의 이름만 바로잡은 구조 기록(메모 · 넣지 못함이 아니면) — 그 자신은 pend · in 이 아니다
  //    (개인 프로그램은 R-A2 가 이 기록을 pend 로 보고 keep 한다)
  if (k.team && tags.includes('touches-fix')) return 'none'
  if (k.reverted?.has(w.id)) return 'reverted' // ⑥
  // ⑦ 저장 문이 넣은 항목을 적은 기록 — 그 항목이 모두 항목마다 되돌려졌으면 되돌림, 아니면 들어감
  if (tags.includes('put')) {
    const items = parsePut(w.body)
    const back = k.revertedItems?.get(w.id)
    return items.length && back && items.every((x) => back.has(itemKey(x.doc, x.heading))) ? 'reverted' : 'in'
  }
  const s = stateOld(k, w) // ⑧
  return sup && (s === 'pend' || s === 'nowhere') ? 'fixed' : s
}

// 개편 전 기록(S-D46) — 아직 안 넣은(pend · nowhere) 사람 기록 가운데 들이기가 넘겨받지 않았고 cutoverAt 앞에 들어온 것
//   (상태가 아니라 시각으로 가른다 · cutoverAt 이 없으면 모두 · 팀 지식에서만 뜻이 있다: 부르는 쪽이 가린다)
export function isLegacy(k, w) {
  if (w.state !== 'pend' && w.state !== 'nowhere') return false
  if (isReservedUser(w.author) || k.handedOff?.has(w.id)) return false
  // 넣을 곳 고르기(touches-fix · S-D42)는 원 기록의 이름만 바로잡은 것 — 그 자신은 넣을 기록이 아니다(S10)
  if ((w.tags || []).includes('touches-fix')) return false
  return !k.cutoverAt || arrivedOf(w) < k.cutoverAt
}

function stateOld(k, w) {
  // 넣은 파일(ingest/)의 기록 — 정리가 기존 문서에 넣거나 새 문서로 세울 때까지 「아직 안 넣음」
  if (!w.touches.length && w.tags.some((t) => t.startsWith('ingest/'))) return k.reflected?.has(w.id) ? 'in' : 'pend'
  // 이름 없는 기록도 정리 · 바로 넣기가 문서로 들였으면(reflects) 「넣음」
  if (!w.touches.length && k.reflected?.has(w.id)) return 'in'
  if (!w.touches.length) return isSystemRecord(w) || INGEST(w) || w.curates.length || w.reopens.length ? 'none' : 'nowhere'
  let any = false
  for (const c of w.touches) {
    const s = sectionOf(k, c)
    if (!s) continue
    any = true
    if (!reflectedIn(k, w, s.sec)) return 'pend'
  }
  // 코드 바뀜 — 걸린 이름이 어느 항목에도 닿지 않으면(장부 밖 이름만 걸렸다) 넣을 곳을 찾는 기록이다(Claude Code 가 기능 문서에 넣는다)
  if (!any && w.tags.includes('code-change')) return k.reflected?.has(w.id) ? 'in' : 'nowhere'
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
