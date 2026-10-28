// 팀 화면 ↔ 내 PC — 팀 화면 하나로 팀 · 개인을 다 한다.
//
// 개인 지식은 내 PC 쪽에만 있다. 팀 화면이 짝 열쇠로 내 PC 쪽을 불러 연다 · 내 PC 지식의 이름 · 글은 팀 서버로 가지 않는다.
// 내 PC 프로그램의 짝 길(/pair · 팀 서버의 한 번용 표)은 적히지 않은 주소 · 다른 사람 · 표 없이 · 같은 표 두 번을 받지 않는다.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { startServer } from '../server/http.js'
import { copyDir, signIn } from './helpers.mjs'

const until = async (f, ms = 30_000) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 150)) } return true }

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = [process.env.KMD_CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && fs.existsSync(p))
const SECRET = '배포노트비밀'
let tmp, team, pc, browser, me, dkey = null
const teamLog = []

before(async () => {
  if (!CHROME) return
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kmd-e8-'))
  const env = { ...process.env }
  process.env.HOME = process.env.USERPROFILE = process.env.APPDATA = tmp
  process.env.KMD_NO_CLAUDE = '1'
  // 내 PC — 지식 하나(이름 · 경로가 팀 쪽에 새면 시험이 잡는다)
  const kd = path.join(tmp, 'pc', SECRET)
  fs.mkdirSync(path.join(kd, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(kd, 'README.md'), `# ${SECRET}\n`)
  fs.writeFileSync(path.join(kd, 'docs', '카나리절차.md'), '# 카나리절차\n\n## 비율\n첫 30분은 요청의 10%.\n')
  // 이 PC 의 기기 열쇠(설치 한 줄이 자격 저장소에 둔다) — 짝을 지을 때 팀 서버에 「같은 사람인가」 를 묻는다
  pc = await startServer({ root: path.join(tmp, 'pc'), mode: 'pc', user: 'kim', port: 0, log: () => {}, scryptN: 1 << 15, deviceKey: async (o) => (team && o === new URL(team.url).origin ? dkey : null) })
  copyDir(path.join(HERE, 'fixture', 'kmd'), path.join(tmp, 'kn'))
  fs.mkdirSync(path.join(tmp, 'kn', '.kmd'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'kn', '.kmd', 'serve.json'), JSON.stringify({ pcUrl: pc.url }))
  team = await startServer({ root: path.join(tmp, 'kn'), port: 0, log: (...a) => teamLog.push(a.join(' ')), scryptN: 1 << 15 })
  me = await signIn(team, { id: 'kim' })
  dkey = await team.auth.deviceKeyFor('kim', { host: 'KIM-PC', osuser: 'kim' }) // 설치 한 줄로 이은 PC
  process.env.KMD_SEND_KEY = dkey // 내 PC 프로그램이 팀 서버에 보낼 때 쓰는 이 PC 의 기기 열쇠(설치 한 줄이 자격 저장소에 둔다)
  // 설치(kmd connect)가 적는 것과 같게 — 이 PC 가 팀 주소를 미리 허락
  fs.writeFileSync(path.join(tmp, 'pc', '.kmd', 'teams.json'), JSON.stringify([team.url]))
  if (!/^[\x20-\x7e]*$/.test(os.tmpdir())) {
    const ascii = path.join(HERE, '..', '.kmd-data', 'tmp')
    fs.mkdirSync(ascii, { recursive: true })
    process.env.TEMP = process.env.TMP = env.TEMP = env.TMP = ascii
  }
  browser = await chromium.launch({ executablePath: CHROME, headless: true, env })
})
after(async () => {
  await browser?.close()
  await team?.close()
  await pc?.close().catch(() => {})
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch {}
})

test('팀 화면이 내 PC 쪽을 짝 열쇠로 연다 · 내 PC 지식은 팀 서버로 가지 않는다 · 짝 길은 남을 받지 않는다', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 820 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const toTeam = []
  page.on('request', (r) => { if (r.url().startsWith(team.url)) toTeam.push(decodeURIComponent(r.url()) + ' ' + (r.postData() || '')) })
  await page.goto(team.url)
  await page.fill('#lgId', 'kim')
  await page.fill('#lgPw', me.pw)
  await page.click('[data-t=loginBtn]')
  // 개인 칸 — 내 PC 쪽의 지식 · 내 PC 지식 폴더 띠
  await page.waitForSelector(`[data-t=meList] [data-t=krow][data-name="${SECRET}"]`)
  assert.equal(await page.locator('[data-t=meWhere] [data-t=mePath]').innerText(), path.join(tmp, 'pc'))
  // 새 개인 지식은 내 PC 쪽에 선다 · 문서를 연다
  await page.click('[data-t=meList] [data-t=addCard]')
  await page.fill('#addIn', '내메모')
  await page.click('[data-t=addBtn]')
  await page.waitForSelector('[data-t=meList] [data-t=krow][data-name="내메모"]')
  assert.ok(fs.existsSync(path.join(tmp, 'pc', '내메모', 'docs', '처음.md')), '내 PC 지식 폴더에 섰다')
  await page.click(`[data-t=meList] [data-t=krow][data-name="${SECRET}"]`)
  await page.click('[data-t=doc][data-name="카나리절차"]')
  await page.waitForSelector('[data-t=docPane]')
  assert.match(await page.locator('[data-t=docPane]').innerText(), /첫 30분은 요청의 10%/)
  assert.ok(!toTeam.some((x) => x.includes(SECRET) || x.includes('카나리절차') || x.includes('내메모')), '내 PC 지식의 이름 · 글은 팀 서버로 가지 않는다')
  assert.ok(!fs.existsSync(path.join(tmp, 'kn', '내메모')), '팀 서버에는 개인 지식이 서지 않는다')
  assert.deepEqual(errors, [])

  // 적히지 않은 주소의 화면 → 잇지 않았다(허락 창은 없다)
  const evil = await fetch(pc.url + '/pair', { method: 'POST', headers: { origin: 'http://evil.example' } })
  assert.equal(evil.status, 403)
  assert.equal((await evil.json()).need, 'connect')
  // 같은 팀 · 다른 사람(lee 가 내 PC 브라우저로 팀에 들어옴) — 팀 서버의 표가 이 PC 를 이은 사람(kim)의 것이 아니라 짝 열쇠 0
  const lee = await signIn(team, { id: 'lee', admin: false })
  const passOf = async (who) => (await fetch(team.url + '/api/me/pcpass', { method: 'POST', headers: { cookie: who.cookie, 'content-type': 'application/json' }, body: '{}' }).then((x) => x.json())).pass
  const pairWith = (pass, origin = new URL(team.url).origin) => fetch(pc.url + '/pair', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ pass }) })
  const r1 = await pairWith(await passOf(lee))
  assert.equal(r1.status, 403)
  assert.equal((await r1.json()).need, 'person')
  // 표 없이 Origin 만 꾸민 프로세스 — 받지 못한다 · 표는 한 번만
  assert.equal((await pairWith('')).status, 400)
  const p1 = await passOf(me)
  assert.equal((await pairWith(p1)).status, 200)
  assert.equal((await pairWith(p1)).status, 403, '같은 표는 두 번 쓰지 못한다')
  // 팀 서버의 그 길 — GET 으로는 표를 내지 않는다 · 기기 열쇠가 아니면 대조하지 않는다
  assert.equal((await fetch(team.url + '/api/me/pcpass', { headers: { cookie: me.cookie } })).status, 405)
  assert.equal((await fetch(team.url + '/api/me/pcpass/check', { method: 'POST', headers: { cookie: me.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ pass: await passOf(me) }) })).status, 403)

  await ctx.close()
})
