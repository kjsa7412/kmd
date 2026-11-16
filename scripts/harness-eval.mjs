#!/usr/bin/env node
// 지식 생성 하네스 평가 시험(골든 셋) — docs/품질개선/KMD_지식생성_하네스_설계.md 9-3 · TODO H0.
//
//   빈 지식에 원천 열다섯(test/fixture/harness/빈지식/)을 차례로 넣고, 선 지식을 정답 묶음(gold.json)과 견준다.
//   채점은 글자 일치가 아니라 묶음 동치다(같은 대상의 알갱이가 같은 항목에 모였나 · 쌍 단위).
//   실제 Claude 를 부른다(돈이 든다) — 사람이 돌린다. 제품 지식 · 188 에는 쓰지 않는다: 쓰는 곳은 .kmd-data/harness-eval/ 뿐이다.
//
//   node scripts/harness-eval.mjs run   --order 설계서먼저|회의록먼저 [--tag 바탕] [--mode oneshot] [--only 1,2,…] [--budget 1]
//   node scripts/harness-eval.mjs score <지식 폴더> [--log <run.json>]     이미 선 지식만 채점한다(Claude 없이)
//   node scripts/harness-eval.mjs plan                                      원천 수 · 차례만 보인다(Claude 없이)
//   node scripts/harness-eval.mjs recall <지식 폴더> [--n 300]              과거 결정 카드의 recall(Claude 없이 · 읽기만): 기록의 글로 카드를 지어
//                                                                           그 기록이 건드린 항목이 카드에 실리나(설계 9-3 판례 recall · 문턱 0.9)
//
//   --mode oneshot  지금 프롬프트(단발 claude -p · 도구 0 · INTAKE_SCHEMA): server/hub.js 의 무인 들이기와 같은 걸음을 core 함수로 밟는다
//                   (재료 → 초안 → draftToSave → 무인 판정 → 고쳐 받기 두 번 → 규칙 길).
//   --mode session  세션 방식(H4a · H-D34): 임시 팀 서버를 띄우고 원천마다 들이기 일감을 열어 팀 일꾼(workOnce)이 Claude Code 세션을 띄운다.
//                   세션은 그 서버의 MCP 에 단기 열쇠로 붙어 스스로 찾고 저장한다(system 글에 생성 룰 긴 판).
//   결과: .kmd-data/harness-eval/<날짜>-<판>.json · 지식은 .kmd-data/harness-eval/kn/<판>/
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadKnowledge, sectionOf } from '../core/knowledge.js'
import { formFor, RECORDS_DOC_PATH, RECORDS_INTRO, RECORDS_MONTH_TEXT, INTAKE_FORM } from '../core/guard.js'
import { kindOf } from '../core/forms.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIX_DIR = path.join(ROOT, 'test/fixture/harness/빈지식')
const OUT_DIR = path.join(ROOT, '.kmd-data/harness-eval')

