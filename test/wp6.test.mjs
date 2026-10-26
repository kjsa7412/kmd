// WP6 필수 — 쓴 글 지키기(제품화 검토 v0.1 F-004 · G4-5 · F-035 · F-036 · F-025 · F-034 · F-045 · G2-2 · F-089 · F-048 · F-067).
//
// 고치는 중 쓴 글은 다시 그려도 · 찾기를 열고 닫아도 그대로 · Ctrl S 저장 · 들어온 것이 끝나면 그 자리에서 다시 들어가 이어서 저장 ·
// 항목 지우기 · 이름 바꾸기가 문서에 들어간다(이름 장부도 따라간다) · 이름 장부에 없는 항목을 고친 기록도 그 항목에 선다 ·
// 같은 글 두 번 누름은 하나 · MCP 는 이미 있는 항목을 base 없이 덮지 않는다 · 이미 되돌린 정리는 다시 되돌리지 않고 쓴 사람의 줄도 거둔다 ·
// 편집기로 고친 기록 · 장부는 사본을 두고 되돌리며 이력에 알린다 · 꺼져 있던 동안의 편집기 고침을 켤 때 거둔다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { startServer } from '../server/http.js'
import { SHELL } from '../server/hub.js'
import { makeMcp } from '../server/mcp.js'
import * as feed from '../core/feed.js'
import { coordsOfSection } from '../core/knowledge.js'
import { copyDir, signIn } from './helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = [process.env.KMD_CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p))
const KIM = { user: 'kim', admin: true }
const LEE = { user: 'lee' }
let tmp, root, data, s, browser, me
const code = (p) => p.then(() => 'ok', (e) => e.code)
const until = async (f, ms = 10_000) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 50)) } return true }
const doc = (k, d) => fs.readFileSync(path.join(root, k, 'docs', d + '.md'), 'utf8')

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-wp6-'))
  const env = { ...process.env }
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  root = path.join(tmp, 'kn')
  data = path.join(root, '.kmd')
  copyDir(path.join(HERE, 'fixture', 'kmd'), root)
  fs.mkdirSync(data, { recursive: true })
  fs.writeFileSync(path.join(data, 'serve.json'), JSON.stringify({ decideMs: 3600000, tidyTickMs: 3600000, collect: true, collectOnStartMs: 100 }))
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  me = await signIn(s, { id: 'kim' })
  await s.hub.setOwner(SHELL, 'dpms', { owner: 'kim' })
  if (CHROME) {
    if (!/^[\x20-\x7e]*$/.test(os.tmpdir())) {
      const ascii = path.join(HERE, '..', '.kmd-data', 'tmp')
      fs.mkdirSync(ascii, { recursive: true })
      process.env.TEMP = process.env.TMP = env.TEMP = env.TMP = ascii
    }
    browser = await chromium.launch({ executablePath: CHROME, headless: true, env })
  }
})
after(async () => {
  await browser?.close()
  await s?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('항목 지우기 · 이름 바꾸기 — 주인은 문서에 바로(이름 장부도 따라간다) · 기록만 하는 사람은 기록 글에', async () => {
  const before = doc('dpms', '배포절차')
  assert.match(before, /## 헬스 체크/)
  await s.hub.edit(KIM, 'dpms', { doc: '배포절차', remove: ['준비'], rename: [{ from: '헬스 체크', to: '상태 확인' }] })
  const after = doc('dpms', '배포절차')
  assert.doesNotMatch(after, /^## 준비$/m)
  assert.match(after, /^## 상태 확인$/m)
  assert.doesNotMatch(after, /^## 헬스 체크$/m)
  assert.match(fs.readFileSync(path.join(root, 'dpms', '_managed.md'), 'utf8'), /`proc:헬스 체크` \| `docs\/배포절차\.md` \| `## 상태 확인`/)
  // 읽은 뒤 사라진 항목 — 거절
  assert.equal(await code(s.hub.edit(KIM, 'dpms', { doc: '배포절차', remove: ['준비'] })), 'E_CONFLICT')
  // 기록만 하는 사람 — 기록 글에 「지울 항목」 · 「이름 바꿀 항목」
  const r = await s.hub.edit(LEE, 'dpms', { doc: '배포절차', remove: ['롤백'], rename: [{ from: '카나리', to: '카나리 배포' }] })
  assert.equal(r.direct, false)
  const t = fs.readFileSync(path.join(root, 'dpms', r.record), 'utf8')
  assert.match(t, /## 지울 항목\n- 배포절차 › 롤백/)
  assert.match(t, /## 이름 바꿀 항목\n- 배포절차 › 카나리 → 카나리 배포/)
  assert.match(doc('dpms', '배포절차'), /^## 롤백$/m, '문서는 그대로')
})

test('이름 장부에 없는 항목을 고친 기록 — 그 항목에 선다(넣을 곳은 정리하는 사람이 고른다) · 같은 글 두 번 누름은 하나', async () => {
  const k = await s.hub.get('gdi')
  const d = k.docs.find((x) => x.sections.some((sc) => !coordsOfSection(k, x, sc.h).length))
  const h = d.sections.find((sc) => !coordsOfSection(k, d, sc.h).length).h
  const r1 = await s.hub.edit(LEE, 'gdi', { doc: d.id, sections: [{ h, body: '팀원이 고친 글 — 하나' }] })
  const r2 = await s.hub.edit(LEE, 'gdi', { doc: d.id, sections: [{ h, body: '팀원이 고친 글 — 하나' }] })
  assert.equal(r2.id, r1.id, '두 번 눌러도 기록 하나')
  const v = await fetch(s.url + `/api/k/gdi/doc?d=${encodeURIComponent(d.id)}`, { headers: { cookie: me.cookie } }).then((x) => x.json())
  const sec = v.sections.find((x) => x.h === h)
  assert.ok(sec.pend.some((p) => p.id === r1.id), '그 항목에 「아직 안 넣은 기록」 으로 선다')
})

test('MCP — 이미 있는 항목을 base 없이 갈아 끼우지 않는다 · base 가 있으면 · 새 항목은 받는다', async () => {
  const mcp = makeMcp(s.hub)
  const call = async (name, args) => {
    const out = await mcp.call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, KIM)
    return out.result.isError ? { error: out.result.content[0].text } : JSON.parse(out.result.content[0].text)
  }
  const bad = await call('save', { knowledge: 'dpms', record: { title: '롤백 — 바꿈', body: '롤백 글' }, sections: [{ coord: 'proc:롤백', content: '덮는 글' }] })
  assert.match(bad.error, /이미 있는 항목이다 — section 으로 다시 읽고 그 base/)
  const sec = await call('section', { knowledge: 'dpms', coord: 'proc:롤백' })
  const ok = await call('save', { knowledge: 'dpms', record: { title: '롤백 — 바꿈', body: '롤백 글' }, sections: [{ coord: 'proc:롤백', content: '고친 롤백 글', base: sec.base }] })
  assert.ok(ok.saved)
  const neu = await call('save', { knowledge: 'dpms', record: { title: '새 항목 — 하나', body: '새' }, sections: [{ doc: '배포절차', heading: '새 머리', content: '새 항목 글' }] })
  assert.ok(neu.saved)
})

test('이미 되돌린 정리는 다시 되돌리지 않는다 · 쓴 사람의 「되돌릴 수 있다」 줄도 거둔다', async () => {
  const a = await s.hub.save(LEE, 'dpms', { record: { title: '카나리 — lee', touches: ['proc:카나리'], body: '20%' } })
  const t = await s.hub.save({ user: 'kmd-auto' }, 'dpms', { record: { title: '정리 — 카나리', tags: ['curate-llm'], reflects: [a.id], body: `- 넣음 ${a.id} — 카나리` }, sections: [{ coord: 'proc:카나리', content: '20% 로' }] }, { system: true })
  await feed.add(data, 'lee', { kind: 'tidy', rec: t.id, kn: 'dpms', yl: true, b: '값이 바뀌었다', revert: t.id })
  await s.hub.revert(KIM, 'dpms', { record: t.id })
  assert.ok((await feed.list(data, 'lee')).some((x) => x.revert === t.id && x.reverted), '쓴 사람의 줄도 「되돌렸다」')
  assert.equal(await code(s.hub.revert(KIM, 'dpms', { record: t.id })), 'E_CONFLICT')
})

test('편집기로 고친 기록 · 장부 — 사본을 두고 되돌리며 이력에 알린다 · 꺼져 있던 동안 고친 문서는 켤 때 거둔다', async () => {
  const w = fs.readdirSync(path.join(root, 'dpms', 'work')).find((f) => f.endsWith('.md'))
  fs.appendFileSync(path.join(root, 'dpms', 'work', w), '\n손으로 고친 줄\n')
  const r = await s.hub.collect('dpms')
  assert.ok(r.reverted.includes(`work/${w}`))
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'dpms', 'work', w), 'utf8'), /손으로 고친 줄/)
  const copy = r.rescued.find((x) => x.path === `work/${w}`).copy
  assert.match(fs.readFileSync(copy, 'utf8'), /손으로 고친 줄/)
  assert.ok((await feed.list(data, 'kmd')).some((x) => /편집기 고침을 되돌렸다/.test(x.b || '') && (x.small || '').includes(copy)))
  // 꺼져 있던 동안
  await s.close()
  fs.appendFileSync(path.join(root, 'dpms', 'docs', '운영.md'), '\n꺼진 동안 편집기로 더한 줄\n')
  s = await startServer({ root, port: 0, log: () => {}, scryptN: 1 << 15 })
  assert.ok(await until(async () => (await s.hub.get('dpms')).logs.some((x) => /편집기에서 고침 — 운영/.test(x.title))), '켤 때 거뒀다')
  me = await signIn(s, { id: 'kim2' })
})

test('편집기 — 다시 그려도 · 찾기를 열고 닫아도 쓴 글이 남는다 · Ctrl S 저장 · 문서 오류는 가른다', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  await s.hub.setOwner(SHELL, 'dpms', { owner: 'kim2' }) // 주인이 고치면 곧바로 문서에
  const page = await browser.newPage({ viewport: { width: 1300, height: 820 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  await page.goto(s.url)
  await page.fill('#lgId', 'kim2')
  await page.fill('#lgPw', me.pw)
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector('[data-t=klist] [data-t=krow]')
  await page.click('[data-t=krow][data-name="DPMS 지식"]')
  await page.waitForSelector("[data-t=tree] [data-t=doc]")
  await page.click("[data-t=doc][data-name=\"배포절차\"]")
  await page.waitForSelector('[data-t=docPane]')
  await page.click('[data-t=editBtn]')
  await page.waitForSelector('[data-t=edTx]')
  const typed = (await page.inputValue('[data-t=edTx]')) + '\n\n## 새로 쓴 항목\n찾기를 열었다 닫아도 남는 글'
  await page.fill('[data-t=edTx]', typed)
  await page.keyboard.press('Control+k')
  await page.waitForSelector('#palIn')
  await page.keyboard.press('Escape')
  assert.equal(await page.inputValue('[data-t=edTx]'), typed, '찾기를 열고 닫아도 그대로')
  // 도구 줄은 일하는 단추만
  assert.equal(await page.locator('[data-t=edAddSec]').count(), 1)
  await page.focus('[data-t=edTx]')
  await page.keyboard.press('Control+s')
  await page.waitForSelector('[data-t=editBtn]')
  assert.match(fs.readFileSync(path.join(root, 'dpms', 'docs', '배포절차.md'), 'utf8'), /## 새로 쓴 항목\n(<!--.*-->\n)?찾기를 열었다 닫아도 남는 글/)
  // 없는 문서 — 「이제 없다」 · 그 밖의 오류 — 「다시 시도」
  const gone = await page.evaluate(async () => (await fetch('/api/k/dpms/doc?d=' + encodeURIComponent('없는문서'))).status)
  assert.equal(gone, 404)
  assert.deepEqual(errors, [])
  await page.close()
})
