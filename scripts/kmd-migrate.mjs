// 지식 옮겨 쓰기(다시 그리기) 도구: 세션 스킬 kmd-migrate(.claude/skills/kmd-migrate)가 부른다.
//   지식 폴더(git)를 손에 쥔 사람이 세션에서 「기록으로 항목을 다시 그리기」 를 할 때, 서비스의 기준(저장 검사 · 값 대조 · 참고 블록 · 기록)을 그대로 지나게 한다.
//   기능(화면 · 길)이 아니다. 서버를 거치지 않고 core 의 저장(core/save.js)과 검사(core/gate.js)를 지식 폴더에 바로 건다.
//
//   node scripts/kmd-migrate.mjs scan  <지식 폴더> [--doc docs/x.md] [--json]          진단: 문서마다 항목 · 기록 없는 항목 · 큰 항목 · 날짜 줄 · 같은 글 · 다시 그릴 만한 항목 · 사건 갈래 문서에 빠진 기록
//   node scripts/kmd-migrate.mjs rec   <지식 폴더> <기록 id> [--json]                         기록 하나: 머리 · 상태 · 건드린 항목 · 넣은 곳 · 본문
//   node scripts/kmd-migrate.mjs trail <지식 폴더> <docs/x.md> <머리> [--json] [--full]  항목 하나: 지금 글 · base · 이어진 기록(오래된 순 · 표시) · 넣은 줄
//   node scripts/kmd-migrate.mjs check <지식 폴더> <input.json>                          마른 검사: 쓰지 않는다 · 값 대조 · 꼴 · 사라지는 표 행 · 문장
//   node scripts/kmd-migrate.mjs put   <지식 폴더> <input.json> --user <사람> [--allow-drop]  넣기: 줄 안에서 다시 검사 → 기록 + 항목 + git 커밋 한 묶음
//   node scripts/kmd-migrate.mjs put   <지식 폴더> <input.json> --user <사람> --format       서식 맞춤: 값은 그대로 · 양식 · 서식만 → 기록이 아니라 이력(log/ · 태그 format)
//   node scripts/kmd-migrate.mjs relog <지식 폴더> --user <사람> (--title <제목 앞> | <기록 id>…) [--dry]  기록으로 남긴 서식 맞춤을 이력으로: log/ 로 옮기고 태그 format · 참고 블록의 그 줄을 걷는다 · 커밋 하나
//   node scripts/kmd-migrate.mjs residue <지식 폴더> [--personal] [--json]              옛 꼴 셈 표(core/oldform.js plan · 쓰지 않는다): 규칙마다 바꿀 셈 · 사람 · 세션이 볼 것
//   node scripts/kmd-migrate.mjs oldform <지식 폴더> --user <사람> [--dry] [--drop <기록 id,… | 파일>] [--personal] [--msg <글>]
//                                                                                      옛 꼴 → 지금 꼴(기계 규칙만 · 다시 읽은 상태가 같아야 쓴다) · 이력 하나 · 커밋 하나
//
//   input.json = { record: { title, body, touches?, tags? }, sections: [{ doc, heading, base, content | contentFile }] }
//     빠진 항목 채우기: sections[] 에 base 대신 new: true · sources: [재료 기록 id] · kind · gist(있는 문서의 없는 머리 · 사건 갈래면 「YYYY-MM-DD 무엇」)
//       새 항목은 종류(kind)와 뜻 한 줄(gist)이 꼭 있다: 엮기가 항목 장부 줄 · 문서 장부 줄을 같이 짓는다(장부 밖 항목을 세우지 않는다)
//   장부만 고치기(항목 없음): sections 를 비우고(또는 빼고) ledger · names · forms · natures 를 싣는다. 서버 화면의 장부 고침과 같은 저장 문(system 걸음 · 이력 log/ · 태그 ledger)
//     ledger: [{ op: 'gist', coord, gist } | { op: 'retire', coord, to?, why? } | { op: 'merge', coord, into, why? } | { op: 'unalias', coord, alias }
//              | { op: 'kind', kind, gist }(종류 뜻 줄) | { op: 'unplace', coord }(문서 장부 줄 걷기) | { op: 'unform', name } | { op: 'unnature', doc }]
//     names 에 이미 장부에 있는 항목을 gist 와 함께 적으면 뜻 한 줄 고치기(gist 걸음)로 바꾼다. record 는 없어도 된다(걸음 목록으로 짓는다) · why 한 줄
//     --format 을 달면 서식 맞춤 이력(태그 format)으로도 남긴다. 값 대조 · 꼴 검사는 없다(항목 글을 바꾸지 않는다)
//     record.body 는 기록 서식(docs/템플릿/기록.md): 「## 바뀐 것」 에 이 항목의 「옛 값 → 새 값」 · 뺀 값은 「옛 값 → (뺌)」 · 까닭 · 근거
//
//   put 은 사라지는 표 행 · 문장이 있으면 넣지 않는다. 사람이 본 뒤 --allow-drop 으로만 넘는다. 값(gate)이 걸리면 늘 넣지 않는다(넣지 못함을 남기지 않는다).
//   저장은 넣지 못함 없이(partial 없음 · 저장승인 P-D25 · P7): 저장 검사(꼴 · 지문 …)에 걸리면 입력 오류로 아무것도 쓰지 않고 종료 코드 2.
//   팀 서버가 돌고 있는 폴더에 바로 쓰면 서버 캐시가 낡는다: 사본에서 쓰고 백업 자리로 올린 뒤 「백업에서 받기」 를 쓴다(스킬 3절).

