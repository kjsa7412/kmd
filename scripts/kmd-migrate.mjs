// 지식 옮겨 쓰기(다시 그리기) 도구 — 세션 스킬 kmd-migrate(.claude/skills/kmd-migrate)가 부른다.
//   지식 폴더(git)를 손에 쥔 사람이 세션에서 「기록으로 항목을 다시 그리기」 를 할 때, 서비스의 기준(저장 검사 · 값 대조 · 참고 블록 · 기록)을 그대로 지나게 한다.
//   기능(화면 · 길)이 아니다. 서버를 거치지 않고 core 의 저장(core/save.js)과 검사(core/gate.js)를 지식 폴더에 바로 건다.
//
//   node scripts/kmd-migrate.mjs scan  <지식 폴더> [--doc docs/x.md] [--json]          진단: 문서마다 항목 · 기록 없는 항목 · 큰 항목 · 날짜 줄 · 같은 글 · 다시 그릴 만한 항목 · 사건 갈래 문서에 빠진 기록
//   node scripts/kmd-migrate.mjs rec   <지식 폴더> <기록 id> [--json]                         기록 하나: 머리 · 상태 · 이름 · 넣은 곳 · 본문
//   node scripts/kmd-migrate.mjs trail <지식 폴더> <docs/x.md> <머리> [--json] [--full]  항목 하나: 지금 글 · base · 이어진 기록(오래된 순 · 표시) · 넣은 줄
//   node scripts/kmd-migrate.mjs check <지식 폴더> <input.json>                          마른 검사: 쓰지 않는다 · 값 대조 · 꼴 · 사라지는 표 행 · 문장
//   node scripts/kmd-migrate.mjs put   <지식 폴더> <input.json> --user <사람> [--allow-drop]  넣기: 줄 안에서 다시 검사 → 기록 + 항목 + git 커밋 한 묶음
//
//   input.json = { record: { title, body, touches?, tags? }, sections: [{ doc, heading, base, content | contentFile }] }
//     빠진 항목 채우기: sections[] 에 base 대신 new: true · sources: [재료 기록 id](있는 문서의 없는 머리 · 사건 갈래면 「YYYY-MM-DD 무엇」)
//     record.body 는 기록 서식(docs/템플릿/기록.md): 「## 바뀐 것」 에 이 항목의 「옛 값 → 새 값」 · 뺀 값은 「옛 값 → (뺌)」 · 까닭 · 근거
//   공통: --cutover "YYYY-MM-DD HH:MM"(개편 때 · 없으면 <지식 폴더>/../.kmd/cutover.json)
//
//   put 은 사라지는 표 행 · 문장이 있으면 넣지 않는다. 사람이 본 뒤 --allow-drop 으로만 넘는다. 값(gate)이 걸리면 늘 넣지 않는다(held 를 남기지 않는다).
//   팀 서버가 돌고 있는 폴더에 바로 쓰면 서버 캐시가 낡는다 — 사본에서 쓰고 백업 자리로 올린 뒤 「백업에서 받기」 를 쓴다(스킬 3절).

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadKnowledge, coordsOfSection } from '../core/knowledge.js'
import { checkSection } from '../core/gate.js'
import { save } from '../core/save.js'
import { parsePut, itemKey } from '../core/parts.js'
import { parseRefLine } from '../core/sections.js'
import { sha16 } from '../core/text.js'

const DERIVED = ['polish', 'curate-llm', 'curate-auto', 'rebuild', 'intake']
const DATE_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*)?(\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{1,2}\/\d{1,2}|\d{1,2}월 \d{1,2}일)/
const isTable = (l) => /^\s*\|/.test(l)

function args(argv) {
  const pos = []
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (['json', 'full', 'allow-drop'].includes(key)) o[key] = true
      else o[key] = argv[++i]
    } else pos.push(a)
  }
  return { pos, o }
}

async function cutoverOf(dir, o) {
  if (o.cutover) return o.cutover
  try {
    const j = JSON.parse(await fs.readFile(path.join(dir, '..', '.kmd', 'cutover.json'), 'utf8'))
    return j.cutoverAt || j.at || null
  } catch {
    return null
  }
}

