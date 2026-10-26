// E8 필수 — 팀 화면 ↔ 내 PC.
//
// 팀 화면이 내 PC 프로그램에 붙어 「내 PC」 지식을 연다 · 팀 서버 요청 · 로그 · Referer 에 PC 지식 조각 0 ·
// CORS 로 `sources` → 403 · 적히지 않은 주소 → 허락 필요 · PC 꺼짐 → 한 줄.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { startServer } from '../server/http.js'
import { copyDir, signIn } from './helpers.mjs'

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

test('팀 화면이 내 PC 지식을 연다 — 팀 서버 쪽에 PC 지식 조각 0 · CORS 는 읽기 · 저장만 · 꺼지면 한 줄', { skip: !CHROME && 'Chrome 이 없다' }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 820 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const toTeam = []
  page.on('request', (r) => { if (r.url().startsWith(team.url)) toTeam.push([r.url(), JSON.stringify(r.headers()), r.postData() || ''].join(' ')) })
  await page.goto(team.url)
  await page.fill('#lgId', 'kim')
  await page.fill('#lgPw', me.pw)
  await page.click('[data-t=loginBtn]')
  await page.waitForSelector(`[data-t=krow][data-name="${SECRET}"]`)
  assert.match(await page.locator(`[data-t=krow][data-name="${SECRET}"]`).innerText(), /내 PC[\s\S]*내 PC 프로그램이 연다/)
  // 열기 — 나무 · 문서가 내 PC 프로그램에서 온다 · 주소는 해시 조각
  await page.click(`[data-t=krow][data-name="${SECRET}"]`)
  await page.click('[data-t=doc][data-name="카나리절차"]')
  await page.waitForSelector('[data-t=docPane]')
  assert.match(await page.locator('[data-t=docPane]').innerText(), /첫 30분은 요청의 10%/)
  assert.match(page.url(), /#~/)
  // 새로 고쳐도 그 문서 — 내 PC 연결은 뒤에서 잇지만 주소(#~지식/문서)를 잃지 않는다
  await page.reload()
  await page.waitForSelector('[data-t=docPane]')
  assert.match(await page.locator('[data-t=docPane]').innerText(), /첫 30분은 요청의 10%/)
  assert.match(page.url(), /#~/)
  // 짝 열쇠로 CORS 밖 길 — 가져오는 곳 · 설정 → 403
  const st = await page.evaluate(async (u) => {
    const t = sessionStorage.getItem('kmdPair')
    const h = { authorization: 'Bearer ' + t }
    const kn = encodeURIComponent('배포노트비밀')
    return [(await fetch(`${u}/api/k/${kn}/sources`, { headers: h })).status, (await fetch(`${u}/api/k/${kn}/tree`, { headers: h })).status, (await fetch(`${u}/api/k/${kn}/backup`, { headers: h })).status, (await fetch(`${u}/api/k/${kn}/tree`)).status]
  }, pc.url)
  assert.deepEqual(st, [403, 200, 403, 401])
  // 내 PC 지식을 고른 채 지식 관리 — 팀 서버의 이력 · 가져오는 곳 · 보낼 것을 그 지식의 것처럼 보이지 않는다(내 PC 화면에서 한다) · 지식 수는 갈래마다
  assert.match(await page.locator('[data-t=manageKind]').innerText(), /내 PC 지식/)
  for (const [nav, title] of [['nav-today', '이력'], ['nav-import', '지식 만들기'], ['nav-send', '지식 보내기']]) {
    await page.click(`[data-t=${nav}]`)
    await page.waitForSelector('[data-t=pcOnly]')
    assert.match(await page.locator('[data-t=pcOnly]').innerText(), new RegExp(`내 PC 지식 「${SECRET}」 — ${title}(은|는) 내 PC 프로그램 화면에서 한다`))
    assert.equal(await page.locator('[data-t=srcTable], [data-t=feed], [data-t=drop]').count(), 0, title)
  }
  await page.click('[data-t=kpick]')
  await page.click('[data-t=nav-home]')
  assert.match(await page.locator('[data-t=kpick]').innerText(), /팀 \d+ · 내 PC 1/)
  // 팀 서버로 간 요청 · 팀 서버 로그에 PC 지식 이름 · 경로 · ~ 조각 0
  const leak = toTeam.filter((x) => x.includes(SECRET) || x.includes(encodeURIComponent(SECRET)) || x.includes(path.join(tmp, 'pc')) || /\/api\/k\/(~|%7e)/i.test(x))
  assert.deepEqual(leak, [])
  assert.deepEqual(teamLog.filter((l) => l.includes(SECRET)), [])
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

  // 내 PC 프로그램이 꺼지면 — 새 탭에서 한 줄 · 지난번 이름은 흐리게
  await pc.close()
  pc = null
  const p2 = await ctx.newPage()
  await p2.goto(team.url)
  await p2.waitForSelector('[data-t=pcOff]')
  assert.match(await p2.locator('[data-t=pcOff]').innerText(), /내 PC 프로그램이 꺼져 있다 — 켜면 저절로 다시 열린다/)
  assert.equal(await p2.locator(`[data-t=krow][data-name="${SECRET}"].dim`).count(), 1)
  await ctx.close()
})