import { weave } from '../core/weave.js'
import { ledgerOps, upsertVocab, cleanNames } from '../core/namebook.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadKnowledge, coordsOfSection } from '../core/knowledge.js'
import { checkSection } from '../core/gate.js'
import { save } from '../core/save.js'
import { parsePut, parseLinked, itemKey } from '../core/parts.js'
import { parseRefLine, splitRef, withRef, logHas } from '../core/sections.js'
import { parseRecord, renderRecord } from '../core/frontmatter.js'
import { commitPaths } from '../core/git.js'
import { writeAtomic } from '../core/journal.js'
import { LOG_DIR } from '../core/names.js'
import { sha16 } from '../core/text.js'
import { plan as oldPlan, apply as oldApply, verifyPlan, RULES as OLD_RULES, RULE_SAY } from '../core/oldform.js'

const DERIVED = ['polish', 'rebuild', 'intake']
const DATE_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*)?(\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{1,2}\/\d{1,2}|\d{1,2}월 \d{1,2}일)/
const isTable = (l) => /^\s*\|/.test(l)

function args(argv) {
  const pos = []
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (['json', 'full', 'allow-drop', 'format', 'dry', 'personal'].includes(key)) o[key] = true
      else o[key] = argv[++i]
    } else pos.push(a)
  }
  return { pos, o }
}

async function load(dir, o) {
  const abs = path.resolve(dir)
  try {
    await fs.access(path.join(abs, 'docs'))
  } catch {
    throw new Error(`지식 폴더가 아니다(docs/ 가 없다): ${abs}`)
  }
  return loadKnowledge({ id: path.basename(abs), name: path.basename(abs), dir: abs })
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

// 항목 하나에 이어진 기록: 건드린 항목(touches → 장부) · 넣은 것 줄 · 항목 표지 · 참고 줄 · 문서 단위 참고 줄
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
    // 글 그대로 이은 기록(승인 저장 · 「## 이은 항목」): 경위다(값은 글에 없다)
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
    if (k.superseded.has(id) || k.reverted.has(id) || k.revertedItems.get(id)?.has(key)) continue
    const mark = []
    if (w.tags.some((t) => DERIVED.includes(t))) mark.push('derived')
    const scope = how.size === 1 && how.has('doc') ? 'doc' : 'item'
    out.push({ id, kind: k.logs.includes(w) ? 'log' : 'work', date: w.date, title: w.title, author: w.author || null, state: w.state || null, tags: w.tags, how: [...how], scope, mark, put: parsePut(w.body).filter((r) => r.doc === doc.path && r.heading === sec.h).map((r) => ({ from: r.from, to: r.to, isNew: r.isNew })), body: w.body })
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  return out
}
// 재료가 되는 기록: 문서 단위 줄만 있는 기록은 셈에서 뺀다
const sourceOf = (links) => links.filter((x) => x.scope === 'item')

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
      items.push({ doc: d.path, heading: s.h, lines: lines.length, chars: s.body.length, links: src.length, derived: src.filter((x) => x.mark.includes('derived')).length, diary })
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
  console.log('\n## 이어진 기록이 많은 항목(20)\n| 문서 › 머리 | 기록 | 파생 | 줄 | 같은 글 |\n|---|---|---|---|---|')
  for (const x of top) console.log(`| ${x.doc} › ${x.heading} | ${x.links} | ${x.derived} | ${x.lines} | ${x.dup ? 'O' : ''} |`)
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

