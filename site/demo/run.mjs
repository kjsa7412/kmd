// 소개 사이트 데모: 시험 지식(content.mjs)을 임시 팀 서버에 세우고, 줄거리(STEPS)를 채널마다 저장 문으로 지나게 한 뒤
//   화면을 찍고(라이트 · 다크 · 1280×800) 그래프 · 문서 · 기록 자료를 site/data/story.js 로 낸다.
//   node site/demo/run.mjs [--no-shots]
//   사람 채널(세션 · 공유)은 저장 제안(hub.propose) → 승인(proposal 을 실은 save) · 화면 고치기는 저장 확인 창 길(hub.edit dry → proposal) ·
//   무인 채널(자동수집 · 수기수집)은 들이기 문(규칙 길까지 늘 들어감). 입력 오류면 아무것도 쓰지 않으므로 스크립트가 멈춘다.
//   찍는 것은 진짜 화면이고 내용은 가상이다. 사람이 PNG 를 넘겨 본 뒤 커밋한다.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { startServer } from '../../server/http.js'
import { signIn, seat } from '../../test/helpers.mjs'
import { sha16 } from '../../core/text.js'
import { sectionOf } from '../../core/knowledge.js'
import { recordBody } from '../../core/guard.js'
import { KN, FILES, PEOPLE, STEPS } from './content.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SITE = path.resolve(HERE, '..')
const SHOTS = path.join(SITE, 'shots')
const NO_SHOTS = process.argv.includes('--no-shots')
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find((f) => fs.existsSync(f))

const env0 = { ...process.env }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-site-'))
process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
process.env.KMD_NO_CLAUDE = '1'
process.env.KMD_CLAUDE = path.join(ROOT, 'test', 'fixture', 'fake-claude.mjs')
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }
for (const [f, t] of Object.entries(FILES)) write(path.join(tmp, 'kn', KN, f), t)

const s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
const kim = await signIn(s, { id: 'kim' })
for (const p of PEOPLE) { await signIn(s, { id: p.id, admin: false }); await seat(s, p.id, { [KN]: p.seat }) }

