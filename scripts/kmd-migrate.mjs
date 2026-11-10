// 지식 옮겨 쓰기(다시 그리기) 도구 — 세션 스킬 kmd-migrate(.claude/skills/kmd-migrate)가 부른다.
//   지식 폴더(git)를 손에 쥔 사람이 세션에서 「기록으로 항목을 다시 그리기」 를 할 때, 서비스의 기준(저장 검사 · 값 대조 · 참고 블록 · 기록)을 그대로 지나게 한다.
//   기능(화면 · 길)이 아니다. 서버를 거치지 않고 core 의 저장(core/save.js)과 검사(core/gate.js)를 지식 폴더에 바로 건다.
//
//   node scripts/kmd-migrate.mjs scan  <지식 폴더> [--doc docs/x.md] [--json]          진단: 문서마다 항목 · 기록 없는 항목 · 큰 항목 · 날짜 줄 · 같은 글 · 다시 그릴 만한 항목 · 사건 갈래 문서에 빠진 기록
//   node scripts/kmd-migrate.mjs rec   <지식 폴더> <기록 id> [--json]                         기록 하나: 머리 · 상태 · 이름 · 넣은 곳 · 본문
//   node scripts/kmd-migrate.mjs trail <지식 폴더> <docs/x.md> <머리> [--json] [--full]  항목 하나: 지금 글 · base · 이어진 기록(오래된 순 · 표시) · 넣은 줄
//   node scripts/kmd-migrate.mjs check <지식 폴더> <input.json>                          마른 검사: 쓰지 않는다 · 값 대조 · 꼴 · 사라지는 표 행 · 문장
//   node scripts/kmd-migrate.mjs put   <지식 폴더> <input.json> --user <사람> [--allow-drop]  넣기: 줄 안에서 다시 검사 → 기록 + 항목 + git 커밋 한 묶음
//   node scripts/kmd-migrate.mjs held-scan <지식 폴더> [--plan plan.json] [--data <살림 폴더>] [--json]  이행 진단(읽기만): 넣지 못함(줄 code 별) · 승인 기다림 · 메모 · 개편 전 기록 · held/ 원천 · 기록 모음 · 이슈 갈래 · 기록마다 할 일
//   node scripts/kmd-migrate.mjs held-put  <지식 폴더> --user <사람> --cutover <때 · none> [--plan plan.json] [--limit n]   이행(저장 승인 6-2): 깨끗한 저장소만 · 태그로 되돌리기 자리 → 기록 하나 + 기록 모음 · 이슈 항목 = 커밋 하나 · 다시 돌리면 할 일 없음
//
//   input.json = { record: { title, body, touches?, tags? }, sections: [{ doc, heading, base, content | contentFile }] }
//     빠진 항목 채우기: sections[] 에 base 대신 new: true · sources: [재료 기록 id](있는 문서의 없는 머리 · 사건 갈래면 「YYYY-MM-DD 무엇」)
//     record.body 는 기록 서식(docs/템플릿/기록.md): 「## 바뀐 것」 에 이 항목의 「옛 값 → 새 값」 · 뺀 값은 「옛 값 → (뺌)」 · 까닭 · 근거
//   공통: --cutover "YYYY-MM-DD HH:MM"(개편 때 · 없으면 <지식 폴더>/../.kmd/cutover.json)
//
//   put 은 사라지는 표 행 · 문장이 있으면 넣지 않는다. 사람이 본 뒤 --allow-drop 으로만 넘는다. 값(gate)이 걸리면 늘 넣지 않는다(넣지 못함을 남기지 않는다).
//   다시 그리기 재료(sourceOf)는 옛 넣지 못함 · 메모(태그 · 이행 뒤 들어간 기록이어도) · 이행 기록을 뺀다(b13 · 저장 승인 P8) — 확정이 아니거나 kmd 가 옮긴 기록이다.
//   저장은 넣지 못함 없이(partial 없음 · 저장승인 P-D25 · P7): 저장 검사(꼴 · 원본이 주인 · 지문 …)에 걸리면 입력 오류로 아무것도 쓰지 않고 종료 코드 2.
//   팀 서버가 돌고 있는 폴더에 바로 쓰면 서버 캐시가 낡는다 — 사본에서 쓰고 백업 자리로 올린 뒤 「백업에서 받기」 를 쓴다(스킬 3절).

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadKnowledge, coordsOfSection, sectionOf, isLegacy } from '../core/knowledge.js'
import { checkSection } from '../core/gate.js'
import { save, SECTIONS_MAX, localStamp } from '../core/save.js'
import { parsePut, parseHeld, parseLinked, namesOfRecord, itemKey } from '../core/parts.js'
import { parseRefLine, headingMatches } from '../core/sections.js'
import { valuesOf, squeeze, knowledgeParts, mustValues, HASH_RE, REC_ID_RE } from '../core/values.js'
import { RECORDS_DOC_PATH, RECORDS_MONTH_TEXT, headingFits, formHeadRule, guardNames } from '../core/guard.js'
import { cleanForms } from '../core/namebook.js'
import { ruleText } from '../core/pcplace.js'
import { formatCheck } from '../core/docformat.js'
import { tryGit, headSha } from '../core/git.js'
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