async function load(dir, o) {
  const abs = path.resolve(dir)
  try {
    await fs.access(path.join(abs, 'docs'))
  } catch {
    throw new Error(`지식 폴더가 아니다(docs/ 가 없다): ${abs}`)
  }
  return loadKnowledge({ id: path.basename(abs), name: path.basename(abs), dir: abs }, { cutoverAt: await cutoverOf(abs, o), team: true })
}

// 참고 줄 href → 기록 id
const idOfHref = (href) => {
  const m = String(href || '').match(/\/([^/]+)\.md$/)
  if (!m) return null
  try {
    return decodeURI(m[1]).replace(/%28/g, '(').replace(/%29/g, ')')
  } catch {
    return m[1]
  }
}

// 항목 하나에 이어진 기록 — 이름(touches → 장부) · 넣은 것 줄 · 항목 표지 · 참고 줄 · 문서 단위 참고 줄
export function linksOf(k, doc, sec) {
  const ids = new Map()
  const add = (id, how) => {
    if (!id || !k.byWork.has(id)) return
    if (!ids.has(id)) ids.set(id, new Set())
    ids.get(id).add(how)
  }
  const coords = new Set(coordsOfSection(k, doc, sec.h))
  const key = itemKey(doc.path, sec.h)
  for (const w of [...k.works, ...k.logs]) {
    if (w.touches?.some((c) => coords.has(c))) add(w.id, 'name')
    if (parsePut(w.body).some((r) => r.doc === doc.path && r.heading === sec.h)) add(w.id, 'put')
  }
  if (sec.applied) add(sec.applied, 'applied')
  for (const l of sec.log || []) {
    const r = parseRefLine(l)
    if (r.kind === 'rec') add(idOfHref(r.href), 'ref')
  }
  for (const l of doc.docLog || []) {
    const r = parseRefLine(l)
    if (r.kind === 'rec') add(idOfHref(r.href), 'doc')
  }
  const out = []
  for (const [id, how] of ids) {
    const w = k.byWork.get(id)
    if (k.superseded.has(id) || k.reverted.has(id) || k.kept.has(id) || k.revertedItems.get(id)?.has(key)) continue
    const mark = []
    if (w.state === 'held' || w.tags.includes('held')) mark.push('held')
    if (w.state === 'memo' || w.tags.includes('memo')) mark.push('memo')
    if (w.state === 'pend' && coords.size) mark.push('pend')
    if (w.tags.some((t) => DERIVED.includes(t))) mark.push('derived')
    const scope = how.size === 1 && how.has('doc') ? 'doc' : 'item'
    out.push({ id, kind: k.logs.includes(w) ? 'log' : 'work', date: w.date, title: w.title, author: w.author || null, state: w.state || null, tags: w.tags, how: [...how], scope, mark, put: parsePut(w.body).filter((r) => r.doc === doc.path && r.heading === sec.h).map((r) => ({ from: r.from, to: r.to, isNew: r.isNew })), body: w.body })
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  return out
}
// 재료가 되는 기록 — 넣지 못함 · 메모는 빼고, 문서 단위 줄만 있는 기록은 셈에서 뺀다
const sourceOf = (links) => links.filter((x) => !x.mark.includes('held') && !x.mark.includes('memo') && x.scope === 'item')

const proseLines = (body) => {
  const out = []
  let fence = false
  for (const raw of String(body).split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence
      continue
    }
    if (fence || isTable(raw) || /^\s*(#|>)/.test(raw)) continue
    const t = raw.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').replace(/\s+/g, ' ').trim()
    if (t) out.push(t)
  }
  return out
}

async function scan(dir, o) {
  const k = await load(dir, o)
  const docs = k.docs.filter((d) => !o.doc || d.path === o.doc).sort((a, b) => a.path.localeCompare(b.path, 'ko'))
  const items = []
  const lineAt = new Map()
  const linked = new Set()
  for (const d of docs) {
    for (const s of d.sections) {
      const links = linksOf(k, d, s)
      for (const x of links) linked.add(x.id)
      const src = sourceOf(links)
      const lines = s.body.split('\n').filter((l) => l.trim())
      const diary = lines.filter((l) => !isTable(l) && DATE_LINE.test(l)).length
      for (const t of proseLines(s.body).filter((t) => t.length >= 40)) {
        if (!lineAt.has(t)) lineAt.set(t, new Set())
        lineAt.get(t).add(itemKey(d.path, s.h))
      }
      items.push({ doc: d.path, heading: s.h, lines: lines.length, chars: s.body.length, links: src.length, derived: src.filter((x) => x.mark.includes('derived')).length, pend: links.filter((x) => x.mark.includes('pend')).length, diary })
    }
  }
  const all = items.length
  const boilerAt = Math.max(20, Math.ceil(all * 0.05))
  const dupItems = new Set()
  const boiler = []
  for (const [t, at] of lineAt) {
    if (at.size < 2) continue
    if (at.size >= boilerAt) boiler.push({ line: t.slice(0, 80), items: at.size })
    else for (const x of at) dupItems.add(x)
  }
  for (const it of items) it.dup = dupItems.has(itemKey(it.doc, it.heading))
  const adrift = o.doc ? null : [...k.works, ...k.logs].filter((w) => !linked.has(w.id) && !k.superseded.has(w.id)).map((w) => ({ id: w.id, state: w.state || 'log', title: w.title }))
  const sum = {
    knowledge: k.id,
    items: all,
    unsourced: items.filter((x) => !x.links).length,
    rich: items.filter((x) => x.links >= 5).length,
    big: items.filter((x) => x.lines > 40).length,
    diary: items.filter((x) => x.diary >= 3).length,
    dup: dupItems.size,
    boiler: boiler.length,
    adrift: adrift ? adrift.length : null,
  }
  const gaps = eventGaps(k).filter((g) => !o.doc || g.doc === o.doc)
  sum.gaps = gaps.reduce((n, g) => n + g.missing.length, 0)
  if (o.json) return console.log(JSON.stringify({ sum, items, boiler, adrift, gaps }, null, 1))
  const pct = (n) => (all ? `${Math.round((n / all) * 100)}%` : '-')
  console.log(`# ${k.id} — 항목 ${all} · 기록 없는 항목 ${sum.unsourced}(${pct(sum.unsourced)}) · 다시 그릴 만한 항목(이어진 기록 5↑) ${sum.rich} · 큰 항목(40줄↑) ${sum.big} · 날짜 줄 3↑ ${sum.diary} · 같은 글 ${sum.dup}(틀 문장 ${sum.boiler} 줄 따로)${adrift ? ` · 닿지 않은 기록 ${adrift.length}` : ''}`)
  console.log('\n| 문서 | 항목 | 기록 없음 | 다시 그릴 만함 | 큰 항목 |\n|---|---|---|---|---|')
  for (const d of docs) {
    const xs = items.filter((x) => x.doc === d.path)
    console.log(`| ${d.path} | ${xs.length} | ${xs.filter((x) => !x.links).length} | ${xs.filter((x) => x.links >= 5).length} | ${xs.filter((x) => x.lines > 40).length} |`)
  }
  const top = items.filter((x) => x.links >= 1).sort((a, b) => b.links - a.links || b.lines - a.lines).slice(0, 20)
  console.log('\n## 이어진 기록이 많은 항목(20)\n| 문서 › 머리 | 기록 | 파생 | 줄 | 같은 글 | 아직 안 넣은 옛 기록 |\n|---|---|---|---|---|---|')
  for (const x of top) console.log(`| ${x.doc} › ${x.heading} | ${x.links} | ${x.derived} | ${x.lines} | ${x.dup ? 'O' : ''} | ${x.pend || ''} |`)
  if (boiler.length) {
    console.log('\n## 틀 문장(여러 항목에 같은 글 · 다시 그리기 대상 아님)')
    for (const b of boiler.slice(0, 10)) console.log(`- ${b.items}곳: ${b.line}`)
  }
  for (const g of gaps) {
    console.log(`\n## 갈래 문서에 빠진 사건 기록: ${g.form} (${g.doc}${g.exists ? ` · 항목 ${g.items}` : ' · 문서 없음'})`)
    if (!g.missing.length) console.log('- 없음')
    for (const w of g.missing) console.log(`- ${w.date} · ${w.id} · ${w.title}${w.state ? ` [${w.state}]` : ''}`)
  }
}

// 사건 갈래(회의록 · 장애 대응 · 주간보고 …) 문서에 항목이 없는 사건 기록 — 후보다(이름 · 태그로 고른다 · 사람이 가른다)
//   후보: 제목 · id · 태그에 갈래 이름이나 다른 이름이 든 기록(넣지 못함 · 메모 · 바로잡힘 · 두기 · kmd 의 일 뺌)
//   빠짐: 그 문서 어느 항목에도 이어지지 않았고, 그 문서 항목에 이어진 기록 본문(채우기 기록의 「## 근거」)에 id 가 없다
export function eventGaps(k) {
  const out = []
  for (const f of k.forms?.rows || []) {
    if (f.kind !== '사건') continue
    const docPath = `docs/${f.folder ? `${f.folder}/` : ''}${f.name}.md`
    const d = k.byDocPath.get(docPath)
    const words = [f.name, ...(f.aliases || [])].filter(Boolean)
    const hit = (w) => words.some((x) => `${w.title} ${w.id} ${w.tags.join(' ')}`.includes(x))
    const linked = new Set()
    const said = []
    for (const s of d?.sections || []) for (const x of linksOf(k, d, s)) {
      linked.add(x.id)
      said.push(x.body)
    }
    const told = said.join('\n')
    const missing = k.works
      .filter((w) => hit(w) && !['held', 'memo', 'fixed', 'kept'].includes(w.state) && !w.tags.includes('memo') && !k.superseded.has(w.id))
      .filter((w) => !linked.has(w.id) && !told.includes(w.id))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((w) => ({ id: w.id, date: w.date, title: w.title, state: w.state || null }))
    out.push({ form: f.name, doc: docPath, exists: !!d, items: d?.sections.length || 0, missing })
  }
  return out
}

async function rec(dir, id, o) {
  const k = await load(dir, o)
  const w = k.byWork.get(id)
  if (!w) throw new Error(`없는 기록: ${id}`)
  const put = parsePut(w.body)
  if (o.json) return console.log(JSON.stringify({ id: w.id, date: w.date, author: w.author, title: w.title, state: w.state || null, tags: w.tags, touches: w.touches, put, body: w.body }, null, 1))
  console.log(`# ${w.id}\n제목: ${w.title}\n때: ${w.date} · 쓴 사람: ${w.author || '-'} · 상태: ${w.state || 'log'}\n태그: ${w.tags.join(' · ') || '-'}\n이름: ${w.touches.join(' · ') || '-'}${put.length ? `\n넣은 곳: ${put.map((p) => `${p.doc} › ${p.heading}`).join(' / ')}` : ''}\n\n${w.body}`)
}

async function trail(dir, docPath, heading, o) {
  const k = await load(dir, o)
  const d = k.byDocPath.get(docPath)
  if (!d) throw new Error(`문서가 없다: ${docPath}`)
  const s = d.sections.find((x) => x.h === heading)
  if (!s) throw new Error(`머리가 없다: ${heading} — 이 문서의 머리: ${d.sections.map((x) => x.h).slice(0, 30).join(' · ')}`)
  const links = linksOf(k, d, s)
  const cut = (b) => (o.full ? b : b.length > 2000 ? `${b.slice(0, 2000)}\n…(${b.length - 2000}자 접음 · --full)` : b)
  const out = { doc: d.path, heading: s.h, base: sha16(s.body), coords: coordsOfSection(k, d, s.h), current: s.body, records: links.map((x) => ({ ...x, body: cut(x.body) })) }
  if (o.json) return console.log(JSON.stringify(out, null, 1))
  console.log(`# ${d.path} › ${s.h}\nbase: ${out.base}\n이름: ${out.coords.join(' · ') || '(없음)'}\n이어진 기록: ${links.length}(재료 ${sourceOf(links).length})\n\n## 지금 글\n${s.body}\n`)
  for (const x of links) {
    console.log(`\n---\n## ${x.date} · ${x.id} (${x.kind}${x.author ? ` · ${x.author}` : ''})${x.mark.length ? ` [${x.mark.join(' · ')}]` : ''}${x.scope === 'doc' ? ' [문서 단위]' : ''}\n제목: ${x.title}\n이음: ${x.how.join(' · ')}${x.put.length ? `\n넣은 줄: ${x.put.map((p) => (p.isNew ? '새 항목' : `${p.from || '(빈)'} → ${p.to || '(빈)'}`)).join(' / ')}` : ''}\n\n${cut(x.body)}`)
  }
}

// 사라지는 표 행(첫 열 열쇠) · 문장(3-gram 겹침 0.6 미만)
const grams = (s) => {
  const t = s.replace(/\s+/g, '')
  const g = new Set()
  for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3))
  return g
}
const jac = (a, b) => {
  let n = 0
  for (const x of a) if (b.has(x)) n++
  return n / (a.size + b.size - n || 1)
}
const rowKeys = (body) => {
  const keys = new Map()
  for (const l of String(body).split('\n')) {
    if (!isTable(l) || /^\s*\|[\s:|-]+\|\s*$/.test(l)) continue
    const c = l.split('|')[1]?.trim()
    if (c) keys.set(c, (keys.get(c) || 0) + 1)
  }
  return keys
}
export function dropsOf(oldBody, newBody) {
  const ok = rowKeys(oldBody)
  const nk = rowKeys(newBody)
  const rows = [...ok.keys()].filter((x) => ok.get(x) === 1 && !nk.has(x))
  const newG = proseLines(newBody).map(grams)
  const newFlat = newBody.replace(/\s+/g, '')
  const lines = proseLines(oldBody).filter((t) => t.replace(/\s+/g, '').length >= 20).filter((t) => !newFlat.includes(t.replace(/\s+/g, '')) && !newG.some((g) => jac(grams(t), g) >= 0.6))
  return { rows, lines }
}

