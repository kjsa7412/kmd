// 소개 사이트 데모: 시험 지식(content.mjs)을 임시 팀 서버에 세우고, 줄거리(STEPS)를 채널마다 저장 문으로 지나게 한 뒤
//   화면을 찍고(라이트 · 다크 · 1280×800) 그래프 · 문서 · 기록 자료를 site/data/story.js 로 낸다.
//   node site/demo/run.mjs [--no-shots]
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
process.env.KMD_CLAUDE = path.join(ROOT, 'test', 'fixture', 'fake-claude.mjs')
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }
for (const [f, t] of Object.entries(FILES)) write(path.join(tmp, 'kn', KN, f), t)

const s = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: () => {}, scryptN: 1 << 15 })
const kim = await signIn(s, { id: 'kim' })
const people = {}
for (const p of PEOPLE) { people[p.id] = await signIn(s, { id: p.id, admin: false }); await seat(s, p.id, { [KN]: p.seat }) }

// 줄거리: 채널마다 저장 문
const sec = async (coord) => sectionOf(await s.hub.get(KN), coord).sec
const piece = async ({ coord, from, to }) => {
  const body = (await sec(coord)).body
  if (body.split(from).length !== 2) throw new Error(`「${coord}」 에 「${from}」 이 꼭 한 번 나오지 않는다`)
  return { coord, base: sha16(body), content: body.replace(from, to) }
}
const results = []
for (const st of STEPS) {
  let r
  if (st.key === 'edit') {
    const k = await s.hub.get(KN)
    const d = k.docs.find((x) => x.title === st.doc)
    const old = d.sections.find((x) => x.h === st.heading)
    r = await s.hub.edit({ user: 'kim', admin: true }, KN, { doc: d.id, sections: [{ h: st.heading, body: old.body.replace(st.from, st.to), base: sha16(old.body) }], why: '노트북 설정이 첫날에서 빠져 팀 소개를 오전으로 당겼다' })
  } else {
    const sections = await Promise.all(st.sections.map(piece))
    const record = { title: st.title, body: st.body }
    if (st.key === 'file' || st.key === 'commit') {
      const job = 'site-' + st.key
      r = await s.hub.save({ user: st.who, intake: true }, KN, { record, sections }, { channel: st.key === 'file' ? 'intake-file' : 'intake-commit', intake: { job, tags: [`job/${job}`, ...(st.key === 'commit' ? ['code-change'] : [])], held: [] } })
    } else if (st.key === 'send') {
      r = await s.hub.save({ user: st.who }, KN, { record: { ...record, tags: ['sent/' + sha16(st.body)] }, sections }, { channel: 'send' })
    } else {
      r = await s.hub.save({ user: st.who }, KN, { record, sections }, { channel: 'session' })
    }
  }
  const held = (r.held || []).map((h) => h.why || h.code)
  console.log('저장', st.key, r.id || r.saved || '', 'put', r.put ?? '-', held.length ? '넣지 못함 ' + held.join(' · ') : '')
  results.push({ key: st.key, id: r.id || r.saved || null, held })
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
for (const w of model.recs) add('r:' + w.id, 'rec', w.title.replace(/\(테스트\)/, ''), { step: stepOf.get(w.id) || null, held: (results.find((x) => x.id === w.id)?.held.length || 0) > 0 })
const seen = new Set()
const edge = (a, b, t) => { const key = [a, b].sort().join('>'); if (has.has(a) && has.has(b) && a !== b && !seen.has(key)) { seen.add(key); edges.push({ a, b, t }) } }
for (const i of model.items) if (i.doc) edge('d:' + i.doc, 'i:' + i.key, 'in')
for (const w of model.recs) for (const c of w.items) edge('r:' + w.id, 'i:' + c, 'touch')
for (const d of model.docs) for (const b of d.links) edge('d:' + d.id, 'd:' + b, 'link')
const docs = k.docs.map((d) => ({ id: d.id, title: d.title, intro: (d.intro || '').trim(), sections: d.sections.map((x) => ({ h: x.h, body: x.body.trim() })) }))
const recs = k.works.map((w) => ({ id: w.id, title: w.title, author: w.author, state: w.state || null, touches: w.touches, body: w.body.trim().slice(0, 1200), step: stepOf.get(w.id) || null }))
write(path.join(SITE, 'data', 'story.js'), `// site/demo/run.mjs 가 만든다: 손으로 고치지 않는다\nwindow.KMD_STORY = ${JSON.stringify({ kn: KN, name: k.name, steps: STEPS.map(({ sections, ...x }) => ({ ...x, sections: sections || null, result: results.find((r) => r.key === x.key) })), graph: { nodes, edges }, docs, recs }, null, 1)}\n`)
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
  const H = (...p) => `${s.url}/#/${p.map(encodeURIComponent).join("/")}`
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: V, colorScheme: scheme, deviceScaleFactor: 1 })
    const p = await ctx.newPage()
    await p.goto(s.url); await p.fill('#lgId', kim.id); await p.fill('#lgPw', kim.pw); await p.click('[data-t=loginBtn]'); await p.waitForSelector('[data-t=klist]')
    // 이 PC 의 임시 폴더(사용자 이름이 든다)를 서버 자리처럼 바꿔 그린다
    const mask = () => p.evaluate(() => {
      const re = /[A-Z]:\\Users\\[^\\]+\\AppData\\Local\\Temp\\kmd-site-[^\\/\s]+(?:\\kn)?/g
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n; (n = tw.nextNode());) if (re.test(n.nodeValue)) { re.lastIndex = 0; n.nodeValue = n.nodeValue.replace(re, '/srv/kmd') }
      for (const e of document.querySelectorAll('input,textarea')) if (e.value) e.value = e.value.replace(re, '/srv/kmd')
      for (const e of document.querySelectorAll('[title]')) e.title = e.title.replace(re, '/srv/kmd')
    })
    const shot = async (name) => { await p.mouse.move(V.width - 4, V.height - 4); await mask(); await p.waitForTimeout(700); await p.screenshot({ path: path.join(SHOTS, `${name}-${scheme}.png`) }); console.log('찍음', name, scheme) }
    const step = async (name, fn) => { try { await fn(); await shot(name) } catch (e) { console.log('못 찍음', name, scheme, e.message.split('\n')[0]) } }
    // 새로 읽고(지식 목록이 온 뒤) 주소만 바꾼다: 처음부터 깊은 주소로 열면 목록이 오기 전에 열어 「그 지식이 없다」 가 된다
    const go = async (u, wait) => {
      await p.goto(s.url + '/#/'); await p.reload(); await p.waitForSelector('[data-t=klist]'); await p.waitForTimeout(400)
      const h = u.slice(s.url.length + 1)
      if (h && h !== '#/') await p.evaluate((x) => { location.hash = x }, h)
      if (wait) await p.waitForSelector(wait)
      await p.waitForTimeout(900)
    }
    await step('home', async () => go(s.url + '/#/', '[data-t=klist]'))
    await step('kn', async () => go(H('k', KN), '[data-t=leftPane]'))
    await step('doc', async () => go(H('k', KN, 'd', docId('첫 주 안내')), '[data-t=editBtn]'))
    const open = async (label) => { const a = p.locator('[data-t=aside]'); const h = a.getByText(label, { exact: true }).first(); if (await h.count()) { await h.click(); await p.waitForTimeout(300) } }
    await step('item', async () => { await go(H('k', KN, 'i', itemKey('proc:노트북 받기')), '[data-t=leftPane]'); await open('기록'); await open('문서') })
    await step('rec', async () => { await go(H('k', KN, 'r', rid('session')), '[data-t=leftPane]'); await open('항목') })
    await step('recs', async () => { await go(H('k', KN, 'r', rid('file')), '[data-t=leftPane]'); await p.click('[data-t=ktabs] [data-v=recs]'); await p.waitForTimeout(700) })
    await step('search', async () => { await go(H('k', KN, 'd', docId('첫 주 안내')), '[data-t=editBtn]'); await p.keyboard.press('Control+k'); await p.waitForTimeout(400); await p.keyboard.type('노트북'); await p.waitForTimeout(1500) })
    await p.keyboard.press('Escape').catch(() => {})
    await step('edit', async () => { await go(H('k', KN, 'd', docId('첫 주 안내')), '[data-t=editBtn]'); await p.click('[data-t=editBtn]'); await p.waitForSelector('[data-t=editor]') })
    await step('graph', async () => { await go(H('k', KN, 'graph'), '[data-t=gcanvas]'); await p.waitForTimeout(1500); await p.click('[data-t=g-line]'); await p.click('[data-t=g-title]').catch(() => {}); await p.waitForTimeout(2500); await p.click('[data-t=gFit]'); await p.waitForTimeout(2000) })
    const nav = async (id, wait) => { await go(s.url + '/#/'); await p.click(`[data-t=manageArea] [data-t=nav-${id}]`); if (wait) await p.waitForSelector(wait); await p.waitForTimeout(1200) }
    await step('history', async () => { await nav('history') })
    await step('held', async () => { await nav('held') })
    await step('import', async () => { await nav('import') })
    await ctx.close()
  }
  await browser.close()
}
await s.close?.()
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(0)