//   --cutover none — 개편 때가 없는 서버(모든 안 넣은 사람 기록이 개편 전) · 없으면 <살림 폴더>/cutover.json(--data · 아니면 <지식 폴더>/../.kmd)
//   팀 서버는 serve.json 의 cutoverAt 을 먼저 본다 — 사본에서는 그 값을 --cutover 로 넘긴다(다르면 이행 뒤에도 승인 저장 켜기가 E_CONFLICT)
async function cutoverFile(dir, o) {
  try {
    const j = JSON.parse(await fs.readFile(path.join(o.data ? path.resolve(o.data) : path.join(dir, '..', '.kmd'), 'cutover.json'), 'utf8'))
    return j.cutoverAt || j.at || null
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`cutover.json 을 읽지 못했다: ${e.message}`)
    return null
  }
}
async function cutoverOf(dir, o) {
  if (o.cutover === 'none') return null
  if (o.cutover) return o.cutover
  return cutoverFile(dir, o)
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
    // 글 그대로 이은 기록(승인 저장 · 「## 이은 항목」) — 경위다(값은 글에 없다)
    if ((w.tags || []).includes('put') && parseLinked(w.body).some((r) => r.doc === doc.path && r.heading === sec.h)) add(w.id, 'linked')
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
    // 옛 넣지 못함 · 메모 — 태그로 본다(이행 뒤에는 들어간 기록이지만 값은 확정이 아니다 · 승인 저장 지식은 새로 붙지 않는다)
    if (w.state === 'held' || w.tags.includes('held')) mark.push('held')
    if (w.state === 'memo' || w.tags.includes('memo')) mark.push('memo')
    if (w.tags.includes(MIGRATE_TAG)) mark.push('migrate')
    if (w.state === 'pend' && coords.size) mark.push('pend')
    if (w.tags.some((t) => DERIVED.includes(t))) mark.push('derived')
    const scope = how.size === 1 && how.has('doc') ? 'doc' : 'item'
    out.push({ id, kind: k.logs.includes(w) ? 'log' : 'work', date: w.date, title: w.title, author: w.author || null, state: w.state || null, tags: w.tags, how: [...how], scope, mark, put: parsePut(w.body).filter((r) => r.doc === doc.path && r.heading === sec.h).map((r) => ({ from: r.from, to: r.to, isNew: r.isNew })), body: w.body })
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  return out
}
// 재료가 되는 기록 — 넣지 못함 · 메모 · 이행 기록은 빼고, 문서 단위 줄만 있는 기록은 셈에서 뺀다
const sourceOf = (links) => links.filter((x) => !x.mark.includes('held') && !x.mark.includes('memo') && !x.mark.includes('migrate') && x.scope === 'item')

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
    console.log(`\n## 갈래 문서에 빠진 사건 기록: ${g.form} (${g.doc}${g.exists ? ` · 항목 ${g.items}` : ' · 문서 없음'}${g.disorder ? ` · 날짜 차례 어긋난 항목 ${g.disorder}` : ''})`)
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
      .filter((w) => hit(w) && !['held', 'memo', 'fixed', 'kept'].includes(w.state) && !w.tags.includes('memo') && !w.tags.includes('held') && !w.tags.includes(MIGRATE_TAG) && !k.superseded.has(w.id))
      .filter((w) => !linked.has(w.id) && !told.includes(w.id))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((w) => ({ id: w.id, date: w.date, title: w.title, state: w.state || null }))
    out.push({ form: f.name, doc: docPath, exists: !!d, items: d?.sections.length || 0, disorder: d ? outOfOrder(d) : 0, missing })
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
    let d = k.byDocPath.get(s.doc)
    const sec = d?.sections.find((x) => x.h === s.heading) || null
    const no = (why) => ({ doc: s.doc, heading: s.heading, ok: false, why, lostRows: [], lostLines: [] })
    // 갈래 문서가 아직 없으면 — 빠진 항목 채우기(new)만 그 갈래 문서를 세운다(갈래 장부의 폴더 · 이름 그대로 · 저장의 새 문서 G4 가 # 이름을 단다)
    if (!d && s.new && formOfDoc(k, { path: s.doc })) d = { path: s.doc, sections: [], fresh: true }
    if (!d) return no('문서가 없다(새 문서는 갈래 장부에 있는 갈래 문서를 그 폴더 · 이름으로 · new 항목으로만 세운다)')
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
    if (w.state === 'held' || w.state === 'memo' || w.tags.includes('memo') || w.tags.includes('held')) return no(`넣지 못함 · 메모 기록은 재료가 아니다: ${id}`)
    ws.push(w)
  }
  const ground = ws.map((w) => `### ${w.title}\n${String(w.body).replace(/^#{1,2} /gm, '### ')}`).join('\n\n')
  const record = { title: input.record.title, body: `${input.record.body}\n\n## 근거\n${ground}` }
  const r = checkSection(k, { doc: s.doc, heading: s.heading, base: null, content: s.content, record, spread })
  let before = null
  if (s.before != null) {
    if (!d.sections.some((x) => x.h === s.before)) return no(`before 머리가 없다: ${s.before}`)
    before = s.before
  } else if (formOfDoc(k, d)?.kind === '사건') before = dateSlot(d, s.heading)
  s.before = before
  return { doc: s.doc, heading: s.heading, new: true, fresh: !!d.fresh, before, ok: !!r.ok, code: r.code || null, why: r.why || null, changed: [], lint: r.lint || null, lostRows: [], lostLines: [], sources: ws.length }
}