async function readInput(file) {
  const base = path.dirname(path.resolve(file))
  const j = JSON.parse(await fs.readFile(file, 'utf8'))
  if (!j.record || typeof j.record.title !== 'string' || typeof j.record.body !== 'string') throw new Error('input.record 에 title · body 가 있어야 한다')
  if (!Array.isArray(j.sections) || !j.sections.length) throw new Error('input.sections 는 항목 하나 이상의 목록이다')
  for (const s of j.sections) {
    if (s.contentFile && s.content == null) s.content = await fs.readFile(path.resolve(base, s.contentFile), 'utf8')
    delete s.contentFile
    if (typeof s.doc !== 'string' || typeof s.heading !== 'string' || typeof s.content !== 'string') throw new Error('sections[] 마다 doc · heading · content(또는 contentFile) 가 있어야 한다')
    s.content = s.content.replace(/\r\n/g, '\n').trim()
  }
  return j
}

// 조각마다 검사 — gate(꼴 · base · 값 대조) + 개편 전 기록 섞임 + 사라지는 표 행 · 문장
function inspect(k, input) {
  const spread = input.sections.length > 1
  return input.sections.map((s) => {
    const d = k.byDocPath.get(s.doc)
    const sec = d?.sections.find((x) => x.h === s.heading) || null
    const no = (why) => ({ doc: s.doc, heading: s.heading, ok: false, why, lostRows: [], lostLines: [] })
    if (!d) return no('문서가 없다(새 문서는 세우지 않는다 · 갈래 문서를 먼저 세운다)')
    if (s.new) return inspectNew(k, input, s, d, sec, spread)
    if (!sec) return no('머리가 없다(있는 항목만 다시 그린다 · 빠진 항목을 채우려면 new: true 와 sources)')
    const links = linksOf(k, d, sec)
    const legacyPend = links.filter((x) => x.mark.includes('pend')).map((x) => x.id)
    const r = checkSection(k, { doc: s.doc, heading: s.heading, base: s.base, content: s.content, record: input.record, spread, legacyPend })
    const drop = dropsOf(sec.body, s.content)
    return { doc: s.doc, heading: s.heading, ok: !!r.ok, code: r.code || null, why: r.why || null, changed: r.changed || [], lint: r.lint || null, lostRows: drop.rows, lostLines: drop.lines, sources: sourceOf(links).length }
  })
}