// 줄거리: 채널마다 저장 문
const sec = async (coord) => sectionOf(await s.hub.get(KN), coord).sec
const piece = async ({ coord, from, to }) => {
  const body = (await sec(coord)).body
  if (body.split(from).length !== 2) throw new Error(`「${coord}」 에 「${from}」 이 꼭 한 번 나오지 않는다`)
  return { coord, base: sha16(body), content: body.replace(from, to) }
}
// 기록 글 — 서식 칸(요약 · 바뀐 것 · 까닭 · 근거)을 kmd 가 엮는 그대로
const recOf = (st) => {
  const b = recordBody({ body: st.summary || '', changes: st.changes || [], why: st.whyRec || [], refs: st.refs || [] })
  if (b.error) throw new Error(`${st.key}: ${b.error}`)
  return { title: st.title, body: b.body, touches: [...new Set(st.sections.map((x) => x.coord))] }
}
// 사람 채널 — 저장 제안을 받아(경고는 보이고) 그대로 승인한다
const approve = async (ctx, input, channel, pathWord) => {
  const p = await s.hub.propose(ctx, KN, input, { path: pathWord })
  if (p.errors.length) throw new Error(`저장 제안 오류: ${p.errors.map((e) => `${e.at}: ${e.why}`).join(' · ')}`)
  const r = await s.hub.save(ctx, KN, { ...input, proposal: p.proposal }, { channel })
  return { r, warnings: p.warnings.map((w) => w.why || w.code) }
}
const results = []
for (const st of STEPS) {
  let r, warnings = [], rule = false
  if (st.key === 'edit') {
    // 화면 고치기 — 저장 확인 창: dry(쓰지 않는 저장 제안) → [넣기] = proposal 을 실은 저장
    const k = await s.hub.get(KN)
    const d = k.docs.find((x) => x.title === st.doc)
    const old = d.sections.find((x) => x.h === st.heading)
    const body = { doc: d.id, sections: [{ h: st.heading, body: old.body.replace(st.from, st.to), base: sha16(old.body) }], why: st.editWhy, changes: [`${st.heading}: ${st.from} → ${st.to}`] }
    const dry = await s.hub.edit({ user: 'kim', admin: true }, KN, { ...body, dry: true }, { needBase: true })
    const p = dry.propose || dry
    if (p.errors?.length) throw new Error(`화면 저장 제안 오류: ${p.errors.map((e) => e.why).join(' · ')}`)
    warnings = (p.warnings || []).map((w) => w.why || w.code)
    r = await s.hub.edit({ user: 'kim', admin: true }, KN, { ...body, proposal: p.proposal }, { needBase: true })
  } else {
    const sections = await Promise.all(st.sections.map(piece))
    const record = recOf(st)
    if (st.key === 'file' || st.key === 'commit') {
      // 무인 문(들이기) — 승인이 없다(일을 건 것이 결정) · 걸리면 규칙 길
      const job = 'site-' + st.key
      r = await s.hub.save({ user: st.who, intake: true }, KN, { record, sections }, { channel: st.key === 'file' ? 'intake-file' : 'intake-commit', intake: { job, tags: [`job/${job}`, ...(st.key === 'commit' ? ['code-change'] : [])], held: [] } })
      if (r.errors?.length) throw new Error(`${st.key} 무인 저장 오류: ${r.errors.map((e) => e.why).join(' · ')}`)
      rule = !!r.rule
    } else if (st.key === 'send') {
      // 공유 — 보내기 확인 창이 팀의 저장 제안 · [보내기] 가 승인(보낸 지문 sent/ 는 보내기 채널이 단다)
      const input = { record, sections }
      const p = await s.hub.propose({ user: st.who }, KN, input, { path: '보내기' })
      if (p.errors.length) throw new Error(`보내기 저장 제안 오류: ${p.errors.map((e) => e.why).join(' · ')}`)
      warnings = p.warnings.map((w) => w.why || w.code)
      r = await s.hub.save({ user: st.who }, KN, { record: { ...record, tags: ['sent/' + sha16(record.body)] }, sections, proposal: p.proposal }, { channel: 'send' })
    } else {
      ;({ r, warnings } = await approve({ user: st.who }, { record, sections }, 'session', '이 세션의 작업'))
    }
  }
  const accepted = (r.accepted || []).map((w) => w.why || w.code)
  console.log('저장', st.key, r.id || r.saved || '', 'put', r.put ?? '-', warnings.length ? '경고 ' + warnings.join(' · ') : '', accepted.length ? '받아들인 경고 ' + accepted.length : '', rule ? '규칙 길' : '')
  results.push({ key: st.key, id: r.id || r.saved || null, accepted: accepted.length ? accepted : warnings, rule })
}

// 자료: 그래프(문서 ⊃ 항목 · 기록 → 항목 · 문서 → 문서) · 문서 글 · 기록
const get = async (u, who = kim) => { const x = await fetch(s.url + u, { headers: { cookie: who.cookie } }); if (!x.ok) throw new Error(u + ' ' + x.status); return x.json() }
const model = await get(`/api/k/${KN}/model`)
const k = await s.hub.get(KN)
const nodes = [], edges = [], has = new Set()
const add = (id, kind, label, x = {}) => { nodes.push({ id, kind, label, ...x }); has.add(id) }
for (const d of model.docs) add('d:' + d.id, 'doc', d.title)
for (const i of model.items) add('i:' + i.key, 'item', i.name, { coord: i.coord, kindLabel: i.kind, doc: i.doc })
const stepOf = new Map(results.filter((x) => x.id).map((x) => [x.id, x.key]))
for (const w of model.recs) add('r:' + w.id, 'rec', w.title.replace(/\(테스트\)/, ''), { step: stepOf.get(w.id) || null, warn: (results.find((x) => x.id === w.id)?.accepted.length || 0) > 0 })
const seen = new Set()
const edge = (a, b, t) => { const key = [a, b].sort().join('>'); if (has.has(a) && has.has(b) && a !== b && !seen.has(key)) { seen.add(key); edges.push({ a, b, t }) } }
for (const i of model.items) if (i.doc) edge('d:' + i.doc, 'i:' + i.key, 'in')
for (const w of model.recs) for (const c of w.items) edge('r:' + w.id, 'i:' + c, 'touch')
for (const d of model.docs) for (const b of d.links) edge('d:' + d.id, 'd:' + b, 'link')
const docs = k.docs.map((d) => ({ id: d.id, title: d.title, intro: (d.intro || '').trim(), sections: d.sections.map((x) => ({ h: x.h, body: x.body.trim() })) }))
const recs = k.works.map((w) => ({ id: w.id, title: w.title, author: w.author, state: w.state || null, touches: w.touches, body: w.body.trim().slice(0, 1200), step: stepOf.get(w.id) || null }))
const stepsOut = STEPS.map(({ sections, summary, changes, whyRec, refs, editWhy, ...x }) => ({ ...x, body: x.key === 'edit' ? null : recOf({ ...x, sections, summary, changes, whyRec, refs }).body, sections: sections || null, result: results.find((r) => r.key === x.key) }))
write(path.join(SITE, 'data', 'story.js'), `// site/demo/run.mjs 가 만든다: 손으로 고치지 않는다\nwindow.KMD_STORY = ${JSON.stringify({ kn: KN, name: k.name, steps: stepsOut, graph: { nodes, edges }, docs, recs }, null, 1)}\n`)
console.log('자료', nodes.length, '점', edges.length, '선')