// 사건 문서의 날짜 자리 — 새 머리의 날짜보다 늦은 첫 항목(그 앞에 끼운다) · 없으면 끝(null)
//   같은 날짜는 뒤에 · 날짜 없는 머리는 건너뛴다
const dayOf = (h) => (String(h).match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null
export function dateSlot(d, heading) {
  const day = dayOf(heading)
  if (!day) return null
  return d.sections.find((x) => dayOf(x.h) && dayOf(x.h) > day)?.h || null
}
// 사건 문서의 차례 어긋남 — 앞 항목보다 이른 날짜의 항목 수
export function outOfOrder(d) {
  let last = null
  let n = 0
  for (const x of d.sections) {
    const day = dayOf(x.h)
    if (!day) continue
    if (last && day < last) n++
    else last = day
  }
  return n
}

// 문서의 갈래(갈래 장부 _forms.md · 폴더/이름.md)
function formOfDoc(k, d) {
  const rows = k.forms?.rows || []
  return rows.find((f) => d.path === `docs/${f.folder ? `${f.folder}/` : ''}${f.name}.md`) || null
}

const show = (rs) => {
  for (const r of rs) {
    console.log(`\n## ${r.doc} › ${r.heading}\n검사: ${r.ok ? '넘음' : `걸림(${r.code || '-'}) ${r.why}`}${r.sources != null ? ` · 이어진 기록 ${r.sources}` : ''}`)
    if (r.new) console.log(`자리: ${r.fresh ? '새 문서(갈래 문서를 세우고 첫 항목)' : r.before ? `「${r.before}」 앞` : '문서 끝'}`)
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
    return { sections: input.sections.map((s) => ({ doc: s.doc, heading: s.heading, content: s.content, base: s.base, ...(s.new && s.before ? { before: s.before } : {}) })) }
  }
  let r
  try {
    r = await save(abs, { ...input, record: rec }, { user: o.user, prepare, marks: true })
  } catch (e) {
    // 저장 검사에 걸림 — 입력 오류(아무것도 쓰지 않았다 · 넣지 못함을 남기지 않는다 · 종료 코드 2)
    if (['E_INPUT', 'E_FORMAT', 'E_FORBIDDEN', 'E_NOTFOUND', 'E_CONFLICT'].includes(e.code)) e.exit = 2
    throw e
  }
  if (fail) {
    show(fail.rs)
    throw Object.assign(new Error(`넣지 않았다: ${fail.why}. 아무것도 쓰지 않았다`), { exit: 2 })
  }
  console.log(JSON.stringify({ ok: true, record: r.id || r.record || null, commit: r.commit || null }, null, 1))
}

// ── 이행(저장 승인 설계 6-2 · P-D21 · P8): 옛 저장 길(넣지 못함 · 메모 · 개편 전 기록)을 승인 저장 길로 ──
//   held-scan 은 읽기만 한다. held-put 은 지식마다 저장 하나(기록 하나 + 기록 모음 · 달 항목 · 이슈 항목 · 이름) = 커밋 하나다.
//   옛 기록은 고치지 않는다: 이행 기록(예약 태그 migrate-held)이 fixes 로 가리키면 이은 항목 이력의 들어간 기록(in)으로 읽히고(core/knowledge.js k.migrated), 옮긴 자리는 이행 기록의 「## 이은 항목」(글 그대로)이다.
//   항목 글은 바꾸지 않는다(새로 세우는 이슈 항목 · 기록 모음 달 항목만). 승인 저장으로 켜는 것은 총괄 관리자 화면 일(정책 탭 · P5)이다.

const MIGRATE_TAG = 'migrate-held'
const MONTH = (d) => String(d || '').slice(0, 7)
const needOf = (text) => [...valuesOf(String(text || '').replace(HASH_RE, ' ').replace(REC_ID_RE, ' '))].filter((v) => v.length <= 30)
const hasAll = (vals, body) => {
  const have = valuesOf(body)
  const flat = squeeze(body)
  return vals.every((v) => have.has(v) || flat.includes(v))
}
// 이슈를 받는 갈래(P-D34) — 종류 대장 · 사건 가운데 이름 · 다른 이름에 「이슈」 가 든 갈래
export const issueFormOf = (k) => (k.forms?.rows || []).find((f) => ['대장', '사건'].includes(f.kind) && [f.name, ...(f.aliases || [])].some((x) => String(x).includes('이슈'))) || null
const formDoc = (f) => `docs/${f.folder ? `${f.folder}/` : ''}${f.name}.md`
const KIND_WORD = { held: '넣지 못함', review: '승인 기다림', memo: '메모', legacy: '개편 전 기록' }
const STATUS_WORD = { in: '값이 글에 있음', stale: '값이 낡음', trail: '경위만', open: '값이 글에 없음' }
const DO_WORD = { link: '이은 항목에 잇기(글 그대로)', month: '기록 모음 달 항목에 잇기', issue: '이슈 항목으로 제기', names: '이름 · 갈래 세우기', rebuild: '사람이 고를 것: 다시 그리기(put · record.fixes) · --plan issue · month' }

// 항목 자리 — 넣지 못함 줄(coord 또는 doc · heading) · 기록의 건드린 이름
function itemAt(k, { coord, doc, heading }) {
  if (coord) {
    const x = sectionOf(k, String(coord).trim().normalize('NFC'))
    return x?.sec ? { doc: x.doc.path, heading: x.sec.h, sec: x.sec } : null
  }
  const d = doc ? k.byDocPath.get(doc) : null
  const s = d && heading ? d.sections.find((x) => x.h === heading) || d.sections.find((x) => headingMatches(x.h, heading)) : null
  return s ? { doc: d.path, heading: s.h, sec: s } : null
}
function touchItems(k, w) {
  const out = new Map()
  for (const c of w.touches || []) {
    const t = itemAt(k, { coord: c })
    if (t && !out.has(itemKey(t.doc, t.heading))) out.set(itemKey(t.doc, t.heading), t)
  }
  return [...out.values()]
}
// 값이 낡음(P-D21) — 그 기록 뒤에 같은 항목을 고친 들어간 기록(항목 표지 · 넣은 것 칸)
function laterMap(k) {
  const m = new Map()
  for (const x of k.works) {
    if (x.state !== 'in' || !(x.tags || []).includes('put')) continue
    for (const p of parsePut(x.body)) {
      const key = itemKey(p.doc, p.heading)
      if (!m.has(key) || m.get(key).date < x.date) m.set(key, { id: x.id, date: x.date })
    }
  }
  return m
}
function laterOf(k, w, t, later) {
  const a = t.sec.applied && t.sec.applied !== w.id ? k.byWork.get(t.sec.applied) : null
  if (a && a.date > w.date) return a.id
  const p = later.get(itemKey(t.doc, t.heading))
  return p && p.id !== w.id && p.date > w.date ? p.id : null
}
// 넣지 못함 줄 하나의 지금 상태
function rowState(k, w, r, later) {
  if (r.code === 'names') {
    const { names, forms } = namesOfRecord(w.body)
    const nn = names.filter((n) => !k.vocab.coords.has(n.coord))
    const ff = forms.filter((f) => !(k.forms?.rows || []).some((x) => x.name === f.name))
    return nn.length || ff.length ? { status: 'open', names: nn, forms: ff } : { status: 'in' }
  }
  const t = itemAt(k, r)
  const text = typeof r.content === 'string' ? r.content : Array.isArray(r.edits) ? r.edits.map((e) => String(e?.replace ?? '')).join('\n') : ''
  if (t && squeeze(text)) {
    const vals = needOf(text)
    if (vals.length ? hasAll(vals, t.sec.body) : squeeze(t.sec.body).includes(squeeze(text))) return { status: 'in', target: t }
  } else if (t && Array.isArray(r.edits) && r.edits.length && r.edits.every((e) => squeeze(e?.find ?? ''))) {
    // 지우기만 한 조각(replace 가 빈 글) — 지운 글이 지금 글에 없으면 들어간 것이다
    if (r.edits.every((e) => !squeeze(t.sec.body).includes(squeeze(e.find)))) return { status: 'in', target: t }
  }
  const by = t ? laterOf(k, w, t, later) : null
  return by ? { status: 'stale', target: t, by } : { status: 'open', target: t }
}
// 이슈 항목 머리 — 사건 갈래는 「YYYY-MM-DD 무엇」 · 이름 패턴 갈래는 「값: 설명」 · 아니면 주제
function issueHeading(f, w, taken) {
  const what = String(w.title).replace(/ — /g, ': ').replace(/[#\r\n`|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '옛 기록'
  const base = f.kind === '사건' ? `${w.date.slice(0, 10)} ${what}` : f.pattern ? `이행-${w.id.slice(0, 9).replace(/[^\w-]/g, '')}: ${what}` : what
  let h = base
  for (let n = 2; taken.has(h); n++) h = `${base} (${n})`
  taken.add(h)
  return h
}
// 이슈 항목 글 — 풀리지 않은 물음(무엇이 열려 있다)은 그 자체로 확정된 지식이다(P-D34) · 넣으려던 글은 규칙 길 꼴로 옮긴다(작성기준 · E_FORMAT 을 지나게)
function issueText(k, w, rows, doc) {
  const L = ['**진행상태**: 열림', '', `옛 저장(${w.date.slice(0, 10)})이 지금 글에 넣지 못한 것이다. 넣을지 아직 정하지 않았다.`]
  const quote = []
  if (rows.length) {
    for (const x of rows) {
      L.push(`- 대상: ${x.target ? `${x.target.doc.replace(/^docs\/|\.md$/g, '')} › ${x.target.heading}` : x.row.heading || x.row.coord || '(자리 없음)'}${x.row.why ? ` · 까닭: ${String(x.row.why).replace(/\s+/g, ' ').replace(/ — /g, ': ').slice(0, 160)}` : ''}`)
      const t = typeof x.row.content === 'string' ? x.row.content : Array.isArray(x.row.edits) ? x.row.edits.map((e) => String(e?.replace ?? '')).join('\n') : ''
      if (t.trim()) quote.push(t.trim())
    }
  } else {
    L.push(`- 대상: ${(w.touches || []).join(' · ') || '(이름 없음)'}`)
    quote.push(knowledgeParts(w.body).trim())
  }
  const q = ruleText(quote.join('\n\n'), doc)
  if (q) L.push('', '넣으려던 글:', '', q)
  const text = L.join('\n').trim()
  // 문서 꼴(E_FORMAT)을 지나야 한다 — 옛 대상 · 까닭 줄이 걸리면 그 줄을 떼고 · 그래도 걸리면 null(계획에서 거절 · held-put 이 반쯤 가다 걸리지 않게)
  if (!formatCheck(text, { doc }).problems.length) return text
  const bare = [L[0], L[1], L[2], ...(q ? ['', '넣으려던 글:', '', q] : [])].join('\n').trim()
  return formatCheck(bare, { doc }).problems.length ? null : bare
}

// 지식 하나의 이행 계획 — 옛 기록마다 갈래 · 상태 · 할 일 · 넣을 곳
//   plan(사람이 고른 것) = { "<기록 id>": "issue" | "month" | "link" | "rebuild" | { do, heading } } — 값이 글에 없는 것만 바꿀 수 있다
export function heldPlan(k, { plan = {}, now = new Date() } = {}) {
  const later = laterMap(k)
  const issueForm = issueFormOf(k)
  const issueDoc = issueForm ? formDoc(issueForm) : null
  const recordsDoc = k.byDocPath.get(RECORDS_DOC_PATH) || null
  const taken = new Set(issueDoc ? (k.byDocPath.get(issueDoc)?.sections || []).map((s) => s.h) : [])
  const recs = []
  const bad = []
  const old = k.works.filter((w) => w.state === 'held' || w.state === 'memo' || isLegacy(k, w)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  for (const w of old) {
    const kind = w.state === 'held' ? 'held' : w.state === 'memo' ? 'memo' : 'legacy'
    const pick0 = plan[w.id]
    const pick = typeof pick0 === 'string' ? pick0 : pick0 && typeof pick0 === 'object' ? pick0.do : null
    if (pick != null && !['issue', 'month', 'rebuild'].includes(pick)) bad.push(`${w.id}: 고를 수 있는 것은 issue · month · rebuild 이다(경위로만 잇기는 값이 낡았을 때 저절로)`)
    const x = { id: w.id, date: w.date, title: w.title, kind, codes: [], rows: [], links: [], issue: null, month: null, names: [], forms: [], rebuild: false, status: null, by: null }
    let open = []
    if (kind === 'held') {
      const rows = parseHeld(w.body)
      x.codes = [...new Set(rows.map((r) => r.code || '-'))]
      if (rows.length && rows.every((r) => r.code === 'review')) x.kind = 'review'
      for (const r of rows) {
        const s = rowState(k, w, r, later)
        x.rows.push({ code: r.code || '-', status: s.status, at: s.target ? itemKey(s.target.doc, s.target.heading) : r.heading || r.coord || null, by: s.by || null })
        if (s.status === 'open' && r.code === 'names') {
          x.names.push(...s.names)
          x.forms.push(...s.forms)
        } else if (s.status === 'open') open.push({ row: r, target: s.target, review: r.code === 'review' })
        else if (s.target) x.links.push(s.target)
      }
      // 줄이 없는 넣지 못함(옛 칸이 깨졌다) — 건드린 이름 항목에 잇는다
      if (!rows.length) x.links.push(...touchItems(k, w))
      x.status = open.length ? 'open' : x.rows.some((r) => r.status === 'stale') ? 'stale' : 'in'
    } else {
      const ts = touchItems(k, w)
      const vals = mustValues(knowledgeParts(w.body))
      const by = ts.map((t) => laterOf(k, w, t, later)).find(Boolean) || null
      x.status = !vals.length ? 'trail' : ts.length && hasAll(vals, ts.map((t) => t.sec.body).join('\n')) ? 'in' : by ? 'stale' : 'open'
      x.by = x.status === 'stale' ? by : null
      x.links.push(...ts)
      // 메모 · 개편 전 기록의 값이 글에 없고 낡지도 않았으면 사람이 고른다(6-2: 반영 = 다시 그리기 · 이슈 제기 · 넣지 않음 = 기록 모음)
      if (x.status === 'open') open.push({ row: null, target: null, review: true })
    }
    // 값이 글에 없는 것 — 사람이 고른 것 · 아니면 기본: 넣지 못함 줄은 이슈 갈래가 있으면 이슈 항목, 그 밖(승인 기다림 · 메모 · 개편 전 기록 ·
    //   이슈 갈래 없는 지식)은 사람이 고를 때까지 다시 그리기 먼저(값이 사람 결정 없이 기록 모음으로 가지 않게 · P-D29)
    if (open.length) {
      const how = pick || (!open.some((o) => o.review) && issueForm ? 'issue' : 'rebuild')
      if (how === 'issue' && !issueForm) bad.push(`${w.id}: 이 지식에 이슈를 받는 갈래가 없다(month · rebuild 가운데 고른다)`)
      else if (how === 'rebuild') x.rebuild = true
      else if (how === 'issue') {
        const h = pick0 && typeof pick0 === 'object' && typeof pick0.heading === 'string' && pick0.heading.trim() ? pick0.heading.trim() : issueHeading(issueForm, w, taken)
        if (!headingFits(issueForm, h) || /[\r\n]/.test(h) || h.length > 120) bad.push(`${w.id}: 이슈 항목 머리 「${h}」 가 갈래 「${issueForm.name}」 꼴이 아니다(${formHeadRule(issueForm)})`)
        else if ([...recs.map((r) => r.issue?.heading)].includes(h) || (k.byDocPath.get(issueDoc)?.sections || []).some((s) => s.h === h)) bad.push(`${w.id}: 이슈 항목 머리 「${h}」 가 이미 있다`)
        else {
          const content = issueText(k, w, open.filter((o) => o.row), issueDoc)
          if (content == null) bad.push(`${w.id}: 이슈 항목 글이 문서 꼴(E_FORMAT)을 지나지 못한다(month · rebuild 가운데 고른다)`)
          else x.issue = { doc: issueDoc, heading: h, content }
        }
      }
      // month — 아래에서 잇는다
    } else if (pick) bad.push(`${w.id}: 값이 이미 글에 있거나 낡았다(${STATUS_WORD[x.status]}). 고를 것이 없다`)
    // 이을 곳이 없으면 그 기록의 달 항목(P-D29)
    const uniq = new Map(x.links.map((t) => [itemKey(t.doc, t.heading), t]))
    x.links = [...uniq.values()].map((t) => ({ doc: t.doc, heading: t.heading }))
    if (!x.rebuild && !x.issue && (!x.links.length || open.length)) x.month = MONTH(w.date)
    x.do = x.rebuild ? 'rebuild' : [x.issue ? 'issue' : null, x.names.length || x.forms.length ? 'names' : null, x.links.length ? 'link' : null, x.month ? 'month' : null].filter(Boolean)
    recs.push(x)
  }
  // 고른 것의 id — 이행할 옛 기록이어야 한다(이미 이행된 것은 다시 돌릴 때 그대로 둔다)
  const oldIds = new Set(old.map((w) => w.id))
  for (const key of Object.keys(plan)) if (!oldIds.has(key) && !k.migrated?.has(key)) bad.push(`${key}: 이행할 옛 기록이 아니다(없는 id · 이미 들어간 기록)`)
  // 기록 모음 — 없으면 세운다(이번 달 항목으로 · 이행 기록이 그 항목에 잇는다)
  const months = new Set(recs.filter((x) => !x.rebuild && x.month).map((x) => x.month))
  if (!recordsDoc) months.add(MONTH(localStamp(now)))
  const sum = {
    knowledge: k.id,
    held: recs.filter((x) => x.kind === 'held').length,
    heldCodes: Object.fromEntries([...new Set(recs.flatMap((x) => (x.kind === 'held' || x.kind === 'review' ? x.rows.map((r) => r.code) : [])))].sort().map((c) => [c, recs.reduce((n, x) => n + x.rows.filter((r) => r.code === c).length, 0)])),
    review: recs.filter((x) => x.kind === 'review').length,
    memo: recs.filter((x) => x.kind === 'memo').length,
    memoOff: recs.filter((x) => x.kind === 'memo' && x.status === 'open').length,
    legacy: recs.filter((x) => x.kind === 'legacy').length,
    recordsDoc: !!recordsDoc,
    issueForm: issueForm ? issueForm.name : null,
    rebuild: recs.filter((x) => x.rebuild).length,
  }
  sum.left = sum.held + sum.review + sum.memo + sum.legacy
  sum.ready = !sum.left && sum.recordsDoc
  return { sum, recs, months: [...months].sort(), recordsDoc, issueForm, bad }
}

const heldDirOf = (dir, o) => path.join(o.data ? path.resolve(o.data) : path.join(path.resolve(dir), '..', '.kmd'), 'held', encodeURIComponent(path.basename(path.resolve(dir))))
async function heldFiles(dir, o) {
  try {
    return (await fs.readdir(heldDirOf(dir, o))).filter((f) => /\.(md|bin)$/.test(f)).length
  } catch (e) {
    if (e.code === 'ENOENT') return 0
    throw e
  }
}
async function readPlan(o) {
  if (!o.plan) return {}
  let j
  try {
    const raw = await fs.readFile(o.plan, 'utf8')
    if (raw.length > 1_000_000) throw new Error('1MB 넘음')
    j = JSON.parse(raw)
  } catch (e) {
    throw Object.assign(new Error(`--plan 파일을 읽지 못했다: ${e.message}`), { exit: 2 })
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw Object.assign(new Error('--plan 은 { "<기록 id>": "issue" | "month" | "rebuild" | { do, heading } } 이다'), { exit: 2 })
  if (Object.keys(j).length > 10000) throw Object.assign(new Error('--plan 의 기록이 너무 많다(10000 안)'), { exit: 2 })
  return Object.fromEntries(Object.entries(j).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key)))
}

async function heldScan(dir, o) {
  const k = await load(dir, o)
  const p = heldPlan(k, { plan: await readPlan(o) })
  p.sum.heldFiles = await heldFiles(dir, o)
  if (o.json) return console.log(JSON.stringify({ sum: p.sum, months: p.months, bad: p.bad, recs: p.recs }, null, 1))
  const s = p.sum
  console.log(`# ${k.id} — 이행할 옛 기록 ${s.left}`)
  console.log('\n| 갈래 | 수 |\n|---|---|')
  console.log(`| 넣지 못함 | ${s.held}${Object.keys(s.heldCodes).length ? ` (줄: ${Object.entries(s.heldCodes).map(([c, n]) => `${c} ${n}`).join(' · ')})` : ''} |`)
  console.log(`| 승인 기다림(review) | ${s.review} |`)
  console.log(`| 메모 | ${s.memo}${s.memoOff ? ` (값이 글에 없음 ${s.memoOff})` : ''} |`)
  console.log(`| 개편 전 기록 | ${s.legacy} |`)
  console.log(`| 사람이 고를 것(값이 글에 없음) | ${s.rebuild} |`)
  console.log(`| 넣지 못함 원천 파일(held/) | ${s.heldFiles} |`)
  console.log(`| 기록 모음 문서 | ${s.recordsDoc ? '있음' : '없음(이행이 세운다)'} |`)
  console.log(`| 이슈 갈래 | ${s.issueForm || '없음'} |`)
  console.log(`| 개편 때 | ${(await cutoverOf(path.resolve(dir), o)) || (o.cutover === 'none' ? '없음(--cutover none)' : '모름(held-put 은 --cutover 가 있어야 한다)')} |`)
  const newItems = p.recs.filter((x) => x.issue).length + p.months.filter((m) => !p.recordsDoc?.sections.some((y) => y.h === m)).length
  if (newItems > SECTIONS_MAX || p.recs.length > 600) console.log(`\n- 한 번에 넣기 넘침(새 항목 ${newItems} · 기록 ${p.recs.length}): held-put --limit 으로 나눠 넣는다`)
  if (p.recs.length) {
    console.log('\n| 기록 | 갈래 | 상태 | 할 일 | 넣을 곳 |\n|---|---|---|---|---|')
    for (const x of p.recs) {
      const where = x.rebuild ? '-' : [x.issue ? `이슈 ${x.issue.heading}` : null, ...x.links.map((t) => `${t.doc} › ${t.heading}`), x.month ? `기록 모음 › ${x.month}` : null, ...x.names.map((n) => `이름 ${n.coord}`), ...x.forms.map((f) => `갈래 ${f.name}`)].filter(Boolean).join(' / ')
      const how = x.rebuild ? DO_WORD.rebuild : x.do.map((d) => DO_WORD[d]).join(' · ')
      console.log(`| ${x.id} | ${KIND_WORD[x.kind]}${x.codes.length ? ` (${x.codes.join(' · ')})` : ''} | ${STATUS_WORD[x.status] || '-'}${x.by ? ` · 대신한 기록 ${x.by}` : ''} | ${how} | ${where} |`)
    }
  }
  for (const b of p.bad) console.log(`- 고른 것 오류: ${b}`)
  console.log(s.ready ? '\n= 준비됨: 넣지 못함 · 메모 · 개편 전 기록 0 · 기록 모음 있음. 총괄 관리자가 화면(지식 상세 › 정책 탭 › 저장 승인)으로 승인 저장을 켠다' : `\n= 아직: ${s.rebuild ? `사람이 고를 것 ${s.rebuild}(값을 넣으면 put · record.fixes · 아니면 --plan issue · month) · ` : ''}held-put 으로 옮긴다`)
}

async function gitOut(dir, args) {
  const r = await tryGit(dir, args)
  if (!r.ok) throw Object.assign(new Error(`git ${args[0]} 실패: ${String(r.err || r.out).split('\n')[0]}`), { exit: 1 })
  return r.out.trim()
}

// 이행 기록 글 한도(core/save.js MAX_BODY 200천 자) 안으로 — 넘으면 --limit 으로 나눠 넣는다
const BODY_SOFT = 180_000
async function dropTag(abs, tag) {
  const r = await tryGit(abs, ['tag', '-d', tag])
  if (!r.ok) console.error(`되돌리기 태그 ${tag} 를 지우지 못했다(아무것도 쓰지 않았으니 git tag -d ${tag} 로 지운다): ${String(r.err).split('\n')[0]}`)
}

async function heldPut(dir, o) {
  if (!o.user) throw Object.assign(new Error('--user <사람> 이 있어야 한다(이행 기록을 쓴 사람 · 그 지식의 지식관리자 · 총괄 관리자)'), { exit: 2 })
  const abs = path.resolve(dir)
  // 개편 때 — 서버와 같은 값이어야 개편 전 기록이 같게 갈린다(모르면 쓰지 않는다)
  if (!o.cutover && !(await cutoverFile(abs, o))) throw Object.assign(new Error('개편 때를 모른다. --cutover "YYYY-MM-DD HH:MM"(팀 서버 serve.json 의 cutoverAt · <살림 폴더>/cutover.json 의 값) 또는 개편 때가 없는 서버면 --cutover none'), { exit: 2 })
  const limit = o.limit == null ? null : Number(o.limit)
  if (limit != null && !(Number.isInteger(limit) && limit > 0 && limit <= 10000)) throw Object.assign(new Error('--limit 은 1 ~ 10000 의 수다'), { exit: 2 })
  const plan = await readPlan(o)
  const k0 = await load(abs, o)
  // 안전: 손대지 않은 지식에만 쓴다(커밋하지 않은 바뀜이 있으면 이행 커밋에 섞인다)
  //   지식 폴더 자신의 저장소여야 한다(.git 이 없으면 git 이 바깥 저장소를 제 것으로 센다)
  const head = await headSha(abs)
  if (!head) throw Object.assign(new Error('지식 폴더 자신의 git 저장소가 아니거나 커밋이 없다. 이행하지 않는다'), { exit: 2 })
  const dirty = await gitOut(abs, ['status', '--porcelain'])
  if (dirty) throw Object.assign(new Error(`커밋하지 않은 바뀜이 있다(${dirty.split('\n').length}). 사본을 깨끗하게 받은 뒤 다시 한다: ${dirty.split('\n').slice(0, 3).join(' · ')}`), { exit: 2 })
  const p0 = heldPlan(k0, { plan })
  if (p0.bad.length) throw Object.assign(new Error(`고른 것 오류: ${p0.bad.join(' / ')}`), { exit: 2 })
  const wait = p0.recs.filter((x) => x.rebuild)
  if (wait.length) throw Object.assign(new Error(`사람이 고를 기록 ${wait.length}: ${wait.slice(0, 5).map((x) => x.id).join(' · ')}${wait.length > 5 ? ' …' : ''}. 값을 넣으려면 put(record.fixes 에 그 id)으로 다시 그리고, 아니면 --plan 으로 issue · month 를 고른 뒤 다시 한다(아무것도 쓰지 않았다)`), { exit: 2 })
  // --limit — 오래된 것부터 n 기록만(큰 지식은 몇 번에 나눠 · 커밋도 그만큼)
  const todo = limit ? p0.recs.slice(0, limit) : p0.recs
  if (!todo.length && p0.recordsDoc) return console.log(JSON.stringify({ ok: true, same: true, knowledge: k0.id, why: '할 일 없음(넣지 못함 · 메모 · 개편 전 기록 0 · 기록 모음 있음)', ready: true }, null, 1))
  const names = [...new Map(todo.flatMap((x) => x.names).map((n) => [n.coord, n])).values()]
  const forms = [...new Map(todo.flatMap((x) => x.forms).map((f) => [f.name, f])).values()]
  if (names.length && guardNames(k0.vocab, names).errors.length) throw Object.assign(new Error(`세울 이름 모양이 맞지 않다: ${guardNames(k0.vocab, names).errors.map((e) => e.message).join(' · ')}. --plan 으로 그 기록을 issue · month 로 고른다`), { exit: 2 })
  if (forms.length && !cleanForms(forms)) throw Object.assign(new Error('세울 갈래 모양이 맞지 않다. --plan 으로 그 기록을 issue · month 로 고른다'), { exit: 2 })
  const ids = todo.map((x) => x.id)
  const sig = (p) => JSON.stringify(p.recs.filter((x) => ids.includes(x.id)).map((x) => [x.id, x.do, x.issue?.heading || null, x.issue?.content || null, x.links, x.month, x.names, x.forms]))
  const issues = todo.filter((x) => x.issue).map((x) => x.issue)
  // 달 항목 — 이번에 옮기는 기록의 달 · 기록 모음이 없으면 이번 달(이행 기록이 그 항목에 잇는다)
  const months = [...new Set([...todo.filter((x) => x.month).map((x) => x.month), ...(p0.recordsDoc ? [] : [MONTH(localStamp(new Date()))])])].sort()
  const monthSecs = months.filter((m) => !p0.recordsDoc?.sections.some((s) => s.h === m))
  if (issues.length + monthSecs.length > SECTIONS_MAX) throw Object.assign(new Error(`한 저장에 세울 항목이 ${issues.length + monthSecs.length} 이다(한도 ${SECTIONS_MAX}). --limit 으로 나눠 넣는다`), { exit: 2 })
  const linked = [...new Map([...todo.flatMap((x) => x.links), ...months.filter((m) => !monthSecs.includes(m)).map((m) => ({ doc: RECORDS_DOC_PATH, heading: m }))].map((t) => [itemKey(t.doc, t.heading), t])).values()]
  const line = (x) => `- ${x.id}: ${KIND_WORD[x.kind]}${x.codes.length ? `(${x.codes.join(' · ')})` : ''} · ${STATUS_WORD[x.status]}${x.by ? ` · 대신한 기록 ${x.by}` : ''} · ${[x.issue ? `이슈 항목 ${x.issue.heading}` : null, ...x.links.map((t) => `${t.doc.replace(/^docs\/|\.md$/g, '')} › ${t.heading}`), x.month ? `기록 모음 › ${x.month}` : null, ...x.names.map((n) => `이름 ${n.coord}`), ...x.forms.map((f) => `갈래 ${f.name}`)].filter(Boolean).join(' · ')}`
  const n = (kind) => todo.filter((x) => x.kind === kind).length
  const cut = await cutoverOf(abs, o)
  const rec = {
    title: todo.length ? `이행: 옛 저장 길 기록 ${todo.length} 을 승인 저장 길로` : '이행: 기록 모음 세움',
    body: [
      todo.length ? `옛 저장 길의 기록(넣지 못함 ${n('held')} · 승인 기다림 ${n('review')} · 메모 ${n('memo')} · 개편 전 기록 ${n('legacy')})을 이은 항목 · 기록 모음 달 항목 · 이슈 항목으로 옮겼다. 있던 항목 글은 바꾸지 않았다.` : '이을 항목이 없는 기록이 갈 기록 모음 문서를 세웠다.',
      '',
      '## 바뀐 것',
      `- 옛 저장 길 기록: 이은 항목 · 기록 모음 · 이슈 항목으로 옮김(${todo.length})`,
      ...(issues.length ? [`- 이슈 항목: ${issues.map((x) => x.heading).join(' · ')} 새로 둠`] : []),
      ...(monthSecs.length ? [`- 기록 모음 달 항목: ${monthSecs.join(' · ')} 새로 둠`] : []),
      '',
      '## 까닭',
      '- 승인 저장으로 켜기 전 이행(저장 승인 설계 6-2 · P-D21 · P-D29 · P-D34)',
      '',
      '## 근거',
      `- 개편 때: ${cut || '없음(안 넣은 사람 기록 모두 개편 전)'}${limit ? ` · 나눠 넣기 ${todo.length}/${p0.recs.length}` : ''}`,
      ...todo.map(line),
    ].join('\n'),
    touchesEmpty: '이행: 옛 기록을 이은 항목 · 기록 모음 달 항목 · 이슈 항목으로 옮긴 기록이다',
    ...(todo.length ? { fixes: ids } : {}),
  }
  if (rec.body.length > BODY_SOFT) throw Object.assign(new Error(`이행 기록 글이 너무 길다(${Math.round(rec.body.length / 1000)}천 자). --limit 으로 나눠 넣는다`), { exit: 2 })
  const fresh = [...(p0.recordsDoc ? [] : [{ kind: '문서', name: RECORDS_DOC_PATH }]), ...monthSecs.map((m) => ({ kind: '항목', name: `${RECORDS_DOC_PATH} › ${m}` })), ...issues.map((x) => ({ kind: '항목', name: `${x.doc} › ${x.heading}` })), ...names.map((x) => ({ kind: '이름', name: x.coord })), ...forms.map((x) => ({ kind: '갈래', name: x.name }))]
  const bag = { accepted: [], linked, fresh }
  // 되돌리기 자리 — 쓰기 전 HEAD 에 태그(사본에서: git reset --hard <태그> · 올린 뒤: git revert <커밋>)
  const stamp = localStamp(new Date()).replace(/[- :]/g, '')
  let tag = `kmd-migrate/held-${stamp}`
  for (let i = 2; (await tryGit(abs, ['rev-parse', '-q', '--verify', `refs/tags/${tag}`])).out.trim(); i++) tag = `kmd-migrate/held-${stamp}-${i}`
  await gitOut(abs, ['tag', tag, head])
  let fail = null
  const prepare = async () => {
    // 줄 안 · 새로 읽은 지식으로 다시 짠다 — 그사이 바뀌었으면 아무것도 쓰지 않는다
    const p = heldPlan(await load(abs, o), { plan })
    if (p.bad.length || sig(p) !== sig(p0) || (await gitOut(abs, ['rev-parse', 'HEAD'])) !== head) {
      fail = '그사이 지식이 바뀌었다. held-scan 으로 다시 보고 다시 한다'
      return { abort: { same: false, id: null } }
    }
    return { sections: [...monthSecs.map((m) => ({ doc: RECORDS_DOC_PATH, heading: m, content: RECORDS_MONTH_TEXT })), ...issues.map((x) => ({ doc: x.doc, heading: x.heading, content: x.content }))] }
  }
  let r
  try {
    r = await save(abs, { record: rec, ...(names.length ? { names } : {}), ...(forms.length ? { forms } : {}) }, { user: o.user, guard: 'strict', prepare, approve: bag, migrate: true })
  } catch (e) {
    await dropTag(abs, tag)
    if (['E_INPUT', 'E_FORMAT', 'E_FORBIDDEN', 'E_NOTFOUND', 'E_CONFLICT'].includes(e.code)) e.exit = 2
    throw e
  }
  if (fail || !r?.id) {
    await dropTag(abs, tag)
    throw Object.assign(new Error(`넣지 않았다: ${fail || '저장이 아무것도 쓰지 않았다'}. 아무것도 쓰지 않았다`), { exit: 2 })
  }
  const after = heldPlan(await load(abs, o), {})
  console.log(JSON.stringify({ ok: true, knowledge: k0.id, record: r.id, commit: r.commit || (await gitOut(abs, ['rev-parse', 'HEAD'])), backup: tag, cutover: cut, moved: todo.length, issues: issues.length, months: monthSecs, names: names.length, left: after.sum.left, ready: after.sum.ready }, null, 1))
}

export async function main(argv) {
  const { pos, o } = args(argv)
  const [cmd, dir, a, b] = pos
  if (cmd === 'held-scan' && dir) return heldScan(dir, o)
  if (cmd === 'held-put' && dir) return heldPut(dir, o)
  if (cmd === 'scan' && dir) return scan(dir, o)
  if (cmd === 'trail' && dir && a && b) return trail(dir, a, b, o)
  if (cmd === 'rec' && dir && a) return rec(dir, a, o)
  if (cmd === 'check' && dir && a) return check(dir, a, o)
  if (cmd === 'put' && dir && a) return put(dir, a, o)
  console.error('쓰기: kmd-migrate.mjs scan <지식 폴더> | rec <지식 폴더> <기록 id> | trail <지식 폴더> <docs/x.md> <머리> | check <지식 폴더> <input.json> | put <지식 폴더> <input.json> --user <사람> [--allow-drop] | held-scan <지식 폴더> [--plan plan.json] | held-put <지식 폴더> --user <사람> [--plan plan.json]')
  process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`오류: ${e.code ? `${e.code} ` : ''}${e.message}`)
    process.exitCode = e.exit || 1
  })
}