// 빠진 항목 채우기(new) — 있는 문서에 없는 머리 · 재료 기록(sources)이 값의 근거다.
//   재료 기록 본문은 검사에만 「## 근거」 아래로 내려 싣는다(그 기록의 「바뀐 것」 이 이 항목의 요구 값이 되지 않게 · 지어낸 값은 잡히게)
//   사건 갈래 문서(회의록 · 장애 대응 …)의 머리는 「YYYY-MM-DD 무엇」
function inspectNew(k, input, s, d, sec, spread) {
  const no = (why) => ({ doc: s.doc, heading: s.heading, ok: false, why, lostRows: [], lostLines: [] })
  if (sec) return no('이미 있는 머리다(있는 항목은 new 없이 base 와 함께 다시 그린다)')
  if (!/\S/.test(s.heading) || /[\r\n]/.test(s.heading) || s.heading.length > 120) return no('머리는 한 줄 · 120자 안')
  if (formOfDoc(k, d)?.kind === '사건' && !/^\d{4}-\d{2}-\d{2} \S/.test(s.heading)) return no('사건 갈래 문서의 머리는 「YYYY-MM-DD 무엇」')
  const ids = Array.isArray(s.sources) ? s.sources : []
  if (!ids.length) return no('sources(재료 기록 id)가 있어야 한다')
  const ws = []
  for (const id of ids) {
    const w = k.byWork.get(String(id))
    if (!w) return no(`없는 기록: ${id}`)
    if (w.state === 'held' || w.state === 'memo' || w.tags.includes('memo')) return no(`넣지 못함 · 메모 기록은 재료가 아니다: ${id}`)
    ws.push(w)
  }
  const ground = ws.map((w) => `### ${w.title}\n${String(w.body).replace(/^#{1,2} /gm, '### ')}`).join('\n\n')
  const record = { title: input.record.title, body: `${input.record.body}\n\n## 근거\n${ground}` }
  const r = checkSection(k, { doc: s.doc, heading: s.heading, base: null, content: s.content, record, spread })
  return { doc: s.doc, heading: s.heading, new: true, ok: !!r.ok, code: r.code || null, why: r.why || null, changed: [], lint: r.lint || null, lostRows: [], lostLines: [], sources: ws.length }
}