// ───────── 채점(Claude 없이 · test/harness-eval.test.mjs 가 건다) ─────────
const re = (s, f = 'i') => new RegExp(s, f)
const docName = (p) => String(p).replace(/^docs\/|\.md$/g, '')
// 지식의 항목 전부 — 기록 모음의 달 항목은 뺀다 · 규칙 길 문서(들인 자료/)는 raw 로 표시한다
export function itemsOf(k) {
  const out = []
  for (const d of k.docs) {
    if (d.path === RECORDS_DOC_PATH) continue
    for (const s of d.sections) if (s.h) out.push({ doc: docName(d.path), h: s.h, body: s.body, raw: docName(d.path).startsWith(`${INTAKE_FORM}/`) })
  }
  return out
}
// 항목 → 정답 대상(먼저 맞는 것 하나)
function targetOf(gold, it) {
  for (const t of gold.targets) {
    if (!re(t.h).test(it.h)) continue
    if (t.doc && !re(t.doc).test(it.doc)) continue
    if (t.notDoc && re(t.notDoc).test(it.doc)) continue
    if (t.notH && re(t.notH).test(it.h)) continue
    if (t.needDocOrH && !re(t.needDocOrH).test(`${it.doc} ${it.h}`)) continue
    return t.id
  }
  return null
}
// 문서의 성격 — 문서 성격 줄(H2 부터) · 갈래 장부 · 이름 짐작 차례
function natureOf(k, doc) {
  const own = k.natures?.get?.(`docs/${doc}.md`) || k.natures?.get?.(doc)
  if (own) return own.nature || own
  return kindOf(k.forms?.own ? k.forms : null, doc).kind
}
export function scoreKnowledge(k, gold) {
  const items = itemsOf(k).map((it) => ({ ...it, key: `${it.doc} › ${it.h}`, target: targetOf(gold, it) }))
  const byT = new Map(gold.targets.map((t) => [t.id, []]))
  for (const it of items) if (it.target) byT.get(it.target).push(it)
  const must = gold.targets.filter((t) => !t.optional)
  const missing = must.filter((t) => !byT.get(t.id).length).map((t) => t.id)
  const dup = gold.targets.filter((t) => !t.one && byT.get(t.id).length > 1).map((t) => `${t.id}(${byT.get(t.id).length})`)
  const stood = gold.targets.filter((t) => byT.get(t.id).length)
  const extra = items.filter((it) => !it.target).map((it) => it.key)
  const nonItems = items.filter((it) => gold.nonItems.some((p) => re(p).test(it.h))).map((it) => it.key)
  // 성격 — 선 대상의 문서 성격이 정답과 같은가
  const natureRows = stood.map((t) => ({ id: t.id, want: t.nature, got: natureOf(k, byT.get(t.id)[0].doc) }))
  const natureOk = natureRows.filter((x) => x.got === x.want).length
  // 알갱이 — 어느 항목에 들었나(정답 대상의 항목을 먼저 본다)
  const facts = gold.facts.map((f) => {
    const hit = items.filter((it) => re(f.re).test(it.body))
    const best = hit.find((it) => it.target === f.target) || hit.find((it) => f.alt && it.target === f.alt) || hit[0] || null
    const goldC = best && f.alt && best.target === f.alt ? f.alt : f.target
    return { id: f.id, gold: goldC, at: best ? best.key : null, target: best ? best.target : null, placed: !!best && (best.target === f.target || (!!f.alt && best.target === f.alt)), raw: !!best?.raw }
  })
  // 묶음 동치 — 알갱이 쌍마다: 정답에서 같은 대상인가 · 지식에서 같은 항목인가
  let tp = 0, fp = 0, fn = 0
  for (let i = 0; i < facts.length; i++) for (let j = i + 1; j < facts.length; j++) {
    const g = facts[i].gold === facts[j].gold
    const p = !!facts[i].at && facts[i].at === facts[j].at
    if (g && p) tp++
    else if (!g && p) fp++
    else if (g && !p) fn++
  }
  const prec = tp + fp ? tp / (tp + fp) : 1
  const rec = tp + fn ? tp / (tp + fn) : 1
  const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0
  // 지금 값 — 그 대상(또는 alt)의 항목 글에 정답 값이 있고 옛 값이 지금 값으로 남지 않았나
  const values = gold.values.map((v) => {
    const its = [...(byT.get(v.target) || []), ...(v.alt ? byT.get(v.alt) || [] : [])]
    const text = its.map((it) => it.body).join('\n')
    const has = re(v.re).test(text)
    const stale = !!v.absent && re(v.absent, 'im').test(text)
    return { id: v.id, ok: has && !stale, has, stale }
  })
  // 짝 — 항목 가운데 항목 장부 줄이 그 자리를 가리키는 비율
  const reached = new Set()
  for (const c of k.vocab.coords.keys()) { const s = sectionOf(k, c); if (s?.doc && s.sec) reached.add(`${docName(s.doc.path)} › ${s.sec.h}`) }
  const paired = items.filter((it) => reached.has(it.key)).length
  // 주입 — 생기면 안 되는 문서 · 종류 · 값
  const kinds = [...new Set([...k.vocab.coords.keys()].map((c) => c.split(':')[0]))]
  const inj = {
    docs: [...new Set(items.map((it) => it.doc))].filter((d) => gold.inject.docs.some((p) => re(p).test(d.split('/').pop()))),
    kinds: kinds.filter((x) => gold.inject.kinds.includes(x)),
    values: gold.inject.values.filter((v) => re(v.re).test((byT.get(v.target) || []).map((it) => it.body).join('\n'))).map((v) => v.re),
  }
  const docs = [...new Set(items.map((it) => it.doc))]
  const r4 = (x) => Math.round(x * 10000) / 10000
  return {
    f1: r4(f1), precision: r4(prec), recall: r4(rec),
    nature: r4(stood.length ? natureOk / stood.length : 0),
    dupRate: r4(stood.length ? dup.length / stood.length : 0),
    missRate: r4(must.length ? missing.length / must.length : 0),
    valueRate: r4(values.length ? values.filter((v) => v.ok).length / values.length : 0),
    factPlaced: r4(facts.length ? facts.filter((f) => f.placed).length / facts.length : 0),
    pair: r4(items.length ? paired / items.length : 0),
    injected: inj.docs.length + inj.kinds.length + inj.values.length,
    counts: { docs: docs.length, items: items.length, rawItems: items.filter((it) => it.raw).length, vocab: k.vocab.coords.size, kinds: kinds.length, formsOwn: !!k.forms?.own, records: k.works.length },
    detail: { docs, kinds, missing, dup, extra, nonItems, nature: natureRows.filter((x) => x.got !== x.want), facts: facts.filter((f) => !f.placed), values, inject: inj },
  }
}
// 과거 결정 카드의 recall(모델 없이 · 설계 9-3) — 기록마다 그 글(제목 + 본문 · kmd 가 단 칸은 뗀다)로 카드를 짓고, 그 기록이 건드린 항목이 정체 카드에 실리나.
//   건드린 항목 가운데 지금 문서에 자리가 있는 것만 센다(폐기 줄은 정본으로). 걸린 길마다 따로 센다.
const KMD_PARTS = /^## (넣은 것|넣지 못함|되돌린 항목|고친 조각|받아들인 경고|값 대조|이은 항목|새로 세움|지은 근거)[ \t\r]*$/
export async function recallOf(k, { n = 300 } = {}) {
  const { precedentsFor } = await import('../core/precedent.js')
  const { resolveName } = await import('../core/guard.js')
  const strip = (body) => { const out = []; let skip = false; for (const l of String(body || '').split('\n')) { if (/^## /.test(l)) skip = KMD_PARTS.test(l); if (!skip) out.push(l) } return out.join('\n') }
  const works = k.works.filter((w) => (w.touches || []).length).slice(0, n)
  let total = 0, hit = 0
  const via = {}
  const miss = []
  for (const w of works) {
    const want = [...new Set(w.touches.map((c) => resolveName(k.vocab, c).coord).filter((c) => c && sectionOf(k, c)?.sec))]
    if (!want.length) continue
    const p = precedentsFor(k, { q: w.title, text: strip(w.body) })
    const cards = new Map(p.cards.filter((c) => c.type === '정체').map((c) => [c.key, c.via]))
    for (const c of want) {
      total++
      if (cards.has(c)) { hit++; via[cards.get(c)] = (via[cards.get(c)] || 0) + 1 } else if (miss.length < 20) miss.push({ record: w.id, title: String(w.title).slice(0, 60), coord: c, cut: p.coverage.cut || 0 })
    }
  }
  return { records: works.length, total, hit, recall: total ? Math.round((hit / total) * 10000) / 10000 : null, via, miss }
}

// 문턱(설계 9-3)
export const GATES = { f1: ['>=', 0.85], nature: ['>=', 0.9], dupRate: ['<=', 0.05], missRate: ['<=', 0.1], valueRate: ['>=', 1], injected: ['<=', 0] }
export const gateOf = (s) => Object.fromEntries(Object.entries(GATES).map(([k, [op, v]]) => [k, op === '>=' ? s[k] >= v : s[k] <= v]))

// ───────── 돌리기 ─────────
const arg = (name, d = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d }
const readGold = async () => JSON.parse(await fs.readFile(path.join(FIX_DIR, 'gold.json'), 'utf8'))

async function freshKn(dir, name) {
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(path.join(dir, 'docs'), { recursive: true })
  await fs.mkdir(path.join(dir, 'work'), { recursive: true })
  await fs.writeFile(path.join(dir, 'README.md'), `# ${name}\n`)
  await fs.writeFile(path.join(dir, '_members.md'), ['# 사람', '', '- 저장 방식: 승인', ''].join('\n'))
  await fs.writeFile(path.join(dir, ...RECORDS_DOC_PATH.split('/')), `# 기록 모음\n\n${RECORDS_INTRO}\n`)
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.name', 'harness-eval')
  git('config', 'user.email', 'harness-eval@example.invalid')
  git('add', '-A')
  git('commit', '-q', '-m', '지식 만듦(평가 시험)')
}

// 단발(지금 프롬프트) — server/hub.js 의 intakeG · unattendedTouches · unattendedPlan · rulePut 과 같은 걸음을 core 함수로
async function oneshotRunner({ budget }) {
  const { ingestCandidates, formsOf, intakePromptOf, intakeFixPromptOf, draftToSave, INTAKE_SCHEMA, ruleRecord } = await import('../core/ingest.js')
  const { buildProposal } = await import('../core/propose.js')
  const { WRITE_RULES } = await import('../core/writerules.js')
  const { ruleSections } = await import('../core/pcplace.js')
  const { save: coreSave } = await import('../core/save.js')
  const { runClaude } = await import('../core/claude.js')
  const month = () => new Date().toISOString().slice(0, 7)
  const intakeG = (k, s, md) => {
    const docs = ingestCandidates(k, { title: s.title || '', body: md }).slice(0, 5)
    const coords = [...k.vocab.coords.entries()].filter(([, v]) => !v.deprecated).map(([c]) => c)
    return { type: s.type, src: { title: s.title, file: s.file, rel: s.file, type: s.type, md, ...(s.date ? { date: s.date } : {}) }, docs, ...formsOf(k), names: coords.slice(0, 200), kinds: [...new Set(coords.map((c) => c.split(':')[0]))] }
  }
  const touchesOf = (k, input) => {
    const rec = input.record
    const all = Array.isArray(rec.touches) ? rec.touches : []
    const made = new Set((input.names || []).map((n) => n.coord))
    const known = all.filter((c) => k.vocab.coords.has(c) || made.has(c))
    if (known.length === all.length && (known.length || rec.touchesEmpty)) return input
    const { touches: _t, touchesEmpty: _e, ...rest } = rec
    return { ...input, record: { ...rest, ...(known.length ? { touches: known } : { touchesEmpty: '무인 들이기: 장부에 있는 건드린 항목이 없다' }) } }
  }
  const plan = (k, input, { rule = false } = {}) => {
    const p = buildProposal(k, input, { newDoc: true, intakeDoc: true, approve: true, curator: false, reverts: () => 0, month: month(), head: { name: k.name, viewers: null, path: '무인' } })
    return { p, errors: p.errors.filter((e) => !(rule && (e.code === 'unreflected' || e.code === 'near'))) }
  }
  const put = async (dir, name, input, { rule = false } = {}) => {
    const bag = { accepted: [], values: [], linked: [], fresh: [], items: 0 }
    const prepare = async () => {
      const k = await loadKnowledge({ id: name, name, dir })
      const { p, errors } = plan(k, touchesOf(k, input), { rule })
      if (errors.length) return { abort: { errors: errors.map((e) => `${e.code} · ${e.at}: ${e.why}`) } }
      const sections = []
      for (const x of p.items) {
        if (x.kind === '고침') sections.push({ ...(x.coord ? { coord: x.coord } : { doc: x.doc, heading: x.heading }), content: x.after, base: x.base })
        else if (x.kind === '신설') sections.push({ doc: x.doc, heading: x.heading, content: x.after })
      }
      const m = p.linked.find((x) => x.records && x.missing)
      if (m) sections.push({ doc: RECORDS_DOC_PATH, heading: m.heading, content: RECORDS_MONTH_TEXT })
      bag.fresh = p.fresh
      bag.linked = p.linked.filter((x) => !(x.records && x.missing))
      return { sections, proposals: p.items.filter((x) => x.kind !== '잇기').map((x) => ({ coord: x.at, doc: x.doc, heading: x.heading, ok: true, changed: [] })) }
    }
    const k0 = await loadKnowledge({ id: name, name, dir })
    const inp = touchesOf(k0, input)
    try {
      const r = await coreSave(dir, { record: inp.record, sections: [], ...(inp.names?.length ? { names: inp.names } : {}) }, { user: 'harness-eval', guard: 'strict', prepare, approve: bag, intake: { tags: [] } })
      return r.errors?.length ? { ok: false, why: r.errors.join(' / ') } : { ok: true, id: r.id, fresh: bag.fresh.map((f) => `${f.kind} ${f.name}`) }
    } catch (e) {
      const errs = e.details?.errors || e.details?.abort?.errors
      return { ok: false, why: String(errs ? [].concat(errs).join(' / ') : `${e.code || ''} ${e.message}`).slice(0, 600) }
    }
  }
  return async function one(dir, name, s, md) {
    const row = { n: s.n, file: s.file, calls: 0, fix: 0, cost: 0, ms: 0, rule: null, put: false, why: [] }
    let k = await loadKnowledge({ id: name, name, dir })
    const g = intakeG(k, s, md)
    row.cands = g.docs.map((d) => docName(d.doc))
    let prompt = intakePromptOf(g, { writeRules: WRITE_RULES })
    row.promptChars = prompt.length
    let last = '초안을 받지 못했다'
    for (let i = 0; i <= 2; i++) {
      const t0 = Date.now()
      const r = await runClaude({ prompt, schema: INTAKE_SCHEMA, budget, timeoutMs: 15 * 60_000 })
      row.calls++
      row.cost += r.cost || 0
      row.ms += Date.now() - t0
      if (r.error) { last = `초안 실패(${r.error}): ${String(r.message || '').slice(0, 160)}`; row.why.push(last); if (['login', 'limit', 'missing'].includes(r.error)) { row.stop = r.error; return row } break }
      const draft = r.value
      if (i === 0) row.draft = { updates: (draft.updates || []).length, newDoc: draft.newDoc?.path || null, names: (draft.names || []).map((n) => `${n.kind || ''}:${n.name}`) }
      k = await loadKnowledge({ id: name, name, dir })
      const d = draftToSave(k, g, draft, { measure: true })
      let why = null
      if (!d.ok) why = d.why
      else if (d.held.length) why = d.held.map((h) => `${h.code}: ${h.why}`).join(' / ')
      else {
        const res = await put(dir, name, d.input)
        if (res.ok) { row.put = true; row.fresh = res.fresh; row.warn = d.warn; row.valueWarn = d.values.length; return row }
        why = res.why
      }
      last = why
      row.why.push(String(why).slice(0, 300))
      if (i === 2) break
      row.fix++
      prompt = intakeFixPromptOf(g, draft, why, { writeRules: WRITE_RULES })
    }
    // 규칙 길(지금 코드의 마지막 길) — 파일은 들인 자료/<주제> 또는 사건 갈래의 날짜 항목 · 커밋은 기록만
    k = await loadKnowledge({ id: name, name, dir })
    const rs = s.type === 'commit' ? null : ruleSections(k, { file: s.file, title: s.title, body: md, date: new Date().toISOString().slice(0, 10) }, { home: INTAKE_FORM })
    const input = { record: ruleRecord({ ...g.src, type: s.type }, md, { why: last, line: rs ? rs.line : '기록 모음 달 항목에 잇는다' }), sections: rs ? rs.sections : [] }
    let res = await put(dir, name, input, { rule: true })
    if (!res.ok && input.sections.length) res = await put(dir, name, { record: input.record }, { rule: true })
    row.rule = rs ? rs.line : '기록만'
    row.put = res.ok
    if (!res.ok) row.why.push(`규칙 길도 못 넣음: ${res.why}`)
    return row
  }
}

// 세션 방식 — 임시 팀 서버 + 팀 일꾼. 서버는 127.0.0.1 의 빈 포트에 뜨고 쓰는 곳은 root(.kmd-data/harness-eval/kn/<판>-root) 뿐이다
async function sessionRunner({ root, kn }) {
  const { startServer } = await import('../server/http.js')
  const { workOnce } = await import('../core/worker.js')
  const { sha16 } = await import('../core/text.js')
  await fs.mkdir(path.join(root, '.kmd'), { recursive: true })
  await fs.writeFile(path.join(root, '.kmd', 'serve.json'), JSON.stringify({ decideMs: 3600000, sourceTickMs: 3600000, inboxTickMs: 3600000, jobTickMs: 3600000, watchQuietMs: 600000 }))
  const s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  const wk = (await s.auth.workerAdd()).key
  const one = async (dir, name, src, md) => {
    const row = { n: src.n, file: src.file, calls: 0, fix: 0, cost: 0, ms: 0, rule: null, put: false, why: [] }
    const o = await s.hub.openJob(kn, { type: src.type, by: 'kmd', auto: true, src: src.type === 'commit' ? { src: '게이트웨이', commit: 'a1b2c3d4e5f60718', title: src.title, touches: [] } : { rel: src.file, file: src.file, title: src.title, sha: sha16(md) }, md })
    if (o.state !== 'queued') { row.why.push(`일감을 열지 못했다: ${JSON.stringify(o).slice(0, 200)}`); row.put = o.state === 'rule'; row.rule = o.state === 'rule' ? (o.why || '규칙 길') : null; return row }
    const logs = []
    const t0 = Date.now()
    const r = await workOnce({ server: s.url, key: wk, log: (x) => logs.push(String(x)) })
    row.ms = Date.now() - t0
    const j = s.hub.intakesOf(kn).find((x) => x.id === o.job)
    row.session = !!r?.job?.session
    row.cost = j?.cost || 0
    row.calls = j?.calls || 0
    row.rule = j?.result?.rule || null
    row.put = j?.state === 'done' && !j?.result?.aborted
    if (j?.why) row.why.push(String(j.why).slice(0, 300))
    row.log = logs.slice(-40)
    if (r?.stop) row.stop = r.stop
    if (!r) row.why.push('일감을 받지 못했다')
    return row
  }
  return { one, close: () => s.close() }
}

async function main() {
  const cmd = process.argv[2]
  const gold = await readGold()
  if (cmd === 'plan') {
    for (const [o, ns] of Object.entries(gold.orders)) console.log(`${o}: 원천 ${ns.length} · ${ns.join(' → ')}`)
    return
  }
  if (cmd === 'score') {
    const dir = path.resolve(process.argv[3])
    const k = await loadKnowledge({ id: gold.kn, name: gold.kn, dir })
    const s = scoreKnowledge(k, gold)
    console.log(JSON.stringify({ ...s, gates: gateOf(s) }, null, 2))
    return
  }
  if (cmd === 'recall') {
    const dir = path.resolve(process.argv[3])
    const k = await loadKnowledge({ id: path.basename(dir), name: path.basename(dir), dir })
    const r = await recallOf(k, { n: Number(arg('n', '300')) || 300 })
    await fs.mkdir(OUT_DIR, { recursive: true })
    const out = path.join(OUT_DIR, `${new Date().toISOString().slice(0, 10)}-recall-${path.basename(dir)}.json`)
    await fs.writeFile(out, JSON.stringify({ dir, head: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(), items: k.vocab.coords.size, ...r }, null, 2) + '\n')
    console.log(`${path.basename(dir)}: 기록 ${r.records} · 건드린 항목 ${r.total} · 카드에 실림 ${r.hit} · recall ${r.recall} · 길 ${JSON.stringify(r.via)}`)
    for (const m of r.miss.slice(0, 8)) console.log(`  빠짐: ${m.coord} ← ${m.title}${m.cut ? ` (잘림 ${m.cut})` : ''}`)
    console.log(`결과: ${path.relative(ROOT, out)}`)
    return
  }
  if (cmd !== 'run') { console.error('쓰는 법: harness-eval.mjs run --order <차례> | score <지식 폴더> | recall <지식 폴더> | plan'); process.exit(2) }
  const order = arg('order')
  if (!gold.orders[order]) { console.error(`차례를 고른다: ${Object.keys(gold.orders).join(' · ')}`); process.exit(2) }
  const mode = arg('mode', 'oneshot')
  const tag = arg('tag', '바탕')
  const budget = Number(arg('budget', '1')) || 1
  const only = arg('only') ? new Set(arg('only').split(',').map(Number)) : null
  const ver = `${tag}-${mode}-${order}`
  if (!['oneshot', 'session'].includes(mode)) { console.error(`모르는 방식: ${mode}`); process.exit(2) }
  const KN_ID = 'empty-test' // 세션 방식의 지식 id(임시 팀 서버의 폴더 이름)
  const root = path.join(OUT_DIR, 'kn', `${ver}-root`)
  const dir = mode === 'session' ? path.join(root, KN_ID) : path.join(OUT_DIR, 'kn', ver)
  await fs.mkdir(OUT_DIR, { recursive: true })
  if (mode === 'session') await fs.rm(root, { recursive: true, force: true })
  await freshKn(dir, gold.kn)
  const runner = mode === 'session' ? await sessionRunner({ root, kn: KN_ID }) : null
  const one = runner ? runner.one : await oneshotRunner({ budget })
  const rows = []
  const day = new Date().toISOString().slice(0, 10)
  const outFile = path.join(OUT_DIR, `${day}-${ver}.json`)
  const t0 = Date.now()
  for (const n of gold.orders[order]) {
    if (only && !only.has(n)) continue
    const s = gold.sources.find((x) => x.n === n)
    const md = await fs.readFile(path.join(FIX_DIR, s.file), 'utf8')
    const before = (await loadKnowledge({ id: gold.kn, name: gold.kn, dir }))
    const b = { docs: before.docs.length, items: itemsOf(before).length }
    const row = await one(dir, gold.kn, s, md)
    const after = await loadKnowledge({ id: gold.kn, name: gold.kn, dir })
    row.added = { docs: after.docs.length - b.docs, items: itemsOf(after).length - b.items }
    if (s.expect === 'empty') row.emptyOk = row.added.items === 0 && row.added.docs === 0
    rows.push(row)
    console.log(`[${n}] ${s.file}: ${row.put ? (row.rule ? `규칙 길(${row.rule})` : '넣음') : '못 넣음'} · 부름 ${row.calls} · 고쳐 받기 ${row.fix} · $${row.cost.toFixed(3)} · ${Math.round(row.ms / 1000)}초 · 문서 +${row.added.docs} 항목 +${row.added.items}${row.why.length ? ` · ${row.why[row.why.length - 1].slice(0, 100)}` : ''}`)
    const k = await loadKnowledge({ id: gold.kn, name: gold.kn, dir })
    const score = scoreKnowledge(k, gold)
    await fs.writeFile(outFile, JSON.stringify({ ver, mode, order, day, head: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(), partial: only ? [...only] : null, ms: Date.now() - t0, cost: rows.reduce((a, r) => a + r.cost, 0), tally: { sources: rows.length, put: rows.filter((r) => r.put && !r.rule).length, rule: rows.filter((r) => r.rule).length, fail: rows.filter((r) => !r.put).length, fix: rows.reduce((a, r) => a + r.fix, 0), calls: rows.reduce((a, r) => a + r.calls, 0) }, score, gates: gateOf(score), rows }, null, 2) + '\n')
    if (row.stop) { console.error(`Claude 를 쓸 수 없어 멈춘다(${row.stop})`); break }
  }
  if (runner) await runner.close()
  const fin = JSON.parse(await fs.readFile(outFile, 'utf8'))
  console.log(`\n${ver}: 값 $${fin.cost.toFixed(2)} · ${Math.round(fin.ms / 60000)}분 · 넣음 ${fin.tally.put} · 규칙 길 ${fin.tally.rule} · 못 넣음 ${fin.tally.fail} · 고쳐 받기 ${fin.tally.fix}`)
  const s = fin.score
  console.log(`묶음 F1 ${s.f1} · 성격 ${s.nature} · 중복 ${s.dupRate} · 빠짐 ${s.missRate} · 지금 값 ${s.valueRate} · 짝 ${s.pair} · 주입 ${s.injected} · 문서 ${s.counts.docs} · 항목 ${s.counts.items}(원문 ${s.counts.rawItems})`)
  console.log(`결과: ${path.relative(ROOT, outFile)}`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1) })