// 사건 갈래(회의록 · 장애 대응 · 주간보고 …) 문서에 항목이 없는 사건 기록: 후보다(이름 · 태그로 고른다 · 사람이 가른다)
//   후보: 제목 · id · 태그에 갈래 이름이나 별칭이 든 기록(옛 표지 · 바로잡힘 · kmd 의 일 뺌)
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
      .filter((w) => hit(w) && w.state !== 'fixed' && !k.superseded.has(w.id))
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
  console.log(`# ${w.id}\n제목: ${w.title}\n때: ${w.date} · 쓴 사람: ${w.author || '-'} · 상태: ${w.state || 'log'}\n태그: ${w.tags.join(' · ') || '-'}\n건드린 항목: ${w.touches.join(' · ') || '-'}${put.length ? `\n넣은 곳: ${put.map((p) => `${p.doc} › ${p.heading}`).join(' / ')}` : ''}\n\n${w.body}`)
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
  console.log(`# ${d.path} › ${s.h}\nbase: ${out.base}\n장부 항목: ${out.coords.join(' · ') || '(없음)'}\n이어진 기록: ${links.length}(재료 ${sourceOf(links).length})\n\n## 지금 글\n${s.body}\n`)
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

const LEDGER_OPS = ['gist', 'retire', 'merge', 'unalias', 'kind', 'unplace', 'unform', 'unnature']
const ledgerOnly = (j) => (!Array.isArray(j.sections) || !j.sections.length) && ['ledger', 'names', 'forms', 'natures'].some((x) => Array.isArray(j[x]) && j[x].length)
async function readInput(file) {
  const base = path.dirname(path.resolve(file))
  const j = JSON.parse(await fs.readFile(file, 'utf8'))
  if (j.ledger != null) {
    if (!Array.isArray(j.ledger) || j.ledger.length > 200 || j.ledger.some((x) => !x || typeof x !== 'object' || !LEDGER_OPS.includes(x.op))) throw new Error(`input.ledger 는 { op: ${LEDGER_OPS.join(' | ')}, … } 의 목록이다(200 안)`)
    if (Array.isArray(j.sections) && j.sections.length) throw new Error('ledger 는 장부만 고치는 저장에서 싣는다(sections 를 비운다 · 항목 글은 따로 put)')
  }
  if (ledgerOnly(j)) {
    if (j.record != null && (typeof j.record.title !== 'string' || typeof j.record.body !== 'string')) throw new Error('input.record 에 title · body 가 있어야 한다(장부만 고칠 때는 빼도 된다)')
    j.sections = []
    return j
  }
  if (!j.record || typeof j.record.title !== 'string' || typeof j.record.body !== 'string') throw new Error('input.record 에 title · body 가 있어야 한다')
  if (!Array.isArray(j.sections) || !j.sections.length) throw new Error('input.sections 는 항목 하나 이상의 목록이다(장부만 고칠 때는 ledger · names · forms · natures)')
  for (const s of j.sections) {
    if (s.contentFile && s.content == null) s.content = await fs.readFile(path.resolve(base, s.contentFile), 'utf8')
    delete s.contentFile
    if (typeof s.doc !== 'string' || typeof s.heading !== 'string' || typeof s.content !== 'string') throw new Error('sections[] 마다 doc · heading · content(또는 contentFile) 가 있어야 한다')
    s.content = s.content.replace(/\r\n/g, '\n').trim()
  }
  return j
}

// 항목마다 검사: gate(꼴 · base · 값 대조) + 사라지는 표 행 · 문장
function inspect(k, input) {
  const spread = input.sections.length > 1
  return input.sections.map((s) => {
    let d = k.byDocPath.get(s.doc)
    const sec = d?.sections.find((x) => x.h === s.heading) || null
    const no = (why) => ({ doc: s.doc, heading: s.heading, ok: false, why, lostRows: [], lostLines: [] })
    // 갈래 문서가 아직 없으면: 빠진 항목 채우기(new)만 그 갈래 문서를 세운다(갈래 장부의 폴더 · 이름 그대로 · 저장의 새 문서 G4 가 # 이름을 단다)
    if (!d && s.new && formOfDoc(k, { path: s.doc })) d = { path: s.doc, sections: [], fresh: true }
    if (!d) return no('문서가 없다(새 문서는 갈래 장부에 있는 갈래 문서를 그 폴더 · 이름으로 · new 항목으로만 세운다)')
    if (s.new) return inspectNew(k, input, s, d, sec, spread)
    if (!sec) return no('머리가 없다(있는 항목만 다시 그린다 · 빠진 항목을 채우려면 new: true 와 sources)')
    const links = linksOf(k, d, sec)
    const r = checkSection(k, { doc: s.doc, heading: s.heading, base: s.base, content: s.content, record: input.record, spread })
    const drop = dropsOf(sec.body, s.content)
    return { doc: s.doc, heading: s.heading, ok: !!r.ok, code: r.code || null, why: r.why || null, changed: r.changed || [], lint: r.lint || null, lostRows: drop.rows, lostLines: drop.lines, sources: sourceOf(links).length }
  })
}