// 문서의 갈래(갈래 장부 _forms.md · 폴더/이름.md)
function formOfDoc(k, d) {
  const rows = k.forms?.rows || []
  return rows.find((f) => d.path === `docs/${f.folder ? `${f.folder}/` : ''}${f.name}.md`) || null
}

const show = (rs) => {
  for (const r of rs) {
    console.log(`\n## ${r.doc} › ${r.heading}\n검사: ${r.ok ? '넘음' : `걸림(${r.code || '-'}) ${r.why}`}${r.sources != null ? ` · 이어진 기록 ${r.sources}` : ''}`)
    if (r.changed?.length) console.log(`바뀐 값: ${r.changed.map((c) => `${c.from} → ${c.to}`).join(' / ')}`)
    if (r.lint) console.log(`글 다듬을 곳: ${JSON.stringify(r.lint)}`)
    if (r.lostRows?.length) console.log(`사라지는 표 행(${r.lostRows.length}): ${r.lostRows.join(' · ')}`)
    if (r.lostLines?.length) console.log(`사라지는 문장(${r.lostLines.length}):\n${r.lostLines.map((x) => `  - ${x}`).join('\n')}`)
  }
}

async function check(dir, file, o) {
  const k = await load(dir, o)
  const input = await readInput(file)
  const rs = inspect(k, input)
  if (o.json) return console.log(JSON.stringify(rs, null, 1))
  show(rs)
  const bad = rs.filter((r) => !r.ok).length
  const drops = rs.filter((r) => r.lostRows?.length || r.lostLines?.length).length
  console.log(`\n= 항목 ${rs.length} · 걸림 ${bad} · 사라지는 것 있음 ${drops}${bad ? ' — 걸린 까닭을 고쳐 다시 check' : drops ? ' — 사람이 본 뒤 put --allow-drop' : ' — put 으로 넣을 수 있다'}`)
  process.exitCode = bad ? 2 : 0
}