// 화면: 라이트 · 다크
if (!NO_SHOTS) {
  if (!CHROME) throw new Error('Chrome 이나 Edge 가 있어야 화면을 찍는다')
  const ascii = path.join(ROOT, '.kmd-data', 'tmp'); fs.mkdirSync(ascii, { recursive: true }); process.env.TEMP = process.env.TMP = ascii
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, env: { ...env0, TEMP: ascii, TMP: ascii } })
  fs.mkdirSync(SHOTS, { recursive: true })
  const V = { width: 1280, height: 800 }
  const itemKey = (coord) => model.items.find((i) => i.coord === coord).key
  const docId = (t) => model.docs.find((d) => d.title === t).id
  const rid = (key) => results.find((x) => x.key === key).id
  const H = (...p) => '#/' + p.map(encodeURIComponent).join('/')
  const problems = []
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: V, colorScheme: scheme, deviceScaleFactor: 1, locale: 'ko-KR' })
    const p = await ctx.newPage()
    p.on('pageerror', (e) => problems.push(`${scheme} pageerror ${String(e).slice(0, 120)}`))
    await p.goto(s.url); await p.fill('#lgId', kim.id); await p.fill('#lgPw', kim.pw); await p.click('[data-t=loginBtn]'); await p.waitForSelector('[data-t=klist]')
    // 이 PC 의 임시 폴더(사용자 이름이 든다)를 서버 자리처럼 바꿔 그린다
    const mask = () => p.evaluate(() => {
      const re = /[A-Z]:\\Users\\[^\\]+\\AppData\\Local\\Temp\\kmd-site-[^\\/\s]+(?:\\kn)?/g
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n; (n = tw.nextNode());) if (re.test(n.nodeValue)) { re.lastIndex = 0; n.nodeValue = n.nodeValue.replace(re, '/srv/kmd') }
      for (const e of document.querySelectorAll('input,textarea')) if (e.value) e.value = e.value.replace(re, '/srv/kmd')
      for (const e of document.querySelectorAll('[title]')) e.title = e.title.replace(re, '/srv/kmd')
    })
    const shot = async (name) => {
      await p.mouse.move(V.width - 4, V.height - 4); await mask(); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(700)
      const o = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
      if (o) problems.push(`${name}-${scheme} 가로 넘침`)
      await p.screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`) }); console.log('찍음', name, scheme)
    }
    const step = async (name, fn) => { try { await fn(); await shot(name) } catch (e) { problems.push(`못 찍음 ${name} ${scheme} ${e.message.split('\n')[0]}`) } }
    // 주소만 바꾼다(지식 목록이 온 뒤) · 창 · 메뉴는 Esc 로 닫고
    const go = async (h, wait, ms = 1100) => {
      await p.keyboard.press('Escape').catch(() => {})
      await p.evaluate((x) => { location.hash = x }, h)
      if (wait) await p.waitForSelector(wait, { timeout: 10000 })
      await p.waitForTimeout(ms)
    }
    // 오른쪽 기둥을 펴고 그 묶음으로(처음은 접힌 52 기둥)
    const aside = async () => { const f = p.locator('[data-t=asideFold]'); if (await f.count() && !(await p.locator('[data-t=aside] .asc').count())) { await f.first().click(); await p.waitForTimeout(500) } }
    await step('home', async () => go('#/manage', '[data-t=klist]'))
    await step('kn', async () => go(H('k', KN), '[data-t=leftPane]', 1400))
    await step('doc', async () => go(H('k', KN, 'd', docId('첫 주 안내')), '[data-t=editBtn]'))
    await step('item', async () => { await go(H('k', KN, 'i', itemKey('proc:노트북 받기')), '[data-t=leftPane]'); await aside() })
    await step('rec', async () => { await go(H('k', KN, 'r', rid('session')), '[data-t=leftPane]'); await aside() })
    await step('recs', async () => { await go(H('k', KN, 'r', rid('file')), '[data-t=leftPane]'); await p.click('[data-t=rb-recs]'); await p.waitForTimeout(800) })
    await step('search', async () => { await go(H('k', KN, 'd', docId('첫 주 안내')), '[data-t=editBtn]'); await p.keyboard.press('Control+k'); await p.waitForTimeout(400); await p.keyboard.type('노트북'); await p.waitForTimeout(1500) })
    await step('cmd', async () => { await go(H('k', KN, 'd', docId('첫 주 안내')), '[data-t=editBtn]'); await p.keyboard.press('Control+p'); await p.waitForTimeout(800) })
    await step('edit', async () => { await go(H('k', KN, 'd', docId('장비')), '[data-t=editBtn]'); await p.click('[data-t=editBtn]'); await p.waitForSelector('[data-t=editor]') })
    await step('propose', async () => {
      const ta = p.locator('[data-t=editor] textarea').first(); await ta.click(); await p.keyboard.press('Control+End'); await p.keyboard.type(' 반납 전에 개인 파일을 옮긴다.')
      await p.locator('[data-t=editor]').getByRole('button', { name: '저장', exact: true }).first().click({ timeout: 5000 })
      await p.waitForSelector('.modal', { timeout: 15000 }); await p.waitForTimeout(1000)
    })
    await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(300)
    const cancel = p.getByRole('button', { name: '취소', exact: true }); if (await cancel.count()) await cancel.first().click().catch(() => {})
    await step('graph', async () => {
      await go(H('k', KN, 'graph'), '[data-t=gcanvas]', 2500)
      // 회전은 멈추고(찍는 순간이 흔들리지 않게) 제목은 켜고, 처음 크기로 맞춘 뒤 가운데를 두 번 당긴다
      const tog = async (t, want) => { const b = p.locator(`[data-t=${t}]`); if (await b.count() && (await b.first().getAttribute('aria-pressed')) !== String(want)) { await b.first().click(); await p.waitForTimeout(300) } }
      await tog('g-spin', false); await tog('g-label', true)
      await p.click('[data-t=gFit]'); await p.waitForTimeout(1200)
      const c = await p.locator('[data-t=gcanvas]').boundingBox(); await p.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
      for (let i = 0; i < 2; i++) { await p.mouse.wheel(0, -200); await p.waitForTimeout(300) }
      await p.waitForTimeout(1200)
    })
    await step('history', async () => go(H('k', KN, 'history'), null, 1500))
    await step('check', async () => go(H('k', KN, 'check', 'metrics'), null, 1500))
    await step('import', async () => go(H('k', KN, 'gen'), null, 1500))
    await step('shape', async () => go(H('k', KN, 'shape'), null, 1500))
    await step('seed', async () => go('#/manage/seed', null, 1500))
    await ctx.close()
  }
  await browser.close()
  console.log(JSON.stringify({ problems }, null, 1))
}
await s.close?.()
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(0)