// 빠진 항목 채우기(new): 있는 문서에 없는 머리 · 재료 기록(sources)이 값의 근거다.
//   재료 기록 본문은 검사에만 「## 근거」 아래로 내려 싣는다(그 기록의 「바뀐 것」 이 이 항목의 요구 값이 되지 않게 · 지어낸 값은 잡히게)
//   사건 갈래 문서(회의록 · 장애 대응 …)의 머리는 「YYYY-MM-DD 무엇」
function inspectNew(k, input, s, d, sec, spread) {
  const no = (why) => ({ doc: s.doc, heading: s.heading, ok: false, why, lostRows: [], lostLines: [] })
  if (sec) return no('이미 있는 머리다(있는 항목은 new 없이 base 와 함께 다시 그린다)')
  if (!/\S/.test(s.heading) || /[\r\n]/.test(s.heading) || s.heading.length > 120) return no('머리는 한 줄 · 120자 안')
  if (formOfDoc(k, d)?.kind === '사건' && !/^\d{4}-\d{2}-\d{2} \S/.test(s.heading)) return no('사건 갈래 문서의 머리는 「YYYY-MM-DD 무엇」')
  if (typeof s.kind !== 'string' || !s.kind.trim() || typeof s.gist !== 'string' || !s.gist.trim()) return no('새 항목은 종류(kind)와 뜻 한 줄(gist)을 적는다(엮기가 장부 줄을 같이 짓는다 · 장부 밖 항목을 세우지 않는다)')
  const ids = Array.isArray(s.sources) ? s.sources : []
  if (!ids.length) return no('sources(재료 기록 id)가 있어야 한다')
  const ws = []
  for (const id of ids) {
    const w = k.byWork.get(String(id))
    if (!w) return no(`없는 기록: ${id}`)
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

// 장부만 고치기: names 의 「있는 항목 + gist」 는 뜻 한 줄 걸음으로 바꾸고, 저장 문과 같은 차례(names 더하기 → 걸음)로 마른 계산한다
function ledgerSplit(k, input) {
  const ledger = [...(Array.isArray(input.ledger) ? input.ledger : [])]
  const names = []
  for (const n of Array.isArray(input.names) ? input.names : []) {
    const c = typeof n?.coord === 'string' ? n.coord.trim().normalize('NFC') : ''
    if (c && k.vocab.coords.has(c) && typeof n.gist === 'string' && n.gist.trim()) {
      ledger.push({ op: 'gist', coord: c, gist: n.gist })
      const { gist: _g, ...rest } = n
      if ((rest.aliases || []).length || rest.doc || rest.heading) names.push(rest)
    } else names.push(n)
  }
  return { ledger, names }
}
const LEDGER_DROP = ['unplace', 'unform', 'unnature']
const vocabText = (dir) => fs.readFile(path.join(path.resolve(dir), '_vocab.md'), 'utf8').then((t) => t.replace(/\r\n/g, '\n'), (e) => (e.code === 'ENOENT' ? '' : Promise.reject(e)))
function ledgerOf(k, input, voc) {
  const { ledger, names } = ledgerSplit(k, input)
  const clean = cleanNames(names)
  const lo = ledgerOps(clean?.length ? upsertVocab(voc, clean) : voc, ledger.filter((x) => !LEDGER_DROP.includes(x.op)))
  const errors = [...lo.errors, ...(clean ? [] : ['names 모양이 아니다({ coord: "종류:값", label, aliases?, doc?, heading?, gist? })'])]
  const done = [
    ...(clean || []).map((n) => `${k.vocab.coords.has(n.coord) ? '장부 고침' : '새 항목'}: ${n.coord}`),
    ...lo.done,
    ...ledger.filter((x) => LEDGER_DROP.includes(x.op)).map((x) => `걷기(${x.op}): ${x.coord || x.name || x.doc}`),
    ...(Array.isArray(input.forms) ? input.forms : []).map((f) => `갈래: ${f?.name}`),
    ...(Array.isArray(input.natures) ? input.natures : []).map((n) => `문서 성격: ${n?.doc}`),
  ]
  return { ledger, names, done, errors }
}
async function putLedger(abs, input, o) {
  const k = await load(abs, o)
  const l = ledgerOf(k, input, await vocabText(abs))
  if (l.errors.length) {
    for (const e of l.errors.slice(0, 10)) console.error(`✗ ${e}`)
    throw Object.assign(new Error('넣지 않았다: 장부 걸음에 걸렸다. 아무것도 쓰지 않았다'), { exit: 2 })
  }
  const why = String(input.why || '').replace(/\s+/g, ' ').trim().slice(0, 200)
  const r0 = input.record || { title: `장부 고침: ${l.done[0] || '-'}${l.done.length > 1 ? ` 밖에 ${l.done.length - 1}` : ''}`.slice(0, 200), body: `${l.done.map((x) => `- ${x}`).join('\n')}${why ? `\n\n까닭: ${why}` : ''}` }
  const record = { ...r0, tags: [...new Set([...(Array.isArray(r0.tags) ? r0.tags : []), 'ledger', ...(o.format ? ['format'] : [])])] }
  let r
  try {
    // 서버 화면의 장부 고침(hub.ledgerEdit)과 같은 저장 문: system 걸음 · 항목 글 없음 · 이력(log/)
    r = await save(abs, { record, sections: [], ledger: l.ledger, ...(l.names.length ? { names: l.names } : {}), ...(Array.isArray(input.forms) ? { forms: input.forms } : {}), ...(Array.isArray(input.natures) ? { natures: input.natures } : {}) }, { user: o.user, system: true })
  } catch (e) {
    if (['E_INPUT', 'E_FORMAT', 'E_FORBIDDEN', 'E_NOTFOUND', 'E_CONFLICT'].includes(e.code)) e.exit = 2
    throw e
  }
  console.log(JSON.stringify({ ok: true, record: r.id || r.record || null, commit: r.commit || null, done: l.done }, null, 1))
}

// 사건 문서의 날짜 자리: 새 머리의 날짜보다 늦은 첫 항목(그 앞에 끼운다) · 없으면 끝(null)
//   같은 날짜는 뒤에 · 날짜 없는 머리는 건너뛴다
const dayOf = (h) => (String(h).match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null
export function dateSlot(d, heading) {
  const day = dayOf(heading)
  if (!day) return null
  return d.sections.find((x) => dayOf(x.h) && dayOf(x.h) > day)?.h || null
}
// 사건 문서의 차례 어긋남: 앞 항목보다 이른 날짜의 항목 수
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
  if (!input.sections.length) {
    const l = ledgerOf(k, input, await vocabText(dir))
    if (o.json) return console.log(JSON.stringify(l, null, 1))
    for (const x of l.done) console.log(`- ${x}`)
    for (const e of l.errors) console.log(`✗ ${e}`)
    console.log(`\n= 장부 걸음 ${l.done.length} · 걸림 ${l.errors.length}${l.errors.length ? ': 걸린 까닭을 고쳐 다시 check' : ': put 으로 넣을 수 있다(이력 · 태그 ledger)'}`)
    process.exitCode = l.errors.length ? 2 : 0
    return
  }
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
  if (!input.sections.length) return putLedger(abs, input, o)
  // save 에 넘기는 기록 그 자체: prepare 가 건드린 항목(touches)을 채운다
  //   서식 맞춤(--format)은 다시 그리기가 아니다: rebuild 를 달지 않고 저장 문이 format(이력)을 단다
  const rec = { ...input.record, tags: [...new Set([...(Array.isArray(input.record.tags) ? input.record.tags : []), ...(o.format ? [] : ['rebuild'])])] }
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
    // 건드린 항목: 넣는 항목들의 장부 항목(기록이 이 항목들에 이어지게)
    if (!rec.touches?.length) {
      const coords = [...new Set(input.sections.flatMap((s) => { const d = k.byDocPath.get(s.doc); return d ? coordsOfSection(k, d, s.heading) : [] }))]
      if (coords.length) rec.touches = coords
      else rec.touchesEmpty = rec.touchesEmpty || (o.format ? '서식 맞춤: 이 항목이 장부에 없다' : '다시 그리기: 이 항목이 장부에 없다')
    }
    return { sections: input.sections.map((s) => ({ doc: s.doc, heading: s.heading, content: s.content, base: s.base, ...(s.new && s.before ? { before: s.before } : {}) })) }
  }
  // 짝 짓기(지식 생성 하네스 H6 · H2 의 엮기): 새 항목(new)에 종류(kind) · 뜻 한 줄(gist)을 적었으면 화면 · 세션의 저장과 같은 엮기가
  //   항목 장부 줄(뜻 한 줄) · 문서 장부 줄을 같이 짓는다. 새 문서(docs[{ path, nature, summary }])의 문서 성격 줄 · 모으는 갈래 줄도 같다.
  //   새 항목은 kind · gist 가 꼭 있다(inspectNew). 엮기 오류가 있으면 아무것도 쓰지 않는다
  let woven = {}
  const lines = input.sections.filter((s) => s.new).map((s) => ({ doc: s.doc, heading: s.heading, act: 'new', kind: s.kind, kindGist: s.kindGist, id: s.id, gist: s.gist, aliases: s.aliases, nature: s.nature }))
  if (lines.length || (Array.isArray(input.docs) && input.docs.length)) {
    const w = weave(await load(abs, o), { lines, docs: Array.isArray(input.docs) ? input.docs : [] })
    if (w.errors.length) {
      for (const e of w.errors.slice(0, 10)) console.error(`✗ 엮기 ${e.at}: ${e.why}`)
      throw Object.assign(new Error('넣지 않았다: 엮기에 걸렸다. 아무것도 쓰지 않았다'), { exit: 2 })
    }
    woven = { ...(w.names.length ? { names: [...(Array.isArray(input.names) ? input.names : []), ...w.names] } : {}), ...(w.natures.length ? { natures: w.natures } : {}), ...(w.forms.length ? { forms: [...(Array.isArray(input.forms) ? input.forms : []), ...w.forms] } : {}) }
    if (w.names.length && !rec.touches?.length) rec.touches = w.touches
  }
  let r
  try {
    const { docs: _docs, ...rest } = input
    r = await save(abs, { ...rest, ...woven, record: rec }, { user: o.user, prepare, marks: true, format: !!o.format })
  } catch (e) {
    // 저장 검사에 걸림: 입력 오류(아무것도 쓰지 않았다 · 넣지 못함을 남기지 않는다 · 종료 코드 2)
    if (['E_INPUT', 'E_FORMAT', 'E_FORBIDDEN', 'E_NOTFOUND', 'E_CONFLICT'].includes(e.code)) e.exit = 2
    throw e
  }
  if (fail) {
    show(fail.rs)
    throw Object.assign(new Error(`넣지 않았다: ${fail.why}. 아무것도 쓰지 않았다`), { exit: 2 })
  }
  console.log(JSON.stringify({ ok: true, record: r.id || r.record || null, commit: r.commit || null }, null, 1))
}

// 기록 → 이력(작성기준 「기록과 이력」): 지식은 그대로 두고 양식 · 서식만 바꾼 일을 기록(work/)으로 남겼을 때.
//   기록 파일을 log/ 로(머리 · 본문 그대로 · 태그 format 더함) · 문서마다 참고 블록에서 그 기록 줄을 걷는다(splitRef · withRef) · 커밋 하나.
//   applied 표지는 그대로 둔다(이력 id 를 가리켜도 기록 파일을 work/ · log/ 둘 다에서 찾는다 · 다듬기와 같다). 사본에서 쓰고 서버는 앞으로만 받는다(스킬 3절)
async function relog(dir, ids, o) {
  if (!o.user) throw new Error('--user <사람> 이 있어야 한다')
  const abs = path.resolve(dir)
  const k = await load(abs, o)
  const pick = k.works.filter((w) => (ids.length ? ids.includes(w.id) : o.title && w.title.startsWith(o.title)))
  if (ids.length && pick.length !== ids.length) throw new Error(`기록에 없는 id: ${ids.filter((x) => !pick.some((w) => w.id === x)).join(' · ')}`)
  if (!pick.length) throw new Error('옮길 기록이 없다(--title <제목 앞> 또는 기록 id)')
  // 다른 기록이 근거로 가리키는 기록은 옮기지 않는다(그 기록의 지식 이야기가 끊긴다)
  const cited = pick.filter((w) => k.works.some((x) => !pick.includes(x) && (x.body.includes(`/${w.id}.md`) || (x.fixes || []).includes(w.id))))
  if (cited.length) throw new Error(`다른 기록이 가리키는 기록이다: ${cited.map((w) => w.id).join(' · ')}`)
  const paths = []
  const docsChanged = []
  const idSet = pick.map((w) => w.id)
  for (const d of k.docs) {
    const full = path.join(abs, ...d.path.split('/'))
    const text = await fs.readFile(full, 'utf8')
    const { lines, ref, found } = splitRef(text.split('\n'))
    if (!found) continue
    let n = 0
    for (const [key, ls] of ref) {
      const keep = ls.filter((l) => !idSet.some((id) => logHas([l], id)))
      n += ls.length - keep.length
      if (keep.length !== ls.length) keep.length ? ref.set(key, keep) : ref.delete(key)
    }
    if (!n) continue
    // 지운 기록 줄 뒤에 남은 「- 머리」 줄(아래 줄 없음)은 withRef 가 쓰지 않는다
    docsChanged.push({ rel: d.path, n, next: withRef(lines, ref) })
  }
  console.log(`옮길 기록 ${pick.length} · 참고 줄을 걷을 문서 ${docsChanged.length}(줄 ${docsChanged.reduce((a, x) => a + x.n, 0)})`)
  for (const x of docsChanged) console.log(`  ${x.rel}: ${x.n}`)
  if (o.dry) return
  await fs.mkdir(path.join(abs, LOG_DIR), { recursive: true })
  for (const w of pick) {
    const from = path.join(abs, 'work', `${w.id}.md`)
    const to = path.join(abs, LOG_DIR, `${w.id}.md`)
    const r = parseRecord(await fs.readFile(from, 'utf8'), `${w.id}.md`)
    if (!r) throw new Error(`기록을 읽지 못했다: ${w.id}`)
    try { await fs.access(to); throw new Error(`이력에 같은 id 가 있다: ${w.id}`) } catch (e) { if (e.code !== 'ENOENT') throw e }
    const rec = { ...r, tags: [...new Set([...(r.tags || []).filter((x) => x !== 'rebuild'), 'format'])] }
    await writeAtomic(to, renderRecord(rec, r.body))
    await fs.unlink(from)
    paths.push(`work/${w.id}.md`, `${LOG_DIR}/${w.id}.md`)
  }
  for (const x of docsChanged) {
    await writeAtomic(path.join(abs, ...x.rel.split('/')), x.next)
    paths.push(x.rel)
  }
  const commit = await commitPaths(abs, paths, `이력으로 옮김: 서식 맞춤 ${pick.length}(기록이 아니라 이력 · 참고 줄 ${docsChanged.reduce((a, x) => a + x.n, 0)} 걷음)`, o.user)
  console.log(JSON.stringify({ ok: true, moved: pick.length, docs: docsChanged.length, commit }, null, 1))
}

// 옛 꼴(core/oldform.js): 셈 표 · 사람 · 세션이 볼 것
const oldTable = (p) => {
  const rows = OLD_RULES.map((r) => ({ r, w: p.changes.filter((c) => c.rule === r && c.kind === 'write').length, d: p.changes.filter((c) => c.rule === r && c.kind === 'delete').length, n: p.counts[r] || 0 }))
  return ['| 규칙 | 뜻 | 고칠 파일 | 지울 파일 | 셈 |', '|---|---|---|---|---|', ...rows.map((x) => `| ${x.r} | ${RULE_SAY[x.r]} | ${x.w || '-'} | ${x.d || '-'} | ${x.n || '-'} |`)].join('\n')
}
const judgeLines = (p) => (p.judge.length ? p.judge.map((j) => `- ${j.what}: ${j.count}${j.where ? ` · ${String(j.where).slice(0, 160)}` : ''}${j.why ? `\n  ${String(j.why).slice(0, 800)}` : ''}`).join('\n') : '- 없음')
// --drop: 기록 id 를 쉼표 · 빈칸으로, 또는 한 줄에 하나씩 적은 파일(# 줄은 설명)
async function readDrop(v) {
  if (!v) return []
  const file = await fs.readFile(path.resolve(v), 'utf8').catch(() => null)
  const lines = String(file ?? v).split(/\r?\n/).filter((l) => !l.trim().startsWith('#'))
  return lines.join(' ').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)
}
async function residue(dir, o) {
  await load(dir, o)
  const p = await oldPlan(path.resolve(dir), { personal: !!o.personal })
  if (o.json) return console.log(JSON.stringify({ counts: p.counts, judge: p.judge, files: new Set(p.changes.map((c) => c.path)).size, gone: p.gone.length }, null, 1))
  console.log(`# ${path.basename(path.resolve(dir))} · 옛 꼴 셈(쓰지 않았다)\n\n${oldTable(p)}\n\n지울 기록 · 이력 ${p.gone.length} · 고칠 · 지울 파일 ${new Set(p.changes.map((c) => c.path)).size}\n\n## 사람 · 세션이 볼 것\n${judgeLines(p)}`)
}
async function oldform(dir, o) {
  if (!o.user) throw new Error('--user <사람> 이 있어야 한다(이력을 쓴 사람 · 그 지식의 지식관리자)')
  await load(dir, o)
  const abs = path.resolve(dir)
  const p = await oldPlan(abs, { personal: !!o.personal, drop: await readDrop(o.drop) })
  console.log(`# ${path.basename(abs)} · 옛 꼴 옮김${o.dry ? '(마른 · 쓰지 않는다)' : ''}\n\n${oldTable(p)}`)
  const byRule = new Map()
  for (const c of p.changes) {
    if (!byRule.has(c.rule)) byRule.set(c.rule, [])
    byRule.get(c.rule).push(c)
  }
  for (const [r, cs] of byRule) {
    console.log(`\n## ${r} · ${RULE_SAY[r]} (${cs.length})`)
    for (const c of cs.slice(0, o.full ? cs.length : 12)) console.log(`- ${c.kind === 'delete' ? '지움' : '고침'} ${c.path}: ${c.why}`)
    if (!o.full && cs.length > 12) console.log(`- 그 밖 ${cs.length - 12}(--full)`)
  }
  console.log(`\n## 사람 · 세션이 볼 것(쓰지 않는다)\n${judgeLines(p)}`)
  const v = await verifyPlan(abs, p)
  console.log(`\n## 대 보기(옮긴 뒤 지금 코드로 다시 읽기)\n${v.ok ? '- 같다: 기록 상태 · 항목 장부 · 문서 장부 자리 · 갈래 장부 · 사람 장부 · 문서 본문' : v.why.slice(0, 30).map((x) => `- 다르다: ${x}`).join('\n')}`)
  if (o.dry) return
  if (!p.changes.length) return console.log('\n바꿀 것이 없다')
  if (!v.ok) throw Object.assign(new Error('쓰지 않았다: 다시 읽은 것이 앞과 다르다'), { exit: 2 })
  const r = await oldApply(abs, p, { user: o.user, msg: o.msg || null, personal: !!o.personal })
  console.log(JSON.stringify({ ok: true, commit: r.commit, log: r.log, files: r.files }, null, 1))
}