async function put(dir, file, o) {
  if (!o.user) throw new Error('--user <사람> 이 있어야 한다(기록을 쓴 사람 · 그 지식의 지식관리자)')
  const abs = path.resolve(dir)
  const input = await readInput(file)
  // save 에 넘기는 기록 그 자체 — prepare 가 이름(touches)을 채운다
  const rec = { ...input.record, tags: [...new Set([...(Array.isArray(input.record.tags) ? input.record.tags : []), 'rebuild'])] }
  let fail = null
  const prepare = async () => {
    // 줄 안 · 새로 읽은 지식으로 다시 본다(그사이 바뀐 글을 덮지 않는다)
    const k = await load(abs, o)
    const rs = inspect(k, input)
    const bad = rs.filter((r) => !r.ok)
    const drops = rs.filter((r) => r.lostRows?.length || r.lostLines?.length)
    if (bad.length) fail = { why: '검사에 걸렸다', rs: bad }
    else if (drops.length && !o['allow-drop']) fail = { why: '사라지는 표 행 · 문장이 있다(사람이 본 뒤 --allow-drop)', rs: drops }
    if (fail) return { abort: { same: false, id: null } }
    // 이름 — 넣는 항목들의 장부 이름(기록이 이 항목들에 이어지게)
    if (!rec.touches?.length) {
      const coords = [...new Set(input.sections.flatMap((s) => { const d = k.byDocPath.get(s.doc); return d ? coordsOfSection(k, d, s.heading) : [] }))]
      if (coords.length) rec.touches = coords
      else rec.touchesEmpty = rec.touchesEmpty || '다시 그리기: 이 항목에 걸린 이름이 없다'
    }
    return { sections: input.sections.map((s) => ({ doc: s.doc, heading: s.heading, content: s.content, base: s.base })) }
  }
  const r = await save(abs, { ...input, record: rec }, { user: o.user, prepare, partial: true })
  if (fail) {
    show(fail.rs)
    throw new Error(`넣지 않았다: ${fail.why}. 아무것도 쓰지 않았다`)
  }
  console.log(JSON.stringify({ ok: true, record: r.id || r.record || null, commit: r.commit || null, held: r.held || [] }, null, 1))
  if (r.held?.length) process.exitCode = 3
}

export async function main(argv) {
  const { pos, o } = args(argv)
  const [cmd, dir, a, b] = pos
  if (cmd === 'scan' && dir) return scan(dir, o)
  if (cmd === 'trail' && dir && a && b) return trail(dir, a, b, o)
  if (cmd === 'rec' && dir && a) return rec(dir, a, o)
  if (cmd === 'check' && dir && a) return check(dir, a, o)
  if (cmd === 'put' && dir && a) return put(dir, a, o)
  console.error('쓰기: kmd-migrate.mjs scan <지식 폴더> | rec <지식 폴더> <기록 id> | trail <지식 폴더> <docs/x.md> <머리> | check <지식 폴더> <input.json> | put <지식 폴더> <input.json> --user <사람> [--allow-drop]')
  process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`오류: ${e.code ? `${e.code} ` : ''}${e.message}`)
    process.exitCode = 1
  })
}