export async function main(argv) {
  const { pos, o } = args(argv)
  const [cmd, dir, a, b] = pos
  if (cmd === 'rules') { const { genRulesBlock } = await import('../core/genrules.js'); console.log(genRulesBlock({ profile: 'migrate' })); return }
  if (cmd === 'scan' && dir) return scan(dir, o)
  if (cmd === 'trail' && dir && a && b) return trail(dir, a, b, o)
  if (cmd === 'rec' && dir && a) return rec(dir, a, o)
  if (cmd === 'check' && dir && a) return check(dir, a, o)
  if (cmd === 'put' && dir && a) return put(dir, a, o)
  if (cmd === 'relog' && dir) return relog(dir, pos.slice(2), o)
  if (cmd === 'residue' && dir) return residue(dir, o)
  if (cmd === 'oldform' && dir) return oldform(dir, o)
  console.error('쓰기: kmd-migrate.mjs scan <지식 폴더> | rec <지식 폴더> <기록 id> | trail <지식 폴더> <docs/x.md> <머리> | check <지식 폴더> <input.json> | put <지식 폴더> <input.json> --user <사람> [--allow-drop] [--format] | relog <지식 폴더> --user <사람> (--title <제목 앞> | <기록 id>…) [--dry] | residue <지식 폴더> [--personal] [--json] | oldform <지식 폴더> --user <사람> [--dry] [--drop <기록 id,… | 파일>] [--personal]')
  process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`오류: ${e.code ? `${e.code} ` : ''}${e.message}`)
    process.exitCode = e.exit || 1
  })
}
